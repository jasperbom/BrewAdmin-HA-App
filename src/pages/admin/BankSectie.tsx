import React from 'react'
import { t } from '../../i18n'
import { tod, r2, fmtD } from '../../utils/format'
import { newId } from '../../utils/api'
import { sndKoppelKandidaten } from '../../utils/sndAfdracht'
import { logAudit } from '../../utils/audit'
import { periodeKeyLabel, standaardBtwPct } from '../../utils/btw'
import { bouwInkoopRegels } from '../../utils/inkoopOntvangst'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, stornoBoekingVoor, voegBoekingToe } from '../../utils/journaal'
import { inkoopRegelsMetCorrectie, toCent } from '../../utils/centen'
import {
  parseMT940, isLeegMt940, isPspTransactie, pspKandidaten, bouwOntvangstVerkoopFactuur,
  gekoppeldeFactuurIds, bouwBankImport, verwijderAfschrift, bankSaldiNaVerwijderen, sorteerAfschriften,
  herstelKoppelingVlaggen,
  ibanSleutel, koppelingVan, filterBankTransacties, telBankStatussen, standaardBankStatus, isBankStatusFilter,
  BANK_STATUS_FILTERS, type BankStatusFilter,
} from '../../utils/bank'
import {
  bankVoorstellen, bankVoorstelSleutel, btwKiezerKandidaten, accijnsKiezerKandidaten, AANGIFTE_MARGE_CENT,
  type BankVoorstel, type FactuurKiezerSoort,
} from '../../utils/bankVoorstel'
import { autoKoppelImport } from '../../utils/bankImportKoppeling'
import { STANDAARD_PERIODE, vulIn } from '../../utils/periode'
import InkoopFactuurModal from '../../components/InkoopFactuurModal'
import { registreerScanCorrectie, leerKoppelingen } from '../../utils/scanGeheugen'
import OntvangstBoekingModal from '../../components/OntvangstBoekingModal'
import { boekMerchMutaties } from '../../utils/merch'
import RowActions, { type RowActie } from '../../components/ui/RowActions'
import LegeStaat from '../../components/ui/LegeStaat'
import FilterBalk from '../../components/ui/FilterBalk'
import ResponsiveLijst, { KAART_INTERACTIEF, type LijstKolom } from '../../components/ui/ResponsiveLijst'
import { useGedeeldePeriode, useGedeeldBereik } from '../../components/ui/useGedeeldePeriode'
import { useUndo } from '../../components/ui/UndoBar'
import { useSmalScherm } from '../../components/ui/useSmalScherm'
import { useAdmin, txKey, fmt } from './adminContext'
import Aansluiting from './bank/Aansluiting'
import AfschriftenModal from './bank/AfschriftenModal'
import FactuurKiezer from './bank/FactuurKiezer'
import KeuzeModal, { type KeuzeOptie } from './bank/KeuzeModal'
import TransactieModal, { type TransactieActie } from './bank/TransactieModal'
import PspModal from './bank/PspModal'
import KapitaalModal, { type KapitaalForm } from './bank/KapitaalModal'
import {
  koppelingWeergave, voorstelWeergave, zoekTekstVoor, korteDatum, bedragMetTeken, ibanWeergave,
  btwTitel, accijnsTitel, geldCent, type BankTekstData,
} from './bank/bankTekst'

// ── Bank (Administratie) ────────────────────────────────────────────────────
// Een werklijst: per ongekoppelde transactie één voorstel met de reden erbij
// (utils/bankVoorstel.ts) en één knop — Koppel, Uitsplitsen, Markeer betaald
// of "Boeken als…". De rest staat onder ⋯ (bureau) of in het venster dat een
// tik op de kaart opent (telefoon). Bovenaan de rekening, het saldo van het
// laatste afschrift en één aansluitregel; daaronder de filterbalk (Te
// koppelen | Gekoppeld | Alles, zoeken, de gedeelde periode — niet bij Te
// koppelen: wat nog werk is filter je niet weg).
//
// De handelingen zelf (MT940-import met samenvoegen en automatisch koppelen,
// facturen, PSP-uitbetaling, BTW, SNd, accijns, kapitaal, aflossing, een
// afschrift verwijderen) zijn overgenomen uit de oude Bank-tab; alleen het
// automatisch koppelen bij het inlezen kent nu de datumgrens van het voorstel
// (ERP-plan F11, utils/bankImportKoppeling.ts).
// Afschriften en transacties worden bewaard (`bank_afschriften`,
// `bank_transacties`); wat er gekoppeld is staat in `bank_koppelingen`, en de
// context zet de vlaggen daaruit opnieuw. De schuld aan alternatieve
// rekeningen staat niet meer hier maar op de Balans (Rapporten).

type KeuzeSoort = 'btw' | 'accijns' | 'snd' | 'aflossing'

const emptyKapitaalForm = (): KapitaalForm => ({datum: tod(), omschrijving: '', bedrag: '', type: 'storting', eigenaar: ''})

function BankSectie() {
  const {
    navDoel, gaNaarDoel, inkoopFacturen, setInkoopFacturen, ing, lots,
    onderdelen, verpakkingen, btwInst, claudeCreds, ingTypes, ingTypeBtw, klanten,
    verkoopFacturen, setVerkoopFacturen, bestellingen, breweryDetails, bankKoppelingen, setBankKoppelingen,
    kapitaalBoekingen, setKapitaalBoekingen, altRekeningen, accijnsAangiftes, btwAangiftes,
    auditLog, setAuditLog, kostenSoorten, scanCorrecties, setScanCorrecties, setJournaal,
    bankSaldi, setBankSaldi, merchArtikelen, setMerchArtikelen, merchVoorraadLog, setMerchVoorraadLog,
    bankTransacties, setBankTransacties, bankAfschriften, setBankAfschriften,
    refreshBankTransacties, refreshBankAfschriften, refreshBankKoppelingen, refreshBankSaldi,
    klantNaamVoor, schuldPerAltRekening, knownLeveranciers, btwPeriodeType,
    getRolloverInfo, boekInkoopVoorraad, markeerBetaald, koppelBtwBetaling, ontkoppelBtwBetaling, markeerAccijnsMaandBetaald,
    ontkoppelAccijnsBetaling, koppelAccijnsBetaling,
  } = useAdmin()

  const bankFileRef = React.useRef<any>(null)
  const undo = useUndo()
  const smal = useSmalScherm()

  // Transacties worden op id aangesproken, nooit op hun plek in de lijst: de
  // lijst is bewaard en kan tussen weergave en klik veranderen (een ander
  // apparaat, een verwijderd afschrift). Ook een open venster houdt daarom de
  // id vast en zoekt de transactie pas bij het opslaan op.
  const wijzigTx = (txId: number, f: (t: any) => any) =>
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) => t.id === txId ? f(t) : t))
  const txMetId = (id: number | null): any => id == null ? null : (bankTransacties.find((t: any) => t.id === id) || null)

  // De nieuwste lijsten voor wat ná een await draait (het inlezen van een
  // bestand, een uitgestelde verwijdering): de closure van de klik is dan
  // misschien al verouderd.
  const bankTxRef = React.useRef<any[]>(bankTransacties)
  bankTxRef.current = bankTransacties
  const afschriftenRef = React.useRef<any[]>(bankAfschriften)
  afschriftenRef.current = bankAfschriften
  const koppelingenRef = React.useRef<any>(bankKoppelingen)
  koppelingenRef.current = bankKoppelingen
  // Een afschriftverwijdering die net is doorgezet (undo.flush bij een nieuwe
  // import): de import wacht tot die zijn lijsten heeft gezet.
  const verwijderBezig = React.useRef<Promise<void> | null>(null)

  // ── Weergave-instellingen van de werklijst ────────────────────────────────
  const navStatus: BankStatusFilter | null = isBankStatusFilter(navDoel?.filter) ? navDoel.filter as BankStatusFilter : null
  // null = de beginchip (Te koppelen als daar iets staat, anders Alles).
  const [status, setStatus] = React.useState<BankStatusFilter | null>(navStatus)
  const [zoek, setZoek] = React.useState('')
  const [periodeKeuze, setPeriodeKeuze, eigenPeriode, setEigenPeriode] = useGedeeldePeriode()
  const { bereik } = useGedeeldBereik()
  // Rekening ('alle' of een IBAN; null = de standaard) en het afschrift
  // waarvan de lijst en de aansluitregel de transacties tonen (null = alle).
  const [rekeningKeuze, setRekeningKeuze] = React.useState<string | null>(null)
  const [afschriftKeuze, setAfschriftKeuze] = React.useState<number | null>(null)
  // Uitkomst van de laatste import: nieuw / al bekend.
  const [importMelding, setImportMelding] = React.useState<{soort: 'ok' | 'al' | 'fout', tekst: string} | null>(null)
  const [afschriftenOpen, setAfschriftenOpen] = React.useState(false)

  // PSP-uitsplitsing modal state (één credittransactie → meerdere facturen)
  const [pspTxId, setPspTxId] = React.useState<number|null>(null)
  const [pspSelectie, setPspSelectie] = React.useState<number[]>([])
  const [pspBtwPct, setPspBtwPct] = React.useState('21')
  const [pspToonAlles, setPspToonAlles] = React.useState(false)

  // Nieuwe boeking modal state. Een afschrijving opent het inkoopformulier
  // (boekingTxId), een bijschrijving het ontvangstformulier dat een
  // verkoopfactuur maakt (ontvangstTxId) — ontvangen geld is nooit kosten.
  const [boekingTxId, setBoekingTxId] = React.useState<number|null>(null)
  const [boekingInitialData, setBoekingInitialData] = React.useState<any>(null)
  const [boekingFout, setBoekingFout] = React.useState<string|null>(null)
  const [ontvangstTxId, setOntvangstTxId] = React.useState<number|null>(null)

  // Kapitaalstorting modal state
  const [showKapitaalModal, setShowKapitaalModal] = React.useState(false)
  const [kapitaalForm, setKapitaalForm] = React.useState<KapitaalForm>(emptyKapitaalForm())
  const [kapitaalTxId, setKapitaalTxId] = React.useState<number|null>(null)

  // Kiezers: factuur (verkoop/inkoop/creditnota) en periode/rekening.
  const [kiezer, setKiezer] = React.useState<{soort: FactuurKiezerSoort, txId: number} | null>(null)
  const [keuze, setKeuze] = React.useState<{soort: KeuzeSoort, txId: number} | null>(null)
  // "Wat is deze transactie?" (Boeken als…, of een tik op de rij/kaart).
  const [detailTxId, setDetailTxId] = React.useState<number|null>(null)

  const koppelAflossing = (tx: any, altRekeningId: number) => {
    if (!tx) return
    const key = txKey(tx)
    const bedrag = Math.abs(Number(tx.bedrag)||0)
    setBankKoppelingen((k: any) => ({...k, [key]: {soort:'aflossing', altRekeningId, bedrag}}))
    wijzigTx(tx.id, (tt: any) => ({...tt, gekoppeldAflossingAltId: altRekeningId, autoGematcht: false}))
    const r = (altRekeningen||[]).find((x: any) => x.id === altRekeningId)
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`Aflossing aan ${r?.naam||'alt. rekening'} — ${bedrag.toFixed(2)}`})
  }

  const ontkoppelAflossing = (tx: any) => {
    if (!tx) return
    const key = txKey(tx)
    setBankKoppelingen((k: any) => { const c={...k}; delete c[key]; return c })
    wijzigTx(tx.id, (tt: any) => ({...tt, gekoppeldAflossingAltId: undefined}))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'Aflossing ontkoppeld'})
  }

  // ── MT940 importeren ──────────────────────────────────────────────────────
  // Het bestand wordt samengevoegd met wat er al bewaard is (bouwBankImport):
  // een transactie die er al staat komt er niet nog eens bij — het bestaande
  // record en zijn koppeling winnen. Alleen de nieuwe transacties gaan langs
  // de automatische koppeling (`autoKoppelImport`). Eerst de serverstand: een
  // ander tabblad of apparaat kan hetzelfde bestand al hebben ingelezen, en
  // tegen een oude lijst ontdubbelen maakt alles dubbel (zelfde patroon als
  // refreshBestellingen bij de WooCommerce-import).
  const importMT940 = (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e: any) => {
      const text = e.target.result as string
      const afschrift = parseMT940(text)
      // Geen MT940 (een CSV, een ander bestand): niets bewaren, geen leeg
      // afschrift en geen saldo voor een rekening 'onbekend'.
      if (isLeegMt940(afschrift)) {
        setImportMelding({soort: 'fout', tekst: t('bank_import_geen_mt940')})
        return
      }
      try { await verwijderBezig.current } catch (_) { /* de verwijdering meldt zichzelf */ }
      // bank_saldi ook: het saldo hieronder rekent dan vanaf de serverstand.
      const [vTx, vAf, vK, vS] = await Promise.all([refreshBankTransacties(), refreshBankAfschriften(), refreshBankKoppelingen(), refreshBankSaldi()])
      const bestaand: any[] = (Array.isArray(vTx) ? vTx : null) ?? bankTxRef.current ?? []
      const bestaandeAfschriften: any[] = (Array.isArray(vAf) ? vAf : null) ?? afschriftenRef.current ?? []
      const koppelingenNu: any = (vK && typeof vK === 'object' ? vK : null) ?? koppelingenRef.current ?? {}
      const imp = bouwBankImport(afschrift, bestaand, bestaandeAfschriften, {
        maakId: () => newId(bestaand),
        nu: new Date().toISOString(),
        bankSaldi: (vS && typeof vS === 'object' ? vS : null) ?? bankSaldi,
      })
      const afschriftNaam = imp.afschrift.afschriftNr || imp.afschrift.referentie || '—'
      // Het ingelezen afschrift meteen tonen: lijst en aansluitregel erop.
      setAfschriftKeuze(Number(imp.afschrift.id))
      setRekeningKeuze((k: string | null) => k && k !== 'alle' && k !== ibanSleutel(imp.afschrift) ? ibanSleutel(imp.afschrift) : k)
      if (imp.alBekend && imp.nieuw.length === 0) {
        setImportMelding({soort: 'al', tekst: t('msg_bank_import_al_bekend').replace('{afschrift}', afschriftNaam)})
        return
      }
      // Automatisch koppelen (utils/bankImportKoppeling.ts): opgeslagen
      // koppelingen terug, facturen op match-score binnen de datumgrens van
      // het voorstel, BTW/accijns op bedrag, PSP alleen herkend.
      const auto = autoKoppelImport(imp.nieuw, {verkoopFacturen, inkoopFacturen, btwAangiftes, accijnsAangiftes, bankKoppelingen: koppelingenNu})
      const gematcht = auto.transacties
      if (Object.keys(auto.koppelingen).length > 0) {
        setBankKoppelingen((prev: any) => ({...prev, ...auto.koppelingen}))
      }
      // Auto-gematchte accijnsmaanden als betaald markeren (aangiftestatus +
      // accijnsrecords), met de transactiedatum als betaaldatum.
      auto.accijnsBetaald.forEach(({maand, datum}) => markeerAccijnsMaandBetaald(maand, datum))
      // Achteraan erbij (functioneel: een tussentijdse wijziging blijft staan).
      setBankTransacties((prev: any[]) => [...(prev || []), ...gematcht])
      setBankAfschriften((prev: any[]) => imp.alBekend
        ? (prev || []).map((a: any) => a.id === imp.afschrift.id ? imp.afschrift : a)
        : [...(prev || []), imp.afschrift])
      setImportMelding({soort: 'ok', tekst: (imp.dubbel > 0 ? t('msg_bank_import_klaar_dubbel') : t('msg_bank_import_klaar'))
        .replace('{afschrift}', afschriftNaam).replace('{nieuw}', String(imp.nieuw.length)).replace('{dubbel}', String(imp.dubbel))})
      logAudit(auditLog, setAuditLog, {entiteit:'Bankafschrift', entiteit_id:imp.afschrift.id, actie: imp.alBekend ? 'gewijzigd' : 'aangemaakt',
        omschrijving:`Afschrift ${afschriftNaam} (${imp.afschrift.iban || '—'}, ${imp.afschrift.van} t/m ${imp.afschrift.tot}) ingelezen — ${imp.nieuw.length} nieuw, ${imp.dubbel} al bekend`})
      // Banksaldo per IBAN vastleggen (ERP-plan 2.3): de balans leest hieruit
      // de post "liquide middelen". Alleen overschrijven wanneer dit afschrift
      // niet ouder is dan het al bekende saldo (herimport van een oud bestand
      // mag een nieuwer saldo niet terugdraaien). De datum is het einde van de
      // periode van het afschrift, zodat verwijderen hem kan herkennen.
      const saldoDatum = imp.afschrift.tot || tod()
      const ibanKey = ibanSleutel(afschrift)
      setBankSaldi((prev: any) => {
        const huidig = (prev || {})[ibanKey]
        if (huidig?.datum && huidig.datum > saldoDatum) return prev || {}
        return {
          ...(prev || {}),
          [ibanKey]: {
            iban: ibanKey,
            eindsaldo: afschrift.eindsaldo ?? 0,
            beginsaldo: afschrift.beginsaldo ?? 0,
            datum: saldoDatum,
            afschrift_nr: afschrift.afschriftNr || '',
            geimporteerd_op: new Date().toISOString(),
          },
        }
      })
    }
    reader.readAsText(file, 'latin1')
  }

  const koppelBankTransactie = (tx: any, factuurId: number|null, soort: 'verkoop'|'inkoop' = 'verkoop') => {
    if (!tx) return
    const key = txKey(tx)
    if (factuurId) {
      setBankKoppelingen((k: any) => ({...k, [key]: {soort, factuurId}}))
      logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:factuurId, actie:'aangemaakt', omschrijving:`${soort}factuur #${factuurId} gekoppeld`})
    } else {
      setBankKoppelingen((k: any) => { const c = {...k}; delete c[key]; return c })
      logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'Koppeling ongedaan gemaakt'})
    }
    wijzigTx(tx.id, (t: any) => ({
      ...t,
      gekoppeldFactuurId: soort==='verkoop' ? factuurId : null,
      gekoppeldInkoopId: soort==='inkoop' ? factuurId : null,
      autoGematcht: false,
      herinneringsGematcht: false
    }))
  }

  // ── PSP-uitbetaling: één credittransactie dekt meerdere verkoopfacturen ────

  // Verkoopfacturen die al aan een ándere banktransactie gekoppeld zijn. Die
  // horen niet in een PSP-bundel: hun geld staat al ergens anders op het
  // afschrift, meenemen zou de omzet dubbel koppelen.
  const verkoopIdsElders = (huidigeKey?: string): Set<number> =>
    gekoppeldeFactuurIds(bankKoppelingen, 'verkoop', huidigeKey)

  // Kandidaten voor de PSP-bundel van deze transactie: open én al betaalde
  // facturen rond de uitbetaaldatum. Facturen die elders al gekoppeld zijn of
  // aan de balie contant/pin zijn afgerekend blijven eruit — die kunnen niet
  // in een PSP-uitbetaling zitten. `negeerDatum` laat alleen het tijdvak los.
  const pspKandidatenVoor = (tx: any, negeerDatum = false) => pspKandidaten(verkoopFacturen || [], {
    datum: tx?.datum,
    alGekoppeld: verkoopIdsElders(tx ? txKey(tx) : undefined),
    negeerDatum,
  })

  // Voorselectie: het voorstel van de werklijst, anders dat van de import.
  const openPspModal = (tx: any, voorstelIds?: number[]) => {
    const ids = voorstelIds || tx?.pspVoorstelIds
    setPspSelectie(ids ? [...ids] : [])
    setPspBtwPct('21')
    setPspToonAlles(false)
    setPspTxId(tx?.id ?? null)
  }

  const savePspKoppeling = () => {
    const tx = txMetId(pspTxId)
    if (!tx) return
    const facturen = (verkoopFacturen||[]).filter((f: any) => pspSelectie.includes(f.id))
    if (!facturen.length) return
    const som = r2(facturen.reduce((s: number, f: any) => s + (f.bruto||0), 0))
    const kosten = r2(som - tx.bedrag)
    if (kosten < -0.005) return
    const key = txKey(tx)
    // Nog niet betaalde facturen markeren als betaald met de transactiedatum.
    // De ids onthouden we in de koppeling zodat ontkoppelen ze kan terugzetten.
    const gemarkeerdBetaald = facturen.filter((f: any) => f.status !== 'betaald').map((f: any) => f.id)
    if (gemarkeerdBetaald.length) {
      setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
        gemarkeerdBetaald.includes(f.id) ? {...f, status: 'betaald', betaald_datum: f.betaald_datum || tx.datum} : f))
    }
    // Verschil tussen som facturen en uitbetaling → betaalde kostenpost
    let kostenFactuurId: number | undefined
    if (kosten > 0.005) {
      const btw = Number(pspBtwPct||0)
      const netto = btw > 0 ? r2(kosten / (1 + btw/100)) : kosten
      const btwBedrag = r2(kosten - netto)
      const rollover = getRolloverInfo(tx.datum)
      const naam = t('lbl_psp_kosten_regel').replace('{psp}', tx.tegenpartij || 'PSP')
      const kostenFactuur: any = {
        id: newId(inkoopFacturen||[]),
        leverancier: tx.tegenpartij || 'PSP',
        factuurnummer: '',
        datum: tx.datum,
        regels: [{type: 'overig', naam, netto, btw_tarief: btw, btw_bedrag: btwBedrag, btw_soort: 'binnenlands', kostensoort: 'Administratie'}],
        totaal_netto: netto,
        totaal_btw: btwBedrag,
        totaal_bruto: kosten,
        totaal_netto_cent: toCent(netto),
        totaal_btw_cent: toCent(btwBedrag),
        totaal_bruto_cent: toCent(kosten),
        status: 'betaald',
        betaald_datum: tx.datum,
        ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
      }
      kostenFactuurId = kostenFactuur.id
      setInkoopFacturen((prev: any[]) => [...(prev||[]), kostenFactuur])
      // Journaal (ERP-plan 2.1): automatische PSP-kostenpost boeken.
      setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(kostenFactuur, btwPeriodeType)))
      logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:kostenFactuur.id, actie:'aangemaakt', omschrijving:`PSP-kosten — ${kostenFactuur.leverancier} (${fmt(kosten)})`})
    }
    setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'psp', factuurIds: [...pspSelectie], kostenFactuurId, gemarkeerdBetaald}}))
    wijzigTx(tx.id, (t2: any) => ({...t2, gekoppeldPspFactuurIds: [...pspSelectie], pspHerkend: false, pspVoorstelIds: undefined, autoGematcht: false, herinneringsGematcht: false}))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`PSP-uitbetaling gekoppeld aan ${pspSelectie.length} facturen (kosten ${fmt(Math.max(kosten,0))})`})
    setPspTxId(null)
    setPspSelectie([])
  }

  const ontkoppelPsp = (tx: any) => {
    if (!tx) return
    const key = txKey(tx)
    // Via de ref: ook een uitgestelde ontkoppeling (afschrift verwijderen)
    // leest de nieuwste stand.
    const opgeslagen = (koppelingenRef.current || {})[key]
    if (opgeslagen?.soort === 'psp') {
      // Automatisch aangemaakte kostenpost weer verwijderen
      if (opgeslagen.kostenFactuurId) {
        setInkoopFacturen((prev: any[]) => (prev||[]).filter((f: any) => f.id !== opgeslagen.kostenFactuurId))
        // Journaal (ERP-plan 2.1): verwijderen = tegenboeking.
        setJournaal((prev: any[]) => voegBoekingToe(prev || [], stornoBoekingVoor(prev || [], 'inkoop_factuur', opgeslagen.kostenFactuurId)))
      }
      // Facturen die door deze koppeling betaald zijn gemarkeerd terugzetten
      const terug = opgeslagen.gemarkeerdBetaald || []
      if (terug.length) {
        setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
          terug.includes(f.id) ? {...f, status: 'open', betaald_datum: undefined} : f))
      }
    }
    setBankKoppelingen((k: any) => { const c = {...k}; delete c[key]; return c })
    wijzigTx(tx.id, (t2: any) => ({...t2, gekoppeldPspFactuurIds: undefined, pspHerkend: isPspTransactie(t2), autoGematcht: false, herinneringsGematcht: false}))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'PSP-koppeling ongedaan gemaakt'})
  }

  // ── SNd-afdracht (Statiegeld Nederland) — spiegel van het BTW-patroon ──────
  // Een afschrijving gekoppeld als {soort:'snd', periodeKey} zet die periode op
  // de Statiegeld-pagina op "afgedragen" (utils/sndAfdracht.ts).
  const koppelSndBetaling = (tx: any, periodeKey: string) => {
    if (!tx) return
    const key = txKey(tx)
    setBankKoppelingen((k: any) => ({...k, [key]: {soort: 'snd', periodeKey}}))
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) => txKey(t) === key ? {...t, gekoppeldSndPeriode: periodeKey} : t))
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'aangemaakt', omschrijving:`SNd-afdracht ${periodeKey} gekoppeld`});
  };

  const ontkoppelSndBetaling = (periodeKey: string) => {
    logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:`SNd-afdracht ${periodeKey} ontkoppeld`});
    setBankKoppelingen((k: any) => {
      const c = {...k};
      Object.keys(c).forEach(key => { if (c[key]?.soort === 'snd' && c[key].periodeKey === periodeKey) delete c[key]; });
      return c;
    });
    setBankTransacties((prev: any[]) => (prev || []).map((t: any) =>
      t.gekoppeldSndPeriode === periodeKey ? {...t, gekoppeldSndPeriode: undefined} : t
    ));
  };

  // SNd-periodes waar deze afschrijving de afdracht van kan zijn — wie geen
  // SNd-verpakkingen verkoopt, krijgt de keuze niet te zien. Elke ongekoppelde
  // afschrijving vraagt dit bij elke weergave (het ⋯-menu), en de berekening
  // loopt alle facturen en bestellingen door: per datum/bedrag bewaren tot de
  // gegevens veranderen (bijvoorbeeld niet opnieuw bij elke toets in het zoekveld).
  const sndCache = React.useMemo(() => new Map<string, any[]>(), [verkoopFacturen, bankKoppelingen, bestellingen, verpakkingen])
  const sndKandidaten = (tx: any): any[] => {
    const sleutel = `${tx?.datum}|${tx?.bedrag}`
    let uitkomst = sndCache.get(sleutel)
    if (!uitkomst) {
      uitkomst = sndKoppelKandidaten(verkoopFacturen, bankKoppelingen, tx, tod(), {bestellingen, verpakkingen})
      sndCache.set(sleutel, uitkomst)
    }
    return uitkomst
  }

  const markeerInkoopBetaald = (id: number, betaaldDatum?: string) => {
    setInkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === id ? {...f, status: 'betaald', betaald_datum: betaaldDatum || tod()} : f
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:id, actie:'gewijzigd', omschrijving:'Status → betaald'});
  }

  // Bijschrijving zonder factuur → betaalde verkoopfactuur (omzet + af te
  // dragen BTW), gekoppeld aan de transactie. Het bankbedrag is het bruto.
  const saveOntvangstBoeking = (invoer: {klant_naam: string, omschrijving: string, btw_pct: number}) => {
    const tx = txMetId(ontvangstTxId)
    if (!tx || tx.type !== 'C') { setOntvangstTxId(null); return }
    const rollover = getRolloverInfo(tx.datum)
    const nieuw = bouwOntvangstVerkoopFactuur(tx, {
      id: newId(verkoopFacturen||[]),
      klant_naam: invoer.klant_naam,
      omschrijving: invoer.omschrijving || tx.omschrijving || tx.tegenpartij || '',
      btw_pct: invoer.btw_pct,
      btw_periode: rollover ? rollover.rolloverNaar : null,
    })
    setVerkoopFacturen((prev: any[]) => [...(prev||[]), nieuw])
    // Journaal (ERP-plan 2.1): bankboeking (credit) als omzet boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], verkoopFactuurBoeking(nieuw)))
    logAudit(auditLog, setAuditLog, {entiteit:'Verkoopfactuur', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Boeking credit — ${nieuw.klant_naam}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    koppelBankTransactie(tx, nieuw.id, 'verkoop')
    setOntvangstTxId(null)
  }

  const sluitBoeking = () => { setBoekingTxId(null); setBoekingInitialData(null); setBoekingFout(null) }

  const saveBoekingFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any): boolean => {
    const tx = txMetId(boekingTxId)
    if (!tx) return false
    // Alleen afschrijvingen: een bijschrijving hier boeken zou ontvangen geld
    // als kosten en voorbelasting vastleggen (zie saveOntvangstBoeking).
    if (tx.type === 'C') { sluitBoeking(); return false }
    const verlegd = (factuurForm?.btw_soort || 'binnenlands') !== 'binnenlands'
    // Leverancier en datum vallen terug op de banktransactie.
    const kop = {...(factuurForm||{}), leverancier: factuurForm?.leverancier || tx.tegenpartij || '', datum: factuurForm?.datum || tx.datum}
    // Hetzelfde formulier als een gewone inkoopfactuur, dus ook dezelfde
    // verwerking: ingrediënt- en onderdeelregels komen op de factuur én in de
    // voorraad. Eerder telden hier alleen de vrije regels en verdween de rest stil.
    const {regels, merchInkopen} = bouwInkoopRegels({productLijst, verpakkingLijst, vrijeRegels}, kop, ing, {datum: tx.datum})
    // Het werkblad houdt dit zelf al tegen; blijft er na het omzetten toch
    // niets over, dan een melding bovenaan (geen alert) en niets opslaan.
    if (!regels.length) { setBoekingFout(t('err_min_one_product')); return false }
    setBoekingFout(null)
    boekInkoopVoorraad(kop, productLijst, verpakkingLijst)
    if (merchInkopen.length) {
      const geboekt = boekMerchMutaties(merchArtikelen, merchVoorraadLog, merchInkopen)
      setMerchArtikelen(geboekt.artikelen)
      setMerchVoorraadLog(geboekt.log)
    }
    // Totalen cent-exact (ERP-plan 2.2); cent-velden zijn de canonieke waarde.
    // Handmatige factuurtotalen gaan niet meer stil verloren: ze worden een
    // correctieregel, net als bij een gewone inkoopfactuur.
    const {regels: regelsMetCorrectie, totalen} = inkoopRegelsMetCorrectie(regels, totaalManual, {naam: t('lbl_correctie_factuurtotaal'), verlegd})
    const factuurDatum = factuurForm?.datum || tx.datum
    const rollover = getRolloverInfo(factuurDatum)
    const factuur: any = {
      id: newId(inkoopFacturen||[]),
      status: 'betaald',
      datum: factuurDatum,
      leverancier: factuurForm?.leverancier || tx.tegenpartij || '',
      factuurnummer: factuurForm?.factuur || '',
      regels: regelsMetCorrectie,
      totaal_netto: totalen.netto,
      totaal_btw: totalen.btw,
      totaal_bruto: totalen.bruto,
      totaal_netto_cent: totalen.netto_cent,
      totaal_btw_cent: totalen.btw_cent,
      totaal_bruto_cent: totalen.bruto_cent,
      bijlage: bijlage || null,
      ...(rollover ? {btw_periode: rollover.rolloverNaar} : {}),
    }
    setInkoopFacturen((prev: any[]) => [...(prev||[]), factuur])
    // Journaal (ERP-plan 2.1): boekingfactuur (bank) als inkoop boeken.
    setJournaal((prev: any[]) => voegBoekingToe(prev || [], inkoopFactuurBoeking(factuur, btwPeriodeType)))
    logAudit(auditLog, setAuditLog, {entiteit:'Inkoopfactuur', entiteit_id:factuur.id, actie:'aangemaakt', omschrijving:`Boekingfactuur — ${factuur.leverancier}${rollover ? ` (BTW → ${rollover.rolloverNaar})` : ''}`});
    koppelBankTransactie(tx, factuur.id, 'inkoop')
    sluitBoeking()
    return true
  }

  const saveKapitaalBoeking = () => {
    const bedrag = parseFloat(kapitaalForm.bedrag)
    if (!bedrag || bedrag <= 0) return
    const nieuw = {
      id: newId(kapitaalBoekingen || []),
      datum: kapitaalForm.datum || tod(),
      omschrijving: kapitaalForm.omschrijving.trim() || (kapitaalForm.type === 'storting' ? 'Kapitaalstorting' : 'Kapitaalonttrekking'),
      bedrag,
      type: kapitaalForm.type,
      eigenaar: kapitaalForm.eigenaar.trim() || undefined,
    }
    setKapitaalBoekingen((prev: any[]) => [...(prev || []), nieuw])
    logAudit(auditLog, setAuditLog, {entiteit:'Kapitaalboeking', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`${nieuw.type} — ${nieuw.omschrijving}`});
    const kapitaalTx = txMetId(kapitaalTxId)
    if (kapitaalTx) {
      const key = txKey(kapitaalTx)
      wijzigTx(kapitaalTx.id, (t: any) => ({ ...t, gekoppeldKapitaalId: nieuw.id, autoGematcht: false }))
      setBankKoppelingen((k: any) => ({ ...k, [key]: { soort: 'kapitaal', factuurId: nieuw.id } }))
    }
    sluitKapitaal()
  }

  const sluitKapitaal = () => { setShowKapitaalModal(false); setKapitaalTxId(null); setKapitaalForm(emptyKapitaalForm()) }

  const openKapitaal = (tx: any | null) => {
    if (!tx) { setKapitaalTxId(null); setKapitaalForm(emptyKapitaalForm()); setShowKapitaalModal(true); return }
    setKapitaalTxId(tx.id)
    setKapitaalForm({datum: tx.datum, omschrijving: tx.omschrijving||tx.tegenpartij||'', bedrag: String(tx.bedrag), type: tx.type === 'C' ? 'storting' : 'onttrekking', eigenaar: tx.tegenpartij||''})
    setShowKapitaalModal(true)
  }

  const openInkoopBoeking = (tx: any) => {
    setBoekingFout(null)
    setBoekingTxId(tx.id)
    setBoekingInitialData({datum: tx.datum, leverancier: tx.tegenpartij||'', factuurnummer: '', regels: [{type:'overig', naam: tx.omschrijving||tx.tegenpartij||'', hoeveelheid: 1, prijs_per_stuk: Math.abs(tx.bedrag), btw_tarief: 0, netto: Math.abs(tx.bedrag), btw_bedrag: 0}]})
  }

  // Navigatiedoel: actie 'importeren' (dashboardknop "Bankafschrift
  // importeren") opent meteen de bestandskiezer; `filter` (te_koppelen,
  // gekoppeld, alles) zet de beginchip (zie `navStatus`).
  React.useEffect(() => {
    if (navDoel?.actie === 'importeren') bankFileRef.current?.click()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Bewaarde afschriften: keuze, weergave en verwijderen ─────────────────
  // Een verwijdering wacht vijf seconden (UndoBar). Zo lang tonen we het
  // afschrift en de transacties die met hem verdwijnen al niet meer.
  const AFSCHRIFT_UNDO = 'bankafschrift-'
  const ONTKOPPEL_UNDO = 'bank-ontkoppel-'
  const undoId = undo.actie?.id || ''
  const wachtendId: number | null = undoId.startsWith(AFSCHRIFT_UNDO) ? Number(undoId.slice(AFSCHRIFT_UNDO.length)) : null
  const ontkoppelWachtId: number | null = undoId.startsWith(ONTKOPPEL_UNDO) ? Number(undoId.slice(ONTKOPPEL_UNDO.length)) : null
  // Nieuwste periode eerst ([0] is het laatste afschrift).
  const afschriften: any[] = React.useMemo(
    () => sorteerAfschriften(bankAfschriften || []).filter((a: any) => a.id !== wachtendId).reverse(),
    [bankAfschriften, wachtendId])
  const transacties: any[] = React.useMemo(
    () => wachtendId == null ? bankTransacties : verwijderAfschrift(bankTransacties, bankAfschriften || [], wachtendId).transacties,
    [bankTransacties, bankAfschriften, wachtendId])

  // Rekeningen: uit de afschriften (nieuwste eerst), aangevuld met wat er
  // aan transacties zonder afschrift is.
  const rekeningen: string[] = React.useMemo(() => {
    const s = new Set<string>()
    afschriften.forEach((a: any) => s.add(ibanSleutel(a)))
    transacties.forEach((tx: any) => s.add(ibanSleutel(tx)))
    return [...s]
  }, [afschriften, transacties])
  const meerdereRekeningen = rekeningen.length > 1
  const rekening: string = rekeningKeuze && (rekeningKeuze === 'alle' ? meerdereRekeningen : rekeningen.includes(rekeningKeuze))
    ? rekeningKeuze : (meerdereRekeningen ? 'alle' : (rekeningen[0] || 'alle'))
  const ibanFilter: string | null = rekening === 'alle' ? null : rekening
  const afschriftenVanRekening = ibanFilter ? afschriften.filter((a: any) => ibanSleutel(a) === ibanFilter) : afschriften
  const gekozenAfschrift: any = afschriftKeuze == null ? null : (afschriftenVanRekening.find((a: any) => Number(a.id) === afschriftKeuze) || null)
  // De saldocontrole hoort bij één afschrift: het gekozen, anders het laatste.
  const controleAfschrift: any = gekozenAfschrift || afschriftenVanRekening[0] || null
  // Saldo per rekening: het eindsaldo van het laatste afschrift — of het
  // saldo uit bank_saldi als dat nieuwer is (een ouder afschrift opnieuw
  // ingelezen; dezelfde regel als de Balans, liquideMiddelenOp).
  const laatstePerRekening: any[] = rekeningen
    .map(iban => {
      const a = afschriften.find((x: any) => ibanSleutel(x) === iban)
      const sl = (bankSaldi || {})[iban]
      if (a && sl && typeof sl === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(sl.datum || '')) && String(sl.datum) > String(a.tot || '')) {
        return {id: `saldo-${iban}`, iban, tot: sl.datum, eindsaldo: Number(sl.eindsaldo) || 0}
      }
      return a
    })
    .filter(Boolean)
    .filter((a: any) => !ibanFilter || ibanSleutel(a) === ibanFilter)

  // Een verkeerd ingelezen afschrift weghalen, met vijf seconden terugweg.
  // Een transactie die ook in een ander afschrift staat blijft. Wat weggaat
  // wordt eerst ontkoppeld met dezelfde handeling als "Ontkoppelen" (een
  // factuur komt weer vrij, een accijnsmaand terug op ingediend, een
  // PSP-kostenpost verdwijnt): anders bleef het geld van een verkeerd
  // afschrift aan facturen en aangiftes hangen, onzichtbaar op Bank. Opnieuw
  // inlezen koppelt de automatische koppelingen gewoon weer.
  // Vóór het uitrekenen de serverstand: een ander tabblad kan intussen een
  // afschrift hebben ingelezen dat transacties met dit afschrift deelt.
  // Zonder verse stand (eigen onbevestigde save, server weg) gelden de refs:
  // de uitvoering kan ook na een paginawissel komen.
  const koppelingenVanAfschrift = (a: any): number => {
    const plan = verwijderAfschrift(bankTxRef.current || [], afschriftenRef.current || [], a.id)
    const weg = new Set<number>(plan.verwijderdeIds)
    const k = koppelingenRef.current || {}
    const blijft = new Set<string>(plan.transacties.map((tx: any) => txKey(tx)))
    return (bankTxRef.current || []).filter((tx: any) => weg.has(tx.id) && k[txKey(tx)] && !blijft.has(txKey(tx))).length
  }
  const verwijderBankAfschrift = (a: any) => {
    if (!a) return
    const naam = a.afschriftNr || a.referentie || '—'
    const nKoppelingen = koppelingenVanAfschrift(a)
    const label = (nKoppelingen > 0 ? t('undo_bankafschrift_verwijderd_koppelingen').replace('{n}', String(nKoppelingen)) : t('undo_bankafschrift_verwijderd'))
      .replace('{afschrift}', naam)
    undo.plan(`${AFSCHRIFT_UNDO}${a.id}`, label, () => {
      const klaar = (async () => {
        const [vTx, vAf, vK] = await Promise.all([refreshBankTransacties(), refreshBankAfschriften(), refreshBankKoppelingen(), refreshBankSaldi()])
        const txNu: any[] = (Array.isArray(vTx) ? vTx : null) ?? bankTxRef.current ?? []
        const afNu: any[] = (Array.isArray(vAf) ? vAf : null) ?? afschriftenRef.current ?? []
        const koppelingenNu: any = (vK && typeof vK === 'object' ? vK : null) ?? koppelingenRef.current ?? {}
        koppelingenRef.current = koppelingenNu
        const plan = verwijderAfschrift(txNu, afNu, a.id)
        const weg = new Set<number>(plan.verwijderdeIds)
        // Ontkoppelen wat met dit afschrift verdwijnt — niet als een
        // transactie die blijft dezelfde sleutel draagt (die koppeling is van hem).
        const blijft = new Set<string>(plan.transacties.map((tx: any) => txKey(tx)))
        const mee = herstelKoppelingVlaggen(txNu.filter((tx: any) => weg.has(tx.id)), koppelingenNu)
          .filter((tx: any) => koppelingenNu[txKey(tx)] && !blijft.has(txKey(tx)))
        mee.forEach((tx: any) => laatste.current.ontkoppelTx(tx))
        // De refs meteen bijwerken: een import die op deze verwijdering wacht
        // rekent dan met de lijsten zonder dit afschrift.
        bankTxRef.current = plan.transacties
        afschriftenRef.current = plan.afschriften
        setBankTransacties((prev: any[]) => (prev || [])
          .filter((t: any) => !weg.has(t.id))
          .map((t: any) => plan.nieuweEigenaar[t.id] !== undefined ? {...t, afschrift_id: plan.nieuweEigenaar[t.id]} : t))
        setBankAfschriften((prev: any[]) => (prev || []).filter((x: any) => x.id !== a.id))
        setBankSaldi((prev: any) => bankSaldiNaVerwijderen(prev || {}, a, plan.afschriften))
        setAfschriftKeuze((k: number | null) => k === Number(a.id) ? null : k)
        logAudit(auditLog, setAuditLog, {entiteit:'Bankafschrift', entiteit_id:a.id, actie:'verwijderd',
          omschrijving:`Afschrift ${naam} (${a.iban || '—'}, ${a.van} t/m ${a.tot}) verwijderd — ${weg.size} transacties, ${mee.length} koppelingen`})
      })()
      const bezig = klaar.then(() => undefined, () => undefined)
      verwijderBezig.current = bezig
      void bezig.then(() => { if (verwijderBezig.current === bezig) verwijderBezig.current = null })
      return klaar
    })
  }

  // ── Koppelvoorstellen en weergave ─────────────────────────────────────────
  const voorstellen = React.useMemo(() => bankVoorstellen(transacties, {
    verkoopFacturen, inkoopFacturen, btwAangiftes, accijnsAangiftes, bankKoppelingen, klantNaam: klantNaamVoor,
  // klantNaamVoor is per render nieuw; de klantkaarten zelf staan in de deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [transacties, verkoopFacturen, inkoopFacturen, btwAangiftes, accijnsAangiftes, bankKoppelingen, klanten])
  const voorstelVan = (tx: any): BankVoorstel | undefined => voorstellen.get(bankVoorstelSleutel(tx))
  const tekstData: BankTekstData = {
    verkoopFacturen: verkoopFacturen || [], inkoopFacturen: inkoopFacturen || [], kapitaalBoekingen: kapitaalBoekingen || [],
    altRekeningen: altRekeningen || [], bankKoppelingen: bankKoppelingen || {}, klantNaamVoor,
  }

  // ── Filter: chip, zoeken, periode, rekening, afschrift ────────────────────
  const periodeUit: string | false = gekozenAfschrift ? t('bank_periode_uit_afschrift') : false
  const basisFilter = {
    iban: ibanFilter,
    afschrift: gekozenAfschrift,
    zoek,
    bereik: gekozenAfschrift ? null : bereik,
    extraTekst: (tx: any) => zoekTekstVoor(tx, voorstelVan(tx), tekstData),
  }
  const tellingen = telBankStatussen(transacties, basisFilter)
  const effStatus: BankStatusFilter = status ?? standaardBankStatus(tellingen)
  // De beginchip ligt vast zodra er transacties zijn: wie de laatste
  // koppelt, ziet "Alles is gekoppeld" in plaats van een lijst die vanzelf
  // naar Alles springt.
  React.useEffect(() => {
    if (status === null && transacties.length > 0) setStatus(effStatus)
  }, [status, transacties.length, effStatus])
  const lijst = filterBankTransacties(transacties, effStatus, basisFilter)
  const periodeReden: string | false = periodeUit || (effStatus === 'te_koppelen' ? t('bank_periode_uit_te_koppelen') : false)
  const chips = BANK_STATUS_FILTERS.map(c => ({
    id: c.id,
    label: t(c.sleutel),
    aantal: c.id === 'alles' ? null : tellingen[c.id],
    nadruk: c.id === 'te_koppelen',
  }))

  // ── Ontkoppelen (met vijf seconden terugweg) ──────────────────────────────
  // Per soort de bestaande handeling: een PSP-koppeling haalt ook de
  // kostenpost en de betaalstatus weg, accijns zet de maand terug op
  // ingediend. De uitvoering komt na vijf seconden en zoekt de transactie dan
  // pas op (via de ref naar de nieuwste stand).
  // `tx` met zijn koppelvlaggen (herstelKoppelingVlaggen): uit de weergave, of
  // bij het verwijderen van een afschrift opnieuw gezet uit bank_koppelingen.
  const ontkoppelTx = (tx: any) => {
    const k = koppelingVan(tx)
    if (!tx || !k) return
    switch (k.soort) {
      case 'psp': ontkoppelPsp(tx); break
      case 'verkoop': koppelBankTransactie(tx, null, 'verkoop'); break
      case 'inkoop': koppelBankTransactie(tx, null, 'inkoop'); break
      case 'kapitaal':
        wijzigTx(tx.id, (t: any) => ({...t, gekoppeldKapitaalId: null}))
        setBankKoppelingen((kk: any) => { const c={...kk}; delete c[txKey(tx)]; return c })
        logAudit(auditLog, setAuditLog, {entiteit:'Bankkoppeling', entiteit_id:0, actie:'verwijderd', omschrijving:'Kapitaalkoppeling ontkoppeld'})
        break
      case 'btw': ontkoppelBtwBetaling(k.periodeKey || ''); break
      case 'accijns': ontkoppelAccijnsBetaling(k.maand || ''); break
      case 'snd': ontkoppelSndBetaling(k.periodeKey || ''); break
      case 'aflossing': ontkoppelAflossing(tx); break
    }
  }
  const ontkoppelNu = (txId: number, verwacht?: string) => {
    const tx = txMetId(txId)
    const k = koppelingVan(tx)
    if (!tx || !k) return
    // Binnen de vijf seconden opnieuw gekoppeld (via het transactievenster):
    // die nieuwe koppeling blijft staan, alleen de geplande gaat eraf.
    if (verwacht !== undefined && JSON.stringify(k) !== verwacht) return
    ontkoppelTx(tx)
  }
  const laatste = React.useRef<{ontkoppelNu: (id: number, verwacht?: string) => void, ontkoppelTx: (tx: any) => void}>({ontkoppelNu, ontkoppelTx})
  laatste.current = {ontkoppelNu, ontkoppelTx}
  const planOntkoppel = (tx: any) => {
    const titel = koppelingWeergave(tx, tekstData)?.titel
    const gepland = JSON.stringify(koppelingVan(tx))
    undo.plan(`${ONTKOPPEL_UNDO}${tx.id}`, titel ? `${t('bank_undo_ontkoppeld')} · ${titel}` : t('bank_undo_ontkoppeld'),
      () => laatste.current.ontkoppelNu(tx.id, gepland))
  }

  // Het voorstel uitvoeren: dezelfde handelingen als met de hand koppelen.
  const voerVoorstelUit = (tx: any, v: BankVoorstel) => {
    if (v.soort === 'verkoop' || v.soort === 'inkoop') koppelBankTransactie(tx, v.doelId ?? null, v.soort)
    else if (v.soort === 'psp') openPspModal(tx, v.factuurIds)
    else if (v.soort === 'btw' && v.periodeKey) koppelBtwBetaling(tx, v.periodeKey)
    else if (v.soort === 'accijns' && v.maand) koppelAccijnsBetaling(tx, v.maand)
  }

  // ── Handelingen per transactie (⋯-menu en het transactievenster) ──────────
  const heeftCreditnotas = (inkoopFacturen || []).some((f: any) => (Number(f?.totaal_bruto) || 0) < 0)
  const actiesVoor = (tx: any): TransactieActie[] => {
    const k = koppelingVan(tx)
    const credit = tx.type === 'C'
    const uit: TransactieActie[] = []
    const kies = (soort: FactuurKiezerSoort) => () => setKiezer({soort, txId: tx.id})
    const kiesUit = (soort: KeuzeSoort) => () => setKeuze({soort, txId: tx.id})
    if (k) {
      if (k.soort === 'verkoop') {
        uit.push({id: 'open', groep: 'overig', label: t('bank_act_open_factuur'), onClick: () => gaNaarDoel({pagina: 'facturen', tab: 'verkoop', id: k.id})})
        uit.push({id: 'verkoop', groep: 'koppelen', label: t('bank_act_verkoop'), sub: t('bank_ba_sub_verkoop'), onClick: kies('verkoop')})
      }
      if (k.soort === 'inkoop') {
        uit.push({id: 'open', groep: 'overig', label: t('bank_act_open_factuur'), onClick: () => gaNaarDoel({pagina: 'facturen', tab: 'inkoop', id: k.id})})
        uit.push(credit
          ? {id: 'creditnota', groep: 'koppelen', label: t('bank_act_creditnota'), sub: t('bank_ba_sub_creditnota'), onClick: kies('creditnota')}
          : {id: 'inkoop', groep: 'koppelen', label: t('bank_act_inkoop'), sub: t('bank_ba_sub_inkoop'), onClick: kies('inkoop')})
      }
      if (k.soort === 'btw') uit.push({id: 'open', groep: 'overig', label: t('bank_act_open_aangifte'), onClick: () => gaNaarDoel({pagina: 'aangiftes', tab: 'btw', filter: k.periodeKey})})
      if (k.soort === 'accijns') uit.push({id: 'open', groep: 'overig', label: t('bank_act_open_aangifte'), onClick: () => gaNaarDoel({pagina: 'aangiftes', tab: 'accijns', filter: k.maand})})
      uit.push({id: 'ontkoppelen', groep: 'overig', label: t('bank_act_ontkoppelen'), gevaar: true, onClick: () => planOntkoppel(tx)})
      return uit
    }
    if (credit) {
      uit.push({id: 'verkoop', groep: 'koppelen', label: t('bank_act_verkoop'), sub: t('bank_ba_sub_verkoop'), onClick: kies('verkoop')})
      uit.push({id: 'psp', groep: 'koppelen', label: t('bank_act_psp'), sub: t('bank_ba_sub_psp'), onClick: () => openPspModal(tx, voorstelVan(tx)?.factuurIds)})
      if (heeftCreditnotas) uit.push({id: 'creditnota', groep: 'koppelen', label: t('bank_act_creditnota'), sub: t('bank_ba_sub_creditnota'), onClick: kies('creditnota')})
      uit.push({id: 'btw', groep: 'koppelen', label: t('bank_act_btw_teruggave'), sub: t('bank_ba_sub_btw_teruggave'), onClick: kiesUit('btw')})
      // Bijschrijving = omzet: ontvangstformulier (verkoopfactuur), nooit het inkoopformulier
      uit.push({id: 'ontvangst', groep: 'boeken', label: t('bank_act_ontvangst'), sub: t('bank_ba_sub_ontvangst'), onClick: () => setOntvangstTxId(tx.id)})
      uit.push({id: 'kapitaal', groep: 'boeken', label: t('bank_act_kapitaal_storting'), sub: t('bank_ba_sub_kapitaal'), onClick: () => openKapitaal(tx)})
      return uit
    }
    uit.push({id: 'inkoop', groep: 'koppelen', label: t('bank_act_inkoop'), sub: t('bank_ba_sub_inkoop'), onClick: kies('inkoop')})
    uit.push({id: 'btw', groep: 'koppelen', label: t('bank_act_btw_afdracht'), sub: t('bank_ba_sub_btw_afdracht'), onClick: kiesUit('btw')})
    uit.push({id: 'accijns', groep: 'koppelen', label: t('bank_act_accijns'), sub: t('bank_ba_sub_accijns'), onClick: kiesUit('accijns')})
    if (sndKandidaten(tx).length) uit.push({id: 'snd', groep: 'koppelen', label: t('bank_act_snd'), sub: t('bank_ba_sub_snd'), onClick: kiesUit('snd')})
    uit.push({id: 'inkoopboeking', groep: 'boeken', label: t('bank_act_inkoopboeking'), sub: t('bank_ba_sub_inkoopboeking'), onClick: () => openInkoopBoeking(tx)})
    if ((altRekeningen || []).length > 0) uit.push({id: 'aflossing', groep: 'boeken', label: t('bank_act_aflossing'), sub: t('bank_ba_sub_aflossing'), onClick: kiesUit('aflossing')})
    uit.push({id: 'kapitaal', groep: 'boeken', label: t('bank_act_kapitaal_onttrekking'), sub: t('bank_ba_sub_kapitaal'), onClick: () => openKapitaal(tx)})
    return uit
  }
  const naarRowActies = (lijstActies: TransactieActie[]): RowActie[] => lijstActies.map(a => ({
    id: a.id, label: a.label, onClick: a.onClick, disabled: a.disabled, ...(a.gevaar ? {soort: 'gevaar' as const} : {}),
  }))

  // De ene knop van een rij: het voorstel uitvoeren, uitsplitsen, de
  // gekoppelde factuur op betaald zetten (de koppeling is het betaalbewijs,
  // de status staat er los van) of kiezen wat het is.
  interface Hoofdknop { label: string, onClick: () => void, soort: 'primair' | 'betaald' | 'secundair' }
  const hoofdknopVoor = (tx: any): Hoofdknop | null => {
    if (ontkoppelWachtId === tx.id) return null
    const k = koppelingWeergave(tx, tekstData)
    if (k) {
      const onbetaald = k.onbetaald
      if (!onbetaald) return null
      return {
        label: t('bank_btn_markeer_betaald'), soort: 'betaald',
        onClick: () => onbetaald.soort === 'verkoop' ? markeerBetaald(onbetaald.id, tx.datum) : markeerInkoopBetaald(onbetaald.id, tx.datum),
      }
    }
    const v = voorstelVan(tx)
    if (v?.soort === 'psp') return {label: t('bank_btn_uitsplitsen'), soort: 'primair', onClick: () => voerVoorstelUit(tx, v)}
    if (v?.soort) return {label: t('bank_btn_koppel'), soort: 'primair', onClick: () => voerVoorstelUit(tx, v)}
    if (isPspTransactie(tx) && !tx.storno) return {label: t('bank_btn_uitsplitsen'), soort: 'secundair', onClick: () => openPspModal(tx)}
    return {label: t('bank_btn_boeken_als'), soort: 'secundair', onClick: () => setDetailTxId(tx.id)}
  }
  const knopKlasse = (soort: Hoofdknop['soort']): string =>
    soort === 'primair' ? 'tbtn border border-transparent'
      : soort === 'betaald' ? 'bg-green-50 hover:bg-green-100 text-green-800 border border-green-200'
      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
  // Gewone functies (geen component binnen een component): anders bouwt React
  // de knop bij elke render opnieuw op en raakt hij zijn focus kwijt.
  const hoofdknop = (tx: any, extra = '') => {
    const h = hoofdknopVoor(tx)
    if (!h) return null
    return (
      <button type="button" onClick={h.onClick}
        className={`px-3 min-h-tap sm:min-h-[30px] rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${knopKlasse(h.soort)} ${extra}`}>
        {h.label}
      </button>
    )
  }

  // De kolom "Koppeling of voorstel".
  const koppelCel = (tx: any, compact = false) => {
    if (ontkoppelWachtId === tx.id) return <span className="text-sm text-gray-500 italic">{t('bank_wordt_ontkoppeld')}</span>
    const k = koppelingWeergave(tx, tekstData)
    if (k) {
      return (
        <span className="block min-w-0">
          <span className={`block text-sm font-medium break-words ${k.ontbreekt ? 'text-orange-700' : 'text-gray-900'}`}>✓ {k.titel}</span>
          {(k.hints.length > 0 || k.onbetaald) && (
            <span className="block text-xs text-gray-500">
              {k.hints.join(' · ')}
              {k.onbetaald && <span className="text-orange-700">{k.hints.length ? ' · ' : ''}{t('bank_hint_onbetaald')}</span>}
            </span>
          )}
        </span>
      )
    }
    const v = voorstelVan(tx)
    if (!v) return null
    const w = voorstelWeergave(v, tx, tekstData)
    const waarschuw = v.ambigu || tx.storno || v.redenSleutel === 'bank_vs_reden_belastingdienst'
    return (
      <span className="block min-w-0">
        {v.soort ? (
          <span className="block text-sm text-gray-900 break-words">
            {compact && <span className="text-gray-500">{t('bank_voorstel')}: </span>}
            <span className="font-semibold">{w.titel}</span>
          </span>
        ) : (
          <span className="block text-sm text-gray-500">
            {tx.storno
              ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800" title={t('lbl_mt940_storno_hint')}>{t('lbl_mt940_storno')}</span>
              : w.titel}
          </span>
        )}
        {w.reden && <span className={`block text-xs break-words ${waarschuw ? 'text-orange-700' : 'text-gray-500'}`}>{w.reden}</span>}
      </span>
    )
  }

  const jaar = new Date().getFullYear()
  const kolommen: LijstKolom<any>[] = [
    {id: 'datum', kop: t('lbl_date'), klasse: 'whitespace-nowrap w-20 text-gray-600', cel: (tx: any) => korteDatum(tx.datum, jaar)},
    {
      id: 'tegenpartij', kop: t('bank_kol_tegenpartij'), klasse: 'max-w-[18rem]',
      cel: (tx: any) => (
        <span className="block min-w-0">
          <span className="block font-medium text-gray-900 truncate" title={tx.tegenpartij || undefined}>{tx.tegenpartij || tx.omschrijving || '—'}</span>
          {tx.tegenpartij && tx.omschrijving && <span className="block text-xs text-gray-500 truncate" title={tx.omschrijving}>{tx.omschrijving}</span>}
          {/* Onder 1024 px geen eigen kolom voor de koppeling (de rij-actie
              viel dan buiten de kaart): hij staat hier onder de namen. */}
          <span className="lg:hidden block mt-0.5">{koppelCel(tx, true)}</span>
        </span>
      ),
    },
    {
      id: 'bedrag', kop: t('bank_kol_bedrag'), rechts: true, klasse: 'whitespace-nowrap',
      cel: (tx: any) => <span className={`font-semibold ${tx.type === 'C' ? 'text-green-700' : 'text-red-700'}`}>{bedragMetTeken(tx)}</span>,
    },
    {id: 'koppeling', kop: t('bank_kol_koppeling'), klasse: 'min-w-[14rem]', breed: true, cel: (tx: any) => koppelCel(tx)},
    {
      id: 'actie', kop: <span className="sr-only">{t('bank_kol_actie')}</span>, rechts: true, klasse: 'whitespace-nowrap w-1',
      cel: (tx: any) => (
        <span className="inline-flex items-center justify-end gap-1">
          {hoofdknop(tx)}
          {ontkoppelWachtId !== tx.id && <RowActions acties={naarRowActies(actiesVoor(tx))} />}
        </span>
      ),
    },
  ]
  const kaart = (tx: any) => (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 truncate min-w-0">{tx.tegenpartij || tx.omschrijving || '—'}</span>
        <span className={`text-sm font-semibold whitespace-nowrap tabular-nums ${tx.type === 'C' ? 'text-green-700' : 'text-red-700'}`}>{bedragMetTeken(tx)}</span>
      </div>
      <div className="text-xs text-gray-500 truncate">
        {korteDatum(tx.datum, jaar)}{tx.tegenpartij && tx.omschrijving ? ` · ${tx.omschrijving}` : ''}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">{koppelCel(tx, true)}</div>
        {hoofdknop(tx, KAART_INTERACTIEF)}
      </div>
    </div>
  )

  const leeg = effStatus === 'te_koppelen' && !zoek.trim()
    ? <LegeStaat titel={t('bank_leeg_te_koppelen')} tekst={t('bank_leeg_te_koppelen_tekst')} icoon="check" />
    : <LegeStaat titel={t('bank_leeg_filter')} tekst={t('bank_leeg_filter_tekst')} icoon="search" />

  // ── Kiezers ───────────────────────────────────────────────────────────────
  const keuzeModal = (() => {
    const tx = keuze ? txMetId(keuze.txId) : null
    if (!keuze || !tx) return null
    const sluit = () => setKeuze(null)
    if (keuze.soort === 'btw') {
      const credit = tx.type === 'C'
      const opties: KeuzeOptie[] = btwKiezerKandidaten(tx, btwAangiftes, bankKoppelingen).map(r => ({
        id: r.sleutel,
        titel: btwTitel(r.sleutel, credit, true),
        sub: [t('bank_kies_status_ingediend') + (r.aangifte?.ingediend_datum ? ` ${fmtD(r.aangifte.ingediend_datum)}` : ''),
          r.verschilCent > 0 ? vulIn(t('bank_kies_verschil'), {verschil: geldCent(r.verschilCent)}) : ''].filter(Boolean).join(' · '),
        waarde: geldCent(r.bedragCent),
        klopt: r.verschilCent <= AANGIFTE_MARGE_CENT,
      }))
      return <KeuzeModal titel={t('bank_kies_btw_titel')} tx={tx} opties={opties} onSluit={sluit}
        onKies={(id) => koppelBtwBetaling(tx, id)}
        leeg={{titel: t('bank_kies_btw_leeg'), tekst: t('bank_kies_btw_leeg_tekst'), knop: {label: t('bank_naar_aangiftes'), onClick: () => gaNaarDoel({pagina: 'aangiftes', tab: 'btw'})}}} />
    }
    if (keuze.soort === 'accijns') {
      const opties: KeuzeOptie[] = accijnsKiezerKandidaten(tx, accijnsAangiftes, bankKoppelingen).map(r => ({
        id: r.sleutel,
        titel: accijnsTitel(r.sleutel),
        sub: [r.aangifte?.status === 'betaald' ? t('bank_kies_status_betaald') : t('bank_kies_status_ingediend'),
          r.verschilCent > 0 ? vulIn(t('bank_kies_verschil'), {verschil: geldCent(r.verschilCent)}) : ''].filter(Boolean).join(' · '),
        waarde: geldCent(r.bedragCent),
        klopt: r.verschilCent <= AANGIFTE_MARGE_CENT,
      }))
      return <KeuzeModal titel={t('bank_kies_accijns_titel')} tx={tx} opties={opties} onSluit={sluit}
        onKies={(maand) => koppelAccijnsBetaling(tx, maand)}
        leeg={{titel: t('bank_kies_accijns_leeg'), tekst: t('bank_kies_btw_leeg_tekst'), knop: {label: t('bank_naar_aangiftes'), onClick: () => gaNaarDoel({pagina: 'aangiftes', tab: 'accijns'})}}} />
    }
    if (keuze.soort === 'snd') {
      const opties: KeuzeOptie[] = sndKandidaten(tx).map((p: any) => ({
        id: p.key, titel: vulIn(t('bank_kop_snd'), {periode: periodeKeyLabel(p.key)}), waarde: fmt(p.bedrag),
        klopt: Math.abs(toCent(p.bedrag) - toCent(tx.bedrag)) <= 1,
      }))
      return <KeuzeModal titel={t('bank_kies_snd_titel')} tx={tx} opties={opties} onSluit={sluit}
        onKies={(key) => koppelSndBetaling(tx, key)} leeg={{titel: t('bank_kies_snd_leeg')}} />
    }
    const opties: KeuzeOptie[] = (altRekeningen || []).map((r: any) => {
      const v = schuldPerAltRekening[r.id] || {openstaand: 0}
      return {id: String(r.id), titel: r.naam, sub: r.eigenaar || undefined, waarde: v.openstaand > 0.005 ? fmt(v.openstaand) : '—'}
    })
    return <KeuzeModal titel={t('title_aflossing_kies')} tx={tx} uitleg={t('msg_kies_aflossing_rekening')} opties={opties} onSluit={sluit}
      onKies={(id) => koppelAflossing(tx, Number(id))} leeg={{titel: t('msg_geen_alt_rekeningen')}} />
  })()

  const detailModal = (() => {
    const tx = txMetId(detailTxId)
    if (!tx) return null
    const k = koppelingWeergave(tx, tekstData)
    const v = voorstelVan(tx)
    const h = hoofdknopVoor(tx)
    const toonKnop = h && h.soort !== 'secundair'
    const status = (k || v?.soort || v?.redenSleutel) ? (
      <div className="rounded-lg border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 min-w-[12rem]">{koppelCel(tx, true)}</div>
        {toonKnop && h && (
          <button type="button" onClick={() => { setDetailTxId(null); h.onClick() }}
            className={`px-3 min-h-tap sm:min-h-[32px] rounded-lg text-sm font-medium whitespace-nowrap ${knopKlasse(h.soort)}`}>{h.label}</button>
        )}
      </div>
    ) : null
    return <TransactieModal tx={tx} titel={k ? t('bank_tx_titel') : t('bank_ba_titel')} status={status}
      acties={actiesVoor(tx)} onSluit={() => setDetailTxId(null)} />
  })()

  const kiezerModal = (() => {
    const tx = kiezer ? txMetId(kiezer.txId) : null
    if (!kiezer || !tx) return null
    return <FactuurKiezer tx={tx} soort={kiezer.soort}
      facturen={kiezer.soort === 'verkoop' ? (verkoopFacturen || []) : (inkoopFacturen || [])}
      bankKoppelingen={bankKoppelingen || {}} klantNaamVoor={klantNaamVoor}
      onKies={(id) => koppelBankTransactie(tx, id, kiezer.soort === 'verkoop' ? 'verkoop' : 'inkoop')}
      onSluit={() => setKiezer(null)} />
  })()

  // ── Weergave ──────────────────────────────────────────────────────────────
  const leegBank = afschriften.length === 0 && transacties.length === 0
  const kiesBestand = () => bankFileRef.current?.click()
  const knopSec = 'px-4 py-1.5 min-h-tap sm:min-h-0 rounded-lg text-sm font-medium bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm transition-colors whitespace-nowrap'
  const knopPrim = 'px-4 py-1.5 min-h-tap sm:min-h-0 rounded-lg text-sm font-medium tbtn shadow-sm transition-colors whitespace-nowrap'

  return (
    <div className="space-y-4 min-w-0">
      <input ref={bankFileRef} type="file" accept=".sta,.txt,.mt940,.swi,.940,.swift" className="hidden"
        onChange={(e: any) => { const f = e.target.files?.[0]; if (f) { undo.flush(); importMT940(f); e.target.value=''; } }} />

      {/* Kop: rekening, saldo van het laatste afschrift, importeren */}
      {!leegBank && (
        <div className="flex flex-col md:flex-row md:items-center gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
            {meerdereRekeningen ? (
              <select value={rekening} aria-label={t('bank_rekening')}
                onChange={(e: any) => { setRekeningKeuze(e.target.value); setAfschriftKeuze(null) }}
                className="w-full md:w-auto border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap md:min-h-0 bg-white t-input outline-none shadow-sm">
                <option value="alle">{t('bank_alle_rekeningen')}</option>
                {rekeningen.map(iban => <option key={iban} value={iban}>{ibanWeergave(iban)}</option>)}
              </select>
            ) : rekeningen[0] ? (
              <span className="text-sm font-mono font-medium text-gray-800">{ibanWeergave(rekeningen[0])}</span>
            ) : null}
            {laatstePerRekening.map((a: any) => (
              <span key={a.id} className="text-sm text-gray-600">
                {rekening === 'alle' && meerdereRekeningen && (
                  <span className="font-mono text-gray-500 mr-1.5">{ibanSleutel(a) === 'onbekend' ? t('lbl_onbekend') : `…${ibanSleutel(a).slice(-4)}`}</span>
                )}
                {/* Het bedrag vet binnen de vertaalde zin ("Saldo {bedrag} op {datum}"). */}
                {t('bank_saldo_op').replace('{datum}', fmtD(a.tot) || '—').split('{bedrag}').map((deel, i, delen) => (
                  <React.Fragment key={i}>{deel}{i < delen.length - 1 && <b className="text-gray-900 tabular-nums">{fmt(a.eindsaldo)}</b>}</React.Fragment>
                ))}
              </span>
            ))}
          </div>
          {smal ? (
            // Telefoon: één knop over de breedte, de rest onder ⋯ — de lijst
            // hoort zo hoog mogelijk te beginnen.
            <div className="flex items-center gap-2">
              <button type="button" onClick={kiesBestand} className={`${knopPrim} flex-1`}>{t('bank_btn_importeren')}</button>
              <RowActions acties={[
                {id: 'afschriften', label: t('bank_btn_afschriften'), onClick: () => setAfschriftenOpen(true)},
                {id: 'kapitaal', label: t('bank_btn_kapitaal'), onClick: () => openKapitaal(null)},
              ]} />
            </div>
          ) : (
            <div className="md:ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setAfschriftenOpen(true)} className={knopSec}>{t('bank_btn_afschriften')}</button>
              <button type="button" onClick={() => openKapitaal(null)} className={knopSec}>{t('bank_btn_kapitaal')}</button>
              <button type="button" onClick={kiesBestand} className={knopPrim}>{t('bank_btn_importeren')}</button>
            </div>
          )}
        </div>
      )}

      {/* Uitkomst van de laatste import: hoeveel er nieuw was, of dat dit
          afschrift er al stond. */}
      {importMelding && (
        <div role={importMelding.soort === 'fout' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          importMelding.soort === 'al' ? 'bg-gray-50 border-gray-200 text-gray-700'
            : importMelding.soort === 'fout' ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-green-50 border-green-200 text-green-800'}`}>
          <span className="flex-1 min-w-0 break-words">{importMelding.tekst}</span>
          <button type="button" onClick={()=>setImportMelding(null)} aria-label={t('btn_sluiten')} title={t('btn_sluiten')}
            className="flex-shrink-0 px-1 min-h-tap sm:min-h-0 text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {leegBank ? (
        <LegeStaat titel={t('bank_leeg_titel')} icoon="bank">
          <button type="button" onClick={kiesBestand} className={knopPrim}>{t('bank_btn_importeren')}</button>
          <button type="button" onClick={() => openKapitaal(null)} className={knopSec}>{t('bank_btn_kapitaal')}</button>
        </LegeStaat>
      ) : (
        <>
          {/* Eén aansluitregel voor het gekozen of het laatste afschrift. */}
          {controleAfschrift && (
            <Aansluiting afschrift={controleAfschrift} afschriften={afschriften} transacties={transacties}
              gekozen={!!gekozenAfschrift} onWis={() => setAfschriftKeuze(null)}
              metIban={meerdereRekeningen && rekening === 'alle' ? ibanWeergave(ibanSleutel(controleAfschrift)) : undefined} />
          )}

          <FilterBalk<BankStatusFilter>
            zoek={zoek} onZoek={setZoek} zoekPlaceholder={t('bank_zoek_ph')}
            status={{chips, waarde: effStatus, onKies: setStatus}}
            periode={{keuze: periodeKeuze, onKeuze: setPeriodeKeuze, eigen: eigenPeriode, onEigen: setEigenPeriode, uit: periodeReden}}
            onWis={() => { setZoek(''); setPeriodeKeuze(STANDAARD_PERIODE) }}
          />

          <ResponsiveLijst
            rijen={lijst}
            sleutel={(tx: any) => tx.id ?? txKey(tx)}
            kolommen={kolommen}
            kaart={kaart}
            primaireKolom="tegenpartij"
            onKies={(tx: any) => setDetailTxId(tx.id)}
            rijLabel={(tx: any) => `${tx.tegenpartij || tx.omschrijving || t('lbl_onbekend')}, ${bedragMetTeken(tx)}, ${fmtD(tx.datum)}`}
            rijKlasse={(tx: any) => ontkoppelWachtId === tx.id ? 'opacity-60' : ''}
            label={t('bank_lijst_label')}
            leeg={leeg}
          />
        </>
      )}

      {/* Een boeking die na het omzetten geen regels overhoudt: melding boven
          het werkblad (dat blijft open met de invoer erin). */}
      {boekingFout && boekingTxId !== null && (
        <div role="alert" className="fixed top-3 left-1/2 -translate-x-1/2 z-[210] max-w-[calc(100vw-2rem)] flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm shadow-lg">
          <span className="min-w-0 break-words">{boekingFout}</span>
          <button type="button" onClick={() => setBoekingFout(null)} aria-label={t('btn_sluiten')}
            className="flex-shrink-0 px-1 min-h-tap sm:min-h-0 text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {afschriftenOpen && (
        <AfschriftenModal afschriften={afschriften} transacties={transacties} meerdereRekeningen={meerdereRekeningen}
          gekozenId={gekozenAfschrift ? Number(gekozenAfschrift.id) : null}
          onToon={(a: any) => {
            setAfschriftKeuze(Number(a.id))
            if (ibanFilter && ibanSleutel(a) !== ibanFilter) setRekeningKeuze(ibanSleutel(a))
          }}
          onVerwijder={verwijderBankAfschrift} onImporteer={kiesBestand} onSluit={() => setAfschriftenOpen(false)} />
      )}

      {detailModal}
      {kiezerModal}
      {keuzeModal}

      {/* PSP-uitbetaling uitsplitsen */}
      {txMetId(pspTxId) && (
        <PspModal tx={txMetId(pspTxId)} verkoopFacturen={verkoopFacturen || []}
          selectie={pspSelectie} setSelectie={setPspSelectie} btwPct={pspBtwPct} setBtwPct={setPspBtwPct}
          toonAlles={pspToonAlles} setToonAlles={setPspToonAlles} kandidatenVoor={pspKandidatenVoor}
          klantNaamVoor={klantNaamVoor} onOpslaan={savePspKoppeling}
          onSluit={() => { setPspTxId(null); setPspSelectie([]) }} />
      )}

      {showKapitaalModal && (
        <KapitaalModal form={kapitaalForm} setForm={setKapitaalForm} tx={txMetId(kapitaalTxId)}
          onOpslaan={saveKapitaalBoeking} onSluit={sluitKapitaal} />
      )}

      {/* Nieuwe boeking modal */}
      {boekingTxId !== null && boekingInitialData && (
        <InkoopFactuurModal merchArtikelen={merchArtikelen}
          knownLeveranciers={knownLeveranciers}
          ing={ing}
          lots={lots}
          onderdelen={onderdelen}
          inkoopFacturen={inkoopFacturen}
          btwPeriodeType={btwPeriodeType}
          bankBedrag={Math.abs(Number(txMetId(boekingTxId)?.bedrag) || 0) || null}
          initialTab="vrije"
          initialData={boekingInitialData}
          onSave={saveBoekingFactuur}
          scanCorrecties={scanCorrecties}
          onScanCorrectie={(c: any) => setScanCorrecties((prev: any) => registreerScanCorrectie(prev || [], c))}
          onLeer={(k: any) => setScanCorrecties((prev: any) => leerKoppelingen(prev || [], k))}
          onClose={sluitBoeking}
          claudeCreds={claudeCreds}
          breweryNaam={(breweryDetails as any)?.naam || ''}
          ingTypes={ingTypes}
          ingTypeBtw={ingTypeBtw}
          kostenSoorten={kostenSoorten}
          getRolloverInfo={getRolloverInfo}
        />
      )}

      {/* Ontvangst boeken (bijschrijving zonder factuur → verkoopfactuur) */}
      {txMetId(ontvangstTxId) && (
        <OntvangstBoekingModal
          tx={txMetId(ontvangstTxId)}
          standaardPct={standaardBtwPct(btwInst)}
          tarieven={[0, 9, 21]}
          rollover={getRolloverInfo(txMetId(ontvangstTxId).datum)}
          onSave={saveOntvangstBoeking}
          onClose={()=>setOntvangstTxId(null)}
        />
      )}
    </div>
  );
}

export default BankSectie
