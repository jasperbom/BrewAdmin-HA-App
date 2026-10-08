import { t } from '../../i18n'
import { fmtD } from '../../utils/format'
import { batchStatusLabel } from '../../utils/constants'
import { datumKort, type ReceptRedenDeel } from '../../utils/receptLijst'
import type { ReceptVoorraadOordeel } from '../../utils/ingredientVoorraad'

// De teksten van de receptenlijst en de kiezers: de pure afleiding staat in
// utils/receptLijst.ts (soorten, datums als JJJJ-MM-DD), de vertaling hier —
// één plek, zodat de lijst, het detail en de kiezer hetzelfde zeggen.

const LOPEND_SLEUTEL: Record<string, string> = {
  Brouwen: 'recept_reden_brouwt',
  Vergisten: 'recept_reden_vergist',
  Conditioneren: 'recept_reden_conditioneert',
}

/** "gepland 14-10 (#2611)", "#2609 conditioneert". */
const lopendTekst = (d: Extract<ReceptRedenDeel, { soort: 'lopend' }>, vandaag: string): string => {
  if (d.status === 'Gepland') {
    const datum = datumKort(d.datum, vandaag)
    if (datum && d.nr) return t('recept_reden_gepland_op_nr').replace('{datum}', datum).replace('{nr}', d.nr)
    if (datum) return t('recept_reden_gepland_op').replace('{datum}', datum)
    if (d.nr) return t('recept_reden_gepland_nr').replace('{nr}', d.nr)
    return t('recept_reden_gepland')
  }
  const sleutel = LOPEND_SLEUTEL[d.status]
  if (!sleutel) return batchStatusLabel(d.status)
  return d.nr ? t(`${sleutel}_nr`).replace('{nr}', d.nr) : t(sleutel)
}

/** De regel onder een recept: de stukjes van `receptReden`, met " · " ertussen. */
export const redenTekst = (delen: ReadonlyArray<ReceptRedenDeel>, vandaag: string): string =>
  delen.map(d => {
    switch (d.soort) {
      case 'stijl': return d.tekst
      case 'aantal': return t('recept_reden_aantal').replace('{n}', String(d.n))
      case 'datum': return fmtD(d.datum)
      case 'laatst': return t('recept_reden_laatst').replace('{datum}', fmtD(d.datum))
      case 'brewfather': return t('recept_reden_brewfather').replace('{datum}', fmtD(d.datum))
      case 'nooit': return t('recept_reden_nooit')
      case 'lopend': return lopendTekst(d, vandaag)
      default: return ''
    }
  }).filter(Boolean).join(' · ')

/** Kleur en tekst van de voorraadstip; null = niets te zeggen (geen stip). */
export const voorraadStip = (o: ReceptVoorraadOordeel | null | undefined): { kleur: string; label: string } | null => {
  if (!o) return null
  if (o.status === 'klaar') return { kleur: 'bg-green-500', label: t('recept_voorraad_klaar') }
  if (o.status === 'bijna') return { kleur: 'bg-orange-400', label: t('recept_voorraad_bijna').replace('{n}', String(o.tekort)) }
  if (o.status === 'tekort') return { kleur: 'bg-red-500', label: t('recept_voorraad_tekort').replace('{n}', String(o.tekort)) }
  return null
}
