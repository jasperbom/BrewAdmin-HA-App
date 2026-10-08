import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtD, fmtSg } from '../../utils/format'
import { allergeenNamen, decimaalteken, fmtGetal } from '../../utils/etiket'
import { receptReden } from '../../utils/receptLijst'
import type {
  EtiketVooruitblik, IngredientenOordeel, ReceptDoelen, TankOpDatum, VooruitblikRegel, VooruitKleur,
} from '../../utils/nieuweBatch'
import type { PlanProduct, ProductBesluit, ProductKeuzeWaarde } from '../../utils/batchKeten'
import type { ReceptGebruik } from '../../utils/receptGebruik'
import type { TankBeschikbaarheid } from '../../utils/productKeten'
import Inp from '../ui/Inp'
import Icon from '../ui/Icon'
import PlanProductKeuze from './PlanProductKeuze'
import { tankStatusRegel } from './tankOpties'
import { redenTekst } from '../recept/receptTekst'
import { useAllergenenOpzoeken } from '../AllergenenOpzoeken'

// Stap 2 van het blad "Wat brouw je?" (SPEC C rechts): de keten (recept ›
// product), brouwdatum, de tank met zijn status óp die datum, liters,
// batchnummer en naam; dan wat het recept meebrengt — doelen, ingrediënten en
// een vooruitblik op het etiket. De vooruitblik blokkeert nooit.

export interface NieuweBatchPlanProps {
  vandaag: string
  /** Het receptrecord dat gebrouwen wordt (de gekozen versie of het hoofdrecept); null zonder recept. */
  recept: any | null
  /** Het hoofdrecept met zijn versies. */
  gebruik: ReceptGebruik<any> | null
  versieId: string | null
  zonderRecept: boolean
  /** Nog niets gekozen (bureau: rechts staat het plan al, links de keuze). */
  nogNiets: boolean
  /** De andere recepten van het product waaronder gekozen is ("Ander recept van Kadeblond"). */
  groepProduct: any | null
  andereRecepten: ReceptGebruik<any>[]
  onVersie: (versieId: string | null) => void
  onAnderRecept: (g: ReceptGebruik<any>) => void

  plan: PlanProduct<any> | null
  productKeuze: ProductKeuzeWaarde | null
  onProductKeuze: (k: ProductKeuzeWaarde | null) => void
  besluit: ProductBesluit<any>
  producten: any[]
  recepten: any[]

  datum: string
  onDatum: (v: string) => void
  tank: string
  onTank: (v: string) => void
  tanks: TankOpDatum<any>[]
  batchLabel: (b: any) => string
  liters: string
  /** De liters van het recept (null = het recept noemt er geen). */
  litersRecept: number | null
  onLiters: (v: string) => void
  batchNummer: string
  naam: string
  onNaam: (v: string) => void
  naamVoorstel: string
  naamBron: 'product' | 'recept' | null

  doelen: ReceptDoelen | null
  ingredienten: IngredientenOordeel | null
  vooruitblik: EtiketVooruitblik | null
  /** Het bestaande product waarmee de vooruitblik vergelijkt. */
  vooruitProduct: any | null
  onEtiketBijwerken?: (productId: number) => void
}

const KLEUR_TEKST: Record<VooruitKleur, string> = {
  rood: 'text-red-700', oranje: 'text-orange-700', groen: 'text-green-700', grijs: 'text-gray-600',
}

/** "6,8 %" (één decimaal, zoals het etiket; "6.8%" in het Engels), niet over twee regels. */
const pct = (n: number, taal: string): string => {
  const getal = fmtGetal(Math.round(n * 10) / 10, 1, taal)
  return decimaalteken(taal) === '.' ? `${getal}%` : `${getal}\u00a0%`
}

/** De ene regel van de vooruitblik, met getallen en namen ingevuld. */
const vooruitTekst = (r: VooruitblikRegel, product: string, versie: string, taal: string): string =>
  t(r.sleutel)
    .replace('{recept}', r.recept != null ? pct(r.recept, taal) : '')
    .replace('{etiket}', r.etiket != null ? pct(r.etiket, taal) : '')
    .replace('{marge}', r.marge != null ? fmtGetal(r.marge, 1, taal) : '')
    .replace('{allergenen}', r.allergenen?.length ? allergeenNamen(r.allergenen, t).join(', ') : t('nb_allergenen_geen'))
    .replace('{ingredienten}', (r.ingredienten || []).join(', '))
    .replace('{product}', product)
    .replace('{versie}', versie)

// De ketenchips, zoals de ketenregel in de batchkop: "Recept · Kadeblond v4 ▾" › "Product · Kadeblond".
// Telefoon: twee chips naast elkaar (elk de halve breedte, de tekst loopt door).
const CHIP = 'inline-flex items-center gap-1 max-w-full min-w-0 basis-[calc(50%-0.25rem)] grow md:basis-auto md:grow-0 ' +
  'min-h-tap md:min-h-[30px] px-3 md:px-2.5 py-1 rounded-[10px] md:rounded-full border text-[13px] font-medium leading-snug text-left'
const CHIP_LINK = `${CHIP} bg-[color:var(--t-pale)] border-[color:var(--t-light)] text-[color:var(--t-text)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]`
const CHIP_STIL = `${CHIP} bg-[color:var(--t-pale)] border-[color:var(--t-light)] text-[color:var(--t-text)]`
const CHIP_LEEG = `${CHIP} bg-gray-50 border-gray-200 text-gray-600`

const Blok: React.FC<{ titel: string; children: React.ReactNode; cls?: string }> = ({ titel, children, cls = '' }) => (
  <section className={`rounded-xl px-3.5 py-3 ${cls || 'bg-gray-50'}`}>
    <h4 className="text-xs font-medium text-gray-600 mb-1">{titel}</h4>
    {children}
  </section>
)

const OptieRij: React.FC<{ gekozen: boolean; onKies: () => void; titel: string; sub?: string }> = ({ gekozen, onKies, titel, sub }) => (
  <button type="button" onClick={onKies} aria-pressed={gekozen}
    className={`w-full flex items-center gap-2.5 text-left px-2.5 py-1.5 min-h-tap md:min-h-[36px] rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${gekozen ? 't-sel' : 'hover:bg-white'}`}>
    <span aria-hidden="true" className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 ${gekozen ? 'border-[color:var(--t-accent)] border-[4px]' : 'border-gray-400'}`} />
    <span className="min-w-0 flex-1">
      <span className="block text-sm text-gray-900 truncate">{titel}</span>
      {sub && <span className="block text-xs text-gray-500 truncate">{sub}</span>}
    </span>
  </button>
)

const NieuweBatchPlan: React.FC<NieuweBatchPlanProps> = (p) => {
  const taal = getLang()
  const opzoeken = useAllergenenOpzoeken()
  const [optiesOpen, setOptiesOpen] = React.useState(false)
  const tankGroep = React.useId()

  // ── Recept en versie ──────────────────────────────────────────────────────
  const versies: any[] = p.gebruik?.versies || []
  const versie = p.versieId ? versies.find(v => String(v.id) === p.versieId) || null : null
  const heeftOpties = versies.length > 0 || p.andereRecepten.length > 0
  const receptNaam = p.gebruik?.naam || p.recept?.naam || t('lbl_naamloos')
  const receptChipTekst = versie ? `${receptNaam} · ${versie.versie || t('recipe_version_snapshot')}` : receptNaam

  // ── Het product ───────────────────────────────────────────────────────────
  const { plan, productKeuze, besluit } = p
  const vast = !plan || plan.soort === 'behouden' || (plan.soort === 'een' &&
    (!productKeuze || (productKeuze.soort === 'product' && Number(productKeuze.productId) === Number(plan.product.id))))
  const productChip = besluit.product
    ? <span className={CHIP_STIL}><span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_product')} · </span>{besluit.product.naam || t('lbl_naamloos')}</span></span>
    : besluit.nieuwNaam
      ? <span className={CHIP_STIL}><span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_product')} · </span>{t('nb_product_nieuw').replace('{naam}', besluit.nieuwNaam)}</span></span>
      : <span className={CHIP_LEEG}><span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_product')} · </span>{t('nb_product_nog_niet')}</span></span>
  const productUitleg = besluit.automatisch ? t('keten_product_auto') : null

  // ── De tank ───────────────────────────────────────────────────────────────
  const tankTekst = (b: TankBeschikbaarheid<any>): React.ReactNode => {
    const r = tankStatusRegel(b, p.batchLabel, p.vandaag)
    return (
      <>
        <span className={KLEUR_TEKST[r.kleur]}>{r.hoofd}</span>
        {r.extra.map((x, i) => (
          <span key={i} className={r.krap && i === r.extra.length - 1 ? 'text-orange-700' : 'text-gray-600'}> · {x}</span>
        ))}
      </>
    )
  }
  const tanks = [...p.tanks].sort((a, b) => Number(b.beschikbaar.kiesbaar) - Number(a.beschikbaar.kiesbaar))
  const gekozenTank = p.tank ? p.tanks.find(tk => tk.id === p.tank) || null : null

  // ── Liters en naam ────────────────────────────────────────────────────────
  const litersGetal = Number(String(p.liters).replace(',', '.'))
  const litersAnders = p.liters.trim() !== '' && Number.isFinite(litersGetal) && litersGetal > 0 &&
    (p.litersRecept == null || litersGetal !== p.litersRecept)
  const naamHint = p.naam.trim() ? null
    : p.naamBron === 'product' ? t('nb_naam_product')
    : p.naamBron === 'recept' ? t('nb_naam_recept')
    : p.zonderRecept ? t('nb_naam_verplicht')
    : null

  // ── Doelen ────────────────────────────────────────────────────────────────
  const doelen = p.doelen
  const doelTekst = doelen ? [
    doelen.og != null ? `${t('lbl_og')} ${fmtSg(doelen.og)}` : '',
    doelen.fg != null ? `${t('lbl_fg')} ${fmtSg(doelen.fg)}` : '',
    doelen.abv != null ? pct(doelen.abv, taal) : '',
    doelen.ibu != null ? t('recept_ibu').replace('{n}', String(Math.round(doelen.ibu))) : '',
    doelen.ebc != null ? t('recept_ebc').replace('{n}', String(Math.round(doelen.ebc))) : '',
    doelen.kcal != null && doelen.kj != null ? t('recept_energie').replace('{kcal}', String(doelen.kcal)).replace('{kj}', String(doelen.kj)) : '',
  ].filter(Boolean).map(x => x.replace(/ /g, '\u00a0')).join(' · ') : ''

  const ingr = p.ingredienten
  const vb = p.vooruitblik
  const vbProduct = String(p.vooruitProduct?.naam || '')
  // Ingrediënten van het recept zonder beoordeelde allergenen: meteen opzoeken.
  const opTeZoeken = vb?.verwacht.allergenen.nietBeoordeeldIds || []

  return (
    <div className="space-y-4">
      {/* ── De keten ── */}
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        {p.nogNiets ? (
          <p className="text-sm text-gray-500">{t('nb_kies_links')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {p.zonderRecept ? (
                <span className={CHIP_LEEG}><span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_recept')} · </span>{t('nb_recept_geen')}</span></span>
              ) : heeftOpties ? (
                <button type="button" className={CHIP_LINK} aria-expanded={optiesOpen} onClick={() => setOptiesOpen(o => !o)}>
                  <span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_recept')} · </span>{receptChipTekst}</span>
                  <span aria-hidden="true">{optiesOpen ? '▴' : '▾'}</span>
                </button>
              ) : (
                <span className={CHIP_STIL}><span className="min-w-0 break-words"><span className="font-normal opacity-80">{t('keten_recept')} · </span>{receptChipTekst}</span></span>
              )}
              <span aria-hidden="true" className="hidden md:inline text-gray-400">›</span>
              {productChip}
            </div>
            {productUitleg && <p className="text-xs text-gray-500">{productUitleg}</p>}
            {optiesOpen && heeftOpties && (
              <div className="rounded-lg bg-gray-50 p-1.5 space-y-0.5">
                {versies.length > 0 && (
                  <>
                    <div className="px-2 pt-1 text-xs font-medium text-gray-500">{t('nb_versie')}</div>
                    <OptieRij gekozen={!p.versieId} onKies={() => { p.onVersie(null); setOptiesOpen(false) }}
                      titel={t('recept_versie_huidig')} />
                    {versies.map(v => (
                      <OptieRij key={String(v.id)} gekozen={p.versieId === String(v.id)}
                        onKies={() => { p.onVersie(String(v.id)); setOptiesOpen(false) }}
                        titel={v.versie || t('recipe_version_snapshot')}
                        sub={v.versie_datum ? fmtD(String(v.versie_datum).slice(0, 10)) : undefined} />
                    ))}
                  </>
                )}
                {p.andereRecepten.length > 0 && (
                  <>
                    <div className="px-2 pt-2 text-xs font-medium text-gray-500">
                      {t('nb_ander_recept').replace('{product}', p.groepProduct?.naam || t('lbl_naamloos'))}
                    </div>
                    {p.andereRecepten.map(g => {
                      const ref = g.producten.find(x => x.productId === Number(p.groepProduct?.id)) || null
                      return (
                        <OptieRij key={g.id} gekozen={false} onKies={() => { p.onAnderRecept(g); setOptiesOpen(false) }}
                          titel={g.naam || t('lbl_naamloos')} sub={redenTekst(receptReden(g, { product: ref }), p.vandaag)} />
                      )
                    })}
                  </>
                )}
              </div>
            )}
            {!vast && plan && (
              <div className="pt-1">
                <PlanProductKeuze zonderLabel plan={plan} keuze={productKeuze} onKeuze={p.onProductKeuze}
                  standaardNaam={p.recept?.naam || ''} recepten={p.recepten} producten={p.producten} />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Wanneer ── */}
      <div className="md:max-w-[240px]">
        <Inp label={t('flow_nieuw_datum')} type="date" value={p.datum} onChange={p.onDatum} />
      </div>

      {/* ── Waar: de status op de brouwdatum ── */}
      {p.tanks.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-1">
            {t('lbl_tank')} <span className="font-normal text-gray-500">· {t('nb_tank_op_datum')}</span>
          </legend>
          <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {tanks.map(tk => {
              const kiesbaar = tk.beschikbaar.kiesbaar
              const gekozen = p.tank === tk.id
              return (
                <label key={tk.id}
                  className={`flex items-start gap-3 px-3 py-2.5 min-h-[48px] ${kiesbaar ? 'cursor-pointer' : 'cursor-not-allowed bg-gray-50'} ${gekozen ? 'bg-[color:var(--t-pale)]' : kiesbaar ? 'hover:bg-gray-50' : ''}`}>
                  <input type="radio" name={tankGroep} value={tk.id} checked={gekozen} disabled={!kiesbaar}
                    onChange={() => p.onTank(tk.id)} className="t-checkbox w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span className={`w-14 flex-shrink-0 text-sm font-semibold ${kiesbaar ? 'text-gray-900' : 'text-gray-400'}`}>{tk.naam}</span>
                  <span className={`min-w-0 flex-1 text-sm break-words ${kiesbaar ? '' : 'opacity-70'}`}>{tankTekst(tk.beschikbaar)}</span>
                </label>
              )
            })}
            <label className={`flex items-center gap-3 px-3 py-2.5 min-h-[48px] cursor-pointer ${!p.tank ? 'bg-[color:var(--t-pale)]' : 'hover:bg-gray-50'}`}>
              <input type="radio" name={tankGroep} value="" checked={!p.tank} onChange={() => p.onTank('')}
                className="t-checkbox w-4 h-4 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('nb_tank_later')}</span>
            </label>
          </div>
          {gekozenTank && !gekozenTank.beschikbaar.kiesbaar && (
            <p role="alert" className="mt-1.5 text-xs text-orange-700">
              {t('nb_tank_kies_ander').replace('{tank}', gekozenTank.naam)}
            </p>
          )}
        </fieldset>
      )}

      {/* ── Liters, batchnummer, naam ── */}
      <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <div className="min-w-0">
          <Inp label={t('nb_liters')} type="number" min={0} step="any" value={p.liters} onChange={p.onLiters} />
          {litersAnders
            ? <p className="text-xs text-orange-700 mt-1">{t('nb_liters_anders').replace('{n}', String(p.litersRecept ?? '—'))}</p>
            : p.litersRecept != null && <p className="text-xs text-gray-500 mt-1">{t('nb_liters_recept')}</p>}
        </div>
        <div className="min-w-0">
          <div className="block text-sm font-medium text-gray-700 mb-1">{t('nb_batchnummer')}</div>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 min-h-tap sm:min-h-0 text-sm text-gray-700 bg-gray-50 flex items-center">#{p.batchNummer}</div>
        </div>
        <div className="col-span-2 lg:col-span-1 min-w-0">
          <Inp label={t('lbl_name')} value={p.naam} onChange={p.onNaam} placeholder={p.naamVoorstel} />
          {naamHint && <p className={`text-xs mt-1 ${p.zonderRecept && !p.naam.trim() ? 'text-orange-700' : 'text-gray-500'}`}>{naamHint}</p>}
        </div>
      </div>

      {/* ── Wat het recept meebrengt ── */}
      {p.recept && doelTekst && (
        <Blok titel={t('nb_doelen')}>
          <p className="text-sm font-medium text-gray-900 break-words">{doelTekst}</p>
        </Blok>
      )}

      {p.recept && ingr && (
        <Blok titel={t('nb_ingredienten')}>
          {ingr.regels === 0 ? (
            <p className="text-sm text-gray-600">{t('nb_ingr_geen')}</p>
          ) : ingr.status === 'klaar' ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-green-700">
              <Icon n="check" cls="flex-shrink-0" />{t('nb_ingr_klaar').replace('{n}', String(ingr.regels))}
            </p>
          ) : (
            <div className="space-y-0.5">
              {ingr.tekort.length > 0 && (
                <p className="flex items-start gap-1.5 text-sm font-medium text-orange-700">
                  <Icon n="alert" cls="flex-shrink-0 mt-0.5" /><span className="min-w-0 break-words">{t('nb_ingr_tekort').replace('{namen}', ingr.tekort.join(', '))}</span>
                </p>
              )}
              {ingr.onbekend.length > 0 && (
                <p className="text-sm text-gray-600 break-words">{t('nb_ingr_onbekend').replace('{namen}', ingr.onbekend.join(', '))}</p>
              )}
            </div>
          )}
        </Blok>
      )}

      {p.recept && vb && (
        <section className={`rounded-xl border px-3.5 py-3 ${vb.aandacht ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200'}`}>
          <h4 className="text-sm font-semibold text-gray-800 mb-1">{t('nb_vooruitblik')}</h4>
          <p className={`text-sm break-words ${KLEUR_TEKST[vb.alcohol.kleur]}`}>{vooruitTekst(vb.alcohol, vbProduct, vb.versie, taal)}</p>
          <p className={`text-sm break-words mt-0.5 ${KLEUR_TEKST[vb.allergenen.kleur]}`}>{vooruitTekst(vb.allergenen, vbProduct, vb.versie, taal)}</p>
          {vb.zonderEtiket && (
            <p className="text-xs text-gray-500 mt-1">{vb.zonderEtiket === 'nieuw' ? t('nb_etiket_nieuw_product') : t('nb_etiket_geen_product')}</p>
          )}
          {opzoeken && opTeZoeken.length > 0 && (
            <button type="button" onClick={() => opzoeken.open(opTeZoeken)}
              className="mt-1 mr-4 text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {t('allergenen_opzoeken')} <span aria-hidden="true">›</span>
            </button>
          )}
          {vb.bijwerken && p.vooruitProduct && p.onEtiketBijwerken && (
            <button type="button" onClick={() => p.onEtiketBijwerken?.(Number(p.vooruitProduct.id))}
              className="mt-1 text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {t('etiket_actie_bijwerken')} <span aria-hidden="true">›</span>
            </button>
          )}
        </section>
      )}
    </div>
  )
}

export default NieuweBatchPlan
