import React, { useState, useMemo, useEffect, useRef } from 'react'
import { t } from '../i18n'
import { newId, volgendFactuurNummer } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { getAgpLocatie, openBestellingReserveringen, gereserveerdVoorArtikel, accijnsMaandGesloten } from '../utils/calculations'
import { kassaVoorraadNaReservering, agpGereserveerdPerAfvulling, kassaBonTotalen } from '../utils/kassa'
import { beschikbaarVoorAfvulling as beschikbaarNaPicks, beschikbaarBuitenAgpNaPicks } from '../utils/beschikbaarheid'
import { afvullingVerkoopbaar } from '../utils/haccp'
import { bouwUitslagBoekingen, uitslagDatumFout, laatsteAfvulDatum, VERPLAATS_FOUT_KEYS } from '../utils/agp'
import { bouwVerkoopUitleveringen } from '../utils/uitlevering'
import UitslagModal from '../components/UitslagModal'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import { printFactuur } from '../components/PakbonExport'
import { logAudit } from '../utils/audit'
import { resolveKlantSnapshot, nextKlantnummer } from '../utils/klant'
import { breweryMetTermijn } from '../utils/facturen'
import { verkoopFactuurBoeking, voegBoekingToe } from '../utils/journaal'
import {
  MerchArtikel, MerchMutatie, merchLabel, merchVoorraad, volgtVoorraad,
  boekMerchMutaties, merchAfboekingenVoorRegels,
} from '../utils/merch'
import { totaliseerRegels } from '../utils/centen'
import { afvullingHoortBijBierNaam } from '../utils/picking'
import { standaardBtwPct, artikelBtwPct } from '../utils/btw'
import BierKleur from '../components/ui/BierKleur'

interface KassaPageProps {
  bat: any[]
  av: any[]
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  artikelen: any[]
  verpakkingen?: any[]
  producten?: any[]
  productArtikelen?: any[]
  bestellingen: any[]
  setBestellingen: any
  bestellingPicks: any[]
  setBestellingPicks: any
  verkoopFacturen: any[]
  setVerkoopFacturen: any
  accijnsInst?: any
  breweryDetails?: any
  appName?: string
  factuurLogo?: string | null
  factuurCounter?: any
  setFactuurCounter?: any
  log?: any[]
  setLog?: any
  klanten: any[]
  setKlanten?: any
  locaties?: any[]
  verplaatsingen?: any[]
  setVerplaatsingen?: any
  afboekingen?: any[]
  accijnsAangiftes?: any[]
  auditLog?: any[]
  setAuditLog?: any
  setJournaal?: any
  btwInst?: any
  btwTarieven?: Array<number | string>
  merchArtikelen?: MerchArtikel[]
  setMerchArtikelen?: any
  merchVoorraadLog?: MerchMutatie[]
  setMerchVoorraadLog?: any
}

// Eén regel op de kassabon. De prijs komt altijd uit het artikel (normaal of
// B2B) en is niet handmatig aan te passen; korting gaat via de kortingsregel.
interface BonRegel {
  key: string
  type: 'bier' | 'vrij'
  bier_naam: string
  verpakking_type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  omschrijving: string
  artikel_id?: number | null
  artikel_key?: string | null
  sku?: string | null
  prijsType?: 'normaal' | 'b2b'
  /** Merch-artikel met eigen voorraad; wordt bij afrekenen afgeboekt. */
  merch_id?: number | null
}

// Handmatige korting op de hele bon: vast bedrag (incl. BTW) of percentage.
interface BonKorting {
  soort: 'bedrag' | 'pct'
  waarde: number
}

type Betaalwijze = 'contant' | 'pin' | 'rekening'

const rnd2 = (n: number) => Math.round(n * 100) / 100

const KassaPage: React.FC<KassaPageProps> = ({
  bat, av, uit, setUit, acc, setAcc,
  artikelen, verpakkingen = [], producten = [], productArtikelen = [],
  bestellingen, setBestellingen,
  bestellingPicks, setBestellingPicks,
  verkoopFacturen, setVerkoopFacturen,
  accijnsInst, breweryDetails, appName = '', factuurLogo = null,
  factuurCounter, setFactuurCounter = () => {},
  log = [], setLog = () => {},
  klanten = [], setKlanten = () => {},
  locaties = [], verplaatsingen = [], setVerplaatsingen = () => {}, afboekingen = [],
  accijnsAangiftes = [],
  auditLog = [], setAuditLog = () => {},
  setJournaal = () => {},
  btwInst = {}, btwTarieven = [0, 9, 21],
  merchArtikelen = [], setMerchArtikelen = () => {},
  merchVoorraadLog = [], setMerchVoorraadLog = () => {},
}) => {
  // Standaard BTW-tarief uit de instellingen (21% tenzij anders ingesteld)
  const stdBtw = standaardBtwPct(btwInst, btwTarieven)
  const [cart, setCart] = useState<BonRegel[]>([])
  const [selectedKlantId, setSelectedKlantId] = useState<number | null>(null)
  const [klantZoek, setKlantZoek] = useState('')
  const [productZoek, setProductZoek] = useState('')
  // Prijsweergave in de productkaarten: excl. (opgeslagen prijs) of incl. BTW
  const [toonInclBtw, setToonInclBtw] = useState(false)
  // Uitverkochte tegels staan standaard verborgen — anders vervuilt de kassa
  // met bier dat toch niet verkocht kan worden.
  const [toonUitverkocht, setToonUitverkocht] = useState(false)
  const [showAfrekenen, setShowAfrekenen] = useState(false)
  const [betaalwijze, setBetaalwijze] = useState<Betaalwijze>('pin')
  const [showNieuweKlant, setShowNieuweKlant] = useState(false)
  const [nieuweKlantForm, setNieuweKlantForm] = useState({naam: '', klant_type: 'prive', email: '', telefoon: ''})
  const [showVrijeRegel, setShowVrijeRegel] = useState(false)
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw)})
  const [bonKorting, setBonKorting] = useState<BonKorting | null>(null)
  const [showKorting, setShowKorting] = useState(false)
  const [kortingForm, setKortingForm] = useState({soort: 'bedrag', waarde: ''})
  // Klantkorting voor alleen deze bon (null = het standaardpercentage van de
  // klantkaart). De klantkaart zelf blijft ongewijzigd.
  const [klantKortingBon, setKlantKortingBon] = useState<number | null>(null)
  const [klantKortingForm, setKlantKortingForm] = useState<string | null>(null)
  // Laatste afgeronde verkoop voor het succes-scherm (factuur printen)
  const [laatsteVerkoop, setLaatsteVerkoop] = useState<{bestelling: any, factuur: any} | null>(null)

  const selectedKlant = selectedKlantId != null ? (klanten || []).find((k: any) => k.id === selectedKlantId) : null
  // Zakelijk bepaalt alleen de prijs (B2B). De voorraad is voor elke klant
  // dezelfde: de kassa verkoopt uitsluitend uit vrije voorraad buiten de AGP —
  // uitslaan is een aparte stap die eraan voorafgaat (utils/agp.ts).
  const isZakelijk = !!selectedKlant && (selectedKlant.klant_type === 'zakelijk' ||
    (!selectedKlant.klant_type && String(selectedKlant.bedrijf || '').trim() !== ''))

  // ── Voorraadhelpers ──────────────────────────────────────────────────────────
  // Dezelfde telling als de bestellingen en de productpagina
  // (utils/beschikbaarheid.ts): afgevuld min open picks, uitleveringen en
  // afboekingen; een pick zonder bronlocatie legt eerst vrije voorraad vast.

  const voorraadData = {bestellingPicks, bestellingen, uit, afboekingen, locaties, verplaatsingen} as any

  const beschikbaarVoorAfvulling = (a: any): number => beschikbaarNaPicks(a, voorraadData)

  const beschikbaarBuitenAgpVoorAfvulling = (a: any): number => beschikbaarBuitenAgpNaPicks(a, voorraadData)

  // FEFO: eerst-verlopende afvulling eerst
  const fefo = (a: any, b: any) => {
    if (!a.tht && !b.tht) return 0
    if (!a.tht) return 1
    if (!b.tht) return -1
    return a.tht.localeCompare(b.tht)
  }

  // Afvullingen die bij een catalogus-item horen (SKU eerst, dan bier+verpakking)
  const matchendeAfvullingen = (bierNaam: string, verpakkingType: string, sku?: string | null) => {
    // Expliciet product_id op een afvulling is autoritatief (rebrand): een
    // afvulling die aan een ánder product is gekoppeld hoort hier nooit bij —
    // ook niet via een (stale) SKU-tier. Zo toont de kassa geen dubbele
    // voorraad onder de oude biernaam nadat een bier is omgehangen/hernoemd.
    const prodVoorNaam = (producten || []).find((p: any) => p.naam.toLowerCase() === bierNaam.toLowerCase())
    const filtered = (av || []).filter((a: any) => {
      // Geblokkeerd na een afgekeurde sluitcontrole (CCP 2): niet verkoopbaar
      // en niet uit te slaan — telt dus ook niet mee op de tegel.
      if (!afvullingVerkoopbaar(a)) return false
      if (beschikbaarVoorAfvulling(a) <= 0) return false
      if (a.product_id) return !!prodVoorNaam && a.product_id === prodVoorNaam.id
      return true
    })
    if (sku) {
      const skuMatches = filtered.filter((a: any) => a.artikel_sku === sku)
      if (skuMatches.length > 0) return skuMatches.sort(fefo)
      const legacy = filtered.filter((a: any) => {
        if (a.artikel_sku) return false
        const matchArt = (artikelen || []).find((art: any) =>
          art.artikelnummer === sku &&
          art.verpakking_type?.toLowerCase() === a.verpakking_type?.toLowerCase()
        )
        if (!matchArt) return false
        const batch = (bat || []).find((b: any) => b.id === a.batch_id)
        if (batch?.biernaam) return batch.biernaam === matchArt.biernaam
        return true
      }).sort(fefo)
      if (legacy.length > 0) return legacy
    }
    const vpNamenVoorType = (verpakkingen || [])
      .filter((v: any) => v.type?.toLowerCase() === verpakkingType.toLowerCase())
      .map((v: any) => v.naam?.toLowerCase())
      .filter(Boolean)
    return filtered
      .filter((a: any) => {
        const avpLower = (a.verpakking_type || '').toLowerCase()
        const matchVerpakking = avpLower === verpakkingType.toLowerCase()
          || vpNamenVoorType.includes(avpLower)
          || vpNamenVoorType.some((n: string) => avpLower.includes(n) || n.includes(avpLower))
        if (!matchVerpakking) return false
        // Een gerebrande afvulling hangt onder precies één product (expliciet
        // product_id); niet meer terugvallen op de oude batchnaam/product zodat
        // de kassa geen dubbele voorraad toont bij hernoemde/omgehangen bieren.
        return afvullingHoortBijBierNaam(a, bierNaam, producten || [], bat || [])
      })
      .sort(fefo)
  }

  // ── Uitslaan uit de AGP vanaf de kassa ─────────────────────────────────────
  // Uitslaan en verkopen zijn twee stappen: bier verlaat eerst de AGP (hier
  // ontstaat de accijns) en wordt daarna uit vrije voorraad verkocht. Dat
  // betekende tot nu toe: kassa verlaten, op de AGP- of productpagina
  // verplaatsen, terugkomen en opnieuw beginnen. Hier kan het ter plekke, met
  // exact dezelfde boeking — `bouwUitslagBoekingen` uit `utils/agp.ts`.
  const [uitslagItem, setUitslagItem] = useState<any | null>(null)

  const openUitslag = (item: any) => {
    // Periode-lock (ERP-plan 0.4): een uitslag boekt accijns op vandaag; dat
    // mag niet meer wanneer die aangifte al is ingediend of betaald.
    if (accijnsMaandGesloten(tod(), accijnsAangiftes || [])) {
      alert(t('err_accijns_maand_gesloten_boeking')); return
    }
    if (!(locaties || []).some((l: any) => !l.is_agp)) {
      alert(t('pos_uitslag_geen_locatie')); return
    }
    setUitslagItem(item)
  }

  // De modal heeft de afvullingen al gekozen (oudste THT eerst); hier worden ze
  // in één keer geboekt: verplaatsing + accijnsrecord + voorraadlogregel.
  const saveUitslag = ({allocaties, naar_locatie_id, datum, opmerking}: any) => {
    // De modal kan een andere datum dan vandaag kiezen: die datum wordt de
    // accijnsdatum, dus daar geldt de periode-lock (tweede slot naast de modal).
    const datumFout = uitslagDatumFout(datum, allocaties, {accijnsAangiftes: accijnsAangiftes || []})
    if (datumFout) {
      alert(t(VERPLAATS_FOUT_KEYS[datumFout]).replace('{datum}', fmtD(laatsteAfvulDatum(allocaties)))); return
    }
    const naar = (locaties || []).find((l: any) => l.id === naar_locatie_id)
    // newId() loopt globaal monotoon op, dus ook binnen de lus in
    // bouwUitslagBoekingen — waar de vorige records nog niet in de state
    // staan — blijven de ids uniek.
    const r = bouwUitslagBoekingen(
      {allocaties, naar_locatie_id, datum, opmerking},
      {locaties, uit, verplaatsingen, afboekingen, accijnsInst},
      () => ({verplaatsing_id: newId(verplaatsingen || []), accijns_id: newId(acc || []), log_id: newId(log || [])}),
      {logTitel: t('agp_verplaats_titel')}
    )
    if (r.verplaatsingen.length) setVerplaatsingen((prev: any[]) => [...(prev || []), ...r.verplaatsingen])
    if (r.accijns.length) setAcc((prev: any[]) => [...(prev || []), ...r.accijns])
    if (r.log.length) setLog((prev: any[]) => [...(prev || []), ...r.log])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: r.verplaatsingen[0]?.id, actie: 'aangemaakt',
      omschrijving: `${t('pos_uitslag_audit')}: ${r.totaal}\u00d7 ${uitslagItem?.bier_naam || ''} (${uitslagItem?.verpakking_type || ''}) \u2192 ${naar?.naam || ''}${r.totaalAccijns ? ` (accijns ${fmt(r.totaalAccijns)})` : ''}`,
    })
    setUitslagItem(null)
  }

  // ── Catalogus: verkoopbare bier+verpakking-combinaties met prijs en voorraad ─

  // Zachte reserveringen uit open bestellingen (status nieuw/bevestigd, nog niet
  // gepickt). Net als in WooCommerce/ProductenPage telt een binnengekomen
  // bestelling direct als gereserveerde voorraad: de kassa mag dat deel niet
  // opnieuw verkopen. De harde picks zitten al in beschikbaarVoorAfvulling.
  const openReserveringen = useMemo(
    () => openBestellingReserveringen(bestellingen || [], bestellingPicks || []),
    [bestellingen, bestellingPicks]
  )

  const artikelVoorKeuze = (biernaam: string, verpakking: string) => {
    const prod = (producten || []).find((p: any) => p.naam === biernaam)
    if (prod) {
      const pa = (productArtikelen || []).find((a: any) => a.product_id === prod.id && a.verpakking_type === verpakking)
      if (pa) return pa
    }
    return (artikelen || []).find((a: any) => a.biernaam === biernaam && a.verpakking_type === verpakking)
  }

  const catalogus = useMemo(() => {
    const bieren = [...new Set([
      ...(producten || []).filter((p: any) => p.status !== 'gearchiveerd').map((p: any) => p.naam),
      ...(artikelen || []).map((a: any) => a.biernaam),
    ].filter(Boolean))] as string[]
    const items: any[] = []
    for (const bier of bieren) {
      const prod = (producten || []).find((p: any) => p.naam === bier)
      const types = prod
        ? (productArtikelen || []).filter((a: any) => a.product_id === prod.id).map((a: any) => a.verpakking_type).filter(Boolean)
        : []
      const vpTypes = types.length
        ? types
        : (artikelen || []).filter((a: any) => a.biernaam === bier).map((a: any) => a.verpakking_type).filter(Boolean)
      for (const vp of [...new Set(vpTypes)] as string[]) {
        const art = artikelVoorKeuze(bier, vp)
        const sku = art?.artikelnummer || null
        const afvs = matchendeAfvullingen(bier, vp, sku)
        let voorraadBruto = 0, buitenAgpBruto = 0
        for (const a of afvs) {
          voorraadBruto += beschikbaarVoorAfvulling(a)
          buitenAgpBruto += Math.min(beschikbaarVoorAfvulling(a), beschikbaarBuitenAgpVoorAfvulling(a))
        }
        // Zachte reservering van open bestellingen aftrekken (nog niet gepickt),
        // en de netto AGP-voorraad afleiden voor de info-weergave.
        // `skuData` erbij: draagt dezelfde SKU per ongeluk aan twee bieren, dan
        // beslist de biernaam voor welk artikel de reservering telt.
        const gereserveerd = gereserveerdVoorArtikel(
          openReserveringen,
          {artikelnummer: sku, biernaam: bier, verpakking_type: vp},
          {producten, productArtikelen, artikelen, merchArtikelen},
        )
        const {voorraad, buitenAgp, agp} = kassaVoorraadNaReservering(voorraadBruto, buitenAgpBruto, gereserveerd)
        items.push({
          key: `${bier}|${vp}`,
          bier_naam: bier,
          verpakking_type: vp,
          artikel_id: art?.id ?? null,
          artikel_key: art?.key ?? null,
          sku,
          // Geen `recepten`-prop op deze pagina — val terug op het eigen
          // EBC-veld van het product (zie utils/bierKleur.ts productEbc).
          ebc: prod?.ebc ?? null,
          prijs: art?.verkoopprijs != null && art.verkoopprijs !== '' ? Number(art.verkoopprijs) : null,
          b2bPrijs: art?.b2b_prijs != null && art.b2b_prijs !== '' ? Number(art.b2b_prijs) : null,
          btw_pct: artikelBtwPct(art, stdBtw),
          voorraad,
          buitenAgp,
          agp,
        })
      }
    }
    // Merch met eigen voorraad verkoopt de kassa gewoon mee: geen afvulling,
    // geen accijns, geen AGP — alleen een teller die eraf gaat. Zonder
    // verkoopprijs blijft de tegel uitgeschakeld (een €0-bon is een valkuil).
    for (const m of (merchArtikelen || [])) {
      if (!volgtVoorraad(m)) continue
      const voorraad = merchVoorraad(m)
      items.push({
        key: `merch-${m.id}`,
        merch: true,
        merch_id: m.id,
        bier_naam: m.naam || m.sku || '',
        verpakking_type: t('orders_regel_merch'),
        artikel_id: null,
        artikel_key: null,
        sku: m.sku || null,
        prijs: m.verkoopprijs != null ? Number(m.verkoopprijs) : null,
        b2bPrijs: null,
        btw_pct: m.btw_pct != null ? Number(m.btw_pct) : stdBtw,
        voorraad,
        buitenAgp: voorraad,
        agp: 0,
      })
    }
    return items.sort((a, b) => a.bier_naam.localeCompare(b.bier_naam) || a.verpakking_type.localeCompare(b.verpakking_type))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [av, uit, verplaatsingen, afboekingen, bestellingPicks, bestellingen, openReserveringen, producten, productArtikelen, artikelen, verpakkingen, locaties, bat, merchArtikelen])

  const catalogusGefilterd = catalogus.filter((c: any) =>
    !productZoek.trim() ||
    `${c.bier_naam} ${c.verpakking_type}`.toLowerCase().includes(productZoek.trim().toLowerCase()))

  // Uitverkocht = geen vrije voorraad meer buiten de AGP (merch: geen
  // prijs). Standaard verborgen, tenzij de kassa dan helemaal leeg zou zijn —
  // dan is tonen zonder uitleg erger dan tonen mét de rode "geen voorraad".
  const itemUitverkocht = (item: any): boolean =>
    item.merch ? item.prijs == null : item.buitenAgp <= 0
  const catalogusOpVoorraad = catalogusGefilterd.filter((c: any) => !itemUitverkocht(c))
  const aantalUitverkocht = catalogusGefilterd.length - catalogusOpVoorraad.length
  const catalogusZichtbaar = (toonUitverkocht || catalogusOpVoorraad.length === 0)
    ? catalogusGefilterd
    : catalogusOpVoorraad

  // ── Klantstatistieken: terugkerende klanten snel in beeld ───────────────────

  const klantStats = useMemo(() => {
    const stats: Record<number, {count: number, last: string, openstaand: number}> = {}
    const bump = (id: number, datum: string) => {
      if (!stats[id]) stats[id] = {count: 0, last: '', openstaand: 0}
      stats[id].count++
      if (String(datum || '') > stats[id].last) stats[id].last = String(datum || '')
    }
    for (const f of (verkoopFacturen || [])) {
      const live = resolveKlantSnapshot(f, klanten)
      if (live.klant_id == null) continue
      bump(live.klant_id, f.datum)
      const openStatussen = ['open', 'herinnering', 'tweede_herinnering', 'aanmaning']
      if (openStatussen.includes(f.status)) {
        stats[live.klant_id].openstaand += Number(f.bruto || 0)
      }
    }
    for (const b of (bestellingen || [])) {
      // Alleen bestellingen zonder factuur meetellen; gefactureerde zitten al in
      // de facturenlus hierboven (voorkomt dubbeltelling van dezelfde aankoop).
      if (b.factuur_id != null || b.status === 'geannuleerd') continue
      const live = resolveKlantSnapshot(b, klanten)
      if (live.klant_id == null) continue
      bump(live.klant_id, b.datum)
    }
    return stats
  }, [verkoopFacturen, bestellingen, klanten])

  const recenteKlanten = useMemo(() =>
    (klanten || [])
      .filter((k: any) => klantStats[k.id])
      .sort((a: any, b: any) => (klantStats[b.id]?.last || '').localeCompare(klantStats[a.id]?.last || ''))
      .slice(0, 6)
  , [klanten, klantStats])

  const klantZoekResultaten = useMemo(() => {
    const q = klantZoek.trim().toLowerCase()
    if (!q) return []
    return (klanten || []).filter((k: any) =>
      `${k.naam || ''} ${k.bedrijf || ''} ${k.klantnummer || ''} ${k.email || ''}`.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [klanten, klantZoek])

  // Eerdere aankopen van de geselecteerde klant, gekoppeld aan catalogus-items
  // zodat een terugkerende klant zijn vaste bestelling met één tik herhaalt.
  const vorigeAankopen = useMemo(() => {
    if (!selectedKlant) return []
    const telling: Record<string, {key: string, count: number, last: string}> = {}
    for (const b of (bestellingen || [])) {
      if (b.status === 'geannuleerd') continue
      const live = resolveKlantSnapshot(b, klanten)
      if (live.klant_id !== selectedKlant.id) continue
      for (const r of (b.regels || [])) {
        if (r.type && r.type !== 'bier') continue
        if (!r.bier_naam || !r.verpakking_type) continue
        const key = `${r.bier_naam}|${r.verpakking_type}`
        if (!telling[key]) telling[key] = {key, count: 0, last: ''}
        telling[key].count += Number(r.aantal || 0)
        if (String(b.datum || '') > telling[key].last) telling[key].last = String(b.datum || '')
      }
    }
    return Object.values(telling)
      .map(v => ({...v, item: catalogus.find((c: any) => c.key === v.key)}))
      .filter(v => v.item)
      .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
      .slice(0, 6)
  }, [selectedKlant, bestellingen, klanten, catalogus])

  // ── Bon-bewerkingen ──────────────────────────────────────────────────────────

  const prijsVoorItem = (item: any): {prijs: number, prijsType: 'normaal' | 'b2b'} => {
    if (isZakelijk && item.b2bPrijs != null) return {prijs: item.b2bPrijs, prijsType: 'b2b'}
    return {prijs: item.prijs ?? 0, prijsType: 'normaal'}
  }

  // Merch blokkeert niet op nul: het shirt ligt fysiek op de toonbank, ook als
  // de teller achterloopt. De stand mag negatief worden en valt dan rood op in
  // de merch-lijst — dat is het signaal om te tellen of een inkoop te boeken.
  const maxVoorItem = (item: any): number =>
    item.merch ? Infinity : item.buitenAgp

  const addToCart = (item: any, aantal = 1) => {
    setLaatsteVerkoop(null)
    setCart(prev => {
      const bestaand = prev.find(r => r.key === item.key && r.type === (item.merch ? 'vrij' : 'bier'))
      const huidig = bestaand ? bestaand.aantal : 0
      const max = maxVoorItem(item)
      const nieuw = Math.min(huidig + aantal, max)
      if (nieuw <= huidig) {
        alert(t('err_pos_voorraad')
          .replace('{product}', `${item.bier_naam} ${item.verpakking_type}`)
          .replace('{beschikbaar}', String(max)))
        return prev
      }
      if (bestaand) return prev.map(r => r === bestaand ? {...r, aantal: nieuw} : r)
      const {prijs, prijsType} = prijsVoorItem(item)
      return [...prev, {
        key: item.key,
        type: item.merch ? 'vrij' : 'bier',
        bier_naam: item.bier_naam,
        verpakking_type: item.verpakking_type,
        aantal: nieuw,
        prijs_per_stuk: prijs,
        btw_pct: item.btw_pct,
        omschrijving: item.merch ? item.bier_naam : `${item.bier_naam} – ${item.verpakking_type}`,
        artikel_id: item.artikel_id,
        artikel_key: item.artikel_key,
        sku: item.sku,
        prijsType,
        ...(item.merch ? {merch_id: item.merch_id} : {}),
      }]
    })
  }

  const wijzigAantal = (idx: number, delta: number) => {
    setCart(prev => {
      const r = prev[idx]
      if (!r) return prev
      const item = catalogus.find((c: any) => c.key === r.key)
      const max = r.type === 'bier' && item ? maxVoorItem(item) : Infinity
      const nieuw = Math.min(Math.max(0, r.aantal + delta), max)
      if (nieuw === 0) return prev.filter((_, i) => i !== idx)
      return prev.map((x, i) => i === idx ? {...x, aantal: nieuw} : x)
    })
  }

  // Lege bon: eventuele bonkorting hoort niet stilletjes mee te gaan naar de
  // volgende verkoop.
  useEffect(() => {
    if (cart.length === 0) { setBonKorting(null); setKlantKortingBon(null) }
  }, [cart.length])

  // Klantwissel: herprijs bierregels (normaal ↔ B2B).
  const selectKlant = (id: number | null) => {
    setSelectedKlantId(id)
    setKlantKortingBon(null)
    setKlantZoek('')
    setLaatsteVerkoop(null)
    const k = id != null ? (klanten || []).find((x: any) => x.id === id) : null
    const zakelijk = !!k && (k.klant_type === 'zakelijk' || (!k.klant_type && String(k.bedrijf || '').trim() !== ''))
    setCart(prev => prev.map(r => {
      if (r.type !== 'bier') return r
      const item = catalogus.find((c: any) => c.key === r.key)
      if (!item) return r
      const b2b = zakelijk && item.b2bPrijs != null
      return {...r, prijs_per_stuk: b2b ? item.b2bPrijs : (item.prijs ?? 0), prijsType: b2b ? 'b2b' : 'normaal'}
    }))
  }

  const addVrijeRegel = () => {
    const oms = vrijeRegelForm.omschrijving.trim()
    if (!oms) { alert(t('err_vrije_regel_omschrijving')); return }
    setCart(prev => [...prev, {
      key: `vrij-${Date.now()}`,
      type: 'vrij',
      bier_naam: oms,
      verpakking_type: '',
      aantal: Number(vrijeRegelForm.aantal) || 1,
      prijs_per_stuk: Number(vrijeRegelForm.prijs_per_stuk) || 0,
      btw_pct: Number(vrijeRegelForm.btw_pct) || 0,
      omschrijving: oms,
    }])
    setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw)})
    setShowVrijeRegel(false)
  }

  const addKorting = () => {
    const waarde = Number(kortingForm.waarde)
    if (!(waarde > 0) || (kortingForm.soort === 'pct' && waarde > 100)) {
      alert(t('err_pos_korting_waarde'))
      return
    }
    setBonKorting({soort: kortingForm.soort as 'bedrag' | 'pct', waarde})
    setKortingForm({soort: 'bedrag', waarde: ''})
    setShowKorting(false)
  }

  // ── Totalen (incl. klantkorting en statiegeld, zoals de orderflow) ──────────

  const standaardKortingPct = Number(selectedKlant?.korting_pct || 0)
  const kortingPct = klantKortingBon ?? standaardKortingPct

  const pasKlantKortingToe = () => {
    const waarde = Number(String(klantKortingForm ?? '').replace(',', '.'))
    if (!Number.isFinite(waarde) || waarde < 0 || waarde > 100) {
      alert(t('err_pos_klantkorting_waarde'))
      return
    }
    setKlantKortingBon(waarde === standaardKortingPct ? null : waarde)
    setKlantKortingForm(null)
  }

  // Eén berekening voor scherm, afrekenknop, factuur en journaal: BTW per
  // regel afgerond, daarna cent-exact opgeteld (utils/kassa.ts). Anders pint de
  // klant een ander bedrag dan de factuur noemt.
  const bonTotalen = useMemo(
    () => kassaBonTotalen(cart, {kortingPct, bonKorting, verpakkingen: verpakkingen || []}),
    [cart, kortingPct, bonKorting, verpakkingen])

  // Factuurnummering: server-side via volgendFactuurNummer() (ERP-plan 0.2) —
  // de client nummert nooit zelf (races/hergebruik).

  // ── Afrekenen: bestelling + picks + uitlevering + factuur in één keer ────────
  // Een verkoop boekt geen accijns: het bier ligt al buiten de AGP en de
  // accijns is bij het uitslaan geboekt (utils/uitlevering.ts).

  // Dubbelklikgrendel. Tussen de klik en het sluiten van de modal zit een
  // netwerkronde (het factuurnummer); een tweede klik in dat venster draaide
  // dezelfde bon nog eens: twee facturen, twee journaalboekingen, dubbele
  // uitleveringen. De ref is de echte grendel — een tweede klik in dezelfde
  // tick ziet de state nog niet — en de state zet de knop uit. Na een
  // geslaagde verkoop blijft de grendel dicht tot de modal opnieuw opent: een
  // klik die nog vóór het sluiten binnenkomt, ziet anders de oude bon.
  const verwerkBezigRef = useRef(false)
  const [verwerkBezig, setVerwerkBezig] = useState(false)
  const openAfrekenen = () => {
    verwerkBezigRef.current = false
    setVerwerkBezig(false)
    setShowAfrekenen(true)
  }
  const verwerkVerkoop = async () => {
    if (verwerkBezigRef.current) return
    verwerkBezigRef.current = true
    setVerwerkBezig(true)
    let gelukt = false
    try {
      gelukt = (await voerVerkoopUit()) === true
    } finally {
      if (!gelukt) {
        verwerkBezigRef.current = false
        setVerwerkBezig(false)
      }
    }
  }

  const voerVerkoopUit = async (): Promise<boolean | undefined> => {
    if (!cart.length) { alert(t('err_pos_bon_leeg')); return }
    if (betaalwijze === 'rekening' && !selectedKlant) { alert(t('err_pos_rekening_klant')); return }
    const vandaag = tod()
    const klantNaam = selectedKlant?.naam || t('pos_walkin_naam')

    // 1. Voorraadvalidatie + FEFO-allocatie per bierregel. Lokale usage-map zodat
    //    meerdere bonregels die dezelfde afvulling raken niet dubbel alloceren.
    const gebruikt: Record<number, number> = {}
    const draftAllocaties: Array<{afvulling_id: number, batch_id: number, aantal: number, regelKey: string}> = []
    for (const r of cart) {
      if (r.type !== 'bier') continue
      const afvs = matchendeAfvullingen(r.bier_naam, r.verpakking_type, r.sku)
      let nodig = r.aantal
      for (const a of afvs) {
        if (nodig <= 0) break
        // Alleen vrije voorraad: wat nog in de AGP ligt, moet eerst uitgeslagen.
        const basis = Math.min(beschikbaarVoorAfvulling(a), beschikbaarBuitenAgpVoorAfvulling(a))
        const vrij = basis - (gebruikt[a.id] || 0)
        if (vrij <= 0) continue
        const pak = Math.min(nodig, vrij)
        gebruikt[a.id] = (gebruikt[a.id] || 0) + pak
        draftAllocaties.push({afvulling_id: a.id, batch_id: a.batch_id, aantal: pak, regelKey: r.key})
        nodig -= pak
      }
      if (nodig > 0) {
        const beschikbaar = r.aantal - nodig
        alert(t('err_verkoop_vrij_ontoereikend').replace('{beschikbaar}', `${beschikbaar}× ${r.verpakking_type || r.bier_naam}`))
        return
      }
    }

    // 2. Orderregels (bon + klantkorting), zelfde vorm als een handmatige order
    let regelId = 0
    const regels: any[] = cart.map(r => ({
      id: ++regelId,
      type: r.type,
      artikel_key: r.artikel_key ?? null,
      artikel_id: r.artikel_id ?? null,
      sku: r.sku ?? null,
      bier_naam: r.bier_naam,
      verpakking_type: r.verpakking_type,
      aantal: r.aantal,
      prijs_per_stuk: r.prijs_per_stuk,
      btw_pct: Number(r.btw_pct || 0),
      omschrijving: r.omschrijving,
      prijsType: r.prijsType || 'normaal',
      _key: r.key,
    }))
    for (const k of bonTotalen.kortingRegels) {
      const oms = t('lbl_korting_pct').replace('{pct}', String(kortingPct))
      regels.push({
        id: ++regelId,
        type: 'korting',
        bier_naam: oms,
        verpakking_type: '',
        aantal: 1,
        prijs_per_stuk: -k.bedrag,
        btw_pct: k.btw_pct,
        omschrijving: oms,
      })
    }
    for (const k of bonTotalen.bonKortingRegels) {
      const oms = bonKorting?.soort === 'pct'
        ? t('lbl_korting_pct').replace('{pct}', String(bonKorting.waarde))
        : t('pos_korting')
      regels.push({
        id: ++regelId,
        type: 'korting',
        bier_naam: oms,
        verpakking_type: '',
        aantal: 1,
        prijs_per_stuk: -k.bedrag,
        btw_pct: k.btw_pct,
        omschrijving: oms,
      })
    }

    // 3. Picks koppelen aan de zojuist toegewezen afvullingen
    const bestellingId = newId(bestellingen || [])
    let pickId = newId(bestellingPicks || [])
    const picks: any[] = draftAllocaties.map(alloc => ({
      id: pickId++,
      bestelling_id: bestellingId,
      regel_id: regels.find((rg: any) => rg._key === alloc.regelKey)?.id ?? 0,
      afvulling_id: alloc.afvulling_id,
      batch_id: alloc.batch_id,
      aantal: alloc.aantal,
      uitlevering_id: null,
      accijns_id: null,
    }))

    // 4. Uitleveringen uit vrije voorraad (de verkoop zelf, geen accijns)
    const {uitleveringen: nieuweUitleveringen, pickResult, tekort} = bouwVerkoopUitleveringen(
      picks,
      {type_uitlevering: 'binnenland', bestemming_naam: klantNaam, bestemming_land: 'NL'},
      {afvullingen: av || [], batches: bat || [], locaties: locaties || [], uit: uit || [],
        verplaatsingen: verplaatsingen || [], afboekingen: afboekingen || [], datum: vandaag},
      newId(uit || []),
    )
    if (tekort > 0) { alert(t('err_verkoop_vrij_tekort')); return }
    const picksMetIds = picks.map((p: any) => {
      const res = pickResult[p.id]
      if (!res) return p
      return {
        ...p,
        uitlevering_id: res.uitlevering_ids[0] || null,
        accijns_id: res.accijns_ids[0] || null,
        uitlevering_ids: res.uitlevering_ids,
        accijns_ids: res.accijns_ids,
      }
    })

    // 5. Factuurregels (incl. automatisch statiegeld) + BTW-overzicht.
    //    Nummer pas ná alle validaties ophalen zodat een afgebroken verkoop
    //    geen nummer verbruikt (gat in de reeks).
    let factuurNummer: string
    try { factuurNummer = await volgendFactuurNummer('factuur') }
    catch (e) { alert(t('err_factuurnummer_ophalen')); return }
    // De bedragen komen uit `bonTotalen` — dezelfde regels waarmee het scherm
    // het afrekenbedrag toont. `regels` staat in dezelfde volgorde (bon,
    // klantkorting, bonkorting); statiegeld komt daarachter.
    const regelsList: any[] = bonTotalen.geldRegels.map((g, i) => {
      const bedragen = {
        hoeveelheid: g.aantal,
        prijs_per_stuk: g.prijs_per_stuk,
        btw_pct: g.btw_pct,
        netto: g.netto,
        btw_bedrag: g.btw_bedrag,
        bruto: g.bruto,
      }
      if (g.bron === 'statiegeld') {
        const st = bonTotalen.statiegeldRegels[g.index]
        return {
          omschrijving: `${t(st.soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')} – ${st.vp.naam}`,
          ...bedragen,
          statiegeld_soort: st.soort,
          verpakking_id: st.vp.id,
        }
      }
      const r = regels[i]
      return {omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`, ...bedragen}
    })
    const btwTarievenLijst = [...new Set(regelsList.map((r: any) => Number(r.btw_pct || 0)))] as number[]
    const btw_overzicht = btwTarievenLijst.map(tarief => {
      const rv = regelsList.filter((r: any) => Number(r.btw_pct || 0) === tarief)
      return {
        tarief,
        netto: rnd2(rv.reduce((s: number, r: any) => s + r.netto, 0)),
        btw: rnd2(rv.reduce((s: number, r: any) => s + r.btw_bedrag, 0)),
      }
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const factuurTotalen = totaliseerRegels(regelsList)

    // 6. Bestelling (direct afgerond — kassaverkoop) + factuur
    const bestelling: any = {
      id: bestellingId,
      status: 'afgerond',
      datum: vandaag,
      klant_id: selectedKlant?.id ?? null,
      klant_naam: klantNaam,
      klant_email: selectedKlant?.email || '',
      klant_bedrijf: selectedKlant?.bedrijf || '',
      klant_straat: selectedKlant?.straat || '',
      klant_huisnummer: selectedKlant?.huisnummer || '',
      klant_postcode: selectedKlant?.postcode || '',
      klant_stad: selectedKlant?.stad || '',
      klant_type: isZakelijk ? 'zakelijk' : 'prive',
      regels: regels.map(({_key, ...r}: any) => r),
      opmerkingen: '',
      wc_order_id: null,
      wc_order_nummer: null,
      pos: true,
      pick_datum: vandaag,
      verzend_datum: vandaag,
      factuur_id: null,
      factuur_nummer: factuurNummer,
    }
    const snap = resolveKlantSnapshot(bestelling, klanten)
    const factuur: any = {
      id: newId(verkoopFacturen || []),
      datum: vandaag,
      factuurnummer: factuurNummer,
      bestelling_id: bestellingId,
      klant_id: snap.klant_id ?? null,
      klant_naam: snap.klant_naam || '',
      klant_bedrijf: snap.klant_bedrijf || '',
      klant_email: snap.klant_email || '',
      klant_straat: snap.klant_straat || '',
      klant_huisnummer: snap.klant_huisnummer || '',
      klant_postcode: snap.klant_postcode || '',
      klant_stad: snap.klant_stad || '',
      klant_btw_nummer: snap.klant_btw_nummer || '',
      klant_adres: [snap.klant_straat, snap.klant_huisnummer, snap.klant_postcode, snap.klant_stad].filter(Boolean).join(' '),
      regels: regelsList,
      btw_overzicht,
      netto: factuurTotalen.netto,
      btw: factuurTotalen.btw,
      bruto: factuurTotalen.bruto,
      netto_cent: factuurTotalen.netto_cent,
      btw_cent: factuurTotalen.btw_cent,
      bruto_cent: factuurTotalen.bruto_cent,
      status: betaalwijze === 'rekening' ? 'open' : 'betaald',
      definitief: true,
      betaalwijze,
      ...(betaalwijze !== 'rekening' ? {betaald_datum: vandaag} : {}),
    }
    bestelling.factuur_id = factuur.id

    // 7. State-updates + logboek + audit
    setBestellingen((prev: any[]) => [...(prev || []), bestelling])
    setBestellingPicks((prev: any[]) => [...(prev || []), ...picksMetIds])
    if (nieuweUitleveringen.length > 0) setUit((prev: any[]) => [...(prev || []), ...nieuweUitleveringen])
    setVerkoopFacturen((prev: any[]) => [...(prev || []), factuur])
    // Merch met eigen voorraad afboeken (bonregels met een merch-artikel).
    const merchMutaties = merchAfboekingenVoorRegels(cart, merchArtikelen, {datum: vandaag, referentie: factuurNummer})
    if (merchMutaties.length) {
      const geboekt = boekMerchMutaties(merchArtikelen, merchVoorraadLog, merchMutaties)
      setMerchArtikelen(geboekt.artikelen)
      setMerchVoorraadLog(geboekt.log)
    }
    // Journaal (ERP-plan 2.1): kassafactuur is direct definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(factuur)))
    setLog((prev: any[]) => {
      let logId = newId(prev || [])
      const entries = nieuweUitleveringen.map((u: any) => ({
        id: logId++,
        datum: vandaag,
        type: 'verkoop',
        batch_id: u.batch_id,
        batch_naam: u.batch_naam || '',
        afvulling_id: u.afvulling_id,
        verpakking_type: u.verpakking_type || u.verpakking_naam || '',
        hoeveelheid: u.aantal,
        eenheid: 'stuks',
        referentie: factuurNummer,
        omschrijving: `Kassa — ${klantNaam} — ${factuurNummer}`,
      }))
      return [...(prev || []), ...entries]
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: bestellingId,
      actie: 'aangemaakt',
      omschrijving: `Kassaverkoop — ${klantNaam}, factuur ${factuurNummer} (${nieuweUitleveringen.length} uitleveringen)`,
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verkoopfactuur',
      entiteit_id: factuur.id,
      actie: 'aangemaakt',
      omschrijving: `Kassa — ${factuurNummer} ${klantNaam} ${fmt(factuur.bruto)} (${betaalwijze})`,
    })

    setShowAfrekenen(false)
    setCart([])
    setBonKorting(null)
    setKlantKortingBon(null)
    setLaatsteVerkoop({bestelling, factuur})
    return true
  }

  const saveNieuweKlant = () => {
    const naam = nieuweKlantForm.naam.trim()
    if (!naam) { alert(t('err_pos_klant_naam')); return }
    const nieuw: any = {
      id: newId(klanten || []),
      klantnummer: nextKlantnummer(klanten || []),
      naam,
      klant_type: nieuweKlantForm.klant_type,
      email: nieuweKlantForm.email.trim(),
      telefoon: nieuweKlantForm.telefoon.trim(),
    }
    setKlanten((prev: any[]) => [...(prev || []), nieuw])
    logAudit(auditLog, setAuditLog, {entiteit: 'Klant', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Via kassa — ${naam}`})
    setShowNieuweKlant(false)
    setNieuweKlantForm({naam: '', klant_type: 'prive', email: '', telefoon: ''})
    selectKlant(nieuw.id)
  }

  const stats = selectedKlant ? klantStats[selectedKlant.id] : null

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t('nav_kassa')}
        rounded="full"
        info={<span>{fmtD(tod())}</span>}
      />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Linkerkolom: klant + producten ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Klant */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-500">{t('pos_klant')}</div>
              <Btn v="ghost" s="sm" onClick={() => setShowNieuweKlant(true)}>+ {t('klanten_new')}</Btn>
            </div>

            {selectedKlant ? (
              <div className="rounded-lg t-panel border t-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-800">{selectedKlant.naam}</span>
                  {selectedKlant.klantnummer && <span className="text-xs text-gray-400">#{selectedKlant.klantnummer}</span>}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isZakelijk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {isZakelijk ? t('lbl_zakelijk') : t('lbl_prive')}
                  </span>
                  {(standaardKortingPct > 0 || klantKortingBon != null) && (
                    // Klik = de klantkorting voor alleen deze bon aanpassen.
                    <button onClick={() => setKlantKortingForm(String(kortingPct))}
                      title={t('pos_klantkorting_aanpassen')}
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                      {t('lbl_korting_pct').replace('{pct}', String(kortingPct))}
                      {klantKortingBon != null && (
                        <span className="font-normal"> · {t('pos_klantkorting_standaard').replace('{pct}', String(standaardKortingPct))}</span>
                      )}
                      {' ✎'}
                    </button>
                  )}
                  {stats && stats.openstaand > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                      {t('pos_openstaand')}: {fmt(stats.openstaand)}
                    </span>
                  )}
                  <button onClick={() => selectKlant(null)}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-sm" title={t('btn_sluiten')}>✕</button>
                </div>
                {stats && (
                  <div className="text-xs text-gray-500 mt-1">
                    {t('pos_aankopen').replace('{n}', String(stats.count))}
                    {stats.last ? ` · ${t('pos_laatste_aankoop')}: ${fmtD(stats.last)}` : ''}
                  </div>
                )}
                {vorigeAankopen.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1.5">{t('pos_vorige_aankopen')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {vorigeAankopen.map(v => (
                        <button key={v.key} onClick={() => addToCart(v.item)}
                          disabled={maxVoorItem(v.item) <= 0}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          <span className="font-medium">{v.item.bier_naam}</span>
                          <span className="text-gray-400"> · {v.item.verpakking_type} · {v.count}×</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {recenteKlanten.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-400 mb-1.5">{t('pos_recente_klanten')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {recenteKlanten.map((k: any) => (
                        <button key={k.id} onClick={() => selectKlant(k.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                          <span className="font-medium">{k.naam}</span>
                          <span className="text-gray-400"> · {t('pos_aankopen').replace('{n}', String(klantStats[k.id]?.count || 0))}
                            {klantStats[k.id]?.last ? ` · ${fmtD(klantStats[k.id].last)}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="relative">
                  <SearchInput value={klantZoek} onChange={setKlantZoek} placeholder={t('pos_zoek_klant_ph')} />
                  {klantZoekResultaten.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {klantZoekResultaten.map((k: any) => (
                        <button key={k.id} onClick={() => selectKlant(k.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <span className="font-medium">{k.naam}</span>
                          {k.bedrijf && <span className="text-gray-400 text-xs">{k.bedrijf}</span>}
                          <span className="ml-auto text-xs text-gray-400">
                            {klantStats[k.id] ? t('pos_aankopen').replace('{n}', String(klantStats[k.id].count)) : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {klantZoek.trim() && klantZoekResultaten.length === 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
                      {t('pos_geen_klanten')}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400">{t('pos_walkin_hint')}</div>
              </>
            )}
          </div>

          {/* Producten */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-semibold text-gray-500 flex-shrink-0">{t('nav_producten')}</div>
              <div className="basis-full sm:basis-auto sm:flex-1">
                <SearchInput value={productZoek} onChange={setProductZoek} placeholder={t('pos_zoek_product_ph')} />
              </div>
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0 text-xs">
                {([[false, t('pos_prijs_excl')], [true, t('pos_prijs_incl')]] as Array<[boolean, string]>).map(([incl, l]) => (
                  <button key={String(incl)} onClick={() => setToonInclBtw(incl)}
                    className={`px-2 py-1 transition-colors ${toonInclBtw === incl
                      ? 't-panel font-semibold'
                      : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    style={toonInclBtw === incl ? {color: 'var(--t-accent)'} : undefined}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {aantalUitverkocht > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 select-none cursor-pointer">
                <input type="checkbox" className="t-checkbox" checked={toonUitverkocht}
                  onChange={e => setToonUitverkocht(e.target.checked)} />
                {t('pos_toon_uitverkocht').replace('{n}', String(aantalUitverkocht))}
              </label>
            )}
            {catalogusZichtbaar.length === 0 ? (
              <div className="text-sm text-gray-400 py-6 text-center">{t('pos_geen_producten')}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                {catalogusZichtbaar.map((item: any) => {
                  const max = maxVoorItem(item)
                  const inCart = cart.find(r => r.key === item.key)?.aantal || 0
                  const uitverkocht = max <= 0 || (item.merch && item.prijs == null)
                  const {prijs, prijsType} = prijsVoorItem(item)
                  const prijsToon = toonInclBtw ? rnd2(prijs * (1 + Number(item.btw_pct || 0) / 100)) : prijs
                  // De kassa verkoopt nooit rechtstreeks uit de AGP — voor geen
                  // enkele klant. Ligt er nog wat, dan biedt de kaart het
                  // uitslaan aan (eerst uitslaan, dan verkopen) in plaats van
                  // dood te staan.
                  const agpInfo = Number(item.agp || 0)
                  const kanUitslaan = agpInfo > 0 && !item.merch
                  // Op de grens of uitverkocht wordt tikken "uitslaan" in plaats van
                  // "op de bon" — zo hoef je de kassa niet te verlaten.
                  const tikUitslag = kanUitslaan && (uitverkocht || inCart >= max)
                  const dood = uitverkocht && !kanUitslaan
                  return (
                    <button key={item.key} onClick={() => tikUitslag ? openUitslag(item) : addToCart(item)} disabled={dood}
                      className={`relative text-left rounded-xl border p-3 transition-all duration-150 ${dood
                        ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                        : uitverkocht
                          ? 'border-orange-200 bg-orange-50 hover:shadow-md hover:-translate-y-px active:translate-y-0 cursor-pointer'
                          : 'border-gray-200 bg-white hover:shadow-md hover:-translate-y-px active:translate-y-0 cursor-pointer'}`}>
                      {inCart > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold shadow"
                          style={{backgroundColor: 'var(--t-accent)'}}>{inCart}</span>
                      )}
                      <div className="flex items-center gap-2">
                        {!item.merch && <BierKleur ebc={item.ebc} s="md" />}
                        <div className="font-semibold text-sm text-gray-800 leading-tight">{item.bier_naam}</div>
                      </div>
                      <div className="text-xs text-gray-400 mb-1.5">{item.verpakking_type}</div>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-bold text-sm" style={{color: 'var(--t-accent)'}}>
                          {item.prijs != null || (isZakelijk && item.b2bPrijs != null) ? fmt(prijsToon) : '—'}
                          {prijsType === 'b2b' && <span className="ml-1 text-[9px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded align-middle">B2B</span>}
                        </span>
                        {/* Merch heeft geen harde grens: de stand is informatief
                            (oranje bij nul of minder), bier blokkeert wél. */}
                        <span className={`text-xs ${
                          item.merch
                            ? (item.prijs == null ? 'text-red-500 font-medium' : Number(item.voorraad) <= 0 ? 'text-orange-500 font-medium' : 'text-gray-500')
                            : uitverkocht ? (kanUitslaan ? 'text-orange-600 font-medium' : 'text-red-500 font-medium') : 'text-gray-500'}`}>
                          {item.merch
                            ? (item.prijs == null ? t('pos_merch_geen_prijs') : `${item.voorraad} ${t('pos_voorraad')}`)
                            : uitverkocht ? (kanUitslaan ? t('pos_uitslaan_actie') : t('pos_geen_voorraad')) : `${max} ${t('pos_voorraad')}`}
                        </span>
                      </div>
                      {agpInfo > 0 && (
                        <div className={`text-xs mt-0.5 text-right ${kanUitslaan ? 'text-orange-600' : 'text-gray-500'}`}
                          title={t('pos_agp_info_tip').replace('{n}', String(agpInfo))}>
                          {t('pos_agp_info').replace('{n}', String(agpInfo))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Rechterkolom: bon ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-500">{t('pos_bon')}</div>
            <div className="flex gap-1">
              <Btn v="ghost" s="sm" onClick={() => setShowKorting(true)} disabled={cart.length === 0}>+ {t('pos_korting')}</Btn>
              <Btn v="ghost" s="sm" onClick={() => setShowVrijeRegel(true)}>+ {t('pos_vrije_regel')}</Btn>
            </div>
          </div>

          {laatsteVerkoop && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-2">
              <div className="font-semibold text-green-700 text-sm">✓ {t('pos_verkoop_gelukt')}</div>
              <div className="text-xs text-green-700">
                {laatsteVerkoop.factuur.factuurnummer} · {laatsteVerkoop.bestelling.klant_naam} · {fmt(laatsteVerkoop.factuur.bruto)}
              </div>
              <div className="flex gap-2">
                <Btn v="green" s="sm" onClick={() => printFactuur(laatsteVerkoop.bestelling, laatsteVerkoop.factuur, breweryMetTermijn(laatsteVerkoop.factuur, klanten, breweryDetails), appName, factuurLogo)}>
                  {t('pos_print_bon')}
                </Btn>
                <Btn v="secondary" s="sm" onClick={() => { setLaatsteVerkoop(null); selectKlant(null) }}>{t('pos_nieuwe_verkoop')}</Btn>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            !laatsteVerkoop && <div className="text-sm text-gray-400 py-8 text-center">{t('pos_bon_leeg')}</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cart.map((r, idx) => (
                <div key={`${r.key}-${idx}`} className="py-2 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-medium text-gray-800 leading-tight">
                      {r.bier_naam}
                      {r.verpakking_type && <span className="text-gray-400 font-normal"> · {r.verpakking_type}</span>}
                      {r.prijsType === 'b2b' && <span className="ml-1 text-[9px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded align-middle">B2B</span>}
                    </span>
                    <button onClick={() => setCart(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">✕</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                      <button onClick={() => wijzigAantal(idx, -1)} className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">−</button>
                      <span className="px-2 text-sm font-medium min-w-8 text-center">{r.aantal}</span>
                      <button onClick={() => wijzigAantal(idx, +1)} className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">+</button>
                    </div>
                    <span className="text-xs text-gray-400">×</span>
                    <span className="text-sm text-gray-600">{fmt(r.prijs_per_stuk)}</span>
                    <span className="text-[10px] text-gray-400">{r.btw_pct}%</span>
                    <span className="ml-auto text-sm font-semibold text-gray-700">{fmt(bonTotalen.geldRegels[idx]?.netto ?? r.aantal * r.prijs_per_stuk)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <>
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>{t('pos_subtotaal')}</span><span>{fmt(bonTotalen.nettoRegels)}</span>
                </div>
                {bonTotalen.kortingTotaal > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>{t('lbl_korting_pct').replace('{pct}', String(kortingPct))}</span>
                    <span>−{fmt(bonTotalen.kortingTotaal)}</span>
                  </div>
                )}
                {bonKorting && bonTotalen.bonKortingTotaal > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span className="flex items-center gap-1.5">
                      {bonKorting.soort === 'pct'
                        ? t('lbl_korting_pct').replace('{pct}', String(bonKorting.waarde))
                        : t('pos_korting')}
                      <button onClick={() => setBonKorting(null)}
                        className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </span>
                    <span>−{fmt(bonTotalen.bonKortingTotaal)}</span>
                  </div>
                )}
                {bonTotalen.statiegeldTotaal > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>{t('pos_statiegeld')}</span><span>{fmt(bonTotalen.statiegeldTotaal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>{t('pos_btw')}</span><span>{fmt(bonTotalen.btwTotaal)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg text-gray-800 pt-1">
                  <span>{t('pos_totaal')}</span><span>{fmt(bonTotalen.bruto)}</span>
                </div>
              </div>
              <Btn v="green" s="lg" cls="w-full text-base" onClick={openAfrekenen}>
                {t('pos_afrekenen')} · {fmt(bonTotalen.bruto)}
              </Btn>
            </>
          )}
        </div>
      </div>

      {/* ── Afreken-modal ── */}
      {showAfrekenen && (
        <Modal title={t('pos_afrekenen')} onClose={() => { if (!verwerkBezig) setShowAfrekenen(false) }}>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {selectedKlant ? selectedKlant.naam : t('pos_walkin_naam')}
              {' — '}{cart.reduce((s, r) => s + r.aantal, 0)}× · <span className="font-bold">{fmt(bonTotalen.bruto)}</span>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">{t('pos_betaalwijze')}</div>
              <div className="grid grid-cols-3 gap-2">
                {([['contant', t('pos_contant')], ['pin', t('pos_pin')], ['rekening', t('pos_op_rekening')]] as Array<[Betaalwijze, string]>).map(([w, l]) => (
                  <button key={w} onClick={() => setBetaalwijze(w)}
                    className={`px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${betaalwijze === w
                      ? 't-panel t-border font-semibold'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    style={betaalwijze === w ? {color: 'var(--t-accent)'} : undefined}>
                    {l}
                  </button>
                ))}
              </div>
              {betaalwijze === 'rekening' && !selectedKlant && (
                <div className="text-xs text-red-500 mt-2">{t('err_pos_rekening_klant')}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowAfrekenen(false)} disabled={verwerkBezig}>{t('btn_cancel')}</Btn>
              <Btn v="green" onClick={verwerkVerkoop} disabled={verwerkBezig || (betaalwijze === 'rekening' && !selectedKlant)}>
                {t('pos_bevestig_verkoop')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Nieuwe klant (snel) ── */}
      {showNieuweKlant && (
        <Modal title={t('klanten_new')} onClose={() => setShowNieuweKlant(false)}>
          <div className="space-y-3">
            <Inp label={t('lbl_naam')} value={nieuweKlantForm.naam} req
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, naam: v}))} />
            <Sel label={t('klanten_type')} value={nieuweKlantForm.klant_type}
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, klant_type: v || 'prive'}))}
              opts={[{v: 'prive', l: t('lbl_prive')}, {v: 'zakelijk', l: t('lbl_zakelijk')}]} />
            <div className="grid grid-cols-2 gap-3">
              <Inp label={t('lbl_email')} type="email" value={nieuweKlantForm.email}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, email: v}))} />
              <Inp label={t('lbl_telefoon')} value={nieuweKlantForm.telefoon}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, telefoon: v}))} />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowNieuweKlant(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveNieuweKlant}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Korting ── */}
      {klantKortingForm != null && (
        <Modal title={t('pos_klantkorting_titel')} onClose={() => setKlantKortingForm(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('pos_klantkorting_uitleg').replace('{pct}', String(standaardKortingPct))}
            </p>
            <Inp label={t('pos_korting_soort_pct')} type="number" step="0.01" min="0" max="100"
              value={klantKortingForm} onChange={(v: string) => setKlantKortingForm(v)} />
            <div className="flex flex-wrap justify-end gap-2 pt-3 border-t">
              {klantKortingBon != null && (
                <Btn v="secondary" onClick={() => { setKlantKortingBon(null); setKlantKortingForm(null) }}>
                  {t('pos_klantkorting_herstel').replace('{pct}', String(standaardKortingPct))}
                </Btn>
              )}
              <Btn v="secondary" onClick={() => setKlantKortingForm(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={pasKlantKortingToe}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showKorting && (
        <Modal title={t('pos_korting')} onClose={() => setShowKorting(false)}>
          <div className="space-y-3">
            <Sel label={t('pos_korting_soort')} value={kortingForm.soort}
              onChange={(v: string) => setKortingForm(f => ({...f, soort: v || 'bedrag'}))}
              opts={[{v: 'bedrag', l: t('pos_korting_soort_bedrag')}, {v: 'pct', l: t('pos_korting_soort_pct')}]} />
            <Inp label={kortingForm.soort === 'pct' ? t('pos_korting_soort_pct') : t('pos_korting_soort_bedrag')}
              type="number" step="0.01" value={kortingForm.waarde} req
              onChange={(v: string) => setKortingForm(f => ({...f, waarde: v}))} />
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowKorting(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={addKorting}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Vrije regel ── */}
      {showVrijeRegel && (
        <Modal title={t('pos_vrije_regel')} onClose={() => setShowVrijeRegel(false)}>
          <div className="space-y-3">
            <Inp label={t('lbl_description')} value={vrijeRegelForm.omschrijving} req
              onChange={(v: string) => setVrijeRegelForm(f => ({...f, omschrijving: v}))} />
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('manual_order_qty')} type="number" value={vrijeRegelForm.aantal}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, aantal: v}))} />
              <Inp label={t('manual_order_price')} type="number" step="0.01" value={vrijeRegelForm.prijs_per_stuk}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, prijs_per_stuk: v}))} />
              <Sel label={t('manual_order_btw')} value={vrijeRegelForm.btw_pct}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, btw_pct: v}))}
                opts={[{v: '0', l: '0%'}, {v: '9', l: '9%'}, {v: '21', l: '21%'}]} />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowVrijeRegel(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={addVrijeRegel}>{t('manual_order_add_line')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Uitslaan uit de AGP: dezelfde modal en dezelfde boeking als de
          productpagina, maar zonder de kassa te verlaten. */}
      {uitslagItem && (
        <UitslagModal
          productNaam={`${uitslagItem.bier_naam} \u2014 ${uitslagItem.verpakking_type}`}
          afvullingen={matchendeAfvullingen(uitslagItem.bier_naam, uitslagItem.verpakking_type, uitslagItem.sku)}
          batches={bat || []}
          locaties={locaties}
          uit={uit}
          verplaatsingen={verplaatsingen}
          afboekingen={afboekingen}
          accijnsInst={accijnsInst}
          accijnsAangiftes={accijnsAangiftes || []}
          gereserveerd={agpGereserveerdPerAfvulling(
            bestellingPicks || [], bestellingen || [], getAgpLocatie(locaties as any).id,
            {afvullingen: av || [], locaties: locaties || [], uit, verplaatsingen, afboekingen})}
          onClose={() => setUitslagItem(null)}
          onOpslaan={saveUitslag}
        />
      )}
    </div>
  )
}

export default KassaPage
