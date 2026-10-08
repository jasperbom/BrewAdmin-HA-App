import React from 'react'
import { t } from '../../i18n'
import { fmt } from '../../utils/format'
import { kassaKeuzeOp } from '../../utils/kassaCatalogus'
import type { KassaKeuze, KassaTegel } from '../../utils/kassaCatalogus'
import BierKleur from '../ui/BierKleur'

interface KassaTegelsProps {
  tegels: KassaTegel[]
  /** Hoeveel van deze keuze er al op de bon staat. */
  opBon: (key: string) => number
  /** De prijs zoals de kassa hem nu toont (incl./excl. BTW, B2B); null = geen prijs. */
  prijs: (k: KassaKeuze) => { bedrag: number | null; b2b: boolean }
  onKies: (k: KassaKeuze) => void
  onUitslaan: (k: KassaKeuze) => void
}

/**
 * Eén tegel per product met de verpakkingen als knoppen (elk 48 px hoog, met
 * prijs en vrije voorraad). Een knop zet één stuk op de bon zolang er vrije
 * voorraad buiten de AGP is. Wat in de AGP ligt verkoopt de kassa niet: dat is
 * een link onder de knop die de uitslag opent ("240 in AGP · uitslaan ›").
 */
const KassaTegels: React.FC<KassaTegelsProps> = ({ tegels, opBon, prijs, onKies, onUitslaan }) => {
  const id = React.useId()
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
      {tegels.map((tg, ti) => (
        <section key={tg.key} aria-labelledby={`${id}-${ti}`}
          className="min-w-0 rounded-xl border border-gray-200 bg-white p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 min-w-0 px-1 pt-0.5">
            {!tg.merch && <BierKleur ebc={tg.ebc} s="md" />}
            <h3 id={`${id}-${ti}`} className="min-w-0 break-words font-semibold text-sm text-gray-800 leading-tight">{tg.naam}</h3>
          </div>
          {tg.keuzes.map(k => {
            const n = opBon(k.key)
            const op = kassaKeuzeOp(k)
            // Merch blokkeert niet op nul (het shirt ligt op de toonbank, de
            // teller loopt achter); bier wel: nooit meer dan er vrij ligt.
            const kan = k.merch ? k.prijs != null : k.verkoopbaar > 0 && n < k.verkoopbaar
            const p = prijs(k)
            const voorraad = k.merch && k.prijs == null
              ? t('pos_merch_geen_prijs')
              : op && !k.merch ? t('pos_geen_voorraad') : `${k.verkoopbaar} ${t('pos_voorraad')}`
            const voorraadKleur = (k.merch && k.prijs == null) || (op && !k.merch)
              ? 'text-red-600'
              : k.merch && k.verkoopbaar <= 0 ? 'text-orange-600' : 'text-gray-500'
            return (
              <div key={k.key} className="flex flex-col min-w-0">
                <button type="button" onClick={() => onKies(k)} disabled={!kan}
                  className={`relative w-full min-h-tapLg rounded-lg border px-2.5 py-1.5 text-left flex flex-col justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${kan
                    ? 'border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100'
                    : 'border-gray-100 bg-gray-50 cursor-not-allowed'}`}>
                  <span className="w-full flex items-baseline gap-2">
                    <span className={`flex-1 min-w-0 text-sm leading-tight truncate ${kan ? 'text-gray-800' : 'text-gray-500'}`}>{k.label}</span>
                    <span className={`flex-shrink-0 text-sm font-semibold whitespace-nowrap ${kan ? 't-accent-text' : 'text-gray-400'}`}>
                      {p.bedrag != null ? fmt(p.bedrag) : '—'}
                    </span>
                  </span>
                  <span className="w-full flex items-center gap-2 mt-0.5">
                    <span className={`flex-1 min-w-0 text-xs leading-tight truncate ${voorraadKleur}`}>{voorraad}</span>
                    {p.b2b && <span className="flex-shrink-0 text-[10px] font-semibold bg-blue-100 text-blue-700 px-1 rounded leading-4">B2B</span>}
                  </span>
                  {n > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold shadow"
                      style={{ backgroundColor: 'var(--t-accent)' }}>{n}</span>
                  )}
                </button>
                {k.agp > 0 && (
                  <button type="button" onClick={() => onUitslaan(k)}
                    className="min-h-tap px-1 text-left text-xs text-gray-500 hover:text-gray-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    {t('pos_agp_uitslaan').replace('{n}', String(k.agp))} <span aria-hidden="true">›</span>
                  </button>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

export default KassaTegels
