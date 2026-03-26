/**
 * PakbonExport.tsx
 * Print helpers for pakbon (packing slip) and factuur (invoice).
 * Opens a new window with embedded CSS and triggers window.print().
 */

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #222; background: #fff; }
  .page { max-width: 210mm; margin: 0 auto; padding: 14mm 14mm 10mm; }
  h1 { font-size: 18pt; font-weight: bold; margin-bottom: 2mm; }
  h2 { font-size: 12pt; font-weight: bold; margin-bottom: 2mm; color: #444; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  th { text-align: left; font-size: 9pt; font-weight: bold; border-bottom: 1.5px solid #222; padding: 2mm 2mm 1.5mm; }
  th.r { text-align: right; }
  td { padding: 1.5mm 2mm; font-size: 10pt; border-bottom: 0.5px solid #ddd; vertical-align: top; }
  td.r { text-align: right; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8mm; }
  .header-left { display: flex; align-items: center; gap: 5mm; }
  .header-right { text-align: right; font-size: 10pt; }
  .logo { max-height: 18mm; max-width: 40mm; object-fit: contain; }
  .brewery-name { font-size: 14pt; font-weight: bold; }
  .brewery-addr { font-size: 9pt; color: #555; margin-top: 1mm; }
  .doc-title { font-size: 20pt; font-weight: bold; color: #1a3a6a; margin-bottom: 1mm; }
  .doc-number { font-size: 12pt; font-weight: bold; }
  .doc-meta { font-size: 9pt; color: #555; margin-top: 1mm; }
  .addresses { display: flex; gap: 15mm; margin-bottom: 8mm; }
  .address-block { flex: 1; }
  .address-block .label { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #888; margin-bottom: 1mm; letter-spacing: 0.05em; }
  .address-block p { font-size: 10pt; line-height: 1.5; }
  .totals { margin-left: auto; width: 70mm; }
  .totals table td { border-bottom: none; padding: 1mm 2mm; font-size: 10pt; }
  .totals table td.r { font-weight: normal; }
  .totals .total-row td { font-weight: bold; font-size: 11pt; border-top: 1.5px solid #222; padding-top: 2mm; }
  .btw-table { margin-top: 4mm; margin-bottom: 0; }
  .btw-table th, .btw-table td { font-size: 9pt; padding: 1mm 2mm; }
  .footer { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 4mm; font-size: 9pt; color: #555; display: flex; justify-content: space-between; gap: 10mm; }
  .sign-block { flex: 1; }
  .sign-line { margin-top: 10mm; border-bottom: 1px solid #888; width: 50mm; }
  .sign-label { font-size: 8pt; color: #888; margin-top: 1mm; }
  .badge { display: inline-block; padding: 0.5mm 2mm; border-radius: 2mm; font-size: 8pt; font-weight: bold; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .remarks { margin-top: 3mm; font-size: 9pt; color: #555; }
  .section-title { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #888; letter-spacing: 0.05em; margin-bottom: 1mm; }
  .payment-info { margin-top: 4mm; border: 0.5px solid #ddd; padding: 3mm 4mm; border-radius: 1mm; font-size: 9pt; background: #f9f9f9; }
  .payment-info strong { color: #222; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 0; }
  }
`

function fmtEuro(n: number): string {
  return '€\u202f' + n.toFixed(2).replace('.', ',')
}

function fmtDate(d: string | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'}) }
  catch { return d }
}

function openPrint(html: string): void {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { alert('Pop-up geblokkeerd — sta pop-ups toe voor deze pagina.'); return }
  w.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>Print</title><style>${CSS}</style></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}

function breweryHeader(brewery: any, appName: string, logo: string | null | undefined): string {
  const logoHtml = logo ? `<img src="${logo}" class="logo" alt="logo" />` : ''
  const naam = brewery.naam || appName || 'Brouwerij'
  const straat = [brewery.straat, brewery.huisnummer].filter(Boolean).join(' ')
  const plaats = [brewery.postcode, brewery.stad].filter(Boolean).join(' ')
  return `
    <div class="header-left">
      ${logoHtml}
      <div>
        <div class="brewery-name">${naam}</div>
        ${straat ? `<div class="brewery-addr">${straat}</div>` : ''}
        ${plaats ? `<div class="brewery-addr">${plaats}</div>` : ''}
        ${brewery.email ? `<div class="brewery-addr">${brewery.email}</div>` : ''}
        ${brewery.telefoon ? `<div class="brewery-addr">${brewery.telefoon}</div>` : ''}
        ${brewery.btw_nummer ? `<div class="brewery-addr">BTW: ${brewery.btw_nummer}</div>` : ''}
        ${brewery.kvk_nummer ? `<div class="brewery-addr">KvK: ${brewery.kvk_nummer}</div>` : ''}
      </div>
    </div>`
}

function klantAdresBlock(order: any): string {
  const lines: string[] = []
  if (order.klant_bedrijf) lines.push(`<strong>${order.klant_bedrijf}</strong>`)
  lines.push(order.klant_naam || '—')
  const adres = [
    order.klant_straat && order.klant_huisnummer ? `${order.klant_straat} ${order.klant_huisnummer}` : order.klant_straat || '',
    order.klant_postcode && order.klant_stad ? `${order.klant_postcode}  ${order.klant_stad}` : order.klant_stad || '',
  ].filter(Boolean)
  adres.forEach(l => lines.push(l))
  if (order.klant_email) lines.push(order.klant_email)
  return lines.map(l => `<p>${l}</p>`).join('')
}

// ─────────────────────────────────────────────
// PAKBON
// ─────────────────────────────────────────────
export function printPakbon(
  order: any,
  picks: any[],
  av: any[],
  bat: any[],
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): void {
  const pakbonNr = order.pakbon_nummer || `P-${order.id}`
  const datum = fmtDate(order.verzend_datum || order.datum)
  const orderRef = order.wc_order_nummer ? `WC #${order.wc_order_nummer}` : `M-${order.id}`

  const rows = picks.map((p: any) => {
    const afvulling = av.find((a: any) => a.id === p.afvulling_id)
    const batch = bat.find((b: any) => b.id === p.batch_id)
    return `<tr>
      <td>${batch?.naam || '—'}</td>
      <td>${batch?.batch_nummer || '—'}</td>
      <td>${afvulling?.verpakking_type || '—'}</td>
      <td>${afvulling?.inhoud_per_eenheid ? `${afvulling.inhoud_per_eenheid}L` : '—'}</td>
      <td>${afvulling?.tht ? fmtDate(afvulling.tht) : '—'}</td>
      <td class="r">${p.aantal}</td>
    </tr>`
  }).join('')

  const html = `<div class="page">
    <div class="header">
      ${breweryHeader(brewery, appName, factuurLogo)}
      <div class="header-right">
        <div class="doc-title">Pakbon</div>
        <div class="doc-number">${pakbonNr}</div>
        <div class="doc-meta">Datum: ${datum}</div>
        <div class="doc-meta">Order: ${orderRef}</div>
      </div>
    </div>

    <div class="addresses">
      <div class="address-block">
        <div class="label">Bezorgadres</div>
        ${klantAdresBlock(order)}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Bier</th>
          <th>Batch #</th>
          <th>Verpakking</th>
          <th>Inhoud</th>
          <th>THT</th>
          <th class="r">Aantal</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" style="text-align:center;color:#888;">Geen picks</td></tr>'}
      </tbody>
    </table>

    ${order.opmerkingen ? `<div class="remarks"><strong>Opmerking:</strong> ${order.opmerkingen}</div>` : ''}

    <div class="footer">
      <div class="sign-block">
        <div class="section-title">Ontvangst</div>
        <div class="sign-line"></div>
        <div class="sign-label">Handtekening ontvanger</div>
      </div>
      <div class="sign-block">
        <div class="section-title">Datum ontvangst</div>
        <div class="sign-line"></div>
        <div class="sign-label">Datum</div>
      </div>
    </div>
  </div>`

  openPrint(html)
}

// ─────────────────────────────────────────────
// FACTUUR
// ─────────────────────────────────────────────
export function printFactuur(
  order: any,
  factuur: any,
  brewery: any,
  appName: string,
  factuurLogo: string | null | undefined
): void {
  if (!factuur) return

  const factuurnummer = factuur.factuurnummer || `F-${factuur.id}`
  const factuurdatum = fmtDate(factuur.datum)
  const leveringsdatum = fmtDate(order.verzend_datum || order.datum)
  const betalingstermijn = brewery.betalingstermijn ?? 14
  const vervalDatum = (() => {
    try {
      const d = new Date(factuur.datum || order.datum)
      d.setDate(d.getDate() + Number(betalingstermijn))
      return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
    } catch { return '—' }
  })()

  const regels: any[] = factuur.regels || []

  const regelRows = regels.map((r: any) => `<tr>
    <td>${r.omschrijving || '—'}</td>
    <td class="r">${r.hoeveelheid}</td>
    <td class="r">${fmtEuro(r.prijs_per_stuk)}</td>
    <td class="r">${r.btw_pct}%</td>
    <td class="r">${fmtEuro(r.netto)}</td>
    <td class="r">${fmtEuro(r.btw_bedrag)}</td>
    <td class="r">${fmtEuro(r.bruto)}</td>
  </tr>`).join('')

  const btwOverzicht: any[] = factuur.btw_overzicht || []
  const btwRows = btwOverzicht.map((b: any) => `<tr>
    <td>BTW ${b.tarief}%</td>
    <td class="r">${fmtEuro(b.netto)}</td>
    <td class="r">${fmtEuro(b.btw)}</td>
    <td class="r">${fmtEuro(b.netto + b.btw)}</td>
  </tr>`).join('')

  const netto = factuur.netto ?? 0
  const btw = factuur.btw ?? 0
  const bruto = factuur.bruto ?? 0

  const html = `<div class="page">
    <div class="header">
      ${breweryHeader(brewery, appName, factuurLogo)}
      <div class="header-right">
        <div class="doc-title">Factuur</div>
        <div class="doc-number">${factuurnummer}</div>
        <div class="doc-meta">Factuurdatum: ${factuurdatum}</div>
        <div class="doc-meta">Leverdatum: ${leveringsdatum}</div>
      </div>
    </div>

    <div class="addresses">
      <div class="address-block">
        <div class="label">Factuuradres</div>
        ${klantAdresBlock(order)}
      </div>
      <div class="address-block">
        <div class="label">Order</div>
        <p>${order.wc_order_nummer ? `WooCommerce #${order.wc_order_nummer}` : `Order M-${order.id}`}</p>
        ${factuur.status === 'betaald' ? '<p><span class="badge badge-green">✓ Betaald</span></p>' : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Omschrijving</th>
          <th class="r">Aantal</th>
          <th class="r">Prijs</th>
          <th class="r">BTW%</th>
          <th class="r">Netto</th>
          <th class="r">BTW</th>
          <th class="r">Bruto</th>
        </tr>
      </thead>
      <tbody>
        ${regelRows || '<tr><td colspan="7" style="text-align:center;color:#888;">Geen regels</td></tr>'}
      </tbody>
    </table>

    ${btwOverzicht.length > 0 ? `
    <table class="btw-table" style="width:auto;margin-left:auto;margin-right:0;min-width:110mm;">
      <thead>
        <tr>
          <th>BTW-tarief</th>
          <th class="r">Netto</th>
          <th class="r">BTW</th>
          <th class="r">Bruto</th>
        </tr>
      </thead>
      <tbody>${btwRows}</tbody>
    </table>` : ''}

    <div class="totals">
      <table>
        <tr><td>Subtotaal excl. BTW</td><td class="r">${fmtEuro(netto)}</td></tr>
        <tr><td>BTW</td><td class="r">${fmtEuro(btw)}</td></tr>
        <tr class="total-row"><td>Totaal incl. BTW</td><td class="r">${fmtEuro(bruto)}</td></tr>
      </table>
    </div>

    <div class="payment-info">
      <strong>Betaalinstructies</strong><br/>
      Gelieve het bedrag van <strong>${fmtEuro(bruto)}</strong> over te maken binnen <strong>${betalingstermijn} dagen</strong>
      (uiterlijk ${vervalDatum}) onder vermelding van factuurnummer <strong>${factuurnummer}</strong>.<br/>
      ${brewery.iban ? `IBAN: <strong>${brewery.iban}</strong>${(appName || brewery.naam) ? ` t.n.v. ${appName || brewery.naam}` : ''}` : ''}
    </div>

    ${order.opmerkingen ? `<div class="remarks" style="margin-top:3mm;"><strong>Opmerking:</strong> ${order.opmerkingen}</div>` : ''}
  </div>`

  openPrint(html)
}
