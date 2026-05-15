import React from 'react'
import { t } from '../../i18n'
import { newId, mapHopGebruik } from '../../utils/api'
import { tod } from '../../utils/format'
import {
  mashEfficiency, brouwzaalEfficiency, kookVerdampingPct,
  iBUTinseth, totaalMaxExtract, hopVerouderdeAlpha
} from '../../utils/calculations'
import Btn from '../ui/Btn'
import SectionHeader from '../ui/SectionHeader'
import type { BrouwdagStap, BrouwdagFase, Batch, BatchIngredient } from '../../types'

interface Props {
  batch: Batch
  setBat: any
  bi: BatchIngredient[]
  setBi?: any
  stappen: BrouwdagStap[]
  setStappen: any
  tanks?: any[]
  lots?: any[]
  ingredienten?: any[]
  // Globale fallback voor opslag-conditie (uit instellingen). Lots met
  // een eigen `bf_props.storage` overrulen deze waarde.
  hopStorageDefault?: string
  // Alle recepten — gebruikt om hop-tijden/alpha uit het gekoppelde recept
  // op te halen via de "Tijden uit recept"-knop.
  recepten?: any[]
}

const FASE_VOLGORDE: BrouwdagFase[] = ['water', 'maisch', 'lauter', 'koken', 'koelen', 'og']
const FASE_LABEL: Record<BrouwdagFase, string> = {
  water: 'brouwdag_fase_water',
  maisch: 'brouwdag_fase_maisch',
  lauter: 'brouwdag_fase_lauter',
  koken: 'brouwdag_fase_koken',
  koelen: 'brouwdag_fase_koelen',
  og: 'brouwdag_fase_og',
}

// Brouwdag-wizard met stappen per fase + kernmeetwaarden + live calculaties.
// Bouwt het label voor een hop-additie stap dynamisch op uit de huidige
// gegevens van het gekoppelde batch_ingredient. Zo werken wijzigingen in
// het Hop-schema (tijdstip, naam) direct door in de stappenlijst.
const hopAddLabel = (h: any): string => {
  const tijdMin = h && h.tijdstip_min != null && h.tijdstip_min !== '' ? Number(h.tijdstip_min) : null
  return t('brouwdag_label_hop_add')
    .replace('{n}', h?.ingredient_naam || '')
    .replace('{t}', tijdMin != null ? String(tijdMin) : '?')
}

// Bepaalt de effectieve α-zuur% voor een hop-additie. Volgorde:
//   1. handmatige waarde op het batch_ingredient (override)
//   2. lot-specifieke α uit `Lot.bf_props.alpha` (chargespecifiek)
//      Past optioneel verouderings-correctie toe wanneer het lot een
//      oogstjaar (`bf_props.year`) of aankoopdatum heeft.
//   3. ingredient-default α uit `Ingredient.bf_props.alpha`
// Geeft tevens de bron terug zodat de UI dit kan tonen.
type AlphaBron = 'manual' | 'lot' | 'lot_verouderd' | 'ingredient' | 'none'

interface EffAlphaResult {
  alpha: number
  bron: AlphaBron
  lot?: any
  // Voor verouderde lots: oorspronkelijke α + leeftijd + behoud%
  alphaOrigineel?: number
  leeftijdJaren?: number
  behoudPct?: number
  opslag?: string
}

const effectieveAlpha = (
  h: any,
  lots: any[] = [],
  ingredienten: any[] = [],
  refDatum?: string,
  storageDefault: string = 'vacuum_koel'
): EffAlphaResult => {
  if (h?.alpha_pct != null && h.alpha_pct !== '' && Number(h.alpha_pct) > 0) {
    return {alpha: Number(h.alpha_pct), bron: 'manual'}
  }
  const lot = h?.lot_id ? (lots || []).find(l => String(l.id) === String(h.lot_id)) : null
  const lotAlpha = lot?.bf_props?.alpha
  if (lotAlpha != null && Number(lotAlpha) > 0) {
    // Verouderings-correctie: kijk naar bf_props.year (Brewfather-veld) of
    // val terug op de aankoopdatum als ruwe schatting. Opslag-conditie:
    // lot-eigen waarde > globale default uit instellingen.
    const oogst = lot?.bf_props?.year || lot?.aankoop_datum || lot?.aankoopdatum
    const opslag = lot?.bf_props?.storage || storageDefault
    const hsi = lot?.bf_props?.hsi
    if (oogst) {
      const v = hopVerouderdeAlpha(Number(lotAlpha), oogst, opslag, hsi ?? 0.30, refDatum)
      if (v.leeftijdJaren > 0 && v.behoudPct < 99.5) {
        return {
          alpha: v.alpha, bron: 'lot_verouderd', lot,
          alphaOrigineel: v.alphaOrigineel,
          leeftijdJaren: v.leeftijdJaren,
          behoudPct: v.behoudPct,
          opslag: v.opslag,
        }
      }
    }
    return {alpha: Number(lotAlpha), bron: 'lot', lot}
  }
  const ingr = h?.ingredient_id ? (ingredienten || []).find(i => i.id === h.ingredient_id) : null
  const ingAlpha = ingr?.bf_props?.alpha
  if (ingAlpha != null && Number(ingAlpha) > 0) {
    return {alpha: Number(ingAlpha), bron: 'ingredient'}
  }
  return {alpha: 0, bron: 'none'}
}

const BrouwdagWizard: React.FC<Props> = ({batch, setBat, bi, setBi, stappen, setStappen, tanks = [], lots = [], ingredienten = [], hopStorageDefault = 'vacuum_koel', recepten = []}) => {
  const mijnStappen = (stappen || []).filter(s => s.batch_id === batch.id)
  const batchBi = (bi || []).filter(i => i.batch_id === batch.id)
  const [stappenOpen, setStappenOpen] = React.useState<boolean>(true)
  const [hopOpen, setHopOpen] = React.useState<boolean>(true)

  // Resolved label voor een stap: bij gekoppelde hop-additie wordt het
  // label live uit batch_ingredienten gehaald. Fallback voor oude stappen
  // zonder batch_ingredient_id: probeer te matchen op naam uit het opgeslagen
  // label ("Hop-additie: NAAM @").
  const resolveStapLabel = (s: BrouwdagStap): string => {
    if (s.fase === 'koken' && s.batch_ingredient_id != null) {
      const h = batchBi.find(b => b.id === s.batch_ingredient_id)
      if (h) return hopAddLabel(h)
    }
    if (s.fase === 'koken' && s.label) {
      const m = s.label.match(/^[^:]+:\s*(.+?)\s*@/)
      if (m) {
        const naam = m[1].trim()
        const h = batchBi.find(b =>
          String(b.ingredient_type).toLowerCase() === 'hop' &&
          (b.ingredient_naam || '').trim() === naam
        )
        if (h) return hopAddLabel(h)
      }
    }
    return s.label
  }

  // Recept van deze batch (indien gekoppeld). `is_huidige` zorgt dat we de
  // actuele recept-versie pakken, niet een gearchiveerde.
  const batchRecept = batch.recept_id
    ? recepten.find((r: any) => r.id === batch.recept_id && r.is_huidige !== false)
    : null

  // Kopieert hop-tijden, alpha-zuur en gebruik (boil/dry-hop/whirlpool) uit
  // het gekoppelde recept naar de batch-ingrediënten. Matcht op naam (case-
  // insensitive). Werkt voor bestaande batches die vóór v1.9.64 zijn
  // aangemaakt of waar de tijden anderszins ontbreken. Vult alleen lege
  // velden; bestaande handmatige waarden blijven behouden.
  const syncHopUitRecept = () => {
    if (!setBi || !batchRecept) return
    const receptHops = (batchRecept.hop || []) as any[]
    if (receptHops.length === 0) {
      alert(t('hop_schema_recept_geen_hops'))
      return
    }
    setBi((prev: any[]) => prev.map(x => {
      if (x.batch_id !== batch.id) return x
      if (String(x.ingredient_type).toLowerCase() !== 'hop') return x
      // Match op naam (case-insensitive). Bij meerdere additions met dezelfde
      // naam in het recept, pakken we voorlopig de eerste — voor een echt
      // sluitende sync zou je per-additie indexeren (bv. via tijd-match).
      const naam = String(x.ingredient_naam || '').trim().toLowerCase()
      const match = receptHops.find(rh => String(rh.naam || '').trim().toLowerCase() === naam)
      if (!match) return x
      const upd: any = {}
      // Alleen vullen wanneer leeg — overschrijf geen handmatige waarden.
      if ((x.tijdstip_min == null || x.tijdstip_min === '') && match.tijd != null && match.tijd !== '') {
        upd.tijdstip_min = Number(match.tijd) || 0
      }
      if ((x.alpha_pct == null || x.alpha_pct === '') && match.alpha_pct != null && match.alpha_pct !== '') {
        upd.alpha_pct = Number(match.alpha_pct) || 0
      }
      // Gebruik altijd normaliseren (ook als bestaande waarde 'Aroma' is —
      // dat moet 'whirlpool' worden). Overschrijf alleen wanneer het recept
      // een waarde levert.
      if (match.gebruik) {
        const genormaliseerd = mapHopGebruik(match.gebruik)
        if (genormaliseerd !== String(x.gebruik || '').toLowerCase()) {
          upd.gebruik = genormaliseerd
        }
      }
      if ((x.temp_c == null || x.temp_c === '') && match.temp_c != null && match.temp_c !== '') {
        upd.temp_c = Number(match.temp_c) || 0
      }
      return Object.keys(upd).length > 0 ? {...x, ...upd} : x
    }))
  }

  // Verwijdert alle bestaande hop-additie-stappen voor deze batch en regenereert
  // ze op basis van het actuele Hop-schema. Behoudt de overige brouwdag-stappen
  // (water/maisch/lauter/koelen/og + hand-toegevoegde stappen).
  const syncHopStappen = () => {
    const hopAddities = batchBi
      .filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
      .filter(i => !i.gebruik || String(i.gebruik).toLowerCase() === 'boil' || String(i.gebruik).toLowerCase() === 'kook')
      .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))

    setStappen((prev: any[]) => {
      const isHopStap = (s: any) =>
        s.batch_id === batch.id && s.fase === 'koken' && (
          s.batch_ingredient_id != null ||
          (typeof s.label === 'string' && /^[^:]+:\s*.+?\s*@/.test(s.label))
        )
      const overig = (prev || []).filter((s: any) => !isHopStap(s))
      const maxVolgorde = overig
        .filter((s: any) => s.batch_id === batch.id && s.fase === 'koken')
        .reduce((m: number, s: any) => Math.max(m, s.volgorde || 0), 0)
      let id = newId(overig)
      let volgorde = maxVolgorde + 1
      const nieuwe: BrouwdagStap[] = hopAddities.map(h => ({
        id: id++, batch_id: batch.id, fase: 'koken' as BrouwdagFase, volgorde: volgorde++,
        label: hopAddLabel(h),
        batch_ingredient_id: h.id,
        doel: `${h.hoeveelheid}${h.eenheid || 'g'}`,
        doel_eenheid: 'g',
        created_at: new Date().toISOString(),
      }))
      return [...overig, ...nieuwe]
    })
  }

  // ── Kerngegevens-velden direct op batch ───────────────────────────────────
  const updField = (veld: keyof Batch, val: any) => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, [veld]: val} : b))
  }

  // ── Auto-berekende waarden ────────────────────────────────────────────────
  const fermentables = batchBi.filter(i => String(i.ingredient_type).toLowerCase().includes('mout') || String(i.ingredient_type).toLowerCase() === 'suiker')
  const maxExtract = totaalMaxExtract(fermentables as any)
  const mashEff = mashEfficiency(Number(batch.pre_boil_sg), Number(batch.pre_boil_volume_l), fermentables as any)
  const brEff = brouwzaalEfficiency(Number(batch.OG), Number(batch.gist_volume_l || batch.liter_vergist), fermentables as any)
  const verdamping = kookVerdampingPct(Number(batch.kook_volume_start_l), Number(batch.kook_volume_eind_l), Number(batch.kooktijd))
  const hops = batchBi.filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
  // Vervang alpha_pct door effectieve waarde uit lot/ingredient — inclusief
  // verouderings-correctie wanneer het lot een oogstjaar heeft. De
  // brouwdatum geldt als referentie zodat IBU consistent blijft als het
  // batch later opnieuw wordt geopend. `gram` expliciet zetten zodat de
  // Tinseth-formule de juiste hoeveelheid pakt (batch_ingredient.hoeveelheid).
  const hopsVoorIBU = hops.map(h => ({
    ...h,
    gram: Number(h.hoeveelheid) || 0,
    alpha_pct: effectieveAlpha(h, lots, ingredienten, batch.datum, hopStorageDefault).alpha,
  }))
  // Volume-fallback: gemeten post-boil > recept boilSize > liter_vergist.
  // `pre_boil_volume_l` zou te groot zijn (telt verdamping mee), dus dat
  // gebruiken we niet als fallback.
  const ibuVolume = Number(batch.kook_volume_eind_l) || Number(batch.kook_volume) || Number(batch.gist_volume_l) || Number(batch.liter_vergist) || 0
  const ibu = iBUTinseth(hopsVoorIBU as any, Number(batch.OG) || 0, ibuVolume)

  // Persisteer berekende waarden zodra de inputs aanwezig zijn — zo blijven ze
  // beschikbaar voor overzicht/print zonder steeds herberekenen.
  React.useEffect(() => {
    const upd: Partial<Batch> = {}
    if (mashEff > 0 && Number(batch.mash_efficiency_pct) !== Math.round(mashEff * 10) / 10) {
      upd.mash_efficiency_pct = Math.round(mashEff * 10) / 10
    }
    if (brEff > 0 && Number(batch.brouwzaal_efficiency_pct) !== Math.round(brEff * 10) / 10) {
      upd.brouwzaal_efficiency_pct = Math.round(brEff * 10) / 10
    }
    if (verdamping > 0 && Number(batch.kook_verdamping_pct) !== Math.round(verdamping * 10) / 10) {
      upd.kook_verdamping_pct = Math.round(verdamping * 10) / 10
    }
    if (ibu > 0 && Number(batch.ibu_berekend) !== ibu) {
      upd.ibu_berekend = ibu
    }
    if (Object.keys(upd).length) {
      setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, ...upd} : b))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mashEff, brEff, verdamping, ibu])

  // ── Stappen genereren uit recept ──────────────────────────────────────────
  const genereerStappen = () => {
    const nieuwe: BrouwdagStap[] = []
    let id = newId(stappen || [])
    let volgorde = 0

    // 1. Water
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'water', volgorde: volgorde++,
      label: t('brouwdag_label_water_volume'),
      created_at: new Date().toISOString(),
    })

    // 2. Maisch — uit maischprofiel
    const maisch = (batch as any).maischprofiel || []
    maisch.forEach((stap: any, i: number) => {
      const naam = stap.naam || stap.type || t('brouwdag_label_maisch_stap').replace('{n}', String(i + 1))
      nieuwe.push({
        id: id++, batch_id: batch.id, fase: 'maisch', volgorde: volgorde++,
        label: naam,
        doel: stap.temp ? `${stap.temp}°C / ${stap.tijd || '?'}min` : '',
        doel_eenheid: '°C/min',
        created_at: new Date().toISOString(),
      })
    })

    // 3. Lauter / pre-boil meting
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'lauter', volgorde: volgorde++,
      label: t('brouwdag_label_meet_pre_boil'),
      created_at: new Date().toISOString(),
    })

    // 4. Koken — start + hop-additions uit batch_ingredienten
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'koken', volgorde: volgorde++,
      label: t('brouwdag_fase_koken') + ` (${batch.kooktijd || '?'} min)`,
      doel: batch.kooktijd ? `${batch.kooktijd} min` : '',
      doel_eenheid: 'min',
      created_at: new Date().toISOString(),
    })

    const hopAddities = batchBi
      .filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
      .filter(i => !i.gebruik || String(i.gebruik).toLowerCase() === 'boil' || String(i.gebruik).toLowerCase() === 'kook')
      .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))
    hopAddities.forEach((h: any) => {
      nieuwe.push({
        id: id++, batch_id: batch.id, fase: 'koken', volgorde: volgorde++,
        // Label is een fallback-momentopname. De render gebruikt
        // batch_ingredient_id om het label live op te bouwen uit het
        // huidige Hop-schema.
        label: hopAddLabel(h),
        batch_ingredient_id: h.id,
        doel: `${h.hoeveelheid}${h.eenheid || 'g'}`,
        doel_eenheid: 'g',
        created_at: new Date().toISOString(),
      })
    })

    // 5. Koelen
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'koelen', volgorde: volgorde++,
      label: t('brouwdag_label_koelen'),
      created_at: new Date().toISOString(),
    })

    // 6. OG-meting
    nieuwe.push({
      id: id++, batch_id: batch.id, fase: 'og', volgorde: volgorde++,
      label: t('brouwdag_label_meet_og'),
      doel: batch.OG ? `${batch.OG}` : '',
      doel_eenheid: 'SG',
      created_at: new Date().toISOString(),
    })

    setStappen((prev: any[]) => [...(prev || []), ...nieuwe])
  }

  const togglevoltooid = (id: number) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id
      ? {...s, voltooid: !s.voltooid, voltooid_op: !s.voltooid ? new Date().toISOString() : undefined}
      : s))
  }

  const updGemeten = (id: number, val: string) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id ? {...s, gemeten: val} : s))
  }

  const updOpmerking = (id: number, val: string) => {
    setStappen((prev: any[]) => prev.map(s => s.id === id ? {...s, opmerking: val} : s))
  }

  const deleteStap = (id: number) => {
    setStappen((prev: any[]) => prev.filter(s => s.id !== id))
  }

  const voegStapToe = (fase: BrouwdagFase) => {
    const existing = mijnStappen.filter(s => s.fase === fase)
    const id = newId(stappen || [])
    const volgorde = Math.max(0, ...mijnStappen.map(s => s.volgorde || 0)) + 1
    const nieuw: BrouwdagStap = {
      id, batch_id: batch.id, fase, volgorde,
      label: `${t(FASE_LABEL[fase])} ${existing.length + 1}`,
      created_at: new Date().toISOString(),
    }
    setStappen((prev: any[]) => [...(prev || []), nieuw])
  }

  const rondAf = () => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, brouwdag_voltooid: true} : b))
  }

  // Render
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={t('brouwdag_titel')}
          info={batch.brouwdag_voltooid ? <span className="text-emerald-300">{t('brouwdag_brouwdag_voltooid')}</span> : null}
          solid
        />
      </div>

      {/* Kerngegevens — invoer voor calculaties. Onder elke input toont een
          mini-label de doelwaarde uit het gekoppelde recept (indien beschikbaar)
          zodat je tijdens het brouwen meteen ziet waar je naartoe moet werken. */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {t('brouwdag_kerngegevens')}
        </div>
        {(() => {
          // Doel-waardes uit recept (of batch-velden als fallback voor pre-fill).
          const rec = batchRecept || {}
          // Geschatte pre-boil SG: ruwe schatting op basis van OG, batch-grootte
          // en kook-volume. Aanname: alle suiker zit al in het wort voor het
          // koken, dus pre-boil SG verhoudt zich tot OG als batch_size/kook_vol.
          const doelOG = Number(rec.OG) || Number(batch.OG) || null
          const doelBatchSize = Number(rec.batch_size) || null
          const doelKookVol = Number(rec.kook_volume) || null
          const doelPreBoilSg = (doelOG && doelBatchSize && doelKookVol && doelKookVol > 0)
            ? 1 + (doelOG - 1) * (doelBatchSize / doelKookVol)
            : null
          const Doel: React.FC<{value: any, unit?: string, decimals?: number}> = ({value, unit = '', decimals}) => {
            if (value == null || value === '' || (typeof value === 'number' && isNaN(value))) return null
            const fmt = typeof value === 'number' && decimals != null ? value.toFixed(decimals) : String(value)
            return <div className="text-[10px] text-gray-400 mt-0.5">{t('brouwdag_doel')}: {fmt}{unit}</div>
          }
          return (
            <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_pre_boil_sg')}</label>
            <input type="number" step="0.001" value={batch.pre_boil_sg ?? ''}
              onChange={e => updField('pre_boil_sg', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="1.045" />
            <Doel value={doelPreBoilSg} decimals={3} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_pre_boil_vol')}</label>
            <input type="number" step="0.1" value={batch.pre_boil_volume_l ?? ''}
              onChange={e => updField('pre_boil_volume_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="28" />
            <Doel value={doelKookVol} unit=" L" decimals={1} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_kook_vol_start')}</label>
            <input type="number" step="0.1" value={batch.kook_volume_start_l ?? ''}
              onChange={e => updField('kook_volume_start_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="28" />
            <Doel value={doelKookVol} unit=" L" decimals={1} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_kook_vol_eind')}</label>
            <input type="number" step="0.1" value={batch.kook_volume_eind_l ?? ''}
              onChange={e => updField('kook_volume_eind_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="24" />
            <Doel value={doelBatchSize} unit=" L" decimals={1} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_og_meting')}</label>
            <input type="number" step="0.001" value={batch.OG ?? ''}
              onChange={e => updField('OG' as any, e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="1.052" />
            <Doel value={Number(rec.OG) || null} decimals={3} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('brouwdag_gist_vol')}</label>
            <input type="number" step="0.1" value={batch.gist_volume_l ?? ''}
              onChange={e => updField('gist_volume_l', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="22" />
            <Doel value={doelBatchSize} unit=" L" decimals={1} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('lbl_liters_fermented')}</label>
            <input type="number" step="0.1" value={batch.liter_vergist ?? ''}
              onChange={e => updField('liter_vergist', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="22" />
            <Doel value={doelBatchSize} unit=" L" decimals={1} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('batch_info_mash_ph')}</label>
            <input type="number" step="0.01" value={batch.maisch_ph ?? ''}
              onChange={e => updField('maisch_ph', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="5.40" />
            <div className="text-[10px] text-gray-400 mt-0.5">{t('brouwdag_typisch')}: 5.2–5.4</div>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('batch_info_product_ph')}</label>
            <input type="number" step="0.01" value={batch.product_ph ?? ''}
              onChange={e => updField('product_ph', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="4.40" />
            <div className="text-[10px] text-gray-400 mt-0.5">{t('brouwdag_typisch')}: 4.2–4.6</div>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('lbl_tank')}</label>
            {tanks && tanks.length > 0 ? (
              <select value={batch.tank || ''}
                onChange={e => updField('tank', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 t-input">
                <option value="">{t('batch_no_tank')}</option>
                {tanks.map((tk: any) => (
                  <option key={tk.id} value={tk.id}>{tk.naam || tk.id}</option>
                ))}
              </select>
            ) : (
              <input value={batch.tank || ''}
                onChange={e => updField('tank', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder="T1" />
            )}
          </div>
        </div>
            </>
          )
        })()}

        {/* Live calculaties */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <CalcCard label={t('brouwdag_calc_mash_eff')} value={mashEff > 0 ? `${mashEff.toFixed(1)}%` : null} />
          <CalcCard label={t('brouwdag_calc_brouwzaal_eff')} value={brEff > 0 ? `${brEff.toFixed(1)}%` : null} />
          <CalcCard label={t('brouwdag_kook_verdamping')} value={verdamping > 0 ? `${verdamping.toFixed(1)}%/u` : null} />
          <CalcCard label={t('brouwdag_calc_ibu_tinseth')} value={ibu > 0 ? `${ibu}` : null} hint={ibu > 0 ? t('calc_disclaimer_tinseth') : ''} />
        </div>
        {maxExtract === 0 && (fermentables.length > 0) && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚠ {t('calc_geen_data')}: extract% (yield) ontbreekt op mout. Voeg toe via Brewfather-sync of handmatig in batch-ingrediënten.
          </div>
        )}
      </div>

      {/* Hop-schema (kook-additie tijden — bewerkbaar) */}
      {(() => {
        const hops = batchBi.filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
        const updHop = (hopId: number, veld: 'tijdstip_min' | 'alpha_pct' | 'gebruik' | 'lot_id' | 'temp_c', val: any) => {
          if (!setBi) return
          setBi((prev: any[]) => prev.map(x => x.id === hopId ? {...x, [veld]: val} : x))
        }
        // Vind beschikbare lots per hop-additie (alleen lots van hetzelfde
        // ingredient_id, met voorraad of zonder voorraad-eis voor archief).
        const beschikbareLots = (h: any) => h.ingredient_id
          ? (lots || []).filter(l => l.ingredient_id === h.ingredient_id)
          : []
        return (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader
              title={t('hop_schema_titel')}
              open={hopOpen}
              onToggle={() => setHopOpen(o => !o)}
              info={hops.length > 0
                ? (ibu > 0 ? `${hops.length} · IBU ${ibu.toFixed(1)}` : `${hops.length}`)
                : null}
            />
            {hopOpen && (
              <div className="p-4">
                {/* IBU-totaalbox bovenaan — toont berekende IBU + (indien
                    aanwezig) het doel uit het recept. Update live wanneer
                    tijden/alpha/lots worden aangepast. */}
                {hops.length > 0 && (() => {
                  const doelIBU = Number(batchRecept?.IBU) || null
                  const verschil = doelIBU != null && ibu > 0 ? ibu - doelIBU : null
                  return (
                    <div className="mb-3 flex items-baseline justify-between bg-gray-50 border border-gray-200 rounded px-3 py-2">
                      <div className="text-xs text-gray-500 uppercase font-semibold tracking-wide">
                        {t('brouwdag_calc_ibu_tinseth')}
                      </div>
                      <div className="flex items-baseline gap-3">
                        {doelIBU != null && (
                          <div className="text-xs text-gray-500">
                            {t('brouwdag_doel')}: <span className="font-medium text-gray-700">{doelIBU.toFixed(1)}</span>
                          </div>
                        )}
                        <div className="text-2xl font-bold" style={{color: 'var(--t-accent)'}}>
                          {ibu > 0 ? ibu.toFixed(1) : '—'}
                        </div>
                        {verschil != null && Math.abs(verschil) >= 0.5 && (
                          <div className={`text-xs ${verschil > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                            ({verschil > 0 ? '+' : ''}{verschil.toFixed(1)})
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {hops.length === 0 ? (
                  <div className="text-sm text-gray-500 italic">{t('hop_schema_geen')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500 bg-gray-50">
                        <tr>
                          <th className="px-3 py-1.5 text-left">{t('lbl_name')}</th>
                          <th className="px-3 py-1.5 text-right">{t('lbl_quantity')}</th>
                          <th className="px-3 py-1.5 text-left">{t('hop_schema_lot')}</th>
                          <th className="px-3 py-1.5 text-right">α %</th>
                          <th className="px-3 py-1.5 text-right">{t('hop_schema_tijdstip')}</th>
                          <th className="px-3 py-1.5 text-left">{t('hop_schema_gebruik')}</th>
                          <th className="px-3 py-1.5 text-right">{t('hop_schema_temp')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {hops
                          .slice()
                          .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))
                          .map((h: any) => {
                          const lotsBeschikbaar = beschikbareLots(h)
                          const eff = effectieveAlpha(h, lots, ingredienten, batch.datum, hopStorageDefault)
                          const fmtLeeftijd = (jaren: number): string => {
                            const mnd = Math.round(jaren * 12)
                            if (mnd < 12) return `${mnd}m`
                            const j = Math.floor(jaren)
                            const r = Math.round((jaren - j) * 12)
                            return r === 0 ? `${j}j` : `${j}j ${r}m`
                          }
                          const lotLabel = (l: any): string => {
                            let parts = [l.lotnr || `#${l.id}`]
                            const aOrig = l.bf_props?.alpha
                            const oogst = l.bf_props?.year || l.aankoop_datum || l.aankoopdatum
                            if (aOrig != null) {
                              if (oogst) {
                                const v = hopVerouderdeAlpha(Number(aOrig), oogst, l.bf_props?.storage || hopStorageDefault, l.bf_props?.hsi ?? 0.30, batch.datum)
                                if (v.leeftijdJaren > 0 && v.behoudPct < 99.5) {
                                  parts.push(`α ${aOrig}% → ${v.alpha.toFixed(1)}% (${fmtLeeftijd(v.leeftijdJaren)})`)
                                } else {
                                  parts.push(`α ${aOrig}%`)
                                }
                              } else {
                                parts.push(`α ${aOrig}%`)
                              }
                            }
                            return parts.join(' · ')
                          }
                          return (
                          <tr key={h.id}>
                            <td className="px-3 py-1.5">{h.ingredient_naam}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{h.hoeveelheid} {h.eenheid || 'g'}</td>
                            <td className="px-3 py-1.5">
                              {lotsBeschikbaar.length > 0 ? (
                                <select value={h.lot_id || ''}
                                  onChange={e => updHop(h.id, 'lot_id', e.target.value ? Number(e.target.value) : '')}
                                  className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input max-w-[16rem]">
                                  <option value="">{t('hop_schema_geen_lot')}</option>
                                  {lotsBeschikbaar.map((l: any) => (
                                    <option key={l.id} value={l.id}>{lotLabel(l)}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input type="number" step="0.1" value={h.alpha_pct ?? ''}
                                onChange={e => updHop(h.id, 'alpha_pct', e.target.value)}
                                placeholder={eff.bron !== 'manual' && eff.alpha > 0 ? eff.alpha.toFixed(1) : ''}
                                title={eff.bron === 'lot' ? t('hop_schema_alpha_uit_lot').replace('{lot}', eff.lot?.lotnr || `#${eff.lot?.id}`)
                                  : eff.bron === 'lot_verouderd' ? t('hop_schema_alpha_verouderd')
                                      .replace('{lot}', eff.lot?.lotnr || `#${eff.lot?.id}`)
                                      .replace('{orig}', String(eff.alphaOrigineel?.toFixed(1)))
                                      .replace('{eff}', eff.alpha.toFixed(1))
                                      .replace('{age}', fmtLeeftijd(eff.leeftijdJaren || 0))
                                      .replace('{behoud}', String(Math.round(eff.behoudPct || 0)))
                                      .replace('{opslag}', t('hop_opslag_' + (eff.opslag || 'vacuum_koel')))
                                  : eff.bron === 'ingredient' ? t('hop_schema_alpha_uit_ing')
                                  : eff.bron === 'manual' ? t('hop_schema_alpha_handmatig')
                                  : ''}
                                className={`w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right t-input ${
                                  eff.bron === 'lot' ? 'bg-emerald-50'
                                    : eff.bron === 'lot_verouderd' ? 'bg-amber-50'
                                    : eff.bron === 'ingredient' ? 'bg-blue-50' : ''
                                }`} />
                              {eff.bron === 'lot' && (
                                <div className="text-[10px] text-emerald-600 mt-0.5">{t('hop_schema_bron_lot')}</div>
                              )}
                              {eff.bron === 'lot_verouderd' && (
                                <div className="text-[10px] text-amber-700 mt-0.5">
                                  {t('hop_schema_bron_lot_verouderd').replace('{behoud}', String(Math.round(eff.behoudPct || 0)))}
                                </div>
                              )}
                              {eff.bron === 'ingredient' && !h.alpha_pct && (
                                <div className="text-[10px] text-blue-600 mt-0.5">{t('hop_schema_bron_ing')}</div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input type="number" step="1" value={h.tijdstip_min ?? ''}
                                onChange={e => updHop(h.id, 'tijdstip_min', e.target.value)}
                                className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right t-input"
                                placeholder="60" />
                              <span className="text-xs text-gray-400 ml-1">{t('lbl_minuten')}</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <select value={String(h.gebruik || 'boil').toLowerCase()}
                                onChange={e => updHop(h.id, 'gebruik', e.target.value)}
                                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input">
                                <option value="boil">{t('hop_gebruik_boil')}</option>
                                <option value="whirlpool">{t('hop_gebruik_whirlpool')}</option>
                                <option value="dry hop">{t('hop_gebruik_dryhop')}</option>
                                <option value="mash">{t('hop_gebruik_mash')}</option>
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {/* Temperatuur is alleen relevant voor whirlpool/
                                  aroma; voor boil verbergen we het veld om
                                  ruimte te besparen. */}
                              {String(h.gebruik || '').toLowerCase() === 'whirlpool' ? (
                                <>
                                  <input type="number" step="1" value={h.temp_c ?? ''}
                                    onChange={e => updHop(h.id, 'temp_c', e.target.value)}
                                    className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right t-input"
                                    placeholder="80" />
                                  <span className="text-xs text-gray-400 ml-1">°C</span>
                                </>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-gray-400 italic flex-1 min-w-0">{t('hop_schema_hint')}</div>
                  <div className="flex gap-2">
                    {hops.length > 0 && batchRecept && (
                      <Btn s="sm" v="secondary" onClick={syncHopUitRecept}
                        title={t('hop_schema_uit_recept_hint').replace('{recept}', batchRecept.naam || '')}>
                        {t('hop_schema_uit_recept')}
                      </Btn>
                    )}
                    {hops.length > 0 && (
                      <Btn s="sm" v="secondary" onClick={syncHopStappen}
                        title={t('hop_schema_sync_hint')}>
                        {t('hop_schema_sync')}
                      </Btn>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Stappenlijst */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <SectionHeader
          title={t('brouwdag_stappen_titel')}
          open={stappenOpen}
          onToggle={() => setStappenOpen(o => !o)}
          info={mijnStappen.length > 0
            ? `${mijnStappen.filter(s => s.voltooid).length}/${mijnStappen.length}`
            : null}
        />
        {stappenOpen && (
          <div className="p-4">
            {mijnStappen.length === 0 ? (
              <div>
                <div className="text-sm text-gray-500 italic py-3">{t('brouwdag_geen_stappen')}</div>
                <Btn s="sm" onClick={genereerStappen}>{t('brouwdag_genereer_uit_recept')}</Btn>
              </div>
            ) : (
              <div className="space-y-3">
                {FASE_VOLGORDE.map(fase => {
                  const items = mijnStappen.filter(s => s.fase === fase).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0))
                  if (!items.length) return null
                  return (
                    <div key={fase} className="border-l-4 pl-3" style={{borderColor: 'var(--t-accent)'}}>
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center justify-between">
                        <span>{t(FASE_LABEL[fase])}</span>
                        <button onClick={() => voegStapToe(fase)} className="text-xs text-gray-400 hover:text-gray-600">+ {t('brouwdag_voeg_stap_toe')}</button>
                      </div>
                      <div className="space-y-1.5">
                        {items.map(s => (
                          <StapRij key={s.id} stap={s}
                            label={resolveStapLabel(s)}
                            onToggle={() => togglevoltooid(s.id)}
                            onMeting={v => updGemeten(s.id, v)}
                            onOpmerking={v => updOpmerking(s.id, v)}
                            onDelete={() => deleteStap(s.id)} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {mijnStappen.length > 0 && !batch.brouwdag_voltooid && (
              <div className="mt-4 pt-3 border-t flex justify-end">
                <Btn v="green" onClick={rondAf} disabled={!mijnStappen.every(s => s.voltooid)}>
                  {t('brouwdag_voltooi_alles')}
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const CalcCard: React.FC<{label: string, value: string | null, hint?: string}> = ({label, value, hint}) => (
  <div className="bg-gray-50 rounded p-2">
    <div className="text-gray-500 text-xs">{label}</div>
    <div className="font-semibold text-gray-800 text-base">{value || '—'}</div>
    {hint && <div className="text-gray-400 text-xs italic">{hint}</div>}
  </div>
)

const StapRij: React.FC<{
  stap: BrouwdagStap
  label?: string
  onToggle: () => void
  onMeting: (v: string) => void
  onOpmerking: (v: string) => void
  onDelete: () => void
}> = ({stap, label, onToggle, onMeting, onOpmerking, onDelete}) => {
  const [open, setOpen] = React.useState(false)
  const weergave = label ?? stap.label
  return (
    <div className={`rounded border ${stap.voltooid ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <input type="checkbox" checked={!!stap.voltooid} onChange={onToggle} className="t-checkbox" />
        <span className={`flex-1 ${stap.voltooid ? 'line-through text-gray-500' : ''}`}>{weergave}</span>
        {stap.doel && <span className="text-xs text-gray-500">{t('brouwdag_doel')}: {stap.doel}</span>}
        <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400 hover:text-gray-600">{open ? '−' : '+'}</button>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600" title="×">×</button>
      </div>
      {open && (
        <div className="px-3 pb-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs border-t pt-2">
          <div>
            <label className="text-gray-500">{t('brouwdag_gemeten')} ({stap.doel_eenheid || ''})</label>
            <input value={stap.gemeten || ''} onChange={e => onMeting(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
          <div>
            <label className="text-gray-500">{t('lbl_notes')}</label>
            <input value={stap.opmerking || ''} onChange={e => onOpmerking(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 t-input" />
          </div>
        </div>
      )}
    </div>
  )
}

export default BrouwdagWizard
