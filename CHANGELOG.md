# Changelog

All notable changes to this project are documented here.

---

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
