import React from 'react'
import { t } from '../../i18n'
import Badge from '../ui/Badge'
import BierKleur from '../ui/BierKleur'

// De kop van een batch als eigen pagina: welk bier (bierkleur, titel uit
// `batchTitel`, batchnummer), de fase en de stijl, de acties rechts, daaronder
// de ketenregel (Recept › Product › Tank) en de stappenbalk. Van Gepland t/m
// Vergisten staat er nog geen etiketkaart: dan zegt één strook wat er op het
// etiket gaat komen ("Doel 6,8 % · 22 IBU · 9 EBC · Bevat: gerst, tarwe",
// `etiketDoelStrook` in utils/etiket.ts).
//
// Op een telefoon draagt de kopbalk van de schil de naam al ("Kadeblond
// #2609"): daar begint de kop bij de fase, zonder de naam nog eens.

interface BatchKopProps {
  /** De titel van de batch (`batchTitel(...).titel`). */
  titel: string
  /** Het batchnummer zonder `#` (`batchNummer`); leeg = niet tonen. */
  nummer?: string
  /** EBC voor de bierkleur (`batchEbc`). */
  ebc?: number | string | null
  status: string
  stijl?: string
  /** Knoppen rechts in de kop. */
  acties?: React.ReactNode
  /** Waarom een actie uit de kop niet kon (in plaats van een alert()). */
  melding?: string | null
  /** De ketenregel (components/batch/KetenRegel). */
  keten?: React.ReactNode
  /** Gepland t/m Vergisten: wat er op het etiket gaat komen (`etiketDoelStrook`). */
  strook?: string | null
  /** De stappenbalk. */
  children?: React.ReactNode
}

const BatchKop: React.FC<BatchKopProps> = ({ titel, nummer, ebc, status, stijl, acties, melding, keten, strook, children }) => (
  <div className="bg-white rounded-xl shadow-card p-4 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
        <span className="hidden md:inline-flex"><BierKleur ebc={ebc} s="lg" /></span>
        <h2 className="hidden md:block text-2xl font-bold text-gray-900 leading-tight min-w-0 break-words">{titel}</h2>
        {nummer && <span className="hidden md:inline text-base font-medium text-gray-500 tabular-nums">#{nummer}</span>}
        <Badge s={status} />
        {stijl && <span className="text-sm text-gray-600 min-w-0 break-words">{stijl}</span>}
      </div>
      {acties && <div className="flex flex-wrap items-center justify-end gap-2">{acties}</div>}
    </div>
    {melding && (
      <div role="alert" className="text-sm px-3 py-2 rounded-lg border border-orange-200 bg-orange-50 text-orange-800">{melding}</div>
    )}
    {keten}
    {strook && (
      <p className="text-sm text-gray-600 break-words">
        <span className="sr-only">{t('etiket_doel_strook_label')}: </span>{strook}
      </p>
    )}
    {children}
  </div>
)

export default BatchKop
