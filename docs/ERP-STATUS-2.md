# ERP-verbeterplan ronde 2 — voortgangsstatus

> **Voor AI-assistenten / nieuwe chatsessies:** dit document is de bron van
> waarheid voor de voortgang van ronde 2 van het ERP-verbeterplan (zie
> `docs/ERP-VERBETERPLAN-2.md` voor de bevindingen en het plan; ronde 1 staat
> in `docs/ERP-VERBETERPLAN.md` + `docs/ERP-STATUS.md` en is afgerond).
> Werkwijze: pak het **eerstvolgende onafgevinkte punt** op, implementeer het,
> schrijf een test die het oude gat aantoont en nu slaagt, draai `npm test`,
> `npm run typecheck` én `python3 -m pytest`, vink het punt hier af (met datum +
> versienummer + logboekregel), bump de versie in `config.yaml` (+0.0.1, zie
> CLAUDE.md), werk `CHANGELOG.md` bij, en commit alles samen.
> Nieuwe pure logica hoort in `src/utils/` met test (strict-ratchet);
> i18n-sleutels in alle 5 talen; nooit append-only, secrets-maskering of rollen
> omzeilen. Punten met **[KEUZE]** vragen eerst een beslissing van de gebruiker;
> anders zelf beslissen en de aanname in het logboek noteren.
> Branch-conventie: `claude/erp2-fase-<n>-<beschrijving>` vanaf `main`
> (of werk verder op de branch die de gebruiker aanwijst).

**Laatst bijgewerkt:** 2026-09-02 · versie 1.12.24 · review vastgelegd, nog niets uitgevoerd

---

## Fase 5 — Dichten (beveiliging + halve transacties)

- [ ] **5.1 Sentinel-exfiltratie** — `/api/mail/test` en `/api/woocommerce/test`
      vullen `__SECRET__` alleen terug bij byte-gelijke host/port/username resp.
      storeUrl; anders 400. pytest: sentinel naar vreemde host → geen verbinding
- [ ] **5.2 Append-only dubbele id's** — `_append_only_ok` weigert payloads met
      dubbele id's, in POST én `/api/commit`. pytest
- [ ] **5.3 Leesautorisatie** — `_rol_mag_key_lezen` op `/api/data/<key>`,
      `/api/bulk` en `/api/file/<naam>`; client handelt 403 op GET af zonder
      retry-loop. pytest per rol
- [ ] **5.4 Endpoint-allow-list** — één tabel `{prefix: minimale rol}`, default
      `beheer`; mail/send, claude, woocommerce put/create, brewfather patch,
      homeassistant `_notify`/`_list` expliciet erin. pytest
- [ ] **5.5 Request-hardening** — Content-Length-validatie (400/413),
      `BrouwerijHandler.timeout = 30`, `RecursionError` → 400, exception-boundary
      om `do_GET`/`do_POST` (500 + logregel), mimeType-allow-list, subject zonder
      control characters. pytest
- [ ] **5.6 Proxy-paden** — `..`/`//` weigeren, redirects weigeren of
      `Authorization` strippen bij ander netloc, `resp.read()`-maximum op alle
      proxies. pytest
- [ ] **5.7 HA-service-payload** — uitgaande payload uit allow-list per service,
      nooit de hele body doorsturen. pytest
- [ ] **5.8 Backup-permissies** — 0600 op elke geëxporteerde JSON en de
      offsite-ZIP, 0700 op de dagmap; secure keys niet in de JSON-export. pytest
- [ ] **5.9 app_icoon** — `svg+xml` uit `_DATA_IMG_RE`, vaste Content-Type uit
      allow-list, CSP `default-src 'none'; sandbox` op die route. pytest
- [ ] **5.10 Sessie-/transporthygiëne** — absolute maximale sessieleeftijd, HSTS
      bij ssl, logout-cookie via `_sessie_cookie_header`, `_direct_auth` in
      `do_HEAD`, rate-limit-dicts onder een Lock met eviction. pytest
- [ ] **5.11 Commit-bundel nooit opbreken** — `_flushCommitBuffer`: bij conflict
      alle keys verversen, per key `voegSamen`, één nieuwe commit; bij
      reject/forbidden hele bundel vervalt + `herstelVanServer` + één melding die
      de bedrijfshandeling noemt. Vitest op 409/422/403 met bundel van 3 keys
- [ ] **5.12 "Oude batches" dichten** — **[KEUZE: read-only of uit de nav?]**
      `doAfvullen` via `magAfvullingRegistreren` + actieve sessie;
      `handleStatusChange` via dezelfde fasevalidatie als `gaNaarFase`;
      `isLegacyBatch` alleen voor afvullingen van vóór de invoering
- [ ] **5.13 Herpicken blokkeren** — pickknop weg bij `gepickt` zodra er
      uitleveringen/accijns bestaan; "pick corrigeren" storneert oude
      uitleveringen + accijnsrecords en pickt opnieuw in één commit

## Fase 6 — Juist rekenen (fiscaal)

- [ ] **6.1 Accijnsgrondslag** — `grondslag: 'abv' | 'plato' | 'custom'`
      (default `abv`), geen `Math.max`; `abv_vrijstelling_grens` (0,5 → 0);
      `klein_brouwer_pct` (default 100); `tariefVoorDatum` op `ingangsdatum`;
      migratie: bestaande `tarief_per_hl_plato` → grondslag `plato` zodat
      historische cijfers niet verschuiven; tests herschrijven
      (`calculations.test.ts:12`)
- [ ] **6.2 Balans op peildatum** — `src/utils/balans.ts` `berekenBalans(data,
      peildatum)`: debiteuren/crediteuren/bank/lots/gereed product/BTW-schuld/
      accijnsschuld per datum; EV als controle naast beginvermogen + resultaat;
      `sluitBoekjaarAf` per 31-12 van het gekozen jaar. Tests
- [ ] **6.3 Kassa via `totaliseerRegels`** — bon en lade uit dezelfde bron als de
      factuur. Test: 3 × €1,03 @21 % overal gelijk
- [ ] **6.4 PSP-kosten** — default vrijgesteld, keuze vrijgesteld/binnenlands/
      intracom_eu, `btw_soort` op de regel; `ontkoppelPsp` door
      `magFactuurMuteren`, in gesloten periode tegenboeking i.p.v. delete
- [ ] **6.5 Losse factuur nummering** — altijd `volgendFactuurNummer`
      (read-only veld), jaar uit factuurdatum; `nummer_gaten`-register met reden
- [ ] **6.6 Rubriek 3a/3b + ICP + OSS** — uit `btwCategorie`-afleiding per
      verkoopfactuur; ICP-opgaaf per BTW-nummer per periode; waarschuwing bij
      B2C naar ander EU-land. Tests
- [ ] **6.7 Statiegeld-BTW** — `statiegeld_btw_pct` op `Verpakking` (default 0
      bij `fust`, 21 bij `snd`) op alle drie de plekken. **[KEUZE: default snd]**
- [ ] **6.8 `voorraadPerLocatie` chronologisch en zonder clamp** — één
      eventlijst op (datum, created_at, id); tekort blijft zichtbaar;
      `valideerVerplaatsing`/`bouwUitslagRecords` weigeren bij tekort. Tests
- [ ] **6.9 Kostprijs ex accijns** — `kostprijs_ex_accijns` +
      `accijns_component`; voorraadwaardering ex accijns; één margedefinitie in
      de W&V. Pariteitstests

## Fase 7 — Sluitende werkflow

- [ ] **7.1 Serverhandhaving CCP/orderstaat** — 422 bij afvulling zonder
      `sessie_id` op niet-legacy batch, zonder vrijgegeven CCP1, uitlevering/
      accijns op geannuleerde order, sessie sluiten zonder eindcontrole; pure
      helpers gespiegeld uit `haccp.ts`/`afvulsessie.ts`. pytest per regel
- [ ] **7.2 Retourpad bier** — creditnota via reeks `creditnota` met per regel
      "retour in voorraad" (negatieve uitlevering + storno accijns) of "alleen
      crediteren"; `annuleerOrder` na picken verplicht via dit pad; kassa idem
- [ ] **7.3 Rolgating UI** — `useRol()` uit whoami; werkruimtes en destructieve
      knoppen per rol; zichtbare audit op `whoami.gebruiker`
- [ ] **7.4 Brewfather-sync** — profielen/OG/FG/liters alleen zetten als lokaal
      leeg of "BF leidend" per veld; `bf_verweesd`-banner; CLAUDE.md corrigeren
- [ ] **7.5 Excel-restore** — `undefined` voor ontbrekende sheet, preview-modal
      per key, versiestempel in Instellingen-sheet, append-only vooraf melden
- [ ] **7.6 Inkoop** — duplicaatcheck leverancier + factuurnummer (+ datum
      ± 1 dag); `leveranciers`-key; onthouden koppeling omschrijving → ingrediënt
- [ ] **7.7 Deelleveringen** — factuurregels uit de picks, backorder-regel +
      status `deels_geleverd`, deelpakbon; statiegeldretour boekt
      verpakkingen/onderdelen terug
- [ ] **7.8 Productie-guards** — tankbezetting bij Vergisten; reinigingscheck uit
      `haccp_schoonmaak_log`; THT-waarschuwing bij `haalVanVoorraad` en bij
      uitlevering; `lotcodeIsUniek` bij sessiestart; overlap in PlanningPage
- [ ] **7.9 4-ogen** — reviewer uit `gebruikers_rollen`, indiener ≠ reviewer
      server-side afgedwongen
- [ ] **7.10 Kostprijs bevriezen** — `kosten` + `prijs_snapshot` bij elk
      afboeken; `max(id)+1` → `newId()`; verpakkingsmateriaal via `voorraad_log`
      zonder clamp
- [ ] **7.11 Sync-robuustheid** — voorraadstanden als delta-records (of counter +
      log in één key); `_pendingSaves` persistent + replay vóór eerste GET;
      indicator "n wijzigingen nog niet opgeslagen"
- [ ] **7.12 Dashboardmeldingen** — backup > 2 dagen, batch zonder CCP1-vrijgave,
      lot verloopt < 14 dagen, factuur over termijn, order > 3 dagen op `nieuw`,
      in elke werkruimte

## Fase 8 — Grootboek **[KEUZE: alleen na expliciet akkoord]**

- [ ] **8.1 Rekening + debet/credit op `JournaalRegel`** — klein
      brouwerijschema; `voegBoekingToe` weigert ongebalanceerd; migratie van
      bestaande regels
- [ ] **8.2 Boekingsbouwers** — betaling (bank ↔ debiteur/crediteur), bankimport,
      kapitaal, accijns bij uitslag, voorraadmutatie/COGS bij uitlevering
- [ ] **8.3 Rapporten uit het journaal** — balans en W&V uitsluitend uit het
      journaal; proefbalans; CSV-export naar boekhoudpakket

---

## Logboek

| Datum | Versie | Punt | Opmerking |
|-------|--------|------|-----------|
| 2026-09-02 | 1.12.24 | — | Review ronde 2 + plan + statusdocument aangemaakt; CLAUDE.md-claim over Brewfather-interval gecorrigeerd |
