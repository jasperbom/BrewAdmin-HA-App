import React from 'react'
import { t } from '../../../i18n'
import { toCent } from '../../../utils/centen'
import { pspFactuurDatum } from '../../../utils/bank'
import { vulIn } from '../../../utils/periode'
import { verslagKosten, type VerslagKoppeling } from '../../../utils/pspVerslag'
import { pspKostenRegels, type KostenFactuurKandidaat, type PspVerslagInfo } from '../../../utils/pspUitbetaling'
import type { TeFactureren } from '../../../utils/orderFactuur'
import Modal from '../../../components/ui/Modal'
import TransactieKop from './TransactieKop'
import VerslagBlok, { type VerslagStand } from './VerslagBlok'
import { geldCent } from './bankTekst'
import { fmt } from '../adminContext'

// ── PSP-uitbetaling uitsplitsen ─────────────────────────────────────────────
// Eén credittransactie (Mollie e.d.) dekt meerdere verkoopfacturen; het
// verschil zijn de kosten die de PSP inhield. Met het uitbetalingsverslag
// erbij zoekt de app de facturen zelf (utils/pspVerslag.ts). De kosten worden
// verrekend met de factuur die de PSP er (meestal aan het eind van de maand)
// voor stuurt — of, als die nog niet geboekt is, "factuur volgt" — of zoals
// vroeger meteen als betaalde kostenpost geboekt. Het opslaan zelf
// (`savePspKoppeling`) staat in BankSectie.

export type PspKostenWijze = 'verrekenen' | 'kostenpost'

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
  /** Korte naam van de PSP ("Mollie"). */
  psp: string
  /** Het verslag op de transactie, hoe het lezen ervoor staat en welke factuur bij elke regel hoort. */
  verslagInfo: PspVerslagInfo | null
  verslagStand: VerslagStand | null
  verslagKoppeling: VerslagKoppeling | null
  /** Er is een Claude-sleutel: het verslag mag ook een scan of foto zijn. */
  verslagSleutel: boolean
  onKiesVerslag: () => void
  /** Bestellingen uit het verslag zonder factuur (nog niet afgerond) en hoe het daarmee staat. */
  teFactureren: TeFactureren[]
  factureerBezig: boolean
  /** Factureer deze bestellingen nu al (utils/orderFactuur.ts). */
  onFactureer: (bestellingIds: number[]) => void
  kostenWijze: PspKostenWijze
  setKostenWijze: (w: PspKostenWijze) => void
  /** Per factuurnummer uit het verslag ('' zonder verslag) de gekozen inkoopfactuur; null = factuur volgt. */
  kostenKeuze: Record<string, number | null>
  setKostenKeuze: (f: (prev: Record<string, number | null>) => Record<string, number | null>) => void
  kostenKandidaten: KostenFactuurKandidaat[]
  onOpslaan: () => void
  onSluit: () => void
}

const brutoCent = (f: any): number => {
  const c = f?.bruto_cent
  return c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c)) ? Math.round(Number(c)) : toCent(f?.bruto)
}

const PspModal: React.FC<PspModalProps> = ({
  tx, verkoopFacturen, selectie, setSelectie, btwPct, setBtwPct, toonAlles, setToonAlles,
  kandidatenVoor, klantNaamVoor, psp, verslagInfo, verslagStand, verslagKoppeling, verslagSleutel, onKiesVerslag,
  teFactureren, factureerBezig, onFactureer,
  kostenWijze, setKostenWijze, kostenKeuze, setKostenKeuze, kostenKandidaten, onOpslaan, onSluit,
}) => {
  // Alleen facturen die écht in een PSP-uitbetaling kúnnen zitten:
  // elders gekoppelde en aan de balie afgerekende facturen laten we
  // helemaal weg. Het vinkje laat alleen het tijdvak los, voor het
  // geval de bundel buiten dat venster valt. Een creditnota (terugstorting
  // uit het verslag) staat erbij zolang hij gekozen is.
  const kandidaten = (verkoopFacturen || [])
    .filter((f: any) => selectie.includes(f.id) && brutoCent(f) !== 0)
    .concat(kandidatenVoor(tx, toonAlles).filter((f: any) => !selectie.includes(f.id)))
    .sort((a: any, b: any) => pspFactuurDatum(b).localeCompare(pspFactuurDatum(a)))
  const somCent = (verkoopFacturen || []).filter((f: any) => selectie.includes(f.id)).reduce((s: number, f: any) => s + brutoCent(f), 0)
  const uitbetaaldCent = toCent(tx.bedrag)
  const kostenCent = somCent - uitbetaaldCent
  const somTeLaag = selectie.length > 0 && kostenCent < 0
  const vKosten = verslagStand?.gelezen ? verslagKosten(verslagStand.gelezen) : (verslagInfo?.kosten || null)
  const { regels, klopt, verslagCent } = pspKostenRegels(Math.max(0, kostenCent), vKosten)
  const verrekenKlopt = klopt !== false
  const kanOpslaan = selectie.length > 0 && !somTeLaag && !verslagStand?.bezig
    && !(kostenCent > 0 && kostenWijze === 'verrekenen' && !verrekenKlopt)
  const toggleFactuur = (id: number) => setSelectie((prev: number[]) =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const nummerVan = (id: number): string => {
    const f = (verkoopFacturen || []).find((x: any) => x.id === id)
    return f?.factuurnummer || t('lbl_naamloos')
  }
  const optieLabel = (k: KostenFactuurKandidaat): string => [
    k.factuur.factuurnummer || t('lbl_naamloos'),
    geldCent(k.bedragCent),
    k.verrekendCent > 0 ? vulIn(t('psp_kosten_optie_rest'), { bedrag: geldCent(k.restCent) }) : '',
  ].filter(Boolean).join(' · ')
  return (
    <Modal title={t('title_psp_koppeling')} onClose={onSluit} wide>
      <div className="space-y-3">
        <TransactieKop tx={tx} />
        <VerslagBlok info={verslagInfo} stand={verslagStand} koppeling={verslagKoppeling} uitbetaaldCent={uitbetaaldCent}
          psp={psp} factuurNummer={nummerVan} sleutel={verslagSleutel} onKies={onKiesVerslag}
          teFactureren={teFactureren} factureerBezig={factureerBezig} onFactureer={onFactureer} />
        <p className="text-xs text-gray-500">{t('msg_psp_uitleg')}</p>
        {/* Niets voorgesteld: zeg wát de gebruiker dan kan doen in plaats
            van een lege lijst met vinkjes te tonen. */}
        {selectie.length === 0 && !verslagStand?.bezig && (
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
              {f.status === 'credit' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 whitespace-nowrap">{t('fb_status_credit')}</span>}
              <span className="font-medium text-gray-700 whitespace-nowrap tabular-nums">{fmt(brutoCent(f) / 100)}</span>
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
            <span className="font-medium tabular-nums">{geldCent(somCent)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>{t('lbl_psp_uitbetaald')}</span>
            <span className="font-medium tabular-nums">{geldCent(uitbetaaldCent)}</span>
          </div>
          <div className={`flex justify-between font-semibold ${somTeLaag ? 'text-red-600' : 'text-gray-800'}`}>
            <span>{t('lbl_psp_kosten')}</span>
            <span className="tabular-nums">{geldCent(Math.max(kostenCent, 0))}</span>
          </div>
          {somTeLaag && <p className="text-xs text-red-600">{t('msg_psp_som_te_laag')}</p>}
        </div>
        {kostenCent > 0 && !somTeLaag && (
          <fieldset className="rounded-lg border border-gray-200 px-3 pt-1 pb-2 space-y-2 min-w-0">
            <legend className="px-1 text-sm font-semibold text-gray-800">{vulIn(t('psp_kosten_kop'), { psp })}</legend>
            <label className="flex items-start gap-2 text-sm cursor-pointer min-h-tap sm:min-h-0">
              <input type="radio" name="psp-kosten" className="t-checkbox mt-1" checked={kostenWijze === 'verrekenen'} onChange={() => setKostenWijze('verrekenen')} />
              <span className="min-w-0">
                <span className="block font-medium text-gray-800">{vulIn(t('psp_kosten_verrekenen'), { psp })}</span>
                <span className="block text-xs text-gray-500">{vulIn(t('psp_kosten_verrekenen_uitleg'), { psp })}</span>
              </span>
            </label>
            {kostenWijze === 'verrekenen' && (
              <div className="pl-6 space-y-1.5">
                {!verrekenKlopt ? (
                  <p className="text-xs text-red-700" role="alert">
                    {vulIn(t('psp_kosten_verslag_klopt_niet'), { verslag: geldCent(verslagCent), kosten: geldCent(kostenCent) })}
                  </p>
                ) : regels.map(r => (
                  <div key={r.nummer || '-'} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex-1 min-w-[10rem] text-sm text-gray-700 break-words">
                      {r.nummer || t('psp_kosten_regel_zonder_nr')} · <b className="tabular-nums">{geldCent(r.cent)}</b>
                    </span>
                    <select value={kostenKeuze[r.nummer] ?? ''} aria-label={vulIn(t('psp_kosten_kies_factuur'), { nummer: r.nummer || t('psp_kosten_regel_zonder_nr') })}
                      onChange={(e: any) => { const v = e.target.value; setKostenKeuze(prev => ({ ...prev, [r.nummer]: v ? Number(v) : null })) }}
                      className="w-full sm:w-auto max-w-full border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-tap sm:min-h-0 t-input focus:outline-none bg-white">
                      <option value="">{t('psp_kosten_factuur_volgt')}</option>
                      {kostenKandidaten.map(k => <option key={k.id} value={k.id}>{optieLabel(k)}</option>)}
                    </select>
                  </div>
                ))}
                {verrekenKlopt && regels.some(r => kostenKeuze[r.nummer] == null) && (
                  <p className="text-xs text-gray-500">{t('psp_kosten_volgt_uitleg')}</p>
                )}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm cursor-pointer min-h-tap sm:min-h-0">
              <input type="radio" name="psp-kosten" className="t-checkbox mt-1" checked={kostenWijze === 'kostenpost'} onChange={() => setKostenWijze('kostenpost')} />
              <span className="min-w-0">
                <span className="block font-medium text-gray-800">{t('psp_kosten_post')}</span>
                <span className="block text-xs text-gray-500">{t('msg_psp_kosten_hint')}</span>
              </span>
            </label>
            {kostenWijze === 'kostenpost' && (
              <label className="pl-6 flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                {t('lbl_psp_kosten_btw')}
                <select value={btwPct} onChange={(e: any) => setBtwPct(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-tap sm:min-h-0 t-input focus:outline-none bg-white">
                  <option value="0">0%</option>
                  <option value="9">9%</option>
                  <option value="21">21%</option>
                </select>
              </label>
            )}
          </fieldset>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onSluit}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            {t('btn_cancel')}
          </button>
          <button type="button" onClick={onOpslaan} disabled={!kanOpslaan}
            className="px-4 py-1.5 min-h-tap sm:min-h-0 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            {t('btn_psp_koppel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default PspModal
