import { t } from '../../../i18n'
import { fmtD } from '../../../utils/format'
import { periodeKeyLabel } from '../../../utils/btw'
import { koppelingVan, pspNaam, txKey } from '../../../utils/bank'
import { vulIn } from '../../../utils/periode'
import type { BankVoorstel } from '../../../utils/bankVoorstel'
import { fmt } from '../adminContext'

// ── Bank: wat er in de kolom "Koppeling of voorstel" staat ─────────────────
// De pure beslissing (wát het voorstel is, wáár een transactie aan hangt)
// staat in utils/bankVoorstel.ts en utils/bank.ts; hier wordt die leesbaar:
// "Verkoopfactuur 2026-0079 · Slijterij Hoekstra", "BTW Q2 2026".

/** De data waaruit de labels hun namen halen (uit de admin-context). */
export interface BankTekstData {
  verkoopFacturen: any[]
  inkoopFacturen: any[]
  kapitaalBoekingen: any[]
  altRekeningen: any[]
  bankKoppelingen: Record<string, any>
  klantNaamVoor: (f: any) => string
}

export const geldCent = (cent: number | undefined | null): string => fmt((Number(cent) || 0) / 100)

/** IBAN in groepjes van vier ("NL12 INGB 0001 2345 67"); zonder IBAN "Onbekend". */
export const ibanWeergave = (iban: string): string =>
  !iban || iban === 'onbekend' ? t('lbl_onbekend') : iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()

export function verkoopTitel(f: any, klantNaamVoor: (f: any) => string): string {
  const kop = f?.factuurnummer
    ? vulIn(t('bank_kop_verkoop'), { nummer: f.factuurnummer })
    : vulIn(t('bank_kop_verkoop_zonder_nr'), { datum: fmtD(f?.datum) || '—' })
  const naam = (f && klantNaamVoor(f)) || f?.klant_naam || ''
  return naam ? `${kop} · ${naam}` : kop
}

export function inkoopTitel(f: any): string {
  const credit = (Number(f?.totaal_bruto) || 0) < 0
  const kop = f?.factuurnummer
    ? vulIn(t(credit ? 'bank_kop_creditnota' : 'bank_kop_inkoop'), { nummer: f.factuurnummer })
    : vulIn(t(credit ? 'bank_kop_creditnota_zonder_nr' : 'bank_kop_inkoop_zonder_nr'), { datum: fmtD(f?.datum) || '—' })
  return f?.leverancier ? `${kop} · ${f.leverancier}` : kop
}

export function btwTitel(periodeKey: string, teruggave: boolean, aangifte = false): string {
  const sleutel = teruggave ? 'bank_kop_btw_teruggave' : aangifte ? 'bank_kop_btw_aangifte' : 'bank_kop_btw'
  return vulIn(t(sleutel), { periode: periodeKeyLabel(periodeKey) || periodeKey })
}

export const accijnsTitel = (maand: string): string => vulIn(t('bank_kop_accijns'), { maand })

export interface KoppelingWeergave {
  titel: string
  /** "automatisch gekoppeld", "onthouden koppeling", "herkend in betaalde facturen". */
  hints: string[]
  /** De koppeling wijst naar iets wat er niet meer is (verwijderde factuur). */
  ontbreekt?: boolean
  /** Gekoppelde factuur die nog niet op betaald staat: "Markeer betaald". */
  onbetaald?: { soort: 'verkoop' | 'inkoop', id: number }
}

/** Waaraan een gekoppelde transactie hangt, leesbaar; null = ongekoppeld. */
export function koppelingWeergave(tx: any, d: BankTekstData): KoppelingWeergave | null {
  const k = koppelingVan(tx)
  if (!k) return null
  const hints: string[] = []
  if (tx.retroGematcht) hints.push(t('bank_hint_retro'))
  else if (tx.herinneringsGematcht) hints.push(t('bank_hint_onthouden'))
  else if (tx.autoGematcht) hints.push(t('bank_hint_auto'))
  const weg = (): KoppelingWeergave => ({ titel: t('bank_kop_ontbreekt'), hints, ontbreekt: true })
  switch (k.soort) {
    case 'verkoop': {
      const f = (d.verkoopFacturen || []).find((x: any) => x.id === k.id)
      if (!f) return weg()
      return { titel: verkoopTitel(f, d.klantNaamVoor), hints, ...(f.status !== 'betaald' ? { onbetaald: { soort: 'verkoop' as const, id: f.id } } : {}) }
    }
    case 'inkoop': {
      const f = (d.inkoopFacturen || []).find((x: any) => x.id === k.id)
      if (!f) return weg()
      return { titel: inkoopTitel(f), hints, ...(f.status !== 'betaald' ? { onbetaald: { soort: 'inkoop' as const, id: f.id } } : {}) }
    }
    case 'kapitaal': {
      const b = (d.kapitaalBoekingen || []).find((x: any) => x.id === k.id)
      if (!b) return weg()
      const kop = t(b.type === 'onttrekking' ? 'bank_kop_kapitaal_onttrekking' : 'bank_kop_kapitaal_storting')
      return { titel: b.omschrijving && b.omschrijving !== kop ? `${kop} · ${b.omschrijving}` : kop, hints }
    }
    case 'btw':
      return { titel: btwTitel(k.periodeKey || '', tx.type === 'C'), hints }
    case 'accijns':
      return { titel: accijnsTitel(k.maand || ''), hints }
    case 'snd':
      return { titel: vulIn(t('bank_kop_snd'), { periode: periodeKeyLabel(k.periodeKey || '') }), hints }
    case 'aflossing': {
      const r = (d.altRekeningen || []).find((x: any) => x.id === k.id)
      return { titel: vulIn(t('bank_kop_aflossing'), { naam: r?.naam || t('lbl_onbekend') }), hints }
    }
    case 'psp': {
      const opgeslagen = (d.bankKoppelingen || {})[txKey(tx)]
      const kf = opgeslagen?.kostenFactuurId ? (d.inkoopFacturen || []).find((f: any) => f.id === opgeslagen.kostenFactuurId) : null
      const vars = { psp: pspNaam(tx) || 'PSP', n: (k.ids || []).length, kosten: fmt(Number(kf?.totaal_bruto) || 0) }
      return { titel: vulIn(t(kf ? 'bank_kop_psp' : 'bank_kop_psp_zonder_kosten'), vars), hints }
    }
  }
  return null
}

export interface VoorstelWeergave {
  titel: string
  reden: string
}

/** Het voorstel leesbaar: "Verkoopfactuur 2026-0079" + "bedrag en factuurnummer kloppen". */
export function voorstelWeergave(v: BankVoorstel, tx: any, d: BankTekstData): VoorstelWeergave {
  const vars = {
    ...v.vars,
    verschil: geldCent(v.verschilCent),
    kosten: geldCent(v.kostenCent),
  }
  const reden = v.redenSleutel === 'bank_vs_reden_geen' ? '' : vulIn(t(v.redenSleutel), vars)
  switch (v.soort) {
    case 'verkoop': {
      const f = (d.verkoopFacturen || []).find((x: any) => x.id === v.doelId)
      return { titel: verkoopTitel(f, d.klantNaamVoor), reden: v.retro ? `${reden} · ${t('bank_vs_al_betaald')}` : reden }
    }
    case 'inkoop': {
      const f = (d.inkoopFacturen || []).find((x: any) => x.id === v.doelId)
      return { titel: inkoopTitel(f), reden: v.retro ? `${reden} · ${t('bank_vs_al_betaald')}` : reden }
    }
    case 'psp':
      return { titel: vulIn(t('bank_vs_titel_psp'), { n: (v.factuurIds || []).length }), reden }
    case 'btw':
      return { titel: btwTitel(v.periodeKey || '', tx?.type === 'C', true), reden }
    case 'accijns':
      return { titel: accijnsTitel(v.maand || ''), reden }
    default:
      return { titel: t('bank_geen_voorstel'), reden }
  }
}

/** Zoektekst bij een transactie: waar hij aan hangt of wat er voorgesteld wordt. */
export function zoekTekstVoor(tx: any, v: BankVoorstel | undefined, d: BankTekstData): string[] {
  const k = koppelingWeergave(tx, d)
  if (k) return [k.titel]
  return v && v.soort ? [voorstelWeergave(v, tx, d).titel] : []
}

/** "02-10" in een lijst (dit jaar), anders "02-10-2025". */
export function korteDatum(datum: string, vandaagJaar: number): string {
  const s = String(datum || '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || '—'
  const dag = `${s.slice(8, 10)}-${s.slice(5, 7)}`
  return Number(s.slice(0, 4)) === vandaagJaar ? dag : `${dag}-${s.slice(0, 4)}`
}

/** Bedrag met teken: "+ € 496,10" / "− € 229,69". */
export const bedragMetTeken = (tx: any): string => `${tx?.type === 'C' ? '+' : '−'} ${fmt(Number(tx?.bedrag) || 0)}`
