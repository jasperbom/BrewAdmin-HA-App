import React, { useState, useMemo } from 'react'
import { t } from '../i18n'
import { tod, fmt, fmtD } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Sel from '../components/ui/Sel'
import SectionHeader from '../components/ui/SectionHeader'
import FilterBalk from '../components/ui/FilterBalk'
import LegeStaat from '../components/ui/LegeStaat'
import ResponsiveLijst, { type LijstKolom } from '../components/ui/ResponsiveLijst'
import Melding from './admin/voorraad/Melding'
import { logAudit } from '../utils/audit'
import { accijnsMaandGesloten } from '../utils/calculations'
import { accijnsWaardeVoorraad } from '../utils/agp'
import { bouwAfboekingAccijnsRecord } from '../utils/afboeking'
import {
  bierBeschikbaarPerAfvulling, verouderdeTellingen, herijkTelling,
  filterInventarisaties, telInventarisatieStatussen, filterTellingen, tellingSamenvatting, heeftVerschil,
  type InventarisatieStatusFilter, type InventarisatieTypeFilter, type InventarisatieType,
} from '../utils/inventarisatie'

// ── Voorraad › Tellingen ────────────────────────────────────────────────────
// De inventarisatie: tellen, vergelijken met de administratie en het verschil
// terugboeken. De lijst heeft een status-, type- en zoekfilter; in een
// telling kun je alleen de verschillen tonen en zoeken. Met "Correcties
// doorvoeren" moet elk verschil een verklaring hebben voordat de telling
// afgerond kan worden. De accijnsimpact rekent met `accijnsWaardeVoorraad`
// (de voorcalculatie van de afvulling, anders geschat op het tarief van
// vandaag) — dezelfde waardering als de AGP-stand en het verloop. Hoe een
// verschil geboekt wordt (lot, afboeking, accijnsrecord) is ongewijzigd.

interface InventarisatieTelling {
  id: number
  ref_type: 'lot' | 'afvulling'
  ref_id: number
  naam?: string
  administratief: number
  geteld: number
  verschil: number
  verklaring?: string
  eenheid?: string
  voorcalc_accijns_per_eenheid?: number
  accijns_impact?: number
  accijns_bron?: 'voorcalc' | 'geschat'
  // Zelf ingevuld (en niet de voorgevulde administratieve stand)?
  geteld_ingevoerd?: boolean
}

interface Inventarisatie {
  id: number
  datum: string
  type: InventarisatieType
  status: 'open' | 'afgerond'
  tellingen: InventarisatieTelling[]
  opmerkingen?: string
}

export interface InventarisatiePageProps {
  lots: any[]
  ing: any[]
  av: any[]
  bat: any[]
  uit: any[]
  afboekingen: any[]
  setAfboekingen?: any
  acc?: any[]
  setAcc?: any
  accijnsAangiftes?: any[]
  bestellingPicks: any[]
  bestellingen: any[]
  inventarisaties: Inventarisatie[]
  setInventarisaties: any
  setLots: any
  log: any[]
  setLog: any
  auditLog?: any[]
  setAuditLog?: any
  accijnsInst?: any
}

type RegelFilter = 'alle' | 'verschillen'

const INVOER = 'border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white t-input outline-none shadow-sm min-h-tap sm:min-h-0'

const InventarisatiePage: React.FC<InventarisatiePageProps> = ({
  lots, ing, av, bat, uit, afboekingen, setAfboekingen = (() => {}),
  acc = [], setAcc = (() => {}), accijnsAangiftes = [], bestellingPicks, bestellingen,
  inventarisaties, setInventarisaties, setLots, log, setLog, accijnsInst,
  auditLog = [], setAuditLog = (() => {})
}) => {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected: Inventarisatie | null = useMemo(
    () => (selectedId == null ? null : (inventarisaties || []).find(i => i.id === selectedId) || null),
    [inventarisaties, selectedId])
  const [showNew, setShowNew] = useState(false)
  const [newType, setNewType] = useState<InventarisatieType>('ingredienten')
  const [correcties, setCorrecties] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)
  const [fout, setFout] = useState('')
  // In een telling: alleen verschillen en/of zoeken; verklaringen die nog
  // ontbreken krijgen een rode rand zodra afronden daarop stuit.
  const [regelFilter, setRegelFilterRuw] = useState<RegelFilter>('alle')
  // De regels met een verschil op het moment dat het filter aanging: die
  // blijven staan als je er het aantal corrigeert (utils/inventarisatie.ts).
  const [verschilIds, setVerschilIds] = useState<Set<number> | null>(null)
  const [regelZoek, setRegelZoek] = useState('')
  const [markeerOntbrekend, setMarkeerOntbrekend] = useState(false)
  // In de lijst.
  const [lijstStatus, setLijstStatus] = useState<InventarisatieStatusFilter>('alle')
  const [lijstType, setLijstType] = useState<InventarisatieTypeFilter>('alle')
  const [lijstZoek, setLijstZoek] = useState('')

  const addLog = (entry: any) => setLog((prev: any[]) => [...prev, { id: newId(prev || []), datum: tod(), ...entry }])

  const setRegelFilter = (f: RegelFilter) => {
    setRegelFilterRuw(f)
    setVerschilIds(f === 'verschillen' && selected
      ? new Set(selected.tellingen.filter(tel => heeftVerschil(tel)).map(tel => tel.id))
      : null)
  }

  const openTelling = (id: number | null) => {
    setSelectedId(id)
    setRegelFilterRuw('alle')
    setVerschilIds(null)
    setRegelZoek('')
    setMarkeerOntbrekend(false)
    setFout('')
    setShowConfirm(false)
  }

  // Beschikbare biervoorraad per afvulling (utils/inventarisatie.ts)
  const afvullingBeschikbaar = useMemo(
    () => bierBeschikbaarPerAfvulling(av, uit, afboekingen, bestellingPicks, bestellingen),
    [av, uit, afboekingen, bestellingPicks, bestellingen]
  )

  // Regels waarvan de administratie sinds het aanmaken is veranderd (verkoop,
  // uitslag, afboeking, lotverbruik). Die mogen niet tegen de bevroren stand
  // afgerond worden: dan boekt de app dezelfde mutatie nog eens als verschil.
  const verouderd = useMemo(
    () => selected && selected.status === 'open'
      ? verouderdeTellingen(selected.tellingen, afvullingBeschikbaar, lots)
      : [],
    [selected, afvullingBeschikbaar, lots]
  )

  const buildIngredientTellingen = (): InventarisatieTelling[] => {
    const activeLots = lots.filter((l: any) => l.beschikbaar && Number(l.hoeveelheid || 0) > 0)
    return activeLots.map((l: any, i: number) => {
      const ingredient = (ing || []).find((ig: any) => ig.id === l.ingredient_id)
      const qty = Number(l.hoeveelheid || 0)
      return {
        id: i + 1,
        ref_type: 'lot' as const,
        ref_id: l.id,
        naam: `${ingredient?.naam || '?'} — ${l.lotnr || l.lotnummer || '?'}`,
        administratief: qty,
        geteld: qty,
        verschil: 0,
        eenheid: l.eenheid || 'kg',
      }
    })
  }

  const buildBierTellingen = (offset: number): InventarisatieTelling[] => {
    return av
      .filter((a: any) => (afvullingBeschikbaar[a.id] || 0) > 0)
      .map((a: any, i: number) => {
        const batch = (bat || []).find((b: any) => b.id === a.batch_id)
        const qty = afvullingBeschikbaar[a.id] || 0
        // Accijns per eenheid (Douane v2.4 §7.3): bij een verschil tonen we
        // meteen de financiële impact. Eén waardering voor de hele voorraad.
        const waarde = accijnsWaardeVoorraad(a, batch, 1, accijnsInst)
        return {
          id: offset + i + 1,
          ref_type: 'afvulling' as const,
          ref_id: a.id,
          naam: `${batch?.naam || '?'} — ${a.verpakking_naam || a.verpakking_type || '?'}`,
          administratief: qty,
          geteld: qty,
          verschil: 0,
          eenheid: 'stuks',
          voorcalc_accijns_per_eenheid: waarde.perEenheid,
          accijns_bron: waarde.bron,
          accijns_impact: 0,
        }
      })
  }

  const createInventarisatie = () => {
    let tellingen: InventarisatieTelling[] = []
    if (newType === 'ingredienten' || newType === 'volledig') tellingen = buildIngredientTellingen()
    if (newType === 'bier' || newType === 'volledig') tellingen = [...tellingen, ...buildBierTellingen(tellingen.length)]

    const inv: Inventarisatie = {
      id: newId(inventarisaties || []),
      datum: tod(),
      type: newType,
      status: 'open',
      tellingen,
    }
    setInventarisaties((prev: Inventarisatie[]) => [...(prev || []), inv])
    logAudit(auditLog, setAuditLog, {entiteit:'Inventarisatie', entiteit_id:inv.id, actie:'aangemaakt', omschrijving:`${inv.type} — ${inv.datum}`})
    setShowNew(false)
    openTelling(inv.id)
  }

  // Eén inventarisatie bijwerken op de verse stand (niet op een kopie).
  const werkBij = (id: number, fn: (inv: Inventarisatie) => Inventarisatie) =>
    setInventarisaties((prev: Inventarisatie[]) => (prev || []).map(inv => inv.id === id ? fn(inv) : inv))

  const updateTelling = (tellingId: number, field: 'geteld' | 'verklaring', value: any) => {
    if (!selected) return
    werkBij(selected.id, inv => ({
      ...inv,
      tellingen: inv.tellingen.map(tel => {
        if (tel.id !== tellingId) return tel
        if (field === 'geteld') {
          const geteld = value === '' ? 0 : Number(value)
          const verschil = geteld - tel.administratief
          // Accijnsimpact (Douane v2.4 §7.3): verschil × accijns per eenheid.
          // Negatief = tekort = potentiële vermisaccijns; positief = overschot.
          const accijns_impact = (tel.voorcalc_accijns_per_eenheid || 0) * verschil
          return { ...tel, geteld, verschil, accijns_impact, geteld_ingevoerd: true }
        }
        return { ...tel, [field]: value }
      }),
    }))
  }

  const updateOpmerkingen = (value: string) => {
    if (!selected) return
    werkBij(selected.id, inv => ({ ...inv, opmerkingen: value }))
  }

  // Zet de bevroren administratieve stand van de verouderde regels op de
  // actuele. De gebruiker controleert daarna de tellingen en rondt opnieuw af.
  const herijken = () => {
    if (!selected || verouderd.length === 0) return
    const actueel = new Map(verouderd.map(v => [v.tellingId, v.actueel]))
    werkBij(selected.id, inv => ({
      ...inv,
      tellingen: inv.tellingen.map(tel =>
        actueel.has(tel.id) ? herijkTelling(tel, actueel.get(tel.id) as number) : tel),
    }))
    logAudit(auditLog, setAuditLog, {entiteit:'Inventarisatie', entiteit_id:selected.id, actie:'gewijzigd',
      omschrijving: verouderd.map(v => `${v.naam || v.tellingId}: ${v.bevroren} → ${v.actueel}`).join('; ')})
    setShowConfirm(false)
  }

  const samenvatting = useMemo(() => tellingSamenvatting(selected?.tellingen || []), [selected])

  // Waarom afronden (nu) niet kan, of '' als het mag.
  const afrondBlokkade = (): string => {
    if (!selected || !correcties) return ''
    if (samenvatting.zonderVerklaring > 0) return t('vrd_inv_err_verklaring').replace('{n}', String(samenvatting.zonderVerklaring))
    // Periode-lock (ERP-plan 0.4): een geteld biertekort boekt accijns in de
    // lopende maand — geblokkeerd zodra die aangifte is ingediend of betaald.
    if (selected.tellingen.some(tel => tel.ref_type === 'afvulling' && tel.verschil < 0)
        && accijnsMaandGesloten(tod(), accijnsAangiftes)) return t('err_accijns_maand_gesloten_boeking')
    return ''
  }

  const vraagAfronden = () => {
    const reden = afrondBlokkade()
    if (reden) {
      setFout(reden)
      if (samenvatting.zonderVerklaring > 0) { setMarkeerOntbrekend(true); setRegelFilter('verschillen') }
      return
    }
    setFout('')
    setShowConfirm(true)
  }

  const afronden = () => {
    if (!selected) return

    // Een verouderde administratieve stand zou tussentijdse verkopen,
    // uitslagen en afboekingen nog eens als telverschil boeken (met accijns).
    if (correcties && verouderd.length > 0) return
    const reden = afrondBlokkade()
    if (reden) { setShowConfirm(false); setFout(reden); return }

    if (correcties) {
      const nieuweAfboekingen: any[] = []
      const nieuweAccijns: any[] = []
      let abId = newId(afboekingen || [])
      let accId = newId(acc || [])
      for (const tel of selected.tellingen) {
        if (tel.verschil !== 0 && tel.ref_type === 'lot') {
          setLots((prev: any[]) => prev.map((l: any) =>
            l.id !== tel.ref_id ? l : { ...l, hoeveelheid: tel.geteld, beschikbaar: tel.geteld > 0 }
          ))
          addLog({
            type: 'inventarisatie',
            omschrijving: `Inventarisatie correctie: ${tel.naam} ${tel.administratief} → ${tel.geteld} ${tel.eenheid || ''}`.trim(),
            hoeveelheid: tel.verschil,
            eenheid: tel.eenheid || '',
            referentie: `Inventarisatie #${selected.id}`,
          })
        }
        // Bier-telverschillen ook echt terugboeken (ERP-plan 0.7): een tekort
        // wordt een afboeking (vermis), een overschot een negatieve afboeking
        // (bijboeking, reden overig).
        if (tel.verschil !== 0 && tel.ref_type === 'afvulling') {
          const a = (av || []).find((x: any) => x.id === tel.ref_id)
          const afboeking: any = {
            id: abId++,
            afvulling_id: tel.ref_id,
            batch_id: a?.batch_id ?? null,
            datum: tod(),
            aantal: -tel.verschil,
            reden: tel.verschil < 0 ? 'vermis' : 'overig',
            opmerking: t('inv_bier_afboek_oms')
              .replace('{id}', String(selected.id))
              .replace('{van}', String(tel.administratief))
              .replace('{naar}', String(tel.geteld))
              + (tel.verklaring ? ` — ${tel.verklaring}` : ''),
            created_at: new Date().toISOString(),
            voorcalc_accijns_per_eenheid: tel.voorcalc_accijns_per_eenheid || 0,
            voorcalc_accijns_totaal: Math.round(Math.abs(tel.verschil) * (tel.voorcalc_accijns_per_eenheid || 0) * 100) / 100,
          }
          // Een geteld tekort is een vermissing: accijns wordt verschuldigd en
          // hoort in de maandaangifte. Een overschot (reden 'overig') niet.
          const accRecord = bouwAfboekingAccijnsRecord(
            afboeking, a, (bat || []).find((b: any) => b.id === afboeking.batch_id), accijnsInst, accId++
          )
          if (accRecord) {
            afboeking.accijns_record_id = accRecord.id
            nieuweAccijns.push(accRecord)
          }
          nieuweAfboekingen.push(afboeking)
          addLog({
            type: 'inventarisatie',
            omschrijving: `${tel.naam}: ${tel.administratief} → ${tel.geteld} stuks`,
            hoeveelheid: tel.verschil,
            eenheid: 'stuks',
            referentie: `Inventarisatie #${selected.id}`,
          })
        }
      }
      if (nieuweAfboekingen.length > 0) setAfboekingen((prev: any[]) => [...(prev || []), ...nieuweAfboekingen])
      if (nieuweAccijns.length > 0) setAcc((prev: any[]) => [...(prev || []), ...nieuweAccijns])
    }

    werkBij(selected.id, inv => ({ ...inv, status: 'afgerond' }))
    logAudit(auditLog, setAuditLog, {entiteit:'Inventarisatie', entiteit_id:selected.id, actie:'gewijzigd', omschrijving:`Afgerond: ${selected.type}`})
    setShowConfirm(false)
    setFout('')
  }

  const countDiffs = (inv: Inventarisatie) => inv.tellingen.filter(tel => heeftVerschil(tel)).length

  const typeLabel = (tp: string) => {
    if (tp === 'ingredienten') return t('inv_type_ingredienten')
    if (tp === 'bier') return t('inv_type_bier')
    return t('inv_type_volledig')
  }

  const statusBadge = (s: 'open' | 'afgerond') => (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${s === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
      {s === 'open' ? t('inv_status_open') : t('inv_status_afgerond')}
    </span>
  )
  const verschilBadge = (n: number) => n > 0
    ? <span className="text-xs font-medium bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full whitespace-nowrap">{t('vrd_inv_n_verschillen').replace('{n}', String(n))}</span>
    : null

  // ── Detail: één telling ────────────────────────────────────────────────
  if (selected) {
    const isOpen = selected.status === 'open'
    const regels = filterTellingen(selected.tellingen, { alleenVerschillen: regelFilter === 'verschillen', zoek: regelZoek, blijfZichtbaar: verschilIds })
    const nVerschillen = countDiffs(selected)
    const saldo = samenvatting.overschotAccijns - samenvatting.tekortAccijns
    const ontbreekt = (tel: InventarisatieTelling) =>
      markeerOntbrekend && correcties && heeftVerschil(tel) && !String(tel.verklaring || '').trim()

    const rijKleur = (tel: InventarisatieTelling) => {
      if (!heeftVerschil(tel)) return ''
      const pct = tel.administratief !== 0 ? Math.abs(tel.verschil / tel.administratief) * 100 : 100
      return pct <= 10 ? 'bg-yellow-50' : 'bg-red-50'
    }
    const verschilTekst = (tel: InventarisatieTelling) => (
      <span className={`font-medium tabular-nums ${!heeftVerschil(tel) ? 'text-green-600' : tel.verschil > 0 ? 'text-blue-600' : 'text-red-600'}`}>
        {tel.verschil > 0 ? '+' : ''}{tel.verschil}
      </span>
    )
    const impactTekst = (tel: InventarisatieTelling) => {
      if (tel.ref_type !== 'afvulling' || !(Number(tel.voorcalc_accijns_per_eenheid || 0) > 0)) {
        return <span className="text-gray-400 text-xs">{t('vrd_nvt')}</span>
      }
      const impact = tel.accijns_impact || 0
      return (
        <span className={`font-medium tabular-nums ${impact === 0 ? 'text-gray-400' : impact > 0 ? 'text-blue-700' : 'text-red-700'}`}
          title={`${fmt(Number(tel.voorcalc_accijns_per_eenheid))} ${t('gpa_per_eenheid')}`}>
          {impact === 0 ? '—' : `${impact > 0 ? '+' : '−'}${fmt(Math.abs(impact))}`}
          {impact !== 0 && tel.accijns_bron === 'geschat' && <span className="ml-1 text-xs font-normal text-gray-500">({t('agp_geschat')})</span>}
        </span>
      )
    }
    const getelInvoer = (tel: InventarisatieTelling) => isOpen ? (
      <input
        type="number"
        inputMode="decimal"
        value={tel.geteld}
        onChange={e => updateTelling(tel.id, 'geteld', e.target.value)}
        aria-label={`${t('inv_geteld')}: ${tel.naam || ''}`}
        className={`w-24 ${INVOER}`}
        min={0}
        step="any"
      />
    ) : <span className="tabular-nums">{tel.geteld}</span>
    const verklaringInvoer = (tel: InventarisatieTelling) => isOpen && heeftVerschil(tel) ? (
      <input
        type="text"
        value={tel.verklaring || ''}
        onChange={e => updateTelling(tel.id, 'verklaring', e.target.value)}
        placeholder={t('inv_verklaring_verplicht')}
        aria-label={`${t('inv_verklaring')}: ${tel.naam || ''}`}
        aria-invalid={ontbreekt(tel) || undefined}
        className={`w-full min-w-0 ${INVOER} ${ontbreekt(tel) ? 'border-red-400 ring-1 ring-red-300' : ''}`}
      />
    ) : <span className="text-gray-500 break-words">{tel.verklaring || (heeftVerschil(tel) ? '—' : '')}</span>

    const kolommen: LijstKolom<InventarisatieTelling>[] = [
      { id: 'item', kop: t('inv_col_item'), cel: tel => <span className="font-medium text-gray-800">{tel.naam}{tel.eenheid && <span className="text-gray-400 text-xs ml-1">({tel.eenheid})</span>}</span> },
      { id: 'adm', kop: t('inv_administratief'), rechts: true, cel: tel => <span className="text-gray-600">{tel.administratief}</span> },
      { id: 'geteld', kop: t('inv_geteld'), cel: getelInvoer },
      { id: 'verschil', kop: t('inv_verschil'), rechts: true, cel: verschilTekst },
      { id: 'impact', kop: <span title={t('lbl_accijnsimpact_tip')}>{t('lbl_accijnsimpact')}</span>, rechts: true, cel: impactTekst },
      { id: 'verklaring', kop: t('inv_verklaring'), klasse: 'min-w-[12rem]', cel: verklaringInvoer },
    ]
    const kaart = (tel: InventarisatieTelling) => (
      <div className="min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{tel.naam}{tel.eenheid && <span className="text-gray-400 text-xs font-normal ml-1">({tel.eenheid})</span>}</span>
          {verschilTekst(tel)}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>{t('inv_administratief')}: <span className="tabular-nums text-gray-700">{tel.administratief}</span></span>
          <span>{t('lbl_accijnsimpact')}: {impactTekst(tel)}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span className="w-20 flex-shrink-0">{t('inv_geteld')}</span>
          {getelInvoer(tel)}
        </label>
        {(isOpen && heeftVerschil(tel)) || tel.verklaring ? <div>{verklaringInvoer(tel)}</div> : null}
      </div>
    )

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Btn v="secondary" s="sm" onClick={() => openTelling(null)}>← {t('nav_terug')}</Btn>
          <h2 className="text-lg font-semibold text-gray-900">{t('inv_titel')} #{selected.id}</h2>
          {statusBadge(selected.status)}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 flex gap-x-6 gap-y-1 flex-wrap text-sm text-gray-600">
          <div><span className="font-medium text-gray-500">{t('lbl_date')}:</span> {fmtD(selected.datum)}</div>
          <div><span className="font-medium text-gray-500">{t('lbl_type')}:</span> {typeLabel(selected.type)}</div>
          <div><span className="font-medium text-gray-500">{t('inv_verschil')}:</span> {nVerschillen} {t('lbl_items')}</div>
        </div>

        <FilterBalk<RegelFilter>
          zoek={regelZoek} onZoek={setRegelZoek} zoekPlaceholder={t('vrd_inv_zoek_regels')}
          status={{
            chips: [
              { id: 'alle', label: t('vrd_inv_alle_regels'), aantal: selected.tellingen.length },
              { id: 'verschillen', label: t('vrd_inv_alleen_verschillen'), aantal: nVerschillen, nadruk: markeerOntbrekend },
            ],
            waarde: regelFilter, onKies: setRegelFilter, label: t('vrd_inv_regels_label'),
          }}
        />

        <section className="space-y-2">
          <SectionHeader rounded="full" title={t('vrd_inv_regels')} info={regels.length} />
          <ResponsiveLijst
            rijen={regels}
            sleutel={tel => tel.id}
            kolommen={kolommen}
            kaart={kaart}
            rijKlasse={rijKleur}
            label={t('vrd_inv_regels')}
            leeg={<LegeStaat titel={t('lege_staat_niets')} tekst={regelFilter === 'verschillen' ? t('vrd_inv_geen_verschillen') : undefined} />}
          />
          {/* Totaal accijnsimpact (Douane v2.4 §7.3 stap 6) */}
          {(samenvatting.tekortAccijns > 0 || samenvatting.overschotAccijns > 0) && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">{t('inv_tekort_label')}</div>
                <div className="font-semibold text-red-700 tabular-nums">{fmt(samenvatting.tekortAccijns)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t('inv_tekort_sub')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('inv_overschot_label')}</div>
                <div className="font-semibold text-blue-700 tabular-nums">{fmt(samenvatting.overschotAccijns)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t('inv_overschot_sub')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('inv_saldo_label')}</div>
                <div className={`font-semibold tabular-nums ${saldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {saldo < 0 ? '−' : ''}{fmt(Math.abs(saldo))}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label htmlFor="inv-opmerkingen" className="block text-sm font-medium text-gray-700 mb-1">{t('inv_opmerkingen')}</label>
          {isOpen ? (
            <textarea
              id="inv-opmerkingen"
              value={selected.opmerkingen || ''}
              onChange={e => updateOpmerkingen(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm"
            />
          ) : (
            <p className="text-sm text-gray-600">{selected.opmerkingen || '—'}</p>
          )}
        </div>

        {isOpen && (
          <div className="space-y-2">
            {fout && <Melding tekst={fout} onSluit={() => setFout('')} />}
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer min-h-tap sm:min-h-0">
                <input type="checkbox" checked={correcties} onChange={e => { setCorrecties(e.target.checked); setFout('') }} className="rounded t-checkbox w-4 h-4" />
                {t('inv_correcties_doorvoeren')}
              </label>
              <Btn v="green" onClick={vraagAfronden}>{t('inv_afronden')}</Btn>
              {correcties && samenvatting.zonderVerklaring > 0 && !fout && (
                <span className="text-xs text-orange-700">{t('vrd_inv_hint_verklaring').replace('{n}', String(samenvatting.zonderVerklaring))}</span>
              )}
            </div>
          </div>
        )}

        {showConfirm && (
          <Modal title={t('inv_afronden')} onClose={() => setShowConfirm(false)}>
            <p className="text-sm text-gray-600 mb-4">{t('inv_bevestig_afronden')}</p>
            {correcties && (
              <div className="text-sm text-gray-800 mb-4 space-y-1">
                <p className="font-medium">{t('inv_correcties_doorvoeren')}:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>{t('vrd_inv_sam_grondstof').replace('{n}', String(samenvatting.lotVerschillen))}</li>
                  <li>{t('vrd_inv_sam_bier').replace('{n}', String(samenvatting.bierVerschillen))}</li>
                  {samenvatting.tekortAccijns > 0 && <li>{t('vrd_inv_sam_accijns').replace('{bedrag}', fmt(samenvatting.tekortAccijns))}</li>}
                </ul>
              </div>
            )}
            {correcties && verouderd.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-sm text-orange-800 space-y-2">
                <p>{t('inv_err_verouderd').replace('{n}', String(verouderd.length))}</p>
                <ul className="text-xs space-y-0.5">
                  {verouderd.map(v => (
                    <li key={v.tellingId}>{v.naam || t('lbl_onbekend')}: {v.bevroren} → {v.actueel}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              <Btn v="secondary" onClick={() => setShowConfirm(false)}>{t('btn_cancel')}</Btn>
              {correcties && verouderd.length > 0
                ? <Btn onClick={herijken}>{t('inv_btn_herijken')}</Btn>
                : <Btn v="green" onClick={afronden}>{t('inv_afronden')}</Btn>}
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Lijst ───────────────────────────────────────────────────────────────
  const lijstFilter = { type: lijstType, zoek: lijstZoek }
  const tellen = telInventarisatieStatussen(inventarisaties, lijstFilter)
  const lijst = filterInventarisaties(inventarisaties, { ...lijstFilter, status: lijstStatus })
  const heeftTellingen = (inventarisaties || []).length > 0
  const nieuw = () => { setNewType('ingredienten'); setShowNew(true) }
  const nieuwKnop = <Btn onClick={nieuw} cls="whitespace-nowrap">+ {t('inv_nieuwe_telling')}</Btn>
  // Op de telefoon naast zoeken en Filter: alleen het plusteken.
  const nieuwKnopTelefoon = (
    <button type="button" onClick={nieuw} aria-label={t('inv_nieuwe_telling')} title={t('inv_nieuwe_telling')}
      className="tbtn flex-shrink-0 w-11 min-h-tap rounded-lg text-white text-xl font-semibold leading-none shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--t-accent)]">
      +
    </button>
  )
  const wisFilters = () => { setLijstZoek(''); setLijstType('alle'); setLijstStatus('alle') }

  const lijstKolommen: LijstKolom<Inventarisatie>[] = [
    { id: 'nr', kop: t('vrd_inv_kol_nr'), klasse: 'whitespace-nowrap', cel: inv => <span className="font-semibold text-gray-900">#{inv.id}</span> },
    { id: 'datum', kop: t('lbl_date'), klasse: 'whitespace-nowrap', cel: inv => <span className="text-gray-600">{fmtD(inv.datum)}</span> },
    { id: 'type', kop: t('lbl_type'), cel: inv => typeLabel(inv.type) },
    { id: 'regels', kop: t('vrd_inv_regels_kop'), rechts: true, cel: inv => inv.tellingen.length },
    { id: 'verschil', kop: t('inv_verschil'), cel: inv => verschilBadge(countDiffs(inv)) || <span className="text-gray-400">—</span> },
    { id: 'status', kop: t('lbl_status'), cel: inv => statusBadge(inv.status) },
  ]
  const lijstKaart = (inv: Inventarisatie) => (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">#{inv.id} · {typeLabel(inv.type)}</span>
        {statusBadge(inv.status)}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span>{fmtD(inv.datum)}</span>
        <span>{t('vrd_inv_n_regels').replace('{n}', String(inv.tellingen.length))}</span>
        {verschilBadge(countDiffs(inv))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {!heeftTellingen ? (
        <LegeStaat titel={t('inv_geen')} tekst={t('vrd_inv_leeg_tekst')}>{nieuwKnop}</LegeStaat>
      ) : (
        <>
          <FilterBalk<InventarisatieStatusFilter>
            zoek={lijstZoek} onZoek={setLijstZoek} zoekPlaceholder={t('vrd_inv_zoek')}
            status={{
              chips: [
                { id: 'alle', label: t('lbl_alle'), aantal: tellen.alle },
                { id: 'open', label: t('inv_status_open'), aantal: tellen.open },
                { id: 'afgerond', label: t('inv_status_afgerond'), aantal: tellen.afgerond },
              ],
              waarde: lijstStatus, onKies: setLijstStatus,
            }}
            extraActief={lijstType !== 'alle' ? 1 : 0}
            acties={nieuwKnop}
            actiesTelefoon={nieuwKnopTelefoon}
            onWis={wisFilters}
          >
            <Sel
              ariaLabel={t('lbl_type')}
              value={lijstType === 'alle' ? '' : lijstType}
              ph={t('vrd_inv_alle_typen')}
              onChange={(v: string) => setLijstType((v || 'alle') as InventarisatieTypeFilter)}
              opts={(['ingredienten', 'bier', 'volledig'] as const).map(tp => ({ v: tp, l: typeLabel(tp) }))}
            />
          </FilterBalk>
          <ResponsiveLijst
            rijen={lijst}
            sleutel={inv => inv.id}
            kolommen={lijstKolommen}
            kaart={lijstKaart}
            onKies={inv => openTelling(inv.id)}
            rijLabel={inv => `${t('inv_titel')} #${inv.id}, ${fmtD(inv.datum)}, ${typeLabel(inv.type)}`}
            label={t('inv_titel')}
            leeg={<LegeStaat titel={t('vrd_inv_geen_gevonden')}><Btn v="secondary" onClick={wisFilters}>{t('fb_wis')}</Btn></LegeStaat>}
          />
        </>
      )}

      {showNew && (
        <Modal title={t('inv_nieuwe_telling')} onClose={() => setShowNew(false)}>
          <div className="space-y-4">
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-2">{t('lbl_type')}</legend>
              <div className="flex flex-col gap-1">
                {(['ingredienten', 'bier', 'volledig'] as const).map(tp => (
                  <label key={tp} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 min-h-tap sm:min-h-[32px]">
                    <input
                      type="radio"
                      name="inv-type"
                      checked={newType === tp}
                      onChange={() => setNewType(tp)}
                      className="t-checkbox w-4 h-4"
                    />
                    {typeLabel(tp)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2 justify-end">
              <Btn v="secondary" onClick={() => setShowNew(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={createInventarisatie}>{t('inv_nieuwe_telling')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default InventarisatiePage
