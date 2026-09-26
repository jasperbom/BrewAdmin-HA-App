# CLAUDE.md — BrewAdmin HA App

Comprehensive guide for AI assistants working on this codebase.

---

## Project Overview

**BrewAdmin** is a Home Assistant addon for small brewery management. It provides:
- Batch lifecycle tracking (Planned → Brewing → Fermenting → Conditioning → Packaged → Closed)
- Ingredient stock management with lots and expiry tracking
- Recipe import/sync from Brewfather API
- Beer stock (releases) per batch and packaging type
- Excise duty calculation and declaration tracking
- Accounting with Claude AI-powered invoice scanning
- WooCommerce order picking and stock sync
- 5-language support (NL, EN, DE, FR, ES) with 7 UI themes

The app is "fully built with Claude AI" (noted in README). UI text and many code comments are in Dutch.

---

## Architecture

```
BrewAdmin-HA-App/
├── src/                    # React/TypeScript frontend
│   ├── components/
│   │   ├── ui/             # Reusable UI primitives
│   │   ├── InkoopFactuurModal.tsx
│   │   ├── BatchRapportExport.tsx  # Batchdossier → print-HTML / printvenster / PDF-download
│   │   └── PakbonExport.tsx        # Pakbon, picklijst, factuur, herinnering. Deelt
│   │                               # `DOC_CSS`/`esc`/`breweryBlock`/`openPrint` met het dossier
│   ├── pages/              # Feature pages (one per domain)
│   ├── utils/
│   │   ├── api.ts          # API client & state management
│   │   ├── route.ts        # Hash-routing van de schil: werkruimte/pagina/batch ↔ `#/…`, PAGINA_WERKRUIMTE, isDetailRoute
│   │   ├── kleurContrast.ts # WCAG-luminantie/contrast; `afgeleideThemaKleuren` maakt het accent donkerder tot het als tekst (4,5:1) en rand (3:1) leesbaar is
│   │   ├── undo.ts         # `UitgesteldeActiePlanner`: terugweg van vijf seconden i.p.v. confirm() (UI: components/ui/UndoBar.tsx)
│   │   ├── rollen.ts       # Rollentabel hoofdletterongevoelig (zoals HA gebruikersnamen vergelijkt):
│   │   │                   # spiegel van `_rol_uit_tabel`/`_rollen_lockout` in server.py voor het rollenbeheer
│   │   ├── geheimen.ts     # Sentinel `__SECRET__` alleen bij een ongewijzigde bestemming (storeUrl;
│   │   │                   # SMTP-host/-poort/-gebruiker/-beveiliging) — spiegel van `_SECRET_BESTEMMING`
│   │   ├── bijlage.ts      # `uploadBijlage` (afboeking/vernietiging): servernaam bewaren, mislukte
│   │   │                   # upload melden (`uploadFoutSleutel`) i.p.v. stil laten vallen
│   │   ├── merge.ts        # Conflict-samenvoeging bij een 409: lokale en serverwijziging op
│   │   │                   # verschillende records gaan beide mee; alleen hetzelfde record aan
│   │   │                   # beide kanten is een botsing (server wint). Arrays met `id` + objecten
│   │   ├── commit.ts       # Commit-buffer: `verdeelCommit` knipt een bundel boven `COMMIT_MAX_KEYS`
│   │   │                   # (= server.py, pytest bewaakt het) in groepen (backup terugzetten,
│   │   │                   # fabrieksreset); `commitVervolg`: een 403/422 op één key laat een gewone
│   │   │                   # handeling in zijn geheel vallen — nooit de rest los nasturen
│   │   ├── audit.ts        # Auditlogboek: `logAudit` (losse gebeurtenis) en
│   │   │                   # `logAuditVeld` (velden die tijdens het typen opslaan —
│   │   │                   # voegt een reeks samen tot één regel per veld). `AUDIT_SOORTEN`
│   │   │                   # is de enige plek voor soortnamen; een test faalt bij een
│   │   │                   # naam die daar niet in staat
│   │   ├── constants.ts    # Enums, mappings, defaults
│   │   ├── format.ts       # Formatting utilities
│   │   ├── calculations.ts # Business logic calculations
│   │   ├── centen.ts       # Cent-exacte geldberekening (ERP 2.2): totaliseerRegels/totaliseerInkoop — gebruik dit voor élk factuurtotaal
│   │   ├── journaal.ts     # Journaalboekingen (ERP 2.1): boekingsbouwers, storno, W&V uit journaal
│   │   ├── balans.ts       # Balansposten uit het journaal: `btwPositieCent` = nog af te dragen
│   │   │                   # BTW (verkoop − voorbelasting) over de niet-afgerekende periodes
│   │   ├── tankbewaking.ts # Bewaking tanktemperatuur: getoetst aan het wérkelijke setpoint van de
│   │   │                   # gekoppelde koeling (key `tank_setpoints`, terugval = vergistings-
│   │   │                   # schema/cold-crash), tolerantieband, instelruimte na een setpoint-/
│   │   │                   # stapwissel, wegloopdetectie (Theil-Sen-trend) en sensorstilte —
│   │   │                   # server.py spiegelt deze regels in Python
│   │   ├── haccp.ts        # Kritische beheerspunten CCP 1/2/3: risicoklasse, stabiliteit, vrijgave-oordeel, sluitcontrole, allergenenvergelijking, afwijkingen
│   │   ├── afvulsessie.ts  # Afvulsessie: lotcode L<batch>-B<n>, THT per klasse, sessie-blokkades
│   │   ├── agp.ts          # Verplaatsen/uitslaan uit de AGP (verplaatsing + accijns), uitslag op
│   │   │                   # productniveau (FEFO) en `bouwUitslagBoekingen` (gedeeld door kassa en
│   │   │                   # bestellingen); `verkoopUitAgpToegestaan` = de regel "verkoop nooit
│   │   │                   # rechtstreeks uit de AGP, behalve export/intra-EU"
│   │   ├── uitlevering.ts  # Verkoop → uitleveringen (kassa én bestellingen): vrije voorraad eerst,
│   │   │                   # nooit uit de AGP (behalve export/intra-EU), nooit accijns.
│   │   │                   # `bouwPickTerugdraaiing`: picks van een nog niet verzonden order
│   │   │                   # terugdraaien (annuleren, "Picks terugdraaien") — uitleveringen
│   │   │                   # vervallen, picks worden concept, tegenregel `verkoop` met negatieve
│   │   │                   # hoeveelheid; `orderUitgeleverd` blokkeert opnieuw picken
│   │   ├── statiegeld.ts   # Statiegeldregels op de orderfactuur (SND/fust, 0% BTW) — nooit bij een
│   │   │                   # webshoporder: daar zijn de WooCommerce-bedragen leidend
│   │   ├── beschikbaarheid.ts # Wat er van een afvulling nog vrij is na open picks (totaal: afgevuld −
│   │   │                   # picks − uitgeleverd − afgeboekt; per locatie). Een pick zonder
│   │   │                   # bronlocatie legt eerst vrije voorraad vast, net als de uitlevering —
│   │   │                   # alleen de rest telt op de AGP. Gedeeld door kassa, bestellingen,
│   │   │                   # producten en `agpGereserveerdPerAfvulling` (kassa.ts)
│   │   ├── trace.ts        # Traceerbaarheid & recall (hoofdstuk 11): één stap terug/vooruit, massabalans, traceergaten, traceeroefening
│   │   ├── merch.ts        # Merch-artikelen: herkenning op SKU/naam (onthouden vanuit een orderregel) + eigen voorraad (mutaties, tekorten, waardering) voor merch die je zélf op voorraad hebt
│   │   ├── sku.ts          # SKU-identiteit: één SKU hoort bij één artikel. Spoort dubbele
│   │   │                   # artikelnummers op (formulier weigert ze, lijst toont ze) en
│   │   │                   # brengt een orderregel bij het juiste product — bij een SKU die
│   │   │                   # aan twee bieren hangt beslist de biernaam. Gedeeld door de
│   │   │                   # picking (`orderProductId`), de reserveringen
│   │   │                   # (`gereserveerdVoorArtikel`) en de productenpagina
│   │   ├── wcProduct.ts    # WooCommerce-productkaart per artikel: payload bouwen (lege velden gaan
│   │   │                   # nooit mee — een push wist niets), winkelantwoord lezen, verschillen
│   │   │                   # app ↔ winkel, prijsomrekening excl./incl. BTW, categorieënboom
│   │   ├── batchRapport.ts # Batchdossier van een afgeronde batch (`batchIsAfgerond` =
│   │   │                   # Afgevuld/Verpakt/Gesloten): kerncijfers, tijdlijn,
│   │   │                   # ingrediënten mét leverancierslot, metingen, CCP 1/2/3,
│   │   │                   # afvullingen, verlies, afwijkingen, kostprijs. Rekent zelf
│   │   │                   # niets uit wat een scherm al toont — het leent de bestaande
│   │   │                   # afleidingen, anders krijgt het dossier eigen getallen.
│   │   │                   # Geeft i18n-sleutels terug; opmaak in
│   │   │                   # `components/BatchRapportExport.tsx`
│   │   ├── pdfPaginering.ts # Waar een lang document geknipt mag worden: `paginaIndeling`
│   │   │                   # houdt blokken (tabelrijen, kaarten) heel en laat een kopje
│   │   │                   # niet als weesregel achter. Gebruikt door `pdf.ts`
│   │   ├── batchStats.ts   # Wat de batches over een bier zeggen: aantal, gebrouwen liters,
│   │   │                   # gemeten ABV/OG/FG/kleur/rendement/kostprijs-per-liter (gemiddelde,
│   │   │                   # spreiding, trend t.o.v. de vorige brouw, reeks voor een lijntje) en
│   │   │                   # of de vastgelegde bierinformatie daarvan afwijkt
│   │   ├── brouwKosten.ts  # Vaste kosten van een brouwdag (elektra, water, schoonmaak,
│   │   │                   # overig): gemiddelde uit de eigen batches, anders uit de
│   │   │                   # inkoopfacturen met de bijbehorende kostensoort over dezelfde
│   │   │                   # periode, anders handmatig. **Elke nieuwe bron voor deze
│   │   │                   # kosten hoort hier** — zie "Afgeleide kosten" hieronder
│   │   ├── verpakkingKosten.ts # Kostprijs van één verpakte eenheid (onderdelen, anders de
│   │   │                   # losse velden) — de enige implementatie, ook gebruikt door
│   │   │                   # `berekenBatchKostprijs` en de pagina's — plus de verpakkingsmix
│   │   │                   # per liter uit de eigen afvullingen (anders die van de hele
│   │   │                   # brouwerij) en `referentieVerpakking`: de 33 cl-fles waarmee de
│   │   │                   # receptvoorcalculatie rekent (mix = terugval)
│   │   ├── receptKostprijs.ts # Voorcalculatie bij het recept: prijs per ingrediënt uit de lots
│   │   │                   # (gewogen gemiddelde van wat er ligt, anders de laatste inkoop),
│   │   │                   # gemiddeld verlies uit de eigen brouwhistorie (vergist versus
│   │   │                   # afgevuld, gewogen op liters; anders de verliesposten, anders 8%),
│   │   │                   # verpakking over de liters ná verlies, en de kostprijs per
│   │   │                   # brouwzaalliter, per verkoopbare liter én per verpakte eenheid
│   │   │                   # (`kostprijsPerEenheid`: bier per liter + de échte verpakkingsprijs
│   │   │                   # van díe eenheid; het recept rekent op de 33 cl-fles). `receptAccijns`
│   │   │                   # geeft de accijns per liter uit ABV/Plato + tarief — apart van
│   │   │                   # `totaal`, want die schuld ontstaat pas bij uitslag
│   │   ├── bierinfo.ts     # Bierinformatie: één definitie van alle eigenschappen van een bier
│   │   │                   # (kcal, ingrediënten, smaakprofiel, serveertip, smaakassen, Untappd,
│   │   │                   # uit roulatie, extra regels) en van een verpakking (maat/aantal,
│   │   │                   # pakketinhoud, badge, levering), met niveau (product/artikel) en welke
│   │   │                   # velden de app zélf afleidt (ABV/IBU/EBC/stijl uit het product, inhoud
│   │   │                   # uit de verpakking, ingrediënten uit het recept)
│   │   ├── craftery.ts     # Vertaaltabel bierinformatie ↔ de `_cf_…`-meta van het Craftery-
│   │   │                   # webshopthema. Bewaart zelf niets; alleen deze sleutels worden
│   │   │                   # gelezen/geschreven
│   │   ├── wcImport.ts     # WooCommerce-order → orderregels: statusquery/paginering, verzendkosten (shipping_lines) + toeslagen (fee_lines), merch-herkenning (geen eigen artikel = vrije regel), betaalstatus (`wcBetaalStatus`: date_paid of processing/completed = betaald)
│   │   ├── adres.ts        # Straat + huisnummer uit een WooCommerce-order: losse velden van een
│   │   │                   # NL-checkoutplugin (`_billing_house_number`/`_suffix`/`_street_name`)
│   │   │                   # eerst, anders `address_1` gesplitst; `address_2` achter het nummer
│   │   ├── wcOrderImport.ts # WooCommerce-orderimport (ophalen, order → bestelling, bekende orders
│   │   │                   # verversen, dedup bij toepassen, lease voor de automatische import) —
│   │   │                   # gedeeld door de bestellingenknop en de periodieke import in App.tsx
│   │   ├── websiteTelemetrie.ts # Website-telemetrie (plugin Craftery Brouwerij): opslagvorm
│   │   │                   # `website_telemetrie`, standaard alles uit, foutcode → i18n,
│   │   │                   # houdbaarheidswaarschuwing. Het bericht zelf bouwt server.py
│   │   │                   # (`_website_bericht`), ook voor het voorbeeld in de app.
│   │   │                   # UI: components/WebsiteTelemetrie.tsx
│   │   ├── wcTerugschrijven.ts # Orderstatus terug naar WooCommerce (completed/cancelled + privé-
│   │   │                   # notitie); annuleren alleen zolang er niets is uitgeslagen (voorraad)
│   │   ├── levering.ts     # Afhalen of verzenden per bestelling: uit de WooCommerce-verzendregel
│   │   │                   # (`local_pickup`/`pickup_location` = afhalen) + het afhaalmoment en de
│   │   │                   # afhaalpagina van het Craftery-thema (`?afhaalmoment=<id>&sleutel=<order_key>`),
│   │   │                   # bij elke import ververst; mailvariabelen `{levering}` (bestelbevestiging),
│   │   │                   # `{trackregel}` (verzendbevestiging bij "Markeer verzonden") en
│   │   │                   # `{afhaalregel}` (afspraak-gemist-mail: moment voorbij, order nog open);
│   │   │                   # de afhaalpagina-link zelf komt als knop onder de mail (`afhaalMailKnop`:
│   │   │                   # kiezen/verzetten, `afhaalGemistMailKnop`: nieuw moment) — `MailKnop`;
│   │   │                   # `bestelPaginaLink` = link naar de bestelling in de webshop, bij de import
│   │   │                   # per order bepaald (`wc_bestel_url`): klant met account → Mijn account via
│   │   │                   # pagina-ID (`?page_id=8&view-order=<id>`, slug-onafhankelijk), gast → de
│   │   │                   # bedankpagina met ordersleutel (uit `payment_url`, anders afreken-pagina-ID);
│   │   │                   # pagina-ID's/slugs uit `settings/advanced` (`leesWcPaginas`). `bestelLink` =
│   │   │                   # knop "Bekijk je bestelling": sjabloon `woocommerce_creds.bestelUrl`, anders
│   │   │                   # `wc_bestel_url`; anders géén knop (geen gok)
│   │   ├── bierKleur.ts    # EBC → bierkleur (één tabel voor tank-SVG, productlijst, kassa,
│   │   │                   # orderregels, tankkaarten): `productEbc`/`batchEbc` (eigen veld →
│   │   │                   # product → recept), `tekstKleurOp`. Component: ui/BierKleur.tsx
│   │   ├── beslissingen.ts # Administratie-dashboard: één beslissing per rij (urgentie te_laat/
│   │   │                   # klopt_niet/wacht_op_jou/deadline, bedrag, actie + doel) uit de
│   │   │                   # bestaande selecties in facturen/btw/calculations — nooit een eigen
│   │   │                   # sommetje; de Rapporten-pagina is de andere ingang (terugkijken)
│   │   ├── attentie.ts     # Attentieposten per werkruimte (badge op de werkruimte-knop + de
│   │   │                   # "Vraagt om aandacht"-lijst op de dashboards): per post een id,
│   │   │                   # i18n-sleutel, aantal en navigatiedoel (pagina + tab/filter). De
│   │   │                   # tellingen zelf leven in taken/calculations/picking/btw/facturen —
│   │   │                   # een nieuw aandachtspunt = een post hier, nooit een los sommetje in
│   │   │                   # App.tsx of een dashboard
│   │   ├── facturen.ts     # Vervallen verkoopfacturen (factuurdatum + betalingstermijn klant →
│   │   │                   # brouwerij → 14 dagen, dagen te laat) en achterstallige
│   │   │                   # inkoopfacturen (onbetaald > `INKOOP_ACHTERSTALLIG_DAGEN`); gedeeld
│   │   │                   # door de badge, het Administratie-dashboard en de boekhoudpagina.
│   │   │                   # `breweryMetTermijn`/`vervaldatumTekst`: geef díe mee aan élke
│   │   │                   # factuur-, herinnerings- en mailopbouw (Boekhouding, Bestellingen,
│   │   │                   # kassa) — nooit een eigen `?? 14`, anders noemt het document een
│   │   │                   # andere vervaldatum dan de badge
│   │   ├── sndAfdracht.ts  # SNd-statiegeld per periode + afdrachtstatus uit de bankkoppeling
│   │   │                   # `{soort:'snd', periodeKey}` (Statiegeld-pagina, banktabel Boekhouding)
│   │   ├── btwCategorie.ts # BTW-categoriecodes (UNCL5305) voor e-facturatie: afleiding uit tarief + land + BTW-nummer, VATEX-codes, EU-landenlijst, landkeuzelijst
│   │   ├── template.ts     # Mustache-subset renderer ({{waarde}}, {{{ruw}}}, {{#sectie}}, {{^omgekeerd}}) — documentlayouts als data
│   │   ├── factuurTemplate.ts # Standaard factuurlayout + contextbouwer; eigen layout via brewery_details.factuur_template, bij een fout stille terugval
│   │   ├── factuurMail.ts  # Welke mailtekst bij een verkoopfactuur: `factuur` (open) of `factuur_betaald`
│   │   │                   # (al voldaan — webshoporder betaald in WooCommerce, kassa, vinkje) + de
│   │   │                   # betaalvariabelen {betaalregel}/{betaaldatum}/{betaalwijze}; gedeeld door
│   │   │                   # de boekhoud- en de bestellingenpagina
│   │   ├── mollieLink.ts   # Eén Mollie-betaallink per verkoopfactuur (`mollie_link`), hergebruikt door elke volgende mail
│   │   ├── ubl.ts          # E-factuur in UBL 2.1 / PEPPOL BIS Billing 3.0: cent-exact, multi-tarief TaxSubtotals, kortingen als AllowanceCharge, creditnota als CreditNote-document
│   │   ├── csv.ts          # CSV-export: `csvCel`/`csvRij`/`csvTekst` zijn formule-veilig (apostrof vóór = + - @ tab/CR,
│   │   │                   # een getal blijft een getal) — gebruik ze voor élke CSV-export, nooit eigen quoting;
│   │   │                   # `inkoopRegelExport` leest de kolommen van een inkoopregel (ook oude boekingen)
│   │   ├── inkoopOntvangst.ts # Inkoopformulier → lots + ontvangst-log, onderdelenvoorraad, factuurregels en
│   │   │                   # merch-inkopen; gedeeld door de gewone inkoopfactuur en de boeking vanuit de bank
│   │   └── excel.ts        # Volledige backup export/import als Excel (.xlsx) via SheetJS
│   ├── types/index.ts      # TypeScript interfaces
│   ├── i18n/               # Translation JSON files (nl/en/de/fr/es)
│   ├── App.tsx             # Root: routing, global state, auto-sync
│   └── main.tsx            # React entry point
├── server.py               # Python backend (data, API proxy, security)
├── Dockerfile              # Multi-stage: node build → python runtime
├── entrypoint.sh           # Docker entrypoint (permission fix, non-root)
├── config.yaml             # Home Assistant addon manifest
├── repository.yaml         # HA addon repository metadata
├── package.json
├── vite.config.ts          # Single-file build output
├── tailwind.config.js
└── tsconfig.json
```

### De schil (navigatie) — v1.12.56

Eén schil, één omslagpunt (768 px). Het **hoofdmenu** zijn de drie
werkruimtes, het **tweede menu** de pagina's van de gekozen werkruimte.

- **Bureau:** `Rail` (84 px links: werkruimtes, onderaan Instellingen +
  `SyncDot`) en `PaginaNav variant="tabs"` in een witte bovenbalk. Bewust
  géén tekstkolom van 216 px: de pagina's zijn brede tabellen.
- **Telefoon:** `Onderbalk` (Productie · Verkoop · **Meten** · Admin · Meer;
  vast, hooguit vijf vakjes, attentie als stip) en `Kopbalk` met
  `PaginaNav variant="chips"` eronder. Een subscherm (Instellingen, batch als
  eigen pagina) krijgt een terugknop; een detailscherm (`isDetailRoute`)
  géén onderbalk. `MeerPage` = wie je bent, verbinding, Instellingen,
  Uitloggen.
- **Hash-routing** (`utils/route.ts`): `#/<werkruimte>/<pagina>[/<batchId>]`;
  `PAGINA_WERKRUIMTE` staat dáár. State → hash is een history-entry, hash →
  state via `hashchange`; nooit zelf `location.hash` zetten in een pagina —
  navigeer via `setPage`.
- **Maten:** `--kopbalk`, `--onderbalk` (incl. `--safe-top`/`--safe-bottom`,
  alleen in standalone-modus op `env()`), `--kb-inset`; toetsenbord open =
  `body.kb-open` (`components/ui/toetsenbord.ts`). Elke vaste actiebalk
  rekent met `var(--onderbalk)`; `.schil-inhoud` houdt de ruimte onderaan.
- **Themacontrast:** `--t-accent-text`/`--t-accent-edge` uit
  `utils/kleurContrast.ts` — gebruik die (via `.t-accent-text`) voor het
  accent als tekst of rand, nooit `--t-accent` rechtstreeks op wit.
- De "Nu actief"-strook blijft in de schil (lichte strook onder de
  bovenbalk), want tankalarmen horen op élk scherm zichtbaar te zijn.

### Frontend → Backend communication

- All HTTP via `/api/` prefix
- `src/utils/api.ts` — central fetch abstraction (`_postToServer`, `useStore` hook)
- `useStore(key)` — localStorage-cached, server-synced state per data key
- Delta-sync (ERP 4.3): saves van array-keys gaan waar mogelijk als
  record-delta naar `POST /api/delta/<key>` (pure logica in
  `src/utils/delta.ts`); bij herordening, records zonder id of een oude
  server valt de client stil terug op de volledige POST
- Conflict-samenvoeging: het versieslot van de optimistic locking zit op de
  hele key, terwijl een 409 bijna altijd over een ánder record gaat (de
  servertick schrijft zelf in `batches`/`gist_metingen` — en verwijdert daar
  ook oude automatische metingen — en een tweede tab of
  de telefoon schrijft ook mee). `_losConflictOp` in `api.ts` haalt daarom de
  verse serverstand op en legt de eigen wijziging er per record overheen
  (pure logica in `src/utils/merge.ts`, werkt op arrays met `id` én op
  objecten). Alleen wanneer hetzelfde record aan beide kanten anders werd
  wint de server en volgt een melding; een enkele waarde (thema, appnaam,
  ingeklapt-stand) wordt stil opnieuw weggeschreven. **Een conflict is dus
  geen reden meer om de invoer van de gebruiker weg te gooien** — houd dat zo
- Home Assistant Ingress strips path prefix; server handles both `/` and `/brouwerij_admin/` paths

### Backend data persistence

- `server.py` — pure Python `BaseHTTPRequestHandler`, no frameworks
- Alle app-data in één SQLite-database `/data/brewadmin.db` (WAL; ERP 4.1) —
  array-keys rij-per-record in tabel `records`, objecten/scalars in `kv`,
  versie-hashes in `versies`. De `/api/data/<key>`-API werkt onveranderd met
  complete JSON-payloads
- Legacy `/data/<key>.json`-bestanden worden bij de eerste start automatisch
  gemigreerd (veiligheidskopie in `/data/json_voor_sqlite/`); backups
  exporteren elke key weer als leesbaar `<key>.json` + een db-kopie
- External API proxy routes: Brewfather, WooCommerce, Claude AI, HA Supervisor

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18.3.1 + TypeScript 5.6.3 |
| Build tool | Vite 5.4.10 with `vite-plugin-singlefile` |
| Styling | Tailwind CSS 3.4.14 |
| Excel | SheetJS (xlsx 0.20.3) |
| PDF | pdfjs-dist 3.11.174 (lezen, factuur-scan); jsPDF 3 + html2canvas (genereren — mail-bijlagen en het batchdossier) |
| Backend | Python 3.12 (stdlib only, no pip dependencies) |
| Container | Docker, multi-stage (node:20-alpine → python:3.12-alpine) |
| Deployment | Home Assistant addon via ingress (port 8099) |

---

## Development Workflow

### Local development

```bash
# Frontend (hot reload at http://localhost:5173)
npm run dev

# Backend (API server at http://localhost:8099)
python3 server.py

# Production build (single-file output to dist/index.html)
npm run build

# Preview production build
npm run preview
```

The `.claude/launch.json` file defines both configurations for IDE launch.

### Docker build

```bash
docker build -t brewadmin .
# Stage 1: node:20-alpine builds frontend → dist/index.html
# Stage 2: python:3.12-alpine copies server.py + dist/index.html
```

### Tests

De pure businesslogica heeft een Vitest-suite (ERP-plan 3.1) in
`src/utils/__tests__/`: accijns, BTW-rollover en grondslag-BTW, centen,
journaalboekingen/storno, bankreconciliatie + MT940-parser, voorraad,
ouderdom, COGS, de UBL-e-factuur + BTW-categorieafleiding, de WooCommerce-productkaart
(payload, winkel lezen, verschillen), de bierinformatie (velddefinities, afgeleide
velden, stapelen per niveau, ingrediëntenlijst uit het recept), de
batchsamenvatting bij een product + de vertaling
naar het webshopthema, de receptvoorcalculatie (ingrediëntprijs uit de lots,
gemiddeld verlies, verpakking, kostprijs per liter), de afgeleide brouwkosten
(gemeten batches → inkoopfacturen → handmatig, schaling naar batchgrootte), de
verpakkingskosten (prijs per eenheid uit de onderdelen, mix uit de eigen
afvullingen), de
templaterenderer + factuurlayout, de Excel-backup-round-trip, de
tanktemperatuurbewaking (incl. het werkelijke setpoint van
de koeling) en de HACCP-beheerspunten
(risicoclassificatie, stabiliteit, vrijgave-oordeel, sluitcontrole,
allergenenvergelijking, lotcode en THT), de traceerbaarheid
(één stap terug/vooruit, massabalans, traceergaten, oefeningstatus) en de
conflict-samenvoeging (`merge.ts` + het 409-pad van `api.ts`), de hash-routing
van de schil (`route.ts`), het themacontrast (`kleurContrast.ts`, alle zeven
thema's), de undo-planner (`undo.ts`), het batchdossier (`batchRapport.ts`:
afbakening op de batch, kerncijfers, traceerregels, CCP-registraties,
kostprijs) en de pagina-indeling van de PDF-export (`pdfPaginering.ts`).

`server.py` heeft een pytest-suite (ERP-plan 3.2) in `tests/test_server.py`:
key-/upload-validatie, schemavalidatie (422), append-only-guard (422),
optimistic locking (409), atomaire commits, atomaire nummerreeksen (ook
onder parallelle clients), rate-limiting (429), secrets-maskering, de
server-audit, de SQLite-opslaglaag (WAL, JSON-migratie, backup-export), de
HACCP-sluitcontrole-herinnering, de WooCommerce-ordercontrole (`_wc_orders_tick`:
nieuwe webshoporders eenmalig melden, `wc_import_status` alleen bij verandering
schrijven, de import-lease van de app ongemoeid laten), de website-telemetrie
(het bericht: schakelaars, lege tanks, sensorstatus, temperatuurleeftijd,
contractgrenzen, geen vreemde velden; `_voorraad_per_locatie`; `_wc_request`
zonder `api_pad` ongewijzigd; de loop verstuurt niets als hij uit staat of
WooCommerce ontbreekt, en ruimt de site op bij uitzetten) en de tanktemperatuurbewaking (het oordeel
zelf, het uitlezen van het werkelijke climate-setpoint én de
alarmadministratie; tests bewaken dat de drempel-defaults en de
setpoint-leeftijd in server.py en tankbewaking.ts gelijk blijven).
De suite start de echte handler op een efemere poort met een tijdelijke
DATA_DIR.

```bash
npm test                 # vitest run (frontend-utils, eenmalig)
npm run test:watch
python3 -m pytest        # server.py (pytest is een dev-dependency, geen server-dependency)
```

**Draai `npm test` bij elke wijziging aan `src/utils/` en
`python3 -m pytest` bij elke wijziging aan `server.py`.** UI-gedrag heeft
geen geautomatiseerde dekking — verifieer pagina-wijzigingen handmatig met
de dev-server (of de verify-skill). Nieuwe pure logica? Zet hem in
`src/utils/` en schrijf er direct een test bij.

---

## Git Conventions

- **Primary branch:** `main`
- **AI feature branches:** `claude/<feature-name>-<id>` (e.g., `claude/add-claude-documentation-C27Lq`)
- **Release branches:** `1.7.X`, etc.
- Commit messages are descriptive, often in Dutch (matching UI language)
- Version is tracked in `config.yaml` (`version:`) and referenced in `README.md` and `CHANGELOG.md`

### Versie-bump per commit (verplicht)

**Elke commit verhoogt de versie in `config.yaml` met `0.0.1`.** De bump is
onderdeel van dezelfde commit als de inhoudelijke wijziging — niet een aparte
commit.

Roll-over-regels (semver-achtig met cap 99 per segment):

- `patch` loopt van `0` t/m `99`. Na `0.0.99` → `0.1.0` (patch reset, minor +1).
- `minor` loopt van `0` t/m `99`. Na `0.99.0` → `1.0.0` (minor reset, major +1).
- `major` heeft geen cap.

Voorbeelden:

| Huidige versie | Volgende versie |
|---|---|
| `1.7.9`  | `1.7.10` |
| `1.7.99` | `1.8.0`  |
| `1.99.99` | `2.0.0` |

Pas naast `config.yaml` ook `README.md` en `CHANGELOG.md` aan wanneer die de
versie noemen, zodat alle drie de bestanden in sync blijven.

---

## Code Conventions

### Naming

| Pattern | Example |
|---------|---------|
| React component files | `PascalCase.tsx` — `BatchFlowPage.tsx` |
| Utility files | `camelCase.ts` — `api.ts`, `format.ts` |
| TypeScript interfaces/types | `PascalCase` — `Batch`, `InkoopFactuur` |
| Variables/functions | `camelCase` — `ingTypes`, `bfCreds` |
| Constants | `UPPER_SNAKE_CASE` — `_RATE_MAX` |
| Private/internal identifiers | Prefix `_` — `_valid_key()`, `_RATE_WINDOW` |

### Language

- UI labels and translations: Dutch primary, others in `src/i18n/`
- Code comments: Dutch (match existing style when adding comments)
- Commit messages: Dutch or English both acceptable

### Component structure

- Pages are large single-file components (`~1,000–4,000 lines`) with inline state
- **Boy-scout-regel (ERP 3.5):** raak je een grote pagina aan, verplaats dan
  waar het kan pure logica naar `src/utils/` (mét test — valt onder de
  strict-ratchet) en zelfstandige modals/tabbladen naar eigen bestanden.
  Geen big-bang-refactors; voorbeelden: `utils/zip.ts`, `getPeriodes` in
  `utils/btw.ts`, `parseMT940` in `utils/bank.ts`
- Shared UI primitives live in `src/components/ui/` — use these, don't create inline one-offs
- **Documentlayouts (factuur) zijn data, geen code:** pas
  `FACTUUR_HTML_DEFAULT`/`FACTUUR_CSS_DEFAULT` in `utils/factuurTemplate.ts` aan
  en zet nieuwe waarden in `bouwFactuurContext`. Labels lopen altijd via
  `{{lbl_…}}` uit de context (nooit letterlijke tekst in de template), zodat een
  eigen layout van de gebruiker meertalig blijft
- Theming via CSS variables: `--t-accent`, `--t-light`, `--t-dark`, `--t-text`, `--t-bg`
- No global state manager — use `useStore(key)` for server-synced data, `useState` for local UI state

### TypeScript

- Strict mode is **off** in `tsconfig.json` voor de pagina's, maar
  `tsconfig.strict.json` (ERP 3.4) draait **strict** op `src/utils`,
  `src/types` en `src/i18n` — die ratchet moet schoon blijven
  (`npm run typecheck`, ook in CI) en de include mag alleen groeien
- Page-props: typ nieuwe/aangeraakte pagina's met een `XxxPageProps`-interface
  (zie AccijnsPage) i.p.v. `: any` — boy-scout-regel
- All shared types defined in `src/types/index.ts`
- Prefer explicit type annotations on function parameters

### Tailwind CSS

- Use Tailwind utility classes; avoid inline `style={}` unless necessary for dynamic values
- Theme colors accessed via CSS vars (`var(--t-accent)`) for theme-switching support
- Dark backgrounds with light text is the UI default

### Uniforme styling — verplichte patronen

Houd de UI consistent door altijd dezelfde patronen te gebruiken:

| Situatie | Klasse/patroon |
|----------|---------------|
| Sectie-header (statisch of klikbaar) | Gebruik `<SectionHeader>` uit `src/components/ui/SectionHeader.tsx` — geen inline `t-hdr` meer |
| Zoek/filter-invoer | Gebruik `<SearchInput>` uit `src/components/ui/SearchInput.tsx` |
| Rij-acties in een lijst/tabel | Gebruik `<RowActions primair={…} acties={[…]}>` uit `src/components/ui/RowActions.tsx` |
| Bierkleur (wélk bier) | `<BierKleur ebc={…} s="sm|md|lg">` uit `src/components/ui/BierKleur.tsx`; EBC via `productEbc`/`batchEbc` — nooit een eigen stip |
| Accent-kleur inline tekst/link | `t-accent-text` (of `style={{color: 'var(--t-accent)'}}`) — nooit `text-amber-*` hardcoden |
| Sectie-label binnen een card | `text-sm font-semibold text-gray-800` — géén `uppercase tracking-wide` |
| Veldlabel in een formulier | `text-sm font-medium text-gray-700` (zit al in `Inp`/`Sel`) |
| Fallback tekst (onbekende naam) | Altijd via i18n: `t('lbl_onbekend')` of `t('lbl_naamloos')` |
| Destructieve of statuswijzigende actie | Geen `confirm()`: `const undo = useUndo(); undo.plan(id, label, uitvoeren)` (`UndoBar.tsx`, vijf seconden terugweg) of `<BevestigKnop vraag=…>` (bevestiging ín de knop) |
| Lege lijst / mislukte lading | `<LegeStaat titel tekst icoon>` met de knop als kind; `<FoutKaart onOpnieuw>` — nooit een lege tabel die "geen …" zegt terwijl het bereik weg is |
| Tapdoel op een telefoon | `min-h-tap` (44 px) / `min-h-tapLg` (48 px), `sm:min-h-0` op een bureau — zit al in `Btn`/`Inp`/`Sel`/`SearchInput` |

**Regels:**
- Gebruik `<SectionHeader title=... open=... onToggle=... info=... solid? rounded?>`
  voor alle sectie-headers. Een chevron verschijnt automatisch bij `onToggle`;
  extra info (telling, voortgang, status-pill) gaat rechts via `info`.
- **`solid` is de uitzondering, niet de regel.** Standaard is een sectiekop
  rustig (donkere tekst op wit met een haarlijn). De geverfde themabalk is er
  alleen voor het onderwerp van de pagina zelf — één per scherm. Meerdere
  gekleurde balken onder elkaar maken elke sectie even belangrijk en zijn het
  duidelijkste "gegenereerd"-signaal in een UI.
- **Geen `uppercase tracking-wide` op labels.** Klein-kapitaal is voorbehouden
  aan badges (een afgeronde chip mét eigen achtergrond). Gewone zinsvorm leest
  rustiger en is in vijf talen beter te zetten.
- **Geen emoji's, nergens** (ook niet in i18n-strings). Een pictogram is een
  monochroom lijn-icoon via `<Icon n="…">` uit `src/components/ui/Icon.tsx`
  (nieuw icoon = één pad-string daar); puur typografische tekens (✓ ✕ ✎ ✉ ⚠)
  blijven tekst. Emoji's tekenen per platform anders, kleuren niet mee met het
  thema en zijn een "gegenereerd"-signaal.
- Zet **geen emoji's of icon-afbeeldingen** in de bruine headerbalk; gebruik
  tekstlabels via `t()`.
- Zoekbalken altijd via `<SearchInput value onChange placeholder cls? onKeyDown?>`.
- **Maximaal één actieknop per rij zichtbaar**; de rest hoort in het
  `⋯`-menu van `RowActions`. Zes knoppen op elke regel maken de inhoud van
  de rij onleesbaar.
- Gebruik `t-accent-text` / `var(--t-accent)` voor themagevoelige kleuren — dit werkt correct bij alle 6 thema's
- **Lege staat = korte regel + de knop zelf**, nooit een zin die uitlegt waar
  de knop staat. Een sectie die leeg is en waar niets te doen valt, toon je
  helemaal niet.

---

## Color Conventions

### Theme-Aware Colors (gebruik altijd voor algemene UI)
De app ondersteunt 7 kleurenthema's (amber, green, blue, slate, red, purple, sand). Gebruik **altijd** CSS-klassen die op de theemavariabelen steunen voor interactieve elementen:

- `.tbtn` — Primaire actieknop (achtergrond = `--t-btn`, hover = `--t-btn-h`)
- `.t-tab` — Actieve tabbladmarkering
- `.t-panel` — Achtergrond van panelen met accentborder
- `.t-card-l` — Kaart met gekleurde linkerborder
- `.t-input` — Focusstijl voor invoervelden (ring via `--t-accent`)
- `.t-hdr` / `.t-hdr-solid` — Gradient / effen paginaheader
- `.t-back` — Secundaire knop in themakleur (pale achtergrond)
- `.t-checkbox` / `.t-toggle` — Formuliercontroles in themakleur

> Gebruik **nooit** hardcoded Tailwind kleurklassen (zoals `bg-amber-600`) voor knoppen of interactieve elementen die bij het thema horen.

---

### WooCommerce Acties (gebruik `.wc-btn`)
Alle knoppen die direct een WooCommerce API-actie uitvoeren (push stock, pull sales, importeer bestellingen, sla WC-instellingen op) gebruiken `.wc-btn`:

```
.wc-btn  →  background: #7f54b3  (WooCommerce merkkleur)
          hover:       #6d4499
          active:      #5c3a82
```

Voorbeeldgebruik: `className="wc-btn px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40"`

---

### Statusbadges & Labels (vaste semantische kleuren)
Statusbadges gebruiken vaste Tailwind-kleuren met semantische betekenis:

| Kleur | Gebruik |
|-------|---------|
| `green-*` | Inkomsten, ontvangst, succes, verkoop, BTW-periode Afgesloten |
| `red-*` | Uitgaven, fouten, tekort, gevaarlijke acties |
| `blue-*` | Inkoop, informatie, neutrale acties, BTW-periode Lopend |
| `orange-*` | BTW, overige kosten, waarschuwingen, BTW-periode Openstaand |
| `purple-*` | Uitslaan (bier), Kapitaal-dagboek (badge), conditioneren/lagering fase |
| `gray-*` | Neutrale tekst, secondaire elementen, BTW-periode Toekomstig |
| `emerald-*` | Speciale successtaten (via `Btn v="green"`) |

> Statusbadges mogen vaste kleuren gebruiken omdat ze semantisch zijn en niet onderdeel van het thema.

---

### Btn Component Varianten
De `Btn`-component (`src/components/ui/Btn.tsx`) heeft de volgende varianten:

| Variant | Gebruik |
|---------|---------|
| `primary` (default) | Algemene primaire actie (thema-kleur via `.tbtn`) |
| `secondary` | Secundaire / annuleerknop |
| `danger` | Destructieve acties (verwijderen) |
| `ghost` | Subtiele acties, iconknoppen |
| `header` | Knoppen in de app-header |
| `header-danger` | Gevaarlijke acties in de header |
| `green` | Expliciete groene actieknop (niet thema-afhankelijk) |
| `blue` | Expliciete blauwe actieknop (niet thema-afhankelijk) |

---

### Samenvatting Beslisboom
1. Is het een WooCommerce-actie? → `.wc-btn`
2. Is het een primaire algemene actie? → `Btn` (primary) of `.tbtn`
3. Is het een statusbadge? → vaste semantische Tailwind kleur
4. Is het een destructieve actie? → `Btn v="danger"` of `red-*`
5. Anders → `Btn v="secondary"` of `gray-*`

---

## Afgeleide kosten — nooit laten intypen wat de app kan weten

**Uitgangspunt van de gebruiker (blijvend):** elk kostencijfer dat de app zelf
kan afleiden, leidt de app zelf af. Energie, water, schoonmaak en soortgelijke
brouwkosten zijn géén invulveld: ze komen uit wat er al in de administratie
staat. Een handmatige waarde is altijd alleen een *overschrijving*, nooit de
enige weg — en het scherm zegt altijd wáár het cijfer vandaan komt.

De vaste bronvolgorde staat in **`src/utils/brouwKosten.ts`**
(`KOSTEN_POSTEN` + `brouwKosten`/`kostenVoorBrouw`):

1. `gemeten` — gemiddelde van de eigen recente batches (`electra_kosten`,
   `water_kosten`, `schoonmaak_kosten`, `overige_kosten`)
2. `boekhouding` — inkoopregels met de bijbehorende `kostensoort` (Energie,
   Water, Schoonmaak …) over dezelfde periode, gedeeld door het aantal
   brouwsels in die periode. Bewust **niet** de kostensoort `Overig`: daar zit
   van alles in wat niets met brouwen te maken heeft
3. `handmatig` — wat de gebruiker opgeeft
4. `geen` — nul, en de app zegt dat erbij

**Voeg nieuwe slimmigheid altijd hier toe, niet in een pagina.** Denk aan: een
HA-energiemeter die per brouwdag meet, een watermeter, schoonmaakmiddel dat via
de lots wordt afgeboekt, een urenregistratie, gasverbruik per kooktijd. Zo'n
bron wordt een extra stap in `postCijfer` (of een extra post in
`KOSTEN_POSTEN`); alles wat met deze kosten rekent — de receptvoorcalculatie,
de batchkostprijs, de W&V — erft de verbetering dan automatisch. Nergens anders
hoort een eigen sommetje over energie of water te staan.

Zelfde principe, andere hoek: `berekenBatchKostprijs` in `utils/calculations.ts`
neemt een **optionele** `accijnsInst` mee. Krijgt hij die, dan schat hij de
accijns van afvullingen die noch een uitslag noch een bevroren
voorcalc-snapshot hebben (van vóór v2.4) uit ABV/Plato, in plaats van ze stil
als nul mee te tellen; het resultaat zegt via `accijns_bron` of het cijfer
`geboekt`, `voorcalc`, `geschat` of `geen` is. **Geef dat argument alleen mee in
schermen, nooit in de W&V of de COGS** — die mogen niet op een schatting
draaien, en zonder het argument is het gedrag ongewijzigd.

**Kostprijs van één verpakte eenheid: nooit prijs-per-liter × inhoud.**
Verpakking is de enige kostenpost die níét met het volume meeschaalt — 20 liter
in flesjes kost aan glas, kroonkurk en etiket een veelvoud van dezelfde 20 liter
in één fust. In `kostprijs_per_liter` is die post over álle verpakkingstypen van
de batch uitgesmeerd, dus daar mag je de prijs van één verpakking niet uit
afleiden: een fust betaalt dan mee aan de flesjes en de flesjes komen te goedkoop
uit, waardoor artikelmarges onderling niet meer kloppen. Reken altijd met
`kostprijs_per_liter_excl_verpakking × inhoud + verpakkingKostenPerStuk(vp,
onderdelen)` — zo doet `receptKostprijs.ts` het al (`kostprijsPerEenheid`),
sinds v1.12.48 ook de artikelmarge op de productenpagina, en de COGS
(`berekenCogs`, per uitlevering met de verpakking van díe afvulling).

**Eén batchkostprijs.** `berekenBatchKostprijs` is de enige afleiding van wat
een batch kost; de batchpagina ("Financieel resultaat"), het batchdossier, de
productmarges en de COGS lezen hun posten eruit. Ingrediëntkosten lopen via
`batchRegelKosten`/`lotKostenVoorRegel` (lotprijs omgerekend naar de eenheid
van de regel: hop in g uit een lot in kg), accijns via `accijnsVoorKostprijs`
(geboekt voor wat is uitgeslagen + voorcalc naar rato van wat nog in de AGP
ligt). Geen eigen sommetje in een pagina.

Hetzelfde principe geldt voor de andere afgeleide cijfers die er al zijn: het
verliespercentage (`gemiddeldVerlies` in `utils/receptKostprijs.ts`), de
ingrediëntprijs (`ingredientPrijs`, uit de lots), de verpakkingsmix
(`verpakkingMix` in `utils/verpakkingKosten.ts`, uit de eigen afvullingen) en de
afgeleide bierinformatie (`afgeleideBierInfo` in `utils/bierinfo.ts`). Vraag het niet nóg een keer aan de
gebruiker als het al ergens in de administratie staat.

---

## Key Domain Concepts

| Dutch term | English equivalent |
|------------|-------------------|
| Batch | Brewing batch / brew |
| Ingredient | Ingredient |
| Lot | Ingredient lot (stock unit) |
| Recept | Recipe |
| Afvullen / Afvulling | Packaging / a packaged release |
| Biervoor­raad / Release | Beer stock in storage |
| Bestelling | Order |
| Inkoop­factuur | Purchase invoice |
| Boek­houding | Accounting |
| Accijns | Excise duty |
| Hygiëne | Hygiene checklist |
| Instelling(en) | Setting(s) |
| Brouwerij | Brewery |

### Batch status flow

```
Gepland → Aan het brouwen → Aan het gisten → Conditioning → Afgevuld → Gesloten
(Planned)   (Brewing)        (Fermenting)     (Conditioning)  (Packaged)  (Closed)
```

### Afboeken: de locatie bepaalt de accijns

Een afboeking (`afboekingen`) legt in `bron_locatie_id` vast wáár het bier lag
toen het brak, vermist raakte of vernietigd werd. Dat veld stuurt twee dingen,
en die horen bij elkaar te blijven:

- **Voorraad.** `voorraadPerLocatie` haalt het aantal van díe locatie af. Ging
  het altijd van de AGP af — zoals vóór v1.12.52 — dan zakte die door nul
  terwijl de andere locatie bier bleef tonen dat allang weg was, en telde de app
  in totaal méér dan er ooit is afgevuld.
- **Accijns.** De heffing ontstaat zodra het bier de schorsingsregeling
  verlaat. Uit de AGP is een vermissing dus accijnsplichtig
  (`afboekingAccijnsplichtig` → `bouwAfboekingAccijnsRecord`). Lag het al
  daarbuiten, dan is de accijns bij de uitslag al geboekt en mag hij hier
  **niet** nog eens: dat belast dezelfde flesjes twee keer.

Geef daarom altijd de AGP-locatie mee aan `afboekingAccijnsplichtig` /
`bouwAfboekingAccijnsRecord` wanneer je die aanroept. Een afboeking zónder
locatie geldt als AGP — zo blijven bestaande records exact hetzelfde
gewaardeerd, en voor de voorraadtelling schuift alleen zo'n oud record nog door
naar een locatie die wél voorraad heeft.

De inventarisatie (`InventarisatiePage`) telt bewust locatieloos: een geteld
tekort is daar een AGP-discrepantie, dus die afboekingen krijgen geen locatie
en blijven accijnsplichtig.

### Uitslaan ≠ verkopen (v1.12.80)

Twee aparte stappen, in deze volgorde:

1. **Uitslaan** — het bier verlaat de AGP naar een vrije voorraadlocatie. Dát
   is het belastbare feit: verplaatsing + accijnsrecord + logregel `uitslaan`
   (`bouwVerplaatsing` / `bouwUitslagBoekingen` in `utils/agp.ts`). Kan op de
   AGP-pagina, de productpagina, in de kassa (tegel met AGP-voorraad), in de
   pickmodal en bij het aanmaken van een bestelling (`UitslagModal`).
2. **Verkopen** — kassa, bestelling of webshop, privé én zakelijk: altijd uit
   vrije voorraad buiten de AGP (`bouwVerkoopUitleveringen` in
   `utils/uitlevering.ts`). Een verkoop boekt **nooit** accijns en pakt nooit
   zelf bier uit de AGP; logregel `verkoop`. Te weinig vrij = eerst uitslaan.

Enige uitzondering: `type_uitlevering` `export`/`intra_eu`
(`verkoopUitAgpToegestaan`) gaat onder schorsing rechtstreeks uit de AGP, zonder
Nederlandse accijns. Het klanttype (privé/zakelijk) bepaalt alleen nog prijs en
factuur, niet meer waar het bier vandaan komt. Vóór v1.12.80 leverde een
zakelijke order zijn tekort stil uit de AGP en boekte daarbij accijns (bron
`uitlevering`) — die oude records blijven geldig, er komen er alleen geen bij.

### Tankbezetting: gereserveerd ≠ bezet

Een tank is pas **bezet** als er bier in zit (`Vergisten`/`Conditioneren` —
`TANK_BEZET_STATUSSEN`, `tankBezetter` in `utils/calculations.ts`). Bij
`Gepland`/`Brouwen` is de toegewezen tank alleen **gereserveerd**
(`tankReserveringen`): hij is nog leeg, reinigen/ontsmetten gebeurt tijdens de
brouwdag (stap "Gisttank gereed" in de batch-flow, of de vrije-tankkaart op het
Productie-dashboard) en het omwisselen van een reservering maakt de oude tank
níét vuil. De claim valt bij de stap naar `Vergisten` (`tankClaimCheck`: een
andere batch erin = harde blokkade, niet aantoonbaar ontsmet = bevestiging
vragen). `TANK_STATUSSEN` (mét `Brouwen`) is de AGP-blik "bier in proces", niet
de fysieke bezetting. server.py (tankbewaking, auto-metingen) kijkt alleen naar
`Vergisten`/`Conditioneren` — houd die twee kanten gelijk.

### Data keys (opgeslagen in SQLite, `/data/brewadmin.db`)

Key names are alphanumeric + underscore only (enforced by server). All active keys:

| Key | Type | Inhoud |
|-----|------|--------|
| `ingredienten` | array | Ingrediënten |
| `lots` | array | Ingrediëntlots (voorraadeenheden) |
| `batches` | array | Brouwbatches |
| `batch_ingredienten` | array | Koppelingen batch ↔ ingredient |
| `afvullingen` | array | Afvullingen / releases |
| `uitslagen` | array | Biervoorraaduitslagen |
| `accijns` | array | Accijnsrecords |
| `verpakkingen` | array | Verpakkingstypen |
| `onderdelen` | array | Apparatuur-onderdelen |
| `voorraad_log` | array | Mutatielog ingrediënten én bier: `afvullen`, `uitslaan` (AGP → vrije voorraad, met accijns), `verkoop` (uitlevering aan een klant; vóór v1.12.80 stond een verkoop óók als `uitslaan` gelogd; een teruggedraaide pick krijgt een tegenregel `verkoop` met negatieve hoeveelheid), `afboeking`, `rebrand` |
| `voorraad_archief` | array | Gearchiveerde voorraadmutaties |
| `voorraad_gesloten_bieren` | array | Afgesloten biersoorten |
| `recepten` | array | Recepten (lokaal + Brewfather). Eigen velden van de app (`kostprijs_overig` = vaste kosten per brouw, `kostprijs_verlies_pct` = handmatig verliespercentage) blijven bij een Brewfather-sync behouden — zie `EIGEN_VELDEN` in `runSync` |
| `recepten_verborgen` | array | Verborgen recept-IDs |
| `recepten_gearchiveerde_tags` | array | Gearchiveerde recepttags |
| `recepten_tag_volgorde` | array | Volgorde recepttags |
| `recepten_gesloten_groepen` | array | Ingeklapte receptgroepen |
| `tanks` | array | Tanks / fermentoren |
| `artikelen` | array | WooCommerce-artikelen (SKU-mapping) |
| `merch_artikelen` | array | Merch die je verkoopt maar niet als bier levert: `{sku, naam}`. Een WooCommerce-importregel die hierop matcht wordt een vrije regel (`type: 'vrij'`, `merch: true`) i.p.v. een pickregel — anders kan zo'n order nooit afgerond worden. Vult zich vanzelf via "markeer als merch" op een orderregel. Met `voorraad_volgen` erbij houdt de app een eigen `voorraad` bij (+ `inkoopprijs`/`verkoopprijs`/`btw_pct`/`wc_push`): afboeken bij order/kassa, aanvullen via een inkoopfactuur, meesturen in de WooCommerce-voorraadpush. Géén lots/THT/accijns/AGP — dat blijft strikt bier |
| `merch_voorraad_log` | array | Voorraadmutaties op merch: `{merch_id, datum, aantal, reden: inkoop\|verkoop\|retour\|correctie\|telling, referentie, stand}`. Elke af-/bijboeking schrijft hier een regel; `stand` maakt de log zelfstandig leesbaar |
| `hygiene_items` | array | *(legacy)* Hygiëne-controleitems — gemigreerd naar `batch_taken_items` |
| `hygiene_groups` | array | *(legacy)* Hygiëne-groepen — gemigreerd naar `batch_taken_groepen` |
| `haccp_schoonmaak_taken` | array | Schoonmaakschema (object, frequentie, middel) |
| `haccp_schoonmaak_log` | array | Uitgevoerde reiniging/desinfectie |
| `haccp_ccp_definities` | array | *(legacy)* Generieke CCP-definities — gemigreerd naar `batch_taken_items` (`type: 'meting'`) en sinds opschoning v4 uitgezet: de kritische beheerspunten zijn CCP 1/2/3 |
| `haccp_ccp_metingen` | array | *(legacy)* Metingen op die definities, met limietcheck en automatische CAPA. Sinds het verwijderen van de oude Batches-pagina (1.12.42) nergens meer zichtbaar of registreerbaar; de data blijft in de database en de Excel-backup |
| `haccp_capa` | array | Corrigerende en preventieve maatregelen |
| `haccp_waterkwaliteit` | array | Watermonsters tappunt brouwerij |
| `haccp_ongedierte` | array | Ongediertecontroles en -waarnemingen |
| `haccp_opleidingen` | array | Opleidings- en instructieregister |
| `haccp_vrijgaven` | array | **CCP 1** — vrijgave voor afvullen per batch: stabiliteitstoets, forced fermentation, sensorisch oordeel. Server-side append-only; correctie via een nieuwe registratie met `vervangt_id`. Zonder vrijgegeven registratie kan er niet afgevuld worden |
| `afvul_sessies` | array | Afvulsessie met lotcode `L<batchnr>-B<n>` (bijv. `L2431-B1`) en berekende THT; anker voor CCP 2 en CCP 3. Bewust **niet** append-only: een sessie wordt afgesloten |
| `haccp_sluitcontroles` | array | **CCP 2** — sluitcontroles per sessie (visueel + omkeerproef). Append-only. Bij afkeur worden de afvullingen sinds de laatste goedkeuring geblokkeerd |
| `haccp_etiketcontroles` | array | **CCP 3** — etiketcontrole per sessie met blokkerende allergenenvergelijking recept ↔ etiket. Append-only |
| `haccp_afwijkingen` | array | Expliciete afwijkingsregistraties: de enige manier om langs een harde CCP-blokkade te komen, altijd met onderbouwing + CAPA. Append-only |
| `haccp_trace_oefeningen` | array | **Traceeroefeningen** (hoofdstuk 11): periodieke mock recall met bevroren omvang (lotcodes, afnemers), massabalans, traceergaten, doorlooptijd en conclusie. Append-only — een tegenvallende oefening mag niet achteraf bijgesteld worden |
| `haccp_instellingen` | object | Kritische grenzen uit het handboek: stabiliteitsdagen, forced-fermentation-marge, THT-maanden per klasse, halfuurinterval sluitcontrole, traceeroefening-interval/-maximumduur/-normpercentage. **Beheer-only** — beleid, geen werkinstelling |
| `inkoop_facturen` | array | Inkoopfacturen |
| `scan_correcties` | array | Handmatige herclassificaties van factuurscan-regels ({tekst, soort}) — sturen volgende scans |
| `verkoop_facturen` | array | Verkoopfacturen |
| `bestellingen` | array | WooCommerce-bestellingen |
| `bestelling_picks` | array | Pickregels per bestelling |
| `afboekingen` | array | Biervoorraadbewegingen (vermis, vernietiging, overig). `bron_locatie_id` = waar het bier lág — bepaalt van welke locatie het afgaat én of er accijns verschuldigd wordt. Ontbreekt op records van vóór v1.12.52; die gelden als AGP |
| `klanten` | array | Klanten |
| `gist_metingen` | array | Gistingsmetingen per batch. Automatische metingen (`auto: true`, server-tick `_auto_metingen_tick`) dragen naast de lokale `datum`/`tijd` een absoluut `ts` (ISO met offset) — dat gaat in de bewaking voor (`_meting_epoch`/`metingTs`), anders geeft de wintertijdwissel een vals "sensor stil". De server dunt automatische metingen ouder dan 48 u eens per dag uit tot één per batch per uur (`_dun_auto_metingen`); handmatige rijen blijven altijd staan |
| `tank_setpoints` | array | Werkelijk setpoint per tank, gelezen van de gekoppelde climate-entity door de server-tick `_lees_tank_setpoints`: `{tank, entity, setpoint, sinds, gezien}`. `sinds` = moment van de laatste setpoint-wissel (leeg bij de eerste waarneming — een herstart mag geen instelvenster starten), `gezien` = laatste geslaagde uitlezing (ouder dan 2 uur = terugval op het schema). Alleen de server schrijft hier; bewust **niet** in de Excel-backup (regenereert vanzelf) |
| `wc_import_status` | object | Stand van de automatische WooCommerce-import. Server (`_wc_orders_tick`, interval = `woocommerce_creds.importInterval`): `nieuw` = webshoporders die nog niet als bestelling bestaan, `gemeld_ids` = waarvoor al een HA-melding ging, `laatste_check`/`laatste_fout`. Tabbladen: `bezig_tot`/`door` = import-lease, `laatste_import*`. Bewust **niet** beheer-only (elke schrijvende rol importeert) en niet in de backup (regenereert). De import zelf blijft in de app (`utils/wcOrderImport.ts`) |
| `website_telemetrie` | object | Website-telemetrie naar de plugin Craftery Brouwerij: `{enabled, interval_min (15–240, default 60), onderdelen: {gisting, sensoren, hop_kg, mout_kg, liters_tank, liters_verpakt, batches_gebrouwen}}` — alles standaard uit, alleen een echte `true` telt. **Beheer-only**; wel in de Excel-backup |
| `website_telemetrie_status` | object | Stand van de website-telemetrie, alleen door de server geschreven (`_website_verstuur`): `laatste_poging`, `laatst_gelukt`, `gelukt`, `fout` (`{code, http, oorzaak?}`), `antwoord` (begrensd plugin-antwoord: versie, ontvangen, vers, max_leeftijd, regels, plaatshouders), `op_site` (staan er cijfers op de site — stuurt het ene lege bericht bij uitzetten), `leeg`, `handmatig`. Beheer-only, de app leest hem met een gewone GET (geen useStore: die zou de key vanuit de client aanmaken). Niet in de backup (regenereert) |
| `tank_alarmen` | array | Temperatuurstoringen per tank/batch, geopend en gesloten door de server-tick `_tank_bewaking_tick` (soort `waarschuwing`/`alarm`/`sensor_stil`, reden, piekafwijking, hersteltijdstip). De app leest ze voor de banner en zet `bevestigd` bij wegklikken — nooit zelf openen of sluiten |
| `carbonatie_sessies` | array | Carbonisatie-sessies per batch (CO₂-stone of kopdruk) |
| `verlies_registraties` | array | Verliesposten per batch (tankrest, leiding, schuim, monster, afgekeurd, overig) |
| `batch_notities` | array | Vrije, handmatige notities per batch (timestamped logje) |
| `water_profielen` | array | Waterprofielen bronwater (gereedschap Waterprofiel): ionen in mg/L uit een gescand waterkwaliteitsrapport of handmatige invoer |
| `water_doelprofielen` | array | Eigen doelprofielen brouwwater (gereedschap Waterprofiel), naast de ingebouwde stijlprofielen |
| `kapitaal_boekingen` | array | Kapitaalstortingen / -onttrekkingen |
| `journaal` | array | Onveranderlijke journaalregels (ERP 2.1): geboekt bij definitief maken van facturen/aangiftes, bedragen in centen, correcties via storno — server-side append-only (422 bij wijzigen/verwijderen van bestaande regels) |
| `jaarafsluitingen` | array | Jaarafsluitingen (ERP 2.3): snapshot balansposten + eigen vermogen per afgesloten boekjaar; beginbalans voor het EV-verloop op de balans |
| `bank_saldi` | object | Laatst bekende MT940-eindsaldo per IBAN (ERP 2.3), gezet bij bankimport; bron voor "liquide middelen" op de balans |
| `btw_tarieven` | array | Actieve BTW-tarieven (bijv. `[0, 9, 21]`) |
| `ing_types` | array | Ingrediënttypen |
| `accijns_instellingen` | object | Accijnstarieven |
| `btw_instellingen` | object | BTW-aangifte-instellingen: `periode` + `standaard_btw` (voorgesteld tarief bij nieuwe artikelen/verkoopregels, default 21% via `standaardBtwPct` in `utils/btw.ts`) |
| `ing_type_btw` | object | Standaard BTW% per ingrediënttype |
| `brewery_details` | object | Brouwerijnaam, adres, land (ISO-2), BTW-nr., KvK, PEPPOL-ID/-schema (e-factuur), website (klikbaar logo in mail), `factuur_velden` (zichtbaarheid) en `factuur_template` (`{html, css}` — eigen factuurlayout, leeg = de ingebouwde standaard uit `utils/factuurTemplate.ts`) |
| `mail_templates` | object | Aangepaste mail-templates per kind (`pakbon`, `factuur`, `factuur_betaald`, `bestelling`, `verzending`, `afhaal_gemist`) met `subject`/`body`; leeg = i18n-default. `bestelling` kent `{levering}` (afhaal-/bezorgtekst incl. de link naar de afhaalpagina van de klant), `verzending` is de verzendbevestiging met `{trackregel}`/`{track}`, `afhaal_gemist` de mail voor een afhaalklant die niet kwam (`{afhaalmoment}` + `{afhaalregel}` met dezelfde link om een nieuw moment te kiezen; knop verschijnt via `afhaalmomentVerstreken`) — zie `utils/levering.ts` |
| `gebruikers_rollen` | object | Rollen per HA-ingress-gebruiker (ERP 4.2): `{gebruikers: {naam: rol}, standaard_rol}` met rollen `beheer`/`boekhouding`/`productie`/`alleen_lezen` — server-side afgedwongen, alleen door `beheer` te wijzigen, lockout-guard |
| `login_instellingen` | object | Styling van de loginpagina op de directe-toegangspoort: titel/ondertitel/knoptekst, accent-/achtergrondkleur (hex), achtergrondafbeelding (data-url), `logo_tonen`. Server rendert met strikte validatie (`_login_pagina`) — pre-auth, dus nooit ongefilterd |
| `factuur_counter` | object | *(legacy)* Doorlopend factuurnummer per jaar — vervangen door `nummer_reeksen`, alleen nog als migratie-seed gelezen |
| `nummer_reeksen` | object | Server-beheerde nummerreeksen (`factuur`/`creditnota` per jaar; `bestelling` = kort doorlopend `M-`-nummer voor handmatige orders, geen jaarreset), atomair uitgegeven via `POST /api/nextnr` — nooit client-side muteren |
| `ha_instellingen` | object | Home Assistant sensor-instellingen (incl. CO₂-cilinder weegsensor: `co2_enabled`/`co2_entity`/`co2_unit`, en `bewaking` = drempels van de temperatuurbewaking; leeg veld = default uit `utils/tankbewaking.ts`) |
| `notificatie_instellingen` | object | Meldingsinstellingen: HA `notify`-service + scherm-melding (herbruikbaar voor alle notificaties) |
| `bank_koppelingen` | object | Koppeling banktransacties aan facturen/BTW (zie hieronder) |
| `app_logo` | string\|null | Base64 app-logo |
| `app_logo_icoon` | object | Automatisch gegenereerd 180×180-PNG-icoon uit het logo (`{van, icoon}`) t.b.v. `GET /api/app_icoon` (iOS-home-screen); afgeleide data — beheer-only, bewust níét in de Excel-backup (regenereert vanzelf) |
| `factuur_logo` | string\|null | Base64 factuurlogo |
| `app_name` | string | Naam van de brouwerij-app |
| `nav_theme` | string | UI-thema (`amber`/`green`/`blue`/`slate`/`red`/`purple`) |
| `brewfather_creds` *(secure)* | object | Brewfather API-credentials (nooit in backup) |
| `woocommerce_creds` *(secure)* | object | WooCommerce API-credentials + import-instellingen (`importStatussen`, standaard incl. `completed`; `importVanaf`-datum) `prijzenInclBtw` (voert de winkel prijzen incl. BTW in? default ja — bepaalt de omrekening bij een productpush) en `themaVelden` (Craftery-`_cf_`-velden beheren, default aan), `bestelUrl` (eigen sjabloon voor de bestelpagina van de klant met `{winkel}`/`{id}`/`{sleutel}`; leeg = de bij de import per order bepaalde `wc_bestel_url` — knop in de bestelbevestiging via `bestelLink` in `utils/levering.ts`) — nooit in backup |
| `claude_creds` *(secure)* | object | Anthropic API-key (nooit in backup) |
| `smtp_creds` *(secure)* | object | SMTP-server (host/port/user/pass/from/security/enabled) voor pakbon-, factuur- en bestelmail (nooit in backup) |
| `mollie_creds` *(secure)* | object | Mollie API-key + `enabled` + `redirectUrl` voor de online betaallink op verkoopfacturen (nooit in backup); server-side proxy voegt de key toe |

---

## Backup & Restore

Backup en restore gaan via Excel (`.xlsx`) — **niet** via JSON. De functies `excelExport` en `excelImport` in `src/utils/excel.ts` verwerken alle data.

- **Export:** `doExport()` in `App.tsx` → `excelExport(data)` → downloadt `brewadmin_backup_YYYY-MM-DD.xlsx`
- **Import:** `doImport(e)` in `App.tsx` → `excelImport(file, cb, onError)` → stelt alle state in
- **UI:** Instellingen → App → Data import & export (`accept=".xlsx"`)
- **Bestandsstructuur:** 31 array-sheets (één per datasleutel) + één `Instellingen`-sheet voor objects, primitieven en logo's
- **Geneste objecten** binnen array-items worden als JSON-string opgeslagen en bij import teruggeparsed
- **Credentials** (`brewfather_creds`, `woocommerce_creds`, `claude_creds`) zitten **nooit** in de Excel-backup en alleen gemaskeerd in de download-ZIP van een serverbackup (zonder db-kopie, `_backup_to_zip`); de serverbackup op schijf en offsite bevat ze wél (0600/0700), zodat die volledig herstelbaar blijft
- **Afgeleide serverdata** (`app_logo_icoon`, `tank_setpoints`, `wc_import_status`, `website_telemetrie_status`) staat bewust niet in de backup — die regenereert vanzelf

Wanneer je een nieuwe `useStore`-sleutel toevoegt, voeg deze dan ook toe aan `excelExport` (nieuw sheet of rij in Instellingen) én aan de import-callback in `doImport`.

---

## BTW Aangifte — implementatiedetails

### Periodeberekening

`getPeriodes(year, periode)` in `BoekhoudingPage.tsx` berekent kwartaal- of maandperiodes. De geselecteerde periode wordt bijgehouden in `selectedPeriode` (lokale state). De memo's `btwPerTariefAangifte` en `omzetBtwPerTarief` filteren altijd op de geselecteerde periode (of het hele jaar als niets geselecteerd is).

- **Facturen tellen op hun effectieve periode** (`inBtwPeriode`/`inBtwJaar` in `utils/btw.ts`), inkoop én verkoop: een factuur met een datum in een al ingediende of betaalde periode krijgt bij aanmaken `btw_periode` (rollover) en telt in de lopende aangifte. WooCommerce-orders blijven op betaaldatum.
- **Eén bron per verkoop:** een opgehaalde WooCommerce-order telt alleen mee zolang er in de app geen verkoopfactuur voor bestaat (`wcOrdersNogNietGefactureerd`); een afgeronde webshoporder telt via zijn factuur.
- **Handmatige inkooptotalen** worden een correctieregel (`inkoopRegelsMetCorrectie` in `utils/centen.ts`), zodat journaal, W&V, rubriek 5b en de periodekaart dezelfde voorbelasting tellen.

### Periodestatus

Periodes hebben vier statussen:

| Status | Kleur | Conditie |
|--------|-------|----------|
| Toekomstig | Grijs | `p.from > today` |
| Lopend | Blauw | `p.from ≤ today ≤ p.to` |
| Openstaand | Oranje | `p.to < today` én géén BTW-koppeling in `bankKoppelingen` |
| Afgesloten | Groen | `p.to < today` én BTW-koppeling aanwezig |

Een periode wordt pas "Afgesloten" wanneer de gebruiker een banktransactie koppelt als bewijs van betaling. Zolang dat niet is gedaan staat de periode op **Openstaand** (oranje).

### `bankKoppelingen` — koppelingtypen

Het `bankKoppelingen` object (sleutel: `txKey(tx)`) ondersteunt drie soorten koppelingen:

```ts
// Verkoopfactuur
{ soort: 'verkoop', factuurId: number }

// Inkoopfactuur
{ soort: 'inkoop', factuurId: number }

// BTW-afdracht (koppelt een debettransactie aan een BTW-periode)
{ soort: 'btw', periodeKey: string }  // bijv. '2026-Q1' of '2026-M04'

// SNd-afdracht (statiegeld aan Statiegeld Nederland): debettransactie ↔
// SNd-periode; zet die periode op de Statiegeld-pagina op "afgedragen".
// Een kwartaalkoppeling dekt de maanden erin (utils/sndAfdracht.ts)
{ soort: 'snd', periodeKey: string }

// PSP-uitbetaling (Mollie e.d.): één credittransactie dekt meerdere
// verkoopfacturen; het verschil (transactiekosten) wordt automatisch als
// betaalde inkoopfactuur geboekt (kostenFactuurId). gemarkeerdBetaald bevat
// de factuur-ids die door de koppeling op betaald zijn gezet, zodat
// ontkoppelen ze kan terugzetten.
{ soort: 'psp', factuurIds: number[], kostenFactuurId?: number, gemarkeerdBetaald: number[] }
```

De computed `btwBetaaldePerioden` (memo in `BoekhoudingPage`) leest alle `soort: 'btw'`-entries en bouwt een `Set<string>` van betaalde periodeKeys. Bij MT940-herimport worden BTW-koppelingen automatisch hersteld via `gekoppeldBtwPeriode` op de transactie.

---

## Backend (server.py) Reference

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data/<key>` | Load data key (JSON, uit SQLite) |
| POST | `/api/data/<key>` | Save data key (JSON, naar SQLite) |
| GET | `/api/health` | Health-check (ERP 3.6): status achtergrondthreads, laatste-backupdatum, data-dir, uptime — dashboard toont dit |
| GET | `/api/whoami` | Gebruiker + rol: `{gebruiker, rol, sessie}` (`sessie: true` = ingelogd via de directe poort) |
| GET | `/api/ha_gebruikers` | HA-gebruikerslijst voor het rollenbeheer (beheer-only; via core-websocket `config/auth/list` met een stdlib-RFC6455-client) |
| POST | `/api/login` | Alleen directe poort (8098): HA-login via Supervisor-auth → sessiecookie |
| POST | `/api/logout` | Alleen directe poort: beëindig de sessie |
| GET | `/api/ping` | *(geen echte route — valt door naar de SPA-fallback; gebruik `/api/health`)* |
| POST | `/api/brewfather/*` | Proxy to Brewfather API |
| POST | `/api/woocommerce/*` | Proxy to WooCommerce API (GET via de prefix, PUT via `put/`) |
| POST | `/api/woocommerce/create/*` | Aanmaken in WooCommerce (product, categorie, tag). Bewust **zonder** herkansing bij een timeout: een POST is niet idempotent |
| POST | `/api/claude` | Proxy to Anthropic Claude API |
| POST | `/api/nextnr` | Volgend factuur-/creditnotanummer, atomair per reeks/jaar (`{reeks, jaar}` → `{jaar, nr, nummer}`) |
| POST | `/api/commit` | Meerdere data-keys atomair opslaan (`{data:{key:waarde}, versions:{key:versie}}`), 409 bij versieconflict |
| POST | `/api/delta/<key>` | Delta-sync per record (ERP 4.3): `{upsert:[records], delete:[ids]}` met verplichte `X-Data-Version` (en unieke id's: een dubbele id binnen één upsert, of een id in zowel `upsert` als `delete`, geeft 400 — anders komt hetzelfde record twee keer in de opslag en verliest de key permanent delta-ondersteuning); client valt bij 400/404 automatisch terug op de volledige POST |
| POST | `/api/website/voorbeeld` | Het telemetriebericht dat er nu verstuurd zou worden (`{instellingen?}` → `{bericht, bytes, max_bytes}`), met dezelfde code als de echte verzending — beheer-only |
| POST | `/api/website/test` | GET op de plugin-route (`/wp-json/wc-craftery/v1/brouwerij`): versie, laatst ontvangen, vers — verandert niets; beheer-only |
| POST | `/api/website/verstuur` | Telemetrie nu versturen, buiten het interval (`{instellingen?}`); 409 als de koppeling of alle onderdelen uit staan, `te_snel` binnen 10 s na het vorige bericht. Beheer-only, audit `website_verstuur` |
| POST | `/api/mail/test` | Test SMTP-credentials (login probe, niets opslaan) |
| POST | `/api/mail/send` | Verstuur HTML+text-mail via opgeslagen SMTP-creds (max 20 MB, max 50 recipients, max 15 MB bijlagen, optionele CID-inline images) |
| POST | `/api/mollie/test` | Test een Mollie API-key (beheer-only, niets opslaan); key mag de sentinel zijn |
| POST | `/api/mollie/payment` | Maak een Mollie **betaallink** (Payment Links API, `/v2/payment-links`) aan voor een factuur (boekhouding); `{amountCent, description, redirectUrl}` → `{checkoutUrl, id, expiresAt}`. Key wordt server-side toegevoegd. Bewust géén Payments API: die levert een kortlevende checkout die na verlopen naar de website doorstuurt |
| GET | `/api/backups[/<datum>]` | Serverbackups (`/data/backups/JJJJ-MM-DD/`, dagelijks, elke key als `<key>.json` + db-kopie, 0600 in een 0700-map) opsommen of als ZIP downloaden — beheer-only. De download-ZIP bevat geen db-kopie en de credentials gemaskeerd (`__SECRET__`) |
| POST | `/api/backups/trigger` | Nu een backup maken (beheer-only) |
| POST | `/api/backups/restore` | Eén data-key terugzetten uit een serverbackup (`{date, key}`) — beheer-only, geweigerd voor append-only keys, credentials en server-beheerde keys (`_NIET_TERUGZETBAAR`: `nummer_reeksen` + afgeleide serverdata), zelfde schrijfweg als `/api/data` (schemavalidatie, rollenvalidatie + lockout-guard via `_key_guard_fout`, versie, audit `backup_restore`). De rest van de administratie blijft staan |
| POST | `/api/upload` | File upload (PDF/image, max 20 MB). Overschrijft nooit een bestaande bijlage: bij een botsing wijkt de server uit naar een vrije naam en geeft die terug als `bestand` — de client bewaart díé naam |
| POST | `/api/delete_upload/<naam>` | Bijlage verwijderen; 409 zolang een inkoopfactuur, afboeking of verliesregistratie ernaar verwijst (`_bijlage_in_gebruik`) |
| GET | `/*` | Serve `index.html` (SPA fallback) |

### Security constraints (do not remove)

- Backup-retentie heeft een ondergrens: `_MIN_BACKUPS_BEWAREN` /
  `_MIN_AUDIT_BEWAREN` houden de nieuwste backups en auditmaanden altijd
  overeind. Het beleid zelf hangt aan `date.today()`, dus een klok die
  vooruitspringt zou anders in één ronde de lokale mappen, de offsite-ZIP's
  én het auditspoor wissen — nooit weghalen
- Rate limiting: 600 requests/minute per IP (alle ingress-clients delen één gateway-IP; login op de directe poort heeft een eigen strenge limiet)
- Request body size: 10 MB general, 20 MB for Claude proxy
- File upload: only `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp` allowed
- Key validation: `^[a-zA-Z0-9_]+$` — prevents path traversal
- SQLite-opslag (ERP 4.1): `/data/brewadmin.db` in WAL-mode met
  `synchronous=FULL`; schrijvers serialiseren onder `_data_lock`, de
  database en WAL/SHM-sidecars staan op 0600 (credentials zitten erin) —
  nooit rechtstreeks losse JSON-databestanden in `/data/` schrijven. De
  JSON→SQLite-migratie scant `/data/*.json`: bestanden die géén app-data zijn
  (`options.json` van de Supervisor, `brewadmin_sessies.json` van de
  directe-toegangspoort) staan in de uitzonderingslijst van
  `_migreer_json_bestanden` — een nieuw infrastructuurbestand in `/data/` hoort
  daar ook bij, anders verhuist het bij de eerstvolgende start
- Secrets-maskering: GET op creds-keys vervangt gevoelige velden door `__SECRET__`; POST vult de sentinel server-side terug in (`_mask_secrets`/`_unmask_secrets`) — nooit omzeilen of de sentinel-waarde opslaan. Wijkt de bestemming af (`_SECRET_BESTEMMING`: `storeUrl`; SMTP-host/-poort/-gebruiker/-beveiliging), dan vult hij níét in maar antwoordt 400 `secret_opnieuw_invoeren` (data-POST, commit, mail-/WC-test; UI-spiegel `utils/geheimen.ts`)
- Server-audit: elke data-write wordt append-only gelogd naar `/data/server_audit/audit_YYYY-MM.jsonl` (`_audit_write`) — niet bereikbaar via de data-API, nooit verwijderen of omzeilen
- Schemavalidatie: `_KEY_TYPES` dwingt containertypes af (422). Nieuwe data-key? Voeg hem toe aan `_KEY_TYPES`
- Geen NaN/Infinity in de opslag: de schrijfwegen lezen via `_json_laden_strikt` (400), HA-waarden gaan door `_eindig_of_none`, en `_json_compact` maakt van een toch binnengekomen niet-eindig getal `null` (Python schreef anders letterlijk `NaN`, wat de app niet kan parsen)
- Append-only keys: `_APPEND_ONLY` (`journaal` + de HACCP-registraties `haccp_vrijgaven`, `haccp_sluitcontroles`, `haccp_etiketcontroles`, `haccp_afwijkingen`, `haccp_trace_oefeningen`) — bestaande records mogen nooit gewijzigd of verwijderd worden (422); correcties gaan via storno- resp. vervangende regels. `_append_only_ok` vergelijkt per id als multiset: een dubbele id, een nieuw record zonder id of een extra variant naast een bestaande id wordt ook geweigerd. Nooit omzeilen. Een CCP-registratie is bewijs richting de NVWA (HACCP-handboek bijlage A.1): wie en wanneer worden automatisch vastgelegd en zijn niet handmatig invulbaar
- Gebruikers & rollen (ERP 4.2): mutaties worden per rol afgedwongen (`_rol_mag_key` + endpoint-gates in do_GET/do_POST, 403 met `reden: rol` + audit). Nieuwe financiële key? Voeg hem toe aan `_FINANCIELE_KEYS`; nieuwe instellingen-key aan `_BEHEER_KEYS`. Nooit omzeilen
- Optimistic locking + atomaire commit: `X-Data-Version`-conflictdetectie op `/api/data`; multi-key writes via `POST /api/commit` (client bundelt saves per event-tick automatisch)
- CSP headers: strict `default-src 'none'` policy
- CORS: localhost/127.0.0.1/[::1] only
- Directe-toegangspoort (8098, `config.yaml ports: null` = standaard uit):
  vereist HA-login via de Supervisor-auth-API (`auth_api: true`), geeft een
  HttpOnly/SameSite=Strict sessiecookie (standaard 24 u glijdend, of 30 dagen
  met 'onthoud mij' bij het inloggen; `Secure` zodra de poort HTTPS draait).
  Sessies worden 0600 op schijf bewaard (`brewadmin_sessies.json` in de
  data-dir, bevat sessietokens — nooit via de data-API of in backups) en bij
  herstart hersteld, zodat een addon-update niet uitlogt. Addon-optie
  `ssl: true` = HTTPS met
  certificaten uit `/ssl` (eigen domein via Let's Encrypt-/DuckDNS-addon),
  dagelijks herladen; onbruikbaar certificaat → poort start NIET
  (fail-closed, nooit stil onversleuteld). `/data/options.json` is van de
  Supervisor — nooit migreren of via de data-API aanraken;
  X-Remote-User-headers worden op deze poort genegeerd (spoofbaar) — de
  sessiegebruiker telt voor rollen en audit; strenge login-rate-limit
  (5 mislukte pogingen per 5 min per IP), logins/pogingen in de audit.
  Nooit de sessie-check omzeilen of wachtwoorden loggen

---

## External Integrations

### Brewfather API

- REST API, authenticated via Basic auth (user ID + API key)
- Used for: recipe list, batch list, batch status sync
- Credentials stored in `instellingen` data key (`bfUserId`, `bfApiKey`)
- Auto-sync: draait **één keer per mount** van `App.tsx` (`bfAutoSynced`-ref), niet
  op een interval; een nieuwe sync vergt een herlaad of de handmatige knop.
  Let op: de sync overschrijft `vergistingsprofiel`/`maischprofiel`/OG/FG
  onvoorwaardelijk — zie `docs/ERP-VERBETERPLAN-2.md` W6 (fase 7.4)
- De status gaat alleen vooruit langs de regels van de batch-flow
  (`bfStatusOvergang` in `utils/bfStatus.ts`): tankclaim bij Vergisten, CCP 1
  vóór Afgevuld, tank op Vuil bij vertrek, statusregel + audit. Wat daar
  zou blokkeren of een bevestiging vraagt wordt níét overgenomen
- Automatische schrijfacties bij het openen (deze sync, de klantkoppeling,
  de 'ingelogd'-auditregel) wachten op `whoami` en slaan een key over die de
  rol niet mag schrijven (`rolMagKey` in `utils/rollen.ts`, spiegel van
  `_rol_mag_key`); `lastSync` in de creds schrijft alleen beheer

### WooCommerce API

- REST API v3, Basic auth (consumer key + secret)
- Used for: order fetch, product lookup by SKU, betaalstatus van een order
  (`date_paid` + status; zie `utils/wcImport.ts`). Bij elke import wordt de
  betaalstatus van al bestaande orders ververst — een order die als `pending`
  binnenkwam kan later betaald zijn. Een order die in WooCommerce betaald is,
  levert bij afronden een verkoopfactuur met status `betaald` (die factuur
  vraagt niet meer om een overboeking, in de mail noch op de PDF)
- **Annulering in de winkel** (`utils/wcOrderImport.ts`): open bestellingen
  die niet in de statusselectie zaten, haalt elke import apart per id op
  (`include=…&status=any`, alleen verversen, nooit nieuw). Geannuleerd, mislukt
  of terugbetaald → `wc_status` op de bestelling (badge + attentiepost
  `webshop_afgebroken`); `cancelled`/`refunded` zonder picks bij status
  `nieuw`/`bevestigd` → de import zet hem zelf op `geannuleerd` (zonder terug
  te schrijven). Onze eigen `completed` (terugschrijven) op een onbetaalde
  order telt niet als betaling: `wc_sync.onbetaald` →
  `betaalVeldenNaEigenSync` in `utils/wcImport.ts`
- **Afhalen of verzenden** (`utils/levering.ts`): de verzendregel van de order
  zegt of de klant afhaalt (`local_pickup`/`pickup_location`) of laat bezorgen.
  Het Craftery-thema bewaart bij een afhaalorder het gekozen afhaalmoment
  (`_craftery_afhaalmoment`: `JJJJ-MM-DD UU:MM` of `overleg`) en biedt de
  klant een privépagina `<winkel>/?afhaalmoment=<order-id>&sleutel=<order_key>`
  om dat moment te kiezen of te verzetten. De app leest dit bij elke import mee
  (ook voor bestaande orders — het moment wordt vaak pas later gekozen) en zet
  het in de bestelbevestiging via `{levering}`; de link naar die pagina staat
  niet in de tekst maar als knop onder de mail (`afhaalMailKnop`: *Kies je
  afhaalmoment* / *Verzet je afhaalmoment*; `MailModal` zet elke `MailKnop`
  in de platte tekst als regel + kale link). Een bezorgorder krijgt bij
  *Markeer verzonden* meteen de verzendbevestiging aangeboden (template
  `verzending`, met track & trace). Is het gekozen afhaalmoment voorbij en
  staat de order nog open, dan biedt de bestelpagina *Mail afspraak gemist*
  (template `afhaal_gemist`): dezelfde afhaalpagina als knop *Kies een nieuw
  afhaalmoment* (`afhaalGemistMailKnop`); het nieuwe moment komt bij de
  volgende import mee. De
  bestelbevestiging van een webshoporder krijgt een knop *Bekijk je
  bestelling* (`bestelLink`: het sjabloon `woocommerce_creds.bestelUrl`, anders
  `wc_bestel_url` — bij elke import per order bepaald door `bestelPaginaLink`:
  een klant met account krijgt de bestelling in Mijn account via de pagina-ID
  (`?page_id=8&view-order=<id>`; WordPress stuurt door naar de mooie URL, dus
  de slug van de winkel doet er niet toe), een gast de bedankpagina met
  ordersleutel (uit `payment_url`, anders via de afreken-pagina-ID). De
  pagina-ID's en endpoint-slugs komen uit `wc/v3/settings/advanced`
  (`haalWcPaginas` in `utils/wcOrderImport.ts`, één verzoek per import;
  mislukt = stil overslaan, nooit de import laten falen). Nooit gegokt:
  zonder link en zonder sjabloon geen knop); `MailModal` rendert de
  `linkButtons` (afhaalknop eerst, dan de orderknop) als knoppen in de HTML en als regel + kale link in de platte tekst
- **Periodiek ophalen** (`woocommerce_creds.importInterval`, minuten, default 15,
  0 = uit): App.tsx importeert elke N minuten zelf (`autoImportWc`, dezelfde
  `importeerWcOrders` als de knop) zolang een tabblad open staat en de rol mag
  schrijven; een lease in `wc_import_status` houdt tabbladen uit elkaar, en
  `verwijderDubbeleWcOrders` ruimt een onaangeroerde dubbel (status `nieuw`,
  geen picks, geen factuur) op als twee tabbladen toch tegelijk waren. De
  server-thread `_wc_orders_loop` kijkt in hetzelfde ritme of er webshoporders
  zijn die hier nog ontbreken, stuurt daar één HA-melding over en zet ze in
  `wc_import_status.nieuw`; de app importeert dan meteen en de Verkoop-header
  telt ze (`attentie_webshop_nieuw`). Een servertick importeert bewust niet
  zelf: de artikel-/merchherkenning leeft in de app
- **Terugschrijven** (`utils/wcTerugschrijven.ts`, instelling
  `woocommerce_creds.terugschrijven`, standaard uit): `verzonden`/`afgerond` →
  `PUT orders/<id> {status: completed}` (+ privé-ordernotitie met de track &
  trace via `POST orders/<id>/notes`, `customer_note: false`), `geannuleerd` →
  `cancelled`. **Voorraadregel:** WooCommerce boekt bij `cancelled` de
  voorraad terug; dat klopt alleen zolang er in BrewAdmin nog niets is
  uitgeslagen (dan valt hier de reservering weg en stijgt de volgende
  voorraadpush evenveel). Is er al uitgeslagen, dan gaat er géén status maar
  alleen een notitie — anders komt bier te koop dat er niet meer is. De
  uitkomst staat als `wc_sync` op de bestelling (badge + knop "opnieuw").
  Altijd fire-and-forget ná de lokale statuswijziging. `completed` laat
  WooCommerce zelf de klantmail "Voltooide bestelling" sturen — de
  instellingen vragen die uit te zetten, BrewAdmin's verzendbevestiging is
  leidend
- Credentials in `instellingen` (`wcUrl`, `wcKey`, `wcSecret`)
- **Productbeheer** (v1.12.8): de volledige productkaart per artikel staat in
  `productArtikel.wc` resp. `merchArtikel.wc` (`WcVelden` uit
  `utils/wcProduct.ts`) en wordt bewerkt in `components/WcProductModal.tsx`
  (knop `WC` bij het artikel). Ophalen = de winkel is leidend; pushen gaat via
  `bouwWcPayload`, dat **lege velden weglaat** zodat een push nooit iets in de
  webshop wist. Bulk: `↑ Push voorraad` (alleen `stock_quantity`),
  `↑ Push alles` (complete kaart) en `↓ Ophalen uit webshop` op de
  productenpagina. Een SKU die de winkel nog niet kent wordt aangemaakt via
  `POST /api/woocommerce/create/products`
- **Bierinformatie** (`utils/bierinfo.ts`): kcal, ingrediënten, smaakprofiel,
  serveertip, de vijf smaakassen, Untappd, "uit roulatie" en vrije extra regels
  staan als **gewone velden op het product**; maat/aantal, pakketinhoud, badge
  en levering als velden op het artikel (en op `merch_artikelen`). Je bewerkt ze
  waar je het bier resp. de verpakking bewerkt: in het **productformulier**
  (dezelfde Bewerken-knop als voor naam, stijl en ABV) en in het
  artikelformulier — niet in een apart webshopscherm. De productpagina toont
  het bier meteen zoals de webshop dat doet (`components/BierInfoWeergave.tsx`:
  cijferstrip, smaakbalken, spectabel, tekstblokken); `weergave` op de
  velddefinitie bepaalt waar een veld belandt.
  Velden met `afgeleid: true` (ABV, IBU, EBC, stijl, inhoud) leidt
  `afgeleideBierInfo` af uit de productgegevens, de verpakking en het recept;
  die zijn nergens een invulveld. `bierInfoVoorArtikel` stapelt afgeleid → bier
  → verpakking (een leeg veld drukt de laag eronder nooit weg).
  `components/BierInfoForm.tsx` rendert de velden overal hetzelfde
- **Naar de webshop** (`utils/craftery.ts`): `crafteryMeta` vertaalt die
  bierinformatie naar de `_cf_…`-post-meta van het Craftery-thema en gaat als
  `meta_data` mee in de push; `crafteryLees` doet het omgekeerde bij het
  ophalen (afgeleide velden komen niet terug — die staan in de administratie
  zelf). Wijzigt het thema, dan wijzigt `CRAFTERY_META` mee; de app schrijft
  nooit een meta-sleutel die daar niet in staat en laat meta van andere plugins
  ongemoeid. Uit te zetten met `woocommerce_creds.themaVelden = false`
- **Website-telemetrie** (server: `_website_tick`/`_website_loop`, thread
  `website`; UI: `components/WebsiteTelemetrie.tsx`; standaard uit): elk
  interval (default 60 min, 15–240) een momentopname naar de plugin
  **Craftery Brouwerij 1.1.0+** op `{storeUrl}/wp-json/wc-craftery/v1/brouwerij`,
  met dezelfde consumer key via `_wc_request(..., api_pad=WEBSITE_API_PATH)`.
  Een POST vervangt het vorige bericht helemaal; zonder herkansing (de volgende
  ronde komt vanzelf). `_website_bericht` is een pure functie (data + live
  HA-staat in, dict uit) en haalt alle grenzen van het contract (8 tanks,
  tank 12 / bier 60 tekens, temp −30…120, sensoren 0…999, 20 waarden met naam
  `[a-z0-9_]{1,32}`, 8 kB). Alleen wat per onderdeel aan staat gaat mee, en
  alleen afgeleide échte getallen: temperatuur live van de sensor, anders een
  `gist_metingen`-rij van hooguit twee uur oud, anders niets; koeling/
  verwarming gaat niet mee (de app kent geen percentage). `liters_verpakt`
  gebruikt `_voorraad_per_locatie`, de **Python-spiegel van
  `voorraadPerLocatie`** — wijzig je die in `calculations.ts`, wijzig hem daar
  ook (idem `_tank_rest_volume` ↔ `tankRestVolume`). Uitgezet terwijl er
  cijfers op de site staan (`op_site`) → één leeg bericht `{}`.
  **Nooit** klanten, bestellingen, prijzen, recepten of financiële data in het
  bericht zetten
- Afbeeldingen zijn verwijzingen, geen uploads: de WC REST API accepteert een
  media-`id` of een publieke `src`-URL. Base64 uit deze app kan er niet in —
  uploaden blijft WordPress-werk

### Claude AI (Anthropic)

- Used for: purchase invoice scanning (PDF → structured data)
- Client does PDFjs text extraction first; only calls Claude if needed
- API key stored in `instellingen` (`claudeKey`)
- Server proxies the request, adding the API key server-side
- Response expected as JSON: `{ supplier, date, invoice_number, lines: [{description, quantity, unit_price, vat_rate, total}] }`

### Mollie (betaallink op facturen)

- Used for: online betaallink (iDEAL, creditcard, Bancontact …) op **verkoop­facturen** die per mail worden verstuurd
- API-key + `enabled` + `redirectUrl` in de secure key `mollie_creds`; server voegt de key server-side toe (proxy — key nooit naar de browser)
- Flow: `mailVerkoopFactuur` (BoekhoudingPage) bouwt de Mollie-context (bedrag in centen, omschrijving, redirect-URL) → `MailModal` toont een checkbox **"Mollie betaallink toevoegen"** → bij verzenden roept `mollieCreatePayment` (`POST /api/mollie/payment`) de betaal-URL op → knop in de HTML-mail (`buildMailHtml` `payButton`) + kale link in de platte tekst
- Server gebruikt de **Payment Links API** (`/v2/payment-links`), niet de Payments API: een betaallink **verloopt standaard niet** en blijft geldig tot de klant betaalt. De deelbare URL komt uit `_links.paymentLink.href` (pure helper `_mollie_link_url`). Een Payments-checkout zou kortlevend zijn en na verlopen naar de `redirectUrl` (de website/homepagina) leiden
- **Eén link per factuur** (`utils/mollieLink.ts`): omdat een link niet verloopt, komt de eerste link op de verkoopfactuur (`mollie_link: {id, url, amount_cent, aangemaakt}`) en gebruikt elke volgende mail (herinnering, aanmaning, opnieuw versturen) díe link zolang de factuur openstaat en het bedrag gelijk is (`herbruikbareBetaallink`). Maak nooit per mail een nieuwe link: twee links = de klant kan dezelfde factuur twee keer betalen. Een link die na betaling via de bank of een creditnota nog openstaat, wordt (nog) niet bij Mollie gearchiveerd
- Redirect-URL valt terug op `brewery_details.website`; zonder een geldige URL blijft de checkbox uitgeschakeld (Mollie vereist een `redirectUrl`)
- Betaling-terugkoppeling loopt via de bestaande **PSP-bankreconciliatie** (`bank.ts`): een Mollie-uitbetaling op het afschrift wordt aan de factuur/facturen gekoppeld — er is (bewust) geen webhook, want de addon is doorgaans niet publiek bereikbaar

### Home Assistant

- Addon ingress at port 8099
- `X-Ingress-Path` header used to detect HA environment
- HA Supervisor API accessed for token/info if needed

---

## Internationalization

### i18n — Verbod op hardcoded tekst (verplicht)

**NOOIT hardcoded gebruikersgerichte tekst schrijven.** Elke zin, label, knoptekst,
foutmelding, placeholder, tooltip, confirm/alert-dialoog en template-string die de
gebruiker ziet MOET via `t('sleutel')` gaan. Dit geldt ook voor:

- `alert(...)` en `confirm(...)` calls
- `title="..."` en `placeholder="..."` attributen
- Template literals: `Maximaal ${n} stuks` → `t('...').replace('{n}', n)`
- Fallback-strings: `|| 'Onbekend'` → `|| t('lbl_onbekend')`
- HTML-strings voor print/PDF (PakbonExport.tsx)
- Foutmeldingen in state: `setMsg('Fout opgetreden')` → `setMsg(t('...'))`

**Uitzonderingen (geen t() nodig):**
- DATA-waarden die als identifier opgeslagen worden (`eenheid: 'stuks'`, `status: 'Brouwen'`)
- Code-comments
- Interne log-berichten die nooit getoond worden aan de gebruiker

Bij elke nieuwe sleutel: voeg toe aan **alle 5** taalbestanden (nl/en/de/fr/es).

- Translation files: `src/i18n/{nl,en,de,fr,es}.json`
- Access via `t('key')` function from `src/i18n/index.ts`
- Fallback chain: requested lang → Dutch → `fallback`-argument → key name
- **Sleutel uit data opgebouwd? Geef een fallback mee:** `t(\`orders_status_${s}\`, s)`.
  `t()` geeft bij een missende sleutel de sleutelnaam terug — een niet-lege,
  dus truthy string. `t(...) || s` vangt dat níét af en zet een rauwe
  `orders_status_iets` in beeld. Het tweede argument doet dat wel
- Language stored in `localStorage` under `lang`; `setLang` zet ook
  `document.documentElement.lang` (schermlezers)
- **When adding UI text:** always add keys to all 5 translation files

---

## Adding New Features — Checklist

1. **Type first:** add new interfaces to `src/types/index.ts`
2. **Constants:** add new enums/mappings to `src/constants.ts`
3. **Translations:** add i18n keys to all 5 `src/i18n/*.json` files
4. **Page component:** create in `src/pages/` following existing patterns
5. **Navigation:** register page in `App.tsx` nav array and routing logic
6. **Data key:** if persisting new data, use `useStore('new_key')` — server handles storage automatically
7. **API proxy:** if calling a new external API, add proxy handler in `server.py`
8. **Security:** any new server endpoint must validate input and respect rate limiting

---

## Important Constraints

- **Testdekking op utils + server** — `npm test` dekt de pure logica in `src/utils/`, `python3 -m pytest` dekt server.py; UI handmatig verifiëren
- **Single-file build** — all JS/CSS is inlined; keep bundle size reasonable
- **Python stdlib only** — `server.py` must not import third-party packages
- **Dutch UI language** — all user-visible strings must go through i18n
- **HA Ingress compatibility** — paths must work with and without `/brouwerij_admin/` prefix
- **Non-root Docker** — code runs as `appuser`; avoid hardcoded `/root/` paths
- **Data files in `/data/`** — never write outside this directory from server.py
- **Strict alleen op utils/types/i18n** — de pagina's draaien zonder strict; vertrouw daar niet op de compiler. De strict-ratchet (`tsconfig.strict.json`) moet schoon blijven
