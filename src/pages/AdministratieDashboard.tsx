import React, { useMemo } from 'react'
import { t } from '../i18n'
import { fmt, tod } from '../utils/format'
import { beslissingen, urgentieSleutel } from '../utils/beslissingen'
import type { Beslissing, Urgentie } from '../utils/beslissingen'
import { centNaarEuro, toCent } from '../utils/centen'
import { isVerkoopFactuurOpen, openInkoopFacturen } from '../utils/facturen'
import type { AttentiePost, AttentieDoel } from '../utils/attentie'
import SectionHeader from '../components/ui/SectionHeader'
import StatCard from '../components/ui/StatCard'
import Btn from '../components/ui/Btn'

interface AdministratieDashboardProps {
  btwInst?: any
  btwAangiftes: any[]
  bankKoppelingen: Record<string, any>
  accijnsAangiftes: any[]
  acc: any[]
  inkoopFacturen: any[]
  verkoopFacturen: any[]
  klanten?: any[]
  breweryDetails?: any
  /** Blijft in de interface zodat App.tsx ongewijzigd kan doorgeven, maar het
      dashboard leest hem niet meer: de badge telt posten, dit scherm toont
      besluiten. Beide leunen op dezelfde selecties (utils/facturen.ts,
      utils/btw.ts, utils/calculations.ts), dus ze blijven elkaar dekken. */
  attentie?: AttentiePost[]
  /** Aansluitverschil van de balans in centen (zie utils/beslissingen.ts).
      Nog niet gevuld: die berekening leeft in de render van BoekhoudingPage. */
  aansluitverschilCent?: number
  /** Navigeert naar het doel van een beslissing (pagina + tabblad). Zonder
      deze prop valt het dashboard terug op setPage + setBoekhoudingTab. */
  gaNaarDoel?: (d: AttentieDoel) => void
  setPage: (id: string) => void
  setBoekhoudingTab: (tab: string | null) => void
}

// Vaste, semantische kleuren (geen themakleuren): de urgentie betekent altijd
// hetzelfde, ongeacht het gekozen thema.
const URGENTIE_CHIP: Record<Urgentie, string> = {
  te_laat: 'bg-red-100 text-red-700',
  klopt_niet: 'bg-orange-100 text-orange-700',
  wacht_op_jou: 'bg-blue-100 text-blue-700',
  deadline: 'bg-gray-100 text-gray-700',
}

function AdministratieDashboard({
  btwInst = {}, btwAangiftes = [], bankKoppelingen = {}, accijnsAangiftes = [], acc = [],
  inkoopFacturen = [], verkoopFacturen = [], klanten = [], breweryDetails = null,
  aansluitverschilCent, gaNaarDoel, setPage, setBoekhoudingTab,
}: AdministratieDashboardProps) {
  const ga = (d: AttentieDoel) => {
    if (gaNaarDoel) gaNaarDoel(d)
    else if (d.pagina === 'boekhouding') { setBoekhoudingTab(d.tab || null); setPage('boekhouding') }
    else setPage(d.pagina)
  }
  const gaNaarBoekhouding = (tab: string) => ga({ pagina: 'boekhouding', tab })

  const vandaag = tod()
  const vandaagDate = new Date(); vandaagDate.setHours(0, 0, 0, 0)

  // ── Beslissingen ───────────────────────────────────────────────────────────
  // Eén bron (utils/beslissingen.ts) die zelf niets uitrekent maar de
  // bestaande selecties bundelt — zo staat er nergens meer een los sommetje.
  const rijen = useMemo<Beslissing[]>(() => beslissingen({
    verkoopFacturen, inkoopFacturen, klanten, breweryDetails,
    btwPeriode: btwInst?.periode === 'maand' ? 'maand' : 'kwartaal',
    btwAangiftes, bankKoppelingen,
    accijnsAangiftes, accijns: acc,
    aansluitverschilCent,
    vandaagIso: vandaag, vandaag: vandaagDate,
  }), [verkoopFacturen, inkoopFacturen, klanten, breweryDetails, btwInst, btwAangiftes,
       bankKoppelingen, accijnsAangiftes, acc, aansluitverschilCent, vandaag])

  // Placeholders invullen; een lege naam/nummer wordt nooit een gat in de zin.
  // Een ontbrekend factuurnummer laten we wegvallen in plaats van er een
  // liggend streepje neer te zetten: "Factuur — · Cafe De Zwaan" leest als een
  // weergavefout. Het losse scheidingsteken dat dan overblijft ruimen we op.
  const vul = (sleutel: string, vars?: Record<string, string>): string => {
    let s = t(sleutel)
    if (!vars) return s
    for (const [k, v] of Object.entries(vars)) {
      const waarde = v || (k === 'klant' || k === 'leverancier' ? t('lbl_onbekend') : '')
      s = s.split(`{${k}}`).join(waarde)
    }
    return s
      .replace(/\s*·\s*·\s*/g, ' · ')   // twee scheidingstekens naast elkaar
      .replace(/\s*·\s*$/, '')          // scheidingsteken aan het eind
      .replace(/^\s*·\s*/, '')          // scheidingsteken aan het begin
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  // ── Deze maand ─────────────────────────────────────────────────────────────
  const maand = vandaag.slice(0, 7)
  const inMaand = (d: any): boolean => String(d || '').slice(0, 7) === maand
  const cijfers = useMemo(() => {
    // Centen zijn canoniek (ERP 2.2); oudere facturen hebben alleen euro's.
    const centOf = (euro: any, cent: any): number =>
      cent === null || cent === undefined || !Number.isFinite(Number(cent)) ? toCent(euro) : Number(cent)
    let omzetCent = 0
    let inkoopCent = 0
    let debiteurenCent = 0
    let crediteurenCent = 0
    let debiteurenN = 0
    for (const f of verkoopFacturen || []) {
      if (inMaand(f?.datum)) omzetCent += centOf(f?.netto, f?.netto_cent)
      if (isVerkoopFactuurOpen(f)) {
        debiteurenCent += centOf(f?.bruto, f?.bruto_cent)
        debiteurenN++
      }
    }
    for (const f of inkoopFacturen || []) {
      if (inMaand(f?.datum)) inkoopCent += centOf(f?.totaal_netto, f?.totaal_netto_cent)
    }
    const open = openInkoopFacturen(inkoopFacturen)
    for (const f of open) crediteurenCent += centOf(f?.totaal_bruto, f?.totaal_bruto_cent)
    return {
      omzet: centNaarEuro(omzetCent),
      inkoop: centNaarEuro(inkoopCent),
      debiteuren: centNaarEuro(debiteurenCent),
      debiteurenN,
      crediteuren: centNaarEuro(crediteurenCent),
      crediteurenN: open.length,
    }
  }, [verkoopFacturen, inkoopFacturen, maand])

  const nFacturen = (n: number): string => t('besl_stat_n_facturen').replace('{n}', String(n))

  return (
    <div>
      {/* ── Beslissingen: alleen wat een besluit vraagt, actie ernaast ────── */}
      {rijen.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-3">
          <SectionHeader title={t('besl_titel')} info={rijen.length} rounded="top" />
          <div className="divide-y divide-gray-100">
            {rijen.map(b => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 min-h-[44px]">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${URGENTIE_CHIP[b.urgentie]}`}>
                  {t(urgentieSleutel(b.urgentie))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800">{vul(b.sleutel, b.vars)}</div>
                  {b.contextSleutel && (
                    <div className="text-xs text-gray-500">{vul(b.contextSleutel, b.vars)}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  {b.bedragCent !== undefined && (
                    <span className="text-sm font-medium text-gray-700 tabular-nums">{fmt(centNaarEuro(b.bedragCent))}</span>
                  )}
                  <Btn s="sm" onClick={() => ga(b.doel)}>{t(b.actieSleutel)}</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-6 text-sm text-gray-600">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs font-bold flex-shrink-0">✓</span>
          {t('besl_geen')}
        </div>
      )}
      {rijen.length > 0 && (
        <p className="text-xs text-gray-500 mb-6">{t('besl_verder_niets')}</p>
      )}

      {/* ── Deze maand ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 mb-2">{t('besl_maand_titel')}</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label={t('besl_stat_omzet')} value={fmt(cijfers.omzet)} sub={t('besl_stat_omzet_sub')}
            onClick={() => gaNaarBoekhouding('verkoop')} />
          <StatCard label={t('besl_stat_inkoop')} value={fmt(cijfers.inkoop)} sub={t('besl_stat_inkoop_sub')}
            onClick={() => gaNaarBoekhouding('inkoop')} />
          <StatCard label={t('besl_stat_debiteuren')} value={fmt(cijfers.debiteuren)} sub={nFacturen(cijfers.debiteurenN)}
            onClick={() => gaNaarBoekhouding('verkoop')} />
          <StatCard label={t('besl_stat_crediteuren')} value={fmt(cijfers.crediteuren)} sub={nFacturen(cijfers.crediteurenN)}
            onClick={() => gaNaarBoekhouding('inkoop')} />
        </div>
      </div>

      {/* ── Secundaire acties ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Btn v="secondary" onClick={() => gaNaarBoekhouding('inkoop')}>{t('dash_nieuwe_inkoopfactuur')}</Btn>
        <Btn v="secondary" onClick={() => gaNaarBoekhouding('btw_aangifte')}>{t('tab_btw_aangifte')}</Btn>
        <Btn v="secondary" onClick={() => gaNaarBoekhouding('bank')}>{t('dash_bank_importeren')}</Btn>
      </div>
    </div>
  )
}

export default AdministratieDashboard
