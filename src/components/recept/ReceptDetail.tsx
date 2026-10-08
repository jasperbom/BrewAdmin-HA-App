import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtD, fmtSg } from '../../utils/format'
import Btn from '../ui/Btn'
import ActieBalk from '../ui/ActieBalk'
import RowActions, { type RowActie } from '../ui/RowActions'
import SectionHeader from '../ui/SectionHeader'
import ReceptKostprijs from '../ReceptKostprijs'
import IngredientSectie, { type ReceptSectie } from './IngredientSectie'
import ReceptVerbindingen from './ReceptVerbindingen'
import { ReceptChip } from './ReceptRij'
import type { ReceptGebruik } from '../../utils/receptGebruik'
import { isReceptVersie } from '../../utils/productKeten'
import { batchesVanRecept, versieRegels } from '../../utils/receptLijst'
import {
  receptRegelVoorraad, receptVoorraadOordeel, ingredientVoorReceptRegel, type ReceptRegelVoorraad,
} from '../../utils/ingredientVoorraad'
import { fmtGetal } from '../../utils/etiket'
import type { VerkoopCtx } from '../../utils/verkoopOverzicht'

// Het detail van een recept (`#/productie/recepten/<id>`): kop met Brouwen en
// ⋯, de verbindingsblokken (product, gebrouwen, etiket verwacht, versies), de
// cijfers, de ingrediënten met voorraad en uitklapbaar maischprofiel,
// vergisting, kostprijs en notities. Op een telefoon staat Brouwen onderin in
// een vaste balk. Een Brewfather-versie is alleen-lezen.

const SECTIES: ReceptSectie[] = ['mout', 'hop', 'gist', 'overig']

export interface ReceptDetailProps {
  /** Het getoonde record: het hoofdrecept of een versie. */
  recept: any
  /** De status van het hoofdrecept (`receptGebruik`). */
  gebruik: ReceptGebruik<any> | null
  recepten: any[]
  producten: any[]
  batches: any[]
  ingredienten: any[]
  lots: any[]
  afvullingen: any[]
  afvulSessies: any[]
  verliesRegistraties: any[]
  inkoopFacturen: any[]
  verpakkingen: any[]
  onderdelen: any[]
  accijnsInst: any
  verkoopCtx: VerkoopCtx
  /** ⋯ in de kop (vastpinnen, koppelen, verbergen — Brouwen staat los). */
  acties: RowActie[]
  /** Zonder: geen knop Brouwen (een versie, of geen batchpagina). */
  onBrouwen?: () => void
  onKoppel: () => void
  onOpenRecept: (id: string) => void
  onOpenBatch: (id: number) => void
  onOpenProduct: (id: number) => void
  onWijzig: (patch: Record<string, unknown>) => void
  onWijzigRegel: (cat: ReceptSectie, idx: number, patch: Record<string, unknown>) => void
  onWisLokaal: (cat: ReceptSectie, idx: number) => void
}

/** Een uitklapbare kaart (maischprofiel, vergisting, notities). */
const Uitklap: React.FC<{ titel: string; info?: React.ReactNode; children: React.ReactNode }> = ({ titel, info, children }) => {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <SectionHeader title={titel} open={open} onToggle={() => setOpen(o => !o)} info={info} />
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

const Tegel: React.FC<{ label: string; waarde: string }> = ({ label, waarde }) => (
  <div className="bg-gray-50 rounded-xl px-2 py-3 text-center min-w-0">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-xl md:text-2xl font-bold text-gray-900 mt-0.5 break-words tabular-nums">{waarde}</div>
  </div>
)

const ReceptDetail: React.FC<ReceptDetailProps> = (p) => {
  const { recept, gebruik } = p
  const readOnly = isReceptVersie(recept)
  const hoofd = gebruik?.recept

  // Voorraadcheck per receptregel, één keer per recept (niet per render van
  // elke regel): elk lot omgerekend naar de eenheid van de regel.
  const voorraad = React.useMemo((): Record<ReceptSectie, ReceptRegelVoorraad[]> => {
    const match = (regel: any) => ingredientVoorReceptRegel(regel, p.ingredienten)
    const uit = {} as Record<ReceptSectie, ReceptRegelVoorraad[]>
    for (const cat of SECTIES) uit[cat] = (recept?.[cat] || []).map((item: any) => receptRegelVoorraad(item, recept, p.lots, match))
    return uit
  }, [recept, p.lots, p.ingredienten])
  const oordeel = React.useMemo(() => receptVoorraadOordeel(recept, p.lots, p.ingredienten), [recept, p.lots, p.ingredienten])

  const batchRegels = React.useMemo(() => gebruik
    ? batchesVanRecept(gebruik.id, { batches: p.batches, recepten: p.recepten, afvullingen: p.afvullingen, sessies: p.afvulSessies })
    : [], [gebruik, p.batches, p.recepten, p.afvullingen, p.afvulSessies])
  const versies = React.useMemo(() => gebruik ? versieRegels(gebruik, batchRegels) : [], [gebruik, batchRegels])

  const sectieTitel: Record<ReceptSectie, string> = {
    mout: t('recipe_section_grains'), hop: t('recipe_section_hops'), gist: t('recipe_section_yeast'), overig: t('recipe_section_other'),
  }
  const minuten = (n: any) => `${n} ${t('lbl_minuten')}`
  const taal = getLang()
  const abv = Number(recept?.ABV)
  const subregel = [
    recept?.stijl,
    readOnly
      ? [recept?.versie || t('recipe_version_snapshot'), recept?.versie_datum ? fmtD(String(recept.versie_datum).slice(0, 10)) : ''].filter(Boolean).join(' ')
      : '',
    recept?.auteur ? t('recipe_door').replace('{auteur}', recept.auteur) : '',
  ].filter(Boolean).join(' · ')
  const kookRegel = [
    recept?.kooktijd ? t('recept_kooktijd_kort').replace('{n}', String(recept.kooktijd)) : '',
    recept?.kook_volume ? t('recept_kookvolume_kort').replace('{n}', String(recept.kook_volume)) : '',
  ].filter(Boolean).join(' · ')
  const voorraadChip = oordeel.status === 'klaar' ? { cls: 'bg-green-100 text-green-700', tekst: t('recept_klaar_brouwen') }
    : oordeel.status === 'tekort' ? { cls: 'bg-red-100 text-red-700', tekst: t('recept_tekort') }
    : oordeel.status === 'bijna' ? { cls: 'bg-yellow-100 text-yellow-700', tekst: t('recept_controleer') }
    : { cls: 'bg-gray-100 text-gray-500', tekst: t('recept_onbekend_voorraad') }
  const heeftIngredienten = SECTIES.some(cat => (recept?.[cat] || []).length > 0)

  return (
    <div className="bg-white rounded-xl shadow-card border border-gray-100 p-4 md:p-6 min-w-0">
      {readOnly && hoofd && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0">{t('recept_versie_banner').replace('{recept}', hoofd.naam || t('lbl_naamloos'))}</span>
          <button type="button" onClick={() => p.onOpenRecept(String(hoofd.id))}
            className="font-medium underline-offset-2 hover:underline min-h-tap md:min-h-0">
            {t('recept_naar_huidige_versie')} <span aria-hidden="true">›</span>
          </button>
        </div>
      )}

      {/* Kop: naam, stijl en de ketenchip; rechts Brouwen (bureau) en ⋯. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl md:text-[22px] leading-tight font-bold text-gray-900 break-words">{recept?.naam || t('lbl_naamloos')}</h3>
          {subregel && <p className="text-sm text-gray-500 mt-1 break-words">{subregel}</p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {(gebruik?.producten || []).map(ref => (
              <button key={ref.productId} type="button" onClick={() => p.onOpenProduct(ref.productId)}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] text-xs t-panel hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <span className="text-gray-600">{t('recept_chip_product')}</span>
                <span className="font-semibold t-accent-text">{ref.naam} <span aria-hidden="true">›</span></span>
              </button>
            ))}
            {gebruik?.vastgepind && <ReceptChip soort="grijs">{t('recept_chip_vastgepind')}</ReceptChip>}
            {gebruik?.status === 'verborgen' && <ReceptChip soort="grijs">{t('recept_chip_verborgen')}</ReceptChip>}
            {(gebruik?.nietInBrewfather || recept?.niet_in_brewfather) && <ReceptChip soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {p.onBrouwen && <span className="hidden md:inline-flex"><Btn onClick={p.onBrouwen}>{t('btn_brouwen')}</Btn></span>}
          {p.acties.length > 0 && <RowActions v="kaart" acties={p.acties} />}
        </div>
      </div>

      {gebruik && (
        <ReceptVerbindingen recept={recept} gebruik={gebruik} batchRegels={batchRegels} versies={versies}
          recepten={p.recepten} producten={p.producten} batches={p.batches} ingredienten={p.ingredienten} lots={p.lots}
          verkoopCtx={p.verkoopCtx} onKoppel={p.onKoppel} onOpenRecept={p.onOpenRecept}
          onOpenBatch={p.onOpenBatch} onOpenProduct={p.onOpenProduct} />
      )}

      <div className="grid grid-cols-3 min-[1300px]:grid-cols-6 gap-2 md:gap-3 mt-5">
        <Tegel label={t('batch_info_og')} waarde={fmtSg(recept?.OG)} />
        <Tegel label={t('batch_info_fg')} waarde={fmtSg(recept?.FG)} />
        <Tegel label={t('bier_veld_abv')} waarde={abv > 0 ? `${fmtGetal(abv, 1, taal)} %` : '—'} />
        <Tegel label={t('bier_veld_ibu')} waarde={recept?.IBU ? String(Math.round(Number(recept.IBU))) : '—'} />
        <Tegel label={t('recipe_kleur')} waarde={recept?.kleur ? String(Math.round(Number(recept.kleur))) : '—'} />
        <Tegel label={t('recipe_batchgrootte')} waarde={recept?.batch_size ? `${recept.batch_size} L` : '—'} />
      </div>
      {kookRegel && <p className="text-xs text-gray-500 mt-2">{kookRegel}</p>}

      {heeftIngredienten && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="text-base font-semibold text-gray-900">{t('recept_ingredienten')}</h4>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${voorraadChip.cls}`}>{voorraadChip.tekst}</span>
          </div>
          {SECTIES.map(cat => (
            <IngredientSectie key={cat} titel={sectieTitel[cat]} cat={cat}
              items={recept?.[cat]} voorraad={voorraad[cat] || []}
              ingredienten={p.ingredienten || []} readOnly={readOnly}
              onWijzig={p.onWijzigRegel} onWisLokaal={p.onWisLokaal} />
          ))}
        </div>
      )}

      <div className="space-y-3 mt-2">
        {recept?.maischprofiel?.length > 0 && (
          <Uitklap titel={t('recipe_mash_profile')}>
            <ProfielTabel rijen={recept.maischprofiel.map((s: any, i: number) => [
              s.naam || s.type || t('lbl_stap_n').replace('{n}', String(i + 1)),
              s.temp ? `${s.temp} °C` : '—', s.tijd ? minuten(s.tijd) : '—', s.rampTijd ? minuten(s.rampTijd) : '—',
            ])} />
          </Uitklap>
        )}
        {recept?.vergistingsprofiel?.length > 0 && (
          <Uitklap titel={t('recipe_ferm_profile')}>
            <ProfielTabel rijen={recept.vergistingsprofiel.map((s: any, i: number) => [
              s.type || t('lbl_stap_n').replace('{n}', String(i + 1)),
              s.temp ? `${s.temp} °C` : '—',
              s.tijd ? t('duur_dagen_kort').replace('{n}', String(s.tijd)) : '—',
              s.ramp ? t('duur_uren_kort').replace('{n}', String(s.ramp)) : '—',
            ])} />
          </Uitklap>
        )}
        {/* ReceptKostprijs is zelf al een kaart (met marge onder); hier in de rij. */}
        <div className="[&>div]:mb-0">
        <ReceptKostprijs
          recept={recept}
          ingredienten={p.ingredienten}
          lots={p.lots}
          batches={p.batches}
          afvullingen={p.afvullingen}
          verliesRegistraties={p.verliesRegistraties}
          inkoopFacturen={p.inkoopFacturen}
          verpakkingen={p.verpakkingen}
          onderdelen={p.onderdelen}
          accijnsInst={p.accijnsInst}
          readOnly={readOnly}
          onWijzig={p.onWijzig}
        />
        </div>
        {recept?.notities && (
          <Uitklap titel={t('lbl_notes')}>
            <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{recept.notities}</div>
          </Uitklap>
        )}
      </div>

      {/* Telefoon: Brouwen onderin, op duimhoogte, in de vaste ActieBalk
          (detailscherm: geen onderbalk). Op het bureau staat hij in de kop. */}
      {p.onBrouwen && <ActieBalk alleenTelefoon label={t('btn_brouwen')} onClick={p.onBrouwen} />}
    </div>
  )
}

/** Een profieltabel (stap, temperatuur, tijd, opwarmen) — vier smalle kolommen, past ook op een telefoon. */
const ProfielTabel: React.FC<{ rijen: string[][] }> = ({ rijen }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="text-gray-500 border-b border-gray-200">
        <th className="text-left pb-1.5 font-medium">{t('recipe_step_name')}</th>
        <th className="text-right pb-1.5 font-medium">{t('recipe_step_temp')}</th>
        <th className="text-right pb-1.5 font-medium">{t('recipe_step_time')}</th>
        <th className="text-right pb-1.5 font-medium">{t('recipe_step_ramp')}</th>
      </tr>
    </thead>
    <tbody>
      {rijen.map((r, i) => (
        <tr key={i} className="border-b border-gray-100 last:border-0">
          <td className="py-1.5 pr-2 text-gray-800 break-words">{r[0]}</td>
          <td className="py-1.5 text-right text-gray-700 whitespace-nowrap">{r[1]}</td>
          <td className="py-1.5 text-right text-gray-700 whitespace-nowrap">{r[2]}</td>
          <td className="py-1.5 text-right text-gray-700 whitespace-nowrap">{r[3]}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

export default ReceptDetail
