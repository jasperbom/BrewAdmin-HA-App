import React from 'react'
import { t } from '../../i18n'
import { fmtD } from '../../utils/format'
import { bfBatchDatum, bfBatchNaam } from '../../utils/bfKoppeling'
import Btn from '../ui/Btn'
import StatusPil from '../ui/StatusPil'

// Batches › Lopend: lopende Brewfather-batches die nog aan geen batch hangen
// (`bfNieuweBatches`, utils/bfKoppeling.ts). *Plannen* opent "Wat brouw je?"
// met het recept en de brouwdag al ingevuld; de nieuwe batch krijgt daarna de
// koppeling. Hoort de Brewfather-batch bij een batch die er al is, dan koppel
// je hem op die batch (⋯ → Koppel aan Brewfather).

interface BfNieuwKaartProps {
  batches: any[]
  onPlan: (bf: any) => void
  /** De batch die hier al bestaat en erbij hoort (`bfVoorstelBatch`): dan koppelen i.p.v. plannen. */
  voorstelVoor?: (bf: any) => { id: number, label: string } | null
  onKoppel?: (bf: any, batchId: number) => void
}

const BF_STATUS_LABEL: Record<string, string> = {
  Planning: 'status_planning', Brewing: 'status_brewing', Fermenting: 'status_fermenting', Conditioning: 'status_conditioning',
}
const MAX = 5

const BfNieuwKaart: React.FC<BfNieuwKaartProps> = ({ batches, onPlan, voorstelVoor, onKoppel }) => {
  const [alles, setAlles] = React.useState(false)
  const lijst = alles ? batches : batches.slice(0, MAX)
  return (
    <section aria-labelledby="bf-nieuw-kop" className="bg-white rounded-xl shadow-card p-4 space-y-2">
      <div>
        <h3 id="bf-nieuw-kop" className="text-[15px] font-semibold text-gray-900">
          {t('bf_nieuw_titel')} <span className="font-normal text-gray-500">{batches.length}</span>
        </h3>
        <p className="text-sm text-gray-600">{t('bf_nieuw_tekst')}</p>
      </div>
      <ul className="divide-y divide-gray-200">
        {lijst.map(bf => {
          const datum = bfBatchDatum(bf)
          const voorstel = onKoppel ? voorstelVoor?.(bf) ?? null : null
          return (
            <li key={bf._id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900 break-words">{bfBatchNaam(bf) || t('lbl_naamloos')}</span>
                  {bf.batchNo != null && <span className="text-sm text-gray-500 cijfer">#{bf.batchNo}</span>}
                  <StatusPil kleur="blauw">{t(BF_STATUS_LABEL[bf.status] || '', bf.status)}</StatusPil>
                </div>
                {datum && <p className="text-sm text-gray-600">{t('bf_koppel_brouwdag').replace('{datum}', fmtD(datum))}</p>}
              </div>
              {voorstel && onKoppel
                ? <Btn v="secondary" s="sm" onClick={() => onKoppel(bf, voorstel.id)}>{t('bf_nieuw_koppel_aan').replace('{batch}', voorstel.label)}</Btn>
                : <Btn v="secondary" s="sm" onClick={() => onPlan(bf)}>{t('bf_nieuw_plannen')}</Btn>}
            </li>
          )
        })}
      </ul>
      {batches.length > MAX && (
        <button type="button" onClick={() => setAlles(a => !a)}
          className="text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
          {alles ? t('bf_nieuw_minder') : t('bf_nieuw_meer').replace('{n}', String(batches.length - MAX))}
        </button>
      )}
    </section>
  )
}

export default BfNieuwKaart
