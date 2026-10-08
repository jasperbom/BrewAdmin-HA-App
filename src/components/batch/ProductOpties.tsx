import React from 'react'
import { t } from '../../i18n'
import type { BatchProductKeuze } from '../../utils/batchKeten'

// De opties van een productkeuze bij een batch (CCP 3, het afvulformulier,
// de batchgegevens): de producten van het recept bovenaan onder het kopje
// "Bij dit recept", de rest onder "Andere producten". Een kopje alleen als er
// van beide iets is — anders is het gewoon de lijst. De volgorde zelf komt uit
// `productenVoorBatchKeuze` (utils/batchKeten.ts).

type Keuze = BatchProductKeuze<{ id: number; naam: string; stijl?: string }>

const metKopjes = (keuzes: Keuze[]): boolean =>
  keuzes.some(k => k.vanRecept) && keuzes.some(k => !k.vanRecept)

const kopje = (vanRecept: boolean): string => t(vanRecept ? 'keten_groep_recept' : 'keten_groep_overig')

/** Als opties voor `Sel` (met `groep`). */
export function productSelOpties(
  keuzes: Keuze[],
  label: (k: Keuze) => string,
): Array<{ v: string; l: string; groep?: string }> {
  const kop = metKopjes(keuzes)
  return keuzes.map(k => ({
    v: String(k.product.id),
    l: label(k),
    ...(kop ? { groep: kopje(k.vanRecept) } : {}),
  }))
}

/** Als `<option>`s (met `<optgroup>`) binnen een eigen `<select>`. */
export const ProductOpties: React.FC<{ keuzes: Keuze[]; label: (k: Keuze) => string }> = ({ keuzes, label }) => {
  const optie = (k: Keuze) => <option key={k.product.id} value={k.product.id}>{label(k)}</option>
  if (!metKopjes(keuzes)) return <>{keuzes.map(optie)}</>
  return (
    <>
      <optgroup label={kopje(true)}>{keuzes.filter(k => k.vanRecept).map(optie)}</optgroup>
      <optgroup label={kopje(false)}>{keuzes.filter(k => !k.vanRecept).map(optie)}</optgroup>
    </>
  )
}
