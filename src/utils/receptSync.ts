// Brewfather-receptsync: de nieuwe stand uit Brewfather samenvoegen met wat de
// gebruiker in de app aan de recepten heeft gedaan.
//
// Brewfather is leidend voor het recept zelf. Vier dingen zijn van de app en
// blijven bij een sync staan:
//  1. de eigen velden op het recept (`RECEPT_EIGEN_VELDEN`): vaste kosten per
//     brouw, een handmatig verliespercentage en `vastgepind` — brouwerij-
//     gegevens, geen receptgegevens;
//  2. de koppeling van een receptregel aan een voorraadingrediënt
//     (`ingredient_id`);
//  3. een hopschema dat de gebruiker in de app heeft gecorrigeerd (gebruik,
//     tijd, tijdseenheid). Zo'n regel draagt `_lokaal` met de gewijzigde
//     velden; zonder die markering zette elke sync de correctie stil terug en
//     nam de volgende nieuwe batch weer het oude schema over. De markering
//     wissen maakt Brewfather bij de volgende sync weer leidend;
//  4. een recept dat uit Brewfather verdwijnt maar waar de app nog naar
//     verwijst (`batch.recept_id`/`recept_versie_id`, `product.recept_ids`/
//     `recept_huidig_id`, ook via een versie) of dat vastgepind is. Dat blijft
//     staan met `niet_in_brewfather: true` — een verwezen recept verdwijnt nooit
//     stil. Komt het terug in Brewfather, dan valt die markering weg. Een recept
//     waar niets naar verwijst verdwijnt zoals altijd.
//
// Puur: geen React, geen opslag.

import { hoofdIdResolver, isReceptVersie } from './productKeten'

/** Velden van het recept die van de app zijn en een sync overleven. */
export const RECEPT_EIGEN_VELDEN = ['kostprijs_overig', 'kostprijs_verlies_pct', 'vastgepind']

/** Regelvelden die in de app aan te passen zijn en dan lokaal blijven. */
export const RECEPT_LOKALE_VELDEN = ['gebruik', 'tijd', 'tijdEenheid']

const SECTIES = ['mout', 'hop', 'gist', 'overig']

const naamSleutel = (x: any): string => String(x?.naam ?? '').toLowerCase().trim()

/**
 * Een receptregel na een wijziging in de app: de patch toegepast, en de
 * lokaal te bewaren velden die erin zitten toegevoegd aan `_lokaal`.
 */
export const pasReceptRegelAan = (regel: any, patch: Record<string, any>): any => {
  const uit: any = { ...(regel || {}), ...patch }
  const lokaal = Object.keys(patch || {}).filter(k => RECEPT_LOKALE_VELDEN.includes(k))
  if (lokaal.length) {
    const bestaand: string[] = Array.isArray(regel?._lokaal) ? regel._lokaal : []
    uit._lokaal = [...bestaand, ...lokaal.filter(k => !bestaand.includes(k))]
  }
  return uit
}

/** Een regel zonder lokale markering: Brewfather is bij de volgende sync weer leidend. */
export const wisLokaal = (regel: any): any => {
  if (!regel || !('_lokaal' in regel)) return regel
  const { _lokaal: _weg, ...rest } = regel
  return rest
}

/** Per regel: hoeveelste keer deze naam al in de lijst voorkwam (0 = eerste). */
const volgnummers = (lijst: any[]): number[] => {
  const gezien = new Map<string, number>()
  return lijst.map(it => {
    const k = naamSleutel(it)
    const n = gezien.get(k) ?? 0
    gezien.set(k, n + 1)
    return n
  })
}

export interface ReceptSyncResultaat {
  recepten: any[]
  /** Aantal receptregels waarvan een lokale aanpassing is blijven staan. */
  behouden: number
  /**
   * Aantal hoofdrecepten dat niet meer in Brewfather staat maar bewaard bleef
   * omdat de app er nog naar verwijst (of omdat het vastgepind is).
   */
  bewaard: number
  /** Hun id's. */
  bewaardIds: string[]
  /** Aantal versie-records dat om dezelfde reden bleef staan. */
  bewaardeVersies: number
}

/** Waar de app naar recepten verwijst; bepaalt wat een sync niet mag weggooien. */
export interface ReceptVerwijzingen {
  batches?: ReadonlyArray<{ recept_id?: string | null; recept_versie_id?: string | null } | null | undefined> | null
  producten?: ReadonlyArray<{ recept_ids?: ReadonlyArray<string | null | undefined> | null; recept_huidig_id?: string | null } | null | undefined> | null
}

const isVersie = (r: any): boolean => isReceptVersie(r)

/**
 * De recepten uit `oud` die niet meer in Brewfather (`nieuw`) staan maar nog
 * gebruikt worden: een hoofdrecept als het zelf of een versie ervan verwezen
 * wordt of als het vastgepind is (dan met al zijn versies); een losse versie
 * als ernaar verwezen wordt. Gemarkeerd met `niet_in_brewfather: true`.
 */
const verwezenRecepten = (oud: any[], nieuw: any[], verwijzingen: ReceptVerwijzingen | undefined) => {
  const nieuwIds = new Set(nieuw.map((r: any) => String(r?.id)))
  const hoofdVan = hoofdIdResolver(oud)
  const verwezen = new Set<string>()
  const voeg = (id: unknown) => { if (id != null && id !== '') verwezen.add(String(id)) }
  for (const b of verwijzingen?.batches || []) { voeg(b?.recept_id); voeg(b?.recept_versie_id) }
  for (const p of verwijzingen?.producten || []) {
    for (const id of p?.recept_ids || []) voeg(id)
    voeg(p?.recept_huidig_id)
  }
  const verwezenHoofd = new Set([...verwezen].map(hoofdVan))

  const bewaardHoofd = new Set<string>()
  for (const r of oud) {
    if (r?.id == null || isVersie(r) || nieuwIds.has(String(r.id))) continue
    if (verwezenHoofd.has(String(r.id)) || r.vastgepind === true) bewaardHoofd.add(String(r.id))
  }
  const records: any[] = []
  const gehad = new Set<string>()
  let versies = 0
  for (const r of oud) {
    if (r?.id == null || nieuwIds.has(String(r.id))) continue
    const id = String(r.id)
    // Elk id één keer: een dubbel record in de oude lijst komt niet dubbel
    // terug (een lijst-key verwacht unieke id's, zie de delta-sync).
    if (gehad.has(id)) continue
    const blijft = isVersie(r)
      ? verwezen.has(id) || bewaardHoofd.has(hoofdVan(id))
      : bewaardHoofd.has(id)
    if (!blijft) continue
    gehad.add(id)
    if (isVersie(r)) versies += 1
    records.push({ ...r, niet_in_brewfather: true })
  }
  return { records, ids: [...bewaardHoofd], versies }
}

/**
 * Voegt de recepten uit Brewfather (`nieuw`) samen met de huidige (`oud`).
 * Een recept zonder oude tegenhanger komt ongewijzigd binnen.
 *
 * Regels worden gematcht op naam plus het hoeveelste voorkomen van die naam
 * binnen de sectie: dezelfde hop staat vaak twee keer in een recept (Citra
 * koken én Citra dry hop), dus alleen op naam matchen zou de correctie van de
 * ene additie op de andere zetten.
 */
export const voegReceptSyncSamen = (
  oud: any[] | null | undefined,
  nieuw: any[] | null | undefined,
  verwijzingen?: ReceptVerwijzingen,
): ReceptSyncResultaat => {
  const byId = new Map<any, any>((oud || []).map((r: any) => [r?.id, r]))
  let behouden = 0
  const recepten = (nieuw || []).map((nw: any) => {
    const vorig = byId.get(nw?.id)
    if (!vorig) return nw
    const out: any = { ...nw }
    for (const veld of RECEPT_EIGEN_VELDEN) {
      if (vorig[veld] !== undefined && vorig[veld] !== '') out[veld] = vorig[veld]
    }
    for (const s of SECTIES) {
      const oudeLijst: any[] = Array.isArray(vorig[s]) ? vorig[s] : []
      const nieuweLijst: any[] = Array.isArray(nw[s]) ? nw[s] : []
      const oudNr = volgnummers(oudeLijst)
      const nieuwNr = volgnummers(nieuweLijst)
      out[s] = nieuweLijst.map((it: any, i: number) => {
        let regel = it
        // Koppeling aan het voorraadingrediënt: een eerdere koppeling op
        // dezelfde naam gaat mee, tenzij Brewfather zelf al een id heeft.
        if (regel?.ingredient_id == null) {
          const match = oudeLijst.find((o: any) => o?.ingredient_id != null && naamSleutel(o) === naamSleutel(regel))
          if (match) regel = { ...regel, ingredient_id: match.ingredient_id }
        }
        // Lokaal gecorrigeerde velden van precies deze additie.
        const tegenhanger = oudeLijst.find((o: any, j: number) => naamSleutel(o) === naamSleutel(it) && oudNr[j] === nieuwNr[i])
        const lokaal: string[] = Array.isArray(tegenhanger?._lokaal)
          ? tegenhanger._lokaal.filter((k: any) => RECEPT_LOKALE_VELDEN.includes(k))
          : []
        if (lokaal.length) {
          regel = { ...regel, _lokaal: [...lokaal] }
          for (const k of lokaal) regel[k] = tegenhanger[k]
          behouden += 1
        }
        return regel
      })
    }
    return out
  })
  // Wat Brewfather niet meer kent maar de app nog gebruikt, blijft staan.
  const bewaard = verwezenRecepten(oud || [], nieuw || [], verwijzingen)
  return {
    recepten: [...recepten, ...bewaard.records],
    behouden,
    bewaard: bewaard.ids.length,
    bewaardIds: bewaard.ids,
    bewaardeVersies: bewaard.versies,
  }
}
