import React, { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { logAudit } from '../utils/audit'
import { batchTitel, receptVoorBatch } from '../utils/productKeten'
import { batchEbc } from '../utils/bierKleur'
import { volgendeStap } from '../utils/volgendeStap'
import { batchVerwijderBlokkade } from '../utils/afvullingVerwijderen'
import { berekenBatchKostprijs } from '../utils/calculations'
import { brouwKosten } from '../utils/brouwKosten'
import { etiketWaarden } from '../utils/etiket'
import type { EtiketKaartData } from '../utils/etiketKaart'
import {
  isLopend, isGesloten, groepeerLopend, geslotenPerJaar, filterBatches, productOptiesVoor, receptOptiesVoor,
  faseInfo, tankInfo, batchEtiket, stapWeergave, stapNaarBatchDoel, lijstVerwijderBlokkade, zonderBatch,
} from '../utils/batchesLijst'
import type { FilterOptie } from '../utils/batchesLijst'
import type { BatchesStand, GaNaar, GaNaarOpties } from '../utils/route'
import type { AttentieDoel } from '../utils/attentie'
import Btn from '../components/ui/Btn'
import Sel from '../components/ui/Sel'
import Segment from '../components/ui/Segment'
import type { SegmentOptie } from '../components/ui/Segment'
import SearchInput from '../components/ui/SearchInput'
import LegeStaat from '../components/ui/LegeStaat'
import { useUndo } from '../components/ui/UndoBar'
import { useSmalScherm } from '../components/ui/useSmalScherm'
import { useBreedte } from '../components/ui/useBreedte'
import LopendLijst from '../components/batches/LopendLijst'
import type { LopendRij, LopendWeergave } from '../components/batches/LopendLijst'
import GeslotenLijst from '../components/batches/GeslotenLijst'
import type { GeslotenRij } from '../components/batches/GeslotenLijst'
import BatchesAgenda from '../components/batches/BatchesAgenda'
import NieuweBatchFormulier from '../components/batches/NieuweBatchFormulier'
import type { NieuweBatchVoorinvulling } from '../components/batches/NieuweBatchFormulier'
import MetingBlad from '../components/batch/MetingBlad'
import { geslotenAantalTekst, vul } from '../components/batches/batchTekst'

type Zetter = (fn: (prev: any[]) => any[]) => void

export interface BatchesPageProps {
  /** De stand uit de route (`#/productie/batches[/gesloten|/agenda]`); terug en herladen houden hem. */
  stand: BatchesStand
  /** Een andere stand kiezen = de route (vervangt de history-entry: segmenten zijn geen stappen terug). */
  onStand: (stand: BatchesStand) => void
  /** Een batch openen: `#/productie/batches/<id>` (een history-entry, terug komt in dezelfde stand). */
  onOpenBatch?: (id: number | null, opties?: GaNaarOpties) => void
  /** De schil-navigatie: een volgende stap opent de batch op de plek van die stap (fase + stap als signaal). */
  gaNaar?: GaNaar
  /** Eenmalig signaal: filter `taken` (attentiepost "Batches met open taken") of het oude `gesloten`. */
  navDoel?: AttentieDoel | null
  onNavDoelConsumed?: () => void
  /** Een nieuwe batch met wat een ingang al invult (Brouwen op een recept, een vrije tank, een product). */
  preNieuwBatch?: NieuweBatchVoorinvulling | null
  setPreNieuwBatch?: (v: any) => void

  bat: any[]; setBat: Zetter
  bi: any[]; setBi: Zetter
  ing: any[]
  lots: any[]
  av: any[]
  /** Wat een batch niet laat verwijderen (utils/afvullingVerwijderen.ts). */
  uit?: any[]; verplaatsingen?: any[]; afboekingen?: any[]; bestellingPicks?: any[]; bestellingen?: any[]; acc?: any[]
  verpakkingen?: any[]
  onderdelen?: any[]
  /** Bron van de vaste brouwkosten in de kostprijs per liter (Gesloten), zoals op de batch. */
  inkoopFacturen?: any[]
  producten: any[]; setProducten: Zetter
  productArtikelen?: any[]
  recepten: any[]
  receptenVerborgen?: any[]
  receptenGearchiveerdeTags?: string[]
  gistMetingen: any[]; setGistMetingen: Zetter
  carbSessies?: any[]; setCarbSessies?: Zetter
  verliesRegistraties?: any[]; setVerliesRegistraties?: Zetter
  ccpMetingen?: any[]; setCcpMetingen?: Zetter
  dryHops?: any[]
  batchTakenItems?: any[]; batchTakenGroepen?: any[]
  planningInst?: any
  haccpVrijgaven?: any[]
  afvulSessies?: any[]
  haccpInst?: any
  tanks?: any[]; tankStatussen?: any
  /** Temperatuur per tank (Home Assistant): het voorstel in het meetblad. */
  haTankTemps?: Record<string, number>
  log: any[]; setLog: Zetter
  auditLog: any[]; setAuditLog: Zetter
  breweryDetails?: any
}

const VERWIJDER_UNDO = 'batch-verwijder-'

// Zoeken en de keuzes blijven staan als je vanuit de lijst een batch opent en
// terugkomt (de lijst wordt dan opnieuw opgebouwd). Eén keer, en alleen kort
// daarna: wie later via de tab terugkomt, of nogmaals op de tab tikt, begint
// met een lege lijst.
const TERUGKEER_MS = 10 * 60_000
let terugkeer: { zoek: string; product: string; recept: string; tot: number } | null = null

/**
 * Productie › Batches: één lijst van alle batches met de standen Lopend,
 * Gesloten en Agenda (opzet hoofdstuk 3, SPEC K en L). Lopend toont elke
 * batch die nog niet gesloten is — ook zonder tank — met de volgende stap;
 * Gesloten is het archief met zoeken en de recept- en productkeuze; Agenda is
 * de brouwagenda per tank met *Behoefte vs voorraad*. Een batch openen gaat
 * naar de batch als eigen pagina.
 */
const BatchesPage: React.FC<BatchesPageProps> = (p) => {
  const {
    stand, onStand, onOpenBatch, gaNaar, navDoel = null, onNavDoelConsumed,
    preNieuwBatch = null, setPreNieuwBatch,
    bat, setBat, bi, setBi, ing, lots, av, producten, setProducten, recepten, gistMetingen, setGistMetingen,
    log, setLog, auditLog, setAuditLog,
  } = p
  const smal = useSmalScherm()
  const undo = useUndo()
  const vandaag = tod()

  const [herstel] = useState(() => (terugkeer && Date.now() < terugkeer.tot ? terugkeer : null))
  useEffect(() => { terugkeer = null }, [])
  const [zoek, setZoek] = useState(herstel?.zoek || '')
  const [productFilter, setProductFilter] = useState(herstel?.product || '')
  const [receptFilter, setReceptFilter] = useState(herstel?.recept || '')
  const onthoudLijst = () => { terugkeer = { zoek, product: productFilter, recept: receptFilter, tot: Date.now() + TERUGKEER_MS } }
  // De attentiepost "Batches met open taken" landt op Lopend met alleen die batches.
  const [alleenTaken, setAlleenTaken] = useState(navDoel?.filter === 'taken')
  useEffect(() => {
    if (navDoel?.filter === 'gesloten' && stand !== 'gesloten') onStand('gesloten')
    if (navDoel) onNavDoelConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Een nieuwe batch: de knop, of een ingang elders (Brouwen op een recept,
  // een vrije tank op de brouwzaal) met wat die al invult.
  const [nieuw, setNieuw] = useState<NieuweBatchVoorinvulling | null>(null)
  useEffect(() => {
    if (!preNieuwBatch) return
    setNieuw(preNieuwBatch)
    setPreNieuwBatch?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preNieuwBatch])
  const openNieuw = () => setNieuw({})
  const [metingVoor, setMetingVoor] = useState<number | null>(null)

  const titelVan = (b: any) => batchTitel(b, { producten, recepten }, t('lbl_naamloos'))
  const openBatch = (b: any) => { onthoudLijst(); onOpenBatch?.(b.id) }

  // Een batch die net verwijderd is (vijf seconden terugweg) staat al niet meer in de lijst.
  const wachtId = (() => {
    const id = String(undo.actie?.id || '')
    return id.startsWith(VERWIJDER_UNDO) ? Number(id.slice(VERWIJDER_UNDO.length)) : null
  })()
  const zichtbaar = useMemo(() => (bat || []).filter((b: any) => !!b && b.id !== wachtId), [bat, wachtId])
  const lopendAlle = useMemo(() => zichtbaar.filter(isLopend), [zichtbaar])
  const geslotenAlle = useMemo(() => zichtbaar.filter(isGesloten), [zichtbaar])

  const zoekCtx = useMemo(() => ({ producten, recepten, afvulSessies: p.afvulSessies, afvullingen: av }),
    [producten, recepten, p.afvulSessies, av])
  const filter = { zoek, productId: productFilter ? Number(productFilter) : null, receptId: receptFilter || null }
  const heeftFilter = !!zoek.trim() || !!productFilter || !!receptFilter
  const wisFilters = () => { setZoek(''); setProductFilter(''); setReceptFilter(''); setAlleenTaken(false) }

  // ── Wat er per batch in de rij staat ────────────────────────────────────
  // Het etiket uit dezelfde berekening als de kaart in de batch.
  const etiketData: EtiketKaartData = useMemo(() => ({
    recepten, batchIngredienten: bi, ingredienten: ing, lots, afvulSessies: p.afvulSessies, afvullingen: av,
    productArtikelen: p.productArtikelen, verpakkingen: p.verpakkingen, haccpInst: p.haccpInst,
    batches: bat, producten, brouwerij: p.breweryDetails, vandaag,
  }), [recepten, bi, ing, lots, p.afvulSessies, av, p.productArtikelen, p.verpakkingen, p.haccpInst, bat, producten, p.breweryDetails, vandaag])
  const statusLog = useMemo(() => (log || []).filter((l: any) => l?.type === 'status'), [log])
  const conditionerenDagen = Number(p.planningInst?.conditioneren_dagen ?? 14)

  const lopendRijen = useMemo(() => {
    const uit = new Map<number, LopendRij>()
    for (const b of lopendAlle) {
      const etiket = batchEtiket(b, etiketData)
      const stap = volgendeStap(b, {
        vandaag, conditionerenDagen,
        batchTakenItems: p.batchTakenItems || [], batchTakenGroepen: p.batchTakenGroepen || [],
        batchIngredienten: bi, ingredienten: ing, lots, recepten, gistMetingen, dryHops: p.dryHops,
        vrijgaven: p.haccpVrijgaven, afvulSessies: p.afvulSessies, afvullingen: av,
        etiketKleur: etiket.status.kleur, abvWaarde: etiket.waarden.abv.waarde,
      })
      const eigenAv = (av || []).filter((a: any) => a?.batch_id === b.id)
      const gekoppeld = batchVerwijderBlokkade(b.id, eigenAv.map((a: any) => a.id), {
        uit: p.uit, verplaatsingen: p.verplaatsingen, afboekingen: p.afboekingen,
        picks: p.bestellingPicks, bestellingen: p.bestellingen, acc: p.acc,
      })
      const titel = titelVan(b)
      uit.set(b.id, {
        b, titel,
        recept: receptVoorBatch(b, recepten || [])?.naam || titel.receptNaam,
        ebc: batchEbc(b, producten || [], recepten || []),
        fase: faseInfo(b, { vandaag, gistMetingen, afvullingen: av, statusLog }),
        tank: tankInfo(b, p.tanks),
        etiket, stap, weergave: stapWeergave(stap), taken: stap.openTaken,
        verwijder: lijstVerwijderBlokkade(b, { afvullingen: av, gekoppeld, batchIngredienten: bi }),
      })
    }
    return uit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lopendAlle, etiketData, vandaag, conditionerenDagen, p.batchTakenItems, p.batchTakenGroepen, bi, ing, lots, recepten,
    gistMetingen, p.dryHops, p.haccpVrijgaven, p.afvulSessies, av, p.uit, p.verplaatsingen, p.afboekingen, p.bestellingPicks,
    p.bestellingen, p.acc, producten, statusLog, p.tanks])

  const lopendGefilterd = useMemo(() => filterBatches(lopendAlle, filter, zoekCtx)
    .filter((b: any) => !alleenTaken || (lopendRijen.get(b.id)?.taken || 0) > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [lopendAlle, zoek, productFilter, receptFilter, zoekCtx, alleenTaken, lopendRijen])
  const geslotenGefilterd = useMemo(() => filterBatches(geslotenAlle, filter, zoekCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geslotenAlle, zoek, productFilter, receptFilter, zoekCtx])

  const lopendGroepen = useMemo(() => groepeerLopend(lopendGefilterd)
    .map(g => ({ groep: g.groep, rijen: g.batches.map((b: any) => lopendRijen.get(b.id)).filter((r): r is LopendRij => !!r) })),
  [lopendGefilterd, lopendRijen])

  // Gesloten: wat de batch geworden is. De kostprijs per liter zoals
  // "Financieel resultaat" op de batch (vaste kosten afgeleid, alleen tonen).
  const vasteKosten = useMemo(() => brouwKosten({ batches: bat, inkoopFacturen: p.inkoopFacturen }), [bat, p.inkoopFacturen])
  const geslotenJaren = useMemo(() => {
    if (stand !== 'gesloten') return []
    return geslotenPerJaar(geslotenGefilterd).map(j => ({
      jaar: j.jaar,
      rijen: j.batches.map((b: any): GeslotenRij => {
        const titel = titelVan(b)
        const eigenAv = (av || []).filter((a: any) => a?.batch_id === b.id)
        const k = eigenAv.length
          ? berekenBatchKostprijs(b, bi, lots, eigenAv, p.verpakkingen, p.onderdelen, p.acc, null, vasteKosten)
          : null
        return {
          b, titel,
          recept: receptVoorBatch(b, recepten || [])?.naam || titel.receptNaam,
          ebc: batchEbc(b, producten || [], recepten || []),
          waarden: etiketWaarden(b, etiketData),
          stuks: eigenAv.reduce((s: number, a: any) => s + (Number(a.hoeveelheid ?? a.aantal) || 0), 0),
          kostprijsPerLiter: k && k.kostprijs_per_liter > 0 ? k.kostprijs_per_liter : null,
        }
      }),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stand, geslotenGefilterd, av, bi, lots, p.verpakkingen, p.onderdelen, p.acc, vasteKosten, recepten, producten, etiketData])

  // ── Hoe breed de lijst is: tabel, compacte tabel of kaarten ─────────────
  const [lijstRef, breedte] = useBreedte<HTMLDivElement>()
  const weergave: LopendWeergave = smal ? 'kaarten'
    : breedte == null || breedte >= 1100 ? 'breed'
    : breedte >= 760 ? 'compact' : 'kaarten'

  // ── Handelingen ─────────────────────────────────────────────────────────
  // De volgende stap: met › opent hij de batch op de plek van de stap; zonder
  // › voert hij uit (Meting = het meetblad voor deze batch).
  const voerStapUit = (r: LopendRij) => {
    if (!r.stap.opent) { setMetingVoor(r.b.id); return }
    if (!gaNaar) { openBatch(r.b); return }
    onthoudLijst()
    gaNaar(stapNaarBatchDoel(r.b.id, r.b.status, r.stap))
  }
  // Verwijderen: alleen Gepland, met vijf seconden terugweg. Dezelfde
  // opruiming als op de batch zelf; een geplande batch heeft nog geen
  // afvulling en zijn tank is alleen gereserveerd (die blijft met rust).
  const verwijder = (r: LopendRij) => {
    if (r.verwijder) return
    const id = r.b.id
    const naam = r.b.naam || r.titel.label
    undo.plan(`${VERWIJDER_UNDO}${id}`, vul(t('batches_verwijderd'), { batch: r.titel.label }), () => {
      logAudit(auditLog, setAuditLog, { entiteit: 'Batch', entiteit_id: id, actie: 'verwijderd', omschrijving: naam })
      setBat((prev: any[]) => (prev || []).filter((b: any) => b?.id !== id))
      setBi((prev: any[]) => zonderBatch(prev, id))
      setGistMetingen((prev: any[]) => zonderBatch(prev, id))
      p.setCarbSessies?.((prev: any[]) => zonderBatch(prev, id))
      p.setVerliesRegistraties?.((prev: any[]) => zonderBatch(prev, id))
      p.setCcpMetingen?.((prev: any[]) => zonderBatch(prev, id))
      setLog((prev: any[]) => zonderBatch(prev, id))
    })
  }

  // ── De keuzes: wat in de getoonde batches voorkomt (plus de gekozen) ────
  const metGekozen = <V extends string | number>(opties: FilterOptie<V>[], gekozen: string, lijst: any[], naamVan: (x: any) => string): FilterOptie<V>[] => {
    if (!gekozen || opties.some(o => String(o.id) === gekozen)) return opties
    const x = (lijst || []).find((y: any) => String(y?.id) === gekozen)
    return x ? [...opties, { id: x.id as V, naam: naamVan(x) }] : opties
  }
  const standBatches = stand === 'gesloten' ? geslotenAlle : lopendAlle
  const productOpties = useMemo(() => metGekozen(productOptiesVoor(standBatches, zoekCtx), productFilter, producten, (x: any) => String(x.naam || '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standBatches, zoekCtx, productFilter, producten])
  const receptOpties = useMemo(() => metGekozen(receptOptiesVoor(standBatches, recepten), receptFilter, recepten, (x: any) => String(x.naam || '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standBatches, recepten, receptFilter])

  const segmentOpties: SegmentOptie<BatchesStand>[] = [
    { v: 'lopend', aria: `${t('batches_stand_lopend')} ${lopendAlle.length}`,
      l: <>{t('batches_stand_lopend')} <span className="font-normal text-gray-500">{lopendAlle.length}</span></> },
    { v: 'gesloten', aria: `${t('batches_stand_gesloten')} ${geslotenAlle.length}`,
      l: <>{t('batches_stand_gesloten')} <span className="font-normal text-gray-500">{geslotenAlle.length}</span></> },
    { v: 'agenda', l: t('batches_stand_agenda') },
  ]

  const zoekbaar = stand !== 'agenda'
  // Op een telefoon in Lopend alleen zoeken (een handvol batches); in
  // Gesloten ook de keuzes.
  const toonKeuzes = zoekbaar && (!smal || stand === 'gesloten')
  const keuzes = toonKeuzes && (
    <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
      {/* De lege keuze van Sel is "alle". */}
      <Sel value={productFilter} onChange={setProductFilter} ariaLabel={t('batches_filter_product')} cls="min-w-0 md:w-48"
        ph={t('batches_filter_product_alle')}
        opts={productOpties.map(o => ({ v: String(o.id), l: vul(t('batches_filter_product_x'), { naam: o.naam }) }))} />
      <Sel value={receptFilter} onChange={setReceptFilter} ariaLabel={t('batches_filter_recept')} cls="min-w-0 md:w-56"
        ph={t('batches_filter_recept_alle')}
        opts={receptOpties.map(o => ({ v: String(o.id), l: vul(t('batches_filter_recept_x'), { naam: o.naam }) }))} />
    </div>
  )

  const nieuwKnop = (
    <Btn v="secondary" cls="min-h-tap" onClick={openNieuw}>{t('batches_nieuw_kort')}</Btn>
  )
  const naarGesloten = (tekst: string) => (
    <button type="button" onClick={() => onStand('gesloten')}
      className="font-medium t-accent-text hover:underline min-h-tap md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
      {tekst}
    </button>
  )
  // Onder Lopend: het archief, of — bij zoeken — wat daar ook gevonden is.
  const lopendVoet = heeftFilter
    ? (geslotenGefilterd.length > 0 ? naarGesloten(`${vul(t('batches_ook_gesloten'), { n: geslotenGefilterd.length })} ›`) : null)
    : (geslotenAlle.length > 0
      ? <span>{geslotenAantalTekst(geslotenAlle.length)} · {naarGesloten(`${t('batches_stand_gesloten')} ›`)}</span>
      : null)
  const geenResultaat = (
    <LegeStaat icoon="search" titel={t('flow_geen_zoekresultaat')} tekst={t('batches_geen_resultaat_tekst')}>
      <Btn v="secondary" onClick={wisFilters}>{t('batches_wis_zoeken')}</Btn>
    </LegeStaat>
  )

  const metingBatch = metingVoor != null ? (bat || []).find((b: any) => b?.id === metingVoor) : null

  return (
    <div className="space-y-4">
      {/* Bureau: kop met de ene primaire knop; op een telefoon zegt de kopbalk al waar je bent. */}
      <div className="hidden md:flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{t('nav_batches')}</h2>
        <Btn onClick={openNieuw}>{t('batches_nieuw')}</Btn>
      </div>

      {/* Segment en zoeken blijven op een telefoon staan onder kopbalk en paginachips. */}
      <div className="sticky z-20 top-[calc(var(--kopbalk)+57px)] md:static -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0 pt-1 pb-2 md:p-0 space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3"
        style={{ backgroundColor: 'var(--t-bg)' }}>
        <Segment<BatchesStand> label={t('batches_segment_label')} waarde={stand} opties={segmentOpties} onKies={onStand} cls="w-full md:w-auto md:min-w-[340px]" />
        {zoekbaar && (
          <div className="md:w-80">
            <SearchInput value={zoek} onChange={setZoek} placeholder={t('batches_zoek')} />
          </div>
        )}
        {keuzes}
      </div>

      {stand === 'lopend' && alleenTaken && (
        <div>
          <button type="button" onClick={() => setAlleenTaken(false)} aria-label={`${t('batches_alleen_taken')} — ${t('batches_filter_wissen')}`}
            className="inline-flex items-center gap-2 px-3 min-h-tap md:min-h-[32px] rounded-full bg-orange-50 text-orange-800 ring-1 ring-orange-200 text-sm font-medium">
            {t('batches_alleen_taken')} <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      <div ref={lijstRef}>
        {stand === 'lopend' && (
          lopendAlle.length === 0 ? (
            <div className="space-y-3">
              <LegeStaat icoon="beer" titel={t('batches_lopend_leeg')}>
                <Btn onClick={openNieuw}>{t('batches_nieuw')}</Btn>
              </LegeStaat>
              {lopendVoet && <div className="text-sm text-gray-600 px-1">{lopendVoet}</div>}
            </div>
          ) : lopendGroepen.length === 0 ? (
            <div className="space-y-3">
              {geenResultaat}
              {lopendVoet && <div className="text-sm text-gray-600 px-1">{lopendVoet}</div>}
            </div>
          ) : (
            <LopendLijst groepen={lopendGroepen} weergave={weergave}
              onOpen={openBatch} onStap={voerStapUit} onMeting={r => setMetingVoor(r.b.id)} onVerwijder={verwijder}
              voet={lopendVoet} nieuwKnop={smal ? nieuwKnop : undefined} telefoon={smal} />
          )
        )}

        {stand === 'gesloten' && (
          geslotenAlle.length === 0
            ? <LegeStaat icoon="beer" titel={t('batches_gesloten_leeg')} />
            : geslotenJaren.length === 0
              ? geenResultaat
              : <GeslotenLijst jaren={geslotenJaren} weergave={weergave} onOpen={openBatch} />
        )}

        {stand === 'agenda' && (
          <div className="space-y-3">
            {smal && <div className="flex justify-end">{nieuwKnop}</div>}
            <BatchesAgenda bat={zichtbaar} setBat={setBat} bi={bi} recepten={recepten} ing={ing} lots={lots}
              producten={producten} tanks={p.tanks} planningInst={p.planningInst}
              auditLog={auditLog} setAuditLog={setAuditLog}
              onOpen={openBatch} lijst={smal} vandaag={vandaag} />
          </div>
        )}
      </div>

      {nieuw && (
        <NieuweBatchFormulier
          bat={bat} setBat={setBat} setBi={setBi} ing={ing} recepten={recepten}
          receptenVerborgen={p.receptenVerborgen} receptenGearchiveerdeTags={p.receptenGearchiveerdeTags}
          producten={producten} setProducten={setProducten} tanks={p.tanks || []} tankStatussen={p.tankStatussen}
          setLog={setLog} auditLog={auditLog} setAuditLog={setAuditLog}
          voorinvulling={nieuw}
          onGepland={id => { setNieuw(null); onOpenBatch?.(id) }}
          onSluit={() => setNieuw(null)} />
      )}

      {metingBatch && (
        <MetingBlad batch={metingBatch} label={titelVan(metingBatch).label}
          gistMetingen={gistMetingen} setGistMetingen={setGistMetingen}
          auditLog={auditLog} setAuditLog={setAuditLog}
          sensorTemp={metingBatch.tank ? p.haTankTemps?.[metingBatch.tank] ?? null : null}
          onSluit={() => setMetingVoor(null)} />
      )}
    </div>
  )
}

export default BatchesPage
