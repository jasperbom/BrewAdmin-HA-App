import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtWeekdagDatum } from '../../utils/format'
import type { KomtEraanBatch } from '../../utils/verkoopOverzicht'

interface KomtEraanRegelProps {
  k: KomtEraanBatch
  /** De naam van het bier ("Kadeblond"). */
  productNaam: string
  /** `YYYY-MM-DD`: een verwachte afvuldatum daarvóór is "over tijd". */
  vandaag: string
  /** Opent de batch; zonder is het blok alleen tekst. */
  onOpen?: (batchId: number) => void
}

/** "#2609 Kadeblond in GV1 · afvullen ± vr 16-10" — de tekst zonder het label ervoor. */
export const komtEraanTekst = (k: KomtEraanBatch, productNaam: string, vandaag: string): string => {
  const d = (x: string | null) => fmtWeekdagDatum(x, { jaar: false, lang: getLang() })
  const wie = [k.batchNummer ? `#${k.batchNummer}` : '', productNaam].filter(Boolean).join(' ')
  const waar = k.status === 'Gepland'
    ? (k.geplandeBrouwdatum ? t('orders_komt_gepland').replace('{datum}', d(k.geplandeBrouwdatum)) : t('orders_komt_gepland_zonder'))
    : k.tank ? t('orders_komt_in_tank').replace('{tank}', k.tank) : ''
  // Een batch over tijd heeft een verwachte afvuldatum die al geweest is: dat
  // zeggen, geen datum in het verleden tonen alsof die nog komt.
  const wanneer = !k.afvulDatum ? ''
    : k.afvulDatum < vandaag ? t('orders_komt_over_tijd')
      : t('orders_komt_afvullen').replace('{datum}', d(k.afvulDatum))
  return [[wie, waar].filter(Boolean).join(k.status === 'Gepland' ? ' · ' : ' '), wanneer].filter(Boolean).join(' · ')
}

/**
 * Bij een tekort: wat er van dit bier in de tank ligt (of gepland is) en
 * wanneer het naar verwachting afgevuld wordt (`komtEraan` uit
 * utils/verkoopOverzicht). Een tik opent de batch.
 */
const KomtEraanRegel: React.FC<KomtEraanRegelProps> = ({ k, productNaam, vandaag, onOpen }) => {
  const tekst = komtEraanTekst(k, productNaam, vandaag)
  const inhoud = (
    <>
      <span className="min-w-0 flex-1 break-words">
        <strong className="font-semibold text-gray-800">{t('orders_komt_eraan')}</strong>{' '}{tekst}
      </span>
      {onOpen && <span aria-hidden="true" className="text-gray-400 text-base leading-none">›</span>}
    </>
  )
  const cls = 'mt-2 w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700'
  return onOpen ? (
    <button type="button" onClick={() => onOpen(k.batchId)} title={t('orders_komt_open_batch')}
      className={`${cls} min-h-tap sm:min-h-0 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]`}>
      {inhoud}
    </button>
  ) : <div className={cls}>{inhoud}</div>
}

export default KomtEraanRegel
