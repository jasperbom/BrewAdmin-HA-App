import React, { useEffect, useState } from 'react'
import { t } from '../i18n'
import Icon, { IconNaam } from '../components/ui/Icon'
import { uitloggen, _allKeys, _fetchedKeys, _serverReachable, _syncErrors, _syncPending } from '../utils/api'

interface MeerPageProps {
  whoami: { gebruiker: string; rol: string; sessie?: boolean } | null
  appName: string
  onInstellingen: () => void
}

interface MeerRij {
  id: string
  icoon: IconNaam
  label: string
  sub?: string
  onClick?: () => void
  gevaar?: boolean
}

const Groep: React.FC<{ titel: string; rijen: MeerRij[] }> = ({ titel, rijen }) => (
  <section>
    <h2 className="text-sm font-semibold text-gray-800 px-1 mb-2">{titel}</h2>
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
      {rijen.map(r => {
        const inhoud = (
          <>
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${r.gevaar ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}><Icon n={r.icoon} /></span>
            <span className="flex-1 min-w-0">
              <span className={`block text-sm font-medium truncate ${r.gevaar ? 'text-red-700' : 'text-gray-900'}`}>{r.label}</span>
              {r.sub && <span className="block text-xs text-gray-500 truncate">{r.sub}</span>}
            </span>
            {r.onClick && !r.gevaar && <Icon n="chevronRight" cls="text-gray-400 flex-shrink-0" />}
          </>
        )
        return r.onClick ? (
          <button key={r.id} type="button" onClick={r.onClick}
            className="w-full flex items-center gap-3 px-3 min-h-[56px] text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)]">
            {inhoud}
          </button>
        ) : (
          <div key={r.id} className="flex items-center gap-3 px-3 min-h-[56px]">{inhoud}</div>
        )
      })}
    </div>
  </section>
)

/**
 * "Meer" — de plek op een telefoon voor alles wat niet in de onderbalk past:
 * wie je bent, de verbinding, Instellingen en (op de directe poort)
 * Uitloggen. Drie groepen, Uitloggen rood als laatste rij.
 */
const MeerPage: React.FC<MeerPageProps> = ({ whoami, appName, onInstellingen }) => {
  const [verbinding, setVerbinding] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const allesGeladen = _allKeys.size > 0 && _fetchedKeys.size >= _allKeys.size
      if (_serverReachable === false && (_syncErrors > 0 || !allesGeladen)) setVerbinding(t('msg_connection_failed'))
      else if (!allesGeladen) setVerbinding(t('msg_connecting'))
      else if (_syncPending > 0) setVerbinding(t('msg_saving'))
      else setVerbinding(t('msg_synced'))
    }, 600)
    return () => clearInterval(id)
  }, [])

  const account: MeerRij[] = [
    {
      id: 'wie', icoon: 'user',
      label: whoami?.gebruiker ? t('meer_ingelogd_als').replace('{naam}', whoami.gebruiker) : (appName || t('app_title')),
      sub: whoami?.rol ? t(`rol_${whoami.rol}`, whoami.rol) : undefined,
    },
    { id: 'verbinding', icoon: 'refresh', label: t('meer_verbinding'), sub: verbinding },
  ]
  const app: MeerRij[] = [
    { id: 'instellingen', icoon: 'gear', label: t('nav_instellingen'), onClick: onInstellingen },
  ]
  const afsluiten: MeerRij[] = whoami?.sessie ? [
    { id: 'uitloggen', icoon: 'logout', label: t('btn_uitloggen'), gevaar: true, onClick: async () => { await uitloggen(); window.location.reload() } },
  ] : []

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Groep titel={t('meer_account')} rijen={account} />
      <Groep titel={t('meer_app')} rijen={app} />
      {afsluiten.length > 0 && <Groep titel="" rijen={afsluiten} />}
      <p className="text-center text-xs text-gray-400">{t('meer_versie').replace('{v}', typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev')}</p>
    </div>
  )
}

export default MeerPage
