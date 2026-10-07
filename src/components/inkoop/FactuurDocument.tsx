import React from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { t } from '../../i18n'
import Icon from '../ui/Icon'
import { laadPdf, pdfTekstPaginas } from '../../utils/pdfText'
import { zoekRegelInPdf, type PdfPaginaTekst, type PdfTreffer } from '../../utils/pdfZoek'

export type DocumentBron =
  | { soort: 'pdf', file: File }
  | { soort: 'fotos', fotos: Array<{ url: string, naam: string }> }

export interface Markering {
  tekst: string
  bedrag?: number | null
}

interface FactuurDocumentProps {
  bron: DocumentBron
  naam: string
  markering?: Markering | null
  /** Smal scherm: knijpen om te zoomen, geen kopregel met zoomknoppen. */
  smal?: boolean
  /** Link om het origineel te openen (bijvoorbeeld de bijlage op de server). */
  origineelUrl?: string | null
  onVervang?: () => void
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const MAX_PAGINAS = 20
const klem = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/**
 * De factuur naast (of op een telefoon: boven) het formulier. Een PDF wordt
 * met pdf.js getekend in plaats van ingebed: een ingebedde PDF toont op een
 * telefoon maar één pagina en is daar niet te zoomen. Staat de regel die open
 * is in de tekstlaag, dan krijgt hij een markering.
 */
const FactuurDocument: React.FC<FactuurDocumentProps> = ({ bron, naam, markering, smal = false, origineelUrl, onVervang }) => {
  const houderRef = React.useRef<HTMLDivElement | null>(null)
  const inhoudRef = React.useRef<HTMLDivElement | null>(null)
  const markeringRef = React.useRef<HTMLDivElement | null>(null)
  const [breedte, setBreedte] = React.useState(0)
  const [zoom, setZoom] = React.useState(1)
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null)
  const [paginaMaten, setPaginaMaten] = React.useState<Array<{ b: number, h: number }>>([])
  const [tekst, setTekst] = React.useState<PdfPaginaTekst[]>([])
  const [status, setStatus] = React.useState<'laden' | 'klaar' | 'fout'>('laden')

  // Breedte van de houder: de pagina's vullen hem bij 100%.
  React.useEffect(() => {
    const el = houderRef.current
    if (!el) return
    const meet = () => setBreedte(Math.max(0, el.clientWidth - (smal ? 16 : 32)))
    meet()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(meet)
    ro.observe(el)
    return () => ro.disconnect()
  }, [smal])

  // PDF openen (en sluiten bij een ander bestand).
  const pdfFile = bron.soort === 'pdf' ? bron.file : null
  React.useEffect(() => {
    if (!pdfFile) { setPdf(null); setStatus('klaar'); return }
    let actueel = true
    let doc: PDFDocumentProxy | null = null
    setStatus('laden')
    setPdf(null)
    setTekst([])
    ;(async () => {
      try {
        doc = await laadPdf(await pdfFile.arrayBuffer())
        if (!actueel) { void doc.destroy(); return }
        const maten: Array<{ b: number, h: number }> = []
        for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
          const vp = (await doc.getPage(p)).getViewport({ scale: 1 })
          maten.push({ b: vp.width, h: vp.height })
        }
        if (!actueel) return
        setPaginaMaten(maten)
        setPdf(doc)
        setStatus('klaar')
        // De tekstlaag alleen voor de markering; een scan zonder tekst geeft niets.
        pdfTekstPaginas(doc, MAX_PAGINAS).then(tk => { if (actueel) setTekst(tk) }).catch(() => {})
      } catch {
        if (actueel) setStatus('fout')
      }
    })()
    return () => { actueel = false; if (doc) void doc.destroy() }
  }, [pdfFile])

  const paginaBreedte = Math.max(120, Math.round(breedte * zoom))

  const treffer: PdfTreffer | null = React.useMemo(
    () => (markering && tekst.length ? zoekRegelInPdf(tekst, markering) : null),
    [markering?.tekst, markering?.bedrag, tekst], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // De markering in beeld schuiven als een andere regel opengaat.
  React.useEffect(() => {
    if (!treffer) return
    const el = markeringRef.current
    const houder = houderRef.current
    if (!el || !houder) return
    const r = el.getBoundingClientRect()
    const h = houder.getBoundingClientRect()
    if (r.top < h.top + 40 || r.bottom > h.bottom - 40) {
      houder.scrollBy({ top: r.top - h.top - h.height / 3, behavior: 'smooth' })
    }
  }, [treffer, paginaBreedte])

  // ── Knijpen om te zoomen (telefoon) ───────────────────────────────────
  const knijp = React.useRef<{ afstand: number, zoom: number, k: number } | null>(null)
  const afstand = (e: React.TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]]
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) knijp.current = { afstand: afstand(e), zoom, k: 1 }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const k = knijp.current
    if (!k || e.touches.length !== 2) return
    k.k = klem(k.zoom * afstand(e) / k.afstand) / k.zoom
    // Live met een transform; het scherp tekenen gebeurt bij het loslaten.
    if (inhoudRef.current) inhoudRef.current.style.transform = `scale(${k.k})`
  }
  const onTouchEnd = () => {
    const k = knijp.current
    if (!k) return
    knijp.current = null
    if (inhoudRef.current) inhoudRef.current.style.transform = ''
    setZoom(klem(k.zoom * k.k))
  }

  const aantalPaginas = bron.soort === 'pdf' ? paginaMaten.length : bron.fotos.length

  return (
    <div className="flex flex-col min-h-0 h-full bg-gray-100">
      {!smal && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm">
          <Icon n={bron.soort === 'pdf' ? 'file' : 'image'} cls="text-gray-500" />
          <span className="font-medium text-gray-800 truncate min-w-0" title={naam}>{naam}</span>
          {aantalPaginas > 0 && (
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {aantalPaginas === 1 ? t('inkoop_doc_een_pagina') : t('inkoop_doc_paginas').replace('{n}', String(aantalPaginas))}
            </span>
          )}
          <span className="flex-1" />
          <div className="flex items-center gap-0.5" role="group" aria-label={t('inkoop_doc_zoom')}>
            <button type="button" onClick={() => setZoom(z => klem(z - 0.25))} disabled={zoom <= ZOOM_MIN}
              aria-label={t('inkoop_doc_uitzoomen')}
              className="w-8 h-8 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">−</button>
            <button type="button" onClick={() => setZoom(1)} title={t('inkoop_doc_passend')}
              className="min-w-[3.25rem] h-8 rounded-md text-xs text-gray-600 hover:bg-gray-100 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => setZoom(z => klem(z + 0.25))} disabled={zoom >= ZOOM_MAX}
              aria-label={t('inkoop_doc_inzoomen')}
              className="w-8 h-8 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">+</button>
          </div>
          {origineelUrl && (
            <a href={origineelUrl} target="_blank" rel="noopener noreferrer" title={t('inkoop_doc_origineel')}
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <Icon n="download" label={t('inkoop_doc_origineel')} />
            </a>
          )}
          {onVervang && (
            <button type="button" onClick={onVervang}
              className="px-2 h-8 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {t('inkoop_doc_vervang')}
            </button>
          )}
        </div>
      )}
      <div ref={houderRef}
        className={`flex-1 min-h-0 overflow-auto ${smal ? 'p-2' : 'p-4'}`}
        style={smal ? { touchAction: 'pan-x pan-y' } : undefined}
        onTouchStart={smal ? onTouchStart : undefined}
        onTouchMove={smal ? onTouchMove : undefined}
        onTouchEnd={smal ? onTouchEnd : undefined}
        onTouchCancel={smal ? onTouchEnd : undefined}>
        {status === 'laden' && bron.soort === 'pdf' && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
            <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-[var(--t-accent)] animate-spin" aria-hidden="true" />
            {t('inkoop_doc_laden')}
          </div>
        )}
        {status === 'fout' && (
          <div className="py-16 text-center text-sm text-gray-600">
            <p>⚠ {t('inkoop_doc_fout')}</p>
          </div>
        )}
        <div ref={inhoudRef} className="mx-auto space-y-3" style={{ width: paginaBreedte, transformOrigin: 'top center' }}>
          {bron.soort === 'pdf' && pdf && breedte > 0 && paginaMaten.map((m, i) => (
            <PdfPagina key={i} pdf={pdf} pagina={i + 1} breedte={paginaBreedte} maat={m}
              markering={treffer && treffer.pagina === i + 1 ? treffer : null} markeringRef={markeringRef}
              label={t('inkoop_doc_pagina_n').replace('{n}', String(i + 1))} />
          ))}
          {bron.soort === 'fotos' && bron.fotos.map((f, i) => (
            <img key={f.url} src={f.url} alt={t('inkoop_doc_pagina_n').replace('{n}', String(i + 1))}
              className="block w-full bg-white shadow-sm rounded-sm" draggable={false} />
          ))}
        </div>
        {smal && aantalPaginas > 0 && (
          <p className="text-center text-xs text-gray-500 py-3">
            {(aantalPaginas === 1 ? t('inkoop_doc_een_pagina') : t('inkoop_doc_paginas').replace('{n}', String(aantalPaginas)))}
            {' · '}{t('inkoop_doc_knijp')}
          </p>
        )}
      </div>
    </div>
  )
}

interface PdfPaginaProps {
  pdf: PDFDocumentProxy
  pagina: number
  breedte: number
  maat: { b: number, h: number }
  markering: PdfTreffer | null
  markeringRef: React.MutableRefObject<HTMLDivElement | null>
  label: string
}

/** Eén pagina op een canvas, scherp op het scherm (devicePixelRatio). */
const PdfPagina: React.FC<PdfPaginaProps> = ({ pdf, pagina, breedte, maat, markering, markeringRef, label }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const schaal = breedte / maat.b
  const hoogte = Math.round(maat.h * schaal)
  React.useEffect(() => {
    let taak: RenderTask | null = null
    let actueel = true
    // Kort uitstellen: tijdens het zoomen niet elke tussenstand tekenen.
    const timer = setTimeout(async () => {
      try {
        const page = await pdf.getPage(pagina)
        const canvas = canvasRef.current
        if (!actueel || !canvas) return
        const dpr = Math.min(3, window.devicePixelRatio || 1)
        const vp = page.getViewport({ scale: schaal * dpr })
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        taak = page.render({ canvasContext: ctx, viewport: vp })
        await taak.promise
      } catch { /* geannuleerd of mislukt: de volgende render probeert het opnieuw */ }
    }, 60)
    return () => { actueel = false; clearTimeout(timer); taak?.cancel() }
  }, [pdf, pagina, schaal])
  return (
    <div className="relative bg-white shadow-sm rounded-sm" style={{ width: breedte, height: hoogte }}>
      <canvas ref={canvasRef} role="img" aria-label={label} style={{ width: breedte, height: hoogte, display: 'block' }} />
      {markering && (
        <div ref={markeringRef} aria-hidden="true"
          className="absolute rounded pointer-events-none"
          style={{
            left: (markering.x - 4) * schaal, top: (markering.y - 3) * schaal,
            width: (markering.b + 8) * schaal, height: (markering.h + 6) * schaal,
            border: '1.5px solid var(--t-accent)',
          }}>
          <div className="absolute inset-0 rounded opacity-[0.14]" style={{ background: 'var(--t-accent)' }} />
        </div>
      )}
    </div>
  )
}

export default FactuurDocument
