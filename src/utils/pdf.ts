/**
 * pdf.ts — client-side PDF generatie.
 * Rendert een complete standalone HTML-pagina (zoals door `buildPakbonHTML` /
 * `buildFactuurHTML` aangeleverd) in een verborgen iframe, captureert de
 * inhoud met html2canvas en pakt het in een A4-PDF met jsPDF.
 *
 * Returnt base64 zonder `data:`-prefix — direct bruikbaar als
 * `attachments[].contentBase64` in `mailSendApi`.
 *
 * `blokSelector` is voor documenten van meerdere pagina's (het batchdossier):
 * de elementen die erop matchen worden niet doormidden geknipt. `kopSelector`
 * doet hetzelfde voor kopjes, plus een stuk inhoud eronder — een kop die als
 * laatste regel van een pagina achterblijft is net zo lelijk als een halve
 * tabelregel. Zonder die opties blijft het gedrag exact als vanouds: één
 * doorlopende afbeelding die per paginahoogte opschuift, wat voor een pakbon
 * of factuur van één pagina precies goed is.
 */
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { paginaIndeling, type PdfBlok } from './pdfPaginering'

/** Inhoud die minimaal achter een kop op dezelfde pagina moet passen, in
 *  CSS-pixels: genoeg voor een tabelkop plus de eerste twee regels. Een kop
 *  met alleen een kolomkop eronder is net zo'n weesregel als een kop alleen. */
const KOP_STAART_PX = 110

export async function htmlToPdfBase64(
  html: string,
  opties?: {blokSelector?: string, kopSelector?: string},
): Promise<string> {
  // Verborgen iframe met srcdoc, zo blijft de globale DOM/styles van de app
  // onaangetast (CSS in PakbonExport gebruikt globale selectors).
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '210mm'
  iframe.style.minHeight = '297mm'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve()
      iframe.onerror = () => reject(new Error('iframe load failed'))
      iframe.srcdoc = html
    })
    // Kort wachten zodat fonts/images binnen het iframe geladen zijn.
    await new Promise(res => setTimeout(res, 250))

    const doc = iframe.contentDocument
    const body = doc?.body
    if (!doc || !body) throw new Error('iframe heeft geen body')

    // Posities van de blokken die heel moeten blijven, in CSS-pixels ten
    // opzichte van de bovenkant van het document. Moet vóór de capture, want
    // daarna is er alleen nog een canvas.
    const scrollTop = doc.documentElement.scrollTop || body.scrollTop || 0
    const rechthoeken = (selector: string, staart: number): PdfBlok[] =>
      Array.from(doc.querySelectorAll(selector)).map(el => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const top = r.top + scrollTop
        return {top, bottom: top + r.height + staart}
      })
    const blokkenCss: PdfBlok[] = [
      ...(opties?.blokSelector ? rechthoeken(opties.blokSelector, 0) : []),
      ...(opties?.kopSelector ? rechthoeken(opties.kopSelector, KOP_STAART_PX) : []),
    ]

    const canvas = await html2canvas(body, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: body.scrollWidth,
      height: body.scrollHeight,
      windowWidth: body.scrollWidth,
      windowHeight: body.scrollHeight,
      logging: false,
      useCORS: true,
    })

    const pdf = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4'})
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * pageW) / canvas.width

    if (blokkenCss.length) {
      // Knip de lange afbeelding in stukken die op een blokgrens eindigen en
      // plaats elk stuk als eigen pagina. Het schaalt canvas-pixels ↔ mm via
      // dezelfde verhouding als hierboven.
      const pxPerMm = canvas.height / imgH
      const cssNaarPx = canvas.height / body.scrollHeight
      const blokken = blokkenCss.map(b => ({top: b.top * cssNaarPx, bottom: b.bottom * cssNaarPx}))
      const paginas = paginaIndeling(canvas.height, pageH * pxPerMm, blokken)
      const stuk = document.createElement('canvas')
      const ctx = stuk.getContext('2d')
      paginas.forEach((p, i) => {
        stuk.width = canvas.width
        stuk.height = Math.max(1, Math.round(p.hoogte))
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, stuk.width, stuk.height)
          ctx.drawImage(canvas, 0, Math.round(p.top), canvas.width, stuk.height,
            0, 0, canvas.width, stuk.height)
        }
        if (i > 0) pdf.addPage()
        pdf.addImage(stuk.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, stuk.height / pxPerMm)
      })
    } else {
      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      // Multi-page support: schuif de image telkens een pagina hoogte omhoog.
      let position = 0
      let heightLeft = imgH
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH)
      heightLeft -= pageH
      while (heightLeft > 0) {
        position -= pageH
        pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH)
        heightLeft -= pageH
      }
    }

    const dataUri = pdf.output('datauristring')
    const idx = dataUri.indexOf('base64,')
    if (idx < 0) throw new Error('jsPDF output mist base64-segment')
    return dataUri.slice(idx + 'base64,'.length)
  } finally {
    document.body.removeChild(iframe)
  }
}

/**
 * Zet hetzelfde HTML-document als `.pdf`-bestand in de downloads van de
 * gebruiker. Bedoeld voor documenten die niet gemaild maar bewaard worden —
 * het batchdossier bij de administratie, bijvoorbeeld.
 */
export async function htmlNaarPdfDownload(
  html: string,
  bestandsnaam: string,
  opties?: {blokSelector?: string, kopSelector?: string},
): Promise<void> {
  const base64 = await htmlToPdfBase64(html, opties)
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = bestandsnaam.toLowerCase().endsWith('.pdf') ? bestandsnaam : `${bestandsnaam}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    URL.revokeObjectURL(url)
  }
}
