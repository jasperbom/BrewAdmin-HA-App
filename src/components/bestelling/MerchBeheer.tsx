import React, { useState } from 'react'
import { t } from '../../i18n'
import { fmt, fmtD } from '../../utils/format'
import Btn from '../ui/Btn'
import Inp from '../ui/Inp'
import SectionHeader from '../ui/SectionHeader'
import RowActions, { type RowActie } from '../ui/RowActions'
import {
  type MerchArtikel, type MerchMutatie, volgtVoorraad, merchVoorraad, merchVoorraadWaarde, merchLogVoorArtikel,
} from '../../utils/merch'

// Bedrag in de lijst: bewerkt lokaal en schrijft pas bij verlaten/Enter weg,
// zodat een halfgetypt bedrag ("7,") niet elke toetsaanslag door de store gaat.
const MerchGetal: React.FC<{ waarde?: number; onSave: (v: number | undefined) => void; label: string }> = ({ waarde, onSave, label }) => {
  const [draft, setDraft] = React.useState(waarde != null ? String(waarde) : '')
  React.useEffect(() => { setDraft(waarde != null ? String(waarde) : '') }, [waarde])
  const bewaar = () => {
    const tekst = draft.trim().replace(',', '.')
    onSave(tekst === '' ? undefined : (Number(tekst) || 0))
  }
  return (
    <input type="text" inputMode="decimal" value={draft} placeholder="—" aria-label={label}
      onChange={e => setDraft(e.target.value)}
      onBlur={bewaar}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-20 border border-gray-200 rounded px-1.5 py-1 min-h-tap sm:min-h-0 text-sm text-right bg-white t-input outline-none" />
  )
}

export interface MerchBeheerProps {
  merchArtikelen: MerchArtikel[]
  merchVoorraadLog: MerchMutatie[]
  /** WooCommerce aan: de productkaart en "meesturen bij de voorraadpush". */
  wcAan: boolean
  btwOpts: Array<{ v: string; l: string }>
  stdBtw: number
  onWijzig: (id: number, patch: Partial<MerchArtikel>) => void
  onMutatie: (m: MerchArtikel) => void
  onWc: (m: MerchArtikel) => void
  onVoegToe: (item: { sku: string; naam: string }) => void
  /** Uit de lijst halen — de pagina doet dat met een terugweg (UndoBar). */
  onVerwijder: (m: MerchArtikel) => void
}

/**
 * Merch-artikelen: wat de brouwerij verkoopt maar niet als bier levert. Staat
 * bij Bestellingen omdat de lijst tijdens het orderwerk ontstaat — elke
 * "markeer als merch" op een orderregel komt hierin. Bureau: een tabel; een
 * telefoon: een kaart per artikel (geen tabel die zijwaarts scrolt). Per
 * artikel één zichtbare actie (Voorraad), de rest in ⋯.
 */
const MerchBeheer: React.FC<MerchBeheerProps> = (p) => {
  const [open, setOpen] = useState(false)
  const [logOpen, setLogOpen] = useState<number | null>(null)
  const [form, setForm] = useState({ sku: '', naam: '' })
  const [fout, setFout] = useState('')
  const lijst = (p.merchArtikelen || []).filter(Boolean)
  const waarde = merchVoorraadWaarde(lijst)

  const voegToe = () => {
    const sku = form.sku.trim()
    const naam = form.naam.trim()
    if (!sku && !naam) { setFout(t('err_merch_leeg')); return }
    setFout('')
    p.onVoegToe({ sku, naam })
    setForm({ sku: '', naam: '' })
  }

  const acties = (m: MerchArtikel, mutaties: MerchMutatie[]): { primair?: RowActie; acties: RowActie[] } => ({
    primair: volgtVoorraad(m) ? { id: 'mutatie', label: t('merch_mutatie_knop'), title: t('merch_mutatie_titel'), onClick: () => p.onMutatie(m) } : undefined,
    acties: [
      ...(p.wcAan && (m.sku || m.naam) ? [{ id: 'wc', label: t('wc_btn_kaart'), onClick: () => p.onWc(m) }] : []),
      ...(mutaties.length ? [{ id: 'log', label: t('merch_log_titel'), onClick: () => setLogOpen(v => v === m.id ? null : m.id) }] : []),
      { id: 'verwijder', label: t('btn_delete'), soort: 'gevaar' as const, onClick: () => p.onVerwijder(m) },
    ],
  })

  const voorraadTekst = (m: MerchArtikel) => volgtVoorraad(m)
    ? <span className={`font-mono font-semibold ${merchVoorraad(m) <= 0 ? 'text-red-600' : 'text-gray-700'}`}>{merchVoorraad(m)}×</span>
    : <span className="text-xs text-gray-500">{t('merch_geen_voorraad')}</span>

  const btwKeuze = (m: MerchArtikel) => (
    <select value={String(m.btw_pct ?? p.stdBtw)} aria-label={t('manual_order_btw')}
      onChange={e => p.onWijzig(m.id, { btw_pct: Number(e.target.value) })}
      className="border border-gray-200 rounded px-1.5 py-1 min-h-tap sm:min-h-0 text-sm bg-white t-input outline-none">
      {p.btwOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )

  const logLijst = (mutaties: MerchMutatie[]) => (
    <div className="space-y-0.5 max-h-48 overflow-y-auto overflow-x-hidden">
      <div className="text-xs font-semibold text-gray-500 mb-1">{t('merch_log_titel')}</div>
      {mutaties.map((r: MerchMutatie) => (
        <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600 min-w-0">
          <span className="text-gray-500 w-20 flex-shrink-0">{fmtD(r.datum)}</span>
          <span className={`font-mono font-semibold w-12 text-right flex-shrink-0 ${r.aantal < 0 ? 'text-red-600' : 'text-green-600'}`}>
            {r.aantal > 0 ? '+' : ''}{r.aantal}
          </span>
          <span className="w-24 flex-shrink-0 truncate">{t(`merch_reden_${r.reden}`, r.reden)}</span>
          <span className="text-gray-500 flex-1 min-w-0 truncate">{r.referentie || r.omschrijving || ''}</span>
          <span className="text-gray-500 font-mono flex-shrink-0">→ {r.stand}×</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="bg-white rounded-xl shadow-card mt-4 overflow-hidden">
      <SectionHeader
        title={t('merch_titel')}
        open={open}
        onToggle={() => setOpen(o => !o)}
        info={waarde > 0 ? `${lijst.length} · ${t('merch_voorraadwaarde')} ${fmt(waarde)}` : `${lijst.length}`}
      />
      {open && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">{t('merch_uitleg')}</p>
          {lijst.length === 0 ? <p className="text-sm text-gray-500 italic">{t('merch_leeg')}</p> : (<>
            {/* Bureau: tabel */}
            <table className="hidden md:table w-full text-sm">
              <thead className="text-xs text-gray-500 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('merch_naam')}</th>
                  <th className="px-3 py-2 text-center" title={t('merch_voorraad_volgen_tip')}>{t('merch_voorraad_volgen')}</th>
                  <th className="px-3 py-2 text-right">{t('merch_voorraad')}</th>
                  <th className="px-3 py-2 text-right">{t('merch_inkoopprijs')}</th>
                  <th className="px-3 py-2 text-right">{t('merch_verkoopprijs')}</th>
                  <th className="px-3 py-2 text-right">{t('manual_order_btw')}</th>
                  {p.wcAan && <th className="px-3 py-2 text-center" title={t('merch_wc_push_tip')}>WC</th>}
                  <th className="px-3 py-2 text-right"><span className="sr-only">{t('btn_meer_acties')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lijst.map(m => {
                  const volgt = volgtVoorraad(m)
                  const mutaties = merchLogVoorArtikel(p.merchVoorraadLog, m.id)
                  const a = acties(m, mutaties)
                  return (
                    <React.Fragment key={m.id}>
                      <tr className={volgt && merchVoorraad(m) <= 0 ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{m.naam || m.sku}</span>
                          {m.sku && m.naam && <span className="ml-1 font-mono text-xs text-gray-500">[{m.sku}]</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={volgt} aria-label={t('merch_voorraad_volgen')}
                            onChange={e => p.onWijzig(m.id, { voorraad_volgen: e.target.checked })}
                            className="w-4 h-4 rounded border-gray-300 t-checkbox" />
                        </td>
                        <td className="px-3 py-2 text-right">{voorraadTekst(m)}</td>
                        <td className="px-3 py-2 text-right">
                          {volgt ? <MerchGetal label={t('merch_inkoopprijs')} waarde={m.inkoopprijs} onSave={v => p.onWijzig(m.id, { inkoopprijs: v })} /> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <MerchGetal label={t('merch_verkoopprijs')} waarde={m.verkoopprijs} onSave={v => p.onWijzig(m.id, { verkoopprijs: v })} />
                        </td>
                        <td className="px-3 py-2 text-right">{btwKeuze(m)}</td>
                        {p.wcAan && (
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={volgt && m.wc_push !== false} disabled={!volgt}
                              title={t('merch_wc_push_tip')} aria-label={t('merch_wc_push_tip')}
                              onChange={e => p.onWijzig(m.id, { wc_push: e.target.checked })}
                              className="w-4 h-4 rounded border-gray-300 t-checkbox disabled:opacity-30" />
                          </td>
                        )}
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <RowActions primair={a.primair} acties={a.acties} />
                        </td>
                      </tr>
                      {logOpen === m.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={p.wcAan ? 8 : 7} className="px-3 py-2">{logLijst(mutaties)}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
            {/* Telefoon: een kaart per artikel */}
            <ul className="md:hidden space-y-2">
              {lijst.map(m => {
                const volgt = volgtVoorraad(m)
                const mutaties = merchLogVoorArtikel(p.merchVoorraadLog, m.id)
                const a = acties(m, mutaties)
                return (
                  <li key={m.id} className={`rounded-lg border p-3 ${volgt && merchVoorraad(m) <= 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 break-words">{m.naam || m.sku}</div>
                        {m.sku && m.naam && <div className="font-mono text-xs text-gray-500 break-all">{m.sku}</div>}
                      </div>
                      <RowActions primair={a.primair} acties={a.acties} v="kaart" />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 min-h-tap">
                      <input type="checkbox" checked={volgt}
                        onChange={e => p.onWijzig(m.id, { voorraad_volgen: e.target.checked })}
                        className="w-5 h-5 rounded border-gray-300 t-checkbox" />
                      <span className="flex-1">{t('merch_voorraad_volgen')}</span>
                      {voorraadTekst(m)}
                    </label>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-gray-500">
                      {volgt ? (
                        <label className="flex flex-col gap-1">{t('merch_inkoopprijs')}
                          <MerchGetal label={t('merch_inkoopprijs')} waarde={m.inkoopprijs} onSave={v => p.onWijzig(m.id, { inkoopprijs: v })} />
                        </label>
                      ) : <span />}
                      <label className="flex flex-col gap-1">{t('merch_verkoopprijs')}
                        <MerchGetal label={t('merch_verkoopprijs')} waarde={m.verkoopprijs} onSave={v => p.onWijzig(m.id, { verkoopprijs: v })} />
                      </label>
                      <label className="flex flex-col gap-1">{t('manual_order_btw')}{btwKeuze(m)}</label>
                    </div>
                    {p.wcAan && (
                      <label className={`mt-1 flex items-center gap-2 text-sm text-gray-700 min-h-tap ${volgt ? '' : 'opacity-40'}`}>
                        <input type="checkbox" checked={volgt && m.wc_push !== false} disabled={!volgt}
                          onChange={e => p.onWijzig(m.id, { wc_push: e.target.checked })}
                          className="w-5 h-5 rounded border-gray-300 t-checkbox" />
                        <span className="flex-1">{t('merch_wc_push_label')}</span>
                      </label>
                    )}
                    {logOpen === m.id && <div className="mt-2 border-t border-gray-100 pt-2">{logLijst(mutaties)}</div>}
                  </li>
                )
              })}
            </ul>
          </>)}
          <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-gray-100">
            <div className="flex-1 min-w-[10rem]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">{t('merch_sku')}</label>
              <Inp value={form.sku} onChange={(v: string) => setForm(f => ({ ...f, sku: v }))} placeholder={t('ph_merch_sku')} />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">{t('merch_naam')}</label>
              <Inp value={form.naam} onChange={(v: string) => setForm(f => ({ ...f, naam: v }))} placeholder={t('ph_merch_naam')} />
            </div>
            <Btn v="secondary" onClick={voegToe}>{t('btn_add')}</Btn>
          </div>
          {fout && <div role="alert" className="text-sm text-red-700">{fout}</div>}
        </div>
      )}
    </div>
  )
}

export default MerchBeheer
