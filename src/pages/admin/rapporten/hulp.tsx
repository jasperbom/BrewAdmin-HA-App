import React from 'react'
import { t } from '../../../i18n'
import { csvTekst } from '../../../utils/csv'
import { BUILTIN_KOSTEN_SOORTEN } from '../../../utils/constants'
import { berekenWinstVerlies, type WinstVerliesResult } from '../../../utils/calculations'
import { berekenWinstVerliesUitJournaal } from '../../../utils/journaal'
import { bereikGrenzen, type WvRegelId } from '../../../utils/rapporten'
export { csvProcent } from '../../../utils/rapporten'
import { periodeOmschrijving, vulIn, type Bereik } from '../../../utils/periode'

// ── Gedeelde hulpjes van de rapporten ───────────────────────────────────────

/** Wat elk rapport van de sectie meekrijgt. */
export interface RapportProps {
  /** Het bereik van een periode-rapport (de gekozen periode, niet verder dan vandaag). */
  bereik: Bereik
  /** Dezelfde periode vorig jaar, als "vergelijk" aan staat en het rapport het kent. */
  vorig: Bereik | null
  /** Einde van de periode (of vandaag): de dag van Balans en Openstaande posten. */
  peildatum: string
  vandaag: string
  /** Het rapport zet hier zijn CSV-export neer (`useCsvExport`); de knop in de periodebalk roept hem aan. */
  csvRef: React.MutableRefObject<(() => void) | null>
}

/**
 * Winst & verlies over een bereik: uit het journaal (ERP-plan 2.1), en zolang
 * dat nog leeg is (verse installatie) live uit de facturen.
 */
export function berekenWv(ctx: { journaal: any, acc: any, verkoopFacturen: any, inkoopFacturen: any }, bereik: Bereik): WinstVerliesResult {
  const { van, tot } = bereikGrenzen(bereik)
  return (ctx.journaal || []).length
    ? berekenWinstVerliesUitJournaal(ctx.journaal || [], ctx.acc || [], van, tot)
    : berekenWinstVerlies(ctx.verkoopFacturen || [], ctx.inkoopFacturen || [], ctx.acc || [], van, tot)
}

const euroTekst = (n: number): string =>
  Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** i18n-sleutel van elke regel van de winst-en-verliesrekening. */
export const WV_LABEL: Readonly<Record<WvRegelId, string>> = {
  omzet: 'rap_wv_omzet', grondstoffen: 'rap_wv_grondstoffen', verpakking: 'rap_wv_verpakking',
  brutomarge: 'rap_wv_brutomarge', overig: 'rap_wv_overig', accijns: 'rap_wv_accijns', netto: 'rap_wv_netto',
}

/** Een bedrag in centen als "€ 1.234,56", negatief met een echt minteken ("− € 915,05"). */
export const bedrag = (cent: number): string => {
  const c = Math.round(Number(cent) || 0)
  return `${c < 0 ? '− ' : ''}€ ${euroTekst(c / 100)}`
}

/** Een percentage als "+35%" of "−12%"; leeg zonder waarde. */
export const procent = (p: number | null): string => {
  if (p === null || !Number.isFinite(p)) return ''
  const r = Math.round(p)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`
}

/** Bedrag in centen voor een CSV-cel: 1234,56 (komma, geen valuta). */
export const csvEuro = (cent: number): string => ((Math.round(Number(cent) || 0)) / 100).toFixed(2).replace('.', ',')

/**
 * Zet de CSV-export van het rapport dat open staat klaar voor de knop in de
 * periodebalk. In een effect en niet tijdens het renderen: React roept een
 * component soms aan zonder daarna zijn kinderen te renderen (een setState met
 * dezelfde waarde, bijvoorbeeld bij het vergroten of draaien van het venster).
 * Maakte de sectie de ref in haar render leeg, dan bleef hij leeg en deed de
 * CSV-knop niets meer.
 */
export function useCsvExport(csvRef: React.MutableRefObject<(() => void) | null>, maak: () => void): void {
  const laatste = React.useRef(maak)
  React.useLayoutEffect(() => { laatste.current = maak })
  React.useEffect(() => {
    const roep = () => laatste.current()
    csvRef.current = roep
    return () => { if (csvRef.current === roep) csvRef.current = null }
  }, [csvRef])
}

/** De naam van een kostensoort: de ingebouwde vertaald, een eigen soort zoals hij heet. */
export const kostensoortLabel = (ks: string): string =>
  BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t(`ks_${ks.toLowerCase()}`, ks) : ks

/** Het bereik in woorden ("01-01-2026 t/m 07-10-2026"). */
export const bereikTekst = (b: Bereik): string => {
  const o = periodeOmschrijving(b)
  return vulIn(t(o.sleutel), o.vars)
}

/** Een CSV downloaden (met BOM, formule-veilig via utils/csv). */
export function downloadCsv(naam: string, rijen: unknown[][]): void {
  const blob = new Blob(['﻿' + csvTekst(rijen)], { type: 'text/csv;charset=utf-8' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: naam })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Bestandsnaamdeel voor een bereik: 2026-01-01_2026-10-07 (open kant: begin/eind). */
export const bereikNaam = (b: Bereik): string => `${b.van || 'begin'}_${b.tot || 'eind'}`

/** De kaart waarin een rapport staat: rustige kop (SectionHeader) en de inhoud. */
export const KAART = 'bg-white border border-gray-200 rounded-xl overflow-hidden min-w-0'

/** Kleur van een resultaatbedrag (winst groen, verlies rood). */
export const resultaatKleur = (cent: number): string => cent > 0 ? 'text-green-700' : cent < 0 ? 'text-red-600' : 'text-gray-700'

/** Kleine "huidige stand"-markering bij een post die de app alleen van vandaag kent. */
export const HuidigeStand: React.FC = () => (
  <span className="ml-1.5 inline-block rounded-full bg-gray-100 text-gray-600 text-[11px] font-medium px-1.5 py-0.5 align-middle">{t('rap_huidige_stand')}</span>
)
