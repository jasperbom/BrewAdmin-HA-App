import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtWeekdagDatum } from '../../utils/format'
import type { BatchKeten, KetenMoment } from '../../utils/batchKeten'

// De ketenregel in de batchkop: Recept › Product › Tank, en grijs wanneer de
// batch gebrouwen is en hoe lang hij al in zijn fase zit. Recept en product
// zijn één klik weg (een chip met › navigeert); de tank is alleen informatie.
// Zonder product staat er *Product kiezen* (zonder ›: hij opent een keuze op
// deze pagina). Op een telefoon breken de chips af naar een volgende regel —
// nooit zijwaarts scrollen — en is elke chip een tapdoel van 44 px.
//
// De afleiding staat in utils/batchKeten.ts (`batchKeten`); dit is alleen de
// weergave.

interface KetenRegelProps {
  keten: BatchKeten | null
  /** Het hoofdrecept openen (`#/productie/recepten/<id>`). Zonder: geen link. */
  onRecept?: (receptId: string) => void
  /** Het product openen (`#/verkoop/producten/<id>`). Zonder: geen link. */
  onProduct?: (productId: number) => void
  /** De productkeuze openen als de batch nog geen product heeft. */
  onProductKiezen?: () => void
  cls?: string
}

/** "gebrouwen di 15-9-2026 · dag 8 in conditionering", of "brouwdag wo 14-10-2026". */
export const ketenMomentTekst = (m: KetenMoment | null | undefined): string => {
  if (!m) return ''
  const d = (x: string | null) => fmtWeekdagDatum(x, { lang: getLang() })
  if (m.soort === 'brouwdag') return t('keten_brouwdag').replace('{datum}', d(m.datum))
  const delen: string[] = []
  if (m.gebrouwen) delen.push(t('keten_gebrouwen').replace('{datum}', d(m.gebrouwen)))
  if (m.soort === 'in_fase' && m.dag != null) {
    delen.push(t(m.fase === 'vergisting' ? 'keten_dag_vergisting' : 'keten_dag_conditionering').replace('{n}', String(m.dag)))
  }
  if (m.soort === 'afgevuld' && m.afgevuld) delen.push(t('keten_afgevuld').replace('{datum}', d(m.afgevuld)))
  return delen.join(' · ')
}

// Telefoon: twee chips naast elkaar (elk de halve breedte, de tekst loopt
// door op een tweede regel), 44 px hoog en iets ronder dan een pil; bureau:
// pillen achter elkaar, zoals in de mockup.
const CHIP = 'inline-flex items-center gap-1 max-w-full min-w-0 basis-[calc(50%-0.25rem)] md:basis-auto ' +
  'min-h-tap md:min-h-0 px-3 md:px-2.5 py-1.5 md:py-1 ' +
  'rounded-[10px] md:rounded-full border text-[13px] font-medium leading-snug text-left'
const LINK = `${CHIP} grow md:grow-0 bg-[color:var(--t-pale)] border-[color:var(--t-light)] text-[color:var(--t-text)] hover:brightness-95 ` +
  'transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]'
const STIL = `${CHIP} bg-gray-50 border-gray-200 text-gray-700`

const Chip: React.FC<{ soort: string; naam: string; opent?: boolean; onClick?: () => void; titel?: string }> = ({
  soort, naam, opent, onClick, titel,
}) => {
  const inhoud = (
    <span className="min-w-0 break-words">
      <span className="font-normal opacity-80">{soort} · </span>{naam}{opent && <span aria-hidden="true">&nbsp;›</span>}
    </span>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={LINK} title={titel}>{inhoud}</button>
    : <span className={STIL} title={titel}>{inhoud}</span>
}

const KetenRegel: React.FC<KetenRegelProps> = ({ keten, onRecept, onProduct, onProductKiezen, cls = '' }) => {
  if (!keten) return null
  const { recept, producten, productKiezen, tank, moment } = keten
  const tekst = ketenMomentTekst(moment)
  if (!recept && !producten.length && !productKiezen && !tank && !tekst) return null
  return (
    <div role="group" aria-label={t('keten_aria')} className={`flex flex-wrap items-center gap-2 min-w-0 ${cls}`}>
      {recept && (
        recept.bestaat && onRecept
          ? <Chip soort={t('keten_recept')} naam={recept.naam || t('lbl_naamloos')} opent onClick={() => onRecept(recept.id)} />
          : <Chip soort={t('keten_recept')} naam={recept.naam || t('keten_recept_onbekend')} />
      )}
      {producten.map(p => {
        const naam = p.gearchiveerd
          ? t('product_keuze_gearchiveerd').replace('{naam}', p.naam || t('lbl_naamloos'))
          : (p.naam || t('lbl_naamloos'))
        return onProduct
          ? <Chip key={p.id} soort={t('keten_product')} naam={naam} opent onClick={() => onProduct(p.id)} />
          : <Chip key={p.id} soort={t('keten_product')} naam={naam} />
      })}
      {productKiezen && onProductKiezen && (
        <button type="button" onClick={onProductKiezen}
          className={`${CHIP} grow md:grow-0 bg-white border-dashed border-[color:var(--t-accent-edge,var(--t-accent))] t-accent-text hover:bg-[color:var(--t-pale)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]`}>
          {t('keten_product_kiezen')}
        </button>
      )}
      {tank && <Chip soort={t('keten_tank')} naam={tank.naam} />}
      {tekst && <span className="basis-full md:basis-auto text-[13px] text-gray-500 md:pl-1">{tekst}</span>}
    </div>
  )
}

export default KetenRegel
