import React from 'react'
import RowActions, { type RowActie } from '../ui/RowActions'

// Eén recept in de receptenlijst (In gebruik, Archief, Verborgen): de naam met
// zijn chips, de regel eronder ("5× · #2609 conditioneert"), de voorraadstip
// en één ⋯ met de acties — op een telefoon een tapdoel van 44 px, nooit
// knoppen die pas bij aanwijzen verschijnen.

export type ChipSoort = 'huidig' | 'grijs' | 'oranje'

const CHIP_CLS: Record<ChipSoort, string> = {
  huidig: 'bg-green-50 text-green-700 border-green-200',
  grijs: 'bg-gray-100 text-gray-600 border-gray-200',
  oranje: 'bg-orange-50 text-orange-700 border-orange-200',
}

/** Een kleine chip naast een naam ("huidig", "vastgepind", "niet meer in Brewfather"). */
export const ReceptChip: React.FC<{ soort: ChipSoort; children: React.ReactNode; cls?: string }> = ({ soort, children, cls = '' }) => (
  <span className={`inline-flex items-center px-1.5 py-px rounded-full border text-[11px] font-medium leading-4 whitespace-nowrap ${CHIP_CLS[soort]} ${cls}`}>
    {children}
  </span>
)

export interface ReceptRijProps {
  naam: string
  /** De regel onder de naam; leeg = geen regel. */
  reden: string
  chips?: React.ReactNode
  /** Voorraadstip: kleur (Tailwind-klasse) en wat hij zegt; null = geen stip. */
  stip?: { kleur: string; label: string } | null
  geselecteerd?: boolean
  onOpen: () => void
  acties: RowActie[]
  /** Lichter (een verborgen recept). */
  gedimd?: boolean
}

const ReceptRij: React.FC<ReceptRijProps> = ({ naam, reden, chips, stip, geselecteerd = false, onOpen, acties, gedimd = false }) => (
  // De hele rij opent het recept (muis, vinger); voor het toetsenbord is de
  // naam de knop, zonder eigen onClick: zijn klik bubbelt naar de rij. De rij
  // zelf is geen knop — ⋯ staat erin, en een knop in een knop werkt voor een
  // schermlezer niet.
  <div onClick={onOpen}
    className={`relative flex items-center gap-2 pl-3 pr-2 md:pl-4 md:pr-3 py-2.5 min-h-[64px] cursor-pointer t-hover transition-colors ${geselecteerd ? 't-sel' : ''} ${gedimd ? 'opacity-75' : ''}`}>
    {/* De open regel: een balk in de themakleur links (geen rand: de
        scheidingslijnen van de lijst kleuren elke rand van de rij mee). */}
    {geselecteerd && <span aria-hidden="true" className="absolute left-0 inset-y-0 w-0.5" style={{ backgroundColor: 'var(--t-accent)' }} />}
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
        <button type="button" aria-current={geselecteerd ? 'true' : undefined}
          className="min-w-0 max-w-full text-left text-sm font-semibold text-gray-900 truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          {naam}
        </button>
        {chips}
      </div>
      {reden && <div className="text-xs text-gray-500 mt-0.5 truncate">{reden}</div>}
    </div>
    {stip && <span role="img" aria-label={stip.label} title={stip.label} className={`w-2 h-2 rounded-full flex-shrink-0 ${stip.kleur}`} />}
    {/* RowActions houdt zijn klik zelf binnen: ⋯ opent het menu, niet het recept. */}
    {acties.length > 0 && <RowActions v="kaart" acties={acties} cls="flex-shrink-0" />}
  </div>
)

export default ReceptRij
