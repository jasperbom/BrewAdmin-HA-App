import React from 'react'
import { t } from '../i18n'
import { fmtD, tod } from '../utils/format'
import { logAudit } from '../utils/audit'
import { TANK_REINIGING_LABEL_KEY } from '../utils/constants'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'

type Status = 'Vuil' | 'Schoon' | 'Ontsmet'

const SOORTEN: Array<{key:'fermentatie'|'bright'|'barrel'|'overig', labelKey:string}> = [
  {key:'fermentatie', labelKey:'tank_soort_fermentatie'},
  {key:'bright',      labelKey:'tank_soort_bright'},
  {key:'barrel',      labelKey:'tank_soort_barrel'},
  {key:'overig',      labelKey:'tank_soort_overig'},
]

const statusBadgeCls: Record<string,string> = {
  Vuil:    'bg-red-100 text-red-700 border-red-200',
  Schoon:  'bg-blue-100 text-blue-700 border-blue-200',
  Ontsmet: 'bg-green-100 text-green-700 border-green-200',
}

function TanksPage(props: any) {
  const {tanks, bat, tankStatussen, setTankStatussen, tankLog, setTankLog, auditLog, setAuditLog} = props
  const {useState, useMemo} = React

  const [open, setOpen] = useState<Record<string, boolean>>({fermentatie:true, bright:true, barrel:true, overig:true})
  const [openLog, setOpenLog] = useState<Record<string, boolean>>({})
  const [modalTank, setModalTank] = useState<any|null>(null)
  const [doelStatus, setDoelStatus] = useState<Status>('Schoon')
  const [form, setForm] = useState<any>({datum:tod(), uitvoerder:'', middel:'', opmerking:'', cip:false})
  const [err, setErr] = useState<string>('')

  const statusVan = (tankId: string): Status =>
    ((tankStatussen || {})[tankId]?.status as Status) || 'Ontsmet'
  const sindsVan = (tankId: string): string =>
    (tankStatussen || {})[tankId]?.sinds || ''

  // Snelle lookup: welke batch zit nu in welke tank?
  const huidigeBatchPerTank = useMemo(() => {
    const map: Record<string, any> = {}
    for (const b of (bat || [])) {
      const hist = Array.isArray(b?.tank_historie) ? b.tank_historie : []
      const open = hist.find((h: any) => !h.to)
      const tankId = open ? open.tank : b?.tank
      if (tankId && !['Gesloten','Verpakt'].includes(b?.status)) {
        if (!map[tankId]) map[tankId] = b
      }
    }
    return map
  }, [bat])

  const middelSuggesties = useMemo(() => {
    const s = new Set<string>()
    for (const l of (tankLog || [])) {
      if (l?.middel && typeof l.middel === 'string') s.add(l.middel)
    }
    return Array.from(s).sort()
  }, [tankLog])

  const opnenModal = (tk: any, status: Status) => {
    setModalTank(tk)
    setDoelStatus(status)
    setForm({datum: tod(), uitvoerder:'', middel:'', opmerking:'', cip:false})
    setErr('')
  }

  const sluitModal = () => { setModalTank(null); setErr('') }

  const opslaan = () => {
    if (!modalTank) return
    if (!form.uitvoerder?.trim()) { setErr(t('err_uitvoerder_verplicht')); return }
    const huidige = statusVan(modalTank.id)
    // Forceer transitie-volgorde: Vuil→Schoon, Schoon→Ontsmet, *→Vuil
    if (doelStatus === 'Schoon' && huidige !== 'Vuil') { setErr(t('err_tank_status_volgorde')); return }
    if (doelStatus === 'Ontsmet' && huidige !== 'Schoon') { setErr(t('err_tank_status_volgorde')); return }

    const newId = (tankLog || []).reduce((m: number, e: any) => Math.max(m, Number(e?.id || 0)), 0) + 1
    const entry = {
      id: newId,
      tank_id: modalTank.id,
      datum: form.datum || tod(),
      uitgevoerd_door: form.uitvoerder.trim(),
      nieuwe_status: doelStatus,
      middel: form.middel?.trim() || undefined,
      opmerking: form.opmerking?.trim() || undefined,
      cip: !!form.cip,
      oorzaak: 'handmatig' as const,
    }
    setTankLog((prev: any[]) => [...(prev || []), entry])
    setTankStatussen((prev: any) => ({
      ...(prev || {}),
      [modalTank.id]: {status: doelStatus, sinds: entry.datum, laatste_log_id: newId},
    }))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Tank', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${modalTank.naam || modalTank.id} → ${doelStatus}`,
    })
    sluitModal()
  }

  const groepen = useMemo(() => {
    const out: Record<string, any[]> = {fermentatie:[], bright:[], barrel:[], overig:[]}
    for (const tk of (tanks || [])) {
      const key = (tk?.soort && out[tk.soort]) ? tk.soort : 'overig'
      out[key].push(tk)
    }
    return out
  }, [tanks])

  const renderTank = (tk: any) => {
    const status = statusVan(tk.id)
    const sinds = sindsVan(tk.id)
    const huidige = huidigeBatchPerTank[tk.id]
    const logs = (tankLog || []).filter((l: any) => l.tank_id === tk.id).sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))
    const logOpen = !!openLog[tk.id]
    const statusLabel = t(TANK_REINIGING_LABEL_KEY[status] || 'tank_status_ontsmet')

    return (
      <div key={tk.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-800">{tk.naam || tk.id}</span>
              <span className={`text-xs px-2 py-0.5 rounded border ${statusBadgeCls[status] || statusBadgeCls.Ontsmet}`}>
                {statusLabel}
              </span>
              {tk.volume != null && <span className="text-xs text-gray-500">{tk.volume} L</span>}
            </div>
            <div className="text-xs text-gray-500 mt-1 space-x-2">
              {sinds && <span>{t('tanks_status_sinds')}: {fmtD(sinds)}</span>}
              {huidige && <span>{t('tanks_in_gebruik_door')}: <span style={{color:'var(--t-accent)'}}>{huidige.naam || `#${huidige.id}`}</span></span>}
              {!huidige && status==='Ontsmet' && <span className="italic text-green-600">{t('tanks_vrij_voor_inzet')}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {status==='Vuil' && (
              <Btn s="sm" v="blue" onClick={()=>opnenModal(tk, 'Schoon')}>{t('tanks_naar_schoon')}</Btn>
            )}
            {status==='Schoon' && (
              <Btn s="sm" v="green" onClick={()=>opnenModal(tk, 'Ontsmet')}>{t('tanks_naar_ontsmet')}</Btn>
            )}
            {status!=='Vuil' && (
              <Btn s="sm" v="ghost" onClick={()=>opnenModal(tk, 'Vuil')} title={t('tanks_opnieuw_vuil_uitleg')}>{t('tanks_opnieuw_vuil')}</Btn>
            )}
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={()=>setOpenLog(prev=>({...prev, [tk.id]: !logOpen}))}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <span style={{transform: logOpen?'rotate(90deg)':'none', transition:'transform 150ms'}}>▶</span>
            {t('tanks_log_titel')} ({logs.length})
          </button>
          {logOpen && (
            <div className="mt-2 space-y-1">
              {logs.length === 0 && <p className="text-xs text-gray-400 italic">{t('tanks_log_geen_entries')}</p>}
              {logs.map((l: any) => (
                <div key={l.id} className="text-xs text-gray-700 bg-gray-50 rounded p-2 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="text-gray-500">{fmtD(l.datum)}</span>
                  <span className={`px-1.5 rounded border ${statusBadgeCls[l.nieuwe_status] || ''}`}>{t(TANK_REINIGING_LABEL_KEY[l.nieuwe_status] || '')}</span>
                  <span>{l.uitgevoerd_door}</span>
                  {l.middel && <span className="text-gray-500">{t('lbl_middel')}: {l.middel}</span>}
                  {l.cip && <span className="text-blue-700">CIP</span>}
                  {l.oorzaak==='automatisch_leeg' && <span className="italic text-gray-400">{t('lbl_oorzaak_automatisch')}</span>}
                  {l.opmerking && <span className="text-gray-500 w-full">{l.opmerking}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4"><SectionHeader solid rounded="full" title={<span className="font-bold text-lg">{t('tanks_titel')}</span>} /></div>
      <p className="text-xs text-gray-500 mb-4">{t('tanks_intro')}</p>

      {SOORTEN.map(s => {
        const items = groepen[s.key] || []
        if (!items.length) return null
        const isOpen = open[s.key] !== false
        return (
          <div key={s.key} className="mb-4 rounded-xl overflow-hidden border border-gray-200">
            <SectionHeader
              title={t(s.labelKey)}
              open={isOpen}
              onToggle={()=>setOpen(prev=>({...prev, [s.key]: !isOpen}))}
              info={`${items.length}`}
              rounded="full"
            />
            {isOpen && (
              <div className="p-3 space-y-2 bg-gray-50">
                {items.map((tk: any) => renderTank(tk))}
              </div>
            )}
          </div>
        )
      })}

      {!(tanks||[]).length && (
        <p className="text-sm text-gray-500 italic">{t('tanks_geen_tanks')}</p>
      )}

      {modalTank && (
        <Modal
          title={`${modalTank.naam || modalTank.id} → ${t(TANK_REINIGING_LABEL_KEY[doelStatus] || '')}`}
          onClose={sluitModal}
        >
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={form.datum} onChange={v=>setForm({...form, datum:v})} />
            <Inp label={t('lbl_uitvoerder')} value={form.uitvoerder} onChange={v=>setForm({...form, uitvoerder:v})} req />
            {doelStatus !== 'Vuil' && (
              <>
                <Inp label={t('lbl_middel')} value={form.middel} onChange={v=>setForm({...form, middel:v})} list="tank-middel-suggesties" />
                <datalist id="tank-middel-suggesties">
                  {middelSuggesties.map(m => <option key={m} value={m} />)}
                </datalist>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!form.cip} onChange={e=>setForm({...form, cip:e.target.checked})} className="t-checkbox" />
                  {t('lbl_methode_cip')}
                </label>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_opmerking')}</label>
              <textarea
                value={form.opmerking}
                onChange={e=>setForm({...form, opmerking:e.target.value})}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm"
              />
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={sluitModal}>{t('btn_cancel')}</Btn>
              <Btn onClick={opslaan}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default TanksPage
