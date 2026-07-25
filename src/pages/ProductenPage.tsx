import React from 'react'
import { t } from '../i18n'
import { newId, wcGet, wcPut, ADDON_BASE } from '../utils/api'
import { fmt, fmtD, tod, fmtQty } from '../utils/format'
import Btn from '../components/ui/Btn'
import Sel from '../components/ui/Sel'
import Modal from '../components/ui/Modal'
import SectionHeader from '../components/ui/SectionHeader'
import SearchInput from '../components/ui/SearchInput'
import { logAudit } from '../utils/audit'
import { voorraadPerLocatie, berekenVoorcalcVoorAfvulling, berekenProductKostprijs, batchHoortBijProduct, openBestellingReserveringen, gereserveerdVoorArtikel, pickUitgeslagen } from '../utils/calculations'

type AfboekingReden = 'vermis' | 'vernietiging' | 'overig'
type BijlageRol = 'douane_verklaring' | 'bewijs'
type Bijlage = { naam: string; bestand: string; rol?: BijlageRol; geupload_op?: string }
type VernietigingStatus = 'aangevraagd' | 'toegestaan' | 'uitgevoerd'

const VERNIETIGING_STATUS_LABEL: Record<VernietigingStatus, string> = {
  aangevraagd: 'Aangevraagd',
  toegestaan: 'Toegestaan',
  uitgevoerd: 'Uitgevoerd',
}

const VERNIETIGING_STATUS_COLOR: Record<VernietigingStatus, string> = {
  aangevraagd: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  toegestaan:  'bg-blue-50 text-blue-700 border border-blue-200',
  uitgevoerd:  'bg-green-50 text-green-700 border border-green-200',
}

const AFBOEKING_REDENEN: { v: AfboekingReden; lKey: string }[] = [
  { v: 'vermis',        lKey: 'lbl_afboeking_vermis' },
  { v: 'vernietiging',  lKey: 'lbl_afboeking_vernietiging' },
  { v: 'overig',        lKey: 'lbl_afboeking_overig' },
]

const REDEN_COLORS: Record<AfboekingReden, string> = {
  vermis:         'text-red-600 bg-red-50',
  vernietiging:   'text-orange-600 bg-orange-50',
  overig:         'text-gray-600 bg-gray-100',
}

// M-1: upload helper voor bijlagen (foto's / PDF) bij bijzondere mutaties
const uploadBijlage = async (file: File, prefix: string): Promise<Bijlage | null> => {
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!['pdf','jpg','jpeg','png','gif','webp','tiff','bmp','heic','heif'].includes(ext)) return null
    const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random()*9999)}.${ext}`
    const b64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res((reader.result as string).split(',')[1])
      reader.onerror = rej
      reader.readAsDataURL(file)
    })
    const resp = await fetch(`${ADDON_BASE}api/upload/${filename}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data: b64}),
    })
    if (!resp.ok) return null
    return { naam: file.name, bestand: filename }
  } catch { return null }
}

function ProductenPage({producten, setProducten, productArtikelen, setProductArtikelen, bat, setBat, recepten, verpakkingen, onderdelen, av, setAv, uit, bi, lots, acc, bestellingen, bestellingPicks, verkoopFacturen, artikelen, accijnsInst, setPage, afboekingen, setAfboekingen, log, setLog, gnCodes=[], wcCreds, setWcCreds=()=>{}, wcSyncLog=[], setWcSyncLog=()=>{}, auditLog=[], setAuditLog=()=>{}, locaties=[], verplaatsingen=[]}: any) {
  const {useState, useMemo} = React;
  const [sel, setSel] = useState<number|null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<any>({});
  const [zoek, setZoek] = useState('');
  const [toonGearchiveerd, setToonGearchiveerd] = useState(false);
  const [msg, setMsg] = useState('');
  const [fotoTab, setFotoTab] = useState(0);
  const [artForm, setArtForm] = useState<any>(null);
  const [receptSelectOpen, setReceptSelectOpen] = useState(false);
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [voorraadOpen, setVoorraadOpen] = useState(true);
  const [afboekModal, setAfboekModal] = useState<any>(null);
  const [afboekForm, setAfboekForm] = useState<{
    aantal: string; reden: AfboekingReden; opmerking: string;
    // Legacy (pre-v2.4):
    toestemming_douane: boolean; toestemming_datum: string; kenmerk_douane: string;
    // v2.4 vernietigingsflow (Douane §7.2.3):
    verklaring_ingediend_op: string;
    bijlagen: Bijlage[];
  }>({aantal: '1', reden: 'vermis', opmerking: '', toestemming_douane: false, toestemming_datum: '', kenmerk_douane: '', verklaring_ingediend_op: tod(), bijlagen: []});
  const [afboekError, setAfboekError] = useState('');
  const [afboekUploading, setAfboekUploading] = useState(false);
  // Rebrand-modal: (deel van) een afvulling naar een ander product verplaatsen.
  const [rebrandModal, setRebrandModal] = useState<any>(null);
  const [rebrandForm, setRebrandForm] = useState<{
    aantal: string; product_id: number | ''; opmerking: string;
    toonNieuwProduct: boolean; nieuwProductNaam: string;
  }>({aantal: '1', product_id: '', opmerking: '', toonNieuwProduct: false, nieuwProductNaam: ''});
  const [rebrandError, setRebrandError] = useState('');
  // Vernietigingsreview-modal: voor het doorzetten van een bestaande afboeking
  // van Aangevraagd → Toegestaan → Uitgevoerd (Douane v2.4 §7.2.3).
  const [vernietigReviewModal, setVernietigReviewModal] = useState<any>(null);
  const [vernietigReviewForm, setVernietigReviewForm] = useState<{
    toestemming_ontvangen_op: string;
    kenmerk_douane: string;
    uitgevoerd_op: string;
    bewijsBijlagen: Bijlage[];
    extraToelichting: string;
  }>({toestemming_ontvangen_op: tod(), kenmerk_douane: '', uitgevoerd_op: tod(), bewijsBijlagen: [], extraToelichting: ''});
  const [vernietigReviewError, setVernietigReviewError] = useState('');
  const [vernietigReviewUploading, setVernietigReviewUploading] = useState(false);
  const [prijsInclBtw, setPrijsInclBtw] = useState(false);
  const [b2bPrijsInclBtw, setB2bPrijsInclBtw] = useState(false);
  const [logboekOpen, setLogboekOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<'alle' | 'voorraad' | 'woocommerce'>('alle');
  const [wcSyncing, setWcSyncing] = useState(false);
  const [wcSyncMsg, setWcSyncMsg] = useState('');

  const selProduct = useMemo(() => (producten||[]).find((p: any) => p.id === sel), [producten, sel]);

  const filterProducten = (list: any[]) => {
    if (!zoek.trim()) return list;
    const q = zoek.toLowerCase();
    return list.filter((p: any) => (p.naam||'').toLowerCase().includes(q) || (p.stijl||'').toLowerCase().includes(q) || (p.categorie||'').toLowerCase().includes(q));
  };

  const actieveProducten = useMemo(() => {
    const list = ((producten||[]) as any[]).filter((p: any) => p.status !== 'gearchiveerd');
    return filterProducten(list).sort((a: any, b: any) => (a.naam||'').localeCompare(b.naam||''));
  }, [producten, zoek]);

  const gearchiveerdeProducten = useMemo(() => {
    const list = ((producten||[]) as any[]).filter((p: any) => p.status === 'gearchiveerd');
    return filterProducten(list).sort((a: any, b: any) => (a.naam||'').localeCompare(b.naam||''));
  }, [producten, zoek]);

  // Voorraad helpers
  const beschikbaarVoorAfvulling = (a: any): number => {
    const gepickt = ((bestellingPicks||[]) as any[]).filter((p: any) => {
      if (p.afvulling_id !== a.id) return false;
      if (pickUitgeslagen(p)) return false; // uitlevering telt al mee hieronder
      const b = ((bestellingen||[]) as any[]).find((bs: any) => bs.id === p.bestelling_id);
      return b && b.status !== 'afgerond' && b.status !== 'geannuleerd';
    }).reduce((s: number, p: any) => s + Number(p.aantal||0), 0);
    const uitgeleverd = ((uit||[]) as any[]).filter((u: any) => u.afvulling_id === a.id).reduce((s: number, u: any) => s + Number(u.aantal||0), 0);
    const afgeboekt = ((afboekingen||[]) as any[]).filter((ab: any) => ab.afvulling_id === a.id).reduce((s: number, ab: any) => s + Number(ab.aantal||0), 0);
    return Math.max(0, Number(a.hoeveelheid||0) - gepickt - uitgeleverd - afgeboekt);
  };

  const gepicktVoorAfvulling = (a: any): number =>
    ((bestellingPicks||[]) as any[]).filter((p: any) => {
      if (p.afvulling_id !== a.id) return false;
      if (pickUitgeslagen(p)) return false; // zit al in "Uitgeleverd"
      const b = ((bestellingen||[]) as any[]).find((bs: any) => bs.id === p.bestelling_id);
      return b && b.status !== 'afgerond' && b.status !== 'geannuleerd';
    }).reduce((s: number, p: any) => s + Number(p.aantal||0), 0);

  const uitgeleverdVoorAfvulling = (a: any): number =>
    ((uit||[]) as any[]).filter((u: any) => u.afvulling_id === a.id).reduce((s: number, u: any) => s + Number(u.aantal||0), 0);

  const afgeboektVoorAfvulling = (a: any): number =>
    ((afboekingen||[]) as any[]).filter((ab: any) => ab.afvulling_id === a.id).reduce((s: number, ab: any) => s + Number(ab.aantal||0), 0);

  // Beschikbaar per locatie voor één afvulling: fysieke voorraad per locatie
  // (uit voorraadPerLocatie) minus de actieve picks per locatie.
  const beschikbaarPerLocatie = (a: any): Record<number, number> => {
    if (!a || !(locaties||[]).length) return {};
    const fysiek = voorraadPerLocatie(a, locaties as any, uit as any, verplaatsingen as any, afboekingen as any);
    const res: Record<number, number> = {...fysiek};
    const agp = (locaties||[]).find((l: any) => l.is_agp) || (locaties||[])[0];
    const agpId = agp?.id;
    // Actieve picks op deze afvulling aftrekken op hun bron-locatie (of AGP)
    for (const p of ((bestellingPicks||[]) as any[])) {
      if (p.afvulling_id !== a.id) continue;
      if (pickUitgeslagen(p)) continue; // uitlevering al verwerkt in voorraadPerLocatie
      const b = ((bestellingen||[]) as any[]).find((bs: any) => bs.id === p.bestelling_id);
      if (!b || b.status === 'afgerond' || b.status === 'geannuleerd') continue;
      const locId = p.bron_locatie_id ?? agpId;
      res[locId] = (res[locId] || 0) - Number(p.aantal || 0);
    }
    for (const k of Object.keys(res)) {
      const id = Number(k);
      if (res[id] < 0) res[id] = 0;
    }
    return res;
  };

  // Zachte reserveringen uit open bestellingen (nog niet gepickt). Net als in
  // WooCommerce zelf telt een binnengekomen bestelling direct als gereserveerde
  // voorraad, ook al is er nog geen afvulling gekozen (picking).
  const openReserveringen = useMemo(
    () => openBestellingReserveringen(bestellingen || [], bestellingPicks || []),
    [bestellingen, bestellingPicks]
  );

  // Matcht het verpakkingstype van een bestelregel/artikel (bijv. "fles") op
  // het verpakkingstype van een afvulling (kan ook de verpakkingsnaam zijn,
  // bijv. "Vichy 33cL").
  const vpTypeMatch = (artType: string, afvVt: string): boolean => {
    const a = (artType || '').toLowerCase(), b = (afvVt || '').toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    return (verpakkingen || []).some((v: any) => (v.type || '').toLowerCase() === a && (v.naam || '').toLowerCase() === b);
  };

  // Reserveringen die bij één product horen: match op SKU van de
  // productartikelen (of legacy artikelen met dezelfde biernaam), anders op
  // productnaam.
  const reserveringenVoorProduct = (p: any) => {
    if (!p) return [];
    const skus = new Set([
      ...(productArtikelen || []).filter((pa: any) => pa.product_id === p.id && pa.artikelnummer).map((pa: any) => pa.artikelnummer),
      ...(artikelen || []).filter((a: any) => a.artikelnummer && (a.biernaam || '').toLowerCase() === (p.naam || '').toLowerCase()).map((a: any) => a.artikelnummer),
    ]);
    return openReserveringen.filter((r: any) =>
      (r.sku && skus.has(r.sku)) || (r.bier_naam || '').toLowerCase() === (p.naam || '').toLowerCase()
    );
  };

  // Statistieken per product. Kostprijs/liter komt uit `berekenProductKostprijs`
  // en gebruikt dezelfde scope als het kostprijsoverzicht op de Batch-pagina:
  // ingrediënten + utility + verpakking + accijns, gedeeld door werkelijk
  // afgevulde liters. Het `liter`-veld blijft de som van `liter_vergist` voor
  // andere statistieken op deze pagina.
  const productStats = useMemo(() => {
    const stats: Record<number, {batches: number, liter: number, voorraad: number, uitgeleverd: number, kostprijs: number}> = {};
    for (const p of (producten||[])) {
      // Batch-set: batches die direct op het product staan (`b.product_id`) én
      // batches die via een afvulling aan het product zijn gekoppeld
      // (`afvulling.product_id`). Bij afvullen wordt het product namelijk op de
      // afvulling gezet, niet terug op de batch — zonder deze unie telde die
      // batch niet mee ("0 batches gebrouwen").
      const avBatchIds = new Set(
        (av||[]).filter((a: any) => a.product_id === p.id).map((a: any) => a.batch_id)
      );
      const pBatches = (bat||[]).filter((b: any) => batchHoortBijProduct(b, p.id) || avBatchIds.has(b.id));
      const batchIds = new Set(pBatches.map((b: any) => b.id));
      const totaalLiter = pBatches.reduce((s: number, b: any) => s + Number(b.liter_vergist||0), 0);
      const pAv = (av||[]).filter((a: any) => a.product_id === p.id || (!a.product_id && batchIds.has(a.batch_id)));
      // Beschikbaar = fysiek beschikbaar minus zachte reserveringen uit open
      // (nog niet gepickte) bestellingen.
      const inBestelling = reserveringenVoorProduct(p).reduce((s: number, r: any) => s + r.aantal, 0);
      const voorraad = Math.max(0, pAv.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0) - inBestelling);
      const uitgeleverd = pAv.reduce((s: number, a: any) => s + uitgeleverdVoorAfvulling(a), 0);
      const {kostprijs_per_liter} = berekenProductKostprijs(p.id, bat, bi, lots, av, verpakkingen, onderdelen, acc);
      stats[p.id] = {batches: pBatches.length, liter: totaalLiter, voorraad, uitgeleverd, kostprijs: kostprijs_per_liter};
    }
    return stats;
  }, [producten, bat, av, uit, bi, lots, verpakkingen, onderdelen, acc, bestellingen, bestellingPicks, afboekingen, productArtikelen, artikelen]);

  const selArtikelen = useMemo(() => (productArtikelen||[]).filter((a: any) => a.product_id === sel), [productArtikelen, sel]);
  const selRecepten = useMemo(() => {
    if (!selProduct?.recept_ids?.length) return [];
    return (recepten||[]).filter((r: any) => selProduct.recept_ids.includes(r.id));
  }, [selProduct, recepten]);
  const beschikbareRecepten = useMemo(() => {
    const gekoppeld = new Set(selProduct?.recept_ids || []);
    return (recepten||[]).filter((r: any) => !gekoppeld.has(r.id));
  }, [selProduct, recepten]);
  // Batches van het geselecteerde product: direct gekoppeld (primair product_id
  // of extra product_ids) én batches die via een afvulling aan dit product zijn
  // gekoppeld (afvulling.product_id, bijv. na een rebrand).
  const selBatches = useMemo(() => {
    if (!sel) return [];
    const avBatchIds = new Set((av||[]).filter((a: any) => a.product_id === sel).map((a: any) => a.batch_id));
    return (bat||[]).filter((b: any) => batchHoortBijProduct(b, sel) || avBatchIds.has(b.id));
  }, [bat, av, sel]);
  // Batches die (nog) niet aan dit product gekoppeld zijn — kandidaten voor de
  // handmatige koppel-selector op het productdetail.
  const beschikbareBatches = useMemo(() => {
    if (!sel) return [];
    const gekoppeld = new Set(selBatches.map((b: any) => b.id));
    return (bat||[])
      .filter((b: any) => !gekoppeld.has(b.id))
      .sort((a: any, b: any) => String(b.datum||'').localeCompare(String(a.datum||'')) || Number(b.id||0) - Number(a.id||0));
  }, [bat, selBatches, sel]);

  // Voorraad voor geselecteerd product: afvullingen gegroepeerd per verpakkingstype
  const selVoorraad = useMemo(() => {
    if (!sel) return [];
    const batchIds = new Set(selBatches.map((b: any) => b.id));
    const pAv = (av||[]).filter((a: any) => a.product_id === sel || (!a.product_id && batchIds.has(a.batch_id)));
    const vTypes = [...new Set(pAv.map((a: any) => a.verpakking_type).filter(Boolean))].sort() as string[];
    const prodReserveringen = reserveringenVoorProduct(selProduct);
    return vTypes.map(vt => {
      const rows = pAv.filter((a: any) => a.verpakking_type === vt);
      const totAfgevuld = rows.reduce((s: number, a: any) => s + Number(a.hoeveelheid||0), 0);
      const totGepickt = rows.reduce((s: number, a: any) => s + gepicktVoorAfvulling(a), 0);
      const totUitgeleverd = rows.reduce((s: number, a: any) => s + uitgeleverdVoorAfvulling(a), 0);
      const totAfgeboekt = rows.reduce((s: number, a: any) => s + afgeboektVoorAfvulling(a), 0);
      // Zachte reserveringen uit open bestellingen voor dit verpakkingstype;
      // regels zonder verpakkingstype worden via hun SKU-artikel geresolved.
      const totInBestelling = prodReserveringen.filter((r: any) => {
        const rVt = r.verpakking_type
          || (r.sku ? ((productArtikelen||[]).find((pa: any) => pa.artikelnummer === r.sku)?.verpakking_type
            || (artikelen||[]).find((a: any) => a.artikelnummer === r.sku)?.verpakking_type || '') : '');
        return vpTypeMatch(rVt, vt);
      }).reduce((s: number, r: any) => s + r.aantal, 0);
      const totBeschikbaar = Math.max(0, rows.reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0) - totInBestelling);
      return {vt, rows, totAfgevuld, totGepickt, totUitgeleverd, totAfgeboekt, totInBestelling, totBeschikbaar};
    });
  }, [sel, selProduct, selBatches, av, uit, bestellingPicks, bestellingen, afboekingen, productArtikelen, artikelen, verpakkingen]);

  const startEdit = (product?: any) => {
    if (product) {
      setForm({...product});
    } else {
      setForm({id: newId(producten), naam: '', stijl: '', omschrijving: '', afbeeldingen: [], recept_ids: [], categorie: '', status: 'actief', notities: '', abv: '', ebc: '', ibu: '', created_at: tod()});
    }
    setEditMode(true);
    setFotoTab(0);
  };

  const saveProduct = () => {
    if (!form.naam?.trim()) { setMsg(t('err_product_naam_required')); return; }
    const dupl = (producten||[]).find((p: any) => p.naam.toLowerCase() === form.naam.trim().toLowerCase() && p.id !== form.id);
    if (dupl) { setMsg(t('err_product_naam_duplicaat')); return; }
    const updated = {...form, naam: form.naam.trim()};
    const exists = (producten||[]).find((p: any) => p.id === form.id);
    if (exists) {
      setProducten((prev: any[]) => prev.map((p: any) => p.id === form.id ? updated : p));
      logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: form.id, actie: 'gewijzigd', omschrijving: `Product "${updated.naam}" gewijzigd`});
    } else {
      setProducten((prev: any[]) => [...(prev||[]), updated]);
      setSel(form.id);
      logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: form.id, actie: 'aangemaakt', omschrijving: `Product "${updated.naam}" aangemaakt`});
    }
    setEditMode(false);
    setMsg('');
  };

  const deleteProduct = () => {
    if (!confirm(t('confirm_product_verwijderen'))) return;
    logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: sel!, actie: 'verwijderd', omschrijving: `Product "${selProduct?.naam || ''}" verwijderd`});
    setProducten((prev: any[]) => prev.filter((p: any) => p.id !== sel));
    setProductArtikelen((prev: any[]) => prev.filter((a: any) => a.product_id !== sel));
    setBat((prev: any[]) => prev.map((b: any) => {
      const heeftExtra = (b.product_ids||[]).some((id: any) => Number(id) === Number(sel));
      if (Number(b.product_id) !== Number(sel) && !heeftExtra) return b;
      return {
        ...b,
        ...(Number(b.product_id) === Number(sel) ? {product_id: undefined} : {}),
        product_ids: (b.product_ids||[]).filter((id: any) => Number(id) !== Number(sel)),
      };
    }));
    setSel(null);
  };

  const toggleArchiveer = () => {
    const newStatus = selProduct?.status === 'gearchiveerd' ? 'actief' : 'gearchiveerd';
    setProducten((prev: any[]) => prev.map((p: any) => p.id === sel ? {...p, status: newStatus} : p));
    logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: sel!, actie: 'gewijzigd', omschrijving: `Product "${selProduct?.naam || ''}" status → ${newStatus}`});
  };

  // Foto upload — de afbeelding wordt vóór opslag verkleind (max 1000px) en als
  // JPEG gecomprimeerd. De ruwe base64 werd anders inline in de `producten`-
  // sleutel opgeslagen; een foto van ~2 MB blies dan de localStorage-quota op
  // waardoor de app crashte bij het opslaan. Na compressie is een foto ~100–200 kB.
  const handleFotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMsg(t('err_foto_te_groot').replace('{max}', '10MB')); return; }
    const fotos = form.afbeeldingen || [];
    if (fotos.length >= 5) { setMsg(t('err_max_fotos').replace('{max}', '5')); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1000;
          let {width, height} = img;
          if (width > MAX || height > MAX) {
            const schaal = Math.min(MAX / width, MAX / height);
            width = Math.round(width * schaal);
            height = Math.round(height * schaal);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { setMsg(t('err_foto_verwerken')); return; }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          setForm((f: any) => ({...f, afbeeldingen: [...(f.afbeeldingen||[]), compressed]}));
        } catch { setMsg(t('err_foto_verwerken')); }
      };
      img.onerror = () => setMsg(t('err_foto_verwerken'));
      img.src = dataUrl;
    };
    reader.onerror = () => setMsg(t('err_foto_verwerken'));
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeFoto = (idx: number) => {
    setForm((f: any) => ({...f, afbeeldingen: (f.afbeeldingen||[]).filter((_: any, i: number) => i !== idx)}));
    if (fotoTab >= (form.afbeeldingen?.length || 1) - 1) setFotoTab(Math.max(0, fotoTab - 1));
  };

  const koppelRecept = (receptId: string) => {
    setForm((f: any) => ({...f, recept_ids: [...(f.recept_ids||[]), receptId]}));
    setReceptSelectOpen(false);
  };

  const ontkoppelRecept = (receptId: string) => {
    setForm((f: any) => ({...f, recept_ids: (f.recept_ids||[]).filter((id: string) => id !== receptId)}));
  };

  // Batch handmatig aan het geselecteerde product koppelen (extra product_ids).
  // Het primaire product_id van de batch blijft ongemoeid; de batch kan zo aan
  // meerdere producten hangen. De kostprijs verdeelt naar afgevuld volume.
  const koppelBatch = (batchId: number) => {
    if (!sel || !setBat) return;
    const b = (bat||[]).find((x: any) => x.id === batchId);
    if (!b || batchHoortBijProduct(b, sel)) { setBatchSelectOpen(false); return; }
    setBat((prev: any[]) => (prev||[]).map((x: any) => x.id === batchId
      ? {...x, product_ids: [...(x.product_ids||[]), sel]}
      : x));
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batchId, actie: 'gewijzigd',
      omschrijving: `Batch "${b.naam || ''}" gekoppeld aan product "${selProduct?.naam || ''}"`});
    setBatchSelectOpen(false);
  };

  // Batch loskoppelen van het product: verwijder het product uit product_ids en,
  // als het het primaire product was, uit product_id. Batches die alleen via een
  // afvulling gekoppeld zijn worden hier niet getoond met een ontkoppelknop.
  const ontkoppelBatch = (batchId: number) => {
    if (!sel || !setBat) return;
    const b = (bat||[]).find((x: any) => x.id === batchId);
    setBat((prev: any[]) => (prev||[]).map((x: any) => {
      if (x.id !== batchId) return x;
      const next: any = {...x, product_ids: (x.product_ids||[]).filter((id: any) => Number(id) !== Number(sel))};
      if (Number(x.product_id) === Number(sel)) next.product_id = undefined;
      return next;
    }));
    logAudit(auditLog, setAuditLog, {entiteit: 'Batch', entiteit_id: batchId, actie: 'gewijzigd',
      omschrijving: `Batch "${b?.naam || ''}" ontkoppeld van product "${selProduct?.naam || ''}"`});
  };

  // Artikel CRUD
  const startArtEdit = (art?: any) => {
    setPrijsInclBtw(false);
    setB2bPrijsInclBtw(false);
    if (art) {
      setArtForm({...art});
    } else {
      setArtForm({id: newId(productArtikelen), product_id: sel, verpakking_id: '', verpakking_naam: '', verpakking_type: '', inhoud_liter: '', artikelnummer: '', ean: '', verkoopprijs: '', btw_pct: 9, omschrijving: '', wc_push: true});
    }
  };

  const saveArtikel = () => {
    if (!artForm) return;
    const vp = (verpakkingen||[]).find((v: any) => v.id === Number(artForm.verpakking_id));
    let prijs = Number(artForm.verkoopprijs || 0);
    if (prijsInclBtw && prijs > 0) {
      prijs = prijs / (1 + Number(artForm.btw_pct || 0) / 100);
    }
    let b2b = Number(artForm.b2b_prijs || 0);
    if (b2bPrijsInclBtw && b2b > 0) {
      b2b = b2b / (1 + Number(artForm.btw_pct || 0) / 100);
    }
    const updated = {...artForm, verkoopprijs: prijs > 0 ? prijs.toFixed(2) : artForm.verkoopprijs, b2b_prijs: b2b > 0 ? b2b.toFixed(2) : artForm.b2b_prijs, verpakking_naam: vp?.naam || artForm.verpakking_naam, verpakking_type: vp?.type || vp?.naam || artForm.verpakking_type, inhoud_liter: vp?.inhoud_liter || artForm.inhoud_liter};
    const exists = (productArtikelen||[]).find((a: any) => a.id === artForm.id);
    if (exists) {
      setProductArtikelen((prev: any[]) => prev.map((a: any) => a.id === artForm.id ? updated : a));
      logAudit(auditLog, setAuditLog, {entiteit: 'Artikel', entiteit_id: artForm.id, actie: 'gewijzigd', omschrijving: `Artikel "${updated.verpakking_naam || updated.artikelnummer || ''}" gewijzigd`});
    } else {
      setProductArtikelen((prev: any[]) => [...(prev||[]), updated]);
      logAudit(auditLog, setAuditLog, {entiteit: 'Artikel', entiteit_id: artForm.id, actie: 'aangemaakt', omschrijving: `Artikel "${updated.verpakking_naam || updated.artikelnummer || ''}" aangemaakt`});
    }
    setArtForm(null);
  };

  const deleteArtikel = (id: number) => {
    const art = (productArtikelen||[]).find((a: any) => a.id === id);
    logAudit(auditLog, setAuditLog, {entiteit: 'Artikel', entiteit_id: id, actie: 'verwijderd', omschrijving: `Artikel "${art?.verpakking_naam || art?.artikelnummer || ''}" verwijderd`});
    setProductArtikelen((prev: any[]) => prev.filter((a: any) => a.id !== id));
  };

  // Marge op een prijs excl. BTW t.o.v. de kostprijs per eenheid.
  const margeVoorPrijs = (kostprijsPerEenheid: number, prijsExcl: number) =>
    prijsExcl > 0
      ? {eur: prijsExcl - kostprijsPerEenheid, pct: ((prijsExcl - kostprijsPerEenheid) / prijsExcl) * 100}
      : null;

  // Kostprijs/marge-inschatting per artikel: kostprijs per liter van het
  // product (ingrediënten + utility + verpakking + accijns, uit
  // berekenProductKostprijs) × inhoud van de verpakking. Verkoop- en
  // B2B-prijs staan excl. BTW opgeslagen (saveArtikel normaliseert).
  const berekenMarge = (art: any) => {
    const stats = productStats[sel!];
    const inhoud = Number(art.inhoud_liter || 0);
    if (!stats || stats.kostprijs <= 0 || !inhoud) return null;
    const kostprijsPerEenheid = stats.kostprijs * inhoud;
    return {
      kostprijsPerEenheid,
      consument: margeVoorPrijs(kostprijsPerEenheid, Number(art.verkoopprijs || 0)),
      b2b: margeVoorPrijs(kostprijsPerEenheid, Number(art.b2b_prijs || 0)),
    };
  };

  // Afboeken
  const openAfboekModal = (a: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setAfboekForm({aantal: '1', reden: 'vermis', opmerking: '', toestemming_douane: false, toestemming_datum: '', kenmerk_douane: '', verklaring_ingediend_op: tod(), bijlagen: []});
    setAfboekError('');
    setAfboekModal(a);
  };

  // Rebrand: (deel van) de beschikbare voorraad van een afvulling onder een
  // ander product hangen. De batch blijft dezelfde; alleen het product (en
  // daarmee de SKU) verandert. Volledige beschikbare voorraad zonder
  // verplichtingen → product_id in-place wijzigen (id blijft gelijk, dus geen
  // referentiebreuk); een deel → de afvulling splitsen in twee rijen.
  const openRebrandModal = (a: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setRebrandForm({aantal: String(beschikbaarVoorAfvulling(a)), product_id: '', opmerking: '', toonNieuwProduct: false, nieuwProductNaam: ''});
    setRebrandError('');
    setRebrandModal(a);
  };

  // Huidig product van een afvulling: direct via product_id, anders (legacy)
  // via het product van de batch.
  const productVanAfvulling = (a: any): number | undefined =>
    a?.product_id || (bat||[]).find((b: any) => b.id === a?.batch_id)?.product_id;

  const doRebrand = () => {
    const a = rebrandModal;
    if (!a || !setAv) return;
    const aantal = Number(rebrandForm.aantal);
    const doelId = Number(rebrandForm.product_id);
    if (!doelId) { setRebrandError(t('err_rebrand_product_required')); return; }
    const huidigId = productVanAfvulling(a);
    if (doelId === huidigId) { setRebrandError(t('err_rebrand_zelfde_product')); return; }
    if (!aantal || aantal < 1 || !Number.isInteger(aantal)) { setRebrandError(t('err_afboeking_aantal_min')); return; }
    const max = beschikbaarVoorAfvulling(a);
    if (aantal > max) { setRebrandError(t('err_afboeking_max_available').replace('{max}', String(max)).replace('{unit}', t('unit_stuks'))); return; }
    const totaal = Number(a.hoeveelheid||0);
    const vanProduct = (producten||[]).find((p: any) => p.id === huidigId);
    const doelProduct = (producten||[]).find((p: any) => p.id === doelId);
    // SKU van het doelproduct voor deze verpakking (zelfde matching als bij
    // afvullen in BatchesPage): eerst op verpakking_id, anders op type.
    const pArt = (productArtikelen||[]).find((pa: any) => pa.product_id === doelId && (
      (a.verpakking_id && pa.verpakking_id === Number(a.verpakking_id)) ||
      (!a.verpakking_id && pa.verpakking_type && vpTypeMatch(pa.verpakking_type, a.verpakking_type))
    ));
    const nieuweSku = pArt?.artikelnummer || null;
    const perEenheid = Number(a.voorcalc_accijns_per_eenheid) || 0;
    const rebrandVelden: any = {
      rebrand_van_afvulling_id: a.id,
      rebrand_datum: tod(),
    };
    if (huidigId) rebrandVelden.rebrand_van_product_id = huidigId;
    if (rebrandForm.opmerking.trim()) rebrandVelden.rebrand_opmerking = rebrandForm.opmerking.trim();
    let nieuwId = a.id;
    if (aantal === totaal && max === totaal) {
      // Alles, en er hangen geen picks/uitleveringen/afboekingen aan: de rij
      // in-place omhangen zodat alle bestaande referenties intact blijven.
      setAv((prev: any[]) => (prev||[]).map((x: any) => x.id === a.id
        ? {...x, product_id: doelId, artikel_sku: nieuweSku, ...rebrandVelden}
        : x));
    } else {
      // Deelrebrand: splitsen. Origineel krimpt (nooit onder de al vastgelegde
      // picks/uitleveringen/afboekingen dankzij de max-check hierboven); de
      // nieuwe rij erft alle verpakkings- en accijnsgegevens van de bron.
      nieuwId = newId(av||[]);
      const rest = totaal - aantal;
      setAv((prev: any[]) => [
        ...(prev||[]).map((x: any) => x.id === a.id
          ? {
              ...x,
              hoeveelheid: rest,
              ...(x.aantal !== undefined ? {aantal: rest} : {}),
              ...(perEenheid > 0 ? {voorcalc_accijns_totaal: perEenheid * rest} : {}),
            }
          : x),
        {
          ...a,
          id: nieuwId,
          product_id: doelId,
          artikel_sku: nieuweSku,
          hoeveelheid: aantal,
          ...(a.aantal !== undefined ? {aantal} : {}),
          ...(perEenheid > 0 ? {voorcalc_accijns_totaal: perEenheid * aantal} : {}),
          ...rebrandVelden,
        },
      ]);
    }
    // Koppel de batch óók aan het doelproduct (extra product_ids). Zo verschijnt
    // de batch onder dat product en telt de kostprijs — die naar afgevuld volume
    // wordt verdeeld — het ge-rebrande deel bij het nieuwe product mee.
    if (setBat) {
      setBat((prev: any[]) => (prev||[]).map((b: any) => (
        b.id === a.batch_id && !batchHoortBijProduct(b, doelId)
          ? {...b, product_ids: [...(b.product_ids||[]), doelId]}
          : b
      )));
    }
    const vanNaam = vanProduct?.naam || t('lbl_onbekend');
    const naarNaam = doelProduct?.naam || t('lbl_onbekend');
    const batch = (bat||[]).find((b: any) => b.id === a.batch_id);
    const omschrijving = t('log_rebrand_omschrijving')
      .replace('{van}', vanNaam).replace('{naar}', naarNaam)
      + (rebrandForm.opmerking.trim() ? ` — ${rebrandForm.opmerking.trim()}` : '');
    logAudit(auditLog, setAuditLog, {entiteit: 'Afvulling', entiteit_id: nieuwId, actie: 'gewijzigd',
      omschrijving: `${t('lbl_rebrand')} ${aantal}× ${a.verpakking_naam || a.verpakking_type || ''}: ${vanNaam} → ${naarNaam}`});
    if (setLog) setLog((prev: any[]) => [...(prev||[]), {
      id: newId(prev||[]),
      datum: tod(),
      type: 'rebrand',
      batch_id: a.batch_id,
      batch_naam: batch?.naam || '',
      afvulling_id: nieuwId,
      verpakking_type: a.verpakking_naam || a.verpakking_type || '',
      hoeveelheid: aantal,
      eenheid: 'stuks',
      referentie: t('lbl_rebrand'),
      omschrijving,
    }]);
    setRebrandModal(null);
  };

  // Vernietigingsreview: doorzetten van bestaande afboeking naar volgende status.
  // Douane v2.4 §7.2.3: Aangevraagd → Toegestaan → Uitgevoerd.
  const openVernietigReview = (afb: any) => {
    setVernietigReviewForm({
      toestemming_ontvangen_op: afb.toestemming_ontvangen_op || tod(),
      kenmerk_douane: afb.kenmerk_douane || '',
      uitgevoerd_op: afb.uitgevoerd_op || tod(),
      bewijsBijlagen: [],
      extraToelichting: '',
    });
    setVernietigReviewError('');
    setVernietigReviewModal(afb);
  };

  const doAfboekUpload = async (files: FileList | null, rol?: BijlageRol) => {
    if (!files || files.length === 0) return;
    setAfboekUploading(true);
    const nieuwe: Bijlage[] = [];
    for (let i = 0; i < files.length; i++) {
      const b = await uploadBijlage(files[i], 'afboek');
      if (b) nieuwe.push({...b, rol, geupload_op: new Date().toISOString()});
    }
    if (nieuwe.length > 0) setAfboekForm(f => ({...f, bijlagen: [...(f.bijlagen||[]), ...nieuwe]}));
    setAfboekUploading(false);
  };

  const doVernietigBewijsUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setVernietigReviewUploading(true);
    const nieuwe: Bijlage[] = [];
    for (let i = 0; i < files.length; i++) {
      const b = await uploadBijlage(files[i], 'afboek');
      if (b) nieuwe.push({...b, rol: 'bewijs', geupload_op: new Date().toISOString()});
    }
    if (nieuwe.length > 0) setVernietigReviewForm(f => ({...f, bewijsBijlagen: [...(f.bewijsBijlagen||[]), ...nieuwe]}));
    setVernietigReviewUploading(false);
  };

  const doVernietigBewijsRemove = (idx: number) => {
    const b = vernietigReviewForm.bewijsBijlagen[idx];
    if (b?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${b.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setVernietigReviewForm(f => ({...f, bewijsBijlagen: (f.bewijsBijlagen||[]).filter((_, i) => i !== idx)}));
  };

  const doAfboekRemoveBijlage = (idx: number) => {
    const b = afboekForm.bijlagen[idx];
    if (b?.bestand) {
      fetch(`${ADDON_BASE}api/delete_upload/${b.bestand}`, {method:'POST', body:'{}'}).catch(()=>{});
    }
    setAfboekForm(f => ({...f, bijlagen: (f.bijlagen||[]).filter((_, i) => i !== idx)}));
  };

  const doAfboeken = () => {
    const aantal = Number(afboekForm.aantal);
    if (!afboekForm.opmerking.trim()) { setAfboekError(t('err_afboeking_opmerking_required')); return; }
    if (!aantal || aantal === 0) { setAfboekError(t('err_afboeking_aantal_min')); return; }
    if (aantal > 0) {
      const max = beschikbaarVoorAfvulling(afboekModal);
      if (aantal > max) { setAfboekError(t('err_afboeking_max_available').replace('{max}', String(max)).replace('{unit}', t('unit_stuks'))); return; }
    }
    // Voorcalculatie accijns (Douane v2.4 §7.2.1) — bevroren bedrag per eenheid op afboekmoment
    const isVernietiging = afboekForm.reden === 'vernietiging';
    const perEenheid = Number(afboekModal.voorcalc_accijns_per_eenheid) > 0
      ? Number(afboekModal.voorcalc_accijns_per_eenheid)
      : berekenVoorcalcVoorAfvulling(
          { inhoud_per_eenheid: Number(afboekModal.inhoud_per_eenheid||0), hoeveelheid: 1, aantal: 1 },
          (bat||[]).find((b: any) => b.id === afboekModal.batch_id),
          accijnsInst
        ).perEenheid;
    const totaalVoorcalc = perEenheid * aantal;
    // Douane v2.4 §7.2.3: vernietiging start in status 'Aangevraagd'.
    // Verplicht: datum indiening verklaring + minimaal 1 bijlage met rol douane_verklaring.
    if (afboekForm.reden === 'vernietiging') {
      if (!afboekForm.verklaring_ingediend_op) { setAfboekError('Datum indiening verklaring is verplicht.'); return; }
      const verklaringen = (afboekForm.bijlagen||[]).filter(b => b.rol === 'douane_verklaring');
      if (verklaringen.length === 0) { setAfboekError('Upload de ingediende verklaring vernietiging als bijlage (rol: douane_verklaring).'); return; }
    }
    const nieuw: any = {
      id: newId(afboekingen||[]),
      afvulling_id: afboekModal.id,
      batch_id: afboekModal.batch_id,
      datum: tod(),
      aantal,
      reden: afboekForm.reden,
      opmerking: afboekForm.opmerking.trim(),
      created_at: new Date().toISOString(),
      voorcalc_accijns_per_eenheid: perEenheid,
      voorcalc_accijns_totaal: totaalVoorcalc,
    };
    if (afboekForm.reden === 'vernietiging') {
      nieuw.vernietiging_status = 'aangevraagd';
      nieuw.verklaring_ingediend_op = afboekForm.verklaring_ingediend_op;
      nieuw.bijlagen = afboekForm.bijlagen;
    }
    if (setAfboekingen) setAfboekingen((prev: any[]) => [...(prev||[]), nieuw]);
    const extraAudit = afboekForm.reden === 'vernietiging'
      ? ` — verklaring ingediend op ${fmtD(afboekForm.verklaring_ingediend_op)}, ${(afboekForm.bijlagen||[]).length} bijlage(n) — status Aangevraagd`
      : '';
    logAudit(auditLog, setAuditLog, {entiteit: 'Afboeking', entiteit_id: nieuw.id, actie: 'aangemaakt', omschrijving: `Afboeking ${aantal}× ${afboekModal.verpakking_naam || afboekModal.verpakking_type || ''} (${afboekForm.reden})${extraAudit}`});
    const redenLabel = t(AFBOEKING_REDENEN.find(r => r.v === afboekForm.reden)?.lKey || afboekForm.reden);
    const batch = (bat||[]).find((b: any) => b.id === afboekModal.batch_id);
    if (setLog) setLog((prev: any[]) => [...(prev||[]), {
      id: newId(prev||[]),
      datum: tod(),
      type: 'afboeking',
      batch_id: afboekModal.batch_id,
      batch_naam: batch?.naam || '',
      afvulling_id: afboekModal.id,
      verpakking_type: afboekModal.verpakking_naam || afboekModal.verpakking_type || '',
      hoeveelheid: aantal,
      eenheid: 'stuks',
      reden: afboekForm.reden,
      referentie: redenLabel,
      omschrijving: `${redenLabel} — ${afboekForm.opmerking.trim()}${totaalVoorcalc>0?` · voorcalc accijns € ${totaalVoorcalc.toFixed(2)}`:''}`,
    }]);
    setAfboekModal(null);
  };

  // --- Vernietigingsreview: status doorzetten (Douane v2.4 §7.2.3) ---
  const markVernietigingToegestaan = () => {
    if (!vernietigReviewModal) return;
    if (!vernietigReviewForm.toestemming_ontvangen_op) {
      setVernietigReviewError('Datum waarop toestemming Douane is ontvangen is verplicht.'); return;
    }
    const upd: any = {
      vernietiging_status: 'toegestaan',
      toestemming_ontvangen_op: vernietigReviewForm.toestemming_ontvangen_op,
    };
    if (vernietigReviewForm.kenmerk_douane.trim()) upd.kenmerk_douane = vernietigReviewForm.kenmerk_douane.trim();
    setAfboekingen((prev: any[]) => (prev||[]).map((ab: any) =>
      ab.id === vernietigReviewModal.id ? {...ab, ...upd} : ab
    ));
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Afboeking',
      entiteit_id: vernietigReviewModal.id,
      actie: 'gewijzigd',
      omschrijving: `Vernietiging toegestaan door Douane op ${fmtD(vernietigReviewForm.toestemming_ontvangen_op)}${upd.kenmerk_douane ? ` (kenmerk ${upd.kenmerk_douane})` : ''}`,
    });
    setVernietigReviewModal(null);
  };

  const markVernietigingUitgevoerd = () => {
    if (!vernietigReviewModal) return;
    if (!vernietigReviewForm.uitgevoerd_op) {
      setVernietigReviewError('Uitvoeringsdatum is verplicht.'); return;
    }
    const bewijs = vernietigReviewForm.bewijsBijlagen || [];
    if (bewijs.length === 0) {
      setVernietigReviewError('Upload minstens 1 bewijsstuk (foto/video) van de uitvoering.'); return;
    }
    const upd: any = {
      vernietiging_status: 'uitgevoerd',
      uitgevoerd_op: vernietigReviewForm.uitgevoerd_op,
      bijlagen: [...(vernietigReviewModal.bijlagen||[]), ...bewijs],
    };
    setAfboekingen((prev: any[]) => (prev||[]).map((ab: any) =>
      ab.id === vernietigReviewModal.id ? {...ab, ...upd} : ab
    ));
    logAudit(auditLog, setAuditLog, {
      entiteit: 'Afboeking',
      entiteit_id: vernietigReviewModal.id,
      actie: 'gewijzigd',
      omschrijving: `Vernietiging uitgevoerd op ${fmtD(vernietigReviewForm.uitgevoerd_op)} — ${bewijs.length} bewijsstuk(ken). Potentiële accijnsschuld vervalt voor ${vernietigReviewModal.aantal}× (€ ${Number(vernietigReviewModal.voorcalc_accijns_totaal||0).toFixed(2)}).`,
    });
    setVernietigReviewModal(null);
  };

  // --- WooCommerce push ---
  const addWcLog = (type: string, msg: string, details?: string) => {
    const entry = {id: newId(wcSyncLog||[]), ts: new Date().toISOString(), type, msg, details: details||''};
    setWcSyncLog((prev: any[]) => [entry, ...(prev||[])].slice(0, 100));
  };

  // Voorraad die naar WooCommerce gepusht wordt: fysiek beschikbaar minus
  // zachte reserveringen uit open bestellingen. WooCommerce verlaagt zijn
  // eigen voorraad al zodra een bestelling binnenkomt — zonder deze aftrek
  // zou een push die verlaging weer ongedaan maken (oversell-risico).
  //
  // Matching in drie tiers (zelfde volgorde als getAvailableAfvullingen op de
  // bestellingenpagina): eerst de exacte artikel-SKU op de afvulling, dan het
  // product op de afvulling (wordt bij afvullen gezet, niet op de batch!),
  // pas daarna via de batch. De oude matcher keek alléén naar de batch,
  // waardoor afvullingen met product/SKU maar zonder batch-productkoppeling
  // niet meetelden en er te weinig (of 0) gepusht werd.
  const wcBeschikbaarVoorArt = (art: any) => {
    const artVt = (art.verpakking_type || '').toLowerCase();
    const artNaam = (art.biernaam || '').toLowerCase();
    const vpMatch = (a: any) => {
      const avVt = (a.verpakking_type || '').toLowerCase();
      if (!avVt || !artVt) return false;
      if (avVt === artVt) return true;
      // Afvulling draagt vaak de verpakkingsNAAM ("Vichy 33cL"), het artikel
      // het TYPE ("fles") — map via de verpakkingenlijst, hoofdletterongevoelig.
      return (verpakkingen||[]).some((v: any) =>
        (v.type || '').toLowerCase() === artVt && (v.naam || '').toLowerCase() === avVt);
    };
    const fysiek = (av||[]).filter((a: any) => {
      // Geblokkeerd na een afgekeurde sluitcontrole (CCP 2) mag nooit in de
      // webshop te koop staan.
      if (a.geblokkeerd) return false;
      // Tier 1: afvulling met artikel-SKU matcht uitsluitend op die SKU
      if (a.artikel_sku) return a.artikel_sku === art.artikelnummer;
      // Tier 2: product op de afvulling zelf
      if (art._product_id && a.product_id === art._product_id) return vpMatch(a);
      // Tier 3: via de batch (oude afvullingen zonder product/SKU)
      const b = bat.find((bx: any) => bx.id === a.batch_id);
      if (!b) return false;
      const bierMatch = (art._product_id && b.product_id === art._product_id)
        || (!!artNaam && ((b.naam || '').toLowerCase() === artNaam || (b.biernaam || '').toLowerCase() === artNaam));
      return bierMatch && vpMatch(a);
    }).reduce((s: number, a: any) => s + beschikbaarVoorAfvulling(a), 0);
    return Math.max(0, fysiek - gereserveerdVoorArtikel(openReserveringen, art));
  };

  const wcPushAll = async () => {
    if (!wcCreds?.enabled || !wcCreds?.storeUrl) { setWcSyncMsg(t('error_no_woocommerce')); return; }
    setWcSyncing(true); setWcSyncMsg('');
    try {
      let bijgewerkt = 0;
      // wc_push === false sluit het artikel uit van de push; ontbrekend geldt
      // als ingeschakeld zodat bestaande artikelen hun gedrag behouden.
      const paWithNames = (productArtikelen||[]).filter((a: any) => a.artikelnummer && a.wc_push !== false).map((pa: any) => {
        const prod = (producten||[]).find((p: any) => p.id === pa.product_id);
        return {...pa, biernaam: prod?.naam || '', _product_id: pa.product_id};
      });
      const combis = paWithNames.length > 0 ? paWithNames : (artikelen||[]).filter((a: any) => a.artikelnummer && a.wc_push !== false);
      for (const art of combis) {
        const beschikbaar = wcBeschikbaarVoorArt(art);
        addWcLog('debug', `🔍 ${art.biernaam} ${art.verpakking_type} → ${beschikbaar}×`, '');
        const prods = await wcGet(`products?sku=${encodeURIComponent(art.artikelnummer)}&per_page=1`);
        if (!prods?.length) {
          // Stil overslaan verbergt configuratiefouten — log het zodat de
          // gebruiker in het WC-logboek ziet welke SKU niet gevonden is.
          addWcLog('fout', `⚠ SKU "${art.artikelnummer}" niet gevonden in WooCommerce (${art.biernaam} ${art.verpakking_type})`);
          continue;
        }
        await wcPut(`products/${prods[0].id}`, {stock_quantity: beschikbaar, manage_stock: true});
        bijgewerkt++;
      }
      setWcCreds((prev: any) => ({...prev, lastSync: new Date().toISOString()}));
      const pushMsg = `${bijgewerkt} product${bijgewerkt!==1?'en':''} bijgewerkt`;
      setWcSyncMsg(`✓ ${pushMsg}`);
      addWcLog('push', `↑ Push voorraad — ${pushMsg}`,
        combis.filter((a: any) => a.artikelnummer).map((a: any) => `${a.biernaam} ${a.verpakking_type}: ${wcBeschikbaarVoorArt(a)}×`).join(', '));
    } catch(e: any) {
      setWcSyncMsg(`⚠ Push mislukt: ${e.message}`);
      addWcLog('fout', `↑ Push mislukt — ${e.message}`);
    }
    setWcSyncing(false);
    setTimeout(() => setWcSyncMsg(''), 6000);
  };

  // --- Logboek data ---
  const beerLogEntries = [...(log||[])]
    .filter((l: any) => ['afvullen','uitslaan','afboeking','rebrand'].includes(l.type))
    .sort((a: any, b: any) => (b.datum||'').localeCompare(a.datum||''));

  const LOG_TYPE_STYLES: Record<string, {icon: string, cls: string, label: string}> = {
    afvullen:  {icon:'🍺', cls:'text-green-700 bg-green-50',  label: t('log_type_afvullen')},
    uitslaan:  {icon:'🚛', cls:'text-purple-700 bg-purple-50', label: t('log_type_uitslaan')},
    afboeking: {icon:'🗑️', cls:'text-red-700 bg-red-50',      label: t('log_type_afboeking')},
    rebrand:   {icon:'↪', cls:'text-blue-700 bg-blue-50',     label: t('log_type_rebrand')},
  };

  const WC_TYPE_STYLES: Record<string, {icon: string, cls: string, label: string}> = {
    push:  {icon: '↑', cls: 'text-purple-700 bg-purple-50', label: 'WC Push'},
    pull:  {icon: '↓', cls: 'text-blue-700 bg-blue-50',   label: 'WC Pull'},
    fout:  {icon: '⚠', cls: 'text-red-700 bg-red-50',     label: 'WC Fout'},
    debug: {icon: '·', cls: 'text-gray-500 bg-gray-100',  label: 'WC Debug'},
  };

  const logCombined = useMemo(() => {
    const wcEntries = (wcSyncLog || []).map((l: any) => ({
      _src: 'wc' as const, id: l.id, datum: l.ts ? l.ts.slice(0, 10) : '—',
      sortKey: l.ts || '', type: l.type, msg: l.msg, details: l.details,
    }));
    const voorraadEntries = beerLogEntries.map((l: any) => ({
      _src: 'voorraad' as const, ...l,
      sortKey: (l.datum || '') + (l.id ? String(l.id).padStart(10, '0') : ''),
    }));
    if (logFilter === 'voorraad') return voorraadEntries;
    if (logFilter === 'woocommerce') return wcEntries;
    return [...voorraadEntries, ...wcEntries].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [log, wcSyncLog, logFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">{t('title_producten')}</h2>
        <div className="flex items-center gap-2">
          {wcSyncMsg && <span className={`text-xs font-medium ${wcSyncMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{wcSyncMsg}</span>}
          {wcCreds?.enabled && (
            <button onClick={wcPushAll} disabled={wcSyncing}
              title={t('wc_push_stock_title')}
              className="wc-btn flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
              {wcSyncing ? `⏳ ${t('lbl_bezig')}` : t('btn_wc_push_stock')}
            </button>
          )}
          <Btn onClick={() => startEdit()}>{t('btn_nieuw_product')}</Btn>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-start">
        {/* Productlijst */}
        <div className={`w-full md:w-60 md:flex-shrink-0${(sel || editMode) ? ' hidden md:block' : ''}`}>
          <div className="mb-2">
            <SearchInput value={zoek} onChange={setZoek} placeholder={t('ph_product_zoek')} />
          </div>

          <div className="bg-white rounded-xl shadow-card overflow-x-auto">
            <div className="flex justify-between px-3 py-1.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b">
              <span>{t('lbl_name')}</span><span>{t('lbl_stock')}</span>
            </div>
            {actieveProducten.length === 0 && <div className="p-6 text-center text-gray-400 text-sm">{t('lbl_geen_producten')}</div>}
            {actieveProducten.map((p: any) => {
              const stats = productStats[p.id] || {batches: 0, liter: 0, voorraad: 0};
              return (
                <div key={p.id} onClick={() => { setSel(p.id); setEditMode(false); setArtForm(null); }}
                  className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel === p.id ? 't-sel border-l-2' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{p.naam}</span>
                    <span className={`text-xs font-semibold flex-shrink-0 ${stats.voorraad > 0 ? 'text-green-600' : 'text-gray-400'}`}>{stats.voorraad}×</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {p.stijl || ''}
                    {p.abv ? `${p.stijl ? ' · ' : ''}${Number(p.abv).toFixed(1)}%` : ''}
                    {stats.batches ? ` · ${stats.batches} ${t('lbl_product_batches').toLowerCase()}` : ''}
                  </div>
                </div>
              );
            })}
            {gearchiveerdeProducten.length > 0 && (
              <div>
                <SectionHeader
                  solid
                  rounded="full"
                  open={toonGearchiveerd}
                  onToggle={() => setToonGearchiveerd(!toonGearchiveerd)}
                  title={<span className="text-xs font-medium uppercase tracking-wide">{t('lbl_product_toon_gearchiveerd')}</span>}
                  info={gearchiveerdeProducten.length}
                />
                {toonGearchiveerd && gearchiveerdeProducten.map((p: any) => {
                  const stats = productStats[p.id] || {batches: 0, liter: 0, voorraad: 0};
                  return (
                    <div key={p.id} onClick={() => { setSel(p.id); setEditMode(false); setArtForm(null); }}
                      className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${sel === p.id ? 't-sel border-l-2' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-gray-500 truncate">{p.naam}</span>
                        <span className="text-xs font-semibold flex-shrink-0 text-gray-400">{stats.voorraad}×</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        {p.stijl || ''}
                        {p.abv ? `${p.stijl ? ' · ' : ''}${Number(p.abv).toFixed(1)}%` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      {/* Rechter kolom: product detail */}
      <div className={`flex-1 min-w-0${(sel || editMode) ? '' : ' hidden md:block'}`}>
        {(sel || editMode) && (
          <button onClick={() => { setSel(null); setEditMode(false); }}
            className="md:hidden mb-2 flex items-center gap-1 text-sm font-semibold t-back border rounded-xl px-3 py-2 w-full transition-colors">
            {t('btn_back')}
          </button>
        )}
        {!sel && !editMode && (
          <div className="text-center text-gray-400 text-sm py-16">{t('lbl_geen_producten')}</div>
        )}

        {/* Edit/nieuw formulier */}
        {editMode && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <SectionHeader solid title={form.id && (producten||[]).find((p: any) => p.id === form.id) ? form.naam || t('lbl_product_naam') : t('btn_nieuw_product')} />
            <div className="p-4 space-y-4">
              {msg && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{msg}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_naam')}</label>
                  <input type="text" value={form.naam||''} onChange={e => setForm((f: any) => ({...f, naam: e.target.value}))} placeholder={t('ph_product_naam')} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_stijl')}</label>
                  <input type="text" value={form.stijl||''} onChange={e => setForm((f: any) => ({...f, stijl: e.target.value}))} placeholder={t('ph_product_stijl')} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_categorie')}</label>
                  <input type="text" value={form.categorie||''} onChange={e => setForm((f: any) => ({...f, categorie: e.target.value}))} placeholder={t('ph_product_categorie')} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_abv')}</label>
                    <input type="number" step="0.1" value={form.abv||''} onChange={e => setForm((f: any) => ({...f, abv: e.target.value}))} placeholder="5.5" className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_ebc')}</label>
                    <input type="number" step="1" value={form.ebc||''} onChange={e => setForm((f: any) => ({...f, ebc: e.target.value}))} placeholder="12" className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_ibu')}</label>
                    <input type="number" step="1" value={form.ibu||''} onChange={e => setForm((f: any) => ({...f, ibu: e.target.value}))} placeholder="35" className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_omschrijving')}</label>
                <textarea value={form.omschrijving||''} onChange={e => setForm((f: any) => ({...f, omschrijving: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_notities')}</label>
                <textarea value={form.notities||''} onChange={e => setForm((f: any) => ({...f, notities: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm t-input mt-1" />
              </div>

              {/* Foto's */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_afbeeldingen')}</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(form.afbeeldingen||[]).map((img: string, idx: number) => (
                    <div key={idx} className="relative group">
                      <img src={img} alt="" className={`w-20 h-20 rounded-lg object-cover border-2 cursor-pointer ${fotoTab === idx ? '' : 'border-transparent'}`} style={fotoTab === idx ? {borderColor: 'var(--t-accent)'} : undefined} onClick={() => setFotoTab(idx)} />
                      <button onClick={() => removeFoto(idx)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                    </div>
                  ))}
                  {(form.afbeeldingen||[]).length < 5 && (
                    <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-gray-400 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <input type="file" accept="image/*" className="hidden" onChange={handleFotoUpload} />
                    </label>
                  )}
                </div>
              </div>

              {/* Recepten koppelen */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('lbl_product_recepten')}</label>
                  <Btn onClick={() => setReceptSelectOpen(!receptSelectOpen)} s="sm" v="ghost">{t('btn_koppel_recept')}</Btn>
                </div>
                {receptSelectOpen && beschikbareRecepten.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm">
                    {beschikbareRecepten.map((r: any) => (
                      <button key={r.id} onClick={() => koppelRecept(r.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                        <span className="font-medium">{r.naam}</span>
                        {r.stijl && <span className="text-gray-400 ml-2 text-xs">{r.stijl}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {(form.recept_ids||[]).map((rid: string) => {
                    const r = (recepten||[]).find((rec: any) => rec.id === rid);
                    return r ? (
                      <div key={rid} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5 text-sm">
                        <span>{r.naam} {r.stijl && <span className="text-gray-400 text-xs ml-1">{r.stijl}</span>}</span>
                        <button onClick={() => ontkoppelRecept(rid)} className="text-xs text-red-500 hover:text-red-700">{t('btn_ontkoppel_recept')}</button>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <Btn onClick={saveProduct}>{t('btn_product_opslaan')}</Btn>
                <Btn onClick={() => { setEditMode(false); setMsg(''); }} v="secondary">{t('btn_product_annuleren')}</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Product detail (view mode) */}
        {sel && selProduct && !editMode && (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <SectionHeader
                solid
                title={<span className="flex items-center gap-2">
                  <span>{selProduct.naam}</span>
                  {selProduct.status === 'gearchiveerd' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20">{t('lbl_product_gearchiveerd')}</span>}
                </span>}
                info={<>
                  <Btn onClick={() => startEdit(selProduct)} s="sm" v="header">{t('btn_bewerken')}</Btn>
                  <Btn onClick={toggleArchiveer} s="sm" v="header">{selProduct.status === 'gearchiveerd' ? t('btn_product_activeren') : t('btn_product_archiveren')}</Btn>
                  <Btn onClick={deleteProduct} s="sm" v="header-danger">{t('btn_product_verwijderen')}</Btn>
                </>}
              />

              <div className="p-4">
                <div className="flex gap-4">
                  {selProduct.afbeeldingen?.length > 0 && (
                    <div className="flex-shrink-0">
                      <img src={selProduct.afbeeldingen[fotoTab] || selProduct.afbeeldingen[0]} alt="" className="w-40 h-40 rounded-xl object-cover" />
                      {selProduct.afbeeldingen.length > 1 && (
                        <div className="flex gap-1 mt-2 justify-center">
                          {selProduct.afbeeldingen.map((_: any, i: number) => (
                            <button key={i} onClick={() => setFotoTab(i)} className={`w-2.5 h-2.5 rounded-full transition-colors ${fotoTab === i ? '' : 'bg-gray-300'}`} style={fotoTab === i ? {backgroundColor: 'var(--t-accent)'} : undefined} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {selProduct.stijl && <div className="text-sm text-gray-500 mb-1">{selProduct.stijl}</div>}
                    {selProduct.categorie && <div className="text-xs text-gray-400 mb-2">{selProduct.categorie}</div>}
                    {/* ABV / EBC / IBU badges */}
                    {(selProduct.abv || selProduct.ebc || selProduct.ibu) && (
                      <div className="flex gap-2 mb-3">
                        {selProduct.abv && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{Number(selProduct.abv).toFixed(1)}% ABV</span>}
                        {selProduct.ebc && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{selProduct.ebc} EBC</span>}
                        {selProduct.ibu && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">{selProduct.ibu} IBU</span>}
                      </div>
                    )}
                    {selProduct.omschrijving && <div className="text-sm text-gray-600 mb-3">{selProduct.omschrijving}</div>}
                    {selProduct.notities && <div className="text-xs text-gray-400 italic">{selProduct.notities}</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Statistieken */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                {label: t('lbl_product_batches'), value: productStats[sel]?.batches || 0},
                {label: t('lbl_product_totaal_liter'), value: `${(productStats[sel]?.liter || 0).toFixed(0)} L`},
                {label: t('lbl_product_voorraad'), value: productStats[sel]?.voorraad || 0},
                {label: t('lbl_product_uitgeleverd'), value: productStats[sel]?.uitgeleverd || 0},
                {label: t('lbl_product_kostprijs_liter'), value: productStats[sel]?.kostprijs > 0 ? fmt(productStats[sel].kostprijs) : '-'},
              ].map((s, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</div>
                  <div className="text-lg font-bold mt-1" style={{color: 'var(--t-accent)'}}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Voorraad overzicht */}
            {selVoorraad.length > 0 && (
              <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${voorraadOpen?'':'overflow-hidden'}`}>
                <SectionHeader
                  open={voorraadOpen}
                  onToggle={() => setVoorraadOpen(!voorraadOpen)}
                  rounded={voorraadOpen ? 'top' : 'full'}
                  title={t('lbl_product_voorraad')}
                />
                {voorraadOpen && selVoorraad.map(({vt, rows, totAfgevuld, totGepickt, totUitgeleverd, totAfgeboekt, totInBestelling, totBeschikbaar}) => (
                  <div key={vt}>
                    <div className="px-4 py-2 bg-gray-50 border-b border-t flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{vt}</span>
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span className="text-gray-400">{t('voorraad_afgevuld')}: <strong>{totAfgevuld}×</strong></span>
                        {totGepickt > 0 && <span className="text-orange-500">{t('voorraad_gepickt')}: <strong>{totGepickt}×</strong></span>}
                        {totInBestelling > 0 && <span className="text-orange-500">{t('voorraad_in_bestelling')}: <strong>{totInBestelling}×</strong></span>}
                        {totUitgeleverd > 0 && <span className="text-blue-500">{t('voorraad_uitgeleverd')}: <strong>{totUitgeleverd}×</strong></span>}
                        {totAfgeboekt > 0 && <span className="text-red-400">{t('voorraad_afgeboekt')}: <strong>{totAfgeboekt}×</strong></span>}
                        <span className={`font-bold ${totBeschikbaar > 0 ? 'text-green-600' : 'text-gray-400'}`}>{t('voorraad_beschikbaar')}: {totBeschikbaar}×</span>
                      </div>
                    </div>
                    {rows.map((a: any) => {
                      const beschikbaar = beschikbaarVoorAfvulling(a);
                      const perLoc = beschikbaarPerLocatie(a);
                      const perLocEntries = Object.entries(perLoc)
                        .map(([k, n]) => ({locId: Number(k), n: Number(n)}))
                        .filter(e => e.n > 0)
                        .sort((x, y) => {
                          const lx = (locaties||[]).find((l: any) => l.id === x.locId);
                          const ly = (locaties||[]).find((l: any) => l.id === y.locId);
                          // Niet-AGP eerst, dan AGP
                          if (!!lx?.is_agp !== !!ly?.is_agp) return lx?.is_agp ? 1 : -1;
                          return (lx?.naam || '').localeCompare(ly?.naam || '');
                        });
                      const batch = (bat||[]).find((b: any) => b.id === a.batch_id);
                      const thtDays = a.tht ? Math.ceil((new Date(a.tht).getTime() - new Date().getTime()) / 86400000) : null;
                      const thtExp = thtDays !== null && thtDays < 0;
                      const thtSoon = thtDays !== null && thtDays >= 0 && thtDays <= 60;
                      const afboekLogs = ((afboekingen||[]) as any[]).filter((ab: any) => ab.afvulling_id === a.id);
                      return (
                        <div key={a.id} className="px-4 py-3 border-b last:border-b-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-500">
                                {batch && <span className="font-medium text-gray-700">{batch.batch_nummer ? `#${batch.batch_nummer}` : batch.naam}</span>}
                                {a.tht
                                  ? <span className={thtExp ? 'text-red-600 font-semibold' : thtSoon ? 'text-yellow-600 font-medium' : ''}>
                                      {t('lbl_tht')}: <strong>{fmtD(a.tht)}</strong>
                                      {thtExp ? ` ${t('msg_tht_verlopen')}` : thtSoon ? ` (${thtDays}d)` : ''}
                                    </span>
                                  : <span className="text-gray-400">{t('lbl_tht')}: —</span>
                                }
                                <span className="text-gray-400">{Number(a.inhoud_per_eenheid||0).toFixed(1)} {t('lbl_liter_per_stuk')}</span>
                                {a.rebrand_van_product_id && a.rebrand_van_product_id !== a.product_id && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 font-medium" title={a.rebrand_opmerking || ''}>
                                    ↪ {t('lbl_rebrand_van').replace('{product}', (producten||[]).find((p: any) => p.id === a.rebrand_van_product_id)?.naam || t('lbl_onbekend'))}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                                <span className="text-gray-600">{t('voorraad_afgevuld')}: <strong className="font-semibold text-gray-800">{a.hoeveelheid}×</strong></span>
                                <span className={`font-bold ${beschikbaar > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                  {t('msg_n_beschikbaar').replace('{n}', String(beschikbaar))}
                                </span>
                              </div>
                              {perLocEntries.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 text-xs pt-0.5">
                                  {perLocEntries.map(e => {
                                    const loc = (locaties||[]).find((l: any) => l.id === e.locId);
                                    const isAgp = !!loc?.is_agp;
                                    return (
                                      <span
                                        key={e.locId}
                                        className={`px-1.5 py-0.5 rounded font-medium ${isAgp ? 'bg-purple-50 text-purple-700 border border-purple-100' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}
                                        title={isAgp ? t('lbl_agp_voorraad') : t('lbl_niet_agp_voorraad')}
                                      >
                                        {loc?.naam || t('lbl_onbekend')}: <strong>{e.n}×</strong>
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {beschikbaar > 0 && (
                              <div className="flex-shrink-0 flex gap-1.5 mt-0.5">
                                {setAv && (
                                  <button onClick={e => openRebrandModal(a, e)}
                                    className="text-xs px-2.5 py-1 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 hover:border-blue-400 transition-colors whitespace-nowrap">
                                    ↪ {t('btn_rebrand')}
                                  </button>
                                )}
                                <button onClick={e => openAfboekModal(a, e)}
                                  className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors whitespace-nowrap">
                                  − {t('btn_afboeken')}
                                </button>
                              </div>
                            )}
                          </div>
                          {afboekLogs.length > 0 && (
                            <div className="mt-2 pl-3 border-l-2 border-red-100 space-y-1">
                              {afboekLogs.map((ab: any) => {
                                const isVern = ab.reden === 'vernietiging';
                                const status: VernietigingStatus | undefined = isVern ? (ab.vernietiging_status || 'aangevraagd') : undefined;
                                const kanVoort = isVern && status && status !== 'uitgevoerd';
                                return (
                                  <div key={ab.id} className="flex items-center gap-2 text-xs">
                                    <span className={`px-1.5 py-0.5 rounded font-medium ${REDEN_COLORS[ab.reden as AfboekingReden] || 'text-gray-500 bg-gray-100'}`}>
                                      {t(AFBOEKING_REDENEN.find(r => r.v === ab.reden)?.lKey || ab.reden)}
                                    </span>
                                    {status && (
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${VERNIETIGING_STATUS_COLOR[status]}`} title={t('tooltip_status_per_douane')}>
                                        {VERNIETIGING_STATUS_LABEL[status]}
                                      </span>
                                    )}
                                    <span className="text-red-500 font-semibold">−{ab.aantal}×</span>
                                    <span className="text-gray-400">{ab.datum}</span>
                                    {kanVoort && (
                                      <button
                                        onClick={() => openVernietigReview(ab)}
                                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-50">
                                        {status === 'aangevraagd' ? '→ Toestemming verwerken' : '→ Uitvoeren registreren'}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Recepten */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <SectionHeader title={t('lbl_product_recepten')} />
              <div className="p-3">
                {selRecepten.length === 0 && <div className="text-xs text-gray-400 py-2">{t('lbl_geen_recepten_gekoppeld')}</div>}
                {selRecepten.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                    <div>
                      <span className="text-sm font-medium">{r.naam}</span>
                      {r.stijl && <span className="text-xs text-gray-400 ml-2">{r.stijl}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Artikelen / SKU's */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <SectionHeader
                title={t('lbl_product_artikelen')}
                info={<Btn onClick={() => startArtEdit()} s="sm" v="header">{t('btn_artikel_toevoegen')}</Btn>}
              />

              {artForm && (
                <div className="p-3 bg-gray-50 border-b border-gray-200">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_product_verpakking')}</label>
                      <select value={artForm.verpakking_id||''} onChange={e => setArtForm((f: any) => ({...f, verpakking_id: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input bg-white">
                        <option value="">-</option>
                        {(verpakkingen||[]).map((v: any) => <option key={v.id} value={v.id}>{v.naam} ({v.inhoud_liter}L)</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_product_sku')}</label>
                      <input type="text" value={artForm.artikelnummer||''} onChange={e => setArtForm((f: any) => ({...f, artikelnummer: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_product_ean')}</label>
                      <input type="text" value={artForm.ean||''} onChange={e => setArtForm((f: any) => ({...f, ean: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-gray-500">{t('lbl_product_prijs')}</label>
                        <button type="button" onClick={() => {
                          const btw = Number(artForm.btw_pct || 0);
                          const prijs = Number(artForm.verkoopprijs || 0);
                          if (prijsInclBtw && prijs > 0) {
                            setArtForm((f: any) => ({...f, verkoopprijs: (prijs / (1 + btw / 100)).toFixed(2)}));
                          } else if (!prijsInclBtw && prijs > 0) {
                            setArtForm((f: any) => ({...f, verkoopprijs: (prijs * (1 + btw / 100)).toFixed(2)}));
                          }
                          setPrijsInclBtw(!prijsInclBtw);
                        }} className="text-[10px] font-medium px-1 rounded" style={{color: 'var(--t-accent)'}}>
                          {prijsInclBtw ? t('lbl_incl_btw') : t('lbl_excl_btw_toggle')}
                        </button>
                      </div>
                      <input type="number" step="0.01" value={artForm.verkoopprijs||''} onChange={e => setArtForm((f: any) => ({...f, verkoopprijs: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-gray-500">{t('lbl_product_b2b_prijs')}</label>
                        <button type="button" onClick={() => {
                          const btw = Number(artForm.btw_pct || 0);
                          const prijs = Number(artForm.b2b_prijs || 0);
                          if (b2bPrijsInclBtw && prijs > 0) {
                            setArtForm((f: any) => ({...f, b2b_prijs: (prijs / (1 + btw / 100)).toFixed(2)}));
                          } else if (!b2bPrijsInclBtw && prijs > 0) {
                            setArtForm((f: any) => ({...f, b2b_prijs: (prijs * (1 + btw / 100)).toFixed(2)}));
                          }
                          setB2bPrijsInclBtw(!b2bPrijsInclBtw);
                        }} className="text-[10px] font-medium px-1 rounded" style={{color: 'var(--t-accent)'}}>
                          {b2bPrijsInclBtw ? t('lbl_incl_btw') : t('lbl_excl_btw_toggle')}
                        </button>
                      </div>
                      <input type="number" step="0.01" value={artForm.b2b_prijs||''} onChange={e => setArtForm((f: any) => ({...f, b2b_prijs: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_product_btw')}</label>
                      <input type="number" value={artForm.btw_pct||''} onChange={e => setArtForm((f: any) => ({...f, btw_pct: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_gn_code')}</label>
                      <select value={artForm.gn_code||''} onChange={e => setArtForm((f: any) => ({...f, gn_code: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input bg-white">
                        <option value="">-</option>
                        {(gnCodes||[]).map((gc: any) => <option key={gc.code} value={gc.code}>{gc.code} — {gc.naam}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500">{t('lbl_product_omschrijving')}</label>
                      <input type="text" value={artForm.omschrijving||''} onChange={e => setArtForm((f: any) => ({...f, omschrijving: e.target.value}))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs t-input" />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none" title={t('tip_artikel_wc_push')}>
                        <input
                          type="checkbox"
                          className="t-checkbox"
                          checked={artForm.wc_push !== false}
                          onChange={e => setArtForm((f: any) => ({...f, wc_push: e.target.checked}))}
                        />
                        <span>{t('lbl_artikel_wc_push')}</span>
                      </label>
                    </div>
                  </div>
                  {/* Live kostprijs/marge-inschatting tijdens het invullen — de
                      prijsvelden respecteren de incl/excl-BTW-toggles. */}
                  {(() => {
                    const stats = productStats[sel!];
                    const vp = (verpakkingen||[]).find((v: any) => v.id === Number(artForm.verpakking_id));
                    const inhoud = Number(vp?.inhoud_liter ?? artForm.inhoud_liter ?? 0);
                    if (!stats || stats.kostprijs <= 0) {
                      return <p className="mt-2 text-[11px] text-gray-400 italic">{t('msg_geen_kostprijs_bekend')}</p>;
                    }
                    if (!inhoud) return null;
                    const kost = stats.kostprijs * inhoud;
                    const btw = Number(artForm.btw_pct || 0);
                    const naarExcl = (val: any, incl: boolean) => {
                      const n = Number(val || 0);
                      return incl && n > 0 ? n / (1 + btw / 100) : n;
                    };
                    const cons = margeVoorPrijs(kost, naarExcl(artForm.verkoopprijs, prijsInclBtw));
                    const b2b = margeVoorPrijs(kost, naarExcl(artForm.b2b_prijs, b2bPrijsInclBtw));
                    const chip = (label: string, m: {eur: number, pct: number} | null) => m && (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${m.eur >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {label}: {m.pct.toFixed(0)}% ({fmt(m.eur)})
                      </span>
                    );
                    return (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                          {t('lbl_kostprijs_stuk')}: {fmt(kost)} ({inhoud.toFixed(2)}L × {fmt(stats.kostprijs)}/L)
                        </span>
                        {chip(t('lbl_product_marge'), cons)}
                        {chip(`${t('lbl_product_marge')} ${t('lbl_b2b')}`, b2b)}
                      </div>
                    );
                  })()}
                  <div className="flex gap-2 mt-2">
                    <Btn onClick={saveArtikel} s="sm">{t('btn_product_opslaan')}</Btn>
                    <Btn onClick={() => setArtForm(null)} s="sm" v="secondary">{t('btn_product_annuleren')}</Btn>
                  </div>
                </div>
              )}

              <div className="p-3">
                {selArtikelen.length === 0 && !artForm && <div className="text-xs text-gray-400 py-2">{t('lbl_geen_product_artikelen')}</div>}
                {selArtikelen.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-100">
                        <th className="text-left py-1 font-medium">{t('lbl_product_verpakking')}</th>
                        <th className="text-left py-1 font-medium">{t('lbl_product_sku')}</th>
                        <th className="text-left py-1 font-medium">{t('lbl_gn_code')}</th>
                        <th className="text-right py-1 font-medium">{t('lbl_product_prijs')}</th>
                        <th className="text-right py-1 font-medium">{t('lbl_product_b2b_prijs')}</th>
                        <th className="text-right py-1 font-medium">{t('lbl_product_btw')}</th>
                        <th className="text-right py-1 font-medium">{t('lbl_kostprijs_stuk')}</th>
                        <th className="text-right py-1 font-medium">{t('lbl_product_marge')}</th>
                        <th className="w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selArtikelen.map((a: any) => {
                        const margeInfo = berekenMarge(a);
                        const wcPushAan = a.wc_push !== false;
                        return (
                          <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5">
                              <span className="inline-flex items-center gap-1.5">
                                <span>{a.verpakking_naam || '-'}</span>
                                {a.artikelnummer && (
                                  <span
                                    title={wcPushAan ? t('tip_artikel_wc_push_aan') : t('tip_artikel_wc_push_uit')}
                                    className={`inline-block w-1.5 h-1.5 rounded-full ${wcPushAan ? '' : 'opacity-30'}`}
                                    style={{backgroundColor: wcPushAan ? '#7f54b3' : '#9ca3af'}}
                                  />
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 font-mono">{a.artikelnummer || '-'}</td>
                            <td className="py-1.5 text-gray-500">{a.gn_code || '-'}</td>
                            <td className="py-1.5 text-right">{a.verkoopprijs ? fmt(a.verkoopprijs) : '-'}</td>
                            <td className="py-1.5 text-right">{a.b2b_prijs ? fmt(a.b2b_prijs) : '-'}</td>
                            <td className="py-1.5 text-right">{a.btw_pct != null ? `${a.btw_pct}%` : '-'}</td>
                            <td className="py-1.5 text-right text-gray-600">{margeInfo ? fmt(margeInfo.kostprijsPerEenheid) : '-'}</td>
                            <td className="py-1.5 text-right">
                              {margeInfo?.consument ? (
                                <span className={`font-medium ${margeInfo.consument.eur >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                  {margeInfo.consument.pct.toFixed(0)}% ({fmt(margeInfo.consument.eur)})
                                </span>
                              ) : '-'}
                              {margeInfo?.b2b && (
                                <div className={`text-[10px] ${margeInfo.b2b.eur >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {t('lbl_b2b')}: {margeInfo.b2b.pct.toFixed(0)}% ({fmt(margeInfo.b2b.eur)})
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 text-right">
                              <button onClick={() => startArtEdit(a)} className="text-gray-400 hover:text-gray-600 mr-1">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 inline">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                </svg>
                              </button>
                              <button onClick={() => deleteArtikel(a.id)} className="text-red-400 hover:text-red-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5 inline">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Batches */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <SectionHeader
                onToggle={() => setPage && setPage('batches')}
                title={t('lbl_product_batches')}
                info={selBatches.length}
              />
              <div className="p-3">
                {selBatches.length === 0 && <div className="text-xs text-gray-400 py-2">{t('lbl_geen_batches_gekoppeld')}</div>}
                {selBatches.slice(0, 10).map((b: any) => {
                  const direct = batchHoortBijProduct(b, sel);
                  return (
                    <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                      <div>
                        <span className="text-sm font-medium">{b.naam}</span>
                        {b.batch_nummer && <span className="text-xs text-gray-400 ml-2">#{b.batch_nummer}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {b.ABV && <span className="text-xs text-gray-500">{Number(b.ABV).toFixed(1)}%</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${b.status === 'Afgevuld' || b.status === 'Verpakt' || b.status === 'Gesloten' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{b.status}</span>
                        {direct && setBat && (
                          <button type="button" onClick={() => ontkoppelBatch(b.id)}
                            title={t('btn_ontkoppel_batch')}
                            className="text-xs text-gray-400 hover:text-red-600 px-1 leading-none">✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {selBatches.length > 10 && <div className="text-xs text-gray-400 text-center py-1">+{selBatches.length - 10}</div>}

                {/* Batch koppelen */}
                {setBat && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <Btn onClick={() => setBatchSelectOpen(!batchSelectOpen)} s="sm" v="ghost">{t('btn_koppel_batch')}</Btn>
                    {batchSelectOpen && (beschikbareBatches.length > 0 ? (
                      <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm">
                        {beschikbareBatches.map((b: any) => (
                          <button key={b.id} onClick={() => koppelBatch(b.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                            <span className="font-medium">{b.naam}</span>
                            {b.batch_nummer && <span className="text-gray-400 ml-2 text-xs">#{b.batch_nummer}</span>}
                            {b.datum && <span className="text-gray-400 ml-2 text-xs">{fmtD(b.datum)}</span>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-gray-400 py-1">{t('lbl_geen_batches_beschikbaar')}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Logboek */}
      <div className={`mt-4 bg-white rounded-xl border border-gray-200 shadow-sm ${logboekOpen?'':'overflow-hidden'}`}>
        <SectionHeader
          open={logboekOpen}
          onToggle={() => setLogboekOpen(!logboekOpen)}
          rounded={logboekOpen ? 'top' : 'full'}
          title={t('tab_logboek')}
          info={beerLogEntries.length > 0 ? beerLogEntries.length : null}
        />
        {logboekOpen && (
          <div>
            <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-1">
              {(['alle', 'voorraad', ...(wcCreds?.enabled ? ['woocommerce'] : [])] as const).map(f => (
                <button key={f} onClick={() => setLogFilter(f as any)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${logFilter === f ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                  {f === 'alle' ? t('orders_filter_alle') : f === 'voorraad' ? t('log_filter_voorraad').replace('{n}', String(beerLogEntries.length)) : t('log_filter_woocommerce').replace('{n}', String((wcSyncLog||[]).length))}
                </button>
              ))}
            </div>
            {logCombined.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">{t('log_no_mutations')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_date')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_type')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('lbl_description')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('lbl_quantity')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logCombined.slice(0, 50).map((l: any) => {
                    if (l._src === 'wc') {
                      const ws = WC_TYPE_STYLES[l.type] || WC_TYPE_STYLES.debug;
                      return (
                        <tr key={`wc-${l.id}`} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{l.datum}</td>
                          <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${ws.cls}`}>{ws.icon} {ws.label}</span></td>
                          <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px]">
                            <div className="truncate">{l.msg}</div>
                            {l.details && <div className="text-gray-400 truncate" title={l.details}>{l.details}</div>}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-400">—</td>
                        </tr>
                      );
                    }
                    const ts = LOG_TYPE_STYLES[l.type] || {icon: '•', cls: 'text-gray-600 bg-gray-100', label: l.type};
                    const qty = l.hoeveelheid != null
                      ? `${l.type === 'afboeking' ? '−' : '+'}${fmtQty(Math.abs(Number(l.hoeveelheid)))} ${l.eenheid || t('unit_stuks')}`
                      : '—';
                    return (
                      <tr key={`v-${l.id}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{l.datum || '—'}</td>
                        <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${ts.cls}`}>{ts.icon} {ts.label}</span></td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px]">
                          <div className="font-medium text-gray-700 truncate">{l.batch_naam || '—'}{l.verpakking_type ? ` · ${l.verpakking_type}` : ''}</div>
                          {(l.omschrijving || l.referentie) && <div className="text-gray-400 truncate" title={l.omschrijving || l.referentie}>{l.omschrijving || l.referentie}</div>}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${l.type === 'afboeking' ? 'text-red-600' : l.type === 'uitslaan' ? 'text-purple-600' : 'text-green-600'}`}>{qty}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Afboeken modal — M-1 Bijzondere mutaties */}
      {afboekModal && (() => {
        const perEenheid = Number(afboekModal.voorcalc_accijns_per_eenheid) > 0
          ? Number(afboekModal.voorcalc_accijns_per_eenheid)
          : berekenVoorcalcVoorAfvulling(
              { inhoud_per_eenheid: Number(afboekModal.inhoud_per_eenheid||0), hoeveelheid: 1, aantal: 1 },
              (bat||[]).find((b: any) => b.id === afboekModal.batch_id),
              accijnsInst
            ).perEenheid;
        return (
        <Modal title={t('title_bijzondere_mutatie_modal').replace('{verpakking}', afboekModal.verpakking_naam || afboekModal.verpakking_type || '')} onClose={() => setAfboekModal(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-600 flex gap-4 flex-wrap">
              <span>{t('voorraad_beschikbaar')}: <strong className="text-green-600">{beschikbaarVoorAfvulling(afboekModal)}×</strong></span>
              {afboekModal.tht && <span>{t('lbl_tht')}: <strong>{fmtD(afboekModal.tht)}</strong></span>}
              {perEenheid > 0 && (
                <span>{t('voorcalc_label')}: <strong className="text-amber-700">€ {perEenheid.toFixed(4)}</strong> {t('voorcalc_per_eenheid_unit')}</span>
              )}
            </div>

            {/* Tabs per type mutatie */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-lg">
              {AFBOEKING_REDENEN.map(r => (
                <button key={r.v} onClick={() => { setAfboekForm(f => ({...f, reden: r.v})); setAfboekError(''); }}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${afboekForm.reden === r.v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
                  {t(r.lKey)}
                </button>
              ))}
            </div>

            <div className={`rounded-lg p-3 text-xs ${afboekForm.reden === 'vernietiging' ? 'bg-orange-50 border border-orange-200 text-orange-800' : afboekForm.reden === 'vermis' ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-gray-50 border border-gray-200 text-gray-700'}`}>
              {afboekForm.reden === 'vermis' && t('info_mutatie_vermis')}
              {afboekForm.reden === 'vernietiging' && t('info_mutatie_vernietiging')}
              {afboekForm.reden === 'overig' && t('info_mutatie_overig')}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_quantity')} <span className="text-red-400">*</span></label>
                <input type="number" value={afboekForm.aantal} onChange={e => { setAfboekForm(f => ({...f, aantal: e.target.value})); setAfboekError(''); }} placeholder="1"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_datum')}</label>
                <input type="date" value={tod()} readOnly
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_opmerking_required')} <span className="text-red-400">*</span></label>
              <textarea value={afboekForm.opmerking} onChange={e => { setAfboekForm(f => ({...f, opmerking: e.target.value})); setAfboekError(''); }} rows={3}
                placeholder={afboekForm.reden === 'vernietiging' ? t('ph_opmerking_vernietiging') : afboekForm.reden === 'vermis' ? t('ph_opmerking_vermis') : t('ph_opmerking_overig')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm t-input resize-none" />
            </div>

            {/* Vernietiging — Douane v2.4 §7.2.3:
                Stap 1 (Aangevraagd): verklaring vernietiging indienen + bijlage uploaden.
                Stap 2 en 3 (Toegestaan / Uitgevoerd) gebeuren via de vervolgmodal. */}
            {afboekForm.reden === 'vernietiging' && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Verklaring vernietiging — stap 1: Aangevraagd</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${VERNIETIGING_STATUS_COLOR.aangevraagd}`}>Aangevraagd</span>
                </div>
                <p className="text-xs text-orange-700">
                  Voor vernietiging van onveraccijnsde goederen binnen de AGP moet vooraf de
                  <em> "Verklaring vernietiging accijns- of verbruiksbelastinggoederen vanuit een
                  schorsingsregeling/vrijstelling"</em> bij de Douane worden ingediend (download op
                  <a href="https://www.douane.nl" target="_blank" rel="noopener noreferrer" className="underline ml-1">www.douane.nl</a>).
                  Upload de ingediende PDF hieronder. De voorraad wordt gereserveerd; de definitieve
                  afboeking en het vervallen van de potentiële accijnsschuld vinden plaats bij status <strong>Uitgevoerd</strong>.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Datum indiening verklaring <span className="text-red-400">*</span></label>
                  <input type="date" value={afboekForm.verklaring_ingediend_op}
                    onChange={e => { setAfboekForm(f => ({...f, verklaring_ingediend_op: e.target.value})); setAfboekError(''); }}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Verklaring vernietiging (PDF) <span className="text-red-400">*</span></label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer bg-white">
                      <span>📎</span>
                      <span>{afboekUploading ? t('lbl_uploading') : 'Verklaring uploaden (rol: douane_verklaring)'}</span>
                      <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff,.bmp,.heic,.heif"
                        className="hidden" disabled={afboekUploading}
                        onChange={e => { doAfboekUpload(e.target.files, 'douane_verklaring'); e.target.value = ''; }} />
                    </label>
                    <span className="text-xs text-gray-500">{t('lbl_allowed_formats_photo')}</span>
                  </div>
                  {afboekForm.bijlagen.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {afboekForm.bijlagen.map((b, i) => (
                        <li key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1 text-xs">
                          <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 truncate">
                            📎 <span className="truncate">{b.naam}</span>
                            {b.rol && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] uppercase tracking-wide">{b.rol === 'douane_verklaring' ? 'verklaring' : 'bewijs'}</span>}
                          </a>
                          <button onClick={() => doAfboekRemoveBijlage(i)} className="text-gray-400 hover:text-red-500 ml-2" title={t('btn_remove_bijlage')}>✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {afboekError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">{afboekError}</div>}
            <div className="flex justify-end gap-2 pt-1 border-t">
              <Btn v="secondary" onClick={() => setAfboekModal(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={doAfboeken} v="danger" disabled={afboekUploading}>{t('btn_mutatie_bevestigen')}</Btn>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Rebrand-modal — (deel van) afvulling naar een ander product */}
      {rebrandModal && (() => {
        const a = rebrandModal;
        const beschikbaar = beschikbaarVoorAfvulling(a);
        const totaal = Number(a.hoeveelheid||0);
        const huidigId = productVanAfvulling(a);
        const huidigProduct = (producten||[]).find((p: any) => p.id === huidigId);
        const aantalNum = Number(rebrandForm.aantal);
        const wordtSplitsing = !(aantalNum === totaal && beschikbaar === totaal);
        const doelKandidaten = (producten||[])
          .filter((p: any) => p.status !== 'gearchiveerd' && p.id !== huidigId)
          .sort((x: any, y: any) => (x.naam||'').localeCompare(y.naam||''));
        return (
        <Modal title={t('title_rebrand_modal').replace('{verpakking}', a.verpakking_naam || a.verpakking_type || '')} onClose={() => setRebrandModal(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-600 flex gap-4 flex-wrap">
              <span>{t('lbl_rebrand_huidig_product')}: <strong className="text-gray-800">{huidigProduct?.naam || t('lbl_onbekend')}</strong></span>
              <span>{t('voorraad_beschikbaar')}: <strong className="text-green-600">{beschikbaar}×</strong></span>
              {a.tht && <span>{t('lbl_tht')}: <strong>{fmtD(a.tht)}</strong></span>}
            </div>

            <div className="rounded-lg p-3 text-xs bg-blue-50 border border-blue-200 text-blue-800">
              {t('info_rebrand')}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_rebrand_doelproduct')} <span className="text-red-400">*</span></label>
              {!rebrandForm.toonNieuwProduct ? (
                <div className="flex gap-1">
                  <select value={rebrandForm.product_id || ''} onChange={e => {
                    if (e.target.value === '__new__') {
                      setRebrandForm(f => ({...f, toonNieuwProduct: true, nieuwProductNaam: '', product_id: ''}));
                    } else {
                      setRebrandForm(f => ({...f, product_id: e.target.value ? Number(e.target.value) : ''}));
                    }
                    setRebrandError('');
                  }} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm bg-white t-input">
                    <option value="">{t('ph_select_product')}</option>
                    {doelKandidaten.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.naam}{p.stijl ? ` (${p.stijl})` : ''}</option>
                    ))}
                    <option value="__new__">{t('lbl_afvulling_nieuw_product')}</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-1">
                  <input type="text" value={rebrandForm.nieuwProductNaam} onChange={e => setRebrandForm(f => ({...f, nieuwProductNaam: e.target.value}))}
                    placeholder={t('ph_nieuw_product_naam')} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm t-input" autoFocus />
                  <Btn s="sm" onClick={() => {
                    const naam = rebrandForm.nieuwProductNaam.trim();
                    if (!naam) { setRebrandError(t('err_product_naam_leeg')); return; }
                    const dupl = (producten||[]).find((p: any) => (p.naam||'').toLowerCase() === naam.toLowerCase());
                    if (dupl) { setRebrandError(t('err_product_naam_duplicaat')); return; }
                    const id = newId(producten||[]);
                    setProducten((prev: any[]) => [...(prev||[]), {id, naam, status: 'actief', created_at: tod()}]);
                    logAudit(auditLog, setAuditLog, {entiteit: 'Product', entiteit_id: id, actie: 'aangemaakt', omschrijving: `Product "${naam}" aangemaakt`});
                    setRebrandForm(f => ({...f, product_id: id, toonNieuwProduct: false, nieuwProductNaam: ''}));
                    setRebrandError('');
                  }}>{t('btn_product_toevoegen')}</Btn>
                  <button type="button" onClick={() => setRebrandForm(f => ({...f, toonNieuwProduct: false, nieuwProductNaam: ''}))}
                    className="px-2 py-1 text-gray-400 hover:text-red-500 border border-gray-300 rounded text-sm">✕</button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_quantity')} <span className="text-red-400">*</span></label>
                <input type="number" min={1} max={beschikbaar} value={rebrandForm.aantal}
                  onChange={e => { setRebrandForm(f => ({...f, aantal: e.target.value})); setRebrandError(''); }}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                <p className="text-xs text-gray-400 mt-1">{t('err_afboeking_max_available').replace('{max}', String(beschikbaar)).replace('{unit}', t('unit_stuks'))}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_datum')}</label>
                <input type="date" value={tod()} readOnly
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('lbl_opmerking')}</label>
              <textarea value={rebrandForm.opmerking} onChange={e => setRebrandForm(f => ({...f, opmerking: e.target.value}))} rows={2}
                placeholder={t('ph_rebrand_opmerking')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm t-input resize-none" />
            </div>

            {aantalNum >= 1 && aantalNum <= beschikbaar && (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                {wordtSplitsing
                  ? t('info_rebrand_splitsing').replace('{n}', String(aantalNum)).replace('{rest}', String(totaal - aantalNum))
                  : t('info_rebrand_volledig')}
              </div>
            )}

            {rebrandError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">{rebrandError}</div>}
            <div className="flex justify-end gap-2 pt-1 border-t">
              <Btn v="secondary" onClick={() => setRebrandModal(null)}>{t('btn_cancel')}</Btn>
              <Btn onClick={doRebrand}>{t('btn_rebrand_bevestigen')}</Btn>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Vernietigingsreview-modal — Douane v2.4 §7.2.3 */}
      {vernietigReviewModal && (() => {
        const status: VernietigingStatus = vernietigReviewModal.vernietiging_status || 'aangevraagd';
        const ab = vernietigReviewModal;
        const naarToegestaan = status === 'aangevraagd';
        const naarUitgevoerd = status === 'toegestaan';
        return (
          <Modal title={`Vernietiging — ${VERNIETIGING_STATUS_LABEL[status]} → ${naarToegestaan ? 'Toegestaan' : 'Uitgevoerd'}`} onClose={() => setVernietigReviewModal(null)}>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700 space-y-1">
                <div><strong>Aantal:</strong> {ab.aantal}× &nbsp; <strong>Reden:</strong> {ab.opmerking || '—'}</div>
                <div className="text-xs text-gray-500">
                  Verklaring ingediend: {ab.verklaring_ingediend_op ? fmtD(ab.verklaring_ingediend_op) : '—'}
                  {ab.toestemming_ontvangen_op && <> · Toestemming ontvangen: {fmtD(ab.toestemming_ontvangen_op)}</>}
                  {ab.kenmerk_douane && <> · Kenmerk: {ab.kenmerk_douane}</>}
                </div>
                {Number(ab.voorcalc_accijns_totaal||0) > 0 && (
                  <div className="text-xs text-amber-700">Potentiële accijnsschuld onder schorsing: € {Number(ab.voorcalc_accijns_totaal).toFixed(2)} — vervalt bij correct uitgevoerde vernietiging.</div>
                )}
                {(ab.bijlagen||[]).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(ab.bijlagen||[]).map((b: Bijlage, i: number) => (
                      <li key={i} className="text-xs">
                        <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">📎 {b.naam}</a>
                        {b.rol && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] uppercase tracking-wide">{b.rol === 'douane_verklaring' ? 'verklaring' : 'bewijs'}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {naarToegestaan && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Stap 2: schriftelijke toestemming Douane verwerken</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Datum toestemming <span className="text-red-400">*</span></label>
                      <input type="date" value={vernietigReviewForm.toestemming_ontvangen_op}
                        onChange={e => { setVernietigReviewForm(f => ({...f, toestemming_ontvangen_op: e.target.value})); setVernietigReviewError(''); }}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Kenmerk Douane (optioneel)</label>
                      <input type="text" value={vernietigReviewForm.kenmerk_douane}
                        onChange={e => setVernietigReviewForm(f => ({...f, kenmerk_douane: e.target.value}))}
                        placeholder="bijv. referentienummer brief"
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                    </div>
                  </div>
                </div>
              )}

              {naarUitgevoerd && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Stap 3: vernietiging uitgevoerd — bewijs uploaden</p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Datum uitvoering <span className="text-red-400">*</span></label>
                    <input type="date" value={vernietigReviewForm.uitgevoerd_op}
                      onChange={e => { setVernietigReviewForm(f => ({...f, uitgevoerd_op: e.target.value})); setVernietigReviewError(''); }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm t-input" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Bewijs van vernietiging (foto's / video) <span className="text-red-400">*</span></label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer bg-white">
                        <span>📎</span>
                        <span>{vernietigReviewUploading ? t('lbl_uploading') : 'Bewijs uploaden (rol: bewijs)'}</span>
                        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff,.bmp,.heic,.heif"
                          className="hidden" disabled={vernietigReviewUploading}
                          onChange={e => { doVernietigBewijsUpload(e.target.files); e.target.value = ''; }} />
                      </label>
                      <span className="text-xs text-gray-500">{t('lbl_allowed_formats_photo')}</span>
                    </div>
                    {vernietigReviewForm.bewijsBijlagen.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {vernietigReviewForm.bewijsBijlagen.map((b, i) => (
                          <li key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1 text-xs">
                            <a href={`${ADDON_BASE}api/file/${b.bestand}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 truncate">
                              📎 <span className="truncate">{b.naam}</span>
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] uppercase tracking-wide">bewijs</span>
                            </a>
                            <button onClick={() => doVernietigBewijsRemove(i)} className="text-gray-400 hover:text-red-500 ml-2">✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[11px] text-green-700">
                    Bij bevestigen wordt de voorraad definitief afgeboekt en vervalt de potentiële
                    accijnsschuld voor deze hoeveelheid onder de schorsingsregeling.
                  </p>
                </div>
              )}

              {vernietigReviewError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">{vernietigReviewError}</div>}
              <div className="flex justify-end gap-2 pt-1 border-t">
                <Btn v="secondary" onClick={() => setVernietigReviewModal(null)}>{t('btn_cancel')}</Btn>
                {naarToegestaan && <Btn onClick={markVernietigingToegestaan} v="primary">Markeer Toegestaan</Btn>}
                {naarUitgevoerd && <Btn onClick={markVernietigingUitgevoerd} v="green" disabled={vernietigReviewUploading}>Markeer Uitgevoerd</Btn>}
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

export default ProductenPage
