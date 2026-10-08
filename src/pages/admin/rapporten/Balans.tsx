import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import BevestigKnop from '../../../components/ui/BevestigKnop'
import ResponsiveLijst, { type LijstKolom } from '../../../components/ui/ResponsiveLijst'
import { newId } from '../../../utils/api'
import { fmtD } from '../../../utils/format'
import { logAudit } from '../../../utils/audit'
import { toCent, centNaarEuro } from '../../../utils/centen'
import { dagNotatie } from '../../../utils/periode'
import { btwAfgerekendOp, btwPositieOp } from '../../../utils/balans'
import { verkoopFactuurBoeking, inkoopFactuurBoeking } from '../../../utils/journaal'
import { balansOp, voorraadWaardeCent, type BalansOp } from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import { berekenWv, bedrag, csvEuro, downloadCsv, useCsvExport, KAART, resultaatKleur, HuidigeStand, type RapportProps } from './hulp'

// ── Balans op een peildatum ─────────────────────────────────────────────────
// De peildatum is het einde van de gekozen periode (vandaag als dat later is,
// of bij "alles"). Debiteuren, crediteuren, accijns, liquide middelen, BTW en
// kapitaal volgen de peildatum (utils/rapporten.ts `balansOp`, utils/balans.ts
// `btwPositieOp`); de voorraad en de schuld aan alternatieve rekeningen kent de
// app alleen zoals ze nu zijn — die staan er dan als "huidige stand".
// Hieronder: de schuld per alternatieve rekening (vroeger een kaart op Bank),
// het verloop van het eigen vermogen en de jaarafsluiting.

const Rij: React.FC<{ label: React.ReactNode, cent: number, cls?: string, totaal?: boolean, sub?: React.ReactNode }> =
  ({ label, cent, cls = '', totaal = false, sub }) => (
    <tr className={totaal ? 'border-t border-gray-300 bg-gray-50/60' : 'border-t border-gray-100 first:border-t-0'}>
      <td className={`py-2 pl-4 pr-3 align-top ${totaal ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
        {label}
        {sub && <div className="text-xs text-gray-500 mt-0.5 space-y-0.5 break-words">{sub}</div>}
      </td>
      <td className={`py-2 pl-3 pr-4 text-right align-top tabular-nums whitespace-nowrap ${totaal ? 'font-bold text-gray-900' : 'font-medium text-gray-800'} ${cls}`}>{bedrag(cent)}</td>
    </tr>
  )

interface AltRij { id: number, naam: string, eigenaar?: string, opgenomen: number, afgelost: number, openstaand: number }

const Balans: React.FC<RapportProps> = ({ peildatum, vandaag, csvRef }) => {
  const ctx = useAdmin()
  const {
    verkoopFacturen, inkoopFacturen, acc, kapitaalBoekingen, bankAfschriften, bankSaldi, bankTransacties, journaal,
    btwPeriodeType, bankKoppelingen, btwIngediendePerioden, lots, totaleSchuldAltRekeningen,
    schuldPerAltRekening, altRekeningen, jaarafsluitingen, setJaarafsluitingen, auditLog, setAuditLog,
  } = ctx

  // BTW uit het journaal; zolang dat leeg is dezelfde boekingsbouwers op de
  // facturen, zoals de W&V terugvalt.
  const btwBron = React.useMemo(() => (journaal || []).length
    ? journaal
    : [...(verkoopFacturen || []).flatMap((f: any) => verkoopFactuurBoeking(f)),
      ...(inkoopFacturen || []).flatMap((f: any) => inkoopFactuurBoeking(f, btwPeriodeType))],
  [journaal, verkoopFacturen, inkoopFacturen, btwPeriodeType])

  const voorraadCent = React.useMemo(() => voorraadWaardeCent(lots), [lots])
  const altSchuldCent = toCent(totaleSchuldAltRekeningen)

  const balansVoor = React.useCallback((peil: string): BalansOp => {
    const afgerekend = btwAfgerekendOp(bankKoppelingen, Object.values(btwIngediendePerioden || {}) as any[], peil)
    return balansOp({
      peildatum: peil, vandaag,
      verkoopFacturen: verkoopFacturen || [], inkoopFacturen: inkoopFacturen || [], accijns: acc || [],
      kapitaalBoekingen: kapitaalBoekingen || [], bankAfschriften: bankAfschriften || [], bankSaldi: bankSaldi || null,
      bankTransacties: bankTransacties || [],
      btwCent: btwPositieOp(btwBron, afgerekend, btwPeriodeType, peil).cent,
      voorraadCent, altSchuldCent,
    })
  }, [bankKoppelingen, btwIngediendePerioden, vandaag, verkoopFacturen, inkoopFacturen, acc, kapitaalBoekingen,
    bankAfschriften, bankSaldi, bankTransacties, btwBron, btwPeriodeType, voorraadCent, altSchuldCent])

  const b = React.useMemo(() => balansVoor(peildatum), [balansVoor, peildatum])
  const peilTekst = dagNotatie(peildatum)
  const huidig = !b.isVandaag ? <HuidigeStand /> : null

  // ── Eigen vermogen: verloop van het boekjaar van de peildatum ────────────
  const boekjaar = Number(peildatum.slice(0, 4))
  const vorigeAfsluiting = (jaarafsluitingen || []).find((j: any) => Number(j.jaar) === boekjaar - 1) || null
  const resultaat = React.useMemo(() => toCent(berekenWv(ctx, { van: `${boekjaar}-01-01`, tot: peildatum }).nettowinst),
    [ctx.journaal, ctx.acc, ctx.verkoopFacturen, ctx.inkoopFacturen, boekjaar, peildatum])
  const evBerekend = vorigeAfsluiting ? toCent(vorigeAfsluiting.eigen_vermogen) + resultaat : null
  const aansluitVerschil = evBerekend !== null ? b.eigenVermogen - evBerekend : null

  // ── Jaarafsluiting: het vorige boekjaar ───────────────────────────────────
  // Legt de balans van vandaag vast, zoals de afsluiting altijd deed (daarom:
  // direct na afloop afsluiten). Bewust niet de balans op 31 december: die
  // kent de liquide middelen alleen als er een bewaard afschrift tot die dag
  // is, en bankafschriften worden pas sinds kort bewaard — een "onbekend"
  // saldo telt als nul en zou het eigen vermogen als beginbalans te laag
  // vastleggen.
  const afsluitJaar = Number(vandaag.slice(0, 4)) - 1
  const bestaande = (jaarafsluitingen || []).find((j: any) => Number(j.jaar) === afsluitJaar)
  const sluitBoekjaarAf = () => {
    const e = balansVoor(vandaag)
    const eur = (c: number) => centNaarEuro(c)
    const nieuw = {
      id: newId(jaarafsluitingen || []),
      jaar: afsluitJaar,
      afgesloten_op: new Date().toISOString(),
      eigen_vermogen: eur(e.eigenVermogen),
      balans: {
        debiteuren: eur(e.debiteuren), voorraad: eur(e.voorraad), liquide: eur(e.liquide.cent),
        crediteuren: eur(e.crediteuren), accijns_schuld: eur(e.accijnsSchuld), btw_schuld: eur(e.btw),
        schuld_alt_rekeningen: eur(e.altSchuld), gestort_kapitaal: eur(e.kapitaal),
      },
    }
    setJaarafsluitingen((prev: any[]) => [...(prev || []).filter((j: any) => Number(j.jaar) !== afsluitJaar), nieuw])
    logAudit(auditLog, setAuditLog, { entiteit: 'Jaarafsluiting', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Boekjaar ${afsluitJaar} afgesloten (EV ${bedrag(e.eigenVermogen)})` })
  }
  const afsluitingen = [...(jaarafsluitingen || [])].sort((a: any, z: any) => Number(z.jaar) - Number(a.jaar))

  // ── Schuld per alternatieve rekening ─────────────────────────────────────
  const altRijen: AltRij[] = (altRekeningen || []).map((r: any) => {
    const v = schuldPerAltRekening[r.id] || { opgenomen: 0, afgelost: 0, openstaand: 0 }
    return { id: r.id, naam: r.naam, eigenaar: r.eigenaar, opgenomen: toCent(v.opgenomen), afgelost: toCent(v.afgelost), openstaand: toCent(v.openstaand) }
  }).filter((r: AltRij) => r.opgenomen !== 0 || r.afgelost !== 0)
  const altKolommen: LijstKolom<AltRij>[] = [
    { id: 'naam', kop: t('lbl_alt_rekening'), cel: r => <span className="font-medium text-gray-800">{r.naam}{r.eigenaar && <span className="text-xs text-gray-500 ml-2">({r.eigenaar})</span>}</span> },
    { id: 'op', kop: t('lbl_totaal_opgenomen'), rechts: true, klasse: 'whitespace-nowrap', cel: r => bedrag(r.opgenomen) },
    { id: 'af', kop: t('lbl_totaal_afgelost'), rechts: true, klasse: 'whitespace-nowrap', cel: r => <span className="text-green-700">{bedrag(r.afgelost)}</span> },
    { id: 'open', kop: t('lbl_schuld_openstaand'), rechts: true, klasse: 'whitespace-nowrap', cel: r => <span className={`font-semibold ${r.openstaand > 0 ? 'text-orange-700' : 'text-gray-400'}`}>{bedrag(r.openstaand)}</span> },
  ]

  useCsvExport(csvRef, () => downloadCsv(`balans_${peildatum}.csv`, [
    [t('rap_kol_post'), t('rap_balans_op').replace('{datum}', peilTekst)],
    [t('lbl_activa')],
    [t('lbl_liquide_middelen'), csvEuro(b.liquide.cent)],
    [t('lbl_debiteuren_open'), csvEuro(b.debiteuren)],
    [t('lbl_voorraden_indicatief') + (b.isVandaag ? '' : ` (${t('rap_huidige_stand')})`), csvEuro(b.voorraad)],
    [t('lbl_total'), csvEuro(b.activa)],
    [t('lbl_passiva')],
    [t('lbl_crediteuren_open'), csvEuro(b.crediteuren)],
    [t('lbl_accijns_schuld'), csvEuro(b.accijnsSchuld)],
    [b.btw < 0 ? t('lbl_btw_vordering') : t('lbl_btw_schuld'), csvEuro(b.btw)],
    [t('lbl_schuld_alt_rekeningen') + (b.isVandaag ? '' : ` (${t('rap_huidige_stand')})`), csvEuro(b.altSchuld)],
    [t('lbl_gestort_kapitaal'), csvEuro(b.kapitaal)],
    [t('lbl_eigen_vermogen'), csvEuro(b.eigenVermogen)],
    [t('lbl_total'), csvEuro(b.vreemd + b.kapitaal + b.eigenVermogen)],
  ]))

  const saldoRegels = (
    <>
      {b.liquide.rekeningen.map(r => (
        <div key={r.iban} className="tabular-nums">
          {t('rap_saldo_rekening').replace('{iban}', r.iban).replace('{bedrag}', bedrag(r.cent)).replace('{datum}', r.datum ? dagNotatie(r.datum) : '—')}
        </div>
      ))}
      {b.liquide.onbekend.map(iban => (
        <div key={iban} className="text-orange-700">{t('rap_saldo_onbekend').replace('{iban}', iban).replace('{datum}', peilTekst)}</div>
      ))}
      {b.liquide.rekeningen.length === 0 && b.liquide.onbekend.length === 0 && <div className="italic">{t('lbl_bank_saldo_geen')}</div>}
    </>
  )

  return (
    <div className="space-y-4 min-w-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={KAART}>
          <SectionHeader title={t('lbl_activa')} info={t('rap_balans_op').replace('{datum}', peilTekst)} />
          <table className="w-full text-sm"><tbody>
            <Rij label={t('lbl_liquide_middelen')} cent={b.liquide.cent} sub={saldoRegels} />
            <Rij label={t('lbl_debiteuren_open')} cent={b.debiteuren} />
            <Rij label={<>{t('lbl_voorraden_indicatief')}{huidig}</>} cent={b.voorraad} />
            <Rij label={t('lbl_total')} cent={b.activa} totaal />
          </tbody></table>
        </div>
        <div className={KAART}>
          <SectionHeader title={t('lbl_passiva')} info={t('rap_balans_op').replace('{datum}', peilTekst)} />
          <table className="w-full text-sm"><tbody>
            <Rij label={t('lbl_crediteuren_open')} cent={b.crediteuren} />
            <Rij label={t('lbl_accijns_schuld')} cent={b.accijnsSchuld} />
            <Rij label={b.btw < 0 ? t('lbl_btw_vordering') : t('lbl_btw_schuld')} cent={b.btw} />
            <Rij label={<>{t('lbl_schuld_alt_rekeningen')}{huidig}</>} cent={b.altSchuld} cls={b.altSchuld > 0 ? 'text-orange-700' : 'text-gray-400'} />
            <Rij label={t('lbl_gestort_kapitaal')} cent={b.kapitaal} cls={b.kapitaal >= 0 ? 'text-purple-700' : 'text-red-600'} />
            <Rij label={t('lbl_eigen_vermogen')} cent={b.eigenVermogen} cls={resultaatKleur(b.eigenVermogen)} />
            <Rij label={t('lbl_total')} cent={b.vreemd + b.kapitaal + b.eigenVermogen} totaal />
          </tbody></table>
        </div>
      </div>
      {!b.isVandaag && <p className="text-xs text-gray-500">{t('rap_huidige_stand_uitleg')}</p>}

      {altRijen.length > 0 && (
        <div className={KAART}>
          <SectionHeader title={t('title_schuld_alt_rekeningen')} info={!b.isVandaag ? t('rap_huidige_stand') : undefined} />
          <div className="p-3">
            <ResponsiveLijst rijen={altRijen} sleutel={r => r.id} kolommen={altKolommen} label={t('title_schuld_alt_rekeningen')}
              voetCellen={altRijen.length > 1 ? {
                naam: t('lbl_total'),
                op: bedrag(altRijen.reduce((s, r) => s + r.opgenomen, 0)),
                af: bedrag(altRijen.reduce((s, r) => s + r.afgelost, 0)),
                open: bedrag(altSchuldCent),
              } : undefined} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={KAART}>
          <SectionHeader title={t('lbl_ev_verloop').replace('{jaar}', String(boekjaar))} info={t('rap_balans_op').replace('{datum}', peilTekst)} />
          <table className="w-full text-sm"><tbody>
            <tr className="border-t border-gray-100 first:border-t-0">
              <td className="py-2 pl-4 pr-3 text-gray-700">{t('lbl_ev_begin').replace('{jaar}', String(boekjaar - 1))}</td>
              <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-medium">{vorigeAfsluiting ? bedrag(toCent(vorigeAfsluiting.eigen_vermogen)) : '—'}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="py-2 pl-4 pr-3 text-gray-700">{t('lbl_resultaat_boekjaar')}</td>
              <td className={`py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-medium ${resultaatKleur(resultaat)}`}>{bedrag(resultaat)}</td>
            </tr>
            <tr className="border-t border-gray-300 bg-gray-50/60">
              <td className="py-2 pl-4 pr-3 font-semibold text-gray-900">{t('lbl_ev_berekend')}</td>
              <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-semibold">{evBerekend !== null ? bedrag(evBerekend) : '—'}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="py-2 pl-4 pr-3 text-gray-700">{t('lbl_ev_volgens_balans')}</td>
              <td className="py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-medium">{bedrag(b.eigenVermogen)}</td>
            </tr>
            {aansluitVerschil !== null && (
              <tr className="border-t border-gray-100">
                <td className="py-2 pl-4 pr-3 text-gray-700">{t('lbl_aansluitverschil')}</td>
                <td className={`py-2 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-medium ${aansluitVerschil === 0 ? 'text-green-700' : 'text-orange-700'}`}>{bedrag(aansluitVerschil)}</td>
              </tr>
            )}
          </tbody></table>
          {!vorigeAfsluiting && <p className="px-4 py-3 text-xs text-gray-500">{t('msg_geen_afsluiting').replace('{jaar}', String(boekjaar - 1))}</p>}
        </div>

        <div className={KAART}>
          <SectionHeader title={t('lbl_jaarafsluitingen')} />
          <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
            <BevestigKnop v="primary" s="md"
              vraag={t(bestaande ? 'rap_jaar_opnieuw_vraag' : 'rap_jaar_afsluiten_vraag').replace('{jaar}', String(afsluitJaar))}
              onBevestig={sluitBoekjaarAf}>
              {t('btn_jaar_afsluiten').replace('{jaar}', String(afsluitJaar))}
            </BevestigKnop>
          </div>
          <p className="px-4 pt-2 text-xs text-gray-500">
            {t('rap_afsluiting_uitleg_vandaag').replace('{jaar}', String(afsluitJaar)).replace('{volgend}', String(afsluitJaar + 1))}
          </p>
          {afsluitingen.length > 0 && (
            <table className="w-full text-sm mt-2">
              <thead><tr className="text-xs text-gray-500 border-b border-gray-100">
                <th scope="col" className="py-1.5 pl-4 pr-3 text-left font-medium">{t('lbl_boekjaar')}</th>
                <th scope="col" className="py-1.5 px-3 text-left font-medium">{t('lbl_afgesloten_op')}</th>
                <th scope="col" className="py-1.5 pl-3 pr-4 text-right font-medium">{t('lbl_eigen_vermogen')}</th>
              </tr></thead>
              <tbody>
                {afsluitingen.map((j: any) => (
                  <tr key={j.id} className="border-b border-gray-50 last:border-b-0">
                    <td className="py-1.5 pl-4 pr-3 font-medium text-gray-800">{j.jaar}</td>
                    <td className="py-1.5 px-3 text-gray-500 tabular-nums">{fmtD(String(j.afgesloten_op || '').slice(0, 10))}</td>
                    <td className={`py-1.5 pl-3 pr-4 text-right tabular-nums whitespace-nowrap font-medium ${resultaatKleur(toCent(j.eigen_vermogen))}`}>{bedrag(toCent(j.eigen_vermogen))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="h-3" />
        </div>
      </div>
    </div>
  )
}

export default Balans
