import React from 'react'
import type { AttentieDoel } from '../../utils/attentie'

// ── Administratie: gedeelde context ─────────────────────────────────────────
// De oude BoekhoudingPage (één component met zeven tabbladen) is opgedeeld in
// Facturen, Bank, Aangiftes en Rapporten. Wat meer dan één van die secties
// nodig heeft — de data uit App, de afleidingen die op meerdere plekken
// meetellen (BTW-rollover, alt-rekeningschuld) en de handelingen die vanuit
// twee kanten gebeuren (een BTW- of accijnsbetaling koppelen kan vanuit Bank
// én Aangiftes) — leeft in AdministratiePage en komt via deze context bij de
// secties. Een sectie houdt zijn eigen formulieren, filters en modals zelf.

export type AdminSectie = 'facturen' | 'bank' | 'aangiftes' | 'rapporten'

/** Ingelogde gebruiker + rol (`/api/whoami`), of null buiten HA. */
export interface AdminGebruiker { gebruiker: string, rol: string }

/**
 * Alles wat de secties uit de context lezen. De data en setters komen
 * ongewijzigd uit App (dezelfde props als de oude BoekhoudingPage) en zijn
 * bewust `any`: de overgenomen code rekende op ongetypeerde props, en de
 * pagina's draaien niet strict.
 */
export interface AdminContextWaarde {
  // ── Navigatie ─────────────────────────────────────────────────────────────
  sectie: AdminSectie
  /** Eenmalig navigatiedoel (`AttentieDoel`): tab/filter/id/actie. AdministratiePage
      meldt het na de eerste weergave als verwerkt; een sectie leest het alleen
      in zijn beginstand. */
  navDoel: AttentieDoel | null
  gaNaarDoel: (d: AttentieDoel) => void
  whoami: AdminGebruiker | null
  setPage: (id: string) => void
  setOpenOrderId: (id: number | null) => void
  onNaarPostvakInstellingen: () => void

  // ── Data uit App (useStore) ───────────────────────────────────────────────
  wcCreds: any
  inkoopFacturen: any; setInkoopFacturen: any
  verkoopFacturen: any; setVerkoopFacturen: any
  ing: any; setIng: any
  lots: any; setLots: any
  onderdelen: any; setOnderdelen: any
  verpakkingen: any
  log: any; setLog: any
  btwInst: any
  claudeCreds: any
  ingTypes: any
  ingTypeBtw: any
  /** Bestellingen; Bank zet er `factuur_id` op als hij een factuur vooraf maakt (utils/orderFactuur.ts). */
  bestellingen: any; setBestellingen: any
  bat: any
  acc: any; setAcc: any
  breweryDetails: any
  factuurLogo: any
  klanten: any; setKlanten: any
  factuurCounter: any; setFactuurCounter: any
  artikelen: any
  bankKoppelingen: any; setBankKoppelingen: any
  kapitaalBoekingen: any; setKapitaalBoekingen: any
  altRekeningen: any; setAltRekeningen: any
  accijnsAangiftes: any; setAccijnsAangiftes: any
  btwAangiftes: any; setBtwAangiftes: any
  av: any
  uit: any
  afboekingen: any
  bi: any
  accijnsInst: any
  auditLog: any; setAuditLog: any
  kostenSoorten: any
  smtpCreds: any
  mollieCreds: any
  appName: string
  logo: any
  mailTemplates: any
  scanCorrecties: any; setScanCorrecties: any
  journaal: any; setJournaal: any
  bankSaldi: any; setBankSaldi: any
  jaarafsluitingen: any; setJaarafsluitingen: any
  merchArtikelen: any; setMerchArtikelen: any
  merchVoorraadLog: any; setMerchVoorraadLog: any
  inkoopInbox: any; setInkoopInbox: any
  refreshInkoopInbox: () => Promise<any>
  imapCreds: any

  // ── Bewaarde bankafschriften (useStore in App) ────────────────────────────
  // `bankTransacties` is de bewaarde lijst mét de koppelvlaggen opnieuw gezet
  // uit `bank_koppelingen` (herstelKoppelingVlaggen, utils/bank.ts): lees de
  // vlaggen altijd hier, nooit uit de ruwe opslag. `setBankTransacties`
  // schrijft de bewaarde lijst; wijzig een transactie op id of txKey, nooit
  // op zijn plek in de lijst (die kan tussen weergave en klik veranderen).
  bankTransacties: any[]; setBankTransacties: any
  bankAfschriften: any[]; setBankAfschriften: any
  /** De serverstand ophalen (useStore-refresh): de verse waarde, of null als er
      een eigen wijziging openstaat of de server niet bereikbaar is — dan geldt
      de eigen stand. De ruwe opslag, dus zonder herstelde koppelvlaggen. */
  refreshBankTransacties: () => Promise<any[] | null>
  refreshBankAfschriften: () => Promise<any[] | null>
  refreshBankKoppelingen: () => Promise<Record<string, any> | null>
  refreshBankSaldi: () => Promise<Record<string, any> | null>

  // ── Gedeelde afleidingen en handelingen ───────────────────────────────────
  klantNaamVoor: (f: any) => string
  schuldPerAltRekening: Record<number, { opgenomen: number, afgelost: number, openstaand: number }>
  totaleSchuldAltRekeningen: number
  addLog: (entry: any) => void
  knownLeveranciers: string[]
  btwBetaaldePerioden: Set<string>
  btwIngediendePerioden: Record<string, any>
  btwIngediendeKeys: Set<string>
  btwPeriodeType: 'maand' | 'kwartaal'
  getRolloverInfo: (datum: string) => any
  boekInkoopVoorraad: (kop: any, productLijst: any[], verpakkingLijst: any[]) => void
  markeerBetaald: (factuurId: any, betaaldDatum?: string) => void
  /** Transactie als object (voorkeur) of als index in `bankTransacties`. */
  koppelBtwBetaling: (tx: any, periodeKey: string) => void
  ontkoppelBtwBetaling: (periodeKey: string) => void
  markeerAccijnsMaandBetaald: (maandKey: string, datum: string) => void
  ontkoppelAccijnsBetaling: (maandKey: string) => void
  /** Transactie als object (voorkeur) of als txKey; zet de maand op betaald (transactiedatum). */
  koppelAccijnsBetaling: (tx: any, maandKey: string) => void

  // ── PSP-uitbetalingen: kosten verrekenen met de factuur van de PSP ─────────
  // (utils/pspUitbetaling.ts) — vanuit Bank (de uitbetaling) én Facturen (de
  // factuur van Mollie e.d.).
  /** De status van deze inkoopfacturen gelijkzetten met de verrekeningen in `koppelingen`. */
  werkVerrekendeFacturenBij: (koppelingen: Record<string, any>, factuurIds: number[]) => void
  /** Mag deze automatische kostenpost vervallen (niet in een ingediende BTW-periode)? */
  kostenpostMagVervallen: (factuurId: number) => boolean
  /**
   * Verrekeningen vastleggen, per factuur de gekozen uitbetalingen (cent 0 =
   * niet meer). Vervallen kostenposten gaan weg met een tegenboeking; de
   * facturen volgen met hun status. `basis`: de nieuwste koppelingen als de
   * aanroeper die al heeft. False = niets gedaan (kostenpost vergrendeld).
   */
  verrekenPspKosten: (ops: { factuurId: number, keuzes: { key: string, cent: number }[] }[], basis?: Record<string, any>) => Record<string, any> | false
}

export const AdminContext = React.createContext<AdminContextWaarde | null>(null)

export function useAdmin(): AdminContextWaarde {
  const w = React.useContext(AdminContext)
  if (!w) throw new Error('useAdmin buiten AdministratiePage')
  return w
}

// ── Pure hulpjes, gedeeld door de secties ───────────────────────────────────

/** Unieke sleutel per banktransactie: de sleutel van `bank_koppelingen`.
    Eén definitie, in utils/bank.ts — de import, het herstel van de vlaggen
    en de secties moeten precies dezelfde sleutel maken. */
export { txKey } from '../../utils/bank'

// Lokale fmt functie — bewust anders dan globale fmt (geen € teken prefix style)
export const fmt = (n: any) => '€ ' + Number(n).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.')

export const card = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-5'
