import React from 'react'
import { t } from '../../i18n'
import Segment from '../ui/Segment'
import SearchInput from '../ui/SearchInput'
import LegeStaat from '../ui/LegeStaat'
import Btn from '../ui/Btn'
import BierKleur from '../ui/BierKleur'
import type { RowActie } from '../ui/RowActions'
import ReceptRij, { ReceptChip } from './ReceptRij'
import { redenTekst, voorraadStip } from './receptTekst'
import { productEbc } from '../../utils/bierKleur'
import { ZONDER_TAG, type ReceptGebruik, type ReceptProductRef, type ReceptTellingen } from '../../utils/receptGebruik'
import {
  inGebruikLijst, archiefLijst, verborgenLijst, treffersPerSegment, receptReden,
  type ReceptSegment,
} from '../../utils/receptLijst'
import type { ReceptVoorraadOordeel } from '../../utils/ingredientVoorraad'

// De lijstkolom van de receptenpagina: het segment In gebruik · Archief ·
// Verborgen, het zoekveld en de lijst van het gekozen segment. De indeling
// zelf (wat waar staat, de regel onder een recept) staat in
// utils/receptLijst.ts; dit is de weergave.
//
// Bureau: één kaart met grijze groepskoppen. Telefoon: per groep een kop met
// daaronder de recepten als kaart; segment en zoekveld blijven onder de
// kopbalk staan.

/** Waar een rij staat: in een productgroep (met de tellingen van dat product) of los. */
export interface ReceptRijContext {
  segment: ReceptSegment
  product: ReceptProductRef | null
}

export interface ReceptLijstProps {
  /** De status per hoofdrecept (al met een lopende terugweg verwerkt). */
  gebruik: ReceptGebruik<any>[]
  telling: ReceptTellingen
  producten: any[]
  recepten: any[]
  segment: ReceptSegment
  onSegment: (s: ReceptSegment) => void
  zoek: string
  onZoek: (z: string) => void
  /** Tagfilter in het Archief (`ZONDER_TAG` = zonder tag); null = alle. */
  tag: string | null
  onTag: (tag: string | null) => void
  tagVolgorde?: string[]
  /** De gekozen tag archiveren (alle recepten met alleen die tag gaan naar Verborgen). */
  onTagArchiveren?: (tag: string) => void
  /** Het hoofdrecept dat in het detail open staat. */
  geselecteerdId: string | null
  onOpen: (id: string) => void
  /** Het ⋯-menu van een rij. */
  actiesVoor: (g: ReceptGebruik<any>, ctx: ReceptRijContext) => RowActie[]
  /** Voorraadstip (alleen In gebruik). */
  voorraadVoor?: (g: ReceptGebruik<any>) => ReceptVoorraadOordeel | null
  onProduct: (productId: number) => void
  vandaag: string
  /** Er staan helemaal geen recepten in de app. */
  geenRecepten: boolean
  /** Brewfather-sync, voor de lege staat (zonder: geen knop). */
  onSync?: () => void
}

const ReceptLijst: React.FC<ReceptLijstProps> = (p) => {
  const { segment, zoek, telling } = p
  const zoekt = zoek.trim() !== ''
  const treffers = React.useMemo(
    () => zoekt ? treffersPerSegment(p.gebruik, p.producten, zoek) : null,
    [p.gebruik, p.producten, zoek, zoekt])

  const opties = (['in_gebruik', 'archief', 'verborgen'] as ReceptSegment[]).map(s => {
    const label = t(`recept_segment_${s}`)
    const n = s === 'in_gebruik' ? telling.inGebruik : s === 'archief' ? telling.archief : telling.verborgen
    return {
      v: s,
      aria: `${label} (${n})`,
      l: <span className="whitespace-nowrap">{label} <span className="font-normal text-gray-500 tabular-nums">{n}</span></span>,
    }
  })

  // Andere segmenten met treffers: "Ook gevonden in Archief (2)".
  const ook: OokGevonden[] = treffers
    ? (['in_gebruik', 'archief', 'verborgen'] as ReceptSegment[])
      .filter(s => s !== segment && treffers[s] > 0)
      .map(s => ({ segment: s, n: treffers[s] }))
    : []

  let inhoud: React.ReactNode
  if (p.geenRecepten) {
    inhoud = (
      <LegeStaat cls="mt-1" icoon="refresh" titel={t('recept_leeg_geen_titel')} tekst={t('recept_leeg_geen_tekst')}>
        {p.onSync && <Btn v="secondary" onClick={p.onSync}>{t('recipe_sync_brewfather')}</Btn>}
      </LegeStaat>
    )
  } else if (segment === 'in_gebruik') {
    inhoud = <InGebruik {...p} ook={ook} />
  } else if (segment === 'archief') {
    inhoud = <Archief {...p} ook={ook} />
  } else {
    inhoud = <Verborgen {...p} ook={ook} />
  }

  return (
    <div>
      {/* Segment en zoeken blijven staan: op een telefoon onder kopbalk en
          paginachips (56 + 57 px), op het bureau boven in de eigen scrollkolom. */}
      <div className="sticky z-20 top-[calc(var(--kopbalk)+57px)] md:top-0 -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0 pt-1 pb-3 space-y-2"
        style={{ backgroundColor: 'var(--t-bg)' }}>
        <Segment<ReceptSegment> label={t('recept_segment_label')} waarde={segment} opties={opties} onKies={p.onSegment} cls="w-full" />
        <SearchInput placeholder={t('search_recipe')} value={zoek} onChange={p.onZoek} />
      </div>
      {inhoud}
    </div>
  )
}

// ── Opbouw ──────────────────────────────────────────────────────────────────

/** De kaart om een groep: op het bureau één doorlopende kaart, op een telefoon een kaart per groep. */
const GroepRijen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden md:rounded-none md:border-0 md:border-b md:border-gray-100">
    {children}
  </div>
)

/** De buitenkant van de lijst op het bureau. */
const LijstKaart: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="space-y-3 md:space-y-0 md:bg-white md:rounded-xl md:border md:border-gray-200 md:overflow-hidden md:shadow-card">
    {children}
  </div>
)

const GroepKop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-2 px-1 md:px-4 pt-2 pb-1.5 md:py-2 md:bg-gray-50 md:border-b md:border-gray-100 min-w-0">
    {children}
  </div>
)

interface OokGevonden { segment: ReceptSegment; n: number }

type MetOok = ReceptLijstProps & { ook: OokGevonden[] }

/** "Ook gevonden in Archief (2)": springt naar dat segment, de zoekterm blijft staan. */
const OokKnoppen: React.FC<{ ook: OokGevonden[]; onSegment: (s: ReceptSegment) => void; los?: boolean }> = ({ ook, onSegment, los = false }) => {
  if (!ook.length) return null
  const knoppen = ook.map(o => (
    <Btn key={o.segment} v="secondary" s="sm" onClick={() => onSegment(o.segment)}>
      {t('recept_ook_gevonden').replace('{segment}', t(`recept_segment_${o.segment}`)).replace('{n}', String(o.n))}
    </Btn>
  ))
  return los ? <>{knoppen}</> : <div className="flex flex-wrap items-center gap-2 py-3">{knoppen}</div>
}

const InGebruik: React.FC<MetOok> = (p) => {
  const lijst = React.useMemo(() => inGebruikLijst(p.gebruik, p.producten, p.zoek), [p.gebruik, p.producten, p.zoek])
  const [eerderOpen, setEerderOpen] = React.useState<Record<number, boolean>>({})
  const zoekt = p.zoek.trim() !== ''
  if (!lijst.aantal) {
    if (zoekt) return <NietsGevonden {...p} />
    return (
      <LegeStaat cls="mt-1" icoon="beer" titel={t('recept_leeg_in_gebruik_titel')} tekst={t('recept_leeg_in_gebruik_tekst')}>
        {p.telling.archief > 0 && (
          <Btn v="secondary" onClick={() => p.onSegment('archief')}>
            {t('recept_alle_recepten').replace('{n}', String(p.telling.archief))}
          </Btn>
        )}
      </LegeStaat>
    )
  }
  const rij = (g: ReceptGebruik<any>, product: ReceptProductRef | null, huidig: boolean) => (
    <ReceptRij key={`${product?.productId ?? 'los'}-${g.id}`}
      naam={g.naam || t('lbl_naamloos')}
      reden={redenTekst(receptReden(g, { product }), p.vandaag)}
      chips={<>
        {huidig && <ReceptChip soort="huidig">{t('recept_chip_huidig')}</ReceptChip>}
        {g.vastgepind && <ReceptChip soort="grijs">{t('recept_chip_vastgepind')}</ReceptChip>}
        {g.nietInBrewfather && <ReceptChip soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip>}
      </>}
      stip={voorraadStip(p.voorraadVoor?.(g))}
      geselecteerd={p.geselecteerdId === g.id}
      onOpen={() => p.onOpen(g.id)}
      acties={p.actiesVoor(g, { segment: 'in_gebruik', product })} />
  )
  return (
    <>
      <LijstKaart>
        {lijst.groepen.map(groep => {
          const pid = groep.product.id
          const ref = (g: ReceptGebruik<any>) => g.producten.find(x => x.productId === pid) || null
          // Bij zoeken, of als het huidige recept er niet staat (verborgen of
          // geen treffer), staan de eerdere recepten open.
          const open = zoekt || !groep.huidig || !!eerderOpen[pid]
          return (
            <section key={pid} aria-label={groep.product.naam}>
              <GroepKop>
                <BierKleur ebc={productEbc(groep.product, p.recepten)} s="md" />
                <button type="button" onClick={() => p.onProduct(pid)}
                  aria-label={t('recept_naar_product').replace('{product}', groep.product.naam || t('lbl_naamloos'))}
                  className="min-w-0 truncate text-sm font-semibold text-gray-900 hover:underline min-h-tap md:min-h-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
                  {groep.product.naam || t('lbl_naamloos')} <span aria-hidden="true" className="text-gray-400 font-normal">›</span>
                </button>
                {groep.uitRoulatie && <ReceptChip soort="grijs">{t('recept_chip_uit_roulatie')}</ReceptChip>}
              </GroepKop>
              <GroepRijen>
                {groep.huidig && rij(groep.huidig, ref(groep.huidig), true)}
                {groep.eerder.length > 0 && groep.huidig && !zoekt && (
                  <button type="button" aria-expanded={open} onClick={() => setEerderOpen(o => ({ ...o, [pid]: !o[pid] }))}
                    className="w-full text-left px-3 md:px-4 py-2 min-h-tap md:min-h-0 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                    {(groep.eerder.length === 1 ? t('recept_eerder_een') : t('recept_eerder_n').replace('{n}', String(groep.eerder.length)))}
                    {' '}<span aria-hidden="true">{open ? '▴' : '▾'}</span>
                  </button>
                )}
                {open && groep.eerder.map(g => rij(g, ref(g), false))}
              </GroepRijen>
            </section>
          )
        })}
        {lijst.zonderProduct.length > 0 && (
          <section aria-label={t('recept_zonder_product')}>
            <GroepKop>
              <span aria-hidden="true" className="inline-block w-4 h-4 rounded-full border border-dashed border-gray-300 bg-white flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-900">{t('recept_zonder_product')}</span>
            </GroepKop>
            <GroepRijen>
              {lijst.zonderProduct.map(g => rij(g, null, false))}
            </GroepRijen>
          </section>
        )}
      </LijstKaart>
      <OokKnoppen ook={p.ook} onSegment={p.onSegment} />
    </>
  )
}

const Archief: React.FC<MetOok> = (p) => {
  const a = React.useMemo(
    () => archiefLijst(p.gebruik, { zoek: p.zoek, tag: p.tag, tagVolgorde: p.tagVolgorde }),
    [p.gebruik, p.zoek, p.tag, p.tagVolgorde])
  if (!a.aantal) return <NietsGevonden {...p} />
  const chip = (waarde: string | null, label: string, n: number) => {
    const aan = (a.tag ?? null) === waarde
    return (
      <button key={waarde ?? '*'} type="button" aria-pressed={aan} onClick={() => p.onTag(aan ? null : waarde)}
        className={`flex-shrink-0 inline-flex items-center gap-1 min-h-tap md:min-h-[30px] px-3 rounded-full border text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${aan ? 'font-semibold' : 'font-medium bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
        style={aan ? { backgroundColor: 'var(--t-pale)', color: 'var(--t-accent-text, var(--t-accent))', borderColor: 'var(--t-accent-edge, var(--t-accent))' } : undefined}>
        {label} <span className="font-normal opacity-70 tabular-nums">{n}</span>
      </button>
    )
  }
  return (
    <>
      {/* De Brewfather-tags als filter. Telefoon: één rij die zijwaarts
          schuift (zoals de paginachips); bureau: ze lopen door op de volgende regel. */}
      <div role="group" aria-label={t('recept_tags_filter')}
        className="flex gap-1.5 overflow-x-auto nav-scroll md:flex-wrap md:overflow-visible pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0">
        {chip(null, t('recept_tag_alle'), a.aantal)}
        {a.tags.map(c => chip(c.tag, c.tag, c.aantal))}
        {(a.zonderTag > 0 || a.tag === ZONDER_TAG) && chip(ZONDER_TAG, t('lbl_without_tag'), a.zonderTag)}
      </div>
      {a.tag && a.tag !== ZONDER_TAG && p.onTagArchiveren && a.lijst.length > 0 && (
        <div className="flex items-center justify-between gap-2 pb-2 min-w-0">
          <span className="text-xs text-gray-500 truncate">{t('recept_tag_info').replace('{tag}', a.tag).replace('{n}', String(a.lijst.length))}</span>
          <Btn v="ghost" s="sm" onClick={() => p.onTagArchiveren!(a.tag!)}>{t('btn_tag_archive')}</Btn>
        </div>
      )}
      {a.lijst.length === 0 ? (
        <LegeStaat titel={t('recept_tag_geen')}>
          <Btn v="secondary" s="sm" onClick={() => p.onTag(null)}>{t('recept_tag_alle_tonen')}</Btn>
        </LegeStaat>
      ) : (
        <LijstKaart>
          <GroepRijen>
            {a.lijst.map(g => (
              <ReceptRij key={g.id}
                naam={g.naam || t('lbl_naamloos')}
                reden={redenTekst(receptReden(g, { metStijl: true }), p.vandaag)}
                chips={g.nietInBrewfather ? <ReceptChip soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip> : null}
                geselecteerd={p.geselecteerdId === g.id}
                onOpen={() => p.onOpen(g.id)}
                acties={p.actiesVoor(g, { segment: 'archief', product: null })} />
            ))}
          </GroepRijen>
        </LijstKaart>
      )}
      <OokKnoppen ook={p.ook} onSegment={p.onSegment} />
    </>
  )
}

const Verborgen: React.FC<MetOok> = (p) => {
  const lijst = React.useMemo(() => verborgenLijst(p.gebruik, p.zoek), [p.gebruik, p.zoek])
  if (!lijst.length) {
    if (p.zoek.trim() !== '') return <NietsGevonden {...p} />
    return <LegeStaat cls="mt-1" titel={t('recept_leeg_verborgen')} />
  }
  return (
    <>
      <LijstKaart>
        <GroepRijen>
          {lijst.map(g => (
            <ReceptRij key={g.id} gedimd
              naam={g.naam || t('lbl_naamloos')}
              reden={redenTekst(receptReden(g, { metStijl: true }), p.vandaag)}
              chips={<>
                {g.ookInGebruikBij.length > 0
                  ? g.ookInGebruikBij.map(pr => (
                    <ReceptChip key={pr.productId} soort="oranje">{t('recept_chip_nog_in_gebruik_bij').replace('{product}', pr.naam)}</ReceptChip>
                  ))
                  : g.ookInGebruik && <ReceptChip soort="oranje">{t('recept_chip_nog_in_gebruik')}</ReceptChip>}
                {g.verborgenReden === 'tags' && (
                  <ReceptChip soort="grijs">{t('recept_chip_via_tag').replace('{tag}', g.tags.join(', '))}</ReceptChip>
                )}
                {g.nietInBrewfather && <ReceptChip soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip>}
              </>}
              geselecteerd={p.geselecteerdId === g.id}
              onOpen={() => p.onOpen(g.id)}
              acties={p.actiesVoor(g, { segment: 'verborgen', product: null })} />
          ))}
        </GroepRijen>
      </LijstKaart>
      <OokKnoppen ook={p.ook} onSegment={p.onSegment} />
    </>
  )
}

/** Niets in dit segment bij deze zoekterm: zeggen, met de andere segmenten en het wissen. */
const NietsGevonden: React.FC<MetOok> = (p) => {
  const zoekt = p.zoek.trim() !== ''
  if (!zoekt) {
    // Archief zonder zoekterm leeg: alles is in gebruik of verborgen.
    return <LegeStaat cls="mt-1" titel={t('recept_leeg_archief')} />
  }
  return (
    <LegeStaat cls="mt-1" icoon="search" titel={t('recipe_no_results')}
      tekst={t('recept_geen_resultaat_segment').replace('{zoek}', p.zoek.trim()).replace('{segment}', t(`recept_segment_${p.segment}`))}>
      <OokKnoppen ook={p.ook} onSegment={p.onSegment} los />
      <Btn v="secondary" s="sm" onClick={() => p.onZoek('')}>{t('recipe_zoek_wissen')}</Btn>
    </LegeStaat>
  )
}

export default ReceptLijst
