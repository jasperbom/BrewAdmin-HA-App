/**
 * KratkaartExport.tsx
 * De kratkaart (utils/kratkaart.ts) afdrukken: vier dezelfde kaarten op een
 * A4, om te knippen en op de kratten of fusten te leggen. Grote lotcode,
 * het bier, de verpakking, de afvuldag en de THT, en zolang het zo is:
 * "Quarantaine — niet verkopen vóór …" en "Etiket volgt".
 */
import { t } from '../i18n'
import { fmtDatumDoc } from '../utils/format'
import { esc, openPrint } from './PakbonExport'
import type { Kratkaart } from '../utils/kratkaart'

const KRAT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  @page { size: A4; margin: 8mm; }
  .vel { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 0;
    width: 194mm; height: 281mm; }
  .kaart { border: 1px dashed #9ca3af; padding: 9mm 8mm; display: flex; flex-direction: column; gap: 3mm; }
  .lbl { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.6px; color: #555; }
  .lot { font-family: 'Courier New', monospace; font-size: 34pt; font-weight: bold; line-height: 1; }
  .bier { font-size: 16pt; font-weight: bold; }
  .regel { font-size: 11.5pt; }
  .regel span { color: #555; }
  .stop { margin-top: auto; border: 2.5px solid #111; padding: 3mm; font-size: 13pt; font-weight: bold;
    text-align: center; }
  .stop.af { border-color: #b91c1c; color: #b91c1c; }
  .etiket { font-size: 11pt; font-weight: bold; text-align: center; border: 1px solid #111; padding: 2mm; }
`

const kaartHtml = (k: Kratkaart): string => {
  const regels = [
    k.verpakking || k.aantal
      ? `<div class="regel">${esc([k.verpakking, k.aantal ? t('krat_aantal').replace('{n}', String(k.aantal)) : '']
          .filter(Boolean).join(' · '))}</div>` : '',
    k.afgevuld_op ? `<div class="regel"><span>${esc(t('krat_afgevuld'))}</span> ${esc(fmtDatumDoc(k.afgevuld_op))}</div>` : '',
    `<div class="regel"><span>${esc(t('krat_tht'))}</span> ${k.tht ? esc(fmtDatumDoc(k.tht)) : '—'}</div>`,
  ].join('')
  const stop = k.afgekeurd
    ? `<div class="stop af">${esc(t('krat_afgekeurd'))}</div>`
    : k.quarantaine_tot
    ? `<div class="stop">${esc(t('krat_quarantaine').replace('{datum}', fmtDatumDoc(k.quarantaine_tot)))}</div>`
    : ''
  return `<div class="kaart">
    <div class="lbl">${esc(t('haccp_sessie_lotcode'))}</div>
    <div class="lot">${esc(k.lotcode)}</div>
    <div class="bier">${esc(k.bier)}${k.batch ? ` <span style="font-weight:normal;color:#555">#${esc(k.batch)}</span>` : ''}</div>
    ${regels}
    ${stop}
    ${k.etiket_volgt && !k.afgekeurd ? `<div class="etiket">${esc(t('krat_etiket_volgt'))}</div>` : ''}
  </div>`
}

/** Vier dezelfde kaarten op één vel. */
export const kratkaartHtml = (k: Kratkaart): string =>
  `<div class="vel">${[0, 1, 2, 3].map(() => kaartHtml(k)).join('')}</div>`

export const printKratkaart = (k: Kratkaart, onGeblokkeerd?: (melding: string) => void): boolean =>
  openPrint(kratkaartHtml(k), `${t('krat_titel')} ${k.lotcode}`, KRAT_CSS, onGeblokkeerd)
