// De tekst bij een attentiepost: het label ("Bier-THT binnen 60 dagen") en de
// toelichting ("Havenbok fles 33 cl · 58 st · THT 2-11-2026"), lang op een
// bureau en kort op een telefoon.
//
// utils/attentie.ts telt en geeft alleen i18n-sleutels en ruwe waarden terug;
// hier wordt er een zin van gemaakt met de vertaalfunctie van de aanroeper
// (dezelfde afspraak als utils/etiket.ts). Zo blijven de posten testbaar
// zonder taal en de zinnen testbaar zonder React.

import type { AttentieDetail, AttentiePost } from './attentie'
import { allergeenNamen } from './etiket'
import type { Vertaal } from './etiket'
import { fmtD, fmtDagMaand } from './format'

/** Elke `{naam}` vervangen door zijn waarde (alle voorkomens). */
export const vulIn = (s: string, params: Record<string, string | number> | null | undefined): string =>
  Object.entries(params || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), String(s ?? ''))

/**
 * Een verpakkingsnaam midden in een zin: "Sluiswit fust 20L", niet "Sluiswit
 * Fust 20L". Alleen een gewoon woord met een hoofdletter vooraan wordt klein
 * ("Fles" → "fles"); een afkorting ("KEG") blijft staan, en in het Duits — waar
 * een zelfstandig naamwoord altijd een hoofdletter heeft — blijft alles staan.
 */
export const verpakkingInZin = (naam: unknown, taal?: string | null): string => {
  const s = String(naam ?? '').trim()
  if (!s || String(taal || 'nl').toLowerCase().startsWith('de')) return s
  const m = /^(\p{Lu})(\p{Ll}+)/u.exec(s)
  return m ? m[1].toLowerCase() + s.slice(1) : s
}

/** Het label van een post, met zijn plaatshouders ingevuld; `kort` = de telefoonvorm. */
export const attentieLabel = (
  p: Pick<AttentiePost, 'sleutel' | 'kortSleutel' | 'params'>,
  t: Vertaal,
  kort = false,
): string => vulIn(t(kort && p.kortSleutel ? p.kortSleutel : p.sleutel), p.params)

export interface DetailOpties {
  /** De korte vorm (telefoon). */
  kort?: boolean
  /** Taal van de gebruiker (voor `verpakkingInZin`). */
  taal?: string | null
}

/**
 * Eén ding achter een post als tekst. Afgeleide plaatshouders: `{verpakking}`
 * (in een zin), `{soort}` (het type, vertaald: "fust"), `{datum}`
 * ("2-11-2026") en `{dag}` ("2-11") uit `datum`, en `{allergenen}` uit de
 * allergenen ("gerst, tarwe").
 */
export const detailTekst = (d: AttentieDetail, t: Vertaal, opties: DetailOpties = {}): string => {
  const sleutel = opties.kort && d.kortSleutel ? d.kortSleutel : d.sleutel
  const params: Record<string, string | number> = { ...(d.params || {}) }
  if (params.verpakking != null) params.verpakking = verpakkingInZin(params.verpakking, opties.taal)
  // `soort`: het type van de verpakking ("fust"), vertaald als dat een bekend
  // type is; anders staat er de naam zelf.
  if (params.soort != null) {
    const soort = String(params.soort).trim()
    params.soort = verpakkingInZin(t(`pkg_${soort.toLowerCase()}`, '') || soort, opties.taal)
  }
  if (params.datum != null && params.datum !== '') {
    params.dag = fmtDagMaand(params.datum)
    params.datum = fmtD(params.datum)
  }
  if (d.allergenen) params.allergenen = allergeenNamen(d.allergenen, t).join(', ')
  return vulIn(t(sleutel), params)
}

/**
 * De toelichting van een post: de eerste `max` dingen (standaard twee), en
 * "+n" voor de rest. Leeg zonder details.
 */
export const attentieToelichting = (
  p: Pick<AttentiePost, 'details'>,
  t: Vertaal,
  opties: DetailOpties & { max?: number } = {},
): string => {
  const details = p.details || []
  if (!details.length) return ''
  const max = Math.max(1, opties.max ?? 2)
  const delen = details.slice(0, max).map(d => detailTekst(d, t, opties))
  const rest = details.length - delen.length
  if (rest > 0) delen.push(vulIn(t('attentie_detail_meer'), { n: rest }))
  return delen.join(' · ')
}
