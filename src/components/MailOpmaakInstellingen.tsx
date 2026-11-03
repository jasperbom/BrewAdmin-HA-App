import React from 'react'
import { t } from '../i18n'
import Segment from './ui/Segment'
import { MAIL_STIJL_KEUZES, mailLettertypenUrl } from '../utils/mailTemplate'
import type { MailStijlKeuze, MailStijlInst } from '../utils/mailTemplate'

// Instellingen → Bedrijf: de opmaak van alle mails aan klanten
// (`brewery_details.mail_stijl`, utils/mailTemplate.ts). Standaard volgt de
// stijl het thema van de app; de Craftery-stijl kan ook los gekozen worden.
// De lettertypes van de Craftery-stijl laden alleen uit een map die je zelf
// invult — de app zet er geen vast adres in.

interface MailOpmaakInstellingenProps {
  breweryDetails: any
  setBreweryDetails: (fn: (p: any) => any) => void
}

export default function MailOpmaakInstellingen({ breweryDetails, setBreweryDetails }: MailOpmaakInstellingenProps) {
  const inst: MailStijlInst = (breweryDetails as any)?.mail_stijl || {}
  const keuze: MailStijlKeuze = MAIL_STIJL_KEUZES.includes(inst.stijl as MailStijlKeuze) ? inst.stijl as MailStijlKeuze : 'thema'
  const zet = (patch: Partial<MailStijlInst>) =>
    setBreweryDetails((p: any) => ({...(p || {}), mail_stijl: {...((p || {}).mail_stijl || {}), ...patch}}))
  const url = String(inst.lettertypen_url || '')
  const urlFout = !!url.trim() && !mailLettertypenUrl(url)
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 break-inside-avoid" id="mail-opmaak">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('mail_opmaak_titel')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('mail_opmaak_uitleg')}</p>
      <div className="flex flex-col gap-2 mb-4">
        <span className="block text-xs font-medium text-gray-500">{t('mail_opmaak_stijl')}</span>
        <Segment<MailStijlKeuze> label={t('mail_opmaak_stijl')} waarde={keuze}
          opties={MAIL_STIJL_KEUZES.map(v => ({v, l: t(`mail_opmaak_stijl_${v}`)}))}
          onKies={(v) => zet({stijl: v})} />
        <p className="text-xs text-gray-500">{t(`mail_opmaak_stijl_${keuze}_uitleg`)}</p>
      </div>
      <div className="max-w-xl">
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('mail_opmaak_lettertypen')}</label>
        <input type="url" value={url} placeholder="https://…/fonts/"
          onChange={(e) => zet({lettertypen_url: e.target.value})}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full t-input bg-white font-mono" />
        <p className="text-xs text-gray-400 mt-1">{t('mail_opmaak_lettertypen_uitleg')}</p>
        {urlFout && <p className="text-xs text-orange-700 mt-1">{t('mail_opmaak_lettertypen_fout')}</p>}
      </div>
    </div>
  )
}
