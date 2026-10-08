import React from 'react'
import { t } from '../../i18n'
import { fmt } from '../../utils/format'

interface KassaBonbalkProps {
  /** Aantal stuks op de bon. */
  stuks: number
  /** Wat de klant betaalt (bruto). */
  totaal: number
  /** De zojuist afgeronde verkoop, zolang de bon leeg is. */
  afgerond: number | null
  onBon: () => void
  onAfrekenen: () => void
}

/** "3 artikelen", "1 artikel". */
export const stuksTekst = (n: number): string =>
  n === 1 ? t('pos_bonbalk_artikel') : t('pos_bonbalk_artikelen').replace('{n}', String(n))

/** Hoogte van de bonbalk: de pagina houdt onderaan evenveel ruimte vrij. */
export const BONBALK_RUIMTE = 'h-16 md:h-[calc(4rem+var(--safe-bottom,0px))]'

/**
 * De bon onder `lg`: een vaste balk boven de onderbalk (`--onderbalk`) met het
 * aantal en het totaal, "Bon ›" (het onderblad met de regels) en Afrekenen.
 * Zo staat de bon altijd in beeld in plaats van onder de hele catalogus.
 * `data-onderbalk`: met het toetsenbord open verbergt index.css hem, net als
 * de onderbalk (iOS tilt een vaste balk anders midden in beeld).
 */
const KassaBonbalk: React.FC<KassaBonbalkProps> = ({ stuks, totaal, afgerond, onBon, onAfrekenen }) => (
  <div
    data-onderbalk
    className="fixed inset-x-0 md:left-[84px] z-30 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:pb-[var(--safe-bottom,0px)]"
    style={{ bottom: 'var(--onderbalk, 0px)' }}
  >
    <div className="max-w-7xl mx-auto h-16 px-4 flex items-center gap-2" role="region" aria-label={t('pos_bon')}>
      <div className="flex-1 min-w-0 truncate text-sm text-gray-700" aria-live="polite">
        {stuks > 0 ? (
          <>{stuksTekst(stuks)} · <span className="font-bold text-gray-900">{fmt(totaal)}</span></>
        ) : afgerond != null ? (
          <><span className="font-semibold text-green-700">✓ {t('pos_verkoop_gelukt')}</span> · {fmt(afgerond)}</>
        ) : (
          <span className="text-gray-500">{t('pos_bonbalk_leeg')}</span>
        )}
      </div>
      <button type="button" onClick={onBon}
        className="flex-shrink-0 min-h-tap px-2 text-sm font-semibold t-accent-text whitespace-nowrap rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        {t('pos_bon')} <span aria-hidden="true">›</span>
      </button>
      <button type="button" onClick={onAfrekenen} disabled={stuks === 0}
        className="flex-shrink-0 tbtn text-white rounded-lg px-4 min-h-tapLg text-sm font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--t-accent)]">
        {t('pos_afrekenen')}
      </button>
    </div>
  </div>
)

export default KassaBonbalk
