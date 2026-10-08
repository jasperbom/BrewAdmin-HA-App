import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import Btn from '../ui/Btn'
import { fmtD } from '../../utils/format'
import { dagenTot, BIER_THT_WAARSCHUWING_DAGEN } from '../../utils/verkoopOverzicht'
import type { VoorraadLot, VoorraadVerpakking } from '../../utils/verkoopOverzicht'
import { dekkingTekst } from '../../utils/verkoopDashboard'
import { tekortChip } from '../../utils/productPagina'
import {
  AFBOEKING_REDENEN, REDEN_COLORS, VERNIETIGING_STATUS_COLOR, VERNIETIGING_STATUS_LABEL,
} from './afboekingStijl'
import type { AfboekingReden, VernietigingStatus } from './afboekingStijl'

// De voorraad van één bier per verpakking (SPEC M ④ Verkopen, N segment
// Voorraad) — flessen en fusten nooit opgeteld: "46 vrij · 0 AGP · 48
// besteld" met een rode chip "tekort 2", en per lot een regel "L2607-B1 ·
// #2607 · THT 9-6-2027 · Winkel 46". Ligt een lot (deels) in de AGP, dan is
// "Uitslaan" de ene zichtbare actie van die regel; verplaatsen, rebranden en
// afboeken staan in ⋯. De getallen komen uit `voorraadPerProduct` (dezelfde
// telling als het Overzicht en de kassa); de vensters boeken via de pagina
// precies wat ze altijd boekten.

export interface VoorraadKaartProps {
  voorraad: VoorraadVerpakking[]
  /** De afvulling achter een lot (voor de vensters), of null. */
  afvullingVan: (id: number) => any | null
  locaties: any[]
  /** Dekking in weken per verpakking (`sleutel`); null = te weinig verkoop. */
  dekking: Record<string, number | null>
  vandaag: string
  /** Uitslaan uit de AGP: het verplaatsvenster vanaf de AGP. */
  onUitslaan: (afv: any, vanLocatieId: number) => void
  onVerplaatsen: (afv: any, vanLocatieId: number) => void
  /** Zonder: geen "Rebranden" (de pagina mag de afvullingen niet wijzigen). */
  onRebrand?: (afv: any) => void
  onAfboeken: (afv: any) => void
  /** De afboekingen van een afvulling (vermis, vernietiging, overig). */
  afboekingenVan: (afvullingId: number) => any[]
  /** Een vernietiging een stap verder zetten (toestemming, uitgevoerd). */
  onVernietiging: (afb: any) => void
  /** Lopende vernietigingen van afvullingen die niet meer op voorraad liggen. */
  lopendeVernietigingen: Array<{ afb: any; afv: any }>
  /** Wat er van dit bier vrij uit te slaan in de AGP ligt (alle lots). */
  agpTotaal: number
  /** Uitslaan in één keer, oudste THT eerst (het uitslagvenster). */
  onUitslaanProduct: () => void
  productNaam: (id: number) => string
  /** Telefoon: een kaart per verpakking in plaats van één kaart. */
  telefoon: boolean
  id?: string
}

const locNaam = (locaties: any[], id: number): string =>
  String((locaties || []).find((l: any) => Number(l?.id) === id)?.naam || t('lbl_onbekend'))
const isAgp = (locaties: any[], id: number): boolean =>
  !!(locaties || []).find((l: any) => Number(l?.id) === id)?.is_agp

/** De locaties van een lot met voorraad: eerst de vrije, dan de AGP. */
const lotLocaties = (lot: VoorraadLot, locaties: any[]): Array<{ id: number; n: number; agp: boolean }> =>
  Object.entries(lot.perLocatie)
    .map(([k, n]) => ({ id: Number(k), n: Number(n) || 0, agp: isAgp(locaties, Number(k)) }))
    .filter(x => x.n > 0)
    .sort((a, b) => Number(a.agp) - Number(b.agp) || locNaam(locaties, a.id).localeCompare(locNaam(locaties, b.id)))

/** "46 vrij · 0 AGP · 48 besteld · ± 4 wk". */
const groepRegel = (g: VoorraadVerpakking, dekking: number | null): React.ReactNode => {
  const rest = [
    t('verkoop_agp').replace('{n}', String(g.agp)),
    ...(g.besteld > 0 ? [t('product_besteld').replace('{n}', String(g.besteld))] : []),
    ...(g.geblokkeerd > 0 ? [t('verkoop_geblokkeerd').replace('{n}', String(g.geblokkeerd))] : []),
    ...(dekking != null && dekking > 0 ? [dekkingTekst(dekking, t)] : []),
  ]
  return (
    <>
      <span className="font-semibold text-gray-900">{t('verkoop_vrij').replace('{n}', String(g.vrij))}</span>
      <span className="text-gray-600"> · {rest.join(' · ')}</span>
    </>
  )
}

/** Rood "tekort 2", of oranje "eerst uitslaan" als wat ontbreekt in de AGP ligt. */
const TekortChip: React.FC<{ g: VoorraadVerpakking }> = ({ g }) => {
  const chip = tekortChip(g, t)
  if (!chip) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${chip.kleur === 'rood' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-800'}`}>
      {chip.tekst}
    </span>
  )
}

const Afboekingen: React.FC<{ lijst: any[]; onVernietiging: (afb: any) => void }> = ({ lijst, onVernietiging }) => (
  <div className="mt-1.5 pl-3 border-l-2 border-red-100 space-y-1">
    {lijst.map((ab: any) => {
      const isVern = ab.reden === 'vernietiging'
      const status: VernietigingStatus | undefined = isVern ? (ab.vernietiging_status || 'aangevraagd') : undefined
      const kanVoort = isVern && status && status !== 'uitgevoerd'
      return (
        <div key={ab.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-1.5 py-0.5 rounded font-medium ${REDEN_COLORS[ab.reden as AfboekingReden] || 'text-gray-500 bg-gray-100'}`}>
            {t(AFBOEKING_REDENEN.find(r => r.v === ab.reden)?.lKey || ab.reden)}
          </span>
          {status && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${VERNIETIGING_STATUS_COLOR[status]}`} title={t('tooltip_status_per_douane')}>
              {t(VERNIETIGING_STATUS_LABEL[status])}
            </span>
          )}
          <span className="text-red-600 font-semibold">−{ab.aantal}×</span>
          <span className="text-gray-500">{fmtD(ab.datum) || ab.datum}</span>
          {kanVoort && (
            <Btn v="secondary" s="sm" cls="ml-auto" onClick={() => onVernietiging(ab)}>
              {status === 'aangevraagd' ? t('verlies_vern_btn_toestemming') : t('verlies_vern_btn_uitvoeren')}
            </Btn>
          )}
        </div>
      )
    })}
  </div>
)

const VoorraadKaart: React.FC<VoorraadKaartProps> = (p) => {
  const { voorraad, locaties, telefoon } = p
  const getoond = voorraad.filter(g => g.vrij + g.agp + g.geblokkeerd > 0 || g.besteld > 0)

  const lotRegel = (g: VoorraadVerpakking, lot: VoorraadLot) => {
    const afv = p.afvullingVan(lot.afvullingId)
    const locs = lotLocaties(lot, locaties)
    const thtDagen = dagenTot(lot.tht, p.vandaag)
    const thtCls = thtDagen != null && thtDagen < 0 ? 'text-red-700 font-semibold'
      : thtDagen != null && thtDagen <= BIER_THT_WAARSCHUWING_DAGEN ? 'text-orange-700 font-medium' : 'text-gray-600'
    const vrijeLoc = locs.find(x => !x.agp)
    const uitslaan = afv && lot.agp > 0 && !lot.geblokkeerd
    const acties: RowActie[] = afv ? [
      ...(vrijeLoc ? [{ id: 'verplaatsen', label: t('product_actie_verplaatsen'), onClick: () => p.onVerplaatsen(afv, vrijeLoc.id) }] : []),
      ...(p.onRebrand && lot.totaal > 0 ? [{ id: 'rebrand', label: t('btn_rebrand'), onClick: () => p.onRebrand!(afv) }] : []),
      ...(lot.totaal > 0 ? [{ id: 'afboeken', label: t('btn_afboeken'), soort: 'gevaar' as const, onClick: () => p.onAfboeken(afv) }] : []),
    ] : []
    const rebrandVan = afv?.rebrand_van_product_id && afv.rebrand_van_product_id !== afv.product_id ? p.productNaam(afv.rebrand_van_product_id) : ''
    const afboekingen = afv ? p.afboekingenVan(afv.id) : []
    const tekstDelen = (
      <>
        <span className="font-semibold text-gray-800">{lot.lotcode || (lot.batchNummer ? `#${lot.batchNummer}` : t('lbl_onbekend'))}</span>
        {lot.lotcode && lot.batchNummer && !telefoon && <span className="text-gray-600"> · #{lot.batchNummer}</span>}
        <span className={thtCls}> · {lot.tht ? `${t('lbl_tht')} ${fmtD(lot.tht)}` : `${t('lbl_tht')} —`}</span>
        {thtDagen != null && thtDagen < 0 && <span className="text-red-700"> {t('msg_tht_verlopen')}</span>}
        {locs.map(x => (
          <span key={x.id} className={`whitespace-nowrap ${x.agp ? 'text-purple-700' : 'text-gray-800'}`}> · <span className="font-medium">{locNaam(locaties, x.id)} {x.n}</span></span>
        ))}
      </>
    )
    return (
      <div key={lot.afvullingId} className={`px-4 py-2 border-t border-gray-100 ${telefoon ? 'bg-gray-50' : ''}`}>
        <div className="flex items-center gap-2 min-h-[44px] md:min-h-[36px]">
          <div className="flex-1 min-w-0 text-[13px] break-words">
            {tekstDelen}
            {(lot.geblokkeerd || rebrandVan) && (
              <span className="inline-flex flex-wrap gap-1.5 ml-1.5 align-middle">
                {lot.geblokkeerd && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-100 text-[11px] font-medium">{t('product_lot_geblokkeerd')}</span>}
                {rebrandVan && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[11px] font-medium" title={afv?.rebrand_opmerking || ''}>↪ {t('lbl_rebrand_van').replace('{product}', rebrandVan)}</span>}
              </span>
            )}
          </div>
          {(uitslaan || acties.length > 0) && (
            <RowActions v="kaart" cls="flex-shrink-0"
              primair={uitslaan ? { id: 'uitslaan', label: t('product_actie_uitslaan'), title: t('uitslag_badge_titel_agp'), onClick: () => p.onUitslaan(afv, Number(lotAgpId(lot, locaties))) } : undefined}
              acties={acties} />
          )}
        </div>
        {afboekingen.length > 0 && <Afboekingen lijst={afboekingen} onVernietiging={p.onVernietiging} />}
      </div>
    )
  }

  const groepKop = (g: VoorraadVerpakking) => (
    <div className={`px-4 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 ${telefoon ? '' : 'bg-gray-50 border-t border-gray-100'}`}>
      {telefoon
        ? <h4 className="w-full text-[15px] font-semibold text-gray-900">{g.naam || t('lbl_onbekend')}</h4>
        : <span className="text-sm font-semibold text-gray-900">{g.naam || t('lbl_onbekend')}</span>}
      <span className="text-sm">{groepRegel(g, p.dekking[g.sleutel] ?? null)}</span>
      <span className={telefoon ? '' : 'ml-auto'}><TekortChip g={g} /></span>
    </div>
  )

  const vernietigingen = p.lopendeVernietigingen.length > 0 && (
    <div className="px-4 py-2.5 border-t border-gray-100">
      <div className="text-sm font-semibold text-gray-800">{t('product_vernietiging_loopt')}</div>
      {p.lopendeVernietigingen.map(({ afb, afv }) => (
        <div key={afb.id} className="mt-1">
          <div className="text-xs text-gray-600">{afv?.lotcode || afv?.verpakking_naam || ''}</div>
          <Afboekingen lijst={[afb]} onVernietiging={p.onVernietiging} />
        </div>
      ))}
    </div>
  )

  const uitslaanKnop = p.agpTotaal > 0 && (
    <Btn s="sm" v="secondary" cls="whitespace-nowrap" title={t('uitslag_knop')} onClick={p.onUitslaanProduct}>
      {t('uitslag_knop_agp').replace('{n}', String(p.agpTotaal))}
    </Btn>
  )

  if (telefoon) {
    return (
      <div id={p.id} className="space-y-3">
        {getoond.length === 0 && (
          <div className="bg-white rounded-xl shadow-card px-4 py-3 text-sm text-gray-600">{t('verkoop_niets_op_voorraad')}</div>
        )}
        {getoond.map(g => (
          <section key={g.sleutel} aria-label={g.naam} className="bg-white rounded-xl shadow-card overflow-hidden">
            {groepKop(g)}
            {g.lots.map(lot => lotRegel(g, lot))}
          </section>
        ))}
        {vernietigingen && <section className="bg-white rounded-xl shadow-card overflow-hidden">{vernietigingen}</section>}
        {uitslaanKnop && <div>{uitslaanKnop}</div>}
      </div>
    )
  }

  return (
    <section id={p.id} className="bg-white rounded-xl shadow-card overflow-hidden scroll-mt-4">
      <SectionHeader title={t('product_voorraad_titel')} info={uitslaanKnop || undefined} />
      {getoond.length === 0 && <p className="px-4 py-3 text-sm text-gray-600">{t('verkoop_niets_op_voorraad')}</p>}
      {getoond.map(g => (
        <div key={g.sleutel}>
          {groepKop(g)}
          {g.lots.map(lot => lotRegel(g, lot))}
        </div>
      ))}
      {vernietigingen}
    </section>
  )
}

/** De AGP-locatie van een lot (de locatie met voorraad die AGP is). */
const lotAgpId = (lot: VoorraadLot, locaties: any[]): number | null => {
  const k = Object.keys(lot.perLocatie).find(id => isAgp(locaties, Number(id)) && Number(lot.perLocatie[Number(id)]) > 0)
  return k != null ? Number(k) : null
}

export default VoorraadKaart
