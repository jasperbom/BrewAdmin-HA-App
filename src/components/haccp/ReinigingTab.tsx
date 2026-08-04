import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { SCHOONMAAK_FREQUENTIES, TANK_REINIGING_LABEL_KEY } from '../../utils/constants'
import { isSchoonmaakTaakAchterstallig } from '../../utils/taken'
import Btn from '../ui/Btn'
import Modal from '../ui/Modal'
import Inp from '../ui/Inp'
import SectionHeader from '../ui/SectionHeader'
import SearchInput from '../ui/SearchInput'

// Reiniging & desinfectie (HACCP-handboek hoofdstuk 6): het schoonmaakschema,
// het uitvoeringslogboek en de tankreinigingshistorie stonden als twee losse
// tabbladen naast elkaar terwijl ze één vraag beantwoorden — is er schoon
// gemaakt en is dat vastgelegd. Ze zitten hier in één tabblad met drie
// sublijsten. Tankreiniging blijft read-only: schrijven gebeurt in de
// batchflow (auto-trigger bij een lege tank) en bij de tanks zelf.
type Sub = 'taken' | 'log' | 'tanks'

interface ReinigingTabProps {
  schoonmaakTaken: any[]
  setSchoonmaakTaken: any
  schoonmaakLog: any[]
  setSchoonmaakLog: any
  tanks: any[]
  tankLog: any[]
  auditLog: any[]
  setAuditLog: any
  modal: string | null
  setModal: (v: string | null) => void
  edit: any
  setEdit: (v: any) => void
}

function ReinigingTab({schoonmaakTaken, setSchoonmaakTaken, schoonmaakLog, setSchoonmaakLog,
                       tanks, tankLog, auditLog, setAuditLog, modal, setModal, edit, setEdit}: ReinigingTabProps) {
  const {useState} = React
  const [sub, setSub] = useState<Sub>('taken')

  const subs: {id: Sub, l: string}[] = [
    {id: 'taken', l: t('haccp_schoonmaak_taken')},
    {id: 'log', l: t('haccp_schoonmaak_log')},
    {id: 'tanks', l: t('haccp_tab_tankreiniging')},
  ]

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {subs.map(s => (
          <button key={s.id} onClick={() => setSub(s.id)}
            className={`px-3 py-1 rounded text-xs font-medium ${sub === s.id ? 'tbtn text-white' : 'bg-gray-100 text-gray-600'}`}>
            {s.l}
          </button>
        ))}
      </div>

      {sub !== 'tanks' && (
        <SchoonmaakLijst sub={sub} schoonmaakTaken={schoonmaakTaken} setSchoonmaakTaken={setSchoonmaakTaken}
          schoonmaakLog={schoonmaakLog} setSchoonmaakLog={setSchoonmaakLog} tanks={tanks}
          auditLog={auditLog} setAuditLog={setAuditLog}
          modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />
      )}
      {sub === 'tanks' && <TankReinigingLijst tanks={tanks} tankLog={tankLog} />}
    </div>
  )
}

function SchoonmaakLijst({sub, schoonmaakTaken, setSchoonmaakTaken, schoonmaakLog, setSchoonmaakLog,
                          tanks, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState} = React
  const [fDatum, setFDatum] = useState('')

  const laatsteLog = (taakId: number) => (schoonmaakLog || [])
    .filter((l: any) => l.taak_id === taakId)
    .slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))[0]

  const saveTaak = () => {
    if(!edit?.naam) return
    if(edit.id) {
      setSchoonmaakTaken((prev: any[]) => prev.map((x: any) => x.id === edit.id ? {...x, ...edit} : x))
      logAudit(auditLog, setAuditLog, {entiteit: 'SchoonmaakTaak', entiteit_id: edit.id, actie: 'gewijzigd', omschrijving: edit.naam})
    } else {
      const id = newId(schoonmaakTaken)
      setSchoonmaakTaken((prev: any[]) => [...prev, {...edit, id, actief: true}])
      logAudit(auditLog, setAuditLog, {entiteit: 'SchoonmaakTaak', entiteit_id: id, actie: 'aangemaakt', omschrijving: edit.naam})
    }
    setModal(null); setEdit(null)
  }

  const saveLog = () => {
    if(!edit?.taak_id || !edit?.uitgevoerd_door) return
    const id = newId(schoonmaakLog)
    setSchoonmaakLog((prev: any[]) => [...prev, {...edit, id}])
    logAudit(auditLog, setAuditLog, {entiteit: 'SchoonmaakLog', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `Schoonmaak: ${(schoonmaakTaken || []).find((x: any) => x.id === edit.taak_id)?.naam || ''}`})
    setModal(null); setEdit(null)
  }

  const delTaak = (tk: any) => {
    if(!confirm(t('haccp_schoonmaak_taak_verwijderen').replace('{naam}', tk.naam || ''))) return
    setSchoonmaakTaken((prev: any[]) => prev.filter((x: any) => x.id !== tk.id))
    logAudit(auditLog, setAuditLog, {entiteit: 'SchoonmaakTaak', entiteit_id: tk.id, actie: 'verwijderd', omschrijving: tk.naam})
  }

  const filteredLog = (schoonmaakLog || [])
    .filter((l: any) => !fDatum || l.datum === fDatum)
    .slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))

  return (
    <div>
      {sub === 'taken' && <>
        <div className="flex justify-end mb-2">
          <Btn s="sm" onClick={() => {setEdit({naam: '', frequentie: 'wekelijks', locatie: '', verantwoordelijke: ''}); setModal('taak')}}>{t('haccp_schoonmaak_taak_nieuw')}</Btn>
        </div>
        {!(schoonmaakTaken || []).length && <p className="text-sm text-gray-500 italic">{t('haccp_schoonmaak_geen_taken')}</p>}
        <div className="space-y-2">
          {(schoonmaakTaken || []).map((tk: any) => {
            const last = laatsteLog(tk.id)
            const acht = isSchoonmaakTaakAchterstallig(tk, schoonmaakLog)
            return (
              <div key={tk.id} className={`bg-white rounded-lg border-l-4 p-3 shadow-sm ${acht ? 'border-red-500' : 'border-green-500'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium text-sm text-gray-800">{tk.naam}</span>
                    {tk.locatie && <span className="text-xs text-gray-500 ml-2">{tk.locatie}</span>}
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t(SCHOONMAAK_FREQUENTIES.find(f => f.key === tk.frequentie)?.label || '')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{t('haccp_schoonmaak_laatste')}: {last ? fmtD(last.datum) : t('haccp_schoonmaak_nooit')}</span>
                    <Btn s="sm" v="ghost" onClick={() => {setEdit({...tk}); setModal('taak')}}>{t('btn_edit')}</Btn>
                    <Btn s="sm" v="danger" onClick={() => delTaak(tk)}>{t('btn_delete')}</Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>}

      {sub === 'log' && <>
        <div className="flex items-center gap-2 mb-2">
          <Btn s="sm" onClick={() => {setEdit({taak_id: (schoonmaakTaken || [])[0]?.id || 0, datum: tod(), uitgevoerd_door: '', middel: '', opmerking: '', cip: false}); setModal('log')}}>{t('haccp_schoonmaak_log_nieuw')}</Btn>
          <input type="date" value={fDatum} onChange={e => setFDatum(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" />
        </div>
        {!filteredLog.length && <p className="text-sm text-gray-500 italic">{t('haccp_schoonmaak_geen_log')}</p>}
        <div className="space-y-1">
          {filteredLog.map((l: any) => (
            <div key={l.id} className="bg-white rounded-lg p-2.5 shadow-sm text-sm flex items-center justify-between">
              <div>
                <span className="font-medium">{(schoonmaakTaken || []).find((x: any) => x.id === l.taak_id)?.naam || '?'}</span>
                <span className="text-gray-500 ml-2">{fmtD(l.datum)}</span>
                <span className="text-gray-500 ml-2">{l.uitgevoerd_door}</span>
                {l.cip && <span className="ml-1 text-xs px-1 py-0.5 rounded bg-blue-100 text-blue-700">CIP</span>}
                {l.middel && <span className="text-gray-400 ml-2 text-xs">{l.middel}</span>}
              </div>
            </div>
          ))}
        </div>
      </>}

      {modal === 'taak' && edit && (
        <Modal title={edit.id ? t('btn_edit') : t('haccp_schoonmaak_taak_nieuw')} onClose={() => {setModal(null); setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_schoonmaak_naam')} value={edit.naam || ''} onChange={v => setEdit({...edit, naam: v})} req />
            <Inp label={t('haccp_schoonmaak_omschrijving')} value={edit.omschrijving || ''} onChange={v => setEdit({...edit, omschrijving: v})} />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_frequentie')}</label>
              <select value={edit.frequentie || 'wekelijks'} onChange={e => setEdit({...edit, frequentie: e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {SCHOONMAAK_FREQUENTIES.map(f => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
              </select>
            </div>
            <Inp label={t('haccp_schoonmaak_locatie')} value={edit.locatie || ''} onChange={v => setEdit({...edit, locatie: v})} />
            <Inp label={t('haccp_schoonmaak_verantwoordelijke')} value={edit.verantwoordelijke || ''} onChange={v => setEdit({...edit, verantwoordelijke: v})} />
            {(tanks || []).length > 0 && <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_tank')}</label>
              <select value={edit.tank_id || ''} onChange={e => setEdit({...edit, tank_id: e.target.value || undefined})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="">-</option>
                {(tanks || []).map((tk: any) => <option key={tk.id} value={tk.id}>{tk.naam || tk.id}</option>)}
              </select>
            </div>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => {setModal(null); setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveTaak}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'log' && edit && (
        <Modal title={t('haccp_schoonmaak_log_nieuw')} onClose={() => {setModal(null); setEdit(null)}}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_schoonmaak_taak')}</label>
              <select value={edit.taak_id || ''} onChange={e => setEdit({...edit, taak_id: Number(e.target.value)})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                {(schoonmaakTaken || []).map((tk: any) => <option key={tk.id} value={tk.id}>{tk.naam}</option>)}
              </select>
            </div>
            <Inp label={t('haccp_schoonmaak_datum')} type="date" value={edit.datum || tod()} onChange={v => setEdit({...edit, datum: v})} />
            <Inp label={t('haccp_schoonmaak_door')} value={edit.uitgevoerd_door || ''} onChange={v => setEdit({...edit, uitgevoerd_door: v})} req />
            <Inp label={t('haccp_schoonmaak_middel')} value={edit.middel || ''} onChange={v => setEdit({...edit, middel: v})} />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!edit.cip} onChange={e => setEdit({...edit, cip: e.target.checked})} className="t-checkbox" />
              {t('haccp_schoonmaak_cip')}
            </label>
            <Inp label={t('haccp_schoonmaak_opmerking')} value={edit.opmerking || ''} onChange={v => setEdit({...edit, opmerking: v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => {setModal(null); setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveLog}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// HACCP-audittrail van tankreinigings­acties. Pure read-only weergave —
// statuswijzigingen en log-entries worden geschreven via de batchflow en de
// tankinstellingen. Hier alleen filteren en raadplegen.
function TankReinigingLijst({tanks, tankLog}: any) {
  const {useState} = React
  const [fTank, setFTank] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fVan, setFVan] = useState('')
  const [fTot, setFTot] = useState('')
  const [zoek, setZoek] = useState('')

  const badgeCls: Record<string, string> = {
    Vuil: 'bg-red-100 text-red-700',
    Schoon: 'bg-blue-100 text-blue-700',
    Ontsmet: 'bg-green-100 text-green-700',
  }
  const tankNaam = (id: string) => (tanks || []).find((tk: any) => tk.id === id)?.naam || id

  const rijen = (tankLog || [])
    .filter((l: any) => !fTank || l.tank_id === fTank)
    .filter((l: any) => !fStatus || l.nieuwe_status === fStatus)
    .filter((l: any) => !fVan || (l.datum || '') >= fVan)
    .filter((l: any) => !fTot || (l.datum || '') <= fTot)
    .filter((l: any) => {
      if (!zoek) return true
      const q = zoek.toLowerCase()
      return [l.uitgevoerd_door, l.middel, l.opmerking].some((v: any) => (v || '').toLowerCase().includes(q))
    })
    .slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))

  return (
    <div>
      <div className="mb-3"><SectionHeader title={t('haccp_tank_log_titel')} rounded="full" /></div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select value={fTank} onChange={e => setFTank(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_filter_tank')}</option>
          {(tanks || []).map((tk: any) => <option key={tk.id} value={tk.id}>{tk.naam || tk.id}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_filter_status')}</option>
          <option value="Vuil">{t('tank_status_vuil')}</option>
          <option value="Schoon">{t('tank_status_schoon')}</option>
          <option value="Ontsmet">{t('tank_status_ontsmet')}</option>
        </select>
        <input type="date" value={fVan} onChange={e => setFVan(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_van')} />
        <input type="date" value={fTot} onChange={e => setFTot(e.target.value)} className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_tot')} />
        <SearchInput value={zoek} onChange={setZoek} placeholder={t('haccp_filter_zoek_placeholder')} cls="flex-1 min-w-[160px]" />
      </div>

      {!rijen.length && <p className="text-sm text-gray-500 italic">{t('tanks_log_geen_entries')}</p>}

      {!!rijen.length && (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">{t('lbl_datum')}</th>
                <th className="text-left px-3 py-2">{t('nav_tanks')}</th>
                <th className="text-left px-3 py-2">{t('lbl_status')}</th>
                <th className="text-left px-3 py-2">{t('lbl_uitvoerder')}</th>
                <th className="text-left px-3 py-2">{t('lbl_middel')}</th>
                <th className="text-left px-3 py-2">{t('lbl_methode_cip')}</th>
                <th className="text-left px-3 py-2">{t('lbl_oorzaak')}</th>
                <th className="text-left px-3 py-2">{t('lbl_opmerking')}</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((l: any) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtD(l.datum)}</td>
                  <td className="px-3 py-2 text-gray-700">{tankNaam(l.tank_id)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded ${badgeCls[l.nieuwe_status] || ''}`}>
                      {t(TANK_REINIGING_LABEL_KEY[l.nieuwe_status] || '')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{l.uitgevoerd_door}</td>
                  <td className="px-3 py-2 text-gray-500">{l.middel || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{l.cip ? t('lbl_ja') : t('lbl_nee')}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {l.oorzaak === 'automatisch_leeg'
                      ? t('lbl_oorzaak_automatisch')
                      : l.oorzaak === 'batch_checklist'
                        ? t('lbl_oorzaak_batch_checklist')
                        : t('lbl_oorzaak_handmatig')}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{l.opmerking || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ReinigingTab
