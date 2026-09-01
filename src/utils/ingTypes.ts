// Ingrediënttypen: herkenning tussen een receptregel en het ingredient in de
// voorraad.
//
// Waarom dit bestaat: Brewfather zet álle vergistbare stoffen in één lijst
// (`fermentables`) — mout, extract, maar ook kandijsuiker, dextrose en honing.
// De app zette die lijst voorheen integraal weg als type `Mout`, terwijl
// dezelfde kandijsuiker uit de Brewfather-*voorraad* als `Suiker` binnenkwam
// (zie `BF_FERM_TYPE_MAP`). Gevolg: de receptregel en het voorraadingredient
// herkenden elkaar niet, en de koppel-dropdown liet het suiker-ingredient niet
// eens zien omdat die strikt op `type ===` filterde.
//
// Twee dingen lossen dat op:
//  1. `bfFermType` — een fermentable krijgt bij de import het type dat er
//     werkelijk bij hoort (Sugar/Honey → Suiker), zowel in het recept als op
//     de batchregels;
//  2. `verwanteIngTypes` — bij het koppelen zijn verwante typen uitwisselbaar,
//     zodat bestaande recepten (die nog `Mout` op de suikerregel hebben) ook
//     zónder hersync aan het juiste ingredient te koppelen zijn.

import { BUILTIN_ING_TYPES } from './constants'

// Brewfather `fermentables[].type` → ingredienttype in deze app.
export const BF_FERM_TYPE_MAP: Record<string, string> = {
  'Grain': 'Mout', 'Extract': 'Mout', 'Dry Extract': 'Mout',
  'Sugar': 'Suiker', 'Honey': 'Suiker',
  'Adjunct': 'Overig', 'Juice': 'Overig', 'Other': 'Overig',
}

// Type van een Brewfather-fermentable; onbekend/leeg blijft Mout (de lijst
// heet niet voor niets de graanlijst).
export const bfFermType = (bfType?: string | null): string => {
  const key = String(bfType || '').trim()
  if (!key) return 'Mout'
  const direct = BF_FERM_TYPE_MAP[key]
  if (direct) return direct
  const ci = Object.keys(BF_FERM_TYPE_MAP).find(k => k.toLowerCase() === key.toLowerCase())
  return ci ? BF_FERM_TYPE_MAP[ci] : 'Mout'
}

// Schrijfwijze normaliseren naar het ingebouwde type ('mout' → 'Mout').
export const canoniekIngType = (type?: string | null): string => {
  const s = String(type || '').trim()
  if (!s) return ''
  return BUILTIN_ING_TYPES.find(x => x.toLowerCase() === s.toLowerCase()) || s
}

// Typen die bij het koppelen als uitwisselbaar gelden. Het eigen type staat
// altijd vooraan. Suiker hoort zowel bij de vergistbare stoffen (mout) als bij
// de toevoegingen (overig) — daar komt kandijsuiker in de praktijk terecht.
const VERWANT: Record<string, string[]> = {
  Mout:   ['Mout', 'Suiker'],
  Suiker: ['Suiker', 'Mout', 'Overig'],
  Overig: ['Overig', 'Suiker'],
}

export const verwanteIngTypes = (type?: string | null): string[] => {
  const c = canoniekIngType(type)
  if (!c) return ['Overig', 'Suiker']
  return VERWANT[c] || [c]
}

// Mag een receptregel van type `regelType` gekoppeld worden aan een
// ingredient van type `ingType`?
export const ingTypeMatcht = (regelType?: string | null, ingType?: string | null): boolean => {
  const doel = canoniekIngType(ingType)
  if (!doel) return false
  return verwanteIngTypes(regelType).some(x => x.toLowerCase() === doel.toLowerCase())
}

// Ingredienten die bij een receptregel/batchregel van dit type passen,
// gesorteerd op naam (eigen type eerst, dan de verwante typen).
export const ingredientenVoorType = <T extends {naam?: string, type?: string}>(
  lijst: T[] | null | undefined,
  type?: string | null,
): T[] => {
  const volgorde = verwanteIngTypes(type).map(x => x.toLowerCase())
  return (lijst || [])
    .filter(i => ingTypeMatcht(type, i.type))
    .sort((a, b) => {
      const ra = volgorde.indexOf(canoniekIngType(a.type).toLowerCase())
      const rb = volgorde.indexOf(canoniekIngType(b.type).toLowerCase())
      if (ra !== rb) return ra - rb
      return String(a.naam || '').localeCompare(String(b.naam || ''), 'nl')
    })
}
