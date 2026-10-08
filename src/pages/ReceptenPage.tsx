import React from 'react'
import { t } from '../i18n'
import { fmtD, tod } from '../utils/format'
import { bfGetRecipesWithVersions, _fetchedKeys } from '../utils/api'
import Btn from '../components/ui/Btn'
import LegeStaat from '../components/ui/LegeStaat'
import { useUndo } from '../components/ui/UndoBar'
import type { RowActie } from '../components/ui/RowActions'
import type { ReceptSectie } from '../components/recept/IngredientSectie'
import ReceptLijst, { type ReceptRijContext } from '../components/recept/ReceptLijst'
import ReceptDetail from '../components/recept/ReceptDetail'
import ProductKiezer from '../components/recept/ProductKiezer'
import { logAudit, logAuditVeld } from '../utils/audit'
import { voegReceptSyncSamen, pasReceptRegelAan, wisLokaal } from '../utils/receptSync'
import { receptGebruik, gebruikIndex, tellingen, type ReceptGebruik } from '../utils/receptGebruik'
import {
  segmentVan, zichtbaarheidUndoId, zichtbaarheidUitUndoId, pasZichtbaarheidToe, koppelReceptAanProduct,
  laatsteReceptSync, RECEPT_SYNC_AUDIT,
  type ReceptSegment, type ReceptZichtbaarheid,
} from '../utils/receptLijst'
import { receptVoorraadOordeel, type ReceptVoorraadOordeel } from '../utils/ingredientVoorraad'
import type { VerkoopCtx } from '../utils/verkoopOverzicht'
import type { GaNaar, GaNaarOpties } from '../utils/route'

// Recepten "in gebruik" (docs/OPZET-PRODUCTIE-VERKOOP.md, hoofdstuk 6).
//
// Links de lijst — Segment In gebruik · Archief · Verborgen, zoeken over alle
// drie — rechts (telefoon: een eigen scherm) het detail met de
// verbindingsblokken naar product, batches, etiket en versies. Het geopende
// recept staat in de route (`#/productie/recepten/<id>`, App.tsx): terug,
// herladen en een gedeelde link werken.
//
// De status per recept komt uit utils/receptGebruik.ts, de indeling van de
// lijst uit utils/receptLijst.ts; de onderdelen staan in components/recept/,
// buiten deze render (typen in de hoptijd houdt de focus).

export interface ReceptenPageProps {
  ing: any[]
  lots: any[]
  bat?: any[]
  producten?: any[]
  setProducten?: (fn: (prev: any[]) => any[]) => void
  av?: any[]
  afvulSessies?: any[]
  uit?: any[]
  verplaatsingen?: any[]
  afboekingen?: any[]
  locaties?: any[]
  bestellingen?: any[]
  bestellingPicks?: any[]
  productArtikelen?: any[]
  artikelen?: any[]
  verliesRegistraties?: any[]
  inkoopFacturen?: any[]
  verpakkingen?: any[]
  onderdelen?: any[]
  accijnsInst?: any
  bfCreds: any
  recepten: any[]
  setRecepten: (fn: any) => void
  verborgen: any[]
  setVerborgen: (fn: any) => void
  gearchiveerdeTags: string[]
  setGearchiveerdeTags: (fn: any) => void
  tagVolgorde?: string[]
  setPage?: (p: string) => void
  setPreNieuwBatch?: (v: any) => void
  auditLog?: any[]
  setAuditLog?: (fn: any) => void
  recordId?: string | null
  onOpenRecord?: (id: string | number | null, opties?: GaNaarOpties) => void
  gaNaar?: GaNaar
}

function ReceptenPage({
  ing, lots, bat = [], producten = [], setProducten, av = [], afvulSessies = [], uit = [], verplaatsingen = [],
  afboekingen = [], locaties = [], bestellingen = [], bestellingPicks = [], productArtikelen = [], artikelen = [],
  verliesRegistraties = [], inkoopFacturen = [], verpakkingen = [], onderdelen = [], accijnsInst = null, bfCreds,
  recepten, setRecepten, verborgen, setVerborgen, gearchiveerdeTags, setGearchiveerdeTags, tagVolgorde = [],
  setPage, setPreNieuwBatch, auditLog = [], setAuditLog = () => {}, recordId = null, onOpenRecord, gaNaar,
}: ReceptenPageProps) {
  const { useState, useMemo } = React
  const undo = useUndo()
  const vandaag = tod()

  // Het geopende recept: uit de route als de schil die meegeeft, anders lokaal.
  // Id's worden als tekst vergeleken (een Brewfather-id is tekst, de route ook).
  const [lokaalSel, setLokaalSel] = useState<string | null>(null)
  const gestuurd = typeof onOpenRecord === 'function'
  const sel: string | null = gestuurd ? (recordId == null || recordId === '' ? null : String(recordId)) : lokaalSel
  // `opties.vervang`: de history-entry vervangen (een recept dat niet bestaat
  // hoort niet terug te komen onder "terug").
  const setSel = (v: string | null, opties?: { vervang?: boolean }) => {
    const id = v == null || v === '' ? null : String(v)
    if (gestuurd) onOpenRecord!(id, opties); else setLokaalSel(id)
  }

  const [segment, setSegment] = useState<ReceptSegment>('in_gebruik')
  const [zoek, setZoek] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [koppelVoor, setKoppelVoor] = useState<ReceptGebruik<any> | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  // Korte melding na vastpinnen of koppelen: het recept verhuist dan soms van
  // segment, en dat moet je zien.
  const [melding, setMelding] = useState('')
  React.useEffect(() => {
    if (!melding) return
    const h = setTimeout(() => setMelding(''), 6000)
    return () => clearTimeout(h)
  }, [melding])

  // Verbergen en tonen gaan met vijf seconden terugweg (UndoBar): zolang die
  // loopt laat de lijst al zien wat er gaat gebeuren; pas daarna wordt het
  // weggeschreven.
  const wachtend = zichtbaarheidUitUndoId(undo.actie?.id)
  const stand = useMemo(
    () => pasZichtbaarheidToe({ verborgen, gearchiveerdeTags }, wachtend),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verborgen, gearchiveerdeTags, undo.actie?.id])
  const gebruik = useMemo(() => receptGebruik({
    recepten: recepten || [], batches: bat || [], producten: producten || [],
    verborgen: stand.verborgen, gearchiveerdeTags: stand.gearchiveerdeTags, vandaag,
  }), [recepten, bat, producten, stand, vandaag])
  const index = useMemo(() => gebruikIndex(gebruik), [gebruik])
  const telling = useMemo(() => tellingen(gebruik), [gebruik])

  const selRec = sel == null ? undefined : (recepten || []).find((r: any) => String(r.id) === sel)
  const selG = sel == null ? null : (index.get(sel) || null)

  // Een ander recept openen begint bovenaan het detail (de pagina blijft
  // staan, dus anders opende het op de scrollhoogte van de lijst). Terug naar
  // de lijst niet: dan zet de browser de lijst terug waar je was.
  const vorigeSel = React.useRef(sel)
  React.useEffect(() => {
    if (sel != null && sel !== vorigeSel.current && typeof window !== 'undefined') window.scrollTo({ top: 0 })
    vorigeSel.current = sel
  }, [sel])

  // Een gedeelde link of herlaad op een recept: het segment van dat recept,
  // één keer — daarna kiest de gebruiker (verbergen verplaatst het open recept
  // naar Verborgen zonder dat de lijst meespringt).
  const segmentGezet = React.useRef(false)
  React.useEffect(() => {
    if (segmentGezet.current || !_fetchedKeys.has('recepten')) return
    segmentGezet.current = true
    if (selG) setSegment(segmentVan(selG))
  }, [selG])

  // De voorraadstip in In gebruik: per recept één oordeel over alle regels.
  const voorraadPer = useMemo(() => {
    const m = new Map<string, ReceptVoorraadOordeel>()
    if (segment !== 'in_gebruik') return m
    for (const g of gebruik) if (g.inGebruik) m.set(g.id, receptVoorraadOordeel(g.recept, lots, ing))
    return m
  }, [gebruik, lots, ing, segment])

  const verkoopCtx = useMemo((): VerkoopCtx => ({
    producten, productArtikelen, artikelen, verpakkingen, batches: bat, afvullingen: av, uitleveringen: uit,
    verplaatsingen, afboekingen, locaties, bestellingen, bestellingPicks,
  }), [producten, productArtikelen, artikelen, verpakkingen, bat, av, uit, verplaatsingen, afboekingen, locaties, bestellingen, bestellingPicks])

  // ── Handelingen ───────────────────────────────────────────────────────────

  const kanBrouwen = !!(setPage && setPreNieuwBatch)
  // Voorlopig de bestaande nieuwe-batchflow: alleen het recept voorselecteren,
  // de batchpagina bouwt de batch en de ingrediëntregels uit het recept op.
  const brouwen = (g: ReceptGebruik<any>) => {
    if (!kanBrouwen) return
    setPreNieuwBatch!({ recept_id: g.id, naam: g.naam })
    setPage!('batches')
  }

  const zetVastgepind = (g: ReceptGebruik<any>, aan: boolean) => {
    setRecepten((prev: any[]) => (prev || []).map((r: any) => String(r.id) === g.id ? { ...r, vastgepind: aan } : r))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Recept', entiteit_id: 0, actie: 'gewijzigd',
      velden: { vastgepind: { oud: g.vastgepind, nieuw: aan } },
      omschrijving: `${g.naam || g.id}: ${aan ? 'vastgepind' : 'losgemaakt'}`,
    })
    setMelding((aan ? t('recept_melding_vastgepind') : t('recept_melding_losgemaakt')).replace('{recept}', g.naam || t('lbl_naamloos')))
  }

  const planZichtbaarheid = (a: ReceptZichtbaarheid, label: string, omschrijving: string) => {
    undo.plan(zichtbaarheidUndoId(a), label, () => {
      if (a.soort === 'tag_terug' || a.soort === 'tag_archiveren') {
        setGearchiveerdeTags((prev: any) => pasZichtbaarheidToe({ gearchiveerdeTags: prev || [] }, a).gearchiveerdeTags)
      } else {
        setVerborgen((prev: any) => pasZichtbaarheidToe({ verborgen: prev || [] }, a).verborgen)
      }
      logAudit(auditLog, setAuditLog, { entiteit: 'Recept', entiteit_id: 0, actie: 'gewijzigd', omschrijving })
    })
  }

  // Een tag archiveren: alle recepten met alleen gearchiveerde tags gaan naar
  // Verborgen — ook als ze in gebruik zijn (verborgen wint), dus dat zegt de
  // terugweg erbij.
  const tagArchiveren = (tag: string) => {
    const geraakt = gebruik.filter(g => g.inGebruik && g.tags.includes(tag) &&
      g.tags.every(x => x === tag || stand.gearchiveerdeTags.includes(x))).length
    const label = (geraakt > 0
      ? t('recept_undo_tag_gearchiveerd_in_gebruik').replace('{n}', String(geraakt))
      : t('recept_undo_tag_gearchiveerd')).replace('{tag}', tag)
    planZichtbaarheid({ soort: 'tag_archiveren', tag }, label, `Tag ${tag}: gearchiveerd`)
    setTag(null)
  }

  const koppel = (g: ReceptGebruik<any>, productId: number) => {
    const product = (producten || []).find((p: any) => Number(p.id) === productId)
    if (!product || !setProducten) return
    setProducten((prev: any[]) => (prev || []).map((p: any) => Number(p.id) === productId ? koppelReceptAanProduct(p, g.id, recepten) : p))
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Product', entiteit_id: productId, actie: 'gewijzigd',
      omschrijving: `${product.naam || productId}: recept ${g.naam || g.id} gekoppeld`,
    })
    setMelding(t('recept_melding_gekoppeld').replace('{recept}', g.naam || t('lbl_naamloos')).replace('{product}', product.naam || t('lbl_naamloos')))
  }

  /** Het ⋯-menu van een recept, in de lijst en in de kop van het detail. */
  const actiesVoor = (g: ReceptGebruik<any>, _ctx?: ReceptRijContext, metBrouwen = true): RowActie[] => {
    const naam = g.naam || t('lbl_naamloos')
    const acties: RowActie[] = []
    if (metBrouwen && kanBrouwen) acties.push({ id: 'brouwen', label: t('btn_brouwen'), onClick: () => brouwen(g) })
    // Vastpinnen haalt een recept naar In gebruik — behalve een verborgen
    // recept (verborgen wint): daar eerst Tonen. Losmaken kan altijd.
    if (g.vastgepind) acties.push({ id: 'losmaken', label: t('recept_actie_losmaken'), onClick: () => zetVastgepind(g, false) })
    else if (g.status !== 'verborgen') acties.push({ id: 'vastpinnen', label: t('recept_actie_vastpinnen'), onClick: () => zetVastgepind(g, true) })
    if (setProducten) acties.push({ id: 'koppel', label: t('recept_actie_koppel'), onClick: () => setKoppelVoor(g) })
    const tagsGearchiveerd = g.tags.length > 0 && g.tags.every(x => stand.gearchiveerdeTags.includes(x))
    if (g.status !== 'verborgen') {
      acties.push({ id: 'verbergen', label: t('btn_hide'), onClick: () => planZichtbaarheid(
        { soort: 'verbergen', id: g.id }, t('recept_undo_verborgen').replace('{recept}', naam), `${naam}: verborgen`) })
    } else {
      if (g.verborgenReden === 'lijst') {
        acties.push({ id: 'tonen', label: t('recept_actie_tonen'), onClick: () => planZichtbaarheid(
          { soort: 'tonen', id: g.id }, t('recept_undo_getoond').replace('{recept}', naam), `${naam}: weer zichtbaar`) })
      }
      if (tagsGearchiveerd) {
        for (const x of g.tags) {
          acties.push({ id: `tag-${x}`, label: t('recept_actie_tag_terug').replace('{tag}', x), onClick: () => planZichtbaarheid(
            { soort: 'tag_terug', tag: x }, t('recept_undo_tag_terug').replace('{tag}', x), `Tag ${x}: teruggezet`) })
        }
      }
    }
    return acties
  }

  // ── Brewfather-sync ───────────────────────────────────────────────────────

  const runSync = async () => {
    if (!bfCreds?.enabled || !bfCreds.userId || !bfCreds.apiKey) {
      setMsg('⚠ ' + t('settings_brewfather_section')); return
    }
    setSyncing(true); setMsg('')
    try {
      const { recepten: recs, versionsSupported, totalVersions } = await bfGetRecipesWithVersions()
      // Brewfather is leidend, maar de eigen velden (vaste kosten, verlies-%,
      // vastgepind), de koppeling aan een voorraadingrediënt (ingredient_id),
      // een in de app gecorrigeerd hopschema (`_lokaal`) en een recept waar een
      // batch of product nog naar verwijst blijven staan — zie
      // utils/receptSync.ts.
      const { recepten: merged, behouden, bewaard } = voegReceptSyncSamen(recepten, recs, { batches: bat, producten })
      setRecepten(merged)
      const parentCount = recs.filter((r: any) => r.is_huidige !== false).length
      // Het begin van deze regel (`RECEPT_SYNC_AUDIT`) is ook "Laatste sync" in de kop.
      const auditMsg = (versionsSupported
        ? `${RECEPT_SYNC_AUDIT}: ${parentCount} recepten (+${totalVersions} versies)`
        : `${RECEPT_SYNC_AUDIT}: ${parentCount} recepten`)
        + (behouden > 0 ? `, ${behouden} lokale aanpassingen behouden` : '')
        + (bewaard > 0 ? `, ${bewaard} recepten niet meer in Brewfather maar nog in gebruik bewaard` : '')
      logAudit(auditLog, setAuditLog, { entiteit: 'Recept', entiteit_id: 0, actie: 'gewijzigd', omschrijving: auditMsg })
      const key = versionsSupported ? 'msg_bf_sync_with_versions' : 'msg_bf_sync_no_versions'
      setMsg(t(key).replace('{n}', String(parentCount)).replace('{v}', String(totalVersions))
        + (behouden > 0 ? ' ' + t('msg_bf_sync_lokaal_behouden').replace('{n}', String(behouden)) : '')
        + (bewaard > 0 ? ' ' + t('msg_bf_sync_bewaard').replace('{n}', String(bewaard)) : ''))
    } catch (e: any) { setMsg(t('msg_bf_sync_failed').replace('{msg}', e.message || String(e))) }
    setSyncing(false)
  }

  // ── Het recept zelf (eigen velden, hopschema) ─────────────────────────────

  // Wijzig eigen velden op het geselecteerde recept (bijv. de vaste kosten per
  // brouw). Blijft bij een Brewfather-sync behouden — zie `runSync`.
  const updateRecept = (patch: Record<string, unknown>) => {
    if (!selRec) return
    // Het recept is de basis voor de allergenenvergelijking bij de
    // etiketcontrole; wijzigingen horen dus terug te vinden te zijn. Deze
    // velden slaan tijdens het typen op, dus samengevoegd tot één regel.
    for (const [veld, waarde] of Object.entries(patch)) {
      logAuditVeld(setAuditLog, {
        entiteit: 'Recept', entiteit_id: selRec.id, veld,
        oud: (selRec as any)[veld], nieuw: waarde, context: selRec.naam || '',
      })
    }
    setRecepten((prev: any[]) => prev.map((r: any) => r.id === selRec.id ? { ...r, ...patch } : r))
  }

  // Wijzig een enkele ingredient-entry in het geselecteerde recept.
  // cat = 'mout'|'hop'|'gist'|'overig'; idx = index binnen die array.
  const updateReceptIng = (cat: ReceptSectie, idx: number, patch: Record<string, unknown>) => {
    if (!selRec) return
    const huidig = (selRec as any)[cat]?.[idx] || {}
    for (const [veld, waarde] of Object.entries(patch)) {
      logAuditVeld(setAuditLog, {
        entiteit: 'Recept', entiteit_id: selRec.id, veld: `${cat}/${huidig.naam || idx}/${veld}`,
        oud: huidig[veld], nieuw: waarde, context: selRec.naam || '',
      })
    }
    setRecepten((prev: any[]) => prev.map((r: any) => {
      if (r.id !== selRec.id) return r
      const list = [...(r[cat] || [])]
      if (!list[idx]) return r
      // Gebruik/tijd die hier gecorrigeerd worden, blijven bij een
      // Brewfather-sync staan (`_lokaal`, utils/receptSync.ts).
      list[idx] = pasReceptRegelAan(list[idx], patch)
      return { ...r, [cat]: list }
    }))
  }

  // Brewfather weer leidend maken voor deze regel: de lokale markering weg,
  // de volgende sync zet gebruik/tijd terug naar de waarde uit Brewfather.
  const wisLokaleAanpassing = (cat: ReceptSectie, idx: number) => {
    if (!selRec) return
    const huidig = (selRec as any)[cat]?.[idx] || {}
    logAudit(auditLog, setAuditLog, { entiteit: 'Recept', entiteit_id: 0, actie: 'gewijzigd',
      omschrijving: `${selRec.naam || ''}: ${cat}/${huidig.naam || idx} volgt Brewfather weer` })
    setRecepten((prev: any[]) => prev.map((r: any) => {
      if (r.id !== selRec.id) return r
      const list = [...(r[cat] || [])]
      if (!list[idx]) return r
      list[idx] = wisLokaal(list[idx])
      return { ...r, [cat]: list }
    }))
  }

  // ── Weergave ──────────────────────────────────────────────────────────────

  const laatsteSync = useMemo(() => laatsteReceptSync(auditLog), [auditLog])
  const syncTekst = [
    laatsteSync ? t('recept_laatste_sync').replace('{wanneer}', `${fmtD(laatsteSync)} ${new Date(laatsteSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`) : '',
    telling.totaal > 0 ? t('recept_aantal_recepten').replace('{n}', String(telling.totaal)) : '',
  ].filter(Boolean).join(' · ')
  const naarProduct = (id: number) => gaNaar?.({ pagina: 'producten', id })

  return (
    <div>
      {/* Op een telefoon is een open recept een eigen scherm: dan geen paginakop. */}
      <div className={`mb-4 ${sel ? 'hidden md:block' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">{t('nav_recepten')}</h2>
          <div className="flex items-center gap-3 min-w-0">
            {syncTekst && <span className="hidden sm:inline text-sm text-gray-500 truncate">{syncTekst}</span>}
            <Btn v="secondary" onClick={runSync} disabled={syncing || !bfCreds?.enabled}>
              {syncing ? t('recipe_syncing') : t('recipe_sync_brewfather')}
            </Btn>
          </div>
        </div>
        {syncTekst && <p className="sm:hidden text-xs text-gray-500 mt-1">{syncTekst}</p>}
        {/* De syncmelding op een eigen regel: naast de knop kneep een lange
            melding (bewaarde recepten) op een telefoon de titel af. */}
        {msg && <p className={`mt-2 text-sm md:text-right break-words ${msg.startsWith('✓') ? 'text-green-600' : 'text-orange-600'}`}>{msg}</p>}
      </div>
      {/* Buiten de kop: ook op het detailscherm van een telefoon (zonder kop)
          te zien na vastpinnen of koppelen vanuit ⋯. */}
      <p role="status" className={`text-sm text-gray-700 break-words ${!melding ? 'sr-only' : sel ? 'mb-3 md:-mt-2' : '-mt-2 mb-3'}`}>{melding}</p>

      <div className="flex flex-col md:flex-row gap-4 lg:gap-6 md:items-start">
        {/* Lijst: op het bureau een eigen scrollkolom naast het detail. */}
        <div className={`w-full md:w-72 lg:w-[360px] md:flex-shrink-0 md:sticky md:top-[calc(var(--kopbalk)+1rem)] md:max-h-[calc(100vh-var(--kopbalk)-2rem)] md:overflow-y-auto md:overscroll-contain md:pr-1 ${sel ? 'hidden md:block' : ''}`}>
          <ReceptLijst
            gebruik={gebruik}
            telling={telling}
            producten={producten || []}
            recepten={recepten || []}
            segment={segment}
            onSegment={s => setSegment(s)}
            zoek={zoek}
            onZoek={setZoek}
            tag={tag}
            onTag={setTag}
            tagVolgorde={tagVolgorde || []}
            onTagArchiveren={tagArchiveren}
            geselecteerdId={selG?.id ?? null}
            onOpen={id => setSel(id)}
            actiesVoor={actiesVoor}
            voorraadVoor={g => voorraadPer.get(g.id) || null}
            onProduct={naarProduct}
            vandaag={vandaag}
            geenRecepten={(recepten || []).length === 0}
            onSync={bfCreds?.enabled && !syncing ? runSync : undefined}
          />
        </div>

        {/* Detail: op een telefoon een eigen scherm (kopbalk met terug). */}
        <div className={`flex-1 min-w-0 ${sel ? '' : 'hidden md:block'}`}>
          {selRec ? (
            // Per recept een vers detail: uitgeklapte kaarten en lotregels van
            // het vorige recept gaan niet mee.
            <ReceptDetail
              key={String(selRec.id)}
              recept={selRec}
              gebruik={selG}
              recepten={recepten || []}
              producten={producten || []}
              batches={bat || []}
              ingredienten={ing || []}
              lots={lots || []}
              afvullingen={av || []}
              afvulSessies={afvulSessies || []}
              verliesRegistraties={verliesRegistraties}
              inkoopFacturen={inkoopFacturen}
              verpakkingen={verpakkingen}
              onderdelen={onderdelen}
              accijnsInst={accijnsInst}
              verkoopCtx={verkoopCtx}
              acties={selG ? actiesVoor(selG, undefined, false) : []}
              onBrouwen={kanBrouwen && selG && selRec.is_huidige !== false && !selRec.parent_id ? () => brouwen(selG) : undefined}
              onKoppel={() => selG && setKoppelVoor(selG)}
              onOpenRecept={id => setSel(id)}
              onOpenBatch={id => gaNaar?.({ pagina: 'batches', id })}
              onOpenProduct={naarProduct}
              onWijzig={updateRecept}
              onWijzigRegel={updateReceptIng}
              onWisLokaal={wisLokaleAanpassing}
            />
          ) : sel != null ? (
            // Een recept in de route dat er niet (meer) is: zeggen, met de weg
            // naar de lijst. Zolang de recepten nog laden: niets.
            _fetchedKeys.has('recepten') ? (
              <LegeStaat cls="flex-1" icoon="search" titel={t('route_niet_gevonden_titel')} tekst={t('route_niet_gevonden_recept')}>
                <Btn v="secondary" onClick={() => setSel(null, { vervang: true })}>{t('route_naar_lijst').replace('{lijst}', t('nav_recepten'))}</Btn>
              </LegeStaat>
            ) : null
          ) : (
            <div className="flex items-center justify-center text-gray-400 text-sm py-24 bg-white rounded-xl border border-gray-100 shadow-card">
              {t('msg_select_recept')}
            </div>
          )}
        </div>
      </div>

      {koppelVoor && (
        <ProductKiezer
          onderwerp={koppelVoor.naam || t('lbl_naamloos')}
          producten={producten || []}
          recepten={recepten || []}
          gekoppeld={koppelVoor.producten.map(r => r.productId)}
          onKies={pid => { koppel(koppelVoor, pid); setKoppelVoor(null) }}
          onSluit={() => setKoppelVoor(null)}
          onNaarProducten={gaNaar ? () => { setKoppelVoor(null); gaNaar({ pagina: 'producten' }) } : undefined}
        />
      )}
    </div>
  )
}

export default ReceptenPage
