import React, { useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from './ui/Btn'
import Modal from './ui/Modal'
import Inp from './ui/Inp'
import { valideerVerplaatsing, uitslagAccijns, inhoudPerEenheid, VERPLAATS_FOUT_KEYS } from '../utils/agp'
import type { VerplaatsInvoer, VerplaatsContext } from '../utils/agp'
import { voorraadPerLocatie } from '../utils/calculations'
import type { Afvulling, Batch, Locatie } from '../types'

interface VerplaatsModalProps {
  afv: Afvulling
  batch?: Batch | null
  /** Weergavenaam van het bier/product boven in de modal. */
  naam: string
  vanLocatieId: number
  ctx: Omit<VerplaatsContext, 'afv' | 'batch'>
  onClose: () => void
  onOpslaan: (invoer: VerplaatsInvoer) => void
}

/** Voorraad van één afvulling verplaatsen. Uit de AGP = uitslag: de modal
 * toont dan vooraf welk accijnsbedrag geboekt wordt. Gedeeld door de
 * AGP-pagina en de productpagina. */
const VerplaatsModal: React.FC<VerplaatsModalProps> = ({ afv, batch, naam, vanLocatieId, ctx, onClose, onOpslaan }) => {
  const [form, setForm] = useState<VerplaatsInvoer>({
    afvulling_id: afv.id,
    batch_id: afv.batch_id,
    datum: tod(),
    aantal: '',
    van_locatie_id: vanLocatieId,
    naar_locatie_id: 0,
    opmerking: '',
  })
  const [fout, setFout] = useState('')

  const volleCtx: VerplaatsContext = { ...ctx, afv, batch }
  const voorraad = voorraadPerLocatie(afv, ctx.locaties, ctx.uit || [], ctx.verplaatsingen || [], ctx.afboekingen || [])
  // Het maximum komt uit dezelfde toets als de blokkade: uit de AGP gaat wat
  // al voor een open bestelling gepickt is eraf. De keuzelijst hieronder toont
  // de fysieke voorraad per locatie.
  const beschikbaar = valideerVerplaatsing(form, volleCtx).beschikbaar
  const van = (ctx.locaties || []).find((l: Locatie) => l.id === form.van_locatie_id)
  const naar = form.naar_locatie_id ? (ctx.locaties || []).find((l: Locatie) => l.id === form.naar_locatie_id) : null

  const opslaan = () => {
    const oordeel = valideerVerplaatsing(form, volleCtx)
    if (!oordeel.ok) {
      setFout(t(VERPLAATS_FOUT_KEYS[oordeel.fout])
        .replace('{n}', String(oordeel.beschikbaar))
        .replace('{datum}', fmtD(afv.datum)))
      return
    }
    onOpslaan(form)
  }

  const aantal = Number(form.aantal || 0)
  const liter = aantal * inhoudPerEenheid(afv)
  const bedrag = van?.is_agp && naar && !naar.is_agp ? uitslagAccijns(afv, batch, aantal, ctx.accijnsInst, form.datum) : 0

  return (
    <Modal title={t('agp_verplaats_titel')} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="bg-gray-50 border border-gray-200 rounded p-3">
          <div className="text-xs text-gray-500">{naam}{batch?.batch_nummer ? ` #${batch.batch_nummer}` : ''}</div>
          <div className="font-medium">{afv.verpakking_naam || afv.verpakking_type || '—'}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('agp_van')}</label>
            <select value={form.van_locatie_id} onChange={e => { setFout(''); setForm(f => ({...f, van_locatie_id: Number(e.target.value)})) }}
              className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
              {(ctx.locaties || []).map((l: Locatie) => (
                <option key={l.id} value={l.id}>{l.naam}{l.is_agp ? ' (AGP)' : ''} — {voorraad[l.id] || 0}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('agp_naar')}</label>
            <select value={form.naar_locatie_id} onChange={e => { setFout(''); setForm(f => ({...f, naar_locatie_id: Number(e.target.value)})) }}
              className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
              <option value={0}>—</option>
              {(ctx.locaties || []).filter((l: Locatie) => l.id !== form.van_locatie_id && !l.is_agp).map((l: Locatie) => (
                <option key={l.id} value={l.id}>{l.naam}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Inp label={`${t('agp_aantal')} (${t('agp_max')} ${beschikbaar})`} type="number" value={form.aantal}
            onChange={(v: string) => { setFout(''); setForm(f => ({...f, aantal: v})) }} />
          {/* Geen datum in de toekomst: een verkoop van vandaag zou anders vóór
              deze verplaatsing verwerkt en stil op nul gezet worden. */}
          <Inp label={t('lbl_datum')} type="date" value={form.datum} max={tod()} min={afv.datum || undefined}
            onChange={(v: string) => { setFout(''); setForm(f => ({...f, datum: v})) }} />
        </div>
        <Inp label={t('lbl_opmerking')} value={form.opmerking || ''} onChange={(v: string) => setForm(f => ({...f, opmerking: v}))} />
        {bedrag > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded p-3 text-xs text-orange-800">
            {t('agp_info_accijns_boeken')} <span className="font-bold">{fmt(bedrag)}</span> ({liter.toFixed(1)}L × {batch?.ABV || 0}% ABV)
          </div>
        )}
        {van && naar && !van.is_agp && !naar.is_agp && (
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">{t('agp_info_geen_accijns_buiten')}</div>
        )}
        {fout && <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{fout}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
          <Btn onClick={opslaan}>{t('agp_verplaats_opslaan')}</Btn>
        </div>
      </div>
    </Modal>
  )
}

export default VerplaatsModal
