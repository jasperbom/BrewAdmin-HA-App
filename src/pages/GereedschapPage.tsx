import React, { useState } from 'react'
import { t } from '../i18n'
import { ZUUR_MIDDELEN } from '../utils/constants'
import { berekenZuurCorrectieMaisch, berekenZuurCorrectieWater } from '../utils/calculations'
import Inp from '../components/ui/Inp'
import Sel from '../components/ui/Sel'
import SectionHeader from '../components/ui/SectionHeader'

interface GereedschapPageProps {
  tool?: string
}

// ── pH-correctie gereedschap ─────────────────────────────────────────────────
// Berekent hoeveel zuur er nodig is om een volume vloeistof (water/wort/maisch)
// van de huidige pH naar de doel-pH te brengen. De zuurmiddelen komen uit
// ZUUR_MIDDELEN — voorlopig alleen melkzuur 80%, later eenvoudig uit te breiden.
type PhModus = 'maisch' | 'water'

const PhCorrectieTool: React.FC = () => {
  const [modus, setModus] = useState<PhModus>('maisch')
  const [volume, setVolume] = useState('')
  const [phHuidig, setPhHuidig] = useState('')
  const [phDoel, setPhDoel] = useState('5.3')
  const [alkaliniteit, setAlkaliniteit] = useState('')
  const [middelKey, setMiddelKey] = useState(ZUUR_MIDDELEN[0]?.key || '')

  const middel = ZUUR_MIDDELEN.find(m => m.key === middelKey) || ZUUR_MIDDELEN[0]
  const middelOpts = ZUUR_MIDDELEN.map(m => ({ v: m.key, l: t(m.labelKey) }))

  const res = modus === 'maisch'
    ? berekenZuurCorrectieMaisch(parseFloat(volume), parseFloat(phHuidig), parseFloat(phDoel), middel)
    : berekenZuurCorrectieWater(parseFloat(volume), parseFloat(alkaliniteit), middel)
  const doelOnderHuidig = modus === 'maisch' && phHuidig !== '' && phDoel !== '' && parseFloat(phDoel) >= parseFloat(phHuidig)
  // ~80% vooraf doseren, daarna meten en bijdoseren (gangbare praktijk)
  const vooraf = res ? res.ml * 0.8 : 0

  const TabKnop = ({m, label}: {m: PhModus, label: string}) => (
    <button
      onClick={() => setModus(m)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${modus === m ? 't-tab text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
      style={modus === m ? {backgroundColor: 'var(--t-accent)'} : undefined}
    >
      {label}
    </button>
  )

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden t-card-l">
      <SectionHeader solid title={t('tool_ph_titel')} />
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <TabKnop m="maisch" label={t('tool_ph_modus_maisch')} />
          <TabKnop m="water" label={t('tool_ph_modus_water')} />
        </div>

        <p className="text-sm text-gray-600">
          {modus === 'maisch' ? t('tool_ph_uitleg_maisch') : t('tool_ph_uitleg_water')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp label={t('tool_ph_volume')} value={volume} onChange={setVolume} type="number" step="0.1" placeholder="20" />
          <Sel label={t('tool_ph_middel')} value={middelKey} onChange={setMiddelKey} opts={middelOpts} />
          {modus === 'maisch' ? (
            <>
              <Inp label={t('tool_ph_huidig')} value={phHuidig} onChange={setPhHuidig} type="number" step="0.01" placeholder="5.60" />
              <Inp label={t('tool_ph_doel')} value={phDoel} onChange={setPhDoel} type="number" step="0.01" placeholder="5.30" />
            </>
          ) : (
            <Inp label={t('tool_ph_alkaliniteit')} value={alkaliniteit} onChange={setAlkaliniteit} type="number" step="1" placeholder="120" />
          )}
        </div>

        {doelOnderHuidig ? (
          <div className="text-sm px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700">
            {t('tool_ph_doel_te_hoog')}
          </div>
        ) : res ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('tool_ph_resultaat')}</div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-3xl font-bold" style={{ color: 'var(--t-accent)' }}>
                {res.ml.toFixed(res.ml < 10 ? 2 : 1)}
              </span>
              <span className="text-lg font-semibold text-gray-600">mL</span>
              <span className="text-sm text-gray-400">≈ {res.gram.toFixed(1)} g {t(middel.labelKey)}</span>
            </div>
            {modus === 'maisch' && (
              <div className="text-sm text-gray-500 mt-1">
                {t('tool_ph_drop').replace('{drop}', res.drop.toFixed(2))}
              </div>
            )}
            {modus === 'water' && (
              <div className="text-sm text-gray-500 mt-1">{t('tool_ph_water_doel')}</div>
            )}
            <div className="text-sm text-gray-600 mt-3 pt-3 border-t border-gray-200">
              {t('tool_ph_vooraf').replace('{ml}', vooraf.toFixed(vooraf < 10 ? 2 : 1))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400 italic">{t('tool_ph_vul_in')}</div>
        )}

        <div className="text-xs text-gray-400 leading-relaxed">
          {modus === 'maisch' ? t('tool_ph_disclaimer') : t('tool_ph_disclaimer_water')}
        </div>
      </div>
    </div>
  )
}

const GereedschapPage: React.FC<GereedschapPageProps> = ({ tool = 'ph' }) => {
  return (
    <div className="space-y-4">
      {tool === 'ph' && <PhCorrectieTool />}
    </div>
  )
}

export default GereedschapPage
