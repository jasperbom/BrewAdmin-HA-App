/**
 * KlantenPage.tsx — dedicated klantenbeheer met orderhistorie.
 * - Lijst van alle klanten met stats (omzet, openstaand, # bestellingen).
 * - Detail-view met bewerkbare velden, bestellingen, facturen en mail-knop.
 * - Matched bestellingen/facturen via klant_id, OF (fallback) klant_email match
 *   voor losse WC-orders die nog niet aan een klantkaart gekoppeld zijn.
 */
import React from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { fmt, fmtD } from '../utils/format'
import Btn from '../components/ui/Btn'
import Inp from '../components/ui/Inp'
import SearchInput from '../components/ui/SearchInput'
import SectionHeader from '../components/ui/SectionHeader'
import MailModal from '../components/MailModal'
import { logAudit } from '../utils/audit'

interface Props {
  klanten: any[]
  setKlanten: any
  bestellingen: any[]
  setBestellingen: any
  verkoopFacturen: any[]
  breweryDetails: any
  smtpCreds: any
  factuurLogo?: string | null
  logo?: string | null
  appName?: string
  setPage: (p: string) => void
  setOpenOrderId: (id: number | null) => void
  auditLog: any[]
  setAuditLog: any
}

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/

const STATUS_COLORS: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
  gepickt: 'bg-orange-100 text-orange-700',
  verzonden: 'bg-purple-100 text-purple-700',
  afgerond: 'bg-green-100 text-green-700',
  geannuleerd: 'bg-gray-100 text-gray-500',
}

const emptyForm = () => ({
  naam: '', klantnummer: '', klant_type: 'prive' as 'prive'|'zakelijk',
  bedrijf: '', straat: '', huisnummer: '', postcode: '', stad: '',
  btw_nummer: '', kvk_nummer: '',
  email: '', telefoon: '',
  betalingstermijn: '' as string | number,
  notities: '',
})

// Bruto-totaal van een bestelling op basis van de regels (aantal × prijs × (1 + btw%)).
const orderBruto = (b: any): number => (b.regels || []).reduce(
  (s: number, r: any) => s + (r.aantal || 0) * (r.prijs_per_stuk || 0) * (1 + (r.btw_pct || 0) / 100), 0)

const KlantenPage: React.FC<Props> = ({
  klanten, setKlanten, bestellingen, setBestellingen, verkoopFacturen,
  breweryDetails, smtpCreds, factuurLogo=null, logo=null, appName='',
  setPage, setOpenOrderId, auditLog, setAuditLog,
}) => {
  const [view, setView] = React.useState<'list'|'detail'>('list')
  const [selectedId, setSelectedId] = React.useState<number|null>(null)
  // Synthetische-source-key: als de gebruiker via een "Uit bestelling"-rij in
  // de lijst is binnengekomen, onthouden we welke synth-groep dat was. Bij
  // opslaan koppelen we de bestellingen uit die groep — óók als de gebruiker
  // het e-mailadres in het formulier intussen heeft aangepast (bv. typo
  // gecorrigeerd). Zonder deze key zou de auto-koppel-logica naar het nieuwe
  // adres zoeken, niets vinden, en de synth-rij naast de nieuwe klantkaart
  // laten staan.
  const [synthSourceKey, setSynthSourceKey] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [form, setForm] = React.useState(emptyForm())
  const [dirty, setDirty] = React.useState(false)
  const [mailModal, setMailModal] = React.useState<null | {to:string,subject:string,text:string}>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  // Per-klant statistieken (omzet, openstaand, # bestellingen, laatste datum).
  // Match via klant_id, en als fallback via case-insensitive email-match — zo
  // worden ook losse WC-orders met klant_email maar zonder klant_id geteld.
  // Geannuleerde bestellingen tellen niet mee voor de omzet.
  const statsPerKlant = React.useMemo(() => {
    const map: Record<number, {bestellingen: any[], facturen: any[], omzet: number, openstaand: number, laatsteDatum: string}> = {}
    klanten.forEach(k => {
      const emailLc = (k.email || '').toLowerCase()
      const matchOrder = (b: any) => b.klant_id === k.id
        || (emailLc && b.klant_email && b.klant_email.toLowerCase() === emailLc)
      const matchFactuur = (f: any) => f.klant_id === k.id
      const bestellingenK = bestellingen.filter(matchOrder)
      const facturenK = verkoopFacturen.filter(matchFactuur)
      const omzet = facturenK.reduce((s: number, f: any) => s + (f.bruto || 0), 0)
        + bestellingenK
            .filter((b: any) => b.status !== 'geannuleerd'
              && !facturenK.some((f: any) => f.bestelling_id === b.id))
            .reduce((s: number, b: any) => s + orderBruto(b), 0)
      const openstaand = facturenK
        .filter((f: any) => f.status !== 'betaald' && f.status !== 'credit')
        .reduce((s: number, f: any) => s + (f.bruto || 0), 0)
      const laatsteDatum = bestellingenK.reduce((d: string, b: any) =>
        (b.datum || '') > d ? b.datum : d, '')
      map[k.id] = {bestellingen: bestellingenK, facturen: facturenK, omzet, openstaand, laatsteDatum}
    })
    return map
  }, [klanten, bestellingen, verkoopFacturen])

  // Synthetische klantkaarten uit bestellingen die nog niet aan een
  // klantkaart gekoppeld zijn. Worden gegroepeerd op e-mail (of, als die er
  // niet is, op naam) — zo verschijnt een gloednieuwe WC-bestelling met
  // klant_email maar zonder klant_id automatisch als "Nog niet opgeslagen"
  // entry in de Klanten-lijst, en kan de gebruiker met één klik een echte
  // klantkaart aanmaken.
  const syntheticKlanten = React.useMemo(() => {
    const realIds = new Set(klanten.map((k: any) => k.id))
    const realEmails = new Set(
      klanten.map((k: any) => (k.email || '').toLowerCase()).filter(Boolean)
    )
    const groups = new Map<string, any>()
    bestellingen.forEach((b: any) => {
      // Reeds gekoppeld aan een bestaande klantkaart? Overslaan.
      if (b.klant_id != null && realIds.has(b.klant_id)) return
      const emailLc = (b.klant_email || '').toLowerCase()
      if (emailLc && realEmails.has(emailLc)) return
      const key = emailLc || (b.klant_naam || '').trim().toLowerCase()
      if (!key) return
      if (!groups.has(key)) {
        groups.set(key, {
          _synthetic: true,
          id: `synth:${key}`,
          _synthKey: key,
          naam: b.klant_naam || '',
          bedrijf: b.klant_bedrijf || '',
          email: b.klant_email || '',
          straat: b.klant_straat || '',
          huisnummer: b.klant_huisnummer || '',
          postcode: b.klant_postcode || '',
          stad: b.klant_stad || '',
          klant_type: b.klant_type || (b.klant_bedrijf ? 'zakelijk' : 'prive'),
          _matchedOrders: [] as any[],
        })
      }
      groups.get(key)._matchedOrders.push(b)
    })
    return Array.from(groups.values()).map((s: any) => {
      const omzet = s._matchedOrders
        .filter((b: any) => b.status !== 'geannuleerd')
        .reduce((sum: number, b: any) => sum + orderBruto(b), 0)
      const laatsteDatum = s._matchedOrders.reduce((d: string, b: any) =>
        (b.datum || '') > d ? b.datum : d, '')
      return {...s, _stats: {bestellingen: s._matchedOrders, facturen: [], omzet, openstaand: 0, laatsteDatum}}
    })
  }, [klanten, bestellingen])

  // Filtered/sorted klanten voor de lijstweergave (echt + synthetisch).
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = [...klanten, ...syntheticKlanten]
    const list = q ? all.filter((k: any) =>
      (k.naam || '').toLowerCase().includes(q)
      || (k.bedrijf || '').toLowerCase().includes(q)
      || (k.email || '').toLowerCase().includes(q)
      || (k.telefoon || '').toLowerCase().includes(q)
      || (k.klantnummer || '').toLowerCase().includes(q)
    ) : all
    const omzetVan = (k: any) =>
      k._synthetic ? (k._stats?.omzet || 0) : (statsPerKlant[k.id]?.omzet ?? 0)
    return [...list].sort((a: any, b: any) => {
      // Synthetisch onderaan, echt eerst
      if (!!a._synthetic !== !!b._synthetic) return a._synthetic ? 1 : -1
      const so = omzetVan(b), sa = omzetVan(a)
      if (so !== sa) return so - sa
      return (a.naam || '').localeCompare(b.naam || '')
    })
  }, [klanten, syntheticKlanten, search, statsPerKlant])

  const selected = selectedId !== null ? klanten.find((k: any) => k.id === selectedId) : null
  const selectedStats = selectedId !== null ? statsPerKlant[selectedId] : null

  const openDetail = (k: any) => {
    setSelectedId(k.id)
    setSynthSourceKey(null)
    setForm({
      naam: k.naam || '', klantnummer: k.klantnummer || '',
      klant_type: k.klant_type || (k.bedrijf ? 'zakelijk' : 'prive'),
      bedrijf: k.bedrijf || '', straat: k.straat || '', huisnummer: k.huisnummer || '',
      postcode: k.postcode || '', stad: k.stad || '',
      btw_nummer: k.btw_nummer || '', kvk_nummer: k.kvk_nummer || '',
      email: k.email || '', telefoon: k.telefoon || '',
      betalingstermijn: k.betalingstermijn ?? '',
      notities: k.notities || '',
    })
    setDirty(false)
    setView('detail')
  }

  const openNew = () => {
    setSelectedId(null)
    setSynthSourceKey(null)
    setForm(emptyForm())
    setDirty(true)
    setView('detail')
  }

  // Maak klantkaart aan uit een synthetische entry (bestelling zonder
  // klantkaart) — formuliervelden komen uit de bestelling.
  const openNewFromSynth = (synth: any) => {
    setSelectedId(null)
    setSynthSourceKey(synth._synthKey)
    setForm({
      naam: synth.naam || '',
      klantnummer: '',
      klant_type: synth.klant_type || 'prive',
      bedrijf: synth.bedrijf || '',
      straat: synth.straat || '',
      huisnummer: synth.huisnummer || '',
      postcode: synth.postcode || '',
      stad: synth.stad || '',
      btw_nummer: '',
      kvk_nummer: '',
      email: synth.email || '',
      telefoon: '',
      betalingstermijn: '',
      notities: '',
    })
    setDirty(true)
    setView('detail')
  }

  const goBack = () => {
    if (dirty && !confirm(t('klanten_unsaved_confirm'))) return
    setView('list')
    setSelectedId(null)
    setSynthSourceKey(null)
    setDirty(false)
  }

  const update = (patch: any) => { setForm((f: any) => ({...f, ...patch})); setDirty(true) }

  const save = () => {
    if (!form.naam.trim()) { alert(t('klanten_err_no_name')); return }
    const payload: any = {
      naam: form.naam.trim(),
      klantnummer: form.klantnummer.trim() || undefined,
      klant_type: form.klant_type,
      bedrijf: form.bedrijf.trim() || undefined,
      straat: form.straat.trim() || undefined,
      huisnummer: form.huisnummer.trim() || undefined,
      postcode: form.postcode.trim() || undefined,
      stad: form.stad.trim() || undefined,
      btw_nummer: form.btw_nummer.trim() || undefined,
      kvk_nummer: form.kvk_nummer.trim() || undefined,
      email: form.email.trim() || undefined,
      telefoon: form.telefoon.trim() || undefined,
      betalingstermijn: form.betalingstermijn === '' ? undefined : Number(form.betalingstermijn),
      notities: form.notities.trim() || undefined,
    }
    // Strip undefined-keys
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

    let savedKlantId: number
    let oldEmail = ''
    if (selectedId !== null) {
      oldEmail = (selected?.email || '')
      setKlanten((prev: any[]) => prev.map((k: any) => k.id === selectedId ? {...k, ...payload} : k))
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'gewijzigd', omschrijving:payload.naam})
      savedKlantId = selectedId
    } else {
      savedKlantId = newId(klanten || [])
      setKlanten((prev: any[]) => [...(prev||[]), {id: savedKlantId, ...payload}])
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:savedKlantId, actie:'aangemaakt', omschrijving:payload.naam})
      setSelectedId(savedKlantId)
    }

    // Auto-koppel ongekoppelde bestellingen aan deze klant. Drie matching-
    // strategieën — alle drie zijn nodig om edge-cases af te dekken:
    //
    //   1. Synth-source-key: als de gebruiker via "Uit bestelling" is
    //      binnengekomen, koppel exact die bestellingen — onafhankelijk
    //      van wat de gebruiker met het e-mailveld doet. Dit fixt: e-mail
    //      typo corrigeren maakte tot nu een nieuwe klant naast de
    //      bestaande synth-rij.
    //
    //   2. Nieuwe e-mail: koppel ook bestellingen die exact het zojuist
    //      opgeslagen adres hebben (handig bij handmatig aanmaken zonder
    //      synth-flow).
    //
    //   3. Oude e-mail (bij bewerken bestaande klant): bestellingen die
    //      via email-fallback aan deze klant gematcht waren, krijgen nu
    //      hun klant_id zodat ze niet als "ongekoppeld" achterblijven
    //      wanneer de gebruiker het e-mailadres aanpast.
    const newEmailLc = (payload.email || '').toLowerCase()
    const oldEmailLc = oldEmail.toLowerCase()
    const toLink = bestellingen.filter((b: any) => {
      if (b.klant_id != null) return false
      const beLc = (b.klant_email || '').toLowerCase()
      const beNameKey = (b.klant_naam || '').trim().toLowerCase()
      if (newEmailLc && beLc === newEmailLc) return true
      if (oldEmailLc && oldEmailLc !== newEmailLc && beLc === oldEmailLc) return true
      if (synthSourceKey && (beLc || beNameKey) === synthSourceKey) return true
      return false
    })
    if (toLink.length > 0) {
      const ids = new Set(toLink.map((b: any) => b.id))
      setBestellingen((prev: any[]) => prev.map((b: any) =>
        ids.has(b.id) ? {...b, klant_id: savedKlantId} : b
      ))
      logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:savedKlantId, actie:'gewijzigd',
        omschrijving:`${toLink.length} bestelling(en) automatisch gekoppeld`})
    }
    setSynthSourceKey(null)
    setDirty(false)
  }

  const deleteKlant = () => {
    if (selectedId === null) return
    const naam = selected?.naam || ''
    setKlanten((prev: any[]) => prev.filter((k: any) => k.id !== selectedId))
    logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'verwijderd', omschrijving:naam})
    setShowDeleteConfirm(false)
    setView('list')
    setSelectedId(null)
  }

  // Koppel losse WC-orders die op e-mail matchen aan deze klant (klant_id zetten).
  const koppelOrdersOpEmail = () => {
    if (!selected?.email) return
    const emailLc = selected.email.toLowerCase()
    const toLink = bestellingen.filter((b: any) =>
      !b.klant_id && b.klant_email && b.klant_email.toLowerCase() === emailLc
    )
    if (toLink.length === 0) { alert(t('klanten_no_unlinked_orders')); return }
    if (!confirm(t('klanten_link_orders_confirm').replace('{n}', String(toLink.length)))) return
    const ids = new Set(toLink.map((b: any) => b.id))
    setBestellingen((prev: any[]) => prev.map((b: any) =>
      ids.has(b.id) ? {...b, klant_id: selected.id} : b
    ))
    logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selected.id, actie:'gewijzigd', omschrijving:`${toLink.length} bestelling(en) gekoppeld via e-mail`})
  }

  const mailKlant = () => {
    if (!selected?.email) { alert(t('mail_no_recipient')); return }
    setMailModal({
      to: selected.email,
      subject: '',
      text: `${t('lbl_dear')} ${selected.naam.split(' ')[0] || ''},\n\n\n\n${t('lbl_kind_regards')},\n${(breweryDetails as any)?.naam || appName || ''}`,
    })
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (view === 'detail') {
    const emailValid = !form.email || EMAIL_RE.test(form.email.trim())
    // Bij bestaande klant: gebruik de opgeslagen e-mail (klanten zonder e-mail
    // hebben geen orders om te koppelen). Bij een nieuwe klant: kijk in het
    // formulier — zo ziet de gebruiker direct hoeveel orders straks gekoppeld
    // worden op opslaan.
    const checkEmail = (selectedId !== null ? selected?.email : form.email.trim()) || ''
    const ongekoppeldeOrders = checkEmail
      ? bestellingen.filter((b: any) => !b.klant_id && b.klant_email
          && b.klant_email.toLowerCase() === checkEmail.toLowerCase()).length
      : 0

    return (
      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={goBack}
            className="flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 transition-colors">
            {t('btn_back')}
          </button>
          <h2 className="text-xl font-bold text-gray-800">
            {selectedId !== null ? (selected?.naam || t('lbl_naamloos')) : t('klanten_new')}
          </h2>
          {form.klant_type && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${form.klant_type === 'zakelijk' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {t(form.klant_type === 'zakelijk' ? 'lbl_zakelijk' : 'lbl_prive')}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {selectedId !== null && (
              <Btn v="secondary" onClick={mailKlant} disabled={!smtpCreds?.enabled || !form.email || !emailValid}
                title={!smtpCreds?.enabled ? t('mail_no_smtp') : (!form.email ? t('mail_no_recipient') : '')}>
                ✉ {t('klanten_mail_klant')}
              </Btn>
            )}
            <Btn onClick={save} disabled={!dirty || !form.naam.trim()}>
              {t('btn_save')}
            </Btn>
            {selectedId !== null && (
              <Btn v="danger" onClick={() => setShowDeleteConfirm(true)}>
                {t('btn_delete')}
              </Btn>
            )}
          </div>
        </div>

        {/* Stats-cards */}
        {selectedStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{selectedStats.bestellingen.length}</div>
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_orders')}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{fmt(selectedStats.omzet)}</div>
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_omzet')}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className={`text-2xl font-bold ${selectedStats.openstaand > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                {selectedStats.openstaand > 0 ? fmt(selectedStats.openstaand) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_openstaand')}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
              <div className="text-base font-semibold text-gray-800">
                {selectedStats.laatsteDatum ? fmtD(selectedStats.laatsteDatum) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_last_order')}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Klantgegevens */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <SectionHeader title={t('klanten_section_details')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Inp label={t('lbl_name') + ' *'} value={form.naam} onChange={v => update({naam: v})} />
              <Inp label={t('klanten_klantnummer')} value={form.klantnummer} onChange={v => update({klantnummer: v})} placeholder="K-001" />
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('klanten_type')}</label>
                <select value={form.klant_type}
                  onChange={(e: any) => update({klant_type: e.target.value})}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none">
                  <option value="prive">{t('lbl_prive')}</option>
                  <option value="zakelijk">{t('lbl_zakelijk')}</option>
                </select>
              </div>
              <Inp label={t('klanten_bedrijf')} value={form.bedrijf} onChange={v => update({bedrijf: v})} />
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_email')}</label>
                <input type="email" value={form.email} onChange={(e: any) => update({email: e.target.value})}
                  placeholder="naam@example.com"
                  className={`w-full border rounded-lg px-3 py-2 text-sm bg-white t-input outline-none transition-all ${
                    form.email && !emailValid ? 'border-red-300 bg-red-50' : 'border-gray-200'
                  }`} />
                {form.email && !emailValid && (
                  <p className="mt-1 text-xs text-red-600">{t('klanten_email_invalid')}</p>
                )}
              </div>
              <Inp label={t('lbl_telefoon')} value={form.telefoon} onChange={v => update({telefoon: v})} />
              <Inp label={t('settings_betalingstermijn')} type="number" value={form.betalingstermijn} onChange={v => update({betalingstermijn: v})} placeholder="14" />
            </div>
          </div>

          {/* Adres + zakelijk */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <SectionHeader title={t('klanten_section_address')} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Inp label={t('lbl_straat')} value={form.straat} onChange={v => update({straat: v})} cls="sm:col-span-2" />
              <Inp label={t('lbl_huisnummer')} value={form.huisnummer} onChange={v => update({huisnummer: v})} />
              <Inp label={t('lbl_postcode')} value={form.postcode} onChange={v => update({postcode: v})} />
              <Inp label={t('lbl_stad')} value={form.stad} onChange={v => update({stad: v})} cls="sm:col-span-2" />
              <Inp label={t('lbl_btw_nr')} value={form.btw_nummer} onChange={v => update({btw_nummer: v})} cls="sm:col-span-2" />
              <Inp label={t('lbl_kvk')} value={form.kvk_nummer} onChange={v => update({kvk_nummer: v})} />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('klanten_notities')}</label>
              <textarea value={form.notities} onChange={(e: any) => update({notities: e.target.value})} rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white t-input outline-none" />
            </div>
          </div>
        </div>

        {/* Koppel-melding voor ongekoppelde orders */}
        {ongekoppeldeOrders > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center justify-between gap-3 flex-wrap">
            <div>
              {selectedId !== null
                ? t('klanten_unlinked_hint').replace('{n}', String(ongekoppeldeOrders))
                : t('klanten_unlinked_hint_new').replace('{n}', String(ongekoppeldeOrders))}
            </div>
            {selectedId !== null && (
              <Btn v="blue" onClick={koppelOrdersOpEmail}>{t('klanten_link_orders_btn')}</Btn>
            )}
          </div>
        )}

        {/* Bestellingen + facturen */}
        {selectedId !== null && selectedStats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <SectionHeader title={`${t('nav_bestellingen')} (${selectedStats.bestellingen.length})`} />
              {selectedStats.bestellingen.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">{t('klanten_no_orders')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 bg-gray-50 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                        <th className="px-3 py-2 text-left">{t('factuur_number')}</th>
                        <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                        <th className="px-3 py-2 text-right">{t('lbl_bruto')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...selectedStats.bestellingen]
                        .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))
                        .map((b: any) => {
                          const totaal = (b.regels || []).reduce(
                            (s: number, r: any) => s + (r.aantal || 0) * (r.prijs_per_stuk || 0) * (1 + (r.btw_pct || 0) / 100), 0)
                          return (
                            <tr key={b.id} className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => { setOpenOrderId(b.id); setPage('bestellingen') }}>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtD(b.datum)}</td>
                              <td className="px-3 py-2 font-mono text-xs text-gray-700">
                                {b.wc_order_nummer ? `WC-${b.wc_order_nummer}` : `M-${b.id}`}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[b.status] || 'bg-gray-100'}`}>
                                  {t(`orders_status_${b.status}`) || b.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{fmt(totaal)}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <SectionHeader title={`${t('tab_verkoop')} (${selectedStats.facturen.length})`} />
              {selectedStats.facturen.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">{t('msg_no_verkoopfacturen')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 bg-gray-50 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left">{t('lbl_date')}</th>
                        <th className="px-3 py-2 text-left">{t('factuur_number')}</th>
                        <th className="px-3 py-2 text-left">{t('lbl_status')}</th>
                        <th className="px-3 py-2 text-right">{t('lbl_bruto')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...selectedStats.facturen]
                        .sort((a: any, b: any) => (b.datum || '').localeCompare(a.datum || ''))
                        .map((f: any) => (
                          <tr key={f.id}>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtD(f.datum)}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700">{f.factuurnummer || '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                f.status === 'betaald' ? 'bg-green-100 text-green-700'
                                : f.status === 'aanmaning' ? 'bg-red-100 text-red-700'
                                : f.status === 'credit' ? 'bg-purple-100 text-purple-700'
                                : 'bg-orange-100 text-orange-700'
                              }`}>
                                {t(`factuur_${f.status}`) || f.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{fmt(f.bruto || 0)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5">
              <h3 className="font-semibold text-gray-800 mb-3">{t('klanten_delete_title')}</h3>
              <p className="text-sm text-gray-600 mb-4">{t('klanten_delete_confirm').replace('{naam}', selected?.naam || '')}</p>
              <div className="flex justify-end gap-2">
                <Btn v="secondary" onClick={() => setShowDeleteConfirm(false)}>{t('btn_cancel')}</Btn>
                <Btn v="danger" onClick={deleteKlant}>{t('btn_delete')}</Btn>
              </div>
            </div>
          </div>
        )}

        {mailModal && (
          <MailModal
            title={t('klanten_mail_klant')}
            initialTo={mailModal.to}
            initialSubject={mailModal.subject}
            initialText={mailModal.text}
            brewery={breweryDetails}
            logoDataUri={factuurLogo || logo}
            replyTo={(breweryDetails as any)?.email}
            smtpReady={!!smtpCreds?.enabled}
            onClose={() => setMailModal(null)}
            onSent={() => {
              if (selectedId !== null) {
                logAudit(auditLog, setAuditLog, {entiteit:'Klant', entiteit_id:selectedId, actie:'gewijzigd', omschrijving:`Mail verstuurd aan ${selected?.email}`})
              }
            }}
          />
        )}
      </div>
    )
  }

  // ── LIJSTWEERGAVE ─────────────────────────────────────────────────────────

  const totaalOmzet = klanten.reduce((s: number, k: any) => s + (statsPerKlant[k.id]?.omzet || 0), 0)
    + syntheticKlanten.reduce((s: number, k: any) => s + (k._stats?.omzet || 0), 0)
  const totaalOpenstaand = klanten.reduce((s: number, k: any) => s + (statsPerKlant[k.id]?.openstaand || 0), 0)
  const synthCount = syntheticKlanten.length

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-800">{t('nav_klanten')}</h2>
        <Btn onClick={openNew}>+ {t('klanten_new')}</Btn>
      </div>

      {synthCount > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2 flex-wrap">
          <span>ℹ</span>
          <span>{t('klanten_synth_explainer').replace('{n}', String(synthCount))}</span>
        </div>
      )}

      {/* Stats-overzicht */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-800">{klanten.length}{synthCount > 0 && <span className="text-base text-blue-600 ml-1">+{synthCount}</span>}</div>
          <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_totaal')}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{fmt(totaalOmzet)}</div>
          <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_omzet_totaal')}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <div className={`text-2xl font-bold ${totaalOpenstaand > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
            {totaalOpenstaand > 0 ? fmt(totaalOpenstaand) : '—'}
          </div>
          <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{t('klanten_stat_openstaand_totaal')}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card p-4 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t('klanten_search_placeholder')} />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-card p-10 text-center text-sm text-gray-400">
          {klanten.length === 0 ? t('klanten_empty_state') : t('klanten_no_search_results')}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="text-xs text-gray-500 bg-gray-50 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">{t('lbl_name')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('lbl_email')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('lbl_telefoon')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('klanten_stat_orders')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('klanten_stat_omzet')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('klanten_stat_openstaand')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('klanten_stat_last_order')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((k: any) => {
                  const isSynth = !!k._synthetic
                  const s = isSynth
                    ? k._stats
                    : (statsPerKlant[k.id] || {bestellingen: [], omzet: 0, openstaand: 0, laatsteDatum: ''})
                  return (
                    <tr key={k.id} className={`hover:bg-gray-50 cursor-pointer transition-colors ${isSynth ? 'bg-blue-50/30' : ''}`}
                      onClick={() => isSynth ? openNewFromSynth(k) : openDetail(k)}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-800 flex items-center gap-2 flex-wrap">
                          {s.openstaand > 0 && (
                            <span className="inline-block w-2 h-2 bg-orange-500 rounded-full"
                              title={t('tooltip_expired_invoices')}/>
                          )}
                          <span className={isSynth ? 'italic text-gray-600' : ''}>
                            {k.naam || t('lbl_naamloos')}
                          </span>
                          {isSynth && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 uppercase tracking-wide">
                              {t('klanten_synth_badge')}
                            </span>
                          )}
                        </div>
                        {k.bedrijf && <div className="text-xs text-gray-500 mt-0.5">{k.bedrijf}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{k.email || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{k.telefoon || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{s.bestellingen.length || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-green-700">
                        {s.omzet > 0 ? fmt(s.omzet) : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium ${s.openstaand > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                        {s.openstaand > 0 ? fmt(s.openstaand) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-500 text-xs whitespace-nowrap">
                        {s.laatsteDatum ? fmtD(s.laatsteDatum) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default KlantenPage
