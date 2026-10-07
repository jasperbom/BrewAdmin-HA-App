import React from 'react'
import { t } from '../../../i18n'
import Modal from '../../../components/ui/Modal'
import Inp from '../../../components/ui/Inp'
import Btn from '../../../components/ui/Btn'
import RowActions from '../../../components/ui/RowActions'
import type { Locatie } from '../../../types'

// ── Voorraadlocaties beheren ────────────────────────────────────────────────
// Eén actie per locatie (Bewerken), verwijderen achter ⋯ met de vraag in de
// regel zelf. Een locatie met voorraad of de AGP zelf kan niet weg; dat staat
// dan onder de regel in plaats van in een alert-venster.

export interface LocatieInvoer {
  id?: number
  naam: string
  adres: string
  opmerking: string
}

interface LocatiesModalProps {
  locaties: Locatie[]
  /** Ligt er op deze locatie nog bier? Dan kan hij niet weg. */
  heeftVoorraad: (id: number) => boolean
  onOpslaan: (invoer: LocatieInvoer) => void
  onVerwijder: (id: number) => void
  onSluit: () => void
}

const LEEG: LocatieInvoer = { naam: '', adres: '', opmerking: '' }

const LocatiesModal: React.FC<LocatiesModalProps> = ({ locaties, heeftVoorraad, onOpslaan, onVerwijder, onSluit }) => {
  const [form, setForm] = React.useState<LocatieInvoer>(LEEG)
  const [naamFout, setNaamFout] = React.useState('')
  const [vraagId, setVraagId] = React.useState<number | null>(null)
  const [rijFout, setRijFout] = React.useState<{ id: number; tekst: string } | null>(null)
  const naamId = React.useId()

  const bewerk = (l: Locatie) => {
    setForm({ id: l.id, naam: l.naam || '', adres: l.adres || '', opmerking: l.opmerking || '' })
    setNaamFout('')
    setRijFout(null)
    setVraagId(null)
    // Het formulier staat onder de lijst: op een telefoon valt het buiten
    // beeld. Naar het naamveld, zodat zichtbaar is wát er nu bewerkt wordt.
    requestAnimationFrame(() => {
      const el = document.getElementById(naamId)
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el?.focus({ preventScroll: true })
    })
  }

  const vraagVerwijderen = (l: Locatie) => {
    setRijFout(null)
    if (l.is_agp) { setRijFout({ id: l.id, tekst: t('agp_err_agp_niet_verwijderen') }); return }
    if (heeftVoorraad(l.id)) { setRijFout({ id: l.id, tekst: t('agp_err_locatie_in_gebruik') }); return }
    setVraagId(l.id)
  }

  const opslaan = () => {
    const naam = form.naam.trim()
    if (!naam) { setNaamFout(t('agp_err_naam_verplicht')); return }
    onOpslaan({ ...form, naam })
  }

  return (
    <Modal title={t('agp_locaties_beheren')} onClose={onSluit}>
      <div className="space-y-4 text-sm">
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">{t('agp_bestaande_locaties')}</div>
          <ul className="divide-y divide-gray-100">
            {(locaties || []).map(l => (
              <li key={l.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 break-words">
                      {l.naam}
                      {l.is_agp ? <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">AGP</span> : null}
                    </div>
                    {l.adres && <div className="text-xs text-gray-500 break-words">{l.adres}</div>}
                  </div>
                  {vraagId === l.id ? (
                    <span role="group" aria-label={t('agp_confirm_loc_verwijderen')} className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="text-sm text-gray-700 font-medium">{t('agp_confirm_loc_verwijderen')}</span>
                      <button type="button"
                        ref={el => el?.focus()}
                        onClick={() => { setVraagId(null); onVerwijder(l.id); if (form.id === l.id) setForm(LEEG) }}
                        className="rounded-lg font-semibold text-sm px-3 min-h-[40px] sm:min-h-[32px] bg-red-600 hover:bg-red-700 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                        {t('lbl_ja')}
                      </button>
                      <button type="button" onClick={() => setVraagId(null)}
                        className="rounded-lg font-medium text-sm px-3 min-h-[40px] sm:min-h-[32px] bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)]">
                        {t('btn_cancel')}
                      </button>
                    </span>
                  ) : (
                    <RowActions
                      primair={{ id: 'bewerk', label: t('btn_edit'), onClick: () => bewerk(l) }}
                      acties={l.is_agp ? [] : [{ id: 'verwijder', label: t('btn_delete'), soort: 'gevaar', onClick: () => vraagVerwijderen(l) }]}
                    />
                  )}
                </div>
                {rijFout?.id === l.id && <p role="alert" className="mt-1 text-xs text-red-700">{rijFout.tekst}</p>}
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-800">{form.id ? t('agp_locatie_bewerken') : t('agp_locatie_nieuw')}</div>
          <Inp id={naamId} label={t('lbl_naam')} value={form.naam} onChange={(v: string) => { setNaamFout(''); setForm(f => ({ ...f, naam: v })) }} />
          {naamFout && <p role="alert" className="text-xs text-red-700">{naamFout}</p>}
          <Inp label={t('lbl_adres')} value={form.adres} onChange={(v: string) => setForm(f => ({ ...f, adres: v }))} />
          <Inp label={t('lbl_opmerking')} value={form.opmerking} onChange={(v: string) => setForm(f => ({ ...f, opmerking: v }))} />
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {/* Tijdens bewerken zet Annuleren het formulier terug op een
                nieuwe locatie; anders sluit het het venster. */}
            <Btn v="secondary" onClick={form.id ? () => { setForm(LEEG); setNaamFout('') } : onSluit}>{t('btn_cancel')}</Btn>
            <Btn onClick={opslaan}>{t('btn_save')}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default LocatiesModal
