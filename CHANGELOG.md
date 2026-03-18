# Changelog

All notable changes to this project are documented here.

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
