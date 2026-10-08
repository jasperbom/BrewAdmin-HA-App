import React from 'react'
import { t, getLang } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import Btn from '../ui/Btn'
import Icon from '../ui/Icon'
import { useBreedte } from '../ui/useBreedte'
import { STATUS_CLR, batchStatusLabel } from '../../utils/constants'
import { fmtD, fmtWeekdagDatum } from '../../utils/format'
import { fmtGetal, bronKortSleutel } from '../../utils/etiket'
import { komtEraanDelen, komtWanneer } from '../../utils/verkoopDashboard'
import type { KomtEraanBatch, VerkoopVerpakking } from '../../utils/verkoopOverzicht'
import type { BrouwselRegel } from '../../utils/productPagina'

// De brouwsels van een product (SPEC M ④, Maken; N segment Brouwsels): wat
// er in de tank ligt ("In de tank: #2609 · GV1 · Conditioneren dag 8 ·
// afvullen ± vr 16-10 · ± 710 fles · 2 fust (geschat)"), en elke batch als
// klikbare regel (#, datum, recept, status, ABV met bron, liters), nieuwste
// eerst. Een regel en zijn lotcodes openen de batch. In de kop "Nieuwe batch".

export interface TankTegelData {
  k: KomtEraanBatch
  /** Dag in de fase ("Conditioneren dag 8"), als die bekend is. */
  dag: number | null
}

interface TankTegelProps {
  tegel: TankTegelData
  vandaag: string
  verpakkingen: VerkoopVerpakking[]
  onOpen: (batchId: number) => void
  /** Zonder het label "In de tank" (de kaart "Komt eraan" noemt het zelf). */
  zonderLabel?: boolean
}

/** "#2609 · GV1 · Conditioneren dag 8" en "afvullen ± vr 16-10 · ± 710 fles · 2 fust (geschat)". */
export const TankTegel: React.FC<TankTegelProps> = ({ tegel, vandaag, verpakkingen, onOpen, zonderLabel }) => {
  const { k, dag } = tegel
  const taal = getLang()
  const datum = (d: string) => fmtWeekdagDatum(d, { jaar: false, lang: taal })
  const gepland = k.status === 'Gepland'
  const w = komtWanneer(k, vandaag)
  const wanneer = w.soort === 'datum' ? t('verkoop_komt_afvullen').replace('{datum}', datum(w.datum))
    : w.soort === 'over_tijd' ? t('orders_komt_over_tijd') : ''
  const stuks = komtEraanDelen(k, t, { vandaag, verpakkingen }).stuks
  const regel2 = [
    gepland && k.geplandeBrouwdatum ? t('keten_brouwdag').replace('{datum}', datum(k.geplandeBrouwdatum)) : '',
    wanneer,
    stuks ? `${stuks} ${t('product_komt_geschat')}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={() => onOpen(k.batchId)} title={t('orders_komt_open_batch')}
      className="w-full text-left rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 hover:bg-gray-100 transition-colors flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      <span className="flex-1 min-w-0">
        {!zonderLabel && (
          <span className="block text-xs text-gray-500">{t(gepland ? 'product_tegel_gepland' : 'product_tegel_in_tank')}</span>
        )}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-gray-900">
          <span>{[k.batchNummer ? `#${k.batchNummer}` : t('verkoop_komt_batch'), !gepland && k.tank ? k.tank : ''].filter(Boolean).join(' · ')}</span>
          {/* Bij een geplande batch zegt het label het al ("Gepland"). */}
          {!(gepland && !zonderLabel) && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLR[k.status] || 'bg-gray-100 text-gray-600'}`}>
              {batchStatusLabel(k.status)}{dag ? ` ${t('batches_dag').replace('{n}', String(dag))}` : ''}
            </span>
          )}
        </span>
        {regel2 && <span className="block text-[13px] text-gray-700 mt-0.5 break-words">{regel2}</span>}
      </span>
      <span aria-hidden="true" className="text-gray-400 text-lg leading-none flex-shrink-0">›</span>
    </button>
  )
}

/** "7,0 berekend": de alcohol met een bronlabel als hij (nog) niet vaststaat. */
const abvTekst = (r: BrouwselRegel, taal: string): { waarde: string; bron: string } => {
  if (r.abv.waarde == null) return { waarde: '—', bron: '' }
  const bron = r.abv.bron === 'berekend' || r.abv.bron === 'verwacht' ? t(bronKortSleutel(r.abv.bron)) : ''
  return { waarde: fmtGetal(Math.round(r.abv.waarde * 10) / 10, 1, taal), bron }
}

interface LotcodesProps { codes: string[]; onOpen: () => void }
const Lotcodes: React.FC<LotcodesProps> = ({ codes, onOpen }) => codes.length ? (
  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
    {codes.map(c => (
      <button key={c} type="button" onClick={e => { e.stopPropagation(); onOpen() }}
        className="font-mono text-xs text-gray-600 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        {c}
      </button>
    ))}
  </span>
) : null

export interface BrouwselsKaartProps {
  regels: BrouwselRegel[]
  tegels: TankTegelData[]
  vandaag: string
  verpakkingen: VerkoopVerpakking[]
  onOpenBatch: (id: number) => void
  /** "Nieuwe batch" (F8); zonder: geen knop. */
  onNieuweBatch?: () => void
  /** ⋯ van de kaart (Batch koppelen). */
  acties: RowActie[]
  /** ⋯ per regel (Ontkoppelen). */
  rijActies: (r: BrouwselRegel) => RowActie[]
  /** De keuzelijst om een batch te koppelen, als die open staat. */
  koppelLijst?: React.ReactNode
  /** Wat de brouwsels laten zien: gemiddelden en trend. */
  trend?: React.ReactNode
  /** Telefoon: de tegels staan bij Voorraad ("Komt eraan"), de knop in de ActieBalk. */
  telefoon: boolean
  /** De naam van het bier: een recept met dezelfde naam staat er in de lijst niet nog eens bij. */
  productNaam?: string
  id?: string
}

/** Zoveel regels zonder uitklappen. */
const EERSTE = 3

const BrouwselsKaart: React.FC<BrouwselsKaartProps> = ({
  regels, tegels, vandaag, verpakkingen, onOpenBatch, onNieuweBatch, acties, rijActies, koppelLijst, trend, telefoon, productNaam, id,
}) => {
  const [alle, setAlle] = React.useState(false)
  const [ref, breedte] = useBreedte<HTMLElement>()
  const taal = getLang()
  const lijst = telefoon || (breedte !== null && breedte < 440)
  const zichtbaar = alle ? regels : regels.slice(0, EERSTE)

  return (
    <section ref={ref} id={id} className="bg-white rounded-xl shadow-card overflow-hidden scroll-mt-4">
      <SectionHeader title={t('product_keten_brouwsels')}
        info={(onNieuweBatch && !telefoon) || acties.length ? (
          <>
            {onNieuweBatch && !telefoon && <Btn v="secondary" s="sm" onClick={onNieuweBatch}>{t('product_nieuwe_batch')}</Btn>}
            {acties.length > 0 && <RowActions v="kaart" acties={acties} />}
          </>
        ) : undefined} />
      <div className="px-4 py-3 space-y-3">
        {!telefoon && tegels.map(tg => (
          <TankTegel key={tg.k.batchId} tegel={tg} vandaag={vandaag} verpakkingen={verpakkingen} onOpen={onOpenBatch} />
        ))}

        {regels.length === 0 && !koppelLijst && (
          <p className="text-sm text-gray-500">{t('product_keten_geen_brouwsels')}</p>
        )}

        {regels.length > 0 && lijst && (
          <ul className="divide-y divide-gray-100 -mx-1">
            {zichtbaar.map(r => {
              const abv = abvTekst(r, taal)
              const acties = rijActies(r)
              return (
                <li key={r.batchId} className="flex items-start gap-2">
                  <button type="button" onClick={() => onOpenBatch(r.batchId)}
                    className="flex-1 min-w-0 text-left px-1 py-2 min-h-tap rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold t-accent-text">{r.nummer ? `#${r.nummer}` : (r.naam || t('lbl_naamloos'))}</span>
                      {r.datum && <span className="text-sm text-gray-600">{fmtD(r.datum)}</span>}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLR[r.status] || 'bg-gray-100 text-gray-600'}`}>{batchStatusLabel(r.status)}</span>
                    </span>
                    <span className="block text-[13px] text-gray-600 mt-0.5 break-words">
                      {[r.receptKort !== productNaam ? r.receptKort : '', abv.waarde !== '—' ? `${abv.waarde} % ${abv.bron}`.trim() : '', r.liters ? `${r.liters} L` : ''].filter(Boolean).join(' · ')}
                    </span>
                    {r.lotcodes.length > 0 && <span className="block mt-0.5"><Lotcodes codes={r.lotcodes} onOpen={() => onOpenBatch(r.batchId)} /></span>}
                  </button>
                  {acties.length > 0 && <RowActions v="kaart" cls="mt-1.5" acties={acties} />}
                </li>
              )
            })}
          </ul>
        )}

        {regels.length > 0 && !lijst && (
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="w-[15%] text-left font-medium py-1.5">#</th>
                <th className="w-[18%] text-left font-medium py-1.5">{t('lbl_datum')}</th>
                <th className="text-left font-medium py-1.5">{t('product_kolom_recept')}</th>
                <th className="w-[22%] text-left font-medium py-1.5">{t('lbl_status')}</th>
                <th className="w-[12%] text-left font-medium py-1.5">{t('bier_veld_abv')}</th>
                <th className="w-[7%] text-right font-medium py-1.5">L</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map(r => {
                const abv = abvTekst(r, taal)
                const acties = rijActies(r)
                return (
                  <tr key={r.batchId} onClick={() => onOpenBatch(r.batchId)}
                    className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 align-top">
                    <td className="py-2 pr-2">
                      <button type="button" onClick={e => { e.stopPropagation(); onOpenBatch(r.batchId) }}
                        className="font-semibold t-accent-text hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                        {r.nummer ? `#${r.nummer}` : (r.naam || t('lbl_naamloos'))}
                      </button>
                      <Lotcodes codes={r.lotcodes} onOpen={() => onOpenBatch(r.batchId)} />
                    </td>
                    <td className="py-2 pr-2 text-[13px] text-gray-700 whitespace-nowrap">{r.datum ? fmtD(r.datum) : '—'}</td>
                    <td className="py-2 pr-2 text-gray-700 break-words" title={r.recept || ''}>{r.receptKort || '—'}</td>
                    <td className="py-2 pr-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLR[r.status] || 'bg-gray-100 text-gray-600'}`}>{batchStatusLabel(r.status)}</span>
                    </td>
                    <td className="py-2 pr-2 text-gray-800">
                      {abv.waarde}{abv.bron && <span className="block text-xs text-gray-500">{abv.bron}</span>}
                    </td>
                    <td className="py-2 text-right text-gray-800">{r.liters ?? '—'}</td>
                    <td className="py-1.5 text-right">{acties.length > 0 && <RowActions acties={acties} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {regels.length > EERSTE && (
          <button type="button" onClick={() => setAlle(a => !a)} aria-expanded={alle}
            className="inline-flex items-center gap-1 text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            <Icon n="chevronRight" cls={`transition-transform ${alle ? 'rotate-90' : ''}`} />
            {alle ? t('product_brouwsels_minder') : t('product_brouwsels_alle').replace('{n}', String(regels.length))}
          </button>
        )}

        {trend}
        {koppelLijst}
      </div>
    </section>
  )
}

export default BrouwselsKaart
