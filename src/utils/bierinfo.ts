// Bierinformatie — de eigenschappen van een bier en van een verpakking.
//
// Dit is géén webshopmodule. Het ABV, de kleur, de ingrediënten, het
// smaakprofiel, de serveertip: dat is gewoon informatie over het bier, die je
// in de administratie bijhoudt en op meerdere plekken gebruikt — op een
// etiket, in een verkoopgesprek, en onder meer in de webshop. Vandaar dat ze
// als **gewone velden op het product en het artikel** staan, net als de naam
// en de stijl, en niet als losse "webshopvelden".
//
// Wat dit bestand levert:
//  1. de velddefinities (label, soort, groep, niveau) zodat elk formulier ze
//     op dezelfde manier toont;
//  2. welke velden de app zélf afleidt uit andere gegevens (ABV/IBU/EBC/stijl
//     staan al bij het product, de inhoud bij de verpakking, de
//     ingrediëntenlijst volgt uit het recept) — die vul je nergens apart in;
//  3. de vertaling naar en van het webshopthema (`utils/craftery.ts`).
//
// De waarden staan altijd in de notatie waarin je ze wilt tónen ("7,1%",
// "33cl"), want zo gaan ze ook naar een etiket of een webshop.

export type BierVeldSoort = 'tekst' | 'lang' | 'getal' | 'schuif' | 'keuze' | 'ja_nee' | 'regels'

/**
 * Hoort de eigenschap bij het bier of bij deze verpakking?
 *
 * `product` = van het bier zelf (ABV, stijl, smaakprofiel): één keer invullen,
 * elke verpakking erft hem. `artikel` = van dít artikel, dus deze fles, dit
 * fust of dit pakket (inhoud, badge, levering).
 */
export type BierNiveau = 'product' | 'artikel'

/** Eén label/waarde-regel, voor vrije extra eigenschappen. */
export interface BierRegel { label: string; value: string }

export interface BierVeld {
  /** Veldnaam op het product resp. het artikel, bijv. `serveertip`. */
  veld: string
  niveau: BierNiveau
  soort: BierVeldSoort
  /** i18n-sleutel van het label. */
  label: string
  /** i18n-sleutel van de uitleg bij het veld. */
  tip?: string
  /** Groep waarin het veld getoond wordt (i18n-sleutel). */
  groep: string
  /** Keuzewaarden bij `soort: 'keuze'`: waarde + i18n-label. */
  opties?: {v: string, l: string}[]
  placeholder?: string
  /**
   * De app leidt dit veld af uit andere gegevens en bewaart het niet apart.
   * Je wijzigt het op zijn eigen plek (de productgegevens, de verpakking, het
   * recept) — daarom is het nergens een invulveld.
   */
  afgeleid?: boolean
}

export const BIER_VELDEN: BierVeld[] = [
  // ── Kerngetallen ────────────────────────────────────────────────────────
  // ABV, IBU, EBC en de stijl staan al in de productgegevens; de inhoud komt
  // van de verpakking. Ze staan hier omdat ze bij de bierinformatie horen,
  // maar je vult ze bij het product resp. de verpakking in.
  {veld: 'abv',    niveau: 'product', afgeleid: true, soort: 'tekst', label: 'bier_veld_abv',    groep: 'bier_groep_kern'},
  {veld: 'ibu',    niveau: 'product', afgeleid: true, soort: 'tekst', label: 'bier_veld_ibu',    groep: 'bier_groep_kern'},
  {veld: 'ebc',    niveau: 'product', afgeleid: true, soort: 'tekst', label: 'bier_veld_ebc',    groep: 'bier_groep_kern'},
  {veld: 'stijl',  niveau: 'product', afgeleid: true, soort: 'tekst', label: 'bier_veld_stijl',  groep: 'bier_groep_kern'},
  {veld: 'inhoud', niveau: 'artikel', afgeleid: true, soort: 'tekst', label: 'bier_veld_inhoud', groep: 'bier_groep_kern'},
  {veld: 'kcal',   niveau: 'product', soort: 'tekst', label: 'bier_veld_kcal', groep: 'bier_groep_kern', placeholder: '67'},

  // ── Wat erin zit en hoe je het drinkt ───────────────────────────────────
  {veld: 'ingredienten', niveau: 'product', soort: 'lang', label: 'bier_veld_ingredienten',
    tip: 'bier_tip_ingredienten', groep: 'bier_groep_inhoud', placeholder: 'water, gerstemout, hop, gist'},
  {veld: 'smaakprofiel', niveau: 'product', soort: 'lang', label: 'bier_veld_smaakprofiel', groep: 'bier_groep_inhoud'},
  {veld: 'serveertip',   niveau: 'product', soort: 'lang', label: 'bier_veld_serveertip',
    groep: 'bier_groep_inhoud', placeholder: '6–8 °C · tulpglas'},

  // ── Smaakprofiel in cijfers (0–100) ─────────────────────────────────────
  {veld: 'smaak_fruit',  niveau: 'product', soort: 'schuif', label: 'bier_veld_smaak_fruit',  tip: 'bier_tip_smaakassen', groep: 'bier_groep_smaak'},
  {veld: 'smaak_body',   niveau: 'product', soort: 'schuif', label: 'bier_veld_smaak_body',   groep: 'bier_groep_smaak'},
  {veld: 'smaak_bitter', niveau: 'product', soort: 'schuif', label: 'bier_veld_smaak_bitter', groep: 'bier_groep_smaak'},
  {veld: 'smaak_zoet',   niveau: 'product', soort: 'schuif', label: 'bier_veld_smaak_zoet',   groep: 'bier_groep_smaak'},
  {veld: 'smaak_droog',  niveau: 'product', soort: 'schuif', label: 'bier_veld_smaak_droog',  groep: 'bier_groep_smaak'},

  // ── Waardering ──────────────────────────────────────────────────────────
  {veld: 'untappd_score',  niveau: 'product', soort: 'tekst', label: 'bier_veld_untappd_score', groep: 'bier_groep_untappd', placeholder: '4,75'},
  {veld: 'untappd_aantal', niveau: 'product', soort: 'getal', label: 'bier_veld_untappd_aantal', tip: 'bier_tip_untappd_aantal', groep: 'bier_groep_untappd'},
  {veld: 'untappd_url',    niveau: 'product', soort: 'tekst', label: 'bier_veld_untappd_url',    groep: 'bier_groep_untappd', placeholder: 'https://untappd.com/b/…'},

  // ── Uit roulatie ────────────────────────────────────────────────────────
  {veld: 'uit_roulatie', niveau: 'product', soort: 'ja_nee', label: 'bier_veld_uit_roulatie', tip: 'bier_tip_uit_roulatie', groep: 'bier_groep_roulatie'},
  {veld: 'opvolger',     niveau: 'product', soort: 'tekst',  label: 'bier_veld_opvolger',     tip: 'bier_tip_opvolger', groep: 'bier_groep_roulatie'},

  // ── Vrije extra eigenschappen ───────────────────────────────────────────
  {veld: 'extra_specs',   niveau: 'product', soort: 'regels', label: 'bier_veld_extra_specs',   tip: 'bier_tip_extra_specs',   groep: 'bier_groep_extra'},
  {veld: 'extra_blokken', niveau: 'product', soort: 'regels', label: 'bier_veld_extra_blokken', tip: 'bier_tip_extra_blokken', groep: 'bier_groep_extra'},

  // ── Per verpakking ──────────────────────────────────────────────────────
  {veld: 'tag',            niveau: 'artikel', soort: 'tekst', label: 'bier_veld_tag', tip: 'bier_tip_tag', groep: 'bier_groep_verpakking', placeholder: 'S–XXL of ×7'},
  {veld: 'pakket_inhoud',  niveau: 'artikel', soort: 'lang',  label: 'bier_veld_pakket_inhoud', tip: 'bier_tip_pakket_inhoud', groep: 'bier_groep_verpakking'},
  {veld: 'badge',          niveau: 'artikel', soort: 'tekst', label: 'bier_veld_badge', tip: 'bier_tip_badge', groep: 'bier_groep_verpakking', placeholder: 'Bestseller'},
  {veld: 'levering',       niveau: 'artikel', soort: 'keuze', label: 'bier_veld_levering', tip: 'bier_tip_levering', groep: 'bier_groep_verpakking', opties: [
    {v: 'beide',     l: 'bier_lev_beide'},
    {v: 'verzenden', l: 'bier_lev_verzenden'},
    {v: 'afhalen',   l: 'bier_lev_afhalen'},
  ]},
]

/** De velden van één niveau, in de volgorde van de definitie. */
export const bierVelden = (niveau: BierNiveau): BierVeld[] =>
  BIER_VELDEN.filter(v => v.niveau === niveau)

/** De velden die je zelf invult — de afgeleide vallen hierbuiten. */
export const bierInvulVelden = (niveau: BierNiveau): BierVeld[] =>
  bierVelden(niveau).filter(v => !v.afgeleid)

/** De groepen in de volgorde waarin ze getoond worden. */
export const BIER_GROEPEN: string[] = BIER_VELDEN.reduce((lijst: string[], v) =>
  lijst.includes(v.groep) ? lijst : [...lijst, v.groep], [])

const getal = (x: any): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Komma als decimaalteken — zo lees je het op een etiket en in de winkel. */
const nlGetal = (n: number, decimalen: number): string =>
  n.toFixed(decimalen).replace('.', ',')

/**
 * De inhoud van een verpakking zoals je hem noemt: onder een liter in
 * centiliters ("33cl", "75cl"), daarboven in liters ("20L").
 */
export const bierInhoud = (liter: any): string => {
  const l = getal(liter)
  if (l === null || l <= 0) return ''
  if (l < 1) {
    const cl = l * 100
    return `${Number.isInteger(cl) ? cl : Number(cl.toFixed(1))}cl`
  }
  return `${Number.isInteger(l) ? l : Number(l.toFixed(2))}L`
}

/**
 * De ingrediëntenlijst zoals hij op een etiket hoort: water, de graansoorten
 * die erin zitten, hop en gist. Afgeleid uit de gekoppelde recepten —
 * merknamen ("Cara 50", "Citra") zeggen een klant niets en horen er niet in;
 * de graansoort wel, want die bepaalt ook de allergenen.
 */
export function bierIngredienten(recepten?: any[] | null): string {
  const lijst = (recepten || []).filter(Boolean)
  if (!lijst.length) return ''

  const graanSoorten: {toets: RegExp, label: string}[] = [
    {toets: /tarwe|wheat|weizen|froment/i, label: 'tarwemout'},
    {toets: /rogge|\brye\b|roggen/i,       label: 'roggemout'},
    {toets: /haver|\boat/i,                label: 'havermout'},
    {toets: /spelt|dinkel/i,               label: 'speltmout'},
  ]

  const granen: string[] = []
  let heeftGerst = false, heeftHop = false, heeftGist = false

  for (const r of lijst) {
    for (const m of (r.mout || [])) {
      const naam = String(m?.naam || '')
      const bijzonder = graanSoorten.find(g => g.toets.test(naam))
      if (bijzonder) {
        if (!granen.includes(bijzonder.label)) granen.push(bijzonder.label)
      } else if (naam.trim()) {
        // Alles wat geen andere graansoort noemt is in de praktijk gerst.
        heeftGerst = true
      }
    }
    if ((r.hop || []).length) heeftHop = true
    if ((r.gist || []).length) heeftGist = true
  }

  const delen = ['water']
  if (heeftGerst) delen.push('gerstemout')
  delen.push(...granen)
  if (heeftHop) delen.push('hop')
  if (heeftGist) delen.push('gist')

  // Alleen water is geen ingrediëntenlijst — dan weet de app het gewoon niet.
  return delen.length > 1 ? delen.join(', ') : ''
}

export interface BierInfoBron {
  /** Het product met zijn eigen velden (naam, stijl, abv, ebc, ibu, …). */
  product?: Record<string, any> | null
  /** Het artikel (verpakking/SKU) met zijn eigen velden. */
  artikel?: Record<string, any> | null
  /** Inhoud van de verpakking in liters — bepaalt het inhoud-veld. */
  inhoudLiter?: any
  /** De gekoppelde recepten — bepalen de ingrediëntenlijst. */
  recepten?: any[] | null
}

/**
 * De velden die de app zelf afleidt, in de notatie waarin ze getoond worden.
 * Alleen wat de administratie écht weet komt terug; er wordt niets verzonnen.
 */
export function afgeleideBierInfo(bron: BierInfoBron): Record<string, string> {
  const p = bron.product || {}
  const uit: Record<string, string> = {}

  const abv = getal(p.abv)
  if (abv !== null && abv > 0) uit.abv = `${nlGetal(abv, 1)}%`

  const ibu = getal(p.ibu)
  if (ibu !== null && ibu > 0) uit.ibu = String(Math.round(ibu))

  const ebc = getal(p.ebc)
  if (ebc !== null && ebc > 0) uit.ebc = String(Math.round(ebc))

  const stijl = String(p.stijl || '').trim()
  if (stijl) uit.stijl = stijl

  const inhoud = bierInhoud(bron.inhoudLiter)
  if (inhoud) uit.inhoud = inhoud

  // De ingrediëntenlijst is afgeleid én overschrijfbaar: staat er een eigen
  // tekst bij het product, dan wint die.
  const ingredienten = bierIngredienten(bron.recepten)
  if (ingredienten) uit.ingredienten = ingredienten

  return uit
}

const leeg = (w: any): boolean =>
  w === undefined || w === null ||
  (Array.isArray(w) ? w.length === 0 : String(w).trim() === '')

/**
 * Alle bierinformatie van één artikel op een rij: eerst wat de app afleidt,
 * dan wat bij het bier is ingevuld, dan wat bij deze verpakking staat. Een
 * latere laag wint alleen met een ingevulde waarde, zodat een leeg veld nooit
 * iets wegdrukt.
 */
export function bierInfoVoorArtikel(bron: BierInfoBron): Record<string, any> {
  const uit: Record<string, any> = {}
  const velden = new Set(BIER_VELDEN.map(v => v.veld))
  // Een afgeleid veld komt uitsluitend uit `afgeleideBierInfo`: daar staat het
  // in de juiste notatie ("7,1%"), terwijl het product het rauwe getal (7.14)
  // bewaart. De rauwe waarde mag de nette dus niet overschrijven.
  const afgeleid = new Set(BIER_VELDEN.filter(v => v.afgeleid).map(v => v.veld))

  const voegToe = (bronObject: Record<string, any> | null | undefined) => {
    for (const [veld, waarde] of Object.entries(bronObject || {})) {
      if (!velden.has(veld) || afgeleid.has(veld) || leeg(waarde)) continue
      uit[veld] = waarde
    }
  }

  Object.assign(uit, afgeleideBierInfo(bron))
  voegToe(bron.product)
  voegToe(bron.artikel)

  // Een schakelaar die uit staat is een waarde, geen leeg veld.
  if (typeof bron.product?.uit_roulatie === 'boolean') uit.uit_roulatie = bron.product.uit_roulatie
  return uit
}
