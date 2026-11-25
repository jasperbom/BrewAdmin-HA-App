import React from 'react'
import { t, getLang } from '../../i18n'
import Blad from '../ui/Blad'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'
import StatusPil, { type PilKleur } from '../ui/StatusPil'
import RowActions from '../ui/RowActions'
import SectionHeader from '../ui/SectionHeader'
import LegeStaat from '../ui/LegeStaat'
import { useUndo } from '../ui/UndoBar'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import {
  MIDDEL_SOORTEN, ctgbOordeel, doseringTekst, normaliseerMiddel, type CtgbStand,
} from '../../utils/reinigingsmiddelen'
import type { ReinigingsMiddel } from '../../types'

// De reinigings- en desinfectiemiddelen van de brouwerij (HACCP › Reiniging):
// soort, dosering, naspoelen en — voor een desinfectiemiddel — het
// Ctgb-toelatingsnummer met de einddatum. De lijst vult de brouwerij zelf; er
// staan geen merken in de code.

/** De openbare databank van het Ctgb (toelatingen opzoeken). */
export const CTGB_DATABANK_URL = 'https://toelatingen.ctgb.nl/'

const CTGB_KLEUR: Record<CtgbStand, PilKleur> = {
  niet_nodig: 'grijs', ontbreekt: 'rood', verlopen: 'rood', verloopt: 'oranje', geldig: 'groen',
}

interface MiddelenLijstProps {
  middelen: ReinigingsMiddel[]
  setMiddelen: (f: (prev: ReinigingsMiddel[]) => ReinigingsMiddel[]) => void
  auditLog?: any[]
  setAuditLog?: any
  /** Alleen lezen (rol). */
  alleenLezen?: boolean
}

type Concept = {
  id: number | null
  naam: string; soort: ReinigingsMiddel['soort']; waarvoor: string
  ctgb_nummer: string; ctgb_geldig_tot: string
  onverdund: boolean; dosering_min_pct: string; dosering_max_pct: string
  temp_min_c: string; temp_max_c: string; contacttijd_min: string; naspoelen: boolean
}

const leeg = (): Concept => ({
  id: null, naam: '', soort: 'alkalisch', waarvoor: '', ctgb_nummer: '', ctgb_geldig_tot: '',
  onverdund: false, dosering_min_pct: '', dosering_max_pct: '', temp_min_c: '', temp_max_c: '', contacttijd_min: '', naspoelen: true,
})
const alsTekst = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const vanMiddel = (m: ReinigingsMiddel): Concept => ({
  id: m.id, naam: m.naam, soort: m.soort, waarvoor: m.waarvoor || '', ctgb_nummer: m.ctgb_nummer || '',
  ctgb_geldig_tot: m.ctgb_geldig_tot || '', onverdund: !!m.onverdund,
  dosering_min_pct: alsTekst(m.dosering_min_pct), dosering_max_pct: alsTekst(m.dosering_max_pct),
  temp_min_c: alsTekst(m.temp_min_c), temp_max_c: alsTekst(m.temp_max_c), contacttijd_min: alsTekst(m.contacttijd_min),
  naspoelen: m.naspoelen,
})

/** De stand van de toelating als pil (niets bij een middel dat er geen nodig heeft). */
export const CtgbPil: React.FC<{ middel: ReinigingsMiddel; vandaag?: string }> = ({ middel, vandaag }) => {
  const o = ctgbOordeel(middel, vandaag || tod())
  if (o.stand === 'niet_nodig') return null
  const tekst = o.stand === 'ontbreekt' ? t('middel_ctgb_ontbreekt')
    : o.stand === 'verlopen' ? t('middel_ctgb_verlopen').replace('{datum}', fmtD(middel.ctgb_geldig_tot))
    : o.stand === 'verloopt' ? t('middel_ctgb_verloopt').replace('{datum}', fmtD(middel.ctgb_geldig_tot))
    : middel.ctgb_geldig_tot ? t('middel_ctgb_geldig_tot').replace('{datum}', fmtD(middel.ctgb_geldig_tot)) : t('middel_ctgb_geldig')
  return <StatusPil kleur={CTGB_KLEUR[o.stand]}>{tekst}</StatusPil>
}

const MiddelenLijst: React.FC<MiddelenLijstProps> = ({ middelen, setMiddelen, auditLog, setAuditLog, alleenLezen }) => {
  const [concept, setConcept] = React.useState<Concept | null>(null)
  const [fout, setFout] = React.useState('')
  const [toonArchief, setToonArchief] = React.useState(false)
  const undo = useUndo()
  const taal = getLang()
  const vandaag = tod()

  const actief = (middelen || []).filter(m => m && !m.gearchiveerd)
  const archief = (middelen || []).filter(m => m && m.gearchiveerd)

  const bewaar = () => {
    if (!concept) return
    if (!concept.naam.trim()) { setFout(t('middel_fout_naam')); return }
    const id = concept.id ?? newId(middelen || [])
    const m = normaliseerMiddel({
      ...concept, id,
      ctgb_nummer: concept.soort === 'desinfectie' ? concept.ctgb_nummer : '',
      ctgb_geldig_tot: concept.soort === 'desinfectie' ? concept.ctgb_geldig_tot : '',
    } as any)
    setMiddelen(prev => concept.id == null ? [...(prev || []), m] : (prev || []).map(x => x.id === id ? { ...m, ...(x.gearchiveerd ? { gearchiveerd: true } : {}) } : x))
    if (setAuditLog) logAudit(auditLog, setAuditLog, {
      entiteit: 'Reinigingsmiddel', entiteit_id: id, actie: concept.id == null ? 'aangemaakt' : 'gewijzigd',
      omschrijving: `${m.naam}${m.ctgb_nummer ? ` (${m.ctgb_nummer}${m.ctgb_geldig_tot ? `, ${m.ctgb_geldig_tot}` : ''})` : ''}`,
    })
    setConcept(null)
  }

  const archiveer = (m: ReinigingsMiddel, aan: boolean) => {
    const doe = () => {
      setMiddelen(prev => (prev || []).map(x => x.id === m.id ? (aan ? { ...x, gearchiveerd: true } : (() => { const { gearchiveerd: _g, ...r } = x; return r as ReinigingsMiddel })()) : x))
      if (setAuditLog) logAudit(auditLog, setAuditLog, { entiteit: 'Reinigingsmiddel', entiteit_id: m.id, actie: 'gewijzigd',
        omschrijving: `${m.naam}: ${aan ? 'gearchiveerd' : 'terug in gebruik'}` })
    }
    if (aan) undo.plan(`middel-${m.id}`, t('middel_undo_archief').replace('{naam}', m.naam), doe)
    else doe()
  }

  const rij = (m: ReinigingsMiddel) => {
    const dosering = doseringTekst(m, t, taal)
    return (
      <div key={m.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-gray-800 break-words">{m.naam}</span>
            <span className="text-xs text-gray-500">{t(`middel_soort_${m.soort}`)}</span>
            <CtgbPil middel={m} vandaag={vandaag} />
          </div>
          {(dosering || m.ctgb_nummer) && (
            <div className="text-xs text-gray-600 cijfer">
              {[dosering, m.ctgb_nummer ? t('middel_ctgb_kort').replace('{nummer}', m.ctgb_nummer) : ''].filter(Boolean).join(' · ')}
            </div>
          )}
          <div className="text-xs text-gray-500">
            {[m.waarvoor, m.naspoelen ? t('middel_naspoelen_ja') : t('middel_naspoelen_nee')].filter(Boolean).join(' · ')}
          </div>
        </div>
        {!alleenLezen && (
          <RowActions acties={[
            { id: 'bewerk', label: t('btn_edit'), onClick: () => { setFout(''); setConcept(vanMiddel(m)) } },
            m.gearchiveerd
              ? { id: 'terug', label: t('middel_terug'), onClick: () => archiveer(m, false) }
              : { id: 'archief', label: t('middel_archiveren'), onClick: () => archiveer(m, true) },
          ]} />
        )}
      </div>
    )
  }

  const veld = (k: keyof Concept) => (v: string) => setConcept(c => c ? { ...c, [k]: v } : c)

  return (
    <div className="space-y-2">
      <SectionHeader title={t('middel_lijst_titel')}
        info={!alleenLezen ? <Btn s="sm" onClick={() => { setFout(''); setConcept(leeg()) }}>{t('middel_toevoegen')}</Btn> : undefined} />
      {actief.length === 0 ? (
        <LegeStaat titel={t('middel_leeg_titel')} tekst={t('middel_leeg_tekst')}>
          {!alleenLezen && <Btn s="sm" onClick={() => { setFout(''); setConcept(leeg()) }}>{t('middel_toevoegen')}</Btn>}
        </LegeStaat>
      ) : <div className="space-y-2">{actief.map(rij)}</div>}
      {archief.length > 0 && (
        <div>
          <button type="button" onClick={() => setToonArchief(o => !o)}
            className="text-xs text-gray-500 underline underline-offset-2 min-h-tap sm:min-h-0">
            {t(toonArchief ? 'middel_archief_verberg' : 'middel_archief_toon').replace('{n}', String(archief.length))}
          </button>
          {toonArchief && <div className="space-y-2 mt-2 opacity-75">{archief.map(rij)}</div>}
        </div>
      )}

      {concept && (
        <Blad titel={t(concept.id == null ? 'middel_nieuw' : 'middel_bewerken')} onSluit={() => setConcept(null)} onKlaar={bewaar} klaarLabel={t('btn_save')}>
          <div className="space-y-3">
            <Inp label={t('middel_naam')} value={concept.naam} onChange={veld('naam')} req />
            <Sel label={t('middel_soort')} value={concept.soort}
              onChange={v => setConcept(c => c ? { ...c, soort: v as Concept['soort'], naspoelen: v === 'thermisch' ? false : c.naspoelen } : c)}
              opts={MIDDEL_SOORTEN.map(s => ({ v: s, l: t(`middel_soort_${s}`) }))} />
            <Inp label={t('middel_waarvoor')} value={concept.waarvoor} onChange={veld('waarvoor')} placeholder={t('middel_waarvoor_ph')} />
            {concept.soort === 'desinfectie' && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-xs text-gray-600">
                  {t('middel_ctgb_uitleg')}{' '}
                  <a href={CTGB_DATABANK_URL} target="_blank" rel="noopener noreferrer" className="t-accent-text underline underline-offset-2">{t('middel_ctgb_databank')}</a>
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Inp label={t('middel_ctgb_nummer')} value={concept.ctgb_nummer} onChange={veld('ctgb_nummer')} placeholder="12345 N" />
                  <Inp label={t('middel_ctgb_tot')} type="date" value={concept.ctgb_geldig_tot} onChange={veld('ctgb_geldig_tot')} />
                </div>
              </div>
            )}
            {concept.soort !== 'thermisch' && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="t-checkbox" checked={concept.onverdund}
                  onChange={e => setConcept(c => c ? { ...c, onverdund: e.target.checked } : c)} />
                {t('middel_onverdund_label')}
              </label>
            )}
            {concept.soort !== 'thermisch' && !concept.onverdund && (
              <div className="grid grid-cols-2 gap-2">
                <Inp label={t('middel_dosering_min')} type="number" step="0.1" value={concept.dosering_min_pct} onChange={veld('dosering_min_pct')} />
                <Inp label={t('middel_dosering_max')} type="number" step="0.1" value={concept.dosering_max_pct} onChange={veld('dosering_max_pct')} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Inp label={t(concept.soort === 'thermisch' ? 'middel_temp_retour' : 'middel_temp_min')} type="number" value={concept.temp_min_c} onChange={veld('temp_min_c')} />
              {concept.soort !== 'thermisch'
                ? <Inp label={t('middel_temp_max')} type="number" value={concept.temp_max_c} onChange={veld('temp_max_c')} />
                : <div />}
              <Inp label={t('middel_contacttijd')} type="number" value={concept.contacttijd_min} onChange={veld('contacttijd_min')} />
            </div>
            {concept.soort !== 'thermisch' && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="t-checkbox" checked={concept.naspoelen}
                  onChange={e => setConcept(c => c ? { ...c, naspoelen: e.target.checked } : c)} />
                {t('middel_naspoelen_label')}
              </label>
            )}
            {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
          </div>
        </Blad>
      )}
    </div>
  )
}

export default MiddelenLijst
