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
  beoordeelSluitcontrole, afvullingenSindsLaatsteGoedkeuring, magSessieAfsluiten,
  sluitcontroleHerinnering, allergenenUitBatch, allergenenVanProduct,
  vergelijkAllergenen, magEtiketterenDoorgaan, bouwAfwijking, capaUitAfwijking,
} from '../../utils/haccp'
import {
  volgendSessieNr, lotcodeVoorSessie, lotcodeIsUniek, thtKlasseVoorBatch,
  berekenTht, openSessieVoorBatch, magSessieStarten,
} from '../../utils/afvulsessie'
import type { AfvulSessie, SluitControle, EtiketControle } from '../../types'

// De afvulsessie is het anker voor CCP 2 en CCP 3: één afvulmoment met een
// eigen lotcode (L2431-B1), zodat bij een sluitprobleem alleen die sessie
// teruggehaald hoeft te worden in plaats van de hele batch.
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
  /** Afvulregistratieformulier — alleen zinvol binnen een lopende sessie. */
  registratie?: React.ReactNode
  /** Toon de registratie óók zonder open sessie. Alleen voor legacy-batches:
   *  die zijn begonnen vóór het sessiesysteem en kennen de blokkade niet. */
  registratieZonderSessie?: boolean
  /** Lijst met geregistreerde afvullingen; altijd zichtbaar. */
  lijst?: React.ReactNode
}

// Inklapbaar deelblok binnen de sessie. Zelfde vormtaal als de FlowStap-kaarten
// eromheen, zodat de sessie niet als een tweede soort pagina aanvoelt.
const Paneel: React.FC<{
  titel: React.ReactNode
  info?: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}> = ({titel, info, open, onToggle, children}) => (
  <div className="rounded-lg border border-gray-200 overflow-hidden">
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors">
      <span className="text-sm font-semibold text-gray-700 flex-1 min-w-0">{titel}</span>
      {info}
      <span className={`text-gray-300 text-[10px] flex-shrink-0 transition-transform ${
        open ? 'rotate-90' : ''}`}>▶</span>
    </button>
    {open && <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">{children}</div>}
  </div>
)

const AfvulSessieSectie: React.FC<Props> = (p) => {
  const inst = haccpInst(p.haccpInstellingen)
  const sessie = openSessieVoorBatch(p.sessies || [], p.batch?.id)
  const eigenSessies = (p.sessies || []).filter(s => s.batch_id === p.batch?.id)
  const [nu, setNu] = React.useState(() => new Date())
  const [afwijking, setAfwijking] = React.useState<{blok: any; titel: string; bron: any} | null>(null)
  // Tijdens het afvullen is de registratie de handeling die je herhaalt; de
  // CCP-panelen klappen daarom vanzelf dicht zodra hun startcontrole er staat.
  // De sleutel bevat het sessie-id, zodat een nieuwe sessie weer opengaat.
  const [paneelHand, setPaneelHand] = React.useState<Record<string, boolean>>({})
  const paneelOpen = (id: string, auto: boolean) => paneelHand[id] ?? auto
  const togglePaneel = (id: string, auto: boolean) =>
    setPaneelHand(h => ({...h, [id]: !(h[id] ?? auto)}))

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
    setStart({verpakking_id: '', reiniging_bevestigd: false, tht_handmatig: false, tht: '', tht_reden: ''})
  }

  // ── CCP 2 — sluitcontrole ────────────────────────────────────────────────
  const eigenControles = (p.sluitcontroles || []).filter(c => c.sessie_id === sessie?.id)
  const [sc, setSc] = React.useState({
    aanleiding: 'start' as SluitControle['aanleiding'],
    visueel_ok: true,
    omkeerproef_ok: true,
    rolinstelling: '',
    opmerking: '',
  })
  const omkeerNodig = omkeerproefVerplicht(sessie?.verpakking_type, inst)
  const scBeoordeling = beoordeelSluitcontrole(
    {...sc, omkeerproef_ok: omkeerNodig ? sc.omkeerproef_ok : null},
    sessie?.verpakking_type, inst)
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

  // ── Geen open sessie: startformulier ─────────────────────────────────────
  if (!sessie) {
    return (
      <div className="space-y-3">
        {eigenSessies.length > 0 && (
          <div className="space-y-1">
            {eigenSessies.map(s => (
              <div key={s.id} className="text-xs text-gray-500 flex items-center gap-2">
                <span className="font-mono font-medium text-gray-700">{s.lotcode}</span>
                <span>{t(`haccp_sessie_${s.status}`)}</span>
                {s.tht && <span>· {t('haccp_sessie_tht')} {fmtD(s.tht)}</span>}
                <span>· {(p.av || []).filter((a: any) => a.sessie_id === s.id).length} {t('haccp_sessie_verpakkingen')}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          <Sel label={t('lbl_packaging')} value={String(start.verpakking_id)}
            onChange={(v: string) => setStart({...start, verpakking_id: v})}
            opts={[{v: '', l: '—'}, ...(p.verpakkingen || []).map((v: any) => ({v: String(v.id), l: v.naam}))]} />
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

        {/* Afvullen kan alleen binnen een sessie; alleen legacy-batches vullen
            hier nog los af. Verder staat er alleen wat al geregistreerd is. */}
        {p.registratie && p.registratieZonderSessie && (
          <div className="rounded-lg border border-gray-200 p-3 space-y-2">
            <span className="text-sm font-semibold text-gray-700">{t('flow_sectie_afvullen')}</span>
            {p.registratie}
          </div>
        )}
        {p.lijst && <div className="pt-2 border-t border-gray-100">{p.lijst}</div>}
      </div>
    )
  }

  // ── Open sessie ──────────────────────────────────────────────────────────
  const aantalVerpakt = (p.av || []).filter((a: any) => a.sessie_id === sessie.id).length
  // Zolang de startcontroles ontbreken staan die panelen open — dat zijn de
  // stappen die het afvullen op dat moment blokkeren.
  const ccp2Auto = !eigenControles.some(c => c.aanleiding === 'start' && c.resultaat === 'goedgekeurd')
    || !!herinnering?.due
  const ccp3Auto = eigenEtiket.length === 0

  return (
    <div className="space-y-4">
      {/* Kop met lotcode */}
      <div className="rounded-lg border-l-4 border-green-500 bg-white shadow-sm p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono font-bold text-gray-800">{sessie.lotcode}</span>
            <span className="text-xs text-gray-500">
              {t('haccp_sessie_gestart')} {new Date(sessie.start).toLocaleTimeString()}
            </span>
            <span className="text-xs text-gray-500">
              · {eigenControles.length} {t('haccp_sessie_controles')}
            </span>
            <span className="text-xs text-gray-500">
              · {aantalVerpakt} {t('haccp_sessie_verpakkingen')}
            </span>
          </div>
          <div className="flex gap-2">
            <Btn s="sm" v="ghost" onClick={breekAf}>{t('haccp_sessie_afbreken')}</Btn>
            <Btn s="sm" disabled={!afsluitBlok.toegestaan} onClick={sluitSessie}>
              {t('haccp_sessie_afsluiten')}
            </Btn>
          </div>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {t('haccp_sessie_tht')}: {sessie.tht ? fmtD(sessie.tht) : t('haccp_sessie_bewaaradvies_tekst')}
          {sessie.tht_reden && <span className="text-orange-600 ml-1">· {sessie.tht_reden}</span>}
        </div>
        {/* Wat het afsluiten tegenhoudt is pas nieuws als er iets in de sessie
            zit; direct na het starten is die lijst alleen maar ruis boven de
            blokkade van de registratie zelf. */}
        {!afsluitBlok.toegestaan && (aantalVerpakt > 0 || eigenControles.length > 0) && (
          <div className="mt-2"><BlokkadeKaart blok={afsluitBlok} compact /></div>
        )}
      </div>

      {/* Afvulregistratie — de handeling zelf, binnen de lopende sessie */}
      {p.registratie && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <span className="text-sm font-semibold text-gray-700">{t('flow_sectie_afvullen')}</span>
          {p.registratie}
        </div>
      )}

      {/* CCP 2 — sluitcontrole */}
      <Paneel
        titel={t('haccp_ccp2_titel')}
        open={paneelOpen(`${sessie.id}:ccp2`, ccp2Auto)}
        onToggle={() => togglePaneel(`${sessie.id}:ccp2`, ccp2Auto)}
        info={herinnering && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
            herinnering.due ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
            {herinnering.due
              ? t('haccp_ccp2_due').replace('{minuten}', String(herinnering.minutenSinds))
              : t('haccp_ccp2_volgende').replace('{minuten}', String(herinnering.volgendeOverMin))}
          </span>
        )}>

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
      </Paneel>

      {/* CCP 3 — etiketcontrole */}
      <Paneel
        titel={t('haccp_ccp3_titel')}
        open={paneelOpen(`${sessie.id}:ccp3`, ccp3Auto)}
        onToggle={() => togglePaneel(`${sessie.id}:ccp3`, ccp3Auto)}
        info={eigenEtiket.length > 0 && (
          <span className="text-xs text-gray-400 flex-shrink-0">{eigenEtiket.length}×</span>
        )}>

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
      </Paneel>

      {p.lijst}

      {afwijking && (
        <AfwijkingModal blok={afwijking.blok} titel={afwijking.titel}
          onBevestig={bevestigAfwijking} onClose={() => setAfwijking(null)} />
      )}
    </div>
  )
}

export default AfvulSessieSectie
