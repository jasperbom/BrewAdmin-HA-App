import React from 'react'
import { t } from '../../i18n'
import EtiketFotos, { type EtiketStatus } from './EtiketFotos'
import { ADDON_BASE, callClaudeProxy } from '../../utils/api'
import { voerScanUit, ScanFout, scanFoutSleutel } from '../../utils/claudeScan'
import {
  etiketSchema, bouwEtiketPrompt, inhoudVoorEtiket, normaliseerEtiketScan, productKlopt, etiketVoorLot, kiesEtiketLot,
  type EtiketScan, type LotVelden,
} from '../../utils/etiketScan'
import { naarJpeg, naamMetExtensie, AfbeeldingFout, afbeeldingFoutSleutel, SCAN_MAX_PX, ARCHIEF_MAX_PX, type Jpeg } from '../../utils/afbeelding'
import type { Bijlage } from '../../utils/bijlage'

/** Een nieuwe etiketfoto in het lotvenster; het archiefformaat gaat bij Opslaan naar de server. */
export interface LotFoto {
  id: number
  naam: string
  scan: Jpeg
  archief: Jpeg
  url: string
}

interface LotEtiketProps {
  /** Foto's die al bij het lot horen (bewijs: niet weg te halen). */
  bestaand: Bijlage[]
  nieuw: LotFoto[]
  setNieuw: (f: (prev: LotFoto[]) => LotFoto[]) => void
  waarden: LotVelden
  onToepassen: (lot: LotVelden) => void
  type: string
  ingNaam: string
  heeftSleutel: boolean
  ingTypes: string[]
}

let teller = 0
const MAX_FOTOS = 8

/**
 * Etiketfoto's bij een lot dat al in de voorraad staat: wat er al bij hoort
 * staat erboven, een nieuwe foto wordt meteen gelezen en vult lotnummer, THT
 * en eigenschappen aan (wat de gebruiker zelf invulde blijft staan). Noemt
 * het etiket meer lotnummers, dan kies je welke bij dit lot hoort.
 */
const LotEtiket: React.FC<LotEtiketProps> = ({ bestaand, nieuw, setNieuw, waarden, onToepassen, type, ingNaam, heeftSleutel, ingTypes }) => {
  const [status, setStatus] = React.useState<EtiketStatus>('leeg')
  const [fout, setFout] = React.useState<string | null>(null)
  const [scan, setScan] = React.useState<EtiketScan | null>(null)
  const [oordeel, setOordeel] = React.useState<'ja' | 'nee' | 'onbekend' | null>(null)
  const [nietToegepast, setNietToegepast] = React.useState(false)
  const [lotIndex, setLotIndex] = React.useState<number | null>(null)
  const eerder = React.useRef<string[]>([])
  const versie = React.useRef(0)
  const waardenRef = React.useRef(waarden)
  waardenRef.current = waarden
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const pasToe = (s: EtiketScan, index: number | null) => {
    const uit = etiketVoorLot(waardenRef.current, s, { type, eerder: eerder.current, lotIndex: index })
    eerder.current = uit.velden
    onToepassen(uit.lot)
  }

  const lees = async (fotos: LotFoto[]) => {
    if (!fotos.length) return
    const v = ++versie.current
    setStatus('bezig'); setFout(null)
    try {
      const prompt = bouwEtiketPrompt({ aantalFotos: fotos.length, naam: ingNaam, type, ingTypes })
      const { data } = await voerScanUit(callClaudeProxy, {
        inhoud: inhoudVoorEtiket(fotos.map(f => f.scan.base64), prompt), schema: etiketSchema(ingTypes), maxTokens: 8000, effort: 'medium',
      })
      if (v !== versie.current) return
      const s = normaliseerEtiketScan(data, { ingTypes })
      const o = ingNaam ? productKlopt(s, ingNaam) : 'onbekend'
      setScan(s); setOordeel(o); setStatus('klaar')
      if (!s.leesbaar || o === 'nee') { setNietToegepast(s.leesbaar && o === 'nee'); return }
      setNietToegepast(false)
      const index = kiesEtiketLot(s, waardenRef.current.lotnummer, null)
      setLotIndex(index)
      pasToe(s, index)
    } catch (e) {
      if (v !== versie.current) return
      setStatus('fout')
      setFout(e instanceof ScanFout ? t(scanFoutSleutel(e.code)) : (e instanceof Error && e.message) || t('scan_fout_leeg'))
    }
  }

  const voegToe = async (files: File[]) => {
    setStatus('bezig'); setFout(null)
    const erbij: LotFoto[] = []
    for (const f of files.slice(0, Math.max(0, MAX_FOTOS - nieuw.length))) {
      try {
        const s = await naarJpeg(f, SCAN_MAX_PX)
        const a = await naarJpeg(f, ARCHIEF_MAX_PX, 0.82)
        erbij.push({ id: Date.now() * 1000 + (teller++ % 1000), naam: naamMetExtensie(f.name, 'jpg'), scan: s, archief: a, url: URL.createObjectURL(s.blob) })
      } catch (e) {
        setFout(e instanceof AfbeeldingFout ? t(afbeeldingFoutSleutel(e.code)) : t('err_foto_onleesbaar'))
      }
    }
    if (!erbij.length) { setStatus(scan ? 'klaar' : 'fout'); return }
    const alle = [...nieuw, ...erbij]
    setNieuw(prev => [...prev, ...erbij])
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void lees(alle) }, 300)
  }

  const verwijder = (id: number) => {
    const f = nieuw.find(x => x.id === id)
    if (f) URL.revokeObjectURL(f.url)
    const rest = nieuw.filter(x => x.id !== id)
    setNieuw(prev => prev.filter(x => x.id !== id))
    if (!rest.length) { versie.current++; setStatus('leeg'); setScan(null); setOordeel(null) }
  }

  const keuze = scan && scan.lots.length > 1 && !nietToegepast ? (
    <div className="space-y-1">
      <p className="text-xs text-gray-600">{t('lot_etiket_kies')}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('lot_etiket_kies')}>
        {scan.lots.map((l, i) => (
          <button key={l.lotnummer} type="button" role="radio" aria-checked={lotIndex === i}
            onClick={() => { setLotIndex(i); pasToe(scan, i) }}
            className={`px-2.5 min-h-[36px] rounded-full text-sm border ${lotIndex === i ? 'border-[var(--t-accent)] t-panel font-semibold' : 'border-gray-300 bg-white text-gray-700'}`}>
            {l.lotnummer}
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-500">{t('lot_etiket_titel')}</div>
      {bestaand.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bestaand.map(b => (
            <a key={b.bestand} href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer"
              title={b.naam} className="block w-16 h-16 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
              <img src={`${ADDON_BASE}api/file/${b.bestand}`} alt={b.naam} className="w-full h-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <EtiketFotos fotos={nieuw.map(f => ({ id: f.id, naam: f.naam, url: f.url }))} status={status} fout={fout} scan={scan}
        oordeel={oordeel} nietToegepast={nietToegepast} heeftSleutel={heeftSleutel}
        bewaren onBewaren={() => {}} toonBewaren={false}
        ingevuld={eerder.current.length ? t('lot_etiket_ingevuld') : null}
        onVoegToe={files => { void voegToe(files) }} onVerwijder={verwijder}
        onOpnieuw={() => { void lees(nieuw) }}
        onTochToepassen={() => { if (scan) { setNietToegepast(false); const i = kiesEtiketLot(scan, waarden.lotnummer, null); setLotIndex(i); pasToe(scan, i) } }}
        extra={keuze} context="lot" />
      {nieuw.length > 0 && <p className="text-xs text-gray-500">{t('lot_etiket_bij_opslaan').replace('{n}', String(nieuw.length))}</p>}
    </div>
  )
}

export default LotEtiket
