import React from 'react'
import { t } from '../../i18n'
import BierKleur from '../ui/BierKleur'
import SectionHeader from '../ui/SectionHeader'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import type { ProductEtiketOordeel } from '../../utils/productPagina'

// De kop van een product (SPEC M ①, N ①). Op het bureau de enige gevulde
// themabalk van de pagina: stip, naam, stijl, de status en de etiketversie,
// rechts één knop (Bewerken) en de rest in ⋯ — de naam wordt niet meer
// weggedrukt. Op de telefoon staat de naam al in de kopbalk: een witte kaart
// met stijl en status, daaronder wat het gedrukte etiket zegt ("Etiket v3:
// 6,2 % vol · Bevat: gerst") en de etiketchip, die naar het segment Etiket
// springt. Bewerken staat daar in het ⋯-menu.

export interface ProductKopProps {
  product: any
  ebc: number | null
  /** Regel 2: `etiketKopRegel`. */
  etiketRegel: { label: string; waarde: string }
  /** De etiketchip (dezelfde als op de kaart); null = niets om tegen te toetsen. */
  oordeel: ProductEtiketOordeel | null
  onBewerken: () => void
  /** Uit roulatie, archiveren, verwijderen. */
  acties: RowActie[]
  telefoon: boolean
  /** Telefoon: de etiketchip opent het segment Etiket. */
  onEtiket?: () => void
}

const CHIP: Record<'rood' | 'oranje' | 'groen', string> = {
  rood: 'bg-red-100 text-red-700',
  oranje: 'bg-orange-100 text-orange-800',
  groen: 'bg-green-100 text-green-700',
}

/** "Actief", "Uit roulatie" of "Gearchiveerd". */
const statusVan = (p: any): { tekst: string; actief: boolean } =>
  p?.status === 'gearchiveerd' ? { tekst: t('lbl_product_gearchiveerd'), actief: false }
    : p?.uit_roulatie ? { tekst: t('bier_veld_uit_roulatie'), actief: false }
    : { tekst: t('lbl_product_actief'), actief: true }

const ProductKop: React.FC<ProductKopProps> = ({ product, ebc, etiketRegel, oordeel, onBewerken, acties, telefoon, onEtiket }) => {
  const status = statusVan(product)
  const versie = String(product?.etiket_versie ?? '').trim()
  const naam = product?.naam || t('lbl_naamloos')

  if (telefoon) {
    const stijl = String(product?.stijl ?? '').trim()
    return (
      <section aria-label={naam} className="bg-white rounded-xl shadow-card pl-3.5 pr-1.5 py-1.5 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <BierKleur ebc={ebc} s="md" />
          <span className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 break-words">{stijl || naam}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${status.actief ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {status.tekst}
          </span>
          <RowActions v="kaart" acties={[{ id: 'bewerken', label: t('btn_bewerken'), onClick: onBewerken }, ...acties]} />
        </div>
        <p className="pr-2 text-sm text-gray-800 break-words">
          <span className="text-gray-600">{etiketRegel.label}</span>{' '}
          <span className="font-semibold text-gray-900">{etiketRegel.waarde}</span>
        </p>
        {oordeel && (
          <button type="button" onClick={onEtiket}
            className="self-start min-h-tap inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-[13px] font-medium ${CHIP[oordeel.status.kleur]}`}>
              {oordeel.tekst}{' ›'}
            </span>
          </button>
        )}
      </section>
    )
  }

  return (
    <SectionHeader solid wrap rounded="full" cls="py-3 shadow-sm"
      title={
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
          <BierKleur ebc={ebc} s="lg" />
          <span className="text-xl font-bold leading-tight break-words min-w-0">{naam}</span>
          {product?.stijl && <span className="text-sm font-normal text-white/80">{product.stijl}</span>}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${status.actief ? 'bg-green-100 text-green-800' : 'bg-white/20 text-white'}`}>
            {status.tekst}
          </span>
          {versie && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ring-1 ring-white/50 text-white">
              {t('recept_etiket_versie').replace('{versie}', versie)}
            </span>
          )}
        </span>
      }
      info={<RowActions v="header" primair={{ id: 'bewerken', label: t('btn_bewerken'), onClick: onBewerken }} acties={acties} />}
    />
  )
}

export default ProductKop
