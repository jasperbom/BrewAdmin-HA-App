/**
 * factuurTemplate.ts — de factuurlayout als data.
 *
 * De layout stond hardgecodeerd in `PakbonExport.tsx`; elke wens ("logo groter",
 * "kolom eruit", "eigen voettekst") vroeg een release. De layout is nu een
 * template met placeholders, met een standaard die byte-voor-byte hetzelfde
 * document oplevert als voorheen. Een eigen versie komt in
 * `brewery_details.factuur_template` (`{html, css}`) en wordt bij een fout stil
 * genegeerd — een factuur moet altijd uit te printen zijn.
 *
 * Alle labels komen als contextwaarde binnen (`{{lbl_…}}`), nooit als letterlijke
 * tekst in de template: een eigen layout blijft daardoor meertalig.
 *
 * Zie `template.ts` voor de ondersteunde tags.
 */

import { t } from '../i18n'
import { fmtQty, fmtEuroDoc, fmtDatumDoc } from './format'
import type { TemplateContext } from './template'

/** Standaard-CSS van het factuurdocument. */
export const FACTUUR_CSS_DEFAULT = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #222; background: #fff; }
  .page { max-width: 210mm; margin: 0 auto; padding: 14mm 16mm 12mm; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8mm; }
  .hdr-left { display: flex; align-items: center; gap: 5mm; }
  .hdr-right { text-align: right; }
  .logo { max-height: 18mm; max-width: 45mm; object-fit: contain; }
  .bi-naam { font-size: 14pt; font-weight: bold; color: #111; margin-bottom: 2px; }
  .bi-info { font-size: 9pt; color: #555; line-height: 1.65; margin-top: 1mm; }
  .doc-title { font-size: 22pt; font-weight: bold; color: #111; letter-spacing: 1px; margin-bottom: 1mm; }
  .doc-nr { font-size: 11pt; font-weight: bold; color: #333; }
  .hdr-party { margin-top: 5mm; text-align: right; }
  .hdr-party .party-label { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 1mm; }
  .hdr-party .kn { font-size: 9.5pt; font-weight: bold; color: #111; margin-bottom: 1px; }
  .hdr-party p { font-size: 9pt; line-height: 1.5; color: #444; }
  .meta-grid { display: flex; column-gap: 12mm; row-gap: 3.5mm; flex-wrap: wrap; margin-bottom: 6mm; }
  .meta-block .ml { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 1px; }
  .meta-block .mv { font-size: 10pt; font-weight: 500; color: #222; }
  .kn { font-weight: bold; font-size: 12pt; margin-bottom: 3px; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 5mm; }
  th { background: #f3f4f6; color: #374151; padding: 5px 6px; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; }
  th.r { text-align: right; }
  td { padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  td.r { text-align: right; }
  tbody tr + tr td { border-top: 1px solid #f0f0f0; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 5mm; }
  .totals-block { width: 70mm; font-size: 10pt; }
  .totals-row { display: flex; justify-content: space-between; padding: 2px 5px; }
  .totals-sep { height: 1px; background: #d1d5db; margin: 1.5mm 5px 0; }
  .totals-row.grand-total { font-weight: bold; font-size: 12pt; padding-top: 1.5mm; }
  .btw-section { display: flex; justify-content: flex-end; margin-bottom: 4mm; }
  .btw-table { width: auto; min-width: 80mm; margin: 0; }
  .btw-table th, .btw-table td { font-size: 9pt; padding: 3px 5px; }
  .pay-block { background: #f0f7ff; border: 1px solid #cce5ff; padding: 3mm 4mm; border-radius: 3px; font-size: 8.5pt; line-height: 1.55; }
  .pay-block .pay-title { font-weight: bold; font-size: 9.5pt; margin-bottom: 1.5px; }
  .badge { display: inline-block; padding: 0.5mm 2mm; border-radius: 2mm; font-size: 8pt; font-weight: bold; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .remarks { margin-top: 3mm; font-size: 9pt; color: #555; border-left: 2px solid #ddd; padding-left: 3mm; }
  .qr-block { margin-top: 4mm; display: flex; align-items: center; gap: 5mm; border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm 4mm; }
  .qr-block img { width: 26mm; height: 26mm; flex: 0 0 auto; display: block; }
  .qr-text { font-size: 9pt; line-height: 1.5; color: #374151; }
  .qr-title { font-weight: bold; color: #92400e; font-size: 10.5pt; margin-bottom: 1mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 0; }
  }
`

/** Standaardlayout van de factuur. */
export const FACTUUR_HTML_DEFAULT = `<div class="page">
  <div class="hdr">
    <div class="hdr-left">
      {{#logo}}<img src="{{logo}}" class="logo" alt="logo" />{{/logo}}
      <div>
        <div class="bi-naam">{{brouwerij_naam}}</div>
        {{#heeft_brouwerij_info}}<div class="bi-info">{{#brouwerij_info}}<div>{{regel}}</div>{{/brouwerij_info}}</div>{{/heeft_brouwerij_info}}
      </div>
    </div>
    <div class="hdr-right">
      <div class="doc-title">{{doc_titel}}</div>
      <div class="doc-nr">{{factuurnummer}}</div>
      {{#is_betaald}}<div style="margin-top:2mm"><span class="badge badge-green">✓ {{lbl_betaald}}</span></div>{{/is_betaald}}
      <div class="hdr-party">
        <div class="party-label">{{lbl_factuuradres}}</div>
        <div class="kn">{{klant_titel}}</div>{{#klant_regels}}<p>{{regel}}</p>{{/klant_regels}}
      </div>
    </div>
  </div>

  <div class="meta-grid">
    {{#meta}}<div class="meta-block"><div class="ml">{{label}}</div><div class="mv">{{waarde}}</div></div>{{/meta}}
  </div>

  <table>
    <thead>
      <tr>
        <th>{{lbl_kol_omschrijving}}</th>
        <th class="r">{{lbl_kol_aantal}}</th>
        <th class="r">{{lbl_kol_prijs}}</th>
        <th class="r">{{lbl_kol_btw_pct}}</th>
        <th class="r">{{lbl_kol_excl_btw}}</th>
        <th class="r">{{lbl_btw}}</th>
        <th class="r">{{lbl_kol_incl_btw}}</th>
      </tr>
    </thead>
    <tbody>
      {{#regels}}<tr>
        <td>{{omschrijving}}</td>
        <td class="r">{{aantal}}</td>
        <td class="r">{{prijs}}</td>
        <td class="r">{{btw_pct}}%</td>
        <td class="r">{{netto}}</td>
        <td class="r">{{btw}}</td>
        <td class="r">{{bruto}}</td>
      </tr>{{/regels}}
      {{^regels}}<tr><td colspan="7" style="text-align:center;color:#888;padding:4mm;">{{lbl_geen_regels}}</td></tr>{{/regels}}
    </tbody>
  </table>

  {{#heeft_btw_overzicht}}<div class="btw-section">
    <table class="btw-table">
      <thead>
        <tr>
          <th>{{lbl_btw_tarief}}</th>
          <th class="r">{{lbl_kol_excl_btw}}</th>
          <th class="r">{{lbl_btw}}</th>
          <th class="r">{{lbl_kol_incl_btw}}</th>
        </tr>
      </thead>
      <tbody>
        {{#btw_overzicht}}<tr>
          <td>{{lbl_btw}} {{tarief}}%</td>
          <td class="r">{{netto}}</td>
          <td class="r">{{btw}}</td>
          <td class="r">{{totaal}}</td>
        </tr>{{/btw_overzicht}}
      </tbody>
    </table>
  </div>{{/heeft_btw_overzicht}}

  <div class="totals">
    <div class="totals-block">
      <div class="totals-row"><span>{{lbl_subtotaal_excl}}</span><span>{{totaal_netto}}</span></div>
      <div class="totals-row"><span>{{lbl_btw}}</span><span>{{totaal_btw}}</span></div>
      <div class="totals-sep"></div>
      <div class="totals-row grand-total"><span>{{lbl_totaal_incl}}</span><span>{{totaal_bruto}}</span></div>
    </div>
  </div>

  {{#toon_betaalblok}}<div class="pay-block">
    <div class="pay-title">{{lbl_betaalinformatie}}</div>
    {{#iban}}<div>{{lbl_iban}}: <strong>{{iban}}</strong>{{#brouwerij_naam}} &nbsp;{{lbl_tnv}} {{brouwerij_naam}}{{/brouwerij_naam}}</div>{{/iban}}
    <div>{{lbl_bedrag_kort}}: <strong>{{totaal_bruto}}</strong> &nbsp;·&nbsp; {{lbl_vervaldatum_kort}}: <strong>{{vervaldatum}}</strong></div>
    <div>{{lbl_ovv_factuurnummer}} <strong>{{factuurnummer}}</strong></div>
  </div>{{/toon_betaalblok}}

  {{#qr}}<div class="qr-block">
    <img src="{{qr}}" alt="QR" />
    <div class="qr-text">
      <div class="qr-title">{{lbl_online_betalen}}</div>
      <div>{{lbl_scan_qr}}</div>
    </div>
  </div>{{/qr}}

  {{#opmerking}}<div class="remarks" style="margin-top:3mm;"><strong>{{lbl_opmerking}}:</strong> {{opmerking}}</div>{{/opmerking}}
</div>`

/** Placeholders die de template-editor als naslag toont. */
export const FACTUUR_TEMPLATE_VELDEN: readonly string[] = [
  'logo', 'brouwerij_naam', 'brouwerij_info[].regel', 'doc_titel', 'factuurnummer',
  'is_betaald', 'klant_titel', 'klant_regels[].regel', 'meta[].label', 'meta[].waarde',
  'regels[].omschrijving', 'regels[].aantal', 'regels[].prijs', 'regels[].btw_pct',
  'regels[].netto', 'regels[].btw', 'regels[].bruto',
  'btw_overzicht[].tarief', 'btw_overzicht[].netto', 'btw_overzicht[].btw', 'btw_overzicht[].totaal',
  'totaal_netto', 'totaal_btw', 'totaal_bruto',
  'toon_betaalblok', 'iban', 'factuurdatum', 'vervaldatum', 'betalingstermijn',
  'qr', 'opmerking',
]

// ── Context ───────────────────────────────────────────────────────────────

export interface FactuurTemplateBronnen {
  /** De bestelling/klantsnapshot (`klant_*`-velden, `opmerkingen`, orderrefs). */
  order: any
  factuur: any
  /** `brewery_details`, inclusief `factuur_velden` en `factuur_template`. */
  brewery: any
  appName: string
  factuurLogo?: string | null
  payInfo?: {url: string, qrDataUrl?: string} | null
}

/** Vult het BTW-overzicht aan uit de regels als het niet is opgeslagen. */
const btwOverzichtVan = (factuur: any): any[] => {
  const opgeslagen = factuur?.btw_overzicht
  if (Array.isArray(opgeslagen) && opgeslagen.length > 0) return opgeslagen
  const map: Record<number, {tarief: number, netto: number, btw: number}> = {}
  for (const r of (factuur?.regels || [])) {
    const pct = r.btw_pct ?? 0
    if (!map[pct]) map[pct] = {tarief: pct, netto: 0, btw: 0}
    map[pct].netto += r.netto || 0
    map[pct].btw += r.btw_bedrag || 0
  }
  return Object.values(map).sort((a, b) => a.tarief - b.tarief)
}

/** Adres-/contactregels van de brouwerij, met de `factuur_velden`-schakelaars. */
const brouwerijRegels = (brewery: any): string[] => {
  const fv = brewery?.factuur_velden || {}
  const straat = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  return [
    fv.adres !== false ? straat : '',
    fv.adres !== false ? plaats : '',
    fv.btw_nummer !== false && brewery?.btw_nummer ? `${t('lbl_btw')}: ${brewery.btw_nummer}` : '',
    fv.kvk_nummer !== false && brewery?.kvk_nummer ? `${t('lbl_kvk_kort')}: ${brewery.kvk_nummer}` : '',
    fv.iban !== false && brewery?.iban ? `${t('lbl_iban')}: ${brewery.iban}` : '',
    fv.email !== false ? (brewery?.email || '') : '',
    fv.telefoon !== false ? (brewery?.telefoon || '') : '',
  ].filter(Boolean)
}

/** Adresregels van de afnemer; de eerste regel is de kop van het adresblok. */
const klantRegels = (order: any): {titel: string, rest: string[]} => {
  const straat = order?.klant_straat && order?.klant_huisnummer
    ? `${order.klant_straat} ${order.klant_huisnummer}`
    : (order?.klant_straat || '')
  const plaats = [order?.klant_postcode, order?.klant_stad].filter(Boolean).join('  ')
  const regels = [
    order?.klant_bedrijf || '',
    order?.klant_naam || '',
    straat,
    plaats,
    order?.klant_btw_nummer ? `${t('lbl_btw')}: ${order.klant_btw_nummer}` : '',
    order?.klant_email || '',
  ].filter(Boolean)
  if (!regels.length) return {titel: '—', rest: []}
  return {titel: regels[0], rest: regels.slice(1)}
}

/**
 * Bouwt de context voor de factuurtemplate. Alle bedragen en datums zijn hier
 * al opgemaakt — opmaken is geen taak van de template.
 */
export const bouwFactuurContext = (bronnen: FactuurTemplateBronnen): TemplateContext => {
  const {order, factuur, brewery, appName, factuurLogo, payInfo} = bronnen
  const fv = brewery?.factuur_velden || {}
  const isCredit = factuur?.status === 'credit'
  const factuurnummer = factuur?.factuurnummer || `${isCredit ? 'CN' : 'F'}-${factuur?.id}`
  const betalingstermijn = brewery?.betalingstermijn ?? 14
  const vervaldatum = (() => {
    try {
      const d = new Date(factuur?.datum || order?.datum || new Date().toISOString())
      d.setDate(d.getDate() + Number(betalingstermijn))
      return fmtDatumDoc(d.toISOString())
    } catch {
      return '—'
    }
  })()
  const leveringsdatum = (order?.verzend_datum || order?.datum)
    ? fmtDatumDoc(order.verzend_datum || order.datum)
    : ''
  const orderRef = order?.wc_order_nummer
    ? `WooCommerce #${order.wc_order_nummer}`
    : (order?.id ? `${t('lbl_order_ref')} M-${order.id}` : '')

  const meta = [
    {label: t('lbl_factuurnummer'), waarde: factuurnummer},
    {label: t('lbl_factuurdatum'), waarde: fmtDatumDoc(factuur?.datum)},
    {label: t('lbl_vervaldatum').replace('{n}', String(betalingstermijn)), waarde: vervaldatum},
    leveringsdatum ? {label: t('lbl_leverdatum'), waarde: leveringsdatum} : null,
    orderRef ? {label: t('lbl_order_ref'), waarde: orderRef} : null,
  ].filter(Boolean)

  const klant = klantRegels(order)
  const info = brouwerijRegels(brewery)
  const overzicht = btwOverzichtVan(factuur)
  const naam = brewery?.naam || appName || ''

  return {
    // Kop
    logo: (fv.logo !== false && factuurLogo) ? factuurLogo : '',
    brouwerij_naam: naam,
    brouwerij_info: info.map(regel => ({regel})),
    heeft_brouwerij_info: info.length > 0,
    doc_titel: isCredit ? t('lbl_creditnota_titel') : t('lbl_factuur_titel'),
    factuurnummer,
    is_betaald: factuur?.status === 'betaald',
    klant_titel: klant.titel,
    klant_regels: klant.rest.map(regel => ({regel})),
    meta,
    // Regels
    regels: (factuur?.regels || []).map((r: any) => ({
      omschrijving: r.omschrijving || '—',
      aantal: fmtQty(r.hoeveelheid),
      prijs: fmtEuroDoc(r.prijs_per_stuk),
      btw_pct: r.btw_pct,
      netto: fmtEuroDoc(r.netto),
      btw: fmtEuroDoc(r.btw_bedrag),
      bruto: fmtEuroDoc(r.bruto),
    })),
    btw_overzicht: overzicht.map((b: any) => ({
      tarief: b.tarief,
      netto: fmtEuroDoc(b.netto),
      btw: fmtEuroDoc(b.btw),
      totaal: fmtEuroDoc((b.netto || 0) + (b.btw || 0)),
    })),
    heeft_btw_overzicht: overzicht.length > 0,
    totaal_netto: fmtEuroDoc(factuur?.netto ?? 0),
    totaal_btw: fmtEuroDoc(factuur?.btw ?? 0),
    totaal_bruto: fmtEuroDoc(factuur?.bruto ?? 0),
    // Betalen
    toon_betaalblok: fv.betaalblok !== false,
    iban: brewery?.iban || '',
    factuurdatum: fmtDatumDoc(factuur?.datum),
    vervaldatum,
    betalingstermijn,
    // Een creditnota krijgt geen betaal-QR: daar valt niets te betalen.
    qr: (payInfo?.qrDataUrl && !isCredit) ? payInfo.qrDataUrl : '',
    opmerking: order?.opmerkingen || '',
    // Labels — zo blijft ook een eigen layout meertalig.
    lbl_betaald: t('factuur_paid'),
    lbl_factuuradres: t('lbl_factuuradres'),
    lbl_kol_omschrijving: t('lbl_kol_omschrijving'),
    lbl_kol_aantal: t('lbl_kol_aantal'),
    lbl_kol_prijs: t('lbl_kol_prijs'),
    lbl_kol_btw_pct: t('lbl_kol_btw_pct'),
    lbl_kol_excl_btw: t('lbl_kol_excl_btw'),
    lbl_kol_incl_btw: t('lbl_kol_incl_btw'),
    lbl_btw: t('lbl_btw'),
    lbl_btw_tarief: t('lbl_btw_tarief'),
    lbl_geen_regels: t('lbl_geen_regels'),
    lbl_subtotaal_excl: t('lbl_subtotaal_excl'),
    lbl_totaal_incl: t('lbl_totaal_incl'),
    lbl_betaalinformatie: t('lbl_betaalinformatie'),
    lbl_iban: t('lbl_iban'),
    lbl_tnv: t('lbl_tnv'),
    lbl_bedrag_kort: t('lbl_bedrag_kort'),
    lbl_vervaldatum_kort: t('lbl_vervaldatum_kort'),
    lbl_ovv_factuurnummer: t('lbl_ovv_factuurnummer'),
    lbl_online_betalen: t('lbl_online_betalen'),
    lbl_scan_qr: t('lbl_scan_qr'),
    lbl_opmerking: t('lbl_opmerking'),
    lbl_order_ref: t('lbl_order_ref'),
  }
}

/** De eigen layout uit `brewery_details`, of leeg als er geen is gezet. */
export const eigenFactuurTemplate = (brewery: any): {html: string, css: string} => ({
  html: String(brewery?.factuur_template?.html ?? '').trim(),
  css: String(brewery?.factuur_template?.css ?? '').trim(),
})
