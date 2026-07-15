# ERP-verbeterplan — voortgangsstatus

> **Voor AI-assistenten / nieuwe chatsessies:** dit document is de bron van
> waarheid voor de voortgang van het ERP-verbeterplan
> (zie `docs/ERP-VERBETERPLAN.md` voor de volledige bevindingen en het plan).
> Werkwijze: pak het **eerstvolgende onafgevinkte punt** op, implementeer het,
> vink het hier af (met datum + versienummer), bump de versie in `config.yaml`
> (+0.0.1, zie CLAUDE.md), werk `CHANGELOG.md` bij, en commit alles samen.
> Branch-conventie: `claude/erp-fase-<n>-<beschrijving>` vanaf `main`
> (of werk verder op de branch die de gebruiker aanwijst).

**Laatst bijgewerkt:** 2026-07-15 · versie 1.10.91 · **fase 0 én fase 1 volledig afgerond**

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
| 2026-07-15 | 1.10.86 | 1.1 | /api/commit (alles-of-niets, temp+rename in 2 fasen) + client-side auto-batching per event-tick; getest: 409 laat niets achter, 404-fallback |
| 2026-07-15 | 1.10.87 | 1.2 | newId: tijdgebaseerd + monotoon + boven bestaand max; getest: 5000 snelle uitgiftes uniek/monotoon/safe-integer |
| 2026-07-15 | 1.10.88 | 1.3 | checkIntegriteit (20 relaties) + Gezondheid-kaart + batch-delete-guard; unit-getest (3 ingebouwde fouten gevonden, string/number-match) |
| 2026-07-15 | 1.10.89 | 1.4 | Containertype-validatie (85 keys) op data-POST en commit; 422 met verwachte vorm; client: reject → herladen + melding, geen retry-loop |
| 2026-07-15 | 1.10.90 | 1.5 | Append-only server-audit (JSONL per maand, versie-van/naar, commit-id, ingress-user); getest incl. backup-opname en data-API-onbereikbaarheid — **fase 1 compleet** |
| 2026-07-15 | 1.10.91 | 0.5-fix | Permission denied op /backup/brewadmin verholpen: entrypoint.sh maakt de submap als root aan en chowned naar appuser |
