import React from 'react'
import { t } from '../../i18n'
import { tod, ymd, r2, r3 } from '../../utils/format'
import { newId, ADDON_BASE, volgendFactuurNummer, inboxStatus } from '../../utils/api'
import { resolveKlantSnapshot, findLiveKlant } from '../../utils/klant'
import { betalingstermijnVoor, breweryMetTermijn, vervaldatumTekst, isoDag, INKOOP_ACHTERSTALLIG_DAGEN } from '../../utils/facturen'
import { logAudit } from '../../utils/audit'
import { magFactuurMuteren } from '../../utils/btw'
import { csvTekst, csvBedrag, inkoopRegelExport } from '../../utils/csv'
import { bouwInkoopRegels } from '../../utils/inkoopOntvangst'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, stornoBoekingVoor, voegBoekingToe } from '../../utils/journaal'
import { totaliseerRegels, inkoopRegelsMetCorrectie } from '../../utils/centen'
import { bouwUbl, controleerUbl } from '../../utils/ubl'
import InkoopFactuurModal from '../../components/InkoopFactuurModal'
import { registreerScanCorrectie, leerKoppelingen } from '../../utils/scanGeheugen'
import InkoopInbox from '../../components/InkoopInbox'
import { InkoopInboxItem, imapActief, inboxFactuurVerwijderd, inboxVerwerkt, telInboxOpen, inboxOpen, inboxFoutSleutel } from '../../utils/inkoopInbox'
import { boekMerchMutaties } from '../../utils/merch'
import { printFactuur, buildFactuurHTML, printHerinnering, buildHerinneringHTML } from '../../components/PakbonExport'
import MailModal from '../../components/MailModal'
import { herbruikbareBetaallink, betaallinkRecord } from '../../utils/mollieLink'
import { htmlToPdfBase64 } from '../../utils/pdf'
import { qrDataUrl } from '../../utils/qr'
import { factuurMailBetaalVars } from '../../utils/factuurMail'
import { uploadBijlage, uploadFoutSleutel } from '../../utils/bijlage'
import {
  FACTUUR_STATUS_FILTERS, INKOOP_STATUS_FILTERS, filterVerkoopFacturen, filterInkoopFacturen,
  telVerkoopStatussen, telInkoopStatussen, verkoopTotalen, inkoopTotalen, periodeGeldtVoorStatus,
  leesFactuurFilter, verkoopCenten, inkoopCenten, zelfdeLeverancier,
  type FactuurStatusFilter, type InkoopStatusFilter, type LijstTotalen,
} from '../../utils/factuurFilter'
import { periodeBereik, OPEN_BEREIK, STANDAARD_PERIODE } from '../../utils/periode'
import {
  verkoopStand, verkoopPrimaireActie, inkoopStand, inkoopVerlegd, bankBetalingVoor, bestellingRef,
  verkoopTijdlijn, HERINNERING_SLEUTEL, type HerinneringNiveau, type VerkoopActie, type VerkoopStand,
} from '../../utils/factuurTijdlijn'
import Btn from '../../components/ui/Btn'
import Icon from '../../components/ui/Icon'
import LegeStaat from '../../components/ui/LegeStaat'
import FilterBalk from '../../components/ui/FilterBalk'
import ResponsiveLijst from '../../components/ui/ResponsiveLijst'
import { LijstMetDetail } from '../../components/ui/DetailPaneel'
import { useGedeeldePeriode, zetGedeeldePeriode } from '../../components/ui/useGedeeldePeriode'
import { useSmalScherm } from '../../components/ui/useSmalScherm'
import Segment from '../../components/inkoop/Segment'
import { useAdmin, fmt } from './adminContext'
import VerkoopDetail, { type BetaallinkStatus } from './facturen/VerkoopDetail'
import InkoopDetail from './facturen/InkoopDetail'
import LosseFactuurModal from './facturen/LosseFactuurModal'
import AltRekeningKiezer from './facturen/AltRekeningKiezer'
import UblWaarschuwing from './facturen/UblWaarschuwing'
import Melding from './facturen/Melding'
import type { DetailKnop } from './facturen/DetailKnoppen'
import { verkoopKolommen, verkoopKaart, inkoopKolommen, inkoopKaart } from './facturen/lijsten'

// ── Facturen (Administratie) ────────────────────────────────────────────────
// Verkoop- en inkoopfacturen op één plek, met Verkoop | Inkoop als segment.
// Eén filterbalk (zoeken, status als chips met aantallen, de gedeelde
// periode, klant of leverancier), één totaalregel die rekent met wat je ziet,
// een lijst die op een telefoon kaarten wordt, en het detail ernaast (op een
// telefoon een eigen scherm): wat er met de factuur gebeurd is en alle
// handelingen. Per rij staat één handeling die bij de status past.
//
// De filterregels (wat telt als open, te laat, binnen de periode) staan in
// utils/factuurFilter.ts, de stand en de tijdlijn van een factuur in
// utils/factuurTijdlijn.ts — geen eigen sommetjes hier. De handelingen zelf
// (betaald, herinnering, mailen, PDF/UBL, verrekenen, losse factuur, inkoop
// boeken en bewerken, postvak) zijn ongewijzigd overgenomen; alleen de weg
// ernaartoe is nieuw. De gedeelde administratie (rollover, alt-rekeningschuld,
// voorraadboeking) komt uit de context van AdministratiePage.

type Tab = 'verkoop' | 'inkoop'

/** Is het venster minstens zo breed? (Naast een open detail is de lijst smaller.) */
function useMinBreedte(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [ok, setOk] = React.useState<boolean>(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const wissel = () => setOk(mq.matches)
    wissel()
    mq.addEventListener?.('change', wissel)
    return () => mq.removeEventListener?.('change', wissel)
  }, [query])
  return ok
}

/** Klant of leverancier als extra filter: in de balk (bureau) of het filterpaneel (telefoon). */
const RelatieFilter: React.FC<{
  label: string, alle: string, waarde: string, onKies: (v: string) => void,
  opties: { v: string, l: string }[], gestapeld: boolean,
}> = ({ label, alle, waarde, onKies, opties, gestapeld }) => {
  const id = React.useId()
  return (
    <div className={gestapeld ? 'w-full' : 'min-w-0'}>
      {gestapeld && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <select id={id} value={waarde} onChange={e => onKies(e.target.value)} aria-label={gestapeld ? undefined : label}
        className={`border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap md:min-h-0 bg-white t-input outline-none shadow-sm ${gestapeld ? 'w-full' : 'w-full md:w-auto md:max-w-[14rem]'}`}>
        <option value="">{alle}</option>
        {opties.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  )
}

/**
 * De totaalregel onder de filterbalk: aantal, samen, waarvan te laat. Op een
 * telefoon ook netto en BTW: de totaalrij onder de tabel (voetCellen) is er
 * alleen op het bureau, en vroeger stonden die twee bedragen ook op de
 * telefoon (de inkoopkaartjes, de tabelvoet).
 */
const Samenvatting: React.FC<{
  tot: LijstTotalen, teLaatTonen: boolean, onTeLaat: () => void, periodeUit: boolean,
  smal: boolean, btwLabel: string,
}> = ({ tot, teLaatTonen, onTeLaat, periodeUit, smal, btwLabel }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 px-1" aria-live="polite">
    <span>{tot.aantal === 1 ? t('fct_som_aantal_1') : t('fct_som_aantal').replace('{n}', String(tot.aantal))}</span>
    <span>{t('fct_som_samen')} <b className="text-gray-900 tabular-nums">{fmt(tot.bruto)}</b></span>
    {smal && tot.aantal > 0 && (
      <span className="tabular-nums text-gray-500">
        {t('lbl_netto')} {fmt(tot.netto)} · {btwLabel} {fmt(tot.btw)}
      </span>
    )}
    {teLaatTonen && tot.te_laat_aantal > 0 && (
      <button type="button" onClick={onTeLaat}
        className="inline-flex items-center min-h-tap sm:min-h-0 text-red-700 font-medium hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        {t('fct_som_waarvan_te_laat').replace('{n}', String(tot.te_laat_aantal)).replace('{bedrag}', fmt(tot.te_laat_bruto))}
      </button>
    )}
    {periodeUit && <span className="text-gray-500">{t('fct_som_periode_uit')}</span>}
  </div>
)

/**
 * Het postvak meldt een fout (verbinding, inlog, map …) terwijl je naar de
 * inkooplijst kijkt. Vroeger stond de postvakkaart altijd boven die lijst;
 * nu zit hij achter "Te verwerken", en dan mag een postvak dat niets meer
 * ophaalt niet stil blijven.
 */
const PostvakFout: React.FC<{ tekst: string, onBekijk: () => void }> = ({ tekst, onBekijk }) => (
  <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2">
    <span className="min-w-0 break-words">⚠ {t('fct_postvak_fout').replace('{fout}', tekst)}</span>
    <button type="button" onClick={onBekijk}
      className="inline-flex items-center min-h-tap sm:min-h-0 font-medium underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
      {t('fct_postvak_bekijk')}
    </button>
  </div>
)

function FacturenSectie() {
  const {
    navDoel, gaNaarDoel, inkoopFacturen, setInkoopFacturen, ing, lots, onderdelen,
    claudeCreds, ingTypes, ingTypeBtw, verkoopFacturen, setVerkoopFacturen, bestellingen,
    setPage, setOpenOrderId, breweryDetails, factuurLogo, klanten,
    bankKoppelingen, altRekeningen, auditLog, setAuditLog, kostenSoorten,
    smtpCreds, mollieCreds, appName, logo, mailTemplates, scanCorrecties,
    setScanCorrecties, setJournaal, merchArtikelen, setMerchArtikelen, merchVoorraadLog,
    setMerchVoorraadLog, inkoopInbox, setInkoopInbox, refreshInkoopInbox, imapCreds, onNaarPostvakInstellingen,
    bankTransacties, klantNaamVoor, schuldPerAltRekening, knownLeveranciers, btwBetaaldePerioden, btwIngediendeKeys,
    btwPeriodeType, getRolloverInfo, boekInkoopVoorraad, markeerBetaald,
  } = useAdmin()
  const smal = useSmalScherm()
  // Naast een open detail: netto en BTW pas vanaf 1600 px, de rij-handeling
  // pas vanaf 1024 px (daaronder staat hij in het detail zelf).
  const ruim = useMinBreedte(1600)
  const breed = useMinBreedte(1024)

  // ── Navigatiedoel (dashboard, attentie, klantkaart) ────────────────────────
  // tab = verkoop|inkoop; filter = een status ('open', 'te_laat', 'betaald',
  // 'credit', 'alles', 'te_verwerken' = het postvak), 'klant:<id>' of
  // 'leverancier:<naam>' (leesFactuurFilter); id = die factuur meteen in het
  // detail; actie 'nieuw' = meteen het formulier voor een nieuwe factuur.
  // Alleen in de beginstand: AdministratiePage meldt het doel als verwerkt.
  const [start] = React.useState(() => {
    const g = leesFactuurFilter(navDoel?.filter)
    const tab: Tab = navDoel?.tab === 'inkoop' ? 'inkoop'
      : navDoel?.tab === 'verkoop' ? 'verkoop'
        : g.status === 'te_verwerken' || g.leverancier ? 'inkoop' : 'verkoop'
    const id = navDoel?.id !== undefined && navDoel?.id !== null && Number.isFinite(Number(navDoel.id)) ? Number(navDoel.id) : null
    return { g, tab, id, nieuw: navDoel?.actie === 'nieuw' }
  })
  const startTab = start.tab
  const startNieuw = start.nieuw
  const [tab, setTab] = React.useState<Tab>(startTab)

  // Filters per segment; de periode is gedeeld met Bank en Rapporten.
  const [statusVerkoop, setStatusVerkoop] = React.useState<FactuurStatusFilter>(
    startTab === 'verkoop' && start.g.status && start.g.status !== 'te_verwerken' ? start.g.status : 'alles')
  const [statusInkoop, setStatusInkoop] = React.useState<InkoopStatusFilter>(
    startTab === 'inkoop' && start.g.status ? start.g.status : 'alles')
  const [zoekVerkoop, setZoekVerkoop] = React.useState('')
  const [zoekInkoop, setZoekInkoop] = React.useState('')
  const [klantFilter, setKlantFilter] = React.useState(start.g.klantId !== undefined ? String(start.g.klantId) : '')
  const [leverancierFilter, setLeverancierFilter] = React.useState(start.g.leverancier || '')
  const [gekozenVerkoop, setGekozenVerkoop] = React.useState<number | null>(startTab === 'verkoop' ? start.id : null)
  const [gekozenInkoop, setGekozenInkoop] = React.useState<number | null>(startTab === 'inkoop' ? start.id : null)
  const [periodeKeuze, setPeriodeKeuze, periodeEigen, setPeriodeEigen] = useGedeeldePeriode()
  const bereik = React.useMemo(() => periodeBereik(periodeKeuze, new Date(), periodeEigen), [periodeKeuze, periodeEigen])
  // Volgorde op factuurdatum: nieuwste eerst, of (zoals vroeger met een klik op
  // de datumkop van de inkooplijst) oudste eerst.
  const [oplopend, setOplopend] = React.useState(false)

  // Meldingen die vroeger een alert() waren: een balk bovenin die niets blokkeert.
  const [melding, setMelding] = React.useState<string | null>(null)
  const sluitMelding = React.useCallback(() => setMelding(null), [])
  // E-factuur met ontbrekende gegevens: eerst de lijst tonen (vroeger confirm()).
  const [ublVraag, setUblVraag] = React.useState<{ factuur: any, problemen: string[] } | null>(null)

  const now = new Date();
  const vandaagIso = isoDag(now)
  const [showVrijeFactuur, setShowVrijeFactuur] = React.useState(startTab === 'inkoop' && startNieuw);
  // Factuur uit het postvak (facturen per e-mail) die in het inkoopformulier wordt verwerkt.
  const [inboxVerwerk, setInboxVerwerk] = React.useState<InkoopInboxItem|null>(null);
  const [editingFactuur, setEditingFactuur] = React.useState(null);
  const [showLosseFactuur, setShowLosseFactuur] = React.useState(startTab === 'verkoop' && startNieuw);
  const emptyLosseRegel = () => ({omschrijving:'', hoeveelheid:'1', prijs_per_stuk:'', btw_pct:'21'})
  // Geen factuurnummer in het formulier: dat geeft de server bij het opslaan
  // uit (POST /api/nextnr), net als bij kassa en bestellingen.
  const emptyLosseFactuur = () => ({datum:tod(), klant_id:null, klant_naam:'', klant_straat:'', klant_postcode:'', klant_stad:'', klant_btw_nummer:'', regels:[emptyLosseRegel()]})
  const [losseFactuurForm, setLosseFactuurForm] = React.useState<any>(emptyLosseFactuur())
  // Loopt het ophalen van het nummer nog? Dan kan een tweede klik geen tweede
  // nummer (en een tweede factuur) opleveren.
  const [losseFactuurBezig, setLosseFactuurBezig] = React.useState(false)
  // Fout bij het opslaan (geen nummer van de server): in het formulier zelf.
  const [losseFactuurFout, setLosseFactuurFout] = React.useState<string | null>(null)
  const losseRegelsGevuld = (regels: any[]): boolean =>
    (regels || []).some((r: any) => String(r?.omschrijving || '').trim() || Number(r?.prijs_per_stuk))


  // ── Alternatieve betaalrekeningen — modal-state voor "betaald via alt"
  // (de aflossing aan een alt-rekening hoort bij Bank). Zie ook
  // InstellingenPage waar de rekeningen beheerd worden.
  const [betaalViaAltFactuurId, setBetaalViaAltFactuurId] = React.useState<number|null>(null)

  const markeerBetaaldViaAlt = (factuurId: number, altRekeningId: number) => {
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status:'betaald', betaald_via_alt_id: altRekeningId, betaald_datum: f.betaald_datum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Betaald via ${r?.naam||'alt. rekening'}`})
  }

  const ontkoppelBetaaldViaAlt = (factuurId: number) => {
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status:'open', betaald_via_alt_id: undefined, betaald_datum: undefined} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Betaling via alt. rekening ongedaan gemaakt'})
  }

  // Inkoopfactuur met de hand op betaald (zonder bankkoppeling): zelfde
  // vastlegging als de koppeling vanuit Bank, met een al bekende betaaldatum
  // behouden en anders vandaag.
  const markeerInkoopBetaald = (factuurId: number) => {
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald', betaald_datum: f.betaald_datum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → betaald'})
  }

  // ── Verkoopfactuur verrekenen met alt-rekening-schuld (aflossing in natura) ──
  // Bijv. bier geleverd aan de eigenaar: de factuur wordt niet per bank betaald
  // maar lost de schuld aan de privé/alt-rekening af voor het brutobedrag.
  // Omzet, BTW en accijns blijven gewoon via de factuur/bestelling lopen.
  const [verrekenFactuurId, setVerrekenFactuurId] = React.useState<number|null>(null)

  const verrekenMetAltRekening = (factuurId: number, altRekeningId: number) => {
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald', verrekend_alt_id: altRekeningId, betaald_datum: f.betaald_datum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Verrekend met schuld aan ${r?.naam||'alt. rekening'}`})
  }

  const ontkoppelVerrekening = (factuurId: number) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'open', verrekend_alt_id: undefined, betaald_datum: undefined} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Verrekening met alt. rekening ongedaan gemaakt'})
  }

  // ── Bijlage bij een inkoopfactuur toevoegen ─────────────────────────────────
  // De bestandsinvoer staat buiten het detail (dat wisselt van indeling als
  // het venster over 768 px gaat): een foto of PDF die binnenkomt terwijl het
  // detail opnieuw is opgebouwd, komt zo toch aan.
  const bijlageInvoer = React.useRef<HTMLInputElement | null>(null)
  const bijlageVoor = React.useRef<number | null>(null)
  const [bijlageBezig, setBijlageBezig] = React.useState<number | null>(null)
  const kiesBijlage = (factuurId: number) => {
    bijlageVoor.current = factuurId
    bijlageInvoer.current?.click()
  }
  const uploadBijlageVoorFactuur = async (factuurId: number, file: File) => {
    setBijlageBezig(factuurId)
    // utils/bijlage.ts: bewaart de naam die de server teruggeeft en meldt een
    // mislukte upload (vroeger viel die stil weg).
    const u = await uploadBijlage(file, 'inkoop')
    if (u.ok && u.bijlage) {
      const bijlage = u.bijlage
      setInkoopFacturen((prev: any) => prev.map((f: any) =>
        f.id === factuurId ? {...f, bijlage} : f
      ))
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:`Bijlage "${file.name}" geüpload`})
    } else {
      setMelding(t(uploadFoutSleutel(u.status)).replace('{naam}', u.naam))
    }
    setBijlageBezig(null)
  }

  const deleteFactuur = (id: any) => {
    const f = inkoopFacturen.find((x: any)=>x.id===id);
    // Periode-lock (ERP-plan 0.4): facturen in een ingediende/betaalde
    // BTW-periode mogen niet meer verdwijnen — de aangiftecijfers zouden
    // stil veranderen.
    if (f && !magFactuurMuteren(f, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)) {
      setMelding(t('err_periode_gesloten_mutatie')); return;
    }
    // De bevestiging zit in de knop zelf (BevestigKnop in het detail).
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'verwijderd', omschrijving:`${f?.leverancier||''} — ${f?.factuurnummer||''}`});
    if (f?.bijlage?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${f.bijlage.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setInkoopFacturen((prev: any) => prev.filter((f: any)=>f.id!==id));
    // Kwam de factuur uit het postvak, dan wacht de PDF daar weer op verwerking:
    // het bewijsstuk blijft dus nooit zonder factuur of postvakitem achter.
    if ((inkoopInbox||[]).some((i: any) => i?.status === 'verwerkt' && i?.factuur_id === id)) {
      setInkoopInbox((prev: any) => inboxFactuurVerwijderd(prev || [], id));
    }
    // Journaal (ERP-plan 2.1): regels verdwijnen nooit — verwijderen van een
    // (nog muteerbare) factuur wordt een tegenboeking.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', id)));
    if (gekozenInkoop===id) setGekozenInkoop(null);
  };

  const saveLosseVerkoopFactuur = async () => {
    if (losseFactuurBezig) return
    // Eerst valideren, pas daarna het nummer ophalen: een afgebroken opslag
    // verbruikt zo geen nummer (gat in de reeks).
    if (!(losseFactuurForm.klant_naam||'').trim() || !losseRegelsGevuld(losseFactuurForm.regels)) return
    // Het factuurnummer komt altijd uit de doorlopende serverreeks (ERP-plan
    // 0.2) — nooit vrij getypt: een leeg of al uitgegeven nummer werd hier
    // eerder meteen definitief en in het journaal geboekt.
    setLosseFactuurBezig(true)
    setLosseFactuurFout(null)
    let factuurNummer: string
    try { factuurNummer = await volgendFactuurNummer('factuur') }
    catch { setLosseFactuurBezig(false); setLosseFactuurFout(t('err_factuurnummer_ophalen')); return }
    setLosseFactuurBezig(false)
    const regels = (losseFactuurForm.regels||[]).map((r: any) => {
      const qty = Number(r.hoeveelheid)||0
      const prijs = Number(r.prijs_per_stuk)||0
      const pct = Number(r.btw_pct)||0
      const netto = r2(qty * prijs)
      const btw_bedrag = r2(netto * pct / 100)
      return {...r, hoeveelheid: qty, prijs_per_stuk: prijs, btw_pct: pct, netto, btw_bedrag, bruto: r2(netto + btw_bedrag)}
    })
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    const totalen = totaliseerRegels(regels)
    // Zelfde rollover als bij inkoop: een teruggedateerde factuur in een al
    // ingediende of betaalde BTW-periode telt mee in de lopende aangifte, niet
    // stil in de ingediende (die cijfers veranderen nooit meer).
    const rollover = getRolloverInfo(losseFactuurForm.datum)
    const nieuw = {
      id: newId(verkoopFacturen||[]),
      ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
      datum: losseFactuurForm.datum,
      factuurnummer: factuurNummer,
      klant_id: losseFactuurForm.klant_id || null,
      klant_naam: losseFactuurForm.klant_naam.trim(),
      klant_straat: losseFactuurForm.klant_straat?.trim() || '',
      klant_postcode: losseFactuurForm.klant_postcode?.trim() || '',
      klant_stad: losseFactuurForm.klant_stad?.trim() || '',
      klant_btw_nummer: losseFactuurForm.klant_btw_nummer?.trim() || '',
      status: 'open',
      definitief: true,
      regels,
      netto: totalen.netto,
      btw: totalen.btw,
      bruto: totalen.bruto,
      netto_cent: totalen.netto_cent,
      btw_cent: totalen.btw_cent,
      bruto_cent: totalen.bruto_cent,
    }
    setVerkoopFacturen((prev: any) => [...(prev||[]), nieuw])
    // Journaal (ERP-plan 2.1): losse verkoopfactuur is direct definitief → boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(nieuw)))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`${nieuw.klant_naam||''} — ${nieuw.factuurnummer||''}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    setShowLosseFactuur(false)
    setLosseFactuurForm(emptyLosseFactuur())
    // De nieuwe factuur meteen in het detail.
    setGekozenVerkoop(nieuw.id)
  };

  // Geeft false terug als er niets is opgeslagen (het formulier blijft dan open).
  const saveVrijeFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any, uitPostvak: InkoopInboxItem | null = null, opties: {volgende?: boolean} = {}): boolean => {
    // Factuurregels + merch-inkopen. Bij intracom-EU of import-niet-EU is de
    // BTW verlegd: leverancier factureert €0; de zelfberekende verschuldigde
    // BTW wordt in de aangifte (rubriek 4a/4b) verwerkt en gelijktijdig als
    // voorbelasting (5b) afgetrokken.
    const verlegd = (factuurForm.btw_soort || 'binnenlands') !== 'binnenlands';
    const {regels, merchInkopen} = bouwInkoopRegels({productLijst, verpakkingLijst, vrijeRegels}, factuurForm, ing, {datum: ymd(now)});
    // Geen inkoopfactuur opslaan als leverancier én factuurnummer beide leeg zijn:
    // dan geldt de ontvangst als voorraadcorrectie (lots blijven wel staan).
    const heeftFactuurData = !!(factuurForm.leverancier?.trim() || factuurForm.factuur?.trim())
    // Een factuur uit het postvak wordt óf een inkoopfactuur óf niet geboekt: anders staan de
    // lots er al in terwijl het item op `nieuw` blijft, en boekt het volgende verwerken ze nog eens.
    // Het formulier blijft open zodat de gegevens aangevuld kunnen worden; de melding staat
    // bovenin, boven het formulier.
    if (uitPostvak && (!regels.length || !heeftFactuurData)) { setMelding(t('inbox_vul_factuurgegevens')); return false; }
    // Voorraad: lots (zoals saveOntvangst in IngredientenPage) en onderdelen.
    boekInkoopVoorraad(factuurForm, productLijst, verpakkingLijst);
    if (!regels.length || !heeftFactuurData) { setShowVrijeFactuur(false); setInboxVerwerk(null); return true; }
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    // Handmatige factuurtotalen worden een correctieregel (zie updateFactuur).
    const {regels: regelsMetCorrectie, totalen} = inkoopRegelsMetCorrectie(regels, totaalManual, {naam: t('lbl_correctie_factuurtotaal'), verlegd});
    const nieuwFactuurId = newId(inkoopFacturen||[]);
    const factuurDatum = factuurForm.datum || ymd(now)
    const rollover = getRolloverInfo(factuurDatum)
    const nieuweFactuur = {
      id: nieuwFactuurId,
      datum: factuurDatum,
      factuurnummer: factuurForm.factuur || '',
      leverancier: factuurForm.leverancier || '',
      regels: regelsMetCorrectie,
      totaal_netto: totalen.netto,
      totaal_btw: totalen.btw,
      totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent,
      totaal_btw_cent: totalen.btw_cent,
      totaal_bruto_cent: totalen.bruto_cent,
      bijlage,
      ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
    };
    setInkoopFacturen((prev: any) => [...prev, nieuweFactuur]);
    // Merch-voorraad aanvullen. Net als bij lots en onderdelen gebeurt dit
    // alleen bij het aanmaken van de factuur — `updateFactuur` raakt voorraad
    // bewust niet aan, anders zou bewerken dubbel bijboeken.
    if (merchInkopen.length) {
      const geboekt = boekMerchMutaties(merchArtikelen, merchVoorraadLog, merchInkopen);
      setMerchArtikelen(geboekt.artikelen);
      setMerchVoorraadLog(geboekt.log);
    }
    // Journaal (ERP-plan 2.1): inkoopfactuur boeken bij vastleggen.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(nieuweFactuur, btwPeriodeType)));
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:nieuwFactuurId, actie:'aangemaakt', omschrijving:`${factuurForm.leverancier||''} — ${factuurForm.factuur||''}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    // Uit het postvak: het item is nu een factuur en de PDF hangt eraan (zelfde bestand).
    if (uitPostvak) {
      setInkoopInbox((prev: any) => inboxVerwerkt(prev || [], uitPostvak.id, nieuwFactuurId, new Date().toISOString()));
      logAudit(auditLog, setAuditLog, {entiteit:'Postvak', entiteit_id:uitPostvak.id, actie:'gewijzigd', omschrijving:`"${uitPostvak.bijlage.naam}" verwerkt tot inkoopfactuur ${factuurForm.factuur||nieuwFactuurId}`});
    }
    setShowVrijeFactuur(false);
    // "Opslaan en volgende": meteen de volgende factuur uit het postvak (de lijst
    // is hier nog de stand van vóór dit opslaan, dus deze factuur overslaan).
    setInboxVerwerk(uitPostvak && opties.volgende ? (inboxOpen(inkoopInbox).find((i: InkoopInboxItem) => i.id !== uitPostvak.id) || null) : null);
    // Een gewone inkoop meteen in het detail (vanuit het postvak blijft de wachtrij in beeld).
    if (!uitPostvak) setGekozenInkoop(nieuwFactuurId);
    return true;
  };

  const updateFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any): boolean => {
    if (!editingFactuur) return false;
    // Periode-lock (ERP-plan 0.4): een factuur die al in een ingediende of
    // betaalde BTW-periode meetelt is bevroren — wijzigen zou de cijfers van
    // die aangifte achteraf veranderen.
    if (!magFactuurMuteren(editingFactuur as any, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)) {
      setMelding(t('err_periode_gesloten_mutatie'));
      setEditingFactuur(null);
      return false;
    }
    const btwSoort = factuurForm.btw_soort || 'binnenlands';
    const verlegd = btwSoort !== 'binnenlands';
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = r2(parseFloat(p.totaalprijs) || (pn * Number(p.qty||0)));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p._naam||p.nieuw.trim()) : (p._naam||p.nieuw.trim());
      regels.push({type:'ingredient', naam, hoeveelheid:r3(Number(p.qty)), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Grondstoffen'});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = r2(parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0)));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag: verlegd ? 0 : r2(netto*btw_tarief/100), btw_soort: btwSoort, kostensoort:'Verpakkingsmateriaal'});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = r2(parseFloat(r.netto)||0);
      const btw_tarief = Number(r.btw_tarief)||0;
      // Een bestaande correctieregel (handmatige factuurtotalen) houdt zijn
      // eigen BTW-bedrag; herberekenen als netto × tarief zou de BTW wijzigen.
      const btw_bedrag = verlegd ? 0 : r.correctie ? r2(Number(r.btw_bedrag)||0) : r2(netto*btw_tarief/100);
      regels.push({naam:r.naam.trim(), type:'overig', netto, btw_tarief, btw_bedrag, btw_soort: btwSoort, kostensoort: r.kostensoort||'Overig', ...(r.correctie ? {correctie: true} : {})});
    });
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    // Handmatige factuurtotalen worden een correctieregel: zo tellen journaal,
    // W&V, rubriek 5b en de periodekaart allemaal dezelfde voorbelasting.
    const {regels: regelsMetCorrectie, totalen} = inkoopRegelsMetCorrectie(regels, totaalManual, {naam: t('lbl_correctie_factuurtotaal'), verlegd});
    const nieuweDatum = factuurForm.datum || (editingFactuur as any).datum
    const huidigeRollover = (editingFactuur as any).btw_periode as string | undefined
    const rollover = getRolloverInfo(nieuweDatum)
    // Bestaande btw_periode behouden zolang die nog "geldig" is: de
    // oorspronkelijke periode (afgeleid uit de nieuwe datum) is nog steeds
    // gesloten én de eerder gekozen rolloverbestemming is nog niet zelf
    // gesloten. Alleen dan blijft de factuur in de oude rolloverperiode staan.
    let nieuweBtwPeriode: string | undefined
    if (rollover) {
      // Datum valt nog steeds in een gesloten periode → rollover toepassen.
      // Hergebruik de bestaande rolloverperiode als die nog open is.
      const huidigOpenstaand = huidigeRollover && !btwIngediendeKeys.has(huidigeRollover) && !btwBetaaldePerioden.has(huidigeRollover)
      nieuweBtwPeriode = huidigOpenstaand ? huidigeRollover : rollover.rolloverNaar
    } else {
      // Datum valt in een open periode → geen rollover meer nodig; veld droppen.
      nieuweBtwPeriode = undefined
    }
    const huidigeFactuur = (inkoopFacturen||[]).find((f: any) => f.id === (editingFactuur as any).id) || (editingFactuur as any)
    const {btw_periode: _oud, ...rest} = huidigeFactuur
    const bijgewerkteFactuur = {
      ...rest,
      datum: nieuweDatum,
      factuurnummer: factuurForm.factuur ?? huidigeFactuur.factuurnummer,
      leverancier: factuurForm.leverancier || huidigeFactuur.leverancier,
      regels: regelsMetCorrectie,
      totaal_netto: totalen.netto, totaal_btw: totalen.btw, totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent, totaal_btw_cent: totalen.btw_cent, totaal_bruto_cent: totalen.bruto_cent,
      bijlage: bijlage || huidigeFactuur.bijlage,
      ...(nieuweBtwPeriode ? {btw_periode: nieuweBtwPeriode} : {}),
    }
    setInkoopFacturen((prev: any) => prev.map((f: any) => f.id === (editingFactuur as any).id ? bijgewerkteFactuur : f));
    // Journaal (ERP-plan 2.1): wijzigen van een al geboekte factuur = storno
    // van de oude regels + herboeking met de nieuwe cijfers (append-only).
    setJournaal((prev: any[]) => voegBoekingToe(
      voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', (editingFactuur as any).id)),
      inkoopFactuurBoeking(bijgewerkteFactuur, btwPeriodeType)))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:(editingFactuur as any).id, actie:'gewijzigd', omschrijving:`${factuurForm.leverancier||''} — ${factuurForm.factuur||''}${nieuweBtwPeriode ? ` (BTW → ${nieuweBtwPeriode})` : ''}`});
    setEditingFactuur(null);
    return true;
  };

  // ── Herinneringen ─────────────────────────────────────────────────────────
  const markeerHerinnering = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'herinnering', herinnering_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → herinnering'});
  };

  const markeerTweedeHerinnering = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'tweede_herinnering', tweede_herinnering_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → tweede herinnering'});
  };

  const markeerAanmaning = (factuurId: any) => {
    const vandaag = tod()
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'aanmaning', aanmaning_datum: vandaag} : f
    ));
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:factuurId, actie:'gewijzigd', omschrijving:'Status → aanmaning'});
  };

  // Genereer herinnering/aanmaning PDF én update status
  const genereerEnMarkeer = (f: any, niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning') => {
    const resolved = resolveKlantSnapshot(f, klanten)
    printHerinnering(resolved, breweryMetTermijn(f, klanten, breweryDetails), '', factuurLogo, niveau)
    if (niveau === 'herinnering') markeerHerinnering(f.id)
    else if (niveau === 'tweede_herinnering') markeerTweedeHerinnering(f.id)
    else markeerAanmaning(f.id)
  };

  // ── PDF generatie ─────────────────────────────────────────────────────────
  // Klantgegevens worden via `resolveKlantSnapshot` live uit de klantkaart
  // gehaald (via klant_id, of email-match als fallback) zodat een wijziging
  // op de klantenpagina onmiddellijk doorwerkt in nieuw geprinte of gemailde
  // facturen — de opgeslagen snapshot blijft fallback.
  const genereerFactuurPDF = (factuur: any) => {
    const resolved = resolveKlantSnapshot(factuur, klanten)
    printFactuur(resolved, factuur, breweryMetTermijn(factuur, klanten, breweryDetails), '', factuurLogo)
  }

  // ── E-factuur (UBL 2.1 / PEPPOL BIS Billing 3.0) ───────────────────────────
  // De gestructureerde tegenhanger van de PDF: nodig zodra een afnemer (of een
  // overheidsinstantie) de factuur machineleesbaar wil ontvangen. Ontbrekende
  // gegevens blokkeren de download niet — de gebruiker weet zelf of de
  // ontvanger streng valideert — maar worden wel eerst gemeld (UblWaarschuwing;
  // `doorgaan` = "Toch downloaden").
  const downloadUblFactuur = (factuur: any, doorgaan = false) => {
    const inst = (breweryDetails as any) || {}
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const klant = findLiveKlant(factuur, klanten)
    const termijn = betalingstermijnVoor(factuur, klanten, inst)
    const verkoper = {
      naam: inst.naam || appName || '',
      straat: inst.straat, huisnummer: inst.huisnummer,
      postcode: inst.postcode, stad: inst.stad,
      land: inst.land || 'NL',
      btw_nummer: inst.btw_nummer, kvk_nummer: inst.kvk_nummer, iban: inst.iban,
      email: inst.email, telefoon: inst.telefoon,
      peppol_id: inst.peppol_id, peppol_schema: inst.peppol_schema,
    }
    const koper = {
      naam: resolved.klant_bedrijf || resolved.klant_naam || '',
      straat: resolved.klant_straat, huisnummer: resolved.klant_huisnummer,
      postcode: resolved.klant_postcode, stad: resolved.klant_stad,
      land: klant?.land || resolved.klant_land || inst.land || 'NL',
      btw_nummer: resolved.klant_btw_nummer,
      email: resolved.klant_email, telefoon: resolved.klant_telefoon,
    }
    const problemen = controleerUbl(factuur, verkoper, koper)
    if (problemen.length && !doorgaan) {
      setUblVraag({factuur, problemen})
      return
    }
    // Creditnota's verwijzen naar het nummer van de gecrediteerde factuur.
    const bron = factuur.credit_van_factuur_id != null
      ? (verkoopFacturen || []).find((f: any) => f.id === factuur.credit_van_factuur_id)
      : null
    const {xml, bestandsnaam} = bouwUbl(
      {...factuur, credit_van_factuurnummer: bron?.factuurnummer},
      verkoper, koper,
      {betalingstermijn: termijn},
    )
    const url = URL.createObjectURL(new Blob([xml], {type: 'application/xml;charset=utf-8'}))
    const a = document.createElement('a')
    a.href = url
    a.download = bestandsnaam
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Factuur mailen ────────────────────────────────────────────────────────
  const [mailModal, setMailModal] = React.useState<null | {
    title: string
    to: string
    subject: string
    text: string
    attachments?: {filename: string, contentBase64: string, mimeType: string}[]
    factuurId?: number
    mollie?: {amountCent: number, description: string, redirectUrl: string, factuurnummer?: string,
      bestaandeLink?: {url: string} | null, onLinkAangemaakt?: (l: {id: string, url: string}) => void} | null
    regenerateAttachments?: (payUrl: string) => Promise<{filename: string, contentBase64: string, mimeType: string}[] | null>
    // Extra actie na succesvol verzenden (bijv. de herinnering-status markeren).
    afterSent?: () => void
  }>(null)
  const [mailGenerating, setMailGenerating] = React.useState<number | null>(null)

  // Eén Mollie-betaallink per factuur (utils/mollieLink.ts): de eerste link
  // komt op de factuur, een herinnering stuurt díe opnieuw mee.
  const bewaarBetaallink = (factuurId: number, l: {id: string, url: string}, amountCent: number) =>
    setVerkoopFacturen((prev: any[]) => (prev || []).map((f: any) =>
      f.id === factuurId ? {...f, mollie_link: betaallinkRecord(l, amountCent)} : f))

  const interpolate = (tpl: string, vars: Record<string, string>): string =>
    Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k] ?? ''), tpl)

  // Pakt subject/body uit ingestelde mail_templates; valt terug op de i18n-default
  // wanneer de gebruiker niets heeft ingevuld.
  const tplOrDefault = (key: 'pakbon'|'factuur'|'factuur_betaald'|'bestelling', field: 'subject'|'body'): string => {
    const stored = (mailTemplates as any)?.[key]?.[field]
    if (typeof stored === 'string' && stored.trim()) return stored
    return t(`mail_${key}_${field}_default`)
  }

  const mailVerkoopFactuur = async (factuur: any) => {
    const inst = (breweryDetails as any) || {}
    const klant = findLiveKlant(factuur, klanten)
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const breweryMet = breweryMetTermijn(factuur, klanten, inst)
    setMailGenerating(factuur.id)
    try {
      const html = buildFactuurHTML(resolved, factuur, breweryMet, appName, factuurLogo || logo)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const pdfBase64 = await htmlToPdfBase64(html)
      const verval = vervaldatumTekst(factuur, klanten, inst)
      // Een al betaalde factuur (webshoporder die in WooCommerce is afgerekend,
      // kassaverkoop, handmatig afgevinkt) krijgt een eigen mailtekst: vragen om
      // geld dat al binnen is, is de kortste weg naar een verwarde klant.
      // Keuze + betaalvariabelen in utils/factuurMail.ts (gedeeld met de
      // bestellingenpagina).
      const betaal = factuurMailBetaalVars(factuur)
      const vars = {
        naam: resolved.klant_naam || '',
        nr: factuurNr,
        bedrag: fmt(factuur.bruto || 0),
        vervaldatum: verval,
        iban: inst.iban || '',
        brouwerij: inst.naam || appName || '',
        betaaldatum: betaal.betaaldatum,
        betaalwijze: betaal.betaalwijze,
        betaalregel: betaal.betaalregel,
      }
      const ontvanger = klant?.email || resolved.klant_email || ''
      // Mollie-betaallink: alleen aanbieden voor openstaande (niet-betaalde,
      // niet-credit) facturen met een positief bedrag, én als Mollie aanstaat.
      // Redirect-URL uit de Mollie-instelling, met de brouwerij-website als
      // fallback; leeg → de modal toont de checkbox uitgeschakeld met een hint.
      const normUrl = (u: string) => {
        const s = (u || '').trim()
        return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s
      }
      const amountCent = Number.isFinite(factuur.bruto_cent)
        ? Math.round(factuur.bruto_cent)
        : Math.round((factuur.bruto || 0) * 100)
      const mollieAan = !!(mollieCreds as any)?.enabled
      const mollieCtx = (mollieAan && amountCent > 0
        && factuur.status !== 'credit' && factuur.status !== 'betaald')
        ? {
            amountCent,
            description: `${t('mollie_desc_factuur')} ${factuurNr}${inst.naam ? ' · ' + inst.naam : ''}`,
            redirectUrl: normUrl((mollieCreds as any)?.redirectUrl || inst.website || ''),
            factuurnummer: factuurNr,
            bestaandeLink: herbruikbareBetaallink(factuur, amountCent),
            onLinkAangemaakt: (l: {id: string, url: string}) => bewaarBetaallink(factuur.id, l, amountCent),
          }
        : null
      // Bij een Mollie-betaallink de PDF opnieuw bouwen mét QR-code + link erin.
      const regenerateAttachments = mollieCtx ? async (payUrl: string) => {
        const qr = await qrDataUrl(payUrl)
        const html2 = buildFactuurHTML(resolved, factuur, breweryMet, appName, factuurLogo || logo, {url: payUrl, qrDataUrl: qr})
        const pdf2 = await htmlToPdfBase64(html2)
        return [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdf2, mimeType: 'application/pdf'}]
      } : undefined
      setMailModal({
        title: t('mail_modal_title_factuur'),
        to: ontvanger,
        subject: interpolate(tplOrDefault(betaal.kind, 'subject'), vars),
        text: interpolate(tplOrDefault(betaal.kind, 'body'), vars),
        attachments: [{filename: `Factuur-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        factuurId: factuur.id,
        mollie: mollieCtx,
        regenerateAttachments,
      })
    } catch (e: any) {
      setMelding(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(null)
  }

  // Herinnering/aanmaning per mail versturen (met dezelfde Mollie-betaallink +
  // QR als de factuur). Markeert bij verzenden de bijbehorende status.
  const mailHerinnering = async (factuur: any, niveau: 'herinnering' | 'tweede_herinnering' | 'aanmaning') => {
    const inst = (breweryDetails as any) || {}
    const klant = findLiveKlant(factuur, klanten)
    const resolved = resolveKlantSnapshot(factuur, klanten)
    const breweryMet = breweryMetTermijn(factuur, klanten, inst)
    setMailGenerating(factuur.id)
    try {
      const html = buildHerinneringHTML(resolved, breweryMet, appName, factuurLogo || logo, niveau)
      const factuurNr = factuur.factuurnummer || `F-${factuur.id}`
      const prefix = niveau === 'aanmaning' ? 'Aanmaning'
        : niveau === 'tweede_herinnering' ? '2e-Herinnering' : '1e-Herinnering'
      const pdfBase64 = await htmlToPdfBase64(html)
      const verval = vervaldatumTekst(factuur, klanten, inst)
      const vars = {
        naam: resolved.klant_naam || '',
        nr: factuurNr,
        bedrag: fmt(factuur.bruto || 0),
        vervaldatum: verval,
        iban: inst.iban || '',
        brouwerij: inst.naam || appName || '',
      }
      const ontvanger = klant?.email || resolved.klant_email || ''
      const normUrl = (u: string) => {
        const s = (u || '').trim()
        return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s
      }
      const amountCent = Number.isFinite(factuur.bruto_cent)
        ? Math.round(factuur.bruto_cent)
        : Math.round((factuur.bruto || 0) * 100)
      const mollieAan = !!(mollieCreds as any)?.enabled
      const mollieCtx = (mollieAan && amountCent > 0
        && factuur.status !== 'credit' && factuur.status !== 'betaald')
        ? {
            amountCent,
            description: `${t('mollie_desc_factuur')} ${factuurNr}${inst.naam ? ' · ' + inst.naam : ''}`,
            redirectUrl: normUrl((mollieCreds as any)?.redirectUrl || inst.website || ''),
            factuurnummer: factuurNr,
            bestaandeLink: herbruikbareBetaallink(factuur, amountCent),
            onLinkAangemaakt: (l: {id: string, url: string}) => bewaarBetaallink(factuur.id, l, amountCent),
          }
        : null
      // Bij een Mollie-betaallink de herinnering-PDF opnieuw bouwen mét QR + link.
      const regenerateAttachments = mollieCtx ? async (payUrl: string) => {
        const qr = await qrDataUrl(payUrl)
        const html2 = buildHerinneringHTML(resolved, breweryMet, appName, factuurLogo || logo, niveau, {url: payUrl, qrDataUrl: qr})
        const pdf2 = await htmlToPdfBase64(html2)
        return [{filename: `${prefix}-${factuurNr}.pdf`, contentBase64: pdf2, mimeType: 'application/pdf'}]
      } : undefined
      setMailModal({
        title: t('mail_modal_title_herinnering'),
        to: ontvanger,
        subject: interpolate(t('mail_herinnering_subject_default'), vars),
        text: interpolate(t('mail_herinnering_body_default'), vars),
        attachments: [{filename: `${prefix}-${factuurNr}.pdf`, contentBase64: pdfBase64, mimeType: 'application/pdf'}],
        factuurId: factuur.id,
        mollie: mollieCtx,
        regenerateAttachments,
        afterSent: () => {
          if (niveau === 'herinnering') markeerHerinnering(factuur.id)
          else if (niveau === 'tweede_herinnering') markeerTweedeHerinnering(factuur.id)
          else markeerAanmaning(factuur.id)
        },
      })
    } catch (e: any) {
      setMelding(t('mail_pdf_failed') + (e?.message ? `: ${e.message}` : ''))
    }
    setMailGenerating(null)
  }

  const getBetaaldDatum = (factuur: any): string | undefined => {
    if (factuur.betaald_datum) return factuur.betaald_datum
    if (factuur.status !== 'betaald') return undefined
    const tx = bankTransacties.find((t: any) => t.gekoppeldInkoopId === factuur.id)
    if (tx) return tx.datum
    const entry = Object.entries(bankKoppelingen as any).find(
      ([, v]: any) => v?.soort === 'inkoop' && v.factuurId === factuur.id
    )
    if (entry) return entry[0].split('|')[0]
    return undefined
  }

  const handleKlantSelectInFactuur = (klantId: number|null) => {
    if (!klantId) {
      setLosseFactuurForm((f: any) => ({...f, klant_id:null}))
      return
    }
    const k = (klanten||[]).find((k: any) => k.id === klantId)
    if (!k) return
    setLosseFactuurForm((f: any) => ({...f, klant_id:klantId, klant_naam:k.naam, klant_straat:k.straat||'', klant_postcode:k.postcode||'', klant_stad:k.stad||'', klant_btw_nummer:k.btw_nummer||''}))
  }

  // ── Lijsten, tellingen en totalen (utils/factuurFilter.ts) ─────────────────
  const vCtx = React.useMemo(() => ({klanten: klanten || [], breweryDetails, vandaagIso}), [klanten, breweryDetails, vandaagIso])
  const iCtx = React.useMemo(() => ({vandaagIso}), [vandaagIso])
  const klantId = klantFilter || null

  const verkoopGetoond = React.useMemo(
    () => filterVerkoopFacturen<any>(verkoopFacturen, {status: statusVerkoop, bereik, zoek: zoekVerkoop, klantId}, vCtx),
    [verkoopFacturen, statusVerkoop, bereik, zoekVerkoop, klantId, vCtx])
  const verkoopTel = React.useMemo(
    () => telVerkoopStatussen(verkoopFacturen, {bereik, zoek: zoekVerkoop, klantId}, vCtx),
    [verkoopFacturen, bereik, zoekVerkoop, klantId, vCtx])
  const verkoopTot = React.useMemo(() => verkoopTotalen(verkoopGetoond, vCtx), [verkoopGetoond, vCtx])
  // Het segment noemt hoeveel er open staat, los van zoeken en periode.
  const verkoopOpenAantal = React.useMemo(() => telVerkoopStatussen(verkoopFacturen, {}, vCtx).open, [verkoopFacturen, vCtx])

  const inkoopGetoond = React.useMemo(
    () => filterInkoopFacturen<any>(inkoopFacturen, {status: statusInkoop, bereik, zoek: zoekInkoop, leverancier: leverancierFilter || null}, iCtx),
    [inkoopFacturen, statusInkoop, bereik, zoekInkoop, leverancierFilter, iCtx])
  const inkoopTel = React.useMemo(
    () => telInkoopStatussen(inkoopFacturen, {bereik, zoek: zoekInkoop, leverancier: leverancierFilter || null}, iCtx, inkoopInbox),
    [inkoopFacturen, bereik, zoekInkoop, leverancierFilter, iCtx, inkoopInbox])
  const inkoopTot = React.useMemo(() => inkoopTotalen(inkoopGetoond, iCtx), [inkoopGetoond, iCtx])
  const inkoopOpenAantal = React.useMemo(() => telInkoopStatussen(inkoopFacturen, {}, iCtx).open, [inkoopFacturen, iCtx])
  const inboxOpenAantal = telInboxOpen(inkoopInbox)

  // Fout van de laatste ophaalronde van het postvak (`inkoop_inbox_status`;
  // alleen de server schrijft hem, dus een gewone GET zoals InkoopInbox doet).
  // Opnieuw lezen bij elke statuswissel: na "Nu ophalen" onder Te verwerken
  // kan de fout weg zijn.
  const postvakAan = imapActief(imapCreds)
  const [postvakFout, setPostvakFout] = React.useState<any>(null)
  React.useEffect(() => {
    if (!postvakAan || tab !== 'inkoop') return
    let weg = false
    inboxStatus().then((s: any) => { if (!weg) setPostvakFout(s?.fout || null) })
    return () => { weg = true }
  }, [postvakAan, tab, statusInkoop])

  // Stand per factuur (pil, handeling), één keer per weergave.
  const verkoopStanden = React.useMemo(() => {
    const m = new Map<any, VerkoopStand>()
    for (const f of (verkoopFacturen || [])) if (f) m.set(f, verkoopStand(f, vCtx))
    return m
  }, [verkoopFacturen, vCtx])
  const standVan = (f: any): VerkoopStand => verkoopStanden.get(f) || verkoopStand(f, vCtx)
  const altNaam = (id: unknown): string | undefined =>
    id === null || id === undefined ? undefined : (altRekeningen || []).find((r: any) => String(r.id) === String(id))?.naam

  // ── Navigatiedoel met een factuur-id ───────────────────────────────────────
  // Staat de factuur niet in wat de filter nu toont (bijv. betaald, of van
  // vorig jaar), dan gaan status en periode op "alles" zodat hij in de lijst
  // te zien is — en een klant-/leveranciersfilter die hem uitsluit valt weg.
  const navId = React.useRef<number | null>(start.id)
  React.useEffect(() => {
    const id = navId.current
    if (id === null) return
    const lijst: any[] = (startTab === 'verkoop' ? verkoopFacturen : inkoopFacturen) || []
    const f = lijst.find((x: any) => String(x?.id) === String(id))
    if (!f) return // (nog) niet geladen: bij de volgende lading opnieuw kijken
    navId.current = null
    if (startTab === 'verkoop') {
      if (verkoopGetoond.includes(f)) return
      setStatusVerkoop('alles')
      if (klantFilter && !filterVerkoopFacturen([f], {status: 'alles', bereik: OPEN_BEREIK, klantId: klantFilter}, vCtx).length) setKlantFilter('')
    } else {
      if (statusInkoop !== 'te_verwerken' && inkoopGetoond.includes(f)) return
      setStatusInkoop('alles')
      if (leverancierFilter && !zelfdeLeverancier(f.leverancier, leverancierFilter)) setLeverancierFilter('')
    }
    if (periodeKeuze !== 'alles') zetGedeeldePeriode('alles')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verkoopFacturen, inkoopFacturen])

  // ── Handelingen per factuur ────────────────────────────────────────────────
  const smtpAan = !!(smtpCreds as any)?.enabled
  const mailTitel = !smtpAan ? t('mail_no_smtp') : undefined
  const niveauLabel = (n: HerinneringNiveau) => t(HERINNERING_SLEUTEL[n])

  const herinneringMailKnop = (f: any, n: HerinneringNiveau): DetailKnop => ({
    id: 'herinner_mail', label: t('fct_herinnering_mailen').replace('{niveau}', niveauLabel(n)),
    title: mailTitel, disabled: !smtpAan || mailGenerating === f.id, onClick: () => mailHerinnering(f, n),
  })
  const herinneringPdfKnop = (f: any, n: HerinneringNiveau): DetailKnop => ({
    id: 'herinner_pdf', label: t('fct_herinnering_pdf').replace('{niveau}', niveauLabel(n)), onClick: () => genereerEnMarkeer(f, n),
  })
  const betaaldKnop = (f: any): DetailKnop => ({ id: 'betaald', label: t('btn_mark_paid'), onClick: () => markeerBetaald(f.id) })
  const pdfKnop = (f: any): DetailKnop => ({ id: 'pdf', label: t('btn_pdf'), onClick: () => genereerFactuurPDF(f) })

  const verkoopActieKnop = (f: any, a: VerkoopActie): DetailKnop =>
    a.soort === 'herinnering_mail' ? herinneringMailKnop(f, a.niveau)
      : a.soort === 'herinnering_pdf' ? herinneringPdfKnop(f, a.niveau)
        : a.soort === 'betaald' ? betaaldKnop(f)
          : pdfKnop(f)

  const verkoopKnoppen = (f: any) => {
    const stand = standVan(f)
    const primair = verkoopActieKnop(f, verkoopPrimaireActie(stand, smtpAan))
    const open = stand.fase !== 'betaald' && stand.fase !== 'credit'
    const tweede = open && primair.id !== 'betaald' ? betaaldKnop(f) : null
    const meer: DetailKnop[] = []
    if (primair.id !== 'pdf') meer.push(pdfKnop(f))
    meer.push({id: 'ubl', label: t('btn_ubl_menu'), title: t('btn_ubl_titel'), onClick: () => downloadUblFactuur(f)})
    meer.push({id: 'mail', label: mailGenerating === f.id ? t('fct_mail_bezig') : t('btn_mail_factuur'), title: mailTitel,
      disabled: !smtpAan || mailGenerating === f.id, onClick: () => mailVerkoopFactuur(f)})
    if (stand.volgende) {
      if (primair.id !== 'herinner_pdf') meer.push(herinneringPdfKnop(f, stand.volgende))
      if (primair.id !== 'herinner_mail') meer.push(herinneringMailKnop(f, stand.volgende))
    }
    if (open && (altRekeningen || []).length > 0) {
      meer.push({id: 'verreken', label: t('btn_verreken_alt'), title: t('title_verreken_alt'), onClick: () => setVerrekenFactuurId(f.id)})
    }
    // Terugdraaien zet de factuur weer op open: bevestiging in de knop.
    if (f.verrekend_alt_id != null) {
      meer.push({id: 'ontkoppel_verreken', label: t('btn_verrekening_ongedaan'), gevaar: true, bevestig: t('fct_terug_naar_open'),
        onClick: () => ontkoppelVerrekening(f.id)})
    }
    return {stand, primair, tweede, meer}
  }

  const inkoopVergrendeld = (f: any): boolean => !magFactuurMuteren(f, btwPeriodeType, btwIngediendeKeys, btwBetaaldePerioden)
  const bewerkInkoop = (f: any) => { const bd = getBetaaldDatum(f); setEditingFactuur(bd ? {...f, betaald_datum: bd} : f) }

  const inkoopKnoppen = (f: any) => {
    const stand = inkoopStand(f, vandaagIso)
    const open = stand.fase === 'open' || stand.fase === 'te_laat'
    const bewerk: DetailKnop = {id: 'bewerk', label: t('btn_edit'), onClick: () => bewerkInkoop(f)}
    const primair: DetailKnop = open ? {id: 'betaald', label: t('btn_mark_paid'), onClick: () => markeerInkoopBetaald(f.id)} : bewerk
    const tweede = open ? bewerk : null
    const meer: DetailKnop[] = []
    if (f.status !== 'betaald' && (altRekeningen || []).length > 0) {
      meer.push({id: 'via_alt', label: t('btn_betaald_via_alt'), title: t('title_betaald_via_alt'), onClick: () => setBetaalViaAltFactuurId(f.id)})
    }
    if (f.betaald_via_alt_id != null) {
      meer.push({id: 'ontkoppel_alt', label: t('fct_alt_ontkoppel'), gevaar: true, bevestig: t('fct_terug_naar_open'),
        onClick: () => ontkoppelBetaaldViaAlt(f.id)})
    }
    const slot = inkoopVergrendeld(f)
    meer.push({id: 'verwijder', label: t('btn_delete'), gevaar: true, bevestig: t('err_confirm_delete_inkoop'),
      disabled: slot, title: slot ? t('err_periode_gesloten_mutatie') : undefined, onClick: () => deleteFactuur(f.id)})
    return {stand, primair, tweede, meer}
  }

  // De filters geven nieuwste eerst; "oudste eerst" draait dat om (lijst én CSV).
  const inVolgorde = <T,>(l: T[]): T[] => oplopend ? [...l].reverse() : l

  // ── CSV van precies de lijst die je ziet (formule-veilig, utils/csv.ts) ────
  const downloadCsv = (naam: string, rijen: unknown[][]) => {
    const csv = csvTekst(rijen);
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})),download:naam});
    a.click();
  }
  const csvNaam = (soort: Tab, status: string) =>
    periodeGeldtVoorStatus(status as InkoopStatusFilter) && (bereik.van || bereik.tot)
      ? `${soort}_${status}_${bereik.van || 'begin'}_${bereik.tot || vandaagIso}.csv`
      : `${soort}_${status}_${vandaagIso}.csv`

  const exportVerkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_klant'),t('lbl_description'),t('lbl_quantity'),t('lbl_prijs_per_stuk'),t('lbl_btw_pct'),t('lbl_netto'),t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    inVolgorde(verkoopGetoond).forEach((f: any) => {
      const regels: any[] = f.regels || []
      if (!regels.length) {
        // Geen regels (oude of handmatige factuur): één regel met de totalen.
        const c = verkoopCenten(f)
        rows.push([f.datum, f.factuurnummer||'', klantNaamVoor(f), '', '', '', '', c.netto.toFixed(2), c.btw.toFixed(2), c.bruto.toFixed(2)])
        return
      }
      regels.forEach((r: any) => rows.push([
        f.datum, f.factuurnummer||'', klantNaamVoor(f),
        r.omschrijving||'', r.hoeveelheid??'', r.prijs_per_stuk!=null?Number(r.prijs_per_stuk).toFixed(2):'',
        r.btw_pct??'', r.netto!=null?Number(r.netto).toFixed(2):'', r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',
        r.bruto!=null?Number(r.bruto).toFixed(2):'',
      ]));
    });
    // Formule-veilig: klantnamen komen o.a. letterlijk uit de webshop-checkout.
    downloadCsv(csvNaam('verkoop', statusVerkoop), [hdr, ...rows]);
  };

  const exportInkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_supplier'),t('lbl_netto_inkoop_excl_btw'),t('lbl_btw_pct'),t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    inVolgorde(inkoopGetoond).forEach((f: any) => {
      if (!(f.regels||[]).length) {
        // Geen regels (oude of geïmporteerde factuur): één regel met de totalen,
        // zoals bij verkoop — anders ontbreekt hij in een export van "precies de lijst".
        const c = inkoopCenten(f)
        rows.push([f.datum, f.factuurnummer, f.leverancier, csvBedrag(c.netto), '', csvBedrag(c.btw), csvBedrag(c.bruto)]);
        return
      }
      (f.regels||[]).forEach((r: any) => {
        const x = inkoopRegelExport(r);
        rows.push([f.datum, f.factuurnummer, f.leverancier, csvBedrag(x.netto), x.btwPct, csvBedrag(x.btwBedrag), csvBedrag(x.bruto)]);
      });
    });
    // Formule-veilig (leveranciersnamen kunnen uit een gescande PDF komen).
    downloadCsv(csvNaam('inkoop', statusInkoop), [hdr, ...rows]);
  };

  // ── Weergave ──────────────────────────────────────────────────────────────
  const isVerkoop = tab === 'verkoop'
  const status: InkoopStatusFilter = isVerkoop ? statusVerkoop : statusInkoop
  const periodeUit = !periodeGeldtVoorStatus(status)
  const postvak = !isVerkoop && statusInkoop === 'te_verwerken'
  const getoond: any[] = inVolgorde(isVerkoop ? verkoopGetoond : inkoopGetoond)
  const tot = isVerkoop ? verkoopTot : inkoopTot
  const zoek = isVerkoop ? zoekVerkoop : zoekInkoop
  const setZoek = isVerkoop ? setZoekVerkoop : setZoekInkoop
  const relatie = isVerkoop ? klantFilter : leverancierFilter

  const kiesStatus = (s: InkoopStatusFilter) => {
    if (isVerkoop) { if (s !== 'te_verwerken') setStatusVerkoop(s) } else setStatusInkoop(s)
  }
  const wisFilters = () => {
    setZoek('')
    if (isVerkoop) setKlantFilter(''); else setLeverancierFilter('')
    setPeriodeKeuze(STANDAARD_PERIODE)
  }
  const allesTonen = () => {
    setZoek('')
    if (isVerkoop) { setKlantFilter(''); setStatusVerkoop('alles') } else { setLeverancierFilter(''); setStatusInkoop('alles') }
    zetGedeeldePeriode('alles')
  }

  const chips = ((isVerkoop ? FACTUUR_STATUS_FILTERS : INKOOP_STATUS_FILTERS) as readonly {id: InkoopStatusFilter, sleutel: string}[]).map(s => ({
    id: s.id,
    label: t(s.sleutel),
    aantal: isVerkoop ? verkoopTel[s.id as FactuurStatusFilter] : inkoopTel[s.id],
    nadruk: s.id === 'te_laat',
    title: !isVerkoop && s.id === 'te_laat' ? t('fct_te_laat_inkoop_titel').replace('{n}', String(INKOOP_ACHTERSTALLIG_DAGEN)) : undefined,
  }))

  const klantOpties = React.useMemo(() => {
    const lijst = [...(klanten || [])].filter((k: any) => k && k.id != null)
      .sort((a: any, b: any) => String(a.naam || '').localeCompare(String(b.naam || ''), 'nl'))
      .map((k: any) => ({v: String(k.id), l: k.naam || t('lbl_naamloos')}))
    if (klantFilter && !lijst.some(o => o.v === klantFilter)) lijst.unshift({v: klantFilter, l: t('lbl_onbekend')})
    return lijst
  }, [klanten, klantFilter])
  const leverancierOpties = React.useMemo(() => {
    const lijst = (knownLeveranciers || []).map((n: string) => ({v: n, l: n}))
    if (leverancierFilter && !lijst.some(o => zelfdeLeverancier(o.v, leverancierFilter))) lijst.unshift({v: leverancierFilter, l: leverancierFilter})
    return lijst
  }, [knownLeveranciers, leverancierFilter])

  const relatieFilter = isVerkoop
    ? <RelatieFilter label={t('lbl_klant')} alle={t('fct_alle_klanten')} waarde={klantFilter} onKies={setKlantFilter} opties={klantOpties} gestapeld={smal} />
    : <RelatieFilter label={t('lbl_supplier')} alle={t('fct_alle_leveranciers')} waarde={leverancierFilter} onKies={setLeverancierFilter} opties={leverancierOpties} gestapeld={smal} />

  const nieuweFactuur = () => {
    if (isVerkoop) { setLosseFactuurForm(emptyLosseFactuur()); setLosseFactuurFout(null); setShowLosseFactuur(true) }
    else setShowVrijeFactuur(true)
  }
  const nieuwLabel = isVerkoop ? t('btn_losse_factuur') : t('btn_ontvangst')
  const csvKan = !postvak && getoond.length > 0
  const csvExport = isVerkoop ? exportVerkoopCSV : exportInkoopCSV

  // Segment: Verkoop (n open) | Inkoop (n open · n te verwerken).
  const telLabel = (n: number) => smal ? String(n) : t('fct_seg_open').replace('{n}', String(n))
  const segment = (
    <Segment<Tab>
      label={t('facturen_segment')}
      waarde={tab}
      onKies={setTab}
      cls={smal ? 'flex-1 min-w-0' : ''}
      opties={[
        {v: 'verkoop', aria: `${t('tab_verkoop')} · ${t('fct_seg_open').replace('{n}', String(verkoopOpenAantal))}`, l: (<>
          {t('tab_verkoop')}<span className="ml-1.5 text-xs font-normal text-gray-500 tabular-nums">{telLabel(verkoopOpenAantal)}</span>
        </>)},
        {v: 'inkoop', aria: `${t('tab_inkoop')} · ${t('fct_seg_open').replace('{n}', String(inkoopOpenAantal))}${inboxOpenAantal > 0 ? ` · ${t('fct_seg_te_verwerken').replace('{n}', String(inboxOpenAantal))}` : ''}`, l: (<>
          {t('tab_inkoop')}<span className="ml-1.5 text-xs font-normal text-gray-500 tabular-nums">{telLabel(inkoopOpenAantal)}</span>
          {inboxOpenAantal > 0 && (smal
            ? <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[11px] font-semibold align-middle">{inboxOpenAantal}</span>
            : <span className="ml-1 text-xs font-normal text-orange-800">· {t('fct_seg_te_verwerken').replace('{n}', String(inboxOpenAantal))}</span>)}
        </>)},
      ]}
    />
  )

  // Detail: de gekozen factuur uit de volledige lijst (blijft staan als een
  // handeling hem uit de huidige filter haalt, bijv. "betaald" bij Open).
  const gekozenVerkoopFactuur = isVerkoop && gekozenVerkoop !== null
    ? (verkoopFacturen || []).find((f: any) => String(f?.id) === String(gekozenVerkoop)) || null : null
  const gekozenInkoopFactuur = !isVerkoop && !postvak && gekozenInkoop !== null
    ? (inkoopFacturen || []).find((f: any) => String(f?.id) === String(gekozenInkoop)) || null : null
  const detailOpen = !!(gekozenVerkoopFactuur || gekozenInkoopFactuur)

  // Bureau: het detail staat onder de filterbalk en is zo hoog als het
  // scherm; bij het openen schuift de pagina zo ver op dat de actiebalk
  // onderaan in beeld komt (daarna blijft het detail plakken).
  const gekozenSleutel = isVerkoop ? gekozenVerkoop : gekozenInkoop
  React.useEffect(() => {
    if (smal || !detailOpen || typeof window === 'undefined') return
    const el = document.querySelector('.factuur-detail') as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    const kop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kopbalk')) || 0
    const ruimte = r.top - kop - 16
    const tekort = r.bottom - window.innerHeight
    if (ruimte > 0 && tekort > 0) window.scrollBy({top: Math.min(ruimte, tekort), behavior: 'smooth'})
  }, [gekozenSleutel, tab, smal, detailOpen])

  const verkoopDetail = (f: any) => {
    const {stand, primair, tweede, meer} = verkoopKnoppen(f)
    const klant = findLiveKlant(f, klanten)
    const bestelling = f.bestelling_id != null ? (bestellingen || []).find((b: any) => String(b?.id) === String(f.bestelling_id)) : null
    const bron = f.credit_van_factuur_id != null ? (verkoopFacturen || []).find((x: any) => String(x?.id) === String(f.credit_van_factuur_id)) || null : null
    const credits = (verkoopFacturen || []).filter((x: any) => x?.status === 'credit' && x.credit_van_factuur_id != null && String(x.credit_van_factuur_id) === String(f.id))
    const c = verkoopCenten(f)
    let betaallink: {status: BetaallinkStatus, url?: string, aangemaakt?: string} | null = null
    if (f.mollie_link?.url) {
      const st: BetaallinkStatus = f.status === 'betaald' || f.status === 'credit' ? 'gesloten'
        : herbruikbareBetaallink(f, c.bruto_cent) ? 'actief' : 'verouderd'
      betaallink = {status: st, url: f.mollie_link.url, aangemaakt: f.mollie_link.aangemaakt}
    } else if ((mollieCreds as any)?.enabled && stand.fase !== 'betaald' && stand.fase !== 'credit' && c.bruto_cent > 0) {
      betaallink = {status: 'nog_geen'}
    }
    const tijdlijn = verkoopTijdlijn(f, {
      ...vCtx, auditLog, bankKoppelingen, bankTransacties, verkoopFacturen, altRekeningen,
    })
    return (
      <VerkoopDetail
        key={`v-${f.id}`}
        factuur={f}
        stand={stand}
        tijdlijn={tijdlijn}
        klantNaam={klantNaamVoor(f)}
        onKlant={klant ? () => gaNaarDoel({pagina: 'klanten', id: Number(klant.id)}) : null}
        bestellingLabel={f.bestelling_id != null ? (bestelling ? bestellingRef(bestelling) : `#${f.bestelling_id}`) : null}
        onBestelling={bestelling ? () => { setOpenOrderId(f.bestelling_id); setPage('bestellingen') } : null}
        bron={bron}
        credits={credits}
        onOpenFactuur={(id: number) => setGekozenVerkoop(id)}
        vervaldatum={vervaldatumTekst(f, klanten, breweryDetails)}
        termijn={betalingstermijnVoor(f, klanten, breweryDetails)}
        betaallink={betaallink}
        altNaam={altNaam(f.verrekend_alt_id)}
        primair={primair}
        tweede={tweede}
        meer={meer}
        meerHint={!smtpAan ? t('mail_no_smtp') : undefined}
        onSluit={() => setGekozenVerkoop(null)}
        terugLabel={t('nav_facturen')}
        cls="factuur-detail"
      />
    )
  }

  const inkoopDetail = (f: any) => {
    const {stand, primair, tweede, meer} = inkoopKnoppen(f)
    return (
      <InkoopDetail
        key={`i-${f.id}`}
        factuur={f}
        stand={stand}
        verlegd={inkoopVerlegd(f)}
        bank={bankBetalingVoor(f.id, 'inkoop', bankKoppelingen, bankTransacties)}
        betaaldDatum={getBetaaldDatum(f)}
        altNaam={altNaam(f.betaald_via_alt_id)}
        vergrendeld={inkoopVergrendeld(f)}
        onBijlage={() => kiesBijlage(f.id)}
        bijlageBezig={bijlageBezig === f.id}
        primair={primair}
        tweede={tweede}
        meer={meer}
        onSluit={() => setGekozenInkoop(null)}
        terugLabel={t('nav_facturen')}
        cls="factuur-detail"
      />
    )
  }

  // Kolommen; naast een open detail valt weg wat er niet meer naast past.
  const verkoopOpties = {
    stand: standVan,
    klantNaam: klantNaamVoor,
    altNaam,
    rijActie: (f: any) => verkoopActieKnop(f, verkoopPrimaireActie(standVan(f), smtpAan)),
  }
  const inkoopOpties = {
    stand: (f: any) => inkoopStand(f, vandaagIso),
    verlegd: inkoopVerlegd,
    altNaam,
    rijActie: (f: any) => {
      const s = inkoopStand(f, vandaagIso)
      return s.fase === 'open' || s.fase === 'te_laat' ? {id: 'betaald', label: t('btn_mark_paid'), onClick: () => markeerInkoopBetaald(f.id)} : null
    },
  }
  // De kop van de nummerkolom (met de datum eronder) wisselt de volgorde.
  const volgordeTitel = oplopend ? t('fct_volgorde_oudste') : t('fct_volgorde_nieuwste')
  const nummerKop = (
    <button type="button" onClick={() => setOplopend(v => !v)} title={t('fct_volgorde_wissel')}
      aria-label={`${t('fct_kol_nummer')} · ${volgordeTitel}. ${t('fct_volgorde_wissel')}`}
      className="inline-flex items-center gap-1 font-medium text-gray-500 hover:text-gray-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      {t('fct_kol_nummer')} <span aria-hidden="true">{oplopend ? '↑' : '↓'}</span>
    </button>
  )
  const alleKolommen = (isVerkoop ? verkoopKolommen(verkoopOpties) : inkoopKolommen(inkoopOpties))
    .map(k => k.id === 'nummer' ? {...k, kop: nummerKop} : k)
  const kolommen = !detailOpen ? alleKolommen
    : alleKolommen.filter(k => (ruim || !k.breed) && (breed || k.id !== 'actie'))

  const heeftFacturen = ((isVerkoop ? verkoopFacturen : inkoopFacturen) || []).length > 0
  const filtertIets = status !== 'alles' || !!zoek.trim() || !!relatie || periodeKeuze !== 'alles'
  const leeg = !heeftFacturen ? (
    <LegeStaat titel={isVerkoop ? t('fct_leeg_verkoop') : t('msg_no_inkoop_facturen')} icoon="receipt">
      <Btn onClick={nieuweFactuur}>{nieuwLabel}</Btn>
    </LegeStaat>
  ) : (
    <LegeStaat titel={status === 'te_laat' ? t('fct_leeg_te_laat') : t('fct_leeg_filter')}>
      {filtertIets && <Btn v="secondary" onClick={allesTonen}>{t('fct_alles_tonen')}</Btn>}
    </LegeStaat>
  )

  const lijst = (
    <ResponsiveLijst<any>
      rijen={getoond}
      sleutel={(f: any) => f.id}
      kolommen={kolommen}
      kaart={isVerkoop ? verkoopKaart(verkoopOpties) : inkoopKaart(inkoopOpties)}
      onKies={(f: any) => isVerkoop ? setGekozenVerkoop(f.id) : setGekozenInkoop(f.id)}
      gekozenSleutel={isVerkoop ? gekozenVerkoop : gekozenInkoop}
      rijLabel={(f: any) => isVerkoop
        ? `${t('lbl_invoice')} ${f.factuurnummer || `F-${f.id}`}, ${klantNaamVoor(f) || t('lbl_onbekend')}`
        : `${t('lbl_invoice')} ${f.factuurnummer || '—'}, ${f.leverancier || t('lbl_onbekend')}`}
      voetCellen={{
        nummer: tot.aantal === 1 ? t('fct_som_aantal_1') : t('fct_som_aantal').replace('{n}', String(tot.aantal)),
        netto: fmt(tot.netto),
        btw: fmt(tot.btw),
        bruto: fmt(tot.bruto),
      }}
      leeg={leeg}
      label={isVerkoop ? t('fct_lijst_verkoop') : t('fct_lijst_inkoop')}
    />
  )

  return (
    <div className="space-y-3 min-w-0">

      {/* Bovenregel: Verkoop | Inkoop, en rechts de CSV en de primaire handeling. */}
      <div className="flex items-center gap-2 min-w-0">
        {segment}
        {!smal && <span className="flex-1" />}
        {!smal && (
          <Btn v="secondary" onClick={csvExport} disabled={!csvKan} title={t('fct_csv_titel')}>
            <span className="inline-flex items-center gap-1.5"><Icon n="download" /> {t('fct_csv')}</span>
          </Btn>
        )}
        {smal ? (
          <button type="button" onClick={nieuweFactuur} aria-label={nieuwLabel} title={nieuwLabel}
            className="tbtn flex-shrink-0 rounded-lg min-h-tap w-11 text-xl font-semibold leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--t-accent)]">+</button>
        ) : (
          <Btn onClick={nieuweFactuur}>{nieuwLabel}</Btn>
        )}
      </div>

      <FilterBalk<InkoopStatusFilter>
        zoek={zoek}
        onZoek={setZoek}
        zoekPlaceholder={isVerkoop ? t('fct_zoek_verkoop') : t('fct_zoek_inkoop')}
        status={{chips, waarde: status, onKies: kiesStatus}}
        periode={{
          keuze: periodeKeuze, onKeuze: setPeriodeKeuze, eigen: periodeEigen, onEigen: setPeriodeEigen,
          uit: periodeUit ? t('periode_uit_open') : undefined,
        }}
        extraActief={relatie ? 1 : 0}
        onWis={wisFilters}
        actiesTelefoon={csvKan ? (
          <button type="button" onClick={csvExport} aria-label={t('fct_csv_titel')} title={t('fct_csv_titel')}
            className="flex-shrink-0 inline-flex items-center justify-center w-11 min-h-tap rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            <Icon n="download" />
          </button>
        ) : undefined}
      >
        {!postvak && relatieFilter}
        {/* Telefoon: geen tabelkop om op te klikken, dus de volgorde in het filterpaneel. */}
        {!postvak && smal && (
          <RelatieFilter label={t('fct_volgorde')} waarde={oplopend ? 'oud' : ''} onKies={v => setOplopend(v === 'oud')}
            alle={t('fct_volgorde_nieuwste')} opties={[{v: 'oud', l: t('fct_volgorde_oudste')}]} gestapeld />
        )}
      </FilterBalk>

      {postvak ? (
        /* Te verwerken: de facturen die per e-mail binnenkwamen (het postvak). */
        <InkoopInbox items={inkoopInbox} setItems={setInkoopInbox} actief={imapActief(imapCreds)}
          onVerwerk={setInboxVerwerk} vernieuw={refreshInkoopInbox} onNaarInstellingen={onNaarPostvakInstellingen}
          onAudit={(omschrijving: string, id: number, actie: 'gewijzigd'|'verwijderd') =>
            logAudit(auditLog, setAuditLog, {entiteit:'Postvak', entiteit_id:id, actie, omschrijving})}
          leeg={(
            <LegeStaat titel={t('fct_postvak_leeg')} icoon="file">
              <Btn v="secondary" onClick={onNaarPostvakInstellingen}>{t('fct_postvak_instellen')}</Btn>
            </LegeStaat>
          )} />
      ) : (<>
        {!isVerkoop && postvakAan && postvakFout && (
          <PostvakFout tekst={t(inboxFoutSleutel(postvakFout))} onBekijk={() => kiesStatus('te_verwerken')} />
        )}
        <Samenvatting tot={tot} teLaatTonen={status !== 'te_laat'} periodeUit={periodeUit}
          onTeLaat={() => kiesStatus('te_laat')} smal={smal} btwLabel={isVerkoop ? t('lbl_btw') : t('lbl_voorbelasting')} />
        <LijstMetDetail
          lijst={lijst}
          open={detailOpen}
          detail={gekozenVerkoopFactuur ? verkoopDetail(gekozenVerkoopFactuur) : gekozenInkoopFactuur ? inkoopDetail(gekozenInkoopFactuur) : null}
        />
      </>)}

      {/* Bestandsinvoer voor een bijlage: buiten het detail (zie kiesBijlage). */}
      <input ref={bijlageInvoer} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,application/pdf,image/*"
        className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          const id = bijlageVoor.current
          if (file && id !== null) uploadBijlageVoorFactuur(id, file)
        }} />

      {/* Losse verkoopfactuur */}
      {showLosseFactuur && (
        <LosseFactuurModal
          form={losseFactuurForm}
          setForm={setLosseFactuurForm}
          klanten={klanten || []}
          onKlant={handleKlantSelectInFactuur}
          getRolloverInfo={getRolloverInfo}
          onSave={saveLosseVerkoopFactuur}
          onClose={() => setShowLosseFactuur(false)}
          bezig={losseFactuurBezig}
          kanOpslaan={!!(losseFactuurForm.klant_naam||'').trim() && losseRegelsGevuld(losseFactuurForm.regels)}
          fout={losseFactuurFout}
          leegRegel={emptyLosseRegel}
        />
      )}

      {/* Inkoop boeken */}
      {showVrijeFactuur && (
        <InkoopFactuurModal merchArtikelen={merchArtikelen}
          knownLeveranciers={knownLeveranciers}
          ing={ing}
          lots={lots}
          onderdelen={onderdelen}
          inkoopFacturen={inkoopFacturen}
          btwPeriodeType={btwPeriodeType}
          initialTab="ingredienten"
          onSave={(invoer: any) => saveVrijeFactuur(invoer)}
          scanCorrecties={scanCorrecties}
          onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
          onLeer={(k: any) => setScanCorrecties((prev: any) => leerKoppelingen(prev || [], k))}
          onClose={()=>setShowVrijeFactuur(false)}
          claudeCreds={claudeCreds}
          breweryNaam={(breweryDetails as any)?.naam || ''}
          ingTypes={ingTypes}
          ingTypeBtw={ingTypeBtw}
          kostenSoorten={kostenSoorten}
          getRolloverInfo={getRolloverInfo}
        />
      )}
      {/* Factuur uit het postvak verwerken: zelfde formulier, PDF al geladen */}
      {inboxVerwerk && (
        <InkoopFactuurModal merchArtikelen={merchArtikelen}
          key={inboxVerwerk.id}
          inboxItem={inboxVerwerk}
          volgendeAantal={inboxOpen(inkoopInbox).filter((i: InkoopInboxItem) => i.id !== inboxVerwerk.id).length}
          knownLeveranciers={knownLeveranciers}
          ing={ing}
          lots={lots}
          onderdelen={onderdelen}
          inkoopFacturen={inkoopFacturen}
          btwPeriodeType={btwPeriodeType}
          initialTab="ingredienten"
          onSave={(invoer: any, opties: any) => saveVrijeFactuur(invoer, inboxVerwerk, opties)}
          scanCorrecties={scanCorrecties}
          onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
          onLeer={(k: any) => setScanCorrecties((prev: any) => leerKoppelingen(prev || [], k))}
          onClose={()=>setInboxVerwerk(null)}
          claudeCreds={claudeCreds}
          breweryNaam={(breweryDetails as any)?.naam || ''}
          ingTypes={ingTypes}
          ingTypeBtw={ingTypeBtw}
          kostenSoorten={kostenSoorten}
          getRolloverInfo={getRolloverInfo}
        />
      )}
      {/* Factuur bewerken */}
      {editingFactuur && (
        <InkoopFactuurModal
          knownLeveranciers={knownLeveranciers}
          ing={ing}
          lots={lots}
          onderdelen={onderdelen}
          inkoopFacturen={inkoopFacturen}
          btwPeriodeType={btwPeriodeType}
          initialTab="ingredienten"
          initialData={editingFactuur}
          onSave={updateFactuur}
          scanCorrecties={scanCorrecties}
          onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
          onLeer={(k: any) => setScanCorrecties((prev: any) => leerKoppelingen(prev || [], k))}
          onClose={()=>setEditingFactuur(null)}
          claudeCreds={claudeCreds}
          breweryNaam={(breweryDetails as any)?.naam || ''}
          ingTypes={ingTypes}
          ingTypeBtw={ingTypeBtw}
          kostenSoorten={kostenSoorten}
          getRolloverInfo={getRolloverInfo}
        />
      )}

      {/* Verkoopfactuur verrekenen met alt-rekening-schuld (aflossing in natura) */}
      {verrekenFactuurId !== null && (() => {
        const f = (verkoopFacturen||[]).find((x: any) => x.id === verrekenFactuurId)
        return (
          <AltRekeningKiezer
            titel={t('title_verreken_alt')}
            uitleg={t('msg_kies_verreken_rekening')}
            datum={f?.datum}
            naam={f ? klantNaamVoor(f) : undefined}
            bedrag={f ? (f.bruto || 0) : undefined}
            rekeningen={altRekeningen || []}
            schuld={schuldPerAltRekening}
            onKies={(id: number) => { verrekenMetAltRekening(verrekenFactuurId!, id); setVerrekenFactuurId(null) }}
            onClose={() => setVerrekenFactuurId(null)}
          />
        )
      })()}

      {/* Inkoopfactuur betaald via een alt-rekening */}
      {betaalViaAltFactuurId !== null && (() => {
        const f = (inkoopFacturen||[]).find((x: any) => x.id === betaalViaAltFactuurId)
        return (
          <AltRekeningKiezer
            titel={t('title_betaald_via_alt')}
            uitleg={t('msg_kies_alt_rekening')}
            datum={f?.datum}
            naam={f?.leverancier}
            bedrag={f ? (f.totaal_bruto || 0) : undefined}
            rekeningen={altRekeningen || []}
            onKies={(id: number) => { markeerBetaaldViaAlt(betaalViaAltFactuurId!, id); setBetaalViaAltFactuurId(null) }}
            onClose={() => setBetaalViaAltFactuurId(null)}
          />
        )
      })()}

      {ublVraag && (
        <UblWaarschuwing problemen={ublVraag.problemen}
          onClose={() => setUblVraag(null)}
          onDoorgaan={() => { const f = ublVraag.factuur; setUblVraag(null); downloadUblFactuur(f, true) }} />
      )}

      {mailModal && (
        <MailModal
          title={mailModal.title}
          initialTo={mailModal.to}
          initialSubject={mailModal.subject}
          initialText={mailModal.text}
          attachments={mailModal.attachments}
          brewery={breweryDetails as any}
          logoDataUri={factuurLogo || logo}
          replyTo={(breweryDetails as any)?.email}
          smtpReady={!!smtpCreds?.enabled}
          mollie={mailModal.mollie}
          regenerateAttachments={mailModal.regenerateAttachments}
          onClose={() => setMailModal(null)}
          onSent={(sentTo) => {
            if (mailModal.factuurId) {
              logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id: mailModal.factuurId, actie:'gewijzigd', omschrijving: `Mail verstuurd: ${mailModal.subject}${sentTo ? ` (${sentTo})` : ''}`})
            }
            mailModal.afterSent?.()
          }}
        />
      )}

      {melding && <Melding tekst={melding} onSluit={sluitMelding} />}
    </div>
  );
}

export default FacturenSectie
