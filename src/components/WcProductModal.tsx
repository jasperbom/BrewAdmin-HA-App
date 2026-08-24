import React from 'react'
import { t } from '../i18n'
import { wcGet, wcPut, wcPost } from '../utils/api'
import { wcFoutMelding } from '../utils/wcFout'
import Modal from './ui/Modal'
import Btn from './ui/Btn'
import {
  WcVelden, WcCategorie, WcAfbeelding, WcMetaRegel,
  bouwWcPayload, leesWcProduct, wcVerschillen, wcRegulierePrijsExcl,
  ordenCategorieen, WC_VELD_LABEL,
  WC_STATUSSEN, WC_ZICHTBAARHEDEN, WC_BACKORDERS, WC_BTW_STATUSSEN,
} from '../utils/wcProduct'
import { CrafteryVeld, CRAFTERY_GROEPEN, vulAanMetVoorstel } from '../utils/craftery'

// De volledige WooCommerce-productkaart van één artikel, bewerkbaar vanuit de
// app. Alles wat je normaal in WordPress bij een product invult staat hier —
// zodat je het niet twee keer hoeft te doen.
//
// De modal doet drie dingen, bewust gescheiden:
//   • **Ophalen**  — de winkel is leidend: vul de velden met wat er nu staat.
//   • **Opslaan**  — alleen lokaal; er gaat niets naar de winkel.
//   • **Naar WooCommerce** — push de velden (en de voorraad) naar de winkel,
//     of maak het product aan als de SKU daar nog niet bestaat.
//
// Wat je hier leeg laat blijft in de webshop staan zoals het is (zie
// utils/wcProduct.ts) — een push kan dus nooit per ongeluk teksten wissen.

export interface WcProductModalProps {
  /** SKU van het artikel; zonder SKU kan er niets gekoppeld worden. */
  sku: string
  /** Kop van de modal (bijv. "Tripel Phase — 33cl fles"). */
  titel: string
  velden?: WcVelden | null
  naamFallback: string
  omschrijvingFallback?: string
  /** Normale verkoopprijs excl. BTW uit het artikel zelf. */
  prijsExcl?: number | string | null
  btwPct?: number | string | null
  /** Voorraad die bij een push meegaat (null = voorraad niet aanraken). */
  voorraad?: number | null
  prijzenInclBtw?: boolean
  onOpslaan: (velden: WcVelden) => void
  onClose: () => void
  onLog?: (type: 'push' | 'pull' | 'fout' | 'debug', msg: string, details?: string) => void
  /**
   * Eigen productvelden van het webshopthema (`meta_data`). Leeg/weggelaten =
   * geen themategevel: de modal toont het tabblad dan niet en raakt de meta van
   * de winkel niet aan.
   */
  themaVelden?: CrafteryVeld[]
  /** Waarden die de app zelf al kent, om lege themavelden mee te vullen. */
  themaVoorstel?: Record<string, string>
}

type Tab = 'algemeen' | 'teksten' | 'prijs' | 'verzending' | 'indeling' | 'afbeeldingen' | 'thema'

const TABS: {v: Tab, l: string}[] = [
  {v: 'algemeen',     l: 'wc_tab_algemeen'},
  {v: 'teksten',      l: 'wc_tab_teksten'},
  {v: 'prijs',        l: 'wc_tab_prijs'},
  {v: 'verzending',   l: 'wc_tab_verzending'},
  {v: 'indeling',     l: 'wc_tab_indeling'},
  {v: 'afbeeldingen', l: 'wc_tab_afbeeldingen'},
  {v: 'thema',        l: 'wc_tab_thema'},
]

const inputCls = 'w-full border border-gray-200 rounded px-2 py-1.5 text-xs t-input'
const labelCls = 'text-[11px] text-gray-500'

const Veld: React.FC<{label: string, tip?: string, breed?: boolean, children: React.ReactNode}> =
  ({label, tip, breed, children}) => (
    <div className={breed ? 'sm:col-span-2' : ''}>
      <label className={labelCls} title={tip}>{label}</label>
      {children}
    </div>
  )

/** Eigen label/waarde-regels (spec sheet of infokaarten van het thema). */
const ThemaRegels: React.FC<{waarde: WcMetaRegel[], onChange: (r: WcMetaRegel[]) => void}> = ({waarde, onChange}) => {
  const rijen = [...waarde, {label: '', value: ''}]
  const wijzig = (i: number, patch: Partial<WcMetaRegel>) => {
    const nieuw = rijen.map((r, j) => j === i ? {...r, ...patch} : r)
    // Een regel zonder label of waarde slaat het thema niet op — hier ook niet.
    onChange(nieuw.filter(r => r.label.trim() || r.value.trim()))
  }
  return (
    <div className="space-y-1">
      {rijen.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input type="text" className={`${inputCls} w-1/3`} placeholder={t('cf_ph_regel_label')}
            value={r.label} onChange={e => wijzig(i, {label: e.target.value})} />
          <input type="text" className={inputCls} placeholder={t('cf_ph_regel_waarde')}
            value={r.value} onChange={e => wijzig(i, {value: e.target.value})} />
        </div>
      ))}
    </div>
  )
}

const WcProductModal: React.FC<WcProductModalProps> = ({
  sku, titel, velden, naamFallback, omschrijvingFallback, prijsExcl, btwPct,
  voorraad = null, prijzenInclBtw = true, onOpslaan, onClose, onLog,
  themaVelden = [], themaVoorstel = {},
}) => {
  const {useState, useEffect, useMemo} = React
  const [v, setV] = useState<WcVelden>({...(velden || {})})
  const [wcProduct, setWcProduct] = useState<any>(null)
  const [cats, setCats] = useState<WcCategorie[]>([])
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [msg, setMsg] = useState<{soort: 'ok' | 'fout' | 'info', tekst: string} | null>(null)
  const [tab, setTab] = useState<Tab>('algemeen')
  const [nieuweAfb, setNieuweAfb] = useState('')
  const [nieuweCat, setNieuweCat] = useState('')

  const zet = (patch: Partial<WcVelden>) => setV(f => ({...f, ...patch}))
  const metaSleutels = themaVelden.map(f => f.sleutel)
  const zetMeta = (sleutel: string, waarde: any) =>
    setV(f => ({...f, meta: {...(f.meta || {}), [sleutel]: waarde}}))
  const metaWaarde = (sleutel: string): any => (v.meta || {})[sleutel] ?? ''

  const payload = useMemo(() => bouwWcPayload({
    velden: v, sku, naamFallback, omschrijvingFallback,
    prijsExcl, btwPct, voorraad, prijzenInclBtw,
  }), [v, sku, naamFallback, omschrijvingFallback, prijsExcl, btwPct, voorraad, prijzenInclBtw])

  const verschillen = useMemo(
    () => (wcProduct ? wcVerschillen(payload, wcProduct) : []),
    [payload, wcProduct])

  const laadWinkel = async (stil = false) => {
    setLaden(true)
    if (!stil) setMsg(null)
    try {
      const [prods, catLijst] = await Promise.all([
        sku ? wcGet(`products?sku=${encodeURIComponent(sku)}&per_page=1`) : Promise.resolve([]),
        // hide_empty=false: een verse categorie zonder producten moet ook
        // kiesbaar zijn, anders kun je een nieuw product nergens in zetten.
        wcGet('products/categories?per_page=100&orderby=name&order=asc&hide_empty=false').catch(() => []),
      ])
      const gevonden = Array.isArray(prods) ? prods[0] : null
      setWcProduct(gevonden || null)
      setCats((catLijst || []).map((c: any) => ({id: Number(c.id), naam: String(c.name || ''), parent: Number(c.parent || 0)})))
      if (gevonden && !v.wc_id) zet({wc_id: Number(gevonden.id), permalink: gevonden.permalink || ''})
    } catch (e: any) {
      setMsg({soort: 'fout', tekst: wcFoutMelding(e, t)})
      onLog?.('fout', `${titel} — ${wcFoutMelding(e, t)}`, e?.message)
    }
    setLaden(false)
  }

  useEffect(() => { laadWinkel() }, [sku])

  // ── Ophalen: de winkel is leidend ────────────────────────────────────────
  const pull = () => {
    if (!wcProduct) return
    const uit = leesWcProduct(wcProduct, {btwPct, prijzenInclBtw, metaSleutels})
    setV({...uit, gepulld: new Date().toISOString(), gesynct: v.gesynct})
    setMsg({soort: 'info', tekst: t('wc_msg_opgehaald')})
    onLog?.('pull', `↓ ${titel} — ${t('wc_msg_opgehaald')}`)
  }

  // ── Push / aanmaken ──────────────────────────────────────────────────────
  const schrijf = async (nieuw: boolean) => {
    if (!sku) { setMsg({soort: 'fout', tekst: t('wc_msg_geen_sku')}); return }
    setBezig(true); setMsg(null)
    try {
      const body = bouwWcPayload({
        velden: v, sku, naamFallback, omschrijvingFallback,
        prijsExcl, btwPct, voorraad, prijzenInclBtw, nieuw,
      })
      const res = nieuw
        ? await wcPost('products', body)
        : await wcPut(`products/${v.wc_id || wcProduct?.id}`, body)
      setWcProduct(res)
      const bijgewerkt: WcVelden = {
        ...v,
        wc_id: Number(res?.id) || v.wc_id,
        permalink: res?.permalink || v.permalink,
        gesynct: new Date().toISOString(),
      }
      setV(bijgewerkt)
      onOpslaan(bijgewerkt)
      const tekst = nieuw ? t('wc_msg_aangemaakt') : t('wc_msg_gepusht')
      setMsg({soort: 'ok', tekst})
      onLog?.('push', `↑ ${titel} — ${tekst}`, Object.keys(body).join(', '))
    } catch (e: any) {
      const melding = wcFoutMelding(e, t)
      setMsg({soort: 'fout', tekst: melding})
      onLog?.('fout', `${titel} — ${melding}`, e?.message)
    }
    setBezig(false)
  }

  const maakCategorie = async () => {
    const naam = nieuweCat.trim()
    if (!naam) return
    setBezig(true)
    try {
      const res = await wcPost('products/categories', {name: naam})
      const nieuw: WcCategorie = {id: Number(res.id), naam: String(res.name || naam), parent: Number(res.parent || 0)}
      setCats(c => [...c, nieuw])
      zet({categorie_ids: [...(v.categorie_ids || []), nieuw.id]})
      setNieuweCat('')
    } catch (e: any) {
      setMsg({soort: 'fout', tekst: wcFoutMelding(e, t)})
    }
    setBezig(false)
  }

  const zetAfbeeldingen = (lijst: WcAfbeelding[]) => zet({afbeeldingen: lijst})
  const verplaatsAfb = (i: number, richting: -1 | 1) => {
    const lijst = [...(v.afbeeldingen || [])]
    const j = i + richting
    if (j < 0 || j >= lijst.length) return
    ;[lijst[i], lijst[j]] = [lijst[j], lijst[i]]
    zetAfbeeldingen(lijst)
  }

  const gekoppeld = !!wcProduct
  const wcPrijs = wcRegulierePrijsExcl(wcProduct, btwPct, prijzenInclBtw)

  const kies = (waarde: string | undefined, opts: readonly string[], sleutelPrefix: string,
                onChange: (val: any) => void, legeLabel = 'wc_opt_onveranderd') => (
    <select value={waarde || ''} onChange={e => onChange(e.target.value || undefined)}
      className={`${inputCls} bg-white`}>
      <option value="">{t(legeLabel)}</option>
      {opts.map(o => <option key={o} value={o}>{t(`${sleutelPrefix}_${o}`)}</option>)}
    </select>
  )

  return (
    <Modal title={`${t('wc_modal_titel')} — ${titel}`} onClose={onClose} ultrawide>
      {/* Koppelstatus */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-600">{sku || t('wc_msg_geen_sku')}</span>
        {laden && <span className="text-gray-400">{t('lbl_bezig')}…</span>}
        {!laden && gekoppeld && (
          <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
            {t('wc_koppel_gekoppeld').replace('{id}', String(wcProduct.id))}
          </span>
        )}
        {!laden && !gekoppeld && (
          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{t('wc_koppel_niet_gevonden')}</span>
        )}
        {wcProduct?.permalink && (
          <a href={wcProduct.permalink} target="_blank" rel="noreferrer"
            className="underline" style={{color: 'var(--t-accent)'}}>{t('wc_btn_open_winkel')}</a>
        )}
        {v.gesynct && <span className="text-gray-400">{t('wc_lbl_laatste_push')}: {new Date(v.gesynct).toLocaleString()}</span>}
      </div>

      {msg && (
        <div className={`mb-3 text-xs px-3 py-2 rounded ${
          msg.soort === 'ok' ? 'bg-green-50 text-green-700' :
          msg.soort === 'fout' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          {msg.tekst}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-3">
        {TABS.filter(tb => tb.v !== 'thema' || themaVelden.length > 0).map(tb => (
          <button key={tb.v} onClick={() => setTab(tb.v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t ${tab === tb.v ? 't-tab' : 'text-gray-500 hover:bg-gray-50'}`}>
            {t(tb.l)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tab === 'algemeen' && (<>
          <Veld label={t('wc_veld_naam')} tip={t('wc_tip_naam')}>
            <input type="text" className={inputCls} placeholder={naamFallback}
              value={v.naam ?? ''} onChange={e => zet({naam: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_slug')} tip={t('wc_tip_slug')}>
            <input type="text" className={inputCls} value={v.slug ?? ''} onChange={e => zet({slug: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_status')}>
            {kies(v.status, WC_STATUSSEN, 'wc_pstatus', val => zet({status: val}))}
          </Veld>
          <Veld label={t('wc_veld_zichtbaarheid')}>
            {kies(v.zichtbaarheid, WC_ZICHTBAARHEDEN, 'wc_zicht', val => zet({zichtbaarheid: val}))}
          </Veld>
          <Veld label={t('wc_veld_menu_volgorde')} tip={t('wc_tip_menu_volgorde')}>
            <input type="number" className={inputCls} value={v.menu_volgorde ?? ''} onChange={e => zet({menu_volgorde: e.target.value})} />
          </Veld>
          <div className="flex flex-col justify-end gap-1.5 pb-1">
            <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
              <input type="checkbox" className="t-checkbox" checked={!!v.uitgelicht}
                onChange={e => zet({uitgelicht: e.target.checked})} />
              <span>{t('wc_veld_uitgelicht')}</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none"
              title={t('wc_tip_apart_verkopen')}>
              <input type="checkbox" className="t-checkbox" checked={!!v.apart_verkopen}
                onChange={e => zet({apart_verkopen: e.target.checked})} />
              <span>{t('wc_veld_apart_verkopen')}</span>
            </label>
          </div>
        </>)}

        {tab === 'teksten' && (<>
          <Veld label={t('wc_veld_korte_omschrijving')} tip={t('wc_tip_korte_omschrijving')} breed>
            <textarea rows={3} className={inputCls} value={v.korte_omschrijving ?? ''}
              onChange={e => zet({korte_omschrijving: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_omschrijving')} tip={t('wc_tip_omschrijving')} breed>
            <textarea rows={8} className={`${inputCls} font-mono`} placeholder={omschrijvingFallback}
              value={v.omschrijving ?? ''} onChange={e => zet({omschrijving: e.target.value})} />
          </Veld>
          <p className="sm:col-span-2 text-[11px] text-gray-400">{t('wc_hint_html')}</p>
        </>)}

        {tab === 'prijs' && (<>
          <Veld label={t('wc_veld_prijs')} tip={t('wc_tip_prijs')}>
            <input type="text" className={`${inputCls} bg-gray-50`} readOnly
              value={payload.regular_price ?? t('lbl_onbekend')} />
          </Veld>
          <Veld label={t('wc_veld_actieprijs')} tip={t('wc_tip_actieprijs')}>
            <input type="number" step="0.01" className={inputCls} value={v.actieprijs ?? ''}
              onChange={e => zet({actieprijs: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_actie_van')}>
            <input type="date" className={inputCls} value={v.actie_van ?? ''} onChange={e => zet({actie_van: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_actie_tot')}>
            <input type="date" className={inputCls} value={v.actie_tot ?? ''} onChange={e => zet({actie_tot: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_btw_status')}>
            {kies(v.btw_status, WC_BTW_STATUSSEN, 'wc_btwst', val => zet({btw_status: val}))}
          </Veld>
          <Veld label={t('wc_veld_btw_klasse')} tip={t('wc_tip_btw_klasse')}>
            <input type="text" className={inputCls} value={v.btw_klasse ?? ''} onChange={e => zet({btw_klasse: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_voorraad')} tip={t('wc_tip_voorraad')}>
            <input type="text" className={`${inputCls} bg-gray-50`} readOnly
              value={voorraad === null || voorraad === undefined ? t('wc_lbl_voorraad_niet_pushen') : String(payload.stock_quantity ?? '')} />
          </Veld>
          <Veld label={t('wc_veld_backorders')}>
            {kies(v.backorders, WC_BACKORDERS, 'wc_backorder', val => zet({backorders: val}))}
          </Veld>
          <Veld label={t('wc_veld_lage_voorraad')} tip={t('wc_tip_lage_voorraad')}>
            <input type="number" className={inputCls} value={v.lage_voorraad ?? ''} onChange={e => zet({lage_voorraad: e.target.value})} />
          </Veld>
          <p className="sm:col-span-2 text-[11px] text-gray-400">
            {(prijzenInclBtw ? t('wc_hint_prijs_incl') : t('wc_hint_prijs_excl'))}
            {wcPrijs !== null && ` · ${t('wc_lbl_prijs_in_winkel')}: ${wcPrijs.toFixed(2)}`}
          </p>
        </>)}

        {tab === 'verzending' && (<>
          <Veld label={t('wc_veld_gewicht')}>
            <input type="number" step="0.001" className={inputCls} value={v.gewicht ?? ''} onChange={e => zet({gewicht: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_verzendklasse')} tip={t('wc_tip_verzendklasse')}>
            <input type="text" className={inputCls} value={v.verzendklasse ?? ''} onChange={e => zet({verzendklasse: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_lengte')}>
            <input type="number" step="0.1" className={inputCls} value={v.lengte ?? ''} onChange={e => zet({lengte: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_breedte')}>
            <input type="number" step="0.1" className={inputCls} value={v.breedte ?? ''} onChange={e => zet({breedte: e.target.value})} />
          </Veld>
          <Veld label={t('wc_veld_hoogte')}>
            <input type="number" step="0.1" className={inputCls} value={v.hoogte ?? ''} onChange={e => zet({hoogte: e.target.value})} />
          </Veld>
          <p className="sm:col-span-2 text-[11px] text-gray-400">{t('wc_hint_afmetingen')}</p>
        </>)}

        {tab === 'indeling' && (<>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t('wc_veld_categorieen')}</label>
            <div className="mt-1 max-h-52 overflow-y-auto border border-gray-200 rounded p-2 space-y-0.5">
              {cats.length === 0 && <div className="text-[11px] text-gray-400">{t('wc_lbl_geen_categorieen')}</div>}
              {ordenCategorieen(cats).map(({cat, diepte}) => (
                <label key={cat.id} className="flex items-center gap-2 text-xs cursor-pointer select-none"
                  style={{paddingLeft: `${diepte * 14}px`}}>
                  <input type="checkbox" className="t-checkbox"
                    checked={(v.categorie_ids || []).includes(cat.id)}
                    onChange={e => zet({categorie_ids: e.target.checked
                      ? [...(v.categorie_ids || []), cat.id]
                      : (v.categorie_ids || []).filter(id => id !== cat.id)})} />
                  <span>{cat.naam}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input type="text" className={inputCls} placeholder={t('wc_ph_nieuwe_categorie')}
                value={nieuweCat} onChange={e => setNieuweCat(e.target.value)} />
              <Btn onClick={maakCategorie} s="sm" v="secondary" disabled={bezig || !nieuweCat.trim()}>
                {t('wc_btn_categorie_maken')}
              </Btn>
            </div>
          </div>
          <Veld label={t('wc_veld_tags')} tip={t('wc_tip_tags')} breed>
            <input type="text" className={inputCls} value={(v.tags || []).join(', ')}
              onChange={e => zet({tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} />
          </Veld>
        </>)}

        {tab === 'afbeeldingen' && (<>
          <div className="sm:col-span-2 space-y-2">
            {(v.afbeeldingen || []).length === 0 && (
              <div className="text-[11px] text-gray-400">{t('wc_lbl_geen_afbeeldingen')}</div>
            )}
            {(v.afbeeldingen || []).map((a, i) => (
              <div key={`${a.id || a.src}-${i}`} className="flex items-center gap-2 border border-gray-200 rounded p-2">
                {a.src
                  ? <img src={a.src} alt={a.alt || ''} className="w-12 h-12 object-cover rounded" />
                  : <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">#{a.id}</div>}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-gray-500 truncate">{a.naam || a.src || `#${a.id}`}</div>
                  <input type="text" className={inputCls} placeholder={t('wc_ph_alt')}
                    value={a.alt || ''} onChange={e => {
                      const lijst = [...(v.afbeeldingen || [])]
                      lijst[i] = {...lijst[i], alt: e.target.value}
                      zetAfbeeldingen(lijst)
                    }} />
                </div>
                <div className="flex flex-col gap-1">
                  <Btn onClick={() => verplaatsAfb(i, -1)} s="sm" v="ghost" title={t('wc_btn_omhoog')}>↑</Btn>
                  <Btn onClick={() => verplaatsAfb(i, 1)} s="sm" v="ghost" title={t('wc_btn_omlaag')}>↓</Btn>
                </div>
                <Btn onClick={() => zetAfbeeldingen((v.afbeeldingen || []).filter((_, j) => j !== i))} s="sm" v="danger">
                  {t('btn_delete')}
                </Btn>
              </div>
            ))}
            <div className="flex gap-2">
              <input type="url" className={inputCls} placeholder={t('wc_ph_afbeelding_url')}
                value={nieuweAfb} onChange={e => setNieuweAfb(e.target.value)} />
              <Btn s="sm" v="secondary" disabled={!nieuweAfb.trim()}
                onClick={() => { zetAfbeeldingen([...(v.afbeeldingen || []), {src: nieuweAfb.trim()}]); setNieuweAfb('') }}>
                {t('wc_btn_afbeelding_toevoegen')}
              </Btn>
            </div>
            <p className="text-[11px] text-gray-400">{t('wc_hint_afbeeldingen')}</p>
          </div>
        </>)}
        {tab === 'thema' && (<>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-gray-500 flex-1 min-w-[12rem]">{t('cf_uitleg')}</p>
            {Object.keys(themaVoorstel).length > 0 && (
              <Btn s="sm" v="secondary" title={t('cf_tip_overnemen')}
                onClick={() => { zet({meta: vulAanMetVoorstel(v.meta, themaVoorstel)}); setMsg({soort: 'info', tekst: t('cf_msg_overgenomen')}) }}>
                {t('cf_btn_overnemen')}
              </Btn>
            )}
          </div>
          {CRAFTERY_GROEPEN.filter(g => themaVelden.some(f => f.groep === g)).map(groep => (
            <div key={groep} className="sm:col-span-2">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-1 mb-1">{t(groep)}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {themaVelden.filter(f => f.groep === groep).map(f => {
                  const waarde = metaWaarde(f.sleutel)
                  if (f.soort === 'ja_nee') {
                    return (
                      <label key={f.sleutel} className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none pt-4"
                        title={f.tip ? t(f.tip) : undefined}>
                        {/* Het thema bewaart deze schakelaar als 'yes'/'no'. */}
                        <input type="checkbox" className="t-checkbox" checked={waarde === 'yes'}
                          onChange={e => zetMeta(f.sleutel, e.target.checked ? 'yes' : 'no')} />
                        <span>{t(f.label)}</span>
                      </label>
                    )
                  }
                  return (
                    <Veld key={f.sleutel} label={t(f.label)} tip={f.tip ? t(f.tip) : undefined}
                      breed={f.soort === 'lang' || f.soort === 'regels'}>
                      {f.soort === 'lang' ? (
                        <textarea rows={3} className={inputCls} placeholder={f.placeholder}
                          value={String(waarde)} onChange={e => zetMeta(f.sleutel, e.target.value)} />
                      ) : f.soort === 'keuze' ? (
                        <select value={String(waarde)} onChange={e => zetMeta(f.sleutel, e.target.value)}
                          className={`${inputCls} bg-white`}>
                          <option value="">{t('wc_opt_onveranderd')}</option>
                          {(f.opties || []).map(o => <option key={o.v} value={o.v}>{t(o.l)}</option>)}
                        </select>
                      ) : f.soort === 'schuif' ? (
                        <div className="flex items-center gap-2">
                          {/* accentkleur uit het thema — geen browserblauw */}
                          <input type="range" min={0} max={100} step={1} className="flex-1"
                            style={{accentColor: 'var(--t-accent)'}}
                            value={Number(waarde) || 0} onChange={e => zetMeta(f.sleutel, e.target.value)} />
                          <input type="number" min={0} max={100} className={`${inputCls} w-16`}
                            value={String(waarde)} onChange={e => zetMeta(f.sleutel, e.target.value)} />
                        </div>
                      ) : f.soort === 'regels' ? (
                        <ThemaRegels waarde={Array.isArray(waarde) ? waarde : []}
                          onChange={rijen => zetMeta(f.sleutel, rijen)} />
                      ) : (
                        <input type={f.soort === 'getal' ? 'number' : 'text'} className={inputCls}
                          placeholder={f.placeholder} value={String(waarde)}
                          onChange={e => zetMeta(f.sleutel, e.target.value)} />
                      )}
                    </Veld>
                  )
                })}
              </div>
            </div>
          ))}
        </>)}
      </div>

      {/* Verschillen met de winkel */}
      {gekoppeld && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {t('wc_lbl_verschillen')} ({verschillen.length})
          </div>
          {verschillen.length === 0
            ? <div className="text-xs text-green-700">{t('wc_msg_gelijk')}</div>
            : (
              <div className="max-h-40 overflow-y-auto text-xs">
                {verschillen.map(d => (
                  <div key={d.veld} className="flex flex-wrap gap-2 py-0.5 border-b border-gray-100 last:border-0">
                    <span className="w-40 text-gray-500">{
                      d.veld.startsWith('meta:')
                        ? t(themaVelden.find(f => f.sleutel === d.veld.slice(5))?.label || d.veld)
                        : t(WC_VELD_LABEL[d.veld] || d.veld)
                    }</span>
                    <span className="flex-1 min-w-[8rem] truncate" title={d.extern}>
                      <span className="text-gray-400">{t('wc_lbl_winkel')}: </span>{d.extern || '—'}
                    </span>
                    <span className="flex-1 min-w-[8rem] truncate font-medium" title={d.lokaal}>
                      <span className="text-gray-400">{t('wc_lbl_app')}: </span>{d.lokaal || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-200">
        <Btn onClick={() => { onOpslaan(v); onClose() }} disabled={bezig}>{t('btn_product_opslaan')}</Btn>
        {gekoppeld && (
          <button onClick={() => schrijf(false)} disabled={bezig || laden}
            className="wc-btn px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            {bezig ? `⏳ ${t('lbl_bezig')}` : t('wc_btn_push')}
          </button>
        )}
        {!gekoppeld && !laden && (
          <button onClick={() => schrijf(true)} disabled={bezig || !sku}
            className="wc-btn px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
            {bezig ? `⏳ ${t('lbl_bezig')}` : t('wc_btn_aanmaken')}
          </button>
        )}
        <Btn onClick={pull} v="secondary" disabled={!gekoppeld || bezig || laden}>{t('wc_btn_pull')}</Btn>
        <Btn onClick={() => laadWinkel()} v="ghost" disabled={bezig}>{t('wc_btn_verversen')}</Btn>
        <div className="flex-1" />
        <Btn onClick={onClose} v="secondary">{t('btn_product_annuleren')}</Btn>
      </div>
    </Modal>
  )
}

export default WcProductModal
