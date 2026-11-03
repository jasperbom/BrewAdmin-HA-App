import { t } from '../i18n'
import { AFHAAL_HERINNERING_NA_DAGEN } from '../utils/levering'
import { afhaalSchema, AFHAAL_HERINNERING_MAX_AANTAL, AFHAAL_TERMIJN_MAX_DAGEN } from '../utils/orderMail'
import type { MailSjabloon } from '../utils/orderMail'

// Instellingen → Bedrijf → E-mailtemplates → Afhaalherinnering: op welke dagen
// de herinneringen gaan (tot drie) en na hoeveel dagen de bestelling vervalt
// (de afhaaltermijn). Bewaard in `mail_templates.afhaal_herinnering` (`dagen`,
// `annuleren_na`); `afhaalSchema` in utils/orderMail.ts maakt er het schema van.
// Een vakje blijft staan waar je het invult: lege plekken tellen niet mee.

interface Props {
  waarde: MailSjabloon | undefined
  onChange: (patch: Partial<MailSjabloon>) => void
}

const veld = 'border border-gray-300 rounded px-2 py-1 text-sm w-16 t-input bg-white'

const getal = (s: string): number | null => (s === '' ? null : Math.round(Number(s)))

export default function AfhaalHerinneringVelden({ waarde, onChange }: Props) {
  const ruw = Array.isArray(waarde?.dagen) ? waarde!.dagen as ReadonlyArray<number | null>
    : waarde?.dagen != null ? [waarde.dagen as number] : []
  const plekken = Array.from({ length: AFHAAL_HERINNERING_MAX_AANTAL }, (_, i) => ruw[i] ?? null)
  const zetDag = (i: number, s: string) => {
    const nieuw = plekken.slice()
    nieuw[i] = getal(s)
    while (nieuw.length && nieuw[nieuw.length - 1] == null) nieuw.pop()
    onChange({ dagen: nieuw.length ? nieuw : undefined })
  }
  const schema = afhaalSchema({ afhaal_herinnering: waarde })
  // Een herinnering op of na de termijn vervalt (afhaalSchema): zeg dat erbij.
  const ingevuld = plekken.filter((n): n is number => n != null && n >= 1 && n <= 60)
  const vervallen = schema.annulerenNa != null && ingevuld.some(n => n >= schema.annulerenNa!)

  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-gray-700">{t('settings_mail_afhaal_herinnering_dagen')}</span>
          {plekken.map((n, i) => (
            <input key={i} type="number" min={1} max={60} step={1} inputMode="numeric"
              aria-label={t('settings_mail_afhaal_herinnering_nr').replace('{n}', String(i + 1))}
              value={n ?? ''}
              placeholder={i === 0 ? String(AFHAAL_HERINNERING_NA_DAGEN) : ''}
              onChange={e => zetDag(i, e.target.value)}
              className={veld} />
          ))}
          <span className="text-sm text-gray-700">{t('lbl_dagen')}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {t('settings_mail_afhaal_herinnering_dagen_hint').replace('{n}', String(AFHAAL_HERINNERING_NA_DAGEN))}
        </p>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor="mail-afhaal-termijn" className="text-sm font-medium text-gray-700">
            {t('settings_mail_afhaal_termijn')}
          </label>
          <input id="mail-afhaal-termijn" type="number" min={1} max={AFHAAL_TERMIJN_MAX_DAGEN} step={1} inputMode="numeric"
            value={waarde?.annuleren_na ?? ''}
            onChange={e => onChange({ annuleren_na: getal(e.target.value) ?? undefined })}
            className={veld} />
          <span className="text-sm text-gray-700">{t('lbl_dagen')}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">{t('settings_mail_afhaal_termijn_hint')}</p>
        {vervallen && <p className="text-xs text-orange-700 mt-1">{t('settings_mail_afhaal_termijn_vervalt')}</p>}
      </div>
    </div>
  )
}
