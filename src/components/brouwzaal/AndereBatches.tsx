import React from 'react'
import { t } from '../../i18n'
import { batchNummer } from '../../utils/productKeten'
import type { BatchTitel } from '../../utils/productKeten'
import type { BuitenTankReden } from '../../utils/calculations'
import type { BatchEtiket, FaseInfo, StapWeergave, TankInfo } from '../../utils/batchesLijst'
import type { VolgendeStap } from '../../utils/volgendeStap'
import Badge from '../ui/Badge'
import BierKleur from '../ui/BierKleur'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import SectionHeader from '../ui/SectionHeader'
import { ETIKET_CHIP, abvKort, etiketTekst, litersTekst, stapDetail, vul } from '../batches/batchTekst'
import { StapKnop } from './TankKaart'
import { dagTekst, weekdag } from './brouwzaalTekst'

/** Een lopende batch zonder tankkaart (afgeleid in ProductieDashboard). */
export interface AndereModel {
  b: any
  titel: BatchTitel
  ebc: number | null
  fase: FaseInfo
  tank: TankInfo | null
  /** Vergisten/Conditioneren: waarom hij geen tankkaart heeft. */
  reden: BuitenTankReden | null
  stap: VolgendeStap
  weergave: StapWeergave
  etiket: BatchEtiket
  /** Afgevuld: in hoeveel verpakkingen. */
  verpakkingen: number
}

interface AndereBatchesProps {
  rijen: AndereModel[]
  gesloten: number
  onOpen: (b: any) => void
  onStap: (r: AndereModel) => void
  onMeting: (r: AndereModel) => void
  onGesloten: () => void
  /** Telefoon: kop met *+ Batch*, rijen zonder ⋯. */
  telefoon: boolean
  onNieuw?: () => void
}

const IN_TANK = new Set(['Vergisten', 'Conditioneren', 'Vergisting', 'Lagering'])

/** Waarom een batch in de tank geen tankkaart heeft ("geen tank", "tank GV9 bestaat niet meer"). */
const redenTekst = (r: AndereModel): string =>
  r.reden === 'geen_tank' ? t('dash_buiten_geen_tank')
    : r.reden === 'tank_onbekend' ? t('dash_buiten_tank_onbekend').replace('{tank}', r.tank?.naam || '')
    : r.reden === 'tank_gedeeld' ? t('dash_buiten_tank_gedeeld').replace('{tank}', r.tank?.naam || '')
    : ''

/** De tweede regel: wanneer, waar, hoeveel (bureau voluit, telefoon kort). */
const momentDelen = (r: AndereModel, kort: boolean): string[] => {
  const f = r.fase
  const tank = r.tank && !r.reden ? r.tank.naam : ''
  if (f.soort === 'gepland' || f.soort === 'brouwen') {
    const d = f.brouwdag ? (kort ? weekdag(f.brouwdag) : vul(t('keten_brouwdag'), { datum: weekdag(f.brouwdag) })) : ''
    const abv = r.etiket.waarden.abv
    const verwacht = !kort && abv.waarde != null && abv.bron === 'verwacht' ? `${t('batches_abv_verwacht')} ${abvKort(abv.waarde)}` : ''
    return [d, tank, kort ? '' : litersTekst(Number(r.b.liter_vergist)), verwacht]
  }
  if (f.soort === 'vergisten' || f.soort === 'conditioneren') {
    return [dagTekst({ dag: f.dag, totaal: f.soort === 'vergisten' ? f.totaal : null }, kort), tank, kort ? '' : litersTekst(Number(r.b.liter_vergist))]
  }
  if (f.soort === 'afgevuld') {
    const liters = litersTekst(f.liters)
    const inVerpakking = liters && r.verpakkingen > 1 && !kort
      ? vul(t('brouwzaal_liters_in_verpakkingen'), { liters, n: r.verpakkingen }) : liters
    return [f.datum && !kort ? vul(t('keten_afgevuld'), { datum: weekdag(f.datum) }) : '', tank, inVerpakking]
  }
  return [tank]
}

/** De etiketchip: vanaf Conditioneren altijd (daar staat de etiketkaart), eerder alleen als hij rood is. */
const toonEtiket = (r: AndereModel): boolean =>
  r.fase.soort === 'conditioneren' || r.fase.soort === 'afgevuld' || r.etiket.status.kleur === 'rood'

const Rij: React.FC<{ r: AndereModel } & Pick<AndereBatchesProps, 'onOpen' | 'onStap' | 'onMeting' | 'telefoon'>> = ({ r, onOpen, onStap, onMeting, telefoon }) => {
  const nr = batchNummer(r.b)
  const reden = redenTekst(r)
  const delen = momentDelen(r, telefoon).filter(Boolean)
  const tekort = r.stap.soort === 'ingredienten' ? stapDetail(r.stap) : ''
  const overTijd = r.fase.soort === 'gepland' && r.fase.overTijd
  // ⋯ (bureau): de batch openen, en Meting voor bier in de tank (als dat niet al de knop is).
  const acties: RowActie[] = [{ id: 'open', label: `${t('stap_openen')} ›`, onClick: () => onOpen(r.b) }]
  if (IN_TANK.has(String(r.b.status)) && r.stap.soort !== 'meting') acties.push({ id: 'meting', label: t('stap_meting'), onClick: () => onMeting(r) })
  return (
    <div className={`relative flex items-center gap-3 px-4 ${telefoon ? 'py-2.5 min-h-[64px]' : 'py-2.5 min-h-[56px]'}`}>
      <BierKleur ebc={r.ebc} s="md" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <button type="button" onClick={() => onOpen(r.b)}
            className="min-w-0 break-words text-left font-semibold text-gray-900 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--t-accent)]">
            {r.titel.titel}{nr && <span className="font-normal text-gray-500"> #{nr}</span>}
          </button>
          <Badge s={r.b.status} />
          {overTijd && <span className="px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-[11px] font-medium">{t('batches_over_tijd')}</span>}
        </div>
        <div className="text-[13px] text-gray-600 mt-0.5 break-words">
          {reden && <span className="text-orange-700 font-medium">{reden}{delen.length ? ' · ' : ''}</span>}
          {delen.join(' · ')}
          {telefoon && tekort && <span className="text-orange-700">{delen.length || reden ? ' · ' : ''}{tekort}</span>}
        </div>
        {/* Telefoon en een smal bureauvenster: de etiketchip onder de regel; breed: rechts bij de knop. */}
        {toonEtiket(r) && (
          <span className={`${telefoon ? 'inline-flex' : 'inline-flex lg:hidden'} mt-1 px-2 py-0.5 rounded-lg text-[11px] font-medium ring-1 ${ETIKET_CHIP[r.etiket.status.kleur]}`}>{etiketTekst(r.etiket.status)}</span>
        )}
      </div>
      <div className="relative z-[1] flex items-center gap-2 flex-shrink-0">
        {!telefoon && tekort && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200 whitespace-nowrap">{tekort}</span>
        )}
        {!telefoon && toonEtiket(r) && (
          <span className={`hidden lg:inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${ETIKET_CHIP[r.etiket.status.kleur]}`}>{etiketTekst(r.etiket.status)}</span>
        )}
        {r.weergave === 'knop' && (
          <StapKnop stap={r.stap} kort={telefoon} onClick={() => onStap(r)} cls={telefoon ? 'min-h-tap' : 'min-h-[36px]'} />
        )}
        {!telefoon && <RowActions acties={acties} v="kaart" />}
      </div>
    </div>
  )
}

/**
 * "Andere batches": alles wat loopt maar geen tankkaart heeft — gepland, aan
 * het brouwen, afgevuld, en bier in Vergisten/Conditioneren zonder (bestaande)
 * tank, zodat er niets uit beeld verdwijnt. Per batch de fase, wanneer en waar,
 * en dezelfde ene knop als op een tankkaart (`volgendeStap`). Onderaan de weg
 * naar de gesloten batches.
 */
const AndereBatches: React.FC<AndereBatchesProps> = ({ rijen, gesloten, onOpen, onStap, onMeting, onGesloten, telefoon, onNieuw }) => {
  if (!rijen.length && !gesloten && !telefoon) return null
  const voet = gesloten > 0 && (
    <button type="button" onClick={onGesloten}
      className="w-full text-left px-4 py-3 min-h-tap md:min-h-0 text-sm font-medium t-accent-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
      {vul(t('dash_gesloten_archief'), { n: gesloten })} ›
    </button>
  )
  const lijst = (
    <div className="divide-y divide-gray-100">
      {rijen.map(r => <Rij key={r.b.id} r={r} onOpen={onOpen} onStap={onStap} onMeting={onMeting} telefoon={telefoon} />)}
      {voet}
    </div>
  )
  if (telefoon) {
    return (
      <section aria-label={t('brouwzaal_andere_batches')}>
        <div className="flex items-center justify-between gap-2 mb-2 min-h-tap">
          <h2 className="text-sm font-semibold text-gray-800">{t('brouwzaal_andere_batches')}</h2>
          {onNieuw && (
            <button type="button" onClick={onNieuw}
              className="inline-flex items-center justify-center px-3 min-h-tap rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 shadow-sm active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {t('batches_nieuw_kort')}
            </button>
          )}
        </div>
        {(rijen.length > 0 || voet) && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">{lijst}</div>
        )}
      </section>
    )
  }
  return (
    <section aria-label={t('brouwzaal_andere_batches')} className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <SectionHeader title={t('brouwzaal_andere_batches')} info={rijen.length || null} rounded="top" />
      {lijst}
    </section>
  )
}

export default AndereBatches
