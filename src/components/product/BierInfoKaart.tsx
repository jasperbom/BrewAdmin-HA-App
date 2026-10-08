import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import Btn from '../ui/Btn'
import BierInfoWeergave from '../BierInfoWeergave'
import type { BierWeergaveInfo } from '../../utils/bierinfo'

// "Zo staat hij op de website" (ingeklapt onderaan, SPEC M): de foto's, de
// omschrijving en het bier zoals een drinker het ziet — de cijfers, het
// smaakprofiel, de tekstblokken (`bierInfoWeergave`: energie en ingrediënten
// van wat er gebrouwen is, met hun bron). Bewerken gaat met de knop in de kop
// van de pagina; is er nog niets ingevuld, dan staat de knop hier.

interface BierInfoKaartProps {
  product: any
  weergave: BierWeergaveInfo
  /** Zijn er bierinformatievelden ingevuld? Anders de lege staat met de knop. */
  heeftInfo: boolean
  open: boolean
  onToggle: () => void
  onInvullen: () => void
}

const BierInfoKaart: React.FC<BierInfoKaartProps> = ({ product, weergave, heeftInfo, open, onToggle, onInvullen }) => {
  const [foto, setFoto] = React.useState(0)
  const fotos: string[] = Array.isArray(product?.afbeeldingen) ? product.afbeeldingen : []
  return (
    <section className={`bg-white rounded-xl shadow-card ${open ? '' : 'overflow-hidden'}`}>
      <SectionHeader open={open} onToggle={onToggle} rounded={open ? 'top' : 'full'} title={t('product_website_titel')} />
      {open && (
        <div className="p-4 space-y-4">
          {(fotos.length > 0 || product?.categorie || product?.omschrijving || product?.notities) && (
            <div className="flex flex-col sm:flex-row gap-4">
              {fotos.length > 0 && (
                <div className="flex-shrink-0">
                  <img src={fotos[foto] || fotos[0]} alt="" className="w-40 h-40 rounded-xl object-cover" />
                  {fotos.length > 1 && (
                    <div className="flex mt-1 justify-center">
                      {/* Het bolletje is klein; de knop eromheen is een vingerbreed. */}
                      {fotos.map((_, i) => (
                        <button key={i} type="button" onClick={() => setFoto(i)} aria-label={t('product_foto_n').replace('{n}', String(i + 1))}
                          aria-current={foto === i ? 'true' : undefined}
                          className="min-w-tap min-h-tap sm:min-w-0 sm:min-h-0 sm:p-1 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                          <span className={`block w-2.5 h-2.5 rounded-full transition-colors ${foto === i ? '' : 'bg-gray-300'}`}
                            style={foto === i ? { backgroundColor: 'var(--t-accent)' } : undefined} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1.5">
                {product?.categorie && <div className="text-xs text-gray-500">{product.categorie}</div>}
                {product?.omschrijving && <div className="text-sm text-gray-700 break-words">{product.omschrijving}</div>}
                {product?.notities && <div className="text-xs text-gray-500 italic break-words">{product.notities}</div>}
              </div>
            </div>
          )}
          <BierInfoWeergave info={weergave.info} herkomst={weergave.herkomst} />
          {!heeftInfo && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-500">{t('bier_leeg_titel')}</p>
              <Btn onClick={onInvullen} s="sm" v="secondary">{t('bier_leeg_actie')}</Btn>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default BierInfoKaart
