import React from 'react'
import { t } from '../../i18n'
import { openBestellingTekst } from '../../utils/productPagina'
import type { OpenBestelling } from '../../utils/productPagina'

// "Open bestellingen met Kadeblond (1) ›" (SPEC M en N): de kop opent
// Bestellingen, gefilterd op dit bier (chip Te picken + de naam als
// zoektekst); elke regel ("WC-4321 · Café De Kade · 48 fles") opent die
// bestelling. Geen open bestellingen = geen kaart.

interface OpenBestellingenKaartProps {
  naam: string
  bestellingen: OpenBestelling[]
  onAlle: () => void
  onOpen: (id: number) => void
}

const OpenBestellingenKaart: React.FC<OpenBestellingenKaartProps> = ({ naam, bestellingen, onAlle, onOpen }) => {
  if (!bestellingen.length) return null
  return (
    <section className="bg-white rounded-xl shadow-card overflow-hidden">
      <button type="button" onClick={onAlle}
        className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[52px] text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
        <span className="flex-1 min-w-0 font-semibold t-accent-text break-words">
          {t('product_open_bestellingen').replace('{naam}', naam).replace('{n}', String(bestellingen.length))}
        </span>
        <span aria-hidden="true" className="t-accent-text text-xl leading-none">›</span>
      </button>
      <ul className="pb-1.5">
        {bestellingen.slice(0, 5).map(b => (
          <li key={b.id}>
            <button type="button" onClick={() => onOpen(b.id)}
              className="w-full text-left px-4 py-1 min-h-tap md:min-h-0 text-[13px] text-gray-600 hover:bg-gray-50 hover:underline break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
              {openBestellingTekst(b, t)}
            </button>
          </li>
        ))}
        {bestellingen.length > 5 && (
          <li className="px-4 py-1 text-[13px] text-gray-500">{t('orders_regels_meer').replace('{n}', String(bestellingen.length - 5))}</li>
        )}
      </ul>
    </section>
  )
}

export default OpenBestellingenKaart
