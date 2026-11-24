import React from 'react'
import { t, getLang } from '../../i18n'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'
import Btn from '../ui/Btn'
import { haGetHistory } from '../../utils/api'
import {
  doseringTekst, middelBruikbaar, stapVoorMiddel, retourOordeel, beoordeelConcentratie,
  beoordeelNaspoelPh, type StapConcept,
} from '../../utils/reinigingsmiddelen'
import type { ReinigingsMiddel } from '../../types'

// De middelen bij een reiniging (tank, vuller, schoonmaaktaak): kies het
// middel, de dosering staat er al. Daaronder wat het plan vraagt: de
// concentratie, de pH van het naspoelwater tegen die van het leidingwater, en
// bij heet water hoe lang het retourwater op temperatuur was — uit de
// retoursensor in Home Assistant, of met de hand.

interface Props {
  middelen: ReinigingsMiddel[]
  stappen: StapConcept[]
  setStappen: (f: (prev: StapConcept[]) => StapConcept[]) => void
  /** De retoursensor (HA-entiteit) voor deze tank; zonder: met de hand. */
  retourEntity?: string
  vandaag: string
  /** pH van het leidingwater van de vorige keer (voor een nieuwe regel). */
  phLeiding?: number | null
}

const VENSTERS = [1, 3, 6, 12, 24]

const uur = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const ReinigingStappen: React.FC<Props> = ({ middelen, stappen, setStappen, retourEntity, vandaag, phLeiding }) => {
  const taal = getLang()
  const bruikbaar = middelen.filter(m => m && !m.gearchiveerd && middelBruikbaar(m, vandaag))
  const geweigerd = middelen.filter(m => m && !m.gearchiveerd && !middelBruikbaar(m, vandaag))
  const [venster, setVenster] = React.useState('3')
  const [bezig, setBezig] = React.useState<number | null>(null)
  const [fout, setFout] = React.useState<Record<number, string>>({})

  const zet = (i: number, f: (s: StapConcept) => StapConcept) => setStappen(prev => prev.map((s, j) => j === i ? f(s) : s))
  const voegToe = () => {
    const gebruikt = new Set(stappen.map(s => s.middel_id))
    const m = bruikbaar.find(x => !gebruikt.has(x.id)) || bruikbaar[0]
    if (m) setStappen(prev => [...prev, stapVoorMiddel(m, phLeiding)])
  }

  const haalRetour = async (i: number, m: ReinigingsMiddel) => {
    if (!retourEntity) return
    setBezig(i)
    setFout(f => ({ ...f, [i]: '' }))
    try {
      const eind = new Date()
      const start = new Date(eind.getTime() - Number(venster) * 3600_000)
      const punten = await haGetHistory(retourEntity, start.toISOString(), eind.toISOString())
      const r = retourOordeel(punten, {
        drempel: m.temp_min_c ?? 82, minuten: m.contacttijd_min ?? 15, eind: eind.toISOString(),
      })
      zet(i, s => ({ ...s, retour_sensor: { ...r, entity: retourEntity } }))
      if (!r.punten) setFout(f => ({ ...f, [i]: t('reiniging_retour_geen_punten') }))
    } catch (e) {
      setFout(f => ({ ...f, [i]: t('reiniging_retour_fout').replace('{fout}', e instanceof Error ? e.message : '') }))
    } finally {
      setBezig(null)
    }
  }

  const opties = bruikbaar.map(m => ({ v: String(m.id), l: m.naam }))

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-gray-700">{t('reiniging_middelen')}</div>
      {stappen.map((s, i) => {
        const m = middelen.find(x => x.id === s.middel_id)
        if (!m) return null
        const dosering = doseringTekst(m, t, taal)
        const conc = beoordeelConcentratie(m, s.concentratie)
        const naspoel = beoordeelNaspoelPh(s.ph_naspoel, s.ph_leiding)
        const r = s.retour_sensor
        return (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <Sel label={t('reiniging_middel_n').replace('{n}', String(i + 1))} value={String(s.middel_id)}
                  onChange={v => { const nm = middelen.find(x => x.id === Number(v)); if (nm) zet(i, () => stapVoorMiddel(nm, phLeiding)) }}
                  opts={opties.some(o => o.v === String(m.id)) ? opties : [{ v: String(m.id), l: m.naam }, ...opties]} />
              </div>
              <button type="button" onClick={() => setStappen(prev => prev.filter((_, j) => j !== i))}
                aria-label={t('reiniging_middel_weg')} title={t('reiniging_middel_weg')}
                className="min-h-tap sm:min-h-[36px] px-2 text-gray-500 hover:text-red-700">✕</button>
            </div>
            {dosering && <p className="text-xs text-gray-600 cijfer">{t('reiniging_voorschrift').replace('{dosering}', dosering)}</p>}

            {m.soort !== 'thermisch' && !m.onverdund && (m.dosering_min_pct != null || m.dosering_max_pct != null) && (
              <div className="grid grid-cols-2 gap-2 items-end">
                <Inp label={t('reiniging_concentratie')} type="number" step="0.1" value={s.concentratie}
                  onChange={v => zet(i, x => ({ ...x, concentratie: v }))} />
                <span className={`text-xs pb-2 ${conc === 'binnen' ? 'text-green-700' : conc === 'onbekend' ? 'text-gray-500' : 'text-orange-700'}`}>
                  {conc !== 'onbekend' ? t(`reiniging_conc_${conc}`) : ''}
                </span>
              </div>
            )}

            {m.naspoelen && (
              <div className="grid grid-cols-2 gap-2">
                <Inp label={t('reiniging_ph_naspoel')} type="number" step="0.1" value={s.ph_naspoel}
                  onChange={v => zet(i, x => ({ ...x, ph_naspoel: v }))} />
                <Inp label={t('reiniging_ph_leiding')} type="number" step="0.1" value={s.ph_leiding}
                  onChange={v => zet(i, x => ({ ...x, ph_leiding: v }))} />
                {naspoel !== 'onbekend' && (
                  <p className={`col-span-2 text-xs ${naspoel === 'ok' ? 'text-green-700' : 'text-orange-700'}`}>
                    {t(`reiniging_naspoel_${naspoel}`)}
                  </p>
                )}
              </div>
            )}

            {m.soort === 'thermisch' && (
              retourEntity ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-36">
                      <Sel label={t('reiniging_retour_venster')} value={venster} onChange={setVenster}
                        opts={VENSTERS.map(u => ({ v: String(u), l: t('reiniging_retour_uur').replace('{n}', String(u)) }))} />
                    </div>
                    <Btn s="sm" v="secondary" disabled={bezig === i} onClick={() => { void haalRetour(i, m) }}>
                      {bezig === i ? t('reiniging_retour_bezig') : t('reiniging_retour_ophalen')}
                    </Btn>
                  </div>
                  {r && r.punten > 0 && (
                    <p className={`text-sm ${r.gehaald ? 'text-green-700' : 'text-orange-700'}`}>
                      {(r.gehaald ? t('reiniging_retour_gehaald') : t('reiniging_retour_niet_gehaald'))
                        .replace('{drempel}', String(r.drempel)).replace('{min}', String(r.minutenBoven))
                        .replace('{nodig}', String(r.minuten)).replace('{van}', uur(r.van)).replace('{tot}', uur(r.tot))
                        .replace('{max}', r.max != null ? String(Math.round(r.max * 10) / 10).replace('.', ',') : '—')}
                    </p>
                  )}
                  {fout[i] && <p className="text-xs text-red-700">{fout[i]}</p>}
                  <p className="text-xs text-gray-500">{t('reiniging_retour_sensor_uitleg').replace('{entity}', retourEntity)}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Inp label={t('reiniging_retour_max')} type="number" value={s.retour_max}
                    onChange={v => zet(i, x => ({ ...x, retour_max: v }))} />
                  <Inp label={t('reiniging_retour_minuten')} type="number" value={s.retour_minuten}
                    onChange={v => zet(i, x => ({ ...x, retour_minuten: v }))} />
                  <p className="col-span-2 text-xs text-gray-500">{t('reiniging_retour_geen_sensor')}</p>
                </div>
              )
            )}

          </div>
        )
      })}
      {bruikbaar.length > 0 && (
        <button type="button" onClick={voegToe}
          className="text-sm font-medium t-accent-text underline underline-offset-2 min-h-tap sm:min-h-0">
          + {t('reiniging_middel_toevoegen')}
        </button>
      )}
      {geweigerd.length > 0 && (
        <p className="text-xs text-gray-500">
          {t('reiniging_middel_geweigerd').replace('{namen}', geweigerd.map(m => m.naam).join(', '))}
        </p>
      )}
    </div>
  )
}

export default ReinigingStappen
