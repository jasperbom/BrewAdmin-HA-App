import React, { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import Btn from './ui/Btn'
import { ruimteklimaatStatus } from '../utils/api'
import type { KlimaatRichting, RuimteklimaatInst } from '../types'
import {
  KLIMAAT_RICHTINGEN, RUIMTEKLIMAAT_DEFAULTS, RuimteklimaatDrempel, RuimteklimaatStatus,
  klimaatLaatsteActieTekst, klimaatStatusTekst, klimaatToon, magRichting, ruimteklimaatInst,
} from '../utils/ruimteklimaat'

// Instellingen → Home Assistant → "Airco voor de tanks". De server zet de airco
// zelf aan en uit (`_ruimteklimaat_tick`); hier kies je de airco, wat hij mag
// (koelen, verwarmen of beide), welke tanks in zijn ruimte staan en wanneer, en
// zie je wat hij nu doet.

const DREMPELS: Array<{sleutel: RuimteklimaatDrempel, label: string, hint: string, eenheid: string, stap: number}> = [
  {sleutel: 'start_marge', label: 'settings_rk_start_marge', hint: 'settings_rk_start_marge_hint', eenheid: 'eenheid_graad',     stap: 0.1},
  {sleutel: 'start_min',   label: 'settings_rk_start_min',   hint: 'settings_rk_start_min_hint',   eenheid: 'eenheid_minuut',    stap: 5},
  {sleutel: 'herstel',     label: 'settings_rk_herstel',     hint: 'settings_rk_herstel_hint',     eenheid: 'eenheid_graad_uur', stap: 0.1},
  {sleutel: 'stop_marge',  label: 'settings_rk_stop_marge',  hint: 'settings_rk_stop_marge_hint',  eenheid: 'eenheid_graad',     stap: 0.1},
  {sleutel: 'stop_min',    label: 'settings_rk_stop_min',    hint: 'settings_rk_stop_min_hint',    eenheid: 'eenheid_minuut',    stap: 5},
]

const TOON_KLASSE = {
  accent: 't-accent-text font-medium',
  oranje: 'text-orange-700',
  rood: 'text-red-600',
  grijs: 'text-gray-500',
} as const

interface RuimteklimaatInstellingenProps {
  inst: RuimteklimaatInst | undefined
  setInst: (v: RuimteklimaatInst) => void
  /** Staat de hoofdschakelaar van de sensoren aan? Zonder metingen beslist de app niets. */
  sensorenAan: boolean
  tanks: Array<{id: string, naam?: string}>
  /** Tank-id's met een gekoppelde temperatuursensor. */
  sensorTanks: string[]
  /** De entity-kiezer van de instellingenpagina (zoeken + lijst na "Entities ophalen"). */
  renderEntityPicker: (domain: string, pickerKey: string, value: string,
                       onChange: (v: string) => void, placeholder: string) => React.ReactNode
  onOntdek: () => void
  ontdekBezig: boolean
  onAudit: (omschrijving: string) => void
}

export default function RuimteklimaatInstellingen({
  inst: ruw, setInst, sensorenAan, tanks, sensorTanks, renderEntityPicker, onOntdek, ontdekBezig, onAudit,
}: RuimteklimaatInstellingenProps) {
  const inst: RuimteklimaatInst = ruw && typeof ruw === 'object' ? ruw : {}
  const cfg = ruimteklimaatInst(inst)
  const [status, setStatus] = useState<RuimteklimaatStatus>({})

  const laadStatus = useCallback(() => { ruimteklimaatStatus().then(setStatus) }, [])
  useEffect(() => {
    if (!cfg.enabled) return
    laadStatus()
    const id = window.setInterval(laadStatus, 60_000)
    return () => window.clearInterval(id)
  }, [cfg.enabled, laadStatus])

  const zet = (patch: Partial<RuimteklimaatInst>) => setInst({...inst, ...patch})
  // Een leeggemaakt getalveld verdwijnt uit de opslag: dan geldt de default.
  const zetGetal = (sleutel: keyof RuimteklimaatInst, waarde: string) => {
    const n = waarde === '' ? NaN : Number(waarde)
    const volgende: any = {...inst}
    if (Number.isFinite(n)) volgende[sleutel] = n
    else delete volgende[sleutel]
    setInst(volgende)
  }
  // Geen tank aangevinkt = alle tanks met een sensor. Vink je er één uit
  // terwijl "alle" gold, dan blijven de andere aangevinkt.
  const gekozen = inst.tanks && inst.tanks.length ? inst.tanks : sensorTanks
  const zetTank = (tank: string, aan: boolean) => {
    const nieuw = aan ? [...new Set([...gekozen, tank])] : gekozen.filter(x => x !== tank)
    const alles = sensorTanks.length > 0 && sensorTanks.every(x => nieuw.includes(x))
    zet({tanks: alles ? [] : nieuw})
  }
  const tankNaam = (id: string) => {
    const tk = tanks.find(x => String(x.id) === id)
    return tk?.naam ? `${id} (${tk.naam})` : id
  }
  const temperatuurVeld = (veld: 'koelen_tot' | 'verwarmen_tot', label: string) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-0.5">{t(label)}</label>
      <div className="flex items-center gap-1">
        <input type="number" step={0.5} min={5} max={35} value={cfg[veld]}
          onChange={e => zetGetal(veld, e.target.value)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 t-input" />
        <span className="text-xs text-gray-400">°C</span>
      </div>
    </div>
  )
  // De status hoort bij de airco die nu gekozen is.
  const st = cfg.enabled && cfg.entity && status.entity === cfg.entity ? status : undefined
  const laatst = klimaatLaatsteActieTekst(st)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('settings_rk_title')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('settings_rk_desc')}</p>

      <label className="flex items-center gap-3 cursor-pointer w-fit mb-5">
        <div className="relative">
          <input type="checkbox" checked={cfg.enabled}
            onChange={e => { zet({enabled: e.target.checked}); onAudit(`Airco voor de tanks ${e.target.checked ? 'ingeschakeld' : 'uitgeschakeld'}`) }}
            className="sr-only peer" />
          <div className="w-10 h-6 bg-gray-200 rounded-full peer t-toggle after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
        </div>
        <span className="text-sm font-medium text-gray-700">{t('lbl_ingeschakeld')}</span>
      </label>

      {!sensorenAan && <p className="text-sm text-orange-600 mb-4">{t('settings_rk_sensoren_uit')}</p>}

      <div className="space-y-4">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_rk_airco')}</label>
            {renderEntityPicker('climate', 'rk:airco', inst.entity || '',
              v => zet({entity: v}), 'climate.airco')}
          </div>
          <Btn v="secondary" s="sm" onClick={onOntdek} disabled={ontdekBezig}>
            {ontdekBezig ? t('settings_ha_loading') : t('settings_ha_discover')}
          </Btn>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{t('settings_rk_richting')}</label>
            <select value={cfg.richting} onChange={e => zet({richting: e.target.value as KlimaatRichting})}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm t-input bg-white">
              {KLIMAAT_RICHTINGEN.map(r => <option key={r} value={r}>{t(`settings_rk_richting_${r}`)}</option>)}
            </select>
          </div>
          {magRichting(cfg.richting, 'koelen') && temperatuurVeld('koelen_tot', 'settings_rk_koelen_tot')}
          {magRichting(cfg.richting, 'verwarmen') && temperatuurVeld('verwarmen_tot', 'settings_rk_verwarmen_tot')}
        </div>

        <div>
          <span className="block text-xs font-medium text-gray-500 mb-1">{t('settings_rk_tanks')}</span>
          {sensorTanks.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {sensorTanks.map(tank => (
                <label key={tank} className="flex items-center gap-2 text-sm text-gray-700 min-h-tap sm:min-h-0">
                  <input type="checkbox" className="t-checkbox" checked={gekozen.includes(tank)}
                    onChange={e => zetTank(tank, e.target.checked)} />
                  {tankNaam(tank)}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">{t('settings_rk_geen_sensortanks')}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">{t('settings_rk_tanks_hint')}</p>
        </div>

        {cfg.enabled && cfg.entity && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm">
            <p className={TOON_KLASSE[klimaatToon(st)]}>{klimaatStatusTekst(st, Date.now(), cfg)}</p>
            {laatst && <p className="text-xs text-gray-400 mt-0.5">{laatst}</p>}
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">{t('settings_rk_wanneer')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DREMPELS.map(veld => (
            <div key={veld.sleutel}>
              <label className="block text-xs font-semibold text-gray-500 mb-1">{t(veld.label)}</label>
              <div className="flex items-center gap-2">
                <input type="number" step={veld.stap} min={0}
                  value={(inst as any)[veld.sleutel] ?? RUIMTEKLIMAAT_DEFAULTS[veld.sleutel]}
                  onChange={e => zetGetal(veld.sleutel, e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 t-input" />
                <span className="text-xs text-gray-400">{t(veld.eenheid)}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{t(veld.hint)}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 pt-4 border-t text-xs text-gray-400">{t('settings_rk_hint')}</p>
    </div>
  )
}
