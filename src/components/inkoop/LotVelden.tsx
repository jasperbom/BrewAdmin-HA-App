import React from 'react'
import { t } from '../../i18n'
import {
  heeftMeerLots, lotsSom, verdeelGelijk, voegLotToe, verwijderLot, zetLot, type InkoopRegel,
} from '../../utils/inkoopRegels'
import { fmtQty } from '../../utils/format'

interface LotVeldenProps {
  regel: InkoopRegel
  /** `velden` zijn met de hand gewijzigd: hun label "etiket" verdwijnt. */
  onWijzig: (r: InkoopRegel, velden: string[]) => void
  fout?: string | null
}

/** Wie de lots zelf aanpast, neemt ze over: geen enkel lotveld telt nog als etiketwaarde. */
const LOT_VELDEN = ['lots', 'lotnr', 'tht']

const getal = (v: string): number => {
  const n = parseFloat(String(v || '').replace(',', '.'))
  return isFinite(n) ? n : 0
}

const Bron: React.FC<{ aan: boolean }> = ({ aan }) => aan
  ? <span className="text-[11px] font-medium text-green-700 whitespace-nowrap">● {t('inkoop_bron_etiket')}</span>
  : null

/**
 * Lotnummer en THT van een ingrediëntregel. Komen twee zakken uit
 * verschillende partijen, dan wordt de regel twee (of meer) lots: elk met een
 * eigen lotnummer, THT en hoeveelheid. Samen moeten ze de hoeveelheid van de
 * regel zijn; "Verdeel gelijk" doet dat in één tik.
 */
const LotVelden: React.FC<LotVeldenProps> = ({ regel: r, onWijzig, fout }) => {
  const id = React.useId()
  const etiket = new Set(r.uitEtiket || [])
  const eenheid = t('unit_' + (r.eenh || 'kg').toLowerCase(), r.eenh)

  if (!heeftMeerLots(r)) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-lot`} className="text-sm font-medium text-gray-700">{t('ing_lot_number')}</label>
              <Bron aan={etiket.has('lotnr')} />
            </div>
            <input id={`${id}-lot`} type="text" value={r.lotnr} autoComplete="off"
              onChange={e => onWijzig({ ...r, lotnr: e.target.value, onzeker: undefined }, ['lotnr'])}
              className={`w-full border rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm ${r.onzeker ? 'border-orange-400' : 'border-gray-200'}`} />
            {r.onzeker
              ? <p className="mt-1 text-xs text-orange-700">⚠ {t('etiket_controleer').replace('{uitleg}', r.onzeker)}</p>
              : !r.lotnr.trim() && <p className="mt-1 text-xs text-gray-500">{t('inkoop_lot_traceergat')}</p>}
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-tht`} className="text-sm font-medium text-gray-700">{t('lbl_tht')}</label>
              <Bron aan={etiket.has('tht')} />
            </div>
            <input id={`${id}-tht`} type="date" value={r.tht}
              onChange={e => onWijzig({ ...r, tht: e.target.value }, ['tht'])}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm" />
          </div>
        </div>
        <button type="button" onClick={() => onWijzig(voegLotToe(r), LOT_VELDEN)}
          className="text-sm t-accent-text font-medium">
          + {t('inkoop_lot_tweede')}
        </button>
      </div>
    )
  }

  const totaal = getal(r.qty)
  const som = lotsSom(r)
  const klopt = Math.abs(som - totaal) < 0.0005
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{t('inkoop_lots_n').replace('{n}', String(r.lots.length))}</span>
        <Bron aan={etiket.has('lots')} />
      </div>
      <ul className="space-y-2">
        {r.lots.map((l, i) => {
          const weg = (cls: string) => (
            <button type="button" onClick={() => onWijzig(verwijderLot(r, i), LOT_VELDEN)}
              aria-label={t('inkoop_lot_weg').replace('{lot}', l.lotnr || String(i + 1))}
              className={`${cls} flex-shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 items-center justify-center`}>✕</button>
          )
          return (
            <li key={i} className="rounded-lg border border-gray-200 p-2">
              {/* Telefoon: lotnummer met ✕ op de eerste rij, THT en hoeveelheid eronder over de
                  volle breedte (een datum in een smallere cel valt op 320 px weg). Bureau: één rij. */}
              <div className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_0.9fr_auto] gap-2 items-end">
                <div className="col-span-2 sm:col-span-1 min-w-0 flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`${id}-l${i}`} className="block text-xs font-medium text-gray-600 mb-0.5">{t('ing_lot_number')}</label>
                    <input id={`${id}-l${i}`} type="text" value={l.lotnr} autoComplete="off"
                      onChange={e => onWijzig(zetLot(r, i, { lotnr: e.target.value }), LOT_VELDEN)}
                      className={`w-full border rounded-lg px-2.5 py-1.5 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none ${l.onzeker ? 'border-orange-400' : 'border-gray-200'}`} />
                  </div>
                  {weg('flex sm:hidden')}
                </div>
                <div className="min-w-0">
                  <label htmlFor={`${id}-t${i}`} className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_tht')}</label>
                  <input id={`${id}-t${i}`} type="date" value={l.tht}
                    onChange={e => onWijzig(zetLot(r, i, { tht: e.target.value }), LOT_VELDEN)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none" />
                </div>
                <div className="min-w-0">
                  <label htmlFor={`${id}-q${i}`} className="block text-xs font-medium text-gray-600 mb-0.5">{t('lbl_quantity')} ({eenheid})</label>
                  <input id={`${id}-q${i}`} type="number" inputMode="decimal" value={l.qty} min={0}
                    onChange={e => onWijzig(zetLot(r, i, { qty: e.target.value }), LOT_VELDEN)}
                    className={`w-full border rounded-lg px-2.5 py-1.5 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none ${!(getal(l.qty) > 0) && fout ? 'border-red-400' : 'border-gray-200'}`} />
                </div>
                {weg('hidden sm:flex')}
              </div>
              {l.onzeker && <p className="mt-1 text-xs text-orange-700">⚠ {t('etiket_controleer').replace('{uitleg}', l.onzeker)}</p>}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={klopt ? 'text-green-700' : 'text-orange-700'}>
          {klopt ? '✓ ' : '⚠ '}
          {t('inkoop_lots_som').replace('{som}', fmtQty(som)).replace('{totaal}', fmtQty(totaal)).replace('{eenheid}', eenheid)}
        </span>
        {!klopt && totaal > 0 && (
          <button type="button" className="t-accent-text font-medium"
            onClick={() => {
              const delen = verdeelGelijk(totaal, r.lots.length)
              onWijzig({ ...r, lots: r.lots.map((l, i) => ({ ...l, qty: delen[i] })) }, LOT_VELDEN)
            }}>
            {t('inkoop_lots_verdeel')}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => onWijzig(voegLotToe(r), LOT_VELDEN)} className="t-accent-text font-medium">
          + {t('inkoop_lot_toevoegen')}
        </button>
      </div>
      {fout && <p className="text-xs text-red-600">{fout}</p>}
    </div>
  )
}

export default LotVelden
