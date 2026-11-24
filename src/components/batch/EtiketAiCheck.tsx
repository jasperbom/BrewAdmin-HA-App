import React from 'react'
import { t } from '../../i18n'
import { callClaudeProxy } from '../../utils/api'
import { voerScanUit, ScanFout, scanFoutSleutel, modelNaam } from '../../utils/claudeScan'
import {
  etiketCheckSchema, inhoudVoorEtiketCheck, normaliseerEtiketLezing, beoordeelEtiketLezing, aiCheckRecord,
  type EtiketLezing, type EtiketCheck, type EtiketCheckPunt, type EtiketVerwachting,
} from '../../utils/etiketCheck'
import { allergeenNamen } from '../../utils/etiket'
import type { EtiketAiCheck } from '../../types'

// CCP 3: de foto van het etiket laten nalezen door Claude (utils/etiketCheck.ts).
// De hook houdt de stand van één formulier bij; de vergelijking zelf is puur
// en wordt bij elke render opnieuw gemaakt, zodat een ander product of een
// andere lotcode meteen meetelt. De vinkjes blijven handwerk.

export interface EtiketAiStand {
  status: 'leeg' | 'bezig' | 'klaar' | 'fout'
  lezing: EtiketLezing | null
  model: string
  /** Wanneer de foto gelezen is (ISO). */
  op: string
  /** De foutmelding in de taal van het scherm. */
  fout: string
  /** De i18n-sleutel van de fout (gaat mee op het record). */
  foutCode: string
}

const LEEG: EtiketAiStand = { status: 'leeg', lezing: null, model: '', op: '', fout: '', foutCode: '' }

export interface EtiketAi {
  /** Is er een Claude-sleutel? Zonder sleutel geen controle. */
  aan: boolean
  stand: EtiketAiStand
  lees: (base64: string) => Promise<void>
  opnieuw: () => void
  wis: () => void
}

export const useEtiketAi = (aan: boolean): EtiketAi => {
  const [stand, setStand] = React.useState<EtiketAiStand>(LEEG)
  const versie = React.useRef(0)
  const laatste = React.useRef<string | null>(null)
  const lees = React.useCallback(async (base64: string) => {
    if (!aan || !base64) return
    laatste.current = base64
    const v = ++versie.current
    setStand({ ...LEEG, status: 'bezig' })
    try {
      const { data, model } = await voerScanUit(callClaudeProxy, {
        inhoud: inhoudVoorEtiketCheck(base64), schema: etiketCheckSchema(), maxTokens: 8000, effort: 'medium',
      })
      if (v !== versie.current) return
      setStand({ ...LEEG, status: 'klaar', lezing: normaliseerEtiketLezing(data), model, op: new Date().toISOString() })
    } catch (e) {
      if (v !== versie.current) return
      const code = e instanceof ScanFout ? scanFoutSleutel(e.code) : 'scan_fout_leeg'
      setStand({
        ...LEEG, status: 'fout', op: new Date().toISOString(), foutCode: code,
        fout: e instanceof ScanFout ? t(code) : (e instanceof Error && e.message) || t('scan_fout_leeg'),
      })
    }
  }, [aan])
  const opnieuw = React.useCallback(() => { if (laatste.current) void lees(laatste.current) }, [lees])
  const wis = React.useCallback(() => { versie.current++; laatste.current = null; setStand(LEEG) }, [])
  return { aan, stand, lees, opnieuw, wis }
}

/** De vergelijking bij de huidige stand; null zolang er niets gelezen is. */
export const etiketAiCheck = (ai: EtiketAi, verwacht: EtiketVerwachting): EtiketCheck | null =>
  ai.stand.status === 'klaar' && ai.stand.lezing ? beoordeelEtiketLezing(ai.stand.lezing, verwacht) : null

/** Wat er op het EtiketControle-record komt; undefined als er niet gelezen is. */
export const etiketAiRecord = (ai: EtiketAi, verwacht: EtiketVerwachting): EtiketAiCheck | undefined => {
  if (ai.stand.status === 'fout') return aiCheckRecord({ fout: ai.stand.foutCode, op: ai.stand.op })
  const check = etiketAiCheck(ai, verwacht)
  if (!check || !ai.stand.lezing) return undefined
  return aiCheckRecord({
    lezing: ai.stand.lezing, check, model: ai.stand.model, op: ai.stand.op, tochVastgelegd: check.wijktAf,
  })
}

/** Waarom de knop nog uit staat (de AI moet meekijken), of null. */
export const etiketAiReden = (ai: EtiketAi, heeftFoto: boolean): string | null => {
  if (!ai.aan) return null
  if (!heeftFoto) return t('haccp_ccp3_ai_foto_nodig')
  if (ai.stand.status === 'bezig') return t('haccp_ccp3_ai_bezig')
  return null
}

const PUNT_KLEUR: Record<string, string> = {
  klopt: 'text-green-700',
  wijkt_af: 'text-red-700 font-medium',
  niet_gezien: 'text-gray-500',
  onbekend: 'text-gray-500',
}

/** Naast een vinkje: wat de AI op die plek las. */
export const AiPunt: React.FC<{ punt: EtiketCheckPunt | null | undefined }> = ({ punt }) => {
  if (!punt) return null
  const tekst = punt.oordeel === 'klopt' ? t('haccp_ccp3_ai_klopt').replace('{gelezen}', punt.gelezen)
    : punt.oordeel === 'wijkt_af' ? t('haccp_ccp3_ai_wijkt_af').replace('{gelezen}', punt.gelezen)
    : punt.oordeel === 'onbekend' ? t('haccp_ccp3_ai_gelezen').replace('{gelezen}', punt.gelezen)
    : t('haccp_ccp3_ai_niet_gezien')
  return <span className={`text-xs ${PUNT_KLEUR[punt.oordeel]}`}>{tekst}</span>
}

/** De allergenenregel van de AI, in het blok met de vergelijking. */
export const AiAllergenen: React.FC<{ check: EtiketCheck | null }> = ({ check }) => {
  if (!check) return null
  const a = check.allergenen
  if (a.oordeel === 'niet_gezien') {
    return <div className="text-gray-500">{t('haccp_ccp3_ai_allergenen_niet_gezien')}</div>
  }
  if (a.oordeel === 'klopt') {
    return <div className="text-green-700">✓ {t('haccp_ccp3_ai_allergenen_klopt')}</div>
  }
  return (
    <>
      {a.mist.length > 0 && (
        <div className="text-red-700 font-medium">
          ✗ {t('haccp_ccp3_ai_allergenen_mist').replace('{allergenen}', allergeenNamen(a.mist, t).join(', '))}
        </div>
      )}
      {a.teveel.length > 0 && (
        <div className="text-red-700 font-medium">
          ✗ {t('haccp_ccp3_ai_allergenen_teveel').replace('{allergenen}', allergeenNamen(a.teveel, t).join(', '))}
        </div>
      )}
    </>
  )
}

/** Onder de foto: leest de AI nog, wat las hij, of wat ging er mis. */
export const AiStatus: React.FC<{ ai: EtiketAi; check: EtiketCheck | null; heeftFoto: boolean }> = ({ ai, check, heeftFoto }) => {
  if (!ai.aan) return <p className="text-xs text-gray-500">{t('haccp_ccp3_ai_geen_sleutel')}</p>
  const s = ai.stand
  if (!heeftFoto && s.status === 'leeg') return <p className="text-xs text-gray-500">{t('haccp_ccp3_ai_uitleg')}</p>
  if (s.status === 'bezig') return <p className="text-xs text-gray-600" role="status">{t('haccp_ccp3_ai_bezig')}</p>
  if (s.status === 'fout') {
    return (
      <div className="text-xs text-red-700 flex flex-wrap items-center gap-x-2" role="alert">
        <span>{t('haccp_ccp3_ai_fout').replace('{fout}', s.fout)}</span>
        <button type="button" onClick={ai.opnieuw}
          className="min-h-tap sm:min-h-0 underline underline-offset-2 font-medium">{t('btn_opnieuw')}</button>
      </div>
    )
  }
  if (s.status !== 'klaar' || !s.lezing) return null
  const l = s.lezing
  const wat = [l.benaming, l.inhoud].filter(Boolean).join(' · ')
  return (
    <div className="text-xs space-y-0.5" role="status">
      <div className="text-gray-600">
        {t('haccp_ccp3_ai_gelezen_door').replace('{model}', modelNaam(s.model))}
        {wat ? `: ${wat}` : ''}
      </div>
      {!l.leesbaar && <div className="text-orange-700">{t('haccp_ccp3_ai_onleesbaar')}</div>}
      {check?.wijktAf && <div className="text-red-700 font-medium">{t('haccp_ccp3_ai_verschil')}</div>}
      {l.opmerking && <div className="text-gray-500">{l.opmerking}</div>}
    </div>
  )
}
