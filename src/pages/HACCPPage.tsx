import React from 'react'
import { t } from '../i18n'
import { newId } from '../utils/api'
import { fmtD, tod } from '../utils/format'
import { logAudit } from '../utils/audit'
import { ALLERGENEN_LIJST, TOEVOEGING_SOORTEN } from '../utils/constants'
import { telAchterstalligeSchoonmaakTaken } from '../utils/taken'
import Btn from '../components/ui/Btn'
import Modal from '../components/ui/Modal'
import Inp from '../components/ui/Inp'
import SectionHeader from '../components/ui/SectionHeader'
import TraceTab from '../components/haccp/TraceTab'
import ReinigingTab from '../components/haccp/ReinigingTab'
import RegistersTab from '../components/haccp/RegistersTab'
import { oefeningStatus, geldigeOefeningen, oefeningenNieuwsteEerst } from '../utils/trace'

// HACCP-borging. De pagina is een register: registreren gebeurt daar waar de
// handeling plaatsvindt (vrijgave, sluit- en etiketcontrole in de batchflow,
// tankreiniging bij de tank), hier wordt teruggekeken en bewijs geleverd.
// Zes tabbladen, gegroepeerd naar de vraag die ze beantwoorden — niet naar de
// datasleutel waarin het toevallig staat.
type Tab = 'dashboard'|'kritisch'|'reiniging'|'allergenen'|'traceerbaarheid'|'registers'

function HACCPPage(props: any) {
  const {useState} = React
  const [tab, setTab] = useState<Tab>('dashboard')
  const [modal, setModal] = useState<string|null>(null)
  const [edit, setEdit] = useState<any>(null)

  const tabs: {id:Tab,l:string}[] = [
    {id:'dashboard',l:t('haccp_dashboard')},
    {id:'kritisch',l:t('haccp_tab_kritisch')},
    {id:'reiniging',l:t('haccp_tab_reiniging')},
    {id:'allergenen',l:t('haccp_allergenen')},
    {id:'traceerbaarheid',l:t('haccp_traceerbaarheid')},
    {id:'registers',l:t('haccp_tab_registers')},
  ]

  // Bij het wisselen van tabblad sluit een half ingevuld formulier: de
  // modal-state is gedeeld tussen de tabbladen.
  const wissel = (id: Tab) => { setTab(id); setModal(null); setEdit(null) }

  return (
    <div>
      <div className="mb-4"><SectionHeader solid rounded="full" title={<span className="font-bold text-lg">{t('haccp_dash_title')}</span>} /></div>
      <div className="flex flex-wrap gap-1 mb-4">
        {tabs.map(tb=>(
          <button key={tb.id} onClick={()=>wissel(tb.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab===tb.id?'tbtn text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {tb.l}
          </button>
        ))}
      </div>
      {tab==='dashboard' && <DashTab {...props} setTab={setTab} />}
      {tab==='kritisch' && <KritischTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='reiniging' && <ReinigingTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
      {tab==='allergenen' && <AllergenenTab {...props} />}
      {tab==='traceerbaarheid' && <TraceTab {...props} />}
      {tab==='registers' && <RegistersTab {...props} modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />}
    </div>
  )
}

// Dashboard: wat vandaag aandacht vraagt staat als kaart bovenaan, de rest
// als één regel. Twaalf kaarten waarvan er elf groen zijn kost evenveel
// scanwerk als twaalf rode — en verstopt juist de ene die telt.
function DashTab({schoonmaakTaken, schoonmaakLog, capa, ing, waterkwaliteit, ongedierte,
                  opleidingen, bat, av, vrijgaven, sessies, afwijkingen, traceOefeningen,
                  haccpInst, setTab}: any) {
  const today = new Date(); today.setHours(0,0,0,0)
  const mAgo = (d:string,days:number) => { const dt=new Date(d); dt.setHours(0,0,0,0); return (today.getTime()-dt.getTime())/86400000 > days }

  const achterstallig = telAchterstalligeSchoonmaakTaken(schoonmaakTaken, schoonmaakLog, today)
  const openCapa = (capa||[]).filter((c:any)=>c.status!=='afgerond').length
  const ingMetAll = (ing||[]).filter((i:any)=>i.allergenen?.length>0).length
  const ingTot = (ing||[]).length
  const lastWater = (waterkwaliteit||[]).slice().sort((a:any,b:any)=>String(b.datum||'').localeCompare(String(a.datum||'')))[0]
  const waterOud = lastWater ? mAgo(lastWater.datum,180) : true
  const lastOngd = (ongedierte||[]).filter((o:any)=>o.type==='controle').slice().sort((a:any,b:any)=>String(b.datum||'').localeCompare(String(a.datum||'')))[0]
  const ongdOud = lastOngd ? mAgo(lastOngd.datum,30) : true
  const verlopen = (opleidingen||[]).filter((o:any)=>o.geldig_tot && new Date(o.geldig_tot)<today).length

  const maand = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
  // Batches die klaar staan om af te vullen maar nog geen geldige vrijgave
  // hebben — dat is waar de brouwer als eerste naar kijkt.
  const wachtVrijgave = (bat||[]).filter((b:any)=>{
    if(!['Conditioneren','Afgevuld'].includes(b.status)) return false
    const eigen = (vrijgaven||[]).filter((v:any)=>v.batch_id===b.id)
    if(!eigen.length) return true
    const vervangen = new Set(eigen.map((v:any)=>v.vervangt_id).filter((x:any)=>x!=null))
    const geldig = eigen.filter((v:any)=>!vervangen.has(v.id))
    return !geldig.some((v:any)=>v.oordeel==='vrijgegeven')
  }).length
  const openSessies = (sessies||[]).filter((x:any)=>x.status==='open').length
  const geblokkeerd = (av||[]).filter((a:any)=>a.geblokkeerd).length
  const afwMaand = (afwijkingen||[]).filter((a:any)=>String(a.datum||'').slice(0,7)===maand).length
  // Traceerbaarheid is pas aantoonbaar als de oefening periodiek herhaald is
  // (handboek hoofdstuk 11) — daarom staat de vervaldatum op het dashboard.
  const traceStatus = oefeningStatus(traceOefeningen||[], haccpInst, today)

  type Punt = {key:string, label:string, waarde:string|number, sub?:string, ok:boolean, kleur:string, tab:Tab}
  const punten: Punt[] = [
    {key:'vrijgave', label:t('haccp_dash_wacht_vrijgave'), waarde:wachtVrijgave, sub:t('haccp_ccp1_titel'),
     ok:!wachtVrijgave, kleur:'border-orange-500', tab:'kritisch'},
    {key:'sessies', label:t('haccp_dash_open_sessies'), waarde:openSessies, sub:t('haccp_sessie_titel'),
     ok:!openSessies, kleur:'border-blue-500', tab:'kritisch'},
    {key:'geblokkeerd', label:t('haccp_dash_geblokkeerd'), waarde:geblokkeerd, sub:t('haccp_ccp2_titel'),
     ok:!geblokkeerd, kleur:'border-red-500', tab:'kritisch'},
    {key:'afwijkingen', label:t('haccp_dash_afwijkingen'), waarde:afwMaand, sub:t('haccp_dash_deze_maand'),
     ok:!afwMaand, kleur:'border-orange-500', tab:'kritisch'},
    {key:'schoonmaak', label:t('haccp_dash_schoonmaak'), waarde:achterstallig, sub:t('haccp_dash_achterstallig'),
     ok:!achterstallig, kleur:'border-red-500', tab:'reiniging'},
    {key:'capa', label:t('haccp_dash_open_capa'), waarde:openCapa,
     ok:!openCapa, kleur:'border-orange-500', tab:'kritisch'},
    {key:'allergenen', label:t('haccp_dash_allergenen'), waarde:`${ingMetAll}/${ingTot}`, sub:t('haccp_dash_ingevuld'),
     ok:!(ingTot&&!ingMetAll), kleur:'border-orange-500', tab:'allergenen'},
    {key:'water', label:t('haccp_dash_water'), waarde:lastWater?fmtD(lastWater.datum):'-',
     sub:lastWater?t('haccp_dash_laatste_test'):t('haccp_dash_geen_tests'),
     ok:!waterOud, kleur:'border-orange-500', tab:'registers'},
    {key:'ongedierte', label:t('haccp_dash_ongedierte'), waarde:lastOngd?fmtD(lastOngd.datum):'-',
     sub:lastOngd?t('haccp_dash_laatste_controle'):t('haccp_dash_geen_controles'),
     ok:!ongdOud, kleur:'border-orange-500', tab:'registers'},
    {key:'trace', label:t('haccp_dash_trace'), waarde:traceStatus.laatste?fmtD(traceStatus.laatste.datum):'-',
     sub:traceStatus.verlopen?t('haccp_trace_oefening_verlopen'):t('haccp_trace_oefening_volgende').split('{d}').join(fmtD(traceStatus.volgende_voor||'')),
     ok:!traceStatus.verlopen, kleur:'border-orange-500', tab:'traceerbaarheid'},
    {key:'opleidingen', label:t('haccp_dash_opleidingen'), waarde:verlopen, sub:t('haccp_dash_verlopen'),
     ok:!verlopen, kleur:'border-red-500', tab:'registers'},
  ]

  const aandacht = punten.filter(p=>!p.ok)
  const inOrde = punten.filter(p=>p.ok)

  return (
    <div className="space-y-4">
      {!aandacht.length && (
        <div className="rounded-xl border-l-4 border-green-500 bg-white shadow-sm p-4">
          <div className="text-sm font-semibold text-gray-800">{t('haccp_dash_alles_in_orde')}</div>
          <div className="text-xs text-gray-500 mt-0.5">{t('haccp_dash_alles_in_orde_sub')}</div>
        </div>
      )}

      {!!aandacht.length && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {aandacht.map(p=>(
            <div key={p.key} onClick={()=>setTab(p.tab)}
              className={`rounded-xl border-l-4 p-4 bg-white shadow-sm cursor-pointer hover:shadow-md transition-shadow ${p.kleur}`}>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{p.label}</div>
              <div className="text-2xl font-bold text-gray-800">{p.waarde}</div>
              {p.sub && <div className="text-xs text-gray-500 mt-1">{p.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {!!inOrde.length && !!aandacht.length && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('haccp_dash_in_orde')}</div>
          <div className="flex flex-wrap gap-2">
            {inOrde.map(p=>(
              <button key={p.key} onClick={()=>setTab(p.tab)}
                className="bg-white border border-green-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:shadow-sm transition-shadow">
                <span className="text-green-600 mr-1">✓</span>{p.label}
                <span className="text-gray-400 ml-1.5">{p.waarde}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AllergenenTab({ing, bat, setBat, bi, setIng, producten, setProducten, auditLog, setAuditLog}: any) {
  const {useState} = React
  const [selBatch, setSelBatch] = useState<number>(0)

  const batchAllergenen = (batchId:number) => {
    const bis = (bi||[]).filter((b:any)=>b.batch_id===batchId)
    const allergs = new Set<string>()
    bis.forEach((b:any)=>{
      const ingredient = (ing||[]).find((i:any)=>i.id===b.ingredient_id)
      if(ingredient?.allergenen) ingredient.allergenen.forEach((a:string)=>allergs.add(a))
    })
    return Array.from(allergs)
  }

  const selAllergs = selBatch ? batchAllergenen(selBatch) : []
  const selBatchObj = selBatch ? (bat||[]).find((b:any)=>b.id===selBatch) : null

  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title={t('haccp_allergen_matrix')} />
        <div className="bg-white rounded-b-lg shadow-sm overflow-x-auto">
          {!(ing||[]).length ? <p className="p-4 text-sm text-gray-500 italic">{t('haccp_allergen_geen')}</p> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left p-2 font-semibold text-gray-600">{t('nav_ingredienten')}</th>
                {ALLERGENEN_LIJST.map(a=><th key={a.key} className="p-2 text-center font-semibold text-gray-600 whitespace-nowrap">{t(a.label)}</th>)}
                <th className="text-left p-2 font-semibold text-gray-600 whitespace-nowrap">{t('haccp_ing_toevoeging')}</th>
              </tr></thead>
              <tbody>
                {(ing||[]).map((i:any)=>(
                  <tr key={i.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-medium text-gray-800">{i.naam}</td>
                    {ALLERGENEN_LIJST.map(a=>(
                      <td key={a.key} className="p-2 text-center">
                        <input type="checkbox" className="t-checkbox"
                          checked={(i.allergenen||[]).includes(a.key)}
                          onChange={e=>{
                            const allergs = new Set(i.allergenen||[])
                            e.target.checked ? allergs.add(a.key) : allergs.delete(a.key)
                            const updated = Array.from(allergs)
                            setIng((prev:any[])=>prev.map((x:any)=>x.id===i.id?{...x,allergenen:updated}:x))
                            logAudit(auditLog,setAuditLog,{entiteit:'Ingredient',entiteit_id:i.id,actie:'gewijzigd',omschrijving:`Allergenen: ${i.naam}`})
                          }}
                        />
                      </td>
                    ))}
                    <td className="p-2">
                      <select value={i.haccp_toevoeging||''}
                        onChange={e=>{
                          const v = e.target.value || undefined
                          setIng((prev:any[])=>prev.map((x:any)=>x.id===i.id?{...x,haccp_toevoeging:v}:x))
                          logAudit(auditLog,setAuditLog,{entiteit:'Ingredient',entiteit_id:i.id,actie:'gewijzigd',omschrijving:`HACCP: ${i.naam}`})
                        }}
                        className="t-input text-xs px-2 py-1 rounded border">
                        <option value="">{t('haccp_toevoeging_geen')}</option>
                        {TOEVOEGING_SOORTEN.map(x=><option key={x.key} value={x.key}>{t(x.label)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">{t('haccp_ing_toevoeging_uitleg')}</p>
      </div>

      {/* Etiketallergenen per product — de bron waartegen CCP 3 vergelijkt */}
      <div>
        <SectionHeader title={t('haccp_product_allergenen')} />
        <div className="bg-white rounded-b-lg shadow-sm overflow-x-auto">
          {!(producten||[]).length ? (
            <p className="p-4 text-sm text-gray-500 italic">{t('haccp_allergen_geen')}</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="text-left p-2 font-semibold text-gray-600">{t('nav_producten')}</th>
                <th className="p-2 text-center font-semibold text-gray-600 whitespace-nowrap">{t('haccp_product_allergen_gecontroleerd')}</th>
                {ALLERGENEN_LIJST.map(a=><th key={a.key} className="p-2 text-center font-semibold text-gray-600 whitespace-nowrap">{t(a.label)}</th>)}
                <th className="text-left p-2 font-semibold text-gray-600 whitespace-nowrap">{t('haccp_ccp3_etiket_versie')}</th>
              </tr></thead>
              <tbody>
                {(producten||[]).filter((pr:any)=>pr.status!=='gearchiveerd').map((pr:any)=>{
                  // Ontbrekende lijst is iets anders dan een lege lijst: zolang
                  // hij niet is vastgelegd blokkeert de etiketcontrole met een
                  // eigen melding in plaats van een valse allergeenfout. Het
                  // vinkje hiernaast is de manier om "gecontroleerd, geen
                  // allergenen" vast te leggen zonder eerst een hokje aan en
                  // weer uit te zetten.
                  const gezet = Array.isArray(pr.allergenen)
                  return (
                    <tr key={pr.id} className={`border-b hover:bg-gray-50 ${gezet?'':'bg-orange-50'}`}>
                      <td className="p-2 font-medium text-gray-800">
                        {pr.naam}
                        {!gezet && <span className="ml-1 text-orange-600">·</span>}
                      </td>
                      <td className="p-2 text-center">
                        <input type="checkbox" className="t-checkbox" checked={gezet}
                          title={t('haccp_product_allergen_gecontroleerd_tip')}
                          onChange={e=>{
                            const aan = e.target.checked
                            setProducten((prev:any[])=>prev.map((x:any)=>{
                              if(x.id!==pr.id) return x
                              if(aan) return {...x, allergenen: x.allergenen||[], etiket_bijgewerkt: tod()}
                              // Uitzetten maakt het weer onbekend: de aangevinkte
                              // allergenen verdwijnen mee, anders zou er een lijst
                              // blijven staan die niemand gecontroleerd heeft.
                              const {allergenen, ...rest} = x
                              return rest
                            }))
                            logAudit(auditLog,setAuditLog,{entiteit:'Product',entiteit_id:pr.id,actie:'gewijzigd',omschrijving:`Etiket-allergenen ${aan?'gecontroleerd':'onbekend'}: ${pr.naam}`})
                          }} />
                      </td>
                      {ALLERGENEN_LIJST.map(a=>(
                        <td key={a.key} className="p-2 text-center">
                          <input type="checkbox" className="t-checkbox"
                            checked={(pr.allergenen||[]).includes(a.key)}
                            onChange={e=>{
                              const set = new Set(pr.allergenen||[])
                              e.target.checked ? set.add(a.key) : set.delete(a.key)
                              const updated = Array.from(set)
                              setProducten((prev:any[])=>prev.map((x:any)=>x.id===pr.id
                                ? {...x, allergenen:updated, etiket_bijgewerkt: tod()} : x))
                              logAudit(auditLog,setAuditLog,{entiteit:'Product',entiteit_id:pr.id,actie:'gewijzigd',omschrijving:`Etiket-allergenen: ${pr.naam}`})
                            }} />
                        </td>
                      ))}
                      <td className="p-2">
                        <input value={pr.etiket_versie||''}
                          onChange={e=>{
                            const v = e.target.value
                            setProducten((prev:any[])=>prev.map((x:any)=>x.id===pr.id?{...x,etiket_versie:v}:x))
                          }}
                          className="t-input text-xs px-2 py-1 rounded border w-20" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">{t('haccp_product_allergenen_uitleg')}</p>
      </div>

      <div>
        <SectionHeader title={t('haccp_allergen_batch_titel')} />
        <div className="bg-white rounded-b-lg shadow-sm p-4">
          <select value={selBatch} onChange={e=>setSelBatch(Number(e.target.value))} className="t-input text-sm px-3 py-1.5 rounded-lg border mb-3">
            <option value={0}>{t('haccp_allergen_selecteer_batch')}</option>
            {(bat||[]).map((b:any)=><option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
          {selBatch>0 && (
            <div>
              {selAllergs.length ? (
                <div>
                  <span className="text-sm text-gray-700">{t('haccp_allergen_batch_bevat')}:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selAllergs.map(a=><span key={a} className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-medium">{t(ALLERGENEN_LIJST.find(al=>al.key===a)?.label||a)}</span>)}
                  </div>
                </div>
              ) : <p className="text-sm text-gray-500">{t('haccp_allergen_batch_geen')}</p>}
              {selBatchObj && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_allergen_notities')}</label>
                  <textarea value={selBatchObj.allergeen_notities||''} onChange={e=>{
                    const v = e.target.value
                    setBat((prev:any[])=>(prev||[]).map((b:any)=>b.id===selBatch?{...b,allergeen_notities:v}:b))
                  }} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border" rows={2} placeholder={t('haccp_allergen_notities')} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Register van de drie kritische beheerspunten: vrijgaven, afvulsessies met
// hun sluit- en etiketcontroles, de afwijkingen en de CAPA's die daaruit
// volgen. De eerste drie zijn read-only — registreren gebeurt in de
// batchflow, op het moment dat de handeling plaatsvindt.
function KritischTab({bat, av, vrijgaven, sessies, sluitcontroles, etiketcontroles,
                      afwijkingen, traceOefeningen, breweryDetails,
                      capa, setCapa, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState, useMemo} = React
  const [sub, setSub] = useState<'vrijgaven'|'sessies'|'afwijkingen'|'capa'>('vrijgaven')
  const [fVan, setFVan] = useState('')
  const [fTot, setFTot] = useState('')

  const batchNaam = (id:number) => (bat||[]).find((b:any)=>b.id===id)?.naam || t('lbl_onbekend')
  // Waar in de workflow de blokkade omzeild is — leesbaar, niet de ruwe code.
  const bronLabel = (bron:string) => t(`haccp_bron_${bron}`) || bron
  const inPeriode = (d?:string) => (!fVan || (d||'') >= fVan) && (!fTot || (d||'') <= fTot)
  const tijd = (iso?:string) => iso ? new Date(iso).toLocaleString() : '—'

  const vrij = useMemo(() => (vrijgaven||[])
    .filter((v:any)=>inPeriode(v.datum))
    .slice().sort((a:any,b:any)=>String(b.datum||'').localeCompare(String(a.datum||''))),
    [vrijgaven, fVan, fTot])

  const sess = useMemo(() => (sessies||[])
    .filter((x:any)=>inPeriode(String(x.start||'').slice(0,10)))
    .slice().sort((a:any,b:any)=>String(b.start||'').localeCompare(String(a.start||''))),
    [sessies, fVan, fTot])

  const afw = useMemo(() => (afwijkingen||[])
    .filter((a:any)=>inPeriode(a.datum))
    .slice().sort((a:any,b:any)=>String(b.datum||'').localeCompare(String(a.datum||''))),
    [afwijkingen, fVan, fTot])

  // De traceeroefeningen horen bij dezelfde bewijslast: bij een controle is de
  // vraag of aantoonbaar is dát er periodiek getraceerd is (hoofdstuk 11).
  const oefeningen = useMemo(() => oefeningenNieuwsteEerst(
    geldigeOefeningen(traceOefeningen||[]).filter((o:any)=>inPeriode(o.datum))),
    [traceOefeningen, fVan, fTot])

  // Inspectie-export: alles van de gekozen periode in één afdruk. Bij een
  // controle is de vraag niet of de brouwer weet hoe het moet, maar of
  // aantoonbaar is dat het ook zo gedaan is.
  const printRapport = () => {
    const w = window.open('','_blank')
    if(!w) return
    const esc = (x:any) => String(x ?? '').replace(/[&<>]/g, (c:string) =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;'} as Record<string,string>)[c])
    const periode = fVan || fTot
      ? `${fVan ? fmtD(fVan) : '…'} — ${fTot ? fmtD(fTot) : '…'}`
      : t('haccp_rap_alle_data')
    const rijenVrij = vrij.map((v:any)=>`<tr>
      <td>${esc(fmtD(v.datum))}</td><td>${esc(batchNaam(v.batch_id))}</td>
      <td>${esc(t(v.risico_klasse==='verhoogd'?'haccp_risico_verhoogd':'haccp_risico_standaard'))}</td>
      <td>${esc(v.dagen_stabiel)}/${esc(v.vereiste_dagen_stabiel)}</td>
      <td>${v.ff_uitgevoerd ? esc(v.ff_verschil ?? '') : t('lbl_nee')}</td>
      <td class="${v.oordeel==='vrijgegeven'?'ok':'nok'}">${esc(t(v.oordeel==='vrijgegeven'?'haccp_ccp1_vrijgegeven':'haccp_ccp1_niet_vrijgegeven'))}${v.afwijking_id!=null?` (${esc(t('haccp_afw_kort'))})`:''}</td>
      <td>${esc(v.paraaf?.gebruiker||'')}</td></tr>`).join('')
    const rijenSess = sess.map((x:any)=>{
      const sc = (sluitcontroles||[]).filter((c:any)=>c.sessie_id===x.id)
      const ec = (etiketcontroles||[]).filter((c:any)=>c.sessie_id===x.id)
      const afgekeurd = sc.filter((c:any)=>c.resultaat==='afgekeurd').length
      return `<tr>
        <td>${esc(x.lotcode)}</td><td>${esc(batchNaam(x.batch_id))}</td>
        <td>${esc(tijd(x.start))}</td><td>${esc(x.eind?tijd(x.eind):'—')}</td>
        <td>${esc(x.tht?fmtD(x.tht):t('haccp_tht_klasse_geen'))}</td>
        <td>${sc.length}${afgekeurd?` <span class="nok">(${afgekeurd} ${esc(t('haccp_ccp2_afgekeurd'))})</span>`:''}</td>
        <td>${ec.length}</td>
        <td>${esc(t(`haccp_sessie_${x.status}`))}</td></tr>`
    }).join('')
    const rijenAfw = afw.map((a:any)=>`<tr>
      <td>${esc(fmtD(a.datum))}</td><td>${esc(bronLabel(a.bron))}</td>
      <td>${esc(a.batch_id?batchNaam(a.batch_id):'')}</td>
      <td>${esc(a.blokkade_omschrijving)}</td>
      <td>${esc(a.onderbouwing)}</td>
      <td>${esc(a.paraaf?.gebruiker||'')}</td></tr>`).join('')
    const rijenOef = oefeningen.map((o:any)=>`<tr>
      <td>${esc(fmtD(o.datum))}</td>
      <td>${esc(t(o.richting==='vooruit'?'haccp_trace_richting_vooruit':'haccp_trace_richting_terug'))}</td>
      <td>${esc(o.zoekterm)}</td>
      <td>${esc((o.lotcodes||[]).join(', '))}</td>
      <td class="${o.verantwoord_pct>=100?'ok':'nok'}">${esc(o.verantwoord)}/${esc(o.geproduceerd)} (${esc(o.verantwoord_pct)}%)</td>
      <td>${o.duur_minuten?esc(o.duur_minuten):'—'}</td>
      <td>${esc(o.conclusie)}</td>
      <td>${esc(o.paraaf?.gebruiker||'')}</td></tr>`).join('')
    w.document.write(`<html><head><title>${esc(t('haccp_rap_titel'))}</title><style>
      body{font-family:sans-serif;padding:24px;color:#222}
      h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px}
      .meta{font-size:11px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th,td{border:1px solid #ccc;padding:5px;text-align:left;font-size:11px;vertical-align:top}
      th{background:#f5f5f5} .ok{color:#15803d} .nok{color:#b91c1c;font-weight:600}
      .leeg{font-size:11px;color:#888;font-style:italic}
      @media print{body{padding:0}}
    </style></head><body>
      <h1>${esc(t('haccp_rap_titel'))}</h1>
      <div class="meta">${esc(breweryDetails?.naam||'')} · ${esc(t('haccp_rap_periode'))}: ${esc(periode)} · ${esc(new Date().toLocaleString())}</div>
      <h2>${esc(t('haccp_ccp1_titel'))}</h2>
      ${vrij.length?`<table><tr><th>${esc(t('lbl_datum'))}</th><th>Batch</th><th>${esc(t('haccp_ccp1_producttype'))}</th><th>${esc(t('haccp_ccp1_stabiel'))}</th><th>${esc(t('haccp_ccp1_ff'))}</th><th>${esc(t('haccp_ccp1_oordeel'))}</th><th>${esc(t('haccp_ccp1_paraaf'))}</th></tr>${rijenVrij}</table>`:`<p class="leeg">${esc(t('haccp_rap_geen'))}</p>`}
      <h2>${esc(t('haccp_sessie_titel'))} — ${esc(t('haccp_ccp2_titel'))} / ${esc(t('haccp_ccp3_titel'))}</h2>
      ${sess.length?`<table><tr><th>${esc(t('haccp_sessie_lotcode'))}</th><th>Batch</th><th>${esc(t('haccp_sessie_gestart'))}</th><th>${esc(t('haccp_sessie_afgesloten'))}</th><th>${esc(t('haccp_sessie_tht'))}</th><th>${esc(t('haccp_ccp2_titel'))}</th><th>${esc(t('haccp_ccp3_titel'))}</th><th>${esc(t('haccp_rap_status'))}</th></tr>${rijenSess}</table>`:`<p class="leeg">${esc(t('haccp_rap_geen'))}</p>`}
      <h2>${esc(t('haccp_tab_afwijkingen'))}</h2>
      ${afw.length?`<table><tr><th>${esc(t('lbl_datum'))}</th><th>${esc(t('haccp_rap_bron'))}</th><th>Batch</th><th>${esc(t('haccp_afw_geblokkeerd_omdat'))}</th><th>${esc(t('haccp_afw_onderbouwing'))}</th><th>${esc(t('haccp_ccp1_paraaf'))}</th></tr>${rijenAfw}</table>`:`<p class="leeg">${esc(t('haccp_rap_geen'))}</p>`}
      <h2>${esc(t('haccp_trace_oefening_titel'))}</h2>
      ${oefeningen.length?`<table><tr><th>${esc(t('lbl_datum'))}</th><th>${esc(t('haccp_rap_bron'))}</th><th>${esc(t('haccp_trace_zoekterm'))}</th><th>${esc(t('haccp_trace_lotcodes'))}</th><th>${esc(t('haccp_trace_balans_verantwoord'))}</th><th>${esc(t('haccp_trace_oefening_duur'))}</th><th>${esc(t('haccp_trace_oefening_conclusie'))}</th><th>${esc(t('haccp_ccp1_paraaf'))}</th></tr>${rijenOef}</table>`:`<p class="leeg">${esc(t('haccp_rap_geen'))}</p>`}
    </body></html>`)
    w.document.close()
    setTimeout(()=>w.print(), 400)
  }

  const Pill = ({ok, children}:{ok:boolean, children:React.ReactNode}) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ok?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{children}</span>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['vrijgaven','sessies','afwijkingen','capa'] as const).map(k=>(
          <button key={k} onClick={()=>setSub(k)}
            className={`px-3 py-1 rounded text-xs font-medium ${sub===k?'tbtn text-white':'bg-gray-100 text-gray-600'}`}>
            {t(k==='vrijgaven'?'haccp_tab_vrijgave':k==='sessies'?'haccp_tab_sessies':k==='afwijkingen'?'haccp_tab_afwijkingen':'haccp_capa')}
          </button>
        ))}
        {sub!=='capa' && <>
          <input type="date" value={fVan} onChange={e=>setFVan(e.target.value)}
            className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_van')} />
          <input type="date" value={fTot} onChange={e=>setFTot(e.target.value)}
            className="t-input text-xs px-2 py-1 rounded border" title={t('haccp_filter_tot')} />
          <Btn s="sm" v="secondary" cls="ml-auto" onClick={printRapport}>{t('haccp_rap_export')}</Btn>
        </>}
      </div>

      {sub==='vrijgaven' && (!vrij.length
        ? <p className="text-sm text-gray-500 italic">{t('haccp_ccp1_geen')}</p>
        : <div className="space-y-1">
            {vrij.map((v:any)=>(
              <div key={v.id} className={`bg-white rounded-lg p-2.5 shadow-sm text-sm border-l-4 ${v.oordeel==='vrijgegeven'?'border-green-500':'border-red-500'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{batchNaam(v.batch_id)}</span>
                    <Pill ok={v.oordeel==='vrijgegeven'}>
                      {t(v.oordeel==='vrijgegeven'?'haccp_ccp1_vrijgegeven':'haccp_ccp1_niet_vrijgegeven')}
                    </Pill>
                    {v.afwijking_id!=null && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                        {t('haccp_afw_kort')}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {t(v.risico_klasse==='verhoogd'?'haccp_risico_verhoogd':'haccp_risico_standaard')}
                      {' · '}{v.dagen_stabiel}/{v.vereiste_dagen_stabiel} {t('haccp_ccp1_dagen')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{fmtD(v.datum)} · {v.paraaf?.gebruiker||'—'}</span>
                </div>
                {v.sensorisch && <div className="text-xs text-gray-500 italic mt-1">{v.sensorisch}</div>}
              </div>
            ))}
          </div>)}

      {sub==='sessies' && (!sess.length
        ? <p className="text-sm text-gray-500 italic">{t('haccp_sessie_geen')}</p>
        : <div className="space-y-1">
            {sess.map((x:any)=>{
              const sc = (sluitcontroles||[]).filter((c:any)=>c.sessie_id===x.id)
              const ec = (etiketcontroles||[]).filter((c:any)=>c.sessie_id===x.id)
              const afgekeurd = sc.filter((c:any)=>c.resultaat==='afgekeurd').length
              const geblokkeerd = (av||[]).filter((a:any)=>a.sessie_id===x.id && a.geblokkeerd).length
              return (
                <div key={x.id} className="bg-white rounded-lg p-2.5 shadow-sm text-sm border-l-4"
                  style={{borderColor:'var(--t-accent)'}}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{x.lotcode}</span>
                      <span className="text-gray-600">{batchNaam(x.batch_id)}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {t(`haccp_sessie_${x.status}`)}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {x.tht ? `${t('haccp_sessie_tht')} ${fmtD(x.tht)}` : t('haccp_tht_klasse_geen')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
                    <span>{t('haccp_ccp2_titel')}: {sc.length}</span>
                    {!!afgekeurd && <span className="text-red-600 font-medium">{afgekeurd}× {t('haccp_ccp2_afgekeurd')}</span>}
                    <span>{t('haccp_ccp3_titel')}: {ec.length}</span>
                    {!!geblokkeerd && (
                      <span className="text-red-600 font-medium">
                        {t('haccp_ccp2_geblokkeerd').replace('{aantal}', String(geblokkeerd))}
                      </span>
                    )}
                    <span>{tijd(x.start)}{x.eind?` — ${tijd(x.eind)}`:''}</span>
                  </div>
                </div>
              )
            })}
          </div>)}

      {sub==='afwijkingen' && (!afw.length
        ? <p className="text-sm text-gray-500 italic">{t('haccp_rap_geen')}</p>
        : <div className="space-y-1">
            {afw.map((a:any)=>(
              <div key={a.id} className="bg-white rounded-lg p-2.5 shadow-sm text-sm border-l-4 border-orange-500">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-medium">
                    {a.batch_id ? batchNaam(a.batch_id) : t('lbl_onbekend')}
                    <span className="text-gray-400 font-normal ml-1.5 text-xs">{bronLabel(a.bron)}</span>
                  </span>
                  <span className="text-xs text-gray-400">{fmtD(a.datum)} · {a.paraaf?.gebruiker||'—'}</span>
                </div>
                <div className="text-xs text-red-700 mt-1">{a.blokkade_omschrijving}</div>
                <div className="text-xs text-gray-600 mt-0.5 italic">{a.onderbouwing}</div>
              </div>
            ))}
          </div>)}

      {sub==='capa' && (
        <CAPALijst capa={capa} setCapa={setCapa} auditLog={auditLog} setAuditLog={setAuditLog}
          modal={modal} setModal={setModal} edit={edit} setEdit={setEdit} />
      )}
    </div>
  )
}

// Corrigerende en preventieve maatregelen — hoort bij de kritische punten:
// elke afgekeurde controle en elke afwijking komt hier terecht.
function CAPALijst({capa, setCapa, auditLog, setAuditLog, modal, setModal, edit, setEdit}: any) {
  const {useState} = React
  const [fStatus, setFStatus] = useState('')

  const filtered = (capa||[]).filter((c:any)=>!fStatus||c.status===fStatus)
    .slice().sort((a:any,b:any)=>String(b.datum||'').localeCompare(String(a.datum||'')))
  const statusClr: Record<string,string> = {open:'bg-red-100 text-red-700',in_behandeling:'bg-orange-100 text-orange-700',afgerond:'bg-green-100 text-green-700'}

  const save = () => {
    if(!edit?.omschrijving) return
    if(edit.id && (capa||[]).some((c:any)=>c.id===edit.id)) {
      setCapa((prev:any[])=>prev.map((c:any)=>c.id===edit.id?{...c,...edit}:c))
      logAudit(auditLog,setAuditLog,{entiteit:'CAPA',entiteit_id:edit.id,actie:'gewijzigd',omschrijving:edit.omschrijving})
    } else {
      const id = newId(capa||[])
      setCapa((prev:any[])=>[...prev,{...edit,id,datum:edit.datum||tod()}])
      logAudit(auditLog,setAuditLog,{entiteit:'CAPA',entiteit_id:id,actie:'aangemaakt',omschrijving:edit.omschrijving})
    }
    setModal(null); setEdit(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Btn s="sm" onClick={()=>{setEdit({omschrijving:'',oorzaak:'',actie:'',verantwoordelijke:'',status:'open',datum:tod()});setModal('capa')}}>{t('haccp_capa_nieuw')}</Btn>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} className="t-input text-xs px-2 py-1 rounded border">
          <option value="">{t('haccp_capa_status')}</option>
          <option value="open">{t('haccp_capa_status_open')}</option>
          <option value="in_behandeling">{t('haccp_capa_status_in_behandeling')}</option>
          <option value="afgerond">{t('haccp_capa_status_afgerond')}</option>
        </select>
      </div>
      {!filtered.length && <p className="text-sm text-gray-500 italic">{t('haccp_capa_geen')}</p>}
      <div className="space-y-2">
        {filtered.map((c:any)=>(
          <div key={c.id} className="bg-white rounded-lg p-3 shadow-sm border-l-4" style={{borderColor:c.status==='afgerond'?'#22c55e':c.status==='in_behandeling'?'#f97316':'#ef4444'}}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <span className="font-medium text-sm">{c.omschrijving}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${statusClr[c.status]||''}`}>{t(`haccp_capa_status_${c.status}`)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{fmtD(c.datum)}</span>
                <Btn s="sm" v="ghost" onClick={()=>{setEdit({...c});setModal('capa')}}>{t('btn_edit')}</Btn>
              </div>
            </div>
            {c.actie && <div className="text-xs text-gray-600 mt-1">{c.actie}</div>}
            {c.verantwoordelijke && <div className="text-xs text-gray-400">{c.verantwoordelijke}</div>}
          </div>
        ))}
      </div>

      {modal==='capa' && edit && (
        <Modal title={edit.id?t('btn_edit'):t('haccp_capa_nieuw')} onClose={()=>{setModal(null);setEdit(null)}}>
          <div className="space-y-3">
            <Inp label={t('haccp_capa_omschrijving')} value={edit.omschrijving||''} onChange={v=>setEdit({...edit,omschrijving:v})} req />
            <Inp label={t('haccp_capa_oorzaak')} value={edit.oorzaak||''} onChange={v=>setEdit({...edit,oorzaak:v})} />
            <Inp label={t('haccp_capa_actie')} value={edit.actie||''} onChange={v=>setEdit({...edit,actie:v})} />
            <Inp label={t('haccp_capa_verantwoordelijke')} value={edit.verantwoordelijke||''} onChange={v=>setEdit({...edit,verantwoordelijke:v})} />
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('haccp_capa_status')}</label>
              <select value={edit.status||'open'} onChange={e=>setEdit({...edit,status:e.target.value,afgerond_datum:e.target.value==='afgerond'?tod():edit.afgerond_datum})} className="t-input w-full text-sm px-3 py-1.5 rounded-lg border">
                <option value="open">{t('haccp_capa_status_open')}</option>
                <option value="in_behandeling">{t('haccp_capa_status_in_behandeling')}</option>
                <option value="afgerond">{t('haccp_capa_status_afgerond')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="secondary" onClick={()=>{setModal(null);setEdit(null)}}>{t('btn_cancel')}</Btn>
              <Btn onClick={save}>{t('btn_save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default HACCPPage
