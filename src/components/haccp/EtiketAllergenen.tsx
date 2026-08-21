import React from 'react'
import { t } from '../../i18n'
import { ALLERGENEN_LIJST } from '../../utils/constants'
import Btn from '../ui/Btn'

// De etiketallergenen van een product vastleggen op de plek waar CCP 3 erom
// vraagt. Zonder vastgelegde lijst blokkeert de etiketcontrole, en de afvuller
// midden in een sessie naar een andere pagina sturen is de zekerste manier om
// die controle te laten verwateren of te laten omzeilen met een afwijking.
//
// Bewust géén "neem over uit het recept"-knop: dan maakt de vergelijking
// zichzelf gelijk en meet CCP 3 niets meer. Wat hier aangevinkt wordt is wat
// er op het etiket in de hand staat.

interface Props {
  product: any
  onOpslaan: (allergenen: string[]) => void
}

const EtiketAllergenen: React.FC<Props> = ({product, onOpslaan}) => {
  const gezet = Array.isArray(product?.allergenen)
  const [open, setOpen] = React.useState(!gezet)
  const [sel, setSel] = React.useState<string[]>(product?.allergenen || [])

  // Bij een ander product horen andere vinkjes — die van het vorige product
  // mogen niet blijven staan en per ongeluk als etiket vastgelegd worden.
  React.useEffect(() => {
    setSel(Array.isArray(product?.allergenen) ? product.allergenen : [])
    setOpen(!Array.isArray(product?.allergenen))
  }, [product?.id])

  if (!product) return null

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs font-medium underline underline-offset-2"
        style={{color: 'var(--t-accent)'}}>
        {t('haccp_ccp3_etiket_bijwerken')}
      </button>
    )
  }

  const toggle = (key: string, aan: boolean) => {
    const set = new Set(sel)
    aan ? set.add(key) : set.delete(key)
    setSel(Array.from(set))
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        {t('haccp_ccp3_etiket_vastleggen')}
      </div>
      <p className="text-xs text-gray-500">{t('haccp_ccp3_etiket_vastleggen_uitleg')}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {ALLERGENEN_LIJST.map(a => (
          <label key={a.key} className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={sel.includes(a.key)}
              onChange={e => toggle(a.key, e.target.checked)} />
            {t(a.label)}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {gezet && (
          <button type="button"
            onClick={() => {
              setSel(Array.isArray(product?.allergenen) ? product.allergenen : [])
              setOpen(false)
            }}
            className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">
            {t('btn_cancel')}
          </button>
        )}
        <Btn s="sm" onClick={() => { onOpslaan(sel); setOpen(false) }}>
          {t('haccp_ccp3_etiket_opslaan')}
        </Btn>
      </div>
    </div>
  )
}

export default EtiketAllergenen
