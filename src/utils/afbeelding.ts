// Foto's voor de scans en het archief: verkleinen en omzetten naar JPEG.
//
// De scan leest alleen JPEG, PNG, GIF en WebP — geen HEIC (iPhone), TIFF of
// BMP — en een telefoonfoto van 12 megapixel is veel groter dan nodig: het
// model schaalt alles boven 2576 px aan de lange kant toch terug. Daarom gaat
// elke foto eerst door een canvas. Wat de browser kan openen (Safari opent ook
// HEIC) komt er als JPEG uit, in de maat die bij het doel past.
//
// Meerdere foto's van één factuur (pagina's) worden samen één PDF-bijlage:
// een inkoopfactuur heeft één bijlage, en zo blijft het hele document bij de
// boeking.
//
// De rekenregels zijn puur (en getest); het tekenen gebeurt in de browser.

import jsPDF from 'jspdf'
import { bytesNaarBase64 } from './claudeScan'

/** Lange kant voor een foto die naar de scan gaat. */
export const SCAN_MAX_PX = 2576
/** Lange kant voor een etiketfoto die bij het lot bewaard wordt. */
export const ARCHIEF_MAX_PX = 1600
/** Lange kant voor een factuurpagina in de PDF-bijlage (leesbaar bij afdrukken). */
export const FACTUUR_PAGINA_PX = 2000

export interface Maat { b: number, h: number }

/** Afmetingen binnen een maximum voor de lange kant, met behoud van de
 *  verhouding. Een kleinere foto wordt nooit vergroot. */
export const schaalBinnen = (b: number, h: number, max: number): Maat => {
  if (!(b > 0) || !(h > 0)) return { b: 0, h: 0 }
  const lang = Math.max(b, h)
  if (lang <= max) return { b: Math.round(b), h: Math.round(h) }
  const f = max / lang
  return { b: Math.max(1, Math.round(b * f)), h: Math.max(1, Math.round(h * f)) }
}

interface BestandInfo { type?: string, name?: string }

const extensie = (naam: string | undefined): string => (String(naam || '').split('.').pop() || '').toLowerCase()

export const isPdfBestand = (f: BestandInfo | null | undefined): boolean =>
  !!f && (f.type === 'application/pdf' || extensie(f.name) === 'pdf')

const FOTO_EXTENSIES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'avif']

export const isFotoBestand = (f: BestandInfo | null | undefined): boolean =>
  !!f && !isPdfBestand(f) && ((f.type || '').startsWith('image/') || FOTO_EXTENSIES.includes(extensie(f.name)))

/** HEIC/HEIF: alleen Safari opent dat; de foutmelding noemt het apart. */
export const isHeic = (f: BestandInfo | null | undefined): boolean =>
  !!f && (/hei[cf]/i.test(f.type || '') || ['heic', 'heif'].includes(extensie(f.name)))

/** Aantal bytes van een base64-tekst (zonder `data:`-prefix). */
export const base64Bytes = (b64: string): number => {
  const s = String(b64 || '')
  if (!s) return 0
  const opvulling = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.floor(s.length * 3 / 4) - opvulling
}

export interface PdfPagina {
  orientatie: 'p' | 'l'
  /** Plaats van de foto op de pagina, in mm. */
  x: number
  y: number
  b: number
  h: number
}

/** A4 staand of liggend (wat bij de foto past), de foto passend met een marge. */
export const pdfPaginaVoorFoto = (b: number, h: number, margeMm = 8): PdfPagina => {
  const liggend = b > h
  const pb = liggend ? 297 : 210
  const ph = liggend ? 210 : 297
  const vb = pb - 2 * margeMm
  const vh = ph - 2 * margeMm
  const f = b > 0 && h > 0 ? Math.min(vb / b, vh / h) : 0
  const ib = b * f
  const ih = h * f
  return { orientatie: liggend ? 'l' : 'p', x: (pb - ib) / 2, y: (ph - ih) / 2, b: ib, h: ih }
}

// ── Browser ─────────────────────────────────────────────────────────────────

export type AfbeeldingFoutCode = 'onleesbaar' | 'heic'

export class AfbeeldingFout extends Error {
  code: AfbeeldingFoutCode
  constructor(code: AfbeeldingFoutCode) {
    super(code)
    this.code = code
    this.name = 'AfbeeldingFout'
  }
}

/** i18n-sleutel voor een `AfbeeldingFout`. */
export const afbeeldingFoutSleutel = (code: AfbeeldingFoutCode): string => `err_foto_${code}`

const laadAfbeelding = (bron: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(bron)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('laden')) }
  img.src = url
})

export interface Jpeg {
  blob: Blob
  base64: string
  b: number
  h: number
}

/** Teken een foto opnieuw als JPEG, met de lange kant hooguit `maxPx`. De
 *  browser draait de foto volgens de EXIF-oriëntatie, dus een staande
 *  telefoonfoto blijft staan. */
export const naarJpeg = async (bron: Blob & BestandInfo, maxPx: number, kwaliteit = 0.86): Promise<Jpeg> => {
  let img: HTMLImageElement
  try {
    img = await laadAfbeelding(bron)
  } catch {
    throw new AfbeeldingFout(isHeic(bron) ? 'heic' : 'onleesbaar')
  }
  const maat = schaalBinnen(img.naturalWidth || img.width, img.naturalHeight || img.height, maxPx)
  if (!maat.b || !maat.h) throw new AfbeeldingFout('onleesbaar')
  const canvas = document.createElement('canvas')
  canvas.width = maat.b
  canvas.height = maat.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AfbeeldingFout('onleesbaar')
  // Wit eronder: een transparante PNG wordt anders zwart in JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, maat.b, maat.h)
  ctx.drawImage(img, 0, 0, maat.b, maat.h)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', kwaliteit))
  if (!blob) throw new AfbeeldingFout('onleesbaar')
  return { blob, base64: bytesNaarBase64(await blob.arrayBuffer()), b: maat.b, h: maat.h }
}

/** Foto's (JPEG) als pagina's van één PDF. */
export const fotosNaarPdf = (fotos: Jpeg[]): Blob => {
  let doc: jsPDF | null = null
  for (const f of fotos) {
    const p = pdfPaginaVoorFoto(f.b, f.h)
    if (!doc) doc = new jsPDF({ orientation: p.orientatie, unit: 'mm', format: 'a4', compress: true })
    else doc.addPage('a4', p.orientatie)
    doc.addImage(`data:image/jpeg;base64,${f.base64}`, 'JPEG', p.x, p.y, p.b, p.h)
  }
  if (!doc) throw new AfbeeldingFout('onleesbaar')
  return doc.output('blob')
}

/** Een `File` met een andere naam en inhoud (de JPEG of PDF die we maakten). */
export const alsBestand = (blob: Blob, naam: string): File =>
  new File([blob], naam, { type: blob.type || 'application/octet-stream' })

/** `foto.HEIC` → `foto.jpg`. */
export const naamMetExtensie = (naam: string, ext: string): string => {
  const kaal = String(naam || '').replace(/\.[^./\\]*$/, '')
  return `${kaal || 'foto'}.${ext}`
}
