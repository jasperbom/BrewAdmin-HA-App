/**
 * BatchRapportExport.tsx
 * Het batchdossier als document: van `BatchRapport` (utils/batchRapport.ts)
 * naar print-HTML, een printvenster en een PDF-download.
 *
 * Alle inhoud komt uit het rapport — hier wordt niets bijgerekend. Wat hier
 * wél gebeurt is de opmaak: welke hoofdstukken op papier komen, in welke
 * volgorde, en welke blokken bij het knippen van de PDF heel moeten blijven
 * (`.blok`, zie `utils/pdfPaginering.ts`).
 *
 * Een hoofdstuk zonder inhoud komt er niet in. Een dossier dat zes keer
 * "geen gegevens" zegt leest als een klacht over de brouwer; wat er niet is,
 * hoort er gewoon niet te staan. De vaste uitzondering is de kop met de
 * kerncijfers — die is het dossier.
 */
import { t } from '../i18n'
import { fmtEuroDoc, fmtDatumDoc, fmtQty } from '../utils/format'
import { DOC_CSS, esc, breweryBlock, openPrint } from './PakbonExport'
import { htmlNaarPdfDownload } from '../utils/pdf'
import { rapportBestandsnaam } from '../utils/batchRapport'
import type {
  BatchRapport, RapportAfvulling, RapportIngredient, RapportMeting,
  RapportParaaf, RapportSessie, RapportVrijgave,
} from '../utils/batchRapport'

// Extra opmaak bovenop de gedeelde documentstijl. Bewust karig: het dossier
// is een archiefstuk, geen folder. `.blok` markeert wat bij het knippen van
// de PDF heel moet blijven.
const DOSSIER_CSS = `${DOC_CSS}
  /* Ruimere rijen dan de pakbon/factuur. Die zijn één pagina en gaan naar de
     printer; het dossier wordt door html2canvas in beeld omgezet, en die zet
     tekst een paar pixels lager dan de browser. Met de krappe regelhoogte van
     de documentstijl loopt de onderkant van de letters dan tegen de
     scheidingslijn van de volgende rij aan. Deze lucht vangt dat verschil op —
     en een dossier van meerdere pagina's leest er toch prettiger door. */
  th { padding: 6px 6px 7px; line-height: 1.35; }
  td { padding: 6px 6px 7px; line-height: 1.5; }
  /* Kolommen die nooit mogen afbreken: een lotcode of een datum over twee
     regels is in een archiefstuk onleesbaar. */
  .nw { white-space: nowrap; }
  /* Kolomkoppen staan in klein-kapitaal; "pH" is geen afkorting en wordt daar
     "PH", wat iets anders betekent. */
  .kk-uit { text-transform: none; }
  .sec { margin: 0 0 6mm; }
  .sec-title { font-size: 11pt; font-weight: bold; color: #111; border-bottom: 1px solid #d1d5db;
    padding-bottom: 1.5mm; margin-bottom: 3mm; }
  .cijfers { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 6mm; }
  .cijfer { border: 1px solid #e5e7eb; border-radius: 2mm; padding: 2.5mm 4mm; min-width: 28mm; }
  .cijfer .cl { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
  .cijfer .cv { font-size: 13pt; font-weight: bold; color: #111; }
  .tl { display: flex; flex-wrap: wrap; gap: 0; margin-bottom: 5mm; }
  .tl-stap { flex: 1; min-width: 32mm; border-top: 2px solid #9ca3af; padding: 2mm 3mm 0 0; }
  .tl-stap .tn { font-size: 9.5pt; font-weight: bold; color: #111; }
  .tl-stap .td { font-size: 9pt; color: #555; }
  .kv { display: flex; flex-wrap: wrap; column-gap: 8mm; row-gap: 1mm; font-size: 9.5pt; }
  .kv div span { color: #888; }
  .kaart { border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm 4mm; margin-bottom: 3mm; }
  .kaart-kop { display: flex; justify-content: space-between; gap: 4mm; align-items: baseline;
    font-weight: bold; font-size: 10.5pt; color: #111; margin-bottom: 1.5mm; }
  .ok { color: #065f46; }
  .nok { color: #b91c1c; font-weight: bold; }
  .afw { border-left: 3px solid #dc2626; }
  .notitie { font-size: 9.5pt; line-height: 1.55; border-left: 2px solid #e5e7eb;
    padding-left: 3mm; margin-bottom: 2.5mm; }
  .notitie .nts { color: #888; font-size: 8.5pt; }
  .doc-foot { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 3mm;
    font-size: 8.5pt; color: #888; }
  @media print { .blok { page-break-inside: avoid; } }
`

const fmtEuro = fmtEuroDoc
const fmtDate = fmtDatumDoc

const LEEG = '—'

/** Datum met tijd uit een ISO-timestamp; leeg blijft leeg. */
const fmtMoment = (iso: string): string => {
  const s = String(iso || '')
  if (!s) return LEEG
  const d = new Date(s.length <= 10 ? `${s}T00:00` : s)
  if (isNaN(d.getTime())) return esc(s)
  const datum = fmtDate(s.slice(0, 10))
  return s.length <= 10 ? datum : `${datum} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Begin en eind van een afvulsessie op één regel. Een sessie loopt bijna
 *  altijd binnen één dag; de datum twee keer noemen ("20-06-2026 09:00 –
 *  20-06-2026 16:00") maakt de kolom onnodig breed en breekt hem af. */
const fmtPeriode = (start: string, eind: string): string => {
  const van = fmtMoment(start)
  if (!eind) return van
  const zelfdeDag = start.slice(0, 10) === eind.slice(0, 10)
  const tot = zelfdeDag && eind.length > 10 ? fmtMoment(eind).split(' ').slice(1).join(' ') : fmtMoment(eind)
  return `${van} – ${tot}`
}

const getalOfLeeg = (v: number | null | undefined, achtervoegsel = ''): string =>
  v == null ? LEEG : `${fmtQty(v)}${achtervoegsel}`

const paraafTekst = (p: RapportParaaf): string =>
  p.gebruiker ? `${p.gebruiker}${p.tijdstip ? ` · ${fmtMoment(p.tijdstip)}` : ''}` : LEEG

const jaNee = (ok: boolean): string =>
  `<span class="${ok ? 'ok' : 'nok'}">${ok ? '✓' : '✕'}</span>`

const sectie = (titel: string, inhoud: string): string =>
  inhoud ? `<div class="sec"><div class="sec-title">${titel}</div>${inhoud}</div>` : ''

/** Tabel met kop; elke rij is een `.blok` zodat de PDF hem niet doormidden
 *  knipt. Een lege body levert geen tabel op — de sectie verdwijnt dan. */
const tabel = (koppen: Array<{label: string, r?: boolean, cls?: string}>, rijen: string[]): string =>
  rijen.length
    ? `<table><thead><tr>${koppen.map(k => {
        const cls = [k.r ? 'r' : '', k.cls || ''].filter(Boolean).join(' ')
        return `<th${cls ? ` class="${cls}"` : ''}>${k.label}</th>`
      }).join('')}</tr></thead>
       <tbody>${rijen.join('')}</tbody></table>`
    : ''

// ── Hoofdstukken ────────────────────────────────────────────────────────────

const kerncijferBlok = (r: BatchRapport): string => {
  const k = r.kern
  const cijfers: Array<{l: string, v: string}> = [
    {l: t('batch_info_og'), v: k.og != null ? String(k.og) : LEEG},
    {l: t('batch_info_fg'), v: k.fg != null ? String(k.fg) : LEEG},
    {l: t('batch_info_alcohol'), v: k.abv != null ? `${k.abv}%` : LEEG},
    {l: t('flow_sum_rendement'), v: k.rendementPct != null ? `${k.rendementPct.toFixed(0)}%` : LEEG},
    {l: t('flow_sum_vergist'), v: `${fmtQty(k.literVergist)} L`},
    {l: t('flow_sum_afgevuld'), v: `${fmtQty(k.literAfgevuld)} L`},
    {l: t('flow_sum_verlies'), v: `${fmtQty(k.literVerlies)} L`},
    {l: t('flow_sum_stuks'), v: String(k.stuks)},
  ]
  return `<div class="cijfers blok">${cijfers.map(c =>
    `<div class="cijfer"><div class="cl">${esc(c.l)}</div><div class="cv">${esc(c.v)}</div></div>`).join('')}</div>`
}

const tijdlijnBlok = (r: BatchRapport): string => {
  const tl = r.tijdlijn
  const dagen = (n: number | null) => n == null ? '' : ` · ${t('flow_tijdlijn_dagen').replace('{n}', String(n))}`
  const stappen: Array<{titel: string, waarde: string}> = [
    {titel: t('flow_tijdlijn_brouwdag'), waarde: tl.brouwdatum ? fmtDate(tl.brouwdatum) : LEEG},
    {titel: t('flow_tijdlijn_vergisten'), waarde: (tl.vergistStart ? fmtDate(tl.vergistStart) : LEEG) + dagen(tl.vergistDagen)},
  ]
  if (tl.conditioneerStart || tl.conditioneerDagen != null) {
    stappen.push({
      titel: t('flow_tijdlijn_conditioneren'),
      waarde: (tl.conditioneerStart ? fmtDate(tl.conditioneerStart) : LEEG) + dagen(tl.conditioneerDagen),
    })
  }
  stappen.push({titel: t('flow_tijdlijn_verpakt'), waarde: tl.verpaktDatum ? fmtDate(tl.verpaktDatum) : LEEG})
  if (!tl.brouwdatum && !tl.vergistStart && !tl.verpaktDatum) return ''
  const totaal = tl.totaalDagen != null
    ? `<div class="kv blok"><div><span>${esc(t('batchdossier_doorlooptijd'))}:</span> ${esc(t('flow_tijdlijn_dagen').replace('{n}', String(tl.totaalDagen)))}</div></div>`
    : ''
  return `<div class="tl blok">${stappen.map(s =>
    `<div class="tl-stap"><div class="tn">${esc(s.titel)}</div><div class="td">${esc(s.waarde)}</div></div>`).join('')}</div>${totaal}`
}

const ingredientenBlok = (rijen: RapportIngredient[]): string => tabel(
  [
    {label: t('batchdossier_kol_ingredient')}, {label: t('lbl_type')},
    {label: t('lbl_kol_aantal'), r: true}, {label: t('batchdossier_kol_lot')},
    {label: t('haccp_trace_lot_leverancier')}, {label: t('batchdossier_kol_houdbaar')},
  ],
  rijen.map(i => `<tr class="blok">
    <td>${esc(i.naam || LEEG)}</td>
    <td>${esc(i.typeKey ? t(i.typeKey, i.type) : (i.type || LEEG))}</td>
    <td class="r nw">${fmtQty(i.hoeveelheid)} ${esc(i.eenheid)}</td>
    <td>${i.lotnummer ? esc(i.lotnummer) : `<span class="muted">${LEEG}</span>`}</td>
    <td>${i.leverancier ? esc(i.leverancier) : `<span class="muted">${LEEG}</span>`}</td>
    <td class="nw">${i.houdbaarheid ? fmtDate(i.houdbaarheid) : LEEG}</td>
  </tr>`))

const metingenBlok = (rijen: RapportMeting[]): string => tabel(
  [
    {label: t('lbl_date')}, {label: 'SG', r: true}, {label: '°C', r: true},
    {label: 'pH', r: true, cls: 'kk-uit'}, {label: t('lbl_opmerking')},
  ],
  rijen.map(m => `<tr class="blok">
    <td class="nw">${fmtDate(m.datum)}${m.tijd ? ` ${esc(m.tijd)}` : ''}</td>
    <td class="r">${getalOfLeeg(m.sg)}</td>
    <td class="r">${getalOfLeeg(m.temp)}</td>
    <td class="r">${getalOfLeeg(m.ph)}</td>
    <td>${esc(m.opmerking)}</td>
  </tr>`))

const vrijgaveBlok = (rijen: RapportVrijgave[]): string => rijen.map(v => `<div class="kaart blok">
    <div class="kaart-kop">
      <span>${esc(t(v.oordeelKey))}</span>
      <span class="muted">${fmtDate(v.datum)}</span>
    </div>
    <div class="kv">
      <div><span>${esc(t('haccp_ccp1_producttype'))}:</span> ${esc(t(v.risicoKey))}</div>
      <div><span>${esc(t('haccp_ccp1_stabiel'))}:</span> ${esc(String(v.dagenStabiel))}/${esc(String(v.vereisteDagen))} ${esc(t('haccp_ccp1_dagen'))} ${jaNee(v.stabielOk)}</div>
      ${v.ffVerschil != null ? `<div><span>${esc(t('haccp_ccp1_ff'))}:</span> ${getalOfLeeg(v.ffVerschil)} ${v.ffOk == null ? '' : jaNee(v.ffOk)}</div>` : ''}
      <div><span>${esc(t('haccp_ccp1_paraaf'))}:</span> ${esc(paraafTekst(v.paraaf))}</div>
    </div>
    ${v.sensorisch ? `<div class="kv" style="margin-top:1.5mm"><div><span>${esc(t('haccp_ccp1_sensorisch'))}:</span> ${esc(v.sensorisch)} ${jaNee(v.sensorischOk)}</div></div>` : ''}
    ${v.opmerking ? `<div class="remarks">${esc(v.opmerking)}</div>` : ''}
  </div>`).join('')

const sessieBlok = (rijen: RapportSessie[]): string => {
  const telling = (c: {goedgekeurd: number, afgekeurd: number}) => c.goedgekeurd + c.afgekeurd === 0
    ? `<span class="muted">${LEEG}</span>`
    : esc(t('batchdossier_controles_telling')
        .replace('{goed}', String(c.goedgekeurd))
        .replace('{af}', String(c.afgekeurd)))
  return tabel(
    [
      {label: t('haccp_sessie_lotcode')}, {label: t('lbl_pakbon_verpakking')},
      {label: t('lbl_date')}, {label: t('lbl_tht')}, {label: t('lbl_status')},
      {label: t('haccp_ccp2_titel')}, {label: t('haccp_ccp3_titel')},
    ],
    rijen.map(s => `<tr class="blok">
      <td class="nw"><strong>${esc(s.lotcode || LEEG)}</strong></td>
      <td>${esc(s.verpakking || LEEG)}</td>
      <td class="nw">${fmtPeriode(s.start, s.eind)}</td>
      <td class="nw">${s.tht ? fmtDate(s.tht) : LEEG}</td>
      <td>${esc(t(s.statusKey, s.statusKey))}</td>
      <td>${telling(s.sluitcontroles)}</td>
      <td>${telling(s.etiketcontroles)}</td>
    </tr>`))
}

const afvullingenBlok = (rijen: RapportAfvulling[]): string => tabel(
  [
    {label: t('lbl_date')}, {label: t('lbl_pakbon_verpakking')},
    {label: t('lbl_pakbon_inhoud'), r: true}, {label: t('lbl_kol_aantal'), r: true},
    {label: t('haccp_sessie_lotcode')}, {label: t('lbl_tht')}, {label: t('lbl_product_sku')},
  ],
  rijen.map(a => `<tr class="blok">
    <td class="nw">${fmtDate(a.datum)}</td>
    <td>${esc(a.verpakking || LEEG)}${a.geblokkeerd ? ` <span class="nok">${esc(t('haccp_geblokkeerd'))}</span>` : ''}</td>
    <td class="r">${a.inhoudPerEenheid != null ? `${fmtQty(a.inhoudPerEenheid)} L` : LEEG}</td>
    <td class="r">${esc(String(a.aantal))}</td>
    <td class="nw">${esc(a.lotcode || LEEG)}</td>
    <td class="nw">${a.tht ? fmtDate(a.tht) : LEEG}</td>
    <td>${esc(a.sku || LEEG)}</td>
  </tr>`))

const financieelBlok = (r: BatchRapport): string => {
  const f = r.financieel
  if (!r.afvullingen.length && f.totaal === 0) return ''
  const regel = (label: string, waarde: string) =>
    `<div class="totals-row"><span>${esc(label)}</span><span>${waarde}</span></div>`
  const perEenheid = [
    f.perLiter != null ? `${t('flow_fin_per_liter')}: ${fmtEuro(f.perLiter)}` : '',
    f.perStuk != null ? `${t('flow_fin_per_stuk')}: ${fmtEuro(f.perStuk)}` : '',
  ].filter(Boolean).join(' · ')
  return `<div class="blok">
    <div class="totals-block" style="width:auto;max-width:90mm">
      ${regel(t('flow_fin_brouwkosten'), fmtEuro(f.brouwkosten))}
      ${regel(t('flow_fin_verpakking'), f.verpakking > 0 ? fmtEuro(f.verpakking) : `<span class="muted">${esc(t('lbl_not_specified'))}</span>`)}
      ${regel(t('flow_fin_accijns') + (f.accijnsVoorcalc ? ` (${t('lbl_voorcalc')})` : ''), fmtEuro(f.accijns))}
      <div class="totals-sep"></div>
      ${regel(t('flow_fin_kostprijs_tot'), `<strong>${fmtEuro(f.totaal)}</strong>`)}
      ${perEenheid ? `<div class="totals-row muted"><span>${esc(perEenheid)}</span><span></span></div>` : ''}
      ${f.opbrengst > 0 ? regel(t('flow_fin_opbrengst'), fmtEuro(f.opbrengst)) : ''}
      ${f.marge != null ? regel(t('flow_fin_marge'), `<strong>${fmtEuro(f.marge)}</strong>`) : ''}
    </div>
    ${f.zonderPrijs > 0 ? `<div class="muted" style="margin-top:2mm">${esc(t('flow_fin_geen_prijs').replace('{n}', String(f.zonderPrijs)))}</div>` : ''}
  </div>`
}

// ── Het document ────────────────────────────────────────────────────────────

function bouwDossierBody(
  rapport: BatchRapport,
  brewery: any,
  appName: string,
  logo: string | null | undefined,
): string {
  const kop = [
    rapport.biernaam && rapport.biernaam !== rapport.titel ? rapport.biernaam : '',
    rapport.stijl,
  ].filter(Boolean).join(' · ')

  const meta: Array<{l: string, v: string}> = [
    {l: t('lbl_pakbon_bier'), v: rapport.titel || LEEG},
    {l: t('lbl_status'), v: (rapport.statusKey ? t(rapport.statusKey, rapport.status) : rapport.status) || LEEG},
    {l: t('lbl_tank'), v: rapport.tank || LEEG},
    {l: t('batchdossier_geexporteerd'), v: fmtDate(new Date().toISOString().slice(0, 10))},
  ]
  if (rapport.receptNaam && rapport.receptNaam !== rapport.titel) {
    meta.splice(1, 0, {l: t('batchdossier_kol_recept'), v: rapport.receptNaam})
  }

  return `<div class="page">
    <div class="hdr">
      ${breweryBlock(brewery, appName, logo)}
      <div class="hdr-right">
        <div class="doc-title">${esc(t('batchdossier_titel'))}</div>
        <div class="doc-nr">${esc(rapport.batchNummer || rapport.titel || LEEG)}</div>
        ${kop ? `<div class="bi-info">${esc(kop)}</div>` : ''}
      </div>
    </div>

    <div class="meta-grid">
      ${meta.map(m => `<div class="meta-block"><div class="ml">${esc(m.l)}</div><div class="mv">${esc(m.v)}</div></div>`).join('')}
    </div>

    ${kerncijferBlok(rapport)}
    ${sectie(esc(t('flow_tijdlijn_titel')), tijdlijnBlok(rapport))}
    ${sectie(esc(t('batchdossier_sec_ingredienten')), ingredientenBlok(rapport.ingredienten))}
    ${sectie(esc(t('batchdossier_sec_metingen')), metingenBlok(rapport.metingen))}
    ${sectie(esc(t('haccp_ccp1_titel')), vrijgaveBlok(rapport.vrijgaven))}
    ${sectie(esc(t('batchdossier_sec_sessies')), sessieBlok(rapport.sessies))}
    ${sectie(esc(t('batchdossier_sec_afvullingen')), afvullingenBlok(rapport.afvullingen))}
    ${sectie(esc(t('batchdossier_sec_verlies')), tabel(
      [{label: t('lbl_date')}, {label: t('lbl_bron')}, {label: t('lbl_liter_kort'), r: true}, {label: t('lbl_opmerking')}],
      rapport.verliezen.map(v => `<tr class="blok">
        <td class="nw">${fmtDate(v.datum)}</td>
        <td>${esc(t(v.bronKey, v.bronKey))}</td>
        <td class="r">${fmtQty(v.liter)}</td>
        <td>${esc(v.notitie)}</td>
      </tr>`)))}
    ${sectie(esc(t('haccp_afw_bekijken')), rapport.afwijkingen.map(a => `<div class="kaart afw blok">
      <div class="kaart-kop"><span>${esc(t(a.bronKey, a.bronKey))}</span><span class="muted">${fmtDate(a.datum)}</span></div>
      <div class="kv"><div><span>${esc(t('haccp_afw_geblokkeerd_omdat'))}:</span> ${esc(a.omschrijving)}</div></div>
      <div class="remarks">${esc(a.onderbouwing)}</div>
      <div class="kv" style="margin-top:1.5mm"><div><span>${esc(t('haccp_ccp1_paraaf'))}:</span> ${esc(paraafTekst(a.paraaf))}</div></div>
    </div>`).join(''))}
    ${sectie(esc(t('flow_fin_titel')), financieelBlok(rapport))}
    ${sectie(esc(t('batchdossier_sec_notities')), rapport.notities.map(n => `<div class="notitie blok">
      <div class="nts">${fmtMoment(n.ts)}</div>${esc(n.tekst)}
    </div>`).join(''))}

    <div class="doc-foot">${esc(t('batchdossier_voetnoot').replace('{app}', brewery?.naam || appName || 'BrewAdmin'))}</div>
  </div>`
}

/** Volledige standalone HTML van het dossier (printvenster, PDF, tests). */
export function buildBatchDossierHTML(
  rapport: BatchRapport,
  brewery: any,
  appName: string,
  logo: string | null | undefined,
): {html: string, filename: string} {
  const filename = rapportBestandsnaam(rapport)
  const body = bouwDossierBody(rapport, brewery, appName, logo)
  return {
    html: `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${esc(filename)}</title><style>${DOSSIER_CSS}</style></head><body>${body}</body></html>`,
    filename,
  }
}

/** Opent het printvenster; daar kiest de gebruiker printer of "Opslaan als
 *  PDF". Levert scherpere, doorzoekbare tekst dan de download hieronder. */
export function printBatchDossier(
  rapport: BatchRapport,
  brewery: any,
  appName: string,
  logo: string | null | undefined,
): void {
  const body = bouwDossierBody(rapport, brewery, appName, logo)
  openPrint(body, rapportBestandsnaam(rapport), DOSSIER_CSS)
}

/** Zet het dossier rechtstreeks als `.pdf` in de downloads. */
export async function downloadBatchDossierPdf(
  rapport: BatchRapport,
  brewery: any,
  appName: string,
  logo: string | null | undefined,
): Promise<void> {
  const {html, filename} = buildBatchDossierHTML(rapport, brewery, appName, logo)
  await htmlNaarPdfDownload(html, filename, {blokSelector: '.blok', kopSelector: '.sec-title'})
}
