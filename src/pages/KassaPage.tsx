import React, { useState, useMemo, useEffect } from 'react'
import { t } from '../i18n'
import { newId, volgendFactuurNummer } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { accijnsCalc, tariefVoorDatum, voorraadPerLocatie, getAgpLocatie, pickUitgeslagen } from '../utils/calculations'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import { printFactuur } from '../components/PakbonExport'
import { logAudit } from '../utils/audit'
import { resolveKlantSnapshot, nextKlantnummer } from '../utils/klant'
import { verkoopFactuurBoeking, voegBoekingToe } from '../utils/journaal'
import { totaliseerRegels } from '../utils/centen'

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
  afboekingen?: any[]
  auditLog?: any[]
  setAuditLog?: any
  setJournaal?: any
}

// Eén regel op de kassabon. De prijs komt altijd uit het artikel (normaal of
// B2B) en is niet handmatig aan te passen; korting gaat via de kortingsregel.
interface BonRegel {
  key: string
  type: 'bier' | 'vrij'
  bier_naam: string
  verpakking_type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  omschrijving: string
  artikel_id?: number | null
  artikel_key?: string | null
  sku?: string | null
  prijsType?: 'normaal' | 'b2b'
}

// Handmatige korting op de hele bon: vast bedrag (incl. BTW) of percentage.
interface BonKorting {
  soort: 'bedrag' | 'pct'
  waarde: number
}

type Betaalwijze = 'contant' | 'pin' | 'rekening'

const rnd2 = (n: number) => Math.round(n * 100) / 100

const KassaPage: React.FC<KassaPageProps> = ({
  bat, av, uit, setUit, acc, setAcc,
  artikelen, verpakkingen = [], producten = [], productArtikelen = [],
  bestellingen, setBestellingen,
  bestellingPicks, setBestellingPicks,
  verkoopFacturen, setVerkoopFacturen,
  accijnsInst, breweryDetails, appName = '', factuurLogo = null,
  factuurCounter, setFactuurCounter = () => {},
  log = [], setLog = () => {},
  klanten = [], setKlanten = () => {},
  locaties = [], verplaatsingen = [], afboekingen = [],
  auditLog = [], setAuditLog = () => {},
  setJournaal = () => {},
}) => {
  const [cart, setCart] = useState<BonRegel[]>([])
  const [selectedKlantId, setSelectedKlantId] = useState<number | null>(null)
  const [klantZoek, setKlantZoek] = useState('')
  const [productZoek, setProductZoek] = useState('')
  // Prijsweergave in de productkaarten: excl. (opgeslagen prijs) of incl. BTW
  const [toonInclBtw, setToonInclBtw] = useState(false)
  const [showAfrekenen, setShowAfrekenen] = useState(false)
  const [betaalwijze, setBetaalwijze] = useState<Betaalwijze>('pin')
  const [showNieuweKlant, setShowNieuweKlant] = useState(false)
  const [nieuweKlantForm, setNieuweKlantForm] = useState({naam: '', klant_type: 'prive', email: '', telefoon: ''})
  const [showVrijeRegel, setShowVrijeRegel] = useState(false)
  const [vrijeRegelForm, setVrijeRegelForm] = useState({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'})
  const [bonKorting, setBonKorting] = useState<BonKorting | null>(null)
  const [showKorting, setShowKorting] = useState(false)
  const [kortingForm, setKortingForm] = useState({soort: 'bedrag', waarde: ''})
  // Laatste afgeronde verkoop voor het succes-scherm (factuur printen)
  const [laatsteVerkoop, setLaatsteVerkoop] = useState<{bestelling: any, factuur: any} | null>(null)

  const selectedKlant = selectedKlantId != null ? (klanten || []).find((k: any) => k.id === selectedKlantId) : null
  // Zonder klant (balieverkoop) geldt privé: leveren mag dan niet uit AGP.
  const isZakelijk = !!selectedKlant && (selectedKlant.klant_type === 'zakelijk' ||
    (!selectedKlant.klant_type && String(selectedKlant.bedrijf || '').trim() !== ''))
  const isPrive = !isZakelijk

  // ── Voorraadhelpers (zelfde semantiek als BestellingenPage) ─────────────────

  const beschikbaarVoorAfvulling = (a: any): number => {
    const gepickt = (bestellingPicks || [])
      .filter((p: any) => {
        if (p.afvulling_id !== a.id) return false
        if (pickUitgeslagen(p)) return false
        const b = (bestellingen || []).find((bs: any) => bs.id === p.bestelling_id)
        return b && b.status !== 'afgerond' && b.status !== 'geannuleerd'
      })
      .reduce((s: number, p: any) => s + Number(p.aantal || 0), 0)
    const uitgeleverd = (uit || [])
      .filter((u: any) => u.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
    return Math.max(0, Number(a.hoeveelheid || 0) - gepickt - uitgeleverd)
  }

  const beschikbaarPerLocatieVoorAfvulling = (a: any): Record<number, number> => {
    if (!a || !(locaties || []).length) return {}
    const fysiek = voorraadPerLocatie(a, locaties as any, uit as any, verplaatsingen as any, afboekingen as any)
    const res: Record<number, number> = {...fysiek}
    const agp = getAgpLocatie(locaties as any)
    for (const p of ((bestellingPicks || []) as any[])) {
      if (p.afvulling_id !== a.id) continue
      if (pickUitgeslagen(p)) continue
      const b = (bestellingen || []).find((bs: any) => bs.id === p.bestelling_id)
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

  const beschikbaarBuitenAgpVoorAfvulling = (a: any): number => {
    const perLoc = beschikbaarPerLocatieVoorAfvulling(a)
    const agp = getAgpLocatie(locaties as any)
    let total = 0
    for (const k of Object.keys(perLoc)) {
      if (Number(k) !== agp.id) total += Number(perLoc[Number(k)] || 0)
    }
    return total
  }

  // FEFO: eerst-verlopende afvulling eerst
  const fefo = (a: any, b: any) => {
    if (!a.tht && !b.tht) return 0
    if (!a.tht) return 1
    if (!b.tht) return -1
    return a.tht.localeCompare(b.tht)
  }

  // Afvullingen die bij een catalogus-item horen (SKU eerst, dan bier+verpakking)
  const matchendeAfvullingen = (bierNaam: string, verpakkingType: string, sku?: string | null) => {
    const filtered = (av || []).filter((a: any) => beschikbaarVoorAfvulling(a) > 0)
    if (sku) {
      const skuMatches = filtered.filter((a: any) => a.artikel_sku === sku)
      if (skuMatches.length > 0) return skuMatches.sort(fefo)
      const legacy = filtered.filter((a: any) => {
        if (a.artikel_sku) return false
        const matchArt = (artikelen || []).find((art: any) =>
          art.artikelnummer === sku &&
          art.verpakking_type?.toLowerCase() === a.verpakking_type?.toLowerCase()
        )
        if (!matchArt) return false
        const batch = (bat || []).find((b: any) => b.id === a.batch_id)
        if (batch?.biernaam) return batch.biernaam === matchArt.biernaam
        return true
      }).sort(fefo)
      if (legacy.length > 0) return legacy
    }
    const prod = (producten || []).find((p: any) => p.naam.toLowerCase() === bierNaam.toLowerCase())
    const vpNamenVoorType = (verpakkingen || [])
      .filter((v: any) => v.type?.toLowerCase() === verpakkingType.toLowerCase())
      .map((v: any) => v.naam?.toLowerCase())
      .filter(Boolean)
    return filtered
      .filter((a: any) => {
        const avpLower = (a.verpakking_type || '').toLowerCase()
        const matchVerpakking = avpLower === verpakkingType.toLowerCase()
          || vpNamenVoorType.includes(avpLower)
          || vpNamenVoorType.some((n: string) => avpLower.includes(n) || n.includes(avpLower))
        if (!matchVerpakking) return false
        const batch = (bat || []).find((b: any) => b.id === a.batch_id)
        if (!batch) return false
        if (batch.naam.toLowerCase() === bierNaam.toLowerCase()) return true
        if (batch.biernaam && batch.biernaam.toLowerCase() === bierNaam.toLowerCase()) return true
        if (prod && (a.product_id === prod.id || batch.product_id === prod.id)) return true
        return false
      })
      .sort(fefo)
  }

  // ── Catalogus: verkoopbare bier+verpakking-combinaties met prijs en voorraad ─

  const artikelVoorKeuze = (biernaam: string, verpakking: string) => {
    const prod = (producten || []).find((p: any) => p.naam === biernaam)
    if (prod) {
      const pa = (productArtikelen || []).find((a: any) => a.product_id === prod.id && a.verpakking_type === verpakking)
      if (pa) return pa
    }
    return (artikelen || []).find((a: any) => a.biernaam === biernaam && a.verpakking_type === verpakking)
  }

  const catalogus = useMemo(() => {
    const bieren = [...new Set([
      ...(producten || []).filter((p: any) => p.status !== 'gearchiveerd').map((p: any) => p.naam),
      ...(artikelen || []).map((a: any) => a.biernaam),
    ].filter(Boolean))] as string[]
    const items: any[] = []
    for (const bier of bieren) {
      const prod = (producten || []).find((p: any) => p.naam === bier)
      const types = prod
        ? (productArtikelen || []).filter((a: any) => a.product_id === prod.id).map((a: any) => a.verpakking_type).filter(Boolean)
        : []
      const vpTypes = types.length
        ? types
        : (artikelen || []).filter((a: any) => a.biernaam === bier).map((a: any) => a.verpakking_type).filter(Boolean)
      for (const vp of [...new Set(vpTypes)] as string[]) {
        const art = artikelVoorKeuze(bier, vp)
        const sku = art?.artikelnummer || null
        const afvs = matchendeAfvullingen(bier, vp, sku)
        let voorraad = 0, buitenAgp = 0
        for (const a of afvs) {
          voorraad += beschikbaarVoorAfvulling(a)
          buitenAgp += Math.min(beschikbaarVoorAfvulling(a), beschikbaarBuitenAgpVoorAfvulling(a))
        }
        items.push({
          key: `${bier}|${vp}`,
          bier_naam: bier,
          verpakking_type: vp,
          artikel_id: art?.id ?? null,
          artikel_key: art?.key ?? null,
          sku,
          prijs: art?.verkoopprijs != null && art.verkoopprijs !== '' ? Number(art.verkoopprijs) : null,
          b2bPrijs: art?.b2b_prijs != null && art.b2b_prijs !== '' ? Number(art.b2b_prijs) : null,
          btw_pct: art?.btw_pct != null && art.btw_pct !== '' ? Number(art.btw_pct) : 9,
          voorraad,
          buitenAgp,
        })
      }
    }
    return items.sort((a, b) => a.bier_naam.localeCompare(b.bier_naam) || a.verpakking_type.localeCompare(b.verpakking_type))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [av, uit, verplaatsingen, afboekingen, bestellingPicks, bestellingen, producten, productArtikelen, artikelen, verpakkingen, locaties, bat])

  const catalogusGefilterd = catalogus.filter((c: any) =>
    !productZoek.trim() ||
    `${c.bier_naam} ${c.verpakking_type}`.toLowerCase().includes(productZoek.trim().toLowerCase()))

  // ── Klantstatistieken: terugkerende klanten snel in beeld ───────────────────

  const klantStats = useMemo(() => {
    const stats: Record<number, {count: number, last: string, openstaand: number}> = {}
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

  // Eerdere aankopen van de geselecteerde klant, gekoppeld aan catalogus-items
  // zodat een terugkerende klant zijn vaste bestelling met één tik herhaalt.
  const vorigeAankopen = useMemo(() => {
    if (!selectedKlant) return []
    const telling: Record<string, {key: string, count: number, last: string}> = {}
    for (const b of (bestellingen || [])) {
      if (b.status === 'geannuleerd') continue
      const live = resolveKlantSnapshot(b, klanten)
      if (live.klant_id !== selectedKlant.id) continue
      for (const r of (b.regels || [])) {
        if (r.type && r.type !== 'bier') continue
        if (!r.bier_naam || !r.verpakking_type) continue
        const key = `${r.bier_naam}|${r.verpakking_type}`
        if (!telling[key]) telling[key] = {key, count: 0, last: ''}
        telling[key].count += Number(r.aantal || 0)
        if (String(b.datum || '') > telling[key].last) telling[key].last = String(b.datum || '')
      }
    }
    return Object.values(telling)
      .map(v => ({...v, item: catalogus.find((c: any) => c.key === v.key)}))
      .filter(v => v.item)
      .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
      .slice(0, 6)
  }, [selectedKlant, bestellingen, klanten, catalogus])

  // ── Bon-bewerkingen ──────────────────────────────────────────────────────────

  const prijsVoorItem = (item: any): {prijs: number, prijsType: 'normaal' | 'b2b'} => {
    if (isZakelijk && item.b2bPrijs != null) return {prijs: item.b2bPrijs, prijsType: 'b2b'}
    return {prijs: item.prijs ?? 0, prijsType: 'normaal'}
  }

  const maxVoorItem = (item: any): number => isPrive ? item.buitenAgp : item.voorraad

  const addToCart = (item: any, aantal = 1) => {
    setLaatsteVerkoop(null)
    setCart(prev => {
      const bestaand = prev.find(r => r.key === item.key && r.type === 'bier')
      const huidig = bestaand ? bestaand.aantal : 0
      const max = maxVoorItem(item)
      const nieuw = Math.min(huidig + aantal, max)
      if (nieuw <= huidig) {
        alert(t('err_pos_voorraad')
          .replace('{product}', `${item.bier_naam} ${item.verpakking_type}`)
          .replace('{beschikbaar}', String(max)))
        return prev
      }
      if (bestaand) return prev.map(r => r === bestaand ? {...r, aantal: nieuw} : r)
      const {prijs, prijsType} = prijsVoorItem(item)
      return [...prev, {
        key: item.key,
        type: 'bier',
        bier_naam: item.bier_naam,
        verpakking_type: item.verpakking_type,
        aantal: nieuw,
        prijs_per_stuk: prijs,
        btw_pct: item.btw_pct,
        omschrijving: `${item.bier_naam} – ${item.verpakking_type}`,
        artikel_id: item.artikel_id,
        artikel_key: item.artikel_key,
        sku: item.sku,
        prijsType,
      }]
    })
  }

  const wijzigAantal = (idx: number, delta: number) => {
    setCart(prev => {
      const r = prev[idx]
      if (!r) return prev
      const item = catalogus.find((c: any) => c.key === r.key)
      const max = r.type === 'bier' && item ? maxVoorItem(item) : Infinity
      const nieuw = Math.min(Math.max(0, r.aantal + delta), max)
      if (nieuw === 0) return prev.filter((_, i) => i !== idx)
      return prev.map((x, i) => i === idx ? {...x, aantal: nieuw} : x)
    })
  }

  // Lege bon: eventuele bonkorting hoort niet stilletjes mee te gaan naar de
  // volgende verkoop.
  useEffect(() => {
    if (cart.length === 0) setBonKorting(null)
  }, [cart.length])

  // Klantwissel: herprijs bierregels (normaal ↔ B2B).
  const selectKlant = (id: number | null) => {
    setSelectedKlantId(id)
    setKlantZoek('')
    setLaatsteVerkoop(null)
    const k = id != null ? (klanten || []).find((x: any) => x.id === id) : null
    const zakelijk = !!k && (k.klant_type === 'zakelijk' || (!k.klant_type && String(k.bedrijf || '').trim() !== ''))
    setCart(prev => prev.map(r => {
      if (r.type !== 'bier') return r
      const item = catalogus.find((c: any) => c.key === r.key)
      if (!item) return r
      const b2b = zakelijk && item.b2bPrijs != null
      return {...r, prijs_per_stuk: b2b ? item.b2bPrijs : (item.prijs ?? 0), prijsType: b2b ? 'b2b' : 'normaal'}
    }))
  }

  const addVrijeRegel = () => {
    const oms = vrijeRegelForm.omschrijving.trim()
    if (!oms) { alert(t('err_vrije_regel_omschrijving')); return }
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
    setVrijeRegelForm({omschrijving: '', aantal: '1', prijs_per_stuk: '', btw_pct: '21'})
    setShowVrijeRegel(false)
  }

  const addKorting = () => {
    const waarde = Number(kortingForm.waarde)
    if (!(waarde > 0) || (kortingForm.soort === 'pct' && waarde > 100)) {
      alert(t('err_pos_korting_waarde'))
      return
    }
    setBonKorting({soort: kortingForm.soort as 'bedrag' | 'pct', waarde})
    setKortingForm({soort: 'bedrag', waarde: ''})
    setShowKorting(false)
  }

  // ── Totalen (incl. klantkorting en statiegeld, zoals de orderflow) ──────────

  const kortingPct = Number(selectedKlant?.korting_pct || 0)

  const bonTotalen = useMemo(() => {
    const kortingPerBtw: Record<string, number> = {}
    if (kortingPct > 0) {
      for (const r of cart) {
        if (r.type !== 'bier') continue
        const netto = r.aantal * r.prijs_per_stuk
        if (netto <= 0) continue
        const k = String(Number(r.btw_pct || 0))
        kortingPerBtw[k] = (kortingPerBtw[k] || 0) + netto
      }
    }
    const kortingRegels = Object.entries(kortingPerBtw)
      .map(([btwPct, som]) => ({btw_pct: Number(btwPct), bedrag: Math.round(som * kortingPct) / 100}))
      .filter(k => k.bedrag > 0)

    // Handmatige bonkorting: basis = alle bonregels minus klantkorting, per
    // BTW-tarief (statiegeld valt buiten de korting).
    const basisPerBtw: Record<string, number> = {}
    for (const r of cart) {
      const netto = r.aantal * r.prijs_per_stuk
      if (netto <= 0) continue
      const k = String(Number(r.btw_pct || 0))
      basisPerBtw[k] = (basisPerBtw[k] || 0) + netto
    }
    for (const k of kortingRegels) {
      const key = String(k.btw_pct)
      basisPerBtw[key] = Math.max(0, (basisPerBtw[key] || 0) - k.bedrag)
    }

    let bonKortingRegels: Array<{btw_pct: number, bedrag: number}> = []
    if (bonKorting && bonKorting.waarde > 0) {
      const groepen = Object.entries(basisPerBtw).filter(([, som]) => som > 0)
      if (bonKorting.soort === 'pct') {
        const pct = Math.min(bonKorting.waarde, 100)
        bonKortingRegels = groepen
          .map(([btwPct, som]) => ({btw_pct: Number(btwPct), bedrag: rnd2(som * pct / 100)}))
          .filter(x => x.bedrag > 0)
      } else {
        // Bedrag is incl. BTW (wat de klant minder betaalt): proportioneel
        // verdelen over de BTW-groepen en per groep terugrekenen naar netto.
        const brutoPerGroep = groepen.map(([btwPct, som]) =>
          ({btw_pct: Number(btwPct), bruto: som * (1 + Number(btwPct) / 100)}))
        const brutoTotaal = brutoPerGroep.reduce((s, g) => s + g.bruto, 0)
        if (brutoTotaal > 0) {
          const doel = Math.min(bonKorting.waarde, rnd2(brutoTotaal))
          let rest = doel
          bonKortingRegels = brutoPerGroep.map((g, i) => {
            const deel = i === brutoPerGroep.length - 1 ? rest : rnd2(doel * g.bruto / brutoTotaal)
            rest = rnd2(rest - deel)
            return {btw_pct: g.btw_pct, bedrag: rnd2(deel / (1 + g.btw_pct / 100))}
          }).filter(x => x.bedrag > 0)
        }
      }
    }

    const statiegeldRegels: Array<{vp: any, aantal: number, bedrag: number, soort: string}> = []
    for (const r of cart) {
      if (r.type !== 'bier') continue
      const vp = (verpakkingen || []).find((v: any) =>
        (v.naam && r.verpakking_type && String(v.naam).toLowerCase() === String(r.verpakking_type).toLowerCase()) ||
        (v.type && r.verpakking_type && String(v.type).toLowerCase() === String(r.verpakking_type).toLowerCase())
      )
      const bedrag = Number(vp?.statiegeld_bedrag || 0)
      const soort = vp?.statiegeld_soort
      if (!vp || bedrag <= 0 || (soort !== 'snd' && soort !== 'fust')) continue
      statiegeldRegels.push({vp, aantal: r.aantal, bedrag: rnd2(r.aantal * bedrag), soort})
    }

    const nettoRegels = rnd2(cart.reduce((s, r) => s + r.aantal * r.prijs_per_stuk, 0))
    const kortingTotaal = rnd2(kortingRegels.reduce((s, k) => s + k.bedrag, 0))
    const bonKortingTotaal = rnd2(bonKortingRegels.reduce((s, k) => s + k.bedrag, 0))
    const statiegeldTotaal = rnd2(statiegeldRegels.reduce((s, x) => s + x.bedrag, 0))
    const btwTotaal = rnd2(
      cart.reduce((s, r) => s + rnd2(r.aantal * r.prijs_per_stuk) * Number(r.btw_pct || 0) / 100, 0)
      - kortingRegels.reduce((s, k) => s + k.bedrag * k.btw_pct / 100, 0)
      - bonKortingRegels.reduce((s, k) => s + k.bedrag * k.btw_pct / 100, 0)
    )
    const netto = rnd2(nettoRegels - kortingTotaal - bonKortingTotaal + statiegeldTotaal)
    return {kortingRegels, bonKortingRegels, statiegeldRegels, nettoRegels, kortingTotaal, bonKortingTotaal, statiegeldTotaal, btwTotaal, netto, bruto: rnd2(netto + btwTotaal)}
  }, [cart, kortingPct, bonKorting, verpakkingen])

  // Factuurnummering: server-side via volgendFactuurNummer() (ERP-plan 0.2) —
  // de client nummert nooit zelf (races/hergebruik).

  // ── Uitslagrecords (kopie van BestellingenPage.bouwUitslagRecords) ──────────
  // Belastbaar feit: bier verlaat de voorraad. Buiten-AGP-voorraad eerst
  // (accijns al betaald); AGP-voorraad genereert een accijnsboeking.

  const bouwUitslagRecords = (picksIn: any[], isPriveOrder: boolean, bestemmingNaam: string) => {
    const nieuweUitleveringen: any[] = []
    const nieuweAccijns: any[] = []
    const pickResult: Record<number, {uitlevering_ids: number[], accijns_ids: number[]}> = {}
    let uitId = newId(uit || [])
    let accId = newId(acc || [])
    const lokaleUitleveringen: any[] = [...(uit || [])]
    const agpLocLocal = getAgpLocatie(locaties as any)
    const vandaag = tod()

    for (const pick of picksIn) {
      const avItem = (av || []).find((a: any) => a.id === pick.afvulling_id)
      if (!avItem) continue
      const batch = (bat || []).find((b: any) => b.id === pick.batch_id)
      const inhoud = Number(avItem.inhoud_per_eenheid || 0)
      const abv = Number(batch?.ABV || 0)
      const plato = Number(batch?.platogehalte || 0)
      pickResult[pick.id] = {uitlevering_ids: [], accijns_ids: []}

      const voorraad = voorraadPerLocatie(avItem, locaties as any, lokaleUitleveringen, verplaatsingen as any, afboekingen as any)
      const locOrder: number[] = []
      for (const l of (locaties || [])) {
        if (!l.is_agp && (voorraad[l.id] || 0) > 0) locOrder.push(l.id)
      }
      if (!isPriveOrder) {
        if ((voorraad[agpLocLocal.id] || 0) > 0) locOrder.push(agpLocLocal.id)
        for (const k of Object.keys(voorraad)) {
          const id = Number(k)
          if (!locOrder.includes(id) && (voorraad[id] || 0) > 0) locOrder.push(id)
        }
        if (locOrder.length === 0) locOrder.push(agpLocLocal.id)
      }

      let resterend = Number(pick.aantal || 0)
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
          tht: avItem.tht || null,
          accijns_betaald: !isAgp,
          type_uitlevering: 'binnenland',
          bestemming_naam: bestemmingNaam,
          bestemming_adres: '',
          bestemming_land: 'NL',
          vervoerder: '',
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
            batch_nummer: batch?.batch_nummer || '',
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

  // ── Afrekenen: bestelling + picks + uitslag + accijns + factuur in één keer ─

  const verwerkVerkoop = async () => {
    if (!cart.length) { alert(t('err_pos_bon_leeg')); return }
    if (betaalwijze === 'rekening' && !selectedKlant) { alert(t('err_pos_rekening_klant')); return }
    const vandaag = tod()
    const klantNaam = selectedKlant?.naam || t('pos_walkin_naam')

    // 1. Voorraadvalidatie + FEFO-allocatie per bierregel. Lokale usage-map zodat
    //    meerdere bonregels die dezelfde afvulling raken niet dubbel alloceren.
    const gebruikt: Record<number, number> = {}
    const draftAllocaties: Array<{afvulling_id: number, batch_id: number, aantal: number, regelKey: string}> = []
    for (const r of cart) {
      if (r.type !== 'bier') continue
      const afvs = matchendeAfvullingen(r.bier_naam, r.verpakking_type, r.sku)
      let nodig = r.aantal
      for (const a of afvs) {
        if (nodig <= 0) break
        const basis = isPrive
          ? Math.min(beschikbaarVoorAfvulling(a), beschikbaarBuitenAgpVoorAfvulling(a))
          : beschikbaarVoorAfvulling(a)
        const vrij = basis - (gebruikt[a.id] || 0)
        if (vrij <= 0) continue
        const pak = Math.min(nodig, vrij)
        gebruikt[a.id] = (gebruikt[a.id] || 0) + pak
        draftAllocaties.push({afvulling_id: a.id, batch_id: a.batch_id, aantal: pak, regelKey: r.key})
        nodig -= pak
      }
      if (nodig > 0) {
        const beschikbaar = r.aantal - nodig
        const errKey = isPrive ? 'err_prive_buiten_agp_ontoereikend' : 'agp_voorraad_ontoereikend'
        alert(t(errKey).replace('{beschikbaar}', `${beschikbaar}× ${r.verpakking_type || r.bier_naam}`))
        return
      }
    }

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

    // 4. Uitslag- en accijnsrecords (belastbaar feit)
    const {nieuweUitleveringen, nieuweAccijns, pickResult} = bouwUitslagRecords(picks, isPrive, klantNaam)
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
    catch (e) { alert(t('err_factuurnummer_ophalen')); return }
    const regelsList: any[] = regels.map((r: any) => {
      const netto = rnd2(Number(r.aantal || 0) * Number(r.prijs_per_stuk || 0))
      const btw_bedrag = rnd2(netto * Number(r.btw_pct || 0) / 100)
      return {
        omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`,
        hoeveelheid: Number(r.aantal || 0),
        prijs_per_stuk: Number(r.prijs_per_stuk || 0),
        btw_pct: Number(r.btw_pct || 0),
        netto,
        btw_bedrag,
        bruto: rnd2(netto + btw_bedrag),
      }
    })
    for (const st of bonTotalen.statiegeldRegels) {
      regelsList.push({
        omschrijving: `${t(st.soort === 'snd' ? 'statiegeld_snd' : 'statiegeld_fust')} – ${st.vp.naam}`,
        hoeveelheid: st.aantal,
        prijs_per_stuk: Number(st.vp.statiegeld_bedrag || 0),
        btw_pct: 0,
        netto: st.bedrag,
        btw_bedrag: 0,
        bruto: st.bedrag,
        statiegeld_soort: st.soort,
        verpakking_id: st.vp.id,
      })
    }
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
    if (nieuweAccijns.length > 0) setAcc((prev: any[]) => [...(prev || []), ...nieuweAccijns])
    setVerkoopFacturen((prev: any[]) => [...(prev || []), factuur])
    // Journaal (ERP-plan 2.1): kassafactuur is direct definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(factuur)))
    setLog((prev: any[]) => {
      let logId = newId(prev || [])
      const entries = nieuweUitleveringen.map((u: any) => ({
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
        omschrijving: `Kassa — ${klantNaam} — ${factuurNummer}`,
      }))
      return [...(prev || []), ...entries]
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Bestelling',
      entiteit_id: bestellingId,
      actie: 'aangemaakt',
      omschrijving: `Kassaverkoop — ${klantNaam}, factuur ${factuurNummer} (${nieuweUitleveringen.length} uitleveringen, ${nieuweAccijns.length} accijnsregels)`,
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verkoopfactuur',
      entiteit_id: factuur.id,
      actie: 'aangemaakt',
      omschrijving: `Kassa — ${factuurNummer} ${klantNaam} ${fmt(factuur.bruto)} (${betaalwijze})`,
    })

    setShowAfrekenen(false)
    setCart([])
    setBonKorting(null)
    setLaatsteVerkoop({bestelling, factuur})
  }

  const saveNieuweKlant = () => {
    const naam = nieuweKlantForm.naam.trim()
    if (!naam) { alert(t('err_pos_klant_naam')); return }
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
    setShowNieuweKlant(false)
    setNieuweKlantForm({naam: '', klant_type: 'prive', email: '', telefoon: ''})
    selectKlant(nieuw.id)
  }

  const stats = selectedKlant ? klantStats[selectedKlant.id] : null

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t('nav_kassa')}
        rounded="full"
        info={<span>{fmtD(tod())}</span>}
      />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Linkerkolom: klant + producten ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Klant */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('pos_klant')}</div>
              <Btn v="ghost" s="sm" onClick={() => setShowNieuweKlant(true)}>+ {t('klanten_new')}</Btn>
            </div>

            {selectedKlant ? (
              <div className="rounded-lg t-panel border t-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-800">{selectedKlant.naam}</span>
                  {selectedKlant.klantnummer && <span className="text-xs text-gray-400">#{selectedKlant.klantnummer}</span>}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isZakelijk ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {isZakelijk ? t('lbl_zakelijk') : t('lbl_prive')}
                  </span>
                  {kortingPct > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                      {t('lbl_korting_pct').replace('{pct}', String(kortingPct))}
                    </span>
                  )}
                  {stats && stats.openstaand > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                      {t('pos_openstaand')}: {fmt(stats.openstaand)}
                    </span>
                  )}
                  <button onClick={() => selectKlant(null)}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-sm" title={t('btn_sluiten')}>✕</button>
                </div>
                {stats && (
                  <div className="text-xs text-gray-500 mt-1">
                    {t('pos_aankopen').replace('{n}', String(stats.count))}
                    {stats.last ? ` · ${t('pos_laatste_aankoop')}: ${fmtD(stats.last)}` : ''}
                  </div>
                )}
                {vorigeAankopen.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t('pos_vorige_aankopen')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {vorigeAankopen.map(v => (
                        <button key={v.key} onClick={() => addToCart(v.item)}
                          disabled={maxVoorItem(v.item) <= 0}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          <span className="font-medium">{v.item.bier_naam}</span>
                          <span className="text-gray-400"> · {v.item.verpakking_type} · {v.count}×</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {recenteKlanten.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-400 mb-1.5">{t('pos_recente_klanten')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {recenteKlanten.map((k: any) => (
                        <button key={k.id} onClick={() => selectKlant(k.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                          <span className="font-medium">{k.naam}</span>
                          <span className="text-gray-400"> · {t('pos_aankopen').replace('{n}', String(klantStats[k.id]?.count || 0))}
                            {klantStats[k.id]?.last ? ` · ${fmtD(klantStats[k.id].last)}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="relative">
                  <SearchInput value={klantZoek} onChange={setKlantZoek} placeholder={t('pos_zoek_klant_ph')} />
                  {klantZoekResultaten.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {klantZoekResultaten.map((k: any) => (
                        <button key={k.id} onClick={() => selectKlant(k.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <span className="font-medium">{k.naam}</span>
                          {k.bedrijf && <span className="text-gray-400 text-xs">{k.bedrijf}</span>}
                          <span className="ml-auto text-xs text-gray-400">
                            {klantStats[k.id] ? t('pos_aankopen').replace('{n}', String(klantStats[k.id].count)) : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {klantZoek.trim() && klantZoekResultaten.length === 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
                      {t('pos_geen_klanten')}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400">{t('pos_walkin_hint')}</div>
              </>
            )}
          </div>

          {/* Producten */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">{t('nav_producten')}</div>
              <SearchInput value={productZoek} onChange={setProductZoek} placeholder={t('pos_zoek_product_ph')} />
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0 text-xs">
                {([[false, t('pos_prijs_excl')], [true, t('pos_prijs_incl')]] as Array<[boolean, string]>).map(([incl, l]) => (
                  <button key={String(incl)} onClick={() => setToonInclBtw(incl)}
                    className={`px-2 py-1 transition-colors ${toonInclBtw === incl
                      ? 't-panel font-semibold'
                      : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    style={toonInclBtw === incl ? {color: 'var(--t-accent)'} : undefined}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {catalogusGefilterd.length === 0 ? (
              <div className="text-sm text-gray-400 py-6 text-center">{t('pos_geen_producten')}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                {catalogusGefilterd.map((item: any) => {
                  const max = maxVoorItem(item)
                  const inCart = cart.find(r => r.key === item.key && r.type === 'bier')?.aantal || 0
                  const uitverkocht = max <= 0
                  const {prijs, prijsType} = prijsVoorItem(item)
                  const prijsToon = toonInclBtw ? rnd2(prijs * (1 + Number(item.btw_pct || 0) / 100)) : prijs
                  return (
                    <button key={item.key} onClick={() => addToCart(item)} disabled={uitverkocht}
                      className={`relative text-left rounded-xl border p-3 transition-all duration-150 ${uitverkocht
                        ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                        : 'border-gray-200 bg-white hover:shadow-md hover:-translate-y-px active:translate-y-0 cursor-pointer'}`}>
                      {inCart > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold shadow"
                          style={{backgroundColor: 'var(--t-accent)'}}>{inCart}</span>
                      )}
                      <div className="font-semibold text-sm text-gray-800 leading-tight">{item.bier_naam}</div>
                      <div className="text-xs text-gray-400 mb-1.5">{item.verpakking_type}</div>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-bold text-sm" style={{color: 'var(--t-accent)'}}>
                          {item.prijs != null || (isZakelijk && item.b2bPrijs != null) ? fmt(prijsToon) : '—'}
                          {prijsType === 'b2b' && <span className="ml-1 text-[9px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded align-middle">B2B</span>}
                        </span>
                        <span className={`text-[10px] ${uitverkocht ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                          {uitverkocht ? t('pos_geen_voorraad') : `${max} ${t('pos_voorraad')}`}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Rechterkolom: bon ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('pos_bon')}</div>
            <div className="flex gap-1">
              <Btn v="ghost" s="sm" onClick={() => setShowKorting(true)} disabled={cart.length === 0}>+ {t('pos_korting')}</Btn>
              <Btn v="ghost" s="sm" onClick={() => setShowVrijeRegel(true)}>+ {t('pos_vrije_regel')}</Btn>
            </div>
          </div>

          {laatsteVerkoop && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-2">
              <div className="font-semibold text-green-700 text-sm">✓ {t('pos_verkoop_gelukt')}</div>
              <div className="text-xs text-green-700">
                {laatsteVerkoop.factuur.factuurnummer} · {laatsteVerkoop.bestelling.klant_naam} · {fmt(laatsteVerkoop.factuur.bruto)}
              </div>
              <div className="flex gap-2">
                <Btn v="green" s="sm" onClick={() => printFactuur(laatsteVerkoop.bestelling, laatsteVerkoop.factuur, breweryDetails, appName, factuurLogo)}>
                  {t('pos_print_bon')}
                </Btn>
                <Btn v="secondary" s="sm" onClick={() => { setLaatsteVerkoop(null); selectKlant(null) }}>{t('pos_nieuwe_verkoop')}</Btn>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            !laatsteVerkoop && <div className="text-sm text-gray-400 py-8 text-center">{t('pos_bon_leeg')}</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cart.map((r, idx) => (
                <div key={`${r.key}-${idx}`} className="py-2 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-medium text-gray-800 leading-tight">
                      {r.bier_naam}
                      {r.verpakking_type && <span className="text-gray-400 font-normal"> · {r.verpakking_type}</span>}
                      {r.prijsType === 'b2b' && <span className="ml-1 text-[9px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded align-middle">B2B</span>}
                    </span>
                    <button onClick={() => setCart(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">✕</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                      <button onClick={() => wijzigAantal(idx, -1)} className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">−</button>
                      <span className="px-2 text-sm font-medium min-w-8 text-center">{r.aantal}</span>
                      <button onClick={() => wijzigAantal(idx, +1)} className="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">+</button>
                    </div>
                    <span className="text-xs text-gray-400">×</span>
                    <span className="text-sm text-gray-600">{fmt(r.prijs_per_stuk)}</span>
                    <span className="text-[10px] text-gray-400">{r.btw_pct}%</span>
                    <span className="ml-auto text-sm font-semibold text-gray-700">{fmt(r.aantal * r.prijs_per_stuk)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <>
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>{t('pos_subtotaal')}</span><span>{fmt(bonTotalen.nettoRegels)}</span>
                </div>
                {bonTotalen.kortingTotaal > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>{t('lbl_korting_pct').replace('{pct}', String(kortingPct))}</span>
                    <span>−{fmt(bonTotalen.kortingTotaal)}</span>
                  </div>
                )}
                {bonKorting && bonTotalen.bonKortingTotaal > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span className="flex items-center gap-1.5">
                      {bonKorting.soort === 'pct'
                        ? t('lbl_korting_pct').replace('{pct}', String(bonKorting.waarde))
                        : t('pos_korting')}
                      <button onClick={() => setBonKorting(null)}
                        className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </span>
                    <span>−{fmt(bonTotalen.bonKortingTotaal)}</span>
                  </div>
                )}
                {bonTotalen.statiegeldTotaal > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>{t('pos_statiegeld')}</span><span>{fmt(bonTotalen.statiegeldTotaal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>{t('pos_btw')}</span><span>{fmt(bonTotalen.btwTotaal)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg text-gray-800 pt-1">
                  <span>{t('pos_totaal')}</span><span>{fmt(bonTotalen.bruto)}</span>
                </div>
              </div>
              <Btn v="green" s="lg" cls="w-full text-base" onClick={() => setShowAfrekenen(true)}>
                {t('pos_afrekenen')} · {fmt(bonTotalen.bruto)}
              </Btn>
            </>
          )}
        </div>
      </div>

      {/* ── Afreken-modal ── */}
      {showAfrekenen && (
        <Modal title={t('pos_afrekenen')} onClose={() => setShowAfrekenen(false)}>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {selectedKlant ? selectedKlant.naam : t('pos_walkin_naam')}
              {' — '}{cart.reduce((s, r) => s + r.aantal, 0)}× · <span className="font-bold">{fmt(bonTotalen.bruto)}</span>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('pos_betaalwijze')}</div>
              <div className="grid grid-cols-3 gap-2">
                {([['contant', t('pos_contant')], ['pin', t('pos_pin')], ['rekening', t('pos_op_rekening')]] as Array<[Betaalwijze, string]>).map(([w, l]) => (
                  <button key={w} onClick={() => setBetaalwijze(w)}
                    className={`px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${betaalwijze === w
                      ? 't-panel t-border font-semibold'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    style={betaalwijze === w ? {color: 'var(--t-accent)'} : undefined}>
                    {l}
                  </button>
                ))}
              </div>
              {betaalwijze === 'rekening' && !selectedKlant && (
                <div className="text-xs text-red-500 mt-2">{t('err_pos_rekening_klant')}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowAfrekenen(false)}>{t('btn_cancel')}</Btn>
              <Btn v="green" onClick={verwerkVerkoop} disabled={betaalwijze === 'rekening' && !selectedKlant}>
                {t('pos_bevestig_verkoop')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Nieuwe klant (snel) ── */}
      {showNieuweKlant && (
        <Modal title={t('klanten_new')} onClose={() => setShowNieuweKlant(false)}>
          <div className="space-y-3">
            <Inp label={t('lbl_naam')} value={nieuweKlantForm.naam} req
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, naam: v}))} />
            <Sel label={t('klanten_type')} value={nieuweKlantForm.klant_type}
              onChange={(v: string) => setNieuweKlantForm(f => ({...f, klant_type: v || 'prive'}))}
              opts={[{v: 'prive', l: t('lbl_prive')}, {v: 'zakelijk', l: t('lbl_zakelijk')}]} />
            <div className="grid grid-cols-2 gap-3">
              <Inp label={t('lbl_email')} type="email" value={nieuweKlantForm.email}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, email: v}))} />
              <Inp label={t('lbl_telefoon')} value={nieuweKlantForm.telefoon}
                onChange={(v: string) => setNieuweKlantForm(f => ({...f, telefoon: v}))} />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowNieuweKlant(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveNieuweKlant}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Korting ── */}
      {showKorting && (
        <Modal title={t('pos_korting')} onClose={() => setShowKorting(false)}>
          <div className="space-y-3">
            <Sel label={t('pos_korting_soort')} value={kortingForm.soort}
              onChange={(v: string) => setKortingForm(f => ({...f, soort: v || 'bedrag'}))}
              opts={[{v: 'bedrag', l: t('pos_korting_soort_bedrag')}, {v: 'pct', l: t('pos_korting_soort_pct')}]} />
            <Inp label={kortingForm.soort === 'pct' ? t('pos_korting_soort_pct') : t('pos_korting_soort_bedrag')}
              type="number" step="0.01" value={kortingForm.waarde} req
              onChange={(v: string) => setKortingForm(f => ({...f, waarde: v}))} />
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowKorting(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={addKorting}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Vrije regel ── */}
      {showVrijeRegel && (
        <Modal title={t('pos_vrije_regel')} onClose={() => setShowVrijeRegel(false)}>
          <div className="space-y-3">
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
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Btn v="secondary" onClick={() => setShowVrijeRegel(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={addVrijeRegel}>{t('manual_order_add_line')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default KassaPage
