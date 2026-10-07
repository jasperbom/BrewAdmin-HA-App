import React from 'react'
import { t } from '../i18n'
import { fmt, fmtD } from '../utils/format'
import { newId } from '../utils/api'
import Btn from '../components/ui/Btn'
import Badge from '../components/ui/Badge'
import SectionHeader from '../components/ui/SectionHeader'
import FilterBalk from '../components/ui/FilterBalk'
import LegeStaat from '../components/ui/LegeStaat'
import RowActions from '../components/ui/RowActions'
import ResponsiveLijst, { KAART_INTERACTIEF, type LijstKolom } from '../components/ui/ResponsiveLijst'
import { useUndo } from '../components/ui/UndoBar'
import { useGedeeldePeriode, useGedeeldBereik } from '../components/ui/useGedeeldePeriode'
import VerplaatsModal from '../components/VerplaatsModal'
import LocatiesModal, { type LocatieInvoer } from './admin/voorraad/LocatiesModal'
import Melding from './admin/voorraad/Melding'
import { logAudit } from '../utils/audit'
import {
  bouwVerplaatsing, valideerVerplaatsing, verplaatsingVerwijderBlokkade, VERPLAATS_FOUT_KEYS,
  accijnsWaardeVoorraad, somAccijnsWaarden, gemAgpWaardeInPeriode, uitgeslagenAccijnsStatus,
  filterVerplaatsingen, type AccijnsWaarde, type UitslagAccijnsOordeel,
} from '../utils/agp'
import { agpOverzicht, getAgpLocatie, voorraadPerLocatie, accijnsMaandGesloten, type AgpAfvullingRij, type AgpTankRij } from '../utils/calculations'
import { STANDAARD_PERIODE, lokaleDag } from '../utils/periode'
import { productNaam } from '../utils/product'
import { agpGereserveerdPerAfvulling } from '../utils/kassa'

// ── Voorraad › AGP-stand ────────────────────────────────────────────────────
// Wat er nu in de accijnsgoederenplaats ligt (tanks en verpakt), wat al is
// uitgeslagen en de verplaatsingen die dat deden. Twee tegels — liters en
// accijnswaarde — in plaats van vijf; de waardering komt uit één functie
// (`accijnsWaardeVoorraad`, utils/agp.ts) die ook het verloop en de tellingen
// gebruiken: de voorcalculatie van de afvulling, anders geschat op het tarief
// van vandaag. Boeken gebeurt zoals altijd via `bouwVerplaatsing`.

export interface AgpPageProps {
  bat: any[]
  av: any[]
  uit: any[]
  acc: any[]
  setAcc: (fn: (prev: any[]) => any[]) => void
  producten?: any[]
  locaties: any[]
  setLocaties: (fn: (prev: any[]) => any[]) => void
  verplaatsingen: any[]
  setVerplaatsingen: (fn: (prev: any[]) => any[]) => void
  afboekingen: any[]
  accijnsInst: any
  log: any[]
  setLog?: (fn: (prev: any[]) => any[]) => void
  auditLog: any[]
  setAuditLog: any
  accijnsAangiftes?: any[]
  verliezen?: any[]
  bestellingen?: any[]
  bestellingPicks?: any[]
}

/** Undo-id van een verplaatsing die op verwijderen staat. */
const VPL_UNDO = 'verplaatsing-'
/** Zoveel verplaatsingen tegelijk; "Toon meer" voegt er zoveel bij. */
const MUT_STAP = 20

const fmtL = (n: number): string =>
  `${(Number(n) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`

interface BuitenRij {
  sleutel: string
  rij: AgpAfvullingRij
  locId: number
  locNaam: string
  aantal: number
  status: UitslagAccijnsOordeel
}

interface VerpaktRij extends AgpAfvullingRij {
  waarde: AccijnsWaarde
}

const Tegel: React.FC<{ label: string; waarde: string; children?: React.ReactNode }> = ({ label, waarde, children }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4 min-w-0">
    <div className="text-sm text-gray-600">{label}</div>
    <div className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{waarde}</div>
    {children && <div className="mt-2 space-y-0.5 text-xs text-gray-500">{children}</div>}
  </div>
)

/** Bedrag met "geschat" erachter als het niet op de voorcalculatie rust. */
const AccijnsBedrag: React.FC<{ w: AccijnsWaarde }> = ({ w }) => (
  <span className="tabular-nums" title={`${fmt(w.perEenheid)} ${t('gpa_per_eenheid')}`}>
    <span className="font-semibold t-accent-text">{fmt(w.bedrag)}</span>
    {w.bron === 'geschat' && <span className="ml-1 text-xs font-normal text-gray-500">({t('agp_geschat')})</span>}
  </span>
)

const StatusBadge: React.FC<{ s: UitslagAccijnsOordeel }> = ({ s }) => {
  if (s.status === 'betaald') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">{t('agp_accijns_betaald')}</span>
  }
  if (s.status === 'openstaand') {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 whitespace-nowrap tabular-nums"
        title={t('vrd_accijns_open_tip')}>
        {t('vrd_accijns_open').replace('{bedrag}', fmt(s.open))}
      </span>
    )
  }
  return <span className="text-xs text-gray-400" title={t('vrd_accijns_geen_tip')}>—</span>
}

function AgpPage({
  bat, av, uit, acc, setAcc, producten = [], locaties, setLocaties, verplaatsingen, setVerplaatsingen,
  afboekingen, accijnsInst, log, setLog, auditLog, setAuditLog, accijnsAangiftes = [], verliezen = [],
  bestellingen = [], bestellingPicks = [],
}: AgpPageProps) {
  const { useState, useMemo } = React
  const undo = useUndo()
  const [fout, setFout] = useState('')
  const [mutFout, setMutFout] = useState('')

  // Wat op de AGP al voor een open bestelling gepickt is, mag niet via een
  // verplaatsing alsnog uitgeslagen worden — dezelfde regel als de
  // uitslagmodal (utils/kassa.ts, utils/agp.ts).
  const agpGereserveerd = useMemo(() => agpGereserveerdPerAfvulling(
    bestellingPicks || [], bestellingen || [], getAgpLocatie(locaties).id,
    {afvullingen: av || [], locaties: locaties || [], uit, verplaatsingen, afboekingen}),
    [bestellingPicks, bestellingen, av, locaties, uit, verplaatsingen, afboekingen])

  // De productnaam (etiket) per regel, niet de recept-/batchnaam: twee
  // afvullingen van dezelfde batch met verschillende etiketten zijn
  // verschillende producten. Zonder product de batchnaam.
  const bierNaam = (batch: any, afv?: any): string =>
    productNaam(afv, batch, producten) || t('lbl_onbekend')

  // De verliesposten (tankrest, schuim …) horen in het tankvolume, zowel in de
  // actuele stand als in de gemiddelden — anders rekenen tegel en gemiddelde
  // met verschillende regels.
  const ovz = useMemo(() => agpOverzicht(bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst, verliezen),
    [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst, verliezen])

  const agp = getAgpLocatie(locaties)
  const locById = (id: number) => (locaties || []).find((l: any) => l.id === id) || { id, naam: t('lbl_onbekend') }
  const batById = (id: number) => (bat || []).find((b: any) => b.id === id)

  // ── Waardering: één functie voor alles wat verpakt in de AGP ligt ─────────
  const verpaktRijen: VerpaktRij[] = useMemo(() => ovz.afvullingen
    .filter(r => r.in_agp > 0)
    .map(r => ({ ...r, waarde: accijnsWaardeVoorraad(r.afv, r.batch, r.in_agp, accijnsInst) })),
  [ovz, accijnsInst])
  const verpaktSom = useMemo(() => somAccijnsWaarden(verpaktRijen.map(r => r.waarde)), [verpaktRijen])
  const accijnsTotaal = ovz.totaal_accijns_tank + verpaktSom.bedrag
  const literTotaal = ovz.totaal_liter_tank + ovz.totaal_liter_agp

  // Gemiddelden met precies dezelfde waardering, per dag.
  const histAvg = useMemo(() => {
    const nu = new Date()
    const jaar = nu.getFullYear()
    const maand = nu.getMonth()
    const args = [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst, verliezen] as const
    const vorigeMaand = gemAgpWaardeInPeriode(lokaleDag(new Date(jaar, maand - 1, 1)), lokaleDag(new Date(jaar, maand, 0)), ...args)
    const ditJaar = gemAgpWaardeInPeriode(`${jaar}-01-01`, lokaleDag(nu), ...args)
    // In januari zegt "dit jaar" nog weinig: dan ook het hele vorige jaar.
    const vorigJaar = maand === 0 ? gemAgpWaardeInPeriode(`${jaar - 1}-01-01`, `${jaar - 1}-12-31`, ...args) : null
    return { vorigeMaand, ditJaar, vorigJaar, jaar }
  }, [bat, av, uit, verplaatsingen, afboekingen, locaties, accijnsInst, verliezen])

  // ── Uitgeslagen voorraad met de echte accijnsstatus ──────────────────────
  const buitenRijen: BuitenRij[] = useMemo(() => ovz.afvullingen
    .filter(r => r.buiten_agp > 0)
    .flatMap(r => Object.keys(r.voorraad)
      .map(Number)
      .filter(locId => locId !== agp.id && (r.voorraad[locId] || 0) > 0)
      .map(locId => ({
        sleutel: `${r.afv.id}-${locId}`,
        rij: r,
        locId,
        locNaam: locById(locId).naam,
        aantal: r.voorraad[locId],
        status: uitgeslagenAccijnsStatus(r.afv, locId, r.voorraad[locId], { locaties, verplaatsingen, accijns: acc }),
      }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [ovz, agp.id, locaties, verplaatsingen, acc])

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ tanks: true, agp: true, buiten: true, mut: false })
  const toggle = (k: string) => setOpenSec(s => ({ ...s, [k]: !s[k] }))

  // ── Verplaatsen ──────────────────────────────────────────────────────────
  const [vplModal, setVplModal] = useState<{ afv: any; vanLocatieId: number } | null>(null)
  const openVerplaats = (afv: any, fromId: number) => { setFout(''); setVplModal({ afv, vanLocatieId: fromId }) }

  // De records bouwt `utils/agp.ts` — dezelfde logica als op de productpagina,
  // zodat een uitslag daar identiek geboekt wordt.
  const saveVerplaats = (invoer: any) => {
    const afv = (av || []).find((a: any) => a.id === invoer.afvulling_id)
    const batch = batById(invoer.batch_id)
    const ctx = { afv, batch, locaties, uit, verplaatsingen, afboekingen, accijnsInst, accijnsAangiftes, gereserveerd: agpGereserveerd }
    // Tweede slot naast de modal: niets boeken in een al aangegeven
    // accijnsmaand, in de toekomst of op te weinig voorraad.
    const oordeel = valideerVerplaatsing(invoer, ctx)
    if (!oordeel.ok) {
      setVplModal(null)
      setFout(t(VERPLAATS_FOUT_KEYS[oordeel.fout!]).replace('{n}', String(oordeel.beschikbaar)).replace('{datum}', fmtD(afv?.datum)))
      return
    }
    const r = bouwVerplaatsing(invoer, ctx, {
      verplaatsing_id: newId(verplaatsingen || []),
      accijns_id: newId(acc || []),
      log_id: newId(log || []),
    }, { logTitel: t('agp_verplaats_titel') })

    setVerplaatsingen((prev: any[]) => [...(prev || []), r.verplaatsing])
    if (r.accijnsRecord) setAcc((prev: any[]) => [...(prev || []), r.accijnsRecord])
    // Een uitslag hoort ook in het voorraadverloop, naast verkoop-uitleveringen.
    if (r.logRegel && setLog) setLog((prev: any[]) => [...(prev || []), r.logRegel])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Verplaatsing', entiteit_id: r.verplaatsing.id, actie: 'aangemaakt',
      omschrijving: `${r.verplaatsing.aantal}× ${afv?.verpakking_naam || ''} (${batch?.naam || ''}): ${r.omschrijving}`,
    })
    setVplModal(null)
  }

  // ── Locaties ─────────────────────────────────────────────────────────────
  const [locOpen, setLocOpen] = useState(false)
  const heeftVoorraadOp = (id: number): boolean => (av || []).some((a: any) =>
    (voorraadPerLocatie(a, locaties, uit, verplaatsingen, afboekingen)[id] || 0) > 0)

  // Een locatie is geen bijzaak: `bron_locatie_id` stuurt zowel de voorraad
  // per locatie als de vraag of een afboeking accijnsplichtig is. Aanmaken,
  // hernoemen en verwijderen staan dus in het logboek.
  const saveLoc = (invoer: LocatieInvoer) => {
    if (invoer.id) {
      const vorige = locById(invoer.id)
      setLocaties((prev: any[]) => prev.map((l: any) => l.id === invoer.id ? { ...l, naam: invoer.naam, adres: invoer.adres || '', opmerking: invoer.opmerking || '' } : l))
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Locatie', entiteit_id: invoer.id, actie: 'gewijzigd',
        omschrijving: vorige?.naam && vorige.naam !== invoer.naam ? `${vorige.naam} → ${invoer.naam}` : invoer.naam,
      })
    } else {
      const id = newId(locaties || [])
      setLocaties((prev: any[]) => [...(prev || []), { id, naam: invoer.naam, is_agp: false, adres: invoer.adres || '', opmerking: invoer.opmerking || '' }])
      logAudit(auditLog, setAuditLog, { entiteit: 'Locatie', entiteit_id: id, actie: 'aangemaakt', omschrijving: invoer.naam })
    }
    setLocOpen(false)
  }

  const deleteLoc = (id: number) => {
    const loc = locById(id)
    // De modal heeft het al getoetst; hier het tweede slot.
    if ((loc as any)?.is_agp || heeftVoorraadOp(id)) return
    setLocaties((prev: any[]) => prev.filter((l: any) => l.id !== id))
    logAudit(auditLog, setAuditLog, { entiteit: 'Locatie', entiteit_id: id, actie: 'verwijderd', omschrijving: loc?.naam || '' })
  }

  // ── Verplaatsingen: gedeelde periode + zoeken, 20 tegelijk ───────────────
  const [periodeKeuze, setPeriodeKeuze, eigenPeriode, setEigenPeriode] = useGedeeldePeriode()
  const { bereik } = useGedeeldBereik()
  const [mutZoek, setMutZoek] = useState('')
  const [mutAantal, setMutAantal] = useState(MUT_STAP)
  React.useEffect(() => { setMutAantal(MUT_STAP) }, [mutZoek, bereik.van, bereik.tot])

  const undoId = undo.actie?.id || ''
  const wachtendId: number | null = undoId.startsWith(VPL_UNDO) ? Number(undoId.slice(VPL_UNDO.length)) : null

  const mutaties = useMemo(() => filterVerplaatsingen(
    (verplaatsingen || []).filter((v: any) => v.id !== wachtendId),
    bereik, mutZoek,
    (v: any) => {
      const afv = (av || []).find((a: any) => a.id === v.afvulling_id)
      const batch = batById(v.batch_id)
      return [productNaam(afv, batch, producten), batch?.naam, batch?.batch_nummer, afv?.verpakking_naam,
        locById(v.van_locatie_id).naam, locById(v.naar_locatie_id).naam, v.opmerking, `${v.aantal}×`]
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [verplaatsingen, wachtendId, bereik, mutZoek, av, bat, locaties, producten])
  const mutGetoond = mutaties.slice(0, mutAantal)
  // Zoekterm leeg en de periode terug op de standaard (gedeeld met de rest
  // van de administratie).
  const wisMutFilters = () => { setMutZoek(''); setPeriodeKeuze(STANDAARD_PERIODE) }

  const deleteVerplaats = (v: any) => {
    setMutFout('')
    const heeftAcc = !!v.accijns_record_id
    if (heeftAcc) {
      const accRec = (acc || []).find((a: any) => a.id === v.accijns_record_id)
      if (accRec?.betaald) { setMutFout(t('agp_err_verplaats_acc_betaald')); return }
      // Periode-lock (ERP-plan 0.4): ook een nog-niet-betaald record in een
      // maand waarvan de aangifte al is ingediend, is bevroren.
      if (accRec && accijnsMaandGesloten(accRec.datum || '', accijnsAangiftes)) { setMutFout(t('err_accijns_maand_gesloten')); return }
    }
    const van = locById(v.van_locatie_id).naam
    const naar = locById(v.naar_locatie_id).naam
    // Is het bier op de bestemming al verkocht, afgeboekt of verder
    // verplaatst, dan zou het na verwijderen weer in de AGP opduiken terwijl
    // de accijns van de uitslag verdwijnt.
    const blokkade = verplaatsingVerwijderBlokkade(
      v, (av || []).find((a: any) => a.id === v.afvulling_id), locaties, uit, verplaatsingen, afboekingen)
    if (blokkade) {
      setMutFout(t('agp_err_verplaats_al_verbruikt')
        .replace('{tekort}', String(blokkade.tekort))
        .replace('{naar}', locById(blokkade.locatie_id).naam))
      return
    }
    const label = (heeftAcc ? t('vrd_undo_verplaatsing_acc') : t('vrd_undo_verplaatsing'))
      .replace('{aantal}', String(v.aantal)).replace('{van}', van).replace('{naar}', naar)
      .replace('{accijns}', fmt(v.accijns || 0))
    // Vijf seconden terugweg; de lijst verbergt de regel zolang. De setters
    // werken op de verse stand, dus een tussentijdse boeking gaat niet verloren.
    undo.plan(`${VPL_UNDO}${v.id}`, label, () => {
      setVerplaatsingen((prev: any[]) => (prev || []).filter((x: any) => x.id !== v.id))
      if (heeftAcc) setAcc((prev: any[]) => (prev || []).filter((a: any) => a.id !== v.accijns_record_id))
      // De 'uitslaan'-regel in het voorraadverloop hoort bij deze verplaatsing.
      // Oudere regels zonder verplaatsing_id blijven staan: niet gokken.
      if (setLog) setLog((prev: any[]) => (prev || []).filter((l: any) => !(l.type === 'uitslaan' && l.verplaatsing_id === v.id)))
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Verplaatsing', entiteit_id: v.id, actie: 'verwijderd',
        omschrijving: `${van} → ${naar}: ${v.aantal}× ${heeftAcc ? `(accijns ${fmt(v.accijns || 0)} teruggedraaid)` : ''}`.trim(),
      })
    })
  }

  // ── Kolommen en kaarten ──────────────────────────────────────────────────
  const batchNr = (b: any): string => b?.batch_nummer ? `#${b.batch_nummer}` : '—'

  const tankKolommen: LijstKolom<AgpTankRij>[] = [
    { id: 'bier', kop: t('excise_beer'), cel: r => <span className="font-medium text-gray-900">{bierNaam(r.batch)}</span> },
    { id: 'batch', kop: t('excise_batch'), cel: r => <span className="text-gray-500">{batchNr(r.batch)}</span> },
    { id: 'status', kop: t('lbl_status'), cel: r => r.batch?.status ? <Badge s={r.batch.status} /> : '—' },
    { id: 'tank', kop: t('lbl_tank'), cel: r => <span className="text-gray-600">{r.batch?.tank || '—'}</span> },
    { id: 'liter', kop: t('excise_liters'), rechts: true, cel: r => fmtL(r.liter) },
    { id: 'abv', kop: t('excise_abv'), rechts: true, cel: r => <>{r.abv ? `${r.abv.toFixed(2)}%` : '—'}{r.geschat ? <span className="ml-1 text-xs text-gray-500">({t('agp_geschat')})</span> : null}</> },
    { id: 'accijns', kop: t('excise_amount'), rechts: true, cel: r => <span className="font-semibold t-accent-text">{fmt(r.accijns)}</span> },
  ]
  const tankKaart = (r: AgpTankRij) => (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{bierNaam(r.batch)}</span>
        <span className="text-sm font-semibold t-accent-text tabular-nums whitespace-nowrap">{fmt(r.accijns)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
        {r.batch?.status && <Badge s={r.batch.status} />}
        <span>{batchNr(r.batch)}</span>
        {r.batch?.tank && <span>{t('lbl_tank')} {r.batch.tank}</span>}
        <span>{fmtL(r.liter)}</span>
        <span>{r.abv ? `${r.abv.toFixed(2)}%` : '—'}{r.geschat ? ` (${t('agp_geschat')})` : ''}</span>
      </div>
    </div>
  )

  const verplaatsKnop = (afv: any, vanId: number, extra = '') => (
    <Btn v="secondary" s="sm" cls={`whitespace-nowrap ${extra}`} onClick={() => openVerplaats(afv, vanId)}>{t('agp_verplaatsen')}</Btn>
  )
  const verpakking = (afv: any): string => afv?.verpakking_naam || afv?.verpakking_type || '—'

  const verpaktKolommen: LijstKolom<VerpaktRij>[] = [
    { id: 'bier', kop: t('excise_beer'), cel: r => <span className="font-medium text-gray-900">{bierNaam(r.batch, r.afv)}</span> },
    { id: 'batch', kop: t('excise_batch'), cel: r => <span className="text-gray-500">{batchNr(r.batch)}</span> },
    { id: 'verpakking', kop: t('excise_packaging'), cel: r => <span className="text-gray-600">{verpakking(r.afv)}</span> },
    { id: 'aantal', kop: t('agp_aantal'), rechts: true, cel: r => r.in_agp },
    { id: 'liter', kop: t('excise_liters'), rechts: true, cel: r => fmtL(r.liter_in_agp) },
    { id: 'abv', kop: t('excise_abv'), rechts: true, breed: true, cel: r => r.abv ? `${r.abv}%` : '—' },
    { id: 'accijns', kop: t('excise_amount'), rechts: true, cel: r => <AccijnsBedrag w={r.waarde} /> },
    { id: 'actie', kop: <span className="sr-only">{t('agp_verplaatsen')}</span>, rechts: true, cel: r => verplaatsKnop(r.afv, agp.id) },
  ]
  const verpaktKaart = (r: VerpaktRij) => (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{bierNaam(r.batch, r.afv)}</span>
        <span className="text-sm whitespace-nowrap"><AccijnsBedrag w={r.waarde} /></span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 tabular-nums">
          <span>{batchNr(r.batch)}</span>
          <span>{verpakking(r.afv)}</span>
          <span>{r.in_agp}× · {fmtL(r.liter_in_agp)}</span>
          {r.abv ? <span>{r.abv}%</span> : null}
        </div>
        {verplaatsKnop(r.afv, agp.id, `flex-shrink-0 ${KAART_INTERACTIEF}`)}
      </div>
    </div>
  )

  const buitenKolommen: LijstKolom<BuitenRij>[] = [
    { id: 'bier', kop: t('excise_beer'), cel: b => <><span className="font-medium text-gray-900">{bierNaam(b.rij.batch, b.rij.afv)}</span>{b.rij.batch?.batch_nummer ? <span className="text-gray-400 ml-1">#{b.rij.batch.batch_nummer}</span> : null}</> },
    { id: 'verpakking', kop: t('excise_packaging'), cel: b => <span className="text-gray-600">{verpakking(b.rij.afv)}</span> },
    { id: 'locatie', kop: t('agp_locatie'), cel: b => <span className="text-gray-600">{b.locNaam}</span> },
    { id: 'aantal', kop: t('agp_aantal'), rechts: true, cel: b => b.aantal },
    { id: 'accijns', kop: t('excise_amount'), cel: b => <StatusBadge s={b.status} /> },
    { id: 'actie', kop: <span className="sr-only">{t('agp_verplaatsen')}</span>, rechts: true, cel: b => verplaatsKnop(b.rij.afv, b.locId) },
  ]
  const buitenKaart = (b: BuitenRij) => (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">
          {bierNaam(b.rij.batch, b.rij.afv)}{b.rij.batch?.batch_nummer ? <span className="text-gray-400 font-normal ml-1">#{b.rij.batch.batch_nummer}</span> : null}
        </span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">{b.aantal}×</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{verpakking(b.rij.afv)}</span>
          <span>{b.locNaam}</span>
          <StatusBadge s={b.status} />
        </div>
        {verplaatsKnop(b.rij.afv, b.locId, `flex-shrink-0 ${KAART_INTERACTIEF}`)}
      </div>
    </div>
  )

  const mutActies = (v: any, extra = '') => (
    <RowActions cls={extra} acties={[{ id: 'verwijder', label: t('btn_delete'), soort: 'gevaar', onClick: () => deleteVerplaats(v) }]} />
  )
  const mutBier = (v: any) => {
    const afv = (av || []).find((a: any) => a.id === v.afvulling_id)
    return { naam: bierNaam(batById(v.batch_id), afv), verpakking: afv?.verpakking_naam || '' }
  }
  const mutKolommen: LijstKolom<any>[] = [
    { id: 'datum', kop: t('lbl_datum'), klasse: 'whitespace-nowrap', cel: v => <span className="text-gray-600">{fmtD(v.datum)}</span> },
    { id: 'bier', kop: t('excise_beer'), cel: v => { const b = mutBier(v); return <>{b.naam} <span className="text-gray-400 text-xs">{b.verpakking}</span></> } },
    { id: 'aantal', kop: t('agp_aantal'), rechts: true, cel: v => v.aantal },
    { id: 'van', kop: t('agp_van'), cel: v => <span className="text-gray-600">{locById(v.van_locatie_id).naam}</span> },
    { id: 'naar', kop: t('agp_naar'), cel: v => <span className="text-gray-600">{locById(v.naar_locatie_id).naam}</span> },
    { id: 'accijns', kop: t('excise_amount'), rechts: true, cel: v => v.accijns ? <span className="font-semibold t-accent-text">{fmt(v.accijns)}</span> : '—' },
    { id: 'actie', kop: <span className="sr-only">{t('btn_meer_acties')}</span>, rechts: true, cel: v => mutActies(v) },
  ]
  const mutKaart = (v: any) => {
    const b = mutBier(v)
    return (
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 break-words">{b.naam} <span className="font-normal text-gray-500">{b.verpakking}</span></div>
          <div className="mt-0.5 text-xs text-gray-500 break-words">{fmtD(v.datum)} · {v.aantal}× · {locById(v.van_locatie_id).naam} → {locById(v.naar_locatie_id).naam}</div>
          {v.accijns ? <div className="mt-0.5 text-xs font-semibold t-accent-text tabular-nums">{fmt(v.accijns)}</div> : null}
        </div>
        {mutActies(v, KAART_INTERACTIEF)}
      </div>
    )
  }

  // ── Waar de accijnswaarde op rust ────────────────────────────────────────
  const bronRegels: string[] = []
  if (verpaktSom.bron === 'voorcalc') bronRegels.push(t('vrd_bron_verpakt_voorcalc'))
  else if (verpaktSom.bron === 'gemengd') bronRegels.push(t('vrd_bron_verpakt_gemengd').replace('{bedrag}', fmt(verpaktSom.geschat)))
  else if (verpaktSom.bron === 'geschat') bronRegels.push(t('vrd_bron_verpakt_geschat'))
  if (ovz.tanks.length > 0) bronRegels.push(t('vrd_bron_tanks'))

  const niets = ovz.tanks.length === 0 && verpaktRijen.length === 0 && buitenRijen.length === 0
  const heeftMutaties = (verplaatsingen || []).length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 min-w-0">{t('vrd_agp_locatie').replace('{naam}', agp.naam || t('lbl_onbekend'))}</p>
        <Btn v="secondary" s="sm" onClick={() => setLocOpen(true)}>{t('agp_locatie_beheren')}</Btn>
      </div>

      {fout && <Melding tekst={fout} onSluit={() => setFout('')} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Tegel label={t('vrd_kpi_liter')} waarde={fmtL(literTotaal)}>
          <div className="tabular-nums">{t('vrd_kpi_liter_sub').replace('{tank}', fmtL(ovz.totaal_liter_tank)).replace('{verpakt}', fmtL(ovz.totaal_liter_agp))}</div>
        </Tegel>
        <Tegel label={t('vrd_kpi_accijns')} waarde={fmt(accijnsTotaal)}>
          <div className="tabular-nums">{t('vrd_kpi_accijns_sub').replace('{tank}', fmt(ovz.totaal_accijns_tank)).replace('{verpakt}', fmt(verpaktSom.bedrag))}</div>
          <div className="tabular-nums">
            {t('agp_kpi_gem_vorige_maand')}: <span className="font-medium text-gray-700">{fmt(histAvg.vorigeMaand.totaal)}</span>
            {' · '}{t('agp_kpi_gem_dit_jaar').replace('{jaar}', String(histAvg.jaar))}: <span className="font-medium text-gray-700">{fmt(histAvg.ditJaar.totaal)}</span>
            {histAvg.vorigJaar && <>{' · '}{t('agp_kpi_gem_vorig_jaar').replace('{jaar}', String(histAvg.jaar - 1))}: <span className="font-medium text-gray-700">{fmt(histAvg.vorigJaar.totaal)}</span></>}
          </div>
          {bronRegels.map(r => <div key={r}>{r}</div>)}
        </Tegel>
      </div>

      {niets && <LegeStaat titel={t('vrd_agp_leeg')} tekst={t('vrd_agp_leeg_tekst')} />}

      {ovz.tanks.length > 0 && (
        <section className="space-y-2">
          <SectionHeader rounded="full" open={openSec.tanks} onToggle={() => toggle('tanks')} title={t('agp_sec_tanks')} info={ovz.tanks.length} />
          {openSec.tanks && (
            <ResponsiveLijst rijen={ovz.tanks} sleutel={r => r.batch.id} kolommen={tankKolommen} kaart={tankKaart} label={t('agp_sec_tanks')} />
          )}
        </section>
      )}

      {verpaktRijen.length > 0 && (
        <section className="space-y-2">
          <SectionHeader rounded="full" open={openSec.agp} onToggle={() => toggle('agp')} title={t('agp_sec_verpakt_agp')} info={verpaktRijen.length} />
          {openSec.agp && (
            <ResponsiveLijst rijen={verpaktRijen} sleutel={r => r.afv.id} kolommen={verpaktKolommen} kaart={verpaktKaart} label={t('agp_sec_verpakt_agp')} />
          )}
        </section>
      )}

      {buitenRijen.length > 0 && (
        <section className="space-y-2">
          <SectionHeader rounded="full" open={openSec.buiten} onToggle={() => toggle('buiten')} title={t('agp_sec_buiten_agp')} info={buitenRijen.length} />
          {openSec.buiten && (
            <ResponsiveLijst rijen={buitenRijen} sleutel={b => b.sleutel} kolommen={buitenKolommen} kaart={buitenKaart} label={t('agp_sec_buiten_agp')} />
          )}
        </section>
      )}

      {heeftMutaties && (
        <section className="space-y-2">
          <SectionHeader rounded="full" open={openSec.mut} onToggle={() => toggle('mut')} title={t('vrd_sec_verplaatsingen')} info={mutaties.length} />
          {openSec.mut && (
            <>
              <FilterBalk<string>
                zoek={mutZoek} onZoek={setMutZoek} zoekPlaceholder={t('agp_zoek_mutaties')}
                periode={{ keuze: periodeKeuze, onKeuze: setPeriodeKeuze, eigen: eigenPeriode, onEigen: setEigenPeriode }}
                onWis={wisMutFilters}
              />
              {mutFout && <Melding tekst={mutFout} onSluit={() => setMutFout('')} />}
              <ResponsiveLijst
                rijen={mutGetoond}
                sleutel={(v: any) => v.id}
                kolommen={mutKolommen}
                kaart={mutKaart}
                label={t('vrd_sec_verplaatsingen')}
                leeg={<LegeStaat titel={t('agp_zoek_geen_resultaten')} tekst={t('vrd_mut_leeg_tekst')}><Btn v="secondary" onClick={wisMutFilters}>{t('fb_wis')}</Btn></LegeStaat>}
                voet={mutaties.length > mutGetoond.length ? (
                  <div className="flex justify-center">
                    <Btn v="secondary" s="sm" onClick={() => setMutAantal(n => n + MUT_STAP)}>
                      {t('vrd_toon_meer').replace('{n}', String(Math.min(MUT_STAP, mutaties.length - mutGetoond.length))).replace('{totaal}', String(mutaties.length))}
                    </Btn>
                  </div>
                ) : undefined}
              />
            </>
          )}
        </section>
      )}

      {vplModal && (
        <VerplaatsModal
          afv={vplModal.afv}
          batch={batById(vplModal.afv.batch_id)}
          naam={bierNaam(batById(vplModal.afv.batch_id), vplModal.afv)}
          vanLocatieId={vplModal.vanLocatieId}
          ctx={{ locaties, uit, verplaatsingen, afboekingen, accijnsInst, accijnsAangiftes, gereserveerd: agpGereserveerd }}
          onClose={() => setVplModal(null)}
          onOpslaan={saveVerplaats}
        />
      )}

      {locOpen && (
        <LocatiesModal locaties={locaties || []} heeftVoorraad={heeftVoorraadOp}
          onOpslaan={saveLoc} onVerwijder={deleteLoc} onSluit={() => setLocOpen(false)} />
      )}
    </div>
  )
}

export default AgpPage
