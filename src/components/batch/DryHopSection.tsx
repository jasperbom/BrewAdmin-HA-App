import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { tod, fmtD } from '../../utils/format'
import Btn from '../ui/Btn'
import SectionHeader from '../ui/SectionHeader'
import type { DryHop, Batch } from '../../types'

interface Props {
  batch: Batch
  dryHops: DryHop[]
  setDryHops: any
  ingredienten?: any[]
}

const DryHopSection: React.FC<Props> = ({batch, dryHops, setDryHops, ingredienten = []}) => {
  const mine = (dryHops || []).filter(h => h.batch_id === batch.id)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))

  const [form, setForm] = React.useState<any>({
    ingredient_naam: '',
    datum: tod(),
    gram: '',
    contact_dagen: 3,
    opmerking: '',
  })

  const add = () => {
    if (!form.ingredient_naam || !form.gram) return
    const nieuw: DryHop = {
      id: newId(dryHops || []),
      batch_id: batch.id,
      ingredient_naam: form.ingredient_naam,
      datum: form.datum || tod(),
      gram: Number(form.gram),
      contact_dagen: form.contact_dagen ? Number(form.contact_dagen) : undefined,
      verwijder_datum: form.contact_dagen
        ? new Date(new Date(form.datum || tod()).getTime() + Number(form.contact_dagen) * 86400000).toISOString().slice(0, 10)
        : undefined,
      opmerking: form.opmerking || undefined,
      created_at: new Date().toISOString(),
    }
    setDryHops((prev: any[]) => [...(prev || []), nieuw])
    setForm({...form, ingredient_naam: '', gram: '', opmerking: ''})
  }

  const markVerwijderd = (id: number) => {
    setDryHops((prev: any[]) => prev.map(h => h.id === id ? {...h, verwijderd: true} : h))
  }
  const deleteRij = (id: number) => {
    setDryHops((prev: any[]) => prev.filter(h => h.id !== id))
  }

  const dagenSinds = (d: string): number => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  const dagenTot = (d: string): number => Math.floor((new Date(d).getTime() - Date.now()) / 86400000)

  const hopNamen = ingredienten.filter(i => String(i.type).toLowerCase() === 'hop').map(i => i.naam)

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      <SectionHeader
        title={t('dryhop_titel')}
        info={mine.length > 0 ? `${mine.filter(h => !h.verwijderd).length} ${t('dryhop_actief').split('—')[0].trim()}` : null}
      />

      <div className="p-4">
        {/* Invoer */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          <input list="dryhop-namen" value={form.ingredient_naam}
            onChange={e => setForm({...form, ingredient_naam: e.target.value})}
            placeholder={t('dryhop_ingredient')}
            className="col-span-2 border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <datalist id="dryhop-namen">
            {hopNamen.map(n => <option key={n} value={n} />)}
          </datalist>
          <input type="date" value={form.datum}
            onChange={e => setForm({...form, datum: e.target.value})}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" value={form.gram} step="0.1"
            onChange={e => setForm({...form, gram: e.target.value})}
            placeholder={t('dryhop_gram')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" value={form.contact_dagen}
            onChange={e => setForm({...form, contact_dagen: e.target.value})}
            placeholder={t('dryhop_contact_dagen')}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <Btn s="sm" onClick={add}>{t('dryhop_voeg_toe')}</Btn>
        </div>

        {/* Lijst */}
        {mine.length === 0 ? (
          <div className="text-sm text-gray-500 italic">{t('dryhop_geen')}</div>
        ) : (
          <div className="space-y-1.5">
            {mine.map(h => {
              const sinds = dagenSinds(h.datum)
              const tot = h.verwijder_datum ? dagenTot(h.verwijder_datum) : null
              const teVerwijderen = tot != null && tot <= 0 && !h.verwijderd
              return (
                <div key={h.id} className={`flex items-center justify-between px-3 py-2 rounded text-sm border ${
                  h.verwijderd ? 'bg-gray-50 border-gray-200 text-gray-500' :
                  teVerwijderen ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'
                }`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{h.ingredient_naam} <span className="text-gray-500 font-normal">— {h.gram}g</span></div>
                    <div className="text-xs text-gray-500">
                      {fmtD(h.datum)}
                      {!h.verwijderd && sinds >= 0 && (
                        <> · {t('dryhop_actief').replace('{n}', String(sinds))}</>
                      )}
                      {!h.verwijderd && tot != null && tot > 0 && (
                        <> · {t('dryhop_dagen_resterend').replace('{n}', String(tot))}</>
                      )}
                      {h.verwijderd && <> · {t('dryhop_verwijderd')}</>}
                    </div>
                    {h.opmerking && <div className="text-xs text-gray-500 italic">{h.opmerking}</div>}
                  </div>
                  <div className="flex gap-1">
                    {!h.verwijderd && (
                      <Btn s="sm" v="secondary" onClick={() => markVerwijderd(h.id)}>{t('dryhop_te_verwijderen')}</Btn>
                    )}
                    <Btn s="sm" v="danger" onClick={() => deleteRij(h.id)}>×</Btn>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default DryHopSection
