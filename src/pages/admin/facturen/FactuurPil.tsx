import React from 'react'
import { t } from '../../../i18n'
import { periodeKeyLabel } from '../../../utils/btw'
import type { InkoopStand, VerkoopStand, VerlegdInfo } from '../../../utils/factuurTijdlijn'
import { fmt } from '../adminContext'

// ── Statuspil en kleine badges van een factuur ──────────────────────────────
// Vaste semantische kleuren (CLAUDE.md): rood = te laat, oranje = open of een
// eerste stap, groen = betaald, grijs = creditnota, paars = alt-rekening of
// verlegde BTW. Eén pil per factuur; wat er nog bij hoort (verrekend, BTW in
// een andere periode) staat er als kleinere badge naast.

const PIL = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap'
const BADGE = 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap'

const HERINNERING_LABEL: Record<string, string> = {
  herinnering: 'lbl_herinnering',
  tweede_herinnering: 'lbl_tweede_herinnering',
  aanmaning: 'lbl_aanmaning',
}

/** De pil van een verkoopfactuur: Open, Te laat n d, een herinneringsstap, Betaald of Creditnota. */
export const VerkoopPil: React.FC<{ stand: VerkoopStand }> = ({ stand }) => {
  const { fase, teLaat, dagenTeLaat } = stand
  if (fase === 'credit') return <span className={`${PIL} bg-gray-100 text-gray-700`}>{t('fb_status_credit')}</span>
  if (fase === 'betaald') return <span className={`${PIL} bg-green-100 text-green-800`}>{t('factuur_paid')}</span>
  const dagen = t('fct_pil_dagen').replace('{n}', String(dagenTeLaat))
  if (fase === 'te_laat') return <span className={`${PIL} bg-red-100 text-red-800`}>{t('fct_pil_te_laat').replace('{n}', String(dagenTeLaat))}</span>
  if (fase === 'open') return <span className={`${PIL} bg-orange-100 text-orange-800`}>{t('factuur_open')}</span>
  // Een herinneringsstap: rood zodra hij te laat is (of de aanmaning), anders
  // in de kleur van de stap.
  const kleur = teLaat || fase === 'aanmaning' ? 'bg-red-100 text-red-800'
    : fase === 'tweede_herinnering' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'
  return (
    <span className={`${PIL} ${kleur}`}>
      {t(HERINNERING_LABEL[fase])}{teLaat && <span className="font-medium">&nbsp;· {dagen}</span>}
    </span>
  )
}

/** De pil van een inkoopfactuur: Open, Te laat n d, Betaald, Verrekend (PSP) of Via <alt-rekening>. */
export const InkoopPil: React.FC<{ stand: InkoopStand, altNaam?: string }> = ({ stand, altNaam }) => {
  if (stand.fase === 'betaald') return <span className={`${PIL} bg-green-100 text-green-800`}>{t('factuur_paid')}</span>
  if (stand.fase === 'verrekend') return <span className={`${PIL} bg-green-100 text-green-800`} title={t('fct_pil_verrekend_titel')}>{t('fct_pil_verrekend')}</span>
  if (stand.fase === 'betaald_alt') {
    const naam = altNaam || t('lbl_alt_rekening')
    return (
      <span className={`${PIL} bg-purple-100 text-purple-800`} title={`${t('lbl_betaald_via')}: ${naam}`}>
        {t('fct_pil_via').replace('{naam}', naam)}
      </span>
    )
  }
  if (stand.fase === 'te_laat') return <span className={`${PIL} bg-red-100 text-red-800`}>{t('fct_pil_te_laat').replace('{n}', String(stand.dagenTeLaat))}</span>
  return <span className={`${PIL} bg-orange-100 text-orange-800`}>{t('factuur_open')}</span>
}

/** "↪ BTW Q2 2026": de BTW telt in een latere periode (rollover). */
export const RolloverBadge: React.FC<{ periode: string, sleutel?: string }> = ({ periode, sleutel = 'msg_btw_geclaimd_in' }) => (
  <span className={`${BADGE} bg-orange-100 text-orange-800`} title={t(sleutel).replace('{periode}', periodeKeyLabel(periode))}>
    ↪ {t('lbl_btw')} {periodeKeyLabel(periode)}
  </span>
)

/** Verrekend met de schuld aan een alternatieve rekening (geen bankbetaling). */
export const VerrekendBadge: React.FC<{ naam?: string }> = ({ naam }) => (
  <span className={`${BADGE} bg-purple-100 text-purple-800`} title={`${t('lbl_verrekend_met')} ${naam || t('lbl_onbekend')}`}>
    {t('factuur_verrekend')}
  </span>
)

/** "⇄ BTW verlegd 4b": telt mee in rubriek 4a/4b. */
export const VerlegdBadge: React.FC<{ info: VerlegdInfo }> = ({ info }) => (
  <span className={`${BADGE} bg-purple-100 text-purple-800`}
    title={t('title_verlegd_badge').replace('{rubriek}', info.rubriek).replace('{btw}', fmt(info.btw_cent / 100))}>
    ⇄ {t('lbl_btw_verlegd_kort')} {info.rubriek}
  </span>
)
