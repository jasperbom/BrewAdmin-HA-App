// Het Overzicht van Verkoop: wat er te picken is, wat er ligt en wat eraan
// komt — de rijen en de teksten van het scherm. Alle getallen komen uit de ene
// telling van utils/verkoopOverzicht.ts (voorraad per verpakking, komt eraan,
// dekking, leverbaarheid van een bestelling) en de bestaande helpers voor een
// bestelling (`bestellingenOmTePicken`, `orderNummer`, `regelBedrag`). Hier
// wordt niets bijgeteld: geen drempel, geen flessen en fusten bij elkaar.
//
// Puur: geen React. Waar een zin nodig is geeft de aanroeper zijn
// vertaalfunctie mee (dezelfde afspraak als utils/etiket.ts).

import { bestellingLevering, dagenTot, leverLabel, BIER_THT_WAARSCHUWING_DAGEN } from './verkoopOverzicht'
import type {
  BestellingLevering, KomtEraanBatch, VerkoopBestelling, VerkoopCtx, VerkoopOrderRegel, VerkoopOverzichtRegel,
  VerkoopVerpakking, VoorraadVerpakking,
} from './verkoopOverzicht'
import { bestellingenOmTePicken, orderNummer } from './picking'
import { regelBedrag } from './orderRegel'
import { fmtD, fmtDagMaand, fmtWeekdagDatum } from './format'
import { verpakkingInZin, vulIn } from './attentieTekst'
import type { Vertaal } from './etiket'
import type { WcImportStatus } from './wcOrderImport'

/** Een chip: tekst en een vaste, semantische kleur. */
export interface ChipTekst {
  tekst: string
  kleur: 'groen' | 'oranje' | 'rood' | 'grijs'
}

// ── Te picken ───────────────────────────────────────────────────────────────

/** Eén regel van "Wat": bier of een vrije regel (merch), nooit verzendkosten of korting. */
export interface WatRegel {
  regelId: number | null
  aantal: number
  /** Biernaam of omschrijving, zoals op de bestelling. */
  naam: string
  /** Verpakking van een bierregel zoals op de bestelling ("fles", "Fust 20L"); leeg bij een vrije regel. */
  verpakking: string
  /** Het product van een bierregel (voor de bierkleur), als dat bekend is. */
  productId: number | null
  soort: 'bier' | 'vrij'
}

export interface TePickenRij {
  id: number
  /** Het zichtbare nummer (`orderNummer`): "WC-4321", "M-0014". */
  nummer: string
  klant: string
  datum: string | null
  status: string
  /** Het orderbedrag incl. BTW, cent-exact — dezelfde som als op de bestellingenpagina. */
  bedragCent: number
  wat: WatRegel[]
  /** Kan hij geleverd worden (`bestellingLevering`)? */
  levering: BestellingLevering
}

/** Een bestelling zoals hij opgeslagen is: met klant, datum, nummer en regels met prijs. */
type Bestelling = VerkoopBestelling & {
  datum?: string | null
  klant_naam?: string | null
  wc_order_nummer?: string | number | null
  bestel_nummer?: string | null
  regels?: Array<VerkoopOrderRegel & { omschrijving?: string | null }> | null
}

const getal = (x: unknown): number => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/**
 * De bestellingen die gepickt moeten worden (`bestellingenOmTePicken`: nieuw
 * of bevestigd met een bierregel; oudste eerst), elk met wat erin zit, het
 * bedrag en of de voorraad volstaat. `bestellingen` en `bestellingPicks` komen
 * uit de context — dezelfde als waarmee de voorraad geteld wordt.
 */
export const tePickenRijen = (ctx: VerkoopCtx): TePickenRij[] => {
  const lijst: Bestelling[] = bestellingenOmTePicken(ctx.bestellingen || [], ctx.bestellingPicks || [])
  return lijst.map(b => {
    const levering = bestellingLevering(b, ctx)
    const productVan = new Map<number | null, number | null>(levering.regels.map(r => [r.regelId, r.levering.productId]))
    const wat: WatRegel[] = []
    for (const r of b.regels || []) {
      if (!r) continue
      const type = String(r.type || 'bier')
      const aantal = getal(r.aantal)
      if (aantal <= 0) continue
      const bier = type === 'bier' && !r.merch
      if (!bier && type !== 'vrij' && type !== 'bier') continue
      const regelId = r.id != null ? Number(r.id) : null
      wat.push({
        regelId, aantal,
        naam: String((bier ? r.bier_naam : (r.omschrijving || r.bier_naam)) ?? '').trim(),
        verpakking: bier ? String(r.verpakking_type ?? '').trim() : '',
        productId: bier ? productVan.get(regelId) ?? null : null,
        soort: bier ? 'bier' : 'vrij',
      })
    }
    return {
      id: Number(b.id),
      nummer: orderNummer(b),
      klant: String(b.klant_naam ?? '').trim(),
      datum: b.datum ? String(b.datum).slice(0, 10) : null,
      status: String(b.status ?? ''),
      bedragCent: (b.regels || []).reduce((som, r) => som + regelBedrag(r).bruto_cent, 0),
      wat,
      levering,
    }
  })
}

/** "48× Kadeblond fles 33 cl" — een vrije regel: "1× T-shirt". */
export const watTekst = (r: WatRegel, t: Vertaal, taal?: string | null): string =>
  r.soort === 'bier'
    ? vulIn(t('verkoop_wat_bier'), { n: r.aantal, bier: r.naam || t('lbl_onbekend'), verpakking: verpakkingInZin(r.verpakking, taal) }).replace(/\s+$/, '')
    : vulIn(t('verkoop_wat_vrij'), { n: r.aantal, naam: r.naam || t('lbl_naamloos') })

// ── Komt eraan ──────────────────────────────────────────────────────────────

/**
 * Wanneer een batch naar verwachting afgevuld wordt, zoals een scherm het
 * zegt: een datum, "over tijd" (de verwachte dag is voorbij — nooit een datum
 * die al geweest is) of onbekend.
 */
export type KomtWanneer = { soort: 'datum'; datum: string } | { soort: 'over_tijd' } | { soort: 'onbekend' }

export const komtWanneer = (k: Pick<KomtEraanBatch, 'afvulDatum'> | null | undefined, vandaag: string): KomtWanneer => {
  if (!k?.afvulDatum) return { soort: 'onbekend' }
  const d = dagenTot(k.afvulDatum, vandaag)
  if (d !== null && d < 0) return { soort: 'over_tijd' }
  return { soort: 'datum', datum: k.afvulDatum }
}

const STUKS_TYPES = ['fles', 'fust', 'blik']

/** "710 fles", "2 fust" — een verpakking zonder bekend type: "12× Doos 24". */
export const stuksTekst = (n: number, verpakking: { naam?: string | null; type?: string | null }, t: Vertaal): string => {
  const type = String(verpakking.type ?? '').trim().toLowerCase()
  return STUKS_TYPES.includes(type)
    ? vulIn(t(`verkoop_stuks_${type}`), { n })
    : vulIn(t('verkoop_stuks_overig'), { n, verpakking: String(verpakking.naam ?? '').trim() })
}

export interface KomtEraanOpties {
  vandaag: string
  /** De verpakkingen (voor het type: "fles", "fust"). */
  verpakkingen?: VerkoopVerpakking[] | null
  /** Het geschatte aantal stuks erbij ("± 710 fles · 2 fust"); standaard ja. */
  stuks?: boolean
}

export interface KomtEraanDelen {
  /** "#2609 · GV1 · ± 16-10" — welke batch, waar, wanneer. */
  basis: string
  /** "± 640 fles · 3 fust" — de geschatte stuks; leeg als die onbekend zijn. */
  stuks: string
}

/**
 * De regel "komt eraan" in twee stukken: de batch met tank en verwachte
 * afvuldag, en de geschatte stuks (die een telefoon kan weglaten). Een
 * geplande batch: "#2611 · gepland 14-10 · afvullen ± 25-11" (de tank is dan
 * alleen gereserveerd). Over tijd: "#2609 · GV1 · over tijd".
 */
export const komtEraanDelen = (k: KomtEraanBatch, t: Vertaal, opties: KomtEraanOpties): KomtEraanDelen => {
  const delen: string[] = [k.batchNummer ? `#${k.batchNummer}` : t('verkoop_komt_batch')]
  const w = komtWanneer(k, opties.vandaag)
  if (k.status === 'Gepland') {
    if (k.geplandeBrouwdatum) delen.push(vulIn(t('verkoop_komt_gepland'), { datum: fmtDagMaand(k.geplandeBrouwdatum) }))
    if (w.soort === 'datum') delen.push(vulIn(t('verkoop_komt_afvullen'), { datum: fmtDagMaand(w.datum) }))
    else if (w.soort === 'over_tijd') delen.push(t('verkoop_komt_over_tijd'))
  } else {
    if (k.tank) delen.push(k.tank)
    if (w.soort === 'datum') delen.push(vulIn(t('verkoop_komt_rond'), { datum: fmtDagMaand(w.datum) }))
    else if (w.soort === 'over_tijd') delen.push(t('verkoop_komt_over_tijd'))
  }
  const vp = opties.verpakkingen || []
  const stuks = k.stuksPerVerpakking.map(s => {
    const v = s.verpakkingId != null ? vp.find(x => Number(x?.id) === Number(s.verpakkingId)) : null
    return stuksTekst(s.stuks, { naam: s.naam, type: v?.type ?? null }, t)
  })
  return {
    basis: delen.join(' · '),
    stuks: stuks.length ? vulIn(t('verkoop_komt_stuks'), { stuks: stuks.join(' · ') }) : '',
  }
}

/**
 * "#2609 · GV1 · ± 16-10 · ± 710 fles · 2 fust" — `komtEraanDelen` als één
 * regel; met `stuks: false` zonder de schatting.
 */
export const komtEraanTekst = (k: KomtEraanBatch, t: Vertaal, opties: KomtEraanOpties): string => {
  const d = komtEraanDelen(k, t, opties)
  return opties.stuks !== false && d.stuks ? `${d.basis} · ${d.stuks}` : d.basis
}

/**
 * Een regel met " · " ertussen die alleen bij de punten afbreekt: binnen een
 * stuk ("640 fles", "± 16-10") worden de spaties vast. Zo valt op een smal
 * scherm nooit "3" aan het eind van de ene regel en "fust" op de volgende.
 */
export const brekenBijPunt = (s: string): string =>
  String(s ?? '').split(' · ').map(deel => deel.replace(/ /g, ' ')).join(' · ')

// ── Leverbaarheid van een bestelling ────────────────────────────────────────

/**
 * De chip in de kolom Voorraad: "kan geleverd" (groen), "eerst uitslaan (n)",
 * "tekort 2 · komt ± 16-10" of "tekort 2 · batch over tijd" (oranje), "niet
 * herkend" (grijs). Null voor een bestelling zonder bierregels.
 */
export const leverChip = (l: BestellingLevering, t: Vertaal, vandaag: string): ChipTekst | null => {
  const lab = leverLabel(l)
  if (!lab.sleutel) return null
  if (l.status === 'tekort' && l.eersteKomtEraan) {
    const w = komtWanneer(l.eersteKomtEraan, vandaag)
    if (w.soort === 'datum') return { tekst: vulIn(t('verkoop_lever_tekort_komt'), { n: l.tekort, datum: fmtDagMaand(w.datum) }), kleur: lab.kleur }
    if (w.soort === 'over_tijd') return { tekst: vulIn(t('verkoop_lever_tekort_over_tijd'), { n: l.tekort }), kleur: lab.kleur }
  }
  return { tekst: vulIn(t(lab.sleutel), lab.params), kleur: lab.kleur }
}

// ── Voorraad en komt eraan ──────────────────────────────────────────────────

/** De verpakkingen die een regel toont: met voorraad, geblokkeerd of besteld. */
export const getoondeVerpakkingen = (r: Pick<VerkoopOverzichtRegel, 'voorraad'>): VoorraadVerpakking[] =>
  r.voorraad.filter(g => g.vrij + g.agp + g.geblokkeerd > 0 || g.besteld > 0)

/**
 * De naam van een verpakking op een chip: kort het type ("Fles") als het
 * product maar één verpakking van dat type heeft, anders de volledige naam
 * ("Fles 33cL" naast "Fles 75cL").
 */
export const verpakkingLabel = (g: VoorraadVerpakking, alle: VoorraadVerpakking[], t: Vertaal): string => {
  const type = String(g.type ?? '').trim().toLowerCase()
  if (type && alle.filter(x => String(x.type ?? '').trim().toLowerCase() === type).length === 1) {
    const label = t(`pkg_${type}`, '')
    if (label) return label
  }
  return g.naam || t('lbl_onbekend')
}

/** "± 4 wk"; onder een week "< 1 wk". */
export const dekkingTekst = (weken: number, t: Vertaal): string =>
  weken < 1 ? t('verkoop_dekking_minder') : vulIn(t('verkoop_dekking'), { n: Math.round(weken) })

export interface VoorraadChip extends ChipTekst {
  sleutel: string
}

/**
 * Per verpakking één chip, nooit opgeteld: "Fles 46 vrij", "Fust 3 AGP",
 * "Fles 132 vrij · 240 AGP · ± 4 wk". De dekking alleen als die er is (genoeg
 * verkoop, `dekkingPerVerpakking`) en er na de bestellingen nog iets over is.
 */
export const voorraadChips = (r: Pick<VerkoopOverzichtRegel, 'voorraad' | 'dekkingPerVerpakking'>, t: Vertaal): VoorraadChip[] =>
  getoondeVerpakkingen(r).map(g => {
    const delen: string[] = []
    if (g.vrij > 0 || g.agp === 0) delen.push(vulIn(t('verkoop_vrij'), { n: g.vrij }))
    if (g.agp > 0) delen.push(vulIn(t('verkoop_agp'), { n: g.agp }))
    if (g.geblokkeerd > 0) delen.push(vulIn(t('verkoop_geblokkeerd'), { n: g.geblokkeerd }))
    // Nul weken = alles is al besteld: dan zegt de chip "tekort" of "niets
    // vrij" naast de naam het al, en "< 1 wk" zou alleen herhalen.
    const d = r.dekkingPerVerpakking[g.sleutel]
    if (d != null && d > 0) delen.push(dekkingTekst(d, t))
    return {
      sleutel: g.sleutel,
      tekst: `${verpakkingLabel(g, r.voorraad, t)} ${delen.join(' · ')}`,
      kleur: g.geblokkeerd > 0 && g.vrij + g.agp === 0 ? 'rood' : 'grijs',
    }
  })

/**
 * Wat er met een product aan de hand is, als chips naast de naam — de urgentie
 * van `verkoopOverzicht` in woorden: rood "tekort tot ± vr 16-10" (of "tekort
 * · batch over tijd", "tekort · niets onderweg"), oranje "eerst uitslaan",
 * "niets vrij", "voorraad laag", de THT ("THT 2-11-2026"; verlopen = rood) en
 * grijs "uit roulatie".
 */
export const productChips = (
  r: VerkoopOverzichtRegel,
  t: Vertaal,
  opties: { vandaag: string; taal?: string | null },
): ChipTekst[] => {
  const chips: ChipTekst[] = []
  const agpNa = r.voorraad.some(g => g.agpNaReservering > 0)
  switch (r.urgentie) {
    case 'tekort': {
      const w = komtWanneer(r.eersteKomtEraan, opties.vandaag)
      if (w.soort === 'datum') {
        chips.push({ tekst: vulIn(t('verkoop_tekort_tot'), { datum: fmtWeekdagDatum(w.datum, { jaar: false, lang: opties.taal || 'nl' }) }), kleur: 'rood' })
      } else if (w.soort === 'over_tijd') {
        chips.push({ tekst: t('verkoop_tekort_over_tijd'), kleur: 'rood' })
      } else {
        chips.push({ tekst: t(r.eersteKomtEraan ? 'verkoop_tekort' : 'verkoop_tekort_niets'), kleur: 'rood' })
      }
      break
    }
    case 'uitslaan':
      chips.push({ tekst: t('verkoop_eerst_uitslaan'), kleur: 'oranje' })
      break
    case 'geen_vrij':
      chips.push({ tekst: t(agpNa ? 'verkoop_eerst_uitslaan' : 'verkoop_niets_vrij'), kleur: 'oranje' })
      break
    case 'laag':
      chips.push({ tekst: t('verkoop_voorraad_laag'), kleur: 'oranje' })
      break
    default:
      break
  }
  if (r.eersteTht && r.thtDagen !== null && r.thtDagen <= BIER_THT_WAARSCHUWING_DAGEN) {
    chips.push(r.thtDagen < 0
      ? { tekst: vulIn(t('verkoop_tht_verlopen'), { datum: fmtD(r.eersteTht) }), kleur: 'rood' }
      : { tekst: vulIn(t('verkoop_tht'), { datum: fmtD(r.eersteTht) }), kleur: 'oranje' })
  }
  if (r.uitRoulatie) chips.push({ tekst: t('verkoop_uit_roulatie'), kleur: 'grijs' })
  return chips
}

/**
 * Welke batches "komt eraan" op een regel noemt: altijd de eerste (een product
 * met niets vrij staat nooit zonder), en een tweede alleen als er een tekort
 * of niets vrij is — dan telt elke batch.
 */
export const getoondeKomtEraan = (r: Pick<VerkoopOverzichtRegel, 'komtEraan' | 'urgentie'>): KomtEraanBatch[] =>
  r.komtEraan.slice(0, r.urgentie === 'tekort' || r.urgentie === 'geen_vrij' ? 2 : 1)

// ── WooCommerce ─────────────────────────────────────────────────────────────

/**
 * De importregel onderaan: "WooCommerce: laatste import 7-10 09:15 · elke 15
 * min · 0 nieuw" (`wc_import_status`, gezet bij elke import; `nieuw` = wat die
 * import binnenhaalde). Interval 0 = automatisch importeren staat uit.
 */
export const wcImportTekst = (
  status: Pick<WcImportStatus, 'laatste_import' | 'laatste_import_aantal'> | null | undefined,
  intervalMin: number,
  t: Vertaal,
): string => {
  const delen: string[] = []
  const tijd = status?.laatste_import ? fmtDagMaand(status.laatste_import, { tijd: true }) : ''
  delen.push(tijd ? vulIn(t('verkoop_wc_laatste_import'), { tijd }) : t('verkoop_wc_nog_niet'))
  delen.push(intervalMin > 0 ? vulIn(t('verkoop_wc_elke'), { n: intervalMin }) : t('verkoop_wc_auto_uit'))
  if (tijd) delen.push(vulIn(t('verkoop_wc_nieuw'), { n: getal(status?.laatste_import_aantal) }))
  return vulIn(t('verkoop_wc_regel'), { tekst: delen.join(' · ') })
}
