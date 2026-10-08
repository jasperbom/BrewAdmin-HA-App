import { describe, it, expect } from 'vitest'
import { attentieLabel, attentieToelichting, detailTekst, verpakkingInZin, vulIn } from '../attentieTekst'
import type { AttentieDetail, AttentiePost } from '../attentie'
import nl from '../../i18n/nl.json'
import de from '../../i18n/de.json'
import { maakT } from './demoBrouwerij'

const t = maakT(nl as Record<string, string>)
const tDe = maakT({ ...(nl as Record<string, string>), ...(de as Record<string, string>) })

describe('vulIn', () => {
  it('vult elke plaatshouder, ook als hij twee keer voorkomt', () => {
    expect(vulIn('{a} en {b} en {a}', { a: 1, b: 'x' })).toBe('1 en x en 1')
    expect(vulIn('{n} vrij', null)).toBe('{n} vrij')
  })
})

describe('verpakkingInZin', () => {
  it('maakt een gewoon woord vooraan klein, laat afkortingen en het Duits staan', () => {
    expect(verpakkingInZin('Fust 20 L')).toBe('fust 20 L')
    expect(verpakkingInZin('fles')).toBe('fles')
    expect(verpakkingInZin('KEG 20L')).toBe('KEG 20L')
    expect(verpakkingInZin('Flasche 0,33', 'de')).toBe('Flasche 0,33')
    expect(verpakkingInZin('Bottle 33cl', 'en')).toBe('bottle 33cl')
    expect(verpakkingInZin(null)).toBe('')
  })
})

describe('attentieLabel', () => {
  it('vult de plaatshouders van het label (Bier-THT binnen 60 dagen) en kent een korte vorm', () => {
    const p: Pick<AttentiePost, 'sleutel' | 'kortSleutel' | 'params'> = { sleutel: 'attentie_bier_tht', kortSleutel: 'attentie_bier_tht_kort', params: { dagen: 60 } }
    expect(attentieLabel(p, t)).toBe('Bier-THT binnen 60 dagen')
    expect(attentieLabel(p, t, true)).toBe('Bier-THT')
    // Zonder korte sleutel: gewoon het label.
    expect(attentieLabel({ sleutel: 'attentie_etiket' }, t, true)).toBe('Etiket klopt niet')
  })
})

describe('detailTekst / attentieToelichting', () => {
  const etiket: AttentieDetail = {
    sleutel: 'attentie_etiket_ontbreekt', kortSleutel: 'attentie_detail_product',
    params: { product: 'Kadeblond' }, allergenen: ['tarwe'], doel: { pagina: 'producten', id: 1 },
  }
  const fust: AttentieDetail = {
    sleutel: 'attentie_zonder_artikel_detail', kortSleutel: 'attentie_zonder_artikel_kort',
    params: { product: 'Sluiswit', verpakking: 'Fust 20 L', soort: 'fust', n: 3 }, doel: { pagina: 'producten', id: 3 },
  }
  const tht: AttentieDetail = {
    sleutel: 'attentie_bier_tht_detail', kortSleutel: 'attentie_bier_tht_kort_detail',
    params: { product: 'Havenbok', verpakking: 'Fles 33 cl', n: 58, datum: '2026-11-02' }, doel: { pagina: 'producten', id: 4 },
  }

  it('de zinnen van SPEC O en P', () => {
    expect(detailTekst(etiket, t)).toBe('Kadeblond: tarwe ontbreekt')
    expect(detailTekst(etiket, t, { kort: true })).toBe('Kadeblond')
    expect(detailTekst(fust, t)).toBe('Sluiswit fust 20 L (3 st)')
    expect(detailTekst(fust, t, { kort: true })).toBe('Sluiswit fust')
    expect(detailTekst(tht, t)).toBe('Havenbok fles 33 cl · 58 st · THT 2-11-2026')
    expect(detailTekst(tht, t, { kort: true })).toBe('Havenbok 2-11')
  })

  it('in het Duits blijft de verpakking met een hoofdletter, en het type is vertaald', () => {
    expect(detailTekst(fust, tDe, { taal: 'de' })).toBe('Sluiswit Fust 20 L (3 Stk.)')
    expect(detailTekst(fust, tDe, { taal: 'de', kort: true })).toBe('Sluiswit Fass')
  })

  it('een verpakking zonder bekend type: de naam zelf in de korte vorm', () => {
    const doos = { ...fust, params: { ...fust.params, verpakking: 'Doos 24', soort: 'Doos 24' } }
    expect(detailTekst(doos, t, { kort: true })).toBe('Sluiswit doos 24')
  })

  it('toont de eerste twee dingen en "+n" voor de rest; zonder details leeg', () => {
    const p = { details: [etiket, { ...etiket, params: { product: 'Pils' }, allergenen: ['gerst'] }, { ...etiket, params: { product: 'Bok' } }] }
    expect(attentieToelichting(p, t)).toBe('Kadeblond: tarwe ontbreekt · Pils: gerst ontbreekt · +1')
    expect(attentieToelichting(p, t, { kort: true, max: 1 })).toBe('Kadeblond · +2')
    expect(attentieToelichting({}, t)).toBe('')
  })
})
