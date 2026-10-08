import React from 'react'
import { t } from '../../i18n'
import { fmt, fmtD } from '../../utils/format'
import BierKleur from '../ui/BierKleur'
import Icon from '../ui/Icon'
import RowActions, { type RowActie } from '../ui/RowActions'
import KomtEraanRegel from './KomtEraanRegel'
import type { OrderRegelLevering } from '../../utils/verkoopOverzicht'
import type { PickHerkomst } from '../../utils/picking'

export interface RegelPick {
  id: number | string
  aantal: number
  herkomst: PickHerkomst
}

interface OrderRegelKaartProps {
  regel: any
  /** `bier`, `vrij`, `verzending` of `korting` (zonder type: bier). */
  soort: string
  ebc: number | null
  /** Het product van de regel (SKU/naam): de regelnaam opent het. */
  productId: number | null
  productNaam: string
  onProduct?: (productId: number) => void
  /** `regelBedrag(regel).netto` — zoals op de factuur. */
  netto: number
  /** Al voor deze regel gepickt (alleen bierregels). */
  gepickt: number
  /** Kan de regel geleverd worden — alleen zolang er nog gepickt wordt. */
  levering?: OrderRegelLevering | null
  vandaag: string
  /** De picks van deze regel met hun herkomst (lotcode, batch, THT). */
  picks: RegelPick[]
  onBatch?: (batchId: number) => void
  /** Het ⋯-menu van de regel (BTW-tarief, regelsoort wisselen, verwijderen). */
  acties: RowActie[]
}

const CHIP = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap'

/**
 * "46 vrij · tekort 2" — wat er voor de regel vrij ligt en wat er ontbreekt.
 * Ligt er niets vrij, dan alleen wat ontbreekt ("tekort 12", "eerst uitslaan
 * (2)"): "0 vrij" erbij zegt niets extra.
 */
const leverChip = (l: OrderRegelLevering): { tekst: string; cls: string } | null => {
  const vrij = String(l.beschikbaar)
  const oranje = 'bg-orange-100 text-orange-700'
  switch (l.status) {
    case 'kan_geleverd':
      return { tekst: t('orders_regel_vrij').replace('{vrij}', vrij), cls: 'bg-green-100 text-green-700' }
    case 'uitslaan':
      return l.beschikbaar > 0
        ? { tekst: t('orders_regel_vrij_uitslaan').replace('{vrij}', vrij).replace('{n}', String(l.uitTeSlaan)), cls: oranje }
        : { tekst: t('verkoop_lever_uitslaan').replace('{n}', String(l.uitTeSlaan)), cls: oranje }
    case 'tekort':
      return l.beschikbaar > 0
        ? { tekst: t('orders_regel_vrij_tekort').replace('{vrij}', vrij).replace('{n}', String(l.tekort)), cls: oranje }
        : { tekst: t('verkoop_lever_tekort').replace('{n}', String(l.tekort)), cls: oranje }
    case 'geen_bier':
      return { tekst: t('verkoop_lever_geen_bier'), cls: 'bg-gray-100 text-gray-600' }
    default:
      return null
  }
}

/**
 * Eén orderregel als kaart (telefoon) of rij (bureau): "48× Kadeblond Fles
 * 33cL" (de naam opent het product), prijs en bedrag, en voor een bierregel
 * wat er vrij ligt ("46 vrij · tekort 2") met daaronder wat er in de tank ligt
 * ("Komt eraan: #2609 …", opent de batch). Na het picken staat per pick de
 * lotcode met de THT; de lotcode opent de batch. Acties in het ⋯-menu.
 */
const OrderRegelKaart: React.FC<OrderRegelKaartProps> = (p) => {
  const r = p.regel
  const isBier = p.soort === 'bier'
  const nodig = Number(r?.aantal || 0)
  const naam = isBier
    ? [r?.bier_naam, r?.verpakking_type].map(x => String(x ?? '').trim()).filter(Boolean).join(' ')
    : String(r?.omschrijving || r?.bier_naam || '').trim()
  const naamTekst = <><span className="tabular-nums">{nodig}×</span> {naam || t('lbl_naamloos')}</>
  const volledig = isBier && nodig > 0 && p.gepickt >= nodig
  const lever = isBier && p.levering && !volledig ? leverChip(p.levering) : null
  // Alleen bij een echt tekort: ligt het ontbrekende in de AGP, dan is
  // uitslaan de weg, niet wachten op de tank.
  const komt = isBier && p.levering && !volledig && p.levering.status === 'tekort' ? p.levering.komtEraan[0] : null

  return (
    <li className="px-3 py-3 md:px-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
            {/* Naam: bier-stip, aantal en naam; badges erachter. */}
            <div className="md:flex-1 min-w-0 flex items-start gap-2">
              {isBier && <BierKleur ebc={p.ebc} s="md" cls="mt-0.5" />}
              <div className="min-w-0 font-semibold text-gray-900 break-words">
                {p.productId != null && p.onProduct ? (
                  <button type="button" onClick={() => p.onProduct!(p.productId!)} title={t('orders_regel_product_open')}
                    className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
                    {naamTekst}
                  </button>
                ) : naamTekst}
                {r?.sku && <span className="ml-1.5 font-mono text-xs font-normal text-gray-400 whitespace-nowrap">{r.sku}</span>}
                {p.soort === 'verzending' && <span className="ml-1.5 text-xs text-blue-500" title={t('lbl_verzendkosten')}><Icon n="truck" /></span>}
                {p.soort === 'korting' && <span className="ml-1.5 text-xs font-semibold text-green-600">%</span>}
                {r?.merch && (
                  <span className={`${CHIP} ml-1.5 bg-purple-100 text-purple-700 align-middle`} title={t('orders_regel_merch_uitleg')}>
                    {t('orders_regel_merch')}
                  </span>
                )}
                {r?.wc_onbekend && <span className="ml-1.5 text-xs font-semibold text-orange-600" title={t('orders_regel_onbekend')}>?</span>}
              </div>
            </div>
            {/* Bedragen, BTW en de leverstand. */}
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${isBier ? 'pl-6 md:pl-0' : ''}`}>
              <span className="text-gray-600 tabular-nums whitespace-nowrap">
                {fmt(r?.prijs_per_stuk)} · <span className="font-semibold text-gray-900">{fmt(p.netto)}</span>
              </span>
              <span className="text-xs text-gray-500 whitespace-nowrap">{t('orders_btw_tarief').replace('{pct}', String(r?.btw_pct ?? 0))}</span>
              {isBier && p.gepickt > 0 && (
                <span className={`text-xs font-semibold whitespace-nowrap ${volledig ? 'text-green-700' : 'text-orange-600'}`}>
                  {volledig ? '✓ ' : ''}{t('orders_regel_gepickt').replace('{n}', String(p.gepickt)).replace('{totaal}', String(nodig))}
                </span>
              )}
              {lever && <span className={`${CHIP} ${lever.cls}`}>{lever.tekst}</span>}
            </div>
          </div>

          {komt && (
            <div className={isBier ? 'md:pl-6' : ''}>
              <KomtEraanRegel k={komt} productNaam={p.productNaam || r?.bier_naam || ''} vandaag={p.vandaag} onOpen={p.onBatch} />
            </div>
          )}

          {/* Na het picken: de lotcode en THT per pick — de lotcode opent de batch. */}
          {p.picks.length > 0 && (
            <ul className={`mt-1.5 ${isBier ? 'pl-6' : ''}`} aria-label={t('orders_regel_picks')}>
              {p.picks.map(pk => {
                const h = pk.herkomst
                const lotLabel = h.lotcode || (h.batchNummer ? `#${h.batchNummer}` : t('lbl_onbekend'))
                return (
                  <li key={pk.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="flex-1 min-w-0 break-words">
                      <span className="text-gray-500">{h.lotcode ? t('picking_lot') : t('picking_batch')}</span>{' '}
                      {h.batchId != null && p.onBatch ? (
                        <button type="button" onClick={() => p.onBatch!(h.batchId!)} title={t('orders_komt_open_batch')}
                          className="inline-flex items-center align-middle min-h-tap sm:min-h-[28px] font-mono font-semibold t-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
                          {lotLabel}
                        </button>
                      ) : <span className="font-mono font-semibold text-gray-800">{lotLabel}</span>}
                      {h.lotcode && h.batchNummer && <span className="text-gray-400"> #{h.batchNummer}</span>}
                      <span> · {t('lbl_tht')} {h.tht ? fmtD(h.tht) : '—'}</span>
                    </span>
                    <span className="flex-shrink-0 font-semibold text-gray-800 tabular-nums">{pk.aantal}×</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {p.acties.length > 0 && <RowActions acties={p.acties} v="kaart" />}
      </div>
    </li>
  )
}

export default OrderRegelKaart
