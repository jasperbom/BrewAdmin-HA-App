import React from 'react'
import { t, getLang } from '../i18n'
import Blad from './ui/Blad'
import Btn from './ui/Btn'
import { callClaudeProxy } from '../utils/api'
import { logAudit } from '../utils/audit'
import { voerScanUit, tekstBlok, ScanFout, scanFoutSleutel, modelNaam } from '../utils/claudeScan'
import {
  ALLERGEEN_KEYS, glutenConventie, regelVoorstel, metAiUitkomst, metAanpassing, teVragen, inStukken,
  allergeenScanPrompt, allergeenScanSchema, normaliseerAllergeenScan, neemVoorstellenOver, overneembaar, bronVan,
  type AllergeenVoorstel,
} from '../utils/allergeenOpzoeken'
import type { Allergeen, Ingredient } from '../types'

// ── Allergenen opzoeken ─────────────────────────────────────────────────────
// Eén blad voor de hele app (net als "Etiket bijwerken"): per ingrediënt een
// voorstel uit de vaste brouwkennis, en voor wat die niet zeker weet een
// voorstel van Claude (utils/allergeenOpzoeken.ts). Er wordt niets vanzelf
// vastgelegd: wat je aanvinkt en overneemt wordt de beoordeling van het
// ingrediënt, en elk bier waarin het zit neemt die dan vanzelf mee. Het etiket
// van het product blijft een aparte stap (Etiket bijwerken), zodat CCP 3 een
// onafhankelijke controle blijft.
//
// Eén keer gemount in App.tsx; de pagina's openen het met
// `useAllergenenOpzoeken()?.open(ingredientIds)`. Zonder provider (of zonder
// schrijfrecht op de ingrediënten) is de dienst null: dan geen knop.

export interface AllergenenOpzoekenDienst {
  open: (ingredientIds: readonly number[]) => void
}

const AllergenenOpzoekenContext = React.createContext<AllergenenOpzoekenDienst | null>(null)
export const AllergenenOpzoekenProvider = AllergenenOpzoekenContext.Provider
export const useAllergenenOpzoeken = (): AllergenenOpzoekenDienst | null => React.useContext(AllergenenOpzoekenContext)

export interface AllergenenOpzoekenProps {
  ingredientIds: readonly number[]
  ingredienten: Ingredient[]
  setIng: (fn: (prev: Ingredient[]) => Ingredient[]) => void
  /** Is er een Claude-sleutel? Zonder alleen de vaste brouwkennis. */
  heeftSleutel: boolean
  auditLog: any[]
  setAuditLog: (fn: (prev: any[]) => any[]) => void
  onSluit: () => void
}

type ClaudeStand =
  | { status: 'rust' }
  | { status: 'bezig', aantal: number }
  | { status: 'klaar' }
  | { status: 'fout', fout: string }

const foutTekst = (e: unknown): string => {
  if (e instanceof ScanFout) return t(scanFoutSleutel(e.code))
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message || '') : ''
  return m || t('scan_fout_leeg')
}

const naamVan = (a: Allergeen): string => t(`haccp_allergen_${a}`, a)

/** De reden of toelichting zoals hij op het ingrediënt komt te staan. */
const toelichtingVan = (v: AllergeenVoorstel): string => v.bron === 'claude'
  ? (v.toelichting || '')
  : v.regel ? t(v.regel.reden).replace('{woorden}', v.regel.woorden.join(', ')) : ''

const Chips: React.FC<{ lijst: readonly Allergeen[] }> = ({ lijst }) => lijst.length ? (
  <span className="flex flex-wrap gap-1">
    {lijst.map(a => (
      <span key={a} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{naamVan(a)}</span>
    ))}
  </span>
) : <span className="text-sm text-gray-700">{t('allergenen_opzoeken_geen_allergenen')}</span>

/** Zelf kiezen: "Geen allergenen" of de allergenen die erin zitten. */
const Kiezer: React.FC<{ naam: string, lijst: readonly Allergeen[] | null, onKies: (lijst: Allergeen[]) => void }> = ({ naam, lijst, onKies }) => {
  const huidig = lijst || []
  const knop = (aan: boolean) =>
    `inline-flex items-center px-2.5 rounded-full text-xs font-medium border min-h-[36px] sm:min-h-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${aan ? 't-panel text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`
  return (
    <div role="group" aria-label={t('allergenen_opzoeken_kies_label').replace('{naam}', naam)} className="flex flex-wrap gap-1.5">
      <button type="button" aria-pressed={!!lijst && !huidig.length} className={knop(!!lijst && !huidig.length)} onClick={() => onKies([])}>
        {t('allergenen_opzoeken_geen_allergenen')}
      </button>
      {ALLERGEEN_KEYS.map(a => {
        const aan = huidig.includes(a)
        return (
          <button key={a} type="button" aria-pressed={aan} className={knop(aan)}
            onClick={() => onKies(aan ? huidig.filter(x => x !== a) : [...huidig, a])}>
            {naamVan(a)}
          </button>
        )
      })}
    </div>
  )
}

const AllergenenOpzoeken: React.FC<AllergenenOpzoekenProps> = ({
  ingredientIds, ingredienten, setIng, heeftSleutel, auditLog, setAuditLog, onSluit,
}) => {
  // De ingrediënten zoals ze waren bij het openen; het voorstel volgt de
  // gluten-conventie van wat al beoordeeld is.
  const [start] = React.useState(() => {
    const perId = new Map((ingredienten || []).map(i => [Number(i.id), i] as const))
    const lijst = Array.from(new Set(ingredientIds.map(Number))).map(id => perId.get(id)).filter((i): i is Ingredient => !!i)
    const conventie = glutenConventie(ingredienten)
    return { lijst, conventie, voorstellen: lijst.map(i => regelVoorstel(i, conventie)) }
  })
  const [voorstellen, setVoorstellen] = React.useState<AllergeenVoorstel[]>(start.voorstellen)
  const voorstellenRef = React.useRef(voorstellen)
  voorstellenRef.current = voorstellen
  // Alleen wat iemand zelf aan- of uitvinkte; de rest volgt `voorgevinkt`.
  const [vinkjes, setVinkjes] = React.useState<Record<number, boolean>>({})
  const [bewerk, setBewerk] = React.useState<number | null>(null)
  const [claude, setClaude] = React.useState<ClaudeStand>({ status: 'rust' })
  const versie = React.useRef(0)
  React.useEffect(() => () => { versie.current++ }, [])

  const vraagClaude = React.useCallback(async () => {
    const ids = teVragen(voorstellenRef.current)
    if (!ids.length || !heeftSleutel) return
    const v = ++versie.current
    const perId = new Map(start.lijst.map(i => [Number(i.id), i] as const))
    setClaude({ status: 'bezig', aantal: ids.length })
    try {
      for (const stuk of inStukken(ids)) {
        const lijst = stuk.map(id => perId.get(id)).filter((i): i is Ingredient => !!i)
        const { data, model } = await voerScanUit(callClaudeProxy, {
          inhoud: [tekstBlok(allergeenScanPrompt(lijst, getLang(), start.conventie))],
          schema: allergeenScanSchema(), maxTokens: 12000, effort: 'medium',
        })
        if (v !== versie.current) return
        const uit = normaliseerAllergeenScan(data, stuk, start.conventie)
        setVoorstellen(prev => prev.map(x => metAiUitkomst(x, uit.get(x.ingredientId), model)))
      }
      setClaude({ status: 'klaar' })
    } catch (e) {
      if (v !== versie.current) return
      setClaude({ status: 'fout', fout: foutTekst(e) })
    }
  }, [heeftSleutel, start])

  React.useEffect(() => { void vraagClaude() }, [vraagClaude])

  const aangevinkt = (v: AllergeenVoorstel): boolean => overneembaar(v) && (vinkjes[v.ingredientId] ?? v.voorgevinkt)
  const gekozen = voorstellen.filter(aangevinkt)

  const kies = (id: number, lijst: Allergeen[]) => {
    setVoorstellen(prev => prev.map(x => (x.ingredientId === id ? metAanpassing(x, lijst) : x)))
    setVinkjes(prev => ({ ...prev, [id]: true }))
  }

  const neemOver = () => {
    if (!gekozen.length) return
    setIng(prev => neemVoorstellenOver(prev || [], gekozen, toelichtingVan))
    for (const v of gekozen) {
      const bron = bronVan(v)
      logAudit(auditLog, setAuditLog, {
        entiteit: 'Ingrediënt', entiteit_id: v.ingredientId, actie: 'gewijzigd',
        velden: { allergenen: { oud: v.huidig, nieuw: v.allergenen } },
        omschrijving: `Allergenen (${bron === 'claude' ? `Claude, ${v.model || ''}`.trim() : bron}): ${v.naam}`,
      })
    }
    onSluit()
  }

  const wachtOpClaude = teVragen(voorstellen).length

  return (
    <Blad titel={t('allergenen_opzoeken')} onSluit={onSluit} wide
      onKlaar={gekozen.length ? neemOver : undefined} klaarLabel={t('allergenen_opzoeken_overnemen')}>
      <div className="grid gap-3">
        <p className="text-sm text-gray-600">{t('allergenen_opzoeken_uitleg')}</p>

        {claude.status === 'bezig' && (
          <p role="status" className="text-sm text-gray-700">
            {claude.aantal === 1 ? t('allergenen_opzoeken_status_een') : t('allergenen_opzoeken_status').replace('{n}', String(claude.aantal))}
          </p>
        )}
        {claude.status === 'fout' && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="min-w-0 flex-1 break-words">{t('allergenen_opzoeken_fout').replace('{fout}', claude.fout)}</span>
            {wachtOpClaude > 0 && <Btn v="secondary" s="sm" onClick={() => { void vraagClaude() }}>{t('allergenen_opzoeken_opnieuw')}</Btn>}
          </div>
        )}
        {!heeftSleutel && wachtOpClaude > 0 && (
          <p className="text-sm text-gray-600">{t('allergenen_opzoeken_geen_sleutel')}</p>
        )}

        {!voorstellen.length ? (
          <p className="text-sm text-gray-500">{t('allergenen_opzoeken_leeg')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 border-y border-gray-100">
            {voorstellen.map(v => {
              const id = v.ingredientId
              const kan = overneembaar(v)
              const open = bewerk === id
              const zoekt = v.bron === 'geen' && !v.aangepast && claude.status === 'bezig'
              return (
                <li key={id} className="py-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  <input type="checkbox" className="t-checkbox mt-1 w-4 h-4"
                    checked={aangevinkt(v)} disabled={!kan}
                    aria-label={t('allergenen_opzoeken_overnemen_een').replace('{naam}', v.naam || t('lbl_naamloos'))}
                    onChange={e => setVinkjes(prev => ({ ...prev, [id]: e.target.checked }))} />
                  <div className="min-w-0 grid gap-1.5">
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-gray-900 break-words">{v.naam || t('lbl_naamloos')}</span>
                        {v.type && <span className="text-xs text-gray-500"> · {v.type}</span>}
                      </div>
                      <button type="button" onClick={() => setBewerk(open ? null : id)} aria-expanded={open}
                        className="flex-shrink-0 text-sm font-medium t-accent-text hover:underline min-h-tap md:min-h-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                        {open ? t('allergenen_opzoeken_aanpassen_klaar') : t('allergenen_opzoeken_aanpassen')}
                      </button>
                    </div>

                    {v.allergenen && !open && <Chips lijst={v.allergenen} />}
                    {open && <Kiezer naam={v.naam} lijst={v.allergenen} onKies={lijst => kies(id, lijst)} />}

                    {v.aangepast ? (
                      <p className="text-xs text-gray-500">{t('allergenen_opzoeken_aangepast')}</p>
                    ) : v.bron === 'regel' ? (
                      <p className="text-xs text-gray-500 break-words">{toelichtingVan(v)}</p>
                    ) : v.bron === 'claude' ? (
                      <>
                        <p className="text-xs text-gray-500 break-words">
                          {t('allergenen_opzoeken_claude')
                            .replace('{model}', modelNaam(v.model || ''))
                            .replace('{zekerheid}', t(`allergenen_zekerheid_${v.zekerheid}`))}
                          {v.toelichting ? ` · ${v.toelichting}` : ''}
                        </p>
                        {v.zekerheid === 'laag' && <p className="text-xs text-orange-700">{t('allergenen_opzoeken_laag')}</p>}
                      </>
                    ) : zoekt ? (
                      <p className="text-xs text-gray-500">{t('allergenen_opzoeken_zoekt')}</p>
                    ) : (
                      <p className="text-xs text-gray-500">{t('allergenen_opzoeken_kies_zelf')}</p>
                    )}

                    {v.huidig && (
                      <p className="text-xs text-gray-500">
                        {t('allergenen_opzoeken_nu').replace('{lijst}',
                          v.huidig.length ? v.huidig.map(naamVan).join(', ') : t('allergenen_opzoeken_geen_allergenen'))}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Blad>
  )
}

export default AllergenenOpzoeken
