import React from 'react'
import { t } from '../../i18n'
import Modal from '../ui/Modal'
import SearchInput from '../ui/SearchInput'
import Inp from '../ui/Inp'
import Btn from '../ui/Btn'
import BierKleur from '../ui/BierKleur'
import { productEbc } from '../../utils/bierKleur'
import { productenVoorBatchKeuze, productNaamBezet } from '../../utils/batchKeten'
import { tekstPastBijZoek } from '../../utils/receptGebruik'

// "Product kiezen" vanuit de ketenregel van een batch zonder product: de
// producten van zijn recept bovenaan, dan de andere (niet gearchiveerd), en
// *Nieuw product* — dat erft naam, stijl en recept van de batch, maar geen ABV
// en geen allergenen (die gaan via het etiket). Een tik op een product koppelt
// het meteen.

interface ProductKiezenModalProps {
  batch: any
  producten: any[]
  batches?: any[]
  recepten?: any[]
  /** De naam van een nieuw product als er niets getypt is. */
  standaardNaam: string
  onKies: (productId: number) => void
  /** Maak het nieuwe product (de naam is al gecontroleerd). */
  onNieuw: (naam: string) => void
  onClose: () => void
}

const ProductKiezenModal: React.FC<ProductKiezenModalProps> = ({
  batch, producten, batches, recepten, standaardNaam, onKies, onNieuw, onClose,
}) => {
  const [zoek, setZoek] = React.useState('')
  const [naam, setNaam] = React.useState('')
  const [fout, setFout] = React.useState<string | null>(null)
  const keuzes = productenVoorBatchKeuze(batch, producten, { batches, recepten })
  const zichtbaar = keuzes.filter(k => tekstPastBijZoek([k.product.naam, k.product.stijl], zoek))
  const vanRecept = zichtbaar.filter(k => k.vanRecept)
  const overig = zichtbaar.filter(k => !k.vanRecept)

  const maak = () => {
    const n = naam.trim() || standaardNaam.trim()
    if (!n) { setFout(t('err_product_naam_leeg')); return }
    if (productNaamBezet(n, producten)) { setFout(t('err_product_naam_duplicaat')); return }
    onNieuw(n)
  }

  const rij = (p: any) => (
    <button key={p.id} type="button" onClick={() => onKies(Number(p.id))}
      className="w-full flex items-center gap-2.5 min-h-tap md:min-h-[40px] px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]">
      <BierKleur ebc={productEbc(p, recepten || [])} s="sm" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800 break-words">{p.naam || t('lbl_naamloos')}</span>
        {p.stijl && <span className="block text-xs text-gray-500 break-words">{p.stijl}</span>}
      </span>
      {p.uit_roulatie && <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]">{t('bier_veld_uit_roulatie')}</span>}
    </button>
  )

  return (
    <Modal title={t('keten_kies_titel')} onClose={onClose}>
      <div className="space-y-4">
        {keuzes.length > 8 && <SearchInput value={zoek} onChange={setZoek} placeholder={t('keten_kies_zoek')} />}
        {vanRecept.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-gray-800">{t('keten_groep_recept')}</div>
            {vanRecept.map(k => rij(k.product))}
          </div>
        )}
        {overig.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-gray-800">{vanRecept.length ? t('keten_groep_overig') : t('nav_producten')}</div>
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto overflow-x-hidden">{overig.map(k => rij(k.product))}</div>
          </div>
        )}
        {zichtbaar.length === 0 && (
          <p className="text-sm text-gray-500">{keuzes.length ? t('keten_kies_geen_resultaat') : t('keten_kies_leeg')}</p>
        )}
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <div className="text-sm font-semibold text-gray-800">{t('keten_product_nieuw')}</div>
          <p className="text-xs text-gray-500">{t('keten_product_nieuw_hint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Inp value={naam} onChange={(v: string) => { setNaam(v); setFout(null) }} placeholder={standaardNaam}
              ariaLabel={t('keten_product_nieuw_naam')} cls="flex-1 min-w-[12rem]" />
            <Btn onClick={maak}>{t('keten_kies_nieuw_knop')}</Btn>
          </div>
          {fout && <div role="alert" className="text-xs px-2 py-1.5 rounded border border-orange-200 bg-orange-50 text-orange-700">{fout}</div>}
        </div>
      </div>
    </Modal>
  )
}

export default ProductKiezenModal
