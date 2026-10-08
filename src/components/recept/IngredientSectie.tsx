import React from 'react'
import { t } from '../../i18n'
import { fmtD, fmtQty } from '../../utils/format'
import { ingredientenVoorType } from '../../utils/ingTypes'
import type { ReceptRegelVoorraad } from '../../utils/ingredientVoorraad'
import Icon from '../ui/Icon'
import { useSmalScherm } from '../ui/useSmalScherm'

// De ingrediënten van een recept per sectie (mout, hop, gist, overig), met de
// koppeling aan de voorraad en per regel de lots.
//
// Staat bewust buiten ReceptenPage: een component die binnen de render van de
// pagina gedefinieerd wordt, is bij elke render een nieuw type. React bouwt de
// rijen dan opnieuw op, en het hoptijdveld verloor na elke toets de focus (en
// een opengeklapte lotregel klapte weer dicht).
//
// Op het bureau een tabel; op een telefoon (onder het omslagpunt van de schil)
// één regel per ingrediënt onder elkaar: de tabel van 640 px scrolde daar
// zijwaarts en "Benodigd" viel buiten beeld.

export type ReceptSectie = 'mout' | 'hop' | 'gist' | 'overig'

/** Het ingrediënttype in de catalogus dat bij een receptsectie hoort. */
export const SECTIE_TYPE: Record<ReceptSectie, string> = { mout: 'Mout', hop: 'Hop', gist: 'Gist', overig: 'Overig' }

export interface IngredientSectieProps {
  titel: string
  cat: ReceptSectie
  items: any[] | null | undefined
  /** De voorraadcheck per regel, in dezelfde volgorde als `items`. */
  voorraad: ReceptRegelVoorraad[]
  /** De ingrediëntencatalogus, voor de koppelkeuze. */
  ingredienten: any[]
  /** Een Brewfather-versie is alleen-lezen. */
  readOnly: boolean
  onWijzig: (cat: ReceptSectie, idx: number, patch: Record<string, unknown>) => void
  /** Brewfather weer leidend maken voor een in de app gecorrigeerde regel. */
  onWisLokaal: (cat: ReceptSectie, idx: number) => void
}

const IngredientSectie: React.FC<IngredientSectieProps> = ({ titel, cat, items, voorraad, ingredienten, readOnly, onWijzig, onWisLokaal }) => {
  const smal = useSmalScherm()
  if (!items?.length) return null
  const anyRed = voorraad.some(s => s.ok === false && !s.bijna)
  const anyYellow = voorraad.some(s => s.bijna)
  const allGreen = voorraad.length > 0 && voorraad.every(s => s.ok === true)
  const badge = anyRed ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{t('recipe_badge_tekort')}</span>
    : anyYellow ? <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">{t('recipe_badge_bijna')}</span>
    : allGreen ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{t('recipe_badge_beschikbaar')}</span>
    : null
  const regel = (item: any, i: number) => (
    <IngredientRegel key={i} item={item} cat={cat} idx={i} readOnly={readOnly} smal={smal}
      voorraad={voorraad[i]} ingredienten={ingredienten}
      onWijzig={onWijzig} onWisLokaal={onWisLokaal} />
  )
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="text-sm font-semibold text-gray-700">{titel}</h4>
        {badge}
      </div>
      {smal ? (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100">
          {items.map(regel)}
        </ul>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-400">
                <th className="px-3 py-2 text-left font-medium">{t('log_ingredient')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('recipe_linked_to')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('recipe_needed')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('recipe_use')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('stock_available')}</th>
                <th className="px-3 py-2 text-center font-medium w-8">●</th>
                <th className="px-3 py-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(regel)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface IngredientRegelProps {
  item: any
  cat: ReceptSectie
  idx: number
  readOnly: boolean
  /** Telefoonindeling: een gestapelde regel in plaats van een tabelrij. */
  smal: boolean
  voorraad: ReceptRegelVoorraad | undefined
  ingredienten: any[]
  onWijzig: IngredientSectieProps['onWijzig']
  onWisLokaal: IngredientSectieProps['onWisLokaal']
}

const LEGE_VOORRAAD: ReceptRegelVoorraad = {
  ok: null, bijna: false, totaal: 0, ingLots: [], ingMatch: null, benodigd: 0, totaalNodig: 0, gedeeld: false, eenheidMismatch: false,
}

const IngredientRegel: React.FC<IngredientRegelProps> = ({ item, cat, idx, readOnly, smal, voorraad, ingredienten, onWijzig, onWisLokaal }) => {
  const { ok, bijna, totaal, ingLots, ingMatch, totaalNodig, gedeeld, eenheidMismatch } = voorraad || LEGE_VOORRAAD
  const [open, setOpen] = React.useState(false)
  const [editKoppel, setEditKoppel] = React.useState(false)
  // Het type van de regel zelf gaat voor op de sectie: een kandijsuiker in de
  // moutlijst (Brewfather zet suiker bij de fermentables) hoort bij de
  // suikers. Verwante typen blijven kiesbaar (`verwanteIngTypes`).
  const opties = React.useMemo(
    () => (editKoppel ? ingredientenVoorType(ingredienten, item.ingredient_type || SECTIE_TYPE[cat]) : []),
    [editKoppel, ingredienten, item.ingredient_type, cat])
  const dot = ok === null ? <span className="text-gray-300">●</span>
    : ok ? <span className="text-green-500">●</span>
    : bijna ? <span className="text-yellow-500">●</span>
    : <span className="text-red-500">●</span>
  const explicit = item.ingredient_id != null && ingMatch
  const eenheid = String(item.eenheid || '')
  const koppelCel = editKoppel && !readOnly ? (
    <select autoFocus value={item.ingredient_id ?? ''}
      onClick={(e: any) => e.stopPropagation()}
      onBlur={() => setEditKoppel(false)}
      onChange={(e: any) => {
        const v = e.target.value
        onWijzig(cat, idx, { ingredient_id: v === '' ? null : Number(v) })
        setEditKoppel(false)
      }}
      aria-label={t('recipe_linked_to')}
      className="text-xs border rounded px-1 py-0.5 bg-white max-w-full">
      <option value="">{t('recipe_link_auto')}</option>
      {opties.map((i: any) => (
        <option key={i.id} value={i.id}>{i.naam}{i.fabrikant ? ` (${i.fabrikant})` : ''}</option>
      ))}
    </select>
  ) : ingMatch ? (
    <span onClick={(e: any) => { e.stopPropagation(); if (!readOnly) setEditKoppel(true) }}
      className={`text-xs px-1.5 py-0.5 rounded ${readOnly ? '' : 'cursor-pointer hover:bg-gray-100'} ${explicit ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
      title={readOnly ? '' : t('recipe_link_edit')}>
      {explicit && <span className="mr-1"><Icon n="link" /></span>}{ingMatch.naam}
    </span>
  ) : (
    <button onClick={(e: any) => { e.stopPropagation(); if (!readOnly) setEditKoppel(true) }}
      disabled={readOnly}
      className={`text-xs px-1.5 py-0.5 rounded ${readOnly ? 'text-gray-300' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>
      {t('recipe_link_none')}
    </button>
  )
  // Gebruik: bij hop (niet alleen-lezen) aanpasbaar — keuze, tijd, eenheid en
  // "lokaal" als de app de regel overschrijft; anders als tekst.
  const hopBewerkbaar = cat === 'hop' && !readOnly
  const afwijkendType = item.ingredient_type && item.ingredient_type !== SECTIE_TYPE[cat]
  const heeftTijd = item.tijd != null && item.tijd !== ''
  const gebruik = hopBewerkbaar ? (
    <div className="flex flex-wrap items-center gap-1" onClick={(e: any) => e.stopPropagation()}>
      <select value={String(item.gebruik || 'boil').toLowerCase()}
        onChange={(e: any) => {
          const g = e.target.value
          onWijzig('hop', idx, { gebruik: g, tijdEenheid: g === 'dry hop' ? 'day' : 'min' })
        }}
        aria-label={t('recipe_use')}
        className="border border-gray-200 rounded px-1 py-0.5 text-xs text-gray-700 bg-white t-input">
        <option value="boil">{t('hop_gebruik_boil')}</option>
        <option value="whirlpool">{t('hop_gebruik_whirlpool')}</option>
        <option value="dry hop">{t('hop_gebruik_dryhop')}</option>
        <option value="mash">{t('hop_gebruik_mash')}</option>
      </select>
      <input type="number" step="1" min="0" value={item.tijd ?? ''}
        onChange={(e: any) => onWijzig('hop', idx, { tijd: e.target.value === '' ? '' : Number(e.target.value) })}
        className="w-14 border border-gray-200 rounded px-1 py-0.5 text-right text-gray-700 bg-white t-input"
        aria-label={t('recipe_step_time')}
        placeholder="—" />
      <span className="text-gray-400">{String(item.gebruik || '').toLowerCase() === 'dry hop' ? t('lbl_dagen') : t('lbl_minuten')}</span>
      {Array.isArray(item._lokaal) && item._lokaal.length > 0 && (
        <button type="button" onClick={() => onWisLokaal('hop', idx)}
          className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
          title={t('recipe_lokaal_title')}>{t('recipe_lokaal')}</button>
      )}
    </div>
  ) : (
    <>
      {/* Wijkt het type van de regel af van de sectie (suiker in de
          moutlijst), toon dat dan — anders lijkt het mout. */}
      {afwijkendType
        ? <span className="text-gray-500">{t('ing_type_' + String(item.ingredient_type).toLowerCase(), String(item.ingredient_type))}</span>
        : (item.gebruik || '')}
      {heeftTijd
        ? <span className="ml-1 text-gray-400">· {item.tijd} {item.tijdEenheid === 'day' ? t('lbl_dagen') : t('lbl_minuten')}</span>
        : null}
    </>
  )
  const heeftGebruik = hopBewerkbaar || !!afwijkendType || !!item.gebruik || heeftTijd
  const beschikbaar = ok !== null
    ? <span className={ok ? 'text-green-600' : bijna ? 'text-yellow-600' : 'text-red-600'}
        title={eenheidMismatch ? t('recipe_unit_mismatch') : undefined}>
        {eenheidMismatch && '⚠ '}{fmtQty(totaal)} {eenheid}
      </span>
    : eenheidMismatch
      ? <span className="text-gray-500 text-xs" title={t('recipe_unit_mismatch')}>
          ⚠ {fmtQty(totaal)} {eenheid}
        </span>
      : <span className="text-gray-300 text-xs">—</span>
  const tht = (l: any) => l.houdbaarheid
    ? <span className={`font-medium ${new Date(l.houdbaarheid) < new Date() ? 'text-red-600' : 'text-gray-700'}`}>{fmtD(l.houdbaarheid)}</span>
    : <span className="text-gray-300">—</span>

  if (smal) {
    return (
      <li className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span aria-hidden="true" className="text-xs leading-5">{dot}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-800 min-w-0 break-words">{item.naam}</span>
              <span className="text-sm text-gray-700 whitespace-nowrap">{fmtQty(item.hoeveelheid)} {eenheid}</span>
            </div>
            {gedeeld && (
              <div className="text-xs text-gray-400 text-right">
                {t('recipe_total_in_recipe').replace('{n}', fmtQty(totaalNodig)).replace('{u}', eenheid)}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 max-w-full">{koppelCel}</span>
              <span className="text-gray-500 whitespace-nowrap">{t('stock_available')}: {beschikbaar}</span>
            </div>
            {heeftGebruik && <div className="text-xs text-gray-400">{gebruik}</div>}
            {ingLots.length > 0 && (
              <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1 min-h-tap -my-2 text-xs text-gray-500">
                {t('ing_lots')} ({ingLots.length}) {open ? '▴' : '▾'}
              </button>
            )}
            {open && (
              <ul className="rounded border border-orange-100 bg-orange-50 divide-y divide-orange-100 text-xs">
                {ingLots.map((l: any) => (
                  <li key={l.id} className="px-2 py-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="min-w-0 break-words">
                      <span className="font-mono text-gray-700">{l.lotnummer || '—'}</span>
                      {l.leverancier && <span className="text-gray-400 ml-1">({l.leverancier})</span>}
                    </span>
                    <span className="font-medium text-gray-700 whitespace-nowrap">{fmtQty(l.hoeveelheid)} {l.eenheid}</span>
                    <span className="text-gray-500 whitespace-nowrap">{t('lbl_tht')}: {tht(l)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <>
      <tr className={`border-b border-gray-100 ${ingLots.length > 0 ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => ingLots.length > 0 && setOpen(o => !o)}>
        <td className="px-3 py-2 text-sm text-gray-800">{item.naam}</td>
        <td className="px-3 py-2 text-sm text-left">{koppelCel}</td>
        <td className="px-3 py-2 text-sm text-right text-gray-600 whitespace-nowrap"
          title={gedeeld ? t('recipe_total_in_recipe').replace('{n}', fmtQty(totaalNodig)).replace('{u}', eenheid) : ''}>
          {fmtQty(item.hoeveelheid)} {eenheid}
          {gedeeld && (
            <span className="ml-1 text-xs text-gray-400">
              ({t('recipe_total_short')}: {fmtQty(totaalNodig)} {eenheid})
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">{gebruik}</td>
        <td className="px-3 py-2 text-sm text-right whitespace-nowrap">{beschikbaar}</td>
        <td className="px-3 py-2 text-center">{dot}</td>
        <td className="px-3 py-2 text-xs text-gray-300 text-center">{ingLots.length > 0 ? (open ? '▲' : '▼') : ''}</td>
      </tr>
      {open && ingLots.map((l: any) => (
        <tr key={l.id} className="bg-orange-50 text-xs border-b border-orange-100">
          <td className="pl-6 pr-3 py-1.5 text-gray-500">
            <span className="font-mono text-gray-700">{l.lotnummer || '—'}</span>
            {l.leverancier && <span className="text-gray-400 ml-2">({l.leverancier})</span>}
          </td>
          <td className="px-3 py-1.5"></td>
          <td className="px-3 py-1.5 text-right font-medium text-gray-700 whitespace-nowrap">
            {fmtQty(l.hoeveelheid)} {l.eenheid}
          </td>
          <td className="px-3 py-1.5 text-gray-400">{l.aankoop_datum ? fmtD(l.aankoop_datum) : ''}</td>
          <td className="px-3 py-1.5 whitespace-nowrap" colSpan={3}>
            {t('lbl_tht')}: {tht(l)}
          </td>
        </tr>
      ))}
    </>
  )
}

export default IngredientSectie
