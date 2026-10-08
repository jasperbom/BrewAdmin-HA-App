import React, { useMemo, useState } from 'react'
import { t } from '../i18n'
import { fmt, fmtQty } from '../utils/format'
import { VERLIES_BRONNEN } from '../utils/constants'
import SectionHeader from './ui/SectionHeader'
import {
  receptKostprijs, gemiddeldVerlies, kostprijsPerEenheid, receptAccijns, VerliesCijfer,
} from '../utils/receptKostprijs'
import { brouwKosten, kostenVoorBrouw, KostenBron } from '../utils/brouwKosten'
import { verpakkingMix, referentieVerpakking, VerpakkingMix } from '../utils/verpakkingKosten'

// Wat kost een liter bier volgens dit recept — vóórdat je brouwt?
//
// De rekenkern staat in `utils/receptKostprijs.ts`; dit is alleen de weergave.
// Twee getallen naast elkaar: per liter uit de gistkuip (wat je brouwt) en per
// liter die je overhoudt om te verkopen (wat je factureert). Dat verschil is
// precies je verlies, en dat komt uit je eigen brouwhistorie.

export interface ReceptKostprijsProps {
  recept: any
  ingredienten?: any[] | null
  lots?: any[] | null
  /** Alle batches; het paneel kiest zelf die van dit recept. */
  batches?: any[] | null
  afvullingen?: any[] | null
  verliesRegistraties?: any[] | null
  /** Inkoopfacturen — bron voor de energie-/water-/schoonmaakkosten. */
  inkoopFacturen?: any[] | null
  /** Verpakkingen en hun onderdelen — bron voor de verpakkingskosten. */
  verpakkingen?: any[] | null
  onderdelen?: any[] | null
  /** Accijnstarieven; zonder deze rekent de app met het standaardtarief. */
  accijnsInst?: any | null
  /** Opslaan van de vaste kosten / het handmatige verliespercentage. */
  onWijzig?: (patch: Record<string, any>) => void
  /** Versie-snapshots zijn alleen-lezen. */
  readOnly?: boolean
}

const SOORT_LABEL: Record<string, string> = {
  mout: 'recipe_section_grains',
  hop: 'recipe_section_hops',
  gist: 'recipe_section_yeast',
  overig: 'recipe_section_other',
}

// Kleine bedragen (een fles, een liter) hebben die derde decimaal nodig, een
// fust van €13,98 niet.
const eur3 = (v: number): string =>
  '€' + Number(v).toLocaleString('nl-NL',
    {minimumFractionDigits: 2, maximumFractionDigits: Math.abs(Number(v)) >= 10 ? 2 : 3})

const ReceptKostprijs: React.FC<ReceptKostprijsProps> = ({
  recept, ingredienten, lots, batches, afvullingen, verliesRegistraties, inkoopFacturen,
  verpakkingen, onderdelen, accijnsInst, onWijzig, readOnly = false,
}) => {
  const [open, setOpen] = useState(false)

  // De batches van dít recept vertellen het meest; heb je die nog niet, dan is
  // het gemiddelde van de hele brouwerij nog altijd beter dan een aanname.
  const {verlies, eigenHistorie} = useMemo(() => {
    const alle = (batches || []).filter(Boolean)
    const eigen = alle.filter((b: any) =>
      String(b?.recept_id || '') === String(recept?.id || ''))
    const uitEigen = gemiddeldVerlies({batches: eigen, afvullingen, verliesRegistraties})
    if (uitEigen.bron !== 'aanname') return {verlies: uitEigen, eigenHistorie: true}
    return {
      verlies: gemiddeldVerlies({batches: alle, afvullingen, verliesRegistraties}),
      eigenHistorie: false,
    }
  }, [batches, afvullingen, verliesRegistraties, recept?.id])

  // Een handmatig percentage wint van de meting: soms weet je gewoon beter.
  const handmatig = recept?.kostprijs_verlies_pct
  const handmatigAan = handmatig !== undefined && handmatig !== null && String(handmatig) !== ''
  const verliesPct = handmatigAan ? Number(handmatig) : verlies.pct

  // De vaste kosten (elektra, water, schoonmaak) reken je niet uit je hoofd
  // uit: die komen uit je eigen brouwsels of uit de energie- en waterfacturen
  // in de boekhouding. Zie `utils/brouwKosten.ts` — daar hoort ook elke
  // toekomstige bron (HA-meter, watermeter) thuis.
  const liters = Number(recept?.batch_size || 0)
  const kosten = useMemo(() => brouwKosten({batches, inkoopFacturen}), [batches, inkoopFacturen])
  const auto = useMemo(() => kostenVoorBrouw(kosten, liters), [kosten, liters])

  const handKosten = recept?.kostprijs_overig
  const handKostenAan = handKosten !== undefined && handKosten !== null && String(handKosten) !== ''
  const overigeKosten = handKostenAan ? Number(handKosten) : auto.totaal

  // Hoe je dit bier verpakt zegt het recept niet, maar je eigen afvullingen
  // wel: fles, fust of een mix daarvan, gewogen op liters.
  const mix: VerpakkingMix = useMemo(() => {
    const eigen = (batches || []).filter((b: any) =>
      b && String(b?.recept_id || '') === String(recept?.id || ' '))
    return verpakkingMix(eigen, batches, {afvullingen, verpakkingen, onderdelen})
  }, [batches, afvullingen, verpakkingen, onderdelen, recept?.id])

  // Een voorcalculatie rekent met één verpakking — de fles van 33 cl. Dat
  // houdt de uitkomst overzichtelijk en maakt recepten onderling vergelijkbaar;
  // hoe je later daadwerkelijk afvult zie je op de batch.
  const ref = useMemo(() => referentieVerpakking(verpakkingen, onderdelen, mix),
    [verpakkingen, onderdelen, mix])

  // Accijns hoort niet in de kostprijs — die ontstaat pas bij uitslag — maar
  // zonder dat getal weet je je verkoopprijs niet. Dus apart erbij.
  const acc = useMemo(() => receptAccijns(recept, accijnsInst), [recept, accijnsInst])

  const k = useMemo(() => receptKostprijs({
    recept, ingredienten, lots, verliesPct, overigeKosten,
    verpakkingPerLiter: ref.kostenPerLiter, accijnsPerLiter: acc.perLiter,
  }), [recept, ingredienten, lots, verliesPct, overigeKosten, ref.kostenPerLiter, acc.perLiter])

  // Wat kost één fles? Dat leest makkelijker dan een prijs per liter.
  const eenheden = useMemo(() => kostprijsPerEenheid(k, ref.bron === 'geen' ? null : [ref], ref.inhoud),
    [k, ref])
  const eenheid = eenheden[0] || null
  const eenheidNaam = eenheid ? (eenheid.naam || `${fmtQty(eenheid.inhoud, 2)} L`) : ''
  // Hoeveel eenheden levert deze brouw op?
  const stuks = eenheid && eenheid.inhoud > 0 ? Math.floor(k.litersNaVerlies / eenheid.inhoud) : 0

  const perLiter = k.perLiterVerkoopbaar
  const soorten = Object.entries(k.perSoort).filter(([, v]) => v > 0)
  const kostenBronLabel: Record<KostenBron, string> = {
    gemeten: 'recipe_cost_overhead_measured',
    boekhouding: 'recipe_cost_overhead_books',
    handmatig: 'recipe_cost_overhead_manual',
    geen: 'recipe_cost_overhead_none',
  }
  const kortBronLabel: Record<KostenBron, string> = {
    gemeten: 'recipe_cost_src_measured',
    boekhouding: 'recipe_cost_src_books',
    handmatig: 'recipe_cost_src_manual',
    geen: 'recipe_cost_overhead_none',
  }
  const bronLabel: Record<VerliesCijfer['bron'], string> = {
    gemeten: 'recipe_cost_loss_measured',
    registraties: 'recipe_cost_loss_registered',
    aanname: 'recipe_cost_loss_assumed',
  }

  return (
    <div className="mb-5 bg-white rounded-xl border border-gray-200 overflow-hidden">
      <SectionHeader
        title={t('recipe_cost_title')}
        open={open}
        onToggle={() => setOpen(o => !o)}
        // De kop is niet solid (wit): het getal in donkere tekst, anders is het
        // belangrijkste cijfer onzichtbaar zolang de sectie dicht staat.
        info={eenheid
          ? <span className="font-semibold text-gray-800">{eur3(eenheid.totaal)} <span className="font-normal text-gray-500">/{eenheidNaam}</span></span>
          : perLiter !== null
            ? <span className="font-semibold text-gray-800">{eur3(perLiter)} <span className="font-normal text-gray-500">{t('recipe_cost_per_liter_short')}</span></span>
            : <span>{t('recipe_cost_unknown')}</span>}
      />
      {open && (
        <div className="p-4 space-y-4">
          {/* De drie getallen waar het om draait */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg p-3 t-panel">
              <div className="text-xs text-gray-500 mb-0.5">
                {eenheid ? t('recipe_cost_per_unit_of').replace('{v}', eenheidNaam) : t('recipe_cost_per_sellable')}
              </div>
              <div className="text-2xl font-bold leading-none" style={{color: 'var(--t-accent)'}}>
                {eenheid ? eur3(eenheid.totaal) : perLiter !== null ? eur3(perLiter) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {eenheid
                  ? (eenheid.verpakking > 0
                      ? t('recipe_cost_unit_split')
                          .replace('{b}', eur3(eenheid.bier))
                          .replace('{p}', eur3(eenheid.verpakking))
                      : t('recipe_cost_unit_beer_only').replace('{b}', eur3(eenheid.bier)))
                  : t('recipe_cost_after_loss')
                      .replace('{pct}', fmtQty(verliesPct, 1))
                      .replace('{l}', fmtQty(k.litersNaVerlies, 1))}
              </div>
              {eenheid && eenheid.accijns > 0 && (
                <div className="text-xs font-medium text-gray-600 mt-1">
                  {t('recipe_cost_incl_excise').replace('{v}', eur3(eenheid.totaalMetAccijns))}
                </div>
              )}
            </div>
            <div className="rounded-lg p-3 bg-gray-50">
              <div className="text-xs text-gray-500 mb-0.5">{t('recipe_cost_per_sellable')}</div>
              <div className="text-2xl font-bold text-gray-800 leading-none">
                {perLiter !== null ? eur3(perLiter) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {t('recipe_cost_after_loss')
                  .replace('{pct}', fmtQty(verliesPct, 1))
                  .replace('{l}', fmtQty(k.litersNaVerlies, 1))}
                {k.perLiterBrouwzaal !== null &&
                  ` · ${t('recipe_cost_per_brewhouse')}: ${eur3(k.perLiterBrouwzaal)}`}
              </div>
            </div>
            <div className="rounded-lg p-3 bg-gray-50">
              <div className="text-xs text-gray-500 mb-0.5">{t('recipe_cost_per_brew')}</div>
              <div className="text-2xl font-bold text-gray-800 leading-none">{fmt(k.totaal)}</div>
              <div className="text-xs text-gray-500 mt-1">
                {t('recipe_cost_ingredients')}: {fmt(k.ingredientKosten)}
                {k.overigeKosten > 0 && ` · ${t('recipe_cost_other')}: ${fmt(k.overigeKosten)}`}
                {k.verpakkingKosten > 0 && ` · ${t('recipe_cost_packaging')}: ${fmt(k.verpakkingKosten)}`}
              </div>
            </div>
          </div>

          {k.onbekend > 0 && (
            <div className="text-xs bg-orange-50 text-orange-700 rounded-lg px-3 py-2">
              {t('recipe_cost_missing_prices').replace('{n}', String(k.onbekend))}
            </div>
          )}

          {/* Verdeling over mout/hop/gist/overig */}
          {soorten.length > 0 && k.ingredientKosten > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1.5">{t('recipe_cost_split')}</div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-1.5">
                {soorten.map(([soort, bedrag], i) => (
                  <div key={soort} title={`${t(SOORT_LABEL[soort] || soort)}: ${fmt(bedrag)}`}
                    style={{
                      width: `${(bedrag / k.ingredientKosten) * 100}%`,
                      backgroundColor: 'var(--t-accent)',
                      opacity: 1 - i * 0.22,
                    }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {soorten.map(([soort, bedrag]) => (
                  <span key={soort}>
                    {t(SOORT_LABEL[soort] || soort)}: <span className="font-medium">{fmt(bedrag)}</span>
                    <span className="text-gray-400"> ({Math.round((bedrag / k.ingredientKosten) * 100)}%)</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Waar het verliespercentage vandaan komt */}
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-600">
                <span className="font-semibold text-gray-500">{t('recipe_cost_loss')}</span>
                <span className="ml-2">
                  {verlies.bron === 'gemeten'
                    ? t(eigenHistorie ? 'recipe_cost_loss_measured' : 'recipe_cost_loss_brewery')
                        .replace('{n}', String(verlies.batches))
                        .replace('{pct}', fmtQty(verlies.pct, 1))
                    : t(bronLabel[verlies.bron]).replace('{pct}', fmtQty(verlies.pct, 1))}
                </span>
                {verlies.bron === 'gemeten' && (
                  <span className="text-gray-400 ml-2">
                    {fmtQty(verlies.vergist, 1)} L → {fmtQty(verlies.afgevuld, 1)} L
                  </span>
                )}
              </div>
              {!readOnly && onWijzig && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  {t('recipe_cost_loss_manual')}
                  <input type="number" step="0.1" min="0" max="99"
                    value={handmatigAan ? String(handmatig) : ''}
                    placeholder={fmtQty(verlies.pct, 1)}
                    onChange={e => onWijzig({kostprijs_verlies_pct: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="w-20 border border-gray-200 rounded px-2 py-1 text-right t-input" />
                  %
                </label>
              )}
            </div>
            {Object.keys(verlies.perBron).length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
                {Object.entries(verlies.perBron).map(([bron, pct]) => (
                  <span key={bron}>
                    {t(VERLIES_BRONNEN.find(v => v.key === bron)?.label || 'verlies_bron_overig')}:{' '}
                    <span className="font-medium text-gray-700">{fmtQty(pct, 1)}%</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Vaste kosten per brouw — afgeleid, niet ingetypt */}
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-600">
                <span className="font-semibold text-gray-500">{t('recipe_cost_other_input')}</span>
                <span className="ml-2 font-medium text-gray-800">{fmt(overigeKosten)}</span>
                <span className="ml-2">
                  {handKostenAan
                    ? t('recipe_cost_overhead_manual_on')
                    : t(kostenBronLabel[kosten.bron])
                        .replace('{n}', String(kosten.batches))
                        .replace('{van}', kosten.van)
                        .replace('{tot}', kosten.tot)}
                </span>
              </div>
              {!readOnly && onWijzig && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  {t('recipe_cost_loss_manual')} €
                  <input type="number" step="0.01" min="0"
                    value={handKostenAan ? String(handKosten) : ''}
                    placeholder={fmtQty(auto.totaal, 2)}
                    onChange={e => onWijzig({kostprijs_overig: e.target.value === '' ? '' : Number(e.target.value)})}
                    className="w-24 border border-gray-200 rounded px-2 py-1 text-right t-input" />
                </label>
              )}
            </div>
            {!handKostenAan && auto.posten.some(p => p.bedrag > 0) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
                {auto.posten.filter(p => p.bedrag > 0).map(p => (
                  <span key={p.key} title={t(kostenBronLabel[p.bron]).replace('{n}', String(kosten.batches)).replace('{van}', kosten.van).replace('{tot}', kosten.tot)}>
                    {t(p.label)}: <span className="font-medium text-gray-700">{fmt(p.bedrag)}</span>
                    {/* Bron erbij zodra die afwijkt van de bron in de kop —
                        anders lijkt alles uit dezelfde hoek te komen. */}
                    {p.bron !== kosten.bron && <span className="text-gray-400"> ({t(kortBronLabel[p.bron])})</span>}
                    {p.geschaald && <span className="text-gray-400"> ({t('recipe_cost_overhead_scaled')})</span>}
                  </span>
                ))}
              </div>
            )}
            {!handKostenAan && kosten.bron === 'geen' && (
              <div className="text-xs text-gray-400 mt-1.5">{t('recipe_cost_overhead_hint')}</div>
            )}
          </div>

          {/* Verpakking — welke mix je gebruikt weet de app uit je afvullingen */}
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-gray-600">
              <span className="font-semibold text-gray-500">{t('recipe_cost_packaging')}</span>
              <span className="font-medium text-gray-800">{fmt(k.verpakkingKosten)}</span>
              {ref.bron !== 'geen' && (
                <span>
                  {t('recipe_cost_packaging_ref')
                    .replace('{v}', ref.naam || `${fmtQty(ref.inhoud, 2)} L`)
                    .replace('{p}', eur3(ref.kostenPerStuk))}
                  {stuks > 0 && ` · ${t('recipe_cost_packaging_units').replace('{n}', fmtQty(stuks, 0))}`}
                </span>
              )}
            </div>
            {ref.bron === 'geen' && (
              <div className="text-xs text-gray-400 mt-1.5">{t('recipe_cost_packaging_hint')}</div>
            )}
            {ref.bron === 'mix' && (
              <div className="text-xs text-gray-400 mt-1.5">{t('recipe_cost_packaging_no_ref')}</div>
            )}
            {/* Vul je dit bier ook anders af, dan is dat goed om te weten —
                maar de voorcalculatie blijft op de referentieverpakking. */}
            {ref.bron === 'verpakking' && mix.bron !== 'geen' && mix.regels.length > 1 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-400">
                <span>{t('recipe_cost_packaging_actual')}</span>
                {mix.regels.map(r => (
                  <span key={r.naam || String(r.verpakkingId)}>
                    {r.naam || t('lbl_onbekend')} <span className="text-gray-500">{Math.round(r.aandeel * 100)}%</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Accijns — apart, want het is geen productiekostenpost */}
          {acc.perLiter > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-gray-600">
                <span className="font-semibold text-gray-500">{t('recipe_cost_excise')}</span>
                <span className="font-medium text-gray-800">{fmt(k.accijns)}</span>
                <span>
                  {eur3(acc.perLiter)} {t('recipe_cost_excise_per_liter')}
                  {eenheid && eenheid.accijns > 0 &&
                    ` · ${eur3(eenheid.accijns)} ${t('recipe_cost_excise_per_unit').replace('{v}', eenheidNaam)}`}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-1.5">
                {t(acc.grondslag === 'plato' ? 'recipe_cost_excise_plato'
                  : acc.grondslag === 'minimum' ? 'recipe_cost_excise_min'
                  : acc.grondslag === 'formule' ? 'recipe_cost_excise_formula'
                  : 'recipe_cost_excise_abv')
                  .replace('{abv}', fmtQty(acc.abv, 1))
                  .replace('{plato}', fmtQty(acc.plato, 1))
                  .replace('{r}', eur3(acc.grondslag === 'minimum' ? acc.r2 : acc.r1))}
                {' '}{t('recipe_cost_excise_note')}
              </div>
            </div>
          )}

          {/* De regels */}
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400">
                  <th className="px-3 py-2 text-left font-medium">{t('log_ingredient')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('recipe_needed')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('recipe_cost_unit_price')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('recipe_cost_amount')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('recipe_cost_share')}</th>
                </tr>
              </thead>
              <tbody>
                {k.regels.map((r, i) => (
                  <tr key={`${r.soort}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 text-gray-800">
                      {r.naam}
                      {r.prijsBron === 'laatste' && (
                        <span className="ml-1.5 text-xs text-gray-400" title={t('recipe_cost_price_last_tip')}>
                          {t('recipe_cost_price_last')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600 whitespace-nowrap">
                      {fmtQty(r.hoeveelheid)} {r.eenheid}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500 whitespace-nowrap">
                      {r.prijsPerEenheid !== null ? `${eur3(r.prijsPerEenheid)}/${r.eenheid}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {r.kosten !== null
                        ? <span className="font-medium text-gray-800">{fmt(r.kosten)}</span>
                        : <span className="text-orange-500 text-xs">{t('recipe_cost_no_price')}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs text-gray-400">
                      {r.kosten !== null && k.ingredientKosten > 0
                        ? `${Math.round((r.kosten / k.ingredientKosten) * 100)}%` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Opbouwend, zodat het totaal navolgbaar is: de regels tellen op
                  tot de ingrediënten, daarna komen de kosten eromheen erbij. */}
              <tfoot>
                <tr className="text-xs border-t border-gray-200">
                  <td className="px-3 py-1.5 text-gray-500" colSpan={3}>{t('recipe_cost_subtotal_ingredients')}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmt(k.ingredientKosten)}</td>
                  <td className="px-3 py-1.5"></td>
                </tr>
                {k.overigeKosten > 0 && (
                  <tr className="text-xs">
                    <td className="px-3 py-1.5 text-gray-500" colSpan={3}>{t('recipe_cost_other_input')}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmt(k.overigeKosten)}</td>
                    <td className="px-3 py-1.5"></td>
                  </tr>
                )}
                {k.verpakkingKosten > 0 && (
                  <tr className="text-xs">
                    <td className="px-3 py-1.5 text-gray-500" colSpan={3}>
                      {t('recipe_cost_packaging')}
                      {/* Per liter, niet per fles: er past zelden een rond
                          aantal flessen in een brouw. */}
                      <span className="text-gray-400"> · {fmtQty(k.litersNaVerlies, 1)} L × {eur3(ref.kostenPerLiter)}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmt(k.verpakkingKosten)}</td>
                    <td className="px-3 py-1.5"></td>
                  </tr>
                )}
                <tr className={k.accijns > 0 ? 'text-sm' : 'bg-gray-50 text-sm'}>
                  <td className="px-3 py-2 font-semibold text-gray-700" colSpan={3}>
                    {k.accijns > 0 ? t('recipe_cost_title') : t('lbl_total')}
                  </td>
                  <td className={`px-3 py-2 text-right ${k.accijns > 0 ? 'font-semibold text-gray-700' : 'font-bold text-gray-800'}`}>
                    {fmt(k.totaal)}
                  </td>
                  <td className="px-3 py-2"></td>
                </tr>
                {k.accijns > 0 && (
                  <>
                    <tr className="text-xs">
                      <td className="px-3 py-1.5 text-gray-500" colSpan={3}>
                        {t('recipe_cost_excise')}
                        <span className="text-gray-400"> · {fmtQty(k.litersNaVerlies, 1)} L × {eur3(acc.perLiter)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmt(k.accijns)}</td>
                      <td className="px-3 py-1.5"></td>
                    </tr>
                    <tr className="bg-gray-50 text-sm">
                      <td className="px-3 py-2 font-semibold text-gray-700" colSpan={3}>{t('recipe_cost_total_incl_excise')}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800">{fmt(k.totaalMetAccijns)}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>

          <div className="text-xs text-gray-400">{t('recipe_cost_note')}</div>
        </div>
      )}
    </div>
  )
}

export default ReceptKostprijs
