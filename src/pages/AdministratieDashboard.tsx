import React, { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtD, tod } from '../utils/format'
import { laatsteOpenstaandeBtwPeriode, telOpenstaandeBtwPerioden, periodeKeyLabel } from '../utils/btw'
import { laatsteOpenAccijnsMaand } from '../utils/calculations'
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
  setPage: (id: string) => void
  setBoekhoudingTab: (tab: string | null) => void
}

function AdministratieDashboard({
  btwInst = {}, btwAangiftes = [], bankKoppelingen = {}, accijnsAangiftes = [], acc = [],
  inkoopFacturen = [], verkoopFacturen = [], setPage, setBoekhoudingTab,
}: AdministratieDashboardProps) {
  const gaNaarBoekhouding = (tab: string) => { setBoekhoudingTab(tab); setPage('boekhouding') }

  // ── Openstaande BTW-periodes ───────────────────────────────────────────────
  // Alleen periodes met daadwerkelijk gefactureerde omzet/inkoop tellen mee —
  // anders zou een jonge onderneming kwartalen van vóór de oprichting als
  // openstaand te zien krijgen (zie telOpenstaandeBtwPerioden in utils/btw.ts).
  const vandaag = tod()
  const huidigJaar = new Date().getFullYear()
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

  // ── Accijns-deadline ────────────────────────────────────────────────────────
  const accijnsOpen = useMemo(() => laatsteOpenAccijnsMaand(accijnsAangiftes, acc), [accijnsAangiftes, acc])

  // ── Openstaande inkoopfacturen ──────────────────────────────────────────────
  // "Concept-inkoopfacturen" bestaat niet als apart statusveld (alleen
  // open/betaald) — open/onbetaalde facturen zijn hier de dichtstbijzijnde,
  // eerlijke proxy: facturen die nog verdere actie (betaling/verwerking) nodig hebben.
  const openFacturen = useMemo(
    () => (inkoopFacturen || []).filter((f: any) => f?.status !== 'betaald').sort((a: any, b: any) => String(a?.datum || '').localeCompare(String(b?.datum || ''))),
    [inkoopFacturen]
  )

  // ── Serverhealth ────────────────────────────────────────────────────────────
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null)
  useEffect(() => { getServerHealth().then(setServerHealth) }, [])
  const vandaagDate = new Date(); vandaagDate.setHours(0, 0, 0, 0)
  const backupOud = serverHealth?.laatste_backup ? (vandaagDate.getTime() - new Date(serverHealth.laatste_backup).getTime()) / 86400000 > 2 : false
  const serverGezond = !!serverHealth?.ok && !backupOud

  return (
    <div>
      {/* ── Primaire acties ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Btn s="lg" onClick={() => gaNaarBoekhouding('inkoop')}>{t('dash_nieuwe_inkoopfactuur')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => gaNaarBoekhouding('btw_aangifte')}>{t('tab_btw_aangifte')}</Btn>
        <Btn s="lg" v="secondary" onClick={() => gaNaarBoekhouding('bank')}>{t('dash_bank_importeren')}</Btn>
      </div>

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

      {/* ── Accijns-deadline ──────────────────────────────────────────────── */}
      {accijnsOpen && (
        <StatCard
          label={t('stat_accijns_niet_ingediend')}
          value={accijnsOpen.maand}
          sub={t('stat_accijns_niet_ingediend_sub')}
          cls="mb-6 border-l-4 border-orange-400"
          onClick={() => gaNaarBoekhouding('accijns')}
        />
      )}

      {/* ── Openstaande inkoopfacturen ────────────────────────────────────── */}
      {openFacturen.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <SectionHeader title={t('dash_openstaande_inkoopfacturen')} info={openFacturen.length} onToggle={() => gaNaarBoekhouding('inkoop')} rounded="top" />
          <div className="divide-y divide-gray-100">
            {openFacturen.slice(0, 5).map((f: any) => (
              <div key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[44px] hover:bg-gray-50 cursor-pointer" onClick={() => gaNaarBoekhouding('inkoop')}>
                <div className="min-w-0">
                  <span className="font-medium text-sm text-gray-800">{f.leverancier || t('lbl_onbekend')}</span>
                  <span className="text-xs text-gray-400 ml-2">{fmtD(f.datum)}</span>
                </div>
                <span className="text-sm font-medium text-gray-700 flex-shrink-0">{fmt(f.totaal_bruto)}</span>
              </div>
            ))}
            {openFacturen.length > 5 && (
              <div className="px-5 py-2 text-xs text-gray-400 cursor-pointer hover:bg-gray-50" onClick={() => gaNaarBoekhouding('inkoop')}>
                {t('msg_n_meer').replace('{n}', String(openFacturen.length - 5))}
              </div>
            )}
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
