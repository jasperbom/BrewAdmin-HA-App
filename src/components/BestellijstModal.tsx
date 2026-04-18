import React, { useState } from 'react'
import { t } from '../i18n'
import Modal from './ui/Modal'
import Btn from './ui/Btn'
import type { VoorraadVergelijking, ReceptCategorie } from '../utils/calculations'

interface BestellijstModalProps {
  shortages: VoorraadVergelijking[]
  lots?: any[]
  onClose: () => void
}

const CATEGORIE_LABEL_KEY: Record<ReceptCategorie, string> = {
  mout: 'ing_type_mout',
  hop: 'ing_type_hop',
  gist: 'ing_type_gist',
  overig: 'ing_type_overig',
}

// Zoekt de leverancier van het meest recente lot per ingredient. Best-effort
// hint voor de bestellijst; ontbreekt als we geen ingredient_id of geen lots
// hebben.
const laatsteLeverancier = (ingredient_id: number | undefined, lots: any[] = []): string => {
  if (!ingredient_id) return ''
  const rel = (lots || [])
    .filter((l: any) => l.ingredient_id === ingredient_id && l.leverancier)
    .sort((a: any, b: any) => String(b.aankoopdatum || b.created_at || '').localeCompare(String(a.aankoopdatum || a.created_at || '')))
  return rel[0]?.leverancier || ''
}

const BestellijstModal: React.FC<BestellijstModalProps> = ({ shortages, lots = [], onClose }) => {
  const tekorten = (shortages || []).filter(s => s.tekort > 0)
  const [besteld, setBesteld] = useState<Record<string, boolean>>({})

  const rowKey = (s: VoorraadVergelijking) =>
    `${s.categorie}::${s.naam.toLowerCase()}::${s.eenheid.toLowerCase()}`

  const perCategorie = tekorten.reduce((acc: Record<ReceptCategorie, VoorraadVergelijking[]>, s) => {
    (acc[s.categorie] = acc[s.categorie] || []).push(s)
    return acc
  }, { mout: [], hop: [], gist: [], overig: [] } as Record<ReceptCategorie, VoorraadVergelijking[]>)

  const categorieen: ReceptCategorie[] = ['mout', 'hop', 'gist', 'overig']

  return (
    <Modal title={t('plan_bestellijst_titel')} onClose={onClose} wide>
      {tekorten.length === 0 ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          {t('plan_geen_tekorten')}
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-500 mb-3">{t('plan_besteld_afvinken')}</div>
          <div className="space-y-4">
            {categorieen.map(cat => {
              const rijen = perCategorie[cat] || []
              if (rijen.length === 0) return null
              return (
                <div key={cat}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {t(CATEGORIE_LABEL_KEY[cat])}
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr className="text-gray-500 text-xs uppercase tracking-wide">
                          <th className="text-left px-3 py-2 font-medium w-8"></th>
                          <th className="text-left px-3 py-2 font-medium">{t('lbl_name')}</th>
                          <th className="text-right px-3 py-2 font-medium">{t('plan_tekort')}</th>
                          <th className="text-left px-3 py-2 font-medium">{t('lbl_supplier')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rijen.map(r => {
                          const key = rowKey(r)
                          const checked = !!besteld[key]
                          const lev = laatsteLeverancier(r.ingredient_id, lots)
                          return (
                            <tr key={key} className="border-t border-gray-100">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="t-checkbox"
                                  checked={checked}
                                  onChange={e => setBesteld(b => ({ ...b, [key]: e.target.checked }))}
                                />
                              </td>
                              <td className={`px-3 py-2 ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                {r.naam}
                              </td>
                              <td className={`px-3 py-2 text-right font-medium ${checked ? 'line-through text-gray-400' : 'text-red-700'}`}>
                                {Number(r.tekort).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} {r.eenheid}
                              </td>
                              <td className="px-3 py-2 text-gray-500 text-xs">{lev || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="flex justify-end mt-5">
        <Btn v="secondary" onClick={onClose}>{t('plan_sluiten')}</Btn>
      </div>
    </Modal>
  )
}

export default BestellijstModal
