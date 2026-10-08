import React from 'react'
import { t, getLang } from '../../i18n'
import { fmtD } from '../../utils/format'
import { batchStatusLabel } from '../../utils/constants'
import BierKleur from '../ui/BierKleur'
import Btn from '../ui/Btn'
import Icon from '../ui/Icon'
import { ReceptChip } from './ReceptRij'
import { productEbc } from '../../utils/bierKleur'
import type { ReceptGebruik } from '../../utils/receptGebruik'
import {
  receptEtiketMelding, type ReceptBatchRegel, type ReceptVersieRegel, type ReceptEtiketMelding,
} from '../../utils/receptLijst'
import {
  receptEtiketWaarden, productEtiketWaarden, vergelijkEtiket, etiketStatus, allergeenNamen, allergeenSleutels, fmtAbv,
  sorteerAllergenen,
} from '../../utils/etiket'
import { voorraadPerProduct, type VerkoopCtx, type VoorraadVerpakking } from '../../utils/verkoopOverzicht'

// De verbindingsblokken in het detail van een recept: bij welk product het
// hoort (met etiket en voorraad), welke batches ermee gebrouwen zijn, wat het
// etiket volgens het recept verwacht, en de versies. Alles klikbaar naar het
// product, de batch of de versie. Op het bureau naast elkaar, smaller
// gestapeld.

const Kaart: React.FC<{ titel: string; children: React.ReactNode; cls?: string }> = ({ titel, children, cls = '' }) => (
  <section className={`rounded-xl border border-gray-200 bg-white p-4 min-w-0 ${cls}`}>
    <h4 className="text-sm font-semibold text-gray-800 mb-2">{titel}</h4>
    {children}
  </section>
)

const LinkKnop: React.FC<{ onClick: () => void; children: React.ReactNode; cls?: string }> = ({ onClick, children, cls = '' }) => (
  <button type="button" onClick={onClick}
    className={`text-left text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${cls}`}>
    {children}
  </button>
)

/** "voorraad 46 Fles 33cL · 1 Fust 20L · in de AGP 240 Fles 33cL" — per verpakking, nooit opgeteld. */
const voorraadTekst = (vv: VoorraadVerpakking[]): string => {
  const vrij = vv.filter(v => v.vrij > 0).map(v => `${v.vrij} ${v.naam}`)
  const agp = vv.filter(v => v.agp > 0).map(v => `${v.agp} ${v.naam}`)
  if (!vrij.length && !agp.length) return t('recept_voorraad_geen')
  if (!vrij.length) return t('recept_voorraad_alleen_agp').replace('{lijst}', agp.join(', '))
  const tekst = t('recept_voorraad_vrij').replace('{lijst}', vrij.join(' · '))
  return agp.length ? `${tekst} · ${t('recept_voorraad_agp').replace('{lijst}', agp.join(', '))}` : tekst
}

/** "etiket v3 · 6,2 % vol · Bevat: gerst" — wat het gedrukte etiket van het product vastlegt. */
const etiketTekst = (p: any): string => {
  const delen: string[] = []
  const versie = String(p?.etiket_versie ?? '').trim()
  if (versie) delen.push(t('recept_etiket_versie').replace('{versie}', versie))
  const abv = fmtAbv(p?.abv, getLang())
  if (abv) delen.push(abv)
  if (Array.isArray(p?.allergenen)) {
    const namen = allergeenNamen(p.allergenen, t)
    delen.push(namen.length ? t('recept_bevat').replace('{allergenen}', namen.join(', ')) : t('recept_etiket_geen_allergenen'))
  } else {
    delen.push(t('etiket_status_niet_vastgelegd'))
  }
  return delen.join(' · ')
}

const meldingTekst = (m: ReceptEtiketMelding, product: any): string =>
  t(m.sleutel)
    .replace('{product}', String(product?.naam ?? ''))
    .replace('{versie}', String(product?.etiket_versie ?? '').trim())
    .replace('{allergenen}', allergeenNamen(m.allergenen, t).join(', '))
    .replace('{ingredienten}', m.ingredienten.join(', '))

const MELDING_KLEUR: Record<ReceptEtiketMelding['kleur'], string> = {
  rood: 'text-red-700', oranje: 'text-orange-700', groen: 'text-green-700',
}

export interface ReceptVerbindingenProps {
  /** Het getoonde record (het hoofdrecept of een versie). */
  recept: any
  gebruik: ReceptGebruik<any>
  batchRegels: ReceptBatchRegel<any>[]
  versies: ReceptVersieRegel<any>[]
  recepten: any[]
  producten: any[]
  batches: any[]
  ingredienten: any[]
  lots: any[]
  verkoopCtx: VerkoopCtx
  onKoppel: () => void
  onOpenRecept: (id: string) => void
  onOpenBatch: (id: number) => void
  onOpenProduct: (id: number) => void
}

const ReceptVerbindingen: React.FC<ReceptVerbindingenProps> = (p) => {
  const { recept, gebruik } = p
  const [alleBatches, setAlleBatches] = React.useState(false)
  const producten = React.useMemo(
    () => gebruik.producten
      .map(ref => ({ ref, product: (p.producten || []).find((x: any) => Number(x?.id) === ref.productId) }))
      .filter(x => !!x.product),
    [gebruik.producten, p.producten])

  // Wat het etiket volgens het recept verwacht, en per product hoe het
  // gedrukte etiket zich daartoe verhoudt.
  const verwacht = React.useMemo(() => receptEtiketWaarden(recept, { ingredienten: p.ingredienten }), [recept, p.ingredienten])
  const meldingen = React.useMemo(() => producten.map(({ product }) => {
    const pw = productEtiketWaarden(product, { batches: p.batches, recepten: p.recepten, ingredienten: p.ingredienten, lots: p.lots })
    const v = vergelijkEtiket(verwacht, pw)
    const s = etiketStatus(v)
    return { product, melding: receptEtiketMelding(v, s, !!String(product?.etiket_versie ?? '').trim()), ontbreekt: v.allergenen.ontbreekt }
  }).filter(x => x.melding.sleutel !== 'recept_etiket_onvolledig' && x.melding.sleutel !== 'recept_etiket_onvolledig_geen'),
  [producten, verwacht, p.batches, p.recepten, p.ingredienten, p.lots])
  // Rood alleen wat de zin noemt: "mist tarwe" — gluten staat er (net als op
  // het etiket) niet los naast een graansoort.
  const ontbreekt = new Set(meldingen
    .filter(m => m.melding.kleur === 'rood')
    .flatMap(m => allergeenSleutels(m.ontbreekt).map(k => k.replace(/^etiket_allergeen_/, ''))))

  const taal = getLang()
  const getallen: string[] = []
  const abv = fmtAbv(verwacht.abv.waarde, taal)
  if (abv) getallen.push(abv)
  if (verwacht.ibu.waarde != null) getallen.push(t('recept_ibu').replace('{n}', String(Math.round(verwacht.ibu.waarde))))
  if (verwacht.ebc.waarde != null) getallen.push(t('recept_ebc').replace('{n}', String(Math.round(verwacht.ebc.waarde))))
  if (verwacht.energie.kcal != null && verwacht.energie.kj != null) {
    getallen.push(t('recept_energie').replace('{kcal}', String(verwacht.energie.kcal)).replace('{kj}', String(verwacht.energie.kj)))
  }
  const allergenen = sorteerAllergenen(verwacht.allergenen.lijst)
  const onvolledig = [...verwacht.allergenen.nietBeoordeeld, ...verwacht.allergenen.nietInCatalogus]

  const zichtbaar = alleBatches ? p.batchRegels : p.batchRegels.slice(0, 5)
  const enkelProduct = producten.length === 1 ? producten[0].ref.productId : null
  const productNaam = (id: number | null) => id == null ? '' : String((p.producten || []).find((x: any) => Number(x?.id) === id)?.naam ?? '')
  const versieLabel = (id: string) => {
    const v = (p.recepten || []).find((r: any) => String(r?.id) === id)
    return String(v?.versie ?? '').trim() || t('recipe_version_snapshot')
  }

  return (
    <>
      <div className="grid gap-3 min-[1300px]:grid-cols-3 mt-4">
        <Kaart titel={t('recept_blok_product')}>
          {producten.length ? (
            <div className="space-y-3">
              {producten.map(({ ref, product }) => (
                <div key={ref.productId} className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <BierKleur ebc={productEbc(product, p.recepten)} s="md" />
                    <span className="text-[15px] font-semibold text-gray-900 truncate">{product.naam || t('lbl_naamloos')}</span>
                    {ref.huidig && <ReceptChip soort="huidig">{t('recept_chip_huidig')}</ReceptChip>}
                    {ref.uitRoulatie && <ReceptChip soort="grijs">{t('recept_chip_uit_roulatie')}</ReceptChip>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 break-words">{etiketTekst(product)}</p>
                  <p className="text-xs text-gray-500 mt-0.5 break-words">{voorraadTekst(voorraadPerProduct(ref.productId, p.verkoopCtx))}</p>
                  <LinkKnop cls="mt-1" onClick={() => p.onOpenProduct(ref.productId)}>
                    {t('recept_naar_product').replace('{product}', product.naam || t('lbl_naamloos'))} <span aria-hidden="true">›</span>
                  </LinkKnop>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500">{t('recept_geen_product')}</p>
              {gebruik.gearchiveerdeProducten.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {t('recept_eerder_bij').replace('{producten}', gebruik.gearchiveerdeProducten.map(x => x.naam).join(', '))}
                </p>
              )}
              <div className="mt-2"><Btn v="secondary" s="sm" onClick={p.onKoppel}>{t('recept_actie_koppel')}</Btn></div>
            </div>
          )}
        </Kaart>

        <Kaart titel={t('recept_blok_gebrouwen')}>
          {p.batchRegels.length ? (
            <>
              <ul className="space-y-0.5">
                {zichtbaar.map(b => {
                  const kop = [b.batchNummer ? `#${b.batchNummer}` : (b.batch?.naam || t('lbl_naamloos')), b.datum ? fmtD(b.datum) : '', batchStatusLabel(b.status)]
                    .filter(Boolean).join(' · ')
                  const sub = [
                    b.lotcodes.join(', '),
                    b.productId != null && b.productId !== enkelProduct ? productNaam(b.productId) : '',
                    b.versieId ? t('recept_batch_versie').replace('{versie}', versieLabel(b.versieId)) : '',
                    b.opNaam ? t('recept_batch_op_naam') : '',
                  ].filter(Boolean).join(' · ')
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => p.onOpenBatch(b.id)}
                        className="w-full text-left rounded-lg px-2 -mx-2 py-1.5 min-h-tap md:min-h-0 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                        <span className="block text-sm font-medium t-accent-text">{kop} <span aria-hidden="true">›</span></span>
                        {sub && <span className="block text-xs text-gray-500 break-words">{sub}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {p.batchRegels.length > 5 && (
                <button type="button" onClick={() => setAlleBatches(a => !a)} aria-expanded={alleBatches}
                  className="mt-1 text-xs font-medium text-gray-600 min-h-tap md:min-h-[28px] hover:underline">
                  {alleBatches ? t('recept_minder_batches') : t('recept_alle_batches').replace('{n}', String(p.batchRegels.length))}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">{t('recept_nog_niet_gebrouwen')}</p>
          )}
        </Kaart>

        <Kaart titel={t('recept_blok_etiket')}>
          <p className="text-sm font-medium text-gray-900">{getallen.length ? getallen.join(' · ') : '—'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {allergenen.map(a => (
              <span key={a} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ontbreekt.has(a) ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700'}`}>
                {t(`etiket_allergeen_${a}`, a)}
              </span>
            ))}
            <span className="text-xs text-gray-500">{allergenen.length ? t('recept_uit_receptregels') : t('recept_geen_allergenen_regels')}</span>
          </div>
          {onvolledig.length > 0 && (
            <p className="text-xs text-orange-700 mt-2 break-words">{t('recept_allergenen_onvolledig').replace('{ingredienten}', onvolledig.join(', '))}</p>
          )}
          {meldingen.map(({ product, melding }) => (
            <p key={product.id} className={`flex items-start gap-1.5 text-sm mt-2 ${MELDING_KLEUR[melding.kleur]}`}>
              {melding.kleur !== 'groen' && <Icon n="alert" cls="mt-0.5 flex-shrink-0" />}
              <span className="min-w-0 break-words">{meldingTekst(melding, product)}</span>
            </p>
          ))}
        </Kaart>
      </div>

      {p.versies.length > 0 && (
        <Kaart titel={t('recept_blok_versies')} cls="mt-3">
          <div className="flex flex-wrap gap-2">
            {p.versies.map(v => {
              const open = String(recept?.id) === v.id
              return (
                <button key={v.id} type="button" onClick={() => p.onOpenRecept(v.id)} aria-current={open ? 'true' : undefined}
                  className={`text-left rounded-lg border px-3 py-1.5 min-h-tap md:min-h-0 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${open ? 't-panel font-semibold text-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {v.huidig ? t('recept_versie_huidig') : (v.versie || t('recipe_version_snapshot'))}
                  {v.datum && <span className="font-normal text-gray-500"> · {fmtD(v.datum)}</span>}
                  <span className="font-normal text-gray-500"> · {v.aantalBatches > 0 ? t('recept_reden_aantal').replace('{n}', String(v.aantalBatches)) : t('recept_versie_niet_gebrouwen')}</span>
                </button>
              )
            })}
          </div>
        </Kaart>
      )}
    </>
  )
}

export default ReceptVerbindingen
