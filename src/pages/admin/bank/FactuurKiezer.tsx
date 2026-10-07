import React from 'react'
import { t } from '../../../i18n'
import { fmtD } from '../../../utils/format'
import { vulIn } from '../../../utils/periode'
import { factuurKiezerKandidaten, type FactuurKiezerSoort } from '../../../utils/bankVoorstel'
import Modal from '../../../components/ui/Modal'
import SearchInput from '../../../components/ui/SearchInput'
import LegeStaat from '../../../components/ui/LegeStaat'
import TransactieKop from './TransactieKop'
import { geldCent } from './bankTekst'

// ── "Koppel aan verkoopfactuur / inkoopfactuur / creditnota…" ──────────────
// Een kiezer met zoeken in plaats van een keuzelijst met elke open factuur.
// Wat qua bedrag klopt staat bovenaan; een open factuur die al aan een andere
// transactie hangt (deelbetaling) staat achteraan, met die waarschuwing erbij.
// De regels zelf: `factuurKiezerKandidaten` in utils/bankVoorstel.ts.

const MAX_GETOOND = 60

export interface FactuurKiezerProps {
  tx: any
  soort: FactuurKiezerSoort
  facturen: any[]
  bankKoppelingen: Record<string, any>
  klantNaamVoor: (f: any) => string
  onKies: (factuurId: number) => void
  onSluit: () => void
}

const TITEL: Record<FactuurKiezerSoort, string> = {
  verkoop: 'bank_kies_verkoop_titel',
  inkoop: 'bank_kies_inkoop_titel',
  creditnota: 'bank_kies_creditnota_titel',
}

const FactuurKiezer: React.FC<FactuurKiezerProps> = ({ tx, soort, facturen, bankKoppelingen, klantNaamVoor, onKies, onSluit }) => {
  const [zoek, setZoek] = React.useState('')
  const [ookBetaald, setOokBetaald] = React.useState(false)
  const regels = React.useMemo(
    () => factuurKiezerKandidaten(tx, soort, facturen, { zoek, ookBetaald, bankKoppelingen, klantNaam: klantNaamVoor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx, soort, facturen, zoek, ookBetaald, bankKoppelingen])
  const getoond = regels.slice(0, MAX_GETOOND)
  const huidig = soort === 'verkoop' ? tx?.gekoppeldFactuurId : tx?.gekoppeldInkoopId
  return (
    <Modal title={t(TITEL[soort])} onClose={onSluit} wide>
      <div className="space-y-3">
        <TransactieKop tx={tx} />
        <SearchInput value={zoek} onChange={setZoek} placeholder={t('bank_kies_zoek_ph')} />
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer min-h-tap sm:min-h-0">
          <input type="checkbox" className="t-checkbox" checked={ookBetaald} onChange={() => setOokBetaald(v => !v)} />
          {t('bank_kies_ook_betaald')}
        </label>
        {getoond.length === 0 ? (
          <LegeStaat titel={t('bank_kies_leeg')} tekst={t('bank_kies_leeg_tekst')} />
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg divide-y divide-gray-100" aria-label={t(TITEL[soort])}>
            {getoond.map(r => {
              const f = r.factuur
              const isHuidig = huidig != null && Number(huidig) === r.id
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => { onKies(r.id); onSluit() }} aria-current={isHuidig || undefined}
                    className={`w-full text-left px-3 py-2 min-h-tap flex items-center gap-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${isHuidig ? 'bg-[color:var(--t-pale)]' : ''}`}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 break-words">
                        {f.factuurnummer || t('lbl_naamloos')}{r.naam ? ` · ${r.naam}` : ''}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {fmtD(f.datum) || '—'}
                        {r.klopt && <span className="ml-2 text-green-700 font-medium">✓ {t('bank_kies_bedrag_klopt')}</span>}
                        {r.betaald && <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">{t('factuur_paid')}</span>}
                        {r.elders && <span className="block text-orange-700">{t('bank_kies_elders')}</span>}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-gray-800 whitespace-nowrap tabular-nums">{geldCent(soort === 'creditnota' ? -r.bedragCent : r.bedragCent)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {regels.length > getoond.length && (
          <p className="text-xs text-gray-500">{vulIn(t('bank_kies_meer'), { n: regels.length - getoond.length })}</p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onSluit}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            {t('btn_cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default FactuurKiezer
