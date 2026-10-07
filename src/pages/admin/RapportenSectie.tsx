import React from 'react'
import { t } from '../../i18n'
import Btn from '../../components/ui/Btn'
import PeriodeKiezer from '../../components/ui/PeriodeKiezer'
import { useGedeeldePeriode, useGedeeldBereik } from '../../components/ui/useGedeeldePeriode'
import { useSmalScherm } from '../../components/ui/useSmalScherm'
import {
  begrensOpVandaag, vergelijkBereik, isVergelijkbaar, lokaleDag, dagNotatie,
} from '../../utils/periode'
import {
  RAPPORT_GROEPEN, RAPPORT_SLEUTEL, VERGELIJKBARE_RAPPORTEN, PEILDATUM_RAPPORTEN,
  leesRapport, isRapportId, isDagboekFilter, peildatumVoor, leesJournaalFilter,
  type RapportId, type JournaalFilter,
} from '../../utils/rapporten'
import { useAdmin } from './adminContext'
import { bereikTekst, type RapportProps } from './rapporten/hulp'
import WinstVerlies from './rapporten/WinstVerlies'
import MargeKostprijs from './rapporten/MargeKostprijs'
import Balans from './rapporten/Balans'
import OpenstaandePosten from './rapporten/OpenstaandePosten'
import OmzetPerArtikel from './rapporten/OmzetPerArtikel'
import Journaal from './rapporten/Journaal'
import { exportAllesZip } from './rapporten/exportZip'

// ── Rapporten (Administratie) ───────────────────────────────────────────────
// Zes rapporten in drie groepen (utils/rapporten.ts): Resultaat (Winst &
// verlies, Marge op kostprijs), Positie (Balans en Openstaande posten op een
// peildatum) en Analyse (Omzet per artikel, Journaal met dagboekfilter). Eén
// periodebalk voor alle rapporten — dezelfde gedeelde periode als Facturen en
// Bank — met "vergelijk met vorig jaar", de CSV van het rapport dat open staat
// en de ZIP met alles over de periode.
// Bureau: de rapporten als lijst links, het rapport rechts. Telefoon: een
// keuzelijst bovenaan en het rapport over de volle breedte.

const OPSLAG_RAPPORT = 'brewadmin_rapport'
const OPSLAG_VERGELIJK = 'brewadmin_rapport_vergelijk'
const OPSLAG_JOURNAAL = 'brewadmin_rapport_journaal'

const leesOpslag = (sleutel: string): string | null => {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(sleutel) : null } catch { return null }
}
const schrijfOpslag = (sleutel: string, waarde: string): void => {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sleutel, waarde) } catch { /* privévenster: alleen in het geheugen */ }
}

const VELD = 'border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-tap md:min-h-0 bg-white t-input outline-none shadow-sm w-full'

function RapportenSectie() {
  const ctx = useAdmin()
  const { navDoel } = ctx
  const smal = useSmalScherm()
  const [keuze, setKeuze, eigen, setEigen] = useGedeeldePeriode()
  const { bereik } = useGedeeldBereik()

  // Het rapport uit het navigatiedoel (ook de oude tabbladnamen), anders het
  // laatst gekozen rapport van deze sessie, anders Winst & verlies.
  const [rapport, setRapportState] = React.useState<RapportId>(() => {
    const vorige = leesOpslag(OPSLAG_RAPPORT)
    const standaard: RapportId = isRapportId(vorige) ? vorige : 'wv'
    return navDoel ? leesRapport(navDoel.tab, navDoel.filter, standaard) : standaard
  })
  const setRapport = (r: RapportId) => { setRapportState(r); schrijfOpslag(OPSLAG_RAPPORT, r) }
  const [vergelijk, setVergelijkState] = React.useState<boolean>(() => leesOpslag(OPSLAG_VERGELIJK) === '1')
  const setVergelijk = (v: boolean) => { setVergelijkState(v); schrijfOpslag(OPSLAG_VERGELIJK, v ? '1' : '0') }
  // Het dagboek uit het navigatiedoel, anders het filter van deze sessie: wie
  // vanuit een journaalregel een factuur opent en terugkomt, ziet hetzelfde
  // filter (ook de kostensoort uit Winst & verlies) weer.
  const [journaalFilter, setJournaalFilterState] = React.useState<JournaalFilter>(() =>
    navDoel && isDagboekFilter(navDoel.filter) ? { dagboek: navDoel.filter } : leesJournaalFilter(leesOpslag(OPSLAG_JOURNAAL)))
  const setJournaalFilter = React.useCallback((f: JournaalFilter) => {
    setJournaalFilterState(f)
    schrijfOpslag(OPSLAG_JOURNAAL, JSON.stringify(f))
  }, [])
  const [zipBezig, setZipBezig] = React.useState(false)
  const csvRef = React.useRef<(() => void) | null>(null)
  const inhoudRef = React.useRef<HTMLDivElement | null>(null)

  const nu = new Date()
  const vandaag = lokaleDag(nu)
  // Periode-rapporten lopen tot vandaag: "dit jaar" is dit jaar tot nu, en
  // dat vergelijkt eerlijk met dezelfde dagen vorig jaar.
  const stroom = React.useMemo(() => begrensOpVandaag(bereik, nu), [bereik.van, bereik.tot, vandaag])
  const kanVergelijken = VERGELIJKBARE_RAPPORTEN.includes(rapport)
  const vergelijkMogelijk = isVergelijkbaar(stroom)
  const vorig = React.useMemo(() => vergelijk && kanVergelijken && vergelijkMogelijk ? vergelijkBereik(stroom) : null,
    [vergelijk, kanVergelijken, vergelijkMogelijk, stroom])
  const peildatum = peildatumVoor(bereik, vandaag)
  const opPeildatum = PEILDATUM_RAPPORTEN.includes(rapport)

  const kies = (r: RapportId) => setRapport(r)
  const openJournaal = (f: JournaalFilter) => {
    setJournaalFilter(f)
    setRapport('journaal')
    // Telefoon: de keuzelijst staat bovenaan, dus naar boven; bureau: naar het rapport.
    if (smal) window.scrollTo?.({ top: 0 })
    else inhoudRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  const exportZip = async () => {
    if (zipBezig) return
    setZipBezig(true)
    try { await exportAllesZip(ctx, stroom) } finally { setZipBezig(false) }
  }

  // De CSV-export zet het rapport zelf klaar (useCsvExport in rapporten/hulp.tsx).
  const props: RapportProps = { bereik: stroom, vorig, peildatum, vandaag, csvRef }
  const inhoud = (() => {
    switch (rapport) {
      case 'wv': return <WinstVerlies {...props} onOpenJournaal={openJournaal} />
      case 'marge': return <MargeKostprijs {...props} />
      case 'balans': return <Balans {...props} />
      case 'openstaand': return <OpenstaandePosten {...props} />
      case 'omzet': return <OmzetPerArtikel {...props} />
      case 'journaal': return <Journaal {...props} filter={journaalFilter} onFilter={setJournaalFilter} />
    }
  })()

  const bereikRegel = opPeildatum
    ? t('rap_peildatum').replace('{datum}', dagNotatie(peildatum))
    : bereikTekst(stroom)

  const vergelijkKnop = kanVergelijken && (
    <label className={`inline-flex items-center gap-2 text-sm min-h-tap sm:min-h-0 ${vergelijkMogelijk ? 'text-gray-700 cursor-pointer' : 'text-gray-400 cursor-not-allowed'}`}
      title={vergelijkMogelijk ? undefined : t('rap_vergelijk_uit')}>
      <input type="checkbox" className="t-checkbox w-4 h-4" checked={vergelijk && vergelijkMogelijk} disabled={!vergelijkMogelijk}
        onChange={e => setVergelijk(e.target.checked)} />
      {t('periode_vergelijk')}
    </label>
  )
  const exportKnoppen = (
    <>
      <Btn v="secondary" onClick={() => csvRef.current?.()} title={t('rap_csv_titel').replace('{rapport}', t(RAPPORT_SLEUTEL[rapport]))}>{t('rap_csv')}</Btn>
      <Btn v="primary" onClick={exportZip} disabled={zipBezig}>{zipBezig ? t('rap_zip_bezig') : t('rap_zip')}</Btn>
    </>
  )

  const keuzelijst = (
    <select value={rapport} onChange={e => isRapportId(e.target.value) && kies(e.target.value)}
      aria-label={t('rap_kies')} className={VELD}>
      {RAPPORT_GROEPEN.map(g => (
        <optgroup key={g.id} label={t(g.sleutel)}>
          {g.rapporten.map(r => <option key={r} value={r}>{t(RAPPORT_SLEUTEL[r])}</option>)}
        </optgroup>
      ))}
    </select>
  )

  if (smal) {
    return (
      <div className="space-y-3 min-w-0">
        <div className="space-y-2 min-w-0">
          <div className="grid grid-cols-2 gap-2 min-w-0">
            {/* Met eigen datums krijgt de periode de hele breedte; dan het rapport ook. */}
            <div className={`min-w-0 ${keuze === 'eigen' ? 'col-span-2' : ''}`}>{keuzelijst}</div>
            <PeriodeKiezer keuze={keuze} onKeuze={setKeuze} eigen={eigen} onEigen={setEigen}
              cls={keuze === 'eigen' ? 'col-span-2 order-last' : ''} />
          </div>
          <p className="text-xs text-gray-500 tabular-nums">{bereikRegel}</p>
          <div className="flex flex-wrap items-center gap-2">
            {vergelijkKnop}
            <div className="ml-auto flex flex-wrap gap-2">{exportKnoppen}</div>
          </div>
        </div>
        <div ref={inhoudRef} className="min-w-0 scroll-mt-24">{inhoud}</div>
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="bg-white border border-gray-200 rounded-xl p-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <PeriodeKiezer keuze={keuze} onKeuze={setKeuze} eigen={eigen} onEigen={setEigen} />
        <span className="text-xs text-gray-500 tabular-nums">{bereikRegel}</span>
        {vergelijkKnop}
        <div className="ml-auto flex flex-wrap items-center gap-2">{exportKnoppen}</div>
      </div>
      <div className="lg:hidden">{keuzelijst}</div>
      <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] gap-4 items-start">
        <nav aria-label={t('rap_nav_label')} className="hidden lg:block bg-white border border-gray-200 rounded-xl p-2 sticky top-[calc(var(--kopbalk)_+_1rem)]">
          {RAPPORT_GROEPEN.map(g => (
            <div key={g.id} className="mb-1 last:mb-0">
              <div className="px-2 pt-2 pb-1 text-xs font-medium text-gray-500">{t(g.sleutel)}</div>
              <ul>
                {g.rapporten.map(r => {
                  const aan = r === rapport
                  const sub = r === 'balans' ? t('rap_nav_op').replace('{datum}', dagNotatie(peildatum))
                    : r === 'journaal' ? t('rap_nav_journaal_sub') : ''
                  return (
                    <li key={r}>
                      <button type="button" onClick={() => kies(r)} aria-current={aan ? 'page' : undefined}
                        className={`w-full text-left rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
                          aan ? 'font-semibold t-accent-text bg-[color:var(--t-pale)] shadow-[inset_3px_0_0_var(--t-accent-edge,var(--t-accent))]' : 'text-gray-700 hover:bg-gray-50'}`}>
                        {t(RAPPORT_SLEUTEL[r])}
                        {sub && <span className={`block text-xs font-normal ${aan ? 'text-gray-600' : 'text-gray-400'}`}>{sub}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div ref={inhoudRef} className="min-w-0 scroll-mt-24">{inhoud}</div>
      </div>
    </div>
  )
}

export default RapportenSectie
