// Koppelt een orderregel aan beschikbare afvullingen (voorraad).
//
// De koppeling gaat primair via SKU (de `artikel_sku` die bij het afvullen op
// de afvulling is bevroren). SKU's kunnen echter in het verleden gewijzigd
// zijn: de afvulling draagt dan nog de OUDE artikel_sku terwijl de order de
// NIEUWE SKU heeft. Klopt de SKU niet (meer), dan matchen we alsnog op het
// PRODUCT (product_id) + verpakking — dat blijft stabiel bij een SKU-wijziging
// — zodat al-uitgeslagen voorraad toch te picken is.
//
// Tiers (eerste niet-lege wint):
//   1. exacte artikel_sku-match (nieuwe afvullingen)
//   2. oude afvullingen zónder artikel_sku, via artikel-SKU + verpakking
//   3. product-fallback: zelfde product_id + verpakking (vangt SKU-wijziging)
//   (geen SKU) → match op bier-/batchnaam + verpakking (ook via product_id)

export interface PickRefData {
  bat?: any[]
  artikelen?: any[]
  producten?: any[]
  productArtikelen?: any[]
  verpakkingen?: any[]
}

const lower = (x: any): string => String(x ?? '').toLowerCase()

// FEFO: eerst de kortste houdbaarheid (tht); afvullingen zonder tht achteraan.
const fefo = (a: any, b: any): number => {
  if (!a.tht && !b.tht) return 0
  if (!a.tht) return 1
  if (!b.tht) return -1
  return String(a.tht).localeCompare(String(b.tht))
}

// Hoort de verpakking van een afvulling bij het gevraagde verpakkingstype?
// Losse vergelijking: exact, of via de verpakkingsnamen die bij dat type horen
// (bijv. type "fles" → naam "Vichy 33cL").
const verpakkingMatcht = (avVerpakkingType: any, regelVerpakking: string, verpakkingen: any[]): boolean => {
  const avp = lower(avVerpakkingType)
  const doel = lower(regelVerpakking)
  if (avp === doel) return true
  const namen = (verpakkingen || [])
    .filter((v: any) => lower(v.type) === doel)
    .map((v: any) => lower(v.naam))
    .filter(Boolean)
  return namen.includes(avp) || namen.some((n: string) => avp.includes(n) || n.includes(avp))
}

// Resolve het product-id waar een orderregel bij hoort (voor de product-fallback):
// via de huidige SKU-mapping (productArtikelen), anders via het artikel → biernaam,
// anders via de biernaam van de regel zelf.
export const orderProductId = (orderSku: string | null, regelBierNaam: string, data: PickRefData): number | null => {
  const { producten = [], productArtikelen = [], artikelen = [] } = data
  if (orderSku) {
    const pa = productArtikelen.find((p: any) => p.artikelnummer === orderSku)
    if (pa?.product_id != null) return pa.product_id
    const art = artikelen.find((a: any) => a.artikelnummer === orderSku)
    if (art?.biernaam) {
      const prod = producten.find((p: any) => lower(p.naam) === lower(art.biernaam))
      if (prod) return prod.id
    }
  }
  const prod = producten.find((p: any) => lower(p.naam) === lower(regelBierNaam))
  return prod?.id ?? null
}

// `beschikbaar` = reeds op voorraad>0 gefilterde afvullingen. Geeft de gesorteerde
// (FEFO) lijst afvullingen die bij deze orderregel horen.
export const matchAfvullingenVoorRegel = (
  beschikbaar: any[],
  regelBierNaam: string,
  regelVerpakking: string,
  orderSku: string | null,
  data: PickRefData,
): any[] => {
  const { bat = [], artikelen = [], producten = [], verpakkingen = [] } = data
  const filtered = beschikbaar || []

  if (orderSku) {
    // Tier 1: exacte artikel_sku-match (nieuwe afvullingen).
    const t1 = filtered.filter((a: any) => a.artikel_sku === orderSku)
    if (t1.length) return t1.slice().sort(fefo)

    // Tier 2: oude afvullingen zonder artikel_sku — via artikel-SKU + verpakking.
    // (batchnaam irrelevant; als batch.biernaam gezet is, moet die kloppen)
    const t2 = filtered.filter((a: any) => {
      if (a.artikel_sku) return false
      const matchArt = artikelen.find((art: any) =>
        art.artikelnummer === orderSku &&
        lower(art.verpakking_type) === lower(a.verpakking_type))
      if (!matchArt) return false
      const batch = bat.find((b: any) => b.id === a.batch_id)
      if (batch?.biernaam) return batch.biernaam === matchArt.biernaam
      return true
    })
    if (t2.length) return t2.slice().sort(fefo)

    // Tier 3: SKU is in het verleden gewijzigd — de afvulling draagt nog de
    // oude artikel_sku maar hoort bij hetzelfde product. Match op product_id
    // (van de afvulling of anders de batch) + verpakking.
    const pid = orderProductId(orderSku, regelBierNaam, data)
    if (pid != null) {
      const t3 = filtered.filter((a: any) => {
        const batch = bat.find((b: any) => b.id === a.batch_id)
        const avPid = a.product_id ?? batch?.product_id ?? null
        if (avPid !== pid) return false
        return verpakkingMatcht(a.verpakking_type, regelVerpakking, verpakkingen)
      })
      if (t3.length) return t3.slice().sort(fefo)
    }
    return []
  }

  // Geen SKU: fallback op bier_naam + verpakking (ook via product_id).
  const prod = producten.find((p: any) => lower(p.naam) === lower(regelBierNaam))
  return filtered
    .filter((a: any) => {
      if (!verpakkingMatcht(a.verpakking_type, regelVerpakking, verpakkingen)) return false
      const batch = bat.find((b: any) => b.id === a.batch_id)
      if (!batch) return false
      if (lower(batch.naam) === lower(regelBierNaam)) return true
      if (batch.biernaam && lower(batch.biernaam) === lower(regelBierNaam)) return true
      if (prod && (a.product_id === prod.id || batch.product_id === prod.id)) return true
      return false
    })
    .slice()
    .sort(fefo)
}

// ── Tijdelijke diagnose (bieren-picken-visibility) ──────────────────────────
// Legt per afvulling uit waarom hij wél/niet aan een orderregel koppelt. Puur,
// zodat de UI er alleen een leesbare dump van hoeft te tonen. Bedoeld om de
// oorzaak van "bier verschijnt niet bij het picken" uit echte data te halen;
// mag weer weg zodra de oorzaak vaststaat.
export interface PickDiagnoseRegel {
  id: any
  batch_id: any
  batch_naam: string
  batch_biernaam: string
  batch_product_id: any
  product_id: any
  artikel_sku: any
  verpakking_type: any
  tier1_sku_exact: boolean
  tier2_geen_sku: boolean
  tier3_product: boolean
  naam_fallback: boolean
  verpakking_matcht: boolean
  gerelateerd: boolean
}

export interface PickDiagnose {
  orderSku: string | null
  order_product_id: number | null
  regel_bier: string
  regel_verpakking: string
  regels: PickDiagnoseRegel[]
}

export const diagnosePickMatch = (
  afvullingen: any[],
  regelBierNaam: string,
  regelVerpakking: string,
  orderSku: string | null,
  data: PickRefData,
): PickDiagnose => {
  const { bat = [], artikelen = [], producten = [], verpakkingen = [] } = data
  const pid = orderProductId(orderSku, regelBierNaam, data)
  const prod = producten.find((p: any) => lower(p.naam) === lower(regelBierNaam))

  const regels = (afvullingen || []).map((a: any): PickDiagnoseRegel => {
    const batch = bat.find((b: any) => b.id === a.batch_id)
    const avPid = a.product_id ?? batch?.product_id ?? null
    const vMatch = verpakkingMatcht(a.verpakking_type, regelVerpakking, verpakkingen)

    const tier1 = !!orderSku && a.artikel_sku === orderSku
    const matchArt = artikelen.find((art: any) =>
      art.artikelnummer === orderSku &&
      lower(art.verpakking_type) === lower(a.verpakking_type))
    const tier2 = !!orderSku && !a.artikel_sku && !!matchArt &&
      (batch?.biernaam ? batch.biernaam === matchArt.biernaam : true)
    const tier3 = !!orderSku && pid != null && avPid === pid && vMatch
    const naamFb =
      vMatch && !!batch && (
        lower(batch.naam) === lower(regelBierNaam) ||
        (!!batch.biernaam && lower(batch.biernaam) === lower(regelBierNaam)) ||
        (!!prod && (a.product_id === prod.id || batch.product_id === prod.id))
      )
    // "Gerelateerd" = dit is plausibel hetzelfde bier (naam of product raakt),
    // zodat de UI de ruis (alle andere voorraad) kan wegfilteren.
    const gerelateerd =
      naamFb ||
      (pid != null && avPid === pid) ||
      (!!batch && (
        lower(batch.naam).includes(lower(regelBierNaam)) ||
        lower(regelBierNaam).includes(lower(batch.naam)) ||
        (!!batch.biernaam && (
          lower(batch.biernaam).includes(lower(regelBierNaam)) ||
          lower(regelBierNaam).includes(lower(batch.biernaam))))
      ))

    return {
      id: a.id,
      batch_id: a.batch_id,
      batch_naam: batch?.naam ?? '',
      batch_biernaam: batch?.biernaam ?? '',
      batch_product_id: batch?.product_id ?? null,
      product_id: a.product_id ?? null,
      artikel_sku: a.artikel_sku ?? null,
      verpakking_type: a.verpakking_type ?? null,
      tier1_sku_exact: tier1,
      tier2_geen_sku: tier2,
      tier3_product: tier3,
      naam_fallback: naamFb,
      verpakking_matcht: vMatch,
      gerelateerd,
    }
  })

  return {
    orderSku: orderSku ?? null,
    order_product_id: pid,
    regel_bier: regelBierNaam,
    regel_verpakking: regelVerpakking,
    regels,
  }
}
