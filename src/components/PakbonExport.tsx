/**
 * PakbonExport.tsx
 * Print helpers for pakbon (packing slip) and factuur (invoice).
 * Opens a new window with embedded CSS and triggers window.print().
 */
import { t } from '../i18n'
import { fmtQty, fmtEuroDoc, fmtDatumDoc, tod } from '../utils/format'
import { renderTemplateOfFallback, escapeHtml } from '../utils/template'
import { onGepickteRegels } from '../utils/picking'
import type { Picklijst, PicklijstRegel, PicklijstOrder } from '../utils/picking'
import {
  FACTUUR_CSS_DEFAULT,
  FACTUUR_HTML_DEFAULT,
  bouwFactuurContext,
  btwOverzichtVan,
  eigenFactuurTemplate,
  klantRegels,
} from '../utils/factuurTemplate'
import { betalingstermijnVoor, vervaldatumTekst, isoDag } from '../utils/facturen'

// Basisopmaak van elk document dat deze app uitprint. Gedeeld met het
// batchdossier (`BatchRapportExport.tsx`), zodat een pakbon, een factuur en een
// dossier uit dezelfde brouwerij er ook als één brouwerij uitzien.
export const DOC_CSS = `
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
  .footer { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 4mm; font-size: 9pt; color: #555; display: flex; justify-content: space-between; gap: 10mm; }
  .sign-block { flex: 1; }
  .sign-line { margin-top: 10mm; border-bottom: 1px solid #888; width: 50mm; }
  .sign-label { font-size: 8pt; color: #888; margin-top: 1mm; }
  .badge { display: inline-block; padding: 0.5mm 2mm; border-radius: 2mm; font-size: 8pt; font-weight: bold; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-concept { background: #ffedd5; color: #9a3412; margin-top: 1.5mm; }
  tr.open td { color: #6b7280; font-style: italic; }
  td.muted { color: #9ca3af; font-size: 8.5pt; }
  .muted { color: #9ca3af; font-size: 8.5pt; }
  .tekort { color: #b91c1c; font-weight: bold; font-size: 9pt; }
  th.chk, td.chk { width: 7mm; padding-left: 2mm; padding-right: 0; }
  .box { display: inline-block; width: 4.5mm; height: 4.5mm; border: 1.5px solid #6b7280; border-radius: 1mm; vertical-align: middle; }
  .sub-title { font-size: 9pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin: 6mm 0 2mm; }
  .remarks { margin-top: 3mm; font-size: 9pt; color: #555; border-left: 2px solid #ddd; padding-left: 3mm; }
  .notice-block { background: #fff7ed; border: 1.5px solid #f97316; padding: 3.5mm 4.5mm; border-radius: 3px; margin-bottom: 5mm; }
  .notice-title { font-weight: bold; font-size: 11pt; color: #c2410c; margin-bottom: 2px; }
  .notice-text { font-size: 9.5pt; line-height: 1.65; color: #7c2d12; }
  .aanmaning-block { background: #fef2f2; border: 2px solid #dc2626; padding: 3.5mm 4.5mm; border-radius: 3px; margin-bottom: 5mm; }
  .aanmaning-title { font-weight: bold; font-size: 11pt; color: #dc2626; margin-bottom: 2px; }
  .aanmaning-text { font-size: 9.5pt; line-height: 1.65; color: #7f1d1d; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 0; }
  }
`

// HTML-escape voor alle data die in de print-HTML wordt ge\u00efnterpoleerd.
// Klant-/ordervelden komen rechtstreeks uit WooCommerce; zonder escaping zou
// een kwaadwillende bedrijfsnaam of opmerking scripts kunnen uitvoeren in de
// app-origin zodra het printvenster opent (document.write erft de origin).
// Eén escaper voor de hele app: `escapeHtml` uit utils/template.ts (getest).
export const esc = escapeHtml

// Documentopmaak staat in utils/format.ts, zodat factuur, pakbon, herinnering
// en de factuurtemplate exact dezelfde bedragen en datums produceren.
const fmtEuro = fmtEuroDoc
const fmtDate = fmtDatumDoc

export function openPrint(html: string, filename: string, css: string = DOC_CSS): void {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert(t('err_popup_blocked')); return }
  w.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(filename)}</title><style>${css}</style></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  // Sluit popup automatisch na opslaan/annuleren print
  w.onafterprint = () => w.close()
  setTimeout(() => { w.print() }, 400)
}

export function breweryBlock(brewery: any, appName: string, logo: string | null | undefined): string {
  const fv = brewery?.factuur_velden || {}
  const showLogo = fv.logo !== false
  const logoHtml = showLogo && logo ? `<img src="${esc(logo)}" class="logo" alt="logo" />` : ''
  const naam = brewery?.naam || appName || 'Brouwerij'
  const straat = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  const infoLines = [
    fv.adres !== false ? straat : '',
    fv.adres !== false ? plaats : '',
    fv.btw_nummer !== false && brewery?.btw_nummer ? `${t('lbl_btw')}: ${brewery.btw_nummer}` : '',
    fv.kvk_nummer !== false && brewery?.kvk_nummer ? `${t('lbl_kvk_kort')}: ${brewery.kvk_nummer}` : '',
    fv.iban !== false && brewery?.iban ? `${t('lbl_iban')}: ${brewery.iban}` : '',
    fv.email !== false ? (brewery?.email || '') : '',
    fv.telefoon !== false ? (brewery?.telefoon || '') : '',
  ].filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')
  return `
    <div class="hdr-left">
      ${logoHtml}
      <div>
        <div class="bi-naam">${esc(naam)}</div>
        ${infoLines ? `<div class="bi-info">${infoLines}</div>` : ''}
      </div>
    </div>`
}

// Adresblok van de afnemer: dezelfde regels als op de factuur (klantRegels),
// ook op pakbon en herinnering.
function klantBlock(order: any): string {
  const {titel, rest} = klantRegels(order)
  return `<div class="kn">${esc(titel)}</div>${rest.map(l => `<p>${esc(l)}</p>`).join('')}`
}

// Regeltabel + BTW-overzicht + totalen van de betalingsherinnering. De factuur
// zelf rendert via de factuurtemplate (utils/factuurTemplate.ts); het
// BTW-overzicht komt uit dezelfde functie (`btwOverzichtVan`), zodat factuur
// en herinnering hetzelfde overzicht tonen.
function factuurRegelsHtml(factuur: any): string {
  const regels: any[] = factuur.regels || []
  const btwOverzicht: any[] = btwOverzichtVan(factuur)

  const regelRows = regels.map((r: any) => `<tr>
    <td>${esc(r.omschrijving || '—')}</td>
    <td class="r">${fmtQty(r.hoeveelheid)}</td>
    <td class="r">${fmtEuro(r.prijs_per_stuk)}</td>
    <td class="r">${esc(r.btw_pct)}%</td>
    <td class="r">${fmtEuro(r.netto)}</td>
    <td class="r">${fmtEuro(r.btw_bedrag)}</td>
    <td class="r">${fmtEuro(r.bruto)}</td>
  </tr>`).join('')

  const btwRows = btwOverzicht.map((b: any) => `<tr>
    <td>${t('lbl_btw')} ${esc(b.tarief)}%</td>
    <td class="r">${fmtEuro(b.netto)}</td>
    <td class="r">${fmtEuro(b.btw)}</td>
    <td class="r">${fmtEuro((b.netto || 0) + (b.btw || 0))}</td>
  </tr>`).join('')

  const netto = factuur.netto ?? 0
  const btw = factuur.btw ?? 0
  const bruto = factuur.bruto ?? 0

  return `<table>
      <thead>
        <tr>
          <th>${t('lbl_kol_omschrijving')}</th>
          <th class="r">${t('lbl_kol_aantal')}</th>
          <th class="r">${t('lbl_kol_prijs')}</th>
          <th class="r">${t('lbl_kol_btw_pct')}</th>
          <th class="r">${t('lbl_kol_excl_btw')}</th>
          <th class="r">${t('lbl_btw')}</th>
          <th class="r">${t('lbl_kol_incl_btw')}</th>
        </tr>
      </thead>
      <tbody>
        ${regelRows || `<tr><td colspan="7" style="text-align:center;color:#888;padding:4mm;">${t('lbl_geen_regels')}</td></tr>`}
      </tbody>
    </table>

    ${btwOverzicht.length > 0 ? `
    <div class="btw-section">
      <table class="btw-table">
        <thead>
          <tr>
            <th>${t('lbl_btw_tarief')}</th>
            <th class="r">${t('lbl_kol_excl_btw')}</th>
            <th class="r">${t('lbl_btw')}</th>
            <th class="r">${t('lbl_kol_incl_btw')}</th>
          </tr>
        </thead>
        <tbody>${btwRows}</tbody>
      </table>
    </div>` : ''}

    <div class="totals">
      <div class="totals-block">
        <div class="totals-row"><span>${t('lbl_subtotaal_excl')}</span><span>${fmtEuro(netto)}</span></div>
        <div class="totals-row"><span>${t('lbl_btw')}</span><span>${fmtEuro(btw)}</span></div>
        <div class="totals-sep"></div>
        <div class="totals-row grand-total"><span>${t('lbl_totaal_incl')}</span><span>${fmtEuro(bruto)}</span></div>
      </div>
    </div>`
}

// ─────────────────────────────────────────────
// PAKBON
// ─────────────────────────────────────────────

function buildPakbonBody(
  order: any,
  picks: any[],
  av: any[],
  bat: any[],
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): {bodyHtml: string, filename: string, pakbonNr: string} {
  const pakbonNr = order.pakbon_nummer || `P-${order.id}`
  // Pakbon-datum = datum van picken (`pakbon_datum` of `pick_datum`).
  // Verzend-/orderdatum zijn alleen fallback voor oude records waar het
  // pickmoment niet vastgelegd was.
  const datum = fmtDate(order.pakbon_datum || order.pick_datum || order.verzend_datum || order.datum)
  const orderRef = order.wc_order_nummer ? `WC #${order.wc_order_nummer}` : `M-${order.id}`

  const pickRows = picks.map((p: any) => {
    const afvulling = av.find((a: any) => a.id === p.afvulling_id)
    const batch = bat.find((b: any) => b.id === p.batch_id)
    // Toon biernaam zoals besteld (orderregel) — viel anders terug op een
    // batchnaam als "James Blond V1" die voor de klant verwarrend kan zijn.
    // Fallback-keten: orderregel.bier_naam → batch.biernaam → batch.naam.
    const regel = (order?.regels || []).find((r: any) => r.id === p.regel_id)
    const bierNaam = regel?.bier_naam || batch?.biernaam || batch?.naam || '—'
    return `<tr>
      <td>${esc(bierNaam)}</td>
      <td>${esc(batch?.batch_nummer || '—')}</td>
      <td>${esc(afvulling?.verpakking_type || '—')}</td>
      <td>${afvulling?.inhoud_per_eenheid ? `${esc(afvulling.inhoud_per_eenheid)}L` : '—'}</td>
      <td>${afvulling?.tht ? esc(fmtDate(afvulling.tht)) : '—'}</td>
      <td class="r">${esc(p.aantal)}</td>
    </tr>`
  })

  // Nog niet (volledig) gepickte bierregels: de pakbon mag ook vóór het picken
  // geprint worden, bijvoorbeeld als picklijst in de koeling. Wat er nog niet
  // gepickt is staat dan op de bestelde regel zelf — batch, inhoud en THT zijn
  // nog onbekend. Zolang zo'n regel bestaat is het document een concept.
  const openRegels = onGepickteRegels(order, picks)
  const openRows = openRegels.map((r: any) => `<tr class="open">
      <td>${esc(r.bier_naam || '—')}</td>
      <td class="muted">${t('lbl_pakbon_nog_te_picken')}</td>
      <td>${esc(r.verpakking_type || '—')}</td>
      <td>—</td>
      <td>—</td>
      <td class="r">${esc(r.aantal)}</td>
    </tr>`)
  const isConcept = openRows.length > 0
  const rows = [...pickRows, ...openRows].join('')

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title">${esc(t('lbl_pakbon_document'))}</div>
        <div class="doc-nr">${esc(pakbonNr)}</div>
        ${isConcept ? `<div class="badge badge-concept">${t('lbl_pakbon_concept')}</div>` : ''}
        <div class="hdr-party">
          <div class="party-label">${t('lbl_bezorgadres')}</div>
          ${klantBlock(order)}
        </div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-block"><div class="ml">${t('lbl_date')}</div><div class="mv">${esc(datum)}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_order_ref')}</div><div class="mv">${esc(orderRef)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>${t('lbl_pakbon_bier')}</th>
          <th>${t('lbl_batch_nr')}</th>
          <th>${t('lbl_pakbon_verpakking')}</th>
          <th>${t('lbl_pakbon_inhoud')}</th>
          <th>${t('lbl_tht')}</th>
          <th class="r">${t('lbl_kol_aantal')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="text-align:center;color:#888;padding:4mm;">${t('msg_geen_picks')}</td></tr>`}
      </tbody>
    </table>

    ${order.opmerkingen ? `<div class="remarks"><strong>${t('lbl_opmerking')}:</strong> ${esc(order.opmerkingen)}</div>` : ''}

    <div class="footer">
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">${t('lbl_pakbon_ontvangst')}</div>
        <div class="sign-line"></div>
        <div class="sign-label">${t('lbl_handtekening')}</div>
      </div>
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">${t('lbl_datum_ontvangst')}</div>
        <div class="sign-line"></div>
        <div class="sign-label">${t('lbl_date')}</div>
      </div>
    </div>
  </div>`

  const filename = order.pakbon_nummer || `Pakbon-${order.id || 'export'}`
  return {bodyHtml, filename, pakbonNr}
}

export function printPakbon(
  order: any,
  picks: any[],
  av: any[],
  bat: any[],
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): void {
  const r = buildPakbonBody(order, picks, av, bat, brewery, appName, factuurLogo)
  openPrint(r.bodyHtml, r.filename)
}

// Geeft volledige standalone HTML (incl. <html>/<head>/<style>) terug — voor
// gebruik als HTML-mailbody.
export function buildPakbonHTML(
  order: any,
  picks: any[],
  av: any[],
  bat: any[],
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): {html: string, filename: string} {
  const r = buildPakbonBody(order, picks, av, bat, brewery, appName, factuurLogo)
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(r.filename)}</title><style>${DOC_CSS}</style></head><body>${r.bodyHtml}</body></html>`
  return {html, filename: r.filename}
}

// ─────────────────────────────────────────────
// PICKLIJST (meerdere bestellingen in één ronde)
// ─────────────────────────────────────────────
// Werkdocument, geen klantdocument: per bier + verpakking het totaal dat je
// uit de koeling haalt, uit welke batch (FEFO-suggestie) en voor welke
// bestelling het is. Daaronder de bestellingen zelf voor de inpaktafel.
// De inhoud komt uit `verzamelPicklijst` (utils/picking.ts).

function buildPicklijstBody(
  lijst: Picklijst,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): {bodyHtml: string, filename: string} {
  // Lokale kalenderdag (niet UTC): een picklijst van 00:30 hoort bij vandaag.
  const vandaag = tod()
  const datum = fmtDate(vandaag)

  const regelRows = lijst.regels.map((g: PicklijstRegel) => {
    const pakUit = g.suggesties.map(s =>
      `<div>${esc(s.batch_nummer || '—')} · ${t('lbl_tht')} ${s.tht ? esc(fmtDate(s.tht)) : '—'} · <strong>${esc(s.aantal)}×</strong></div>`)
    if (g.tekort > 0) {
      pakUit.push(`<div class="tekort">${esc(g.suggesties.length
        ? t('lbl_picklijst_tekort').replace('{n}', String(g.tekort))
        : t('lbl_picklijst_geen_voorraad'))}</div>`)
    }
    const voor = g.orders.map(o =>
      `<div>${esc(o.ref)} · ${esc(o.klant || '—')} · <strong>${esc(o.aantal)}×</strong>${o.prive ? ` <span class="muted">${t('lbl_picklijst_prive')}</span>` : ''}</div>`)
    return `<tr>
      <td class="chk"><span class="box"></span></td>
      <td><strong>${esc(g.bier_naam || '—')}</strong>${g.sku ? `<div class="muted">${esc(g.sku)}</div>` : ''}</td>
      <td>${esc(g.verpakking_type || '—')}</td>
      <td class="r"><strong>${esc(g.totaal)}</strong></td>
      <td>${pakUit.join('')}</td>
      <td>${voor.join('')}</td>
    </tr>`
  }).join('')

  const orderRows = lijst.orders.map((o: PicklijstOrder) => {
    const levering = o.levering === 'afhalen'
      ? `${t('orders_levering_afhalen')}${o.afhaalmoment ? ` · ${esc(o.afhaalmoment)}` : ''}`
      : o.levering === 'verzenden' ? t('orders_levering_verzenden') : '—'
    return `<tr>
      <td class="chk"><span class="box"></span></td>
      <td><strong>${esc(o.ref)}</strong></td>
      <td>${esc(o.klant || '—')}${o.prive ? ` <span class="muted">${t('lbl_picklijst_prive')}</span>` : ''}</td>
      <td>${levering}</td>
      <td class="r">${esc(o.regels)}</td>
      <td class="r">${esc(o.stuks)}</td>
      <td>${esc(o.opmerkingen)}</td>
    </tr>`
  }).join('')

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title">${t('lbl_picklijst_document')}</div>
        <div class="doc-nr">${esc(datum)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-block"><div class="ml">${t('lbl_picklijst_orders')}</div><div class="mv">${esc(lijst.orders.length)}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_picklijst_regels')}</div><div class="mv">${esc(lijst.regels.length)}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_picklijst_stuks')}</div><div class="mv">${esc(lijst.totaal)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="chk"></th>
          <th>${t('lbl_pakbon_bier')}</th>
          <th>${t('lbl_pakbon_verpakking')}</th>
          <th class="r">${t('lbl_kol_aantal')}</th>
          <th>${t('lbl_picklijst_pak_uit')}</th>
          <th>${t('lbl_picklijst_voor')}</th>
        </tr>
      </thead>
      <tbody>
        ${regelRows || `<tr><td colspan="6" style="text-align:center;color:#888;padding:4mm;">${t('msg_picklijst_leeg')}</td></tr>`}
      </tbody>
    </table>

    ${orderRows ? `<div class="sub-title">${t('lbl_picklijst_per_order')}</div>
    <table>
      <thead>
        <tr>
          <th class="chk"></th>
          <th>${t('lbl_order_ref')}</th>
          <th>${t('lbl_klant')}</th>
          <th>${t('lbl_picklijst_levering')}</th>
          <th class="r">${t('lbl_picklijst_regels')}</th>
          <th class="r">${t('lbl_picklijst_stuks')}</th>
          <th>${t('lbl_opmerking')}</th>
        </tr>
      </thead>
      <tbody>${orderRows}</tbody>
    </table>` : ''}
  </div>`

  return {bodyHtml, filename: `Picklijst-${vandaag}`}
}

export function printPicklijst(
  lijst: Picklijst,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): void {
  const r = buildPicklijstBody(lijst, brewery, appName, factuurLogo)
  openPrint(r.bodyHtml, r.filename)
}

// Volledige standalone HTML (voor tests en een eventuele mail-PDF).
export function buildPicklijstHTML(
  lijst: Picklijst,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): {html: string, filename: string} {
  const r = buildPicklijstBody(lijst, brewery, appName, factuurLogo)
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(r.filename)}</title><style>${DOC_CSS}</style></head><body>${r.bodyHtml}</body></html>`
  return {html, filename: r.filename}
}

// ─────────────────────────────────────────────
// FACTUUR
// ─────────────────────────────────────────────

// Interne helper: bouwt de HTML body-inhoud + bestandsnaam. De layout zelf komt
// uit de factuurtemplate (utils/factuurTemplate.ts) — standaard de ingebouwde
// versie, of de eigen layout uit `brewery_details.factuur_template`.
function buildFactuurBody(
  order: any,
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined,
  payInfo?: {url: string, qrDataUrl?: string} | null
): {bodyHtml: string, filename: string} | null {
  if (!factuur) return null

  const isCredit = factuur.status === 'credit'
  const factuurnummer = factuur.factuurnummer || `${isCredit ? 'CN' : 'F'}-${factuur.id}`
  const context = bouwFactuurContext({order, factuur, brewery, appName, factuurLogo, payInfo})
  const eigen = eigenFactuurTemplate(brewery)
  const bodyHtml = renderTemplateOfFallback(eigen.html, FACTUUR_HTML_DEFAULT, context)

  return {bodyHtml, filename: `Factuur-${factuurnummer}`}
}

// CSS van het factuurdocument: de eigen stijl als die is ingesteld, anders de
// standaard. Pakbon en herinnering blijven de gedeelde CSS bovenaan gebruiken.
function factuurCss(brewery: any): string {
  return eigenFactuurTemplate(brewery).css || FACTUUR_CSS_DEFAULT
}

// Geeft volledige standalone HTML terug (voor ZIP-export)
export function buildFactuurHTML(
  order: any,
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined,
  payInfo?: {url: string, qrDataUrl?: string} | null
): string {
  const result = buildFactuurBody(order, factuur, brewery, appName, factuurLogo, payInfo)
  if (!result) return ''
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(result.filename)}</title><style>${factuurCss(brewery)}</style></head><body>${result.bodyHtml}</body></html>`
}

// Opent printvenster
export function printFactuur(
  order: any,
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): void {
  const result = buildFactuurBody(order, factuur, brewery, appName, factuurLogo)
  if (!result) return
  openPrint(result.bodyHtml, result.filename, factuurCss(brewery))
}

// ─────────────────────────────────────────────
// BETALINGSHERINNERING / AANMANING
// ─────────────────────────────────────────────
// Interne helper: bouwt de HTML body-inhoud + bestandsnaam van een
// herinnering/aanmaning. `payInfo` (optioneel) plaatst onderaan een
// Mollie-betaallink met QR-code, net als op de factuur.
function buildHerinneringBody(
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined,
  niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning',
  payInfo?: {url: string, qrDataUrl?: string} | null
): {bodyHtml: string, filename: string} | null {
  if (!factuur) return null

  const fv = brewery?.factuur_velden || {}
  const factuurnummer = factuur.factuurnummer || `F-${factuur.id}`
  const factuurdatum = fmtDate(factuur.datum)
  // De aanroeper geeft de termijn van déze factuur mee (`breweryMetTermijn`);
  // leeg of 0 valt terug op de standaard, zoals op de factuur zelf.
  const betalingstermijn = betalingstermijnVoor(null, [], brewery)
  const bruto = factuur.bruto ?? 0
  const naam = brewery?.naam || appName || ''

  // Originele vervaldatum — dezelfde dagrekening als de factuur en de badge
  const origVerval = vervaldatumTekst(
    {datum: factuur.datum || isoDag(new Date())}, [], {betalingstermijn}) || '—'

  // Nieuwe betalingsdatum (7 dagen vanaf vandaag)
  const nieuweVerval = (() => {
    const d = new Date()
    const dagExtra = niveau === 'aanmaning' ? 7 : 14
    d.setDate(d.getDate() + dagExtra)
    return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
  })()

  // Titel & tekst op basis van niveau
  let docTitel: string
  let noticeHtml: string
  let filenamePrefix: string
  if (niveau === 'aanmaning') {
    docTitel = t('lbl_aanmaning_document')
    filenamePrefix = 'Aanmaning'
    noticeHtml = `<div class="aanmaning-block">
      <div class="aanmaning-title">${t('lbl_aanmaning_document')}</div>
      <div class="aanmaning-text">${t('msg_aanmaning_tekst')}</div>
    </div>`
  } else if (niveau === 'tweede_herinnering') {
    docTitel = t('lbl_tweede_herinnering_document')
    filenamePrefix = '2e-Herinnering'
    noticeHtml = `<div class="notice-block">
      <div class="notice-title">${t('lbl_tweede_herinnering_document')}</div>
      <div class="notice-text">${t('msg_tweede_herinnering_tekst')}</div>
    </div>`
  } else {
    docTitel = t('lbl_herinnering_document')
    filenamePrefix = '1e-Herinnering'
    noticeHtml = `<div class="notice-block">
      <div class="notice-title">${t('lbl_herinnering_document')}</div>
      <div class="notice-text">${t('msg_herinnering_tekst')}</div>
    </div>`
  }

  const vandaag = new Date().toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title" style="font-size:18pt">${docTitel}</div>
        <div class="doc-nr" style="color:#888">${t('lbl_date')}: ${vandaag}</div>
        <div class="hdr-party">
          <div class="party-label">${t('lbl_factuuradres')}</div>
          ${klantBlock(factuur)}
        </div>
      </div>
    </div>

    ${noticeHtml}

    <div class="meta-grid" style="margin-bottom:5mm">
      <div class="meta-block"><div class="ml">${t('lbl_originele_factuur')}</div><div class="mv">${esc(factuurnummer)}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_date')}</div><div class="mv">${esc(factuurdatum)}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_vervaldatum').replace('{n}',String(betalingstermijn))}</div><div class="mv">${origVerval}</div></div>
      <div class="meta-block"><div class="ml">${t('lbl_openstaand_bedrag')}</div><div class="mv" style="font-weight:bold;font-size:13pt">${fmtEuro(bruto)}</div></div>
    </div>

    ${factuurRegelsHtml(factuur)}

    ${(fv.betaalblok !== false) ? `<div class="pay-block">
      <div class="pay-title">${t('lbl_betaalinformatie')}</div>
      ${brewery?.iban ? `<div>${t('lbl_iban')}: <strong>${esc(brewery.iban)}</strong>${naam ? ` &nbsp;${t('lbl_tnv')} ${esc(naam)}` : ''}</div>` : ''}
      <div>${t('lbl_openstaand_bedrag')}: <strong>${fmtEuro(bruto)}</strong></div>
      <div>${t('lbl_nieuw_vervaldag')}: <strong>${esc(nieuweVerval)}</strong></div>
      <div>${t('lbl_ovv_factuurnummer')} <strong>${esc(factuurnummer)}</strong></div>
    </div>` : ''}

    ${payInfo?.qrDataUrl ? `<div style="margin-top:4mm;display:flex;align-items:center;gap:5mm;border:1px solid #e5e7eb;border-radius:2mm;padding:3mm 4mm;">
      <img src="${payInfo.qrDataUrl}" alt="QR" style="width:26mm;height:26mm;flex:0 0 auto;display:block;" />
      <div style="font-size:9pt;line-height:1.5;color:#374151;">
        <div style="font-weight:bold;color:#92400e;font-size:10.5pt;margin-bottom:1mm;">${t('lbl_online_betalen')}</div>
        <div>${t('lbl_scan_qr')}</div>
      </div>
    </div>` : ''}
  </div>`

  return {bodyHtml, filename: `${filenamePrefix}-${factuurnummer}`}
}

// Volledige standalone HTML (voor de mail-PDF via htmlToPdfBase64).
export function buildHerinneringHTML(
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined,
  niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning',
  payInfo?: {url: string, qrDataUrl?: string} | null
): string {
  const r = buildHerinneringBody(factuur, brewery, appName, factuurLogo, niveau, payInfo)
  if (!r) return ''
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(r.filename)}</title><style>${DOC_CSS}</style></head><body>${r.bodyHtml}</body></html>`
}

// Opent printvenster met de herinnering/aanmaning.
export function printHerinnering(
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined,
  niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning'
): void {
  const r = buildHerinneringBody(factuur, brewery, appName, factuurLogo, niveau)
  if (!r) return
  openPrint(r.bodyHtml, r.filename)
}
