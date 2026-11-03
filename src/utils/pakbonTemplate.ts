/**
 * pakbonTemplate.ts — de pakbonlayout als data, net als de factuur
 * (`factuurTemplate.ts`).
 *
 * De pakbon stond als vaste HTML in `PakbonExport.tsx`. Nu is het een template
 * met placeholders; de standaard geeft hetzelfde document als voorheen. Een
 * eigen versie komt in `brewery_details.pakbon_template` (`{html, css}`) en
 * wordt bij een fout stil genegeerd — een pakbon moet altijd te printen zijn.
 * Die eigen layout geldt ook voor de pakbonnen die met de picklijst worden
 * afgedrukt; houd de CSS daarom onder een eigen klasse, anders verandert de
 * picklijst mee.
 *
 * Labels komen als contextwaarde binnen (`{{lbl_…}}`), zodat een eigen layout
 * meertalig kan blijven. De huisstijl van één brouwerij is zo'n eigen layout
 * in haar eigen gegevens, nooit een ingebouwde layout in deze code.
 */

import { t } from '../i18n'
import { fmtDatumDoc } from './format'
import { onGepickteRegels, herkomstVanPick, orderNummer } from './picking'
import type { PickHerkomstData } from './picking'
import type { TemplateContext } from './template'
import { brouwerijVelden, klantVelden, cssTekst, langeDatum } from './factuurTemplate'

/** Standaardlayout van de pakbon (de opmaak is `DOC_CSS` in PakbonExport.tsx). */
export const PAKBON_HTML_DEFAULT = `<div class="page">
    <div class="hdr">
      <div class="hdr-left">
        {{#logo}}<img src="{{logo}}" class="logo" alt="logo" />{{/logo}}
        <div>
          <div class="bi-naam">{{brouwerij_naam}}</div>
          {{#heeft_brouwerij_info}}<div class="bi-info">{{#brouwerij_info}}<div>{{regel}}</div>{{/brouwerij_info}}</div>{{/heeft_brouwerij_info}}
        </div>
      </div>
      <div class="hdr-right">
        <div class="doc-title">{{doc_titel}}</div>
        <div class="doc-nr">{{pakbonnummer}}</div>
        {{#is_concept}}<div class="badge badge-concept">{{lbl_concept}}</div>{{/is_concept}}
        <div class="hdr-party">
          <div class="party-label">{{lbl_bezorgadres}}</div>
          <div class="kn">{{klant_titel}}</div>{{#klant_regels}}<p>{{regel}}</p>{{/klant_regels}}
        </div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-block"><div class="ml">{{lbl_datum}}</div><div class="mv">{{datum}}</div></div>
      <div class="meta-block"><div class="ml">{{lbl_order_ref}}</div><div class="mv">{{order_ref}}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>{{lbl_bier}}</th>
          <th>{{lbl_verpakking}}</th>
          <th>{{lbl_inhoud}}</th>
          <th>{{lbl_lot}}</th>
          <th>{{lbl_tht}}</th>
          <th>{{lbl_batch}}</th>
          <th class="r">{{lbl_aantal}}</th>
        </tr>
      </thead>
      <tbody>
        {{#regels}}{{#is_pick}}<tr>
          <td>{{bier}}</td>
          <td>{{verpakking}}</td>
          <td>{{inhoud}}</td>
          <td class="lotcode">{{lotcode}}</td>
          <td>{{tht}}</td>
          <td>{{batch}}</td>
          <td class="r">{{aantal}}</td>
        </tr>{{/is_pick}}{{#is_open}}<tr class="open">
          <td>{{bier}}</td>
          <td>{{verpakking}}</td>
          <td>—</td>
          <td class="muted">{{lbl_nog_te_picken}}</td>
          <td>—</td>
          <td>—</td>
          <td class="r">{{aantal}}</td>
        </tr>{{/is_open}}{{#is_zonder_lot}}<tr>
          <td>{{bier}}</td>
          <td>{{verpakking}}</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td class="r">{{aantal}}</td>
        </tr>{{/is_zonder_lot}}{{/regels}}
        {{^regels}}<tr><td colspan="7" style="text-align:center;color:#888;padding:4mm;">{{lbl_geen_picks}}</td></tr>{{/regels}}
      </tbody>
    </table>

    {{#opmerking}}<div class="remarks"><strong>{{lbl_opmerking}}:</strong> {{opmerking}}</div>{{/opmerking}}

    <div class="footer">
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">{{lbl_ontvangst}}</div>
        <div class="sign-line"></div>
        <div class="sign-label">{{lbl_handtekening}}</div>
      </div>
      <div class="sign-block">
        <div style="font-size:8pt;font-weight:bold;text-transform:uppercase;color:#888;letter-spacing:0.05em">{{lbl_datum_ontvangst}}</div>
        <div class="sign-line"></div>
        <div class="sign-label">{{lbl_datum}}</div>
      </div>
    </div>
  </div>`

/** Placeholders die de template-editor als naslag toont. */
export const PAKBON_TEMPLATE_VELDEN: readonly string[] = [
  'logo', 'brouwerij_naam', 'brouwerij_info[].regel', 'doc_titel', 'pakbonnummer', 'is_concept', 'voor_de_doos',
  'klant_titel', 'klant_regels[].regel', 'klant_adres[].regel', 'klant_extra[].regel',
  'datum', 'datum_lang', 'order_ref',
  'regels[].bier', 'regels[].verpakking', 'regels[].inhoud', 'regels[].lotcode', 'regels[].tht', 'regels[].batch',
  'regels[].aantal', 'regels[].is_pick', 'regels[].is_open', 'regels[].is_zonder_lot',
  'totaal_stuks', 'stuks_gepickt', 'stuks_open', 'opmerking',
  'brouwerij_adres[].regel', 'brouwerij_contact', 'brouwerij_registratie', 'voet_regels[].regel',
  'voet_css', 'pakbonnummer_css',
]

export interface PakbonTemplateBronnen {
  /** De bestelling (klantkaart toegepast). */
  order: any
  picks: any[]
  afvullingen: any[]
  batches: any[]
  /** `brewery_details`, inclusief `factuur_velden` en `pakbon_template`. */
  brewery: any
  appName: string
  factuurLogo?: string | null
  /** Afvulsessies: de lotcode van een afvulling zonder eigen code. */
  sessies?: PickHerkomstData['afvulSessies']
  /** De pakbon voor in de doos (met de picklijst): geen concept, zie hieronder. */
  voorDeDoos?: boolean
}

const getal = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Het pakbonnummer zoals het op het document en in de bestandsnaam staat. */
export const pakbonNummer = (order: any): string => order?.pakbon_nummer || `P-${order?.id}`

/**
 * Bouwt de context voor de pakbontemplate. Alle waarden zijn al opgemaakt
 * (datum, THT, inhoud, batch) — opmaken is geen taak van de template.
 */
export const bouwPakbonContext = (bronnen: PakbonTemplateBronnen): TemplateContext => {
  const {order, picks, afvullingen: av, batches: bat, brewery, appName, factuurLogo, sessies, voorDeDoos = false} = bronnen
  const pakbonnummer = pakbonNummer(order)
  // Pakbon-datum = datum van picken (`pakbon_datum` of `pick_datum`).
  // Verzend-/orderdatum zijn alleen terugval voor oude records waar het
  // pickmoment niet vastgelegd was.
  const datumBron = order?.pakbon_datum || order?.pick_datum || order?.verzend_datum || order?.datum
  const datum = fmtDatumDoc(datumBron)

  const pickRegels = (picks || []).map((p: any) => {
    const afvulling = (av || []).find((a: any) => a.id === p.afvulling_id)
    const batch = (bat || []).find((b: any) => b.id === p.batch_id)
    // De biernaam zoals besteld (orderregel); anders de batch. Een batchnaam
    // als "James Blond V1" is voor de klant verwarrend.
    const regel = (order?.regels || []).find((r: any) => r.id === p.regel_id)
    const bier = regel?.bier_naam || batch?.biernaam || batch?.naam || '—'
    // De lotcode zoals op de verpakking (afvulling, anders de afvulsessie)
    // naast de THT; het batchnummer apart. Zo is elke fles bij een
    // terugroepactie naar de afnemer te herleiden (handboek hoofdstuk 11).
    const herkomst = herkomstVanPick(p, {afvullingen: av, batches: bat, afvulSessies: sessies})
    return {
      is_pick: true, is_open: false, is_zonder_lot: false,
      bier,
      verpakking: afvulling?.verpakking_type || '—',
      inhoud: afvulling?.inhoud_per_eenheid ? `${afvulling.inhoud_per_eenheid}L` : '—',
      lotcode: herkomst.lotcode || '—',
      tht: afvulling?.tht ? fmtDatumDoc(afvulling.tht) : '—',
      batch: herkomst.batchNummer ? `#${herkomst.batchNummer}` : '—',
      aantal: p.aantal,
    }
  })

  // Nog niet (volledig) gepickte bierregels: de pakbon mag ook vóór het picken
  // geprint worden, bijvoorbeeld als picklijst in de koeling. Wat nog niet
  // gepickt is staat dan op de bestelde regel zelf, en het document is een
  // concept. Uitzondering: de pakbon voor in de doos (`voorDeDoos`, met de
  // picklijst afgedrukt). Het afdrukken reserveert de voorraad, dus lot, THT
  // en batch staan er via de picks al op; geen concept. Alleen wat niet
  // gereserveerd kon worden (tekort, eerst uitslaan) staat als gewone regel
  // zonder lot.
  const openRegels = onGepickteRegels(order, picks || []).map((r: any) => ({
    is_pick: false, is_open: !voorDeDoos, is_zonder_lot: voorDeDoos,
    bier: r.bier_naam || '—',
    verpakking: r.verpakking_type || '—',
    inhoud: '—', lotcode: '—', tht: '—', batch: '—',
    aantal: r.aantal,
  }))
  const regels = [...pickRegels, ...openRegels]

  return {
    ...brouwerijVelden(brewery, appName, factuurLogo),
    ...klantVelden(order),
    doc_titel: t('lbl_pakbon_document'),
    pakbonnummer,
    pakbonnummer_css: cssTekst(pakbonnummer),
    is_concept: !voorDeDoos && openRegels.length > 0,
    voor_de_doos: voorDeDoos,
    datum,
    datum_lang: langeDatum(datumBron) || datum,
    // Hetzelfde nummer als in de app (lijst, kopbalk, klantkaart).
    order_ref: orderNummer(order),
    regels,
    totaal_stuks: regels.reduce((som, r) => som + getal(r.aantal), 0),
    // Wat er al in de doos zit (gepickt of gereserveerd) en wat nog niet.
    stuks_gepickt: pickRegels.reduce((som, r) => som + getal(r.aantal), 0),
    stuks_open: openRegels.reduce((som, r) => som + getal(r.aantal), 0),
    opmerking: order?.opmerkingen || '',
    // Labels — zo blijft ook een eigen layout meertalig.
    lbl_concept: t('lbl_pakbon_concept'),
    lbl_bezorgadres: t('lbl_bezorgadres'),
    lbl_datum: t('lbl_date'),
    lbl_order_ref: t('lbl_order_ref'),
    lbl_bier: t('lbl_pakbon_bier'),
    lbl_verpakking: t('lbl_pakbon_verpakking'),
    lbl_inhoud: t('lbl_pakbon_inhoud'),
    lbl_lot: t('picking_lot'),
    lbl_tht: t('lbl_tht'),
    lbl_batch: t('picking_batch'),
    lbl_aantal: t('lbl_kol_aantal'),
    lbl_nog_te_picken: t('lbl_pakbon_nog_te_picken'),
    lbl_geen_picks: t('msg_geen_picks'),
    lbl_opmerking: t('lbl_opmerking'),
    lbl_ontvangst: t('lbl_pakbon_ontvangst'),
    lbl_handtekening: t('lbl_handtekening'),
    lbl_datum_ontvangst: t('lbl_datum_ontvangst'),
  }
}

/** De eigen pakbonlayout uit `brewery_details`, of leeg als er geen is gezet. */
export const eigenPakbonTemplate = (brewery: any): {html: string, css: string} => ({
  html: String(brewery?.pakbon_template?.html ?? '').trim(),
  css: String(brewery?.pakbon_template?.css ?? '').trim(),
})
