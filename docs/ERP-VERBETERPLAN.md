# ERP-review & verbeterplan — BrewAdmin HA App

*Review van de volledige applicatie vanuit het perspectief van een ERP-specialist.
Gebaseerd op code-analyse van versie 1.10.76 (juli 2026): `server.py`,
`src/utils/api.ts`, `src/utils/calculations.ts`, alle 19 pagina's en de
datamodellen in `src/types/index.ts`.*

---

## 1. Managementsamenvatting

BrewAdmin is functioneel indrukwekkend breed: batch-lifecycle, lot-voorraad,
accijns met AGP-administratie, BTW-aangifte, bankreconciliatie (MT940, incl.
PSP-bundels), kassa, statiegeld, WooCommerce-integratie, HACCP en meertaligheid.
Voor een éénmans-brouwerij dekt het meer af dan menig commercieel MKB-pakket.

De architectuur is echter die van een **persoonlijke administratie-app**, niet
van een ERP-systeem. De drie fundamentele gaten:

1. **Geen transactionele integriteit.** Alle data leeft als losse JSON-arrays
   die per opslag integraal worden overschreven (last-write-wins). Eén handeling
   (bijv. order afronden) is vijf losse writes die half kunnen slagen. Twee
   open tabbladen kunnen elkaars werk geruisloos wissen.
2. **Financiële vastlegging is niet onveranderlijk.** Facturen zijn achteraf
   wijzigbaar en hard verwijderbaar, factuurnummers kunnen dubbelen of worden
   hergebruikt, en cijfers van een ingediende BTW-/accijnsperiode kunnen na
   indiening nog stil veranderen. Dat wringt met de fiscale bewaarplicht
   (art. 52 AWR) en factuurintegriteit.
3. **De traceerbaarheidsketen is niet sluitend.** Grondstoflot → batch is
   vastgelegd, maar afvulling → lot ontbreekt, en er zijn voorraad-mutatiepaden
   die buiten het mutatielog om lopen. Een recall vanaf een verkocht flesje of
   een sluitende volumebalans voor de douane is daardoor niet hard te maken.

Het goede nieuws: de businesslogica (`calculations.ts`, `btw.ts`) is al netjes
gescheiden van de UI en puur — de fundering voor professionalisering ligt er.
Het plan hieronder is gefaseerd zodat de grootste fiscale en
data-integriteitsrisico's eerst gedicht worden, zonder big-bang-herbouw.

### Top-10 risico's op volgorde van urgentie

| # | Risico | Domein | Ernst |
|---|--------|--------|-------|
| 1 | Last-write-wins zonder versiedetectie: tweede tabblad/apparaat wist wijzigingen | Data-integriteit | Kritiek |
| 2 | Facturen wijzig- en verwijderbaar na uitreiken; geen creditnota-verplichting | Fiscaal | Kritiek |
| 3 | Factuurnummer-race en nummer-hergebruik na verwijderen | Fiscaal | Hoog |
| 4 | Geen harde periode-lock: cijfers van ingediende BTW-/accijnsperiode kunnen nog muteren | Fiscaal | Hoog |
| 5 | Backups op hetzelfde volume als de data; upload-PDF's (facturen!) vallen buiten de backup | Continuïteit | Hoog |
| 6 | Recall-keten fles→lot niet sluitend; `saveLot` muteert voorraad buiten `voorraad_log` om | Traceability/HACCP | Hoog |
| 7 | Credentials plaintext op disk én via `GET /api/data/<key>` uitleesbaar; geen auth buiten HA-ingress | Security | Hoog |
| 8 | Multi-store handelingen niet atomair (order afronden = 5 losse POSTs) | Data-integriteit | Middel |
| 9 | Geen enkele geautomatiseerde test of CI; build zonder typecheck | Kwaliteit | Middel |
| 10 | Excel-backup kapt cellen >32k tekens stil af (stille corruptie bij restore) | Continuïteit | Middel |

---

## 2. Wat al goed is (behouden)

- **Atomic file writes**: `_atomic_write_bytes` (temp + `os.replace`) voorkomt
  corrupte JSON-bestanden bij crash (`server.py:627`).
- **Server-side backup met AGP-conforme retentie**: dagelijks 30 dgn, wekelijks
  1 jaar, maandelijks 7 jaar (`server.py:556-608`) — de retentielogica is goed,
  alleen de opslaglocatie niet (zie §3.1).
- **Accijnsmodule is het volwassenste stuk**: tariefhistorie per jaar, bevroren
  bedragen bij uitslag én aangifte, verplichte 4-ogen-controle vóór indienen,
  douane-vernietigingsflow met verplichte verklaring.
- **Scheiding businesslogica/UI**: `calculations.ts` (70 pure functies), `btw.ts`,
  `waterprofiel.ts` importeren geen React — direct unit-testbaar.
- **Security-basis**: strakke CSP, SSRF-guard op proxies, key-validatie tegen
  path traversal, secrets worden server-side aan proxy-requests toegevoegd
  (niet in de browser-URL).
- **FEFO-ondersteuning** in lot- en afvullingskeuze, negatieve-voorraad-detectie
  als aparte raw-view, verliesregistratie per bron met afgeleide restpost.

---

## 3. Bevindingen per domein

### 3.1 Data-laag & concurrency

- Elke `useStore`-key is één JSON-blob; opslaan = **hele array overschrijven**
  (`api.ts:232-251`, `server.py:1247-1264`). Geen ETag/versienummer, geen
  merge, geen conflictdetectie. Twee clients op dezelfde key → verlies van de
  eerste wijziging.
- `newId()` = `max(id)+1` per array (`api.ts:268`) → **id-hergebruik na
  verwijderen** en dubbele id's bij gelijktijdige clients. Verwijzingen
  (`accijns.batch_id`, picks) kunnen daardoor stilletjes naar een *ander* record
  gaan wijzen.
- Geen referentiële integriteit: batch-delete ruimt 7 gerelateerde stores op
  maar vergeet `uitleveringen`, `accijns` en `bestelling_picks`
  (`BatchesPage.tsx:1056-1069`) → verweesde records.
- Multi-store handelingen (picken, afronden/factureren) zijn 5-6 losse POSTs;
  bij een fout halverwege ontstaat half-gecommitte staat die alleen door de
  15s-retry-queue eventueel herstelt.
- Payload groeit onbegrensd: bij het naderen van de 10 MB-request-limiet faalt
  élke save van die key permanent (geen archivering/paginering server-side).
- Backups (`/data/backups/`) staan **op hetzelfde volume** als de data;
  geüploade factuur-PDF's/afbeeldingen vallen **buiten** de backup.
- Excel-backup: cellen >32.767 tekens worden stil afgekapt (alleen logo's zijn
  gechunkt); herimport laat de kapotte string dan staan → stille corruptie.

### 3.2 Financieel & fiscaal

- **Geen journaal/grootboek**: alle rapporten (W&V, balans, BTW) worden live
  herberekend uit bewerkbare factuurlijsten. Niets wordt "geboekt" behalve het
  afgeronde eurobedrag van een ingediende aangifte.
- **Factuur-onveranderlijkheid ontbreekt**: `deleteFactuur` verwijdert hard,
  `updateFactuur` overschrijft regels/bedragen/datum van bestaande facturen
  (`BoekhoudingPage.tsx:633-848`). Er is geen creditnota-verplichting voor
  correcties op uitgereikte verkoopfacturen.
- **Nummering**: teller in client-state, nummer toegekend vóór persistente
  opslag → race bij twee kassa's/tabs; fallback `max(bestaande)+1` hergebruikt
  nummers na verwijderen. Statiegeld-creditnota's schrijven bovendien in een
  **incompatibele structuur** in hetzelfde `factuur_counter`-object
  (`StatiegeldPage.tsx:182-185` vs. `KassaPage.tsx:526-540`).
- **Periodeafsluiting is zacht**: nieuwe facturen rollen netjes door naar een
  open periode (`btw.ts:58-74`), maar *bestaande* facturen in een ingediende
  periode blijven muteerbaar en veranderen dan het live-cijfer van die periode.
  Verkoopfacturen kennen zelfs geen rollover-bescherming.
- **Balans is indicatief**: crediteuren hardcoded €0, geen liquide
  middelen/bank, geen beginbalans-continuïteit tussen boekjaren, geen
  COGS-matching (inkoop = direct kosten, voorraadmutatie telt niet mee in het
  resultaat).
- **Bankreconciliatie matcht puur op bedrag** (±€0,01/±€1,00), niet op
  tegenrekening/kenmerk — twee gelijke bedragen kunnen verkeerd gekoppeld
  worden. Begin-/eindsaldo uit MT940 wordt geparsed maar niet aangesloten.
- **Floats overal**: bedragen als IEEE-754 `number` met `Math.round(x*100)/100`;
  BTW per regel afgerond en dan gesommeerd (afrondingsdrift t.o.v.
  grondslag-berekening).

### 3.3 Voorraad, productie & traceability

- Grondstoflot→batch is vastgelegd (`BatchIngredient.lot_id` + `voorraad_log`),
  maar **afvulling→lot ontbreekt**: recall vanaf een verkochte SKU vergt
  handwerk batch→alle bi-regels.
- **Mutatielog is niet sluitend**: `saveLot` overschrijft `lot.hoeveelheid`
  direct zonder `voorraad_log`-entry (`IngredientenPage.tsx:197-220`);
  emballage-afboeking bij afvullen wordt evenmin gelogd.
- **Bier-telverschillen bij inventarisatie worden niet teruggeboekt** — alleen
  de accijnsimpact wordt getoond (`InventarisatiePage.tsx:200`); het
  voorraadverschil blijft administratief hangen.
- **Geen tankvolume-guard bij afvullen**: er kan meer afgevuld worden dan
  `liter_vergist`; de balansweergave clampt naar 0 en maskeert de overschrijding
  (accijns-relevant).
- Voorraadclamping (`Math.max(0,…)`) op alle paden maskeert tekorten in de
  normale views; alleen de raw negatief-view toont ze.
- Geen voorraadwaardering (AVCO/FIFO) — waarde = lotprijs × hoeveelheid van het
  moment; werkbaar op deze schaal maar niet aansluitend op een W&V met COGS.
- WooCommerce: orderimport is netjes idempotent op `wc_order_id`, maar er is
  geen update-pad voor gewijzigde WC-orders, geen status-writeback en de
  stock-push is een eenrichtings-overschrijving zonder reservering.

### 3.4 Security & beheer

- **Buiten HA-ingress is er géén enkele authenticatie** (`_client_allowed`
  returnt onvoorwaardelijk `True` zonder `SUPERVISOR_TOKEN`, `server.py:192`).
  Binnen ingress geen onderscheid tussen HA-gebruikers, geen rollen.
- **Secrets plaintext** in `/data/*.json` én integraal terug te lezen via
  `GET /api/data/smtp_creds` e.d. — elke ingress-client kan de
  WooCommerce-secret, Anthropic-key en het SMTP-wachtwoord ophalen.
- **Audit-log is niet bewijskrachtig**: client-side geschreven, gebruikersnaam
  door de browser aangeleverd, en de hele log is via de normale data-API
  herschrijfbaar/wisbaar.
- Mail-endpoint is binnen ingress een open relay op de opgeslagen SMTP-creds.
- Upload-validatie checkt extensie maar niet de bytes (geen magic-byte-check).
- Logging = `print` naar stdout; geen gestructureerde logs, geen health-endpoint,
  daemon-threads zonder herstart-bewaking.

### 3.5 Kwaliteit & proces

- **Nul tests** (geen runner geïnstalleerd), **geen CI** (geen `.github/`),
  `npm run build` draait Vite zonder `tsc`-typecheck, TypeScript strict staat
  uit en page-props zijn grotendeels `any`.
- Pagina's tot 3.986 regels / 263 KB; `App.tsx` met ~96 `useStore`-hooks en
  prop-drilling naar alle pagina's.
- Validatie is ad-hoc inline (`confirm()`/`alert()`, `Number(...)||0` stille
  coercion); server valideert alleen "is het JSON".

---

## 4. Verbeterplan

Gefaseerd: elke fase is zelfstandig waardevol en breekt de bestaande werking
niet. Fase 0–1 dichten de fiscale en dataverlies-risico's; fase 2–3 maken er
een echt ERP van; fase 4 is de structurele fundering.

### Fase 0 — Stop het bloeden (quick wins, dagen werk)

*Doel: dataverlies en fiscale gaten dichten zonder architectuurwijziging.*

1. **Optimistic locking per data-key.** Server geeft bij GET een versienummer
   (of mtime-hash) mee; POST stuurt die terug en krijgt `409 Conflict` bij
   mismatch. Client toont dan "data is elders gewijzigd — herlaad". Dit is
   ~50 regels in `server.py` + afhandeling in `_postToServer`, en elimineert
   risico #1.
2. **Server-side factuurnummer-endpoint.** `POST /api/nextnr/<reeks>` dat
   onder de bestaande `_data_lock` atomair verhoogt en teruggeeft. Aparte
   reeksen voor facturen en creditnota's (ruimt ook de dubbele
   `factuur_counter`-structuur op). Nooit meer nummeren in de client.
3. **Facturen bevriezen.** Eén veld `definitief: true` zodra uitgereikt
   (gemaild/geprint/gekoppeld): daarna geen `updateFactuur`/`deleteFactuur`
   meer in de UI — correctie alleen via creditnota. Verwijderen alleen voor
   concepten.
4. **Harde periode-lock.** `isPeriodeGesloten` bestaat al; gebruik die om
   mutatie van facturen/accijnsrecords met datum in een ingediende periode te
   blokkeren (UI + guard in de save-functies). Nieuwe facturen rollen al
   correct door — dit sluit alleen het bestaande gat.
5. **Backup off-volume + uploads.** Backup-ZIP ook naar `/backup` of
   `/share` van Home Assistant schrijven (HA's eigen snapshot-map) en de
   upload-map meenemen in `_run_backup`. Optioneel: dagelijkse HA-notificatie
   bij mislukte backup.
6. **Secrets afschermen.** `GET /api/data/<key>` voor de vier `secure`-keys
   laten antwoorden met gemaskeerde waarden (`{configured: true}`);
   de UI heeft de plaintext niet nodig, alleen de proxies. Bestandspermissies
   `0600` op creds-bestanden.
7. **Voorraad-lekken dichten**: `saveLot`-mutaties door `voorraad_log` laten
   lopen (type `correctie`); bier-telverschillen bij inventarisatie-afronden
   als afboeking wegschrijven; tankvolume-guard bij afvullen (waarschuwing +
   bevestiging i.p.v. stil clampen).
8. **Excel-backup hardening**: chunking (zoals logo's) voor élke cel >30k
   tekens, of grote velden weglaten met expliciete melding; import-diagnostiek
   i.p.v. stille `catch`.

### Fase 1 — Transactionele integriteit (1–2 weken)

1. **Batch-commit-endpoint**: `POST /api/commit` accepteert `{key: data, ...}`
   voor meerdere keys en schrijft ze onder de lock als geheel (alle temp-files
   eerst, dan alle renames). Order afronden, picken en kassaverkoop worden dan
   één atomaire commit i.p.v. 5-6 losse POSTs. Client-side: één
   `saveAll({...})`-helper naast `useStore`.
2. **UUID's voor nieuwe records** (`crypto.randomUUID()`), bestaande integer-id's
   blijven geldig. Elimineert id-hergebruik en concurrency-duplicaten. Types
   zijn al `string | number`-tolerant op de meeste plekken.
3. **Referentiële-integriteitscheck als functie**: één `checkIntegriteit(data)`
   in `calculations.ts` die verweesde verwijzingen rapporteert (accijns→batch,
   pick→afvulling, …), getoond op een "Gezondheid"-tab bij Instellingen +
   guard bij verwijderen (batch met uitleveringen → blokkeren of expliciet
   cascaderen).
4. **Server-side schemavalidatie (licht)**: per key een minimaal contract
   (array vs. object, verplichte id-velden, max recordgrootte) in `server.py` —
   stdlib-only, geen frameworks nodig. Weigeren met 422 + duidelijke fout.
5. **Append-only audit server-side**: de server logt elke data-POST (key, tijd,
   ingress-user-header indien beschikbaar, versie-voor/na) naar een
   append-only logbestand buiten de data-API om. De bestaande client-audit
   blijft voor de UI, maar is niet langer het enige spoor.

### Fase 2 — Financieel professionaliseren (2–4 weken, incrementeel)

1. **Licht journaalmodel**: bij definitief maken van een factuur/uitslag/aangifte
   een onveranderlijke journaalregel wegschrijven (`journaal`-key: datum,
   dagboek, debet/credit-bedrag, bron-id). Rapporten (W&V, BTW, balans) lezen
   uit het journaal i.p.v. live uit muteerbare lijsten. Dit geeft:
   bevroren periodes, aansluitbare cijfers en een controleerbaar spoor —
   zonder volledige dubbel-boekhouding te hoeven bouwen.
2. **Bedragen in centen** (integers) in het journaal en op factuurtotalen;
   BTW afronden op grondslag per tarief per aangifte conform
   Belastingdienst-regels, niet als som van regel-afrondingen.
3. **Balans compleet maken**: crediteuren uit openstaande inkoopfacturen,
   liquide middelen uit bankimport-saldi (MT940 begin/eindsaldo wordt al
   geparsed — nu ook aansluiten), jaarafsluiting met beginbalans-overdracht.
4. **Bankreconciliatie versterken**: match-score op bedrag + tegenrekening +
   omschrijving/kenmerk i.p.v. alleen bedrag; saldo-aansluitcontrole per
   import ("MT940 zegt −€1.234,56, gekoppeld −€1.230,00, verschil €4,56").
5. **Debiteuren/crediteuren-ouderdom** in buckets (0-30/31-60/61-90/90+) —
   de vervallen-lijst en aanmaanflow bestaan al; dit is vooral presentatie.
6. **COGS-optie**: kostprijs per batch bestaat al (`berekenProductKostprijs`);
   koppel die aan uitleveringen zodat de W&V naast "inkoop als kosten" ook een
   marge-weergave op werkelijke kostprijs kan tonen.

### Fase 3 — Kwaliteit & proces (parallel aan fase 1–2)

1. **Vitest + eerste testsuite** op de pure logica: `accijnsCalc`,
   `berekenWinstVerlies`, `btw.ts` (rollover!), `voorraadPerLocatie`,
   `parseMT940`, `zoekPspCombinatie`, `excelExport/Import` round-trip. Dit is
   de hoogste test-ROI van de hele codebase: financiële kernlogica, puur, en
   nu 0% gedekt.
2. **`pytest` voor `server.py`**: key-validatie, rate-limit, atomic write,
   upload-validatie, en de nieuwe 409/422-paden.
3. **GitHub Actions CI**: `tsc --noEmit` + `npm run build` + tests + een
   Docker-build. Versie-bump-check (config.yaml vs. CHANGELOG) als lint-stap.
4. **TypeScript aanscherpen, incrementeel**: eerst `noImplicitAny` op
   `utils/` en `types/`, page-props typeren i.p.v. `any` (de interfaces
   bestaan al in `types/index.ts`).
5. **Pagina's opsplitsen bij onderhoud** (boy-scout-regel, geen big-bang):
   modals en tabbladen van de 3.000+-regel-pagina's naar eigen bestanden;
   gedeelde patronen (voorraad-reduce, ordertotaal) naar `utils/`.
6. **Gestructureerde serverlogging** (stdlib `logging`, JSON-regels) +
   `/api/health`-endpoint met threads-status en laatste-backup-tijd, zichtbaar
   op het dashboard.

### Fase 4 — Structurele fundering (alleen als multi-user/schaal echt nodig wordt)

1. **SQLite als opslaglaag** — zit in de Python-stdlib, dus past binnen de
   "stdlib only"-constraint. Migratielaag die de bestaande keys 1-op-1 als
   tabellen opneemt; de `/api/data/<key>`-API blijft bestaan, maar krijgt er
   echte transacties, WAL-concurrency, foreign keys en query's op deelsets
   (lost ook het 10 MB-payloadprobleem op). Dit is de natuurlijke opvolger van
   fase 1's batch-commit.
2. **Gebruikers & rollen**: ingress geeft de HA-gebruiker al door — registreer
   die server-side per mutatie (fase 1.5) en voeg daarna simpele rollen toe
   (beheer / boekhouding / productie / alleen-lezen). Belangrijk zodra er méér
   dan één persoon in werkt.
3. **Delta-sync i.p.v. hele arrays**: per-record endpoints of een
   mutatie-queue, pas relevant bij merkbare payload-groei of echt gelijktijdig
   gebruik.

### Bewust NIET doen (over-engineering op deze schaal)

- Geen microservices, message-queues of externe databaseserver — één addon,
  één proces is hier juist.
- Geen volledige dubbel-boekhouding met rekeningschema — het lichte
  journaalmodel (fase 2.1) geeft 90% van de waarde; export naar een echt
  boekhoudpakket kan altijd nog.
- Geen framework-vervanging (React blijft, geen state-library nodig zolang
  `useStore` versie-bewust wordt gemaakt).
- Geen realtime-sync/websockets — 409-conflictdetectie volstaat voor het
  werkelijke gebruikspatroon.

---

## 5. Voorgestelde volgorde (samengevat)

| Sprint | Inhoud | Risico's gedicht |
|--------|--------|------------------|
| 1 | Fase 0.1–0.4: optimistic locking, nummer-endpoint, factuur-freeze, periode-lock | #1 #2 #3 #4 |
| 2 | Fase 0.5–0.8: backup off-volume + uploads, secrets maskeren, voorraad-lekken, Excel-hardening | #5 #6 #7 #10 |
| 3 | Fase 1.1–1.3: batch-commit, UUID's, integriteitscheck | #8, verweesde data |
| 4 | Fase 3.1–3.3: Vitest + pytest + CI | #9 |
| 5+ | Fase 2 (journaal, centen, balans, reconciliatie) en doorlopend fase 3.4–3.6 | fiscale volwassenheid |
| later | Fase 4 (SQLite, rollen) zodra multi-user reëel wordt | structureel |

De rode draad: **eerst betrouwbaar, dan compleet, dan mooi.** De functionele
breedte is er al — wat BrewAdmin scheidt van een professioneel ERP is
transactionele zekerheid, onveranderlijke financiële vastlegging en een
sluitend spoor van elke mutatie. Precies dat bouwt dit plan op, in kleine,
zelfstandig nuttige stappen.
