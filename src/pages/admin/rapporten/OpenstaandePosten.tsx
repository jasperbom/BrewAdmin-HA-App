import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import LegeStaat from '../../../components/ui/LegeStaat'
import Segment from '../../../components/inkoop/Segment'
import { useSmalScherm } from '../../../components/ui/useSmalScherm'
import { dagNotatie } from '../../../utils/periode'
import { verkoopCenten, inkoopCenten } from '../../../utils/factuurFilter'
import {
  openVerkoopOp, openInkoopOp, openstaandePosten, OUDERDOM_BUCKETS,
  type OpenPostInvoer, type OpenRelatie, type OpenstaandePosten as Analyse, type OuderdomBucket,
} from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import { bedrag, csvEuro, downloadCsv, useCsvExport, KAART, type RapportProps } from './hulp'

// ── Openstaande posten (ouderdom) op de peildatum ───────────────────────────
// Debiteuren (open verkoopfacturen, `isVerkoopFactuurOpen`) en crediteuren
// (open inkoopfacturen, `openInkoopFacturen`) zoals ze op de peildatum
// openstonden, per relatie in ouderdomsklassen. Een relatie klapt open naar
// haar facturen; een factuur opent het detail in Facturen.

type Kant = 'verkoop' | 'inkoop'

const BUCKET_LABEL: Record<OuderdomBucket, string> = {
  b0_30: 'lbl_b0_30', b31_60: 'lbl_b31_60', b61_90: 'lbl_b61_90', b90plus: 'lbl_b90plus',
}
const bucketKleur = (b: OuderdomBucket, cent: number): string =>
  !cent ? 'text-gray-300' : b === 'b90plus' ? 'text-red-600 font-medium' : b === 'b61_90' ? 'text-orange-700' : 'text-gray-700'

const OpenstaandePosten: React.FC<RapportProps> = ({ peildatum, vandaag, csvRef }) => {
  const { verkoopFacturen, inkoopFacturen, klantNaamVoor, gaNaarDoel } = useAdmin()
  const smal = useSmalScherm()
  const [kant, setKant] = React.useState<Kant>('verkoop')
  const [open, setOpen] = React.useState<Set<string>>(() => new Set())

  const debiteuren = React.useMemo<Analyse>(() => openstaandePosten(
    openVerkoopOp(verkoopFacturen || [], peildatum, vandaag).map((f: any): OpenPostInvoer => ({
      id: f.id, relatie: klantNaamVoor(f) || t('lbl_onbekend'), datum: f.datum,
      nummer: f.factuurnummer || `VF-${f.id}`, bedrag_cent: verkoopCenten(f).bruto_cent,
    })), peildatum), [verkoopFacturen, peildatum, vandaag, klantNaamVoor])
  const crediteuren = React.useMemo<Analyse>(() => openstaandePosten(
    openInkoopOp(inkoopFacturen || [], peildatum, vandaag).map((f: any): OpenPostInvoer => ({
      id: f.id, relatie: f.leverancier || t('lbl_onbekend'), datum: f.datum,
      nummer: f.factuurnummer || `IF-${f.id}`, bedrag_cent: inkoopCenten(f).bruto_cent,
    })), peildatum), [inkoopFacturen, peildatum, vandaag])
  const analyse = kant === 'verkoop' ? debiteuren : crediteuren
  const cent = (euro: number) => Math.round(euro * 100)

  // Wat openklapt geldt per kant: debiteur en crediteur kunnen dezelfde naam hebben.
  const openSleutel = (sleutel: string) => `${kant}:${sleutel}`
  const isOpenRij = (sleutel: string) => open.has(openSleutel(sleutel))
  const wissel = (sleutel: string) => setOpen(prev => {
    const n = new Set(prev)
    const k = openSleutel(sleutel)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const openFactuur = (id: number | string) => gaNaarDoel({ pagina: 'facturen', tab: kant, id: Number(id) })

  useCsvExport(csvRef, () => {
    const kop = [t('rap_kol_soort'), t('lbl_relatie'), t('lbl_invoice'), t('lbl_date'), t('rap_kol_dagen'),
      ...OUDERDOM_BUCKETS.map(b => t(BUCKET_LABEL[b])), t('lbl_total')]
    const rijen: unknown[][] = [kop]
    const voeg = (soort: string, a: Analyse) => {
      for (const r of a.rijen) for (const p of r.posten) {
        rijen.push([soort, r.relatie, p.nummer || '', p.datum || '', p.dagen,
          ...OUDERDOM_BUCKETS.map(b => b === p.bucket ? csvEuro(p.bedrag_cent) : ''), csvEuro(p.bedrag_cent)])
      }
      rijen.push([soort, t('lbl_total'), '', '', '', ...OUDERDOM_BUCKETS.map(b => csvEuro(cent(a.totalen[b]))), csvEuro(cent(a.totalen.totaal))])
    }
    voeg(t('lbl_debiteuren'), debiteuren)
    voeg(t('lbl_crediteuren'), crediteuren)
    downloadCsv(`openstaande_posten_${peildatum}.csv`, rijen)
  })

  const factuurRegel = (p: OpenRelatie['posten'][number]) => (
    <span className="min-w-0">
      <span className="font-medium t-accent-text">{p.nummer}</span>
      <span className="text-gray-500 tabular-nums"> · {p.datum ? dagNotatie(p.datum) : '—'} · {t('rap_dagen_n').replace('{n}', String(p.dagen))}</span>
    </span>
  )

  const telefoon = (
    <ul className="grid gap-2 p-3" aria-label={t(kant === 'verkoop' ? 'lbl_debiteuren' : 'lbl_crediteuren')}>
      {analyse.rijen.map(r => {
        const isOpen = isOpenRij(r.sleutel)
        return (
          <li key={r.sleutel} className="rounded-xl border border-gray-200 bg-white min-w-0">
            <button type="button" onClick={() => wissel(r.sleutel)} aria-expanded={isOpen}
              className="w-full text-left px-3 py-2.5 min-h-tap rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-semibold text-gray-900 break-words">
                  <span aria-hidden="true" className={`inline-block mr-1 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  {r.relatie}
                </span>
                <span className="tabular-nums font-semibold text-gray-900 whitespace-nowrap">{bedrag(cent(r.totaal))}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>{t(r.posten.length === 1 ? 'rap_facturen_1' : 'rap_facturen_n').replace('{n}', String(r.posten.length))}</span>
                {OUDERDOM_BUCKETS.filter(b => r[b]).map(b => (
                  <span key={b} className={bucketKleur(b, cent(r[b]))}>{t(BUCKET_LABEL[b])}: <span className="tabular-nums">{bedrag(cent(r[b]))}</span></span>
                ))}
              </span>
            </button>
            {isOpen && (
              <ul className="border-t border-gray-100">
                {r.posten.map(p => (
                  <li key={String(p.id)} className="border-t border-gray-50 first:border-t-0">
                    <button type="button" onClick={() => openFactuur(p.id)}
                      aria-label={t('rap_open_factuur').replace('{nummer}', p.nummer || '')}
                      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 min-h-tap text-sm active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                      {factuurRegel(p)}
                      <span className={`tabular-nums whitespace-nowrap ${bucketKleur(p.bucket, p.bedrag_cent)}`}>{bedrag(p.bedrag_cent)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )

  const bureau = (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-xs text-gray-500">
          <th scope="col" className="py-2 pl-4 pr-3 text-left font-medium">{t('lbl_relatie')}</th>
          {OUDERDOM_BUCKETS.map(b => <th key={b} scope="col" className="py-2 px-3 text-right font-medium whitespace-nowrap">{t(BUCKET_LABEL[b])}</th>)}
          <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium">{t('lbl_total')}</th>
        </tr>
      </thead>
      <tbody>
        {analyse.rijen.map(r => {
          const isOpen = isOpenRij(r.sleutel)
          return (
            <React.Fragment key={r.sleutel}>
              <tr className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) wissel(r.sleutel) }}>
                <td className="py-2 pl-4 pr-3 text-gray-800">
                  <button type="button" onClick={() => wissel(r.sleutel)} aria-expanded={isOpen}
                    className="inline-flex items-center gap-1.5 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    <span aria-hidden="true" className={`inline-block text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                    <span className="font-medium">{r.relatie}</span>
                    <span className="text-xs text-gray-400">({r.posten.length})</span>
                  </button>
                </td>
                {OUDERDOM_BUCKETS.map(b => (
                  <td key={b} className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${bucketKleur(b, cent(r[b]))}`}>{r[b] ? bedrag(cent(r[b])) : '—'}</td>
                ))}
                <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-semibold text-gray-900">{bedrag(cent(r.totaal))}</td>
              </tr>
              {isOpen && r.posten.map(p => (
                <tr key={`${r.sleutel}-${p.id}`} className="border-b border-gray-50 bg-gray-50/40 cursor-pointer hover:bg-gray-50"
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) openFactuur(p.id) }}>
                  <td className="py-1.5 pl-9 pr-3">
                    <button type="button" onClick={() => openFactuur(p.id)}
                      aria-label={t('rap_open_factuur').replace('{nummer}', p.nummer || '')}
                      className="text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                      {factuurRegel(p)}
                    </button>
                  </td>
                  {OUDERDOM_BUCKETS.map(b => (
                    <td key={b} className={`py-1.5 px-3 text-right tabular-nums whitespace-nowrap text-sm ${b === p.bucket ? bucketKleur(b, p.bedrag_cent) : ''}`}>
                      {b === p.bucket ? bedrag(p.bedrag_cent) : ''}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 pr-4 text-right tabular-nums whitespace-nowrap text-sm text-gray-700">{bedrag(p.bedrag_cent)}</td>
                </tr>
              ))}
            </React.Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-gray-300 bg-gray-50/70 font-semibold text-gray-900">
          <td className="py-2 pl-4 pr-3">{t('lbl_total')}</td>
          {OUDERDOM_BUCKETS.map(b => (
            <td key={b} className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${b === 'b90plus' && analyse.totalen[b] ? 'text-red-600' : ''}`}>{bedrag(cent(analyse.totalen[b]))}</td>
          ))}
          <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap">{bedrag(cent(analyse.totalen.totaal))}</td>
        </tr>
      </tfoot>
    </table>
  )

  return (
    <div className={KAART}>
      <SectionHeader title={t('rap_openstaand')} info={t('rap_balans_op').replace('{datum}', dagNotatie(peildatum))} />
      <div className="px-3 pt-3">
        <Segment<Kant> label={t('rap_openstaand')} waarde={kant} onKies={setKant} cls="w-full sm:w-auto"
          opties={[
            { v: 'verkoop', l: <span className="inline-flex flex-col items-center sm:flex-row sm:gap-1.5"><span>{t('lbl_debiteuren')}</span><span className="tabular-nums whitespace-nowrap text-gray-500 font-normal">{bedrag(cent(debiteuren.totalen.totaal))}</span></span> },
            { v: 'inkoop', l: <span className="inline-flex flex-col items-center sm:flex-row sm:gap-1.5"><span>{t('lbl_crediteuren')}</span><span className="tabular-nums whitespace-nowrap text-gray-500 font-normal">{bedrag(cent(crediteuren.totalen.totaal))}</span></span> },
          ]} />
      </div>
      {analyse.rijen.length === 0
        ? <div className="p-3"><LegeStaat titel={t('msg_geen_open_posten')} /></div>
        : smal ? telefoon : <div className="mt-2 overflow-x-auto">{bureau}</div>}
      {smal && analyse.rijen.length > 0 && (
        <div className="px-4 pb-1 flex justify-between text-sm font-semibold text-gray-900">
          <span>{t('lbl_total')}</span><span className="tabular-nums">{bedrag(cent(analyse.totalen.totaal))}</span>
        </div>
      )}
      <p className="px-4 py-3 text-xs text-gray-500">{t('rap_openstaand_uitleg')}</p>
    </div>
  )
}

export default OpenstaandePosten
