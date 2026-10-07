/**
 * KlantenPage.tsx — dedicated klantenbeheer met orderhistorie.
 * - Lijst van alle klanten met stats (omzet, openstaand, # bestellingen).
 * - Detail-view met bewerkbare velden, bestellingen, facturen en mail-knop.
 * - Matched bestellingen/facturen via klant_id, OF (fallback) klant_email match
 *   voor losse WC-orders die nog niet aan een klantkaart gekoppeld zijn.
 * - Ongekoppelde orders zijn aan een klantkaart te koppelen op e-mail óf op
 *   exact dezelfde klantnaam (zie matchOngekoppeldeOrder).
 * - Klanten staan alleen hier (Verkoop). De facturen van een klant openen het
 *   factuurdetail op Administratie › Facturen; "Facturen van deze klant" opent
 *   die lijst met de klant als filter. Welke factuur bij welke klant hoort en
 *   wat "vervallen" is, komt uit utils/klantFacturen.ts — dezelfde regels als
 *   de klantfilter en de te-laat-badge daar.
 */
import React from 'react'
import { t, getLang } from '../i18n'
import { newId, _fetchedKeys } from '../utils/api'
import { nextKlantnummer, ordersTeKoppelenBijOpslaan, koppelOrderAanKlant, KLANT_SYNC_STATUSSEN } from '../utils/klant'
import { landOpties, normaliseerLand } from '../utils/btwCategorie'
import { fmt, fmtD, tod } from '../utils/format'
import { centNaarEuro } from '../utils/centen'
import { facturenPerKlant, klantenMetVervallenFactuur, klantFactuurCijfers } from '../utils/klantFacturen'
import { verkoopStand } from '../utils/factuurTijdlijn'
import type { AttentieDoel } from '../utils/attentie'
import { zetGedeeldePeriode } from '../components/ui/useGedeeldePeriode'
import Btn from '../components/ui/Btn'
import BevestigKnop from '../components/ui/BevestigKnop'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import SearchInput from '../components/ui/SearchInput'
import SectionHeader from '../components/ui/SectionHeader'
import LegeStaat from '../components/ui/LegeStaat'
import Icon from '../components/ui/Icon'
import ResponsiveLijst from '../components/ui/ResponsiveLijst'
import type { LijstKolom } from '../components/ui/ResponsiveLijst'
import { VerkoopPil } from './admin/facturen/FactuurPil'
import MailModal from '../components/MailModal'
import Modal from '../components/ui/Modal'
import { logAudit } from '../utils/audit'

export interface KlantenPageProps {
  klanten: any[]
  setKlanten: any
  bestellingen: any[]
  setBestellingen: any
  verkoopFacturen: any[]
  breweryDetails: any
  smtpCreds: any
  factuurLogo?: string | null
  logo?: string | null
  appName?: string
  setPage: (p: string) => void
  setOpenOrderId: (id: number | null) => void
  auditLog: any[]
  setAuditLog: any
  /** Naar een ander scherm met segment/filter/record (een factuur op Facturen). */
  gaNaarDoel?: (d: AttentieDoel) => void
  /** `{pagina: 'klanten', id}` = die klant meteen openen (bijv. vanuit het factuurdetail). */
  navDoel?: AttentieDoel | null
  onNavDoelConsumed?: () => void
}

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/

const STATUS_COLORS: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
  gepickt: 'bg-orange-100 text-orange-700',
  verzonden: 'bg-purple-100 text-purple-700',
  afgerond: 'bg-green-100 text-green-700',
  geannuleerd: 'bg-gray-100 text-gray-500',
}

const emptyForm = () => ({
  naam: '', klantnummer: '', klant_type: 'prive' as 'prive'|'zakelijk',
  bedrijf: '', straat: '', huisnummer: '', postcode: '', stad: '',
  // Landcode (ISO alpha-2). Bepaalt op de e-factuur of een 0%-regel een
  // intracommunautaire levering of export buiten de EU is.
  land: '',
  btw_nummer: '', kvk_nummer: '',
  email: '', telefoon: '',
  betalingstermijn: '' as string | number,
  // Vast kortingspercentage voor deze klant; wordt bij handmatige orders
  // automatisch als kortingsregel toegepast (niet op verzendkosten).
  korting_pct: '' as string | number,
  notities: '',
})

// Bruto-totaal van een bestelling op basis van de regels (aantal × prijs × (1 + btw%)).
const orderBruto = (b: any): number => (b.regels || []).reduce(
  (s: number, r: any) => s + (r.aantal || 0) * (r.prijs_per_stuk || 0) * (1 + (r.btw_pct || 0) / 100), 0)

// Match een ongekoppelde bestelling op een klantkaart: e-mail (primair) of
// exact dezelfde naam (fallback, getrimd + case-insensitief). Zo zijn ook
// bestellingen zonder of met afwijkend e-mailadres maar met dezelfde
// klantnaam aan het account te koppelen.
const matchOngekoppeldeOrder = (b: any, email: string, naam: string): boolean => {
  if (b.klant_id != null) return false
  const emailLc = (email || '').trim().toLowerCase()
  const naamLc = (naam || '').trim().toLowerCase()
  const beLc = (b.klant_email || '').trim().toLowerCase()
  const bnLc = (b.klant_naam || '').trim().toLowerCase()
  return !!((emailLc && beLc === emailLc) || (naamLc && bnLc === naamLc))
}

const KlantenPage: React.FC<KlantenPageProps> = ({
  klanten, setKlanten, bestellingen, setBestellingen, verkoopFacturen,
  breweryDetails, smtpCreds, factuurLogo=null, logo=null, appName='',
  setPage, setOpenOrderId, auditLog, setAuditLog,
  gaNaarDoel, navDoel = null, onNavDoelConsumed,
}) => {
  const [view, setView] = React.useState<'list'|'detail'>('list')
  const [selectedId, setSelectedId] = React.useState<number|null>(null)
  // Backfill: bij elke render waarin er klanten zonder klantnummer staan,
  // kennen we die alsnog toe in aanmaakvolgorde. Zodra elke klant een nummer
  // heeft is de effect-loop klaar.
  //
  // Wachten tot béíde sleutels van de server zijn (1.12.62). Een niet-lege
  // klantenlijst bewijst niets: die kan uit de browsercache komen terwijl de
  // server nog aan het antwoorden is. En `logAudit` hieronder schrijft naar
  // een ándere sleutel, die prima nog leeg kan zijn — dan ging er een
  // auditlogboek van één regel naar de server, over de hele historie heen.
  React.useEffect(() => {
    if (!_fetchedKeys.has('klanten') || !_fetchedKeys.has('audit_log')) return
    if (klanten.length === 0) return
    const needsBackfill = klanten.some((k: any) => !String(k.klantnummer || '').trim())
    if (!needsBackfill) return
    const sorted = [...klanten].sort((a: any, b: any) => (a.id || 0) - (b.id || 0))
    let max = 0
    sorted.forEach((k: any) => {
      const n = parseInt(String(k.klantnummer || '').trim(), 10)
      if (!isNaN(n) && n > max) max = n
    })
    const updates = new Map<number, string>()
    sorted.forEach((k: any) => {
      if (!String(k.klantnummer || '').trim()) {
        max++
        updates.set(k.id, String(max).padStart(3, '0'))
      }
    })
    if (updates.size > 0) {
      setKlanten((prev: any[]) => prev.map((k: any) =>
        updates.has(k.id) ? {...k, klantnummer: updates.get(k.id)} : k))
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:0, actie:'gewijzigd',
        omschrijving:`${updates.size} klantnummer(s) automatisch toegekend`})
    }
  }, [klanten])
  // Synthetische-source-key: als de gebruiker via een "Uit bestelling"-rij in
  // de lijst is binnengekomen, onthouden we welke synth-groep dat was. Bij
  // opslaan koppelen we de bestellingen uit die groep — óók als de gebruiker
  // het e-mailadres in het formulier intussen heeft aangepast (bv. typo
  // gecorrigeerd). Zonder deze key zou de auto-koppel-logica naar het nieuwe
  // adres zoeken, niets vinden, en de synth-rij naast de nieuwe klantkaart
  // laten staan.
  const [synthSourceKey, setSynthSourceKey] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [form, setForm] = React.useState(emptyForm())
  // `dirty` markeert *door-de-gebruiker-aangepast*. Wordt alleen op `true`
  // gezet via `update()` (= een handmatige form-wijziging). Pre-fill via
  // openNewFromSynth zet dirty NIET, anders zou de back-confirm misleidend
  // verschijnen ("niet-opgeslagen wijzigingen" terwijl je niks aangepast hebt).
  const [dirty, setDirty] = React.useState(false)
  const [mailModal, setMailModal] = React.useState<null | {to:string,subject:string,text:string}>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const vandaagIso = tod()

  // Welke factuur bij welke klant hoort: de live klantkaart (ook via het
  // e-mailadres), anders de klant_id op de factuur — dezelfde regel als de
  // klantfilter op Facturen › Verkoop, zodat "Facturen van deze klant" daar
  // precies deze lijst toont.
  const facturenVanKlant = React.useMemo(
    () => facturenPerKlant(verkoopFacturen, klanten), [verkoopFacturen, klanten])
  // De oranje stip = een échte vervallen factuur (vervallenVerkoopFacturen),
  // niet "er staat iets open".
  const klantenMetVervallen = React.useMemo(
    () => klantenMetVervallenFactuur(verkoopFacturen, klanten, breweryDetails, vandaagIso),
    [verkoopFacturen, klanten, breweryDetails, vandaagIso])
  const factuurCtx = React.useMemo(
    () => ({ klanten, breweryDetails, vandaagIso }), [klanten, breweryDetails, vandaagIso])

  // Per-klant statistieken. Match via klant_id, en als fallback via case-
  // insensitive email-match — zo worden ook losse WC-orders met klant_email
  // maar zonder klant_id geteld.
  //
  // Definities:
  //   omzet      — strikt gefactureerd: som van alle verkoopfacturen voor
  //                deze klant (creditnota's hebben een negatieve bruto en
  //                verlagen de omzet zoals het hoort), in centen opgeteld.
  //   openOrders — pipeline: orders die nog niet gefactureerd zijn en niet
  //                geannuleerd. Pas omzet ZODRA er een factuur is.
  //   openstaand — open facturen (isVerkoopFactuurOpen: niet betaald, geen
  //                creditnota) — hetzelfde als de chip Open op Facturen.
  const statsPerKlant = React.useMemo(() => {
    const map: Record<number, {bestellingen: any[], facturen: any[], omzet: number, omzetCent: number, openOrders: number, openstaand: number, openstaandCent: number, laatsteDatum: string}> = {}
    klanten.forEach(k => {
      const emailLc = (k.email || '').toLowerCase()
      const matchOrder = (b: any) => b.klant_id === k.id
        || (emailLc && b.klant_email && b.klant_email.toLowerCase() === emailLc)
      const bestellingenK = bestellingen.filter(matchOrder)
      const facturenK = facturenVanKlant.get(String(k.id)) || []
      const c = klantFactuurCijfers(facturenK)
      const openOrders = bestellingenK
        .filter((b: any) => b.status !== 'geannuleerd'
          && !facturenK.some((f: any) => f.bestelling_id === b.id))
        .reduce((s: number, b: any) => s + orderBruto(b), 0)
      const laatsteDatum = bestellingenK.reduce((d: string, b: any) =>
        (b.datum || '') > d ? b.datum : d, '')
      map[k.id] = {
        bestellingen: bestellingenK, facturen: facturenK,
        omzet: centNaarEuro(c.omzetCent), omzetCent: c.omzetCent,
        openOrders,
        openstaand: centNaarEuro(c.openstaandCent), openstaandCent: c.openstaandCent,
        laatsteDatum,
      }
    })
    return map
  }, [klanten, bestellingen, facturenVanKlant])

  // Synthetische klantkaarten uit bestellingen die nog niet aan een
  // klantkaart gekoppeld zijn. Worden gegroepeerd op e-mail (of, als die er
  // niet is, op naam) — zo verschijnt een gloednieuwe WC-bestelling met
  // klant_email maar zonder klant_id automatisch als "Nog niet opgeslagen"
  // entry in de Klanten-lijst, en kan de gebruiker met één klik een echte
  // klantkaart aanmaken.
  const syntheticKlanten = React.useMemo(() => {
    const realIds = new Set(klanten.map((k: any) => k.id))
    const realEmails = new Set(
      klanten.map((k: any) => (k.email || '').toLowerCase()).filter(Boolean)
    )
    const groups = new Map<string, any>()
    bestellingen.forEach((b: any) => {
      // Reeds gekoppeld aan een bestaande klantkaart? Overslaan.
      if (b.klant_id != null && realIds.has(b.klant_id)) return
      const emailLc = (b.klant_email || '').toLowerCase()
      if (emailLc && realEmails.has(emailLc)) return
      const key = emailLc || (b.klant_naam || '').trim().toLowerCase()
      if (!key) return
      if (!groups.has(key)) {
        groups.set(key, {
          _synthetic: true,
          id: `synth:${key}`,
          _synthKey: key,
          naam: b.klant_naam || '',
          bedrijf: b.klant_bedrijf || '',
          email: b.klant_email || '',
          straat: b.klant_straat || '',
          huisnummer: b.klant_huisnummer || '',
          postcode: b.klant_postcode || '',
          stad: b.klant_stad || '',
          klant_type: b.klant_type || (b.klant_bedrijf ? 'zakelijk' : 'prive'),
          _matchedOrders: [] as any[],
        })
      }
      groups.get(key)._matchedOrders.push(b)
    })
    return Array.from(groups.values()).map((s: any) => {
      // Synth-klanten hebben per definitie nog geen factuur (facturen worden
      // bij afronden altijd met klant_id aangemaakt), dus omzet = 0. Alle
      // niet-geannuleerde bestellingen vallen onder "open orders" (pipeline).
      const openOrders = s._matchedOrders
        .filter((b: any) => b.status !== 'geannuleerd')
        .reduce((sum: number, b: any) => sum + orderBruto(b), 0)
      const laatsteDatum = s._matchedOrders.reduce((d: string, b: any) =>
        (b.datum || '') > d ? b.datum : d, '')
      return {...s, _stats: {bestellingen: s._matchedOrders, facturen: [], omzet: 0, openOrders, openstaand: 0, laatsteDatum}}
    })
  }, [klanten, bestellingen])

  // Filtered/sorted klanten voor de lijstweergave (echt + synthetisch).
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = [...klanten, ...syntheticKlanten]
    const list = q ? all.filter((k: any) =>
      (k.naam || '').toLowerCase().includes(q)
      || (k.bedrijf || '').toLowerCase().includes(q)
      || (k.email || '').toLowerCase().includes(q)
      || (k.telefoon || '').toLowerCase().includes(q)
      || (k.klantnummer || '').toLowerCase().includes(q)
    ) : all
    // Echte klanten sorteren op gefactureerde omzet (hoog → laag); synth-
    // klanten staan onderaan en sorteren op pipeline-waarde (open orders).
    const rangVan = (k: any) =>
      k._synthetic ? (k._stats?.openOrders || 0) : (statsPerKlant[k.id]?.omzet ?? 0)
    return [...list].sort((a: any, b: any) => {
      if (!!a._synthetic !== !!b._synthetic) return a._synthetic ? 1 : -1
      const so = rangVan(b), sa = rangVan(a)
      if (so !== sa) return so - sa
      return (a.naam || '').localeCompare(b.naam || '')
    })
  }, [klanten, syntheticKlanten, search, statsPerKlant])

  const selected = selectedId !== null ? klanten.find((k: any) => k.id === selectedId) : null
  const selectedStats = selectedId !== null ? statsPerKlant[selectedId] : null

  const openDetail = (k: any) => {
    setSelectedId(k.id)
    setSynthSourceKey(null)
    setForm({
      naam: k.naam || '', klantnummer: k.klantnummer || '',
      klant_type: k.klant_type || (k.bedrijf ? 'zakelijk' : 'prive'),
      bedrijf: k.bedrijf || '', straat: k.straat || '', huisnummer: k.huisnummer || '',
      postcode: k.postcode || '', stad: k.stad || '', land: k.land || '',
      btw_nummer: k.btw_nummer || '', kvk_nummer: k.kvk_nummer || '',
      email: k.email || '', telefoon: k.telefoon || '',
      betalingstermijn: k.betalingstermijn ?? '',
      korting_pct: k.korting_pct ?? '',
      notities: k.notities || '',
    })
    setDirty(false)
    setView('detail')
  }

  const openNew = () => {
    setSelectedId(null)
    setSynthSourceKey(null)
    setForm(emptyForm())
    setDirty(false)
    setView('detail')
  }

  // Maak klantkaart aan uit een synthetische entry (bestelling zonder
  // klantkaart) — formuliervelden komen uit de bestelling. We zetten `dirty`
  // hier expliciet op false: het formulier bevat data uit de bestelling, maar
  // de gebruiker heeft zelf nog niets aangepast. Dirty wordt true zodra ze
  // daadwerkelijk in een veld typt (via `update()`).
  const openNewFromSynth = (synth: any) => {
    setSelectedId(null)
    setSynthSourceKey(synth._synthKey)
    setForm({
      naam: synth.naam || '',
      klantnummer: '',
      klant_type: synth.klant_type || 'prive',
      bedrijf: synth.bedrijf || '',
      straat: synth.straat || '',
      huisnummer: synth.huisnummer || '',
      postcode: synth.postcode || '',
      stad: synth.stad || '',
      land: synth.land || '',
      btw_nummer: '',
      kvk_nummer: '',
      email: synth.email || '',
      telefoon: '',
      betalingstermijn: '',
      korting_pct: '',
      notities: '',
    })
    setDirty(false)
    setView('detail')
  }

  // Terug naar de lijst. Met niet-opgeslagen wijzigingen vraagt de terugknop
  // het eerst zelf (BevestigKnop), niet via een confirm-venster.
  const naarLijst = () => {
    setView('list')
    setSelectedId(null)
    setSynthSourceKey(null)
    setDirty(false)
  }

  // Navigatiedoel `{pagina: 'klanten', id}` (de klant in het factuurdetail):
  // die klant meteen openen. Zolang de klantenlijst nog van de server komt
  // wachten we; staat hij er dan niet in, dan blijft de lijst staan.
  const navKlantId = React.useRef<number | null>(
    navDoel?.pagina === 'klanten' && navDoel.id != null && Number.isFinite(Number(navDoel.id)) ? Number(navDoel.id) : null)
  React.useEffect(() => {
    const id = navKlantId.current
    // Een doel zonder bruikbare klant-id is meteen afgehandeld (niet laten
    // hangen tot de volgende navigatie).
    if (id === null) { if (navDoel) onNavDoelConsumed?.(); return }
    const k = klanten.find((x: any) => String(x?.id) === String(id))
    if (!k && !_fetchedKeys.has('klanten')) return
    navKlantId.current = null
    if (k) openDetail(k)
    onNavDoelConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klanten])

  const update = (patch: any) => { setForm((f: any) => ({...f, ...patch})); setDirty(true) }

  const save = () => {
    // De opslaanknop staat uit zonder naam; dit vangt alleen een omweg af.
    if (!form.naam.trim()) return
    // Klantnummer wordt ALTIJD automatisch bepaald — nooit door de gebruiker
    // ingevoerd. Voorkomt dubbele nummers per definitie. Bij een nieuwe klant
    // pakken we het volgende vrije nummer; bij een bestaande klant behouden
    // we wat er stond (of backfillen als dat leeg was).
    const klantnummer = selectedId === null
      ? nextKlantnummer(klanten)
      : (selected?.klantnummer || nextKlantnummer(klanten))
    const payload: any = {
      naam: form.naam.trim(),
      klantnummer,
      klant_type: form.klant_type,
      bedrijf: form.bedrijf.trim() || undefined,
      straat: form.straat.trim() || undefined,
      huisnummer: form.huisnummer.trim() || undefined,
      postcode: form.postcode.trim() || undefined,
      stad: form.stad.trim() || undefined,
      land: normaliseerLand(form.land) || undefined,
      btw_nummer: form.btw_nummer.trim() || undefined,
      kvk_nummer: form.kvk_nummer.trim() || undefined,
      email: form.email.trim() || undefined,
      telefoon: form.telefoon.trim() || undefined,
      betalingstermijn: form.betalingstermijn === '' ? undefined : Number(form.betalingstermijn),
      korting_pct: form.korting_pct === '' || Number(form.korting_pct) === 0 ? undefined : Number(form.korting_pct),
      notities: form.notities.trim() || undefined,
    }
    // Strip undefined-keys
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

    let savedKlantId: number
    let oldEmail = ''
    if (selectedId !== null) {
      oldEmail = (selected?.email || '')
      setKlanten((prev: any[]) => prev.map((k: any) => k.id === selectedId ? {...k, ...payload} : k))
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'gewijzigd', omschrijving:payload.naam})
      savedKlantId = selectedId
    } else {
      savedKlantId = newId(klanten || [])
      setKlanten((prev: any[]) => [...(prev||[]), {id: savedKlantId, ...payload}])
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:savedKlantId, actie:'aangemaakt', omschrijving:payload.naam})
      setSelectedId(savedKlantId)
    }

    // Auto-koppel ongekoppelde bestellingen aan deze klant. Vier matching-
    // strategieën — alle vier zijn nodig om edge-cases af te dekken:
    //
    //   1. Synth-source-key: als de gebruiker via "Uit bestelling" is
    //      binnengekomen, koppel exact die bestellingen — onafhankelijk
    //      van wat de gebruiker met het e-mailveld doet. Dit fixt: e-mail
    //      typo corrigeren maakte tot nu een nieuwe klant naast de
    //      bestaande synth-rij.
    //
    //   2. Nieuwe e-mail: koppel ook bestellingen die exact het zojuist
    //      opgeslagen adres hebben (handig bij handmatig aanmaken zonder
    //      synth-flow).
    //
    //   3. Oude e-mail (bij bewerken bestaande klant): bestellingen die
    //      via email-fallback aan deze klant gematcht waren, krijgen nu
    //      hun klant_id zodat ze niet als "ongekoppeld" achterblijven
    //      wanneer de gebruiker het e-mailadres aanpast.
    //
    //   4. Naam-match: bestellingen met exact dezelfde klantnaam maar
    //      zonder (matchend) e-mailadres — bv. een WC-gastbestelling met
    //      een ander adres — horen ook bij deze klant. Alléén als er na het
    //      opslaan precies één kaart met die naam is (zelfde regel als
    //      findKlantVoorOrder): bij naamgenoten koppelt opslaan niet
    //      stilzwijgend, daar is de koppelknop (met bevestiging) voor.
    //      De hint-banner in de detailweergave toont vooraf hoeveel er
    //      gekoppeld worden.
    const toLink = ordersTeKoppelenBijOpslaan(bestellingen, klanten, {
      klantId: selectedId, email: payload.email, oudEmail: oldEmail,
      naam: payload.naam, synthKey: synthSourceKey,
    })

    // Snapshot van klantgegevens om naar gekoppelde bestellingen te schrijven.
    // We gebruiken `form.*.trim()` direct (i.p.v. payload) zodat ook lege
    // velden netjes als '' worden overgenomen — zo blijven order en klantkaart
    // synchroon ook wanneer de gebruiker een veld leegmaakt.
    const snap = {
      klant_naam:       form.naam.trim(),
      klant_email:      form.email.trim(),
      klant_bedrijf:    form.bedrijf.trim(),
      klant_straat:     form.straat.trim(),
      klant_huisnummer: form.huisnummer.trim(),
      klant_postcode:   form.postcode.trim(),
      klant_stad:       form.stad.trim(),
      klant_btw_nummer: form.btw_nummer.trim(),
      klant_type:       form.klant_type,
    }
    // Welke gekoppelde orders mogen we updaten? Niet de afgeronde / verzonden /
    // geannuleerde — die hebben hun snapshot al "vastgelegd" in de factuur of
    // pakbon en moeten historisch correct blijven. Wel: nieuw / bevestigd /
    // gepickt — daar zit de wijziging nog in het systeem en kan de klant nog
    // bijgewerkt worden zonder reeds-uitgegeven documenten te verbreken.
    // Dat geldt ook voor een order die nú pas gekoppeld wordt.
    const toLinkIds = new Set(toLink.map((b: any) => b.id))
    let propagated = 0
    setBestellingen((prev: any[]) => prev.map((b: any) => {
      if (toLinkIds.has(b.id)) {
        // Nieuwe koppeling: klant_id altijd, de snapshot alleen als de order nog open is.
        return koppelOrderAanKlant(b, snap, savedKlantId)
      }
      // Bestaande koppeling én bewerkbaar? Sync de snapshot.
      if (b.klant_id === savedKlantId && KLANT_SYNC_STATUSSEN.includes(b.status)) {
        propagated++
        return {...b, ...snap}
      }
      return b
    }))

    if (toLink.length > 0) {
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:savedKlantId, actie:'gewijzigd',
        omschrijving:`${toLink.length} bestelling(en) automatisch gekoppeld`})
    }
    if (propagated > 0) {
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:savedKlantId, actie:'gewijzigd',
        omschrijving:`Klantgegevens bijgewerkt in ${propagated} open bestelling(en)`})
    }
    setSynthSourceKey(null)
    setDirty(false)
  }

  const deleteKlant = () => {
    if (selectedId === null) return
    const naam = selected?.naam || ''
    setKlanten((prev: any[]) => prev.filter((k: any) => k.id !== selectedId))
    logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'verwijderd', omschrijving:naam})
    setShowDeleteConfirm(false)
    naarLijst()
  }

  // Koppel losse WC-orders die op e-mail óf naam matchen aan deze klant
  // (klant_id zetten). De order-snapshot blijft ongemoeid zodat een afwijkend
  // e-mailadres op de bestelling bewaard blijft.
  // De knop staat er alleen als er iets te koppelen is en vraagt zelf om
  // bevestiging (BevestigKnop met het aantal).
  const koppelOrders = () => {
    if (!selected) return
    const toLink = bestellingen.filter((b: any) =>
      matchOngekoppeldeOrder(b, selected.email || '', selected.naam || ''))
    if (toLink.length === 0) return
    const ids = new Set(toLink.map((b: any) => b.id))
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      ids.has(b.id) ? {...b, klant_id: selected.id} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selected.id, actie:'gewijzigd', omschrijving:`${toLink.length} bestelling(en) gekoppeld via e-mail/naam`})
  }

  const mailKlant = () => {
    // De mailknop kijkt naar het adres in het formulier (staat uit zonder
    // geldig adres); de mail gaat dus ook naar dát adres, anders deed de knop
    // niets zolang een nieuw adres nog niet opgeslagen was.
    const aan = (form.email || '').trim() || selected?.email || ''
    if (!selected || !aan) return
    setMailModal({
      to: aan,
      subject: '',
      text: `${t('lbl_dear')} ${selected.naam.split(' ')[0] || ''},\n\n\n\n${t('lbl_kind_regards')},\n${(breweryDetails as any)?.naam || appName || ''}`,
    })
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  const bestelNr = (b: any): string => b.wc_order_nummer ? `WC-${b.wc_order_nummer}` : `M-${b.id}`
  const bestelStatus = (b: any) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_COLORS[b.status] || 'bg-gray-100'}`}>
      {t(`orders_status_${b.status}`, b.status)}
    </span>
  )
  const bestellingKolommen: LijstKolom<any>[] = [
    { id: 'datum', kop: t('lbl_date'), cel: (b: any) => <span className="text-gray-600 whitespace-nowrap">{fmtD(b.datum)}</span> },
    { id: 'nr', kop: t('factuur_number'), cel: (b: any) => <span className="font-mono text-xs text-gray-700">{bestelNr(b)}</span> },
    { id: 'status', kop: t('lbl_status'), cel: bestelStatus },
    { id: 'bruto', kop: t('lbl_bruto'), rechts: true, klasse: 'whitespace-nowrap', cel: (b: any) => <span className="font-semibold">{fmt(orderBruto(b))}</span> },
  ]
  const factuurKolommen: LijstKolom<any>[] = [
    { id: 'datum', kop: t('lbl_date'), cel: (f: any) => <span className="text-gray-600 whitespace-nowrap">{fmtD(f.datum)}</span> },
    { id: 'nr', kop: t('factuur_number'), cel: (f: any) => <span className="font-mono text-xs text-gray-700">{f.factuurnummer || t('lbl_onbekend')}</span> },
    { id: 'status', kop: t('lbl_status'), cel: (f: any) => <VerkoopPil stand={verkoopStand(f, factuurCtx)} /> },
    { id: 'bruto', kop: t('lbl_bruto'), rechts: true, klasse: 'whitespace-nowrap', cel: (f: any) => <span className="font-semibold">{fmt(f.bruto || 0)}</span> },
  ]

  if (view === 'detail') {
    const emailValid = !form.email || EMAIL_RE.test(form.email.trim())
    // Ongekoppelde orders die op e-mail óf naam bij deze klant horen. Bij een
    // bestaande klant: match op de opgeslagen gegevens (de koppel-knop werkt
    // daar ook mee). Bij een nieuwe klant: kijk in het formulier — zo ziet de
    // gebruiker direct hoeveel orders straks gekoppeld worden op opslaan.
    const checkEmail = (selectedId !== null ? selected?.email : form.email.trim()) || ''
    const checkNaam = (selectedId !== null ? selected?.naam : form.naam.trim()) || ''
    // Nieuwe kaart: precies wat opslaan gaat koppelen (bij naamgenoten niet
    // op naam). Bestaande kaart: wat de koppelknop hieronder aanbiedt.
    const ongekoppeldeOrders = !(checkEmail || checkNaam) ? 0
      : selectedId === null
        ? ordersTeKoppelenBijOpslaan(bestellingen, klanten, {
            klantId: null, email: checkEmail, naam: checkNaam, synthKey: synthSourceKey,
          }).length
        : bestellingen.filter((b: any) => matchOngekoppeldeOrder(b, checkEmail, checkNaam)).length

    return (
      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {dirty ? (
            <BevestigKnop v="secondary" vraag={t('klanten_terug_vraag')} onBevestig={naarLijst}>
              {t('btn_back')}
            </BevestigKnop>
          ) : (
            <button type="button" onClick={naarLijst}
              className="flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 min-h-tap sm:min-h-0 transition-colors">
              {t('btn_back')}
            </button>
          )}
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            {selectedId !== null && selected?.klantnummer && (
              <span className="font-mono text-base text-gray-400">{selected.klantnummer}</span>
            )}
            <span>{selectedId !== null ? (selected?.naam || t('lbl_naamloos')) : t('klanten_new')}</span>
          </h2>
          {form.klant_type && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${form.klant_type === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {t(form.klant_type === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {selectedId !== null && (
              <Btn v="secondary" onClick={mailKlant} disabled={!smtpCreds?.enabled || !form.email || !emailValid}
                title={!smtpCreds?.enabled ? t('mail_no_smtp') : (!form.email ? t('mail_no_recipient') : '')}>
                ✉ {t('klanten_mail_klant')}
              </Btn>
            )}
            <Btn onClick={save} disabled={!form.naam.trim() || (selectedId !== null && !dirty && !synthSourceKey)}>
              {t('btn_save')}
            </Btn>
            {selectedId !== null && (
              <Btn v="danger" onClick={() => setShowDeleteConfirm(true)}>
                {t('btn_delete')}
              </Btn>
            )}
          </div>
        </div>

        {/* Stats-cards */}
        {selectedStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{selectedStats.bestellingen.length}</div>
              <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_orders')}</div>
              {selectedStats.laatsteDatum && (
                <div className="text-[11px] text-gray-500 mt-0.5">{t('klanten_stat_last_order')}: {fmtD(selectedStats.laatsteDatum)}</div>
              )}
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center" title={t('klanten_omzet_tooltip')}>
              <div className="text-2xl font-bold text-green-700">{fmt(selectedStats.omzet)}</div>
              <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_omzet')}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{t('klanten_omzet_sub')}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center" title={t('klanten_open_orders_tooltip')}>
              <div className={`text-2xl font-bold ${selectedStats.openOrders > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                {selectedStats.openOrders > 0 ? fmt(selectedStats.openOrders) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_open_orders')}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{t('klanten_open_orders_sub')}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className={`text-2xl font-bold ${selectedStats.openstaand > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                {selectedStats.openstaand > 0 ? fmt(selectedStats.openstaand) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_openstaand')}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Klantgegevens */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <SectionHeader title={t('klanten_section_details')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Inp label={t('lbl_name') + ' *'} value={form.naam} onChange={v => update({naam: v})} />
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  {t('klanten_klantnummer')}
                </label>
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-mono flex items-center justify-between">
                  <span>
                    {selectedId !== null
                      ? (selected?.klantnummer || nextKlantnummer(klanten))
                      : nextKlantnummer(klanten)}
                  </span>
                  <span className="text-[11px] text-gray-500 font-sans">
                    {t('klanten_klantnummer_auto_label')}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('klanten_type')}</label>
                <select value={form.klant_type}
                  onChange={(e: any) => update({klant_type: e.target.value})}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none">
                  <option value="prive">{t('lbl_prive')}</option>
                  <option value="zakelijk">{t('lbl_zakelijk')}</option>
                </select>
              </div>
              <Inp label={t('klanten_bedrijf')} value={form.bedrijf} onChange={v => update({bedrijf: v})} />
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('lbl_email')}</label>
                <input type="email" value={form.email} onChange={(e: any) => update({email: e.target.value})}
                  placeholder={t('klanten_email_placeholder')}
                  className={`w-full border rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all ${
                    form.email && !emailValid ? 'border-red-300 bg-red-50' : 'border-gray-200'
                  }`} />
                {form.email && !emailValid && (
                  <p className="mt-1 text-xs text-red-600">{t('klanten_email_invalid')}</p>
                )}
              </div>
              <Inp label={t('lbl_telefoon')} value={form.telefoon} onChange={v => update({telefoon: v})} />
              <Inp label={t('settings_betalingstermijn')} type="number" value={form.betalingstermijn} onChange={v => update({betalingstermijn: v})} placeholder="14" />
              <Inp label={t('lbl_klant_korting')} type="number" value={form.korting_pct} onChange={v => update({korting_pct: v})} placeholder="0" />
            </div>
          </div>

          {/* Adres + zakelijk */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <SectionHeader title={t('klanten_section_address')} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Inp label={t('lbl_straat')} value={form.straat} onChange={v => update({straat: v})} cls="sm:col-span-2" />
              <Inp label={t('lbl_huisnummer')} value={form.huisnummer} onChange={v => update({huisnummer: v})} />
              <Inp label={t('lbl_postcode')} value={form.postcode} onChange={v => update({postcode: v})} />
              <Inp label={t('lbl_stad')} value={form.stad} onChange={v => update({stad: v})} cls="sm:col-span-2" />
              {/* Land bepaalt op de e-factuur (UBL) of een 0%-regel een
                  intracommunautaire levering of export buiten de EU is.
                  Leeg = binnenland. */}
              <Sel label={t('lbl_land')} value={form.land} onChange={v => update({land: v})}
                opts={landOpties(getLang())} ph={t('lbl_land_binnenland')} />
              <Inp label={t('lbl_btw_nr')} value={form.btw_nummer} onChange={v => update({btw_nummer: v})} cls="sm:col-span-2" />
              <Inp label={t('lbl_kvk')} value={form.kvk_nummer} onChange={v => update({kvk_nummer: v})} />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-gray-500 mb-1">{t('klanten_notities')}</label>
              <textarea value={form.notities} onChange={(e: any) => update({notities: e.target.value})} rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none" />
            </div>
          </div>
        </div>

        {/* Koppel-melding voor ongekoppelde orders */}
        {ongekoppeldeOrders > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center justify-between gap-3 flex-wrap">
            <div>
              {selectedId !== null
                ? t('klanten_unlinked_hint').replace('{n}', String(ongekoppeldeOrders))
                : t('klanten_unlinked_hint_new').replace('{n}', String(ongekoppeldeOrders))}
            </div>
            {selectedId !== null && (
              <BevestigKnop v="secondary" onBevestig={koppelOrders}
                vraag={t('klanten_link_orders_confirm').replace('{n}', String(ongekoppeldeOrders))}>
                {t('klanten_link_orders_btn')}
              </BevestigKnop>
            )}
          </div>
        )}

        {/* Bestellingen + facturen. Een bestelling opent Bestellingen, een
            factuur het factuurdetail op Administratie › Facturen. */}
        {selectedId !== null && selectedStats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 min-w-0">
            <section className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">
                {t('nav_bestellingen')} ({selectedStats.bestellingen.length})
              </h3>
              <ResponsiveLijst
                rijen={[...selectedStats.bestellingen].sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))}
                sleutel={(b: any) => b.id}
                kolommen={bestellingKolommen}
                kaart={(b: any) => (
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 font-mono">{bestelNr(b)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{fmtD(b.datum)}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold tabular-nums">{fmt(orderBruto(b))}</div>
                      <div className="mt-1">{bestelStatus(b)}</div>
                    </div>
                  </div>
                )}
                onKies={(b: any) => { setOpenOrderId(b.id); setPage('bestellingen') }}
                rijLabel={(b: any) => `${bestelNr(b)}, ${fmtD(b.datum)}`}
                label={t('nav_bestellingen')}
                leeg={<LegeStaat titel={t('klanten_no_orders')} />}
              />
            </section>

            <section className="min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-800">
                  {t('nav_facturen')} ({selectedStats.facturen.length})
                </h3>
                {gaNaarDoel && selectedStats.facturen.length > 0 && (
                  <button type="button"
                    onClick={() => {
                      // Alle facturen van de klant, zoals hier: de gedeelde
                      // periode gaat op "alles" (status Alles, filter op de klant).
                      zetGedeeldePeriode('alles')
                      gaNaarDoel({ pagina: 'facturen', tab: 'verkoop', filter: `klant:${selectedId}` })
                    }}
                    className="t-accent-text text-sm font-medium hover:underline min-h-tap sm:min-h-0 px-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    {t('klanten_facturen_van_klant')}
                  </button>
                )}
              </div>
              <ResponsiveLijst
                rijen={[...selectedStats.facturen].sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))}
                sleutel={(f: any) => f.id}
                kolommen={factuurKolommen}
                kaart={(f: any) => (
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 font-mono break-words">{f.factuurnummer || t('lbl_onbekend')}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{fmtD(f.datum)}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold tabular-nums">{fmt(f.bruto || 0)}</div>
                      <div className="mt-1"><VerkoopPil stand={verkoopStand(f, factuurCtx)} /></div>
                    </div>
                  </div>
                )}
                onKies={gaNaarDoel ? (f: any) => gaNaarDoel({ pagina: 'facturen', tab: 'verkoop', id: Number(f.id) }) : undefined}
                rijLabel={(f: any) => `${f.factuurnummer || t('lbl_onbekend')}, ${fmtD(f.datum)}`}
                label={t('nav_facturen')}
                leeg={<LegeStaat titel={t('klanten_geen_facturen')} />}
              />
            </section>
          </div>
        )}

        {showDeleteConfirm && (
          <Modal title={t('klanten_delete_title')} onClose={() => setShowDeleteConfirm(false)}>
            <p className="text-sm text-gray-600 mb-4">{t('klanten_delete_confirm').replace('{naam}', selected?.naam || '')}</p>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowDeleteConfirm(false)}>{t('btn_cancel')}</Btn>
              <Btn v="danger" onClick={deleteKlant}>{t('btn_delete')}</Btn>
            </div>
          </Modal>
        )}

        {mailModal && (
          <MailModal
            title={t('klanten_mail_klant')}
            initialTo={mailModal.to}
            initialSubject={mailModal.subject}
            initialText={mailModal.text}
            brewery={breweryDetails}
            logoDataUri={factuurLogo || logo}
            replyTo={(breweryDetails as any)?.email}
            smtpReady={!!smtpCreds?.enabled}
            onClose={() => setMailModal(null)}
            onSent={(sentTo) => {
              if (selectedId !== null) {
                logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'gewijzigd', omschrijving:`Mail verstuurd aan ${sentTo || selected?.email}`})
              }
            }}
          />
        )}
      </div>
    )
  }

  // ── LIJSTWEERGAVE ─────────────────────────────────────────────────────────

  const totaalOmzet = centNaarEuro(klanten.reduce((s: number, k: any) => s + (statsPerKlant[k.id]?.omzetCent || 0), 0))
  const totaalOpenOrders = klanten.reduce((s: number, k: any) => s + (statsPerKlant[k.id]?.openOrders || 0), 0)
    + syntheticKlanten.reduce((s: number, k: any) => s + (k._stats?.openOrders || 0), 0)
  const totaalOpenstaand = centNaarEuro(klanten.reduce((s: number, k: any) => s + (statsPerKlant[k.id]?.openstaandCent || 0), 0))
  const synthCount = syntheticKlanten.length

  const statsVan = (k: any) => k._synthetic
    ? k._stats
    : (statsPerKlant[k.id] || {bestellingen: [], omzet: 0, openOrders: 0, openstaand: 0, laatsteDatum: ''})
  // De oranje stip: alleen bij een vervallen factuur (utils/klantFacturen.ts).
  const vervallenStip = (k: any) => !k._synthetic && klantenMetVervallen.has(String(k.id)) && (
    <span className="inline-block w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"
      title={t('tooltip_expired_invoices')} aria-label={t('tooltip_expired_invoices')} role="img" />
  )
  const synthBadge = (k: any) => k._synthetic && (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 uppercase tracking-wide">
      {t('klanten_synth_badge')}
    </span>
  )
  const bedragOfStreep = (v: number, kleur: string) => v > 0
    ? <span className={kleur}>{fmt(v)}</span>
    : <span className="text-gray-400">—</span>
  const klantKolommen: LijstKolom<any>[] = [
    { id: 'naam', kop: t('lbl_name'), cel: (k: any) => (
      <span className="block min-w-0">
        <span className="font-medium text-gray-800 flex items-center gap-2 flex-wrap">
          {vervallenStip(k)}
          {k.klantnummer && <span className="font-mono text-xs text-gray-400">{k.klantnummer}</span>}
          <span className={k._synthetic ? 'italic text-gray-600' : ''}>{k.naam || t('lbl_naamloos')}</span>
          {synthBadge(k)}
        </span>
        {k.bedrijf && <span className="block text-xs text-gray-500 mt-0.5">{k.bedrijf}</span>}
      </span>
    ) },
    { id: 'email', kop: t('lbl_email'), breed: true, cel: (k: any) => <span className="text-gray-500 text-xs break-all">{k.email || '—'}</span> },
    { id: 'telefoon', kop: t('lbl_telefoon'), breed: true, cel: (k: any) => <span className="text-gray-500 text-xs whitespace-nowrap">{k.telefoon || '—'}</span> },
    { id: 'orders', kop: t('klanten_stat_orders'), rechts: true, cel: (k: any) => <span className="font-mono">{statsVan(k).bestellingen.length || '—'}</span> },
    { id: 'omzet', kop: <span title={t('klanten_omzet_tooltip')}>{t('klanten_stat_omzet')}</span>, rechts: true, klasse: 'whitespace-nowrap',
      cel: (k: any) => <span className="font-semibold">{bedragOfStreep(statsVan(k).omzet, 'text-green-700')}</span> },
    { id: 'open_orders', kop: <span title={t('klanten_open_orders_tooltip')}>{t('klanten_stat_open_orders')}</span>, rechts: true, klasse: 'whitespace-nowrap',
      cel: (k: any) => <span className="font-medium">{bedragOfStreep(statsVan(k).openOrders, 'text-blue-700')}</span> },
    { id: 'openstaand', kop: t('klanten_stat_openstaand'), rechts: true, klasse: 'whitespace-nowrap',
      cel: (k: any) => <span className="font-medium">{bedragOfStreep(statsVan(k).openstaand, 'text-orange-600')}</span> },
    { id: 'laatste', kop: t('klanten_stat_last_order'), rechts: true, breed: true,
      cel: (k: any) => <span className="text-gray-500 text-xs whitespace-nowrap">{statsVan(k).laatsteDatum ? fmtD(statsVan(k).laatsteDatum) : '—'}</span> },
  ]
  // Telefoon: naam en wat er openstaat in één kaart; de hele kaart opent de klant.
  const klantKaart = (k: any) => {
    const st = statsVan(k)
    return (
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap break-words">
            {vervallenStip(k)}
            <span className={k._synthetic ? 'italic text-gray-600' : ''}>{k.naam || t('lbl_naamloos')}</span>
            {synthBadge(k)}
          </div>
          {(k.bedrijf || k.email) && <div className="text-xs text-gray-500 mt-0.5 break-words">{k.bedrijf || k.email}</div>}
          <div className="text-xs text-gray-500 mt-0.5">
            {t('klanten_stat_orders')}: {st.bestellingen.length}
            {st.laatsteDatum ? ` · ${fmtD(st.laatsteDatum)}` : ''}
          </div>
        </div>
        <div className="text-right flex-shrink-0 text-sm tabular-nums">
          {st.omzet > 0 && <div className="font-semibold text-green-700">{fmt(st.omzet)}</div>}
          {st.openstaand > 0 && <div className="text-xs font-medium text-orange-600">{t('klanten_stat_openstaand')} {fmt(st.openstaand)}</div>}
          {/* Open orders (nog te factureren) — op het bureau een eigen kolom. */}
          {st.openOrders > 0 && <div className="text-xs font-medium text-blue-700">{t('klanten_stat_open_orders')} {fmt(st.openOrders)}</div>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_klanten')}</h2>
        <Btn onClick={openNew}>+ {t('klanten_new')}</Btn>
      </div>

      {synthCount > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-start gap-2">
          <Icon n="info" cls="flex-shrink-0 mt-0.5" />
          <span className="min-w-0">{t('klanten_synth_explainer').replace('{n}', String(synthCount))}</span>
        </div>
      )}

      {/* Stats-overzicht */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-800">{klanten.length}{synthCount > 0 && <span className="text-base text-blue-600 ml-1">+{synthCount}</span>}</div>
          <div className="text-xs text-gray-500 mt-1">{t('klanten_totaal')}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center" title={t('klanten_omzet_tooltip')}>
          <div className="text-2xl font-bold text-green-700">{fmt(totaalOmzet)}</div>
          <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_omzet_totaal')}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{t('klanten_omzet_sub')}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center" title={t('klanten_open_orders_tooltip')}>
          <div className={`text-2xl font-bold ${totaalOpenOrders > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
            {totaalOpenOrders > 0 ? fmt(totaalOpenOrders) : '—'}
          </div>
          <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_open_orders_totaal')}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{t('klanten_open_orders_sub')}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <div className={`text-2xl font-bold ${totaalOpenstaand > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
            {totaalOpenstaand > 0 ? fmt(totaalOpenstaand) : '—'}
          </div>
          <div className="text-xs text-gray-500 mt-1">{t('klanten_stat_openstaand_totaal')}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card p-4 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t('klanten_search_placeholder')} />
      </div>

      <ResponsiveLijst
        rijen={filtered}
        sleutel={(k: any) => k.id}
        kolommen={klantKolommen}
        kaart={klantKaart}
        onKies={(k: any) => k._synthetic ? openNewFromSynth(k) : openDetail(k)}
        rijLabel={(k: any) => k.naam || t('lbl_naamloos')}
        rijKlasse={(k: any) => k._synthetic ? 'bg-blue-50/40' : ''}
        label={t('nav_klanten')}
        leeg={klanten.length === 0 && syntheticKlanten.length === 0
          ? <LegeStaat titel={t('klanten_leeg')} icoon="user"><Btn onClick={openNew}>+ {t('klanten_new')}</Btn></LegeStaat>
          : <LegeStaat titel={t('klanten_no_search_results')} icoon="search" />}
      />
    </div>
  )
}

export default KlantenPage
