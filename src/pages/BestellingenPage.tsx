import React, { useState } from 'react'
import { t } from '../i18n'
import { newId, wcGet, volgendFactuurNummer, volgendBestelNummer } from '../utils/api'
import { geslotenPeriodeSets, magFactuurMuteren } from '../utils/btw'
import { fmt, fmtD, tod } from '../utils/format'
import { accijnsCalc, tariefVoorDatum, voorraadPerLocatie, getAgpLocatie, pickUitgeslagen } from '../utils/calculations'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import { printPakbon, printFactuur, buildPakbonHTML, buildFactuurHTML } from '../components/PakbonExport'
import MailModal from '../components/MailModal'
import { htmlToPdfBase64 } from '../utils/pdf'
import { logAudit } from '../utils/audit'
import { resolveKlantSnapshot, findKlantVoorOrder } from '../utils/klant'
import { verkoopFactuurBoeking, stornoBoekingVoor, voegBoekingToe } from '../utils/journaal'
import { totaliseerRegels, centNaarEuro } from '../utils/centen'
import { regelBedrag, heeftAutoritair } from '../utils/orderRegel'

interface BestellingenPageProps {
  bat: any[]
  av: any[]
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
  openOrderId?: number | null
  setOpenOrderId?: (id: number | null) => void
  klanten: any[]
  setKlanten?: any
  auditLog?: any[]
  setAuditLog?: any
  producten?: any[]
  productArtikelen?: any[]
  locaties?: any[]
  verplaatsingen?: any[]
  afboekingen?: any[]
  smtpCreds?: any
  mailTemplates?: any
  btwTarieven?: (number | string)[]
  btwInst?: any
  btwAangiftes?: any[]
  bankKoppelingen?: Record<string, any>
  setJournaal?: any
}

type StatusFilter = 'alle' | 'nieuw' | 'bevestigd' | 'gepickt' | 'verzonden' | 'afgerond' | 'geannuleerd'

const STATUS_COLORS: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
  bevestigd: 'bg-cyan-100 text-cyan-700',
  gepickt: 'bg-orange-100 text-orange-700',
  verzonden: 'bg-purple-100 text-purple-700',
  afgerond: 'bg-green-100 text-green-700',
  geannuleerd: 'bg-gray-100 text-gray-500',
}

const BestellingenPage: React.FC<BestellingenPageProps> = ({
  bat, av, uit, setUit, acc, setAcc,
  artikelen, verpakkingen=[], bestellingen, setBestellingen,
  bestellingPicks, setBestellingPicks,
  verkoopFacturen, setVerkoopFacturen,
  wcCreds, accijnsInst, breweryDetails, appName='', logo=null,
  factuurCounter, setFactuurCounter=()=>{},
  log=[], setLog=()=>{}, factuurLogo=null,
  openOrderId=null, setOpenOrderId=()=>{},
  klanten=[],
  auditLog=[], setAuditLog=()=>{},
  producten=[], productArtikelen=[],
  locaties=[], verplaatsingen=[], afboekingen=[],
  smtpCreds={enabled:false},
  mailTemplates={},
  btwTarieven=[0, 9, 21],
  btwInst={}, btwAangiftes=[], bankKoppelingen={},
  setJournaal=()=>{},
}) => {
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Ontgrendelt het corrigeren van de BTW op een reeds afgeronde order (past dan
  // ook de gekoppelde verkoopfactuur aan). Bewust expliciet, want normaal is een
  // afgeronde order vergrendeld.
  const [btwCorrectie, setBtwCorrectie] = useState<number | null>(null)

  // Navigate to order when openOrderId is set (e.g. from BoekhoudingPage)
  React.useEffect(() => {
    if (openOrderId != null) {
      const order = bestellingen.find((b: any) => b.id === openOrderId)
      if (order) {
        setSelectedId(openOrderId)
        setView('detail')
      }
      setOpenOrderId(null)
    }
  }, [openOrderId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle')
  const [wcImporting, setWcImporting] = useState(false)
  const [wcMsg, setWcMsg] = useState('')
  const [showManualModal, setShowManualModal] = useState(false)
  const [showPickModal, setShowPickModal] = useState(false)
  const [showAfrondModal, setShowAfrondModal] = useState(false)
  const [uitleveringForm, setUitleveringForm] = useState({type_uitlevering: 'binnenland' as string, bestemming_naam: '', bestemming_adres: '', bestemming_land: 'NL', vervoerder: ''})
  const [showAnnuleerModal, setShowAnnuleerModal] = useState(false)
  const [showVrijeRegelModal, setShowVrijeRegelModal] = useState(false)
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'})
  const [showVerzendkostenModal, setShowVerzendkostenModal] = useState(false)
  const [verzendkostenForm, setVerzendkostenForm] = useState({naam: '', prijs_per_stuk: '', btw_pct: '21'})

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
  const emptyRegel = {bier_naam: '', verpakking_type: '', aantal: '1', prijs_per_stuk: '', btw_pct: '9', omschrijving: '', prijsType: 'normaal'}
  const [regelForm, setRegelForm] = useState<any>(emptyRegel)
  const [manualVerzending, setManualVerzending] = useState({enabled: false, naam: '', prijs: '', btw_pct: '21'})

  const selectedOrder = (bestellingen||[]).find((b: any) => b.id === selectedId)

  // Snapshot van de bestelling met overschreven klant_*-velden uit de live
  // klantkaart. Reeds gegenereerde PDF's blijven hun historische snapshot
  // houden — alleen rendering en mailing volgen de actuele klantkaart.
  const resolvedSelectedOrder = selectedOrder
    ? resolveKlantSnapshot(selectedOrder, klanten)
    : null

  // Gefilterde en gesorteerde lijst
  const filtered = [...(bestellingen||[])]
    .filter(b => statusFilter === 'alle' || b.status === statusFilter)
    .sort((a, b) => b.datum.localeCompare(a.datum))

  // Ordertotaal berekenen — cent-exact en met behoud van de autoritatieve
  // WooCommerce-bedragen (zie utils/orderRegel.ts), zodat een WC-order van
  // 2× €2,00 als €4,00 verschijnt en niet als €4,01.
  const orderTotaal = (b: any) =>
    centNaarEuro((b.regels||[]).reduce((s: number, r: any) => s + regelBedrag(r).bruto_cent, 0))

  // Zichtbaar ordernummer. WooCommerce-orders tonen hun WC-nummer; handmatige
  // orders hun korte, oplopende bestelnummer (server-reeks, bijv. "M-0015").
  // Oudere handmatige orders zonder bestel_nummer vallen terug op M-<id>.
  const orderNummer = (b: any): string =>
    b.wc_order_nummer ? `WC-${b.wc_order_nummer}` : (b.bestel_nummer || `M-${b.id}`)

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

  // Beschikbaar voor een afvulling (exclusief open orders picks, inclusief deze bestelling)
  const beschikbaarVoorAfvulling = (a: any, excludeBestellingId?: number): number => {
    const gepickt = (bestellingPicks||[])
      .filter((p: any) => {
        if (p.afvulling_id !== a.id) return false
        if (excludeBestellingId && p.bestelling_id === excludeBestellingId) return false
        // Picks met uitslag-records tellen al mee via `uitgeleverd` hieronder
        if (pickUitgeslagen(p)) return false
        const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id)
        return b && b.status !== 'afgerond' && b.status !== 'geannuleerd'
      })
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
    const uitgeleverd = (uit||[])
      .filter((u: any) => u.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal||0), 0)
    return Math.max(0, Number(a.hoeveelheid||0) - gepickt - uitgeleverd)
  }

  // Beschikbaar per locatie voor een afvulling: fysieke voorraad per locatie
  // (voorraadPerLocatie) minus actieve picks per locatie (van andere orders).
  const beschikbaarPerLocatieVoorAfvulling = (a: any, excludeBestellingId?: number): Record<number, number> => {
    if (!a || !(locaties||[]).length) return {}
    const fysiek = voorraadPerLocatie(a, locaties as any, uit as any, verplaatsingen as any, afboekingen as any)
    const res: Record<number, number> = {...fysiek}
    const agp = getAgpLocatie(locaties as any)
    for (const p of ((bestellingPicks||[]) as any[])) {
      if (p.afvulling_id !== a.id) continue
      if (excludeBestellingId && p.bestelling_id === excludeBestellingId) continue
      // Picks met uitslag-records zitten al in voorraadPerLocatie (uitleveringen)
      if (pickUitgeslagen(p)) continue
      const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id)
      if (!b || b.status === 'afgerond' || b.status === 'geannuleerd') continue
      const locId = p.bron_locatie_id ?? agp.id
      res[locId] = (res[locId] || 0) - Number(p.aantal || 0)
    }
    for (const k of Object.keys(res)) {
      const id = Number(k)
      if (res[id] < 0) res[id] = 0
    }
    return res
  }

  // Beschikbaar voor een afvulling exclusief AGP-voorraad. Gebruikt voor
  // privé-orders die wettelijk niet uit AGP geleverd mogen worden.
  const beschikbaarBuitenAgpVoorAfvulling = (a: any, excludeBestellingId?: number): number => {
    const perLoc = beschikbaarPerLocatieVoorAfvulling(a, excludeBestellingId)
    const agp = getAgpLocatie(locaties as any)
    let total = 0
    for (const k of Object.keys(perLoc)) {
      if (Number(k) !== agp.id) total += Number(perLoc[Number(k)] || 0)
    }
    return total
  }

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

  // Beschikbare afvullingen voor een orderregel (gefilterd op SKU of bier + verpakking)
  const getAvailableAfvullingen = (regelBierNaam: string, regelVerpakking: string, excludeBestellingId?: number, _unused?: any, regelArtikelKey?: string, regelSku?: string) => {
    // Bepaal SKU: direct uit regel, of via artikel_key lookup
    const orderSku = regelSku || (regelArtikelKey ? (artikelen||[]).find((a: any) => a.key === regelArtikelKey)?.artikelnummer : null) || null
    const fefo = (a: any, b: any) => {
      if (!a.tht && !b.tht) return 0
      if (!a.tht) return 1
      if (!b.tht) return -1
      return a.tht.localeCompare(b.tht)
    }
    const filtered = (av||[]).filter((a: any) => beschikbaarVoorAfvulling(a, excludeBestellingId) > 0)
    if (orderSku) {
      // Tier 1: exacte artikel_sku match (nieuwe afvullingen)
      const skuMatches = filtered.filter((a: any) => a.artikel_sku === orderSku)
      if (skuMatches.length > 0) return skuMatches.sort(fefo)
      // Tier 2: oude afvullingen zonder artikel_sku — match via artikel SKU + verpakking_type
      // (batchnaam irrelevant; als batch.biernaam gezet is, moet die ook kloppen)
      return filtered.filter((a: any) => {
        if (a.artikel_sku) return false
        const matchArt = (artikelen||[]).find((art: any) =>
          art.artikelnummer === orderSku &&
          art.verpakking_type?.toLowerCase() === a.verpakking_type?.toLowerCase()
        )
        if (!matchArt) return false
        const batch = bat.find((b: any) => b.id === a.batch_id)
        if (batch?.biernaam) return batch.biernaam === matchArt.biernaam
        return true
      }).sort(fefo)
    }
    // Geen SKU: fallback op bier_naam + verpakking (ook via product_id)
    const prod = (producten||[]).find((p: any) => p.naam.toLowerCase() === regelBierNaam.toLowerCase())
    // Verpakkingsnamen die bij het gevraagde type horen (bijv. "fles" → ["Vichy 33cL", "Fles 33cL", ...])
    const vpNamenVoorType = verpakkingen
      .filter((v: any) => v.type?.toLowerCase() === regelVerpakking.toLowerCase())
      .map((v: any) => v.naam?.toLowerCase())
      .filter(Boolean)
    return filtered
      .filter((a: any) => {
        const avpLower = (a.verpakking_type || '').toLowerCase()
        const matchVerpakking = avpLower === regelVerpakking.toLowerCase()
          || vpNamenVoorType.includes(avpLower)
          || vpNamenVoorType.some((n: string) => avpLower.includes(n) || n.includes(avpLower))
        if (!matchVerpakking) return false
        const batch = bat.find((b: any) => b.id === a.batch_id)
        if (!batch) return false
        if (batch.naam.toLowerCase() === regelBierNaam.toLowerCase()) return true
        if (batch.biernaam && batch.biernaam.toLowerCase() === regelBierNaam.toLowerCase()) return true
        if (prod && (a.product_id === prod.id || batch.product_id === prod.id)) return true
        return false
      })
      .sort(fefo)
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
  const importWcOrders = async () => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) { setWcMsg('⚠ Geen WooCommerce koppeling actief'); return }
    setWcImporting(true); setWcMsg('')
    try {
      const orders = await wcGet('orders?status=processing,pending&per_page=100')
      const bestaandeWcIds = new Set((bestellingen||[]).map((b: any) => b.wc_order_id).filter(Boolean))
      let imported = 0
      const nieuw: any[] = []
      for (const o of (orders||[])) {
        if (bestaandeWcIds.has(o.id)) continue
        const regels = (o.line_items||[]).map((item: any, i: number) => {
          const art = (artikelen||[]).find((a: any) =>
            (a.artikelnummer && a.artikelnummer === item.sku) || a.biernaam === item.name
          )
          const prijs = art?.verkoopprijs != null
            ? Number(art.verkoopprijs)
            : (Number(item.quantity||1) > 0 ? parseFloat(item.subtotal||'0') / Number(item.quantity||1) : 0)
          // BTW% bepalen — voorkeur: het geconfigureerde artikel-tarief (`btw_pct`),
          // anders afgeleid uit de WooCommerce-belasting op de regel, anders het
          // standaardtarief 21% (bier). Let op: het veld heet `btw_pct`, niet `btw`.
          const artBtw = art?.btw_pct != null && art.btw_pct !== '' ? Number(art.btw_pct) : null
          const lineTotal = parseFloat(item.total || item.subtotal || '0')
          const lineTax = parseFloat(item.total_tax || item.subtotal_tax || '0')
          const afgeleidBtw = lineTotal > 0 && lineTax > 0 ? Math.round((lineTax / lineTotal) * 100) : null
          const btwPct = artBtw != null ? artBtw : (afgeleidBtw != null ? afgeleidBtw : 21)
          return {
            id: i + 1,
            type: 'bier',
            sku: item.sku || null,
            artikel_key: art?.key || null,
            artikel_id: art?.id || null,
            bier_naam: art?.biernaam || item.name || '',
            verpakking_type: art?.verpakking_type || '',
            aantal: Number(item.quantity||1),
            prijs_per_stuk: prijs,
            btw_pct: btwPct,
            omschrijving: item.name || '',
            // Autoritatieve regelbedragen van WooCommerce bewaren wanneer er
            // écht BTW is berekend (lineTax > 0). WooCommerce verkoopt op ronde
            // incl-BTW-prijzen (€2,00); zonder deze waarden reconstrueert de app
            // het bruto uit een ex-BTW-prijs en ontstaat een cent kasverschil
            // (2× €2,00 → €4,01 i.p.v. €4,00). Zie utils/orderRegel.ts.
            ...(lineTax > 0 ? { wc_netto: lineTotal, wc_btw: lineTax } : {}),
          }
        })
        const company = (o.billing?.company || '').trim()
        // BTW-nummer alléén uit échte BTW-nummervelden (bijv. _billing_vat_number,
        // billing_eu_vat_number, btw_nummer). WooCommerce zet op elke order
        // standaard meta zoals `is_vat_exempt: "no"` — de eerdere generieke
        // /vat|btw/-match pakte die key, waardoor élke import onterecht als
        // zakelijk werd gemarkeerd. De waarde moet bovendien op een BTW-nummer
        // lijken (bevat cijfers, geen ja/nee-vlag).
        const vatMeta = (Array.isArray(o.meta_data) ? o.meta_data : []).find((m: any) =>
          /(vat|btw)[_-]?(number|nummer|nr|id)\b/i.test(String(m?.key || '')))
        const vatRaw = String(o.billing?.vat_number || vatMeta?.value || '').trim()
        const vatNr = /\d/.test(vatRaw) && !/^(yes|no|true|false|0|1)$/i.test(vatRaw) ? vatRaw : ''
        const klantType: 'prive' | 'zakelijk' = (company || vatNr) ? 'zakelijk' : 'prive'
        const nb: any = {
          id: newId([...(bestellingen||[]), ...nieuw]),
          status: 'nieuw',
          datum: (o.date_created||tod()).slice(0, 10),
          klant_naam: `${o.billing?.first_name||''} ${o.billing?.last_name||''}`.trim() || t('lbl_onbekend'),
          klant_email: o.billing?.email||'',
          klant_straat: o.billing?.address_1||'',
          klant_huisnummer: '',
          klant_postcode: o.billing?.postcode||'',
          klant_stad: o.billing?.city||'',
          klant_bedrijf: company,
          klant_type: klantType,
          regels,
          wc_order_id: o.id,
          wc_order_nummer: String(o.number||o.id),
        }
        // Koppel direct aan een bestaande klantkaart (e-mail, of uniek op
        // naam) zodat de order niet eerst als "ongekoppeld" binnenkomt.
        const bestaandeKlant = findKlantVoorOrder(nb, klanten)
        if (bestaandeKlant) nb.klant_id = bestaandeKlant.id
        nieuw.push(nb)
        imported++
      }
      if (nieuw.length) {
        setBestellingen((prev: any[]) => [...(prev||[]), ...nieuw])
        nieuw.forEach((o: any) => logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:o.id, actie:'aangemaakt', omschrijving:`WC import — ${o.klant_naam||'onbekend'}`}))
      }
      setWcMsg(t('msg_wc_orders_imported').replace('{n}', String(imported)))
    } catch(e: any) {
      setWcMsg(t('msg_wc_import_failed').replace('{msg}', e.message))
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

  // --- Handmatige order opslaan ---
  const saveManualOrder = async () => {
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
          id: regels.length + 1,
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
        id: regels.length + 1,
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
  }

  const addRegel = () => {
    if (!regelForm.bier_naam || !regelForm.verpakking_type || !regelForm.aantal) {
      alert(t('err_order_line_fields_required')); return
    }
    const artMatch = artikelVoorKeuze(regelForm.bier_naam, regelForm.verpakking_type)
    const regel = {
      id: (manualForm.regels.length + 1),
      type: 'bier',
      artikel_key: artMatch?.key || null,
      artikel_id: artMatch?.id || null,
      bier_naam: regelForm.bier_naam,
      verpakking_type: regelForm.verpakking_type,
      aantal: Number(regelForm.aantal),
      prijs_per_stuk: regelForm.prijs_per_stuk !== '' ? Number(regelForm.prijs_per_stuk) : 0,
      btw_pct: Number(regelForm.btw_pct||9),
      omschrijving: regelForm.omschrijving || `${regelForm.bier_naam} ${regelForm.verpakking_type}`,
      prijsType: regelForm.prijsType || 'normaal',
    }
    setManualForm((f: any) => ({...f, regels: [...f.regels, regel]}))
    setRegelForm(emptyRegel)
  }

  // --- Helper: bouw uitlevering- en accijnsrecords uit picks (Douane v2.4 §10.2) ---
  // Wordt aangeroepen op moment van picking (belastbaar feit) zodat de uitslag-
  // en accijnsrecords ontstaan zodra het bier de AGP verlaat. rondeAf gebruikt
  // deze helper alleen als fallback voor picks die nog geen ids hebben.
  const bouwUitslagRecords = (
    picksIn: any[],
    isPriveOrder: boolean,
    formData: typeof uitleveringForm,
    lokaleUitleveringenStart: any[],
  ) => {
    const nieuweUitleveringen: any[] = []
    const nieuweAccijns: any[] = []
    const pickResult: Record<number, {uitlevering_ids: number[], accijns_ids: number[]}> = {}
    let uitId = newId(uit||[])
    let accId = newId(acc||[])
    const lokaleUitleveringen: any[] = [...lokaleUitleveringenStart]
    const agpLocLocal = getAgpLocatie(locaties as any)
    const vandaag = tod()

    for (const pick of picksIn) {
      const avItem = (av||[]).find((a: any) => a.id === pick.afvulling_id)
      if (!avItem) continue
      const batch = bat.find((b: any) => b.id === pick.batch_id)
      const inhoud = Number(avItem.inhoud_per_eenheid||0)
      const abv = Number(batch?.ABV || 0)
      const plato = Number(batch?.platogehalte || 0)
      pickResult[pick.id] = {uitlevering_ids: [], accijns_ids: []}

      const voorraad = voorraadPerLocatie(avItem, locaties, lokaleUitleveringen, verplaatsingen, afboekingen)
      const locOrder: number[] = []
      if (pick.bron_locatie_id != null) {
        locOrder.push(pick.bron_locatie_id)
      } else {
        for (const l of (locaties||[])) {
          if (!l.is_agp && (voorraad[l.id]||0) > 0) locOrder.push(l.id)
        }
        if (!isPriveOrder) {
          if ((voorraad[agpLocLocal.id]||0) > 0) locOrder.push(agpLocLocal.id)
          for (const k of Object.keys(voorraad)) {
            const id = Number(k)
            if (!locOrder.includes(id) && (voorraad[id]||0) > 0) locOrder.push(id)
          }
          if (locOrder.length === 0) locOrder.push(agpLocLocal.id)
        }
      }

      let resterend = Number(pick.aantal||0)
      for (const locId of locOrder) {
        if (resterend <= 0) break
        const beschikbaar = voorraad[locId] || 0
        if (beschikbaar <= 0 && locId !== agpLocLocal.id) continue
        const aantalDeel = locId === agpLocLocal.id ? resterend : Math.min(resterend, beschikbaar)
        if (aantalDeel <= 0) continue
        const liter = aantalDeel * inhoud
        const isAgp = locId === agpLocLocal.id
        const uitleveringRec: any = {
          id: uitId++,
          batch_id: pick.batch_id,
          afvulling_id: pick.afvulling_id,
          batch_naam: batch?.naam || '',
          verpakking_naam: avItem.verpakking_type || '',
          verpakking_type: avItem.verpakking_type || '',
          inhoud_per_eenheid: inhoud,
          inhoud_liter: liter,
          aantal: aantalDeel,
          verkocht_stuks: aantalDeel,
          datum: vandaag,
          tht: avItem.tht||null,
          accijns_betaald: !isAgp,
          type_uitlevering: formData.type_uitlevering || 'binnenland',
          bestemming_naam: formData.bestemming_naam || '',
          bestemming_adres: formData.bestemming_adres || '',
          bestemming_land: formData.bestemming_land || '',
          vervoerder: formData.vervoerder || '',
          created_at: new Date().toISOString(),
          bron_locatie_id: locId,
        }
        nieuweUitleveringen.push(uitleveringRec)
        lokaleUitleveringen.push(uitleveringRec)
        pickResult[pick.id].uitlevering_ids.push(uitleveringRec.id)

        if (isAgp) {
          const _t = tariefVoorDatum(accijnsInst, batch?.datum)
          const _eff = {...(accijnsInst || {}), tarief_per_hl_plato: _t.r3}
          const accBed = accijnsCalc(liter, abv, _t.r1, _t.r2, _eff, plato)
          const accRec = {
            id: accId++,
            batch_id: pick.batch_id,
            batch_naam: batch?.naam || '',
            batch_nummer: batch?.batch_nummer||'',
            uitlevering_id: uitleveringRec.id,
            verpakking_type: avItem.verpakking_type || '',
            datum: vandaag,
            aantal: aantalDeel,
            liter,
            abv,
            accijns: accBed,
            betaald: false,
            betaal_datum: null,
            bron: 'uitlevering' as const,
          }
          nieuweAccijns.push(accRec)
          pickResult[pick.id].accijns_ids.push(accRec.id)
        }

        resterend -= aantalDeel
      }
    }
    return {nieuweUitleveringen, nieuweAccijns, pickResult}
  }

  // --- Klanttype (privé/zakelijk) van een bestaande order corrigeren ---
  // Alleen vóór het picken: de pick-logica (wel/niet uit AGP leveren) leest
  // dit veld. Handig om een verkeerd gedetecteerde WooCommerce-import recht
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
    const klantType = effectiveKlantType(selectedOrder)
    const isPriveOrder = klantType === 'prive'
    const agpLoc = getAgpLocatie(locaties as any)
    // Privé-orders mogen hard niet uit AGP geleverd worden
    if (isPriveOrder) {
      for (const picks of Object.values(draftPicks)) {
        for (const p of picks as any[]) {
          if (!p.aantal || p.aantal <= 0) continue
          if (p.bron_locatie_id != null && p.bron_locatie_id === agpLoc.id) {
            alert(t('err_prive_geen_agp'))
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
      const beschik = isPriveOrder
        ? beschikbaarBuitenAgpVoorAfvulling(afvItem, selectedOrder.id)
        : beschikbaarVoorAfvulling(afvItem, selectedOrder.id)
      if (totaal > beschik) {
        const errKey = isPriveOrder ? 'err_prive_buiten_agp_ontoereikend' : 'agp_voorraad_ontoereikend'
        alert(t(errKey).replace('{beschikbaar}', `${beschik}× ${afvItem.verpakking_type||''}`))
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
        alert(t('err_locatie_voorraad_ontoereikend')
          .replace('{locatie}', loc?.naam || '?')
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
    const allFull = (selectedOrder.regels||[]).filter((r: any) => r.type === 'bier').every((r: any) => {
      const picked = newPicks.filter((p: any) => p.regel_id === r.id).reduce((s: number, p: any) => s + p.aantal, 0)
      return picked >= r.aantal
    })

    if (allFull) {
      // Belastbaar feit (Douane v2.4 §10.2): bij volledige picking maken we
      // direct de uitslag- en accijnsrecords aan. Het bier verlaat de AGP.
      const {nieuweUitleveringen, nieuweAccijns, pickResult} =
        bouwUitslagRecords(newPicks, isPriveOrder, uitleveringForm, uit||[])

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
      setAcc((prev: any[]) => [...(prev||[]), ...nieuweAccijns])
      setBestellingen((prev: any[]) => prev.map((b: any) =>
        b.id === selectedOrder.id ? {...b, status: 'gepickt', pick_datum: tod()} : b
      ))
      // Eén log-regel per uitlevering (uitslag uit AGP)
      setLog((prev: any[]) => {
        let logId = newId(prev||[])
        const nieuweLogEntries = nieuweUitleveringen.map((u: any) => ({
          id: logId++,
          datum: tod(),
          type: 'uitslaan',
          batch_id: u.batch_id,
          batch_naam: u.batch_naam || '',
          afvulling_id: u.afvulling_id,
          verpakking_type: u.verpakking_type || u.verpakking_naam || '',
          hoeveelheid: u.aantal,
          eenheid: 'stuks',
          referentie: '',
          omschrijving: `Picking — ${selectedOrder.klant_naam} (uitslag uit AGP)`,
        }))
        return [...(prev||[]), ...nieuweLogEntries]
      })
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Bestelling',
        entiteit_id: selectedOrder.id,
        actie: 'gewijzigd',
        omschrijving: `Picks bevestigd — ${selectedOrder.klant_naam} (uitslag uit AGP, ${nieuweUitleveringen.length} uitleveringen, ${nieuweAccijns.length} accijnsregels)`,
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

  // --- Markeer als verzonden (logistieke statusovergang — Douane v2.4 §10.2) ---
  const markVerzonden = () => {
    if (!selectedOrder) return
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, status: 'verzonden', verzend_datum: tod()} : b
    ))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: selectedOrder.id,
      actie: 'gewijzigd',
      omschrijving: `${selectedOrder.klant_naam} — verzonden (logistiek, geen fiscaal effect)`,
    })
  }

  // --- Order afronden (factuur + pakbon, status → afgerond) ---
  // Belastbaar feit is bij savePicks afgehandeld (Douane v2.4 §10.2).
  // Hier alleen de factuur- en pakbongeneratie + status verandering.
  const rondeAf = async () => {
    if (!selectedOrder) return
    const picks = picksVoorOrder(selectedOrder.id)
    if (!picks.length) { alert(t('err_order_no_picks')); return }
    const klantType = effectiveKlantType(selectedOrder)
    const isPriveOrder = klantType === 'prive'
    const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
    const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
    const vandaag = tod()
    const pakbonNummer = genPakbonNummer()

    // 1+2. Uitlevering- en AccijnsRecord-records, gesplitst per bron-locatie.
    //   - Voorraad buiten AGP wordt eerst aangesproken (al accijns betaald).
    //   - Voorraad in AGP genereert nieuwe AccijnsRecord-boekingen.
    // Per pick kunnen er meerdere Uitleveringen ontstaan wanneer voorraad gemengd is.
    const agpLoc = getAgpLocatie(locaties)

    // Records bestaan normaliter al uit savePicks (Douane v2.4 §10.2 — belastbaar
    // feit op moment van picken). Alleen wanneer een pick (legacy/back-compat)
    // nog geen uitlevering_ids heeft, maken we de records hier alsnog aan.
    const picksZonderRecords = picks.filter((p: any) => !((p.uitlevering_ids||[]).length > 0 || p.uitlevering_id))

    // Privé-orders: hard pre-flight. AGP mag in geen enkel scenario gebruikt
    // worden. Controleer alléén picks die nog géén uitslagrecords hebben — picks
    // die bij het picken al uit de voorraad zijn gehaald (en daar al gevalideerd
    // werden) zouden anders dubbel afgetrokken worden: hun uitlevering staat al
    // in `uit`, waardoor de voorraad-buiten-AGP onterecht als ontoereikend telt
    // en het sluiten van de order ten onrechte geblokkeerd wordt.
    if (isPriveOrder) {
      for (const pick of picksZonderRecords) {
        const avItem = (av||[]).find((a: any) => a.id === pick.afvulling_id)
        if (!avItem) continue
        if (pick.bron_locatie_id != null && pick.bron_locatie_id === agpLoc.id) {
          alert(t('err_prive_geen_agp')); return
        }
        // Auto-allocatie: voorraad buiten AGP moet voldoende zijn
        if (pick.bron_locatie_id == null) {
          const voorraad = voorraadPerLocatie(avItem, locaties as any, uit as any, verplaatsingen as any, afboekingen as any)
          let buitenAgp = 0
          for (const l of (locaties||[])) {
            if (!l.is_agp) buitenAgp += Number(voorraad[l.id] || 0)
          }
          if (buitenAgp < Number(pick.aantal || 0)) {
            alert(t('err_prive_buiten_agp_ontoereikend').replace('{beschikbaar}', `${buitenAgp}× ${avItem.verpakking_type||''}`))
            return
          }
        }
      }
    }
    // Factuurnummer pas ná alle validaties server-side ophalen (atomair,
    // ERP-plan 0.2) zodat een afgebroken afronding geen nummer verbruikt.
    let factuurNummer: string
    try { factuurNummer = await volgendFactuurNummer('factuur') }
    catch (e) { alert(t('err_factuurnummer_ophalen')); return }

    let nieuweUitleveringen: any[] = []
    let nieuweAccijns: any[] = []
    let pickResult: Record<number, {uitlevering_ids: number[], accijns_ids: number[]}> = {}
    if (picksZonderRecords.length > 0) {
      const built = bouwUitslagRecords(picksZonderRecords, isPriveOrder, uitleveringForm, uit||[])
      nieuweUitleveringen = built.nieuweUitleveringen
      nieuweAccijns = built.nieuweAccijns
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

    // (variabelen r1/r2 hierboven zijn niet meer nodig sinds bouwUitslagRecords
    //  het tarief per batch zelf bepaalt — laat ze staan voor back-compat als
    //  andere code in deze functie ze in de toekomst nodig heeft.)

    // 3. VerkoopFactuur
    const rnd2 = (n: number) => Math.round(n * 100) / 100
    const regelsList: any[] = (selectedOrder.regels||[]).map((r: any) => {
      // Bedragen via regelBedrag: autoritatieve WooCommerce-bedragen zijn
      // leidend (voorkomt cent-kasverschil), anders klassieke reconstructie.
      const b = regelBedrag(r)
      return {
        omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`,
        hoeveelheid: Number(r.aantal||0),
        prijs_per_stuk: Number(r.prijs_per_stuk||0),
        btw_pct: Number(r.btw_pct||0),
        netto: b.netto,
        btw_bedrag: b.btw,
        bruto: b.bruto,
        ...(heeftAutoritair(r) ? { wc_netto: Number(r.wc_netto), wc_btw: Number(r.wc_btw) } : {}),
      }
    })
    // Statiegeld auto-pass: voor elke bier-regel met een verpakking die statiegeld
    // heeft, één extra factuurregel toevoegen (BTW altijd 0%). WooCommerce-orders
    // mogen al een statiegeldregel meesturen — in dat geval slaan we de auto-pass
    // over om dubbele boeking te voorkomen.
    const wcHasOwnDeposit = !!selectedOrder.wc_order_id && (selectedOrder.regels||[]).some((r: any) => {
      const oms = String(r.omschrijving||'').toLowerCase()
      return oms.includes('statiegeld') || oms.includes('deposit') || oms.includes('borg')
    })
    if (!wcHasOwnDeposit) {
      ;(selectedOrder.regels||[]).forEach((r: any) => {
        if (r.type && r.type !== 'bier') return
        const vp = (verpakkingen||[]).find((v: any) =>
          (r.verpakking_id && v.id === r.verpakking_id) ||
          (v.naam && r.verpakking_type && String(v.naam).toLowerCase() === String(r.verpakking_type).toLowerCase()) ||
          (v.type && r.verpakking_type && String(v.type).toLowerCase() === String(r.verpakking_type).toLowerCase())
        )
        const bedrag = Number(vp?.statiegeld_bedrag || 0)
        const soort = vp?.statiegeld_soort
        if (!vp || bedrag <= 0 || (soort !== 'snd' && soort !== 'fust')) return
        const aantal = Number(r.aantal||0)
        if (aantal === 0) return
        const netto = rnd2(aantal * bedrag)
        regelsList.push({
          omschrijving: `${t(soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')} – ${vp.naam}`,
          hoeveelheid: aantal,
          prijs_per_stuk: bedrag,
          btw_pct: 0,
          netto,
          btw_bedrag: 0,
          bruto: netto,
          statiegeld_soort: soort,
          verpakking_id: vp.id,
        })
      })
    }
    const btwTarieven = [...new Set(regelsList.map((r: any) => Number(r.btw_pct||0)))] as number[]
    const btw_overzicht = btwTarieven.map(tarief => {
      const regelsVanTarief = regelsList.filter((r: any) => Number(r.btw_pct||0) === tarief)
      return {
        tarief,
        netto: rnd2(regelsVanTarief.reduce((s: number, r: any) => s + r.netto, 0)),
        btw: rnd2(regelsVanTarief.reduce((s: number, r: any) => s + r.btw_bedrag, 0)),
      }
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const factuurTotalen = totaliseerRegels(regelsList)
    // Klantgegevens uit de live klantkaart (via klant_id of email-match) zodat
    // de factuur ook bij volgende renders/mails de actuele waarden vindt.
    const snap = resolveKlantSnapshot(selectedOrder, klanten)
    const verkoopFact: any = {
      id: newId(verkoopFacturen||[]),
      datum: vandaag,
      factuurnummer: factuurNummer,
      bestelling_id: selectedOrder.id,
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
      status: 'open',
      definitief: true,
    }

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
    if (nieuweAccijns.length > 0) {
      setAcc((prev: any[]) => [...(prev||[]), ...nieuweAccijns])
    }
    setVerkoopFacturen((prev: any[]) => [...(prev||[]), verkoopFact])
    // Journaal (ERP-plan 2.1): orderfactuur is bij uitreiken definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(verkoopFact)))
    setBestellingen((prev: any[]) => prev.map((b: any) => b.id === selectedOrder.id ? {
      ...b,
      status: 'afgerond',
      verzend_datum: b.verzend_datum || vandaag,
      factuur_id: verkoopFact.id,
      factuur_nummer: factuurNummer,
      pakbon_nummer: pakbonNummer,
    } : b))
    // Log:
    //  - bestaande "uitslaan"-loggregels (van savePicks) krijgen nu het factuurnummer
    //  - eventuele fallback-uitleveringen worden alsnog gelogd
    //  - één samenvattende factuur-entry
    setLog((prev: any[]) => {
      const orderUitlIds = new Set<number>(alleUitleveringenVoorOrder.map((u: any) => u.id))
      const updated = (prev||[]).map((l: any) =>
        l.type === 'uitslaan' && orderUitlIds.has(l.afvulling_id ?? -1)
          ? l // afvulling_id != uitlevering_id; we matchen liever via batch+order, daarom een eenvoudiger criterium hieronder
          : l
      )
      let logId = newId(updated)
      const fallbackLog = nieuweUitleveringen.map((u: any) => ({
        id: logId++,
        datum: vandaag,
        type: 'uitslaan',
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
      omschrijving: `${selectedOrder.klant_naam} — afgerond, factuur ${factuurNummer} (${alleUitleveringenVoorOrder.length} uitleveringen)`,
    })
    setShowAfrondModal(false)
  }

  const annuleerOrder = () => {
    if (!selectedOrder) return
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, status: 'geannuleerd'} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Geannuleerd — ${selectedOrder.klant_naam}`})
    setShowAnnuleerModal(false)
    setView('list')
  }

  const addVrijeRegel = () => {
    if (!selectedOrder) return
    const omschr = vrijeRegelForm.omschrijving.trim()
    if (!omschr) { alert(t('err_vrije_regel_omschrijving')); return }
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

  const removeRegel = (regelId: number) => {
    if (!selectedOrder) return
    const regel = (selectedOrder.regels||[]).find((r: any) => r.id === regelId)
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Regel verwijderd: ${regel?.bier_naam||regelId}`})
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, regels: (b.regels||[]).filter((r: any) => r.id !== regelId)} : b
    ))
  }

  // Herbereken alle afgeleide BTW-velden van een verkoopfactuur uit zijn regels
  // (netto/btw_bedrag/bruto per regel + btw_overzicht + totalen). Zelfde rekenwijze
  // als bij het opstellen in `rondeAf`.
  const herberekenFactuur = (fact: any) => {
    const rnd2 = (n: number) => Math.round(n * 100) / 100
    const regels = (fact.regels||[]).map((r: any) => {
      // Autoritatieve WooCommerce-bedragen blijven leidend (geen kasverschil);
      // regels zonder die bedragen worden uit hoeveelheid × prijs herberekend.
      const b = regelBedrag(r)
      return {...r, netto: b.netto, btw_bedrag: b.btw, bruto: b.bruto}
    })
    const tarieven = [...new Set(regels.map((r: any) => Number(r.btw_pct||0)))] as number[]
    const btw_overzicht = tarieven.map(tarief => {
      const rv = regels.filter((r: any) => Number(r.btw_pct||0) === tarief)
      return {
        tarief,
        netto: rnd2(rv.reduce((s: number, r: any) => s + r.netto, 0)),
        btw: rnd2(rv.reduce((s: number, r: any) => s + r.btw_bedrag, 0)),
      }
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const tot = totaliseerRegels(regels)
    return {...fact, regels, btw_overzicht, netto: tot.netto, btw: tot.btw, bruto: tot.bruto,
      netto_cent: tot.netto_cent, btw_cent: tot.btw_cent, bruto_cent: tot.bruto_cent}
  }

  // BTW% van een bestaande orderregel aanpassen (bijv. WC-import die bier op 9%
  // zette corrigeren naar 21%). Bij een afgeronde order (na expliciete
  // "BTW corrigeren") wordt ook de al opgestelde verkoopfactuur meegecorrigeerd,
  // want de BTW-aangifte leest uit de factuur, niet uit de order.
  const updateRegelBtw = (regelId: number, nieuwBtw: number) => {
    if (!selectedOrder) return
    // Periode-lock (ERP-plan 0.4): zodra de gekoppelde factuur meetelt in een
    // ingediende/betaalde BTW-periode is corrigeren geblokkeerd — dat zou de
    // aangiftecijfers achteraf veranderen. Correctie dan via creditnota.
    if (selectedOrder.factuur_id != null) {
      const fact = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
      if (fact) {
        const periodeType = (btwInst?.periode === 'maand' ? 'maand' : 'kwartaal') as 'maand'|'kwartaal'
        const {ingediend, betaald} = geslotenPeriodeSets(btwAangiftes||[], bankKoppelingen||{})
        if (!magFactuurMuteren(fact, periodeType, ingediend, betaald)) {
          alert(t('err_periode_gesloten_mutatie')); return
        }
      }
    }
    const orderRegels = selectedOrder.regels||[]
    const regelIdx = orderRegels.findIndex((r: any) => r.id === regelId)
    const regel = orderRegels[regelIdx]
    // Bij een expliciete tariefwijziging vervallen de autoritatieve
    // WooCommerce-bedragen van déze regel: het nieuwe tarief moet leidend zijn,
    // dus de BTW wordt weer uit netto × btw% herberekend.
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id
        ? {...b, regels: (b.regels||[]).map((r: any) => {
            if (r.id !== regelId) return r
            const {wc_netto, wc_btw, ...rest} = r
            return {...rest, btw_pct: nieuwBtw}
          })}
        : b
    ))
    // Gekoppelde verkoopfactuur meecorrigeren. De factuurregels zijn 1-op-1 in
    // dezelfde volgorde uit de orderregels opgebouwd (statiegeldregels komen
    // erná), dus factuurregel op positie `regelIdx` hoort bij deze orderregel.
    if (selectedOrder.factuur_id != null && regelIdx >= 0) {
      const fact = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
      if (fact) {
        const regels = (fact.regels||[]).map((fr: any, i: number) => {
          if (i !== regelIdx) return fr
          const {wc_netto, wc_btw, ...rest} = fr
          return {...rest, btw_pct: nieuwBtw}
        })
        const nieuweFactuur = herberekenFactuur({...fact, regels})
        setVerkoopFacturen((prev: any[]) => (prev||[]).map((f: any) => f.id === fact.id ? nieuweFactuur : f))
        // Journaal (ERP-plan 2.1): correctie op een al geboekte factuur =
        // storno van de oude regels + herboeking van de gecorrigeerde factuur.
        setJournaal((prev: any[]) => voegBoekingToe(
          voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'verkoop_factuur', fact.id)),
          verkoopFactuurBoeking(nieuweFactuur)))
      }
    }
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`BTW gewijzigd: ${regel?.bier_naam||regelId} → ${nieuwBtw}%${selectedOrder.factuur_id != null ? ` (factuur ${selectedOrder.factuur_nummer||selectedOrder.factuur_id} bijgewerkt)` : ''}`})
  }

  // Beschikbare BTW-tarieven voor de dropdown (uit instellingen, met fallback).
  const btwOpts = ((btwTarieven && btwTarieven.length ? btwTarieven : [0, 9, 21]))
    .map((p: any) => ({v: String(p), l: `${p}%`}))

  const openPickModal = () => {
    if (!selectedOrder) return
    // Initialiseer draft picks vanuit bestaande picks
    const bestaand: Record<number, Array<{afvulling_id: number, aantal: number}>> = {}
    picksVoorOrder(selectedOrder.id).forEach((p: any) => {
      if (!bestaand[p.regel_id]) bestaand[p.regel_id] = []
      bestaand[p.regel_id].push({afvulling_id: p.afvulling_id, aantal: p.aantal})
    })
    setDraftPicks(bestaand)
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
    printPakbon(orderVoorPakbon, picksVoorOrder(selectedOrder.id), av, bat, breweryDetails||{}, appName, factuurLogo||logo)
  }

  const printOrderFactuur = () => {
    if (!selectedOrder) return
    const factuur = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
    if (!factuur) { alert(t('err_no_invoice_for_order')); return }
    printFactuur(resolvedSelectedOrder!, factuur, breweryDetails||{}, appName, factuurLogo||logo)
  }

  // ── Mail-modal state ────────────────────────────────────────────────────
  const [mailModal, setMailModal] = React.useState<null | {
    title: string
    to: string
    subject: string
    text: string
    attachments?: {filename: string, contentBase64: string, mimeType: string}[]
    /** Type mail — bepaalt het log-bericht en (bij 'bevestiging') een status-
     * overgang van 'nieuw' naar 'bevestigd' na succesvolle verzending. */
    kind?: 'pakbon' | 'factuur' | 'bevestiging'
  }>(null)
  const [mailGenerating, setMailGenerating] = React.useState(false)

  const interpolate = (tpl: string, vars: Record<string, string>): string =>
    Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)

  // Pakt subject/body uit ingestelde mail_templates; valt terug op de i18n-default
  // wanneer de gebruiker niets heeft ingevuld (lege string of niet aanwezig).
  const tplOrDefault = (key: 'pakbon'|'factuur'|'bestelling', field: 'subject'|'body'): string => {
    const stored = (mailTemplates as any)?.[key]?.[field]
    if (typeof stored === 'string' && stored.trim()) return stored
    return t(`mail_${key}_${field === 'subject' ? 'subject' : 'body'}_default`)
  }

  const mailOrderPakbon = async () => {
    if (!selectedOrder) return
    setMailGenerating(true)
    try {
      const orderVoorPakbon = {...resolvedSelectedOrder!, pakbon_datum: pakbonDatumVoor(selectedOrder)}
      const {html, filename} = buildPakbonHTML(orderVoorPakbon, picksVoorOrder(selectedOrder.id), av, bat, breweryDetails||{}, appName, factuurLogo||logo)
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
      alert(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(false)
  }

  const mailOrderFactuur = async () => {
    if (!selectedOrder) return
    const factuur = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
    if (!factuur) { alert(t('err_no_invoice_for_order')); return }
    setMailGenerating(true)
    try {
      const html = buildFactuurHTML(resolvedSelectedOrder!, factuur, breweryDetails||{}, appName, factuurLogo||logo)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const pdfBase64 = await htmlToPdfBase64(html)
      const bedrag = fmt(factuur.bruto || 0)
      const termijn = (breweryDetails as any)?.betalingstermijn ?? 14
      const verval = (() => {
        try {
          const d = new Date(factuur.datum); d.setDate(d.getDate() + Number(termijn))
          return d.toLocaleDateString('nl-NL', {day:'2-digit', month:'2-digit', year:'numeric'})
        } catch { return '' }
      })()
      const vars = {
        naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
        nr: factuurNr,
        bedrag: '€ ' + bedrag,
        vervaldatum: verval,
        iban: (breweryDetails as any)?.iban || '',
        brouwerij: (breweryDetails as any)?.naam || appName || '',
      }
      setMailModal({
        title: t('mail_modal_title_factuur'),
        to: (resolvedSelectedOrder?.klant_email || ''),
        subject: interpolate(tplOrDefault('factuur', 'subject'), vars),
        text: interpolate(tplOrDefault('factuur', 'body'), vars),
        attachments: [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        kind: 'factuur',
      })
    } catch (e: any) {
      alert(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(false)
  }

  const mailOrderBevestiging = () => {
    if (!selectedOrder) return
    const orderRef = orderNummer(selectedOrder)
    const regelLijst = (selectedOrder.regels||[]).map((r: any) =>
      `- ${r.aantal}× ${r.bier_naam || r.omschrijving || ''}${r.verpakking_type ? ` (${r.verpakking_type})` : ''}`
    ).join('\n')
    const vars = {
      naam: (resolvedSelectedOrder?.klant_naam || resolvedSelectedOrder?.klant_bedrijf || ''),
      nr: orderRef,
      regels: regelLijst,
      brouwerij: (breweryDetails as any)?.naam || appName || '',
    }
    setMailModal({
      title: t('mail_modal_title_bestelling'),
      to: (resolvedSelectedOrder?.klant_email || ''),
      subject: interpolate(tplOrDefault('bestelling', 'subject'), vars),
      text: interpolate(tplOrDefault('bestelling', 'body'), vars),
      kind: 'bevestiging',
    })
  }

  // --- RENDER ---

  if (view === 'detail' && selectedOrder) {
    const picks = picksVoorOrder(selectedOrder.id)
    const totaal = orderTotaal(selectedOrder)
    const allPicked = (selectedOrder.regels||[]).filter((r: any) => r.type === 'bier').every((r: any) => gepicktVoorRegel(selectedOrder.id, r.id) >= r.aantal)

    return (
      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 transition-colors">
            {t('btn_back')}
          </button>
          <h2 className="text-xl font-bold text-gray-800">
            {orderNummer(selectedOrder)}
          </h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[selectedOrder.status]||'bg-gray-100'}`}>
            {t(`orders_status_${selectedOrder.status}`)||selectedOrder.status}
          </span>
          {(() => {
            const kType = effectiveKlantType(selectedOrder)
            if (!kType) return null
            // Vóór het picken mag privé/zakelijk nog gecorrigeerd worden
            // (bijv. een verkeerd gedetecteerde WooCommerce-import). Daarna is
            // het type bevroren omdat de AGP-allocatie erop gebaseerd is.
            const aanpasbaar = selectedOrder.status === 'nieuw' || selectedOrder.status === 'bevestigd'
            if (!aanpasbaar) return (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${kType === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                {t(kType === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
              </span>
            )
            return (
              <div className="inline-flex bg-gray-100 rounded-full p-0.5" title={t('tip_order_klant_type')}>
                {(['prive', 'zakelijk'] as const).map(kt => (
                  <button key={kt} type="button"
                    onClick={() => { if (kt !== kType) wijzigKlantType(kt) }}
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${kType === kt
                      ? (kt === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700')
                      : 'text-gray-400 hover:text-gray-600'}`}>
                    {t(kt === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
                  </button>
                ))}
              </div>
            )
          })()}
          <span className="text-sm text-gray-500 ml-auto">{fmtD(selectedOrder.datum)}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Klantgegevens — leest live van de klantkaart (via klant_id of
              email-match) zodat een e-mail-/adreswijziging op de klant
              direct hier en in alle mail-velden zichtbaar is. Snapshot op
              de order blijft als fallback voor orders zonder match. */}
          {(() => {
            const r        = resolvedSelectedOrder || selectedOrder
            const naam     = r.klant_naam     || ''
            const bedrijf  = r.klant_bedrijf  || ''
            const email    = r.klant_email    || ''
            const straat   = r.klant_straat   || ''
            const huisnr   = r.klant_huisnummer || ''
            const postcode = r.klant_postcode || ''
            const stad     = r.klant_stad     || ''
            return (
              <div className="bg-white rounded-xl shadow-card p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('orders_klant')}</div>
                <div className="font-semibold text-gray-800">{naam}</div>
                {bedrijf && <div className="text-sm text-gray-600">{bedrijf}</div>}
                {email && <div className="text-sm text-gray-500">{email}</div>}
                {straat && (
                  <div className="text-sm text-gray-500 mt-1">
                    {[straat, huisnr].filter(Boolean).join(' ')}<br/>
                    {[postcode, stad].filter(Boolean).join(' ')}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Orderinfo */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Order</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{t('orders_date')}</span><span>{fmtD(selectedOrder.datum)}</span></div>
              {(() => {
                const pd = pakbonDatumVoor(selectedOrder)
                return pd && pd !== selectedOrder.datum
                  ? <div className="flex justify-between"><span className="text-gray-500">{t('orders_pick_date')}</span><span>{fmtD(pd)}</span></div>
                  : null
              })()}
              {selectedOrder.verzend_datum && <div className="flex justify-between"><span className="text-gray-500">{t('factuur_delivery_date')}</span><span>{fmtD(selectedOrder.verzend_datum)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">{t('orders_total')}</span><span className="font-semibold">{fmt(totaal)}</span></div>
              {selectedOrder.factuur_nummer && <div className="flex justify-between"><span className="text-gray-500">{t('factuur_number')}</span><span className="font-mono">{selectedOrder.factuur_nummer}</span></div>}
              {selectedOrder.pakbon_nummer && <div className="flex justify-between"><span className="text-gray-500">{t('pakbon_number')}</span><span className="font-mono">{selectedOrder.pakbon_nummer}</span></div>}
              {selectedOrder.opmerkingen && <div className="pt-1 text-xs text-gray-500 italic">{selectedOrder.opmerkingen}</div>}
            </div>
          </div>
        </div>

        {/* Orderregels */}
        <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
          <SectionHeader
            title={t('orders_lines')}
            info={selectedOrder.status === 'afgerond' ? (
              btwCorrectie === selectedOrder.id
                ? <button onClick={() => setBtwCorrectie(null)} className="underline hover:text-white">{t('orders_btw_correctie_klaar')}</button>
                : <button onClick={() => setBtwCorrectie(selectedOrder.id)} className="underline hover:text-white">{t('orders_btw_correctie')}</button>
            ) : undefined}
          />
          {btwCorrectie === selectedOrder.id && (
            <div className="px-4 py-2 bg-orange-50 text-orange-700 text-xs border-b border-orange-100">
              {t('orders_btw_correctie_hint')}
            </div>
          )}
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">{t('pakbon_beer')}</th>
                <th className="px-3 py-2 text-left">{t('pakbon_packaging')}</th>
                <th className="px-3 py-2 text-right">{t('manual_order_qty')}</th>
                <th className="px-3 py-2 text-right">{t('manual_order_price')}</th>
                <th className="px-3 py-2 text-right">{t('manual_order_btw')}</th>
                <th className="px-3 py-2 text-right">Totaal excl.</th>
                <th className="px-3 py-2 text-center">{t('picking_picked')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(selectedOrder.regels||[]).map((r: any) => {
                const gepickt = gepicktVoorRegel(selectedOrder.id, r.id)
                const volledig = gepickt >= r.aantal
                const isVrij = r.type === 'vrij' || r.type === 'verzending' || r.type === 'korting'
                const canDelete = isVrij && selectedOrder.status !== 'afgerond' && selectedOrder.status !== 'geannuleerd'
                const isBtwCorrectie = selectedOrder.status === 'afgerond' && btwCorrectie === selectedOrder.id
                const canEditBtw = (selectedOrder.status !== 'afgerond' && selectedOrder.status !== 'geannuleerd') || isBtwCorrectie
                return (
                  <tr key={r.id} className={isVrij ? 'bg-blue-50' : volledig ? 'bg-green-50' : ''}>
                    <td className="px-3 py-2 font-medium">
                      {r.bier_naam}
                      {r.sku && <span className="ml-1 font-mono text-xs text-gray-400">[{r.sku}]</span>}
                      {r.type === 'verzending' && <span className="ml-1 text-xs text-blue-500">🚚</span>}
                      {r.type === 'vrij' && <span className="ml-1 text-xs text-purple-500">✎</span>}
                      {r.type === 'korting' && <span className="ml-1 text-xs font-semibold text-green-600">%</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.verpakking_type}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.aantal}×</td>
                    <td className="px-3 py-2 text-right">{fmt(r.prijs_per_stuk)}</td>
                    <td className="px-3 py-2 text-right">
                      {canEditBtw ? (
                        <select
                          value={String(r.btw_pct)}
                          onChange={(e) => updateRegelBtw(r.id, Number(e.target.value))}
                          className="border border-gray-200 rounded px-1.5 py-1 text-sm bg-white t-input outline-none"
                          title={t('orders_edit_btw')}
                        >
                          {btwOpts.some((o: any) => o.v === String(r.btw_pct))
                            ? null
                            : <option value={String(r.btw_pct)}>{r.btw_pct}%</option>}
                          {btwOpts.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      ) : `${r.btw_pct}%`}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(r.aantal * r.prijs_per_stuk)}</td>
                    <td className="px-3 py-2 text-center">
                      {canDelete
                        ? <button onClick={() => removeRegel(r.id)} className="text-gray-300 hover:text-red-500 transition-colors text-xs" title={t('btn_delete')}>✕</button>
                        : isVrij ? <span className="text-xs text-blue-400">—</span>
                        : <span className={`text-xs font-semibold ${volledig ? 'text-green-600' : gepickt > 0 ? 'text-orange-500' : 'text-gray-400'}`}>{gepickt}/{r.aantal}</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        {/* Picks overzicht (na picking) */}
        {picks.length > 0 && (
          <div className="bg-white rounded-xl shadow-card mb-4 overflow-hidden">
            <SectionHeader title={t('picking_title')} />
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('pakbon_batch')}</th>
                  <th className="px-3 py-2 text-left">{t('pakbon_packaging')}</th>
                  <th className="px-3 py-2 text-left">{t('pakbon_tht')}</th>
                  <th className="px-3 py-2 text-right">{t('pakbon_qty')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {picks.map((p: any) => {
                  const avItem = (av||[]).find((a: any) => a.id === p.afvulling_id)
                  const batch = bat.find((b: any) => b.id === p.batch_id)
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2 text-gray-700">{batch?.naam}{batch?.batch_nummer ? ` #${batch.batch_nummer}` : ''}</td>
                      <td className="px-3 py-2 text-gray-600">{avItem?.verpakking_type}</td>
                      <td className="px-3 py-2 text-gray-500">{avItem?.tht ? fmtD(avItem.tht) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.aantal}×</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Actieknoppen */}
        <div className="flex flex-wrap gap-2">
          {(selectedOrder.status === 'nieuw' || selectedOrder.status === 'bevestigd' || selectedOrder.status === 'gepickt') && (
            <Btn v="blue" onClick={openPickModal}>{t('order_pick')}</Btn>
          )}
          {(selectedOrder.status === 'nieuw' || selectedOrder.status === 'bevestigd' || selectedOrder.status === 'gepickt') && (<>
            <Btn v="secondary" onClick={() => { setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'}); setShowVrijeRegelModal(true) }}>
              + {t('btn_vrije_regel')}
            </Btn>
            <Btn v="secondary" onClick={addVerzendkosten}>🚚 {t('btn_verzendkosten')}</Btn>
          </>)}
          {selectedOrder.status === 'gepickt' && allPicked && (<>
            <Btn v="secondary" onClick={printOrderPakbon}>🖨 {t('order_print_pakbon')}</Btn>
            <Btn v="secondary" onClick={mailOrderPakbon} disabled={!smtpCreds?.enabled || mailGenerating} title={!smtpCreds?.enabled ? t('mail_no_smtp') : ''}>
              {mailGenerating ? '⏳ ' + t('mail_generating_pdf') : '✉ ' + t('order_mail_pakbon')}
            </Btn>
            <Btn v="secondary" onClick={markVerzonden} title={t('tooltip_logistical_status')}>📦 {t('order_mark_shipped')}</Btn>
            <Btn v="green" onClick={() => setShowAfrondModal(true)}>{t('order_complete')}</Btn>
          </>)}
          {selectedOrder.status === 'verzonden' && (
            <Btn v="green" onClick={() => setShowAfrondModal(true)}>{t('order_complete')}</Btn>
          )}
          {(selectedOrder.status === 'afgerond' || selectedOrder.status === 'verzonden') && (<>
            <Btn v="secondary" onClick={printOrderPakbon}>🖨 {t('order_print_pakbon')}</Btn>
            <Btn v="secondary" onClick={printOrderFactuur}>🖨 {t('order_print_factuur')}</Btn>
            <Btn v="secondary" onClick={mailOrderPakbon} disabled={!smtpCreds?.enabled || mailGenerating} title={!smtpCreds?.enabled ? t('mail_no_smtp') : ''}>
              {mailGenerating ? '⏳ ' + t('mail_generating_pdf') : '✉ ' + t('order_mail_pakbon')}
            </Btn>
            <Btn v="secondary" onClick={mailOrderFactuur} disabled={!smtpCreds?.enabled || mailGenerating} title={!smtpCreds?.enabled ? t('mail_no_smtp') : ''}>
              {mailGenerating ? '⏳ ' + t('mail_generating_pdf') : '✉ ' + t('order_mail_factuur')}
            </Btn>
          </>)}
          {(selectedOrder.status === 'nieuw' || selectedOrder.status === 'bevestigd') && (
            <Btn v="secondary" onClick={mailOrderBevestiging} disabled={!smtpCreds?.enabled} title={!smtpCreds?.enabled ? t('mail_no_smtp') : ''}>
              ✉ {selectedOrder.status === 'bevestigd' ? t('order_mail_bevestiging_resend') : t('order_mail_bevestiging')}
            </Btn>
          )}
          {selectedOrder.status !== 'afgerond' && selectedOrder.status !== 'geannuleerd' && (
            <Btn v="danger" onClick={() => setShowAnnuleerModal(true)}>{t('order_cancel')}</Btn>
          )}
        </div>

        {/* Logboekje — chronologisch overzicht van wat er met deze order gebeurd is.
            Leest direct uit de globale auditLog, gefilterd op entiteit/id. */}
        {(() => {
          const entries = (auditLog || [])
            .filter((e: any) => e.entiteit === 'Bestelling' && e.entiteit_id === selectedOrder.id)
            .sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          if (entries.length === 0) return null
          return (
            <div className="bg-white rounded-xl shadow-card mt-4 overflow-hidden">
              <SectionHeader title={t('orders_logboek')} info={entries.length} />
              <ol className="divide-y divide-gray-100">
                {entries.map((e: any) => {
                  const ts = e.timestamp ? new Date(e.timestamp) : null
                  const tsLabel = ts ? ts.toLocaleString('nl-NL', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : ''
                  const dot =
                    e.actie === 'aangemaakt' ? 'bg-blue-500'   :
                    e.actie === 'verwijderd' ? 'bg-red-500'    :
                    e.actie === 'ingelogd'   ? 'bg-gray-400'   :
                                                'bg-amber-500'
                  return (
                    <li key={e.id} className="px-5 py-2.5 flex items-start gap-3">
                      <span className={`inline-block w-2 h-2 mt-1.5 rounded-full ${dot} flex-shrink-0`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-800">{e.omschrijving || t(`audit_actie_${e.actie}`) || e.actie}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {tsLabel}
                          {e.gebruiker && <span className="ml-2">· {e.gebruiker}</span>}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          )
        })()}

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
            onClose={() => setMailModal(null)}
            onSent={() => {
              // Per maild-type een leesbare log-omschrijving — wordt onderaan de
              // order in het logboekje getoond.
              const omschrijving =
                mailModal.kind === 'pakbon'      ? `Pakbon gemaild naar ${mailModal.to}` :
                mailModal.kind === 'factuur'     ? `Factuur gemaild naar ${mailModal.to}` :
                mailModal.kind === 'bevestiging' ? `Bevestigingsmail verstuurd naar ${mailModal.to}` :
                `Mail verstuurd: ${mailModal.subject}`
              logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id: selectedOrder.id, actie:'gewijzigd', omschrijving})
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
          <Modal title={t('order_complete')} onClose={() => setShowAfrondModal(false)}>
            <div className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                <p>Je staat op het punt om deze bestelling af te ronden.</p>
                <p className="mt-2 text-xs text-green-700">Het belastbaar feit is al vastgelegd bij het bevestigen van de picks (Douane v2.4 §10.2). Bij afronden wordt nu nog:</p>
                <ul className="mt-1 space-y-1 list-disc list-inside text-xs">
                  <li>Verkoopfactuur aangemaakt in de boekhouding</li>
                  <li>Pakbon- en factuurnummer gegenereerd</li>
                  <li>Status van de bestelling op 'Afgerond' gezet</li>
                </ul>
              </div>
              {/* AGP: Type uitlevering en bestemmingsgegevens */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_type_uitlevering')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <select value={uitleveringForm.type_uitlevering} onChange={e => setUitleveringForm(f => ({...f, type_uitlevering: e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                      <option value="binnenland">{t('opt_binnenland')}</option>
                      <option value="export">{t('opt_export')}</option>
                    </select>
                  </div>
                  <div>
                    <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_vervoerder')} value={uitleveringForm.vervoerder} onChange={e => setUitleveringForm(f => ({...f, vervoerder: e.target.value}))} />
                  </div>
                </div>
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
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowAfrondModal(false)}>{t('btn_cancel')}</Btn>
                <Btn v="green" onClick={rondeAf}>{t('order_complete')}</Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Picking Modal */}
        {showPickModal && (() => {
          const klantTypeOrder = effectiveKlantType(selectedOrder)
          const isPriveOrder = klantTypeOrder === 'prive'
          return (
          <Modal title={t('picking_title')} onClose={() => setShowPickModal(false)} wide>
            {isPriveOrder && (
              <div className="mb-3 p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-800">
                <strong>{t('lbl_prive')}:</strong> {t('info_prive_buiten_agp')}
              </div>
            )}
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {(selectedOrder.regels||[]).filter((r: any) => r.type === 'bier' || (!r.type && r.bier_naam)).map((r: any) => {
                const draftVoorRegel = draftPicks[r.id] || []
                const totaalGepickt = draftVoorRegel.reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
                const resterend = r.aantal - totaalGepickt
                const allAfvullingen = getAvailableAfvullingen(r.bier_naam, r.verpakking_type, selectedOrder.id, null, r.artikel_key, r.sku)
                // Privé-orders mogen niet uit AGP geleverd worden — filter
                // afvullingen die alleen AGP-voorraad hebben weg.
                const afvullingen = isPriveOrder
                  ? allAfvullingen.filter((a: any) => beschikbaarBuitenAgpVoorAfvulling(a, selectedOrder.id) > 0)
                  : allAfvullingen

                return (
                  <div key={r.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-800">{r.bier_naam} – {r.verpakking_type}{r.sku && <span className="ml-1 font-mono text-xs font-normal text-gray-400">[{r.sku}]</span>}</span>
                      <div className="flex gap-3 text-xs">
                        <span className="text-gray-500">{t('picking_needed')}: <strong>{r.aantal}×</strong></span>
                        <span className={totaalGepickt >= r.aantal ? 'text-green-600 font-semibold' : 'text-orange-500 font-semibold'}>
                          {t('picking_picked')}: {totaalGepickt}×
                        </span>
                        {resterend > 0 && <span className="text-red-500">{t('picking_remaining')}: {resterend}×</span>}
                      </div>
                    </div>

                    {/* Bestaande picks */}
                    {draftVoorRegel.map((dp: any, idx: number) => {
                      const avItem = (av||[]).find((a: any) => a.id === dp.afvulling_id)
                      const avBatch = avItem ? bat.find((b: any) => b.id === avItem.batch_id) : null
                      const avArt = avItem?.artikel_sku
                        ? (artikelen||[]).find((a: any) => a.artikelnummer === avItem.artikel_sku)
                        : avBatch ? (artikelen||[]).find((a: any) => a.key?.toLowerCase() === `${avBatch.biernaam||avBatch.naam}|||${avItem?.verpakking_type}`.toLowerCase()) : null
                      const maxBeschik = (isPriveOrder
                        ? beschikbaarBuitenAgpVoorAfvulling(avItem||{}, selectedOrder.id)
                        : beschikbaarVoorAfvulling(avItem||{}, selectedOrder.id)) + Number(dp.aantal||0)
                      const locLabel = avItem ? voorraadPerLocLabel(avItem) : ''
                      const perLoc = avItem ? beschikbaarPerLocatieVoorAfvulling(avItem, selectedOrder.id) : {}
                      const locOpties = (locaties||[])
                        .filter((l: any) => (perLoc[l.id] || 0) + (dp.bron_locatie_id === l.id ? Number(dp.aantal||0) : 0) > 0)
                        // Privé-orders: AGP-locatie is uitgesloten
                        .filter((l: any) => !isPriveOrder || !l.is_agp)
                      return (
                        <div key={idx} className="mt-1 text-sm">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="flex-1 min-w-0 text-gray-600">
                              <span className="font-medium text-gray-800">{avArt?.biernaam || avBatch?.naam}</span>
                              {avArt?.artikelnummer && <span className="font-mono text-xs text-gray-500 ml-1">[{avArt.artikelnummer}]</span>}
                              {' · '}{avItem?.verpakking_type}
                              {' · '}{t('lbl_tht')}: {avItem?.tht ? fmtD(avItem.tht) : '—'}
                              {avBatch?.batch_nummer && <span className="text-xs text-gray-400"> · Lot {avBatch.batch_nummer}</span>}
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
                            <button onClick={() => setDraftPicks(prev => {
                              const list = (prev[r.id]||[]).filter((_: any, i: number) => i !== idx)
                              return {...prev, [r.id]: list}
                            })} className="text-red-400 hover:text-red-600 text-xs">✕</button>
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
                          const avail = isPriveOrder
                            ? beschikbaarBuitenAgpVoorAfvulling(avAvItem, selectedOrder.id)
                            : beschikbaarVoorAfvulling(avAvItem, selectedOrder.id)
                          const aantal = Math.min(resterend, avail)
                          setDraftPicks(prev => ({
                            ...prev,
                            [r.id]: [...(prev[r.id]||[]), {afvulling_id: avId, aantal}]
                          }))
                          e.target.value = ''
                        }} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm bg-white" defaultValue="">
                          <option value="">+ {t('picking_afvulling')} toevoegen...</option>
                          {afvullingen.map((a: any) => {
                            const avBatch = bat.find((b: any) => b.id === a.batch_id)
                            const avArt = a.artikel_sku
                              ? (artikelen||[]).find((art: any) => art.artikelnummer === a.artikel_sku)
                              : avBatch ? (artikelen||[]).find((art: any) => art.key === `${avBatch.naam}|||${a.verpakking_type}`) : null
                            const beschik = isPriveOrder
                              ? beschikbaarBuitenAgpVoorAfvulling(a, selectedOrder.id)
                              : beschikbaarVoorAfvulling(a, selectedOrder.id)
                            const locLabel = voorraadPerLocLabel(a)
                            return (
                              <option key={a.id} value={a.id}>
                                {avArt?.biernaam || avBatch?.naam}{avArt?.artikelnummer ? ` [${avArt.artikelnummer}]` : ''} · {a.verpakking_type} · {t('lbl_tht')}: {a.tht ? fmtD(a.tht) : '—'}{avBatch?.batch_nummer ? ` · Lot ${avBatch.batch_nummer}` : ''} · {beschik}× beschikbaar{locLabel ? ` · ${locLabel}` : ''}
                              </option>
                            )
                          })}
                        </select>
                      </div>
                    )}
                    {resterend > 0 && afvullingen.length === 0 && (
                      <div className="mt-2 text-xs text-red-500">{t('err_no_stock_available').replace('{bier}', r.bier_naam).replace('{verpakking}', r.verpakking_type)}{r.sku ? ` · SKU: ${r.sku}` : ''}{r.artikel_key ? '' : ''}</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* AGP / uitleveringsgegevens — gebruikt zodra alle picks compleet zijn
                (Douane v2.4 §10.2: belastbaar feit op moment van picken). */}
            <div className="mt-4 border border-amber-200 rounded-lg p-3 bg-amber-50/40 space-y-3">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                Uitslag uit AGP — bestemming &amp; vervoerder
              </div>
              <div className="text-[11px] text-amber-700">
                Bij volledige picking ontstaat het belastbaar feit. Vul hier het type uitlevering en (voor intra-EU/export) de bestemming in.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={uitleveringForm.type_uitlevering}
                  onChange={e => setUitleveringForm(f => ({...f, type_uitlevering: e.target.value}))}
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                  <option value="binnenland">{t('opt_binnenland')}</option>
                  <option value="intra_eu">Intra-EU</option>
                  <option value="export">{t('opt_export')}</option>
                </select>
                <input
                  className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200"
                  placeholder={t('lbl_vervoerder')}
                  value={uitleveringForm.vervoerder}
                  onChange={e => setUitleveringForm(f => ({...f, vervoerder: e.target.value}))} />
              </div>
              {uitleveringForm.type_uitlevering !== 'binnenland' && (
                <div className="grid grid-cols-2 gap-3">
                  <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_naam')} value={uitleveringForm.bestemming_naam} onChange={e => setUitleveringForm(f => ({...f, bestemming_naam: e.target.value}))} />
                  <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_land')} value={uitleveringForm.bestemming_land} onChange={e => setUitleveringForm(f => ({...f, bestemming_land: e.target.value}))} />
                  <input className="t-input col-span-2 w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_adres')} value={uitleveringForm.bestemming_adres} onChange={e => setUitleveringForm(f => ({...f, bestemming_adres: e.target.value}))} />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowPickModal(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={savePicks}>{t('picking_confirm')}</Btn>
            </div>
          </Modal>
          )
        })()}

        {/* Annuleer bevestiging */}
        {showAnnuleerModal && (
          <Modal title={t('order_cancel')} onClose={() => setShowAnnuleerModal(false)}>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">{t('msg_order_cancel_confirm')}</p>
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowAnnuleerModal(false)}>{t('btn_cancel')}</Btn>
                <Btn v="danger" onClick={annuleerOrder}>{t('order_cancel_bevestig')}</Btn>
              </div>
            </div>
          </Modal>
        )}

        {/* Vrije regel modal */}
        {showVrijeRegelModal && (
          <Modal title={t('btn_vrije_regel')} onClose={() => setShowVrijeRegelModal(false)}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_description')} <span className="text-red-400">*</span></label>
                <Inp value={vrijeRegelForm.omschrijving} onChange={(v: string) => setVrijeRegelForm(f => ({...f, omschrijving: v}))} placeholder={t('ph_vrije_regel')} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('manual_order_qty')}</label>
                  <Inp type="number" value={vrijeRegelForm.aantal} onChange={(v: string) => setVrijeRegelForm(f => ({...f, aantal: v}))} placeholder="1" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('manual_order_price')} (excl.)</label>
                  <Inp type="number" value={vrijeRegelForm.prijs_per_stuk} onChange={(v: string) => setVrijeRegelForm(f => ({...f, prijs_per_stuk: v}))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('manual_order_btw')}%</label>
                  <Inp type="number" value={vrijeRegelForm.btw_pct} onChange={(v: string) => setVrijeRegelForm(f => ({...f, btw_pct: v}))} placeholder="21" />
                </div>
              </div>
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
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_description')}</label>
                <Inp value={verzendkostenForm.naam} onChange={(v: string) => setVerzendkostenForm(f => ({...f, naam: v}))} placeholder={t('lbl_verzendkosten')} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('verzendkosten_prijs')}</label>
                  <Inp type="number" value={verzendkostenForm.prijs_per_stuk} onChange={(v: string) => setVerzendkostenForm(f => ({...f, prijs_per_stuk: v}))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('manual_order_btw')}%</label>
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
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <h2 className="text-xl font-bold text-gray-800 mr-4">{t('orders_title')}</h2>
          {(['alle','nieuw','bevestigd','gepickt','verzonden','afgerond','geannuleerd'] as StatusFilter[]).map(s => {
            const count = s === 'alle' ? 0 : (bestellingen||[]).filter(b => b.status === s).length
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${statusFilter===s ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t(`orders_filter_${s}`)||s}
                {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {wcCreds?.enabled && (
            <button onClick={importWcOrders} disabled={wcImporting}
              className="wc-btn flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40">
              {wcImporting ? `⏳ ${t('wc_importing')}` : t('orders_import_wc')}
            </button>
          )}
          {wcMsg && <span className={`text-xs font-medium ${wcMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{wcMsg}</span>}
          <Btn onClick={() => { setManualForm(emptyManual); setShowManualModal(true) }}>{t('orders_new')}</Btn>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center text-gray-400">
          {statusFilter === 'alle' ? t('msg_no_orders') : t('msg_no_orders_status').replace('{status}', t(`orders_filter_${statusFilter}`)||statusFilter)}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((b: any) => {
          const totaal = orderTotaal(b)
          const picks = picksVoorOrder(b.id)
          const orderNr = orderNummer(b)
          const kType = effectiveKlantType(b)
          return (
            <div key={b.id} onClick={() => { setSelectedId(b.id); setView('detail') }}
              className="bg-white rounded-xl shadow-card p-4 cursor-pointer hover:shadow-md transition-shadow flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-sm font-semibold text-gray-700">{orderNr}</span>
                <div>
                  <div className="font-medium text-gray-800 flex items-center gap-2">
                    <span>{b.klant_naam}</span>
                    {kType && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${kType === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {t(kType === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{fmtD(b.datum)} · {t('lbl_n_regels').replace('{n}', String((b.regels||[]).length))}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {picks.length > 0 && <span className="text-xs text-gray-400">{t('msg_stuks_gepickt').replace('{n}', String(picks.reduce((s: number, p: any) => s+p.aantal,0)))}</span>}
                <span className="font-semibold text-gray-800">{fmt(totaal)}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[b.status]||'bg-gray-100'}`}>
                  {t(`orders_status_${b.status}`)||b.status}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Handmatige order modal */}
      {showManualModal && (
        <Modal title={t('manual_order_title')} onClose={() => setShowManualModal(false)} wide>
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Klantgegevens */}
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('orders_klant')}</div>
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
                {manualForm.klant_type === 'prive' && (
                  <div className="mt-1.5 text-xs text-gray-500 italic">{t('info_prive_buiten_agp')}</div>
                )}
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
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('orders_lines')}</div>
              {manualForm.regels.length > 0 && (
                <div className="mb-3 divide-y divide-gray-100 border rounded-lg overflow-hidden">
                  {manualForm.regels.map((r: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-50">
                      <span className="flex-1 font-medium">{r.bier_naam} – {r.verpakking_type}</span>
                      {r.prijsType === 'b2b' && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">B2B</span>}
                      <span className="text-gray-500">{r.aantal}× à {fmt(r.prijs_per_stuk)}</span>
                      <span className="text-gray-400">{r.btw_pct}% BTW</span>
                      <button onClick={() => setManualForm((f: any) => ({...f, regels: f.regels.filter((_: any, i: number) => i !== idx)}))}
                        className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </div>
                  ))}
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
                          btw_pct: art ? String(art.btw||art.btw_pct||'9') : '9'}))
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
                          btw_pct: art ? String(art.btw||art.btw_pct||'9') : '9'}))
                      }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                      <option value="">{t('opt_select_packaging')}</option>
                      {verpakkingVoorBier(regelForm.bier_naam).map((v: string) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
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
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_verzendkosten')}</span>
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
            <Btn v="secondary" onClick={() => setShowManualModal(false)}>{t('btn_cancel')}</Btn>
            <Btn onClick={saveManualOrder}>{t('btn_save')}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default BestellingenPage
