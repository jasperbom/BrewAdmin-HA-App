import React from 'react'
import { t } from '../../i18n'
import { fmt } from '../../utils/format'
import { kassaStuksprijs } from '../../utils/kassa'
import type { KassaBonWeergave, KassaBonKorting } from '../../utils/kassa'
import Btn from '../ui/Btn'
import Icon from '../ui/Icon'

/** Eén regel op de kassabon. De prijs komt altijd uit het artikel (normaal of
 * B2B), excl. BTW, en is niet handmatig aan te passen; korting gaat via de
 * kortingsregel. */
export interface BonRegel {
  key: string
  type: 'bier' | 'vrij'
  bier_naam: string
  verpakking_type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  omschrijving: string
  artikel_id?: number | string | null
  artikel_key?: string | null
  sku?: string | null
  prijsType?: 'normaal' | 'b2b'
  /** Merch-artikel met eigen voorraad; wordt bij afrekenen afgeboekt. */
  merch_id?: number | null
}

export interface KassaLaatsteVerkoop {
  factuurnummer: string
  klantNaam: string
  bruto: number
}

interface KassaBonProps {
  /** `kolom`: de bon naast de catalogus (bureau); `blad`: in het onderblad (telefoon). */
  variant: 'kolom' | 'blad'
  cart: BonRegel[]
  weergave: KassaBonWeergave
  kortingPct: number
  bonKorting: KassaBonKorting | null
  laatsteVerkoop: KassaLaatsteVerkoop | null
  /** Mag er van deze regel nog één bij (vrije voorraad)? */
  kanMeer: (idx: number) => boolean
  onAantal: (idx: number, delta: number) => void
  onVerwijder: (idx: number) => void
  onKorting: () => void
  onVrijeRegel: () => void
  onBonKortingWeg: () => void
  onPrint: () => void
  onNieuweVerkoop: () => void
  /** Tijdens het afrekenen ligt de bon vast: wat geboekt wordt, is wat er staat. */
  vergrendeld?: boolean
  /** Boven de regels (telefoon: de klant). */
  kop?: React.ReactNode
  /** Onder de totalen: afrekenen. */
  children?: React.ReactNode
}

/**
 * De inhoud van de bon: regels met − aantal +, korting en vrije regel, de
 * totalen en de afgeronde verkoop. De bedragen komen uit `kassaBonWeergave`
 * (incl. of excl. BTW, cent-exact uit dezelfde regels als de factuur).
 */
const KassaBon: React.FC<KassaBonProps> = ({
  variant, cart, weergave: w, kortingPct, bonKorting, laatsteVerkoop,
  kanMeer, onAantal, onVerwijder, onKorting, onVrijeRegel, onBonKortingWeg, onPrint, onNieuweVerkoop,
  vergrendeld = false, kop, children,
}) => {
  const blad = variant === 'blad'
  // Tapdoelen: in het blad (telefoon, tablet) 44 px, in de kolom op het bureau compacter.
  const knop = blad ? 'w-11 h-11' : 'w-8 h-8'
  const extra = (
    <div className={`flex flex-wrap gap-1 ${blad ? 'pt-1' : ''}`}>
      <Btn v={blad ? 'secondary' : 'ghost'} s={blad ? 'md' : 'sm'} onClick={onKorting} disabled={vergrendeld || cart.length === 0}>+ {t('pos_korting')}</Btn>
      <Btn v={blad ? 'secondary' : 'ghost'} s={blad ? 'md' : 'sm'} onClick={onVrijeRegel} disabled={vergrendeld}>+ {t('pos_vrije_regel')}</Btn>
    </div>
  )
  return (
    <div className="space-y-3">
      {!blad && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-gray-500">{t('pos_bon')}</div>
          {extra}
        </div>
      )}
      {kop}

      {laatsteVerkoop && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-2" role="status">
          <div className="font-semibold text-green-700 text-sm">✓ {t('pos_verkoop_gelukt')}</div>
          <div className="text-xs text-green-700 break-words">
            {laatsteVerkoop.factuurnummer} · {laatsteVerkoop.klantNaam} · {fmt(laatsteVerkoop.bruto)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn v="green" s={blad ? 'md' : 'sm'} onClick={onPrint}>{t('pos_print_bon')}</Btn>
            <Btn v="secondary" s={blad ? 'md' : 'sm'} onClick={onNieuweVerkoop}>{t('pos_nieuwe_verkoop')}</Btn>
          </div>
        </div>
      )}

      {cart.length === 0 ? (
        !laatsteVerkoop && <div className="text-sm text-gray-400 py-8 text-center">{t('pos_bon_leeg')}</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {cart.map((r, idx) => (
            <div key={`${r.key}-${idx}`} className="py-2 space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 break-words font-medium text-gray-800 leading-tight">
                  {r.bier_naam}
                  {r.verpakking_type && <span className="text-gray-400 font-normal"> · {r.verpakking_type}</span>}
                  {r.prijsType === 'b2b' && <span className="ml-1 text-[10px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded align-middle">B2B</span>}
                </span>
                {/* Negatieve marge: het tapdoel is 44 px, de regel blijft zo hoog als de naam. */}
                <button type="button" onClick={() => onVerwijder(idx)} disabled={vergrendeld} aria-label={t('pos_regel_verwijderen')}
                  className={`${knop} ${blad ? '-my-3' : '-my-1.5'} -mr-1 flex-shrink-0 flex items-center justify-center rounded-full text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]`}>
                  <Icon n="close" />
                </button>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0">
                  <button type="button" onClick={() => onAantal(idx, -1)} disabled={vergrendeld} aria-label={t('pos_aantal_minder')}
                    className={`${knop} flex items-center justify-center text-base text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-gray-100`}>−</button>
                  <span className="px-1 text-sm font-medium min-w-8 text-center">{r.aantal}</span>
                  <button type="button" onClick={() => onAantal(idx, +1)} disabled={vergrendeld || !kanMeer(idx)} aria-label={t('pos_aantal_meer')}
                    className={`${knop} flex items-center justify-center text-base text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-gray-100`}>+</button>
                </div>
                <span className="text-xs text-gray-400">×</span>
                <span className="text-sm text-gray-600 whitespace-nowrap">{fmt(kassaStuksprijs(r.prijs_per_stuk, r.btw_pct, w.inclBtw))}</span>
                {!w.inclBtw && <span className="text-[10px] text-gray-400">{r.btw_pct}%</span>}
                <span className="ml-auto text-sm font-semibold text-gray-700 whitespace-nowrap">{fmt(w.regels[idx] ?? 0)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {blad && extra}

      {cart.length > 0 && (
        <div className="border-t pt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-2 text-gray-500">
            <span>{w.inclBtw ? t('pos_subtotaal_incl') : t('pos_subtotaal')}</span><span className="whitespace-nowrap">{fmt(w.subtotaal)}</span>
          </div>
          {w.klantkorting > 0 && (
            <div className="flex justify-between gap-2 text-green-600">
              <span>{t('lbl_korting_pct').replace('{pct}', String(kortingPct))}</span>
              <span className="whitespace-nowrap">−{fmt(w.klantkorting)}</span>
            </div>
          )}
          {bonKorting && w.bonkorting > 0 && (
            <div className="flex justify-between items-center gap-2 text-green-600">
              <span className="flex items-center gap-1">
                {bonKorting.soort === 'pct'
                  ? t('lbl_korting_pct').replace('{pct}', String(bonKorting.waarde))
                  : t('pos_korting')}
                <button type="button" onClick={onBonKortingWeg} disabled={vergrendeld} aria-label={t('pos_korting_verwijderen')}
                  className={`${blad ? 'w-11 h-11 -my-2' : 'w-6 h-6'} flex items-center justify-center rounded-full text-red-400 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]`}>
                  <Icon n="close" />
                </button>
              </span>
              <span className="whitespace-nowrap">−{fmt(w.bonkorting)}</span>
            </div>
          )}
          {w.statiegeld > 0 && (
            <div className="flex justify-between gap-2 text-gray-500">
              <span>{t('pos_statiegeld')}</span><span className="whitespace-nowrap">{fmt(w.statiegeld)}</span>
            </div>
          )}
          {!w.inclBtw && (
            <div className="flex justify-between gap-2 text-gray-500">
              <span>{t('pos_btw')}</span><span className="whitespace-nowrap">{fmt(w.btw)}</span>
            </div>
          )}
          <div className="flex justify-between gap-2 font-bold text-lg text-gray-800 pt-1">
            <span>{t('pos_totaal')}</span><span className="whitespace-nowrap">{fmt(w.totaal)}</span>
          </div>
          {w.inclBtw && (
            <div className="flex justify-between gap-2 text-xs text-gray-500">
              <span>{t('pos_btw_waarvan')}</span><span className="whitespace-nowrap">{fmt(w.btw)}</span>
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export default KassaBon
