// Bewaarde bankafschriften (`bank_transacties` / `bank_afschriften`): samenvoegen
// bij opnieuw importeren, koppelingsvlaggen afleiden uit `bank_koppelingen`,
// saldo-aansluiting per afschrift en een verkeerd afschrift weer weghalen.
import { describe, it, expect } from 'vitest'
import {
  parseMT940, txKey, herstelKoppelingVlaggen, vlaggenVoorKoppeling, bouwBankImport,
  transactiesVanAfschrift, vorigEindsaldoVoor, verwijderAfschrift, bankSaldiNaVerwijderen,
  sorteerAfschriften, laatsteAfschrift, saldoControle, KOPPEL_VLAGGEN,
} from '../bank'

const AFSCHRIFT = [
  ':20:DEKADE2026-10',
  ':25:NL12INGB0001234567',
  ':28C:00042',
  ':60F:C260923EUR3200,00',
  ':61:2609240924C1000,00NTRFNONREF//STORT01',
  ':86:/NAME/J. van der Kade/REMI/Storting',
  ':61:2609250925D158,05NTRFNONREF//FE1209',
  ':86:/NAME/Fermentis/REMI/Factuur FE-1209',
  ':61:2609280928D229,69NTRFNONREF//BTWQ2',
  ':86:/NAME/Belastingdienst/REMI/Omzetbelasting 2e kwartaal',
  ':62F:C260928EUR3812,26',
  '-',
].join('\n')

// Teller als id-bron: voorspelbaar in de test, uniek zoals newId.
const teller = (start = 100) => { let n = start; return () => n++ }
const NU = '2026-10-07T09:00:00.000Z'

describe('parseMT940 — saldodatums', () => {
  it('leest de datum van begin- en eindsaldo mee', () => {
    const p = parseMT940(AFSCHRIFT)
    expect(p.begindatum).toBe('2026-09-23')
    expect(p.einddatum).toBe('2026-09-28')
  })
})

describe('bouwBankImport', () => {
  it('maakt een afschrift met alle transacties, elk met id, afschrift en rekening', () => {
    const r = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    expect(r.alBekend).toBe(false)
    expect(r.dubbel).toBe(0)
    expect(r.afschrift).toMatchObject({
      id: 100, iban: 'NL12INGB0001234567', afschriftNr: '00042', referentie: 'DEKADE2026-10',
      beginsaldo: 3200, eindsaldo: 3812.26, van: '2026-09-24', tot: '2026-09-28',
      geimporteerd_op: NU, aantal: 3, nieuw: 3, overgeslagen: 0, vorig_eindsaldo: null,
    })
    expect(r.nieuw.map(t => t.id)).toEqual([101, 102, 103])
    expect(r.nieuw.every(t => t.afschrift_id === 100 && t.iban === 'NL12INGB0001234567')).toBe(true)
    expect(r.afschrift.transactie_ids).toEqual([101, 102, 103])
    // de velden van de parser blijven precies zoals ze waren (dus ook dezelfde txKey)
    expect(r.nieuw.map(txKey)).toEqual(parseMT940(AFSCHRIFT).transacties.map(txKey))
  })

  it('hetzelfde bestand nog eens: niets nieuws en geen tweede afschrift', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const tweede = bouwBankImport(parseMT940(AFSCHRIFT), eerste.nieuw, [eerste.afschrift], {maakId: teller(500), nu: NU})
    expect(tweede.alBekend).toBe(true)
    expect(tweede.nieuw).toEqual([])
    expect(tweede.dubbel).toBe(3)
    expect(tweede.afschrift).toBe(eerste.afschrift)
  })

  it('een overlappend afschrift voegt alleen het nieuwe toe, maar onthoudt alles wat erin stond', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    // De bestaande transactie draagt al een koppeling: die mag niet overschreven worden.
    const bestaand = eerste.nieuw.map(t => t.id === 103 ? {...t, gekoppeldBtwPeriode: '2026-Q2'} : t)
    const overlap = parseMT940([
      ':20:DEKADE2026-10B', ':25:NL12INGB0001234567', ':28C:00043', ':60F:C260927EUR3042,26',
      ':61:2609280928D229,69NTRFNONREF//BTWQ2', ':86:/NAME/Belastingdienst/REMI/Omzetbelasting 2e kwartaal',
      ':61:2610021002C496,10NTRFNONREF//HOEK79', ':86:/NAME/Slijterij Hoekstra/REMI/Factuur 2026-0079',
      ':62F:C261002EUR3308,67',
    ].join('\n'))
    const r = bouwBankImport(overlap, bestaand, [eerste.afschrift], {maakId: teller(200), nu: NU})
    expect(r.alBekend).toBe(false)
    expect(r.dubbel).toBe(1)
    expect(r.nieuw).toHaveLength(1)
    expect(r.nieuw[0]).toMatchObject({id: 201, afschrift_id: 200, bedrag: 496.1})
    expect(r.afschrift.transactie_ids).toEqual([103, 201])
    expect(r.afschrift.nieuw).toBe(1)
    expect(r.afschrift.aantal).toBe(2)
  })

  it('twee echte, gelijke boekingen in één bestand blijven er twee', () => {
    const tekst = [
      ':25:NL12INGB0001234567', ':28C:7', ':60F:C260901EUR0,00',
      ':61:2609010901D5,00NTRFNONREF', ':86:/NAME/Koffiebar/REMI/Koffie',
      ':61:2609010901D5,00NTRFNONREF', ':86:/NAME/Koffiebar/REMI/Koffie',
      ':62F:D260901EUR10,00',
    ].join('\n')
    const eerste = bouwBankImport(parseMT940(tekst), [], [], {maakId: teller(), nu: NU})
    expect(eerste.nieuw).toHaveLength(2)
    // ... en het bestand opnieuw geeft er niet nog eens twee bij
    const tweede = bouwBankImport(parseMT940(tekst), eerste.nieuw, [{...eerste.afschrift, afschriftNr: 'anders'}], {maakId: teller(300), nu: NU})
    expect(tweede.nieuw).toHaveLength(0)
    expect(tweede.dubbel).toBe(2)
  })

  it('kijkt per rekening: dezelfde boeking op een andere rekening is nieuw', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const andereRekening = parseMT940(AFSCHRIFT.replace('NL12INGB0001234567', 'NL99RABO0123456789'))
    const r = bouwBankImport(andereRekening, eerste.nieuw, [eerste.afschrift], {maakId: teller(400), nu: NU})
    expect(r.nieuw).toHaveLength(3)
    expect(r.alBekend).toBe(false)
  })

  it('neemt het banksaldo van vóór het bewaren als vorig eindsaldo, maar alleen als het eerder ligt', () => {
    const saldi = {NL12INGB0001234567: {iban: 'NL12INGB0001234567', eindsaldo: 3200, datum: '2026-09-20', afschrift_nr: '00041'}}
    const r = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU, bankSaldi: saldi})
    expect(r.afschrift.vorig_eindsaldo).toBe(3200)
    // een nieuwer saldo is geen "vorig" saldo
    const later = {NL12INGB0001234567: {...saldi.NL12INGB0001234567, datum: '2026-09-30'}}
    expect(bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU, bankSaldi: later}).afschrift.vorig_eindsaldo).toBeNull()
    // het saldo dat van dit zelfde afschrift kwam (vóór het bewaren ingelezen) ook niet
    const zelf = {NL12INGB0001234567: {eindsaldo: 3812.26, datum: '2026-09-28', afschrift_nr: '00042'}}
    expect(bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU, bankSaldi: zelf}).afschrift.vorig_eindsaldo).toBeNull()
    // zodra er voor de rekening een afschrift bewaard is, rekent de aansluiting met de afschriften zelf
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const ander = parseMT940(AFSCHRIFT.replace(':28C:00042', ':28C:00041').replace(/2609(2\d)09\d\d/g, '2608$108$1'))
    expect(bouwBankImport(ander, eerste.nieuw, [eerste.afschrift], {maakId: teller(600), nu: NU, bankSaldi: saldi}).afschrift.vorig_eindsaldo).toBeNull()
  })

  it('een leeg afschrift krijgt de saldodatums als periode', () => {
    const leeg = parseMT940(':25:NL12INGB0001234567\n:28C:9\n:60F:C261001EUR10,00\n:62F:C261003EUR10,00')
    const r = bouwBankImport(leeg, [], [], {maakId: teller(), nu: NU})
    expect(r.afschrift).toMatchObject({van: '2026-10-01', tot: '2026-10-03', aantal: 0, transactie_ids: []})
  })
})

describe('herstelKoppelingVlaggen', () => {
  const tx = (extra: any = {}) => ({id: 1, datum: '2026-09-28', type: 'D', bedrag: 229.69, referentie: 'BTWQ2', ...extra})

  it('zet de vlaggen uit bank_koppelingen, zoals de import dat deed', () => {
    const [uit] = herstelKoppelingVlaggen([tx()], {[txKey(tx())]: {soort: 'btw', periodeKey: '2026-Q2'}})
    expect(uit.gekoppeldBtwPeriode).toBe('2026-Q2')
    expect(uit.gekoppeldFactuurId).toBeNull()
    expect(uit.gekoppeldInkoopId).toBeNull()
  })

  it('kent elke soort koppeling', () => {
    expect(vlaggenVoorKoppeling({soort: 'verkoop', factuurId: 4}).gekoppeldFactuurId).toBe(4)
    expect(vlaggenVoorKoppeling({soort: 'inkoop', factuurId: 5}).gekoppeldInkoopId).toBe(5)
    expect(vlaggenVoorKoppeling({soort: 'kapitaal', factuurId: 6}).gekoppeldKapitaalId).toBe(6)
    expect(vlaggenVoorKoppeling({soort: 'snd', periodeKey: '2026-Q3'}).gekoppeldSndPeriode).toBe('2026-Q3')
    expect(vlaggenVoorKoppeling({soort: 'accijns', maandKey: '2026-09'}).gekoppeldAccijnsMaand).toBe('2026-09')
    expect(vlaggenVoorKoppeling({soort: 'aflossing', altRekeningId: 2}).gekoppeldAflossingAltId).toBe(2)
    expect(vlaggenVoorKoppeling({soort: 'psp', factuurIds: [1, 2]}).gekoppeldPspFactuurIds).toEqual([1, 2])
    const leeg = vlaggenVoorKoppeling(null)
    expect(KOPPEL_VLAGGEN.every(v => leeg[v] == null)).toBe(true)
  })

  it('wist een vlag waarvan de koppeling weg is, met de markering van de automatische koppeling', () => {
    const oud = tx({gekoppeldBtwPeriode: '2026-Q2', autoGematcht: true, herinneringsGematcht: true})
    const [uit] = herstelKoppelingVlaggen([oud], {})
    expect(uit.gekoppeldBtwPeriode).toBeUndefined()
    expect(uit.autoGematcht).toBe(false)
    expect(uit.herinneringsGematcht).toBe(false)
  })

  it('corrigeert een vlag van de verkeerde soort', () => {
    const oud = tx({gekoppeldInkoopId: 9})
    const [uit] = herstelKoppelingVlaggen([oud], {[txKey(oud)]: {soort: 'accijns', maandKey: '2026-08'}})
    expect(uit.gekoppeldInkoopId).toBeNull()
    expect(uit.gekoppeldAccijnsMaand).toBe('2026-08')
  })

  it('laat een transactie die al klopt ongemoeid (zelfde object)', () => {
    const goed = tx({gekoppeldFactuurId: null, gekoppeldInkoopId: 7, autoGematcht: true})
    const kop = {[txKey(goed)]: {soort: 'inkoop', factuurId: 7}}
    expect(herstelKoppelingVlaggen([goed], kop)[0]).toBe(goed)
    const los = tx()
    expect(herstelKoppelingVlaggen([los], {})[0]).toBe(los)
  })

  it('verdraagt een lege of kapotte invoer', () => {
    expect(herstelKoppelingVlaggen(null, null)).toEqual([])
    expect(herstelKoppelingVlaggen([tx()], null)[0].gekoppeldBtwPeriode).toBeUndefined()
  })
})

describe('saldo-aansluiting per afschrift', () => {
  const af = (id: number, van: string, tot: string, eindsaldo: number, extra: any = {}) =>
    ({id, iban: 'NL12INGB0001234567', van, tot, eindsaldo, beginsaldo: 0, geimporteerd_op: NU, ...extra})

  it('sluit aan op het vorige afschrift van dezelfde rekening, ook als dat later is ingelezen', () => {
    const okt = af(2, '2026-10-01', '2026-10-31', 500)
    const sep = af(3, '2026-09-01', '2026-09-30', 400)   // pas na oktober ingelezen
    const aug = af(1, '2026-08-01', '2026-08-31', 300)
    const ander = af(4, '2026-09-01', '2026-09-30', 999, {iban: 'NL99RABO0123456789'})
    expect(vorigEindsaldoVoor(okt, [okt, sep, aug, ander])).toEqual({saldo: 400, bron: 'afschrift'})
    expect(vorigEindsaldoVoor(sep, [okt, sep, aug, ander])).toEqual({saldo: 300, bron: 'afschrift'})
    expect(vorigEindsaldoVoor(aug, [okt, sep, aug, ander])).toEqual({saldo: null, bron: 'geen'})
    // tussenliggend afschrift weg → oktober sluit (terecht) niet meer aan op september
    expect(vorigEindsaldoVoor(okt, [okt, aug])).toEqual({saldo: 300, bron: 'afschrift'})
  })

  it('valt terug op het banksaldo van vóór het bewaren', () => {
    expect(vorigEindsaldoVoor(af(1, '2026-10-01', '2026-10-31', 5, {vorig_eindsaldo: 12.5}), [])).toEqual({saldo: 12.5, bron: 'saldo'})
  })

  it('meldt een overlap in plaats van een vals gat', () => {
    const sep = af(1, '2026-09-01', '2026-09-30', 400)
    const half = af(2, '2026-09-15', '2026-10-15', 450)
    expect(vorigEindsaldoVoor(half, [sep, half])).toEqual({saldo: null, bron: 'overlap'})
  })

  it('rekent de controle met alle transacties uit het bestand, ook de al bekende', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const alle = [...eerste.nieuw, {id: 999, afschrift_id: 50, datum: '2026-09-25', type: 'C', bedrag: 1}]
    const eigen = transactiesVanAfschrift(eerste.afschrift, alle)
    expect(eigen.map(t => t.id)).toEqual([101, 102, 103])
    const c = saldoControle(eerste.afschrift, eigen, null)
    expect(c.verschilIntern).toBe(0)
  })

  it('sorteert afschriften op periode en vindt het laatste', () => {
    const a = af(1, '2026-08-01', '2026-08-31', 1)
    const b = af(2, '2026-10-01', '2026-10-31', 2)
    const c = af(3, '2026-09-01', '2026-09-30', 3)
    expect(sorteerAfschriften([b, a, c]).map(x => x.id)).toEqual([1, 3, 2])
    expect(laatsteAfschrift([b, a, c])?.id).toBe(2)
    expect(laatsteAfschrift([])).toBeNull()
  })
})

describe('verwijderAfschrift', () => {
  it('haalt het afschrift met zijn eigen transacties weg en laat de rest staan', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const los = {id: 7, afschrift_id: 1, datum: '2026-08-01', type: 'C', bedrag: 1}
    const r = verwijderAfschrift([los, ...eerste.nieuw], [{id: 1, transactie_ids: [7]}, eerste.afschrift], 100)
    expect(r.verwijderdeIds).toEqual([101, 102, 103])
    expect(r.transacties).toEqual([los])
    expect(r.afschriften.map(a => a.id)).toEqual([1])
  })

  it('een transactie die ook in een ander afschrift staat blijft, en verhuist daarheen', () => {
    const tx = [
      {id: 10, afschrift_id: 1, datum: '2026-09-20', type: 'D', bedrag: 5},
      {id: 11, afschrift_id: 1, datum: '2026-09-28', type: 'D', bedrag: 6},
      {id: 12, afschrift_id: 2, datum: '2026-10-02', type: 'C', bedrag: 7},
    ]
    const afschriften = [{id: 1, transactie_ids: [10, 11]}, {id: 2, transactie_ids: [11, 12]}]
    const r = verwijderAfschrift(tx, afschriften, 1)
    expect(r.verwijderdeIds).toEqual([10])
    expect(r.nieuweEigenaar).toEqual({11: 2})
    expect(r.transacties.map(t => [t.id, t.afschrift_id])).toEqual([[11, 2], [12, 2]])
    // en het latere, overlappende afschrift weghalen laat de transactie bij het eerste
    const r2 = verwijderAfschrift(tx, afschriften, 2)
    expect(r2.verwijderdeIds).toEqual([12])
    expect(r2.transacties.map(t => [t.id, t.afschrift_id])).toEqual([[10, 1], [11, 1]])
  })

  it('een onbekend afschrift verandert niets', () => {
    const tx = [{id: 1, afschrift_id: 1}]
    const r = verwijderAfschrift(tx, [{id: 1}], 99)
    expect(r.transacties).toEqual(tx)
    expect(r.verwijderdeIds).toEqual([])
  })

  it('daarna geeft dezelfde import de transacties gewoon terug', () => {
    const eerste = bouwBankImport(parseMT940(AFSCHRIFT), [], [], {maakId: teller(), nu: NU})
    const weg = verwijderAfschrift(eerste.nieuw, [eerste.afschrift], eerste.afschrift.id)
    const opnieuw = bouwBankImport(parseMT940(AFSCHRIFT), weg.transacties, weg.afschriften, {maakId: teller(700), nu: NU})
    expect(opnieuw.alBekend).toBe(false)
    expect(opnieuw.nieuw).toHaveLength(3)
  })
})

describe('bankSaldiNaVerwijderen', () => {
  const iban = 'NL12INGB0001234567'
  const sep = {id: 1, iban, eindsaldo: 400, beginsaldo: 300, tot: '2026-09-30', afschriftNr: '41', geimporteerd_op: NU}
  const okt = {id: 2, iban, eindsaldo: 500, beginsaldo: 400, tot: '2026-10-31', afschriftNr: '42', geimporteerd_op: NU}

  it('zet het saldo terug op het laatste overgebleven afschrift als het van het verwijderde kwam', () => {
    const saldi = {[iban]: {iban, eindsaldo: 500, datum: '2026-10-31', afschrift_nr: '42'}, ander: {eindsaldo: 1}}
    const uit = bankSaldiNaVerwijderen(saldi, okt, [sep])
    expect(uit[iban]).toMatchObject({eindsaldo: 400, datum: '2026-09-30', afschrift_nr: '41'})
    expect(uit.ander).toEqual({eindsaldo: 1})
  })

  it('haalt het saldo weg als er voor die rekening niets meer over is', () => {
    const saldi = {[iban]: {iban, eindsaldo: 500, datum: '2026-10-31', afschrift_nr: '42'}}
    expect(bankSaldiNaVerwijderen(saldi, okt, [])).toEqual({})
  })

  it('laat een saldo van een ander afschrift staan', () => {
    const saldi = {[iban]: {iban, eindsaldo: 500, datum: '2026-10-31', afschrift_nr: '42'}}
    expect(bankSaldiNaVerwijderen(saldi, sep, [okt])).toBe(saldi)
  })
})
