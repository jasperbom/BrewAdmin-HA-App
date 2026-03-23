import React, { useState, useEffect } from 'react'
import { t } from '../../i18n'
import { _allKeys, _fetchedKeys, _syncPending, _syncErrors, _serverReachable } from '../../utils/api'

const SyncDot: React.FC = () => {
  const [s, setS] = useState('loading')

  useEffect(() => {
    const id = setInterval(() => {
      const allLoaded = _allKeys.size > 0 && _fetchedKeys.size >= _allKeys.size
      if (_serverReachable === false && allLoaded && _syncErrors > 0) { setS('error'); return }
      if (!allLoaded)           { setS('loading'); return }
      if (_syncPending > 0)     { setS('pending'); return }
      if (_syncErrors > 0)      { setS('error'); return }
      if (_serverReachable)     { setS('ok'); return }
      setS('loading')
    }, 600)
    return () => clearInterval(id)
  }, [])

  const cfg: Record<string, {cls:string, title:string}> = {
    loading: { cls: 'bg-gray-400 animate-pulse',  title: t('msg_connecting') },
    pending: { cls: 'bg-yellow-400 animate-pulse', title: t('msg_saving') },
    ok:      { cls: 'bg-green-400',                title: t('msg_synced') },
    error:   { cls: 'bg-red-500',                  title: t('msg_connection_failed') },
  }
  const c = cfg[s] || { cls: 'bg-gray-400', title: '' }

  return (
    <span
      title={c.title}
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-help ${c.cls}`}
    />
  )
}

export default SyncDot
