import React, { useMemo, useState } from 'react'
import { t } from '../../i18n'
import { newId } from '../../utils/api'
import { tod } from '../../utils/format'
import { logAudit } from '../../utils/audit'
import { nextBatchNummer, tankBezetter } from '../../utils/calculations'
import { receptNaarBatch } from '../../utils/receptNaarBatch'
import { receptenVoorKeuzelijst } from '../../utils/receptLijst'
import { batchTitel } from '../../utils/productKeten'
import { besluitProduct, productBijPlannen } from '../../utils/batchKeten'
import type { ProductKeuzeWaarde } from '../../utils/batchKeten'
import Inp from '../ui/Inp'
import Sel from '../ui/Sel'
import Blad from '../ui/Blad'
import { useSmalScherm } from '../ui/useSmalScherm'
import PlanProductKeuze from '../batch/PlanProductKeuze'
import { tankKeuzeOpties } from '../batch/tankOpties'
import { useProductKoppeling } from '../batch/useProductKoppeling'

/** Wat een ingang al invult: "Brouwen" op een recept, "Nieuwe batch" op een product, een vrije tank. */
export interface NieuweBatchVoorinvulling {
  recept_id?: string | number | null
  naam?: string | null
  datum?: string | null
  tank?: string | null
  product_id?: number | string | null
}

interface NieuweBatchFormulierProps {
  bat: any[]
  setBat: (fn: (prev: any[]) => any[]) => void
  setBi: (fn: (prev: any[]) => any[]) => void
  ing: any[]
  recepten: any[]
  receptenVerborgen?: any[]
  receptenGearchiveerdeTags?: string[]
  producten: any[]
  setProducten: (fn: (prev: any[]) => any[]) => void
  tanks: any[]
  tankStatussen: any
  setLog: (fn: (prev: any[]) => any[]) => void
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  voorinvulling?: NieuweBatchVoorinvulling | null
  /** De batch is gepland: open hem (de batch als eigen pagina, fase Gepland). */
  onGepland: (id: number) => void
  onSluit: () => void
}

// 'Brouwen' geeft de receptnaam mee als naam. Dat is geen eigen naam: de batch
// krijgt de naam van zijn product (receptNaarBatch), en zonder product die
// van het recept — dus leeg laten. Een meegegeven product (*Nieuwe batch* op
// een product) is een keuze; het recept beslist dan niet meer.
const beginWaarden = (v: NieuweBatchVoorinvulling | null | undefined, recepten: any[]): any => {
  const receptId = v?.recept_id != null && v.recept_id !== '' ? String(v.recept_id) : ''
  const receptNaam = receptId ? String((recepten || []).find((r: any) => String(r.id) === receptId)?.naam || '').trim() : ''
  const naam = String(v?.naam || '').trim()
  const productId = Number(v?.product_id)
  return {
    recept_id: receptId,
    naam: naam && naam !== receptNaam ? naam : '',
    datum: v?.datum || tod(),
    tank: v?.tank || '',
    product: Number.isFinite(productId) && productId > 0 ? {soort: 'product', productId} as ProductKeuzeWaarde : null,
  }
}

/**
 * Een nieuwe batch plannen: recept, product, naam, tank en brouwdatum. Het
 * formulier dat onder de vouw van de oude Planning stond, nu achter
 * "+ Nieuwe batch" op Batches (een Modal op het bureau, een Onderblad op de
 * telefoon) tot het blad "Wat brouw je?" (F8) het vervangt.
 *
 * De recept→batch-vertaling staat in utils/receptNaarBatch: doelen komen in
 * verwacht_* (geen metingen), ingrediënten worden batch-regels. De receptkeuze
 * laat weg wat de receptenpagina ook weglaat (verborgen recepten, recepten
 * waarvan alle tags gearchiveerd zijn, versies); een recept dat al gekozen is
 * (via "Brouwen", ook op een verborgen recept) blijft kiesbaar.
 */
const NieuweBatchFormulier: React.FC<NieuweBatchFormulierProps> = ({
  bat, setBat, setBi, ing, recepten, receptenVerborgen, receptenGearchiveerdeTags, producten, setProducten,
  tanks, tankStatussen, setLog, auditLog, setAuditLog, voorinvulling, onGepland, onSluit,
}) => {
  const smal = useSmalScherm()
  const [form, setForm] = useState<any>(() => beginWaarden(voorinvulling, recepten))
  // Waarom "Batch plannen" niet doorging — een melding in het formulier in
  // plaats van een alert(). Elke wijziging in het formulier wist hem.
  const [fout, setFout] = useState<string | null>(null)
  const wijzig = (patch: any) => { setFout(null); setForm((f: any) => ({...f, ...patch})) }
  const koppeling = useProductKoppeling({ producten, setProducten, recepten, bat, setBat, auditLog, setAuditLog })

  const titelVan = (b: any) => batchTitel(b, { producten, recepten }, t('lbl_naamloos'))
  const receptOpId = (id: any) => id == null || id === '' ? null : (recepten || []).find((r: any) => String(r.id) === String(id)) || null
  const receptOpties = useMemo(() => receptenVoorKeuzelijst(recepten || [], {
    verborgen: receptenVerborgen, gearchiveerdeTags: receptenGearchiveerdeTags, behoud: [form.recept_id],
  }), [recepten, receptenVerborgen, receptenGearchiveerdeTags, form.recept_id])
  const tankOpties = useMemo(() => tankKeuzeOpties(tanks, bat, tankStatussen, null, b => titelVan(b).label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tanks, bat, tankStatussen, producten, recepten])

  const recept = receptOpId(form.recept_id)
  // Het voorstel voor het product (utils/batchKeten.ts → productBijPlannen).
  const plan = useMemo(() => productBijPlannen(recept, { producten, batches: bat, recepten }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.recept_id, producten, bat, recepten])
  // Zonder eigen naam heet de batch naar zijn product, anders naar het recept
  // (receptNaarBatch) — dat staat als voorbeeld in het naamveld.
  const besluitNu = besluitProduct(plan, form.product, { producten, standaardNaam: recept?.naam || '' })
  const naamVoorstel = besluitNu.product?.naam || besluitNu.nieuwNaam || recept?.naam || t('flow_nieuw_naam_ph')

  const addLog = (entry: any) => setLog((prev: any[]) => [...(prev || []), {id: newId(prev || []), datum: tod(), ...entry}])

  const plannen = () => {
    const opties = {
      nieuw: {
        id: newId(bat || []),
        batch_nummer: nextBatchNummer(bat || []),
        naam: form.naam,
        datum: form.datum || tod(),
        tank: form.tank,
        created_at: new Date().toISOString(),
      },
      ingredienten: ing || [],
    }
    const zonderProduct: any = receptNaarBatch(recept, opties).batch
    if (!zonderProduct.naam) { setFout(t('flow_nieuw_naam_of_recept')); return }
    // Alleen actief gebruik blokkeert (er zit bier in de tank). Geen
    // ontsmet-eis bij het plannen: de tank wordt op de brouwdag ontsmet.
    if (form.tank) {
      const bezet = tankBezetter(form.tank, bat)
      if (bezet) { setFout(t('err_tank_occupied').replace('{tank}', form.tank).replace('{name}', titelVan(bezet).label)); return }
    }
    const besluit = besluitProduct(plan, form.product, { producten, standaardNaam: recept?.naam || zonderProduct.naam })
    const besluitFout = koppeling.besluitFoutTekst(besluit.fout)
    if (besluitFout) { setFout(besluitFout); return }
    const nieuwProduct = besluit.nieuwNaam ? koppeling.nieuwProductRecord(zonderProduct, recept, besluit.nieuwNaam) : null
    const product = nieuwProduct || besluit.product
    const nb: any = product ? receptNaarBatch(recept, {...opties, product}).batch : zonderProduct
    if (nieuwProduct) koppeling.voegProductToe(nieuwProduct)
    setBat((prev: any[]) => [...(prev || []), nb])
    addLog({type: 'aangemaakt', batch_id: nb.id, referentie: nb.naam})
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: nb.id, actie: 'aangemaakt', omschrijving: nb.naam})
    // De regels tegen de verse lijst: hun id's lopen door vanaf het hoogste.
    if (recept) setBi((prev: any[]) => receptNaarBatch(recept, {...opties, regels: prev || []}).alleRegels)
    if (besluit.automatisch && besluit.product) koppeling.meldAutomatischeKoppeling(nb.id, besluit.product, zonderProduct.naam)
    // Direct de nieuwe batch openen, op de fase Gepland.
    onGepland(nb.id)
  }

  return (
    <Blad titel={`${t('flow_nieuw_titel')} #${nextBatchNummer(bat || [])}`} onSluit={onSluit}
      onKlaar={plannen} klaarLabel={smal ? t('batches_plannen') : t('flow_nieuw_plan_btn')}>
      <div className="space-y-3">
        {/* Een ander recept = een ander voorstel voor het product. */}
        <Sel label={t('flow_nieuw_recept')} value={String(form.recept_id)}
          onChange={(v: string) => wijzig({recept_id: v, product: null})}
          ph={t('flow_nieuw_recept_ph')}
          opts={receptOpties.map((r: any) => ({v: String(r.id), l: `${r.naam}${r.stijl ? ` — ${r.stijl}` : ''}`}))} />
        <PlanProductKeuze plan={plan} keuze={form.product}
          onKeuze={k => wijzig({product: k})}
          standaardNaam={recept?.naam || ''} recepten={recepten} producten={producten} />
        <Inp label={t('lbl_name')} value={form.naam}
          onChange={(v: string) => wijzig({naam: v})}
          placeholder={naamVoorstel} />
        {(tanks || []).length > 0 && (
          <div>
            <Sel label={t('lbl_tank')} value={String(form.tank)}
              onChange={(v: string) => wijzig({tank: v})}
              ph={t('flow_nieuw_tank_ph')} opts={tankOpties} />
            <div className="text-[11px] text-gray-500 mt-1">{t('flow_nieuw_tank_hint')}</div>
          </div>
        )}
        <Inp label={t('flow_nieuw_datum')} type="date" value={form.datum}
          onChange={(v: string) => wijzig({datum: v})} />
        {fout && (
          <div role="alert" className="text-sm px-3 py-2 rounded-lg border border-orange-200 bg-orange-50 text-orange-800">{fout}</div>
        )}
      </div>
    </Blad>
  )
}

export default NieuweBatchFormulier
