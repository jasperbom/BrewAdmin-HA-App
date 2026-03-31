import React from 'react'
import { t } from '../i18n'
import { getLang } from '../i18n'
import { tod } from '../utils/format'
import { newId, wcGet, wcPut, ADDON_BASE } from '../utils/api'
import { BUILTIN_ING_TYPES } from '../utils/constants'
import { berekenWinstVerlies } from '../utils/calculations'
import InkoopFactuurModal from '../components/InkoopFactuurModal'
import Modal from '../components/ui/Modal'
import AccijnsPage from './AccijnsPage'

function BoekhoudingPage({wcCreds, inkoopFacturen=[], setInkoopFacturen=()=>{}, ing=[], setIng=()=>{}, lots=[], setLots=()=>{}, onderdelen=[], setOnderdelen=()=>{}, log=[], setLog=()=>{}, btwInst={}, claudeCreds=null, ingTypes=BUILTIN_ING_TYPES, ingTypeBtw={}, verkoopFacturen=[], setVerkoopFacturen=()=>{}, bestellingen=[], setPage=()=>{}, setOpenOrderId=()=>{}, bat=[], acc=[], setAcc=()=>{}, breweryDetails={}, factuurLogo=null, klanten=[], setKlanten=()=>{}}: any) {
  const now = new Date();
  const firstOfYear = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const [dateFrom, setDateFrom] = React.useState(firstOfYear);
  const [dateTo, setDateTo] = React.useState(now.toISOString().slice(0,10));
  const [mainTab, setMainTab] = React.useState('verkoop');
  const [inkoopSortDesc, setInkoopSortDesc] = React.useState(true);
  const [expandedFactuur, setExpandedFactuur] = React.useState(null);
  // Aangiftes tab state
  const [aangifteYear, setAangifteYear] = React.useState(new Date().getFullYear());
  const [aangifteOrders, setAangifteOrders] = React.useState([]);
  const [aangifteLoading, setAangifteLoading] = React.useState(false);
  const [aangifteError, setAangifteError] = React.useState('');
  const [aangifteFetched, setAangifteFetched] = React.useState(false);
  const [showVrijeFactuur, setShowVrijeFactuur] = React.useState(false);
  const [editingFactuur, setEditingFactuur] = React.useState(null);
  const [bijlageUploading, setBijlageUploading] = React.useState(null); // factuur id
  const [showLosseFactuur, setShowLosseFactuur] = React.useState(false);
  const emptyLosseRegel = () => ({omschrijving:'', hoeveelheid:'1', prijs_per_stuk:'', btw_pct:'21'})
  const emptyLosseFactuur = () => ({datum:tod(), factuurnummer:'', klant_id:null, klant_naam:'', klant_straat:'', klant_postcode:'', klant_stad:'', klant_btw_nummer:'', regels:[emptyLosseRegel()]})
  const [losseFactuurForm, setLosseFactuurForm] = React.useState<any>(emptyLosseFactuur())

  // ── Klanten tab state ──────────────────────────────────────────────────────
  const [showKlantModal, setShowKlantModal] = React.useState(false)
  const [editingKlant, setEditingKlant] = React.useState<any>(null)
  const [viewingKlantId, setViewingKlantId] = React.useState<number|null>(null)
  const emptyKlantForm = () => ({naam:'', straat:'', postcode:'', stad:'', btw_nummer:'', email:'', telefoon:'', betalingstermijn:''})
  const [klantForm, setKlantForm] = React.useState<any>(emptyKlantForm())

  // ── Bank tab state ─────────────────────────────────────────────────────────
  const bankFileRef = React.useRef<any>(null)
  const [bankAfschrift, setBankAfschrift] = React.useState<any>(null)
  const [bankTransacties, setBankTransacties] = React.useState<any[]>([])

  // ── Rapporten tab state ────────────────────────────────────────────────────
  const [rapportTab, setRapportTab] = React.useState('wv')
  const [rapportVan, setRapportVan] = React.useState(() => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10))
  const [rapportTot, setRapportTot] = React.useState(() => new Date().toISOString().slice(0,10))

  const addLog = (entry: any) => setLog((prev: any)=>[...prev,{id:newId(prev||[]),datum:tod(),...entry}]);

  const uploadBijlageVoorFactuur = async (factuurId: any, file: any) => {
    setBijlageUploading(factuurId);
    try {
      const ext = (file.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const filename = `${factuurId}_${Date.now()}.${ext||'bin'}`;
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: b64}),
      });
      if (resp.ok) {
        setInkoopFacturen((prev: any) => prev.map((f: any) =>
          f.id === factuurId ? {...f, bijlage: {naam: file.name, bestand: filename}} : f
        ));
      }
    } catch(e) { /* upload failed silently */ }
    setBijlageUploading(null);
  };

  const knownLeveranciers = React.useMemo(() =>
    [...new Set(inkoopFacturen.map((f: any)=>f.leverancier).filter(Boolean))].sort(), [inkoopFacturen]);

  // ── Inkoop computed values ──────────────────────────────────────────────
  const inkoopGefilterd = React.useMemo(() =>
    inkoopFacturen
      .filter((f: any) => f.datum >= dateFrom && f.datum <= dateTo)
      .sort((a: any,b: any) => inkoopSortDesc ? b.datum.localeCompare(a.datum) : a.datum.localeCompare(b.datum)),
    [inkoopFacturen, dateFrom, dateTo, inkoopSortDesc]
  );

  const inkoopTotals = React.useMemo(() =>
    inkoopGefilterd.reduce((s: any,f: any) => ({
      netto: s.netto + (f.totaal_netto||0),
      btw:   s.btw   + (f.totaal_btw||0),
      bruto: s.bruto + (f.totaal_bruto||0),
    }), {netto:0, btw:0, bruto:0}),
    [inkoopGefilterd]
  );

  const btwPerTarief = React.useMemo(() => {
    const map: any = {};
    inkoopGefilterd.forEach((f: any) => (f.regels||[]).forEach((r: any) => {
      const k = r.btw_tarief ?? 0;
      if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
      map[k].netto += r.netto||0;
      map[k].btw   += r.btw_bedrag||0;
    }));
    return Object.values(map).sort((a: any,b: any)=>a.tarief-b.tarief);
  }, [inkoopGefilterd]);

  const btwPerTariefAangifte = React.useMemo(() => {
    const map: any = {};
    inkoopFacturen
      .filter((f: any) => f.datum?.startsWith(String(aangifteYear)))
      .forEach((f: any) => (f.regels||[]).forEach((r: any) => {
        const k = r.btw_tarief ?? 0;
        if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
        map[k].netto += r.netto||0;
        map[k].btw   += r.btw_bedrag||0;
      }));
    return Object.values(map).sort((a: any,b: any)=>a.tarief-b.tarief);
  }, [inkoopFacturen, aangifteYear]);

  const omzetBtwPerTarief = React.useMemo(() => {
    const yearStr = String(aangifteYear);
    const hoog = {netto: 0, btw: 0}; // 21%
    const laag = {netto: 0, btw: 0}; // 9%

    // Eigen verkoopfacturen — split per btw_pct via regels
    (verkoopFacturen||[])
      .filter((f: any) => f.datum?.startsWith(yearStr))
      .forEach((f: any) => {
        (f.regels||[]).forEach((r: any) => {
          const pct = r.btw_pct ?? 0;
          const netto = r.netto ?? 0;
          const btw = r.btw_bedrag ?? 0;
          if (pct >= 20) { hoog.netto += netto; hoog.btw += btw; }
          else if (pct > 0) { laag.netto += netto; laag.btw += btw; }
        });
      });

    // WooCommerce orders — splitsing via tax_lines (rate_percent per belastingregel)
    aangifteOrders
      .filter((o: any) => {
        const d = ((o as any).date_paid||(o as any).date_created||'').slice(0,4);
        return d === yearStr && ['completed','processing'].includes((o as any).status);
      })
      .forEach((o: any) => {
        const taxLines: any[] = (o as any).tax_lines || [];
        if (taxLines.length > 0) {
          // tax_lines aanwezig → splitsing per tarief
          taxLines.forEach((tl: any) => {
            const pct = parseFloat(tl.rate_percent || 0);
            const btwBedrag = parseFloat(tl.tax_total || 0) + parseFloat(tl.shipping_tax_total || 0);
            const nettoBedrag = pct > 0 ? btwBedrag / (pct / 100) : 0;
            if (pct >= 20) { hoog.netto += nettoBedrag; hoog.btw += btwBedrag; }
            else if (pct > 0) { laag.netto += nettoBedrag; laag.btw += btwBedrag; }
          });
        } else {
          // Geen tax_lines — fallback: totaal in hoog tarief
          const btw = parseFloat((o as any).total_tax || 0);
          const netto = parseFloat((o as any).total || 0) - btw;
          hoog.netto += netto;
          hoog.btw += btw;
        }
      });

    return {hoog, laag};
  }, [verkoopFacturen, aangifteOrders, aangifteYear]);

  const exportInkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_supplier'),t('lbl_netto_inkoop_excl_btw'),'BTW%',t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    inkoopGefilterd.forEach((f: any) => {
      (f.regels||[]).forEach((r: any) => rows.push([
        f.datum, f.factuurnummer, f.leverancier,
        r.netto.toFixed(2), r.btw_tarief, r.btw_bedrag.toFixed(2),
        (r.netto+r.btw_bedrag).toFixed(2),
      ]));
    });
    const csv = [hdr,...rows].map((r: any)=>r.map((c: any)=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`inkoop_${dateFrom}_${dateTo}.csv`});
    a.click();
  };

  const exportVerkoopCSV = () => {
    const hdr = [t('lbl_date'),t('lbl_invoice'),t('lbl_klant'),t('lbl_description'),t('lbl_quantity'),'Prijs/stuk','BTW%',t('lbl_netto'),t('lbl_btw_bedrag'),t('lbl_bruto_inkoop_incl_btw')];
    const rows: any[] = [];
    verkoopGefilterd.forEach((f: any) => {
      (f.regels||[]).forEach((r: any) => rows.push([
        f.datum, f.factuurnummer||'', f.klant_naam||'',
        r.omschrijving||'', r.hoeveelheid??'', r.prijs_per_stuk!=null?Number(r.prijs_per_stuk).toFixed(2):'',
        r.btw_pct??'', r.netto!=null?Number(r.netto).toFixed(2):'', r.btw_bedrag!=null?Number(r.btw_bedrag).toFixed(2):'',
        r.bruto!=null?Number(r.bruto).toFixed(2):'',
      ]));
    });
    const csv = [hdr,...rows].map((r: any)=>r.map((c: any)=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`verkoop_${dateFrom}_${dateTo}.csv`});
    a.click();
  };

  const deleteFactuur = (id: any) => {
    if (!confirm(t('err_confirm_delete_inkoop'))) return;
    const f = inkoopFacturen.find((x: any)=>x.id===id);
    if (f?.bijlage?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${f.bijlage.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setInkoopFacturen((prev: any) => prev.filter((f: any)=>f.id!==id));
    if (expandedFactuur===id) setExpandedFactuur(null);
  };

  const saveLosseVerkoopFactuur = () => {
    const regels = (losseFactuurForm.regels||[]).map((r: any) => {
      const qty = Number(r.hoeveelheid)||0
      const prijs = Number(r.prijs_per_stuk)||0
      const pct = Number(r.btw_pct)||0
      const netto = qty * prijs
      const btw_bedrag = netto * pct / 100
      return {...r, hoeveelheid: qty, prijs_per_stuk: prijs, btw_pct: pct, netto, btw_bedrag, bruto: netto + btw_bedrag}
    })
    const totaalNetto = regels.reduce((s: number, r: any) => s + r.netto, 0)
    const totaalBtw   = regels.reduce((s: number, r: any) => s + r.btw_bedrag, 0)
    const nieuw = {
      id: newId(verkoopFacturen||[]),
      datum: losseFactuurForm.datum,
      factuurnummer: losseFactuurForm.factuurnummer.trim(),
      klant_id: losseFactuurForm.klant_id || null,
      klant_naam: losseFactuurForm.klant_naam.trim(),
      klant_straat: losseFactuurForm.klant_straat?.trim() || '',
      klant_postcode: losseFactuurForm.klant_postcode?.trim() || '',
      klant_stad: losseFactuurForm.klant_stad?.trim() || '',
      klant_btw_nummer: losseFactuurForm.klant_btw_nummer?.trim() || '',
      status: 'open',
      regels,
      netto: totaalNetto,
      btw: totaalBtw,
      bruto: totaalNetto + totaalBtw,
    }
    setVerkoopFacturen((prev: any) => [...(prev||[]), nieuw])
    setShowLosseFactuur(false)
    setLosseFactuurForm(emptyLosseFactuur())
  };

  const saveVrijeFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any) => {
    // Update ingredient lots (mirrors saveOntvangst in IngredientenPage)
    let updatedIng = [...ing];
    const newLots: any[] = [];
    productLijst.forEach((p: any) => {
      let iid: any;
      if (p.ing_id) { iid = Number(p.ing_id); }
      else {
        const existing = updatedIng.find((i: any)=>i.naam.toLowerCase()===p.nieuw.trim().toLowerCase());
        if (existing) { iid = existing.id; }
        else {
          const n = {id:newId(updatedIng), naam:p.nieuw.trim(), type:p.type, fabrikant:p.fabrikant||''};
          updatedIng = [...updatedIng, n]; iid = n.id;
        }
      }
      const lot = {id:newId([...lots,...newLots]), ingredient_id:iid, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        houdbaarheid:p.tht||null, lotnummer:p.lotnr||'', leverancier:factuurForm.leverancier||'',
        prijs_per_eenheid:p.prijs?Number(p.prijs):null, factuur_nummer:factuurForm.factuur||'',
        aankoop_datum:factuurForm.datum||tod(), btw_tarief:Number(p.btw_tarief)||0, beschikbaar:true};
      newLots.push(lot);
      addLog({ingredient_id:iid, ingredient_naam:updatedIng.find((i: any)=>i.id===iid)?.naam||p.nieuw.trim(),
        lot_id:lot.id, lotnummer:lot.lotnummer||'', type:'ontvangst',
        hoeveelheid:Number(p.qty), eenheid:p.eenh, referentie:factuurForm.factuur||factuurForm.leverancier||''});
    });
    setIng(updatedIng);
    setLots((prev: any)=>[...prev,...newLots]);
    // Update onderdelen stock
    verpakkingLijst.forEach((v: any) => {
      const n = Number(v.aantal);
      const naam = v._naam||v.naam.trim();
      const bestaand = v.od_id
        ? onderdelen.find((o: any)=>o.id===Number(v.od_id))
        : onderdelen.find((o: any)=>o.naam.toLowerCase()===naam.toLowerCase());
      if (bestaand) {
        setOnderdelen((prev: any)=>prev.map((o: any)=>o.id===bestaand.id?{
          ...o, voorraad:Number(o.voorraad||0)+n,
          lotnr:v.lotnr||o.lotnr||'',
          leverancier:factuurForm.leverancier||o.leverancier||'',
          factuurnummer:factuurForm.factuur||o.factuurnummer||'',
        }:o));
      } else {
        setOnderdelen((prev: any)=>[...prev,{
          id:newId(prev), naam, type:v.type||'overig',
          lotnr:v.lotnr||'',
          kosten_per_stuk:v.prijs_per_stuk?Number(v.prijs_per_stuk):0,
          leverancier:factuurForm.leverancier||'', factuurnummer:factuurForm.factuur||'',
          voorraad:n,
        }]);
      }
    });
    // Build factuur regels and save
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = parseFloat(p.totaalprijs) || (pn * Number(p.qty||0));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p.nieuw||'') : (p.nieuw||'');
      regels.push({type:'ingredient', naam, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = parseFloat(r.netto)||0;
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam: r.naam.trim(), type: 'overig', netto, btw_tarief, btw_bedrag: +(netto*btw_tarief/100).toFixed(2)});
    });
    if (!regels.length) return;
    const calc_netto = regels.reduce((s: any,r: any)=>s+r.netto, 0);
    const calc_btw = regels.reduce((s: any,r: any)=>s+r.btw_bedrag, 0);
    const totaal_netto = totaalManual ? totaalManual.netto : calc_netto;
    const totaal_btw   = totaalManual ? totaalManual.btw   : calc_btw;
    const totaal_bruto = totaalManual ? totaalManual.bruto  : calc_netto + calc_btw;
    setInkoopFacturen((prev: any) => [...prev, {
      id: newId(prev),
      datum: factuurForm.datum || now.toISOString().slice(0,10),
      factuurnummer: factuurForm.factuur || '',
      leverancier: factuurForm.leverancier || '',
      regels,
      totaal_netto,
      totaal_btw,
      totaal_bruto,
      bijlage,
    }]);
    setShowVrijeFactuur(false);
  };

  const updateFactuur = ({factuurForm, productLijst, verpakkingLijst, vrijeRegels, bijlage, totaalManual}: any) => {
    if (!editingFactuur) return;
    const regels: any[] = [];
    productLijst.forEach((p: any) => {
      const pn = p.prijs ? Number(p.prijs) : 0;
      const netto = parseFloat(p.totaalprijs) || (pn * Number(p.qty||0));
      const btw_tarief = Number(p.btw_tarief)||0;
      const naam = p.ing_id ? (ing.find((i: any)=>i.id===Number(p.ing_id))?.naam||p._naam||p.nieuw.trim()) : (p._naam||p.nieuw.trim());
      regels.push({type:'ingredient', naam, hoeveelheid:Number(p.qty), eenheid:p.eenh,
        prijs_per_eenheid:pn||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    verpakkingLijst.forEach((v: any) => {
      const ps = v.prijs_per_stuk ? Number(v.prijs_per_stuk) : 0;
      const netto = parseFloat(v.totaalprijs) || (ps * Number(v.aantal||0));
      const btw_tarief = Number(v.btw_tarief)||0;
      regels.push({type:'verpakking', naam:v._naam||v.naam||'', aantal:Number(v.aantal),
        prijs_per_stuk:ps||null, netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    vrijeRegels.forEach((r: any) => {
      const netto = parseFloat(r.netto)||0;
      const btw_tarief = Number(r.btw_tarief)||0;
      regels.push({naam:r.naam.trim(), type:'overig', netto, btw_tarief, btw_bedrag:+(netto*btw_tarief/100).toFixed(2)});
    });
    const calc_netto = regels.reduce((s: any,r: any)=>s+r.netto, 0);
    const calc_btw = regels.reduce((s: any,r: any)=>s+r.btw_bedrag, 0);
    const totaal_netto = totaalManual ? totaalManual.netto : calc_netto;
    const totaal_btw   = totaalManual ? totaalManual.btw   : calc_btw;
    const totaal_bruto = totaalManual ? totaalManual.bruto  : calc_netto + calc_btw;
    setInkoopFacturen((prev: any) => prev.map((f: any) => f.id !== (editingFactuur as any).id ? f : {
      ...f,
      datum: factuurForm.datum || f.datum,
      factuurnummer: factuurForm.factuur ?? f.factuurnummer,
      leverancier: factuurForm.leverancier || f.leverancier,
      regels,
      totaal_netto, totaal_btw, totaal_bruto,
      bijlage: bijlage || f.bijlage,
    }));
    setEditingFactuur(null);
  };

  // ── Verkoopfacturen (eigen facturen uit bestellingen) ──────────────────────
  const verkoopGefilterd = React.useMemo(() =>
    (verkoopFacturen||[])
      .filter((f: any) => f.datum >= dateFrom && f.datum <= dateTo)
      .sort((a: any, b: any) => b.datum.localeCompare(a.datum)),
    [verkoopFacturen, dateFrom, dateTo]
  );

  const verkoopTotals = React.useMemo(() =>
    verkoopGefilterd.reduce((s: any, f: any) => ({
      netto: s.netto + (f.netto||0),
      btw:   s.btw   + (f.btw||0),
      bruto: s.bruto + (f.bruto||0),
    }), {netto:0, btw:0, bruto:0}),
    [verkoopGefilterd]
  );

  const verkoopBtwPerTarief = React.useMemo(() => {
    const map: any = {};
    verkoopGefilterd.forEach((f: any) => (f.btw_overzicht||[]).forEach((b: any) => {
      const k = b.tarief ?? 0;
      if (!map[k]) map[k] = {tarief:k, netto:0, btw:0};
      map[k].netto += b.netto||0;
      map[k].btw   += b.btw||0;
    }));
    return Object.values(map).sort((a: any,b: any) => a.tarief - b.tarief);
  }, [verkoopGefilterd]);

  // ── Aangiftes helpers ──────────────────────────────────────────────────────
  const getPeriodes = (year: any, periode: any) => {
    if (periode === 'maand') {
      return Array.from({length:12}, (_,i) => {
        const m = String(i+1).padStart(2,'0');
        const lastDay = new Date(year, i+1, 0).getDate();
        const raw = new Date(year, i, 1).toLocaleString(getLang(), {month:'long'});
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        return {label, from:`${year}-${m}-01`, to:`${year}-${m}-${String(lastDay).padStart(2,'0')}`, key:`${year}-M${m}`};
      });
    }
    return [
      {label:'Q1', from:`${year}-01-01`, to:`${year}-03-31`, key:`${year}-Q1`},
      {label:'Q2', from:`${year}-04-01`, to:`${year}-06-30`, key:`${year}-Q2`},
      {label:'Q3', from:`${year}-07-01`, to:`${year}-09-30`, key:`${year}-Q3`},
      {label:'Q4', from:`${year}-10-01`, to:`${year}-12-31`, key:`${year}-Q4`},
    ];
  };

  const fetchJaarordrers = async (year: any) => {
    if (!wcCreds?.enabled || !wcCreds.storeUrl) { setAangifteError(t('msg_wc_not_active_settings')); return; }
    setAangifteLoading(true); setAangifteError('');
    try {
      const all: any[] = [];
      let pg = 1;
      while (true) {
        const qs = `orders?per_page=100&page=${pg}&status=any&after=${year}-01-01T00:00:00&before=${year}-12-31T23:59:59&orderby=date&order=desc`;
        const batch = await wcGet(qs);
        all.push(...batch);
        if (batch.length < 100) break;
        pg++;
      }
      setAangifteOrders(all);
      setAangifteFetched(true);
    } catch(e: any) { setAangifteError(t('msg_fetch_error') + e.message); }
    finally { setAangifteLoading(false); }
  };

  // Lokale fmt functie — bewust anders dan globale fmt (geen € teken prefix style)
  const fmt = (n: any) => '€\u00a0' + Number(n).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const card = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-5';

  const markeerBetaald = (factuurId: any) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: 'betaald'} : f
    ));
  };

  const markeerHerinnering = (factuurId: any) => {
    setVerkoopFacturen((prev: any[]) => prev.map((f: any) =>
      f.id === factuurId ? {...f, status: f.status === 'herinnering' ? 'open' : 'herinnering'} : f
    ));
  };

  // ── PDF generatie ─────────────────────────────────────────────────────────
  const genereerFactuurPDF = (factuur: any) => {
    const inst = (breweryDetails as any) || {}
    const klant = (klanten||[]).find((k:any) => k.id === factuur.klant_id)
    const termijn = klant?.betalingstermijn ?? inst.betalingstermijn ?? 14
    const datumObj = factuur.datum ? new Date(factuur.datum) : new Date()
    const vervalObj = new Date(datumObj)
    vervalObj.setDate(vervalObj.getDate() + Number(termijn))
    const fmtD = (d: Date) => d.toLocaleDateString('nl-NL', {day:'2-digit',month:'2-digit',year:'numeric'})
    const fmtB = (n: number) => '&euro;&nbsp;' + Number(n).toFixed(2).replace('.', ',')
    const vervalDatum = fmtD(vervalObj)
    const facDatum = fmtD(datumObj)

    const btwMap: Record<number, {netto:number,btw:number}> = {}
    ;(factuur.regels||[]).forEach((r: any) => {
      const pct = r.btw_pct ?? 0
      if (!btwMap[pct]) btwMap[pct] = {netto:0,btw:0}
      btwMap[pct].netto += r.netto||0
      btwMap[pct].btw += r.btw_bedrag||0
    })

    const logoHtml = factuurLogo
      ? `<img src="${factuurLogo}" style="max-height:60px;max-width:200px;object-fit:contain;" alt="logo" />`
      : ''

    const regelRows = (factuur.regels||[]).map((r: any) =>
      `<tr><td>${r.omschrijving||''}</td><td style="text-align:right">${r.hoeveelheid||''}</td><td style="text-align:right">${fmtB(r.prijs_per_stuk||0)}</td><td style="text-align:right">${r.btw_pct||0}%</td><td style="text-align:right">${fmtB(r.netto||0)}</td><td style="text-align:right">${fmtB(r.btw_bedrag||0)}</td><td style="text-align:right">${fmtB(r.bruto||0)}</td></tr>`
    ).join('')
    const btwRows = Object.entries(btwMap).map(([pct, v]) =>
      `<tr><td>${pct}%</td><td style="text-align:right">${fmtB(v.netto)}</td><td style="text-align:right">${fmtB(v.btw)}</td></tr>`
    ).join('')

    const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Factuur ${factuur.factuurnummer||factuur.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#222;padding:15mm 20mm}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8mm}.bi{text-align:right;font-size:10px;color:#444;line-height:1.7}.bi-naam{font-size:14px;font-weight:bold;color:#111;margin-bottom:3px}.ftitle{font-size:22px;font-weight:bold;color:#111;margin:5mm 0 4mm}.meta{display:flex;gap:10mm;margin-bottom:7mm}.ml{font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.5px;margin-bottom:1px}.mv{font-size:11px;font-weight:500}.kb{background:#f8f9fa;border-left:3px solid #333;padding:3mm 4mm;margin-bottom:7mm}.kn{font-weight:bold;font-size:12px;margin-bottom:3px}table{width:100%;border-collapse:collapse;margin-bottom:4mm;font-size:10px}th{background:#333;color:#fff;padding:3px 5px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:3px 5px;border-bottom:1px solid #eee;vertical-align:top}.ts{display:flex;justify-content:flex-end;margin-bottom:6mm}.tt{width:65mm}.tt td{padding:2px 5px;border:none}.gt{font-weight:bold;font-size:13px;border-top:2px solid #333!important}.bb{background:#f0f7ff;border:1px solid #cce5ff;padding:3mm 4mm;border-radius:4px;font-size:10px;line-height:1.9}.bt{font-weight:bold;font-size:11px;margin-bottom:2px}@media print{body{padding:10mm 15mm}@page{margin:10mm}}</style></head>
<body>
<div class="hdr"><div>${logoHtml}</div><div class="bi"><div class="bi-naam">${inst.naam||''}</div>${inst.straat||inst.huisnummer?`<div>${inst.straat||''} ${inst.huisnummer||''}</div>`:''} ${inst.postcode||inst.stad?`<div>${inst.postcode||''} ${inst.stad||''}</div>`:''} ${inst.btw_nummer?`<div>BTW: ${inst.btw_nummer}</div>`:''} ${inst.kvk_nummer?`<div>KvK: ${inst.kvk_nummer}</div>`:''} ${inst.iban?`<div>IBAN: ${inst.iban}</div>`:''} ${inst.email?`<div>${inst.email}</div>`:''} ${inst.telefoon?`<div>${inst.telefoon}</div>`:''}</div></div>
<div class="ftitle">FACTUUR</div>
<div class="meta"><div><div class="ml">Factuurnummer</div><div class="mv">${factuur.factuurnummer||'—'}</div></div><div><div class="ml">Factuurdatum</div><div class="mv">${facDatum}</div></div><div><div class="ml">Vervaldatum</div><div class="mv">${vervalDatum} (${termijn} dgn)</div></div></div>
<div class="kb"><div class="kn">${factuur.klant_naam||'—'}</div>${factuur.klant_straat?`<div>${factuur.klant_straat}</div>`:''} ${factuur.klant_postcode||factuur.klant_stad?`<div>${factuur.klant_postcode||''} ${factuur.klant_stad||''}</div>`:''} ${factuur.klant_btw_nummer?`<div>BTW: ${factuur.klant_btw_nummer}</div>`:''}</div>
<table><thead><tr><th style="width:35%">Omschrijving</th><th style="text-align:right;width:8%">Aantal</th><th style="text-align:right;width:13%">Prijs/stuk</th><th style="text-align:right;width:7%">BTW%</th><th style="text-align:right;width:12%">Netto</th><th style="text-align:right;width:12%">BTW</th><th style="text-align:right;width:13%">Bruto</th></tr></thead><tbody>${regelRows}</tbody></table>
<div style="display:flex;justify-content:flex-end;margin-bottom:4mm"><table style="width:60mm"><thead><tr><th>BTW%</th><th style="text-align:right">Grondslag</th><th style="text-align:right">BTW</th></tr></thead><tbody>${btwRows}</tbody></table></div>
<div class="ts"><table class="tt"><tr><td>Subtotaal excl. BTW</td><td style="text-align:right">${fmtB(factuur.netto||0)}</td></tr><tr><td>BTW</td><td style="text-align:right">${fmtB(factuur.btw||0)}</td></tr><tr class="gt"><td>Totaal incl. BTW</td><td style="text-align:right">${fmtB(factuur.bruto||0)}</td></tr></table></div>
<div class="bb"><div class="bt">Betaalinformatie</div>${inst.iban?`<div>IBAN: ${inst.iban}</div>`:''} ${inst.naam?`<div>t.n.v.: ${inst.naam}</div>`:''}<div>o.v.v.: ${factuur.factuurnummer||factuur.id}</div><div>Vervaldatum: ${vervalDatum}</div></div>
<script>window.onload=function(){setTimeout(function(){window.print();},200);}</script></body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  // ── MT940 parser ──────────────────────────────────────────────────────────
  const parseMT940 = (text: string): any => {
    const result: any = { iban:'', referentie:'', afschriftNr:'', beginsaldo:0, eindsaldo:0, transacties:[] }
    const parseAmt = (s: string) => parseFloat(s.replace(',','.'))
    const parseDate6 = (s: string) => {
      const yy=s.slice(0,2),mm=s.slice(2,4),dd=s.slice(4,6)
      const yr = parseInt(yy) <= (new Date().getFullYear()%100) ? '20'+yy : '19'+yy
      return `${yr}-${mm}-${dd}`
    }
    let field='', buf='', pendingTx: any=null
    const flush = () => {
      if (!field) return
      const v = buf.trim()
      if (field==='25') result.iban = v.split('/')[0].replace(/\./g,'').trim()
      else if (field==='20') result.referentie = v
      else if (field==='28C') result.afschriftNr = v
      else if (field==='60F'||field==='60M') {
        const m = v.match(/^([CD])(\d{6})[A-Z]{3}(\d+,\d*)/)
        if (m) result.beginsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3])
      } else if (field==='62F'||field==='62M') {
        const m = v.match(/^([CD])(\d{6})[A-Z]{3}(\d+,\d*)/)
        if (m) result.eindsaldo = m[1]==='C' ? parseAmt(m[3]) : -parseAmt(m[3])
      } else if (field==='61') {
        const m = v.match(/^(\d{6})(\d{4})?([CD]R?)([A-Z]?)(\d+,\d{2})/)
        if (m) {
          if (pendingTx) result.transacties.push(pendingTx)
          const refM = v.match(/\/\/(.+)/)
          pendingTx = { datum:parseDate6(m[1]), type:m[3].startsWith('C')?'C':'D', bedrag:parseAmt(m[5]), referentie:refM?refM[1].split('\n')[0].trim():'', omschrijving:'', gekoppeldFactuurId:null, autoGematcht:false }
        }
      } else if (field==='86') {
        if (pendingTx) {
          pendingTx.omschrijving = v.replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim()
          result.transacties.push(pendingTx)
          pendingTx = null
        }
      }
      field=''; buf=''
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('-')||line===':') { flush(); continue }
      const m = line.match(/^:(\w+):(.*)$/)
      if (m) { flush(); field=m[1]; buf=m[2] }
      else if (field) buf+='\n'+line
    }
    flush()
    if (pendingTx) result.transacties.push(pendingTx)
    return result
  }

  const importMT940 = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e: any) => {
      const text = e.target.result as string
      const afschrift = parseMT940(text)
      // Auto-match open verkoopfacturen op bedrag
      const openFacturen = (verkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
      const gematcht = afschrift.transacties.map((tx: any) => {
        if (tx.type !== 'C') return tx
        const match = openFacturen.find((f: any) => Math.abs((f.bruto||0) - tx.bedrag) <= 0.01)
        return match ? {...tx, gekoppeldFactuurId:match.id, autoGematcht:true} : tx
      })
      setBankAfschrift(afschrift)
      setBankTransacties(gematcht)
    }
    reader.readAsText(file, 'latin1')
  }

  const koppelBankTransactie = (txIndex: number, factuurId: number|null) => {
    setBankTransacties((prev: any[]) => prev.map((tx, i) =>
      i===txIndex ? {...tx, gekoppeldFactuurId:factuurId, autoGematcht:false} : tx
    ))
  }

  // ── Klanten CRUD ──────────────────────────────────────────────────────────
  const saveKlant = () => {
    const form = {...klantForm, betalingstermijn: klantForm.betalingstermijn ? Number(klantForm.betalingstermijn) : undefined}
    if (editingKlant) {
      setKlanten((prev: any[]) => prev.map((k: any) => k.id===editingKlant.id ? {...k,...form} : k))
    } else {
      setKlanten((prev: any[]) => [...(prev||[]), {id:newId(prev||[]), ...form}])
    }
    setShowKlantModal(false); setEditingKlant(null); setKlantForm(emptyKlantForm())
  }

  const deleteKlant = (id: number) => {
    if (!confirm(t('btn_delete') + '?')) return
    setKlanten((prev: any[]) => prev.filter((k: any) => k.id !== id))
    if (viewingKlantId === id) setViewingKlantId(null)
  }

  const handleKlantSelectInFactuur = (klantId: number|null) => {
    if (!klantId) {
      setLosseFactuurForm((f: any) => ({...f, klant_id:null}))
      return
    }
    const k = (klanten||[]).find((k: any) => k.id === klantId)
    if (!k) return
    setLosseFactuurForm((f: any) => ({...f, klant_id:klantId, klant_naam:k.naam, klant_straat:k.straat||'', klant_postcode:k.postcode||'', klant_stad:k.stad||'', klant_btw_nummer:k.btw_nummer||''}))
  }

  // (no early return — Inkoop tab is always available)

  const tabBtn = (tabId: string, label: string) => (
    <button onClick={() => setMainTab(tabId)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === tabId ? 't-tab font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-5">

      {/* Header + hoofd-tabs */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <h2 className="text-xl font-bold text-gray-800 mr-4">
            {t('nav_boekhouding')}
          </h2>
          {tabBtn('verkoop', t('tab_verkoop'))}
          {tabBtn('inkoop', t('tab_inkoop'))}
          {tabBtn('klanten', t('tab_klanten'))}
          {tabBtn('bank', t('tab_bank'))}
          {tabBtn('rapporten', t('tab_rapporten'))}
          {tabBtn('accijns', t('nav_accijns'))}
          {tabBtn('btw_aangifte', t('tab_btw_aangifte'))}
        </div>
      </div>

      {/* ══════════════════════ VERKOOP ══════════════════════ */}
      {mainTab==='verkoop' && (<>

        {/* Periode filter */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={dateFrom} onChange={(e: any)=>setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={dateTo} onChange={(e: any)=>setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="text-xs text-gray-400 italic self-end pb-2">{t('lbl_facturen_in_periode').replace('{n}',verkoopGefilterd.length)}</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>{setLosseFactuurForm(emptyLosseFactuur());setShowLosseFactuur(true)}}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_losse_factuur')}
              </button>
              {verkoopGefilterd.length > 0 && (
                <button onClick={exportVerkoopCSV} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  ↓ CSV ({verkoopGefilterd.length})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Losse verkoopfactuur modal */}
        {showLosseFactuur && (
          <Modal title={t('modal_losse_factuur_titel')} onClose={()=>setShowLosseFactuur(false)} wide>
            <div className="space-y-4">
              {/* Rij 1: klant-kiezer, datum, factuurnummer */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant')}</label>
                  {(klanten||[]).length > 0 ? (
                    <select value={losseFactuurForm.klant_id||''}
                      onChange={(e: any) => { const v = e.target.value; handleKlantSelectInFactuur(v ? Number(v) : null) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none mb-1">
                      <option value="">— vrij invullen —</option>
                      {(klanten||[]).map((k: any) => <option key={k.id} value={k.id}>{k.naam}</option>)}
                    </select>
                  ) : null}
                  <input type="text" value={losseFactuurForm.klant_naam}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_naam:e.target.value}))}
                    placeholder={t('lbl_klant')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_date')}</label>
                  <input type="date" value={losseFactuurForm.datum}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,datum:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('factuur_number')}</label>
                  <input type="text" value={losseFactuurForm.factuurnummer}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,factuurnummer:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              {/* Rij 2: klantadres (voor PDF) */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_straat')}</label>
                  <input type="text" value={losseFactuurForm.klant_straat}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_straat:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_postcode')}</label>
                  <input type="text" value={losseFactuurForm.klant_postcode}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_postcode:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_stad')}</label>
                  <input type="text" value={losseFactuurForm.klant_stad}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_stad:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_btw_nummer')}</label>
                  <input type="text" value={losseFactuurForm.klant_btw_nummer}
                    onChange={(e: any)=>setLosseFactuurForm((f: any)=>({...f,klant_btw_nummer:e.target.value}))}
                    placeholder="NL000000000B01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div>
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-400 uppercase mb-1 px-0.5">
                  <div className="col-span-4">{t('lbl_omschrijving')}</div>
                  <div className="col-span-2">{t('lbl_quantity')}</div>
                  <div className="col-span-2">{t('lbl_prijs_per_stuk')}</div>
                  <div className="col-span-1">{t('lbl_btw_pct')}</div>
                  <div className="col-span-2 text-right">{t('lbl_bruto')}</div>
                </div>
                <div className="space-y-2">
                  {(losseFactuurForm.regels||[]).map((r: any, i: number) => {
                    const qty = Number(r.hoeveelheid)||0
                    const prijs = Number(r.prijs_per_stuk)||0
                    const pct = Number(r.btw_pct)||0
                    const netto = qty * prijs
                    const btw_bedrag = netto * pct / 100
                    const bruto = netto + btw_bedrag
                    const upd = (k: string, v: any) => setLosseFactuurForm((f: any) => ({...f, regels: f.regels.map((x: any, j: number) => j===i ? {...x,[k]:v} : x)}))
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={r.omschrijving} onChange={(e: any)=>upd('omschrijving',e.target.value)}
                          placeholder={t('lbl_omschrijving')}
                          className="col-span-4 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <input type="number" value={r.hoeveelheid} onChange={(e: any)=>upd('hoeveelheid',e.target.value)}
                          placeholder={t('lbl_quantity')} min="0"
                          className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <input type="number" value={r.prijs_per_stuk} onChange={(e: any)=>upd('prijs_per_stuk',e.target.value)}
                          placeholder={t('lbl_prijs_per_stuk')} min="0" step="0.01"
                          className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm t-input focus:outline-none" />
                        <select value={r.btw_pct} onChange={(e: any)=>upd('btw_pct',e.target.value)}
                          className="col-span-1 border border-gray-300 rounded-lg px-1 py-1.5 text-sm t-input focus:outline-none">
                          <option value="0">0%</option>
                          <option value="9">9%</option>
                          <option value="21">21%</option>
                        </select>
                        <div className="col-span-2 text-right text-sm font-medium text-gray-700">{fmt(bruto)}</div>
                        <button onClick={()=>setLosseFactuurForm((f: any)=>({...f,regels:f.regels.filter((_: any,j: number)=>j!==i)}))}
                          className="col-span-1 text-gray-300 hover:text-red-500 transition-colors text-base font-bold leading-none">✕</button>
                      </div>
                    )
                  })}
                  <button onClick={()=>setLosseFactuurForm((f: any)=>({...f,regels:[...f.regels,emptyLosseRegel()]}))}
                    className="text-sm tbtn px-3 py-1 rounded-lg transition-colors font-medium">
                    {t('btn_add_rule')}
                  </button>
                </div>
              </div>
              {(losseFactuurForm.regels||[]).length > 0 && (() => {
                const regels = (losseFactuurForm.regels||[]).map((r: any) => {
                  const qty=Number(r.hoeveelheid)||0; const prijs=Number(r.prijs_per_stuk)||0; const pct=Number(r.btw_pct)||0
                  const netto=qty*prijs; return {netto, btw_bedrag: netto*pct/100}
                })
                const totNetto = regels.reduce((s: number,r: any)=>s+r.netto,0)
                const totBtw   = regels.reduce((s: number,r: any)=>s+r.btw_bedrag,0)
                return (
                  <div className="border-t pt-3 flex justify-end gap-6 text-sm">
                    <span className="text-gray-500">{t('lbl_netto')}: <span className="font-medium text-gray-800">{fmt(totNetto)}</span></span>
                    <span className="text-gray-500">{t('lbl_btw')}: <span className="font-medium text-blue-700">{fmt(totBtw)}</span></span>
                    <span className="text-gray-500">{t('lbl_bruto')}: <span className="font-bold text-gray-900">{fmt(totNetto+totBtw)}</span></span>
                  </div>
                )
              })()}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>setShowLosseFactuur(false)}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
                <button onClick={saveLosseVerkoopFactuur}
                  disabled={!(losseFactuurForm.klant_naam||'').trim()}
                  className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {verkoopGefilterd.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                {label:t('lbl_omzet_excl_btw'), val:verkoopTotals.netto, cls:'text-green-700 font-bold'},
                {label:t('lbl_btw'),            val:verkoopTotals.btw,   cls:'text-blue-700'},
                {label:t('lbl_totaal_incl_btw'),val:verkoopTotals.bruto, cls:'text-gray-900 font-bold'},
              ].map((s: any) => (
                <div key={s.label} className={card + ' text-center py-3'}>
                  <div className={`text-base font-semibold ${s.cls}`}>{fmt(s.val)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {verkoopGefilterd.length > 0 ? (
            <div className={card + ' overflow-x-auto'}>
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('factuur_number')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('orders_klant')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_status')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                    <th className="py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {verkoopGefilterd.map((f: any) => (
                    <tr key={f.id}
                      className="border-b border-gray-50 hover:bg-green-50 transition-colors cursor-pointer"
                      onClick={() => { if (f.bestelling_id) { setOpenOrderId(f.bestelling_id); setPage('bestellingen'); } }}>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{f.datum}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700">{f.factuurnummer||'—'}</td>
                      <td className="py-2 pr-3 font-medium text-gray-800">{f.klant_naam||'—'}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${f.status==='betaald'?'bg-green-100 text-green-700':f.status==='herinnering'?'bg-yellow-100 text-yellow-700':'bg-orange-100 text-orange-700'}`}>
                          {f.status==='betaald' ? t('factuur_paid') : f.status==='herinnering' ? t('lbl_herinnering') : t('factuur_open')}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(f.netto||0)}</td>
                      <td className="py-2 pr-3 text-right text-blue-600 whitespace-nowrap">{fmt(f.btw||0)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.bruto||0)}</td>
                      <td className="py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => genereerFactuurPDF(f)}
                            className="px-2 py-0.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded text-xs font-medium border border-gray-200 transition-colors">
                            {t('btn_pdf')}
                          </button>
                          {f.status !== 'betaald' && (
                            <button onClick={() => markeerBetaald(f.id)}
                              className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 rounded text-xs font-medium border border-green-200 transition-colors">
                              {t('btn_mark_paid')}
                            </button>
                          )}
                          {f.status !== 'betaald' && (
                            <button onClick={() => markeerHerinnering(f.id)}
                              className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${f.status==='herinnering'?'bg-yellow-100 text-yellow-700 border-yellow-300':'bg-gray-50 hover:bg-yellow-50 text-gray-500 border-gray-200'}`}>
                              !
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={4} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{verkoopGefilterd.length} {t('lbl_facturen_short').replace('{n}','').trim()}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(verkoopTotals.netto)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(verkoopTotals.btw)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-gray-900">{fmt(verkoopTotals.bruto)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className={card + ' text-center py-8 text-gray-400 text-sm'}>
              {t('msg_no_verkoopfacturen')}
            </div>
          )}
      </>)}

      {/* ══════════════════════ INKOOP ══════════════════════ */}
      {mainTab==='inkoop' && (<>

        {/* Filter */}
        <div className={card}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_van')}</label>
              <input type="date" value={dateFrom} onChange={(e: any)=>setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_tot')}</label>
              <input type="date" value={dateTo} onChange={(e: any)=>setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
            </div>
            <div className="text-xs text-gray-400 italic self-end pb-2">{t('lbl_facturen_in_periode').replace('{n}',inkoopGefilterd.length)}</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>setShowVrijeFactuur(true)}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_ontvangst')}
              </button>
              {inkoopGefilterd.length > 0 && (
                <button onClick={exportInkoopCSV} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  ↓ CSV ({inkoopGefilterd.length})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inkoop factuur modal */}
        {showVrijeFactuur && (
          <InkoopFactuurModal
            knownLeveranciers={knownLeveranciers}
            ing={ing}
            onderdelen={onderdelen}
            initialTab="ingredienten"
            onSave={saveVrijeFactuur}
            onClose={()=>setShowVrijeFactuur(false)}
            claudeCreds={claudeCreds}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
          />
        )}
        {/* Factuur bewerken modal */}
        {editingFactuur && (
          <InkoopFactuurModal
            knownLeveranciers={knownLeveranciers}
            ing={ing}
            onderdelen={onderdelen}
            initialTab="ingredienten"
            initialData={editingFactuur}
            onSave={updateFactuur}
            onClose={()=>setEditingFactuur(null)}
            claudeCreds={claudeCreds}
            ingTypes={ingTypes}
            ingTypeBtw={ingTypeBtw}
          />
        )}

        {/* Samenvattingskaartjes inkoop */}
        {inkoopGefilterd.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {label:t('lbl_netto_inkoop_excl_btw'), val:inkoopTotals.netto, cls:'text-gray-800 font-bold'},
              {label:t('lbl_voorbelasting_btw'),     val:inkoopTotals.btw,   cls:'text-blue-700 font-bold'},
              {label:t('lbl_bruto_inkoop_incl_btw'), val:inkoopTotals.bruto, cls:'text-gray-900 font-bold'},
            ].map((s: any)=>(
              <div key={s.label} className={card + ' text-center py-4'}>
                <div className={`text-lg font-semibold ${s.cls}`}>{fmt(s.val)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {inkoopGefilterd.length > 0 && (
          <div className={card + ' overflow-x-auto'}>
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 pr-2 text-left font-medium w-6"></th>
                  <th className="py-2 pr-3 text-left font-medium cursor-pointer select-none" onClick={()=>setInkoopSortDesc((d: any)=>!d)}>
                    {t('lbl_date')} {inkoopSortDesc?'↓':'↑'}
                  </th>
                  <th className="py-2 pr-3 text-left font-medium">{t('lbl_invoice')}</th>
                  <th className="py-2 pr-3 text-left font-medium">{t('lbl_supplier')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                  <th className="py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {inkoopGefilterd.map((f: any) => (<React.Fragment key={f.id}>
                  <tr className="border-b border-gray-50 hover:bg-amber-50 transition-colors cursor-pointer"
                      onClick={()=>setEditingFactuur(f)}>
                    <td className="py-2 pr-2 text-gray-400 text-xs text-center">✎</td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{f.datum}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-700">{f.factuurnummer||'—'}</td>
                    <td className="py-2 pr-3 font-medium text-gray-800">{f.leverancier||'—'}</td>
                    <td className="py-2 pr-3 text-right text-gray-700 whitespace-nowrap">{fmt(f.totaal_netto||0)}</td>
                    <td className="py-2 pr-3 text-right text-blue-600 whitespace-nowrap">{fmt(f.totaal_btw||0)}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.totaal_bruto||0)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {f.bijlage?.bestand && (
                        <a href={`${ADDON_BASE}api/file/${f.bijlage.bestand}`} target="_blank" rel="noopener noreferrer"
                          onClick={(e: any)=>e.stopPropagation()}
                          title={f.bijlage.naam}
                          className="text-gray-400 hover:text-blue-600 text-sm transition-colors px-1">📎</a>
                      )}
                      <button onClick={(e: any)=>{e.stopPropagation();deleteFactuur(f.id);}}
                        className="text-gray-300 hover:text-red-500 text-xs transition-colors px-1">✕</button>
                    </td>
                  </tr>
                </React.Fragment>))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={4} className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('lbl_facturen_n').replace('{n}',inkoopGefilterd.length)}</td>
                  <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(inkoopTotals.netto)}</td>
                  <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(inkoopTotals.btw)}</td>
                  <td className="py-2 pr-3 text-right font-bold text-gray-900">{fmt(inkoopTotals.bruto)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {inkoopFacturen.length===0 && (
          <div className={card + ' text-center py-14'}>
            <div className="text-4xl mb-3">🧾</div>
            <p className="text-gray-600 font-medium mb-1">{t('msg_no_inkoop_facturen')}</p>
            <p className="text-gray-400 text-sm">{t('msg_inkoop_facturen_hint_1')}<br/>{t('msg_inkoop_facturen_hint_2')}</p>
          </div>
        )}
        {inkoopFacturen.length>0 && inkoopGefilterd.length===0 && (
          <div className={card + ' text-center py-10'}>
            <p className="text-gray-400 text-sm">{t('msg_no_facturen_period')}</p>
          </div>
        )}
      </>)}

      {/* ══════════════════════ KLANTEN ══════════════════════ */}
      {mainTab==='klanten' && (<>
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{t('tab_klanten')}</h3>
            <button onClick={()=>{setEditingKlant(null);setKlantForm(emptyKlantForm());setShowKlantModal(true)}}
              className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
              {t('btn_nieuwe_klant')}
            </button>
          </div>
          {(klanten||[]).length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">{t('msg_no_klanten')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_name')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_email')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_openstaand')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_betaald')}</th>
                    <th className="py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {(klanten||[]).map((k: any) => {
                    const kFacturen = (verkoopFacturen||[]).filter((f: any) => f.klant_id === k.id)
                    const openstaand = kFacturen.filter((f: any) => f.status !== 'betaald').reduce((s: number, f: any) => s + (f.bruto||0), 0)
                    const betaald = kFacturen.filter((f: any) => f.status === 'betaald').reduce((s: number, f: any) => s + (f.bruto||0), 0)
                    const heeftVerlopen = kFacturen.some((f: any) => {
                      if (f.status === 'betaald') return false
                      if (!f.datum) return false
                      const termijn = k.betalingstermijn ?? (breweryDetails as any)?.betalingstermijn ?? 14
                      const verval = new Date(f.datum)
                      verval.setDate(verval.getDate() + Number(termijn))
                      return verval < new Date()
                    })
                    return (
                      <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={()=>setViewingKlantId(viewingKlantId===k.id ? null : k.id)}>
                        <td className="py-2 pr-3 font-medium text-gray-800">
                          {heeftVerlopen && <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2 align-middle" title="Verlopen factuur(en)"/>}
                          {k.naam}
                        </td>
                        <td className="py-2 pr-3 text-gray-500 text-xs">{k.email||'—'}</td>
                        <td className={`py-2 pr-3 text-right font-medium ${openstaand>0?'text-orange-600':'text-gray-400'}`}>{openstaand>0?fmt(openstaand):'—'}</td>
                        <td className="py-2 pr-3 text-right text-green-600">{betaald>0?fmt(betaald):'—'}</td>
                        <td className="py-2 text-right whitespace-nowrap" onClick={(e:any)=>e.stopPropagation()}>
                          <button onClick={()=>{setEditingKlant(k);setKlantForm({naam:k.naam,straat:k.straat||'',postcode:k.postcode||'',stad:k.stad||'',btw_nummer:k.btw_nummer||'',email:k.email||'',telefoon:k.telefoon||'',betalingstermijn:k.betalingstermijn??''});setShowKlantModal(true)}}
                            className="text-xs text-gray-400 hover:text-blue-600 px-2 py-0.5 transition-colors">{t('btn_edit')}</button>
                          <button onClick={()=>deleteKlant(k.id)}
                            className="text-xs text-gray-300 hover:text-red-500 px-1 transition-colors">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Factuurhistorie geselecteerde klant */}
        {viewingKlantId !== null && (() => {
          const k = (klanten||[]).find((x: any) => x.id === viewingKlantId)
          if (!k) return null
          const kFacturen = (verkoopFacturen||[]).filter((f: any) => f.klant_id === viewingKlantId).sort((a: any,b: any)=>b.datum?.localeCompare(a.datum||'')||0)
          return (
            <div className={card}>
              <h3 className="font-semibold text-gray-800 mb-3">{t('lbl_klant_factuurhistorie')}: {k.naam}</h3>
              {kFacturen.length === 0 ? (
                <div className="text-sm text-gray-400">{t('msg_no_verkoopfacturen')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_date')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('factuur_number')}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{t('lbl_status')}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t('lbl_bruto')}</th>
                        <th className="py-1.5 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {kFacturen.map((f: any) => (
                        <tr key={f.id} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 text-gray-600">{f.datum}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">{f.factuurnummer||'—'}</td>
                          <td className="py-1.5 pr-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${f.status==='betaald'?'bg-green-100 text-green-700':f.status==='herinnering'?'bg-yellow-100 text-yellow-700':'bg-orange-100 text-orange-700'}`}>
                              {f.status==='betaald'?t('factuur_paid'):f.status==='herinnering'?t('lbl_herinnering'):t('factuur_open')}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-right font-semibold">{fmt(f.bruto||0)}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <button onClick={()=>genereerFactuurPDF(f)}
                              className="text-xs px-2 py-0.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-gray-600 transition-colors mr-1">
                              {t('btn_pdf')}
                            </button>
                            {f.status !== 'betaald' && (
                              <button onClick={()=>markeerBetaald(f.id)}
                                className="text-xs px-2 py-0.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded text-green-700 transition-colors">
                                {t('btn_mark_paid')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* Klant modal */}
        {showKlantModal && (
          <Modal title={t('modal_klant_titel')} onClose={()=>{setShowKlantModal(false);setEditingKlant(null);setKlantForm(emptyKlantForm())}}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_name')} *</label>
                <input type="text" value={klantForm.naam} onChange={(e:any)=>setKlantForm((f:any)=>({...f,naam:e.target.value}))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_straat')}</label>
                  <input type="text" value={klantForm.straat} onChange={(e:any)=>setKlantForm((f:any)=>({...f,straat:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_postcode')}</label>
                  <input type="text" value={klantForm.postcode} onChange={(e:any)=>setKlantForm((f:any)=>({...f,postcode:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_stad')}</label>
                  <input type="text" value={klantForm.stad} onChange={(e:any)=>setKlantForm((f:any)=>({...f,stad:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_klant_btw_nummer')}</label>
                  <input type="text" value={klantForm.btw_nummer} onChange={(e:any)=>setKlantForm((f:any)=>({...f,btw_nummer:e.target.value}))}
                    placeholder="NL000000000B01"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_email')}</label>
                  <input type="email" value={klantForm.email} onChange={(e:any)=>setKlantForm((f:any)=>({...f,email:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_telefoon')}</label>
                  <input type="text" value={klantForm.telefoon} onChange={(e:any)=>setKlantForm((f:any)=>({...f,telefoon:e.target.value}))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('lbl_betalingstermijn_override')}</label>
                <input type="number" value={klantForm.betalingstermijn} min="1" max="365"
                  onChange={(e:any)=>setKlantForm((f:any)=>({...f,betalingstermijn:e.target.value}))}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm t-input focus:outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>{setShowKlantModal(false);setEditingKlant(null);setKlantForm(emptyKlantForm())}}
                  className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                  {t('btn_cancel')}
                </button>
                <button onClick={saveKlant} disabled={!klantForm.naam.trim()}
                  className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </>)}

      {/* ══════════════════════ BANK ══════════════════════ */}
      {mainTab==='bank' && (<>
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold text-gray-800">{t('tab_bank')}</h3>
              {bankAfschrift && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {bankAfschrift.iban && <span className="mr-3">{t('lbl_bank_iban')}: <span className="font-mono font-medium">{bankAfschrift.iban}</span></span>}
                  {bankAfschrift.beginsaldo !== undefined && <span className="mr-3">{t('lbl_beginsaldo')}: <span className="font-medium">{fmt(bankAfschrift.beginsaldo)}</span></span>}
                  {bankAfschrift.eindsaldo !== undefined && <span>{t('lbl_eindsaldo')}: <span className="font-medium">{fmt(bankAfschrift.eindsaldo)}</span></span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 italic hidden sm:block">{t('msg_bank_sessie_hint')}</p>
              <button onClick={()=>bankFileRef.current?.click()}
                className="px-4 py-1.5 tbtn rounded-lg text-sm font-medium transition-colors">
                {t('btn_bank_import')}
              </button>
              <input ref={bankFileRef} type="file" accept=".sta,.txt,.mt940" className="hidden"
                onChange={(e: any) => { const f = e.target.files?.[0]; if (f) { importMT940(f); e.target.value=''; } }} />
            </div>
          </div>

          {!bankAfschrift ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <div className="text-3xl mb-2">🏦</div>
              <p>{t('msg_no_bank')}</p>
              <p className="text-xs mt-1 italic">{t('msg_bank_sessie_hint')}</p>
            </div>
          ) : bankTransacties.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">Geen transacties gevonden in afschrift.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_date')}</th>
                    <th className="py-2 pr-3 text-left font-medium">{t('lbl_omschrijving')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('lbl_credit')}/{t('lbl_debet')}</th>
                    <th className="py-2 text-left font-medium">{t('tab_verkoop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bankTransacties.map((tx: any, i: number) => {
                    const gekoppeld = tx.gekoppeldFactuurId ? (verkoopFacturen||[]).find((f: any) => f.id === tx.gekoppeldFactuurId) : null
                    const openFacturen = (verkoopFacturen||[]).filter((f: any) => f.status !== 'betaald')
                    return (
                      <tr key={i} className={`border-b border-gray-50 ${tx.autoGematcht ? 'bg-green-50' : ''}`}>
                        <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{tx.datum}</td>
                        <td className="py-2 pr-3 text-gray-700 max-w-xs truncate" title={tx.omschrijving}>
                          {tx.omschrijving || tx.referentie || '—'}
                        </td>
                        <td className={`py-2 pr-3 text-right font-semibold whitespace-nowrap ${tx.type==='C'?'text-green-600':'text-red-600'}`}>
                          {tx.type==='C'?'+':'-'}{fmt(tx.bedrag)}
                        </td>
                        <td className="py-2" onClick={(e:any)=>e.stopPropagation()}>
                          {tx.autoGematcht && <span className="text-xs text-green-600 mr-2">✓ {t('lbl_auto_gematcht')}</span>}
                          {tx.type==='C' && (
                            <div className="flex items-center gap-2">
                              <select value={tx.gekoppeldFactuurId||''} onChange={(e:any)=>koppelBankTransactie(i, e.target.value?Number(e.target.value):null)}
                                className="border border-gray-200 rounded px-2 py-0.5 text-xs t-input focus:outline-none max-w-[200px]">
                                <option value="">— {t('lbl_niet_gekoppeld')} —</option>
                                {openFacturen.map((f: any) => (
                                  <option key={f.id} value={f.id}>{f.datum} · {f.klant_naam||'—'} · {fmt(f.bruto||0)}</option>
                                ))}
                              </select>
                              {gekoppeld && (
                                <button onClick={()=>{ markeerBetaald(gekoppeld.id); koppelBankTransactie(i,null) }}
                                  className="px-2 py-0.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded text-xs font-medium transition-colors whitespace-nowrap">
                                  {t('btn_mark_paid')}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {/* ══════════════════════ RAPPORTEN ══════════════════════ */}
      {mainTab==='rapporten' && (<>
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
          </div>
          <div className="flex gap-1 border-b border-gray-100">
            {(['wv','balans','omzet_cat'] as const).map(tab => (
              <button key={tab} onClick={()=>setRapportTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${rapportTab===tab?'t-tab font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t(tab==='wv'?'tab_wv':tab==='balans'?'tab_balans':'tab_omzet_cat')}
              </button>
            ))}
          </div>
        </div>

        {/* Winst & Verlies */}
        {rapportTab==='wv' && (()=>{
          const wv = berekenWinstVerlies(verkoopFacturen||[], inkoopFacturen||[], acc||[], rapportVan, rapportTot)
          const rows: {label:string,val:number,cls?:string,indent?:boolean,sep?:boolean}[] = [
            {label:t('lbl_omzet'), val:wv.omzet, cls:'text-green-700 font-semibold'},
            {label:t('lbl_inkoopkosten'), val:-wv.inkoopTotaal, sep:true},
            {label:t('lbl_inkoopkosten_ingredienten'), val:-wv.inkoopIngredient, indent:true},
            {label:t('lbl_inkoopkosten_verpakking'), val:-wv.inkoopVerpakking, indent:true},
            {label:t('lbl_inkoopkosten_overig'), val:-wv.inkoopOverig, indent:true},
            {label:t('lbl_brutowinst'), val:wv.brutowinst, cls:wv.brutowinst>=0?'text-green-700 font-bold':'text-red-600 font-bold', sep:true},
            {label:t('lbl_accijns_kosten'), val:-wv.accijnsKosten},
            {label:t('lbl_nettowinst'), val:wv.nettowinst, cls:wv.nettowinst>=0?'text-green-700 font-bold text-base':'text-red-600 font-bold text-base', sep:true},
          ]
          const exportWvCSV = () => {
            const csv = rows.map(r=>`"${r.label}","${r.val.toFixed(2).replace('.',',')}"`).join('\n')
            const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:`wv_${rapportVan}_${rapportTot}.csv`})
            a.click()
          }
          return (
            <div className={card}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">{t('tab_wv')} — {rapportVan} {t('lbl_t_m')} {rapportTot}</h3>
                <button onClick={exportWvCSV} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs font-medium transition-colors">{t('btn_export_csv_rapport')}</button>
              </div>
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
          )
        })()}

        {/* Balans */}
        {rapportTab==='balans' && (()=>{
          const openVerkoop = (verkoopFacturen||[]).filter((f:any)=>f.status!=='betaald').reduce((s:number,f:any)=>s+(f.bruto||0),0)
          const voorraadWaarde = (lots||[]).filter((l:any)=>l.beschikbaar!==false&&l.hoeveelheid>0&&l.prijs_per_eenheid).reduce((s:number,l:any)=>s+(l.hoeveelheid||0)*(l.prijs_per_eenheid||0),0)
          const accijnsSchuld = (acc||[]).filter((r:any)=>!r.betaald).reduce((s:number,r:any)=>s+(r.totaal_accijns||r.accijns||0),0)
          const totaalActiva = openVerkoop + voorraadWaarde
          const totaalPassiva = accijnsSchuld
          const eigenVermogen = totaalActiva - totaalPassiva
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_activa')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_debiteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(openVerkoop)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_voorraden_indicatief')}</td><td className="py-1.5 text-right font-medium">{fmt(voorraadWaarde)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalActiva)}</td></tr>
                </tbody></table>
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-700 mb-3">{t('lbl_passiva')}</h3>
                <table className="w-full text-sm"><tbody>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_crediteuren_open')}</td><td className="py-1.5 text-right font-medium">{fmt(0)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_accijns_schuld')}</td><td className="py-1.5 text-right font-medium">{fmt(accijnsSchuld)}</td></tr>
                  <tr><td className="py-1.5 text-gray-600">{t('lbl_eigen_vermogen')}</td><td className={`py-1.5 text-right font-medium ${eigenVermogen>=0?'text-green-600':'text-red-600'}`}>{fmt(eigenVermogen)}</td></tr>
                  <tr className="border-t border-gray-200"><td className="py-2 font-bold text-gray-800">{t('lbl_total')}</td><td className="py-2 text-right font-bold">{fmt(totaalPassiva+eigenVermogen)}</td></tr>
                </tbody></table>
              </div>
            </div>
          )
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
                  <thead><tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
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
                        <td className="py-1.5 pr-3 text-right text-blue-600">{fmt(v.btw)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(v.bruto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </>)}

      {/* ══════════════════════ ACCIJNS ══════════════════════ */}
      {mainTab==='accijns' && <AccijnsPage bat={bat} acc={acc} setAcc={setAcc} />}

      {/* ══════════════════════ BTW AANGIFTE ══════════════════════ */}
      {mainTab==='btw_aangifte' && (()=>{
        const periode = (btwInst as any)?.periode || 'kwartaal';
        const periodes = getPeriodes(aangifteYear, periode);
        const today = now.toISOString().slice(0,10);

        return (<>
          {/* Jaar-selector + ophaalknop */}
          <div className={card}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button onClick={()=>{setAangifteYear((y: any)=>y-1); setAangifteFetched(false); setAangifteOrders([]);}}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg leading-none transition-colors">‹</button>
                <span className="text-lg font-bold text-gray-800 w-14 text-center">{aangifteYear}</span>
                <button onClick={()=>{setAangifteYear((y: any)=>y+1); setAangifteFetched(false); setAangifteOrders([]);}}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-lg leading-none transition-colors">›</button>
              </div>
              <div className="text-xs text-gray-400 italic">
                {periode==='kwartaal' ? t('lbl_aangifte_kwartaal') : t('lbl_aangifte_maand')} · {t('lbl_aangifte_period_hint')}
              </div>
              {wcCreds?.enabled
                ? <button onClick={()=>fetchJaarordrers(aangifteYear)} disabled={aangifteLoading}
                    className="ml-auto px-4 py-1.5 tbtn rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                    {aangifteLoading ? t('btn_aangifte_loading') : aangifteFetched ? t('btn_aangifte_refresh') : t('btn_aangifte_fetch')}
                  </button>
                : <span className="ml-auto text-xs text-orange-600 italic">{t('msg_wc_inactive_vat')}</span>
              }
            </div>
            {aangifteError && <p className="mt-2 text-sm text-red-600">{aangifteError}</p>}
            {aangifteFetched && <p className="mt-2 text-xs text-green-600">{t('msg_aangifte_loaded').replace('{n}',aangifteOrders.length).replace('{year}',aangifteYear)}</p>}
          </div>

          {/* Periode-kaarten */}
          <div className={`grid gap-4 ${periode==='maand' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {periodes.map((p: any) => {
              // Verkoop BTW voor deze periode (WooCommerce + eigen verkoopfacturen)
              const pOrders = aangifteOrders.filter((o: any) => {
                const d = (o.date_paid||o.date_created||'').slice(0,10);
                return d >= p.from && d <= p.to && ['completed','processing'].includes(o.status);
              });
              const wcVerkoopBtw   = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total_tax||0), 0);
              const wcVerkoopNetto = pOrders.reduce((s: any,o: any)=>s+parseFloat(o.total||0)-parseFloat(o.total_tax||0), 0);
              // Eigen verkoopfacturen
              const pVerkoop = (verkoopFacturen||[]).filter((f: any) => f.datum >= p.from && f.datum <= p.to);
              const eigenVerkoopBtw   = pVerkoop.reduce((s: any,f: any)=>s+(f.btw||0), 0);
              const eigenVerkoopNetto = pVerkoop.reduce((s: any,f: any)=>s+(f.netto||0), 0);
              const verkoopBtw   = wcVerkoopBtw + eigenVerkoopBtw;
              const verkoopNetto = wcVerkoopNetto + eigenVerkoopNetto;
              const eigenFacturenLabel = pVerkoop.length > 0 ? ` + ${pVerkoop.length} eigen` : '';

              // Inkoop voorbelasting
              const pFacturen = inkoopFacturen.filter((f: any) => f.datum >= p.from && f.datum <= p.to);
              const voorbelasting = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_btw||0), 0);
              const inkoopNetto   = pFacturen.reduce((s: any,f: any)=>s+(f.totaal_netto||0), 0);

              const teBetalen = verkoopBtw - voorbelasting;

              // Periode status
              const isFuture  = p.from > today;
              const isCurrent = p.from <= today && p.to >= today;
              const isPast    = p.to < today;

              const statusCls = isFuture
                ? 'bg-gray-50 border-gray-100'
                : isCurrent
                  ? 'bg-blue-50 border-blue-100'
                  : isPast
                    ? 'bg-white border-gray-100'
                    : 'bg-white border-gray-100';

              const badgeCls = isFuture
                ? 'bg-gray-100 text-gray-400'
                : isCurrent
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500';

              const badgeLabel = isFuture ? t('lbl_aangifte_toekomstig') : isCurrent ? t('lbl_aangifte_lopend') : t('lbl_aangifte_afgesloten');

              return (
                <div key={p.key} className={`rounded-2xl border shadow-sm p-5 space-y-3 ${statusCls}`}>
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-bold text-gray-800">{p.label} <span className="text-sm font-normal text-gray-400">{aangifteYear}</span></div>
                      <div className="text-xs text-gray-400">{p.from} {t('lbl_t_m')} {p.to}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeCls}`}>{badgeLabel}</span>
                  </div>

                  {/* Cijfers */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_omzet_btw')}</div>
                      <div className="text-sm font-bold text-gray-800">{fmt(verkoopBtw)}</div>
                      <div className="text-xs text-gray-400">{pOrders.length > 0 ? `${pOrders.length} WC` : ''}{eigenFacturenLabel}</div>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_voorbelasting')}</div>
                      <div className="text-sm font-bold text-blue-700">{fmt(voorbelasting)}</div>
                      <div className="text-xs text-gray-400">{pFacturen.length} {t('lbl_fact_abbr')}</div>
                    </div>
                    <div className="bg-white/70 rounded-xl p-2">
                      <div className="text-xs text-gray-400 mb-0.5">{t('lbl_te_betalen')}</div>
                      <div className={`text-sm font-bold ${teBetalen >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        {fmt(Math.abs(teBetalen))}
                      </div>
                      <div className={`text-xs font-medium ${teBetalen >= 0 ? 'text-orange-500' : 'text-green-500'}`}>
                        {teBetalen >= 0 ? t('lbl_te_betalen') : t('lbl_terug')}
                      </div>
                    </div>
                  </div>

                  {/* Detail inkoop */}
                  {pFacturen.length > 0 && (
                    <div className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                      {t('lbl_inkoop_netto')} <span className="font-medium text-gray-600">{fmt(inkoopNetto)}</span>
                      {' · '}{t('lbl_verkoop_netto')} <span className="font-medium text-gray-600">{fmt(verkoopNetto)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* BTW per tarief (inkoop voorbelasting per jaar) */}
          {btwPerTariefAangifte.length > 0 && (
            <div className="space-y-4">
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('lbl_voorbelasting_per_tarief')}</h3>
                <p className="text-xs text-gray-400 mb-4">{t('lbl_gebruik_rubriek_5b')}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="py-2 pr-3 text-left font-medium">{t('lbl_btw_tarief')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_netto_grondslag')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('lbl_btw_bedrag')}</th>
                      <th className="py-2 text-right font-medium">{t('lbl_bruto')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {btwPerTariefAangifte.map((r: any)=>(
                      <tr key={r.tarief} className="border-b border-gray-50">
                        <td className="py-2 pr-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.tarief===0?'bg-gray-100 text-gray-500':r.tarief===9?'bg-amber-50 text-amber-700':'bg-blue-50 text-blue-700'}`}>
                            {r.tarief}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netto)}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-blue-700">{fmt(r.btw)}</td>
                        <td className="py-2 text-right text-gray-800">{fmt(r.netto+r.btw)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="py-2 pr-3 text-xs font-semibold text-gray-500 uppercase">{t('lbl_total')}</td>
                      <td className="py-2 pr-3 text-right font-bold text-gray-800">{fmt(btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.netto,0))}</td>
                      <td className="py-2 pr-3 text-right font-bold text-blue-700">{fmt(btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.btw,0))}</td>
                      <td className="py-2 text-right font-bold text-gray-900">{fmt(btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.netto+r.btw,0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className={card + ' bg-blue-50 border-blue-100'}>
                <h3 className="text-xs font-semibold text-blue-800 mb-3 uppercase tracking-wide">{t('lbl_btw_aangifte_hulp')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1a')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(omzetBtwPerTarief.hoog.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(omzetBtwPerTarief.hoog.btw)}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1a_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1b')}</div>
                    <div className="font-bold text-gray-800 text-base">{fmt(omzetBtwPerTarief.laag.netto)}</div>
                    <div className="text-xs text-blue-600 font-medium mb-1">{t('lbl_btw')}: {fmt(omzetBtwPerTarief.laag.btw)}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1b_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_5b')}</div>
                    <div className="font-bold text-blue-700 text-base mb-1">{fmt(btwPerTariefAangifte.reduce((s: any,r: any)=>s+r.btw,0))}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_5b_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_1d')}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_1d_hint')}</div>
                  </div>
                  <div className="bg-white rounded-xl p-3 border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-1">{t('lbl_rubriek_2a')}</div>
                    <div className="text-xs text-gray-400 italic">{t('lbl_rubriek_2a_hint')}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!wcCreds?.enabled && inkoopFacturen.length === 0 && (
            <div className={card + ' text-center py-14'}>
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-600 font-medium mb-1">{t('msg_no_aangifte_data')}</p>
              <p className="text-gray-400 text-sm">{t('msg_no_aangifte_hint')}</p>
            </div>
          )}
        </>);
      })()}

    </div>
  );
}

export default BoekhoudingPage
