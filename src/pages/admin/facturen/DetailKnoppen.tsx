import React from 'react'
import Btn from '../../../components/ui/Btn'
import BevestigKnop from '../../../components/ui/BevestigKnop'

// ── Knoppen van het factuurdetail ───────────────────────────────────────────
// De pagina beslist wélke handelingen er zijn (en wat ze doen); het detail
// zet ze neer: één primaire en hooguit één tweede knop in de actiebalk (op
// een telefoon onder de duim), de rest als rustige lijst knoppen in het
// detail zelf. Een gevaarlijke of statuswijzigende handeling vraagt de
// bevestiging in de knop (BevestigKnop), nooit met confirm().

export interface DetailKnop {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Rood, en met `bevestig` eerst de vraag in de knop. */
  gevaar?: boolean
  /** De vraag van BevestigKnop ("Factuur verwijderen?"). */
  bevestig?: string
}

const KnopZelf: React.FC<{ k: DetailKnop, v: 'primary' | 'secondary' | 'danger', cls?: string }> = ({ k, v, cls = '' }) =>
  k.bevestig && !k.disabled
    ? <BevestigKnop v={k.gevaar ? 'danger' : v} cls={cls} vraag={k.bevestig} title={k.title} onBevestig={k.onClick}>{k.label}</BevestigKnop>
    : <Btn v={v} cls={cls} disabled={k.disabled} title={k.title} onClick={k.onClick}>{k.label}</Btn>

/** De actiebalk: primair rechts (of alleen), een tweede knop ervoor. */
export const ActieBalk: React.FC<{ primair?: DetailKnop | null, tweede?: DetailKnop | null }> = ({ primair, tweede }) => (
  <>
    {tweede && <KnopZelf k={tweede} v="secondary" cls="flex-1" />}
    {primair && <KnopZelf k={primair} v="primary" cls="flex-1" />}
  </>
)

/** De overige handelingen, als compacte lijst knoppen in het detail. */
export const MeerKnoppen: React.FC<{ knoppen: DetailKnop[], label: string }> = ({ knoppen, label }) => {
  if (!knoppen.length) return null
  const gewoon = knoppen.filter(k => !k.gevaar)
  const gevaar = knoppen.filter(k => k.gevaar)
  return (
    <div role="group" aria-label={label} className="grid gap-2">
      {gewoon.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gewoon.map(k => <KnopZelf key={k.id} k={k} v="secondary" />)}
        </div>
      )}
      {gevaar.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {gevaar.map(k => <KnopZelf key={k.id} k={k} v="danger" />)}
        </div>
      )}
    </div>
  )
}
