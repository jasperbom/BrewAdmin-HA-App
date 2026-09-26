// Bijlagen (foto of PDF) bij een afboeking of vernietiging — POST /api/upload.
// Eén helper voor de batchflow (VernietigingSection) en de productenpagina:
// die hadden elk een eigen kopie die een mislukte upload stil liet wegvallen.
// De gebruiker zag dan "verklaring-bijlage verplicht" terwijl hij er net één
// had gekozen.
import { ADDON_BASE } from './api'

export interface Bijlage {
  naam: string
  bestand: string
}

// Plat (geen discriminated union): de pagina's draaien zonder strict, en daar
// vernauwt TypeScript niet op `ok`.
export interface UploadUitkomst {
  ok: boolean
  naam: string       // bestandsnaam zoals gekozen (voor de melding)
  status: number     // HTTP-status; 0 = netwerk, UPLOAD_TYPE_ONBEKEND = type
  bijlage?: Bijlage  // alleen bij ok
}

// Dezelfde lijst als de server (`_valid_upload_filename`): wat hier niet in
// staat weigert hij toch, dus liever meteen zeggen.
export const UPLOAD_EXTENSIES = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp']

// Status van een upload die niet eens verstuurd is: bestandstype niet toegestaan.
export const UPLOAD_TYPE_ONBEKEND = 415

export const bijlageExtensie = (bestandsnaam: string): string =>
  (bestandsnaam.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const naarBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(bin)
}

// Upload één bestand. De server wijkt bij een naambotsing uit naar een vrije
// naam (`bestand` in het antwoord) — díé naam bewaren we.
export const uploadBijlage = async (file: File, prefix: string): Promise<UploadUitkomst> => {
  const ext = bijlageExtensie(file.name)
  if (!UPLOAD_EXTENSIES.includes(ext)) return { ok: false, status: UPLOAD_TYPE_ONBEKEND, naam: file.name }
  const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}.${ext}`
  try {
    const data = naarBase64(await file.arrayBuffer())
    const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
    if (!resp.ok) return { ok: false, status: resp.status, naam: file.name }
    const d = await resp.json().catch(() => ({}))
    const bestand = d && typeof d.bestand === 'string' && d.bestand ? d.bestand : filename
    return { ok: true, status: resp.status, naam: file.name, bijlage: { naam: file.name, bestand } }
  } catch {
    return { ok: false, status: 0, naam: file.name }
  }
}

// i18n-sleutel voor een mislukte upload; de melding krijgt {naam} mee.
export const uploadFoutSleutel = (status: number): string =>
  status === 403 ? 'err_upload_geweigerd_rol'
    : status === UPLOAD_TYPE_ONBEKEND ? 'err_upload_type'
      : 'err_upload_mislukt'
