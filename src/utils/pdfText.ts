// Gedeelde PDF-tekstextractie — pdfjs-dist wordt meegebundeld. Gebruikt door
// de inkoopfactuur-scan en het waterprofiel-gereedschap.
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfPaginaTekst, PdfTekstItem } from './pdfZoek'
// Worker als blob-URL uit de gebundelde source: de single-file build heeft
// geen losse asset-bestanden en de CSP staat alleen `worker-src blob:` toe.
// @ts-ignore — Vite ?raw-import heeft geen type-declaratie
import pdfWorkerRaw from 'pdfjs-dist/build/pdf.worker.min.js?raw'

let _pdfWorkerReady = false
const _ensurePdfWorker = () => {
  if (_pdfWorkerReady) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
    new Blob([pdfWorkerRaw], {type: 'text/javascript'}))
  _pdfWorkerReady = true
}

/** Open een PDF met pdf.js — voor de tekst en voor het tekenen in het
 *  inkoopformulier (een ingebedde PDF toont op een telefoon maar één pagina).
 *  isEvalSupported: false — mitigatie voor CVE-2024-4367 (JS-executie via een
 *  kwaadaardig PDF-font); bestanden komen van externe partijen. */
export async function laadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  _ensurePdfWorker()
  // pdf.js neemt de buffer over; een kopie houdt het origineel bruikbaar.
  return pdfjsLib.getDocument({data: new Uint8Array(data.slice(0)), isEvalSupported: false}).promise
}

/** De tekstlaag per pagina in paginacoördinaten (oorsprong linksboven, schaal
 *  1), voor utils/pdfZoek.ts. Een gescande PDF zonder tekstlaag geeft lege pagina's. */
export async function pdfTekstPaginas(pdf: PDFDocumentProxy, maxPaginas = 20): Promise<PdfPaginaTekst[]> {
  const uit: PdfPaginaTekst[] = []
  const n = Math.min(pdf.numPages, maxPaginas)
  for (let p = 1; p <= n; p++) {
    const page: PDFPageProxy = await pdf.getPage(p)
    const viewport = page.getViewport({scale: 1})
    const content = await page.getTextContent()
    const items: PdfTekstItem[] = []
    for (const raw of content.items as any[]) {
      if (!raw || typeof raw.str !== 'string' || !raw.str.trim() || !Array.isArray(raw.transform)) continue
      const [vx, vy] = viewport.convertToViewportPoint(Number(raw.transform[4]) || 0, Number(raw.transform[5]) || 0)
      const h = Math.abs(Number(raw.height) || Math.hypot(Number(raw.transform[2]) || 0, Number(raw.transform[3]) || 0)) || 8
      items.push({str: raw.str, x: vx, y: vy - h, b: Math.abs(Number(raw.width) || 0), h})
    }
    uit.push({pagina: p, items})
  }
  return uit
}

export async function extractPdfText(file: File): Promise<string> {
  try {
    const pdf = await laadPdf(await file.arrayBuffer())
    let text = ''
    const pages = pdf.numPages
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const byLine: Record<number, any[]> = {}
      for (const item of (content as any).items) {
        const y = Math.round(item.transform[5])
        if (!byLine[y]) byLine[y] = []
        byLine[y].push(item)
      }
      const sortedYs = Object.keys(byLine).map(Number).sort((a, b) => b - a)
      for (const y of sortedYs) {
        const lineText = byLine[y].sort((a: any, b: any) => a.transform[4] - b.transform[4]).map((i: any) => i.str).join(' ').trim()
        if (lineText) text += lineText + '\n'
      }
    }
    return text.trim()
  } catch(e) { return '' }
}
