// Wat de app met Brewfather doet, per onderdeel: uit, lezen of schrijven.
//
// De brouwer kiest zelf waar Brewfather leidend is en waar BrewAdmin. De een
// plant en meet in Brewfather en wil dat de batches hier meelopen (lezen), de
// ander brouwt in BrewAdmin en wil Brewfather alleen bijwerken (schrijven).
// De keuze staat in `brewfather_creds.richting` (Instellingen → Koppelingen)
// en de server houdt zich eraan (`_bf_richting_fout` in server.py, de spiegel
// van deze tabellen — pytest bewaakt dat ze gelijk zijn). Een knop die iets
// doet wat uit staat verdwijnt; ook een omweg langs de app krijgt een 403.
//
// Niet elk onderdeel kent alle drie: recepten en ingrediënten haalt de app
// alleen op, de voorraad stuurt hij alleen naar Brewfather. Status en
// meetwaarden van een batch kunnen beide kanten op, elk apart.
//
// Zonder keuze geldt het gedrag van vóór deze instelling: recepten,
// ingrediënten, status en meetwaarden lezen, de voorraad schrijven.

export type BfOnderdeel = 'recepten' | 'ingredienten' | 'voorraad' | 'batch_status' | 'batch_metingen'
export type BfRichting = 'uit' | 'lezen' | 'schrijven'
export type BfRichtingen = Record<BfOnderdeel, BfRichting>

/** De onderdelen, in de volgorde van het instellingenscherm. */
export const BF_ONDERDELEN: readonly BfOnderdeel[] = ['recepten', 'ingredienten', 'voorraad', 'batch_status', 'batch_metingen']

/** Wat er per onderdeel te kiezen is. Spiegel van `_BF_RICHTING_KEUZES`. */
export const BF_RICHTING_KEUZES: Readonly<Record<BfOnderdeel, readonly BfRichting[]>> = {
  recepten: ['uit', 'lezen'],
  ingredienten: ['uit', 'lezen'],
  voorraad: ['uit', 'schrijven'],
  batch_status: ['uit', 'lezen', 'schrijven'],
  batch_metingen: ['uit', 'lezen', 'schrijven'],
}

/** Zonder keuze: het gedrag van vóór de instelling. Spiegel van `_BF_RICHTING_STANDAARD`. */
export const BF_RICHTING_STANDAARD: Readonly<BfRichtingen> = {
  recepten: 'lezen',
  ingredienten: 'lezen',
  voorraad: 'schrijven',
  batch_status: 'lezen',
  batch_metingen: 'lezen',
}

interface BfCredsLike {
  enabled?: unknown
  userId?: unknown
  apiKey?: unknown
  richting?: unknown
}

/** De keuze per onderdeel; een ontbrekende of ongeldige waarde wordt de standaard. */
export const bfRichtingen = (creds: BfCredsLike | null | undefined): BfRichtingen => {
  const r = creds?.richting && typeof creds.richting === 'object' && !Array.isArray(creds.richting)
    ? creds.richting as Record<string, unknown> : {}
  const uit = { ...BF_RICHTING_STANDAARD }
  for (const o of BF_ONDERDELEN) {
    const v = r[o]
    if (typeof v === 'string' && (BF_RICHTING_KEUZES[o] as readonly string[]).includes(v)) uit[o] = v as BfRichting
  }
  return uit
}

/** De koppeling staat aan en is ingevuld. */
export const bfKoppelingAan = (creds: BfCredsLike | null | undefined): boolean =>
  !!(creds?.enabled && creds?.userId && creds?.apiKey)

/** Mag de app dit onderdeel in deze richting gebruiken (en staat de koppeling aan)? */
export const bfMag = (creds: BfCredsLike | null | undefined, onderdeel: BfOnderdeel, richting: 'lezen' | 'schrijven'): boolean =>
  bfKoppelingAan(creds) && bfRichtingen(creds)[onderdeel] === richting

/** Batches koppelen heeft zin zodra status of meetwaarden niet uit staan. */
export const bfBatchesKoppelbaar = (r: BfRichtingen): boolean =>
  r.batch_status !== 'uit' || r.batch_metingen !== 'uit'

/** Haalt de sync iets van gekoppelde batches op? */
export const bfBatchesLezen = (r: BfRichtingen): boolean =>
  r.batch_status === 'lezen' || r.batch_metingen === 'lezen'

/** Gaat er iets van gekoppelde batches naar Brewfather? */
export const bfBatchesSchrijven = (r: BfRichtingen): boolean =>
  r.batch_status === 'schrijven' || r.batch_metingen === 'schrijven'

/** De creds met één onderdeel anders; een keuze die het onderdeel niet kent verandert niets. */
export const bfMetRichting = <T extends BfCredsLike>(creds: T, onderdeel: BfOnderdeel, richting: BfRichting): T => {
  if (!(BF_RICHTING_KEUZES[onderdeel] as readonly string[]).includes(richting)) return creds
  return { ...creds, richting: { ...bfRichtingen(creds), [onderdeel]: richting } }
}

export type BfScope = 'batches_lezen' | 'batches_schrijven' | 'recepten_lezen' | 'voorraad_lezen' | 'voorraad_schrijven'

/**
 * De rechten die de API-sleutel bij deze keuze nodig heeft (Brewfather →
 * Instellingen → API). Batches lezen hoort ook bij schrijven: koppelen haalt de
 * lijst op. De ingrediëntenlijst is de voorraad in Brewfather.
 */
export const bfScopes = (r: BfRichtingen): BfScope[] => {
  const uit: BfScope[] = []
  if (bfBatchesKoppelbaar(r)) uit.push('batches_lezen')
  if (bfBatchesSchrijven(r)) uit.push('batches_schrijven')
  if (r.recepten === 'lezen') uit.push('recepten_lezen')
  if (r.ingredienten === 'lezen') uit.push('voorraad_lezen')
  if (r.voorraad === 'schrijven') uit.push('voorraad_schrijven')
  return uit
}

/**
 * Wat er na het koppelen van een batch gebeurt, als i18n-sleutels (één per
 * onderdeel dat niet uit staat): voor het koppelvenster en de melding erna.
 */
export const bfKoppelGevolgen = (r: BfRichtingen): string[] => {
  const uit: string[] = []
  if (r.batch_status !== 'uit') uit.push(`bf_gevolg_status_${r.batch_status}`)
  if (r.batch_metingen !== 'uit') uit.push(`bf_gevolg_metingen_${r.batch_metingen}`)
  return uit
}
