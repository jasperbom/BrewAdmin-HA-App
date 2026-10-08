import React from 'react'
import { t } from '../../i18n'
import { fmtSg } from '../../utils/format'
import { STATUS_CLR, batchStatusLabel } from '../../utils/constants'
import { bewakingLabel } from '../../utils/tankbewaking'
import type { BatchOordeel } from '../../utils/tankbewaking'
import { batchNummer } from '../../utils/productKeten'
import type { BatchTitel } from '../../utils/productKeten'
import type { BatchEtiket } from '../../utils/batchesLijst'
import type { TankKaartInfo } from '../../utils/brouwzaal'
import type { VolgendeStap } from '../../utils/volgendeStap'
import { TankVisualForSoort } from '../batch/TankVisual'
import BierKleur from '../ui/BierKleur'
import { ETIKET_CHIP, etiketTekst, litersTekst, stapLabel, takenTekst } from '../batches/batchTekst'
import { afvullenTekst, faseChipTekst, gemetenTekst, getal, gistingTekst, telefoonRegel } from './brouwzaalTekst'

/** Een tank met een batch erin, zoals de brouwzaal hem toont (afgeleid in ProductieDashboard). */
export interface TankModel {
  tank: any
  batch: any
  titel: BatchTitel
  /** Het gebrouwen recept (een gekozen versie met haar naam). */
  recept: string | null
  ebc: number | null
  info: TankKaartInfo
  stap: VolgendeStap
  etiket: BatchEtiket
  /** Oordeel van de temperatuurbewaking; null = niets te zeggen. */
  bewaking: BatchOordeel | null
}

interface TankKaartProps {
  m: TankModel
  vandaag: string
  onOpen: (m: TankModel) => void
  /** De ene knop: met › opent hij de batch op de plek van de stap, zonder › voert hij uit (Meting). */
  onStap: (m: TankModel) => void
}

// Kleur per bewakingsstatus — semantische statuskleuren (CLAUDE.md), niet
// thema-afhankelijk. `geen_data`/`geen_doel` krijgen bewust geen pill: daar
// valt niets zinnigs over te zeggen.
export const BEWAKING_PILL: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  instellen: 'bg-blue-100 text-blue-700',
  afwijking: 'bg-orange-100 text-orange-700',
  waarschuwing: 'bg-orange-700 text-white',
  alarm: 'bg-red-600 text-white',
  sensor_stil: 'bg-gray-200 text-gray-600',
}

const BewakingPill: React.FC<{ b: BatchOordeel }> = ({ b }) => (
  <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded ${BEWAKING_PILL[b.status]}`}
    title={b.doel != null
      ? t(b.doelBron === 'setpoint' ? 'tank_bew_doel_setpoint' : 'tank_bew_doel').replace('{doel}', b.doel.toFixed(1))
      : ''}>
    {bewakingLabel(b.status)}
  </span>
)

/** De ene knop van een tank of batch: de volgende stap, voluit of kort (telefoon). */
export const StapKnop: React.FC<{ stap: VolgendeStap; kort: boolean; onClick: () => void; cls?: string }> = ({ stap, kort, onClick, cls = '' }) => (
  <button type="button" onClick={e => { e.stopPropagation(); onClick() }} title={stapLabel(stap, false)}
    className={`relative z-[1] inline-flex items-center justify-center px-3 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-800 border-gray-300 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${cls}`}>
    {stapLabel(stap, kort)}
  </button>
)

const FaseChip: React.FC<{ status: string; tekst: string }> = ({ status, tekst }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_CLR[status] || 'bg-gray-100 text-gray-600'}`}>{tekst}</span>
)

const EtiketChip: React.FC<{ e: BatchEtiket; cls?: string }> = ({ e, cls = '' }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium ring-1 ${ETIKET_CHIP[e.status.kleur]} ${cls}`}>{etiketTekst(e.status)}</span>
)

const Metriek: React.FC<{ label: string; waarde: string; cls?: string }> = ({ label, waarde, cls = '' }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-medium text-gray-500">{label}</div>
    <div className={`text-2xl font-semibold tabular-nums leading-tight ${waarde ? 'text-gray-900' : 'text-gray-300'} ${cls}`}>{waarde || '—'}</div>
  </div>
)

/** De voortgangsbalk van de gisting (klaar = vol). */
const GistBalk: React.FC<{ info: TankKaartInfo; cls?: string }> = ({ info, cls = '' }) => {
  const pct = info.klaar ? 100 : info.pct
  if (pct == null) return null
  return (
    <div className={`w-full bg-gray-200 rounded-full h-1.5 ${cls}`} aria-hidden="true">
      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  )
}

/**
 * De tankkaart op het bureau: de tank met de bierkleur, welk bier (product én
 * recept), de meetstrip (SG met drie decimalen, °C, pH), hoe ver de gisting is
 * en wanneer er afgevuld wordt, de etiketchip als het etiket niet klopt, en
 * één knop: de volgende stap. De hele kaart opent de batch.
 */
export const TankKaart: React.FC<TankKaartProps> = ({ m, vandaag, onOpen, onStap }) => {
  const { tank, batch, info, stap, etiket } = m
  const nr = batchNummer(batch)
  const sub = [m.recept ? `${t('brouwzaal_recept')} ${m.recept}` : '', nr ? `#${nr}` : '', litersTekst(Number(batch.liter_vergist))]
    .filter(Boolean).join(' · ')
  const gisting = gistingTekst(info)
  const afvullen = afvullenTekst(info)
  return (
    <div className="relative bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <TankVisualForSoort soort={tank.soort} fillPct={info.vulPct} status={batch.status} ebc={m.ebc ?? undefined} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-gray-600">{tank.naam || tank.id}</span>
            <FaseChip status={batch.status} tekst={faseChipTekst(batch.status, info)} />
          </div>
          <button type="button" onClick={() => onOpen(m)}
            className="mt-1 flex items-center gap-2 min-w-0 max-w-full text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--t-accent)]">
            <BierKleur ebc={m.ebc} s="md" />
            <span className="text-lg font-semibold text-gray-900 break-words min-w-0">{m.titel.titel}</span>
          </button>
          {sub && <div className="text-xs text-gray-500 mt-0.5 break-words">{sub}</div>}
          {m.bewaking && <div className="mt-1"><BewakingPill b={m.bewaking} /></div>}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Metriek label={t('flow_meting_sg')} waarde={info.sg ? fmtSg(info.sg.waarde, '') : ''} />
            <Metriek label="°C" waarde={info.temp ? getal(info.temp.waarde, 1) : ''} cls={info.temp?.bron === 'sensor' ? 'text-blue-700' : ''} />
            <Metriek label="pH" waarde={info.ph ? getal(info.ph.waarde, 2) : ''} />
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {gemetenTekst(info.gemeten, vandaag)}
            {info.temp?.bron === 'sensor' && <span> · {t('brouwzaal_temp_sensor')}</span>}
          </div>
        </div>
      </div>
      {(gisting || afvullen) && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
            <span className="text-gray-600">{gisting}</span>
            {afvullen && <span className={`font-medium ${info.afvullenOverTijd ? 'text-orange-700' : 'text-gray-800'}`}>{afvullen}</span>}
          </div>
          <GistBalk info={info} cls="mt-1.5" />
        </div>
      )}
      {etiket.status.kleur !== 'groen' && <div><EtiketChip e={etiket} /></div>}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100 mt-auto">
        <StapKnop stap={stap} kort={false} onClick={() => onStap(m)} cls="min-h-[36px]" />
        {stap.openTaken > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium whitespace-nowrap">{takenTekst(stap.openTaken)}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Een tank als rij op de telefoon (± 88 px, alle tanks in één kaart): de
 * mini-tank, "GV1 · Kadeblond" met de fase, "#2609 · dag 8 · SG 1.012 ·
 * 2,1 °C", de gistingsbalk tijdens het vergisten, de etiketchip als het etiket
 * niet klopt en rechts de ene knop (kort: "ABV ›", "Meting").
 */
export const TankRij: React.FC<TankKaartProps> = ({ m, onOpen, onStap }) => {
  const { tank, batch, info, stap, etiket } = m
  const vergisten = info.pct != null && !info.klaar
  return (
    <div className="relative flex items-center gap-3 px-3 py-2.5 min-h-[88px]">
      <TankVisualForSoort soort={tank.soort} fillPct={info.vulPct} status={batch.status} ebc={m.ebc ?? undefined} hoogte={48} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <button type="button" onClick={() => onOpen(m)}
            className="min-w-0 break-words text-left font-semibold text-gray-900 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--t-accent)]">
            {tank.naam || tank.id} · {m.titel.titel}
          </button>
          <FaseChip status={batch.status} tekst={batchStatusLabel(batch.status)} />
        </div>
        <div className="text-[13px] text-gray-600 mt-0.5 break-words">{telefoonRegel(batchNummer(batch), info)}</div>
        {vergisten && (
          <div className="flex items-center gap-2 mt-1">
            <GistBalk info={info} cls="flex-1" />
            <span className="text-xs text-gray-600 tabular-nums">{info.pct} %</span>
          </div>
        )}
        {(etiket.status.kleur !== 'groen' || m.bewaking) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {etiket.status.kleur !== 'groen' && <EtiketChip e={etiket} cls="text-[11px]" />}
            {m.bewaking && <BewakingPill b={m.bewaking} />}
          </div>
        )}
      </div>
      <StapKnop stap={stap} kort onClick={() => onStap(m)} cls="min-h-tap flex-shrink-0" />
    </div>
  )
}
