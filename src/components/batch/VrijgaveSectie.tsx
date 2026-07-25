import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import BlokkadeKaart, { blokkadeSamenvatting } from '../haccp/BlokkadeKaart'
import AfwijkingModal from '../haccp/AfwijkingModal'
import {
  risicoVoorBatch, vereisteStabiliteitsdagen, dagenStabiel, beoordeelVrijgave,
  actueleVrijgave, maakParaaf, bouwAfwijking, capaUitAfwijking, haccpInst,
} from '../../utils/haccp'
import type { HaccpVrijgave } from '../../types'

// CCP 1 — vrijgave voor afvullen.
//
// Het belangrijkste formulier van het systeem: zodra het bier in een gesloten
// verpakking zit is er geen stap meer die nagisting kan tegenhouden. De
// bovenste kaart is volledig read-only en laat zien waar elke afleiding
// vandaan komt; de brouwer hoeft niet te onthouden welk regime geldt.

interface Props {
  batch: any
  bi: any[]
  ing: any[]
  gistMetingen: any[]
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

const VrijgaveSectie: React.FC<Props> = ({
  batch, bi, ing, gistMetingen, vrijgaven, setVrijgaven, capa, setCapa,
  afwijkingen, setAfwijkingen, haccpInstellingen, whoami, auditLog, setAuditLog,
}) => {
  const inst = haccpInst(haccpInstellingen)
  const bestaand = actueleVrijgave(vrijgaven || [], batch?.id)
  const [herbeoordelen, setHerbeoordelen] = React.useState(false)
  const [afwijkingOpen, setAfwijkingOpen] = React.useState(false)

  const risico = React.useMemo(
    () => risicoVoorBatch(batch, bi || [], ing || [], inst),
    [batch, bi, ing, haccpInstellingen])

  const eigenMetingen = React.useMemo(
    () => (gistMetingen || []).filter((m: any) => m.batch_id === batch?.id),
    [gistMetingen, batch])

  const dagen = React.useMemo(() => dagenStabiel(eigenMetingen, inst), [eigenMetingen, inst])
  const vereist = vereisteStabiliteitsdagen(risico.klasse, inst)
  const verhoogd = risico.klasse === 'verhoogd'

  const [form, setForm] = React.useState({
    ff_uitgevoerd: false,
    ff_dichtheid_tank: '',
    ff_dichtheid_ff: '',
    druk30_uitgevoerd: false,
    druk30_ok: true,
    druk30_waarneming: '',
    sensorisch: '',
    oordeel: '' as '' | 'vrijgegeven' | 'niet_vrijgegeven',
    herbeoordeling_datum: '',
    opmerking: '',
  })

  const beoordeling = React.useMemo(() => beoordeelVrijgave({
    risico_klasse: risico.klasse,
    dagen_stabiel: dagen,
    ff_uitgevoerd: form.ff_uitgevoerd,
    ff_dichtheid_tank: form.ff_dichtheid_tank,
    ff_dichtheid_ff: form.ff_dichtheid_ff,
    druk30_uitgevoerd: form.druk30_uitgevoerd,
    druk30_ok: form.druk30_ok,
    sensorisch: form.sensorisch,
  }, inst), [risico.klasse, dagen, form, inst])

  // Het oordeel staat voorgevuld op wat het systeem voorstelt; de brouwer kan
  // het omzetten, maar naar 'vrijgegeven' alleen via een afwijking.
  const gekozenOordeel = form.oordeel || beoordeling.oordeel
  const wijktAf = gekozenOordeel === 'vrijgegeven' && beoordeling.oordeel === 'niet_vrijgegeven'
  const kanOpslaan = beoordeling.onvolledig.length === 0
  const blokkade = {toegestaan: false, redenen: beoordeling.redenen}

  const toonFormulier = !bestaand || herbeoordelen

  const schrijfVrijgave = (id: number, afwijkingId?: number) => {
    const paraaf = maakParaaf(whoami)
    const tank = Number(form.ff_dichtheid_tank)
    const ff = Number(form.ff_dichtheid_ff)
    const record: HaccpVrijgave = {
      id,
      batch_id: batch.id,
      datum: tod(),
      risico_klasse: risico.klasse,
      risico_redenen: risico.ongekookt,
      vereiste_dagen_stabiel: vereist,
      dagen_stabiel: dagen,
      stabiel_ok: beoordeling.stabiel_ok,
      ff_uitgevoerd: form.ff_uitgevoerd,
      ff_dichtheid_tank: isFinite(tank) && tank > 0 ? tank : undefined,
      ff_dichtheid_ff: isFinite(ff) && ff > 0 ? ff : undefined,
      ff_verschil: beoordeling.ff_verschil ?? undefined,
      ff_marge: beoordeling.ff_marge,
      ff_ok: beoordeling.ff_ok,
      druk30_uitgevoerd: verhoogd ? form.druk30_uitgevoerd : undefined,
      druk30_waarneming: verhoogd ? (form.druk30_waarneming || undefined) : undefined,
      druk30_ok: verhoogd ? beoordeling.druk30_ok : undefined,
      sensorisch: form.sensorisch.trim(),
      sensorisch_ok: beoordeling.sensorisch_ok,
      oordeel: gekozenOordeel as HaccpVrijgave['oordeel'],
      oordeel_voorgesteld: beoordeling.oordeel,
      afwijking_id: afwijkingId,
      herbeoordeling_datum: gekozenOordeel === 'niet_vrijgegeven'
        ? (form.herbeoordeling_datum || herbeoordelingVoorstel())
        : undefined,
      vervangt_id: bestaand?.id,
      opmerking: form.opmerking || undefined,
      paraaf,
    }
    setVrijgaven((prev: HaccpVrijgave[]) => [...(prev || []), record])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'HaccpVrijgave', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${batch?.naam || ''}: ${t(gekozenOordeel === 'vrijgegeven'
        ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven')}`,
    })
    setHerbeoordelen(false)
    setForm(f => ({...f, oordeel: ''}))
  }

  // Bij een afkeuring plant het systeem zelf de herbeoordeling in op de dag
  // dat de vereiste stabiliteitsperiode alsnog gehaald kan zijn.
  const herbeoordelingVoorstel = (): string => {
    const resterend = Math.max(1, vereist - dagen)
    const d = new Date()
    d.setDate(d.getDate() + resterend)
    return d.toISOString().slice(0, 10)
  }

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

  const opslaan = () => {
    if (!kanOpslaan) return
    if (wijktAf) { setAfwijkingOpen(true); return }
    schrijfVrijgave(newId(vrijgaven || []))
  }

  // ── Bestaande vrijgave (samenvatting) ────────────────────────────────────
  if (!toonFormulier && bestaand) {
    const vrij = bestaand.oordeel === 'vrijgegeven'
    return (
      <div className="space-y-2">
        <div className={`rounded-lg border-l-4 p-3 bg-white shadow-sm ${
          vrij ? 'border-green-500' : 'border-red-500'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                vrij ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {t(vrij ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven')}
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
            <div>
              {t('haccp_ccp1_producttype')}: {t(bestaand.risico_klasse === 'verhoogd'
                ? 'haccp_risico_verhoogd' : 'haccp_risico_standaard')}
              {' · '}{t('haccp_ccp1_stabiel')}: {bestaand.dagen_stabiel}/{bestaand.vereiste_dagen_stabiel} {t('haccp_ccp1_dagen')}
            </div>
            {bestaand.ff_verschil != null && (
              <div>
                {t('haccp_ccp1_ff')}: {t('haccp_ccp1_verschil')} {bestaand.ff_verschil.toFixed(3)}
              </div>
            )}
            {bestaand.sensorisch && <div className="italic">{bestaand.sensorisch}</div>}
            {bestaand.herbeoordeling_datum && (
              <div>{t('haccp_ccp1_herbeoordeling')}: {fmtD(bestaand.herbeoordeling_datum)}</div>
            )}
            <div className="text-gray-400">
              {t('haccp_ccp1_paraaf')}: {bestaand.paraaf?.gebruiker || '—'}
              {' · '}{fmtD(bestaand.datum)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulier ────────────────────────────────────────────────────────────
  const Rij = ({label, waarde, ok}: {label: string, waarde: React.ReactNode, ok?: boolean}) => (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={ok === false ? 'text-red-600 font-medium' : 'text-gray-800'}>{waarde}</span>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Automatisch afgeleid — read-only, met de herkomst erbij */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {t('haccp_ccp1_automatisch')}
        </div>
        <Rij
          label={t('haccp_ccp1_producttype')}
          waarde={
            <>
              {t(verhoogd ? 'haccp_risico_verhoogd' : 'haccp_risico_standaard')}
              {risico.ongekookt.length > 0 && (
                <span className="text-gray-400 ml-1">
                  ({t('haccp_risico_door')} {risico.ongekookt.join(', ')})
                </span>
              )}
              {risico.handmatig && (
                <span className="text-gray-400 ml-1">({t('haccp_risico_handmatig')})</span>
              )}
            </>
          }
        />
        <Rij label={t('haccp_ccp1_vereist')} waarde={`${vereist} ${t('haccp_ccp1_dagen')}`} />
        <Rij
          label={t('haccp_ccp1_stabiel')}
          ok={beoordeling.stabiel_ok}
          waarde={
            <>
              {dagen} {t('haccp_ccp1_dagen')}
              {!beoordeling.stabiel_ok && (
                <span className="ml-1">
                  · {t('haccp_ccp1_nog_dagen').replace('{n}', String(Math.max(0, vereist - dagen)))}
                </span>
              )}
            </>
          }
        />
        {eigenMetingen.length < 2 && (
          <div className="text-xs text-gray-500 italic pt-1">
            {t('haccp_ccp1_metingen_ontbreken')}
          </div>
        )}
      </div>

      {/* Forced fermentation */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="t-checkbox" checked={form.ff_uitgevoerd}
            onChange={e => setForm({...form, ff_uitgevoerd: e.target.checked})} />
          {t('haccp_ccp1_ff')} — {t('haccp_ccp1_ff_uitgevoerd')}
        </label>
        {form.ff_uitgevoerd && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Inp label={t('haccp_ccp1_dichtheid_tank')} type="number" step="0.001"
                value={form.ff_dichtheid_tank}
                onChange={v => setForm({...form, ff_dichtheid_tank: v})} req />
              <Inp label={t('haccp_ccp1_dichtheid_ff')} type="number" step="0.001"
                value={form.ff_dichtheid_ff}
                onChange={v => setForm({...form, ff_dichtheid_ff: v})} req />
            </div>
            {beoordeling.ff_verschil != null && (
              <div className={`text-xs ${beoordeling.ff_ok ? 'text-gray-500' : 'text-red-600 font-medium'}`}>
                {t('haccp_ccp1_verschil')}: {beoordeling.ff_verschil.toFixed(3)}
                {' · '}
                {beoordeling.ff_ok
                  ? t('haccp_ccp1_binnen_marge').replace('{marge}', beoordeling.ff_marge.toFixed(3))
                  : t('haccp_blok_ff_buiten_marge')
                      .replace('{verschil}', beoordeling.ff_verschil.toFixed(3))
                      .replace('{marge}', beoordeling.ff_marge.toFixed(3))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Drukcontrole — alleen bij vers fruit, hout of ongekookte adjunct */}
      {verhoogd && (
        <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={form.druk30_uitgevoerd}
              onChange={e => setForm({...form, druk30_uitgevoerd: e.target.checked})} />
            {t('haccp_ccp1_druk30')}
          </label>
          {form.druk30_uitgevoerd && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="t-checkbox" checked={form.druk30_ok}
                  onChange={e => setForm({...form, druk30_ok: e.target.checked})} />
                {t('haccp_ccp1_druk30_geen_druk')}
              </label>
              <Inp label={t('haccp_ccp1_druk30_waarneming')} value={form.druk30_waarneming}
                onChange={v => setForm({...form, druk30_waarneming: v})} />
            </>
          )}
        </div>
      )}

      {/* Sensorisch — volgt op de stabiliteitsbeoordeling, niet andersom */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {t('haccp_ccp1_sensorisch')}<span className="text-red-500 ml-0.5">*</span>
        </label>
        <textarea value={form.sensorisch} rows={2}
          onChange={e => setForm({...form, sensorisch: e.target.value})}
          placeholder={t('haccp_ccp1_sensorisch_ph')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm placeholder-gray-300" />
      </div>

      {/* Voorgesteld oordeel */}
      <div className="rounded-lg border border-gray-200 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {t('haccp_ccp1_voorgesteld')}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            beoordeling.oordeel === 'vrijgegeven'
              ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {t(beoordeling.oordeel === 'vrijgegeven'
              ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven')}
          </span>
        </div>
        {beoordeling.redenen.length > 0 && <BlokkadeKaart blok={blokkade} compact />}

        <div className="flex flex-wrap gap-3 pt-1">
          {(['niet_vrijgegeven', 'vrijgegeven'] as const).map(o => (
            <label key={o} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input type="radio" name="haccp_oordeel" checked={gekozenOordeel === o}
                onChange={() => setForm({...form, oordeel: o})} />
              {t(o === 'vrijgegeven' ? 'haccp_ccp1_vrijgegeven' : 'haccp_ccp1_niet_vrijgegeven')}
            </label>
          ))}
        </div>

        {gekozenOordeel === 'niet_vrijgegeven' && (
          <Inp label={t('haccp_ccp1_herbeoordeling')} type="date"
            value={form.herbeoordeling_datum || herbeoordelingVoorstel()}
            onChange={v => setForm({...form, herbeoordeling_datum: v})} />
        )}

        {wijktAf && (
          <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
            {t('haccp_afw_waarschuwing')}
          </div>
        )}
      </div>

      {beoordeling.onvolledig.length > 0 && (
        <BlokkadeKaart blok={{toegestaan: false, redenen: beoordeling.onvolledig}} compact />
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-400">
          {t('haccp_ccp1_paraaf')}: {whoami?.gebruiker || '—'} ({t('haccp_ccp1_automatisch_kort')})
        </span>
        <div className="flex gap-2">
          {herbeoordelen && (
            <Btn v="secondary" s="sm" onClick={() => setHerbeoordelen(false)}>
              {t('btn_cancel')}
            </Btn>
          )}
          <Btn s="sm" disabled={!kanOpslaan} onClick={opslaan}>
            {t('haccp_ccp1_vastleggen')}
          </Btn>
        </div>
      </div>

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
