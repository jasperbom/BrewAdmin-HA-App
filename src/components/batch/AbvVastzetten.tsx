import React from 'react'
import { t, getLang } from '../../i18n'
import { abvVastzetten, fmtAbv } from '../../utils/etiket'
import type { AbvWaarde } from '../../utils/etiket'
import type { Batch } from '../../types'
import Btn from '../ui/Btn'
import BevestigKnop from '../ui/BevestigKnop'

// De regel "Alcohol voor accijns en THT" in Conditioneren (opzet 5.3): de
// berekende ABV (Balling) met zijn bron, de knop *ABV vastzetten* en de link
// *Labwaarde invoeren*. Vastzetten is verplicht vóór de eerste afvulsessie,
// want de voorcalculatie bij het afvullen, de uitslagaccijns, het
// accijnsrecord en de THT-klasse lezen `batch.ABV`.
//
// Het is de enige plek waar de ABV van een batch wordt vastgelegd — het
// vroegere invulveld "Alcohol %" met "Bevestig definitief" is hierin opgegaan.
// Een batch die het oude vinkje al had (abv_definitief + ABV) is vastgezet.

export interface AbvVastzettenProps {
  /** `etiketWaarden(batch).abv`: waarde, bron en bronketen. */
  abv: AbvWaarde
  /** Vastzetten met het patch-deel van `abvVastzetten` (ABV, abv_definitief, abv_bron). */
  onVastzetten: (patch: Required<Pick<Batch, 'ABV' | 'abv_definitief' | 'abv_bron'>>) => void
  /** Een vastgezette ABV weer losmaken (corrigeren). */
  onLosmaken: () => void
  /** Er is al afgevuld: de voorcalculatie op die afvullingen blijft staan. */
  heeftAfvullingen?: boolean
  /** Het labveld openen van buitenaf (⋯ "ABV handmatig (lab)" op de kaart). */
  labOpen?: boolean
  onLabOpen?: (open: boolean) => void
  alleenLezen?: boolean
}

const AbvVastzetten: React.FC<AbvVastzettenProps> = ({
  abv, onVastzetten, onLosmaken, heeftAfvullingen = false, labOpen: labOpenProp, onLabOpen, alleenLezen = false,
}) => {
  const taal = getLang()
  const [labEigen, setLabEigen] = React.useState(false)
  const labOpen = labOpenProp ?? labEigen
  const zetLab = (open: boolean) => { if (onLabOpen) onLabOpen(open); else setLabEigen(open) }
  const [lab, setLab] = React.useState('')
  const [fout, setFout] = React.useState<string | null>(null)
  const labRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => { if (labOpen) labRef.current?.focus() }, [labOpen])

  const waarde = fmtAbv(abv.waarde, taal)
  const bronTekst = (() => {
    if (abv.vastgezet) {
      const herkomst = abv.vastgezetBron === 'lab' ? t('etiket_bron_abv_lab')
        : abv.vastgezetBron === 'brewfather' ? t('etiket_bron_abv_brewfather')
        : abv.vastgezetBron === 'recept' ? t('etiket_bron_abv_verwacht')
        : abv.vastgezetBron === 'berekend' ? t('etiket_bron_abv_balling')
        : abv.vastgezetBron === 'handmatig' ? t('etiket_bron_abv_handmatig')
        : ''
      return [t('etiket_bron_abv_vastgezet'), herkomst].filter(Boolean).join(' · ')
    }
    if (abv.bron === 'berekend') {
      return [t(abv.berekend && abv.berekend.suikerPct > 0 ? 'abv_vast_bron_balling_suiker' : 'etiket_bron_abv_balling'),
        t('etiket_zonder_hergisting')].join(' · ')
    }
    if (abv.bron === 'geen') return t('abv_vast_geen_waarde')
    return t(abv.bronSleutel)
  })()

  const zetVast = () => {
    const r = abvVastzetten(abv)
    if ('fout' in r) { setFout(t(r.fout)); return }
    setFout(null)
    onVastzetten(r.patch)
  }
  const zetLabVast = () => {
    const r = abvVastzetten(abv, lab)
    if ('fout' in r) { setFout(t(r.fout)); return }
    setFout(null)
    setLab('')
    zetLab(false)
    onVastzetten(r.patch)
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800">{t('abv_vast_titel')}</div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-bold text-gray-900 tabular-nums">{waarde || '—'}</span>
            {abv.vastgezet && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 ring-1 ring-green-200">
                {t('abv_vast_badge')}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-600 break-words">{bronTekst}</div>
          {!abv.vastgezet && abv.labAdvies && abv.labAdviesReden && (
            <div className="text-xs text-orange-700 mt-1">{t(`etiket_lab_advies_${abv.labAdviesReden}`)}</div>
          )}
        </div>
        {!alleenLezen && (
          <div className="flex flex-col items-stretch sm:items-end gap-1.5 w-full sm:w-auto">
            {abv.vastgezet ? (
              <BevestigKnop v="secondary" s="sm" vraag={t('abv_vast_losmaken_vraag')} onBevestig={onLosmaken}>
                {t('abv_vast_corrigeren')}
              </BevestigKnop>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Btn onClick={zetVast} disabled={abv.waarde === null} cls="flex-1 sm:flex-none">{t('abv_vast_knop')}</Btn>
                {!labOpen && (
                  <button type="button" onClick={() => zetLab(true)}
                    className="min-h-tap sm:min-h-0 text-sm font-medium t-accent-text hover:underline">
                    {t('abv_vast_lab_link')}
                  </button>
                )}
              </div>
            )}
            {!abv.vastgezet && <div className="text-xs text-gray-500">{t('abv_vast_hint')}</div>}
            {abv.vastgezet && heeftAfvullingen && <div className="text-xs text-gray-500 max-w-xs sm:text-right">{t('abv_vast_losmaken_hint')}</div>}
          </div>
        )}
      </div>
      {!alleenLezen && labOpen && !abv.vastgezet && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-end gap-2">
          <label className="block min-w-0">
            <span className="block text-sm font-medium text-gray-700 mb-1">{t('abv_vast_lab_label')}</span>
            <input ref={labRef} type="number" inputMode="decimal" step="0.01" min="0" value={lab}
              onChange={e => { setLab(e.target.value); setFout(null) }}
              onKeyDown={e => { if (e.key === 'Enter') zetLabVast() }}
              className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm t-input outline-none bg-white min-h-tap sm:min-h-0" />
          </label>
          <Btn onClick={zetLabVast} disabled={!lab.trim()}>{t('abv_vast_lab_knop')}</Btn>
          <Btn v="ghost" onClick={() => { zetLab(false); setLab(''); setFout(null) }}>{t('btn_cancel')}</Btn>
        </div>
      )}
      {fout && <div role="alert" className="mt-2 text-sm text-red-700">{fout}</div>}
    </div>
  )
}

export default AbvVastzetten
