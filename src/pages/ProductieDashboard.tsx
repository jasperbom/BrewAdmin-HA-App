import React, { useState, useMemo, useEffect } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { tankBezetter, vrijeTanksMetStatus, batchesBuitenTanks } from '../utils/calculations'
import type { TankStatusMap } from '../types'
import type { BatchOordeel } from '../utils/tankbewaking'
import type { GaNaar } from '../utils/route'
import type { AttentiePost } from '../utils/attentie'
import { batchEbc } from '../utils/bierKleur'
import { newId } from '../utils/api'
import { logAudit } from '../utils/audit'
import { batchTitel, receptVoorBatch } from '../utils/productKeten'
import { volgendeStap } from '../utils/volgendeStap'
import type { VolgendeStap } from '../utils/volgendeStap'
import { batchEtiket, faseInfo, stapNaarBatchDoel, stapWeergave, tankInfo } from '../utils/batchesLijst'
import type { BatchEtiket } from '../utils/batchesLijst'
import type { EtiketKaartData } from '../utils/etiketKaart'
import { komendDoel, komendeDagen, tankKaartInfo, vorigeBatchInTank } from '../utils/brouwzaal'
import { useEtiketBijwerken } from '../components/batch/EtiketBijwerken'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import AttentieKaart from '../components/ui/AttentieKaart'
import { useSmalScherm } from '../components/ui/useSmalScherm'
import { useUndo } from '../components/ui/UndoBar'
import MetingBlad from '../components/batch/MetingBlad'
import { TankKaart, TankRij } from '../components/brouwzaal/TankKaart'
import type { TankModel } from '../components/brouwzaal/TankKaart'
import LegeTank from '../components/brouwzaal/LegeTank'
import type { LegeTankModel } from '../components/brouwzaal/LegeTank'
import AndereBatches from '../components/brouwzaal/AndereBatches'
import type { AndereModel } from '../components/brouwzaal/AndereBatches'
import KomendeDagen, { KomendeLijst } from '../components/brouwzaal/KomendeDagen'
import type { KomendModel } from '../components/brouwzaal/KomendeDagen'
import Inklapbaar from '../components/brouwzaal/Inklapbaar'
import type { NieuweBatchVerzoek } from '../utils/nieuweBatch'

interface ProductieDashboardProps {
  bat: any[]
  tanks: any[]
  av: any[]
  verliesRegistraties: any[]
  haTankTemps: Record<string, number>
  // Oordeel van de temperatuurbewaking per tank-id (zie utils/tankbewaking.ts).
  tankBewaking?: Record<string, BatchOordeel>
  tankStatussen: TankStatusMap
  setTankStatussen: (updater: any) => void
  tankLog: any[]
  setTankLog: (updater: any) => void
  batchTakenItems: any[]
  batchTakenGroepen: any[]
  brouwdagStappen?: any[]
  lots: any[]
  ing: any[]
  gistMetingen: any[]
  setGistMetingen: (updater: any) => void
  auditLog: any[]
  setAuditLog: (updater: any) => void
  /** Voor de bierkleur (EBC via product/recept) en de titel van een batch. */
  producten?: any[]
  recepten?: any[]
  carbSessies?: any[]
  /** Voor de volgende stap (utils/volgendeStap.ts): ingrediëntregels, dry hops, CCP 1, afvulsessies. */
  bi?: any[]
  dryHops?: any[]
  haccpVrijgaven?: any[]
  afvulSessies?: any[]
  /** `conditioneren_dagen`: de verwachte afvuldag. */
  planningInst?: any
  /** Het voorraadlog: de statusregels zeggen wanneer een fase begon ("dag 8"). */
  log?: any[]
  /** De attentieposten van Productie (utils/attentie.ts) — dezelfde als de badge. */
  attentie?: AttentiePost[]
  /** De ingelogde gebruiker: voorgevuld bij een reiniging. */
  gebruiker?: string
  setPage: (id: string) => void
  /** Het blad "Wat brouw je?" (App.tsx → openNieuweBatch); een vrije tank geeft de tank mee. */
  onNieuweBatch?: (verzoek?: NieuweBatchVerzoek) => void
  /** Navigatie van de schil (App.tsx): een batch openen (`{pagina: 'batches',
      id}`) of een exact doel (pagina + tabblad/filter/lot, zie utils/attentie.ts). */
  gaNaar: GaNaar
  /** Teller uit de schil: elke ophoging opent de meting-modal (de Meten-knop
      in de onderbalk landt hier, ook vanuit een andere werkruimte). */
  metingSignaal?: number
}

type MetingForm = { sg: string, ph: string, temp: string }
const LEGE_METING: MetingForm = { sg: '', ph: '', temp: '' }

// Brouwzaal — het Productie-dashboard (SPEC A en B). In de tanks: per tank een
// kaart (bureau) of een rij van ± 88 px (telefoon) met het bier, de meetstrip,
// de afvuldag, de etiketchip als het etiket niet klopt en één knop: de
// volgende stap (utils/volgendeStap.ts — met › opent hij de batch op de juiste
// plek, zonder › voert hij uit: "Meting" opent het meetblad). Lege tanks staan
// er op het bureau als lage kaart tussen, op de telefoon ingeklapt onder
// "Vrije tanks". "Andere batches" toont alles wat loopt zonder tankkaart.
// Rechts (bureau, vanaf 1280 px; smaller eronder, telefoon bovenaan resp.
// ingeklapt onderaan) "Vraagt om aandacht" en "Komende 14 dagen". Geen
// knoppenrij die de tabs herhaalt: Meten zit op de telefoon in de onderbalk.
function ProductieDashboard({
  bat: alleBatches = [], tanks = [], av = [], verliesRegistraties = [], haTankTemps = {}, tankBewaking = {},
  tankStatussen = {}, setTankStatussen = () => {}, tankLog = [], setTankLog = () => {},
  batchTakenItems = [], batchTakenGroepen = [],
  lots = [], ing = [], gistMetingen = [], setGistMetingen = () => {}, auditLog = [], setAuditLog = () => {},
  producten = [], recepten = [], bi = [], dryHops = [], haccpVrijgaven = [], afvulSessies = [],
  planningInst, log = [], attentie = [], gebruiker = '',
  onNieuweBatch, gaNaar, metingSignaal = 0,
}: ProductieDashboardProps) {
  const telefoon = useSmalScherm()
  const vandaag = tod()
  // Een batch die net verwijderd is (vijf seconden terugweg, zie de batch en
  // Batches › Lopend) staat hier ook al niet meer.
  const undo = useUndo()
  const wachtId = String(undo.actie?.id || '').startsWith('batch-verwijder-') ? Number(String(undo.actie?.id).slice('batch-verwijder-'.length)) : null
  const bat = useMemo(() => (alleBatches || []).filter((b: any) => !!b && b.id !== wachtId), [alleBatches, wachtId])
  const conditionerenDagen = Number(planningInst?.conditioneren_dagen ?? 14)
  const titelVan = (b: any) => batchTitel(b, { producten, recepten }, t('lbl_naamloos'))
  const batchNaam = (b: any) => titelVan(b).label

  // Batch openen = de batch als eigen pagina (een history-entry: terug brengt
  // je weer hier).
  const openBatch = (id: number) => gaNaar({ pagina: 'batches', id })

  // Het etiket van een batch: dezelfde berekening als de kaart "Etiket &
  // website" in de batch en de lijst Batches (de data van de etiketdienst in
  // App.tsx, anders wat deze pagina zelf heeft).
  const etiketDienst = useEtiketBijwerken()
  const etiketData: EtiketKaartData = useMemo(() => ({
    ...(etiketDienst?.data || {
      recepten, batchIngredienten: bi, ingredienten: ing, lots, afvulSessies, afvullingen: av, batches: bat, producten,
    }),
    vandaag,
  }), [etiketDienst?.data, recepten, bi, ing, lots, afvulSessies, av, bat, producten, vandaag])
  const statusLog = useMemo(() => (log || []).filter((l: any) => l?.type === 'status'), [log])

  // De volgende stap en het etiket per lopende batch: één keer per stand van de data.
  const stapCtx = useMemo(() => ({
    vandaag, conditionerenDagen, batchTakenItems, batchTakenGroepen,
    batchIngredienten: bi, ingredienten: ing, lots, recepten, gistMetingen, dryHops,
    vrijgaven: haccpVrijgaven, afvulSessies, afvullingen: av,
  }), [vandaag, conditionerenDagen, batchTakenItems, batchTakenGroepen, bi, ing, lots, recepten, gistMetingen, dryHops,
    haccpVrijgaven, afvulSessies, av])
  const perBatch = useMemo(() => {
    const uit = new Map<number, { stap: VolgendeStap, etiket: BatchEtiket }>()
    for (const b of bat) {
      if (!b || b.status === 'Gesloten') continue
      const etiket = batchEtiket(b, etiketData)
      const stap = volgendeStap(b, { ...stapCtx, etiketKleur: etiket.status.kleur, abvWaarde: etiket.waarden.abv.waarde })
      uit.set(b.id, { stap, etiket })
    }
    return uit
  }, [bat, etiketData, stapCtx])

  // ── In de tanks ───────────────────────────────────────────────────────────
  // Bezet = er zit bier in (Vergisten/Conditioneren). Een batch in Brouwen
  // heeft zijn tank alleen gereserveerd: die tank staat bij de lege tanks.
  const tankModellen: TankModel[] = useMemo(() => tanks
    .map((tk: any) => ({ tank: tk, batch: tankBezetter(tk.id, bat) }))
    .filter((x: any) => x.batch && perBatch.has(x.batch.id))
    .map(({ tank, batch }: any) => {
      const sensor = haTankTemps[tank.id]
      const oordeel = tankBewaking[tank.id]
      const { stap, etiket } = perBatch.get(batch.id)!
      return {
        tank, batch, titel: titelVan(batch),
        recept: receptVoorBatch(batch, recepten || [])?.naam || null,
        ebc: batchEbc(batch, producten, recepten),
        info: tankKaartInfo(batch, {
          vandaag, gistMetingen, afvullingen: av, statusLog, verliesRegistraties, conditionerenDagen,
          sensorTemp: typeof sensor === 'number' && Number.isFinite(sensor) ? sensor : null,
        }),
        stap, etiket,
        // Alleen tonen wanneer er iets te zeggen valt (zie BEWAKING_PILL).
        bewaking: oordeel && ['ok', 'instellen', 'afwijking', 'waarschuwing', 'alarm', 'sensor_stil'].includes(oordeel.status) ? oordeel : null,
      }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tanks, bat, perBatch, haTankTemps, tankBewaking, recepten, producten, vandaag, gistMetingen, av, statusLog, verliesRegistraties, conditionerenDagen])

  // Lege tanks blijven zichtbaar, mét reinigingsstatus: een tank die net leeg
  // is gekomen staat op Vuil en moet gereinigd worden vóór de volgende brouw.
  const legeTanks: LegeTankModel[] = useMemo(() => vrijeTanksMetStatus(tanks, bat, tankStatussen)
    .map(({ tank, status, sinds, reserveringen }: any) => {
      const eerste = reserveringen?.[0] || null
      const vorige = eerste ? null : vorigeBatchInTank(tank.id, bat)
      return {
        tank, status, sinds,
        reservering: eerste ? { batch: eerste, label: batchNaam(eerste) } : null,
        vorige: vorige ? {
          ...vorige, label: batchNaam(vorige.batch),
          naarTank: vorige.batch?.tank ? ((tanks.find((x: any) => x.id === vorige.batch.tank)?.naam) || vorige.batch.tank) : null,
        } : null,
      }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tanks, bat, tankStatussen, producten, recepten])

  // ── Andere batches ────────────────────────────────────────────────────────
  // Gepland, Brouwen en Afgevuld — en Vergisten/Conditioneren zonder
  // (bestaande) tank (utils/calculations.ts → batchesBuitenTanks): er
  // verdwijnt niets uit beeld. Gesloten batches zijn een link naar het archief.
  const andere: AndereModel[] = useMemo(() => batchesBuitenTanks(bat, tanks)
    .filter(({ batch }: any) => perBatch.has(batch.id))
    .map(({ batch: b, reden }: any) => {
      const { stap, etiket } = perBatch.get(b.id)!
      const eigenAv = (av || []).filter((a: any) => a?.batch_id === b.id)
      return {
        b, titel: titelVan(b), ebc: batchEbc(b, producten, recepten),
        fase: faseInfo(b, { vandaag, gistMetingen, afvullingen: av, statusLog }),
        tank: tankInfo(b, tanks), reden, stap, weergave: stapWeergave(stap), etiket,
        verpakkingen: new Set(eigenAv.map((a: any) => String(a.verpakking_id ?? a.verpakking_naam ?? a.verpakking_type ?? ''))).size,
      }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bat, tanks, perBatch, av, producten, recepten, vandaag, gistMetingen, statusLog])
  const geslotenAantal = useMemo(() => bat.filter((b: any) => b?.status === 'Gesloten').length, [bat])

  // ── Komende 14 dagen ──────────────────────────────────────────────────────
  const komend: KomendModel[] = useMemo(() => komendeDagen(bat, {
    vandaag, batchIngredienten: bi, dryHops, conditionerenDagen,
  }).map(item => {
    const b = bat.find((x: any) => x?.id === item.batchId)
    const tk = b?.tank ? tanks.find((x: any) => x.id === b.tank) : null
    const etiket = item.soort === 'afvullen' ? perBatch.get(item.batchId)?.etiket || null : null
    return {
      item, label: b ? batchNaam(b) : '', tank: b?.tank ? String(tk?.naam || b.tank) : '',
      etiket: etiket && etiket.status.kleur !== 'groen' ? etiket : null,
    }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bat, tanks, vandaag, bi, dryHops, conditionerenDagen, perBatch, producten, recepten])

  // ── Handelingen ───────────────────────────────────────────────────────────
  // De ene knop: met › opent hij de batch op de plek van de stap (de fase en
  // de stapkaart, utils/batchesLijst.ts → stapNaarBatchDoel); zonder › voert
  // hij uit: Meting = het meetblad voor die batch.
  const [metingVoor, setMetingVoor] = useState<number | null>(null)
  const voerStapUit = (b: any, stap: VolgendeStap) => {
    if (!stap.opent) { setMetingVoor(b.id); return }
    gaNaar(stapNaarBatchDoel(b.id, b.status, stap))
  }
  const openKomend = (m: KomendModel) => {
    const doel = komendDoel(m.item)
    const b = bat.find((x: any) => x?.id === m.item.batchId)
    if (!b) return
    gaNaar(doel ? stapNaarBatchDoel(b.id, b.status, { doel }) : { pagina: 'batches', id: b.id })
  }
  // Het blad "Wat brouw je?" opent hier, boven de brouwzaal; na Inplannen
  // opent de nieuwe batch. Een vrije tank geeft de tank mee.
  const nieuweBatch = (tankId?: string) => onNieuweBatch?.(tankId ? { tank: tankId } : {})
  const reiniging = { tankStatussen, setTankStatussen, tankLog, setTankLog, auditLog, setAuditLog, standaardDoor: gebruiker.trim() }

  // Telefoon: "Vrije tanks" en "Komende 14 dagen" beginnen ingeklapt.
  const [vrijOpen, setVrijOpen] = useState(false)
  const [komendOpen, setKomendOpen] = useState(false)

  // ── De Meten-knop in de onderbalk: een meting voor een batch naar keuze ──
  // (die landt hier, ook vanuit een andere werkruimte).
  const actieveBatches = useMemo(() => bat.filter((b: any) => b?.status && b.status !== 'Gepland' && b.status !== 'Gesloten'), [bat])
  const [metingOpen, setMetingOpen] = useState(false)
  const [metingBatchId, setMetingBatchId] = useState('')
  const [metingForm, setMetingForm] = useState<MetingForm>(LEGE_METING)
  const openMetingModal = () => {
    setMetingBatchId('')
    setMetingForm(LEGE_METING)
    setMetingOpen(true)
  }
  useEffect(() => {
    if (metingSignaal > 0) openMetingModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metingSignaal])
  const slaMetingOp = (batchId: number, form: MetingForm) => {
    if (!batchId || (!form.sg && !form.ph && !form.temp)) return
    const id = newId(gistMetingen)
    const nu = new Date()
    setGistMetingen((prev: any[]) => [...(prev || []), {
      id, batch_id: batchId, datum: tod(), tijd: nu.toTimeString().slice(0, 5),
      sg: form.sg ? Number(form.sg) : undefined,
      ph: form.ph ? Number(form.ph) : undefined,
      temp: form.temp ? Number(form.temp) : undefined,
    }])
    const b = bat.find((x: any) => x.id === batchId)
    logAudit(auditLog, setAuditLog, { entiteit: 'Gistmeting', entiteit_id: id, actie: 'aangemaakt', omschrijving: `${batchNaam(b)}: SG ${form.sg || '—'}, pH ${form.ph || '—'}, ${form.temp || '—'}°C` })
  }

  const metingBatch = metingVoor != null ? bat.find((b: any) => b?.id === metingVoor) : null
  const leegInDeTanks = tankModellen.length === 0 && (telefoon || legeTanks.length === 0)

  const andereKaart = (
    <AndereBatches rijen={andere} gesloten={geslotenAantal} telefoon={telefoon}
      onOpen={(b: any) => openBatch(b.id)} onStap={r => voerStapUit(r.b, r.stap)} onMeting={r => setMetingVoor(r.b.id)}
      onGesloten={() => gaNaar({ pagina: 'batches', stand: 'gesloten' })}
      onNieuw={onNieuweBatch ? () => nieuweBatch() : undefined} />
  )

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Bureau: de kop met de ene primaire knop; op een telefoon zegt de kopbalk al waar je bent. */}
      <div className="hidden md:flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{t('nav_brouwzaal')}</h2>
        {onNieuweBatch && <Btn onClick={() => nieuweBatch()}>{t('batches_nieuw')}</Btn>}
      </div>

      {/* Telefoon: eerst wat aandacht vraagt. */}
      {telefoon && <AttentieKaart posten={attentie} onGaNaar={gaNaar} />}

      <div className="grid gap-4 md:gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="space-y-4 md:space-y-5 min-w-0">
          {/* ── In de tanks ─────────────────────────────────────────────── */}
          {tanks.length > 0 && <section aria-label={t('brouwzaal_in_de_tanks')}>
            <h2 className="text-sm font-semibold text-gray-800 mb-2 px-1">{t('brouwzaal_in_de_tanks')}</h2>
            {leegInDeTanks ? (
              <div className="text-sm text-gray-500 px-1">{t('brouwzaal_tanks_leeg')}</div>
            ) : telefoon ? (
              tankModellen.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
                  {tankModellen.map(m => (
                    <TankRij key={m.tank.id} m={m} vandaag={vandaag} onOpen={x => openBatch(x.batch.id)} onStap={x => voerStapUit(x.batch, x.stap)} />
                  ))}
                </div>
              )
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 items-start">
                {tankModellen.map(m => (
                  <TankKaart key={m.tank.id} m={m} vandaag={vandaag} onOpen={x => openBatch(x.batch.id)} onStap={x => voerStapUit(x.batch, x.stap)} />
                ))}
                {legeTanks.map(m => (
                  <LegeTank key={m.tank.id} m={m} reiniging={reiniging} onOpenBatch={openBatch}
                    onInplannen={onNieuweBatch ? (id => nieuweBatch(id)) : undefined} />
                ))}
              </div>
            )}
          </section>}

          {andereKaart}

          {/* Telefoon: lege tanks en de komende dagen ingeklapt onderaan. */}
          {telefoon && legeTanks.length > 0 && (
            <Inklapbaar titel={t('dash_vrije_tanks')} aantal={legeTanks.length} open={vrijOpen} onToggle={() => setVrijOpen(o => !o)}>
              <div className="divide-y divide-gray-100">
                {legeTanks.map(m => (
                  <LegeTank key={m.tank.id} m={m} rij reiniging={reiniging} onOpenBatch={openBatch}
                    onInplannen={onNieuweBatch ? (id => nieuweBatch(id)) : undefined} />
                ))}
              </div>
            </Inklapbaar>
          )}
          {/* Niets op komst: geen lege kaart. */}
          {telefoon && komend.length > 0 && (
            <Inklapbaar titel={t('brouwzaal_komende_dagen')} aantal={komend.length} open={komendOpen} onToggle={() => setKomendOpen(o => !o)}>
              <KomendeLijst rijen={komend} onOpen={openKomend} />
            </Inklapbaar>
          )}
        </div>

        {/* ── Rechterkolom (bureau; tussen 768 en 1279 px onder de tanks) ─ */}
        {!telefoon && (
          <div className="space-y-4 md:space-y-5 min-w-0">
            <AttentieKaart posten={attentie} onGaNaar={gaNaar} />
            {komend.length > 0 && <KomendeDagen rijen={komend} onOpen={openKomend} />}
          </div>
        )}
      </div>

      {metingBatch && (
        <MetingBlad batch={metingBatch} label={batchNaam(metingBatch)}
          gistMetingen={gistMetingen} setGistMetingen={setGistMetingen}
          auditLog={auditLog} setAuditLog={setAuditLog}
          sensorTemp={metingBatch.tank ? haTankTemps?.[metingBatch.tank] ?? null : null}
          onSluit={() => setMetingVoor(null)} />
      )}

      {metingOpen && (
        <Modal title={t('dash_meting_invoeren')} onClose={() => setMetingOpen(false)}>
          <div className="space-y-3">
            <Sel label={t('dash_kies_batch')} value={metingBatchId} onChange={setMetingBatchId}
              opts={actieveBatches.map((b: any) => ({ v: String(b.id), l: batchNaam(b) }))} />
            <div className="grid grid-cols-3 gap-3">
              <Inp label={t('flow_meting_sg')} type="number" step="0.001" value={metingForm.sg} onChange={(v) => setMetingForm((f) => ({ ...f, sg: v }))} />
              <Inp label={t('flow_meting_ph')} type="number" step="0.01" value={metingForm.ph} onChange={(v) => setMetingForm((f) => ({ ...f, ph: v }))} />
              <div>
                <Inp label={t('flow_meting_temp')} type="number" step="0.1" value={metingForm.temp} onChange={(v) => setMetingForm((f) => ({ ...f, temp: v }))} />
                {(() => {
                  const b = actieveBatches.find((x: any) => String(x.id) === metingBatchId)
                  const tv = b && b.tank != null ? haTankTemps[b.tank] : undefined
                  const s = typeof tv === 'number' && !isNaN(tv) ? tv : null
                  return s != null ? (
                    <button type="button" onClick={() => setMetingForm((f) => ({ ...f, temp: s.toFixed(1) }))}
                      className="mt-1 text-xs hover:underline py-1" style={{ color: 'var(--t-accent)' }} title={t('carb_use_sensor_tooltip')}>
                      HA: {s.toFixed(1)}°C
                    </button>
                  ) : null
                })()}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={() => setMetingOpen(false)}>{t('btn_cancel')}</Btn>
              <Btn onClick={() => { slaMetingOp(Number(metingBatchId), metingForm); setMetingOpen(false) }} disabled={!metingBatchId}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default ProductieDashboard
