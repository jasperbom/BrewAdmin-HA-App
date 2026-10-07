import React from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import Inp from './ui/Inp'
import { inboxOphalen, inboxStatus, inboxTest } from '../utils/api'
import { geheimOpnieuwNodig } from '../utils/geheimen'
import {
  IMAP_BEVEILIGINGEN, IMAP_INTERVAL_MAX, IMAP_INTERVAL_MIN, IMAP_MAP_RE, IMAP_POORT_STANDAARD,
  ImapBeveiliging, ImapInst, InkoopInboxStatus, formatAfzenders, imapActief, imapVerbindbaar,
  inboxFoutSleutel, inboxRedenSleutel, normaliseerImapInst,
} from '../utils/inkoopInbox'

// Instellingen → Koppelingen → "Facturen per e-mail". Het postvak waar je een
// inkoopfactuur naartoe stuurt; de server haalt er de PDF-bijlagen uit
// (`_inbox_tick`) en zet ze op Facturen → Inkoop klaar om te verwerken. Alleen
// `beheer` mag dit wijzigen (`imap_creds` staat in _BEHEER_KEYS).

interface InkoopMailInstellingenProps {
  /** `imap_creds` zoals de store hem geeft (het wachtwoord is dan `__SECRET__`). */
  creds: unknown
  setCreds: (waarde: (prev: any) => any) => void
  fmtTs: (ts: any) => string
  onAudit?: (omschrijving: string) => void
}

// Het formulier houdt alles als tekst vast: een half getypt getal mag er staan.
interface Formulier {
  enabled: boolean
  host: string
  port: string
  security: ImapBeveiliging
  username: string
  password: string
  mailbox: string
  interval: string
  afzenders: string
}

const naarFormulier = (i: ImapInst): Formulier => ({
  enabled: i.enabled, host: i.host, port: String(i.port), security: i.security, username: i.username,
  password: i.password, mailbox: i.mailbox, interval: String(i.interval), afzenders: formatAfzenders(i.afzenders),
})

const BEVEILIGING_LABEL: Record<ImapBeveiliging, string> = {
  ssl: 'inkoopmail_bev_ssl', starttls: 'inkoopmail_bev_starttls', none: 'inkoopmail_bev_geen',
}

const card = 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid'

// Waar "Naar de instellingen" op Facturen → Inkoop precies landt (zie InstellingenPage).
export const POSTVAK_KAART_ID = 'instellingen-postvak'

export default function InkoopMailInstellingen({ creds, setCreds, fmtTs, onAudit }: InkoopMailInstellingenProps) {
  const [form, setForm] = React.useState<Formulier>(() => naarFormulier(normaliseerImapInst(creds)))
  // Zolang de gebruiker niets aanraakte volgt het formulier de opgeslagen stand
  // (die komt pas na het laden van de server binnen).
  const bewerkt = React.useRef(false)
  React.useEffect(() => {
    if (!bewerkt.current) setForm(naarFormulier(normaliseerImapInst(creds)))
  }, [creds])
  const zet = (patch: Partial<Formulier>) => { bewerkt.current = true; setForm(f => ({ ...f, ...patch })) }

  const [msg, setMsg] = React.useState('')
  const [bezig, setBezig] = React.useState<'' | 'test' | 'ophalen' | 'opnieuw'>('')
  const [status, setStatus] = React.useState<InkoopInboxStatus>({})
  const laadStatus = React.useCallback(() => { inboxStatus().then(setStatus) }, [])
  React.useEffect(() => {
    laadStatus()
    const id = window.setInterval(laadStatus, 60_000)
    return () => window.clearInterval(id)
  }, [laadStatus])

  // Wat er zou worden opgeslagen: het formulier als genormaliseerde instellingen.
  const uitFormulier = (): ImapInst => normaliseerImapInst({
    enabled: form.enabled, host: form.host.trim(), port: Math.trunc(Number(form.port)), security: form.security,
    username: form.username.trim(), password: form.password, mailbox: form.mailbox.trim(),
    interval: form.interval, afzenders: form.afzenders,
  })

  const opslaan = () => {
    const nieuw = uitFormulier()
    if (form.mailbox.trim() && !IMAP_MAP_RE.test(form.mailbox.trim())) { setMsg('⚠ ' + t('inkoopmail_map_ongeldig')); return }
    if (nieuw.enabled && !imapVerbindbaar(nieuw)) { setMsg('⚠ ' + t('inkoopmail_onvolledig')); return }
    // Andere server/poort/gebruiker/beveiliging: het opgeslagen wachtwoord gaat niet mee.
    if (geheimOpnieuwNodig('imap_creds', creds as Record<string, unknown>, nieuw as unknown as Record<string, unknown>)) {
      setMsg('⚠ ' + t('settings_geheim_opnieuw')); return
    }
    setCreds(prev => ({ ...prev, ...nieuw }))
    onAudit?.(`Facturen per e-mail ${nieuw.enabled ? 'ingeschakeld' : 'uitgeschakeld'}`)
    bewerkt.current = false
    setForm(naarFormulier(nieuw))
    setMsg('✓ ' + t('lbl_saved'))
    window.setTimeout(() => setMsg(''), 2000)
  }

  const test = async () => {
    const nieuw = uitFormulier()
    const body = {
      host: nieuw.host, port: nieuw.port, security: nieuw.security, username: nieuw.username,
      password: nieuw.password, mailbox: form.mailbox.trim() || nieuw.mailbox,
    }
    if (geheimOpnieuwNodig('imap_creds', creds as Record<string, unknown>, body)) { setMsg('⚠ ' + t('settings_geheim_opnieuw')); return }
    setBezig('test'); setMsg('')
    const d = await inboxTest(body)
    setBezig('')
    if (d?.ok) setMsg('✓ ' + t('inkoopmail_test_ok').replace('{n}', String(d.berichten ?? 0)))
    else if (d?.geheim) setMsg('⚠ ' + t('settings_geheim_opnieuw'))
    else setMsg('⚠ ' + t('inkoopmail_test_fout').replace('{fout}', t(inboxFoutSleutel(d?.fout))))
  }

  const ophalen = async (opnieuw = false) => {
    setBezig(opnieuw ? 'opnieuw' : 'ophalen'); setMsg('')
    const d = await inboxOphalen(opnieuw)
    setBezig('')
    laadStatus()
    setMsg(d?.ok
      ? '✓ ' + t('inbox_ophalen_klaar').replace('{nieuw}', String(d.nieuw ?? 0))
      : '⚠ ' + t(inboxFoutSleutel(d?.fout)))
  }

  const overgeslagen = (status.overgeslagen || []).slice(0, 5)
  const actief = imapActief(creds)
  // Een oude fout van een koppeling die uit staat hoort niet te blijven zeuren.
  const fout = actief ? status.fout : null
  const veld = 'border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input min-h-tap sm:min-h-0'

  return (
    <div className={card} id={POSTVAK_KAART_ID}>
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('inkoopmail_titel')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('inkoopmail_uitleg')}</p>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <div className="relative">
            <input type="checkbox" checked={form.enabled} onChange={e => zet({ enabled: e.target.checked })} className="sr-only peer" />
            <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
          </div>
          <span className="text-sm font-medium text-gray-700">{t('inkoopmail_aan')}</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp cls="sm:col-span-2" label={t('inkoopmail_host')} value={form.host} placeholder="imap.example.com"
            autoComplete="off" onChange={v => zet({ host: v })} />
          <Inp label={t('inkoopmail_poort')} type="number" min={1} max={65535} value={form.port}
            onChange={v => zet({ port: v })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('inkoopmail_beveiliging')}</label>
            <select value={form.security} className={`${veld} bg-white`}
              onChange={e => {
                const s = e.target.value as ImapBeveiliging
                // Staat de poort nog op de standaard van de vorige keuze, dan schuift hij mee.
                const meeschuiven = Number(form.port) === IMAP_POORT_STANDAARD[form.security]
                zet({ security: s, ...(meeschuiven ? { port: String(IMAP_POORT_STANDAARD[s]) } : {}) })
              }}>
              {IMAP_BEVEILIGINGEN.map(b => <option key={b} value={b}>{t(BEVEILIGING_LABEL[b])}</option>)}
            </select>
          </div>
          <Inp label={t('inkoopmail_gebruiker')} value={form.username} autoComplete="off"
            onChange={v => zet({ username: v })} />
          <Inp label={t('inkoopmail_wachtwoord')} type="password" value={form.password} autoComplete="new-password"
            onChange={v => zet({ password: v })} />
          <div className="sm:col-span-2">
            <Inp label={t('inkoopmail_map')} value={form.mailbox} placeholder="INBOX" autoComplete="off"
              onChange={v => zet({ mailbox: v })} />
            <p className="text-xs text-gray-400 mt-1">{t('inkoopmail_map_hint')}</p>
          </div>
          <div>
            <Inp label={t('inkoopmail_interval')} type="number" min={IMAP_INTERVAL_MIN} max={IMAP_INTERVAL_MAX} step={5}
              value={form.interval} onChange={v => zet({ interval: v })} />
            <p className="text-xs text-gray-400 mt-1">{t('inkoopmail_interval_hint')}</p>
          </div>
          <div className="sm:col-span-2">
            <Inp label={t('inkoopmail_afzenders')} value={form.afzenders} placeholder="jan@brouwerij.nl, @brouwerij.nl"
              autoComplete="off" onChange={v => zet({ afzenders: v })} />
            <p className="text-xs text-gray-400 mt-1">{t('inkoopmail_afzenders_hint')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={opslaan} className="px-4 py-2 tbtn rounded text-sm font-medium transition-colors min-h-tap sm:min-h-0">{t('btn_save')}</button>
          <Btn v="secondary" onClick={test} disabled={bezig !== '' || !form.host.trim()}>
            {bezig === 'test' ? t('settings_ha_testing') : t('inkoopmail_test')}
          </Btn>
          <Btn v="secondary" onClick={() => ophalen()} disabled={bezig !== '' || !actief}>
            {bezig === 'ophalen' ? t('inbox_ophalen_bezig') : t('inbox_ophalen')}
          </Btn>
          <Btn v="secondary" onClick={() => ophalen(true)} disabled={bezig !== '' || !actief} title={t('inbox_opnieuw_titel')}>
            {bezig === 'opnieuw' ? t('inbox_ophalen_bezig') : t('inbox_opnieuw')}
          </Btn>
        </div>
        {msg && <div className={`text-sm font-medium ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</div>}

        {actief && (
          <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 space-y-1">
            <div>
              {status.laatste_check
                ? t('inbox_laatste_check').replace('{tijd}', fmtTs(status.laatste_check))
                : t('inbox_nog_niet')}
            </div>
            {status.laatste_ronde && (
              <div>
                {t('inbox_laatste_ronde')
                  .replace('{berichten}', String(status.laatste_ronde.berichten))
                  .replace('{nieuw}', String(status.laatste_ronde.nieuw))
                  .replace('{overgeslagen}', String(status.laatste_ronde.overgeslagen))}
              </div>
            )}
            {fout && <div className="font-medium text-red-600">⚠ {t(inboxFoutSleutel(fout))}</div>}
            {overgeslagen.length > 0 && (
              <div className="pt-1">
                <div className="font-medium text-gray-600">{t('inbox_overgeslagen_titel')}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {overgeslagen.map((o, n) => (
                    <li key={`${o.ts}-${n}`} className="truncate">
                      {[o.van, o.onderwerp, o.naam].filter(Boolean).join(' — ') || '—'} · {t(inboxRedenSleutel(o.reden))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t text-xs text-gray-400 space-y-1">
        <p>{t('inkoopmail_hint_doorsturen')}</p>
        <p>{t('inkoopmail_hint_lezen')}</p>
        <p>{t('inkoopmail_hint_provider')}</p>
      </div>
    </div>
  )
}
