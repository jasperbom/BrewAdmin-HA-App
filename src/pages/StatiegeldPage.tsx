import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { newId, volgendFactuurNummer } from '../utils/api'
import { fmt, fmtD, fmtQty, tod } from '../utils/format'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import { logAudit } from '../utils/audit'
import { verkoopFactuurBoeking, voegBoekingToe } from '../utils/journaal'
import { totaliseerRegels } from '../utils/centen'
import { getPeriodes } from '../utils/btw'

interface Props {
  verpakkingen: any[]
  setVerpakkingen: (v: any) => void
  verkoopFacturen: any[]
  setVerkoopFacturen: (v: any) => void
  factuurCounter?: any
  setFactuurCounter?: any
  bankKoppelingen?: any
  auditLog?: any[]
  setAuditLog?: any
  setJournaal?: any
}

type Tab = 'config' | 'snd' | 'fust' | 'mutaties'

const rnd2 = (n: number) => Math.round(n * 100) / 100

const klantSleutel = (f: any): string => {
  if (f?.klant_id != null && f.klant_id !== '') return `id:${f.klant_id}`
  return `naam:${(f?.klant_naam || '').trim().toLowerCase()}`
}

const klantLabel = (f: any) => f?.klant_naam || t('lbl_onbekend')

const StatiegeldPage: React.FC<Props> = ({
  verpakkingen, setVerpakkingen, verkoopFacturen, setVerkoopFacturen,
  factuurCounter, setFactuurCounter = () => {}, bankKoppelingen = {},
  auditLog = [], setAuditLog = (() => {}), setJournaal = () => {}
}) => {
  const [tab, setTab] = useState<Tab>('config')
  const [aangifteYear, setAangifteYear] = useState(new Date().getFullYear())
  const [aangiftePeriode, setAangiftePeriode] = useState<'kwartaal' | 'maand'>('kwartaal')
  const [retourFor, setRetourFor] = useState<any | null>(null)
  const [retourQty, setRetourQty] = useState<Record<number, string>>({})

  // Alle factuurregels met statiegeld_soort, vlak gemaakt
  const stRegels = useMemo(() => {
    const out: any[] = []
    ;(verkoopFacturen || []).forEach((f: any) => {
      ;(f.regels || []).forEach((r: any, idx: number) => {
        if (r.statiegeld_soort === 'snd' || r.statiegeld_soort === 'fust') {
          out.push({
            ...r,
            factuur_id: f.id,
            factuurnummer: f.factuurnummer,
            datum: f.datum,
            klant_naam: f.klant_naam,
            klant_id: f.klant_id,
            status: f.status,
            regel_idx: idx,
          })
        }
      })
    })
    return out
  }, [verkoopFacturen])

  // Set van SNd-perioden die al afgedragen zijn (gekoppeld aan banktransactie)
  const sndAfgedragen = useMemo(() => {
    const s = new Set<string>()
    Object.values(bankKoppelingen as any).forEach((k: any) => {
      if (k?.soort === 'snd' && k.periodeKey) s.add(k.periodeKey)
    })
    return s
  }, [bankKoppelingen])

  // Te remitteren SNd per periode
  const sndPerPeriode = useMemo(() => {
    const periodes = getPeriodes(aangifteYear, aangiftePeriode)
    return periodes.map(p => {
      const regels = stRegels.filter(r => r.statiegeld_soort === 'snd' && r.datum && r.datum >= p.from && r.datum <= p.to)
      const stuks = regels.reduce((s, r) => s + Number(r.hoeveelheid || 0), 0)
      const bedrag = rnd2(regels.reduce((s, r) => s + Number(r.netto || 0), 0))
      const today = tod()
      let status: 'toekomstig' | 'lopend' | 'openstaand' | 'afgedragen' = 'openstaand'
      if (p.from > today) status = 'toekomstig'
      else if (p.from <= today && today <= p.to) status = 'lopend'
      else if (sndAfgedragen.has(p.key)) status = 'afgedragen'
      return { ...p, stuks, bedrag, status }
    })
  }, [stRegels, aangifteYear, aangiftePeriode, sndAfgedragen])

  // Fust-saldo per klant (alleen 'fust')
  const fustPerKlant = useMemo(() => {
    const map: Record<string, { key: string; label: string; klant_id: number | null; perVerpakking: Record<number, { naam: string; aantal: number; bedrag: number; verpakking_id: number }>; totaalAantal: number; totaalBedrag: number }> = {}
    stRegels.forEach(r => {
      if (r.statiegeld_soort !== 'fust') return
      const key = klantSleutel(r)
      if (!map[key]) {
        map[key] = { key, label: klantLabel(r), klant_id: r.klant_id ?? null, perVerpakking: {}, totaalAantal: 0, totaalBedrag: 0 }
      }
      const vpId = Number(r.verpakking_id || 0)
      const vp = (verpakkingen || []).find((v: any) => v.id === vpId)
      const naam = vp?.naam || r.omschrijving || t('lbl_onbekend')
      if (!map[key].perVerpakking[vpId]) map[key].perVerpakking[vpId] = { naam, aantal: 0, bedrag: 0, verpakking_id: vpId }
      map[key].perVerpakking[vpId].aantal += Number(r.hoeveelheid || 0)
      map[key].perVerpakking[vpId].bedrag += Number(r.netto || 0)
      map[key].totaalAantal += Number(r.hoeveelheid || 0)
      map[key].totaalBedrag += Number(r.netto || 0)
    })
    return Object.values(map)
      .map(k => ({ ...k, totaalBedrag: rnd2(k.totaalBedrag) }))
      .filter(k => Math.abs(k.totaalAantal) > 0.0001 || Math.abs(k.totaalBedrag) > 0.0001)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [stRegels, verpakkingen])

  // ---------- Verpakking inline edit ----------
  const updateVerpakking = (id: number, patch: any) => {
    setVerpakkingen((prev: any[]) => (prev || []).map((v: any) => v.id === id ? { ...v, ...patch } : v))
    const naam = verpakkingen.find((v: any) => v.id === id)?.naam || ''
    logAudit(auditLog, setAuditLog, {entiteit:'Verpakking', entiteit_id:id, actie:'gewijzigd', omschrijving:`Statiegeld: ${naam}`})
  }

  // ---------- Retour / creditnota ----------
  const openRetour = (klant: any) => {
    const init: Record<number, string> = {}
    Object.values(klant.perVerpakking).forEach((p: any) => { init[p.verpakking_id] = '' })
    setRetourQty(init)
    setRetourFor(klant)
  }

  const saveRetour = async () => {
    if (!retourFor) return
    const items = Object.entries(retourQty)
      .map(([vpId, qStr]) => ({ vpId: Number(vpId), aantal: Number(qStr || 0) }))
      .filter(it => it.aantal > 0)
    if (items.length === 0) { alert(t('statiegeld_err_geen_aantal')); return }

    // Originele factuurdata zoeken voor klantgegevens
    const refFact = (verkoopFacturen || []).find((f: any) =>
      klantSleutel(f) === retourFor.key && (f.regels || []).some((r: any) => r.statiegeld_soort === 'fust')
    )

    const regels: any[] = []
    items.forEach(({ vpId, aantal }) => {
      const vp = (verpakkingen || []).find((v: any) => v.id === vpId)
      if (!vp) return
      const bedrag = Number(vp.statiegeld_bedrag || 0)
      const netto = rnd2(-aantal * bedrag)
      regels.push({
        omschrijving: `${t('statiegeld_retour')} ${vp.naam}`,
        hoeveelheid: -aantal,
        prijs_per_stuk: bedrag,
        btw_pct: 0,
        netto,
        btw_bedrag: 0,
        bruto: netto,
        statiegeld_soort: 'fust',
        verpakking_id: vp.id,
      })
    })
    if (regels.length === 0) return

    // Totaal cent-exact (ERP-plan 2.2); statiegeldregels zijn altijd 0% BTW.
    const totalen = totaliseerRegels(regels)
    const totaalNetto = totalen.netto
    // Creditnotanummer server-side ophalen (atomair, eigen CN-reeks —
    // ERP-plan 0.2); de client nummert nooit zelf.
    let nummer: string
    try { nummer = await volgendFactuurNummer('creditnota') }
    catch (e) { alert(t('err_factuurnummer_ophalen')); return }

    const nieuw: any = {
      id: newId(verkoopFacturen || []),
      datum: tod(),
      factuurnummer: nummer,
      klant_id: retourFor.klant_id ?? refFact?.klant_id ?? null,
      klant_naam: retourFor.label,
      klant_adres: refFact?.klant_adres || '',
      klant_straat: refFact?.klant_straat || '',
      klant_postcode: refFact?.klant_postcode || '',
      klant_stad: refFact?.klant_stad || '',
      klant_btw_nummer: refFact?.klant_btw_nummer || '',
      regels,
      btw_overzicht: [{ tarief: 0, netto: totaalNetto, btw: 0 }],
      netto: totaalNetto,
      btw: 0,
      bruto: totaalNetto,
      netto_cent: totalen.netto_cent,
      btw_cent: 0,
      bruto_cent: totalen.netto_cent,
      status: 'credit',
      definitief: true,
      credit_van_factuur_id: refFact?.id || null,
    }

    setVerkoopFacturen((prev: any[]) => [...(prev || []), nieuw])
    // Journaal (ERP-plan 2.1): creditnota is direct definitief → boeken
    // (bedragen zijn al negatief).
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(nieuw)))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Creditnota statiegeld`})
    setRetourFor(null)
    setRetourQty({})
  }

  const tabBtn = (key: Tab, label: string) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <h2 className="text-xl font-bold text-gray-800 mr-4">{t('nav_statiegeld')}</h2>
          {tabBtn('config', t('statiegeld_tab_config'))}
          {tabBtn('snd', t('statiegeld_tab_snd'))}
          {tabBtn('fust', t('statiegeld_tab_fust'))}
          {tabBtn('mutaties', t('statiegeld_tab_mutaties'))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card">
        {/* TAB: Configuratie */}
        {tab === 'config' && (
          <div className="p-4">
            <p className="text-sm text-gray-600 mb-3">{t('statiegeld_config_help')}</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_name')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_type')}</th>
                    <th className="px-3 py-2 text-right">{t('packaging_content')}</th>
                    <th className="px-3 py-2 text-left">{t('statiegeld_soort')}</th>
                    <th className="px-3 py-2 text-right">{t('statiegeld_bedrag')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(verpakkingen || []).length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">{t('msg_no_packaging')}</td></tr>
                  )}
                  {(verpakkingen || []).map((v: any) => (
                    <tr key={v.id} className="border-t">
                      <td className="px-3 py-2 font-medium text-gray-800">{v.naam}</td>
                      <td className="px-3 py-2 text-gray-500">{v.type || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{Number(v.inhoud_liter || 0)}L</td>
                      <td className="px-3 py-2">
                        <select
                          className="t-input rounded border border-gray-300 px-2 py-1 text-sm"
                          value={v.statiegeld_soort || ''}
                          onChange={(e) => updateVerpakking(v.id, { statiegeld_soort: e.target.value || null })}
                        >
                          <option value="">{t('statiegeld_geen')}</option>
                          <option value="snd">{t('statiegeld_snd')}</option>
                          <option value="fust">{t('statiegeld_fust')}</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="t-input rounded border border-gray-300 px-2 py-1 text-sm w-24 text-right"
                          value={v.statiegeld_bedrag != null ? String(v.statiegeld_bedrag) : ''}
                          onChange={(e) => updateVerpakking(v.id, { statiegeld_bedrag: Number(e.target.value || 0) })}
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: Te remitteren SNd */}
        {tab === 'snd' && (
          <div className="p-4">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Sel
                label={t('lbl_jaar')}
                value={String(aangifteYear)}
                onChange={(v: string) => setAangifteYear(Number(v))}
                opts={Array.from({ length: 6 }, (_, i) => {
                  const y = new Date().getFullYear() - 2 + i
                  return { v: String(y), l: String(y) }
                })}
              />
              <Sel
                label={t('lbl_periode')}
                value={aangiftePeriode}
                onChange={(v: string) => setAangiftePeriode(v as any)}
                opts={[
                  { v: 'kwartaal', l: t('lbl_kwartaal') },
                  { v: 'maand', l: t('lbl_maand') },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_periode')}</th>
                    <th className="px-3 py-2 text-right">{t('statiegeld_stuks')}</th>
                    <th className="px-3 py-2 text-right">{t('statiegeld_te_remitteren')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sndPerPeriode.map(p => {
                    const cls =
                      p.status === 'afgedragen' ? 'bg-green-100 text-green-700'
                      : p.status === 'lopend' ? 'bg-blue-100 text-blue-700'
                      : p.status === 'toekomstig' ? 'bg-gray-100 text-gray-500'
                      : 'bg-orange-100 text-orange-700'
                    return (
                      <tr key={p.key} className="border-t">
                        <td className="px-3 py-2 font-medium text-gray-800">{p.label}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{p.stuks}</td>
                        <td className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--t-accent)' }}>€ {fmt(p.bedrag)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                            {t(`statiegeld_status_${p.status}`)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-gray-50 font-semibold">
                    <td className="px-3 py-2">{t('lbl_total')}</td>
                    <td className="px-3 py-2 text-right">{sndPerPeriode.reduce((s, p) => s + p.stuks, 0)}</td>
                    <td className="px-3 py-2 text-right">€ {fmt(rnd2(sndPerPeriode.reduce((s, p) => s + p.bedrag, 0)))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3">{t('statiegeld_snd_help')}</p>
          </div>
        )}

        {/* TAB: Fust per klant */}
        {tab === 'fust' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('orders_klant')}</th>
                    <th className="px-3 py-2 text-left">{t('statiegeld_uit')}</th>
                    <th className="px-3 py-2 text-right">{t('statiegeld_stuks')}</th>
                    <th className="px-3 py-2 text-right">{t('statiegeld_waarde_uit')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {fustPerKlant.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">{t('statiegeld_geen_fust_uit')}</td></tr>
                  )}
                  {fustPerKlant.map(k => (
                    <tr key={k.key} className="border-t">
                      <td className="px-3 py-2 font-medium text-gray-800">{k.label}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs">
                        {Object.values(k.perVerpakking).map((p: any) => (
                          <div key={p.verpakking_id}>{p.aantal}× {p.naam}</div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{k.totaalAantal}</td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--t-accent)' }}>€ {fmt(k.totaalBedrag)}</td>
                      <td className="px-3 py-2 text-right">
                        <Btn s="sm" onClick={() => openRetour(k)}>{t('statiegeld_retour_btn')}</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB: Mutaties */}
        {tab === 'mutaties' && (
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_invoice')}</th>
                    <th className="px-3 py-2 text-left">{t('orders_klant')}</th>
                    <th className="px-3 py-2 text-left">{t('statiegeld_soort')}</th>
                    <th className="px-3 py-2 text-left">{t('lbl_omschrijving')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_quantity')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_bedrag')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stRegels.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">{t('statiegeld_geen_mutaties')}</td></tr>
                  )}
                  {[...stRegels].sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || ''))).map((r, i) => (
                    <tr key={`${r.factuur_id}-${r.regel_idx}-${i}`} className="border-t">
                      <td className="px-3 py-2 text-gray-600">{fmtD(r.datum)}</td>
                      <td className="px-3 py-2 text-gray-700">{r.factuurnummer || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.klant_naam || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.statiegeld_soort === 'snd' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                          {t(r.statiegeld_soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{r.omschrijving}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmtQty(r.hoeveelheid)}</td>
                      <td className="px-3 py-2 text-right font-semibold" style={{ color: r.netto < 0 ? 'rgb(220 38 38)' : 'var(--t-accent)' }}>€ {fmt(r.netto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Retour modal */}
      {retourFor && (
        <Modal title={`${t('statiegeld_retour_btn')} – ${retourFor.label}`} onClose={() => setRetourFor(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('statiegeld_retour_help')}</p>
            {Object.values(retourFor.perVerpakking).map((p: any) => (
              <div key={p.verpakking_id} className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{p.naam}</div>
                  <div className="text-xs text-gray-500">{t('statiegeld_uit')}: {p.aantal}</div>
                </div>
                <div className="w-28">
                  <Inp
                    label={t('statiegeld_retour_aantal')}
                    type="number"
                    value={retourQty[p.verpakking_id] || ''}
                    onChange={(v: string) => setRetourQty(prev => ({ ...prev, [p.verpakking_id]: v }))}
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => setRetourFor(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveRetour}>{t('statiegeld_creditnota_aanmaken')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default StatiegeldPage
