import React from 'react'
import { t } from '../../i18n'
import Blad from '../ui/Blad'
import Btn from '../ui/Btn'
import BevestigKnop from '../ui/BevestigKnop'
import Inp from '../ui/Inp'
import Segment from '../ui/Segment'
import SectionHeader from '../ui/SectionHeader'
import { toonMelding } from '../ui/AppMelding'
import { fmtDagMaand } from '../../utils/format'
import {
  INCIDENT_GEVAREN, NVWA_MELD_URL, NVWA_TELEFOON, NVWA_TERMIJN_UUR, nvwaStand, duurTekst, waarschuwingMail,
  waarschuwingMailto, incidentStappen, afsluitBlokkade, type IncidentInvoer,
} from '../../utils/incident'
import type { TraceResultaat } from '../../utils/trace'
import type { AfvulSessie, HaccpIncident, IncidentBron, IncidentGevaar, IncidentSoort } from '../../types'

// "Er is iets mis" (utils/incident.ts, procedure "Traceerbaarheid, klachten
// en terugroepen" uit het plan). Het blad legt de klacht vast; bij veiligheid
// blokkeert het in dezelfde handeling de voorraad en start de klok. De kaart
// zet daarna de stappen onder elkaar, met de klok "NVWA binnen 4 uur".

const BRONNEN: IncidentBron[] = ['klant', 'eigen', 'leverancier', 'anders']

const TEKSTVAK = 'w-full border border-gray-300 rounded px-3 py-2 text-sm t-input'

/** ISO ↔ `datetime-local` (lokale tijd, op de minuut). */
const naarLokaal = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const vanLokaal = (v: string): string => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}
const uur = (iso?: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const Veld: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode; hint?: string }> = ({ label, htmlFor, children, hint }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
)

// ── Het blad ────────────────────────────────────────────────────────────────

interface IncidentBladProps {
  batchId: number
  /** De afvulsessies van deze batch (de lotcodes). */
  sessies: AfvulSessie[]
  klanten?: Array<{ id: number; naam?: string }>
  onSluit: () => void
  onVastleggen: (invoer: IncidentInvoer, extra: { oorzaak: string }) => void
}

export const IncidentBlad: React.FC<IncidentBladProps> = ({ batchId, sessies, klanten, onSluit, onVastleggen }) => {
  const [omschrijving, setOmschrijving] = React.useState('')
  const [gekozen, setGekozen] = React.useState<number[]>(() => sessies.map(s => s.id))
  const [bron, setBron] = React.useState<IncidentBron>('klant')
  const [melder, setMelder] = React.useState('')
  const [ontdekt, setOntdekt] = React.useState(() => naarLokaal(new Date().toISOString()))
  const [soort, setSoort] = React.useState<IncidentSoort | ''>('')
  const [gevaar, setGevaar] = React.useState<IncidentGevaar | ''>('')
  const [bewaarfles, setBewaarfles] = React.useState('')
  const [afhandeling, setAfhandeling] = React.useState('')
  const [oorzaak, setOorzaak] = React.useState('')
  const [fout, setFout] = React.useState('')

  const lotcodes = sessies.filter(s => gekozen.includes(s.id)).map(s => s.lotcode)
  const ontdektIso = vanLokaal(ontdekt)
  const uiterlijk = ontdektIso ? uur(new Date(Date.parse(ontdektIso) + NVWA_TERMIJN_UUR * 3600_000).toISOString()) : ''

  const vastleggen = () => {
    if (!omschrijving.trim()) { setFout(t('incident_fout_omschrijving')); return }
    if (!soort) { setFout(t('incident_fout_soort')); return }
    if (soort === 'veiligheid' && !gevaar) { setFout(t('incident_fout_gevaar')); return }
    if (!ontdektIso) { setFout(t('incident_fout_tijd')); return }
    if (sessies.length && !gekozen.length) { setFout(t('incident_fout_lotcode')); return }
    const klant = bron === 'klant'
      ? (klanten || []).find(k => (k.naam || '').trim().toLowerCase() === melder.trim().toLowerCase()) : undefined
    onVastleggen({
      batch_id: batchId, sessie_ids: gekozen, lotcodes, soort, bron, melder,
      ...(klant ? { klant_id: klant.id } : {}),
      ...(soort === 'veiligheid' ? { gevaar: gevaar as IncidentGevaar } : { bewaarfles, afhandeling }),
      omschrijving, ontdekt_op: ontdektIso,
    }, { oorzaak })
  }

  const kaart = (v: IncidentSoort) => (
    <button key={v} type="button" role="radio" aria-checked={soort === v} onClick={() => { setSoort(v); setFout('') }}
      className={`text-left rounded-lg border p-3 min-h-tap ${soort === v
        ? (v === 'veiligheid' ? 'border-red-400 bg-red-50' : 'border-[var(--t-accent)] t-panel')
        : 'border-gray-300 bg-white hover:bg-gray-50'}`}>
      <div className="text-sm font-semibold text-gray-800">{t(`incident_soort_${v}`)}</div>
      <div className="text-xs text-gray-600 mt-0.5">{t(`incident_soort_${v}_uitleg`)}</div>
    </button>
  )

  const klaarLabel = soort === 'veiligheid' ? t('incident_btn_blokkeren')
    : soort === 'kwaliteit' ? t('incident_btn_klacht') : t('incident_btn_vastleggen')

  return (
    <Blad titel={t('incident_titel')} onSluit={onSluit} onKlaar={vastleggen} klaarLabel={klaarLabel}>
      <div className="space-y-4">
        <Veld label={t('incident_wat')} htmlFor="incident-wat">
          <textarea id="incident-wat" rows={3} value={omschrijving} className={TEKSTVAK}
            placeholder={t('incident_wat_ph')} onChange={e => { setOmschrijving(e.target.value); setFout('') }} />
        </Veld>

        {sessies.length > 0 && (
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1">{t('incident_lotcodes')}</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('incident_lotcodes')}>
              {sessies.map(s => {
                const aan = gekozen.includes(s.id)
                return (
                  <button key={s.id} type="button" aria-pressed={aan}
                    onClick={() => setGekozen(g => aan ? g.filter(x => x !== s.id) : [...g, s.id])}
                    className={`px-3 min-h-tap sm:min-h-[36px] rounded-full text-sm border font-mono ${aan
                      ? 'border-[var(--t-accent)] t-panel font-semibold' : 'border-gray-300 bg-white text-gray-600'}`}>
                    {s.lotcode}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1">{t('incident_bron')}</div>
            <Segment<IncidentBron> waarde={bron} label={t('incident_bron')} onKies={setBron} klein
              opties={BRONNEN.map(v => ({ v, l: t(`incident_bron_${v}`) }))} />
          </div>
          {bron !== 'eigen' && (
            <Inp label={t('incident_melder')} value={melder} onChange={setMelder}
              list={bron === 'klant' ? 'incident-klanten' : undefined} />
          )}
          {bron === 'klant' && (
            <datalist id="incident-klanten">
              {(klanten || []).map(k => k.naam ? <option key={k.id} value={k.naam} /> : null)}
            </datalist>
          )}
        </div>
        <Inp label={t('incident_wanneer')} type="datetime-local" value={ontdekt} onChange={setOntdekt} />

        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">{t('incident_soort')}</div>
          <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('incident_soort')}>
            {kaart('kwaliteit')}
            {kaart('veiligheid')}
          </div>
          <p className="text-xs text-gray-500 mt-1">{t('incident_soort_twijfel')}</p>
        </div>

        {soort === 'veiligheid' && (
          <>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">{t('incident_gevaar')}</div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('incident_gevaar')}>
                {INCIDENT_GEVAREN.map(g => (
                  <button key={g} type="button" role="radio" aria-checked={gevaar === g} onClick={() => { setGevaar(g); setFout('') }}
                    className={`px-3 min-h-tap sm:min-h-[36px] rounded-full text-sm border ${gevaar === g
                      ? 'border-red-400 bg-red-50 text-red-800 font-semibold' : 'border-gray-300 bg-white text-gray-700'}`}>
                    {t(`incident_gevaar_${g}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1">
              <div className="font-semibold">{t('incident_bij_vastleggen')}</div>
              <div>{lotcodes.length
                ? t('incident_bij_blokkeren').replace('{lotcodes}', lotcodes.join(', '))
                : t('incident_bij_blokkeren_batch')}</div>
              {uiterlijk && <div>{t('incident_bij_klok').replace('{tijd}', uiterlijk)}</div>}
            </div>
          </>
        )}

        {soort === 'kwaliteit' && (
          <>
            <Inp label={t('incident_bewaarfles')} value={bewaarfles} onChange={setBewaarfles} placeholder={t('incident_bewaarfles_ph')} />
            <Inp label={t('incident_afhandeling')} value={afhandeling} onChange={setAfhandeling} placeholder={t('incident_afhandeling_ph')} />
            <Inp label={t('incident_oorzaak')} value={oorzaak} onChange={setOorzaak} />
          </>
        )}

        {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
      </div>
    </Blad>
  )
}

// ── De kaart van een open veiligheidsincident ───────────────────────────────

interface IncidentKaartProps {
  inc: HaccpIncident
  trace: TraceResultaat
  bier: string
  /** De THT's van de lotcodes, al opgemaakt. */
  tht: string[]
  brouwerij: { naam?: string; email?: string }
  onWijzig: (inc: HaccpIncident) => void
  onSluit: (invoer: { oorzaak: string; maatregel: string; onterecht: boolean }) => void
  onNaarProduct?: () => void
}

const StapKop: React.FC<{ nr: number; klaar: boolean; titel: string }> = ({ nr, klaar, titel }) => (
  <div className="flex items-center gap-2">
    <span aria-hidden className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${klaar
      ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-300 text-gray-600'}`}>{klaar ? '✓' : nr}</span>
    <span className="text-sm font-semibold text-gray-800">{titel}</span>
  </div>
)

export const IncidentKaart: React.FC<IncidentKaartProps> = ({ inc, trace, bier, tht, brouwerij, onWijzig, onSluit, onNaarProduct }) => {
  // De klok loopt mee zolang de kaart open staat.
  const [nu, setNu] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNu(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const stand = nvwaStand(inc, nu)
  const [kenmerk, setKenmerk] = React.useState('')
  const concept = React.useMemo(() => waarschuwingMail(inc, { bier, lotcodes: inc.lotcodes, tht, brouwerij: brouwerij.naam }, t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inc.id])
  const [onderwerp, setOnderwerp] = React.useState(concept.onderwerp)
  const [tekst, setTekst] = React.useState(concept.tekst)
  const [oorzaak, setOorzaak] = React.useState(inc.oorzaak || '')
  const [maatregel, setMaatregel] = React.useState(inc.maatregel || '')

  const afnemers = trace.afnemers
  const emails = afnemers.map(a => a.email || '').filter(Boolean)
  const voorraad = trace.balans.voorraad
  const anoniem = trace.balans.uitgeleverd_anoniem
  const stappen = incidentStappen(inc, { voorraad, afnemers: afnemers.length })
  const klaar = (id: string) => !!stappen.find(s => s.id === id)?.klaar
  const blokSluiten = afsluitBlokkade(inc, { oorzaak })
  const nuIso = () => new Date().toISOString()

  const kopieer = async (s: string) => {
    try { await navigator.clipboard.writeText(s); toonMelding(t('incident_gekopieerd')) }
    catch { toonMelding(t('incident_kopieren_mislukt')) }
  }

  const klok = !stand ? null : stand.stand === 'gemeld'
    ? <div className="text-sm font-semibold text-green-700">{t('incident_klok_gemeld').replace('{tijd}', uur(inc.nvwa_gemeld_op))}</div>
    : stand.stand === 'te_laat'
      ? <div className="text-base font-bold text-red-700 cijfer" role="alert">
          {t('incident_klok_te_laat').replace('{duur}', duurTekst(stand.minuten, t)).replace('{tijd}', uur(stand.uiterlijk))}
        </div>
      : <div className={`text-base font-bold cijfer ${stand.minuten < 60 ? 'text-red-700' : 'text-orange-700'}`} role="timer">
          {t('incident_klok_open').replace('{tijd}', uur(stand.uiterlijk)).replace('{duur}', duurTekst(stand.minuten, t))}
        </div>

  return (
    <section className="rounded-xl border-2 border-red-300 bg-white overflow-hidden" aria-label={t('incident_kaart_titel')}>
      <div className="bg-red-50 px-4 py-3 border-b border-red-200 space-y-1">
        <div className="text-[15px] font-semibold text-red-800">
          {t('incident_kaart_kop').replace('{gevaar}', t(`incident_gevaar_${inc.gevaar || 'anders'}`))}
          {inc.lotcodes.length > 0 && <span className="font-mono"> · {inc.lotcodes.join(', ')}</span>}
        </div>
        <div className="text-sm text-gray-700 break-words">{inc.omschrijving}</div>
        <div className="text-xs text-gray-600">
          {t('incident_kaart_ontdekt').replace('{tijd}', fmtDagMaand(inc.ontdekt_op, { tijd: true }))}
          {inc.melder ? ` · ${inc.melder}` : ''}
        </div>
        {klok}
      </div>

      <ol className="divide-y divide-gray-100">
        <li className="px-4 py-3 space-y-1">
          <StapKop nr={1} klaar={klaar('blokkeren')} titel={t('incident_stap_blokkeren')} />
          <p className="text-sm text-gray-700 pl-8">{t('incident_stap_blokkeren_tekst').replace('{tijd}', uur(inc.geblokkeerd_op))}</p>
        </li>

        <li className="px-4 py-3 space-y-2">
          <StapKop nr={2} klaar={klaar('afnemers')} titel={t('incident_stap_afnemers').replace('{n}', String(afnemers.length))} />
          <div className="pl-8 space-y-1">
            {afnemers.length === 0 && <p className="text-sm text-gray-600">{t('incident_geen_afnemers')}</p>}
            {afnemers.map(a => (
              <div key={a.naam} className="text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-gray-800 break-words min-w-0">{a.naam}</span>
                <span className="text-xs text-gray-500 cijfer">{a.aantal} · {a.lotcodes.join(', ')}</span>
                {a.telefoon && <a href={`tel:${a.telefoon.replace(/[^\d+]/g, '')}`} className="text-xs t-accent-text underline underline-offset-2 min-h-tap sm:min-h-0 inline-flex items-center">{a.telefoon}</a>}
                {a.email && <span className="text-xs text-gray-600 break-all">{a.email}</span>}
              </div>
            ))}
            {anoniem > 0 && <p className="text-xs text-gray-600">{t('incident_anoniem').replace('{n}', String(anoniem))}</p>}
          </div>
        </li>

        <li className="px-4 py-3 space-y-2">
          <StapKop nr={3} klaar={klaar('nvwa')} titel={t('incident_stap_nvwa')} />
          <div className="pl-8 space-y-2">
            {inc.nvwa_gemeld_op ? (
              <p className="text-sm text-green-700">
                {t('incident_nvwa_gemeld_op').replace('{tijd}', fmtDagMaand(inc.nvwa_gemeld_op, { tijd: true }))}
                {inc.nvwa_kenmerk ? ` · ${inc.nvwa_kenmerk}` : ''}
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-700">{t('incident_nvwa_hoe')}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <a href={NVWA_MELD_URL} target="_blank" rel="noopener noreferrer" className="t-accent-text underline underline-offset-2 min-h-tap sm:min-h-0 inline-flex items-center">{t('incident_nvwa_formulier')}</a>
                  <a href={`tel:${NVWA_TELEFOON.replace(/\s/g, '')}`} className="t-accent-text underline underline-offset-2 min-h-tap sm:min-h-0 inline-flex items-center cijfer">{NVWA_TELEFOON}</a>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[12rem]"><Inp label={t('incident_nvwa_kenmerk')} value={kenmerk} onChange={setKenmerk} /></div>
                  <Btn s="sm" onClick={() => onWijzig({ ...inc, nvwa_gemeld_op: nuIso(), ...(kenmerk.trim() ? { nvwa_kenmerk: kenmerk.trim() } : {}) })}>
                    {t('incident_nvwa_gemeld')}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </li>

        <li className="px-4 py-3 space-y-2">
          <StapKop nr={4} klaar={klaar('waarschuwen')} titel={t('incident_stap_waarschuwen')} />
          <div className="pl-8 space-y-2">
            {inc.afnemers_gewaarschuwd_op
              ? <p className="text-sm text-green-700">{t('incident_gewaarschuwd_op').replace('{tijd}', fmtDagMaand(inc.afnemers_gewaarschuwd_op, { tijd: true }))}</p>
              : <p className="text-sm text-gray-700">{t('incident_waarschuwen_hoe')}</p>}
            <Inp label={t('incident_mail_onderwerp_label')} value={onderwerp} onChange={setOnderwerp} />
            <textarea aria-label={t('incident_mail_tekst_label')} rows={8} value={tekst} onChange={e => setTekst(e.target.value)} className={TEKSTVAK} />
            <div className="flex flex-wrap items-center gap-2">
              {emails.length > 0 && (
                <a href={waarschuwingMailto(brouwerij.email || '', emails, onderwerp, tekst)}
                  className="tbtn inline-flex items-center min-h-tap sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium">
                  {t('incident_mail_openen').replace('{n}', String(new Set(emails.map(e => e.toLowerCase())).size))}
                </a>
              )}
              <Btn v="secondary" s="sm" onClick={() => { void kopieer(`${onderwerp}\n\n${tekst}`) }}>{t('incident_kopieer_tekst')}</Btn>
              {!inc.afnemers_gewaarschuwd_op && (
                <Btn v="secondary" s="sm" onClick={() => onWijzig({ ...inc, afnemers_gewaarschuwd_op: nuIso() })}>
                  {t('incident_gewaarschuwd')}
                </Btn>
              )}
            </div>
            <p className="text-xs text-gray-500">{t('incident_mail_nooit_vanzelf')}</p>
          </div>
        </li>

        <li className="px-4 py-3 space-y-2">
          <StapKop nr={5} klaar={klaar('vernietigen')} titel={t('incident_stap_vernietigen')} />
          <div className="pl-8 space-y-2">
            {voorraad > 0 ? (
              <>
                <p className="text-sm text-gray-700">{t('incident_vernietigen_tekst').replace('{n}', String(voorraad))}</p>
                {onNaarProduct && <Btn v="secondary" s="sm" onClick={onNaarProduct}>{t('incident_naar_product')}</Btn>}
              </>
            ) : <p className="text-sm text-green-700">{t('incident_vernietigen_klaar')}</p>}
          </div>
        </li>

        <li className="px-4 py-3 space-y-2">
          <StapKop nr={6} klaar={klaar('oorzaak')} titel={t('incident_stap_oorzaak')} />
          <div className="pl-8 space-y-2">
            <Veld label={t('incident_oorzaak')} htmlFor={`incident-oorzaak-${inc.id}`}>
              <textarea id={`incident-oorzaak-${inc.id}`} rows={2} value={oorzaak} onChange={e => setOorzaak(e.target.value)} className={TEKSTVAK} />
            </Veld>
            <Inp label={t('incident_maatregel')} value={maatregel} onChange={setMaatregel} />
            <p className="text-xs text-gray-500">{t('incident_plan_bijwerken')}</p>
            <div className="flex flex-wrap items-start justify-end gap-2">
              <BevestigKnop v="secondary" s="sm" vraag={t('incident_onterecht_vraag')} disabled={!oorzaak.trim()}
                title={!oorzaak.trim() ? t('incident_blok_reden_onterecht') : undefined}
                onBevestig={() => onSluit({ oorzaak, maatregel, onterecht: true })}>
                {t('incident_onterecht')}
              </BevestigKnop>
              <Btn s="sm" disabled={!!blokSluiten} reden={blokSluiten ? t(blokSluiten) : undefined}
                onClick={() => onSluit({ oorzaak, maatregel, onterecht: false })}>
                {t('incident_afsluiten')}
              </Btn>
            </div>
          </div>
        </li>
      </ol>
    </section>
  )
}

// ── Eerdere klachten en incidenten van de batch ────────────────────────────

export const IncidentLijst: React.FC<{ incidenten: HaccpIncident[] }> = ({ incidenten }) => {
  const [open, setOpen] = React.useState(false)
  if (!incidenten.length) return null
  return (
    <div>
      <SectionHeader title={t('incident_lijst_titel')} open={open} onToggle={() => setOpen(o => !o)}
        info={<span className="text-xs text-gray-500">{incidenten.length}</span>} />
      {open && (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg bg-white">
          {incidenten.slice().sort((a, b) => b.ontdekt_op.localeCompare(a.ontdekt_op)).map(i => (
            <li key={i.id} className="px-3 py-2 text-sm space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-gray-500 cijfer">{fmtDagMaand(i.ontdekt_op, { tijd: true })}</span>
                <span className={`text-xs font-medium ${i.soort === 'veiligheid' ? 'text-red-700' : 'text-gray-700'}`}>
                  {i.soort === 'veiligheid' ? t('incident_kort_veiligheid').replace('{gevaar}', t(`incident_gevaar_${i.gevaar || 'anders'}`)) : t('incident_soort_kwaliteit')}
                </span>
                {i.lotcodes.length > 0 && <span className="text-xs font-mono text-gray-500">{i.lotcodes.join(', ')}</span>}
                {i.onterecht && <span className="text-xs text-gray-500">{t('incident_was_onterecht')}</span>}
              </div>
              <div className="text-gray-800 break-words">{i.omschrijving}</div>
              {(i.oorzaak || i.afhandeling) && (
                <div className="text-xs text-gray-600 break-words">{[i.afhandeling, i.oorzaak].filter(Boolean).join(' · ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
