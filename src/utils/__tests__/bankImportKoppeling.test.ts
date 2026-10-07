import { describe, it, expect } from 'vitest'
import { autoKoppelImport, type AutoKoppelContext } from '../bankImportKoppeling'
import { besteMatchBinnenDatum, bankVoorstel } from '../bankVoorstel'
import { txKey } from '../bank'

// Kleine bouwers: alleen de velden die de import leest.
let volgnr = 1
const tx = (o: Record<string, any>) => ({
  id: volgnr++, datum: '2026-03-10', type: 'C', bedrag: 0, tegenpartij: '', omschrijving: '',
  referentie: `ref-${volgnr}`, ...o,
})
const vf = (o: Record<string, any>) => ({ status: 'open', datum: '2026-03-01', factuurnummer: '', klant_naam: '', bruto: 0, ...o })
const ikf = (o: Record<string, any>) => ({ status: 'open', datum: '2026-03-01', factuurnummer: '', leverancier: '', totaal_bruto: 0, ...o })
const ctx = (o: Partial<AutoKoppelContext> = {}): AutoKoppelContext =>
  ({ verkoopFacturen: [], inkoopFacturen: [], btwAangiftes: [], accijnsAangiftes: [], bankKoppelingen: {}, ...o })

describe('besteMatchBinnenDatum (ERP-plan F11)', () => {
  const t1 = { bedrag: 50, datum: '2026-03-10' }
  it('een kandidaat van meer dan 7 dagen na de transactie doet niet mee', () => {
    expect(besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50, datum: '2026-10-01' }]).kandidaat).toBeNull()
    expect(besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50, datum: '2026-03-17' }]).kandidaat?.id).toBe(1)
    expect(besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50, datum: '2026-03-18' }]).kandidaat).toBeNull()
  })
  it('ook niet voor "ambigu"', () => {
    const m = besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50, datum: '2026-02-20' }, { id: 2, bedrag: 50, datum: '2026-10-01' }])
    expect(m).toEqual({ kandidaat: expect.objectContaining({ id: 1 }), ambigu: false })
  })
  it('zonder datum geen grens; uitsluiten werkt zoals bij besteMatch', () => {
    expect(besteMatchBinnenDatum({ bedrag: 50 }, [{ id: 1, bedrag: 50, datum: '2030-01-01' }]).kandidaat?.id).toBe(1)
    expect(besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50 }]).kandidaat?.id).toBe(1)
    expect(besteMatchBinnenDatum(t1, [{ id: 1, bedrag: 50, datum: '2026-03-01' }], new Set([1])).kandidaat).toBeNull()
    expect(besteMatchBinnenDatum(t1, null)).toEqual({ kandidaat: null, ambigu: false })
  })
})

describe('autoKoppelImport: facturen met de datumgrens', () => {
  it('bijschrijving: een open verkoopfactuur van ruim na de betaling wordt niet stil gekoppeld', () => {
    const t1 = tx({ bedrag: 45 })
    const r = autoKoppelImport([t1], ctx({ verkoopFacturen: [vf({ id: 7, bruto: 45, datum: '2026-10-01' })] }))
    expect(r.transacties[0]).toBe(t1)
    expect(r.koppelingen).toEqual({})
  })
  it('bijschrijving: binnen de grens (ook tot 7 dagen vooruit) wel', () => {
    const t1 = tx({ bedrag: 45 })
    const r = autoKoppelImport([t1], ctx({ verkoopFacturen: [vf({ id: 7, bruto: 45, datum: '2026-03-17' })] }))
    expect(r.transacties[0]).toMatchObject({ gekoppeldFactuurId: 7, autoGematcht: true })
    expect(r.koppelingen[txKey(t1)]).toEqual({ soort: 'verkoop', factuurId: 7 })
  })
  it('de grens maakt van twee kandidaten er één: geen "meerdere kandidaten" meer', () => {
    const t1 = tx({ bedrag: 100 })
    const fs = [vf({ id: 1, bruto: 100, datum: '2026-03-02' }), vf({ id: 2, bruto: 100, datum: '2026-09-02' })]
    const r = autoKoppelImport([t1], ctx({ verkoopFacturen: fs }))
    expect(r.transacties[0].matchAmbigu).toBeUndefined()
    expect(r.transacties[0].gekoppeldFactuurId).toBe(1)
  })
  it('retroactief (al betaald) en de creditnota volgen dezelfde grens', () => {
    const t1 = tx({ bedrag: 30 })
    const t2 = tx({ bedrag: 12 })
    const r = autoKoppelImport([t1, t2], ctx({
      verkoopFacturen: [vf({ id: 3, bruto: 30, status: 'betaald', datum: '2026-06-01' })],
      inkoopFacturen: [ikf({ id: 4, totaal_bruto: -12, datum: '2026-06-01' })],
    }))
    expect(r.transacties.map(x => x.gekoppeldFactuurId ?? x.gekoppeldInkoopId ?? null)).toEqual([null, null])
    const r2 = autoKoppelImport([t1, t2], ctx({
      verkoopFacturen: [vf({ id: 3, bruto: 30, status: 'betaald', datum: '2026-03-01' })],
      inkoopFacturen: [ikf({ id: 4, totaal_bruto: -12, datum: '2026-03-01' })],
    }))
    expect(r2.transacties[0]).toMatchObject({ gekoppeldFactuurId: 3, retroGematcht: true })
    expect(r2.transacties[1]).toMatchObject({ gekoppeldInkoopId: 4, autoGematcht: true })
  })
  it('afschrijving: inkoopfactuur open en betaald, met de grens', () => {
    const t1 = tx({ type: 'D', bedrag: 80 })
    const t2 = tx({ type: 'D', bedrag: 60 })
    const fs = [
      ikf({ id: 10, totaal_bruto: 80, datum: '2026-12-01' }),
      ikf({ id: 11, totaal_bruto: 60, datum: '2026-03-12' }),
    ]
    const r = autoKoppelImport([t1, t2], ctx({ inkoopFacturen: fs }))
    expect(r.transacties[0]).toBe(t1)
    expect(r.transacties[1]).toMatchObject({ gekoppeldInkoopId: 11, autoGematcht: true })
    expect(Object.values(r.koppelingen)).toEqual([{ soort: 'inkoop', factuurId: 11 }])
  })
  it('import en voorstel vinden hetzelfde', () => {
    const fs = [vf({ id: 1, bruto: 100, datum: '2026-03-02' }), vf({ id: 2, bruto: 100, datum: '2026-09-02' }), vf({ id: 3, bruto: 45, datum: '2026-10-01' })]
    for (const t1 of [tx({ bedrag: 100 }), tx({ bedrag: 45 })]) {
      const imp = autoKoppelImport([t1], ctx({ verkoopFacturen: fs })).transacties[0]
      const vs = bankVoorstel(t1, { verkoopFacturen: fs, inkoopFacturen: [], btwAangiftes: [], accijnsAangiftes: [], bankKoppelingen: {} })
      expect(imp.gekoppeldFactuurId ?? null).toBe(vs?.soort === 'verkoop' ? vs.doelId : null)
    }
  })
})

describe('autoKoppelImport: de rest is ongewijzigd', () => {
  it('een opgeslagen koppeling komt terug, ook zonder datumgrens', () => {
    const t1 = tx({ bedrag: 45 })
    const r = autoKoppelImport([t1], ctx({
      verkoopFacturen: [vf({ id: 7, bruto: 45, datum: '2026-10-01' })],
      bankKoppelingen: { [txKey(t1)]: { soort: 'verkoop', factuurId: 7 } },
    }))
    expect(r.transacties[0]).toMatchObject({ gekoppeldFactuurId: 7, autoGematcht: true, herinneringsGematcht: true })
    expect(r.koppelingen).toEqual({})
  })
  it('een terugboeking wordt nooit gekoppeld', () => {
    const t1 = tx({ bedrag: 45, storno: true })
    const r = autoKoppelImport([t1], ctx({ verkoopFacturen: [vf({ id: 7, bruto: 45 })] }))
    expect(r.transacties[0]).toBe(t1)
  })
  it('gelijke score binnen de grens = ambigu; een tweede betaling pakt de bezette factuur niet', () => {
    const fs = [vf({ id: 1, bruto: 100 }), vf({ id: 2, bruto: 100 })]
    expect(autoKoppelImport([tx({ bedrag: 100 })], ctx({ verkoopFacturen: fs })).transacties[0].matchAmbigu).toBe(true)
    const een = [vf({ id: 1, bruto: 100 })]
    const r = autoKoppelImport([tx({ bedrag: 100 }), tx({ bedrag: 100 })], ctx({ verkoopFacturen: een }))
    expect(r.transacties.map(x => x.gekoppeldFactuurId ?? null)).toEqual([1, null])
  })
  it('BTW-betaling en -teruggave op bedrag (± € 1), niet als de periode al betaald is', () => {
    const betaling = tx({ type: 'D', bedrag: 420.4 })
    const teruggave = tx({ type: 'C', bedrag: 99.6 })
    const aangiftes = [{ periodeKey: '2026-Q1', bedrag: 420 }, { periodeKey: '2025-Q4', bedrag: -100 }]
    const r = autoKoppelImport([betaling, teruggave], ctx({ btwAangiftes: aangiftes }))
    expect(r.transacties[0].gekoppeldBtwPeriode).toBe('2026-Q1')
    expect(r.transacties[1].gekoppeldBtwPeriode).toBe('2025-Q4')
    const al = autoKoppelImport([betaling], ctx({ btwAangiftes: aangiftes, bankKoppelingen: { x: { soort: 'btw', periodeKey: '2026-Q1' } } }))
    expect(al.transacties[0].gekoppeldBtwPeriode).toBeUndefined()
  })
  it('accijnsmaand: koppeling plus de maand die op betaald moet', () => {
    const t1 = tx({ type: 'D', bedrag: 151, datum: '2026-03-20' })
    const r = autoKoppelImport([t1], ctx({ accijnsAangiftes: [{ maand: '2026-02', status: 'ingediend', bedrag: 150.5 }] }))
    expect(r.transacties[0].gekoppeldAccijnsMaand).toBe('2026-02')
    expect(r.koppelingen[txKey(t1)]).toEqual({ soort: 'accijns', maandKey: '2026-02' })
    expect(r.accijnsBetaald).toEqual([{ maand: '2026-02', datum: '2026-03-20' }])
  })
  it('een nihil-aangifte krijgt geen betaling: bankkosten blijven te koppelen', () => {
    const kosten = tx({ type: 'D', bedrag: 0.85, datum: '2026-07-05', tegenpartij: 'ING', omschrijving: 'Kosten betalingsverkeer' })
    const c = ctx({ btwAangiftes: [{ periodeKey: '2026-Q2', bedrag: 0 }] })
    const r = autoKoppelImport([kosten], c)
    expect(r.transacties[0]).toBe(kosten)
    expect(r.koppelingen).toEqual({})
    expect(bankVoorstel(kosten, c)?.soort).toBeNull()
  })
  it('twee betalingen naar één periode of maand in één import: alleen de eerste wordt gekoppeld', () => {
    const b1 = tx({ type: 'D', bedrag: 230, datum: '2026-10-20' })
    const b2 = tx({ type: 'D', bedrag: 229.5, datum: '2026-10-21' })
    const r = autoKoppelImport([b1, b2], ctx({ btwAangiftes: [{ periodeKey: '2026-Q3', bedrag: 230 }] }))
    expect(r.transacties.map(x => x.gekoppeldBtwPeriode ?? null)).toEqual(['2026-Q3', null])
    expect(Object.keys(r.koppelingen)).toEqual([txKey(b1)])
    const a1 = tx({ type: 'D', bedrag: 152.21, datum: '2026-10-22' })
    const a2 = tx({ type: 'D', bedrag: 152.21, datum: '2026-10-23' })
    const ra = autoKoppelImport([a1, a2], ctx({ accijnsAangiftes: [{ maand: '2026-09', status: 'ingediend', bedrag: 152.21 }] }))
    expect(ra.transacties.map(x => x.gekoppeldAccijnsMaand ?? null)).toEqual(['2026-09', null])
    expect(ra.accijnsBetaald).toEqual([{ maand: '2026-09', datum: '2026-10-22' }])
  })
  it('de aangifte die het best past wint, en niet een betaling van vóór de periode', () => {
    const b = tx({ type: 'D', bedrag: 230, datum: '2026-10-20' })
    const r = autoKoppelImport([b], ctx({ btwAangiftes: [{ periodeKey: '2026-Q2', bedrag: 229.5 }, { periodeKey: '2026-Q3', bedrag: 230 }] }))
    expect(r.transacties[0].gekoppeldBtwPeriode).toBe('2026-Q3')
    const vroeg = tx({ type: 'D', bedrag: 230, datum: '2026-06-20' })
    expect(autoKoppelImport([vroeg], ctx({ btwAangiftes: [{ periodeKey: '2026-Q3', bedrag: 230 }] })).koppelingen).toEqual({})
  })
  it('een PSP-uitbetaling wordt herkend, niet gekoppeld', () => {
    const t1 = tx({ bedrag: 97, tegenpartij: 'Stichting Mollie Payments' })
    const r = autoKoppelImport([t1], ctx())
    expect(r.transacties[0]).toMatchObject({ pspHerkend: true })
    expect(r.koppelingen).toEqual({})
  })
})
