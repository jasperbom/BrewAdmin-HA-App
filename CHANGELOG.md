# Changelog

All notable changes to this project are documented here.

---

## [1.9.31] — 2026-05-05

### Added — Hop-lot-overzicht toont nu alfazuur en oogstjaar per lot

- `src/pages/IngredientenPage.tsx` — De lot-tabel onder een hop-ingredient krijgt twee extra kolommen: **Alfazuur** (%) en **Oogstjaar**. Beide gebruiken `getEffectiveBrewProp(lot, selIng, key)` zodat de waarde valt onder dezelfde fallback-regel — eerst lot.bf_props, anders Ingredient.bf_props (Brewfather-bron). Ontbrekende waardes tonen `—`. Voor andere ingredient-typen blijft de tabel ongewijzigd (4 kolommen). Werkt zowel voor actieve als gearchiveerde lots; lege-state colSpan is dynamisch.
- Geen aanpassingen aan i18n nodig — bestaande sleutels `bf_alpha` en `bf_year` worden hergebruikt.
- `config.yaml` — versie bump 1.9.30 → 1.9.31.

---

## [1.9.30] — 2026-05-05

### Added — Oogstjaar (`year`) als optioneel veld op hop-lots

- `src/utils/constants.ts` — `LOT_BREW_FIELDS_PER_TYPE.Hop` heeft nu een extra veld `year` (Brewfather-key, integer 4-cijferig). Belangrijk omdat alpha-zuren gemiddeld zo'n 5–15% per jaar afnemen — combineer met HSI om de effectieve alpha te schatten op moment van brouwen.
- `src/i18n/{nl,en,de,fr,es}.json` — Nieuwe sleutel `bf_year` (NL "Oogstjaar", EN "Crop year", DE "Erntejahr", FR "Année de récolte", ES "Año de cosecha"). Bestaande `bf_*`-fallback-resolver pakt automatisch `Ingredient.bf_props.year` uit Brewfather-sync.
- Geen unit in `BREW_PROP_UNITS` (een jaartal heeft geen suffix), geen verdere code-aanpassingen nodig — het curated formulier en de fallback-hint werken automatisch via dezelfde generieke render-logica.
- `config.yaml` — versie bump 1.9.29 → 1.9.30.

---

## [1.9.29] — 2026-05-05

### Fixed — Klikbare BF-fallback geeft nu exact dezelfde waarde als de hint toont

- `src/pages/IngredientenPage.tsx` + `src/components/InkoopFactuurModal.tsx` — Bij het klikken op de Brewfather-fallback-link wordt nu de **geformatteerde** waarde in het invoerveld gezet via `formatBrewValue`, in plaats van de rauwe `Number(ingFallback)`. Voorheen kon de hint bijvoorbeeld "82.5" tonen (door `formatBrewValue`-afronding van een float-artefact als `82.4999999999999...`) terwijl bij klikken de rauwe `82.4999999999999...` in het veld belandde — wat de gebruiker zag als "afronding gaat fout". Nu zijn hint-tekst en click-resultaat altijd identiek, en wordt de geformatteerde tekst voor number-velden weer naar `Number()` geparsed zodat bf_props een echt getal blijft.
- `config.yaml` — versie bump 1.9.28 → 1.9.29.

---

## [1.9.28] — 2026-05-05

### Fixed — Brewfather-waardes werden onterecht naar 2 decimalen afgerond

- `src/utils/brewProps.ts` — Nieuwe helper `formatBrewValue` die getallen naar maximaal 6 decimalen formatteert via `toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false })`. Behoudt de oorspronkelijke precisie en strijkt float-artefacten als `1.0370000000000001` glad zonder echte waardes te verminken.
- `src/pages/IngredientenPage.tsx` — Brewfather-info-paneel én effectieve-waardes-paneel én fallback-hint gebruiken nu `formatBrewValue`. Voorheen werd `v.toFixed(2).replace(/\.?0+$/, '')` gebruikt, wat o.a. `1.037` (SG potential) als `1.04` toonde en heel kleine waardes (`0.005`) als lege string. Nu klopt de weergave: `1.037` blijft `1.037`, `78.5` blijft `78.5`, `100` blijft `100`.
- `src/components/InkoopFactuurModal.tsx` — Idem voor de fallback-hint onder elk veld in het Inkoopfactuur-modal: de getoonde Brewfather-waarde gebruikt nu `formatBrewValue` zodat klikken niet leidt tot een onverwachte waarde in het invoerveld.
- `config.yaml` — versie bump 1.9.27 → 1.9.28.

---

## [1.9.27] — 2026-05-05

### Changed — Brouw-props: `potentialPercentage` als BF-key voor extractrendement, SG-veld weg, GN-code uit lot-edit

- `src/utils/constants.ts` — Voor mout en suiker is `LOT_BREW_FIELDS_PER_TYPE` aangepast naar key **`potentialPercentage`** in plaats van `yield`. Dat is het Brewfather-veld dat het extract-potentieel als percentage van het droge gewicht weergeeft, dus nu klopt de fallback naar `Ingredient.bf_props.potentialPercentage` (en de klikbare hint vult de juiste BF-waarde). `BREW_PROP_UNITS` kreeg `potentialPercentage: '%'`.
- Het losse **Potentieel (SG)**-invoerveld is verwijderd uit het mout- en suiker-formulier (zinloos zolang het percentage al volstaat). Het `potential`-veld blijft wel zichtbaar in het algemene Brewfather-info-paneel als BF die data levert, met label "Potentieel (SG)" zodat onderscheid met het percentage duidelijk is.
- `src/i18n/{nl,en,de,fr,es}.json` — Nieuwe sleutel `bf_potentialPercentage` (NL "Extractrendement", EN "Extract yield", DE "Extraktausbeute", FR "Rendement extrait", ES "Rendimiento extracto"). `bf_yield` is nu generieker "Yield" zodat als BF beide raw-velden levert, ze ieder hun eigen label hebben in het info-paneel. `bf_potential` heeft nu de SG-toevoeging in het label.
- `src/pages/IngredientenPage.tsx` — Het GN-code-invoerveld is uit het lot-bewerk-modal gehaald. GN-code is een douane-nomenclatuur voor verpakt bier (zie batch- en afvulling-niveau), niet voor een ingredient-charge. Bestaande `lot.gn_code`-data blijft behouden via openLot/saveLot (backward-compat), enkel het input-veld is weg.
- `config.yaml` — versie bump 1.9.26 → 1.9.27.

---

## [1.9.26] — 2026-05-05

### Changed — Brouwkundige eigenschappen: potentieel-veld, klikbare BF-fallback overal, dubbele eenheden weg

- `src/utils/constants.ts` — Nieuwe flat map `BREW_PROP_UNITS` als enige bron voor BF-prop-eenheden (`alpha:%`, `color:EBC`, `minTemp:°C`, `diastaticPower:°L`, …). `LOT_BREW_FIELDS_PER_TYPE` heeft geen `unit`-veld meer; alle eenheden komen uit `BREW_PROP_UNITS`. Nieuw veld **`potential`** toegevoegd voor Mout en Suiker (Brewfather's `potential` is de extract-SG, bv. 1.037 voor pilsmout — naast `yield` (% extractrendement)).
- `src/i18n/{nl,en,de,fr,es}.json` — Eenheden uit `bf_*`-labels gestript (NL: "Kleur (EBC)" → "Kleur"; "Vergistingsgraad %" → "Vergistingsgraad"; "Min. temp. (°C)" → "Min. temp."; etc. in alle 5 talen). Hierdoor verschijnt elke eenheid nog maar één keer in de UI in plaats van zowel in het label als achter het veld. Nieuwe sleutel `bf_potential` voor het potentieel-veld.
- `src/pages/IngredientenPage.tsx` — Brewfather-info-paneel onder de lot-tabel toont nu de eenheid achter de waarde via `BREW_PROP_UNITS`. Brouwkundige eigenschappen-blok in de lot-popup is nu **inklapbaar** (default open, persistent via `lot_brew_open`). Effectieve-waardes-paneel toont eenheid achter de waarde en routeert lange waardes (>60 tekens of key `note*`) naar de "Notitie bekijken"-modal — dezelfde behandeling als het Brewfather-info-paneel.
- `src/components/InkoopFactuurModal.tsx` — Bij het toevoegen van een nieuw lot is per veld nu een klikbare *Brewfather*-fallback-link onder het invoerveld (alleen bij een gekozen bestaand ingredient). Eén klik vult de Brewfather-waarde — gelijk aan het lot-bewerk-modal. Werkt voor number, text en select. De "Neem over van vorig lot"-knop blijft bestaan voor één-klik-overname van het hele vorige lot.
- `config.yaml` — versie bump 1.9.25 → 1.9.26.

---

## [1.9.25] — 2026-05-05

### Changed — Brewfather-paneel overzichtelijker en BF-fallback klikbaar

- `src/i18n/{nl,en,de,fr,es}.json` — `bf_yield` heet nu *Extractrendement %* (NL) / *Extract yield %* / *Extraktausbeute %* / *Rendement extrait %* / *Rendimiento extracto %*. Brewfather's `yield`-veld is het extract-potentieel als percentage van het droge gewicht (correleert met PPG); de eerdere generieke "Rendement"-vertaling was verwarrend. Nieuwe sleutels `bf_notes`, `lbl_view_note`, `btn_use_bf_value` toegevoegd.
- `src/pages/IngredientenPage.tsx` — In de lot-bewerk-modal is de Brewfather-fallback-hint per veld nu een klikbare knop: één klik vult de getoonde Brewfather-waarde in het invoerveld (number/text/select). Hover toont *Gebruik Brewfather-waarde*.
- `src/pages/IngredientenPage.tsx` — Het Brewfather-paneel onder de lot-tabel is nu collapsible (standaard ingeklapt, persistent via `useStore('ing_bf_panel_open')`). Header toont aantal velden zodat je weet hoeveel BF-data verborgen zit.
- `src/pages/IngredientenPage.tsx` — Lange Brewfather-waardes (string > 60 tekens of veld-key beginnend met `note`) worden nu gerenderd als *Notitie bekijken →*-link in het paneel; klik opent een modal met de volledige tekst (`whitespace-pre-wrap`, scroll bij heel lange notities). Voorheen werd de hele notitie als platte tekst getruncated of de cel werd onevenredig breed.
- `config.yaml` — versie bump 1.9.24 → 1.9.25.

---

## [1.9.24] — 2026-05-05

### Added — Brouwkundige eigenschappen per Lot (met fallback naar Ingredient)

Een lot kan nu optioneel charge-specifieke brouwkundige waardes bevatten (alpha% bij hop, kleur/yield bij mout, attenuation/min-max-temp/flocculatie bij gist, …). Lege waardes vallen automatisch terug op `Ingredient.bf_props` (Brewfather-bron), zodat één plek volstaat als alle charges hetzelfde zijn.

- `src/types/index.ts` — `Lot.bf_props?: Record<string, any>` toegevoegd, gespiegeld aan `Ingredient.bf_props`.
- `src/utils/constants.ts` — `LOT_BREW_FIELDS_PER_TYPE` curates per ingredient-type welke velden zichtbaar zijn (Mout: kleur/yield/diastatisch/vocht; Hop: alpha/beta/cohumulone/HSI; Gist: attenuation/min-/maxTemp/flocculatie/alcoholtolerantie; Suiker: yield/kleur; Overig: concentratie/kleur). Keys zijn identiek aan `extractBfProps`-output zodat fallback een directe key-lookup is.
- `src/utils/brewProps.ts` (nieuw) — `getEffectiveBrewProp`, `getEffectiveBrewProps` (met bron `'lot'|'ingredient'`) en `stripEmptyBrewProps`.
- `src/components/InkoopFactuurModal.tsx` — collapsible sectie *Brouwkundige eigenschappen (optioneel)* in het Ontvangst-modal, dynamisch op basis van `productForm.type`. Knop *Neem over van vorig lot* hergebruikt de bestaande `lastLot`-detectie zodat één klik de waardes van de vorige charge kopieert (geen autoprefill — anders blokkeert het de fallback).
- `src/pages/IngredientenPage.tsx` — `saveOntvangst` strip lege waardes en schrijft `lot.bf_props`. Lot-bewerk-modal heeft nu een edit-sectie met fallback-hint per veld ("← Brewfather: 5,5") plus een read-only effectieve-waardes-paneel met badge `lot` of `Brewfather` per key.
- `src/pages/BoekhoudingPage.tsx` — mirror van saveOntvangst-uitbreiding zodat ook via *Boekhouding → Inkoopfactuur* de brouwwaardes op het lot terechtkomen.
- `src/i18n/{nl,en,de,fr,es}.json` — 5 nieuwe sleutels: `brew_props_section`, `btn_copy_from_last_lot`, `brew_props_fallback_hint`, `src_lot`, `src_ingredient`. Bestaande `bf_*`-keys (alpha, color, yield, attenuation, …) worden hergebruikt voor veldlabels.
- Excel-backup ondersteunt `lot.bf_props` automatisch — `excel.ts` JSON-stringifyt geneste objecten en parsed bij import terug.
- Toekomst: dezelfde resolver vormt het fundament voor automatische substitutie-suggesties bij voorraadtekort tijdens brouwen — niet onderdeel van deze release.
- `config.yaml` — versie bump 1.9.23 → 1.9.24.

---

## [1.9.23] — 2026-05-05

### Changed — Ingrediëntenlijst: fabrikant zichtbaar en strakker uitgelijnd

- `src/pages/IngredientenPage.tsx` — De linkerlijst toont nu per ingredient de fabrikant als kleine, grijze ondertitel onder de naam (alleen als die is ingevuld). De voorraadkolom is uitgelijnd met `tabular-nums` (gelijke cijferbreedte) en geformatteerd via `fmtQty` (Nederlandse notatie). De eenheid staat als kleine, grijze achtervoegsel zodat het getal zelf strak rechts uitlijnt over alle rijen heen. Cellen gebruiken `align-top` zodat namen + fabrikanten en hoeveelheden netjes naast elkaar starten. Het zoekveld doorzoekt nu ook de fabrikant.
- `config.yaml` — versie bump 1.9.22 → 1.9.23.

---

## [1.9.22] — 2026-05-05

### Changed — Fabrikant beter zichtbaar bij toevoegen en in dropdowns

- `src/components/InkoopFactuurModal.tsx` — het Fabrikant-veld in het Ontvangst-modal verschijnt nu zodra er geen bestaand ingredient gekozen is (eerder pas nadat er een nieuwe naam was getypt). Daardoor is direct duidelijk dat je bij een nieuw ingredient ook de fabrikant kan vastleggen.
- `src/pages/BatchesPage.tsx` — ingredient-dropdowns (zowel de receptkoppeling als de hoofdkeuze "ingredient toevoegen aan batch") tonen nu `Naam (Fabrikant)` waar een fabrikant ingevuld is, in lijn met het Ontvangst-modal.
- `src/pages/ReceptenPage.tsx` — receptkoppelings-dropdown toont eveneens `Naam (Fabrikant)`.
- `config.yaml` — versie bump 1.9.21 → 1.9.22.

---

## [1.9.21] — 2026-05-05

### Changed — Ingrediëntenpagina: "+ lot" vult ingredient-context vooraf in

- `src/components/InkoopFactuurModal.tsx` — nieuwe optionele prop `lots`. Wanneer het Ontvangst-modal wordt geopend met een specifiek `initialIngId` (via *+ lot* op de Ingrediëntenpagina), worden product-velden afgeleid uit het ingredient en zijn laatste lot:
  - `type` = type van het ingredient (zonder dit verscheen het ingredient niet eens in de dropdown).
  - `eenh` = meest gebruikte eenheid van eerdere lots (fallback: laatste lot).
  - `prijs` = `prijs_per_eenheid` van het laatste lot.
  - `btw_tarief` = `btw_tarief` van het laatste lot, anders mapping op type.
  - Leverancier wordt voorgeselecteerd op de laatst gebruikte leverancier voor dit ingredient (in de bekend-lijst of als nieuw).
- `src/pages/IngredientenPage.tsx` — geeft `lots` door aan `<InkoopFactuurModal>`.
- `config.yaml` — versie bump 1.9.20 → 1.9.21.

---

## [1.9.20] — 2026-05-05

### Changed — Batch-detail UI: header opgesplitst en fase-bewuste section cards

- `src/pages/BatchesPage.tsx` — *Header card* bevat nu alleen nog de status-snapshot (titel + acties + tank-picker + Vergistingsvoortgang + Volumes). De **Info collapse** en **Kosten samenvatting** zijn uit de header gehaald en zijn nu eigen uitklapbare section cards (consistent met Gistgrafiek, Verliesregistratie en Taken).
- Nieuwe per-batch open-states `batches_info_open` en `batches_kosten_open` (vervangen de oude lokale `infoIngeklapt`-state). De Kosten-card staat direct vóór het Kostprijsoverzicht zodat alle financiële info bij elkaar zit.
- Nieuwe helper `sectieOpen(map, batchId, fase, sectie)` past **fase-bewuste defaults** toe wanneer de gebruiker zelf nog geen voorkeur heeft gekozen:
  - `gist`: open bij *Vergisten*
  - `verlies`: open bij *Vergisten* en *Conditioneren*
  - `kosten`: open bij *Verpakt* en *Gesloten*
  - `info`: standaard dicht
  - User-toggles worden persistent bewaard en winnen altijd van de fase-default.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutel `batch_kosten_card_title` (NL: *Kosten samenvatting*).
- `config.yaml` — versie bump 1.9.19 → 1.9.20.

---

## [1.9.19] — 2026-05-05

### Changed — Batchpagina: volumes, verlies en duidelijkere CCP-meting

- `src/utils/constants.ts` + `src/types/index.ts` — nieuwe verlies-bron `gist_dump` (Gist dump) toegevoegd aan `VERLIES_BRONNEN` en `VerliesBron`-type.
- `src/utils/calculations.ts` — `tankRestVolume` accepteert nu een derde parameter `verliezen` en trekt die liters af van het tankvolume zodat het in-tank volume altijd klopt. Negatieve verliezen werken als correctie (bijvoorbeeld wanneer er meer is afgevuld dan in tank zat). `tankAccijnsWaarde` en `agpOverzicht` kregen dezelfde optionele parameter.
- `src/pages/BatchesPage.tsx` — nieuwe sectie **Volumes** direct onder *Vergistingsvoortgang* met Vergist, In tank, Verpakt en Verlies (met klikbare snelkoppeling naar verliesregistratie). De oude volume-strook in de kostensamenvatting is verwijderd. Het verlies-invoerveld accepteert nu negatieve waarden voor correcties. Bij Kritische Controle Punten toont het meetformulier nu de eenheid in het label (`Gemeten waarde (°C)`), een placeholder en een expliciete `Kritische grens`-regel zodat duidelijk is wat ingevuld moet worden.
- `src/i18n/{nl,en,de,fr,es}.json` — sleutel `batch_abv_accijns_label` hernoemd van *ABV voor accijns* naar *ABV gereed product* (en hint bijgewerkt). Nieuwe sleutels `verlies_bron_gist_dump` en `batch_volumes_header` in alle 5 talen.
- `config.yaml` — versie bump 1.9.18 → 1.9.19.

---

## [1.9.18] — 2026-05-04

### Added — Eenmalige opruiming van lege inkoopfacturen

- `src/App.tsx` — eenmalige migratie die bij het opstarten controleert of er bestaande `inkoop_facturen` zijn zonder leverancier én zonder factuurnummer. Als die er zijn, wordt de gebruiker eenmalig gevraagd of de records opgeruimd mogen worden. Bij bevestiging worden de facturen verwijderd plus alle `bank_koppelingen` met `soort: 'inkoop'` die naar deze facturen verwezen. De bijbehorende `lots` en `voorraad_log`-entries blijven onaangeroerd, zodat de fysieke voorraad klopt zonder financiële tegenboeking.
- Status wordt vastgelegd in nieuwe data-key `lege_facturen_migratie_v1` (`null` → `'done'`) zodat de prompt na keuze (ja of nee) niet opnieuw verschijnt.
- Wijziging logt audit-entry via `logAudit`.
- i18n: nieuwe sleutels `confirm_lege_facturen_opruimen` en `audit_lege_facturen_opgeruimd` in `nl/en/de/fr/es`.
- `config.yaml` — versie bump 1.9.17 → 1.9.18.

---

## [1.9.17] — 2026-05-04

### Changed — Lot toevoegen zonder factuur in boekhouding

- `InkoopFactuurModal` slaat geen `inkoop_facturen`-record meer op wanneer zowel leverancier als factuurnummer leeg zijn. De ontvangst wordt dan beschouwd als voorraadcorrectie: lots en `voorraad_log`-entries worden wél aangemaakt, zodat de fysieke voorraad klopt zonder financiële tegenboeking.
- `src/pages/IngredientenPage.tsx` — `saveOntvangst` controleert `factuurForm.leverancier` en `factuurForm.factuur` voordat een inkoopfactuur wordt weggeschreven.
- `src/pages/BoekhoudingPage.tsx` — `saveVrijeFactuur` past dezelfde logica toe.
- `src/components/InkoopFactuurModal.tsx` — toont een blauwe info-hint zodra beide velden leeg zijn, zodat de gebruiker weet dat de ontvangst als correctie wordt opgeslagen.
- i18n: nieuwe sleutel `hint_correctie_geen_factuur` toegevoegd aan `nl/en/de/fr/es`.
- `config.yaml` — versie bump 1.9.16 → 1.9.17.

---

## [1.9.16] — 2026-05-04

### Removed — Opruiming van dode paginabestanden

- `src/pages/HygienePage.tsx` verwijderd: 8-regelige stub die `null` returnde. De hygiëne-checklist zit ingebed in `BatchesPage`; `DEFAULT_HYGIENE_GROUPS` en `DEFAULT_HYGIENE_ITEMS` worden direct uit `src/utils/constants.ts` geïmporteerd, dus de re-export was overbodig.
- `src/pages/AfvullenPage.tsx` verwijderd: werd geïmporteerd in `App.tsx` maar nergens als JSX gerenderd. De afvul-flow zit in `BatchesPage` en `ProductenPage`.
- `src/pages/VoorraadPage.tsx` verwijderd: nergens geïmporteerd. Voorraad-functionaliteit zit in `IngredientenPage`, `InventarisatiePage` en `VoorraadverloopPage`.
- Ongebruikte `AfvullenPage`-import uit `src/App.tsx` verwijderd.
- `config.yaml` — versie bump 1.9.15 → 1.9.16.

---

## [1.9.15] — 2026-05-04

### Changed — Consistente afronding van bedragen en hoeveelheden

- **Bedragen altijd op 2 decimalen:** netto, btw_bedrag en totalen worden nu bij opslag afgerond via een nieuwe `r2()` helper i.p.v. ruwe float-arithmetic. Voorkomt floating-point junk zoals `0.30000000000000004` in de opgeslagen data — daardoor blijven sommen ook na meerdere bewerkingen schoon.
- **Hoeveelheden tot maximaal 3 decimalen** (`r3` voor opslag, `fmtQty` voor display) zonder geforceerde trailing zeros: `0.500` → `0,5`, `1.2300004` → `1,23`. Lot-mutaties bij correctie en afboeking ronden nu ook stelselmatig af.
- Nieuwe helpers in `src/utils/format.ts`: `fmtAmt(v)`, `fmtQty(v, max=3)`, `r2(n)`, `r3(n)`.
- Display van `lot.hoeveelheid` en bewegingsregels gaat nu via `fmtQty` op alle relevante plekken: ingrediëntlijst, voorraadlog, batch-grondstoffen, lot-keuze, dashboard-waarschuwingen, statiegeldoverzicht, factuurregels in pakbon en productenlog.
- Raakt geen bestaande data aan (alleen nieuwe opslagen worden afgerond), en breekt niet met formuliervelden — input blijft ongerond zodat de gebruiker tijdens typen vrij is.
- `config.yaml` — versie bump 1.9.14 → 1.9.15.

---

## [1.9.14] — 2026-05-04

### Added — BTW-suppletie via doorrol naar huidige aangifte

- Inkoopfacturen die in een al **ingediende of betaalde** BTW-periode worden geboekt, krijgen automatisch het veld `btw_periode` met de huidige openstaande periodeKey (bv. `2026-Q2`). De BTW van deze factuur wordt zo in de lopende aangifte meegenomen i.p.v. de afgesloten periode achteraf te wijzigen.
- **Waarschuwingsbanner in de inkoopfactuurmodal:** zodra de gekozen factuurdatum in een afgesloten periode valt, ziet de gebruiker direct dat de BTW doorgerold wordt en naar welke periode (`msg_btw_rollover`).
- **Badge in de inkoopfacturenlijst:** facturen met `btw_periode` tonen `↪ BTW {periode}` zodat in één oogopslag zichtbaar is dat de BTW elders wordt geclaimd.
- **BTW-overzicht per periode** filtert nu op effectieve periodeKey (`btw_periode || datum`) i.p.v. op datumbereik. Doorgerolde facturen verschijnen in de huidige openstaande aangifte; afgesloten perioden blijven onaangeroerd.
- Nieuwe utility `src/utils/btw.ts` met `datumToPeriodeKey`, `huidigePeriodeKey`, `isPeriodeGesloten`, `effectievePeriodeKey` en `bepaalRollover`.
- Werkt in alle 4 inkoopfactuur-flows: ingrediëntontvangst, vrije inkoopfactuur, factuur bewerken én bankboeking.
- Vertalingen toegevoegd in NL, EN, DE, FR, ES.
- `config.yaml` — versie bump 1.9.13 → 1.9.14.

---

## [1.9.13] — 2026-04-27

### Changed — Belastbaar feit verschoven naar Picken (Douane v2.4 §10.2)

- **Picken = uitslag uit AGP.** `savePicks()` maakt nu zelf de `Uitlevering`- en `Accijns`-records aan zodra alle picks compleet zijn; voorheen ontstonden die pas bij Afronden. Dit volgt §10.2 van het bedrijfshandboek: "Op dit moment verlaat het bier de AGP en is het veraccijnsd."
- **Nieuwe knop "📦 Markeer verzonden"** tussen Gepickt en Afgerond — een logistieke statusovergang zonder fiscaal effect.
- **Order afronden** is teruggebracht tot factuur + pakbon + status `'afgerond'`. De afrondmodal communiceert dit nu expliciet.
- **Picking-modal sectie "Uitslag uit AGP"** — `type_uitlevering` (binnenland / intra-EU / export), bestemming en vervoerder worden nu vóór bevestiging ingevuld.
- **Achterwaarts compatibel:** legacy-picks zonder `uitlevering_ids` triggeren een fallback in `rondeAf` zodat oude data probleemloos blijft werken.
- Refactor: `bouwUitslagRecords()` extraheert de per-locatie-allocatie en record-creatie uit `rondeAf` voor hergebruik.

### Changed — Vernietigingsflow met statussen Aangevraagd → Toegestaan → Uitgevoerd (Douane v2.4 §7.2.3)

- **Stap 1 — Aangevraagd.** Bij aanmaken van een vernietiging is verplicht: datum indiening verklaring + minstens één bijlage met rol `douane_verklaring`. De UI verwijst naar het Douane-formulier "Verklaring vernietiging accijns- of verbruiksbelastinggoederen vanuit een schorsingsregeling/vrijstelling" op www.douane.nl. Voorraad wordt gereserveerd.
- **Stap 2 — Toegestaan.** Nieuwe vervolgmodal voor het verwerken van schriftelijke toestemming Douane: datum + optioneel kenmerk.
- **Stap 3 — Uitgevoerd.** Datum uitvoering + minstens één bijlage met rol `bewijs` (foto/video). Bij bevestigen wordt de voorraad definitief afgeboekt en logt het auditlog dat de potentiële accijnsschuld vervalt voor de vernietigde hoeveelheid.
- **Statusbadges** (Aangevraagd geel, Toegestaan blauw, Uitgevoerd groen) in de afboekingenlijst per afvulling, met "→ Toestemming verwerken" / "→ Uitvoeren registreren" knoppen.
- **Bijlagen tonen hun rol** als label ("verklaring" / "bewijs").
- Legacy-afboekingen zonder status worden weergegeven als `'aangevraagd'`.

### Fixed — Pre-existing TypeScript-errors

Alle 17 baseline-tsc-errors opgelost zodat `tsc --noEmit` nu schoon door komt:
- `Btn.title?: string` toegevoegd aan `BtnProps` (lost BatchesPage 1396 + nieuwe BestellingenPage-knop op).
- `IngredientenPage.Props` uitgebreid met optionele `auditLog` en `setAuditLog` (lost App.tsx 824 op).
- `BestellingenPage` `draftPicks` type uitgebreid met `bron_locatie_id?: number | null`.
- `InkoopFactuurModal` `parseFloat(...||0)` → `parseFloat(String(...||'0'))` (2x).
- `BoekhoudingPage.knownLeveranciers` als `useMemo<string[]>` getypeerd; `replace('{n}', n)` met `String(...)` cast.
- `DashboardPage` `<SectionHeader rounded>` → `rounded="top"`.
- `IngredientenPage` `<Btn onClick={(e) => ...}>` met argument verpakt in `<span onClick>` wrapper (2x); `setOdEditForm({...})` aangevuld met `od_id` + `lotnr`; `replace('{n}', ...)` met `String()` cast.

### Bestanden gewijzigd

- `src/pages/BestellingenPage.tsx` — belastbaar feit naar picken, `markVerzonden`, picking-modal uitlevering-sectie.
- `src/pages/ProductenPage.tsx` — 3-staps vernietigingsflow + vernietigingsreview-modal.
- `src/i18n/nl.json` — `order_mark_shipped` toegevoegd, `order_complete` herbenoemd naar "Afronden".
- `src/components/ui/Btn.tsx` — `title?: string` prop.
- `src/components/InkoopFactuurModal.tsx` — type-coercion fix.
- `src/pages/BoekhoudingPage.tsx`, `DashboardPage.tsx`, `IngredientenPage.tsx` — diverse type-fixes.
- `config.yaml` — versie bump 1.9.12 → 1.9.13.

---

## [1.9.12] — 2026-04-27

### Improved — CCP-meting invoer is nu zelfsturend

- **Eenheid in label** — het waarde-veld toont de eenheid van de gekozen CCP direct in het label (bv. "Gemeten waarde (°C)").
- **Acceptabele waarde inline** — onder het invoerveld verschijnen de min/max-grenzen uit de CCP-definitie, zodat duidelijk is wat als afwijking telt.
- **Monitoring-methode + kritische grens bovenin** — direct onder de CCP-keuze tonen we de bijhorende monitoringmethode en de tekstuele kritische grens, zodat de operator niet hoeft te zoeken wat er gemeten moet worden.
- **Real-time afwijkingsindicator** — wanneer de ingevulde waarde buiten de grenzen valt, kleurt het help-blokje rood met een waarschuwingspictogram en de melding dat een CAPA-record automatisch wordt aangemaakt.
- **HTML5 min/max** — browser-validatie via min/max-attributen op de number input.

### Bestanden gewijzigd
- `src/pages/HACCPPage.tsx` — `ccp_met`-modal omgebouwd tot IIFE die de geselecteerde CCP-definitie ophaalt en context toont; placeholder, label-suffix met eenheid en help-strip met range + out-of-range-indicator toegevoegd.
- `src/i18n/{nl,en,de,fr,es}.json` — 4 nieuwe sleutels (`haccp_ccp_waarde_ph`, `haccp_ccp_waarde_ph_geen_eenheid`, `haccp_ccp_acceptabele_range`, `haccp_ccp_buiten_grenzen`).

---

## [1.9.11] — 2026-04-27

### Changed — AGP is geen geldige bestemming voor verplaatsingen

- Bier dat de AGP heeft verlaten kan niet onder schorsing terug — dat is geen
  reguliere voorraadbeweging maar een teruggaaf-procedure (apart traject).
- AGP-locatie is uit de `naar_locatie`-dropdown van de verplaatsing-modal
  gefilterd; harde guard in `saveVerplaats` met duidelijke foutmelding.
- AGP-eind in Voorraadverloop telt geen verplaatsingen-naar-AGP meer als
  positieve instroom — bier komt op AGP alleen via afvullen (productie).
- i18n: `agp_info_geen_accijns_retour` (5 talen) vervangen door
  `agp_err_geen_retour_naar_agp` met de juiste juridische framing.

---

## [1.9.10] — 2026-04-27

### Fixed — Dockerfile kopieert vendor/ vóór npm install

- `COPY package.json package-lock.json ./` + `COPY vendor/ ./vendor/`
  vóór `RUN npm ci`. De vorige stap kopieerde alleen `package.json`,
  waardoor de `file:./vendor/xlsx-0.20.3.tgz`-dependency niet gevonden
  werd en de HA-addon-build faalde met `ENOENT: vendor/xlsx-0.20.3.tgz`.
- Switch van `npm install` naar `npm ci` voor deterministische installs
  (vereist `package-lock.json`, ~3× sneller).

---

## [1.9.9] — 2026-04-27

### Changed — `package-lock.json` synchroniseren met vendored xlsx

- Lockfile geregenereerd zodat de `resolved`-URL voor `xlsx` naar
  `file:vendor/xlsx-0.20.3.tgz` wijst in plaats van naar de CDN. Maakt
  `npm ci` reproduceerbaar in de Claude Code-sandbox.

---

## [1.9.8] — 2026-04-27

### Changed — `xlsx` gevendord + SessionStart-hook voor Claude Code op het web

- `xlsx@0.20.3` wordt nu vanuit `vendor/xlsx-0.20.3.tgz` geïnstalleerd in plaats
  van `https://cdn.sheetjs.com/...`. SheetJS publiceert niet op npm en de
  CDN is onbereikbaar vanuit de Claude Code-sandbox; vendoren maakt installs
  deterministisch en offline-capable.
- `.claude/hooks/session-start.sh` + registratie in `.claude/settings.json`
  draait `npm install` bij sessiestart in de remote-sandbox (idempotent: skipt
  als `node_modules` al gevuld is). Lokale dev-omgevingen worden niet geraakt
  (`CLAUDE_CODE_REMOTE`-guard).
- `vendor/README.md` documenteert hoe de tarball ververst wordt.

---

## [1.9.7] — 2026-04-27

### Added — AGP-perspectief en accijns in Voorraadverloop

- **Voorraadverloop "Gereed product"-tabel uitgebreid** met drie kolomgroepen:
  totaalvoorraad (begin/productie/binnenland/export/bijz./eind), AGP-voorraad onder
  schorsing (begin/uitgeslagen/eind) en accijns (latente schuld op AGP-eindvoorraad +
  te betalen accijns over de periode).
- **Latente schuld** wordt berekend met de bevroren `voorcalc_accijns_per_eenheid`
  snapshot per afvulling, zodat tariefwijzigingen historische cijfers niet aantasten.
- **Te betalen accijns** somt alle uitstroom uit AGP in de periode (uitleveringen +
  verplaatsingen naar niet-AGP-locaties), met export als niet-belastbaar feit.
- Excel-export bevat de nieuwe kolommen.

### Removed — Intracommunautair en e-AD geschrapt

- `TypeUitlevering = 'intracommunautair'` is verwijderd. Bestaande records met
  deze waarde renderen leeg in de UI.
- e-AD register-tab in `AccijnsPage` is verwijderd, inclusief `EADDocument`,
  `EADType`, `EADStatus` types en de `ead_documenten`-data sleutel.
- IC-optie + e-AD-waarschuwing in de bestelling-uitleverings-modal verdwenen.
- `agp_stroom_eu` badge in het AGP-stroomdiagram (Instellingen) verdwenen.
- ARC-nummer-veld op ingrediëntlots verdwenen. e-AD-sheet uit Excel-backup verdwenen.
- 30+ i18n-sleutels in 5 talen opgeruimd, AGP/accijns-sleutels toegevoegd.
- BTW-rubriek 2a (intracommunautaire BTW-aangifte) blijft staan — separate van accijns.

---

## [1.9.6] — 2026-04-27

### Added — Privé vs. zakelijk onderscheid op orders + AGP-restrictie privé

- **Klanttype op `Bestelling` en `Klant`** — nieuw veld `klant_type: 'prive' | 'zakelijk'`. Handmatige orders krijgen een toggle bij het aanmaken, met privé als default. Bedrijfsnaam is verplicht voor zakelijke orders.
- **WooCommerce-import** — `klant_type` wordt afgeleid uit `billing.company` (en BTW-nummer indien aanwezig in metadata): gevuld → zakelijk, anders → privé.
- **Hard blokkeren AGP voor privéklanten** — privéklanten mogen wettelijk niet uit de Accijnsgoederenplaats geleverd worden. De picking modal toont voor privé-orders alleen voorraad buiten AGP, de locatie-keuze sluit AGP uit, en `rondeAf` valt niet meer terug op AGP. Bij ontoereikende non-AGP-voorraad volgt een duidelijke foutmelding met instructie om eerst voorraad uit AGP te verplaatsen.
- **Lazy backfill** — bestaande orders zonder `klant_type` worden afgeleid uit `klant_bedrijf`, maar alleen voor niet-verzonden orders, zodat historische allocaties intact blijven.
- **UI** — privé/zakelijk-badges op de orderlijst en order-detailpagina; info-banner op de pickmodal voor privé-orders.

### Bestanden gewijzigd
- `src/types/index.ts` — `KlantType`-type, `klant_type` op `Bestelling` en `Klant`.
- `src/pages/BestellingenPage.tsx` — `effectiveKlantType`, `beschikbaarBuitenAgpVoorAfvulling`, klant-type-toggle in handmatige order-modal, AGP-filter in pick modal, validatie in `savePicks` en `rondeAf`, badges in lijst en detail.
- `src/i18n/{nl,en,de,fr,es}.json` — 7 nieuwe sleutels (`lbl_klant_type`, `lbl_zakelijk`, `lbl_prive`, `info_prive_buiten_agp`, `err_order_company_required`, `err_prive_geen_agp`, `err_prive_buiten_agp_ontoereikend`).

---

## [1.9.5] — 2026-04-25

### Added — Douane-compliance v2.4 (reactie Douane op Bedrijfshandboek v2.3)

Deze release verwerkt de aanvullende eisen van de Nederlandse Douane op het Craftery Brewing-bedrijfshandboek v2.3, en bevat direct de kwaliteitspas die uit een test-pass van de v2.4-implementatie naar voren kwam.

- **Voorcalculatie accijns per afvulling (§7.1)** — bij elke afvulling wordt nu automatisch de potentiële accijnsschuld berekend en bevroren opgeslagen op basis van ABV/Plato/volume + tarief uit de stamgegevens. Zichtbaar op het batchverpakkingsformulier en in de afvullingstabel. Werkt zowel via `BatchesPage` als `AfvullenPage`.
- **Voorcalculatie bij afboekingen (§7.2.1)** — bij het registreren van vermis, intern gebruik of vernietiging toont BrewAdmin direct het accijnsbedrag dat met de afboeking gemoeid is. Bedrag wordt vastgelegd op de mutatie en meegenomen in het maandoverzicht.
- **Verklaring vernietiging vanuit schorsingsregeling (§7.2.3)** — vernietiging-mutaties hebben nu een statusflow `aangevraagd → toegestaan → uitgevoerd` met verplichte upload van de Douane-verklaring (PDF) en bewijsmateriaal (foto/video) bij `uitgevoerd`.
- **Voorcalc + kleurcodering bij inventarisatie (§7.3)** — afwijkingen tonen direct de accijnsimpact (verschil × voorcalc per eenheid). Totaalbalk splitst tekorten en overschotten.
- **Voorraadverloop met potentiële accijnsschuld (§7.4)** — gereed-product-rapport bevat de kolom "Pot. accijnsschuld (€)" en totaal per periode. Excel-export bevat de extra kolommen.
- **Webshop §10.2: belastbaar feit bij picken** — voor consumentenorders verlaten goederen de AGP op het moment van picken, niet bij verzenden. BrewAdmin maakt vanaf nu de Uitslag- en AccijnsRecord-records aan tijdens `savePicks`. De afrond-flow vult alleen bestemmingsdetails aan en maakt factuur/pakbon. Pickmodal toont een Douane-banner.
- **4-ogen-controle op aangiftes (§12.2 + §12.4)** — controleblokken op zowel accijns- als BTW-aangifte met reviewer (default Elise Kok), controle-datum, bevindingen en statussen `open / akkoord / opmerkingen`. Accijnsaangifte kan pas naar `ingediend` na `akkoord`. Alle controleacties belanden in het `audit_log`.
- **Nieuw datatype:** `btw_aangiftes` (`useStore('btw_aangiftes', [])`) — wordt meegenomen in export, import en reset.

### Fixed — kwaliteitspas op v2.4-implementatie
- **Runtime crash AccijnsPage** — verwijzing naar niet-bestaande `getGn(...)` in de lopende-maand-tabel vervangen door `getGnForRecord(...)`. Voorheen ReferenceError zodra je een lopende maand zonder aangifte-view opende.
- **Backup-dekking** — `useStore('btw_aangiftes')` is nu opgenomen in `excelExport`/`excelImport` (sheet `BtwAangiftes`). Voorheen ging de 4-ogen-controlevastlegging op BTW-aangiftes verloren bij een Excel-roundtrip.
- **Voorcalc-snapshot consistent** — `AfvullenPage` zet net als `BatchesPage` de drie `voorcalc_*`-velden bij het aanmaken van een afvulling, zodat de claim "bevroren op afvullingsmoment" voor élke afvulling klopt.
- **Type-interfaces aangevuld** — `BatchesPageProps` (`preNieuwBatch`, `setPreNieuwBatch`) en `BestellingenPageProps` (`klanten`, `setKlanten`) declareren nu de props die `App.tsx` doorgeeft.
- **i18n volledig hersteld** — alle door v2.4 geïntroduceerde gebruikersgerichte teksten lopen via `t()` met sleutels in alle 5 taalbestanden. Drie reeds ontbrekende oude FR/ES-sleutels (`err_confirm_delete_inkoop`, `msg_fetch_error`, `msg_wc_not_active_settings`) ook ingevuld. Pariteit hersteld op 1167+ sleutels per taal.

### Bestanden gewijzigd
- `src/types/index.ts` — uitbreiding `Afvulling`, `Afboeking`, `InventarisatieTelling`, `AccijnsAangifte`. Nieuw: `AfboekingBijlage`, `VernietigingStatus`, `AangifteControle`, `BtwAangifte`, `ControleStatus`.
- `src/utils/calculations.ts` — nieuwe helper `berekenVoorcalcVoorAfvulling()`.
- `src/utils/excel.ts` — nieuwe sheet `BtwAangiftes` voor backup/restore.
- `src/pages/BatchesPage.tsx`, `AfvullenPage.tsx`, `ProductenPage.tsx`, `InventarisatiePage.tsx`, `VoorraadverloopPage.tsx`, `BestellingenPage.tsx`, `AccijnsPage.tsx`, `BoekhoudingPage.tsx` — implementatie + i18n.
- `src/App.tsx` — `btwAangiftes` store toegevoegd, doorgegeven aan `BoekhoudingPage`.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe v2.4-sleutels.

---

## [1.9.4] — 2026-04-24

### Fixed — Dashboard toonde "Invalid Date" bij cold-crash start

`fmtD` plakte altijd `T12:00:00` achter de input, wat prima werkt voor
`YYYY-MM-DD`-strings maar een volledige ISO-timestamp corrumpeerde
(`…Z` + `T12:00:00` → onparseerbaar). `cold_crash_datum` wordt opgeslagen
als `new Date().toISOString()`, dus op het dashboard stond altijd
"Gestart: Invalid Date".

- `fmtD` detecteert nu of de input al een `T`-separator bevat en parseert
  ISO-timestamps direct. Bestaande callsites met `YYYY-MM-DD` blijven werken.
- Ongeldige input levert lege string i.p.v. "Invalid Date".

## [1.9.3] — 2026-04-24

### Fixed — Cold-crash tick crashte op "can't subtract offset-naive and offset-aware datetimes"

De frontend slaat `cold_crash_laatste_stap` op met `new Date().toISOString()`,
wat altijd UTC met `Z`-suffix oplevert (offset-aware). De backend deed echter
`datetime.datetime.now()` (offset-naive) en kon daarom geen `now - last_dt`
uitrekenen. Gevolg: in elke tick een exception en geen enkele stap.

- `now` gebruikt nu `datetime.datetime.now(datetime.timezone.utc)`.
- `last_dt` wordt genormaliseerd: `Z` → `+00:00` vóór `fromisoformat`, en
  naive timestamps uit oudere batches krijgen alsnog UTC-tzinfo.

## [1.9.2] — 2026-04-24

### Fixed — Cold-crash reageert nu binnen een minuut en logt diagnostisch

De cold-crash-stapper zat mee in de auto-metingen-loop (elke 10 min). Daardoor
kon er na het uur-moment nog tot 10 min vertraging zitten voor het setpoint
werd verlaagd, en waren er geen logregels om te zien waarom een stap niet
gebeurde.

- Eigen `_cold_crash_loop` thread gestart die elke 60 seconden tikt. De
  ramp-stap blijft strikt uurlijks (alleen de reactietijd is sneller).
- `_cold_crash_tick` logt nu expliciet waarom een batch wordt overgeslagen:
  `climates_enabled=false`, geen climate gekoppeld, setpoint niet te lezen,
  target bereikt, set_temperature faalde. Als er >0 actieve batches zijn en
  het uur nog niet voorbij is, volgt elke 10 min een heartbeat-regel.
- Iedere geslaagde stap logt `batch X: setpoint → Y°C (N stap(pen))` zoals
  voorheen.

Bekijk `Addons → BrewAdmin → Log` om te zien wat de thread aan het doen is.

## [1.9.1] — 2026-04-24

### Added — Cold-crash toggle en live voortgangsindicator op het Dashboard

Aanvulling op 1.9.0: de cold-crash-ramp draait in de achtergrond-thread van de
server (dus ook als de app-tab dicht staat), maar dat was op het Dashboard niet
zichtbaar.

- Cold-crash-knop gedraagt zich nu als een toggle. Tijdens een actieve
  cold-crash verschijnt een knipperende paarse pill ("Cold-crash actief")
  met daarnaast een **Stop**-knop. Als het setpoint het target bereikt,
  wordt de pill groen ("Target bereikt").
- Onder de pill staat een regel met het huidige setpoint → target, de
  ramp-snelheid, en een aftelling "Volgende stap over X min" (elke 30s
  ververst op de UI). Zo is in één oogopslag te zien dat de app bezig is.
- Stoppen wist alleen de cold-crash-metadata op de batch; het status-veld
  blijft op Conditioneren staan.

## [1.9.0] — 2026-04-24

### Changed — Cold-crash verloopt nu geleidelijk in plaats van direct

Voorheen werd bij het starten van de cold-crash het setpoint van het gekoppelde
climate-apparaat ineens op de doeltemperatuur gezet; de ramp-snelheid was
slechts een referentiewaarde.

- Bij klikken op de cold-crash-knop wordt het setpoint nu één ramp-stap onder
  het huidige setpoint gezet (begrensd door het target).
- Een achtergrondthread in `server.py` verlaagt vervolgens elk uur het
  setpoint met de geconfigureerde `ramp_per_uur`, tot de doeltemperatuur is
  bereikt. De laatste stap wordt per batch bijgehouden in
  `cold_crash_laatste_stap`, dus onderbrekingen (app gesloten, server
  herstart) halen hun achterstand automatisch in.
- `settings_coldcrash_desc` in alle 5 talen bijgewerkt om het nieuwe gedrag
  te beschrijven.

## [1.8.99] — 2026-04-23

### Changed — Instellingen-pagina: multi-column layout op brede schermen

De Instellingen-content zat met een `max-w-2xl` cap (672px), waardoor
op een breed scherm alle cards smal onder elkaar stonden met veel lege
ruimte rechts.

- Max-width cap verwijderd; content gebruikt nu de volledige beschikbare
  breedte naast de linker-navigatie.
- Op schermen ≥1280px (xl) stromen de cards in 2 kolommen via
  CSS `columns: 2`. Elke card krijgt `break-inside-avoid` zodat hij
  niet over de kolom-grens splitst.
- Brede cards (Auditlog, Accijnstarieven per jaar, Goederenstroom-AGP,
  Batch-taken) krijgen `[column-span:all]` zodat ze over beide kolommen
  blijven — dat zijn de secties met een brede tabel of horizontale
  flow die te smal zou worden in een enkele kolom.
- Op mobiel/tablet/desktop-tot-1280px blijft alles 1-koloms (zoals
  voorheen), zonder regressies.

## [1.8.98] — 2026-04-23

### Added — Accijnstarieven per jaar + impact-rapport

Accijnstarieven kunnen nu per jaar worden vastgelegd. Elke batch gebruikt
bij berekening automatisch het tarief van het brouwjaar (fallback:
root-level tarief). Historische berekeningen blijven dus correct wanneer
het tarief mid-jaar of met terugwerkende kracht wijzigt.

- **Nieuwe tab-card "💶 Accijnstarieven per jaar"** in Instellingen →
  Financieel, onder de bestaande accijns-card. Tabel met kolommen jaar,
  €/hL×ABV%, €/hL basis, €/hL×Plato, notitie.
- **📊 Impact-knop** per jaar: opent een modaal rapport dat elke batch
  van dat jaar herberekent met het voorgestelde nieuwe tarief en toont:
  oude accijns, nieuwe accijns, verschil per batch, en totaal. Kleurcode:
  rood = bijbetalen, groen = retour. Inclusief CSV-export en print.
- **Retro-situatie support**: handig als de bieraccijns met
  terugwerkende kracht stijgt of daalt — je ziet meteen wat er per batch
  nog verschuldigd is of terug te ontvangen.
- `AccijnsInst.tarieven_historie: AccijnsTariefJaar[]` — nieuw veld.
  `tariefVoorDatum(inst, datum)` helper kiest het geldende tarief.
  `accijnsCalcBatch` en alle relevante callers (App.tsx, AgpPage,
  BestellingenPage, tankAccijnsWaarde, agpOverzicht, agpValueAt) kijken
  nu naar het jaar van de batch.
- `berekenAccijnsImpact(batches, inst, jaar, nieuwTarief)` helper
  produceert het impact-rapport.

### Changed

- **Inkoop-factuurbijlagen** verhuizen terug van **Bedrijf** naar
  **Financieel** (accounting-bewaarplicht hoort bij de financiële
  administratie).

### Fixed

- `saveTarieven`/`resetTarieven` wisten voorheen het hele `accijnsInst`
  object; nu wordt `tarieven_historie` en andere velden behouden.

## [1.8.97] — 2026-04-23

### Changed — Cold-crash preset verhuist naar Brouwerij-tab

Cold-crash is conceptueel een brouwproces­instelling (doeltemperatuur,
ramp-snelheid) vergelijkbaar met de conditioneren-duur in Planning-
defaults — dat de trigger-knop via een HA-climate-call loopt is een
implementatie­detail. De card is daarom verhuisd van **Home Assistant**
naar **Brouwerij**, direct onder Planning-defaults. HA-sectie bevat nu
alleen nog de pure integratie (sensoren, climate/dimmer/switch entities).

## [1.8.96] — 2026-04-23

### Changed — Instellingen-pagina herindeling

De Instellingen-pagina had door recente uitbreidingen 9 tabbladen en een
paar dubbele `activeSection`-blokken, waardoor sommige kaarten op een
onlogische plek stonden. Navigatie is teruggebracht naar 8 heldere tabs:

- **🏭 Brouwerij** — branding, tanks, planning-defaults
- **🏢 Bedrijf** *(nieuw)* — bedrijfsgegevens, factuurlogo,
  factuurvelden, verzendkosten, inkoop-factuurbijlagen-download
- **💶 Financieel** — accijns, BTW-periode, BTW-tarieven, AGP,
  GN-codes (uit eigen tab hierheen)
- **🔗 Koppelingen** — Brewfather, WooCommerce, Claude AI
- **🏠 Home Assistant** — sensoren, climate, dimmers, switches,
  cold-crash
- **🗂 Categorieën** *(nieuw)* — ingrediënttypen, kostensoorten,
  mutatielog-opruim (drie losse tabs samengevoegd)
- **📋 Batch-taken** — ongewijzigd
- **⚙️ App** — thema, taal, data import/export, backup, audit

Geen dubbele `activeSection`-blokken meer. Geen verwijderde
functionaliteit — alle kaarten verhuisd naar hun logische tab.
Nieuwe i18n-sleutels `settings_bedrijf` en `settings_categorieen`
toegevoegd in alle 5 talen.

## [1.8.95] — 2026-04-23

### Added — Tanktijd berekenen uit vergistingsprofiel + conditioneren-basis

De tanktijd op zowel Planning als Batch-info kan nu berekend worden vanuit
het vergistingsprofiel van de batch plus een instelbare conditioneren-duur.

- **Instellingen → Brouwerij → Planning-defaults**: nieuw card met
  `Conditioneren-duur` (dagen, default 14). Dit is de basis die bij de
  som van de vergistingsstappen wordt opgeteld.
- **Batch-info**: naast het tanktijd-invoerveld verschijnt een 🔢 Bereken
  knop. Klikken zet tanktijd = som(vergistingsprofiel.tijd + ramp/24) +
  conditioneren-dagen (afgerond naar boven). De tooltip toont de splitsing.
  Knop is disabled als er geen vergistingsprofiel is. Het invoerveld
  blijft vrij editeerbaar — de gebruiker kan de berekende waarde altijd
  overschrijven.
- **Planning-tabel**: zelfde 🔢 knop inline naast de tanktijd-cel, zodat
  je meerdere batches achter elkaar kunt berekenen zonder naar Batch-info
  te navigeren.
- Nieuwe data-key `planning_instellingen` + opgenomen in Excel-backup
  export/import.
- Nieuwe type `PlanningInst` + utility-functies `sumVergistingDagen()`
  en `berekenTanktijd()` in `src/utils/calculations.ts`.

## [1.8.94] — 2026-04-23

### Changed — Tankkaart: metingen nu boven klimaatpaneel

De volgorde op elke tankkaart op het Dashboard is aangepast zodat de
frequent gebruikte meet-acties bovenaan staan:

1. Tank visueel + batch-info
2. SG-voortgangsbalk
3. + Meting toevoegen
4. Klimaatpaneel (setpoint/HVAC) + vergistingsschema + cold-crash knop

Voorheen stond het klimaatpaneel tussen tank-info en SG-voortgang in.

## [1.8.93] — 2026-04-23

### Added — Tank climate control, vergistingsschema & cold-crash op Dashboard

Het Dashboard laat nu per tank met een gekoppeld climate-apparaat een
compacte controlepaneel zien. Daarnaast is er een cold-crash preset dat
centraal geconfigureerd wordt.

- **Climate op tankkaart**: huidige temperatuur + setpoint + HVAC-modus
  direct bedienbaar vanuit het Dashboard. Elke 60s ververst gelijk met
  de bestaande sensor-refresh.
- **Vergistingsschema**: toont alle stappen uit `batch.vergistingsprofiel`
  met de actieve stap gehighlight, hoeveel dagen er verstreken zijn en
  hoeveel er nog gepland staan (inclusief "gepland verlopen"-markering).
  Met een dropdown of ◀/▶ knoppen kun je direct naar een andere stap;
  bij doorklikken wordt het setpoint meteen naar het climate-apparaat
  gestuurd.
- **Cold-crash preset** in Instellingen → Home Assistant: doeltemperatuur
  (°C) + ramp-snelheid (°C/uur). De waarden worden getoond op de
  tankkaart naast de cold-crash knop.
- **Cold-crash knop** per tank (als er een climate gekoppeld is): zet
  het climate-setpoint direct naar de doeltemperatuur, wijzigt de batch
  naar status `Conditioneren` en slaat `cold_crash_datum`, `_target` en
  `_ramp` op de batch op voor audit/trace.
- Batch-type: nieuwe velden `vergisting_stap_idx`, `vergisting_stap_start`,
  `cold_crash_datum`, `cold_crash_target`, `cold_crash_ramp`.
- Nieuwe data-key `coldcrash_instellingen` + toegevoegd aan Excel-backup
  (export en import) zodat instellingen meereizen.

## [1.8.92] — 2026-04-23

### Changed — HA entity-picker: zoekveld, type-filter en PWM-herdefinitie

Opvolger van 1.8.91. Twee verbeteringen:

- **Zoek- en typefilter**: elke entity-dropdown (sensor, climate, light, switch)
  heeft nu een zoekveld erboven dat filtert op entity_id én friendly name.
  Voor elk domein met meerdere `device_class`-waarden komt er bovenin ook
  een dropdown "Alle types" om bv. alleen temperature-sensoren te tonen.
  Het aantal gefilterde/totaal wordt in de placeholder getoond.
- **Dimmers als PWM i.p.v. lamp**: het `light`-domein wordt in brouwsetups
  vooral gebruikt als PWM-regeling (hitte-elementen, regelbare pompen,
  ventilatoren) — niet voor verlichting. Sectie hernoemd naar
  "Dimmers (PWM)", slider-label naar "Vermogen (PWM duty)", placeholders
  passen daarbij. De onderliggende HA-service-calls blijven identiek
  (`light.turn_on` met `brightness_pct`).

## [1.8.91] — 2026-04-23

### Added — Home Assistant: Climate, Dimmers & Switches

De Home Assistant-koppeling ondersteunde tot nu toe alleen temperatuur­sensoren
(lezen). Vanaf deze versie kunnen ook **klimaatapparaten**, **dimbare
verlichting** en **switches** gekoppeld én **bestuurd** worden vanuit
Instellingen → Home Assistant.

- **Climate** (thermostaten, koelcellen, HVAC): koppeling per entiteit,
  optioneel aan een tank; setpoint (`set_temperature`) en HVAC-modus
  (`set_hvac_mode`) direct instellen; "Auto setpoint" om het
  vergistingsprofiel te volgen.
- **Lampen & dimmers**: aan/uit en helderheidsslider (0–100%) via
  `light.turn_on` / `light.turn_off`; min%/max% om de slider te begrenzen
  (bijv. een warmtelamp nooit boven 60%).
- **Switches**: `switch.turn_on`, `switch.turn_off` en `toggle` voor pompen,
  ventilatoren, verwarming en andere brouwapparatuur.
- **Entity-discovery**: een "Entiteiten ophalen"-knop per domein vult een
  dropdown met alle beschikbare entities (geen handmatig typen meer nodig).
- **Security**: de HA-proxy (`/api/homeassistant/_service/<domain>/<service>`)
  heeft een strikte whitelist op toegestane services en valideert dat het
  entity_id in het juiste domein zit.
- Instellingen zitten in dezelfde `ha_instellingen` key en reizen dus
  automatisch mee in de Excel-backup.

## [1.8.90] — 2026-04-23

### Changed — Eén unified batch-takensysteem (vervangt 4 losse systemen)

In een batch werden voorheen vier aparte "af te vinken"-lijsten getoond:
hygiëne-checklist, brouwdag-checklist, botteldag-checklist en CCP-monitoring.
Dat leverde vier configuratieplekken in Instellingen en vier secties in de
batch-weergave op.

Vanaf deze versie is dat één systeem geworden: **Batch-taken**. Elke taak is
ofwel een aanvink-item (`check`) of een numerieke meting met limieten
(`meting`). Taken worden in zelfgekozen groepen gezet (bv. Voorbereiding,
Brouwdag, Botteldag, Kritische controlepunten) en samen getoond in één sectie
per batch. De CCP-afwijking → automatische CAPA-flow blijft identiek.

- Nieuwe data-keys: `batch_taken_items`, `batch_taken_groepen`.
- Nieuwe instellingensectie: "Batch-taken" (vervangt "Hygiëne" + "Checklists").
- Nieuw batch-veld: `taken_checks: Record<number, boolean>`.
- Bestaande gebruikers: bij eerste load worden hygiëne-items, brouwdag- en
  botteldag-checklists en CCP-definities automatisch samengevoegd tot het
  nieuwe model; afgevinkte items en metingen blijven behouden.
- Oude data-keys blijven op de server staan voor veiligheid (read-only).
- Backup (Excel): nieuwe sheets `BatchTakenItems` en `BatchTakenGroepen`.

## [1.8.89] — 2026-04-23

### Added — Live alcoholpercentage uit SG-metingen + expliciet accijns-ABV

Op het batch-detailpaneel toont de sectie "Gistingsvoortgang" nu het
actuele alcoholpercentage, berekend uit de SG-metingen tijdens de
vergisting (formule: `ABV = (OG − FG) × 131.25`). Zolang de gisting
loopt wordt het gemarkeerd als *voorlopig*.

Daarnaast staat naast de berekende waarde een duidelijk invoerveld
**"ABV voor accijns"** dat direct schrijft naar `batch.ABV` — het veld
dat `accijnsCalcBatch` gebruikt voor de accijnsberekening. Een
"Neem over"-knop kopieert de berekende waarde één-op-één naar het
accijnsveld.

- **Frontend** (`src/pages/BatchesPage.tsx`): nieuwe berekening- en
  invoerrij in de fermentatie-progressiesectie; gebruikt
  `berekenLiveABV` om OG (of eerste SG) en laatste SG-meting te
  combineren.
- **Utils** (`src/utils/calculations.ts`): nieuwe helpers `berekenABV`
  (OG/FG → %) en `berekenLiveABV` (batch + metingen → actuele ABV met
  bron-indicatie).
- **i18n**: 8 nieuwe sleutels in nl/en/de/fr/es.

## [1.8.88] — 2026-04-22

### Fixed — Logo's raken niet meer weg bij Excel-backup import

Voorheen schreef `excelExport` de logo's wél als argument door, maar ze
belandden niet in het Instellingen-sheet (het oude compromis "te groot
voor cellen"). Bij import werd `instMap['app_logo']` dus `undefined` en
liet de `|| null`-fallback het bestaande logo wissen.

- **Export** (`src/utils/excel.ts`): `app_logo` en `factuur_logo`
  worden als base64 in het Instellingen-sheet geschreven. Bij base64
  groter dan de Excel-cel-limiet (~32767 chars) wordt de string
  opgesplitst in chunks van 30 000 tekens (`app_logo__0`,
  `app_logo__1`, …).
- **Import**: nieuwe `readLogo(key)` leest het logo uit een enkele cel
  óf voegt de chunks weer aaneen. Ontbreekt de sleutel volledig in de
  backup, dan retourneert het `undefined` zodat `doImport` het
  bestaande logo ongemoeid laat (eerder werd dat naar `null` gezet).
- Backward compatible: oudere backups zonder logo-velden overschrijven
  niets meer, en backups met één enkele logo-cel blijven leesbaar.

---

## [1.8.87] — 2026-04-22

### Added — Aanpasbare brouwdag- en botteldag-checklists
- **Instellingen → Checklists**: nieuwe sectie waar de items van de
  Brouwdag- en Botteldag-checklist volledig aanpasbaar zijn. De
  standaardlijst (12 brouwdag- + 9 botteldag-items) staat vooringevuld,
  maar items kunnen worden verwijderd, hernoemd (klik op een item om te
  bewerken), herschikt met pijltjes omhoog/omlaag, en nieuwe items
  kunnen worden toegevoegd. Knoppen voor "Terugzetten naar standaard"
  per checklist. De per-batch checklist op de detailpagina gebruikt
  automatisch de ingestelde items.
- Nieuwe datasleutels `brouwdag_checklist` en `botteldag_checklist`
  (incl. Excel-backup/restore).

---

## [1.8.86] — 2026-04-22

### Added — Batch-ingredienten koppelen aan voorraad-ingredienten

- In de batch-detailweergave (ingrediënten-tabel) staat nu naast de
  ingrediëntnaam een koppel-pill. Wanneer de naam niet overeenkomt
  met een voorraad-ingrediënt verschijnt een oranje "Koppelen"-knop
  die een dropdown opent met alle voorraad-ingredienten van het
  juiste type (Mout/Hop/Gist/Suiker/Overig). Bij expliciete koppeling
  verschijnt een blauwe 🔗-pill.
- De koppeling werkt op **groepsniveau**: alle batch-regels met
  hetzelfde `ingredient_id` of dezelfde naam krijgen in één keer de
  nieuwe koppeling. Handig bij meerdaagse dryhops of gefaseerde
  giststortingen waar dezelfde ingredient vaker voorkomt.
- Hergebruikt de i18n-sleutels uit v1.8.85 (`recipe_link_auto`,
  `recipe_link_edit`, `recipe_link_none`).

---

## [1.8.85] — 2026-04-22

### Added — Recept-ingredienten koppelen aan voorraad-ingredienten

- In de recept-detailweergave staat nu een extra kolom "Gekoppeld aan"
  met per rij een koppel-control. Als de recept-ingrediëntnaam exact
  overeenkomt met een voorraad-ingrediënt wordt die automatisch
  getoond; bij afwijkende namen verschijnt een oranje "Koppelen"-knop
  die een dropdown opent met alle ingredienten van het juiste type
  (Mout/Hop/Gist/Overig — voor "Overig" wordt ook "Suiker" getoond).
- `ReceptIngredient` uitgebreid met `ingredient_id?: number | null`.
  De voorraadcheck (`checkStock`) geeft voorrang aan deze expliciete
  koppeling en valt terug op naam-matching voor backward compat.
- Bij de "Brouwen"-actie wordt `ingredient_id` meegegeven aan
  `BatchIngredient`, zodat de batch direct gekoppeld start.
- De Brewfather-sync bewaart gebruikersgekoppelingen: per recept-id
  en per sectie wordt op naam gematcht om `ingredient_id` over te
  nemen van de oude naar de nieuwe receptversie.
- Versie-snapshots zijn alleen-lezen; koppelen kan alleen op de
  huidige versie.
- Nieuwe i18n-sleutels (nl/en/de/fr/es): `recipe_linked_to`,
  `recipe_link_auto`, `recipe_link_edit`, `recipe_link_none`.

---

## [1.8.84] — 2026-04-22

### Added — Brewfather-recept-versies ophalen en tonen

- De Brewfather-sync haalt nu per recept ook de versie-snapshots op via
  `GET /recipes/{id}/versions`. Snapshots worden als aparte, alleen-
  lezen entries onder het hoofdrecept getoond met een collapsible
  versie-lijst en een versie-pill in de detail-header.
- Nieuwe helpers `bfMapRecipe()`, `bfGetRecipeVersions()` en
  `bfGetRecipesWithVersions()` in `src/utils/api.ts`. Versies worden
  in parallelle batches van 10 opgehaald.
- Defensief: als het versies-endpoint niet beschikbaar is (404/403/501),
  slaat de sync dit stil over en toont de melding
  `msg_bf_sync_no_versions`.
- `Recept` interface uitgebreid met `versie`, `versie_id`, `parent_id`,
  `is_huidige` en `versie_datum`. Backward compatible: bestaande
  recepten zonder deze velden gedragen zich als huidige versie, en
  bestaande batch-/productkoppelingen via `recept_id`/`rid` blijven
  matchen op de parent `_id`.
- Brouwen is alleen mogelijk vanaf de huidige versie; snapshots tonen
  een "alleen-lezen" label.
- Nieuwe i18n-sleutels (nl/en/de/fr/es): `recipe_version_current`,
  `recipe_version_snapshot`, `recipe_version_readonly`,
  `recipe_versions_count`, `msg_bf_sync_with_versions`,
  `msg_bf_sync_no_versions`.

---

## [1.8.83] — 2026-04-22

### Added — Brewfather-batchnummer zichtbaar in batch-detail

- In de batch-detail-header wordt nu naast het app-eigen `#batch_nummer`
  ook `BF #brewfather_batch_nummer` getoond (alleen als dat veld
  gevuld is, voorafgegaan door een bullet-scheiding).
- In de info-grid (`BatchesPage.tsx:1309`) is een nieuwe rij
  "Brewfather #" toegevoegd, alleen zichtbaar voor batches die via
  Brewfather zijn geïmporteerd.
- Nieuwe i18n-sleutel `batch_info_bf_batch_nr` in nl/en/de/fr/es.

---

## [1.8.82] — 2026-04-22

### Fixed — Brewfather-sync koppelt geen batches meer verkeerd

Voorheen kon een Brewfather-sync twee verschillende batches per ongeluk
aan elkaar koppelen omdat matching naast `brewfather_id` ook op een
toevallige gelijkenis tussen app-`batch_nummer` en BF-`batchNo`
plaatsvond. Dat overschreef status, OG/FG/ABV, rendement en vergistings-/
maischprofielen van de verkeerde batch en plakte die permanent aan het
verkeerde `brewfather_id` vast.

### Changed — App-eigen batchnummering losgekoppeld van Brewfather

- **Nieuw veld** `brewfather_batch_nummer` (zie `src/types/index.ts`) houdt
  het Brewfather-`batchNo` als losstaande referentie bij; `batch_nummer`
  blijft het app-eigen nummer. Bij bestaande batches vult de sync
  `brewfather_batch_nummer` één keer aan (zonder te overschrijven).
- **Bij nieuwe BF-import** kent de app automatisch een eigen volgnummer
  toe via de gedeelde helper `nextBatchNummer(batches)` in
  `src/utils/calculations.ts` (zelfde logica als de "Nieuwe batch"-knop:
  prefix/jaar/padding behouden, staart met 1 verhoogd).
- **Sync matcht alléén nog op `brewfather_id`** (in `App.tsx` auto-sync
  én `BatchesPage.tsx` `runBfSync`). Zo kan toevallige gelijkenis tussen
  twee onafhankelijke nummerruimten nooit meer leiden tot verstrengelde
  batches.

---

## [1.8.81] — 2026-04-22

### Changed — Fermentatiegrafiek: X-as vanaf Vergisten-moment

- De X-as van de gistgrafiek (`FermentatieGrafiek` in `BatchesPage.tsx`)
  start nu bij het moment dat de batch op **Vergisten** ging, niet bij de
  eerste meting. Bron: eerste `tank_historie`-entry met
  `status='Vergisten'`, fallback `batch.datum`. Zo is de volledige
  fermentatie-aanloop zichtbaar — óók als de eerste meting pas later is
  gedaan.
- Een groene gestippelde verticale lijn met label "Vergisten" markeert
  het startmoment in de grafiek (alleen zichtbaar als het vóór de eerste
  meting ligt en binnen de huidige zoomview valt).
- Nieuwe i18n-sleutel `batch_gist_start` in alle 5 talen.

---

## [1.8.80] — 2026-04-22

### Fixed — Nette afhandeling van rate-limit-fouten (HTTP 429)

- **Server**: de 429-respons (`{"error":"too many requests"}`) bevat voortaan
  een `Retry-After`-header met het aantal seconden tot de oudste request in
  het per-IP-venster vervalt, zodat clients weten hoe lang te wachten.
- **Frontend (`src/utils/api.ts`)**: alle calls naar `/api/data/`,
  Brewfather, WooCommerce, Home Assistant en Claude gaan nu via
  `_fetchWithRetry`, die automatisch opnieuw probeert bij 429 met respect
  voor de `Retry-After`-header (min. 1s, max. 30s). 429-responses tellen
  niet meer mee als sync-fout en de client hamert de server niet langer.
- **UI**: de `SyncDot` heeft een nieuwe oranje pulserende status
  **rate_limited** met de tooltip "Te veel verzoeken — even wachten"
  (5 talen), zodat de gebruiker onderscheid ziet tussen een echte
  verbindingsfout en tijdelijke throttling.

---

## [1.8.79] — 2026-04-18

### Added — Auto-invul batchnummer bij nieuwe batch
- Het veld **Batch #** wordt bij het aanmaken van een nieuwe batch
  automatisch ingevuld met het volgende opeenvolgende nummer, afgeleid
  van de meest recente bestaande batch. De numerieke staart wordt met 1
  verhoogd met behoud van prefix en zero-padding (bv. `B-2026-012` →
  `B-2026-013`). Werkt zowel voor de gewone "Nieuwe batch"-knop als voor
  batches die vanuit een recept worden aangemaakt. Fallback bij een lege
  lijst: `B-{huidigjaar}-001`.

---

## [1.8.78] — 2026-04-18

### Added — Visuele tank-bezetting + slimme tank-keuze in batchformulier
- **PlanningPage**: de oude gegroepeerde "Tank-planning" is vervangen door
  een horizontale Gantt-achtige tijdlijn. Één rij per tank, bars met de
  bezetting per batch (datum → datum + tank_dagen). Kleuren markeren de
  status: Gepland (amber), Vergisten (groen), Conditioneren (paars).
  Gestippelde rand betekent dat er geen `tank_dagen` is ingevuld en er een
  default van 14 dagen wordt getoond. Lopende batches in Vergisten/
  Conditioneren tellen mee, niet alleen de geplande.
- **BatchesPage** (nieuw-/bewerk-formulier):
  - Tank-dropdown toont naast elke tank of hij vrij is of bezet door welke
    batch (met bezettingsperiode) — gebaseerd op datum-overlap, niet meer
    alleen "is er ergens een actieve batch".
  - Nieuw veld **Tanktijd (dgn)** naast Tank en Datum; wordt opgeslagen
    als `batch.tank_dagen`.
  - Inline waarschuwing onder de tank-dropdown als de geselecteerde tank
    overlapt in de planning.
  - Bij opslaan: confirm-dialog bij niet-blokkerende datum-overlap (Gepland);
    harde block blijft voor actief gebruik (Vergisten/Conditioneren) zoals
    voorheen.
- i18n: nieuwe sleutels `plan_status_gepland`, `plan_status_vergisten`,
  `plan_status_conditioneren`, `plan_tank_legend_schatting`,
  `plan_tank_schatting`, `plan_geen_tanks`, `tank_vrij`, `tank_bezet`,
  `tank_overlap_waarschuwing`, `err_tank_overlap` (nl/en/de/fr/es).

---

## [1.8.77] — 2026-04-18

### Fixed — Gist-grafiek: data van verwijderde batch niet meer zichtbaar op nieuwe batch
- `removeBatch` (BatchesPage) cascade-ruimt nu alle aan de batch gekoppelde
  records op: `afvullingen`, `gist_metingen`, `carbonatie_sessies`,
  `verlies_registraties`, `ccp_metingen` en batch-log-entries. Voorheen bleven
  deze achter met `batch_id` dat verwees naar de verwijderde batch.
- `newId` hergebruikt het laagste vrije id, dus een nieuw aangemaakte
  (geplande) batch kon het id van een eerder verwijderde batch overerven,
  waardoor oude gistmetingen plotseling in de gist-grafiek van de nieuwe
  geplande batch verschenen. Cascade-cleanup voorkomt deze "spookdata".

---

## [1.8.76] — 2026-04-18

### Fixed — Planning behoefte: reeds afgeboekte ingrediënten niet meer meegeteld
- `aggregateBatchNeeds` negeert nu `batch_ingredienten` met
  `afgeboekt: true`. Die items zijn al gededuceerd uit de voorraad en horen
  niet meer als "nodig" in de bestellijst/planning te verschijnen. Dit
  voorkomt dat ingrediënten van een reeds gebrouwen batch per ongeluk bij
  de behoefte van een geselecteerde geplande batch opgeteld leken.

---

## [1.8.75] — 2026-04-18

### Changed — Planning: tank-toewijzing + tanktijd per brouwdag
- Nieuw veld `tank_dagen` op Batch: geplande tank-bezetting in dagen.
- **PlanningPage** lijstweergave: brouwdag, tank en tanktijd zijn nu
  inline-bewerkbare invulvelden. Een extra kolom "Tank vrij op" toont de
  afgeleide einddatum (`datum + tank_dagen`).
- Nieuwe sectie **"Tank-planning"** groepeert de geplande brouwsels per
  tank met hun bezettingsperiode (start → eind) en dagen, zodat je in
  één oogopslag ziet wanneer welke tank bezet is.
- i18n-sleutels `plan_tank_tijd`, `plan_tank_vrij_op`, `plan_tank_planning`,
  `plan_zonder_tank`, `plan_dagen` in nl/en/de/fr/es.

---

## [1.8.74] — 2026-04-18

### Added — Planningsmodule: brouwagenda + bestellijst
- **DashboardPage**: nieuwe sectie "Brouwagenda" toont de eerstvolgende 8
  geplande brouwsels (status `Gepland` met `datum ≥ vandaag`). Klik op een
  regel opent de Planning-pagina met die batch vooraf-geselecteerd.
- **Nieuwe Planning-pagina** (`src/pages/PlanningPage.tsx`) met twee
  weergaven: maand-grid (7×6, maandag-eerst) en lijst. Multi-select van
  geplande brouwdagen via checkboxes plus "Alles deze maand" / "Selectie
  leegmaken"-shortcuts. Zoek in de lijstweergave op biernaam.
- **Behoefte vs voorraad**: voor de geselecteerde batches wordt de
  aggregaat-ingrediëntbehoefte per categorie (mout/hop/gist/overig)
  afgezet tegen de huidige voorraad (som van actieve lots).
  Eenheidverschillen worden automatisch omgerekend waar mogelijk;
  incompatibele eenheden krijgen een waarschuwing.
- **BestellijstModal** (`src/components/BestellijstModal.tsx`): bekijkbare
  lijst met alleen de tekorten, gegroepeerd per categorie, met laatste
  leverancier uit de meest recente lot. Sessie-lokale "besteld"-checkboxes.
- Nieuwe helpers in `src/utils/calculations.ts`: `scaleRecipeNeeds`,
  `aggregateBatchNeeds`, `compareNeedsToStock`.
- Navigatie: nieuwe submenu-entry "Planning" onder "Brouwerij".
- i18n-sleutels (`nav_planning`, `plan_*`) toegevoegd in nl/en/de/fr/es.

---

## [1.8.73] — 2026-04-18

### Added — BTW-aangifte indienen + dashboard-signalering openstaande aangiftes
- Nieuwe data-key `btw_aangiftes` (array van `{periodeKey, ingediend_datum,
  bedrag}`), opgenomen in Excel-backup/-import.
- **BoekhoudingPage**: openstaande BTW-periode-kaart krijgt nu een knop
  "Aangifte ingediend". Daarna verandert de status naar "Ingediend"
  (amber) en verschijnt een koppel-selector met een voorgesteld-match-
  groep voor banktransacties binnen € 1 van het aangifte-bedrag (BTW
  wordt afgerond op hele euro's). MT940-import koppelt automatisch een
  debittransactie met dezelfde tolerantie.
- **DashboardPage**: nieuwe oranje stat-cards "BTW-aangifte open" en
  "Accijnsaangifte open" verschijnen alleen als de afgelopen periode
  resp. afgelopen maand nog niet als ingediend is gemarkeerd. Klik
  navigeert naar de boekhouding.
- i18n-sleutels toegevoegd in nl/en/de/fr/es.

---

## [1.8.72] — 2026-04-18

### Changed — SearchInput met loep-icoon + uniforme knopmaat Producten
- `SearchInput` toont nu links een loep-icoon (inspringing via `pl-9`) —
  alle zoekvelden in de app krijgen dit vanzelf.
- Placeholder `ph_product_zoek` vereenvoudigd naar "Zoek product" (nl/en/
  de/fr/es).
- `btn_wc_push_stock`-knop op ProductenPage heeft nu dezelfde hoogte en
  padding als de `+ Product`-knop (`px-4 py-1.5 text-sm rounded-lg`).

---

## [1.8.71] — 2026-04-18

### Changed — ProductenPage in BatchesPage-stijl
- Titel en actieknoppen (inclusief `+ Product`) staan nu rechtsboven boven de
  lijst, consistent met BatchesPage.
- Lijst is omgezet van thumbnail-kaarten naar compacte rij-weergave met
  `flex-1 min-w-0` detail-pane, `w-60` sidebar en mobile back-knop.
- Gearchiveerde producten verhuizen van checkbox-toggle naar ingeklapt
  `SectionHeader`-blok onderaan de lijst.
- Logboek staat nu als volledig-brede sectie onder de lijst i.p.v. in de
  smalle sidebar.
- Knoplabel `btn_nieuw_product` genormaliseerd naar `+ Product` in nl/en/de/
  fr/es.

---

## [1.8.70] — 2026-04-18

### Changed — Uniforme sectieheaders & zoekbalken
- Nieuwe UI-primitives `SectionHeader` en `SearchInput` in `src/components/ui/`.
- Alle klikbare sectieheaders gebruiken nu dezelfde afgeronde bruine `t-hdr`
  balk met links één roterend `▶` en extra info rechts zonder achtergrondkleur.
- Alle zoekvelden op Recepten, Batches, Ingrediënten, Producten en HACCP
  delen dezelfde stijl (border, padding, focus-ring).
- **AccijnsPage**: maand-kaart-header is niet meer groen/amber afhankelijk van
  status; de statuspill blijft semantisch gekleurd maar staat rechts in de
  headerbalk.
- **BatchesPage**: emoji's 🍺, 🛢, 🫙, 🖨, ↪ verwijderd uit de batch-detail-
  header en knoplabels.
- **Dashboard**: navigatieheaders (open bestellingen, HACCP-widget, actieve
  batches) tonen nu het links-roterende `▶` in plaats van `→` rechts.

---

## [1.8.69] — 2026-04-17

### Added — S-5: Negatieve-voorraad-signalering
- **DashboardPage**: nieuwe rode stat-card "Negatieve voorraad" die alleen
  verschijnt als er één of meer voorraadposities met een negatief saldo zijn.
  Klik navigeert naar de voorraadverloop-pagina.
- **VoorraadverloopPage**: nieuwe tab **Controle negatieve voorraad** met
  detaillijst (batch #, product, verpakking, locatie, voorraad) en een
  **CSV-export**-knop. Toont uitleg over oorzaken (uitlevering groter dan
  voorraad op locatie, onjuiste verplaatsingen, dubbele afboekingen) en
  suggereert correctie via inventarisatie of mutatie-aanpassing.
- **utils/calculations.ts**: nieuwe helpers `voorraadPerLocatieRaw()` (zonder
  normalisatie naar 0) en `getNegatieveVoorraadPosities()` bouwen op de
  bestaande `voorraadPerLocatie`-logica; geen nieuwe data-stores nodig.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.68] — 2026-04-17

### Added — S-4: Brouwdag- & botteldag-checklists (HACCP Bijlage A.1 / A.2)
- **BatchesPage**: twee nieuwe checklists per batch, uitklapbaar en standaard
  ingeklapt. De **brouwdag-checklist** (12 items — A.1) verschijnt in de
  `Brouwen`-fase naast de bestaande hygiëne-checklist. De **botteldag-checklist**
  (9 items — A.2) verschijnt bij de afvul-/botteling-stap.
- Voortgang wordt per batch opgeslagen in de nieuwe velden `brouwdag_checks`
  en `botteldag_checks` op `Batch` (beide `Record<number, boolean>`) en via
  de bestaande Excel-backup automatisch meegenomen.
- Elk item (vinken/ontvinken/reset) logt naar de audit-trail.
- Routinekarakter — helpend, niet blokkerend voor batch-statuswijzigingen.
- **constants.ts**: `DEFAULT_BROUWDAG_CHECKLIST` (12) en
  `DEFAULT_BOTTELDAG_CHECKLIST` (9) met i18n-labelKeys.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.67] — 2026-04-17

### Added — M-1: Bijzondere mutaties (vermis / intern gebruik / vernietiging)
- **ProductenPage**: het afboek-modaal kreeg tabbladen per reden. Voor de reden
  **vernietiging** is een Douane-compliance-paneel toegevoegd met verplichte
  velden: toestemming Douane (checkbox), toestemmingsdatum, kenmerk/referentie
  en minimaal één bewijsbijlage (foto of PDF). Zonder deze velden kan de
  afboeking niet worden opgeslagen.
- Bewijsmateriaal wordt via `/api/upload/{filename}` op de add-on-server
  opgeslagen. Toegestane formaten: PDF, JPG, PNG, GIF, WebP, TIFF, BMP,
  HEIC/HEIF (video niet ondersteund — expliciet alleen in-app, geen
  automatische Douane-e-mail).
- **types/index.ts**: Afboeking uitgebreid met `toestemming_douane`,
  `toestemming_datum`, `kenmerk_douane` en `bijlagen: AfboekingBijlage[]`;
  nieuwe `AfboekingBijlage`-interface.
- Audit-log registreert iedere vernietigings-afboeking met verwijzing naar
  de bijlagen.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.66] — 2026-04-16

### Added — Bierverlies-registratie module
- Nieuwe "Verliesregistratie" sectie op de batch-detailweergave waar verlies
  per bron (tankrest, leidingrest, schuim, monsters, afgekeurde flessen,
  overig) met datum, liters en notitie kan worden vastgelegd.
- Per batch tonen we het totaal geregistreerde verlies, het afgeleide verlies
  (liter_vergist − totaal afgevuld) en het nog-niet-toegewezen deel, plus een
  uitsplitsing per bron.
- Het kostprijsblok toont onder "Verlies" een klikbare snelkoppeling naar de
  registratie-sectie. De kostprijs per liter blijft afgeleid van het
  werkelijk afgevulde volume.
- Nieuwe data-sleutel `verlies_registraties` (patroon van `gist_metingen` /
  `carbonatie_sessies`); opgenomen in Excel-backup en -restore.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.65] — 2026-04-16

### Added — Dashboard: HACCP taken widget
- Nieuwe widget op het dashboard toont achterstallige en vandaag-te-doen
  schoonmaaktaken direct, zonder naar de HACCP-pagina te hoeven navigeren.
- Per taak is een **Uitvoeren**-knop beschikbaar die een inline formulier opent
  (Uitgevoerd door, Opmerking, CIP-cyclus) — analoog aan de bestaande inline
  gistmeting op tankkaarten.
- Open CAPA's worden eveneens in de widget getoond met status-badge.
- Bij alle taken bijgewerkt toont de widget een groene "Alles bijgewerkt ✓" staat.
- De widget-header is klikbaar en navigeert naar de volledige HACCP-pagina.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.64] — 2026-04-16

### Fixed — Bestellingen: verwarrende dubbele "Annuleren" knoppen
- In de bevestigingsdialoog voor het annuleren van een bestelling stonden twee
  knoppen met exact dezelfde tekst "Annuleren". De bevestig-knop toont nu
  "Ja, annuleren" zodat duidelijk is welke knop de bestelling daadwerkelijk
  annuleert en welke de dialoog sluit.

---

## [1.8.63] — 2026-04-15

### Added — Carbonisatie: tanktemperatuur uit HA-sensor
- **BatchesPage**: in de Carbonisatie-sectie wordt de actuele tanktemperatuur
  nu automatisch gebruikt als pre-fill wanneer er een Home Assistant-sensor
  aan de tank van de batch gekoppeld is. Een **🌡 HA: x.x°C** knop onder het
  tanktemperatuur-veld neemt de meting met één klik over.
- **Placeholder**: het invoerveld toont de live sensorwaarde als placeholder
  zodat de gebruiker direct ziet welke temperatuur de tank heeft.
- **i18n**: nieuwe sleutel `carb_use_sensor_tooltip` (NL/EN/DE/FR/ES).

---

## [1.8.62] — 2026-04-15

### Added — Carbonisatie per batch (CO₂ + carb stone of kopdruk)
- **BatchesPage**: nieuwe **Carbonisatie**-sectie in de `Conditioneren`-fase
  per batch. Brouwer kiest methode (carb stone of kopdruk), doel-CO₂ in vols
  en tanktemperatuur. De app berekent live de benodigde **kopdruk in bar +
  PSI** (Henry's-law lineaire benadering) én het benodigde **CO₂-gewicht** in
  gram (opgelost + totaalverbruik incl. verliesfactor). Dit laat een brouwer
  met een weegschaal onder de fles werken zonder Zahm-Nagel meter.
- **Live indicator** tijdens een actieve sessie: groen / geel / rood naast
  het verbruikt-CO₂-veld — vergelijkt de werkelijke gewichtsname tegen het
  doel (±10% groen, ±25% geel, >25% rood).
- **Standaard CO₂-volumes per bierstijl** (case-insensitive `includes` op
  `batch.stijl`): Pils/Lager/IPA → 2.5, Weizen → 3.2, Stout → 2.0, Saison →
  3.0, Cider → 3.5 (fallback 2.5). Pre-fillt het doel-veld bij start.
- **Sessie-historie**: tabel onder de actieve sessie met alle voltooide en
  afgebroken sessies (datum, methode, doel, druk, verbruikt CO₂, gemeten,
  duur, status). Eén actieve sessie per batch tegelijk.
- **Verpakt-overgang**: bij `Conditioneren → Verpakt` waarschuwt de app als
  er geen voltooide carbonisatie is geregistreerd. Niet blokkerend.

### Data
- Nieuwe datasleutel `carbonatie_sessies` (array). Volgt het `gist_metingen`-
  patroon: gepersisteerd in `/data/carbonatie_sessies.json`, opgenomen in
  Excel-backup als sheet `CarbonatieSessies`, audit-log via entiteit
  `Carbonatiesessie`.
- Nieuw type `CarbonatieSessie` in `src/types/index.ts`.

### Helpers (calculations.ts)
- `carbDrukBar(vols, tempC)` — lineaire Henry's-law benadering (±0.05 bar
  in 0–10 °C / 1.8–3.8 vols)
- `co2GramOpgelost(vols, L)` — opgeloste massa via `1.9632 g/L per vol`
- `co2GramTotaalVerbruik(vols, L, verlies)` — opgelost × (1 + verlies)
- `barToPsi(bar)` — eenheidsconversie
- `defaultCarbVols(stijl)` — pre-fill via `CARB_DEFAULT_VOLS` lookup

### i18n (nl/en/de/fr/es)
- Nieuw: 41 `carb_*`-sleutels (titel, methode, doel, indicatorlabels,
  status, knoppen, bevestigingsdialogen).

## [1.8.61] — 2026-04-14

### Added — Voorraad per locatie + locatie-keuze bij picken
- **ProductenPage**: elke afvulling toont nu per locatie hoeveel er beschikbaar
  is (bv. `AGP: 20×`, `Magazijn: 10×`) als pills onder de regel. Voorraad in AGP
  krijgt een paarse badge, voorraad buiten AGP een blauwe.
- **Picking modal (BestellingenPage)**: bij elke pick-regel verschijnt een
  locatie-dropdown waarin de gebruiker kan kiezen uit welke voorraad-locatie
  het bier gepakt wordt. De opties tonen de huidige beschikbare hoeveelheid
  per locatie. "Automatisch" laat het systeem zelf kiezen (niet-AGP eerst,
  dan AGP) — bestaand gedrag.
- **Validatie**: bij het opslaan van picks wordt gecontroleerd of de gekozen
  locatie voldoende voorraad heeft; anders foutmelding met locatie-naam.
- **`BestellingPick.bron_locatie_id`**: nieuw optioneel veld; bij order
  afronden wordt de `Uitlevering` met deze locatie aangemaakt (accijns wordt
  alleen geboekt als de gekozen locatie AGP is).

### i18n (nl/en/de/fr/es)
- Nieuw: `picking_bron_locatie`, `picking_locatie_auto`,
  `err_locatie_voorraad_ontoereikend`, `lbl_agp_voorraad`,
  `lbl_niet_agp_voorraad`.

---

## [1.8.60] — 2026-04-14

### Changed — "Uitslaan" terminologie opschonen
Volledige rename van de verkoop-entiteit naar `Uitlevering` conform de AGP-definitie:
"Uitslaan = bier uit de AGP halen" (via uitlevering óf verplaatsing AGP → niet-AGP).

- **Datamodel**: `Uitslag` → `Uitlevering`, `TypeUitslag` → `TypeUitlevering` met nieuwe
  waarde `'intern'`. `AccijnsRecord.uitslag_id` → `uitlevering_id`,
  `bron: 'uitslag'` → `'uitlevering'`. `EADDocument.uitslag_id` → `uitlevering_id`.
- **Afboeking**: reden `'intern_gebruik'` verwijderd — verhuisd naar de
  uitlevering-flow mét accijnsboeking (`type_uitlevering = 'intern'`).
- **AgpPage**: bij AGP → niet-AGP verplaatsing wordt nu ook een `voorraad_log`
  entry met type `'uitslaan'` aangemaakt (dit is óók AGP-exit).
- **VoorraadPage**: misleidende instructie "Sla bier uit via de Batches pagina"
  verwijderd uit de leegstaat.
- **UI-labels**: "Uitgeslagen" → **"Uitgeleverd"** in verkoopcontext
  (ProductenPage-tegel, VoorraadPage, BatchesPage, AfvullenPage, DashboardPage).
  AGP-context behoudt terecht "Uitslag/Uitgeslagen voorraad".
- **Backup (Excel)**: sheet `Uitslagen` → `Uitleveringen`, met fallback-migratie
  voor oude backups.
- **Data-migratie**: one-shot bij app-load — oude `uitslagen`-sleutel wordt
  omgezet naar `uitleveringen`, `AccijnsRecord`-velden worden hernoemd, en
  `intern_gebruik`-afboekingen worden geconverteerd naar uitleveringen mét
  accijnsboeking. Beveiligd met een localStorage-flag `brewadmin_migrated_uitlevering_v1`.

### i18n (nl/en/de/fr/es)
- Nieuw: `lbl_product_uitgeleverd`, `voorraad_uitgeleverd`, `batch_stat_uitgeleverd`,
  `filling_summary_uitgeleverd`, `stock_date_uitgeleverd`, `stock_no_uitgeleverd`,
  `lbl_units_uitgeleverd`, `lbl_type_uitlevering`, `ead_gekoppelde_uitlevering`,
  `type_uitlevering_intern`.
- `stock_no_uitgeleverd` bevat geen verwijzing meer naar de Batches-pagina.
- `stock_archive_count` gebruikt nu "gearchiveerd" i.p.v. "uitgeslagen".

---

## [1.8.59] — 2026-04-14

### Added — Voorraad per locatie zichtbaar bij picken + uitgeslagen-tegel
- **Picking modal**: per afvulling-optie wordt nu de voorraadverdeling per locatie
  getoond (bv. "AGP: 20, Magazijn: 10"). Per reeds toegevoegde pick-regel
  verschijnt onder de regel een kleine info-tekst met de huidige verdeling.
- **ProductenPage**: extra KPI-tegel "Uitgeslagen" naast Beschikbare voorraad,
  toont totaal aantal uitgeslagen eenheden per product.
- Nieuwe helper `voorraadPerLocLabel(a)` in `BestellingenPage` die compact
  voorraad per locatie weergeeft.

### Changed — Naamswijziging "Voorraad buiten AGP" → "Uitgeslagen voorraad"
- Sectie-titel op AGP-pagina hernoemd in alle 5 talen
- Bijbehorende empty-state melding aangepast

### i18n
- Nieuw: `lbl_product_uitgeslagen`, `picking_voorraad_per_locatie` in
  nl/en/de/fr/es

---

## [1.8.58] — 2026-04-14

### Added — Historische gemiddelden op AGP-tegels
- Nieuwe tegel "Totale accijnswaarde AGP" (verpakt + tank)
- Onder elke accijnstegel staan nu kleine subregels met:
  - Gemiddelde waarde van vorige maand
  - Gemiddelde waarde van dit jaar
  - In januari ook het gemiddelde van vorig jaar (omdat dit jaar nog kort is)
- Tegellabels expliciet voorzien van "in AGP" / "(AGP)" zodat duidelijk
  is dat de waarden over de accijnsgoederenplaats gaan
- Nieuwe helpers `agpValueAt(datum,...)` en `gemAgpInPeriode(start,end,...)`
  in `calculations.ts` die de AGP-waarde reconstrueren uit historische
  events (afvullingen, uitslagen, verplaatsingen, afboekingen)

---

## [1.8.57] — 2026-04-14

### Changed — AGP als top-level menu + correctie tank-statussen
- AGP-overzicht verplaatst van Accijns-tab naar eigen pagina in hoofdmenu (`AgpPage`)
- TANK_STATUSSEN gecorrigeerd: `Vergisten` (i.p.v. `Gisten`) — tanks met bier in vergisting waren onzichtbaar
- Afvulling-veldnamen genormaliseerd: gebruikt nu `hoeveelheid`/`inhoud_per_eenheid` met fallback op `aantal`/`inhoud_liter` — verpakte voorraad werd niet getoond

---

## [1.8.56] — 2026-04-14

### Added — AGP-inzicht & verplaats-flow
- Nieuw `Locatie`-model met `is_agp`-vlag; standaardlocatie "AGP" wordt automatisch geseed
- Nieuw `Verplaatsing`-model voor stockmutaties tussen locaties (met automatische accijnsboeking bij vertrek uit AGP)
- Nieuw tabblad **AGP** in Accijns-pagina toont voorraad en accijnswaarde van bier in tank (geschat ABV uit OG) en verpakt
- Verplaats-modal: stock buiten AGP halen → genereert AccijnsRecord met bron `'verplaatsing'`
- Locatiebeheer-modal: locaties toevoegen, hernoemen, verwijderen (AGP beschermd)
- Verkoop-flow splitst pick per locatie: niet-AGP eerst (geen extra accijns), AGP-deel boekt accijns
- `Uitslag.bron_locatie_id`, `AccijnsRecord.bron`/`verplaatsing_id`, `BestellingPick.uitslag_ids/accijns_ids` toegevoegd
- Locaties + verplaatsingen meegenomen in Excel backup/restore

---

## [1.8.55] — 2026-04-14

### Fixed — Accijns pagina crash
- `getGn(a.batch_id)` → `getGnForRecord(a)` — niet-bestaande functie veroorzaakte runtime error

---

## [1.8.54] — 2026-04-14

### Changed — Inkoop factuur modal
- Label "Aankoopdatum" hernoemd naar "Factuurdatum" in het inkoop factuur formulier
- Bij een betaalde factuur wordt bovenin de modal "Betaald op: [datum]" getoond
- Betaaldatum wordt ook opgehaald uit eerder gekoppelde bankmutaties (bankTransacties + bankKoppelingen fallback)

---

## [1.8.52] — 2026-04-14

### Added — CCP Monitoring in batch detail
- **CCP-sectie** bij de hygiëne-checklist in de batch-detailweergave
- Snel CCP-metingen registreren per batch met dropdown, waarde, datum en uitvoerder
- Automatische limiet-check met visuele groen/rood indicator
- Bij afwijking wordt automatisch een CAPA aangemaakt
- Metingenlog met status per batch
- Badge toont aantal metingen en eventuele afwijkingen

---

## [1.8.51] — 2026-04-13

### Added — NVWA/HACCP Compliance pagina
- **Nieuwe HACCP-pagina** met 9 tabs: Dashboard, Schoonmaak, CCP Monitoring,
  Allergenen, Traceerbaarheid, CAPA, Waterkwaliteit, Ongedierte, Opleidingen
- **Schoonmaakschema**: Definieer terugkerende schoonmaaktaken (dagelijks/wekelijks/
  maandelijks/per batch) met logboek en achterstallig-indicator
- **CCP Monitoring**: Definieer Critical Control Points met grenswaarden, registreer
  metingen per batch. Automatische CAPA-aanmaak bij afwijkingen
- **Allergenenbeheer**: Allergeenmatrix op ingrediënten met automatische per-batch
  allergeendeclaratie afgeleid uit batch-ingrediënten
- **Traceerbaarheidstool**: Trace forward (lot → batch → verpakking → klant) en
  backward (batch → lot → leverancier) met mock recall rapportgenerator
- **CAPA**: Corrigerende acties registratie met statusworkflow (open → in behandeling → afgerond)
- **Waterkwaliteit**: Testregistratie met pH, hardheid, chloor en waarschuwing bij >6 maanden
- **Ongediertebestrijding**: Controle- en waarnemingslogboek
- **Opleidingen**: Medewerkersopleidingen met geldigheid en verloopwaarschuwing
- **Dashboard**: Compliance-overzicht met kleurgecodeerde statuscards
- **8 nieuwe data keys** voor HACCP-registraties (haccp_schoonmaak_taken, etc.)
- **Excel backup**: Alle HACCP-data meegenomen in export/import
- **i18n**: Alle 5 talen (NL/EN/DE/FR/ES) voorzien van ~120 HACCP-sleutels
- **Allergeen-veld** toegevoegd aan Ingredient type (gluten, gerst, tarwe, etc.)

---

## [1.8.50] — 2026-04-13

### Added — Hygiëne groepen hernoembaar in instellingen
- **Inline hernoemen**: Klik op een groepsnaam in Instellingen → Hygiëne om deze
  te hernoemen. Enter bevestigt, Escape annuleert. Duplicaatnamen worden geblokkeerd.

---

## [1.8.49] — 2026-04-13

### Fixed — Lot-informatie verdwenen door Brewfather-eigenschappen
- **Layout fix**: Het Brewfather-properties blok was een apart flex-item in de
  desktop layout waardoor de lots tabel weggedrukt werd. Nu zitten de lots card
  en het Brewfather blok samen in één `flex-1` wrapper zodat ze verticaal
  gestapeld worden.

---

## [1.8.48] — 2026-04-13

### Added — Filter "Alleen op voorraad" op ingrediëntenpagina
- **Checkbox**: Boven de ingrediëntenlijst staat nu een vinkbox "Alleen op voorraad"
  die ingrediënten zonder voorraad verbergt. Instelling wordt onthouden via `useStore`.

---

## [1.8.47] — 2026-04-13

### Enhanced — Alle Brewfather ingrediënt-eigenschappen ophalen
- **Complete data**: Brewfather ingrediënt sync haalt nu alle beschikbare
  eigenschappen op (`complete=true`): alfazuur, kleur, rendement, vergistingsgraad,
  temperatuurbereik, uitvlokking, herkomst, etc.
- **bf_props veld**: Extra Brewfather-eigenschappen worden opgeslagen in `bf_props`
  op het Ingredient object (behalve voorraad, THT en productiedatum).
- **Detail weergave**: Bij het selecteren van een ingrediënt worden alle
  Brewfather-eigenschappen getoond in een compact grid onder de lots tabel.
- **i18n**: Labels voor 30+ Brewfather-veldnamen in alle 5 talen.

---

## [1.8.46] — 2026-04-13

### Fixed — Gist afboeken eenheidsconversie (stuk/stuks/pkg)
- **Bug fix**: Bij het afboeken van gist in een batch kwam de foutmelding
  "Kan stuk niet omrekenen naar stuks". De eenheden `stuk`, `stuks` en `pkg`
  zijn nu als equivalente count-eenheden geregistreerd in `UNIT_BASE`.
- **Data fix**: Brewfather batch import gebruikte `'stuk'` als eenheid voor
  gist, gewijzigd naar `'stuks'` (de standaard eenheid in de app).

---

## [1.8.45] — 2026-04-13

### Added — Brewfather ingrediënten import + voorraad push
- **Ingrediënten sync**: Nieuwe "Sync Brewfather" knop op de ingrediëntenpagina
  importeert alle ingrediënten (fermentables, hops, yeasts, miscs) vanuit
  Brewfather's inventory API. Deduplicatie op `brewfather_id` of naam.
- **Type mapping**: Brewfather fermentable subtypes worden correct gemapt
  (Grain/Extract → Mout, Sugar/Honey → Suiker, Adjunct/Juice → Overig).
- **Voorraad push**: Per ingrediënt met Brewfather-koppeling kan de totale
  voorraad gepusht worden naar Brewfather via PATCH API.
- **Server PATCH proxy**: Nieuwe `_bf_proxy_patch()` route in server.py
  voor write-operaties naar de Brewfather API.

---

## [1.8.44] — 2026-04-13

### Fixed — Kostensoort in inkoop popup op ingrediëntenpagina
- **Bug fix**: De kostensoort-dropdown in de inkoop boeken popup op de ingrediëntenpagina
  gebruikte altijd de standaard kostensoorten in plaats van de aangepaste instellingen.
  De `kostenSoorten` prop wordt nu correct doorgegeven van App → IngredientenPage → InkoopFactuurModal.

---

## [1.8.43] — 2026-04-13

### Added — HA User Login Tracking & Audit Trail Gebruiker
- **Login-tracking**: Bij het openen van de app wordt automatisch gedetecteerd
  welke Home Assistant gebruiker ingelogd is (via `window.__hass.user`).
  Er wordt een audit trail entry aangemaakt met actie "Ingelogd" (met 5-min dedup).
- **Automatische gebruiker in audit trail**: Alle bestaande audit entries krijgen
  nu automatisch de naam van de ingelogde HA-gebruiker mee via `setAuditUser()`.
- **Gebruiker-kolom in audit trail**: De audit trail tabel in Instellingen toont
  nu een "Gebruiker" kolom zodat zichtbaar is wie elke actie heeft uitgevoerd.
- **HAUser type**: Nieuw `HAUser` interface (id, name, is_admin, is_owner) als
  voorbereiding op toekomstig accountbeheer en restricties.
- **i18n**: Nieuwe vertaalsleutels voor login-tracking in alle 5 talen.

## [1.8.42] — 2026-04-13

### Added — Hygiëne checklist in audit trail
- **BatchesPage**: Elk afvinken/ongedaan maken van een hygiëne-item per batch
  wordt nu gelogd in de audit trail, inclusief groep- en itemnaam.
- Ook de "checklist reset" actie wordt gelogd.

## [1.8.41] — 2026-04-13

### Fixed — Build error: esbuild `as` casts in parameter defaults
- Verwijderd `as any[]` / `as any` type casts uit destructured parameter defaults
  in 7 pagina-bestanden. Esbuild ondersteunt deze syntax niet in default values.

## [1.8.40] — 2026-04-13

### Added — Uitgebreide audit trail logging
- **Alle pagina's** loggen nu mutaties naar de audit trail via `logAudit()`:
  - BatchesPage (11): status, tank, aanmaken, bewerken, afvullen, metingen
  - IngredientenPage (21): ingrediënt/lot CRUD, correcties, afboeken, ontvangst
  - InstellingenPage (31): tanks, credentials, thema, taal, accijns, BTW, hygiëne, ingTypes
  - BoekhoudingPage (22): in-/verkoopfacturen, klanten, bankkoppelingen, kapitaal
  - ProductenPage (9): producten, artikelen, WooCommerce sync
  - BestellingenPage (9): orders, picks, afronden, annuleren, vrije regels
  - AccijnsPage (5): aangifte status, maand betaald, e-AD documenten
  - StatiegeldPage (3): verpakkingen, creditnota's
  - InventarisatiePage (3): inventarisaties aanmaken/afronden
  - DashboardPage (2): gistmetingen
  - ReceptenPage (2): Brewfather sync
- **118 logAudit calls** in totaal, waardoor elke data-mutatie in de app
  wordt vastgelegd met entiteit, actie, omschrijving en timestamp.

## [1.8.39] — 2026-04-13

### Fixed — Race condition HA gist_metingen sync
- **api.ts**: `useStore` retourneert nu een derde `refresh()`-functie die
  server-data ophaalt en lokaal bijwerkt **zonder** terug te posten naar de
  server. Voorkomt dat de periodieke sync lokale wijzigingen overschrijft.
- **App.tsx**: HA gist_metingen periodic sync gebruikt nu `refresh()` in
  plaats van de save-functie. Dit voorkomt de race condition waarbij net
  toegevoegde metingen werden overschreven met verouderde server-data.

## [1.8.38] — 2026-04-13

### Fixed — Brewfather sync overschrijft handmatige status niet meer
- **App.tsx / BatchesPage.tsx**: Brewfather sync kan batchstatus alleen nog
  *vooruit* zetten in de lifecycle (Gepland→Brouwen→Vergisten→Conditioneren→
  Verpakt→Gesloten), niet meer achteruit. Voorkomt dat handmatige statuswijzigingen
  (bijv. "Conditioneren") worden teruggedraaid naar een eerdere Brewfather-status
  (bijv. "Vergisten").
- **api.ts**: `_syncErrors` reset verplaatst naar na `r.ok` check, zodat
  foutstatussen niet gemaskeerd worden.

## [1.8.37] — 2026-04-13

### Fixed — Caching-problemen opgelost
- **server.py**: `Cache-Control: no-store` header toegevoegd aan alle API-responses,
  `Cache-Control: no-cache, must-revalidate` aan de SPA HTML-response. Voorkomt
  dat browsers verouderde data of een oude app-versie serveren.
- **api.ts**: `modified` flag in `useStore` reset nu na succesvolle server-sync,
  zodat server-updates niet permanent genegeerd worden na een lokale wijziging.
- **api.ts**: `_syncErrors` teller reset naar 0 bij succesvolle sync, zodat de
  sync-indicator (SyncDot) niet permanent op fout blijft staan na een tijdelijke
  netwerkstoring.
- **api.ts**: `Cache-Control: no-cache` header toegevoegd aan fetch-calls om
  browser-caching van API-requests te voorkomen.

## [1.8.36] — 2026-04-13

### Fixed — Dubbel puntje gistgrafiek header
- **BatchesPage**: Groen pulserend bolletje vervangt nu de ▶ chevron bij actieve
  vergisting, zodat er geen twee puntjes naast elkaar staan.

## [1.8.35] — 2026-04-13

### Changed — Alleen handmatige metingen tellen in header
- **BatchesPage**: Aantal metingen in gistgrafiek header telt alleen handmatige
  metingen, niet de automatische.

## [1.8.34] — 2026-04-13

### Fixed — Actief-bolletje gistgrafiek header
- **BatchesPage**: Pulserend groen bolletje terug bij "Actief" indicator in de
  gistgrafiek header (was verloren gegaan bij t-hdr omzetting).

## [1.8.33] — 2026-04-13

### Changed — Automatische metingen zonder punten in grafiek
- **BatchesPage**: Automatische metingen (server-side) tonen alleen de lijn in de
  gistgrafiek, geen puntjes. Handmatige metingen behouden hun punten.

## [1.8.32] — 2026-04-13

### Changed — Server-side automatische gistingsmetingen
- **server.py**: Automatische 10-minuut temperatuurmetingen draaien nu server-side
  in een achtergrondthread, onafhankelijk van of de app open is in de browser.
- **App.tsx**: Client-side auto-fetch verwijderd; periodieke sync (5 min) haalt
  server-side metingen op zodat ze zichtbaar worden in de UI.

## [1.8.31] — 2026-04-13

### Fixed — Vergistingsgrafiek header kleurstelling
- **BatchesPage**: Header van de gistgrafiek gebruikt nu `t-hdr` themastyling
  (was `bg-gray-50` grijs) met `→` pijl, consistent met alle andere secties.

## [1.8.30] — 2026-04-13

### Added — Product & SKU selectie bij afvullen
- **BatchesPage**: Verplicht productveld toegevoegd aan het afvulformulier. Een
  batch kan nu naar verschillende producten afgevuld worden.
- **BatchesPage**: Automatische SKU-weergave op basis van product + verpakking
  combinatie. Als geen SKU bestaat, kan deze inline worden aangemaakt.
- **BatchesPage**: Inline nieuw product aanmaken via simpel naamveld.
- **BatchesPage**: Product- en SKU-kolom toegevoegd aan afgevulde voorraad-tabel.
- **ProductenPage**: Voorraadberekening prefereert nu `afvulling.product_id`
  boven `batch.product_id` voor nauwkeurigere productkoppeling.
- **BestellingenPage**: Picking-logica uitgebreid met `afvulling.product_id`.
- **Types**: `product_id` en `artikel_sku` toegevoegd aan Afvulling interface.

## [1.8.29] — 2026-04-12

### Changed — Tank in batch header
- **BatchesPage**: Huidige tank wordt getoond in de batch header (naast
  batchnummer/stijl) met een icoontje (🫙 fermentatie, 🛢 barrel). Alleen
  zichtbaar als de batch actief in een tank zit (status Vergisten/Conditioneren).

## [1.8.28] — 2026-04-12

### Improved — Batch info UI responsive + gistingsvoortgang
- **BatchesPage**: Header-knoppen wrappen nu op mobiel (status dropdown
  full-width, compactere knoppen).
- **BatchesPage**: Gistingsvoortgangsbalk (SG progress) is nu zichtbaar in de
  batch-detailweergave, identiek aan het dashboard — altijd zichtbaar boven de
  inklapbare info-sectie.
- **BatchesPage**: Batch info-sectie is standaard ingeklapt.
- **BatchesPage**: Kostenoverzicht grid is responsive (1 kolom op mobiel,
  2 kolommen op tablet+).

## [1.8.27] — 2026-04-12

### Fixed — Vergistingsprofiel duur uit Brewfather
- **api.ts**: `bfGetRecipes()` gebruikte `actualTime` (unix-ms-timestamp) als
  fallback voor `stepTime` — hierdoor werden vergistingsstappen weergegeven als
  bijv. 1775858400000 dagen i.p.v. 14 dagen. Fallback verwijderd.
- **App.tsx / BatchesPage.tsx**: Bij Brewfather-sync wordt het vergistings- en
  maischprofiel nu ook bijgewerkt voor reeds geïmporteerde batches.
- **App.tsx**: Eénmalige data-sanitizer die bij het laden corrupte `tijd`-waarden
  (>365) in bestaande batches herstelt.

## [1.8.26] — 2026-04-11

### Changed — Barrel cradle en bunghole
- **DashboardPage**: `BarrelVisual` heeft nu een compactere, gebogen
  cradle die met dezelfde straal als het vat meeloopt — de bovenkant van
  de wieg volgt de onderkant van de cirkel in plaats van een plat
  trapezium eronder. De cradle is zo'n 2/3e lager dan voorheen.
- **DashboardPage**: de bunghole zit nu als een ellips bovenop het vat
  (op de top van de cirkel) in plaats van op de voorkant, wat het
  perspectief vanaf de voorkant natuurlijker maakt.

## [1.8.25] — 2026-04-11

### Changed — Barrel vanaf de voorkant
- **DashboardPage**: `BarrelVisual` is opnieuw getekend als een ronde
  kopkant gezien vanaf de voorkant — een cirkel met een donkere metalen
  hoepel eromheen, houten duig-naden binnen de kopkant, en een bunghole
  bovenin. De vloeistof vult het vat als een horizontale chord door de
  cirkel. Een trapezoidale houten wieg houdt het ronde vat vast.

## [1.8.24] — 2026-04-11

### Added — Tank-geschiedenis per batch
- **BatchesPage**: nieuwe sectie "Tank geschiedenis" in het batch-info
  blok toont alle tanks waarin de batch heeft gezeten, gestapeld van oud
  naar nieuw. De onderste regel is de huidige tank en telt dagen vanaf
  het moment van verplaatsen (start dus op 0).
- **Batch-interface**: nieuw veld `tank_historie` met entries
  `{tank, from, to?, status}`. `handleMoveTank` en het bewerken van de
  tank via het edit-formulier werken de historie automatisch bij.
  Legacy-batches zonder historie krijgen een gesynthetiseerde eerste
  entry op basis van `batch.datum` + `batch.tank`.
- **DashboardPage**: het "X dagen in tank"-label op de tankkaart gebruikt
  nu de tijd sinds de laatste verplaatsing in plaats van de brouwdatum —
  direct na een move staat de teller op 0.

### Fixed — Brewfather vergistingsprofiel in batches
- `bfMapBatch` in `utils/api.ts` las `s.actualTime` (een unix
  ms-timestamp, bijv. `1775858400000`) als de geplande duur in dagen,
  waardoor het vergistingsprofiel op de batchpagina absurd hoge waarden
  toonde. Nu wordt `s.stepTime` gebruikt — dezelfde bron als de
  recept-mapping — zodat de waarden overeenkomen met wat in het recept
  staat (bijv. 14 d, 2 d).

## [1.8.23] — 2026-04-11

### Fixed — Dashboard tankvormen
- **Bright tank**: de poten zijn nu recht in plaats van licht naar buiten
  hellend, matching de stijl van de fermentor.
- **Barrel**: het houten vat ligt nu horizontaal op een cradle met twee
  driehoekige steunen in plaats van rechtop te staan. De metalen hoepels
  zijn herschikt als verticale banden, de duigen lopen horizontaal langs
  de lengte van het vat, en de bunghole zit bovenop.

## [1.8.22] — 2026-04-11

### Added — Bright tanks, barrels en verplaatsen tussen tanks
- **Tank-instellingen**: elke tank krijgt een soort (`fermentatie`,
  `bright` of `barrel`). Bij het toevoegen kies je de soort en bestaande
  tanks kunnen achteraf omgeschakeld worden via een dropdown.
- **Batch verplaatsen**: in de batch-header verschijnt een
  `↪ Verplaatsen`-knop wanneer de batch in status *Vergisten* of
  *Conditioneren* staat. De inline picker toont alle beschikbare tanks
  (inclusief de soort) en respecteert tank-bezetting. Bij verplaatsen
  van een fermentatietank naar een bright tank of barrel wisselt de
  batch automatisch naar *Conditioneren*. De verplaatsing wordt
  gelogd onder `gewijzigd`.
- **Dashboard**: bright tanks krijgen een rechtopstaande drukketel met
  twee koepels en een drukmeter; barrels worden weergegeven als houten
  vat met duigen en metalen hoepels. Fermentatietanks behouden de
  bestaande conische vorm.

## [1.8.21] — 2026-04-11

### Fixed — Hygiëne-instellingen
- **InstellingenPage**: hygiënegroepen worden nu opgeslagen met het juiste
  veld `naam` (i.p.v. `label`), waardoor toevoegen, weergeven en verwijderen
  van groepen weer correct werkt. De duplicaat-check leest eveneens uit
  `naam`. Nieuwe groepen en items krijgen automatisch een `volgorde`-veld,
  consistent met de defaults.
- **BatchesPage** hygiëne-checklist: groepskoppen en log-referenties tonen
  nu `group.naam` in plaats van het niet-bestaande `group.label`, zodat
  groepsnamen niet meer als `undefined` verschijnen.

## [1.8.20] — 2026-04-09

### Fixed — Productnaam in Voorraadverloop
- **VoorraadverloopPage** toont nu de productnaam (via `product_id`) in plaats van de batchnaam in het gereed product-overzicht. Fallback op `biernaam` en `naam` als er geen product gekoppeld is.

## [1.8.19] — 2026-04-09

### Fixed — Uniforme paginaheaders
- **ProductenPage**: header gebruikt nu standaard `h2 text-gray-800` i.p.v. accentkleur `h1`.
- **VoorraadverloopPage**: paginatitel toegevoegd (ontbrak).
- **InventarisatiePage**: font aangepast naar `text-xl font-bold` (was `text-lg font-semibold`).

## [1.8.18] — 2026-04-09

### Changed — Administratie-menu
- **Administratie-dropdown** toegevoegd met Boekhouding, Inventarisatie, Voorraadverloop en Statiegeld als sub-items.
- **Voorraadverloop** pagina nu bereikbaar via navigatie (was eerder niet gerouteerd).
- **Dropdown-logica gegeneraliseerd** — meerdere dropdown-menu's ondersteunen via dezelfde code.

## [1.8.17] — 2026-04-09

### Changed — Navigatie herstructurering
- **Brouwerij-menu** toegevoegd als dropdown met Ingrediënten, Recepten en Batches als sub-items.
- **Navigatie vereenvoudigd** — minder items op het hoogste niveau, logische groepering van brouwerij-gerelateerde pagina's.

## [1.8.16] — 2026-04-09

### Changed — BierVoorraadPage samengevoegd met ProductenPage
- **BierVoorraadPage verwijderd** — voorraadoverzicht, afboeken en logboek zijn nu geïntegreerd in de Producten-pagina.
- **Logboek** met voorraadmutaties (afvullen, uitslaan, afboeken) en WooCommerce sync-log toegevoegd aan ProductenPage.
- **WooCommerce push** knop verplaatst naar de Producten-pagina.
- **Navigatie vereenvoudigd** — "Voorraad" menu-item verwijderd.

## [1.8.15] — 2026-04-09

### Fixed — Picking en kostensoorten
- **Picking-bug opgelost** — orders met verpakkingstype uit productArtikelen ("fles") matchen nu correct met afvullingen die het oude naam-formaat gebruiken ("Fles 33cL") via de verpakkingen-store.
- **GN-code selector** op artikelniveau met beheerbare codes in Instellingen.
- **BTW incl/excl toggle** op verkoopprijs en B2B-prijs bij productartikelen.
- **B2B-prijs** per artikel, met per-orderregel prijstype (Normaal/B2B) bij bestellingen.
- **Verzendkosten** toevoegbaar bij handmatige bestellingen.
- **Negatief afboeken** toegestaan bij voorraadcorrecties.

## [1.8.14] — 2026-04-09

### Changed — Producten-pagina verbeterd
- **ABV, EBC en IBU** toegevoegd als bierkenmerken op het product.
- **Foto upload limiet** verhoogd van 500KB naar 2MB per afbeelding.
- **Voorraad-overzicht geïntegreerd** in productdetailpagina — per verpakkingstype worden afvullingen, gepickt, uitgeslagen, afgeboekt en beschikbaar getoond, inclusief afboekfunctionaliteit.
- **GN-code verwijderd** van Product (blijft op Batch-niveau).

## [1.8.13] — 2026-04-09

### Added — Producten-pagina
- **Product als first-class entiteit** — nieuw concept dat recepten, batches, voorraad en verkoop verbindt.
- **Producten-pagina** — beheer producten met naam, stijl, categorie, productfoto's (max 5), en gekoppelde recepten.
- **Product-artikelen (SKU's)** — per product meerdere verpakkingsvarianten met artikelnummer, EAN, verkoopprijs en BTW%.
- **Kostprijs & marge** — automatische berekening van kostprijs per liter op basis van ingrediënt- en utilitykosten, met marge per SKU.
- **Product-selector in batches** — bij het aanmaken van een batch kan een product worden geselecteerd, waarmee biernaam, stijl en GN-code automatisch worden ingevuld.
- **Automatische migratie** — bestaande biernamen en artikelen worden automatisch omgezet naar Product-entiteiten bij eerste gebruik.
- **WooCommerce-integratie uitgebreid** — voorraadsync en bestellingen werken nu ook met product-artikelen.
- **Excel backup** — producten en product-artikelen worden meegenomen in backup export/import.

## [1.8.12] — 2026-04-09

### Changed — GN-codes bij afvulling + automatische Plato-berekening
- **GN-codes verplaatst naar afvulling** — GN-code wordt nu per afvulling gekozen (niet meer op batch-niveau), omdat het afhankelijk is van het verpakkingsformaat.
- **Nieuwe GN-codes** — 2203 00 01 (kleine verpakking), 2203 00 09 (groot formaat), 2206 (bier-frisdrankmengsel), 2202 91 00 (alcoholvrij bier).
- **Automatische Plato-berekening** — bij het invullen van OG wordt het platogehalte automatisch berekend. Ook bij Brewfather-sync wordt Plato automatisch afgeleid uit OG.

## [1.8.11] — 2026-04-09

### Added — EBC-bierkleur in tankvisualisatie
- **Realistische bierkleur** — de vloeistof in de fermentatietank toont nu de werkelijke bierkleur op basis van de EBC-waarde uit het recept (SRM-kleurtabel, 40 tinten van lichtgeel tot zwart).
- **Fallback** — zonder EBC-waarde valt de kleur terug op blauw (gisting) of amber (conditionering).

## [1.8.10] — 2026-04-09

### Improved — Fermentatietank-visualisatie op dashboard
- **Nieuwe SVG-tank** — de eenvoudige CSS-rechthoek is vervangen door een realistische conische fermentor met cilindervormig lichaam, conische bodem, manway/dome, poten, voetjes en aftapkraan.
- **Metallic gradient** op de tankwand voor een professionele uitstraling.
- **Geanimeerde bubbels** tijdens actieve gisting (status "Vergisten").
- **Vloeistofvulling** met gradient, oppervlaktegolf en percentage-label, geclipped op de tankvorm.

## [1.8.9] — 2026-04-09

### Improved — Security hardening, code cleanup en dode code verwijderd
- **SSRF bescherming** — `_wc_test()` blokkeert nu requests naar private/interne IP-adressen.
- **Error message hardening** — foutmeldingen lekken geen interne details meer naar de client.
- **CSP aangescherpt** — `unsafe-eval` verwijderd uit Content Security Policy.
- **CORS beperkt** — alleen nog `localhost:5173` en `localhost:8099` als trusted origins.
- **Type safety** — 6x `@ts-ignore` in DashboardPage vervangen door correcte `.getTime()` calls.
- **Dode code verwijderd** — ongebruikte `verpKostenLabels` functie verwijderd, `SUPPORTED_LANGS` niet meer geëxporteerd.
- **i18n opgeschoond** — ~236 ongebruikte vertaalsleutels verwijderd uit alle 5 taalbestanden.

## [1.8.8] — 2026-04-09

### Added — Herinnering, 2e herinnering en aanmaning voor verkoopfacturen
- **Vervallen facturen sectie** — boven de factuurlijst verschijnt een rood gemarkeerd blok met alle facturen waarvan de betaaltermijn verstreken is, direct zichtbaar ongeacht datumfilter.
- **Escalatie-actieknoppen** — elke vervallen factuur toont de volgende logische stap: "1e Herinnering" → "2e Herinnering" → "Aanmaning". Klikken genereert direct het PDF-document én past de status aan.
- **Herinnering/aanmaning PDF** — professionele documenten met brouwerijlogo, klantgegevens, factuurreferentie, openstaand bedrag en nieuwe betaaldeadline. Stijl past zich aan op urgentie (oranje/rood).
- **4 statusniveaus** — facturen kunnen nu `open`, `herinnering`, `tweede_herinnering`, `aanmaning` of `betaald` zijn, elk met eigen badge-kleur (oranje → geel → oranje → rood → groen).
- **Dashboard widget** — vervallen facturen verschijnen als aparte widget op het dashboard met een rode teller-badge en overzicht van de eerste 5. Stat card vervangt BTW-openstaand.
- **Datumlogs** — `herinnering_datum`, `tweede_herinnering_datum` en `aanmaning_datum` worden bijgehouden zodat je weet wanneer elke stap is verzonden.
- **Klant factuurhistorie** — ook in de klant-detailweergave zijn de nieuwe statussen en escalatieknoppen zichtbaar.

---

## [1.8.7] — 2026-04-09

### Added — Bijschrift koppelen aan negatieve inkoopfactuur
- **Creditnota leverancier via MT940** — een bijschrift (geld ontvangen) kan nu ook gekoppeld worden aan een inkoopfactuur met negatief totaalbedrag (creditnota). Een tweede dropdown "of creditnota inkoop:" verschijnt automatisch zodra er open negatieve inkoopfacturen bestaan.
- **Auto-matching** — bij het importeren van een MT940-bestand worden bijschriften nu ook automatisch gematcht aan negatieve inkoopfacturen als er geen verkoopfactuur overeenkomt.
- **Wederzijdse uitsluiting** — koppelen aan inkoop wist automatisch de eventuele verkoopkoppeling en vice versa.

---

## [1.8.6] — 2026-04-09

### Fixed — MT940 beginsaldo
- **Beginsaldo correct bij meerdere statements** — bij MT940 bestanden met meerdere bankafschriften werd het beginsaldo overschreven door het beginsaldo van het laatste statement (dat gelijk is aan het eindsaldo van het voorgaande). Nu wordt alleen het eerste beginsaldo bewaard.

---

## [1.8.5] — 2026-04-09

### Fixed — Banktransactie-koppelingen (onthouden)
- **Dropdown toont nu ook betaalde facturen** — als een onthouden koppeling naar een reeds betaalde factuur verwijst, verschijnt deze alsnog in de dropdown
- **Kapitaalstortingen worden nu correct onthouden** — bij herimport van MT940 wordt `gekoppeldKapitaalId` hersteld
- **Knoppen verborgen bij onthouden koppelingen** — "+Nieuwe boeking" en "+Kapitaalstorting" worden niet meer getoond wanneer een boeking al onthouden is
- **Onthouden koppelingen opnieuw koppelen** — ×-knop naast "↩ Onthouden koppeling" badge om een onjuiste koppeling te wissen en opnieuw in te stellen

---

## [1.8.4] — 2026-04-09

### Added — Factuurvelden zichtbaarheid
- **Zichtbare velden op factuur & pakbon** — per veld instellen welke bedrijfsgegevens op facturen en pakbonnen verschijnen (logo, adres, BTW-nr, KvK, IBAN, e-mail, telefoon, betaalblok)
- **Factuurvoorbeeld** — preview-knop in Instellingen → Brouwerij om direct te zien hoe de factuur eruitziet met de huidige instellingen

---

## [1.8.3] — 2026-04-09

### Added — App reset
- **Reset App knop** — alle data wissen en app herstellen naar fabrieksinstellingen via Instellingen → App, met dubbele bevestiging (typ "RESET")

---

## [1.8.2] — 2026-04-09

### Added — Kostensoorten
- **Kostensoorten op inkoopfacturen** — vrije regels op inkoopfacturen krijgen een kostensoort-dropdown (Grondstoffen, Verpakkingsmateriaal, Energie, Huur, Transport, Onderhoud, Marketing, Administratie, Overig)
- **Dynamische Winst & Verlies rapportage** — inkoopkosten worden nu per kostensoort uitgesplitst in plaats van de vaste driedeling ingrediënten/verpakking/overig
- **Aanpasbare kostensoorten** — eigen kostensoorten toevoegen, hernoemen of verwijderen via Instellingen
- **Excel backup** — kostensoorten worden meegenomen in backup export/import

---

## [1.8.1] — 2026-04-09

### Added — AGP-compliance (Accijnsgoederenplaats)
- **e-AD Register** — volledig documentbeheer voor e-AD's, noodprocedures en ontvangstbevestigingen met ARC-nummers, statusverloop (aangemaakt → verzonden → ontvangen → geannuleerd), bestemming, vervoerder en audit trail
- **Voorraadverloop / GPA-rapport** — nieuw tabblad in Boekhouding met per periode (maand/kwartaal/jaar): beginvoorraad + inslagen + productie − uitslagen (binnenland/EU/export) − bijzondere mutaties = eindvoorraad, voor zowel grondstoffen als gereed product; Excel-export
- **Inventarisatiemodule** — eigen pagina voor voorraadtellingen (ingrediënten, bier of volledig); administratieve vs. fysieke voorraad per item, verschilverklaring verplicht, optioneel automatische correcties doorvoeren
- **GN-code en Platogehalte** — beschikbaar op batches en lots; GN-code selecteerbaar uit standaardlijst (2203 00 01/09/10); Platogehalte geïntegreerd in accijnsberekening
- **Type uitslag** — uitslagen registreren nu type (binnenland/intracommunautair/export), bestemming (naam, adres, land), vervoerder en e-AD/ARC-koppeling
- **Accijns-aangifteworkflow** — statusverloop per maand: open → berekend → ingediend → betaald, met datumregistratie per stap
- **Audit trail** — alle wijzigingen aan kritieke entiteiten worden gelogd met tijdstip, entiteit, actie, veldwijzigingen en gebruikersnaam; viewer in Instellingen met filters
- **Geautomatiseerde backups** — dagelijkse server-side backups met AGP-retentiebeleid (dagelijks 30 dagen, wekelijks 1 jaar, maandelijks 7 jaar); backup-overzicht en handmatige trigger in Instellingen
- **Negatieve-voorraadvalidatie** — harde validatie op 4 plaatsen: ingrediëntcorrecties, ingrediëntafboekingen, batchproductie en bestelling-picking
- **Goederenstroomdiagram** — visueel AGP-stroomdiagram in Instellingen (inkoop → opslag → productie → verpakking → opslag → uitslag)
- **Inslag-e-AD koppeling** — lots kunnen nu gelinkt worden aan een ontvangen e-AD via ARC-nummer
- **AGP-instellingen** — AGP-nummer, Douane-nummer en accijns-verantwoordelijke in brouwerijgegevens
- **Versieweergave** — app-versie zichtbaar in Instellingen
- **Stamgegevensvalidatie** — waarschuwing bij ontbrekende GN-code/Platogehalte, duplicaat-preventie ingrediënten
- **Gebruikersidentificatie** — audit trail detecteert HA-gebruikersnaam of valt terug op accijns-verantwoordelijke
- **created_at timestamps** — automatisch op batches, lots, uitslagen en afboekingen

### Changed
- Accijnsberekening ondersteunt nu Plato-tarief naast ABV- en minimum-tarief
- i18n uitgebreid met ~150 keys in alle 5 talen (nl/en/de/fr/es)

---

## [1.7.0] — 2026-03-31

### Added
- **Transactieoverzicht** — nieuw 4e sub-tabblad in Rapporten (Boekhouding) met een chronologisch overzicht van alle inkoop-, verkoop- en accijnsmutaties per dagboek; gefilterd op de ingestelde rapportageperiode; CSV-export en kleurgecodeerde dagboekbadges
- **Alles exporteren als ZIP** — knop in de datumfilter-balk van Rapporten downloadt alle CSV's (W&V, omzet per categorie, inkoop, verkoop, transactieoverzicht) plus HTML-versies van verkoopfacturen en originele inkoop­bijlagen in één ZIP-bestand
- **JSON back-up export/import** — vervangt de Excel import/export in Instellingen → App; exporteert een volledig `brewadmin_backup_YYYY-MM-DD.json` met alle app-data (batches, ingrediënten, lots, recepten, facturen, bestellingen, klanten, instellingen, enz.); importeer een back-upbestand om alle data te herstellen
- **MT940 .swi bestandsformaat** — bankafschriften met de extensie `.swi` (ING/SWIFT) worden nu herkend en geïmporteerd; ook `.940` en `.swift` toegevoegd naast de bestaande `.sta`, `.txt` en `.mt940`
- **PDF bestandsnaam** — gedownloade factuur-PDF's en pakbonnen gebruiken nu het factuur-/pakbonnummer als bestandsnaam in plaats van een timestamp

### Changed
- **Verkoopfacturen als HTML in ZIP** — factuur-HTML kan in de browser worden geopend en via Afdrukken → PDF worden opgeslagen
- Verwijder push-voorraad knop van de VoorraadPage (was duplicaat van WC sync)
- BF JSON-importknop verwijderd van Batches-pagina (Brewfather-sync via API volstaat)
- Losse verkoopfactuur (niet gekoppeld aan bestelling) toegevoegd in Boekhouding

### Fixed
- WC pull-knop kleur gecorrigeerd (bg-purple-600)
- Accijnsrijen in Transactieoverzicht worden alleen getoond bij `betaald = true` (afdracht)
- Diverse responsive verbeteringen op kleine schermen

---

## [1.6.4] — 2026-03-30

### Changed
- **Navigatie volgorde** — Recepten staat nu voor Batches; Voorraad staat voor Bestellingen
- **Logo upload stijl** — App logo gebruikt dezelfde stijl als factuurlogo (gestippelde rand, ✕ overlay knop)
- **Verzendkosten standaard prijs** — Nieuw veld in Instellingen voor een standaard verzendkosten prijs
- **BTW per tarief** verplaatst van inkoop sub-tab naar BTW aangifte pagina (berekend per jaar); inkoop sub-tabs (Facturen / BTW tarief) verwijderd — facturen tabel altijd zichtbaar
- **BTW aangifte invoerhulp** — Rubriek 1a/1b toont nu de totale omzetbelasting voor het geselecteerde jaar (eigen verkoopfacturen + WooCommerce orders)
- **Verkoopfacturen in BTW aangifte** — Waarden worden altijd weergegeven, ook zonder WooCommerce koppeling of eigen facturen in de periode

### Fixed
- Jaar werd naast "Boekhouding" getoond bij BTW aangifte tab — verwijderd
- CSV knop verkoop verplaatst naar het periode-filter bovenaan (consistent met inkoop); koptekst "Eigen verkoopfacturen" verwijderd

---

## [1.6.0]

### Added —
 i18n-translation, Vite/React/TS-migratie, bundled Tailwind, multi-stage Docker build


## [1.5.1]

### Added
- **Invoice scanning with Claude AI** — upload a PDF or image of a purchase invoice and let Claude AI extract the supplier, date, invoice number and all line items (with VAT per line) automatically; a local PDF text-extraction step runs first so no API call is needed for plain-text PDFs
- **PDF viewer in invoice form** — preview the uploaded attachment side by side with the entry form while filling in invoice details
- **Number of units + content per unit** — ingredient lines in the invoice form now support `aantal stuks` × `inhoud per stuk`; this is also extracted during scanning and stored on the invoice record
- **Inline editing of invoice line items** — click any ingredient, packaging or free-form line in the invoice form to edit it in place; no need to remove and re-add
- **BTW toggle (excl / incl)** — each price field in the invoice form has an optional toggle to enter prices including VAT; the exclusive amount is calculated automatically
- **Editable end totals** — the netto, BTW and bruto totals at the bottom of the invoice form can be manually overridden for rounding differences; a recalculate button restores the computed values
- **BTW breakdown per tariff** in the invoice totals section showing the split between 0 %, 9 % and 21 % VAT lines
- **BTW per ingredient type** — default VAT rate can be configured per ingredient type in Settings; automatically pre-filled when adding an ingredient line to an invoice
- **Edit existing purchase invoice** — clicking a row in the Accounting → Inkoop table opens the full invoice form pre-filled with all existing data (supplier, date, line items, attachment); save updates the record in place
- **Ingredient edit & delete** — existing ingredients can be edited (name, type, unit, notes) and deleted directly from the Ingredients page
- **Configurable ingredient types** — add or remove ingredient types (Mout, Hop, Gist, etc.) in Settings; custom types are available throughout the app

### Changed
- **Accounting date filter** defaults to 1 January of the current year instead of the first of the current month, so all invoices for the year are visible immediately
- **Excel import/export** now includes all ingredient and lot fields (lot number, best-before date, price, supplier, invoice number, etc.)
- **Push stock tooltip** no longer states that only stock with paid excise duty is synchronised
- **Collapse/expand arrows** are now consistently positioned on the left throughout the entire app (batch archive, batch info, fill registration, filled stock, archived tags, hidden articles)

### Fixed
- Manually adjusted invoice totals (netto/BTW/bruto overrides) are now correctly saved when booking from both the Ingredients page and the Accounting page
- Modal overlay (blur) now fully covers the sticky navigation bar by rendering via `ReactDOM.createPortal`
- Warning shown in the invoice edit popup when stock movements will not be reprocessed

---

## [1.5.0]

### Added
- **Boekhouding (Accounting) page** — new navigation item and module for purchase invoice management
- **Purchase invoice attachments** — upload PDF or image files (JPG, PNG, WEBP, GIF, TIFF, BMP, HEIC) to individual invoices; download all attachments for a given year as a ZIP
- **Packaging components** — define and manage individual packaging components (bottle, cap, label, etc.) with type, cost per unit and available quantity; assign components with qty-per-unit to packaging types
- **Excise duty declaration view** — grouped month view with month totals, rate per litre display, one-click mark-all-paid per month and collapse/expand per month
- **App branding settings** — customise the app name shown in the navigation bar alongside the logo
- Separate **Webshop** tab in Settings sidebar for WooCommerce configuration
- New server endpoints: `POST /api/upload/<filename>`, `GET /api/file/<filename>`, `POST /api/delete_upload/<filename>`, `GET /api/download_bijlagen/<year>`

### Changed
- Settings → Logo section renamed to **Branding**; now also exposes the app-name field
- Settings sidebar split: WooCommerce moved to its own **Webshop** tab, separate from **Brewery**

---

## [1.4.0]

### Added
- Colour theme system: six themes (Amber, Green, Blue, Slate, Red, Purple) — select in Settings → Appearance
- Subtle per-theme page background tint applied app-wide for a more cohesive feel
- Beer stock page
- Brewfather sync button always visible on the Batches page (disabled when Brewfather is not configured), consistent with the Recipes page
- Clickable logo in the navigation bar (returns to Dashboard)

### Changed
- Complete UI restyle using modern Tailwind design: cards with shadows, rounded corners, improved spacing
- Navigation renamed: "Brewery Admin" → "Dashboard"
- Default header logo replaced with `logo.png` (brewery logo)
- All section headers, modal headers and card tops now use the active theme colour palette
- All hardcoded amber UI elements replaced with theme-aware CSS variables (`--t-accent`, `--t-light`, `--t-pale`, `--t-text`, `--t-btn`, etc.)
- Ingredient and packaging receiving modals merged into one unified form

### Fixed
- Logo in navigation limited to 36 px height to prevent layout overflow
- Page layout no longer shifts when a scrollbar appears (scrollbar-gutter: stable)
- Responsive server-URL field, colour-theme spelling correction, missing translations

---

## [1.3.1]

### Fixed
- Batch status dropdown in the detail header rendered raw Dutch values instead of the active language — now translated via lookup object
- Dashboard tank status badge rendered raw Dutch status — now translated
- Ingredient type column in the batch ingredient list rendered raw Dutch data keys — now translated
- Status `<Badge>` component translated correctly across all pages (batch list, archive, detail info card)
- Packaging type selectors on Ingredients and Batches pages now show translated labels
- Unit selectors (EENHEDEN) on Ingredients and Batches pages now show translated labels
- Ingredient type selectors (ING_TYPES) on Ingredients and Batches pages now show translated labels
- Brewfather status mapping display translated to active language
- HA server status labels and descriptions translated to active language
- Settings: logo upload button, add-row buttons, Excel import/export, log count/clear, hygiene buttons, excise tariff fields and formula label all translated
- Translation object syntax errors (double commas `,,`) fixed — caused all translations to fall back to raw keys

---

## [1.3.0]

### Added
- Internationalisation (i18n): full UI available in Dutch, English, German, French and Spanish
- Separate language files (`lang/nl.js`, `lang/en.js`, `lang/de.js`, `lang/fr.js`, `lang/es.js`)
- Automatic browser/system language detection on first launch — falls back to English if unsupported
- Language selector in Settings → Language (flag buttons, preference stored persistently)
- Custom excise duty formula: define a free-form JavaScript expression in Settings → Excise Duty
  - Available variables: `liter`, `abv`, `hl` (= liter/100), `r1`, `r2`
  - Formula is validated on save and highlighted inline on error
- Mobile collapsible sidebars on Ingredients, Batches, Packaging and Recipes pages — list hides when an item is selected, "← Back to overview" button appears

### Fixed
- Blank page on startup caused by optional catch binding (`catch {}`) not supported by the Babel standalone version in use — fixed to `catch(e) {}`
- "Invalid Date" shown for last sync timestamp — `fmtD` was incorrectly used for full ISO timestamps; switched to `fmtTs`
- WooCommerce stock push incorrectly included releases with unpaid excise duty — now uses `filter` + `every` to check all excise records per release (handles duplicate records)
- JSX fragment (`<>`) not closed correctly in BatchesPage and AfvullenPage after mobile refactor, causing parse errors

---

## [1.2.5]

### Added
- WooCommerce integration: automatically update stock in the webshop on release
- Manual bidirectional sync on the Stock page (↕ WC Sync button): pulls sales from WooCommerce and distributes the difference FIFO across releases
- WooCommerce API settings in Settings (URL, Consumer Key, Consumer Secret, enabled toggle, connection test)
- Hygiene checklist per batch: configurable items with group structure (Preparation, Brewing, Filling, etc.)
- Hygiene check-off actions are now recorded in the batch log

---

## [1.2.0]

### Added
- Article master data per beer + packaging type (SKU, EAN, selling price, VAT)
- Red indicator in released stock for unpaid excise duty
- Tank cards on dashboard enlarged for better readability of status labels
- Brewfather sync extended: brewhouse and mash efficiency, pH values, notes
- Collapsible "Batch info" section on the batches page
- Log now shows all changed fields on batch edits

### Changed
- Excise duty is now tracked per release (via `uitslag_id`)
- Stock archive is included in totals on the stock page

---

## [1.1.0]

### Added
- Released stock with sales tracking per packaging type
- Excise duty calculation and overview
- Archiving of fully sold releases
- Best-before warnings on the dashboard (expired + within 30/90 days)
- Brewfather recipe synchronisation

### Changed
- Navigation extended with Stock and Excise Duty pages

---

## [1.0.0]

### Initial release
- Batch management (create, edit, status changes)
- Ingredients and lots
- Tank overview and occupancy validation
- Home Assistant ingress support
- Data synchronisation via HA API + localStorage fallback
