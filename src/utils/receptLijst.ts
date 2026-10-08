// De receptenlijst per Brewfather-tag zoals de receptenpagina hem toont, en de
// eenvoudige receptkeuze bij een nieuwe batch en "Recept opnieuw toepassen".
//
// Beide zijn een tussenstap: de receptenpagina krijgt later "In gebruik ·
// Archief · Verborgen" (docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 6) en de
// keuze bij een nieuwe batch wordt het blad "Wat brouw je?". Tot dan gelden
// hier al dezelfde regels als in `receptGebruik.ts`:
//
// - De eenheid is het hoofdrecept. Een Brewfather-versie (`is_huidige: false`
//   of `parent_id`) staat onder zijn recept en nooit als eigen regel.
// - Verborgen = in `recepten_verborgen`, of álle tags gearchiveerd. In de
//   taglijst staat een recept met alleen gearchiveerde tags onder
//   "Gearchiveerde tags" (zoals de pagina altijd deed); in een keuzelijst valt
//   het weg.
//
// Puur: geen React, geen opslag, geen vertaalfunctie.

import type { Recept } from '../types'
import { hoofdIdResolver, isReceptVersie, receptHoofdId } from './productKeten'
import { ZONDER_TAG, heeftZoekterm, receptGebruik, tekstPastBijZoek } from './receptGebruik'

type ReceptLike = Pick<Recept, 'id'> & Partial<Omit<Recept, 'id'>>
type IdLijst = ReadonlyArray<string | number | null | undefined> | null | undefined
/** `recepten_verborgen`: id's als tekst of getal; een object met `id` mag ook (zoals in receptGebruik). */
type VerborgenLijst = ReadonlyArray<string | number | { id?: string | number | null } | null | undefined> | null | undefined
type TekstLijst = ReadonlyArray<string | null | undefined> | null | undefined

/**
 * Het recept-id van een regel uit `recepten_verborgen`, als tekst: een id, of
 * het `id` van een object. Leeg = null. Dezelfde lezing als `receptGebruik`.
 */
export const verborgenId = (v: unknown): string | null => {
  const id = v != null && typeof v === 'object' ? (v as { id?: unknown }).id : v
  return id == null || id === '' ? null : String(id)
}

const sorteerder = new Intl.Collator('nl', { sensitivity: 'base', numeric: true })

const opNaam = (a: ReceptLike, b: ReceptLike): number =>
  sorteerder.compare(String(a.naam ?? ''), String(b.naam ?? '')) || String(a.id).localeCompare(String(b.id))

const teksten = (lijst: TekstLijst): string[] => {
  const uit: string[] = []
  for (const t of lijst || []) {
    const s = String(t ?? '').trim()
    if (s && !uit.includes(s)) uit.push(s)
  }
  return uit
}

/** De tags van een recept: getrimd, zonder lege en zonder dubbele. */
const tagsVan = (r: ReceptLike): string[] => teksten(Array.isArray(r.tags) ? r.tags : [])

const isHoofdrecept = (r: ReceptLike | null | undefined): r is ReceptLike =>
  !!r && r.id != null && String(r.id) !== '' && !isReceptVersie(r)

/** Past het recept bij de zoektekst (naam, stijl of tag; alle woorden, zonder accenten)? */
export const receptPastBijZoekterm = (r: ReceptLike, zoek: string | null | undefined): boolean =>
  tekstPastBijZoek([r.naam, r.stijl, ...tagsVan(r)], zoek)

// ── De taglijst ─────────────────────────────────────────────────────────────

export interface ReceptTagGroep<R> {
  /** De tag; `null` = de recepten zonder tag ("Zonder tag"). */
  tag: string | null
  /** De sleutel in `recepten_gesloten_groepen`: de tag, of `ZONDER_TAG`. */
  sleutel: string
  gearchiveerd: boolean
  /** Op naam. */
  recepten: R[]
  /** Uitgeklapt: niet dichtgeklapt door de gebruiker, of er wordt gezocht. */
  open: boolean
}

export interface ReceptTagIndeling<R> {
  /**
   * De groepen van de actieve tags in weergavevolgorde, met "Zonder tag" als
   * laatste. Alleen groepen met recepten (bij zoeken: met treffers).
   */
  groepen: ReceptTagGroep<R>[]
  /** De groepen van gearchiveerde tags: recepten met alléén gearchiveerde tags. */
  gearchiveerd: ReceptTagGroep<R>[]
  /** Verborgen recepten (`recepten_verborgen`), op naam; bij zoeken alleen de treffers. */
  verborgen: R[]
  /**
   * Alle actieve tags in weergavevolgorde, ook als ze bij deze zoekterm niets
   * opleveren — de volgorde van de groepen wijzigen gaat over de hele lijst.
   */
  actieveTags: string[]
  /**
   * Er zijn actieve tags: dan krijgt elke groep een kop. Zonder actieve tags
   * staan de recepten zonder tag als platte lijst (de groep is dan altijd open).
   */
  metKoppen: boolean
  /** Er wordt gezocht. */
  zoekt: boolean
  /** Zichtbare recepten in totaal (groepen, gearchiveerd en verborgen). */
  aantal: number
}

export interface ReceptTagOpties {
  /** `recepten_verborgen`. */
  verborgen?: VerborgenLijst
  /** `recepten_gearchiveerde_tags`. */
  gearchiveerdeTags?: TekstLijst
  /** `recepten_tag_volgorde`. */
  tagVolgorde?: TekstLijst
  /** `recepten_gesloten_groepen` (tags, en `ZONDER_TAG`). */
  geslotenGroepen?: TekstLijst
  zoek?: string | null
}

/**
 * De receptenlijst per Brewfather-tag. Elk recept staat precies één keer:
 *
 * - met minstens één actieve (niet-gearchiveerde) tag: in de groep van de
 *   bovenste daarvan, in de volgorde van de groepen — wie de groepen ordent,
 *   bepaalt dus ook waar een recept met meer tags staat;
 * - met alleen gearchiveerde tags: in de bovenste daarvan, onder
 *   "Gearchiveerde tags";
 * - zonder tag: in "Zonder tag".
 *
 * De volgorde van de groepen: eerst `recepten_tag_volgorde`, dan zoals de
 * tags in de lijst voorkomen. Zoeken (naam, stijl, tag) laat alleen groepen
 * met een treffer zien, en die staan dan open — ook als ze dichtgeklapt waren.
 */
export const receptTagIndeling = <R extends ReceptLike>(
  recepten: ReadonlyArray<R | null | undefined> | null | undefined,
  opties: ReceptTagOpties = {},
): ReceptTagIndeling<R> => {
  const lijst = (recepten || []).filter((r): r is R => isHoofdrecept(r))
  const verborgenIds = new Set<string>()
  for (const v of opties.verborgen || []) {
    const id = verborgenId(v)
    if (id) verborgenIds.add(id)
  }
  const archief = new Set(teksten(opties.gearchiveerdeTags))
  const dicht = new Set(teksten(opties.geslotenGroepen))
  const zoek = opties.zoek ?? ''
  const zoekt = heeftZoekterm(zoek)

  const zichtbaar = lijst.filter(r => !verborgenIds.has(String(r.id)))

  // Weergavevolgorde van de tags.
  const voorkomen = new Set<string>()
  for (const r of zichtbaar) for (const t of tagsVan(r)) voorkomen.add(t)
  const volgorde = [...new Set([...teksten(opties.tagVolgorde), ...voorkomen])].filter(t => voorkomen.has(t))
  const plek = new Map(volgorde.map((t, i) => [t, i] as const))
  const actieveTags = volgorde.filter(t => !archief.has(t))
  const archiefTags = volgorde.filter(t => archief.has(t))
  const metKoppen = actieveTags.length > 0

  const perTag = new Map<string, R[]>()
  const zonderTag: R[] = []
  for (const r of zichtbaar) {
    if (!receptPastBijZoekterm(r, zoek)) continue
    const tags = tagsVan(r)
    if (!tags.length) { zonderTag.push(r); continue }
    const actief = tags.filter(t => !archief.has(t))
    const kandidaten = actief.length ? actief : tags
    let tag = kandidaten[0]
    for (const t of kandidaten) if ((plek.get(t) ?? Infinity) < (plek.get(tag) ?? Infinity)) tag = t
    const l = perTag.get(tag)
    if (l) l.push(r); else perTag.set(tag, [r])
  }

  const groep = (tag: string | null, gearchiveerd: boolean, recs: R[]): ReceptTagGroep<R> => {
    const sleutel = tag ?? ZONDER_TAG
    return {
      tag, sleutel, gearchiveerd,
      recepten: [...recs].sort(opNaam),
      open: zoekt || (tag == null && !metKoppen) || !dicht.has(sleutel),
    }
  }
  const groepen = actieveTags
    .filter(t => (perTag.get(t) || []).length > 0)
    .map(t => groep(t, false, perTag.get(t) || []))
  if (zonderTag.length) groepen.push(groep(null, false, zonderTag))
  const gearchiveerd = archiefTags
    .filter(t => (perTag.get(t) || []).length > 0)
    .map(t => groep(t, true, perTag.get(t) || []))
  const verborgen = lijst
    .filter(r => verborgenIds.has(String(r.id)) && receptPastBijZoekterm(r, zoek))
    .sort(opNaam)

  const aantal = [...groepen, ...gearchiveerd].reduce((s, g) => s + g.recepten.length, 0) + verborgen.length
  return { groepen, gearchiveerd, verborgen, actieveTags, metKoppen, zoekt, aantal }
}

/**
 * De versies per hoofdrecept (`<parent>__v<n>` / `parent_id`), nieuwste eerst
 * (`versie_datum`). Sleutel: het id van het hoofdrecept.
 */
export const versiesPerRecept = <R extends ReceptLike>(
  recepten: ReadonlyArray<R | null | undefined> | null | undefined,
): Map<string, R[]> => {
  const uit = new Map<string, R[]>()
  for (const r of recepten || []) {
    if (!r || r.id == null || !isReceptVersie(r)) continue
    const hoofd = receptHoofdId(r)
    if (!hoofd) continue
    const l = uit.get(hoofd)
    if (l) l.push(r); else uit.set(hoofd, [r])
  }
  for (const l of uit.values()) {
    l.sort((a, b) =>
      String(b.versie_datum || '').localeCompare(String(a.versie_datum || '')) || String(b.id).localeCompare(String(a.id)))
  }
  return uit
}

/**
 * Tags van een recept die niet de groep zijn waarin het staat, zonder de
 * gearchiveerde: "ook in IPA" onder een recept met meer tags.
 */
export const andereTags = (
  r: ReceptLike,
  groepTag: string | null,
  gearchiveerdeTags?: TekstLijst,
): string[] => {
  const archief = new Set(teksten(gearchiveerdeTags))
  return tagsVan(r).filter(t => t !== groepTag && !archief.has(t))
}

// ── De keuzelijst ───────────────────────────────────────────────────────────

export interface ReceptKeuzeOpties {
  /** `recepten_verborgen`. */
  verborgen?: VerborgenLijst
  /** `recepten_gearchiveerde_tags`. */
  gearchiveerdeTags?: TekstLijst
  /**
   * Recepten die altijd kiesbaar blijven, ook als ze verborgen zijn: het
   * recept dat al gekozen is of al aan de batch hangt. Een versie-id telt voor
   * zijn hoofdrecept.
   */
  behoud?: IdLijst
}

/**
 * De recepten voor een eenvoudige keuzelijst (Nieuwe batch, Recept opnieuw
 * toepassen): alleen hoofdrecepten, zonder de verborgen recepten en zonder de
 * recepten waarvan alle tags gearchiveerd zijn — dezelfde regel als
 * `receptGebruik`. Wat in `behoud` staat blijft erin. Op naam.
 */
export const receptenVoorKeuzelijst = <R extends ReceptLike>(
  recepten: ReadonlyArray<R | null | undefined> | null | undefined,
  opties: ReceptKeuzeOpties = {},
): R[] => {
  const lijst = (recepten || []).filter((r): r is R => !!r && r.id != null && String(r.id) !== '')
  const naarHoofd = hoofdIdResolver(lijst)
  const behoud = new Set((opties.behoud || []).map(id => naarHoofd(id)).filter(Boolean))
  return receptGebruik<R>({
    recepten: lijst, batches: [], producten: [],
    verborgen: opties.verborgen, gearchiveerdeTags: opties.gearchiveerdeTags,
  })
    .filter(g => isHoofdrecept(g.recept) && (g.status !== 'verborgen' || behoud.has(g.id)))
    .map(g => g.recept)
}
