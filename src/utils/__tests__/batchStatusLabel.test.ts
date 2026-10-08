import { describe, it, expect, afterEach } from 'vitest'
import nl from '../../i18n/nl.json'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import fr from '../../i18n/fr.json'
import es from '../../i18n/es.json'
import { setLang } from '../../i18n'
import { BATCH_STATUS_LABEL_KEYS, STATUSSEN, batchStatusLabel } from '../constants'

const TALEN: Record<string, Record<string, string>> = { nl, en, de, fr, es }

describe('batchStatusLabel', () => {
  afterEach(() => setLang('nl'))

  it('elke batchstatus heeft een label in alle vijf talen', () => {
    for (const s of [...STATUSSEN, 'Verpakt']) {
      const sleutel = BATCH_STATUS_LABEL_KEYS[s]
      expect(sleutel, s).toBeTruthy()
      for (const [taal, d] of Object.entries(TALEN)) expect(d[sleutel], `${taal}:${sleutel}`).toBeTruthy()
    }
  })

  it('vertaalt de status in de gekozen taal; het oude "Verpakt" heet Afgevuld', () => {
    expect(batchStatusLabel('Conditioneren')).toBe('Conditioneren')
    expect(batchStatusLabel('Verpakt')).toBe('Afgevuld')
    setLang('en')
    expect(batchStatusLabel('Vergisten')).toBe('Fermenting')
    expect(batchStatusLabel('Gesloten')).toBe('Closed')
  })

  it('laat een onbekende status zichzelf — nooit een sleutelnaam', () => {
    expect(batchStatusLabel('Lagering')).toBe('Lagering')
    // Geen eigenschap van Object.prototype als "sleutel".
    expect(batchStatusLabel('toString')).toBe('toString')
    expect(batchStatusLabel('')).toBe('')
    expect(batchStatusLabel(undefined)).toBe('')
    expect(batchStatusLabel(null)).toBe('')
  })
})
