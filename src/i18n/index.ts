import nl from './nl.json'
import en from './en.json'
import de from './de.json'
import fr from './fr.json'
import es from './es.json'

const BREW_TRANS: Record<string, Record<string, string>> = { nl, en, de, fr, es }

const lsGet = (k: string, d: any = null) => {
  try { return JSON.parse(localStorage.getItem('craftery_' + k) ?? 'null') ?? d } catch { return d }
}
export const lsSet = (k: string, v: any) => localStorage.setItem('craftery_' + k, JSON.stringify(v))
export const lsGet2 = lsGet

let _lang: string = lsGet('lang', 'nl') || 'nl'
export const getLang = () => _lang
export const setLang = (l: string) => { _lang = l; lsSet('lang', l) }
export const t = (key: string): string =>
  BREW_TRANS[_lang]?.[key] ?? BREW_TRANS['nl']?.[key] ?? key
export const LANGUAGES = ['nl', 'en', 'de', 'fr', 'es'] as const
