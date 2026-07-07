// Gedeelde PDF-tekstextractie — pdfjs-dist wordt meegebundeld. Gebruikt door
// de inkoopfactuur-scan en het waterprofiel-gereedschap.
import * as pdfjsLib from 'pdfjs-dist'
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

export async function extractPdfText(file: File): Promise<string> {
  try {
    _ensurePdfWorker()
    const ab = await file.arrayBuffer()
    // isEvalSupported: false — mitigatie voor CVE-2024-4367 (JS-executie via
    // een kwaadaardig PDF-font); bestanden komen van externe partijen.
    const pdf = await pdfjsLib.getDocument({data: ab, isEvalSupported: false}).promise
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
