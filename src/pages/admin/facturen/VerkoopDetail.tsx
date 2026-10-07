import React from 'react'
import { t } from '../../../i18n'
import DetailPaneel from '../../../components/ui/DetailPaneel'
import { dagNotatie } from '../../../utils/periode'
import { verkoopCenten } from '../../../utils/factuurFilter'
import type { TijdlijnRegel, VerkoopStand } from '../../../utils/factuurTijdlijn'
import { fmt } from '../adminContext'
import { RolloverBadge, VerkoopPil, VerrekendBadge } from './FactuurPil'
import Tijdlijn from './Tijdlijn'
import { ActieBalk, MeerKnoppen, type DetailKnop } from './DetailKnoppen'

// ── Detail van een verkoopfactuur ───────────────────────────────────────────
// Wat er met de factuur gebeurd is, waar hij vandaan komt (klant, bestelling,
// gecrediteerde factuur) en alle handelingen. De pagina (FacturenSectie)
// levert de gegevens en de knoppen; dit onderdeel zet ze neer.

export type BetaallinkStatus = 'actief' | 'verouderd' | 'gesloten' | 'nog_geen'

export interface VerkoopDetailProps {
  factuur: any
  stand: VerkoopStand
  tijdlijn: TijdlijnRegel[]
  klantNaam: string
  /** Naar de klantkaart (Verkoop › Klanten); null = geen gekoppelde klant. */
  onKlant: (() => void) | null
  bestellingLabel: string | null
  onBestelling: (() => void) | null
  /** De factuur die deze creditnota tenietdoet. */
  bron: any | null
  /** Creditnota's op deze factuur. */
  credits: any[]
  onOpenFactuur: (id: number) => void
  /** Vervaldatum als dd-mm-jjjj (leeg zonder factuurdatum). */
  vervaldatum: string
  termijn: number
  betaallink: { status: BetaallinkStatus, url?: string, aangemaakt?: string } | null
  altNaam?: string
  primair: DetailKnop | null
  tweede: DetailKnop | null
  meer: DetailKnop[]
  /** Uitleg onder "Meer" (bijv. waarom mailen niet kan): een title zie je op een telefoon niet. */
  meerHint?: string
  onSluit: () => void
  terugLabel: string
  /** Extra klassen op het paneel. */
  cls?: string
}

// Tapdoel van 44 px op een telefoon (min-h-tap), compact op het bureau.
const LINK = 'inline-flex items-center min-h-tap sm:min-h-0 t-accent-text font-medium hover:underline text-left break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded'

const Rij: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-900 min-w-0 break-words">{children}</dd>
  </>
)

const VerkoopDetail: React.FC<VerkoopDetailProps> = ({
  factuur: f, stand, tijdlijn, klantNaam, onKlant, bestellingLabel, onBestelling, bron, credits, onOpenFactuur,
  vervaldatum, termijn, betaallink, altNaam, primair, tweede, meer, meerHint, onSluit, terugLabel, cls,
}) => {
  const c = verkoopCenten(f)
  const nummer = f.factuurnummer || `F-${f.id}`
  const isCredit = stand.fase === 'credit'
  return (
    <DetailPaneel
      titel={nummer}
      ondertitel={klantNaam || t('lbl_onbekend')}
      kopExtra={<VerkoopPil stand={stand} />}
      onSluit={onSluit}
      terugLabel={terugLabel}
      cls={cls}
      acties={primair || tweede ? <ActieBalk primair={primair} tweede={tweede} /> : undefined}
    >
      <div className="grid gap-4">
        <div>
          <div className="text-2xl font-bold tabular-nums text-gray-900">{fmt(c.bruto)}</div>
          <div className="text-xs text-gray-500 tabular-nums">
            {t('lbl_netto')} {fmt(c.netto)} · {t('lbl_btw')} {fmt(c.btw)}
          </div>
          {(stand.verrekend || f.btw_periode) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {stand.verrekend && <VerrekendBadge naam={altNaam} />}
              {f.btw_periode && <RolloverBadge periode={f.btw_periode} sleutel="fct_btw_telt_in" />}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <Rij label={t('lbl_factuurdatum')}>{f.datum ? dagNotatie(f.datum) : '—'}</Rij>
          {!isCredit && vervaldatum && (
            <Rij label={t('lbl_vervaldatum').replace('{n}', String(termijn))}>
              <span className={stand.teLaat ? 'text-red-700 font-medium' : ''}>{vervaldatum}</span>
            </Rij>
          )}
          <Rij label={t('lbl_klant')}>
            {onKlant
              ? <button type="button" className={LINK} onClick={onKlant}>{klantNaam || t('lbl_onbekend')} ›</button>
              : (klantNaam || t('lbl_onbekend'))}
          </Rij>
          {bestellingLabel && (
            <Rij label={t('fct_bestelling')}>
              {onBestelling
                ? <button type="button" className={LINK} onClick={onBestelling}>{bestellingLabel} ›</button>
                : bestellingLabel}
            </Rij>
          )}
          {bron && (
            <Rij label={t('fct_creditnota_van')}>
              <button type="button" className={LINK} onClick={() => onOpenFactuur(bron.id)}>{bron.factuurnummer || `F-${bron.id}`} ›</button>
            </Rij>
          )}
          {credits.length > 0 && (
            <Rij label={t('fct_gecrediteerd_met')}>
              <span className="flex flex-wrap gap-x-3">
                {credits.map(cr => (
                  <button key={cr.id} type="button" className={LINK} onClick={() => onOpenFactuur(cr.id)}>{cr.factuurnummer || `F-${cr.id}`} ›</button>
                ))}
              </span>
            </Rij>
          )}
          {betaallink && (
            <Rij label={t('fct_betaallink')}>
              <span className="text-gray-700">{t(`fct_betaallink_${betaallink.status}`).replace('{datum}', betaallink.aangemaakt ? dagNotatie(betaallink.aangemaakt.slice(0, 10)) : '')}</span>
              {betaallink.url && betaallink.status === 'actief' && (
                <a href={betaallink.url} target="_blank" rel="noopener noreferrer" className={`${LINK} ml-2`}>{t('fct_openen')}</a>
              )}
            </Rij>
          )}
        </dl>

        {tijdlijn.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('fct_gebeurd')}</h3>
            <Tijdlijn regels={tijdlijn} label={t('fct_gebeurd')} />
          </section>
        )}

        {meer.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('fct_meer')}</h3>
            <MeerKnoppen knoppen={meer} label={t('fct_meer')} />
            {meerHint && <p className="mt-2 text-xs text-gray-500">{meerHint}</p>}
          </section>
        )}
      </div>
    </DetailPaneel>
  )
}

export default VerkoopDetail
