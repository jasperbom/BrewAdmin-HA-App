import React from 'react'
import { t } from '../../i18n'
import { fmtD } from '../../utils/format'
import Icon from '../ui/Icon'
import { leveringOmschrijving, afhaalmomentVerstreken } from '../../utils/levering'
import { wcOrderAfgebroken } from '../../utils/wcOrderImport'
import { wcSyncTeHerhalen, wcSyncDoelVoorStatus, WcSyncDoel } from '../../utils/wcTerugschrijven'

// De chips van een bestelling — in de lijst en in de kop van het detail
// dezelfde tekst en dezelfde kleur. Statuskleuren zijn semantisch (CLAUDE.md:
// statusbadges), niet het thema.

export const STATUS_KLEUR: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
  bevestigd: 'bg-cyan-100 text-cyan-700',
  gepickt: 'bg-orange-100 text-orange-700',
  verzonden: 'bg-purple-100 text-purple-700',
  afgerond: 'bg-green-100 text-green-700',
  geannuleerd: 'bg-gray-100 text-gray-500',
}

const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap'

export const StatusChip: React.FC<{ status: string }> = ({ status }) => (
  <span className={`${chip} ${STATUS_KLEUR[status] || 'bg-gray-100 text-gray-600'}`}>
    {t(`orders_status_${status}`, status)}
  </span>
)

// "Betaald"-markering op een WooCommerce-order: het label plus, als
// WooCommerce het weet, wanneer en waarmee er betaald is.
const betaaldTip = (b: any): string => [
  b.wc_betaald_datum ? t('orders_betaald_op').replace('{datum}', fmtD(b.wc_betaald_datum)) : t('orders_betaald'),
  b.wc_betaal_methode || '',
].filter(Boolean).join(' · ')

// In de winkel geannuleerd, mislukt of terugbetaald (utils/wcOrderImport):
// dat gaat vóór "betaald" — zo'n order telt nooit als betaald.
export const BetaaldBadge: React.FC<{ b: any }> = ({ b }) => wcOrderAfgebroken(b) ? (
  <span title={t('orders_wc_afgebroken_tip')} className={`${chip} bg-red-100 text-red-700`}>
    {t('orders_wc_sync_ok').replace('{status}', t(`wc_status_${b.wc_status}`, b.wc_status))}
  </span>
) : b?.wc_betaald ? (
  <span title={betaaldTip(b)} className={`${chip} bg-green-100 text-green-700`}>
    ✓ {t('orders_betaald')}
  </span>
) : null

// Afhalen of verzenden (webshoporder). Een afhaalorder zonder gekozen moment
// krijgt de oranje "nog te kiezen"-kleur: daar hoort de klant nog iets te
// doen, en de bestelbevestiging bevat daarvoor de link. Rood: het gekozen
// moment is voorbij en de klant is niet geweest — daar hoort de
// afspraak-gemist-mail (utils/levering → afhaalmomentVerstreken).
export const LeveringBadge: React.FC<{ b: any }> = ({ b }) => {
  if (!b?.wc_levering) return null
  const afhalen = b.wc_levering === 'afhalen'
  const open = afhalen && !b.wc_afhaalmoment
  const gemist = afhaalmomentVerstreken(b)
  return (
    <span title={leveringOmschrijving(b) + (gemist ? ` (${t('orders_afhaalmoment_verstreken')})` : '')}
      className={`${chip} ${gemist ? 'bg-red-100 text-red-700' : open ? 'bg-orange-100 text-orange-700' : afhalen ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
      <Icon n={afhalen ? 'store' : 'truck'} /> {t(afhalen ? 'orders_levering_afhalen' : 'orders_levering_verzenden')}
    </span>
  )
}

/** Privé of zakelijk — vast (na het picken) of als wisselaar zolang het nog mag. */
export const KlantTypeChip: React.FC<{
  type: 'prive' | 'zakelijk' | undefined
  /** Zonder: alleen een chip. Met: twee knoppen (vóór het picken nog te corrigeren). */
  onWissel?: (kt: 'prive' | 'zakelijk') => void
}> = ({ type, onWissel }) => {
  if (!type) return null
  const kleur = (kt: 'prive' | 'zakelijk') => kt === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
  if (!onWissel) {
    return <span className={`${chip} ${kleur(type)}`}>{t(type === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}</span>
  }
  return (
    <span className="inline-flex bg-gray-100 rounded-full p-0.5" title={t('tip_order_klant_type')} role="group" aria-label={t('tip_order_klant_type')}>
      {(['prive', 'zakelijk'] as const).map(kt => (
        <button key={kt} type="button" aria-pressed={type === kt}
          onClick={() => { if (kt !== type) onWissel(kt) }}
          className={`px-3 min-h-tap sm:min-h-0 sm:py-0.5 rounded-full text-xs font-semibold transition-colors ${type === kt ? kleur(kt) : 'text-gray-500 hover:text-gray-700'}`}>
          {t(kt === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
        </button>
      ))}
    </span>
  )
}

// Stand van de winkel: is de status van deze order in WooCommerce
// aangekomen? Groen = ja, rood = mislukt (fout als tooltip), plus een knop
// om het opnieuw te proberen zolang de winkel achterloopt.
export const WcSyncBadge: React.FC<{
  b: any
  /** `wcTerugschrijfOpties(b)` van de pagina. */
  opties: { enabled: boolean; uitgeslagen?: boolean }
  onOpnieuw: (doel: WcSyncDoel) => void
}> = ({ b, opties, onOpnieuw }) => {
  if (!b?.wc_order_id || !opties.enabled) return null
  const sync = b.wc_sync
  const herhalen = wcSyncTeHerhalen(b, opties, t)
  const doel = wcSyncDoelVoorStatus(b.status)
  const statusLabel = sync?.status ? t(`wc_status_${sync.status}`) : t('orders_wc_sync_notitie')
  return (<>
    {sync && (sync.fout
      ? <span title={sync.fout} className={`${chip} bg-red-100 text-red-700`}>{t('orders_wc_sync_fout')}</span>
      : <span title={fmtD(sync.datum)} className={`${chip} bg-green-100 text-green-700`}>{t('orders_wc_sync_ok').replace('{status}', statusLabel)}</span>)}
    {herhalen && doel && (
      <button type="button" onClick={() => onOpnieuw(doel)}
        className="text-xs underline t-accent-text min-h-tap sm:min-h-0" title={t('orders_wc_sync_retry_tip')}>
        ↻ {t('orders_wc_sync_retry')}
      </button>
    )}
  </>)
}
