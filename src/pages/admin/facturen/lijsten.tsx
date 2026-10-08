import React from 'react'
import { t } from '../../../i18n'
import { ADDON_BASE } from '../../../utils/api'
import { dagNotatie } from '../../../utils/periode'
import { inkoopCenten, verkoopCenten } from '../../../utils/factuurFilter'
import type { InkoopStand, VerkoopStand, VerlegdInfo } from '../../../utils/factuurTijdlijn'
import type { LijstKolom } from '../../../components/ui/ResponsiveLijst'
import type { DetailKnop } from './DetailKnoppen'
import { fmt } from '../adminContext'
import { InkoopPil, RolloverBadge, VerkoopPil, VerrekendBadge, VerlegdBadge } from './FactuurPil'

// ── Kolommen en telefoonkaarten van de factuurlijsten ───────────────────────
// Bureau: nummer (met de datum eronder), relatie, status, netto en BTW (pas
// vanaf 1024 px), bruto en één handeling die bij de status past. Telefoon:
// een kaart met wie en hoeveel bovenaan, nummer · datum en de pil eronder —
// geen knoppen: de handelingen staan in het detail.

const datumTekst = (d: unknown): string => (typeof d === 'string' && d ? dagNotatie(d.slice(0, 10)) : '—')

/** De ene handeling in een rij: een kleine knop (of de bijlage als link). */
const RijKnop: React.FC<{ k: DetailKnop }> = ({ k }) => (
  <button type="button" onClick={k.onClick} disabled={k.disabled} title={k.title}
    className="px-2.5 py-1 rounded-md text-xs font-medium border bg-white hover:bg-gray-50 text-gray-700 border-gray-200 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
    {k.label}
  </button>
)

const NummerCel: React.FC<{ nummer: string, datum: unknown }> = ({ nummer, datum }) => (
  <span className="block">
    <span className="block font-mono text-xs text-gray-800">{nummer}</span>
    <span className="block text-xs text-gray-500 tabular-nums">{datumTekst(datum)}</span>
  </span>
)

const Kaart: React.FC<{ naam: string, bedrag: string, sub: string, pil: React.ReactNode }> = ({ naam, bedrag, sub, pil }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
    <span className="text-sm font-semibold text-gray-900 truncate">{naam}</span>
    <span className="text-sm font-bold text-gray-900 tabular-nums text-right">{bedrag}</span>
    <span className="text-xs text-gray-500 truncate">{sub}</span>
    <span className="text-right">{pil}</span>
  </div>
)

// ── Verkoop ─────────────────────────────────────────────────────────────────

export interface VerkoopLijstOpties {
  stand: (f: any) => VerkoopStand
  klantNaam: (f: any) => string
  altNaam: (id: unknown) => string | undefined
  rijActie: (f: any) => DetailKnop | null
  /** Smalle lijst (naast een open detail, onder 1024 px): geen statuskolom,
      de pil staat onder de naam. */
  statusOnderNaam?: boolean
}

// Naam die ook als één lang woord afbreekt (een smalle lijst naast het detail).
const NAAM = 'block min-w-0 font-medium text-gray-900 break-words [overflow-wrap:anywhere]'

export function verkoopKolommen(o: VerkoopLijstOpties): LijstKolom<any>[] {
  const status = (f: any) => {
    const s = o.stand(f)
    return (
      <span className="flex flex-wrap items-center gap-1">
        <VerkoopPil stand={s} />
        {s.verrekend && <VerrekendBadge naam={o.altNaam(f.verrekend_alt_id)} />}
        {f.btw_periode && <RolloverBadge periode={f.btw_periode} sleutel="fct_btw_telt_in" />}
      </span>
    )
  }
  return [
    { id: 'nummer', kop: t('fct_kol_nummer'), klasse: 'whitespace-nowrap', cel: f => <NummerCel nummer={f.factuurnummer || `F-${f.id}`} datum={f.datum} /> },
    {
      id: 'klant', kop: t('lbl_klant'), cel: f => o.statusOnderNaam ? (
        <span className="block min-w-0">
          <span className={NAAM}>{o.klantNaam(f) || '—'}</span>
          <span className="block mt-1">{status(f)}</span>
        </span>
      ) : <span className="font-medium text-gray-900 break-words">{o.klantNaam(f) || '—'}</span>,
    },
    ...(o.statusOnderNaam ? [] : [{ id: 'status', kop: t('lbl_status'), cel: status } as LijstKolom<any>]),
    { id: 'netto', kop: t('lbl_netto'), rechts: true, breed: true, klasse: 'whitespace-nowrap', cel: f => <span className="text-gray-700">{fmt(verkoopCenten(f).netto)}</span> },
    { id: 'btw', kop: t('lbl_btw'), rechts: true, breed: true, klasse: 'whitespace-nowrap', cel: f => <span className="text-gray-700">{fmt(verkoopCenten(f).btw)}</span> },
    { id: 'bruto', kop: t('lbl_bruto'), rechts: true, klasse: 'whitespace-nowrap', cel: f => <span className="font-semibold text-gray-900">{fmt(verkoopCenten(f).bruto)}</span> },
    {
      id: 'actie', kop: <span className="sr-only">{t('fct_kol_actie')}</span>, rechts: true, klasse: 'whitespace-nowrap w-px',
      cel: f => { const k = o.rijActie(f); return k ? <RijKnop k={k} /> : null },
    },
  ]
}

export const verkoopKaart = (o: VerkoopLijstOpties) => (f: any) => (
  <Kaart naam={o.klantNaam(f) || t('lbl_onbekend')} bedrag={fmt(verkoopCenten(f).bruto)}
    sub={`${f.factuurnummer || `F-${f.id}`} · ${datumTekst(f.datum)}`} pil={<VerkoopPil stand={o.stand(f)} />} />
)

// ── Inkoop ──────────────────────────────────────────────────────────────────

export interface InkoopLijstOpties {
  stand: (f: any) => InkoopStand
  verlegd: (f: any) => VerlegdInfo | null
  altNaam: (id: unknown) => string | undefined
  /** Open: markeer betaald; anders null (dan de bijlage als link, als die er is). */
  rijActie: (f: any) => DetailKnop | null
  /** Zie VerkoopLijstOpties. */
  statusOnderNaam?: boolean
}

export function inkoopKolommen(o: InkoopLijstOpties): LijstKolom<any>[] {
  const status = (f: any) => <InkoopPil stand={o.stand(f)} altNaam={o.altNaam(f.betaald_via_alt_id)} />
  return [
    { id: 'nummer', kop: t('fct_kol_nummer'), klasse: 'whitespace-nowrap', cel: f => <NummerCel nummer={f.factuurnummer || '—'} datum={f.datum} /> },
    {
      id: 'leverancier', kop: t('lbl_supplier'), cel: f => {
        const v = o.verlegd(f)
        return (
          <span className={`flex flex-wrap items-center gap-1 ${o.statusOnderNaam ? 'min-w-0' : ''}`}>
            <span className={o.statusOnderNaam ? `${NAAM} mr-1` : 'font-medium text-gray-900 break-words mr-1'}>{f.leverancier || '—'}</span>
            {v && <VerlegdBadge info={v} />}
            {f.btw_periode && <RolloverBadge periode={f.btw_periode} />}
            {o.statusOnderNaam && <span className="basis-full">{status(f)}</span>}
          </span>
        )
      },
    },
    ...(o.statusOnderNaam ? [] : [{ id: 'status', kop: t('lbl_status'), cel: status } as LijstKolom<any>]),
    { id: 'netto', kop: t('lbl_netto'), rechts: true, breed: true, klasse: 'whitespace-nowrap', cel: f => <span className="text-gray-700">{fmt(inkoopCenten(f).netto)}</span> },
    { id: 'btw', kop: t('lbl_btw'), rechts: true, breed: true, klasse: 'whitespace-nowrap', cel: f => <span className="text-gray-700">{fmt(inkoopCenten(f).btw)}</span> },
    { id: 'bruto', kop: t('lbl_bruto'), rechts: true, klasse: 'whitespace-nowrap', cel: f => <span className="font-semibold text-gray-900">{fmt(inkoopCenten(f).bruto)}</span> },
    {
      id: 'actie', kop: <span className="sr-only">{t('fct_kol_actie')}</span>, rechts: true, klasse: 'whitespace-nowrap w-px',
      cel: f => {
        const k = o.rijActie(f)
        if (k) return <RijKnop k={k} />
        if (!f.bijlage?.bestand) return null
        return (
          <a href={`${ADDON_BASE}api/file/${f.bijlage.bestand}`} target="_blank" rel="noopener noreferrer"
            title={f.bijlage.naam || t('fct_bijlage_openen')}
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border bg-white hover:bg-gray-50 text-gray-700 border-gray-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
            {t('fct_bijlage')}
          </a>
        )
      },
    },
  ]
}

export const inkoopKaart = (o: InkoopLijstOpties) => (f: any) => (
  <Kaart naam={f.leverancier || t('lbl_onbekend')} bedrag={fmt(inkoopCenten(f).bruto)}
    sub={`${f.factuurnummer || '—'} · ${datumTekst(f.datum)}`} pil={<InkoopPil stand={o.stand(f)} altNaam={o.altNaam(f.betaald_via_alt_id)} />} />
)
