import React from 'react'
import { t } from '../../i18n'
import { useBreedte } from '../ui/useBreedte'
import type { KetenTeksten } from '../../utils/productPagina'

// De keten van één bier in één regel (SPEC M ②): Recept › Brouwsels › Etiket
// › Voorraad › Verkoop, elk vak twee regels; een vak springt naar zijn blok
// eronder. Op de telefoon zijn de segmenten de ketenstrook (SPEC N ②):
// Voorraad · Etiket · Brouwsels · Artikelen, sticky onder de kopbalk.

export type KetenVakId = 'recept' | 'brouwsels' | 'etiket' | 'voorraad' | 'verkoop'
export type ProductSegment = 'voorraad' | 'etiket' | 'brouwsels' | 'artikelen'

const WAARDE_KLEUR: Record<'rood' | 'oranje' | 'groen', string> = {
  rood: 'text-red-700', oranje: 'text-orange-700', groen: 'text-green-700',
}
const VAK_ACHTERGROND: Record<'rood' | 'oranje' | 'groen', string> = {
  rood: 'bg-red-50', oranje: 'bg-orange-50', groen: '',
}

interface KetenStrookProps {
  teksten: KetenTeksten
  onVak: (id: KetenVakId) => void
}

/** Smaller dan dit (een tablet, een smalle detailkolom) staan de vakken in twee kolommen. */
const STROOK_SMAL = 560

export const KetenStrook: React.FC<KetenStrookProps> = ({ teksten, onVak }) => {
  // Vijf vakken naast elkaar hebben ruimte nodig: in een smalle kolom braken
  // de woorden midden door ("Bomstr-aat"). Dan twee per rij, zonder ›.
  const [ref, breedte] = useBreedte<HTMLElement>()
  const smal = breedte !== null && breedte < STROOK_SMAL
  const vakken: Array<{ id: KetenVakId; label: string; waarde: string; kleur?: 'rood' | 'oranje' | 'groen' }> = [
    { id: 'recept', label: t('product_keten_recept'), waarde: teksten.recept },
    { id: 'brouwsels', label: t('product_keten_brouwsels'), waarde: teksten.brouwsels },
    { id: 'etiket', label: t('product_keten_etiket'), waarde: teksten.etiket?.tekst || '—', kleur: teksten.etiket?.kleur },
    { id: 'voorraad', label: t('product_keten_voorraad'), waarde: teksten.voorraad },
    { id: 'verkoop', label: t('product_keten_verkoop'), waarde: teksten.verkoop },
  ]
  return (
    <nav ref={ref} aria-label={t('product_keten_aria')}
      className={`bg-white rounded-xl shadow-card px-2 py-1.5 ${smal ? 'grid grid-cols-2 gap-x-1' : 'flex items-stretch'}`}>
      {vakken.map((v, i) => (
        <React.Fragment key={v.id}>
          {i > 0 && !smal && <span aria-hidden="true" className="self-center px-0.5 text-gray-400 text-sm">›</span>}
          <button type="button" onClick={() => onVak(v.id)}
            className={`${smal ? '' : 'flex-1'} min-w-0 text-left rounded-lg px-2.5 py-2 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${v.kleur ? VAK_ACHTERGROND[v.kleur] : ''}`}>
            <span className="block text-xs text-gray-500">{v.label}</span>
            <span className={`block text-sm font-semibold break-words ${v.kleur ? WAARDE_KLEUR[v.kleur] : 'text-gray-900'}`}>
              {v.kleur === 'rood' && <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />}
              {v.waarde}
            </span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}

interface SegmentStrookProps {
  teksten: KetenTeksten
  actief: ProductSegment
  onKies: (s: ProductSegment) => void
  /** De productnaam, voor de schermlezer ("Onderdelen van Kadeblond"). */
  naam: string
}

export const SegmentStrook: React.FC<SegmentStrookProps> = ({ teksten, actief, onKies, naam }) => {
  const vakken: Array<{ id: ProductSegment; label: string; waarde: string; kleur?: 'rood' | 'oranje' | 'groen' }> = [
    { id: 'voorraad', label: t('product_keten_voorraad'), waarde: teksten.voorraadKort },
    { id: 'etiket', label: t('product_keten_etiket'), waarde: teksten.etiket?.tekst || '—', kleur: teksten.etiket?.kleur },
    { id: 'brouwsels', label: t('product_keten_brouwsels'), waarde: teksten.brouwselsKort },
    { id: 'artikelen', label: t('product_segment_artikelen'), waarde: teksten.artikelen },
  ]
  return (
    <nav aria-label={t('product_segment_aria').replace('{naam}', naam)}
      className="sticky z-20 -mx-3 sm:-mx-4 bg-white border-y border-gray-200 shadow-sm flex"
      style={{ top: 'var(--kopbalk, 0px)' }}>
      {vakken.map((v, i) => {
        const aan = v.id === actief
        return (
          <button key={v.id} type="button" onClick={() => onKies(v.id)} aria-current={aan ? 'page' : undefined}
            className={`flex-auto min-w-0 min-h-[64px] flex flex-col justify-center gap-0.5 text-left px-2.5 ${i > 0 ? 'border-l border-gray-100' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]`}
            style={aan ? { backgroundColor: 'var(--t-pale)', boxShadow: 'inset 0 -3px 0 var(--t-accent-edge, var(--t-accent))' } : undefined}>
            <span className={`text-xs ${aan ? 'font-semibold t-accent-text' : 'font-medium text-gray-600'}`}>{v.label}</span>
            {/* Past het niet, dan loopt de waarde door op een tweede regel —
                nooit een segment dat buiten beeld valt. */}
            <span className={`text-xs font-semibold break-words ${v.kleur && v.kleur !== 'groen' ? WAARDE_KLEUR[v.kleur] : 'text-gray-900'}`}>{v.waarde}</span>
          </button>
        )
      })}
    </nav>
  )
}
