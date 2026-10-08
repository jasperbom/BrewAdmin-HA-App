import React, { useMemo } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import { overzichtCijfers, urgentieSleutel } from '../utils/beslissingen'
import type { Beslissing, Urgentie } from '../utils/beslissingen'
import { centNaarEuro } from '../utils/centen'
import type { AttentieDoel } from '../utils/attentie'
import { zetGedeeldePeriode } from '../components/ui/useGedeeldePeriode'
import { maandTitel, periodeTitel } from './admin/aangiftes/onderdelen'
import SectionHeader from '../components/ui/SectionHeader'
import StatCard from '../components/ui/StatCard'
import Btn from '../components/ui/Btn'

export interface AdministratieDashboardProps {
  /** De rijen die om een besluit vragen (utils/beslissingen.ts). App rekent ze
      één keer uit en telt met dezelfde rijen de attentie-badge van de
      werkruimte en de menubadges — dus het getal op het Admin-icoon is altijd
      het aantal rijen hier. */
  rijen: Beslissing[]
  verkoopFacturen: any[]
  inkoopFacturen: any[]
  klanten?: any[]
  breweryDetails?: any
  /** Navigeert naar het doel van een rij of kaart: de pagina (Facturen, Bank,
      Aangiftes …) met segment, filter, record (`id`) en handeling (`actie`). */
  gaNaarDoel: (d: AttentieDoel) => void
}

// Vaste, semantische kleuren (geen themakleuren): de urgentie betekent altijd
// hetzelfde, ongeacht het gekozen thema.
const URGENTIE_CHIP: Record<Urgentie, string> = {
  te_laat: 'bg-red-100 text-red-700',
  klopt_niet: 'bg-orange-100 text-orange-700',
  wacht_op_jou: 'bg-blue-100 text-blue-700',
  deadline: 'bg-gray-100 text-gray-700',
}

// Placeholders invullen; een lege naam/nummer wordt nooit een gat in de zin.
// Een ontbrekend factuurnummer laten we wegvallen in plaats van er een
// liggend streepje neer te zetten: "Factuur — · Cafe De Zwaan" leest als een
// weergavefout. Het losse scheidingsteken dat dan overblijft ruimen we op.
// `datum` is een ISO-datum en wordt dd-mm-jjjj. Een periode heet hier zoals
// op Aangiftes, waar de knop heen gaat: 'Q3 2026', 'September 2026' — niet
// '2026-09' of '09/2026'.
const periodeNaam = (k: string, v: string, vars: Record<string, string>): string | null => {
  if (k === 'maand' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return maandTitel(Number(v.slice(0, 4)), Number(v.slice(5, 7)))
  if (k === 'periode' && vars.periodeKey) return periodeTitel({ soort: 'btw', sleutel: vars.periodeKey })
  return null
}
const vul = (sleutel: string, vars?: Record<string, string>): string => {
  let s = t(sleutel)
  if (!vars) return s
  for (const [k, v] of Object.entries(vars)) {
    const waarde = k === 'datum' ? fmtD(v)
      : periodeNaam(k, v, vars) ?? (v || (k === 'klant' || k === 'leverancier' ? t('lbl_onbekend') : ''))
    s = s.split(`{${k}}`).join(waarde)
  }
  return s
    .replace(/\s*·\s*·\s*/g, ' · ')   // twee scheidingstekens naast elkaar
    .replace(/\s*·\s*$/, '')          // scheidingsteken aan het eind
    .replace(/^\s*·\s*/, '')          // scheidingsteken aan het begin
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function AdministratieDashboard({
  rijen = [], verkoopFacturen = [], inkoopFacturen = [], klanten = [], breweryDetails = null, gaNaarDoel,
}: AdministratieDashboardProps) {
  const vandaag = tod()

  // ── Deze maand ─────────────────────────────────────────────────────────────
  // Dezelfde filters en totalen als Facturen (utils/factuurFilter.ts): het
  // getal op de kaart is de totaalregel van de lijst waar de kaart heen gaat.
  const cijfers = useMemo(() => {
    const nu = new Date(); nu.setHours(0, 0, 0, 0)
    return overzichtCijfers({ verkoopFacturen, inkoopFacturen, klanten, breweryDetails, vandaag: nu, vandaagIso: vandaag })
  }, [verkoopFacturen, inkoopFacturen, klanten, breweryDetails, vandaag])

  const nFacturen = (n: number): string => t('besl_stat_n_facturen').replace('{n}', String(n))

  // Omzet en inkoop "deze maand": Facturen met status Alles en de gedeelde
  // periode op deze maand (die geldt daarna ook voor Bank en Rapporten).
  const naarMaand = (tab: 'verkoop' | 'inkoop') => {
    zetGedeeldePeriode('deze_maand')
    gaNaarDoel({ pagina: 'facturen', tab, filter: 'alles' })
  }

  return (
    <div>
      {/* ── Beslissingen: alleen wat een besluit vraagt, actie ernaast ────── */}
      {rijen.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-3">
          <SectionHeader title={t('besl_titel')} info={rijen.length} rounded="top" />
          <ul className="divide-y divide-gray-100">
            {rijen.map(b => (
              <li key={b.id} data-beslissing={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 min-h-[44px]">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${URGENTIE_CHIP[b.urgentie]}`}>
                  {t(urgentieSleutel(b.urgentie))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 break-words">{vul(b.sleutel, b.vars)}</div>
                  {b.contextSleutel && (
                    <div className="text-xs text-gray-500 break-words">{vul(b.contextSleutel, b.vars)}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  {b.bedragCent !== undefined && (
                    <span className="text-sm font-medium text-gray-700 tabular-nums">{fmt(centNaarEuro(b.bedragCent))}</span>
                  )}
                  <Btn s="sm" onClick={() => gaNaarDoel(b.doel)}>{t(b.actieSleutel)}</Btn>
                </div>
              </li>
            ))}
          </ul>
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
        <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('besl_maand_titel')}</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label={t('besl_stat_omzet')} value={fmt(centNaarEuro(cijfers.omzetCent))} sub={t('besl_stat_omzet_sub')}
            onClick={() => naarMaand('verkoop')} />
          <StatCard label={t('besl_stat_inkoop')} value={fmt(centNaarEuro(cijfers.inkoopCent))} sub={t('besl_stat_inkoop_sub')}
            onClick={() => naarMaand('inkoop')} />
          {/* Openstaand = statusfilter "open" (alle periodes): dezelfde
              selectie als het getal op de kaart. */}
          <StatCard label={t('besl_stat_debiteuren')} value={fmt(centNaarEuro(cijfers.debiteurenCent))} sub={nFacturen(cijfers.debiteurenN)}
            onClick={() => gaNaarDoel({ pagina: 'facturen', tab: 'verkoop', filter: 'open' })} />
          <StatCard label={t('besl_stat_crediteuren')} value={fmt(centNaarEuro(cijfers.crediteurenCent))} sub={nFacturen(cijfers.crediteurenN)}
            onClick={() => gaNaarDoel({ pagina: 'facturen', tab: 'inkoop', filter: 'open' })} />
        </div>
      </div>

      {/* ── Secundaire acties ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* De knoppen doen wat ze zeggen: het inkoopwerkblad openen, de
            BTW-aangifte tonen, de bestandskiezer voor een afschrift openen. */}
        <Btn v="secondary" onClick={() => gaNaarDoel({ pagina: 'facturen', tab: 'inkoop', actie: 'nieuw' })}>{t('dash_nieuwe_inkoopfactuur')}</Btn>
        <Btn v="secondary" onClick={() => gaNaarDoel({ pagina: 'bank', actie: 'importeren' })}>{t('dash_bank_importeren')}</Btn>
        <Btn v="secondary" onClick={() => gaNaarDoel({ pagina: 'aangiftes', tab: 'btw' })}>{t('tab_btw_aangifte')}</Btn>
      </div>
    </div>
  )
}

export default AdministratieDashboard
