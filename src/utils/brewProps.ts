// Resolvers voor brouwkundige eigenschappen op een lot. Een waarde mag op het
// lot zelf staan (specifiek voor deze charge), anders valt het terug op de
// algemene Ingredient.bf_props (Brewfather-bron).

export type BrewSource = 'lot' | 'ingredient' | 'none'

export const isEmpty = (v: any): boolean =>
  v === undefined || v === null || v === ''

// Geeft de effectieve waarde voor één key, of undefined als niets gezet is.
export const getEffectiveBrewProp = (lot: any, ing: any, key: string): any => {
  if (!isEmpty(lot?.bf_props?.[key])) return lot.bf_props[key]
  if (!isEmpty(ing?.bf_props?.[key])) return ing.bf_props[key]
  return undefined
}

// Geeft de bron voor één key (zonder de waarde te resolven).
export const getBrewPropSource = (lot: any, ing: any, key: string): BrewSource => {
  if (!isEmpty(lot?.bf_props?.[key])) return 'lot'
  if (!isEmpty(ing?.bf_props?.[key])) return 'ingredient'
  return 'none'
}

// Geeft alle effectieve keys met waarde + bron, gemerged uit lot en ingredient.
export const getEffectiveBrewProps = (
  lot: any,
  ing: any
): Record<string, { value: any; source: BrewSource }> => {
  const out: Record<string, { value: any; source: BrewSource }> = {}
  const keys = new Set<string>([
    ...Object.keys(lot?.bf_props || {}),
    ...Object.keys(ing?.bf_props || {}),
  ])
  keys.forEach((k) => {
    if (!isEmpty(lot?.bf_props?.[k])) out[k] = { value: lot.bf_props[k], source: 'lot' }
    else if (!isEmpty(ing?.bf_props?.[k])) out[k] = { value: ing.bf_props[k], source: 'ingredient' }
  })
  return out
}

// Strip lege strings/null/undefined uit een bf_props-bag voor opslag. Lege
// waardes mogen nooit in het lot belanden, anders blokkeren ze de fallback.
export const stripEmptyBrewProps = (props: Record<string, any> | undefined | null): Record<string, any> => {
  const out: Record<string, any> = {}
  if (!props) return out
  for (const [k, v] of Object.entries(props)) {
    if (!isEmpty(v)) out[k] = v
  }
  return out
}
