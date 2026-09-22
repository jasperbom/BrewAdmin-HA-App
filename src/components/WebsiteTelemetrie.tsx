import React, { useCallback, useEffect, useState } from 'react'
import { t, getLang } from '../i18n'
import Btn from './ui/Btn'
import { websiteStatus, websiteTest, websiteVerstuur, websiteVoorbeeld } from '../utils/api'
import {
  WEBSITE_INTERVAL_MAX, WEBSITE_INTERVAL_MIN, WEBSITE_ONDERDELEN, WebsiteAntwoord, WebsiteFout,
  WebsiteOnderdeel, WebsiteTelemetrieInst, WebsiteTelemetrieStatus, normaliseerWebsiteInst,
  websiteFoutSleutel, websiteIetsAan, websiteTeKortHoudbaar,
} from '../utils/websiteTelemetrie'

// Website-telemetrie (Instellingen → Koppelingen). De server verstuurt elk
// interval zelf (`_website_tick`); dit blok zet het aan, kiest de onderdelen
// en laat zien wat er heen gaat en wat er op de site staat. Het voorbeeld
// komt van de server, zodat het dezelfde code is als de echte verzending.

interface WebsiteTelemetrieProps {
  inst: WebsiteTelemetrieInst | undefined
  setInst: (v: WebsiteTelemetrieInst) => void
  /** Staan de WooCommerce-gegevens er (https-adres, sleutel, geheim, aan)? */
  wcIngesteld: boolean
  fmtTs: (ts: any) => string
}

// Waarden die als `{brouwerij:<naam>}` in Elementor bruikbaar zijn.
const PLAATSHOUDER: Partial<Record<WebsiteOnderdeel, string>> = {
  hop_kg: 'hop_kg', mout_kg: 'mout_kg', liters_tank: 'liters_tank',
  liters_verpakt: 'liters_verpakt', batches_gebrouwen: 'batches_gebrouwen',
}

// Netwerkoorzaken van de proxy hebben al een melding (utils/wcFout.ts).
const NETWERK_OORZAKEN = ['timeout', 'certificaat', 'tls', 'dns', 'verbinding', 'netwerk']

const foutTekst = (fout: WebsiteFout | null | undefined): string => {
  if (fout?.code === 'netwerk' && fout.oorzaak && NETWERK_OORZAKEN.includes(fout.oorzaak)) {
    return t(`wc_fout_${fout.oorzaak}`).replace('{n}', String(fout.timeout ?? ''))
  }
  const basis = t(websiteFoutSleutel(fout))
  if (fout?.code === 'http' && fout.http) return `${basis} (HTTP ${fout.http})`
  return basis
}

export default function WebsiteTelemetrie({ inst: ruw, setInst, wcIngesteld, fmtTs }: WebsiteTelemetrieProps) {
  const inst = normaliseerWebsiteInst(ruw)
  const [interval, setIntervalTekst] = useState<string>(String(inst.interval_min))
  const [status, setStatus] = useState<WebsiteTelemetrieStatus>({})
  const [voorbeeld, setVoorbeeld] = useState<{bericht: any, bytes: number, max_bytes: number} | null>(null)
  const [voorbeeldOpen, setVoorbeeldOpen] = useState(false)
  const [test, setTest] = useState<{ok: boolean, antwoord?: WebsiteAntwoord, fout?: WebsiteFout} | null>(null)
  const [bezig, setBezig] = useState<'' | 'test' | 'verstuur'>('')
  const [verstuurFout, setVerstuurFout] = useState<WebsiteFout | null>(null)

  useEffect(() => { setIntervalTekst(String(inst.interval_min)) }, [inst.interval_min])

  const laadStatus = useCallback(() => { websiteStatus().then(setStatus) }, [])
  useEffect(() => {
    laadStatus()
    const id = window.setInterval(laadStatus, 60_000)
    return () => window.clearInterval(id)
  }, [laadStatus])

  // Het voorbeeld volgt de schakelaars zolang het open staat.
  const sleutel = JSON.stringify(inst)
  useEffect(() => {
    if (!voorbeeldOpen) return
    let actueel = true
    websiteVoorbeeld(inst).then((d: any) => { if (actueel && d && 'bericht' in d) setVoorbeeld(d) })
    return () => { actueel = false }
  }, [voorbeeldOpen, sleutel])

  const zet = (patch: Partial<WebsiteTelemetrieInst>) => setInst({ ...inst, ...patch })
  const zetOnderdeel = (k: WebsiteOnderdeel, aan: boolean) =>
    zet({ onderdelen: { ...inst.onderdelen, [k]: aan } })
  const bewaarInterval = () => {
    const n = Math.trunc(Number(interval))
    const geldig = Number.isFinite(n) ? Math.max(WEBSITE_INTERVAL_MIN, Math.min(WEBSITE_INTERVAL_MAX, n)) : inst.interval_min
    setIntervalTekst(String(geldig))
    if (geldig !== inst.interval_min) zet({ interval_min: geldig })
  }

  const doeTest = async () => {
    setBezig('test'); setTest(null)
    setTest(await websiteTest())
    setBezig('')
  }
  const doeVerstuur = async () => {
    setBezig('verstuur'); setVerstuurFout(null)
    const d = await websiteVerstuur(inst)
    if (!d?.ok) setVerstuurFout(d?.fout || { code: 'onbekend' })
    laadStatus()
    setBezig('')
  }

  const antwoord: WebsiteAntwoord | undefined = status.antwoord || test?.antwoord
  const teKort = inst.enabled && websiteTeKortHoudbaar(antwoord?.max_leeftijd, inst.interval_min)
  const kanVersturen = wcIngesteld && inst.enabled && websiteIetsAan(inst)
  // Wat er nu in de strip staat: de regels van het laatste geslaagde bericht,
  // zolang de site het nog toont (daarna verdwijnt de strip vanzelf).
  const geslaagd = status.laatst_gelukt ? Date.parse(status.laatst_gelukt) : NaN
  const houdbaarS = Number(status.antwoord?.max_leeftijd)
  const verlopen = Number.isFinite(geslaagd) && houdbaarS > 0 && Date.now() - geslaagd > houdbaarS * 1000
  const regelsOpSite: string[] | null = status.laatst_gelukt
    ? (verlopen ? [] : (status.antwoord?.regels || []))
    : null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('website_titel')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('website_uitleg')}</p>
      {!wcIngesteld && (
        <p className="text-sm px-3 py-2 rounded bg-orange-50 border border-orange-200 text-orange-800 mb-4">{t('website_geen_wc')}</p>
      )}

      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <div className="relative">
            <input type="checkbox" checked={inst.enabled} onChange={e => zet({ enabled: e.target.checked })} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('website_aan')}</span>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('website_interval')}</label>
          <input type="number" min={WEBSITE_INTERVAL_MIN} max={WEBSITE_INTERVAL_MAX} step={5} value={interval}
            onChange={e => setIntervalTekst(e.target.value)} onBlur={bewaarInterval}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32 t-input min-h-tap sm:min-h-0" />
          <p className="text-xs text-gray-400 mt-1">{t('website_interval_hint')}</p>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('website_onderdelen')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('website_onderdelen_hint')}</p>
          <div className="flex flex-col gap-2">
            {WEBSITE_ONDERDELEN.map(k => (
              <label key={k} className="flex items-start gap-2 cursor-pointer bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 min-h-tap sm:min-h-0 hover:bg-gray-100 transition-colors">
                <input type="checkbox" checked={inst.onderdelen[k] === true}
                  onChange={e => zetOnderdeel(k, e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300 t-checkbox flex-shrink-0" />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-gray-700">{t(`website_ond_${k}`)}</span>
                  {PLAATSHOUDER[k] && <code className="text-[11px] text-gray-400 break-all">{`{brouwerij:${PLAATSHOUDER[k]}}`}</code>}
                </span>
              </label>
            ))}
          </div>
        </div>

        {teKort && (
          <p className="text-sm px-3 py-2 rounded bg-orange-50 border border-orange-200 text-orange-800">
            {t('website_houdbaar_waarschuwing').replace('{uur}',
              new Intl.NumberFormat(getLang(), {maximumFractionDigits: 1}).format(Number(antwoord?.max_leeftijd) / 3600))}
          </p>
        )}

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
                <div>✓ {t('website_test_ok').replace('{versie}', test.antwoord?.versie || '?')}</div>
                <div className="text-xs mt-0.5">
                  {test.antwoord?.ontvangen
                    ? <>{t('website_test_ontvangen').replace('{tijd}', fmtTs(test.antwoord.ontvangen))} · {test.antwoord.vers ? t('website_vers') : t('website_niet_vers')}</>
                    : t('website_test_geen_bericht')}
                </div>
              </>
            ) : foutTekst(test.fout)}
          </div>
        )}

        {voorbeeldOpen && voorbeeld && (
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-700">{t('website_voorbeeld_titel')}</h3>
              <span className="text-xs text-gray-400">
                {t('website_voorbeeld_bytes').replace('{n}', String(voorbeeld.bytes)).replace('{max}', String(voorbeeld.max_bytes))}
              </span>
            </div>
            {Object.keys(voorbeeld.bericht || {}).length === 0
              ? <p className="text-sm text-gray-500">{t('website_voorbeeld_leeg')}</p>
              : <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto max-h-80">{JSON.stringify(voorbeeld.bericht, null, 2)}</pre>}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 text-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('website_laatste')}</h3>
          {!status.laatste_poging
            ? <p className="text-gray-500">{t('website_nooit')}</p>
            : (
              <p className={status.gelukt ? 'text-gray-700' : 'text-red-600'}>
                {fmtTs(status.laatste_poging)} · {status.gelukt ? t('website_gelukt') : t('website_mislukt')}
                {status.leeg && status.gelukt ? ` · ${t('website_leeg_verstuurd')}` : ''}
                {status.handmatig ? ` · ${t('website_handmatig')}` : ''}
                {!status.gelukt && status.fout ? ` — ${foutTekst(status.fout)}` : ''}
              </p>
            )}
          {regelsOpSite && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('website_op_site_titel')}</h3>
              {regelsOpSite.length === 0
                ? <p className="text-gray-500">{t('website_op_site_leeg')}</p>
                : <ul className="font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3 space-y-1">
                    {regelsOpSite.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>}
              {(status.antwoord?.plaatshouders || []).length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  {t('website_plaatshouders')}: {(status.antwoord?.plaatshouders || []).map(p => `{brouwerij:${p}}`).join(' ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
