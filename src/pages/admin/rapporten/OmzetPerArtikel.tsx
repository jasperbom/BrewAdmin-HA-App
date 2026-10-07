import React from 'react'
import { t } from '../../../i18n'
import SectionHeader from '../../../components/ui/SectionHeader'
import LegeStaat from '../../../components/ui/LegeStaat'
import ResponsiveLijst, { type LijstKolom } from '../../../components/ui/ResponsiveLijst'
import { useSmalScherm } from '../../../components/ui/useSmalScherm'
import { omzetPerArtikel, vergelijkOmzet, verschilPct, somCenten, type OmzetVergelijkRij } from '../../../utils/rapporten'
import { useAdmin } from '../adminContext'
import { bedrag, procent, csvEuro, csvProcent, bereikTekst, downloadCsv, bereikNaam, useCsvExport, KAART, type RapportProps } from './hulp'

// ── Omzet per artikel ───────────────────────────────────────────────────────
// De verkoopfactuurregels in de periode, per artikel (de artikel-identiteit
// van de regel als die er is, anders de omschrijving), met statiegeld en
// facturen zonder regels apart (utils/rapporten.ts `omzetPerArtikel`).
// Staven voor de verhouding, een tabel (telefoon: kaarten) voor de cijfers.

const MAX_STAVEN = 12

const fmtAantal = (n: number): string => Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')

const OmzetPerArtikel: React.FC<RapportProps> = ({ bereik, vorig, csvRef }) => {
  const { verkoopFacturen } = useAdmin()
  const smal = useSmalScherm()
  const nu = React.useMemo(() => omzetPerArtikel(verkoopFacturen || [], bereik), [verkoopFacturen, bereik.van, bereik.tot])
  const toen = React.useMemo(() => vorig ? omzetPerArtikel(verkoopFacturen || [], vorig) : null, [verkoopFacturen, vorig?.van, vorig?.tot])
  const rijen = React.useMemo(() => vergelijkOmzet(nu, toen), [nu, toen])
  const totaal = somCenten(rijen)
  const vorigTotaal = toen ? toen.reduce((s, g) => s + g.netto_cent, 0) : 0

  const naam = (r: OmzetVergelijkRij): string =>
    r.soort === 'statiegeld' ? t(r.statiegeld_soort === 'fust' ? 'statiegeld_fust' : 'statiegeld_snd')
      : r.soort === 'zonder_regels' ? t('rap_zonder_regels')
        : r.label || t('lbl_naamloos')

  useCsvExport(csvRef, () => {
    const kop = [t('rap_kol_artikel'), t('lbl_quantity'), t('lbl_netto'), t('lbl_btw'), t('lbl_bruto'),
      ...(toen ? [t('periode_vorig_jaar_zelfde'), t('rap_kol_verschil_pct')] : [])]
    downloadCsv(`omzet_artikel_${bereikNaam(bereik)}.csv`, [kop, ...rijen.map(r => [
      naam(r), r.aantal, csvEuro(r.netto_cent), csvEuro(r.btw_cent), csvEuro(r.bruto_cent),
      ...(toen ? [csvEuro(r.vorig_netto_cent || 0), csvProcent(verschilPct(r.netto_cent, r.vorig_netto_cent || 0))] : []),
    ])])
  })

  const staven = rijen.filter(r => r.netto_cent > 0 && r.soort !== 'statiegeld').slice(0, MAX_STAVEN)
  const max = Math.max(1, ...staven.map(r => Math.max(r.netto_cent, r.vorig_netto_cent || 0)))

  const kolommen: LijstKolom<OmzetVergelijkRij>[] = [
    { id: 'naam', kop: t('rap_kol_artikel'), cel: r => <span className={`font-medium ${r.soort === 'statiegeld' || r.soort === 'zonder_regels' ? 'text-gray-500' : 'text-gray-800'}`}>{naam(r)}</span> },
    { id: 'aantal', kop: t('lbl_quantity'), rechts: true, cel: r => <span className="text-gray-600">{fmtAantal(r.aantal)}</span> },
    { id: 'netto', kop: t('lbl_netto'), rechts: true, klasse: 'whitespace-nowrap', cel: r => <span className="font-semibold text-gray-900">{bedrag(r.netto_cent)}</span> },
    ...(toen ? [
      { id: 'vorig', kop: t('rap_kol_vorig'), rechts: true, klasse: 'whitespace-nowrap', cel: (r: OmzetVergelijkRij) => <span className="text-gray-500">{bedrag(r.vorig_netto_cent || 0)}</span> },
      { id: 'verschil', kop: t('rap_kol_verschil'), rechts: true, klasse: 'whitespace-nowrap', cel: (r: OmzetVergelijkRij) => <span className="text-xs text-gray-500">{procent(verschilPct(r.netto_cent, r.vorig_netto_cent || 0))}</span> },
    ] : []),
    { id: 'btw', kop: t('lbl_btw'), rechts: true, klasse: 'whitespace-nowrap', breed: true, cel: r => <span className="text-gray-600">{bedrag(r.btw_cent)}</span> },
    { id: 'bruto', kop: t('lbl_bruto'), rechts: true, klasse: 'whitespace-nowrap', breed: true, cel: r => <span className="text-gray-700">{bedrag(r.bruto_cent)}</span> },
  ]

  const kaart = (r: OmzetVergelijkRij) => (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{naam(r)}</span>
        <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-gray-900">{bedrag(r.netto_cent)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-xs text-gray-500 tabular-nums">
        <span>{t('lbl_quantity')}: {fmtAantal(r.aantal)}</span>
        <span>{t('lbl_bruto')}: {bedrag(r.bruto_cent)}</span>
      </div>
      {toen && (
        <div className="mt-0.5 text-xs text-gray-500 tabular-nums">
          {t('rap_kol_vorig')}: {bedrag(r.vorig_netto_cent || 0)}
          {procent(verschilPct(r.netto_cent, r.vorig_netto_cent || 0)) && <> · {procent(verschilPct(r.netto_cent, r.vorig_netto_cent || 0))}</>}
        </div>
      )}
    </div>
  )

  return (
    <div className={KAART}>
      <SectionHeader title={t('rap_omzet')} info={<span className="tabular-nums">{bereikTekst(bereik)}</span>} />
      {rijen.length === 0 ? (
        <div className="p-3"><LegeStaat titel={t('msg_no_rapport_data')} /></div>
      ) : (
        <div className="p-3 space-y-4">
          {staven.length > 0 && (
            <ul className="space-y-2.5" aria-label={t('rap_omzet')}>
              {staven.map(r => (
                <li key={r.sleutel} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-gray-800 font-medium">{naam(r)}</span>
                    <span className="tabular-nums whitespace-nowrap text-gray-700">{bedrag(r.netto_cent)}</span>
                  </div>
                  <div className="mt-1 h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${Math.round(r.netto_cent / max * 100)}%`, backgroundColor: 'var(--t-accent)' }} />
                  </div>
                  {toen && (
                    <div className="mt-0.5 h-1.5 rounded-full bg-gray-50 overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded-full bg-gray-300" style={{ width: `${Math.round((r.vorig_netto_cent || 0) / max * 100)}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {toen && staven.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-full" style={{ backgroundColor: 'var(--t-accent)' }} />{bereikTekst(bereik)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-full bg-gray-300" />{bereikTekst(vorig!)}</span>
            </p>
          )}
          <ResponsiveLijst rijen={rijen} sleutel={r => r.sleutel} kolommen={kolommen} kaart={kaart} label={t('rap_omzet')}
            voetCellen={{
              naam: t('lbl_total'), netto: bedrag(totaal.netto_cent), btw: bedrag(totaal.btw_cent), bruto: bedrag(totaal.bruto_cent),
              ...(toen ? { vorig: bedrag(vorigTotaal), verschil: procent(verschilPct(totaal.netto_cent, vorigTotaal)) } : {}),
            }}
            voet={smal ? <div className="flex justify-between gap-3 px-1 text-sm font-semibold text-gray-900"><span>{t('lbl_total')}</span><span className="tabular-nums">{bedrag(totaal.netto_cent)}</span></div> : undefined} />
        </div>
      )}
      <p className="px-4 pb-3 text-xs text-gray-500">{t('rap_omzet_uitleg')}</p>
    </div>
  )
}

export default OmzetPerArtikel
