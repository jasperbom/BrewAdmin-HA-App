import React from 'react'
import { t } from '../../i18n'
import {
  PERIODE_KEUZES, periodeBereik, periodeOmschrijving, vulIn,
  type EigenPeriode, type PeriodeKeuze,
} from '../../utils/periode'

export interface PeriodeKiezerProps {
  keuze: PeriodeKeuze
  onKeuze: (k: PeriodeKeuze) => void
  /** De eigen datums (alleen gebruikt bij `keuze === 'eigen'`). */
  eigen?: EigenPeriode
  onEigen?: (e: EigenPeriode) => void
  /**
   * De periode doet nu niet mee: een korte reden ("geldt niet voor open
   * facturen"). De keuze blijft staan maar is uitgeschakeld; de reden staat
   * als title en als klein bijschrift. `true` = de standaardreden.
   */
  uit?: string | boolean
  /** Alleen deze keuzes aanbieden (volgorde van PERIODE_KEUZES blijft). */
  keuzes?: readonly PeriodeKeuze[]
  /** Zichtbaar label boven de keuzelijst; zonder alleen een toegankelijke naam. */
  label?: string
  /** Onder elkaar en over de volle breedte (filterpaneel op de telefoon). */
  gestapeld?: boolean
  /** Toon het bereik in datums onder de keuze ("01-01-2026 t/m 31-12-2026"). */
  toonBereik?: boolean
  /** Peildatum voor `toonBereik` (standaard vandaag). */
  vandaag?: Date
  cls?: string
}

// Zelfde opmaak als Sel/Inp; `Sel` zelf heeft altijd een lege eerste optie,
// en een periode is nooit "niets".
const VELD = 'border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap md:min-h-0 bg-white t-input outline-none transition-all duration-150 shadow-sm disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed'

/**
 * De periodekeuze van de filterbalk: vaste keuzes (deze maand … alles) of
 * eigen datums. Bij "Eigen datums" verschijnen twee datumvelden; op een
 * telefoon (of `gestapeld`) elk over de halve breedte, zodat iOS ze niet
 * buiten de kolom duwt.
 */
const PeriodeKiezer: React.FC<PeriodeKiezerProps> = ({
  keuze, onKeuze, eigen = {}, onEigen, uit = false, keuzes, label, gestapeld = false, toonBereik = false, vandaag, cls = '',
}) => {
  const id = React.useId()
  const uitReden = uit === true ? t('periode_uit_standaard') : (typeof uit === 'string' && uit ? uit : '')
  const isUit = uit === true || !!uitReden
  const lijst = PERIODE_KEUZES.filter(k => !keuzes || keuzes.includes(k.id) || k.id === keuze)
  const eigenOpen = keuze === 'eigen' && !isUit
  const bereik = toonBereik && !isUit ? periodeBereik(keuze, vandaag || new Date(), eigen) : null
  const omschrijving = bereik ? periodeOmschrijving(bereik) : null

  const zetEigen = (deel: Partial<EigenPeriode>) => {
    const nieuw: EigenPeriode = { ...eigen, ...deel }
    if (!nieuw.van) delete nieuw.van
    if (!nieuw.tot) delete nieuw.tot
    onEigen?.(nieuw)
  }

  return (
    <div className={`${gestapeld ? 'w-full' : 'min-w-0'} ${cls}`}>
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className={gestapeld ? 'grid gap-2' : 'flex flex-wrap items-center gap-2'}>
        <select
          id={id}
          value={keuze}
          disabled={isUit}
          title={isUit ? uitReden : undefined}
          aria-label={label ? undefined : t('lbl_periode')}
          aria-describedby={isUit ? `${id}-uit` : omschrijving ? `${id}-bereik` : undefined}
          onChange={e => onKeuze(e.target.value as PeriodeKeuze)}
          className={`${VELD} ${gestapeld ? 'w-full' : 'w-full md:w-auto'}`}
        >
          {lijst.map(k => <option key={k.id} value={k.id}>{t(k.sleutel)}</option>)}
        </select>
        {eigenOpen && (
          <div className={`grid grid-cols-2 gap-2 ${gestapeld ? 'w-full' : 'w-full md:w-auto'}`}>
            <input
              type="date"
              value={eigen.van || ''}
              max={eigen.tot || undefined}
              onChange={e => zetEigen({ van: e.target.value })}
              aria-label={t('periode_eigen_van')}
              title={t('periode_eigen_van')}
              className={`${VELD} w-full min-w-0`}
            />
            <input
              type="date"
              value={eigen.tot || ''}
              min={eigen.van || undefined}
              onChange={e => zetEigen({ tot: e.target.value })}
              aria-label={t('periode_eigen_tot')}
              title={t('periode_eigen_tot')}
              className={`${VELD} w-full min-w-0`}
            />
          </div>
        )}
        {/* Naast de keuze in een rij, eronder als hij gestapeld staat. */}
        {isUit && (
          <span id={`${id}-uit`} className="text-xs text-gray-500">{uitReden}</span>
        )}
        {omschrijving && (
          <span id={`${id}-bereik`} className="text-xs text-gray-500 tabular-nums">{vulIn(t(omschrijving.sleutel), omschrijving.vars)}</span>
        )}
      </div>
    </div>
  )
}

export default PeriodeKiezer
