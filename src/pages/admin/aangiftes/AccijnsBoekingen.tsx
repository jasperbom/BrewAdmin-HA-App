import React from 'react'
import { t } from '../../../i18n'
import { fmtD } from '../../../utils/format'
import { toCent } from '../../../utils/centen'
import { accijnsVanRecord, accijnsMaandCent } from '../../../utils/aangifteStappen'
import type { Batch, AccijnsRecord, Uitlevering, Afvulling } from '../../../types'
import { fmtCent } from './onderdelen'

// ── De accijnsboekingen van een maand ───────────────────────────────────────
// Per batch (de samenvatting voor de aangifte: bier, batch, GN-code, Plato,
// ABV, liters, tarief per liter, accijns) of per uitslag (datum, verpakking,
// bron). Een smalle lijst in plaats van de tabel van acht kolommen: hij
// staat in het detail naast de maandlijst, en op een telefoon.

interface AccijnsBoekingenProps {
  records: AccijnsRecord[]
  bat: Batch[]
  uit: Uitlevering[]
  av: Afvulling[]
  perBatch: boolean
}

const liter = (a: any): number => Number(a?.liter ?? a?.totaal_liter ?? 0) || 0

const AccijnsBoekingen: React.FC<AccijnsBoekingenProps> = ({ records, bat, uit, av, perBatch }) => {
  const batch = (id: unknown) => (bat || []).find((b: any) => b.id === id) as any
  // Naam uit de batch; anders de naam die het record zelf meekreeg.
  const naam = (a: any) => batch(a?.batch_id)?.naam || a?.batch_naam || t('lbl_onbekend')
  // GN-code: eerst op de afvulling (via de uitlevering), anders op de batch.
  const gn = (a: any): string => {
    const u = (uit || []).find((x: any) => x.id === a.uitlevering_id) as any
    if (u?.afvulling_id) {
      const afv = (av || []).find((x: any) => x.id === u.afvulling_id) as any
      if (afv?.gn_code) return afv.gn_code
    }
    return batch(a.batch_id)?.gn_code || '—'
  }
  const plato = (id: unknown) => { const p = batch(id)?.platogehalte; return p ? `${p}°P` : '' }

  if (!records.length) return <p className="py-3 text-sm text-gray-500">{t('excise_no_records_month')}</p>

  const totLiter = records.reduce((s, a) => s + liter(a), 0)
  const totCent = accijnsMaandCent(records)

  let regels: React.ReactNode
  if (perBatch) {
    const groep = new Map<string, any>()
    for (const a of records as any[]) {
      const k = `${a.batch_id}__${a.batch_nummer || ''}`
      const g = groep.get(k) || { k, naam: naam(a), batch_id: a.batch_id, batch_nummer: a.batch_nummer, abv: a.abv, gn: gn(a), liter: 0, cent: 0, betaald: true }
      g.liter += liter(a)
      g.cent += toCent(accijnsVanRecord(a))
      if (!a.betaald) g.betaald = false
      groep.set(k, g)
    }
    const rijen = [...groep.values()].sort((x, y) => String(x.batch_nummer).localeCompare(String(y.batch_nummer), undefined, { numeric: true }))
    regels = rijen.map(g => (
      <li key={g.k} className="py-2 flex items-start gap-3">
        <span aria-hidden="true" className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${g.betaald ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 break-words">
            {g.naam}{g.batch_nummer ? <span className="text-gray-500 font-normal"> · #{g.batch_nummer}</span> : null}
          </span>
          <span className="block text-xs text-gray-500 break-words">
            {[g.gn !== '—' ? `${t('lbl_gn_code')} ${g.gn}` : '', plato(g.batch_id), g.abv ? `${g.abv}% ${t('excise_abv')}` : '', `${g.liter.toFixed(1)} L`,
              g.liter > 0 ? `${fmtCent(Math.round(g.cent / g.liter))}/L` : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-gray-900 whitespace-nowrap">{fmtCent(g.cent)}</span>
      </li>
    ))
  } else {
    const gesorteerd = [...(records as any[])].sort((a, b) =>
      String(a.batch_nummer).localeCompare(String(b.batch_nummer), undefined, { numeric: true })
      || String(a.verpakking_type || '').localeCompare(String(b.verpakking_type || ''))
      || String(a.datum || '').localeCompare(String(b.datum || '')))
    regels = gesorteerd.map(a => (
      <li key={a.id} className="py-2 flex items-start gap-3">
        <span aria-hidden="true" className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${a.betaald ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 break-words">
            {naam(a)}{a.batch_nummer ? <span className="text-gray-500 font-normal"> · #{a.batch_nummer}</span> : null}
            {a.bron === 'afboeking' && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-800 align-middle">{t('excise_bron_afboeking')}</span>}
            {a.bron === 'verplaatsing' && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 align-middle">{t('excise_bron_verplaatsing')}</span>}
          </span>
          <span className="block text-xs text-gray-500 break-words">
            {[fmtD(a.datum), a.verpakking_type || a.verpakking_naam || '', `${liter(a).toFixed(1)} L`, a.abv ? `${a.abv}% ${t('excise_abv')}` : '', gn(a) !== '—' ? gn(a) : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-gray-900 whitespace-nowrap">{fmtCent(toCent(accijnsVanRecord(a)))}</span>
      </li>
    ))
  }

  return (
    <div>
      <ul className="divide-y divide-gray-100">{regels}</ul>
      <div className="flex items-baseline gap-3 border-t border-gray-200 pt-2 text-sm">
        <span className="flex-1 font-semibold text-gray-900">{t('excise_month_total')}</span>
        <span className="text-xs text-gray-500 tabular-nums">{totLiter.toFixed(1)} L</span>
        <span className="font-semibold tabular-nums text-gray-900">{fmtCent(totCent)}</span>
      </div>
    </div>
  )
}

export default AccijnsBoekingen
