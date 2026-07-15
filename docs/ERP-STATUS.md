# ERP-verbeterplan — voortgangsstatus

> **Voor AI-assistenten / nieuwe chatsessies:** dit document is de bron van
> waarheid voor de voortgang van het ERP-verbeterplan
> (zie `docs/ERP-VERBETERPLAN.md` voor de volledige bevindingen en het plan).
> Werkwijze: pak het **eerstvolgende onafgevinkte punt** op, implementeer het,
> vink het hier af (met datum + versienummer), bump de versie in `config.yaml`
> (+0.0.1, zie CLAUDE.md), werk `CHANGELOG.md` bij, en commit alles samen.
> Branch-conventie: `claude/erp-fase-<n>-<beschrijving>` vanaf `main`
> (of werk verder op de branch die de gebruiker aanwijst).

**Laatst bijgewerkt:** 2026-07-15 · versie 1.10.78

---

## Fase 0 — Stop het bloeden

- [ ] **0.1 Optimistic locking per data-key** — versie-hash bij GET,
      409 Conflict bij POST-mismatch, client refresht + meldt conflict
- [ ] **0.2 Server-side factuurnummer-endpoint** — `POST /api/nextnr`,
      atomair onder lock, aparte reeksen factuur/creditnota; KassaPage,
      BestellingenPage en StatiegeldPage omgezet
- [ ] **0.3 Facturen bevriezen** — `definitief`-vlag op uitgereikte
      verkoopfacturen; geen edit/delete meer, correctie via creditnota
- [ ] **0.4 Harde periode-lock** — mutaties van facturen/accijnsrecords in een
      ingediende BTW-/accijnsperiode geblokkeerd
- [ ] **0.5 Backup off-volume + uploads** — uploads-map in dagelijkse backup,
      ZIP naar HA `/backup`-map, retentie ook daar
- [ ] **0.6 Secrets afschermen** — GET op secure keys gemaskeerd
      (`__SECRET__`-sentinel), POST merget sentinel terug; chmod 0600
- [ ] **0.7 Voorraad-lekken dichten** — `saveLot` via `voorraad_log`;
      bier-telverschillen inventarisatie teruggeboekt; tankvolume-guard bij
      afvullen
- [ ] **0.8 Excel-backup hardening** — generieke cel-chunking >30k tekens,
      import-diagnostiek i.p.v. stille catch

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
