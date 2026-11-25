import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtSg, fmtDagMaand } from '../../utils/format'
import { fmtGetal } from '../../utils/etiket'
import type { Kerncijfers } from '../../utils/batchKerncijfers'

// Bovenaan Vergisten en Conditioneren: de cijfers die tellen (SG, vergist,
// temperatuur, alcohol tot nu) en daaronder de grafiek. Een cijfer zonder
// meting staat er niet; zonder één cijfer en zonder grafiek geen kaart.
// Wat er staat rekent utils/batchKerncijfers.ts uit.

interface Props {
  cijfers: Kerncijfers
  og: number | null
  /** De grafiek (FermentatieGrafiek), alleen met minstens twee metingen. */
  grafiek?: React.ReactNode
  /** Zonder "alcohol tot nu": in Conditioneren staat de alcohol al in de
   *  regel "Alcohol voor accijns en THT" — één plek, geen tweede getal. */
  zonderAbv?: boolean
}

const Cijfer: React.FC<{ waarde: string; label: string }> = ({ waarde, label }) => (
  <div className="flex flex-col-reverse gap-0.5 min-w-0">
    <dt className="text-xs text-gray-600 break-words">{label}</dt>
    <dd className="cijfer text-[28px] leading-tight font-bold text-gray-900 whitespace-nowrap">{waarde}</dd>
  </div>
)

const KernKaart: React.FC<Props> = ({ cijfers, og, grafiek, zonderAbv = false }) => {
  const taal = getLang()
  const { sg, vergist, temp } = cijfers
  const abv = zonderAbv ? null : cijfers.abv
  const leeg = !sg && vergist == null && !temp && abv == null
  if (leeg && !grafiek) return null
  // Op een breed scherm de cijfers links en de grafiek ernaast: zo blijft de
  // grafiek leesbaar en niet een halve pagina hoog.
  const naast = !leeg && !!grafiek
  const wanneer = sg ? fmtDagMaand(sg.datum ? `${sg.datum}T${sg.tijd || '00:00'}` : null, { tijd: !!sg.tijd }) : ''
  const graden = (n: number) => `${fmtGetal(n, 1, taal)} °C`
  return (
    <section aria-label={t('kern_titel')}
      className={`rounded-xl border border-gray-200 bg-white ${naast ? 'lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-center' : ''}`}>
      {!leeg && (
        <dl className={`grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 p-4 ${naast ? 'lg:grid-cols-2 lg:gap-y-5' : ''}`}>
          {sg && <Cijfer waarde={fmtSg(sg.waarde)} label={wanneer ? t('kern_sg_op').replace('{wanneer}', wanneer) : t('kern_sg')} />}
          {vergist != null && (
            <Cijfer waarde={`${Math.round(vergist)} %`}
              label={og != null ? t('kern_vergist_og').replace('{og}', fmtSg(og)) : t('kern_vergist')} />
          )}
          {temp && (
            <Cijfer waarde={graden(temp.waarde)}
              label={[
                t(temp.bron === 'sensor' ? 'kern_temp_tank' : 'kern_temp_meting'),
                temp.doel != null ? t('kern_temp_doel').replace('{doel}', graden(temp.doel)) : '',
              ].filter(Boolean).join(' · ')} />
          )}
          {abv != null && <Cijfer waarde={`${fmtGetal(abv, 1, taal)} %`} label={t('kern_abv')} />}
        </dl>
      )}
      {grafiek && <div className={`px-2 pb-2 ${leeg ? 'pt-2' : 'lg:pt-2'}`}>{grafiek}</div>}
    </section>
  )
}

export default KernKaart
