import React, { useState, useRef } from 'react'
import { t } from '../i18n'
import { useStore, newId, wcGet, wcPut, bfFetch, bfGetBatches, bfMapBatch, bfMapBis, bfNumSafe } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { accijnsCalc } from '../utils/calculations'
import { STATUSSEN, BUILTIN_ING_TYPES, EENHEDEN, BF_TO_APP, DEFAULT_HYGIENE_ITEMS, DEFAULT_HYGIENE_GROUPS, convertEenheid } from '../utils/constants'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'

interface BatchesPageProps {
  ing: any[]
  setIng: any
  lots: any[]
  setLots: any
  bat: any[]
  setBat: any
  bi: any[]
  setBi: any
  av: any[]
  setAv: any
  uit: any[]
  setUit: any
  acc: any[]
  setAcc: any
  verpakkingen: any[]
  setVerpakkingen: any
  onderdelen?: any[]
  setOnderdelen?: any
  log: any[]
  setLog: any
  bfCreds?: any
  bfSync?: () => void
  tanks?: any[]
  accijnsInst?: any
  hygieneItems?: any[]
  hygieneGroups?: any[]
  wcCreds?: any
  artikelen?: any[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

const BatchesPage: React.FC<BatchesPageProps> = ({
  ing, setIng, lots, setLots, bat, setBat, bi, setBi,
  av, setAv, uit, setUit, acc, setAcc,
  verpakkingen, setVerpakkingen, onderdelen=[], setOnderdelen=()=>{},
  log, setLog, bfCreds, bfSync, tanks, accijnsInst,
  hygieneItems, hygieneGroups, wcCreds, artikelen
}) => {
  const [sel, setSel] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showBf, setShowBf] = useState(false)
  const [bfJson, setBfJson] = useState('')
  const [bfFileName, setBfFileName] = useState('')
  const bfFileRef = useRef<HTMLInputElement>(null)
  const [editId, setEditId] = useState<number | null>(null)

  const emptyB = {batch_nummer:'',naam:'',stijl:'',status:'Gepland',liter_vergist:'',OG:'',FG:'',ABV:'',tank:'',electra_kosten:'',water_kosten:'',schoonmaak_kosten:'',overige_kosten:'',notities:'',brouwzaal_eff:'',maisch_eff:'',maisch_ph:'',product_ph:'',datum:tod()}
  const emptyI = {ingredient_id:'',ingredient_naam:'',ingredient_type:'Mout',hoeveelheid:'',eenheid:'kg',lot_id:'',kosten:'',afboeken:false}

  const safeStr = (v: any): string => {
    if (!v && v !== 0) return ''
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map((x: any) => typeof x==='string'?x:(x?.note||x?.text||x?.message||x?.content||'')).filter(Boolean).join('\n')
    if (typeof v === 'object') return String(v.$string||v.text||v.note||v.message||'')
    return String(v)
  }

  const [bForm, setBForm] = useState<any>(emptyB)
  const [iForm, setIForm] = useState<any>(emptyI)
  const [batchArchiefIngeklapt, setBatchArchiefIngeklapt] = useStore('batches_archief_ingeklapt', true)
  const [infoIngeklapt, setInfoIngeklapt] = useState(false)
  const [bfSyncing, setBfSyncing] = useState(false)
  const [bfMsg, setBfMsg] = useState('')
  const [hygieneIngeklapt, setHygieneIngeklapt] = useStore('batches_hygiene_ingeklapt', true)
  const [ingIngeklapt, setIngIngeklapt] = useStore('batches_ing_ingeklapt', false)
  const [afvullenIngeklapt, setAfvullenIngeklapt] = useStore('batches_afvullen_ingeklapt', false)
  const [voorraadIngeklapt, setVoorraadIngeklapt] = useStore('batches_voorraad_ingeklapt', false)
  const [ingFormOpen, setIngFormOpen] = useState(false)
  const [batchZoek, setBatchZoek] = useState('')

  const emptyAv = {verpakking_id:'',verpakking_type:'',inhoud_per_eenheid:'',hoeveelheid:'',datum:tod(),tht:''}
  const [avF, setAvF] = useState<any>(emptyAv)
  const [uitModal, setUitModal] = useState<any>(null)
  const [uitAantal, setUitAantal] = useState('')
  const [uitDatum, setUitDatum] = useState(tod())
  const [agpModal, setAgpModal] = useState<any>(null)

  const addLog = (entry: any) => setLog((prev: any[]) => [...prev, {id:newId(prev||[]), datum:tod(), ...entry}])

  const wcPushNaBatch = async (batchId: number, verpakkingType: string, nieuweUitslag: any) => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) return
    try {
      const batch = bat.find((b: any) => b.id === batchId)
      if (!batch) return
      const art = (artikelen||[]).find((a: any) => a.biernaam === batch.naam && a.verpakking_type === verpakkingType)
      if (!art?.artikelnummer) return
      const bestaand = (uit||[])
        .filter((u: any) => bat.find((b: any) => b.id===u.batch_id)?.naam===art.biernaam && u.verpakking_type===verpakkingType)
        .reduce((s: number, u: any) => s + Math.max(0, Number(u.aantal||0) - Number(u.verkocht_stuks||0)), 0)
      const nieuwBeschik = nieuweUitslag
        ? Math.max(0, Number(nieuweUitslag.aantal||0) - Number(nieuweUitslag.verkocht_stuks||0))
        : 0
      const beschikbaar = bestaand + nieuwBeschik
      const prods = await wcGet(`products?sku=${encodeURIComponent(art.artikelnummer)}&per_page=1`)
      if (!prods?.length) return
      await wcPut(`products/${prods[0].id}`, {stock_quantity: beschikbaar, manage_stock: true})
    } catch(e) { /* WC auto-push failed silently */ }
  }

  const runBfSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setBfMsg('⚠ Geen Brewfather credentials ingesteld')
      return
    }
    setBfSyncing(true); setBfMsg('')
    try {
      const bfBatches = await bfGetBatches()
      let added = 0, updated = 0
      const newBatches: any[] = [], newBis: any[] = [], updBatches: any[] = [], refreshBisFor: any[] = []
      for (const bfB of bfBatches) {
        const existing = bat.find((b: any) => b.brewfather_id === bfB._id ||
          (bfB.batchNo != null && String(b.batch_nummer) === String(bfB.batchNo)))
        const appStatus = BF_TO_APP[bfB.status] || 'Gepland'
        if (!existing) {
          const nb = {...bfMapBatch(bfB), id: newId([...bat, ...newBatches])}
          newBatches.push(nb)
          const nbis = bfMapBis(bfB, nb.id, newId([...bi, ...newBis]) + newBis.length)
          newBis.push(...nbis)
          added++
        } else {
          const ch: any = {brewfather_id: bfB._id}
          if (existing.status !== appStatus) ch.status = appStatus
          if (bfB.measuredBatchSize) ch.liter_vergist = bfNumSafe(bfB.measuredBatchSize)
          if (bfB.measuredOg)  ch.OG  = bfNumSafe(bfB.measuredOg)
          if (bfB.measuredFg)  ch.FG  = bfNumSafe(bfB.measuredFg)
          if (bfB.measuredAbv) ch.ABV = bfNumSafe(bfB.measuredAbv)
          if (bfB.measuredBrewhouseEfficiency != null) ch.brouwzaal_eff = bfNumSafe(bfB.measuredBrewhouseEfficiency)
          else if (bfB.estimatedBrewhouseEfficiency != null && !existing.brouwzaal_eff) ch.brouwzaal_eff = bfNumSafe(bfB.estimatedBrewhouseEfficiency)
          if (bfB.measuredMashEfficiency != null) ch.maisch_eff = bfNumSafe(bfB.measuredMashEfficiency)
          if (bfB.measuredMashPh != null) ch.maisch_ph = bfNumSafe(bfB.measuredMashPh)
          if (bfB.measuredFermentationPh != null) ch.product_ph = bfNumSafe(bfB.measuredFermentationPh)
          else if (bfB.measuredPh != null && !existing.product_ph) ch.product_ph = bfNumSafe(bfB.measuredPh)
          const _rawN = bfB.notes||bfB.tasteNotes
          if (_rawN && !existing.notities) {
            ch.notities = Array.isArray(_rawN) ? _rawN.map((x: any) => typeof x==='string'?x:(x?.note||x?.text||x?.message||'')).filter(Boolean).join('\n') : (typeof _rawN==='object'&&_rawN ? String(_rawN.$string||_rawN.text||_rawN.note||'') : String(_rawN||''))
          }
          updBatches.push({id: existing.id, ch})
          const existingBis = bi.filter((x: any) => x.batch_id === existing.id)
          const hasWrongFields = existingBis.length > 0 && existingBis.some((x: any) => x.naam && !x.ingredient_naam)
          const hasNoBis = existingBis.length === 0
          if (hasWrongFields || hasNoBis) {
            refreshBisFor.push({batchId: existing.id, bfB})
          }
          updated++
        }
      }
      if (newBatches.length) setBat((prev: any[]) => [...prev, ...newBatches])
      if (updBatches.length) setBat((prev: any[]) => prev.map((b: any) => {
        const u = updBatches.find((x: any) => x.id===b.id); return u ? {...b, ...u.ch} : b
      }))
      setBi((prev: any[]) => {
        let next = [...prev, ...newBis]
        for (const {batchId, bfB} of refreshBisFor) {
          next = next.filter((x: any) => x.batch_id !== batchId)
          const freshBis = bfMapBis(bfB, batchId, newId(next) + next.length)
          next = [...next, ...freshBis]
        }
        return next
      })
      setBfMsg(`✓ Gesynchroniseerd — ${added} nieuw, ${updated} bijgewerkt`)
      if (bfSync) bfSync()
    } catch(e: any) {
      setBfMsg('⚠ Sync mislukt: ' + (e.message||String(e)))
    }
    setBfSyncing(false)
  }

  const getBi = (bid: number) => bi.filter((x: any) => x.batch_id === bid)

  const ingKosten = (b: any) => getBi(b.id).reduce((s: number, x: any) => {
    if (x.kosten) return s + Number(x.kosten)
    const lot = lots.find((l: any) => l.id === x.lot_id)
    return s + (lot?.prijs_per_eenheid ? lot.prijs_per_eenheid * Number(x.hoeveelheid||0) : 0)
  }, 0)

  const handleStatusChange = (nieuweStatus: string) => {
    const oudeStatus = selB?.status
    if (oudeStatus === nieuweStatus) return
    setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, status:nieuweStatus} : b))
    addLog({type:'status', batch_id:selB.id, referentie:`${oudeStatus} → ${nieuweStatus}`})
  }

  const saveBatch = () => {
    if (!bForm.naam.trim()) { alert(t('err_name_required')); return }
    if (bForm.tank && ['Vergisten','Conditioneren'].includes(bForm.status)) {
      const bezet = bat.find((b: any) => b.tank===bForm.tank && b.id!==editId && ['Vergisten','Conditioneren'].includes(b.status))
      if (bezet) { alert(t('err_tank_occupied').replace('{tank}',bForm.tank).replace('{name}',bezet.naam)); return }
    }
    if (editId) {
      const oud = bat.find((b: any) => b.id === editId)
      const velden: Record<string,string> = {naam:'Naam',stijl:'Stijl',batch_nummer:'Batch #',tank:'Tank',
        liter_vergist:'Liters',OG:'OG',FG:'FG',ABV:'ABV',
        brouwzaal_eff:'Brouwzaal eff.',maisch_eff:'Maisch eff.',maisch_ph:'Maisch pH',product_ph:'Product pH',
        electra_kosten:'Elektra',water_kosten:'Water',schoonmaak_kosten:'Schoonmaak',overige_kosten:'Overig',notities:'Notities'}
      const wijz = Object.entries(velden)
        .filter(([k]) => String(oud?.[k]??'') !== String(bForm[k]??''))
        .map(([k,l]) => `${l}: ${oud?.[k]||'—'} → ${bForm[k]||'—'}`)
      setBat((p: any[]) => p.map((b: any) => b.id===editId ? {...b,...bForm} : b))
      if (wijz.length > 0) addLog({type:'gewijzigd', batch_id:editId, referentie:wijz.join(' | ')})
      setEditId(null)
      setShowForm(false); setBForm(emptyB)
    } else {
      const nb = {id:newId(bat), ...bForm}
      setBat((prev: any[]) => [...prev, nb])
      addLog({type:'aangemaakt', batch_id:nb.id, referentie:nb.naam})
      setShowForm(false); setBForm(emptyB)
    }
  }

  const parseBfData = (raw: any) => {
    const bfNum = (v: any) => {
      if (v === null || v === undefined) return ''
      if (typeof v === 'number') return v
      if (typeof v === 'object') {
        const n = v.$numberDouble ?? v.$numberDecimal ?? v.$numberInt ?? v.$numberLong
        if (n !== undefined) return Number(n)||''
      }
      const n = Number(v)
      return isNaN(n) ? '' : n
    }
    const bfStr = (v: any) => {
      if (!v && v !== 0) return ''
      if (Array.isArray(v)) return v.map((x: any) => typeof x==='string' ? x : (x.note||x.text||x.message||'')).filter(Boolean).join('\n')
      if (typeof v === 'object') return String(v.$string||v.text||v.note||'')
      return String(v)
    }
    const bfDate = (v: any) => {
      if (!v) return tod()
      if (typeof v === 'number') return new Date(v).toISOString().split('T')[0]
      if (typeof v === 'object') {
        const ms = v.$date?.$numberLong ?? v.$date ?? null
        if (ms) return new Date(Number(ms)).toISOString().split('T')[0]
      }
      const s = String(v).split('T')[0]
      return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : tod()
    }
    const BF_MAP_LOCAL: Record<string,string> = {Planning:'Gepland',Brewing:'Brouwen',Fermenting:'Vergisten',Conditioning:'Conditioneren',Packaging:'Verpakt',Completed:'Gesloten',Archived:'Gesloten'}
    const batches = Array.isArray(raw) ? raw : [raw]
    let nextBatId = bat.length ? Math.max(0, ...bat.map((x: any) => x.id)) + 1 : 1
    let nextBiId  = bi.length  ? Math.max(0, ...bi.map((x: any) => x.id))  + 1 : 1
    const newBatches: any[] = [], newBis: any[] = []

    batches.forEach((d: any) => {
      const r = d.recipe || d
      const naam = bfStr(r.name||d.name||'')
      if (!naam) return
      const batch_nummer = bfStr(d.batchNo||d.number||r.batchNo||'')
      if (batch_nummer && bat.find((b: any) => String(b.batch_nummer)===String(batch_nummer))) {
        alert(t('err_batch_exists').replace('{num}',batch_nummer))
        return
      }
      const nb = {
        id: nextBatId++, batch_nummer, naam,
        stijl: bfStr(r.style?.name||d.style?.name||''),
        status: BF_MAP_LOCAL[bfStr(d.status)]||'Gepland',
        liter_vergist: bfNum(d.measuredBatchSize||d.estimatedFinalVolume||r.batchSize||r.equipment?.batchSize||''),
        OG:  bfNum(d.measuredOg||d.estimatedOg||r.og||''),
        FG:  bfNum(d.measuredFg||d.estimatedFg||r.fg||''),
        ABV: bfNum(d.measuredAbv||d.estimatedAbv||r.abv||''),
        tank: '', electra_kosten:'', water_kosten:'', schoonmaak_kosten:'', overige_kosten:'',
        notities: bfStr(d.notes||d.tasteNotes||''),
        datum: bfDate(d.brewDate),
      }
      newBatches.push(nb)
      const add = (naam: any, type: string, qty: any, eenh: any) => {
        const n = bfStr(naam)
        if (!n) return
        newBis.push({id:nextBiId++, batch_id:nb.id, ingredient_id:null,
          ingredient_naam:n, ingredient_type:type,
          hoeveelheid:bfNum(qty)||0, eenheid:bfStr(eenh)||'g',
          lot_id:null, afgeboekt:false, kosten:null})
      }
      ;(r.fermentables||[]).forEach((f: any) => add(f.name,'Mout',f.amount,f.unit||'kg'))
      ;(r.hops||[]).forEach((h: any) => add(h.name,'Hop',h.amount,h.unit||'g'))
      ;(r.yeasts||[]).forEach((y: any) => add(y.name,'Gist',y.amount||1,y.unit||'pkg'))
      ;(r.miscs||[]).forEach((m: any) => add(m.name,'Overig',m.amount,m.unit||'g'))
    })

    if (newBatches.length === 0) { alert(t('err_no_valid_batch_data')); return }
    setBat((prev: any[]) => [...prev, ...newBatches])
    setBi((prev: any[]) => [...prev, ...newBis])
    setShowBf(false); setBfJson(''); setBfFileName('')
    alert(t('batch_import_success').replace('{batches}',String(newBatches.length)).replace('{ingredients}',String(newBis.length)))
  }

  const importBf = () => {
    try { parseBfData(JSON.parse(bfJson)) }
    catch(e: any) { alert(t('err_invalid_json') + e.message) }
  }

  const loadBfFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBfFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev: any) => {
      try { parseBfData(JSON.parse(ev.target.result)) }
      catch(e: any) { alert(t('err_file_read') + e.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const fefoSort = (a: any, b: any) => {
    if (a.houdbaarheid && b.houdbaarheid) return new Date(a.houdbaarheid).getTime() - new Date(b.houdbaarheid).getTime()
    if (a.houdbaarheid) return -1
    if (b.houdbaarheid) return 1
    return a.id - b.id
  }

  const haalVanVoorraad = (biRow: any, ingMatch: any) => {
    if (!biRow.lot_id) { alert(t('err_select_lot_first')); return }
    const lot = lots.find((l: any) => l.id === biRow.lot_id)
    if (!lot) { alert(t('err_lot_not_found')); return }
    const qty = Number(biRow.hoeveelheid||0)
    if (convertEenheid(qty, biRow.eenheid, lot.eenheid) === null) {
      alert(t('err_convert_units').replace('{from}',biRow.eenheid).replace('{to}',lot.eenheid)); return
    }
    const selBatch = bat.find((b: any) => b.id === biRow.batch_id)
    const batchRef = selBatch ? `Batch: ${selBatch.naam}` : 'Batch'
    const availEenh = Number(lot.hoeveelheid||0)
    const availBi = r3(convertEenheid(availEenh, lot.eenheid, biRow.eenheid) ?? availEenh)

    if (availBi >= qty - 0.001) {
      const qtyInLot = r3(convertEenheid(qty, biRow.eenheid, lot.eenheid) ?? qty)
      setLots((prev: any[]) => prev.map((l: any) => l.id!==biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid||0) - qtyInLot)),
        beschikbaar: r3(Number(l.hoeveelheid||0) - qtyInLot) > 0,
      }))
      setBi((prev: any[]) => prev.map((x: any) => x.id===biRow.id ? {...x, afgeboekt:true} : x))
      addLog({ingredient_id:ingMatch?.id||null, ingredient_naam:biRow.ingredient_naam,
        lot_id:biRow.lot_id, lotnummer:lot.lotnummer||'', type:'gebruik',
        batch_id:biRow.batch_id, hoeveelheid:qty, eenheid:biRow.eenheid, referentie:batchRef})
    } else {
      if (availBi <= 0.001) { alert(t('err_lot_no_stock').replace('{lot}',lot.lotnummer||'—')); return }
      const useQty  = availBi
      const remainQ = r3(qty - useQty)
      const useInLotEenh = r3(convertEenheid(useQty, biRow.eenheid, lot.eenheid) ?? useQty)
      setLots((prev: any[]) => prev.map((l: any) => l.id!==biRow.lot_id ? l : {...l,
        hoeveelheid: r3(Math.max(0, Number(l.hoeveelheid||0) - useInLotEenh)),
        beschikbaar: false,
      }))
      setBi((prev: any[]) => {
        const nextId = prev.length ? Math.max(...prev.map((x: any) => x.id)) + 1 : 1
        return [
          ...prev.map((x: any) => x.id===biRow.id
            ? {...x, hoeveelheid:useQty, afgeboekt:true,
                kosten:lot.prijs_per_eenheid ? r3(lot.prijs_per_eenheid*useQty) : x.kosten}
            : x),
          {id:nextId, batch_id:biRow.batch_id, ingredient_id:biRow.ingredient_id,
            ingredient_naam:biRow.ingredient_naam, ingredient_type:biRow.ingredient_type,
            hoeveelheid:remainQ, eenheid:biRow.eenheid,
            lot_id:null, kosten:null, afgevinkt:false, afgeboekt:false},
        ]
      })
      addLog({ingredient_id:ingMatch?.id||null, ingredient_naam:biRow.ingredient_naam,
        lot_id:biRow.lot_id, lotnummer:lot.lotnummer||'', type:'gebruik',
        batch_id:biRow.batch_id, hoeveelheid:useQty, eenheid:biRow.eenheid, referentie:batchRef})
    }
  }

  const addIngFromBatch = (biRow: any) => {
    const newIng = {id:newId(ing), naam:biRow.ingredient_naam, type:biRow.ingredient_type||'Overig', fabrikant:''}
    setIng((prev: any[]) => [...prev, newIng])
    setBi((prev: any[]) => prev.map((x: any) => x.id===biRow.id ? {...x, ingredient_id:newIng.id} : x))
  }

  const addIng = (bid: number) => {
    const ingObj = ing.find((i: any) => i.id === Number(iForm.ingredient_id))
    const naam = ingObj ? ingObj.naam : iForm.ingredient_naam.trim()
    const type = ingObj ? ingObj.type : iForm.ingredient_type
    if (!naam) { alert(t('err_select_ingredient')); return }
    if (!iForm.hoeveelheid || Number(iForm.hoeveelheid) <= 0) { alert(t('err_qty_required')); return }
    setBi((prev: any[]) => [...prev, {
      id:newId(bi), batch_id:bid,
      ingredient_id: ingObj ? ingObj.id : null,
      ingredient_naam:naam, ingredient_type:type,
      hoeveelheid:Number(iForm.hoeveelheid||0), eenheid:iForm.eenheid,
      lot_id:iForm.lot_id ? Number(iForm.lot_id) : null,
      kosten:iForm.kosten ? Number(iForm.kosten) : null, afgevinkt:false,
      afgeboekt: !!iForm.lot_id,
    }])
    if (iForm.lot_id) {
      const lotId = Number(iForm.lot_id), qty = Number(iForm.hoeveelheid||0)
      const lot = lots.find((l: any) => l.id === lotId)
      const qtyInLot = convertEenheid(qty, iForm.eenheid, lot?.eenheid||iForm.eenheid) ?? qty
      if (lot && convertEenheid(qty, iForm.eenheid, lot.eenheid) === null) {
        alert(t('err_convert_units').replace('{from}',iForm.eenheid).replace('{to}',lot.eenheid)); return
      }
      setLots((prev: any[]) => prev.map((l: any) => l.id!==lotId ? l : {...l,
        hoeveelheid: Math.max(0, Number(l.hoeveelheid||0) - qtyInLot),
        beschikbaar: Number(l.hoeveelheid||0) - qtyInLot > 0,
      }))
    }
    setIForm(emptyI)
  }

  const toggleAf = (id: number) => setBi((prev: any[]) => prev.map((x: any) => x.id===id ? {...x, afgevinkt:!x.afgevinkt} : x))

  const removeBI = (id: number) => {
    const item = bi.find((x: any) => x.id === id)
    if (item?.afgeboekt && item.lot_id) {
      const qty = Number(item.hoeveelheid||0)
      const lot = lots.find((l: any) => l.id === item.lot_id)
      const qtyInLot = convertEenheid(qty, item.eenheid, lot?.eenheid||item.eenheid) ?? qty
      setLots((prev: any[]) => prev.map((l: any) => l.id!==item.lot_id ? l : {...l,
        hoeveelheid: Number(l.hoeveelheid||0) + qtyInLot,
        beschikbaar: true,
      }))
      addLog({ingredient_id:item.ingredient_id||null, ingredient_naam:item.ingredient_naam,
        lot_id:item.lot_id, lotnummer:lot?.lotnummer||'', type:'terugboeking',
        batch_id:item.batch_id, hoeveelheid:qty, eenheid:item.eenheid, referentie:'Verwijderd uit batch'})
    }
    setBi((prev: any[]) => prev.filter((x: any) => x.id !== id))
  }

  const removeBatch = (id: number) => {
    if (confirm(t('error_confirm_delete_batch'))) {
      setBat((prev: any[]) => prev.filter((b: any) => b.id !== id))
      setBi((prev: any[]) => prev.filter((x: any) => x.batch_id !== id))
      setSel(null)
    }
  }

  const selB = bat.find((b: any) => b.id === sel)
  const bAv = sel ? (av||[]).filter((a: any) => a.batch_id === sel) : []
  const uitgeslVanAv = (avId: number) => (uit||[]).filter((u: any) => u.afvulling_id===avId).reduce((s: number, u: any) => s+Number(u.aantal||0), 0)
  const resterendAv = (a: any) => Number(a.hoeveelheid||0) - uitgeslVanAv(a.id)
  const totAfgevuld = bAv.reduce((s: number, a: any) => s + Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
  const totUitgeslagen = bAv.reduce((s: number, a: any) => s + uitgeslVanAv(a.id)*Number(a.inhoud_per_eenheid||0), 0)

  const vpVoorraadB = (vp: any) => {
    if (!vp.onderdelen?.length) return Number(vp.voorraad||0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = onderdelen.find((d: any) => d.id === o.onderdeel_id)
      return Math.floor(Number(od?.voorraad||0) / Number(o.aantal||1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }

  const doAfvullen = () => {
    if (!avF.verpakking_id || !avF.hoeveelheid) { alert(t('err_select_packaging_qty')); return }
    const n = Number(avF.hoeveelheid)
    const vp = (verpakkingen||[]).find((v: any) => v.id === Number(avF.verpakking_id))
    if (!vp) { alert(t('err_invalid_packaging')); return }
    const avail = vpVoorraadB(vp)
    if (avail < n) { alert(t('err_insufficient_packaging_n').replace('{n}',String(avail))); return }
    if (vp.onderdelen?.length) {
      setOnderdelen((prev: any[]) => prev.map((od: any) => {
        const usage = vp.onderdelen.find((o: any) => o.onderdeel_id === od.id)
        return usage ? {...od, voorraad:Math.max(0, Number(od.voorraad||0) - n*Number(usage.aantal||1))} : od
      }))
    } else {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id===Number(avF.verpakking_id) ? {...v, voorraad:Number(v.voorraad||0)-n} : v))
    }
    setAv((prev: any[]) => [...(prev||[]), {id:newId(prev||[]), batch_id:sel, ...avF, verpakking_id:Number(avF.verpakking_id), inhoud_per_eenheid:Number(avF.inhoud_per_eenheid), hoeveelheid:n}])
    addLog({type:'afvullen', batch_id:sel, verpakking_type:vp.naam||avF.verpakking_type,
      hoeveelheid:n, eenheid:'stuks', referentie:`${(n*Number(avF.inhoud_per_eenheid||0)).toFixed(1)}L`})
    setAvF(emptyAv)
  }

  const doUitslaan = () => {
    if (!uitAantal) { alert(t('err_enter_qty')); return }
    const n = Number(uitAantal)
    const rest = resterendAv(uitModal)
    if (n > rest) { alert(t('err_max_available').replace('{n}',String(rest))); return }
    const liter = n * Number(uitModal.inhoud_per_eenheid||0)
    const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
    const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
    const accBed = accijnsCalc(liter, selB?.ABV||0, r1, r2, accijnsInst)
    const nu = {id:newId(uit||[]), batch_id:sel, afvulling_id:uitModal.id, verpakking_type:uitModal.verpakking_type,
      inhoud_per_eenheid:uitModal.inhoud_per_eenheid, aantal:n, datum:uitDatum, liter, accijns:accBed, tht:uitModal.tht||null, verkocht_stuks:0}
    setUit((prev: any[]) => [...(prev||[]), nu])
    setAcc((prev: any[]) => [...(prev||[]), {id:newId(prev||[]), batch_id:sel, batch_nummer:selB?.batch_nummer||'',
      uitslag_id:nu.id, verpakking_type:uitModal.verpakking_type, datum:uitDatum, aantal:n, liter,
      abv:selB?.ABV||0, accijns:accBed, betaald:false, betaal_datum:null}])
    addLog({type:'uitslaan', batch_id:sel, verpakking_type:uitModal.verpakking_type,
      hoeveelheid:n, eenheid:'stuks', referentie:`${liter.toFixed(1)}L`})
    const agpInfo = {
      label: `${selB?.naam||''}${selB?.batch_nummer ? ` — #${selB.batch_nummer}` : ''} · ${uitModal.verpakking_type} (${n} stuks)`
    }
    setUitModal(null); setUitAantal(''); setUitDatum(tod())
    wcPushNaBatch(sel!, uitModal.verpakking_type, nu)
    setAgpModal(agpInfo)
  }

  const delAv = (id: number) => {
    if ((uit||[]).some((u: any) => u.afvulling_id === id)) { alert(t('err_cannot_delete_has_releases')); return }
    setAv((prev: any[]) => (prev||[]).filter((a: any) => a.id !== id))
  }

  const STATUS_LABELS: Record<string,string> = {
    Gepland:t('status_planning'), Brouwen:t('status_brewing'), Vergisten:t('status_fermenting'),
    Conditioneren:t('status_conditioning'), Verpakt:t('status_packaged'), Gesloten:t('status_closed')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_batches')}</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {bfMsg && <span className={`text-xs font-medium ${bfMsg.startsWith('✓')?'text-green-600':'text-red-600'}`}>{bfMsg}</span>}
          <Btn onClick={runBfSync} disabled={bfSyncing||!bfCreds?.enabled}
            cls={!bfCreds?.enabled?'opacity-50 cursor-not-allowed':''}>
            {bfSyncing ? t('batch_syncing') : t('batch_sync_brewfather')}
          </Btn>
          <Btn v="secondary" onClick={()=>setShowBf(true)}>{t('batch_import_json')}</Btn>
          <Btn onClick={()=>{setEditId(null);setBForm(emptyB);setShowForm(true)}}>{t('batch_add_btn')}</Btn>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Batch list */}
        <div className={`w-full md:w-60 md:flex-shrink-0${sel?' hidden md:block':''}`}>
          <div className="mb-2">
            <input type="text" placeholder={t('search_batch')}
              className="w-full border rounded-lg px-3 py-2 text-sm t-input"
              value={batchZoek} onChange={e=>{setBatchZoek(e.target.value); setSel(null)}} />
          </div>
          <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <div className="flex justify-between px-3 py-1.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b">
              <span>{t('lbl_name')}</span><span>{t('lbl_status')}</span>
            </div>
            {bat.length === 0 && <div className="p-6 text-center text-gray-400 text-sm">{t('msg_no_batches')}</div>}
            {bat.filter((b: any) => b.status!=='Gesloten' && (!batchZoek || b.naam?.toLowerCase().includes(batchZoek.toLowerCase()) || String(b.batch_nummer||'').includes(batchZoek) || (b.stijl||'').toLowerCase().includes(batchZoek.toLowerCase()))).map((b: any) => (
              <div key={b.id} onClick={()=>setSel(b.id)}
                className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel===b.id?'t-sel border-l-2':''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{b.naam||b.batch_nummer}</span>
                  <Badge s={b.status} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{b.batch_nummer?`#${b.batch_nummer} · `:''}{b.stijl}{b.liter_vergist?` · ${b.liter_vergist}L`:''}</div>
              </div>
            ))}
            {bat.filter((b: any) => b.status==='Gesloten').length > 0 && (
              <div>
                <div onClick={()=>setBatchArchiefIngeklapt((v: any)=>!v)}
                  className="px-3 py-2 bg-gray-600 text-white flex items-center gap-2 cursor-pointer hover:bg-gray-500 select-none">
                  <span className="text-gray-300 text-sm">{batchArchiefIngeklapt?'▶':'▼'}</span>
                  <span className="text-xs font-medium text-gray-200 uppercase">{t('batch_archived')} ({bat.filter((b: any) => b.status==='Gesloten').length})</span>
                </div>
                {!batchArchiefIngeklapt && bat.filter((b: any) => b.status==='Gesloten').map((b: any) => (
                  <div key={b.id} onClick={()=>setSel(b.id)}
                    className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel===b.id?'t-sel border-l-2':''}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-500">{b.naam||b.batch_nummer}</span>
                      <Badge s={b.status} />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{b.batch_nummer?`#${b.batch_nummer} · `:''}{b.stijl}{b.liter_vergist?` · ${b.liter_vergist}L`:''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Batch detail */}
        {selB && (<>
          <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={()=>setSel(null)}>{t('btn_back')}</button>
          <div className="flex-1 min-w-0 space-y-4">
            {/* Header card */}
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 t-hdr-solid text-white flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-base font-semibold leading-tight truncate">{selB.naam}</div>
                  {selB.batch_nummer && <div className="text-xs text-gray-400 mt-0.5">#{selB.batch_nummer}{selB.stijl ? ` · ${selB.stijl}` : ''}</div>}
                </div>
                <div className="flex gap-2 items-center flex-shrink-0 ml-3">
                  <select value={selB.status} onChange={e=>handleStatusChange(e.target.value)}
                    className="border border-gray-600 rounded px-2 py-1 text-xs bg-gray-700 text-white t-input">
                    {STATUSSEN.map(s => <option key={s} value={s}>{STATUS_LABELS[s]||s}</option>)}
                  </select>
                  <Btn s="sm" v="header" onClick={()=>{setEditId(selB.id);setBForm({...selB});setShowForm(true)}}>{t('btn_edit')}</Btn>
                  <Btn s="sm" v="header-danger" onClick={()=>removeBatch(selB.id)}>{t('btn_delete')}</Btn>
                </div>
              </div>

              {/* Info collapse */}
              <div className="px-4 py-2 flex items-center gap-2 cursor-pointer select-none hover:bg-gray-50 border-b" onClick={()=>setInfoIngeklapt(v=>!v)}>
                <span className="text-gray-400 text-xs">{infoIngeklapt ? '▶' : '▼'}</span>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('batch_info_label')}</span>
              </div>
              {!infoIngeklapt && (
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    {([
                      [t('lbl_status'), <Badge s={selB.status} />],
                      [t('batch_info_batch_nr'), selB.batch_nummer||'—'],
                      [t('lbl_date'), fmtD(selB.datum)],
                      [t('batch_info_style'), selB.stijl||'—'],
                      [t('lbl_tank'), selB.tank||'—'],
                      [t('lbl_liters_fermented'), selB.liter_vergist ? `${selB.liter_vergist}L` : '—'],
                      [t('batch_info_og'), selB.OG||'—'],
                      [t('batch_info_fg'), selB.FG||'—'],
                      [t('batch_info_alcohol'), selB.ABV ? `${selB.ABV}%` : '—'],
                      selB.brouwzaal_eff ? [t('batch_info_brew_efficiency'), `${Number(selB.brouwzaal_eff).toFixed(1)}%`] : null,
                      selB.maisch_eff    ? [t('batch_info_mash_efficiency'), `${Number(selB.maisch_eff).toFixed(1)}%`] : null,
                      selB.maisch_ph     ? [t('batch_info_mash_ph'),         Number(selB.maisch_ph).toFixed(2)] : null,
                      selB.product_ph    ? [t('batch_info_product_ph'),      Number(selB.product_ph).toFixed(2)] : null,
                    ] as any[]).filter(Boolean).map(([l, v]: any) => (
                      <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className="mt-0.5">{v}</div></div>
                    ))}
                  </div>
                  {safeStr(selB.notities) && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="text-xs font-medium text-gray-500 mb-1">{t('lbl_notes')}</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">{safeStr(selB.notities)}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Kosten samenvatting */}
              <div className="px-4 pb-4">
                {(() => {
                  const ingK = ingKosten(selB)
                  const overH = Number(selB.electra_kosten||0)+Number(selB.water_kosten||0)+Number(selB.schoonmaak_kosten||0)+Number(selB.overige_kosten||0)
                  const totK = ingK + overH
                  const batchAv = av ? av.filter((a: any) => a.batch_id===selB.id) : []
                  const totLiterVerpakt = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
                  const totStuks = batchAv.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
                  const tankLiter = Number(selB.liter_vergist||0)
                  const verlies = tankLiter>0 && totLiterVerpakt>0 ? tankLiter-totLiterVerpakt : null
                  const verliesPct = verlies!==null && tankLiter>0 ? (verlies/tankLiter*100) : null
                  const kostenPerLiter = totLiterVerpakt>0 ? totK/totLiterVerpakt : (tankLiter>0 ? totK/tankLiter : null)
                  return (
                    <div className="mt-3 pt-3 border-t space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('nav_ingredienten')}</span>
                          <span className={ingK>0?'':'text-gray-400'}>{ingK>0?fmt(ingK):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_electricity')}</span>
                          <span className={selB.electra_kosten?'':'text-gray-400'}>{selB.electra_kosten?fmt(selB.electra_kosten):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_overhead_total')}</span>
                          <span className={overH>0?'':'text-gray-400'}>{overH>0?fmt(overH):'—'}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_water')}</span>
                          <span className={selB.water_kosten?'':'text-gray-400'}>{selB.water_kosten?fmt(selB.water_kosten):'—'}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-gray-800 pt-1 border-t">
                          <span className="text-xs">{t('batch_total_costs')}</span>
                          <span>{fmt(totK)}</span>
                        </div>
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_cleaning')}</span>
                          <span className={selB.schoonmaak_kosten?'':'text-gray-400'}>{selB.schoonmaak_kosten?fmt(selB.schoonmaak_kosten):'—'}</span>
                        </div>
                        {kostenPerLiter!==null && (
                          <div className="flex justify-between text-amber-700">
                            <span className="text-xs">{t('batch_costs_per_liter')}</span>
                            <span className="font-medium">{fmt(kostenPerLiter)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-gray-600">
                          <span className="text-xs">{t('batch_costs_other')}</span>
                          <span className={selB.overige_kosten?'':'text-gray-400'}>{selB.overige_kosten?fmt(selB.overige_kosten):'—'}</span>
                        </div>
                      </div>
                      {batchAv.length > 0 && (
                        <div className="pt-2 border-t">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                            <div>
                              <span className="text-gray-500 text-xs block">{t('status_packaged')}</span>
                              <span className="font-medium">{totLiterVerpakt.toFixed(1)}L</span>
                              <span className="text-gray-400 text-xs ml-1">({totStuks} st)</span>
                            </div>
                            {tankLiter > 0 && (
                              <div>
                                <span className="text-gray-500 text-xs block">{t('batch_tank_volume')}</span>
                                <span className="font-medium">{tankLiter}L</span>
                              </div>
                            )}
                            {verlies !== null && (
                              <div>
                                <span className="text-gray-500 text-xs block">{t('batch_loss')}</span>
                                <span className={`font-medium ${verliesPct!=null&&verliesPct>10?'text-red-600':verliesPct!=null&&verliesPct>5?'text-yellow-600':'text-green-700'}`}>
                                  {verlies.toFixed(1)}L
                                </span>
                                {verliesPct!==null && <span className="text-xs text-gray-400 ml-1">({verliesPct.toFixed(1)}%)</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Hygiene checklist */}
            {(() => {
              const items = hygieneItems && hygieneItems.length ? hygieneItems : DEFAULT_HYGIENE_ITEMS
              const groups = hygieneGroups && hygieneGroups.length ? hygieneGroups : DEFAULT_HYGIENE_GROUPS
              const checks = selB.hygiene_checks || {}
              const totaal = items.length
              const gedaan = items.filter((i: any) => checks[i.id]).length
              const alleOk = totaal > 0 && gedaan === totaal
              const toggleCheck = (itemId: any) => {
                const wordtAangevinkt = !checks[itemId]
                const nieuweChecks = {...checks, [itemId]: wordtAangevinkt}
                setBat((prev: any[]) => prev.map((b: any) => b.id===selB.id ? {...b, hygiene_checks: nieuweChecks} : b))
                const item = items.find((i: any) => i.id===itemId)
                const groep = item?.group_id ? groups.find((g: any) => g.id===item.group_id) : null
                const label = groep ? `${groep.label} — ${item?.label}` : item?.label||`item ${itemId}`
                addLog({type:'hygiene', batch_id:selB.id, referentie:`${wordtAangevinkt?'✓ Afgevinkt':'✗ Ongedaan'}: ${label}`})
              }
              const ungrouped = items.filter((i: any) => !i.group_id)
              const gegroepeerd = groups.map((g: any) => ({
                group: g,
                items: items.filter((i: any) => i.group_id === g.id),
              })).filter((g: any) => g.items.length > 0)
              return (
                <div className="bg-white rounded-xl shadow-card overflow-hidden">
                  <div className={`px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer hover:opacity-90 select-none ${hygieneIngeklapt?'rounded-xl':'rounded-t-xl'}`}
                    onClick={()=>setHygieneIngeklapt((p: any)=>!p)}>
                    <span className="flex items-center gap-2">
                      <span className="text-white/70 text-xs">{hygieneIngeklapt?'▶':'▼'}</span>
                      {t('batch_hygiene_title')}
                    </span>
                    <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${alleOk ? 'bg-green-500 text-white' : gedaan>0 ? 'bg-amber-400 text-white' : 'bg-teal-600 text-teal-200'}`}>
                      {totaal===0 ? t('batch_hygiene_no_items_short') : `${gedaan}/${totaal}`}
                    </span>
                  </div>
                  {!hygieneIngeklapt && (
                    <div className="p-3 space-y-3">
                      {totaal === 0 && <p className="text-sm text-gray-400 italic">{t('batch_hygiene_no_items')}</p>}
                      {gegroepeerd.map(({group, items:gItems}: any) => (
                        <div key={group.id}>
                          <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-1.5 pb-1 border-b border-teal-100">{group.label}</div>
                          <div className="space-y-0.5">
                            {gItems.map((item: any) => (
                              <label key={item.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                                <input type="checkbox" checked={!!checks[item.id]} onChange={()=>toggleCheck(item.id)}
                                  className="w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0" />
                                <span className={`text-sm ${checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.label}</span>
                                {checks[item.id] && <span className="ml-auto text-teal-500 text-xs">✓</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {ungrouped.length > 0 && (
                        <div>
                          {gegroepeerd.length > 0 && <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 pb-1 border-b border-gray-100">{t('lbl_other')}</div>}
                          <div className="space-y-0.5">
                            {ungrouped.map((item: any) => (
                              <label key={item.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                                <input type="checkbox" checked={!!checks[item.id]} onChange={()=>toggleCheck(item.id)}
                                  className="w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0" />
                                <span className={`text-sm ${checks[item.id] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.label}</span>
                                {checks[item.id] && <span className="ml-auto text-teal-500 text-xs">✓</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {totaal > 0 && (
                        <div className={`text-xs font-medium px-2 py-1.5 rounded flex items-center gap-2 ${alleOk ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                          {alleOk ? '✅ ' + t('hygiene_all_checked') : `${gedaan} ${t('hygiene_of')} ${totaal} ${t('hygiene_checked')}`}
                          {gedaan>0 && !alleOk && (
                            <button onClick={()=>{setBat((prev: any[])=>prev.map((b: any)=>b.id===selB.id?{...b,hygiene_checks:{}}:b)); addLog({type:'hygiene', batch_id:selB.id, referentie:'Checklist gereset'})}}
                              className="ml-auto text-xs text-gray-400 hover:text-red-500 underline">{t('batch_hygiene_reset')}</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Ingredienten */}
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <div className={`px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between cursor-pointer hover:opacity-90 select-none ${ingIngeklapt?'rounded-xl':'rounded-t-xl'}`}
                onClick={()=>setIngIngeklapt((p: any)=>!p)}>
                <span className="flex items-center gap-2">
                  <span className="text-white/70 text-xs">{ingIngeklapt?'▶':'▼'}</span>
                  {t('batch_ingredient_header')}
                </span>
                <span className="text-xs font-normal text-gray-300">{getBi(selB.id).length} items</span>
              </div>
              {!ingIngeklapt && (<>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left">{t('lbl_name')}</th>
                      <th className="px-3 py-1.5 text-left">{t('lbl_type')}</th>
                      <th className="px-3 py-1.5 text-right">{t('lbl_quantity_short')}</th>
                      <th className="px-3 py-1.5 text-left">{t('lbl_lot')}</th>
                      <th className="px-3 py-1.5 text-right">{t('lbl_costs')}</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  {(() => {
                    const allRows = getBi(selB.id)
                    const groupsArr: any[] = []
                    const seen = new Set<string>()
                    for (const x of allRows) {
                      const gKey = x.ingredient_id ? `id:${x.ingredient_id}` : `naam:${x.ingredient_naam}`
                      if (!seen.has(gKey)) {
                        seen.add(gKey)
                        groupsArr.push({
                          key: gKey,
                          naam: x.ingredient_naam,
                          type: x.ingredient_type,
                          eenheid: x.eenheid,
                          rows: allRows.filter((r: any) =>
                            x.ingredient_id
                              ? r.ingredient_id === x.ingredient_id
                              : !r.ingredient_id && r.ingredient_naam === x.ingredient_naam
                          ),
                        })
                      }
                    }
                    const ING_TYPES: Record<string,string> = {Mout:t('ing_type_mout'),Hop:t('ing_type_hop'),Gist:t('ing_type_gist'),Suiker:t('ing_type_suiker'),Overig:t('ing_type_overig')}
                    return groupsArr.map(g => {
                      const totalQty  = r3(g.rows.reduce((s: number, r: any) => s+Number(r.hoeveelheid||0), 0))
                      const bookedQty = r3(g.rows.filter((r: any) => r.afgeboekt).reduce((s: number, r: any) => s+Number(r.hoeveelheid||0), 0))
                      const remainQty = r3(totalQty - bookedQty)
                      const multi     = g.rows.length > 1
                      const volledig  = remainQty <= 0.001
                      return (
                        <tbody key={g.key} className="divide-y divide-gray-100">
                          {multi && (
                            <tr className="bg-amber-50 border-b border-amber-100">
                              <td className="px-3 py-1.5 font-medium text-sm">{g.naam}</td>
                              <td className="px-3 py-1.5 text-gray-500 text-xs">{g.type}</td>
                              <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold text-gray-700">{totalQty} {g.eenheid}</td>
                              <td className="px-3 py-1.5 text-xs" colSpan={2}>
                                {bookedQty > 0 && <span className="text-green-700">✓ {bookedQty} {g.eenheid} {t('ing_booked_suffix')}</span>}
                                {!volledig && <span className="text-amber-700 font-medium ml-2">· {t('batch_ingredient_still_needed')} {remainQty} {g.eenheid} {t('batch_ingredient_still_needed_text')}</span>}
                                {volledig  && <span className="text-green-600 font-semibold ml-2">· {t('batch_ingredient_all_booked')}</span>}
                              </td>
                              <td></td>
                            </tr>
                          )}
                          {g.rows.map((x: any) => {
                            const lot = lots.find((l: any) => l.id === x.lot_id)
                            const kosten = x.kosten ? x.kosten : (lot?.prijs_per_eenheid ? lot.prijs_per_eenheid*Number(x.hoeveelheid||0) : null)
                            const ingMatch = x.ingredient_id
                              ? ing.find((i: any) => i.id===x.ingredient_id)
                              : ing.find((i: any) => i.naam.toLowerCase()===x.ingredient_naam?.toLowerCase())
                            const ingLots = ingMatch
                              ? [...lots.filter((l: any) => (l.beschikbaar||(l.id===x.lot_id)) && l.ingredient_id===ingMatch.id)].sort(fefoSort)
                              : []
                            const selLotAvailBi = lot
                              ? (convertEenheid(Number(lot.hoeveelheid||0), lot.eenheid, x.eenheid) ?? Number(lot.hoeveelheid||0))
                              : 0
                            const lotTekort = x.lot_id && !x.afgeboekt && selLotAvailBi < Number(x.hoeveelheid||0) - 0.001
                            const lotCell = !ingMatch ? (
                              <button onClick={()=>addIngFromBatch(x)}
                                className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap">
                                + {t('batch_ingredient_add')}
                              </button>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {!x.afgeboekt && (
                                  <select value={x.lot_id||''} onChange={e=>setBi((prev: any[])=>prev.map((b: any)=>b.id===x.id?{...b,lot_id:e.target.value?Number(e.target.value):null}:b))}
                                    className={`border rounded px-1 py-0.5 text-xs bg-white ${lotTekort?'border-amber-300':'border-gray-200'}`}>
                                    <option value="">{t('ing_choose_lot')}</option>
                                    {ingLots.map((l: any) => {
                                      const avBi = convertEenheid(Number(l.hoeveelheid||0), l.eenheid, x.eenheid) ?? Number(l.hoeveelheid||0)
                                      const ok = avBi >= Number(x.hoeveelheid||0) - 0.001
                                      const thtStr = l.houdbaarheid ? ` · THT ${l.houdbaarheid}` : ''
                                      return <option key={l.id} value={l.id}>{ok?'':'⚠ '}{l.lotnummer||'—'} ({r3(avBi)} {x.eenheid}{thtStr})</option>
                                    })}
                                  </select>
                                )}
                                {lotTekort && (
                                  <span className="text-xs text-amber-600">
                                    {t('lot_partial_warning').replace('{n}',String(r3(selLotAvailBi))).replace('{unit}',x.eenheid)}
                                  </span>
                                )}
                                {x.lot_id && !x.afgeboekt && (
                                  <button onClick={()=>haalVanVoorraad(x, ingMatch)}
                                    className={`text-xs border rounded px-1.5 py-0.5 text-left whitespace-nowrap ${
                                      lotTekort ? 't-back' : 'text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 border-green-200'}`}>
                                    {lotTekort ? `📦 Boek ${r3(selLotAvailBi)} ${x.eenheid}` : t('batch_ingredient_book')}
                                  </button>
                                )}
                                {x.afgeboekt && lot && <span className="text-xs text-green-600 font-medium whitespace-nowrap">✓ {lot.lotnummer||'—'}</span>}
                                {x.afgeboekt && !lot && <span className="text-xs text-green-600 font-medium">{t('batch_ingredient_booked')}</span>}
                              </div>
                            )
                            return (
                              <tr key={x.id} className={multi ? 'bg-white' : ''}>
                                <td className={`px-3 py-1.5 ${multi ? 'pl-5 text-gray-500 text-xs' : ''}`}>
                                  {multi ? <><span className="text-gray-300 mr-1">↳</span><span>{x.hoeveelheid} {x.eenheid}</span></> : x.ingredient_naam}
                                </td>
                                <td className="px-3 py-1.5 text-gray-500 text-xs">{multi ? '' : (ING_TYPES[x.ingredient_type]||x.ingredient_type)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{multi ? '' : <>{x.hoeveelheid} {x.eenheid}</>}</td>
                                <td className="px-3 py-1.5" colSpan={multi ? 2 : 1}>{lotCell}</td>
                                {!multi && <td className="px-3 py-1.5 text-right text-xs">{kosten!==null?fmt(kosten):'—'}</td>}
                                <td className="px-3 py-1.5"><button onClick={()=>removeBI(x.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      )
                    })
                  })()}
                </table>
                <div className="bg-gray-50 border-t">
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide hover:bg-gray-100 select-none border-b"
                    onClick={e=>{e.stopPropagation();setIngFormOpen(p=>!p)}}>
                    <span className="text-gray-400">{ingFormOpen?'▼':'▶'}</span>
                    {t('batch_add_ingredient_btn')}
                  </button>
                  {ingFormOpen && <div className="px-3 pb-2 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <select value={iForm.ingredient_id} onChange={e=>{
                          const id = e.target.value
                          const o = ing.find((i: any) => i.id===Number(id))
                          setIForm((f: any) => ({...f, ingredient_id:id, ingredient_naam:o?o.naam:'', ingredient_type:o?o.type:f.ingredient_type, lot_id:'', kosten:''}))
                        }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                          <option value="">{t('ing_choose_ingredient_opt')}</option>
                          {BUILTIN_ING_TYPES.map(ingTyp => {
                            const r = [...ing.filter((i: any) => i.type===ingTyp)].sort((a: any,b: any)=>a.naam.localeCompare(b.naam,'nl'))
                            return r.length ? <optgroup key={ingTyp} label={t('ing_type_'+ingTyp.toLowerCase())}>{r.map((i: any)=><option key={i.id} value={i.id}>{i.naam}</option>)}</optgroup> : null
                          })}
                          <option value="custom">{t('ing_free_fill')}</option>
                        </select>
                      </div>
                      {iForm.ingredient_id==='custom'
                        ? <Inp value={iForm.ingredient_naam} onChange={(v: string)=>setIForm((f: any)=>({...f,ingredient_naam:v}))} placeholder={t('ph_ingredient_name')} />
                        : <div className="border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-400 bg-gray-50 flex items-center">{iForm.ingredient_type?t('ing_type_'+iForm.ingredient_type.toLowerCase()):<span className="italic text-xs">type</span>}</div>
                      }
                      <Inp type="number" value={iForm.hoeveelheid} onChange={(v: string)=>{
                        const lot = lots.find((l: any)=>l.id===Number(iForm.lot_id))
                        setIForm((f: any)=>({...f,hoeveelheid:v,kosten:lot?.prijs_per_eenheid&&v?String((lot.prijs_per_eenheid*Number(v)).toFixed(2)):f.kosten}))
                      }} placeholder={t('ph_qty')} />
                      <Sel value={iForm.eenheid} onChange={(v: string)=>setIForm((f: any)=>({...f,eenheid:v}))} opts={EENHEDEN.map(e=>({v:e,l:t('unit_'+e.toLowerCase())}))} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                      <div>
                        <select value={iForm.lot_id} onChange={e=>{
                          const lid = e.target.value
                          const lot = lots.find((l: any)=>l.id===Number(lid))
                          setIForm((f: any)=>({...f,lot_id:lid,kosten:lot?.prijs_per_eenheid&&f.hoeveelheid?String((lot.prijs_per_eenheid*Number(f.hoeveelheid)).toFixed(2)):f.kosten}))
                        }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                          <option value="">{t('ing_choose_lot')}</option>
                          {[...(iForm.ingredient_id && iForm.ingredient_id!=='custom'
                            ? lots.filter((l: any)=>l.ingredient_id===Number(iForm.ingredient_id)&&l.beschikbaar)
                            : lots.filter((l: any)=>l.beschikbaar)
                          )].sort(fefoSort).map((l: any) => {
                            const thtStr = l.houdbaarheid ? ` · THT ${l.houdbaarheid}` : ''
                            return <option key={l.id} value={l.id}>{l.lotnummer||'—'} ({l.hoeveelheid}{l.eenheid}{thtStr})</option>
                          })}
                        </select>
                      </div>
                      <Inp type="number" value={iForm.kosten} onChange={(v: string)=>setIForm((f: any)=>({...f,kosten:v}))} placeholder={t('ph_costs')} />
                      <div />
                      <Btn s="sm" onClick={()=>addIng(selB.id)}>{t('settings_tank_add_btn')}</Btn>
                    </div>
                  </div>}
                </div>
              </>)}
            </div>

            {/* Afvullen sectie - alleen bij Conditioneren */}
            {selB.status==='Conditioneren' && (() => {
              const vergist = Number(selB.liter_vergist||0)
              const inTank = Math.max(0, vergist - totAfgevuld)
              const opVoorraad = totAfgevuld - totUitgeslagen
              const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
              const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
              return (
                <div className="space-y-3">
                  <div className="bg-white rounded-xl shadow-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    {([
                      [t('batch_stat_fermented'), selB.liter_vergist?`${selB.liter_vergist}L`:'—', ''],
                      [t('batch_stat_in_tank'), vergist?`${inTank.toFixed(1)}L`:'—', inTank>0?'text-orange-600':'text-gray-400'],
                      [t('lbl_filled'), `${totAfgevuld.toFixed(1)}L`, 'text-green-700'],
                      [t('batch_stat_released'), `${totUitgeslagen.toFixed(1)}L`, 'text-blue-700'],
                      [t('batch_stat_in_stock'), `${opVoorraad.toFixed(1)}L`, 'text-amber-700'],
                    ] as any[]).map(([l,v,c]: any) => (
                      <div key={l}><span className="text-gray-500 text-xs">{l}</span><div className={`font-medium ${c}`}>{v}</div></div>
                    ))}
                  </div>

                  <div className="bg-white rounded-xl shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center gap-2 cursor-pointer select-none" onClick={()=>setAfvullenIngeklapt((v: any)=>!v)}>
                      <span className={`text-xs font-bold ${!afvullenIngeklapt?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                      <span>{t('batch_filling_register')}</span>
                    </div>
                    {!afvullenIngeklapt && <div className="p-3">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_packaging')} <span className="text-red-500">*</span></label>
                          {(verpakkingen||[]).length===0
                            ? <div className="border border-dashed border-orange-300 bg-orange-50 rounded px-2 py-1.5 text-xs text-orange-600">{t('batch_add_packaging_hint')}</div>
                            : <select value={avF.verpakking_id} onChange={e=>{const vp=(verpakkingen||[]).find((v: any)=>v.id===Number(e.target.value));setAvF((f: any)=>({...f,verpakking_id:e.target.value,verpakking_type:vp?.naam||'',inhoud_per_eenheid:vp?.inhoud_liter||''}))}}
                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input bg-white">
                                <option value="">{t('batch_filling_select_ph')}</option>
                                {(verpakkingen||[]).map((vp: any) => (
                                  <option key={vp.id} value={vp.id} disabled={vpVoorraadB(vp)===0}>
                                    {vp.naam} — {vpVoorraadB(vp)} stuks
                                  </option>
                                ))}
                              </select>
                          }
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-0.5">{t('batch_filling_content')}</label>
                          <div className="border border-gray-200 bg-gray-50 rounded px-2 py-1.5 text-sm text-gray-700 min-h-[34px] flex items-center">
                            {avF.inhoud_per_eenheid ? `${avF.inhoud_per_eenheid}L` : <span className="text-gray-400 text-xs">auto</span>}
                          </div>
                        </div>
                        <Inp label={t('batch_filling_units')} type="number" value={avF.hoeveelheid} onChange={(v: string)=>setAvF((f: any)=>({...f,hoeveelheid:v}))} placeholder="1" />
                        <Inp label={t('batch_filling_date')} type="date" value={avF.datum} onChange={(v: string)=>setAvF((f: any)=>({...f,datum:v}))} />
                        <Inp label={t('batch_filling_tht')} type="date" value={avF.tht} onChange={(v: string)=>setAvF((f: any)=>({...f,tht:v}))} />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {avF.inhoud_per_eenheid&&avF.hoeveelheid && <span className="text-sm text-gray-500">{t('lbl_total_colon')} {(Number(avF.inhoud_per_eenheid)*Number(avF.hoeveelheid)).toFixed(1)}L · {avF.hoeveelheid}× {avF.verpakking_type}</span>}
                        <Btn onClick={doAfvullen} cls="ml-auto">{t('batch_filling_register_btn')}</Btn>
                      </div>
                    </div>}
                  </div>

                  {bAv.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-green-800">{t('batch_ready_confirm')}</div>
                        <div className="text-xs text-green-600 mt-0.5">{t('batch_ready_text')}</div>
                      </div>
                      <Btn v="green" onClick={()=>{if(confirm(t('err_confirm_mark_packed').replace('{name}',selB.naam))){setBat((prev: any[])=>prev.map((b: any)=>b.id===sel?{...b,status:'Verpakt'}:b));addLog({type:'status',batch_id:sel,referentie:`${selB.status} → Verpakt`})}}}>
                        {t('batch_ready_button')}
                      </Btn>
                    </div>
                  )}

                  <div className="bg-white rounded-xl shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center gap-2 cursor-pointer select-none" onClick={()=>setVoorraadIngeklapt((v: any)=>!v)}>
                      <span className={`text-xs font-bold ${!voorraadIngeklapt?'rotate-90':''}`} style={{display:'inline-block',transition:'transform 0.15s'}}>▶</span>
                      <span>{t('batch_filled_stock')}</span>
                    </div>
                    {!voorraadIngeklapt && <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                            <th className="px-3 py-2 text-right">{t('lbl_filled')}</th>
                            <th className="px-3 py-2 text-right">{t('filling_summary_released')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-amber-700">{t('lbl_remaining')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                            <th className="px-3 py-2 text-left">{t('lbl_tht')}</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {bAv.length===0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">{t('batch_no_filled')}</td></tr>}
                          {bAv.map((a: any) => {
                            const uitg = uitgeslVanAv(a.id)
                            const rest = Number(a.hoeveelheid||0) - uitg
                            return (
                              <tr key={a.id} className={rest===0?'bg-gray-50 text-gray-400':''}>
                                <td className="px-3 py-2">{a.verpakking_type}</td>
                                <td className="px-3 py-2 text-right">{a.inhoud_per_eenheid}L</td>
                                <td className="px-3 py-2 text-right">{a.hoeveelheid}× ({(a.inhoud_per_eenheid*a.hoeveelheid).toFixed(1)}L)</td>
                                <td className="px-3 py-2 text-right text-blue-600">{uitg>0?`${uitg}×`:'—'}</td>
                                <td className={`px-3 py-2 text-right font-semibold ${rest>0?'text-amber-700':'text-gray-400'}`}>{rest>0?`${rest}×`:t('lbl_empty')}</td>
                                <td className="px-3 py-2 text-gray-500">{fmtD(a.datum)}</td>
                                <td className="px-3 py-2 text-gray-500">{a.tht?fmtD(a.tht):'—'}</td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    {rest>0 && <Btn s="sm" v="blue" onClick={()=>{setUitModal(a);setUitAantal('');setUitDatum(tod())}}>{t('log_release')}</Btn>}
                                    {uitg===0 && <button onClick={()=>delAv(a.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>}
                  </div>
                </div>
              )
            })()}

            {/* Kostprijsoverzicht - bij Verpakt of Gesloten */}
            {(selB.status==='Verpakt'||selB.status==='Gesloten') && av && acc && (() => {
              const batchAv  = av.filter((a: any) => a.batch_id===selB.id)
              const batchAcc = acc.filter((a: any) => a.batch_id===selB.id)
              const brouwOverhead = Number(selB.electra_kosten||0)+Number(selB.water_kosten||0)+Number(selB.schoonmaak_kosten||0)+Number(selB.overige_kosten||0)
              const ingKost = ingKosten(selB)
              const totBrouwkosten = brouwOverhead + ingKost
              const totLiter = batchAv.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
              const totStuks = batchAv.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
              const brouwPerLiter = totLiter > 0 ? totBrouwkosten/totLiter : 0
              const avTypes = [...new Set(batchAv.map((a: any) => a.verpakking_type))].sort()
              const typeData = (avTypes as string[]).map(type => {
                const rows = batchAv.filter((a: any) => a.verpakking_type===type)
                const stuks = rows.reduce((s: number, a: any) => s+Number(a.hoeveelheid||0), 0)
                const liters = rows.reduce((s: number, a: any) => s+Number(a.inhoud_per_eenheid||0)*Number(a.hoeveelheid||0), 0)
                const vpId = rows.find((r: any) => r.verpakking_id)?.verpakking_id
                const vp = verpakkingen ? (vpId ? verpakkingen.find((v: any) => v.id===vpId) : verpakkingen.find((v: any) => v.naam===type)) : null
                const kPerStuk = vp ? Number(vp.kosten_verpakking||0)+Number(vp.kosten_afsluiting||0)+Number(vp.kosten_label||0) : 0
                const totVerpK = kPerStuk * stuks
                const totAcc = batchAcc.filter((a: any) => a.verpakking_type===type).reduce((s: number, a: any) => s+Number(a.accijns??a.totaal_accijns??0), 0)
                const brouwA = brouwPerLiter * liters
                return {type, stuks, liters, kPerStuk, totVerpK, totAcc, brouwA, totaal: brouwA+totVerpK+totAcc, perStuk: stuks>0?(brouwA+totVerpK+totAcc)/stuks:0}
              })
              const somVerpK = typeData.reduce((s: number, td: any) => s+td.totVerpK, 0)
              const somAcc = batchAcc.reduce((s: number, a: any) => s+Number(a.accijns??a.totaal_accijns??0), 0)
              const totaalKostprijs = totBrouwkosten + somVerpK + somAcc
              return (
                <div className="bg-white rounded-xl shadow-card overflow-x-auto">
                  <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm flex items-center justify-between">
                    <span className="text-white">{t('batch_costs_summary')}</span>
                    <span className="text-xs text-gray-400 font-normal">{t('lbl_excl_vat')}</span>
                  </div>
                  <div className="p-4 space-y-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('batch_costs_ingredients')}</p>
                      <div className="space-y-1">
                        <div className="flex justify-between text-gray-600"><span>{t('nav_ingredienten')}</span><span>{fmt(ingKost)}</span></div>
                        {Number(selB.electra_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_electricity')}</span><span>{fmt(selB.electra_kosten)}</span></div>}
                        {Number(selB.water_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_water')}</span><span>{fmt(selB.water_kosten)}</span></div>}
                        {Number(selB.schoonmaak_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_cleaning')}</span><span>{fmt(selB.schoonmaak_kosten)}</span></div>}
                        {Number(selB.overige_kosten)>0 && <div className="flex justify-between text-gray-600"><span>{t('batch_costs_other')}</span><span>{fmt(selB.overige_kosten)}</span></div>}
                        <div className="flex justify-between font-medium border-t pt-1"><span>{t('batch_costs_subtotal')}</span><span>{fmt(totBrouwkosten)}</span></div>
                      </div>
                    </div>
                    {typeData.map((td: any) => (
                      <div key={td.type}>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{td.type} — {td.stuks}× · {td.liters.toFixed(1)}L</p>
                        <div className="bg-gray-50 rounded p-3 space-y-1">
                          <div className="flex justify-between text-gray-600"><span>{t('batch_brewing_cost_share')} ({td.liters.toFixed(1)}L @ {fmt(brouwPerLiter)}/L)</span><span>{fmt(td.brouwA)}</span></div>
                          <div className="flex justify-between text-gray-600"><span>{t('lbl_packaging')} ({td.stuks}× @ {fmt(td.kPerStuk)})</span><span>{td.kPerStuk>0?fmt(td.totVerpK):<span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
                          <div className="flex justify-between text-gray-600"><span>{t('nav_accijns')}</span><span>{fmt(td.totAcc)}</span></div>
                          <div className="flex justify-between font-semibold border-t pt-1"><span>{t('batch_costs_subtotal_short')}</span><span className="text-amber-700">{fmt(td.totaal)}</span></div>
                          <div className="flex justify-between text-xs text-gray-500 pt-0.5"><span>{t('batch_cost_per_unit')}</span><span className="font-semibold text-green-700">{fmt(td.perStuk)}</span></div>
                        </div>
                      </div>
                    ))}
                    <div className="border-t-2 border-gray-200 pt-3 space-y-1">
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_subtotal')}</span><span>{fmt(totBrouwkosten)}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_packaging')}</span><span>{somVerpK>0?fmt(somVerpK):<span className="text-gray-400">{t('lbl_not_specified')}</span>}</span></div>
                      <div className="flex justify-between text-gray-600"><span>{t('batch_costs_total_excise')}</span><span>{fmt(somAcc)}</span></div>
                      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1"><span>{t('batch_costs_total')}</span><span className="text-amber-700">{fmt(totaalKostprijs)}</span></div>
                      <div className="flex gap-6 text-xs text-gray-500 pt-1">
                        {totLiter>0 && <span>{t('batch_costs_per_liter')}: <strong className="text-gray-700">{fmt(totaalKostprijs/totLiter)}</strong></span>}
                        {totStuks>0 && <span>{t('batch_costs_avg_per_unit')}: <strong className="text-gray-700">{fmt(totaalKostprijs/totStuks)}</strong></span>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Logboek */}
            {(() => {
              const TYPE: Record<string,any> = {
                gebruik:     {icon:'📦', label:t('batch_log_ingredient'),    cls:'text-blue-700 bg-blue-50'},
                terugboeking:{icon:'↩',  label:t('batch_log_type_return'),   cls:'text-orange-700 bg-orange-50'},
                afvullen:    {icon:'🍺', label:t('batch_log_type_filling'),  cls:'text-green-700 bg-green-50'},
                uitslaan:    {icon:'🚛', label:t('batch_log_type_release'),  cls:'text-purple-700 bg-purple-50'},
                status:      {icon:'🔄', label:'Status',                      cls:'text-gray-700 bg-gray-100'},
                aangemaakt:  {icon:'✨', label:t('batch_log_type_created'),  cls:'text-indigo-700 bg-indigo-50'},
                gewijzigd:   {icon:'✏️', label:t('batch_log_type_changed'),  cls:'text-amber-700 bg-amber-50'},
                hygiene:     {icon:'🧹', label:t('batch_log_type_hygiene'),  cls:'text-teal-700 bg-teal-50'},
              }
              const bLog = (log||[]).filter((l: any) => l.batch_id===selB.id).slice().reverse()
              if (!bLog.length) return null
              return (
                <div className="bg-white rounded-xl shadow-card overflow-x-auto">
                  <div className="px-4 py-2.5 t-hdr text-white font-medium text-sm">{t('batch_log')}</div>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 bg-gray-50">
                      <tr>
                        <th className="px-3 py-1.5 text-left">{t('lbl_date')}</th>
                        <th className="px-3 py-1.5 text-left">{t('lbl_type')}</th>
                        <th className="px-3 py-1.5 text-left">{t('batch_log_description')}</th>
                        <th className="px-3 py-1.5 text-right">{t('lbl_quantity')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bLog.map((l: any) => {
                        const typeInfo = TYPE[l.type] || {icon:'•', label:l.type||'—', cls:'text-gray-600 bg-gray-100'}
                        const omschr = l.ingredient_naam
                          ? l.ingredient_naam + (l.lotnummer ? ` · lot: ${l.lotnummer}` : '')
                          : l.verpakking_type || l.referentie || '—'
                        const qty = l.hoeveelheid!=null
                          ? `${l.hoeveelheid} ${l.eenheid||''}${l.referentie&&l.type!=='gebruik'?` (${l.referentie})`:''}`.trim()
                          : '—'
                        return (
                          <tr key={l.id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{l.datum||'—'}</td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${typeInfo.cls}`}>
                                {typeInfo.icon} {typeInfo.label}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-xs">{omschr}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-700">{qty}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </>)}
      </div>

      {/* AGP Modal */}
      {agpModal && (
        <Modal title="Accijns Goederen Plaats" onClose={()=>setAgpModal(null)} hideClose>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm leading-relaxed">
              Verplaats deze <strong>{agpModal.label}</strong> voorraad uit de Accijns Goederen Plaats.
            </div>
            <div className="flex justify-end">
              <Btn v="green" onClick={()=>setAgpModal(null)}>✓ Gedaan</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Uitslaan Modal */}
      {uitModal && (
        <Modal title={`Uitslaan: ${uitModal.verpakking_type}`} onClose={()=>setUitModal(null)}>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded text-sm text-blue-800">
              <div className="font-medium">{selB?.naam}{selB?.batch_nummer ? ` — #${selB.batch_nummer}` : ''}</div>
              <div>{uitModal.verpakking_type} · {uitModal.inhoud_per_eenheid}L per stuk</div>
              {uitModal.tht && <div className="text-xs mt-0.5">THT: {fmtD(uitModal.tht)}</div>}
              <div className="mt-1">{t('lbl_available')}: <strong>{resterendAv(uitModal)} stuks</strong></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={`${t('batch_release_count')} *`} type="number" value={uitAantal} onChange={setUitAantal} placeholder={`max ${resterendAv(uitModal)}`} />
              <Inp label={t('lbl_date')} type="date" value={uitDatum} onChange={setUitDatum} />
            </div>
            {uitAantal && Number(uitAantal) > 0 && (() => {
              const liter = Number(uitAantal)*Number(uitModal.inhoud_per_eenheid||0)
              const r1 = Number(accijnsInst?.tarief_per_hl_abv||7.51)
              const r2 = Number(accijnsInst?.tarief_per_hl||24.17)
              const ac = accijnsCalc(liter, selB?.ABV||0, r1, r2, accijnsInst)
              return <div className="p-2 bg-amber-50 rounded text-xs text-amber-800">{liter.toFixed(1)}L → accijns: <strong>{fmt(ac)}</strong></div>
            })()}
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={()=>setUitModal(null)}>{t('btn_cancel')}</Btn>
              <Btn v="blue" onClick={doUitslaan} disabled={!uitAantal||Number(uitAantal)<=0}>{t('log_release')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Batch form modal */}
      {showForm && (
        <Modal title={editId?t('batch_edit_title'):t('batch_new_title')} onClose={()=>setShowForm(false)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_batch_number')} value={bForm.batch_nummer} onChange={(v: string)=>setBForm((f: any)=>({...f,batch_nummer:v}))} placeholder="B-2025-001" />
              <Inp label={t('lbl_name')+' *'} value={bForm.naam} onChange={(v: string)=>setBForm((f: any)=>({...f,naam:v}))} placeholder={t('ph_beer_name')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_style')} value={bForm.stijl} onChange={(v: string)=>setBForm((f: any)=>({...f,stijl:v}))} placeholder={t('ph_beer_style')} />
              <Sel label={t('lbl_status')} value={bForm.status} onChange={(v: string)=>setBForm((f: any)=>({...f,status:v}))} opts={STATUSSEN.map(s=>({v:s,l:STATUS_LABELS[s]||s}))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tanks && tanks.length > 0
                ? <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Tank</label>
                    <select value={bForm.tank||''} onChange={e=>setBForm((f: any)=>({...f,tank:e.target.value}))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                      <option value="">{t('batch_no_tank')}</option>
                      {tanks.map((tk: any) => {
                        const bezet = bat.find((b: any) => b.tank===tk.id && b.id!==editId && ['Vergisten','Conditioneren'].includes(b.status))
                        return <option key={tk.id} value={tk.id} disabled={!!bezet}>
                          {tk.id}{bezet ? ` — bezet (${bezet.naam})` : ''}
                        </option>
                      })}
                    </select>
                  </div>
                : <Inp label={t('lbl_tank')} value={bForm.tank} onChange={(v: string)=>setBForm((f: any)=>({...f,tank:v}))} placeholder="FV1" />
              }
              <Inp label={t('lbl_date')} type="date" value={bForm.datum} onChange={(v: string)=>setBForm((f: any)=>({...f,datum:v}))} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Inp label={t('lbl_liters_fermented')} type="number" value={bForm.liter_vergist} onChange={(v: string)=>setBForm((f: any)=>({...f,liter_vergist:v}))} placeholder="0" />
              <Inp label={t('lbl_og')} type="number" value={bForm.OG} onChange={(v: string)=>setBForm((f: any)=>({...f,OG:v}))} placeholder="1.050" />
              <Inp label={t('lbl_fg')} type="number" value={bForm.FG} onChange={(v: string)=>setBForm((f: any)=>({...f,FG:v}))} placeholder="1.010" />
              <Inp label={t('lbl_abv')} type="number" value={bForm.ABV} onChange={(v: string)=>setBForm((f: any)=>({...f,ABV:v}))} placeholder="5.0" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('batch_info_brew_efficiency')} type="number" value={bForm.brouwzaal_eff||''} onChange={(v: string)=>setBForm((f: any)=>({...f,brouwzaal_eff:v}))} placeholder="75" />
              <Inp label={t('batch_info_mash_efficiency')} type="number" value={bForm.maisch_eff||''} onChange={(v: string)=>setBForm((f: any)=>({...f,maisch_eff:v}))} placeholder="80" />
              <Inp label={t('batch_info_mash_ph')} type="number" value={bForm.maisch_ph||''} onChange={(v: string)=>setBForm((f: any)=>({...f,maisch_ph:v}))} placeholder="5.4" />
              <Inp label={t('batch_info_product_ph')} type="number" value={bForm.product_ph||''} onChange={(v: string)=>setBForm((f: any)=>({...f,product_ph:v}))} placeholder="4.3" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Inp label={t('batch_costs_electricity')+' (€)'} type="number" value={bForm.electra_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,electra_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_water')+' (€)'} type="number" value={bForm.water_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,water_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_cleaning')+' (€)'} type="number" value={bForm.schoonmaak_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,schoonmaak_kosten:v}))} placeholder="0" />
              <Inp label={t('batch_costs_other')+' (€)'} type="number" value={bForm.overige_kosten} onChange={(v: string)=>setBForm((f: any)=>({...f,overige_kosten:v}))} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Notities</label>
              <textarea value={safeStr(bForm.notities)} onChange={e=>setBForm((f: any)=>({...f,notities:e.target.value}))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" rows={2} placeholder={t('lbl_notes')+'...'} />
            </div>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={()=>setShowForm(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveBatch}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Brewfather import modal */}
      {showBf && (
        <Modal title={t('batch_brewfather_import_title')} onClose={()=>{setShowBf(false);setBfJson('');setBfFileName('')}} wide>
          <div className="space-y-4">
            <p className="text-xs text-gray-500">{t('batch_brewfather_instruction')}</p>
            <div onClick={()=>bfFileRef.current?.click()}
              className="border-2 border-dashed t-border rounded-lg p-6 text-center cursor-pointer t-hover transition-colors">
              <div className="text-3xl mb-2">📂</div>
              <div className="text-sm font-medium text-gray-700">{t('batch_brewfather_choose_file')}</div>
              <div className="text-xs text-gray-400 mt-1">{t('batch_brewfather_file_type')}</div>
              {bfFileName && <div className="mt-2 text-xs text-green-700 font-medium">✓ {bfFileName}</div>}
            </div>
            <input ref={bfFileRef} type="file" accept=".json,application/json" className="hidden" onChange={loadBfFile} />
            <details>
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">{t('batch_brewfather_paste_json')}</summary>
              <div className="mt-2 space-y-2">
                <textarea value={bfJson} onChange={e=>setBfJson(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono h-32 t-input"
                  placeholder='{"name":"Mijn Batch","recipe":{"fermentables":[...],"hops":[...]}}' />
                <div className="flex justify-end">
                  <Btn onClick={importBf} disabled={!bfJson.trim()}>{t('btn_import_json')}</Btn>
                </div>
              </div>
            </details>
            <div className="flex justify-end">
              <Btn v="secondary" onClick={()=>{setShowBf(false);setBfJson('');setBfFileName('')}}>{t('btn_close')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default BatchesPage
