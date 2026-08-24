import React from 'react'
import { t } from '../i18n'
import { BierVeld, BierRegel, bierWeergaveVelden } from '../utils/bierinfo'

// Het bier zoals een drinker het ziet: de grote cijfers, de smaakbalken, de
// spectabel en de tekstblokken. Dezelfde opbouw als de productpagina in de
// webshop, zodat je in één oogopslag ziet wat er over dit bier bekend is —
// zonder eerst op Bewerken te hoeven drukken.
//
// De indeling komt uit de velddefinities (`weergave` in `utils/bierinfo.ts`),
// dus een nieuw veld verschijnt hier vanzelf op de juiste plek.

export interface BierInfoWeergaveProps {
  /** De bierinformatie van dit product/artikel (uit `bierInfoVoorArtikel`). */
  info?: Record<string, any> | null
  /** Compacter tonen (bijv. in een modal). */
  compact?: boolean
}

const gevuld = (w: any): boolean =>
  w !== undefined && w !== null && w !== '' &&
  (Array.isArray(w) ? w.length > 0 : typeof w === 'boolean' ? true : String(w).trim() !== '')

/** Label/waarde-regels uit een `regels`-veld, veilig getypt. */
const regels = (w: any): BierRegel[] =>
  Array.isArray(w) ? w.filter((r: any) => r && (r.label || r.value)) : []

const BierInfoWeergave: React.FC<BierInfoWeergaveProps> = ({info, compact = false}) => {
  const bron = info || {}
  const heeft = (f: BierVeld) => gevuld(bron[f.veld])

  // ── De grote cijfers (ABV, IBU, EBC, kcal) ────────────────────────────────
  const cijfers = bierWeergaveVelden('cijfer').filter(heeft)

  // ── Smaakbalken: het thema tekent ze pas vanaf twee ingevulde assen ───────
  const assen = bierWeergaveVelden('balk')
    .filter(heeft)
    .map(f => ({veld: f, waarde: Math.max(0, Math.min(100, Number(bron[f.veld]) || 0))}))
  const toonAssen = assen.length >= 2

  // ── Spectabel: losse specregels plus de vrije extra eigenschappen ────────
  const specs: {sleutel: string, label: string, waarde: string}[] = []
  for (const f of bierWeergaveVelden('spec')) {
    if (!heeft(f)) continue
    if (f.soort === 'regels') {
      for (const r of regels(bron[f.veld])) {
        specs.push({sleutel: `${f.veld}-${r.label}`, label: r.label, waarde: r.value})
      }
    } else {
      specs.push({sleutel: f.veld, label: t(f.label), waarde: String(bron[f.veld])})
    }
  }

  // ── Tekstblokken (ingrediënten, smaakprofiel, serveertip, eigen blokken) ──
  const kaarten: {sleutel: string, kop: string, tekst: string}[] = []
  for (const f of bierWeergaveVelden('kaart')) {
    if (!heeft(f)) continue
    if (f.soort === 'regels') {
      for (const r of regels(bron[f.veld])) {
        kaarten.push({sleutel: `${f.veld}-${r.label}`, kop: r.label, tekst: r.value})
      }
    } else {
      kaarten.push({sleutel: f.veld, kop: t(f.label), tekst: String(bron[f.veld])})
    }
  }

  // ── Waardering ───────────────────────────────────────────────────────────
  const score = bron.untappd_score
  const aantal = bron.untappd_aantal
  const untappdUrl = bron.untappd_url

  // ── Markeringen (uit roulatie, badge, levering) ──────────────────────────
  const uitRoulatie = bron.uit_roulatie === true
  const badge = gevuld(bron.badge) ? String(bron.badge) : ''
  const levering = gevuld(bron.levering) ? String(bron.levering) : ''
  const leveringVeld = bierWeergaveVelden('markering').find(f => f.veld === 'levering')
  const leveringLabel = leveringVeld?.opties?.find(o => o.v === levering)?.l

  const leeg = cijfers.length === 0 && !toonAssen && specs.length === 0 &&
    kaarten.length === 0 && !gevuld(score) && !uitRoulatie && !badge && !levering

  if (leeg) return null

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* Markeringen bovenaan: die veranderen hoe je naar de rest kijkt. */}
      {(uitRoulatie || badge || levering) && (
        <div className="flex flex-wrap items-center gap-2">
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-white" style={{backgroundColor: 'var(--t-accent)'}}>
              {badge}
            </span>
          )}
          {uitRoulatie && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
              {t('bier_veld_uit_roulatie')}
              {gevuld(bron.opvolger) && <span className="font-normal"> · {t('bier_veld_opvolger').toLowerCase()}: {String(bron.opvolger)}</span>}
            </span>
          )}
          {levering && leveringLabel && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{t(leveringLabel)}</span>
          )}
        </div>
      )}

      {/* De cijferstrip */}
      {cijfers.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {cijfers.map(f => (
            <div key={f.veld}>
              <div className={`font-bold leading-none ${compact ? 'text-base' : 'text-xl'}`} style={{color: 'var(--t-accent)'}}>
                {String(bron[f.veld])}
              </div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{t(f.label)}</div>
            </div>
          ))}
          {gevuld(score) && (
            <div>
              <div className={`font-bold leading-none ${compact ? 'text-base' : 'text-xl'}`} style={{color: 'var(--t-accent)'}}>
                {String(score)}
                <span className="text-xs text-gray-400 font-normal"> / 5</span>
              </div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">
                {untappdUrl ? (
                  <a href={String(untappdUrl)} target="_blank" rel="noreferrer" className="underline">Untappd</a>
                ) : 'Untappd'}
                {gevuld(aantal) && ` · ${aantal}×`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Smaakprofiel in balken */}
      {toonAssen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {assen.map(({veld, waarde}) => (
            <div key={veld.veld} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-14 flex-shrink-0">{t(veld.label)}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                {/* Groen = de assen die het bier strakker maken (bitter,
                    droog), accentkleur = de assen die het voller maken. */}
                <div className="h-full rounded-full transition-all"
                  style={{width: `${waarde}%`, backgroundColor: veld.strak ? '#4d7c0f' : 'var(--t-accent)'}} />
              </div>
              <span className="text-[10px] text-gray-400 w-7 text-right">{waarde}</span>
            </div>
          ))}
        </div>
      )}

      {/* Spectabel */}
      {specs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {specs.map(r => (
            <div key={r.sleutel} className="flex justify-between gap-3 py-1 border-b border-gray-100 text-xs">
              <span className="text-gray-500">{r.label}</span>
              <span className="text-gray-800 font-medium text-right">{r.waarde}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tekstblokken */}
      {kaarten.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {kaarten.map(k => (
            <div key={k.sleutel} className="rounded-lg border border-gray-200 p-3">
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{color: 'var(--t-accent)'}}>{k.kop}</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{k.tekst}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BierInfoWeergave
