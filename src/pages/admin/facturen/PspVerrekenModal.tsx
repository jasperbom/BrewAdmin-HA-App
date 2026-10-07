import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Btn from '../../../components/ui/Btn'
import LegeStaat from '../../../components/ui/LegeStaat'
import { dagNotatie, vulIn } from '../../../utils/periode'
import { inkoopBrutoCent, type VerrekenKandidaat } from '../../../utils/pspUitbetaling'
import { fmt } from '../adminContext'

// ── De factuur van een PSP verrekenen met de uitbetalingen ──────────────────
// Mollie e.d. houden de kosten in op elke uitbetaling en sturen er per maand
// één factuur voor. Hier vink je aan welke uitbetalingen deze factuur dekten:
// wat het uitbetalingsverslag aan deze factuur toeschrijft (en wat al
// verrekend is) staat al aangevinkt. Een uitbetaling met een automatische
// kostenpost (de oude manier) kan ook: die post vervalt dan. De kandidaten en
// de bedragen komen uit utils/pspUitbetaling.ts; het vastleggen doet de pagina.

export interface PspVerrekenModalProps {
  factuur: any
  kandidaten: VerrekenKandidaat[]
  /** Mag deze automatische kostenpost vervallen (niet in een ingediende BTW-periode)? */
  kostenpostMagVervallen: (id: number) => boolean
  /** Per uitbetaling het bedrag (0 = niet meer met deze factuur verrekenen); alleen wat verandert. */
  onOpslaan: (keuzes: { key: string, cent: number }[]) => void
  onNaarBank: () => void
  onSluit: () => void
}

const geld = (cent: number): string => fmt(cent / 100)

const PspVerrekenModal: React.FC<PspVerrekenModalProps> = ({ factuur, kandidaten, kostenpostMagVervallen, onOpslaan, onNaarBank, onSluit }) => {
  const [gekozen, setGekozen] = React.useState<Set<string>>(() => new Set(kandidaten.filter(k => k.voorgesteld).map(k => k.key)))
  const totaal = Math.abs(inkoopBrutoCent(factuur))
  const geblokkeerd = (k: VerrekenKandidaat): boolean => !!k.kostenpost && k.ditCent === 0 && !kostenpostMagVervallen(k.kostenpost.id)
  const som = kandidaten.filter(k => gekozen.has(k.key)).reduce((s, k) => s + k.voorstelCent, 0)
  const wissel = (key: string) => setGekozen(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  })
  const keuzes = kandidaten
    .filter(k => gekozen.has(k.key) ? k.ditCent !== k.voorstelCent : k.ditCent > 0)
    .map(k => ({ key: k.key, cent: gekozen.has(k.key) ? k.voorstelCent : 0 }))
  const subregel = (k: VerrekenKandidaat): string => [
    k.referentie ? vulIn(t('fct_psp_verreken_verslag'), { referentie: k.referentie }) : '',
    k.verslagCent !== null ? vulIn(t('fct_psp_verreken_volgens_verslag'), { bedrag: geld(k.verslagCent) })
      : k.openCent > 0 ? vulIn(t('fct_psp_verreken_open'), { bedrag: geld(k.openCent) }) : '',
    k.kostenpost ? (geblokkeerd(k) ? t('fct_psp_verreken_post_vast') : vulIn(t('fct_psp_verreken_vervangt'), { bedrag: geld(k.kostenpost.cent) })) : '',
    k.ditCent > 0 ? t('fct_psp_verreken_al') : '',
  ].filter(Boolean).join(' · ')
  return (
    <Modal title={t('fct_psp_verreken_titel')} onClose={onSluit} wide>
      <div className="space-y-3">
        <div className="text-sm bg-gray-50 rounded-lg px-3 py-2 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-gray-900 min-w-0 break-words">{[factuur.factuurnummer, factuur.leverancier].filter(Boolean).join(' · ') || '—'}</span>
            <span className="font-semibold whitespace-nowrap tabular-nums">{geld(totaal)}</span>
          </div>
          {factuur.datum && <div className="text-xs text-gray-600 mt-0.5">{dagNotatie(factuur.datum)}</div>}
        </div>
        {kandidaten.length === 0 ? (
          <LegeStaat titel={t('fct_psp_verreken_leeg')} tekst={t('fct_psp_verreken_leeg_tekst')}>
            <Btn v="secondary" onClick={onNaarBank}>{t('bank_naar_bank')}</Btn>
          </LegeStaat>
        ) : (
          <>
            <p className="text-sm text-gray-600">{vulIn(t('fct_psp_verreken_uitleg'), { leverancier: factuur.leverancier || 'PSP' })}</p>
            <ul className="max-h-[50vh] overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg divide-y divide-gray-100" aria-label={t('fct_psp_verreken_titel')}>
              {kandidaten.map(k => (
                <li key={k.key}>
                  <label className={`flex items-start gap-3 px-3 py-2 min-h-tap ${geblokkeerd(k) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                    <input type="checkbox" className="t-checkbox mt-1" checked={gekozen.has(k.key)} disabled={geblokkeerd(k)} onChange={() => wissel(k.key)} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 break-words">
                        {[k.dag ? dagNotatie(k.dag) : '', k.tegenpartij, k.bedrag_cent !== null ? geld(k.bedrag_cent) : ''].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="block text-xs text-gray-500 break-words">{subregel(k)}</span>
                    </span>
                    <span className="text-sm font-semibold text-gray-800 whitespace-nowrap tabular-nums">{geld(k.voorstelCent)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm" aria-live="polite">
              <div className="flex justify-between text-gray-700">
                <span>{t('fct_psp_verreken_som')}</span>
                <span className="font-semibold tabular-nums">{geld(som)} / {geld(totaal)}</span>
              </div>
              {som === totaal && totaal > 0 && <p className="text-xs text-green-700">✓ {t('fct_psp_verreken_dekt')}</p>}
              {som < totaal && <p className="text-xs text-orange-700">{vulIn(t('fct_psp_verreken_rest'), { bedrag: geld(totaal - som) })}</p>}
              {som > totaal && <p className="text-xs text-orange-700">{vulIn(t('fct_psp_verreken_te_veel'), { bedrag: geld(som - totaal) })}</p>}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Btn v="secondary" onClick={onSluit}>{t('btn_cancel')}</Btn>
          {kandidaten.length > 0 && <Btn onClick={() => onOpslaan(keuzes)} disabled={!keuzes.length}>{t('btn_save')}</Btn>}
        </div>
      </div>
    </Modal>
  )
}

export default PspVerrekenModal
