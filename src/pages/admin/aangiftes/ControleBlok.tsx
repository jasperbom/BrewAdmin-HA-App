import React from 'react'
import { t, getLang } from '../../../i18n'
import Btn from '../../../components/ui/Btn'
import { dagNotatie } from '../../../utils/periode'
import { zelfdePersoon, type ControleFase, type ControleInvoer } from '../../../utils/aangifteStappen'

// ── Controle door een tweede persoon (Douane §12.2 accijns / §12.4 BTW) ─────
// Drie standen:
//  - open: wie berekende (de ingelogde gebruiker) en wie gaat controleren —
//    "Vraag controle aan" (in de actiebalk) legt beide vast;
//  - aangevraagd of met opmerkingen: de controleur legt akkoord of opmerkingen
//    vast, met bevindingen. Is de controleur dezelfde persoon als wie
//    berekende of indiende, dan een waarschuwing en "toch akkoord" + verplichte
//    bevindingen — een eenmanszaak heeft niemand anders, maar het bewijs moet
//    zeggen wat er gecontroleerd is;
//  - akkoord: wie, wanneer, ingevoerd door wie, en de bevindingen.
// De primaire knop (Vraag controle aan / Markeer akkoord) staat in de
// actiebalk van het detail; dit blok toont de velden, de reden waarom het
// (nog) niet kan, en de tweede knop (Opmerkingen).

export interface ControleBlokProps {
  soort: 'btw' | 'accijns'
  fase: ControleFase
  rec: any
  /** De ingelogde gebruiker (whoami), of '' buiten HA. */
  ingelogd: string
  /** Keuzelijst uit het rollenbeheer; leeg = vrije naam. */
  opties: string[]
  concept: ControleInvoer
  setConcept: (c: ControleInvoer) => void
  /** Waarom de primaire knop (nog) niet kan, als i18n-sleutel. */
  blokkade: string | null
  /** Na indienen ligt de controle vast. */
  vast: boolean
  magSchrijven: boolean
  onOpmerkingen: () => void
  onWijzigen: () => void
  opmerkingenBlokkade: string | null
}

const tijdstip = (iso: unknown): string => {
  const s = String(iso || '')
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleString(getLang(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const Veld: React.FC<{ label: string, children: React.ReactNode, id?: string }> = ({ label, children, id }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
    {children}
  </div>
)

const ControleBlok = React.forwardRef<HTMLElement, ControleBlokProps>(({
  soort, fase, rec, ingelogd, opties, concept, setConcept, blokkade, vast, magSchrijven,
  onOpmerkingen, onWijzigen, opmerkingenBlokkade,
}, ref) => {
  const basisId = React.useId()
  const berekendDoor = String(rec?.berekend_door || '').trim()
  const berekenaar = fase === 'open' ? ingelogd : berekendDoor
  const zelfde = zelfdePersoon(concept.controleur, fase === 'open' ? [ingelogd] : [rec?.berekend_door, rec?.ingediend_door])
  const invullen = magSchrijven && !vast && fase !== 'akkoord'

  const controleurVeld = opties.length > 0 ? (
    <select id={`${basisId}-c`} value={concept.controleur} disabled={!invullen}
      onChange={e => setConcept({ ...concept, controleur: e.target.value })}
      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white t-input min-h-tap sm:min-h-0 disabled:bg-gray-50">
      <option value="">{t('agf_kies_gebruiker')}</option>
      {opties.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  ) : (
    <input id={`${basisId}-c`} type="text" value={concept.controleur} disabled={!invullen}
      onChange={e => setConcept({ ...concept, controleur: e.target.value })}
      placeholder={t('agf_controleur_ph')} autoComplete="off"
      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white t-input min-h-tap sm:min-h-0 disabled:bg-gray-50" />
  )

  const statusPil = fase === 'akkoord'
    ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">{t('controle_status_akkoord')}</span>
    : fase === 'opmerkingen'
      ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">{t('controle_status_opmerkingen')}</span>
      : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">{fase === 'aangevraagd' ? t('agf_controle_aangevraagd') : t('controle_status_open')}</span>

  return (
    <section ref={ref} aria-labelledby={`${basisId}-t`} className="border-t border-gray-100 pt-3 space-y-2.5 scroll-mt-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 id={`${basisId}-t`} className="text-sm font-semibold text-gray-800">{t('agf_controle_titel')}</h3>
          <p className="text-xs text-gray-500">{soort === 'btw' ? t('agf_controle_bron_btw') : t('agf_controle_bron_accijns')}</p>
        </div>
        {statusPil}
      </div>

      {fase === 'akkoord' ? (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900 space-y-1">
          <div className="font-medium">
            ✓ {t('agf_controle_akkoord_van').replace('{naam}', rec?.reviewer || t('lbl_onbekend')).replace('{datum}', tijdstip(rec?.controle_datum))}
          </div>
          {(berekendDoor || rec?.controle_door) && (
            <div className="text-xs text-green-800">
              {berekendDoor && <>{t('agf_berekend_door')}: {berekendDoor}</>}
              {berekendDoor && rec?.controle_door && ' · '}
              {rec?.controle_door && t('agf_ingevoerd_door').replace('{naam}', rec.controle_door)}
            </div>
          )}
          {rec?.bevindingen && <div className="text-xs text-green-900 break-words">{t('controle_bevindingen')}: {rec.bevindingen}</div>}
          {rec?.zelfde_persoon_akkoord && <div className="text-xs text-orange-800">⚠ {t('agf_zelfde_persoon_vastgelegd')}</div>}
          {magSchrijven && !vast && (
            <button type="button" onClick={onWijzigen}
              className="text-xs font-medium t-accent-text hover:underline min-h-tap sm:min-h-0">{t('agf_controle_wijzigen')}</button>
          )}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">{t('agf_berekend_door')}</dt>
            <dd className="text-gray-900 min-w-0 break-words">
              {berekenaar
                ? (fase === 'open' ? t('agf_ingelogd').replace('{naam}', berekenaar) : berekenaar)
                : <span className="text-gray-400">—</span>}
              {fase !== 'open' && rec?.berekend_datum && <span className="text-gray-500"> · {dagNotatie(String(rec.berekend_datum).slice(0, 10))}</span>}
            </dd>
          </dl>
          <Veld label={t('agf_controleur')} id={`${basisId}-c`}>{controleurVeld}</Veld>

          {fase === 'opmerkingen' && rec?.bevindingen && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-900 break-words">
              {t('agf_opmerkingen_van').replace('{naam}', rec?.reviewer || t('lbl_onbekend')).replace('{datum}', tijdstip(rec?.controle_datum))}: {rec.bevindingen}
            </div>
          )}

          {zelfde && (
            <div role="note" className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-900">
              ⚠ {t('agf_zelfde_persoon').replace('{naam}', concept.controleur.trim())}
            </div>
          )}

          {fase !== 'open' && (
            <>
              <Veld label={t('controle_bevindingen')} id={`${basisId}-b`}>
                <textarea id={`${basisId}-b`} value={concept.bevindingen} disabled={!invullen} rows={3}
                  onChange={e => setConcept({ ...concept, bevindingen: e.target.value })}
                  placeholder={soort === 'btw' ? t('controle_bevindingen_ph_btw') : t('controle_bevindingen_ph_accijns')}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white t-input disabled:bg-gray-50" />
              </Veld>
              {zelfde && (
                <label className="flex items-start gap-2 text-sm text-gray-800 min-h-tap sm:min-h-0 cursor-pointer">
                  <input type="checkbox" checked={concept.tochAkkoord} disabled={!invullen}
                    onChange={e => setConcept({ ...concept, tochAkkoord: e.target.checked })}
                    className="mt-0.5 w-4 h-4 t-checkbox flex-shrink-0" />
                  <span>{t('agf_toch_akkoord')}</span>
                </label>
              )}
            </>
          )}

          {invullen && blokkade && <p className="text-xs text-gray-600">{t(blokkade)}</p>}

          {invullen && fase !== 'open' && (
            <div className="flex flex-wrap items-center gap-2">
              <Btn v="secondary" s="sm" onClick={onOpmerkingen} disabled={!!opmerkingenBlokkade}
                title={opmerkingenBlokkade ? t(opmerkingenBlokkade) : undefined}>
                {t('controle_btn_opmerkingen')}
              </Btn>
            </div>
          )}
        </>
      )}
    </section>
  )
})

ControleBlok.displayName = 'ControleBlok'

export default ControleBlok
