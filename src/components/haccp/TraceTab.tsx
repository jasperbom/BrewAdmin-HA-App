import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { maakParaaf } from '../../utils/haccp'
import {
  traceZoek, oefeningStatus, beoordeelOefening, oefeningVanResultaat,
  capaUitOefening, geldigeOefeningen, oefeningenNieuwsteEerst, lotLabel, gatI18nKey,
} from '../../utils/trace'
import type { TraceResultaat, TraceGat } from '../../utils/trace'
import type { TraceRichting } from '../../types'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import Modal from '../ui/Modal'
import SectionHeader from '../ui/SectionHeader'
import SearchInput from '../ui/SearchInput'

// Traceerbaarheid & recall (HACCP-handboek hoofdstuk 11).
//
// Het scherm beantwoordt de drie vragen die bij een terugroepactie tellen:
// welke lotcodes moeten eruit, wie heeft ze, en is dat compleet. De laatste is
// de reden dat de massabalans en de traceergaten hier net zo prominent staan
// als de zoekresultaten zelf — een lijst zonder verantwoording suggereert een
// volledigheid die er niet hoeft te zijn.

const paramTekst = (
  reden: {i18nKey: string; params?: Record<string, string | number>}
): string => {
  let s = t(reden.i18nKey)
  for (const [k, v] of Object.entries(reden.params || {})) {
    s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

const gatTekst = (gat: TraceGat): string =>
  t(gat.i18nKey).split('{n}').join(String(gat.aantal))

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TraceTab: React.FC<any> = (p) => {
  const {useState, useMemo} = React
  const {lots, ing, bat, bi, av, uit, sessies, afboekingen, klanten,
    bestellingen, bestellingPicks,
    capa, setCapa, traceOefeningen, setTraceOefeningen, haccpInst, whoami,
    auditLog, setAuditLog} = p

  const [mode, setMode] = useState<TraceRichting>('vooruit')
  const [q, setQ] = useState('')
  const [res, setRes] = useState<TraceResultaat | null>(null)
  // Startmoment van de eerste zoekactie: de doorlooptijd van de oefening is
  // zelf een norm uit het handboek en moet niet uit het hoofd komen.
  const [gestart, setGestart] = useState<number | null>(null)
  const [oef, setOef] = useState<any>(null)

  const data = useMemo(() => ({
    lots, ingredienten: ing, batches: bat, batchIngredienten: bi,
    afvullingen: av, sessies, uitleveringen: uit, afboekingen, klanten,
    bestellingen, bestellingPicks,
  }), [lots, ing, bat, bi, av, uit, sessies, afboekingen, klanten,
    bestellingen, bestellingPicks])

  const status = useMemo(
    () => oefeningStatus(traceOefeningen || [], haccpInst),
    [traceOefeningen, haccpInst])
  const eerdere = useMemo(
    () => oefeningenNieuwsteEerst(geldigeOefeningen(traceOefeningen || [])),
    [traceOefeningen])

  const doSearch = () => {
    if (!q.trim()) return
    if (gestart == null) setGestart(Date.now())
    setRes(traceZoek(mode, q, data))
  }

  const wisselMode = (m: TraceRichting) => { setMode(m); setRes(null); setQ('') }

  // ── Recallrapport ──
  const printRecall = () => {
    if (!res?.gevonden) return
    const w = window.open('', '_blank')
    if (!w) return
    const b = res.balans
    const rij = (l: string, v: string | number) =>
      `<tr><td>${esc(l)}</td><td class="r">${esc(v)}</td></tr>`
    const html = `<html><head><title>${esc(t('haccp_trace_mock_recall_titel'))}</title><style>
      body{font-family:sans-serif;padding:20px;color:#111}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}
      th{background:#f5f5f5}td.r{text-align:right}
      h1{font-size:18px;margin-bottom:2px}h2{font-size:14px;margin-top:16px}
      .codes{font-family:monospace;font-size:16px;font-weight:bold}
      .gat{color:#b45309}
    </style></head><body>
    <h1>${esc(t('haccp_trace_mock_recall_titel'))}</h1>
    <p>${esc(new Date().toLocaleString())} — ${esc(t(mode === 'vooruit'
      ? 'haccp_trace_richting_vooruit' : 'haccp_trace_richting_terug'))}:
      ${esc(res.zoekterm)}</p>

    <h2>${esc(t('haccp_trace_lotcodes'))}</h2>
    ${res.lotcodes.length
      ? `<p class="codes">${res.lotcodes.map(esc).join(' &nbsp; ')}</p>`
      : `<p class="gat">${esc(t('haccp_trace_geen_lotcodes'))}</p>`}

    <h2>${esc(t('haccp_trace_balans'))}</h2>
    <table>
      ${rij(t('haccp_trace_balans_geproduceerd'), b.geproduceerd)}
      ${rij(t('haccp_trace_balans_traceerbaar'), b.uitgeleverd_traceerbaar)}
      ${rij(t('haccp_trace_balans_anoniem'), b.uitgeleverd_anoniem)}
      ${rij(t('haccp_trace_balans_intern'), b.intern)}
      ${rij(t('haccp_trace_balans_afgeboekt'), b.afgeboekt)}
      ${rij(t('haccp_trace_balans_voorraad'), b.voorraad)}
      ${b.tekort ? rij(t('haccp_trace_balans_tekort'), b.tekort) : ''}
      ${b.geblokkeerd ? rij(t('haccp_trace_balans_geblokkeerd'), b.geblokkeerd) : ''}
      ${rij(t('haccp_trace_balans_verantwoord'), `${b.verantwoord} (${b.verantwoord_pct}%)`)}
    </table>

    ${res.gaten.length ? `<h2>${esc(t('haccp_trace_gaten'))}</h2>
      <ul>${res.gaten.map(g => `<li class="gat">${esc(gatTekst(g))}</li>`).join('')}</ul>` : ''}

    ${res.afnemers.length ? `<h2>${esc(t('haccp_trace_afnemers'))}</h2>
      <table><tr><th>${esc(t('lbl_naam'))}</th><th>${esc(t('lbl_email'))} / ${esc(t('lbl_telefoon'))}</th>
      <th>${esc(t('haccp_trace_lotcodes'))}</th><th>${esc(t('haccp_trace_uitgeleverd'))}</th></tr>
      ${res.afnemers.map(a => `<tr><td>${esc(a.naam)}<br><span style="color:#666">${esc(a.adres || '')}</span></td>
        <td>${esc([a.email, a.telefoon].filter(Boolean).join(' · ') || t('haccp_trace_geen_contact'))}</td>
        <td>${esc(a.lotcodes.join(', '))}</td><td class="r">${esc(a.aantal)}</td></tr>`).join('')}
      </table>` : `<h2>${esc(t('haccp_trace_afnemers'))}</h2><p>${esc(t('haccp_trace_geen_afnemers'))}</p>`}

    ${res.batches.length ? `<h2>${esc(t('haccp_trace_batches'))}</h2>
      <table><tr><th>${esc(t('haccp_trace_batch'))}</th><th>${esc(t('lbl_status'))}</th>
      <th>${esc(t('lbl_datum'))}</th></tr>
      ${res.batches.map((x: any) => `<tr><td>${esc(x.naam)}</td><td>${esc(x.status)}</td>
        <td>${esc(x.datum || '')}</td></tr>`).join('')}</table>` : ''}

    ${res.lots.length ? `<h2>${esc(t('haccp_trace_lots'))}</h2>
      <table><tr><th>${esc(t('haccp_trace_lotnr'))}</th><th>${esc(t('nav_ingredienten'))}</th>
      <th>${esc(t('haccp_trace_lot_leverancier'))}</th><th>${esc(t('haccp_trace_lot_datum'))}</th>
      <th>${esc(t('haccp_trace_lot_factuur'))}</th></tr>
      ${res.lots.map(l => `<tr><td>${esc(l.lotnummer)}</td><td>${esc(l.ingredient_naam)}</td>
        <td>${esc(l.leverancier)}</td><td>${esc(l.aankoop_datum)}</td>
        <td>${esc(l.factuur_nummer)}</td></tr>`).join('')}</table>` : ''}
    </body></html>`
    w.document.write(html); w.document.close(); w.print()
  }

  // ── Oefening vastleggen ──
  const openOefening = () => {
    if (!res?.gevonden) return
    const minuten = gestart != null
      ? Math.max(1, Math.round((Date.now() - gestart) / 60000)) : 1
    const oordeel = beoordeelOefening(res, minuten, haccpInst)
    setOef({duur: String(minuten), conclusie: '', capa: !oordeel.geslaagd})
  }

  const bewaarOefening = () => {
    if (!res?.gevonden || !oef?.conclusie?.trim()) return
    const duur = Number(oef.duur) || null
    const registratie = oefeningVanResultaat(res, {
      id: newId(traceOefeningen || []),
      datum: tod(),
      conclusie: oef.conclusie.trim(),
      duur_minuten: duur ?? undefined,
      paraaf: maakParaaf(whoami),
    })
    const oordeel = beoordeelOefening(res, duur, haccpInst)
    if (oef.capa) {
      const capaId = newId(capa || [])
      registratie.capa_id = capaId
      setCapa((prev: any[]) => [...(prev || []), capaUitOefening(
        registratie,
        t('haccp_trace_oefening_capa_omschr').split('{z}').join(res.zoekterm),
        capaId)])
    }
    setTraceOefeningen((prev: any[]) => [...(prev || []), registratie])
    logAudit(auditLog, setAuditLog, {
      entiteit: 'TraceOefening', entiteit_id: registratie.id, actie: 'aangemaakt',
      omschrijving: `${t('haccp_trace_oefening_titel')} ${res.zoekterm} — ${registratie.verantwoord_pct}%`
        + (oordeel.geslaagd ? '' : ` (${t('haccp_trace_oefening_niet_geslaagd')})`),
    })
    setOef(null)
    setGestart(null)
  }

  // ── Presentatie ──
  const Blok: React.FC<{titel: string, children: React.ReactNode}> = ({titel, children}) => (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{titel}</h4>
      {children}
    </div>
  )

  const balansRij = (label: string, waarde: number, klas = 'text-gray-800') => (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-gray-600">{label}</span>
      <span className={`font-medium ${klas}`}>{waarde}</span>
    </div>
  )

  const oordeel = res?.gevonden
    ? beoordeelOefening(res, Number(oef?.duur) || null, haccpInst) : null

  return (
    <div className="space-y-4">
      {/* Periodieke oefening: het handboek vraagt niet of je kúnt traceren,
          maar of je het aantoonbaar periodiek gedaan hebt. */}
      <div className={`rounded-xl border-l-4 p-3 bg-white shadow-sm ${status.verlopen ? 'border-orange-500' : 'border-green-500'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {t('haccp_trace_oefening_laatste')}
            </div>
            <div className="text-sm font-medium text-gray-800">
              {status.laatste ? fmtD(status.laatste.datum) : t('haccp_trace_oefening_nooit')}
              {status.laatste && (
                <span className="text-gray-500 font-normal ml-2">
                  {status.laatste.zoekterm} · {status.laatste.verantwoord_pct}%
                </span>
              )}
            </div>
          </div>
          <div className={`text-xs font-medium ${status.verlopen ? 'text-orange-600' : 'text-gray-500'}`}>
            {status.verlopen
              ? t('haccp_trace_oefening_verlopen')
              : t('haccp_trace_oefening_volgende').split('{d}').join(fmtD(status.volgende_voor || ''))}
          </div>
        </div>
      </div>

      <div>
        <SectionHeader title={t('haccp_trace_titel')} />
        <div className="bg-white rounded-b-lg shadow-sm p-4">
          <p className="text-xs text-gray-500 mb-3">{t('haccp_trace_uitleg')}</p>
          <div className="flex gap-2 mb-3">
            <button onClick={() => wisselMode('vooruit')}
              className={`px-3 py-1 rounded text-xs font-medium ${mode === 'vooruit' ? 'tbtn text-white' : 'bg-gray-100 text-gray-600'}`}>
              {t('haccp_trace_forward')}
            </button>
            <button onClick={() => wisselMode('terug')}
              className={`px-3 py-1 rounded text-xs font-medium ${mode === 'terug' ? 'tbtn text-white' : 'bg-gray-100 text-gray-600'}`}>
              {t('haccp_trace_backward')}
            </button>
          </div>
          <div className="flex gap-2 mb-4">
            <SearchInput value={q} onChange={setQ} cls="flex-1"
              placeholder={mode === 'vooruit' ? t('haccp_trace_lotnr') : t('haccp_trace_batch_of_lotcode')}
              onKeyDown={e => e.key === 'Enter' && doSearch()} />
            <Btn s="sm" onClick={doSearch}>{t('haccp_trace_zoek')}</Btn>
          </div>

          {res && !res.gevonden && (
            <p className="text-sm text-gray-500 italic">{t('haccp_trace_geen_resultaat')}</p>
          )}

          {res?.gevonden && (
            <div className="space-y-4">
              {/* De lotcodes staan bovenaan: dat is wat de brouwer bij een
                  terugroepactie moet doorgeven. */}
              <div className="rounded-lg p-3 t-panel">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {t('haccp_trace_lotcodes')}
                </h4>
                {res.lotcodes.length ? (
                  <div className="flex flex-wrap gap-2">
                    {res.lotcodes.map(c => (
                      <span key={c} className="font-mono text-base font-bold px-2 py-0.5 rounded bg-white shadow-sm"
                        style={{color: 'var(--t-accent)'}}>{c}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-orange-700">{t('haccp_trace_geen_lotcodes')}</p>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Blok titel={t('haccp_trace_balans')}>
                  <div className="bg-gray-50 rounded p-3">
                    {balansRij(t('haccp_trace_balans_geproduceerd'), res.balans.geproduceerd)}
                    {balansRij(t('haccp_trace_balans_traceerbaar'), res.balans.uitgeleverd_traceerbaar)}
                    {balansRij(t('haccp_trace_balans_anoniem'), res.balans.uitgeleverd_anoniem,
                      res.balans.uitgeleverd_anoniem ? 'text-orange-600' : 'text-gray-800')}
                    {balansRij(t('haccp_trace_balans_intern'), res.balans.intern)}
                    {balansRij(t('haccp_trace_balans_afgeboekt'), res.balans.afgeboekt)}
                    {balansRij(t('haccp_trace_balans_voorraad'), res.balans.voorraad)}
                    {!!res.balans.tekort &&
                      balansRij(t('haccp_trace_balans_tekort'), res.balans.tekort, 'text-red-600')}
                    {!!res.balans.geblokkeerd &&
                      balansRij(t('haccp_trace_balans_geblokkeerd'), res.balans.geblokkeerd, 'text-red-600')}
                    <div className="flex justify-between text-sm pt-1.5 mt-1 border-t border-gray-200">
                      <span className="font-semibold text-gray-700">{t('haccp_trace_balans_verantwoord')}</span>
                      <span className={`font-bold ${res.balans.verantwoord_pct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                        {res.balans.verantwoord} ({res.balans.verantwoord_pct}%)
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">{t('haccp_trace_balans_uitleg')}</p>
                  </div>
                </Blok>

                <Blok titel={t('haccp_trace_gaten')}>
                  {res.gaten.length ? (
                    <ul className="rounded p-3 bg-orange-50 border border-orange-200 space-y-1">
                      {res.gaten.map(g => (
                        <li key={g.code} className="text-sm text-orange-800">{gatTekst(g)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
                      {t('haccp_trace_geen_gaten')}
                    </p>
                  )}
                </Blok>
              </div>

              <Blok titel={t('haccp_trace_afnemers')}>
                {res.afnemers.length ? (
                  <div className="space-y-1">
                    {res.afnemers.map(a => (
                      <div key={a.naam} className="text-sm bg-gray-50 rounded p-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{a.naam}</span>
                          <span className="text-gray-500 whitespace-nowrap">
                            {fmtD(a.laatste_datum)} · {a.aantal}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {[a.email, a.telefoon].filter(Boolean).join(' · ') || t('haccp_trace_geen_contact')}
                          {a.adres ? ` — ${a.adres}` : ''}
                        </div>
                        {!!a.lotcodes.length && (
                          <div className="text-xs font-mono text-gray-400">{a.lotcodes.join(', ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">{t('haccp_trace_geen_afnemers')}</p>
                )}
              </Blok>

              {!!res.batches.length && (
                <Blok titel={t('haccp_trace_batches')}>
                  <div className="space-y-1">
                    {res.batches.map((b: any) => (
                      <div key={b.id} className="text-sm bg-gray-50 rounded p-2">
                        {b.naam} <span className="text-gray-500">({b.status})</span>
                        {b.batch_nummer && <span className="text-gray-400 ml-2">{b.batch_nummer}</span>}
                      </div>
                    ))}
                  </div>
                </Blok>
              )}

              {!!res.lots.length && (
                <Blok titel={t('haccp_trace_lots')}>
                  <div className="space-y-1">
                    {res.lots.map(l => (
                      <div key={l.lot.id} className="text-sm bg-gray-50 rounded p-2">
                        <span className="font-mono font-medium">{lotLabel(l.lot)}</span>
                        <span className="text-gray-500 ml-2">{l.ingredient_naam}</span>
                        <span className="text-gray-400 ml-2">
                          {[l.leverancier, l.aankoop_datum && fmtD(l.aankoop_datum), l.factuur_nummer]
                            .filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </Blok>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Btn s="sm" v="secondary" onClick={printRecall}>{t('haccp_trace_mock_recall')}</Btn>
                <Btn s="sm" onClick={openOefening}>{t('haccp_trace_oefening_vastleggen')}</Btn>
              </div>
            </div>
          )}

          {!res && (
            <p className="text-xs text-gray-400 italic">{t('haccp_trace_oefening_zoek_eerst')}</p>
          )}
        </div>
      </div>

      {/* Register: het bewijs dat er periodiek geoefend is. */}
      <div>
        <SectionHeader title={t('haccp_trace_oefening_register')} />
        <div className="bg-white rounded-b-lg shadow-sm p-4">
          {!eerdere.length && (
            <p className="text-sm text-gray-500 italic">{t('haccp_trace_oefening_geen')}</p>
          )}
          <div className="space-y-2">
            {eerdere.map((o: any) => (
              <div key={o.id} className="rounded-lg bg-gray-50 p-3 border-l-4"
                style={{borderColor: o.verantwoord_pct >= 100 && !(o.gaten || []).length ? '#22c55e' : '#f97316'}}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {fmtD(o.datum)} — {t(o.richting === 'vooruit'
                      ? 'haccp_trace_richting_vooruit' : 'haccp_trace_richting_terug')}: {o.zoekterm}
                  </span>
                  <span className="text-xs text-gray-500">
                    {o.verantwoord}/{o.geproduceerd} ({o.verantwoord_pct}%)
                    {o.duur_minuten ? ` · ${o.duur_minuten} min` : ''}
                    {o.paraaf?.gebruiker ? ` · ${o.paraaf.gebruiker}` : ''}
                  </span>
                </div>
                {!!o.lotcodes?.length && (
                  <div className="text-xs font-mono text-gray-400 mt-0.5">{o.lotcodes.join(', ')}</div>
                )}
                <div className="text-xs text-gray-600 mt-0.5 italic">{o.conclusie}</div>
                {!!(o.gaten || []).length && (
                  <div className="text-xs text-orange-700 mt-0.5">
                    {(o.gaten || []).map((g: any) =>
                      t(gatI18nKey(g.code)).split('{n}').join(String(g.aantal))).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {oef && res?.gevonden && (
        <Modal title={t('haccp_trace_oefening_titel')} onClose={() => setOef(null)}>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              {t(mode === 'vooruit' ? 'haccp_trace_richting_vooruit' : 'haccp_trace_richting_terug')}:
              <span className="font-medium ml-1">{res.zoekterm}</span>
              <span className="text-gray-400 ml-2">
                {res.balans.verantwoord}/{res.balans.geproduceerd} ({res.balans.verantwoord_pct}%)
              </span>
            </div>

            <div className={`rounded-lg p-3 border ${oordeel?.geslaagd ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${oordeel?.geslaagd ? 'text-green-800' : 'text-orange-800'}`}>
                {oordeel?.geslaagd ? t('haccp_trace_oefening_geslaagd') : t('haccp_trace_oefening_niet_geslaagd')}
              </div>
              {!oordeel?.geslaagd && (
                <ul className="space-y-0.5">
                  {oordeel?.redenen.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="text-sm text-orange-800">{paramTekst(r)}</li>
                  ))}
                </ul>
              )}
            </div>

            <Inp label={t('haccp_trace_oefening_duur')} type="number" min={1}
              value={oef.duur} onChange={v => setOef({...oef, duur: v})} />

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                {t('haccp_trace_oefening_conclusie')}<span className="text-red-500 ml-0.5">*</span>
              </label>
              <textarea rows={3} value={oef.conclusie}
                onChange={e => setOef({...oef, conclusie: e.target.value})}
                placeholder={t('haccp_trace_oefening_conclusie_ph')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none shadow-sm placeholder-gray-300" />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={!!oef.capa}
                onChange={e => setOef({...oef, capa: e.target.checked})} />
              {t('haccp_trace_oefening_capa')}
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Btn v="secondary" onClick={() => setOef(null)}>{t('btn_cancel')}</Btn>
              <Btn disabled={!oef.conclusie?.trim()} onClick={bewaarOefening}>
                {t('haccp_trace_oefening_vastleggen')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default TraceTab
