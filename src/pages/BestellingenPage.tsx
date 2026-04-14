import React, { useState } from 'react'
import { t } from '../i18n'
import { newId, wcGet } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { accijnsCalc, voorraadPerLocatie, getAgpLocatie } from '../utils/calculations'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import { printPakbon, printFactuur } from '../components/PakbonExport'
import { logAudit } from '../utils/audit'

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
  auditLog?: any[]
  setAuditLog?: any
  producten?: any[]
  productArtikelen?: any[]
  locaties?: any[]
  verplaatsingen?: any[]
  afboekingen?: any[]
}

type StatusFilter = 'alle' | 'nieuw' | 'gepickt' | 'verzonden' | 'afgerond' | 'geannuleerd'

const STATUS_COLORS: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
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
  auditLog=[], setAuditLog=()=>{},
  producten=[], productArtikelen=[],
  locaties=[], verplaatsingen=[], afboekingen=[]
}) => {
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<number | null>(null)

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
  const [uitslagForm, setUitslagForm] = useState({type_uitslag: 'binnenland' as string, bestemming_naam: '', bestemming_adres: '', bestemming_land: 'NL', vervoerder: ''})
  const [showAnnuleerModal, setShowAnnuleerModal] = useState(false)
  const [showVrijeRegelModal, setShowVrijeRegelModal] = useState(false)
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'})
  const [showVerzendkostenModal, setShowVerzendkostenModal] = useState(false)
  const [verzendkostenForm, setVerzendkostenForm] = useState({naam: '', prijs_per_stuk: '', btw_pct: '21'})

  // Draft picks state (voor picking modal)
  const [draftPicks, setDraftPicks] = useState<Record<number, Array<{afvulling_id: number, aantal: number}>>>({})

  // Manual order form
  const emptyManual = {
    klant_naam: '', klant_email: '', klant_bedrijf: '',
    klant_straat: '', klant_huisnummer: '', klant_postcode: '', klant_stad: '',
    opmerkingen: '',
    regels: [] as any[]
  }
  const [manualForm, setManualForm] = useState<any>(emptyManual)
  const emptyRegel = {bier_naam: '', verpakking_type: '', aantal: '1', prijs_per_stuk: '', btw_pct: '9', omschrijving: '', prijsType: 'normaal'}
  const [regelForm, setRegelForm] = useState<any>(emptyRegel)
  const [manualVerzending, setManualVerzending] = useState({enabled: false, naam: '', prijs: '', btw_pct: '21'})

  const selectedOrder = (bestellingen||[]).find((b: any) => b.id === selectedId)

  // Gefilterde en gesorteerde lijst
  const filtered = [...(bestellingen||[])]
    .filter(b => statusFilter === 'alle' || b.status === statusFilter)
    .sort((a, b) => b.datum.localeCompare(a.datum))

  // Ordertotaal berekenen
  const orderTotaal = (b: any) =>
    (b.regels||[]).reduce((s: number, r: any) =>
      s + Number(r.aantal||0) * Number(r.prijs_per_stuk||0) * (1 + Number(r.btw_pct||0)/100), 0)

  // Picks voor een bestelling
  const picksVoorOrder = (bestelling_id: number) =>
    (bestellingPicks||[]).filter((p: any) => p.bestelling_id === bestelling_id)

  // Aantal gepickt per regel
  const gepicktVoorRegel = (bestelling_id: number, regel_id: number) =>
    (bestellingPicks||[])
      .filter((p: any) => p.bestelling_id === bestelling_id && p.regel_id === regel_id)
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)

  // Beschikbaar voor een afvulling (exclusief open orders picks, inclusief deze bestelling)
  const beschikbaarVoorAfvulling = (a: any, excludeBestellingId?: number): number => {
    const gepickt = (bestellingPicks||[])
      .filter((p: any) => {
        if (p.afvulling_id !== a.id) return false
        if (excludeBestellingId && p.bestelling_id === excludeBestellingId) return false
        const b = (bestellingen||[]).find((bs: any) => bs.id === p.bestelling_id)
        return b && b.status !== 'afgerond' && b.status !== 'geannuleerd'
      })
      .reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
    const uitgeslagen = (uit||[])
      .filter((u: any) => u.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal||0), 0)
    return Math.max(0, Number(a.hoeveelheid||0) - gepickt - uitgeslagen)
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

  // Factuurnummering
  const genFactuurNummer = (): string => {
    const year = new Date().getFullYear()
    const prefix = `F${year}-`
    if (factuurCounter && typeof setFactuurCounter === 'function') {
      const nextNr = (factuurCounter.jaar === year ? factuurCounter.nr : 0) + 1
      setFactuurCounter({jaar: year, nr: nextNr})
      return `${prefix}${String(nextNr).padStart(4, '0')}`
    }
    // Fallback: bereken uit bestaande facturen
    const existing = (verkoopFacturen||[])
      .filter((f: any) => f.factuurnummer?.startsWith(prefix))
      .map((f: any) => parseInt(f.factuurnummer.replace(prefix, ''), 10))
      .filter((n: number) => !isNaN(n))
    const nextNum = existing.length ? Math.max(...existing) + 1 : 1
    return `${prefix}${String(nextNum).padStart(4, '0')}`
  }

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
            btw_pct: art?.btw != null ? Number(art.btw) : 9,
            omschrijving: item.name || '',
          }
        })
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
          klant_bedrijf: o.billing?.company||'',
          regels,
          wc_order_id: o.id,
          wc_order_nummer: String(o.number||o.id),
        }
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

  // --- Handmatige order opslaan ---
  const saveManualOrder = () => {
    if (!manualForm.klant_naam.trim()) { alert(t('err_order_customer_required')); return }
    if (!manualForm.regels.length) { alert(t('err_order_min_lines')); return }
    let regels = [...manualForm.regels];
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
    const nb: any = {
      id: newId(bestellingen||[]),
      status: 'nieuw',
      datum: tod(),
      ...manualForm,
      regels,
      wc_order_id: null,
      wc_order_nummer: null,
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

  // --- Picking opslaan ---
  const savePicks = () => {
    if (!selectedOrder) return
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
      const beschik = beschikbaarVoorAfvulling(afvItem, selectedOrder.id)
      if (totaal > beschik) {
        alert(t('agp_voorraad_ontoereikend').replace('{beschikbaar}', `${beschik}× ${afvItem.verpakking_type||''}`))
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
          uitslag_id: null,
          accijns_id: null,
        })
      }
    }
    // Bestaande picks voor deze order verwijderen, nieuwe toevoegen
    setBestellingPicks((prev: any[]) => [
      ...(prev||[]).filter((p: any) => p.bestelling_id !== selectedOrder.id),
      ...newPicks
    ])
    // Status bijwerken: gepickt als alle regels volledig gepickt
    const allFull = (selectedOrder.regels||[]).filter((r: any) => r.type === 'bier').every((r: any) => {
      const picked = newPicks.filter((p: any) => p.regel_id === r.id).reduce((s: number, p: any) => s + p.aantal, 0)
      return picked >= r.aantal
    })
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      b.id === selectedOrder.id ? {...b, status: allFull ? 'gepickt' : 'nieuw'} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Bestelling', entiteit_id:selectedOrder.id, actie:'gewijzigd', omschrijving:`Picks opgeslagen — ${selectedOrder.klant_naam} (${allFull?'volledig':'deels'} gepickt)`})
    setShowPickModal(false)
    setDraftPicks({})
  }

  // --- Order afronden (atomaire transactie) ---
  const rondeAf = () => {
    if (!selectedOrder) return
    const picks = picksVoorOrder(selectedOrder.id)
    if (!picks.length) { alert(t('err_order_no_picks')); return }
    const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
    const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
    const vandaag = tod()
    const factuurNummer = genFactuurNummer()
    const pakbonNummer = genPakbonNummer()

    // 1+2. Uitslag- en AccijnsRecord-records, gesplitst per bron-locatie.
    //   - Voorraad buiten AGP wordt eerst aangesproken (al accijns betaald).
    //   - Voorraad in AGP genereert nieuwe AccijnsRecord-boekingen.
    // Per pick kunnen er meerdere Uitslagen ontstaan wanneer voorraad gemengd is.
    const agpLoc = getAgpLocatie(locaties)
    const nieuweUitslagen: any[] = []
    const nieuweAccijns: any[] = []
    // Map pick.id → arrays met gegenereerde uitslag-/accijns-ids (voor pick-update)
    const pickResult: Record<number, {uitslag_ids: number[], accijns_ids: number[]}> = {}
    let uitId = newId(uit||[])
    let accId = newId(acc||[])

    // Houd lokale mutaties bij zodat opvolgende picks van dezelfde afvulling
    // de bijgewerkte voorraad zien (i.p.v. de oorspronkelijke).
    const lokaleUitslagen: any[] = [...(uit||[])]

    for (const pick of picks) {
      const avItem = (av||[]).find((a: any) => a.id === pick.afvulling_id)
      if (!avItem) continue
      const batch = bat.find((b: any) => b.id === pick.batch_id)
      const inhoud = Number(avItem.inhoud_per_eenheid||0)
      const abv = Number(batch?.ABV || 0)
      const plato = Number(batch?.platogehalte || 0)
      pickResult[pick.id] = {uitslag_ids: [], accijns_ids: []}

      // Huidige voorraad per locatie voor deze afvulling
      const voorraad = voorraadPerLocatie(avItem, locaties, lokaleUitslagen, verplaatsingen, afboekingen)

      // Locatie-volgorde: niet-AGP eerst, dan AGP
      const locOrder: number[] = []
      for (const l of (locaties||[])) {
        if (!l.is_agp && (voorraad[l.id]||0) > 0) locOrder.push(l.id)
      }
      if ((voorraad[agpLoc.id]||0) > 0) locOrder.push(agpLoc.id)
      // Eventuele locaties die niet meer in `locaties` staan maar wel voorraad hebben
      for (const k of Object.keys(voorraad)) {
        const id = Number(k)
        if (!locOrder.includes(id) && (voorraad[id]||0) > 0) locOrder.push(id)
      }
      // Als nergens voorraad is gevonden, val terug op AGP zodat er altijd één
      // uitslag wordt gemaakt (back-compat met legacy data zonder seed).
      if (locOrder.length === 0) locOrder.push(agpLoc.id)

      let resterend = Number(pick.aantal||0)
      for (const locId of locOrder) {
        if (resterend <= 0) break
        const beschikbaar = voorraad[locId] || 0
        if (beschikbaar <= 0 && locId !== agpLoc.id) continue
        // AGP mag negatief gaan (we forceren de pick door); andere locaties niet.
        const aantalDeel = locId === agpLoc.id ? resterend : Math.min(resterend, beschikbaar)
        if (aantalDeel <= 0) continue
        const liter = aantalDeel * inhoud
        const isAgp = locId === agpLoc.id
        const uitslagRec = {
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
          type_uitslag: uitslagForm.type_uitslag || 'binnenland',
          bestemming_naam: uitslagForm.bestemming_naam || '',
          bestemming_adres: uitslagForm.bestemming_adres || '',
          bestemming_land: uitslagForm.bestemming_land || '',
          vervoerder: uitslagForm.vervoerder || '',
          created_at: new Date().toISOString(),
          bron_locatie_id: locId,
        }
        nieuweUitslagen.push(uitslagRec)
        lokaleUitslagen.push(uitslagRec)
        pickResult[pick.id].uitslag_ids.push(uitslagRec.id)

        if (isAgp) {
          const accBed = accijnsCalc(liter, abv, r1, r2, accijnsInst, plato)
          const accRec = {
            id: accId++,
            batch_id: pick.batch_id,
            batch_naam: batch?.naam || '',
            batch_nummer: batch?.batch_nummer||'',
            uitslag_id: uitslagRec.id,
            verpakking_type: avItem.verpakking_type || '',
            datum: vandaag,
            aantal: aantalDeel,
            liter,
            abv,
            accijns: accBed,
            betaald: false,
            betaal_datum: null,
            bron: 'uitslag' as const,
          }
          nieuweAccijns.push(accRec)
          pickResult[pick.id].accijns_ids.push(accRec.id)
        }

        resterend -= aantalDeel
      }
    }

    // 3. VerkoopFactuur
    const rnd2 = (n: number) => Math.round(n * 100) / 100
    const regelsList: any[] = (selectedOrder.regels||[]).map((r: any) => {
      const netto = rnd2(Number(r.aantal||0) * Number(r.prijs_per_stuk||0))
      const btw_bedrag = rnd2(netto * Number(r.btw_pct||0) / 100)
      return {
        omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`,
        hoeveelheid: Number(r.aantal||0),
        prijs_per_stuk: Number(r.prijs_per_stuk||0),
        btw_pct: Number(r.btw_pct||0),
        netto,
        btw_bedrag,
        bruto: rnd2(netto + btw_bedrag),
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
    const totaalNetto = rnd2(regelsList.reduce((s: number, r: any) => s + r.netto, 0))
    const totaalBtw = rnd2(regelsList.reduce((s: number, r: any) => s + r.btw_bedrag, 0))
    const verkoopFact: any = {
      id: newId(verkoopFacturen||[]),
      datum: vandaag,
      factuurnummer: factuurNummer,
      bestelling_id: selectedOrder.id,
      klant_naam: selectedOrder.klant_naam,
      klant_adres: [selectedOrder.klant_straat, selectedOrder.klant_huisnummer, selectedOrder.klant_postcode, selectedOrder.klant_stad].filter(Boolean).join(' '),
      regels: regelsList,
      btw_overzicht,
      netto: totaalNetto,
      btw: totaalBtw,
      bruto: rnd2(totaalNetto + totaalBtw),
      status: 'open',
    }

    // 4. Updates uitvoeren — pick krijgt arrays met alle uitslag/accijns ids,
    // plus enkelvoudige id voor back-compat (eerste id).
    setBestellingPicks((prev: any[]) => (prev||[]).map((p: any) => {
      if (p.bestelling_id !== selectedOrder.id) return p
      const res = pickResult[p.id]
      if (!res) return p
      return {
        ...p,
        uitslag_id: res.uitslag_ids[0] || null,
        accijns_id: res.accijns_ids[0] || null,
        uitslag_ids: res.uitslag_ids,
        accijns_ids: res.accijns_ids,
      }
    }))
    setUit((prev: any[]) => [...(prev||[]), ...nieuweUitslagen])
    setAcc((prev: any[]) => [...(prev||[]), ...nieuweAccijns])
    setVerkoopFacturen((prev: any[]) => [...(prev||[]), verkoopFact])
    setBestellingen((prev: any[]) => prev.map((b: any) => b.id === selectedOrder.id ? {
      ...b,
      status: 'afgerond',
      verzend_datum: vandaag,
      factuur_id: verkoopFact.id,
      factuur_nummer: factuurNummer,
      pakbon_nummer: pakbonNummer,
    } : b))
    // Log entries: één per uitgeslagen pick
    setLog((prev: any[]) => {
      let logId = newId(prev||[])
      const nieuweLogEntries = nieuweUitslagen.map((u: any) => ({
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
      return [...(prev||[]), ...nieuweLogEntries]
    })
    // Audit log: bestelling afgerond
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: selectedOrder.id,
      actie: 'gewijzigd',
      omschrijving: `${selectedOrder.klant_naam} — ${factuurNummer} (${nieuweUitslagen.length} uitslagen)`,
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

  const printOrderPakbon = () => {
    if (!selectedOrder) return
    const factuur = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
    printPakbon(selectedOrder, picksVoorOrder(selectedOrder.id), av, bat, breweryDetails||{}, appName, factuurLogo||logo)
  }

  const printOrderFactuur = () => {
    if (!selectedOrder) return
    const factuur = (verkoopFacturen||[]).find((f: any) => f.id === selectedOrder.factuur_id)
    if (!factuur) { alert('Geen factuur gevonden voor deze bestelling'); return }
    printFactuur(selectedOrder, factuur, breweryDetails||{}, appName, factuurLogo||logo)
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
            {selectedOrder.wc_order_nummer ? `WC-${selectedOrder.wc_order_nummer}` : `M-${selectedOrder.id}`}
          </h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[selectedOrder.status]||'bg-gray-100'}`}>
            {t(`orders_status_${selectedOrder.status}`)||selectedOrder.status}
          </span>
          <span className="text-sm text-gray-500 ml-auto">{fmtD(selectedOrder.datum)}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Klantgegevens */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('orders_klant')}</div>
            <div className="font-semibold text-gray-800">{selectedOrder.klant_naam}</div>
            {selectedOrder.klant_bedrijf && <div className="text-sm text-gray-600">{selectedOrder.klant_bedrijf}</div>}
            {selectedOrder.klant_email && <div className="text-sm text-gray-500">{selectedOrder.klant_email}</div>}
            {selectedOrder.klant_straat && (
              <div className="text-sm text-gray-500 mt-1">
                {[selectedOrder.klant_straat, selectedOrder.klant_huisnummer].filter(Boolean).join(' ')}<br/>
                {[selectedOrder.klant_postcode, selectedOrder.klant_stad].filter(Boolean).join(' ')}
              </div>
            )}
          </div>

          {/* Orderinfo */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Order</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{t('orders_date')}</span><span>{fmtD(selectedOrder.datum)}</span></div>
              {selectedOrder.verzend_datum && <div className="flex justify-between"><span className="text-gray-500">{t('factuur_delivery_date')}</span><span>{fmtD(selectedOrder.verzend_datum)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">{t('orders_total')}</span><span className="font-semibold">{fmt(totaal)}</span></div>
              {selectedOrder.factuur_nummer && <div className="flex justify-between"><span className="text-gray-500">{t('factuur_number')}</span><span className="font-mono">{selectedOrder.factuur_nummer}</span></div>}
              {selectedOrder.pakbon_nummer && <div className="flex justify-between"><span className="text-gray-500">{t('pakbon_number')}</span><span className="font-mono">{selectedOrder.pakbon_nummer}</span></div>}
              {selectedOrder.opmerkingen && <div className="pt-1 text-xs text-gray-500 italic">{selectedOrder.opmerkingen}</div>}
            </div>
          </div>
        </div>

        {/* Orderregels */}
        <div className="bg-white rounded-xl shadow-card overflow-x-auto mb-4">
          <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('orders_lines')}</div>
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
                const isVrij = r.type === 'vrij' || r.type === 'verzending'
                const canDelete = isVrij && selectedOrder.status !== 'afgerond' && selectedOrder.status !== 'geannuleerd'
                return (
                  <tr key={r.id} className={isVrij ? 'bg-blue-50' : volledig ? 'bg-green-50' : ''}>
                    <td className="px-3 py-2 font-medium">
                      {r.bier_naam}
                      {r.sku && <span className="ml-1 font-mono text-xs text-gray-400">[{r.sku}]</span>}
                      {r.type === 'verzending' && <span className="ml-1 text-xs text-blue-500">🚚</span>}
                      {r.type === 'vrij' && <span className="ml-1 text-xs text-purple-500">✎</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.verpakking_type}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.aantal}×</td>
                    <td className="px-3 py-2 text-right">{fmt(r.prijs_per_stuk)}</td>
                    <td className="px-3 py-2 text-right">{r.btw_pct}%</td>
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

        {/* Picks overzicht (na picking) */}
        {picks.length > 0 && (
          <div className="bg-white rounded-xl shadow-card overflow-x-auto mb-4">
            <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('picking_title')}</div>
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
        )}

        {/* Actieknoppen */}
        <div className="flex flex-wrap gap-2">
          {(selectedOrder.status === 'nieuw' || selectedOrder.status === 'gepickt') && (
            <Btn v="blue" onClick={openPickModal}>{t('order_pick')}</Btn>
          )}
          {(selectedOrder.status === 'nieuw' || selectedOrder.status === 'gepickt') && (<>
            <Btn v="secondary" onClick={() => { setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'}); setShowVrijeRegelModal(true) }}>
              + {t('btn_vrije_regel')}
            </Btn>
            <Btn v="secondary" onClick={addVerzendkosten}>🚚 {t('btn_verzendkosten')}</Btn>
          </>)}
          {selectedOrder.status === 'gepickt' && allPicked && (
            <Btn v="green" onClick={() => setShowAfrondModal(true)}>{t('order_complete')}</Btn>
          )}
          {(selectedOrder.status === 'afgerond' || selectedOrder.status === 'verzonden') && (<>
            <Btn v="secondary" onClick={printOrderPakbon}>🖨 {t('order_print_pakbon')}</Btn>
            <Btn v="secondary" onClick={printOrderFactuur}>🖨 {t('order_print_factuur')}</Btn>
          </>)}
          {selectedOrder.status !== 'afgerond' && selectedOrder.status !== 'geannuleerd' && (
            <Btn v="danger" onClick={() => setShowAnnuleerModal(true)}>{t('order_cancel')}</Btn>
          )}
        </div>

        {/* Afronden bevestiging */}
        {showAfrondModal && (
          <Modal title={t('order_complete')} onClose={() => setShowAfrondModal(false)}>
            <div className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                <p>Je staat op het punt om deze bestelling af te ronden. Dit doet het volgende automatisch:</p>
                <ul className="mt-2 space-y-1 list-disc list-inside text-xs">
                  <li>Accijnsrecords aanmaken voor alle gepickte items</li>
                  <li>Uitslag registreren (formele vrijgave voor accijns)</li>
                  <li>Verkoopfactuur aanmaken in de boekhouding</li>
                  <li>Pakbon- en factuurnummer genereren</li>
                </ul>
              </div>
              {/* AGP: Type uitslag en bestemmingsgegevens */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_type_uitslag')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <select value={uitslagForm.type_uitslag} onChange={e => setUitslagForm(f => ({...f, type_uitslag: e.target.value}))} className="t-input w-full px-2.5 py-1.5 rounded text-sm bg-white border border-gray-200">
                      <option value="binnenland">{t('opt_binnenland')}</option>
                      <option value="intracommunautair">{t('opt_intracommunautair')}</option>
                      <option value="export">{t('opt_export')}</option>
                    </select>
                  </div>
                  <div>
                    <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_vervoerder')} value={uitslagForm.vervoerder} onChange={e => setUitslagForm(f => ({...f, vervoerder: e.target.value}))} />
                  </div>
                </div>
                {uitslagForm.type_uitslag !== 'binnenland' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_naam')} value={uitslagForm.bestemming_naam} onChange={e => setUitslagForm(f => ({...f, bestemming_naam: e.target.value}))} />
                      <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_land')} value={uitslagForm.bestemming_land} onChange={e => setUitslagForm(f => ({...f, bestemming_land: e.target.value}))} />
                    </div>
                    <input className="t-input w-full px-2.5 py-1.5 rounded text-sm border border-gray-200" placeholder={t('lbl_bestemming_adres')} value={uitslagForm.bestemming_adres} onChange={e => setUitslagForm(f => ({...f, bestemming_adres: e.target.value}))} />
                    <div className="text-xs text-amber-600 font-medium">{t('msg_ead_vereist')}</div>
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
        {showPickModal && (
          <Modal title={t('picking_title')} onClose={() => setShowPickModal(false)} wide>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {(selectedOrder.regels||[]).filter((r: any) => r.type === 'bier' || (!r.type && r.bier_naam)).map((r: any) => {
                const draftVoorRegel = draftPicks[r.id] || []
                const totaalGepickt = draftVoorRegel.reduce((s: number, p: any) => s + Number(p.aantal||0), 0)
                const resterend = r.aantal - totaalGepickt
                const afvullingen = getAvailableAfvullingen(r.bier_naam, r.verpakking_type, selectedOrder.id, null, r.artikel_key, r.sku)

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
                      const maxBeschik = beschikbaarVoorAfvulling(avItem||{}, selectedOrder.id) + Number(dp.aantal||0)
                      const locLabel = avItem ? voorraadPerLocLabel(avItem) : ''
                      return (
                        <div key={idx} className="mt-1 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-gray-600">
                              <span className="font-medium text-gray-800">{avArt?.biernaam || avBatch?.naam}</span>
                              {avArt?.artikelnummer && <span className="font-mono text-xs text-gray-500 ml-1">[{avArt.artikelnummer}]</span>}
                              {' · '}{avItem?.verpakking_type}
                              {' · '}{t('lbl_tht')}: {avItem?.tht ? fmtD(avItem.tht) : '—'}
                              {avBatch?.batch_nummer && <span className="text-xs text-gray-400"> · Lot {avBatch.batch_nummer}</span>}
                            </span>
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
                          const avail = beschikbaarVoorAfvulling((av||[]).find((a: any) => a.id === avId)||{}, selectedOrder.id)
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
                            const beschik = beschikbaarVoorAfvulling(a, selectedOrder.id)
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
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowPickModal(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={savePicks}>{t('picking_confirm')}</Btn>
            </div>
          </Modal>
        )}

        {/* Annuleer bevestiging */}
        {showAnnuleerModal && (
          <Modal title={t('order_cancel')} onClose={() => setShowAnnuleerModal(false)}>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">{t('msg_order_cancel_confirm')}</p>
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowAnnuleerModal(false)}>{t('btn_cancel')}</Btn>
                <Btn v="danger" onClick={annuleerOrder}>{t('order_cancel')}</Btn>
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
          {(['alle','nieuw','gepickt','verzonden','afgerond','geannuleerd'] as StatusFilter[]).map(s => {
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
          const orderNr = b.wc_order_nummer ? `WC-${b.wc_order_nummer}` : `M-${b.id}`
          return (
            <div key={b.id} onClick={() => { setSelectedId(b.id); setView('detail') }}
              className="bg-white rounded-xl shadow-card p-4 cursor-pointer hover:shadow-md transition-shadow flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-sm font-semibold text-gray-700">{orderNr}</span>
                <div>
                  <div className="font-medium text-gray-800">{b.klant_naam}</div>
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
              <div className="grid grid-cols-2 gap-3">
                <Inp label={t('manual_order_klant_naam') + ' *'} value={manualForm.klant_naam} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_naam: v}))} placeholder="Jan Janssen" />
                <Inp label={t('manual_order_klant_email')} value={manualForm.klant_email} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_email: v}))} placeholder="jan@example.nl" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Inp label={t('lbl_company')} value={manualForm.klant_bedrijf} onChange={(v: string) => setManualForm((f: any) => ({...f, klant_bedrijf: v}))} placeholder={t('lbl_company')} />
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
