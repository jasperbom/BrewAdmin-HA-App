// Herstel van kapotte verwijzingen uit de integriteitscheck (utils/integriteit.ts).
//
// Alleen stamgegevens-koppelingen zijn hier te herstellen: welk ingrediënt bij
// een lot hoort, welk product bij een batch, afvulling of artikel, welke
// verpakking bij een afvulling. Dat zijn keuzes die de gebruiker kan maken
// zonder dat er een boeking verandert. Verwijzingen in accijns, uitleveringen,
// picks en facturen blijven bewust buiten schot: dat zijn boekingen (deels
// append-only) waarvan een "reparatie" de administratie zou herschrijven.
//
// Puur en UI-vrij; de Instellingen-pagina (Data-gezondheid) toont de keuze.

import type { IntegriteitProbleem } from './integriteit'
import type { AuditSoort } from './audit'

export interface HerstelKandidaat {
  id: any
  label: string
}

export interface HerstelOptie {
  /** Kan de gebruiker dit probleem hier oplossen? */
  herstelbaar: boolean
  /** Records waaraan hij opnieuw kan koppelen (doel-key), op label gesorteerd. */
  kandidaten: HerstelKandidaat[]
  /** Voorgestelde kandidaat (id) op grond van een naam, of null. */
  suggestie: any
  /** Mag de koppeling ook leeggemaakt worden? (Het record valt dan terug op
   * iets anders: een afvulling op haar batch, een batch op zijn naam.) */
  ontkoppelen: boolean
  /** Herkenbare omschrijving van het record met de kapotte verwijzing
   * (lotnummer, batchnaam …), leeg als er niets bruikbaars op staat. */
  omschrijving: string
}

/** Auditsoort per herstelbare data-key. */
export const HERSTEL_AUDIT_SOORT: Record<string, AuditSoort> = {
  lots: 'Lot', batches: 'Batch', afvullingen: 'Afvulling', product_artikelen: 'Artikel',
}

/** Korte, herkenbare omschrijving van een record — geen vertaalde tekst,
 * alleen wat er zelf op staat. */
export function recordOmschrijving(entiteit: string, r: any): string {
  if (!r) return ''
  const delen: string[] = []
  const zet = (v: unknown) => { const s = String(v ?? '').trim(); if (s) delen.push(s) }
  if (entiteit === 'lots') {
    zet(r.lotnummer || r.lotnr)
    if (r.hoeveelheid != null && r.hoeveelheid !== '') zet(`${r.hoeveelheid} ${r.eenheid || ''}`)
    zet(r.leverancier)
  } else if (entiteit === 'batches') {
    zet(r.naam || r.biernaam)
    zet(r.batch_nr || r.batchnummer)
    zet(r.brouwdatum)
  } else if (entiteit === 'afvullingen') {
    zet(r.verpakking_type)
    zet(r.datum)
  } else if (entiteit === 'product_artikelen') {
    zet(r.sku)
    zet(r.verpakking_type)
  } else {
    zet(r.naam || r.omschrijving || r.nummer || r.factuurnummer)
  }
  return delen.join(' · ')
}

/** Herstelbare velden → of ontkoppelen zinvol is. Een lot zonder ingrediënt
 * of een artikel zonder product betekent niets, die kunnen alleen opnieuw
 * gekoppeld worden. */
const HERSTELBAAR: Record<string, { ontkoppelen: boolean }> = {
  'lots.ingredient_id': { ontkoppelen: false },
  'batches.product_id': { ontkoppelen: true },
  'batches.product_ids': { ontkoppelen: true },
  'afvullingen.product_id': { ontkoppelen: true },
  'afvullingen.verpakking_id': { ontkoppelen: true },
  'product_artikelen.product_id': { ontkoppelen: false },
  'product_artikelen.verpakking_id': { ontkoppelen: true },
}

/** De data-keys die een herstel kan wijzigen (de pagina heeft er een setter voor nodig). */
export const HERSTEL_ENTITEITEN = ['lots', 'batches', 'afvullingen', 'product_artikelen'] as const

const normaal = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const zelfdeId = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b)

const labelVan = (doel: string, r: any): string => {
  const naam = String(r?.naam || r?.biernaam || r?.omschrijving || '').trim()
  if (doel === 'verpakkingen' && r?.type && naam && normaal(r.type) !== normaal(naam)) return `${naam} (${r.type})`
  return naam || `#${r?.id}`
}

/** Eerste kandidaat waarvan de naam gelijk is aan een van de hints. */
const opNaam = (kandidaten: any[], hints: unknown[]): any => {
  const gezocht = hints.map(normaal).filter(Boolean)
  if (!gezocht.length) return null
  const hit = kandidaten.find((k: any) => gezocht.includes(normaal(k?.naam)))
    || kandidaten.find((k: any) => gezocht.includes(normaal(k?.type)))
  return hit ? hit.id : null
}

/**
 * Wat de gebruiker met één kapotte verwijzing kan doen. `d` is dezelfde
 * data die de integriteitscheck kreeg, aangevuld met `voorraad_log` en
 * `batch_ingredienten` (voor de naam van een ingrediënt bij een wees-lot).
 */
export function herstelOpties(p: IntegriteitProbleem, d: Record<string, any[] | undefined>): HerstelOptie {
  const rec = (d[p.entiteit] || []).find((r: any) => zelfdeId(r?.id, p.id))
  const omschrijving = recordOmschrijving(p.entiteit, rec)
  const regel = HERSTELBAAR[`${p.entiteit}.${p.veld}`]
  if (!regel) return { herstelbaar: false, kandidaten: [], suggestie: null, ontkoppelen: false, omschrijving }
  const doelen = (d[p.doel] || []).filter((r: any) => r && r.id != null)
  const kandidaten = doelen
    .map((r: any) => ({ id: r.id, label: labelVan(p.doel, r) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  let suggestie: any = null

  if (p.entiteit === 'lots') {
    // Een lot draagt zelf geen naam; het ontvangstlog en de batchregels wél.
    const hints = [
      ...(d.voorraad_log || []).filter((l: any) => zelfdeId(l?.lot_id, p.id)).map((l: any) => l?.ingredient_naam),
      ...(d.batch_ingredienten || []).filter((b: any) => zelfdeId(b?.lot_id, p.id)).map((b: any) => b?.naam),
    ]
    suggestie = opNaam(doelen, hints)
  } else if (p.doel === 'producten') {
    const batch = p.entiteit === 'batches' ? rec
      : p.entiteit === 'afvullingen' ? (d.batches || []).find((b: any) => zelfdeId(b?.id, rec?.batch_id))
      : null
    // Een afvulling volgt eerst het (geldige) product van haar batch.
    if (p.entiteit === 'afvullingen' && batch && doelen.some((x: any) => zelfdeId(x.id, batch.product_id))) {
      suggestie = doelen.find((x: any) => zelfdeId(x.id, batch.product_id)).id
    } else {
      suggestie = opNaam(doelen, [batch?.biernaam, batch?.naam, rec?.biernaam, rec?.bier_naam, rec?.naam])
    }
  } else if (p.doel === 'verpakkingen') {
    suggestie = opNaam(doelen, [rec?.verpakking_type, rec?.verpakking_naam])
  }

  return { herstelbaar: true, kandidaten, suggestie, ontkoppelen: regel.ontkoppelen, omschrijving }
}

/**
 * Pas het herstel toe op de records van `p.entiteit`: koppel het veld aan
 * `nieuwId` of maak het leeg (`null`). Bij een lijstveld (`product_ids`)
 * wordt alleen de kapotte id vervangen of weggehaald, zonder dubbelen. Geeft
 * een nieuwe array terug; andere records blijven dezelfde objecten.
 */
export function pasHerstelToe(records: any[] | null | undefined, p: IntegriteitProbleem, nieuwId: any): any[] {
  return (records || []).map((r: any) => {
    if (!zelfdeId(r?.id, p.id)) return r
    const huidig = r[p.veld]
    if (Array.isArray(huidig)) {
      const zonder = huidig.filter((v: any) => !zelfdeId(v, p.doel_id))
      const lijst = nieuwId == null || zonder.some((v: any) => zelfdeId(v, nieuwId)) ? zonder : [...zonder, nieuwId]
      return { ...r, [p.veld]: lijst }
    }
    if (!zelfdeId(huidig, p.doel_id)) return r
    if (nieuwId == null) {
      const { [p.veld]: _weg, ...rest } = r
      return rest
    }
    return { ...r, [p.veld]: nieuwId }
  })
}
