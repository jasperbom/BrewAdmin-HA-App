/**
 * PakbonExport.tsx
 * Print helpers for pakbon (packing slip) and factuur (invoice).
 * Opens a new window with embedded CSS and triggers window.print().
 */
import { t } from '../i18n'
import { fmtQty } from '../utils/format'

const CSS = `
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
const esc = (v: any): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function fmtEuro(n: number): string {
  return '\u20ac\u202f' + Number(n || 0).toFixed(2).replace('.', ',')
}

function fmtDate(d: string | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'}) }
  catch { return d }
}

function openPrint(html: string, filename: string): void {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert(t('err_popup_blocked')); return }
  w.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(filename)}</title><style>${CSS}</style></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  // Sluit popup automatisch na opslaan/annuleren print
  w.onafterprint = () => w.close()
  setTimeout(() => { w.print() }, 400)
}

function breweryBlock(brewery: any, appName: string, logo: string | null | undefined): string {
  const fv = brewery?.factuur_velden || {}
  const showLogo = fv.logo !== false
  const logoHtml = showLogo && logo ? `<img src="${esc(logo)}" class="logo" alt="logo" />` : ''
  const naam = brewery?.naam || appName || 'Brouwerij'
  const straat = [brewery?.straat, brewery?.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery?.postcode, brewery?.stad].filter(Boolean).join(' ')
  const infoLines = [
    fv.adres !== false ? straat : '',
    fv.adres !== false ? plaats : '',
    fv.btw_nummer !== false && brewery?.btw_nummer ? `BTW: ${brewery.btw_nummer}` : '',
    fv.kvk_nummer !== false && brewery?.kvk_nummer ? `KvK: ${brewery.kvk_nummer}` : '',
    fv.iban !== false && brewery?.iban ? `IBAN: ${brewery.iban}` : '',
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

function klantBlock(order: any): string {
  const lines: string[] = []
  if (order.klant_bedrijf) lines.push(`<strong>${esc(order.klant_bedrijf)}</strong>`)
  if (order.klant_naam) lines.push(esc(order.klant_naam))
  const straat = order.klant_straat && order.klant_huisnummer
    ? `${order.klant_straat} ${order.klant_huisnummer}`
    : (order.klant_straat || '')
  if (straat) lines.push(esc(straat))
  const plaats = [order.klant_postcode, order.klant_stad].filter(Boolean).join('  ')
  if (plaats) lines.push(esc(plaats))
  if (order.klant_btw_nummer) lines.push(`BTW: ${esc(order.klant_btw_nummer)}`)
  if (order.klant_email) lines.push(esc(order.klant_email))
  if (!lines.length) lines.push('—')
  const [first, ...rest] = lines
  return `<div class="kn">${first}</div>${rest.map(l => `<p>${l}</p>`).join('')}`
}

// Regeltabel + BTW-overzicht + totalen van een factuur. Gedeeld door de
// factuur-PDF en de betalingsherinnering, zodat beide exact dezelfde regels
// tonen.
function factuurRegelsHtml(factuur: any): string {
  const regels: any[] = factuur.regels || []

  // Bereken btw_overzicht uit regels als niet opgeslagen
  const btwOverzicht: any[] = (() => {
    if (factuur.btw_overzicht && factuur.btw_overzicht.length > 0) return factuur.btw_overzicht
    const map: Record<number, {tarief:number,netto:number,btw:number}> = {}
    regels.forEach((r: any) => {
      const pct = r.btw_pct ?? 0
      if (!map[pct]) map[pct] = {tarief:pct, netto:0, btw:0}
      map[pct].netto += r.netto || 0
      map[pct].btw += r.btw_bedrag || 0
    })
    return Object.values(map).sort((a,b) => a.tarief - b.tarief)
  })()

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
    <td>BTW ${esc(b.tarief)}%</td>
    <td class="r">${fmtEuro(b.netto)}</td>
    <td class="r">${fmtEuro(b.btw)}</td>
    <td class="r">${fmtEuro(b.netto + b.btw)}</td>
  </tr>`).join('')

  const netto = factuur.netto ?? 0
  const btw = factuur.btw ?? 0
  const bruto = factuur.bruto ?? 0

  return `<table>
      <thead>
        <tr>
          <th>Omschrijving</th>
          <th class="r">Aantal</th>
          <th class="r">Prijs</th>
          <th class="r">BTW%</th>
          <th class="r">${t('lbl_kol_excl_btw')}</th>
          <th class="r">BTW</th>
          <th class="r">${t('lbl_kol_incl_btw')}</th>
        </tr>
      </thead>
      <tbody>
        ${regelRows || '<tr><td colspan="7" style="text-align:center;color:#888;padding:4mm;">Geen regels</td></tr>'}
      </tbody>
    </table>

    ${btwOverzicht.length > 0 ? `
    <div class="btw-section">
      <table class="btw-table">
        <thead>
          <tr>
            <th>BTW-tarief</th>
            <th class="r">${t('lbl_kol_excl_btw')}</th>
            <th class="r">BTW</th>
            <th class="r">${t('lbl_kol_incl_btw')}</th>
          </tr>
        </thead>
        <tbody>${btwRows}</tbody>
      </table>
    </div>` : ''}

    <div class="totals">
      <div class="totals-block">
        <div class="totals-row"><span>${t('lbl_subtotaal_excl')}</span><span>${fmtEuro(netto)}</span></div>
        <div class="totals-row"><span>BTW</span><span>${fmtEuro(btw)}</span></div>
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

  const rows = picks.map((p: any) => {
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
      <td>${afvulling?.tht ? fmtDate(afvulling.tht) : '—'}</td>
      <td class="r">${esc(p.aantal)}</td>
    </tr>`
  }).join('')

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title">PAKBON</div>
        <div class="doc-nr">${esc(pakbonNr)}</div>
        <div class="hdr-party">
          <div class="party-label">${t('lbl_bezorgadres')}</div>
          ${klantBlock(order)}
        </div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-block"><div class="ml">${t('lbl_date')}</div><div class="mv">${esc(datum)}</div></div>
      <div class="meta-block"><div class="ml">Order</div><div class="mv">${esc(orderRef)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>${t('lbl_pakbon_bier')}</th>
          <th>Batch #</th>
          <th>${t('lbl_pakbon_verpakking')}</th>
          <th>${t('lbl_pakbon_inhoud')}</th>
          <th>${t('lbl_tht')}</th>
          <th class="r">Aantal</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="text-align:center;color:#888;padding:4mm;">${t('msg_geen_picks')}</td></tr>`}
      </tbody>
    </table>

    ${order.opmerkingen ? `<div class="remarks"><strong>Opmerking:</strong> ${esc(order.opmerkingen)}</div>` : ''}

    <div class="footer">
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">${t('lbl_pakbon_ontvangst')}</div>
        <div class="sign-line"></div>
        <div class="sign-label">${t('lbl_handtekening')}</div>
      </div>
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">Datum ontvangst</div>
        <div class="sign-line"></div>
        <div class="sign-label">Datum</div>
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
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(r.filename)}</title><style>${CSS}</style></head><body>${r.bodyHtml}</body></html>`
  return {html, filename: r.filename}
}

// ─────────────────────────────────────────────
// FACTUUR
// ─────────────────────────────────────────────

// Interne helper: bouwt de HTML body-inhoud + bestandsnaam
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
  const factuurdatum = fmtDate(factuur.datum)
  const betalingstermijn = brewery?.betalingstermijn ?? 14
  const vervalDatum = (() => {
    try {
      const d = new Date(factuur.datum || order?.datum || new Date().toISOString())
      d.setDate(d.getDate() + Number(betalingstermijn))
      return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
    } catch { return '—' }
  })()
  const leveringsdatum = order?.verzend_datum || order?.datum ? fmtDate(order.verzend_datum || order.datum) : null

  const bruto = factuur.bruto ?? 0
  const naam = brewery?.naam || appName || ''

  const orderRef = order?.wc_order_nummer
    ? `WooCommerce #${order.wc_order_nummer}`
    : order?.id ? `Order M-${order.id}` : null

  const metaItems = [
    {label:'Factuurnummer', val: factuurnummer},
    {label:'Factuurdatum', val: factuurdatum},
    {label:t('lbl_vervaldatum').replace('{n}', String(betalingstermijn)), val: vervalDatum},
    leveringsdatum ? {label:'Leverdatum', val: leveringsdatum} : null,
    orderRef ? {label:'Order', val: orderRef} : null,
  ].filter(Boolean) as {label:string,val:string}[]

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title">${isCredit ? t('lbl_creditnota_titel') : t('lbl_factuur_titel')}</div>
        <div class="doc-nr">${esc(factuurnummer)}</div>
        ${factuur.status === 'betaald' ? '<div style="margin-top:2mm"><span class="badge badge-green">✓ Betaald</span></div>' : ''}
        <div class="hdr-party">
          <div class="party-label">${t('lbl_factuuradres')}</div>
          ${klantBlock(order)}
        </div>
      </div>
    </div>

    <div class="meta-grid">
      ${metaItems.map(m => `<div class="meta-block"><div class="ml">${esc(m.label)}</div><div class="mv">${esc(m.val)}</div></div>`).join('')}
    </div>

    ${factuurRegelsHtml(factuur)}

    ${(brewery?.factuur_velden?.betaalblok !== false) ? `<div class="pay-block">
      <div class="pay-title">${t('lbl_betaalinformatie')}</div>
      ${brewery?.iban ? `<div>IBAN: <strong>${esc(brewery.iban)}</strong>${naam ? ` &nbsp;t.n.v. ${esc(naam)}` : ''}</div>` : ''}
      <div>Bedrag: <strong>${fmtEuro(bruto)}</strong> &nbsp;·&nbsp; Vervaldatum: <strong>${esc(vervalDatum)}</strong></div>
      <div>o.v.v. factuurnummer <strong>${esc(factuurnummer)}</strong></div>
    </div>` : ''}

    ${(payInfo?.qrDataUrl && !isCredit) ? `<div style="margin-top:4mm;display:flex;align-items:center;gap:5mm;border:1px solid #e5e7eb;border-radius:2mm;padding:3mm 4mm;">
      <img src="${payInfo.qrDataUrl}" alt="QR" style="width:26mm;height:26mm;flex:0 0 auto;display:block;" />
      <div style="font-size:9pt;line-height:1.5;color:#374151;">
        <div style="font-weight:bold;color:#92400e;font-size:10.5pt;margin-bottom:1mm;">${t('lbl_online_betalen')}</div>
        <div>${t('lbl_scan_qr')}</div>
      </div>
    </div>` : ''}

    ${order?.opmerkingen ? `<div class="remarks" style="margin-top:3mm;"><strong>Opmerking:</strong> ${esc(order.opmerkingen)}</div>` : ''}
  </div>`

  return {bodyHtml, filename: `Factuur-${factuurnummer}`}
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
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(result.filename)}</title><style>${CSS}</style></head><body>${result.bodyHtml}</body></html>`
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
  openPrint(result.bodyHtml, result.filename)
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
  const betalingstermijn = brewery?.betalingstermijn ?? 14
  const bruto = factuur.bruto ?? 0
  const naam = brewery?.naam || appName || ''

  // Originele vervaldatum
  const origVerval = (() => {
    try {
      const d = new Date(factuur.datum || new Date().toISOString())
      d.setDate(d.getDate() + Number(betalingstermijn))
      return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
    } catch { return '—' }
  })()

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

  const klantOrder = {
    klant_naam: factuur.klant_naam,
    klant_straat: factuur.klant_straat,
    klant_postcode: factuur.klant_postcode,
    klant_stad: factuur.klant_stad,
    klant_btw_nummer: factuur.klant_btw_nummer,
  }

  const bodyHtml = `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, factuurLogo)}
      <div class="hdr-right">
        <div class="doc-title" style="font-size:18pt">${docTitel}</div>
        <div class="doc-nr" style="color:#888">${t('lbl_date')}: ${vandaag}</div>
        <div class="hdr-party">
          <div class="party-label">${t('lbl_factuuradres')}</div>
          ${klantBlock(klantOrder)}
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
      ${brewery?.iban ? `<div>IBAN: <strong>${esc(brewery.iban)}</strong>${naam ? ` &nbsp;t.n.v. ${esc(naam)}` : ''}</div>` : ''}
      <div>${t('lbl_openstaand_bedrag')}: <strong>${fmtEuro(bruto)}</strong></div>
      <div>${t('lbl_nieuw_vervaldag')}: <strong>${esc(nieuweVerval)}</strong></div>
      <div>o.v.v. factuurnummer <strong>${esc(factuurnummer)}</strong></div>
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
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(r.filename)}</title><style>${CSS}</style></head><body>${r.bodyHtml}</body></html>`
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
