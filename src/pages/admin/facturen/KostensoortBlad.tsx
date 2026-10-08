import React from 'react'
import { t } from '../../../i18n'
import Blad from '../../../components/ui/Blad'
import Sel from '../../../components/ui/Sel'
import { herindelingRegels, HELE_FACTUUR, type KostensoortWijziging } from '../../../utils/kostensoortHerindeling'
import { kostensoortLabel } from '../rapporten/hulp'
import { fmt } from '../adminContext'

// ── Kostensoort wijzigen ────────────────────────────────────────────────────
// Alleen wáár de kosten in de winst-en-verliesrekening staan: de kostensoort
// per regel ("Overig" → "Installatie"). Bedragen en BTW blijven gelijk, dus dit
// kan ook als de factuur al meetelt in een ingediende of betaalde BTW-periode
// (utils/kostensoortHerindeling.ts). Voorraadregels (ingrediënt, verpakking)
// staan erbij, maar liggen vast.

export interface KostensoortBladProps {
  factuur: any
  kostenSoorten: string[]
  /** Telt de factuur mee in een afgesloten BTW-periode? Dan zegt het blad dat de aangifte niet verandert. */
  vergrendeld: boolean
  /** Waarom opslaan niet doorging (het journaal klopt niet met de regels). */
  fout?: string
  onOpslaan: (wijziging: KostensoortWijziging) => void
  onSluit: () => void
}

const KostensoortBlad: React.FC<KostensoortBladProps> = ({ factuur, kostenSoorten, vergrendeld, fout, onOpslaan, onSluit }) => {
  const regels = React.useMemo(() => herindelingRegels(factuur), [factuur])
  const [keuze, setKeuze] = React.useState<KostensoortWijziging>(
    () => Object.fromEntries(regels.map(r => [r.index, r.kostensoort])))
  const gewijzigd = regels.some(r => r.aanpasbaar && keuze[r.index] !== r.kostensoort)
  // De lijst uit de instellingen; een kostensoort die daar niet (meer) in
  // staat blijft kiesbaar voor de regel die hem al heeft.
  const opties = (huidig: string) => (kostenSoorten.includes(huidig) ? kostenSoorten : [...kostenSoorten, huidig])
    .map(ks => ({ v: ks, l: kostensoortLabel(ks) }))
  return (
    <Blad titel={t('fct_kostensoort_wijzigen')} onSluit={onSluit}
      onKlaar={() => (gewijzigd ? onOpslaan(keuze) : onSluit())} klaarLabel={t('btn_save')}>
      <div className="grid gap-3">
        <div className="grid gap-1 text-sm text-gray-600">
          <p>{t('fct_kostensoort_uitleg')}</p>
          {vergrendeld && <p>{t('fct_kostensoort_aangifte')}</p>}
        </div>
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
          {regels.map(r => {
            const naam = r.index === HELE_FACTUUR ? t('fct_kostensoort_hele_factuur') : (r.omschrijving || t('lbl_naamloos'))
            return (
              <li key={r.index} className="py-2.5 grid gap-1.5 min-w-0">
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <span className="min-w-0 break-words text-sm text-gray-800">{naam}</span>
                  <span className="text-sm tabular-nums text-gray-900 whitespace-nowrap">{fmt(r.netto_cent / 100)}</span>
                </div>
                {r.aanpasbaar ? (
                  <Sel value={keuze[r.index] ?? r.kostensoort} opts={opties(r.kostensoort)}
                    ariaLabel={`${t('lbl_kostensoort')}: ${naam}`}
                    onChange={v => setKeuze(k => ({ ...k, [r.index]: v }))} />
                ) : (
                  <p className="text-xs text-gray-500">{kostensoortLabel(r.kostensoort)} · {t('fct_kostensoort_voorraad')}</p>
                )}
              </li>
            )
          })}
        </ul>
        {fout && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fout}</div>
        )}
      </div>
    </Blad>
  )
}

export default KostensoortBlad
