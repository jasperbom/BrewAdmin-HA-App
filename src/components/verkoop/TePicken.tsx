import React from 'react'
import { t, getLang } from '../../i18n'
import Btn from '../ui/Btn'
import BierKleur from '../ui/BierKleur'
import SectionHeader from '../ui/SectionHeader'
import { useBreedte } from '../ui/useBreedte'
import { productEbc } from '../../utils/bierKleur'
import { centNaarEuro } from '../../utils/centen'
import { fmtAmt, fmtDagMaand } from '../../utils/format'
import { brekenBijPunt, leverChip, watTekst } from '../../utils/verkoopDashboard'
import { vulIn } from '../../utils/attentieTekst'
import type { ChipTekst, TePickenRij, WatRegel } from '../../utils/verkoopDashboard'
import type { GaNaar } from '../../utils/route'

interface TePickenProps {
  rijen: TePickenRij[]
  /** Voor de bierkleur per regel (`productEbc`: product → recept). */
  producten: any[]
  recepten: any[]
  vandaag: string
  gaNaar: GaNaar
  /** Zoveel bestellingen tonen; de rest via "Alle n te picken ›". */
  max?: number
}

// Vaste, semantische kleuren (geen themakleuren).
const CHIP: Record<ChipTekst['kleur'], string> = {
  groen: 'bg-green-100 text-green-800',
  oranje: 'bg-orange-100 text-orange-800',
  rood: 'bg-red-100 text-red-700',
  grijs: 'bg-gray-100 text-gray-600',
}
const STATUS_CHIP: Record<string, string> = {
  nieuw: 'bg-blue-100 text-blue-700',
  bevestigd: 'bg-cyan-100 text-cyan-700',
}

const euro = (cent: number): string => `€ ${fmtAmt(centNaarEuro(cent))}`

// In de tabel op één regel (de kolom Wat breekt wel af), op een kaart alleen bij de punten.
const Chip: React.FC<{ chip: ChipTekst | null; heel?: boolean }> = ({ chip, heel }) => chip
  ? <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${heel ? 'whitespace-nowrap' : ''} ${CHIP[chip.kleur]}`}>{brekenBijPunt(chip.tekst)}</span>
  : null

const StatusChip: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CHIP[status] || 'bg-gray-100 text-gray-700'}`}>
    {t(`orders_status_${status}`, status)}
  </span>
)

/** Vanaf deze breedte (px) van de kaart past de tabel; daaronder kaarten. */
const TABEL_VANAF = 800
/** Vanaf deze breedte twee kaarten naast elkaar. */
const TWEE_KAARTEN_VANAF = 560

/**
 * "Te picken (n)": wat er besteld is, wat het kost en of het geleverd kan
 * worden. Waar het past een tabel (Order · Klant · Datum · Wat · Bedrag ·
 * Status · Voorraad · Picken ›), anders kaarten van drie regels — gekozen op
 * de ruimte die de kaart krijgt, niet op het scherm: naast de voorraadkolom
 * op een bureau van 1280 px is de kolom smaller dan op een tablet. Elke rij
 * opent de bestelling (`#/verkoop/bestellingen/<id>`). Niets te picken: geen
 * kaart.
 */
const TePicken: React.FC<TePickenProps> = ({ rijen, producten, recepten, vandaag, gaNaar, max = 10 }) => {
  const [ref, breedte] = useBreedte<HTMLElement>()
  if (!rijen.length) return null
  const taal = getLang()
  const tabel = breedte != null && breedte >= TABEL_VANAF
  const zichtbaar = rijen.slice(0, max)
  const rest = rijen.length - zichtbaar.length
  const open = (id: number) => gaNaar({ pagina: 'bestellingen', id })
  const ebcVan = (r: WatRegel): number | null => {
    if (r.productId == null) return null
    return productEbc((producten || []).find((p: any) => p?.id === r.productId), recepten)
  }
  const titel = t('verkoop_te_picken').replace('{n}', String(rijen.length))
  const alle = vulIn(t('verkoop_te_picken_alle'), { n: rijen.length })
  const wat = (r: TePickenRij, cls: string) => r.wat.map((w, i) => (
    <span key={`${w.regelId ?? 'r'}-${i}`} className={`items-start gap-1.5 ${cls}`}>
      {w.soort === 'bier' && <BierKleur ebc={ebcVan(w)} s="sm" cls="mt-[5px]" />}
      <span className="min-w-0 break-words">{watTekst(w, t, taal)}</span>
    </span>
  ))

  return (
    <section ref={ref} aria-label={titel}>
      {tabel ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <SectionHeader title={titel} rounded="top" />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 text-left">
                <th scope="col" className="font-medium px-4 py-2">{t('verkoop_kol_order')}</th>
                <th scope="col" className="font-medium px-2 py-2">{t('lbl_klant')}</th>
                <th scope="col" className="font-medium px-2 py-2">{t('lbl_datum')}</th>
                <th scope="col" className="font-medium px-2 py-2">{t('verkoop_kol_wat')}</th>
                <th scope="col" className="font-medium px-2 py-2 text-right">{t('verkoop_kol_bedrag')}</th>
                <th scope="col" className="font-medium px-2 py-2">{t('lbl_status')}</th>
                <th scope="col" className="font-medium px-2 py-2">{t('verkoop_kol_voorraad')}</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">{t('verkoop_kol_actie')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 border-t border-gray-100">
              {zichtbaar.map(r => (
                <tr key={r.id} onClick={() => open(r.id)} className="align-top hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{r.nummer}</td>
                  <td className="px-2 py-3 text-gray-700 break-words">{r.klant || t('lbl_onbekend')}</td>
                  <td className="px-2 py-3 text-gray-600 whitespace-nowrap">{fmtDagMaand(r.datum)}</td>
                  <td className="px-2 py-3 text-gray-800">
                    <span className="flex flex-col gap-0.5">{wat(r, 'flex')}</span>
                  </td>
                  <td className="px-2 py-3 text-right text-gray-800 whitespace-nowrap tabular-nums">{euro(r.bedragCent)}</td>
                  <td className="px-2 py-3"><StatusChip status={r.status} /></td>
                  <td className="px-2 py-3"><Chip chip={leverChip(r.levering, t, vandaag)} heel /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <Btn v="secondary" onClick={() => open(r.id)}>{t('verkoop_picken')} ›</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rest > 0 && (
            <button type="button" onClick={() => gaNaar({ pagina: 'bestellingen', filter: 'te_picken' })}
              className="w-full text-left px-4 min-h-tap text-sm t-accent-text hover:bg-gray-50 border-t border-gray-100">
              {alle} ›
            </button>
          )}
        </div>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-gray-800 mb-2">{titel}</h2>
          <div className={`grid gap-2 ${breedte != null && breedte >= TWEE_KAARTEN_VANAF ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {zichtbaar.map(r => (
              <button key={r.id} type="button" onClick={() => open(r.id)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                <span className="block text-sm font-semibold text-gray-900 break-words">
                  {r.nummer} · {r.klant || t('lbl_onbekend')}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-gray-700">{wat(r, 'inline-flex')}</span>
                <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900 tabular-nums">{euro(r.bedragCent)}</span> · {t(`orders_status_${r.status}`, r.status)}
                  </span>
                  <Chip chip={leverChip(r.levering, t, vandaag)} />
                </span>
              </button>
            ))}
          </div>
          {rest > 0 && (
            <button type="button" onClick={() => gaNaar({ pagina: 'bestellingen', filter: 'te_picken' })}
              className="mt-1 w-full text-left min-h-tap text-sm t-accent-text">
              {alle} ›
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default TePicken
