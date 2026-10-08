import React from 'react'
import { t, getLang } from '../../i18n'
import SearchInput from '../ui/SearchInput'
import BierKleur from '../ui/BierKleur'
import Icon from '../ui/Icon'
import { fmtAbv } from '../../utils/etiket'
import { lijstChips } from '../../utils/productPagina'
import type { ProductEtiketOordeel, ProductLijstGroepen } from '../../utils/productPagina'
import type { VoorraadVerpakking } from '../../utils/verkoopOverzicht'
import type { ChipTekst } from '../../utils/verkoopDashboard'

// De productlijst (SPEC M: 280 px links op het bureau; op de telefoon de
// lijst vóór het detailscherm): per bier de stip, de naam, de alcohol en per
// verpakking wat er ligt ("Fles 46", "Fles 120 · AGP 480", "Fust AGP 3") —
// de telling van het Overzicht (`voorraadPerProduct`), nooit flessen en
// fusten opgeteld — met een rode chip bij een tekort en de etiketchip als het
// etiket niet klopt of nog niet is vastgelegd. Groepen: Op voorraad, Zonder
// voorraad; Uit roulatie en Gearchiveerd ingeklapt.

interface ProductLijstProps {
  groepen: ProductLijstGroepen<any>
  voorraadVan: (id: number) => VoorraadVerpakking[]
  etiketVan: (id: number) => ProductEtiketOordeel | null
  ebcVan: (p: any) => number | null
  sel: number | null
  onKies: (id: number) => void
  zoek: string
  onZoek: (z: string) => void
  /** Er zijn helemaal geen producten (los van de zoektekst). */
  geenProducten: boolean
}

const CHIP: Record<ChipTekst['kleur'], string> = {
  grijs: 'bg-gray-100 text-gray-700',
  rood: 'bg-red-100 text-red-700',
  oranje: 'bg-orange-100 text-orange-800',
  groen: 'bg-green-100 text-green-700',
}

const ProductLijst: React.FC<ProductLijstProps> = ({ groepen, voorraadVan, etiketVan, ebcVan, sel, onKies, zoek, onZoek, geenProducten }) => {
  const taal = getLang()
  const bevat = (lijst: any[]) => sel != null && lijst.some(p => p.id === sel)
  const [uitOpen, setUitOpen] = React.useState(() => bevat(groepen.uitRoulatie))
  const [archiefOpen, setArchiefOpen] = React.useState(() => bevat(groepen.gearchiveerd))
  // Een product uit een ingeklapte groep geopend (link, terugknop): klap open.
  React.useEffect(() => {
    if (bevat(groepen.uitRoulatie)) setUitOpen(true)
    if (bevat(groepen.gearchiveerd)) setArchiefOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const rij = (p: any, gedimd = false) => {
    const chips = lijstChips(voorraadVan(p.id), t)
    const etiket = etiketVan(p.id)
    if (etiket && etiket.status.kleur !== 'groen') chips.push({ tekst: etiket.tekst, kleur: etiket.status.kleur })
    const abv = fmtAbv(p.abv, taal).replace(/\s*vol$/, '')
    const gekozen = sel === p.id
    return (
      <li key={p.id}>
        <button type="button" onClick={() => onKies(p.id)} aria-current={gekozen ? 'true' : undefined}
          className={`w-full text-left px-4 py-2.5 border-b border-gray-100 t-hover transition-colors border-l-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${gekozen ? 't-sel' : 'border-l-transparent'}`}>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <BierKleur ebc={ebcVan(p)} s="md" />
              <span className={`text-sm font-semibold truncate ${gedimd ? 'text-gray-500' : 'text-gray-900'}`}>{p.naam || t('lbl_naamloos')}</span>
            </span>
            {abv && <span className="text-xs text-gray-500 flex-shrink-0">{abv}</span>}
          </span>
          {chips.length > 0 && (
            <span className="mt-1 pl-6 flex flex-wrap gap-1">
              {chips.map((c, i) => (
                <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${CHIP[c.kleur]}`}>{c.tekst}</span>
              ))}
            </span>
          )}
        </button>
      </li>
    )
  }

  const groepKop = (titel: string) => (
    <div className="px-4 pt-3 pb-1.5 text-sm font-semibold text-gray-800 border-b border-gray-100">{titel}</div>
  )
  const klapKop = (titel: string, n: number, open: boolean, wissel: () => void) => (
    <button type="button" onClick={wissel} aria-expanded={open}
      className="w-full flex items-center gap-1.5 px-4 min-h-tap text-sm font-medium text-gray-700 hover:bg-gray-50 border-b border-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
      <Icon n="chevronRight" cls={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      {titel.replace('{n}', String(n))}
    </button>
  )

  const niets = !groepen.opVoorraad.length && !groepen.zonderVoorraad.length && !groepen.uitRoulatie.length && !groepen.gearchiveerd.length
  return (
    <div>
      <div className="mb-2">
        <SearchInput value={zoek} onChange={onZoek} placeholder={t('ph_product_zoek')} />
      </div>
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        {niets && (
          <p className="p-6 text-center text-gray-500 text-sm">{geenProducten ? t('lbl_geen_producten') : t('keten_kies_geen_resultaat')}</p>
        )}
        {groepen.opVoorraad.length > 0 && (<>{groepKop(t('product_groep_op_voorraad'))}<ul>{groepen.opVoorraad.map(p => rij(p))}</ul></>)}
        {groepen.zonderVoorraad.length > 0 && (<>{groepKop(t('product_groep_zonder_voorraad'))}<ul>{groepen.zonderVoorraad.map(p => rij(p))}</ul></>)}
        {groepen.uitRoulatie.length > 0 && (
          <>
            {klapKop(t('product_groep_uit_roulatie'), groepen.uitRoulatie.length, uitOpen, () => setUitOpen(o => !o))}
            {uitOpen && <ul>{groepen.uitRoulatie.map(p => rij(p, true))}</ul>}
          </>
        )}
        {groepen.gearchiveerd.length > 0 && (
          <>
            {klapKop(t('product_groep_gearchiveerd'), groepen.gearchiveerd.length, archiefOpen, () => setArchiefOpen(o => !o))}
            {archiefOpen && <ul>{groepen.gearchiveerd.map(p => rij(p, true))}</ul>}
          </>
        )}
      </div>
    </div>
  )
}

export default ProductLijst
