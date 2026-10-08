import React from 'react'
import { t } from '../../i18n'
import { tod, fmtD } from '../../utils/format'
import BierKleur from '../ui/BierKleur'
import KiezerBlad, { KiezerKop, KiezerRegel, KiezerNiets } from './KiezerBlad'
import { ReceptChip } from './ReceptRij'
import { redenTekst, voorraadStip } from './receptTekst'
import { productEbc } from '../../utils/bierKleur'
import { hoofdIdResolver } from '../../utils/productKeten'
import {
  receptGebruik, receptenVoorKiezer,
  type ProductReceptGroep, type ReceptGebruik, type ReceptProductRef,
} from '../../utils/receptGebruik'
import { receptReden, productGroepVoorop } from '../../utils/receptLijst'
import { receptVoorraadOordeel } from '../../utils/ingredientVoorraad'
import type { Batch, Product, Recept } from '../../types'

// De gedeelde receptkiezer (docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 6
// "Overal dezelfde regel"): eerst Jouw producten — per product het huidige
// recept, met de subgroep Seizoen / uit roulatie — dan de andere recepten in
// gebruik; het Brewfather-archief alleen via zoeken. Versies zijn nooit een
// eigen regel, wel (met `metVersies`) een keuze onder hun recept.
//
// Gebruikt voor Recept koppelen op het product; straks ook voor het blad
// "Wat brouw je?" (F8), Recept opnieuw toepassen en de receptfilter in
// Batches (F7). Modal op het bureau, Onderblad op een telefoon, of met
// `inline` als lijst op de pagina.

export interface ReceptKeuze {
  /** Het hoofdrecept (nooit een versie-id). */
  receptId: string
  /** De gekozen versie (alleen met `metVersies`); null = het recept zelf. */
  versieId: string | null
  /**
   * Het product van de groep waaruit gekozen is (Jouw producten, Seizoen);
   * null bij Andere recepten in gebruik, het archief en verborgen recepten.
   */
  productId: number | null
}

export interface ReceptKiezerProps {
  /** Titel van het blad; standaard "Kies een recept". */
  titel?: string
  recepten: Recept[] | any[] | null | undefined
  batches: Batch[] | any[] | null | undefined
  producten: Product[] | any[] | null | undefined
  /** `recepten_verborgen`: die recepten staan er niet in (wel bij zoeken, met `metVerborgen`). */
  verborgen?: ReadonlyArray<unknown> | null
  /** `recepten_gearchiveerde_tags`. */
  gearchiveerdeTags?: ReadonlyArray<string> | null
  onKies: (keuze: ReceptKeuze) => void
  onSluit: () => void
  /** Versies als keuze onder een recept ("3 versies ▾"), nooit als eigen regel. */
  metVersies?: boolean
  /** Dit product bovenaan, met al zijn recepten open (nieuwe batch of koppelen op een product). */
  productId?: number | null
  /** Hoofdrecepten die al gekoppeld of gekozen zijn: gemarkeerd en niet kiesbaar. */
  uitgesloten?: ReadonlyArray<string | null | undefined> | null
  /** De markering bij een uitgesloten recept; standaard "gekoppeld". */
  uitgeslotenLabel?: string
  /** Het recept dat nu gekozen is: gemarkeerd, wel kiesbaar. Een versie-id telt voor zijn hoofdrecept. */
  gekozenId?: string | null
  /** Met de voorraadcontrole per recept (stip "ingrediënten op voorraad" / "tekort"). */
  voorraad?: { lots: any[] | null | undefined; ingredienten: any[] | null | undefined } | null
  /** Ook verborgen recepten doorzoeken. */
  metVerborgen?: boolean
  /** Als lijst op de pagina in plaats van als blad. */
  inline?: boolean
  /** Peildatum (JJJJ-MM-DD) voor "recent" en de datums; standaard vandaag. */
  vandaag?: string
}

const ReceptKiezer: React.FC<ReceptKiezerProps> = ({
  titel, recepten, batches, producten, verborgen, gearchiveerdeTags, onKies, onSluit,
  metVersies = false, productId = null, uitgesloten, uitgeslotenLabel, gekozenId, voorraad,
  metVerborgen = false, inline = false, vandaag,
}) => {
  const [zoek, setZoek] = React.useState('')
  const [versiesOpen, setVersiesOpen] = React.useState<Record<string, boolean>>({})
  const [eerderOpen, setEerderOpen] = React.useState<Record<number, boolean>>({})
  const dag = vandaag || tod()

  const gebruik = React.useMemo(() => receptGebruik({
    recepten: (recepten || []) as Recept[], batches: (batches || []) as Batch[], producten: (producten || []) as Product[],
    verborgen: (verborgen || []) as any, gearchiveerdeTags: (gearchiveerdeTags || []) as string[], vandaag: dag,
  }), [recepten, batches, producten, verborgen, gearchiveerdeTags, dag])
  const kiezer = React.useMemo(
    () => receptenVoorKiezer(gebruik, { producten: (producten || []) as Product[], zoek, metVerborgen }),
    [gebruik, producten, zoek, metVerborgen])
  const naarHoofd = React.useMemo(() => hoofdIdResolver((recepten || []) as Recept[]), [recepten])
  const uit = React.useMemo(() => new Set((uitgesloten || []).map(id => naarHoofd(id)).filter(Boolean)), [uitgesloten, naarHoofd])
  const gekozen = gekozenId ? naarHoofd(gekozenId) : ''

  // De voorraadcontrole alleen voor wat er in beeld komt.
  const oordeel = React.useCallback((g: ReceptGebruik<any>) =>
    voorraad ? receptVoorraadOordeel(g.recept, voorraad.lots, voorraad.ingredienten) : null, [voorraad])

  const jouw = productGroepVoorop(kiezer.jouwProducten, productId)
  const seizoen = productGroepVoorop(kiezer.uitRoulatie, productId)
  // Niets te kiezen (producten zonder recept tellen hier niet: die kies je niet).
  const niets = !jouw.length && !seizoen.length && !kiezer.andereInGebruik.length &&
    !kiezer.archief.length && !kiezer.verborgen.length

  const kies = (g: ReceptGebruik<any>, pid: number | null, versieId: string | null = null) => {
    if (uit.has(g.id)) return
    onKies({ receptId: g.id, versieId, productId: pid })
  }

  const regel = (g: ReceptGebruik<any>, product: ReceptProductRef | null, pid: number | null, huidig: boolean) => {
    const isUit = uit.has(g.id)
    const stip = voorraadStip(oordeel(g))
    const versies = metVersies ? g.versies : []
    const open = !!versiesOpen[g.id]
    return (
      <div key={`${pid ?? 'los'}-${g.id}`}>
        <KiezerRegel
          onKies={() => kies(g, pid)}
          disabled={isUit}
          gekozen={gekozen === g.id}
          titel={<span className="inline-flex items-center gap-1.5 max-w-full">
            <span className="truncate">{g.naam || t('lbl_naamloos')}</span>
            {huidig && <ReceptChip soort="huidig">{t('recept_chip_huidig')}</ReceptChip>}
            {g.status === 'verborgen' && <ReceptChip soort="grijs">{t('recept_chip_verborgen')}</ReceptChip>}
            {g.nietInBrewfather && <ReceptChip soort="oranje">{t('recept_chip_niet_in_brewfather')}</ReceptChip>}
            {isUit && <ReceptChip soort="grijs">{uitgeslotenLabel || t('recept_chip_gekoppeld')}</ReceptChip>}
          </span>}
          sub={redenTekst(receptReden(g, { product, metStijl: g.status === 'archief' || g.status === 'verborgen' }), dag)}
          rechts={stip && <span role="img" aria-label={stip.label} title={stip.label} className={`w-2 h-2 rounded-full flex-shrink-0 ${stip.kleur}`} />}
        />
        {versies.length > 0 && !isUit && (
          <div className="pl-3">
            <button type="button" aria-expanded={open} onClick={() => setVersiesOpen(o => ({ ...o, [g.id]: !o[g.id] }))}
              className="text-xs font-medium text-gray-600 min-h-tap md:min-h-[32px] px-2 rounded hover:bg-gray-50">
              {t('recept_kiezer_versies').replace('{n}', String(versies.length))} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
            </button>
            {open && versies.map((v: any) => (
              <KiezerRegel key={String(v.id)} onKies={() => kies(g, pid, String(v.id))}
                gekozen={gekozenId != null && String(gekozenId) === String(v.id)}
                titel={v.versie || t('recipe_version_snapshot')}
                sub={v.versie_datum ? fmtD(String(v.versie_datum).slice(0, 10)) : undefined} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const groep = (gr: ProductReceptGroep<any, any>) => {
    const pid = gr.product.id
    const ref = (g: ReceptGebruik<any>) => g.producten.find(x => x.productId === pid) || null
    const open = kiezer.zoekt || !gr.huidig || pid === productId || !!eerderOpen[pid]
    return (
      <div key={pid} className="mb-2">
        <div className="flex items-center gap-2 px-1 pt-2 pb-1 min-w-0">
          <BierKleur ebc={productEbc(gr.product, (recepten || []) as any[])} s="sm" />
          <span className="text-xs font-semibold text-gray-700 truncate">{gr.product.naam || t('lbl_naamloos')}</span>
        </div>
        {gr.huidig && regel(gr.huidig, ref(gr.huidig), pid, true)}
        {gr.eerder.length > 0 && gr.huidig && !open && (
          <button type="button" onClick={() => setEerderOpen(o => ({ ...o, [pid]: true }))}
            className="text-xs font-medium text-gray-600 min-h-tap md:min-h-[32px] px-3 rounded hover:bg-gray-50">
            {(gr.eerder.length === 1 ? t('recept_eerder_een') : t('recept_eerder_n').replace('{n}', String(gr.eerder.length)))} <span aria-hidden="true">▾</span>
          </button>
        )}
        {open && gr.eerder.map(g => regel(g, ref(g), pid, false))}
      </div>
    )
  }

  return (
    <KiezerBlad titel={titel || t('recept_kiezer_titel')} onSluit={onSluit} zoek={zoek} onZoek={setZoek}
      zoekPlaceholder={t('search_recipe')} inline={inline}>
      {niets ? (
        <KiezerNiets zoek={zoek} onWis={() => setZoek('')}
          tekst={kiezer.zoekt ? undefined : t('recept_kiezer_leeg').replace('{n}', String(kiezer.archiefTotaal))} />
      ) : (
        <div>
          {jouw.length > 0 && <KiezerKop>{t('recept_kiezer_jouw_producten')}</KiezerKop>}
          {jouw.map(groep)}
          {seizoen.length > 0 && <KiezerKop sub>{t('recept_kiezer_seizoen')}</KiezerKop>}
          {seizoen.map(groep)}
          {kiezer.andereInGebruik.length > 0 && <KiezerKop>{t('recept_kiezer_andere')}</KiezerKop>}
          {kiezer.andereInGebruik.map(g => regel(g, null, null, false))}
          {kiezer.archief.length > 0 && <KiezerKop>{t('recept_kiezer_archief')}</KiezerKop>}
          {kiezer.archief.map(g => regel(g, null, null, false))}
          {kiezer.verborgen.length > 0 && <KiezerKop>{t('recept_segment_verborgen')}</KiezerKop>}
          {kiezer.verborgen.map(g => regel(g, null, null, false))}
          {!kiezer.zoekt && kiezer.archiefTotaal > 0 && (
            <p className="px-1 pt-4 pb-1 text-xs text-gray-500">
              {t('recept_kiezer_archief_hint').replace('{n}', String(kiezer.archiefTotaal))}
            </p>
          )}
        </div>
      )}
    </KiezerBlad>
  )
}

export default ReceptKiezer
