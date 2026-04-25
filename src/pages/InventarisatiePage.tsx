import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import { logAudit } from '../utils/audit'
import { berekenVoorcalcVoorAfvulling } from '../utils/calculations'

interface InventarisatieTelling {
  id: number
  ref_type: 'lot' | 'afvulling'
  ref_id: number
  naam?: string
  administratief: number
  geteld: number
  verschil: number
  verklaring?: string
  eenheid?: string
  voorcalc_accijns_per_eenheid?: number
  accijns_impact?: number
}

interface Inventarisatie {
  id: number
  datum: string
  type: 'ingredienten' | 'bier' | 'volledig'
  status: 'open' | 'afgerond'
  tellingen: InventarisatieTelling[]
  opmerkingen?: string
}

interface InventarisatiePageProps {
  lots: any[]
  ing: any[]
  av: any[]
  bat: any[]
  uit: any[]
  afboekingen: any[]
  bestellingPicks: any[]
  bestellingen: any[]
  inventarisaties: Inventarisatie[]
  setInventarisaties: any
  setLots: any
  log: any[]
  setLog: any
  auditLog?: any[]
  setAuditLog?: any
  accijnsInst?: any
}

const InventarisatiePage: React.FC<InventarisatiePageProps> = ({
  lots, ing, av, bat, uit, afboekingen, bestellingPicks, bestellingen,
  inventarisaties, setInventarisaties, setLots, log, setLog, accijnsInst,
  auditLog = [], setAuditLog = (() => {})
}) => {
  const [selected, setSelected] = useState<Inventarisatie | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newType, setNewType] = useState<'ingredienten' | 'bier' | 'volledig'>('ingredienten')
  const [correcties, setCorrecties] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)

  const addLog = (entry: any) => setLog((prev: any[]) => [...prev, { id: newId(prev || []), datum: tod(), ...entry }])

  // Calculate available beer stock per afvulling
  const afvullingBeschikbaar = useMemo(() => {
    const map: Record<number, number> = {}
    for (const a of av) {
      const uitgeleverd = (uit || [])
        .filter((u: any) => u.afvulling_id === a.id)
        .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
      const afgeboekt = (afboekingen || [])
        .filter((ab: any) => ab.afvulling_id === a.id)
        .reduce((s: number, ab: any) => s + Number(ab.aantal || 0), 0)
      const openOrders = (bestellingen || [])
        .filter((b: any) => b.status === 'open')
        .map((b: any) => b.id)
      const gepickt = (bestellingPicks || [])
        .filter((p: any) => p.afvulling_id === a.id && openOrders.includes(p.bestelling_id))
        .reduce((s: number, p: any) => s + Number(p.aantal || 0), 0)
      map[a.id] = Math.max(0, Number(a.hoeveelheid || 0) - gepickt - uitgeleverd - afgeboekt)
    }
    return map
  }, [av, uit, afboekingen, bestellingPicks, bestellingen])

  // Build ingredient tellingen
  const buildIngredientTellingen = (): InventarisatieTelling[] => {
    const activeLots = lots.filter((l: any) => l.beschikbaar && Number(l.hoeveelheid || 0) > 0)
    return activeLots.map((l: any, i: number) => {
      const ingredient = (ing || []).find((ig: any) => ig.id === l.ingredient_id)
      const qty = Number(l.hoeveelheid || 0)
      return {
        id: i + 1,
        ref_type: 'lot' as const,
        ref_id: l.id,
        naam: `${ingredient?.naam || '?'} — ${l.lotnr || l.lotnummer || '?'}`,
        administratief: qty,
        geteld: qty,
        verschil: 0,
        eenheid: l.eenheid || 'kg',
      }
    })
  }

  // Build beer tellingen
  const buildBierTellingen = (offset: number): InventarisatieTelling[] => {
    return av
      .filter((a: any) => (afvullingBeschikbaar[a.id] || 0) > 0)
      .map((a: any, i: number) => {
        const batch = (bat || []).find((b: any) => b.id === a.batch_id)
        const qty = afvullingBeschikbaar[a.id] || 0
        // Voorcalculatie accijns per eenheid (Douane v2.4 §7.3): bij afwijkingen tonen we
        // direct de financiële impact. Pak de bevroren waarde van de afvulling, of bereken live.
        const perEenheid = Number(a.voorcalc_accijns_per_eenheid) > 0
          ? Number(a.voorcalc_accijns_per_eenheid)
          : berekenVoorcalcVoorAfvulling(
              { inhoud_per_eenheid: Number(a.inhoud_per_eenheid||0), hoeveelheid: 1, aantal: 1 },
              batch,
              accijnsInst
            ).perEenheid
        return {
          id: offset + i + 1,
          ref_type: 'afvulling' as const,
          ref_id: a.id,
          naam: `${batch?.naam || '?'} — ${a.verpakking_naam || a.verpakking_type || '?'}`,
          administratief: qty,
          geteld: qty,
          verschil: 0,
          eenheid: 'stuks',
          voorcalc_accijns_per_eenheid: perEenheid,
          accijns_impact: 0,
        }
      })
  }

  const createInventarisatie = () => {
    let tellingen: InventarisatieTelling[] = []
    if (newType === 'ingredienten' || newType === 'volledig') {
      tellingen = buildIngredientTellingen()
    }
    if (newType === 'bier' || newType === 'volledig') {
      tellingen = [...tellingen, ...buildBierTellingen(tellingen.length)]
    }

    const inv: Inventarisatie = {
      id: newId(inventarisaties || []),
      datum: tod(),
      type: newType,
      status: 'open',
      tellingen,
    }

    setInventarisaties((prev: Inventarisatie[]) => [...(prev || []), inv])
    logAudit(auditLog, setAuditLog, {entiteit:'Inventarisatie', entiteit_id:inv.id, actie:'aangemaakt', omschrijving:`${inv.type} — ${inv.datum}`})
    setShowNew(false)
    setSelected(inv)
  }

  // Update a telling field in the selected inventarisatie
  const updateTelling = (tellingId: number, field: 'geteld' | 'verklaring', value: any) => {
    if (!selected) return
    const updated: Inventarisatie = {
      ...selected,
      tellingen: selected.tellingen.map(tel => {
        if (tel.id !== tellingId) return tel
        if (field === 'geteld') {
          const geteld = value === '' ? 0 : Number(value)
          const verschil = geteld - tel.administratief
          // Accijnsimpact (Douane v2.4 §7.3): verschil × voorcalc per eenheid.
          // Negatief = tekort = potentiële vermisaccijns; positief = overschot (administratieve correctie).
          const accijns_impact = (tel.voorcalc_accijns_per_eenheid || 0) * verschil
          return { ...tel, geteld, verschil, accijns_impact }
        }
        return { ...tel, [field]: value }
      })
    }
    setSelected(updated)
    setInventarisaties((prev: Inventarisatie[]) =>
      (prev || []).map(inv => inv.id === updated.id ? updated : inv)
    )
  }

  const updateOpmerkingen = (value: string) => {
    if (!selected) return
    const updated = { ...selected, opmerkingen: value }
    setSelected(updated)
    setInventarisaties((prev: Inventarisatie[]) =>
      (prev || []).map(inv => inv.id === updated.id ? updated : inv)
    )
  }

  const afronden = () => {
    if (!selected) return

    // Apply corrections for lots if checked
    if (correcties) {
      for (const tel of selected.tellingen) {
        if (tel.verschil !== 0 && tel.ref_type === 'lot') {
          setLots((prev: any[]) => prev.map((l: any) =>
            l.id !== tel.ref_id ? l : { ...l, hoeveelheid: tel.geteld, beschikbaar: tel.geteld > 0 }
          ))
          addLog({
            type: 'inventarisatie',
            omschrijving: `Inventarisatie correctie: ${tel.naam} ${tel.administratief} → ${tel.geteld} ${tel.eenheid || ''}`.trim(),
            hoeveelheid: tel.verschil,
            eenheid: tel.eenheid || '',
            referentie: `Inventarisatie #${selected.id}`,
          })
        }
      }
    }

    const updated: Inventarisatie = { ...selected, status: 'afgerond' }
    setSelected(updated)
    setInventarisaties((prev: Inventarisatie[]) =>
      (prev || []).map(inv => inv.id === updated.id ? updated : inv)
    )
    logAudit(auditLog, setAuditLog, {entiteit:'Inventarisatie', entiteit_id:updated.id, actie:'gewijzigd', omschrijving:`Afgerond: ${updated.type}`})
    setShowConfirm(false)
  }

  // Count differences in an inventarisatie
  const countDiffs = (inv: Inventarisatie) =>
    inv.tellingen.filter(tel => tel.verschil !== 0).length

  // Row color based on verschil
  const rowColor = (tel: InventarisatieTelling) => {
    if (tel.verschil === 0) return 'bg-green-50'
    const pct = tel.administratief !== 0
      ? Math.abs(tel.verschil / tel.administratief) * 100
      : 100
    return pct <= 10 ? 'bg-yellow-50' : 'bg-red-50'
  }

  const typeLabel = (tp: string) => {
    if (tp === 'ingredienten') return t('inv_type_ingredienten')
    if (tp === 'bier') return t('inv_type_bier')
    return t('inv_type_volledig')
  }

  // --- Detail view ---
  if (selected) {
    const isOpen = selected.status === 'open'
    return (
      <div className="space-y-4">
        {/* Back + header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Btn v="secondary" s="sm" onClick={() => setSelected(null)}>← {t('btn_cancel')}</Btn>
          <h2 className="text-xl font-bold text-gray-800">{t('inv_titel')} #{selected.id}</h2>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
            isOpen ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
          }`}>
            {isOpen ? t('inv_status_open') : t('inv_status_afgerond')}
          </span>
        </div>

        {/* Info bar */}
        <div className="bg-white rounded-xl shadow-card p-4 flex gap-6 flex-wrap text-sm text-gray-600">
          <div><span className="font-medium text-gray-500">{t('lbl_date')}:</span> {selected.datum}</div>
          <div><span className="font-medium text-gray-500">Type:</span> {typeLabel(selected.type)}</div>
          <div><span className="font-medium text-gray-500">{t('inv_verschil')}:</span> {countDiffs(selected)} items</div>
        </div>

        {/* Tellingen table */}
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <SectionHeader title={t('inv_titel')} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-semibold">Item</th>
                  <th className="text-left px-4 py-2.5 font-semibold">{t('inv_administratief')}</th>
                  <th className="text-left px-4 py-2.5 font-semibold">{t('inv_geteld')}</th>
                  <th className="text-left px-4 py-2.5 font-semibold">{t('inv_verschil')}</th>
                  <th className="text-right px-4 py-2.5 font-semibold" title={t('lbl_accijnsimpact_tip')}>{t('lbl_accijnsimpact')}</th>
                  <th className="text-left px-4 py-2.5 font-semibold">{t('inv_verklaring')}</th>
                </tr>
              </thead>
              <tbody>
                {selected.tellingen.map(tel => (
                  <tr key={tel.id} className={`${rowColor(tel)} border-t border-gray-100`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {tel.naam}
                      {tel.eenheid && <span className="text-gray-400 text-xs ml-1">({tel.eenheid})</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{tel.administratief}</td>
                    <td className="px-4 py-2.5">
                      {isOpen ? (
                        <input
                          type="number"
                          value={tel.geteld}
                          onChange={e => updateTelling(tel.id, 'geteld', e.target.value)}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white t-input outline-none shadow-sm"
                          min={0}
                          step="any"
                        />
                      ) : (
                        <span>{tel.geteld}</span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 font-medium ${
                      tel.verschil === 0 ? 'text-green-600' :
                      tel.verschil > 0 ? 'text-blue-600' : 'text-red-600'
                    }`}>
                      {tel.verschil > 0 ? '+' : ''}{tel.verschil}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {tel.ref_type === 'afvulling' && Number(tel.voorcalc_accijns_per_eenheid || 0) > 0 ? (
                        <span className={`font-medium ${
                          (tel.accijns_impact || 0) === 0 ? 'text-gray-400' :
                          (tel.accijns_impact || 0) > 0 ? 'text-blue-700' : 'text-red-700'
                        }`} title={`€ ${Number(tel.voorcalc_accijns_per_eenheid).toFixed(4)} per eenheid`}>
                          {(tel.accijns_impact || 0) === 0 ? '—' : `${(tel.accijns_impact||0) > 0 ? '+' : ''}€ ${Math.abs(tel.accijns_impact || 0).toFixed(2)}`}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">n.v.t.</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isOpen && tel.verschil !== 0 ? (
                        <input
                          type="text"
                          value={tel.verklaring || ''}
                          onChange={e => updateTelling(tel.id, 'verklaring', e.target.value)}
                          placeholder={t('inv_verklaring_verplicht')}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white t-input outline-none shadow-sm"
                        />
                      ) : (
                        <span className="text-gray-500">{tel.verklaring || (tel.verschil === 0 ? '' : '-')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Totaalbalk accijnsimpact (Douane v2.4 §7.3 stap 6) */}
          {(() => {
            const tekort = selected.tellingen.filter(t => (t.accijns_impact || 0) < 0).reduce((s, t) => s + Math.abs(t.accijns_impact || 0), 0)
            const overschot = selected.tellingen.filter(t => (t.accijns_impact || 0) > 0).reduce((s, t) => s + (t.accijns_impact || 0), 0)
            if (tekort === 0 && overschot === 0) return null
            return (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Tekort (vermis-equivalent)</div>
                  <div className="font-semibold text-red-700">€ {tekort.toFixed(2)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Accijnsplichtig in volgende aangifte</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Overschot (correctie)</div>
                  <div className="font-semibold text-blue-700">€ {overschot.toFixed(2)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Administratieve correctie</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Saldo accijnsimpact</div>
                  <div className={`font-semibold ${overschot - tekort >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    € {(overschot - tekort).toFixed(2)}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Opmerkingen */}
        <div className="bg-white rounded-xl shadow-card p-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('inv_opmerkingen')}</label>
          {isOpen ? (
            <textarea
              value={selected.opmerkingen || ''}
              onChange={e => updateOpmerkingen(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm"
            />
          ) : (
            <p className="text-sm text-gray-600">{selected.opmerkingen || '-'}</p>
          )}
        </div>

        {/* Actions for open inventarisatie */}
        {isOpen && (
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={correcties}
                onChange={e => setCorrecties(e.target.checked)}
                className="rounded"
              />
              {t('inv_correcties_doorvoeren')}
            </label>
            <Btn v="green" onClick={() => setShowConfirm(true)}>{t('inv_afronden')}</Btn>
          </div>
        )}

        {/* Confirm dialog */}
        {showConfirm && (
          <Modal title={t('inv_afronden')} onClose={() => setShowConfirm(false)}>
            <p className="text-sm text-gray-600 mb-4">{t('inv_bevestig_afronden')}</p>
            {correcties && (
              <p className="text-sm text-amber-600 mb-4">
                {t('inv_correcties_doorvoeren')}: {selected.tellingen.filter(tel => tel.verschil !== 0 && tel.ref_type === 'lot').length} items
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Btn v="secondary" onClick={() => setShowConfirm(false)}>{t('btn_cancel')}</Btn>
              <Btn v="green" onClick={afronden}>{t('inv_afronden')}</Btn>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // --- List view ---
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('inv_titel')}</h2>
        <Btn onClick={() => { setNewType('ingredienten'); setShowNew(true) }}>
          + {t('inv_nieuwe_telling')}
        </Btn>
      </div>

      {(!inventarisaties || inventarisaties.length === 0) && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400 text-sm">
          {t('inv_geen')}
        </div>
      )}

      {(inventarisaties || []).slice().sort((a, b) => b.id - a.id).map(inv => {
        const diffs = countDiffs(inv)
        return (
          <div
            key={inv.id}
            onClick={() => setSelected(inv)}
            className="bg-white rounded-xl shadow-card p-4 cursor-pointer hover:ring-2 hover:ring-blue-200 transition-all"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800">#{inv.id}</span>
                <span className="text-sm text-gray-500">{inv.datum}</span>
                <span className="text-xs font-medium" style={{color: 'var(--t-accent)'}}>{typeLabel(inv.type)}</span>
              </div>
              <div className="flex items-center gap-2">
                {diffs > 0 && (
                  <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                    {diffs} {t('inv_verschil').toLowerCase()}
                  </span>
                )}
                <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                  inv.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                }`}>
                  {inv.status === 'open' ? t('inv_status_open') : t('inv_status_afgerond')}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {inv.tellingen.length} items
            </div>
          </div>
        )
      })}

      {/* New telling modal */}
      {showNew && (
        <Modal title={t('inv_nieuwe_telling')} onClose={() => setShowNew(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Type</label>
              <div className="flex flex-col gap-2">
                {(['ingredienten', 'bier', 'volledig'] as const).map(tp => (
                  <label key={tp} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input
                      type="radio"
                      name="inv-type"
                      checked={newType === tp}
                      onChange={() => setNewType(tp)}
                      className="accent-blue-600"
                    />
                    {typeLabel(tp)}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Btn v="secondary" onClick={() => setShowNew(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={createInventarisatie}>{t('inv_nieuwe_telling')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default InventarisatiePage
