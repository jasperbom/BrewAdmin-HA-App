// ── Waar komt een uitklapmenu te staan? ─────────────────────────────────────
// Het ⋯-menu van RowActions (components/ui/RowActions.tsx) hangt met
// `position: fixed` aan zijn knop. Standaard eronder, rechts uitgelijnd op de
// knop. Past het daar niet — een rij onderaan het scherm, op een telefoon
// boven de onderbalk — dan erboven; past het nergens helemaal, dan aan de kant
// met de meeste ruimte, met een maximale hoogte (het menu scrolt dan zelf).
// Horizontaal blijft het altijd binnen het venster. Puur: de component meet de
// knop, het menu en het venster en zet de uitkomst als stijl.

export interface Rechthoek {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MenuMaat {
  breedte: number
  hoogte: number
}

export interface VensterMaat {
  breedte: number
  /** Bruikbare hoogte: de onderkant van wat zichtbaar is (boven een vaste onderbalk). */
  hoogte: number
  /** Bovenkant van het bruikbare deel (onder een vaste kopbalk); standaard 0. */
  boven?: number
}

export interface MenuPositie {
  top: number
  left: number
  /** Gezet als het menu niet helemaal past: dan scrolt het zelf. */
  maxHoogte?: number
  /** Klapt het menu boven de knop open? */
  omhoog: boolean
}

/** Ruimte tussen knop en menu. */
export const MENU_AFSTAND = 4
/** Minimale afstand tot de rand van het venster. */
export const MENU_MARGE = 8

const eindig = (n: unknown, terugval = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : terugval)

export function menuPositie(knop: Rechthoek, menu: MenuMaat, venster: VensterMaat): MenuPositie {
  const marge = MENU_MARGE
  const afstand = MENU_AFSTAND
  const vensterBreedte = Math.max(0, eindig(venster.breedte))
  const boven = Math.max(0, eindig(venster.boven))
  const onder = Math.max(boven, eindig(venster.hoogte))
  const breedte = Math.max(0, eindig(menu.breedte))
  const hoogte = Math.max(0, eindig(menu.hoogte))

  // Horizontaal: rechts uitgelijnd op de knop, binnen het venster. Is het
  // venster smaller dan het menu, dan begint het menu op de linkermarge.
  const maxLeft = vensterBreedte - breedte - marge
  const left = Math.max(marge, Math.min(eindig(knop.right) - breedte, maxLeft))

  const ruimteOnder = onder - marge - (eindig(knop.bottom) + afstand)
  const ruimteBoven = eindig(knop.top) - afstand - (boven + marge)

  if (hoogte <= ruimteOnder) return { top: eindig(knop.bottom) + afstand, left, omhoog: false }
  if (hoogte <= ruimteBoven) return { top: eindig(knop.top) - afstand - hoogte, left, omhoog: true }
  // Past nergens helemaal: de kant met de meeste ruimte, en daar scrollen.
  if (ruimteBoven > ruimteOnder) {
    const max = Math.max(0, ruimteBoven)
    return { top: eindig(knop.top) - afstand - max, left, maxHoogte: max, omhoog: true }
  }
  return { top: eindig(knop.bottom) + afstand, left, maxHoogte: Math.max(0, ruimteOnder), omhoog: false }
}
