import React from 'react'
import { t, getLang } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtWeekdagDatum, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { nextBatchNummer } from '../../utils/calculations'
import { batchTitel } from '../../utils/productKeten'
import { gebruikIndex, receptGebruik } from '../../utils/receptGebruik'
import type { ReceptGebruik } from '../../utils/receptGebruik'
import { receptVoorraadOordeel } from '../../utils/ingredientVoorraad'
import type { ReceptVoorraadOordeel } from '../../utils/ingredientVoorraad'
import { verkoopOverzicht } from '../../utils/verkoopOverzicht'
import type { VerkoopCtx } from '../../utils/verkoopOverzicht'
import {
  bladBegin, besluitVoorBlad, etiketVooruitblik, ingredientenOordeel, nieuweBatchRegels, planNieuweBatch,
  productKeuzeNaKies, productPlanVoor, receptDoelen, receptVoorKeuze, tanksOpDatum, watLijst,
} from '../../utils/nieuweBatch'
import type { BladKeuze, NieuweBatchFout, NieuweBatchVerzoek } from '../../utils/nieuweBatch'
import type { ProductKeuzeWaarde } from '../../utils/batchKeten'
import Btn from '../ui/Btn'
import Modal from '../ui/Modal'
import Onderblad from '../ui/Onderblad'
import SearchInput from '../ui/SearchInput'
import { useSmalScherm } from '../ui/useSmalScherm'
import { useProductKoppeling } from './useProductKoppeling'
import NieuweBatchLijst from './NieuweBatchLijst'
import NieuweBatchPlan from './NieuweBatchPlan'
import { tankStatusRegel } from './tankOpties'

// Het blad "Wat brouw je?" (opzet hoofdstuk 3, 6 en 7; SPEC C en D): één blad
// voor een nieuwe batch — een Modal op het bureau (links de keuze, rechts het
// plan), een Onderblad op een telefoon (stap 1 de keuze, stap 2 het plan).
// Vijf ingangen, allemaal via `openNieuweBatch` in App.tsx: Brouwzaal en
// Batches (*+ Nieuwe batch*), een vrije tank (`{tank}`), *Brouwen* op een
// recept (`{receptId, versieId?}`) en *Nieuwe batch* op een product
// (`{productId}`). Pagina's krijgen hem als prop `onNieuweBatch`; een component
// dieper in de boom gebruikt `useNieuweBatch()?.open(…)`.
//
// De afleidingen staan in utils/nieuweBatch.ts; Inplannen maakt dezelfde batch
// als het oude planformulier (`planNieuweBatch`) en opent hem.

export type { NieuweBatchVerzoek } from '../../utils/nieuweBatch'

/** Wat een pagina of component krijgt om het blad te openen. */
export interface NieuweBatchDienst {
  open: (verzoek?: NieuweBatchVerzoek) => void
}

const NieuweBatchContext = React.createContext<NieuweBatchDienst | null>(null)
export const NieuweBatchProvider = NieuweBatchContext.Provider

/** Het blad openen vanuit een component. Null zonder provider (dan geen knop). */
export const useNieuweBatch = (): NieuweBatchDienst | null => React.useContext(NieuweBatchContext)

type Zetter = (fn: (prev: any[]) => any[]) => void

export interface NieuweBatchBladProps {
  verzoek: NieuweBatchVerzoek
  /** Even weg terwijl een andere dialoog erboven open staat (Etiket bijwerken); de keuzes blijven staan. */
  verborgen?: boolean
  bat: any[]; setBat: Zetter
  setBi: Zetter
  ing: any[]
  lots: any[]
  recepten: any[]
  receptenVerborgen?: any[]
  receptenGearchiveerdeTags?: string[]
  producten: any[]; setProducten: Zetter
  productArtikelen?: any[]
  tanks: any[]
  tankStatussen?: any
  /** Planningsinstelling: conditioneringstijd na het vergistingsschema (standaard 14). */
  conditionerenDagen?: number | null
  haccpInst?: any
  /** De verkoopcontext van App.tsx: "verkoop: tekort" bij een product (alleen op het bureau). */
  verkoopCtx?: VerkoopCtx | null
  setLog: Zetter
  auditLog: any[]; setAuditLog: Zetter
  /** De batch is gepland: open hem (`#/productie/batches/<id>`). */
  onGepland: (id: number) => void
  onSluit: () => void
  /** "Etiket bijwerken ›" in de vooruitblik; zonder geen link. */
  onEtiketBijwerken?: (productId: number) => void
}

const NieuweBatchBlad: React.FC<NieuweBatchBladProps> = (p) => {
  const {
    verzoek, verborgen = false, bat, setBat, setBi, ing, lots, recepten, producten, setProducten, tanks,
    setLog, auditLog, setAuditLog, onGepland, onSluit,
  } = p
  const smal = useSmalScherm()
  const vandaag = tod()
  const taal = getLang()

  // ── Wat de ingang al invult, en de keuzes van de gebruiker ────────────────
  const [begin] = React.useState(() => bladBegin(verzoek, { recepten, producten, batches: bat, vandaag }))
  const [keuze, setKeuze] = React.useState<BladKeuze | null>(begin.keuze)
  const [zonderRecept, setZonderRecept] = React.useState(false)
  const [stap, setStap] = React.useState<1 | 2>(begin.keuze ? 2 : 1)
  const [zoek, setZoek] = React.useState('')
  const [datum, setDatum] = React.useState(begin.datum)
  const [tank, setTank] = React.useState(begin.tank)
  // null = de liters van het recept (ook na een ander recept of een andere versie).
  const [liters, setLiters] = React.useState<string | null>(null)
  const [naam, setNaam] = React.useState('')
  const [productKeuze, setProductKeuze] = React.useState<ProductKeuzeWaarde | null>(begin.productKeuze)
  // Waarom Inplannen niet doorging; elke wijziging wist hem.
  const [fout, setFout] = React.useState<string | null>(null)
  const koppeling = useProductKoppeling({ producten, setProducten, recepten, bat, setBat, auditLog, setAuditLog })

  // ── Afleidingen ───────────────────────────────────────────────────────────
  const gebruik = React.useMemo(() => receptGebruik({
    recepten, batches: bat, producten, verborgen: p.receptenVerborgen, gearchiveerdeTags: p.receptenGearchiveerdeTags, vandaag,
  }), [recepten, bat, producten, p.receptenVerborgen, p.receptenGearchiveerdeTags, vandaag])
  const gebruikVan = React.useMemo(() => gebruikIndex(gebruik), [gebruik])
  const lijst = React.useMemo(() => watLijst(gebruik, { producten, zoek }), [gebruik, producten, zoek])
  const alles = React.useMemo(() => watLijst(gebruik, { producten }), [gebruik, producten])

  const recept = React.useMemo(() => receptVoorKeuze(keuze, recepten), [keuze, recepten])
  const g: ReceptGebruik<any> | null = keuze?.receptId ? gebruikVan.get(keuze.receptId) || null : null
  const plan = React.useMemo(() => productPlanVoor(recept, { producten, batches: bat, recepten }), [recept, producten, bat, recepten])
  const besluit = besluitVoorBlad(plan, productKeuze, { producten, standaardNaam: recept?.naam || naam })

  // Het product waaronder gekozen is (of dat de batch krijgt): zijn andere
  // recepten zijn een keuze bij de receptchip.
  const groepProductId = keuze?.productId ?? (besluit.product ? Number(besluit.product.id) : null)
  const groep = groepProductId == null ? null
    : [...alles.jouw, ...alles.seizoen].find(r => Number(r.product.id) === groepProductId) || null
  const andereRecepten = groep && keuze?.receptId
    ? [groep.recept, ...groep.eerder].filter(x => x.id !== keuze.receptId)
    : []

  const conditionerenDagen = p.conditionerenDagen ?? 14
  const tankRijen = React.useMemo(() => tanksOpDatum(tanks, datum, bat, recept, {
    tankStatussen: p.tankStatussen, conditionerenDagen, vandaag,
  }), [tanks, datum, bat, recept, p.tankStatussen, conditionerenDagen, vandaag])
  const batchLabel = (b: any) => batchTitel(b, { producten, recepten }, t('lbl_naamloos')).label

  const productSoort: 'bestaand' | 'nieuw' | 'geen' = besluit.product ? 'bestaand'
    : (besluit.nieuwNaam || productKeuze?.soort === 'nieuw') ? 'nieuw' : 'geen'
  const vooruitProduct = besluit.product || null
  const vooruitblik = React.useMemo(() => (recept ? etiketVooruitblik(recept, vooruitProduct, {
    batches: bat, recepten, ingredienten: ing, lots, productArtikelen: p.productArtikelen, haccpInst: p.haccpInst, productSoort,
  }) : null), [recept, vooruitProduct, bat, recepten, ing, lots, p.productArtikelen, p.haccpInst, productSoort])
  const doelen = recept && vooruitblik ? receptDoelen(recept, vooruitblik.verwacht) : null
  const ingredienten = React.useMemo(() => (recept ? ingredientenOordeel(recept, lots, ing) : null), [recept, lots, ing])

  // De voorraadchip per regel: één oordeel per recept, alleen voor wat in beeld komt.
  const voorraadCache = React.useMemo(() => new Map<string, ReceptVoorraadOordeel>(), [lots, ing])
  const voorraad = (x: ReceptGebruik<any>) => {
    let o = voorraadCache.get(x.id)
    if (!o) { o = receptVoorraadOordeel(x.recept, lots, ing); voorraadCache.set(x.id, o) }
    return o
  }
  // "verkoop: tekort": open bestellingen die niet uit voorraad kunnen (bureau).
  const verkoopTekort = React.useMemo(() => (smal || !p.verkoopCtx ? null
    : new Set(verkoopOverzicht(p.verkoopCtx).filter(r => r.urgentie === 'tekort').map(r => r.productId))),
  [smal, p.verkoopCtx])

  const batchNummer = String(nextBatchNummer(bat || [])).replace(/^#/, '')
  const litersRecept = (() => {
    const n = Number(String(recept?.batch_size ?? '').replace(',', '.'))
    return recept?.batch_size != null && recept.batch_size !== '' && Number.isFinite(n) && n > 0 ? n : null
  })()
  const naamVoorstel = besluit.product?.naam || besluit.nieuwNaam || recept?.naam || t('flow_nieuw_naam_ph')
  const naamBron: 'product' | 'recept' | null = besluit.product || besluit.nieuwNaam ? 'product' : recept ? 'recept' : null
  const gekozen = !!recept || zonderRecept
  // Telefoon, stap 1: wat de ingang al vastlegt ("voor Kadeblond", "tank GV2").
  const ingangProduct = begin.ingangProductId != null
    ? (producten || []).find((x: any) => Number(x?.id) === begin.ingangProductId) || null : null
  const ingangSub = ingangProduct ? t('nb_sub_product').replace('{product}', ingangProduct.naam || t('lbl_naamloos'))
    : begin.tank ? t('nb_sub_tank').replace('{tank}', tankRijen.find(x => x.id === begin.tank)?.naam || begin.tank)
    : undefined

  // ── Handelingen ───────────────────────────────────────────────────────────
  const wijzig = <T,>(zet: (v: T) => void) => (v: T) => { setFout(null); zet(v) }

  const kies = (x: ReceptGebruik<any>, productId: number | null) => {
    const voorstel = productPlanVoor(x.recept, { producten, batches: bat, recepten })
    setKeuze({ receptId: x.id, versieId: null, productId })
    setZonderRecept(false)
    setProductKeuze(productKeuzeNaKies(voorstel, productId, begin.ingangProductId))
    setLiters(null)
    setFout(null)
    setStap(2)
  }
  const kiesZonderRecept = () => {
    setKeuze(null)
    setZonderRecept(true)
    setProductKeuze(begin.ingangProductId != null ? { soort: 'product', productId: begin.ingangProductId } : null)
    setLiters(null)
    setFout(null)
    setStap(2)
  }
  const kiesVersie = (versieId: string | null) => {
    setKeuze(k => (k ? { ...k, versieId } : k))
    setLiters(null)
    setFout(null)
  }
  // Enter in het zoekveld kiest de eerste regel.
  const kiesEerste = () => {
    const eerste = lijst.jouw[0] || lijst.seizoen[0]
    if (eerste) { kies(eerste.recept, Number(eerste.product.id)); return }
    const los = lijst.andere[0] || lijst.archief[0]
    if (los) kies(los, null)
  }

  const foutTekst = (f: NieuweBatchFout<any>): string => {
    if (f.soort === 'naam_of_recept') return t('flow_nieuw_naam_of_recept')
    if (f.soort === 'product') return koppeling.besluitFoutTekst(f.fout) || t('flow_nieuw_naam_of_recept')
    const tk = tankRijen.find(x => x.id === f.tank)
    const r = tankStatusRegel(f.beschikbaar, batchLabel, vandaag)
    const reden = [r.hoofd, ...r.extra].join(' · ')
    return t('nb_fout_tank')
      .replace('{tank}', tk?.naam || f.tank)
      .replace('{datum}', fmtWeekdagDatum(datum, { jaar: false, lang: taal }))
      .replace('{reden}', reden)
  }

  // Eén keer inplannen: een tweede tik vóór het blad dicht is maakt geen tweede batch.
  const ingepland = React.useRef(false)
  const inplannen = () => {
    if (ingepland.current) return
    if (!gekozen) { setFout(t('nb_kies_eerst')); return }
    const r = planNieuweBatch(
      { recept, naam, datum, tank, liters: liters ?? '', productKeuze },
      { batches: bat, ingredienten: ing, producten, recepten, tanks, tankStatussen: p.tankStatussen, conditionerenDagen },
      { id: newId(bat || []), batchNummer: nextBatchNummer(bat || []), nu: new Date().toISOString(), vandaag: tod(), productId: newId(producten || []) },
    )
    if (r.ok === false) { setFout(foutTekst(r.fout)); return }
    const { batch, nieuwProduct, product, automatisch, naamZonder } = r.plan
    ingepland.current = true
    if (nieuwProduct) koppeling.voegProductToe(nieuwProduct)
    setBat((prev: any[]) => [...(prev || []), batch])
    setLog((prev: any[]) => [...(prev || []), { id: newId(prev || []), datum: tod(), type: 'aangemaakt', batch_id: batch.id, referentie: batch.naam }])
    logAudit(auditLog, setAuditLog, { entiteit: 'Batch', entiteit_id: batch.id, actie: 'aangemaakt', omschrijving: batch.naam })
    // De regels tegen de verse lijst: hun id's lopen door vanaf het hoogste.
    if (recept) setBi((prev: any[]) => nieuweBatchRegels(recept, r.plan, prev, ing))
    if (automatisch && product) koppeling.meldAutomatischeKoppeling(batch.id, product, naamZonder)
    onGepland(batch.id)
  }

  // Op het bureau begint de cursor in het zoekveld (SPEC C ①).
  const zoekRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!smal && !verborgen) zoekRef.current?.querySelector('input')?.focus()
  }, [smal, verborgen])

  if (verborgen) return null

  const zoekveld = (
    <div ref={zoekRef}>
      <SearchInput value={zoek} onChange={setZoek} placeholder={t('nb_zoek')}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); kiesEerste() } }} />
    </div>
  )
  const lijstEl = (
    <NieuweBatchLijst lijst={lijst} gekozenReceptId={keuze?.receptId ?? null}
      gekozenProductId={keuze?.productId ?? (besluit.product ? Number(besluit.product.id) : null)}
      onKies={kies} voorraad={voorraad} verkoopTekort={verkoopTekort} recepten={recepten} vandaag={vandaag}
      smal={smal} zoek={zoek} onWisZoek={() => setZoek('')} onZonderRecept={kiesZonderRecept} />
  )
  const planEl = (
    <NieuweBatchPlan vandaag={vandaag}
      recept={recept} gebruik={g} versieId={keuze?.versieId ?? null} zonderRecept={zonderRecept} nogNiets={!gekozen}
      groepProduct={groep?.product ?? null} andereRecepten={andereRecepten}
      onVersie={kiesVersie} onAnderRecept={x => kies(x, groepProductId)}
      plan={plan} productKeuze={productKeuze} onProductKeuze={wijzig(setProductKeuze)} besluit={besluit}
      producten={producten} recepten={recepten}
      datum={datum} onDatum={wijzig(setDatum)} tank={tank} onTank={wijzig(setTank)} tanks={tankRijen} batchLabel={batchLabel}
      liters={liters ?? (litersRecept != null ? String(litersRecept) : '')} litersRecept={litersRecept}
      onLiters={wijzig<string>(v => setLiters(v))}
      batchNummer={batchNummer} naam={naam} onNaam={wijzig(setNaam)} naamVoorstel={naamVoorstel} naamBron={naamBron}
      doelen={doelen} ingredienten={ingredienten} vooruitblik={vooruitblik} vooruitProduct={vooruitProduct}
      onEtiketBijwerken={p.onEtiketBijwerken} />
  )
  // Waarom Inplannen niet doorging: bij de knop, dus altijd in beeld.
  const foutEl = fout ? (
    <p role="alert" className="text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 break-words">{fout}</p>
  ) : null

  if (smal) {
    // Telefoon: stap 1 de keuze, stap 2 het plan — elk een eigen paneel
    // (key), zodat stap 2 bovenaan begint. Een ingang met een recept opent
    // meteen op stap 2.
    return stap === 1 ? (
      <Onderblad key="stap1" zelfstandig sluitKruis kruisRechts titel={t('nb_titel')} sub={ingangSub} onAnnuleer={onSluit}
        vast={zoekveld}
        voet={<Btn s="lg" cls="w-full" disabled={!gekozen} onClick={() => setStap(2)}>{gekozen ? t('nb_verder') : t('nb_kies_knop')}</Btn>}>
        {lijstEl}
      </Onderblad>
    ) : (
      <Onderblad key="stap2" zelfstandig sluitKruis kruisRechts terug={() => setStap(1)} titel={t('nb_plan')}
        sub={`#${batchNummer}`} onAnnuleer={onSluit}
        voet={<div className="space-y-2">{foutEl}<Btn s="lg" cls="w-full" onClick={inplannen}>{t('nb_inplannen')}</Btn></div>}>
        {planEl}
      </Onderblad>
    )
  }

  return (
    <Modal title={t('nb_titel')} onClose={onSluit} breedte="max-w-[920px]">
      <div className="-m-5 flex flex-col" style={{ height: 'min(800px, calc(100dvh - 180px))' }}>
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="min-h-0 flex flex-col border-r border-gray-100">
            <div className="px-4 pt-4 pb-2">{zoekveld}</div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-3" aria-label={t('nb_titel')}>
              {lijstEl}
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4 pb-5">
            <h4 className="text-sm font-semibold text-gray-800 mb-2">{t('nb_plan')}</h4>
            {planEl}
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-3 border-t border-gray-100">
          <div className="flex-1 min-w-0">{foutEl}</div>
          <Btn v="secondary" onClick={onSluit}>{t('btn_cancel')}</Btn>
          <Btn onClick={inplannen} disabled={!gekozen}>{t('nb_inplannen')}</Btn>
        </div>
      </div>
    </Modal>
  )
}

export default NieuweBatchBlad
