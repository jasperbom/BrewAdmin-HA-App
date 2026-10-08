import React from 'react'
import { t } from '../../i18n'
import { fmt, fmtD } from '../../utils/format'
import type { KassaKeuze } from '../../utils/kassaCatalogus'
import Btn from '../ui/Btn'
import Icon from '../ui/Icon'
import SearchInput from '../ui/SearchInput'

export interface KassaKlantStats {
  count: number
  last: string
  openstaand: number
}

export interface KassaVorigeAankoop {
  key: string
  count: number
  keuze: KassaKeuze
}

interface KassaKlantProps {
  /** `kolom`: kaart in de linkerkolom (bureau); `blad`: in het onderblad (telefoon). */
  variant: 'kolom' | 'blad'
  klant: any | null
  zakelijk: boolean
  stats: Record<number, KassaKlantStats>
  recente: any[]
  zoek: string
  onZoek: (v: string) => void
  zoekResultaten: any[]
  kortingPct: number
  standaardKortingPct: number
  klantKortingBon: number | null
  vorige: KassaVorigeAankoop[]
  /** Kan er van deze keuze nog één op de bon? */
  kanVorige: (k: KassaKeuze) => boolean
  onKies: (id: number | null) => void
  onNieuw: () => void
  onKlantKorting: () => void
  onVorige: (k: KassaKeuze) => void
}

/**
 * Klant kiezen in de kassa: recente klanten, zoeken, een nieuwe klant, en bij
 * een gekozen klant zijn type (zakelijk = B2B-prijs, prijzen excl. BTW), de
 * klantkorting voor deze bon, het openstaande bedrag en "eerder gekocht".
 * Geen klant = balieverkoop (particulier).
 */
/** "1 aankoop", "3 aankopen". */
const aankopen = (n: number): string => (n === 1 ? t('pos_aankopen_1') : t('pos_aankopen').replace('{n}', String(n)))

const KassaKlant: React.FC<KassaKlantProps> = ({
  variant, klant, zakelijk, stats, recente, zoek, onZoek, zoekResultaten, kortingPct, standaardKortingPct,
  klantKortingBon, vorige, kanVorige, onKies, onNieuw, onKlantKorting, onVorige,
}) => {
  const blad = variant === 'blad'
  const chip = `text-xs px-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${blad ? 'min-h-tap py-1.5' : 'py-1.5'}`
  const st = klant ? stats[klant.id] : null
  return (
    <div className="space-y-3">
      {/* In het blad staat "Klant" al in de kop. */}
      <div className={`flex items-center gap-2 ${blad ? 'justify-end' : 'justify-between'}`}>
        {!blad && <div className="text-xs font-semibold text-gray-500">{t('pos_klant')}</div>}
        <Btn v={blad ? 'secondary' : 'ghost'} s={blad ? 'md' : 'sm'} onClick={onNieuw}>+ {t('klanten_new')}</Btn>
      </div>

      {klant ? (
        <div className="rounded-lg t-panel border t-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-800 break-words min-w-0">{klant.naam}</span>
            {klant.klantnummer && <span className="text-xs text-gray-400">#{klant.klantnummer}</span>}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${zakelijk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {zakelijk ? t('lbl_zakelijk') : t('lbl_prive')}
            </span>
            {(standaardKortingPct > 0 || klantKortingBon != null) && (
              // Tik = de klantkorting voor alleen deze bon aanpassen.
              <button type="button" onClick={onKlantKorting} title={t('pos_klantkorting_aanpassen')}
                className={`text-[10px] font-semibold px-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200 ${blad ? 'min-h-tap' : 'py-0.5'}`}>
                {t('lbl_korting_pct').replace('{pct}', String(kortingPct))}
                {klantKortingBon != null && (
                  <span className="font-normal"> · {t('pos_klantkorting_standaard').replace('{pct}', String(standaardKortingPct))}</span>
                )}
                {' ✎'}
              </button>
            )}
            {st && st.openstaand > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                {t('pos_openstaand')}: {fmt(st.openstaand)}
              </span>
            )}
            <button type="button" onClick={() => onKies(null)} aria-label={t('pos_klant_wissen')} title={t('pos_klant_wissen')}
              className={`ml-auto flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${blad ? 'w-11 h-11 -my-2 -mr-2' : 'w-7 h-7'}`}>
              <Icon n="close" />
            </button>
          </div>
          {st && (
            <div className="text-xs text-gray-500 mt-1">
              {aankopen(st.count)}
              {st.last ? ` · ${t('pos_laatste_aankoop')}: ${fmtD(st.last)}` : ''}
            </div>
          )}
          {vorige.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-500 mb-1.5">{t('pos_vorige_aankopen')}</div>
              <div className="flex flex-wrap gap-1.5">
                {vorige.map(v => (
                  <button key={v.key} type="button" onClick={() => onVorige(v.keuze)} disabled={!kanVorige(v.keuze)}
                    className={`${chip} disabled:opacity-40 disabled:cursor-not-allowed`}>
                    <span className="font-medium">{v.keuze.bier_naam}</span>
                    <span className="text-gray-400"> · {v.keuze.label} · {v.count}×</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {recente.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-1.5">{t('pos_recente_klanten')}</div>
              <div className="flex flex-wrap gap-1.5">
                {recente.map((k: any) => (
                  <button key={k.id} type="button" onClick={() => onKies(k.id)} className={chip}>
                    <span className="font-medium">{k.naam}</span>
                    <span className="text-gray-400"> · {aankopen(stats[k.id]?.count || 0)}
                      {stats[k.id]?.last ? ` · ${fmtD(stats[k.id].last)}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="relative">
            <SearchInput value={zoek} onChange={onZoek} placeholder={t('pos_zoek_klant_ph')} />
            {/* Bureau: een uitklap onder het veld. In het blad een gewone lijst:
                het toetsenbord neemt de onderste helft al in. */}
            {zoekResultaten.length > 0 && (
              <div className={blad
                ? 'mt-2 border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100'
                : 'absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'}>
                {zoekResultaten.map((k: any) => (
                  <button key={k.id} type="button" onClick={() => onKies(k.id)}
                    className={`w-full text-left px-3 text-sm hover:bg-gray-50 flex items-center gap-2 bg-white ${blad ? 'min-h-tap py-2' : 'py-2'}`}>
                    <span className="font-medium min-w-0 truncate">{k.naam}</span>
                    {k.bedrijf && <span className="text-gray-400 text-xs truncate">{k.bedrijf}</span>}
                    <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
                      {stats[k.id] ? aankopen(stats[k.id].count) : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {zoek.trim() && zoekResultaten.length === 0 && (
              <div className={blad
                ? 'mt-2 px-3 py-2 text-sm text-gray-400'
                : 'absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400'}>
                {t('pos_geen_klanten')}
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400">{t('pos_walkin_hint')}</div>
        </>
      )}
    </div>
  )
}

export default KassaKlant
