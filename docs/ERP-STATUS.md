# ERP-verbeterplan — voortgangsstatus

> **Voor AI-assistenten / nieuwe chatsessies:** dit document is de bron van
> waarheid voor de voortgang van het ERP-verbeterplan
> (zie `docs/ERP-VERBETERPLAN.md` voor de volledige bevindingen en het plan).
> Werkwijze: pak het **eerstvolgende onafgevinkte punt** op, implementeer het,
> vink het hier af (met datum + versienummer), bump de versie in `config.yaml`
> (+0.0.1, zie CLAUDE.md), werk `CHANGELOG.md` bij, en commit alles samen.
> Branch-conventie: `claude/erp-fase-<n>-<beschrijving>` vanaf `main`
> (of werk verder op de branch die de gebruiker aanwijst).

**Laatst bijgewerkt:** 2026-07-15 · versie 1.10.85 · **fase 0 volledig afgerond**

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

- [ ] **1.1 Batch-commit-endpoint** — `POST /api/commit` schrijft meerdere
      keys atomair; picken/afronden/kassa als één commit
- [ ] **1.2 UUID's voor nieuwe records** — `crypto.randomUUID()` i.p.v.
      `max(id)+1`; bestaande integer-id's blijven geldig
- [ ] **1.3 Referentiële-integriteitscheck** — `checkIntegriteit()` +
      Gezondheid-tab + guards bij verwijderen
- [ ] **1.4 Server-side schemavalidatie (licht)** — per key minimaal contract,
      422 bij afwijzing
- [ ] **1.5 Append-only audit server-side** — server logt elke data-POST
      buiten de data-API om

## Fase 2 — Financieel professionaliseren

- [ ] **2.1 Licht journaalmodel** — onveranderlijke journaalregels bij
      definitief maken; rapporten lezen uit journaal
- [ ] **2.2 Bedragen in centen** in journaal + factuurtotalen; BTW-afronding
      op grondslag per tarief
- [ ] **2.3 Balans compleet** — crediteuren, liquide middelen uit MT940-saldi,
      jaarafsluiting met beginbalans-overdracht
- [ ] **2.4 Bankreconciliatie versterken** — match op bedrag + tegenrekening +
      kenmerk; saldo-aansluitcontrole per import
- [ ] **2.5 Debiteuren/crediteuren-ouderdom** in buckets (0-30/31-60/61-90/90+)
- [ ] **2.6 COGS-optie** — kostprijs per batch gekoppeld aan uitleveringen,
      marge-weergave in W&V

## Fase 3 — Kwaliteit & proces

- [ ] **3.1 Vitest + testsuite** op pure logica (accijns, BTW-rollover,
      voorraad, MT940, PSP, Excel round-trip)
- [ ] **3.2 pytest voor server.py** — key-validatie, rate-limit, atomic write,
      upload, 409/422-paden
- [ ] **3.3 GitHub Actions CI** — tsc --noEmit, build, tests, Docker-build,
      versie-bump-check
- [ ] **3.4 TypeScript aanscherpen** — incrementeel, eerst utils/ en types/,
      page-props typeren
- [ ] **3.5 Pagina's opsplitsen** — boy-scout-regel bij onderhoud
- [ ] **3.6 Gestructureerde serverlogging + /api/health**

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
