import React from 'react'
import { t } from '../../i18n'
import Segment from './Segment'
import ItemKiezer, { type KiesItem } from './ItemKiezer'
import LotVelden from './LotVelden'
import {
  zetHoeveelheid, zetPrijs, zetTotaal, zetBtw, totaalWeergave, laatsteInkoop,
  type InkoopRegel, type RegelSoort, type RegelFout,
} from '../../utils/inkoopRegels'
import {
  BUILTIN_ING_TYPES, BUILTIN_KOSTEN_SOORTEN, EENHEDEN, ONDERDEEL_TYPES, LOT_BREW_FIELDS_PER_TYPE, BREW_PROP_UNITS,
} from '../../utils/constants'
import { getEffectiveBrewProp, formatBrewValue } from '../../utils/brewProps'
import { fmt, fmtD } from '../../utils/format'
import type { MerchArtikel } from '../../utils/merch'

export interface RegelContext {
  ing: any[]
  lots: any[]
  onderdelen: any[]
  ingTypes: string[]
  ingTypeBtw: Record<string, number>
  kostenSoorten: string[]
  merch: MerchArtikel[]
  defaultType: string
}

interface RegelEditorProps {
  regel: InkoopRegel
  onWijzig: (r: InkoopRegel) => void
  /** Andere soort gekozen; de pagina zoekt de koppeling opnieuw en onthoudt de keuze. */
  onSoort: (s: RegelSoort) => void
  incl: boolean
  verlegd: boolean
  ctx: RegelContext
  fouten: RegelFout[]
  smal: boolean
  /** De etiketfoto's bij deze regel (alleen bij een ingrediënt dat een lot wordt). */
  etiket?: React.ReactNode
  /** Een bestaande factuur bewerken: geen lots, dus geen lotnummer of etiket. */
  bewerken: boolean
  /** Telefoon: de soort kiezen in een eigen paneel. */
  onKiesSoort?: () => void
}

export const ingTypeLabel = (ty: string): string => BUILTIN_ING_TYPES.includes(ty) ? t('ing_type_' + ty.toLowerCase()) : ty
export const kostensoortLabel = (ks: string): string => BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_' + ks.toLowerCase()) : ks
export const soortLabel = (s: RegelSoort): string =>
  s === 'ingredient' ? t('inkoop_soort_ingredient') : s === 'verpakking' ? t('inkoop_soort_verpakking') : t('inkoop_soort_overig')
const materiaalTypeLabel = (ty: string): string => {
  const o = ONDERDEEL_TYPES.find(x => x.type === ty)
  return o ? t(o.label) : ty
}
const bfLabel = (key: string): string => key === 'storage' ? t('brew_storage') : t('bf_' + key, key)
const bfOptie = (key: string, o: string): string => key === 'storage' ? t('brew_storage_' + o, o) : o

/** Een label rechts naast een veldnaam: waar de waarde vandaan komt. */
export const BronLabel: React.FC<{ bron: 'scan' | 'etiket' | null }> = ({ bron }) => {
  if (!bron) return null
  return bron === 'etiket'
    ? <span className="text-[11px] font-medium text-green-700 whitespace-nowrap">● {t('inkoop_bron_etiket')}</span>
    : <span className="text-[11px] text-gray-500 whitespace-nowrap">{t('inkoop_bron_scan')}</span>
}

const veldCls = (fout?: boolean) =>
  `w-full border rounded-lg px-3 py-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm ${fout ? 'border-red-400' : 'border-gray-200'}`

/**
 * Het bewerken van één regel, voor elke soort hetzelfde patroon: eerst wát
 * het is (soort en koppeling), dan hoeveel en wat het kost, dan lot en THT.
 * Op een bureau staat dit uitgeklapt onder de regel, op een telefoon in een
 * paneel van onderen.
 */
const RegelEditor: React.FC<RegelEditorProps> = ({ regel: r, onWijzig, onSoort, incl, verlegd, ctx, fouten, smal, etiket, bewerken, onKiesSoort }) => {
  const id = React.useId()
  const [eigenschappenOpen, setEigenschappenOpen] = React.useState(false)
  const scan = new Set(r.uitScan || [])
  const etiketVelden = new Set(r.uitEtiket || [])
  const bron = (veld: string): 'scan' | 'etiket' | null => etiketVelden.has(veld) ? 'etiket' : scan.has(veld) ? 'scan' : null
  const fout = (veld: RegelFout['veld']): string | null => {
    const f = fouten.find(x => x.veld === veld)
    return f ? t(f.sleutel) : null
  }
  /** Met de hand gewijzigd: het label "uit scan"/"etiket" van die velden verdwijnt. */
  const zet = (velden: string[], nieuw: InkoopRegel) => onWijzig({
    ...nieuw,
    uitScan: (nieuw.uitScan || []).filter(v => !velden.includes(v)),
    uitEtiket: (nieuw.uitEtiket || []).filter(v => !velden.includes(v)),
  })

  const ingItem = r.soort === 'ingredient' && r.koppelId ? ctx.ing.find((i: any) => String(i.id) === r.koppelId) : null
  const eenheid = t('unit_' + (r.eenh || 'stuks').toLowerCase(), r.eenh)

  // ── Soort ───────────────────────────────────────────────────────────────
  const soortKeuze = smal && onKiesSoort ? (
    <button type="button" onClick={onKiesSoort}
      className="w-full flex items-center justify-between gap-2 px-3 min-h-tap rounded-lg border border-gray-200 bg-white text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      <span>
        <span className="block text-xs text-gray-500">{t('inkoop_soort')}</span>
        <span className="text-sm font-medium text-gray-900">{soortLabel(r.soort)}</span>
      </span>
      <span className="text-xs text-gray-500">{r.soort === 'ingredient' ? t('inkoop_soort_ingredient_kort') : r.soort === 'verpakking' ? t('inkoop_soort_verpakking_kort') : t('inkoop_soort_overig_kort')}</span>
    </button>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-gray-700">{t('inkoop_soort')}</span>
      <Segment<RegelSoort> label={t('inkoop_soort')} waarde={r.soort} onKies={onSoort}
        opties={[
          { v: 'ingredient', l: t('inkoop_soort_ingredient') },
          { v: 'verpakking', l: t('inkoop_soort_verpakking') },
          { v: 'overig', l: t('inkoop_soort_overig') },
        ]} />
    </div>
  )

  const opFactuur = r.bron?.tekst ? (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600">
      <span className="font-medium text-gray-700">{t('inkoop_op_factuur')}:</span> {r.bron.tekst}
      {r.bron.aantal && r.bron.inhoudPerStuk && r.bron.inhoudPerStuk !== 1
        ? <span className="text-gray-500"> · {t('inkoop_bron_aantal').replace('{aantal}', String(r.bron.aantal)).replace('{inhoud}', String(r.bron.inhoudPerStuk)).replace('{eenheid}', r.bron.eenheid || '')}</span>
        : null}
      {typeof r.bron.netto === 'number' && <span className="text-gray-500"> · {fmt(r.bron.netto)}</span>}
      {r.verplaatstVan && <span className="block mt-0.5 text-gray-500">{t('inkoop_verplaatst_onthouden')}</span>}
    </div>
  ) : null

  // ── Bedrag en BTW (alle soorten) ──────────────────────────────────────────
  const btwKeuze = (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">{t('lbl_btw_pct')}{verlegd && <span className="ml-1 text-xs font-normal text-gray-500">({t('inkoop_btw_nl_tarief')})</span>}</span>
      <Segment<string> label={t('lbl_btw_pct')} waarde={String(Number(r.btw) || 0)}
        onKies={v => zet(['btw'], zetBtw(r, v, incl))}
        opties={['0', '9', '21'].map(v => ({ v, l: `${v}%` }))} cls="w-full sm:w-auto" />
    </div>
  )
  const totaalVeld = () => (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1.5 mb-1">
        <label htmlFor={`${id}-tot`} className="text-sm font-medium text-gray-700 truncate">{incl ? t('inkoop_bedrag_incl') : t('inkoop_bedrag_excl')}</label>
      </div>
      <input id={`${id}-tot`} type="number" inputMode="decimal" step="0.01" value={totaalWeergave(r, incl)}
        onChange={e => zet(['totaal', 'prijs'], zetTotaal(r, e.target.value, incl))}
        aria-invalid={fout('totaal') ? true : undefined}
        className={veldCls(!!fout('totaal'))} />
      {fout('totaal') && <p className="mt-1 text-xs text-red-600">{fout('totaal')}</p>}
    </div>
  )

  // ── Brouwkundige eigenschappen (ingrediënt) ──────────────────────────────
  const velden = r.soort === 'ingredient' ? (LOT_BREW_FIELDS_PER_TYPE[r.type || ingItem?.type || ''] || []) : []
  const vorige = r.koppelId ? laatsteInkoop(ctx.lots, r.koppelId) : null
  const eigenschapSamenvatting = (): string => {
    const eigen = velden.filter(f => r.bf_props?.[f.key] !== undefined && r.bf_props?.[f.key] !== '')
    if (eigen.length) {
      const tekst = eigen.slice(0, 3).map(f => `${bfLabel(f.key)} ${formatBrewValue(r.bf_props[f.key])}${BREW_PROP_UNITS[f.key] ? ' ' + BREW_PROP_UNITS[f.key] : ''}`).join(' · ')
      return `${tekst} (${eigen.some(f => etiketVelden.has('bf:' + f.key)) ? t('inkoop_van_etiket') : t('inkoop_ingevuld')})`
    }
    if (ingItem) {
      const terug = velden.map(f => ({ f, v: getEffectiveBrewProp(null, ingItem, f.key) })).filter(x => x.v !== undefined && x.v !== null && x.v !== '')
      if (terug.length) return `${terug.slice(0, 3).map(x => `${bfLabel(x.f.key)} ${formatBrewValue(x.v)}${BREW_PROP_UNITS[x.f.key] ? ' ' + BREW_PROP_UNITS[x.f.key] : ''}`).join(' · ')} (${t('inkoop_van_ingredient')})`
    }
    return t('inkoop_geen_eigenschappen')
  }
  const eigenschappen = velden.length > 0 && !bewerken ? (
    <div className="border-t border-gray-100 pt-3">
      <button type="button" onClick={() => setEigenschappenOpen(o => !o)} aria-expanded={eigenschappenOpen}
        className="w-full flex items-start gap-2 text-left">
        <span className="text-gray-400 text-xs mt-1">{eigenschappenOpen ? '▼' : '▶'}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-700">{t('brew_props_section')}</span>
          {!eigenschappenOpen && <span className="block text-xs text-gray-500 truncate">{eigenschapSamenvatting()}</span>}
        </span>
      </button>
      {eigenschappenOpen && (
        <div className="mt-2 space-y-2">
          {vorige?.bf_props && (
            <button type="button" className="text-xs t-accent-text font-medium"
              onClick={() => zet(velden.map(f => 'bf:' + f.key), { ...r, bf_props: { ...(vorige.bf_props || {}) } })}>
              {t('btn_copy_from_last_lot')}
            </button>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {velden.map(fld => {
              const unit = BREW_PROP_UNITS[fld.key]
              const label = unit ? `${bfLabel(fld.key)} (${unit})` : bfLabel(fld.key)
              const val = r.bf_props?.[fld.key] ?? ''
              const set = (v: unknown) => zet(['bf:' + fld.key], { ...r, bf_props: { ...(r.bf_props || {}), [fld.key]: v } })
              const terug = !val && ingItem ? getEffectiveBrewProp(null, ingItem, fld.key) : undefined
              return (
                <div key={fld.key}>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label htmlFor={`${id}-bf-${fld.key}`} className="text-xs font-medium text-gray-600 truncate">{label}</label>
                    <BronLabel bron={etiketVelden.has('bf:' + fld.key) ? 'etiket' : null} />
                  </div>
                  {fld.kind === 'select' ? (
                    <select id={`${id}-bf-${fld.key}`} value={String(val)} onChange={e => set(e.target.value)} className={veldCls()}>
                      <option value="">—</option>
                      {(fld.options || []).map(o => <option key={o} value={o}>{bfOptie(fld.key, o)}</option>)}
                    </select>
                  ) : (
                    <input id={`${id}-bf-${fld.key}`} type={fld.kind === 'number' ? 'number' : 'text'} inputMode={fld.kind === 'number' ? 'decimal' : undefined}
                      value={String(val)} onChange={e => set(fld.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
                      className={veldCls()} />
                  )}
                  {terug !== undefined && terug !== null && terug !== '' && (
                    <button type="button" onClick={() => set(fld.kind === 'number' ? Number(formatBrewValue(terug)) : formatBrewValue(terug))}
                      title={t('btn_use_bf_value')}
                      className="text-[11px] text-gray-500 hover:text-gray-800 mt-0.5 hover:underline">
                      {t('brew_props_fallback_hint').replace('{value}', formatBrewValue(terug))}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  ) : null

  // ── Per soort ─────────────────────────────────────────────────────────────
  let inhoud: React.ReactNode
  if (r.soort === 'ingredient') {
    const typeOpties = ctx.ingTypes
    inhoud = (
      <>
        <ItemKiezer label={t('inkoop_soort_ingredient')} items={ctx.ing as KiesItem[]} koppelId={r.koppelId} naam={r.naam}
          onKies={k => {
            const item = k.item as any
            const v = item ? laatsteInkoop(ctx.lots, item.id) : null
            zet(['naam'], {
              ...r, koppelId: k.koppelId, naam: k.naam,
              type: item?.type || r.type || ctx.defaultType,
              // Een bestaand ingrediënt zonder eenheid op de regel: de eenheid van de vorige inkoop.
              eenh: !r.qty && v?.gebruikelijkeEenheid ? v.gebruikelijkeEenheid : r.eenh,
              fabrikant: item ? '' : r.fabrikant,
            })
          }}
          kenmerk={i => ingTypeLabel(String(i.type || ''))}
          info={i => {
            const v = laatsteInkoop(ctx.lots, i.id)
            if (!v || v.prijs === null) return null
            return t('inkoop_laatste_inkoop')
              .replace('{prijs}', fmt(v.prijs)).replace('{eenheid}', t('unit_' + (v.eenheid || 'kg').toLowerCase(), v.eenheid))
              .replace('{leverancier}', v.leverancier || '—').replace('{datum}', v.datum ? fmtD(v.datum) : '—')
          }}
          nieuwLabel={t('inkoop_nieuw_ingredient')}
          fout={fout('naam')} bijLabel={<BronLabel bron={bron('naam')} />} nieuwChip={!r.koppelId && !!r.naam.trim()} />
        {!r.koppelId && r.naam.trim() && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${id}-type`} className="block text-sm font-medium text-gray-700 mb-1">{t('lbl_ingredient_type')}</label>
                <select id={`${id}-type`} value={r.type || ctx.defaultType}
                  onChange={e => {
                    const ty = e.target.value
                    const btw = ctx.ingTypeBtw[ty]
                    zet(['btw'], { ...r, type: ty, btw: btw !== undefined && !verlegd ? String(btw) : r.btw })
                  }} className={veldCls()}>
                  {typeOpties.map(ty => <option key={ty} value={ty}>{ingTypeLabel(ty)}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-1.5 mb-1">
                  <label htmlFor={`${id}-fab`} className="text-sm font-medium text-gray-700">{t('ing_manufacturer')}</label>
                  <BronLabel bron={bron('fabrikant')} />
                </div>
                <input id={`${id}-fab`} type="text" value={r.fabrikant} placeholder={t('ph_manufacturer')}
                  onChange={e => zet(['fabrikant'], { ...r, fabrikant: e.target.value })} className={veldCls()} />
              </div>
            </div>
            <p className="text-xs text-blue-800">{t('inkoop_nieuw_ingredient_uitleg')}</p>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-3">
          <div className="col-span-2 sm:col-span-1 min-w-0">
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-qty`} className="text-sm font-medium text-gray-700">{t('lbl_quantity')}</label>
              <BronLabel bron={bron('qty')} />
            </div>
            <div className="flex gap-1">
              <input id={`${id}-qty`} type="number" inputMode="decimal" value={r.qty} min={0}
                onChange={e => zet(['qty', 'prijs', 'totaal'], zetHoeveelheid(r, e.target.value))}
                aria-invalid={fout('qty') ? true : undefined} className={veldCls(!!fout('qty'))} />
              <select value={r.eenh} onChange={e => zet(['qty'], { ...r, eenh: e.target.value })} aria-label={t('lbl_unit')}
                className="w-28 flex-shrink-0 border border-gray-200 rounded-lg px-2 text-sm min-h-tap sm:min-h-0 bg-white t-input outline-none shadow-sm">
                {EENHEDEN.map(e => <option key={e} value={e}>{t('unit_' + e.toLowerCase())}</option>)}
              </select>
            </div>
            {fout('qty') && <p className="mt-1 text-xs text-red-600">{fout('qty')}</p>}
          </div>
          <div className="min-w-0">
            <div className="mb-1">
              <label htmlFor={`${id}-prijs`} className="block text-sm font-medium text-gray-700 truncate">{t('inkoop_prijs_per').replace('{eenheid}', eenheid)}</label>
            </div>
            <input id={`${id}-prijs`} type="number" inputMode="decimal" step="0.0001" value={r.prijs}
              onChange={e => zet(['prijs', 'totaal'], zetPrijs(r, e.target.value))} className={veldCls()} />
          </div>
          {totaalVeld()}
          <div className="col-span-2 sm:col-span-1">{btwKeuze}</div>
        </div>
        {!bewerken && (
          <div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="text-sm font-semibold text-gray-800">{t('inkoop_lot_en_tht')}</div>
            <LotVelden regel={r} onWijzig={(nieuw, velden) => zet(velden, nieuw)} fout={fout('lots')} />
            {etiket}
          </div>
        )}
        {eigenschappen}
      </>
    )
  } else if (r.soort === 'verpakking') {
    inhoud = (
      <>
        <ItemKiezer label={t('inkoop_soort_verpakking')} items={ctx.onderdelen as KiesItem[]} koppelId={r.koppelId} naam={r.naam}
          onKies={k => {
            const item = k.item as any
            zet(['naam'], { ...r, koppelId: k.koppelId, naam: k.naam, type: item?.type || r.type })
          }}
          kenmerk={i => materiaalTypeLabel(String(i.type || ''))}
          info={(i: any) => (Number(i.kosten_per_stuk) > 0
            ? t('inkoop_materiaal_info').replace('{prijs}', fmt(i.kosten_per_stuk)).replace('{voorraad}', String(Number(i.voorraad || 0)))
            : null)}
          nieuwLabel={t('inkoop_nieuw_materiaal')}
          fout={fout('naam')} bijLabel={<BronLabel bron={bron('naam')} />} nieuwChip={!r.koppelId && !!r.naam.trim()} />
        {!r.koppelId && r.naam.trim() && (
          <div>
            <label htmlFor={`${id}-mtype`} className="block text-sm font-medium text-gray-700 mb-1">{t('onderdeel_type')}</label>
            <select id={`${id}-mtype`} value={r.type} onChange={e => zet([], { ...r, type: e.target.value })} className={veldCls()}>
              <option value="">{t('packaging_choose_type')}</option>
              {ONDERDEEL_TYPES.map(o => <option key={o.type} value={o.type}>{t(o.label)}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-aantal`} className="text-sm font-medium text-gray-700">{t('inkoop_aantal_stuks')}</label>
              <BronLabel bron={bron('qty')} />
            </div>
            <input id={`${id}-aantal`} type="number" inputMode="numeric" value={r.qty} min={0}
              onChange={e => zet(['qty', 'prijs', 'totaal'], zetHoeveelheid(r, e.target.value))}
              aria-invalid={fout('qty') ? true : undefined} className={veldCls(!!fout('qty'))} />
            {fout('qty') && <p className="mt-1 text-xs text-red-600">{fout('qty')}</p>}
          </div>
          <div>
            <label htmlFor={`${id}-pps`} className="block text-sm font-medium text-gray-700 mb-1">{t('inkoop_prijs_per_stuk')}</label>
            <input id={`${id}-pps`} type="number" inputMode="decimal" step="0.0001" value={r.prijs}
              onChange={e => zet(['prijs', 'totaal'], zetPrijs(r, e.target.value))} className={veldCls()} />
          </div>
          {totaalVeld()}
          <div className="col-span-2 sm:col-span-1">{btwKeuze}</div>
        </div>
        {!bewerken && (
          <div>
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-mlot`} className="text-sm font-medium text-gray-700">{t('ing_lot_number')}</label>
              <BronLabel bron={bron('lotnr')} />
            </div>
            <input id={`${id}-mlot`} type="text" value={r.lotnr} autoComplete="off"
              onChange={e => zet(['lotnr'], { ...r, lotnr: e.target.value })} className={veldCls()} />
          </div>
        )}
      </>
    )
  } else {
    const merchId = String(r.merch_id || '')
    inhoud = (
      <>
        {r.correctie && <p className="text-xs text-gray-600 rounded-lg bg-gray-50 px-3 py-2">{t('inkoop_correctieregel_uitleg')}</p>}
        <div>
          <div className="flex items-baseline justify-between gap-1.5 mb-1">
            <label htmlFor={`${id}-oms`} className="text-sm font-medium text-gray-700">{t('lbl_omschrijving')}</label>
            <BronLabel bron={bron('naam')} />
          </div>
          <input id={`${id}-oms`} type="text" value={r.naam} placeholder={t('ph_vrije_regel')}
            onChange={e => zet(['naam'], { ...r, naam: e.target.value })}
            aria-invalid={fout('naam') ? true : undefined} className={veldCls(!!fout('naam'))} />
          {fout('naam') && <p className="mt-1 text-xs text-red-600">{fout('naam')}</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-3">
          <div className="col-span-2 sm:col-span-1 min-w-0">
            <div className="flex items-baseline justify-between gap-1.5 mb-1">
              <label htmlFor={`${id}-ks`} className="text-sm font-medium text-gray-700">{t('lbl_kostensoort')}</label>
              <BronLabel bron={bron('kostensoort')} />
            </div>
            <select id={`${id}-ks`} value={r.kostensoort || 'Overig'} onChange={e => zet(['kostensoort'], { ...r, kostensoort: e.target.value })} className={veldCls()}>
              {(ctx.kostenSoorten.includes(r.kostensoort) || !r.kostensoort ? ctx.kostenSoorten : [...ctx.kostenSoorten, r.kostensoort])
                .map(ks => <option key={ks} value={ks}>{kostensoortLabel(ks)}</option>)}
            </select>
          </div>
          {totaalVeld()}
          <div className="col-span-2 sm:col-span-1">{btwKeuze}</div>
        </div>
        {ctx.merch.length > 0 && !r.correctie && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
            <div className="text-sm font-medium text-purple-900">{t('merch_inkoop_koppel')}</div>
            <div className="grid grid-cols-3 gap-3">
              <select value={merchId} onChange={e => zet([], { ...r, merch_id: e.target.value })} aria-label={t('merch_titel_kort')}
                className={`${veldCls()} col-span-2`}>
                <option value="">{t('merch_inkoop_geen')}</option>
                {ctx.merch.map(m => <option key={m.id} value={String(m.id)}>{m.naam || m.sku}</option>)}
              </select>
              <input type="number" inputMode="numeric" min={0} step="1" value={r.merch_aantal} disabled={!merchId}
                aria-label={t('manual_order_qty')} placeholder={t('manual_order_qty')}
                onChange={e => zet([], { ...r, merch_aantal: e.target.value })}
                className={`${veldCls(!!fout('merch'))} disabled:opacity-40`} />
            </div>
            {fout('merch') ? <p className="text-xs text-red-600">{fout('merch')}</p> : <p className="text-xs text-purple-800">{t('merch_inkoop_hint')}</p>}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="space-y-3">
      {!r.correctie && soortKeuze}
      {opFactuur}
      {inhoud}
    </div>
  )
}

export default RegelEditor
