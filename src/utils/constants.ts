import { t } from '../i18n'

export const STATUS_CLR: Record<string, string> = {
  "Gepland":"bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  "Brouwen":"bg-blue-100 text-blue-700 ring-1 ring-blue-200",
  "Vergisten":"bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  "Vergisting":"bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  "Conditioneren":"bg-purple-100 text-purple-700 ring-1 ring-purple-200",
  "Lagering":"bg-purple-100 text-purple-700 ring-1 ring-purple-200",
  "Verpakt":"bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  "Gesloten":"bg-gray-100 text-gray-500 ring-1 ring-gray-200"
}

export const STATUSSEN = ["Gepland","Brouwen","Vergisten","Conditioneren","Verpakt","Gesloten"]
export const BUILTIN_ING_TYPES = ["Mout","Hop","Gist","Suiker","Overig"]
export const BUILTIN_KOSTEN_SOORTEN = ['Grondstoffen','Verpakkingsmateriaal','Energie','Huur','Transport','Onderhoud','Marketing','Administratie','Overig']
export const EENHEDEN = ["kg","g","L","mL","pkg","stuks"]

export const UNIT_BASE: Record<string, {group:string, f:number}> = {
  mL:{group:'volume',f:1}, L:{group:'volume',f:1000},
  g:{group:'mass',f:1}, kg:{group:'mass',f:1000}
}

export const convertEenheid = (amount: any, van: string, naar: string): number | null => {
  if (!amount || van === naar) return Number(amount)
  const v = UNIT_BASE[van], n = UNIT_BASE[naar]
  if (!v || !n || v.group !== n.group) return null
  return (Number(amount) * v.f) / n.f
}

export const compatibeleEenheden = (eenheid: string): string[] => {
  const base = UNIT_BASE[eenheid]
  if (!base) return [eenheid]
  return EENHEDEN.filter(e => UNIT_BASE[e]?.group === base.group)
}

export const VERPAKKINGEN = ["Fust 20L","Fust 30L","Fust 50L","Fles 33cL","Fles 50cL","Fles 75cL","Blik 33cL","Blik 50cL"]

export const VERPAKKING_DEFAULTS = [
  {naam:'Fles 33cL',inhoud_liter:0.33,type:'fles'},{naam:'Fles 50cL',inhoud_liter:0.50,type:'fles'},{naam:'Fles 75cL',inhoud_liter:0.75,type:'fles'},
  {naam:'Blik 33cL',inhoud_liter:0.33,type:'blik'},{naam:'Blik 50cL',inhoud_liter:0.50,type:'blik'},
  {naam:'Fust 10L',inhoud_liter:10,type:'fust'},{naam:'Fust 20L',inhoud_liter:20,type:'fust'},{naam:'Fust 30L',inhoud_liter:30,type:'fust'},{naam:'Fust 50L',inhoud_liter:50,type:'fust'},
]

export const ONDERDEEL_TYPES = [
  {type:'fles',      label:'pkg_fles'},
  {type:'blik',      label:'pkg_blik'},
  {type:'fust',      label:'pkg_fust'},
  {type:'kroonkurk', label:'pkg_kroonkurk'},
  {type:'deksel',    label:'pkg_deksel'},
  {type:'cap',       label:'pkg_cap'},
  {type:'label',     label:'pkg_label_type'},
  {type:'overig',    label:'ing_type_overig'},
]

export const verpKostenLabels = (type: string) => ({
  fles: {verpakking:t('pkg_fles'),   afsluiting:t('pkg_kroonkurk')},
  blik: {verpakking:t('pkg_blik'),   afsluiting:t('pkg_deksel')},
  fust: {verpakking:t('pkg_fust'),   afsluiting:t('pkg_cap')},
} as Record<string,any>)[type] || {verpakking:t('pkg_default'), afsluiting:t('pkg_closure_default')}

export const NAV_THEMES: Record<string, any> = {
  amber:  {p1:'#451a03',p2:'#78350f',p3:'#d97706',p4:'#fde68a',p5:'#fffbeb',
           from:'#451a03',to:'#78350f',accent:'#d97706',light:'#fde68a',pale:'#fffbeb',text:'#78350f',btn:'#d97706',btnH:'#b45309',btnA:'#78350f',bg:'#fefdf5'},
  green:  {p1:'#052e16',p2:'#14532d',p3:'#16a34a',p4:'#bbf7d0',p5:'#f0fdf4',
           from:'#052e16',to:'#14532d',accent:'#16a34a',light:'#bbf7d0',pale:'#f0fdf4',text:'#14532d',btn:'#16a34a',btnH:'#15803d',btnA:'#14532d',bg:'#f4fcf7'},
  blue:   {p1:'#172554',p2:'#1e3a8a',p3:'#2563eb',p4:'#bfdbfe',p5:'#eff6ff',
           from:'#172554',to:'#1e3a8a',accent:'#2563eb',light:'#bfdbfe',pale:'#eff6ff',text:'#1e3a8a',btn:'#2563eb',btnH:'#1d4ed8',btnA:'#1e3a8a',bg:'#f4f8ff'},
  slate:  {p1:'#020617',p2:'#1e293b',p3:'#64748b',p4:'#cbd5e1',p5:'#f8fafc',
           from:'#020617',to:'#1e293b',accent:'#64748b',light:'#cbd5e1',pale:'#f8fafc',text:'#1e293b',btn:'#64748b',btnH:'#475569',btnA:'#334155',bg:'#f5f7f9'},
  red:    {p1:'#450a0a',p2:'#7f1d1d',p3:'#dc2626',p4:'#fecaca',p5:'#fef2f2',
           from:'#450a0a',to:'#7f1d1d',accent:'#dc2626',light:'#fecaca',pale:'#fef2f2',text:'#7f1d1d',btn:'#dc2626',btnH:'#b91c1c',btnA:'#991b1b',bg:'#fff5f5'},
  purple: {p1:'#2e1065',p2:'#4c1d95',p3:'#7c3aed',p4:'#ddd6fe',p5:'#f5f3ff',
           from:'#2e1065',to:'#4c1d95',accent:'#7c3aed',light:'#ddd6fe',pale:'#f5f3ff',text:'#4c1d95',btn:'#7c3aed',btnH:'#6d28d9',btnA:'#5b21b6',bg:'#f8f5ff'},
}

export const DEFAULT_HYGIENE_GROUPS = [
  {id:1,naam:'Voorbereiding',volgorde:0},
  {id:2,naam:'Brouwen',volgorde:1},
  {id:3,naam:'Gisting',volgorde:2},
]

export const DEFAULT_HYGIENE_ITEMS = [
  {id:1,label:'Ketel gereinigd en gespoeld',group_id:1,volgorde:0},
  {id:2,label:'Waterslot gevuld',group_id:3,volgorde:0},
  {id:3,label:'Fermentatie-emmer gesteriliseerd',group_id:3,volgorde:1},
  {id:4,label:'Thermometer gesteriliseerd',group_id:2,volgorde:0},
  {id:5,label:'Hydrometer gesteriliseerd',group_id:2,volgorde:1},
]

export const BF_TO_APP: Record<string,string> = {
  Planning:'Gepland',Brewing:'Brouwen',Fermenting:'Vergisten',
  Conditioning:'Conditioneren',Carbonating:'Conditioneren',
  Packaging:'Verpakt',Completed:'Gesloten',Archived:'Gesloten'
}

export const SUPPORTED_LANGS = ['nl', 'en', 'de', 'fr', 'es']

export const detectLang = (): string => {
  const browser = ((navigator as any).language || (navigator as any).userLanguage || 'en').toLowerCase().split('-')[0]
  return SUPPORTED_LANGS.includes(browser) ? browser : 'en'
}
