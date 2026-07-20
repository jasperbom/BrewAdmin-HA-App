// Opschoning van het unified batch-taken-systeem (migratie v3 in App.tsx).
//
// Achtergrond: de v1-migratie gaf de groepen Brouwdag/Botteldag/HACCP een
// nieuw ID (hoogste hygiëne-groep-ID + 1/2/3). De legacy-koppeling
// BATCH_TAKEN_LEGACY_FASE gaat er echter van uit dat die groepen op de
// default-posities 4/5 staan. Had een installatie niet precies drie
// hygiëne-groepen, dan verschoven de IDs en kwamen bijvoorbeeld de
// Botteldag-taken bij Brouwen terecht. De inhoud van een groep (de
// i18n-labelKeys van zijn taken) is wél taal- en ID-onafhankelijk — die
// bepaalt hier daarom de fase.
//
// Daarnaast dubbelen sinds de chronologische brouwdag-stappenlijst acht
// brouwdag-checks met stappen/invulvelden, en twee hygiëne-defaults met de
// brouwdag-checks "fermentor" en "waterslot". Die worden uitgezet
// (actief: false) — niet verwijderd, zodat ze in Instellingen → Batchtaken
// weer aan te zetten zijn en bestaande taken_checks-historie intact blijft.
import { groepFase, DEFAULT_BATCH_TAKEN_ITEMS, DEFAULT_BATCH_TAKEN_GROEPEN } from './constants'

// Brouwdag-checks die dubbel zijn met de chronologische stappenlijst: deze
// acties bestaan daar als stap (water, maischen, spoelen, kook-start,
// hop-addities, koelen) of als invulveld (OG, pH).
export const DUBBELE_BROUWDAG_CHECK_KEYS: readonly string[] = [
  'brouwdag_check_1_water',
  'brouwdag_check_2_maischen',
  'brouwdag_check_4_spoelen',
  'brouwdag_check_5_kook_start',
  'brouwdag_check_6_hop_toevoeg',
  'brouwdag_check_7_koelen',
  'brouwdag_check_8_og_meting',
  'brouwdag_check_9_ph_meting',
]

// Hygiëne-defaults (vaste NL-labels uit DEFAULT_HYGIENE_ITEMS) die dubbelen
// met brouwdag_check_11_fermentor en brouwdag_check_12_waterslot. De
// brouwdag-variant blijft: chronologisch hoort dit bij de brouwdag, niet
// bij een al lopende gisting.
export const DUBBELE_HYGIENE_LABELS: readonly string[] = [
  'Waterslot gevuld',
  'Fermentatie-emmer gesteriliseerd',
]

export interface TakenOpschoning {
  groepen: any[]
  items: any[]
  groepenGewijzigd: boolean
  itemsGewijzigd: boolean
}

// Bepaal de flow-fase van een groep uit zijn taken. Botteldag-taken →
// Afvullen, brouwdag-taken → Brouwen, alleen-metingen (HACCP-CCP's) →
// expliciet géén fase ('' — metingen verschijnen niet in de flow en zo kan
// de legacy-ID-koppeling ze nooit meer verkeerd labelen). null = geen
// uitspraak mogelijk (bijv. eigen hygiëne-groepen met vrije labels).
export const faseUitInhoud = (groep: any, items: any[]): string | null => {
  const mijn = (items || []).filter((it: any) => it?.group_id === groep?.id)
  if (!mijn.length) return null
  const keys = mijn.map((it: any) => String(it?.labelKey || ''))
  const botteldag = keys.filter(k => k.startsWith('botteldag_check_')).length
  const brouwdag = keys.filter(k => k.startsWith('brouwdag_check_')).length
  if (botteldag > 0 && botteldag >= brouwdag) return 'Afgevuld'
  if (brouwdag > 0) return 'Brouwen'
  if (mijn.every((it: any) => it?.type === 'meting')) return ''
  return null
}

// Voer de volledige opschoning uit. Groepen met een expliciet fase-veld
// (bewuste keuze via Instellingen of eerdere migratie) blijven onaangeroerd;
// alleen groepen die nog op de legacy-ID-koppeling drijven krijgen hun fase
// uit de inhoud — en die wordt expliciet vastgelegd zodat ID-verschuivingen
// nooit meer kunnen bijten. Al inactieve items blijven inactief.
export const schoonTakenOp = (groepen: any[], items: any[]): TakenOpschoning => {
  let groepenGewijzigd = false
  const nieuweGroepen = (groepen || []).map((g: any) => {
    if (!g || g.fase !== undefined) return g
    const fase = faseUitInhoud(g, items)
    if (fase === null) return g
    groepenGewijzigd = true
    return { ...g, fase }
  })

  let itemsGewijzigd = false
  const nieuweItems = (items || []).map((it: any) => {
    if (!it || it.actief === false) return it
    const dubbel = DUBBELE_BROUWDAG_CHECK_KEYS.includes(String(it.labelKey || ''))
      || (!it.labelKey && DUBBELE_HYGIENE_LABELS.includes(String(it.label || '')))
    if (!dubbel) return it
    itemsGewijzigd = true
    return { ...it, actief: false }
  })

  return { groepen: nieuweGroepen, items: nieuweItems, groepenGewijzigd, itemsGewijzigd }
}

// ── Werkruimte-badge (Productie) ────────────────────────────────────────────
// Telt, over alle nog niet gesloten batches, het aantal actieve check-taken
// in de takengroep die bij de HUIDIGE fase (batch.status) van die batch
// hoort en nog niet is afgevinkt in taken_checks. Spiegelt de fase-filtering
// die BatchFlowPage gebruikt om de checklist van de actieve stap te tonen
// (groepFase(g) === batch.status); metingen (CCP's) tellen hier niet mee —
// die zijn geen open/dicht-vinkje maar een losse waarneming.
export const telOpenstaandeBatchTaken = (
  batches: any[],
  batchTakenItems: any[],
  batchTakenGroepen: any[],
): number => {
  const items = (batchTakenItems?.length ? batchTakenItems : DEFAULT_BATCH_TAKEN_ITEMS)
    .filter((it: any) => it?.actief !== false && it?.type === 'check')
  const groepen = batchTakenGroepen?.length ? batchTakenGroepen : DEFAULT_BATCH_TAKEN_GROEPEN
  let totaal = 0
  for (const b of (batches || [])) {
    if (!b || b.status === 'Gesloten') continue
    const groepIds = groepen.filter((g: any) => groepFase(g) === b.status).map((g: any) => g.id)
    if (!groepIds.length) continue
    const checks = b.taken_checks || {}
    for (const it of items) {
      if (groepIds.includes(it.group_id) && !checks[it.id]) totaal++
    }
  }
  return totaal
}

// Vervaldata per schoonmaak-frequentie (dagen sinds de laatste log voordat
// een taak als achterstallig geldt). Spiegelt HACCPPage's DashTab/
// SchoonmaakTab, die dezelfde mapping tot nu toe elk apart inline hadden.
export const SCHOONMAAK_FREQ_DAGEN: Record<string, number> = {
  dagelijks: 1, wekelijks: 7, maandelijks: 30, per_batch: 30, anders: 30,
}

export const isSchoonmaakTaakAchterstallig = (
  taak: any,
  logs: any[],
  vandaag: Date = new Date(),
): boolean => {
  if (!taak || taak.actief === false) return false
  const eigenLogs = (logs || []).filter((l: any) => l?.taak_id === taak.id)
  if (!eigenLogs.length) return true
  const laatste = eigenLogs.slice().sort((a: any, b: any) => String(b?.datum || '').localeCompare(String(a?.datum || '')))[0]
  const t0 = new Date(vandaag); t0.setHours(0, 0, 0, 0)
  const d = new Date(laatste.datum); d.setHours(0, 0, 0, 0)
  const dagen = (t0.getTime() - d.getTime()) / 86400000
  return dagen > (SCHOONMAAK_FREQ_DAGEN[taak.frequentie] ?? 30)
}

export const telAchterstalligeSchoonmaakTaken = (
  schoonmaakTaken: any[],
  schoonmaakLog: any[],
  vandaag: Date = new Date(),
): number =>
  (schoonmaakTaken || []).filter((tk: any) => isSchoonmaakTaakAchterstallig(tk, schoonmaakLog, vandaag)).length

// Her-export voor gemak van de aanroeper (App.tsx gebruikt beide).
export { groepFase }
