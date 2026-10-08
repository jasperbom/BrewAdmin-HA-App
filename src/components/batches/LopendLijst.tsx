import React from 'react'
import { t } from '../../i18n'
import { fmtD, fmtSg } from '../../utils/format'
import { batchNummer } from '../../utils/productKeten'
import type { BatchTitel } from '../../utils/productKeten'
import type { BatchEtiket, FaseInfo, LijstVerwijderReden, LopendGroep, StapWeergave, TankInfo } from '../../utils/batchesLijst'
import type { VolgendeStap } from '../../utils/volgendeStap'
import Badge from '../ui/Badge'
import BierKleur from '../ui/BierKleur'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import {
  ETIKET_CHIP, abvBronTekst, abvKort, batchLitersTekst, etiketKortTekst, etiketTekst, faseSubTekst, kaartMoment, stapDetail,
  stapLabel, takenTekst, tankTekst,
} from './batchTekst'

/** Eén lopende batch zoals de lijst hem toont (afgeleid in BatchesPage). */
export interface LopendRij {
  b: any
  titel: BatchTitel
  /** Het gebrouwen recept (een gekozen versie met haar naam). */
  recept: string | null
  ebc: number | null
  fase: FaseInfo
  tank: TankInfo | null
  etiket: BatchEtiket
  stap: VolgendeStap
  weergave: StapWeergave
  /** Open taken in de huidige fase. */
  taken: number
  /** Waarom hij niet uit de lijst weg kan; null = Verwijderen kan (alleen Gepland). */
  verwijder: LijstVerwijderReden | null
}

export interface LopendGroepRijen {
  groep: LopendGroep
  rijen: LopendRij[]
}

/** `breed`: de hele tabel; `compact`: nummer, recept en liters onder de naam; `kaarten`: telefoon en smalle vensters. */
export type LopendWeergave = 'breed' | 'compact' | 'kaarten'

interface LopendLijstProps {
  groepen: LopendGroepRijen[]
  weergave: LopendWeergave
  onOpen: (b: any) => void
  /** De volgende stap: opent de batch op de plek van de stap, of voert hem uit (Meting). */
  onStap: (r: LopendRij) => void
  onMeting: (r: LopendRij) => void
  onVerwijder: (r: LopendRij) => void
  /** Onder de lijst ("23 gesloten batches · Gesloten ›"). */
  voet?: React.ReactNode
  /** Rechts naast het eerste groepskopje op een telefoon ("+ Batch"). */
  nieuwKnop?: React.ReactNode
  /** Telefoon: Meting niet in ⋯ (de onderbalk heeft Meten). In een smal bureauvenster wel. */
  telefoon?: boolean
}

export const GROEP_SLEUTEL: Record<LopendGroep, string> = {
  gepland: 'batches_groep_gepland', brouwen: 'batches_groep_brouwen', tank: 'batches_groep_tank',
  afgevuld: 'batches_groep_afgevuld', overig: 'batches_groep_overig',
}

const VERWIJDER_REDEN: Record<LijstVerwijderReden, string> = {
  niet_gepland: 'batches_verwijder_niet_gepland',
  afvullingen: 'batches_verwijder_afvullingen',
  gekoppeld: 'batches_verwijder_gekoppeld',
  afgeboekt: 'batches_verwijder_afgeboekt',
}

const IN_TANK = new Set(['Vergisten', 'Conditioneren', 'Vergisting', 'Lagering'])

/** De acties achter ⋯: Meting (in de tank, als dat niet al de knop is) en Verwijderen (alleen Gepland). */
const menuActies = (r: LopendRij, p: Pick<LopendLijstProps, 'onMeting' | 'onVerwijder' | 'onOpen'>, metOpenen: boolean): RowActie[] => {
  const acties: RowActie[] = []
  if (metOpenen) acties.push({ id: 'open', label: `${t('stap_openen')} ›`, onClick: () => p.onOpen(r.b) })
  if (IN_TANK.has(String(r.b.status)) && r.stap.soort !== 'meting') {
    acties.push({ id: 'meting', label: t('stap_meting'), onClick: () => p.onMeting(r) })
  }
  if (r.verwijder !== 'niet_gepland') {
    // Kan hij niet weg, dan staat de reden ónder de actie (een telefoon kent geen tooltip).
    acties.push({
      id: 'verwijder', label: t('btn_delete'), soort: 'gevaar', onClick: () => p.onVerwijder(r),
      disabled: r.verwijder != null, toelichting: r.verwijder ? t(VERWIJDER_REDEN[r.verwijder]) : undefined,
    })
  }
  return acties
}

const TekortChip: React.FC<{ r: LopendRij }> = ({ r }) => {
  const tekst = stapDetail(r.stap)
  return tekst
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200 whitespace-nowrap">{tekst}</span>
    : null
}

const StapKnop: React.FC<{ r: LopendRij; kort: boolean; onStap: (r: LopendRij) => void; cls?: string }> = ({ r, kort, onStap, cls = '' }) => (
  <button type="button" onClick={e => { e.stopPropagation(); onStap(r) }}
    title={stapLabel(r.stap, false)}
    className={`inline-flex items-center justify-center px-3 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-800 border-gray-300 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${cls}`}>
    {stapLabel(r.stap, kort)}
  </button>
)

// ── Bureau: één tabel, groepskoppen als rij ─────────────────────────────────

const Tabel: React.FC<LopendLijstProps & { compact: boolean }> = (p) => {
  const { groepen, compact, onOpen, onStap, voet } = p
  const kolommen = compact ? 7 : 10
  const th = 'px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200">
          <tr>
            <th className={`${th} pl-4`}>{t('batches_kol_product')}</th>
            {!compact && <th className={th}>#</th>}
            {!compact && <th className={th}>{t('batches_kol_recept')}</th>}
            <th className={th}>{t('batches_kol_fase')}</th>
            <th className={th}>{t('lbl_tank')}</th>
            <th className={th}>{t('batches_kol_brouwdatum')}</th>
            {!compact && <th className={th}>{t('batches_kol_liters')}</th>}
            <th className={th}>{t('batches_kol_abv')}</th>
            <th className={th}>{t('batches_kol_etiket')}</th>
            <th className={`${th} pr-4`}><span className="sr-only">{t('batches_kol_actie')}</span></th>
          </tr>
        </thead>
        {groepen.map(g => (
          <tbody key={g.groep}>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th colSpan={kolommen} scope="colgroup" className="px-4 py-2 text-left text-sm font-semibold text-gray-800">
                {t(GROEP_SLEUTEL[g.groep])} <span className="ml-1 font-normal text-gray-500">{g.rijen.length}</span>
              </th>
            </tr>
            {g.rijen.map(r => {
              const nr = batchNummer(r.b)
              const sub = faseSubTekst(r.fase)
              const overTijd = r.fase.soort === 'gepland' && r.fase.overTijd
              const liters = batchLitersTekst(r.b, r.fase)
              const acties = menuActies(r, p, true)
              return (
                <tr key={r.b.id} onClick={() => onOpen(r.b)}
                  className="border-b border-gray-100 last:border-b-0 align-top cursor-pointer hover:bg-gray-50/80">
                  <td className="pl-4 pr-3 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <BierKleur ebc={r.ebc} s="md" />
                      <button type="button" onClick={e => { e.stopPropagation(); onOpen(r.b) }}
                        className={`font-semibold text-gray-900 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded ${compact ? '' : 'whitespace-nowrap'}`}>
                        {r.titel.titel}
                      </button>
                    </div>
                    {compact && (
                      <div className="mt-0.5 ml-6 text-xs text-gray-500">
                        {[nr ? `#${nr}` : '', r.recept && r.recept !== r.titel.titel ? r.recept : '', liters].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  {!compact && <td className="px-3 py-3 text-gray-600 tabular-nums whitespace-nowrap">{nr ? `#${nr}` : ''}</td>}
                  {!compact && <td className="px-3 py-3 text-gray-700">{r.recept || <span className="text-gray-400">—</span>}</td>}
                  <td className="px-3 py-3">
                    <Badge s={r.b.status} />
                    {(sub || r.taken > 0) && (
                      <div className={`mt-1 text-xs text-gray-500 ${compact ? '' : 'whitespace-nowrap'}`}>
                        {sub && <span className={overTijd ? 'text-orange-700 font-medium' : ''}>{sub}</span>}
                        {sub && r.taken > 0 && ' · '}
                        {r.taken > 0 && takenTekst(r.taken)}
                      </div>
                    )}
                  </td>
                  <td className={`px-3 py-3 ${r.tank && r.tank.bestaat ? 'text-gray-700 whitespace-nowrap' : `text-gray-500 text-xs ${r.tank ? '' : 'whitespace-nowrap'}`}`}>{tankTekst(r.tank)}</td>
                  <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">{fmtD(r.b.datum)}</td>
                  {!compact && <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">{liters}</td>}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-gray-900 tabular-nums">{abvKort(r.etiket.waarden.abv.waarde) || <span className="text-gray-400">—</span>}</div>
                    <div className="text-xs text-gray-500">{abvBronTekst(r.etiket.waarden.abv)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span title={etiketTekst(r.etiket.status)}
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${compact ? '' : 'whitespace-nowrap'} ${ETIKET_CHIP[r.etiket.status.kleur]}`}>
                      {etiketKortTekst(r.etiket.status)}
                    </span>
                  </td>
                  <td className="pl-3 pr-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {(r.weergave === 'chip' || (r.stap.soort === 'ingredienten' && r.weergave === 'knop')) && <TekortChip r={r} />}
                      {r.weergave === 'knop' && <StapKnop r={r} kort={false} onStap={onStap} cls="min-h-[36px]" />}
                      <RowActions acties={acties} v="kaart" />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
      {voet && <div className="px-4 py-3 border-t border-gray-200 text-sm text-gray-600">{voet}</div>}
    </div>
  )
}

// ── Telefoon (en een smal venster): kaarten per groep ───────────────────────

const Kaart: React.FC<{ r: LopendRij } & Pick<LopendLijstProps, 'onOpen' | 'onStap' | 'onMeting' | 'onVerwijder' | 'telefoon'>> = ({ r, ...p }) => {
  const nr = batchNummer(r.b)
  const f = r.fase
  const status = String(r.b.status)
  const abv = r.etiket.waarden.abv
  const overTijd = f.soort === 'gepland' && f.overTijd
  const tekort = r.stap.soort === 'ingredienten' ? stapDetail(r.stap) : ''
  // De derde regel zegt per fase wat ertoe doet (SPEC L).
  let derde: React.ReactNode = null
  if (f.soort === 'gepland' || f.soort === 'brouwen' || (f.soort === 'vergisten' && f.sg == null)) {
    const verwacht = abv.waarde != null ? `${abv.bron === 'verwacht' ? `${t('batches_abv_verwacht')} ` : ''}${abvKort(abv.waarde)}${abv.bron !== 'verwacht' ? ` ${abvBronTekst(abv)}` : ''}` : ''
    const delen = [verwacht, tekort].filter(Boolean)
    if (delen.length) derde = <span className={tekort ? 'text-orange-700' : 'text-gray-600'}>{delen.join(' · ')}</span>
  } else if (f.soort === 'vergisten') {
    derde = <span className="text-gray-600">{[`SG ${fmtSg(f.sg, '')}`, f.pct != null ? `${f.pct} %` : ''].filter(Boolean).join(' · ')}</span>
  } else if (f.soort === 'conditioneren') {
    derde = abv.waarde != null ? <span className="text-gray-600">{`${abvKort(abv.waarde)} ${abvBronTekst(abv)}`}</span> : null
  } else if (f.soort === 'afgevuld') {
    derde = <span className="text-gray-600">{[abvKort(abv.waarde), batchLitersTekst(r.b, f)].filter(Boolean).join(' · ')}</span>
  }
  // De etiketstatus vanaf Conditioneren (daar staat de etiketkaart), en eerder alleen als hij rood is.
  const toonEtiket = f.soort === 'conditioneren' || f.soort === 'afgevuld' || r.etiket.status.kleur === 'rood'
  const knop = r.weergave === 'knop'
  // Eén zichtbare actie per kaart (SPEC 0.2); ⋯ alleen voor wat anders niet kan:
  // Verwijderen bij Gepland. Meten kan op de telefoon altijd via de Meten-knop
  // in de onderbalk; een smal bureauvenster heeft die niet, daar staat hij in ⋯.
  const acties = menuActies(r, p, false).filter(a => !p.telefoon || a.id !== 'meting')
  return (
    <div className="relative bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 min-w-0">
          <BierKleur ebc={r.ebc} s="md" cls="mt-0.5" />
          {/* De naam breekt liever af dan dat het nummer wegvalt; de chip schuift mee. */}
          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button type="button" onClick={() => p.onOpen(r.b)}
              className="min-w-0 break-words text-left font-semibold text-gray-900 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--t-accent)]">
              {r.titel.titel}{nr && <span className="font-normal text-gray-500"> #{nr}</span>}
            </button>
            <Badge s={status} />
          </div>
        </div>
        <div className="ml-6 mt-0.5 text-sm text-gray-600 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="min-w-0 break-words">{[kaartMoment(f, r.tank), r.taken > 0 ? takenTekst(r.taken) : ''].filter(Boolean).join(' · ')}</span>
          {overTijd && <span className="px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-[11px] font-medium">{t('batches_over_tijd')}</span>}
        </div>
        {(derde || toonEtiket) && (
          <div className="ml-6 mt-0.5 text-sm flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {derde}
            {toonEtiket && (
              <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium ring-1 ${ETIKET_CHIP[r.etiket.status.kleur]}`}>{etiketTekst(r.etiket.status)}</span>
            )}
          </div>
        )}
      </div>
      {/* Rechts: ⋯ bovenaan (als er iets in staat), de knop van de volgende stap eronder. */}
      {(knop || acties.length > 0) && (
        <div className="relative z-[1] flex-shrink-0 self-stretch flex flex-col items-end justify-center gap-1.5">
          {acties.length > 0 && <RowActions acties={acties} v="kaart" />}
          {knop && <StapKnop r={r} kort onStap={p.onStap} cls="min-h-tap" />}
        </div>
      )}
    </div>
  )
}

const Kaarten: React.FC<LopendLijstProps> = (p) => (
  <div className="space-y-4">
    {p.groepen.map((g, i) => (
      <section key={g.groep} aria-label={t(GROEP_SLEUTEL[g.groep])}>
        <div className="flex items-center justify-between gap-2 mb-2 min-h-tap">
          <h3 className="text-[13px] font-medium text-gray-500">{t(GROEP_SLEUTEL[g.groep])} · {g.rijen.length}</h3>
          {i === 0 && p.nieuwKnop}
        </div>
        <div className="space-y-2">
          {g.rijen.map(r => <Kaart key={r.b.id} r={r} onOpen={p.onOpen} onStap={p.onStap} onMeting={p.onMeting} onVerwijder={p.onVerwijder} telefoon={p.telefoon} />)}
        </div>
      </section>
    ))}
    {p.voet && <div className="text-sm text-gray-600 px-1">{p.voet}</div>}
  </div>
)

/**
 * Lopend: alle batches die nog niet gesloten zijn, per groep (Gepland,
 * Brouwen, In de tank, Afgevuld). Per batch het bier (stip, naam), de fase,
 * de tank, de alcohol met zijn bron, de etiketstatus en hooguit één knop: de
 * volgende stap (met › opent hij de batch op de juiste plek, zonder › voert
 * hij uit). De rest staat achter ⋯. Op het bureau een tabel, op een telefoon
 * kaarten — nooit een tabel die zijwaarts scrolt.
 */
const LopendLijst: React.FC<LopendLijstProps> = (p) =>
  p.weergave === 'kaarten' ? <Kaarten {...p} /> : <Tabel {...p} compact={p.weergave === 'compact'} />

export default LopendLijst
