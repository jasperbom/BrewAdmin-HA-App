import React from 'react'
import ReactDOM from 'react-dom'
import { t } from '../i18n'
import Btn from './ui/Btn'
import Icon from './ui/Icon'
import { useDialoogFocus } from './ui/useDialoogFocus'
import { useSmalScherm, isAanraakscherm } from './ui/useSmalScherm'
import Segment from './inkoop/Segment'
import FactuurDocument, { type DocumentBron, type Markering } from './inkoop/FactuurDocument'
import RegelLijst from './inkoop/RegelLijst'
import RegelEditor, { BronLabel, soortLabel, type RegelContext } from './inkoop/RegelEditor'
import EtiketFotos, { type EtiketStatus } from './inkoop/EtiketFotos'
import InkoopTotalen from './inkoop/InkoopTotalen'
import Onderblad from './inkoop/Onderblad'
import {
  nieuweRegel, nieuwRegelId, wisselSoort, valideerRegel, isLeegRegel, naarOpslag, vanFactuur, telOpslag,
  berekenTotalen, startRegelVoorIngredient, heeftMeerLots, type InkoopRegel, type RegelSoort,
} from '../utils/inkoopRegels'
import {
  factuurSchema, bouwFactuurPrompt, inhoudVoorFactuur, normaliseerFactuurScan, parseFactuurTekstLokaal,
  regelsUitScan, factuurScanModus, MAX_FACTUUR_FOTOS, type BtwSoort, type FactuurBestand, type FactuurScan,
} from '../utils/factuurScan'
import {
  etiketSchema, bouwEtiketPrompt, inhoudVoorEtiket, normaliseerEtiketScan, productKlopt, pasEtiketToe,
  etiketLotsWijkenAf, type EtiketScan,
} from '../utils/etiketScan'
import {
  controleerTotaal, totaalOvernemen, zoekDubbeleFactuur, normLeverancier, effectieveTotalen, naarTotaalManual,
  GEEN_HANDMATIG, type FactuurTotalen, type HandmatigeTotalen,
} from '../utils/inkoopControle'
import { koppelingenUitRegels, type ScanKoppeling } from '../utils/scanGeheugen'
import { voerScanUit, ScanFout, scanFoutSleutel, bytesNaarBase64 } from '../utils/claudeScan'
import {
  naarJpeg, fotosNaarPdf, alsBestand, naamMetExtensie, AfbeeldingFout, afbeeldingFoutSleutel,
  isPdfBestand, isFotoBestand, SCAN_MAX_PX, ARCHIEF_MAX_PX, FACTUUR_PAGINA_PX, type Jpeg,
} from '../utils/afbeelding'
import { extractPdfText } from '../utils/pdfText'
import { uploadBijlage, uploadFoutSleutel, type Bijlage } from '../utils/bijlage'
import { ADDON_BASE, callClaudeProxy } from '../utils/api'
import { tod, fmt, fmtD } from '../utils/format'
import { datumToPeriodeKey, periodeKeyLabel, type BtwPeriodeType } from '../utils/btw'
import { BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN, LOT_BREW_FIELDS_PER_TYPE } from '../utils/constants'
import { type MerchArtikel, volgtVoorraad } from '../utils/merch'
import { type InkoopInboxItem, inboxAfzender } from '../utils/inkoopInbox'

// ── Wat de pagina krijgt ────────────────────────────────────────────────────

export interface InkoopOpslag {
  factuurForm: { leverancier: string, factuur: string, datum: string, btw_soort: BtwSoort }
  productLijst: any[]
  verpakkingLijst: any[]
  vrijeRegels: any[]
  bijlage: Bijlage | null
  totaalManual: { netto: number | null, btw: number | null, bruto: number | null } | null
}

interface InkoopFactuurModalProps {
  knownLeveranciers?: string[]
  ing?: any[]
  lots?: any[]
  onderdelen?: any[]
  /** Opslaan. `false` terug = niet gelukt (het formulier blijft open). */
  onSave: (data: InkoopOpslag, opties?: { volgende?: boolean }) => boolean | void
  onClose: () => void
  /** Soort van de eerste lege regel: 'ingredienten', 'verpakkingen' of 'vrije'. */
  initialTab?: string
  /** "Lot toevoegen" bij een ingrediënt: de eerste regel staat al klaar. */
  initialIngId?: string
  claudeCreds?: any
  /** Naam van de eigen brouwerij: nooit de leverancier. */
  breweryNaam?: string
  ingTypes?: string[]
  ingTypeBtw?: Record<string, number>
  /** Een bestaande factuur (met `id`: bewerken) of voorinvulling (boeking vanuit de bank). */
  initialData?: any
  kostenSoorten?: string[]
  /** Het scangeheugen (data-sleutel `scan_correcties`). */
  scanCorrecties?: any[]
  /** Een gescande regel kreeg een andere soort: meteen onthouden. */
  onScanCorrectie?: (c: { tekst: string, soort: string }) => void
  /** Na het opslaan: hoe elke gescande regel geboekt is (utils/scanGeheugen.ts). */
  onLeer?: (koppelingen: ScanKoppeling[]) => void
  getRolloverInfo?: (datum: string) => { rolloverNaar: string, vanafPeriode: string } | null
  merchArtikelen?: MerchArtikel[]
  /** Een factuur uit het postvak: de PDF staat al op de server. */
  inboxItem?: InkoopInboxItem | null
  /** Hoeveel facturen er na deze nog in het postvak wachten ("Opslaan en volgende"). */
  volgendeAantal?: number
  /** Voor de waarschuwing "deze factuur is al geboekt". */
  inkoopFacturen?: any[]
  btwPeriodeType?: BtwPeriodeType
  /** Boeking vanuit de bank: het afgeschreven bedrag, om het totaal tegen te houden. */
  bankBedrag?: number | null
}

// ── Interne vormen ──────────────────────────────────────────────────────────

interface Kop {
  leverancier: string
  factuurnummer: string
  datum: string
  btwSoort: BtwSoort
}
type KopVeld = keyof Kop

interface Foto {
  id: number
  naam: string
  scan: Jpeg
  /** Kleiner: voor het bewaren (factuur-PDF of etiket bij het lot). */
  archief: Jpeg
  url: string
}

interface EtiketStaat {
  fotos: Foto[]
  status: EtiketStatus
  fout: string | null
  scan: EtiketScan | null
  oordeel: 'ja' | 'nee' | 'onbekend' | null
  nietToegepast: boolean
  bewaren: boolean
  versie: number
}

const nieuwEtiket = (): EtiketStaat => ({
  fotos: [], status: 'leeg', fout: null, scan: null, oordeel: null, nietToegepast: false, bewaren: true, versie: 0,
})

interface ScanStaat {
  status: 'idle' | 'bezig' | 'klaar' | 'fout' | 'geen_sleutel'
  fout?: string
  aantal?: number
  nieuw?: number
  lokaal?: boolean
  totalen?: FactuurTotalen | null
  /** Regels uit de scan die nog niet zijn overgenomen (er stond al invoer). */
  wachtend?: InkoopRegel[] | null
  verlegd?: boolean
}

const TAB_SOORT: Record<string, RegelSoort> = { ingredienten: 'ingredient', verpakkingen: 'verpakking', vrije: 'overig' }
const MAX_ETIKET_FOTOS = 8

const foutTekst = (e: unknown): string => {
  if (e instanceof ScanFout) return t(scanFoutSleutel(e.code))
  if (e instanceof AfbeeldingFout) return t(afbeeldingFoutSleutel(e.code))
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message || '') : ''
  return m || t('scan_fout_leeg')
}

/** "lot, THT en kleur" — een opsomming in de taal van de app. */
const opsomming = (delen: string[]): string => {
  if (delen.length <= 1) return delen.join('')
  return `${delen.slice(0, -1).join(', ')} ${t('lijst_en')} ${delen[delen.length - 1]}`
}

/**
 * Inkoop boeken: één werkblad voor een inkoopfactuur, op een bureau naast de
 * factuur, op een telefoon met een wissel tussen factuur en boeking. Alle
 * regels staan in één lijst; soort, lot en THT zijn velden van de regel.
 * De factuurscan vult de kop en de regels, foto's van het etiket vullen
 * lotnummer(s), THT en de eigenschappen. Er wordt pas iets geboekt bij
 * Opslaan — en nooit stil: wat er gebeurt staat eronder.
 */
function InkoopFactuurModal({
  knownLeveranciers = [], ing = [], lots = [], onderdelen = [], onSave, onClose,
  initialTab = 'ingredienten', initialIngId = '', claudeCreds = null, breweryNaam = '',
  ingTypes = BUILTIN_ING_TYPES, ingTypeBtw = {}, initialData = null,
  kostenSoorten = BUILTIN_KOSTEN_SOORTEN, scanCorrecties = [], onScanCorrectie, onLeer,
  getRolloverInfo, merchArtikelen = [], inboxItem = null, volgendeAantal = 0,
  inkoopFacturen = [], btwPeriodeType = 'kwartaal', bankBedrag = null,
}: InkoopFactuurModalProps) {
  const smal = useSmalScherm()
  const bewerken = !!(initialData && initialData.id !== undefined && initialData.id !== null)
  const defaultType = ingTypes[0] || 'Mout'
  const heeftSleutel = !!claudeCreds?.apiKey && claudeCreds?.enabled !== false
  const merch = React.useMemo(() => (merchArtikelen || []).filter(volgtVoorraad), [merchArtikelen])
  const ctx: RegelContext = { ing, lots, onderdelen, ingTypes, ingTypeBtw, kostenSoorten, merch, defaultType }

  // ── Startwaarden ──────────────────────────────────────────────────────────
  const start = React.useMemo(() => {
    const regels: InkoopRegel[] = initialData ? vanFactuur(initialData, ing, onderdelen, defaultType) : []
    let leverancier = String(initialData?.leverancier || '')
    if (!initialData && initialIngId) {
      const s = startRegelVoorIngredient(ing, lots, initialIngId, { ingTypeBtw, defaultType })
      if (s) { regels.push(s.regel); leverancier = leverancier || s.leverancier }
    }
    // Een nieuw, leeg formulier begint met één lege regel van de gevraagde soort.
    if (!regels.length && !inboxItem) {
      const soort = TAB_SOORT[initialTab] || 'ingredient'
      regels.push(nieuweRegel(soort, soort === 'ingredient'
        ? { type: defaultType, btw: ingTypeBtw[defaultType] !== undefined ? String(ingTypeBtw[defaultType]) : '9' }
        : {}))
    }
    const verlegdeRegel = (initialData?.regels || []).find((r: any) => r?.btw_soort && r.btw_soort !== 'binnenlands')
    const kop: Kop = {
      leverancier,
      factuurnummer: String(initialData?.factuurnummer || ''),
      datum: String(initialData?.datum || tod()),
      btwSoort: (verlegdeRegel?.btw_soort as BtwSoort) || 'binnenlands',
    }
    const open = !inboxItem && !bewerken && regels.length === 1 ? regels[0]._id : null
    return { regels, kop, open }
    // Eenmalig bij het openen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [kop, setKop] = React.useState<Kop>(start.kop)
  const [kopUitScan, setKopUitScan] = React.useState<KopVeld[]>([])
  const kopAangeraakt = React.useRef<Set<KopVeld>>(new Set())
  const [regels, setRegelsState] = React.useState<InkoopRegel[]>(start.regels)
  const [openId, setOpenId] = React.useState<number | null>(smal ? null : start.open)
  const [incl, setIncl] = React.useState(false)
  const [handmatig, setHandmatig] = React.useState<HandmatigeTotalen>(GEEN_HANDMATIG)
  const [toonFouten, setToonFouten] = React.useState(false)
  const [melding, setMelding] = React.useState<{ tekst: string, actie?: { label: string, doe: () => void } } | null>(null)

  // Document: een PDF (gekozen, uit het postvak of de bestaande bijlage) of foto's.
  const [pdf, setPdf] = React.useState<File | null>(null)
  const [pdfNieuw, setPdfNieuw] = React.useState(false)
  const [factuurFotos, setFactuurFotos] = React.useState<Foto[]>([])
  const [bijlage, setBijlage] = React.useState<Bijlage | null>(initialData?.bijlage || inboxItem?.bijlage || null)
  const [bestaandeAfbeelding, setBestaandeAfbeelding] = React.useState<string | null>(null)
  const [docStatus, setDocStatus] = React.useState<'geen' | 'laden' | 'klaar' | 'fout'>(
    inboxItem || initialData?.bijlage?.bestand ? 'laden' : 'geen')
  const [docZichtbaar, setDocZichtbaar] = React.useState(true)
  const [mobielTab, setMobielTab] = React.useState<'factuur' | 'boeking'>('boeking')
  const [fotoBezig, setFotoBezig] = React.useState(false)

  const [scan, setScan] = React.useState<ScanStaat>({ status: 'idle' })
  const scanVersie = React.useRef(0)
  /** De regels komen van de scan en zijn sindsdien niet aangeraakt: een nieuwe scan mag ze vervangen. */
  const scanRegelsOngemoeid = React.useRef(false)

  const [etiketten, setEtiketten] = React.useState<Record<number, EtiketStaat>>({})
  const etiketTimers = React.useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  /** Paneel op een telefoon. `kopie` = de regel bij openen (Annuleren zet hem terug); null = nieuwe regel. */
  const [sheet, setSheet] = React.useState<{ soort: 'regel' | 'soort', id: number, kopie: InkoopRegel | null } | null>(null)
  const [verwijderd, setVerwijderd] = React.useState<{ regel: InkoopRegel, index: number, etiket?: EtiketStaat } | null>(null)
  const [bezig, setBezig] = React.useState(false)
  const [dubbelOk, setDubbelOk] = React.useState(false)
  const [sluitVraag, setSluitVraag] = React.useState(false)
  const geupload = React.useRef<{ bijlage?: Bijlage, fotos: Record<number, Bijlage> }>({ fotos: {} })

  // De laatste stand voor wat asynchroon terugkomt (scan, etiket): nooit
  // overschrijven wat de gebruiker ondertussen zelf invulde.
  const stand = React.useRef({ kop, kopUitScan, regels, etiketten })
  stand.current = { kop, kopUitScan, regels, etiketten }

  // Object-URL's van foto's opruimen bij het sluiten.
  const urls = React.useRef<Set<string>>(new Set())
  const maakUrl = (b: Blob): string => { const u = URL.createObjectURL(b); urls.current.add(u); return u }
  const geefVrij = (u: string) => { if (urls.current.delete(u)) URL.revokeObjectURL(u) }
  React.useEffect(() => () => {
    urls.current.forEach(u => URL.revokeObjectURL(u))
    Object.values(etiketTimers.current).forEach(clearTimeout)
  }, [])

  // ── Regels wijzigen ───────────────────────────────────────────────────────
  const setRegels = (f: (prev: InkoopRegel[]) => InkoopRegel[], doorGebruiker = true) => {
    if (doorGebruiker) scanRegelsOngemoeid.current = false
    setRegelsState(f)
  }
  const wijzigRegel = (r: InkoopRegel) => setRegels(prev => prev.map(x => x._id === r._id ? r : x))
  const kiesSoort = (id: number, soort: RegelSoort) => {
    const r = stand.current.regels.find(x => x._id === id)
    if (!r || r.soort === soort) return
    // Het BTW-tarief blijft: dat is wat de leverancier rekende.
    wijzigRegel(wisselSoort(r, soort, { ing, onderdelen, defaultType }))
    if (r.bron?.tekst && onScanCorrectie) onScanCorrectie({ tekst: r.bron.tekst, soort })
  }
  const voegRegelToe = (soort: RegelSoort = 'ingredient') => {
    const r = nieuweRegel(soort, soort === 'ingredient'
      ? { type: defaultType, btw: ingTypeBtw[defaultType] !== undefined ? String(ingTypeBtw[defaultType]) : '9' }
      : {})
    setRegels(prev => [...prev, r])
    if (smal) setSheet({ soort: 'regel', id: r._id, kopie: null })
    else setOpenId(r._id)
    return r
  }
  const verwijderRegel = (id: number) => {
    const huidig = stand.current.regels
    const index = huidig.findIndex(x => x._id === id)
    if (index < 0) return
    setVerwijderd({ regel: huidig[index], index, etiket: stand.current.etiketten[id] })
    setRegels(prev => prev.filter(x => x._id !== id))
    if (openId === id) setOpenId(null)
    if (sheet?.id === id) setSheet(null)
  }
  // Vijf seconden om het terug te draaien; daarna is de regel weg (en zijn foto's ook).
  React.useEffect(() => {
    if (!verwijderd) return
    const timer = setTimeout(() => {
      verwijderd.etiket?.fotos.forEach(f => geefVrij(f.url))
      setEtiketten(prev => { const { [verwijderd.regel._id]: _weg, ...rest } = prev; return rest })
      setVerwijderd(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [verwijderd])
  const herstelRegel = () => {
    if (!verwijderd) return
    const { regel, index } = verwijderd
    setRegels(prev => [...prev.slice(0, index), regel, ...prev.slice(index)])
    setVerwijderd(null)
    if (!smal) setOpenId(regel._id)
  }

  const zetKop = (veld: KopVeld, waarde: string) => {
    kopAangeraakt.current.add(veld)
    setKopUitScan(prev => prev.filter(v => v !== veld))
    setKop(k => ({ ...k, [veld]: waarde }))
  }

  // ── Afgeleid ──────────────────────────────────────────────────────────────
  const verlegd = kop.btwSoort !== 'binnenlands'
  const inclEff = incl && !verlegd
  const teBoeken = regels.filter(r => !isLeegRegel(r))
  const som = React.useMemo(() => berekenTotalen(teBoeken, verlegd), [regels, verlegd]) // eslint-disable-line react-hooks/exhaustive-deps
  const eff = effectieveTotalen(som, handmatig, verlegd)
  const vergelijkMet: FactuurTotalen | null = scan.totalen
    || (bankBedrag !== null && bankBedrag !== undefined && bankBedrag > 0 ? { netto: null, btw: null, bruto: bankBedrag } : null)
  const controle = controleerTotaal(eff, vergelijkMet, verlegd)
  const heeftFactuurData = !!(kop.leverancier.trim() || kop.factuurnummer.trim())
  const dubbel = React.useMemo(
    () => zoekDubbeleFactuur(inkoopFacturen, { leverancier: kop.leverancier, factuurnummer: kop.factuurnummer }, initialData?.id),
    [inkoopFacturen, kop.leverancier, kop.factuurnummer, initialData?.id],
  )
  React.useEffect(() => { setDubbelOk(false) }, [dubbel?.id])
  const rollover = getRolloverInfo ? getRolloverInfo(kop.datum) : null
  const nieuweLeverancier = !!kop.leverancier.trim()
    && !knownLeveranciers.some(l => normLeverancier(l) === normLeverancier(kop.leverancier))
  const telling = telOpslag(teBoeken)
  const etiketFotosTeBewaren = bewerken ? 0 : teBoeken.reduce((n, r) => {
    const e = etiketten[r._id]
    return n + (r.soort === 'ingredient' && e?.bewaren ? e.fotos.length : 0)
  }, 0)
  const heeftDocument = !!pdf || factuurFotos.length > 0 || !!bestaandeAfbeelding
  // Is er iets dat verloren gaat bij sluiten? Dan eerst vragen.
  const heeftInvoer = pdfNieuw || factuurFotos.length > 0 || Object.values(etiketten).some(e => e.fotos.length > 0)
    || regels.length !== start.regels.length || regels.some(r => !isLeegRegel(r) && !start.regels.includes(r))
    || kop.leverancier !== start.kop.leverancier || kop.factuurnummer !== start.kop.factuurnummer
    || kop.datum !== start.kop.datum || kop.btwSoort !== start.kop.btwSoort

  // ── Document laden: postvak of bestaande bijlage ─────────────────────────
  React.useEffect(() => {
    const bestand = inboxItem?.bijlage?.bestand || initialData?.bijlage?.bestand
    if (!bestand) return
    const naam = inboxItem?.bijlage?.naam || initialData?.bijlage?.naam || bestand
    // Een foto als bijlage: meteen tonen vanaf de server.
    if (!inboxItem && isFotoBestand({ name: bestand })) {
      setBestaandeAfbeelding(`${ADDON_BASE}api/file/${bestand}`)
      setDocStatus('klaar')
      return
    }
    let actueel = true
    ;(async () => {
      try {
        const r = await fetch(`${ADDON_BASE}api/file/${bestand}`)
        if (!r.ok) throw new Error(String(r.status))
        const blob = await r.blob()
        if (!actueel) return
        const file = new File([blob], naam, { type: 'application/pdf' })
        setPdf(file)
        setDocStatus('klaar')
        // Uit het postvak meteen scannen: dat is wat "Verwerk" vroeg.
        if (inboxItem) void scanFactuur({ pdf: file, fotos: [] })
      } catch {
        if (actueel) setDocStatus('fout')
      }
    })()
    return () => { actueel = false }
    // Eenmalig bij het openen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Factuurscan ───────────────────────────────────────────────────────────
  const pasScanToe = (s: FactuurScan) => {
    const st = stand.current
    const uit = new Set<KopVeld>(st.kopUitScan)
    const k: Kop = { ...st.kop }
    const mag = (veld: KopVeld, leeg: boolean) => leeg || uit.has(veld) || (!bewerken && !kopAangeraakt.current.has(veld))
    if (s.leverancier && mag('leverancier', !k.leverancier.trim())) {
      const bekend = knownLeveranciers.find(l => normLeverancier(l) === normLeverancier(s.leverancier))
      k.leverancier = bekend || s.leverancier
      uit.add('leverancier')
    }
    if (s.factuurnummer && mag('factuurnummer', !k.factuurnummer.trim())) { k.factuurnummer = s.factuurnummer; uit.add('factuurnummer') }
    if (s.datum && mag('datum', !k.datum)) { k.datum = s.datum; uit.add('datum') }
    if (s.btwSoort !== 'binnenlands' && mag('btwSoort', k.btwSoort === 'binnenlands')) { k.btwSoort = s.btwSoort; uit.add('btwSoort') }
    setKop(k)
    setKopUitScan([...uit])

    const verdeeld = s.bron === 'claude' ? regelsUitScan(s, {
      ing, onderdelen, lots, ingTypeBtw, kostenSoorten, geheugen: scanCorrecties, defaultType,
    }, k.btwSoort) : []
    const leeg = st.regels.every(isLeegRegel)
    let wachtend: InkoopRegel[] | null = null
    if (verdeeld.length && (leeg || scanRegelsOngemoeid.current)) {
      setRegelsState(verdeeld)
      scanRegelsOngemoeid.current = true
      setOpenId(null)
      setHandmatig(GEEN_HANDMATIG)
    } else if (verdeeld.length) {
      wachtend = verdeeld
    }
    setScan({
      status: 'klaar', aantal: verdeeld.length,
      nieuw: verdeeld.filter(r => r.soort !== 'overig' && !r.koppelId).length,
      lokaal: s.bron === 'lokaal', totalen: s.totalen, wachtend, verlegd: s.btwSoort !== 'binnenlands',
    })
  }

  const scanFactuur = async (bron?: { pdf: File | null, fotos: Foto[] }) => {
    const p = bron ? bron.pdf : pdf
    const fotos = bron ? bron.fotos : factuurFotos
    if (!p && !fotos.length) return
    const versie = ++scanVersie.current
    setScan({ status: 'bezig' })
    try {
      let bestanden: FactuurBestand[]
      if (p) {
        const buf = await p.arrayBuffer()
        const tekst = await extractPdfText(p)
        const modus = factuurScanModus({ soort: 'pdf', bytes: buf.byteLength, tekstLengte: tekst.length, sleutel: heeftSleutel })
        if (modus === 'lokaal') {
          if (versie === scanVersie.current) pasScanToe(parseFactuurTekstLokaal(tekst))
          return
        }
        if (modus === 'geen') {
          if (versie === scanVersie.current) setScan(heeftSleutel ? { status: 'fout', fout: t('err_pdf_te_groot') } : { status: 'geen_sleutel' })
          return
        }
        bestanden = modus === 'document' ? [{ soort: 'pdf', base64: bytesNaarBase64(buf) }] : [{ soort: 'tekst', tekst: tekst.slice(0, 30000) }]
      } else {
        if (factuurScanModus({ soort: 'fotos', bytes: 0, tekstLengte: 0, sleutel: heeftSleutel }) === 'geen') {
          setScan({ status: 'geen_sleutel' })
          return
        }
        bestanden = fotos.slice(0, MAX_FACTUUR_FOTOS).map(f => ({ soort: 'afbeelding' as const, base64: f.scan.base64, mediaType: 'image/jpeg' }))
      }
      const prompt = bouwFactuurPrompt({
        leveranciers: knownLeveranciers, breweryNaam,
        ingNamen: ing.map((i: any) => i.naam).filter(Boolean),
        onderdeelNamen: onderdelen.map((o: any) => o.naam).filter(Boolean),
        ingTypes, kostenSoorten, geheugen: scanCorrecties,
      })
      const { data } = await voerScanUit(callClaudeProxy, {
        inhoud: inhoudVoorFactuur(bestanden, prompt),
        schema: factuurSchema(kostenSoorten, ingTypes),
        maxTokens: 16000, effort: 'medium',
      })
      if (versie !== scanVersie.current) return
      pasScanToe(normaliseerFactuurScan(data, { kostenSoorten, ingTypes }))
    } catch (e) {
      if (versie === scanVersie.current) setScan({ status: 'fout', fout: foutTekst(e) })
    }
  }

  const neemWachtendeRegelsOver = () => {
    if (!scan.wachtend) return
    setRegelsState(scan.wachtend)
    scanRegelsOngemoeid.current = true
    setHandmatig(GEEN_HANDMATIG)
    setOpenId(null)
    setScan(s => ({ ...s, wachtend: null }))
  }

  // ── Document kiezen ───────────────────────────────────────────────────────
  const kiesDocument = async (files: File[]) => {
    if (!files.length || inboxItem) return
    setMelding(null)
    const eerstePdf = files.find(f => isPdfBestand(f))
    if (eerstePdf) {
      factuurFotos.forEach(f => geefVrij(f.url))
      setFactuurFotos([])
      setBestaandeAfbeelding(null)
      setPdf(eerstePdf)
      setPdfNieuw(true)
      setDocStatus('klaar')
      geupload.current.bijlage = undefined
      void scanFactuur({ pdf: eerstePdf, fotos: [] })
      return
    }
    const fotoBestanden = files.filter(f => isFotoBestand(f))
    if (!fotoBestanden.length) { setMelding({ tekst: t('err_upload_type').replace('{naam}', files[0].name) }); return }
    setFotoBezig(true)
    const nieuw: Foto[] = []
    let fout: string | null = null
    for (const f of fotoBestanden.slice(0, MAX_FACTUUR_FOTOS - factuurFotos.length)) {
      try {
        const scanJpeg = await naarJpeg(f, SCAN_MAX_PX)
        const archief = await naarJpeg(f, FACTUUR_PAGINA_PX, 0.8)
        nieuw.push({ id: nieuwRegelId(), naam: f.name, scan: scanJpeg, archief, url: maakUrl(scanJpeg.blob) })
      } catch (e) { fout = foutTekst(e) }
    }
    setFotoBezig(false)
    if (fout) setMelding({ tekst: fout })
    if (!nieuw.length) return
    const alle = pdf ? nieuw : [...factuurFotos, ...nieuw]
    if (pdf) { setPdf(null); setPdfNieuw(false) }
    setBestaandeAfbeelding(null)
    setFactuurFotos(alle)
    setDocStatus('klaar')
    geupload.current.bijlage = undefined
    // De eerste foto('s) meteen lezen; een extra pagina leest opnieuw zolang de regels van de scan komen.
    if (alle.length === nieuw.length || scanRegelsOngemoeid.current || stand.current.regels.every(isLeegRegel)) {
      void scanFactuur({ pdf: null, fotos: alle })
    }
  }
  const verwijderFactuurFoto = (id: number) => {
    const f = factuurFotos.find(x => x.id === id)
    if (f) geefVrij(f.url)
    setFactuurFotos(prev => prev.filter(x => x.id !== id))
    geupload.current.bijlage = undefined
  }
  const docInvoer = React.useRef<HTMLInputElement | null>(null)
  const docCamera = React.useRef<HTMLInputElement | null>(null)
  const kiesBestanden = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    void kiesDocument(files)
  }
  const [sleept, setSleept] = React.useState(false)

  // ── Etiketfoto's ──────────────────────────────────────────────────────────
  const zetEtiket = (id: number, w: Partial<EtiketStaat> | ((e: EtiketStaat) => Partial<EtiketStaat>)) =>
    setEtiketten(prev => {
      const huidig = prev[id] || nieuwEtiket()
      return { ...prev, [id]: { ...huidig, ...(typeof w === 'function' ? w(huidig) : w) } }
    })

  const leesEtiket = async (id: number) => {
    const e = stand.current.etiketten[id]
    const r = stand.current.regels.find(x => x._id === id)
    if (!e || !e.fotos.length || !r) return
    const versie = e.versie + 1
    zetEtiket(id, { status: 'bezig', fout: null, versie })
    try {
      const prompt = bouwEtiketPrompt({
        aantalFotos: e.fotos.length, naam: r.naam, type: r.type, fabrikant: r.fabrikant, qty: r.qty, eenh: r.eenh,
        ingTypes, ingNamen: ing.map((i: any) => i.naam).filter(Boolean),
      })
      const { data } = await voerScanUit(callClaudeProxy, {
        inhoud: inhoudVoorEtiket(e.fotos.map(f => f.scan.base64), prompt),
        schema: etiketSchema(ingTypes), maxTokens: 8000, effort: 'medium',
      })
      if (stand.current.etiketten[id]?.versie !== versie) return
      const s = normaliseerEtiketScan(data, { ingTypes })
      const nu = stand.current.regels.find(x => x._id === id)
      if (!nu) return
      const oordeel = nu.naam.trim() ? productKlopt(s, nu.naam) : 'onbekend'
      if (!s.leesbaar || oordeel === 'nee') {
        zetEtiket(id, { status: 'klaar', scan: s, oordeel, nietToegepast: s.leesbaar && oordeel === 'nee' })
        return
      }
      setRegels(prev => prev.map(x => x._id === id ? pasEtiketToe(x, s, { ingTypes, ing, defaultType }) : x))
      zetEtiket(id, { status: 'klaar', scan: s, oordeel, nietToegepast: false })
    } catch (err) {
      if (stand.current.etiketten[id]?.versie === versie) zetEtiket(id, { status: 'fout', fout: foutTekst(err) })
    }
  }
  const planEtiket = (id: number) => {
    clearTimeout(etiketTimers.current[id])
    etiketTimers.current[id] = setTimeout(() => { void leesEtiket(id) }, 450)
  }
  const voegEtiketFotosToe = async (id: number, files: File[]) => {
    const al = stand.current.etiketten[id]?.fotos.length || 0
    const ruimte = Math.max(0, MAX_ETIKET_FOTOS - al)
    zetEtiket(id, { status: 'bezig', fout: null })
    const nieuw: Foto[] = []
    let fout: string | null = null
    for (const f of files.slice(0, ruimte)) {
      try {
        const scanJpeg = await naarJpeg(f, SCAN_MAX_PX)
        const archief = await naarJpeg(f, ARCHIEF_MAX_PX, 0.82)
        nieuw.push({ id: nieuwRegelId(), naam: naamMetExtensie(f.name, 'jpg'), scan: scanJpeg, archief, url: maakUrl(scanJpeg.blob) })
      } catch (e) { fout = foutTekst(e) }
    }
    if (!nieuw.length) {
      zetEtiket(id, e => ({ status: e.fotos.length ? (e.scan ? 'klaar' : 'leeg') : 'leeg', fout }))
      if (fout) setMelding({ tekst: fout })
      return
    }
    zetEtiket(id, e => ({ fotos: [...e.fotos, ...nieuw], fout: null }))
    planEtiket(id)
  }
  const verwijderEtiketFoto = (id: number, fotoId: number) => {
    const e = stand.current.etiketten[id]
    const f = e?.fotos.find(x => x.id === fotoId)
    if (f) geefVrij(f.url)
    const rest = (e?.fotos || []).filter(x => x.id !== fotoId)
    zetEtiket(id, x => ({ fotos: x.fotos.filter(y => y.id !== fotoId), ...(rest.length ? {} : { status: 'leeg' as EtiketStatus, scan: null, oordeel: null, nietToegepast: false, versie: x.versie + 1 }) }))
    if (rest.length) planEtiket(id)
  }
  const tochToepassen = (id: number) => {
    const e = stand.current.etiketten[id]
    if (!e?.scan) return
    const s = e.scan
    setRegels(prev => prev.map(x => x._id === id ? pasEtiketToe(x, s, { ingTypes, ing, defaultType }) : x))
    zetEtiket(id, { nietToegepast: false })
  }

  /** "Geen factuur bij de levering": een regel maken van een etiketfoto. */
  const etiketZonderFactuur = (files: File[]) => {
    if (!files.length) return
    const leegRegel = stand.current.regels.find(r => r.soort === 'ingredient' && isLeegRegel(r))
    const r = leegRegel || voegRegelToe('ingredient')
    if (leegRegel) { if (smal) setSheet({ soort: 'regel', id: r._id, kopie: { ...r } }); else setOpenId(r._id) }
    void voegEtiketFotosToe(r._id, files)
  }
  const etiketZonderFactuurRef = React.useRef<HTMLInputElement | null>(null)

  /** "Ingevuld: lotnummer, THT en 2 eigenschappen" — wat het etiket op de regel zette. */
  const ingevuldTekst = (r: InkoopRegel): string | null => {
    const v = new Set(r.uitEtiket || [])
    if (!v.size) return null
    const delen: string[] = []
    if (v.has('naam')) delen.push(t('inkoop_ingevuld_product'))
    if (v.has('qty')) delen.push(t('inkoop_ingevuld_hoeveelheid'))
    if (v.has('lots') && heeftMeerLots(r)) delen.push(t('inkoop_ingevuld_lots').replace('{n}', String(r.lots.length)))
    else if (v.has('lotnr')) delen.push(t('inkoop_ingevuld_lot'))
    if (v.has('tht')) delen.push(t('inkoop_ingevuld_tht'))
    const velden = LOT_BREW_FIELDS_PER_TYPE[r.type || ''] || []
    const props = [...v].filter(x => x.startsWith('bf:') && velden.some(f => f.key === x.slice(3))).length
    if (props) delen.push(props === 1 ? t('inkoop_ingevuld_eigenschap') : t('inkoop_ingevuld_eigenschappen').replace('{n}', String(props)))
    return delen.length ? t('etiket_ingevuld').replace('{velden}', opsomming(delen)) : null
  }

  const etiketVoor = (r: InkoopRegel): React.ReactNode => {
    if (r.soort !== 'ingredient' || bewerken) return null
    const e = etiketten[r._id] || nieuwEtiket()
    return (
      <EtiketFotos fotos={e.fotos} status={e.status} fout={e.fout} scan={e.scan} oordeel={e.oordeel}
        nietToegepast={e.nietToegepast} ingevuld={ingevuldTekst(r)}
        lotWijktAf={!!e.scan && etiketLotsWijkenAf(r, e.scan)}
        heeftSleutel={heeftSleutel} bewaren={e.bewaren}
        onBewaren={aan => zetEtiket(r._id, { bewaren: aan })}
        onVoegToe={files => { void voegEtiketFotosToe(r._id, files) }}
        onVerwijder={fotoId => verwijderEtiketFoto(r._id, fotoId)}
        onOpnieuw={() => { void leesEtiket(r._id) }}
        onTochToepassen={() => tochToepassen(r._id)} />
    )
  }

  // ── Regelfouten ───────────────────────────────────────────────────────────
  const foutenVan = (r: InkoopRegel) => (toonFouten ? valideerRegel(r) : [])
  const editorVoor = (r: InkoopRegel, inSheet = false): React.ReactNode => (
    <div className={inSheet ? '' : 'rounded-xl border border-gray-200 bg-white p-3'}>
      <RegelEditor regel={r} onWijzig={wijzigRegel} onSoort={s => kiesSoort(r._id, s)} incl={inclEff} verlegd={verlegd}
        ctx={ctx} fouten={foutenVan(r)} smal={smal} etiket={etiketVoor(r)} bewerken={bewerken}
        onKiesSoort={() => setSheet(sh => sh ? { ...sh, soort: 'soort' } : sh)} />
      {!inSheet && (
        <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-gray-100">
          <Btn v="ghost" s="sm" onClick={() => verwijderRegel(r._id)}><span className="text-red-600 inline-flex items-center gap-1"><Icon n="trash" /> {t('inkoop_regel_verwijderen')}</span></Btn>
          <Btn v="secondary" s="sm" onClick={() => setOpenId(null)}>{t('inkoop_klaar')}</Btn>
        </div>
      )}
      {inSheet && (
        <div className="pt-4 mt-4 border-t border-gray-100">
          <button type="button" onClick={() => verwijderRegel(r._id)}
            className="w-full min-h-tap rounded-lg text-sm font-medium text-red-600 border border-red-200 bg-red-50 inline-flex items-center justify-center gap-1.5">
            <Icon n="trash" /> {t('inkoop_regel_verwijderen')}
          </button>
        </div>
      )}
    </div>
  )

  // ── Opslaan ───────────────────────────────────────────────────────────────
  const opslaan = async (volgende = false) => {
    if (bezig) return
    setMelding(null)
    const lijst = stand.current.regels.filter(r => !isLeegRegel(r))
    if (!lijst.length) { setMelding({ tekst: t('err_min_one_product') }); return }
    const fout = lijst.find(r => valideerRegel(r).length)
    if (fout) {
      setToonFouten(true)
      if (smal) setSheet({ soort: 'regel', id: fout._id, kopie: { ...fout } })
      else setOpenId(fout._id)
      setMelding({ tekst: t('inkoop_vul_regels_aan') })
      return
    }
    if (inboxItem && !heeftFactuurData) { setToonFouten(true); setMelding({ tekst: t('inbox_vul_factuurgegevens') }); return }
    if (dubbel && !dubbelOk) {
      setMelding({
        tekst: t('inkoop_dubbel_vraag'),
        actie: { label: t('inkoop_toch_opslaan'), doe: () => { setDubbelOk(true); setMelding(null) } },
      })
      return
    }
    setBezig(true)
    try {
      // 1. De bijlage: een nieuwe PDF, de foto's als één PDF, of wat er al was.
      let opTeSlaan: Bijlage | null = bijlage
      if (pdf && pdfNieuw) {
        if (!geupload.current.bijlage) {
          const u = await uploadBijlage(pdf, 'inkoop')
          if (!u.ok || !u.bijlage) { setMelding({ tekst: t(uploadFoutSleutel(u.status)).replace('{naam}', u.naam) }); return }
          geupload.current.bijlage = u.bijlage
        }
        opTeSlaan = geupload.current.bijlage
      } else if (factuurFotos.length) {
        if (!geupload.current.bijlage) {
          const naam = factuurFotos.length > 1 ? t('inkoop_fotos_pdf_naam').replace('{n}', String(factuurFotos.length)) + '.pdf' : naamMetExtensie(factuurFotos[0].naam, 'pdf')
          const u = await uploadBijlage(alsBestand(fotosNaarPdf(factuurFotos.map(f => f.archief)), naam), 'inkoop')
          if (!u.ok || !u.bijlage) { setMelding({ tekst: t(uploadFoutSleutel(u.status)).replace('{naam}', u.naam) }); return }
          geupload.current.bijlage = u.bijlage
        }
        opTeSlaan = geupload.current.bijlage
      }
      // 2. Etiketfoto's die bij het lot bewaard worden.
      const fotosPerRegel: Record<number, Bijlage[]> = {}
      if (!bewerken) {
        for (const r of lijst) {
          const e = stand.current.etiketten[r._id]
          if (r.soort !== 'ingredient' || !e?.bewaren || !e.fotos.length) continue
          const uit: Bijlage[] = []
          for (const f of e.fotos) {
            let b = geupload.current.fotos[f.id]
            if (!b) {
              const u = await uploadBijlage(alsBestand(f.archief.blob, f.naam), 'etiket')
              if (!u.ok || !u.bijlage) {
                setMelding({
                  tekst: t(uploadFoutSleutel(u.status)).replace('{naam}', u.naam),
                  actie: { label: t('inkoop_zonder_etiketfotos'), doe: () => { zetAlleEtiketBewaren(false); setMelding(null) } },
                })
                return
              }
              b = u.bijlage
              geupload.current.fotos[f.id] = b
            }
            uit.push(b)
          }
          fotosPerRegel[r._id] = uit
        }
      }
      // 3. Naar de pagina, in de vorm die de pagina's al kennen.
      const lijsten = naarOpslag(lijst, ing, onderdelen)
      const productLijst = lijsten.productLijst.map(p => fotosPerRegel[p._id]?.length ? { ...p, etiket_fotos: fotosPerRegel[p._id] } : p)
      const data: InkoopOpslag = {
        factuurForm: { leverancier: kop.leverancier.trim(), factuur: kop.factuurnummer.trim(), datum: kop.datum, btw_soort: kop.btwSoort },
        productLijst, verpakkingLijst: lijsten.verpakkingLijst, vrijeRegels: lijsten.vrijeRegels,
        bijlage: opTeSlaan,
        totaalManual: naarTotaalManual(handmatig),
      }
      const gelukt = onSave(data, volgende ? { volgende: true } : undefined)
      if (gelukt === false) return
      if (onLeer) {
        const k = koppelingenUitRegels(lijst, kop.leverancier.trim(), ing, onderdelen)
        if (k.length) onLeer(k)
      }
    } finally {
      setBezig(false)
    }
  }
  const zetAlleEtiketBewaren = (aan: boolean) =>
    setEtiketten(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, bewaren: aan }])))

  // ── Sluiten ───────────────────────────────────────────────────────────────
  const probeerSluiten = () => {
    if (sheet) { setSheet(null); return }
    if (heeftInvoer && !sluitVraag) { setSluitVraag(true); return }
    onClose()
  }
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  useDialoogFocus(panelRef, probeerSluiten, { eersteFocus: !smal })
  React.useEffect(() => {
    if (!sluitVraag) return
    const timer = setTimeout(() => setSluitVraag(false), 6000)
    return () => clearTimeout(timer)
  }, [sluitVraag])

  // ── Markering in de factuur: de open regel ───────────────────────────────
  const openRegel = regels.find(r => r._id === (sheet?.id ?? openId)) || null
  const markering: Markering | null = openRegel?.bron?.tekst
    ? { tekst: openRegel.bron.tekst, bedrag: openRegel.bron.netto ?? null }
    : null

  // ── Weergave ──────────────────────────────────────────────────────────────
  const titel = bewerken ? t('modal_title_edit_invoice') : t('modal_title_receipt')
  const ondertitel = inboxItem
    ? t('inkoop_uit_postvak').replace('{afzender}', inboxAfzender(inboxItem) || t('lbl_onbekend')).replace('{onderwerp}', inboxItem.onderwerp || inboxItem.bijlage.naam)
    : bankBedrag ? t('inkoop_uit_bank').replace('{bedrag}', fmt(bankBedrag)) : null

  const documentBron: DocumentBron | null = pdf
    ? { soort: 'pdf', file: pdf }
    : factuurFotos.length ? { soort: 'fotos', fotos: factuurFotos.map(f => ({ url: f.url, naam: f.naam })) }
      : bestaandeAfbeelding ? { soort: 'fotos', fotos: [{ url: bestaandeAfbeelding, naam: bijlage?.naam || '' }] } : null
  const documentNaam = pdf?.name || (factuurFotos.length ? t('inkoop_fotos_n').replace('{n}', String(factuurFotos.length)) : bijlage?.naam || '')
  const origineelUrl = bijlage?.bestand && !pdfNieuw && !factuurFotos.length ? `${ADDON_BASE}api/file/${bijlage.bestand}` : null

  const documentInvoer = (
    <>
      <input ref={docInvoer} type="file" accept=".pdf,image/*,.heic,.heif" multiple className="hidden" onChange={kiesBestanden} />
      <input ref={docCamera} type="file" accept="image/*" capture="environment" className="hidden" onChange={kiesBestanden} />
      <input ref={etiketZonderFactuurRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
        {...(isAanraakscherm() ? { capture: 'environment' } : {})}
        onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; etiketZonderFactuur(f) }} />
    </>
  )

  const statusStrook = (
    <div className="space-y-2" aria-live="polite">
      {docStatus === 'laden' && (
        <Strook toon="info"><span className="inline-flex items-center gap-2"><Draaier />{inboxItem ? t('inbox_laden') : t('inkoop_doc_laden')}</span></Strook>
      )}
      {docStatus === 'fout' && <Strook toon="fout">⚠ {t('inbox_pdf_laden_fout')}</Strook>}
      {fotoBezig && <Strook toon="info"><span className="inline-flex items-center gap-2"><Draaier />{t('inkoop_fotos_verwerken')}</span></Strook>}
      {scan.status === 'bezig' && (
        <Strook toon="info"><span className="inline-flex items-center gap-2"><Draaier />{t('msg_scanning')}</span></Strook>
      )}
      {scan.status === 'fout' && (
        <Strook toon="fout" actie={heeftDocument ? { label: t('inkoop_opnieuw_scannen'), doe: () => { void scanFactuur() } } : undefined}>
          ⚠ {t('inkoop_scan_mislukt')}: {scan.fout}
        </Strook>
      )}
      {scan.status === 'geen_sleutel' && <Strook toon="info">{t('inkoop_scan_geen_sleutel')}</Strook>}
      {scan.status === 'klaar' && (
        <Strook toon="ok" actie={heeftDocument ? { label: t('inkoop_opnieuw_scannen'), doe: () => { void scanFactuur() } } : undefined}>
          {scan.lokaal
            ? t('inkoop_scan_lokaal')
            : scan.aantal
              ? <>✓ {(scan.nieuw ? t('inkoop_scan_klaar_nieuw') : t('inkoop_scan_klaar')).replace('{n}', String(scan.aantal)).replace('{m}', String(scan.nieuw || 0))}
                {scan.verlegd && <> · {t('msg_scan_verlegd')}</>}</>
              : <>✓ {t('msg_scan_klaar')}</>}
        </Strook>
      )}
      {scan.wachtend && scan.wachtend.length > 0 && (
        <Strook toon="info" actie={{ label: t('inkoop_scan_vervang'), doe: neemWachtendeRegelsOver }}>
          {t('inkoop_scan_wachtend').replace('{n}', String(scan.wachtend.length))}
        </Strook>
      )}
      {bewerken && <Strook toon="waarschuwing">⚠ {t('modal_edit_warning')}</Strook>}
      {initialData?.betaald_datum && <Strook toon="ok">✓ {t('lbl_paid_on')}: {fmtD(initialData.betaald_datum)}</Strook>}
    </div>
  )

  const documentKiezer = !heeftDocument && docStatus !== 'laden' && !inboxItem ? (
    <div className={`grid gap-3 ${bewerken ? '' : 'sm:grid-cols-[1.4fr_1fr]'}`}>
      <div onDragOver={e => { e.preventDefault(); setSleept(true) }} onDragLeave={() => setSleept(false)}
        onDrop={e => { e.preventDefault(); setSleept(false); void kiesDocument(Array.from(e.dataTransfer.files || [])) }}
        className={`rounded-xl border-2 border-dashed p-4 flex flex-col gap-3 ${sleept ? 'border-[var(--t-accent)] t-panel' : 'border-gray-300 bg-gray-50'}`}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon n="upload" cls="text-lg" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800">{smal ? t('inkoop_factuur_toevoegen') : t('inkoop_sleep_factuur')}</div>
            <div className="text-xs text-gray-500">{heeftSleutel ? t('inkoop_sleep_uitleg') : t('inkoop_sleep_uitleg_zonder')}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {smal && <Btn s="sm" onClick={() => docCamera.current?.click()}><span className="inline-flex items-center gap-1"><Icon n="camera" />{t('inkoop_foto_factuur')}</span></Btn>}
          <Btn s="sm" v={smal ? 'secondary' : 'primary'} onClick={() => docInvoer.current?.click()}>{t('inkoop_bestand_kiezen')}</Btn>
        </div>
      </div>
      {!bewerken && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0"><Icon n="camera" cls="text-lg" /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-800">{t('inkoop_geen_factuur')}</div>
              <div className="text-xs text-gray-500">{heeftSleutel ? t('inkoop_geen_factuur_uitleg') : t('etiket_geen_sleutel')}</div>
            </div>
          </div>
          {heeftSleutel && (
            <div><Btn s="sm" v="secondary" onClick={() => etiketZonderFactuurRef.current?.click()}>{t('inkoop_foto_etiket')}</Btn></div>
          )}
        </div>
      )}
    </div>
  ) : null

  const kopVelden = (
    <section className="rounded-xl border border-gray-200 bg-white p-3 space-y-3" aria-label={t('modal_invoice_details')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="ink-lev" className="text-sm font-medium text-gray-700">{t('lbl_supplier')}</label>
            <BronLabel bron={kopUitScan.includes('leverancier') ? 'scan' : null} />
          </div>
          <div className="relative">
            <input id="ink-lev" list="ink-lev-lijst" type="text" value={kop.leverancier} autoComplete="off"
              onChange={e => zetKop('leverancier', e.target.value)} placeholder={t('ph_brewery_name')}
              aria-invalid={toonFouten && inboxItem && !heeftFactuurData ? true : undefined}
              className={`w-full border rounded-lg pl-3 ${nieuweLeverancier ? 'pr-14' : 'pr-3'} py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm ${toonFouten && inboxItem && !heeftFactuurData ? 'border-red-400' : 'border-gray-200'}`} />
            {nieuweLeverancier && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{t('inkoop_nieuw')}</span>
            )}
            <datalist id="ink-lev-lijst">{knownLeveranciers.map(l => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="ink-nr" className="text-sm font-medium text-gray-700">{t('lbl_invoice')}</label>
            <BronLabel bron={kopUitScan.includes('factuurnummer') ? 'scan' : null} />
          </div>
          <input id="ink-nr" type="text" value={kop.factuurnummer} autoComplete="off" onChange={e => zetKop('factuurnummer', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm" />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="ink-datum" className="text-sm font-medium text-gray-700">{t('lbl_invoice_date')}</label>
            <BronLabel bron={kopUitScan.includes('datum') ? 'scan' : null} />
          </div>
          <input id="ink-datum" type="date" value={kop.datum} onChange={e => zetKop('datum', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700">{t('lbl_btw')}</span>
          <BronLabel bron={kopUitScan.includes('btwSoort') ? 'scan' : null} />
        </div>
        <Segment<BtwSoort> label={t('lbl_btw_soort')} waarde={kop.btwSoort} cls="w-full sm:w-auto"
          onKies={v => zetKop('btwSoort', v)}
          opties={[
            { v: 'binnenlands', l: t('inkoop_btw_nl') },
            { v: 'intracom_eu', l: t('inkoop_btw_eu') },
            { v: 'import_niet_eu', l: t('inkoop_btw_buiten_eu') },
          ]} />
        <p className="text-xs text-gray-500">
          {kop.btwSoort === 'binnenlands' ? t('inkoop_btw_nl_uitleg') : kop.btwSoort === 'intracom_eu' ? t('hint_btw_verlegd_intracom') : t('hint_btw_verlegd_import')}
        </p>
      </div>
      {rollover && (
        <p className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          {t('msg_btw_rollover').replace('{from}', periodeKeyLabel(rollover.vanafPeriode)).replace('{to}', periodeKeyLabel(rollover.rolloverNaar))}
        </p>
      )}
      {dubbel && (
        <p className="text-xs text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          ⚠ {t('inkoop_dubbel').replace('{nummer}', String(dubbel.factuurnummer || '')).replace('{leverancier}', String(dubbel.leverancier || '')).replace('{datum}', fmtD(dubbel.datum))}
        </p>
      )}
    </section>
  )

  const regelLijst = (
    <RegelLijst regels={regels} openId={smal ? null : openId}
      onOpen={id => {
        if (smal && id !== null) {
          const r = regels.find(x => x._id === id)
          setSheet({ soort: 'regel', id, kopie: r ? { ...r } : null })
        } else setOpenId(id)
      }}
      incl={inclEff} onIncl={setIncl} toonIncl={!verlegd} verlegd={verlegd} toonFouten={toonFouten} smal={smal} bewerken={bewerken}
      editor={r => editorVoor(r)} onNieuw={() => voegRegelToe('ingredient')}
      fotosVan={id => etiketten[id]?.fotos.length || 0}
      leestEtiket={id => etiketten[id]?.status === 'bezig'} />
  )

  const vulVerlegdeTarieven = () => setRegels(prev => prev.map(r => Number(r.btw) ? r
    : { ...r, btw: r.soort === 'ingredient' ? String(ingTypeBtw[r.type] ?? 9) : '21' }))

  const totalen = teBoeken.length > 0 ? (
    <InkoopTotalen som={som} handmatig={handmatig} onHandmatig={setHandmatig} controle={controle}
      bron={scan.totalen ? 'factuur' : 'bank'} magOvernemen={!!scan.totalen}
      onNeemOver={() => { if (vergelijkMet) setHandmatig(totaalOvernemen(som, vergelijkMet, verlegd)) }}
      verlegd={verlegd} btwSoort={kop.btwSoort} onVulTarieven={vulVerlegdeTarieven} />
  ) : null

  // "Bij opslaan": wat er precies gebeurt.
  const periode = periodeKeyLabel(rollover ? rollover.rolloverNaar : datumToPeriodeKey(kop.datum, btwPeriodeType))
  const samenvatting: string[] = []
  if (bewerken) samenvatting.push(t('inkoop_opslaan_bewerken'))
  else if (heeftFactuurData) samenvatting.push(t('inkoop_opslaan_factuur').replace('{periode}', periode))
  else samenvatting.push(t('inkoop_opslaan_correctie'))
  if (!bewerken) {
    if (telling.lots) samenvatting.push(t(telling.lots === 1 ? 'inkoop_opslaan_lot' : 'inkoop_opslaan_lots').replace('{n}', String(telling.lots))
      + (telling.nieuweIngredienten ? ', ' + t('inkoop_opslaan_nieuwe_ing').replace('{n}', String(telling.nieuweIngredienten)) : ''))
    if (telling.verpakkingRegels) samenvatting.push(t('inkoop_opslaan_materiaal').replace('{n}', String(telling.verpakkingRegels))
      + (telling.nieuwMateriaal ? ', ' + t('inkoop_opslaan_nieuw_materiaal').replace('{n}', String(telling.nieuwMateriaal)) : ''))
    if (telling.merch) samenvatting.push(t('inkoop_opslaan_merch').replace('{n}', String(telling.merch)))
    if (etiketFotosTeBewaren) samenvatting.push(t('inkoop_opslaan_etiketfotos').replace('{n}', String(etiketFotosTeBewaren)))
  }
  if (heeftFactuurData && nieuweLeverancier) samenvatting.push(t('inkoop_opslaan_nieuwe_leverancier').replace('{naam}', kop.leverancier.trim()))
  if (inboxItem) samenvatting.push(t('inkoop_opslaan_pdf_gekoppeld').replace('{naam}', inboxItem.bijlage.naam))
  else if (pdfNieuw && pdf) samenvatting.push(t('inkoop_opslaan_bijlage').replace('{naam}', pdf.name))
  else if (factuurFotos.length) samenvatting.push(t('inkoop_opslaan_fotos_pdf'))

  const controleKort = controle.status === 'klopt' ? t(scan.totalen ? 'inkoop_klopt_kort_factuur' : 'inkoop_klopt_kort_bank')
    : controle.status === 'verschil' ? t('inkoop_verschil_kort').replace('{bedrag}', fmt(Math.abs(controle.verschil))) : null

  const knoppen = (
    <>
      {inboxItem && volgendeAantal > 0 && (
        <Btn v="secondary" onClick={() => { void opslaan(true) }} disabled={bezig}>{t('inkoop_opslaan_volgende').replace('{n}', String(volgendeAantal))}</Btn>
      )}
      <Btn onClick={() => { void opslaan(false) }} disabled={bezig} s={smal ? 'lg' : 'md'} cls={smal ? 'flex-1' : ''}>
        {bezig ? t('btn_uploading') : bewerken ? t('btn_save_changes') : t('btn_save')}
      </Btn>
    </>
  )

  const meldingBalk = melding && (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
      <span className="flex-1 min-w-0">⚠ {melding.tekst}</span>
      {melding.actie && <button type="button" onClick={melding.actie.doe} className="font-semibold underline whitespace-nowrap">{melding.actie.label}</button>}
    </div>
  )

  const sluitKnop = sluitVraag ? (
    <span className="inline-flex items-center gap-1.5 text-sm" role="group" aria-label={t('inkoop_sluiten_vraag')}>
      <span className="text-gray-700 hidden sm:inline">{t('inkoop_sluiten_vraag')}</span>
      <button type="button" onClick={onClose} autoFocus className="px-3 min-h-[36px] rounded-lg bg-red-600 text-white font-semibold">{t('inkoop_weggooien')}</button>
      <button type="button" onClick={() => setSluitVraag(false)} className="px-3 min-h-[36px] rounded-lg border border-gray-300 text-gray-700">{t('btn_cancel')}</button>
    </span>
  ) : (
    <button type="button" onClick={probeerSluiten} aria-label={t('btn_sluiten')}
      className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      <Icon n="close" cls="text-xl" />
    </button>
  )

  const ongedaanBalk = verwijderd && (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 z-[220] max-w-[calc(100vw-2rem)] w-[26rem] flex items-center gap-3 bg-gray-900 text-white rounded-full pl-4 pr-1.5 py-1.5 shadow-xl"
      style={{ bottom: smal ? 'calc(var(--safe-bottom, 0px) + 88px)' : '96px' }}>
      <span className="flex-1 min-w-0 truncate text-sm">{t('inkoop_regel_verwijderd')}</span>
      <button type="button" onClick={herstelRegel} className="flex-shrink-0 min-h-[40px] px-3.5 rounded-full text-sm font-semibold bg-white/15 hover:bg-white/25">{t('undo_ongedaan')}</button>
    </div>
  )

  const boeking = (
    <div className="space-y-4">
      {statusStrook}
      {documentKiezer}
      {kopVelden}
      {regelLijst}
      {totalen}
    </div>
  )

  // ── Telefoon ──────────────────────────────────────────────────────────────
  if (smal) {
    const sheetRegel = sheet ? regels.find(r => r._id === sheet.id) || null : null
    return ReactDOM.createPortal(
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={titel} tabIndex={-1}
        className="fixed inset-0 z-[200] bg-gray-50 flex flex-col outline-none">
        <header className="bg-white border-b border-gray-200 px-2 flex items-center gap-1" style={{ paddingTop: 'var(--safe-top, 0px)' }}>
          <div className="min-h-[56px] flex items-center gap-1 w-full">
            {!sluitVraag && sluitKnop}
            <div className="flex-1 min-w-0 px-1">
              <div className="text-base font-semibold text-gray-900 truncate">{titel}</div>
              {ondertitel && <div className="text-xs text-gray-500 truncate">{ondertitel}</div>}
            </div>
            {sluitVraag && sluitKnop}
          </div>
        </header>
        {heeftDocument && (
          <div className="bg-white px-3 pb-2 border-b border-gray-200">
            <Segment<'factuur' | 'boeking'> label={t('inkoop_weergave')} waarde={mobielTab} onKies={setMobielTab} cls="w-full"
              opties={[{ v: 'factuur', l: t('inkoop_tab_factuur') }, { v: 'boeking', l: t('inkoop_tab_boeking') }]} />
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" {...(sheet ? { 'aria-hidden': true } : {})}>
          {mobielTab === 'factuur' && documentBron ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <FactuurDocument bron={documentBron} naam={documentNaam} markering={markering} smal origineelUrl={origineelUrl} />
              </div>
              {!inboxItem && !bewerken && (
                <div className="flex gap-2 p-3 bg-white border-t border-gray-200">
                  {factuurFotos.length > 0 && factuurFotos.length < MAX_FACTUUR_FOTOS && (
                    <Btn s="sm" v="secondary" cls="flex-1" onClick={() => docCamera.current?.click()}>+ {t('inkoop_pagina_toevoegen')}</Btn>
                  )}
                  <Btn s="sm" v="secondary" cls="flex-1" onClick={() => docInvoer.current?.click()}>{t('inkoop_doc_vervang')}</Btn>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 space-y-4 pb-6">
              {boeking}
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                <h3 className="text-sm font-semibold text-gray-800 mb-1.5">{t('inkoop_bij_opslaan')}</h3>
                <ul className="space-y-1 text-sm text-gray-700">{samenvatting.map((s, i) => <li key={i} className="flex gap-2"><span className="text-gray-400">•</span><span>{s}</span></li>)}</ul>
              </section>
            </div>
          )}
        </div>
        <footer data-werkblad-voet className="bg-white border-t border-gray-200 px-3 pt-2 space-y-2" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 8px)' }}>
          {meldingBalk}
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-xs text-gray-500">{verlegd ? t('inkoop_totaal') : t('lbl_totaal_incl_btw')}</div>
              <div className="text-base font-bold text-gray-900 tabular-nums">{fmt(eff.bruto)}</div>
              {controleKort && <div className={`text-[11px] ${controle.status === 'klopt' ? 'text-green-700' : 'text-orange-700'}`}>{controleKort}</div>}
            </div>
            <div className="flex-1 flex justify-end gap-2">{knoppen}</div>
          </div>
        </footer>
        {sheet && sheetRegel && sheet.soort === 'regel' && (
          <Onderblad titel={t('inkoop_regel_bewerken')}
            onAnnuleer={() => {
              // Terug naar hoe de regel was; een net toegevoegde regel verdwijnt weer.
              const k = sheet.kopie
              if (k) setRegels(prev => prev.map(x => x._id === k._id ? k : x))
              else setRegels(prev => prev.filter(x => x._id !== sheetRegel._id))
              setSheet(null)
            }}
            onKlaar={() => setSheet(null)}>
            {editorVoor(sheetRegel, true)}
          </Onderblad>
        )}
        {sheet && sheetRegel && sheet.soort === 'soort' && (
          <Onderblad titel={t('inkoop_soort_kiezen')} laag onKlaar={() => setSheet({ ...sheet, soort: 'regel' })} klaarLabel={t('inkoop_klaar')}>
            <div className="space-y-2" role="radiogroup" aria-label={t('inkoop_soort')}>
              {(['ingredient', 'verpakking', 'overig'] as RegelSoort[]).map(s => (
                <button key={s} type="button" role="radio" aria-checked={sheetRegel.soort === s}
                  onClick={() => { kiesSoort(sheetRegel._id, s); setSheet({ ...sheet, soort: 'regel' }) }}
                  className={`w-full text-left rounded-xl border p-3 ${sheetRegel.soort === s ? 'border-[var(--t-accent)] t-panel' : 'border-gray-200 bg-white'}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">{soortLabel(s)}</span>
                    {sheetRegel.soort === s && <span className="t-accent-text">✓</span>}
                  </span>
                  <span className="block text-xs text-gray-600 mt-0.5">{t(`inkoop_soort_${s}_uitleg`)}</span>
                </button>
              ))}
              {sheetRegel.bron?.tekst && <p className="text-xs text-gray-500 pt-1">{t('inkoop_soort_onthouden')}</p>}
            </div>
          </Onderblad>
        )}
        {ongedaanBalk}
        {documentInvoer}
      </div>,
      document.body,
    )
  }

  // ── Bureau ────────────────────────────────────────────────────────────────
  const toonDocument = heeftDocument && docZichtbaar
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-3 lg:p-5">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={titel} tabIndex={-1}
        className={`bg-gray-50 rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden outline-none ${toonDocument ? 'max-w-[1560px]' : 'max-w-4xl'}`}>
        <header className="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{titel}</h2>
            {ondertitel && <p className="text-xs text-gray-500 truncate">{ondertitel}</p>}
          </div>
          {heeftDocument && (
            <button type="button" onClick={() => setDocZichtbaar(v => !v)}
              className="px-3 h-9 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 inline-flex items-center gap-1.5">
              <Icon n="file" /> {docZichtbaar ? t('inkoop_factuur_verbergen') : t('inkoop_factuur_tonen')}
            </button>
          )}
          {sluitKnop}
        </header>
        <div className="flex-1 min-h-0 flex">
          {toonDocument && documentBron && (
            <aside className="w-[46%] min-w-[380px] border-r border-gray-200 min-h-0 flex flex-col"
              onDragOver={e => { if (!inboxItem) e.preventDefault() }}
              onDrop={e => { if (inboxItem) return; e.preventDefault(); void kiesDocument(Array.from(e.dataTransfer.files || [])) }}>
              <FactuurDocument bron={documentBron} naam={documentNaam} markering={markering} origineelUrl={origineelUrl}
                onVervang={inboxItem ? undefined : () => docInvoer.current?.click()} />
              {factuurFotos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-t border-gray-200">
                  {factuurFotos.map((f, i) => (
                    <span key={f.id} className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-100 rounded-full pl-2 pr-1 py-0.5">
                      {t('inkoop_doc_pagina_n').replace('{n}', String(i + 1))}
                      <button type="button" onClick={() => verwijderFactuurFoto(f.id)} aria-label={t('inkoop_pagina_weg').replace('{n}', String(i + 1))}
                        className="w-5 h-5 rounded-full hover:bg-gray-200">✕</button>
                    </span>
                  ))}
                  {factuurFotos.length < MAX_FACTUUR_FOTOS && (
                    <button type="button" onClick={() => docInvoer.current?.click()} className="text-xs font-medium t-accent-text">+ {t('inkoop_pagina_toevoegen')}</button>
                  )}
                  <span className="flex-1" />
                  <button type="button" onClick={() => { void scanFactuur() }} className="text-xs font-medium t-accent-text">{t('inkoop_opnieuw_scannen')}</button>
                </div>
              )}
            </aside>
          )}
          <main className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              <div className={toonDocument ? '' : 'max-w-3xl mx-auto'}>{boeking}</div>
            </div>
            <footer className="bg-white border-t border-gray-200 px-5 py-3 space-y-2">
              {meldingBalk}
              <div className="flex items-end gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 mb-0.5">{t('inkoop_bij_opslaan')}</div>
                  <ul className="text-xs text-gray-600 grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-0.5">
                    {samenvatting.map((s, i) => <li key={i} className={`truncate ${i === 0 ? 'xl:col-span-2' : ''}`} title={s}>{s}</li>)}
                  </ul>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900 tabular-nums">{fmt(eff.bruto)}</div>
                  {controleKort && <div className={`text-xs ${controle.status === 'klopt' ? 'text-green-700' : 'text-orange-700'}`}>{controleKort}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Btn v="secondary" onClick={probeerSluiten}>{t('btn_cancel')}</Btn>
                  {knoppen}
                </div>
              </div>
            </footer>
          </main>
        </div>
        {ongedaanBalk}
        {documentInvoer}
      </div>
    </div>,
    document.body,
  )
}

// ── Kleine bouwstenen ───────────────────────────────────────────────────────

const Draaier: React.FC = () => (
  <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-[var(--t-accent)] animate-spin flex-shrink-0" aria-hidden="true" />
)

const STROOK_KLEUR: Record<string, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  ok: 'bg-green-50 border-green-200 text-green-900',
  waarschuwing: 'bg-orange-50 border-orange-200 text-orange-900',
  fout: 'bg-red-50 border-red-200 text-red-800',
}

const Strook: React.FC<{ toon: 'info' | 'ok' | 'waarschuwing' | 'fout', actie?: { label: string, doe: () => void }, children: React.ReactNode }> = ({ toon, actie, children }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ${STROOK_KLEUR[toon]}`}>
    <span className="flex-1 min-w-0">{children}</span>
    {actie && <button type="button" onClick={actie.doe} className="font-semibold underline whitespace-nowrap text-sm">{actie.label}</button>}
  </div>
)

export default InkoopFactuurModal
