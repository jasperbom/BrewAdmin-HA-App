// De controles vóór een afvulling — zonder iets weg te schrijven en zonder
// alert() of confirm().
//
// Twee soorten uitkomst:
//  - `fout`: dan kan het niet (geen product, geen verpakking of aantal, te
//    weinig verpakkingen op voorraad). De knop staat uit en de reden staat
//    erbij.
//  - `waarschuwingen`: het kan wel, maar de gebruiker moet het bewust willen
//    (de bevestiging zit in de knop, BevestigKnop): meer afvullen dan er
//    volgens de volumebalans in de tank zit, of een ABV die nog geen
//    vastgezette waarde is. Dat laatste komt sinds de ABV-poort vóór de eerste
//    afvulsessie (afvulsessie.ts → abvVastgezetBlokkade) alleen nog voor bij
//    een batch die al vóór die poort een sessie of afvulling had.
//
// Gedeeld door het afvulformulier binnen een sessie en het achteraf
// vastleggen van een hele sessie (AfvulSessieSectie), zodat ze hetzelfde
// vragen. Geeft i18n-sleutels met parameters terug; de aanroeper vertaalt.

import { verpakkingVoorraad } from './verpakkingVoorraad'

export interface AfvulMelding {
  sleutel: string
  params?: Record<string, string | number>
}

export interface AfvulControle {
  fout: AfvulMelding | null
  waarschuwingen: AfvulMelding[]
}

export interface AfvulVelden {
  product_id?: number | string | null
  verpakking_id?: number | string | null
  hoeveelheid?: number | string | null
  inhoud_per_eenheid?: number | string | null
}

export interface AfvulControleCtx {
  batch: {id: number | string, liter_vergist?: unknown, ABV?: unknown, abv_definitief?: unknown, FG?: unknown} | null | undefined
  verpakkingen?: any[] | null
  onderdelen?: any[] | null
  afvullingen?: any[] | null
  verliesRegistraties?: any[] | null
  gistMetingen?: any[] | null
}

const getal = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const zelfdeId = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b)
const ingevuld = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== ''

/**
 * Alle controles vóór een afvulling: product, verpakking en aantal,
 * verpakkingsvoorraad (fout), tankvolume en de ABV (waarschuwing). Dezelfde
 * regels als de vroegere alerts en confirms op de batchpagina.
 */
export const afvulControle = (velden: AfvulVelden, ctx: AfvulControleCtx): AfvulControle => {
  const uit: AfvulControle = {fout: null, waarschuwingen: []}
  const batch = ctx.batch
  if (!batch) return {...uit, fout: {sleutel: 'err_select_product'}}
  if (!ingevuld(velden.product_id)) return {...uit, fout: {sleutel: 'err_select_product'}}
  const n = getal(velden.hoeveelheid)
  if (!ingevuld(velden.verpakking_id) || !(n > 0)) return {...uit, fout: {sleutel: 'err_select_packaging_qty'}}
  const vp = (ctx.verpakkingen || []).find(v => zelfdeId(v?.id, velden.verpakking_id))
  if (!vp) return {...uit, fout: {sleutel: 'err_invalid_packaging'}}
  const voorraad = verpakkingVoorraad(vp, ctx.onderdelen || [])
  if (voorraad < n) return {...uit, fout: {sleutel: 'err_insufficient_packaging_n', params: {n: voorraad}}}

  // Tankvolume (ERP-plan 0.7): wat er na de verpakte liters en de verliezen
  // nog in de tank hoort te zitten.
  const tankLiter = getal(batch.liter_vergist)
  if (tankLiter > 0) {
    const verpakt = (ctx.afvullingen || [])
      .filter(a => zelfdeId(a?.batch_id, batch.id))
      .reduce((s, a) => s + getal(a.inhoud_per_eenheid) * getal(a.hoeveelheid), 0)
    const verlies = (ctx.verliesRegistraties || [])
      .filter(r => zelfdeId(r?.batch_id, batch.id))
      .reduce((s, r) => s + getal(r.liter), 0)
    const rest = tankLiter - verlies - verpakt
    const nieuw = n * getal(velden.inhoud_per_eenheid)
    if (nieuw > rest + 0.001) {
      uit.waarschuwingen.push({sleutel: 'afvul_waarschuwing_tankvolume',
        params: {liters: nieuw.toFixed(1), rest: Math.max(0, rest).toFixed(1)}})
    }
  }

  // De ABV waarmee de voorcalculatie van de accijns wordt bevroren.
  const abv = getal(batch.ABV)
  if (abv <= 0) {
    uit.waarschuwingen.push({sleutel: 'afvul_waarschuwing_geen_abv'})
  } else if (!batch.abv_definitief) {
    const heeftFg = getal(batch.FG) > 0
    const heeftMeting = (ctx.gistMetingen || []).some(m => zelfdeId(m?.batch_id, batch.id) && getal(m.sg) > 0)
    if (!heeftFg && !heeftMeting) {
      uit.waarschuwingen.push({sleutel: 'afvul_waarschuwing_abv_schatting', params: {abv: abv.toFixed(1)}})
    }
  }
  return uit
}

/** Een melding als tekst, met de vertaalfunctie van de aanroeper. */
export const afvulMeldingTekst = (m: AfvulMelding, t: (k: string) => string): string => {
  let s = t(m.sleutel)
  for (const [k, v] of Object.entries(m.params || {})) s = s.split(`{${k}}`).join(String(v))
  return s
}
