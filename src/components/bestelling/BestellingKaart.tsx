import React from 'react'
import { t, getLang } from '../../i18n'
import { fmt, fmtWeekdagDatum, tod } from '../../utils/format'
import { regelsKort } from '../../utils/bestelling'
import { orderNummer } from '../../utils/picking'
import type { LeverLabel } from '../../utils/verkoopOverzicht'
import { StatusChip, BetaaldBadge, LeveringBadge, KlantTypeChip } from './BestellingBadges'

interface BestellingKaartProps {
  b: any
  /** Wat de klant betaalt (`orderTotalen(...).bruto`). */
  totaal: number
  klantType?: 'prive' | 'zakelijk'
  /** Al gepickte stuks (concept of definitief). */
  gepickt: number
  /** Kan de order geleverd worden? Alleen voor orders die nog gepickt worden. */
  levering?: LeverLabel | null
  onOpen: () => void
}

export const LEVER_KLEUR: Record<LeverLabel['kleur'], string> = {
  groen: 'bg-green-100 text-green-700',
  oranje: 'bg-orange-100 text-orange-700',
  rood: 'bg-red-100 text-red-700',
  grijs: 'bg-gray-100 text-gray-600',
}

/** De tekst van een leverlabel (`leverLabel`), overal dezelfde. */
export const leverTekst = (l: LeverLabel): string =>
  Object.entries(l.params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), t(l.sleutel))

/**
 * Eén bestelling in de lijst, op de telefoon en het bureau dezelfde kaart:
 * ordernummer · klant, de regels kort, en datum + chips met het bedrag en de
 * status rechts. De hele kaart opent de bestelling.
 */
const BestellingKaart: React.FC<BestellingKaartProps> = ({ b, totaal, klantType, gepickt, levering, onOpen }) => {
  const { delen, meer } = regelsKort(b?.regels)
  const klant = String(b?.klant_bedrijf || b?.klant_naam || '').trim() || t('lbl_onbekend')
  // "di 6-10" zoals de kop van de bestelling; een ander jaar met jaartal.
  const datum = String(b?.datum || '')
  const datumTekst = fmtWeekdagDatum(datum, { lang: getLang(), jaar: datum.slice(0, 4) !== tod().slice(0, 4) })
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left bg-white rounded-xl shadow-card px-3 py-3 md:px-4 hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-mono text-sm font-semibold text-gray-700 flex-shrink-0">{orderNummer(b)}</span>
            <span className="text-gray-300 flex-shrink-0" aria-hidden="true">·</span>
            <span className="font-semibold text-gray-900 truncate">{klant}</span>
          </div>
          {delen.length > 0 && (
            <div className="text-sm text-gray-600 truncate mt-0.5">
              {delen.join(' · ')}{meer > 0 ? ` · ${t('orders_regels_meer').replace('{n}', String(meer))}` : ''}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs text-gray-500">
            <span className="whitespace-nowrap">{datumTekst}</span>
            <KlantTypeChip type={klantType} />
            <LeveringBadge b={b} />
            <BetaaldBadge b={b} />
            {levering && levering.sleutel && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${LEVER_KLEUR[levering.kleur]}`}>
                {leverTekst(levering)}
              </span>
            )}
            {gepickt > 0 && !levering && (
              <span className="whitespace-nowrap">{t('msg_stuks_gepickt').replace('{n}', String(gepickt))}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatusChip status={String(b?.status || '')} />
          <span className="font-semibold text-gray-900 tabular-nums">{fmt(totaal)}</span>
        </div>
      </div>
    </button>
  )
}

export default BestellingKaart
