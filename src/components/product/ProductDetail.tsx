import React from 'react'
import { t } from '../../i18n'
import ActieBalk from '../ui/ActieBalk'
import type { RowActie } from '../ui/RowActions'
import ProductKop from './ProductKop'
import { KetenStrook, SegmentStrook } from './KetenStrook'
import type { KetenVakId, ProductSegment } from './KetenStrook'
import ReceptKaart from './ReceptKaart'
import BrouwselsKaart, { TankTegel } from './BrouwselsKaart'
import type { TankTegelData } from './BrouwselsKaart'
import VoorraadKaart from './VoorraadKaart'
import type { VoorraadKaartProps } from './VoorraadKaart'
import ArtikelenKaart from './ArtikelenKaart'
import type { ArtikelenKaartProps } from './ArtikelenKaart'
import OpenBestellingenKaart from './OpenBestellingenKaart'
import type {
  BrouwselRegel, KetenTeksten, OpenBestelling, ProductEtiketOordeel, ProductRecepten,
} from '../../utils/productPagina'
import type { VerkoopVerpakking } from '../../utils/verkoopOverzicht'

// De productpagina als knooppunt (opzet 4 en 10, SPEC M en N). Bureau: de kop,
// de ketenstrook (elk vak springt naar zijn blok), de etiketkaart, en twee
// kolommen in ketenvolgorde — Maken (recept, brouwsels) | Verkopen (voorraad,
// artikelen, open bestellingen) — vanaf 1280 px naast elkaar, smaller onder
// elkaar. Telefoon: de kop als kaart, de sticky segmentstrook Voorraad ·
// Etiket · Brouwsels · Artikelen en per segment onderin zijn eigen actie
// (Etiket bijwerken, Nieuwe batch, Artikel toevoegen) — in Voorraad geen: daar
// staat uitslaan per lotregel.

export interface ProductDetailProps {
  product: any
  telefoon: boolean
  ebc: number | null
  etiketRegel: { label: string; waarde: string }
  oordeel: ProductEtiketOordeel | null
  keten: KetenTeksten
  onBewerken: () => void
  /** ⋯ van de kop: uit roulatie, archiveren, verwijderen. */
  kopActies: RowActie[]
  /** Telefoon: het actieve segment (staat in de pagina). */
  segment: ProductSegment
  onSegment: (s: ProductSegment) => void

  /** De kaart "Etiket & website" (stand product). */
  etiketKaart: React.ReactNode
  /** Telefoon: de ActieBalk van het segment Etiket; zonder: geen balk. */
  onEtiketBijwerken?: () => void

  recepten: ProductRecepten<any>
  receptActies: RowActie[]
  onOpenRecept: (id: string) => void
  onReceptKoppelen: () => void

  brouwsels: BrouwselRegel[]
  tegels: TankTegelData[]
  onOpenBatch: (id: number) => void
  /** "Nieuwe batch" (F8); zonder prop geen knop. */
  onNieuweBatch?: () => void
  brouwselActies: RowActie[]
  brouwselRijActies: (r: BrouwselRegel) => RowActie[]
  koppelLijst?: React.ReactNode
  trend?: React.ReactNode

  voorraad: Omit<VoorraadKaartProps, 'telefoon' | 'id'>
  artikelen: Omit<ArtikelenKaartProps, 'onToevoegen' | 'id'>
  onArtikelToevoegen: () => void
  /** Het artikelformulier staat open: op de telefoon dan geen ActieBalk. */
  artikelFormOpen: boolean
  openBestellingen: OpenBestelling[]
  onAlleBestellingen: () => void
  onOpenBestelling: (id: number) => void

  /** "Zo staat hij op de website" (ingeklapt). */
  bierInfo: React.ReactNode
  /** "Logboek …" (ingeklapt); null zonder regels. */
  logboek: React.ReactNode

  vandaag: string
  verpakkingen: VerkoopVerpakking[]
}

const ID: Record<KetenVakId, string> = {
  recept: 'product-recept', brouwsels: 'product-brouwsels', etiket: 'product-etiket',
  voorraad: 'product-voorraad', verkoop: 'product-artikelen',
}

const ProductDetail: React.FC<ProductDetailProps> = (p) => {
  const naam = p.product?.naam || t('lbl_naamloos')

  const recept = (
    <ReceptKaart id={ID.recept} info={p.recepten} acties={p.receptActies} onOpenRecept={p.onOpenRecept} onKoppel={p.onReceptKoppelen} />
  )
  const brouwsels = (
    <BrouwselsKaart id={ID.brouwsels} regels={p.brouwsels} tegels={p.tegels} vandaag={p.vandaag} verpakkingen={p.verpakkingen}
      onOpenBatch={p.onOpenBatch} onNieuweBatch={p.onNieuweBatch} acties={p.brouwselActies} rijActies={p.brouwselRijActies}
      koppelLijst={p.koppelLijst} trend={p.trend} telefoon={p.telefoon} productNaam={naam} />
  )
  const open = (
    <OpenBestellingenKaart naam={naam} bestellingen={p.openBestellingen} onAlle={p.onAlleBestellingen} onOpen={p.onOpenBestelling} />
  )

  if (p.telefoon) {
    const s = p.segment
    return (
      <div className="space-y-3">
        <ProductKop product={p.product} ebc={p.ebc} etiketRegel={p.etiketRegel} oordeel={p.oordeel}
          onBewerken={p.onBewerken} acties={p.kopActies} telefoon onEtiket={() => p.onSegment('etiket')} />
        <SegmentStrook teksten={p.keten} actief={s} onKies={p.onSegment} naam={naam} />
        <div className="space-y-3 pt-1">
          {s === 'voorraad' && (
            <>
              <VoorraadKaart {...p.voorraad} telefoon id={ID.voorraad} />
              {p.tegels.length > 0 && (
                <section className="bg-white rounded-xl shadow-card px-4 py-3 space-y-2">
                  <h4 className="text-[15px] font-semibold text-gray-900">{t('product_komt_eraan')}</h4>
                  {p.tegels.map(tg => (
                    <TankTegel key={tg.k.batchId} tegel={tg} vandaag={p.vandaag} verpakkingen={p.verpakkingen} onOpen={p.onOpenBatch} zonderLabel />
                  ))}
                </section>
              )}
              {open}
              {p.logboek}
            </>
          )}
          {s === 'etiket' && (
            <>
              <div id={ID.etiket}>{p.etiketKaart}</div>
              {p.bierInfo}
              {p.onEtiketBijwerken && <ActieBalk label={t('etiket_actie_bijwerken')} onClick={p.onEtiketBijwerken} alleenTelefoon />}
            </>
          )}
          {s === 'brouwsels' && (
            <>
              {recept}
              {brouwsels}
              {p.onNieuweBatch && <ActieBalk label={t('product_nieuwe_batch')} onClick={p.onNieuweBatch} alleenTelefoon />}
            </>
          )}
          {s === 'artikelen' && (
            <>
              <ArtikelenKaart {...p.artikelen} id={ID.verkoop} />
              {!p.artikelFormOpen && <ActieBalk label={t('btn_artikel_toevoegen')} onClick={p.onArtikelToevoegen} alleenTelefoon />}
            </>
          )}
        </div>
      </div>
    )
  }

  const springNaar = (id: KetenVakId) => {
    const el = typeof document !== 'undefined' ? document.getElementById(ID[id]) : null
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-4">
      <ProductKop product={p.product} ebc={p.ebc} etiketRegel={p.etiketRegel} oordeel={p.oordeel}
        onBewerken={p.onBewerken} acties={p.kopActies} telefoon={false} />
      <KetenStrook teksten={p.keten} onVak={springNaar} />
      <div id={ID.etiket} className="scroll-mt-4">{p.etiketKaart}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        <div className="space-y-3 min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{t('product_maken')}</h3>
          {recept}
          {brouwsels}
        </div>
        <div className="space-y-3 min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{t('product_verkopen')}</h3>
          <VoorraadKaart {...p.voorraad} telefoon={false} id={ID.voorraad} />
          <ArtikelenKaart {...p.artikelen} onToevoegen={p.onArtikelToevoegen} id={ID.verkoop} />
          {open}
        </div>
      </div>
      {p.bierInfo}
      {p.logboek}
    </div>
  )
}

export default ProductDetail
