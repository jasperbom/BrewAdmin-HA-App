import nl from './nl.json'
import en from './en.json'
import de from './de.json'
import fr from './fr.json'
import es from './es.json'

const BREW_TRANS: Record<string, Record<string, string>> = { nl, en, de, fr, es }

const lsGet = (k: string, d: any = null) => {
  try { return JSON.parse(localStorage.getItem('craftery_' + k) ?? 'null') ?? d } catch { return d }
}
// Afgevangen zodat een volle localStorage (QuotaExceededError, bijv. bij grote
// inline afbeeldingen) nooit de hele app laat crashen. De data staat dan nog op
// de server; alleen de lokale cache van deze sleutel is niet bijgewerkt.
export const lsSet = (k: string, v: any) => {
  try { localStorage.setItem('craftery_' + k, JSON.stringify(v)) }
  catch (e) { console.warn('lsSet overgeslagen (' + k + '):', e) }
}
export const lsGet2 = lsGet

let _lang: string = lsGet('lang', 'nl') || 'nl'
export const getLang = () => _lang
export const setLang = (l: string) => {
  _lang = l
  lsSet('lang', l)
  // Zonder dit blijft het document 'nl' claimen in elke taal: schermlezers
  // spreken de tekst dan met de verkeerde fonetiek uit.
  try { document.documentElement.lang = l } catch { /* geen DOM (tests) */ }
}
/**
 * Vertaalt `key`. Ontbreekt de sleutel in de actieve taal én in het Nederlands,
 * dan wint `fallback` — en pas als die er niet is de sleutelnaam zelf.
 *
 * Die `fallback` is er omdat een sleutel vaak uit data wordt opgebouwd
 * (`orders_status_${b.status}`). Bestond de sleutel niet, dan kwam de rauwe
 * `orders_status_iets` in beeld: `t(...) || waarde` ving dat niet af, want een
 * sleutelnaam is een niet-lege string en dus truthy.
 */
export const t = (key: string, fallback?: string): string =>
  BREW_TRANS[_lang]?.[key] ?? BREW_TRANS['nl']?.[key] ?? fallback ?? key
export const LANGUAGES = ['nl', 'en', 'de', 'fr', 'es'] as const
