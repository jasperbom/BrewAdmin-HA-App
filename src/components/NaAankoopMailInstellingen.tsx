import React, { useMemo, useState } from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import Segment from './ui/Segment'
import { tod } from '../utils/format'
import { orderNummer } from '../utils/picking'
import { resolveKlantSnapshot } from '../utils/klant'
import { verzendMail } from '../utils/mailVerzenden'
import { verkoopOverzicht } from '../utils/verkoopOverzicht'
import type { VerkoopCtx } from '../utils/verkoopOverzicht'
import {
  NA_AANKOOP_STAPPEN, NA_AANKOOP_DAGEN_GRENS, naAankoopInstellingen, zetNaAankoopModus, naSoort, naAankoopTekst,
  naAankoopOverzicht, bouwNaAankoopMail, taplijst as maakTaplijst, metAfmelding, zonderAfmelding, isEmailAdres,
  plusDagen, sindsDag,
} from '../utils/naAankoopMail'
import type {
  NaAankoopStap, NaAankoopModus, NaAankoopGrondslag, NaAankoopInst, NaAankoopCtx, NaAankoopRefs, MailAfmelding,
  NaAankoopStand, NaAankoopMail,
} from '../utils/naAankoopMail'

// Instellingen → E-mail: de mails ná een webshopbestelling (utils/naAankoopMail.ts).
// Standaard uit. De app verstuurt ze zelf na de periodieke webshopimport
// (App.tsx, `verstuurNaAankoopMails`); dit blok kiest de stand, de grondslag,
// de wachttijden en de teksten, houdt de afmeldlijst bij en laat met een droge
// run zien wat er zou gebeuren. Een voorbeeld gaat alleen naar het proefadres.

interface NaAankoopMailInstellingenProps {
  inst: unknown
  setInst: (fn: (p: any) => any) => void
  mailTemplates: any
  setMailTemplates: (fn: (p: any) => any) => void
  afmeldingen: MailAfmelding[]
  setAfmeldingen: (fn: (p: any) => any) => void
  bestellingen: any[]
  klanten: any[]
  refs: NaAankoopRefs
  verkoopCtx: VerkoopCtx | null
  breweryDetails: any
  smtpCreds: any
  wcCreds: any
  logoDataUri?: string | null
}

const INPUT = 'border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input bg-white'

function Schakelaar({ aan, onChange, label }: { aan: boolean, onChange: (v: boolean) => void, label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer w-fit">
      <div className="relative">
        <input type="checkbox" checked={aan} className="sr-only peer" onChange={(e) => onChange(e.target.checked)} />
        <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
      </div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </label>
  )
}

const STATUS_KLEUR: Record<NaAankoopStand['status'], string> = {
  verstuurd: 'text-green-700',
  klaar: 'text-blue-700',
  gepland: 'text-gray-600',
  overgeslagen: 'text-gray-400',
}

const standTekst = (s: NaAankoopStand): string => {
  const basis = t(`na_aankoop_status_${s.status}`)
  const datum = s.datum ? ` ${s.datum}` : ''
  const reden = s.reden && s.status !== 'verstuurd' && s.status !== 'klaar' ? ` · ${t(`na_aankoop_reden_${s.reden}`, s.reden)}` : ''
  return `${basis}${datum}${reden}`
}

export default function NaAankoopMailInstellingen(p: NaAankoopMailInstellingenProps) {
  const inst = naAankoopInstellingen(p.inst)
  const zet = (patch: Record<string, unknown>) => p.setInst((oud: any) => ({...(oud || {}), ...patch}))
  const zetStap = (stap: NaAankoopStap, patch: Record<string, unknown>) =>
    p.setInst((oud: any) => {
      const o = oud || {}
      const stappen = o.stappen || {}
      return {...o, stappen: {...stappen, [stap]: {...inst.stappen[stap], ...(stappen[stap] || {}), ...patch}}}
    })
  const [nieuwAdres, setNieuwAdres] = useState('')
  const [weerToestaan, setWeerToestaan] = useState('')
  const [voorbeeld, setVoorbeeld] = useState<{orderId: number, stap: NaAankoopStap} | null>(null)
  const [testMelding, setTestMelding] = useState<{ok: boolean, tekst: string} | null>(null)
  const [testBezig, setTestBezig] = useState(false)

  const brouwerij = p.breweryDetails?.naam || ''
  const afmeldAdres = p.breweryDetails?.email || p.smtpCreds?.fromEmail || ''
  const proefAdres = inst.proef_adres || p.breweryDetails?.email || ''
  const lijst = useMemo(() => (p.bestellingen || []).map((b: any) => resolveKlantSnapshot(b, p.klanten || []) || b),
    [p.bestellingen, p.klanten])
  const tap = useMemo(() => (p.verkoopCtx ? maakTaplijst(verkoopOverzicht(p.verkoopCtx)) : []), [p.verkoopCtx])

  // De droge run: in de stand Uit "alsof het de afgelopen 60 dagen aan stond".
  const vandaag = tod()
  const droog = inst.modus === 'uit'
  const runInst: NaAankoopInst = droog ? {...inst, modus: 'aan', sinds: plusDagen(vandaag, -60)} : inst
  const ctx: NaAankoopCtx & {brouwerij: string} = {
    inst: runInst, vandaag, bestellingen: lijst, afmeldingen: p.afmeldingen || [], sjablonen: p.mailTemplates,
    refs: p.refs, taplijst: tap, afmeldAdres, storeUrl: p.wcCreds?.storeUrl || '', brouwerij,
  }
  const overzicht = naAankoopOverzicht(ctx, 15)

  // Een voorbeeld is altijd een proefmail: hij gaat naar het proefadres, nooit naar de klant.
  const voorbeeldMail: NaAankoopMail | null = useMemo(() => {
    if (!voorbeeld) return null
    const order = lijst.find((b: any) => b.id === voorbeeld.orderId)
    if (!order) return null
    return bouwNaAankoopMail(voorbeeld.stap, order, {...ctx, inst: {...runInst, modus: 'proef', proef_adres: proefAdres}})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voorbeeld, lijst, p.mailTemplates, p.refs, tap, proefAdres, inst.review_url, inst.taplijst_url, inst.afmeld_url])

  const stuurVoorbeeld = async () => {
    if (!voorbeeldMail || !isEmailAdres(voorbeeldMail.to)) return
    setTestBezig(true)
    setTestMelding(null)
    try {
      await verzendMail(voorbeeldMail, {brewery: p.breweryDetails, logoDataUri: p.logoDataUri, replyTo: p.breweryDetails?.email})
      setTestMelding({ok: true, tekst: t('na_aankoop_voorbeeld_verstuurd').replace('{email}', voorbeeldMail.to)})
    } catch (e: any) {
      setTestMelding({ok: false, tekst: t('na_aankoop_voorbeeld_mislukt').replace('{fout}', String(e?.message || ''))})
    } finally {
      setTestBezig(false)
    }
  }

  const waarschuwingen: string[] = []
  if (inst.modus !== 'uit' && !p.smtpCreds?.enabled) waarschuwingen.push(t('na_aankoop_let_op_smtp'))
  if (inst.modus !== 'uit' && !(Number(p.wcCreds?.importInterval ?? 15) > 0)) waarschuwingen.push(t('na_aankoop_let_op_import'))
  if (inst.modus === 'proef' && !isEmailAdres(inst.proef_adres)) waarschuwingen.push(t('na_aankoop_let_op_proef_adres'))
  if (inst.grondslag === 'toestemming' && !inst.vinkje_meta) waarschuwingen.push(t('na_aankoop_let_op_toestemming'))
  if (!inst.afmeld_url && !isEmailAdres(afmeldAdres)) waarschuwingen.push(t('na_aankoop_let_op_afmelden'))

  const voegAfmeldingToe = () => {
    if (!isEmailAdres(nieuwAdres)) return
    p.setAfmeldingen((oud: any) => metAfmelding(oud, nieuwAdres, vandaag, 'handmatig'))
    setNieuwAdres('')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid" id="na-aankoop-mails">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('na_aankoop_titel')}</h2>
      <p className="text-sm text-gray-500 mb-1">{t('na_aankoop_uitleg')}</p>
      <p className="text-sm text-gray-500 mb-4">{t('na_aankoop_uitleg_app')}</p>

      {/* Stand */}
      <div className="flex flex-col gap-2 mb-4">
        <Segment<NaAankoopModus> label={t('na_aankoop_modus')} waarde={inst.modus}
          opties={[{v: 'uit', l: t('na_aankoop_modus_uit')}, {v: 'proef', l: t('na_aankoop_modus_proef')}, {v: 'aan', l: t('na_aankoop_modus_aan')}]}
          onKies={(m) => p.setInst((oud: any) => zetNaAankoopModus(oud, m, new Date().toISOString()))} />
        <p className="text-xs text-gray-500">{t(`na_aankoop_modus_${inst.modus}_uitleg`)}
          {inst.modus !== 'uit' && inst.sinds ? ` ${t('na_aankoop_sinds').replace('{datum}', sindsDag(inst.sinds))}` : ''}</p>
        {inst.modus === 'proef' && (
          <div className="max-w-md">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_proef_adres')}</label>
            <input type="email" value={inst.proef_adres} placeholder={p.breweryDetails?.email || ''}
              onChange={(e) => zet({proef_adres: e.target.value})} className={INPUT} />
          </div>
        )}
        {waarschuwingen.map(w => <p key={w} className="text-xs text-orange-700">{w}</p>)}
      </div>

      {/* Grondslag */}
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('na_aankoop_grondslag')}</h3>
        <Segment<NaAankoopGrondslag> label={t('na_aankoop_grondslag')} waarde={inst.grondslag}
          opties={[{v: 'soft_opt_in', l: t('na_aankoop_grondslag_soft_opt_in')}, {v: 'toestemming', l: t('na_aankoop_grondslag_toestemming')}]}
          onKies={(g) => zet({grondslag: g})} />
        <p className="text-xs text-gray-500 mt-2">{t(`na_aankoop_grondslag_${inst.grondslag}_uitleg`)}</p>
        <div className="mt-3 max-w-md">
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_vinkje_meta')}</label>
          <input type="text" value={inst.vinkje_meta} placeholder="_mijn_mail_vinkje"
            onChange={(e) => zet({vinkje_meta: e.target.value})} className={`${INPUT} font-mono`} />
          <p className="text-xs text-gray-400 mt-1">{t(`na_aankoop_vinkje_meta_uitleg_${inst.grondslag}`)}</p>
        </div>
      </div>

      {/* De drie mails */}
      <div className="flex flex-col gap-4 mb-4">
        {NA_AANKOOP_STAPPEN.map((stap) => {
          const s = inst.stappen[stap]
          const soort = naSoort(stap)
          const tpl = p.mailTemplates?.[soort] || {}
          const [min, max] = NA_AANKOOP_DAGEN_GRENS[stap]
          const zetTpl = (veld: 'subject' | 'body', waarde: string) =>
            p.setMailTemplates((oud: any) => ({...(oud || {}), [soort]: {...((oud || {})[soort] || {}), [veld]: waarde}}))
          const eigen = String(tpl.subject || '').trim() || String(tpl.body || '').trim()
          return (
            <div key={stap} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{t(`settings_mail_template_${soort}`)}</h3>
                {eigen && (
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-700 underline"
                    onClick={() => p.setMailTemplates((oud: any) => ({...(oud || {}), [soort]: {...((oud || {})[soort] || {}), subject: '', body: ''}}))}>
                    {t('settings_mail_reset_default')}
                  </button>
                )}
              </div>
              <Schakelaar aan={s.aan} onChange={(v) => zetStap(stap, {aan: v})} label={t('na_aankoop_stap_aan')} />
              <div className="flex flex-wrap items-end gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_dagen')}</label>
                  <input type="number" min={min} max={max} value={s.dagen}
                    onChange={(e) => zetStap(stap, {dagen: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24 t-input bg-white" />
                </div>
                {stap !== 'taplijst' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_vanaf')}</label>
                    <select value={s.vanaf} onChange={(e) => zetStap(stap, {vanaf: e.target.value})}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm t-input bg-white">
                      <option value="bestelling">{t('na_aankoop_vanaf_bestelling')}</option>
                      <option value="geleverd">{t('na_aankoop_vanaf_geleverd')}</option>
                    </select>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 pb-2">{t('na_aankoop_vanaf_laatste')}</p>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">{t(`na_aankoop_stap_${stap}_uitleg`)}</p>
              <div className="flex flex-col gap-2 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings_mail_subject')}</label>
                  <input type="text" value={tpl.subject || ''} placeholder={naAankoopTekst({}, stap, 'subject')}
                    onChange={(e) => zetTpl('subject', e.target.value)} className={INPUT} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings_mail_body')}</label>
                  <textarea value={tpl.body || ''} placeholder={naAankoopTekst({}, stap, 'body')} rows={7}
                    onChange={(e) => zetTpl('body', e.target.value)} className={`${INPUT} font-mono`} />
                </div>
                <p className="text-xs text-gray-400">{t(`settings_mail_vars_${soort}`)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_review_url')}</label>
          <input type="url" value={inst.review_url} placeholder="https://g.page/r/…/review"
            onChange={(e) => zet({review_url: e.target.value})} className={INPUT} />
          <p className="text-xs text-gray-400 mt-1">{t('na_aankoop_review_url_uitleg')}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_taplijst_url')}</label>
          <input type="url" value={inst.taplijst_url} placeholder={p.wcCreds?.storeUrl || 'https://…'}
            onChange={(e) => zet({taplijst_url: e.target.value})} className={INPUT} />
          <p className="text-xs text-gray-400 mt-1">{t('na_aankoop_taplijst_url_uitleg')}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('na_aankoop_afmeld_url')}</label>
          <input type="text" value={inst.afmeld_url} placeholder="{winkel}/?afmelden={id}&sleutel={sleutel}"
            onChange={(e) => zet({afmeld_url: e.target.value})} className={`${INPUT} font-mono`} />
          <p className="text-xs text-gray-400 mt-1">{t('na_aankoop_afmeld_url_uitleg').replace('{email}', afmeldAdres || '—')}</p>
        </div>
      </div>

      {/* Afmeldlijst */}
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('na_aankoop_afmeldingen')}</h3>
        <p className="text-xs text-gray-500 mb-2">{t('na_aankoop_afmeldingen_uitleg')}</p>
        <div className="flex gap-2 max-w-md mb-2">
          <input type="email" value={nieuwAdres} placeholder={t('na_aankoop_afmelding_adres')}
            onChange={(e) => setNieuwAdres(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') voegAfmeldingToe() }} className={INPUT} />
          <Btn v="secondary" onClick={voegAfmeldingToe} disabled={!isEmailAdres(nieuwAdres)}>{t('na_aankoop_afmelding_toevoegen')}</Btn>
        </div>
        {(p.afmeldingen || []).length === 0 ? (
          <p className="text-xs text-gray-400">{t('na_aankoop_afmeldingen_leeg')}</p>
        ) : (
          <ul className="text-sm divide-y divide-gray-200">
            {(p.afmeldingen || []).map(a => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-gray-700">{a.email} <span className="text-xs text-gray-400">· {a.datum} · {t(`na_aankoop_bron_${a.bron}`, a.bron)}</span></span>
                {weerToestaan === a.email ? (
                  <span className="flex gap-2">
                    <Btn v="danger" onClick={() => { p.setAfmeldingen((oud: any) => zonderAfmelding(oud, a.email)); setWeerToestaan('') }}>
                      {t('na_aankoop_weer_toestaan_ja')}
                    </Btn>
                    <Btn v="secondary" onClick={() => setWeerToestaan('')}>{t('btn_cancel')}</Btn>
                  </span>
                ) : (
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={() => setWeerToestaan(a.email)}>
                    {t('na_aankoop_weer_toestaan')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Droge run */}
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('na_aankoop_droge_run')}</h3>
        <p className="text-xs text-gray-500 mb-2">
          {droog ? t('na_aankoop_droge_run_uit').replace('{datum}', runInst.sinds) : t('na_aankoop_droge_run_aan')}
        </p>
        {tap.length > 0 && (
          <p className="text-xs text-gray-500 mb-2">{t('na_aankoop_taplijst_nu').replace('{bieren}', tap.map(b => b.naam).join(', '))}</p>
        )}
        {overzicht.length === 0 ? (
          <p className="text-xs text-gray-400">{t('na_aankoop_geen_bestellingen')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-3 font-medium">{t('na_aankoop_kolom_bestelling')}</th>
                  {NA_AANKOOP_STAPPEN.map(s => <th key={s} className="py-1 pr-3 font-medium">{t(`na_aankoop_kolom_${s}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {overzicht.map(({bestelling: b, standen}) => (
                  <tr key={b.id} className="border-t border-gray-200 align-top">
                    <td className="py-1.5 pr-3 text-gray-700 whitespace-nowrap">
                      {orderNummer(b)} · {b.datum}<br /><span className="text-gray-500">{b.klant_naam}</span>
                    </td>
                    {NA_AANKOOP_STAPPEN.map(s => (
                      <td key={s} className={`py-1.5 pr-3 ${STATUS_KLEUR[standen[s].status]}`}>
                        {standTekst(standen[s])}
                        <br />
                        <button type="button" className="underline text-gray-500 hover:text-gray-700"
                          onClick={() => { setVoorbeeld({orderId: b.id, stap: s}); setTestMelding(null) }}>
                          {t('na_aankoop_voorbeeld')}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {voorbeeldMail && (
          <div className="mt-3 border border-gray-300 rounded-lg bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-xs text-gray-500">
                {t('na_aankoop_voorbeeld_aan').replace('{email}', voorbeeldMail.to || '—')}
              </p>
              <div className="flex gap-2">
                <Btn v="secondary" onClick={stuurVoorbeeld}
                  disabled={testBezig || !p.smtpCreds?.enabled || !isEmailAdres(voorbeeldMail.to)}>
                  {t('na_aankoop_voorbeeld_stuur')}
                </Btn>
                <Btn v="ghost" onClick={() => setVoorbeeld(null)}>{t('btn_sluiten')}</Btn>
              </div>
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">{voorbeeldMail.subject}</p>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{voorbeeldMail.text}</pre>
            {voorbeeldMail.linkButtons.map(k => (
              <p key={k.url} className="text-xs mt-2"><span className="font-semibold">{k.label}</span> → <span className="text-gray-500 break-all">{k.url}</span></p>
            ))}
            <p className="text-xs text-gray-400 mt-3">
              {voorbeeldMail.afmelden.tekst} {voorbeeldMail.afmelden.label} → <span className="break-all">{voorbeeldMail.afmelden.url || t('na_aankoop_reden_geen_afmeldlink')}</span>
            </p>
            {testMelding && <p className={`text-xs mt-2 ${testMelding.ok ? 'text-green-700' : 'text-red-700'}`}>{testMelding.tekst}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
