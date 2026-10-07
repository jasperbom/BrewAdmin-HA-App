import React from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import Icon from './ui/Icon'
import RowActions from './ui/RowActions'
import type { RowActie } from './ui/RowActions'
import SectionHeader from './ui/SectionHeader'
import { useUndo } from './ui/UndoBar'
import { ADDON_BASE, _wachtOpVerzending, inboxOphalen, inboxStatus } from '../utils/api'
import { fmtD } from '../utils/format'
import {
  InboxFout, InkoopInboxItem, InkoopInboxStatus, inboxAfgehandeld, inboxAfzender, inboxFoutSleutel,
  inboxFoutVraagtInstellingen, inboxGenegeerd, inboxGrootteTekst, inboxOpen, inboxRedenSleutel,
  inboxTerugzetten, inboxVerwijder,
} from '../utils/inkoopInbox'

// Administratie → Facturen → Inkoop → "Ontvangen per e-mail": de PDF-facturen die de server uit het
// postvak heeft gehaald (`_inbox_tick` in server.py) en die op verwerking
// wachten. Verwerken = de factuur openen, scannen en boeken via het gewone
// inkoopformulier; dat opent de pagina zelf (`onVerwerk`). Hier alleen de
// wachtrij: bekijken, negeren, terugzetten en het opruimen van wat genegeerd is.

interface InkoopInboxProps {
  /** `inkoop_inbox` zoals de store hem geeft. */
  items: unknown
  setItems: (waarde: (prev: any) => any) => void
  /** Staat de koppeling aan én is hij ingevuld? Alleen dan is er iets op te halen. */
  actief: boolean
  onVerwerk: (item: InkoopInboxItem) => void
  /** Na een ophaalronde: de lijst opnieuw van de server halen. */
  vernieuw: () => Promise<unknown>
  onNaarInstellingen?: () => void
  /** Legt een handeling vast in het auditlogboek van de app. */
  onAudit?: (omschrijving: string, id: number, actie: 'gewijzigd' | 'verwijderd') => void
  /** Wat er staat als er niets in te stellen, te doen of te tonen is (standaard niets). */
  leeg?: React.ReactNode
}

// Genoeg om terug te kijken; de rest blijft in de lijst staan maar niet in beeld.
const AFGEHANDELD_MAX = 25

const tijdTekst = (iso: string | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const bestandUrl = (i: InkoopInboxItem): string => `${ADDON_BASE}api/file/${i.bijlage.bestand}`

export default function InkoopInbox({ items, setItems, actief, onVerwerk, vernieuw, onNaarInstellingen, onAudit, leeg = null }: InkoopInboxProps) {
  const undo = useUndo()
  const open = React.useMemo(() => inboxOpen(items), [items])
  const afgehandeld = React.useMemo(() => inboxAfgehandeld(items), [items])
  const [status, setStatus] = React.useState<InkoopInboxStatus>({})
  const [bezig, setBezig] = React.useState(false)
  // Uitkomst van "Nu ophalen": bij een mislukking de fout zelf, zodat de melding ook de link
  // naar de instellingen kan tonen wanneer die het probleem oplost.
  const [melding, setMelding] = React.useState<{ ok: boolean, tekst: string, fout?: InboxFout | null } | null>(null)
  const [toonAfgehandeld, setToonAfgehandeld] = React.useState(false)
  const [toonOvergeslagen, setToonOvergeslagen] = React.useState(false)

  const laadStatus = React.useCallback(() => { inboxStatus().then(setStatus) }, [])
  React.useEffect(() => {
    laadStatus()
    if (!actief) return
    const id = window.setInterval(laadStatus, 60_000)
    return () => window.clearInterval(id)
  }, [laadStatus, actief])

  const overgeslagen = status.overgeslagen || []
  // Een oude fout van een koppeling die intussen uit staat hoort niet te blijven zeuren.
  const fout = actief ? status.fout : null
  // Eén foutmelding tegelijk: die van de laatste handmatige ronde gaat voor die van de server.
  const getoondeFout: InboxFout | null | undefined = melding ? (melding.ok ? null : melding.fout) : fout

  // Niets in te stellen, niets te doen, niets te tonen: de tab blijft schoon
  // (of de pagina geeft een lege staat mee, als het postvak het hele scherm is).
  if (!actief && open.length === 0 && afgehandeld.length === 0 && overgeslagen.length === 0) return <>{leeg}</>

  const ophalen = async () => {
    setBezig(true); setMelding(null)
    const d = await inboxOphalen()
    await vernieuw()
    laadStatus()
    setBezig(false)
    setMelding(d?.ok
      ? { ok: true, tekst: t('inbox_ophalen_klaar').replace('{nieuw}', String(d.nieuw ?? 0)) }
      : { ok: false, tekst: t(inboxFoutSleutel(d?.fout)), fout: d?.fout })
  }

  const nu = () => new Date().toISOString()

  const negeer = (i: InkoopInboxItem) => {
    undo.plan(`inbox-negeer-${i.id}`, t('inbox_negeer_label').replace('{naam}', i.bijlage.naam), () => {
      setItems(prev => inboxGenegeerd(prev || [], i.id, nu()))
      onAudit?.(`"${i.bijlage.naam}" genegeerd`, i.id, 'gewijzigd')
    })
  }

  const zetTerug = (i: InkoopInboxItem) => {
    setItems(prev => inboxTerugzetten(prev || [], i.id))
    onAudit?.(`"${i.bijlage.naam}" teruggezet`, i.id, 'gewijzigd')
  }

  const verwijder = (i: InkoopInboxItem) => {
    undo.plan(`inbox-verwijder-${i.id}`, t('inbox_verwijder_label').replace('{naam}', i.bijlage.naam), async () => {
      setItems(prev => inboxVerwijder(prev || [], i.id))
      onAudit?.(`"${i.bijlage.naam}" verwijderd`, i.id, 'verwijderd')
      // De server weigert een bijlage waar nog een record naar wijst; dus pas
      // weghalen zodra het verwijderen van het item daar is aangekomen.
      await new Promise(r => setTimeout(r, 1500))
      await _wachtOpVerzending()
      fetch(`${ADDON_BASE}api/delete_upload/${i.bijlage.bestand}`, { method: 'POST', body: '{}' }).catch(() => {})
    })
  }

  const bekijk: (i: InkoopInboxItem) => RowActie = i => ({
    id: 'bekijk', label: t('inbox_bekijk'), onClick: () => { window.open(bestandUrl(i), '_blank', 'noopener') },
  })

  const rij = (i: InkoopInboxItem) => {
    const groottetekst = inboxGrootteTekst(i.grootte)
    const afzender = inboxAfzender(i)
    let primair: RowActie
    let acties: RowActie[]
    if (i.status === 'nieuw') {
      primair = { id: 'verwerk', label: t('inbox_verwerk'), title: t('inbox_verwerk_titel'), onClick: () => onVerwerk(i) }
      acties = [bekijk(i), { id: 'negeer', label: t('inbox_negeer'), onClick: () => negeer(i) }]
    } else if (i.status === 'genegeerd') {
      primair = { id: 'terug', label: t('inbox_zet_terug'), onClick: () => zetTerug(i) }
      acties = [bekijk(i), { id: 'verwijder', label: t('inbox_verwijder'), soort: 'gevaar', onClick: () => verwijder(i) }]
    } else {
      primair = bekijk(i)
      acties = []
    }
    return (
      <li key={i.id} className="px-4 py-3 flex items-start gap-3">
        <span className="mt-0.5 text-gray-400 flex-shrink-0"><Icon n="file" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800 break-words sm:truncate">
            {i.bijlage.naam}
            {groottetekst && <span className="ml-2 text-xs font-normal text-gray-400">{groottetekst}</span>}
          </div>
          <div className="text-xs text-gray-600 break-words sm:truncate">
            {[afzender, i.onderwerp].filter(Boolean).join(' — ')}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {t('inbox_ontvangen_op').replace('{datum}', fmtD(i.mail_datum || i.ontvangen))}
            {i.status !== 'nieuw' && (
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${i.status === 'verwerkt' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {t(i.status === 'verwerkt' ? 'inbox_status_verwerkt' : 'inbox_status_genegeerd')}
              </span>
            )}
          </div>
        </div>
        <RowActions primair={primair} acties={acties} cls="flex-shrink-0" />
      </li>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <SectionHeader
        title={t('inbox_titel')}
        info={open.length > 0
          ? <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-semibold">
              {t('inbox_te_verwerken').replace('{n}', String(open.length))}
            </span>
          : undefined}
      />

      {(actief || getoondeFout || melding) && (
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {actief && (
            <>
              <Btn v="secondary" s="sm" onClick={ophalen} disabled={bezig}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon n="refresh" /> {bezig ? t('inbox_ophalen_bezig') : t('inbox_ophalen')}
                </span>
              </Btn>
              <span>
                {status.laatste_check
                  ? t('inbox_laatste_check').replace('{tijd}', tijdTekst(status.laatste_check))
                  : t('inbox_nog_niet')}
              </span>
            </>
          )}
          {melding?.ok && <span className="font-medium text-green-700">✓ {melding.tekst}</span>}
          {getoondeFout && (
            <span className="font-medium text-red-600">
              ⚠ {t(inboxFoutSleutel(getoondeFout))}
              {inboxFoutVraagtInstellingen(getoondeFout) && onNaarInstellingen && (
                <button type="button" onClick={onNaarInstellingen}
                  className="ml-2 underline t-accent-text font-medium">{t('inbox_naar_instellingen')}</button>
              )}
            </span>
          )}
        </div>
      )}

      {open.length > 0
        ? <ul className="divide-y divide-gray-100">{open.map(rij)}</ul>
        : <p className="px-4 py-4 text-sm text-gray-500">{t('inbox_leeg')}</p>}

      {afgehandeld.length > 0 && (
        <div className="border-t border-gray-100">
          <SectionHeader title={t('inbox_afgehandeld').replace('{n}', String(afgehandeld.length))}
            open={toonAfgehandeld} onToggle={() => setToonAfgehandeld(v => !v)} />
          {toonAfgehandeld && <ul className="divide-y divide-gray-100">{afgehandeld.slice(0, AFGEHANDELD_MAX).map(rij)}</ul>}
        </div>
      )}

      {overgeslagen.length > 0 && (
        <div className="border-t border-gray-100">
          <SectionHeader title={t('inbox_overgeslagen').replace('{n}', String(overgeslagen.length))}
            open={toonOvergeslagen} onToggle={() => setToonOvergeslagen(v => !v)} />
          {toonOvergeslagen && (
            <div>
              <p className="px-4 pt-2 text-xs text-gray-400">{t('inbox_overgeslagen_hint')}</p>
              <ul className="divide-y divide-gray-100">
                {overgeslagen.map((o, n) => (
                  <li key={`${o.ts}-${n}`} className="px-4 py-2 text-xs">
                    <div className="text-gray-700 truncate">{[o.van, o.onderwerp, o.naam].filter(Boolean).join(' — ') || '—'}</div>
                    <div className="text-gray-400">{t(inboxRedenSleutel(o.reden))} · {tijdTekst(o.ts)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
