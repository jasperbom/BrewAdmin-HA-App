import React from 'react'
import { t } from '../../i18n'
import { tod } from '../../utils/format'
import { newId, wcGet } from '../../utils/api'
import { wcFoutMelding } from '../../utils/wcFout'
import { logAudit } from '../../utils/audit'
import { periodeKeyLabel, getPeriodes, wcOrdersNogNietGefactureerd } from '../../utils/btw'
import { btwAangifteBoeking, accijnsAangifteBoeking, stornoBoekingVoor, voegBoekingToe } from '../../utils/journaal'
import { accijnsMaandKey, groepeerAccijnsPerMaand, accijnsRecordsBetaald } from '../../utils/afboeking'
import { rolMagKey } from '../../utils/rollen'
import { centNaarEuro } from '../../utils/centen'
import { dagNotatie } from '../../utils/periode'
import {
  btwPeriodeCijfers, btwJaarCijfers, btwActievePerioden, btwRijen, accijnsRijen, accijnsMaandCent,
  sorteerRijen, telVraagtActie, betalingKandidaten, enigVoorstel, controleurOpties,
  controleBlokkade, zelfdePersoon, metBtwControle, leesAangifteDoel, actieSleutel, dagMaand,
  type AangifteRij, type AangifteSoort, type BtwCijfers, type BtwStappenBron, type ControleInvoer,
} from '../../utils/aangifteStappen'
import type { BtwPeriode } from '../../utils/btw'
import Btn from '../../components/ui/Btn'
import BevestigKnop from '../../components/ui/BevestigKnop'
import LegeStaat from '../../components/ui/LegeStaat'
import Icon from '../../components/ui/Icon'
import DetailPaneel, { LijstMetDetail } from '../../components/ui/DetailPaneel'
import { KAART_INTERACTIEF } from '../../components/ui/ResponsiveLijst'
import { useSmalScherm, useTelefoonIndeling } from '../../components/ui/useSmalScherm'
import { useUndo } from '../../components/ui/UndoBar'
import Segment from '../../components/inkoop/Segment'
import PeriodeLijst from './aangiftes/PeriodeLijst'
import ControleBlok from './aangiftes/ControleBlok'
import BetalingBlok from './aangiftes/BetalingBlok'
import BtwRubrieken from './aangiftes/BtwRubrieken'
import AccijnsBoekingen from './aangiftes/AccijnsBoekingen'
import { useRollenConfig } from './aangiftes/useRollenConfig'
import { StappenBalk, Pil, MetVet, fmtCent, periodeTitel, vul } from './aangiftes/onderdelen'
import { useAdmin, txKey } from './adminContext'

// ── Aangiftes (Administratie) ───────────────────────────────────────────────
// BTW en accijns lopen in hetzelfde ritme: een periode loopt, is berekend,
// wordt gecontroleerd door een tweede persoon, ingediend en betaald. Dus één
// lijst per segment (BTW | Accijns) met per periode de stap, het bedrag en
// één volgende handeling, en het detail van de gekozen periode ernaast (op
// een telefoon als eigen scherm): de rubrieken of de accijnsboekingen, de
// controle, het indienen en de betaling.
//
// Wat de stap is, welk bedrag en welke deadline: utils/aangifteStappen.ts.
// De handelingen zelf zijn die van de oude BTW-tab en AccijnsPage
// (markeerAangifteIngediend, de accijnsstatus, koppelen/ontkoppelen),
// aangevuld met wie het deed (whoami).

type Focus = 'controle' | 'betaling' | null

const leegConcept = (rec: any): ControleInvoer => ({
  controleur: String(rec?.reviewer || ''), bevindingen: String(rec?.bevindingen || ''), tochAkkoord: false,
})

function AangiftesSectie() {
  const {
    navDoel, gaNaarDoel, whoami, wcCreds, inkoopFacturen, verkoopFacturen, bestellingen,
    bat, acc, setAcc, bankKoppelingen, accijnsAangiftes, setAccijnsAangiftes, btwAangiftes, setBtwAangiftes,
    av, uit, auditLog, setAuditLog, setJournaal, bankTransacties, btwPeriodeType,
    koppelBtwBetaling, ontkoppelBtwBetaling, ontkoppelAccijnsBetaling, koppelAccijnsBetaling,
  } = useAdmin()
  const smal = useSmalScherm()
  // Zelfde omslag als het detail (een telefoon dwars blijft telefoon): daar
  // horen tapdoelen van 44 px.
  const telefoon = useTelefoonIndeling()
  const undo = useUndo()
  const rollen = useRollenConfig()
  const ingelogd = String(whoami?.gebruiker || '').trim()
  const magSchrijven = (soort: AangifteSoort) => rolMagKey(whoami?.rol, soort === 'btw' ? 'btw_aangiftes' : 'accijns_aangiftes')

  // ── Beginstand uit het navigatiedoel: segment, jaar en de periode open ──
  const [doel] = React.useState(() => leesAangifteDoel(navDoel, btwPeriodeType))
  const huidigJaar = new Date().getFullYear()
  const [tab, setTabState] = React.useState<AangifteSoort>(doel.tab)
  const [jaar, setJaarState] = React.useState<number>(doel.jaar ?? huidigJaar)
  const [gekozen, setGekozen] = React.useState<string | null>(doel.sleutel)
  const [focus, setFocus] = React.useState<Focus>(null)

  // Webshoporders van het jaar (de ophaalactie van de oude BTW-tab).
  const [wcOrders, setWcOrders] = React.useState<any[]>([])
  const [wcBezig, setWcBezig] = React.useState(false)
  const [wcFout, setWcFout] = React.useState('')
  const [wcGeladen, setWcGeladen] = React.useState(false)

  // Invoer per periode (blijft staan als het detail sluit of de indeling wisselt).
  const [concepten, setConcepten] = React.useState<Record<string, ControleInvoer>>({})
  const [gekozenTx, setGekozenTx] = React.useState<Record<string, string>>({})
  const [betaalDatum, setBetaalDatum] = React.useState<Record<string, string>>({})
  const [weergave, setWeergave] = React.useState<Record<string, 'batch' | 'uitslag'>>({})
  const [alleRubrieken, setAlleRubrieken] = React.useState(false)
  const [tariefOpen, setTariefOpen] = React.useState(false)

  const controleRef = React.useRef<HTMLElement | null>(null)
  const betalingRef = React.useRef<HTMLElement | null>(null)

  const setTab = (v: AangifteSoort) => { setTabState(v); setGekozen(null) }
  const setJaar = (j: number) => {
    setJaarState(j); setGekozen(null)
    setWcGeladen(false); setWcOrders([]); setWcFout('')
  }

  const vandaag = tod()
  const type = btwPeriodeType

  // ── BTW: cijfers en stappen ──────────────────────────────────────────────
  // Webshoporders die in de app al een eigen verkoopfactuur hebben tellen
  // alleen via die factuur mee — anders staat de omzet-BTW er dubbel.
  const ordersOpen = React.useMemo(
    () => wcOrdersNogNietGefactureerd(wcOrders, bestellingen, verkoopFacturen),
    [wcOrders, bestellingen, verkoopFacturen])
  const cijferBron = React.useMemo(
    () => ({ verkoopFacturen, inkoopFacturen, wcOrders: ordersOpen, periodeType: type }),
    [verkoopFacturen, inkoopFacturen, ordersOpen, type])
  const cijfersVan = React.useMemo(() => {
    const cache = new Map<string, BtwCijfers>()
    return (p: { key: string, from: string, to: string }): BtwCijfers => {
      let c = cache.get(p.key)
      if (!c) { c = btwPeriodeCijfers(p, cijferBron); cache.set(p.key, c) }
      return c
    }
  }, [cijferBron])
  const periodeVan = React.useCallback((key: string): BtwPeriode | null =>
    getPeriodes(Number(key.slice(0, 4)), type).find(p => p.key === key) || null, [type])
  const actief = React.useMemo(
    () => btwActievePerioden([...(verkoopFacturen || []), ...(inkoopFacturen || [])], type),
    [verkoopFacturen, inkoopFacturen, type])
  const btwBron: BtwStappenBron = React.useMemo(() => ({
    periodeType: type, vandaag, btwAangiftes, bankKoppelingen, bankTransacties, actief,
    bedragCent: (key: string) => { const p = periodeVan(key); return p ? cijfersVan(p).teBetalenCent : 0 },
  }), [type, vandaag, btwAangiftes, bankKoppelingen, bankTransacties, actief, periodeVan, cijfersVan])
  const btwJaarRijen = React.useMemo(() => btwRijen(jaar, btwBron), [jaar, btwBron])
  // Telling voor het segment: hetzelfde venster als de werkruimte-badge
  // (vorig + dit jaar), los van het jaar dat je bekijkt.
  const btwTelling = React.useMemo(() => [huidigJaar - 1, huidigJaar].map(j => ({
    jaar: j, n: telVraagtActie(j === jaar ? btwJaarRijen : btwRijen(j, btwBron)),
  })), [huidigJaar, jaar, btwJaarRijen, btwBron])

  // ── Accijns: stappen per maand ───────────────────────────────────────────
  const accAlle = React.useMemo(() => accijnsRijen({
    vandaag: new Date(`${vandaag}T12:00:00`), acc, accijnsAangiftes, bankKoppelingen, bankTransacties,
  }), [vandaag, acc, accijnsAangiftes, bankKoppelingen, bankTransacties])
  const accRecordsPerMaand = React.useMemo(
    () => groepeerAccijnsPerMaand<any>(acc, accijnsMaandKey(new Date(`${vandaag}T12:00:00`))).byMonth,
    [acc, vandaag])

  const btwN = btwTelling.reduce((s, x) => s + x.n, 0)
  const accN = telVraagtActie(accAlle)
  const rijen = React.useMemo(
    () => sorteerRijen(tab === 'btw' ? btwJaarRijen : accAlle.filter(r => r.jaar === jaar)),
    [tab, btwJaarRijen, accAlle, jaar])
  const gekozenRij = gekozen ? rijen.find(r => r.sleutel === gekozen) || null : null

  // Een periode in een ander jaar die om actie vraagt: één tik erheen.
  const anderJaar = React.useMemo(() => {
    const per = new Map<number, number>()
    if (tab === 'btw') btwTelling.forEach(x => { if (x.jaar !== jaar && x.n > 0) per.set(x.jaar, x.n) })
    else accAlle.forEach(r => { if (r.vraagtActie && r.jaar !== jaar) per.set(r.jaar, (per.get(r.jaar) || 0) + 1) })
    const [eerste] = [...per.entries()].sort((a, b) => b[0] - a[0])
    return eerste ? { jaar: eerste[0], n: eerste[1] } : null
  }, [tab, btwTelling, accAlle, jaar])

  // ── Webshopverkopen ophalen (WooCommerce) ────────────────────────────────
  const haalWebshop = async (j: number) => {
    if (!wcCreds?.enabled || !wcCreds.storeUrl) { setWcFout(t('msg_wc_not_active_settings')); return }
    setWcBezig(true); setWcFout('')
    try {
      const alle: any[] = []
      let pg = 1
      while (true) {
        const qs = `orders?per_page=100&page=${pg}&status=any&after=${j}-01-01T00:00:00&before=${j}-12-31T23:59:59&orderby=date&order=desc`
        const batch = await wcGet(qs)
        alle.push(...batch)
        if (batch.length < 100) break
        pg++
      }
      setWcOrders(alle)
      setWcGeladen(true)
    } catch (e: any) { setWcFout(t('msg_fetch_error') + wcFoutMelding(e, t)) }
    finally { setWcBezig(false) }
  }

  // ── Handelingen: BTW ─────────────────────────────────────────────────────
  const markeerAangifteIngediend = (periodeKey: string, bedrag: number) => {
    const today = tod()
    setBtwAangiftes((prev: any[]) => {
      const zonder = (prev || []).filter((a: any) => a.periodeKey !== periodeKey)
      return [...zonder, {
        id: newId(zonder), periodeKey, ingediend_datum: today, bedrag: Math.round(bedrag),
        ...(ingelogd ? { ingediend_door: ingelogd } : {}),
      }]
    })
    // Journaal (ERP-plan 2.1): het ingediende aangiftebedrag vastleggen als
    // onveranderlijke boeking (na storno van een eventuele eerdere indiening
    // van dezelfde periode).
    setJournaal((prev: any[]) => voegBoekingToe(
      voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'btw_aangifte', periodeKey)),
      btwAangifteBoeking(periodeKey, Math.round(bedrag), `${t('lbl_btw_aangifte')} ${periodeKeyLabel(periodeKey)}`)))
    logAudit(auditLog, setAuditLog, { entiteit: 'BTW-aangifte', entiteit_id: 0, actie: 'aangemaakt', omschrijving: `Aangifte ${periodeKey} ingediend (€ ${Math.round(bedrag)})` })
  }

  const ontkoppelAangifteIngediend = (periodeKey: string) => {
    setBtwAangiftes((prev: any[]) => (prev || []).filter((a: any) => a.periodeKey !== periodeKey))
    // Journaal (ERP-plan 2.1): terugzetten = tegenboeking van de aangifte.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'btw_aangifte', periodeKey)))
    logAudit(auditLog, setAuditLog, { entiteit: 'BTW-aangifte', entiteit_id: 0, actie: 'verwijderd', omschrijving: `Aangifte ${periodeKey} teruggezet naar openstaand` })
  }

  // ── Handelingen: accijns (de statusstappen van de oude AccijnsPage) ──────
  const zetAccijns = (maand: string, velden: Record<string, unknown>) =>
    setAccijnsAangiftes((prev: any[]) => {
      const lijst = prev || []
      if (lijst.some((x: any) => x.maand === maand)) return lijst.map((x: any) => (x.maand === maand ? { ...x, ...velden } : x))
      return [...lijst, { maand, status: 'berekend', ...velden }]
    })

  const indienenAccijns = (maand: string) => {
    const rec = (accijnsAangiftes || []).find((x: any) => x.maand === maand)
    // Douane v2.4 §12.2: zonder akkoord van de controleur geen indiening (de
    // knop staat dan uit, met de reden erbij).
    if (rec?.controle_status !== 'akkoord') return
    // Het maandtotaal vastleggen: dat maakt het matchen van de bankbetaling
    // mogelijk (zelfde patroon als de BTW-aangifte).
    const bedrag = centNaarEuro(accijnsMaandCent(accRecordsPerMaand[maand] || []))
    zetAccijns(maand, { status: 'ingediend', ingediend_datum: tod(), bedrag, ...(ingelogd ? { ingediend_door: ingelogd } : {}) })
    // Journaal (ERP-plan 2.1): het gecontroleerde maandbedrag als
    // onveranderlijke boeking; een eerdere indiening eerst tegengeboekt.
    setJournaal((prev: any[]) => voegBoekingToe(
      voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'accijns_aangifte', maand)),
      accijnsAangifteBoeking(maand, bedrag, `${t('lbl_accijns_aangifte')} ${maand}`)))
    logAudit(auditLog, setAuditLog, { entiteit: 'Accijnsaangifte', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Aangifte ${maand} → ingediend (€ ${bedrag.toFixed(2)})` })
  }

  // Zonder bankkoppeling op betaald, met de opgegeven betaaldatum.
  const markeerAccijnsBetaald = (maand: string, datum: string) => {
    zetAccijns(maand, { status: 'betaald', betaald_datum: datum })
    setAcc((prev: any[]) => accijnsRecordsBetaald(prev, maand, datum))
    logAudit(auditLog, setAuditLog, { entiteit: 'Accijnsaangifte', entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Aangifte ${maand} → betaald op ${datum} (zonder bankkoppeling)` })
  }

  // ── Handelingen: de controle (beide soorten) ─────────────────────────────
  const auditSoort = (r: AangifteRij) => (r.soort === 'btw' ? 'BTW-aangifte' : 'Accijnsaangifte')
  const auditPeriode = (r: AangifteRij) => (r.soort === 'btw' ? `periode ${r.sleutel}` : `maand ${r.sleutel}`)
  const zetControle = (r: AangifteRij, velden: Record<string, unknown>) => {
    if (r.soort === 'btw') setBtwAangiftes((prev: any[]) => metBtwControle(prev, r.sleutel, velden))
    else zetAccijns(r.sleutel, velden)
  }

  const vraagControle = (r: AangifteRij, controleur: string) => {
    zetControle(r, {
      ...(r.soort === 'accijns' ? { status: 'berekend' } : {}),
      berekend_datum: tod(), berekend_door: ingelogd || undefined, reviewer: controleur.trim(), controle_status: 'open',
    })
    logAudit(auditLog, setAuditLog, {
      entiteit: auditSoort(r), entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `Controle gevraagd aan ${controleur.trim()} — ${auditPeriode(r)}${r.soort === 'accijns' ? ' (status berekend)' : ''}`,
    })
  }

  const legControleVast = (r: AangifteRij, akkoord: boolean, c: ControleInvoer, zelfde: boolean) => {
    const status = akkoord ? 'akkoord' : 'opmerkingen'
    zetControle(r, {
      reviewer: c.controleur.trim(), controle_status: status, controle_datum: new Date().toISOString(),
      controle_door: ingelogd || undefined, bevindingen: c.bevindingen.trim(),
      zelfde_persoon_akkoord: akkoord && zelfde ? true : undefined,
    })
    setConcepten(prev => { const n = { ...prev }; delete n[r.sleutel]; return n })
    logAudit(auditLog, setAuditLog, {
      entiteit: auditSoort(r), entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${r.soort === 'btw' ? 'BTW-controle' : 'Controle'} ${status} door ${c.controleur.trim()} — ${auditPeriode(r)}${c.bevindingen.trim() ? ` (bevindingen: ${c.bevindingen.trim()})` : ''}${akkoord && zelfde ? ' (zelfde persoon als berekenaar: toch akkoord)' : ''}`,
    })
  }

  const heropenControle = (r: AangifteRij) => {
    zetControle(r, { controle_status: 'open' })
    logAudit(auditLog, setAuditLog, { entiteit: auditSoort(r), entiteit_id: 0, actie: 'gewijzigd', omschrijving: `Controle heropend — ${auditPeriode(r)}` })
  }

  // ── Volgende stap: indienen en koppelen (met vijf seconden terugweg) ────
  const planId = (r: AangifteRij, wat: string) => `agf:${r.soort}:${r.sleutel}:${wat}`
  const isBezig = (r: AangifteRij) => (undo.actie?.id || '').startsWith(`agf:${r.soort}:${r.sleutel}:`)

  const planIndienen = (r: AangifteRij) => {
    const label = t('agf_undo_ingediend').replace('{periode}', periodeTitel(r))
    if (r.soort === 'btw') {
      const bedrag = centNaarEuro(r.bedragCent)
      undo.plan(planId(r, 'indienen'), label, () => markeerAangifteIngediend(r.sleutel, bedrag))
    } else {
      undo.plan(planId(r, 'indienen'), label, () => indienenAccijns(r.sleutel))
    }
  }

  const koppel = (r: AangifteRij, tx: any) => {
    if (!tx) return
    if (r.soort === 'btw') koppelBtwBetaling(tx, r.sleutel)
    else koppelAccijnsBetaling(tx, r.sleutel)
    setGekozenTx(prev => { const n = { ...prev }; delete n[r.sleutel]; return n })
  }

  const planBetaald = (r: AangifteRij, datum: string) =>
    undo.plan(planId(r, 'betaald'), t('agf_undo_betaald').replace('{periode}', periodeTitel(r)), () => markeerAccijnsBetaald(r.sleutel, datum))

  const kandidatenVoor = (r: AangifteRij) =>
    betalingKandidaten(bankTransacties, { credit: r.teruggave, bedragCent: r.bedragCent, vanaf: r.van })

  const naarBankImport = () => gaNaarDoel({ pagina: 'bank', actie: 'importeren' })

  const open = (r: AangifteRij, f: Focus = null) => { setGekozen(r.sleutel); setFocus(f) }

  // Het detail opent op de plek van de volgende stap (controle of betaling).
  React.useEffect(() => {
    if (!focus || !gekozenRij) return
    const el = focus === 'controle' ? controleRef.current : betalingRef.current
    el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    setFocus(null)
  }, [focus, gekozenRij])

  // ── De knop in een lijstregel (hooguit één) ──────────────────────────────
  const rijKnop = (r: AangifteRij, telefoon: boolean): React.ReactNode => {
    if (!r.actie || !magSchrijven(r.soort)) return null
    const bezig = isBezig(r)
    const s = telefoon ? 'md' as const : 'sm' as const
    const cls = telefoon ? `${KAART_INTERACTIEF} w-full` : ''
    if (r.actie === 'controleren') {
      return <Btn s={s} cls={cls} onClick={() => open(r, 'controle')}>{t('agf_actie_controleren')}</Btn>
    }
    if (r.actie === 'indienen') {
      // Webshop gekoppeld maar de verkopen nog niet opgehaald: dan klopt
      // rubriek 1a nog niet. Niet meteen indienen vanuit de lijst, maar het
      // detail openen, waar dat staat (met de ophaalknop).
      if (r.soort === 'btw' && wcCreds?.enabled && !wcGeladen) {
        return <Btn s={s} cls={cls} onClick={() => open(r)}>{t('agf_actie_indienen')}</Btn>
      }
      return <Btn s={s} cls={cls} disabled={bezig} onClick={() => planIndienen(r)}>{t('agf_actie_indienen')}</Btn>
    }
    const een = enigVoorstel(kandidatenVoor(r))
    if (een) {
      const label = t(r.teruggave ? 'agf_actie_koppel_teruggave_datum' : 'agf_actie_koppel_datum').replace('{datum}', dagMaand(een.tx.datum))
      return <Btn v="secondary" s={s} cls={cls} disabled={bezig} onClick={() => koppel(r, een.tx)}>{label}</Btn>
    }
    return <Btn v="secondary" s={s} cls={cls} onClick={() => open(r, 'betaling')}>{t(actieSleutel(r) || 'agf_actie_koppel')}</Btn>
  }

  // ── Kop: segment, jaar, jaartotaal, webshop ──────────────────────────────
  const telLabel = (n: number) => n > 0 ? <span className="ml-1.5 px-1.5 rounded-full bg-orange-100 text-orange-800 text-[11px] font-semibold tabular-nums">{n}</span> : null
  const segment = (
    <Segment<AangifteSoort>
      label={t('aangiftes_segment')}
      waarde={tab}
      onKies={setTab}
      cls={smal ? 'w-full' : ''}
      opties={[
        { v: 'btw', aria: `${t('lbl_btw')} · ${t('agf_seg_actie').replace('{n}', String(btwN))}`, l: <>{t('lbl_btw')}{telLabel(btwN)}</> },
        { v: 'accijns', aria: `${t('nav_accijns')} · ${t('agf_seg_actie').replace('{n}', String(accN))}`, l: <>{t('nav_accijns')}{telLabel(accN)}</> },
      ]}
    />
  )

  const jaarKiezer = (
    <div className="inline-flex items-center gap-1 flex-shrink-0" role="group" aria-label={t('agf_jaar')}>
      <button type="button" onClick={() => setJaar(jaar - 1)} aria-label={t('agf_vorig_jaar')} title={t('agf_vorig_jaar')}
        className="w-11 sm:w-8 min-h-tap sm:min-h-0 sm:h-8 inline-flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        <Icon n="chevronLeft" />
      </button>
      <span className="text-base font-semibold text-gray-900 tabular-nums w-12 text-center" aria-live="polite">{jaar}</span>
      <button type="button" onClick={() => setJaar(jaar + 1)} aria-label={t('agf_volgend_jaar')} title={t('agf_volgend_jaar')}
        className="w-11 sm:w-8 min-h-tap sm:min-h-0 sm:h-8 inline-flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        <Icon n="chevronRight" />
      </button>
    </div>
  )

  const totNu = jaar === huidigJaar
  const samenvatting = (() => {
    if (tab === 'btw') {
      const j = btwJaarCijfers(jaar, cijferBron)
      const terug = j.teBetalenCent < 0
      const sleutel = terug ? (totNu ? 'agf_jaar_tot_nu_terug' : 'agf_jaar_terug') : (totNu ? 'agf_jaar_tot_nu_betalen' : 'agf_jaar_betalen')
      // De opbouw van het jaartotaal (de oude jaarkaart: omzet-BTW en
      // voorbelasting) als toelichting bij het bedrag.
      const opbouw = `${t('lbl_omzet_btw')} ${fmtCent(j.omzetBtwCent)} · ${t('lbl_voorbelasting')} ${fmtCent(j.voorbelastingCent)}`
      return (
        <span className="text-sm text-gray-600">
          <span title={t('lbl_aangifte_period_hint')}>{type === 'maand' ? t('lbl_aangifte_maand') : t('lbl_aangifte_kwartaal')}</span>
          {' · '}<span title={opbouw}><MetVet sjabloon={t(sleutel)} vet={fmtCent(Math.abs(j.teBetalenCent))} vars={{ jaar: String(jaar) }} /></span>
          <span className="sr-only"> ({opbouw})</span>
        </span>
      )
    }
    const jaarRecords = (acc || []).filter((a: any) => accijnsMaandKey(a?.datum).startsWith(`${jaar}-`))
    const totaal = accijnsMaandCent(jaarRecords)
    const open = accijnsMaandCent(jaarRecords.filter((a: any) => !a?.betaald))
    return (
      <span className="text-sm text-gray-600">
        {t('lbl_aangifte_maand')}{' · '}
        <MetVet sjabloon={t(totNu ? 'agf_acc_jaar_tot_nu' : 'agf_acc_jaar')} vet={fmtCent(totaal)} vars={{ jaar: String(jaar) }} />
        {open > 0 && <>{' · '}<MetVet sjabloon={t('agf_acc_open')} vet={fmtCent(open)} /></>}
      </span>
    )
  })()

  const webshopKnop = tab === 'btw' && wcCreds?.enabled ? (
    <button type="button" onClick={() => haalWebshop(jaar)} disabled={wcBezig}
      className="wc-btn px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 min-h-tap sm:min-h-0 whitespace-nowrap">
      {wcBezig ? t('btn_aangifte_loading') : wcGeladen ? t('agf_wc_vernieuwen') : t('agf_wc_ophalen')}
    </button>
  ) : null
  const webshopMelding = tab === 'btw' && (wcFout || wcGeladen) ? (
    wcFout
      ? <p role="alert" className="text-sm text-red-700">{wcFout}</p>
      : <p className="text-xs text-green-700">{t('msg_aangifte_loaded').replace('{n}', String(wcOrders.length)).replace('{year}', String(jaar))}</p>
  ) : null

  // ── Detail van de gekozen periode ────────────────────────────────────────
  const detail = (() => {
    const r = gekozenRij
    if (!r) return null
    const schrijf = magSchrijven(r.soort)
    const bezig = isBezig(r)
    const recControle = r.soort === 'btw' ? { ...(r.controleRecord || {}), ingediend_door: r.ingediendDoor || undefined } : r.controleRecord
    const concept = concepten[r.sleutel] ?? leegConcept(r.controleRecord)
    const setConcept = (c: ControleInvoer) => setConcepten(prev => ({ ...prev, [r.sleutel]: c }))
    const opties = controleurOpties(rollen, [ingelogd, r.controleRecord?.reviewer])
    const voorIndienen = !r.totNu && !r.afgerond && r.stap !== 'ingediend'
    const toonControle = !r.totNu && (voorIndienen || r.controle === 'akkoord' || !!r.controleRecord?.reviewer)
    const akkoordBlokkade = controleBlokkade(concept, recControle, true)
    const opmerkingenBlokkade = controleBlokkade(concept, recControle, false)
    const zelfde = zelfdePersoon(concept.controleur, [recControle?.berekend_door, recControle?.ingediend_door])
    const aanvraagBlokkade = concept.controleur.trim() ? null : 'agf_reden_geen_controleur'
    const kandidaten = kandidatenVoor(r)
    const heeftKandidaten = kandidaten.voorgesteld.length + kandidaten.overig.length > 0
    const txSleutel = gekozenTx[r.sleutel] ?? (enigVoorstel(kandidaten)?.sleutel || '')
    const txGekozen = txSleutel ? (bankTransacties || []).find((x: any) => txKey(x) === txSleutel) || null : null
    // Achteraf het betaalbewijs koppelen (oude AccijnsPage): een maand die op
    // betaald staat zonder banktransactie. Niet bij een nulaangifte: daar
    // komt nooit een betaling.
    const retro = r.soort === 'accijns' && !r.betaling && !r.totNu && r.einde !== 'nihil' && (r.afgerond || (r.boekingenBetaald && r.stap !== 'ingediend'))
    const toonBetaling = !!r.betaling || r.stap === 'ingediend' || retro
    const datum = betaalDatum[r.sleutel] || tod()

    // De ene primaire knop van de actiebalk: de volgende stap.
    let primair: { label: string, onClick: () => void, disabled?: boolean } | null = null
    if (schrijf && !r.totNu && !r.afgerond) {
      if (r.stap === 'berekend' && r.controle === 'open') {
        primair = { label: t('agf_btn_vraag_controle'), disabled: !!aanvraagBlokkade, onClick: () => vraagControle(r, concept.controleur) }
      } else if (r.stap === 'berekend') {
        primair = { label: t('controle_btn_akkoord'), disabled: !!akkoordBlokkade, onClick: () => legControleVast(r, true, concept, zelfde) }
      } else if (r.stap === 'gecontroleerd') {
        primair = { label: t('agf_actie_indienen'), disabled: bezig, onClick: () => planIndienen(r) }
      } else if (r.stap === 'ingediend') {
        primair = heeftKandidaten
          ? { label: t(actieSleutel(r) || 'agf_actie_koppel'), disabled: !txGekozen, onClick: () => koppel(r, txGekozen) }
          : { label: t('btn_afschrift_importeren'), onClick: naarBankImport }
      }
    }

    const ondertitel = `${r.soort === 'btw' ? t('lbl_btw_aangifte') : t('lbl_accijns_aangifte')} · ${vul({ sleutel: 'periode_omschr_bereik', vars: { van: dagNotatie(r.van), tot: dagNotatie(r.tot) } })}`

    // Indienen: wanneer, door wie en voor welk bedrag — of waarom het nog niet kan.
    // Accijns: een maand die via de bank (achteraf) op betaald kwam zonder ooit
    // ingediend te zijn heeft geen indiendatum; die telt hier niet als ingediend.
    const ingediendRec = r.soort === 'btw'
      ? (btwAangiftes || []).find((a: any) => a?.periodeKey === r.sleutel) || null
      : (r.controleRecord && (r.controleRecord.status === 'ingediend' || (r.controleRecord.status === 'betaald' && r.controleRecord.ingediend_datum)) ? r.controleRecord : null)
    // Afgerond zonder indiening (een betaling die vóór het indienen gekoppeld
    // werd): niets meer in te dienen — de oude periodekaart bood dat ook niet.
    const indienBlok = r.totNu || (r.afgerond && !ingediendRec) ? null : (
      <section aria-label={t('agf_indienen')} className="border-t border-gray-100 pt-3 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">{t('agf_indienen')}</h3>
        {ingediendRec ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 min-w-0 text-sm text-gray-800">
              {(ingediendRec.ingediend_door
                ? t('agf_ingediend_op_door').replace('{naam}', ingediendRec.ingediend_door)
                : t('lbl_aangifte_ingediend_op')).replace('{datum}', dagNotatie(String(ingediendRec.ingediend_datum || '')))}
              {' · '}<span className="font-semibold tabular-nums">{fmtCent(Math.abs(r.bedragCent))}</span>
              {r.teruggave && <span className="text-gray-500"> ({t('agf_bedrag_terug')})</span>}
            </p>
            {r.soort === 'btw' && schrijf && !r.betaling && (
              <BevestigKnop v="secondary" s="sm" vraag={t('agf_terugzetten_vraag')} onBevestig={() => ontkoppelAangifteIngediend(r.sleutel)}>
                {t('agf_terugzetten')}
              </BevestigKnop>
            )}
            {r.einde === 'nihil' && <p className="w-full text-xs text-gray-500">{t('agf_nihil_uitleg')}</p>}
          </div>
        ) : r.controle === 'akkoord' ? (
          <p className="text-sm text-gray-700">
            <MetVet sjabloon={t(r.soort === 'btw' ? 'agf_indienen_uitleg_btw' : 'agf_indienen_uitleg_accijns')} vet={fmtCent(Math.abs(r.bedragCent))} />
          </p>
        ) : r.soort === 'btw' ? (
          schrijf ? (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-600">{t('agf_indienen_na_controle_btw')}</p>
              <BevestigKnop v="secondary" s="sm" vraag={t('agf_indienen_zonder_controle_vraag')} onBevestig={() => planIndienen(r)} disabled={bezig}>
                {t('agf_indienen_zonder_controle')}
              </BevestigKnop>
            </div>
          ) : <p className="text-xs text-gray-600">{t('agf_indienen_na_controle_btw')}</p>
        ) : (
          <div className="space-y-1.5">
            <Btn v="secondary" s="sm" disabled>{t('agf_actie_indienen')}</Btn>
            <p className="text-xs text-gray-600">{t('agf_indienen_geblokkeerd')}</p>
          </div>
        )}
      </section>
    )

    const c = r.soort === 'btw' ? (() => { const p = periodeVan(r.sleutel); return p ? cijfersVan(p) : null })() : null
    const records = r.soort === 'accijns' ? (accRecordsPerMaand[r.sleutel] || []) : []
    const perBatch = (weergave[r.sleutel] || (r.totNu ? 'uitslag' : 'batch')) === 'batch'

    return (
      <DetailPaneel
        key={`${r.soort}-${r.sleutel}`}
        titel={periodeTitel(r)}
        ondertitel={ondertitel}
        onSluit={() => setGekozen(null)}
        kopExtra={<Pil rij={r} />}
        terugLabel={t('nav_aangiftes')}
        acties={primair ? <Btn cls="flex-1" disabled={primair.disabled} onClick={primair.onClick}>{primair.label}</Btn> : undefined}
      >
        <div className="space-y-3">
          <StappenBalk rij={r} volledig />
          {r.totNu && (
            <p className="text-xs text-gray-600 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              {t('agf_lopend_uitleg').replace('{datum}', dagNotatie(r.tot))}
            </p>
          )}

          {r.soort === 'btw' && c && (
            <>
              <BtwRubrieken c={c} teBetalenCent={c.teBetalenCent} alle={alleRubrieken} setAlle={setAlleRubrieken}
                tariefOpen={tariefOpen} setTariefOpen={setTariefOpen} />
              <p className="text-xs text-gray-500">
                {t('agf_telling').replace('{verkoop}', String(c.aantalVerkoop)).replace('{inkoop}', String(c.aantalInkoop))}
                {c.aantalWc > 0 && t('agf_telling_wc').replace('{wc}', String(c.aantalWc))}
                <br />
                {t('lbl_verkoop_netto')} <span className="tabular-nums text-gray-700">{fmtCent(c.verkoopNettoCent)}</span>
                {' · '}{t('lbl_inkoop_netto')} <span className="tabular-nums text-gray-700">{fmtCent(c.inkoopNettoCent)}</span>
              </p>
              {!wcCreds?.enabled && <p className="text-xs text-gray-500">{t('msg_wc_inactive_vat')}</p>}
              {wcCreds?.enabled && !wcGeladen && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                  <span className="flex-1 min-w-0 text-xs text-orange-900">{t('agf_wc_niet_geladen')}</span>
                  <button type="button" onClick={() => haalWebshop(jaar)} disabled={wcBezig}
                    className="text-xs font-medium t-accent-text hover:underline min-h-tap sm:min-h-0 disabled:opacity-40">
                    {wcBezig ? t('btn_aangifte_loading') : t('agf_wc_ophalen')}
                  </button>
                </div>
              )}
              {c.sndCent > 0 && (
                <p className="text-xs text-gray-600 flex items-center justify-between gap-2">
                  <span>{t('statiegeld_snd_in_periode')}</span>
                  <span className="font-semibold tabular-nums text-gray-900">{fmtCent(c.sndCent)}</span>
                </p>
              )}
            </>
          )}

          {r.soort === 'accijns' && (
            <div className="space-y-2">
              {records.length > 0 && (
                <Segment<'batch' | 'uitslag'>
                  klein={!telefoon}
                  label={t('agf_acc_weergave')}
                  waarde={perBatch ? 'batch' : 'uitslag'}
                  onKies={v => setWeergave(prev => ({ ...prev, [r.sleutel]: v }))}
                  opties={[{ v: 'batch', l: t('agf_acc_per_batch') }, { v: 'uitslag', l: t('agf_acc_per_uitslag') }]}
                />
              )}
              <AccijnsBoekingen records={records} bat={bat} uit={uit} av={av} perBatch={perBatch} />
              {r.boekingenBetaald && !r.afgerond && (
                <p className="text-xs text-gray-600">{t('agf_acc_boekingen_betaald')}</p>
              )}
            </div>
          )}

          {toonControle && (
            <ControleBlok
              ref={controleRef}
              soort={r.soort}
              fase={r.controle}
              rec={recControle}
              ingelogd={ingelogd}
              opties={opties}
              concept={concept}
              setConcept={setConcept}
              blokkade={r.controle === 'open' ? aanvraagBlokkade : akkoordBlokkade}
              vast={!voorIndienen}
              magSchrijven={schrijf}
              onOpmerkingen={() => legControleVast(r, false, concept, false)}
              opmerkingenBlokkade={opmerkingenBlokkade}
              onWijzigen={() => heropenControle(r)}
            />
          )}

          {indienBlok}

          {toonBetaling && (
            <BetalingBlok
              ref={betalingRef}
              rij={r}
              kandidaten={kandidaten}
              gekozen={txSleutel}
              setGekozen={k => setGekozenTx(prev => ({ ...prev, [r.sleutel]: k }))}
              magSchrijven={schrijf}
              bezig={bezig}
              onOntkoppel={() => (r.soort === 'btw' ? ontkoppelBtwBetaling(r.sleutel) : ontkoppelAccijnsBetaling(r.sleutel))}
              onImporteren={primair?.onClick === naarBankImport ? null : naarBankImport}
              achteraf={retro}
              onKoppelHier={retro ? () => koppel(r, txGekozen) : null}
              handmatig={r.soort === 'accijns' && r.stap === 'ingediend'
                ? { datum, setDatum: d => setBetaalDatum(prev => ({ ...prev, [r.sleutel]: d })), onMarkeer: () => planBetaald(r, datum) }
                : null}
            />
          )}
        </div>
      </DetailPaneel>
    )
  })()

  // ── Lege staat ───────────────────────────────────────────────────────────
  const leeg = tab === 'btw'
    ? <LegeStaat titel={t('agf_leeg_btw').replace('{jaar}', String(jaar))} icoon="calendar">
        {jaar > huidigJaar && <Btn v="secondary" onClick={() => setJaar(huidigJaar)}>{t('agf_naar_dit_jaar')}</Btn>}
      </LegeStaat>
    : <LegeStaat titel={t('agf_leeg_accijns').replace('{jaar}', String(jaar))} icoon="calendar">
        {jaar !== huidigJaar && <Btn v="secondary" onClick={() => setJaar(huidigJaar)}>{t('agf_naar_dit_jaar')}</Btn>}
      </LegeStaat>

  return (
    <div className="space-y-3 min-w-0">
      {smal ? (
        <div className="space-y-2">
          {segment}
          <div className="flex items-center gap-2 min-w-0">
            {jaarKiezer}
            <div className="flex-1 min-w-0 text-right leading-snug">{samenvatting}</div>
          </div>
          {webshopKnop && <div className="flex">{webshopKnop}</div>}
          {webshopMelding}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
            {segment}
            {jaarKiezer}
            <span className="flex-1" />
            {samenvatting}
            {webshopKnop}
          </div>
          {webshopMelding}
        </div>
      )}

      {anderJaar && (
        <button type="button" onClick={() => setJaar(anderJaar.jaar)}
          className="text-sm font-medium t-accent-text hover:underline min-h-tap sm:min-h-0 text-left">
          {t(tab === 'btw'
            ? (anderJaar.n === 1 ? 'agf_ander_jaar_btw_1' : 'agf_ander_jaar_btw_n')
            : (anderJaar.n === 1 ? 'agf_ander_jaar_acc_1' : 'agf_ander_jaar_acc_n'))
            .replace('{n}', String(anderJaar.n)).replace('{jaar}', String(anderJaar.jaar))}
        </button>
      )}

      <LijstMetDetail
        open={!!detail}
        detail={detail}
        lijst={(
          <PeriodeLijst
            rijen={rijen}
            naastDetail={!!detail}
            gekozen={gekozenRij ? gekozenRij.sleutel : null}
            onKies={r => open(r)}
            knop={rijKnop}
            label={tab === 'btw' ? t('agf_lijst_btw') : t('agf_lijst_accijns')}
            leeg={leeg}
          />
        )}
      />
    </div>
  )
}

export default AangiftesSectie
