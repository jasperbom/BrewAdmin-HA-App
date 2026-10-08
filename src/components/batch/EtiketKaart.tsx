import React from 'react'
import { t, getLang } from '../../i18n'
import { etiketKaartModel } from '../../utils/etiketKaart'
import type {
  EtiketKaartData, EtiketKaartModel, EtiketKaartModus, KaartChip, KaartOordeel, KaartProductBlok, KaartRegel,
  KaartTegel,
} from '../../utils/etiketKaart'
import type { EtiketKleur, WebsiteStandOordeel } from '../../utils/etiket'
import { useBreedte } from '../ui/useBreedte'
import Onderblad from '../ui/Onderblad'
import RowActions from '../ui/RowActions'
import type { RowActie } from '../ui/RowActions'
import Btn from '../ui/Btn'
import Icon from '../ui/Icon'
import { useAllergenenOpzoeken } from '../AllergenenOpzoeken'

// De kaart "Etiket & website" (opzet hoofdstuk 5): wat er op het etiket moet
// (alcohol, allergenen, lotcode en THT) en wat naar de website gaat
// (bitterheid, kleur, energie, ingrediënten), elk getal met zijn bron, naast
// wat het etiket (het product) nu vastlegt, met het oordeel.
//
// Witte kaart met een accentlijn links — nooit een gevulde kop: de themabalk
// is voor het onderwerp van de pagina. De inhoud komt uit
// utils/etiketKaart.ts (`etiketKaartModel`); hier wordt niets uitgerekend.
//
// Breed (bureau) een tabel Waarde · Deze batch · Nu vastgelegd · Oordeel;
// smal (telefoon, of een smalle kolom) het 2×2-cijferblok — de kaart kijkt
// naar zijn eigen breedte, niet naar het scherm.

export interface EtiketKaartProps {
  /** `batch`: deze batch tegen het etiket van zijn product(en). `product`:
   *  het etiket tegen de referentiebatch (de volgende of laatste batch).
   *  `recept`: "Etiket verwacht", alles uit het recept. */
  modus: EtiketKaartModus
  /** Stand `batch`. */
  batch?: any
  /** Stand `product` (en optioneel bij `recept`: het product om mee te vergelijken). */
  product?: any
  /** Stand `recept`. */
  recept?: any
  /** De administratie: recepten, batchregels, ingrediënten, lots, sessies,
   *  afvullingen, artikelen, verpakkingen, HACCP-instellingen, batches,
   *  producten, brouwerij, en de verwachte afvuldatum voor de THT. */
  data: EtiketKaartData
  /** Per product de webshopstand (`websiteOordeelVoorProduct`). */
  website?: Record<number, WebsiteStandOordeel | null | undefined> | null
  /** Gereed en terugkijken: geen knoppen die iets wijzigen. */
  alleenLezen?: boolean
  /** Opent "Etiket bijwerken" (F5). Zonder: geen knop. */
  onEtiketBijwerken?: (productId: number | null) => void
  /** Opent "Naar webshop" (F5). Zonder: geen knop. */
  onNaarWebshop?: (productId: number | null) => void
  /** Maakt het ontbrekende artikel voor een verpakking. Zonder: geen knop. */
  onArtikelMaken?: (productId: number, verpakkingId: number) => void
  /** "ABV handmatig (lab)" in het ⋯-menu. Zonder: niet in het menu. */
  onAbvLab?: () => void
  /** "Etiket bijwerken" ook als de status er niet om vraagt — dan in het
   *  ⋯-menu. Voor de productpagina, waar de kaart de ingang tot de dialoog is. */
  bijwerkenInMenu?: boolean
  /** Standaard volgt de weergave de kaartbreedte. */
  weergave?: 'auto' | 'tabel' | 'tegels'
  cls?: string
}

/** Onder deze kaartbreedte (px) de tegelweergave. De tabel heeft vier
 *  kolommen met tekst; bij ± 840 px (een bureau van 1024) leest hij nog goed,
 *  op een tablet staand (± 640 px) niet meer. */
export const ETIKET_KAART_TEGELS_ONDER = 720

const STIP: Record<EtiketKleur, string> = {
  rood: 'bg-red-500', oranje: 'bg-orange-500', groen: 'bg-green-500', grijs: 'bg-gray-400',
}
const OORDEEL_TEKST: Record<EtiketKleur, string> = {
  rood: 'text-red-700 font-medium', oranje: 'text-orange-700', groen: 'text-green-700', grijs: 'text-gray-600',
}
const CHIP_STATUS: Record<'rood' | 'oranje' | 'groen', string> = {
  rood: 'bg-red-50 text-red-700 ring-red-200',
  oranje: 'bg-orange-50 text-orange-700 ring-orange-200',
  groen: 'bg-green-50 text-green-700 ring-green-200',
}

const StatusChip: React.FC<{tekst: string, kleur: 'rood' | 'oranje' | 'groen'}> = ({tekst, kleur}) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${CHIP_STATUS[kleur]}`}>{tekst}</span>
)

const Chips: React.FC<{chips: KaartChip[]}> = ({chips}) => (
  <span className="inline-flex flex-wrap gap-1.5">
    {chips.map(c => (
      <span key={c.tekst} className={`px-2 py-0.5 rounded-full text-xs ${c.nadruk
        ? 'bg-red-50 text-red-700 font-semibold ring-1 ring-red-200' : 'bg-gray-100 text-gray-700'}`}>{c.tekst}</span>
    ))}
  </span>
)

const Oordeel: React.FC<{o: KaartOordeel}> = ({o}) => (
  <span className="flex items-start gap-2 min-w-0">
    <span aria-hidden="true" className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${STIP[o.kleur]}`} />
    <span className={`text-sm break-words min-w-0 ${OORDEEL_TEKST[o.kleur]}`}>{o.tekst}</span>
  </span>
)

const Keten: React.FC<{regels: string[]}> = ({regels}) => (
  <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
    {regels.map((r, i) => <li key={i} className="break-words">{r}</li>)}
  </ul>
)

// De kolommen van de tabel: label smal, de batch het breedst.
const KOLOMMEN = 'grid grid-cols-[9.5rem_minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)] gap-x-4'

const BevatRegel: React.FC<{bevat: {nu: string, moet: string}}> = ({bevat}) => (
  <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-800">
    <span>{t('etiket_bevat_nu')} <strong className="font-semibold">{bevat.nu}</strong></span>
    <span aria-hidden="true">→</span>
    <span>{t('etiket_bevat_moet')} <strong className="font-semibold">{bevat.moet}</strong></span>
  </div>
)

const Cel: React.FC<{waarde: string, bron: string, chips?: KaartChip[], ingeklapt?: boolean}> = ({waarde, bron, chips, ingeklapt}) => (
  <div className="min-w-0">
    {chips && chips.length > 0
      ? <Chips chips={chips} />
      : <div className={`text-sm font-medium text-gray-900 ${ingeklapt ? 'truncate' : 'break-words'}`}>{waarde || '—'}</div>}
    {bron && <div className="text-xs text-gray-500 mt-0.5 break-words">{bron}</div>}
  </div>
)

interface TabelProps {
  titel: React.ReactNode
  regels: KaartRegel[]
  kolomBatch: string
  bronnen: boolean
  open: Record<string, boolean>
  setOpen: (veld: string) => void
  artikelMaken?: (productId: number, verpakkingId: number) => void
  /** Ingrediënten zonder beoordeelde allergenen: de knop in de allergeenregel. */
  allergenenOpzoeken?: () => void
}

/** "Allergenen opzoeken ›" onder het oordeel van de allergeenregel. */
const OpzoekKnop: React.FC<{onClick: () => void}> = ({onClick}) => (
  <button type="button" onClick={onClick}
    className="block text-left text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
    {t('allergenen_opzoeken')} <span aria-hidden="true">›</span>
  </button>
)

const Tabel: React.FC<TabelProps> = ({titel, regels, kolomBatch, bronnen, open, setOpen, artikelMaken, allergenenOpzoeken}) => (
  <div className="border-t border-gray-100 first:border-t-0">
    <div className="px-4 pt-3 pb-1 text-sm font-semibold text-gray-800">{titel}</div>
    <div className={`${KOLOMMEN} px-4 py-1.5 text-xs text-gray-500 border-b border-gray-100`}>
      <span>{t('etiket_kolom_waarde')}</span>
      <span>{kolomBatch}</span>
      <span>{t('etiket_kolom_vastgelegd')}</span>
      <span>{t('etiket_kolom_oordeel')}</span>
    </div>
    {regels.map(r => {
      const ingeklapt = !!r.ingeklapt && !open[r.veld]
      return (
        <div key={r.veld} className="px-4 py-3 border-b border-gray-100 last:border-b-0">
          <div className={KOLOMMEN}>
            <div className="text-sm font-medium text-gray-800 min-w-0">
              {r.ingeklapt ? (
                <button type="button" onClick={() => setOpen(r.veld)} aria-expanded={!ingeklapt}
                  className="inline-flex items-center gap-1.5 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] rounded">
                  <span aria-hidden="true" className={`text-gray-400 text-[10px] transition-transform ${ingeklapt ? '' : 'rotate-90'}`}>▶</span>
                  {r.label}
                </button>
              ) : r.label}
            </div>
            {r.lots ? (
              <div className="min-w-0 space-y-1">
                {r.lots.map((l, i) => (
                  <div key={i} className="text-sm text-gray-900">
                    <div className="break-words">
                      <span className="font-medium">{l.lotcode}</span>
                      {l.toelichting && <span className="text-gray-600"> ({l.toelichting})</span>}
                      {l.verpakking && <span className="text-gray-600"> · {l.verpakking}</span>}
                    </div>
                    <div className="text-gray-700">{l.tht}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Cel waarde={ingeklapt ? r.batch.waarde : (r.volledig?.batch ?? r.batch.waarde)} bron={r.batch.bron}
                chips={r.batch.chips} ingeklapt={ingeklapt} />
            )}
            {r.etiket ? (
              <Cel waarde={ingeklapt || !r.volledig ? r.etiket.waarde : (r.volledig.etiket || r.etiket.waarde)}
                bron={r.etiket.bron} chips={r.etiket.chips} ingeklapt={ingeklapt} />
            ) : <div />}
            <div className="min-w-0 space-y-1.5">
              <Oordeel o={r.oordeel} />
              {allergenenOpzoeken && r.veld === 'allergenen' && <OpzoekKnop onClick={allergenenOpzoeken} />}
              {artikelMaken && r.lots?.filter(l => l.artikelMaken).map((l, i) => (
                <button key={i} type="button" onClick={() => artikelMaken(l.artikelMaken!.productId, l.artikelMaken!.verpakkingId)}
                  className="block text-sm font-medium text-orange-700 underline underline-offset-2 hover:text-orange-800">
                  {t('etiket_artikel_maken')}{l.verpakking ? ` · ${l.verpakking.split(' · ')[0]}` : ''}
                </button>
              ))}
            </div>
          </div>
          {r.bevat && (
            <div className={`${KOLOMMEN} mt-2`}>
              <div />
              <div className="col-span-3"><BevatRegel bevat={r.bevat} /></div>
            </div>
          )}
          {bronnen && r.keten.length > 0 && (
            <div className={`${KOLOMMEN} mt-1`}>
              <div />
              <div className="col-span-3"><Keten regels={r.keten} /></div>
            </div>
          )}
        </div>
      )
    })}
  </div>
)

const Tegels: React.FC<{blok: KaartProductBlok, onKies: (tg: KaartTegel) => void}> = ({blok, onKies}) => (
  <div className="grid grid-cols-2 gap-2">
    {blok.tegels.map(tg => (
      <button key={tg.veld} type="button" onClick={() => onKies(tg)}
        className="min-h-[92px] rounded-lg bg-gray-50 border border-gray-100 p-3 text-left min-w-0 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
        <span className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span>{tg.label}</span>
          <span aria-hidden="true" className={`w-2 h-2 rounded-full ${STIP[tg.kleur]}`} />
        </span>
        <span className="block text-[28px] leading-tight font-bold text-gray-900 mt-1 truncate">{tg.waarde}</span>
        <span className="block text-xs text-gray-500 mt-0.5 break-words">{tg.sub}</span>
      </button>
    ))}
  </div>
)

const TegelWeergave: React.FC<{
  blok: KaartProductBlok
  artikelMaken?: (productId: number, verpakkingId: number) => void
  allergenenOpzoeken?: () => void
}> = ({blok, artikelMaken, allergenenOpzoeken}) => {
  const [tegel, setTegel] = React.useState<KaartTegel | null>(null)
  const a = blok.allergenen
  const lotten = blok.verplicht.find(r => r.veld === 'lot')?.lots || []
  return (
    <div className="px-3 pb-3 space-y-3">
      <Tegels blok={blok} onKies={setTegel} />
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="text-sm font-semibold text-gray-800">{t('etiket_regel_allergenen')}</div>
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-sm">
          <span className="text-gray-500 pt-0.5">{t('etiket_tegel_batch')}</span>
          {a.batch.length ? <Chips chips={a.batch} /> : <span className="text-gray-600">—</span>}
          <span className="text-gray-500 pt-0.5">{a.etiketLabel}</span>
          {a.etiket.length ? <Chips chips={a.etiket} /> : <span className="text-gray-600">{a.etiketTekst || '—'}</span>}
        </div>
        <Oordeel o={a.oordeel} />
        {allergenenOpzoeken && <OpzoekKnop onClick={allergenenOpzoeken} />}
        {a.bevat && (
          <div className="text-sm text-gray-800 pl-4">
            {t('etiket_bevat_moet')} <strong className="font-semibold">{a.bevat.moet}</strong>
          </div>
        )}
      </div>
      <div className="border-t border-gray-100 pt-3 text-sm text-gray-700 space-y-1">
        <div className="break-words"><span className="font-semibold text-gray-800">{t('etiket_regel_lot')}</span> · {blok.lotRegel}</div>
        {artikelMaken && lotten.filter(l => l.artikelMaken).map((l, i) => (
          <button key={i} type="button" onClick={() => artikelMaken(l.artikelMaken!.productId, l.artikelMaken!.verpakkingId)}
            className="min-h-tap text-sm font-medium text-orange-700 underline underline-offset-2">
            {t('etiket_artikel_maken')}{l.verpakking ? ` · ${l.verpakking.split(' · ')[0]}` : ''}
          </button>
        ))}
      </div>
      {tegel && (
        <Onderblad titel={tegel.ketenTitel} onKlaar={() => setTegel(null)} laag zelfstandig>
          <ul className="space-y-2 text-sm text-gray-800">
            {tegel.keten.map((r, i) => <li key={i} className="break-words">{r}</li>)}
          </ul>
        </Onderblad>
      )}
    </div>
  )
}

/** Kopieert de etikettekst; lukt het klembord niet, dan staat de tekst in
 *  beeld om zelf te selecteren. */
const kopieer = async (tekst: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tekst)
      return true
    }
  } catch { /* hieronder: tekst in beeld */ }
  return false
}

const EtiketKaart: React.FC<EtiketKaartProps> = ({
  modus, batch, product, recept, data, website, alleenLezen = false,
  onEtiketBijwerken, onNaarWebshop, onArtikelMaken, onAbvLab, bijwerkenInMenu = false, weergave = 'auto', cls = '',
}) => {
  const taal = getLang()
  const opzoeken = useAllergenenOpzoeken()
  const model: EtiketKaartModel = React.useMemo(
    () => etiketKaartModel({modus, batch, product, recept, data, website, taal}, t),
    [modus, batch, product, recept, data, website, taal])
  const [ref, breedte] = useBreedte<HTMLElement>()
  const tegels = weergave === 'tegels' || (weergave === 'auto' && breedte !== null && breedte < ETIKET_KAART_TEGELS_ONDER)
  const [bronnen, setBronnen] = React.useState(false)
  const [open, setOpenState] = React.useState<Record<string, boolean>>({})
  const [melding, setMelding] = React.useState<{tekst: string, kopie?: string} | null>(null)
  React.useEffect(() => {
    if (!melding || melding.kopie) return
    const id = setTimeout(() => setMelding(null), 3000)
    return () => clearTimeout(id)
  }, [melding])

  const rand = {borderLeftColor: 'var(--t-accent-edge, var(--t-accent))'}
  const kaartCls = `bg-white rounded-xl shadow-card border-l-4 overflow-hidden ${cls}`

  if (model.leeg) {
    // Niets om tegen te toetsen, maar het etiket vastleggen kan altijd (de
    // productpagina): dan staat de knop hier.
    const leegBijwerken = bijwerkenInMenu && !alleenLezen && onEtiketBijwerken && modus === 'product' && product
    return (
      <section ref={ref} className={kaartCls} style={rand} aria-label={model.titel}>
        <div className="px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">{model.titel}</h3>
          <p className="text-sm text-gray-500 mt-1">{t('etiket_kaart_leeg')}</p>
          {leegBijwerken && (
            <div className="mt-2">
              <Btn v="secondary" s="sm" onClick={() => onEtiketBijwerken!(Number(product.id))}>{t('etiket_actie_bijwerken')}</Btn>
            </div>
          )}
        </div>
      </section>
    )
  }

  const meer = model.producten.length > 1
  const eerste = model.producten[0]
  const status = model.status
  const artikelMaken = !alleenLezen && onArtikelMaken ? onArtikelMaken : undefined
  // Ingrediënten zonder beoordeelde allergenen houden het oordeel op
  // "onvolledig": opzoeken kan hier meteen (de beoordeling zelf blijft op het
  // ingrediënt; het etiket leg je daarna vast met Etiket bijwerken).
  const opTeZoeken = model.waarden?.allergenen.nietBeoordeeldIds || []
  const allergenenOpzoeken = !alleenLezen && opzoeken && opTeZoeken.length
    ? () => opzoeken.open(opTeZoeken) : undefined
  // De ene primaire knop van de kaart volgt de zwaarste status.
  const primair = !alleenLezen && status?.actie === 'etiket_bijwerken' && onEtiketBijwerken
    ? {label: t('etiket_actie_bijwerken'), doe: () => onEtiketBijwerken(zwaarsteProduct(model))}
    : !alleenLezen && status?.actie === 'naar_webshop' && onNaarWebshop
      ? {label: t('etiket_actie_webshop'), doe: () => onNaarWebshop(zwaarsteProduct(model))}
      : null
  const kopie = model.producten.map(b => b.kopie).filter(Boolean).join('\n\n')
  const doeKopie = async () => {
    if (!kopie) return
    const gelukt = await kopieer(kopie)
    setMelding(gelukt ? {tekst: t('etiket_gekopieerd')} : {tekst: t('etiket_kopieer_mislukt'), kopie})
  }
  const bijwerkenExtra = bijwerkenInMenu && !alleenLezen && onEtiketBijwerken && status?.actie !== 'etiket_bijwerken'
  const menu: RowActie[] = [
    ...(bijwerkenExtra ? [{id: 'bijwerken', label: t('etiket_actie_bijwerken'),
      onClick: () => onEtiketBijwerken!(zwaarsteProduct(model) ?? eerste?.productId ?? null)}] : []),
    ...(tegels ? [] : [{id: 'bronnen', label: t(bronnen ? 'etiket_actie_bronnen_verberg' : 'etiket_actie_bronnen'),
      onClick: () => setBronnen(b => !b)}]),
    ...(tegels && kopie ? [{id: 'kopie', label: t('etiket_actie_kopieer'), onClick: doeKopie}] : []),
    ...(!alleenLezen && onAbvLab ? [{id: 'lab', label: t('etiket_actie_lab'), onClick: onAbvLab}] : []),
  ]
  const websiteChip = eerste?.website_stand
  const vergeleken = meer ? '' : eerste?.vergelekenMet || ''

  return (
    <section ref={ref} className={kaartCls} style={rand} aria-label={model.titel}>
      <header className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${tegels ? 'px-3 pt-3 pb-2' : 'px-4 py-3 border-b border-gray-100'}`}>
        <h3 className="text-base font-semibold text-gray-900">{model.titel}</h3>
        {status && <StatusChip tekst={status.tekst} kleur={status.kleur} />}
        {websiteChip && (websiteChip.achter
          ? <StatusChip tekst={websiteChip.tekst} kleur="oranje" />
          : <span className="text-xs text-gray-500">{websiteChip.tekst}</span>)}
        {(vergeleken || (tegels && menu.length > 0)) && (
          <span className="ml-auto flex items-center gap-2 min-w-0">
            {vergeleken && !tegels && <span className="text-xs text-gray-500 break-words">{vergeleken}</span>}
            {tegels && menu.length > 0 && <RowActions acties={menu} v="kaart" />}
          </span>
        )}
      </header>

      {model.producten.map(blok => (
        <div key={blok.productId ?? 'geen'} className={meer ? 'border-t border-gray-200' : ''}>
          {meer && (
            <div className={`flex flex-wrap items-center gap-2 ${tegels ? 'px-3 pt-3' : 'px-4 pt-3'}`}>
              <span className="text-sm font-semibold text-gray-900">{blok.naam || t('lbl_naamloos')}</span>
              <StatusChip tekst={blok.status.tekst} kleur={blok.status.kleur} />
              {blok.vergelekenMet && <span className="text-xs text-gray-500">{blok.vergelekenMet}</span>}
            </div>
          )}
          {tegels ? (
            <TegelWeergave blok={blok} artikelMaken={artikelMaken} allergenenOpzoeken={allergenenOpzoeken} />
          ) : (
            <>
              <Tabel titel={t('etiket_kaart_verplicht')} regels={blok.verplicht} kolomBatch={model.kolomBatch}
                bronnen={bronnen} open={open} setOpen={v => setOpenState(o => ({...o, [v]: !o[v]}))}
                artikelMaken={artikelMaken} allergenenOpzoeken={allergenenOpzoeken} />
              <Tabel titel={<>{t('etiket_kaart_website')} <span className="font-normal text-gray-600">{t('etiket_kaart_website_sub')}</span></>}
                regels={blok.website} kolomBatch={model.kolomBatch}
                bronnen={bronnen} open={open} setOpen={v => setOpenState(o => ({...o, [v]: !o[v]}))} />
            </>
          )}
        </div>
      ))}

      {(primair || (!tegels && (kopie || menu.length > 0)) || melding) && (
        <footer className={`flex flex-wrap items-center gap-2 ${tegels ? 'px-3 pb-3' : 'px-4 py-3 bg-gray-50 border-t border-gray-100'}`}>
          {primair && (tegels
            ? <button type="button" onClick={primair.doe}
                className="w-full min-h-tap rounded-lg border font-semibold text-sm t-back focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                {primair.label}
              </button>
            : <Btn onClick={primair.doe}>{primair.label}</Btn>)}
          {!tegels && kopie && (
            <Btn v="secondary" onClick={doeKopie}><Icon n="clipboard" /> {t('etiket_actie_kopieer')}</Btn>
          )}
          {!tegels && menu.length > 0 && <RowActions acties={menu} v="kaart" />}
          {melding && (
            <div role="status" className="w-full text-sm text-gray-700 space-y-1">
              <div>{melding.tekst}</div>
              {melding.kopie && (
                <textarea readOnly value={melding.kopie} rows={Math.min(10, melding.kopie.split('\n').length)}
                  onFocus={e => e.currentTarget.select()}
                  className="w-full border border-gray-200 rounded-lg p-2 text-sm text-gray-800 bg-white" />
              )}
            </div>
          )}
        </footer>
      )}
    </section>
  )
}

/** Het product achter de zwaarste status (voor de knop van de kaart). */
const zwaarsteProduct = (m: EtiketKaartModel): number | null => {
  const rang = {rood: 2, oranje: 1, groen: 0} as const
  const blok = m.producten.reduce<KaartProductBlok | null>((max, b) =>
    !max || rang[b.status.kleur] > rang[max.status.kleur] ? b : max, null)
  return blok?.productId ?? null
}

export default EtiketKaart
