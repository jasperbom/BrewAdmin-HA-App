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
- 5-language support (NL, EN, DE, FR, ES) with 6 UI themes

The app is "fully built with Claude AI" (noted in README). UI text and many code comments are in Dutch.

---

## Architecture

```
BrewAdmin-HA-App/
├── src/                    # React/TypeScript frontend
│   ├── components/
│   │   ├── ui/             # Reusable UI primitives
│   │   ├── InkoopFactuurModal.tsx
│   │   └── PakbonExport.tsx
│   ├── pages/              # Feature pages (one per domain)
│   ├── utils/
│   │   ├── api.ts          # API client & state management
│   │   ├── constants.ts    # Enums, mappings, defaults
│   │   ├── format.ts       # Formatting utilities
│   │   ├── calculations.ts # Business logic calculations
│   │   ├── centen.ts       # Cent-exacte geldberekening (ERP 2.2): totaliseerRegels/totaliseerInkoop — gebruik dit voor élk factuurtotaal
│   │   ├── journaal.ts     # Journaalboekingen (ERP 2.1): boekingsbouwers, storno, W&V uit journaal
│   │   ├── tankbewaking.ts # Bewaking tanktemperatuur: getoetst aan het wérkelijke setpoint van de
│   │   │                   # gekoppelde koeling (key `tank_setpoints`, terugval = vergistings-
│   │   │                   # schema/cold-crash), tolerantieband, instelruimte na een setpoint-/
│   │   │                   # stapwissel, wegloopdetectie (Theil-Sen-trend) en sensorstilte —
│   │   │                   # server.py spiegelt deze regels in Python
│   │   ├── haccp.ts        # Kritische beheerspunten CCP 1/2/3: risicoklasse, stabiliteit, vrijgave-oordeel, sluitcontrole, allergenenvergelijking, afwijkingen
│   │   ├── afvulsessie.ts  # Afvulsessie: lotcode L<batch>-B<n>, THT per klasse, sessie-blokkades
│   │   ├── trace.ts        # Traceerbaarheid & recall (hoofdstuk 11): één stap terug/vooruit, massabalans, traceergaten, traceeroefening
│   │   ├── merch.ts        # Merch-artikelen: herkenning op SKU/naam (onthouden vanuit een orderregel) + eigen voorraad (mutaties, tekorten, waardering) voor merch die je zélf op voorraad hebt
│   │   ├── wcProduct.ts    # WooCommerce-productkaart per artikel: payload bouwen (lege velden gaan
│   │   │                   # nooit mee — een push wist niets), winkelantwoord lezen, verschillen
│   │   │                   # app ↔ winkel, prijsomrekening excl./incl. BTW, categorieënboom
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
│   │   ├── btwCategorie.ts # BTW-categoriecodes (UNCL5305) voor e-facturatie: afleiding uit tarief + land + BTW-nummer, VATEX-codes, EU-landenlijst, landkeuzelijst
│   │   ├── template.ts     # Mustache-subset renderer ({{waarde}}, {{{ruw}}}, {{#sectie}}, {{^omgekeerd}}) — documentlayouts als data
│   │   ├── factuurTemplate.ts # Standaard factuurlayout + contextbouwer; eigen layout via brewery_details.factuur_template, bij een fout stille terugval
│   │   ├── ubl.ts          # E-factuur in UBL 2.1 / PEPPOL BIS Billing 3.0: cent-exact, multi-tarief TaxSubtotals, kortingen als AllowanceCharge, creditnota als CreditNote-document
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

### Frontend → Backend communication

- All HTTP via `/api/` prefix
- `src/utils/api.ts` — central fetch abstraction (`_postToServer`, `useStore` hook)
- `useStore(key)` — localStorage-cached, server-synced state per data key
- Delta-sync (ERP 4.3): saves van array-keys gaan waar mogelijk als
  record-delta naar `POST /api/delta/<key>` (pure logica in
  `src/utils/delta.ts`); bij herordening, records zonder id of een oude
  server valt de client stil terug op de volledige POST
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
| PDF | pdfjs-dist 3.11.174 (lezen, factuur-scan); jsPDF 3 + html2canvas (genereren — mail-bijlagen) |
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
velden, stapelen per niveau, ingrediëntenlijst uit het recept) + de vertaling
naar het webshopthema, de
templaterenderer + factuurlayout, de Excel-backup-round-trip, de
tanktemperatuurbewaking (incl. het werkelijke setpoint van
de koeling) en de HACCP-beheerspunten
(risicoclassificatie, stabiliteit, vrijgave-oordeel, sluitcontrole,
allergenenvergelijking, lotcode en THT) en de traceerbaarheid
(één stap terug/vooruit, massabalans, traceergaten, oefeningstatus).

`server.py` heeft een pytest-suite (ERP-plan 3.2) in `tests/test_server.py`:
key-/upload-validatie, schemavalidatie (422), append-only-guard (422),
optimistic locking (409), atomaire commits, atomaire nummerreeksen (ook
onder parallelle clients), rate-limiting (429), secrets-maskering, de
server-audit, de SQLite-opslaglaag (WAL, JSON-migratie, backup-export), de
HACCP-sluitcontrole-herinnering en de tanktemperatuurbewaking (het oordeel
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
| React component files | `PascalCase.tsx` — `BatchesPage.tsx` |
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
| Accent-kleur inline tekst/link | `style={{color: 'var(--t-accent)'}}` — nooit `text-amber-*` hardcoden |
| Sectie-label binnen een card | `text-xs font-semibold text-gray-500 uppercase tracking-wide` |
| Fallback tekst (onbekende naam) | Altijd via i18n: `t('lbl_onbekend')` of `t('lbl_naamloos')` |

**Regels:**
- Gebruik `<SectionHeader title=... open=... onToggle=... info=... solid? rounded?>`
  voor alle sectie-headers. Eén links-roterend `▶` toont automatisch bij `onToggle`;
  extra info (telling, voortgang, status-pill) gaat rechts via `info`.
- Zet **geen emoji's of icon-afbeeldingen** in de bruine headerbalk; gebruik
  tekstlabels via `t()`.
- Zoekbalken altijd via `<SearchInput value onChange placeholder cls? onKeyDown?>`.
- Gebruik `style={{color: 'var(--t-accent)'}}` voor themagevoelige kleuren — dit werkt correct bij alle 6 thema's

---

## Color Conventions

### Theme-Aware Colors (gebruik altijd voor algemene UI)
De app ondersteunt 6 kleurenthema's (amber, green, blue, slate, red, purple). Gebruik **altijd** CSS-klassen die op de theemavariabelen steunen voor interactieve elementen:

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
| `voorraad_log` | array | Mutatielog ingrediënten |
| `voorraad_archief` | array | Gearchiveerde voorraadmutaties |
| `voorraad_gesloten_bieren` | array | Afgesloten biersoorten |
| `recepten` | array | Recepten (lokaal + Brewfather) |
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
| `haccp_ccp_metingen` | array | *(legacy)* Metingen op die definities, met limietcheck en automatische CAPA. Alleen nog zichtbaar/registreerbaar op de oude batchpagina |
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
| `afboekingen` | array | Biervoorraadbewegingen |
| `klanten` | array | Klanten |
| `gist_metingen` | array | Gistingsmetingen per batch |
| `tank_setpoints` | array | Werkelijk setpoint per tank, gelezen van de gekoppelde climate-entity door de server-tick `_lees_tank_setpoints`: `{tank, entity, setpoint, sinds, gezien}`. `sinds` = moment van de laatste setpoint-wissel (leeg bij de eerste waarneming — een herstart mag geen instelvenster starten), `gezien` = laatste geslaagde uitlezing (ouder dan 2 uur = terugval op het schema). Alleen de server schrijft hier; bewust **niet** in de Excel-backup (regenereert vanzelf) |
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
| `mail_templates` | object | Aangepaste mail-templates per kind (`pakbon`, `factuur`, `bestelling`) met `subject`/`body`; leeg = i18n-default |
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
| `woocommerce_creds` *(secure)* | object | WooCommerce API-credentials + import-instellingen (`importStatussen`, standaard incl. `completed`; `importVanaf`-datum) `prijzenInclBtw` (voert de winkel prijzen incl. BTW in? default ja — bepaalt de omrekening bij een productpush) en `themaVelden` (Craftery-`_cf_`-velden beheren, default aan) — nooit in backup |
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
- **Credentials** (`brewfather_creds`, `woocommerce_creds`, `claude_creds`) zitten **nooit** in de backup
- **Afgeleide serverdata** (`app_logo_icoon`, `tank_setpoints`) staat bewust niet in de backup — die regenereert vanzelf

Wanneer je een nieuwe `useStore`-sleutel toevoegt, voeg deze dan ook toe aan `excelExport` (nieuw sheet of rij in Instellingen) én aan de import-callback in `doImport`.

---

## BTW Aangifte — implementatiedetails

### Periodeberekening

`getPeriodes(year, periode)` in `BoekhoudingPage.tsx` berekent kwartaal- of maandperiodes. De geselecteerde periode wordt bijgehouden in `selectedPeriode` (lokale state). De memo's `btwPerTariefAangifte` en `omzetBtwPerTarief` filteren altijd op het datumbereik van de geselecteerde periode (of het hele jaar als niets geselecteerd is).

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
| POST | `/api/delta/<key>` | Delta-sync per record (ERP 4.3): `{upsert:[records], delete:[ids]}` met verplichte `X-Data-Version`; client valt bij 400/404 automatisch terug op de volledige POST |
| POST | `/api/mail/test` | Test SMTP-credentials (login probe, niets opslaan) |
| POST | `/api/mail/send` | Verstuur HTML+text-mail via opgeslagen SMTP-creds (max 20 MB, max 50 recipients, max 15 MB bijlagen, optionele CID-inline images) |
| POST | `/api/mollie/test` | Test een Mollie API-key (beheer-only, niets opslaan); key mag de sentinel zijn |
| POST | `/api/mollie/payment` | Maak een Mollie **betaallink** (Payment Links API, `/v2/payment-links`) aan voor een factuur (boekhouding); `{amountCent, description, redirectUrl}` → `{checkoutUrl, id, expiresAt}`. Key wordt server-side toegevoegd. Bewust géén Payments API: die levert een kortlevende checkout die na verlopen naar de website doorstuurt |
| POST | `/api/upload` | File upload (PDF/image, max 20 MB) |
| GET | `/*` | Serve `index.html` (SPA fallback) |

### Security constraints (do not remove)

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
- Secrets-maskering: GET op creds-keys vervangt gevoelige velden door `__SECRET__`; POST vult de sentinel server-side terug in (`_mask_secrets`/`_unmask_secrets`) — nooit omzeilen of de sentinel-waarde opslaan
- Server-audit: elke data-write wordt append-only gelogd naar `/data/server_audit/audit_YYYY-MM.jsonl` (`_audit_write`) — niet bereikbaar via de data-API, nooit verwijderen of omzeilen
- Schemavalidatie: `_KEY_TYPES` dwingt containertypes af (422). Nieuwe data-key? Voeg hem toe aan `_KEY_TYPES`
- Append-only keys: `_APPEND_ONLY` (`journaal` + de HACCP-registraties `haccp_vrijgaven`, `haccp_sluitcontroles`, `haccp_etiketcontroles`, `haccp_afwijkingen`, `haccp_trace_oefeningen`) — bestaande records mogen nooit gewijzigd of verwijderd worden (422); correcties gaan via storno- resp. vervangende regels. Nooit omzeilen. Een CCP-registratie is bewijs richting de NVWA (HACCP-handboek bijlage A.1): wie en wanneer worden automatisch vastgelegd en zijn niet handmatig invulbaar
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
- Auto-sync interval: configurable (default 10 minutes) via App.tsx

### WooCommerce API

- REST API v3, Basic auth (consumer key + secret)
- Used for: order fetch, product lookup by SKU, betaalstatus van een order
  (`date_paid` + status; zie `utils/wcImport.ts`). Bij elke import wordt de
  betaalstatus van al bestaande orders ververst — een order die als `pending`
  binnenkwam kan later betaald zijn. Een order die in WooCommerce betaald is,
  levert bij afronden een verkoopfactuur met status `betaald` (die factuur
  vraagt niet meer om een overboeking, in de mail noch op de PDF)
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
  artikelformulier — niet in een apart webshopscherm. De sectie
  "Bierinformatie" op de productpagina is een leesweergave.
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
- Fallback chain: requested lang → Dutch → key name
- Language stored in `localStorage` under `lang`
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
