import React from 'react'
import { t } from '../../../i18n'
import Btn from '../../../components/ui/Btn'
import BevestigKnop from '../../../components/ui/BevestigKnop'
import { dagNotatie } from '../../../utils/periode'
import { toCent } from '../../../utils/centen'
import type { AangifteRij, BetaalKandidaat } from '../../../utils/aangifteStappen'
import { fmtCent } from './onderdelen'

// ── Betaling van een aangifte: koppelen aan een banktransactie ──────────────
// De kandidaten komen uit de bewaarde afschriften (betalingKandidaten): de
// goede kant, nog nergens aan gekoppeld, niet van vóór de periode; binnen € 1
// van het bedrag als voorstel bovenaan. De primaire knop ("Koppel betaling")
// staat in de actiebalk van het detail; alleen bij het achteraf koppelen van
// een al betaalde accijnsmaand staat hij hier zelf.
// Accijns kan ook zonder bank op betaald (met de betaaldatum, standaard
// vandaag); BTW niet — daar is de bankkoppeling het bewijs (Openstaand →
// Afgesloten).

export interface BetalingBlokProps {
  rij: AangifteRij
  kandidaten: { voorgesteld: BetaalKandidaat[], overig: BetaalKandidaat[] }
  gekozen: string
  setGekozen: (txKey: string) => void
  magSchrijven: boolean
  onOntkoppel: () => void
  /** Naar Bank om een afschrift in te lezen; null als die knop al in de actiebalk staat. */
  onImporteren: (() => void) | null
  /** Accijns: achteraf het betaalbewijs koppelen (de maand staat al op betaald). */
  achteraf?: boolean
  onKoppelHier?: (() => void) | null
  /** Accijns: zonder bank op betaald zetten, met deze datum. */
  handmatig?: { datum: string, setDatum: (d: string) => void, onMarkeer: () => void } | null
  bezig?: boolean
}

const txLabel = (k: BetaalKandidaat, metVerschil: boolean): string => {
  const naam = k.tx?.tegenpartij || k.tx?.omschrijving || t('lbl_onbekend')
  const verschil = metVerschil && k.verschilCent > 0 ? ` (± ${fmtCent(k.verschilCent)})` : ''
  return `${dagNotatie(String(k.tx?.datum || ''))} · ${naam} · ${fmtCent(Math.abs(toCent(k.tx?.bedrag)))}${verschil}`
}

const BetalingBlok = React.forwardRef<HTMLElement, BetalingBlokProps>(({
  rij, kandidaten, gekozen, setGekozen, magSchrijven, onOntkoppel, onImporteren, achteraf = false, onKoppelHier = null, handmatig = null, bezig = false,
}, ref) => {
  const basisId = React.useId()
  const titel = rij.teruggave ? t('agf_teruggave') : t('agf_betaling')

  if (rij.betaling) {
    const b = rij.betaling
    return (
      <section ref={ref} aria-label={titel} className="border-t border-gray-100 pt-3 scroll-mt-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          <span className="flex-1 min-w-0 text-sm text-green-900 break-words">
            ✓ {rij.soort === 'btw' ? t('lbl_btw_betaling_gekoppeld') : t('lbl_accijns_betaling_gekoppeld')}
            {b.datum ? ` · ${dagNotatie(b.datum)}` : ''}{b.bedragCent !== null ? ` · ${fmtCent(Math.abs(b.bedragCent))}` : ''}
          </span>
          {magSchrijven && (
            <BevestigKnop v="secondary" s="sm" vraag={t('agf_ontkoppel_vraag')} onBevestig={onOntkoppel}>{t('btn_ontkoppel')}</BevestigKnop>
          )}
        </div>
      </section>
    )
  }

  const heeftKandidaten = kandidaten.voorgesteld.length + kandidaten.overig.length > 0
  return (
    <section ref={ref} aria-labelledby={`${basisId}-t`} className="border-t border-gray-100 pt-3 space-y-2 scroll-mt-3">
      <h3 id={`${basisId}-t`} className="text-sm font-semibold text-gray-800">{titel}</h3>
      {achteraf && <p className="text-xs text-gray-600">{t('msg_accijns_koppel_achteraf')}</p>}
      {!magSchrijven ? (
        <p className="text-xs text-gray-500">{t('agf_alleen_lezen')}</p>
      ) : heeftKandidaten ? (
        <>
          <label htmlFor={`${basisId}-s`} className="block text-xs font-medium text-gray-600">
            {rij.teruggave ? t('lbl_koppel_teruggave') : t('lbl_koppel_betaling')}
          </label>
          <div className="flex items-center gap-2 min-w-0">
            <select id={`${basisId}-s`} value={gekozen} onChange={e => setGekozen(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white t-input min-h-tap sm:min-h-0">
              <option value="">{t('lbl_selecteer_transactie')}</option>
              {kandidaten.voorgesteld.length > 0 && (
                <optgroup label={t('lbl_match_voorgesteld')}>
                  {kandidaten.voorgesteld.map(k => <option key={k.sleutel} value={k.sleutel}>{txLabel(k, true)}</option>)}
                </optgroup>
              )}
              {kandidaten.overig.length > 0 && (
                <optgroup label={t('lbl_overige_transacties')}>
                  {kandidaten.overig.map(k => <option key={k.sleutel} value={k.sleutel}>{txLabel(k, false)}</option>)}
                </optgroup>
              )}
            </select>
            {onKoppelHier && (
              <Btn s="sm" onClick={onKoppelHier} disabled={!gekozen || bezig}>{t('agf_btn_koppel')}</Btn>
            )}
          </div>
          {!gekozen && kandidaten.voorgesteld.length === 0 && <p className="text-xs text-gray-500">{t('agf_geen_voorstel')}</p>}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-gray-600">{t('msg_geen_banktxn_kandidaat')}</span>
          {onImporteren && (
            <button type="button" onClick={onImporteren}
              className="text-xs font-medium t-accent-text hover:underline min-h-tap sm:min-h-0">{t('btn_afschrift_importeren')}</button>
          )}
        </div>
      )}

      {magSchrijven && handmatig && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-1.5">
          <div className="text-xs font-medium text-gray-700">{t('agf_handmatig_betaald')}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${basisId}-d`} className="block text-xs text-gray-600 mb-0.5">{t('agf_betaald_op')}</label>
              <input id={`${basisId}-d`} type="date" value={handmatig.datum} onChange={e => handmatig.setDatum(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white t-input min-h-tap sm:min-h-0" />
            </div>
            <Btn v="secondary" s="sm" onClick={handmatig.onMarkeer} disabled={!handmatig.datum || bezig}>{t('excise_markeer_betaald')}</Btn>
          </div>
        </div>
      )}
    </section>
  )
})

BetalingBlok.displayName = 'BetalingBlok'

export default BetalingBlok
