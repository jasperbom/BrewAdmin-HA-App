import { t } from '../../../i18n'
import { callClaudeProxy } from '../../../utils/api'
import { vulIn } from '../../../utils/periode'
import { laadPdf, pdfTekstPaginas } from '../../../utils/pdfText'
import { leesPspVerslag, type PspVerslag } from '../../../utils/pspVerslag'
import {
  verslagScanSchema, bouwVerslagPrompt, inhoudVoorVerslag, normaliseerVerslagScan, verslagInvoer, type VerslagBestand,
} from '../../../utils/pspVerslagScan'
import { voerScanUit, bytesNaarBase64, ScanFout, scanFoutSleutel } from '../../../utils/claudeScan'
import {
  naarJpeg, fotosNaarPdf, alsBestand, naamMetExtensie, SCAN_MAX_PX, FACTUUR_PAGINA_PX,
  AfbeeldingFout, afbeeldingFoutSleutel, type Jpeg,
} from '../../../utils/afbeelding'
import { UPLOAD_MAX_BYTES } from '../../../utils/bijlage'

// ── Het uitbetalingsverslag lezen (Bank) ────────────────────────────────────
// Eerst de tekstlaag van de PDF (utils/pspVerslag.ts: gratis en meteen). Lukt
// dat niet — een scan zonder tekst, een foto, een opmaak die de app niet kent —
// dan Claude (utils/pspVerslagScan.ts), als er een API-sleutel is. Beide
// leveren hetzelfde verslag op; er wordt niets gekoppeld, de gebruiker kijkt
// het na en bevestigt. Foto's worden samen één PDF-bijlage, net als bij een
// inkoopfactuur.

/** Het verslag uit de tekstlaag van een PDF; null als dat niet lukt. */
export async function leesTekstlaag(data: ArrayBuffer): Promise<PspVerslag | null> {
  try { return leesPspVerslag(await pdfTekstPaginas(await laadPdf(data))) } catch { return null }
}

export interface VerslagLezing {
  verslag: PspVerslag
  /** Wat als bijlage bewaard wordt: de PDF, of de foto's samen als één PDF. */
  bijlage: File
  /** Het model als Claude het verslag las; null = de tekstlaag. */
  model: string | null
}

/** Een fout met een tekst voor de gebruiker. */
export class VerslagFout extends Error {
  constructor(tekst: string) {
    super(tekst)
    this.name = 'VerslagFout'
  }
}

async function laatClaudeLezen(bestanden: VerslagBestand[], naam: string): Promise<{ verslag: PspVerslag, model: string }> {
  const { data, model } = await voerScanUit(callClaudeProxy, {
    inhoud: inhoudVoorVerslag(bestanden, bouwVerslagPrompt()),
    schema: verslagScanSchema(),
    maxTokens: 16000,
    effort: 'medium',
  })
  const verslag = normaliseerVerslagScan(data)
  if (!verslag) throw new VerslagFout(vulIn(t('psp_verslag_geen_claude'), { naam }))
  return { verslag, model }
}

/**
 * Lees het gekozen verslag: de eerste PDF, anders de foto's. `opClaude` wordt
 * aangeroepen vlak voordat Claude gaat lezen (dat duurt even). Gooit een
 * `VerslagFout`, `ScanFout` of `AfbeeldingFout` (zie `verslagFoutTekst`).
 */
export async function leesVerslag(files: File[], opties: { sleutel: boolean, opClaude?: () => void }): Promise<VerslagLezing> {
  const invoer = verslagInvoer(files)
  if (invoer.soort === 'onbekend') throw new VerslagFout(t('err_upload_type').replace('{naam}', files[0]?.name || ''))
  if (invoer.soort === 'pdf') {
    const pdf = files[invoer.index]
    // Eerst de grootte: een verslag dat niet bewaard kan worden, laten we ook niet lezen.
    if (pdf.size > UPLOAD_MAX_BYTES) throw new VerslagFout(t('err_upload_te_groot').replace('{naam}', pdf.name))
    const buf = await pdf.arrayBuffer()
    const uitTekst = await leesTekstlaag(buf)
    if (uitTekst) return { verslag: uitTekst, bijlage: pdf, model: null }
    if (!opties.sleutel) throw new VerslagFout(vulIn(t('psp_verslag_geen'), { naam: pdf.name }))
    opties.opClaude?.()
    const { verslag, model } = await laatClaudeLezen([{ soort: 'pdf', base64: bytesNaarBase64(buf) }], pdf.name)
    return { verslag, bijlage: pdf, model }
  }
  const fotos = invoer.indexen.map(i => files[i])
  if (!opties.sleutel) throw new VerslagFout(t('psp_verslag_foto_geen_sleutel'))
  const scans: Jpeg[] = []
  const archief: Jpeg[] = []
  for (const f of fotos) {
    scans.push(await naarJpeg(f, SCAN_MAX_PX))
    archief.push(await naarJpeg(f, FACTUUR_PAGINA_PX, 0.8))
  }
  const bijlage = alsBestand(fotosNaarPdf(archief), naamMetExtensie(fotos[0].name, 'pdf'))
  if (bijlage.size > UPLOAD_MAX_BYTES) throw new VerslagFout(t('err_upload_te_groot').replace('{naam}', bijlage.name))
  opties.opClaude?.()
  const { verslag, model } = await laatClaudeLezen(scans.map(s => ({ soort: 'afbeelding' as const, base64: s.base64 })), fotos[0].name)
  return { verslag, bijlage, model }
}

/** De tekst bij een fout van `leesVerslag`. */
export function verslagFoutTekst(e: unknown): string {
  if (e instanceof VerslagFout) return e.message
  if (e instanceof ScanFout) return t(scanFoutSleutel(e.code))
  if (e instanceof AfbeeldingFout) return t(afbeeldingFoutSleutel(e.code))
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message || '') : ''
  return m ? vulIn(t('psp_verslag_claude_fout'), { fout: m }) : t('scan_fout_leeg')
}
