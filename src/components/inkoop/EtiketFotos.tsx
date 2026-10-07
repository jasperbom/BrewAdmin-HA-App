import React from 'react'
import { t } from '../../i18n'
import Icon from '../ui/Icon'
import { isAanraakscherm } from '../ui/useSmalScherm'
import type { EtiketScan } from '../../utils/etiketScan'

export interface EtiketFoto {
  id: number
  naam: string
  /** Weergave (object-URL van de JPEG, of /api/file/… voor een bewaarde foto). */
  url: string
}

export type EtiketStatus = 'leeg' | 'bezig' | 'klaar' | 'fout'

interface EtiketFotosProps {
  fotos: EtiketFoto[]
  status: EtiketStatus
  fout?: string | null
  scan?: EtiketScan | null
  /** Klopt het product op het etiket met de regel? */
  oordeel?: 'ja' | 'nee' | 'onbekend' | null
  /** Het etiket werd niet toegepast omdat het bij een ander product hoort. */
  nietToegepast?: boolean
  /** Wat er is ingevuld, bv. "Lot, THT en kleur ingevuld". */
  ingevuld?: string | null
  /** Het etiket noemt een ander lotnummer dan de gebruiker invulde. */
  lotWijktAf?: boolean
  heeftSleutel: boolean
  bewaren: boolean
  onBewaren: (aan: boolean) => void
  /** Het vinkje "bewaren bij het lot" (niet in het lotvenster: daar horen ze altijd bij het lot). */
  toonBewaren?: boolean
  /** Extra regel onder de uitkomst (bijvoorbeeld de keuze tussen lotnummers). */
  extra?: React.ReactNode
  /** Een inkoopregel (kan meer lots worden) of een bestaand lot. */
  context?: 'regel' | 'lot'
  onVoegToe: (files: File[]) => void
  onVerwijder: (id: number) => void
  onOpnieuw: () => void
  onTochToepassen: () => void
}

/**
 * Foto's van het etiket bij één regel. Meer foto's mag: een close-up als de
 * tekst klein is, of een foto per zak als de lotnummers verschillen. Alle
 * foto's gaan samen naar de scan; die vult lotnummer(s), THT en de
 * eigenschappen in die op het etiket staan.
 */
const EtiketFotos: React.FC<EtiketFotosProps> = ({
  fotos, status, fout, scan, oordeel, nietToegepast, ingevuld, lotWijktAf, heeftSleutel,
  bewaren, onBewaren, onVoegToe, onVerwijder, onOpnieuw, onTochToepassen, toonBewaren = true, extra, context = 'regel',
}) => {
  const lotContext = context === 'lot'
  const cameraRef = React.useRef<HTMLInputElement | null>(null)
  const galerijRef = React.useRef<HTMLInputElement | null>(null)
  const [groot, setGroot] = React.useState<EtiketFoto | null>(null)
  const [sleept, setSleept] = React.useState(false)
  const aanraak = isAanraakscherm()

  // Escape sluit eerst de grote foto, niet het formulier eromheen.
  React.useEffect(() => {
    if (!groot) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setGroot(null) } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [groot])

  const kies = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) onVoegToe(files)
  }
  const drop = (e: React.DragEvent) => {
    e.preventDefault()
    setSleept(false)
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (files.length) onVoegToe(files)
  }

  const invoer = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={kies} />
      <input ref={galerijRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={kies} />
    </>
  )
  // Op een telefoon opent de hoofdknop de camera; "uit je foto's" kiest uit de galerij.
  const neemFoto = () => (aanraak ? cameraRef : galerijRef).current?.click()

  if (!heeftSleutel) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-xs text-gray-600 flex items-start gap-2">
        <Icon n="info" cls="mt-0.5 text-gray-400" />
        <span>{t('etiket_geen_sleutel')}</span>
      </div>
    )
  }

  if (!fotos.length) {
    return (
      <div onDragOver={e => { e.preventDefault(); setSleept(true) }} onDragLeave={() => setSleept(false)} onDrop={drop}
        className={`rounded-lg border border-dashed px-3 py-3 flex flex-wrap items-center gap-3 ${sleept ? 'border-[var(--t-accent)] t-panel' : 'border-gray-300 bg-gray-50'}`}>
        {invoer}
        <div className="flex items-start gap-3 flex-1 min-w-[14rem]">
          <span className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0">
            <Icon n="camera" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800">{t('etiket_titel')}</div>
            <div className="text-xs text-gray-500">{aanraak ? t('etiket_uitleg_telefoon') : t('etiket_uitleg')}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={neemFoto}
            className="px-3 min-h-tap sm:min-h-[34px] rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            <Icon n="camera" /> {aanraak ? t('etiket_foto_maken') : t('etiket_foto_kiezen')}
          </button>
          {aanraak && (
            <button type="button" onClick={() => galerijRef.current?.click()} className="text-sm t-accent-text font-medium min-h-tap">
              {t('etiket_uit_fotos')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const lots = scan?.lots || []
  return (
    <div className="rounded-lg border border-gray-200 bg-white"
      onDragOver={e => { e.preventDefault(); setSleept(true) }} onDragLeave={() => setSleept(false)} onDrop={drop}>
      {invoer}
      {/* Meer foto's lopen door op een volgende rij: zijwaarts scrollen is op een telefoon lastig. */}
      <div className={`flex flex-wrap items-center gap-2 p-2 ${sleept ? 't-panel' : ''}`}>
        {fotos.map(f => (
          <div key={f.id} className="relative flex-shrink-0">
            <button type="button" onClick={() => setGroot(f)} aria-label={t('etiket_foto_bekijken').replace('{naam}', f.naam)}
              className="block w-16 h-16 rounded-md overflow-hidden border border-gray-200 bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <img src={f.url} alt="" className="w-full h-full object-cover" draggable={false} />
            </button>
            <button type="button" onClick={() => onVerwijder(f.id)} aria-label={t('etiket_foto_weg').replace('{naam}', f.naam)}
              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-gray-800 text-white text-xs flex items-center justify-center shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">✕</button>
          </div>
        ))}
        <button type="button" onClick={neemFoto}
          className="flex-shrink-0 w-16 h-16 rounded-md border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 flex flex-col items-center justify-center gap-0.5 text-[11px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          <Icon n="camera" cls="text-base" />
          {t('etiket_nog_een')}
        </button>
        {aanraak && (
          <button type="button" onClick={() => galerijRef.current?.click()}
            className="flex-shrink-0 w-16 h-16 rounded-md border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 flex flex-col items-center justify-center gap-0.5 text-[11px] leading-tight">
            <Icon n="image" cls="text-base" />
            {t('etiket_uit_fotos_kort')}
          </button>
        )}
      </div>

      <div className="px-3 pb-3 space-y-2 text-sm" aria-live="polite">
        {status === 'bezig' && (
          <div className="flex items-center gap-2 t-accent-text">
            <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-[var(--t-accent)] animate-spin" aria-hidden="true" />
            {fotos.length > 1 ? t('etiket_lezen_n').replace('{n}', String(fotos.length)) : t('etiket_lezen')}
          </div>
        )}
        {status === 'fout' && (
          <div className="flex items-start gap-2 text-red-700">
            <span>⚠</span>
            <span className="flex-1">{fout || t('scan_fout_leeg')}</span>
            <button type="button" onClick={onOpnieuw} className="text-xs font-medium underline">{t('etiket_opnieuw')}</button>
          </div>
        )}
        {status === 'klaar' && scan && !scan.leesbaar && (
          <div className="flex items-start gap-2 text-orange-700">
            <span>⚠</span>
            <span className="flex-1">{t('etiket_onleesbaar')}</span>
          </div>
        )}
        {status === 'klaar' && scan && scan.leesbaar && (
          <>
            <div className="flex items-start gap-2">
              <span className={oordeel === 'nee' ? 'text-orange-600' : 'text-green-700'}>{oordeel === 'nee' ? '⚠' : '✓'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800">
                  {oordeel === 'nee'
                    ? t(lotContext ? 'etiket_ander_product_lot' : 'etiket_ander_product').replace('{product}', scan.product || t('lbl_onbekend'))
                    : oordeel === 'ja'
                      ? t(lotContext ? 'etiket_klopt_lot' : 'etiket_klopt').replace('{product}', scan.product)
                      : t('etiket_gelezen')}
                </div>
                {ingevuld && !nietToegepast && <div className="text-xs text-gray-500">{ingevuld}</div>}
                {nietToegepast && <div className="text-xs text-gray-500">{t('etiket_niet_toegepast')}</div>}
              </div>
              {nietToegepast
                ? <button type="button" onClick={onTochToepassen} className="text-xs font-medium t-accent-text whitespace-nowrap">{t('etiket_toch_toepassen')}</button>
                : <button type="button" onClick={onOpnieuw} className="text-xs font-medium text-gray-500 hover:text-gray-700 whitespace-nowrap">{t('etiket_opnieuw')}</button>}
            </div>
            {lots.length > 1 && !nietToegepast && !lotWijktAf && !lotContext && (
              <p className="text-xs text-gray-600">{t('etiket_meer_lots').replace('{n}', String(lots.length))}</p>
            )}
            {lotWijktAf && (
              <p className="text-xs text-orange-700">⚠ {t('etiket_lot_wijkt_af').replace('{lots}', lots.map(l => l.lotnummer).join(', '))}</p>
            )}
            {scan.opmerking && <p className="text-xs text-gray-500">{scan.opmerking}</p>}
            {extra}
          </>
        )}
        {toonBewaren && (
          <label className="flex items-start gap-2 pt-1 cursor-pointer">
            <input type="checkbox" checked={bewaren} onChange={e => onBewaren(e.target.checked)} className="t-checkbox mt-0.5 w-4 h-4" />
            <span>
              <span className="text-sm text-gray-800">{t('etiket_bewaren')}</span>
              <span className="block text-xs text-gray-500">{t('etiket_bewaren_uitleg')}</span>
            </span>
          </label>
        )}
        {fotos.length === 1 && status !== 'bezig' && <p className="text-xs text-gray-500">{t(lotContext ? 'etiket_meer_fotos_tip_lot' : 'etiket_meer_fotos_tip')}</p>}
      </div>

      {groot && (
        <div className="fixed inset-0 z-[230] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true"
          aria-label={groot.naam} onClick={() => setGroot(null)}>
          <img src={groot.url} alt={groot.naam} className="max-w-full max-h-full object-contain rounded" />
          <button type="button" onClick={() => setGroot(null)} aria-label={t('btn_sluiten')}
            className="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center"
            style={{ top: 'calc(var(--safe-top, 0px) + 12px)' }}>
            <Icon n="close" cls="text-xl" />
          </button>
        </div>
      )}
    </div>
  )
}

export default EtiketFotos
