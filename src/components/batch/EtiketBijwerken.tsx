import React from 'react'
import { t, getLang } from '../../i18n'
import { tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { wcGet, wcPut } from '../../utils/api'
import { wcFoutMelding } from '../../utils/wcFout'
import { CRAFTERY_SLEUTELS } from '../../utils/craftery'
import { wcArtikelPush, wcMetaStandNaPush, wcMetStand } from '../../utils/wcProduct'
import {
  allergeenRegel, energieKeuze, etiketDialoogKop, etiketGetalReden, etiketGetalTekst, etiketGetalVoorstellen,
  etiketWaarden, etiketWijzigingUitKeuze, keuzeVraagtNieuweVersie, legEtiketVast, metEtiketVan, productEtiketWaarden,
  receptEtiketWaarden, referentieBatch, sorteerAllergenen, volgendeEtiketVersie, webshopBevatRegel, webshopPayload,
  webshopVoorstel,
} from '../../utils/etiket'
import type {
  EtiketCtx, EtiketGetalVoorstel, EtiketKeuze, EtiketWaarden, WebshopArtikelVoorstel, WebshopVoorraadCtx,
  WebsiteStandOordeel,
} from '../../utils/etiket'
import { datumKort, websiteOordeelVoorProduct } from '../../utils/etiketKaart'
import { huidigReceptVoorProduct } from '../../utils/productKeten'
import type { Allergeen, Product } from '../../types'
import Modal from '../ui/Modal'
import Onderblad from '../ui/Onderblad'
import Segment from '../ui/Segment'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import EtiketAllergenen from '../ui/EtiketAllergenen'
import { useUndo } from '../ui/UndoBar'
import { useSmalScherm } from '../ui/useSmalScherm'

// "Etiket bijwerken" (opzet 5.4, SPEC scherm G en H) — de énige schrijfweg voor
// wat er op het gedrukte etiket staat: allergenen, alcohol, bitterheid, kleur,
// energie en de etiketversie (`legEtiketVast` in utils/etiket.ts). Te openen
// vanaf de etiketkaart op de batch, vanaf het product, vanuit de
// HACCP-allergenenmatrix en vanuit CCP 3 — overal dezelfde dialoog.
//
// Drie blokken: (1) de allergenen zoals ze op het nieuwe etiket gedrukt
// staan — beginnend bij het huidige etiket, nooit bij de batch; (2) de
// getallen oud → nieuw uit de referentiebatch, alleen aangevinkt bij een leeg
// veld of een ABV buiten de marge, en de energie (niet vermeld | vermeld);
// (3) de etiketversie, verplicht nieuw als allergenen of alcohol wijzigen, met
// het vinkje "Ik heb het gedrukte etiket v4 voor me". Daarna, als WooCommerce
// aan staat: "Ook naar de webshop?" met per artikel wat er verandert — alleen
// bierinformatie, nooit prijs of voorraad, en nooit vanzelf.
//
// Eén keer gemount in App.tsx; de pagina's openen hem met
// `useEtiketBijwerken()?.open({productId, batchId?, stap?})`.

type ProductLike = Pick<Product, 'id'> & Partial<Product>
type BatchLike = {id: number} & Partial<Record<string, any>>

/** De administratie achter de dialoog: wat `etiketWaarden` en
 *  `productEtiketWaarden` lezen, plus de voorraad en de etiketcontroles voor
 *  de Bevat-regel van de webshop. */
export interface EtiketBijwerkenData extends EtiketCtx, WebshopVoorraadCtx {
  batches?: BatchLike[] | null
  producten?: ProductLike[] | null
}

/** Wat een pagina vraagt. */
export interface EtiketVerzoek {
  productId: number
  /** Vergelijk met deze batch (de batchpagina, CCP 3); anders de referentiebatch. */
  batchId?: number | null
  /** `webshop`: meteen "Ook naar de webshop?" (de knop "Naar webshop" op de kaart). */
  stap?: 'etiket' | 'webshop'
}

/** Wat de pagina's via de context krijgen. */
export interface EtiketBijwerkenDienst {
  /** Opent de dialoog. */
  open: (verzoek: EtiketVerzoek) => void
  /** De administratie (ook voor een etiketkaart elders). */
  data: EtiketBijwerkenData
  /** Staat WooCommerce aan, met de themavelden? Anders geen webshopstap. */
  webshopAan: boolean
  /** De Bevat-regel die elke push naar de webshop meestuurt. */
  bevatRegel: (product: ProductLike) => string
  /** Loopt de webshop achter op het etiket? (prop `website` van de EtiketKaart) */
  website: (product: ProductLike) => WebsiteStandOordeel
}

const EtiketBijwerkenContext = React.createContext<EtiketBijwerkenDienst | null>(null)
export const EtiketBijwerkenProvider = EtiketBijwerkenContext.Provider

/** De dialoog openen vanaf een pagina. Null zonder provider (dan geen knop). */
export const useEtiketBijwerken = (): EtiketBijwerkenDienst | null => React.useContext(EtiketBijwerkenContext)

const ONBEKEND: WebsiteStandOordeel = {status: 'onbekend', verschillen: [], standOp: null}

/** De dienst voor de provider (App.tsx maakt hem één keer per stand van de data). */
export const maakEtiketDienst = (
  data: EtiketBijwerkenData,
  open: (verzoek: EtiketVerzoek) => void,
  webshopAan: boolean,
): EtiketBijwerkenDienst => {
  const bevatRegel = (product: ProductLike) => webshopBevatRegel(product, data, t)
  return {
    open, data, webshopAan, bevatRegel,
    website: product => (webshopAan
      ? websiteOordeelVoorProduct(product, data.productArtikelen,
        {recepten: data.recepten, ingredienten: data.ingredienten, bevatRegel: bevatRegel(product)})
      : ONBEKEND),
  }
}

export interface EtiketBijwerkenProps {
  /** Het product (de nieuwste stand: na het vastleggen leest de webshopstap hem). */
  product: ProductLike
  /** Vergelijk met deze batch; zonder: de referentiebatch van het product, anders het huidige recept. */
  batch?: BatchLike | null
  data: EtiketBijwerkenData
  /** `webshop`: meteen "Ook naar de webshop?". */
  stap?: 'etiket' | 'webshop'
  setProducten: (fn: (prev: any[]) => any[]) => void
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  /** WooCommerce aan (met themavelden): dan volgt de webshopstap. Zonder: niet. */
  webshop?: {
    setProductArtikelen: (fn: (prev: any[]) => any[]) => void
    /** Regel in het synchronisatielog van WooCommerce. */
    onLog?: (soort: 'push' | 'fout', melding: string, details?: string) => void
  } | null
  onSluit: () => void
}

const tekst = (v: unknown): string => String(v ?? '').trim()
const heel = (n: number | null): string => (n === null ? '' : String(Math.round(n)))
const vul = (sleutel: string, params: Record<string, string | number>, fallback?: string): string => {
  let s = t(sleutel, fallback)
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}

const LABEL: Record<EtiketGetalVoorstel['veld'], string> = {
  abv: 'etiket_regel_abv', ibu: 'etiket_regel_ibu', ebc: 'etiket_regel_ebc',
}

const EtiketBijwerken: React.FC<EtiketBijwerkenProps> = ({
  product, batch, data, stap: beginStap = 'etiket', setProducten, auditLog, setAuditLog, webshop, onSluit,
}) => {
  const smal = useSmalScherm()
  const undo = useUndo()
  const taal = getLang()
  const naam = tekst(product.naam) || t('lbl_naamloos')
  const [stap, setStap] = React.useState<'etiket' | 'webshop'>(beginStap === 'webshop' && webshop ? 'webshop' : 'etiket')

  // ── Waartegen: de batch, anders de referentiebatch, anders het recept ──
  const ref = React.useMemo(() => batch || referentieBatch(product, data.batches), [batch, product, data.batches])
  const recept = React.useMemo(() => {
    if (ref) return null
    const h = huidigReceptVoorProduct(product, data.batches, data.recepten)
    return h.receptId ? (data.recepten || []).find(r => r.id === h.receptId) || null : null
  }, [ref, product, data.batches, data.recepten])
  // Het product van bij het openen: de keuzes beginnen daar, en zo vergelijkt
  // de dialoog niet met zijn eigen, net vastgelegde etiket.
  const [begin] = React.useState<ProductLike>(() => ({...product}))
  const batchW: EtiketWaarden | null = React.useMemo(
    () => (ref ? etiketWaarden(ref, data) : recept ? receptEtiketWaarden(recept, data) : null),
    [ref, recept, data])
  const productW = React.useMemo(() => productEtiketWaarden(begin, data), [begin, data])
  const voorstellen = React.useMemo(
    () => (batchW ? etiketGetalVoorstellen(batchW, productW) : []), [batchW, productW])

  // ── De keuzes: allergenen vanaf het huidige etiket, nooit vanaf de batch ──
  const gezet = Array.isArray(begin.allergenen)
  const [sel, setSel] = React.useState<string[]>(() => (gezet ? sorteerAllergenen(begin.allergenen) : []))
  const [geenAllergenen, setGeenAllergenen] = React.useState(false)
  const [aan, setAan] = React.useState<Partial<Record<EtiketGetalVoorstel['veld'], boolean>>>(
    () => Object.fromEntries(voorstellen.map(g => [g.veld, g.aan])))
  const berekend = batchW && batchW.energie.bron !== 'geen' ? batchW.energie : null
  const [energie, setEnergie] = React.useState<EtiketKeuze['energie']>(() => energieKeuze(begin))
  // Bij "Vermeld" de waarden van het etiket; zet je hem nu op "Vermeld", dan
  // staat de berekende waarde (kcal én kJ) klaar om na te kijken.
  const vermeldBegin = begin.energie_op_etiket === 'vermeld'
  const [kcal, setKcal] = React.useState<string>(() =>
    (vermeldBegin ? tekst(begin.kcal) : '') || (berekend ? heel(berekend.kcal) : ''))
  const [kj, setKj] = React.useState<string>(() =>
    (vermeldBegin ? tekst(begin.kj) : '') || (berekend ? heel(berekend.kj) : ''))
  const [versieHand, setVersieHand] = React.useState<string | null>(null)
  const [datum, setDatum] = React.useState<string>(tod())
  const [bevestigd, setBevestigd] = React.useState(false)
  const [fout, setFout] = React.useState<string | null>(null)

  const allergenenKeuze: Allergeen[] | null = sel.length ? (sel as Allergeen[])
    : gezet ? [] : geenAllergenen ? [] : null
  const huidigeVersie = tekst(begin.etiket_versie)
  const voorstelVersie = volgendeEtiketVersie(huidigeVersie, datum)
  const basisKeuze: EtiketKeuze = {
    allergenen: allergenenKeuze, getallen: voorstellen, aan, energie, kcal, kj, versie: huidigeVersie,
  }
  const nieuweVersieNodig = keuzeVraagtNieuweVersie(begin, basisKeuze)
  // De versie volgt de keuze (een voorstel als het moet) tot je hem zelf typt.
  const versie = versieHand ?? (nieuweVersieNodig ? voorstelVersie.versie : huidigeVersie)
  const keuze: EtiketKeuze = {...basisKeuze, versie}
  const wijziging = etiketWijzigingUitKeuze(begin, keuze)
  const versieWijzigt = wijziging.etiket_versie !== undefined
  const proef = legEtiketVast(begin, wijziging, {datum, bevestigd: true, t})
  // (`'fout' in`: de pagina's draaien zonder strict, daar versmalt `ok` niet.)
  const proefFout = 'fout' in proef ? proef.fout : null
  const heeftWijziging = proef.ok && proef.gewijzigd.length > 0
  const magOpslaan = heeftWijziging && !proefFout && (!versieWijzigt || bevestigd)

  // ── De webshop: wat er per artikel verandert ──
  const voorstelVoor = (p: ProductLike): WebshopArtikelVoorstel[] => {
    if (!webshop) return []
    const pw = productEtiketWaarden(p, data)
    return webshopVoorstel(p, data.productArtikelen, {
      recepten: data.recepten, ingredienten: data.ingredienten, verpakkingen: data.verpakkingen,
      bevatRegel: webshopBevatRegel(p, data, t),
      energieBerekend: pw.energie.vermeld ? null : pw.energie.kcal,
    })
  }
  const webshopNa = stap === 'etiket' && heeftWijziging && proef.ok ? voorstelVoor(proef.product) : []
  const webshopAantal = webshopNa.filter(a => a.regels.length).length

  const opslaan = () => {
    setFout(null)
    const r = legEtiketVast(begin, wijziging, {datum, bevestigd: !versieWijzigt || bevestigd, t})
    if ('fout' in r) { setFout(r.fout); return }
    if (!r.gewijzigd.length || !r.audit) { onSluit(); return }
    const id = Number(product.id)
    setProducten(prev => (prev || []).map(p => (Number(p.id) === id ? metEtiketVan(p, r.product) : p)))
    logAudit(auditLog, setAuditLog, r.audit)
    const vorig = begin
    const audit = r.audit
    undo.plan(`etiket-${id}`, vul('etiket_bijwerken_undo', {naam, versie: tekst(r.product.etiket_versie) || '—'}), () => {}, () => {
      setProducten(prev => (prev || []).map(p => (Number(p.id) === id ? metEtiketVan(p, vorig) : p)))
      logAudit([], setAuditLog, {
        entiteit: 'Product', entiteit_id: id, actie: 'gewijzigd',
        velden: Object.fromEntries(Object.entries(audit.velden).map(([v, w]) => [v, {oud: w.nieuw, nieuw: w.oud}])),
        omschrijving: `${naam} — ${t('etiket_bijwerken_teruggezet')}`,
      })
    })
    if (webshop && webshopAantal > 0) setStap('webshop')
    else onSluit()
  }

  const titel = smal ? vul('etiket_bijwerken_titel_kort', {naam}) : vul('etiket_bijwerken_titel', {naam})

  // "Vergeleken met #2609 (conditioneert in GV1) · nu op het etiket: v3 van 8-4-2025"
  const kop = etiketDialoogKop({batch: ref, recept, product: begin, kort: smal}, t)

  const blokKop = (s: string) => <h4 className="text-base font-semibold text-gray-900">{s}</h4>

  // ── Blok 1: allergenen ──
  const bevatVoorbeeld = allergenenKeuze === null ? t('etiket_oordeel_leeg')
    : (allergeenRegel(allergenenKeuze, t) || t('etiket_allergenen_geen'))
  const blokAllergenen = (
    <section className="space-y-2">
      {blokKop(t('etiket_bijwerken_allergenen'))}
      <p className="text-sm text-gray-600">{t('etiket_bijwerken_allergenen_uitleg')}</p>
      <EtiketAllergenen waarde={sel} etiket={gezet ? begin.allergenen : null} onChange={setSel}
        kolommen={smal ? 1 : 2} label={t('etiket_bijwerken_allergenen')} />
      {!gezet && !sel.length && (
        <label className="flex items-center gap-3 min-h-tap px-3 rounded-lg border border-gray-200 cursor-pointer">
          <input type="checkbox" className="t-checkbox w-5 h-5" checked={geenAllergenen}
            onChange={e => setGeenAllergenen(e.target.checked)} />
          <span className="text-sm text-gray-800">{t('etiket_bijwerken_geen_allergenen')}</span>
        </label>
      )}
      <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-700">
        {t('etiket_bijwerken_op_etiket')} <strong className="font-semibold text-gray-900">{bevatVoorbeeld}</strong>
      </div>
    </section>
  )

  // ── Blok 2: getallen en energie ──
  const blokGetallen = (
    <section className="space-y-3">
      {blokKop(t('etiket_bijwerken_getallen'))}
      {voorstellen.length > 0 ? (
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {voorstellen.map(g => {
            const label = t(LABEL[g.veld])
            const waarde = etiketGetalTekst(g, t, taal)
            const reden = etiketGetalReden(g, t, taal)
            return (
              <label key={g.veld}
                className={`flex items-center gap-3 px-3 ${smal ? 'min-h-[56px] py-2' : 'min-h-[52px]'} ${g.kanWijzigen ? 'cursor-pointer' : 'bg-gray-50 cursor-not-allowed'}`}>
                <input type="checkbox" className="t-checkbox w-5 h-5 flex-shrink-0" disabled={!g.kanWijzigen}
                  checked={!!aan[g.veld] && g.kanWijzigen}
                  onChange={e => setAan(a => ({...a, [g.veld]: e.target.checked}))} />
                {smal ? (
                  <span className={`flex-1 min-w-0 ${g.kanWijzigen ? '' : 'text-gray-500'}`}>
                    <span className="block text-sm break-words"><strong className="font-semibold">{label}</strong> · {waarde}</span>
                    <span className="block text-xs text-gray-500">{reden}</span>
                  </span>
                ) : (
                  <span className={`flex-1 min-w-0 grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-center text-sm ${g.kanWijzigen ? 'text-gray-900' : 'text-gray-500'}`}>
                    <span className="font-medium">{label}</span>
                    <span className="break-words">{waarde}</span>
                    <span className="text-gray-600 break-words">{reden}</span>
                  </span>
                )}
              </label>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-500">{t('etiket_bijwerken_geen_batch')}</p>
      )}
      <div className={smal ? 'space-y-2' : 'flex items-start justify-between gap-4'}>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800">{t('etiket_bijwerken_energie')}</div>
          {energie === 'niet_vermeld' && (
            <div className="text-xs text-gray-500 mt-0.5">
              {berekend && berekend.kcal !== null && berekend.kj !== null
                ? vul('etiket_bijwerken_energie_website', {kcal: heel(berekend.kcal), kj: heel(berekend.kj)})
                : t('etiket_bijwerken_energie_geen')}
            </div>
          )}
        </div>
        <Segment<EtiketKeuze['energie']> waarde={energie} onKies={setEnergie} label={t('etiket_bijwerken_energie')}
          cls={smal ? 'w-full' : 'flex-shrink-0 min-w-[16rem]'}
          opties={[{v: 'niet_vermeld', l: t('etiket_bijwerken_niet_vermeld')}, {v: 'vermeld', l: t('etiket_bijwerken_vermeld')}]} />
      </div>
      {energie === 'vermeld' && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <Inp label={t('etiket_bijwerken_kcal')} type="number" min={0} step={1} value={kcal} onChange={setKcal} />
            <Inp label={t('etiket_bijwerken_kj')} type="number" min={0} step={1} value={kj} onChange={setKj} />
          </div>
          <p className="text-xs text-gray-500">
            {berekend && berekend.kcal !== null && berekend.kj !== null
              ? vul('etiket_bijwerken_energie_berekend', {kcal: heel(berekend.kcal), kj: heel(berekend.kj)})
              : t('etiket_oordeel_energie_info')}
          </p>
        </div>
      )}
    </section>
  )

  // ── Blok 3: etiketversie ──
  const blokVersie = (
    <section className="space-y-3">
      {blokKop(t('etiket_bijwerken_versie'))}
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div>
          <Inp label={t('etiket_bijwerken_versie_veld')} value={versie} onChange={v => setVersieHand(v)} />
          <div className="text-xs text-gray-500 mt-1">
            {versieWijzigt
              ? (huidigeVersie ? vul('etiket_bijwerken_versie_voorstel', {vorige: huidigeVersie}) : t('etiket_bijwerken_versie_eerste'))
              : t('etiket_bijwerken_versie_huidig')}
          </div>
        </div>
        <Inp label={t('lbl_datum')} type="date" value={datum} onChange={v => setDatum(v || tod())} />
      </div>
      {versieWijzigt && (
        <label className="flex items-center gap-3 min-h-tap px-3 py-2 rounded-xl border border-orange-200 bg-orange-50 cursor-pointer">
          <input type="checkbox" className="t-checkbox w-5 h-5 flex-shrink-0" checked={bevestigd}
            onChange={e => setBevestigd(e.target.checked)} />
          <span className="text-sm font-medium text-gray-900">{vul('etiket_bijwerken_bevestig', {versie})}</span>
        </label>
      )}
      <p className="text-xs text-gray-500">{vul('etiket_bijwerken_ccp3', {versie: versie || '—'})}</p>
    </section>
  )

  const meldingFout = fout || proefFout
  const knopLabel = versieWijzigt ? vul('etiket_bijwerken_vastleggen_versie', {versie}) : t('etiket_bijwerken_vastleggen')
  const daarna = webshopAantal === 1 ? t('etiket_bijwerken_daarna_een')
    : webshopAantal > 1 ? vul('etiket_bijwerken_daarna', {n: webshopAantal}) : ''

  const etiketInhoud = (
    <div className="space-y-5">
      {!smal && <p className="text-sm text-gray-600 -mt-1">{kop}</p>}
      {blokAllergenen}
      <div className="border-t border-gray-100" />
      {blokGetallen}
      <div className="border-t border-gray-100" />
      {blokVersie}
      {meldingFout && <p role="alert" className="text-sm text-red-700">{t(meldingFout)}</p>}
    </div>
  )

  // ── De webshopstap: inhoud en knoppen apart (op de telefoon staan de
  //    knoppen vast onderin het onderblad) ──
  const web = useWebshopStap({
    product, naam, voorstel: stap === 'webshop' ? voorstelVoor(product) : [], webshop: webshop || null,
    vastgelegd: beginStap !== 'webshop', undoId: `etiket-${Number(product.id)}`, onSluit, smal,
  })

  // Na "vastleggen" naar de webshopstap: terug naar boven (anders blijft het
  // venster staan waar de knop was en valt "vastgelegd · Ongedaan maken"
  // buiten beeld) en de focus naar de nieuwe inhoud — de knop is weg.
  const webRef = React.useRef<HTMLDivElement>(null)
  const vorigeStap = React.useRef(stap)
  React.useEffect(() => {
    if (vorigeStap.current === stap) return
    vorigeStap.current = stap
    const el = webRef.current
    if (!el) return
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) { p.scrollTop = 0; break }
    }
    el.focus({preventScroll: true})
  }, [stap])
  const webInhoud = <div ref={webRef} tabIndex={-1} className="outline-none">{web.inhoud}</div>

  if (smal) {
    return (
      <Onderblad zelfstandig sluitKruis titel={titel} sub={stap === 'etiket' ? kop : t('etiket_webshop_titel')}
        onAnnuleer={onSluit}
        voet={stap === 'etiket' ? (
          <div className="space-y-1.5">
            <Btn s="lg" cls="w-full" disabled={!magOpslaan} onClick={opslaan}>{knopLabel}</Btn>
            {daarna && <p className="text-xs text-gray-500 text-center">{daarna}</p>}
          </div>
        ) : web.knoppen}>
        {stap === 'etiket' ? etiketInhoud : webInhoud}
      </Onderblad>
    )
  }
  return (
    <Modal title={titel} onClose={onSluit} wide>
      {stap === 'etiket' ? (
        <>
          {etiketInhoud}
          <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-2">
              <Btn v="secondary" onClick={onSluit}>{t('btn_cancel')}</Btn>
              <Btn disabled={!magOpslaan} onClick={opslaan}>{knopLabel}</Btn>
            </div>
            {daarna && <p className="text-xs text-gray-500">{daarna}</p>}
          </div>
        </>
      ) : (
        <>
          {webInhoud}
          <div className="mt-4 pt-4 border-t border-gray-100">{web.knoppen}</div>
        </>
      )}
    </Modal>
  )
}

// ── "Ook naar de webshop?" ──────────────────────────────────────────────────

interface WebshopStapProps {
  product: ProductLike
  naam: string
  voorstel: WebshopArtikelVoorstel[]
  webshop: EtiketBijwerkenProps['webshop'] | null
  /** Het etiket is net vastgelegd (en kan nog ongedaan gemaakt worden). */
  vastgelegd: boolean
  undoId: string
  onSluit: () => void
  smal: boolean
}

/** De waarde zoals hij in de webshop komt: een getal met zijn eenheid, de
 *  ingrediënten als tekst. Zonder bewaarde stand weten we niet wat er staat:
 *  "onbekend", niet "niets". */
const webTekst = (veld: string, w: string | null, onbekend = false): string => {
  if (w === null) return t(onbekend ? 'etiket_webshop_onbekend' : 'etiket_webshop_leeg')
  if (veld === 'ibu') return `${w} IBU`
  if (veld === 'ebc') return `${w} EBC`
  if (veld === 'kcal') return `${w} kcal`
  return w
}

/** De stap "Ook naar de webshop?": de inhoud en de knoppen apart, zodat de
 *  knoppen op de telefoon vast onderin het onderblad kunnen staan. */
const useWebshopStap = ({product, naam, voorstel, webshop, vastgelegd, undoId, onSluit, smal}: WebshopStapProps):
  {inhoud: React.ReactNode, knoppen: React.ReactNode} => {
  const undo = useUndo()
  const [keuze, setKeuze] = React.useState<Record<string, boolean>>({})
  const [bezig, setBezig] = React.useState(false)
  const [uitkomst, setUitkomst] = React.useState<Record<number, {ok: boolean, melding?: string}>>({})
  const sleutel = (a: WebshopArtikelVoorstel, s: string) => `${a.artikelId}:${s}`
  const isAan = (a: WebshopArtikelVoorstel, r: {sleutel: string, aan: boolean}) => keuze[sleutel(a, r.sleutel)] ?? r.aan
  const metVerschil = voorstel.filter(a => a.regels.length)
  const teSturen = metVerschil
    .filter(a => !uitkomst[a.artikelId]?.ok)
    .map(a => ({a, regels: a.regels.filter(r => isAan(a, r))}))
    .filter(x => x.regels.length)
  const geprobeerd = Object.keys(uitkomst).length > 0
  const mislukt = Object.values(uitkomst).filter(u => !u.ok).length
  const kanUndo = vastgelegd && undo.actie?.id === undoId

  const naarWebshop = async () => {
    if (!webshop || bezig) return
    setBezig(true)
    for (const {a, regels} of teSturen) {
      const body = webshopPayload(regels)
      try {
        const r = await wcArtikelPush(a.sku, () => body, {get: wcGet, put: wcPut})
        if (!r.gevonden) {
          const melding = vul('msg_wc_sku_onbekend', {sku: a.sku, naam: `${naam} ${a.naam}`})
          setUitkomst(u => ({...u, [a.artikelId]: {ok: false, melding}}))
          webshop.onLog?.('fout', melding)
          continue
        }
        const stand = wcMetaStandNaPush({antwoord: r.antwoord, vooraf: r.vooraf, verstuurd: r.body.meta_data, sleutels: CRAFTERY_SLEUTELS})
        const op = new Date().toISOString()
        webshop.setProductArtikelen(prev => (prev || []).map(x => (Number(x.id) === a.artikelId
          ? {...x, wc: wcMetStand({...(x.wc || {}), wc_id: x.wc?.wc_id ?? (Number(r.vooraf?.id) || undefined)}, stand, op)}
          : x)))
        setUitkomst(u => ({...u, [a.artikelId]: {ok: true}}))
        webshop.onLog?.('push', `↑ ${naam} ${a.naam} — ${t('etiket_webshop_log')}`, regels.map(x => x.sleutel).join(', '))
      } catch (e: any) {
        const melding = wcFoutMelding(e, t)
        setUitkomst(u => ({...u, [a.artikelId]: {ok: false, melding}}))
        webshop.onLog?.('fout', `${naam} ${a.naam} — ${melding}`, e?.message)
      }
    }
    setBezig(false)
  }

  const allesGelukt = geprobeerd && mislukt === 0
  const knoppen = (
    <div className={smal ? 'flex flex-col gap-2' : 'flex flex-wrap justify-end gap-2'}>
      {allesGelukt || !metVerschil.length ? (
        <Btn s={smal ? 'lg' : 'md'} cls={smal ? 'w-full' : ''} onClick={onSluit}>{t('btn_sluiten')}</Btn>
      ) : (
        <>
          <Btn v="secondary" s={smal ? 'lg' : 'md'} cls={smal ? 'w-full order-2' : ''} onClick={onSluit}>{t('etiket_webshop_later')}</Btn>
          <Btn s={smal ? 'lg' : 'md'} cls={smal ? 'w-full order-1' : ''} disabled={!webshop || bezig || !teSturen.length}
            onClick={naarWebshop}>
            {bezig ? t('lbl_bezig') : mislukt ? t('btn_opnieuw') : t('etiket_actie_webshop')}
          </Btn>
        </>
      )}
    </div>
  )

  const inhoud = (
    <div className="space-y-4">
      {vastgelegd && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          <span>{vul('etiket_webshop_vastgelegd', {versie: tekst(product.etiket_versie) || '—'})}</span>
          {kanUndo && (
            <button type="button" onClick={() => { undo.ongedaan(); onSluit() }}
              className="min-h-tap sm:min-h-0 font-semibold underline underline-offset-2">
              {t('undo_ongedaan')}
            </button>
          )}
        </div>
      )}
      <div>
        {/* Op de telefoon staat de titel al in de kop van het onderblad. */}
        {!smal && <h4 className="text-base font-semibold text-gray-900">{t('etiket_webshop_titel')}</h4>}
        <p className="text-sm text-gray-600 mt-0.5">{t('etiket_webshop_uitleg')}</p>
      </div>
      {!webshop ? (
        <p className="text-sm text-gray-600">{t('etiket_webshop_uit')}</p>
      ) : !voorstel.length ? (
        <p className="text-sm text-gray-600">{t('etiket_webshop_geen_artikelen')}</p>
      ) : (
        <div className="space-y-3">
          {voorstel.map(a => {
            const u = uitkomst[a.artikelId]
            return (
              <div key={a.artikelId} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-900">{a.naam}</span>
                  <span className="text-xs text-gray-500 font-mono">{a.sku}</span>
                  <span className="text-xs text-gray-500 sm:ml-auto">
                    {a.standOnbekend ? t('etiket_webshop_stand_onbekend')
                      : vul('etiket_webshop_stand', {datum: datumKort(tekst(a.standOp).slice(0, 10))})}
                  </span>
                </div>
                {u?.ok ? (
                  <p className="px-3 py-2 text-sm text-green-700">✓ {t('etiket_webshop_bijgewerkt')}</p>
                ) : !a.regels.length ? (
                  <p className="px-3 py-2 text-sm text-gray-600">{t('etiket_webshop_bij')}</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {a.regels.map(r => (
                      <label key={r.sleutel} className="flex items-start gap-3 px-3 py-2 min-h-tap cursor-pointer">
                        <input type="checkbox" className="t-checkbox w-5 h-5 mt-0.5 flex-shrink-0" checked={isAan(a, r)}
                          disabled={bezig}
                          onChange={e => setKeuze(k => ({...k, [sleutel(a, r.sleutel)]: e.target.checked}))} />
                        <span className="flex-1 min-w-0 text-sm text-gray-900">
                          <span className="font-medium">{t(r.veld === 'kcal' ? 'etiket_regel_energie' : `etiket_regel_${r.veld}`, r.veld)}</span>
                          {r.berekend && <span className="text-gray-500"> ({t('etiket_webshop_berekend')})</span>}
                          <span className="block text-gray-700 break-words">
                            <span className="text-gray-500">{webTekst(r.veld, r.website, a.standOnbekend)}</span>
                            {' → '}
                            {webTekst(r.veld, r.nu)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {u && !u.ok && <p role="alert" className="px-3 py-2 text-sm text-red-700 border-t border-red-100 bg-red-50">{u.melding}</p>}
              </div>
            )
          })}
        </div>
      )}
      {allesGelukt && <p role="status" className="text-sm text-green-700">{t('etiket_webshop_klaar')}</p>}
    </div>
  )
  return {inhoud, knoppen}
}

export default EtiketBijwerken
