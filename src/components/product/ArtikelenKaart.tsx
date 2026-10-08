import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import Btn from '../ui/Btn'
import { fmt } from '../../utils/format'
import { margeVoorPrijs } from '../../utils/productPagina'
import type { KostprijsStuk } from '../../utils/productPagina'

// De artikelen van een bier (SPEC M ④ Verkopen, N segment Artikelen): per
// verpakking de SKU, de prijzen, de kostprijs van één eenheid en de marge,
// en of hij naar de webshop gaat. Bovenaan de ene kostprijs per liter van dit
// bier met zijn bron; de kostprijs per eenheid is dat bier × inhoud plus de
// eigen verpakking (`kostprijsPerStuk`), nooit prijs-per-liter × inhoud.

export interface ArtikelenKaartProps {
  artikelen: any[]
  /** Kostprijs van het bier per liter, zonder verpakking (0 = onbekend). */
  perLiter: number
  /** Waar die kostprijs op rust (`kostprijsBronTekst`). */
  bron: string
  kostPerStuk: (a: any) => KostprijsStuk | null
  /** WooCommerce staat aan: dan de chip "webshop ✓" / "niet in webshop". */
  webshopAan: boolean
  rijActies: (a: any) => { primair: RowActie; acties: RowActie[] }
  /** Badge bij een SKU die een ander artikel ook draagt. */
  skuBadge: (a: any) => React.ReactNode
  /** Het artikelformulier, als dat open staat. */
  formulier?: React.ReactNode
  /** Zonder (telefoon: de ActieBalk): geen knop in de kop. */
  onToevoegen?: () => void
  id?: string
}

const ArtikelenKaart: React.FC<ArtikelenKaartProps> = (p) => (
  <section id={p.id} className="bg-white rounded-xl shadow-card overflow-hidden scroll-mt-4">
    <SectionHeader title={t('product_artikelen_titel')}
      info={p.onToevoegen ? <Btn s="sm" v="secondary" onClick={p.onToevoegen}>{t('btn_artikel_toevoegen')}</Btn> : undefined} />
    <p className="px-4 pt-2.5 text-[13px] text-gray-600 break-words">
      {p.perLiter > 0 && (
        <span className="font-medium text-gray-800">{t('product_kostprijs_regel').replace('{bedrag}', fmt(p.perLiter))} · </span>
      )}
      {p.perLiter > 0 ? p.bron : `${t('product_kostprijs_label')}: ${p.bron}`}
    </p>
    {p.formulier}
    {p.artikelen.length === 0 && !p.formulier && (
      <p className="px-4 py-3 text-sm text-gray-500">{t('lbl_geen_product_artikelen')}</p>
    )}
    <ul className="divide-y divide-gray-100 mt-1">
      {p.artikelen.map(a => {
        const kost = p.kostPerStuk(a)
        const cons = kost ? margeVoorPrijs(kost.kost, Number(a.verkoopprijs || 0)) : null
        const b2b = kost ? margeVoorPrijs(kost.kost, Number(a.b2b_prijs || 0)) : null
        const wcAan = a.wc_push !== false
        const delen: React.ReactNode[] = [
          a.verkoopprijs ? fmt(a.verkoopprijs) : t('product_geen_prijs'),
          ...(a.b2b_prijs ? [`${t('lbl_b2b')} ${fmt(a.b2b_prijs)}`] : []),
          ...(a.btw_pct != null && a.btw_pct !== '' ? [t('product_btw_pct').replace('{n}', String(a.btw_pct))] : []),
          ...(kost ? [t('product_kostprijs_stuk').replace('{bedrag}', fmt(kost.kost))] : []),
          ...(cons ? [<span key="m" className={cons.eur >= 0 ? 'text-green-700' : 'text-red-600'}>{t('product_marge_pct').replace('{n}', cons.pct.toFixed(0))}</span>] : []),
          ...(b2b ? [<span key="b" className={b2b.eur >= 0 ? 'text-green-700' : 'text-red-600'}>{t('product_marge_b2b_pct').replace('{n}', b2b.pct.toFixed(0))}</span>] : []),
        ]
        const { primair, acties } = p.rijActies(a)
        return (
          <li key={a.id} className="px-4 py-2.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">{a.verpakking_naam || t('lbl_onbekend')}</span>
                <span className="font-mono text-xs text-gray-600">{a.artikelnummer || '—'}</span>
                {p.skuBadge(a)}
                {a.gn_code && <span className="text-xs text-gray-500">{t('lbl_gn_code')} {a.gn_code}</span>}
                {p.webshopAan && a.artikelnummer && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${wcAan ? 'bg-green-50 text-green-700 ring-1 ring-green-200' : 'bg-gray-100 text-gray-600'}`}
                    title={wcAan ? t('tip_artikel_wc_push_aan') : t('tip_artikel_wc_push_uit')}>
                    {wcAan ? t('product_webshop_aan') : t('product_webshop_uit')}
                  </span>
                )}
              </div>
              <div className="text-[13px] text-gray-700 mt-0.5 break-words">
                {delen.map((d, i) => <React.Fragment key={i}>{i > 0 && ' · '}{d}</React.Fragment>)}
              </div>
            </div>
            <RowActions v="kaart" primair={primair} acties={acties} cls="flex-shrink-0" />
          </li>
        )
      })}
    </ul>
  </section>
)

export default ArtikelenKaart
