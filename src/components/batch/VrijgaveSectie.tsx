import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, fmtDagMaand, fmtSg, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import { blokkadeTekst, blokkadeSamenvatting } from '../haccp/BlokkadeKaart'
import AfwijkingModal from '../haccp/AfwijkingModal'
import {
  risicoVoorBatch, beoordeelCcp1, bouwVrijgave, actueleVrijgave, maakParaaf,
  bouwAfwijking, capaUitAfwijking, haccpInst,
} from '../../utils/haccp'
import type { BlokkadeReden } from '../../utils/haccp'
import type { HaccpVrijgave } from '../../types'

// CCP 1 — vrijgave voor afvullen.
//
// Eén regel voor elk bier: de forceertest, en twee tankmetingen met genoeg tijd
// ertussen (utils/haccp.ts, beoordeelCcp1). De kaart rekent alles zelf uit de
// metingen van de batch; de brouwer legt alleen de forceertest vast (of een
// nieuwe tankmeting) en tikt op Vrijgeven. Klopt iets niet, dan kan het alleen
// met een afwijking — nooit onzichtbaar.

interface Props {
  batch: any
  bi: any[]
  ing: any[]
  /** De lots: een batchregel met een lot hoort bij het ingrediënt van dat lot. */
  lots?: any[]
  gistMetingen: any[]
  setGistMetingen: (fn: any) => void
  /** Schrijft velden op de batch (forceertest). */
  updateBatch: (patch: any) => void
  vrijgaven: HaccpVrijgave[]
  setVrijgaven: (fn: any) => void
  capa: any[]
  setCapa: (fn: any) => void
  afwijkingen: any[]
  setAfwijkingen: (fn: any) => void
  haccpInstellingen: any
  whoami: {gebruiker?: string; rol?: string} | null
  auditLog: any[]
  setAuditLog: (fn: any) => void
}

const nuOp = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${tod()}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const leesSg = (v: string): number | null => {
  const n = Number(String(v || '').trim().replace(',', '.'))
  return isFinite(n) && n > 0.9 && n < 1.2 ? Math.round(n * 10000) / 10000 : null
}

// Eén regel van de kaart: wat, de waarde, en of hij klopt.
const Regel: React.FC<{
  label: string
  ok: boolean | null
  children: React.ReactNode
  actie?: React.ReactNode
}> = ({label, ok, children, actie}) => (
  <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
    <span aria-hidden="true" className={`w-5 shrink-0 text-center font-semibold ${
      ok === true ? 'text-green-600' : ok === false ? 'text-red-600' : 'text-gray-400'}`}>
      {ok === true ? '✓' : ok === false ? '✕' : '·'}
    </span>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-gray-800">{label}</div>
      <div className="text-sm text-gray-600 break-words">{children}</div>
    </div>
    {actie && <div className="shrink-0">{actie}</div>}
  </div>
)

const VrijgaveSectie: React.FC<Props> = ({
  batch, bi, ing, lots, gistMetingen, setGistMetingen, updateBatch,
  vrijgaven, setVrijgaven, capa, setCapa, afwijkingen, setAfwijkingen,
  haccpInstellingen, whoami, auditLog, setAuditLog,
}) => {
  const inst = haccpInst(haccpInstellingen)
  const bestaand = actueleVrijgave(vrijgaven || [], batch?.id)
  const [herbeoordelen, setHerbeoordelen] = React.useState(false)
  const [afwijkingOpen, setAfwijkingOpen] = React.useState(false)
  const [ffInvoer, setFfInvoer] = React.useState<string | null>(null)
  const [tankInvoer, setTankInvoer] = React.useState('')
  const [opmerking, setOpmerking] = React.useState('')

  const eigenMetingen = React.useMemo(
    () => (gistMetingen || []).filter((m: any) => m.batch_id === batch?.id),
    [gistMetingen, batch?.id])

  const b = React.useMemo(
    () => beoordeelCcp1({ff_sg: batch?.ff_sg, metingen: eigenMetingen}, inst),
    [batch?.ff_sg, eigenMetingen, haccpInstellingen])

  // Toevoegingen na de kook (fruit, puree, hout): daarna hoort er een nieuwe
  // forceertest bij. Alleen een aanwijzing; de app kent het moment van de
  // toevoeging niet.
  const toevoegingen = React.useMemo(() => {
    const r = risicoVoorBatch(batch, bi || [], ing || [], inst, lots)
    return [...r.ongekookt, ...r.gepasteuriseerd].filter(Boolean)
  }, [batch, bi, ing, lots, haccpInstellingen])

  // ── Vastleggen ───────────────────────────────────────────────────────────
  const slaFfOp = () => {
    const sg = leesSg(ffInvoer || '')
    if (sg == null) return
    updateBatch({ff_sg: sg, ff_op: nuOp()})
    setFfInvoer(null)
  }

  const slaTankOp = () => {
    const sg = leesSg(tankInvoer)
    if (sg == null || !batch) return
    const [datum, tijd] = nuOp().split('T')
    const id = newId(gistMetingen || [])
    setGistMetingen((prev: any[]) => [...(prev || []), {id, batch_id: batch.id, datum, tijd, sg, opmerking: ''}])
    logAudit(auditLog, setAuditLog, {entiteit: 'Gistmeting', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `Batch ${batch?.naam || ''}: SG=${sg} (CCP 1)`})
    setTankInvoer('')
  }

  const schrijfVrijgave = (id: number, afwijkingId?: number) => {
    const record = bouwVrijgave(id, batch.id, b, maakParaaf(whoami), {
      vervangt_id: bestaand?.id, afwijking_id: afwijkingId, opmerking,
    })
    setVrijgaven((prev: HaccpVrijgave[]) => [...(prev || []), record])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'HaccpVrijgave', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${batch?.naam || ''}: ${t('haccp_ccp1_vrijgegeven')}`,
    })
    setHerbeoordelen(false)
    setOpmerking('')
  }

  const blokkade = {toegestaan: false, redenen: b.redenen}

  const bevestigAfwijking = (onderbouwing: string) => {
    const paraaf = maakParaaf(whoami)
    const afwId = newId(afwijkingen || [])
    const afwijking = bouwAfwijking(
      afwId, 'ccp1_vrijgave', blokkade, {batch_id: batch.id},
      onderbouwing, blokkadeSamenvatting(blokkade), paraaf)
    if (!afwijking) return
    const capaId = newId(capa || [])
    const vrijgaveId = newId(vrijgaven || [])
    setAfwijkingen((prev: any[]) => [...(prev || []), {...afwijking, capa_id: capaId}])
    setCapa((prev: any[]) => [...(prev || []),
      {...capaUitAfwijking(afwijking, capaId), vrijgave_id: vrijgaveId, bron: 'ccp1'}])
    setAfwijkingOpen(false)
    schrijfVrijgave(vrijgaveId, afwId)
  }

  // ── Bestaande vrijgave (samenvatting) ────────────────────────────────────
  const vrij = bestaand?.oordeel === 'vrijgegeven'
  if (bestaand && vrij && !herbeoordelen) {
    const nieuw = bestaand.methode === 'ff_paar'
    return (
      <div className="rounded-lg border border-gray-200 p-3 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
              {t('haccp_ccp1_vrijgegeven')}
            </span>
            {bestaand.afwijking_id != null && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                {t('haccp_afw_kort')}
              </span>
            )}
          </div>
          <Btn s="sm" v="secondary" onClick={() => setHerbeoordelen(true)}>
            {t('haccp_ccp1_opnieuw')}
          </Btn>
        </div>
        <div className="mt-2 text-xs text-gray-600 space-y-0.5">
          {bestaand.ff_dichtheid_ff != null && (
            <div>
              {t('haccp_ccp1_ff')}: {fmtSg(bestaand.ff_dichtheid_ff)}
              {bestaand.ff_dichtheid_tank != null && (
                <> · {t('haccp_ccp1_tank')}: {fmtSg(bestaand.ff_dichtheid_tank)}</>
              )}
            </div>
          )}
          {nieuw && bestaand.tank_sg_1 != null && (
            <div>
              {t('haccp_ccp1_stabiel')}: {fmtSg(bestaand.tank_sg_1)} → {fmtSg(bestaand.tank_sg_2)}
              {' · '}{t('haccp_ccp1_na_uur').replace('{n}', String(bestaand.stabiel_uren ?? ''))}
            </div>
          )}
          {!nieuw && bestaand.dagen_stabiel != null && (
            <div>
              {t('haccp_ccp1_stabiel')}: {bestaand.dagen_stabiel}/{bestaand.vereiste_dagen_stabiel} {t('haccp_ccp1_dagen')}
            </div>
          )}
          {(bestaand.opmerking || bestaand.sensorisch) && (
            <div className="italic">{bestaand.opmerking || bestaand.sensorisch}</div>
          )}
          <div className="text-gray-500">
            {t('haccp_ccp1_paraaf')}: {bestaand.paraaf?.gebruiker || '—'}{' · '}{fmtD(bestaand.datum)}
          </div>
        </div>
      </div>
    )
  }

  // ── De kaart ─────────────────────────────────────────────────────────────
  const reden = (code: string): BlokkadeReden | undefined => b.redenen.find(r => r.code === code)
  const ffBewerken = ffInvoer !== null || b.ff_sg == null
  const ffBoven = b.ff_verschil != null && b.ff_verschil > 0
  const kanVrijgeven = b.redenen.length === 0

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white px-3">
        {/* 1. Forceertest */}
        <Regel label={t('haccp_ccp1_ff')} ok={b.ff_sg != null ? true : null}
          actie={!ffBewerken && (
            <Btn s="sm" v="ghost" onClick={() => setFfInvoer(String(b.ff_sg ?? ''))}>
              {t('btn_edit')}
            </Btn>
          )}>
          {ffBewerken ? (
            <div className="flex items-end gap-2 mt-1">
              <Inp cls="w-32" type="number" step="0.001" ariaLabel={t('haccp_ccp1_ff_sg')}
                value={ffInvoer ?? ''} onChange={v => setFfInvoer(v)} />
              <Btn s="sm" disabled={leesSg(ffInvoer || '') == null} onClick={slaFfOp}>
                {t('btn_save')}
              </Btn>
              {ffInvoer !== null && b.ff_sg != null && (
                <Btn s="sm" v="ghost" onClick={() => setFfInvoer(null)}>{t('btn_cancel')}</Btn>
              )}
            </div>
          ) : (
            <>
              {fmtSg(b.ff_sg)}
              {batch?.ff_op && <span className="text-gray-500"> · {fmtDagMaand(batch.ff_op, {tijd: true})}</span>}
            </>
          )}
          {ffBewerken && <div className="text-xs text-gray-500 mt-1">{t('haccp_ccp1_ff_uitleg')}</div>}
        </Regel>

        {/* 2. Tank tegen de forceertest */}
        <Regel label={t('haccp_ccp1_tank')} ok={b.tank && b.ff_sg != null ? b.ff_ok : null}>
          {b.tank ? (
            <>
              {fmtSg(b.tank.sg)}
              <span className="text-gray-500"> · {fmtDagMaand(b.tank.op, {tijd: true})}</span>
              {b.ff_verschil != null && (
                <span className={b.ff_ok ? 'text-gray-500' : 'text-red-600 font-medium'}>
                  {' · '}
                  {t(ffBoven ? 'haccp_ccp1_boven_test' : 'haccp_ccp1_niet_boven_test')
                    .replace('{verschil}', Math.abs(b.ff_verschil).toFixed(3))
                    .replace('{marge}', b.ff_marge.toFixed(3))}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-500">{t('haccp_blok_tank_ontbreekt')}</span>
          )}
        </Regel>

        {/* 3. Stabiel: twee metingen met genoeg tijd ertussen */}
        <Regel label={t('haccp_ccp1_stabiel')} ok={b.paar ? b.stabiel_ok : null}>
          {b.paar ? (
            <>
              {fmtSg(b.paar.eerste.sg)} <span className="text-gray-500">({fmtDagMaand(b.paar.eerste.op, {tijd: true})})</span>
              {' → '}
              {fmtSg(b.paar.laatste.sg)} <span className="text-gray-500">({fmtDagMaand(b.paar.laatste.op, {tijd: true})})</span>
              <span className={b.stabiel_ok ? 'text-gray-500' : 'text-red-600 font-medium'}>
                {' · '}{t('haccp_ccp1_na_uur').replace('{n}', String(b.paar.uren))}
                {' · '}{t('haccp_ccp1_verschil')} {b.paar.verschil.toFixed(3)}
              </span>
              {!b.stabiel_ok && b.volgende_meting_op && (
                <div className="text-sm text-gray-800 mt-0.5">
                  {blokkadeTekst({code: 'tweede_meting', i18nKey: 'haccp_blok_tweede_meting',
                    params: {uur: b.stabiel_min_uur, moment: fmtDagMaand(b.volgende_meting_op, {tijd: true})}})}
                </div>
              )}
            </>
          ) : (
            <span className="text-gray-500">
              {blokkadeTekst(reden('tweede_meting') || reden('tank_ontbreekt')
                || {code: '', i18nKey: 'haccp_blok_tank_ontbreekt'})}
            </span>
          )}
          <div className="text-xs text-gray-500 mt-0.5">
            {t('haccp_ccp1_regel')
              .replace('{uur}', String(b.stabiel_min_uur))
              .replace('{tolerantie}', b.stabiel_tolerantie.toFixed(3))}
          </div>
        </Regel>
      </div>

      {/* Een tankmeting vastleggen zonder de kaart te verlaten */}
      <div className="flex items-end gap-2">
        <Inp cls="w-40" type="number" step="0.001" label={t('haccp_ccp1_tank_meten')}
          value={tankInvoer} onChange={setTankInvoer} />
        <Btn s="sm" v="secondary" disabled={leesSg(tankInvoer) == null} onClick={slaTankOp}>
          {t('btn_save')}
        </Btn>
      </div>

      {toevoegingen.length > 0 && (
        <div className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded p-2">
          {t('haccp_ccp1_toevoeging').replace('{namen}', toevoegingen.join(', '))}
        </div>
      )}

      <Inp label={t('haccp_ccp1_opmerking')} value={opmerking} onChange={setOpmerking} />

      <div className="flex items-start justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-500">
          {t('haccp_ccp1_paraaf')}: {whoami?.gebruiker || '—'} ({t('haccp_ccp1_automatisch_kort')})
        </span>
        <div className="flex items-start gap-2">
          {herbeoordelen && (
            <Btn v="secondary" s="sm" onClick={() => setHerbeoordelen(false)}>{t('btn_cancel')}</Btn>
          )}
          <Btn s="sm" disabled={!kanVrijgeven} reden={kanVrijgeven ? undefined : blokkadeTekst(b.redenen[0])}
            onClick={() => kanVrijgeven && schrijfVrijgave(newId(vrijgaven || []))}>
            {t('haccp_ccp1_vrijgeven')}
          </Btn>
        </div>
      </div>

      {!kanVrijgeven && (
        <button onClick={() => setAfwijkingOpen(true)}
          className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900">
          {t('haccp_ccp1_toch')}
        </button>
      )}

      {afwijkingOpen && (
        <AfwijkingModal
          blok={blokkade}
          titel={t('haccp_ccp1_titel')}
          onBevestig={bevestigAfwijking}
          onClose={() => setAfwijkingOpen(false)}
        />
      )}
    </div>
  )
}

export default VrijgaveSectie
