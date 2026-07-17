import React from 'react'
import { t } from '../../i18n'
import { newId, mapHopGebruik, _fetchedKeys } from '../../utils/api'
import { tod, r3, fmtD } from '../../utils/format'
import { convertEenheid } from '../../utils/constants'
import {
  mashEfficiency, brouwzaalEfficiency, kookVerdampingPct,
  iBUTinseth, totaalMaxExtract, hopVerouderdeAlpha
} from '../../utils/calculations'
import { getEffectiveBrewProp } from '../../utils/brewProps'
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
  // Afweeg/afboek-blok (ingrediënten wegen + van voorraad afboeken). Wordt
  // door de BatchFlowPage aangeleverd zodat de complexe lot-/voorraad-logica
  // dáár blijft, maar het blok chronologisch bovenaan de brouwdag-flow toont.
  afboekSlot?: React.ReactNode
  // Koel-log (start/eind-temp, duur, methode) — verweven in de koelstap.
  koelLogs?: any[]
  setKoelLogs?: any
}

const FASE_VOLGORDE: BrouwdagFase[] = ['water', 'maisch', 'lauter', 'koken', 'whirlpool', 'koelen', 'og']
const FASE_LABEL: Record<BrouwdagFase, string> = {
  water: 'brouwdag_fase_water',
  maisch: 'brouwdag_fase_maisch',
  lauter: 'brouwdag_fase_lauter',
  koken: 'brouwdag_fase_koken',
  whirlpool: 'brouwdag_fase_whirlpool',
  koelen: 'brouwdag_fase_koelen',
  og: 'brouwdag_fase_og',
}

// Brouwdag-wizard met stappen per fase + kernmeetwaarden + live calculaties.
// Bouwt het label voor een hop-additie stap dynamisch op uit de huidige
// gegevens van het gekoppelde batch_ingredient. Zo werken wijzigingen in
// het Hop-schema (tijdstip, naam) direct door in de stappenlijst.
const hopAddLabel = (h: any): string => {
  if (String(h?.gebruik || '').toLowerCase() === 'whirlpool') {
    const temp = h?.temp_c != null && h.temp_c !== '' ? String(h.temp_c) : '?'
    return t('brouwdag_label_hop_whirlpool')
      .replace('{n}', h?.ingredient_naam || '')
      .replace('{temp}', temp)
  }
  const tijdMin = h && h.tijdstip_min != null && h.tijdstip_min !== '' ? Number(h.tijdstip_min) : null
  return t('brouwdag_label_hop_add')
    .replace('{n}', h?.ingredient_naam || '')
    .replace('{t}', tijdMin != null ? String(tijdMin) : '?')
}

// Selectie-helpers voor hop-addities per brouwdag-fase: kook-hops horen bij
// 'koken', whirlpool-hops bij 'whirlpool'. Dry-hops en mash-hops krijgen geen
// brouwdag-stap (die lopen via de vergisting resp. het maischen zelf).
const isBoilHop = (i: any) =>
  String(i.ingredient_type).toLowerCase() === 'hop' &&
  (!i.gebruik || ['boil', 'kook'].includes(String(i.gebruik).toLowerCase()))
const isWhirlpoolHop = (i: any) =>
  String(i.ingredient_type).toLowerCase() === 'hop' &&
  String(i.gebruik || '').toLowerCase() === 'whirlpool'

// Bepaalt de effectieve α-zuur% voor een hop-additie. Een gekoppeld lot
// representeert de chargespecifieke gemeten waarde uit de lab-analyse en
// wint daarom van zowel recept-default als handmatige invoer. De gebruiker
// kiest impliciet welke α gebruikt wordt door wel/niet een lot te selecteren.
//
// Volgorde:
//   1. lot-specifieke α uit `Lot.bf_props.alpha` (chargespecifiek)
//      Past optioneel verouderings-correctie toe wanneer het lot een
//      oogstjaar (`bf_props.year`) of aankoopdatum heeft.
//   2. handmatige / recept-default waarde op het batch_ingredient
//   3. ingredient-default α uit `Ingredient.bf_props.alpha`
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
  // 1. Lot wint altijd wanneer-ie een α-waarde heeft. Een lot is de meest
  // specifieke bron (gemeten op deze charge) — een batch_ingredient.alpha_pct
  // die uit recept-import komt is een generieke schatting.
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
  // 2. batch_ingredient.alpha_pct (uit recept-import of handmatig in
  // het Hop-schema ingevuld door de gebruiker).
  if (h?.alpha_pct != null && h.alpha_pct !== '' && Number(h.alpha_pct) > 0) {
    return {alpha: Number(h.alpha_pct), bron: 'manual'}
  }
  // 3. Ingredient default (Ingredient.bf_props.alpha uit Brewfather of
  // handmatig ingevuld op de ingredient zelf).
  const ingr = h?.ingredient_id ? (ingredienten || []).find(i => i.id === h.ingredient_id) : null
  const ingAlpha = ingr?.bf_props?.alpha
  if (ingAlpha != null && Number(ingAlpha) > 0) {
    return {alpha: Number(ingAlpha), bron: 'ingredient'}
  }
  return {alpha: 0, bron: 'none'}
}

const BrouwdagWizard: React.FC<Props> = ({batch, setBat, bi, setBi, stappen, setStappen, tanks = [], lots = [], ingredienten = [], hopStorageDefault = 'vacuum_koel', recepten = [], afboekSlot, koelLogs, setKoelLogs}) => {
  const mijnStappen = (stappen || []).filter(s => s.batch_id === batch.id)
  const batchBi = (bi || []).filter(i => i.batch_id === batch.id)
  const [stappenOpen, setStappenOpen] = React.useState<boolean>(true)
  const [hopOpen, setHopOpen] = React.useState<boolean>(true)
  // Koel-invoer (verweven in de koelstap)
  const [koelForm, setKoelForm] = React.useState<any>({ datum: tod(), start_temp: '', eind_temp: '', duur_min: '', methode: 'plate', opmerking: '' })

  // Resolved label voor een stap: bij gekoppelde hop-additie wordt het
  // label live uit batch_ingredienten gehaald. Fallback voor oude stappen
  // zonder batch_ingredient_id: probeer te matchen op naam uit het opgeslagen
  // label ("Hop-additie: NAAM @").
  const resolveStapLabel = (s: BrouwdagStap): string => {
    if ((s.fase === 'koken' || s.fase === 'whirlpool') && s.batch_ingredient_id != null) {
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
  // ze op basis van het actuele Hop-schema — kook-hops in de fase 'koken',
  // whirlpool-hops in de fase 'whirlpool'. Behoudt de overige brouwdag-stappen
  // (water/maisch/lauter/koelen/og + hand-toegevoegde stappen).
  const syncHopStappen = () => {
    const boilAddities = batchBi.filter(isBoilHop)
      .sort((a: any, b: any) => Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0))
    const wpAddities = batchBi.filter(isWhirlpoolHop)
      .sort((a: any, b: any) => Number(b.temp_c || 0) - Number(a.temp_c || 0))

    setStappen((prev: any[]) => {
      const isHopStap = (s: any) =>
        s.batch_id === batch.id && (s.fase === 'koken' || s.fase === 'whirlpool') && (
          s.batch_ingredient_id != null ||
          (typeof s.label === 'string' && /^[^:]+:\s*.+?\s*@/.test(s.label))
        )
      const overig = (prev || []).filter((s: any) => !isHopStap(s))
      const maxVolgordeVoor = (fase: string) => overig
        .filter((s: any) => s.batch_id === batch.id && s.fase === fase)
        .reduce((m: number, s: any) => Math.max(m, s.volgorde || 0), 0)
      let id = newId(overig)
      const maakStappen = (addities: any[], fase: BrouwdagFase): BrouwdagStap[] => {
        let volgorde = maxVolgordeVoor(fase) + 1
        return addities.map(h => ({
          id: id++, batch_id: batch.id, fase, volgorde: volgorde++,
          label: hopAddLabel(h),
          batch_ingredient_id: h.id,
          doel: `${h.hoeveelheid}${h.eenheid || 'g'}`,
          doel_eenheid: 'g',
          created_at: new Date().toISOString(),
        }))
      }
      return [...overig, ...maakStappen(boilAddities, 'koken'), ...maakStappen(wpAddities, 'whirlpool')]
    })
  }

  // ── Kerngegevens-velden direct op batch ───────────────────────────────────
  const updField = (veld: keyof Batch, val: any) => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, [veld]: val} : b))
  }
  // OG invullen berekent ook het platogehalte — zelfde kubische benadering als
  // de Batches-pagina, zodat de flow geen functionaliteit verliest nu het
  // OG-veld hier in de stappenlijst leeft.
  const updOG = (val: any) => {
    const patch: any = { OG: val }
    const og = Number(val)
    if (!isNaN(og) && og >= 1 && og <= 1.2) {
      patch.platogehalte = String(Math.round((-616.868 + 1111.14*og - 630.272*og*og + 135.997*og*og*og) * 10) / 10)
    }
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, ...patch} : b))
  }
  // 'Volume naar gistvat' is het enige volume-veld op de brouwdag. De brede
  // 'liter_vergist' (accijns/rendement/tankrest) spiegelt mee zodat die
  // afleidingen blijven kloppen zonder een tweede invulveld.
  const updGistVolume = (val: any) => {
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, gist_volume_l: val, liter_vergist: val} : b))
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
  // OG voor Tinseth: gemeten > recept-doel. Zonder fallback zou een
  // geplande batch (OG=0) sg=1 krijgen, en dan is de bigness-factor 1.65
  // (maximaal) — wat ~70% te hoge IBU geeft t.o.v. een 1.060-wort.
  const ibuOG = Number(batch.OG) || Number(batchRecept?.OG) || 0
  // Volume-fallback: gemeten post-boil > recept boilSize > liter_vergist.
  // `pre_boil_volume_l` zou te groot zijn (telt verdamping mee), dus dat
  // gebruiken we niet als fallback.
  const ibuVolume = Number(batch.kook_volume_eind_l) || Number(batch.kook_volume) || Number(batch.gist_volume_l) || Number(batch.liter_vergist) || 0
  const ibu = iBUTinseth(hopsVoorIBU as any, ibuOG, ibuVolume)

  // ── Chronologische meetvelden per brouwdag-fase ───────────────────────────
  // De voormalige "Kerngegevens"-kaart is opgegaan in de stappenlijst: elk
  // meetveld staat bij de fase waarin je het daadwerkelijk meet. Doelwaarden
  // komen uit het gekoppelde recept (zelfde afleidingen als voorheen).
  const rec: any = batchRecept || {}
  const doelOGRecept = Number(rec.OG) || null
  const doelBatchSize = Number(rec.batch_size) || null
  const doelKookVol = Number(rec.kook_volume) || null
  // Geschatte pre-boil SG: aanname dat alle suiker al in het wort zit, dus
  // pre-boil SG verhoudt zich tot OG als batch_size/kook_volume.
  const doelPreBoilSg = (doelOGRecept && doelBatchSize && doelKookVol && doelKookVol > 0)
    ? 1 + (doelOGRecept - 1) * (doelBatchSize / doelKookVol)
    : null

  interface MeetVeldDef {
    veld: string
    labelKey: string
    step: string
    ph: string
    doel?: number | null
    doelUnit?: string
    doelDecimals?: number
    hint?: string
  }
  const FASE_MEETVELDEN: Partial<Record<BrouwdagFase, MeetVeldDef[]>> = {
    maisch: [
      { veld: 'maisch_ph', labelKey: 'batch_info_mash_ph', step: '0.01', ph: '5.40', hint: '5.2–5.4' },
    ],
    lauter: [
      { veld: 'pre_boil_sg', labelKey: 'brouwdag_pre_boil_sg', step: '0.001', ph: '1.045', doel: doelPreBoilSg, doelDecimals: 3 },
      { veld: 'pre_boil_volume_l', labelKey: 'brouwdag_pre_boil_vol', step: '0.1', ph: '28', doel: doelKookVol, doelUnit: ' L', doelDecimals: 1 },
    ],
    koken: [
      { veld: 'kook_volume_start_l', labelKey: 'brouwdag_kook_vol_start', step: '0.1', ph: '28', doel: doelKookVol, doelUnit: ' L', doelDecimals: 1 },
      { veld: 'kook_volume_eind_l', labelKey: 'brouwdag_kook_vol_eind', step: '0.1', ph: '24', doel: doelBatchSize, doelUnit: ' L', doelDecimals: 1 },
      { veld: 'kook_ph', labelKey: 'batch_info_boil_ph', step: '0.01', ph: '5.20', hint: '5.0–5.2' },
    ],
    koelen: [
      // 'Volume naar gistvat' is de gemeten hoeveelheid in de gistkuip. De
      // afgeleide 'liter_vergist' (bron voor accijns/rendement) wordt hieruit
      // gespiegeld — zie updGistVolume — zodat er geen dubbel invulveld staat.
      { veld: 'gist_volume_l', labelKey: 'brouwdag_gist_vol', step: '0.1', ph: '22', doel: doelBatchSize, doelUnit: ' L', doelDecimals: 1 },
    ],
    og: [
      { veld: 'OG', labelKey: 'brouwdag_og_meting', step: '0.001', ph: '1.052', doel: doelOGRecept, doelDecimals: 3 },
    ],
  }
  const renderMeetVeld = (v: MeetVeldDef) => (
    <div key={v.veld}>
      <label className="text-xs text-gray-500">{t(v.labelKey)}</label>
      <input type="number" step={v.step} value={(batch as any)[v.veld] ?? ''}
        onChange={e => v.veld === 'OG' ? updOG(e.target.value)
          : v.veld === 'gist_volume_l' ? updGistVolume(e.target.value)
          : updField(v.veld as any, e.target.value)}
        className="w-full border border-gray-200 rounded px-2 py-1 t-input" placeholder={v.ph} />
      {v.doel != null && !isNaN(Number(v.doel)) ? (
        <div className="text-[10px] text-gray-400 mt-0.5">
          {t('brouwdag_doel')}: {v.doelDecimals != null ? Number(v.doel).toFixed(v.doelDecimals) : String(v.doel)}{v.doelUnit || ''}
        </div>
      ) : v.hint ? (
        <div className="text-[10px] text-gray-400 mt-0.5">{t('brouwdag_typisch')}: {v.hint}</div>
      ) : null}
    </div>
  )

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

  // Eenmalige sync per batch-open: hops met een gekoppeld lot maar leeg
  // alpha_pct krijgen alsnog de α uit lot (of ingredient-fallback). Dit
  // repareert batches die vóór v1.9.77 een lot kregen toegewezen zonder
  // dat α werd overgenomen. Runt alleen op batch.id-change zodat een
  // bewuste leegmaak-actie door de gebruiker niet wordt overschreven
  // binnen dezelfde sessie.
  const hopAlphaSyncRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!setBi) return
    if (hopAlphaSyncRef.current === batch.id) return
    hopAlphaSyncRef.current = batch.id
    const updates = new Map<number, number>()
    for (const h of batchBi) {
      if (String(h.ingredient_type).toLowerCase() !== 'hop') continue
      if (h.alpha_pct != null && h.alpha_pct !== '' && Number(h.alpha_pct) > 0) continue
      const lot = h.lot_id ? (lots || []).find(l => l.id === h.lot_id) : null
      const ing = h.ingredient_id ? (ingredienten || []).find(i => i.id === h.ingredient_id) : null
      const alpha = getEffectiveBrewProp(lot, ing, 'alpha')
      if (alpha != null && Number(alpha) > 0) {
        updates.set(h.id, Number(alpha))
      }
    }
    if (updates.size > 0) {
      setBi((prev: any[]) => prev.map(x => {
        const v = updates.get(x.id)
        return v != null ? {...x, alpha_pct: v} : x
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id, lots, ingredienten])

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

    const hopAddities = batchBi.filter(isBoilHop)
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

    // 4b. Whirlpool — whirlpool-hops uit het recept/hop-schema als eigen fase,
    // gesorteerd op temperatuur (heetste stand eerst).
    const wpAddities = batchBi.filter(isWhirlpoolHop)
      .sort((a: any, b: any) => Number(b.temp_c || 0) - Number(a.temp_c || 0))
    wpAddities.forEach((h: any) => {
      nieuwe.push({
        id: id++, batch_id: batch.id, fase: 'whirlpool', volgorde: volgorde++,
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

  // Automatisch stappen genereren zodra de batch in de fase Brouwen staat en er
  // nog geen stappen zijn. De flag `brouwdag_stappen_auto` op de batch zorgt dat
  // dit één keer gebeurt — wie de stappen daarna bewust verwijdert, krijgt ze
  // niet opnieuw opgedrongen. We wachten tot de stappen-store van de server is
  // geladen zodat we geen duplicaten genereren naast nog-niet-gesynchroniseerde
  // bestaande stappen.
  const autoGenRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (autoGenRef.current === batch.id) return
    if (batch.status !== 'Brouwen') return
    if ((batch as any).brouwdag_stappen_auto) return
    if (!_fetchedKeys.has('brouwdag_stappen')) return
    if (mijnStappen.length > 0) return
    // Alleen genereren als er iets ís om te genereren (maischprofiel of
    // ingrediënten uit een recept) — anders blijft de handmatige knop staan.
    const maisch = (batch as any).maischprofiel || []
    if (!maisch.length && !batchBi.length) return
    autoGenRef.current = batch.id
    genereerStappen()
    setBat((prev: any[]) => prev.map(b => b.id === batch.id ? {...b, brouwdag_stappen_auto: true} : b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id, batch.status, mijnStappen.length])

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

  // ── Koel-log verweven in de koelstap ──────────────────────────────────────
  const METHODE_LBL: Record<string, string> = {
    plate: 'koel_methode_plate', dompel: 'koel_methode_dompel',
    counterflow: 'koel_methode_counterflow', overig: 'koel_methode_overig',
  }
  const mijnKoel = (koelLogs || []).filter((k: any) => k.batch_id === batch.id)
    .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))
  const addKoel = () => {
    if (!setKoelLogs) return
    if (!koelForm.start_temp && !koelForm.eind_temp && !koelForm.duur_min) return
    const nieuw = {
      id: newId(koelLogs || []), batch_id: batch.id, datum: koelForm.datum || tod(),
      start_temp: koelForm.start_temp ? Number(koelForm.start_temp) : undefined,
      eind_temp: koelForm.eind_temp ? Number(koelForm.eind_temp) : undefined,
      duur_min: koelForm.duur_min ? Number(koelForm.duur_min) : undefined,
      methode: koelForm.methode, opmerking: koelForm.opmerking || undefined,
      created_at: new Date().toISOString(),
    }
    setKoelLogs((prev: any[]) => [...(prev || []), nieuw])
    setKoelForm({ ...koelForm, start_temp: '', eind_temp: '', duur_min: '', opmerking: '' })
  }
  const deleteKoel = (id: number) => setKoelLogs && setKoelLogs((prev: any[]) => (prev || []).filter((k: any) => k.id !== id))
  const renderKoelInline = () => {
    if (!setKoelLogs) return null
    return (
      <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('koel_log_titel')}</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input type="number" step="0.1" value={koelForm.start_temp}
            onChange={e => setKoelForm({ ...koelForm, start_temp: e.target.value })}
            placeholder={t('koel_log_start_temp')} className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="0.1" value={koelForm.eind_temp}
            onChange={e => setKoelForm({ ...koelForm, eind_temp: e.target.value })}
            placeholder={t('koel_log_eind_temp')} className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <input type="number" step="1" value={koelForm.duur_min}
            onChange={e => setKoelForm({ ...koelForm, duur_min: e.target.value })}
            placeholder={t('koel_log_duur')} className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <select value={koelForm.methode} onChange={e => setKoelForm({ ...koelForm, methode: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1 text-sm t-input">
            {['plate', 'dompel', 'counterflow', 'overig'].map(m => <option key={m} value={m}>{t(METHODE_LBL[m])}</option>)}
          </select>
          <input value={koelForm.opmerking} onChange={e => setKoelForm({ ...koelForm, opmerking: e.target.value })}
            placeholder={t('lbl_notes')} className="border border-gray-200 rounded px-2 py-1 text-sm t-input" />
          <Btn s="sm" onClick={addKoel}>{t('koel_log_voeg_toe')}</Btn>
        </div>
        {mijnKoel.length > 0 && (
          <div className="space-y-1 mt-2">
            {mijnKoel.map((k: any) => (
              <div key={k.id} className="flex items-center justify-between px-2 py-1 rounded bg-white border border-gray-100 text-xs text-gray-600">
                <span>
                  {fmtD(k.datum)} · {k.methode ? t(METHODE_LBL[k.methode]) : '—'}
                  {(k.start_temp != null || k.eind_temp != null) && <> · {k.start_temp ?? '?'}°C → {k.eind_temp ?? '?'}°C</>}
                  {k.duur_min != null && <> · {k.duur_min} min</>}
                  {k.opmerking && <span className="italic text-gray-400"> · {k.opmerking}</span>}
                </span>
                <button onClick={() => deleteKoel(k.id)} className="text-gray-300 hover:text-red-500">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Render
  return (
    <div className="space-y-3">
      {/* Afweeg/afboek-ingrediënten — chronologisch bovenaan de brouwdag */}
      {afboekSlot}

      {/* Hop-schema (kook-additie tijden — bewerkbaar) */}
      {(() => {
        const hops = batchBi.filter(i => String(i.ingredient_type).toLowerCase() === 'hop')
        // Bereken IBU-bijdrage van één hop met dezelfde Tinseth-formule. Geeft
        // 0 voor non-boil hops of wanneer cruciale data ontbreekt.
        const ibuBijdrageVoor = (h: any): number => {
          const gebr = String(h.gebruik || '').toLowerCase()
          if (gebr && !['boil', 'kook', ''].includes(gebr)) return 0
          const g = Number(h.hoeveelheid) || 0
          const a = Number(effectieveAlpha(h, lots, ingredienten, batch.datum, hopStorageDefault).alpha) || 0
          const t = Number(h.tijdstip_min) || 0
          if (g <= 0 || a <= 0 || t <= 0 || ibuVolume <= 0 || ibuOG <= 0) return 0
          const factGrav = 1.65 * Math.pow(0.000125, ibuOG - 1)
          const factTime = (1 - Math.exp(-0.04 * t)) / 4.15
          return (factGrav * factTime * a * g * 10) / ibuVolume
        }
        const updHop = (hopId: number, veld: 'tijdstip_min' | 'alpha_pct' | 'gebruik' | 'lot_id' | 'temp_c', val: any) => {
          if (!setBi) return
          setBi((prev: any[]) => prev.map(x => x.id === hopId ? {...x, [veld]: val} : x))
        }
        // Lot-keuze neemt de α uit `getEffectiveBrewProp(lot, ing, 'alpha')`
        // over naar het α-veld van de batch-hop (lot wint, anders fallback
        // naar het ingredient). Verouderings-correctie blijft via
        // `effectieveAlpha` lopen, dus IBU verandert niet — alleen het
        // veld toont nu meteen de waarde. Bij wisselen van lot wordt α
        // overschreven; bij 'geen lot' kiezen valt het terug op de
        // ingredient-α, en blijft anders de laatst overgenomen waarde
        // staan als handmatige override.
        const updHopLot = (hopId: number, lotIdVal: string) => {
          if (!setBi) return
          const lotId = lotIdVal ? Number(lotIdVal) : ''
          const lot = lotId ? (lots || []).find(l => l.id === lotId) : null
          setBi((prev: any[]) => prev.map(x => {
            if (x.id !== hopId) return x
            const ing = x.ingredient_id ? (ingredienten || []).find(i => i.id === x.ingredient_id) : null
            const alpha = getEffectiveBrewProp(lot, ing, 'alpha')
            const patch: any = {...x, lot_id: lotId}
            if (alpha != null && Number(alpha) > 0) {
              patch.alpha_pct = Number(alpha)
            }
            return patch
          }))
        }
        // Vind beschikbare lots per hop-additie (alleen lots van hetzelfde
        // ingredient_id, met voorraad of zonder voorraad-eis voor archief).
        const beschikbareLots = (h: any) => h.ingredient_id
          ? (lots || []).filter(l => l.ingredient_id === h.ingredient_id)
          : []
        // Voorraad van een lot omgerekend naar de gevraagde eenheid;
        // null als de eenheden niet converteerbaar zijn.
        const lotVoorraadIn = (l: any, eenheid: string): number | null =>
          convertEenheid(Number(l?.hoeveelheid || 0), l?.eenheid || eenheid, eenheid)
        // Splitst een hop-additie waarvan het gekozen lot de hoeveelheid niet
        // dekt in twee regels: de huidige regel gaat terug naar wat het lot
        // nog beschikbaar heeft, het restant komt als nieuwe regel (zonder
        // lot) met dezelfde tijd/gebruik — daar kan vervolgens een ander lot
        // voor gekozen worden. Zelfde principe als de automatische splitsing
        // bij het afboeken in de batch flow.
        const splitsHopOverLots = (h: any, beschikbaarInEenheid: number) => {
          if (!setBi) return
          const nodig = Number(h.hoeveelheid) || 0
          const deel = r3(Math.min(beschikbaarInEenheid, nodig))
          const rest = r3(nodig - deel)
          if (deel <= 0 || rest <= 0) return
          setBi((prev: any[]) => [
            ...prev.map((x: any) => x.id === h.id ? {...x, hoeveelheid: deel} : x),
            {
              id: newId(prev), batch_id: h.batch_id, ingredient_id: h.ingredient_id,
              ingredient_naam: h.ingredient_naam, ingredient_type: h.ingredient_type,
              hoeveelheid: rest, eenheid: h.eenheid, gebruik: h.gebruik,
              tijdstip_min: h.tijdstip_min, temp_c: h.temp_c,
              lot_id: '', alpha_pct: '',
            },
          ])
        }
        return (
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <SectionHeader
              title={t('hop_schema_titel')}
              open={hopOpen}
              onToggle={() => setHopOpen(o => !o)}
              info={hops.length > 0
                ? (() => {
                    const doel = Number(batchRecept?.IBU) > 0 ? Number(batchRecept!.IBU).toFixed(1) : null
                    if (ibu > 0 && doel) return `${hops.length} · IBU ${ibu.toFixed(1)} / ${t('brouwdag_doel').toLowerCase()} ${doel}`
                    if (ibu > 0) return `${hops.length} · IBU ${ibu.toFixed(1)}`
                    if (doel) return `${hops.length} · ${t('brouwdag_doel').toLowerCase()} IBU ${doel}`
                    return `${hops.length}`
                  })()
                : null}
            />
            {hopOpen && (
              <div className="p-4">
                {/* IBU-totaalbox bovenaan — toont berekende IBU + (indien
                    aanwezig) het doel uit het recept. Hover/title onthult
                    welk volume + OG zijn gebruikt zodat afwijkingen t.o.v.
                    Brewfather snel te herleiden zijn. */}
                {hops.length > 0 && (() => {
                  const doelIBU = Number(batchRecept?.IBU) || null
                  const verschil = doelIBU != null && ibu > 0 ? ibu - doelIBU : null
                  const ogBron = Number(batch.OG) > 0 ? t('brouwdag_gemeten')
                    : Number(batchRecept?.OG) > 0 ? t('brouwdag_doel')
                    : '—'
                  const tooltip = `${t('brouwdag_calc_ibu_tinseth')}\n`
                    + `OG: ${ibuOG > 0 ? ibuOG.toFixed(3) : '1.000 (fallback)'} (${ogBron})\n`
                    + `${t('brouwdag_calc_ibu_volume')}: ${ibuVolume > 0 ? ibuVolume.toFixed(1) + 'L' : '—'}`
                  return (
                    <div className="mb-3 flex items-baseline justify-between bg-gray-50 border border-gray-200 rounded px-3 py-2"
                      title={tooltip}>
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
                          <th className="px-3 py-1.5 text-right">IBU</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {hops
                          .slice()
                          .sort((a: any, b: any) => {
                            // Groep-volgorde: mash → boil → whirlpool → dry hop.
                            // Binnen elke groep: tijdstip aflopend (60' staat
                            // boven 10' bij boil-hops). Zo komen whirlpool-
                            // hops altijd onder de kook-additions en
                            // dry-hops onderaan.
                            const groep = (g: string): number => {
                              const u = String(g || 'boil').toLowerCase()
                              if (u === 'mash') return 0
                              if (u === 'whirlpool') return 2
                              if (u === 'dry hop' || u === 'dry-hop' || u === 'dryhop') return 3
                              return 1 // boil / kook / leeg
                            }
                            const ga = groep(a.gebruik), gb = groep(b.gebruik)
                            if (ga !== gb) return ga - gb
                            return Number(b.tijdstip_min || 0) - Number(a.tijdstip_min || 0)
                          })
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
                            // Beschikbare voorraad, omgerekend naar de eenheid
                            // van de hop-additie waar dat kan.
                            const voorr = lotVoorraadIn(l, h.eenheid || 'g')
                            parts.push(voorr != null
                              ? `${r3(voorr)} ${h.eenheid || 'g'}`
                              : `${l.hoeveelheid} ${l.eenheid || ''}`.trim())
                            return parts.join(' · ')
                          }
                          // Dekt het gekozen lot de gevraagde hoeveelheid?
                          const gekozenLot = h.lot_id ? lotsBeschikbaar.find((l: any) => l.id === h.lot_id) : null
                          const lotBesch = gekozenLot ? lotVoorraadIn(gekozenLot, h.eenheid || 'g') : null
                          const nodigQty = Number(h.hoeveelheid) || 0
                          const lotTekort = gekozenLot && lotBesch != null && nodigQty > 0
                            && lotBesch < nodigQty - 0.001
                          return (
                          <tr key={h.id}>
                            <td className="px-3 py-1.5">{h.ingredient_naam}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{h.hoeveelheid} {h.eenheid || 'g'}</td>
                            <td className="px-3 py-1.5">
                              {lotsBeschikbaar.length > 0 ? (
                                <>
                                  <select value={h.lot_id || ''}
                                    onChange={e => updHopLot(h.id, e.target.value)}
                                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs t-input max-w-[16rem]">
                                    <option value="">{t('hop_schema_geen_lot')}</option>
                                    {lotsBeschikbaar.map((l: any) => (
                                      <option key={l.id} value={l.id}>{lotLabel(l)}</option>
                                    ))}
                                  </select>
                                  {lotTekort && (
                                    <div className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                      <span>{t('hop_schema_lot_tekort')
                                        .replace('{beschikbaar}', String(r3(Math.max(0, lotBesch as number))))
                                        .replace('{nodig}', String(r3(nodigQty)))
                                        .replace('{eenheid}', h.eenheid || 'g')}</span>
                                      {setBi && (lotBesch as number) > 0.001 && (
                                        <button onClick={() => splitsHopOverLots(h, lotBesch as number)}
                                          className="underline font-semibold hover:no-underline"
                                          title={t('hop_schema_splits_hint')}>
                                          {t('hop_schema_splits_btn')}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </>
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
                            <td className="px-3 py-1.5 text-right font-medium text-gray-700">
                              {(() => {
                                const bij = ibuBijdrageVoor(h)
                                return bij > 0 ? bij.toFixed(1) : <span className="text-gray-300 font-normal">—</span>
                              })()}
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
            {mijnStappen.length === 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="text-sm text-gray-500 italic">{t('brouwdag_geen_stappen')}</div>
                <Btn s="sm" onClick={genereerStappen}>{t('brouwdag_genereer_uit_recept')}</Btn>
              </div>
            )}
            {/* Chronologische fasen: stappen + de bijbehorende meetvelden in
                één blok, zodat je tijdens de brouwdag van boven naar beneden
                werkt en meteen invult wat je op dat moment meet. */}
            <div className="space-y-3">
              {FASE_VOLGORDE.map(fase => {
                const items = mijnStappen.filter(s => s.fase === fase).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0))
                const velden = FASE_MEETVELDEN[fase] || []
                const toonTank = fase === 'koelen'
                if (!items.length && !velden.length && !toonTank) return null
                return (
                  <div key={fase} className="border-l-4 pl-3" style={{borderColor: 'var(--t-accent)'}}>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center justify-between">
                      <span>{t(FASE_LABEL[fase])}</span>
                      <button onClick={() => voegStapToe(fase)} className="text-xs text-gray-400 hover:text-gray-600">+ {t('brouwdag_voeg_stap_toe')}</button>
                    </div>
                    {items.length > 0 && (
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
                    )}
                    {(velden.length > 0 || toonTank) && (
                      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 text-sm ${items.length ? 'mt-2' : ''}`}>
                        {velden.map(renderMeetVeld)}
                        {toonTank && (
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
                        )}
                      </div>
                    )}
                    {/* Koel-log verweven in de koelstap */}
                    {fase === 'koelen' && renderKoelInline()}
                  </div>
                )
              })}
            </div>

            {/* Live calculaties — afgeleid uit de hierboven ingevulde metingen */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {t('brouwdag_kerngegevens')}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <CalcCard label={t('brouwdag_calc_mash_eff')} value={mashEff > 0 ? `${mashEff.toFixed(1)}%` : null} />
                <CalcCard label={t('brouwdag_calc_brouwzaal_eff')} value={brEff > 0 ? `${brEff.toFixed(1)}%` : null} />
                <CalcCard label={t('brouwdag_kook_verdamping')} value={verdamping > 0 ? `${verdamping.toFixed(1)}%/u` : null} />
                <CalcCard
                  label={t('brouwdag_calc_ibu_tinseth')}
                  value={ibu > 0 ? `${ibu}` : (ibuOG <= 0 ? t('brouwdag_ibu_geen_og') : null)}
                  target={Number(batchRecept?.IBU) > 0 ? Number(batchRecept!.IBU).toFixed(1) : null}
                  hint={ibu > 0 ? t('calc_disclaimer_tinseth') : ''}
                />
              </div>
              {maxExtract === 0 && (fermentables.length > 0) && (
                <div className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  ⚠ {t('calc_geen_data')}: extract% (yield) ontbreekt op mout. Voeg toe via Brewfather-sync of handmatig in batch-ingrediënten.
                </div>
              )}
            </div>

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

const CalcCard: React.FC<{label: string, value: string | null, hint?: string, target?: string | null}> = ({label, value, hint, target}) => (
  <div className="bg-gray-50 rounded p-2">
    <div className="text-gray-500 text-xs">{label}</div>
    <div className="font-semibold text-gray-800 text-base">{value || '—'}</div>
    {target && <div className="text-[10px] text-gray-400 mt-0.5">{t('brouwdag_doel')}: {target}</div>}
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
