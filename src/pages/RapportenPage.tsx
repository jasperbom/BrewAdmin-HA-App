import React from 'react'
import { t } from '../i18n'
import type { AttentieDoel } from '../utils/attentie'
import SectionHeader from '../components/ui/SectionHeader'
import Btn from '../components/ui/Btn'

// ── Rapporten ───────────────────────────────────────────────────────────────
// De tweede ingang van de werkruimte Administratie. Het dashboard toont wat om
// een besluit vraagt; hier staat alles wat terugkijkt: kies een periode,
// bekijk, exporteer. Deze pagina rekent zelf niets uit en bewaart niets — het
// is puur een wegwijzer naar het rapport zoals het al bestaat, zodat er nooit
// twee versies van hetzelfde cijfer ontstaan.

export interface RapportenPageProps {
  /** Navigeert naar het rapport (pagina + tabblad/sub-tab). */
  gaNaarDoel: (d: AttentieDoel) => void
}

interface RapportKaart {
  id: string
  /** i18n-sleutel van de naam; de uitleg is dezelfde sleutel + '_uitleg'. */
  sleutel: string
  doel: AttentieDoel
}

// `filter` is de sub-tab binnen Boekhouding → Rapporten (rapportTab).
const FINANCIEEL: RapportKaart[] = [
  { id: 'wv', sleutel: 'rapport_wv', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'wv' } },
  { id: 'balans', sleutel: 'rapport_balans', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'balans' } },
  { id: 'journaal', sleutel: 'rapport_journaal', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'journaal' } },
  { id: 'ouderdom', sleutel: 'rapport_ouderdom', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'ouderdom' } },
  { id: 'omzet_cat', sleutel: 'rapport_omzet_cat', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'omzet_cat' } },
  { id: 'transacties', sleutel: 'rapport_transacties', doel: { pagina: 'boekhouding', tab: 'rapporten', filter: 'transacties' } },
  { id: 'btw', sleutel: 'rapport_btw', doel: { pagina: 'boekhouding', tab: 'btw_aangifte' } },
]

const VOORRAAD: RapportKaart[] = [
  { id: 'agp', sleutel: 'rapport_agp', doel: { pagina: 'agp' } },
  { id: 'voorraadverloop', sleutel: 'rapport_voorraadverloop', doel: { pagina: 'voorraadverloop' } },
  { id: 'inventarisatie', sleutel: 'rapport_inventarisatie', doel: { pagina: 'inventarisatie' } },
  { id: 'haccp', sleutel: 'rapport_haccp', doel: { pagina: 'haccp', tab: 'kritisch' } },
]

function RapportenPage({ gaNaarDoel }: RapportenPageProps) {
  const groep = (titel: string, kaarten: RapportKaart[]) => (
    <div className="mb-6">
      <SectionHeader title={titel} rounded="full" cls="mb-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {kaarten.map(k => (
          <div key={k.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col">
            <p className="text-sm font-semibold text-gray-800">{t(k.sleutel)}</p>
            <p className="text-xs text-gray-500 mt-1 flex-1">{t(`${k.sleutel}_uitleg`)}</p>
            <div className="mt-3">
              <Btn v="secondary" s="sm" onClick={() => gaNaarDoel(k.doel)}>{t('btn_bekijken')}</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <p className="text-sm text-gray-600 mb-5">{t('rapporten_intro')}</p>
      {groep(t('rapporten_groep_financieel'), FINANCIEEL)}
      {groep(t('rapporten_groep_voorraad'), VOORRAAD)}
    </div>
  )
}

export default RapportenPage
