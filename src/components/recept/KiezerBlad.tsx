import React from 'react'
import { t } from '../../i18n'
import Btn from '../ui/Btn'
import LegeStaat from '../ui/LegeStaat'
import Modal from '../ui/Modal'
import Onderblad from '../ui/Onderblad'
import SearchInput from '../ui/SearchInput'
import { useSmalScherm } from '../ui/useSmalScherm'

// De omlijsting van de kiezers (recept, product): een Modal op het bureau, een
// Onderblad op een telefoon, of — met `inline` — gewoon de lijst op de pagina.
// Bovenin altijd het zoekveld; de lijst eronder scrolt.

export interface KiezerBladProps {
  titel: string
  onSluit: () => void
  zoek: string
  onZoek: (z: string) => void
  zoekPlaceholder: string
  /** Als lijst op de pagina in plaats van als blad. */
  inline?: boolean
  /** Eén zin boven het zoekveld: waar de keuze over gaat. */
  intro?: React.ReactNode
  /** Een korte lijst: op een telefoon een laag blad in plaats van het hele scherm. */
  laag?: boolean
  children: React.ReactNode
}

const KiezerBlad: React.FC<KiezerBladProps> = ({ titel, onSluit, zoek, onZoek, zoekPlaceholder, inline = false, intro, laag = false, children }) => {
  const smal = useSmalScherm()
  const kop = (
    <div className="space-y-2">
      {intro && <p className="px-1 text-sm text-gray-600">{intro}</p>}
      <SearchInput value={zoek} onChange={onZoek} placeholder={zoekPlaceholder} />
    </div>
  )
  if (inline) {
    return <div className="space-y-3">{kop}{children}</div>
  }
  if (smal) {
    return (
      <Onderblad zelfstandig titel={titel} onAnnuleer={onSluit} vast={kop} laag={laag}>
        {children}
      </Onderblad>
    )
  }
  return (
    <Modal title={titel} onClose={onSluit} wide>
      <div className="space-y-3">
        {kop}
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain -mx-2 px-2" aria-label={titel}>
          {children}
        </div>
      </div>
    </Modal>
  )
}

/** Een kop boven een groep in een kiezer ("Jouw producten", "Seizoen / uit roulatie"). */
export const KiezerKop: React.FC<{ children: React.ReactNode; sub?: boolean }> = ({ children, sub = false }) => (
  <div className={`px-1 ${sub ? 'pt-3 pb-1 text-xs font-medium text-gray-500' : 'pt-4 first:pt-0 pb-1.5 text-sm font-semibold text-gray-800'}`}>
    {children}
  </div>
)

/** Een kiesbare regel: groot genoeg voor een duim, met een markering als hij al gekozen of gekoppeld is. */
export const KiezerRegel: React.FC<{
  onKies?: () => void
  disabled?: boolean
  gekozen?: boolean
  links?: React.ReactNode
  titel: React.ReactNode
  sub?: React.ReactNode
  rechts?: React.ReactNode
}> = ({ onKies, disabled = false, gekozen = false, links, titel, sub, rechts }) => (
  <button type="button" onClick={onKies} disabled={disabled} aria-current={gekozen ? 'true' : undefined}
    className={`w-full flex items-center gap-3 text-left px-3 py-2.5 min-h-[52px] rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] ${
      gekozen ? 't-panel' : 'border-transparent hover:bg-gray-50 active:bg-gray-100'
    } ${disabled ? 'cursor-default opacity-60 hover:bg-transparent' : ''}`}>
    {links}
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-gray-900 truncate">{titel}</span>
      {sub && <span className="block text-xs text-gray-500 truncate mt-0.5">{sub}</span>}
    </span>
    {rechts}
  </button>
)

/** Niets gevonden in een kiezer: zeggen, met de knop om het zoeken te wissen. */
export const KiezerNiets: React.FC<{ zoek: string; onWis: () => void; tekst?: string }> = ({ zoek, onWis, tekst }) => (
  <LegeStaat cls="my-2" icoon="search" titel={t('kiezer_niets_titel')}
    tekst={tekst || t('kiezer_niets_tekst').replace('{zoek}', zoek.trim())}>
    {zoek.trim() !== '' && <Btn v="secondary" s="sm" onClick={onWis}>{t('recipe_zoek_wissen')}</Btn>}
  </LegeStaat>
)

export default KiezerBlad
