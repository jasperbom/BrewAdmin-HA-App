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
│   │   └── excel.ts        # Excel import (legacy); data backup/restore is now JSON-based in App.tsx
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
- Home Assistant Ingress strips path prefix; server handles both `/` and `/brouwerij_admin/` paths

### Backend data persistence

- `server.py` — pure Python `BaseHTTPRequestHandler`, no frameworks
- All app data stored as JSON files under `/data/<key>.json` (Docker volume, persistent)
- External API proxy routes: Brewfather, WooCommerce, Claude AI, HA Supervisor

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18.3.1 + TypeScript 5.6.3 |
| Build tool | Vite 5.4.10 with `vite-plugin-singlefile` |
| Styling | Tailwind CSS 3.4.14 |
| Excel | SheetJS (xlsx 0.20.3) |
| PDF | pdfjs-dist 3.11.174 (client-side only) |
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

### No automated tests

There is no test suite (no Jest, Vitest, or Python unittest). Verify changes manually by running the dev server and exercising the relevant feature.

---

## Git Conventions

- **Primary branch:** `main`
- **AI feature branches:** `claude/<feature-name>-<id>` (e.g., `claude/add-claude-documentation-C27Lq`)
- **Release branches:** `1.7.X`, etc.
- Commit messages are descriptive, often in Dutch (matching UI language)
- Version is tracked in `config.yaml` (`version:`) and referenced in `README.md` and `CHANGELOG.md`

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

- Pages are large single-file components (`~1,000–1,750 lines`) with inline state
- Shared UI primitives live in `src/components/ui/` — use these, don't create inline one-offs
- Theming via CSS variables: `--t-accent`, `--t-light`, `--t-dark`, `--t-text`, `--t-bg`
- No global state manager — use `useStore(key)` for server-synced data, `useState` for local UI state

### TypeScript

- Strict mode is **off** in `tsconfig.json` — loose typing is acceptable
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
| Sectie-header van een lijst/kaart | `t-hdr text-white font-medium text-sm px-4 py-2.5` |
| Klikbare sectie-header | Voeg altijd toe: `flex items-center justify-between cursor-pointer` + `<span className="text-xs opacity-75">→</span>` als laatste child |
| Accent-kleur inline tekst/link | `style={{color: 'var(--t-accent)'}}` — nooit `text-amber-*` hardcoden |
| Sectie-label binnen een card | `text-xs font-semibold text-gray-500 uppercase tracking-wide` |
| Fallback tekst (onbekende naam) | Altijd via i18n: `t('lbl_onbekend')` of `t('lbl_naamloos')` |

**Regels:**
- Gebruik **uitsluitend** de bestaande `t-hdr` class uit `src/index.css` voor sectie-headers — geen nieuwe varianten aanmaken
- Alle klikbare headers krijgen een `→` pijl zodat de gebruiker weet dat navigatie mogelijk is
- Gebruik `style={{color: 'var(--t-accent)'}}` voor themagevoelige kleuren — dit werkt correct bij alle 6 thema's

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

### Data keys (stored in `/data/<key>.json`)

Key names are alphanumeric + underscore only (enforced by server). Common keys:
- `batches`, `ingredienten`, `lots`, `recepten`, `afvullingen`
- `biervoorraden`, `bestellingen`, `inkoopfacturen`
- `accijns_aangiften`, `hygieneLog`, `instellingen`

---

## Backend (server.py) Reference

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data/<key>` | Load JSON data file |
| POST | `/api/data/<key>` | Save JSON data file |
| GET | `/api/ping` | Health check |
| POST | `/api/brewfather/*` | Proxy to Brewfather API |
| POST | `/api/woocommerce/*` | Proxy to WooCommerce API |
| POST | `/api/claude` | Proxy to Anthropic Claude API |
| POST | `/api/upload` | File upload (PDF/image, max 20 MB) |
| GET | `/*` | Serve `index.html` (SPA fallback) |

### Security constraints (do not remove)

- Rate limiting: 120 requests/minute per IP
- Request body size: 10 MB general, 20 MB for Claude proxy
- File upload: only `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp` allowed
- Key validation: `^[a-zA-Z0-9_]+$` — prevents path traversal
- CSP headers: strict `default-src 'none'` policy
- CORS: localhost/127.0.0.1/[::1] only

---

## External Integrations

### Brewfather API

- REST API, authenticated via Basic auth (user ID + API key)
- Used for: recipe list, batch list, batch status sync
- Credentials stored in `instellingen` data key (`bfUserId`, `bfApiKey`)
- Auto-sync interval: configurable (default 10 minutes) via App.tsx

### WooCommerce API

- REST API v3, Basic auth (consumer key + secret)
- Used for: order fetch, product lookup by SKU
- Credentials in `instellingen` (`wcUrl`, `wcKey`, `wcSecret`)

### Claude AI (Anthropic)

- Used for: purchase invoice scanning (PDF → structured data)
- Client does PDFjs text extraction first; only calls Claude if needed
- API key stored in `instellingen` (`claudeKey`)
- Server proxies the request, adding the API key server-side
- Response expected as JSON: `{ supplier, date, invoice_number, lines: [{description, quantity, unit_price, vat_rate, total}] }`

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

- **No test suite** — be careful with refactors; test manually
- **Single-file build** — all JS/CSS is inlined; keep bundle size reasonable
- **Python stdlib only** — `server.py` must not import third-party packages
- **Dutch UI language** — all user-visible strings must go through i18n
- **HA Ingress compatibility** — paths must work with and without `/brouwerij_admin/` prefix
- **Non-root Docker** — code runs as `appuser`; avoid hardcoded `/root/` paths
- **Data files in `/data/`** — never write outside this directory from server.py
- **Strict mode off** — TypeScript strict checks are disabled; don't rely on them catching errors
