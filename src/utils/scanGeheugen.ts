// Het geheugen van de factuurscan (data-sleutel `scan_correcties`).
//
// Vroeger stond hier alleen {tekst, soort}: verplaatste de gebruiker een regel
// naar een andere soort, dan deelde de volgende scan dezelfde omschrijving zo
// in. Nu onthoudt de app bij het opslaan van een gescande factuur per
// leverancier hoe elke regel is geboekt: de soort, het gekoppelde ingrediënt
// of verpakkingsmateriaal, de kostensoort en de eenheid. De volgende factuur
// van die leverancier wordt daarmee gekoppeld zonder te raden; de oude
// {tekst, soort}-regels blijven gelden als algemene correctie.
//
// Puur en zonder React.

import { normNaam, type InkoopRegel, type RegelSoort, REGEL_SOORTEN } from './inkoopRegels'

export interface ScanKoppeling {
  /** Omschrijving zoals op de factuur. */
  tekst: string
  soort: RegelSoort
  leverancier?: string
  /** Artikelnummer van de leverancier: de sterkste sleutel. */
  artikelcode?: string
  /** Naam van het gekoppelde ingrediënt of verpakkingsmateriaal. */
  naam?: string
  /** Kostensoort van een regel met overige kosten. */
  kostensoort?: string
  eenheid?: string
}

/** Hoeveel koppelingen bewaard blijven (de nieuwste). */
export const GEHEUGEN_MAX = 500

const geldig = (k: unknown): k is ScanKoppeling =>
  !!k && typeof k === 'object' && typeof (k as ScanKoppeling).tekst === 'string'
  && (REGEL_SOORTEN as string[]).includes(String((k as ScanKoppeling).soort))

const sleutel = (k: { tekst: string, leverancier?: string, artikelcode?: string }): string =>
  `${normNaam(k.leverancier)}|${normNaam(k.artikelcode) || normNaam(k.tekst)}`

/** Voeg koppelingen toe of werk ze bij (de nieuwste wint, achteraan in de lijst). */
export const leerKoppelingen = (prev: unknown, nieuw: ScanKoppeling[]): ScanKoppeling[] => {
  let lijst: ScanKoppeling[] = (Array.isArray(prev) ? prev : []).filter(geldig)
  for (const k of nieuw || []) {
    if (!geldig(k) || !normNaam(k.tekst)) continue
    const s = sleutel(k)
    const schoon: ScanKoppeling = { tekst: k.tekst.trim(), soort: k.soort }
    if (k.leverancier?.trim()) schoon.leverancier = k.leverancier.trim()
    if (k.artikelcode?.trim()) schoon.artikelcode = k.artikelcode.trim()
    if (k.naam?.trim()) schoon.naam = k.naam.trim()
    if (k.kostensoort?.trim()) schoon.kostensoort = k.kostensoort.trim()
    if (k.eenheid?.trim()) schoon.eenheid = k.eenheid.trim()
    lijst = [...lijst.filter(x => sleutel(x) !== s), schoon]
  }
  return lijst.slice(-GEHEUGEN_MAX)
}

/** De oude vorm (alleen soort): een regel verplaatst naar een andere soort. */
export const registreerScanCorrectie = (prev: unknown, c: { tekst: string, soort: string }): ScanKoppeling[] =>
  leerKoppelingen(prev, [{ tekst: c.tekst, soort: c.soort as RegelSoort }])

/** Hoe deze regel eerder werd geboekt, of null. Volgorde: zelfde leverancier
 *  en artikelnummer, zelfde leverancier en omschrijving, dan dezelfde
 *  omschrijving bij wie dan ook (de nieuwste wint). */
export const zoekKoppeling = (
  geheugen: unknown,
  regel: { tekst: string, leverancier?: string | null, artikelcode?: string | null },
): ScanKoppeling | null => {
  const lijst = (Array.isArray(geheugen) ? geheugen : []).filter(geldig)
  const lev = normNaam(regel.leverancier)
  const code = normNaam(regel.artikelcode)
  const tekst = normNaam(regel.tekst)
  const zoek = (pred: (k: ScanKoppeling) => boolean): ScanKoppeling | null => {
    for (let i = lijst.length - 1; i >= 0; i--) if (pred(lijst[i])) return lijst[i]
    return null
  }
  if (lev && code) {
    const k = zoek(x => normNaam(x.leverancier) === lev && normNaam(x.artikelcode) === code)
    if (k) return k
  }
  if (!tekst) return null
  if (lev) {
    const k = zoek(x => normNaam(x.leverancier) === lev && normNaam(x.tekst) === tekst)
    if (k) return k
  }
  return zoek(x => normNaam(x.tekst) === tekst)
}

/** De laatste correcties (één per omschrijving) voor in de scanprompt. */
export const correctiesVoorPrompt = (geheugen: unknown, max = 40): Array<{ tekst: string, soort: RegelSoort }> => {
  const lijst = (Array.isArray(geheugen) ? geheugen : []).filter(geldig)
  const gezien = new Set<string>()
  const uit: Array<{ tekst: string, soort: RegelSoort }> = []
  for (let i = lijst.length - 1; i >= 0 && uit.length < max; i--) {
    const n = normNaam(lijst[i].tekst)
    if (!n || gezien.has(n)) continue
    gezien.add(n)
    uit.push({ tekst: lijst[i].tekst, soort: lijst[i].soort })
  }
  return uit.reverse()
}

interface Item { id: number | string, naam?: string }

/** Wat er van een opgeslagen boeking te leren valt: elke regel die uit de scan
 *  kwam, met de soort en koppeling waarmee hij uiteindelijk geboekt is. */
export const koppelingenUitRegels = (
  regels: InkoopRegel[], leverancier: string, ing: Item[], onderdelen: Item[],
): ScanKoppeling[] => {
  const uit: ScanKoppeling[] = []
  for (const r of regels || []) {
    if (!r.bron?.tekst || r.correctie) continue
    const lijst = r.soort === 'ingredient' ? ing : r.soort === 'verpakking' ? onderdelen : []
    const item = r.koppelId ? (lijst || []).find(x => String(x.id) === r.koppelId) : undefined
    const naam = r.soort === 'overig' ? undefined : (item?.naam ? String(item.naam) : r.naam.trim() || undefined)
    uit.push({
      tekst: r.bron.tekst,
      soort: r.soort,
      leverancier: leverancier || undefined,
      artikelcode: r.bron.artikelcode || undefined,
      naam,
      kostensoort: r.soort === 'overig' ? r.kostensoort || undefined : undefined,
      eenheid: r.soort === 'ingredient' ? r.eenh || undefined : undefined,
    })
  }
  return uit
}
