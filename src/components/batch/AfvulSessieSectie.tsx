import React from 'react'
import { t, getLang } from '../../i18n'
import { newId, haGetState } from '../../utils/api'
import { fmtD, fmtSg, tod } from '../../utils/format'
import { carbVolumes, drukNaarBar } from '../../utils/calculations'
import { uploadBijlage, uploadFoutSleutel, type Bijlage } from '../../utils/bijlage'
import {
  naarJpeg, alsBestand, naamMetExtensie, ARCHIEF_MAX_PX, AfbeeldingFout, afbeeldingFoutSleutel,
} from '../../utils/afbeelding'
import { logAudit } from '../../utils/audit'
import {
  SLUIT_AANLEIDINGEN, ETIKET_AANLEIDINGEN, THT_KLASSE_LABEL_KEY, ALLERGENEN_LIJST,
} from '../../utils/constants'
import Btn from '../ui/Btn'
import BevestigKnop from '../ui/BevestigKnop'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'
import BlokkadeKaart, { blokkadeSamenvatting, blokkadeTekst } from '../haccp/BlokkadeKaart'
import AfwijkingModal from '../haccp/AfwijkingModal'
import { useEtiketBijwerken } from './EtiketBijwerken'
import {
  maakParaaf, haccpInst, risicoVoorBatch, omkeerproefVerplicht,
  kroonkurkVerplicht,
  beoordeelSluitcontrole, afvullingenSindsLaatsteGoedkeuring, magSessieAfsluiten,
  sluitcontroleHerinnering, allergenenUitBatch, allergenenVanProduct,
  vergelijkAllergenen, magEtiketterenDoorgaan, bouwAfwijking, capaUitAfwijking,
  ccp2Voor, sessieCcp2, beoordeelFlesinspectie, co2VanToepassing, beoordeelCo2, fmtCo2, fmtCo2Grens, tankSgMetingen,
  sessieQuarantaine, sessieEtiketteren, houdtestFlessenNodig, sessieHoudtestDagen,
} from '../../utils/haccp'
import { houdtestVoorBatch, teEtiketteren, naEtiketControle } from '../../utils/houdtest'
import { bouwKratkaart } from '../../utils/kratkaart'
import { printKratkaart } from '../KratkaartExport'
import HoudtestSectie from './HoudtestSectie'
import {
  nieuweLotcode, thtKlasseVoorBatch, thtHandmatigBlokkade,
  berekenTht, openSessiesVoorBatch, actieveSessie, magSessieStarten,
  verwachteControleMomenten, controleDekking, vorigeLots,
} from '../../utils/afvulsessie'
import { verpakkingVoorraad } from '../../utils/verpakkingVoorraad'
import { ccp3AbvRegel, etiketControleGetallen } from '../../utils/etiket'
import { afvulMeldingTekst } from '../../utils/afvulControle'
import type { AfvulControle } from '../../utils/afvulControle'
import { productVoorBatch } from '../../utils/productKeten'
import { productenVoorBatchKeuze } from '../../utils/batchKeten'
import { productSelOpties } from './ProductOpties'
import type { AfvulSessie, SluitControle, EtiketControle, HaccpBijlage, VerkoopVrijgave } from '../../types'

// De afvulsessie is het anker voor CCP 2 en CCP 3: één afvulmoment met een
// eigen lotcode (L2431-B1), zodat bij een sluitprobleem alleen die sessie
// teruggehaald hoeft te worden in plaats van de hele batch.
//
// Eén sessie dekt één verpakkingstype (de sluitcontrole hoort bij dat type),
// maar een tank gaat vaak in twee formaten tegelijk de deur uit. Er kunnen
// daarom meerdere sessies naast elkaar openstaan — één per verpakking — en de
// gebruiker kiest met de sessieknoppen in welke hij op dat moment afvult.
//
// Sessie en afvulregistratie zitten in één blok: het is één handeling aan de
// afvuller. De registratie (`registratie`) verschijnt daarom binnen de lopende
// sessie — die levert de lotcode, de verpakking en de THT — en de lijst met
// afvullingen (`lijst`) staat er los onder, ook zonder open sessie.

interface Props {
  batch: any
  bi: any[]
  ing: any[]
  /** De lots: een batchregel met een lot hoort bij het ingrediënt van dat lot
   *  (risico en allergenen), zodat CCP 3 hetzelfde ziet als de etiketkaart. */
  lots?: any[]
  /** De ABV van de batch zoals de etiketkaart hem toont (de vastgezette,
   *  anders de beste waarde) — voor de regel bij "Alcoholgehalte op het
   *  etiket klopt" en de bevroren getallen van CCP 3. */
  abvBatch?: number | null
  av: any[]
  setAv: (fn: any) => void
  producten: any[]
  /** Recepten en alle batches: de producten van het recept van de batch staan
   *  bovenaan de productkeuze (utils/batchKeten.ts → productenVoorBatchKeuze). */
  recepten?: any[]
  batches?: any[]
  verpakkingen: any[]
  vrijgaven: any[]
  sessies: AfvulSessie[]
  setSessies: (fn: any) => void
  sluitcontroles: SluitControle[]
  setSluitcontroles: (fn: any) => void
  etiketcontroles: EtiketControle[]
  setEtiketcontroles: (fn: any) => void
  capa: any[]
  setCapa: (fn: any) => void
  afwijkingen: any[]
  setAfwijkingen: (fn: any) => void
  haccpInstellingen: any
  whoami: {gebruiker?: string; rol?: string} | null
  auditLog: any[]
  setAuditLog: (fn: any) => void
  /** Sessie waarin op dit moment geregistreerd wordt; de pagina houdt de keuze
   *  bij omdat het afvulformulier (`registratie`) er ook op stuurt. */
  actieveSessieId?: number | null
  setActieveSessieId?: (id: number | null) => void
  /** Afvulregistratieformulier — alleen zinvol binnen een lopende sessie. */
  registratie?: React.ReactNode
  /** Toon de registratie óók zonder open sessie. Alleen voor legacy-batches:
   *  die zijn begonnen vóór het sessiesysteem en kennen de blokkade niet. */
  registratieZonderSessie?: boolean
  /** Lijst met geregistreerde afvullingen; altijd zichtbaar. */
  lijst?: React.ReactNode
  /** Schrijft één afvulling weg binnen de meegegeven sessie (voorraad, accijns-
   *  voorcalculatie, logregels). Gebruikt door het achteraf vastleggen, pas
   *  nadat `onAchterafControleren` akkoord gaf — zelf vraagt hij niets meer. */
  onAchterafAfvullen?: (velden: any, sessie: AfvulSessie) => boolean
  /** Alle controles van de afvulling (utils/afvulControle.ts: verpakkings-
   *  voorraad, tankvolume, ABV) zónder iets weg te schrijven. Het achteraf
   *  vastleggen schrijft sessie en CCP-registraties (append-only) pas als er
   *  geen fout is en de waarschuwingen in de knop bevestigd zijn: anders bleef
   *  er bij onvoldoende voorraad een spooksessie achter. */
  onAchterafControleren?: (velden: any) => AfvulControle
  /** Verse serverstand van de afvulsessies ophalen vóór er een lotcode wordt
   *  uitgegeven — een tweede apparaat met een oude stand kiest anders
   *  hetzelfde sessienummer. Geeft de verse lijst terug, of null. */
  refreshSessies?: () => Promise<any>
  /** Voor de voorraad per verpakking in het achteraf-formulier. */
  onderdelen?: any[]
  /** Hygiënetaken van de fase — als regel in dezelfde checklist. */
  taken?: React.ReactNode
  takenDone?: boolean
  takenDetail?: React.ReactNode
  /** Verlies-/restvolumeformulier — als laatste regel in dezelfde checklist. */
  verlies?: React.ReactNode
  verliesDone?: boolean
  verliesDetail?: React.ReactNode
  /** Home Assistant: de druksensor van de tank (CO2 bij het afvullen) en de
   *  live tanktemperaturen. */
  haInst?: any
  haTankTemps?: Record<string, number>
  /** De metingen: SG bij het afvullen en de tanktemperatuur als er geen
   *  sensor is. */
  gistMetingen?: any[]
  /** Houdtest en vrijgave voor verkoop (`haccp_verkoopvrijgaven`). */
  verkoopvrijgaven?: VerkoopVrijgave[]
  setVerkoopvrijgaven?: (fn: any) => void
}

// Wat de afvuldag naast CCP 2 en 3 vastlegt (1.13.51): het koolzuur (CCP 1,
// grens c), de SG bij het afvullen, de lots van fles en kroonkurk en de
// klapflessen. `null` = het voorstel van de app (sensor, laatste meting,
// vorige sessie); wat je zelf intypt gaat altijd voor, ook leeg.
interface ExtraInvoer {
  co2_druk: string | null
  co2_temp: string | null
  sg_afvullen: string | null
  flessenlot: string | null
  kroonkurkenlot: string | null
  klap_aantal: string
  klap_vernietigd: string
  klap_gereinigd: boolean
}
const leegExtra: ExtraInvoer = {
  co2_druk: null, co2_temp: null, sg_afvullen: null, flessenlot: null, kroonkurkenlot: null,
  klap_aantal: '', klap_vernietigd: '', klap_gereinigd: false,
}
const getal = (v: string | null | undefined): number => Number(String(v ?? '').trim().replace(',', '.'))

type RegelStatus = 'done' | 'open' | 'optioneel'

// Beginstand van het achteraf-formulier. De controlevinkjes staan bewust úít:
// aanvinken is de verklaring dat de controle gedaan is, dus dat moet een
// handeling blijven.
const leegNa = {
  product_id: '' as string | number,
  verpakking_id: '' as string | number,
  hoeveelheid: '',
  datum: '',
  van: '',
  tot: '',
  reiniging_bevestigd: false,
  visueel_ok: false,
  omkeerproef_ok: false,
  flesmond_ok: false,
  draaitest_ok: false,
  lotcode_ok: false,
  tht_ok: false,
  alcohol_ok: false,
  opmerking: '',
  // Tijdstippen van de controles tussen start en eind. Leeg laten mag; het
  // formulier meldt dan hoeveel er volgens het halfuurritme ontbreken. Zelf
  // aanvullen zou controles verzinnen die niemand heeft gedaan.
  tussen: [] as string[],
  // CCP 2 als inspectie van de lege flessen.
  flessen_bekeken: false,
  afgekeurd: '',
  etiket_foto: null as Bijlage | null,
  houdtest_flessen: false,
  ...leegExtra,
}

// Eén regel van de afvulchecklist. De hele fase is één lijst: hygiëne, sessie,
// de twee CCP's, het afvullen zelf en het restvolume staan als gelijkwaardige
// regels onder elkaar. Wat je nodig hebt klap je open; de rest is één regel.
// Zelfde vormtaal als FlowStap op de pagina eromheen.
const Regel: React.FC<{
  titel: React.ReactNode
  status: RegelStatus
  detail?: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}> = ({titel, status, detail, open, onToggle, children}) => (
  <div>
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
        status === 'done' ? 'bg-green-100 text-green-700 ring-1 ring-green-200'
          : status === 'optioneel' ? 'bg-gray-100 text-gray-400'
          : 'bg-orange-100 text-orange-600 ring-1 ring-orange-200'}`}>
        {status === 'done' ? '✓' : status === 'optioneel' ? '·' : '○'}
      </span>
      <span className="text-sm font-semibold text-gray-700 flex-1 min-w-0">{titel}</span>
      {/* Hooguit de helft van de regel: een lange toelichting ("Sluitcontrole
          is aan de beurt …") loopt door op een tweede regel in plaats van over
          de titel heen te schuiven op een telefoon. */}
      {detail != null && detail !== '' && (
        <span className="text-xs text-gray-400 text-right max-w-[50%] min-w-0 break-words">{detail}</span>
      )}
      <span className={`text-gray-300 text-xs flex-shrink-0 transition-transform ${
        open ? 'rotate-90' : ''}`}>▶</span>
    </button>
    {open && <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">{children}</div>}
  </div>
)

const AfvulSessieSectie: React.FC<Props> = (p) => {
  const inst = haccpInst(p.haccpInstellingen)
  const openSessies = openSessiesVoorBatch(p.sessies || [], p.batch?.id)
  const sessie = actieveSessie(p.sessies || [], p.batch?.id, p.actieveSessieId)
  const eigenSessies = (p.sessies || []).filter(s => s.batch_id === p.batch?.id)
  // Quarantaine en etiketteren: wat een nieuwe sessie bevriest, en of die nog
  // houdtestflessen moet apart zetten (één sessie per batch is genoeg).
  const quarantaine = sessieQuarantaine(inst)
  const houdtestFlessenNieuw = (quarantaine.houdtest_dagen || 0) > 0
    && !eigenSessies.some(s => s.status !== 'afgebroken' && s.houdtest_flessen === true)
  const houdtest = houdtestVoorBatch(p.batch?.id, p.sessies, p.verkoopvrijgaven)
  // Startformulier voor een extra verpakking naast de lopende sessie(s).
  const [startOpen, setStartOpen] = React.useState(false)
  // Achteraf vastleggen is de normale gang van zaken — tijdens het afvullen
  // heb je je handen vol. Live meelopen kan, maar is de tweede keuze.
  const [modus, setModus] = React.useState<'achteraf' | 'live'>('achteraf')
  // Het product van de batch (`product_id`; bij een oude batch zonder
  // koppeling het product van zijn afvullingen). CCP 3 en het achteraf-
  // formulier beginnen daar: het product kies je niet nog eens.
  const batchProduct = productVoorBatch(p.batch, {afvullingen: p.av, producten: p.producten}).productId
  const [na, setNa] = React.useState({...leegNa, datum: tod(), product_id: batchProduct ?? ''})
  const [nu, setNu] = React.useState(() => new Date())
  const [afwijking, setAfwijking] = React.useState<{blok: any; titel: string; bron: any;
    actie?: 'achteraf' | 'start'; doel?: AfvulSessie | null} | null>(null)
  // Eén regel tegelijk open. Zonder eigen keuze staat de regel open die aan de
  // beurt is (zie `autoRegel` hieronder); '' betekent: alles dicht.
  const [openRegel, setOpenRegel] = React.useState<string | null>(null)
  // Er wordt een sessie aangemaakt (de verse stand wordt opgehaald): een
  // tweede klik zou anders een tweede sessie beginnen.
  const [bezig, setBezig] = React.useState(false)

  // Sessienummer en lotcode tegen de verse serverstand, zodat twee apparaten
  // niet allebei B1 uitgeven. Lukt het ophalen niet, dan de eigen stand — de
  // server weigert een dubbele code alsnog.
  const verseSessies = async (): Promise<AfvulSessie[]> => {
    try {
      const vers = await p.refreshSessies?.()
      if (Array.isArray(vers)) return vers
    } catch { /* eigen stand gebruiken */ }
    return p.sessies || []
  }

  // Klok voor de halfuur-herinnering tijdens een lopende sessie.
  React.useEffect(() => {
    if (!sessie) return
    const id = setInterval(() => setNu(new Date()), 30000)
    return () => clearInterval(id)
  }, [sessie?.id])

  const risico = React.useMemo(
    () => risicoVoorBatch(p.batch, p.bi || [], p.ing || [], inst, p.lots),
    [p.batch, p.bi, p.ing, p.lots, p.haccpInstellingen])

  // ── Wat de app al weet: druk, temperatuur, SG, lots ─────────────────────
  // De druk van de tank één keer ophalen als het formulier openstaat (niet op
  // een klok): het koolzuur meet je bij het afvullen, niet de hele dag.
  const drukSensor = (p.haInst?.enabled ? (p.haInst?.druk_sensors || []) : [])
    .find((x: any) => x?.entity && x?.tank && String(x.tank) === String(p.batch?.tank))
  const [drukLive, setDrukLive] = React.useState<number | null>(null)
  React.useEffect(() => {
    let weg = false
    setDrukLive(null)
    if (!drukSensor?.entity) return
    haGetState(drukSensor.entity)
      .then(d => { if (!weg) setDrukLive(drukNaarBar(d?.state, drukSensor.eenheid)) })
      .catch(() => { /* geen sensor = zelf invullen */ })
    return () => { weg = true }
  }, [drukSensor?.entity, drukSensor?.eenheid])
  const eigenMetingen = (p.gistMetingen || []).filter((m: any) => m?.batch_id === p.batch?.id)
  const tempLive = p.batch?.tank != null ? p.haTankTemps?.[p.batch.tank] : undefined
  const laatsteTemp = eigenMetingen.slice().reverse().find((m: any) => m?.temp != null && m.temp !== '')?.temp
  const tempVoorstel = typeof tempLive === 'number' && isFinite(tempLive) ? tempLive
    : (laatsteTemp != null && isFinite(Number(laatsteTemp)) ? Number(laatsteTemp) : null)
  const sgVoorstel = tankSgMetingen(eigenMetingen).slice(-1)[0]?.sg ?? null

  // Alles wat er bij één verpakking hoort: welke CCP 2, of het koolzuur
  // getoetst wordt, de waarden (voorstel of eigen invoer) en wat er ontbreekt.
  const extraVoor = (x: ExtraInvoer, vp: any) => {
    const type = vp?.type || vp?.naam
    const fles = !!vp && kroonkurkVerplicht(type, inst)
    const co2Nodig = !!vp && co2VanToepassing(type, inst)
    const druk = x.co2_druk ?? (drukLive != null ? String(drukLive) : '')
    const temp = x.co2_temp ?? (tempVoorstel != null ? String(tempVoorstel) : '')
    const volumes = carbVolumes(druk.trim() === '' ? '' : getal(druk), temp.trim() === '' ? '' : getal(temp))
    const co2Redenen = co2Nodig ? beoordeelCo2(volumes, inst, getLang()) : []
    const lotsV = vorigeLots(p.sessies || [], vp?.id)
    const flessenlot = x.flessenlot ?? lotsV.flessenlot
    const kroonkurkenlot = x.kroonkurkenlot ?? lotsV.kroonkurkenlot
    const sg = x.sg_afvullen ?? (sgVoorstel != null ? String(sgVoorstel) : '')
    const klapAantal = getal(x.klap_aantal || '0')
    const klapVernietigd = getal(x.klap_vernietigd || '0')
    const klapOk = !(klapAantal > 0) || (x.klap_gereinigd && Number.isInteger(klapVernietigd) && klapVernietigd >= 0)
    const sensor = x.co2_druk == null && drukLive != null
    return {type, fles, co2Nodig, druk, temp, volumes, co2Redenen, flessenlot, kroonkurkenlot, sg,
      klapAantal, klapVernietigd, klapOk, sensor, ccp2: vp ? ccp2Voor(type, inst) : null}
  }
  type Extra = ReturnType<typeof extraVoor>

  // De velden die met de sessie bevroren worden.
  const sessieExtra = (e: Extra, metKlap: boolean): Partial<AfvulSessie> => {
    const sg = getal(e.sg)
    return {
      ...(e.co2Nodig && e.volumes != null ? {
        co2_druk_bar: getal(e.druk), co2_temp_c: getal(e.temp), co2_volumes: e.volumes,
        co2_max: Number(inst.co2_max_volumes), co2_bron: e.sensor ? 'sensor' as const : 'handmatig' as const,
      } : {}),
      ...(sg > 0.9 && sg < 1.2 ? {sg_afvullen: Math.round(sg * 10000) / 10000} : {}),
      ...(e.fles && e.flessenlot.trim() ? {flessenlot: e.flessenlot.trim()} : {}),
      ...(e.fles && e.kroonkurkenlot.trim() ? {kroonkurkenlot: e.kroonkurkenlot.trim()} : {}),
      ...(metKlap && e.fles && e.klapAantal > 0 ? {
        klapflessen: {aantal: e.klapAantal, vernietigd: e.klapVernietigd, gereinigd: true},
      } : {}),
    }
  }

  // De velden zelf — dezelfde in het achteraf-formulier en bij het starten.
  const extraVelden = (x: ExtraInvoer, zet: (patch: Partial<ExtraInvoer>) => void, e: Extra, metKlap: boolean) => (
    <div className="space-y-2">
      {e.co2Nodig && (
        <div>
          <Label>{t('haccp_co2_titel')}</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <Inp label={t('haccp_co2_druk')} type="number" step="0.01" value={e.druk}
              onChange={v => zet({co2_druk: v})} />
            <Inp label={t('haccp_co2_temp')} type="number" step="0.1" value={e.temp}
              onChange={v => zet({co2_temp: v})} />
            <div className="col-span-2 text-sm pb-2">
              {e.volumes != null ? (
                <span className={e.co2Redenen.length ? 'text-red-600 font-medium' : 'text-gray-800'}>
                  {e.co2Redenen.length ? '✕' : '✓'}{' '}
                  {t('haccp_co2_volumes').replace('{volumes}', fmtCo2(e.volumes, getLang()))
                    .replace('{max}', fmtCo2Grens(inst.co2_max_volumes, getLang()))}
                </span>
              ) : <span className="text-gray-500">{t('haccp_co2_vul_in')}</span>}
            </div>
          </div>
          {e.sensor && (
            <div className="text-xs text-gray-500 mt-0.5">{t('haccp_co2_uit_sensor')}</div>
          )}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <Inp label={t('haccp_sg_afvullen')} type="number" step="0.001" value={e.sg}
            onChange={v => zet({sg_afvullen: v})} />
          {x.sg_afvullen == null && sgVoorstel != null && (
            <div className="text-xs text-gray-500 mt-0.5">{t('haccp_sg_afvullen_uit_meting')}</div>
          )}
        </div>
        {e.fles && (
          <>
            <Inp label={t('haccp_flessenlot')} value={e.flessenlot} onChange={v => zet({flessenlot: v})} />
            <Inp label={t('haccp_kroonkurkenlot')} value={e.kroonkurkenlot} onChange={v => zet({kroonkurkenlot: v})} />
          </>
        )}
      </div>
      {metKlap && e.fles && (
        <div className="grid sm:grid-cols-3 gap-2 items-end">
          <Inp label={t('haccp_klapflessen')} type="number" step="1" min={0} value={x.klap_aantal}
            onChange={v => zet({klap_aantal: v})} />
          {e.klapAantal > 0 && (
            <>
              <Inp label={t('haccp_klap_vernietigd')} type="number" step="1" min={0} value={x.klap_vernietigd}
                onChange={v => zet({klap_vernietigd: v})} />
              <label className="flex items-start gap-2 text-sm text-gray-700 pb-2">
                <input type="checkbox" className="t-checkbox mt-0.5" checked={x.klap_gereinigd}
                  onChange={ev => zet({klap_gereinigd: ev.target.checked})} />
                {t('haccp_klap_gereinigd')}
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )

  // Houdtestflessen: bij flessen twee warm en twee koel uit de afvuller; bij
  // alleen fusten vier flessen uit dezelfde tank vullen.
  const houdtestFlessenTekst = (fles: boolean) =>
    t(fles ? 'haccp_houdtest_flessen_fles' : 'haccp_houdtest_flessen_fust')
  const houdtestFlessenVeld = (aan: boolean, zet: (v: boolean) => void, fles: boolean) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="t-checkbox mt-0.5" checked={aan} onChange={e => zet(e.target.checked)} />
      <span>{houdtestFlessenTekst(fles)}</span>
    </label>
  )

  // Etiketfoto (CCP 3): verkleind tot een archieffoto en geüpload.
  const [fotoBezig, setFotoBezig] = React.useState(false)
  const [fotoFout, setFotoFout] = React.useState('')
  const kiesEtiketFoto = async (file: File | null | undefined, zet: (b: Bijlage) => void) => {
    if (!file) return
    setFotoBezig(true)
    setFotoFout('')
    try {
      const jpg = await naarJpeg(file, ARCHIEF_MAX_PX)
      const u = await uploadBijlage(alsBestand(jpg.blob, naamMetExtensie(file.name, 'jpg')), 'etiket')
      if (!u.ok || !u.bijlage) { setFotoFout(t(uploadFoutSleutel(u.status)).replace('{naam}', u.naam)); return }
      zet(u.bijlage)
    } catch (err) {
      setFotoFout(err instanceof AfbeeldingFout ? t(afbeeldingFoutSleutel(err.code))
        : t('err_upload_mislukt').replace('{naam}', file.name))
    } finally {
      setFotoBezig(false)
    }
  }
  const fotoVeld = (foto: Bijlage | null, zet: (b: Bijlage | null) => void) => (
    <div className="text-sm">
      <Label>{t('haccp_etiket_foto')}</Label>
      {foto ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-700 break-words min-w-0">✓ {foto.naam}</span>
          <button type="button" onClick={() => zet(null)}
            className="min-h-tap sm:min-h-0 text-xs text-gray-500 underline underline-offset-2">{t('btn_delete')}</button>
        </div>
      ) : (
        <label className="inline-flex items-center gap-2 min-h-tap sm:min-h-0 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={fotoBezig}
            onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; void kiesEtiketFoto(f, zet) }} />
          {fotoBezig ? t('haccp_etiket_foto_bezig') : t('haccp_etiket_foto_maken')}
        </label>
      )}
      {fotoFout && <div className="text-xs text-red-600 mt-0.5">{fotoFout}</div>}
    </div>
  )
  const fotoBijlagen = (foto: Bijlage | null): HaccpBijlage[] | undefined =>
    foto ? [{naam: foto.naam, bestand: foto.bestand, rol: 'etiket', geupload_op: new Date().toISOString()}] : undefined

  // ── Sessie starten ───────────────────────────────────────────────────────
  const leegStart = {
    verpakking_id: '' as string | number,
    reiniging_bevestigd: false,
    tht_handmatig: false,
    tht: '',
    tht_reden: '',
    ...leegExtra,
  }
  const [start, setStart] = React.useState(leegStart)

  const gekozenVp = (p.verpakkingen || []).find((v: any) => v.id === Number(start.verpakking_id))
  const startExtra = extraVoor(start, gekozenVp)
  const thtKlasse = thtKlasseVoorBatch(p.batch?.ABV, risico, inst)
  const thtBerekend = berekenTht(tod(), thtKlasse, inst)
  // Ook de vastgezette ABV hoort bij de eerste sessie (net als CCP 1); een
  // batch die al een sessie of afvulling had, wordt niet alsnog geblokkeerd.
  const startBlok = magSessieStarten(p.batch?.id, p.vrijgaven || [], {
    reiniging_bevestigd: start.reiniging_bevestigd,
    verpakking_id: start.verpakking_id ? Number(start.verpakking_id) : null,
  }, p.sessies || [], {batch: p.batch, afvullingen: p.av})
  // Handmatige THT: altijd met reden, en onder de alcoholgrens ook met een
  // datum — anders start de sessie zonder THT en erven alle afvullingen dat.
  const thtBlok = thtHandmatigBlokkade(start.tht_handmatig, start.tht, start.tht_reden, thtKlasse)

  // Te veel koolzuur voor de fles: niet afvullen, of alleen met een afwijking.
  const startCo2Blok = {toegestaan: startExtra.co2Redenen.length === 0, redenen: startExtra.co2Redenen}

  const startSessie = async (co2AfwijkingId?: number) => {
    if (!startBlok.toegestaan || thtBlok || bezig) return
    if (!startCo2Blok.toegestaan && co2AfwijkingId == null) return
    setBezig(true)
    let sessiesNu: AfvulSessie[]
    try { sessiesNu = await verseSessies() } finally { setBezig(false) }
    // Twee tabbladen of apparaten kunnen tegelijk starten; de lotcode moet
    // uniek blijven (de server bewaakt het ook).
    const {sessie_nr: extra, lotcode: code} = nieuweLotcode(sessiesNu, p.batch)
    const paraaf = maakParaaf(p.whoami)
    const id = newId(sessiesNu)
    const record: AfvulSessie = {
      id,
      batch_id: p.batch.id,
      sessie_nr: extra,
      lotcode: code,
      vrijgave_id: (p.vrijgaven || []).filter((v: any) => v.batch_id === p.batch.id).slice(-1)[0]?.id ?? 0,
      verpakking_id: Number(start.verpakking_id),
      verpakking_naam: gekozenVp?.naam,
      verpakking_type: gekozenVp?.type || gekozenVp?.naam,
      start: paraaf.tijdstip,
      status: 'open',
      reiniging_bevestigd: true,
      tht: start.tht_handmatig ? (start.tht || null) : thtBerekend.tht,
      tht_maanden: start.tht_handmatig ? undefined : thtBerekend.maanden,
      tht_klasse: thtKlasse,
      tht_handmatig: start.tht_handmatig || undefined,
      tht_reden: start.tht_handmatig ? start.tht_reden.trim() : undefined,
      start_paraaf: paraaf,
      ccp2: startExtra.ccp2 || undefined,
      ...sessieExtra(startExtra, false),
      co2_afwijking_id: co2AfwijkingId,
      ...quarantaine,
    }
    p.setSessies((prev: AfvulSessie[]) => [...(prev || []), record])
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${p.batch?.naam || ''}: ${code}`,
    })
    // De net gestarte sessie is de sessie waarin je gaat afvullen.
    p.setActieveSessieId?.(id)
    setStartOpen(false)
    setStart(leegStart)
  }

  // ── CCP 2 — sluitcontrole ────────────────────────────────────────────────
  const eigenControles = (p.sluitcontroles || []).filter(c => c.sessie_id === sessie?.id)
  const [sc, setSc] = React.useState({
    aanleiding: 'start' as SluitControle['aanleiding'],
    visueel_ok: true,
    omkeerproef_ok: true,
    flesmond_ok: true,
    draaitest_ok: true,
    rolinstelling: '',
    opmerking: '',
  })
  const omkeerNodig = omkeerproefVerplicht(sessie?.verpakking_type, inst)
  const kroonNodig = kroonkurkVerplicht(sessie?.verpakking_type, inst)
  const scBeoordeling = beoordeelSluitcontrole({
    ...sc,
    omkeerproef_ok: omkeerNodig ? sc.omkeerproef_ok : null,
    flesmond_ok: kroonNodig ? sc.flesmond_ok : null,
    draaitest_ok: kroonNodig ? sc.draaitest_ok : null,
  }, sessie?.verpakking_type, inst)
  const herinnering = sessie ? sluitcontroleHerinnering(sessie, eigenControles, nu, inst) : null

  const slaSluitcontroleOp = () => {
    if (!sessie || scBeoordeling.onvolledig.length) return
    const paraaf = maakParaaf(p.whoami)
    const id = newId(p.sluitcontroles || [])
    const afgekeurd = scBeoordeling.resultaat === 'afgekeurd'
    // Bij afkeur is alles verdacht wat sinds de laatste goedkeuring gemaakt is;
    // bij twijfel over de reikwijdte blokkeert het handboek liever ruimer.
    const geraakt = afgekeurd
      ? afvullingenSindsLaatsteGoedkeuring(sessie, p.av || [], eigenControles, paraaf.tijdstip)
      : []
    const capaId = afgekeurd ? newId(p.capa || []) : undefined
    const record: SluitControle = {
      id,
      sessie_id: sessie.id,
      batch_id: p.batch.id,
      aanleiding: sc.aanleiding,
      visueel_ok: sc.visueel_ok,
      omkeerproef_ok: omkeerNodig ? sc.omkeerproef_ok : null,
      flesmond_ok: kroonNodig ? sc.flesmond_ok : null,
      draaitest_ok: kroonNodig ? sc.draaitest_ok : null,
      rolinstelling: sc.rolinstelling.trim() || undefined,
      resultaat: scBeoordeling.resultaat,
      geblokkeerde_afvulling_ids: geraakt.length ? geraakt : undefined,
      capa_id: capaId,
      opmerking: sc.opmerking.trim() || undefined,
      paraaf,
    }
    p.setSluitcontroles((prev: SluitControle[]) => [...(prev || []), record])
    if (afgekeurd) {
      if (geraakt.length) {
        // Stabiele code, geen vertaalde tekst: de data mag niet veranderen
        // wanneer de gebruiker van taal wisselt.
        p.setAv((prev: any[]) => (prev || []).map((a: any) => geraakt.includes(a.id)
          ? {...a, geblokkeerd: true, geblokkeerd_reden: 'ccp2_afgekeurd',
             geblokkeerd_controle_id: id}
          : a))
      }
      p.setCapa((prev: any[]) => [...(prev || []), {
        id: capaId, datum: tod(),
        omschrijving: `${t('haccp_ccp2_titel')} — ${sessie.lotcode}`,
        oorzaak: '', actie: sc.opmerking.trim(), verantwoordelijke: paraaf.gebruiker,
        status: 'open', batch_id: p.batch.id, sessie_id: sessie.id,
        sluitcontrole_id: id, bron: 'ccp2',
      }])
    }
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'SluitControle', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${sessie.lotcode}: ${t(afgekeurd ? 'haccp_ccp2_afgekeurd' : 'haccp_ccp2_goedgekeurd')}`,
    })
    setSc(s => ({...s, aanleiding: 'halfuur', visueel_ok: true, omkeerproef_ok: true,
                 flesmond_ok: true, draaitest_ok: true,
                 rolinstelling: '', opmerking: ''}))
    setNu(new Date())
  }

  // ── CCP 2 — lege flessen inspecteren (live) ─────────────────────────────
  // Eén registratie per sessie: elke fles is tegen het licht bekeken, zoveel
  // zijn er afgekeurd. Geen halfuurritme.
  const [fi, setFi] = React.useState({bekeken: false, afgekeurd: ''})
  const fiRedenen = beoordeelFlesinspectie(fi)
  const flesinspectie = eigenControles.find(c => c.methode === 'lege_flessen') || null
  const slaFlesinspectieOp = () => {
    if (!sessie || fiRedenen.length || flesinspectie) return
    const paraaf = maakParaaf(p.whoami)
    const id = newId(p.sluitcontroles || [])
    const record: SluitControle = {
      id, sessie_id: sessie.id, batch_id: p.batch.id,
      methode: 'lege_flessen', afgekeurd_aantal: Math.max(0, Math.round(getal(fi.afgekeurd || '0'))),
      aanleiding: 'start', visueel_ok: true, resultaat: 'goedgekeurd', paraaf,
    }
    p.setSluitcontroles((prev: SluitControle[]) => [...(prev || []), record])
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'SluitControle', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${sessie.lotcode}: ${t('haccp_flesinspectie_titel')} · ${record.afgekeurd_aantal} ${t('haccp_afgekeurd_kort')}`,
    })
    setFi({bekeken: false, afgekeurd: ''})
  }

  // Klapfles tijdens een lopende sessie: vaste procedure, één regel erbij.
  const [klap, setKlap] = React.useState({open: false, vernietigd: '', gereinigd: false})
  const sessieIsFles = !!sessie && kroonkurkVerplicht(sessie.verpakking_type, inst)
  const legKlapflesVast = () => {
    if (!sessie || !klap.gereinigd) return
    const v = Math.max(0, Math.round(getal(klap.vernietigd || '0')))
    p.setSessies((prev: AfvulSessie[]) => (prev || []).map(s => s.id === sessie.id
      ? {...s, klapflessen: {aantal: (s.klapflessen?.aantal || 0) + 1,
          vernietigd: (s.klapflessen?.vernietigd || 0) + v, gereinigd: true}}
      : s))
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: sessie.id, actie: 'gewijzigd',
      omschrijving: `${sessie.lotcode}: ${t('haccp_klapfles')} · ${v} ${t('haccp_klap_vernietigd_kort')}`,
    })
    setKlap({open: false, vernietigd: '', gereinigd: false})
  }

  // ── CCP 3 — etiketcontrole ───────────────────────────────────────────────
  // In de lopende sessie (etiket bij het afvullen), of na de vrijgave voor
  // verkoop per lotcode die nog op zijn etiket wacht (`etiketDoel`).
  const etiketVan = (doel: AfvulSessie | null | undefined) =>
    (p.etiketcontroles || []).filter(e => e.sessie_id === doel?.id)
  const eigenEtiket = etiketVan(sessie)
  const teEtiket = teEtiketteren(p.batch?.id, p.sessies, p.av)
  const [etiketSessieId, setEtiketSessieId] = React.useState<number | null>(null)
  const etiketDoel = teEtiket.find(x => x.sessie.id === etiketSessieId)?.sessie || teEtiket[0]?.sessie || null
  const [ec, setEc] = React.useState({
    product_id: (batchProduct ?? '') as string | number,
    aanleiding: 'start' as EtiketControle['aanleiding'],
    lotcode_ok: false,
    tht_ok: false,
    alcohol_ok: false,
    opmerking: '',
    foto: null as Bijlage | null,
  })
  const gekozenProduct = (p.producten || []).find((x: any) => x.id === Number(ec.product_id))
  // Laden de producten (of de koppeling van de batch) pas na het openen, dan
  // alsnog het product van de batch — alleen in een nog lege keuze.
  React.useEffect(() => {
    if (batchProduct == null) return
    setEc(e => e.product_id ? e : {...e, product_id: batchProduct})
    setNa(n => n.product_id ? n : {...n, product_id: batchProduct})
  }, [p.batch?.id, batchProduct])
  // Een keuzelijst van producten: de producten van het recept van de batch
  // bovenaan ("Bij dit recept"), dan de andere; zonder gearchiveerde, behalve
  // het product dat al gekozen is (utils/batchKeten.ts → productenVoorBatchKeuze).
  const productOpties = (gekozenId: string | number) =>
    productSelOpties(
      productenVoorBatchKeuze(p.batch, p.producten, { batches: p.batches, recepten: p.recepten, gekozenId }),
      ({product, gearchiveerd}) => gearchiveerd
        ? t('product_keuze_gearchiveerd').replace('{naam}', product.naam || t('lbl_naamloos'))
        : (product.naam || t('lbl_naamloos')))
  const receptAllergenen = React.useMemo(
    () => allergenenUitBatch(p.batch?.id, p.bi || [], p.ing || [], p.lots),
    [p.batch, p.bi, p.ing, p.lots])
  const etiketInfo = allergenenVanProduct(gekozenProduct)
  const vergelijking = vergelijkAllergenen(receptAllergenen, etiketInfo.allergenen, etiketInfo.gezet)
  const etiketBlok = magEtiketterenDoorgaan(vergelijking)
  const etiketOnvolledig = !ec.product_id || !ec.lotcode_ok || !ec.tht_ok || !ec.alcohol_ok
  const abvRegel = (product: any) => ccp3AbvRegel(p.abvBatch, product?.abv, t, getLang())
  const allergeenLabel = (a: string) =>
    t(ALLERGENEN_LIJST.find(x => x.key === a)?.label || a)

  // De allergenenredenen dragen hun allergenen als parameter; zonder invullen
  // leest de afvuller letterlijk "{allergenen}" en weet hij niet wat er mist.
  const etiketRedenTekst = (
    r: {code: string; i18nKey: string; params?: Record<string, string | number>},
    v: {ontbreektOpEtiket: string[]; teveelOpEtiket: string[]}
  ): string =>
    r.code === 'allergeen_ontbreekt'
      ? t('haccp_blok_allergeen_ontbreekt')
          .replace('{allergenen}', v.ontbreektOpEtiket.map(allergeenLabel).join(', '))
      : r.code === 'allergeen_teveel'
      ? t('haccp_blok_allergeen_teveel')
          .replace('{allergenen}', v.teveelOpEtiket.map(allergeenLabel).join(', '))
      : blokkadeTekst({code: r.code, i18nKey: r.i18nKey, params: r.params})

  // Het etiket van een product vastleggen kan hier meteen, zonder de pagina
  // (en het half ingevulde formulier) te verlaten — maar altijd via dezelfde
  // dialoog "Etiket bijwerken" als op de batch, het product en de HACCP-
  // matrix: de enige schrijfweg voor `product.allergenen`.
  // Wat hier gebeurt blijft daardoor een eigen handeling, nooit "neem over".
  const etiketDienst = useEtiketBijwerken()
  const etiketBijwerkenKnop = (product: any) => etiketDienst && product ? (
    <button type="button" onClick={() => etiketDienst.open({productId: Number(product.id), batchId: p.batch?.id ?? null})}
      className="min-h-tap sm:min-h-0 text-xs font-medium underline underline-offset-2 t-accent-text">
      {t('etiket_actie_bijwerken')}
    </button>
  ) : null

  const slaEtiketOp = (doel: AfvulSessie | null, afwijkingId?: number) => {
    if (!doel || etiketOnvolledig) return
    const paraaf = maakParaaf(p.whoami)
    const id = newId(p.etiketcontroles || [])
    const record: EtiketControle = {
      id,
      sessie_id: doel.id,
      batch_id: p.batch.id,
      product_id: Number(ec.product_id),
      etiket_artikel: gekozenProduct?.etiket_artikel,
      // De getallen van dat moment (alleen nieuwe records; append-only blijft gelden).
      ...etiketControleGetallen({product: gekozenProduct, abvBatch: p.abvBatch}),
      aanleiding: ec.aanleiding,
      allergenen_recept: receptAllergenen,
      allergenen_etiket: etiketInfo.allergenen,
      allergenen_gelijk: vergelijking.gelijk,
      lotcode_ok: ec.lotcode_ok,
      tht_ok: ec.tht_ok,
      alcohol_ok: ec.alcohol_ok,
      resultaat: etiketBlok.toegestaan ? 'goedgekeurd' : 'afgekeurd',
      afwijking_id: afwijkingId,
      opmerking: ec.opmerking.trim() || undefined,
      bijlagen: fotoBijlagen(ec.foto),
      paraaf,
    }
    p.setEtiketcontroles((prev: EtiketControle[]) => [...(prev || []), record])
    // Etiketteren na de vrijgave: het etiket zit erop, dus dit product van
    // deze lotcode is (wat het etiket betreft) te koop.
    if (sessieEtiketteren(doel) === 'na_vrijgave') {
      p.setAv((prev: any[]) => naEtiketControle(prev || [], doel.id, Number(ec.product_id)))
    }
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'EtiketControle', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${doel.lotcode}: ${gekozenProduct?.naam || ''}`,
    })
    setEc(e => ({...e, aanleiding: 'rolwissel', lotcode_ok: false, tht_ok: false,
                 alcohol_ok: false, opmerking: '', foto: null}))
  }

  // Wisselen van sessie betekent wisselen van afvuller-opstelling: de controle-
  // formulieren beginnen dan opnieuw bij de startcontrole. Zonder deze reset
  // zou de tweede sessie een 'halfuur'-controle krijgen (de stand die na de
  // vorige registratie bleef staan) en blijft het afvullen daar geblokkeerd.
  React.useEffect(() => {
    if (!sessie) return
    setSc({aanleiding: 'start', visueel_ok: true, omkeerproef_ok: true,
           flesmond_ok: true, draaitest_ok: true,
           rolinstelling: '', opmerking: ''})
    setEc(e => ({...e, aanleiding: 'start', lotcode_ok: false,
                 tht_ok: false, alcohol_ok: false, opmerking: '', foto: null}))
    setFi({bekeken: false, afgekeurd: ''})
    setKlap({open: false, vernietigd: '', gereinigd: false})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessie?.id])
  // Een andere lotcode om te etiketteren: de controle begint opnieuw.
  React.useEffect(() => {
    if (!etiketDoel) return
    setEc(e => ({...e, aanleiding: 'start', lotcode_ok: false,
                 tht_ok: false, alcohol_ok: false, opmerking: '', foto: null}))
  }, [etiketDoel?.id])

  // ── Sessie afsluiten ─────────────────────────────────────────────────────
  // Met de afvullingen erbij: elk afgevuld product moet zijn eigen
  // etiketcontrole hebben — ook wat al vóór die eis geregistreerd was.
  const afsluitBlok = sessie
    ? magSessieAfsluiten(sessie, eigenControles, eigenEtiket, p.capa || [],
        p.av || [], p.producten || [], p.sessies || [])
    : {toegestaan: false, redenen: []}

  const sluitSessie = () => {
    if (!sessie || !afsluitBlok.toegestaan) return
    const paraaf = maakParaaf(p.whoami)
    p.setSessies((prev: AfvulSessie[]) => (prev || []).map(s => s.id === sessie.id
      ? {...s, status: 'afgesloten' as const, eind: paraaf.tijdstip, afgesloten_paraaf: paraaf}
      : s))
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: sessie.id, actie: 'gewijzigd',
      omschrijving: `${sessie.lotcode}: ${t('haccp_sessie_afgesloten')}`,
    })
  }

  // De bevestiging zit in de knop (BevestigKnop), geen confirm().
  const breekAf = () => {
    if (!sessie) return
    const paraaf = maakParaaf(p.whoami)
    p.setSessies((prev: AfvulSessie[]) => (prev || []).map(s => s.id === sessie.id
      ? {...s, status: 'afgebroken' as const, eind: paraaf.tijdstip, afgesloten_paraaf: paraaf}
      : s))
  }

  // ── Afwijkings-ontsnapping ───────────────────────────────────────────────
  const bevestigAfwijking = (onderbouwing: string) => {
    if (!afwijking) return
    const paraaf = maakParaaf(p.whoami)
    const afwId = newId(p.afwijkingen || [])
    const rec = bouwAfwijking(afwId, afwijking.bron, afwijking.blok,
      {batch_id: p.batch.id, sessie_id: afwijking.doel?.id ?? sessie?.id},
      onderbouwing, blokkadeSamenvatting(afwijking.blok), paraaf)
    if (!rec) return
    const capaId = newId(p.capa || [])
    p.setAfwijkingen((prev: any[]) => [...(prev || []), {...rec, capa_id: capaId}])
    p.setCapa((prev: any[]) => [...(prev || []),
      {...capaUitAfwijking(rec, capaId), bron: afwijking.bron === 'ccp3_etiket' ? 'ccp3' : 'afwijking'}])
    const bron = afwijking.bron
    const actie = afwijking.actie
    setAfwijking(null)
    if (bron === 'ccp3_etiket') slaEtiketOp(afwijking.doel ?? sessie, afwId)
    // Te veel koolzuur en toch afgevuld: de sessie draagt de afwijking.
    if (actie === 'start') void startSessie(afwId)
    if (actie === 'achteraf') void legAchterafVast(true, afwId)
  }

  const Label = ({children}: {children: React.ReactNode}) => (
    <div className="text-xs font-semibold text-gray-500 mb-1">{children}</div>
  )

  // ── Startformulier ───────────────────────────────────────────────────────
  // Zowel voor de eerste sessie als voor een extra verpakking naast een sessie
  // die al loopt; het formulier is in beide gevallen hetzelfde.
  const startFormulier = (
    <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          {/* Een verpakking waarvoor al een sessie loopt is herkenbaar in de
              lijst; kiezen kan wel, maar de blokkade legt uit waarom niet. */}
          <Sel label={t('lbl_packaging')} value={String(start.verpakking_id)}
            onChange={(v: string) => setStart({...start, verpakking_id: v})}
            opts={(p.verpakkingen || []).map((v: any) => ({
              v: String(v.id),
              l: openSessies.some(s => Number(s.verpakking_id) === Number(v.id))
                ? `${v.naam} — ${t('haccp_sessie_open')}` : v.naam,
            }))} />
          <div>
            <Label>{t('haccp_sessie_lotcode')}</Label>
            <div className="font-mono text-sm text-gray-800 py-2">
              {p.batch ? nieuweLotcode(p.sessies || [], p.batch).lotcode : ''}
            </div>
          </div>
        </div>

        {/* THT volgt uit hoofdstuk 3.3; overschrijven kan, maar met reden */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-gray-500">{t('haccp_sessie_tht')}</span>
            <span className="text-gray-800">
              {thtBerekend.tht ? fmtD(thtBerekend.tht) : t('haccp_sessie_bewaaradvies_tekst')}
              <span className="text-gray-400 ml-1">
                ({t(THT_KLASSE_LABEL_KEY[thtKlasse] || '')})
              </span>
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={start.tht_handmatig}
              onChange={e => setStart({...start, tht_handmatig: e.target.checked})} />
            {t('haccp_sessie_tht_handmatig')}
          </label>
          {start.tht_handmatig && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Inp label={t('haccp_sessie_tht')} type="date" value={start.tht}
                onChange={v => setStart({...start, tht: v})} req={thtKlasse !== 'geen'} />
              <Inp label={t('haccp_sessie_tht_reden')} value={start.tht_reden}
                onChange={v => setStart({...start, tht_reden: v})} req />
            </div>
          )}
          {thtBlok && (
            <div className="text-xs text-red-600">
              {t(thtBlok === 'reden' ? 'haccp_sessie_tht_reden_verplicht' : 'haccp_sessie_tht_datum_verplicht')}
            </div>
          )}
        </div>

        {gekozenVp && extraVelden(start, patch => setStart(st => ({...st, ...patch})), startExtra, false)}

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="t-checkbox" checked={start.reiniging_bevestigd}
            onChange={e => setStart({...start, reiniging_bevestigd: e.target.checked})} />
          {t('haccp_sessie_reiniging')}
        </label>

        <BlokkadeKaart blok={startBlok} compact />
        {gekozenVp && !startCo2Blok.toegestaan && (
          <BlokkadeKaart blok={startCo2Blok} compact
            onAfwijking={startExtra.volumes != null && startBlok.toegestaan && !thtBlok
              ? () => setAfwijking({blok: startCo2Blok, titel: t('haccp_co2_titel'), bron: 'sessie_start', actie: 'start'})
              : undefined} />
        )}

        <div className="flex justify-end">
          <Btn s="sm" disabled={!startBlok.toegestaan || !startCo2Blok.toegestaan || !!thtBlok || bezig}
            onClick={() => startSessie()}>
            {t('haccp_sessie_starten')}
          </Btn>
        </div>
    </div>
  )

  // ── Achteraf vastleggen ──────────────────────────────────────────────────
  // Tijdens het afvullen heb je je handen vol: er wordt niets live ingetikt.
  // Dit formulier legt de hele sessie in één keer vast — wat er is afgevuld én
  // de controles die erbij horen — met de tijden waarop het echt gebeurd is.
  // De paraaf (wie, wanneer vastgelegd) blijft automatisch: achteraf invoeren
  // mag, de paraaf vervalsen niet.
  const naVp = (p.verpakkingen || []).find((v: any) => v.id === Number(na.verpakking_id))
  const naOmkeerNodig = omkeerproefVerplicht(naVp?.type || naVp?.naam, inst)
  const naKroonNodig = kroonkurkVerplicht(naVp?.type || naVp?.naam, inst)
  const naBeoordeling = beoordeelSluitcontrole({
    aanleiding: 'start',
    visueel_ok: na.visueel_ok,
    omkeerproef_ok: naOmkeerNodig ? na.omkeerproef_ok : null,
    flesmond_ok: naKroonNodig ? na.flesmond_ok : null,
    draaitest_ok: naKroonNodig ? na.draaitest_ok : null,
  }, naVp?.type || naVp?.naam, inst)
  // Volgens het handboek hoort er bij de start, elk halfuur en aan het eind
  // een sluitcontrole. Wat de gebruiker invult telt; het verschil met dat
  // ritme wordt gemeld, niet stilzwijgend aangevuld.
  const naDekking = controleDekking(na.van, na.tot,
    2 + na.tussen.filter(Boolean).length, inst.sluitcontrole_interval_min)
  const naProduct = (p.producten || []).find((x: any) => x.id === Number(na.product_id))
  const naEtiket = allergenenVanProduct(naProduct)
  const naVergelijking = vergelijkAllergenen(receptAllergenen, naEtiket.allergenen, naEtiket.gezet)
  const naEtiketBlok = magEtiketterenDoorgaan(naVergelijking)
  const naBlok = magSessieStarten(p.batch?.id, p.vrijgaven || [], {
    reiniging_bevestigd: na.reiniging_bevestigd,
    verpakking_id: na.verpakking_id ? Number(na.verpakking_id) : null,
  }, p.sessies || [], {batch: p.batch, afvullingen: p.av})
  const naThtKlasse = thtKlasse
  const naTht = berekenTht(na.datum || tod(), naThtKlasse, inst)
  // CCP 2 volgt de verpakking: lege flessen inspecteren (fles), de sluiting
  // (blik, of fles als de brouwerij dat kiest) of geen CCP 2 (fust).
  const naExtra = extraVoor(na, naVp)
  const naCcp2 = naExtra.ccp2 || 'geen'
  const naFlesRedenen = naCcp2 === 'lege_flessen'
    ? beoordeelFlesinspectie({bekeken: na.flessen_bekeken, afgekeurd: na.afgekeurd}) : []
  const naCcp2Ok = naCcp2 === 'lege_flessen' ? naFlesRedenen.length === 0
    : naCcp2 === 'sluitcontrole'
      ? na.visueel_ok && (!naOmkeerNodig || na.omkeerproef_ok)
        && (!naKroonNodig || (na.flesmond_ok && na.draaitest_ok))
        && naBeoordeling.onvolledig.length === 0
        // Een afkeuring hoort niet achteraf en losstaand: daar horen een
        // corrigerende maatregel en een blokkade van de betrokken verpakkingen
        // bij, en die lopen via de gewone sluitcontrole.
        && naBeoordeling.resultaat === 'goedgekeurd'
      : true
  // Etiketteren na de vrijgave: het etiket zit er nu nog niet op, CCP 3 volgt
  // per lotcode na de houdtest.
  const naMetEtiket = quarantaine.etiketteren === 'afvullen'
  const naCompleet = !!na.product_id && Number(na.hoeveelheid) > 0
    && naCcp2Ok && naExtra.klapOk
    && (!houdtestFlessenNieuw || na.houdtest_flessen)
    && (!naMetEtiket || (na.lotcode_ok && na.tht_ok && na.alcohol_ok))
  const naToegestaan = naBlok.toegestaan && naCompleet && (!naMetEtiket || naEtiketBlok.toegestaan)
  // Het koolzuur apart: boven de grens kan het alleen met een afwijking.
  const naCo2Blok = {toegestaan: naExtra.co2Redenen.length === 0, redenen: naExtra.co2Redenen}

  // De afvulling zelf loopt via de pagina: die kent voorraad, accijns en logs.
  const naDatum = na.datum || tod()
  const naVelden = naVp ? {
    product_id: Number(na.product_id),
    verpakking_id: Number(na.verpakking_id),
    verpakking_type: naVp.naam,
    inhoud_per_eenheid: Number(naVp.inhoud_liter || 0),
    hoeveelheid: Number(na.hoeveelheid),
    datum: naDatum,
    tijd: na.tot || na.van || '',
    tht: naTht.tht,
    gn_code: '',
  } : null
  // De controles van de afvulling (verpakkingsvoorraad, tankvolume, ABV):
  // een fout zet de knop uit, een waarschuwing bevestig je in de knop.
  const naControle: AfvulControle | null = naVelden && p.onAchterafControleren
    ? p.onAchterafControleren(naVelden) : null

  const legAchterafVast = async (bevestigd = false, co2AfwijkingId?: number) => {
    if (!naToegestaan || !naVp || !naVelden || bezig) return
    if (!naCo2Blok.toegestaan && co2AfwijkingId == null) return
    const datum = naDatum
    const startMoment = `${datum}T${na.van || '12:00'}:00`
    const eindMoment = `${datum}T${na.tot || na.van || '12:00'}:00`
    const velden = naVelden
    // Eerst alle controles van de afvulling (verpakkingsvoorraad, tankvolume,
    // ABV). De sessie en de CCP-registraties hieronder zijn append-only
    // bewijs: die gaan pas weg als de afvulling er ook komt — anders bleef er
    // bij te weinig voorraad een spooksessie met controles maar zonder
    // verpakkingen achter, en kreeg de volgende poging B2.
    if (naControle && (naControle.fout || (naControle.waarschuwingen.length && !bevestigd))) return

    setBezig(true)
    let sessiesNu: AfvulSessie[]
    try { sessiesNu = await verseSessies() } finally { setBezig(false) }
    const paraaf = maakParaaf(p.whoami)

    // Sessie — meteen afgesloten: het afvullen is al gebeurd.
    const {sessie_nr: extra, lotcode: code} = nieuweLotcode(sessiesNu, p.batch)
    const sessieId = newId(sessiesNu)
    const sessieRec: AfvulSessie = {
      id: sessieId,
      batch_id: p.batch.id,
      sessie_nr: extra,
      lotcode: code,
      vrijgave_id: (p.vrijgaven || []).filter((v: any) => v.batch_id === p.batch.id).slice(-1)[0]?.id ?? 0,
      verpakking_id: Number(na.verpakking_id),
      verpakking_naam: naVp.naam,
      verpakking_type: naVp.type || naVp.naam,
      start: startMoment,
      eind: eindMoment,
      status: 'afgesloten',
      reiniging_bevestigd: true,
      tht: naTht.tht,
      tht_maanden: naTht.maanden,
      tht_klasse: naThtKlasse,
      start_paraaf: paraaf,
      afgesloten_paraaf: paraaf,
      achteraf: true,
      ccp2: naCcp2,
      ...sessieExtra(naExtra, true),
      co2_afwijking_id: co2AfwijkingId,
      ...quarantaine,
      ...(houdtestFlessenNieuw && na.houdtest_flessen ? {houdtest_flessen: true} : {}),
    }
    p.setSessies((prev: AfvulSessie[]) => [...(prev || []), sessieRec])

    // CCP 2 — start, de opgegeven tussencontroles, en het eind. Elke controle
    // is een eigen registratie met een eigen tijdstip: bij een afkeuring moet
    // te bepalen zijn vanaf welk moment er geblokkeerd wordt.
    const bouwControle = (aanleiding: SluitControle['aanleiding'], moment: string): SluitControle => ({
      id: newId(p.sluitcontroles || []),
      sessie_id: sessieId,
      batch_id: p.batch.id,
      aanleiding,
      visueel_ok: na.visueel_ok,
      omkeerproef_ok: naOmkeerNodig ? na.omkeerproef_ok : null,
      flesmond_ok: naKroonNodig ? na.flesmond_ok : null,
      draaitest_ok: naKroonNodig ? na.draaitest_ok : null,
      uitgevoerd_op: moment,
      resultaat: naBeoordeling.resultaat,
      opmerking: na.opmerking.trim() || undefined,
      paraaf,
    })
    if (naCcp2 === 'sluitcontrole') {
      const tussenControles = na.tussen
        .filter(Boolean)
        .map(tijd => bouwControle('halfuur', `${datum}T${tijd}:00`))
      p.setSluitcontroles((prev: SluitControle[]) => [...(prev || []),
        bouwControle('start', startMoment), ...tussenControles,
        bouwControle('einde', eindMoment)])
    } else if (naCcp2 === 'lege_flessen') {
      // Eén registratie: elke fles bekeken, zoveel eruit.
      p.setSluitcontroles((prev: SluitControle[]) => [...(prev || []), {
        id: newId(prev || []), sessie_id: sessieId, batch_id: p.batch.id,
        methode: 'lege_flessen', afgekeurd_aantal: Math.max(0, Math.round(getal(na.afgekeurd || '0'))),
        aanleiding: 'start', visueel_ok: true, uitgevoerd_op: startMoment,
        resultaat: 'goedgekeurd', opmerking: na.opmerking.trim() || undefined, paraaf,
      }])
    }

    // CCP 3 — etiketcontrole met dezelfde allergenenvergelijking als live.
    // Etiketteren na de vrijgave: die volgt later, per lotcode.
    const etiketId = newId(p.etiketcontroles || [])
    if (naMetEtiket) p.setEtiketcontroles((prev: EtiketControle[]) => [...(prev || []), {
      id: etiketId,
      sessie_id: sessieId,
      batch_id: p.batch.id,
      product_id: Number(na.product_id),
      etiket_artikel: naProduct?.etiket_artikel,
      ...etiketControleGetallen({product: naProduct, abvBatch: p.abvBatch}),
      aanleiding: 'start',
      uitgevoerd_op: startMoment,
      allergenen_recept: receptAllergenen,
      allergenen_etiket: naEtiket.allergenen,
      allergenen_gelijk: naVergelijking.gelijk,
      lotcode_ok: na.lotcode_ok,
      tht_ok: na.tht_ok,
      alcohol_ok: na.alcohol_ok,
      resultaat: 'goedgekeurd',
      opmerking: na.opmerking.trim() || undefined,
      bijlagen: fotoBijlagen(na.etiket_foto),
      paraaf,
    }])

    // De afvulling zelf — in dezelfde handeling, dus in dezelfde atomaire
    // commit als de sessie en de controles.
    p.onAchterafAfvullen?.(velden, sessieRec)
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: sessieId, actie: 'aangemaakt',
      omschrijving: `${p.batch?.naam || ''}: ${code} — ${t('haccp_achteraf_titel')}`,
    })
    setNa({...leegNa, datum: na.datum, product_id: na.product_id})
  }

  const achterafFormulier = (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{t('haccp_achteraf_uitleg')}</p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Sel zet zelf al een lege keuze bovenaan — geen tweede '—' erbij. */}
        <Sel label={t('lbl_afvulling_product')} value={String(na.product_id)}
          onChange={(v: string) => setNa({...na, product_id: v})}
          ph={t('ph_select_product')} opts={productOpties(na.product_id)} />
        {/* Met voorraad erbij, net als het live-formulier: zonder voorraad
            kan er niets worden afgevuld. */}
        <Sel label={t('lbl_packaging')} value={String(na.verpakking_id)}
          onChange={(v: string) => setNa({...na, verpakking_id: v})}
          opts={(p.verpakkingen || []).map((v: any) => {
            const voorraad = verpakkingVoorraad(v, p.onderdelen || [])
            return {v: String(v.id), l: `${v.naam} — ${voorraad} ${t('unit_stuks')}`,
                    d: voorraad <= 0 && String(v.id) !== String(na.verpakking_id)}
          })} />
        <Inp label={t('batch_filling_units')} type="number" value={na.hoeveelheid}
          onChange={v => setNa({...na, hoeveelheid: v})} />
        <Inp label={t('batch_filling_date')} type="date" value={na.datum}
          onChange={v => setNa({...na, datum: v})} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <Inp label={t('haccp_achteraf_van')} type="time" value={na.van}
          onChange={v => setNa({...na, van: v})} />
        <Inp label={t('haccp_achteraf_tot')} type="time" value={na.tot}
          onChange={v => setNa({...na, tot: v})} />
        <div>
          <Label>{t('haccp_sessie_lotcode')}</Label>
          <div className="font-mono text-sm text-gray-800 py-2">
            {p.batch ? nieuweLotcode(p.sessies || [], p.batch).lotcode : ''}
          </div>
        </div>
        <div>
          <Label>{t('haccp_sessie_tht')}</Label>
          <div className="text-sm text-gray-800 py-2">
            {naTht.tht ? fmtD(naTht.tht) : t('haccp_sessie_bewaaradvies_tekst')}
          </div>
        </div>
      </div>

      {/* De controles die bij de sessie horen — in dezelfde handeling. */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1.5">
        <Label>{t('haccp_achteraf_controles')}</Label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="t-checkbox" checked={na.reiniging_bevestigd}
            onChange={e => setNa({...na, reiniging_bevestigd: e.target.checked})} />
          {t('haccp_sessie_reiniging')}
        </label>
        {/* CCP 2 volgt de verpakking (ccp2Voor). */}
        {naCcp2 === 'lege_flessen' && (
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox mt-0.5" checked={na.flessen_bekeken}
                onChange={e => setNa({...na, flessen_bekeken: e.target.checked})} />
              <span>{t('haccp_flessen_bekeken')}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Inp label={t('haccp_afgekeurd')} type="number" step="1" min={0} value={na.afgekeurd}
                onChange={v => setNa({...na, afgekeurd: v})} />
            </div>
            <div className="text-xs text-gray-500">{t('haccp_afgekeurd_hint')}</div>
          </div>
        )}
        {naCcp2 === 'sluitcontrole' && (
          <>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={na.visueel_ok}
              onChange={e => setNa({...na, visueel_ok: e.target.checked})} />
            {t('haccp_achteraf_sluit_ok')}
          </label>
          {naOmkeerNodig && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={na.omkeerproef_ok}
                onChange={e => setNa({...na, omkeerproef_ok: e.target.checked})} />
              {t('haccp_ccp2_omkeerproef')}
            </label>
          )}
          {naKroonNodig && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="t-checkbox" checked={na.flesmond_ok}
                  onChange={e => setNa({...na, flesmond_ok: e.target.checked})} />
                {t('haccp_ccp2_flesmond')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="t-checkbox" checked={na.draaitest_ok}
                  onChange={e => setNa({...na, draaitest_ok: e.target.checked})} />
                {t('haccp_ccp2_draaitest')}
              </label>
            </>
          )}

          {/* Tussencontroles: de start en het eind zitten er automatisch in, de
              halfuurcontroles vul je zelf in met hun tijdstip. */}
          <div className="pt-2 space-y-1.5">
            <Label>{t('haccp_achteraf_tussen')}</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {na.tussen.map((tijd, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input type="time" value={tijd}
                    onChange={e => setNa({...na, tussen: na.tussen.map((x, j) => j === i ? e.target.value : x)})}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white t-input shadow-sm" />
                  <button type="button" title={t('btn_delete')}
                    onClick={() => setNa({...na, tussen: na.tussen.filter((_, j) => j !== i)})}
                    className="px-1.5 py-1 text-gray-400 hover:text-red-500">✕</button>
                </span>
              ))}
              <button type="button"
                onClick={() => {
                  // Het eerstvolgende halfuurmoment na de laatste die er al staat
                  // wordt voorgesteld; wat je niet gedaan hebt, haal je weg.
                  const momenten = verwachteControleMomenten(na.van, na.tot, inst.sluitcontrole_interval_min)
                  const gebruikt = new Set([na.van, na.tot, ...na.tussen])
                  const volgende = momenten.find(m => !gebruikt.has(m)) || ''
                  setNa({...na, tussen: [...na.tussen, volgende]})
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
                + {t('haccp_achteraf_tussen_toevoegen')}
              </button>
            </div>
            {naDekking.tekort > 0 && (
              <div className="text-xs text-orange-600">
                {t('haccp_achteraf_tussen_tekort')
                  .replace('{verwacht}', String(naDekking.verwacht))
                  .replace('{vastgelegd}', String(naDekking.vastgelegd))}
              </div>
            )}
          </div>

          {/* Een afkeuring hoort bij een corrigerende maatregel en een blokkade
              van wat er sinds de laatste goedkeuring is gemaakt — dat gaat via
              de gewone sluitcontrole, niet via dit formulier. */}
          {naBeoordeling.resultaat === 'afgekeurd' && (
            <div className="text-xs text-red-700 font-medium">
              {t('haccp_achteraf_afgekeurd')}
            </div>
          )}
          </>
        )}
        {naVp && (
          <div className="pt-2 border-t border-gray-200">
            {extraVelden(na, patch => setNa(n => ({...n, ...patch})), naExtra, true)}
          </div>
        )}
        {naVp && houdtestFlessenNieuw && (
          <div className="pt-2 border-t border-gray-200">
            {houdtestFlessenVeld(na.houdtest_flessen, v => setNa(n => ({...n, houdtest_flessen: v})), naExtra.fles)}
          </div>
        )}
        {!naMetEtiket && (
          <div className="pt-2 border-t border-gray-200 text-xs text-gray-500">{t('haccp_etiket_na_vrijgave_kort')}</div>
        )}
        {naMetEtiket && ([['lotcode_ok', 'haccp_ccp3_lotcode_ok'],
           ['tht_ok', 'haccp_ccp3_tht_ok'],
           ['alcohol_ok', 'haccp_ccp3_alcohol_ok']] as const).map(([veld, key]) => (
          <label key={veld} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={na[veld]}
              onChange={e => setNa({...na, [veld]: e.target.checked})} />
            {t(key)}
            {veld === 'alcohol_ok' && naProduct && (
              <span className="text-xs text-gray-500">{abvRegel(naProduct)}</span>
            )}
          </label>
        ))}
        <div className="grid sm:grid-cols-2 gap-2 pt-1">
          <Inp label={t('lbl_opmerking')} value={na.opmerking}
            onChange={v => setNa({...na, opmerking: v})} />
        </div>
        {naMetEtiket && fotoVeld(na.etiket_foto, b => setNa(n => ({...n, etiket_foto: b})))}
      </div>

      {/* Allergenen blijven blokkeren: dat is de reden dat CCP 3 bestaat. */}
      {naMetEtiket && na.product_id && !naEtiketBlok.toegestaan && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs space-y-1">
          <div>
            <span className="text-gray-500">{t('haccp_ccp3_volgens_recept')}: </span>
            {receptAllergenen.length
              ? receptAllergenen.map(allergeenLabel).join(', ')
              : t('haccp_ccp3_geen_allergenen')}
          </div>
          <div>
            <span className="text-gray-500">{t('haccp_ccp3_volgens_etiket')}: </span>
            {!naEtiket.gezet ? t('haccp_blok_etiket_onbekend')
              : naEtiket.allergenen.length
                ? naEtiket.allergenen.map(allergeenLabel).join(', ')
                : t('haccp_ccp3_geen_allergenen')}
          </div>
          {naEtiketBlok.redenen.filter(r => r.code !== 'etiket_onbekend').map((r, i) => (
            <div key={i} className="text-red-700 font-medium">
              ✗ {etiketRedenTekst(r, naVergelijking)}
            </div>
          ))}
          {/* Ook hier: het etiket bijwerken kan meteen, in de dialoog. */}
          {naProduct && etiketDienst && <div className="pt-1">{etiketBijwerkenKnop(naProduct)}</div>}
        </div>
      )}
      {/* Pas melden wat er ontbreekt zodra er iets is ingevuld — een leeg
          formulier (ook net na het vastleggen) hoort niet rood te staan. */}
      {(na.verpakking_id || na.product_id || na.hoeveelheid) && (
        <BlokkadeKaart blok={naBlok} compact />
      )}
      {/* De controles van de afvulling zelf: een fout zet de knop uit, een
          waarschuwing bevestig je in de knop (geen confirm()). */}
      {naControle?.fout && (na.verpakking_id || na.hoeveelheid) && (
        <div className="text-xs text-gray-600">{afvulMeldingTekst(naControle.fout, t)}</div>
      )}
      {naControle && !naControle.fout && naControle.waarschuwingen.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-sm text-orange-800 space-y-1">
          {naControle.waarschuwingen.map((w, i) => <div key={i}>{afvulMeldingTekst(w, t)}</div>)}
        </div>
      )}

      {/* Te veel koolzuur voor de fles: niet afvullen, of met een afwijking. */}
      {naVp && !naCo2Blok.toegestaan && naExtra.volumes != null && (
        <BlokkadeKaart blok={naCo2Blok} compact
          onAfwijking={naToegestaan && !naControle?.fout
            ? () => setAfwijking({blok: naCo2Blok, titel: t('haccp_co2_titel'), bron: 'sessie_start', actie: 'achteraf'})
            : undefined} />
      )}

      <div className="flex justify-end">
        {naControle && !naControle.fout && naControle.waarschuwingen.length > 0 && naToegestaan && naCo2Blok.toegestaan
          ? <BevestigKnop v="primary" s="sm" vraag={t('afvul_toch_vastleggen')} disabled={bezig}
              onBevestig={() => legAchterafVast(true)}>
              {t('haccp_achteraf_vastleggen')}
            </BevestigKnop>
          : <Btn s="sm" disabled={!naToegestaan || !naCo2Blok.toegestaan || bezig || !!naControle?.fout}
              onClick={() => legAchterafVast()}>
              {t('haccp_achteraf_vastleggen')}
            </Btn>}
      </div>
    </div>
  )

  // ── Houdtestflessen en kratkaart ─────────────────────────────────────────
  const zetHoudtestFlessen = (s: AfvulSessie) => {
    p.setSessies((prev: AfvulSessie[]) => (prev || []).map(x => x.id === s.id ? {...x, houdtest_flessen: true} : x))
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: s.id, actie: 'gewijzigd',
      omschrijving: `${s.lotcode}: ${houdtestFlessenTekst(kroonkurkVerplicht(s.verpakking_type, inst))}`,
    })
  }
  // De kratkaart: zolang het bier in quarantaine staat of het etiket nog
  // volgt, herkenbaar op het krat (lotcode, bier, THT, niet verkopen vóór …).
  const bierVoorSessie = (s: AfvulSessie): string => {
    const a = (p.av || []).find((x: any) => x.sessie_id === s.id && x.product_id)
    const id = a?.product_id ?? batchProduct
    return (p.producten || []).find((x: any) => x.id === Number(id))?.naam || p.batch?.naam || ''
  }
  const kratknop = (s: AfvulSessie) =>
    sessieHoudtestDagen(s) > 0 || sessieEtiketteren(s) === 'na_vrijgave' ? (
      <button type="button"
        onClick={() => printKratkaart(bouwKratkaart(s, {bier: bierVoorSessie(s),
          batchNummer: p.batch?.batch_nummer ?? p.batch?.id, afvullingen: p.av, stand: houdtest}))}
        className="min-h-tap sm:min-h-0 text-xs font-medium underline underline-offset-2 text-gray-600 hover:text-gray-800">
        {t('krat_printen')}
      </button>
    ) : null

  // ── Sessiekiezer ─────────────────────────────────────────────────────────
  // Loopt er meer dan één sessie (fust én fles), dan bepaalt deze rij in welke
  // sessie het afvulformulier en de CCP-panelen hieronder werken.
  const sessieKnoppen = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {openSessies.map(s => {
        const actief = s.id === sessie?.id
        return (
          <button key={s.id} type="button" onClick={() => p.setActieveSessieId?.(s.id)}
            title={actief ? t('haccp_sessie_actief') : t('haccp_sessie_kies')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              actief ? 't-btn-text border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            style={actief ? {background: 'var(--t-accent)'} : undefined}>
            <span className="font-mono">{s.lotcode}</span>
            <span className="ml-1 opacity-80">
              {s.verpakking_naam || s.verpakking_type || t('lbl_onbekend')}
              {' · '}
              {(p.av || []).filter((a: any) => a.sessie_id === s.id).length}×
            </span>
          </button>
        )
      })}
      <button type="button" onClick={() => setStartOpen(o => !o)}
        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">
        {startOpen ? t('btn_cancel') : `+ ${t('haccp_sessie_extra_verpakking')}`}
      </button>
    </div>
  )

  // ── Inhoud van de sessieregel ────────────────────────────────────────────
  const aantalVerpakt = sessie
    ? (p.av || []).filter((a: any) => a.sessie_id === sessie.id).length : 0
  const geslotenSessies = eigenSessies.filter(s => s.status !== 'open')

  const sessieInhoud = (
    <div className="space-y-3">
      {openSessies.length > 0 && sessieKnoppen}

      {sessie && (
        <div className="rounded-lg border-l-4 border-green-500 bg-gray-50 p-2.5 space-y-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-gray-500 flex items-baseline gap-2 flex-wrap">
              <span className="font-mono font-bold text-sm text-gray-800">{sessie.lotcode}</span>
              <span className="font-medium text-gray-600">
                {sessie.verpakking_naam || sessie.verpakking_type || t('lbl_onbekend')}
              </span>
              <span>{t('haccp_sessie_gestart')} {new Date(sessie.start).toLocaleTimeString()}</span>
              <span>· {t('haccp_sessie_tht')} {sessie.tht ? fmtD(sessie.tht) : t('haccp_sessie_bewaaradvies_tekst')}</span>
              {sessie.tht_reden && <span className="text-orange-600">· {sessie.tht_reden}</span>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {kratknop(sessie)}
              <BevestigKnop s="sm" v="ghost" vraag={t('haccp_sessie_afbreken_vraag')} onBevestig={breekAf}>
                {t('haccp_sessie_afbreken')}
              </BevestigKnop>
              <Btn s="sm" disabled={!afsluitBlok.toegestaan} onClick={sluitSessie}>
                {t('haccp_sessie_afsluiten')}
              </Btn>
            </div>
          </div>
          {(() => {
            const delen = [
              sessie.co2_volumes != null ? t('haccp_co2_kort').replace('{volumes}', fmtCo2(sessie.co2_volumes, getLang())) : '',
              sessie.sg_afvullen != null ? `${t('haccp_sg_afvullen')} ${fmtSg(sessie.sg_afvullen)}` : '',
              sessie.flessenlot ? `${t('haccp_flessenlot')} ${sessie.flessenlot}` : '',
              sessie.kroonkurkenlot ? `${t('haccp_kroonkurkenlot')} ${sessie.kroonkurkenlot}` : '',
            ].filter(Boolean)
            return delen.length ? <div className="text-xs text-gray-500 break-words">{delen.join(' · ')}</div> : null
          })()}
          {sessieIsFles && (
            <div className="pt-1">
              {klap.open ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Inp cls="w-36" label={t('haccp_klap_vernietigd')} type="number" step="1" min={0}
                    value={klap.vernietigd} onChange={v => setKlap(k => ({...k, vernietigd: v}))} />
                  <label className="flex items-start gap-2 text-sm text-gray-700 pb-2 max-w-sm">
                    <input type="checkbox" className="t-checkbox mt-0.5" checked={klap.gereinigd}
                      onChange={e => setKlap(k => ({...k, gereinigd: e.target.checked}))} />
                    {t('haccp_klap_gereinigd')}
                  </label>
                  <Btn s="sm" disabled={!klap.gereinigd} onClick={legKlapflesVast}>{t('haccp_klapfles_vastleggen')}</Btn>
                  <Btn s="sm" v="ghost" onClick={() => setKlap({open: false, vernietigd: '', gereinigd: false})}>{t('btn_cancel')}</Btn>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <button type="button" onClick={() => setKlap(k => ({...k, open: true}))}
                    className="min-h-tap sm:min-h-0 font-medium underline underline-offset-2 text-gray-600">
                    + {t('haccp_klapfles')}
                  </button>
                  {!!sessie.klapflessen?.aantal && (
                    <span>{t('haccp_klapflessen_stand').replace('{aantal}', String(sessie.klapflessen.aantal))
                      .replace('{vernietigd}', String(sessie.klapflessen.vernietigd))}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {houdtestFlessenNodig(sessie, p.sessies) && (
            <div className="pt-1">
              {houdtestFlessenVeld(false, v => { if (v) zetHoudtestFlessen(sessie) }, sessieIsFles)}
            </div>
          )}
          {/* Wat het afsluiten tegenhoudt is pas nieuws als er iets in de sessie
              zit; direct na het starten is die lijst alleen maar ruis. */}
          {!afsluitBlok.toegestaan && (aantalVerpakt > 0 || eigenControles.length > 0) && (
            <BlokkadeKaart blok={afsluitBlok} compact />
          )}
        </div>
      )}

      {(!openSessies.length || startOpen) && (() => {
        // Twee manieren om een sessie vast te leggen: achteraf in één keer
        // (de praktijk) of live meelopen. De keuze staat bovenaan het blok.
        const keuze = (
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg w-fit">
            {(['achteraf', 'live'] as const).map(m => (
              <button key={m} type="button" onClick={() => setModus(m)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  modus === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {t(m === 'achteraf' ? 'haccp_achteraf_titel' : 'haccp_sessie_live')}
              </button>
            ))}
          </div>
        )
        const inhoud = (
          <div className="space-y-3">
            {keuze}
            {modus === 'achteraf' ? achterafFormulier : startFormulier}
          </div>
        )
        return openSessies.length ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 space-y-2">
            <span className="text-sm font-semibold text-gray-700">{t('haccp_sessie_extra_verpakking')}</span>
            {inhoud}
          </div>
        ) : inhoud
      })()}

      {geslotenSessies.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-100">
          {geslotenSessies.map(s => (
            <div key={s.id} className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
              <span className="font-mono font-medium text-gray-700">{s.lotcode}</span>
              <span>{t(`haccp_sessie_${s.status}`)}</span>
              {s.verpakking_naam && <span>· {s.verpakking_naam}</span>}
              {s.tht && <span>· {t('haccp_sessie_tht')} {fmtD(s.tht)}</span>}
              <span>· {(p.av || []).filter((a: any) => a.sessie_id === s.id).length} {t('haccp_sessie_verpakkingen')}</span>
              {kratknop(s)}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── CCP 2 — sluitcontrole ────────────────────────────────────────────────
  const ccp2Inhoud = (
    <>
        <Sel label={t('haccp_ccp2_aanleiding')} value={sc.aanleiding}
          onChange={(v: string) => setSc({...sc, aanleiding: v as SluitControle['aanleiding']})}
          opts={SLUIT_AANLEIDINGEN.map(a => ({v: a.key, l: t(a.label)}))} />

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="t-checkbox" checked={sc.visueel_ok}
            onChange={e => setSc({...sc, visueel_ok: e.target.checked})} />
          {t('haccp_ccp2_visueel')}
        </label>
        {omkeerNodig && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={sc.omkeerproef_ok}
              onChange={e => setSc({...sc, omkeerproef_ok: e.target.checked})} />
            {t('haccp_ccp2_omkeerproef')}
          </label>
        )}
        {/* Kroonkurk: de twee fouten die niet vanzelf opvallen — een
            beschadigde flesmond en een systematisch te ruime of te strakke
            aankrulling — plus de maat die dat laatste aantoont. */}
        {kroonNodig && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={sc.flesmond_ok}
                onChange={e => setSc({...sc, flesmond_ok: e.target.checked})} />
              {t('haccp_ccp2_flesmond')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={sc.draaitest_ok}
                onChange={e => setSc({...sc, draaitest_ok: e.target.checked})} />
              {t('haccp_ccp2_draaitest')}
            </label>
          </>
        )}
        {sc.aanleiding === 'na_verstelling' && (
          <Inp label={t('haccp_ccp2_rolinstelling')} value={sc.rolinstelling}
            onChange={v => setSc({...sc, rolinstelling: v})} req />
        )}
        <Inp label={t('lbl_opmerking')} value={sc.opmerking}
          onChange={v => setSc({...sc, opmerking: v})} />

        {scBeoordeling.onvolledig.length > 0 && (
          <BlokkadeKaart blok={{toegestaan: false, redenen: scBeoordeling.onvolledig}} compact />
        )}

        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            scBeoordeling.resultaat === 'goedgekeurd'
              ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {t('haccp_ccp2_resultaat')}: {t(scBeoordeling.resultaat === 'goedgekeurd'
              ? 'haccp_ccp2_goedgekeurd' : 'haccp_ccp2_afgekeurd')}
          </span>
          <Btn s="sm" disabled={scBeoordeling.onvolledig.length > 0} onClick={slaSluitcontroleOp}>
            {t('haccp_ccp2_vastleggen')}
          </Btn>
        </div>

        {eigenControles.length > 0 ? (
          <div className="space-y-0.5 pt-1 border-t border-gray-100">
            {eigenControles.slice().reverse().map(c => (
              <div key={c.id} className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                <span>{new Date(c.paraaf.tijdstip).toLocaleTimeString()}</span>
                <span>{t(SLUIT_AANLEIDINGEN.find(a => a.key === c.aanleiding)?.label || '')}</span>
                <span className={c.resultaat === 'goedgekeurd' ? 'text-green-600' : 'text-red-600 font-medium'}>
                  {t(c.resultaat === 'goedgekeurd' ? 'haccp_ccp2_goedgekeurd' : 'haccp_ccp2_afgekeurd')}
                </span>
                {!!c.geblokkeerde_afvulling_ids?.length && (
                  <span className="text-red-600">
                    {t('haccp_ccp2_geblokkeerd').replace('{aantal}', String(c.geblokkeerde_afvulling_ids.length))}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400 italic">{t('haccp_ccp2_geen')}</div>
        )}
    </>
  )

  // ── CCP 2 — lege flessen (live) ──────────────────────────────────────────
  const flesInhoud = flesinspectie ? (
    <div className="text-sm text-gray-700">
      ✓ {t('haccp_flessen_bekeken')}
      {' · '}{flesinspectie.afgekeurd_aantal ?? 0} {t('haccp_afgekeurd_kort')}
      <span className="text-xs text-gray-500"> · {new Date(flesinspectie.paraaf.tijdstip).toLocaleTimeString()}</span>
    </div>
  ) : (
    <>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="t-checkbox mt-0.5" checked={fi.bekeken}
          onChange={e => setFi({...fi, bekeken: e.target.checked})} />
        <span>{t('haccp_flessen_bekeken')}</span>
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Inp label={t('haccp_afgekeurd')} type="number" step="1" min={0} value={fi.afgekeurd}
          onChange={v => setFi({...fi, afgekeurd: v})} />
      </div>
      <div className="text-xs text-gray-500">{t('haccp_afgekeurd_hint')}</div>
      <div className="flex justify-end">
        <Btn s="sm" disabled={fiRedenen.length > 0} onClick={slaFlesinspectieOp}>
          {t('haccp_flesinspectie_vastleggen')}
        </Btn>
      </div>
    </>
  )

  // ── CCP 3 — etiketcontrole ───────────────────────────────────────────────
  const ccp3Inhoud = (doel: AfvulSessie | null) => (
    <>
        <div className="grid sm:grid-cols-2 gap-2">
          {/* Sel zet zelf al een lege keuze bovenaan — geen tweede '—' erbij.
              Eén product per controle: het label in het enkelvoud. */}
          <Sel label={t('lbl_afvulling_product')} value={String(ec.product_id)}
            onChange={(v: string) => setEc({...ec, product_id: v})}
            ph={t('ph_select_product')} opts={productOpties(ec.product_id)} />
        </div>
        <Sel label={t('haccp_ccp2_aanleiding')} value={ec.aanleiding}
          onChange={(v: string) => setEc({...ec, aanleiding: v as EtiketControle['aanleiding']})}
          opts={ETIKET_AANLEIDINGEN.map(a => ({v: a.key, l: t(a.label)}))} />

        {/* De vergelijking die het meest voorkomende recallscenario ondervangt */}
        <div className={`rounded-lg border p-2.5 text-xs space-y-1 ${
          !ec.product_id ? 'border-gray-200 bg-gray-50'
            : etiketBlok.toegestaan ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="font-semibold text-gray-600">
            {t('haccp_ccp3_vergelijking')}
          </div>
          <div>
            <span className="text-gray-500">{t('haccp_ccp3_volgens_recept')}: </span>
            {receptAllergenen.length
              ? receptAllergenen.map(allergeenLabel).join(', ')
              : t('haccp_ccp3_geen_allergenen')}
          </div>
          <div>
            <span className="text-gray-500">{t('haccp_ccp3_volgens_etiket')}: </span>
            {!ec.product_id ? '—'
              : !etiketInfo.gezet ? t('haccp_blok_etiket_onbekend')
              : etiketInfo.allergenen.length
                ? etiketInfo.allergenen.map(allergeenLabel).join(', ')
                : t('haccp_ccp3_geen_allergenen')}
          </div>
          {ec.product_id && etiketBlok.toegestaan && (
            <div className="text-green-700 font-medium">✓ {t('haccp_ccp3_komt_overeen')}</div>
          )}
          {ec.product_id && !etiketBlok.toegestaan && (
            <>
              {/* 'etiket_onbekend' staat al op de etiketregel hierboven —
                  dezelfde zin twee keer onder elkaar leest als twee fouten. */}
              {etiketBlok.redenen.filter(r => r.code !== 'etiket_onbekend').map((r, i) => (
                <div key={i} className="text-red-700 font-medium">
                  ✗ {etiketRedenTekst(r, vergelijking)}
                </div>
              ))}
              {vergelijking.etiketOnbekend && (
                <div className="text-gray-500">{t('haccp_ccp3_product_instellen')}</div>
              )}
            </>
          )}
          {/* De blokkade oplossen waar hij optreedt: het etiket bijwerken in
              de dialoog. Zonder dit blijft "nog niet vastgelegd" een
              doodlopende weg midden in de afvulsessie. */}
          {!!ec.product_id && gekozenProduct && etiketDienst && (
            <div className="pt-1">{etiketBijwerkenKnop(gekozenProduct)}</div>
          )}
        </div>

        <div className="space-y-1">
          {([['lotcode_ok', 'haccp_ccp3_lotcode_ok'],
             ['tht_ok', 'haccp_ccp3_tht_ok'],
             ['alcohol_ok', 'haccp_ccp3_alcohol_ok']] as const).map(([veld, key]) => (
            <label key={veld} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={ec[veld]}
                onChange={e => setEc({...ec, [veld]: e.target.checked})} />
              {t(key)}
              {/* Het vinkje blijft handwerk: de app zet de getallen ernaast. */}
              {veld === 'alcohol_ok' && gekozenProduct && (
                <span className="text-xs text-gray-500">{abvRegel(gekozenProduct)}</span>
              )}
            </label>
          ))}
        </div>
        {fotoVeld(ec.foto, b => setEc(e => ({...e, foto: b})))}
        <Inp label={t('lbl_opmerking')} value={ec.opmerking}
          onChange={v => setEc({...ec, opmerking: v})} />

        <div className="flex items-center justify-end gap-2">
          {ec.product_id && !etiketBlok.toegestaan && !etiketOnvolledig && (
            <button
              onClick={() => setAfwijking({blok: etiketBlok, titel: t('haccp_ccp3_titel'), bron: 'ccp3_etiket', doel})}
              className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900">
              {t('haccp_afw_titel')}
            </button>
          )}
          <Btn s="sm" disabled={etiketOnvolledig || !etiketBlok.toegestaan}
            onClick={() => slaEtiketOp(doel)}>
            {t('haccp_ccp3_vastleggen')}
          </Btn>
        </div>

        {etiketVan(doel).length > 0 ? (
          <div className="space-y-0.5 pt-1 border-t border-gray-100">
            {etiketVan(doel).slice().reverse().map(e => (
              <div key={e.id} className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                <span>{new Date(e.paraaf.tijdstip).toLocaleTimeString()}</span>
                <span>{(p.producten || []).find((x: any) => x.id === e.product_id)?.naam || ''}</span>
                <span className={e.resultaat === 'goedgekeurd' ? 'text-green-600' : 'text-red-600 font-medium'}>
                  {t(e.resultaat === 'goedgekeurd' ? 'haccp_ccp2_goedgekeurd' : 'haccp_ccp2_afgekeurd')}
                </span>
                {e.afwijking_id != null && (
                  <span className="text-orange-600">{t('haccp_afw_kort')}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400 italic">{t('haccp_ccp3_geen')}</div>
        )}
    </>
  )

  // ── Etiketteren na de vrijgave ───────────────────────────────────────────
  // CCP 3 per lotcode die nog op zijn etiket wacht — pas na de houdtest.
  const naVrijgaveSessies = eigenSessies.filter(s =>
    sessieEtiketteren(s) === 'na_vrijgave' && s.status !== 'afgebroken')
  const etiketterenInhoud = houdtest?.stand === 'quarantaine' ? (
    <div className="text-sm text-gray-600">
      {t('haccp_etiketteren_wacht').replace('{datum}', fmtD(houdtest.klaar_op))}
    </div>
  ) : houdtest?.stand === 'afgekeurd' ? (
    <div className="text-sm text-red-700">{t('haccp_etiketteren_afgekeurd')}</div>
  ) : !teEtiket.length || !etiketDoel ? (
    <div className="text-sm text-gray-700">✓ {t('haccp_etiketteren_klaar')}</div>
  ) : (
    <div className="space-y-3">
      {teEtiket.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {teEtiket.map(x => {
            const actief = x.sessie.id === etiketDoel.id
            return (
              <button key={x.sessie.id} type="button" onClick={() => setEtiketSessieId(x.sessie.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  actief ? 't-btn-text border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                style={actief ? {background: 'var(--t-accent)'} : undefined}>
                <span className="font-mono">{x.sessie.lotcode}</span>
                <span className="ml-1 opacity-80">{x.sessie.verpakking_naam || x.sessie.verpakking_type || ''}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="text-sm text-gray-700">
        {t('haccp_etiketteren_uitleg')
          .replace('{lotcode}', etiketDoel.lotcode)
          .replace('{n}', String(teEtiket.find(x => x.sessie.id === etiketDoel.id)?.aantal ?? 0))
          .replace('{verpakking}', etiketDoel.verpakking_naam || etiketDoel.verpakking_type || '')}
      </div>
      {ccp3Inhoud(etiketDoel)}
    </div>
  )

  // ── De checklist ─────────────────────────────────────────────────────────
  // Alles wat bij afvullen hoort staat als één lijst onder elkaar: de CCP's
  // zijn regels, geen aparte blokken. Ze verschijnen zodra er een sessie loopt
  // — zonder sessie valt er niets te controleren.
  const mijnAv = (p.av || []).filter((a: any) => a.batch_id === p.batch?.id)
  const avLiter = mijnAv.reduce((s: number, a: any) =>
    s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
  const sessieSoort = sessie ? sessieCcp2(sessie) : null
  const ccp2Ok = sessieSoort === 'geen' ? true
    : sessieSoort === 'lege_flessen' ? !!flesinspectie
    : eigenControles.some(c => c.aanleiding === 'start' && c.resultaat === 'goedgekeurd')
      && !herinnering?.due
  const laatsteControle = eigenControles.length
    ? new Date(eigenControles[eigenControles.length - 1].paraaf.tijdstip).toLocaleTimeString()
    : null

  const regels: Array<{
    key: string; titel: string; status: RegelStatus; detail?: React.ReactNode; inhoud: React.ReactNode
  } | null> = [
    p.taken ? {
      key: 'taken', titel: t('flow_chk_hygiene'),
      status: p.takenDone ? 'done' : 'open', detail: p.takenDetail, inhoud: p.taken,
    } : null,
    {
      key: 'sessie', titel: t('haccp_chk_sessie'),
      status: openSessies.length ? 'open' : eigenSessies.length ? 'done' : 'open',
      detail: openSessies.length
        ? openSessies.map(s => s.lotcode).join(', ')
        : geslotenSessies.map(s => s.lotcode).join(', ') || undefined,
      inhoud: sessieInhoud,
    },
    sessie && sessieSoort === 'lege_flessen' ? {
      key: 'ccp2', titel: t('haccp_flesinspectie_titel'),
      status: ccp2Ok ? 'done' : 'open',
      detail: flesinspectie ? `${flesinspectie.afgekeurd_aantal ?? 0} ${t('haccp_afgekeurd_kort')}` : undefined,
      inhoud: flesInhoud,
    } : null,
    sessie && sessieSoort === 'sluitcontrole' ? {
      key: 'ccp2', titel: t('haccp_ccp2_titel'),
      status: ccp2Ok ? 'done' : 'open',
      detail: herinnering?.due
        ? t('haccp_ccp2_due').replace('{minuten}', String(herinnering.minutenSinds))
        : laatsteControle
          ? `${laatsteControle} · ${t('haccp_ccp2_volgende').replace('{minuten}', String(herinnering?.volgendeOverMin ?? 0))}`
          : undefined,
      inhoud: ccp2Inhoud,
    } : null,
    sessie && sessieEtiketteren(sessie) === 'afvullen' ? {
      key: 'ccp3', titel: t('haccp_ccp3_titel'),
      status: eigenEtiket.length ? 'done' : 'open',
      detail: eigenEtiket.length ? `${eigenEtiket.length}×` : undefined,
      inhoud: ccp3Inhoud(sessie),
    } : null,
    {
      key: 'afvullen', titel: t('flow_chk_afvulling'),
      status: mijnAv.length ? 'done' : 'open',
      detail: mijnAv.length ? `${mijnAv.length} — ${avLiter.toFixed(1)} L` : undefined,
      inhoud: (
        <div className="space-y-3">
          {p.registratie && (sessie || p.registratieZonderSessie) && p.registratie}
          {p.lijst}
        </div>
      ),
    },
    p.verlies ? {
      key: 'verlies', titel: t('flow_chk_restvolume'),
      status: p.verliesDone ? 'done' : 'optioneel', detail: p.verliesDetail, inhoud: p.verlies,
    } : null,
    // Na het afvullen: de houdtest en de vrijgave voor verkoop…
    houdtest && p.setVerkoopvrijgaven ? {
      key: 'houdtest', titel: t('haccp_houdtest_titel'),
      status: houdtest.stand === 'quarantaine' ? 'open' : 'done',
      detail: houdtest.stand === 'vrijgegeven' ? t('haccp_houdtest_vrijgegeven')
        : houdtest.stand === 'afgekeurd' ? t('haccp_houdtest_afgekeurd')
        : t('haccp_houdtest_vanaf').replace('{datum}', fmtD(houdtest.klaar_op)),
      inhoud: (
        <HoudtestSectie batch={p.batch} stand={houdtest}
          bronLotcode={eigenSessies.find(s => s.houdtest_flessen)?.lotcode}
          verkoopvrijgaven={p.verkoopvrijgaven || []} setVerkoopvrijgaven={p.setVerkoopvrijgaven}
          setAv={p.setAv} capa={p.capa} setCapa={p.setCapa}
          afwijkingen={p.afwijkingen} setAfwijkingen={p.setAfwijkingen}
          haccpInstellingen={p.haccpInstellingen} whoami={p.whoami}
          auditLog={p.auditLog} setAuditLog={p.setAuditLog} />
      ),
    } : null,
    // …en daarna het etiket (etiketteren na de vrijgave).
    naVrijgaveSessies.length ? {
      key: 'etiketteren', titel: t('haccp_etiketteren_titel'),
      status: teEtiket.length || houdtest?.stand === 'quarantaine' ? 'open' : 'done',
      detail: teEtiket.length ? teEtiket.map(x => x.sessie.lotcode).join(', ') : undefined,
      inhoud: etiketterenInhoud,
    } : null,
  ]
  const zichtbaar = regels.filter(Boolean) as Exclude<(typeof regels)[number], null>[]

  // Welke regel staat open zonder eigen keuze: draait er een sessie waarvan de
  // controles staan, dan is afvullen de handeling die je herhaalt. Anders de
  // eerste regel die nog niet af is.
  // De lege flessen bekijk je tijdens het vullen; die registratie hoort bij
  // het afsluiten, dus hij houdt het afvullen niet tegen.
  const autoRegel = sessie && (ccp2Ok || sessieSoort === 'lege_flessen')
    && (eigenEtiket.length || sessieEtiketteren(sessie) === 'na_vrijgave')
    ? 'afvullen'
    : zichtbaar.find(r => r.status === 'open')?.key || ''

  return (
    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
      {zichtbaar.map(r => (
        <Regel key={r.key} titel={r.titel} status={r.status} detail={r.detail}
          open={(openRegel ?? autoRegel) === r.key}
          onToggle={() => setOpenRegel(k => (k ?? autoRegel) === r.key ? '' : r.key)}>
          {r.inhoud}
        </Regel>
      ))}

      {afwijking && (
        <AfwijkingModal blok={afwijking.blok} titel={afwijking.titel}
          onBevestig={bevestigAfwijking} onClose={() => setAfwijking(null)} />
      )}
    </div>
  )
}

export default AfvulSessieSectie
