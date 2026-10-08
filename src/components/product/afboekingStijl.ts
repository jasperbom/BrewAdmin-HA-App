// Labels en kleuren van een afboeking (vermis, vernietiging, overig) en de
// status van een vernietiging (Douane v2.4 §7.2.3) — gedeeld door de
// productpagina (de vensters) en de voorraadkaart (de regels per lot).
// i18n-sleutels, geen kant-en-klare tekst: de labels bewegen mee met de taal.

export type AfboekingReden = 'vermis' | 'vernietiging' | 'overig'
export type VernietigingStatus = 'aangevraagd' | 'toegestaan' | 'uitgevoerd'

export const VERNIETIGING_STATUS_LABEL: Record<VernietigingStatus, string> = {
  aangevraagd: 'verlies_vern_status_aangevraagd',
  toegestaan: 'verlies_vern_status_toegestaan',
  uitgevoerd: 'verlies_vern_status_uitgevoerd',
}

export const VERNIETIGING_STATUS_COLOR: Record<VernietigingStatus, string> = {
  aangevraagd: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  toegestaan:  'bg-blue-50 text-blue-700 border border-blue-200',
  uitgevoerd:  'bg-green-50 text-green-700 border border-green-200',
}

export const AFBOEKING_REDENEN: { v: AfboekingReden; lKey: string }[] = [
  { v: 'vermis',        lKey: 'lbl_afboeking_vermis' },
  { v: 'vernietiging',  lKey: 'lbl_afboeking_vernietiging' },
  { v: 'overig',        lKey: 'lbl_afboeking_overig' },
]

export const REDEN_COLORS: Record<AfboekingReden, string> = {
  vermis:         'text-red-600 bg-red-50',
  vernietiging:   'text-orange-600 bg-orange-50',
  overig:         'text-gray-600 bg-gray-100',
}
