# 🍺 BrewAdmin — Home Assistant Addon

A Home Assistant addon for managing a small brewery. Register batches, manage ingredients and stock, track excise duty obligations, and synchronise with Brewfather and WooCommerce — all from one clear interface directly in your HA dashboard.

## Fully built with Claude AI.

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fjasperbom%2FBrewAdmin-HA-App)

## Features

### Dashboard
- Overview of active batches, available stock, open excise duty and active lots
- Visual tank status per fermentation or lagering tank
- Warnings for expired or near-expiry best-before dates

### Ingredients
- Manage ingredients with lots, quantities and best-before dates
- Support for multiple units and packaging types
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

### Excise Duty
- Automatic excise duty calculation on release (litres × ABV × rate)
- Custom formula support: define your own JavaScript expression with variables `liter`, `abv`, `hl`, `r1`, `r2`
- Overview of outstanding and paid declarations
- Mark excise duty as paid with one click
- Only stock with paid excise duty is included in WooCommerce

### Settings
The settings page is organised with a sidebar navigation:

- **Brewery** — manage brewery name, logo and tanks
- **Brewfather** — API integration (User ID + API key), manual sync
- **WooCommerce** — shop integration (store URL + consumer key/secret), manual stock push, sync log
- **Excise Duty** — set rates (per hL/ABV and per hL), optional custom formula
- **Hygiene** — manage checklist items and groups that appear per batch
- **Data** — export and import of all data (Excel backup), mutation log
- **Language** — choose interface language (Dutch, English, German, French, Spanish)
- **Appearance** — choose a colour theme (Amber, Green, Blue, Slate, Red, Purple)

### Internationalisation
The interface supports five languages: Dutch, English, German, French and Spanish. The app automatically detects the browser/system language on first use and applies it if supported, falling back to English otherwise. The language can be changed at any time in Settings → Language.

### Colour Themes
Six colour themes are available and can be switched in Settings → Appearance. The active theme is applied to the navigation bar, section headers, buttons, modals and the page background. All theme colours are CSS-variable based, so switching is instant without a page reload.

## Installation

Add this repository to your Home Assistant addons and install. 🍺

```
https://github.com/jasperbom/BrewAdmin-HA-App
```
