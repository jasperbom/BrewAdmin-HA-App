import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtGetal } from '../../utils/etiket'
import {
  INSTALLATIE_VELDEN, brewfatherProfielen, brouwVolumes, getal, profielVoorOpslag,
} from '../../utils/installatie'
import type { InstallatieVeld } from '../../utils/installatie'
import { profielCheck } from '../../utils/profielCheck'
import type { InstallatieProfiel, Tank } from '../../types'
import Blad from '../ui/Blad'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'

// Het installatieprofiel van één tank (Instellingen › Tanks): het werkvolume
// van de tank en de brouwinstallatie die erin uitkomt — volumes, verliezen en
// rendement, zoals een installatieprofiel in Brewfather. Daarmee schaalt *Wat
// brouw je?* een recept naar deze tank en rekent de brouwdag het water uit.
//
// Overnemen uit Brewfather: de profielen die met de recepten zijn
// meegekomen (de API geeft ze niet los). Daaronder de profielcheck: wat de
// brouwdagen in deze tank laten zien, met de gemeten waarde als voorstel.
// Rekenen gebeurt in utils/installatie.ts en utils/profielCheck.ts.

export interface InstallatieProfielOpslag {
  werkvolume_max_l: number | ''
  werkvolume_min_l: number | ''
  installatie: InstallatieProfiel
}

interface Props {
  tank: Tank
  recepten: any[]
  batches: any[]
  afvullingen?: any[]
  vandaag: string
  onOpslaan: (waarden: InstallatieProfielOpslag) => void
  onSluit: () => void
}

/** De eenheid achter een veld, als i18n-sleutel. */
const EENHEID: Record<InstallatieVeld, string> = {
  batch_l: 'eenheid_l',
  kooktijd_min: 'eenheid_min',
  kookverlies_l_per_uur: 'eenheid_l_per_uur',
  trub_koeler_verlies_l: 'eenheid_l',
  verlies_vergistingsvat_l: 'eenheid_l',
  maischketel_deadspace_l: 'eenheid_l',
  maischrendement_pct: 'eenheid_pct',
  graanabsorptie_l_per_kg: 'eenheid_l_per_kg',
  water_graan_l_per_kg: 'eenheid_l_per_kg',
  krimp_pct: 'eenheid_pct',
  spoelwater_temp_c: 'eenheid_c',
  heetwatertank_max_l: 'eenheid_l',
}

/** Wat een leeg veld betekent (de standaard waarmee gerekend wordt), als i18n-sleutel; leeg = geen. */
const LEEG_BETEKENT: Partial<Record<InstallatieVeld, string>> = {
  kooktijd_min: 'inst_leeg_kooktijd',
  krimp_pct: 'inst_leeg_krimp',
  graanabsorptie_l_per_kg: 'inst_leeg_absorptie',
}

type Formulier = Record<InstallatieVeld, string>

const naarTekst = (v: unknown): string => {
  const n = getal(v)
  return n == null ? '' : String(n)
}

const formulierVan = (p: InstallatieProfiel | null | undefined): Formulier =>
  Object.fromEntries(INSTALLATIE_VELDEN.map(v => [v, naarTekst(p?.[v])])) as Formulier

const InstallatieProfielBlad: React.FC<Props> = ({ tank, recepten, batches, afvullingen = [], vandaag, onOpslaan, onSluit }) => {
  const taal = getLang()
  const [form, setForm] = React.useState<Formulier>(() => formulierVan(tank.installatie))
  const [maxL, setMaxL] = React.useState(naarTekst(tank.werkvolume_max_l))
  const [minL, setMinL] = React.useState(naarTekst(tank.werkvolume_min_l))
  const [herkomst, setHerkomst] = React.useState<Pick<InstallatieProfiel, 'bron' | 'bf_naam' | 'bf_recept'>>(() => ({
    bron: tank.installatie?.bron, bf_naam: tank.installatie?.bf_naam, bf_recept: tank.installatie?.bf_recept,
  }))
  const [overgenomen, setOvergenomen] = React.useState<string | null>(null)

  const zet = (veld: InstallatieVeld) => (v: string) => {
    setForm(f => ({ ...f, [veld]: v }))
    setHerkomst(h => (h.bron === 'brewfather' ? { ...h, bron: 'handmatig' } : h))
    setOvergenomen(null)
  }

  const bfProfielen = React.useMemo(() => brewfatherProfielen(recepten), [recepten])
  const neemOver = (sleutel: string) => {
    const keuze = bfProfielen.find(x => x.sleutel === sleutel)
    if (!keuze) return
    // Velden die het Brewfather-profiel niet noemt (heetwatertank) blijven staan.
    setForm(f => {
      const nieuw = formulierVan(keuze.installatie)
      return Object.fromEntries(INSTALLATIE_VELDEN.map(v => [v, nieuw[v] !== '' ? nieuw[v] : f[v]])) as Formulier
    })
    setHerkomst({ bron: 'brewfather', bf_naam: keuze.naam || undefined, bf_recept: keuze.recept || undefined })
    setOvergenomen(keuze.naam || keuze.recept)
  }

  const profiel = React.useMemo(() => profielVoorOpslag({ ...form, ...herkomst }, vandaag), [form, herkomst, vandaag])
  const volumes = brouwVolumes(profiel)
  const check = React.useMemo(() => profielCheck(tank.id, profiel, { batches, afvullingen }), [tank.id, profiel, batches, afvullingen])
  const gemeten = check.filter(r => r.n > 0)

  const opslaan = () => {
    const n = (s: string): number | '' => {
      const g = getal(s)
      return g != null && g > 0 ? g : ''
    }
    onOpslaan({ werkvolume_max_l: n(maxL), werkvolume_min_l: n(minL), installatie: profiel })
  }

  const L = (x: number) => `${fmtGetal(Math.round(x * 10) / 10, 1, taal)} L`
  const waarde = (veld: InstallatieVeld, x: number | null) =>
    x == null ? '—' : `${fmtGetal(x, 1, taal)} ${t(EENHEID[veld])}`

  return (
    <Blad titel={t('inst_titel').replace('{tank}', tank.naam || tank.id)} onSluit={onSluit} onKlaar={opslaan} klaarLabel={t('btn_save')} wide>
      <p className="text-sm text-gray-600">{t('inst_uitleg')}</p>

      {/* ── De tank zelf ── */}
      <section>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">{t('inst_tank_titel')}</h4>
        <div className="grid grid-cols-2 gap-3 md:max-w-md">
          <Inp label={`${t('inst_werkvolume_max')} (${t('eenheid_l')})`} type="number" min={0} step="any" value={maxL} onChange={setMaxL} />
          <Inp label={`${t('inst_werkvolume_min')} (${t('eenheid_l')})`} type="number" min={0} step="any" value={minL} onChange={setMinL} />
        </div>
      </section>

      {/* ── Overnemen uit Brewfather ── */}
      <section className="rounded-xl bg-gray-50 px-3.5 py-3">
        <h4 className="text-sm font-semibold text-gray-800 mb-1">{t('inst_bf_titel')}</h4>
        {bfProfielen.length === 0 ? (
          <p className="text-sm text-gray-600">{t('inst_bf_geen')}</p>
        ) : (
          <Sel value="" onChange={neemOver} ariaLabel={t('inst_bf_titel')} ph={t('inst_bf_kies')}
            opts={bfProfielen.map(x => ({
              v: x.sleutel,
              l: x.naam ? t('inst_bf_optie').replace('{profiel}', x.naam).replace('{recept}', x.recept || t('lbl_naamloos')) : (x.recept || t('lbl_naamloos')),
            }))} />
        )}
        {overgenomen && <p className="text-xs text-green-700 mt-1">{t('inst_bf_overgenomen').replace('{profiel}', overgenomen)}</p>}
        {!overgenomen && herkomst.bron === 'brewfather' && herkomst.bf_naam && (
          <p className="text-xs text-gray-500 mt-1">{t('inst_bf_herkomst').replace('{profiel}', herkomst.bf_naam)}</p>
        )}
      </section>

      {/* ── De installatie ── */}
      <section>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">{t('inst_installatie_titel')}</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {INSTALLATIE_VELDEN.map(veld => (
            <div key={veld} className="min-w-0">
              <Inp label={`${t(`inst_veld_${veld}`)} (${t(EENHEID[veld])})`} type="number" min={0} step="any"
                value={form[veld]} onChange={zet(veld)} />
              {form[veld] === '' && LEEG_BETEKENT[veld] && (
                <p className="text-xs text-gray-500 mt-1">{t(LEEG_BETEKENT[veld] as string)}</p>
              )}
            </div>
          ))}
        </div>
        {volumes && (
          <p className="text-sm text-gray-700 mt-3 cijfer break-words">
            {t('inst_voorbeeld')
              .replace('{batch}', L(volumes.batch_l))
              .replace('{voor}', L(volumes.voor_koken_l))
              .replace('{na}', L(volumes.na_koken_l))
              .replace('{bottel}', L(volumes.bottel_l))}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">{t('inst_ook_brewfather')}</p>
      </section>

      {/* ── Profielcheck: wat de brouwdagen laten zien ── */}
      <section>
        <h4 className="text-sm font-semibold text-gray-800 mb-1">{t('inst_check_titel')}</h4>
        {gemeten.length === 0 ? (
          <p className="text-sm text-gray-600">{t('inst_check_geen')}</p>
        ) : (
          <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
            {gemeten.map(r => (
              <div key={r.veld} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-gray-900">{t(`inst_veld_${r.veld}`)}</div>
                  <div className={`text-xs ${r.afwijkend ? 'text-orange-700' : 'text-gray-500'}`}>
                    {t('inst_check_regel')
                      .replace('{gemeten}', waarde(r.veld, r.gemeten))
                      .replace('{n}', String(r.n))
                      .replace('{profiel}', waarde(r.veld, r.profiel))}
                  </div>
                </div>
                {r.afwijkend && r.gemeten != null && (
                  <button type="button" onClick={() => zet(r.veld)(String(r.gemeten))}
                    className="text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    {t('inst_check_gebruik')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </Blad>
  )
}

export default InstallatieProfielBlad
