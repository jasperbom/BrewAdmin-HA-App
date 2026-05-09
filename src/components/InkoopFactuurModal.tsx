import React, { useState } from 'react'
import Modal from './ui/Modal'
import Btn from './ui/Btn'
import Inp from './ui/Inp'
import Sel from './ui/Sel'
import { t } from '../i18n'
import { BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN, EENHEDEN, ONDERDEEL_TYPES, LOT_BREW_FIELDS_PER_TYPE, BREW_PROP_UNITS } from '../utils/constants'
import { getEffectiveBrewProp, formatBrewValue } from '../utils/brewProps'
import { ADDON_BASE, callClaudeProxy } from '../utils/api'
import { tod } from '../utils/format'

// PDF helpers
async function extractPdfText(file: File): Promise<string> {
  // @ts-ignore
  if (!window.pdfjsLib) return ''
  try {
    const ab = await file.arrayBuffer()
    // @ts-ignore
    const pdf = await window.pdfjsLib.getDocument({data: ab}).promise
    let text = ''
    const pages = pdf.numPages
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const byLine: Record<number, any[]> = {}
      for (const item of (content as any).items) {
        const y = Math.round(item.transform[5])
        if (!byLine[y]) byLine[y] = []
        byLine[y].push(item)
      }
      const sortedYs = Object.keys(byLine).map(Number).sort((a, b) => b - a)
      for (const y of sortedYs) {
        const lineText = byLine[y].sort((a: any, b: any) => a.transform[4] - b.transform[4]).map((i: any) => i.str).join(' ').trim()
        if (lineText) text += lineText + '\n'
      }
    }
    return text.trim()
  } catch(e) { return '' }
}

function parseFactuurTekstLokaal(text: string) {
  const result: any = { leverancier: null, factuurnummer: null, datum: null, regels: [], _source: 'lokaal' }
  const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/)
    if (m) { result.datum = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; break }
    const m2 = line.match(/\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/)
    if (m2) { result.datum = `${m2[1]}-${m2[2]}-${m2[3]}`; break }
  }
  const fnm = text.match(/(?:factuur\s*(?:nr\.?|nummer|no\.?)\s*[:\s]+|invoice\s*(?:no\.?|nr\.?|#)\s*)([A-Z0-9][A-Z0-9\-\/\.]{2,20})/i)
  if (fnm) result.factuurnummer = fnm[1].trim()
  return result
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = (e: any) => res(e.target.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

const CLAUDE_FACTUUR_META_PROMPT = `Je bent een assistent die factuurmetadata extraheert voor een brouwerij.
Analyseer de factuur en geef ALLEEN een JSON object terug (geen uitleg, geen markdown):
{
  "leverancier": "naam leverancier of null",
  "factuurnummer": "factuurnummer of null",
  "datum": "YYYY-MM-DD of null"
}`

async function scanFactuurBestand(file: File, claudeApiKey?: string): Promise<any> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  let messages: any[]
  if (isPdf) {
    const text = await extractPdfText(file)
    if (text.length > 120) {
      if (!claudeApiKey) {
        const local = parseFactuurTekstLokaal(text)
        return { leverancier: null, datum: local.datum, factuurnummer: local.factuurnummer, _source: 'lokaal' }
      }
      messages = [{role: 'user', content: `${CLAUDE_FACTUUR_META_PROMPT}\n\nFactuurtekst:\n${text.slice(0, 8000)}`}]
    } else {
      if (!claudeApiKey) throw new Error(t('err_pdf_no_text'))
      const b64 = await fileToBase64(file)
      messages = [{role: 'user', content: [
        {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: b64}},
        {type: 'text', text: CLAUDE_FACTUUR_META_PROMPT},
      ]}]
    }
  } else {
    if (!claudeApiKey) throw new Error(t('err_no_claude_key'))
    const b64 = await fileToBase64(file)
    const mt = file.type || 'image/jpeg'
    messages = [{role: 'user', content: [
      {type: 'image', source: {type: 'base64', media_type: mt, data: b64}},
      {type: 'text', text: CLAUDE_FACTUUR_META_PROMPT},
    ]}]
  }
  const result = await callClaudeProxy({model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages})
  const raw = result.content?.[0]?.text || ''
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Geen JSON in Claude respons')
  const parsed = JSON.parse(m[0])
  return { leverancier: parsed.leverancier || null, datum: parsed.datum || null, factuurnummer: parsed.factuurnummer || null, _source: 'claude' }
}

interface InkoopFactuurModalProps {
  knownLeveranciers?: string[]
  ing?: any[]
  lots?: any[]
  onderdelen?: any[]
  onSave: (data: any) => void
  onClose: () => void
  initialTab?: string
  initialIngId?: string
  claudeCreds?: any
  ingTypes?: string[]
  ingTypeBtw?: Record<string, number>
  initialData?: any
  kostenSoorten?: string[]
  // Geeft op basis van een factuurdatum aan of de BTW naar een andere periode
  // doorrolt (omdat de oorspronkelijke aangifte al ingediend/betaald is).
  // null = geen rollover nodig.
  getRolloverInfo?: (datum: string) => { rolloverNaar: string; vanafPeriode: string } | null
}

function InkoopFactuurModal({
  knownLeveranciers=[], ing=[], lots=[], onderdelen=[], onSave, onClose,
  initialTab='ingredienten', initialIngId='', claudeCreds=null,
  ingTypes=BUILTIN_ING_TYPES, ingTypeBtw={}, initialData=null,
  kostenSoorten=BUILTIN_KOSTEN_SOORTEN, getRolloverInfo
}: InkoopFactuurModalProps) {
  const defaultType = ingTypes[0] || 'Mout'

  // Pre-fill defaults voor "+ lot" op een specifiek ingredient: leid type,
  // eenheid, prijs, BTW en leverancier af uit het laatste lot.
  const initialIng = initialIngId ? ing.find((i: any) => String(i.id) === String(initialIngId)) : null
  const initialIngLots = initialIng ? lots.filter((l: any) => l.ingredient_id === initialIng.id) : []
  const lastLot = [...initialIngLots].sort((a: any, b: any) =>
    new Date(b.aankoop_datum || b.created_at || 0).getTime() -
    new Date(a.aankoop_datum || a.created_at || 0).getTime()
  )[0]
  const eenhCount: Record<string, number> = {}
  initialIngLots.forEach((l: any) => { if (l.eenheid) eenhCount[l.eenheid] = (eenhCount[l.eenheid]||0) + 1 })
  const mostCommonEenh = Object.keys(eenhCount).sort((a, b) => eenhCount[b] - eenhCount[a])[0]

  const initialType = initialIng?.type || defaultType
  const initialEenh = mostCommonEenh || lastLot?.eenheid || 'kg'
  const initialPrijs = lastLot?.prijs_per_eenheid != null ? String(lastLot.prijs_per_eenheid) : ''
  const initialBtw = lastLot?.btw_tarief != null
    ? String(lastLot.btw_tarief)
    : (ingTypeBtw[initialType] != null ? String(ingTypeBtw[initialType]) : '9')

  const emptyProduct = {ing_id:initialIngId,nieuw:'',type:initialType,fabrikant:'',lotnr:'',qty:'',eenh:initialEenh,tht:'',prijs:initialPrijs,totaalprijs:'',btw_tarief:initialBtw,bf_props:{} as Record<string, any>}
  const emptyVO = {od_id:'',naam:'',type:'',lotnr:'',aantal:'',prijs_per_stuk:'',totaalprijs:'',btw_tarief:'21'}

  const [leverancierSel, setLeverancierSel] = useState<string>(() => {
    if (initialData?.leverancier) return knownLeveranciers.includes(initialData.leverancier) ? initialData.leverancier : '__nieuw__'
    if (lastLot?.leverancier && knownLeveranciers.includes(lastLot.leverancier)) return lastLot.leverancier
    if (lastLot?.leverancier) return '__nieuw__'
    return knownLeveranciers.length ? '' : '__nieuw__'
  })
  const [leverancierNieuw, setLeverancierNieuw] = useState<string>(() => {
    if (initialData?.leverancier && !knownLeveranciers.includes(initialData.leverancier)) return initialData.leverancier
    if (lastLot?.leverancier && !knownLeveranciers.includes(lastLot.leverancier)) return lastLot.leverancier
    return ''
  })
  const [factuurNr, setFactuurNr] = useState(initialData?.factuurnummer || '')
  const [datum, setDatum] = useState(initialData?.datum || tod())
  // BTW-soort voor de factuur. Leid de initiële waarde af uit bestaande regels:
  // wanneer een factuur al een verlegde regel bevat, voorselecteren we die soort.
  const [btwSoort, setBtwSoort] = useState<'binnenlands' | 'intracom_eu' | 'import_niet_eu'>(() => {
    const eersteRegel = initialData?.regels?.find((r: any) => r.btw_soort && r.btw_soort !== 'binnenlands')
    return (eersteRegel?.btw_soort as any) || 'binnenlands'
  })
  const [existingBijlage, setExistingBijlage] = useState(initialData?.bijlage || null)
  const [bijlageFile, setBijlageFile] = useState<File|null>(null)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState(initialTab)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string|null>(null)
  const [showPdfViewer, setShowPdfViewer] = useState(false)

  React.useEffect(() => () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl) }, [])

  const [productForm, setProductForm] = useState(emptyProduct)
  const [brewPropsOpen, setBrewPropsOpen] = useState(false)
  const [productLijst, setProductLijst] = useState<any[]>(() => {
    if (!initialData?.regels) return []
    return initialData.regels.filter((r: any) => r.type==='ingredient').map((r: any, i: number) => {
      const ingItem = ing.find((x: any) => x.naam===r.naam)
      return {
        ing_id: ingItem ? String(ingItem.id) : '', nieuw: ingItem ? '' : r.naam,
        type: ingItem?.type || defaultType, fabrikant: '', lotnr: '',
        qty: String(r.hoeveelheid||''), eenh: r.eenheid||'kg', tht: '',
        prijs: String(r.prijs_per_eenheid||''), totaalprijs: String(r.netto||''),
        btw_tarief: String(r.btw_tarief??0), _naam: r.naam, _id: Date.now()+i,
      }
    })
  })

  const [vOntvForm, setVOntvForm] = useState(emptyVO)
  const [verpakkingLijst, setVerpakkingLijst] = useState<any[]>(() => {
    if (!initialData?.regels) return []
    return initialData.regels.filter((r: any) => r.type==='verpakking').map((r: any, i: number) => {
      const od = onderdelen.find((x: any) => x.naam===r.naam)
      return {
        od_id: od ? String(od.id) : '', naam: r.naam, type: od?.type||'', lotnr: '',
        aantal: String(r.aantal||''), prijs_per_stuk: String(r.prijs_per_stuk||''),
        totaalprijs: String(r.netto||''), btw_tarief: String(r.btw_tarief??21),
        _naam: r.naam, _id: Date.now()+i+1000,
      }
    })
  })

  const emptyVrije = {naam:'', netto: '' as string | number, btw_tarief: 21, kostensoort: 'Overig'}
  const [vrijeForm, setVrijeForm] = useState<any>(emptyVrije)
  const [vrijeList, setVrijeList] = useState<any[]>(() => {
    if (!initialData?.regels) return []
    return initialData.regels.filter((r: any) => r.type==='overig').map((r: any, i: number) => ({
      naam: r.naam, netto: String(r.netto||''), btw_tarief: Number(r.btw_tarief??21), kostensoort: r.kostensoort || 'Overig', _id: Date.now()+i+2000,
    }))
  })

  const [productTotInclBtw, setProductTotInclBtw] = useState(false)
  const [productBrutoStr, setProductBrutoStr] = useState('')
  const [verpakTotInclBtw, setVerpakTotInclBtw] = useState(false)
  const [verpakBrutoStr, setVerpakBrutoStr] = useState('')
  const [vrijeTotInclBtw, setVrijeTotInclBtw] = useState(false)
  const [vrijeBrutoStr, setVrijeBrutoStr] = useState('')

  const [manualNetto, setManualNetto] = useState<string|null>(null)
  const [manualBtw, setManualBtw] = useState<string|null>(null)
  const [manualBruto, setManualBruto] = useState<string|null>(null)

  const [editingProductIdx, setEditingProductIdx] = useState<number|null>(null)
  const [editingVerpakkingIdx, setEditingVerpakkingIdx] = useState<number|null>(null)
  const [editingVrijeIdx, setEditingVrijeIdx] = useState<number|null>(null)

  const [isScanning, setIsScanning] = useState(false)
  const [scanFout, setScanFout] = useState<string|null>(null)

  React.useEffect(() => { setManualNetto(null); setManualBtw(null); setManualBruto(null) },
    [productLijst.length, verpakkingLijst.length, vrijeList.length])

  const leverancier = leverancierSel === '__nieuw__' ? leverancierNieuw.trim() : leverancierSel
  const factuurForm = {leverancier, factuur: factuurNr, datum, btw_soort: btwSoort}

  const voegProductToe = () => {
    if (!productForm.ing_id && !productForm.nieuw.trim()) { alert(t('err_select_ingredient')); return }
    if (!productForm.qty) { alert(t('err_qty_required')); return }
    const naam = productForm.ing_id ? (ing.find((i: any) => i.id===Number(productForm.ing_id))?.naam||'') : productForm.nieuw.trim()
    if (editingProductIdx !== null) {
      setProductLijst(prev => prev.map((p: any, i: number) => i===editingProductIdx ? {...productForm, _naam:naam, _id:p._id} : p))
      setEditingProductIdx(null)
    } else {
      setProductLijst(prev => [...prev, {...productForm, _naam:naam, _id:Date.now()}])
    }
    setProductForm(emptyProduct); setProductTotInclBtw(false); setProductBrutoStr('')
  }

  const voegVerpakkingToe = () => {
    if (!vOntvForm.od_id && !vOntvForm.naam.trim()) { alert(t('err_name_required')); return }
    if (!vOntvForm.aantal) { alert(t('err_count_required')); return }
    const naam = vOntvForm.od_id
      ? (onderdelen.find((o: any) => o.id===Number(vOntvForm.od_id))?.naam||vOntvForm.naam)
      : vOntvForm.naam.trim()
    if (editingVerpakkingIdx !== null) {
      setVerpakkingLijst(prev => prev.map((v: any, i: number) => i===editingVerpakkingIdx ? {...vOntvForm, _naam:naam, _id:v._id} : v))
      setEditingVerpakkingIdx(null)
    } else {
      setVerpakkingLijst(prev => [...prev, {...vOntvForm, _naam:naam, _id:Date.now()}])
    }
    setVOntvForm(emptyVO); setVerpakTotInclBtw(false); setVerpakBrutoStr('')
  }

  const voegVrijeToe = () => {
    if (!vrijeForm.naam.trim()) { alert(t('err_fill_description')); return }
    if (!parseFloat(vrijeForm.netto)) { alert(t('err_fill_amount')); return }
    if (editingVrijeIdx !== null) {
      setVrijeList(prev => prev.map((r: any, i: number) => i===editingVrijeIdx ? {...vrijeForm, _id:r._id} : r))
      setEditingVrijeIdx(null)
    } else {
      setVrijeList(prev => [...prev, {...vrijeForm, _id:Date.now()}])
    }
    setVrijeForm(emptyVrije); setVrijeTotInclBtw(false); setVrijeBrutoStr('')
  }

  const verwerkScanData = (data: any) => {
    if (data.leverancier && !leverancierNieuw && leverancierSel === (knownLeveranciers.length ? '' : '__nieuw__')) {
      const known = knownLeveranciers.find((l: string) => l.toLowerCase() === data.leverancier.toLowerCase())
      if (known) setLeverancierSel(known)
      else { setLeverancierSel('__nieuw__'); setLeverancierNieuw(data.leverancier) }
    }
    if (data.factuurnummer && !factuurNr) setFactuurNr(data.factuurnummer)
    if (data.datum && datum === tod()) setDatum(data.datum)
  }

  const doScanFactuur = async () => {
    if (!bijlageFile) return
    setIsScanning(true); setScanFout(null)
    try {
      const data = await scanFactuurBestand(bijlageFile, claudeCreds?.apiKey)
      verwerkScanData(data)
    } catch(e: any) {
      setScanFout(e.message || 'Scan mislukt')
    } finally {
      setIsScanning(false)
    }
  }

  const handleSave = async () => {
    if (productLijst.length===0 && verpakkingLijst.length===0 && vrijeList.length===0) {
      alert(t('err_min_one_product')); return
    }
    let bijlage = existingBijlage
    if (bijlageFile) {
      setUploading(true)
      try {
        const ext = (bijlageFile.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'')
        const filename = `ontvangst_${Date.now()}.${ext||'bin'}`
        const b64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader()
          reader.onload = () => res((reader.result as string).split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(bijlageFile)
        })
        const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({data: b64}),
        })
        if (resp.ok) bijlage = {naam: bijlageFile.name, bestand: filename}
      } catch(e) { /* upload failed silently */ }
      setUploading(false)
    }
    onSave({
      factuurForm, productLijst, verpakkingLijst, vrijeRegels: vrijeList, bijlage,
      totaalManual: (manualNetto !== null || manualBtw !== null || manualBruto !== null)
        ? { netto: parseFloat(manualNetto ?? String(totaalNetto)),
            btw: parseFloat(manualBtw ?? String(totaalBtw)),
            bruto: parseFloat(manualBruto ?? String(totaalNetto + totaalBtw)) }
        : null,
    })
  }

  // Bij intracom-EU of import-niet-EU is de BTW verlegd: leverancier factureert
  // €0 BTW. De zelfberekende verschuldigde BTW wordt apart in de aangifte
  // (rubriek 4a/4b) verwerkt, niet in de factuurtotalen.
  const isVerlegd = btwSoort !== 'binnenlands'
  const totaalNetto = productLijst.reduce((s: number, p: any) => s+(parseFloat(p.totaalprijs)||0), 0)
    + verpakkingLijst.reduce((s: number, v: any) => s+(parseFloat(v.totaalprijs)||0), 0)
    + vrijeList.reduce((s: number, r: any) => s+(parseFloat(r.netto)||0), 0)
  const totaalBtw = isVerlegd ? 0 : (
    productLijst.reduce((s: number, p: any) => s+(parseFloat(p.totaalprijs)||0)*(Number(p.btw_tarief)||0)/100, 0)
    + verpakkingLijst.reduce((s: number, v: any) => s+(parseFloat(v.totaalprijs)||0)*(Number(v.btw_tarief)||0)/100, 0)
    + vrijeList.reduce((s: number, r: any) => s+(parseFloat(r.netto)||0)*(Number(r.btw_tarief)||0)/100, 0)
  )

  const btwTarieven = (() => {
    if (isVerlegd) return [] as [string, number][]
    const map: Record<string,number> = {}
    ;[...productLijst,...verpakkingLijst].forEach((p: any) => {
      const k = Number(p.btw_tarief||0); if (!map[k]) map[k] = 0
      map[k] += (parseFloat(p.totaalprijs)||0) * k / 100
    })
    vrijeList.forEach((r: any) => {
      const k = Number(r.btw_tarief||0); if (!map[k]) map[k] = 0
      map[k] += (parseFloat(r.netto)||0) * k / 100
    })
    return Object.entries(map).filter(([,v]) => v>0).sort(([a],[b]) => Number(a)-Number(b))
  })()

  return (
    <Modal title={initialData ? t('modal_title_edit_invoice') : t('modal_title_receipt')} onClose={onClose} wide={!showPdfViewer} ultrawide={showPdfViewer}>
      <div className={showPdfViewer ? 'grid grid-cols-2 gap-4' : ''}>
      {showPdfViewer && (
        <div className="order-2">
          {bijlageFile && (bijlageFile.type === 'application/pdf' || bijlageFile.name.toLowerCase().endsWith('.pdf'))
            ? <iframe src={pdfBlobUrl!} className="w-full rounded-lg border border-gray-200" style={{height:'80vh'}} title="Factuur" />
            : <img src={pdfBlobUrl!} alt="Factuur" className="w-full rounded-lg border border-gray-200 object-contain" style={{maxHeight:'80vh'}} />
          }
        </div>
      )}
      <div className={`space-y-4 ${showPdfViewer ? 'order-1 overflow-y-auto' : ''}`} style={showPdfViewer ? {maxHeight:'85vh'} : {}}>
        {initialData && (
          <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <span className="mt-0.5 flex-shrink-0">⚠️</span>
            <span>{t('modal_edit_warning')}</span>
          </div>
        )}
        {initialData?.betaald_datum && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
            <span className="flex-shrink-0">✓</span>
            <span className="font-medium">{t('lbl_paid_on')}: {initialData.betaald_datum}</span>
          </div>
        )}

        {/* Factuurgegevens */}
        <div className="t-panel border rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">{t('modal_invoice_details')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_supplier')}</label>
              {knownLeveranciers.length > 0 ? (<>
                <select value={leverancierSel} onChange={e => setLeverancierSel(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm">
                  <option value="">— {t('ph_choose')} —</option>
                  {knownLeveranciers.map((l: string) => <option key={l} value={l}>{l}</option>)}
                  <option value="__nieuw__">{t('lbl_new_supplier')}</option>
                </select>
                {leverancierSel === '__nieuw__' && (
                  <input type="text" value={leverancierNieuw} onChange={e => setLeverancierNieuw(e.target.value)}
                    placeholder={t('ph_brewery_name')}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                )}
              </>) : (
                <input type="text" value={leverancierNieuw} onChange={e => setLeverancierNieuw(e.target.value)}
                  placeholder={t('ph_brewery_name')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
              )}
            </div>
            <Inp label={t('lbl_invoice')} value={factuurNr} onChange={setFactuurNr} placeholder="F-2025-001" />
            <Inp label={t('lbl_invoice_date')} type="date" value={datum} onChange={setDatum} />
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_btw_soort')}</label>
            <select value={btwSoort} onChange={e => setBtwSoort(e.target.value as any)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm">
              <option value="binnenlands">{t('lbl_btw_soort_binnenlands')}</option>
              <option value="intracom_eu">{t('lbl_btw_soort_intracom_eu')}</option>
              <option value="import_niet_eu">{t('lbl_btw_soort_import_niet_eu')}</option>
            </select>
            {isVerlegd && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
                <span className="mt-0.5 flex-shrink-0">⇄</span>
                <span>{btwSoort === 'intracom_eu' ? t('hint_btw_verlegd_intracom') : t('hint_btw_verlegd_import')}</span>
              </div>
            )}
          </div>
          {(() => {
            const ri = getRolloverInfo ? getRolloverInfo(datum) : null
            if (!ri) return null
            return (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
                <span className="mt-0.5 flex-shrink-0">↪</span>
                <span>
                  {t('msg_btw_rollover')
                    .replace('{from}', ri.vanafPeriode)
                    .replace('{to}', ri.rolloverNaar)}
                </span>
              </div>
            )
          })()}
          {!leverancier && !factuurNr.trim() && (
            <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              <span className="mt-0.5 flex-shrink-0">ℹ️</span>
              <span>{t('hint_correctie_geen_factuur')}</span>
            </div>
          )}
          {/* Bijlage */}
          <div className="mt-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_bijlage')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">
                <span>📎</span>
                <span>{bijlageFile ? bijlageFile.name : existingBijlage ? t('lbl_replace_file') : t('lbl_choose_file')}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff,.bmp,.heic,.heif"
                  className="hidden" onChange={e => {
                    const f = e.target.files?.[0] || null
                    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
                    setBijlageFile(f)
                    if (f) { const url = URL.createObjectURL(f); setPdfBlobUrl(url) }
                    else { setPdfBlobUrl(null); setShowPdfViewer(false) }
                  }} />
              </label>
              {!bijlageFile && existingBijlage?.bestand && (
                <a href={`${ADDON_BASE}api/file/${existingBijlage.bestand}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1">📎 {existingBijlage.naam}</a>
              )}
              {!bijlageFile && existingBijlage && (
                <button onClick={() => setExistingBijlage(null)} className="text-gray-400 hover:text-red-500 text-xs" title={t('btn_remove_bijlage')}>✕</button>
              )}
              {bijlageFile && <button onClick={() => {setBijlageFile(null);if(pdfBlobUrl){URL.revokeObjectURL(pdfBlobUrl);setPdfBlobUrl(null);}setShowPdfViewer(false);}} className="text-gray-400 hover:text-red-500 text-xs">✕</button>}
              {bijlageFile && !isScanning && (() => {
                const isPdf = bijlageFile.type === 'application/pdf' || bijlageFile.name.toLowerCase().endsWith('.pdf')
                const hasClaude = claudeCreds?.enabled && claudeCreds?.apiKey
                if (isPdf || hasClaude) return (
                  <button onClick={doScanFactuur}
                    className="flex items-center gap-1.5 px-3 py-1.5 tbtn rounded-lg text-xs font-medium"
                    title={t('title_scan_factuur')}>
                    {isPdf ? '📄' : '🤖'} {t('btn_scan_factuur')}
                  </button>
                )
                return null
              })()}
              {bijlageFile && pdfBlobUrl && (
                <button onClick={() => setShowPdfViewer(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-xs font-medium text-gray-700">
                  {showPdfViewer ? t('btn_close_viewer') : t('btn_view_file')}
                </button>
              )}
            </div>
            {isScanning && (
              <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {t('msg_scanning')}
              </div>
            )}
            {scanFout && <p className="mt-2 text-xs text-red-600">⚠ {scanFout}</p>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {[
            {id:'ingredienten', label:t('ing_tab_ingredients')},
            {id:'verpakkingen', label:t('tab_onderdelen')},
            {id:'vrije', label:t('tab_vrije_regels')},
          ].map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab===tb.id?'t-tab font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Ingrediënten tab */}
        {tab==='ingredienten' && (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('modal_add_product')}</p>
            <div className="space-y-2">
              <Sel label={t('lbl_ingredient_type')} value={productForm.type}
                onChange={v => setProductForm((f: any) => ({...f,type:v,ing_id:'',nieuw:'',btw_tarief:ingTypeBtw[v]!=null?String(ingTypeBtw[v]):f.btw_tarief}))}
                opts={ingTypes.map((ty: string) => ({v:ty, l:BUILTIN_ING_TYPES.includes(ty)?t('ing_type_'+ty.toLowerCase()):ty}))} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('modal_existing_ingredient')}</label>
                  <select className="w-full border rounded px-2 py-1.5 text-sm"
                    value={productForm.ing_id}
                    onChange={e => setProductForm((f: any) => ({...f,ing_id:e.target.value,nieuw:''}))}>
                    <option value="">{t('modal_select_option')}</option>
                    {[...ing].filter((i: any) => i.type===productForm.type)
                      .sort((a: any, b: any) => a.naam.localeCompare(b.naam,'nl'))
                      .map((i: any) => <option key={i.id} value={String(i.id)}>{i.naam}{i.fabrikant?` (${i.fabrikant})`:''}</option>)}
                  </select>
                </div>
                <Inp label={t('lbl_or_new_ingredient')} value={productForm.nieuw} onChange={v => setProductForm((f: any) => ({...f,nieuw:v,ing_id:''}))} placeholder={t('ph_new_name')} />
              </div>
              {!productForm.ing_id && (
                <Inp label={t('ing_manufacturer')} value={productForm.fabrikant} onChange={v => setProductForm((f: any) => ({...f,fabrikant:v}))} placeholder={t('ph_manufacturer')} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('modal_qty_required')} *</label>
                  <div className="flex gap-1">
                    <input type="number" value={productForm.qty}
                      onChange={e => { const v=e.target.value; setProductForm((f: any) => { const p=f.prijs,tot=f.totaalprijs; if(p&&v)return{...f,qty:v,totaalprijs:String((Number(p)*Number(v)).toFixed(2))}; if(!p&&tot&&v)return{...f,qty:v,prijs:String((Number(tot)/Number(v)).toFixed(4))}; return{...f,qty:v}; }); }}
                      placeholder="0"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                    <select value={productForm.eenh} onChange={e => setProductForm((f: any) => ({...f,eenh:e.target.value}))}
                      className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white t-input outline-none shadow-sm">
                      {EENHEDEN.map(e => <option key={e} value={e}>{t('unit_'+e.toLowerCase())}</option>)}
                    </select>
                  </div>
                </div>
                <Inp label={t('ing_lot_number')} value={productForm.lotnr} onChange={v => setProductForm((f: any) => ({...f,lotnr:v}))} placeholder="L-2025-001" />
                <Inp label={t('batch_filling_tht')} type="date" value={productForm.tht} onChange={v => setProductForm((f: any) => ({...f,tht:v}))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Inp label={t('modal_price_per_unit')} type="number" value={productForm.prijs}
                  onChange={v => setProductForm((f: any) => ({...f,prijs:v,totaalprijs:v&&f.qty?String((Number(v)*Number(f.qty)).toFixed(2)):f.totaalprijs}))}
                  placeholder="0.00" />
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">{t('lbl_totaalprijs')}</label>
                    <button type="button"
                      onClick={() => { const ni=!productTotInclBtw; setProductTotInclBtw(ni); if(ni){const n=parseFloat(String(productForm.totaalprijs||'0')); const b=Number(productForm.btw_tarief||0); setProductBrutoStr(n?(n*(1+b/100)).toFixed(2):'')} }}
                      className="text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600">
                      {productTotInclBtw ? t('lbl_incl_btw') : t('lbl_excl_btw_toggle')}
                    </button>
                  </div>
                  <input type="number"
                    value={productTotInclBtw ? productBrutoStr : productForm.totaalprijs}
                    onChange={e => { const v=e.target.value; if(productTotInclBtw){setProductBrutoStr(v);const b=Number(productForm.btw_tarief||0);const n=v?String((Number(v)/(1+b/100)).toFixed(2)):'';setProductForm((f: any)=>({...f,totaalprijs:n,prijs:n&&f.qty?String((Number(n)/Number(f.qty)).toFixed(4)):f.prijs}));}else{setProductForm((f: any)=>({...f,totaalprijs:v,prijs:v&&f.qty?String((Number(v)/Number(f.qty)).toFixed(4)):f.prijs}));} }}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('lbl_btw_pct')}</label>
                  <select value={productForm.btw_tarief}
                    onChange={e => { const nb=e.target.value; setProductForm((f: any) => { if(productTotInclBtw&&productBrutoStr){const n=String((Number(productBrutoStr)/(1+Number(nb)/100)).toFixed(2));return{...f,btw_tarief:nb,totaalprijs:n,prijs:n&&f.qty?String((Number(n)/Number(f.qty)).toFixed(4)):f.prijs};}return{...f,btw_tarief:nb}; }); }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none w-full">
                    <option value="0">0%</option>
                    <option value="9">9%</option>
                    <option value="21">21%</option>
                  </select>
                </div>
              </div>
              {(LOT_BREW_FIELDS_PER_TYPE[productForm.type] || []).length > 0 && (
                <div className="border-t border-gray-100 pt-2">
                  <div className="flex items-center justify-between">
                    <button type="button"
                      onClick={() => setBrewPropsOpen(o => !o)}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700">
                      <span className="text-gray-400">{brewPropsOpen ? '▼' : '▶'}</span>
                      <span>{t('brew_props_section')}</span>
                    </button>
                    {brewPropsOpen && lastLot?.bf_props && Object.keys(lastLot.bf_props).length > 0 && (
                      <Btn s="sm" v="secondary"
                        onClick={() => setProductForm((f: any) => ({...f, bf_props: {...lastLot.bf_props}}))}>
                        {t('btn_copy_from_last_lot')}
                      </Btn>
                    )}
                  </div>
                  {brewPropsOpen && (() => {
                    const selectedIng = productForm.ing_id ? ing.find((i: any) => i.id === Number(productForm.ing_id)) : null
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                        {(LOT_BREW_FIELDS_PER_TYPE[productForm.type] || []).map((fld: any) => {
                          const label = t('bf_' + fld.key) !== 'bf_' + fld.key ? t('bf_' + fld.key) : fld.key
                          const unit = BREW_PROP_UNITS[fld.key]
                          const labelWithUnit = unit ? `${label} (${unit})` : label
                          const val = productForm.bf_props?.[fld.key] ?? ''
                          const set = (v: any) => setProductForm((f: any) => ({...f, bf_props: {...(f.bf_props||{}), [fld.key]: v}}))
                          const ingFallback = !val && selectedIng ? getEffectiveBrewProp(null, selectedIng, fld.key) : undefined
                          const hint = ingFallback !== undefined
                            ? t('brew_props_fallback_hint').replace('{value}', formatBrewValue(ingFallback))
                            : null
                          if (fld.kind === 'select') {
                            return (
                              <div key={fld.key}>
                                <label className="block text-xs font-medium text-gray-600 mb-1">{labelWithUnit}</label>
                                <select value={val} onChange={e => set(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none">
                                  <option value="">—</option>
                                  {(fld.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                                </select>
                                {hint && (
                                  <button type="button"
                                    onClick={() => set(formatBrewValue(ingFallback))}
                                    title={t('btn_use_bf_value')}
                                    className="text-[10px] text-gray-400 hover:text-blue-600 mt-0.5 underline-offset-2 hover:underline cursor-pointer">
                                    {hint}
                                  </button>
                                )}
                              </div>
                            )
                          }
                          return (
                            <div key={fld.key}>
                              <Inp label={labelWithUnit}
                                type={fld.kind === 'number' ? 'number' : 'text'}
                                value={String(val)}
                                onChange={(v: string) => set(v)}
                                placeholder="" />
                              {hint && (
                                <button type="button"
                                  onClick={() => {
                                    const fmtVal = formatBrewValue(ingFallback)
                                    set(fld.kind === 'number' ? Number(fmtVal) : fmtVal)
                                  }}
                                  title={t('btn_use_bf_value')}
                                  className="text-[10px] text-gray-400 hover:text-blue-600 mt-0.5 underline-offset-2 hover:underline cursor-pointer">
                                  {hint}
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
              <div className="flex justify-end gap-2">
                {editingProductIdx !== null && (
                  <Btn v="secondary" onClick={() => {setEditingProductIdx(null);setProductForm(emptyProduct);setProductTotInclBtw(false);setProductBrutoStr('')}}>{t('btn_cancel')}</Btn>
                )}
                <Btn onClick={voegProductToe}>{editingProductIdx !== null ? t('btn_update') : t('modal_add_to_list')}</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Verpakkingen tab */}
        {tab==='verpakkingen' && (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('onderdeel_add_btn')}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_bestaand_onderdeel')}</label>
                  <select className="w-full border rounded px-2 py-1.5 text-sm"
                    value={vOntvForm.od_id}
                    onChange={e => { const od=onderdelen.find((o: any)=>o.id===Number(e.target.value)); od?setVOntvForm((f: any)=>({...f,od_id:String(od.id),naam:od.naam,type:od.type||''})):setVOntvForm((f: any)=>({...f,od_id:'',naam:'',type:''})); }}>
                    <option value="">— {t('lbl_or_new_ingredient')} —</option>
                    {[...onderdelen].sort((a: any,b: any)=>a.naam.localeCompare(b.naam,'nl')).map((o: any)=><option key={o.id} value={String(o.id)}>{o.naam}</option>)}
                  </select>
                </div>
                {!vOntvForm.od_id && (
                  <Inp label={t('lbl_or_new_ingredient')+' *'} value={vOntvForm.naam} onChange={v => setVOntvForm((f: any)=>({...f,naam:v,od_id:''}))} placeholder="Fles 33cL" />
                )}
              </div>
              {!vOntvForm.od_id && (
                <Sel label={t('onderdeel_type')} value={vOntvForm.type} onChange={v => setVOntvForm((f: any)=>({...f,type:v}))}
                  opts={ONDERDEEL_TYPES.map(ot => ({v:ot.type,l:t(ot.label)}))} ph={t('packaging_choose_type')} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Inp label={t('lbl_qty_received')+' *'} type="number" value={vOntvForm.aantal}
                  onChange={v => setVOntvForm((f: any) => { const ps=f.prijs_per_stuk,tot=f.totaalprijs; if(ps&&v)return{...f,aantal:v,totaalprijs:String((Number(ps)*Number(v)).toFixed(2))}; if(!ps&&tot&&v)return{...f,aantal:v,prijs_per_stuk:String((Number(tot)/Number(v)).toFixed(4))}; return{...f,aantal:v}; })}
                  placeholder="24" />
                <Inp label={t('modal_price_per_unit')} type="number" value={vOntvForm.prijs_per_stuk}
                  onChange={v => setVOntvForm((f: any)=>({...f,prijs_per_stuk:v,totaalprijs:v&&f.aantal?String((Number(v)*Number(f.aantal)).toFixed(2)):f.totaalprijs}))}
                  placeholder="0.00" />
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">{t('lbl_totaalprijs')}</label>
                    <button type="button"
                      onClick={() => { const ni=!verpakTotInclBtw; setVerpakTotInclBtw(ni); if(ni){const n=parseFloat(String(vOntvForm.totaalprijs||'0')); const b=Number(vOntvForm.btw_tarief||0); setVerpakBrutoStr(n?(n*(1+b/100)).toFixed(2):'')} }}
                      className="text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600">
                      {verpakTotInclBtw ? t('lbl_incl_btw') : t('lbl_excl_btw_toggle')}
                    </button>
                  </div>
                  <input type="number"
                    value={verpakTotInclBtw ? verpakBrutoStr : vOntvForm.totaalprijs}
                    onChange={e => { const v=e.target.value; if(verpakTotInclBtw){setVerpakBrutoStr(v);const b=Number(vOntvForm.btw_tarief||0);const n=v?String((Number(v)/(1+b/100)).toFixed(2)):'';setVOntvForm((f: any)=>({...f,totaalprijs:n,prijs_per_stuk:n&&f.aantal?String((Number(n)/Number(f.aantal)).toFixed(4)):f.prijs_per_stuk}));}else{setVOntvForm((f: any)=>({...f,totaalprijs:v,prijs_per_stuk:v&&f.aantal?String((Number(v)/Number(f.aantal)).toFixed(4)):f.prijs_per_stuk}));} }}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('lbl_btw_pct')}</label>
                  <select value={vOntvForm.btw_tarief}
                    onChange={e => { const nb=e.target.value; setVOntvForm((f: any) => { if(verpakTotInclBtw&&verpakBrutoStr){const n=String((Number(verpakBrutoStr)/(1+Number(nb)/100)).toFixed(2));return{...f,btw_tarief:nb,totaalprijs:n,prijs_per_stuk:n&&f.aantal?String((Number(n)/Number(f.aantal)).toFixed(4)):f.prijs_per_stuk};}return{...f,btw_tarief:nb}; }); }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none w-full">
                    <option value="0">0%</option>
                    <option value="9">9%</option>
                    <option value="21">21%</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {editingVerpakkingIdx !== null && (
                  <Btn v="secondary" onClick={() => {setEditingVerpakkingIdx(null);setVOntvForm(emptyVO);setVerpakTotInclBtw(false);setVerpakBrutoStr('')}}>{t('btn_cancel')}</Btn>
                )}
                <Btn onClick={voegVerpakkingToe}>{editingVerpakkingIdx !== null ? t('btn_update') : t('modal_add_to_list')}</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Vrije regels tab */}
        {tab==='vrije' && (
          <div className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('lbl_vrije_regel_toevoegen')}</p>
            <div className="space-y-2">
              <Inp label={t('lbl_omschrijving')} value={String(vrijeForm.naam)} onChange={v => setVrijeForm((f: any)=>({...f,naam:v}))} placeholder={t('ph_vrije_regel')} />
              <Sel label={t('lbl_kostensoort')} value={vrijeForm.kostensoort || 'Overig'}
                onChange={v => setVrijeForm((f: any)=>({...f,kostensoort:v}))}
                opts={kostenSoorten.map((ks: string) => ({v:ks, l:BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_'+ks.toLowerCase()) : ks}))}
                ph={t('ph_kostensoort')} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">{t('lbl_bedrag')}</label>
                    <button type="button"
                      onClick={() => { const ni=!vrijeTotInclBtw; setVrijeTotInclBtw(ni); if(!ni){setVrijeBrutoStr('');}else if(vrijeForm.netto){const b=Number(vrijeForm.btw_tarief||0);setVrijeBrutoStr(String((Number(vrijeForm.netto)*(1+b/100)).toFixed(2)));} }}
                      className="text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600">
                      {vrijeTotInclBtw ? t('lbl_incl_btw') : t('lbl_excl_btw_toggle')}
                    </button>
                  </div>
                  <input type="number"
                    value={vrijeTotInclBtw ? vrijeBrutoStr : String(vrijeForm.netto)}
                    onChange={e => { const v=e.target.value; if(vrijeTotInclBtw){setVrijeBrutoStr(v);const b=Number(vrijeForm.btw_tarief||0);const n=v?String((Number(v)/(1+b/100)).toFixed(2)):'';setVrijeForm((f: any)=>({...f,netto:n}));}else{setVrijeForm((f: any)=>({...f,netto:v}));} }}
                    placeholder="0.00" min={0} step="0.01"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all duration-150 shadow-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('lbl_btw_pct')}</label>
                  <select value={vrijeForm.btw_tarief}
                    onChange={e => { const nb=e.target.value; setVrijeForm((f: any) => { if(vrijeTotInclBtw&&vrijeBrutoStr){const n=String((Number(vrijeBrutoStr)/(1+Number(nb)/100)).toFixed(2));return{...f,btw_tarief:Number(nb),netto:n};}return{...f,btw_tarief:Number(nb)}; }); }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none w-full">
                    <option value={0}>0%</option>
                    <option value={9}>9%</option>
                    <option value={21}>21%</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {editingVrijeIdx !== null && (
                  <Btn v="secondary" onClick={() => {setEditingVrijeIdx(null);setVrijeForm(emptyVrije)}}>{t('btn_cancel')}</Btn>
                )}
                <Btn onClick={voegVrijeToe}>{editingVrijeIdx !== null ? t('btn_update') : t('btn_add_rule')}</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Gecombineerde productenlijst */}
        {(productLijst.length > 0 || verpakkingLijst.length > 0 || vrijeList.length > 0) && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('modal_added_products')} ({productLijst.length + verpakkingLijst.length + vrijeList.length})</p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('log_ingredient')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('lbl_quantity')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('lbl_lot')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('lbl_price_per_unit')}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t('lbl_totaal_ex_btw')}</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {productLijst.map((p: any, i: number) => (
                    <tr key={p._id} title={t('title_click_edit')} className={`cursor-pointer transition-colors ${editingProductIdx===i ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-white hover:bg-gray-50'}`}
                      onClick={() => {setProductForm({...p});setProductTotInclBtw(false);setProductBrutoStr('');setTab('ingredienten');setEditingProductIdx(i);}}>
                      <td className="px-3 py-2 font-medium">{p._naam}</td>
                      <td className="px-3 py-2">{p.qty} {p.eenh}</td>
                      <td className="px-3 py-2 text-gray-500">{p.lotnr||'—'}</td>
                      <td className="px-3 py-2 text-gray-500">{p.prijs?`€${p.prijs}`:'—'}</td>
                      <td className="px-3 py-2 text-gray-500">{p.totaalprijs?`€${p.totaalprijs}`:'—'}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={e => {e.stopPropagation();setProductLijst((prev: any) => prev.filter((_: any,j: number)=>j!==i));}}
                          className="text-red-400 hover:text-red-600 text-xs font-medium">✕</button>
                      </td>
                    </tr>
                  ))}
                  {verpakkingLijst.map((v: any, i: number) => (
                    <tr key={v._id} title={t('title_click_edit')} className={`cursor-pointer transition-colors ${editingVerpakkingIdx===i ? 'ring-1 ring-amber-300 bg-amber-50' : 'bg-blue-50 hover:bg-blue-100'}`}
                      onClick={() => {setVOntvForm({...v});setVerpakTotInclBtw(false);setVerpakBrutoStr('');setTab('verpakkingen');setEditingVerpakkingIdx(i);}}>
                      <td className="px-3 py-2 font-medium">{v._naam} <span className="text-xs text-blue-400">{t('lbl_tag_verpakking')}</span></td>
                      <td className="px-3 py-2">{v.aantal} {t('unit_stuks')}</td>
                      <td className="px-3 py-2 text-gray-500">{v.lotnr||'—'}</td>
                      <td className="px-3 py-2 text-gray-500">{v.prijs_per_stuk?`€${v.prijs_per_stuk}`:'—'}</td>
                      <td className="px-3 py-2 text-gray-500">{v.totaalprijs?`€${v.totaalprijs}`:'—'}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={e => {e.stopPropagation();setVerpakkingLijst((prev: any) => prev.filter((_: any,j: number)=>j!==i));}}
                          className="text-red-400 hover:text-red-600 text-xs font-medium">✕</button>
                      </td>
                    </tr>
                  ))}
                  {vrijeList.map((r: any, i: number) => (
                    <tr key={r._id} title={t('title_click_edit')} className={`cursor-pointer transition-colors ${editingVrijeIdx===i ? 'ring-1 ring-amber-300 bg-amber-50' : 'bg-yellow-50 hover:bg-yellow-100'}`}
                      onClick={() => {setVrijeForm({naam:r.naam,netto:r.netto,btw_tarief:r.btw_tarief,kostensoort:r.kostensoort||'Overig'});setTab('vrije');setEditingVrijeIdx(i);}}>
                      <td className="px-3 py-2 font-medium">{r.naam} <span className="text-xs text-yellow-600">{t('lbl_tag_vrij')}</span>{r.kostensoort && r.kostensoort !== 'Overig' && <span className="ml-1 text-xs text-gray-400">{BUILTIN_KOSTEN_SOORTEN.includes(r.kostensoort) ? t('ks_'+r.kostensoort.toLowerCase()) : r.kostensoort}</span>}</td>
                      <td className="px-3 py-2 text-gray-400">—</td>
                      <td className="px-3 py-2 text-gray-400">—</td>
                      <td className="px-3 py-2 text-gray-400">—</td>
                      <td className="px-3 py-2 text-gray-500">€{parseFloat(r.netto).toFixed(2)}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={e => {e.stopPropagation();setVrijeList((prev: any) => prev.filter((_: any,j: number)=>j!==i));}}
                          className="text-red-400 hover:text-red-600 text-xs font-medium">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totalen */}
        {(productLijst.length > 0 || verpakkingLijst.length > 0 || vrijeList.length > 0) && (
          <div className="bg-gray-50 rounded-xl p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 whitespace-nowrap">{t('lbl_netto_excl_btw')}</span>
                <input type="number" step="0.01"
                  value={manualNetto !== null ? manualNetto : totaalNetto.toFixed(2)}
                  onChange={e => setManualNetto(e.target.value)}
                  className="w-28 text-right border border-gray-200 rounded px-2 py-0.5 text-sm font-semibold text-gray-800 bg-white focus:outline-none focus:border-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-gray-500 whitespace-nowrap">{t('lbl_btw')}</span>
                  {btwTarieven.length > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {btwTarieven.map(([k,v]) => <span key={k} className="mr-2">{k}%: €{(v as number).toFixed(2)}</span>)}
                    </div>
                  )}
                </div>
                <input type="number" step="0.01"
                  value={manualBtw !== null ? manualBtw : totaalBtw.toFixed(2)}
                  onChange={e => setManualBtw(e.target.value)}
                  className="w-28 text-right border border-gray-200 rounded px-2 py-0.5 text-sm font-semibold text-blue-700 bg-white focus:outline-none focus:border-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 whitespace-nowrap">{t('lbl_totaal_incl_btw')}</span>
                <input type="number" step="0.01"
                  value={manualBruto !== null ? manualBruto : (totaalNetto+totaalBtw).toFixed(2)}
                  onChange={e => setManualBruto(e.target.value)}
                  className="w-28 text-right border border-gray-200 rounded px-2 py-0.5 text-sm font-bold text-gray-900 bg-white focus:outline-none focus:border-amber-400" />
                {(manualNetto!==null||manualBtw!==null||manualBruto!==null) && (
                  <button type="button" title={t('title_herbereken')}
                    onClick={() => {setManualNetto(null);setManualBtw(null);setManualBruto(null);}}
                    className="text-sm text-gray-400 hover:text-amber-600 transition-colors">↺</button>
                )}
              </div>
            </div>
            {(manualNetto!==null||manualBtw!==null||manualBruto!==null) && (
              <p className="text-xs text-amber-600 mt-1.5">{t('msg_manual_adjusted')}</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-1">
          <span className="text-sm text-gray-500">{t('modal_products_ready').replace('{n}', String(productLijst.length + verpakkingLijst.length))}</span>
          <div className="flex gap-2">
            <Btn v="secondary" onClick={onClose}>{t('btn_cancel')}</Btn>
            <Btn onClick={handleSave} disabled={uploading}>{uploading ? t('btn_uploading') : initialData ? t('btn_save_changes') : t('btn_save')}</Btn>
          </div>
        </div>
      </div>
      </div>
    </Modal>
  )
}

export default InkoopFactuurModal
