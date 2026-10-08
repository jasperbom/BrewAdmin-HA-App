import React, { useMemo } from 'react'
import { t } from '../i18n'
import { tod } from '../utils/format'
import { attentieBehalve } from '../utils/attentie'
import type { AttentiePost } from '../utils/attentie'
import { verkoopOverzicht } from '../utils/verkoopOverzicht'
import type { VerkoopCtx } from '../utils/verkoopOverzicht'
import { tePickenRijen, wcImportTekst } from '../utils/verkoopDashboard'
import { vulIn } from '../utils/attentieTekst'
import type { GaNaar } from '../utils/route'
import AttentieKaart from '../components/ui/AttentieKaart'
import TePicken from '../components/verkoop/TePicken'
import VoorraadKomtEraan from '../components/verkoop/VoorraadKomtEraan'

interface VerkoopDashboardProps {
  /**
   * De gedeelde verkoopcontext (App.tsx): één voorraadtelling voor het
   * Overzicht, de attentieposten, de productpagina en de kassa
   * (utils/verkoopOverzicht.ts). Eén object per stand van de data — de module
   * onthoudt per context wat hij uitrekende.
   */
  verkoopCtx: VerkoopCtx
  /** De posten van Verkoop (utils/attentie.ts) — dezelfde als de badge op de werkruimte. */
  attentie: AttentiePost[]
  /** Volledige productrecords en recepten, voor de bierkleur. */
  producten: any[]
  recepten: any[]
  /** Navigatie van de schil: een bestelling, product of batch openen (in de route). */
  gaNaar: GaNaar
  wcCreds?: any
  /** `wc_import_status`: de laatste import van de webshoporders. */
  wcImportStatus?: any
  /** Minuten tussen twee automatische imports (`woocommerce_creds.importInterval`; 0 = uit). */
  wcImportInterval?: number
  wcSyncLog?: any[]
}

// De post `bestellingen` staat hier als eigen kaart ("Te picken") — niet nog
// eens in "Vraagt om aandacht".
const EIGEN_KAART = ['bestellingen']

/**
 * Verkoop › Overzicht. Links wat er te doen is (vraagt om aandacht, te
 * picken), rechts wat er ligt en wat eraan komt — vanaf 1280 px naast elkaar,
 * daaronder onder elkaar. Geen knoppen die de tabs herhalen. Alle getallen uit
 * één telling (utils/verkoopOverzicht.ts): geen vaste drempel, flessen en
 * fusten nooit opgeteld.
 */
function VerkoopDashboard({
  verkoopCtx, attentie = [], producten = [], recepten = [], gaNaar,
  wcCreds, wcImportStatus, wcImportInterval = 15, wcSyncLog = [],
}: VerkoopDashboardProps) {
  const vandaag = verkoopCtx.vandaag || tod()
  const posten = useMemo(() => attentieBehalve(attentie, EIGEN_KAART), [attentie])
  const rijen = useMemo(() => tePickenRijen(verkoopCtx), [verkoopCtx])
  const overzicht = useMemo(() => verkoopOverzicht(verkoopCtx), [verkoopCtx])

  // Onderaan klein: de automatische import, en in rood een fout als de laatste
  // controle (→ bestellingen) of voorraadpush (→ producten) misging.
  const wcAan = !!wcCreds?.enabled
  const laatsteSync = (wcSyncLog || [])[0]
  const wcFouten: Array<{ tekst: string; pagina: string }> = []
  if (wcAan && wcImportStatus?.laatste_fout) {
    wcFouten.push({ tekst: vulIn(t('verkoop_wc_controle_fout'), { fout: String(wcImportStatus.laatste_fout) }), pagina: 'bestellingen' })
  }
  if (wcAan && laatsteSync?.type === 'fout') {
    wcFouten.push({ tekst: vulIn(t('verkoop_wc_sync_fout'), { fout: String(laatsteSync.msg || '') }), pagina: 'producten' })
  }

  return (
    <div>
      <h2 className="hidden md:block text-xl font-bold text-gray-800 mb-4">{t('nav_overzicht')}</h2>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 min-w-0 space-y-5">
          <AttentieKaart posten={posten} onGaNaar={gaNaar} />
          <TePicken rijen={rijen} producten={producten} recepten={recepten} vandaag={vandaag} gaNaar={gaNaar} />
        </div>
        <div className="min-w-0">
          <VoorraadKomtEraan regels={overzicht} producten={producten} recepten={recepten}
            verpakkingen={verkoopCtx.verpakkingen || []} vandaag={vandaag} gaNaar={gaNaar} />
        </div>
      </div>
      {wcAan && (
        <div className="mt-5 space-y-1">
          {/* Zonder winkeladres importeert er niets, wat het interval ook zegt. */}
          <p className="text-xs text-gray-500">{wcImportTekst(wcImportStatus, wcCreds?.storeUrl ? wcImportInterval : 0, t)}</p>
          {wcFouten.map(f => (
            <button key={f.pagina} type="button" onClick={() => gaNaar({ pagina: f.pagina })}
              className="flex items-center min-h-tap sm:min-h-0 text-left text-xs text-red-700 hover:underline break-words">{f.tekst} ›</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default VerkoopDashboard
