import React, { useState, useRef } from 'react'
import { t } from '../i18n'
import { newId, bfGetIngredients, BF_FERM_TYPE_MAP, bfPushInventory, extractBfProps } from '../utils/api'
import { fmt, fmtD, tod } from '../utils/format'
import { convertEenheid, compatibeleEenheden, BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN, EENHEDEN, ONDERDEEL_TYPES, VERPAKKING_DEFAULTS } from '../utils/constants'
import Modal from '../components/ui/Modal'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import InkoopFactuurModal from '../components/InkoopFactuurModal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import { useStore } from '../utils/api'
import { logAudit } from '../utils/audit'

interface Props {
  ing: any[]
  setIng: (v: any) => void
  lots: any[]
  setLots: (v: any) => void
  verpakkingen: any[]
  setVerpakkingen: (v: any) => void
  onderdelen?: any[]
  setOnderdelen: (v: any) => void
  log: any[]
  setLog: (v: any) => void
  bi?: any[]
  bat?: any[]
  setInkoopFacturen?: (v: any) => void
  claudeCreds?: any
  ingTypes?: string[]
  ingTypeBtw?: Record<string, any>
  kostenSoorten?: string[]
  bfCreds?: any
}

const IngredientenPage: React.FC<Props> = ({
  ing, setIng, lots, setLots, verpakkingen, setVerpakkingen,
  onderdelen = [], setOnderdelen, log, setLog,
  bi = [], bat = [], setInkoopFacturen = () => {}, claudeCreds = null,
  ingTypes = BUILTIN_ING_TYPES, ingTypeBtw = {}, kostenSoorten = BUILTIN_KOSTEN_SOORTEN,
  bfCreds = null, auditLog = [], setAuditLog = () => {}
}) => {
  const [tab, setTab] = useState('ingredienten')
  const [sel, setSel] = useState<number | null>(null)
  const [showO, setShowO] = useState(false)
  const [ontvangstInitTab, setOntvangstInitTab] = useState('ingredienten')
  const [ontvangstInitIngId, setOntvangstInitIngId] = useState('')
  const [showA, setShowA] = useState<any>(null)
  const knownLeveranciers = React.useMemo(() => [...new Set(lots.map((l: any) => l.leverancier).filter(Boolean))].sort(), [lots])
  const [afQty, setAfQty] = useState('')
  const [afEenheid, setAfEenheid] = useState('')
  const [showLot, setShowLot] = useState<any>(null)
  const [archiefOpen, setArchiefOpen] = useStore('ing_archief_open', {})
  const [lotEdit, setLotEdit] = useState<any>({})
  const [lotCorr, setLotCorr] = useState({ delta: '', richting: '+', reden: '', eenheid: '' })
  const [ingZoek, setIngZoek] = useState('')
  const [alleenOpVoorraad, setAlleenOpVoorraad] = useStore('ing_alleen_voorraad', false)
  const [groepDicht, setGroepDicht] = useStore('ing_groep_dicht', {})
  const [showIngEdit, setShowIngEdit] = useState(false)
  const [ingEditForm, setIngEditForm] = useState({ naam: '', type: '', fabrikant: '' })
  const [vtIngeklapt, setVtIngeklapt] = useStore('verpakkingen_vt_ingeklapt', false)
  const [odIngeklapt, setOdIngeklapt] = useStore('verpakkingen_od_ingeklapt', false)
  const [showVOntv, setShowVOntv] = useState(false)
  const emptyVO = { od_id: '', verpakking_id: '', naam: '', inhoud_liter: '', type: '', lotnr: '', aantal: '', preset: '', kosten_verpakking: '', kosten_afsluiting: '', kosten_label: '', leverancier: '', factuurnummer: '', prijs_per_stuk: '', totaalprijs: '', btw_tarief: '21' }
  const [vOntvForm, setVOntvForm] = useState(emptyVO)
  const [showVAfboek, setShowVAfboek] = useState<any>(null)
  const [vAfQty, setVAfQty] = useState('')
  const [showVEdit, setShowVEdit] = useState<any>(null)
  const emptyVE = { naam: '', inhoud_liter: '', type: '', kosten_verpakking: '', kosten_afsluiting: '', kosten_label: '', leverancier: '', factuurnummer: '' }
  const [vEditForm, setVEditForm] = useState(emptyVE)
  const emptyOD = { od_id: '', naam: '', type: '', lotnr: '', kosten_per_stuk: '', leverancier: '', factuurnummer: '', voorraad: '' }
  const [showODEdit, setShowODEdit] = useState<any>(null)
  const [odEditForm, setOdEditForm] = useState(emptyOD)
  const [showODAdd, setShowODAdd] = useState(false)
  const [odAddForm, setOdAddForm] = useState(emptyOD)
  const [odQty, setOdQty] = useState('')
  const [odPrijs, setOdPrijs] = useState('')
  const [odTotaalprijs, setOdTotaalprijs] = useState('')
  const emptyVT = { naam: '', inhoud_liter: '', type: '', onderdelen: [] as any[], statiegeld_bedrag: '', statiegeld_soort: '' }
  const [showVTAdd, setShowVTAdd] = useState(false)
  const [vtForm, setVtForm] = useState(emptyVT)
  const [vtOnderdeel, setVtOnderdeel] = useState({ onderdeel_id: '', aantal: '1' })

  const [bfSyncing, setBfSyncing] = useState(false)
  const [bfMsg, setBfMsg] = useState('')
  const [bfPushing, setBfPushing] = useState(false)

  const addLog = (entry: any) => setLog((prev: any[]) => [...prev, { id: newId(prev || []), datum: tod(), ...entry }])

  const activeLots = (iid: number) => lots.filter((l: any) => l.ingredient_id === iid && l.beschikbaar && Number(l.hoeveelheid || 0) > 0)
  const archiefLots = (iid: number) => lots.filter((l: any) => l.ingredient_id === iid && (!l.beschikbaar || Number(l.hoeveelheid || 0) === 0))
  const totalQty = (iid: number) => activeLots(iid).reduce((s: number, l: any) => s + Number(l.hoeveelheid || 0), 0)

  const runBfIngSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setBfMsg('⚠ ' + t('settings_brewfather_section')); return
    }
    setBfSyncing(true); setBfMsg('')
    try {
      const { fermentables, hops, yeasts, miscs } = await bfGetIngredients()
      let updated = [...ing]
      let nieuw = 0, gekoppeld = 0
      const processItem = (bfItem: any, appType: string, cat: string) => {
        const naam = (bfItem.name || '').trim()
        if (!naam) return
        const fabrikant = typeof bfItem.supplier === 'object' ? (bfItem.supplier?.name || '') : (bfItem.supplier || '')
        const bfProps = extractBfProps(bfItem)
        let existing = updated.find((i: any) => i.brewfather_id === bfItem._id)
        if (!existing) existing = updated.find((i: any) => i.naam.toLowerCase() === naam.toLowerCase())
        if (existing) {
          const upd: any = { bf_props: bfProps }
          if (!existing.brewfather_id) upd.brewfather_id = bfItem._id
          if (!existing.brewfather_cat) upd.brewfather_cat = cat
          if (!existing.fabrikant && fabrikant) upd.fabrikant = fabrikant
          updated = updated.map((i: any) => i.id === existing.id ? { ...i, ...upd } : i)
          gekoppeld++
        } else {
          updated.push({ id: newId(updated), naam, type: appType, fabrikant: fabrikant || undefined, beschikbaar: true, brewfather_id: bfItem._id, brewfather_cat: cat, bf_props: bfProps })
          nieuw++
        }
      }
      fermentables.forEach((f: any) => processItem(f, BF_FERM_TYPE_MAP[f.type] || 'Mout', 'fermentables'))
      hops.forEach((h: any) => processItem(h, 'Hop', 'hops'))
      yeasts.forEach((y: any) => processItem(y, 'Gist', 'yeasts'))
      miscs.forEach((m: any) => processItem(m, 'Overig', 'miscs'))
      setIng(updated)
      logAudit(auditLog, setAuditLog, { entiteit: 'Ingrediënt', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Brewfather ingrediënt sync: ${nieuw} nieuw, ${gekoppeld} gekoppeld` })
      setBfMsg(t('msg_bf_ing_sync_success').replace('{n}', String(nieuw)).replace('{m}', String(gekoppeld)))
    } catch (e: any) { setBfMsg(t('msg_bf_sync_failed').replace('{msg}', e.message || String(e))) }
    setBfSyncing(false)
  }

  const pushBfStock = async (ingredient: any) => {
    if (!ingredient.brewfather_id || !ingredient.brewfather_cat) return
    setBfPushing(true); setBfMsg('')
    try {
      const amount = totalQty(ingredient.id)
      const ok = await bfPushInventory(ingredient.brewfather_cat, ingredient.brewfather_id, amount)
      setBfMsg(ok ? t('msg_bf_push_success') : t('msg_bf_push_failed').replace('{msg}', 'HTTP error'))
    } catch (e: any) { setBfMsg(t('msg_bf_push_failed').replace('{msg}', e.message || String(e))) }
    setBfPushing(false)
  }

  const lotBatches = (lotId: number) => {
    const usages = bi.filter((x: any) => x.lot_id === lotId && x.afgeboekt)
    return usages.map((x: any) => ({ ...x, batch: bat.find((b: any) => b.id === x.batch_id) }))
  }

  const openLot = (lot: any) => {
    setShowLot(lot)
    setLotEdit({
      lotnummer: lot.lotnummer || '',
      leverancier: lot.leverancier || '',
      factuur_nummer: lot.factuur_nummer || '',
      aankoop_datum: lot.aankoop_datum || '',
      eenheid: lot.eenheid || '',
      hoeveelheid: String(lot.hoeveelheid || ''),
      houdbaarheid: lot.houdbaarheid || '',
      prijs_per_eenheid: lot.prijs_per_eenheid != null ? String(lot.prijs_per_eenheid) : '',
      gn_code: lot.gn_code || '',
    })
    setLotCorr({ delta: '', richting: '+', reden: '', eenheid: lot.eenheid || '' })
  }

  const saveLot = () => {
    setLots((prev: any[]) => prev.map((l: any) => l.id !== showLot.id ? l : {
      ...l,
      lotnummer: lotEdit.lotnummer,
      leverancier: lotEdit.leverancier,
      factuur_nummer: lotEdit.factuur_nummer,
      aankoop_datum: lotEdit.aankoop_datum,
      eenheid: lotEdit.eenheid,
      hoeveelheid: Number(lotEdit.hoeveelheid) || 0,
      houdbaarheid: lotEdit.houdbaarheid || null,
      prijs_per_eenheid: lotEdit.prijs_per_eenheid !== '' ? Number(lotEdit.prijs_per_eenheid) : null,
      gn_code: lotEdit.gn_code || undefined,
      beschikbaar: (Number(lotEdit.hoeveelheid) || 0) > 0,
    }))
    logAudit(auditLog, setAuditLog, { entiteit: 'Lot', entiteit_id: showLot.id, actie: 'gewijzigd', omschrijving: showLot.lotnummer || `Lot #${showLot.id}` })
    setShowLot(null)
  }

  const doCorrectie = (lot: any) => {
    const delta = Number(lotCorr.delta)
    if (!delta || delta <= 0) { alert(t('err_valid_qty')); return }
    const corrEenh = lotCorr.eenheid || lot.eenheid
    const deltaInLot = convertEenheid(delta, corrEenh, lot.eenheid)
    if (deltaInLot === null) { alert(t('err_convert_units').replace('{from}', corrEenh).replace('{to}', lot.eenheid)); return }
    if (lotCorr.richting === '-' && deltaInLot > Number(lot.hoeveelheid)) { alert(t('agp_voorraad_ontoereikend').replace('{beschikbaar}', `${lot.hoeveelheid} ${lot.eenheid}`)); return }
    const nieuweQty = lotCorr.richting === '+' ? Number(lot.hoeveelheid) + deltaInLot : Number(lot.hoeveelheid) - deltaInLot
    setLots((prev: any[]) => prev.map((l: any) => l.id !== lot.id ? l : { ...l, hoeveelheid: nieuweQty, beschikbaar: nieuweQty > 0 }))
    logAudit(auditLog, setAuditLog, { entiteit: 'Lot', entiteit_id: lot.id, actie: 'gewijzigd', omschrijving: `Correctie ${lotCorr.richting}${delta} ${corrEenh}` })
    addLog({ ingredient_id: lot.ingredient_id, ingredient_naam: ing.find((i: any) => i.id === lot.ingredient_id)?.naam || '', lot_id: lot.id, lotnummer: lot.lotnummer || '', type: 'correctie', hoeveelheid: lotCorr.richting === '-' ? -delta : delta, eenheid: corrEenh, referentie: lotCorr.reden || 'Handmatige correctie' })
    setLotCorr({ delta: '', richting: '+', reden: '', eenheid: lot.eenheid })
    setShowLot((prev: any) => ({ ...prev, hoeveelheid: nieuweQty, beschikbaar: nieuweQty > 0 }))
    setLotEdit((prev: any) => ({ ...prev, hoeveelheid: String(nieuweQty) }))
  }

  const doAfboeken = (lot: any) => {
    const q = Number(afQty)
    if (!q || q <= 0) { alert(t('err_valid_qty')); return }
    const van = afEenheid || lot.eenheid
    const qInLot = convertEenheid(q, van, lot.eenheid)
    if (qInLot === null) { alert(t('err_convert_units').replace('{from}', van).replace('{to}', lot.eenheid)); return }
    if (qInLot > Number(lot.hoeveelheid)) { alert(t('agp_voorraad_ontoereikend').replace('{beschikbaar}', `${lot.hoeveelheid} ${lot.eenheid}`)); return }
    setLots((prev: any[]) => prev.map((l: any) => l.id !== lot.id ? l : { ...l, hoeveelheid: Number(l.hoeveelheid) - qInLot, beschikbaar: Number(l.hoeveelheid) - qInLot > 0 }))
    logAudit(auditLog, setAuditLog, { entiteit: 'Lot', entiteit_id: lot.id, actie: 'gewijzigd', omschrijving: `Afgeboekt ${q} ${van}` })
    addLog({ ingredient_id: lot.ingredient_id, ingredient_naam: ing.find((i: any) => i.id === lot.ingredient_id)?.naam || '', lot_id: lot.id, lotnummer: lot.lotnummer || '', type: 'afboeking', hoeveelheid: q, eenheid: van, referentie: 'Handmatig afgeboekt' })
    setShowA(null); setAfQty(''); setAfEenheid('')
  }

  const vpVoorraad = (vp: any) => {
    if (!Array.isArray(vp.onderdelen) || !vp.onderdelen.length) return Number(vp.voorraad || 0)
    const stocks = vp.onderdelen.map((o: any) => {
      const od = onderdelen.find((d: any) => d.id === o.onderdeel_id)
      return Math.floor(Number(od?.voorraad || 0) / Number(o.aantal || 1))
    })
    return stocks.length ? Math.min(...stocks) : 0
  }
  const vpKosten = (vp: any) => {
    if (!Array.isArray(vp.onderdelen) || !vp.onderdelen.length) return Number(vp.kosten_verpakking || 0) + Number(vp.kosten_afsluiting || 0) + Number(vp.kosten_label || 0)
    return vp.onderdelen.reduce((s: number, o: any) => {
      const od = onderdelen.find((d: any) => d.id === o.onderdeel_id)
      return s + Number(od?.kosten_per_stuk || 0) * Number(o.aantal || 1)
    }, 0)
  }

  const onPreset = (preset: string) => {
    if (!preset) { setVOntvForm((f: any) => ({ ...f, preset: '', naam: '', inhoud_liter: '', type: '' })); return }
    const p = VERPAKKING_DEFAULTS.find((d: any) => d.naam === preset)
    setVOntvForm((f: any) => ({ ...f, preset, naam: p?.naam || preset, inhoud_liter: String(p?.inhoud_liter || ''), type: p?.type || '', verpakking_id: '' }))
  }

  const saveVOntvangst = () => {
    const n = Number(vOntvForm.aantal)
    if (!n || n <= 0) { alert(t('err_count_required')); return }
    if (vOntvForm.verpakking_id) {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id === Number(vOntvForm.verpakking_id) ? { ...v, voorraad: Number(v.voorraad || 0) + n, leverancier: vOntvForm.leverancier || v.leverancier || '', factuurnummer: vOntvForm.factuurnummer || v.factuurnummer || '' } : v))
      logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: Number(vOntvForm.verpakking_id), actie: 'gewijzigd', omschrijving: `Ontvangst +${n}` })
    } else {
      if (!vOntvForm.naam.trim()) { alert(t('err_name_required')); return }
      setVerpakkingen((prev: any[]) => {
        const id = newId(prev)
        logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: id, actie: 'aangemaakt', omschrijving: vOntvForm.naam.trim() })
        return [...prev, { id, naam: vOntvForm.naam.trim(), inhoud_liter: Number(vOntvForm.inhoud_liter || 0), type: vOntvForm.type || '', voorraad: n, kosten_verpakking: vOntvForm.kosten_verpakking ? Number(vOntvForm.kosten_verpakking) : 0, kosten_afsluiting: vOntvForm.kosten_afsluiting ? Number(vOntvForm.kosten_afsluiting) : 0, kosten_label: vOntvForm.kosten_label ? Number(vOntvForm.kosten_label) : 0, leverancier: vOntvForm.leverancier || '', factuurnummer: vOntvForm.factuurnummer || '' }]
      })
    }
    setShowVOntv(false); setVOntvForm(emptyVO)
  }

  const openVEdit = (v: any) => {
    setVEditForm({ naam: v.naam, inhoud_liter: String(v.inhoud_liter || ''), type: v.type || '', kosten_verpakking: String(v.kosten_verpakking || ''), kosten_afsluiting: String(v.kosten_afsluiting || ''), kosten_label: String(v.kosten_label || ''), leverancier: v.leverancier || '', factuurnummer: v.factuurnummer || '' })
    setShowVEdit(v)
  }

  const saveVEdit = () => {
    if (!vEditForm.naam.trim()) { alert(t('err_name_required')); return }
    setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id === showVEdit.id ? { ...v, naam: vEditForm.naam.trim(), inhoud_liter: Number(vEditForm.inhoud_liter || 0), type: vEditForm.type || v.type || '', kosten_verpakking: Number(vEditForm.kosten_verpakking || 0), kosten_afsluiting: Number(vEditForm.kosten_afsluiting || 0), kosten_label: Number(vEditForm.kosten_label || 0), leverancier: vEditForm.leverancier || '', factuurnummer: vEditForm.factuurnummer || '' } : v))
    logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: showVEdit.id, actie: 'gewijzigd', omschrijving: vEditForm.naam.trim() })
    setShowVEdit(null)
  }

  const doVAfboeken = () => {
    const q = Number(vAfQty)
    if (!q || q <= 0) { alert(t('err_valid_count')); return }
    setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id === showVAfboek.id ? { ...v, voorraad: Math.max(0, Number(v.voorraad || 0) - q) } : v))
    logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: showVAfboek.id, actie: 'gewijzigd', omschrijving: `Afgeboekt ${q} ${showVAfboek.naam}` })
    setShowVAfboek(null); setVAfQty('')
  }

  const saveODEdit = () => {
    if (!odEditForm.naam.trim()) { alert(t('err_name_required')); return }
    setOnderdelen((prev: any[]) => prev.map((o: any) => o.id === showODEdit.id ? { ...o, ...odEditForm, kosten_per_stuk: odEditForm.kosten_per_stuk ? Number(odEditForm.kosten_per_stuk) : 0, voorraad: odEditForm.voorraad !== '' ? Number(odEditForm.voorraad) : Number(o.voorraad || 0) } : o))
    logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: showODEdit.id, actie: 'gewijzigd', omschrijving: odEditForm.naam.trim() })
    setShowODEdit(null)
  }

  const saveODAdd = () => {
    if (!odAddForm.od_id && !odAddForm.naam.trim()) { alert(t('err_name_required')); return }
    if (!odQty || Number(odQty) <= 0) { alert(t('err_qty_required')); return }
    if (odAddForm.od_id) {
      setOnderdelen((prev: any[]) => prev.map((o: any) => o.id === Number(odAddForm.od_id) ? { ...o, voorraad: Number(o.voorraad || 0) + Number(odQty), lotnr: odAddForm.lotnr || o.lotnr || '', ...(odPrijs ? { kosten_per_stuk: Number(odPrijs) } : {}) } : o))
      logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: Number(odAddForm.od_id), actie: 'gewijzigd', omschrijving: `Ontvangst +${odQty}` })
    } else {
      setOnderdelen((prev: any[]) => {
        const id = newId(prev)
        logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: id, actie: 'aangemaakt', omschrijving: odAddForm.naam.trim() })
        return [...prev, { id, naam: odAddForm.naam.trim(), type: odAddForm.type || 'overig', lotnr: odAddForm.lotnr || '', kosten_per_stuk: odPrijs ? Number(odPrijs) : 0, leverancier: odAddForm.leverancier || '', factuurnummer: odAddForm.factuurnummer || '', voorraad: Number(odQty) }]
      })
    }
    setOdAddForm(emptyOD); setOdQty(''); setOdPrijs(''); setOdTotaalprijs(''); setShowODAdd(false)
  }

  const saveVTAdd = () => {
    if (!vtForm.naam.trim()) { alert(t('err_name_required')); return }
    const stBedrag = Number(vtForm.statiegeld_bedrag || 0)
    const stSoort: 'snd' | 'fust' | null = vtForm.statiegeld_soort === 'snd' || vtForm.statiegeld_soort === 'fust' ? vtForm.statiegeld_soort : null
    if (showVEdit) {
      setVerpakkingen((prev: any[]) => prev.map((v: any) => v.id === showVEdit.id ? { ...v, naam: vtForm.naam.trim(), inhoud_liter: Number(vtForm.inhoud_liter || 0), type: vtForm.type || '', onderdelen: vtForm.onderdelen, statiegeld_bedrag: stBedrag, statiegeld_soort: stSoort } : v))
      logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: showVEdit.id, actie: 'gewijzigd', omschrijving: vtForm.naam.trim() })
    } else {
      setVerpakkingen((prev: any[]) => {
        const id = newId(prev)
        logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: id, actie: 'aangemaakt', omschrijving: vtForm.naam.trim() })
        return [...prev, { id, naam: vtForm.naam.trim(), inhoud_liter: Number(vtForm.inhoud_liter || 0), type: vtForm.type || '', onderdelen: vtForm.onderdelen, voorraad: 0, statiegeld_bedrag: stBedrag, statiegeld_soort: stSoort }]
      })
    }
    setVtForm(emptyVT); setVtOnderdeel({ onderdeel_id: '', aantal: '1' }); setShowVTAdd(false); setShowVEdit(null)
  }

  const openVTEdit = (v: any) => {
    setVtForm({ naam: v.naam, inhoud_liter: String(v.inhoud_liter || ''), type: v.type || '', onderdelen: Array.isArray(v.onderdelen) ? v.onderdelen : [], statiegeld_bedrag: v.statiegeld_bedrag != null ? String(v.statiegeld_bedrag) : '', statiegeld_soort: v.statiegeld_soort || '' })
    setShowVEdit(v); setShowVTAdd(true)
  }

  const selIng = ing.find((i: any) => i.id === sel)

  const openIngEdit = () => {
    if (!selIng) return
    setIngEditForm({ naam: selIng.naam, type: selIng.type || '', fabrikant: selIng.fabrikant || '' })
    setShowIngEdit(true)
  }
  const saveIngEdit = () => {
    if (!ingEditForm.naam.trim()) { alert(t('err_name_required')); return }
    const dup = ing.find((i: any) => i.id !== sel && i.naam.toLowerCase().trim() === ingEditForm.naam.trim().toLowerCase())
    if (dup) { alert(t('agp_duplicaat_ingrediënt')); return }
    setIng((prev: any[]) => prev.map((i: any) => i.id === sel ? { ...i, naam: ingEditForm.naam.trim(), type: ingEditForm.type, fabrikant: ingEditForm.fabrikant } : i))
    logAudit(auditLog, setAuditLog, { entiteit: 'Ingrediënt', entiteit_id: sel!, actie: 'gewijzigd', omschrijving: ingEditForm.naam.trim() })
    setShowIngEdit(false)
  }
  const deleteIng = () => {
    if (!selIng) return
    if (activeLots(sel!).length > 0) { alert('Kan niet verwijderen: er zijn nog actieve lots.'); return }
    if (!confirm(t('confirm_delete_ingredient').replace('{naam}', selIng.naam))) return
    logAudit(auditLog, setAuditLog, { entiteit: 'Ingrediënt', entiteit_id: sel!, actie: 'verwijderd', omschrijving: selIng.naam })
    setIng((prev: any[]) => prev.filter((i: any) => i.id !== sel))
    setLots((prev: any[]) => prev.filter((l: any) => l.ingredient_id !== sel))
    setSel(null)
  }

  const saveOntvangst = async ({ factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual }: any) => {
    let updatedIng = [...ing]
    const newLots: any[] = []
    productLijst.forEach((p: any) => {
      let iid: number
      if (p.ing_id) { iid = Number(p.ing_id) }
      else {
        const existing = updatedIng.find((i: any) => i.naam.toLowerCase() === p.nieuw.trim().toLowerCase())
        if (existing) { iid = existing.id }
        else {
          const n = { id: newId(updatedIng), naam: p.nieuw.trim(), type: p.type, fabrikant: p.fabrikant }
          updatedIng = [...updatedIng, n]; iid = n.id
          logAudit(auditLog, setAuditLog, { entiteit: 'Ingrediënt', entiteit_id: n.id, actie: 'aangemaakt', omschrijving: n.naam })
        }
      }
      const lot = { id: newId([...lots, ...newLots]), ingredient_id: iid, hoeveelheid: Number(p.qty), eenheid: p.eenh, houdbaarheid: p.tht || null, lotnummer: p.lotnr || '', leverancier: factuurForm.leverancier || '', prijs_per_eenheid: p.prijs ? Number(p.prijs) : null, factuur_nummer: factuurForm.factuur || '', aankoop_datum: factuurForm.datum || tod(), btw_tarief: Number(p.btw_tarief) || 0, beschikbaar: true, created_at: new Date().toISOString() }
      newLots.push(lot)
      logAudit(auditLog, setAuditLog, { entiteit: 'Lot', entiteit_id: lot.id, actie: 'aangemaakt', omschrijving: `${updatedIng.find((i: any) => i.id === iid)?.naam || p.nieuw.trim()} ${p.qty} ${p.eenh}` })
      addLog({ ingredient_id: iid, ingredient_naam: updatedIng.find((i: any) => i.id === iid)?.naam || p.nieuw.trim(), lot_id: lot.id, lotnummer: lot.lotnummer || '', type: 'ontvangst', hoeveelheid: Number(p.qty), eenheid: p.eenh, referentie: factuurForm.factuur || factuurForm.leverancier || '' })
    })
    setIng(updatedIng)
    setLots((prev: any[]) => [...prev, ...newLots])
    verpakkingLijst.forEach((v: any) => {
      const n = Number(v.aantal)
      const naam = v._naam || v.naam.trim()
      const bestaand = v.od_id ? onderdelen.find((o: any) => o.id === Number(v.od_id)) : onderdelen.find((o: any) => o.naam.toLowerCase() === naam.toLowerCase())
      if (bestaand) {
        setOnderdelen((prev: any[]) => prev.map((o: any) => o.id === bestaand.id ? { ...o, voorraad: Number(o.voorraad || 0) + n, lotnr: v.lotnr || o.lotnr || '', leverancier: factuurForm.leverancier || o.leverancier || '', factuurnummer: factuurForm.factuur || o.factuurnummer || '' } : o))
        logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: bestaand.id, actie: 'gewijzigd', omschrijving: `Ontvangst +${n} ${bestaand.naam}` })
      } else {
        setOnderdelen((prev: any[]) => {
          const id = newId(prev)
          logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: id, actie: 'aangemaakt', omschrijving: naam })
          return [...prev, { id, naam, type: v.type || 'overig', lotnr: v.lotnr || '', kosten_per_stuk: v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0, leverancier: factuurForm.leverancier || '', factuurnummer: factuurForm.factuur || '', voorraad: n }]
        })
      }
    })
    const factuurRegels: any[] = []
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0
      const netto = pn * Number(p.qty || 0)
      const tarief = Number(p.btw_tarief) || 0
      const naam = p.ing_id ? (ing.find((i: any) => i.id === Number(p.ing_id))?.naam || p.nieuw.trim()) : p.nieuw.trim()
      factuurRegels.push({ type: 'ingredient', naam, aantal_stuks: p.aantal_stuks ? Number(p.aantal_stuks) : null, inhoud_per_stuk: p.inhoud_per_stuk ? Number(p.inhoud_per_stuk) : null, hoeveelheid: Number(p.qty), eenheid: p.eenh, prijs_per_eenheid: pn || null, netto, btw_tarief: tarief, btw_bedrag: netto * tarief / 100 })
    })
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0
      const netto = ps * Number(v.aantal || 0)
      const tarief = Number(v.btw_tarief) || 0
      factuurRegels.push({ type: 'verpakking', naam: v._naam || v.naam.trim(), aantal: Number(v.aantal), prijs_per_stuk: ps || null, netto, btw_tarief: tarief, btw_bedrag: netto * tarief / 100 })
    })
    vrijeRegels.forEach((r: any) => {
      const netto = parseFloat(r.netto) || 0
      const tarief = Number(r.btw_tarief) || 0
      factuurRegels.push({ type: 'overig', naam: r.naam.trim(), netto, btw_tarief: tarief, btw_bedrag: +(netto * tarief / 100).toFixed(2) })
    })
    if (factuurRegels.length > 0) {
      const calc_netto = factuurRegels.reduce((s: number, r: any) => s + r.netto, 0)
      const calc_btw = factuurRegels.reduce((s: number, r: any) => s + r.btw_bedrag, 0)
      const totaal_netto = totaalManual ? totaalManual.netto : calc_netto
      const totaal_btw = totaalManual ? totaalManual.btw : calc_btw
      const totaal_bruto = totaalManual ? totaalManual.bruto : calc_netto + calc_btw
      setInkoopFacturen((prev: any[]) => [...prev, { id: newId(prev), datum: factuurForm.datum || tod(), factuurnummer: factuurForm.factuur || '', leverancier: factuurForm.leverancier || '', regels: factuurRegels, totaal_netto, totaal_btw, totaal_bruto, bijlage }])
    }
    setShowO(false)
  }

  const tabBtn = (tabId: string, label: string) => (
    <button onClick={() => setTab(tabId)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === tabId ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <h2 className="text-xl font-bold text-gray-800 mr-4">
            {tab === 'verpakkingen' ? `${t('ing_tab_packaging')}${verpakkingen.some((v: any) => Number(v.voorraad || 0) === 0) ? ' ⚠️' : ''}` : tab === 'mutaties' ? t('ing_tab_mutations') : t('ing_tab_ingredients')}
          </h2>
          {tabBtn('ingredienten', t('ing_tab_ingredients'))}
          {tabBtn('verpakkingen', `${t('ing_tab_packaging')}${verpakkingen.some((v: any) => Number(v.voorraad || 0) === 0) ? ' ⚠️' : ''}`)}
          {tabBtn('mutaties', t('ing_tab_mutations'))}
        </div>
        {tab === 'ingredienten' && (
          <div className="flex items-center gap-2">
            {bfMsg && <span className={`text-xs ${bfMsg.startsWith('✓') ? 'text-green-600' : 'text-amber-600'}`}>{bfMsg}</span>}
            {bfCreds?.enabled && <Btn v="secondary" onClick={runBfIngSync} disabled={bfSyncing}>{bfSyncing ? t('ing_bf_syncing') : t('ing_bf_sync')}</Btn>}
            <Btn onClick={() => { setOntvangstInitTab('ingredienten'); setOntvangstInitIngId(''); setShowO(true) }}>{t('btn_ontvangst')}</Btn>
          </div>
        )}
        {tab === 'verpakkingen' && <Btn onClick={() => { setOntvangstInitTab('verpakkingen'); setOntvangstInitIngId(''); setShowO(true) }}>{t('btn_ontvangst')}</Btn>}
        {tab === 'mutaties' && <Btn onClick={() => { setOntvangstInitTab('ingredienten'); setOntvangstInitIngId(''); setShowO(true) }}>{t('btn_ontvangst')}</Btn>}
      </div>

      {tab === 'ingredienten' && (
        <div className="flex flex-col md:flex-row gap-4 md:items-start">
          <div className={`w-full md:w-60 md:flex-shrink-0${sel ? ' hidden md:block' : ''}`}>
            <div className="mb-2 space-y-1.5">
              <SearchInput placeholder={t('search_ingredient')} value={ingZoek} onChange={v => { setIngZoek(v); setSel(null) }} />
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" className="t-checkbox" checked={alleenOpVoorraad} onChange={e => { setAlleenOpVoorraad(e.target.checked); setSel(null) }} />
                <span className="text-xs text-gray-500">{t('lbl_only_in_stock')}</span>
              </label>
            </div>
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/80 text-xs text-gray-500 uppercase tracking-widest border-b border-gray-100">
                  <tr><th className="px-3 py-1.5 text-left font-normal">{t('lbl_name')}</th><th className="px-3 py-1.5 text-right font-normal">{t('lbl_stock')}</th></tr>
                </thead>
                {ing.length === 0
                  ? <tbody><tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">{t('msg_no_ingredients')}</td></tr></tbody>
                  : (() => {
                    const zoek = ingZoek.trim().toLowerCase()
                    let filtered = zoek ? ing.filter((i: any) => i.naam.toLowerCase().includes(zoek) || (i.type || '').toLowerCase().includes(zoek)) : ing
                    if (alleenOpVoorraad) filtered = filtered.filter((i: any) => totalQty(i.id) > 0)
                    if (filtered.length === 0) return <tbody><tr><td colSpan={2} className="px-3 py-6 text-center text-gray-400">Geen resultaten voor "{ingZoek}"</td></tr></tbody>
                    const allTypes = [...ingTypes, ...filtered.map((i: any) => i.type || 'Overig').filter((tp: string) => !ingTypes.includes(tp)).filter((tp: string, i: number, a: string[]) => a.indexOf(tp) === i)]
                    return allTypes.map((ingTyp: string) => {
                      const groep = [...filtered.filter((i: any) => (i.type || 'Overig') === ingTyp)].sort((a: any, b: any) => a.naam.localeCompare(b.naam, 'nl'))
                      if (groep.length === 0) return null
                      const dicht = groepDicht[ingTyp] && !zoek
                      const typeLabel = BUILTIN_ING_TYPES.includes(ingTyp) ? t('ing_type_' + ingTyp.toLowerCase()) : ingTyp
                      return (
                        <tbody key={ingTyp} className="divide-y divide-gray-100">
                          <tr className="bg-gray-50 cursor-pointer select-none hover:bg-gray-100" onClick={() => setGroepDicht((p: any) => ({ ...p, [ingTyp]: !p[ingTyp] }))}>
                            <td colSpan={2} className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                              <div className="flex items-center">
                                <span className="mr-1.5 text-gray-400">{dicht ? '▶' : '▼'}</span>{typeLabel}
                                <span className="ml-1.5 font-normal text-gray-400">({groep.length})</span>
                              </div>
                            </td>
                          </tr>
                          {!dicht && groep.map((i: any) => {
                            const tot = totalQty(i.id)
                            const eenh = activeLots(i.id)[0]?.eenheid || ''
                            return <tr key={i.id} onClick={() => setSel(sel === i.id ? null : i.id)} className={`cursor-pointer t-hover transition-colors ${sel === i.id ? 't-sel' : ''}`}>
                              <td className="px-3 py-2 font-medium">{i.naam}</td>
                              <td className={`px-3 py-2 text-right font-mono ${tot === 0 ? 'text-red-400' : ''}`}>{tot} {eenh}</td>
                            </tr>
                          })}
                        </tbody>
                      )
                    })
                  })()
                }
              </table>
            </div>
          </div>
          {sel && selIng && (<>
            <button className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors" onClick={() => setSel(null)}>{t('btn_back')}</button>
            <div className="flex-1 min-w-0">
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <SectionHeader
                title={<>{selIng.naam}{selIng.fabrikant && <span className="font-normal opacity-70 ml-1">· {selIng.fabrikant}</span>} — {t('ing_lots')}</>}
                info={<>
                  {selIng.brewfather_id && selIng.brewfather_cat && bfCreds?.enabled && (
                    <Btn s="sm" v="header" onClick={() => pushBfStock(selIng)} disabled={bfPushing}>{bfPushing ? '...' : t('btn_push_bf_stock')}</Btn>
                  )}
                  <Btn s="sm" v="header" onClick={openIngEdit}>{t('btn_edit')}</Btn>
                  <button title={activeLots(sel).length > 0 ? t('err_delete_has_active_lots') : t('title_delete_ingredient')} onClick={deleteIng} disabled={activeLots(sel).length > 0} className={`text-xs px-2 py-1 rounded transition-colors ${activeLots(sel).length > 0 ? 'opacity-40 cursor-not-allowed text-white/60' : 'text-white/80 hover:text-white hover:bg-white/20'}`}>{t('btn_delete')}</button>
                  <Btn s="sm" v="header" onClick={() => { setOntvangstInitTab('ingredienten'); setOntvangstInitIngId(String(sel)); setShowO(true) }}>{t('btn_add_lot')}</Btn>
                </>}
              />
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50">
                  <tr><th className="px-3 py-2 text-left">{t('lbl_lot_short')}</th><th className="px-3 py-2 text-right">{t('lbl_quantity_short')}</th><th className="px-3 py-2 text-left">{t('lbl_tht')}</th><th className="px-3 py-2 text-right">€/E</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeLots(sel).length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">{t('msg_no_active_lots')}</td></tr>}
                  {activeLots(sel).map((lot: any) => {
                    const days = lot.houdbaarheid ? Math.ceil((new Date(lot.houdbaarheid).getTime() - new Date().getTime()) / 86400000) : null
                    const exp = days !== null && days < 0; const soon = days !== null && days >= 0 && days <= 30
                    return <tr key={lot.id} className={`cursor-pointer t-hover transition-colors ${exp ? 'bg-red-50' : soon ? 'bg-yellow-50' : ''}`} onClick={() => openLot(lot)}>
                      <td className="px-3 py-2">{lot.lotnummer || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{lot.hoeveelheid} {lot.eenheid}</td>
                      <td className={`px-3 py-2 text-xs ${exp ? 'text-red-600' : soon ? 'text-yellow-600' : 'text-gray-500'}`}>
                        {lot.houdbaarheid ? fmtD(lot.houdbaarheid) : '—'}{exp ? ' ⚠️' : soon ? ` (${days}d)` : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">{lot.prijs_per_eenheid ? fmt(lot.prijs_per_eenheid) : '—'}</td>
                    </tr>
                  })}
                  {archiefLots(sel).length > 0 && (
                    <tr><td colSpan={4} className="px-3 py-1">
                      <button className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 py-1" onClick={() => setArchiefOpen((p: any) => ({ ...p, [sel]: !p[sel] }))}>
                        <span className="text-gray-400">{archiefOpen[sel] ? '▼' : '▶'}</span>
                        <span>{t('ing_archived_lots').replace('{n}', archiefLots(sel).length)}</span>
                      </button>
                    </td></tr>
                  )}
                  {archiefOpen[sel] && archiefLots(sel).map((lot: any) => (
                    <tr key={lot.id} className="bg-gray-50 cursor-pointer hover:bg-gray-100 opacity-70" onClick={() => openLot(lot)}>
                      <td className="px-3 py-2 text-gray-500">{lot.lotnummer || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">{lot.hoeveelheid} {lot.eenheid} <span className="text-xs text-gray-300">({t('lbl_empty')})</span></td>
                      <td className="px-3 py-2 text-xs text-gray-400">{lot.houdbaarheid ? fmtD(lot.houdbaarheid) : '—'}</td>
                      <td className="px-3 py-2 text-right text-xs text-gray-400">{lot.prijs_per_eenheid ? fmt(lot.prijs_per_eenheid) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selIng.bf_props && Object.keys(selIng.bf_props).length > 0 && (
              <div className="bg-white rounded-xl shadow-card mt-3 overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Brewfather</span>
                </div>
                <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                  {Object.entries(selIng.bf_props).map(([k, v]: [string, any]) => {
                    if (typeof v === 'object' && v !== null) return null
                    const label = t('bf_' + k) !== 'bf_' + k ? t('bf_' + k) : k
                    const display = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')) : String(v)
                    return (
                      <div key={k} className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
                        <span className="text-sm text-gray-700 truncate" title={display}>{display}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            </div>
          </>)}
        </div>
      )}

      {tab === 'verpakkingen' && (
        <div className="space-y-6">
          <div>
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <SectionHeader
                open={!vtIngeklapt}
                onToggle={() => setVtIngeklapt((v: boolean) => !v)}
                rounded={vtIngeklapt ? 'full' : 'top'}
                title={t('verpakking_components_section')}
                info={<Btn s="sm" v="header" onClick={(e: any) => { e.stopPropagation(); setVtForm(emptyVT); setVtOnderdeel({ onderdeel_id: '', aantal: '1' }); setShowVEdit(null); setShowVTAdd(true) }}>{t('verpakking_add_btn')}</Btn>}
              />
              {!vtIngeklapt && <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_packaging')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_content')}</th>
                    <th className="px-3 py-2 text-left">{t('packaging_components')}</th>
                    <th className="px-3 py-2 text-right">{t('packaging_available')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('packaging_cost_per_unit')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {verpakkingen.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">{t('msg_no_packaging')}</td></tr>}
                  {verpakkingen.map((v: any) => {
                    const stock = vpVoorraad(v)
                    const totk = vpKosten(v)
                    return (
                      <tr key={v.id} className={stock === 0 ? 'bg-red-50' : stock <= 5 ? 'bg-yellow-50' : ''}>
                        <td className="px-3 py-2.5 font-medium">{v.naam}{v.type && <span className="ml-1.5 text-xs text-gray-400 capitalize">{v.type}</span>}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500">{Number(v.inhoud_liter || 0)}L</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">
                          {(Array.isArray(v.onderdelen) ? v.onderdelen : []).length === 0 ? <span className="text-gray-300">{t('packaging_no_components')}</span> : (Array.isArray(v.onderdelen) ? v.onderdelen : []).map((o: any) => { const od = onderdelen.find((d: any) => d.id === o.onderdeel_id); return od ? <span key={o.onderdeel_id} className="inline-block mr-2">{o.aantal}× {od.naam}</span> : null })}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-mono font-semibold ${stock === 0 ? 'text-red-600' : stock <= 5 ? 'text-yellow-600' : 'text-gray-800'}`}>{stock}</span>
                          {stock === 0 && <span className="ml-1 text-xs text-red-400 font-normal">{t('packaging_empty')}</span>}
                          {stock > 0 && stock <= 5 && <span className="ml-1 text-xs text-yellow-500 font-normal">{t('packaging_low')}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-sm">{totk > 0 ? <span className="text-amber-700">{fmt(totk)}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1 justify-end">
                            <Btn s="sm" v="ghost" onClick={() => openVTEdit(v)}>✏️</Btn>
                            <button onClick={() => { if (confirm(t('error_confirm_delete_packaging'))) { logAudit(auditLog, setAuditLog, { entiteit: 'Verpakking', entiteit_id: v.id, actie: 'verwijderd', omschrijving: v.naam }); setVerpakkingen((prev: any[]) => prev.filter((x: any) => x.id !== v.id)) } }} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>}
            </div>
          </div>
          <div>
            <div className="bg-white rounded-xl shadow-card overflow-x-auto">
              <SectionHeader
                open={!odIngeklapt}
                onToggle={() => setOdIngeklapt((v: boolean) => !v)}
                rounded={odIngeklapt ? 'full' : 'top'}
                title={t('tab_onderdelen')}
                info={<Btn s="sm" v="header" onClick={(e: any) => { e.stopPropagation(); setOdAddForm(emptyOD); setOdQty(''); setOdPrijs(''); setOdTotaalprijs(''); setShowODAdd(true) }}>{t('onderdeel_add_btn')}</Btn>}
              />
              {!odIngeklapt && <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lbl_onderdeel')}</th>
                    <th className="px-3 py-2 text-left">{t('onderdeel_type')}</th>
                    <th className="px-3 py-2 text-right">{t('lbl_stock')}</th>
                    <th className="px-3 py-2 text-right">{t('packaging_cost_per_unit')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {onderdelen.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">{t('onderdeel_none')}</td></tr>}
                  {onderdelen.map((od: any) => (
                    <tr key={od.id} className={Number(od.voorraad || 0) === 0 ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2.5 font-medium">
                        {od.naam}
                        {(od.leverancier || od.factuurnummer) && <div className="text-xs text-gray-400 font-normal mt-0.5">{od.leverancier}{od.leverancier && od.factuurnummer && ' · '}{od.factuurnummer && `F: ${od.factuurnummer}`}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs capitalize">{od.type || '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-mono font-semibold ${Number(od.voorraad || 0) === 0 ? 'text-red-600' : 'text-gray-800'}`}>{Number(od.voorraad || 0)}</span>
                        {Number(od.voorraad || 0) === 0 && <span className="ml-1 text-xs text-red-400">{t('packaging_empty')}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">{Number(od.kosten_per_stuk || 0) > 0 ? fmt(od.kosten_per_stuk) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1 justify-end">
                          <Btn s="sm" v="ghost" onClick={() => { setOdEditForm({ naam: od.naam, type: od.type || '', kosten_per_stuk: String(od.kosten_per_stuk || ''), leverancier: od.leverancier || '', factuurnummer: od.factuurnummer || '', voorraad: String(od.voorraad || 0) }); setShowODEdit(od) }}>✏️</Btn>
                          <button onClick={() => { if (confirm(t('error_confirm_delete_packaging'))) { logAudit(auditLog, setAuditLog, { entiteit: 'Onderdeel', entiteit_id: od.id, actie: 'verwijderd', omschrijving: od.naam }); setOnderdelen((prev: any[]) => prev.filter((x: any) => x.id !== od.id)) } }} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
            </div>
          </div>
        </div>
      )}

      {tab === 'mutaties' && (
        <div>
          <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                  <th className="px-3 py-2 text-left">{t('log_ingredient')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_lot')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_type')}</th>
                  <th className="px-3 py-2 text-right">{t('lbl_quantity')}</th>
                  <th className="px-3 py-2 text-left">{t('lbl_reference')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(log || []).length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">{t('msg_no_mutations')}</td></tr>}
                {[...(log || [])].reverse().map((entry: any) => {
                  const isCorrPos = entry.type === 'correctie' && Number(entry.hoeveelheid) > 0
                  const isIn = entry.type === 'ontvangst' || entry.type === 'terugboeking' || isCorrPos
                  const clr: Record<string, string> = { ontvangst: 'text-green-600 bg-green-50', gebruik: 'text-red-600 bg-red-50', afboeking: 'text-orange-600 bg-orange-50', terugboeking: 'text-blue-600 bg-blue-50', correctie: 'text-purple-600 bg-purple-50' }
                  const lbl: Record<string, string> = { ontvangst: '↑ ' + t('mut_receipt'), gebruik: '↓ ' + t('mut_usage'), afboeking: '↓ ' + t('mut_booking'), terugboeking: '↑ ' + t('mut_return'), correctie: isCorrPos ? '↑ ' + t('mut_correction') : '↓ ' + t('mut_correction') }
                  return <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtD(entry.datum)}</td>
                    <td className="px-3 py-2 font-medium">{entry.ingredient_naam}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{entry.lotnummer || '—'}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${clr[entry.type] || 'text-gray-600 bg-gray-100'}`}>{lbl[entry.type] || entry.type}</span></td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${isIn ? 'text-green-600' : 'text-red-600'}`}>{isIn ? '+' : '-'}{Math.abs(entry.hoeveelheid)} {entry.eenheid}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{entry.referentie || '—'}</td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showO && (
        <InkoopFactuurModal
          knownLeveranciers={knownLeveranciers}
          ing={ing}
          onderdelen={onderdelen}
          initialTab={ontvangstInitTab}
          initialIngId={ontvangstInitIngId}
          onSave={saveOntvangst}
          onClose={() => setShowO(false)}
          claudeCreds={claudeCreds}
          ingTypes={ingTypes}
          ingTypeBtw={ingTypeBtw}
          kostenSoorten={kostenSoorten}
        />
      )}

      {showLot && (() => {
        const l = showLot
        const ingNaam = ing.find((i: any) => i.id === l.ingredient_id)?.naam || ''
        const gebruiktIn = lotBatches(l.id)
        const isArchief = !l.beschikbaar || Number(l.hoeveelheid || 0) === 0
        const logOntvangst = log.filter((e: any) => e.lot_id === l.id && e.type === 'ontvangst')
        const origQty = logOntvangst.reduce((s: number, e: any) => s + Number(e.hoeveelheid || 0), 0)
        const le = (k: string) => lotEdit[k] ?? ''
        const setLe = (k: string, v: string) => setLotEdit((p: any) => ({ ...p, [k]: v }))
        return (
          <Modal title={`Lot — ${ingNaam}`} onClose={() => setShowLot(null)}>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Inp label={t('ing_lot_number')} value={le('lotnummer')} onChange={(v: string) => setLe('lotnummer', v)} placeholder="—" />
                <Inp label={t('lbl_supplier')} value={le('leverancier')} onChange={(v: string) => setLe('leverancier', v)} placeholder="—" />
                <Inp label={t('lbl_invoice')} value={le('factuur_nummer')} onChange={(v: string) => setLe('factuur_nummer', v)} placeholder="—" />
                <Inp label={t('ing_buy_date')} type="date" value={le('aankoop_datum')} onChange={(v: string) => setLe('aankoop_datum', v)} />
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_quantity')}</label>
                  <div className="flex gap-2">
                    <input type="number" className="flex-1 border rounded px-2 py-1.5 text-sm" value={le('hoeveelheid')} onChange={e => setLe('hoeveelheid', e.target.value)} placeholder="0" />
                    <select className="border rounded px-2 py-1.5 text-sm" value={le('eenheid')} onChange={e => setLe('eenheid', e.target.value)}>
                      {EENHEDEN.map((e: string) => <option key={e} value={e}>{t('unit_' + e.toLowerCase())}</option>)}
                    </select>
                  </div>
                </div>
                <Inp label={t('lbl_tht')} type="date" value={le('houdbaarheid')} onChange={(v: string) => setLe('houdbaarheid', v)} />
                <Inp label={t('modal_price_per_unit')} type="number" value={le('prijs_per_eenheid')} onChange={(v: string) => setLe('prijs_per_eenheid', v)} placeholder="—" />
                <Inp label={t('lbl_gn_code')} value={le('gn_code')} onChange={(v: string) => setLe('gn_code', v)} placeholder="2203 00 09" />
                {origQty > 0 && <div><div className="text-xs text-gray-400">{t('ing_original_received')}</div><div className="font-medium text-gray-700">{origQty} {l.eenheid}</div></div>}
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">{t('ing_used_in_batches')}</div>
                {gebruiktIn.length === 0 ? <p className="text-gray-400 text-xs italic">{t('ing_not_used')}</p> : <div className="space-y-1">{gebruiktIn.map((u: any, i: number) => <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5"><span className="font-medium">{u.batch?.naam || t('lbl_onbekend')}{u.batch?.batch_nummer ? ` #${u.batch.batch_nummer}` : ''}</span><span className="font-mono text-gray-600 text-xs">{u.hoeveelheid} {u.eenheid}</span></div>)}</div>}
              </div>
              {!isArchief && (
                <div className="border-t pt-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('ing_correction')}</div>
                  <div className="flex gap-2 items-end flex-wrap">
                    <div className="flex rounded overflow-hidden border text-sm">
                      <button className={`px-3 py-1.5 font-bold ${lotCorr.richting === '+' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`} onClick={() => setLotCorr(p => ({ ...p, richting: '+' }))}>+</button>
                      <button className={`px-3 py-1.5 font-bold ${lotCorr.richting === '-' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'}`} onClick={() => setLotCorr(p => ({ ...p, richting: '-' }))}>−</button>
                    </div>
                    <div className="flex gap-1 items-end flex-1 min-w-0">
                      <div className="flex-1 min-w-0"><input type="number" min="0" placeholder={t('lbl_quantity')} className="w-full border rounded px-2 py-1.5 text-sm" value={lotCorr.delta} onChange={e => setLotCorr(p => ({ ...p, delta: e.target.value }))} /></div>
                      <div><select className="border rounded px-2 py-1.5 text-sm" value={lotCorr.eenheid} onChange={e => setLotCorr(p => ({ ...p, eenheid: e.target.value }))}>{(compatibeleEenheden(l.eenheid) || [l.eenheid]).map((e: string) => <option key={e}>{e}</option>)}</select></div>
                    </div>
                    <Btn s="sm" onClick={() => doCorrectie(l)}>{t('ing_correct_btn')}</Btn>
                  </div>
                  <div className="mt-2"><input type="text" placeholder={t('ing_correction_reason')} className="w-full border rounded px-2 py-1.5 text-sm text-gray-700" value={lotCorr.reden} onChange={e => setLotCorr(p => ({ ...p, reden: e.target.value }))} /></div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Btn v="secondary" onClick={() => setShowLot(null)}>{t('btn_cancel')}</Btn>
                <Btn onClick={saveLot}>{t('btn_save')}</Btn>
              </div>
            </div>
          </Modal>
        )
      })()}

      {showA && (
        <Modal title={`Afboeken: ${ing.find((i: any) => i.id === showA.ingredient_id)?.naam || ''}`} onClose={() => setShowA(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('lbl_available')}: <strong>{showA.hoeveelheid} {showA.eenheid}</strong> (Lot: {showA.lotnummer || '—'})</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Inp label={t('packaging_deduct_qty')} type="number" value={afQty} onChange={setAfQty} placeholder="0" /></div>
              <div className="w-24"><Sel label={t('lbl_unit')} value={afEenheid} onChange={setAfEenheid} opts={compatibeleEenheden(showA.eenheid)} /></div>
            </div>
            {afEenheid && afEenheid !== showA.eenheid && afQty && convertEenheid(Number(afQty), afEenheid, showA.eenheid) !== null && (
              <p className="text-xs text-blue-600">= {(convertEenheid(Number(afQty), afEenheid, showA.eenheid) as number).toFixed(4).replace(/\.?0+$/, '')} {showA.eenheid}</p>
            )}
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowA(null)}>{t('btn_cancel')}</Btn>
              <Btn v="danger" onClick={() => doAfboeken(showA)}>{t('packaging_deduct_confirm_btn')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showVAfboek && (
        <Modal title={`Afboeken: ${showVAfboek.naam}`} onClose={() => setShowVAfboek(null)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('lbl_available')}: <strong>{showVAfboek.voorraad || 0} {t('unit_stuks')}</strong></p>
            <Inp label={t('packaging_deduct_units')} type="number" value={vAfQty} onChange={setVAfQty} placeholder="0" />
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowVAfboek(null)}>{t('btn_cancel')}</Btn>
              <Btn v="danger" onClick={doVAfboeken}>{t('packaging_deduct_confirm_btn')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showIngEdit && selIng && (
        <Modal title={`Ingrediënt bewerken: ${selIng.naam}`} onClose={() => setShowIngEdit(false)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Inp label={t('lbl_name') + ' *'} value={ingEditForm.naam} onChange={(v: string) => setIngEditForm(f => ({ ...f, naam: v }))} />
              <Sel label={t('lbl_type')} value={ingEditForm.type} onChange={(v: string) => setIngEditForm(f => ({ ...f, type: v }))} opts={ingTypes.map((tp: string) => ({ v: tp, l: BUILTIN_ING_TYPES.includes(tp) ? t('ing_type_' + tp.toLowerCase()) : tp }))} ph="— kies type —" />
              <Inp label="Fabrikant" value={ingEditForm.fabrikant} onChange={(v: string) => setIngEditForm(f => ({ ...f, fabrikant: v }))} placeholder="bijv. Weyermann" />
            </div>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowIngEdit(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveIngEdit}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showODEdit && (
        <Modal title={`Onderdeel: ${showODEdit.naam}`} onClose={() => setShowODEdit(null)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Inp label={t('lbl_name') + ' *'} value={odEditForm.naam} onChange={(v: string) => setOdEditForm(f => ({ ...f, naam: v }))} />
              <Sel label={t('onderdeel_type')} value={odEditForm.type} onChange={(v: string) => setOdEditForm(f => ({ ...f, type: v }))} opts={ONDERDEEL_TYPES.map((ot: any) => ({ v: ot.type, l: t(ot.label) }))} ph={t('packaging_choose_type')} />
              <Inp label={t('lbl_stock')} type="number" value={odEditForm.voorraad} onChange={(v: string) => setOdEditForm(f => ({ ...f, voorraad: v }))} placeholder="0" />
              <Inp label={t('onderdeel_cost')} type="number" value={odEditForm.kosten_per_stuk} onChange={(v: string) => setOdEditForm(f => ({ ...f, kosten_per_stuk: v }))} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('lbl_supplier')} value={odEditForm.leverancier} onChange={(v: string) => setOdEditForm(f => ({ ...f, leverancier: v }))} placeholder={t('ph_supplier')} />
              <Inp label={t('lbl_invoice')} value={odEditForm.factuurnummer} onChange={(v: string) => setOdEditForm(f => ({ ...f, factuurnummer: v }))} placeholder="F-2025-001" />
            </div>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowODEdit(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveODEdit}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showODAdd && (
        <Modal title={t('onderdeel_add_btn')} onClose={() => setShowODAdd(false)} wide>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Bestaand onderdeel</label>
                <select className="w-full border rounded px-2 py-1.5 text-sm" value={odAddForm.od_id} onChange={e => { const od = onderdelen.find((o: any) => o.id === Number(e.target.value)); od ? setOdAddForm((f: any) => ({ ...f, od_id: String(od.id), naam: od.naam, type: od.type || '' })) : setOdAddForm((f: any) => ({ ...f, od_id: '', naam: '', type: '' })) }}>
                  <option value="">— {t('lbl_or_new_ingredient')} —</option>
                  {[...onderdelen].sort((a: any, b: any) => a.naam.localeCompare(b.naam, 'nl')).map((o: any) => <option key={o.id} value={String(o.id)}>{o.naam}</option>)}
                </select>
              </div>
              {!odAddForm.od_id && <Inp label={t('lbl_or_new_ingredient') + ' *'} value={odAddForm.naam} onChange={(v: string) => setOdAddForm((f: any) => ({ ...f, naam: v }))} placeholder="Fles 33cL" />}
            </div>
            {!odAddForm.od_id && <Sel label={t('onderdeel_type')} value={odAddForm.type} onChange={(v: string) => setOdAddForm((f: any) => ({ ...f, type: v }))} opts={ONDERDEEL_TYPES.map((ot: any) => ({ v: ot.type, l: t(ot.label) }))} ph={t('packaging_choose_type')} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Inp label={t('ing_lot_number')} value={odAddForm.lotnr} onChange={(v: string) => setOdAddForm((f: any) => ({ ...f, lotnr: v }))} placeholder="L-2025-001" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Inp label={t('lbl_qty_received') + ' *'} type="number" value={odQty} onChange={(v: string) => { if (odPrijs && v) { setOdQty(v); setOdTotaalprijs(String((Number(odPrijs) * Number(v)).toFixed(2))) } else if (!odPrijs && odTotaalprijs && v) { setOdQty(v); setOdPrijs(String((Number(odTotaalprijs) / Number(v)).toFixed(4))) } else { setOdQty(v) } }} placeholder="24" />
              <Inp label={t('modal_price_per_unit')} type="number" value={odPrijs} onChange={(v: string) => { setOdPrijs(v); if (v && odQty) setOdTotaalprijs(String((Number(v) * Number(odQty)).toFixed(2))) }} placeholder="0.00" />
              <Inp label="Totaalprijs ex BTW (€)" type="number" value={odTotaalprijs} onChange={(v: string) => { setOdTotaalprijs(v); if (v && odQty) setOdPrijs(String((Number(v) / Number(odQty)).toFixed(4))) }} placeholder="0.00" />
            </div>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => setShowODAdd(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveODAdd}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showVTAdd && (
        <Modal title={t('modal_title_packaging_type')} onClose={() => { setShowVTAdd(false); setShowVEdit(null) }} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Inp label={t('lbl_name') + ' *'} value={vtForm.naam} onChange={(v: string) => setVtForm(f => ({ ...f, naam: v }))} placeholder="Fles 33cL compleet" />
              <Inp label={t('packaging_content')} type="number" value={vtForm.inhoud_liter} onChange={(v: string) => setVtForm(f => ({ ...f, inhoud_liter: v }))} placeholder="0.33" />
              <Sel label={t('lbl_type')} value={vtForm.type} onChange={(v: string) => setVtForm(f => ({ ...f, type: v }))} opts={[{ v: 'fles', l: t('pkg_fles') }, { v: 'blik', l: t('pkg_blik') }, { v: 'fust', l: t('pkg_fust') }, { v: 'overig', l: t('ing_type_overig') }]} ph={t('packaging_choose_type')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Sel label={t('statiegeld_soort')} value={vtForm.statiegeld_soort} onChange={(v: string) => setVtForm(f => ({ ...f, statiegeld_soort: v }))} opts={[{ v: 'snd', l: t('statiegeld_snd') }, { v: 'fust', l: t('statiegeld_fust') }]} ph={t('statiegeld_geen')} />
              <Inp label={t('statiegeld_bedrag')} type="number" value={vtForm.statiegeld_bedrag} onChange={(v: string) => setVtForm(f => ({ ...f, statiegeld_bedrag: v }))} placeholder="0.00" />
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">{t('packaging_components')}</p>
              {(Array.isArray(vtForm.onderdelen) ? vtForm.onderdelen : []).length > 0 && (
                <div className="mb-3 space-y-1">
                  {(Array.isArray(vtForm.onderdelen) ? vtForm.onderdelen : []).map((o: any, i: number) => {
                    const od = onderdelen.find((d: any) => d.id === o.onderdeel_id)
                    return <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1"><span className="flex-1">{o.aantal}× {od?.naam || '?'}</span><button onClick={() => setVtForm(f => ({ ...f, onderdelen: f.onderdelen.filter((_: any, j: number) => j !== i) }))} className="text-red-400 hover:text-red-600 text-xs">✕</button></div>
                  })}
                </div>
              )}
              {onderdelen.length === 0 ? <p className="text-sm text-gray-400">{t('onderdeel_none')}</p> : (
                <div className="flex gap-2 items-end">
                  <div className="flex-1"><Sel label={t('packaging_add_component')} value={vtOnderdeel.onderdeel_id} onChange={(v: string) => setVtOnderdeel(f => ({ ...f, onderdeel_id: v }))} opts={onderdelen.map((o: any) => ({ v: String(o.id), l: o.naam }))} ph={t('err_no_component_selected')} /></div>
                  <div className="w-24"><Inp label={t('lbl_qty_needed')} type="number" value={vtOnderdeel.aantal} onChange={(v: string) => setVtOnderdeel(f => ({ ...f, aantal: v }))} placeholder="1" /></div>
                  <Btn s="sm" onClick={() => { if (!vtOnderdeel.onderdeel_id) return; const id = Number(vtOnderdeel.onderdeel_id); setVtForm(f => ({ ...f, onderdelen: [...f.onderdelen.filter((o: any) => o.onderdeel_id !== id), { onderdeel_id: id, aantal: Number(vtOnderdeel.aantal) || 1 }] })); setVtOnderdeel({ onderdeel_id: '', aantal: '1' }) }}>{t('packaging_add_component')}</Btn>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Btn v="secondary" onClick={() => { setShowVTAdd(false); setShowVEdit(null) }}>{t('btn_cancel')}</Btn>
              <Btn onClick={saveVTAdd}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default IngredientenPage
