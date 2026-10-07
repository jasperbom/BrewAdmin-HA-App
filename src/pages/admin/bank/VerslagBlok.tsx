import React from 'react'
import { t } from '../../../i18n'
import { ADDON_BASE } from '../../../utils/api'
import { vulIn } from '../../../utils/periode'
import type { PspVerslag, VerslagKoppeling, VerslagMatch } from '../../../utils/pspVerslag'
import type { PspVerslagInfo } from '../../../utils/pspUitbetaling'
import { geldCent, korteDatum } from './bankTekst'

// ── Het uitbetalingsverslag bij een PSP-uitbetaling ─────────────────────────
// De PDF van Mollie (of een andere PSP) bij deze uitbetaling: wat de app eruit
// las en welke factuur er bij elke regel hoort (utils/pspVerslag.ts). De
// bestandsinvoer zelf staat in BankSectie, buiten de vensters; hier alleen de
// knop. Het verslag hoort bij de transactie (`bank_transacties[].verslag`).

export interface VerslagStand {
  /** Het verslag zoals de app het las; null zolang het nog gelezen wordt of als dat mislukte. */
  gelezen: PspVerslag | null
  bezig: boolean
  fout: string | null
}

export interface VerslagBlokProps {
  /** Het verslag dat al op de transactie staat. */
  info: PspVerslagInfo | null
  stand: VerslagStand | null
  koppeling: VerslagKoppeling | null
  uitbetaaldCent: number
  psp: string
  /** Factuurnummer bij een id (verkoop), voor de regels. */
  factuurNummer: (id: number) => string
  onKies: () => void
}

const uitkomstTekst = (m: VerslagMatch, nummer: (id: number) => string): string => {
  const nr = m.factuurId !== undefined ? nummer(m.factuurId) : ''
  switch (m.uitkomst) {
    case 'factuur':
    case 'creditnota': {
      const kop = vulIn(t(m.uitkomst === 'factuur' ? 'psp_vr_factuur' : 'psp_vr_creditnota'), { nummer: nr })
      return m.bedragWijkt ? `${kop} · ${t('psp_vr_bedrag_wijkt')}` : kop
    }
    case 'netto_nul': return t('psp_vr_netto_nul')
    case 'kosten':
      if (!m.regel.pspFactuur) return t('psp_vr_kosten_zonder_nr')
      return vulIn(t(m.regel.soort === 'compensatie' ? 'psp_vr_compensatie' : 'psp_vr_kosten'), { nummer: m.regel.pspFactuur })
    case 'elders': return vulIn(t('psp_vr_elders'), { nummer: nr })
    case 'niet_gevonden': return t('psp_vr_niet_gevonden')
    default: return t('psp_vr_overig')
  }
}

const uitkomstKleur = (m: VerslagMatch): string => {
  if (m.uitkomst === 'factuur' || m.uitkomst === 'creditnota') return m.bedragWijkt ? 'text-orange-700' : 'text-green-700'
  if (m.uitkomst === 'niet_gevonden') return 'text-red-700'
  if (m.uitkomst === 'elders' || m.uitkomst === 'overig') return 'text-orange-700'
  return 'text-gray-500'
}

const VerslagBlok: React.FC<VerslagBlokProps> = ({ info, stand, koppeling, uitbetaaldCent, psp, factuurNummer, onKies }) => {
  const gelezen = stand?.gelezen || null
  const som = gelezen ? gelezen.som_cent : (typeof info?.som_cent === 'number' ? info.som_cent : null)
  const totaal = gelezen ? gelezen.totaal_cent : (info?.totaal_cent ?? null)
  const aantal = gelezen ? gelezen.regels.length : info?.aantal
  const referentie = gelezen?.referentie || info?.referentie || ''
  const klopt = som === null ? null : som === uitbetaaldCent
  const onvolledig = som !== null && totaal !== null && totaal !== som
  const jaar = new Date().getFullYear()
  return (
    <section aria-label={t('psp_verslag_kop')} className="rounded-lg border border-gray-200 px-3 py-2 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-800">{t('psp_verslag_kop')}</h4>
        <button type="button" onClick={onKies} disabled={!!stand?.bezig}
          className="px-3 py-1 min-h-tap sm:min-h-0 rounded-lg text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
          {info ? t('psp_verslag_ander') : t('psp_verslag_koppelen')}
        </button>
      </div>
      {!info && !stand?.bezig && !stand?.fout && (
        <p className="text-xs text-gray-500">{vulIn(t('psp_verslag_uitleg'), { psp })}</p>
      )}
      {info && (
        <p className="text-sm text-gray-700 break-words">
          <a href={`${ADDON_BASE}api/file/${info.bestand}`} target="_blank" rel="noopener noreferrer"
            className="t-accent-text font-medium hover:underline break-all">{info.naam || t('fct_bijlage_openen')}</a>
          {[
            referentie,
            aantal !== undefined ? vulIn(t('psp_verslag_regels'), { n: aantal }) : '',
            som !== null ? vulIn(t('psp_verslag_totaal'), { bedrag: geldCent(som) }) : '',
          ].filter(Boolean).map(s => <span key={s} className="text-gray-500"> · {s}</span>)}
        </p>
      )}
      {klopt === true && !onvolledig && <p className="text-xs text-green-700">✓ {t('psp_verslag_klopt')}</p>}
      {klopt === false && (
        <p className="text-xs text-orange-700">{vulIn(t('psp_verslag_wijkt'), { bedrag: geldCent(uitbetaaldCent) })}</p>
      )}
      {onvolledig && totaal !== null && som !== null && (
        <p className="text-xs text-orange-700">{vulIn(t('psp_verslag_onvolledig'), { som: geldCent(som), totaal: geldCent(totaal) })}</p>
      )}
      {stand?.bezig && <p className="text-xs text-gray-500" role="status">{t('psp_verslag_lezen')}</p>}
      {stand?.fout && <p className="text-xs text-red-700" role="alert">{stand.fout}</p>}
      {koppeling && koppeling.matches.length > 0 && (
        <ul className="max-h-48 overflow-y-auto overflow-x-hidden divide-y divide-gray-100 border-t border-gray-100" aria-label={t('psp_verslag_kop')}>
          {koppeling.matches.map((m, i) => (
            <li key={i} className="py-1 grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-x-2 items-baseline text-sm">
              <span className="text-xs text-gray-500 tabular-nums">{korteDatum(m.regel.datum, jaar)}</span>
              <span className="min-w-0">
                <span className="block text-gray-800 break-words">
                  {m.regel.omschrijving || m.regel.methode || '—'}
                  {m.regel.consument && <span className="text-gray-500"> · {m.regel.consument}</span>}
                </span>
                <span className={`block text-xs break-words ${uitkomstKleur(m)}`}>{uitkomstTekst(m, factuurNummer)}</span>
              </span>
              <span className={`tabular-nums whitespace-nowrap ${m.regel.uitbetaald_cent < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                {geldCent(m.regel.uitbetaald_cent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default VerslagBlok
