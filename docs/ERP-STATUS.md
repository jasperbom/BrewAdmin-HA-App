# ERP-verbeterplan — voortgangsstatus

> **Voor AI-assistenten / nieuwe chatsessies:** dit document is de bron van
> waarheid voor de voortgang van het ERP-verbeterplan
> (zie `docs/ERP-VERBETERPLAN.md` voor de volledige bevindingen en het plan).
> Werkwijze: pak het **eerstvolgende onafgevinkte punt** op, implementeer het,
> verifieer (nieuwe pure logica krijgt een test; draai `npm test` én
> `python3 -m pytest`, en `npx tsc --noEmit` moet schoon blijven — CI (3.3)
> controleert dit ook), vink het punt hier af (met datum + versienummer +
> logboekregel), bump de versie in `config.yaml` (+0.0.1, zie CLAUDE.md),
> werk `CHANGELOG.md` bij, en commit alles samen.
> Branch-conventie: `claude/erp-fase-<n>-<beschrijving>` vanaf `main`
> (of werk verder op de branch die de gebruiker aanwijst).

**Laatst bijgewerkt:** 2026-07-16 · versie 1.11.5 · **fase 0 t/m 3 volledig afgerond** — alleen fase 4 (structurele fundering, pas bij multi-user/schaal) staat nog open

---

## Fase 0 — Stop het bloeden

- [x] **0.1 Optimistic locking per data-key** — versie-hash bij GET,
      409 Conflict bij POST-mismatch, client refresht + meldt conflict
      *(v1.10.79, 2026-07-15)*
- [x] **0.2 Server-side factuurnummer-endpoint** — `POST /api/nextnr`,
      atomair onder lock, aparte reeksen factuur/creditnota; KassaPage,
      BestellingenPage en StatiegeldPage omgezet *(v1.10.80, 2026-07-15)*
- [x] **0.3 Facturen bevriezen** — `definitief`-vlag op uitgereikte
      verkoopfacturen; geen edit/delete meer, correctie via creditnota
      *(v1.10.81, 2026-07-15 — n.b. verkoopfacturen hadden al geen edit/delete-UI;
      vlag gezet op alle 5 aanmaakplekken t.b.v. fase 2-journaal)*
- [x] **0.4 Harde periode-lock** — mutaties van facturen/accijnsrecords in een
      ingediende BTW-/accijnsperiode geblokkeerd *(v1.10.81, 2026-07-15:
      guards in deleteFactuur/updateFactuur/updateRegelBtw/deleteVerplaats)*
- [x] **0.5 Backup off-volume + uploads** — uploads-map in dagelijkse backup,
      ZIP naar HA `/backup`-map, retentie ook daar *(v1.10.82, 2026-07-15;
      config.yaml kreeg `backup:rw`-mapping)*
- [x] **0.6 Secrets afschermen** — GET op secure keys gemaskeerd
      (`__SECRET__`-sentinel), POST merget sentinel terug; chmod 0600;
      test-endpoints (BF/WC/SMTP) accepteren de sentinel ook
      *(v1.10.83, 2026-07-15)*
- [x] **0.7 Voorraad-lekken dichten** — `saveLot` via `voorraad_log`;
      bier-telverschillen inventarisatie teruggeboekt (afboeking
      vermis/overig); tankvolume-guard bij afvullen in Batches én Batchflow
      *(v1.10.84, 2026-07-15)*
- [x] **0.8 Excel-backup hardening** — generieke cel-chunking >30k tekens
      (`veld~n`-kolommen), import-diagnostiek met foutdetails
      *(v1.10.85, 2026-07-15; round-trip getest met 177KB-record)*

## Fase 1 — Transactionele integriteit

- [x] **1.1 Batch-commit-endpoint** — `POST /api/commit` schrijft meerdere
      keys atomair; saves uit dezelfde event-tick worden client-side
      automatisch gebundeld (picken/afronden/kassa = één commit)
      *(v1.10.86, 2026-07-15)*
- [x] **1.2 Botsingsvrije id's voor nieuwe records** — tijdgebaseerde monotone
      numerieke id's i.p.v. `max(id)+1`; geen hergebruik na verwijderen, geen
      concurrency-duplicaten. *(v1.10.87, 2026-07-15 — bewuste afwijking van
      "UUID-strings": numeriek gehouden zodat bestaande Number()-vergelijkingen
      en sorteringen blijven werken; zelfde doel bereikt)*
- [x] **1.3 Referentiële-integriteitscheck** — `checkIntegriteit()`
      (utils/integriteit.ts, 20 relaties) + Gezondheid-kaart in
      Instellingen→App + delete-guard op batches met fiscale records
      *(v1.10.88, 2026-07-15)*
- [x] **1.4 Server-side schemavalidatie (licht)** — containertype per bekende
      key (85 keys) op /api/data én /api/commit, 422 bij afwijzing; client
      herlaadt + meldt i.p.v. eindeloos retryen *(v1.10.89, 2026-07-15)*
- [x] **1.5 Append-only audit server-side** — elke data-POST/commit/nextnr
      naar maandelijkse JSONL in /data/server_audit/ (ip, gebruiker,
      versie-van/naar, commit-id); in backup, 7-jaars retentie, niet via
      data-API bereikbaar *(v1.10.90, 2026-07-15 — fase 1 compleet)*

## Fase 2 — Financieel professionaliseren

- [x] **2.1 Licht journaalmodel** — onveranderlijke journaalregels bij
      definitief maken; rapporten lezen uit journaal *(v1.10.94, 2026-07-16 —
      `journaal`-key server-side append-only afgedwongen (422); boekingen bij
      alle 5 verkoopfactuur-plekken, inkoopfactuur-CRUD (wijzig/verwijder =
      storno), accijns-/BTW-aangifte indienen; W&V leest uit journaal met
      accijns bewust uit de al per maand bevroren accijnsrecords; nieuw
      Journaal-rapport; eenmalige opbouw uit bestaande data; bedragen alvast
      in centen — voorschot op 2.2)*
- [x] **2.2 Bedragen in centen** in journaal + factuurtotalen; BTW-afronding
      op grondslag per tarief *(v1.10.95, 2026-07-16 — journaal was al in
      centen (2.1); factuurtotalen nu cent-exact berekend en als canonieke
      `*_cent`-velden opgeslagen naast de euro-velden (compatibiliteit);
      rubriek 1a/1b en het te-betalen-bedrag op grondslag per tarief via
      `omzetBtwOpGrondslag`; voorbelasting blijft som van gefactureerde BTW)*
- [x] **2.3 Balans compleet** — crediteuren, liquide middelen uit MT940-saldi,
      jaarafsluiting met beginbalans-overdracht *(v1.10.96, 2026-07-16 —
      crediteuren uit open inkoopfacturen; `bank_saldi`-store gevuld bij
      MT940-import (eindsaldo per IBAN, ouder afschrift overschrijft nooit);
      `jaarafsluitingen`-store + afsluitknop op de balans; EV-verloopkaart
      begin + resultaat (journaal) = berekend EV met aansluitverschil)*
- [x] **2.4 Bankreconciliatie versterken** — match op bedrag + tegenrekening +
      kenmerk; saldo-aansluitcontrole per import *(v1.10.97, 2026-07-16 —
      `scoreMatch`/`besteMatch` in utils/bank.ts: bedrag als toegangseis,
      factuurnummer-kenmerk +2, tegenpartijnaam +1, gelijkspel → ambigu en
      niet auto-koppelen; controlebalk op Bank-tab: afschrift intern,
      aansluiting op vorig eindsaldo (bank_saldi, 2.3) en gekoppeld/open —
      live bij (ont)koppelen. N.b. facturen dragen geen tegenrekening-IBAN,
      dus "tegenrekening" is ingevuld als tegenpartijnaam-match)*
- [x] **2.5 Debiteuren/crediteuren-ouderdom** in buckets (0-30/31-60/61-90/90+)
      *(v1.10.98, 2026-07-16 — rapport-subtab "Ouderdom" met per-relatie-
      buckets op dagen sinds factuurdatum, totalen sluiten aan op de
      balansposten, CSV-export; pure `ouderdomsAnalyse` in calculations.ts)*
- [x] **2.6 COGS-optie** — kostprijs per batch gekoppeld aan uitleveringen,
      marge-weergave in W&V *(v1.10.99, 2026-07-16 — `berekenBatchKostprijs`
      (refactor uit productkostprijs, zelfde uitkomst) + `berekenCogs`:
      uitgeleverde liters × batchkostprijs/liter; W&V-tab toont marge-blok
      met brutomarge en %, interne uitleveringen uitgesloten, liters zonder
      kostprijs apart gemeld — **fase 2 compleet**)*

## Fase 3 — Kwaliteit & proces

- [x] **3.1 Vitest + testsuite** op pure logica (accijns, BTW-rollover,
      voorraad, MT940, PSP, Excel round-trip) *(v1.11.0, 2026-07-16 —
      67 tests in src/utils/__tests__/ over alle plan-onderwerpen plus de
      fase 2-logica (centen, journaal/storno, grondslag-BTW, match-score,
      ouderdom, COGS); parseMT940/zoekPspCombinatie naar utils/bank.ts en
      excel.ts gesplitst in pure bouw/parse-functies (round-trip-testbaar),
      zonder gedragswijziging)*
- [x] **3.2 pytest voor server.py** — key-validatie, rate-limit, atomic write,
      upload, 409/422-paden *(v1.11.1, 2026-07-16 — 31 tests in
      tests/test_server.py: pure helpers + integratie tegen de echte handler
      op een efemere poort (tijdelijke DATA_DIR); incl. atomaire commit,
      nextnr onder 20 parallelle clients, 413, sentinel-merge en
      server-audit. Bijvangst: /api/ping bleek geen echte route te zijn
      (SPA-fallback) — gedocumenteerd, echte health-check volgt in 3.6)*
- [x] **3.3 GitHub Actions CI** — tsc --noEmit, build, tests, Docker-build,
      versie-bump-check *(v1.11.2, 2026-07-16 — .github/workflows/ci.yml met
      4 jobs: typecheck+vitest+build (de 3 resterende tsc-fouten daarvoor
      gefixt), pytest, Docker-build, en versie-bump-lint (config.yaml ↔
      CHANGELOG-sectie + bump t.o.v. basisbranch op PR's). Alle stappen
      behalve de Docker-build lokaal gevalideerd — geen daemon in de
      dev-container; eerste CI-run bevestigt die job)*
- [x] **3.4 TypeScript aanscherpen** — incrementeel, eerst utils/ en types/,
      page-props typeren *(v1.11.3, 2026-07-16 — strict-ratchet
      tsconfig.strict.json: utils/types/i18n onder volledige `strict: true`
      (verder dan het geplande noImplicitAny — bleek al schoon), bewaakt via
      `npm run typecheck` + CI, include mag alleen groeien; eerste
      page-props getypt (AccijnsPageProps) en AccijnsRecord aangevuld met
      de runtime-velden; boy-scout-regel voor overige pagina's vastgelegd
      in CLAUDE.md — verdere page-props lopen mee met 3.5-onderhoud)*
- [x] **3.5 Pagina's opsplitsen** — boy-scout-regel bij onderhoud
      *(v1.11.4, 2026-07-16 — regel verankerd in CLAUDE.md en gedemonstreerd:
      ZIP-schrijver → utils/zip.ts en het gedupliceerde getPeriodes
      (Boekhouding + Statiegeld) → utils/btw.ts, beide met tests en onder de
      strict-ratchet; eerdere extracties uit fase 2/3 (journaal, centen,
      bank/MT940, excel-bouw/parse) horen bij hetzelfde patroon. Blijft
      doorlopend van kracht bij elk onderhoud)*
- [x] **3.6 Gestructureerde serverlogging + /api/health** *(v1.11.5,
      2026-07-16 — stdlib logging met JSON-regels (ts/level/msg/bron +
      contextvelden; 26 prints omgezet, HTTP-log via dezelfde formatter);
      GET /api/health met threads-status, laatste-backupdatum, data-dir en
      uptime; dashboard toont een healthregel (oranje bij probleem of
      backup >2 dagen oud); 4 pytest-tests + runtime-smoke (threads 4/4,
      JSON-log geverifieerd) — **fase 3 compleet**)*

## Fase 4 — Structurele fundering (pas bij multi-user/schaal)

- [ ] **4.1 SQLite als opslaglaag** (stdlib) achter de bestaande API
- [ ] **4.2 Gebruikers & rollen** via HA-ingress-gebruiker
- [ ] **4.3 Delta-sync** i.p.v. hele arrays

---

## Logboek

| Datum | Versie | Punt | Opmerking |
|-------|--------|------|-----------|
| 2026-07-15 | 1.10.77 | — | Review + plan aangemaakt |
| 2026-07-15 | 1.10.78 | — | Statusdocument (dit bestand) aangemaakt |
| 2026-07-15 | 1.10.79 | 0.1 | Optimistic locking: X-Data-Version + 409-conflictafhandeling; getest met curl (409-flow, data blijft intact) |
| 2026-07-15 | 1.10.80 | 0.2 | /api/nextnr: atomaire nummerreeksen (F/CN), seed uit legacy teller + hoogste bestaande factuur; 20 parallelle calls → 0 dubbelen |
| 2026-07-15 | 1.10.81 | 0.3+0.4 | definitief-vlag op verkoopfacturen; periode-lock op inkoopfactuur-edit/-delete, BTW-correctie orderregel en AGP-verplaatsing-delete |
| 2026-07-15 | 1.10.82 | 0.5 | Backup incl. upload-bijlagen + off-volume ZIP naar /backup/brewadmin (getest: lokaal, offsite en download-ZIP bevatten bijlagen) |
| 2026-07-15 | 1.10.83 | 0.6 | Secrets gemaskeerd via GET, sentinel-merge bij POST, chmod 0600; round-trip getest met curl (geheim blijft op disk, URL-wijziging werkt) |
| 2026-07-15 | 1.10.84 | 0.7 | saveLot → voorraad_log; inventarisatie-bierverschillen → afboekingen (vermis/overig); tankvolume-guard bij afvullen (2 pagina's) |
| 2026-07-15 | 1.10.85 | 0.8 | Excel-cel-chunking (veld~n) + import-diagnostiek; round-trip getest met 177KB geneste JSON — **fase 0 compleet** |
| 2026-07-15 | 1.10.86 | 1.1 | /api/commit (alles-of-niets, temp+rename in 2 fasen) + client-side auto-batching per event-tick; getest: 409 laat niets achter, 404-fallback |
| 2026-07-15 | 1.10.87 | 1.2 | newId: tijdgebaseerd + monotoon + boven bestaand max; getest: 5000 snelle uitgiftes uniek/monotoon/safe-integer |
| 2026-07-15 | 1.10.88 | 1.3 | checkIntegriteit (20 relaties) + Gezondheid-kaart + batch-delete-guard; unit-getest (3 ingebouwde fouten gevonden, string/number-match) |
| 2026-07-15 | 1.10.89 | 1.4 | Containertype-validatie (85 keys) op data-POST en commit; 422 met verwachte vorm; client: reject → herladen + melding, geen retry-loop |
| 2026-07-15 | 1.10.90 | 1.5 | Append-only server-audit (JSONL per maand, versie-van/naar, commit-id, ingress-user); getest incl. backup-opname en data-API-onbereikbaarheid — **fase 1 compleet** |
| 2026-07-15 | 1.10.91 | 0.5-fix | Permission denied op /backup/brewadmin verholpen: entrypoint.sh maakt de submap als root aan en chowned naar appuser |
| 2026-07-16 | 1.10.94 | 2.1 | Journaal: append-only key + server-guard (curl-getest: weglaten/muteren → 422, aanvullen → 200), boekingen op alle definitief-momenten, storno-flow, W&V + Journaal-rapport uit journaal, eenmalige opbouw; bedragen in centen (voorschot 2.2). Versies 1.10.92/93 waren losse features buiten het plan |
| 2026-07-16 | 1.10.95 | 2.2 | Centen: `totaliseerRegels`/`totaliseerInkoop` (cent-exact, `*_cent`-velden op alle 12 factuur-aanmaakplekken) + `omzetBtwOpGrondslag` (rubriek 1a/1b en te-betalen op grondslag per tarief). Unit-getest via esbuild-bundle (drift-case 3×€1,03: €0,65 i.p.v. €0,66) en runtime in de aangiftetab |
| 2026-07-16 | 1.10.96 | 2.3 | Balans: crediteuren + liquide middelen (`bank_saldi` bij MT940-import) + `jaarafsluitingen` met EV-verloop/aansluitverschil; Playwright-getest (import fixture-afschrift → saldo op balans, afsluitknop → snapshot op disk) |
| 2026-07-16 | 1.10.97 | 2.4 | Bankmatch-score (kenmerk/naam, ambigu → handmatig) + saldo-aansluitcontrolebalk per import; 7 unit-checks (esbuild) + Playwright-fixture (kenmerk wint van gelijk bedrag, ambigu-badge, controlebalk) |
| 2026-07-16 | 1.10.98 | 2.5 | Ouderdomsrapport debiteuren/crediteuren (buckets per relatie, aansluitend op balans, CSV); 7 unit-checks op `ouderdomsAnalyse` (grensgevallen 30/31, creditnota's, case-insensitive groepering) + Playwright |
| 2026-07-16 | 1.10.99 | 2.6 | COGS: `berekenBatchKostprijs` + `berekenCogs`, marge-blok in W&V; unit-checks (refactor-pariteit productkostprijs, periode/intern/onbekende-kostprijs-filters) + Playwright — **fase 2 compleet** |
| 2026-07-16 | 1.11.0 | 3.1 | Vitest: 67 tests (6 bestanden) op accijns/BTW-rollover/grondslag/centen/journaal/bank-MT940-PSP/voorraad/ouderdom/COGS/Excel-round-trip; refactors parseMT940+PSP → utils/bank.ts, excel.ts → pure bouw/parse, window-guard in api.ts; MT940-import na refactor met Playwright gesmoke-test |
| 2026-07-16 | 1.11.1 | 3.2 | pytest: 31 tests op server.py (helpers + live-handler-integratie: 409/422/413/429-paden, atomaire commit en nextnr-parallellisme, upload, secrets, audit); /api/ping-documentatie gecorrigeerd |
| 2026-07-16 | 1.11.2 | 3.3 | CI-workflow (typecheck/vitest/build, pytest, Docker-build, versie-bump-lint incl. PR-bumpcheck t.o.v. basisbranch); tsc nu volledig schoon (3 reduce-typefouten gefixt); checkscript lokaal positief én negatief getest |
| 2026-07-16 | 1.11.3 | 3.4 | Strict-ratchet op utils/types/i18n (`tsconfig.strict.json`, npm run typecheck, in CI; geverifieerd met opzettelijke-fout-probe), AccijnsPage-props getypt + AccijnsRecord-runtime-velden; CLAUDE.md-conventies en werkwijze-blok geactualiseerd |
| 2026-07-16 | 1.11.4 | 3.5 | Extracties: makeZip/crc32 → utils/zip.ts, gedeeld getPeriodes → utils/btw.ts (dupliaat uit 2 pagina's weg); +6 tests (73 totaal); boy-scout-regel in CLAUDE.md |
| 2026-07-16 | 1.11.5 | 3.6 | JSON-serverlogging (stdlib logging, bron-veld per subsysteem) + GET /api/health (threads/backup/uptime) + dashboard-healthregel; pytest 35 totaal; runtime-smoke: health 4/4 threads, JSON-logregels, dashboardregel zichtbaar — **fase 3 compleet** |
