import React, { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import { laatsteOpenstaandeBtwPeriode, telOpenstaandeBtwPerioden, periodeKeyLabel } from '../utils/btw'
import { openAccijnsMaanden } from '../utils/calculations'
import {
  vervallenVerkoopFacturen, dagenTeLaat, openInkoopFacturen, dagenOpen,
  isInkoopFactuurAchterstallig, INKOOP_ACHTERSTALLIG_DAGEN,
} from '../utils/facturen'
import { findLiveKlant } from '../utils/klant'
import { attentieDoel, attentieTotaal } from '../utils/attentie'
import type { AttentiePost, AttentieDoel } from '../utils/attentie'
import { getServerHealth, ServerHealth } from '../utils/api'
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
  /** De attentieposten van de werkruimte Administratie — precies de lijst
      achter het getal op de werkruimte-knop in de header (utils/attentie.ts),
      zodat dashboard en badge nooit iets anders zeggen. */
  attentie?: AttentiePost[]
  /** Navigeert naar het doel van een post (pagina + tabblad). Zonder deze
      prop valt het dashboard terug op setPage + setBoekhoudingTab. */
  gaNaarDoel?: (d: AttentieDoel) => void
  setPage: (id: string) => void
  setBoekhoudingTab: (tab: string | null) => void
}

const MAX_RIJEN = 5

function AdministratieDashboard({
  btwInst = {}, btwAangiftes = [], bankKoppelingen = {}, accijnsAangiftes = [], acc = [],
  inkoopFacturen = [], verkoopFacturen = [], klanten = [], breweryDetails = null,
  attentie = [], gaNaarDoel, setPage, setBoekhoudingTab,
}: AdministratieDashboardProps) {
  const gaNaarBoekhouding = (tab: string) => {
    if (gaNaarDoel) gaNaarDoel({ pagina: 'boekhouding', tab })
    else { setBoekhoudingTab(tab); setPage('boekhouding') }
  }
  const gaNaarPost = (p: AttentiePost) => {
    const d = attentieDoel(p)
    if (gaNaarDoel) gaNaarDoel(d)
    else if (d.pagina === 'boekhouding') gaNaarBoekhouding(d.tab || 'verkoop')
    else setPage(d.pagina)
  }

  const vandaag = tod()
  const vandaagDate = new Date(); vandaagDate.setHours(0, 0, 0, 0)
  const huidigJaar = vandaagDate.getFullYear()
  const attentieAantal = attentieTotaal(attentie)

  // ── Vervallen verkoopfacturen ──────────────────────────────────────────────
  // Zelfde selectie als de badge en de rode lijst op Boekhouding → Verkoop.
  const vervallen = useMemo(
    () => vervallenVerkoopFacturen(verkoopFacturen, klanten, breweryDetails, vandaag),
    [verkoopFacturen, klanten, breweryDetails, vandaag]
  )
  const klantNaam = (f: any): string => (findLiveKlant(f, klanten)?.naam || f?.klant_naam || t('lbl_onbekend')).toString()

  // ── Openstaande BTW-periodes ───────────────────────────────────────────────
  // Alleen periodes met daadwerkelijk gefactureerde omzet/inkoop tellen mee —
  // anders zou een jonge onderneming kwartalen van vóór de oprichting als
  // openstaand te zien krijgen (zie telOpenstaandeBtwPerioden in utils/btw.ts).
  const periodeType = btwInst?.periode === 'maand' ? 'maand' : 'kwartaal'
  const alleFacturen = useMemo(() => [...verkoopFacturen, ...inkoopFacturen], [verkoopFacturen, inkoopFacturen])
  const btwOpenAantal = useMemo(
    () => telOpenstaandeBtwPerioden([huidigJaar - 1, huidigJaar], periodeType, btwAangiftes, bankKoppelingen, alleFacturen, vandaag),
    [huidigJaar, periodeType, btwAangiftes, bankKoppelingen, alleFacturen, vandaag]
  )
  const btwMeestUrgent = useMemo(
    () => laatsteOpenstaandeBtwPeriode([huidigJaar - 1, huidigJaar], periodeType, btwAangiftes, bankKoppelingen, alleFacturen, vandaag),
    [huidigJaar, periodeType, btwAangiftes, bankKoppelingen, alleFacturen, vandaag]
  )

  // ── Openstaande accijnsaangiftes ───────────────────────────────────────────
  // Alle afgelopen maanden met uitslagen waarvan de aangifte nog niet is
  // ingediend of betaald (nieuwste eerst) — niet alleen de vorige maand.
  const accijnsOpen = useMemo(() => openAccijnsMaanden(accijnsAangiftes, acc, vandaagDate), [accijnsAangiftes, acc, vandaag])

  // ── Openstaande inkoopfacturen ─────────────────────────────────────────────
  // Alle onbetaalde inkoopfacturen, oudste eerst; wie langer dan de vuistregel
  // (INKOOP_ACHTERSTALLIG_DAGEN) openstaat is achterstallig en telt in de
  // badge. De hele lijst blijft hier zichtbaar: ook een verse factuur wil je
  // nog betalen.
  const openInkoop = useMemo(() => openInkoopFacturen(inkoopFacturen), [inkoopFacturen])
  const achterstalligInkoop = openInkoop.filter((f: any) => isInkoopFactuurAchterstallig(f, vandaag)).length

  // ── Serverhealth ───────────────────────────────────────────────────────────
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null)
  useEffect(() => { getServerHealth().then(setServerHealth) }, [])
  const backupOud = serverHealth?.laatste_backup ? (vandaagDate.getTime() - new Date(serverHealth.laatste_backup).getTime()) / 86400000 > 2 : false
  const serverGezond = !!serverHealth?.ok && !backupOud

  const meerRegel = (aantal: number, tab: string) => aantal > MAX_RIJEN && (
    <div className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => gaNaarBoekhouding(tab)}>
      {t('msg_n_meer').replace('{n}', String(aantal - MAX_RIJEN))}
    </div>
  )

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Btn s="lg" onClick={() => gaNaarBoekhouding('inkoop')}>{t('dash_nieuwe_inkoopfactuur')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => gaNaarBoekhouding('btw_aangifte')}>{t('tab_btw_aangifte')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => gaNaarBoekhouding('bank')}>{t('dash_bank_importeren')}</Btn>
      </div>

      {/* ── Vraagt om aandacht — dezelfde posten als de badge in de header ── */}
      {attentieAantal > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('attentie_titel')} info={attentieAantal} rounded="top" />
          <div className="divide-y divide-gray-100">
            {attentie.map(p => (
              <button key={p.id} type="button" onClick={() => gaNaarPost(p)}
                className="w-full flex items-center gap-3 px-5 py-3 min-h-[44px] text-left hover:bg-gray-50 transition-colors">
                <span className="bg-orange-500 text-white text-xs rounded-full px-1 min-w-[1.25rem] h-5 flex items-center justify-center leading-none font-bold flex-shrink-0">{p.aantal}</span>
                <span className="flex-1 text-sm font-medium text-gray-800">{t(p.sleutel)}</span>
                <span className="text-gray-400 text-sm">›</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <StatCard label={t('attentie_titel')} value={t('dash_attentie_geen')} cls="mb-6 border-l-4 border-green-400" />
      )}

      {/* ── Vervallen verkoopfacturen ─────────────────────────────────────── */}
      {vervallen.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('attentie_verkoop_vervallen')} info={vervallen.length} onToggle={() => gaNaarBoekhouding('verkoop')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {vervallen.slice(0, MAX_RIJEN).map((f: any) => (
              <div key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer" onClick={() => gaNaarBoekhouding('verkoop')}>
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-gray-800">{klantNaam(f)}</span>
                  {f.factuurnummer && <span className="font-mono text-xs text-gray-400">{f.factuurnummer}</span>}
                  <span className="text-xs text-red-600 font-medium">{t('lbl_factuur_vervallen_dagen').replace('{n}', String(dagenTeLaat(f, klanten, breweryDetails, vandaag)))}</span>
                </div>
                <span className="text-sm font-medium text-gray-700 flex-shrink-0">{fmt(f.bruto || 0)}</span>
              </div>
            ))}
            {meerRegel(vervallen.length, 'verkoop')}
          </div>
        </div>
      )}

      {/* ── Openstaande BTW-periodes ──────────────────────────────────────── */}
      {btwMeestUrgent && (
        <StatCard
          label={t('stat_btw_niet_ingediend')}
          value={periodeKeyLabel(btwMeestUrgent.key)}
          sub={btwOpenAantal > 1 ? t('dash_btw_n_openstaand').replace('{n}', String(btwOpenAantal)) : t('stat_btw_niet_ingediend_sub')}
          cls="mb-6 border-l-4 border-orange-400"
          onClick={() => gaNaarBoekhouding('btw_aangifte')}
        />
      )}

      {/* ── Openstaande accijnsaangiftes ──────────────────────────────────── */}
      {accijnsOpen.length > 0 && (
        <StatCard
          label={t('stat_accijns_niet_ingediend')}
          value={accijnsOpen[0]}
          sub={accijnsOpen.length > 1 ? t('dash_accijns_n_openstaand').replace('{n}', String(accijnsOpen.length)) : t('stat_accijns_niet_ingediend_sub')}
          cls="mb-6 border-l-4 border-orange-400"
          onClick={() => gaNaarBoekhouding('accijns')}
        />
      )}

      {/* ── Openstaande inkoopfacturen ────────────────────────────────────── */}
      {openInkoop.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_openstaande_inkoopfacturen')} info={openInkoop.length} onToggle={() => gaNaarBoekhouding('inkoop')} rounded="top" />
          {achterstalligInkoop > 0 && (
            <div className="px-5 py-2 text-xs text-red-600 font-medium border-b border-gray-100">
              {t('dash_inkoop_achterstallig_sub').replace('{n}', String(achterstalligInkoop)).replace('{dagen}', String(INKOOP_ACHTERSTALLIG_DAGEN))}
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {openInkoop.slice(0, MAX_RIJEN).map((f: any) => {
              const achterstallig = isInkoopFactuurAchterstallig(f, vandaag)
              return (
                <div key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer" onClick={() => gaNaarBoekhouding('inkoop')}>
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-800">{f.leverancier || t('lbl_onbekend')}</span>
                    <span className="text-xs text-gray-400">{fmtD(f.datum)}</span>
                    {f.datum && (
                      <span className={`text-xs font-medium ${achterstallig ? 'text-red-600' : 'text-gray-400'}`}>
                        {t('dash_inkoop_dagen_open').replace('{n}', String(dagenOpen(f, vandaag)))}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-700 flex-shrink-0">{fmt(f.totaal_bruto)}</span>
                </div>
              )
            })}
            {meerRegel(openInkoop.length, 'inkoop')}
          </div>
        </div>
      )}

      {/* ── Serverhealth ──────────────────────────────────────────────────── */}
      {serverHealth && (
        <StatCard
          label={t('dash_serverhealth')}
          value={serverGezond ? t('health_server_ok') : t('health_probleem')}
          sub={serverHealth.laatste_backup
            ? (backupOud ? t('health_backup_oud').replace('{datum}', fmtD(serverHealth.laatste_backup)) : t('health_backup_laatste').replace('{datum}', fmtD(serverHealth.laatste_backup)))
            : t('health_backup_geen')}
          cls={serverGezond ? 'mb-6' : 'mb-6 border-l-4 border-orange-400'}
        />
      )}
    </div>
  )
}

export default AdministratieDashboard
