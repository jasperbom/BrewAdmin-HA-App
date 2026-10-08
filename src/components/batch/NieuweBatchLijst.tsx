import React from 'react'
import { t } from '../../i18n'
import BierKleur from '../ui/BierKleur'
import LegeStaat from '../ui/LegeStaat'
import { ReceptChip } from '../recept/ReceptRij'
import { KiezerKop, KiezerNiets } from '../recept/KiezerBlad'
import { redenTekst, voorraadStip } from '../recept/receptTekst'
import { productEbc } from '../../utils/bierKleur'
import { receptReden } from '../../utils/receptLijst'
import type { ReceptGebruik, ReceptProductRef } from '../../utils/receptGebruik'
import type { ReceptVoorraadOordeel } from '../../utils/ingredientVoorraad'
import type { WatLijst, WatProductRegel } from '../../utils/nieuweBatch'

// Stap 1 van het blad "Wat brouw je?" (SPEC C links, SPEC D): Jouw producten
// — per product het huidige recept, aantal brouwsels, laatste brouwdatum en of
// de ingrediënten klaarliggen — met de subgroep Seizoen / uit roulatie, dan de
// andere recepten in gebruik. Het Brewfather-archief alleen via zoeken. De
// eerdere recepten van een product klappen onder het product open; versies
// zijn nooit een regel (die kies je bij het recept, in stap 2).

export interface NieuweBatchLijstProps {
  lijst: WatLijst<any, any>
  /** Het gekozen recept (hoofdrecept) en, als bekend, het product waaronder. */
  gekozenReceptId: string | null
  gekozenProductId: number | null
  onKies: (g: ReceptGebruik<any>, productId: number | null) => void
  /** Het voorraadoordeel van een recept (dezelfde stip als in de receptenlijst). */
  voorraad: (g: ReceptGebruik<any>) => ReceptVoorraadOordeel | null
  /** Producten met open bestellingen die niet uit voorraad kunnen ("verkoop: tekort"). */
  verkoopTekort?: ReadonlySet<number> | null
  recepten: any[]
  vandaag: string
  smal: boolean
  zoek: string
  onWisZoek: () => void
  /** Plannen zonder recept (een brouwerij zonder Brewfather). */
  onZonderRecept?: () => void
}

const Regel: React.FC<{
  gekozen: boolean
  onKies: () => void
  ebc: unknown
  titel: string
  sub: string
  chips?: React.ReactNode
  ingesprongen?: boolean
  smal: boolean
}> = ({ gekozen, onKies, ebc, titel, sub, chips, ingesprongen = false, smal }) => (
  <button type="button" onClick={onKies} aria-current={gekozen ? 'true' : undefined}
    className={`w-full flex items-center gap-3 text-left rounded-xl pr-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
      ingesprongen ? 'pl-9 py-2 min-h-[52px]' : 'pl-3 py-2.5 min-h-[64px]'
    } ${gekozen ? 't-sel' : 'hover:bg-gray-50 active:bg-gray-100'}`}>
    <BierKleur ebc={ebc as any} s={ingesprongen ? 'sm' : 'md'} />
    <span className="min-w-0 flex-1">
      {/* De chips staan naast de naam; de regel eronder krijgt de volle breedte. */}
      <span className="flex items-center gap-2 min-w-0">
        <span className={`min-w-0 flex-1 font-semibold text-gray-900 truncate ${ingesprongen ? 'text-sm' : smal ? 'text-base' : 'text-[15px]'}`}>{titel}</span>
        {chips && <span className="flex-shrink-0 flex items-center gap-1.5">{chips}</span>}
      </span>
      {sub && <span className="block text-xs text-gray-500 truncate mt-0.5">{sub}</span>}
    </span>
  </button>
)

const NieuweBatchLijst: React.FC<NieuweBatchLijstProps> = ({
  lijst, gekozenReceptId, gekozenProductId, onKies, voorraad, verkoopTekort, recepten, vandaag, smal, zoek,
  onWisZoek, onZonderRecept,
}) => {
  const [eerderOpen, setEerderOpen] = React.useState<Record<number, boolean>>({})

  /** "recept Kadeblond v4 · 5× · laatst 15-9" (op een telefoon zonder het aantal en zonder "recept"). */
  const productSub = (g: ReceptGebruik<any>, ref: ReceptProductRef | null): string => {
    const delen = receptReden(g, { product: ref })
    const reden = redenTekst(smal ? delen.filter(d => d.soort !== 'aantal') : delen, vandaag)
    const naam = g.naam || t('lbl_naamloos')
    return [smal ? naam : t('nb_recept_x').replace('{naam}', naam), reden].filter(Boolean).join(' · ')
  }

  const voorraadChip = (g: ReceptGebruik<any>) => {
    const o = voorraad(g)
    if (!o || o.status === 'onbekend') return null
    const stip = voorraadStip(o)
    if (o.status === 'klaar') {
      return <ReceptChip key="v" soort="huidig"><span title={stip?.label}>{smal ? t('nb_chip_klaar_kort') : t('nb_chip_klaar')}</span></ReceptChip>
    }
    return <ReceptChip key="v" soort="oranje"><span title={stip?.label}>{t('nb_chip_tekort').replace('{n}', String(o.tekort))}</span></ReceptChip>
  }

  const isGekozen = (g: ReceptGebruik<any>, productId: number | null) =>
    gekozenReceptId === g.id && (gekozenProductId == null || productId == null || gekozenProductId === productId)

  const productRegel = (r: WatProductRegel<any, any>, seizoen: boolean) => {
    const pid = Number(r.product.id)
    const ref = (g: ReceptGebruik<any>) => g.producten.find(x => x.productId === pid) || null
    const ebc = productEbc(r.product, recepten)
    const chips: React.ReactNode[] = []
    if (seizoen) {
      if (!smal) chips.push(<ReceptChip key="r" soort="grijs">{t('recept_chip_uit_roulatie')}</ReceptChip>)
    } else {
      const v = voorraadChip(r.recept)
      if (v) chips.push(v)
      if (!smal && verkoopTekort?.has(pid)) {
        chips.push(<span key="s" className="text-[11px] text-gray-500 whitespace-nowrap">{t('nb_chip_verkoop_tekort')}</span>)
      }
    }
    const open = lijst.zoekt || !!eerderOpen[pid]
    return (
      <div key={`${seizoen ? 's' : 'j'}-${pid}`}>
        <Regel gekozen={isGekozen(r.recept, pid)} onKies={() => onKies(r.recept, pid)} ebc={ebc}
          titel={r.product.naam || t('lbl_naamloos')} sub={productSub(r.recept, ref(r.recept))}
          chips={chips.length ? chips : undefined} smal={smal} />
        {r.eerder.length > 0 && !lijst.zoekt && (
          <button type="button" aria-expanded={open} onClick={() => setEerderOpen(o => ({ ...o, [pid]: !o[pid] }))}
            className="ml-9 text-xs font-medium text-gray-600 min-h-tap md:min-h-[30px] px-2 rounded hover:bg-gray-50">
            {(r.eerder.length === 1 ? t('recept_eerder_een') : t('recept_eerder_n').replace('{n}', String(r.eerder.length)))}
            {' '}<span aria-hidden="true">{open ? '▴' : '▾'}</span>
          </button>
        )}
        {open && r.eerder.map(g => (
          <Regel key={g.id} ingesprongen gekozen={isGekozen(g, pid)} onKies={() => onKies(g, pid)} ebc={ebc}
            titel={g.naam || t('lbl_naamloos')} sub={redenTekst(receptReden(g, { product: ref(g) }), vandaag)}
            chips={voorraadChip(g) || undefined} smal={smal} />
        ))}
      </div>
    )
  }

  const receptRegel = (g: ReceptGebruik<any>, archief: boolean) => {
    const delen = receptReden(g, { metStijl: archief })
    const liters = Number(g.recept?.batch_size)
    const sub = [
      redenTekst(delen, vandaag),
      !smal && !archief && liters > 0 ? t('nb_liters_kort').replace('{n}', String(Math.round(liters))) : '',
    ].filter(Boolean).join(' · ')
    const chips: React.ReactNode[] = []
    if (g.vastgepind) chips.push(<ReceptChip key="p" soort="grijs">{t('recept_chip_vastgepind')}</ReceptChip>)
    if (g.nietInBrewfather) chips.push(<ReceptChip key="b" soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip>)
    return (
      <Regel key={`${archief ? 'a' : 'o'}-${g.id}`} gekozen={isGekozen(g, null)} onKies={() => onKies(g, null)}
        ebc={null} titel={g.naam || t('lbl_naamloos')} sub={sub} chips={chips.length ? chips : undefined} smal={smal} />
    )
  }

  const zonderRecept = onZonderRecept && (
    <button type="button" onClick={onZonderRecept}
      className="mt-1 px-3 text-left text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-[32px] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
      {t('nb_zonder_recept')} <span aria-hidden="true">›</span>
    </button>
  )

  if (lijst.leeg) {
    return lijst.zoekt ? (
      <div>
        <KiezerNiets zoek={zoek} onWis={onWisZoek} />
        {zonderRecept}
      </div>
    ) : (
      <LegeStaat cls="my-2" icoon="beer" titel={t('nb_leeg_titel')}
        tekst={lijst.archiefTotaal > 0 ? t('recept_kiezer_archief_hint').replace('{n}', String(lijst.archiefTotaal)) : t('nb_leeg_tekst')}>
        {onZonderRecept && <button type="button" onClick={onZonderRecept}
          className="text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0">{t('nb_zonder_recept')} ›</button>}
      </LegeStaat>
    )
  }

  return (
    <div className="pb-2">
      {lijst.jouw.length > 0 && <KiezerKop>{t('recept_kiezer_jouw_producten')}</KiezerKop>}
      {lijst.jouw.map(r => productRegel(r, false))}
      {lijst.seizoen.length > 0 && <KiezerKop sub>{t('recept_kiezer_seizoen')}</KiezerKop>}
      {lijst.seizoen.map(r => productRegel(r, true))}
      {lijst.andere.length > 0 && (
        <div className={lijst.jouw.length || lijst.seizoen.length ? 'mt-2 pt-1 border-t border-gray-100' : ''}>
          <KiezerKop>{t('recept_kiezer_andere')}</KiezerKop>
          {lijst.andere.map(g => receptRegel(g, false))}
        </div>
      )}
      {lijst.archief.length > 0 && (
        <div className="mt-2 pt-1 border-t border-gray-100">
          <KiezerKop>{t('recept_kiezer_archief')}</KiezerKop>
          {lijst.archief.map(g => receptRegel(g, true))}
        </div>
      )}
      {!lijst.zoekt && lijst.archiefTotaal > 0 && (
        <p className="px-3 pt-4 pb-1 text-sm text-gray-500">
          {t('recept_kiezer_archief_hint').replace('{n}', String(lijst.archiefTotaal))}
        </p>
      )}
      {zonderRecept}
    </div>
  )
}

export default NieuweBatchLijst
