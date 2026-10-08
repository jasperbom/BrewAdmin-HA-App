import { describe, it, expect } from 'vitest'
import {
  bankVoorstel, bankVoorstellen, bankVoorstelSleutel, binnenDatumgrens, dagPlus,
  btwPeriodeStart, accijnsMaandStart, VOORSTEL_MAX_DAGEN_VOORUIT,
  factuurKiezerKandidaten, btwKiezerKandidaten, accijnsKiezerKandidaten,
  type VoorstelContext,
} from '../bankVoorstel'
import { txKey } from '../bank'

// Kleine bouwers: alleen de velden die het voorstel leest.
let volgnr = 1
const tx = (o: Record<string, any>) => ({ id: volgnr++, datum: '2026-10-02', type: 'C', bedrag: 0, tegenpartij: '', omschrijving: '', referentie: '', ...o })
const vf = (o: Record<string, any>) => ({ status: 'open', datum: '2026-09-30', factuurnummer: '', klant_naam: '', bruto: 0, ...o })
const ikf = (o: Record<string, any>) => ({ status: 'open', datum: '2026-09-20', factuurnummer: '', leverancier: '', totaal_bruto: 0, ...o })
const ctx = (o: Partial<VoorstelContext> = {}): VoorstelContext =>
  ({ verkoopFacturen: [], inkoopFacturen: [], btwAangiftes: [], accijnsAangiftes: [], bankKoppelingen: {}, ...o })

describe('datumhulpjes', () => {
  it('dagPlus rekent over maand- en jaargrenzen, ook rond de zomertijdwissel', () => {
    expect(dagPlus('2026-10-28', 7)).toBe('2026-11-04')
    expect(dagPlus('2026-12-29', 7)).toBe('2027-01-05')
    expect(dagPlus('2026-03-27', 3)).toBe('2026-03-30')
    expect(dagPlus('2024-02-27', 2)).toBe('2024-02-29')
    expect(dagPlus('kapot', 1)).toBeNull()
  })
  it('binnenDatumgrens: tot en met 7 dagen na de transactie, zonder datum geen grens', () => {
    expect(VOORSTEL_MAX_DAGEN_VOORUIT).toBe(7)
    expect(binnenDatumgrens('2026-10-09', '2026-10-02')).toBe(true)
    expect(binnenDatumgrens('2026-10-10', '2026-10-02')).toBe(false)
    expect(binnenDatumgrens('2025-01-01', '2026-10-02')).toBe(true)
    expect(binnenDatumgrens('', '2026-10-02')).toBe(true)
    expect(binnenDatumgrens('2026-10-30', '')).toBe(true)
    expect(binnenDatumgrens('2026-10-30T10:00:00', '2026-10-02')).toBe(false)
  })
  it('begin van een BTW-periode en een accijnsmaand', () => {
    expect(btwPeriodeStart('2026-Q1')).toBe('2026-01-01')
    expect(btwPeriodeStart('2026-Q4')).toBe('2026-10-01')
    expect(btwPeriodeStart('2026-M04')).toBe('2026-04-01')
    expect(btwPeriodeStart('2026-M13')).toBeNull()
    expect(btwPeriodeStart('2026-Q5')).toBeNull()
    expect(btwPeriodeStart(undefined)).toBeNull()
    expect(accijnsMaandStart('2026-09')).toBe('2026-09-01')
    expect(accijnsMaandStart('2026-9')).toBeNull()
    expect(accijnsMaandStart('2026-00')).toBeNull()
  })
})

describe('bankVoorstel: verkoopfacturen (bijschrijving)', () => {
  const hoekstra = vf({ id: 9, factuurnummer: '2026-0079', klant_naam: 'Slijterij Hoekstra', bruto: 496.1 })

  it('bedrag + factuurnummer + naam → verkoop met de sterkste reden', () => {
    const v = bankVoorstel(tx({ bedrag: 496.1, tegenpartij: 'Slijterij Hoekstra', omschrijving: 'Factuur 2026-0079' }), ctx({ verkoopFacturen: [hoekstra] }))
    expect(v).toMatchObject({ soort: 'verkoop', doelId: 9, redenSleutel: 'bank_vs_reden_nummer_naam' })
    expect(v?.retro).toBeUndefined()
  })
  it('de reden volgt de score: nummer, naam of alleen bedrag', () => {
    const c = ctx({ verkoopFacturen: [hoekstra] })
    expect(bankVoorstel(tx({ bedrag: 496.1, omschrijving: '2026-0079' }), c)?.redenSleutel).toBe('bank_vs_reden_nummer')
    expect(bankVoorstel(tx({ bedrag: 496.1, tegenpartij: 'Slijterij Hoekstra' }), c)?.redenSleutel).toBe('bank_vs_reden_naam')
    expect(bankVoorstel(tx({ bedrag: 496.1, tegenpartij: 'Iemand' }), c)?.redenSleutel).toBe('bank_vs_reden_bedrag')
  })
  it('de naam komt uit klantNaam (live klantkaart) als die is meegegeven', () => {
    const c = ctx({ verkoopFacturen: [vf({ id: 3, bruto: 50, klant_naam: 'Oude Naam' })], klantNaam: () => 'Café De Zwaan' })
    expect(bankVoorstel(tx({ bedrag: 50, tegenpartij: 'Cafe De Zwaan BV' }), c)?.redenSleutel).toBe('bank_vs_reden_bedrag')
    expect(bankVoorstel(tx({ bedrag: 50, tegenpartij: 'Café De Zwaan' }), c)?.redenSleutel).toBe('bank_vs_reden_naam')
  })
  it('datumgrens (F11): een factuur van meer dan 7 dagen na de betaling doet niet mee', () => {
    const later = vf({ id: 20, datum: '2026-10-20', bruto: 100 })
    expect(bankVoorstel(tx({ datum: '2026-10-02', bedrag: 100 }), ctx({ verkoopFacturen: [later] }))?.soort).toBeNull()
    const vooruit = vf({ id: 21, datum: '2026-10-09', bruto: 100 })
    expect(bankVoorstel(tx({ datum: '2026-10-02', bedrag: 100 }), ctx({ verkoopFacturen: [vooruit] }))).toMatchObject({ soort: 'verkoop', doelId: 21 })
  })
  it('de datumgrens maakt van twee kandidaten er één (geen ambigu meer)', () => {
    const c = ctx({ verkoopFacturen: [vf({ id: 1, datum: '2026-09-01', bruto: 80 }), vf({ id: 2, datum: '2026-12-01', bruto: 80 })] })
    expect(bankVoorstel(tx({ datum: '2026-10-02', bedrag: 80 }), c)).toMatchObject({ soort: 'verkoop', doelId: 1 })
  })
  it('twee facturen met hetzelfde bedrag en dezelfde score → geen voorstel, reden meerdere kandidaten', () => {
    const c = ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80 }), vf({ id: 2, bruto: 80 })] })
    expect(bankVoorstel(tx({ bedrag: 80 }), c)).toMatchObject({ soort: null, ambigu: true, redenSleutel: 'bank_vs_reden_ambigu' })
  })
  it('een factuur die al aan een andere transactie hangt doet niet mee', () => {
    const c = ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80 }), vf({ id: 2, bruto: 80 })], bankKoppelingen: { ander: { soort: 'verkoop', factuurId: 1 } } })
    expect(bankVoorstel(tx({ bedrag: 80 }), c)).toMatchObject({ soort: 'verkoop', doelId: 2 })
    const psp = ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80 })], bankKoppelingen: { m: { soort: 'psp', factuurIds: [1] } } })
    expect(bankVoorstel(tx({ bedrag: 80 }), psp)?.soort).toBeNull()
  })
  it('creditnota (status credit) is geen open verkoopfactuur', () => {
    expect(bankVoorstel(tx({ bedrag: 80 }), ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80, status: 'credit' })] }))?.soort).toBeNull()
  })
  it('zonder open factuur: een al betaalde factuur zonder bankkoppeling (retro)', () => {
    const v = bankVoorstel(tx({ bedrag: 240 }), ctx({ verkoopFacturen: [vf({ id: 3, bruto: 240, status: 'betaald' })] }))
    expect(v).toMatchObject({ soort: 'verkoop', doelId: 3, retro: true })
  })
  it('een open factuur gaat voor een betaalde', () => {
    const c = ctx({ verkoopFacturen: [vf({ id: 3, bruto: 240, status: 'betaald' }), vf({ id: 4, bruto: 240 })] })
    expect(bankVoorstel(tx({ bedrag: 240 }), c)).toMatchObject({ soort: 'verkoop', doelId: 4 })
  })
  it('ambigu bij de open facturen stopt: geen terugval op betaalde of aangiftes', () => {
    const c = ctx({
      verkoopFacturen: [vf({ id: 1, bruto: 80 }), vf({ id: 2, bruto: 80 }), vf({ id: 3, bruto: 80, status: 'betaald' })],
      btwAangiftes: [{ periodeKey: '2026-Q2', bedrag: -80 }],
    })
    expect(bankVoorstel(tx({ bedrag: 80 }), c)?.ambigu).toBe(true)
  })
  it('een gekoppelde transactie krijgt geen voorstel (null)', () => {
    expect(bankVoorstel(tx({ bedrag: 496.1, gekoppeldFactuurId: 9 }), ctx({ verkoopFacturen: [hoekstra] }))).toBeNull()
    expect(bankVoorstel(tx({ bedrag: 5, gekoppeldBtwPeriode: '2026-Q2' }), ctx())).toBeNull()
  })
  it('storno → nooit een voorstel', () => {
    const v = bankVoorstel(tx({ bedrag: 496.1, storno: true, omschrijving: '2026-0079' }), ctx({ verkoopFacturen: [hoekstra] }))
    expect(v).toMatchObject({ soort: null, redenSleutel: 'bank_vs_reden_storno' })
  })
})

describe('bankVoorstel: inkoopfacturen (afschrijving) en creditnota', () => {
  it('open inkoopfactuur op bedrag en kenmerk', () => {
    const c = ctx({ inkoopFacturen: [ikf({ id: 7, factuurnummer: 'FE-1209', leverancier: 'Fermentis', totaal_bruto: 158.05 })] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-09-25', bedrag: 158.05, tegenpartij: 'Fermentis', omschrijving: 'Factuur FE-1209' }), c))
      .toMatchObject({ soort: 'inkoop', doelId: 7, redenSleutel: 'bank_vs_reden_nummer_naam' })
  })
  it('datumgrens geldt ook voor inkoop', () => {
    const c = ctx({ inkoopFacturen: [ikf({ id: 7, datum: '2026-10-15', totaal_bruto: 50 })] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-02', bedrag: 50 }), c)?.soort).toBeNull()
  })
  it('betaalde inkoopfactuur zonder koppeling → retro', () => {
    const c = ctx({ inkoopFacturen: [ikf({ id: 4, totaal_bruto: 257, status: 'betaald' })] })
    expect(bankVoorstel(tx({ type: 'D', bedrag: 257 }), c)).toMatchObject({ soort: 'inkoop', doelId: 4, retro: true })
  })
  it('een bijschrijving past op een open creditnota (negatief totaal)', () => {
    const c = ctx({ inkoopFacturen: [ikf({ id: 12, totaal_bruto: -42.5, leverancier: 'Brouwland' })] })
    expect(bankVoorstel(tx({ type: 'C', bedrag: 42.5, tegenpartij: 'Brouwland' }), c)).toMatchObject({ soort: 'inkoop', doelId: 12 })
    // Een creditnota is nooit de tegenhanger van een afschrijving.
    expect(bankVoorstel(tx({ type: 'D', bedrag: 42.5 }), c)?.soort).toBeNull()
  })
  it('een verkoopfactuur past nooit op een afschrijving', () => {
    expect(bankVoorstel(tx({ type: 'D', bedrag: 80 }), ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80 })] }))?.soort).toBeNull()
  })
})

describe('bankVoorstel: BTW-aangiftes', () => {
  const q2 = { periodeKey: '2026-Q2', bedrag: 230 }
  it('afschrijving binnen € 1 van een ingediende aangifte → btw, met het verschil', () => {
    const v = bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 229.69, tegenpartij: 'Belastingdienst' }), ctx({ btwAangiftes: [q2] }))
    expect(v).toMatchObject({ soort: 'btw', periodeKey: '2026-Q2', redenSleutel: 'bank_vs_reden_aangifte_bijna', verschilCent: 31 })
  })
  it('exact bedrag → de reden zonder verschil', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 230 }), ctx({ btwAangiftes: [q2] })))
      .toMatchObject({ soort: 'btw', redenSleutel: 'bank_vs_reden_aangifte', verschilCent: 0 })
  })
  it('meer dan € 1 verschil → geen voorstel', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 228.99 }), ctx({ btwAangiftes: [q2] }))?.soort).toBeNull()
  })
  it('teken: een teruggave (negatief) past alleen op een bijschrijving', () => {
    const teruggave = { periodeKey: '2026-Q1', bedrag: -120 }
    expect(bankVoorstel(tx({ type: 'C', datum: '2026-05-10', bedrag: 120 }), ctx({ btwAangiftes: [teruggave] })))
      .toMatchObject({ soort: 'btw', periodeKey: '2026-Q1', redenSleutel: 'bank_vs_reden_teruggave' })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-05-10', bedrag: 120 }), ctx({ btwAangiftes: [teruggave] }))?.soort).toBeNull()
    expect(bankVoorstel(tx({ type: 'C', datum: '2026-07-28', bedrag: 230 }), ctx({ btwAangiftes: [q2] }))?.soort).toBeNull()
  })
  it('een al betaalde periode (bankkoppeling) doet niet mee', () => {
    const c = ctx({ btwAangiftes: [q2], bankKoppelingen: { x: { soort: 'btw', periodeKey: '2026-Q2' } } })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 230 }), c)?.soort).toBeNull()
  })
  it('een transactie van vóór de periode is geen betaling ervan', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-03-30', bedrag: 230 }), ctx({ btwAangiftes: [q2] }))?.soort).toBeNull()
  })
  it('een aangifte van nul kent geen betaling', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 0.4 }), ctx({ btwAangiftes: [{ periodeKey: '2026-Q2', bedrag: 0 }] }))?.soort).toBeNull()
  })
  it('de dichtstbijzijnde aangifte wint; even dichtbij = ambigu', () => {
    const c = ctx({ btwAangiftes: [{ periodeKey: '2026-Q1', bedrag: 230 }, { periodeKey: '2026-Q2', bedrag: 229 }] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 229.2 }), c)).toMatchObject({ periodeKey: '2026-Q2' })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 229.5 }), c)).toMatchObject({ soort: null, ambigu: true })
  })
  it('een factuurmatch gaat voor de aangifte (volgorde van de import)', () => {
    const c = ctx({ btwAangiftes: [q2], inkoopFacturen: [ikf({ id: 1, totaal_bruto: 230, datum: '2026-07-01' })] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-28', bedrag: 230 }), c)).toMatchObject({ soort: 'inkoop', doelId: 1 })
  })
  it('maandaangifte: de periode begint op de eerste van de maand', () => {
    const c = ctx({ btwAangiftes: [{ periodeKey: '2026-M08', bedrag: 75 }] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-09-20', bedrag: 75 }), c)).toMatchObject({ soort: 'btw', periodeKey: '2026-M08' })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-07-31', bedrag: 75 }), c)?.soort).toBeNull()
  })
  it('Belastingdienst zonder passende aangifte → eigen reden', () => {
    expect(bankVoorstel(tx({ type: 'D', bedrag: 229.69, tegenpartij: 'Belastingdienst' }), ctx()))
      .toMatchObject({ soort: null, redenSleutel: 'bank_vs_reden_belastingdienst' })
  })
})

describe('bankVoorstel: accijns', () => {
  const sept = { maand: '2026-09', status: 'ingediend', bedrag: 312.4 }
  it('ingediende maand op € 1 na → accijns', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312.4 }), ctx({ accijnsAangiftes: [sept] })))
      .toMatchObject({ soort: 'accijns', maand: '2026-09', redenSleutel: 'bank_vs_reden_accijns', verschilCent: 0 })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312 }), ctx({ accijnsAangiftes: [sept] })))
      .toMatchObject({ soort: 'accijns', redenSleutel: 'bank_vs_reden_accijns_bijna', verschilCent: 40 })
  })
  it('alleen ingediend en nog niet gekoppeld; nooit op een bijschrijving', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312.4 }), ctx({ accijnsAangiftes: [{ ...sept, status: 'berekend' }] }))?.soort).toBeNull()
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312.4 }), ctx({ accijnsAangiftes: [{ ...sept, status: 'betaald' }] }))?.soort).toBeNull()
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312.4 }),
      ctx({ accijnsAangiftes: [sept], bankKoppelingen: { a: { soort: 'accijns', maandKey: '2026-09' } } }))?.soort).toBeNull()
    expect(bankVoorstel(tx({ type: 'C', datum: '2026-10-15', bedrag: 312.4 }), ctx({ accijnsAangiftes: [sept] }))?.soort).toBeNull()
  })
  it('een transactie van vóór de maand is geen betaling ervan', () => {
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-08-30', bedrag: 312.4 }), ctx({ accijnsAangiftes: [sept] }))?.soort).toBeNull()
  })
  it('BTW gaat voor accijns (volgorde van de import)', () => {
    const c = ctx({ accijnsAangiftes: [sept], btwAangiftes: [{ periodeKey: '2026-Q3', bedrag: 312 }] })
    expect(bankVoorstel(tx({ type: 'D', datum: '2026-10-15', bedrag: 312.4 }), c)?.soort).toBe('btw')
  })
})

describe('bankVoorstel: PSP-uitbetaling', () => {
  const webshop = [
    vf({ id: 31, datum: '2026-09-26', bruto: 60.5 }),
    vf({ id: 32, datum: '2026-09-27', bruto: 80.0, status: 'betaald' }),
    vf({ id: 33, datum: '2026-09-28', bruto: 75.06 }),
  ]
  it('herkende uitbetaling met een passende combinatie → psp met kosten', () => {
    const v = bankVoorstel(tx({ datum: '2026-09-30', bedrag: 212.4, tegenpartij: 'Stichting Mollie Payments' }), ctx({ verkoopFacturen: webshop }))
    expect(v?.soort).toBe('psp')
    expect([...(v?.factuurIds || [])].sort()).toEqual([31, 32, 33])
    expect(v?.kostenCent).toBe(316)
    expect(v?.vars).toEqual({ n: 3 })
  })
  it('zonder combinatie: reden "geen combinatie"', () => {
    expect(bankVoorstel(tx({ datum: '2026-09-30', bedrag: 999, tegenpartij: 'Mollie' }), ctx({ verkoopFacturen: webshop })))
      .toMatchObject({ soort: null, redenSleutel: 'bank_vs_reden_psp_geen' })
  })
  it('facturen die al elders gekoppeld zijn vallen uit de bundel', () => {
    const c = ctx({ verkoopFacturen: webshop, bankKoppelingen: { k: { soort: 'verkoop', factuurId: 32 } } })
    const v = bankVoorstel(tx({ datum: '2026-09-30', bedrag: 133, tegenpartij: 'Mollie' }), c)
    expect(v?.factuurIds || []).not.toContain(32)
  })
  it('een losse factuur met precies dat bedrag gaat voor de bundel', () => {
    const v = bankVoorstel(tx({ datum: '2026-09-30', bedrag: 60.5, tegenpartij: 'Mollie' }), ctx({ verkoopFacturen: webshop }))
    expect(v).toMatchObject({ soort: 'verkoop', doelId: 31 })
  })
})

describe('bankVoorstellen: één factuur, één betaling', () => {
  it('twee transacties naar dezelfde factuur: de beste match houdt hem', () => {
    const a = tx({ bedrag: 80, omschrijving: 'Factuur 2026-0100' })
    const b = tx({ bedrag: 80 })
    const r = bankVoorstellen([a, b], ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80, factuurnummer: '2026-0100' })] }))
    expect(r.get(bankVoorstelSleutel(a))).toMatchObject({ soort: 'verkoop', doelId: 1 })
    expect(r.get(bankVoorstelSleutel(b))).toMatchObject({ soort: null, ambigu: true, redenSleutel: 'bank_vs_reden_dubbel' })
  })
  it('even goed: geen van beide krijgt het voorstel', () => {
    const a = tx({ bedrag: 80 })
    const b = tx({ bedrag: 80 })
    const r = bankVoorstellen([a, b], ctx({ verkoopFacturen: [vf({ id: 1, bruto: 80 })] }))
    expect(r.get(bankVoorstelSleutel(a))?.soort).toBeNull()
    expect(r.get(bankVoorstelSleutel(b))?.soort).toBeNull()
  })
  it('ook een BTW-periode krijgt maar één betaling; het kleinste verschil wint', () => {
    const a = tx({ type: 'D', datum: '2026-07-28', bedrag: 229.69 })
    const b = tx({ type: 'D', datum: '2026-07-29', bedrag: 230 })
    const r = bankVoorstellen([a, b], ctx({ btwAangiftes: [{ periodeKey: '2026-Q2', bedrag: 230 }] }))
    expect(r.get(bankVoorstelSleutel(b))).toMatchObject({ soort: 'btw' })
    expect(r.get(bankVoorstelSleutel(a))?.redenSleutel).toBe('bank_vs_reden_dubbel')
  })
  it('gekoppelde transacties staan er niet in; zonder id valt hij terug op txKey', () => {
    const gekoppeld = tx({ bedrag: 5, gekoppeldKapitaalId: 1 })
    const zonderId = { datum: '2026-10-02', type: 'C', bedrag: 7, tegenpartij: 'X' }
    const r = bankVoorstellen([gekoppeld, zonderId], ctx())
    expect(r.has(bankVoorstelSleutel(gekoppeld))).toBe(false)
    expect(bankVoorstelSleutel(zonderId)).toBe(`key:${txKey(zonderId)}`)
    expect(r.get(bankVoorstelSleutel(zonderId))).toMatchObject({ soort: null, redenSleutel: 'bank_vs_reden_geen' })
  })
  it('kapotte invoer breekt niets', () => {
    expect(bankVoorstellen(null, ctx()).size).toBe(0)
    expect(bankVoorstellen([null, 3, 'x'] as any, {}).size).toBe(0)
    expect(bankVoorstel(null, {})).toBeNull()
    expect(bankVoorstel(tx({ bedrag: 10 }), { verkoopFacturen: [null, vf({ id: 1, bruto: 10 })] as any })).toMatchObject({ soort: 'verkoop' })
  })
})

describe('factuurKiezerKandidaten', () => {
  const facturen = [
    vf({ id: 1, datum: '2026-08-01', bruto: 100, factuurnummer: '2026-0050', klant_naam: 'Café De Zwaan' }),
    vf({ id: 2, datum: '2026-09-01', bruto: 80, factuurnummer: '2026-0060', klant_naam: 'Slijterij Hoekstra' }),
    vf({ id: 3, datum: '2026-09-15', bruto: 100, status: 'betaald', klant_naam: 'Restaurant Het Veer' }),
    vf({ id: 4, datum: '2026-09-20', bruto: -30, status: 'credit' }),
    vf({ id: 5, datum: '2026-09-21', bruto: 55 }),
  ]
  const t1 = tx({ bedrag: 100 })
  it('open facturen, bedrag klopt eerst, dan nieuwste eerst', () => {
    const r = factuurKiezerKandidaten(t1, 'verkoop', facturen)
    expect(r.map(x => x.id)).toEqual([1, 5, 2])
    expect(r[0]).toMatchObject({ klopt: true, betaald: false, bedragCent: 10000, naam: 'Café De Zwaan' })
  })
  it('ook betaalde facturen op verzoek; creditnota\'s nooit bij verkoop', () => {
    expect(factuurKiezerKandidaten(t1, 'verkoop', facturen, { ookBetaald: true }).map(x => x.id)).toEqual([3, 1, 5, 2])
  })
  it('al elders gekoppeld: open blijft kiesbaar (deelbetaling) maar achteraan en gemarkeerd; de eigen koppeling telt niet als elders', () => {
    const eigen = tx({ bedrag: 100 })
    const koppelingen = { anders: { soort: 'verkoop', factuurId: 1 }, [txKey(eigen)]: { soort: 'verkoop', factuurId: 5 } }
    const r = factuurKiezerKandidaten(eigen, 'verkoop', facturen, { bankKoppelingen: koppelingen })
    // Factuur 1 klopt qua bedrag, maar hangt al aan "anders": na de vrije facturen.
    expect(r.map(x => x.id)).toEqual([5, 2, 1])
    expect(r.find(x => x.id === 1)).toMatchObject({ elders: true, klopt: true })
    expect(r.find(x => x.id === 5)?.elders).toBe(false)
  })
  it('een betaalde factuur die al elders hangt doet nooit mee, ook niet met "ook betaalde"', () => {
    const koppelingen = { anders: { soort: 'verkoop', factuurId: 3 } }
    expect(factuurKiezerKandidaten(t1, 'verkoop', facturen, { ookBetaald: true, bankKoppelingen: koppelingen }).map(x => x.id)).toEqual([1, 5, 2])
  })
  it('PSP-bundel en PSP-kostenpost tellen als elders gekoppeld', () => {
    const koppelingen = { psp: { soort: 'psp', factuurIds: [2], kostenFactuurId: 9 } }
    const r = factuurKiezerKandidaten(t1, 'verkoop', facturen, { bankKoppelingen: koppelingen })
    expect(r.map(x => x.id)).toEqual([1, 5, 2])
    expect(r[2].elders).toBe(true)
  })
  it('zoeken op nummer, naam en bedrag', () => {
    expect(factuurKiezerKandidaten(t1, 'verkoop', facturen, { zoek: 'hoekstra' }).map(x => x.id)).toEqual([2])
    expect(factuurKiezerKandidaten(t1, 'verkoop', facturen, { zoek: '2026-0050' }).map(x => x.id)).toEqual([1])
    expect(factuurKiezerKandidaten(t1, 'verkoop', facturen, { zoek: '55' }).map(x => x.id)).toEqual([5])
  })
  it('inkoop: positieve facturen; creditnota: negatieve, bedrag zonder teken', () => {
    const ink = [ikf({ id: 1, totaal_bruto: 158.05, leverancier: 'Fermentis' }), ikf({ id: 2, totaal_bruto: -42.5 }), ikf({ id: 3, totaal_bruto: 20, status: 'betaald' })]
    expect(factuurKiezerKandidaten(tx({ type: 'D', bedrag: 158.05 }), 'inkoop', ink).map(x => x.id)).toEqual([1])
    const credit = factuurKiezerKandidaten(tx({ bedrag: 42.5 }), 'creditnota', ink)
    expect(credit.map(x => x.id)).toEqual([2])
    expect(credit[0]).toMatchObject({ bedragCent: 4250, klopt: true })
  })
  it('klantNaam (live) gaat voor de snapshot', () => {
    expect(factuurKiezerKandidaten(t1, 'verkoop', [facturen[0]], { klantNaam: () => 'Nieuwe Naam' })[0].naam).toBe('Nieuwe Naam')
  })
})

describe('btwKiezerKandidaten / accijnsKiezerKandidaten', () => {
  const aangiftes = [
    { periodeKey: '2026-Q1', bedrag: -120 },
    { periodeKey: '2026-Q2', bedrag: 230 },
    { periodeKey: '2026-Q3', bedrag: 410 },
  ]
  it('afschrijving: alleen te betalen aangiftes, dichtstbij eerst; betaalde vallen af', () => {
    expect(btwKiezerKandidaten(tx({ type: 'D', bedrag: 400 }), aangiftes).map(a => a.sleutel)).toEqual(['2026-Q3', '2026-Q2'])
    expect(btwKiezerKandidaten(tx({ type: 'D', bedrag: 400 }), aangiftes, { x: { soort: 'btw', periodeKey: '2026-Q3' } }).map(a => a.sleutel)).toEqual(['2026-Q2'])
  })
  it('bijschrijving: alleen teruggaves, met het verschil in centen', () => {
    const r = btwKiezerKandidaten(tx({ type: 'C', bedrag: 119.5 }), aangiftes)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ sleutel: '2026-Q1', bedragCent: 12000, verschilCent: 50 })
  })
  it('accijns: ingediend of betaald zonder bankkoppeling, nooit bij een bijschrijving', () => {
    const acc = [
      { maand: '2026-07', status: 'betaald', bedrag: 100 },
      { maand: '2026-08', status: 'ingediend', bedrag: 300 },
      { maand: '2026-09', status: 'berekend', bedrag: 310 },
      { maand: '2026-06', status: 'ingediend', bedrag: 290 },
    ]
    const k = { x: { soort: 'accijns', maandKey: '2026-06' } }
    expect(accijnsKiezerKandidaten(tx({ type: 'D', bedrag: 305 }), acc, k).map(a => a.sleutel)).toEqual(['2026-08', '2026-07'])
    expect(accijnsKiezerKandidaten(tx({ type: 'C', bedrag: 300 }), acc)).toEqual([])
  })
})
