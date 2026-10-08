import React from 'react'
import { t, getLang } from '../../../i18n'
import { periodeKeyLabel } from '../../../utils/btw'
import {
  AANGIFTE_STAPPEN, stapSleutel, stapNaamSleutel, bedragSleutel, subRegel, pilVoor,
  type AangifteRij, type PilKleur, type StapStand, type Tekst,
} from '../../../utils/aangifteStappen'
import { fmt } from '../adminContext'
import { useTelefoonIndeling } from '../../../components/ui/useSmalScherm'

// ── Kleine onderdelen van Aangiftes: stappenbalk, pil, bedrag, titels ───────

/** Bedrag in centen als '€ 1.234,56' (de notatie van Administratie). */
export const fmtCent = (cent: number): string => fmt((Number(cent) || 0) / 100)

/** Een i18n-tekst met variabelen invullen. */
export const vul = (x: Tekst): string =>
  Object.entries(x.vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(x.sleutel))

/**
 * Tekst met één vetgedrukt stuk: "{jaar} tot nu: {bedrag} te betalen" met
 * het bedrag vet. Het sjabloon komt uit i18n, zodat de woordvolgorde per
 * taal kan verschillen.
 */
export const MetVet: React.FC<{ sjabloon: string, vet: string, vars?: Record<string, string> }> = ({ sjabloon, vet, vars = {} }) => {
  const tekst = Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), sjabloon)
  const [voor, ...na] = tekst.split('{bedrag}')
  return <>{voor}{na.length > 0 && <><b className="font-semibold text-gray-900 tabular-nums">{vet}</b>{na.join('{bedrag}')}</>}</>
}

const LOCALE: Record<string, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' }

/** 'september 2026' in de schermtaal, met een hoofdletter. */
export const maandTitel = (jaar: number, maand: number): string => {
  const s = new Date(jaar, maand - 1, 1).toLocaleString(LOCALE[getLang()] || 'nl-NL', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** De naam van een periode: 'Q3 2026', of de maand ('September 2026'). */
export const periodeTitel = (rij: Pick<AangifteRij, 'soort' | 'sleutel'>): string => {
  if (rij.soort === 'accijns') return maandTitel(Number(rij.sleutel.slice(0, 4)), Number(rij.sleutel.slice(5, 7)))
  const m = /^(\d{4})-M(\d{2})$/.exec(rij.sleutel)
  return m ? maandTitel(Number(m[1]), Number(m[2])) : periodeKeyLabel(rij.sleutel)
}

const PIL_KLEUR: Record<PilKleur, string> = {
  blauw: 'bg-blue-100 text-blue-800',
  groen: 'bg-green-100 text-green-800',
  grijs: 'bg-gray-100 text-gray-700',
  oranje: 'bg-orange-100 text-orange-800',
}

export const Pil: React.FC<{ rij: AangifteRij }> = ({ rij }) => {
  const p = pilVoor(rij)
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${PIL_KLEUR[p.kleur]}`}>{t(p.sleutel)}</span>
}

/** De regel onder de periode; rood als hij te laat is, oranje als hij om actie vraagt. */
export const SubRegel: React.FC<{ rij: AangifteRij, cls?: string }> = ({ rij, cls = '' }) => (
  <span className={`block text-xs ${rij.teLaat ? 'text-red-700 font-medium' : rij.vraagtActie ? 'text-orange-800' : 'text-gray-500'} ${cls}`}>
    {vul(subRegel(rij))}
  </span>
)

/** Bedrag met wat het is (te betalen, terug te ontvangen, tot nu …). Een teruggave in groen. */
export const BedragCel: React.FC<{ rij: AangifteRij, groot?: boolean }> = ({ rij, groot = false }) => (
  <span className="block text-right">
    <span className={`block tabular-nums font-semibold ${groot ? 'text-base' : 'text-sm'} ${rij.bedragCent < 0 ? 'text-green-700' : rij.totNu ? 'text-gray-700' : 'text-gray-900'}`}>
      {fmtCent(Math.abs(rij.bedragCent))}
    </span>
    <span className="block text-[11px] text-gray-500 whitespace-nowrap">{t(bedragSleutel(rij))}</span>
  </span>
)

const STIP: Record<StapStand, string> = {
  klaar: 'bg-[color:var(--t-accent-edge,var(--t-accent))] border-[color:var(--t-accent-edge,var(--t-accent))]',
  nu: 'bg-white border-[color:var(--t-accent-edge,var(--t-accent))] ring-2 ring-[color:var(--t-pale)]',
  open: 'bg-white border-gray-300',
  overgeslagen: 'bg-gray-200 border-gray-300 border-dashed',
}

/**
 * De vijf stappen (Lopend · Berekend · Gecontroleerd · Ingediend · Betaald)
 * als stippen met een lijntje. Compact: alleen de stippen en het label van
 * de huidige stap (lijstregel, kaart). Volledig: met de naam onder elke stip
 * (het detail).
 */
export const StappenBalk: React.FC<{ rij: AangifteRij, volledig?: boolean, cls?: string }> = ({ rij, volledig = false, cls = '' }) => {
  // Het detailpaneel naast de lijst is onder 1024 px maar 320 px breed: daar
  // alleen de naam van de huidige stap (de rest staat in de stip als title en
  // in aria-label), anders lopen de namen in elkaar. Het detailscherm op een
  // telefoon heeft de hele breedte.
  const telefoon = useTelefoonIndeling()
  const huidig = t(stapSleutel(rij))
  const nr = Math.max(0, AANGIFTE_STAPPEN.indexOf(rij.stap)) + 1
  const aria = t('agf_stap_aria').replace('{n}', String(nr)).replace('{totaal}', String(AANGIFTE_STAPPEN.length)).replace('{stap}', huidig)
  if (volledig) {
    return (
      <ol aria-label={aria} className={`grid grid-cols-5 ${cls}`}>
        {AANGIFTE_STAPPEN.map((s, i) => {
          const stand = rij.stappen[i]
          return (
            <li key={s} className="relative flex flex-col items-center text-center min-w-0">
              {i > 0 && (
                <span aria-hidden="true" className={`absolute top-[7px] right-1/2 w-full h-0.5 ${stand === 'open' ? 'bg-gray-200' : 'bg-[color:var(--t-accent-edge,var(--t-accent))]'}`} />
              )}
              {/* Boven het lijntje van de volgende stap, dat tot het midden van deze stip loopt. */}
              <span aria-hidden="true" title={t(stapNaamSleutel(rij, i))} className={`relative z-10 w-4 h-4 rounded-full border-2 ${STIP[stand]}`} />
              <span className={`mt-1 text-[10px] leading-tight whitespace-nowrap ${stand === 'nu' || telefoon ? '' : 'hidden lg:block'} ${stand === 'nu' ? 'font-semibold text-gray-900' : stand === 'open' ? 'text-gray-400' : 'text-gray-600'} ${stand === 'overgeslagen' ? 'line-through' : ''}`}>
                {t(stapNaamSleutel(rij, i))}
              </span>
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <span role="img" aria-label={aria} className={`inline-flex items-center gap-2 min-w-0 ${cls}`}>
      <span aria-hidden="true" className="inline-flex items-center flex-shrink-0">
        {AANGIFTE_STAPPEN.map((s, i) => {
          const stand = rij.stappen[i]
          return (
            <React.Fragment key={s}>
              {i > 0 && <span className={`w-2.5 h-0.5 ${stand === 'open' ? 'bg-gray-200' : 'bg-[color:var(--t-accent-edge,var(--t-accent))]'}`} />}
              <span title={t(stapNaamSleutel(rij, i))} className={`w-2.5 h-2.5 rounded-full border-2 ${STIP[stand]}`} />
            </React.Fragment>
          )
        })}
      </span>
      <span className="text-xs text-gray-700 truncate">{huidig}</span>
    </span>
  )
}
