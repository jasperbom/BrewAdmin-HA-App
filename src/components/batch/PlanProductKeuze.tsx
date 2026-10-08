import React from 'react'
import { t } from '../../i18n'
import BierKleur from '../ui/BierKleur'
import Inp from '../ui/Inp'
import { productEbc } from '../../utils/bierKleur'
import type { PlanProduct, ProductKeuzeWaarde } from '../../utils/batchKeten'

// Het product bij een nieuwe batch (en bij *Recept opnieuw toepassen*), onder
// de receptkeuze. Wat er gebeurt komt uit `productBijPlannen`
// (utils/batchKeten.ts):
// - het recept hoort bij één product → dat product, "automatisch" (na het
//   plannen met een terugweg in de UndoBar);
// - bij meer → een keuze uit die producten, of *Later*;
// - bij geen → *Nieuw product* (naam, stijl en recept erven; geen ABV en geen
//   allergenen) of *Later*;
// - de batch heeft al een product → dat blijft.
// Niets gekozen = *Later* (bij één kandidaat: automatisch).

interface PlanProductKeuzeProps {
  plan: PlanProduct<any> | null
  keuze: ProductKeuzeWaarde | null
  onKeuze: (k: ProductKeuzeWaarde | null) => void
  /** De naam van een nieuw product als er niets getypt is (de receptnaam). */
  standaardNaam: string
  /** Voor de bierkleur. */
  recepten?: any[]
  /** Alle producten: een vooraf gekozen product dat geen kandidaat is, blijft zichtbaar. */
  producten?: any[]
}

const Rij: React.FC<{ naam: string; gekozen: boolean; onKies: () => void; children: React.ReactNode }> = ({ naam, gekozen, onKies, children }) => (
  <label className={`flex items-center gap-2.5 min-h-tap md:min-h-[36px] px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
    gekozen ? 'border-[color:var(--t-accent-edge,var(--t-accent))] bg-[color:var(--t-pale)]' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
    <input type="radio" name={naam} checked={gekozen} onChange={onKies} className="t-checkbox w-4 h-4 flex-shrink-0" />
    <span className="flex-1 min-w-0 flex items-center gap-2 text-sm text-gray-800">{children}</span>
  </label>
)

const ProductNaam: React.FC<{ p: any; recepten?: any[] }> = ({ p, recepten }) => (
  <>
    <BierKleur ebc={productEbc(p, recepten || [])} s="sm" />
    <span className="min-w-0 break-words font-medium">{p.naam || t('lbl_naamloos')}</span>
    {p.stijl && <span className="text-xs text-gray-500 min-w-0 break-words">{p.stijl}</span>}
    {p.uit_roulatie && <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]">{t('bier_veld_uit_roulatie')}</span>}
  </>
)

const PlanProductKeuze: React.FC<PlanProductKeuzeProps> = ({ plan, keuze, onKeuze, standaardNaam, recepten, producten }) => {
  const groep = React.useId()
  if (!plan) return null
  const label = <div className="text-sm font-medium text-gray-700 mb-1">{t('keten_product')}</div>

  const vast = plan.soort === 'behouden' || (plan.soort === 'een' &&
    (!keuze || (keuze.soort === 'product' && Number(keuze.productId) === Number(plan.product.id))))
  if (vast) {
    return (
      <div>
        {label}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-800">
          <ProductNaam p={plan.product} recepten={recepten} />
          <span className="text-xs text-gray-500 basis-full">
            {plan.soort === 'behouden' ? t('keten_product_blijft') : t('keten_product_auto')}
          </span>
        </div>
      </div>
    )
  }

  const kandidaten: any[] = plan.soort === 'meer' ? plan.kandidaten : plan.soort === 'een' ? [plan.product] : []
  // Een product dat vooraf gekozen was (bijv. *Nieuwe batch* op een product)
  // maar niet bij dit recept hoort, blijft als keuze staan.
  const vooraf = keuze?.soort === 'product' && !kandidaten.some(p => Number(p.id) === Number(keuze.productId))
    ? (producten || []).find(p => Number(p.id) === Number(keuze.productId)) : null
  const lijst = vooraf ? [vooraf, ...kandidaten] : kandidaten
  const later = !keuze || keuze.soort === 'later'
  const nieuw = keuze?.soort === 'nieuw' ? keuze : null
  return (
    <div>
      {label}
      {plan.soort !== 'een' && (
        <p className="text-xs text-gray-500 mb-1.5">
          {plan.soort === 'meer'
            ? t('keten_product_meer').replace('{n}', String(plan.kandidaten.length))
            : t('keten_product_geen')}
        </p>
      )}
      <div className="space-y-1.5">
        {lijst.map(p => (
          <Rij key={p.id} naam={groep} gekozen={keuze?.soort === 'product' && Number(keuze.productId) === Number(p.id)}
            onKies={() => onKeuze({ soort: 'product', productId: Number(p.id) })}>
            <ProductNaam p={p} recepten={recepten} />
          </Rij>
        ))}
        {plan.soort === 'geen' && (
          <Rij naam={groep} gekozen={!!nieuw} onKies={() => onKeuze({ soort: 'nieuw', naam: '' })}>
            <span className="font-medium">{t('keten_product_nieuw')}</span>
          </Rij>
        )}
        {nieuw && (
          <div className="pl-7 space-y-1">
            <Inp value={nieuw.naam} onChange={(v: string) => onKeuze({ soort: 'nieuw', naam: v })}
              placeholder={standaardNaam} ariaLabel={t('keten_product_nieuw_naam')} />
            <p className="text-xs text-gray-500">{t('keten_product_nieuw_hint')}</p>
          </div>
        )}
        <Rij naam={groep} gekozen={later} onKies={() => onKeuze({ soort: 'later' })}>
          <span>{t('keten_product_later')}</span>
        </Rij>
      </div>
    </div>
  )
}

export default PlanProductKeuze
