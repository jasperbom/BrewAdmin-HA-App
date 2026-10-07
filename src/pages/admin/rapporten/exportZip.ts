import { t } from '../../../i18n'
import { ADDON_BASE } from '../../../utils/api'
import { resolveKlantSnapshot } from '../../../utils/klant'
import { breweryMetTermijn } from '../../../utils/facturen'
import { makeZip } from '../../../utils/zip'
import { csvTekst, csvBedrag, inkoopRegelExport } from '../../../utils/csv'
import { inBereik, type Bereik } from '../../../utils/periode'
import { wvOpbouw, omzetPerArtikel, journaalWeergave, dagboekSleutel } from '../../../utils/rapporten'
import { buildFactuurHTML } from '../../../components/PakbonExport'
import type { AdminContextWaarde } from '../adminContext'
import { berekenWv, kostensoortLabel, bereikNaam, WV_LABEL } from './hulp'

// ── Alles exporteren (ZIP) over de gekozen periode ──────────────────────────
// De boekhouding voor de accountant: verkoop- en inkoopfacturen (per regel),
// het journaal (met de kapitaalboekingen als losse regels — het oude
// transactieoverzicht), de winst-en-verliesrekening in de volgorde waarin hij
// optelt, de omzet per artikel, de verkoopfacturen als printbare HTML en de
// PDF-bijlagen van de inkoopfacturen.

const naarBestand = (tekst: string): Uint8Array => new TextEncoder().encode('﻿' + tekst)

// Bedragen in de ZIP met een punt (1234.56), zoals de factuurbestanden ernaast
// en zoals de export altijd al deed — de accountant leest één notatie in.
// De CSV-knop bij een rapport gebruikt de komma (csvEuro in hulp.tsx).
const zipEuro = (cent: number): string => ((Math.round(Number(cent) || 0)) / 100).toFixed(2)

export async function exportAllesZip(ctx: AdminContextWaarde, bereik: Bereik): Promise<void> {
  const { verkoopFacturen, inkoopFacturen, klanten, breweryDetails, factuurLogo, klantNaamVoor, journaal, kapitaalBoekingen } = ctx
  const files: { name: string, data: Uint8Array }[] = []
  const vf = (verkoopFacturen || []).filter((f: any) => inBereik(f?.datum, bereik))
  const inf = (inkoopFacturen || []).filter((f: any) => inBereik(f?.datum, bereik))
  const getal = (n: unknown) => n !== null && n !== undefined && n !== '' ? Number(n).toFixed(2) : ''

  // 1. Verkoopfacturen, per regel
  const vfKop = [t('lbl_date'), t('lbl_invoice'), t('lbl_klant'), t('lbl_status'), t('lbl_description'), t('lbl_quantity'), t('lbl_prijs_per_stuk'), t('lbl_btw_pct'), t('lbl_netto'), t('lbl_btw_bedrag'), t('lbl_bruto')]
  const vfRijen: unknown[][] = []
  for (const f of vf) {
    if ((f.regels || []).length) {
      for (const r of f.regels) vfRijen.push([f.datum, f.factuurnummer || '', klantNaamVoor(f), f.status || '', r.omschrijving || '', r.hoeveelheid ?? '', getal(r.prijs_per_stuk), r.btw_pct ?? '', getal(r.netto), getal(r.btw_bedrag), getal(r.bruto)])
    } else {
      vfRijen.push([f.datum, f.factuurnummer || '', klantNaamVoor(f), f.status || '', '', '', '', '', getal(f.netto), getal(f.btw), getal(f.bruto)])
    }
  }
  files.push({ name: 'csv/verkoopfacturen.csv', data: naarBestand(csvTekst([vfKop, ...vfRijen])) })

  // 2. Inkoopfacturen, per regel (inkoopRegelExport leest ook oude boekingen)
  const ifKop = [t('lbl_date'), t('lbl_invoice'), t('lbl_supplier'), t('lbl_description'), t('lbl_netto'), t('lbl_btw_pct'), t('lbl_btw_bedrag'), t('lbl_bruto')]
  const ifRijen: unknown[][] = []
  for (const f of inf) {
    if ((f.regels || []).length) {
      for (const r of f.regels) {
        const x = inkoopRegelExport(r)
        ifRijen.push([f.datum, f.factuurnummer || '', f.leverancier || '', x.omschrijving, csvBedrag(x.netto), x.btwPct, csvBedrag(x.btwBedrag), csvBedrag(x.bruto)])
      }
    } else {
      ifRijen.push([f.datum, f.factuurnummer || '', f.leverancier || '', '', getal(f.totaal_netto), '', getal(f.totaal_btw), getal(f.totaal_bruto)])
    }
  }
  files.push({ name: 'csv/inkoopfacturen.csv', data: naarBestand(csvTekst([ifKop, ...ifRijen])) })

  // 3. Journaal + kapitaalboekingen, oudste eerst
  const jr = journaalWeergave(journaal || [], kapitaalBoekingen || [], bereik).reverse()
  const jrKop = [t('lbl_date'), t('lbl_dagboek'), t('lbl_invoice'), t('lbl_relatie'), t('lbl_omschrijving'), t('lbl_kostensoort'), t('lbl_netto'), t('lbl_btw'), t('lbl_total')]
  files.push({ name: 'csv/journaal.csv', data: naarBestand(csvTekst([jrKop, ...jr.map(r => [
    r.datum, t(dagboekSleutel(r.dagboek), r.dagboek) + (r.buitenJournaal ? ` (${t('rap_buiten_journaal')})` : ''),
    r.nummer, r.relatie, r.omschrijving, r.kostensoort ? kostensoortLabel(r.kostensoort) : '',
    zipEuro(r.netto_cent), zipEuro(r.btw_cent), zipEuro(r.bruto_cent),
  ])])) })

  // 4. Winst & verlies, van boven naar beneden opgeteld
  const wv = wvOpbouw(berekenWv(ctx, bereik))
  const wvRijen: unknown[][] = [[t('rap_kol_post'), t('lbl_bedrag')]]
  for (const r of wv) {
    wvRijen.push([t(WV_LABEL[r.id]), zipEuro(r.cent)])
    for (const k of r.kostensoorten || []) wvRijen.push([`  ${kostensoortLabel(k.kostensoort)}`, zipEuro(k.cent)])
  }
  files.push({ name: 'csv/winst_verlies.csv', data: naarBestand(csvTekst(wvRijen)) })

  // 5. Omzet per artikel
  const omzet = omzetPerArtikel(vf, bereik)
  const naam = (g: typeof omzet[number]) => g.soort === 'statiegeld' ? t(g.statiegeld_soort === 'fust' ? 'statiegeld_fust' : 'statiegeld_snd')
    : g.soort === 'zonder_regels' ? t('rap_zonder_regels') : g.label || t('lbl_naamloos')
  files.push({ name: 'csv/omzet_artikel.csv', data: naarBestand(csvTekst([
    [t('rap_kol_artikel'), t('lbl_quantity'), t('lbl_netto'), t('lbl_btw'), t('lbl_bruto')],
    ...omzet.map(g => [naam(g), g.aantal, zipEuro(g.netto_cent), zipEuro(g.btw_cent), zipEuro(g.bruto_cent)]),
  ])) })

  // 6. Verkoopfacturen als HTML (printbaar naar PDF)
  const enc = new TextEncoder()
  const inst = (breweryDetails as any) || {}
  for (const f of vf) {
    const order = resolveKlantSnapshot(f, klanten)
    const html = buildFactuurHTML(order, f, breweryMetTermijn(f, klanten, inst), '', factuurLogo)
    const bestandsnaam = String(f.factuurnummer || `VF-${f.id}`).replace(/[^a-zA-Z0-9_-]/g, '_')
    files.push({ name: `verkoopfacturen/${bestandsnaam}.html`, data: enc.encode(html) })
  }

  // 7. PDF-bijlagen van de inkoopfacturen
  const fileBase = ADDON_BASE + 'api/file/'
  await Promise.all(inf.filter((f: any) => f.bijlage?.bestand).map(async (f: any) => {
    try {
      const res = await fetch(fileBase + f.bijlage.bestand)
      if (!res.ok) return
      files.push({ name: `inkoopfacturen/${f.bijlage.bestand}`, data: new Uint8Array(await res.arrayBuffer()) })
    } catch { /* een ontbrekende bijlage houdt de export niet tegen */ }
  }))

  const zip = makeZip(files)
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })),
    download: `boekhouding_${bereikNaam(bereik)}.zip`,
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
