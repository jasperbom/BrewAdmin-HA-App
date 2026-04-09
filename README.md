# 🍺 BrewAdmin — Home Assistant Addon

A Home Assistant addon for managing a small brewery. Register batches, manage ingredients and stock, track excise duty obligations, handle purchase invoices and accounting, and synchronise with Brewfather and WooCommerce — all from one clear interface directly in your HA dashboard.

## Fully built with Claude AI.

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fjasperbom%2FBrewAdmin-HA-App)

## Features

### Dashboard
- Overview of active batches, available stock, open excise duty and active lots
- Visual tank status per fermentation or lagering tank
- Warnings for expired or near-expiry best-before dates

### Ingredients
- Manage ingredients with lots, quantities and best-before dates
- Edit and delete existing ingredients directly from the list
- Support for multiple units and packaging types
- Configurable ingredient types — add or remove types (Mout, Hop, Gist, etc.) in Settings
- Mutation log per ingredient

### Batches
- Full batch administration: name, style, status, tank, dates
- Measurements: OG, FG, ABV, litres, pH values and efficiencies
- Cost overview per batch (electricity, water, cleaning, other)
- Link ingredients with automatic stock deduction
- Fill and release finished beer
- Hygiene checklist per batch: custom groups and items, checkable per step
- Tank occupancy validation (double occupancy is blocked)
- Brewfather sync button always accessible (disabled when not configured)
- Log per batch with all mutations

### Recipes
- Import and view Brewfather recipes
- Sync recipes directly from Brewfather API
- Stock status per recipe: see at a glance whether ingredients are available

### Released Stock
- Overview per beer, batch and packaging type
- Track sold units per release
- Article master data with SKU, EAN, selling price and VAT percentage
- Red indicator for releases where excise duty has not yet been paid
- Automatic WooCommerce stock update on release
- Archiving of fully sold releases

### Excise Duty (AGP-compliant)
- Automatic excise duty calculation on release (litres × ABV × rate), with Plato tariff support
- GN-code and Plato degree on batches and ingredient lots
- Custom formula support: define your own JavaScript expression with variables `liter`, `abv`, `hl`, `r1`, `r2`
- **e-AD Register** — manage e-AD documents, emergency procedures and receipt confirmations with ARC numbers, status tracking and destination details
- **Dispatch types** — classify dispatches as domestic, intra-EU or export with destination, carrier and e-AD reference
- **Declaration workflow** — per-month status progression: open → calculated → submitted → paid
- Overview of outstanding and paid declarations

### Inventory Counts (Inventarisatie)
- Physical stock counts for ingredients, beer or both
- Automatic comparison of administrative vs. counted stock per item
- Colour-coded variance display (green = match, yellow = small, red = large)
- Mandatory explanation for any discrepancy
- Optional automatic stock corrections with mutation log

### Stock Flow / GPA Report (Voorraadverloop)
- Period-based overview (month/quarter/year) of all stock movements
- Raw materials: opening stock + purchases − production usage ± corrections = closing stock
- Finished product: opening stock + production − dispatches (domestic/EU/export) − special transactions = closing stock
- Excel export per period

### Accounting (Boekhouding)
- Purchase invoice management with supplier, date, amount and VAT fields
- **Invoice scanning** — upload a PDF or image and let Claude AI extract supplier, date, invoice number and all line items including VAT per line automatically; local PDF text extraction runs first
- **PDF viewer** — preview the uploaded attachment side by side with the entry form
- Inline editing of line items (ingredients, packaging, free-form); BTW toggle to enter prices including or excluding VAT
- Editable end totals (netto / BTW / bruto) for rounding adjustments
- Click any invoice row to re-open the full edit form; all fields and line items are pre-filled
- Date filter defaults to the full current year
- Upload PDF or image attachments per invoice (JPG, PNG, WEBP, GIF, TIFF, BMP, HEIC)
- Download all attachments for a given year as a ZIP archive
- **BTW aangifte** tab with period cards (quarterly or monthly) showing omzetbelasting, voorbelasting and te betalen per period; VAT per tariff breakdown with rubriek invoerhulp (1a/1b, 5b, 1d, 2a)
- **Accijns** tab for excise duty declarations
- CSV export for both purchase and sales invoices
- **Transactieoverzicht** tab — chronological overview of all purchase, sales and excise mutations per journal; CSV export
- **Alles exporteren als ZIP** — download all CSVs, sales invoices as HTML and purchase invoice attachments in one ZIP archive
- **Bank reconciliation** — import MT940 bank statements (`.sta`, `.txt`, `.mt940`, `.swi`, `.940`, `.swift`) and auto-match transactions to open sales invoices by amount; mark invoices as paid directly from the bank view

### Settings
The settings page is organised with a sidebar navigation:

- **Brouwerij** — manage brewery name, app name, logo, tanks, default shipping costs, AGP number, customs number and excise duty officer
- **Koppelingen** — Brewfather API integration (User ID + API key) and WooCommerce shop integration (store URL + consumer key/secret)
- **Home Assistant** — HA API connection settings
- **Financieel** — VAT period (quarterly/monthly), BTW tariff rates, excise duty rates and optional custom formula, invoice attachments download, AGP goods flow diagram
- **Ingrediënten** — configurable ingredient types; mutation log
- **Hygiëne** — manage checklist items and groups that appear per batch
- **App** — JSON backup export/import, automated server-side backups with 7-year AGP retention policy, audit trail viewer, language selection, colour theme, version display

### Internationalisation
The interface supports five languages: Dutch, English, German, French and Spanish. The app automatically detects the browser/system language on first use and applies it if supported, falling back to English otherwise. The language can be changed at any time in Settings → Language.

### Colour Themes
Six colour themes are available and can be switched in Settings → Appearance. The active theme is applied to the navigation bar, section headers, buttons, modals and the page background. All theme colours are CSS-variable based, so switching is instant without a page reload.

## Installation

Add this repository to your Home Assistant addons and install. 🍺

```
https://github.com/jasperbom/BrewAdmin-HA-App
```
