import React, { useState } from 'react'
import { t, getLang } from '../../i18n'
import Btn from '../ui/Btn'
import BierKleur from '../ui/BierKleur'
import Icon from '../ui/Icon'
import LegeStaat from '../ui/LegeStaat'
import SectionHeader from '../ui/SectionHeader'
import { productEbc } from '../../utils/bierKleur'
import { brekenBijPunt, getoondeKomtEraan, komtEraanDelen, productChips, voorraadChips } from '../../utils/verkoopDashboard'
import type { ChipTekst } from '../../utils/verkoopDashboard'
import type { VerkoopOverzichtRegel, VerkoopVerpakking } from '../../utils/verkoopOverzicht'
import type { GaNaar } from '../../utils/route'

interface VoorraadKomtEraanProps {
  /** `verkoopOverzicht(ctx)`: actieve producten, van urgent naar rustig. */
  regels: VerkoopOverzichtRegel[]
  /** Volledige productrecords en recepten — alleen voor de bierkleur. */
  producten: any[]
  recepten: any[]
  verpakkingen: VerkoopVerpakking[]
  vandaag: string
  gaNaar: GaNaar
}

const CHIP: Record<ChipTekst['kleur'], string> = {
  groen: 'bg-green-100 text-green-800',
  oranje: 'bg-orange-100 text-orange-800',
  rood: 'bg-red-100 text-red-700',
  grijs: 'bg-gray-100 text-gray-600',
}

/**
 * "Voorraad en komt eraan": per actief product wat er vrij ligt en in de AGP,
 * per verpakking (nooit flessen en fusten bij elkaar), de dekking als die er
 * is, de THT, een tekort met de datum waarop het opgelost is, en wat er in de
 * tank ligt ("komt eraan: #2609 · GV1 · ± 16-10 ›"). Een product opent het
 * product, een "komt eraan"-regel de batch. Producten zonder voorraad, zonder
 * bestelling en zonder batch onderweg staan ingeklapt onderaan.
 */
const VoorraadKomtEraan: React.FC<VoorraadKomtEraanProps> = ({ regels, producten, recepten, verpakkingen, vandaag, gaNaar }) => {
  const [leegOpen, setLeegOpen] = useState(false)
  const taal = getLang()
  const titel = t('verkoop_voorraad_titel')
  const getoond = regels.filter(r => !r.leeg)
  const leeg = regels.filter(r => r.leeg)
  const ebc = (id: number): number | null => productEbc((producten || []).find((p: any) => p?.id === id), recepten)
  const openProduct = (id: number) => gaNaar({ pagina: 'producten', id })

  if (!regels.length) {
    return (
      <section aria-label={titel}>
        <LegeStaat titel={t('verkoop_geen_producten')} icoon="beer">
          <Btn v="secondary" onClick={() => gaNaar({ pagina: 'producten' })}>{t('verkoop_naar_producten')} ›</Btn>
        </LegeStaat>
      </section>
    )
  }

  return (
    <section aria-label={titel} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <SectionHeader title={titel} rounded="top" />
      <div className="divide-y divide-gray-100">
        {getoond.map(r => {
          const chips = productChips(r, t, { vandaag, taal })
          const vp = voorraadChips(r, t)
          return (
            <div key={r.productId} className="px-4 py-2.5">
              <button type="button" onClick={() => openProduct(r.productId)}
                className="w-full flex items-start gap-3 text-left min-h-tap py-0.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] group">
                <BierKleur ebc={ebc(r.productId)} s="md" cls="mt-0.5" />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-gray-900 break-words group-hover:underline">{r.naam || t('lbl_naamloos')}</span>
                    {chips.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {chips.map((c, i) => (
                          <span key={i} className={`text-xs font-medium px-2 py-0.5 rounded-full ${CHIP[c.kleur]}`}>{brekenBijPunt(c.tekst)}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {vp.length > 0
                      ? vp.map(c => (
                        <span key={c.sleutel} className={`text-xs px-2 py-0.5 rounded-full ${CHIP[c.kleur]}`}>{brekenBijPunt(c.tekst)}</span>
                      ))
                      : <span className="text-xs text-gray-500">{t('verkoop_niets_op_voorraad')}</span>}
                  </span>
                </span>
              </button>
              {getoondeKomtEraan(r).map(k => {
                const d = komtEraanDelen(k, t, { vandaag, verpakkingen })
                return (
                  <button key={k.batchId} type="button" onClick={() => gaNaar({ pagina: 'batches', id: k.batchId })}
                    className="w-full text-left pl-7 min-h-tap sm:min-h-[32px] flex items-center text-xs rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                    <span className="min-w-0">
                      <span className="text-gray-600">{t('verkoop_komt_eraan')}</span>{' '}
                      <span className="t-accent-text font-medium">
                        {brekenBijPunt(d.basis)}
                        {/* De geschatte stuks alleen waar er ruimte is; op een telefoon blijft de regel kort. */}
                        {d.stuks && <span className="hidden md:inline"> · {brekenBijPunt(d.stuks)}</span>}{'\u00a0›'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      {leeg.length > 0 && (
        <div className="border-t border-gray-100">
          <button type="button" aria-expanded={leegOpen} onClick={() => setLeegOpen(o => !o)}
            className="w-full text-left px-4 min-h-tap text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-1">
            <Icon n="chevronRight" cls={`text-gray-400 transition-transform ${leegOpen ? 'rotate-90' : ''}`} />
            {t('verkoop_zonder_voorraad').replace('{n}', String(leeg.length))}
          </button>
          {leegOpen && (
            <div className="pb-1">
              {leeg.map(r => (
                <button key={r.productId} type="button" onClick={() => openProduct(r.productId)}
                  className="w-full flex items-center gap-3 px-4 min-h-tap text-left text-sm text-gray-700 hover:bg-gray-50">
                  <BierKleur ebc={ebc(r.productId)} s="sm" />
                  <span className="flex-1 min-w-0 break-words">{r.naam || t('lbl_naamloos')}</span>
                  {r.uitRoulatie && <span className="text-xs text-gray-500">{t('verkoop_uit_roulatie')}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default VoorraadKomtEraan
