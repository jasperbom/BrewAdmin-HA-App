import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import Btn from '../ui/Btn'
import Modal from '../ui/Modal'
import Inp from '../ui/Inp'

// Basisvoorwaardenprogramma (HACCP-handboek hoofdstuk 5, 7 en 12):
// waterkwaliteit, ongediertewering en het opleidingsregister. Drie registers
// die je een paar keer per jaar bijwerkt en die dezelfde vorm hebben (lijst +
// formulier) — daarom één tabblad met drie sublijsten in plaats van drie
// tabbladen die de tabbalk vol zetten.
type Sub = 'water' | 'ongedierte' | 'opleidingen'

function RegistersTab(props: any) {
  const {useState} = React
  const [sub, setSub] = useState<Sub>('water')

  const subs: {id: Sub, l: string}[] = [
    {id: 'water', l: t('haccp_water')},
    {id: 'ongedierte', l: t('haccp_ongedierte')},
    {id: 'opleidingen', l: t('haccp_opleidingen')},
  ]

  // Eén modal-state voor drie lijsten: bij het wisselen van sublijst gaat een
  // half ingevuld formulier dicht, anders opent de volgende lijst met de
  // velden van de vorige.
  const wissel = (id: Sub) => {
    setSub(id)
    props.setModal(null)
    props.setEdit(null)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {subs.map(s => (
          <button key={s.id} onClick={() => wissel(s.id)}
            className={`px-3 py-1 rounded text-xs font-medium ${sub === s.id ? 'tbtn text-white' : 'bg-gray-100 text-gray-600'}`}>
            {s.l}
          </button>
        ))}
      </div>
      {sub === 'water' && <WaterLijst {...props} />}
      {sub === 'ongedierte' && <OngedierteLijst {...props} />}
      {sub === 'opleidingen' && <OpleidingenLijst {...props} />}
    </div>
  )
}

function WaterLijst({waterkwaliteit, setWaterkwaliteit, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sorted = (waterkwaliteit || []).slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))
  const last = sorted[0]
  const warn = last ? (today.getTime() - new Date(last.datum).getTime()) / 86400000 > 180 : true

  const save = () => {
    if(!edit?.datum) return
    if(edit.id && (waterkwaliteit || []).some((w: any) => w.id === edit.id)) {
      setWaterkwaliteit((prev: any[]) => prev.map((w: any) => w.id === edit.id ? {...w, ...edit} : w))
      logAudit(auditLog, setAuditLog, {entiteit: 'Waterkwaliteit', entiteit_id: edit.id, actie: 'gewijzigd', omschrijving: `Water test ${edit.datum}`})
    } else {
      const id = newId(waterkwaliteit || [])
      setWaterkwaliteit((prev: any[]) => [...prev, {...edit, id}])
      logAudit(auditLog, setAuditLog, {entiteit: 'Waterkwaliteit', entiteit_id: id, actie: 'aangemaakt', omschrijving: `Water test ${edit.datum}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      {warn && <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 text-sm text-orange-700">{t('haccp_water_warn')}</div>}
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={() => {setEdit({datum: tod(), bron: 'leidingwater', resultaat: 'goed', ph: '', hardheid: '', chlor: '', opmerking: '', uitgevoerd_door: ''}); setModal('water')}}>{t('haccp_water_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_water_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((w: any) => (
          <div key={w.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${w.resultaat === 'goed' ? 'border-green-500' : 'border-red-500'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{fmtD(w.datum)}</span>
                {w.bron && <span className="text-xs text-gray-500 ml-2">{t(`haccp_water_bron_${w.bron}`) || w.bron}</span>}
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${w.resultaat === 'goed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t(`haccp_water_${w.resultaat}`)}</span>
                {w.ph && <span className="text-xs text-gray-500 ml-2">pH {w.ph}</span>}
              </div>
              <Btn s="sm" v="ghost" onClick={() => {setEdit({...w}); setModal('water')}}>{t('btn_edit')}</Btn>
            </div>
            {w.opmerking && <div className="text-xs text-gray-500 mt-1">{w.opmerking}</div>}
          </div>
        ))}
      </div>

      {modal === 'water' && edit && (
        <Modal title={edit.id ? t('btn_edit') : t('haccp_water_nieuw')} onClose={() => {setModal(null); setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={edit.datum || ''} onChange={v => setEdit({...edit, datum: v})} req />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_water_bron')}</label>
              <select value={edit.bron || 'leidingwater'} onChange={e => setEdit({...edit, bron: e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="leidingwater">{t('haccp_water_bron_leiding')}</option>
                <option value="bron">{t('haccp_water_bron_bron')}</option>
                <option value="osmose">{t('haccp_water_bron_osmose')}</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Inp label={t('haccp_water_ph')} type="number" value={edit.ph ?? ''} onChange={v => setEdit({...edit, ph: v ? Number(v) : undefined})} step="0.1" />
              <Inp label={t('haccp_water_hardheid')} type="number" value={edit.hardheid ?? ''} onChange={v => setEdit({...edit, hardheid: v ? Number(v) : undefined})} />
              <Inp label={t('haccp_water_chlor')} type="number" value={edit.chlor ?? ''} onChange={v => setEdit({...edit, chlor: v ? Number(v) : undefined})} step="0.01" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_water_resultaat')}</label>
              <select value={edit.resultaat || 'goed'} onChange={e => setEdit({...edit, resultaat: e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="goed">{t('haccp_water_goed')}</option>
                <option value="afwijkend">{t('haccp_water_afwijkend')}</option>
              </select>
            </div>
            <Inp label={t('lbl_uitgevoerd_door')} value={edit.uitgevoerd_door || ''} onChange={v => setEdit({...edit, uitgevoerd_door: v})} />
            <Inp label={t('lbl_opmerking')} value={edit.opmerking || ''} onChange={v => setEdit({...edit, opmerking: v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => {setModal(null); setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function OngedierteLijst({ongedierte, setOngedierte, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sorted = (ongedierte || []).slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))
  const lastCtrl = sorted.find((o: any) => o.type === 'controle')
  const warn = lastCtrl ? (today.getTime() - new Date(lastCtrl.datum).getTime()) / 86400000 > 30 : true

  const save = () => {
    if(!edit?.datum) return
    if(edit.id && (ongedierte || []).some((o: any) => o.id === edit.id)) {
      setOngedierte((prev: any[]) => prev.map((o: any) => o.id === edit.id ? {...o, ...edit} : o))
      logAudit(auditLog, setAuditLog, {entiteit: 'Ongedierte', entiteit_id: edit.id, actie: 'gewijzigd', omschrijving: `${edit.type} ${edit.datum}`})
    } else {
      const id = newId(ongedierte || [])
      setOngedierte((prev: any[]) => [...prev, {...edit, id}])
      logAudit(auditLog, setAuditLog, {entiteit: 'Ongedierte', entiteit_id: id, actie: 'aangemaakt', omschrijving: `${edit.type} ${edit.datum}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      {warn && <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 text-sm text-orange-700">{t('haccp_ongd_warn')}</div>}
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={() => {setEdit({datum: tod(), type: 'controle', locatie: '', bevinding: '', actie: '', uitgevoerd_door: ''}); setModal('ongd')}}>{t('haccp_ongd_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_ongd_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((o: any) => (
          <div key={o.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${o.type === 'waarneming' ? 'border-orange-500' : 'border-green-500'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{fmtD(o.datum)}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${o.type === 'controle' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{t(`haccp_ongd_${o.type}`)}</span>
                {o.locatie && <span className="text-xs text-gray-500 ml-2">{o.locatie}</span>}
              </div>
              <Btn s="sm" v="ghost" onClick={() => {setEdit({...o}); setModal('ongd')}}>{t('btn_edit')}</Btn>
            </div>
            {o.bevinding && <div className="text-xs text-gray-600 mt-1">{o.bevinding}</div>}
            {o.actie && <div className="text-xs text-gray-500 mt-0.5">{o.actie}</div>}
          </div>
        ))}
      </div>

      {modal === 'ongd' && edit && (
        <Modal title={edit.id ? t('btn_edit') : t('haccp_ongd_nieuw')} onClose={() => {setModal(null); setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('lbl_datum')} type="date" value={edit.datum || ''} onChange={v => setEdit({...edit, datum: v})} req />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_ongd_type')}</label>
              <select value={edit.type || 'controle'} onChange={e => setEdit({...edit, type: e.target.value})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="controle">{t('haccp_ongd_controle')}</option>
                <option value="waarneming">{t('haccp_ongd_waarneming')}</option>
              </select>
            </div>
            <Inp label={t('haccp_ongd_locatie')} value={edit.locatie || ''} onChange={v => setEdit({...edit, locatie: v})} />
            <Inp label={t('haccp_ongd_bevinding')} value={edit.bevinding || ''} onChange={v => setEdit({...edit, bevinding: v})} />
            <Inp label={t('haccp_ongd_actie')} value={edit.actie || ''} onChange={v => setEdit({...edit, actie: v})} />
            <Inp label={t('lbl_uitgevoerd_door')} value={edit.uitgevoerd_door || ''} onChange={v => setEdit({...edit, uitgevoerd_door: v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => {setModal(null); setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function OpleidingenLijst({opleidingen, setOpleidingen, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sorted = (opleidingen || []).slice().sort((a: any, b: any) => String(b.datum || '').localeCompare(String(a.datum || '')))

  const save = () => {
    if(!edit?.medewerker || !edit?.onderwerp) return
    if(edit.id && (opleidingen || []).some((o: any) => o.id === edit.id)) {
      setOpleidingen((prev: any[]) => prev.map((o: any) => o.id === edit.id ? {...o, ...edit} : o))
      logAudit(auditLog, setAuditLog, {entiteit: 'Opleiding', entiteit_id: edit.id, actie: 'gewijzigd', omschrijving: `${edit.medewerker}: ${edit.onderwerp}`})
    } else {
      const id = newId(opleidingen || [])
      setOpleidingen((prev: any[]) => [...prev, {...edit, id}])
      logAudit(auditLog, setAuditLog, {entiteit: 'Opleiding', entiteit_id: id, actie: 'aangemaakt', omschrijving: `${edit.medewerker}: ${edit.onderwerp}`})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Btn s="sm" onClick={() => {setEdit({medewerker: '', onderwerp: '', datum: tod(), geldig_tot: '', certificaat: '', opmerking: ''}); setModal('opl')}}>{t('haccp_opl_nieuw')}</Btn>
      </div>
      {!sorted.length && <p className="text-sm text-gray-500 italic">{t('haccp_opl_geen')}</p>}
      <div className="space-y-2">
        {sorted.map((o: any) => {
          const verlopen = o.geldig_tot && new Date(o.geldig_tot) < today
          return (
            <div key={o.id} className={`bg-white rounded-lg p-3 shadow-sm border-l-4 ${verlopen ? 'border-red-500' : 'border-green-500'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{o.medewerker}</span>
                  <span className="text-gray-600 ml-2 text-sm">{o.onderwerp}</span>
                  {verlopen && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('haccp_opl_verlopen')}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{fmtD(o.datum)}</span>
                  {o.geldig_tot && <span className="text-xs text-gray-400">→ {fmtD(o.geldig_tot)}</span>}
                  <Btn s="sm" v="ghost" onClick={() => {setEdit({...o}); setModal('opl')}}>{t('btn_edit')}</Btn>
                </div>
              </div>
              {o.certificaat && <div className="text-xs text-gray-500 mt-1">{o.certificaat}</div>}
            </div>
          )
        })}
      </div>

      {modal === 'opl' && edit && (
        <Modal title={edit.id ? t('btn_edit') : t('haccp_opl_nieuw')} onClose={() => {setModal(null); setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_opl_medewerker')} value={edit.medewerker || ''} onChange={v => setEdit({...edit, medewerker: v})} req />
            <Inp label={t('haccp_opl_onderwerp')} value={edit.onderwerp || ''} onChange={v => setEdit({...edit, onderwerp: v})} req />
            <Inp label={t('haccp_opl_datum')} type="date" value={edit.datum || ''} onChange={v => setEdit({...edit, datum: v})} req />
            <Inp label={t('haccp_opl_geldig_tot')} type="date" value={edit.geldig_tot || ''} onChange={v => setEdit({...edit, geldig_tot: v})} />
            <Inp label={t('haccp_opl_certificaat')} value={edit.certificaat || ''} onChange={v => setEdit({...edit, certificaat: v})} />
            <Inp label={t('lbl_opmerking')} value={edit.opmerking || ''} onChange={v => setEdit({...edit, opmerking: v})} />
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => {setModal(null); setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default RegistersTab
