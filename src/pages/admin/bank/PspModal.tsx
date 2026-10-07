import React from 'react'
import { t } from '../../../i18n'
import { r2 } from '../../../utils/format'
import { pspFactuurDatum } from '../../../utils/bank'
import Modal from '../../../components/ui/Modal'
import TransactieKop from './TransactieKop'
import { fmt } from '../adminContext'

// ── PSP-uitbetaling uitsplitsen ─────────────────────────────────────────────
// Eén credittransactie (Mollie e.d.) dekt meerdere verkoopfacturen; het
// verschil wordt transactiekosten. Overgenomen uit de oude Bank-tab; het
// opslaan zelf (`savePspKoppeling`) staat ongewijzigd in BankSectie.

export interface PspModalProps {
  tx: any
  verkoopFacturen: any[]
  selectie: number[]
  setSelectie: (f: (prev: number[]) => number[]) => void
  btwPct: string
  setBtwPct: (v: string) => void
  toonAlles: boolean
  setToonAlles: (f: (v: boolean) => boolean) => void
  /** Kandidaten rond de uitbetaaldatum (`negeerDatum` laat het tijdvak los). */
  kandidatenVoor: (tx: any, negeerDatum: boolean) => any[]
  klantNaamVoor: (f: any) => string
  onOpslaan: () => void
  onSluit: () => void
}

const PspModal: React.FC<PspModalProps> = ({
  tx, verkoopFacturen, selectie, setSelectie, btwPct, setBtwPct, toonAlles, setToonAlles,
  kandidatenVoor, klantNaamVoor, onOpslaan, onSluit,
}) => {
  // Alleen facturen die écht in een PSP-uitbetaling kúnnen zitten:
  // elders gekoppelde en aan de balie afgerekende facturen laten we
  // helemaal weg. Het vinkje laat alleen het tijdvak los, voor het
  // geval de bundel buiten dat venster valt.
  const kandidaten = (verkoopFacturen || [])
    .filter((f: any) => selectie.includes(f.id) && (f.bruto || 0) > 0)
    .concat(kandidatenVoor(tx, toonAlles).filter((f: any) => !selectie.includes(f.id)))
    .sort((a: any, b: any) => pspFactuurDatum(b).localeCompare(pspFactuurDatum(a)))
  const som = r2((verkoopFacturen || []).filter((f: any) => selectie.includes(f.id)).reduce((s: number, f: any) => s + (f.bruto || 0), 0))
  const kosten = r2(som - tx.bedrag)
  const somTeLaag = selectie.length > 0 && kosten < -0.005
  const toggleFactuur = (id: number) => setSelectie((prev: number[]) =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  return (
    <Modal title={t('title_psp_koppeling')} onClose={onSluit}>
      <div className="space-y-3">
        <TransactieKop tx={tx} />
        <p className="text-xs text-gray-500">{t('msg_psp_uitleg')}</p>
        {/* Niets voorgesteld: zeg wát de gebruiker dan kan doen in plaats
            van een lege lijst met vinkjes te tonen. */}
        {selectie.length === 0 && (
          <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            {t('msg_psp_geen_voorstel')}
          </p>
        )}
        <div className="max-h-64 overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg divide-y divide-gray-50">
          {kandidaten.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-4">{t('msg_no_verkoopfacturen')}</div>
          )}
          {kandidaten.map((f: any) => (
            <label key={f.id} className="flex items-center gap-2 px-3 py-1.5 min-h-tap sm:min-h-0 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" className="t-checkbox" checked={selectie.includes(f.id)} onChange={() => toggleFactuur(f.id)} />
              <span className="text-gray-500 whitespace-nowrap"
                title={f.datum && pspFactuurDatum(f) !== f.datum ? `${t('lbl_factuurdatum')}: ${f.datum}` : ''}>
                {pspFactuurDatum(f) || '—'}
              </span>
              <span className="flex-1 min-w-0 truncate text-gray-800">{f.factuurnummer ? `${f.factuurnummer} · ` : ''}{klantNaamVoor(f) || t('lbl_onbekend')}</span>
              {f.status === 'betaald' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 whitespace-nowrap">{t('factuur_paid')}</span>}
              <span className="font-medium text-gray-700 whitespace-nowrap tabular-nums">{fmt(f.bruto || 0)}</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer min-h-tap sm:min-h-0">
          <input type="checkbox" className="t-checkbox" checked={toonAlles} onChange={() => setToonAlles((v: boolean) => !v)} />
          {t('btn_psp_toon_alles')}
        </label>
        <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>{t('lbl_psp_som')} ({selectie.length})</span>
            <span className="font-medium tabular-nums">{fmt(som)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>{t('lbl_psp_uitbetaald')}</span>
            <span className="font-medium tabular-nums">{fmt(tx.bedrag)}</span>
          </div>
          <div className={`flex justify-between font-semibold ${somTeLaag ? 'text-red-600' : 'text-gray-800'}`}>
            <span>{t('lbl_psp_kosten')}</span>
            <span className="tabular-nums">{fmt(Math.max(kosten, 0))}</span>
          </div>
          {somTeLaag && <p className="text-xs text-red-600">{t('msg_psp_som_te_laag')}</p>}
        </div>
        {kosten > 0.005 && !somTeLaag && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-gray-500">{t('msg_psp_kosten_hint')}</span>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
              {t('lbl_psp_kosten_btw')}
              <select value={btwPct} onChange={(e: any) => setBtwPct(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-tap sm:min-h-0 t-input focus:outline-none bg-white">
                <option value="0">0%</option>
                <option value="9">9%</option>
                <option value="21">21%</option>
              </select>
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onSluit}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            {t('btn_cancel')}
          </button>
          <button type="button" onClick={onOpslaan} disabled={!selectie.length || somTeLaag}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            {t('btn_psp_koppel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default PspModal
