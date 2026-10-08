import React, { useState, useMemo, useEffect, useRef } from 'react'
import { t } from '../i18n'
import { newId, volgendFactuurNummer } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { getAgpLocatie, accijnsMaandGesloten } from '../utils/calculations'
import {
  agpGereserveerdPerAfvulling, kassaBonTotalen, kassaBonWeergave, kassaKlantZakelijk,
  kassaStandaardInclBtw, kassaStuksprijs,
} from '../utils/kassa'
import type { KassaBonKorting } from '../utils/kassa'
import {
  kassaCatalogus, kassaZichtbaar, kassaAllocatie, kassaKeuzeVoorRegel,
} from '../utils/kassaCatalogus'
import type { KassaCtx, KassaKeuze } from '../utils/kassaCatalogus'
import { bouwUitslagBoekingen, uitslagDatumFout, laatsteAfvulDatum, VERPLAATS_FOUT_KEYS } from '../utils/agp'
import { bouwVerkoopUitleveringen } from '../utils/uitlevering'
import UitslagModal from '../components/UitslagModal'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import LegeStaat from '../components/ui/LegeStaat'
import { useMediaQuery } from '../components/ui/useSmalScherm'
import KassaTegels from '../components/kassa/KassaTegels'
import KassaBon from '../components/kassa/KassaBon'
import type { BonRegel } from '../components/kassa/KassaBon'
import KassaKlant from '../components/kassa/KassaKlant'
import type { KassaKlantStats, KassaVorigeAankoop } from '../components/kassa/KassaKlant'
import KassaBonbalk, { BONBALK_RUIMTE } from '../components/kassa/KassaBonbalk'
import KassaVenster from '../components/kassa/KassaVenster'
import KassaBetaalwijze from '../components/kassa/KassaBetaalwijze'
import type { Betaalwijze } from '../components/kassa/KassaBetaalwijze'
import KassaInclSchakelaar from '../components/kassa/KassaInclSchakelaar'
import KassaMelding from '../components/kassa/KassaMelding'
import { printFactuur } from '../components/PakbonExport'
import { logAudit } from '../utils/audit'
import { resolveKlantSnapshot, nextKlantnummer } from '../utils/klant'
import { breweryMetTermijn } from '../utils/facturen'
import { verkoopFactuurBoeking, voegBoekingToe } from '../utils/journaal'
import {
  MerchArtikel, MerchMutatie,
  boekMerchMutaties, merchAfboekingenVoorRegels,
} from '../utils/merch'
import { totaliseerRegels } from '../utils/centen'
import { standaardBtwPct } from '../utils/btw'
import type { GaNaar } from '../utils/route'

interface KassaPageProps {
  bat: any[]
  av: any[]
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  artikelen: any[]
  verpakkingen?: any[]
  producten?: any[]
  productArtikelen?: any[]
  bestellingen: any[]
  setBestellingen: any
  bestellingPicks: any[]
  setBestellingPicks: any
  verkoopFacturen: any[]
  setVerkoopFacturen: any
  accijnsInst?: any
  breweryDetails?: any
  appName?: string
  factuurLogo?: string | null
  factuurCounter?: any
  setFactuurCounter?: any
  log?: any[]
  setLog?: any
  klanten: any[]
  setKlanten?: any
  locaties?: any[]
  verplaatsingen?: any[]
  setVerplaatsingen?: any
  afboekingen?: any[]
  accijnsAangiftes?: any[]
  auditLog?: any[]
  setAuditLog?: any
  setJournaal?: any
  btwInst?: any
  btwTarieven?: Array<number | string>
  merchArtikelen?: MerchArtikel[]
  setMerchArtikelen?: any
  merchVoorraadLog?: MerchMutatie[]
  setMerchVoorraadLog?: any
  /** Navigatie van de schil (App.tsx): de lege kassa verwijst naar Producten. */
  gaNaar?: GaNaar
}

/** De vensters van de kassa. Er staat er hooguit één open — een stapel, zodat
 * je vanuit het onderblad Bon naar de klant of een korting gaat en daarna op
 * de bon terugkomt (twee panelen tegelijk zouden om de focus vechten). */
type Venster = 'bon' | 'klant' | 'afrekenen' | 'nieuweKlant' | 'korting' | 'vrijeRegel' | 'klantKorting'

const rnd2 = (n: number) => Math.round(n * 100) / 100

/** Onder `lg` staat de bon niet naast de catalogus maar in een vaste balk met
 * een onderblad — op de telefoon, en ook op een tablet aan de toonbank. */
const KASSA_SMAL = '(max-width: 1023.98px)'

const KassaPage: React.FC<KassaPageProps> = ({
  bat, av, uit, setUit, acc, setAcc,
  artikelen, verpakkingen = [], producten = [], productArtikelen = [],
  bestellingen, setBestellingen,
  bestellingPicks, setBestellingPicks,
  verkoopFacturen, setVerkoopFacturen,
  accijnsInst, breweryDetails, appName = '', factuurLogo = null,
  log = [], setLog = () => {},
  klanten = [], setKlanten = () => {},
  locaties = [], verplaatsingen = [], setVerplaatsingen = () => {}, afboekingen = [],
  accijnsAangiftes = [],
  auditLog = [], setAuditLog = () => {},
  setJournaal = () => {},
  btwInst = {}, btwTarieven = [0, 9, 21],
  merchArtikelen = [], setMerchArtikelen = () => {},
  merchVoorraadLog = [], setMerchVoorraadLog = () => {},
  gaNaar,
}) => {
  // Standaard BTW-tarief uit de instellingen (21% tenzij anders ingesteld)
  const stdBtw = standaardBtwPct(btwInst, btwTarieven)
  const smal = useMediaQuery(KASSA_SMAL)
  const [cart, setCart] = useState<BonRegel[]>([])
  const [selectedKlantId, setSelectedKlantId] = useState<number | null>(null)
  const [klantZoek, setKlantZoek] = useState('')
  const [productZoek, setProductZoek] = useState('')
  // Prijsweergave: null = de standaard van de klant (particulier incl. BTW,
  // zakelijk excl.); de schakelaar zet hem voor deze klant om.
  const [inclKeuze, setInclKeuze] = useState<boolean | null>(null)
  // Uitverkochte keuzes staan standaard verborgen — anders vervuilt de kassa
  // met bier dat toch niet verkocht kan worden.
  const [toonUitverkocht, setToonUitverkocht] = useState(false)
  const [vensters, setVensters] = useState<Venster[]>([])
  const [betaalwijze, setBetaalwijze] = useState<Betaalwijze>('pin')
  const [nieuweKlantForm, setNieuweKlantForm] = useState({naam: '', klant_type: 'prive', email: '', telefoon: ''})
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw)})
  // Handmatige korting op de hele bon: vast bedrag (incl. BTW) of percentage.
  const [bonKorting, setBonKorting] = useState<KassaBonKorting | null>(null)
  const [kortingForm, setKortingForm] = useState({soort: 'bedrag', waarde: ''})
  // Klantkorting voor alleen deze bon (null = het standaardpercentage van de
  // klantkaart). De klantkaart zelf blijft ongewijzigd.
  const [klantKortingBon, setKlantKortingBon] = useState<number | null>(null)
  const [klantKortingWaarde, setKlantKortingWaarde] = useState('')
  // Laatste afgeronde verkoop voor het succes-scherm (factuur printen)
  const [laatsteVerkoop, setLaatsteVerkoop] = useState<{bestelling: any, factuur: any} | null>(null)
  // Meldingen in plaats van alert(): een fout in een formulier staat in dat
  // venster, een fout bij afrekenen bij de afrekenknop, de rest in een pil.
  const [formFout, setFormFout] = useState('')
  const [afrekenFout, setAfrekenFout] = useState('')
  const [melding, setMelding] = useState<string | null>(null)

  const venster: Venster | null = vensters.length ? vensters[vensters.length - 1] : null
  const openVenster = (v: Venster) => { setFormFout(''); setVensters(s => [...s.filter(x => x !== v), v]) }
  const sluitVenster = () => { setFormFout(''); setVensters(s => s.slice(0, -1)) }
  // Bon en klant zijn panelen van de telefoonindeling; afrekenen is daar deel
  // van de bon. Wisselt de indeling (tablet draaien), dan schuift dat mee.
  useEffect(() => {
    setVensters(s => {
      const n = smal
        ? s.map(v => (v === 'afrekenen' ? 'bon' : v)).filter((v, i, a) => a.indexOf(v) === i)
        : s.filter(v => v !== 'bon' && v !== 'klant')
      return n.length === s.length && n.every((v, i) => v === s[i]) ? s : n
    })
  }, [smal])

  const selectedKlant = selectedKlantId != null ? (klanten || []).find((k: any) => k.id === selectedKlantId) : null
  // Zakelijk bepaalt alleen de prijs (B2B) en de standaardweergave. De
  // voorraad is voor elke klant dezelfde: de kassa verkoopt uitsluitend uit
  // vrije voorraad buiten de AGP — uitslaan is een aparte stap (utils/agp.ts).
  const isZakelijk = kassaKlantZakelijk(selectedKlant)
  const toonInclBtw = inclKeuze ?? kassaStandaardInclBtw(selectedKlant)

  // ── Catalogus: één tegel per product, de verpakkingen als keuzes ─────────────
  // Eén voorraadtelling met Overzicht, Producten en Bestellingen
  // (`voorraadPerProduct`): per verpakking vrij na open picks en na de zachte
  // reservering van open bestellingen; de AGP apart. De boeking kiest uit
  // dezelfde lots als de tegel telt (`kassaAllocatie`).
  const merchLabel = t('orders_regel_merch')
  const kassaCtx = useMemo<KassaCtx>(() => ({
    producten, productArtikelen, artikelen, merchArtikelen, verpakkingen,
    batches: bat, afvullingen: av, uitleveringen: uit, verplaatsingen, afboekingen, locaties,
    bestellingen, bestellingPicks,
  }), [producten, productArtikelen, artikelen, merchArtikelen, verpakkingen, bat, av, uit, verplaatsingen, afboekingen, locaties, bestellingen, bestellingPicks])
  const catalogus = useMemo(
    () => kassaCatalogus(kassaCtx, {standaardBtw: stdBtw, merchLabel}),
    [kassaCtx, stdBtw, merchLabel])
  const keuzes = useMemo(() => catalogus.flatMap(tg => tg.keuzes), [catalogus])
  const keuzeVoorKey = useMemo(() => new Map(keuzes.map(k => [k.key, k])), [keuzes])
  const zichtbaar = useMemo(
    () => kassaZichtbaar(catalogus, productZoek, toonUitverkocht),
    [catalogus, productZoek, toonUitverkocht])

  // ── Uitslaan uit de AGP vanaf de kassa ─────────────────────────────────────
  // Uitslaan en verkopen zijn twee stappen: bier verlaat eerst de AGP (hier
  // ontstaat de accijns) en wordt daarna uit vrije voorraad verkocht. De kassa
  // verkoopt nooit uit de AGP; de tegel biedt alleen de link om ter plekke uit
  // te slaan, met exact dezelfde boeking — `bouwUitslagBoekingen` uit
  // `utils/agp.ts`.
  const [uitslagKeuze, setUitslagKeuze] = useState<KassaKeuze | null>(null)

  const openUitslag = (k: KassaKeuze) => {
    // Periode-lock (ERP-plan 0.4): een uitslag boekt accijns op vandaag; dat
    // mag niet meer wanneer die aangifte al is ingediend of betaald.
    if (accijnsMaandGesloten(tod(), accijnsAangiftes || [])) {
      setMelding(t('err_accijns_maand_gesloten_boeking')); return
    }
    if (!(locaties || []).some((l: any) => !l.is_agp)) {
      setMelding(t('pos_uitslag_geen_locatie')); return
    }
    setMelding(null)
    setUitslagKeuze(k)
  }

  // De modal heeft de afvullingen al gekozen (oudste THT eerst); hier worden ze
  // in één keer geboekt: verplaatsing + accijnsrecord + voorraadlogregel.
  const saveUitslag = ({allocaties, naar_locatie_id, datum, opmerking}: any) => {
    // De modal kan een andere datum dan vandaag kiezen: die datum wordt de
    // accijnsdatum, dus daar geldt de periode-lock (tweede slot naast de modal).
    const datumFout = uitslagDatumFout(datum, allocaties, {accijnsAangiftes: accijnsAangiftes || []})
    if (datumFout) {
      setMelding(t(VERPLAATS_FOUT_KEYS[datumFout]).replace('{datum}', fmtD(laatsteAfvulDatum(allocaties)))); return
    }
    const naar = (locaties || []).find((l: any) => l.id === naar_locatie_id)
    // newId() loopt globaal monotoon op, dus ook binnen de lus in
    // bouwUitslagBoekingen — waar de vorige records nog niet in de state
    // staan — blijven de ids uniek.
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
      omschrijving: `${t('pos_uitslag_audit')}: ${r.totaal}× ${uitslagKeuze?.bier_naam || ''} (${uitslagKeuze?.verpakking_type || ''}) → ${naar?.naam || ''}${r.totaalAccijns ? ` (accijns ${fmt(r.totaalAccijns)})` : ''}`,
    })
    setMelding(null)
    setUitslagKeuze(null)
  }

  // De afvullingen achter de uitslaglink: de lots van díe verpakking.
  const avPerId = useMemo(() => new Map((av || []).map((a: any) => [a.id, a])), [av])
  const uitslagAfvullingen = uitslagKeuze
    ? uitslagKeuze.lots.map(l => avPerId.get(l.afvullingId)).filter(Boolean)
    : []

  // ── Klantstatistieken: terugkerende klanten snel in beeld ───────────────────

  const klantStats = useMemo(() => {
    const stats: Record<number, KassaKlantStats> = {}
    const bump = (id: number, datum: string) => {
      if (!stats[id]) stats[id] = {count: 0, last: '', openstaand: 0}
      stats[id].count++
      if (String(datum || '') > stats[id].last) stats[id].last = String(datum || '')
    }
    for (const f of (verkoopFacturen || [])) {
      const live = resolveKlantSnapshot(f, klanten)
      if (live.klant_id == null) continue
      bump(live.klant_id, f.datum)
      const openStatussen = ['open', 'herinnering', 'tweede_herinnering', 'aanmaning']
      if (openStatussen.includes(f.status)) {
        stats[live.klant_id].openstaand += Number(f.bruto || 0)
      }
    }
    for (const b of (bestellingen || [])) {
      // Alleen bestellingen zonder factuur meetellen; gefactureerde zitten al in
      // de facturenlus hierboven (voorkomt dubbeltelling van dezelfde aankoop).
      if (b.factuur_id != null || b.status === 'geannuleerd') continue
      const live = resolveKlantSnapshot(b, klanten)
      if (live.klant_id == null) continue
      bump(live.klant_id, b.datum)
    }
    return stats
  }, [verkoopFacturen, bestellingen, klanten])

  const recenteKlanten = useMemo(() =>
    (klanten || [])
      .filter((k: any) => klantStats[k.id])
      .sort((a: any, b: any) => (klantStats[b.id]?.last || '').localeCompare(klantStats[a.id]?.last || ''))
      .slice(0, 6)
  , [klanten, klantStats])

  const klantZoekResultaten = useMemo(() => {
    const q = klantZoek.trim().toLowerCase()
    if (!q) return []
    return (klanten || []).filter((k: any) =>
      `${k.naam || ''} ${k.bedrijf || ''} ${k.klantnummer || ''} ${k.email || ''}`.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [klanten, klantZoek])

  // Eerdere aankopen van de geselecteerde klant, gekoppeld aan de keuzes van
  // de catalogus zodat een terugkerende klant zijn vaste bestelling met één
  // tik herhaalt.
  const vorigeAankopen = useMemo((): KassaVorigeAankoop[] => {
    if (!selectedKlant) return []
    const telling = new Map<string, KassaVorigeAankoop & {last: string}>()
    for (const b of (bestellingen || [])) {
      if (b.status === 'geannuleerd') continue
      const live = resolveKlantSnapshot(b, klanten)
      if (live.klant_id !== selectedKlant.id) continue
      for (const r of (b.regels || [])) {
        const keuze = kassaKeuzeVoorRegel(keuzes, r)
        if (!keuze) continue
        const v = telling.get(keuze.key) || {key: keuze.key, keuze, count: 0, last: ''}
        v.count += Number(r.aantal || 0)
        if (String(b.datum || '') > v.last) v.last = String(b.datum || '')
        telling.set(keuze.key, v)
      }
    }
    return [...telling.values()]
      .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
      .slice(0, 6)
  }, [selectedKlant, bestellingen, klanten, keuzes])

  // ── Bon-bewerkingen ──────────────────────────────────────────────────────────

  const prijsVoorKeuze = (k: KassaKeuze): {prijs: number, prijsType: 'normaal' | 'b2b'} => {
    if (isZakelijk && k.b2bPrijs != null) return {prijs: k.b2bPrijs, prijsType: 'b2b'}
    return {prijs: k.prijs ?? 0, prijsType: 'normaal'}
  }

  // Wat de tegel toont: dezelfde prijs als op de bon komt, incl. of excl. BTW.
  const toonPrijs = (k: KassaKeuze): {bedrag: number | null, b2b: boolean} => {
    const {prijs, prijsType} = prijsVoorKeuze(k)
    const heeftPrijs = k.prijs != null || prijsType === 'b2b'
    return {bedrag: heeftPrijs ? kassaStuksprijs(prijs, k.btw_pct, toonInclBtw) : null, b2b: prijsType === 'b2b'}
  }

  // Merch blokkeert niet op nul: het shirt ligt fysiek op de toonbank, ook als
  // de teller achterloopt. De stand mag negatief worden en valt dan rood op in
  // de merch-lijst — dat is het signaal om te tellen of een inkoop te boeken.
  const maxVoorKeuze = (k: KassaKeuze): number =>
    k.merch ? Infinity : k.verkoopbaar

  const opBon = (key: string): number => cart.find(r => r.key === key)?.aantal || 0

  const addToCart = (k: KassaKeuze, aantal = 1) => {
    setLaatsteVerkoop(null)
    const max = maxVoorKeuze(k)
    const huidig = cart.find(r => r.key === k.key && r.type === (k.merch ? 'vrij' : 'bier'))?.aantal || 0
    if (huidig >= max) {
      setMelding(t('err_pos_voorraad')
        .replace('{product}', `${k.bier_naam} ${k.label}`)
        .replace('{beschikbaar}', String(max)))
      return
    }
    setMelding(null)
    setCart(prev => {
      const bestaand = prev.find(r => r.key === k.key && r.type === (k.merch ? 'vrij' : 'bier'))
      const nu = bestaand ? bestaand.aantal : 0
      const nieuw = Math.min(nu + aantal, max)
      if (nieuw <= nu) return prev
      if (bestaand) return prev.map(r => r === bestaand ? {...r, aantal: nieuw} : r)
      const {prijs, prijsType} = prijsVoorKeuze(k)
      return [...prev, {
        key: k.key,
        type: k.merch ? 'vrij' : 'bier',
        bier_naam: k.bier_naam,
        verpakking_type: k.verpakking_type,
        aantal: nieuw,
        prijs_per_stuk: prijs,
        btw_pct: k.btw_pct,
        omschrijving: k.merch ? k.bier_naam : `${k.bier_naam} – ${k.verpakking_type}`,
        artikel_id: k.artikel_id,
        artikel_key: k.artikel_key,
        sku: k.sku,
        prijsType,
        ...(k.merch ? {merch_id: k.merch_id} : {}),
      }]
    })
  }

  const kanMeer = (idx: number): boolean => {
    const r = cart[idx]
    if (!r) return false
    const k = r.type === 'bier' ? keuzeVoorKey.get(r.key) : null
    return !k || r.aantal < maxVoorKeuze(k)
  }

  const wijzigAantal = (idx: number, delta: number) => {
    setCart(prev => {
      const r = prev[idx]
      if (!r) return prev
      const k = keuzeVoorKey.get(r.key)
      const max = r.type === 'bier' && k ? maxVoorKeuze(k) : Infinity
      const nieuw = Math.min(Math.max(0, r.aantal + delta), max)
      if (nieuw === 0) return prev.filter((_, i) => i !== idx)
      return prev.map((x, i) => i === idx ? {...x, aantal: nieuw} : x)
    })
  }

  // Lege bon: eventuele bonkorting hoort niet stilletjes mee te gaan naar de
  // volgende verkoop.
  useEffect(() => {
    if (cart.length === 0) { setBonKorting(null); setKlantKortingBon(null) }
  }, [cart.length])

  // Klantwissel: herprijs bierregels (normaal ↔ B2B); de prijsweergave volgt
  // de nieuwe klant (particulier incl., zakelijk excl. BTW).
  const selectKlant = (id: number | null) => {
    setSelectedKlantId(id)
    setKlantKortingBon(null)
    setKlantZoek('')
    setLaatsteVerkoop(null)
    setInclKeuze(null)
    setAfrekenFout('')
    const k = id != null ? (klanten || []).find((x: any) => x.id === id) : null
    const zakelijk = kassaKlantZakelijk(k)
    setCart(prev => prev.map(r => {
      if (r.type !== 'bier') return r
      const keuze = keuzeVoorKey.get(r.key)
      if (!keuze) return r
      const b2b = zakelijk && keuze.b2bPrijs != null
      return {...r, prijs_per_stuk: b2b ? keuze.b2bPrijs! : (keuze.prijs ?? 0), prijsType: b2b ? 'b2b' : 'normaal'}
    }))
  }

  const addVrijeRegel = () => {
    const oms = vrijeRegelForm.omschrijving.trim()
    if (!oms) { setFormFout(t('err_vrije_regel_omschrijving')); return }
    setLaatsteVerkoop(null)
    setCart(prev => [...prev, {
      key: `vrij-${Date.now()}`,
      type: 'vrij',
      bier_naam: oms,
      verpakking_type: '',
      aantal: Number(vrijeRegelForm.aantal) || 1,
      prijs_per_stuk: Number(vrijeRegelForm.prijs_per_stuk) || 0,
      btw_pct: Number(vrijeRegelForm.btw_pct) || 0,
      omschrijving: oms,
    }])
    setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: String(stdBtw)})
    sluitVenster()
  }

  const addKorting = () => {
    const waarde = Number(kortingForm.waarde)
    if (!(waarde > 0) || (kortingForm.soort === 'pct' && waarde > 100)) {
      setFormFout(t('err_pos_korting_waarde'))
      return
    }
    setBonKorting({soort: kortingForm.soort as 'bedrag' | 'pct', waarde})
    setKortingForm({soort: 'bedrag', waarde: ''})
    sluitVenster()
  }

  // ── Totalen (incl. klantkorting en statiegeld, zoals de orderflow) ──────────

  const standaardKortingPct = Number(selectedKlant?.korting_pct || 0)
  const kortingPct = klantKortingBon ?? standaardKortingPct

  const openKlantKorting = () => { setKlantKortingWaarde(String(kortingPct)); openVenster('klantKorting') }
  const pasKlantKortingToe = () => {
    const waarde = Number(String(klantKortingWaarde ?? '').replace(',', '.'))
    if (!Number.isFinite(waarde) || waarde < 0 || waarde > 100) {
      setFormFout(t('err_pos_klantkorting_waarde'))
      return
    }
    setKlantKortingBon(waarde === standaardKortingPct ? null : waarde)
    sluitVenster()
  }

  // Eén berekening voor scherm, afrekenknop, factuur en journaal: BTW per
  // regel afgerond, daarna cent-exact opgeteld (utils/kassa.ts). Anders pint de
  // klant een ander bedrag dan de factuur noemt. De weergave (incl. of excl.
  // BTW) leest dezelfde regels.
  const bonTotalen = useMemo(
    () => kassaBonTotalen(cart, {kortingPct, bonKorting, verpakkingen: verpakkingen || []}),
    [cart, kortingPct, bonKorting, verpakkingen])
  const bonWeergave = useMemo(() => kassaBonWeergave(bonTotalen, toonInclBtw), [bonTotalen, toonInclBtw])
  const bonStuks = cart.reduce((s, r) => s + (Number(r.aantal) || 0), 0)

  // Factuurnummering: server-side via volgendFactuurNummer() (ERP-plan 0.2) —
  // de client nummert nooit zelf (races/hergebruik).

  // ── Afrekenen: bestelling + picks + uitlevering + factuur in één keer ────────
  // Een verkoop boekt geen accijns: het bier ligt al buiten de AGP en de
  // accijns is bij het uitslaan geboekt (utils/uitlevering.ts).

  // Dubbelklikgrendel. Tussen de klik en het einde van de verkoop zit een
  // netwerkronde (het factuurnummer); een tweede klik in dat venster draaide
  // dezelfde bon nog eens: twee facturen, twee journaalboekingen, dubbele
  // uitleveringen. `bezigRef` sluit een tweede klik tijdens de verkoop uit —
  // een tweede klik in dezelfde tick ziet de state nog niet. `afgerekendRef`
  // onthoudt welke bon al geboekt is: een klik die nog vóór de nieuwe render
  // binnenkomt, ziet de oude bon en mag die niet opnieuw boeken. Een nieuwe
  // bon (andere regels) is een ander object en gaat gewoon door.
  const bezigRef = useRef(false)
  const afgerekendRef = useRef<BonRegel[] | null>(null)
  const [verwerkBezig, setVerwerkBezig] = useState(false)
  const openAfrekenen = () => {
    setAfrekenFout('')
    openVenster('afrekenen')
  }
  const verwerkVerkoop = async () => {
    if (bezigRef.current || afgerekendRef.current === cart) return
    bezigRef.current = true
    setVerwerkBezig(true)
    setAfrekenFout('')
    let gelukt = false
    try {
      gelukt = (await voerVerkoopUit()) === true
    } finally {
      if (gelukt) afgerekendRef.current = cart
      bezigRef.current = false
      setVerwerkBezig(false)
    }
  }

  const voerVerkoopUit = async (): Promise<boolean | undefined> => {
    if (!cart.length) { setAfrekenFout(t('err_pos_bon_leeg')); return }
    if (betaalwijze === 'rekening' && !selectedKlant) { setAfrekenFout(t('err_pos_rekening_klant')); return }
    const vandaag = tod()
    const klantNaam = selectedKlant?.naam || t('pos_walkin_naam')

    // 1. Voorraadvalidatie + FEFO-allocatie per bierregel, uit dezelfde lots
    //    die de tegel telt (vrij buiten de AGP, oudste THT eerst). Meerdere
    //    bonregels die dezelfde afvulling raken, alloceren niet dubbel.
    const verdeling = kassaAllocatie(cart, key => keuzeVoorKey.get(key)?.lots || [])
    if (verdeling.ok === false) {
      const r = cart.find(x => x.key === verdeling.regelKey)
      setAfrekenFout(t('err_verkoop_vrij_ontoereikend').replace('{beschikbaar}', `${verdeling.beschikbaar}× ${r?.verpakking_type || r?.bier_naam || ''}`))
      return
    }
    const draftAllocaties = verdeling.allocaties

    // 2. Orderregels (bon + klantkorting), zelfde vorm als een handmatige order
    let regelId = 0
    const regels: any[] = cart.map(r => ({
      id: ++regelId,
      type: r.type,
      artikel_key: r.artikel_key ?? null,
      artikel_id: r.artikel_id ?? null,
      sku: r.sku ?? null,
      bier_naam: r.bier_naam,
      verpakking_type: r.verpakking_type,
      aantal: r.aantal,
      prijs_per_stuk: r.prijs_per_stuk,
      btw_pct: Number(r.btw_pct || 0),
      omschrijving: r.omschrijving,
      prijsType: r.prijsType || 'normaal',
      _key: r.key,
    }))
    for (const k of bonTotalen.kortingRegels) {
      const oms = t('lbl_korting_pct').replace('{pct}', String(kortingPct))
      regels.push({
        id: ++regelId,
        type: 'korting',
        bier_naam: oms,
        verpakking_type: '',
        aantal: 1,
        prijs_per_stuk: -k.bedrag,
        btw_pct: k.btw_pct,
        omschrijving: oms,
      })
    }
    for (const k of bonTotalen.bonKortingRegels) {
      const oms = bonKorting?.soort === 'pct'
        ? t('lbl_korting_pct').replace('{pct}', String(bonKorting.waarde))
        : t('pos_korting')
      regels.push({
        id: ++regelId,
        type: 'korting',
        bier_naam: oms,
        verpakking_type: '',
        aantal: 1,
        prijs_per_stuk: -k.bedrag,
        btw_pct: k.btw_pct,
        omschrijving: oms,
      })
    }

    // 3. Picks koppelen aan de zojuist toegewezen afvullingen
    const bestellingId = newId(bestellingen || [])
    let pickId = newId(bestellingPicks || [])
    const picks: any[] = draftAllocaties.map(alloc => ({
      id: pickId++,
      bestelling_id: bestellingId,
      regel_id: regels.find((rg: any) => rg._key === alloc.regelKey)?.id ?? 0,
      afvulling_id: alloc.afvulling_id,
      batch_id: alloc.batch_id,
      aantal: alloc.aantal,
      uitlevering_id: null,
      accijns_id: null,
    }))

    // 4. Uitleveringen uit vrije voorraad (de verkoop zelf, geen accijns)
    const {uitleveringen: nieuweUitleveringen, pickResult, tekort} = bouwVerkoopUitleveringen(
      picks,
      {type_uitlevering: 'binnenland', bestemming_naam: klantNaam, bestemming_land: 'NL'},
      {afvullingen: av || [], batches: bat || [], locaties: locaties || [], uit: uit || [],
        verplaatsingen: verplaatsingen || [], afboekingen: afboekingen || [], datum: vandaag},
      newId(uit || []),
    )
    if (tekort > 0) { setAfrekenFout(t('err_verkoop_vrij_tekort')); return }
    const picksMetIds = picks.map((p: any) => {
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

    // 5. Factuurregels (incl. automatisch statiegeld) + BTW-overzicht.
    //    Nummer pas ná alle validaties ophalen zodat een afgebroken verkoop
    //    geen nummer verbruikt (gat in de reeks).
    let factuurNummer: string
    try { factuurNummer = await volgendFactuurNummer('factuur') }
    catch (e) { setAfrekenFout(t('err_factuurnummer_ophalen')); return }
    // De bedragen komen uit `bonTotalen` — dezelfde regels waarmee het scherm
    // het afrekenbedrag toont. `regels` staat in dezelfde volgorde (bon,
    // klantkorting, bonkorting); statiegeld komt daarachter.
    const regelsList: any[] = bonTotalen.geldRegels.map((g, i) => {
      const bedragen = {
        hoeveelheid: g.aantal,
        prijs_per_stuk: g.prijs_per_stuk,
        btw_pct: g.btw_pct,
        netto: g.netto,
        btw_bedrag: g.btw_bedrag,
        bruto: g.bruto,
      }
      if (g.bron === 'statiegeld') {
        const st = bonTotalen.statiegeldRegels[g.index]
        return {
          omschrijving: `${t(st.soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')} – ${st.vp.naam}`,
          ...bedragen,
          statiegeld_soort: st.soort,
          verpakking_id: st.vp.id,
        }
      }
      const r = regels[i]
      return {omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`, ...bedragen}
    })
    const btwTarievenLijst = [...new Set(regelsList.map((r: any) => Number(r.btw_pct || 0)))] as number[]
    const btw_overzicht = btwTarievenLijst.map(tarief => {
      const rv = regelsList.filter((r: any) => Number(r.btw_pct || 0) === tarief)
      return {
        tarief,
        netto: rnd2(rv.reduce((s: number, r: any) => s + r.netto, 0)),
        btw: rnd2(rv.reduce((s: number, r: any) => s + r.btw_bedrag, 0)),
      }
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const factuurTotalen = totaliseerRegels(regelsList)

    // 6. Bestelling (direct afgerond — kassaverkoop) + factuur
    const bestelling: any = {
      id: bestellingId,
      status: 'afgerond',
      datum: vandaag,
      klant_id: selectedKlant?.id ?? null,
      klant_naam: klantNaam,
      klant_email: selectedKlant?.email || '',
      klant_bedrijf: selectedKlant?.bedrijf || '',
      klant_straat: selectedKlant?.straat || '',
      klant_huisnummer: selectedKlant?.huisnummer || '',
      klant_postcode: selectedKlant?.postcode || '',
      klant_stad: selectedKlant?.stad || '',
      klant_type: isZakelijk ? 'zakelijk' : 'prive',
      regels: regels.map(({_key, ...r}: any) => r),
      opmerkingen: '',
      wc_order_id: null,
      wc_order_nummer: null,
      pos: true,
      pick_datum: vandaag,
      verzend_datum: vandaag,
      factuur_id: null,
      factuur_nummer: factuurNummer,
    }
    const snap = resolveKlantSnapshot(bestelling, klanten)
    const factuur: any = {
      id: newId(verkoopFacturen || []),
      datum: vandaag,
      factuurnummer: factuurNummer,
      bestelling_id: bestellingId,
      klant_id: snap.klant_id ?? null,
      klant_naam: snap.klant_naam || '',
      klant_bedrijf: snap.klant_bedrijf || '',
      klant_email: snap.klant_email || '',
      klant_straat: snap.klant_straat || '',
      klant_huisnummer: snap.klant_huisnummer || '',
      klant_postcode: snap.klant_postcode || '',
      klant_stad: snap.klant_stad || '',
      klant_btw_nummer: snap.klant_btw_nummer || '',
      klant_adres: [snap.klant_straat, snap.klant_huisnummer, snap.klant_postcode, snap.klant_stad].filter(Boolean).join(' '),
      regels: regelsList,
      btw_overzicht,
      netto: factuurTotalen.netto,
      btw: factuurTotalen.btw,
      bruto: factuurTotalen.bruto,
      netto_cent: factuurTotalen.netto_cent,
      btw_cent: factuurTotalen.btw_cent,
      bruto_cent: factuurTotalen.bruto_cent,
      status: betaalwijze === 'rekening' ? 'open' : 'betaald',
      definitief: true,
      betaalwijze,
      ...(betaalwijze !== 'rekening' ? {betaald_datum: vandaag} : {}),
    }
    bestelling.factuur_id = factuur.id

    // 7. State-updates + logboek + audit
    setBestellingen((prev: any[]) => [...(prev || []), bestelling])
    setBestellingPicks((prev: any[]) => [...(prev || []), ...picksMetIds])
    if (nieuweUitleveringen.length > 0) setUit((prev: any[]) => [...(prev || []), ...nieuweUitleveringen])
    setVerkoopFacturen((prev: any[]) => [...(prev || []), factuur])
    // Merch met eigen voorraad afboeken (bonregels met een merch-artikel).
    const merchMutaties = merchAfboekingenVoorRegels(cart, merchArtikelen, {datum: vandaag, referentie: factuurNummer})
    if (merchMutaties.length) {
      const geboekt = boekMerchMutaties(merchArtikelen, merchVoorraadLog, merchMutaties)
      setMerchArtikelen(geboekt.artikelen)
      setMerchVoorraadLog(geboekt.log)
    }
    // Journaal (ERP-plan 2.1): kassafactuur is direct definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(factuur)))
    setLog((prev: any[]) => {
      let logId = newId(prev || [])
      const entries = nieuweUitleveringen.map((u: any) => ({
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
        omschrijving: `Kassa — ${klantNaam} — ${factuurNummer}`,
      }))
      return [...(prev || []), ...entries]
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: bestellingId,
      actie: 'aangemaakt',
      omschrijving: `Kassaverkoop — ${klantNaam}, factuur ${factuurNummer} (${nieuweUitleveringen.length} uitleveringen)`,
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verkoopfactuur',
      entiteit_id: factuur.id,
      actie: 'aangemaakt',
      omschrijving: `Kassa — ${factuurNummer} ${klantNaam} ${fmt(factuur.bruto)} (${betaalwijze})`,
    })

    // Bureau: de afrekendialoog sluit. Telefoon: het onderblad Bon blijft open
    // en toont de afgeronde verkoop (printen, nieuwe verkoop).
    setVensters(s => s.filter(v => v !== 'afrekenen'))
    setCart([])
    setBonKorting(null)
    setKlantKortingBon(null)
    setLaatsteVerkoop({bestelling, factuur})
    return true
  }

  const saveNieuweKlant = () => {
    const naam = nieuweKlantForm.naam.trim()
    if (!naam) { setFormFout(t('err_pos_klant_naam')); return }
    const nieuw: any = {
      id: newId(klanten || []),
      klantnummer: nextKlantnummer(klanten || []),
      naam,
      klant_type: nieuweKlantForm.klant_type,
      email: nieuweKlantForm.email.trim(),
      telefoon: nieuweKlantForm.telefoon.trim(),
    }
    setKlanten((prev: any[]) => [...(prev || []), nieuw])
    logAudit(auditLog, setAuditLog, {entiteit: 'Klant', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Via kassa — ${naam}`})
    sluitVenster()
    setNieuweKlantForm({naam: '', klant_type: 'prive', email: '', telefoon: ''})
    selectKlant(nieuw.id)
  }

  const printLaatste = () => {
    if (!laatsteVerkoop) return
    printFactuur(laatsteVerkoop.bestelling, laatsteVerkoop.factuur, breweryMetTermijn(laatsteVerkoop.factuur, klanten, breweryDetails), appName, factuurLogo)
  }
  const nieuweVerkoop = () => {
    setLaatsteVerkoop(null)
    selectKlant(null)
    if (smal) setVensters([])
  }

  // Telefoon: "Afrekenen" in de bonbalk opent de bon met de afrekenknop in beeld.
  const bevestigRef = useRef<HTMLButtonElement | null>(null)
  const [naarAfrekenen, setNaarAfrekenen] = useState(false)
  useEffect(() => {
    if (!naarAfrekenen || venster !== 'bon') return
    setNaarAfrekenen(false)
    const knop = bevestigRef.current
    if (knop) { knop.scrollIntoView({block: 'end'}); knop.focus({preventScroll: true}) }
  }, [naarAfrekenen, venster])

  const klantNaamKort = selectedKlant ? selectedKlant.naam : t('pos_klant_particulier')
  const laatsteKort = laatsteVerkoop
    ? {factuurnummer: laatsteVerkoop.factuur.factuurnummer, klantNaam: laatsteVerkoop.bestelling.klant_naam, bruto: laatsteVerkoop.factuur.bruto}
    : null

  // ── Onderdelen ──────────────────────────────────────────────────────────────

  const klantInhoud = (variant: 'kolom' | 'blad') => (
    <KassaKlant
      variant={variant}
      klant={selectedKlant}
      zakelijk={isZakelijk}
      stats={klantStats}
      recente={recenteKlanten}
      zoek={klantZoek}
      onZoek={setKlantZoek}
      zoekResultaten={klantZoekResultaten}
      kortingPct={kortingPct}
      standaardKortingPct={standaardKortingPct}
      klantKortingBon={klantKortingBon}
      vorige={vorigeAankopen}
      kanVorige={k => k.merch ? k.prijs != null : opBon(k.key) < k.verkoopbaar}
      onKies={selectKlant}
      onNieuw={() => openVenster('nieuweKlant')}
      onKlantKorting={openKlantKorting}
      onVorige={k => addToCart(k)}
    />
  )

  const zoekVeld = <SearchInput value={productZoek} onChange={setProductZoek} placeholder={t('pos_zoek_product_ph')} />
  const uitverkochtSchakelaar = zichtbaar.uitverkocht > 0 ? (
    <label className="inline-flex items-center gap-2 min-h-tap lg:min-h-0 text-xs text-gray-500 select-none cursor-pointer">
      <input type="checkbox" className="t-checkbox" checked={toonUitverkocht}
        onChange={e => setToonUitverkocht(e.target.checked)} />
      {t('pos_toon_uitverkocht').replace('{n}', String(zichtbaar.uitverkocht))}
    </label>
  ) : null
  const tegels = zichtbaar.tegels.length === 0 ? (
    productZoek.trim()
      ? <LegeStaat titel={t('pos_geen_zoekresultaat').replace('{q}', productZoek.trim())} />
      : (
        <LegeStaat titel={t('pos_geen_producten_titel')}>
          {gaNaar && <Btn v="secondary" onClick={() => gaNaar({pagina: 'producten'})}>{t('pos_naar_producten')} ›</Btn>}
        </LegeStaat>
      )
  ) : (
    <KassaTegels tegels={zichtbaar.tegels} opBon={opBon} prijs={toonPrijs} onKies={k => addToCart(k)} onUitslaan={openUitslag} />
  )

  const bonInhoud = (variant: 'kolom' | 'blad', kop?: React.ReactNode, voet?: React.ReactNode) => (
    <KassaBon
      variant={variant}
      cart={cart}
      weergave={bonWeergave}
      kortingPct={kortingPct}
      bonKorting={bonKorting}
      laatsteVerkoop={laatsteKort}
      kanMeer={kanMeer}
      onAantal={wijzigAantal}
      onVerwijder={idx => setCart(prev => prev.filter((_, i) => i !== idx))}
      onKorting={() => openVenster('korting')}
      onVrijeRegel={() => openVenster('vrijeRegel')}
      onBonKortingWeg={() => setBonKorting(null)}
      onPrint={printLaatste}
      onNieuweVerkoop={nieuweVerkoop}
      vergrendeld={verwerkBezig}
      kop={kop}
    >
      {voet}
    </KassaBon>
  )

  const zonderKlantOpRekening = betaalwijze === 'rekening' && !selectedKlant
  const foutRegel = (tekst: string) => tekst
    ? <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{tekst}</div>
    : null

  return (
    <div className="space-y-4">
      {smal ? (
        // ── Telefoon en tablet: catalogus, met de bon in een vaste balk ──
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => openVenster('klant')} aria-haspopup="dialog"
              className="flex-1 min-w-0 min-h-tap flex items-center gap-1.5 px-3 rounded-lg border border-gray-200 bg-white text-sm text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <span className="text-gray-500 flex-shrink-0">{t('pos_klant')}:</span>
              <span className="font-semibold text-gray-900 truncate">{klantNaamKort}</span>
              {selectedKlant && isZakelijk && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">{t('lbl_zakelijk')}</span>}
              <span aria-hidden="true" className="ml-auto pl-1 text-gray-400 flex-shrink-0">▾</span>
            </button>
            <KassaInclSchakelaar aan={toonInclBtw} onWissel={setInclKeuze} />
          </div>
          {zoekVeld}
          {uitverkochtSchakelaar}
          {tegels}
          {/* Ruimte voor de bonbalk: die mag niets afdekken. */}
          <div aria-hidden="true" className={BONBALK_RUIMTE} />
        </div>
      ) : (
        // ── Bureau: catalogus en bon naast elkaar ──
        <>
          <SectionHeader
            title={t('nav_kassa')}
            rounded="full"
            info={<span>{fmtD(tod())}</span>}
          />
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                {klantInhoud('kolom')}
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs font-semibold text-gray-500 flex-shrink-0">{t('nav_producten')}</div>
                  <div className="basis-full sm:basis-auto sm:flex-1">{zoekVeld}</div>
                  <KassaInclSchakelaar aan={toonInclBtw} onWissel={setInclKeuze} />
                </div>
                {uitverkochtSchakelaar}
                {tegels}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:sticky lg:top-20">
              {bonInhoud('kolom', undefined, cart.length > 0 && (
                <Btn v="green" s="lg" cls="w-full text-base" onClick={openAfrekenen}>
                  {t('pos_afrekenen')} · {fmt(bonTotalen.bruto)}
                </Btn>
              ))}
            </div>
          </div>
        </>
      )}

      {smal && (
        <KassaBonbalk
          stuks={bonStuks}
          totaal={bonTotalen.bruto}
          afgerond={cart.length === 0 && laatsteVerkoop ? laatsteVerkoop.factuur.bruto : null}
          onBon={() => openVenster('bon')}
          onAfrekenen={() => { setAfrekenFout(''); setNaarAfrekenen(true); openVenster('bon') }}
        />
      )}

      {/* ── Telefoon: de bon als onderblad (regels, klant, betaalwijze, afrekenen) ── */}
      {smal && venster === 'bon' && (
        <KassaVenster key="bon" telefoon titel={t('pos_bon')} onSluit={sluitVenster}>
          {bonInhoud('blad',
            <button type="button" onClick={() => openVenster('klant')} disabled={verwerkBezig}
              className="w-full min-h-tap flex items-center gap-1.5 px-3 rounded-lg border border-gray-200 bg-white text-sm text-left disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              <span className="text-gray-500 flex-shrink-0">{t('pos_klant')}:</span>
              <span className="font-semibold text-gray-900 truncate">{klantNaamKort}</span>
              {selectedKlant && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${isZakelijk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {isZakelijk ? t('lbl_zakelijk') : t('lbl_prive')}
                </span>
              )}
              {kortingPct > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 flex-shrink-0">{t('lbl_korting_pct').replace('{pct}', String(kortingPct))}</span>}
              <span aria-hidden="true" className="ml-auto pl-1 text-gray-400 flex-shrink-0">›</span>
            </button>,
            cart.length > 0 && (
              // Afrekenen blijft onderin het blad in beeld, ook bij een lange bon.
              <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 bg-white border-t border-gray-100 space-y-3">
                {foutRegel(afrekenFout)}
                <KassaBetaalwijze waarde={betaalwijze} onKies={setBetaalwijze} zonderKlant={!selectedKlant} vergrendeld={verwerkBezig} />
                <button ref={bevestigRef} type="button" onClick={verwerkVerkoop}
                  disabled={verwerkBezig || zonderKlantOpRekening}
                  className="w-full min-h-tapLg rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-base font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--t-accent)]">
                  {t('pos_bevestig_verkoop')} · {fmt(bonTotalen.bruto)}
                </button>
              </div>
            ))}
        </KassaVenster>
      )}

      {smal && venster === 'klant' && (
        <KassaVenster key="klant" telefoon titel={t('pos_klant')} onSluit={sluitVenster}>
          {klantInhoud('blad')}
        </KassaVenster>
      )}

      {/* ── Bureau: afrekenen ── */}
      {!smal && venster === 'afrekenen' && (
        <Modal title={t('pos_afrekenen')} onClose={() => { if (!verwerkBezig) sluitVenster() }}>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {selectedKlant ? selectedKlant.naam : t('pos_walkin_naam')}
              {' — '}{bonStuks}× · <span className="font-bold">{fmt(bonTotalen.bruto)}</span>
            </div>
            <KassaBetaalwijze waarde={betaalwijze} onKies={setBetaalwijze} zonderKlant={!selectedKlant} vergrendeld={verwerkBezig} />
            {foutRegel(afrekenFout)}
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={sluitVenster} disabled={verwerkBezig}>{t('btn_cancel')}</Btn>
              <Btn v="green" onClick={verwerkVerkoop} disabled={verwerkBezig || zonderKlantOpRekening}>
                {t('pos_bevestig_verkoop')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Nieuwe klant (snel) ── */}
      {venster === 'nieuweKlant' && (
        <KassaVenster telefoon={smal} laag titel={t('klanten_new')} onSluit={sluitVenster}
          actie={{label: t('btn_save'), onClick: saveNieuweKlant}}>
          <div className="space-y-3">
            {foutRegel(formFout)}
            <Inp label={t('lbl_naam')} value={nieuweKlantForm.naam} req
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, naam: v}))} />
            <Sel label={t('klanten_type')} value={nieuweKlantForm.klant_type}
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, klant_type: v || 'prive'}))}
              opts={[{v: 'prive', l: t('lbl_prive')}, {v: 'zakelijk', l: t('lbl_zakelijk')}]} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_email')} type="email" value={nieuweKlantForm.email}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, email: v}))} />
              <Inp label={t('lbl_telefoon')} value={nieuweKlantForm.telefoon}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, telefoon: v}))} />
            </div>
          </div>
        </KassaVenster>
      )}

      {/* ── Klantkorting voor deze bon ── */}
      {venster === 'klantKorting' && (
        <KassaVenster telefoon={smal} laag titel={smal ? t('pos_klantkorting_kort') : t('pos_klantkorting_titel')} onSluit={sluitVenster}
          actie={{label: t('btn_save'), onClick: pasKlantKortingToe}}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('pos_klantkorting_uitleg').replace('{pct}', String(standaardKortingPct))}
            </p>
            {foutRegel(formFout)}
            <Inp label={t('pos_korting_soort_pct')} type="number" step="0.01" min="0" max="100"
              value={klantKortingWaarde} onChange={(v: string) => setKlantKortingWaarde(v)} />
            {klantKortingBon != null && (
              <Btn v="secondary" onClick={() => { setKlantKortingBon(null); sluitVenster() }}>
                {t('pos_klantkorting_herstel').replace('{pct}', String(standaardKortingPct))}
              </Btn>
            )}
          </div>
        </KassaVenster>
      )}

      {/* ── Korting op de bon ── */}
      {venster === 'korting' && (
        <KassaVenster telefoon={smal} laag titel={t('pos_korting')} onSluit={sluitVenster}
          actie={{label: t('btn_save'), onClick: addKorting}}>
          <div className="space-y-3">
            {foutRegel(formFout)}
            <Sel label={t('pos_korting_soort')} value={kortingForm.soort}
              onChange={(v: string) => setKortingForm(f => ({...f, soort: v || 'bedrag'}))}
              opts={[{v: 'bedrag', l: t('pos_korting_soort_bedrag')}, {v: 'pct', l: t('pos_korting_soort_pct')}]} />
            <Inp label={kortingForm.soort === 'pct' ? t('pos_korting_soort_pct') : t('pos_korting_soort_bedrag')}
              type="number" step="0.01" value={kortingForm.waarde} req
              onChange={(v: string) => setKortingForm(f => ({...f, waarde: v}))} />
          </div>
        </KassaVenster>
      )}

      {/* ── Vrije regel ── */}
      {venster === 'vrijeRegel' && (
        <KassaVenster telefoon={smal} laag titel={t('pos_vrije_regel')} onSluit={sluitVenster}
          actie={{label: t('manual_order_add_line'), onClick: addVrijeRegel}}>
          <div className="space-y-3">
            {foutRegel(formFout)}
            <Inp label={t('lbl_description')} value={vrijeRegelForm.omschrijving} req
              onChange={(v: string) => setVrijeRegelForm(f => ({...f, omschrijving: v}))} />
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('manual_order_qty')} type="number" value={vrijeRegelForm.aantal}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, aantal: v}))} />
              <Inp label={t('manual_order_price')} type="number" step="0.01" value={vrijeRegelForm.prijs_per_stuk}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, prijs_per_stuk: v}))} />
              <Sel label={t('manual_order_btw')} value={vrijeRegelForm.btw_pct}
                onChange={(v: string) => setVrijeRegelForm(f => ({...f, btw_pct: v}))}
                opts={[{v: '0', l: '0%'}, {v: '9', l: '9%'}, {v: '21', l: '21%'}]} />
            </div>
          </div>
        </KassaVenster>
      )}

      {/* Uitslaan uit de AGP: dezelfde modal en dezelfde boeking als de
          productpagina, maar zonder de kassa te verlaten. */}
      {uitslagKeuze && (
        <UitslagModal
          productNaam={`${uitslagKeuze.bier_naam} — ${uitslagKeuze.label}`}
          afvullingen={uitslagAfvullingen}
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
          onClose={() => setUitslagKeuze(null)}
          onOpslaan={saveUitslag}
        />
      )}

      {melding && <KassaMelding tekst={melding} onSluit={() => setMelding(null)} bovenBonbalk={smal} />}
    </div>
  )
}

export default KassaPage
