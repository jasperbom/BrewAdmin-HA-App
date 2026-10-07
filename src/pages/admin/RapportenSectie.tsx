import React from 'react'
import { t } from '../../i18n'
import { tod, ymd, r2, fmtD } from '../../utils/format'
import { newId, ADDON_BASE } from '../../utils/api'
import { resolveKlantSnapshot } from '../../utils/klant'
import { breweryMetTermijn } from '../../utils/facturen'
import { BUILTIN_KOSTEN_SOORTEN } from '../../utils/constants'
import { berekenWinstVerlies, ouderdomsAnalyse, berekenCogs } from '../../utils/calculations'
import { logAudit } from '../../utils/audit'
import { makeZip } from '../../utils/zip'
import { csvRij, csvTekst, csvBedrag, inkoopRegelExport } from '../../utils/csv'
import { btwPositieCent } from '../../utils/balans'
import { verkoopFactuurBoeking, inkoopFactuurBoeking, berekenWinstVerliesUitJournaal, centNaarEuro } from '../../utils/journaal'
import { buildFactuurHTML } from '../../components/PakbonExport'
import { useAdmin, fmt, card } from './adminContext'

// ── Rapporten (Administratie) ───────────────────────────────────────────────
// De financiële rapporten (het oude tabblad Financieel): winst & verlies met
// COGS, balans met jaarafsluiting, ouderdom, omzet per categorie,
// transactieoverzicht en journaal, met één periodefilter en de ZIP-export.
function RapportenSectie() {
  const {
    navDoel, inkoopFacturen, lots, onderdelen, verpakkingen, verkoopFacturen,
    bat, acc, breweryDetails, factuurLogo, klanten, kapitaalBoekingen,
    av, uit, bi, auditLog, setAuditLog, journaal,
    bankSaldi, jaarafsluitingen, setJaarafsluitingen, klantNaamVoor, totaleSchuldAltRekeningen, btwBetaaldePerioden,
    btwIngediendePerioden, btwPeriodeType,
  } = useAdmin()

  // Het rapport uit het navigatiedoel (tab), anders Winst & verlies.
  const RAPPORT_TABS = ['wv', 'balans', 'ouderdom', 'omzet_cat', 'transacties', 'journaal']
  // ── Rapporten tab state ────────────────────────────────────────────────────
  const [rapportTab, setRapportTab] = React.useState<string>(RAPPORT_TABS.includes(navDoel?.tab as string) ? (navDoel?.tab as string) : 'wv')
  const [rapportVan, setRapportVan] = React.useState(() => ymd(new Date(new Date().getFullYear(), 0, 1)))
  const [rapportTot, setRapportTot] = React.useState(() => tod())

  // W&V op journaalbasis (ERP-plan 2.1): het rapport leest uit de
  // onveranderlijke journaalregels. Fallback op de live berekening zolang het
  // journaal nog leeg is (verse installatie vóór de eenmalige opbouw).
  const berekenWv = (van: string, tot: string) => (journaal || []).length
    ? berekenWinstVerliesUitJournaal(journaal || [], acc || [], van, tot)
    : berekenWinstVerlies(verkoopFacturen || [], inkoopFacturen || [], acc || [], van, tot)

  // Exporteer alle boekhouding als ZIP (CSV's + PDF-bijlagen + factuur-HTML's)
  const exportAllesZip = async () => {
    const enc = new TextEncoder()
    const files: {name: string, data: Uint8Array}[] = []
    // Formule-veilig: klantnamen komen o.a. letterlijk uit de webshop-checkout.
    const csvRow = (cols: any[]) => csvRij(cols)

    // Helper: bouw transacties array (zelfde logica als subtab)
    const buildTxs = () => {
      const txs: {datum:string,dagboek:string,nummer:string,relatie:string,netto:number,btw:number,totaal:number}[] = []
      ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
        .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Inkoop',nummer:f.factuurnummer||`IF-${f.id}`,relatie:f.leverancier||'',netto:f.totaal_netto||0,btw:f.totaal_btw||0,totaal:f.totaal_bruto||0}))
      ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
        .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Verkoop',nummer:f.factuurnummer||`VF-${f.id}`,relatie:klantNaamVoor(f),netto:f.netto||0,btw:f.btw||0,totaal:f.bruto||0}))
      ;(acc||[]).filter((r:any)=>r.betaald===true&&r.datum>=rapportVan&&r.datum<=rapportTot)
        .forEach((r:any)=>{const tot=r.totaal_accijns||r.accijns||0;txs.push({datum:r.datum||'',dagboek:'Accijns',nummer:`ACC-${r.id}`,relatie:r.batch_naam||'',netto:tot,btw:0,totaal:tot})})
      return txs.sort((a,b)=>a.datum.localeCompare(b.datum))
    }

    // 1. Verkoopfacturen CSV
    const vfHdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_klant'),t('lbl_status'),t('lbl_description'),t('lbl_quantity'),t('lbl_prijs_per_stuk'),t('lbl_btw_pct'),t('lbl_netto'),t('lbl_btw_bedrag'),t('lbl_bruto')]
    const vfRows: any[][] = []
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      if ((f.regels||[]).length) {
        f.regels.forEach((r:any)=>vfRows.push([f.datum,f.factuurnummer||'',klantNaamVoor(f),f.status||'',r.omschrijving||'',r.hoeveelheid??'',r.prijs_per_stuk!=null?Number(r.prijs_per_stuk).toFixed(2):'',r.btw_pct??'',r.netto!=null?Number(r.netto).toFixed(2):'',r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',r.bruto!=null?Number(r.bruto).toFixed(2):'']))
      } else {
        vfRows.push([f.datum,f.factuurnummer||'',klantNaamVoor(f),f.status||'','','','','',f.netto!=null?Number(f.netto).toFixed(2):'',f.btw!=null?Number(f.btw).toFixed(2):'',f.bruto!=null?Number(f.bruto).toFixed(2):''])
      }
    })
    files.push({name:'csv/verkoopfacturen.csv', data: enc.encode('\uFEFF' + [vfHdr,...vfRows].map(csvRow).join('\n'))})

    // 2. Inkoopfacturen CSV
    const ifHdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_supplier'),t('lbl_description'),t('lbl_netto'),t('lbl_btw_pct'),t('lbl_btw_bedrag'),t('lbl_bruto')]
    const ifRows: any[][] = []
    ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      if ((f.regels||[]).length) {
        // Inkoopregels hebben naam/btw_tarief en geen bruto; alleen oude
        // boekingen omschrijving/btw_pct/totaal — inkoopRegelExport leest beide.
        f.regels.forEach((r:any)=>{
          const x = inkoopRegelExport(r)
          ifRows.push([f.datum,f.factuurnummer||'',f.leverancier||'',x.omschrijving,csvBedrag(x.netto),x.btwPct,csvBedrag(x.btwBedrag),csvBedrag(x.bruto)])
        })
      } else {
        ifRows.push([f.datum,f.factuurnummer||'',f.leverancier||'','',f.totaal_netto!=null?Number(f.totaal_netto).toFixed(2):'','',f.totaal_btw!=null?Number(f.totaal_btw).toFixed(2):'',f.totaal_bruto!=null?Number(f.totaal_bruto).toFixed(2):''])
      }
    })
    files.push({name:'csv/inkoopfacturen.csv', data: enc.encode('\uFEFF' + [ifHdr,...ifRows].map(csvRow).join('\n'))})

    // 3. Transactieoverzicht CSV
    const txs = buildTxs()
    const txHdr = [t('lbl_date'),t('lbl_dagboek'),t('lbl_invoice'),t('lbl_relatie'),t('lbl_netto'),t('lbl_btw'),t('lbl_total')]
    const txRows = txs.map(r=>[r.datum,r.dagboek,r.nummer,r.relatie,r.netto.toFixed(2),r.btw.toFixed(2),r.totaal.toFixed(2)])
    files.push({name:'csv/transactieoverzicht.csv', data: enc.encode('\uFEFF' + [txHdr,...txRows].map(csvRow).join('\n'))})

    // 4. Winst & Verlies CSV
    const wv = berekenWv(rapportVan, rapportTot)
    const wvData = [
      [t('lbl_omzet'), wv.omzet.toFixed(2)],
      [t('lbl_inkoopkosten'), (-wv.inkoopTotaal).toFixed(2)],
      ...Object.entries(wv.inkoopPerKostensoort).sort(([a],[b])=>a.localeCompare(b,'nl')).map(([ks,val])=>[
        `— ${BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_'+ks.toLowerCase()) : ks}`, (-val).toFixed(2)
      ]),
      [t('lbl_brutowinst'), wv.brutowinst.toFixed(2)],
      [t('lbl_accijns_kosten'), (-wv.accijnsKosten).toFixed(2)],
      [t('lbl_nettowinst'), wv.nettowinst.toFixed(2)],
    ]
    files.push({name:'csv/winst_verlies.csv', data: enc.encode('\uFEFF' + [['Post','Bedrag'],...wvData].map(csvRow).join('\n'))})

    // 5. Omzet per categorie CSV
    const catMap: Record<string,{aantal:number,netto:number,btw:number,bruto:number}> = {}
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      ;(f.regels||[]).forEach((r:any)=>{
        const cat = r.omschrijving||'Overig'
        if (!catMap[cat]) catMap[cat]={aantal:0,netto:0,btw:0,bruto:0}
        catMap[cat].aantal+=r.hoeveelheid||0; catMap[cat].netto+=r.netto||0; catMap[cat].btw+=r.btw_bedrag||0; catMap[cat].bruto+=r.bruto||0
      })
    })
    const omzetRows = Object.entries(catMap).sort((a,b)=>b[1].netto-a[1].netto).map(([cat,v])=>[cat,v.aantal,v.netto.toFixed(2),v.btw.toFixed(2),v.bruto.toFixed(2)])
    files.push({name:'csv/omzet_categorie.csv', data: enc.encode('\uFEFF' + [[t('lbl_categorie'),t('lbl_quantity'),t('lbl_netto'),t('lbl_btw'),t('lbl_bruto')],...omzetRows].map(csvRow).join('\n'))})

    // 6. Verkoopfacturen als HTML (printbaar naar PDF)
    const inst = (breweryDetails as any)||{}
    ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot).forEach((f:any)=>{
      const order = resolveKlantSnapshot(f, klanten)
      const html = buildFactuurHTML(order, f, breweryMetTermijn(f, klanten, inst), '', factuurLogo)
      const bestandsnaam = (f.factuurnummer||`VF-${f.id}`).replace(/[^a-zA-Z0-9_\-]/g,'_')
      files.push({name:`verkoopfacturen/${bestandsnaam}.html`, data: enc.encode(html)})
    })

    // 7. Inkoop bijlagen ophalen van server
    const fileBase = ADDON_BASE + 'api/file/'
    const bijlagePromises = (inkoopFacturen||[])
      .filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot&&f.bijlage?.bestand)
      .map(async (f:any) => {
        try {
          const res = await fetch(fileBase + f.bijlage.bestand)
          if (!res.ok) return
          const buf = await res.arrayBuffer()
          files.push({name:`inkoopfacturen/${f.bijlage.bestand}`, data: new Uint8Array(buf)})
        } catch {}
      })
    await Promise.all(bijlagePromises)

    // ZIP bouwen en downloaden
    const zip = makeZip(files)
    const a = Object.assign(document.createElement('a'),{
      href: URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer],{type:'application/zip'})),
      download: `boekhouding_${rapportVan}_${rapportTot}.zip`
    })
    a.click()
  }

  return (
    <div className="space-y-5">
        {/* Periode filter + sub-tabs */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={rapportVan} onChange={(e:any)=>setRapportVan(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={rapportTot} onChange={(e:any)=>setRapportTot(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="ml-auto flex items-end">
              <button onClick={exportAllesZip}
                className="px-3 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_alles_exporteren')}
              </button>
            </div>
          </div>
          <div className="flex gap-1 border-b border-gray-100 flex-wrap">
            {(['wv','balans','ouderdom','omzet_cat','transacties','journaal'] as const).map(tab => (
              <button key={tab} onClick={()=>setRapportTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${rapportTab===tab?'t-tab font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t(tab==='wv'?'tab_wv':tab==='balans'?'tab_balans':tab==='ouderdom'?'tab_ouderdom':tab==='omzet_cat'?'tab_omzet_cat':tab==='transacties'?'tab_transacties':'tab_journaal')}
              </button>
            ))}
          </div>
        </div>

        {/* Winst & Verlies */}
        {rapportTab==='wv' && (()=>{
          const wv = berekenWv(rapportVan, rapportTot)
          const ksRows = Object.entries(wv.inkoopPerKostensoort)
            .sort(([a],[b]) => a.localeCompare(b,'nl'))
            .map(([ks, val]) => ({
              label: `— ${BUILTIN_KOSTEN_SOORTEN.includes(ks) ? t('ks_'+ks.toLowerCase()) : ks}`,
              val: -val, indent: true
            }))
          const rows: {label:string,val:number,cls?:string,indent?:boolean,sep?:boolean}[] = [
            {label:t('lbl_omzet'), val:wv.omzet, cls:'text-green-700 font-semibold'},
            {label:t('lbl_inkoopkosten'), val:-wv.inkoopTotaal, sep:true},
            ...ksRows,
            {label:t('lbl_brutowinst'), val:wv.brutowinst, cls:wv.brutowinst>=0?'text-green-700 font-bold':'text-red-600 font-bold', sep:true},
            {label:t('lbl_accijns_kosten'), val:-wv.accijnsKosten},
            {label:t('lbl_nettowinst'), val:wv.nettowinst, cls:wv.nettowinst>=0?'text-green-700 font-bold text-base':'text-red-600 font-bold text-base', sep:true},
          ]
          const exportWvCSV = () => {
            const csv = csvTekst(rows.map(r=>[r.label, r.val.toFixed(2).replace('.',',')]))
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`wv_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }
          // COGS-optie (ERP-plan 2.6): marge op werkelijke kostprijs — de
          // uitgeleverde liters in de periode tegen de batchkostprijs.
          const cogs = berekenCogs(uit||[], bat||[], bi||[], lots, av, verpakkingen, onderdelen, acc, rapportVan, rapportTot)
          const brutomargeWerkelijk = wv.omzet - cogs.cogs
          const margePct = wv.omzet > 0 ? (brutomargeWerkelijk / wv.omzet) * 100 : null
          return (<>
            <div className={card}>
              <div className={`flex items-center justify-between ${(journaal||[]).length ? 'mb-1' : 'mb-4'}`}>
                <h3 className="font-semibold text-gray-800">{t('tab_wv')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportWvCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              {(journaal||[]).length > 0 && <div className="text-xs text-gray-400 mb-4">{t('wv_bron_journaal')}</div>}
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r,i) => (
                    <tr key={i} className={r.sep?'border-t border-gray-200':''}>
                      <td className={`py-2 ${r.indent?'pl-6 text-gray-500':r.sep?'font-semibold text-gray-700':'text-gray-700'}`}>{r.label}</td>
                      <td className={`py-2 text-right whitespace-nowrap ${r.cls||'text-gray-700'}`}>{fmt(r.val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Marge op werkelijke kostprijs (COGS, ERP-plan 2.6) */}
            <div className={card + ' mt-4'}>
              <h3 className="font-semibold text-gray-800 mb-1">{t('lbl_cogs_titel')}</h3>
              <p className="text-xs text-gray-400 mb-4">{t('cogs_uitleg')}</p>
              {cogs.aantalUitleveringen === 0 ? (
                <p className="text-sm text-gray-400">{t('msg_geen_uitleveringen_periode')}</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="py-2 text-gray-700">{t('lbl_omzet')}</td>
                      <td className="py-2 text-right whitespace-nowrap text-green-700 font-semibold">{fmt(wv.omzet)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-700">
                        {t('lbl_cogs')}
                        <span className="text-xs text-gray-400"> · {cogs.liters.toFixed(1)} L</span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap text-gray-700">{fmt(-cogs.cogs)}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="py-2 font-semibold text-gray-700">
                        {t('lbl_brutomarge_werkelijk')}
                        {margePct != null && <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${brutomargeWerkelijk>=0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{margePct.toFixed(1)}%</span>}
                      </td>
                      <td className={`py-2 text-right whitespace-nowrap font-bold ${brutomargeWerkelijk>=0?'text-green-700':'text-red-600'}`}>{fmt(brutomargeWerkelijk)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {cogs.litersZonderKostprijs > 0 && (
                <p className="text-xs text-orange-600 mt-2">⚠ {t('warn_cogs_onbekend').replace('{liters}', cogs.litersZonderKostprijs.toFixed(1))}</p>
              )}
            </div>
          </>)
        })()}

        {/* Balans */}
        {rapportTab==='balans' && (()=>{
          const boekjaar = new Date().getFullYear()
          const openVerkoop = (verkoopFacturen||[]).filter((f:any)=>f.status!=='betaald').reduce((s:number,f:any)=>s+(f.bruto||0),0)
          const voorraadWaarde = (lots||[]).filter((l:any)=>l.beschikbaar!==false&&l.hoeveelheid>0&&l.prijs_per_eenheid).reduce((s:number,l:any)=>s+(l.hoeveelheid||0)*(l.prijs_per_eenheid||0),0)
          // Liquide middelen uit de bij MT940-import vastgelegde eindsaldi (ERP-plan 2.3).
          const saldi = Object.values(bankSaldi||{}) as any[]
          const liquide = saldi.reduce((s:number,b:any)=>s+(Number(b?.eindsaldo)||0),0)
          // Crediteuren: openstaande inkoopfacturen (ERP-plan 2.3).
          const crediteuren = (inkoopFacturen||[]).filter((f:any)=>f.status!=='betaald').reduce((s:number,f:any)=>s+(f.totaal_bruto||0),0)
          const accijnsSchuld = (acc||[]).filter((r:any)=>!r.betaald).reduce((s:number,r:any)=>s+(r.totaal_accijns||r.accijns||0),0)
          const gestortKapitaal = (kapitaalBoekingen||[]).reduce((s:number,k:any)=>k.type==='storting'?s+k.bedrag:s-k.bedrag, 0)
          const schuldAltRek = totaleSchuldAltRekeningen
          // Nog af te dragen BTW (negatief = te vorderen) over de periodes
          // zonder gekoppelde BTW-betaling. Zonder deze post zat de BTW in het
          // eigen vermogen. Journaal leeg (verse installatie)? Dan dezelfde
          // boekingsbouwers op de facturen, zoals berekenWv terugvalt.
          const btwBron = (journaal||[]).length
            ? journaal
            : [...(verkoopFacturen||[]).flatMap((f:any)=>verkoopFactuurBoeking(f)), ...(inkoopFacturen||[]).flatMap((f:any)=>inkoopFactuurBoeking(f, btwPeriodeType))]
          // Afgerekend = BTW-betaling of -teruggave gekoppeld, of een ingediende
          // nihil-aangifte (afgerond € 0: er komt nooit een banktransactie).
          const btwAfgerekend = new Set<string>([...btwBetaaldePerioden,
            ...Object.values(btwIngediendePerioden).filter((a:any)=>Math.round(Number(a?.bedrag)||0)===0).map((a:any)=>String(a.periodeKey))])
          const btwSchuld = centNaarEuro(btwPositieCent(btwBron, btwAfgerekend, btwPeriodeType).cent)
          const totaalActiva = openVerkoop + voorraadWaarde + liquide
          const totaalPassiva = crediteuren + accijnsSchuld + btwSchuld + gestortKapitaal + schuldAltRek
          const eigenVermogen = totaalActiva - totaalPassiva

          // EV-verloop over het boekjaar: beginbalans uit de jaarafsluiting van
          // vorig jaar + resultaat van dit boekjaar (journaal-W&V). Het verschil
          // met het EV als sluitpost is de aansluitcontrole.
          const vorigeAfsluiting = (jaarafsluitingen||[]).find((j:any)=>Number(j.jaar)===boekjaar-1) || null
          const resultaatBoekjaar = berekenWv(`${boekjaar}-01-01`, `${boekjaar}-12-31`).nettowinst
          const evBerekend = vorigeAfsluiting ? (Number(vorigeAfsluiting.eigen_vermogen)||0) + resultaatBoekjaar : null
          const aansluitVerschil = evBerekend != null ? eigenVermogen - evBerekend : null

          const sluitBoekjaarAf = () => {
            const jaar = boekjaar - 1
            const bestaande = (jaarafsluitingen||[]).find((j:any)=>Number(j.jaar)===jaar)
            const vraag = t(bestaande ? 'confirm_jaar_opnieuw_afsluiten' : 'confirm_jaar_afsluiten').replace('{jaar}', String(jaar))
            if (!confirm(vraag)) return
            const nieuw = {
              id: newId(jaarafsluitingen||[]),
              jaar,
              afgesloten_op: new Date().toISOString(),
              eigen_vermogen: r2(eigenVermogen),
              balans: {
                debiteuren: r2(openVerkoop), voorraad: r2(voorraadWaarde), liquide: r2(liquide),
                crediteuren: r2(crediteuren), accijns_schuld: r2(accijnsSchuld), btw_schuld: r2(btwSchuld),
                schuld_alt_rekeningen: r2(schuldAltRek), gestort_kapitaal: r2(gestortKapitaal),
              },
            }
            setJaarafsluitingen((prev:any[]) => [...(prev||[]).filter((j:any)=>Number(j.jaar)!==jaar), nieuw])
            logAudit(auditLog, setAuditLog, {entiteit:'Jaarafsluiting', entiteit_id:nieuw.id, actie:'aangemaakt', omschrijving:`Boekjaar ${jaar} afgesloten (EV ${fmt(eigenVermogen)})`})
          }

          const afsluitingen = [...(jaarafsluitingen||[])].sort((a:any,b:any)=>Number(b.jaar)-Number(a.jaar))
          return (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_activa')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_liquide_middelen')}</td><td className="py-1.5 text-right font-medium">{fmt(liquide)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_debiteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(openVerkoop)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_voorraden_indicatief')}</td><td className="py-1.5 text-right font-medium">{fmt(voorraadWaarde)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalActiva)}</td></tr>
                </tbody></table>
                {saldi.length > 0
                  ? <p className="text-xs text-gray-400 mt-2">{saldi.map((b:any)=>`${b.iban}: ${fmt(b.eindsaldo)} (${b.datum})`).join(' · ')}</p>
                  : <p className="text-xs text-gray-400 mt-2 italic">{t('lbl_bank_saldo_geen')}</p>}
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_passiva')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_crediteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(crediteuren)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_accijns_schuld')}</td><td className="py-1.5 text-right font-medium">{fmt(accijnsSchuld)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{btwSchuld < 0 ? t('lbl_btw_vordering') : t('lbl_btw_schuld')}</td><td className="py-1.5 text-right font-medium">{fmt(btwSchuld)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_schuld_alt_rekeningen')}</td><td className={`py-1.5 text-right font-medium ${schuldAltRek>0.005?'text-orange-600':'text-gray-400'}`}>{fmt(schuldAltRek)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_gestort_kapitaal')}</td><td className={`py-1.5 text-right font-medium ${gestortKapitaal>=0?'text-purple-600':'text-red-600'}`}>{fmt(gestortKapitaal)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_eigen_vermogen')}</td><td className={`py-1.5 text-right font-medium ${eigenVermogen>=0?'text-green-600':'text-red-600'}`}>{fmt(eigenVermogen)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalPassiva+eigenVermogen)}</td></tr>
                </tbody></table>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {/* Eigen vermogen — verloop boekjaar (aansluitcontrole) */}
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_ev_verloop').replace('{jaar}', String(boekjaar))}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_ev_begin').replace('{jaar}', String(boekjaar-1))}</td>
                    <td className="py-1.5 text-right font-medium">{vorigeAfsluiting ? fmt(vorigeAfsluiting.eigen_vermogen) : '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_resultaat_boekjaar')}</td>
                    <td className={`py-1.5 text-right font-medium ${resultaatBoekjaar>=0?'text-green-600':'text-red-600'}`}>{fmt(resultaatBoekjaar)}</td>
                  </tr>
                  <tr className="border-t border-gray-200">
                    <td className="py-2 font-semibold text-gray-700">{t('lbl_ev_berekend')}</td>
                    <td className="py-2 text-right font-semibold">{evBerekend != null ? fmt(evBerekend) : '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">{t('lbl_ev_volgens_balans')}</td>
                    <td className="py-1.5 text-right font-medium">{fmt(eigenVermogen)}</td>
                  </tr>
                  {aansluitVerschil != null && (
                    <tr>
                      <td className="py-1.5 text-gray-600">{t('lbl_aansluitverschil')}</td>
                      <td className={`py-1.5 text-right font-medium ${Math.abs(aansluitVerschil)<=0.005?'text-green-600':'text-orange-600'}`}>{fmt(aansluitVerschil)}</td>
                    </tr>
                  )}
                </tbody></table>
                {!vorigeAfsluiting && <p className="text-xs text-gray-400 mt-2 italic">{t('msg_geen_afsluiting').replace('{jaar}', String(boekjaar-1))}</p>}
              </div>

              {/* Jaarafsluitingen */}
              <div className={card}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-700">{t('lbl_jaarafsluitingen')}</h3>
                  <button onClick={sluitBoekjaarAf}
                    className="px-3 py-1.5 tbtn rounded-lg text-xs font-medium transition-colors">
                    {t('btn_jaar_afsluiten').replace('{jaar}', String(boekjaar-1))}
                  </button>
                </div>
                {afsluitingen.length === 0
                  ? <p className="text-sm text-gray-400">{t('msg_geen_afsluiting').replace('{jaar}', String(boekjaar-1))}</p>
                  : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-xs text-gray-500">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_boekjaar')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_afgesloten_op')}</th>
                        <th className="py-1.5 text-right font-medium">{t('lbl_eigen_vermogen')}</th>
                      </tr></thead>
                      <tbody>
                        {afsluitingen.map((j:any)=>(
                          <tr key={j.id} className="border-b border-gray-50">
                            <td className="py-1.5 pr-3 font-medium text-gray-700">{j.jaar}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{fmtD(String(j.afgesloten_op||'').slice(0,10))}</td>
                            <td className={`py-1.5 text-right font-medium ${j.eigen_vermogen>=0?'text-green-600':'text-red-600'}`}>{fmt(j.eigen_vermogen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                <p className="text-xs text-gray-400 mt-2 italic">{t('msg_afsluiting_hint')}</p>
              </div>
            </div>
          </>)
        })()}

        {/* Ouderdomsanalyse debiteuren/crediteuren (ERP-plan 2.5) */}
        {rapportTab==='ouderdom' && (()=>{
          const vandaag = tod()
          const debiteuren = ouderdomsAnalyse(
            (verkoopFacturen||[])
              .filter((f:any)=>f.status!=='betaald')
              .map((f:any)=>({relatie: klantNaamVoor(f) || t('lbl_onbekend'), bedrag: f.bruto||0, datum: f.datum})),
            vandaag)
          const crediteuren = ouderdomsAnalyse(
            (inkoopFacturen||[])
              .filter((f:any)=>f.status!=='betaald')
              .map((f:any)=>({relatie: f.leverancier || t('lbl_onbekend'), bedrag: f.totaal_bruto||0, datum: f.datum})),
            vandaag)
          const buckets = ['b0_30','b31_60','b61_90','b90plus'] as const
          const bucketLabels = [t('lbl_b0_30'), t('lbl_b31_60'), t('lbl_b61_90'), t('lbl_b90plus')]
          const exportOuderdomCSV = () => {
            const hdr = ['', ...bucketLabels, t('lbl_total')]
            const rij = (r: any) => [r.relatie, ...buckets.map(b=>Number(r[b]).toFixed(2).replace('.',',')), Number(r.totaal).toFixed(2).replace('.',',')]
            const rows: any[] = [[t('lbl_debiteuren')], hdr, ...debiteuren.rijen.map(rij), rij({...debiteuren.totalen, relatie: t('lbl_total')}),
              [], [t('lbl_crediteuren')], hdr, ...crediteuren.rijen.map(rij), rij({...crediteuren.totalen, relatie: t('lbl_total')})]
            // Formule-veilig: de relatie is o.a. een klantnaam uit de webshop.
            const csv = csvTekst(rows)
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`ouderdom_${vandaag}.csv`})
            a.click()
          }
          const tabel = (titel: string, analyse: any) => (
            <div className={card}>
              <h3 className="font-semibold text-gray-700 mb-3">{titel}</h3>
              {analyse.rijen.length === 0
                ? <p className="text-sm text-gray-400 py-4">{t('msg_geen_open_posten')}</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead><tr className="border-b text-xs text-gray-500">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_relatie')}</th>
                        {bucketLabels.map((l,i)=><th key={i} className="py-1.5 pr-3 text-right font-medium">{l}</th>)}
                        <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                      </tr></thead>
                      <tbody>
                        {analyse.rijen.map((r: any, i: number)=>(
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5 pr-3 text-gray-700">{r.relatie || t('lbl_onbekend')}</td>
                            {buckets.map(b=>(
                              <td key={b} className={`py-1.5 pr-3 text-right ${!r[b] ? 'text-gray-300' : b==='b90plus' ? 'text-red-600 font-medium' : b==='b61_90' ? 'text-orange-600' : 'text-gray-700'}`}>
                                {r[b] ? fmt(r[b]) : '—'}
                              </td>
                            ))}
                            <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(r.totaal)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td className="py-2 pr-3 text-gray-700">{t('lbl_total')}</td>
                        {buckets.map(b=>(
                          <td key={b} className={`py-2 pr-3 text-right ${b==='b90plus' && analyse.totalen[b] ? 'text-red-600' : ''}`}>{fmt(analyse.totalen[b])}</td>
                        ))}
                        <td className="py-2 text-right">{fmt(analyse.totalen.totaal)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                )}
            </div>
          )
          return (<>
            <div className={card}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">{t('tab_ouderdom')}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t('ouderdom_uitleg')}</p>
                </div>
                <button onClick={exportOuderdomCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
              {tabel(t('lbl_debiteuren'), debiteuren)}
              {tabel(t('lbl_crediteuren'), crediteuren)}
            </div>
          </>)
        })()}

        {/* Omzet per categorie */}
        {rapportTab==='omzet_cat' && (()=>{
          const catMap: Record<string,{aantal:number,netto:number,btw:number,bruto:number}> = {}
          ;(verkoopFacturen||[])
            .filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>{
              ;(f.regels||[]).forEach((r:any)=>{
                const cat = r.omschrijving||'Overig'
                if (!catMap[cat]) catMap[cat]={aantal:0,netto:0,btw:0,bruto:0}
                catMap[cat].aantal += r.hoeveelheid||0
                catMap[cat].netto += r.netto||0
                catMap[cat].btw += r.btw_bedrag||0
                catMap[cat].bruto += r.bruto||0
              })
            })
          const cats = Object.entries(catMap).sort((a,b)=>b[1].netto-a[1].netto)
          const maxNetto = cats.length > 0 ? Math.max(...cats.map(([,v])=>v.netto)) : 1
          if (cats.length === 0) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('msg_no_rapport_data')}</div>
          return (
            <div className={card}>
              <h3 className="font-semibold text-gray-800 mb-4">{t('tab_omzet_cat')}</h3>
              <div className="space-y-3">
                {cats.map(([cat,v]) => (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700 font-medium">{cat}</span>
                      <span className="text-sm text-gray-500">{fmt(v.netto)} <span className="text-xs text-gray-400">+ {fmt(v.btw)} BTW</span></span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${Math.round(v.netto/maxNetto*100)}%`, backgroundColor:'var(--t-accent)'}} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead><tr className="border-b text-xs text-gray-500">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_categorie')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_quantity')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_bruto')}</th>
                  </tr></thead>
                  <tbody>
                    {cats.map(([cat,v]) => (
                      <tr key={cat} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 font-medium text-gray-800">{cat}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-600">{v.aantal}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(v.netto)}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(v.btw)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(v.bruto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Transactieoverzicht */}
        {rapportTab==='transacties' && (()=>{
          type TxRij = {datum:string,dagboek:string,nummer:string,relatie:string,netto:number,btw:number,totaal:number}
          const txs: TxRij[] = []
          ;(inkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Inkoop',nummer:f.factuurnummer||`IF-${f.id}`,relatie:f.leverancier||'—',netto:f.totaal_netto||0,btw:f.totaal_btw||0,totaal:f.totaal_bruto||0}))
          ;(verkoopFacturen||[]).filter((f:any)=>f.datum>=rapportVan&&f.datum<=rapportTot)
            .forEach((f:any)=>txs.push({datum:f.datum||'',dagboek:'Verkoop',nummer:f.factuurnummer||`VF-${f.id}`,relatie:klantNaamVoor(f)||'—',netto:f.netto||0,btw:f.btw||0,totaal:f.bruto||0}))
          ;(acc||[]).filter((r:any)=>r.betaald===true&&r.datum>=rapportVan&&r.datum<=rapportTot)
            .forEach((r:any)=>{const tot=r.totaal_accijns||r.accijns||0;txs.push({datum:r.datum||'',dagboek:'Accijns',nummer:`ACC-${r.id}`,relatie:r.batch_naam||'—',netto:tot,btw:0,totaal:tot})})
          ;(kapitaalBoekingen||[]).filter((k:any)=>k.datum>=rapportVan&&k.datum<=rapportTot)
            .forEach((k:any)=>{const bedrag=k.type==='storting'?k.bedrag:-k.bedrag;txs.push({datum:k.datum||'',dagboek:'Kapitaal',nummer:`KAP-${k.id}`,relatie:k.eigenaar||'—',netto:bedrag,btw:0,totaal:bedrag})})
          txs.sort((a,b)=>a.datum.localeCompare(b.datum))

          const totNetto=txs.reduce((s,r)=>s+r.netto,0)
          const totBtw=txs.reduce((s,r)=>s+r.btw,0)
          const totTotaal=txs.reduce((s,r)=>s+r.totaal,0)

          const exportTxCSV = () => {
            // Formule-veilig én met verdubbelde aanhalingstekens: een naam als
            // Café "De Kroon" schoof hier eerder de kolommen op.
            const hdr = [t('lbl_date'),t('lbl_dagboek'),t('lbl_invoice'),t('lbl_relatie'),t('lbl_netto'),t('lbl_btw'),t('lbl_total')]
            const rows = txs.map(r=>[r.datum, r.dagboek, r.nummer, r.relatie, r.netto.toFixed(2).replace('.',','), r.btw.toFixed(2).replace('.',','), r.totaal.toFixed(2).replace('.',',')])
            const csv = csvTekst([hdr,...rows])
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`transactieoverzicht_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }

          if (!txs.length) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('msg_no_rapport_data')}</div>
          return (
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">{t('tab_transacties')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportTxCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead><tr className="border-b text-xs text-gray-500">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_dagboek')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_invoice')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_relatie')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                  </tr></thead>
                  <tbody>
                    {txs.map((r,i)=>(
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.datum}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${r.dagboek==='Verkoop'?'bg-green-100 text-green-700':r.dagboek==='Inkoop'?'bg-blue-100 text-blue-700':r.dagboek==='Kapitaal'?'bg-purple-100 text-purple-700':'bg-orange-100 text-orange-700'}`}>{r.dagboek}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-700 font-mono text-xs">{r.nummer}</td>
                        <td className="py-1.5 pr-3 text-gray-700">{r.relatie}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(r.netto)}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(r.btw)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(r.totaal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="py-2 pr-3 text-gray-700" colSpan={4}>{t('lbl_total')}</td>
                    <td className="py-2 pr-3 text-right">{fmt(totNetto)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(totBtw)}</td>
                    <td className="py-2 text-right">{fmt(totTotaal)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Journaal (ERP-plan 2.1): onveranderlijke boekingen, append-only */}
        {rapportTab==='journaal' && (()=>{
          const regels = (journaal||[])
            .filter((r: any) => r.datum >= rapportVan && r.datum <= rapportTot)
            .sort((a: any, b: any) => b.datum.localeCompare(a.datum) || (b.id - a.id))
          const dagboekLabel = (d: string) => t(`jr_${d}`) !== `jr_${d}` ? t(`jr_${d}`) : d
          const dagboekCls: Record<string,string> = {
            verkoop:'bg-green-100 text-green-700', inkoop:'bg-blue-100 text-blue-700',
            accijns:'bg-purple-100 text-purple-700', btw:'bg-orange-100 text-orange-700',
            memoriaal:'bg-gray-100 text-gray-600',
          }
          const totNetto = regels.reduce((s: number, r: any)=>s+(r.netto_cent||0),0)
          const totBtw = regels.reduce((s: number, r: any)=>s+(r.btw_cent||0),0)
          const totBruto = regels.reduce((s: number, r: any)=>s+(r.bruto_cent||0),0)
          const exportJournaalCSV = () => {
            // Formule-veilig: de relatie is o.a. een klantnaam uit de webshop.
            const hdr = [t('lbl_date'),t('lbl_dagboek'),t('lbl_invoice'),t('lbl_relatie'),t('lbl_omschrijving'),t('lbl_netto'),t('lbl_btw'),t('lbl_total')]
            const rows = regels.map((r: any)=>[r.datum, dagboekLabel(r.dagboek), r.nummer||'', r.relatie||'', r.omschrijving||'', centNaarEuro(r.netto_cent).toFixed(2).replace('.',','), centNaarEuro(r.btw_cent).toFixed(2).replace('.',','), centNaarEuro(r.bruto_cent).toFixed(2).replace('.',',')])
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csvTekst([hdr,...rows])],{type:'text/csv;charset=utf-8'})),download:`journaal_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }
          if (!regels.length) return <div className={card+' text-center py-10 text-gray-400 text-sm'}>{t('journaal_leeg')}</div>
          return (
            <div className={card}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-800">{t('tab_journaal')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportJournaalCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
              <div className="text-xs text-gray-400 mb-4">{t('journaal_uitleg')}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead><tr className="border-b text-xs text-gray-500">
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_dagboek')}</th>
                    <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_omschrijving')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-1.5 text-right font-medium">{t('lbl_total')}</th>
                  </tr></thead>
                  <tbody>
                    {regels.map((r: any)=>(
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.datum}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${dagboekCls[r.dagboek]||'bg-gray-100 text-gray-600'}`}>{dagboekLabel(r.dagboek)}</span>
                          {r.storno_van != null && <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('jr_storno')}</span>}
                          {r.migratie && <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t('jr_migratie')}</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-700">
                          {r.omschrijving}
                          {(r.kostensoort || r.btw_tarief != null) && <span className="text-xs text-gray-400"> · {[r.kostensoort, r.btw_tarief != null ? `${r.btw_tarief}%` : null].filter(Boolean).join(' · ')}</span>}
                        </td>
                        <td className={`py-1.5 pr-3 text-right ${r.netto_cent<0?'text-red-600':'text-gray-700'}`}>{fmt(centNaarEuro(r.netto_cent))}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">{fmt(centNaarEuro(r.btw_cent))}</td>
                        <td className={`py-1.5 text-right font-semibold ${r.bruto_cent<0?'text-red-600':'text-gray-900'}`}>{fmt(centNaarEuro(r.bruto_cent))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="py-2 pr-3 text-gray-700" colSpan={3}>{t('lbl_total')}</td>
                    <td className="py-2 pr-3 text-right">{fmt(centNaarEuro(totNetto))}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(centNaarEuro(totBtw))}</td>
                    <td className="py-2 text-right">{fmt(centNaarEuro(totBruto))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )
        })()}
    </div>
  );
}

export default RapportenSectie
