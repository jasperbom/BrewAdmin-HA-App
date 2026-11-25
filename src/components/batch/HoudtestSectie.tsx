import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, fmtSg, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import Btn from '../ui/Btn'
import BevestigKnop from '../ui/BevestigKnop'
import Inp from '../ui/Inp'
import { blokkadeTekst, blokkadeSamenvatting } from '../haccp/BlokkadeKaart'
import AfwijkingModal from '../haccp/AfwijkingModal'
import { maakParaaf, bouwAfwijking, capaUitAfwijking } from '../../utils/haccp'
import {
  beoordeelHoudtest, bouwVerkoopVrijgave, naVerkoopVrijgave, dagenTot,
  type HoudtestStand,
} from '../../utils/houdtest'
import type { VerkoopVrijgave } from '../../types'

// Houdtest en vrijgave voor verkoop (utils/houdtest.ts).
//
// Na het afvullen staat het bier in quarantaine. Op de dag van de houdtest
// open je een warme fles: SG, overdruk, geur en smaak. Klopt het, dan is de
// batch vrij voor verkoop; zakte de SG te ver, dan alleen met een afwijking.
// Afkeuren kan altijd: dan blijft het bier geblokkeerd tot het vernietigd is.

interface Props {
  batch: any
  stand: HoudtestStand
  /** De lotcode van de sessie met de houdtestflessen (of de eerste). */
  bronLotcode?: string
  verkoopvrijgaven: VerkoopVrijgave[]
  setVerkoopvrijgaven: (fn: any) => void
  setAv: (fn: any) => void
  capa: any[]
  setCapa: (fn: any) => void
  afwijkingen: any[]
  setAfwijkingen: (fn: any) => void
  haccpInstellingen: any
  whoami: {gebruiker?: string; rol?: string} | null
  auditLog: any[]
  setAuditLog: (fn: any) => void
}

const HoudtestSectie: React.FC<Props> = (p) => {
  const {stand} = p
  const [sgWarm, setSgWarm] = React.useState('')
  const [drukOk, setDrukOk] = React.useState(false)
  const [smaakOk, setSmaakOk] = React.useState(false)
  const [opmerking, setOpmerking] = React.useState('')
  const [afwijkingOpen, setAfwijkingOpen] = React.useState(false)

  const vandaag = tod()
  const invoer = {sg_warm: sgWarm, druk_ok: drukOk, smaak_ok: smaakOk}
  const b = beoordeelHoudtest(stand, invoer, p.haccpInstellingen, vandaag)
  const nog = dagenTot(vandaag, stand.klaar_op)

  const schrijf = (oordeel: VerkoopVrijgave['oordeel'], afwijkingId?: number) => {
    const id = newId(p.verkoopvrijgaven || [])
    const record = bouwVerkoopVrijgave(id, stand, invoer, b, oordeel, maakParaaf(p.whoami),
      {afwijking_id: afwijkingId, opmerking})
    p.setVerkoopvrijgaven((prev: VerkoopVrijgave[]) => [...(prev || []), record])
    p.setAv((prev: any[]) => naVerkoopVrijgave(prev || [], p.batch.id, oordeel))
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'VerkoopVrijgave', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${p.batch?.naam || ''}: ${t(oordeel === 'vrijgegeven' ? 'haccp_houdtest_vrijgegeven' : 'haccp_houdtest_afgekeurd')}`,
    })
  }

  const blokkade = {toegestaan: false, redenen: b.redenen}
  const bevestigAfwijking = (onderbouwing: string) => {
    const paraaf = maakParaaf(p.whoami)
    const afwId = newId(p.afwijkingen || [])
    const afw = bouwAfwijking(afwId, 'houdtest', blokkade, {batch_id: p.batch.id},
      onderbouwing, blokkadeSamenvatting(blokkade), paraaf)
    if (!afw) return
    const capaId = newId(p.capa || [])
    p.setAfwijkingen((prev: any[]) => [...(prev || []), {...afw, capa_id: capaId}])
    p.setCapa((prev: any[]) => [...(prev || []), {...capaUitAfwijking(afw, capaId), bron: 'afwijking'}])
    setAfwijkingOpen(false)
    schrijf('vrijgegeven', afwId)
  }

  // ── Al beoordeeld ────────────────────────────────────────────────────────
  const v = stand.vrijgave
  if (v && stand.stand !== 'quarantaine') {
    const vrij = v.oordeel === 'vrijgegeven'
    return (
      <div className="rounded-lg border border-gray-200 p-3 bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${vrij ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {t(vrij ? 'haccp_houdtest_vrijgegeven' : 'haccp_houdtest_afgekeurd')}
          </span>
          {v.afwijking_id != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
              {t('haccp_afw_kort')}
            </span>
          )}
        </div>
        <div className="mt-2 text-xs text-gray-600 space-y-0.5">
          {v.sg_warm != null && (
            <div>
              {t('haccp_houdtest_sg_warm')}: {fmtSg(v.sg_warm)}
              {v.sg_afvullen != null && <> · {t('haccp_sg_afvullen')} {fmtSg(v.sg_afvullen)}</>}
            </div>
          )}
          {v.opmerking && <div className="italic">{v.opmerking}</div>}
          <div className="text-gray-500">
            {t('haccp_ccp1_paraaf')}: {v.paraaf?.gebruiker || '—'}{' · '}{fmtD(v.datum)}
          </div>
          {!vrij && <div className="text-red-700">{t('haccp_houdtest_afgekeurd_uitleg')}</div>}
        </div>
      </div>
    )
  }

  // ── Beoordelen ───────────────────────────────────────────────────────────
  const kanVrijgeven = b.voorgesteld === 'groen'
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-800">
        {nog != null && nog > 0
          ? t('haccp_houdtest_op').replace('{datum}', fmtD(stand.klaar_op)).replace('{n}', String(nog))
          : t('haccp_houdtest_nu').replace('{datum}', fmtD(stand.klaar_op))}
        <div className="text-xs text-gray-500 mt-0.5">
          {t('haccp_houdtest_uitleg').replace('{dagen}', String(stand.dagen))}
        </div>
      </div>
      {!stand.flessen && (
        <div className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded p-2">
          {t('haccp_houdtest_geen_flessen')}
        </div>
      )}
      {stand.flessen && p.bronLotcode && (
        <div className="text-xs text-gray-500">{t('haccp_houdtest_flessen_bij').replace('{lotcode}', p.bronLotcode)}</div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Inp label={t('haccp_houdtest_sg_warm')} type="number" step="0.001" value={sgWarm} onChange={setSgWarm} />
          {stand.sg_afvullen != null && (
            <div className={`text-xs mt-0.5 ${b.redenen.some(r => r.code === 'houdtest_nagisting') ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {t('haccp_sg_afvullen')} {fmtSg(stand.sg_afvullen)}
              {b.sg_verschil != null && <> · {t('haccp_houdtest_gezakt').replace('{verschil}', b.sg_verschil.toFixed(3))}</>}
            </div>
          )}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="t-checkbox mt-0.5" checked={drukOk} onChange={e => setDrukOk(e.target.checked)} />
        <span>{t('haccp_houdtest_druk_ok')}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="t-checkbox mt-0.5" checked={smaakOk} onChange={e => setSmaakOk(e.target.checked)} />
        <span>{t('haccp_houdtest_smaak_ok')}</span>
      </label>
      <Inp label={t('lbl_opmerking')} value={opmerking} onChange={setOpmerking} />

      <div className="flex items-start justify-between flex-wrap gap-2">
        <BevestigKnop s="sm" v="danger" vraag={t('haccp_houdtest_afkeuren_vraag')} onBevestig={() => schrijf('afgekeurd')}>
          {t('haccp_houdtest_afkeuren')}
        </BevestigKnop>
        <Btn s="sm" disabled={!kanVrijgeven} reden={kanVrijgeven ? undefined : blokkadeTekst(b.redenen[0])}
          onClick={() => kanVrijgeven && schrijf('vrijgegeven')}>
          {t('haccp_houdtest_vrijgeven')}
        </Btn>
      </div>
      {b.voorgesteld === 'rood' && (
        <button onClick={() => setAfwijkingOpen(true)}
          className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900">
          {t('haccp_houdtest_toch')}
        </button>
      )}
      {afwijkingOpen && (
        <AfwijkingModal blok={blokkade} titel={t('haccp_houdtest_titel')}
          onBevestig={bevestigAfwijking} onClose={() => setAfwijkingOpen(false)} />
      )}
    </div>
  )
}

export default HoudtestSectie
