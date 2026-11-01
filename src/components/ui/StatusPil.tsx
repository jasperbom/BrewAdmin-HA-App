import React from 'react'

/**
 * De kleur van een status, zoals de utils hem teruggeven (`kleur` op een chip of
 * oordeel: productPagina, verkoopOverzicht, etiket …). Betekenis, geen thema:
 * groen = in orde, oranje = let op, rood = fout/tekort, grijs = neutraal,
 * blauw = bezig/informatie, paars = conditioneren.
 *
 * Oranje is in het Craftery-thema roest (craftery.css, `--oranje-*`), zodat een
 * waarschuwing niet op de amber knoppen lijkt.
 */
export type PilKleur = 'groen' | 'oranje' | 'rood' | 'grijs' | 'blauw' | 'paars'

/** Eén tabel voor alle statuspillen (vervangt de losse `CHIP`-tabellen per component). */
export const PIL_KLEUR: Record<PilKleur, string> = {
  groen: 'bg-green-100 text-green-800',
  oranje: 'bg-orange-100 text-orange-800',
  rood: 'bg-red-100 text-red-700',
  grijs: 'bg-gray-100 text-gray-700',
  blauw: 'bg-blue-100 text-blue-700',
  paars: 'bg-purple-100 text-purple-700',
}

interface StatusPilProps {
  kleur: PilKleur
  children: React.ReactNode
  /** Extra klassen (maat, marge, afbreken). */
  cls?: string
  title?: string
}

/** Een statuspil: korte tekst op een lichte achtergrond in de kleur van de betekenis. */
const StatusPil: React.FC<StatusPilProps> = ({ kleur, children, cls = '', title }) => (
  <span title={title}
    className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${PIL_KLEUR[kleur] ?? PIL_KLEUR.grijs} ${cls}`}>
    {children}
  </span>
)

export default StatusPil
