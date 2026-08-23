import React, { useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import Btn from './ui/Btn'
import Modal from './ui/Modal'
import Inp from './ui/Inp'
import { uitslagKandidaten, verdeelUitslag } from '../utils/agp'
import type { UitslagAllocatie } from '../utils/agp'
import type { Afvulling, Batch, Locatie, Uitlevering, Verplaatsing, Afboeking, AccijnsInst } from '../types'

export interface UitslagOpslag {
  allocaties: UitslagAllocatie[]
  naar_locatie_id: number
  datum: string
  opmerking: string
}

interface UitslagModalProps {
  productNaam: string
  /** Alle afvullingen van dit product. */
  afvullingen: Afvulling[]
  batches: Batch[]
  locaties: Locatie[]
  uit?: Uitlevering[]
  verplaatsingen?: Verplaatsing[]
  afboekingen?: Afboeking[]
  accijnsInst?: AccijnsInst | null
  /** Al gepickte aantallen per afvulling_id — die zijn niet meer vrij. */
  gereserveerd?: Record<number, number>
  onClose: () => void
  onOpslaan: (opslag: UitslagOpslag) => void
}

/** Uitslaan op productniveau: je kiest een verpakking en een aantal, de app
 * kiest de afvullingen (oudste THT eerst). Bespaart het opzoeken van de
 * juiste afvulling op de AGP-pagina. */
const UitslagModal: React.FC<UitslagModalProps> = ({
  productNaam, afvullingen, batches, locaties, uit = [], verplaatsingen = [],
  afboekingen = [], accijnsInst, gereserveerd = {}, onClose, onOpslaan,
}) => {
  const vrijeLocaties = (locaties || []).filter(l => !l.is_agp)
  const [verpakking, setVerpakking] = useState('')
  const [aantal, setAantal] = useState('')
  const [naarLocatieId, setNaarLocatieId] = useState<number>(vrijeLocaties.length === 1 ? vrijeLocaties[0].id : 0)
  const [datum, setDatum] = useState(tod())
  const [opmerking, setOpmerking] = useState('')
  const [fout, setFout] = useState('')

  // Kandidaten per verpakkingstype: alleen types waarvan nog iets in de AGP ligt.
  const perVerpakking = useMemo(() => {
    const alle = uitslagKandidaten(afvullingen || [], batches || [], locaties, uit, verplaatsingen, afboekingen, gereserveerd)
    const groepen: Record<string, typeof alle> = {}
    for (const k of alle) {
      const vt = k.afv.verpakking_naam || k.afv.verpakking_type || t('lbl_onbekend')
      ;(groepen[vt] = groepen[vt] || []).push(k)
    }
    return groepen
  }, [afvullingen, batches, locaties, uit, verplaatsingen, afboekingen, gereserveerd])

  const types = Object.keys(perVerpakking).sort()
  const actiefType = verpakking || types[0] || ''
  const kandidaten = perVerpakking[actiefType] || []
  // De uitslagdatum bepaalt het accijnstarief, dus die hoort in de berekening.
  const verdeling = useMemo(
    () => verdeelUitslag(kandidaten, Number(aantal || 0), accijnsInst, datum),
    [kandidaten, aantal, accijnsInst, datum]
  )

  const opslaan = () => {
    const n = Number(aantal || 0)
    if (!n || n <= 0) { setFout(t('agp_err_aantal_verplicht')); return }
    if (!naarLocatieId) { setFout(t('agp_err_locatie_verplicht')); return }
    if (verdeling.tekort > 0) {
      setFout(t('uitslag_err_tekort').replace('{n}', String(verdeling.totaalBeschikbaar)))
      return
    }
    onOpslaan({ allocaties: verdeling.allocaties, naar_locatie_id: naarLocatieId, datum, opmerking })
  }

  return (
    <Modal title={t('uitslag_titel').replace('{product}', productNaam)} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {types.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded p-4 text-center text-gray-500 text-sm">
            {t('uitslag_geen_agp_voorraad')}
          </div>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
              {t('uitslag_uitleg')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('excise_packaging')}</label>
                <select value={actiefType} onChange={e => { setFout(''); setVerpakking(e.target.value) }}
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                  {types.map(vt => (
                    <option key={vt} value={vt}>
                      {vt} — {(perVerpakking[vt] || []).reduce((s, k) => s + k.beschikbaar, 0)}× {t('uitslag_in_agp')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('agp_naar')}</label>
                <select value={naarLocatieId} onChange={e => { setFout(''); setNaarLocatieId(Number(e.target.value)) }}
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                  <option value={0}>—</option>
                  {vrijeLocaties.map(l => <option key={l.id} value={l.id}>{l.naam}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label={`${t('agp_aantal')} (${t('agp_max')} ${verdeling.totaalBeschikbaar})`} type="number" value={aantal}
                onChange={(v: string) => { setFout(''); setAantal(v) }} />
              <Inp label={t('lbl_datum')} type="date" value={datum} onChange={setDatum} />
            </div>
            <Inp label={t('lbl_opmerking')} value={opmerking} onChange={setOpmerking} />

            {verdeling.allocaties.length > 0 && (
              <div className="border border-gray-200 rounded overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t('uitslag_verdeling')}
                </div>
                <div className="divide-y divide-gray-100">
                  {verdeling.allocaties.map(a => (
                    <div key={a.afv.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div className="text-gray-600">
                        {a.batch?.batch_nummer ? `#${a.batch.batch_nummer}` : (a.batch?.naam || t('lbl_onbekend'))}
                        <span className="text-gray-400 ml-2">
                          {t('lbl_tht')}: {a.afv.tht ? fmtD(a.afv.tht) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-800">{a.aantal}×</span>
                        <span className="text-amber-700 font-semibold">{fmt(a.accijns)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
                  <span>{t('uitslag_accijns_totaal')}</span>
                  <span className="font-bold">{fmt(verdeling.totaalAccijns)}</span>
                </div>
              </div>
            )}

            {fout && <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{fout}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
              <Btn onClick={opslaan}>{t('uitslag_opslaan')}</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default UitslagModal
