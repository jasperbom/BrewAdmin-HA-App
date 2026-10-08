import { describe, it, expect } from 'vitest'
import { balkStap } from '../batchActieBalk'
import { volgendeStap } from '../volgendeStap'
import type { VolgendeStap } from '../volgendeStap'

const stap = (s: Partial<VolgendeStap> & Pick<VolgendeStap, 'soort'>): VolgendeStap => ({
  labelSleutel: `stap_${s.soort}`, kortSleutel: `stap_kort_${s.soort}`, labelParams: {}, opent: true, openTaken: 0, ...s,
})

describe('balkStap — de ActieBalk van de batchpagina', () => {
  it('een overgang zonder vraag voert de balk zelf uit', () => {
    const s = stap({ soort: 'naar_conditioneren', overgang: 'Conditioneren', doel: { fase: 'Conditioneren' } })
    expect(balkStap(s, 'Vergisten', { naar: 'Conditioneren', blokkade: null, vraag: null }))
      .toEqual({ actie: { soort: 'overgang', naar: 'Conditioneren' }, opent: false, blokkade: null })
  })

  it('vraagt de overgang eerst iets, dan naar de knop onder de fase (daar zit de bevestiging)', () => {
    const s = stap({ soort: 'afronden', overgang: 'Gesloten', doel: { fase: 'Gesloten' } })
    expect(balkStap(s, 'Afgevuld', { naar: 'Gesloten', blokkade: null, vraag: '2 punten open. Toch naar Gereed?' }))
      .toEqual({ actie: { soort: 'ga', fase: 'Afgevuld', sectie: 'overgang' }, opent: true, blokkade: null })
  })

  it('een geblokkeerde overgang: de balk staat uit, met de reden', () => {
    const s = stap({ soort: 'afvullen', overgang: 'Afgevuld', doel: { fase: 'Afgevuld', sectie: 'sessie' } })
    const b = balkStap(s, 'Conditioneren', { naar: 'Afgevuld', blokkade: 'na ABV vastzetten en CCP 1', vraag: null })
    expect(b).toEqual({ actie: { soort: 'overgang', naar: 'Afgevuld' }, opent: false, blokkade: 'na ABV vastzetten en CCP 1' })
  })

  it('ABV vastzetten, Meting en Etiket bijwerken voeren uit (zonder ›)', () => {
    expect(balkStap(stap({ soort: 'abv_vastzetten', doel: { fase: 'Conditioneren', sectie: 'abv' } }), 'Conditioneren', null))
      .toEqual({ actie: { soort: 'abv' }, opent: false, blokkade: null })
    expect(balkStap(stap({ soort: 'meting', opent: false }), 'Vergisten', null)?.actie).toEqual({ soort: 'meting' })
    expect(balkStap(stap({ soort: 'etiket_bijwerken', doel: { fase: 'Conditioneren', sectie: 'etiket' } }), 'Conditioneren', null)?.actie)
      .toEqual({ soort: 'etiket' })
  })

  it('de rest brengt je naar de stap op de pagina (met ›)', () => {
    expect(balkStap(stap({ soort: 'vrijgave', doel: { fase: 'Conditioneren', sectie: 'vrijgave' } }), 'Conditioneren', null))
      .toEqual({ actie: { soort: 'ga', fase: 'Conditioneren', sectie: 'vrijgave' }, opent: true, blokkade: null })
    expect(balkStap(stap({ soort: 'dryhop', doel: { fase: 'Vergisten', sectie: 'dryhop' } }), 'Vergisten', null)?.actie)
      .toEqual({ soort: 'ga', fase: 'Vergisten', sectie: 'dryhop' })
    expect(balkStap(stap({ soort: 'brouwdag', doel: { fase: 'Brouwen', sectie: 'brouwdag' } }), 'Brouwen', null)?.actie)
      .toEqual({ soort: 'ga', fase: 'Brouwen', sectie: 'brouwdag' })
    // Zonder doel: de huidige fase (een oude status telt als zijn fase).
    expect(balkStap(stap({ soort: 'sessie_afsluiten' }), 'Verpakt', null)?.actie)
      .toEqual({ soort: 'ga', fase: 'Afgevuld', sectie: null })
  })

  it('een overgang zonder bijpassende knop (andere fase dan de knop) gaat naar de knop onder de fase', () => {
    const s = stap({ soort: 'brouwdag_starten', overgang: 'Brouwen' })
    expect(balkStap(s, 'Gepland', null)).toEqual({ actie: { soort: 'ga', fase: 'Gepland', sectie: 'overgang' }, opent: true, blokkade: null })
    expect(balkStap(s, 'Gepland', { naar: 'Vergisten', blokkade: null, vraag: null })?.actie.soort).toBe('ga')
  })

  it('"Openen" is op de batch zelf niets: geen balk', () => {
    expect(balkStap(stap({ soort: 'openen' }), 'Gepland', null)).toBeNull()
  })

  it('werkt op wat volgendeStap echt teruggeeft (Conditioneren, ABV nog niet vast)', () => {
    const s = volgendeStap({ id: 1, status: 'Conditioneren', datum: '2026-09-15', FG: 1.012, OG: 1.064 }, { vandaag: '2026-10-07', abvWaarde: 7.0 })
    expect(s.soort).toBe('abv_vastzetten')
    expect(balkStap(s, 'Conditioneren', { naar: 'Afgevuld', blokkade: 'x', vraag: null })?.actie).toEqual({ soort: 'abv' })
  })
})
