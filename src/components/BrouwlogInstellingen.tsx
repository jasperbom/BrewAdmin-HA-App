import React, { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import { brouwlogStatus, brouwlogTest, brouwlogVerstuur, brouwlogVoorbeeld } from '../utils/api'
import {
  BrouwlogAntwoord, BrouwlogFout, BrouwlogInst, BrouwlogStatusStand, brouwlogAangevinkt, brouwlogFoutSleutel,
  brouwlogRedenSleutel, normaliseerBrouwlogInst,
} from '../utils/brouwlog'

// De brouwlog (Instellingen → WooCommerce koppeling, onder de telemetrie). De
// server verstuurt zelf (`_brouwlog_tick`): elke 15 minuten als er iets
// veranderd is, en eens per dag. Welke batches meegaan, vink je per batch aan
// op de batchpagina; hier zet je het aan en zie je wat er heen gaat en wat er
// op de site staat. Het voorbeeld komt van de server — dezelfde code als de
// echte verzending.

interface BrouwlogInstellingenProps {
  inst: BrouwlogInst | undefined
  setInst: (v: BrouwlogInst) => void
  /** Staan de WooCommerce-gegevens er (https-adres, sleutel, geheim, aan)? */
  wcIngesteld: boolean
  /** Alle batches: hoeveel er aangevinkt zijn, en de naam bij een overgeslagen batch. */
  batches: any[]
  fmtTs: (ts: any) => string
}

interface Voorbeeld {
  bericht: { bron?: string; alles?: boolean; batches?: any[] }
  bytes: number
  max_bytes: number
  aantal: number
  max_batches: number
  overgeslagen: Array<{ batch_id?: number; nummer?: string; reden?: string }>
  enabled: boolean
}

// Netwerkoorzaken van de proxy hebben al een melding (utils/wcFout.ts).
const NETWERK_OORZAKEN = ['timeout', 'certificaat', 'tls', 'dns', 'verbinding', 'netwerk']

const foutTekst = (fout: BrouwlogFout | null | undefined): string => {
  if (fout?.code === 'netwerk' && fout.oorzaak && NETWERK_OORZAKEN.includes(fout.oorzaak)) {
    return t(`wc_fout_${fout.oorzaak}`).replace('{n}', String(fout.timeout ?? ''))
  }
  const basis = t(brouwlogFoutSleutel(fout))
  if (fout?.code === 'http' && fout.http) return `${basis} (HTTP ${fout.http})`
  return basis
}

const PaginaLink: React.FC<{ url?: string | null }> = ({ url }) => url
  ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">{t('brouwlog_pagina')}</a>
  : null

export default function BrouwlogInstellingen({ inst: ruw, setInst, wcIngesteld, batches, fmtTs }: BrouwlogInstellingenProps) {
  const inst = normaliseerBrouwlogInst(ruw)
  const [status, setStatus] = useState<BrouwlogStatusStand>({})
  const [voorbeeld, setVoorbeeld] = useState<Voorbeeld | null>(null)
  const [voorbeeldOpen, setVoorbeeldOpen] = useState(false)
  const [test, setTest] = useState<{ ok: boolean, antwoord?: BrouwlogAntwoord, fout?: BrouwlogFout } | null>(null)
  const [bezig, setBezig] = useState<'' | 'test' | 'verstuur'>('')
  const [verstuurFout, setVerstuurFout] = useState<BrouwlogFout | null>(null)

  const laadStatus = useCallback(() => { brouwlogStatus().then(setStatus) }, [])
  useEffect(() => {
    laadStatus()
    const id = window.setInterval(laadStatus, 60_000)
    return () => window.clearInterval(id)
  }, [laadStatus])

  // Het voorbeeld volgt de schakelaar en de vinkjes zolang het open staat.
  const aangevinkt = (batches || []).filter(brouwlogAangevinkt)
  const sleutel = JSON.stringify(inst) + aangevinkt.map(b => `${b.id}:${b.status}:${b.brouwlog_notitie || ''}`).join('|')
  useEffect(() => {
    if (!voorbeeldOpen) return
    let actueel = true
    brouwlogVoorbeeld(inst).then((d: any) => { if (actueel && d && 'bericht' in d) setVoorbeeld(d) })
    return () => { actueel = false }
  }, [voorbeeldOpen, sleutel])

  const naamVan = (o: { batch_id?: number; nummer?: string }): string => {
    const b = (batches || []).find(x => x?.id === o.batch_id)
    const nr = o.nummer ? (String(o.nummer).startsWith('#') ? o.nummer : `#${o.nummer}`) : ''
    return [nr, b?.naam || ''].filter(Boolean).join(' ') || t('lbl_onbekend')
  }

  const doeTest = async () => {
    setBezig('test'); setTest(null)
    setTest(await brouwlogTest())
    setBezig('')
  }
  const doeVerstuur = async () => {
    setBezig('verstuur'); setVerstuurFout(null)
    const d = await brouwlogVerstuur(inst)
    if (!d?.ok) setVerstuurFout(d?.fout || { code: 'onbekend' })
    laadStatus()
    setBezig('')
  }

  const kanVersturen = wcIngesteld && inst.enabled
  const antwoord = status.antwoord
  const opSite = antwoord?.batches || []

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('brouwlog_titel')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('brouwlog_uitleg')}</p>
      {!wcIngesteld && (
        <p className="text-sm px-3 py-2 rounded bg-orange-50 border border-orange-200 text-orange-800 mb-4">{t('website_geen_wc')}</p>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div className="relative">
              <input type="checkbox" checked={inst.enabled} onChange={e => setInst({ ...inst, enabled: e.target.checked })} className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </div>
            <span className="text-sm font-medium text-gray-700">{t('brouwlog_aan')}</span>
          </label>
          <p className="text-xs text-gray-400 mt-1">{t('brouwlog_aan_hint')}</p>
        </div>

        <p className="text-sm text-gray-700">
          {aangevinkt.length === 0 ? t('brouwlog_geen_aangevinkt')
            : aangevinkt.length === 1 ? t('brouwlog_aangevinkt_een')
            : t('brouwlog_aangevinkt').replace('{n}', String(aangevinkt.length))}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={doeVerstuur} disabled={!kanVersturen || bezig !== ''}
            className="wc-btn px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40 min-h-tap sm:min-h-0">
            {bezig === 'verstuur' ? t('website_versturen') : t('website_verstuur')}
          </button>
          <button onClick={doeTest} disabled={!wcIngesteld || bezig !== ''}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-40 min-h-tap sm:min-h-0">
            {bezig === 'test' ? t('website_testen') : t('website_test')}
          </button>
          <Btn v="secondary" onClick={() => setVoorbeeldOpen(o => !o)}>
            {voorbeeldOpen ? t('website_voorbeeld_verberg') : t('website_voorbeeld')}
          </Btn>
        </div>
        {verstuurFout && <p className="text-sm text-red-600">{foutTekst(verstuurFout)}</p>}

        {test && (
          <div className={`text-sm rounded px-3 py-2 border ${test.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {test.ok ? (
              <>
                <div>✓ {(test.antwoord?.aantal === 1 ? t('brouwlog_test_ok_een') : t('brouwlog_test_ok'))
                  .replace('{versie}', test.antwoord?.versie || '?').replace('{n}', String(test.antwoord?.aantal ?? 0))}</div>
                <div className="text-xs mt-0.5">
                  {test.antwoord?.ontvangen
                    ? t('website_test_ontvangen').replace('{tijd}', fmtTs(test.antwoord.ontvangen))
                    : t('website_test_geen_bericht')}
                </div>
                <div className="text-xs mt-0.5">
                  {test.antwoord?.pagina ? <PaginaLink url={test.antwoord.pagina} /> : t('brouwlog_geen_pagina')}
                </div>
              </>
            ) : foutTekst(test.fout)}
          </div>
        )}

        {voorbeeldOpen && voorbeeld && (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-700">{t('website_voorbeeld_titel')}</h3>
              <span className="text-xs text-gray-400">
                {t('brouwlog_voorbeeld_aantal').replace('{n}', String(voorbeeld.aantal)).replace('{max}', String(voorbeeld.max_batches))}
                {' · '}
                {t('website_voorbeeld_bytes').replace('{n}', String(voorbeeld.bytes)).replace('{max}', String(voorbeeld.max_bytes))}
              </span>
            </div>
            {!voorbeeld.enabled && <p className="text-xs text-gray-500 mb-1">{t('brouwlog_voorbeeld_uit')}</p>}
            {voorbeeld.aantal === 0 && <p className="text-xs text-gray-500 mb-1">{t('brouwlog_voorbeeld_leeg')}</p>}
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto max-h-80 whitespace-pre">{JSON.stringify(voorbeeld.bericht, null, 2)}</pre>
            {voorbeeld.overgeslagen.length > 0 && (
              <div className="mt-2">
                <h4 className="text-xs font-semibold text-gray-700 mb-1">{t('brouwlog_niet_mee_titel')}</h4>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {voorbeeld.overgeslagen.map((o, i) => (
                    <li key={i}>{naamVan(o)} — {t(brouwlogRedenSleutel(o.reden))}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 text-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('website_laatste')}</h3>
          {!status.laatste_poging
            ? <p className="text-gray-500">{t('website_nooit')}</p>
            : (
              <p className={status.gelukt ? 'text-gray-700' : 'text-red-600'}>
                {fmtTs(status.laatste_poging)} · {status.gelukt ? t('website_gelukt') : t('website_mislukt')}
                {status.leeg && status.gelukt ? ` · ${t('brouwlog_leeg_verstuurd')}` : ''}
                {status.handmatig ? ` · ${t('website_handmatig')}` : ''}
                {!status.gelukt && status.fout ? ` — ${foutTekst(status.fout)}` : ''}
              </p>
            )}
          {status.laatst_gelukt && antwoord && (
            <div className="mt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-700">{t('website_op_site_titel')}</h3>
                <span className="text-xs"><PaginaLink url={antwoord.pagina} /></span>
              </div>
              {opSite.length === 0
                ? <p className="text-gray-500">{t('brouwlog_op_site_leeg')}</p>
                : (
                  <>
                    <p className="text-xs text-gray-500 mb-1">
                      {(antwoord.aantal ?? opSite.length) === 1 ? t('brouwlog_op_site_een')
                        : t('brouwlog_op_site').replace('{n}', String(antwoord.aantal ?? opSite.length))}
                    </p>
                    <ul className="font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3 space-y-1">
                      {opSite.map(b => (
                        <li key={b.nummer}>#{b.nummer} {b.bier}{b.status ? ` · ${t(`brouwlog_status_${b.status}`, b.status)}` : ''}</li>
                      ))}
                    </ul>
                  </>
                )}
              {(antwoord.overgeslagen || []).length > 0 && (
                <div className="mt-2">
                  <h4 className="text-xs font-semibold text-gray-700 mb-1">{t('brouwlog_site_sloeg_over')}</h4>
                  <ul className="text-xs text-gray-600 space-y-0.5">
                    {(antwoord.overgeslagen || []).map((o, i) => (
                      <li key={i}>{o.nummer ? `#${o.nummer}` : t('lbl_onbekend')} — {t(brouwlogRedenSleutel(o.reden))}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(antwoord.weggevallen || []).length > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  {t('brouwlog_weggevallen').replace('{nummers}', (antwoord.weggevallen || []).map(n => `#${n}`).join(', '))}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
