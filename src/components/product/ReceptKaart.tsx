import React from 'react'
import { t } from '../../i18n'
import SectionHeader from '../ui/SectionHeader'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import Btn from '../ui/Btn'
import { ReceptChip } from '../recept/ReceptRij'
import type { ProductRecepten } from '../../utils/productPagina'

// Het recept van een product (SPEC M ④, Maken): het huidige recept als link
// naar Productie › Recepten, met waarom het huidig is (vastgezet, laatst
// gebrouwen, het enige), daaronder de eerdere recepten. In ⋯: vastzetten als
// huidig, een ander recept als huidig, een recept koppelen.

export interface ReceptKaartProps {
  info: ProductRecepten<any>
  onOpenRecept: (id: string) => void
  /** Vastzetten, opheffen, ander recept als huidig, koppelen. */
  acties: RowActie[]
  /** Zonder recept: de knop "Recept koppelen". */
  onKoppel?: () => void
  id?: string
}

const BRON_SLEUTEL: Record<string, string> = {
  vastgezet: 'product_recept_bron_vastgezet',
  laatst_gebrouwen: 'product_recept_bron_laatst_gebrouwen',
  enige: 'product_recept_bron_enige',
  eerste: 'product_recept_bron_eerste',
}

const ReceptLink: React.FC<{ onClick: () => void; children: React.ReactNode; klein?: boolean }> = ({ onClick, children, klein }) => (
  <button type="button" onClick={onClick}
    className={`text-left t-accent-text hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${klein ? 'font-medium' : 'font-semibold min-h-tap md:min-h-0'}`}>
    {children}
  </button>
)

const ReceptKaart: React.FC<ReceptKaartProps> = ({ info, onOpenRecept, acties, onKoppel, id }) => {
  const { huidig, eerder, bron } = info
  return (
    <section id={id} className="bg-white rounded-xl shadow-card overflow-hidden scroll-mt-4">
      <SectionHeader title={t('product_keten_recept')} />
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {huidig ? (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ReceptLink onClick={() => onOpenRecept(String(huidig.id))}>
                  {huidig.naam || t('lbl_naamloos')}{' ›'}
                </ReceptLink>
                <ReceptChip soort="huidig">{t(BRON_SLEUTEL[bron] || 'recept_chip_huidig')}</ReceptChip>
              </div>
              {eerder.length > 0 && (
                <p className="text-sm text-gray-600 mt-1 break-words">
                  {eerder.length === 1 ? t('product_recept_eerder_1') : t('product_recept_eerder_n').replace('{n}', String(eerder.length))}{' '}
                  {eerder.map((r, i) => (
                    <React.Fragment key={r.id}>
                      {i > 0 && ', '}
                      <ReceptLink klein onClick={() => onOpenRecept(String(r.id))}>{r.naam || t('lbl_naamloos')}</ReceptLink>
                    </React.Fragment>
                  ))}
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-gray-600">{t('product_recept_geen')}</p>
              {onKoppel && <Btn v="secondary" s="sm" onClick={onKoppel}>{t('btn_koppel_recept')}</Btn>}
            </div>
          )}
        </div>
        {huidig && acties.length > 0 && <RowActions v="kaart" acties={acties} />}
      </div>
    </section>
  )
}

export default ReceptKaart
