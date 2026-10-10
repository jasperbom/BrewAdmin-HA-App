import React, { useState, useRef } from 'react'
import { t, getLang } from '../i18n'
import { newId, wcGet, wcPut, wcPost, volgendFactuurNummer, volgendBestelNummer } from '../utils/api'
import { wcFoutMelding } from '../utils/wcFout'
import { geslotenPeriodeSets, magFactuurMuteren, standaardBtwPct, artikelBtwPct } from '../utils/btw'
import { orderIsGefactureerd, breweryMetTermijn, vervaldatumTekst } from '../utils/facturen'
import {
  bouwOrderFactuur, btwOverzicht, voorafFactuurBlokkade, voorafBlokkadeSleutel, orderFactuurVan,
  factuurIsGecrediteerd, bouwCreditnota,
} from '../utils/orderFactuur'
import { fmt, fmtD, fmtWeekdagDatum, tod } from '../utils/format'
import { voorraadPerLocatie, getAgpLocatie, pickUitgeslagen, accijnsMaandGesloten } from '../utils/calculations'
import { verkoopUitAgpToegestaan, uitTeSlaan, bouwUitslagBoekingen, uitslagDatumFout, laatsteAfvulDatum, VERPLAATS_FOUT_KEYS } from '../utils/agp'
import { bouwVerkoopUitleveringen, orderUitgeleverd, pickZonderUitlevering, bouwPickTerugdraaiing, PickTerugdraaiing } from '../utils/uitlevering'
import { agpGereserveerdPerAfvulling } from '../utils/kassa'
import { beschikbaarVoorAfvulling as beschikbaarNaPicks, beschikbaarPerLocatieNaPicks, beschikbaarBuitenAgpNaPicks } from '../utils/beschikbaarheid'
import { verkoopbareAfvullingen } from '../utils/haccp'
import UitslagModal from '../components/UitslagModal'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import BevestigKnop from '../components/ui/BevestigKnop'
import SectionHeader from '../components/ui/SectionHeader'
import { printPakbon, printFactuur, printPicklijst, buildPakbonHTML, buildFactuurHTML } from '../components/PakbonExport'
import type { PicklijstPakbonnen } from '../components/PakbonExport'
import MailModal from '../components/MailModal'
import { herbruikbareBetaallink, betaallinkRecord } from '../utils/mollieLink'
import WcProductModal from '../components/WcProductModal'
import { WcVelden } from '../utils/wcProduct'
import { crafteryMeta } from '../utils/craftery'
import { bierInvulVelden, bierInfoVoorArtikel } from '../utils/bierinfo'
import { htmlToPdfBase64 } from '../utils/pdf'
import { qrDataUrl } from '../utils/qr'
import { factuurMailBetaalVars } from '../utils/factuurMail'
import { importeerWcOrders, pasImportToe, importAuditRegels, importMelding } from '../utils/wcOrderImport'
import { wcTerugschrijfPlan, wcSyncVelden, WcSyncDoel } from '../utils/wcTerugschrijven'
import {
  leveringMailVars, verzendMailVars, afhaalLink, afhaalmomentLabel, wilVerzendbevestiging, afhaalmomentVerstreken, afhaalGemistMailVars, bestelLink, afhaalMailKnop, afhaalGemistMailKnop, MailKnop,
} from '../utils/levering'
import { logAudit } from '../utils/audit'
import { resolveKlantSnapshot, findKlantVoorOrder } from '../utils/klant'
import { verkoopFactuurBoeking, stornoBoekingVoor, voegBoekingToe } from '../utils/journaal'
import { totaliseerRegels } from '../utils/centen'
import { regelBedrag, corrigeerRegelBtw } from '../utils/orderRegel'
import { matchAfvullingenVoorRegel, bestellingenOmTePicken, picklijstMetReservering, orderNummer, orderProductId, onGepickteRegels, herkomstVanPick } from '../utils/picking'
import type { PickHerkomstData, Picklijst } from '../utils/picking'
import {
  bestellingBron, filterBestellingen, statusTellingen, volgendeOrderStap, orderTotalen, leesBestellingStartFilter,
} from '../utils/bestelling'
import type { StatusFilter } from '../utils/bestelling'
import { bestellingLevering, leverLabel } from '../utils/verkoopOverzicht'
import type { VerkoopCtx, OrderRegelLevering } from '../utils/verkoopOverzicht'
import { productEbc } from '../utils/bierKleur'
import type { AttentieDoel } from '../utils/attentie'
import type { GaNaar, GaNaarOpties } from '../utils/route'
import { _fetchedKeys } from '../utils/api'
import LegeStaat from '../components/ui/LegeStaat'
import SearchInput from '../components/ui/SearchInput'
import RowActions from '../components/ui/RowActions'
import type { RowActie } from '../components/ui/RowActions'
import ActieBalk from '../components/ui/ActieBalk'
import { useUndo } from '../components/ui/UndoBar'
import StatusChips from '../components/bestelling/StatusChips'
import MerchBeheer from '../components/bestelling/MerchBeheer'
import BestellingKaart from '../components/bestelling/BestellingKaart'
import OrderRegelKaart from '../components/bestelling/OrderRegelKaart'
import OrderTotalenBlok from '../components/bestelling/OrderTotalenBlok'
import OrderLogboek from '../components/bestelling/OrderLogboek'
import PaginaMelding from '../components/bestelling/PaginaMelding'
import KomtEraanRegel, { komtEraanTekst } from '../components/bestelling/KomtEraanRegel'
import { StatusChip, BetaaldBadge, GefactureerdBadge, LeveringBadge, KlantTypeChip, WcSyncBadge } from '../components/bestelling/BestellingBadges'
import {
  MerchArtikel, MerchMutatie, merchLabel, onthoudMerch, vergeetMerch, verwijderMerch,
  volgtVoorraad, merchVoorraad,
  boekMerchMutaties, merchAfboekingenVoorRegels, merchTekorten, merchGereserveerd, merchBeschikbaarVoorWc,
} from '../utils/merch'
import BierKleur from '../components/ui/BierKleur'
import Icon from '../components/ui/Icon'
import { lotcodeVanAfvulling } from '../utils/afvulsessie'
import { batchNummer } from '../utils/productKeten'
import type { AfvulSessie } from '../types'

interface BestellingenPageProps {
  /** De gedeelde verkoopcontext uit App.tsx (dezelfde telling als het
   *  Overzicht en de productpagina); zonder bouwt de pagina een eigen. */
  verkoopCtx?: VerkoopCtx | null
  bat: any[]
  av: any[]
  /** Afvulsessies: de lotcode van een afvulling zonder eigen code (pickmodal). */
  afvulSessies?: AfvulSessie[]
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  artikelen: any[]
  verpakkingen?: any[]
  bestellingen: any[]
  setBestellingen: any
  bestellingPicks: any[]
  setBestellingPicks: any
  verkoopFacturen: any[]
  setVerkoopFacturen: any
  wcCreds?: any
  accijnsInst?: any
  breweryDetails?: any
  appName?: string
  logo?: string | null
  factuurCounter?: any
  setFactuurCounter?: any
  log?: any[]
  setLog?: any
  factuurLogo?: string | null
  /** De geopende bestelling uit de route (`#/verkoop/bestellingen/<id>`, App.tsx). */
  recordId?: string | null
  /** Een bestelling openen of sluiten = de route wijzigen (een history-entry). */
  onOpenRecord?: (id: number | null, opties?: GaNaarOpties) => void
  /** Navigatie van de schil: ketenlinks naar product en batch (F13). */
  gaNaar?: GaNaar
  /** Voor "komt eraan" bij een tekort (verwacht verlies, `utils/verkoopOverzicht`). */
  verliesRegistraties?: any[]
  /** `planningInst.conditioneren_dagen`: de verwachte afvuldatum van een batch in de tank. */
  conditionerenDagen?: number | null
  /** De bierkleur van een regel valt terug op het recept van het product (`productEbc`). */
  recepten?: any[]
  klanten: any[]
  setKlanten?: any
  auditLog?: any[]
  setAuditLog?: any
  producten?: any[]
  productArtikelen?: any[]
  locaties?: any[]
  verplaatsingen?: any[]
  /** Voor uitslaan vanuit de bestelflow (verplaatsing AGP → vrije voorraad). */
  setVerplaatsingen?: any
  accijnsAangiftes?: any[]
  afboekingen?: any[]
  smtpCreds?: any
  mollieCreds?: any
  mailTemplates?: any
  btwTarieven?: (number | string)[]
  btwInst?: any
  btwAangiftes?: any[]
  bankKoppelingen?: Record<string, any>
  setJournaal?: any
  merchArtikelen?: MerchArtikel[]
  setMerchArtikelen?: any
  merchVoorraadLog?: MerchMutatie[]
  setMerchVoorraadLog?: any
  /** Deep-link vanuit de attentie-badge: startfilter van de lijst (`te_picken`).
      Eenmalig signaal — de pagina consumeert en wist het via onNavDoelConsumed. */
  navDoel?: AttentieDoel | null
  onNavDoelConsumed?: () => void
}

// Een orderregel die met "Verwijderen" uit beeld gaat: vijf seconden terugweg
// (UndoBar), daarna echt weg.
const REGEL_UNDO = 'orderregel-weg-'
// Idem voor een merch-artikel uit de lijst.
const MERCH_UNDO = 'merch-weg-'

const BestellingenPage: React.FC<BestellingenPageProps> = ({
  bat, av, afvulSessies=[], uit, setUit, acc, setAcc,
  artikelen, verpakkingen=[], bestellingen, setBestellingen,
  bestellingPicks, setBestellingPicks,
  verkoopFacturen, setVerkoopFacturen,
  wcCreds, accijnsInst, breweryDetails, appName='', logo=null,
  factuurCounter, setFactuurCounter=()=>{},
  log=[], setLog=()=>{}, factuurLogo=null,
  recordId=null, onOpenRecord, gaNaar,
  verliesRegistraties=[], conditionerenDagen=null, recepten=[],
  klanten=[],
  auditLog=[], setAuditLog=()=>{},
  producten=[], productArtikelen=[],
  locaties=[], verplaatsingen=[], afboekingen=[],
  setVerplaatsingen=()=>{}, accijnsAangiftes=[],
  smtpCreds={enabled:false},
  mollieCreds={enabled:false},
  mailTemplates={},
  btwTarieven=[0, 9, 21],
  btwInst={}, btwAangiftes=[], bankKoppelingen={},
  setJournaal=()=>{},
  merchArtikelen=[], setMerchArtikelen=()=>{},
  merchVoorraadLog=[], setMerchVoorraadLog=()=>{},
  navDoel=null, onNavDoelConsumed=()=>{},
  verkoopCtx: verkoopCtxProp = null,
}) => {
  // De geopende bestelling. De route is de bron (App.tsx): een bestelling
  // openen of sluiten wijzigt de URL, zodat de terugknop van het toestel, een
  // herlaad en een gedeelde link werken. Zonder route (losse inbedding) lokaal.
  const gestuurd = typeof onOpenRecord === 'function'
  const [lokaalView, setLokaalView] = useState<'list' | 'detail'>('list')
  const [lokaalId, setLokaalId] = useState<number | null>(null)
  const routeOrder = gestuurd && recordId != null && recordId !== ''
    ? (bestellingen || []).find((b: any) => String(b.id) === String(recordId))
    : undefined
  const selectedId: number | null = gestuurd ? (routeOrder ? routeOrder.id : null) : lokaalId
  const view: 'list' | 'detail' = gestuurd ? (recordId != null && recordId !== '' ? 'detail' : 'list') : lokaalView
  const openOrder = (id: number | null, opties?: GaNaarOpties) => {
    if (gestuurd) { onOpenRecord!(id, opties); return }
    setLokaalId(id)
    setLokaalView(id == null ? 'list' : 'detail')
  }
  // Ontgrendelt het corrigeren van de BTW op een reeds afgeronde order (past dan
  // ook de gekoppelde verkoopfactuur aan). Bewust expliciet, want normaal is een
  // afgeronde order vergrendeld.
  const [btwCorrectie, setBtwCorrectie] = useState<number | null>(null)

  // Startfilter uit het navigatiedoel (attentie-badge "Bestellingen om te
  // picken" → filter 'te_picken'). App.tsx mount de pagina per navigatie, dus
  // de useState-initializer volstaat; de callback wist alleen het App-signaal.
  // Ook met een zoektekst erachter ("te_picken:Kadeblond"): de productpagina
  // opent zo de open bestellingen met dat bier.
  const startFilter = leesBestellingStartFilter(navDoel?.filter)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(startFilter?.status ?? 'alle')
  React.useEffect(() => {
    if (navDoel) onNavDoelConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Zoeken in de lijst: ordernummer, klant, bier (utils/bestelling).
  const [zoek, setZoek] = useState(startFilter?.zoek ?? '')
  // Een melding op de pagina in plaats van een alert(): een mislukte PDF, een
  // geblokkeerd printvenster, een periode die op slot zit.
  const [melding, setMelding] = useState('')
  // Waarom afronden (de factuur) niet doorging, in de modal zelf; en de
  // waarschuwing bij een merch-tekort die je eerst bevestigt (geen confirm()).
  const [afrondFout, setAfrondFout] = useState('')
  const [merchTekortMelding, setMerchTekortMelding] = useState('')
  const merchTekortAkkoordRef = useRef(false)
  // "Picks terugdraaien" vraagt eerst, in een venster (het ⋯-menu kan geen
  // bevestiging in de knop zelf dragen).
  const [terugdraaiVraag, setTerugdraaiVraag] = useState(false)
  const [vrijeRegelFout, setVrijeRegelFout] = useState('')
  const undo = useUndo()
  // "Te picken" = dezelfde selectie als de attentie-badge en het Verkoop-
  // dashboard (utils/picking.ts): nieuw/bevestigd én nog niet volledig gepickt.
  const omTePickenIds = React.useMemo(
    () => new Set(bestellingenOmTePicken(bestellingen, bestellingPicks).map((b: any) => b.id)),
    [bestellingen, bestellingPicks])
  const [wcImporting, setWcImporting] = useState(false)
  const [wcMsg, setWcMsg] = useState('')
  const [showManualModal, setShowManualModal] = useState(false)
  const [showPickModal, setShowPickModal] = useState(false)
  // Waarom "Bevestigen" in de pickmodal niet doorging: in de modal zelf, naast
  // de knop, in plaats van een alert().
  const [pickFout, setPickFout] = useState('')
  const [showAfrondModal, setShowAfrondModal] = useState(false)
  // Leeg = "neem de klant van de order over" (zie bouwVerkoopRecords). Het
  // formulier wordt bij het wisselen van order teruggezet: een geadresseerde
  // die bij een exportorder is ingevuld mag niet blijven hangen en de volgende
  // uitlevering op de verkeerde afnemer boeken.
  const emptyUitleveringForm = {type_uitlevering: 'binnenland' as string, bestemming_naam: '', bestemming_adres: '', bestemming_land: 'NL', vervoerder: ''}
  const [uitleveringForm, setUitleveringForm] = useState(emptyUitleveringForm)
  const [showAnnuleerModal, setShowAnnuleerModal] = useState(false)
  // Standaard BTW-tarief uit de instellingen (21% tenzij anders ingesteld)
  const stdBtw = standaardBtwPct(btwInst, btwTarieven)

  // Regelsoort van een orderregel. Oude orders (en handmatige regels van vóór
  // de merch-splitsing) hebben géén `type`: die zijn bierregels. Het hele
  // pick- en afrondtraject moet daar hetzelfde over denken — anders telt een
  // regel wél mee voor "er moet gepickt worden" maar niet voor "alles is
  // gepickt", en loopt de order vast zonder uitweg.
  const regelSoort = (r: any): string => r?.type || 'bier'
  const isPickRegel = (r: any): boolean => regelSoort(r) === 'bier'
  const [showVrijeRegelModal, setShowVrijeRegelModal] = useState(false)
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw)})
  const [showVerzendkostenModal, setShowVerzendkostenModal] = useState(false)
  const [verzendkostenForm, setVerzendkostenForm] = useState({naam: '', prijs_per_stuk: '', btw_pct: '21'})
  // Volledige WooCommerce-productkaart van één merch-artikel.
  const [wcMerchModal, setWcMerchModal] = useState<MerchArtikel | null>(null)
  const emptyMerchMutatie = {merch_id: 0, reden: 'inkoop' as MerchMutatie['reden'], aantal: '', prijs: '', notitie: ''}
  const [merchMutatieForm, setMerchMutatieForm] = useState(emptyMerchMutatie)
  const [showMerchMutatie, setShowMerchMutatie] = useState(false)
  const [merchMutatieFout, setMerchMutatieFout] = useState('')

  // Draft picks state (voor picking modal)
  const [draftPicks, setDraftPicks] = useState<Record<number, Array<{afvulling_id: number, aantal: number, bron_locatie_id?: number | null}>>>({})

  // Manual order form
  const emptyManual = {
    klant_id: null as number | null,
    klant_naam: '', klant_email: '', klant_bedrijf: '',
    klant_straat: '', klant_huisnummer: '', klant_postcode: '', klant_stad: '',
    opmerkingen: '',
    klant_type: 'prive' as 'prive' | 'zakelijk',
    regels: [] as any[]
  }
  const [manualForm, setManualForm] = useState<any>(emptyManual)
  const emptyRegel = {bier_naam: '', verpakking_type: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw), omschrijving: '', prijsType: 'normaal'}
  const [regelForm, setRegelForm] = useState<any>(emptyRegel)
  const [manualVerzending, setManualVerzending] = useState({enabled: false, naam: '', prijs: '', btw_pct: '21'})

  const selectedOrder = (bestellingen||[]).find((b: any) => b.id === selectedId)

  React.useEffect(() => { setUitleveringForm(emptyUitleveringForm) }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot van de bestelling met overschreven klant_*-velden uit de live
  // klantkaart. Reeds gegenereerde PDF's blijven hun historische snapshot
  // houden — alleen rendering en mailing volgen de actuele klantkaart.
  const resolvedSelectedOrder = selectedOrder
    ? resolveKlantSnapshot(selectedOrder, klanten)
    : null

  // Afnemer die op de uitlevering komt te staan wanneer het bestemmingsveld
  // leeg blijft. Zonder afnemer is een geleverde partij bij een terugroepactie
  // niet naar een klant te herleiden (handboek hoofdstuk 11).
  const afnemerVanOrder = String(resolvedSelectedOrder?.klant_bedrijf
    || resolvedSelectedOrder?.klant_naam || selectedOrder?.klant_naam || '').trim()
  const adresVanOrder = [resolvedSelectedOrder?.klant_straat,
    resolvedSelectedOrder?.klant_huisnummer, resolvedSelectedOrder?.klant_postcode,
    resolvedSelectedOrder?.klant_stad].filter(Boolean).join(' ')

  // Lijst: statuschip én zoektekst, nieuwste eerst (utils/bestelling).
  const filtered = filterBestellingen(bestellingen, {status: statusFilter, zoek, omTePicken: omTePickenIds})
  const tellingen = statusTellingen(bestellingen, omTePickenIds)

  // De totalen van een order zoals de factuur ze krijgt: per regel
  // `regelBedrag` (cent-exact, met behoud van de autoritatieve WooCommerce-
  // bedragen — 2× €2,00 blijft €4,00) plus het statiegeld dat de factuur van
  // een handmatige order erbij krijgt. Lijst, detail en factuur tonen zo
  // hetzelfde totaal (utils/bestelling → orderTotalen).
  const totalenVan = (b: any) => orderTotalen(b, verpakkingen || [])

  // Zichtbaar ordernummer: `orderNummer` uit utils/picking.ts (ook de
  // kopbalk van de schil gebruikt hem). De chips (status, betaald, levering,
  // webshop) staan in components/bestelling/BestellingBadges.tsx.

  // Eén voorraadtelling voor Verkoop (utils/verkoopOverzicht): kan een
  // orderregel geleverd worden, en wat komt eraan bij een tekort. Dezelfde
  // matcher en dezelfde vrije voorraad als de pickmodal.
  const eigenVerkoopCtx = React.useMemo((): VerkoopCtx => ({
    producten, productArtikelen, artikelen, merchArtikelen, verpakkingen, batches: bat, afvullingen: av,
    uitleveringen: uit, verplaatsingen, afboekingen, locaties, bestellingen, bestellingPicks,
    verliesRegistraties, conditionerenDagen,
  }), [producten, productArtikelen, artikelen, merchArtikelen, verpakkingen, bat, av, uit, verplaatsingen,
    afboekingen, locaties, bestellingen, bestellingPicks, verliesRegistraties, conditionerenDagen])
  const verkoopCtx: VerkoopCtx = verkoopCtxProp || eigenVerkoopCtx

  // Herkomst van een pick (lotcode, batch, THT): pickoverzicht, pakbon, picklijst.
  const herkomstData: PickHerkomstData = {afvullingen: av, batches: bat, afvulSessies}

  // Picks voor een bestelling
  const picksVoorOrder = (bestelling_id: number) =>
    (bestellingPicks||[]).filter((p: any) => p.bestelling_id === bestelling_id)

  // Aantal gepickt per regel
  const gepicktVoorRegel = (bestelling_id: number, regel_id: number) =>
    (bestellingPicks||[])
      .filter((p: any) => p.bestelling_id === bestelling_id && p.regel_id === regel_id)
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)

  // Effectief klant_type voor een bestelling. Bestaande orders zonder dit veld
  // worden lazy gebackfilld op basis van klant_bedrijf, maar alleen wanneer de
  // order nog niet verzonden is — historisch gepickte/verzonden orders blijven
  // onaangeroerd zodat eerdere AGP-allocaties niet alsnog ongeldig worden.
  const effectiveKlantType = (b: any): 'prive' | 'zakelijk' | undefined => {
    if (!b) return undefined
    if (b.klant_type === 'prive' || b.klant_type === 'zakelijk') return b.klant_type
    if (b.status === 'verzonden' || b.status === 'afgerond') return undefined
    return (b.klant_bedrijf || '').trim() ? 'zakelijk' : 'prive'
  }

  // Voorraadtelling gedeeld met de kassa en de productpagina
  // (utils/beschikbaarheid.ts): afgevuld min open picks, uitleveringen en
  // afboekingen. `excludeBestellingId` laat de picks van de order die je nu
  // pickt buiten beschouwing.
  const voorraadData = {bestellingPicks, bestellingen, uit, afboekingen, locaties, verplaatsingen} as any

  // Beschikbaar voor een afvulling (exclusief open orders picks, inclusief deze bestelling)
  const beschikbaarVoorAfvulling = (a: any, excludeBestellingId?: number): number =>
    beschikbaarNaPicks(a, voorraadData, excludeBestellingId)

  // Beschikbaar per locatie: fysieke voorraad per locatie min de picks van
  // andere orders. Een pick zonder bronlocatie legt eerst vrije voorraad vast
  // (daar haalt de uitlevering hem ook vandaan), alleen de rest de AGP.
  const beschikbaarPerLocatieVoorAfvulling = (a: any, excludeBestellingId?: number): Record<number, number> =>
    beschikbaarPerLocatieNaPicks(a, voorraadData, excludeBestellingId)

  // Beschikbaar voor een afvulling exclusief AGP-voorraad: wat verkocht kan
  // worden. Een verkoop komt nooit rechtstreeks uit de AGP (behalve export /
  // intra-EU) — eerst uitslaan, zie utils/agp.ts.
  const beschikbaarBuitenAgpVoorAfvulling = (a: any, excludeBestellingId?: number): number =>
    beschikbaarBuitenAgpNaPicks(a, voorraadData, excludeBestellingId)

  // Compact label met voorraad per locatie voor één afvulling, bv. "AGP: 20, Magazijn: 10".
  // Geeft lege string terug als slechts één locatie voorraad heeft (info niet nuttig).
  const voorraadPerLocLabel = (a: any): string => {
    if (!a || !(locaties||[]).length) return ''
    const v = voorraadPerLocatie(a, locaties as any, uit as any, verplaatsingen as any, afboekingen as any)
    const entries = Object.entries(v)
      .map(([k, n]) => ({locId: Number(k), n: Number(n)}))
      .filter(e => e.n > 0)
    if (entries.length === 0) return ''
    if (entries.length === 1) {
      const loc = (locaties||[]).find((l: any) => l.id === entries[0].locId)
      return loc ? `${loc.naam}: ${entries[0].n}` : ''
    }
    return entries
      .map(e => {
        const loc = (locaties||[]).find((l: any) => l.id === e.locId)
        return `${loc?.naam || '?'}: ${e.n}`
      })
      .join(', ')
  }

  // Beschikbare afvullingen voor een orderregel. Matching (incl. SKU-wijziging
  // in het verleden → product-fallback) zit in utils/picking.ts.
  const getAvailableAfvullingen = (regelBierNaam: string, regelVerpakking: string, excludeBestellingId?: number, _unused?: any, regelArtikelKey?: string, regelSku?: string) => {
    // Bepaal SKU: direct uit regel, of via artikel_key lookup
    const orderSku = regelSku || (regelArtikelKey ? (artikelen||[]).find((a: any) => a.key === regelArtikelKey)?.artikelnummer : null) || null
    // Geblokkeerd na een afgekeurde sluitcontrole (CCP 2): niet leverbaar
    // tot de afwijking is afgehandeld. Het bier blijft wel fysiek aanwezig
    // en telt dus door in de accijnsvoorraad.
    const filtered = verkoopbareAfvullingen(av).filter((a: any) => beschikbaarVoorAfvulling(a, excludeBestellingId) > 0)
    return matchAfvullingenVoorRegel(filtered, regelBierNaam, regelVerpakking, orderSku,
      {bat, artikelen, producten, productArtikelen, verpakkingen})
  }

  // Verzamelpicklijst: alle bestellingen "om te picken" in één ronde door de
  // koeling (utils/picking.ts → picklijstMetReservering). Afdrukken legt per
  // bestelling vast uit welke afvulling het bier komt (een pick zonder
  // uitlevering), uit de vrije voorraad buiten de AGP — daaruit wordt verkocht;
  // wat nog in de AGP ligt blijft tekort (eerst uitslaan). Zo staan lot, THT en
  // batch op de pakbon in de doos en staat de pickmodal al ingevuld;
  // bevestigen blijft per order. De SKU van een regel zoals de pickmodal hem
  // bepaalt (`getAvailableAfvullingen`).
  const picklijstOpties = () => ({
    afvullingen: av || [],
    beschikbaar: (a: any) => Math.min(beschikbaarVoorAfvulling(a), beschikbaarBuitenAgpVoorAfvulling(a)),
    data: {bat, artikelen, producten, productArtikelen, verpakkingen},
    orderRef: orderNummer,
    isPrive: (b: any) => effectiveKlantType(b) === 'prive',
    afvulSessies,
    skuVoorRegel: (r: any) => r?.sku || (r?.artikel_key ? (artikelen||[]).find((a: any) => a.key === r.artikel_key)?.artikelnummer : null) || null,
  })
  // Achter de picklijst de pakbon van elke bestelling erop, voor in de doos
  // (zonder concept-markering, zie PakbonExport). Klantgegevens van de live
  // klantkaart, zoals bij de losse pakbon; de datum is vandaag — dan pak je in.
  const doosPakbonnen = (lijst: Picklijst, picks: any[]): PicklijstPakbonnen => ({
    afvullingen: av, batches: bat, sessies: afvulSessies,
    bestellingen: lijst.orders.flatMap(o => {
      const b = (bestellingen || []).find((x: any) => x.id === o.bestelling_id)
      if (!b) return []
      return [{order: {...resolveKlantSnapshot(b, klanten), pakbon_datum: tod()},
        picks: picks.filter((p: any) => p.bestelling_id === b.id)}]
    }),
  })
  const printPicklijstVoor = (orders: any[]) => {
    const {lijst, reservering} = picklijstMetReservering(orders, bestellingPicks || [], picklijstOpties())
    if (!lijst.orders.length) { setMelding(t('msg_picklijst_leeg')); return }
    let pickId = newId(bestellingPicks || [])
    const nieuwePicks = reservering.map(r => ({
      id: pickId++, ...r, bron_locatie_id: undefined, uitlevering_id: null, accijns_id: null,
    }))
    const allePicks = [...(bestellingPicks || []), ...nieuwePicks]
    const geprint = printPicklijst(lijst, breweryDetails || {}, appName, factuurLogo || logo,
      {onGeblokkeerd: setMelding, pakbonnen: doosPakbonnen(lijst, allePicks)})
    // Printvenster geblokkeerd: niets vastleggen, de volgende poging reserveert opnieuw.
    if (!geprint || !nieuwePicks.length) return
    setBestellingPicks((prev: any[]) => [...(prev || []), ...nieuwePicks])
    for (const id of new Set(nieuwePicks.map(p => p.bestelling_id))) {
      const b = (bestellingen || []).find((x: any) => x.id === id)
      const stuks = nieuwePicks.filter(p => p.bestelling_id === id).reduce((s, p) => s + p.aantal, 0)
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Bestelling',
        entiteit_id: id,
        actie: 'gewijzigd',
        omschrijving: `Voorraad gereserveerd bij het afdrukken van de picklijst — ${b?.klant_naam || orderNummer(b)} (${stuks} stuks)`,
      })
    }
  }
  const printVerzamelPicklijst = () => printPicklijstVoor(bestellingen)
  // Dezelfde picklijst voor één bestelling (⋯ in de bestelling): wat er nog
  // gepickt moet worden, met uit welk lot je het pakt, en de pakbon erachter.
  const printOrderPicklijst = () => {
    if (!selectedOrder) return
    printPicklijstVoor([selectedOrder])
  }

  // Beschikbare bieren voor dropdown (vanuit producten + artikelen fallback)
  const beschikbareBieren = [...new Set([
    ...(producten||[]).filter((p: any) => p.status !== 'gearchiveerd').map((p: any) => p.naam),
    ...(artikelen||[]).map((a: any) => a.biernaam)
  ].filter(Boolean))] as string[]
  const verpakkingVoorBier = (biernaam: string) => {
    const prod = (producten||[]).find((p: any) => p.naam === biernaam);
    if (prod) {
      const paTypes = (productArtikelen||[]).filter((a: any) => a.product_id === prod.id).map((a: any) => a.verpakking_type).filter(Boolean);
      if (paTypes.length) return paTypes;
    }
    return (artikelen||[]).filter((a: any) => a.biernaam === biernaam).map((a: any) => a.verpakking_type).filter(Boolean);
  }
  const artikelVoorKeuze = (biernaam: string, verpakking: string) => {
    const prod = (producten||[]).find((p: any) => p.naam === biernaam);
    if (prod) {
      const pa = (productArtikelen||[]).find((a: any) => a.product_id === prod.id && a.verpakking_type === verpakking);
      if (pa) return pa;
    }
    return (artikelen||[]).find((a: any) => a.biernaam === biernaam && a.verpakking_type === verpakking);
  }
  // Het product van een orderregel: op SKU, anders op naam — dezelfde
  // bepaling als de picking (utils/picking → orderProductId, utils/sku).
  const productIdVoorRegel = (r: any): number | null => {
    const sku = r?.sku || (r?.artikel_key ? (artikelen||[]).find((a: any) => a.key === r.artikel_key)?.artikelnummer : null) || null
    return orderProductId(sku, String(r?.bier_naam || ''), {bat, artikelen, producten, productArtikelen, verpakkingen})
  }
  // Bierkleur bij een orderregel: het product van de regel, met de kleur van
  // zijn recept als terugval (utils/bierKleur.ts productEbc).
  const ebcVoorRegel = (r: any): number | null => {
    const id = productIdVoorRegel(r)
    const prod = id != null
      ? (producten||[]).find((p: any) => p.id === id)
      : (producten||[]).find((p: any) => p.naam === r?.bier_naam)
    return prod ? productEbc(prod, recepten) : null
  }

  // Factuurnummering: server-side via volgendFactuurNummer() (ERP-plan 0.2) —
  // de client nummert nooit zelf (races/hergebruik).

  const genPakbonNummer = (): string => {
    const year = new Date().getFullYear()
    const prefix = `P${year}-`
    const existing = (bestellingen||[])
      .filter((b: any) => b.pakbon_nummer?.startsWith(prefix))
      .map((b: any) => parseInt(b.pakbon_nummer.replace(prefix, ''), 10))
      .filter((n: number) => !isNaN(n))
    const nextNum = existing.length ? Math.max(...existing) + 1 : 1
    return `${prefix}${String(nextNum).padStart(4, '0')}`
  }

  // --- WooCommerce import ---
  // De import zelf staat in utils/wcOrderImport.ts, zodat App.tsx hem ook
  // periodiek kan draaien; hier alleen de knop, de melding en het logboek.
  const importWcOrders = async () => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) { setWcMsg(t('error_no_woocommerce')); return }
    setWcImporting(true); setWcMsg('')
    try {
      const refs = {artikelen, productArtikelen, producten, bat, standaardBtw: stdBtw, btwTarieven,
        merch: merchArtikelen}
      // Met de picks: een order die in de winkel geannuleerd is en hier nog
      // niet gepickt, annuleert de import zelf (utils/wcOrderImport).
      const r = await importeerWcOrders({wcGet, refs, bestellingen: bestellingen || [], klanten: klanten || [], wcCreds, t,
        bestellingPicks: bestellingPicks || []})
      if (r.nieuw.length || Object.keys(r.updates).length) {
        setBestellingen((prev: any[]) => pasImportToe(prev, r))
        importAuditRegels(r).forEach(a => logAudit(auditLog, setAuditLog, {entiteit: 'Bestelling', ...a}))
      }
      setWcMsg(importMelding(r, t))
    } catch(e: any) {
      setWcMsg(t('msg_wc_import_failed').replace('{msg}', wcFoutMelding(e, t)))
    }
    setWcImporting(false)
    setTimeout(() => setWcMsg(''), 8000)
  }

  // Klantkaart bij de handmatige order zoeken (gekoppeld id eerst, dan
  // e-mail, anders exacte naam) — voor het automatisch toepassen van het
  // klant-kortingspercentage.
  const klantVoorManualForm = (): any => {
    if (manualForm.klant_id != null) {
      const k = (klanten||[]).find((k: any) => k.id === manualForm.klant_id)
      if (k) return k
    }
    const email = (manualForm.klant_email || '').trim().toLowerCase()
    const naam = (manualForm.klant_naam || '').trim().toLowerCase()
    if (email) {
      const k = (klanten||[]).find((k: any) => (k.email || '').toLowerCase() === email)
      if (k) return k
    }
    if (naam) return (klanten||[]).find((k: any) => (k.naam || '').trim().toLowerCase() === naam) || null
    return null
  }

  // Naamveld handmatige order: bij een exacte match op een klantnaam worden
  // e-mail, bedrijf en adres automatisch vanaf de klantkaart ingevuld (niet-
  // lege kaartwaarden winnen, net als resolveKlantSnapshot). Vervalt de match,
  // dan wordt alleen de koppeling (klant_id) losgelaten — reeds ingevulde
  // velden blijven staan.
  const handleManualNaamChange = (naam: string) => {
    setManualForm((f: any) => {
      const next: any = {...f, klant_naam: naam}
      const lc = naam.trim().toLowerCase()
      const k = lc ? (klanten||[]).find((kl: any) => (kl.naam || '').trim().toLowerCase() === lc) : null
      if (k) {
        next.klant_id = k.id
        const vul = (snapKey: string, val: any) => {
          const v = (val ?? '').toString().trim()
          if (v) next[snapKey] = v
        }
        vul('klant_email', k.email)
        vul('klant_bedrijf', k.bedrijf)
        vul('klant_straat', k.straat)
        vul('klant_huisnummer', k.huisnummer)
        vul('klant_postcode', k.postcode)
        vul('klant_stad', k.stad)
        next.klant_type = k.klant_type || (k.bedrijf ? 'zakelijk' : f.klant_type)
      } else if (f.klant_id != null) {
        next.klant_id = null
      }
      return next
    })
  }

  // Volgend regelnummer binnen één bestelling. Het aantal regels als nummer
  // gebruiken gaf na het verwijderen van een regel een nummer dat al bestond:
  // de picking koppelt een pick via `regel_id` aan een regel, dus een dubbel
  // nummer laat de gepickte aantallen bij de verkeerde regel belanden.
  const volgendRegelId = (regels: any[]): number =>
    (regels || []).reduce((m: number, r: any) => Math.max(m, Number(r?.id) || 0), 0) + 1

  // --- Handmatige order opslaan ---
  // Dubbelklikgrendel, zoals bij afronden: tussen de klik en het sluiten van
  // het formulier zit een netwerkronde (het bestelnummer). Een tweede klik in
  // dat venster maakte een tweede order en verbruikte een tweede M-nummer. Na
  // een geslaagde opslag blijft de grendel dicht tot het formulier opnieuw
  // opent.
  const manualOpslaanRef = useRef(false)
  const [manualOpslaanBezig, setManualOpslaanBezig] = useState(false)
  const openManualOrder = () => {
    manualOpslaanRef.current = false
    setManualOpslaanBezig(false)
    setManualForm(emptyManual)
    setShowManualModal(true)
  }
  const saveManualOrder = async () => {
    if (manualOpslaanRef.current) return
    manualOpslaanRef.current = true
    setManualOpslaanBezig(true)
    let gelukt = false
    try {
      gelukt = (await slaManualOrderOp()) === true
    } finally {
      if (!gelukt) {
        manualOpslaanRef.current = false
        setManualOpslaanBezig(false)
      }
    }
  }
  const slaManualOrderOp = async (): Promise<boolean | undefined> => {
    if (!manualForm.klant_naam.trim()) { alert(t('err_order_customer_required')); return }
    if (manualForm.klant_type === 'zakelijk' && !manualForm.klant_bedrijf?.trim()) {
      alert(t('err_order_company_required')); return
    }
    if (!manualForm.regels.length) { alert(t('err_order_min_lines')); return }
    let regels = [...manualForm.regels];
    // Klantkorting: vast percentage van de klantkaart, toegepast over de
    // productregels — bewust vóór de verzendkosten berekend zodat de korting
    // daar niet op geldt. Eén negatieve kortingsregel per BTW-tarief, zodat
    // de BTW-aangifte per tarief blijft kloppen.
    const kortingKlant = klantVoorManualForm()
    const kortingPct = Number(kortingKlant?.korting_pct || 0)
    if (kortingPct > 0) {
      const perBtw: Record<string, number> = {}
      for (const r of regels) {
        if (r.type && r.type !== 'bier') continue
        const netto = Number(r.aantal||0) * Number(r.prijs_per_stuk||0)
        if (netto <= 0) continue
        const k = String(Number(r.btw_pct||0))
        perBtw[k] = (perBtw[k]||0) + netto
      }
      for (const [btwPct, som] of Object.entries(perBtw)) {
        const bedrag = Math.round(som * kortingPct) / 100
        if (bedrag <= 0) continue
        const oms = t('lbl_korting_pct').replace('{pct}', String(kortingPct))
        regels.push({
          id: volgendRegelId(regels),
          type: 'korting',
          bier_naam: oms,
          verpakking_type: '',
          aantal: 1,
          prijs_per_stuk: -bedrag,
          btw_pct: Number(btwPct),
          omschrijving: oms,
        })
      }
    }
    if (manualVerzending.enabled && Number(manualVerzending.prijs) > 0) {
      regels.push({
        id: volgendRegelId(regels),
        type: 'verzending',
        bier_naam: manualVerzending.naam || t('lbl_verzendkosten'),
        verpakking_type: '',
        aantal: 1,
        prijs_per_stuk: Number(manualVerzending.prijs),
        btw_pct: Number(manualVerzending.btw_pct || 21),
        omschrijving: manualVerzending.naam || t('lbl_verzendkosten'),
      });
    }
    // Kort, oplopend bestelnummer via de server-reeks (atomair, botsingsvrij).
    // Lukt de server-call niet, dan valt de weergave terug op M-<id>.
    let bestelNummer: string | null = null
    try { bestelNummer = await volgendBestelNummer() } catch { bestelNummer = null }
    const nb: any = {
      id: newId(bestellingen||[]),
      status: 'nieuw',
      datum: tod(),
      ...manualForm,
      regels,
      wc_order_id: null,
      wc_order_nummer: null,
      bestel_nummer: bestelNummer,
    }
    setBestellingen((prev: any[]) => [...(prev||[]), nb])
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:nb.id, actie:'aangemaakt', omschrijving:`Handmatig — ${nb.klant_naam}`})
    setShowManualModal(false)
    setManualForm(emptyManual)
    setManualVerzending({enabled: false, naam: '', prijs: '', btw_pct: '21'})
    return true
  }

  const addRegel = () => {
    if (!regelForm.bier_naam || !regelForm.verpakking_type || !regelForm.aantal) {
      alert(t('err_order_line_fields_required')); return
    }
    const artMatch = artikelVoorKeuze(regelForm.bier_naam, regelForm.verpakking_type)
    const regel = {
      id: volgendRegelId(manualForm.regels),
      type: 'bier',
      artikel_key: artMatch?.key || null,
      artikel_id: artMatch?.id || null,
      bier_naam: regelForm.bier_naam,
      verpakking_type: regelForm.verpakking_type,
      aantal: Number(regelForm.aantal),
      prijs_per_stuk: regelForm.prijs_per_stuk !== '' ? Number(regelForm.prijs_per_stuk) : 0,
      // Leeg = het standaardtarief; 0% blijft 0% (was: `||9`).
      btw_pct: artikelBtwPct({btw_pct: regelForm.btw_pct}, stdBtw),
      omschrijving: regelForm.omschrijving || `${regelForm.bier_naam} ${regelForm.verpakking_type}`,
      prijsType: regelForm.prijsType || 'normaal',
    }
    setManualForm((f: any) => ({...f, regels: [...f.regels, regel]}))
    setRegelForm(emptyRegel)
  }

  // --- Helper: uitleveringen uit picks — de verkoop zelf ---
  // Uitslaan (AGP → vrije voorraad, accijns) is een aparte, eerdere stap; een
  // verkoop levert alleen uit vrije voorraad en boekt geen accijns. Alleen
  // export/intra-EU mag onder schorsing rechtstreeks uit de AGP
  // (utils/uitlevering.ts, utils/agp.ts → verkoopUitAgpToegestaan).
  // Bestemming: het invulveld wint (bij export vult de gebruiker een
  // afwijkende geadresseerde in), maar bij een binnenlandse levering is dat
  // veld niet eens zichtbaar. Val dan terug op de klant van de order —
  // die is bekend, en zonder afnemer op de uitlevering is de partij bij een
  // terugroepactie niet naar een klant te herleiden (handboek hoofdstuk 11).
  const bouwVerkoopRecords = (picksIn: any[], formData: typeof uitleveringForm) =>
    bouwVerkoopUitleveringen(
      picksIn,
      {
        type_uitlevering: formData.type_uitlevering || 'binnenland',
        bestemming_naam: String(formData.bestemming_naam || '').trim() || afnemerVanOrder,
        bestemming_adres: String(formData.bestemming_adres || '').trim() || adresVanOrder,
        bestemming_land: formData.bestemming_land || '',
        vervoerder: formData.vervoerder || '',
      },
      {afvullingen: av || [], batches: bat || [], locaties: locaties || [], uit: uit || [],
        verplaatsingen: verplaatsingen || [], afboekingen: afboekingen || [], datum: tod()},
      newId(uit || []),
    )

  // --- Uitslaan vanuit de bestelflow (zoals de kassa) ---
  // Ligt er te weinig vrij en nog wel iets in de AGP, dan hoef je de bestelling
  // niet te verlaten: eerst uitslaan (verplaatsing + accijns, dezelfde boeking
  // als de AGP-pagina en de kassa), daarna picken/verkopen. Het scherm waar je
  // vandaan kwam gaat even dicht (twee modals vechten om de focus) en daarna
  // weer open; de invoer blijft staan.
  const [uitslagDoel, setUitslagDoel] = useState<{naam: string, afvullingen: any[], aantal: number, terug: 'pick' | 'manual'} | null>(null)

  const openUitslagVanuit = (terug: 'pick' | 'manual', naam: string, afvullingen: any[], aantal: number) => {
    // Vanuit de pickmodal staat de melding in de modal zelf (pickFout).
    const meld = (tekst: string) => { if (terug === 'pick') setPickFout(tekst); else alert(tekst) }
    // Periode-lock (ERP-plan 0.4): een uitslag boekt accijns op de uitslagdatum.
    if (accijnsMaandGesloten(tod(), accijnsAangiftes || [])) {
      meld(t('err_accijns_maand_gesloten_boeking')); return
    }
    if (!(locaties || []).some((l: any) => !l.is_agp)) {
      meld(t('pos_uitslag_geen_locatie')); return
    }
    // Een eerdere melding geldt niet meer na het uitslaan.
    setPickFout('')
    if (terug === 'pick') setShowPickModal(false)
    else setShowManualModal(false)
    setUitslagDoel({naam, afvullingen, aantal, terug})
  }

  const sluitUitslag = () => {
    if (uitslagDoel?.terug === 'pick') setShowPickModal(true)
    if (uitslagDoel?.terug === 'manual') setShowManualModal(true)
    setUitslagDoel(null)
  }

  const saveUitslag = ({allocaties, naar_locatie_id, datum, opmerking}: any) => {
    // De gekozen datum wordt de accijnsdatum: periode-lock en datumregels
    // gelden daarop (tweede slot naast de modal).
    const datumFout = uitslagDatumFout(datum, allocaties, {accijnsAangiftes: accijnsAangiftes || []})
    if (datumFout) {
      alert(t(VERPLAATS_FOUT_KEYS[datumFout]).replace('{datum}', fmtD(laatsteAfvulDatum(allocaties)))); return
    }
    const naar = (locaties || []).find((l: any) => l.id === naar_locatie_id)
    const r = bouwUitslagBoekingen(
      {allocaties, naar_locatie_id, datum, opmerking},
      {locaties, uit, verplaatsingen, afboekingen, accijnsInst},
      () => ({verplaatsing_id: newId(verplaatsingen || []), accijns_id: newId(acc || []), log_id: newId(log || [])}),
      {logTitel: t('agp_verplaats_titel')}
    )
    if (r.verplaatsingen.length) setVerplaatsingen((prev: any[]) => [...(prev || []), ...r.verplaatsingen])
    if (r.accijns.length) setAcc((prev: any[]) => [...(prev || []), ...r.accijns])
    if (r.log.length) setLog((prev: any[]) => [...(prev || []), ...r.log])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: r.verplaatsingen[0]?.id, actie: 'aangemaakt',
      omschrijving: `${t('orders_uitslag_audit')}: ${r.totaal}\u00d7 ${uitslagDoel?.naam || ''} \u2192 ${naar?.naam || ''}${r.totaalAccijns ? ` (accijns ${fmt(r.totaalAccijns)})` : ''}`,
    })
    sluitUitslag()
  }

  // Uitslaan uit de AGP vanuit pickmodal of nieuwe bestelling. De pickmodal
  // leeft in de detailweergave, het formulier in de lijst — beide renderen dit.
  const uitslagModal = uitslagDoel && (
    <UitslagModal
      productNaam={uitslagDoel.naam}
      afvullingen={uitslagDoel.afvullingen}
      startAantal={uitslagDoel.aantal}
      batches={bat || []}
      locaties={locaties}
      uit={uit}
      verplaatsingen={verplaatsingen}
      afboekingen={afboekingen}
      accijnsInst={accijnsInst}
      accijnsAangiftes={accijnsAangiftes || []}
      gereserveerd={agpGereserveerdPerAfvulling(
        bestellingPicks || [], bestellingen || [], getAgpLocatie(locaties as any).id,
        {afvullingen: av || [], locaties: locaties || [], uit, verplaatsingen, afboekingen})}
      onClose={sluitUitslag}
      onOpslaan={saveUitslag}
    />
  )

  // Vrije voorraad en AGP-voorraad van een set afvullingen (harde picks van
  // andere orders eraf) — voor de hint en de uitslaan-knop.
  const vrijEnAgp = (afvs: any[], excludeBestellingId?: number): {vrij: number, agp: number} => {
    const agpId = getAgpLocatie(locaties as any).id
    let vrij = 0, agp = 0
    for (const a of afvs || []) {
      const perLoc = beschikbaarPerLocatieVoorAfvulling(a, excludeBestellingId)
      for (const k of Object.keys(perLoc)) {
        if (Number(k) === agpId) agp += Number(perLoc[Number(k)] || 0)
        else vrij += Number(perLoc[Number(k)] || 0)
      }
    }
    return {vrij, agp}
  }

  // Voorraad voor een bier+verpakking in het formulier "nieuwe bestelling":
  // hoeveel ligt er vrij (verkoopbaar), hoeveel nog in de AGP (eerst uitslaan).
  const voorraadVoorKeuze = (bier: string, vp: string) => {
    const art = artikelVoorKeuze(bier, vp)
    const afvs = getAvailableAfvullingen(bier, vp, undefined, null, art?.key || undefined, art?.artikelnummer || undefined)
    return {afvs, ...vrijEnAgp(afvs)}
  }

  // --- Klanttype (privé/zakelijk) van een bestaande order corrigeren ---
  // Alleen vóór het picken. Het klanttype bepaalt prijs (B2B) en factuur, niet
  // meer waar het bier vandaan komt: elke binnenlandse verkoop gaat uit vrije
  // voorraad. Handig om een verkeerd gedetecteerde WooCommerce-import recht
  // te zetten.
  const wijzigKlantType = (kt: 'prive' | 'zakelijk') => {
    if (!selectedOrder) return
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, klant_type: kt} : b
    ))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: selectedOrder.id,
      actie: 'gewijzigd',
      omschrijving: `Klanttype gewijzigd naar ${kt === 'zakelijk' ? 'zakelijk' : 'privé'}`,
    })
  }

  // --- Picking opslaan ---
  const savePicks = () => {
    if (!selectedOrder) return
    setPickFout('')
    // Al uitgeleverd (de modal stond nog open, of een tweede tabblad pickte
    // al): opnieuw picken zou een tweede uitlevering maken terwijl de eerste
    // blijft staan — de voorraad dubbel afgeboekt. Eerst terugdraaien. De
    // melding staat in de modal; opslaan kan niet, alleen sluiten.
    if (orderUitgeleverd(bestellingPicks, selectedOrder.id)) {
      setPickFout(t('err_picks_al_uitgeleverd'))
      return
    }
    // Verkopen gaat uit vrije voorraad — voor privé én zakelijk. Wat nog in de
    // AGP ligt moet eerst uitgeslagen worden (knop in de pickmodal); alleen
    // export/intra-EU mag onder schorsing rechtstreeks uit de AGP.
    const zonderAgp = !verkoopUitAgpToegestaan(uitleveringForm.type_uitlevering)
    const agpLoc = getAgpLocatie(locaties as any)
    if (zonderAgp) {
      for (const picks of Object.values(draftPicks)) {
        for (const p of picks as any[]) {
          if (!p.aantal || p.aantal <= 0) continue
          if (p.bron_locatie_id != null && p.bron_locatie_id === agpLoc.id) {
            setPickFout(t('err_verkoop_geen_agp'))
            return
          }
        }
      }
    }
    // Valideer voorraad per afvulling voordat picks opgeslagen worden
    const pickTotals: Record<number, number> = {}
    for (const picks of Object.values(draftPicks)) {
      for (const p of picks as any[]) {
        if (!p.aantal || p.aantal <= 0) continue
        pickTotals[p.afvulling_id] = (pickTotals[p.afvulling_id]||0) + Number(p.aantal)
      }
    }
    for (const [afvIdStr, totaal] of Object.entries(pickTotals)) {
      const afvItem = (av||[]).find((a: any) => a.id === Number(afvIdStr))
      if (!afvItem) continue
      const beschik = zonderAgp
        ? beschikbaarBuitenAgpVoorAfvulling(afvItem, selectedOrder.id)
        : beschikbaarVoorAfvulling(afvItem, selectedOrder.id)
      if (totaal > beschik) {
        const errKey = zonderAgp ? 'err_verkoop_vrij_ontoereikend' : 'agp_voorraad_ontoereikend'
        setPickFout(t(errKey).replace('{beschikbaar}', `${beschik}× ${afvItem.verpakking_type||''}`))
        return
      }
    }
    // Valideer per-locatie wanneer een bron_locatie_id is gekozen
    const perLocTotals: Record<string, number> = {}
    for (const picks of Object.values(draftPicks)) {
      for (const p of picks as any[]) {
        if (!p.aantal || p.aantal <= 0) continue
        if (p.bron_locatie_id == null) continue
        const key = `${p.afvulling_id}|${p.bron_locatie_id}`
        perLocTotals[key] = (perLocTotals[key]||0) + Number(p.aantal)
      }
    }
    for (const [key, totaal] of Object.entries(perLocTotals)) {
      const [afvIdStr, locIdStr] = key.split('|')
      const afvItem = (av||[]).find((a: any) => a.id === Number(afvIdStr))
      if (!afvItem) continue
      const perLoc = beschikbaarPerLocatieVoorAfvulling(afvItem, selectedOrder.id)
      const beschik = perLoc[Number(locIdStr)] || 0
      if (totaal > beschik) {
        const loc = (locaties||[]).find((l: any) => l.id === Number(locIdStr))
        setPickFout(t('err_locatie_voorraad_ontoereikend')
          .replace('{locatie}', loc?.naam || t('lbl_onbekend'))
          .replace('{beschikbaar}', String(beschik))
          .replace('{verpakking}', afvItem.verpakking_type||''))
        return
      }
    }
    const newPicks: any[] = []
    let pickId = newId(bestellingPicks||[])
    for (const [regelIdStr, picks] of Object.entries(draftPicks)) {
      const regelId = Number(regelIdStr)
      for (const p of picks as any[]) {
        if (!p.aantal || p.aantal <= 0) continue
        const avItem = (av||[]).find((a: any) => a.id === p.afvulling_id)
        const batch = avItem ? bat.find((b: any) => b.id === avItem.batch_id) : null
        newPicks.push({
          id: pickId++,
          bestelling_id: selectedOrder.id,
          regel_id: regelId,
          afvulling_id: p.afvulling_id,
          batch_id: batch?.id || 0,
          aantal: Number(p.aantal),
          bron_locatie_id: p.bron_locatie_id ?? undefined,
          uitlevering_id: null,
          accijns_id: null,
        })
      }
    }
    // Status bepalen: gepickt = alle regels volledig gepickt
    const allFull = (selectedOrder.regels||[]).filter(isPickRegel).every((r: any) => {
      const picked = newPicks.filter((p: any) => p.regel_id === r.id).reduce((s: number, p: any) => s + p.aantal, 0)
      return picked >= r.aantal
    })

    if (allFull) {
      // Bij volledige picking ontstaan direct de uitleveringen: het bier
      // verlaat de vrije voorraad. Accijns ontstaat hier niet — die is bij het
      // uitslaan uit de AGP al geboekt (export/intra-EU: onder schorsing).
      const {uitleveringen: nieuweUitleveringen, pickResult, tekort} =
        bouwVerkoopRecords(newPicks, uitleveringForm)
      if (tekort > 0) { setPickFout(t('err_verkoop_vrij_tekort')); return }

      const picksWithIds = newPicks.map((p: any) => {
        const res = pickResult[p.id]
        if (!res) return p
        return {
          ...p,
          uitlevering_id: res.uitlevering_ids[0] || null,
          accijns_id: res.accijns_ids[0] || null,
          uitlevering_ids: res.uitlevering_ids,
          accijns_ids: res.accijns_ids,
        }
      })

      setBestellingPicks((prev: any[]) => [
        ...(prev||[]).filter((p: any) => p.bestelling_id !== selectedOrder.id),
        ...picksWithIds,
      ])
      setUit((prev: any[]) => [...(prev||[]), ...nieuweUitleveringen])
      setBestellingen((prev: any[]) => prev.map((b: any) =>
        b.id === selectedOrder.id ? {...b, status: 'gepickt', pick_datum: tod()} : b
      ))
      // Eén log-regel per uitlevering (verkoop; het uitslaan had een eigen regel)
      setLog((prev: any[]) => {
        let logId = newId(prev||[])
        const nieuweLogEntries = nieuweUitleveringen.map((u: any) => ({
          id: logId++,
          datum: tod(),
          type: 'verkoop',
          batch_id: u.batch_id,
          batch_naam: u.batch_naam || '',
          afvulling_id: u.afvulling_id,
          verpakking_type: u.verpakking_type || u.verpakking_naam || '',
          hoeveelheid: u.aantal,
          eenheid: 'stuks',
          referentie: '',
          omschrijving: `Picking — ${selectedOrder.klant_naam}`,
        }))
        return [...(prev||[]), ...nieuweLogEntries]
      })
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Bestelling',
        entiteit_id: selectedOrder.id,
        actie: 'gewijzigd',
        omschrijving: `Picks bevestigd — ${selectedOrder.klant_naam} (${nieuweUitleveringen.length} uitleveringen)`,
      })
    } else {
      // Deels gepickt: alleen draft-picks bewaren, nog geen records.
      setBestellingPicks((prev: any[]) => [
        ...(prev||[]).filter((p: any) => p.bestelling_id !== selectedOrder.id),
        ...newPicks,
      ])
      setBestellingen((prev: any[]) => prev.map((b: any) =>
        b.id === selectedOrder.id ? {...b, status: 'nieuw'} : b
      ))
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Bestelling',
        entiteit_id: selectedOrder.id,
        actie: 'gewijzigd',
        omschrijving: `Picks opgeslagen — ${selectedOrder.klant_naam} (deels gepickt)`,
      })
    }
    setShowPickModal(false)
    setDraftPicks({})
  }

  // --- Terugschrijven naar WooCommerce (utils/wcTerugschrijven.ts) ---
  // Altijd ná de lokale statuswijziging en nooit erop wachten: de order in
  // BrewAdmin mag niet blijven hangen omdat de winkel traag of onbereikbaar
  // is. De uitkomst komt als `wc_sync` op de order (badge + knop "opnieuw").
  // Herhalen na een mislukte notitie kan de privé-notitie dubbel zetten; de
  // statuswijziging zelf (PUT) is idempotent.
  const wcTerugschrijfOpties = (order: any) => ({
    enabled: !!(wcCreds?.enabled && wcCreds?.storeUrl && wcCreds?.terugschrijven),
    // Is er van deze order al bier uitgeslagen? Dan boekt de winkel bij
    // `cancelled` voorraad terug die er niet meer is — zie de util.
    uitgeslagen: picksVoorOrder(order?.id).some((p: any) => pickUitgeslagen(p)),
  })
  // `opties` overschrijft de afgeleide stand — bij annuleren zijn de picks net
  // teruggedraaid, maar de state van deze render kent dat nog niet.
  const schrijfTerugNaarWc = async (order: any, doel: WcSyncDoel, opties?: {uitgeslagen?: boolean}) => {
    const plan = wcTerugschrijfPlan(order, doel, {...wcTerugschrijfOpties(order), ...opties}, t)
    if (!plan) return
    let uitkomst: {ok: true} | {ok: false, fout: string} = {ok: true}
    try {
      if (plan.put) await wcPut(`orders/${plan.orderId}`, plan.put)
      if (plan.note) await wcPost(`orders/${plan.orderId}/notes`, plan.note)
    } catch (e: any) {
      uitkomst = {ok: false, fout: wcFoutMelding(e, t)}
    }
    // Met de order erbij: `completed` op een onbetaalde order wordt gemarkeerd,
    // zodat de import hem niet als betaling terugleest (utils/wcImport).
    const velden = wcSyncVelden(plan, uitkomst, new Date().toISOString(), order)
    setBestellingen((prev: any[]) => prev.map((b: any) => b.id === order.id ? {...b, ...velden} : b))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling', entiteit_id: order.id, actie: 'gewijzigd',
      omschrijving: uitkomst.ok
        ? `WooCommerce bijgewerkt — ${plan.wcStatus ? `status ${plan.wcStatus}` : 'notitie'}${plan.note && plan.wcStatus ? ' + notitie' : ''}`
        : `WooCommerce niet bijgewerkt — ${(uitkomst as {ok: false, fout: string}).fout}`,
    })
  }

  // --- Markeer als verzonden (logistieke statusovergang — Douane v2.4 §10.2) ---
  // Opent eerst een klein venster voor de track & trace-link en de keuze om de
  // verzendbevestiging meteen te mailen: een klant die voor bezorgen koos,
  // krijgt die zo direct nadat het pakket de deur uit is. Een afhaalklant
  // hoeft geen verzendbevestiging (utils/levering → wilVerzendbevestiging).
  const [verzondenModal, setVerzondenModal] = useState<null | {tracking: string, mailen: boolean}>(null)
  const markVerzonden = () => {
    if (!selectedOrder) return
    const email = resolvedSelectedOrder?.klant_email || selectedOrder.klant_email || ''
    setVerzondenModal({
      tracking: selectedOrder.verzend_tracking || '',
      mailen: !!smtpCreds?.enabled && wilVerzendbevestiging(selectedOrder, email),
    })
  }
  const bevestigVerzonden = () => {
    if (!selectedOrder || !verzondenModal) return
    const tracking = verzondenModal.tracking.trim()
    const datum = tod()
    const bijgewerkt = {...selectedOrder, status: 'verzonden', verzend_datum: datum, verzend_tracking: tracking || null}
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, status: 'verzonden', verzend_datum: datum, verzend_tracking: tracking || null} : b
    ))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: selectedOrder.id,
      actie: 'gewijzigd',
      omschrijving: `${selectedOrder.klant_naam} — verzonden (logistiek, geen fiscaal effect)${tracking ? ` · track & trace ${tracking}` : ''}`,
    })
    setVerzondenModal(null)
    if (verzondenModal.mailen) mailOrderVerzending(bijgewerkt)
    void schrijfTerugNaarWc(bijgewerkt, 'verzonden')
  }

  // --- Order afronden (factuur + pakbon, status → afgerond) ---
  // Belastbaar feit is bij savePicks afgehandeld (Douane v2.4 §10.2).
  // Hier alleen de factuur- en pakbongeneratie + status verandering.
  // Heeft deze order regels die uit de biervoorraad gepickt moeten worden?
  // Een order met alleen merch/verzendkosten (WooCommerce-webshop) heeft die
  // niet en mag dus zonder picks afgerond worden — anders blijft zo'n order
  // eeuwig op 'nieuw' staan.
  const heeftPickRegels = (order: any): boolean =>
    (order?.regels || []).some(isPickRegel)

  // Dubbelklikgrendel (zie ook de kassa). Tussen de klik en het sluiten van
  // de modal zit een netwerkronde (het factuurnummer); een tweede klik in dat
  // venster maakte een tweede factuur en een tweede journaalboeking. De ref is
  // de echte grendel, de state zet de knop uit. Na een geslaagde afronding
  // blijft hij dicht tot de modal opnieuw opent.
  const afrondBezigRef = useRef(false)
  const [afrondBezig, setAfrondBezig] = useState(false)
  const openAfronden = () => {
    afrondBezigRef.current = false
    setAfrondBezig(false)
    setAfrondFout('')
    setMerchTekortMelding('')
    merchTekortAkkoordRef.current = false
    setShowAfrondModal(true)
  }
  const rondeAf = async () => {
    if (afrondBezigRef.current) return
    afrondBezigRef.current = true
    setAfrondBezig(true)
    let gelukt = false
    try {
      gelukt = (await voerAfrondingUit()) === true
    } finally {
      if (!gelukt) {
        afrondBezigRef.current = false
        setAfrondBezig(false)
      }
    }
  }

  const voerAfrondingUit = async (): Promise<boolean | undefined> => {
    if (!selectedOrder) return
    // Al afgerond (een klik uit een verouderde weergave, of een tweede
    // tabblad): niets meer te doen. Al gefactureerd — vooraf, zodra de order
    // betaald was (utils/orderFactuur.ts) — dan rondt hij af zónder tweede
    // factuur. Een order die als gefactureerd telt maar waarvan de factuur
    // niet te vinden is, rondt niet af: liever niets dan een tweede factuur.
    if (selectedOrder.status === 'afgerond') { setShowAfrondModal(false); return }
    const bestaandeFactuur = orderFactuurVan(selectedOrder, verkoopFacturen)
    if (!bestaandeFactuur && orderIsGefactureerd(selectedOrder, verkoopFacturen)) { setShowAfrondModal(false); return }
    const picks = picksVoorOrder(selectedOrder.id)
    setAfrondFout('')
    if (heeftPickRegels(selectedOrder) && !picks.length) { setAfrondFout(t('err_order_no_picks')); return }
    const vandaag = tod()
    const pakbonNummer = genPakbonNummer()
    const agpLoc = getAgpLocatie(locaties)

    // Uitleveringen bestaan normaliter al uit savePicks (bij volledige
    // picking). Alleen wanneer een pick (legacy/back-compat) nog geen
    // uitlevering_ids heeft, maken we ze hier alsnog aan — met dezelfde regel:
    // verkopen uit vrije voorraad, de AGP alleen bij export/intra-EU.
    const picksZonderRecords = picks.filter((p: any) => !((p.uitlevering_ids||[]).length > 0 || p.uitlevering_id))

    // Pre-flight op alléén picks die nog géén uitlevering hebben — picks die
    // bij het picken al uit de voorraad zijn gehaald (en daar al gevalideerd
    // werden) zouden anders dubbel afgetrokken worden: hun uitlevering staat al
    // in `uit`, waardoor de vrije voorraad onterecht als ontoereikend telt
    // en het sluiten van de order ten onrechte geblokkeerd wordt.
    if (!verkoopUitAgpToegestaan(uitleveringForm.type_uitlevering)) {
      for (const pick of picksZonderRecords) {
        const avItem = (av||[]).find((a: any) => a.id === pick.afvulling_id)
        if (!avItem) continue
        if (pick.bron_locatie_id != null && pick.bron_locatie_id === agpLoc.id) {
          setAfrondFout(t('err_verkoop_geen_agp')); return
        }
        if (pick.bron_locatie_id == null) {
          const voorraad = voorraadPerLocatie(avItem, locaties as any, uit as any, verplaatsingen as any, afboekingen as any)
          let buitenAgp = 0
          for (const l of (locaties||[])) {
            if (!l.is_agp) buitenAgp += Number(voorraad[l.id] || 0)
          }
          if (buitenAgp < Number(pick.aantal || 0)) {
            setAfrondFout(t('err_verkoop_vrij_ontoereikend').replace('{beschikbaar}', `${buitenAgp}× ${avItem.verpakking_type||''}`))
            return
          }
        }
      }
    }
    // Merch met eigen voorraad: waarschuwen zolang er nog niets vastligt.
    // Blokkeren doen we niet — de klant heeft het al meegekregen; de voorraad
    // mag negatief worden en wijst dan vanzelf op een gemiste inkoop of telling.
    const merchMutaties = merchMutatiesVoorOrder(selectedOrder, '')
    const tekorten = merchTekorten(merchArtikelen, merchMutaties)
    // Eerst de waarschuwing in de modal; een tweede klik ("Toch afronden")
    // gaat door. Dezelfde keuze als het oude confirm()-venster.
    if (tekorten.length && !merchTekortAkkoordRef.current) {
      const regels = tekorten.map(x => `${merchLabel(x.artikel)}: ${x.gevraagd}× ${t('merch_tekort_gevraagd')}, ${x.voorraad}× ${t('merch_tekort_voorraad')}`).join('\n')
      setMerchTekortMelding(`${t('merch_tekort_waarschuwing')}\n\n${regels}`)
      merchTekortAkkoordRef.current = true
      return
    }

    // Factuurnummer pas ná alle validaties server-side ophalen (atomair,
    // ERP-plan 0.2) zodat een afgebroken afronding geen nummer verbruikt.
    // Een vooraf gemaakte factuur houdt zijn nummer.
    let factuurNummer: string
    if (bestaandeFactuur) factuurNummer = bestaandeFactuur.factuurnummer || ''
    else {
      try { factuurNummer = await volgendFactuurNummer('factuur') }
      catch (e) { setAfrondFout(t('err_factuurnummer_ophalen')); return }
    }

    let nieuweUitleveringen: any[] = []
    let pickResult: Record<number, {uitlevering_ids: number[], accijns_ids: number[]}> = {}
    if (picksZonderRecords.length > 0) {
      const built = bouwVerkoopRecords(picksZonderRecords, uitleveringForm)
      nieuweUitleveringen = built.uitleveringen
      pickResult = built.pickResult
    }
    // Voor de factuur-/auditcontext: alle uitleveringen die bij deze order horen.
    const alleUitleveringenVoorOrder: any[] = [
      // Bestaande (in state) uitleveringen die aan deze picks gekoppeld zijn
      ...((uit||[]) as any[]).filter((u: any) =>
        picks.some((p: any) =>
          (p.uitlevering_ids||[]).includes(u.id) || p.uitlevering_id === u.id
        )
      ),
      // Plus eventuele nieuwe uit de fallback
      ...nieuweUitleveringen,
    ]

    // 3. VerkoopFactuur (utils/orderFactuur.ts): de orderregels met de
    // WooCommerce-bedragen, statiegeld bij een handmatige order, de klant
    // uit de live klantkaart. Betaald in WooCommerce = betaald hier; de
    // PSP-uitbetaling koppelt later gewoon aan deze factuur. Is hij al
    // vooraf gemaakt, dan blijft het bij die factuur.
    const verkoopFact: any = bestaandeFactuur ? null : bouwOrderFactuur(selectedOrder, {
      id: newId(verkoopFacturen||[]), nummer: factuurNummer, datum: vandaag, klanten, verpakkingen,
      statiegeldOmschrijving: statiegeldLabel,
    })
    const factuurId = verkoopFact ? verkoopFact.id : bestaandeFactuur.id

    // 4. State-updates. Records uit savePicks zijn al in state;
    //    fallback-records (legacy picks zonder ids) worden nu toegevoegd.
    if (Object.keys(pickResult).length > 0) {
      setBestellingPicks((prev: any[]) => (prev||[]).map((p: any) => {
        if (p.bestelling_id !== selectedOrder.id) return p
        const res = pickResult[p.id]
        if (!res) return p
        return {
          ...p,
          uitlevering_id: res.uitlevering_ids[0] || null,
          accijns_id: res.accijns_ids[0] || null,
          uitlevering_ids: res.uitlevering_ids,
          accijns_ids: res.accijns_ids,
        }
      }))
    }
    if (nieuweUitleveringen.length > 0) {
      setUit((prev: any[]) => [...(prev||[]), ...nieuweUitleveringen])
    }
    if (verkoopFact) {
      setVerkoopFacturen((prev: any[]) => [...(prev||[]), verkoopFact])
      // Journaal (ERP-plan 2.1): orderfactuur is bij uitreiken definitief → boeken.
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(verkoopFact)))
    }
    // Merch-voorraad afboeken, met het factuurnummer als referentie. Ook bij
    // een vooraf gemaakte factuur pas nu: de klant neemt de merch nu mee.
    if (merchMutaties.length) {
      const geboekt = boekMerchMutaties(merchArtikelen, merchVoorraadLog,
        merchMutaties.map(m => ({...m, referentie: factuurNummer})))
      setMerchArtikelen(geboekt.artikelen)
      setMerchVoorraadLog(geboekt.log)
    }
    setBestellingen((prev: any[]) => prev.map((b: any) => b.id === selectedOrder.id ? {
      ...b,
      status: 'afgerond',
      verzend_datum: b.verzend_datum || vandaag,
      factuur_id: factuurId,
      factuur_nummer: factuurNummer,
      pakbon_nummer: pakbonNummer,
    } : b))
    // Winkel op voltooid — een no-op als dat bij "verzonden" al gebeurd is;
    // een afhaalorder wordt nooit verzonden en gaat hier pas op voltooid.
    void schrijfTerugNaarWc({...selectedOrder, status: 'afgerond'}, 'afgerond')
    // Log: eventuele fallback-uitleveringen worden alsnog als verkoop gelogd
    // (de picks zelf loggen al bij savePicks).
    setLog((prev: any[]) => {
      const updated = prev || []
      let logId = newId(updated)
      const fallbackLog = nieuweUitleveringen.map((u: any) => ({
        id: logId++,
        datum: vandaag,
        type: 'verkoop',
        batch_id: u.batch_id,
        batch_naam: u.batch_naam || '',
        afvulling_id: u.afvulling_id,
        verpakking_type: u.verpakking_type || u.verpakking_naam || '',
        hoeveelheid: u.aantal,
        eenheid: 'stuks',
        referentie: factuurNummer,
        omschrijving: `Order ${selectedOrder.klant_naam} — ${factuurNummer}`,
      }))
      return [...updated, ...fallbackLog]
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: selectedOrder.id,
      actie: 'gewijzigd',
      omschrijving: `${selectedOrder.klant_naam} — afgerond, factuur ${factuurNummer}${bestaandeFactuur ? ' (al vooraf gemaakt)' : ''} (${alleUitleveringenVoorOrder.length} uitleveringen)`,
    })
    setShowAfrondModal(false)
    return true
  }

  // Statiegeldregel op de factuur van een handmatige order (utils/statiegeld.ts).
  const statiegeldLabel = (soort: string, vp: any): string =>
    `${t(soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')} – ${vp.naam}`

  // --- Factuur vooraf (utils/orderFactuur.ts) ---
  // Een betaalde webshoporder kan zijn factuur krijgen vóór hij opgehaald of
  // verzonden is. Komt een afhaalklant niet, dan blijft de order open, maar
  // de betaling zit al in een uitbetaling van Mollie — en die is pas uit te
  // splitsen als de factuur er is. De order blijft open; afronden maakt
  // daarna geen tweede factuur. Zelfde dubbelklikgrendel als bij afronden.
  const [showVoorafModal, setShowVoorafModal] = useState(false)
  const voorafBezigRef = useRef(false)
  const [voorafBezig, setVoorafBezig] = useState(false)
  // Waarom de factuur niet gemaakt werd (het factuurnummer), in de modal zelf.
  const [voorafFout, setVoorafFout] = useState('')
  const openVooraf = () => {
    voorafBezigRef.current = false
    setVoorafBezig(false)
    setVoorafFout('')
    setShowVoorafModal(true)
  }
  const maakFactuurVooraf = async () => {
    if (!selectedOrder || voorafBezigRef.current) return
    voorafBezigRef.current = true
    setVoorafBezig(true)
    let gelukt = false
    try {
      const blokkade = voorafFactuurBlokkade(selectedOrder, verkoopFacturen)
      // Kan het niet (meer) — een ander tabblad maakte hem al, de webshop
      // annuleerde: de modal dicht, de reden op de pagina.
      if (blokkade) { setShowVoorafModal(false); setMelding(t(voorafBlokkadeSleutel(blokkade))); return }
      setVoorafFout('')
      let nummer: string
      try { nummer = await volgendFactuurNummer('factuur') }
      catch (e) { setVoorafFout(t('err_factuurnummer_ophalen')); return }
      const factuur = bouwOrderFactuur(selectedOrder, {
        id: newId(verkoopFacturen || []), nummer, datum: tod(), klanten, verpakkingen,
        statiegeldOmschrijving: statiegeldLabel,
      })
      // Factuur, journaal en de verwijzing op de order in dezelfde tick: de
      // client bundelt ze tot één commit.
      setVerkoopFacturen((prev: any[]) => [...(prev || []), factuur])
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(factuur)))
      setBestellingen((prev: any[]) => prev.map((b: any) => b.id === selectedOrder.id
        ? {...b, factuur_id: factuur.id, factuur_nummer: nummer} : b))
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Bestelling', entiteit_id: selectedOrder.id, actie: 'gewijzigd',
        omschrijving: `${selectedOrder.klant_naam} — factuur ${nummer} gemaakt vóór afronden (${factuur.status === 'betaald' ? `betaald ${factuur.betaald_datum}` : 'open'})`,
      })
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Verkoopfactuur', entiteit_id: factuur.id, actie: 'aangemaakt',
        omschrijving: `${nummer} ${factuur.klant_naam} ${fmt(factuur.bruto)} — bestelling ${orderNummer(selectedOrder)}, vóór afronden`,
      })
      setShowVoorafModal(false)
      gelukt = true
    } finally {
      if (!gelukt) {
        voorafBezigRef.current = false
        setVoorafBezig(false)
      }
    }
  }

  // --- Picks terugdraaien (utils/uitlevering.ts) ---
  // Een volledig gepickte order heeft zijn uitleveringen al: het bier telt als
  // verkocht. Zolang het de deur niet uit is (niet 'verzonden'), draaien
  // annuleren en "picks terugdraaien" dat terug: de uitleveringen vervallen,
  // de picks blijven als concept staan en het log krijgt een tegenregel.
  // `null` = er valt niets terug te draaien.
  const pickTerugdraaiing = (order: any): PickTerugdraaiing | null => {
    if (!order || order.status === 'verzonden' || order.status === 'afgerond' || order.status === 'geannuleerd') return null
    if (!orderUitgeleverd(bestellingPicks, order.id)) return null
    // Een levering onder schorsing uit de AGP (export/intra-EU) staat in het
    // AGP-voorraadverloop van de accijnsaangifte; is die maand al ingediend,
    // dan blijft hij staan. Levering uit vrije voorraad raakt de AGP niet.
    const agpId = getAgpLocatie(locaties as any).id
    return bouwPickTerugdraaiing(order.id, bestellingPicks, uit, {
      datum: tod(),
      omschrijving: `${t('log_pick_teruggedraaid')} — ${order.klant_naam || ''}`,
      referentie: orderNummer(order),
      vergrendeld: (u: any) => (u.bron_locatie_id ?? agpId) === agpId
        && !!u.datum && accijnsMaandGesloten(u.datum, accijnsAangiftes || []),
    })
  }
  const blokkadeTekst = (r: PickTerugdraaiing | null): string =>
    r?.blokkade ? t(r.blokkade === 'accijns' ? 'err_terugdraaien_accijns' : 'err_terugdraaien_periode') : ''
  // Alle drie de schrijfacties in dezelfde tick: de client bundelt ze tot één
  // commit, dus uitlevering, pick en log lopen nooit uit de pas.
  const voerTerugdraaiingUit = (orderId: number, r: PickTerugdraaiing) => {
    const ids = new Set(r.uitleveringIds)
    if (ids.size) setUit((prev: any[]) => (prev || []).filter((u: any) => !ids.has(u.id)))
    setBestellingPicks((prev: any[]) => (prev || []).map((p: any) =>
      p.bestelling_id === orderId ? pickZonderUitlevering(p) : p))
    if (r.tegenregels.length) {
      setLog((prev: any[]) => {
        let logId = newId(prev || [])
        return [...(prev || []), ...r.tegenregels.map((l: any) => ({id: logId++, ...l}))]
      })
    }
  }

  // Terug naar een concept: de pick klopte niet (verkeerde batch of aantal).
  // De order gaat terug naar 'nieuw' en kan opnieuw gepickt worden.
  const draaiPicksTerug = () => {
    if (!selectedOrder) return
    const r = pickTerugdraaiing(selectedOrder)
    if (!r) return
    if (r.blokkade) { setMelding(blokkadeTekst(r)); return }
    voerTerugdraaiingUit(selectedOrder.id, r)
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, status: 'nieuw'} : b
    ))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling', entiteit_id: selectedOrder.id, actie: 'gewijzigd',
      omschrijving: `Picks teruggedraaid — ${selectedOrder.klant_naam} (${r.uitleveringIds.length} uitleveringen, ${r.stuks} st. terug in voorraad)`,
    })
  }

  // Al gefactureerd (vooraf, zodra de order betaald was) en nog niet
  // gecrediteerd? Dan hoort bij annuleren een creditnota: een definitieve
  // factuur verdwijnt nooit, hij wordt tenietgedaan (utils/orderFactuur.ts).
  const teCrediterenFactuur = (order: any): any | null => {
    const f = orderFactuurVan(order, verkoopFacturen)
    return f && f.status !== 'credit' && !factuurIsGecrediteerd(f, verkoopFacturen) ? f : null
  }
  const annuleerBezigRef = useRef(false)
  const [annuleerBezig, setAnnuleerBezig] = useState(false)
  // Waarom annuleren niet doorging (het creditnotanummer), in de modal zelf.
  const [annuleerFout, setAnnuleerFout] = useState('')
  const annuleerOrder = async () => {
    if (!selectedOrder || annuleerBezigRef.current) return
    annuleerBezigRef.current = true
    setAnnuleerBezig(true)
    setAnnuleerFout('')
    try {
      // Het creditnotanummer eerst (server-reeks): lukt dat niet, dan wordt
      // er ook niet geannuleerd — anders stond er een factuur zonder order.
      const factuur = teCrediterenFactuur(selectedOrder)
      let creditnota: any = null
      if (factuur) {
        let nummer: string
        try { nummer = await volgendFactuurNummer('creditnota') }
        catch (e) { setAnnuleerFout(t('err_factuurnummer_ophalen')); return }
        creditnota = bouwCreditnota(factuur, {id: newId(verkoopFacturen || []), nummer, datum: tod()})
      }
      // Gepickt maar nog niet verzonden: het bier ligt er nog, dus terug naar de
      // voorraad. Verzonden bier is echt weg (alleen een notitie in de winkel).
      const terug = pickTerugdraaiing(selectedOrder)
      const teruggeboekt = !!terug && !terug.blokkade
      if (teruggeboekt) voerTerugdraaiingUit(selectedOrder.id, terug!)
      setBestellingen((prev: any[]) => prev.map((b: any) =>
        b.id === selectedOrder.id ? {...b, status: 'geannuleerd'} : b
      ))
      if (creditnota) {
        setVerkoopFacturen((prev: any[]) => [...(prev || []), creditnota])
        // Journaal (ERP-plan 2.1): de creditnota is direct definitief → boeken
        // (bedragen negatief, zie StatiegeldPage).
        setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(creditnota)))
        logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:creditnota.id, actie:'aangemaakt',
          omschrijving:`Creditnota ${creditnota.factuurnummer} voor ${factuur.factuurnummer} — bestelling ${orderNummer(selectedOrder)} geannuleerd`})
      }
      logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd',
        omschrijving:`Geannuleerd — ${selectedOrder.klant_naam}${teruggeboekt ? ` (${terug!.uitleveringIds.length} uitleveringen teruggedraaid, ${terug!.stuks} st. terug in voorraad)` : ''}${creditnota ? `, creditnota ${creditnota.factuurnummer} voor factuur ${factuur.factuurnummer}` : ''}`})
      // Teruggedraaid = niets meer uitgeslagen, dus de winkel mag naar
      // `cancelled` en zijn voorraad terugboeken — net als BrewAdmin nu doet.
      void schrijfTerugNaarWc({...selectedOrder, status: 'geannuleerd'}, 'geannuleerd',
        teruggeboekt ? {uitgeslagen: false} : undefined)
      setShowAnnuleerModal(false)
      openOrder(null)
    } finally {
      annuleerBezigRef.current = false
      setAnnuleerBezig(false)
    }
  }

  const addVrijeRegel = () => {
    if (!selectedOrder) return
    const omschr = vrijeRegelForm.omschrijving.trim()
    if (!omschr) { setVrijeRegelFout(t('err_vrije_regel_omschrijving')); return }
    setVrijeRegelFout('')
    const n = Number(vrijeRegelForm.aantal) || 1
    const p = Number(vrijeRegelForm.prijs_per_stuk) || 0
    const newRegel = {
      id: newId(selectedOrder.regels||[]),
      bier_naam: omschr,
      verpakking_type: '',
      aantal: n,
      prijs_per_stuk: p,
      btw_pct: Number(vrijeRegelForm.btw_pct) || 0,
      omschrijving: omschr,
      type: 'vrij' as const,
    }
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, regels: [...(b.regels||[]), newRegel]} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Vrije regel toegevoegd: ${omschr}`})
    setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'})
    setShowVrijeRegelModal(false)
  }

  const addVerzendkosten = () => {
    if (!selectedOrder) return
    const naam = breweryDetails?.verzendkosten_naam || t('lbl_verzendkosten')
    const btw = Number(breweryDetails?.verzendkosten_btw ?? 21)
    setVerzendkostenForm({naam, prijs_per_stuk: '', btw_pct: String(btw)})
    setShowVerzendkostenModal(true)
  }

  const confirmVerzendkosten = () => {
    if (!selectedOrder) return
    const naam = verzendkostenForm.naam || t('lbl_verzendkosten')
    const newRegel = {
      id: newId(selectedOrder.regels||[]),
      bier_naam: naam,
      verpakking_type: '',
      aantal: 1,
      prijs_per_stuk: Number(verzendkostenForm.prijs_per_stuk) || 0,
      btw_pct: Number(verzendkostenForm.btw_pct) || 0,
      omschrijving: naam,
      type: 'verzending' as const,
    }
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, regels: [...(b.regels||[]), newRegel]} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Verzendkosten toegevoegd: ${naam}`})
    setShowVerzendkostenModal(false)
  }

  const removeRegel = (orderId: number, regel: any) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:orderId, actie:'gewijzigd', omschrijving:`Regel verwijderd: ${regel?.bier_naam||regel?.id}`})
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === orderId ? {...b, regels: (b.regels||[]).filter((r: any) => r.id !== regel?.id)} : b
    ))
  }
  // Een vrije regel (verzendkosten, korting, merch) verwijderen: meteen uit
  // beeld, vijf seconden terugweg, daarna echt weg (CLAUDE.md: geen confirm()).
  const verwijderRegel = (regel: any) => {
    if (!selectedOrder || !regel) return
    const orderId = selectedOrder.id
    undo.plan(`${REGEL_UNDO}${orderId}-${regel.id}`,
      t('orders_regel_verwijderd').replace('{naam}', String(regel.omschrijving || regel.bier_naam || t('lbl_naamloos'))),
      () => removeRegel(orderId, regel))
  }

  // Herbereken alle afgeleide BTW-velden van een verkoopfactuur uit zijn regels
  // (netto/btw_bedrag/bruto per regel + btw_overzicht + totalen). Zelfde rekenwijze
  // als bij het opstellen in `rondeAf`.
  const herberekenFactuur = (fact: any) => {
    const regels = (fact.regels||[]).map((r: any) => {
      // Autoritatieve WooCommerce-bedragen blijven leidend (geen kasverschil);
      // regels zonder die bedragen worden uit hoeveelheid × prijs herberekend.
      const b = regelBedrag(r)
      return {...r, netto: b.netto, btw_bedrag: b.btw, bruto: b.bruto}
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const tot = totaliseerRegels(regels)
    return {...fact, regels, btw_overzicht: btwOverzicht(regels), netto: tot.netto, btw: tot.btw, bruto: tot.bruto,
      netto_cent: tot.netto_cent, btw_cent: tot.btw_cent, bruto_cent: tot.bruto_cent}
  }

  // BTW% van een bestaande orderregel aanpassen (bijv. WC-import die bier op 9%
  // zette corrigeren naar 21%). Bij een afgeronde order (na expliciete
  // "BTW corrigeren") wordt ook de al opgestelde verkoopfactuur meegecorrigeerd,
  // want de BTW-aangifte leest uit de factuur, niet uit de order.
  const updateRegelBtw = (regelId: number, nieuwBtw: number) => {
    if (!selectedOrder) return
    // De factuur van deze order: na afronden, of al vooraf (utils/orderFactuur.ts).
    const gekoppeld = orderFactuurVan(selectedOrder, verkoopFacturen)
    // Periode-lock (ERP-plan 0.4): zodra de gekoppelde factuur meetelt in een
    // ingediende/betaalde BTW-periode is corrigeren geblokkeerd — dat zou de
    // aangiftecijfers achteraf veranderen. Correctie dan via creditnota.
    if (gekoppeld) {
      const periodeType = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
      const {ingediend, betaald} = geslotenPeriodeSets(btwAangiftes||[], bankKoppelingen||{})
      if (!magFactuurMuteren(gekoppeld, periodeType, ingediend, betaald)) {
        setMelding(t('err_periode_gesloten_mutatie')); return
      }
    }
    const orderRegels = selectedOrder.regels||[]
    const regelIdx = orderRegels.findIndex((r: any) => r.id === regelId)
    const regel = orderRegels[regelIdx]
    // Bij een expliciete tariefwijziging blijft het netto van déze regel staan
    // (bij een webshopregel wat WooCommerce ex-BTW rekende, ná korting) en
    // wordt alleen de BTW opnieuw uit netto × btw% berekend (utils/orderRegel).
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id
        ? {...b, regels: (b.regels||[]).map((r: any) => r.id === regelId ? corrigeerRegelBtw(r, nieuwBtw) : r)}
        : b
    ))
    // Gekoppelde verkoopfactuur meecorrigeren. De factuurregels zijn 1-op-1 in
    // dezelfde volgorde uit de orderregels opgebouwd (statiegeldregels komen
    // erná), dus factuurregel op positie `regelIdx` hoort bij deze orderregel.
    if (gekoppeld && regelIdx >= 0) {
      const fact = gekoppeld
      const regels = (fact.regels||[]).map((fr: any, i: number) => i === regelIdx ? corrigeerRegelBtw(fr, nieuwBtw) : fr)
      const nieuweFactuur = herberekenFactuur({...fact, regels})
      setVerkoopFacturen((prev: any[]) => (prev||[]).map((f: any) => f.id === fact.id ? nieuweFactuur : f))
      // Journaal (ERP-plan 2.1): correctie op een al geboekte factuur =
      // storno van de oude regels + herboeking van de gecorrigeerde factuur.
      setJournaal((prev: any[]) => voegBoekingToe(
        voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'verkoop_factuur', fact.id)),
        verkoopFactuurBoeking(nieuweFactuur)))
    }
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`BTW gewijzigd: ${regel?.bier_naam||regelId} → ${nieuwBtw}%${gekoppeld ? ` (factuur ${gekoppeld.factuurnummer||gekoppeld.id} bijgewerkt)` : ''}`})
  }

  // Regelsoort wisselen tussen 'bier' (uit de biervoorraad picken) en 'vrij'
  // (merch of dienst — alleen op de factuur). De WooCommerce-import
  // raadt dit op basis van de artikel-/productadministratie; hiermee corrigeert
  // de gebruiker een verkeerde gok. Al gepickte regels blijven op slot.
  //
  // Met `onthouden` wordt de keuze ook op artikelniveau vastgelegd
  // (`merch_artikelen`): dezelfde merch komt bij de volgende import meteen
  // als vrije regel binnen, zodat de order niet opnieuw op een onmogelijke
  // pick blijft hangen. Dat gebeurt alleen via de expliciete merch-knop —
  // de kleine ⇄ blijft een eenmalige correctie op déze order en mag een
  // gewoon bier niet stilletjes uit de picking halen.
  const updateRegelType = (regelId: number, onthouden = false) => {
    if (!selectedOrder) return
    const regel = (selectedOrder.regels||[]).find((r: any) => r.id === regelId)
    if (!regel) return
    const huidig = regelSoort(regel)
    if (huidig !== 'bier' && huidig !== 'vrij') return
    if (gepicktVoorRegel(selectedOrder.id, regelId) > 0) { setMelding(t('err_regel_type_gepickt')); return }
    const nieuwType = huidig === 'bier' ? 'vrij' : 'bier'
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id
        ? {...b, regels: (b.regels||[]).map((r: any) => {
            if (r.id !== regelId) return r
            const {wc_onbekend, merch, ...rest} = r
            return {...rest, type: nieuwType, ...(nieuwType === 'vrij' && (onthouden || merch) ? {merch: true} : {})}
          })}
        : b
    ))
    // Terugzetten naar 'bier' haalt het artikel altijd weer uit de lijst: de
    // gebruiker zegt daarmee dat het wél uit eigen voorraad komt.
    const sleutel = {sku: regel.sku || '', naam: regel.omschrijving || regel.bier_naam || ''}
    if (onthouden && nieuwType === 'vrij') {
      setMerchArtikelen((prev: MerchArtikel[]) => onthoudMerch(prev || [], {...sleutel, datum: tod()}))
    } else if (nieuwType === 'bier') {
      setMerchArtikelen((prev: MerchArtikel[]) => vergeetMerch(prev || [], sleutel))
    }
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Regelsoort gewijzigd: ${regel.bier_naam||regelId} → ${nieuwType}${onthouden && nieuwType === 'vrij' ? ' (merch onthouden)' : ''}`})
  }

  // ── Merch-voorraad ────────────────────────────────────────────────────────
  // Merch die je zélf op voorraad hebt: een aantal met een mutatielog. Geen
  // afvullingen, geen accijns, geen AGP — zie utils/merch.ts.

  const wijzigMerch = (id: number, patch: Partial<MerchArtikel>) => {
    setMerchArtikelen((prev: MerchArtikel[]) => (prev || []).map((m: MerchArtikel) =>
      m.id === id ? {...m, ...patch} : m))
  }

  // Merch uit de lijst halen: meteen uit beeld, vijf seconden terugweg
  // (UndoBar) in plaats van een confirm(); daarna is het artikel (met zijn
  // voorraad) weg.
  const verwijderMerchArtikel = (m: MerchArtikel) => {
    undo.plan(`${MERCH_UNDO}${m.id}`, t('merch_verwijderd_undo').replace('{artikel}', merchLabel(m)),
      () => setMerchArtikelen((prev: MerchArtikel[]) => verwijderMerch(prev || [], m.id)))
  }

  const openMerchMutatie = (m: MerchArtikel) => {
    setMerchMutatieForm({...emptyMerchMutatie, merch_id: m.id, prijs: m.inkoopprijs != null ? String(m.inkoopprijs) : ''})
    setMerchMutatieFout('')
    setShowMerchMutatie(true)
  }

  const bewaarMerchMutatie = () => {
    const artikel = (merchArtikelen || []).find((m: MerchArtikel) => m.id === merchMutatieForm.merch_id)
    if (!artikel) return
    const ruw = Number(String(merchMutatieForm.aantal).replace(',', '.'))
    if (!Number.isFinite(ruw)) { setMerchMutatieFout(t('err_merch_aantal')); return }
    setMerchMutatieFout('')
    const reden = merchMutatieForm.reden
    // Bij inkoop/retour telt het aantal op, bij een afboeking eraf; een telling
    // en een correctie neemt de gebruiker zoals ingevuld (telling = de stand).
    const aantal = reden === 'verkoop' ? -Math.abs(ruw) : ruw
    const prijs = String(merchMutatieForm.prijs).trim().replace(',', '.')
    const {artikelen, log} = boekMerchMutaties(merchArtikelen, merchVoorraadLog, [{
      merch_id: artikel.id,
      aantal,
      reden,
      datum: tod(),
      ...(merchMutatieForm.notitie.trim() ? {omschrijving: merchMutatieForm.notitie.trim()} : {}),
      ...(reden === 'inkoop' && prijs !== '' ? {prijs_per_stuk: Number(prijs) || 0} : {}),
    }])
    setMerchArtikelen(artikelen)
    setMerchVoorraadLog(log)
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Merch', entiteit_id: artikel.id, actie: 'gewijzigd',
      omschrijving: `${merchLabel(artikel)} — ${reden} ${aantal > 0 ? '+' : ''}${aantal}`,
    })
    setShowMerchMutatie(false)
    setMerchMutatieForm(emptyMerchMutatie)
  }

  // Merch-regels van een order afboeken (bij het afronden). Geeft de mutaties
  // terug zodat de aanroeper vooraf op een tekort kan waarschuwen.
  const merchMutatiesVoorOrder = (order: any, referentie: string) =>
    merchAfboekingenVoorRegels(order?.regels, merchArtikelen, {datum: tod(), referentie})

  // Beschikbare BTW-tarieven voor de dropdown (uit instellingen, met fallback).
  const btwOpts = ((btwTarieven && btwTarieven.length ? btwTarieven : [0, 9, 21]))
    .map((p: any) => ({v: String(p), l: `${p}%`}))

  // Herkomst van een afvulling in de pickmodal: de lotcode zoals hij op de
  // verpakking staat (eigen code, anders die van de afvulsessie) en apart het
  // batchnummer ("#2607", zoals overal). Tot nu toe stond het batchnummer
  // onder "Lot"; een afvulling zonder lotcode krijgt nu géén "Lot".
  const lotEnBatch = (afv: any): {lot: string, batch: string} => {
    const b = afv ? (bat || []).find((x: any) => x.id === afv.batch_id) : null
    const nr = batchNummer(b)
    return {lot: lotcodeVanAfvulling(afv, afvulSessies), batch: nr ? `#${nr}` : ''}
  }

  const openPickModal = () => {
    if (!selectedOrder) return
    // Initialiseer draft picks vanuit bestaande picks (concepten; een order
    // met uitgeleverde picks komt hier niet — die moet eerst terug). De
    // gekozen bronlocatie gaat mee, anders viel een deels opgeslagen concept
    // stil terug op "automatisch".
    const bestaand: Record<number, Array<{afvulling_id: number, aantal: number, bron_locatie_id?: number | null}>> = {}
    picksVoorOrder(selectedOrder.id).forEach((p: any) => {
      if (!bestaand[p.regel_id]) bestaand[p.regel_id] = []
      bestaand[p.regel_id].push({afvulling_id: p.afvulling_id, aantal: p.aantal, bron_locatie_id: p.bron_locatie_id ?? undefined})
    })
    setDraftPicks(bestaand)
    setPickFout('')
    setShowPickModal(true)
  }

  // Pakbon-datum = datum van picken. Voorkeur: `pick_datum` op de order
  // (gezet bij `savePicks`). Voor oudere orders zonder dat veld leiden we
  // de datum af uit de gekoppelde uitleveringen — die zijn gestempeld op
  // het moment van pickbevestiging. Pas als alles ontbreekt vallen we
  // terug op verzend- of orderdatum (= legacy gedrag).
  const pakbonDatumVoor = (order: any): string => {
    if (!order) return ''
    if (order.pick_datum) return order.pick_datum
    const orderPicks = picksVoorOrder(order.id)
    const uitIds = new Set<number>()
    for (const p of orderPicks) {
      if (p.uitlevering_id) uitIds.add(p.uitlevering_id)
      for (const id of (p.uitlevering_ids || [])) uitIds.add(id)
    }
    const datums = (uit || [])
      .filter((u: any) => uitIds.has(u.id) && u.datum)
      .map((u: any) => u.datum as string)
      .sort()
    if (datums.length) return datums[0]
    return order.verzend_datum || order.datum || ''
  }

  const printOrderPakbon = () => {
    if (!selectedOrder) return
    const orderVoorPakbon = {...resolvedSelectedOrder!, pakbon_datum: pakbonDatumVoor(selectedOrder)}
    printPakbon(orderVoorPakbon, picksVoorOrder(selectedOrder.id), av, bat, breweryDetails||{}, appName, factuurLogo||logo,
      {sessies: afvulSessies, onGeblokkeerd: setMelding})
  }

  const printOrderFactuur = () => {
    if (!selectedOrder) return
    const factuur = orderFactuurVan(selectedOrder, verkoopFacturen)
    if (!factuur) { setMelding(t('err_no_invoice_for_order')); return }
    // Termijn van de klantkaart (anders de brouwerij): dezelfde vervaldatum
    // als vanuit Administratie → Facturen en als waarmee de te-laat-badge rekent.
    printFactuur(resolvedSelectedOrder!, factuur, breweryMetTermijn(factuur, klanten, breweryDetails), appName, factuurLogo||logo,
      {onGeblokkeerd: setMelding})
  }

  // ── Mail-modal state ────────────────────────────────────────────────────
  const [mailModal, setMailModal] = React.useState<null | {
    title: string
    to: string
    subject: string
    text: string
    attachments?: {filename: string, contentBase64: string, mimeType: string}[]
    /** Type mail — bepaalt het log-bericht en (bij 'bevestiging') een status-
     * overgang van 'nieuw' naar 'bevestigd' na succesvolle verzending; bij
     * 'verzending' wordt de datum van de verzendbevestiging op de order gezet,
     * bij 'afhaal_gemist' die van de afspraak-gemist-mail. */
    kind?: 'pakbon' | 'factuur' | 'bevestiging' | 'verzending' | 'afhaal_gemist'
    mollie?: {amountCent: number, description: string, redirectUrl: string, factuurnummer?: string,
      bestaandeLink?: {url: string} | null, onLinkAangemaakt?: (l: {id: string, url: string}) => void} | null
    regenerateAttachments?: (payUrl: string) => Promise<{filename: string, contentBase64: string, mimeType: string}[] | null>
    /** Knoppen onder de mail: afhaalmoment kiezen/verzetten en "Bekijk je
     * bestelling" (utils/levering → afhaalMailKnop, bestelLink). */
    linkButtons?: MailKnop[] | null
  }>(null)
  const [mailGenerating, setMailGenerating] = React.useState(false)

  // Een andere bestelling of de lijst via de route (de terugknop van het
  // toestel, een link): een open venster of half ingevuld formulier van de
  // vorige bestelling gaat niet mee. Sinds de bestelling in de URL staat
  // blijft deze pagina gemount waar "terug" haar vroeger verliet — zonder dit
  // stond een open pickvenster (met de concept-picks per regel-id) of de
  // annuleervraag meteen open bij de volgende bestelling.
  const vorigeOrderRef = useRef(selectedId)
  React.useEffect(() => {
    if (vorigeOrderRef.current === selectedId) return
    vorigeOrderRef.current = selectedId
    setShowPickModal(false)
    setDraftPicks({})
    setShowAfrondModal(false)
    setShowAnnuleerModal(false)
    setShowVrijeRegelModal(false)
    setShowVerzendkostenModal(false)
    setVerzondenModal(null)
    setMailModal(null)
    setUitslagDoel(d => (d?.terug === 'pick' ? null : d))
    setBtwCorrectie(null)
    setMelding('')
    setTerugdraaiVraag(false)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Een leeggebleven variabele (geen track & trace, geen leveringstekst) mag
  // geen dubbele witregel achterlaten in de mail.
  const interpolate = (tpl: string, vars: Record<string, string>): string =>
    Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)
      .replace(/\n{3,}/g, '\n\n')

  // Pakt subject/body uit ingestelde mail_templates; valt terug op de i18n-default
  // wanneer de gebruiker niets heeft ingevuld (lege string of niet aanwezig).
  const tplOrDefault = (key: 'pakbon'|'factuur'|'factuur_betaald'|'bestelling'|'verzending'|'afhaal_gemist', field: 'subject'|'body'): string => {
    const stored = (mailTemplates as any)?.[key]?.[field]
    if (typeof stored === 'string' && stored.trim()) return stored
    return t(`mail_${key}_${field === 'subject' ? 'subject' : 'body'}_default`)
  }

  const mailOrderPakbon = async () => {
    if (!selectedOrder) return
    setMailGenerating(true)
    try {
      const orderVoorPakbon = {...resolvedSelectedOrder!, pakbon_datum: pakbonDatumVoor(selectedOrder)}
      const {html, filename} = buildPakbonHTML(orderVoorPakbon, picksVoorOrder(selectedOrder.id), av, bat, breweryDetails||{}, appName, factuurLogo||logo, {sessies: afvulSessies})
      const pdfBase64 = await htmlToPdfBase64(html)
      const pakbonNr = selectedOrder.pakbon_nummer || `P-${selectedOrder.id}`
      const vars = {
        naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
        nr: pakbonNr,
        brouwerij: (breweryDetails as any)?.naam || appName || '',
      }
      setMailModal({
        title: t('mail_modal_title_pakbon'),
        to: (resolvedSelectedOrder?.klant_email || ''),
        subject: interpolate(tplOrDefault('pakbon', 'subject'), vars),
        text: interpolate(tplOrDefault('pakbon', 'body'), vars),
        attachments: [{filename: `${filename}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        kind: 'pakbon',
      })
    } catch (e: any) {
      setMelding(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(false)
  }

  const mailOrderFactuur = async () => {
    if (!selectedOrder) return
    const factuur = orderFactuurVan(selectedOrder, verkoopFacturen)
    if (!factuur) { setMelding(t('err_no_invoice_for_order')); return }
    setMailGenerating(true)
    try {
      // Termijn van de klantkaart (anders de brouwerij) — PDF, {vervaldatum}
      // en te-laat-badge rekenen zo met dezelfde datum (utils/facturen.ts).
      const breweryMet = breweryMetTermijn(factuur, klanten, breweryDetails)
      const html = buildFactuurHTML(resolvedSelectedOrder!, factuur, breweryMet, appName, factuurLogo||logo)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const pdfBase64 = await htmlToPdfBase64(html)
      const bedrag = fmt(factuur.bruto || 0)
      const verval = vervaldatumTekst(factuur, klanten, breweryDetails)
      const inst = (breweryDetails as any) || {}
      // Een webshoporder is meestal al afgerekend (iDEAL, creditcard …) vóór
      // hij hier wordt afgerond; de factuur staat dan op betaald. Die klant
      // krijgt de "al voldaan"-mail (template `factuur_betaald`) met de
      // betaaldatum en -methode uit WooCommerce — niet een verzoek om
      // over te maken. Zelfde logica als op Administratie → Facturen
      // (utils/factuurMail.ts).
      const betaal = factuurMailBetaalVars(factuur)
      const vars = {
        naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
        nr: factuurNr,
        bedrag,
        vervaldatum: verval,
        iban: inst.iban || '',
        brouwerij: inst.naam || appName || '',
        betaaldatum: betaal.betaaldatum,
        betaalwijze: betaal.betaalwijze,
        betaalregel: betaal.betaalregel,
      }
      // Mollie-betaallink: zelfde regels als op Administratie → Facturen — alleen
      // voor openstaande (niet-betaalde, niet-credit) facturen met een positief
      // bedrag, en alleen als Mollie aanstaat. Redirect-URL uit de instelling,
      // met de brouwerij-website als fallback.
      const normUrl = (u: string) => {
        const s = (u || '').trim()
        return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s
      }
      const amountCent = Number.isFinite(factuur.bruto_cent)
        ? Math.round(factuur.bruto_cent)
        : Math.round((factuur.bruto || 0) * 100)
      const mollieCtx = ((mollieCreds as any)?.enabled && amountCent > 0
        && factuur.status !== 'credit' && factuur.status !== 'betaald')
        ? {
            amountCent,
            description: `${t('mollie_desc_factuur')} ${factuurNr}${inst.naam ? ' · ' + inst.naam : ''}`,
            redirectUrl: normUrl((mollieCreds as any)?.redirectUrl || inst.website || ''),
            factuurnummer: factuurNr,
            // Eén betaallink per factuur (utils/mollieLink.ts): een eerder
            // meegestuurde link gaat opnieuw mee, een nieuwe komt op de factuur.
            bestaandeLink: herbruikbareBetaallink(factuur, amountCent),
            onLinkAangemaakt: (l: {id: string, url: string}) =>
              setVerkoopFacturen((prev: any[]) => (prev || []).map((f: any) =>
                f.id === factuur.id ? {...f, mollie_link: betaallinkRecord(l, amountCent)} : f)),
          }
        : null
      // Bij een Mollie-betaallink de PDF opnieuw bouwen mét QR-code + link erin.
      const regenerateAttachments = mollieCtx ? async (payUrl: string) => {
        const qr = await qrDataUrl(payUrl)
        const html2 = buildFactuurHTML(resolvedSelectedOrder!, factuur, breweryMet, appName, factuurLogo||logo, {url: payUrl, qrDataUrl: qr})
        const pdf2 = await htmlToPdfBase64(html2)
        return [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdf2, mimeType: 'application/pdf'}]
      } : undefined
      setMailModal({
        title: t('mail_modal_title_factuur'),
        to: (resolvedSelectedOrder?.klant_email || ''),
        subject: interpolate(tplOrDefault(betaal.kind, 'subject'), vars),
        text: interpolate(tplOrDefault(betaal.kind, 'body'), vars),
        attachments: [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        kind: 'factuur',
        mollie: mollieCtx,
        regenerateAttachments,
      })
    } catch (e: any) {
      setMelding(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(false)
  }

  const regelLijstVoorMail = (order: any): string => (order?.regels||[]).map((r: any) =>
    `- ${r.aantal}× ${r.bier_naam || r.omschrijving || ''}${r.verpakking_type ? ` (${r.verpakking_type})` : ''}`
  ).join('\n')

  const mailOrderBevestiging = () => {
    if (!selectedOrder) return
    const orderRef = orderNummer(selectedOrder)
    // {levering}: afhalen of bezorgen (er volgt een verzendbevestiging) — zie
    // utils/levering.ts. De link waarmee de afhaalklant zijn moment kiest of
    // verzet staat niet in de tekst maar als knop onder de mail; de
    // winkel-URL is nodig om die link na te bouwen.
    const storeUrl = wcCreds?.storeUrl || ''
    const levering = leveringMailVars(selectedOrder, {storeUrl})
    const afhaalKnop = afhaalMailKnop(selectedOrder, {storeUrl})
    const vars = {
      naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
      nr: orderRef,
      regels: regelLijstVoorMail(selectedOrder),
      brouwerij: (breweryDetails as any)?.naam || appName || '',
      ...levering,
    }
    // Knop naar de bestelling in de webshop: het eigen sjabloon uit de
    // instellingen, anders de link die de import per order bepaalde
    // ("Mijn account → bestelling" voor een klant met account, anders de
    // bedankpagina met ordersleutel). Zonder een van beide géén knop — een
    // gegokte URL wordt een 404.
    const orderUrl = bestelLink(wcCreds?.storeUrl, selectedOrder.wc_order_id, selectedOrder.wc_order_key,
      {sjabloon: wcCreds?.bestelUrl, bestelUrl: selectedOrder.wc_bestel_url})
    setMailModal({
      title: t('mail_modal_title_bestelling'),
      to: (resolvedSelectedOrder?.klant_email || ''),
      subject: interpolate(tplOrDefault('bestelling', 'subject'), vars),
      text: interpolate(tplOrDefault('bestelling', 'body'), vars),
      kind: 'bevestiging',
      linkButtons: [
        afhaalKnop,
        orderUrl ? {url: orderUrl, label: t('mail_bestelling_knop'), textLine: t('mail_bestelling_knop_regel')} : null,
      ].filter((k): k is MailKnop => !!k),
    })
  }

  // Verzendbevestiging: direct na "Markeer verzonden" (met de zojuist ingevulde
  // track & trace) of later opnieuw vanaf de orderknoppen.
  const mailOrderVerzending = (order: any = selectedOrder) => {
    if (!order) return
    const vars = {
      naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || order.klant_naam || ''),
      nr: orderNummer(order),
      regels: regelLijstVoorMail(order),
      brouwerij: (breweryDetails as any)?.naam || appName || '',
      ...verzendMailVars(order),
    }
    setMailModal({
      title: t('mail_modal_title_verzending'),
      to: (resolvedSelectedOrder?.klant_email || order.klant_email || ''),
      subject: interpolate(tplOrDefault('verzending', 'subject'), vars),
      text: interpolate(tplOrDefault('verzending', 'body'), vars),
      kind: 'verzending',
    })
  }

  // Afspraak gemist: de afhaalklant is niet komen opdagen. De mail noemt het
  // gemiste moment en heeft onderaan dezelfde afhaalpagina-knop waarmee de
  // klant een nieuw moment kiest (utils/levering.ts). Het nieuwe moment komt
  // bij de volgende WooCommerce-import vanzelf op de bestelling terecht.
  const mailOrderAfhaalGemist = () => {
    if (!selectedOrder) return
    const storeUrl = wcCreds?.storeUrl || ''
    const vars = {
      naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
      nr: orderNummer(selectedOrder),
      regels: regelLijstVoorMail(selectedOrder),
      brouwerij: (breweryDetails as any)?.naam || appName || '',
      ...afhaalGemistMailVars(selectedOrder, {storeUrl}),
    }
    const knop = afhaalGemistMailKnop(selectedOrder, {storeUrl})
    setMailModal({
      title: t('mail_modal_title_afhaal_gemist'),
      to: (resolvedSelectedOrder?.klant_email || ''),
      subject: interpolate(tplOrDefault('afhaal_gemist', 'subject'), vars),
      text: interpolate(tplOrDefault('afhaal_gemist', 'body'), vars),
      kind: 'afhaal_gemist',
      linkButtons: knop ? [knop] : [],
    })
  }

  // --- RENDER ---

  // Een bestelling in de route die er niet (meer) is: zeggen, met de weg naar
  // de lijst. Zolang de bestellingen nog laden: niets.
  if (view === 'detail' && !selectedOrder && gestuurd) {
    if (!_fetchedKeys.has('bestellingen')) return null
    return (
      <LegeStaat icoon="search" titel={t('route_niet_gevonden_titel')} tekst={t('route_niet_gevonden_bestelling')}>
        <Btn v="secondary" onClick={() => openOrder(null, { vervang: true })}>{t('route_naar_lijst').replace('{lijst}', t('nav_bestellingen'))}</Btn>
      </LegeStaat>
    )
  }

  if (view === 'detail' && selectedOrder) {
    const picks = picksVoorOrder(selectedOrder.id)
    const status: string = selectedOrder.status
    const allPicked = (selectedOrder.regels||[]).filter(isPickRegel).every((r: any) => gepicktVoorRegel(selectedOrder.id, r.id) >= r.aantal)
    // Alleen-merch order: niets te picken, dus direct afrondbaar.
    const nietsTePicken = !heeftPickRegels(selectedOrder)
    // Al bier uitgeleverd? Dan geen "Picken" meer, wel terugdraaien zolang
    // het niet verzonden is (null = niets terug te draaien).
    const uitgeleverd = orderUitgeleverd(bestellingPicks, selectedOrder.id)
    const terugdraaiing = pickTerugdraaiing(selectedOrder)
    // Dezelfde regels als de knoppen altijd volgden (utils/bestelling): wat
    // mag er, en wat is de ene volgende stap onderin.
    const {stap, pickbaar, magAfronden} = volgendeOrderStap(selectedOrder, {
      heeftPickRegels: !nietsTePicken, allesGepickt: allPicked, uitgeleverd,
    })
    const open = status !== 'afgerond' && status !== 'geannuleerd'
    const bewerkbaar = status === 'nieuw' || status === 'bevestigd' || status === 'gepickt'
    // Kan elke bierregel geleverd worden, en wat komt eraan bij een tekort.
    const levering = open ? bestellingLevering(selectedOrder, verkoopCtx) : null
    const leveringPerRegel = new Map<any, OrderRegelLevering>((levering?.regels || []).map(x => [x.regelId, x.levering]))
    // De factuur: na afronden, of al vooraf zodra de order betaald was
    // (utils/orderFactuur.ts). Een gefactureerde order houdt zijn regels vast
    // (wijzigen = creditnota); de BTW corrigeren kan via "BTW corrigeren", net
    // als na afronden.
    const orderFactuur = orderFactuurVan(selectedOrder, verkoopFacturen)
    const gefactureerd = orderIsGefactureerd(selectedOrder, verkoopFacturen)
    const kanVooraf = voorafFactuurBlokkade(selectedOrder, verkoopFacturen) === null
    const crediteren = teCrediterenFactuur(selectedOrder)
    const smtp = !!smtpCreds?.enabled
    const vandaag = tod()
    const lang = getLang()
    const productNaamVan = (id: number | null): string =>
      id == null ? '' : String((producten||[]).find((p: any) => p.id === id)?.naam || '')
    const naarProduct = gaNaar ? (id: number) => gaNaar({pagina: 'producten', id}) : undefined
    const naarBatch = gaNaar ? (id: number) => gaNaar({pagina: 'batches', id}) : undefined

    // Een regel die met "Verwijderen" op de UndoBar wacht, staat al niet meer
    // in beeld (en telt niet meer mee in de totalen).
    const wachtendeRegel = String(undo.actie?.id || '').startsWith(`${REGEL_UNDO}${selectedOrder.id}-`)
      ? String(undo.actie!.id).slice(`${REGEL_UNDO}${selectedOrder.id}-`.length) : null
    const regels = (selectedOrder.regels||[]).filter((r: any) => wachtendeRegel == null || String(r.id) !== wachtendeRegel)
    const totalen = totalenVan({...selectedOrder, regels})
    const regelIds = new Set(regels.map((r: any) => r.id))
    const losPicks = picks.filter((p: any) => !regelIds.has(p.regel_id))

    // ── De ene volgende stap (ActieBalk) ───────────────────────────────────
    const uitTeSlaanTotaal = (levering?.regels || []).reduce((s, x) => s + x.levering.uitTeSlaan, 0)
    const pickNodig = levering?.nodig ?? 0
    const pickKan = levering?.kan ?? 0
    // Niets vrij en niets in de AGP: picken kan niet — zeggen waarop het wacht.
    const nietsTePickenNu = stap === 'picken' && levering != null && pickNodig > 0 && pickKan === 0 && uitTeSlaanTotaal === 0
    const wachtOp = levering?.regels.find(x => x.levering.tekort > 0 && x.levering.komtEraan.length > 0)?.levering || null
    const stapInfo: string = stap !== 'picken' || !levering ? ''
      : nietsTePickenNu
        ? (wachtOp
          ? t('orders_stap_wacht_op').replace('{batch}', komtEraanTekst(wachtOp.komtEraan[0], productNaamVan(wachtOp.productId), vandaag))
          : levering.status === 'geen_bier' ? t('orders_stap_niet_herkend') : t('orders_stap_niets_vrij'))
        : uitTeSlaanTotaal > 0 && pickKan < pickNodig
          ? t('orders_stap_uitslaan').replace('{n}', String(uitTeSlaanTotaal))
          : ''
    // Is de factuur al vooraf gemaakt, dan maakt afronden er geen meer.
    const afrondLabel = orderFactuur ? t('order_complete') : t('orders_stap_factuur')
    const stapKnop = stap === 'picken'
      ? {label: pickNodig > 0 && pickKan < pickNodig
          ? t('orders_stap_picken_van').replace('{kan}', String(pickKan)).replace('{nodig}', String(pickNodig))
          : t('orders_stap_picken_n').replace('{n}', String(pickNodig)),
        onClick: openPickModal}
      : stap === 'verzenden' ? {label: t('order_mark_shipped'), onClick: markVerzonden}
      : stap === 'afronden' ? {label: afrondLabel, onClick: openAfronden}
      : null

    // ── De rest in ⋯: dezelfde handelingen en voorwaarden als de knoppen ───
    const mailTitel = smtp ? undefined : t('mail_no_smtp')
    // Zonder mailserver staan de mail-acties uit, met de reden eronder (een
    // tooltip zie je op een telefoon niet).
    const mailActie = (id: string, label: string, onClick: () => void, pdf = false): RowActie => ({
      id, onClick, title: mailTitel, disabled: !smtp || (pdf && mailGenerating),
      label: smtp ? (pdf && mailGenerating ? t('mail_generating_pdf') : label)
        : <>{label}<span className="block text-xs text-gray-500">{t('orders_mail_geen_smtp')}</span></>,
    })
    // Volgorde: de andere stappen, afdrukken, mailen, regels toevoegen,
    // terugdraaien en als laatste (rood) annuleren.
    const acties: RowActie[] = []
    if (pickbaar && stap !== 'picken') acties.push({id: 'picken', label: t('order_pick'), onClick: openPickModal})
    if (magAfronden && stap !== 'verzenden') acties.push({id: 'verzonden', label: t('order_mark_shipped'), title: t('tooltip_logistical_status'), onClick: markVerzonden})
    if ((magAfronden || status === 'verzonden') && stap !== 'afronden') acties.push({id: 'afronden', label: afrondLabel, onClick: openAfronden})
    // Betaald maar nog niet opgehaald of verzonden: de factuur kan nu al, zodat
    // de betaling (de uitbetaling van Mollie) eraan te koppelen is; de
    // bestelling blijft open.
    if (kanVooraf) acties.push({id: 'factuur_vooraf', label: t('order_factuur_vooraf'), title: t('order_factuur_vooraf_tip'), toelichting: t('orders_factuur_vooraf_kort'), onClick: openVooraf})
    // De pakbon mag ook vóór (of halverwege) het picken geprint worden: de nog
    // niet gepickte regels staan er dan zonder lot/THT op en het document
    // draagt een concept-markering (PakbonExport).
    if (status !== 'geannuleerd') acties.push({id: 'pakbon', label: t('order_print_pakbon'), title: bewerkbaar && !magAfronden ? t('order_print_pakbon_concept_uitleg') : undefined, onClick: printOrderPakbon})
    if (pickbaar && (status === 'nieuw' || status === 'bevestigd') && onGepickteRegels(selectedOrder, picks).length > 0) {
      acties.push({id: 'picklijst', label: t('orders_print_picklijst_order'), onClick: printOrderPicklijst})
    }
    if (orderFactuur) acties.push({id: 'factuur', label: t('order_print_factuur'), onClick: printOrderFactuur})
    if (status === 'nieuw' || status === 'bevestigd') {
      acties.push(mailActie('mail_bevestiging', status === 'bevestigd' ? t('order_mail_bevestiging_resend') : t('order_mail_bevestiging'), mailOrderBevestiging))
    }
    if (magAfronden || status === 'verzonden' || status === 'afgerond') {
      acties.push(mailActie('mail_pakbon', t('order_mail_pakbon'), mailOrderPakbon, true))
    }
    // Een verzonden of open order heeft pas een factuur als hij vooraf gemaakt is.
    if (orderFactuur && status !== 'geannuleerd') {
      acties.push(mailActie('mail_factuur', t('order_mail_factuur'), mailOrderFactuur, true))
    }
    if ((status === 'verzonden' || status === 'afgerond') && selectedOrder.wc_levering !== 'afhalen') {
      acties.push(mailActie('mail_verzending', t('order_mail_verzending'), () => mailOrderVerzending()))
    }
    // Afhaalklant niet komen opdagen: mail met de link om een nieuw moment te
    // kiezen. Alleen zolang het gekozen moment voorbij is en de order openstaat.
    if (afhaalmomentVerstreken(selectedOrder)) {
      acties.push(mailActie('mail_afhaal_gemist', t('order_mail_afhaal_gemist'), mailOrderAfhaalGemist))
    }
    // Gefactureerd: de regels staan vast (ze staan al op de factuur).
    if (bewerkbaar && !gefactureerd) {
      acties.push({id: 'verzendkosten', label: t('btn_verzendkosten'), onClick: addVerzendkosten})
      acties.push({id: 'vrije_regel', label: t('btn_vrije_regel'), onClick: () => { setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'}); setVrijeRegelFout(''); setShowVrijeRegelModal(true) }})
    }
    if (terugdraaiing) acties.push({id: 'terugdraaien', label: t('order_picks_terugdraaien'), title: blokkadeTekst(terugdraaiing) || undefined, onClick: () => setTerugdraaiVraag(true)})
    if (open) acties.push({id: 'annuleren', label: t('order_cancel'), soort: 'gevaar', onClick: () => { setAnnuleerFout(''); setShowAnnuleerModal(true) }})

    // ── Klant en levering ──────────────────────────────────────────────────
    // Leest live van de klantkaart (via klant_id of e-mail), zodat een
    // gewijzigd adres hier en in alle mails meteen klopt; de snapshot op de
    // order blijft de terugval.
    const k = resolvedSelectedOrder || selectedOrder
    const klantNaam = String(k.klant_naam || '').trim()
    const klantBedrijf = String(k.klant_bedrijf || '').trim()
    const adres = [
      [k.klant_straat, k.klant_huisnummer].filter(Boolean).join(' '),
      [k.klant_postcode, k.klant_stad].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ')
    const kType = effectiveKlantType(selectedOrder)
    // Vóór het picken mag privé/zakelijk nog gecorrigeerd worden (bijv. een
    // verkeerd gedetecteerde WooCommerce-import); daarna is het bevroren.
    const kTypeAanpasbaar = (status === 'nieuw' || status === 'bevestigd') && !gefactureerd
    const afhalen = selectedOrder.wc_levering === 'afhalen'
    const afhaalUrl = afhalen ? afhaalLink(wcCreds?.storeUrl, selectedOrder.wc_order_id, selectedOrder.wc_order_key) : ''
    const pd = pakbonDatumVoor(selectedOrder)
    const infoRegels: Array<[string, React.ReactNode]> = []
    if (pd && pd !== selectedOrder.datum) infoRegels.push([t('orders_pick_date'), fmtD(pd)])
    if (selectedOrder.verzend_datum) infoRegels.push([t('factuur_delivery_date'), fmtD(selectedOrder.verzend_datum)])
    if (selectedOrder.factuur_nummer) infoRegels.push([t('factuur_number'), <span className="font-mono">{selectedOrder.factuur_nummer}</span>])
    if (selectedOrder.pakbon_nummer) infoRegels.push([t('pakbon_number'), <span className="font-mono">{selectedOrder.pakbon_nummer}</span>])
    const datumJaar = String(selectedOrder.datum || '').slice(0, 4)

    return (
      <div>
        {/* Kop. Op een telefoon staan het nummer en de terugknop in de
            kopbalk (één terugweg); op een bureau vervangt de bestelling de
            lijst, dus daar staan ze hier. */}
        <div className={`${gestuurd ? 'hidden md:flex' : 'flex'} items-center gap-3 mb-3 flex-wrap`}>
          <button onClick={() => openOrder(null)} className="flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 transition-colors">
            {t('btn_back')}
          </button>
          <h2 className="text-xl font-bold text-gray-800">{orderNummer(selectedOrder)}</h2>
        </div>
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5 md:pt-1">
            <StatusChip status={status} />
            <span className="text-sm text-gray-600 whitespace-nowrap">
              {(() => { const bron = bestellingBron(selectedOrder); return t(`orders_bron_${bron}`, bron) })()}
              {selectedOrder.datum ? ` · ${fmtWeekdagDatum(selectedOrder.datum, {lang, jaar: datumJaar !== vandaag.slice(0, 4)})}` : ''}
            </span>
            <BetaaldBadge b={selectedOrder} />
            {orderFactuur && <GefactureerdBadge b={selectedOrder} nummer={orderFactuur.factuurnummer || ''} />}
            <WcSyncBadge b={selectedOrder} opties={wcTerugschrijfOpties(selectedOrder)}
              onOpnieuw={doel => { void schrijfTerugNaarWc(selectedOrder, doel) }} />
          </div>
          <RowActions key={selectedOrder.id} acties={acties} v="kaart" />
        </div>

        <PaginaMelding tekst={melding} onSluit={() => setMelding('')} cls="mb-3" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
          {/* Klant en levering */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <div className="font-semibold text-gray-900 break-words">{klantBedrijf || klantNaam || t('lbl_onbekend')}</div>
            {klantBedrijf && klantNaam && klantNaam !== klantBedrijf && <div className="text-sm text-gray-600 break-words">{klantNaam}</div>}
            {adres && <div className="text-sm text-gray-600 mt-0.5 break-words">{adres}</div>}
            {k.klant_email && <div className="text-sm text-gray-500 break-all">{k.klant_email}</div>}
            {(selectedOrder.wc_levering || kType) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <LeveringBadge b={selectedOrder} />
                <KlantTypeChip type={kType} onWissel={kTypeAanpasbaar ? wijzigKlantType : undefined} />
              </div>
            )}
            {/* Levering: afhalen (locatie + gekozen moment + de afhaalpagina
                van de klant) of verzenden (methode, track & trace, wanneer de
                verzendbevestiging is gemaild). */}
            {selectedOrder.wc_levering && (
              <div className="mt-2 space-y-1 text-sm">
                {afhalen && selectedOrder.wc_afhaal_locatie && <div className="text-gray-600">{selectedOrder.wc_afhaal_locatie}</div>}
                {!afhalen && selectedOrder.wc_verzendmethode && <div className="text-gray-600">{selectedOrder.wc_verzendmethode}</div>}
                {afhalen && (() => {
                  const gemist = afhaalmomentVerstreken(selectedOrder)
                  return (
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500">{t('orders_afhaalmoment')}</span>
                      <span className={`text-right ${gemist ? 'text-red-600' : selectedOrder.wc_afhaalmoment ? 'text-gray-800' : 'text-orange-600 italic'}`}>
                        {selectedOrder.wc_afhaalmoment ? afhaalmomentLabel(selectedOrder.wc_afhaalmoment) : t('orders_afhaalmoment_open')}
                        {gemist ? ` (${t('orders_afhaalmoment_verstreken')})` : ''}
                      </span>
                    </div>
                  )
                })()}
                {afhalen && selectedOrder.afhaal_gemist_datum && (
                  <div className="text-xs text-red-700">{t('orders_afhaal_gemist_op').replace('{datum}', fmtD(selectedOrder.afhaal_gemist_datum))}</div>
                )}
                {afhaalUrl && (
                  <a href={afhaalUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline t-accent-text">
                    {t('orders_afhaal_link')}
                  </a>
                )}
              </div>
            )}
            {selectedOrder.verzend_tracking && (
              <div className="mt-2 flex justify-between gap-3 text-sm">
                <span className="text-gray-500">{t('orders_track')}</span>
                {/^https?:\/\//i.test(selectedOrder.verzend_tracking)
                  ? <a href={selectedOrder.verzend_tracking} target="_blank" rel="noopener noreferrer" className="underline break-all text-right t-accent-text">{selectedOrder.verzend_tracking}</a>
                  : <span className="font-mono break-all text-right">{selectedOrder.verzend_tracking}</span>}
              </div>
            )}
            {selectedOrder.verzendbevestiging_datum && (
              <div className="mt-1 text-xs text-green-700">{t('orders_verzendbevestiging_op').replace('{datum}', fmtD(selectedOrder.verzendbevestiging_datum))}</div>
            )}
          </div>

          {/* Gegevens van de order — alleen wat er is. */}
          {(infoRegels.length > 0 || selectedOrder.opmerkingen) && (
            <div className="bg-white rounded-xl shadow-card p-4 space-y-1 text-sm">
              {infoRegels.map(([label, waarde]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-gray-500">{label}</span><span className="text-right text-gray-800">{waarde}</span>
                </div>
              ))}
              {selectedOrder.opmerkingen && <div className="pt-1 text-xs text-gray-600 italic break-words">{selectedOrder.opmerkingen}</div>}
            </div>
          )}
        </div>

        {/* Regels: per regel wat er vrij ligt, wat eraan komt en (na het
            picken) de lotcode met THT; daaronder de totalen. */}
        <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
          <SectionHeader
            title={t('orders_lines')}
            info={gefactureerd && status !== 'geannuleerd' ? (
              <button type="button" onClick={() => setBtwCorrectie(btwCorrectie === selectedOrder.id ? null : selectedOrder.id)}
                className="text-xs underline t-accent-text min-h-tap sm:min-h-0">
                {btwCorrectie === selectedOrder.id ? t('orders_btw_correctie_klaar') : t('orders_btw_correctie')}
              </button>
            ) : undefined}
          />
          {btwCorrectie === selectedOrder.id && (
            <div className="px-4 py-2 bg-orange-50 text-orange-700 text-xs border-b border-orange-100">
              {t('orders_btw_correctie_hint')}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {regels.map((r: any) => {
              const gepickt = gepicktVoorRegel(selectedOrder.id, r.id)
              const soort = regelSoort(r)
              const isVrij = soort === 'vrij' || soort === 'verzending' || soort === 'korting'
              const lev = soort === 'bier' ? leveringPerRegel.get(r.id) || null : null
              const productId = soort === 'bier' ? (lev?.productId ?? productIdVoorRegel(r)) : null
              const kanRegelWisselen = open && gepickt === 0
              // Gefactureerd (afgerond, of vooraf): de regels staan op de
              // factuur, dus niet meer weghalen; de BTW alleen via "BTW
              // corrigeren" — dan gaat de factuur mee (updateRegelBtw).
              const isBtwCorrectie = gefactureerd && status !== 'geannuleerd' && btwCorrectie === selectedOrder.id
              const canEditBtw = (open && !gefactureerd) || isBtwCorrectie
              const regelActies: RowActie[] = []
              if (kanRegelWisselen && (soort === 'bier' || soort === 'vrij')) {
                regelActies.push({
                  id: 'wissel',
                  label: soort === 'bier' ? t('orders_regel_naar_vrij') : t('orders_regel_naar_bier'),
                  title: t('orders_regel_type_wissel'),
                  onClick: () => updateRegelType(r.id),
                })
              }
              // Het BTW-tarief van de regel (bijv. een webshopimport op 9 % die 21 %
              // moet zijn): in het menu, net als de andere regelacties.
              if (canEditBtw) {
                for (const o of btwOpts) {
                  if (o.v === String(r.btw_pct)) continue
                  regelActies.push({id: `btw-${o.v}`, label: t('orders_btw_naar').replace('{pct}', o.v), title: t('orders_edit_btw'), onClick: () => updateRegelBtw(r.id, Number(o.v))})
                }
              }
              if (isVrij && open && !gefactureerd) regelActies.push({id: 'verwijder', label: t('btn_delete'), soort: 'gevaar', onClick: () => verwijderRegel(r)})
              return (
                <OrderRegelKaart
                  key={r.id}
                  regel={r}
                  soort={soort}
                  ebc={soort === 'bier' ? ebcVoorRegel(r) : null}
                  productId={productId}
                  productNaam={productNaamVan(productId) || String(r.bier_naam || '')}
                  onProduct={naarProduct}
                  netto={regelBedrag(r).netto}
                  gepickt={gepickt}
                  levering={lev}
                  vandaag={vandaag}
                  picks={picks.filter((p: any) => p.regel_id === r.id)
                    .map((p: any) => ({id: p.id, aantal: Number(p.aantal) || 0, herkomst: herkomstVanPick(p, herkomstData)}))}
                  onBatch={naarBatch}
                  acties={regelActies}
                />
              )
            })}
            {/* Picks waarvan de regel er niet meer is: niet stil laten verdwijnen. */}
            {losPicks.length > 0 && (
              <OrderRegelKaart
                regel={{omschrijving: t('orders_picks_los'), aantal: losPicks.reduce((s: number, p: any) => s + (Number(p.aantal) || 0), 0), btw_pct: 0, prijs_per_stuk: 0}}
                soort="vrij" ebc={null} productId={null} productNaam="" netto={0} gepickt={0} vandaag={vandaag}
                picks={losPicks.map((p: any) => ({id: p.id, aantal: Number(p.aantal) || 0, herkomst: herkomstVanPick(p, herkomstData)}))}
                onBatch={naarBatch} acties={[]}
              />
            )}
          </ul>
          {/* Een regel die bij géén eigen bier hoort en waar niets voor te
              picken is (utils/verkoopOverzicht → merchVoorstel): zonder deze
              uitweg blijft de order eeuwig openstaan. Nooit voor een regel
              waarvan het bier herkend is — ook niet als het alleen nog in de
              tank ligt (daar staat "Komt eraan"). */}
          {(() => {
            if (!open) return null
            const vast = regels.filter((r: any) => isPickRegel(r) && leveringPerRegel.get(r.id)?.merchVoorstel)
            if (!vast.length) return null
            return (
              <div className="px-4 py-3 bg-purple-50 border-t border-purple-100 space-y-2">
                <div className="text-xs text-purple-800">
                  <strong>{t('orders_niet_leverbaar_titel')}</strong> {t('orders_niet_leverbaar_uitleg')}
                </div>
                {vast.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs text-purple-900">
                    <span className="font-medium">{r.omschrijving || r.bier_naam}</span>
                    {r.sku && <span className="font-mono text-purple-600">[{r.sku}]</span>}
                    <BevestigKnop s="sm" v="secondary" vraag={t('picking_merch_vraag')}
                      onBevestig={() => updateRegelType(r.id, true)}>
                      {t('picking_merch_knop')}
                    </BevestigKnop>
                  </div>
                ))}
              </div>
            )
          })()}
          <OrderTotalenBlok totalen={totalen} />
        </div>

        <OrderLogboek auditLog={auditLog} bestellingId={selectedOrder.id} />

        {/* De ene volgende stap, vast onderin; de rest staat in ⋯. */}
        {stapKnop && (
          <ActieBalk
            label={stapKnop.label}
            onClick={stapKnop.onClick}
            v={stap === 'afronden' ? 'green' : 'primary'}
            disabled={nietsTePickenNu}
            title={nietsTePickenNu ? stapInfo : undefined}
            info={stapInfo || undefined}
          />
        )}

        {/* Picks terugdraaien: eerst vragen (het ⋯-menu kan geen bevestiging
            in de knop dragen). Een geblokkeerde terugdraaiing zegt waarom. */}
        {terugdraaiVraag && terugdraaiing && (
          <Modal title={t('order_picks_terugdraaien')} onClose={() => setTerugdraaiVraag(false)}>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {terugdraaiing.blokkade ? blokkadeTekst(terugdraaiing) : t('order_picks_terugdraaien_vraag')}
              </p>
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setTerugdraaiVraag(false)}>{t('btn_cancel')}</Btn>
                <Btn v="danger" disabled={!!terugdraaiing.blokkade} onClick={() => { setTerugdraaiVraag(false); draaiPicksTerug() }}>
                  {t('order_picks_terugdraaien')}
                </Btn>
              </div>
            </div>
          </Modal>
        )}

        {mailModal && (
          <MailModal
            title={mailModal.title}
            initialTo={mailModal.to}
            initialSubject={mailModal.subject}
            initialText={mailModal.text}
            attachments={mailModal.attachments}
            brewery={breweryDetails as any}
            logoDataUri={factuurLogo || logo}
            replyTo={(breweryDetails as any)?.email}
            smtpReady={!!smtpCreds?.enabled}
            mollie={mailModal.mollie}
            regenerateAttachments={mailModal.regenerateAttachments}
            linkButtons={mailModal.linkButtons}
            onClose={() => setMailModal(null)}
            onSent={(sentTo) => {
              // Per maild-type een leesbare log-omschrijving — wordt onderaan de
              // order in het logboekje getoond. Gebruik het werkelijk gebruikte
              // adres (in de modal bewerkt), niet het oorspronkelijke klant-adres.
              const naar = sentTo || mailModal.to
              const omschrijving =
                mailModal.kind === 'pakbon'      ? `Pakbon gemaild naar ${naar}` :
                mailModal.kind === 'factuur'     ? `Factuur gemaild naar ${naar}` :
                mailModal.kind === 'bevestiging' ? `Bevestigingsmail verstuurd naar ${naar}` :
                mailModal.kind === 'verzending'  ? `Verzendbevestiging gemaild naar ${naar}` :
                mailModal.kind === 'afhaal_gemist' ? `Afspraak-gemist-mail gemaild naar ${naar}` :
                `Mail verstuurd: ${mailModal.subject}`
              logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id: selectedOrder.id, actie:'gewijzigd', omschrijving})
              // Onthoud wanneer de verzendbevestiging de deur uit ging, zodat
              // de order laat zien dat de klant al bericht heeft gehad.
              if (mailModal.kind === 'verzending') {
                setBestellingen((prev: any[]) => prev.map((b: any) =>
                  b.id === selectedOrder.id ? {...b, verzendbevestiging_datum: tod()} : b
                ))
              }
              // Idem voor de afspraak-gemist-mail: zo zie je bij de order dat
              // de klant al gevraagd is een nieuw moment te kiezen.
              if (mailModal.kind === 'afhaal_gemist') {
                setBestellingen((prev: any[]) => prev.map((b: any) =>
                  b.id === selectedOrder.id ? {...b, afhaal_gemist_datum: tod()} : b
                ))
              }
              // Status-overgang: een 'nieuw' order wordt 'bevestigd' zodra de
              // bevestigingsmail succesvol is verzonden. Latere statussen
              // (gepickt/verzonden/...) worden niet overschreven — een resend
              // verandert de status dus niet.
              if (mailModal.kind === 'bevestiging' && selectedOrder.status === 'nieuw') {
                setBestellingen((prev: any[]) => prev.map((b: any) =>
                  b.id === selectedOrder.id ? {...b, status: 'bevestigd'} : b
                ))
              }
            }}
          />
        )}

        {/* Afronden bevestiging */}
        {showAfrondModal && (
          <Modal title={t('order_complete')} onClose={() => { if (!afrondBezig) setShowAfrondModal(false) }}>
            <div className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                <p>{t('order_afrond_intro')}</p>
                <p className="mt-2 text-xs text-green-700">{t('order_afrond_uitleg')}</p>
                <ul className="mt-1 space-y-1 list-disc list-inside text-xs">
                  {orderFactuur ? (<>
                    {/* Vooraf gefactureerd: afronden maakt geen tweede factuur. */}
                    <li>{t('order_afrond_punt_factuur_al').replace('{nummer}', orderFactuur.factuurnummer || '')}</li>
                    <li>{t('order_afrond_punt_pakbon')}</li>
                  </>) : (<>
                    <li>{t('order_afrond_punt_factuur')}</li>
                    <li>{t('order_afrond_punt_nummers')}</li>
                  </>)}
                  <li>{t('order_afrond_punt_status')}</li>
                </ul>
              </div>
              {/* AGP: Type uitlevering en bestemmingsgegevens */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-500">{t('lbl_type_uitlevering')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <select value={uitleveringForm.type_uitlevering} onChange={e => setUitleveringForm(f => ({...f, type_uitlevering: e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                      <option value="binnenland">{t('opt_binnenland')}</option>
                      <option value="intra_eu">{t('opt_intra_eu')}</option>
                      <option value="export">{t('opt_export')}</option>
                    </select>
                  </div>
                  <div>
                    <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_vervoerder')} value={uitleveringForm.vervoerder} onChange={e => setUitleveringForm(f => ({...f, vervoerder: e.target.value}))} />
                  </div>
                </div>
                {uitleveringForm.type_uitlevering === 'binnenland' && (
                  <div className="text-xs text-gray-500">
                    {t('lbl_bestemming_naam')}: <span className="font-medium text-gray-700">{afnemerVanOrder || t('lbl_onbekend')}</span>
                  </div>
                )}
                {uitleveringForm.type_uitlevering !== 'binnenland' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_naam')} value={uitleveringForm.bestemming_naam} onChange={e => setUitleveringForm(f => ({...f, bestemming_naam: e.target.value}))} />
                      <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_land')} value={uitleveringForm.bestemming_land} onChange={e => setUitleveringForm(f => ({...f, bestemming_land: e.target.value}))} />
                    </div>
                    <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_adres')} value={uitleveringForm.bestemming_adres} onChange={e => setUitleveringForm(f => ({...f, bestemming_adres: e.target.value}))} />
                  </>
                )}
              </div>
              {merchTekortMelding && (
                <div role="alert" className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 whitespace-pre-line">
                  {merchTekortMelding}
                </div>
              )}
              {afrondFout && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {afrondFout}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowAfrondModal(false)} disabled={afrondBezig}>{t('btn_cancel')}</Btn>
                <Btn v="green" onClick={rondeAf} disabled={afrondBezig}>{merchTekortMelding ? t('orders_toch_afronden') : t('order_complete')}</Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Picking Modal */}
        {showPickModal && (() => {
          // Verkopen gaat uit vrije voorraad, voor privé én zakelijk; alleen
          // export/intra-EU mag rechtstreeks uit de AGP (utils/agp.ts).
          const zonderAgp = !verkoopUitAgpToegestaan(uitleveringForm.type_uitlevering)
          return (
          <Modal title={t('picking_title')} onClose={() => setShowPickModal(false)} wide>
            {/* Levering: soort, bestemming en vervoerder. Bovenaan, want de soort
                bepaalt waar het bier vandaan mag komen: binnenland alleen uit
                vrije voorraad (eerst uitslaan), export/intra-EU onder schorsing
                rechtstreeks uit de AGP. Bij volledige picking ontstaan de
                uitleveringen. */}
            <div className="mb-3 border border-gray-200 rounded-lg p-3 space-y-3">
              <div className="text-xs font-semibold text-gray-800">{t('picking_levering_titel')}</div>
              <div className="text-[11px] text-gray-500">{t('picking_levering_uitleg')}</div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={uitleveringForm.type_uitlevering}
                  onChange={e => setUitleveringForm(f => ({...f, type_uitlevering: e.target.value}))}
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                  <option value="binnenland">{t('opt_binnenland')}</option>
                  <option value="intra_eu">{t('opt_intra_eu')}</option>
                  <option value="export">{t('opt_export')}</option>
                </select>
                <input
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200"
                  placeholder={t('lbl_vervoerder')}
                  value={uitleveringForm.vervoerder}
                  onChange={e => setUitleveringForm(f => ({...f, vervoerder: e.target.value}))} />
              </div>
              {uitleveringForm.type_uitlevering === 'binnenland' && (
                <div className="text-xs text-gray-500">
                  {t('lbl_bestemming_naam')}: <span className="font-medium text-gray-700">{afnemerVanOrder || t('lbl_onbekend')}</span>
                </div>
              )}
              {uitleveringForm.type_uitlevering !== 'binnenland' && (
                <div className="grid grid-cols-2 gap-3">
                  <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_naam')} value={uitleveringForm.bestemming_naam} onChange={e => setUitleveringForm(f => ({...f, bestemming_naam: e.target.value}))} />
                  <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_land')} value={uitleveringForm.bestemming_land} onChange={e => setUitleveringForm(f => ({...f, bestemming_land: e.target.value}))} />
                  <input className="t-input col-span-2 w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_adres')} value={uitleveringForm.bestemming_adres} onChange={e => setUitleveringForm(f => ({...f, bestemming_adres: e.target.value}))} />
                </div>
              )}
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {(selectedOrder.regels||[]).filter(isPickRegel).map((r: any) => {
                const draftVoorRegel = draftPicks[r.id] || []
                const totaalGepickt = draftVoorRegel.reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
                const resterend = r.aantal - totaalGepickt
                const allAfvullingen = getAvailableAfvullingen(r.bier_naam, r.verpakking_type, selectedOrder.id, null, r.artikel_key, r.sku)
                // Binnenland: alleen afvullingen met vrije voorraad buiten de
                // AGP. Wat alleen nog in de AGP ligt, moet eerst uitgeslagen.
                const afvullingen = zonderAgp
                  ? allAfvullingen.filter((a: any) => beschikbaarBuitenAgpVoorAfvulling(a, selectedOrder.id) > 0)
                  : allAfvullingen
                const {vrij: vrijRegel, agp: agpRegel} = zonderAgp ? vrijEnAgp(allAfvullingen, selectedOrder.id) : {vrij: 0, agp: 0}
                const uitslaanNodig = zonderAgp ? uitTeSlaan(resterend, Math.max(0, vrijRegel - totaalGepickt), agpRegel) : 0
                const alleenInAgp = zonderAgp && afvullingen.length === 0 && agpRegel > 0
                const levRegel = leveringPerRegel.get(r.id) || null

                return (
                  <div key={r.id} className="border rounded-lg p-3">
                    {/* Naam en tellers mogen onder elkaar vallen; een SKU of
                        een teller breekt nooit midden in een woord. */}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
                      <span className="min-w-0 font-semibold text-gray-800 flex items-center gap-1.5">
                        <BierKleur ebc={ebcVoorRegel(r)} s="sm" />
                        <span className="min-w-0">
                          {r.bier_naam} – {r.verpakking_type}{r.sku && <span className="ml-1 font-mono text-xs font-normal text-gray-400 whitespace-nowrap">[{r.sku}]</span>}
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        <span className="text-gray-500 whitespace-nowrap">{t('picking_needed')}: <strong>{r.aantal}×</strong></span>
                        <span className={`whitespace-nowrap ${totaalGepickt >= r.aantal ? 'text-green-600 font-semibold' : 'text-orange-500 font-semibold'}`}>
                          {t('picking_picked')}: {totaalGepickt}×
                        </span>
                        {resterend > 0 && <span className="text-red-500 whitespace-nowrap">{t('picking_remaining')}: {resterend}×</span>}
                      </div>
                    </div>

                    {/* Bestaande picks */}
                    {draftVoorRegel.map((dp: any, idx: number) => {
                      const avItem = (av||[]).find((a: any) => a.id === dp.afvulling_id)
                      const avBatch = avItem ? bat.find((b: any) => b.id === avItem.batch_id) : null
                      const avArt = avItem?.artikel_sku
                        ? (artikelen||[]).find((a: any) => a.artikelnummer === avItem.artikel_sku)
                        : avBatch ? (artikelen||[]).find((a: any) => a.key?.toLowerCase() === `${avBatch.biernaam||avBatch.naam}|||${avItem?.verpakking_type}`.toLowerCase()) : null
                      const maxBeschik = (zonderAgp
                        ? beschikbaarBuitenAgpVoorAfvulling(avItem||{}, selectedOrder.id)
                        : beschikbaarVoorAfvulling(avItem||{}, selectedOrder.id)) + Number(dp.aantal||0)
                      const locLabel = avItem ? voorraadPerLocLabel(avItem) : ''
                      const herkomst = lotEnBatch(avItem)
                      const perLoc = avItem ? beschikbaarPerLocatieVoorAfvulling(avItem, selectedOrder.id) : {}
                      const locOpties = (locaties||[])
                        .filter((l: any) => (perLoc[l.id] || 0) + (dp.bron_locatie_id === l.id ? Number(dp.aantal||0) : 0) > 0)
                        // Binnenland: de AGP-locatie is uitgesloten
                        .filter((l: any) => !zonderAgp || !l.is_agp)
                      return (
                        <div key={idx} className="mt-1 text-sm">
                          {/* Telefoon: de herkomst over de hele breedte, de
                              locatiekeuze en het aantal eronder. */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-full sm:w-auto sm:flex-1 min-w-0 text-gray-600">
                              <span className="font-medium text-gray-800">{avArt?.biernaam || avBatch?.naam}</span>
                              {avArt?.artikelnummer && <span className="font-mono text-xs text-gray-500 ml-1 whitespace-nowrap">[{avArt.artikelnummer}]</span>}
                              {' · '}{avItem?.verpakking_type}
                              {' · '}{t('lbl_tht')}: {avItem?.tht ? fmtD(avItem.tht) : '—'}
                              {/* Eigen regel: de lotcode onder "Lot" (zoals op
                                  de verpakking), het batchnummer onder "Batch". */}
                              {(herkomst.lot || herkomst.batch) && (
                                <span className="block text-xs text-gray-500">
                                  {herkomst.lot && <>{t('picking_lot')} <span className="font-mono text-gray-700">{herkomst.lot}</span></>}
                                  {herkomst.lot && herkomst.batch && ' · '}
                                  {herkomst.batch && <>{t('picking_batch')} {herkomst.batch}</>}
                                </span>
                              )}
                            </span>
                            {(locaties||[]).length > 1 && (
                              <select value={dp.bron_locatie_id ?? ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? undefined : Number(e.target.value)
                                  setDraftPicks(prev => {
                                    const list = [...(prev[r.id]||[])]
                                    list[idx] = {...list[idx], bron_locatie_id: val}
                                    return {...prev, [r.id]: list}
                                  })
                                }}
                                title={t('picking_bron_locatie')}
                                className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white">
                                <option value="">{t('picking_locatie_auto')}</option>
                                {locOpties.map((l: any) => (
                                  <option key={l.id} value={l.id}>
                                    {l.naam} ({perLoc[l.id] || 0}×)
                                  </option>
                                ))}
                              </select>
                            )}
                            <input type="number" min="0" max={maxBeschik}
                              value={dp.aantal}
                              onChange={e => {
                                const val = Math.min(Number(e.target.value)||0, maxBeschik)
                                setDraftPicks(prev => {
                                  const list = [...(prev[r.id]||[])]
                                  list[idx] = {...list[idx], aantal: val}
                                  return {...prev, [r.id]: list}
                                })
                              }}
                              className="w-16 border border-gray-300 rounded px-1 py-0.5 text-sm text-center" />
                            <button type="button" onClick={() => setDraftPicks(prev => {
                              const list = (prev[r.id]||[]).filter((_: any, i: number) => i !== idx)
                              return {...prev, [r.id]: list}
                            })} title={t('btn_delete')} aria-label={t('btn_delete')}
                              className="text-red-400 hover:text-red-600 text-xs">✕</button>
                          </div>
                          {locLabel && <div className="text-xs text-gray-400 ml-1">{t('picking_voorraad_per_locatie')}: {locLabel}</div>}
                        </div>
                      )
                    })}

                    {/* Bier selecteren */}
                    {resterend > 0 && afvullingen.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <select onChange={e => {
                          const avId = Number(e.target.value)
                          if (!avId) return
                          const avAvItem = (av||[]).find((a: any) => a.id === avId)||{}
                          const avail = zonderAgp
                            ? beschikbaarBuitenAgpVoorAfvulling(avAvItem, selectedOrder.id)
                            : beschikbaarVoorAfvulling(avAvItem, selectedOrder.id)
                          const aantal = Math.min(resterend, avail)
                          setDraftPicks(prev => ({
                            ...prev,
                            [r.id]: [...(prev[r.id]||[]), {afvulling_id: avId, aantal}]
                          }))
                          e.target.value = ''
                        }} className="flex-1 min-w-0 w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white" defaultValue="">
                          <option value="">+ {t('picking_afvulling_toevoegen')}</option>
                          {afvullingen.map((a: any) => {
                            const avBatch = bat.find((b: any) => b.id === a.batch_id)
                            const avArt = a.artikel_sku
                              ? (artikelen||[]).find((art: any) => art.artikelnummer === a.artikel_sku)
                              : avBatch ? (artikelen||[]).find((art: any) => art.key === `${avBatch.naam}|||${a.verpakking_type}`) : null
                            const beschik = zonderAgp
                              ? beschikbaarBuitenAgpVoorAfvulling(a, selectedOrder.id)
                              : beschikbaarVoorAfvulling(a, selectedOrder.id)
                            const locLabel = voorraadPerLocLabel(a)
                            const herkomst = lotEnBatch(a)
                            return (
                              <option key={a.id} value={a.id}>
                                {avArt?.biernaam || avBatch?.naam}{avArt?.artikelnummer ? ` [${avArt.artikelnummer}]` : ''} · {a.verpakking_type} · {t('lbl_tht')}: {a.tht ? fmtD(a.tht) : '—'}{herkomst.lot ? ` · ${t('picking_lot')} ${herkomst.lot}` : ''}{herkomst.batch ? ` · ${t('picking_batch')} ${herkomst.batch}` : ''} · {t('picking_x_beschikbaar').replace('{n}', String(beschik))}{locLabel ? ` · ${locLabel}` : ''}
                              </option>
                            )
                          })}
                        </select>
                      </div>
                    )}
                    {/* Te weinig vrij, wel iets in de AGP: eerst uitslaan, dan picken. */}
                    {uitslaanNodig > 0 && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2">
                        <div className="flex-1 text-[11px] text-orange-800">
                          {t('picking_uitslaan_hint').replace('{agp}', String(agpRegel)).replace('{n}', String(uitslaanNodig))}
                        </div>
                        <Btn s="sm" onClick={() => openUitslagVanuit('pick', `${r.bier_naam} \u2014 ${r.verpakking_type}`, allAfvullingen, uitslaanNodig)}>
                          {t('uitslag_knop')}
                        </Btn>
                      </div>
                    )}
                    {resterend > 0 && afvullingen.length === 0 && !alleenInAgp && (
                      <div className="mt-2 text-xs text-red-600">{t('err_no_stock_available').replace('{bier}', r.bier_naam).replace('{verpakking}', r.verpakking_type)}{r.sku ? ` · ${t('wc_veld_sku')}: ${r.sku}` : ''}</div>
                    )}
                    {/* Herkend bier zonder voorraad: wat er in de tank ligt. */}
                    {resterend > 0 && afvullingen.length === 0 && !alleenInAgp && levRegel?.komtEraan[0] && (
                      <KomtEraanRegel k={levRegel.komtEraan[0]} productNaam={productNaamVan(levRegel.productId) || r.bier_naam}
                        vandaag={vandaag} />
                    )}
                    {/* Uitweg voor merch: dit artikel komt niet uit
                        de eigen voorraad, dus picken kan nooit lukken. Eén klik
                        zet de regel om naar een vrije (factuur-)regel én
                        onthoudt het artikel voor volgende imports. Alleen voor
                        een regel die bij géén eigen bier hoort (merchVoorstel). */}
                    {resterend > 0 && afvullingen.length === 0 && !alleenInAgp && gepicktVoorRegel(selectedOrder.id, r.id) === 0 && levRegel?.merchVoorstel && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-2">
                        <div className="flex-1 min-w-[12rem] text-[11px] text-purple-800">
                          <div className="font-semibold">{t('picking_merch_titel')}</div>
                          <div>{t('picking_merch_uitleg')}</div>
                        </div>
                        {/* De bevestiging zit in de knop zelf, geen los venster. */}
                        <BevestigKnop s="sm" v="secondary" vraag={t('picking_merch_vraag')}
                          onBevestig={() => updateRegelType(r.id, true)}>
                          {t('picking_merch_knop')}
                        </BevestigKnop>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {pickFout && (
              <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {pickFout}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowPickModal(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={savePicks}>{t('picking_confirm')}</Btn>
            </div>
          </Modal>
          )
        })()}

        {uitslagModal}

        {/* Markeer verzonden: track & trace + verzendbevestiging meteen mailen */}
        {verzondenModal && (() => {
          const email = resolvedSelectedOrder?.klant_email || selectedOrder.klant_email || ''
          const afhalen = selectedOrder.wc_levering === 'afhalen'
          return (
            <Modal title={t('verzonden_modal_title')} onClose={() => setVerzondenModal(null)}>
              <div className="space-y-3">
                <p className="text-sm text-gray-600">{t('verzonden_modal_intro')}</p>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('verzonden_modal_track')}</label>
                  <Inp value={verzondenModal.tracking} onChange={(v: string) => setVerzondenModal(m => m && ({...m, tracking: v}))} placeholder="https://…" />
                </div>
                {email ? (
                  <label className={`flex items-start gap-2 text-sm rounded px-3 py-2 border ${smtpCreds?.enabled ? 'border-gray-200 bg-gray-50 cursor-pointer' : 'border-orange-200 bg-orange-50 cursor-not-allowed'}`}
                    title={smtpCreds?.enabled ? '' : t('mail_no_smtp')}>
                    <input type="checkbox" className="t-checkbox mt-0.5" checked={verzondenModal.mailen} disabled={!smtpCreds?.enabled}
                      onChange={e => setVerzondenModal(m => m && ({...m, mailen: e.target.checked}))} />
                    <span>
                      <span className="font-medium text-gray-700">{t('verzonden_modal_mailen').replace('{email}', email)}</span>
                      {afhalen && <span className="block text-xs text-gray-500">{t('verzonden_modal_afhaal_hint')}</span>}
                      {!smtpCreds?.enabled && <span className="block text-xs text-orange-700">{t('mail_no_smtp')}</span>}
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-gray-500">{t('verzonden_modal_geen_email')}</p>
                )}
                <div className="flex justify-end gap-2 pt-1 border-t">
                  <Btn v="secondary" onClick={() => setVerzondenModal(null)}>{t('btn_cancel')}</Btn>
                  <Btn onClick={bevestigVerzonden}><Icon n="package" /> {t('order_mark_shipped')}</Btn>
                </div>
              </div>
            </Modal>
          )
        })()}

        {/* Annuleer bevestiging */}
        {showAnnuleerModal && (
          <Modal title={t('order_cancel')} onClose={() => { if (!annuleerBezig) setShowAnnuleerModal(false) }}>
            <div className="space-y-4">
              {/* Wat er met het bier gebeurt: gepickt = terug naar de voorraad;
                  verzonden (of niet automatisch terug te draaien) = blijft
                  als geleverd geboekt. */}
              <p className="text-sm text-gray-600">
                {selectedOrder.status === 'verzonden' && uitgeleverd
                  ? t('msg_order_cancel_confirm_verzonden')
                  : terugdraaiing?.blokkade
                    ? `${blokkadeTekst(terugdraaiing)} ${t('msg_order_cancel_niet_terug')}`
                    : t('msg_order_cancel_confirm')}
              </p>
              {/* Al gefactureerd: annuleren maakt de creditnota. Het geld gaat
                  daarmee niet vanzelf terug — dat gebeurt in de webshop. */}
              {crediteren && (
                <p className="text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  {t('msg_order_cancel_creditnota')
                    .replace('{nummer}', crediteren.factuurnummer || '')
                    .replace('{bedrag}', fmt(Number(crediteren.bruto || 0)))}
                </p>
              )}
              {annuleerFout && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{annuleerFout}</div>
              )}
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowAnnuleerModal(false)} disabled={annuleerBezig}>{t('btn_cancel')}</Btn>
                <Btn v="danger" onClick={annuleerOrder} disabled={annuleerBezig}>
                  {crediteren ? t('order_cancel_bevestig_credit') : t('order_cancel_bevestig')}
                </Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Factuur vooraf: de bestelling is betaald, maar nog niet opgehaald
            of verzonden (utils/orderFactuur.ts). */}
        {showVoorafModal && (
          <Modal title={t('order_factuur_vooraf')} onClose={() => { if (!voorafBezig) setShowVoorafModal(false) }}>
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm">
                <p>{t('order_vooraf_intro')}</p>
                <ul className="mt-2 space-y-1 list-disc list-inside text-xs">
                  <li>{t('order_vooraf_punt_betaald').replace('{datum}', selectedOrder.wc_betaald_datum ? fmtD(selectedOrder.wc_betaald_datum) : '—')}</li>
                  <li>{t('order_vooraf_punt_open')}</li>
                  <li>{t('order_vooraf_punt_regels')}</li>
                </ul>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t('orders_total')}</span>
                <span className="font-semibold">{fmt(totalen.bruto)}</span>
              </div>
              {voorafFout && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{voorafFout}</div>
              )}
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowVoorafModal(false)} disabled={voorafBezig}>{t('btn_cancel')}</Btn>
                <Btn onClick={maakFactuurVooraf} disabled={voorafBezig}>{t('order_factuur_vooraf_bevestig')}</Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Vrije regel modal */}
        {showVrijeRegelModal && (
          <Modal title={t('btn_vrije_regel')} onClose={() => setShowVrijeRegelModal(false)}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('lbl_description')} <span className="text-red-400">*</span></label>
                <Inp value={vrijeRegelForm.omschrijving} onChange={(v: string) => setVrijeRegelForm(f => ({...f, omschrijving: v}))} placeholder={t('ph_vrije_regel')} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('manual_order_qty')}</label>
                  <Inp type="number" value={vrijeRegelForm.aantal} onChange={(v: string) => setVrijeRegelForm(f => ({...f, aantal: v}))} placeholder="1" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('manual_order_price')} (excl.)</label>
                  <Inp type="number" value={vrijeRegelForm.prijs_per_stuk} onChange={(v: string) => setVrijeRegelForm(f => ({...f, prijs_per_stuk: v}))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('manual_order_btw')}%</label>
                  <Inp type="number" value={vrijeRegelForm.btw_pct} onChange={(v: string) => setVrijeRegelForm(f => ({...f, btw_pct: v}))} placeholder="21" />
                </div>
              </div>
              {vrijeRegelFout && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{vrijeRegelFout}</div>
              )}
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Btn v="secondary" onClick={() => setShowVrijeRegelModal(false)}>{t('btn_cancel')}</Btn>
                <Btn onClick={addVrijeRegel}>{t('btn_add')}</Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Verzendkosten modal */}
        {showVerzendkostenModal && (
          <Modal title={t('verzendkosten_modal_title')} onClose={() => setShowVerzendkostenModal(false)}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('lbl_description')}</label>
                <Inp value={verzendkostenForm.naam} onChange={(v: string) => setVerzendkostenForm(f => ({...f, naam: v}))} placeholder={t('lbl_verzendkosten')} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('verzendkosten_prijs')}</label>
                  <Inp type="number" value={verzendkostenForm.prijs_per_stuk} onChange={(v: string) => setVerzendkostenForm(f => ({...f, prijs_per_stuk: v}))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('manual_order_btw')}%</label>
                  <Inp type="number" value={verzendkostenForm.btw_pct} onChange={(v: string) => setVerzendkostenForm(f => ({...f, btw_pct: v}))} placeholder="21" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Btn v="secondary" onClick={() => setShowVerzendkostenModal(false)}>{t('btn_cancel')}</Btn>
                <Btn onClick={confirmVerzendkosten}>{t('btn_add')}</Btn>
              </div>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // --- LIJST VIEW ---
  // Op een telefoon één rij: zoeken en ⋯ (nieuw, importeren, picklijst); op
  // een bureau de knoppen naast de titel. Daaronder de statuschips.
  const lijstActies: RowActie[] = [
    {id: 'nieuw', label: t('orders_new'), onClick: openManualOrder},
    ...(wcCreds?.enabled ? [{id: 'wc_import', label: wcImporting ? t('wc_importing') : t('orders_import_wc'), disabled: wcImporting, onClick: importWcOrders}] : []),
    ...(omTePickenIds.size > 0 ? [{id: 'picklijst', label: `${t('order_print_picklijst')} (${omTePickenIds.size})`, title: t('order_print_picklijst_uitleg'), onClick: printVerzamelPicklijst}] : []),
  ]
  return (
    <div>
      <div className="hidden md:flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('orders_title')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {wcCreds?.enabled && (
            <button onClick={importWcOrders} disabled={wcImporting}
              className="wc-btn flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40">
              {wcImporting ? t('wc_importing') : t('orders_import_wc')}
            </button>
          )}
          {omTePickenIds.size > 0 && (
            <Btn v="secondary" onClick={printVerzamelPicklijst} title={t('order_print_picklijst_uitleg')}>
              <Icon n="printer" /> {t('order_print_picklijst')} ({omTePickenIds.size})
            </Btn>
          )}
          <Btn onClick={openManualOrder}>{t('orders_new')}</Btn>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 min-w-0 md:max-w-md">
          <SearchInput value={zoek} onChange={setZoek} placeholder={t('orders_zoek_ph')} />
        </div>
        <RowActions acties={lijstActies} v="kaart" cls="md:hidden" />
      </div>
      <div className="mb-3">
        <StatusChips waarde={statusFilter} tellingen={tellingen} onKies={setStatusFilter} />
      </div>
      {wcMsg && (
        <div role="status" className={`mb-3 text-sm font-medium ${wcMsg.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>{wcMsg}</div>
      )}
      <PaginaMelding tekst={melding} onSluit={() => setMelding('')} cls="mb-3" />

      {filtered.length === 0 && (
        zoek.trim() ? (
          <LegeStaat icoon="search" titel={t('orders_zoek_geen')} tekst={t('orders_zoek_geen_tekst').replace('{zoek}', zoek.trim())}>
            <Btn v="secondary" onClick={() => setZoek('')}>{t('orders_zoek_wissen')}</Btn>
          </LegeStaat>
        ) : statusFilter !== 'alle' ? (
          <LegeStaat titel={t('msg_no_orders_status').replace('{status}', t(`orders_filter_${statusFilter}`, statusFilter))}>
            {tellingen.alle > 0 && <Btn v="secondary" onClick={() => setStatusFilter('alle')}>{t('orders_filter_alle_tonen')}</Btn>}
          </LegeStaat>
        ) : (
          <LegeStaat titel={t('orders_leeg_titel')}>
            <Btn onClick={openManualOrder}>{t('orders_new')}</Btn>
            {wcCreds?.enabled && (
              <button onClick={importWcOrders} disabled={wcImporting}
                className="wc-btn px-3 py-1.5 min-h-tap sm:min-h-0 rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                {wcImporting ? t('wc_importing') : t('orders_import_wc')}
              </button>
            )}
          </LegeStaat>
        )
      )}

      <div className="space-y-2.5">
        {filtered.map((b: any) => {
          const gepickt = picksVoorOrder(b.id).reduce((s: number, p: any) => s + (Number(p.aantal) || 0), 0)
          // Alleen voor een order die nog gepickt wordt: kan hij geleverd worden?
          const lev = omTePickenIds.has(b.id) ? leverLabel(bestellingLevering(b, verkoopCtx)) : null
          return (
            <BestellingKaart key={b.id} b={b} totaal={totalenVan(b).bruto} klantType={effectiveKlantType(b)}
              gepickt={gepickt} levering={lev} onOpen={() => openOrder(b.id)} />
          )
        })}
      </div>

      {/* Merch-artikelen: wat de brouwerij verkoopt maar niet zelf levert.
          Staat hier omdat de lijst tijdens het orderwerk ontstaat — elke
          "markeer als merch" op een orderregel komt hierin. */}
      {(wcCreds?.enabled || (merchArtikelen||[]).length > 0) && (
        <MerchBeheer
          merchArtikelen={(merchArtikelen || []).filter((m: MerchArtikel) => undo.actie?.id !== `${MERCH_UNDO}${m?.id}`)}
          merchVoorraadLog={merchVoorraadLog || []}
          wcAan={!!wcCreds?.enabled}
          btwOpts={btwOpts}
          stdBtw={stdBtw}
          onWijzig={wijzigMerch}
          onMutatie={openMerchMutatie}
          onWc={(m: MerchArtikel) => setWcMerchModal(m)}
          onVoegToe={({sku, naam}) => setMerchArtikelen((prev: MerchArtikel[]) => onthoudMerch(prev || [], {sku, naam, datum: tod()}))}
          onVerwijder={verwijderMerchArtikel}
        />
      )}

      {/* Merch heeft geen bier erboven: alle themavelden horen hier bij het
          artikel zelf. */}
      {wcMerchModal && (
        <WcProductModal
          sku={wcMerchModal.sku || ''}
          titel={wcMerchModal.naam || wcMerchModal.sku || t('lbl_naamloos')}
          velden={wcMerchModal.wc}
          naamFallback={wcMerchModal.naam || wcMerchModal.sku || ''}
          prijsExcl={wcMerchModal.verkoopprijs}
          btwPct={wcMerchModal.btw_pct ?? stdBtw}
          voorraad={volgtVoorraad(wcMerchModal) ? merchBeschikbaarVoorWc(wcMerchModal, merchGereserveerd(bestellingen, merchArtikelen)) : null}
          prijzenInclBtw={wcCreds?.prijzenInclBtw !== false}
          bierInfo={bierInfoVoorArtikel({artikel: wcMerchModal})}
          themaMeta={wcCreds?.themaVelden === false ? null : crafteryMeta({artikel: wcMerchModal})}
          artikelVelden={bierInvulVelden('artikel')}
          onArtikelVeld={(veld, waarde) => wijzigMerch(wcMerchModal.id, {[veld]: waarde} as any)}
          onOpslaan={(velden: WcVelden) => wijzigMerch(wcMerchModal.id, {wc: velden})}
          onClose={() => setWcMerchModal(null)}
        />
      )}

      {showMerchMutatie && (() => {
        const artikel = (merchArtikelen||[]).find((m: MerchArtikel) => m.id === merchMutatieForm.merch_id)
        if (!artikel) return null
        const reden = merchMutatieForm.reden
        return (
          <Modal title={`${t('merch_mutatie_titel')} — ${merchLabel(artikel)}`} onClose={() => setShowMerchMutatie(false)}>
            <div className="space-y-3">
              <div className="text-sm text-gray-500">
                {t('merch_huidige_voorraad')}: <strong className="text-gray-800">{merchVoorraad(artikel)}×</strong>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('merch_mutatie_reden')}</label>
                <Sel value={reden} onChange={(v: string) => setMerchMutatieForm(f => ({...f, reden: v as MerchMutatie['reden']}))}
                  opts={(['inkoop', 'verkoop', 'retour', 'correctie', 'telling'] as const)
                    .map(r => ({v: r, l: t(`merch_reden_${r}`)}))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  {reden === 'telling' ? t('merch_getelde_stand') : t('manual_order_qty')}
                </label>
                <Inp type="number" value={merchMutatieForm.aantal}
                  onChange={(v: string) => setMerchMutatieForm(f => ({...f, aantal: v}))} placeholder="0" />
                <p className="text-xs text-gray-400 mt-1">
                  {reden === 'telling' ? t('merch_hint_telling') : reden === 'correctie' ? t('merch_hint_correctie') : t('merch_hint_mutatie')}
                </p>
              </div>
              {reden === 'inkoop' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('merch_inkoopprijs')}</label>
                  <Inp type="number" value={merchMutatieForm.prijs}
                    onChange={(v: string) => setMerchMutatieForm(f => ({...f, prijs: v}))} placeholder="0.00" />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('lbl_opmerking')}</label>
                <Inp value={merchMutatieForm.notitie}
                  onChange={(v: string) => setMerchMutatieForm(f => ({...f, notitie: v}))} placeholder={t('ph_merch_notitie')} />
              </div>
              {merchMutatieFout && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{merchMutatieFout}</div>
              )}
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Btn v="secondary" onClick={() => setShowMerchMutatie(false)}>{t('btn_cancel')}</Btn>
                <Btn onClick={bewaarMerchMutatie}>{t('btn_save')}</Btn>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Handmatige order modal */}
      {showManualModal && (
        <Modal title={t('manual_order_title')} onClose={() => { if (!manualOpslaanBezig) setShowManualModal(false) }} wide>
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Klantgegevens */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">{t('orders_klant')}</div>
              {/* Klant-type toggle: privé vs. zakelijk */}
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">{t('lbl_klant_type')}</label>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                  <button type="button"
                    onClick={() => setManualForm((f: any) => ({...f, klant_type: 'prive'}))}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${manualForm.klant_type === 'prive' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                    {t('lbl_prive')}
                  </button>
                  <button type="button"
                    onClick={() => setManualForm((f: any) => ({...f, klant_type: 'zakelijk'}))}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${manualForm.klant_type === 'zakelijk' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                    {t('lbl_zakelijk')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Inp label={t('manual_order_klant_naam') + ' *'} value={manualForm.klant_naam} onChange={handleManualNaamChange} placeholder="Jan Janssen" list="manual-order-klanten" />
                <datalist id="manual-order-klanten">
                  {[...(klanten||[])].sort((a: any, b: any) => (a.naam||'').localeCompare(b.naam||'')).map((k: any) => (
                    <option key={k.id} value={k.naam} />
                  ))}
                </datalist>
                <Inp label={t('manual_order_klant_email')} value={manualForm.klant_email} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_email: v}))} placeholder="jan@example.nl" />
              </div>
              {(() => {
                const k = klantVoorManualForm()
                const pct = Number(k?.korting_pct || 0)
                return pct > 0 ? (
                  <div className="mt-1.5 text-xs text-green-600">
                    ✓ {t('msg_klantkorting_toegepast').replace('{pct}', String(pct))}
                  </div>
                ) : null
              })()}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Inp label={t('lbl_company') + (manualForm.klant_type === 'zakelijk' ? ' *' : '')} value={manualForm.klant_bedrijf} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_bedrijf: v}))} placeholder={t('lbl_company')} />
                <Inp label={t('lbl_address')} value={manualForm.klant_straat} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_straat: v}))} placeholder="Hoofdstraat 1" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Inp label={t('settings_postcode')} value={manualForm.klant_postcode} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_postcode: v}))} placeholder="1234 AB" />
                <Inp label={t('settings_city')} value={manualForm.klant_stad} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_stad: v}))} placeholder="Amsterdam" />
              </div>
            </div>

            {/* Regels */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">{t('orders_lines')}</div>
              <div className="text-xs text-gray-500 mb-2">{t('info_verkoop_vrije_voorraad')}</div>
              {manualForm.regels.length > 0 && (
                <div className="mb-3 divide-y divide-gray-100 border rounded-lg overflow-hidden">
                  {manualForm.regels.map((r: any, idx: number) => {
                    // Meer besteld dan er vrij ligt, maar wel in de AGP: nu al
                    // uitslaan kan, dan is de order meteen te picken.
                    const somBesteld = manualForm.regels
                      .filter((x: any) => x.type === 'bier' && x.bier_naam === r.bier_naam && x.verpakking_type === r.verpakking_type)
                      .reduce((sum: number, x: any) => sum + Number(x.aantal || 0), 0)
                    const vr = r.type === 'bier' ? voorraadVoorKeuze(r.bier_naam, r.verpakking_type) : null
                    const nUit = vr ? uitTeSlaan(somBesteld, vr.vrij, vr.agp) : 0
                    return (
                    <div key={idx} className="px-3 py-2 text-sm bg-gray-50">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-medium">{r.bier_naam} – {r.verpakking_type}</span>
                      {r.prijsType === 'b2b' && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">B2B</span>}
                      <span className="text-gray-500">{r.aantal}× à {fmt(r.prijs_per_stuk)}</span>
                      <span className="text-gray-400">{r.btw_pct}% BTW</span>
                      <button onClick={() => setManualForm((f: any) => ({...f, regels: f.regels.filter((_: any, i: number) => i !== idx)}))}
                        className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </div>
                    {vr && nUit > 0 && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-orange-800">
                        <span className="flex-1">{t('manual_order_uitslaan_hint').replace('{vrij}', String(vr.vrij)).replace('{agp}', String(vr.agp))}</span>
                        <Btn s="sm" v="secondary" onClick={() => openUitslagVanuit('manual', `${r.bier_naam} \u2014 ${r.verpakking_type}`, vr.afvs, nUit)}>
                          {t('uitslag_knop')}
                        </Btn>
                      </div>
                    )}
                    </div>
                    )
                  })}
                </div>
              )}

              {/* Nieuwe regel toevoegen */}
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-gray-600">{t('manual_order_add_line')}</div>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button type="button" onClick={() => {
                      const art = artikelVoorKeuze(regelForm.bier_naam, regelForm.verpakking_type);
                      const prijs = art ? String(art.verkoopprijs||'') : regelForm.prijs_per_stuk;
                      setRegelForm((f: any) => ({...f, prijsType: 'normaal', prijs_per_stuk: prijs}));
                    }}
                      className={`px-2.5 py-0.5 text-[11px] font-medium rounded-md transition-colors ${regelForm.prijsType !== 'b2b' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                      {t('lbl_prijs_normaal')}
                    </button>
                    <button type="button" onClick={() => {
                      const art = artikelVoorKeuze(regelForm.bier_naam, regelForm.verpakking_type);
                      const prijs = art && art.b2b_prijs ? String(art.b2b_prijs) : regelForm.prijs_per_stuk;
                      setRegelForm((f: any) => ({...f, prijsType: 'b2b', prijs_per_stuk: prijs}));
                    }}
                      className={`px-2.5 py-0.5 text-[11px] font-medium rounded-md transition-colors ${regelForm.prijsType === 'b2b' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                      B2B
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{t('manual_order_beer')} *</label>
                    <select value={regelForm.bier_naam}
                      onChange={e => {
                        const bier = e.target.value
                        const art = artikelVoorKeuze(bier, regelForm.verpakking_type)
                        const prijs = art ? (regelForm.prijsType === 'b2b' && art.b2b_prijs ? String(art.b2b_prijs) : String(art.verkoopprijs||'')) : ''
                        setRegelForm((f: any) => ({...f, bier_naam: bier, verpakking_type: '',
                          prijs_per_stuk: prijs,
                          btw_pct: String(artikelBtwPct(art, stdBtw))}))
                      }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                      <option value="">{t('opt_select_beer')}</option>
                      {beschikbareBieren.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{t('manual_order_packaging')} *</label>
                    <select value={regelForm.verpakking_type}
                      onChange={e => {
                        const vp = e.target.value
                        const art = artikelVoorKeuze(regelForm.bier_naam, vp)
                        const prijs = art ? (regelForm.prijsType === 'b2b' && art.b2b_prijs ? String(art.b2b_prijs) : String(art.verkoopprijs||'')) : ''
                        setRegelForm((f: any) => ({...f, verpakking_type: vp,
                          prijs_per_stuk: prijs,
                          btw_pct: String(artikelBtwPct(art, stdBtw))}))
                      }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                      <option value="">{t('opt_select_packaging')}</option>
                      {verpakkingVoorBier(regelForm.bier_naam).map((v: string) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                {regelForm.bier_naam && regelForm.verpakking_type && (() => {
                  // Wat er te verkopen is (vrij) en wat nog in de AGP ligt —
                  // uitslaan is een aparte stap die vóór de verkoop komt.
                  const vr = voorraadVoorKeuze(regelForm.bier_naam, regelForm.verpakking_type)
                  const alInOrder = manualForm.regels
                    .filter((x: any) => x.type === 'bier' && x.bier_naam === regelForm.bier_naam && x.verpakking_type === regelForm.verpakking_type)
                    .reduce((sum: number, x: any) => sum + Number(x.aantal || 0), 0)
                  const nUit = uitTeSlaan(alInOrder + Number(regelForm.aantal || 0), vr.vrij, vr.agp)
                  return (
                    <div className={`flex items-center gap-2 text-xs ${nUit > 0 ? 'text-orange-800' : 'text-gray-500'}`}>
                      <span className="flex-1">
                        {t('manual_order_voorraad').replace('{vrij}', String(vr.vrij))}
                        {vr.agp > 0 && ` · ${t('pos_agp_info').replace('{n}', String(vr.agp))}`}
                      </span>
                      {vr.agp > 0 && (
                        <Btn s="sm" v="secondary" onClick={() => openUitslagVanuit('manual', `${regelForm.bier_naam} \u2014 ${regelForm.verpakking_type}`, vr.afvs, nUit || Math.min(vr.agp, Number(regelForm.aantal || 0)) || 0)}>
                          {t('uitslag_knop')}
                        </Btn>
                      )}
                    </div>
                  )
                })()}
                <div className="grid grid-cols-3 gap-2">
                  <Inp label={t('manual_order_qty') + ' *'} type="number" value={regelForm.aantal} onChange={(v: string) => setRegelForm((f: any) => ({...f, aantal: v}))} placeholder="1" />
                  <Inp label={t('manual_order_price')} type="number" value={regelForm.prijs_per_stuk} onChange={(v: string) => setRegelForm((f: any) => ({...f, prijs_per_stuk: v}))} placeholder="0.00" />
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{t('manual_order_btw')}</label>
                    <Sel value={regelForm.btw_pct} onChange={(v: string) => setRegelForm((f: any) => ({...f, btw_pct: v}))}
                      opts={[{v:'0',l:'0%'},{v:'9',l:'9%'},{v:'21',l:'21%'}]} />
                  </div>
                </div>
                <Btn s="sm" onClick={addRegel}>{t('manual_order_add_line')}</Btn>
              </div>
            </div>

            {/* Verzendkosten */}
            <div className="border rounded-lg p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={manualVerzending.enabled}
                  onChange={e => setManualVerzending(f => ({...f, enabled: e.target.checked}))}
                  className="t-checkbox" />
                <span className="text-xs font-semibold text-gray-500">{t('lbl_verzendkosten')}</span>
              </label>
              {manualVerzending.enabled && (
                <div className="grid grid-cols-3 gap-2">
                  <Inp label={t('lbl_description')} value={manualVerzending.naam} onChange={(v: string) => setManualVerzending(f => ({...f, naam: v}))} placeholder={t('lbl_verzendkosten')} />
                  <Inp label={t('verzendkosten_prijs')} type="number" value={manualVerzending.prijs} onChange={(v: string) => setManualVerzending(f => ({...f, prijs: v}))} placeholder="0.00" />
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">{t('manual_order_btw')}%</label>
                    <Sel value={manualVerzending.btw_pct} onChange={(v: string) => setManualVerzending(f => ({...f, btw_pct: v}))}
                      opts={[{v:'0',l:'0%'},{v:'9',l:'9%'},{v:'21',l:'21%'}]} />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-0.5">{t('lbl_opmerkingen')}</label>
              <textarea value={manualForm.opmerkingen} onChange={e => setManualForm((f: any) => ({...f, opmerkingen: e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" rows={2} placeholder={t('ph_optionele_opmerkingen')} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
            <Btn v="secondary" onClick={() => setShowManualModal(false)} disabled={manualOpslaanBezig}>{t('btn_cancel')}</Btn>
            <Btn onClick={saveManualOrder} disabled={manualOpslaanBezig}>{manualOpslaanBezig ? t('lbl_bezig') : t('btn_save')}</Btn>
          </div>
        </Modal>
      )}

      {uitslagModal}
    </div>
  )
}

export default BestellingenPage
