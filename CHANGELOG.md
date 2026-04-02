# Changelog

All notable changes to this project are documented here.

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
