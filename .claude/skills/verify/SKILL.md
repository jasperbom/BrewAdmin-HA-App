---
name: verify
description: Build, launch en aansturen van de BrewAdmin-app voor runtime-verificatie van wijzigingen (frontend + server.py) in een headless omgeving.
---

# BrewAdmin runtime-verificatie

## Build & launch

```bash
npm run build                          # dist/index.html (single-file)
mkdir -p /app/static && cp dist/index.html /app/static/index.html
mkdir -p /data                         # server schrijft alle JSON hier
python3 server.py &                    # poort 8099
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8099/
```

**Gotcha:** `server.py` serveert de SPA uitsluitend vanaf het harde pad
`/app/static/index.html` (niet `dist/`). Zonder die kopie geeft élke GET 500.

## Testdata seeden

POST rechtstreeks naar de data-API (één key per request, container-type moet
kloppen met `_KEY_TYPES` in server.py):

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '[{"id":1,"naam":"Blond 6.5","status":"actief"}]' \
  http://127.0.0.1:8099/api/data/producten
```

Relevante sleutels: `producten`, `product_artikelen`, `batches`,
`afvullingen`, `uitleveringen`, `afboekingen`, `bestelling_picks`,
`voorraad_log`, `audit_log`. Afvulling-aantallen staan in `hoeveelheid`
(niet `aantal`).

## Aansturen met Playwright

Playwright is globaal geïnstalleerd; Chromium staat op `/opt/pw-browsers/chromium`:

```bash
NODE_PATH=$(npm root -g) node script.mjs
# in script: chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
```

**Gotcha — rate limiter:** de server staat 600 requests/minuut per IP toe.
Een app-boot kost sinds `/api/bulk` nog maar ±3 requests (was ±60 losse
GETs) — behalve de állereerste boot tegen een lege DATA_DIR: die seedt
~100 keys via losse POSTs. Herhaalde browser-runs binnen een minuut zijn
dus prima; alleen vlak na een eerste-boot-seed kort wachten.

**Taal:** zonder `localStorage.lang` rendert de app in het **Engels** —
selectors dus op Engelse labels ("Products", "Confirm rebrand") of zet
vooraf `localStorage.setItem('lang','nl')` via `page.addInitScript`.

## Persistentie controleren

Saves gaan gebundeld via `POST /api/commit` (per event-tick). Controleer het
resultaat op schijf, niet via de page (page-fetches kunnen 429'en):

```bash
python3 -c "import json; print(json.load(open('/data/afvullingen.json')))"
```

Luister in Playwright naar `page.on('response')` op `/api/commit` om te zien
of de save met 200 is geland.
