import React from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { fmtD, tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import {
  SLUIT_AANLEIDINGEN, ETIKET_AANLEIDINGEN, THT_KLASSE_LABEL_KEY, ALLERGENEN_LIJST,
} from '../../utils/constants'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'
import BlokkadeKaart, { blokkadeSamenvatting } from '../haccp/BlokkadeKaart'
import AfwijkingModal from '../haccp/AfwijkingModal'
import {
  maakParaaf, haccpInst, risicoVoorBatch, omkeerproefVerplicht,
  kroonkurkVerplicht,
  beoordeelSluitcontrole, afvullingenSindsLaatsteGoedkeuring, magSessieAfsluiten,
  sluitcontroleHerinnering, allergenenUitBatch, allergenenVanProduct,
  vergelijkAllergenen, magEtiketterenDoorgaan, bouwAfwijking, capaUitAfwijking,
} from '../../utils/haccp'
import {
  volgendSessieNr, lotcodeVoorSessie, lotcodeIsUniek, thtKlasseVoorBatch,
  berekenTht, openSessiesVoorBatch, actieveSessie, magSessieStarten,
  verwachteControleMomenten, controleDekking,
} from '../../utils/afvulsessie'
import type { AfvulSessie, SluitControle, EtiketControle } from '../../types'

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
  av: any[]
  setAv: (fn: any) => void
  producten: any[]
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
   *  voorcalculatie, logregels). Gebruikt door het achteraf vastleggen. */
  onAchterafAfvullen?: (velden: any, sessie: AfvulSessie) => boolean
  /** Hygiënetaken van de fase — als regel in dezelfde checklist. */
  taken?: React.ReactNode
  takenDone?: boolean
  takenDetail?: React.ReactNode
  /** Verlies-/restvolumeformulier — als laatste regel in dezelfde checklist. */
  verlies?: React.ReactNode
  verliesDone?: boolean
  verliesDetail?: React.ReactNode
}

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
  etiket_versie: '',
  opmerking: '',
  // Tijdstippen van de controles tussen start en eind. Leeg laten mag; het
  // formulier meldt dan hoeveel er volgens het halfuurritme ontbreken. Zelf
  // aanvullen zou controles verzinnen die niemand heeft gedaan.
  tussen: [] as string[],
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
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
        status === 'done' ? 'bg-green-100 text-green-700 ring-1 ring-green-200'
          : status === 'optioneel' ? 'bg-gray-100 text-gray-400'
          : 'bg-orange-100 text-orange-600 ring-1 ring-orange-200'}`}>
        {status === 'done' ? '✓' : status === 'optioneel' ? '·' : '○'}
      </span>
      <span className="text-sm font-semibold text-gray-700 flex-1 min-w-0">{titel}</span>
      {detail != null && detail !== '' && (
        <span className="text-xs text-gray-400 flex-shrink-0">{detail}</span>
      )}
      <span className={`text-gray-300 text-[10px] flex-shrink-0 transition-transform ${
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
  // Startformulier voor een extra verpakking naast de lopende sessie(s).
  const [startOpen, setStartOpen] = React.useState(false)
  // Achteraf vastleggen is de normale gang van zaken — tijdens het afvullen
  // heb je je handen vol. Live meelopen kan, maar is de tweede keuze.
  const [modus, setModus] = React.useState<'achteraf' | 'live'>('achteraf')
  const [na, setNa] = React.useState({...leegNa, datum: tod()})
  const [nu, setNu] = React.useState(() => new Date())
  const [afwijking, setAfwijking] = React.useState<{blok: any; titel: string; bron: any} | null>(null)
  // Eén regel tegelijk open. Zonder eigen keuze staat de regel open die aan de
  // beurt is (zie `autoRegel` hieronder); '' betekent: alles dicht.
  const [openRegel, setOpenRegel] = React.useState<string | null>(null)

  // Klok voor de halfuur-herinnering tijdens een lopende sessie.
  React.useEffect(() => {
    if (!sessie) return
    const id = setInterval(() => setNu(new Date()), 30000)
    return () => clearInterval(id)
  }, [sessie?.id])

  const risico = React.useMemo(
    () => risicoVoorBatch(p.batch, p.bi || [], p.ing || [], inst),
    [p.batch, p.bi, p.ing, p.haccpInstellingen])

  // ── Sessie starten ───────────────────────────────────────────────────────
  const [start, setStart] = React.useState({
    verpakking_id: '' as string | number,
    reiniging_bevestigd: false,
    tht_handmatig: false,
    tht: '',
    tht_reden: '',
  })

  const gekozenVp = (p.verpakkingen || []).find((v: any) => v.id === Number(start.verpakking_id))
  const thtKlasse = thtKlasseVoorBatch(p.batch?.ABV, risico, inst)
  const thtBerekend = berekenTht(tod(), thtKlasse, inst)
  const startBlok = magSessieStarten(p.batch?.id, p.vrijgaven || [], {
    reiniging_bevestigd: start.reiniging_bevestigd,
    verpakking_id: start.verpakking_id ? Number(start.verpakking_id) : null,
  }, p.sessies || [])
  const thtRedenNodig = start.tht_handmatig && !start.tht_reden.trim()

  const startSessie = () => {
    if (!startBlok.toegestaan || thtRedenNodig) return
    const nr = volgendSessieNr(p.sessies || [], p.batch.id)
    let code = lotcodeVoorSessie(p.batch, nr)
    // Twee tabbladen kunnen tegelijk starten; de lotcode moet uniek blijven.
    let extra = nr
    while (!lotcodeIsUniek(code, p.sessies || [])) {
      extra += 1
      code = lotcodeVoorSessie(p.batch, extra)
    }
    const paraaf = maakParaaf(p.whoami)
    const id = newId(p.sessies || [])
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
    }
    p.setSessies((prev: AfvulSessie[]) => [...(prev || []), record])
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'AfvulSessie', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${p.batch?.naam || ''}: ${code}`,
    })
    // De net gestarte sessie is de sessie waarin je gaat afvullen.
    p.setActieveSessieId?.(id)
    setStartOpen(false)
    setStart({verpakking_id: '', reiniging_bevestigd: false, tht_handmatig: false, tht: '', tht_reden: ''})
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

  // ── CCP 3 — etiketcontrole ───────────────────────────────────────────────
  const eigenEtiket = (p.etiketcontroles || []).filter(e => e.sessie_id === sessie?.id)
  const [ec, setEc] = React.useState({
    product_id: '' as string | number,
    etiket_versie: '',
    aanleiding: 'start' as EtiketControle['aanleiding'],
    lotcode_ok: false,
    tht_ok: false,
    alcohol_ok: false,
    opmerking: '',
  })
  const gekozenProduct = (p.producten || []).find((x: any) => x.id === Number(ec.product_id))
  const receptAllergenen = React.useMemo(
    () => allergenenUitBatch(p.batch?.id, p.bi || [], p.ing || []),
    [p.batch, p.bi, p.ing])
  const etiketInfo = allergenenVanProduct(gekozenProduct)
  const vergelijking = vergelijkAllergenen(receptAllergenen, etiketInfo.allergenen, etiketInfo.gezet)
  const etiketBlok = magEtiketterenDoorgaan(vergelijking)
  const etiketOnvolledig = !ec.product_id || !ec.lotcode_ok || !ec.tht_ok || !ec.alcohol_ok
  const allergeenLabel = (a: string) =>
    t(ALLERGENEN_LIJST.find(x => x.key === a)?.label || a)

  const slaEtiketOp = (afwijkingId?: number) => {
    if (!sessie || etiketOnvolledig) return
    const paraaf = maakParaaf(p.whoami)
    const id = newId(p.etiketcontroles || [])
    const record: EtiketControle = {
      id,
      sessie_id: sessie.id,
      batch_id: p.batch.id,
      product_id: Number(ec.product_id),
      etiket_artikel: gekozenProduct?.etiket_artikel,
      etiket_versie: ec.etiket_versie.trim() || gekozenProduct?.etiket_versie,
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
      paraaf,
    }
    p.setEtiketcontroles((prev: EtiketControle[]) => [...(prev || []), record])
    logAudit(p.auditLog, p.setAuditLog, {
      entiteit: 'EtiketControle', entiteit_id: id, actie: 'aangemaakt',
      omschrijving: `${sessie.lotcode}: ${gekozenProduct?.naam || ''}`,
    })
    setEc(e => ({...e, aanleiding: 'rolwissel', lotcode_ok: false, tht_ok: false,
                 alcohol_ok: false, opmerking: ''}))
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
    setEc(e => ({...e, aanleiding: 'start', etiket_versie: '', lotcode_ok: false,
                 tht_ok: false, alcohol_ok: false, opmerking: ''}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessie?.id])

  // ── Sessie afsluiten ─────────────────────────────────────────────────────
  const afsluitBlok = sessie
    ? magSessieAfsluiten(sessie, eigenControles, eigenEtiket, p.capa || [])
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

  const breekAf = () => {
    if (!sessie || !confirm(t('haccp_sessie_afbreken_vraag'))) return
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
      {batch_id: p.batch.id, sessie_id: sessie?.id},
      onderbouwing, blokkadeSamenvatting(afwijking.blok), paraaf)
    if (!rec) return
    const capaId = newId(p.capa || [])
    p.setAfwijkingen((prev: any[]) => [...(prev || []), {...rec, capa_id: capaId}])
    p.setCapa((prev: any[]) => [...(prev || []),
      {...capaUitAfwijking(rec, capaId), bron: afwijking.bron === 'ccp3_etiket' ? 'ccp3' : 'afwijking'}])
    const bron = afwijking.bron
    setAfwijking(null)
    if (bron === 'ccp3_etiket') slaEtiketOp(afwId)
  }

  const Label = ({children}: {children: React.ReactNode}) => (
    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{children}</div>
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
              {lotcodeVoorSessie(p.batch, volgendSessieNr(p.sessies || [], p.batch?.id))}
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
                onChange={v => setStart({...start, tht: v})} />
              <Inp label={t('haccp_sessie_tht_reden')} value={start.tht_reden}
                onChange={v => setStart({...start, tht_reden: v})} req />
            </div>
          )}
          {thtRedenNodig && (
            <div className="text-xs text-red-600">{t('haccp_sessie_tht_reden_verplicht')}</div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="t-checkbox" checked={start.reiniging_bevestigd}
            onChange={e => setStart({...start, reiniging_bevestigd: e.target.checked})} />
          {t('haccp_sessie_reiniging')}
        </label>

        <BlokkadeKaart blok={startBlok} compact />

        <div className="flex justify-end">
          <Btn s="sm" disabled={!startBlok.toegestaan || thtRedenNodig} onClick={startSessie}>
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
  }, p.sessies || [])
  const naThtKlasse = thtKlasse
  const naTht = berekenTht(na.datum || tod(), naThtKlasse, inst)
  const naCompleet = !!na.product_id && Number(na.hoeveelheid) > 0
    && na.visueel_ok && (!naOmkeerNodig || na.omkeerproef_ok)
    && (!naKroonNodig || (na.flesmond_ok && na.draaitest_ok))
    && naBeoordeling.onvolledig.length === 0
    // Een afkeuring hoort niet achteraf en losstaand: daar horen een
    // corrigerende maatregel en een blokkade van de betrokken verpakkingen
    // bij, en die lopen via de gewone sluitcontrole.
    && naBeoordeling.resultaat === 'goedgekeurd'
    && na.lotcode_ok && na.tht_ok && na.alcohol_ok
  const naToegestaan = naBlok.toegestaan && naCompleet && naEtiketBlok.toegestaan

  const legAchterafVast = () => {
    if (!naToegestaan || !naVp) return
    const paraaf = maakParaaf(p.whoami)
    const datum = na.datum || tod()
    const startMoment = `${datum}T${na.van || '12:00'}:00`
    const eindMoment = `${datum}T${na.tot || na.van || '12:00'}:00`

    // Sessie — meteen afgesloten: het afvullen is al gebeurd.
    const nr = volgendSessieNr(p.sessies || [], p.batch.id)
    let code = lotcodeVoorSessie(p.batch, nr)
    let extra = nr
    while (!lotcodeIsUniek(code, p.sessies || [])) {
      extra += 1
      code = lotcodeVoorSessie(p.batch, extra)
    }
    const sessieId = newId(p.sessies || [])
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
    const tussenControles = na.tussen
      .filter(Boolean)
      .map(tijd => bouwControle('halfuur', `${datum}T${tijd}:00`))
    p.setSluitcontroles((prev: SluitControle[]) => [...(prev || []),
      bouwControle('start', startMoment), ...tussenControles,
      bouwControle('einde', eindMoment)])

    // CCP 3 — etiketcontrole met dezelfde allergenenvergelijking als live.
    const etiketId = newId(p.etiketcontroles || [])
    p.setEtiketcontroles((prev: EtiketControle[]) => [...(prev || []), {
      id: etiketId,
      sessie_id: sessieId,
      batch_id: p.batch.id,
      product_id: Number(na.product_id),
      etiket_artikel: naProduct?.etiket_artikel,
      etiket_versie: na.etiket_versie.trim() || naProduct?.etiket_versie,
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
      paraaf,
    }])

    // De afvulling zelf loopt via de pagina: die kent voorraad, accijns en logs.
    p.onAchterafAfvullen?.({
      product_id: Number(na.product_id),
      verpakking_id: Number(na.verpakking_id),
      verpakking_type: naVp.naam,
      inhoud_per_eenheid: Number(naVp.inhoud_liter || 0),
      hoeveelheid: Number(na.hoeveelheid),
      datum,
      tijd: na.tot || na.van || '',
      tht: naTht.tht,
      gn_code: '',
    }, sessieRec)
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
          opts={(p.producten || [])
            .filter((x: any) => x.status !== 'gearchiveerd')
            .map((x: any) => ({v: String(x.id), l: x.naam}))} />
        <Sel label={t('lbl_packaging')} value={String(na.verpakking_id)}
          onChange={(v: string) => setNa({...na, verpakking_id: v})}
          opts={(p.verpakkingen || []).map((v: any) => ({v: String(v.id), l: v.naam}))} />
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
            {lotcodeVoorSessie(p.batch, volgendSessieNr(p.sessies || [], p.batch?.id))}
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
        {([['lotcode_ok', 'haccp_ccp3_lotcode_ok'],
           ['tht_ok', 'haccp_ccp3_tht_ok'],
           ['alcohol_ok', 'haccp_ccp3_alcohol_ok']] as const).map(([veld, key]) => (
          <label key={veld} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="t-checkbox" checked={na[veld]}
              onChange={e => setNa({...na, [veld]: e.target.checked})} />
            {t(key)}
          </label>
        ))}
        <div className="grid sm:grid-cols-2 gap-2 pt-1">
          <Inp label={t('haccp_ccp3_etiket_versie')}
            value={na.etiket_versie || naProduct?.etiket_versie || ''}
            onChange={v => setNa({...na, etiket_versie: v})} />
          <Inp label={t('lbl_opmerking')} value={na.opmerking}
            onChange={v => setNa({...na, opmerking: v})} />
        </div>
      </div>

      {/* Allergenen blijven blokkeren: dat is de reden dat CCP 3 bestaat. */}
      {na.product_id && !naEtiketBlok.toegestaan && (
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
          {naEtiketBlok.redenen.map((r, i) => (
            <div key={i} className="text-red-700 font-medium">✗ {t(r.i18nKey)}</div>
          ))}
        </div>
      )}
      {/* Pas melden wat er ontbreekt zodra er iets is ingevuld — een leeg
          formulier (ook net na het vastleggen) hoort niet rood te staan. */}
      {(na.verpakking_id || na.product_id || na.hoeveelheid) && (
        <BlokkadeKaart blok={naBlok} compact />
      )}

      <div className="flex justify-end">
        <Btn s="sm" disabled={!naToegestaan} onClick={legAchterafVast}>
          {t('haccp_achteraf_vastleggen')}
        </Btn>
      </div>
    </div>
  )

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
              actief ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
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
            <div className="flex gap-2">
              <Btn s="sm" v="ghost" onClick={breekAf}>{t('haccp_sessie_afbreken')}</Btn>
              <Btn s="sm" disabled={!afsluitBlok.toegestaan} onClick={sluitSessie}>
                {t('haccp_sessie_afsluiten')}
              </Btn>
            </div>
          </div>
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

  // ── CCP 3 — etiketcontrole ───────────────────────────────────────────────
  const ccp3Inhoud = (
    <>
        <div className="grid sm:grid-cols-2 gap-2">
          <Sel label={t('nav_producten')} value={String(ec.product_id)}
            onChange={(v: string) => setEc({...ec, product_id: v})}
            opts={[{v: '', l: '—'}, ...(p.producten || []).map((x: any) => ({v: String(x.id), l: x.naam}))]} />
          <Inp label={t('haccp_ccp3_etiket_versie')}
            value={ec.etiket_versie || gekozenProduct?.etiket_versie || ''}
            onChange={v => setEc({...ec, etiket_versie: v})} />
        </div>
        <Sel label={t('haccp_ccp2_aanleiding')} value={ec.aanleiding}
          onChange={(v: string) => setEc({...ec, aanleiding: v as EtiketControle['aanleiding']})}
          opts={ETIKET_AANLEIDINGEN.map(a => ({v: a.key, l: t(a.label)}))} />

        {/* De vergelijking die het meest voorkomende recallscenario ondervangt */}
        <div className={`rounded-lg border p-2.5 text-xs space-y-1 ${
          !ec.product_id ? 'border-gray-200 bg-gray-50'
            : etiketBlok.toegestaan ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="font-semibold text-gray-600 uppercase tracking-wide">
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
              {etiketBlok.redenen.map((r, i) => (
                <div key={i} className="text-red-700 font-medium">
                  {r.code === 'allergeen_ontbreekt'
                    ? `✗ ${t('haccp_blok_allergeen_ontbreekt').replace('{allergenen}',
                        vergelijking.ontbreektOpEtiket.map(allergeenLabel).join(', '))}`
                    : r.code === 'allergeen_teveel'
                    ? `✗ ${t('haccp_blok_allergeen_teveel').replace('{allergenen}',
                        vergelijking.teveelOpEtiket.map(allergeenLabel).join(', '))}`
                    : `✗ ${t(r.i18nKey)}`}
                </div>
              ))}
              {vergelijking.etiketOnbekend && (
                <div className="text-gray-500">{t('haccp_ccp3_product_instellen')}</div>
              )}
            </>
          )}
        </div>

        <div className="space-y-1">
          {([['lotcode_ok', 'haccp_ccp3_lotcode_ok'],
             ['tht_ok', 'haccp_ccp3_tht_ok'],
             ['alcohol_ok', 'haccp_ccp3_alcohol_ok']] as const).map(([veld, key]) => (
            <label key={veld} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="t-checkbox" checked={ec[veld]}
                onChange={e => setEc({...ec, [veld]: e.target.checked})} />
              {t(key)}
            </label>
          ))}
        </div>
        <Inp label={t('lbl_opmerking')} value={ec.opmerking}
          onChange={v => setEc({...ec, opmerking: v})} />

        <div className="flex items-center justify-end gap-2">
          {ec.product_id && !etiketBlok.toegestaan && !etiketOnvolledig && (
            <button
              onClick={() => setAfwijking({blok: etiketBlok, titel: t('haccp_ccp3_titel'), bron: 'ccp3_etiket'})}
              className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900">
              {t('haccp_afw_titel')}
            </button>
          )}
          <Btn s="sm" disabled={etiketOnvolledig || !etiketBlok.toegestaan}
            onClick={() => slaEtiketOp()}>
            {t('haccp_ccp3_vastleggen')}
          </Btn>
        </div>

        {eigenEtiket.length > 0 ? (
          <div className="space-y-0.5 pt-1 border-t border-gray-100">
            {eigenEtiket.slice().reverse().map(e => (
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

  // ── De checklist ─────────────────────────────────────────────────────────
  // Alles wat bij afvullen hoort staat als één lijst onder elkaar: de CCP's
  // zijn regels, geen aparte blokken. Ze verschijnen zodra er een sessie loopt
  // — zonder sessie valt er niets te controleren.
  const mijnAv = (p.av || []).filter((a: any) => a.batch_id === p.batch?.id)
  const avLiter = mijnAv.reduce((s: number, a: any) =>
    s + (Number(a.inhoud_per_eenheid ?? a.inhoud_liter) || 0) * (Number(a.hoeveelheid) || 0), 0)
  const ccp2Ok = eigenControles.some(c => c.aanleiding === 'start' && c.resultaat === 'goedgekeurd')
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
    sessie ? {
      key: 'ccp2', titel: t('haccp_ccp2_titel'),
      status: ccp2Ok ? 'done' : 'open',
      detail: herinnering?.due
        ? t('haccp_ccp2_due').replace('{minuten}', String(herinnering.minutenSinds))
        : laatsteControle
          ? `${laatsteControle} · ${t('haccp_ccp2_volgende').replace('{minuten}', String(herinnering?.volgendeOverMin ?? 0))}`
          : undefined,
      inhoud: ccp2Inhoud,
    } : null,
    sessie ? {
      key: 'ccp3', titel: t('haccp_ccp3_titel'),
      status: eigenEtiket.length ? 'done' : 'open',
      detail: eigenEtiket.length ? `${eigenEtiket.length}×` : undefined,
      inhoud: ccp3Inhoud,
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
  ]
  const zichtbaar = regels.filter(Boolean) as Exclude<(typeof regels)[number], null>[]

  // Welke regel staat open zonder eigen keuze: draait er een sessie waarvan de
  // controles staan, dan is afvullen de handeling die je herhaalt. Anders de
  // eerste regel die nog niet af is.
  const autoRegel = sessie && ccp2Ok && eigenEtiket.length
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
