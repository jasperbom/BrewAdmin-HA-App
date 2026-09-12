# ERP-review ronde 2 & verbeterplan — BrewAdmin HA App

*Review van versie 1.12.23 (september 2026) vanuit het perspectief van een
ERP-specialist met brouwerij-ervaring. Gebaseerd op code-analyse van
`server.py`, `src/utils/*`, `src/App.tsx` en alle pagina's, met verificatie van
elke bevinding in de bron. Vervolg op `docs/ERP-VERBETERPLAN.md` (ronde 1,
fasen 0–4, afgerond bij 1.11.9). Voortgang: `docs/ERP-STATUS-2.md`.*

---

## 1. Managementsamenvatting

Ronde 1 heeft de fundering gelegd: optimistic locking, atomaire commit, SQLite,
journaal in centen, rollen, delta-sync, conflict-samenvoeging en een
testsuite (906 Vitest-tests, pytest op de server). De pure laag —
`haccp.ts`, `afvulsessie.ts`, `trace.ts`, `journaal.ts`, `centen.ts`,
`btw.ts`, `bank.ts`, `ubl.ts` — is uitzonderlijk zorgvuldig, goed
becommentarieerd en getest.

Vrijwel elk probleem in deze ronde zit in de **naden**:

1. **Pagina's die de pure logica omzeilen.** De pagina "Oude batches" zet
   statussen vrij en vult af zonder afvulsessie; de kassa rekent BTW zelf;
   de losse verkoopfactuur nummert handmatig.
2. **De client die de atomaire commit weer opbreekt.** Bij een 409/422/403
   op één key worden de andere keys alsnog los weggeschreven, waardoor
   precies de halve transacties ontstaan die `/api/commit` moest voorkomen.
3. **Server die niet afdwingt wat de UI belooft.** Geen enkele GET heeft een
   rolcheck, de CCP-blokkades bestaan alleen in de UI, en twee test-endpoints
   sturen het echte wachtwoord naar een host uit de request.
4. **Drie rekenregels die fiscaal fout zijn.** De accijns neemt het maximum
   van drie grondslagen (sinds 2024 alleen hl × %vol), de jaarafsluiting
   bevriest de cijfers van vandaag onder vorig boekjaar, en PSP-kosten
   krijgen standaard 21 % voorbelasting.

### Top-12 op volgorde van urgentie

| # | Risico | Domein | Ernst |
|---|--------|--------|-------|
| 1 | Sentinel `__SECRET__` wordt ontmaskerd naar een client-gekozen host (SMTP-wachtwoord, WC-secret exfiltreerbaar) | Security | Kritiek |
| 2 | Commit-bundel wordt bij 409/422/403 opgebroken → uitslag zonder accijns, order zonder factuur | Data-integriteit | Kritiek |
| 3 | "Oude batches" omzeilt CCP 1/2/3 en maakt een batch permanent `legacy` | HACCP | Kritiek |
| 4 | Accijnsgrondslag `Math.max(abv, vloer, plato)`; vrijgesteld bier belast | Fiscaal | Kritiek |
| 5 | Jaarafsluiting slaat de stand van vandaag op als 31-12 vorig jaar; EV is sluitpost; gereed product niet op de balans | Fiscaal | Kritiek |
| 6 | Herpicken dupliceert uitslag + accijns; annuleren na picken draait niets terug; geen retour/creditnota voor bier | Fiscaal/voorraad | Hoog |
| 7 | Geen rolcheck op enige GET; `productie` leest facturen, bank, journaal, bijlagen | Security | Hoog |
| 8 | Append-only-guard passeert bij dubbele id's (vervalste journaalregel vóór het origineel) | Fiscaal bewijs | Hoog |
| 9 | Geen serverhandhaving op afvullingen/uitleveringen/orderstaat | HACCP | Hoog |
| 10 | Journaal is geen dubbel boekhouden: geen rekening, geen debet/credit, betalingen/voorraad/COGS ontbreken | Financieel | Hoog |
| 11 | Brewfather-sync overschrijft vergistings-/maischprofiel bij elke pageload | Productie | Middel |
| 12 | Excel-restore leegt keys die niet in het bestand staan | Continuïteit | Middel |

---

## 2. Wat al goed is (behouden)

- CSRF/CORS/CSP-basis: `SameSite=Strict`, exacte origin-set, `default-src 'none'`.
- Versiecheck + write in alle drie schrijfpaden binnen dezelfde lock en
  transactie — geen TOCTOU.
- Sessie-restore na herstart, lockout-guard op rollen, `X-Remote-User`
  genegeerd op de directe poort.
- SMTP-headerinjectie onmogelijk (`EmailMessage` weigert CRLF).
- Achtergrondthreads vangen exceptions af en loggen; geen deadlock tussen
  `_lees_tank_setpoints` en de bewakingstick.
- HACCP-keten CCP1 → sessie → CCP2 → CCP3 is inhoudelijk compleet en getest;
  storno consequent toegepast; aanmaningen in drie niveaus; UBL/PEPPOL incl.
  creditnota; FEFO op bier; `checkIntegriteit`; conflict-samenvoeging per record.

---

## 3. Bevindingen per domein

### 3.1 Security (`server.py`)

| # | Bevinding | Locatie |
|---|---|---|
| S1 | `/api/mail/test` en `/api/woocommerce/test` roepen `_unmask_secrets` aan en verbinden daarna met `host`/`storeUrl` **uit de request**. Elke ingelogde gebruiker kan het SMTP-wachtwoord en het WC-secret naar een eigen server laten sturen. `_bf_test`/`_mollie_test` zijn veilig (vaste upstream). | `server.py:4576-4616`, `:3987-4019` |
| S2 | `_append_only_ok` bouwt `{id: record}` en houdt bij dubbele id's de **laatste**. `[{id:1, vervalst}, {id:1, origineel}]` passeert; beide worden opgeslagen. Delta-pad is wel dicht (`:4859-4872`), POST en commit niet. | `server.py:1226-1243` |
| S3 | `do_GET` kent alleen een rolcheck op backups en `download_bijlagen`. `/api/bulk`, `/api/data/<key>` en `/api/file/<naam>` zijn voor elke rol leesbaar, inclusief `_FINANCIELE_KEYS`. `_mask_secrets` maskeert alleen `_SECURE_FIELDS`, dus host/user/storeUrl lekken naar `alleen_lezen`. | `server.py:3557-3677`, `:4023`, `:4342` |
| S4 | Endpoint-gates zijn een deny-list op substring. `/api/mail/send` (50 ontvangers, 15 MB bijlagen), `/api/claude/*`, `/api/woocommerce/put|create` en `/api/brewfather/patch` staan open voor `productie`. | `server.py:3695-3703` |
| S5 | `_read_body`: negatieve Content-Length → `rfile.read(-1)` blokkeert tot EOF; niet-numeriek → ongevangen `ValueError`; geen `timeout` op de handler; diep genest JSON → `RecursionError` (alle parse-sites vangen alleen `JSONDecodeError`); geen exception-boundary om `do_GET`/`do_POST`. `_build_email` met CRLF in subject of `maintype='multipart'` crasht de thread. | `server.py:3520-3525`, `:3313`, `:626`, `:670` |
| S6 | `_valid_wc_path`/`_valid_bf_path` staan `..` toe; urllib normaliseert niet; de standaard `HTTPRedirectHandler` speelt `Authorization` door naar een andere host. Geen `resp.read()`-maximum op enige proxy. | `server.py:343-350`, `:402`, `:3862`, `:418`, `:729`, `:4444` |
| S7 | `_ha_call_service` valideert `entity_id` maar stuurt de **hele** payload door; `target`/`area_id`/`device_id` omzeilen de check. | `server.py:4184-4228` |
| S8 | Dagelijkse backup exporteert de creds-keys **ongemaskeerd** naar `/data/backups/<datum>/*.json` met default permissies; offsite-ZIP in `/backup/` (HA-share) idem. Alleen de `.db` krijgt 0600. | `server.py:745-799` |
| S9 | `/api/app_icoon` serveert opgeslagen `image/svg+xml` met Content-Type uit de data, zonder CSP, en pre-auth op de directe poort → stored XSS in de app-origin. | `server.py:1822`, `:3420`, `:4292-4340` |
| S10 | Sessie glijdt oneindig (`verloopt` bij elk request vernieuwd, geen absolute leeftijd); geen HSTS; logout-cookie zonder `Secure`; `do_HEAD` slaat `_direct_auth` over; `_rate_buckets`/`_login_pogingen` onbegrensd en zonder lock. | `server.py:1338`, `:1542`, `:3504`, `:3529`, `:214-224` |
| S11 | Laag: `_valid_key` zonder lengtelimiet en zonder `_KEY_TYPES`-check (onbeperkt keys aanmaken); `_handle_bulk` parseert de hele database onder `_data_lock`; audit-log wordt ~160× gedupliceerd in de backupretentie; mislukte login logt de ingetypte gebruikersnaam; SPA-fallback geeft 200 HTML op onbekende `/api/*`. | `server.py:317`, `:4349`, `:778`, `:3473`, `:3666` |

**Testdekking:** de pytest-suite dekt key-validatie, upload, schema, append-only
(zonder dubbele id's), locking, rollen op POST, directe-poort-auth, sessies,
TLS, rate-limit en 413. Niet gedekt: sentinel-naar-vreemde-host, dubbele id's,
enige lees-autorisatie (de test asserteert juist dat `alleen_lezen` kán lezen),
mail/send-rolgating, Content-Length-randgevallen, diep JSON, `..` in proxy-paden,
redirects, `target` in HA-calls, backup-permissies, SVG-icoon, CORS, security-headers.

### 3.2 Financieel & fiscaal

| # | Bevinding | Locatie |
|---|---|---|
| F1 | **Accijns:** `accijnsCalc` retourneert `Math.max(hl·abv·r1, hl·r2, hl·plato·r3)`. Sinds 1-1-2024 kent NL uitsluitend hl × %vol; de vloer `r2 = 24,17` en de Plato-tak zijn de oude klassen. Gevolg: ≤ 0,5 %vol (vrijgesteld) wordt belast, session-bier overgedeclareerd. Geen vrijstellingsgrens, geen kleine-brouwerij-percentage. `tariefVoorDatum` matcht op **jaar**; `ingangsdatum` wordt genegeerd. Test `calculations.test.ts:12` legt het foute gedrag vast. | `src/utils/calculations.ts:181-221` |
| F2 | **Balans/jaarafsluiting:** geen enkele balanspost is datumgefilterd; `sluitBoekjaarAf` slaat de stand van vandaag op onder `jaar-1`. `eigenVermogen = activa − passiva` balanceert per constructie; BTW-schuld/-vordering ontbreekt op passiva; **gereed product (afgevuld bier) staat niet op de balans** — elke afvulling verlaagt het EV op papier. `berekenCogs` bestaat maar wordt hier niet gebruikt. | `src/pages/BoekhoudingPage.tsx:3394-3435` |
| F3 | **Journaal:** `JournaalRegel` heeft geen rekening, geen debet/credit; `voegBoekingToe` controleert niets. Nooit geboekt: betaling verkoop-/inkoopfactuur, MT940-transacties, voorraadmutaties, COGS, merch, kapitaalboekingen, statiegeldverplichting, accijns bij uitslag (pas bij de maandaangifte). | `src/types/index.ts:1911-1944`, `src/utils/journaal.ts:216`, `BoekhoudingPage.tsx:865, 1199, 1650, 1788` |
| F4 | **Kassa** rekent BTW zelf: de bon rondt één keer over de som, de factuur per regel. 3 × €1,03 @21 %: bon €0,65, factuur/journaal €0,66. `totaliseerRegels` wordt niet gebruikt. | `src/pages/KassaPage.tsx:587-591`, `:820-823` |
| F5 | **PSP-kosten** standaard 21 % voorbelasting; betaaldiensten zijn vrijgesteld (art. 11-1-j Wet OB). Systematische over-claim in rubriek 5b. `ontkoppelPsp` verwijdert de kostenfactuur zonder `magFactuurMuteren`. | `BoekhoudingPage.tsx:1462-1487`, `:1531-1536` |
| F6 | **Nummering:** losse verkoopfactuur met handmatig nummer i.p.v. `/api/nextnr`; `volgendFactuurNummer` stuurt altijd het huidige jaar (factuur van 31-12 ingevoerd op 2-1 krijgt het nieuwe jaar); nummer wordt vóór de save verbruikt — mislukte commit = onverklaarbaar gat. | `BoekhoudingPage.tsx:67, 576`, `src/utils/api.ts:819` |
| F7 | **Definitieve verkoopfactuur wordt in-place herschreven** bij `updateRegelBtw` (zelfde nummer, nieuwe totalen). Creditnota alleen voor statiegeld. | `src/pages/BestellingenPage.tsx:1367-1418` |
| F8 | **BTW-aangifte** kent geen rubriek 3a/3b, geen ICP-opgaaf, geen OSS-signalering, terwijl `btwCategorie.ts` EU-B2B (K) en export (G) al afleidt. | `BoekhoudingPage.tsx:299-333`, `:4276-4292` |
| F9 | **Statiegeld** altijd 0 % BTW voor `fust` én `snd`; geen instelling op `Verpakking`. | `KassaPage.tsx:830`, `BestellingenPage.tsx:1120`, `StatiegeldPage.tsx:153` |
| F10 | **Accijns in de kostprijs** ook onder schorsing (`voorcalc_accijns_totaal`), én apart in de W&V → twee margedefinities op hetzelfde scherm. | `src/utils/calculations.ts:565-567`, `src/utils/journaal.ts:272` |
| F11 | Kleiner: 4-ogen-reviewer hardcoded op een persoonsnaam en indiener = reviewer mogelijk; accijnsaangifte sommeert floats; `parseMT940` zet toekomstige datums in 19xx; `besteMatch` koppelt automatisch op alleen bedrag zonder datumgrens; deelbetalingen matchen nooit. | `AccijnsPage.tsx:20, 199`, `BoekhoudingPage.tsx:4197`, `src/utils/bank.ts:29, 296` |

### 3.3 Voorraad, productie & traceability

| # | Bevinding | Locatie |
|---|---|---|
| V1 | `voorraadPerLocatie` clampt op 0 en verwerkt niet chronologisch (alle verplaatsingen, dán alle uitleveringen, dán alle afboekingen). `valideerVerplaatsing` leest de geclampte stand → AGP-tekort onzichtbaar, `AccijnsRecord` voor de volledige hoeveelheid. | `src/utils/calculations.ts:1318-1370`, `src/utils/agp.ts:104, 145` |
| V2 | Ingrediëntverbruik bevriest de kostprijs niet (`kosten` alleen in de splitsingstak); een lot herprijzen verandert de kostprijs van oude batches. `max(id)+1` nog op drie plekken. | `src/pages/BatchFlowPage.tsx:893-928`, `BatchesPage.tsx:969`, `src/utils/merch.ts:210` |
| V3 | Verpakkingsmateriaal: onderdelen geclampt op 0, `verpakkingen.voorraad` niet; geen `voorraad_log`-regel; niet in `checkIntegriteit`. | `BatchFlowPage.tsx:1694-1700` |
| V4 | Geen FEFO-afdwinging, geen THT-check bij `haalVanVoorraad` (verlopen lot gaat stil de ketel in) noch bij uitlevering over THT. `lotcodeIsUniek` wordt nergens aangeroepen; `batch_nummer` is vrij invulbaar → dubbele lotcodes mogelijk. | `BatchFlowPage.tsx:761-766, 880`, `src/utils/afvulsessie.ts:42` |
| V5 | Merge verliest één van twee gelijktijdige voorraaddecrementen (absolute `stand`), terwijl beide logregels overleven. `_pendingSaves` is in-memory: reload = verlies zonder melding. | `src/utils/merge.ts:106`, `src/utils/api.ts:339-345` |
| V6 | Geen ingrediëntlocaties, geen reservering op geplande brouwsels, geen leveranciersstamkaart, geen inkooporder/ontvangststap; inkoopfactuur twee keer scannen = dubbele lots, factuur én voorbelasting. | `src/pages/IngredientenPage.tsx:395-475` |

### 3.4 Werkflow

| # | Bevinding | Locatie |
|---|---|---|
| W1 | **"Oude batches"** staat in de productie-nav met een vrije statusdropdown zonder validatie (Gepland → Gesloten in één klik) en een `doAfvullen` dat `magAfvullingRegistreren` niet kent: afvulling zonder `sessie_id`, lotcode, CCP2, CCP3. Eén zo'n afvulling maakt de batch `legacy` en vrij van álle blokkades. | `src/App.tsx:1548`, `src/pages/BatchesPage.tsx:753-772, 1221-1230, 1410`, `src/utils/haccp.ts:332` |
| W2 | **Geen serverhandhaving** op `afvullingen`, `uitleveringen`, `bestellingen`, `batches`: elk record wordt geaccepteerd. | `server.py:1135` |
| W3 | **Commit-bundel opgebroken** bij 409/422/403 (`_flushCommitBuffer`): niet-geraakte keys gaan alsnog los. Productie die pickt: uitleveringen en voorraad geboekt, accijns niet; afronden: order afgerond, geen factuur, geen journaal. | `src/utils/api.ts:457-474` |
| W4 | **Herpicken** bij status `gepickt` voegt nieuwe `uitleveringen` + `accijns` toe zonder de oude te verwijderen. **Annuleren** zet alleen de status; bier blijft uitgeslagen. Geen retourpad voor bier. | `BestellingenPage.tsx:806-920, 1263-1274, 1966` |
| W5 | **Nul client-side rolgating**: `whoami.rol` wordt alleen voor de HACCP-paraaf gebruikt. `alleen_lezen` ziet "Jaar afsluiten", "Reset app". Zichtbare audit valt terug op de accijnsverantwoordelijke als gebruiker. | `src/App.tsx:238-270, 1543-1567` |
| W6 | **Brewfather-sync** zet `vergistingsprofiel`/`maischprofiel`/OG/FG/`liter_vergist` onvoorwaardelijk bij elke mount (geen interval, anders dan CLAUDE.md zegt). Batch verwijderd in BF → stil verweesd. | `src/App.tsx:910-966` |
| W7 | **Excel-restore**: ontbrekende sheet → `[]` → `Array.isArray` → key leeggemaakt. Oude backup wist afvulsessies, CAPA, merch. Geen preview, geen versiestempel; append-only keys geven achteraf 422-alerts. | `src/utils/excel.ts:231`, `src/App.tsx:1381-1435` |
| W8 | Geen deelleveringen/backorders; factuurregels uit `bestelling.regels`, niet uit de picks. Statiegeldretour vult verpakkingsvoorraad niet aan; geen fust-identiteit. | `BestellingenPage.tsx:948-950, 1083-1099`, `StatiegeldPage.tsx:135` |
| W9 | Tankbezetting niet gecheckt bij overgang naar Vergisten; reiniging bij faseovergang is een wegklikbare confirm; sessiestart-reiniging is zelfrapportage zonder blik in `haccp_schoonmaak_log`; `PlanningPage` toont geen overlap. | `BatchFlowPage.tsx:1070-1076`, `src/utils/afvulsessie.ts:148-150` |
| W10 | Geen dashboardmelding voor: backup stilstaand (alleen Administratie), batch zonder CCP1-vrijgave, lot dat verloopt, factuur over termijn, order lang op `nieuw`. | `src/components/AdministratieDashboard.tsx:59` |

### 3.5 Bevestigd afwezig (grep)

Grootboek met rekeningcodes · debet/credit · betalingsboekingen · kostenplaatsen ·
inkooporders/levertijden · ingrediëntlocaties · ingrediëntreservering ·
rubriek 3a/3b/ICP/OSS · deelbetalingen · activaregister/afschrijving ·
urenregistratie · offertes · fust-/kegidentiteit · goedkeuringsstappen buiten
de twee aangiftes.

---

## 4. Verbeterplan ronde 2

Zelfde rode draad als ronde 1: **eerst dicht, dan juist, dan compleet.** Elke
stap krijgt een test die het oude gat aantoont.

### Fase 5 — Dichten (dagen)

5.1 Sentinel alleen terugvullen als host/port/username (resp. storeUrl)
    byte-gelijk zijn aan de opgeslagen creds; anders 400 (S1).
5.2 Dubbele id's weigeren op `_APPEND_ONLY`-keys in POST én commit (S2).
5.3 `_rol_mag_key_lezen` op `/api/data`, `/api/bulk`, `/api/file` (S3).
5.4 Endpoint-gates als allow-list `{prefix: minimale rol}`, default `beheer` (S4).
5.5 Request-hardening: Content-Length, handler-timeout, RecursionError,
    exception-boundary, mimeType-allow-list, subject zonder control chars (S5).
5.6 `..`/`//` weigeren in proxy-paden, redirects weigeren, read-maximum (S6).
5.7 HA-service-payload uit allow-list per service (S7).
5.8 Backup: 0600 op JSON-export en ZIP, 0700 op dagmap, secure keys niet in JSON (S8).
5.9 `app_icoon`: geen SVG, vaste Content-Type, CSP `sandbox` (S9).
5.10 Absolute sessieleeftijd, HSTS, logout-cookie, `do_HEAD`-auth, rate-limit-lock (S10).
5.11 Commit-bundel nooit opbreken: bij conflict alles verversen, per key
     samenvoegen, één nieuwe commit; bij reject/forbidden hele bundel vervalt (W3).
5.12 "Oude batches" read-only of uit de nav; `doAfvullen` via sessie;
     statuswissel via dezelfde fasevalidatie; `isLegacyBatch` niet meer
     te triggeren door een nieuwe sessieloze afvulling (W1).
5.13 Herpicken blokkeren zodra er uitslagrecords zijn; "pick corrigeren"
     storneert oude uitleveringen + accijns in één commit (W4).

### Fase 6 — Juist rekenen (1–2 weken)

6.1 Accijns: expliciete `grondslag`, vrijstellingsgrens 0,5 %vol,
    kleine-brouwerij-percentage, `ingangsdatum` in `tariefVoorDatum`,
    migratie voor bestaande Plato-instellingen, tests herschrijven (F1).
6.2 `src/utils/balans.ts`: `berekenBalans(data, peildatum)` met gereed
    product, BTW-schuld, EV als controle i.p.v. sluitpost; jaarafsluiting
    per 31-12 (F2).
6.3 Kassa via `totaliseerRegels` (F4).
6.4 PSP-kosten default vrijgesteld, `btw_soort`; `ontkoppelPsp` onder periodeslot (F5).
6.5 Losse factuur via `/api/nextnr` met factuurjaar; `nummer_gaten`-register (F6).
6.6 Rubriek 3a/3b, ICP-opgaaf, OSS-waarschuwing (F8).
6.7 `statiegeld_btw_pct` op `Verpakking` (F9).
6.8 `voorraadPerLocatie` chronologisch en zonder clamp; tekort blokkeert (V1).
6.9 Kostprijs ex accijns; één margedefinitie (F10).

### Fase 7 — Sluitende werkflow (2–3 weken)

7.1 Serverhandhaving: afvulling zonder sessie op niet-legacy batch, zonder
    CCP1, uitlevering op geannuleerde order, sessie sluiten zonder
    eindcontrole → 422 (W2).
7.2 Retourpad bier: creditnota met keuze "retour in voorraad" (negatieve
    uitlevering + storno accijns) of "alleen crediteren"; annuleren na
    picken verplicht via dit pad; kassa idem (W4, F7).
7.3 `useRol()`, nav en destructieve knoppen per rol; audit op `whoami` (W5).
7.4 Brewfather: profielen alleen zetten als lokaal leeg of "BF leidend";
    `bf_verweesd`-banner; CLAUDE.md corrigeren (W6).
7.5 Excel-restore: `undefined` voor ontbrekende sheet, preview per key,
    versiestempel, append-only vooraf melden (W7).
7.6 Inkoop: duplicaatcheck leverancier + factuurnummer; `leveranciers`-key;
    onthouden koppeling omschrijving → ingrediënt (V6).
7.7 Deelleveringen/backorders; factuur uit de picks; statiegeldretour
    boekt verpakkingen terug (W8).
7.8 Tankbezetting bij Vergisten; reinigingscheck uit `haccp_schoonmaak_log`;
    THT-waarschuwing bij lotverbruik en uitlevering; `lotcodeIsUniek` bij
    sessiestart; overlap in PlanningPage (W9, V4).
7.9 4-ogen: reviewer uit `gebruikers_rollen`, indiener ≠ reviewer server-side (F11).
7.10 Kostprijs bevriezen bij afboeken; `max(id)+1` → `newId()`;
     verpakkingsmateriaal via `voorraad_log` (V2, V3).
7.11 Voorraadstanden als delta-records; `_pendingSaves` persistent (V5).
7.12 Dashboardmeldingen in elke werkruimte (W10).

### Fase 8 — Grootboek (alleen na expliciet akkoord)

8.1 `rekening` + `debet_cent`/`credit_cent` op `JournaalRegel`; klein
    brouwerijschema; `voegBoekingToe` weigert ongebalanceerd; migratie (F3).
8.2 Boekingsbouwers voor betaling, bankimport, kapitaal, accijns bij
    uitslag, voorraadmutatie/COGS.
8.3 Balans en W&V uitsluitend uit het journaal; proefbalans; export naar
    boekhoudpakket.

### Bewust NIET doen

Geen framework-wissel, geen externe database, geen volledige RGS, geen
realtime sync, geen big-bang-refactor van de pagina's (boy-scout-regel blijft).

---

## 5. Voorgestelde volgorde

| Sprint | Inhoud | Dicht |
|--------|--------|-------|
| 1 | 5.1–5.4, 5.11, 5.12 | #1 #2 #3 #7 #8 |
| 2 | 5.5–5.10, 5.13 | S5–S10, #6 (blokkade) |
| 3 | 6.1, 6.2, 6.3, 6.4 | #4 #5, F4, F5 |
| 4 | 6.5–6.9 | F6, F8–F10, V1 |
| 5 | 7.1, 7.2, 7.3 | #9, #6 (retour), W5 |
| 6+ | 7.4–7.12 | W6–W10, V2–V6 |
| later | Fase 8 | #10 |
