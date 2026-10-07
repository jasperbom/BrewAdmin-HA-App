// ── Automatische koppeling bij het inlezen van een bankafschrift ────────────
// Wat er gebeurt met de nieuwe transacties van een MT940-import (Administratie
// → Bank, `importMT940` in pages/admin/BankSectie.tsx). Puur: de pagina zet de
// uitkomst in de opslag (koppelingen, transacties, accijnsmaanden op betaald).
//
//  - een eerder opgeslagen koppeling (`bank_koppelingen`, sleutel txKey) komt
//    terug op de transactie — van vóór het bewaren, of van een afschrift dat
//    verwijderd en opnieuw ingelezen is;
//  - een terugboeking (storno) wordt nooit automatisch gekoppeld;
//  - facturen op match-score (ERP-plan 2.4, `besteMatch`): bedrag is de
//    toegangseis, kenmerk en tegenpartij tellen mee, gelijke score = ambigu
//    (niet koppelen). Met de datumgrens van het koppelvoorstel (ERP-plan F11,
//    `besteMatchBinnenDatum` in utils/bankVoorstel.ts): een factuur die meer
//    dan VOORSTEL_MAX_DAGEN_VOORUIT dagen ná de transactie gedateerd is, kan
//    niet met dat geld betaald zijn en wordt hier dus ook niet stil gekoppeld;
//  - BTW-aangiftes en accijnsmaanden op bedrag (± € 1) met dezelfde match
//    als het voorstel (`btwAangifteMatch`/`accijnsAangifteMatch`), elke
//    periode hooguit één betaling; PSP-uitbetalingen alleen herkend met een
//    voorstel (de gebruiker bevestigt).
//
// Facturen die al aan een banktransactie hangen (ook in een PSP-bundel) doen
// niet mee, en elke koppeling in deze import komt erbij: een tweede betaling
// van hetzelfde bedrag mag nooit stil aan dezelfde factuur blijven hangen.

import {
  txKey, gekoppeldeFactuurIds, isPspTransactie, pspKandidaten, zoekPspCombinatie,
} from './bank'
import { besteMatchBinnenDatum, btwAangifteMatch, accijnsAangifteMatch } from './bankVoorstel'

export interface AutoKoppelContext {
  verkoopFacturen?: any[] | null
  inkoopFacturen?: any[] | null
  btwAangiftes?: any[] | null
  accijnsAangiftes?: any[] | null
  bankKoppelingen?: Record<string, any> | null
}

export interface AutoKoppelResultaat {
  /** De nieuwe transacties, met hun koppelvlaggen (zelfde volgorde). */
  transacties: any[]
  /** Nieuwe koppelingen voor `bank_koppelingen` (sleutel txKey). */
  koppelingen: Record<string, any>
  /** Automatisch gekoppelde accijnsmaanden: op betaald met de transactiedatum. */
  accijnsBetaald: { maand: string, datum: string }[]
}

/** De nieuwe transacties van een import automatisch koppelen (zie boven). */
export function autoKoppelImport(nieuw: readonly any[] | null | undefined, ctx: AutoKoppelContext): AutoKoppelResultaat {
  const verkoopFacturen = ctx.verkoopFacturen || []
  const inkoopFacturen = ctx.inkoopFacturen || []
  const bankKoppelingen: Record<string, any> = ctx.bankKoppelingen || {}
  const openVerkoop = verkoopFacturen.filter((f: any) => f.status !== 'betaald')
  const openInkoop = inkoopFacturen.filter((f: any) => f.status !== 'betaald')
  const bezetVerkoop = gekoppeldeFactuurIds(bankKoppelingen, 'verkoop')
  const bezetInkoop = gekoppeldeFactuurIds(bankKoppelingen, 'inkoop')
  // Periodes/maanden waarvan al een betaling gekoppeld is.
  const btwBetaaldePerioden = new Set<string>()
  const accijnsBetaaldeMaanden = new Set<string>()
  for (const k of Object.values(bankKoppelingen) as any[]) {
    if (k?.soort === 'btw' && k.periodeKey) btwBetaaldePerioden.add(k.periodeKey)
    if (k?.soort === 'accijns' && k.maandKey) accijnsBetaaldeMaanden.add(k.maandKey)
  }
  const koppelingen: Record<string, any> = {}
  const accijnsBetaald: { maand: string, datum: string }[] = []

  const verkoopKandidaat = (fs: any[]) => fs.map((f: any) => ({id: f.id, bedrag: f.bruto||0, nummer: f.factuurnummer, naam: f.klant_naam, datum: f.datum, f}))
  const inkoopKandidaat = (fs: any[]) => fs.map((f: any) => ({id: f.id, bedrag: f.totaal_bruto||0, nummer: f.factuurnummer, naam: f.leverancier, datum: f.datum, f}))

  const transacties = (nieuw || []).map((tx: any) => {
    const key = txKey(tx)
    // Eerder opgeslagen koppeling terugzetten.
    const opgeslagen = bankKoppelingen[key]
    if (opgeslagen) {
      return {
        ...tx,
        gekoppeldFactuurId: opgeslagen.soort === 'verkoop' ? opgeslagen.factuurId : null,
        gekoppeldInkoopId: opgeslagen.soort === 'inkoop' ? opgeslagen.factuurId : null,
        gekoppeldKapitaalId: opgeslagen.soort === 'kapitaal' ? opgeslagen.factuurId : null,
        gekoppeldBtwPeriode: opgeslagen.soort === 'btw' ? opgeslagen.periodeKey : undefined,
        gekoppeldSndPeriode: opgeslagen.soort === 'snd' ? opgeslagen.periodeKey : undefined,
        gekoppeldAccijnsMaand: opgeslagen.soort === 'accijns' ? opgeslagen.maandKey : undefined,
        gekoppeldAflossingAltId: opgeslagen.soort === 'aflossing' ? opgeslagen.altRekeningId : undefined,
        gekoppeldPspFactuurIds: opgeslagen.soort === 'psp' ? opgeslagen.factuurIds : undefined,
        autoGematcht: true,
        herinneringsGematcht: true,
      }
    }
    // Terugboeking (MT940 'RC'/'RD'): nooit automatisch koppelen — een
    // storno is geen betaling van een factuur, de gebruiker beslist.
    if (tx.storno) return tx
    if (tx.type === 'C') {
      const open = besteMatchBinnenDatum(tx, verkoopKandidaat(openVerkoop), bezetVerkoop)
      if (open.kandidaat) {
        koppelingen[key] = {soort: 'verkoop', factuurId: open.kandidaat.id}
        bezetVerkoop.add(open.kandidaat.id)
        return {...tx, gekoppeldFactuurId: open.kandidaat.id, autoGematcht: true}
      }
      if (open.ambigu) return {...tx, matchAmbigu: true}
      // Terugval: zoek in betaalde facturen (retroactieve herkenning)
      const retro = besteMatchBinnenDatum(tx, verkoopKandidaat(verkoopFacturen.filter((f: any) => f.status === 'betaald')), bezetVerkoop)
      if (retro.kandidaat) {
        koppelingen[key] = {soort: 'verkoop', factuurId: retro.kandidaat.id}
        bezetVerkoop.add(retro.kandidaat.id)
        return {...tx, gekoppeldFactuurId: retro.kandidaat.id, autoGematcht: true, retroGematcht: true}
      }
      if (retro.ambigu) return {...tx, matchAmbigu: true}
      // Negatieve inkoopfactuur (creditnota): bedrag komt overeen met abs(totaal_bruto)
      const credit = besteMatchBinnenDatum(tx, inkoopFacturen
        .filter((f: any) => f.status !== 'betaald' && (f.totaal_bruto||0) < 0)
        .map((f: any) => ({id: f.id, bedrag: Math.abs(f.totaal_bruto||0), nummer: f.factuurnummer, naam: f.leverancier, datum: f.datum})), bezetInkoop)
      if (credit.kandidaat) {
        koppelingen[key] = {soort: 'inkoop', factuurId: credit.kandidaat.id}
        bezetInkoop.add(credit.kandidaat.id)
        return {...tx, gekoppeldInkoopId: credit.kandidaat.id, autoGematcht: true}
      }
      if (credit.ambigu) return {...tx, matchAmbigu: true}
      // BTW-teruggave: een ingediende aangifte met negatief bedrag wordt
      // door de Belastingdienst uitbetaald en komt dus als CREDIT binnen.
      // Dezelfde match als het voorstel (`btwAangifteMatch`).
      const teruggave = btwAangifteMatch(tx, ctx.btwAangiftes, btwBetaaldePerioden)
      if (teruggave === 'ambigu') return tx
      if (teruggave) {
        const periodeKey = String(teruggave.beste.periodeKey)
        koppelingen[key] = {soort: 'btw', periodeKey}
        btwBetaaldePerioden.add(periodeKey)
        return {...tx, gekoppeldBtwPeriode: periodeKey, autoGematcht: true}
      }
      // PSP-uitbetaling (Mollie e.d.): gebundelde betalingen minus kosten.
      // Geen automatische koppeling — wel herkennen en een combinatie van
      // facturen voorstellen; de gebruiker bevestigt in de modal. Ook al
      // betaalde facturen tellen mee: een bundel bevat bijna altijd orders die
      // al op betaald staan (kassa, handmatig vinkje, eerder gekoppelde losse
      // betaling). Facturen die in deze import al aan een andere transactie
      // hingen (bezetVerkoop) horen niet in het voorstel. De PSP heeft zijn
      // eigen tijdvak (pspKandidaten), niet de datumgrens hierboven.
      if (isPspTransactie(tx)) {
        const voorstel = zoekPspCombinatie(tx.bedrag, pspKandidaten(verkoopFacturen, {datum: tx.datum, alGekoppeld: bezetVerkoop}))
        return {...tx, pspHerkend: true, pspVoorstelIds: voorstel || undefined}
      }
    } else {
      const open = besteMatchBinnenDatum(tx, inkoopKandidaat(openInkoop), bezetInkoop)
      if (open.kandidaat) {
        koppelingen[key] = {soort: 'inkoop', factuurId: open.kandidaat.id}
        bezetInkoop.add(open.kandidaat.id)
        return {...tx, gekoppeldInkoopId: open.kandidaat.id, autoGematcht: true}
      }
      if (open.ambigu) return {...tx, matchAmbigu: true}
      // Terugval: zoek in betaalde facturen (retroactieve herkenning)
      const retro = besteMatchBinnenDatum(tx, inkoopKandidaat(inkoopFacturen.filter((f: any) => f.status === 'betaald')), bezetInkoop)
      if (retro.kandidaat) {
        koppelingen[key] = {soort: 'inkoop', factuurId: retro.kandidaat.id}
        bezetInkoop.add(retro.kandidaat.id)
        return {...tx, gekoppeldInkoopId: retro.kandidaat.id, autoGematcht: true, retroGematcht: true}
      }
      if (retro.ambigu) return {...tx, matchAmbigu: true}
      // BTW-aangifte op een ingediende periode (± € 1 voor de afronding op
      // hele euro's), met dezelfde match als het voorstel (`btwAangifteMatch`):
      // alleen een POSITIEF bedrag (te betalen) — een teruggave komt als
      // credit binnen en een nihil-aangifte kent geen betaling —, de beste
      // match, niet vóór de periode, en twee even goede = niet koppelen. Een
      // periode die in deze import al een betaling kreeg doet niet meer mee:
      // een tweede betaling valt zo op in Te koppelen.
      const aangifte = btwAangifteMatch(tx, ctx.btwAangiftes, btwBetaaldePerioden)
      if (aangifte === 'ambigu') return tx
      if (aangifte) {
        const periodeKey = String(aangifte.beste.periodeKey)
        koppelingen[key] = {soort: 'btw', periodeKey}
        btwBetaaldePerioden.add(periodeKey)
        return {...tx, gekoppeldBtwPeriode: periodeKey, autoGematcht: true}
      }
      // Accijnsaangifte: ingediende maand met bedrag (± € 1), idem.
      const accijns = accijnsAangifteMatch(tx, ctx.accijnsAangiftes, accijnsBetaaldeMaanden)
      if (accijns === 'ambigu') return tx
      if (accijns) {
        const maand = String(accijns.beste.maand)
        koppelingen[key] = {soort: 'accijns', maandKey: maand}
        accijnsBetaaldeMaanden.add(maand)
        accijnsBetaald.push({maand, datum: tx.datum})
        return {...tx, gekoppeldAccijnsMaand: maand, autoGematcht: true}
      }
    }
    return tx
  })
  return { transacties, koppelingen, accijnsBetaald }
}
