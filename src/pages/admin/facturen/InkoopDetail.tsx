import React from 'react'
import { t } from '../../../i18n'
import DetailPaneel from '../../../components/ui/DetailPaneel'
import Btn from '../../../components/ui/Btn'
import Icon from '../../../components/ui/Icon'
import { ADDON_BASE } from '../../../utils/api'
import { fmtQty } from '../../../utils/format'
import { dagNotatie } from '../../../utils/periode'
import { periodeKeyLabel } from '../../../utils/btw'
import { inkoopCenten } from '../../../utils/factuurFilter'
import { inkoopRegelExport } from '../../../utils/csv'
import type { BankBetaling, InkoopStand, VerlegdInfo } from '../../../utils/factuurTijdlijn'
import { fmt } from '../adminContext'
import { InkoopPil } from './FactuurPil'
import { ActieBalk, MeerKnoppen, type DetailKnop } from './DetailKnoppen'

// ── Detail van een inkoopfactuur ────────────────────────────────────────────
// Leverancier, bedragen, de regels in het kort, de BTW-bijzonderheden
// (rollover, verlegd), de bijlage (openen of toevoegen) en de betaling, met
// de afschrijving erbij als die aan het bankafschrift gekoppeld is.

export interface InkoopDetailProps {
  factuur: any
  stand: InkoopStand
  verlegd: VerlegdInfo | null
  bank: BankBetaling | null
  /** Betaaldatum zoals de boekhouding hem kent (veld, of de gekoppelde transactie). */
  betaaldDatum?: string
  altNaam?: string
  /** Telt mee in een ingediende of betaalde BTW-periode: niet meer te wijzigen. */
  vergrendeld: boolean
  onBijlage: () => void
  bijlageBezig: boolean
  primair: DetailKnop | null
  tweede: DetailKnop | null
  meer: DetailKnop[]
  onSluit: () => void
  terugLabel: string
  /** Extra klassen op het paneel. */
  cls?: string
}

const Rij: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-900 min-w-0 break-words">{children}</dd>
  </>
)

const hoeveelheidTekst = (r: any): string => {
  if (r?.hoeveelheid !== null && r?.hoeveelheid !== undefined && r?.hoeveelheid !== '') {
    return `${fmtQty(r.hoeveelheid)}${r.eenheid ? ` ${r.eenheid}` : ''}`
  }
  if (r?.aantal !== null && r?.aantal !== undefined && r?.aantal !== '') return `${fmtQty(r.aantal)}×`
  return ''
}

const InkoopDetail: React.FC<InkoopDetailProps> = ({
  factuur: f, stand, verlegd, bank, betaaldDatum, altNaam, vergrendeld, onBijlage, bijlageBezig,
  primair, tweede, meer, onSluit, terugLabel, cls,
}) => {
  const c = inkoopCenten(f)
  const regels: any[] = Array.isArray(f.regels) ? f.regels : []
  const betaald = stand.fase === 'betaald' || stand.fase === 'betaald_alt'
  return (
    <DetailPaneel
      titel={f.factuurnummer || '—'}
      ondertitel={f.leverancier || t('lbl_onbekend')}
      kopExtra={<InkoopPil stand={stand} altNaam={altNaam} />}
      onSluit={onSluit}
      terugLabel={terugLabel}
      cls={cls}
      acties={primair || tweede ? <ActieBalk primair={primair} tweede={tweede} /> : undefined}
    >
      <div className="grid gap-4">
        <div>
          <div className="text-2xl font-bold tabular-nums text-gray-900">{fmt(c.bruto)}</div>
          <div className="text-xs text-gray-500 tabular-nums">
            {t('lbl_netto')} {fmt(c.netto)} · {t('lbl_voorbelasting')} {fmt(c.btw)}
          </div>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <Rij label={t('lbl_supplier')}>{f.leverancier || '—'}</Rij>
          <Rij label={t('lbl_invoice')}><span className="font-mono text-xs">{f.factuurnummer || '—'}</span></Rij>
          <Rij label={t('lbl_factuurdatum')}>{f.datum ? dagNotatie(f.datum) : '—'}</Rij>
          {betaald && (
            <Rij label={t('lbl_betaald')}>
              {betaaldDatum ? dagNotatie(betaaldDatum) : t('fct_betaald_zonder_datum')}
              {stand.fase === 'betaald_alt' && (
                <span className="block text-xs text-purple-800">{t('lbl_betaald_via')}: {altNaam || t('lbl_alt_rekening')}</span>
              )}
            </Rij>
          )}
          {bank && (
            <Rij label={t('fct_afschrijving')}>
              {[bank.dag ? dagNotatie(bank.dag) : '', bank.tegenpartij, bank.bedrag_cent !== null ? fmt(bank.bedrag_cent / 100) : '']
                .filter(Boolean).join(' · ') || '—'}
              {bank.soort === 'psp' && <span className="block text-xs text-gray-500">{t('fct_psp_kosten')}</span>}
            </Rij>
          )}
          <Rij label={t('fct_bijlage')}>
            {f.bijlage?.bestand ? (
              <a href={`${ADDON_BASE}api/file/${f.bijlage.bestand}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 t-accent-text font-medium hover:underline break-all">
                <Icon n="paperclip" /> {f.bijlage.naam || t('fct_bijlage_openen')}
              </a>
            ) : (
              <Btn v="secondary" s="sm" onClick={onBijlage} disabled={bijlageBezig}>
                <span className="inline-flex items-center gap-1.5"><Icon n="upload" /> {bijlageBezig ? t('btn_uploading') : t('fct_bijlage_toevoegen')}</span>
              </Btn>
            )}
          </Rij>
        </dl>

        {(f.btw_periode || verlegd || vergrendeld) && (
          <div className="grid gap-1.5 text-xs">
            {f.btw_periode && (
              <p className="text-orange-800 bg-orange-50 rounded-lg px-3 py-2">↪ {t('msg_btw_geclaimd_in').replace('{periode}', periodeKeyLabel(f.btw_periode))}</p>
            )}
            {verlegd && (
              <p className="text-purple-800 bg-purple-50 rounded-lg px-3 py-2">
                ⇄ {t('title_verlegd_badge').replace('{rubriek}', verlegd.rubriek).replace('{btw}', fmt(verlegd.btw_cent / 100))}
              </p>
            )}
            {vergrendeld && <p className="text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{t('err_periode_gesloten_mutatie')}</p>}
          </div>
        )}

        {regels.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('fct_regels').replace('{n}', String(regels.length))}</h3>
            <ul className="divide-y divide-gray-100 text-sm border-y border-gray-100">
              {regels.map((r, i) => {
                const x = inkoopRegelExport(r)
                const hoeveel = hoeveelheidTekst(r)
                return (
                  <li key={i} className="py-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                    <span className="min-w-0 break-words text-gray-800">{x.omschrijving || '—'}</span>
                    <span className="text-right tabular-nums text-gray-900">{x.netto !== null ? fmt(x.netto) : '—'}</span>
                    <span className="text-xs text-gray-500">{hoeveel}</span>
                    <span className="text-right text-xs text-gray-500 tabular-nums">{x.btwPct !== '' ? `${x.btwPct}%` : ''}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {meer.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('fct_meer')}</h3>
            <MeerKnoppen knoppen={meer} label={t('fct_meer')} />
          </section>
        )}
      </div>
    </DetailPaneel>
  )
}

export default InkoopDetail
