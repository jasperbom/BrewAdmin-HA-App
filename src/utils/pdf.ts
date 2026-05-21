/**
 * pdf.ts — client-side PDF generatie.
 * Rendert een complete standalone HTML-pagina (zoals door `buildPakbonHTML` /
 * `buildFactuurHTML` aangeleverd) in een verborgen iframe, captureert de
 * inhoud met html2canvas en pakt het in een A4-PDF met jsPDF.
 *
 * Returnt base64 zonder `data:`-prefix — direct bruikbaar als
 * `attachments[].contentBase64` in `mailSendApi`.
 */
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function htmlToPdfBase64(html: string): Promise<string> {
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

    const dataUri = pdf.output('datauristring')
    const idx = dataUri.indexOf('base64,')
    if (idx < 0) throw new Error('jsPDF output mist base64-segment')
    return dataUri.slice(idx + 'base64,'.length)
  } finally {
    document.body.removeChild(iframe)
  }
}
