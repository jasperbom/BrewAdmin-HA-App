import React from 'react'
import { t } from '../../i18n'
import { fmtD } from '../../utils/format'
import { andereTags, type ReceptTagGroep, type ReceptTagIndeling } from '../../utils/receptLijst'
import Btn from '../ui/Btn'
import LegeStaat from '../ui/LegeStaat'
import RowActions, { type RowActie } from '../ui/RowActions'

// De receptenlijst per Brewfather-tag (de indeling zelf staat in
// utils/receptLijst.ts). Alle onderdelen staan buiten de render van de
// pagina, zodat ze bij typen elders op de pagina niet opnieuw opgebouwd
// worden. Verbergen en het tagbeheer zitten in het ⋯-menu: hover-knoppen
// bestaan op een aanraakscherm niet.

export interface ReceptTagLijstProps {
  indeling: ReceptTagIndeling<any>
  /** Versies per hoofdrecept (`versiesPerRecept`). */
  versies: Map<string, any[]>
  /** Het geopende recept (tekst), of null. */
  geselecteerdId: string | null
  /** Een recept (of versie) aantikken: openen, of weer sluiten als hij al open is. */
  onOpen: (id: string) => void
  /** De zoekterm, voor de melding als er niets gevonden wordt. */
  zoek: string
  onZoekWissen: () => void
  /** Er staan helemaal geen recepten in de app. */
  geenRecepten: boolean
  gearchiveerdeTags: string[]
  onToggleGroep: (sleutel: string) => void
  onVerplaats: (tag: string, richting: 'omhoog' | 'omlaag') => void
  /** Tag archiveren of terugzetten. */
  onTagArchief: (tag: string) => void
  /** Recept verbergen of weer tonen. */
  onVerbergen: (id: string) => void
}

const ReceptTagLijst: React.FC<ReceptTagLijstProps> = ({
  indeling, versies, geselecteerdId, onOpen, zoek, onZoekWissen, geenRecepten, gearchiveerdeTags,
  onToggleGroep, onVerplaats, onTagArchief, onVerbergen,
}) => {
  const [versiesOpen, setVersiesOpen] = React.useState<Record<string, boolean>>({})
  const [archiefOpen, setArchiefOpen] = React.useState(false)
  const [verborgenOpen, setVerborgenOpen] = React.useState(false)
  const toggleVersies = (id: string) => setVersiesOpen(o => ({ ...o, [id]: !o[id] }))

  if (geenRecepten) {
    return <div className="text-center text-gray-400 text-xs py-8 px-3">{t('recipe_no_recipes')}</div>
  }
  if (indeling.zoekt && indeling.aantal === 0) {
    return (
      <LegeStaat cls="m-3" icoon="search" titel={t('recipe_no_results')}
        tekst={t('recipe_geen_resultaat_tekst').replace('{zoek}', zoek.trim())}>
        <Btn v="secondary" s="sm" onClick={onZoekWissen}>{t('recipe_zoek_wissen')}</Btn>
      </LegeStaat>
    )
  }

  // Bij zoeken staan de groepen met een treffer open; inklappen kan dan niet.
  const zoekt = indeling.zoekt
  const archiefZichtbaar = zoekt ? indeling.gearchiveerd.length > 0 : archiefOpen
  const verborgenZichtbaar = zoekt ? indeling.verborgen.length > 0 : verborgenOpen

  const kaart = (r: any, groep: ReceptTagGroep<any> | null, acties: RowActie[], gedimd = false) => {
    const id = String(r.id)
    return (
      <ReceptKaart key={id} recept={r} versies={versies.get(id) || []}
        versiesOpen={!!versiesOpen[id]} onVersiesToggle={() => toggleVersies(id)}
        geselecteerdId={geselecteerdId} onOpen={onOpen} acties={acties} gedimd={gedimd}
        andereTags={groep ? andereTags(r, groep.tag, gearchiveerdeTags) : []} />
    )
  }
  const verbergActie = (r: any): RowActie => ({ id: 'verbergen', label: t('btn_hide'), onClick: () => onVerbergen(String(r.id)) })

  const tagActies = (g: ReceptTagGroep<any>): RowActie[] => {
    if (g.tag == null) return []
    const tag = g.tag
    if (g.gearchiveerd) return [{ id: 'tag-terug', label: t('btn_tag_restore'), onClick: () => onTagArchief(tag) }]
    const plek = indeling.actieveTags.indexOf(tag)
    return [
      { id: 'omhoog', label: t('btn_up'), disabled: plek <= 0, onClick: () => onVerplaats(tag, 'omhoog') },
      { id: 'omlaag', label: t('btn_down'), disabled: plek < 0 || plek >= indeling.actieveTags.length - 1, onClick: () => onVerplaats(tag, 'omlaag') },
      { id: 'tag-archief', label: t('btn_tag_archive'), onClick: () => onTagArchief(tag) },
    ]
  }

  return (
    <div>
      {indeling.groepen.map(g => !indeling.metKoppen
        // Zonder actieve tags: één platte lijst, zonder kop.
        ? <div key={g.sleutel}>{g.recepten.map(r => kaart(r, g, [verbergActie(r)]))}</div>
        : (
          <TagGroep key={g.sleutel} groep={g} label={g.tag ?? t('lbl_without_tag')}
            onToggle={zoekt ? undefined : () => onToggleGroep(g.sleutel)} acties={tagActies(g)}>
            {g.recepten.map(r => kaart(r, g, [verbergActie(r)]))}
          </TagGroep>
        ))}
      {indeling.gearchiveerd.length > 0 && (
        <div className="border-t">
          <SectieKnop open={archiefZichtbaar} onToggle={zoekt ? undefined : () => setArchiefOpen(o => !o)}
            label={t('lbl_archived_tags')} aantal={indeling.gearchiveerd.length} />
          {archiefZichtbaar && indeling.gearchiveerd.map(g => (
            <TagGroep key={g.sleutel} groep={g} label={g.tag ?? t('lbl_without_tag')}
              onToggle={zoekt ? undefined : () => onToggleGroep(g.sleutel)} acties={tagActies(g)}>
              {g.recepten.map(r => kaart(r, g, [verbergActie(r)]))}
            </TagGroep>
          ))}
        </div>
      )}
      {indeling.verborgen.length > 0 && (
        <div className="border-t">
          <SectieKnop open={verborgenZichtbaar} onToggle={zoekt ? undefined : () => setVerborgenOpen(o => !o)}
            label={t('lbl_hidden')} aantal={indeling.verborgen.length} />
          {verborgenZichtbaar && indeling.verborgen.map(r => kaart(r, null,
            [{ id: 'terugzetten', label: t('btn_restore'), onClick: () => onVerbergen(String(r.id)) }], true))}
        </div>
      )}
    </div>
  )
}

/** Uitklapkop van een deel van de lijst (gearchiveerde tags, verborgen recepten). */
const SectieKnop: React.FC<{ open: boolean; onToggle?: () => void; label: string; aantal: number }> = ({ open, onToggle, label, aantal }) => (
  <button type="button" onClick={onToggle} disabled={!onToggle} aria-expanded={open}
    className="w-full flex items-center gap-2 px-3 py-1.5 min-h-tap sm:min-h-0 text-xs font-medium text-gray-500 enabled:hover:text-gray-700 enabled:hover:bg-gray-100 transition-colors">
    <Pijl open={open} />
    <span>{label} ({aantal})</span>
  </button>
)

const Pijl: React.FC<{ open: boolean }> = ({ open }) => (
  <span aria-hidden="true" className="text-gray-400 inline-block text-[10px]"
    style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
)

export interface TagGroepProps {
  groep: ReceptTagGroep<any>
  /** De tag, of de vertaling van "Zonder tag". */
  label: string
  /** Zonder: de groep is niet in te klappen (bij zoeken staat hij open). */
  onToggle?: () => void
  /** Omhoog, omlaag, archiveren — in het ⋯-menu. */
  acties: RowActie[]
  children: React.ReactNode
}

export const TagGroep: React.FC<TagGroepProps> = ({ groep, label, onToggle, acties, children }) => (
  <div>
    <div className="flex items-center bg-gray-50 border-b">
      <button type="button" onClick={onToggle} disabled={!onToggle} aria-expanded={groep.open}
        className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 min-h-tap sm:min-h-0 text-left text-xs font-medium text-gray-500 enabled:hover:bg-gray-100 transition-colors">
        <Pijl open={groep.open} />
        <span className="truncate">{label}</span>
        <span className="font-normal text-gray-400 flex-shrink-0">({groep.recepten.length})</span>
      </button>
      {acties.length > 0 && <RowActions acties={acties} cls="pr-1 flex-shrink-0" />}
    </div>
    {groep.open && children}
  </div>
)

export interface ReceptKaartProps {
  recept: any
  /** De versies van dit recept, nieuwste eerst. */
  versies: any[]
  versiesOpen: boolean
  onVersiesToggle: () => void
  geselecteerdId: string | null
  onOpen: (id: string) => void
  /** Wat er achter ⋯ zit (verbergen, terugzetten). */
  acties: RowActie[]
  /** Tags naast de groep waarin het recept staat ("ook IPA"). */
  andereTags?: string[]
  /** Verborgen recept: iets lichter. */
  gedimd?: boolean
}

export const ReceptKaart: React.FC<ReceptKaartProps> = ({
  recept: r, versies, versiesOpen, onVersiesToggle, geselecteerdId, onOpen, acties, andereTags: anderen = [], gedimd = false,
}) => {
  const id = String(r.id)
  const isSel = (x: unknown) => geselecteerdId != null && String(x) === geselecteerdId
  const abv = Number(r.ABV)
  // De hele kaart opent het recept (muis, vinger); voor het toetsenbord is de
  // naam de knop — zonder eigen onClick: zijn klik bubbelt naar de kaart. De
  // kaart zelf is geen role="button": de versieknop en ⋯ staan erin, en een
  // knop in een knop is voor een schermlezer onbruikbaar.
  return (
    <>
      <div onClick={() => onOpen(id)}
        className={`px-3 py-2.5 border-b cursor-pointer t-hover transition-colors ${isSel(id) ? 't-sel border-l-2' : ''} ${gedimd ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <button type="button" aria-current={isSel(id) ? 'true' : undefined}
              className="block w-full text-left font-medium text-sm truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
              {r.naam || t('lbl_naamloos')}
            </button>
            {r.stijl && <div className="text-xs text-gray-500 mt-0.5 truncate">{r.stijl}</div>}
            {(Number(r.batch_size) > 0 || abv > 0 || anderen.length > 0 || versies.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-gray-400">
                {Number(r.batch_size) > 0 && <span>{r.batch_size} L</span>}
                {abv > 0 && <span>{abv.toFixed(1)}%</span>}
                {anderen.length > 0 && <span className="truncate">{t('recipe_ook_tags').replace('{tags}', anderen.join(', '))}</span>}
                {versies.length > 0 && (
                  <button type="button" aria-expanded={versiesOpen}
                    onClick={e => { e.stopPropagation(); onVersiesToggle() }}
                    className="inline-flex items-center min-h-tap sm:min-h-0 -my-2.5 sm:my-0">
                    <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full hover:bg-blue-200 transition-colors whitespace-nowrap">
                      {t('recipe_versions_count').replace('{n}', String(versies.length + 1))} {versiesOpen ? '▴' : '▾'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
          {/* RowActions houdt zijn klik zelf binnen: ⋯ opent het menu, niet het recept. */}
          {acties.length > 0 && <RowActions acties={acties} cls="-mr-1 -mt-1 flex-shrink-0" />}
        </div>
      </div>
      {versiesOpen && versies.map((v: any) => {
        const vid = String(v.id)
        return (
          <button key={vid} type="button" onClick={() => onOpen(vid)}
            aria-current={isSel(vid) ? 'true' : undefined}
            className={`w-full text-left pl-6 pr-3 py-1.5 min-h-tap sm:min-h-0 flex items-center gap-2 border-b t-hover transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--t-accent)] ${isSel(vid) ? 't-sel border-l-2' : ''}`}>
            <span className="font-mono text-blue-600 font-medium flex-shrink-0">{v.versie || t('recipe_version_snapshot')}</span>
            <span className="text-gray-600 truncate flex-1 min-w-0">{v.naam}</span>
            {v.versie_datum && <span className="text-gray-400 flex-shrink-0">{fmtD(v.versie_datum)}</span>}
          </button>
        )
      })}
    </>
  )
}

export default ReceptTagLijst
