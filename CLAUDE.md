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
- 5-language support (NL, EN, DE, FR, ES) with 7 UI themes

The app is "fully built with Claude AI" (noted in README). UI text and many code comments are in Dutch.

---

## Architecture

```
BrewAdmin-HA-App/
├── src/                    # React/TypeScript frontend
│   ├── components/
│   │   ├── ui/             # Reusable UI primitives (o.a. `useDialoogFocus` — focus-trap/Escape van Modal
│   │   │                   # en het inkoopwerkblad — en `useSmalScherm`: het omslagpunt van 768 px;
│   │   │                   # `useTelefoonIndeling`: ook een telefoon dwars houdt de telefoonindeling).
│   │   │                   # Ook: `ActieBalk` (één volgende stap vast onderin, `bottom: var(--onderbalk)`,
│   │   │                   # zet `--actiebalk` voor de UndoBar), `AttentieKaart` ("Vraagt om aandacht"),
│   │   │                   # `Segment`, `Onderblad`, `Blad` (Modal op het bureau, Onderblad op de
│   │   │                   # telefoon), `EtiketAllergenen`, `useBreedte`.
│   │   │                   # De lijstpagina's van Administratie (zie "Administratie — patronen"):
│   │   │                   # `FilterBalk` (zoeken met "/" als sneltoets, `StatusChips` met aantallen,
│   │   │                   # `PeriodeKiezer`, extra filters als kinderen; telefoon: zoeken + knop
│   │   │                   # Filter met het aantal actieve filters → paneel van onderen),
│   │   │                   # `ResponsiveLijst` (tabel op het bureau, één kaart = één tapdoel op de
│   │   │                   # telefoon; een knop ín een kaart krijgt `KAART_INTERACTIEF`; `breed`-kolommen
│   │   │                   # pas vanaf 1024 px), `DetailPaneel` + `LijstMetDetail` (detail naast de lijst,
│   │   │                   # 320/380 px; telefoon: eigen scherm z-[150] met terugknop en vaste actiebalk —
│   │   │                   # boven de onderbalk, onder UndoBar en Modal) en `useGedeeldePeriode`
│   │   │                   # (`useGedeeldBereik`, `zetGedeeldePeriode`: één periode voor de hele werkruimte,
│   │   │                   # sessionStorage `brewadmin_admin_periode`, standaard dit jaar)
│   │   ├── InkoopFactuurModal.tsx  # Inkoop boeken: het werkblad (bureau: factuur naast de boeking; telefoon:
│   │   │                           # wissel Factuur | Boeking, regel in een paneel van onderen). Alle regels in
│   │   │                           # één lijst, factuurscan, etiketfoto's, totaalcontrole, "Bij opslaan". Geeft
│   │   │                           # de pagina dezelfde `onSave`-vorm als vroeger (+ `lots`/`etiket_fotos` op een
│   │   │                           # productregel); `false` terug = niet opgeslagen. `inboxItem` laadt een PDF uit
│   │   │                           # het postvak (geen tweede upload) en kent "Opslaan en volgende". Alle
│   │   │                           # bestandsinvoer (ook de etiketcamera per regel, via `onKies` van
│   │   │                           # EtiketFotos) staat als eerste kind van het portaal: hij overleeft een
│   │   │                           # indelingswissel terwijl de camera open staat
│   │   ├── inkoop/                 # Onderdelen van dat werkblad: FactuurDocument (pdf.js op canvas, zoom,
│   │   │                           # knijpen, markering van de open regel), RegelLijst, RegelEditor, LotVelden
│   │   │                           # (meer lots per regel), EtiketFotos, LotEtiket (etiketfoto bij een bestaand
│   │   │                           # lot, lotvenster Ingrediënten), ItemKiezer, InkoopTotalen, Onderblad, Segment
│   │   ├── InkoopInbox.tsx         # Facturen › Inkoop → status "Te verwerken": de wachtrij met doorgestuurde PDF-facturen
│   │   ├── InkoopMailInstellingen.tsx # Instellingen → Koppelingen → Facturen per e-mail (`imap_creds`, test, status)
│   │   ├── BatchRapportExport.tsx  # Batchdossier → print-HTML / printvenster / PDF-download
│   │   └── PakbonExport.tsx        # Pakbon, picklijst, factuur, herinnering. Deelt
│   │                               # `DOC_CSS`/`esc`/`breweryBlock`/`openPrint` met het dossier
│   │   ├── batch/                  # De batchpagina in delen: BatchKop + KetenRegel (Recept › Product ›
│   │   │                           # Tank), EtiketKaart (etiket & website; modi batch/product/recept),
│   │   │                           # EtiketBijwerken (de énige schrijfweg voor het etiket, overal te openen
│   │   │                           # met `useEtiketBijwerken()?.open({productId, batchId?})`), AbvVastzetten,
│   │   │                           # NieuweBatchBlad ("Wat brouw je?", overal via `useNieuweBatch()?.open(…)`),
│   │   │                           # MetingBlad, AfvulSessieSectie (CCP 2/3), useProductKoppeling, FaseKop
│   │   │                           # (bureau: compacte stappenbalk; telefoon: "Fase 4 van 6" met een lijst)
│   │   ├── brouwzaal/              # Brouwzaal: TankKaart (één knop = `volgendeStap`), LegeTank, AndereBatches
│   │   │                           # (ook Vergisten/Conditioneren zonder bestaande tank), KomendeDagen
│   │   ├── batches/                # Tab Batches: Lopend · Gesloten · Agenda (BatchesAgenda = de brouwagenda;
│   │   │                           # Gantt op het bureau, lijst per tank op de telefoon)
│   │   ├── recept/                 # Recepten "in gebruik": ReceptLijst, ReceptDetail + ReceptVerbindingen,
│   │   │                           # ReceptKiezer (dé kiezer: Wat brouw je?, recept koppelen, opnieuw toepassen),
│   │   │                           # ProductKiezer, KiezerBlad
│   │   ├── product/                # De productpagina als knooppunt: KetenStrook (Recept › Brouwsels › Etiket ›
│   │   │                           # Voorraad › Verkoop), ProductKop, Voorraad-/Brouwsels-/Artikelen-/ReceptKaart
│   │   ├── verkoop/                # Verkoop › Overzicht: TePicken, VoorraadKomtEraan
│   │   ├── bestelling/             # Bestellingen: kaarten, statuschips, orderregels met "komt eraan", merchbeheer
│   │   ├── kassa/                  # Kassa: tegels per product, bonbalk + bon (onderblad onder `lg`), klant
│   ├── pages/              # Feature pages (one per domain)
│   │   ├── AdministratieDashboard.tsx # Overzicht van Administratie: de rijen van `beslissingen()` (App rekent
│   │   │                   # ze één keer uit, `adminRijen` — dezelfde lijst als de badge) + vier tegels
│   │   │                   # (`overzichtCijfers`) die Facturen openen met dezelfde filter en periode
│   │   ├── AgpPage.tsx, VoorraadverloopPage.tsx, InventarisatiePage.tsx # De drie segmenten van Voorraad
│   │   │                   # (AGP-stand | Verloop | Tellingen); eigen props, geen AdminContext
│   │   └── admin/          # Werkruimte Administratie (v1.12.89/90): vervangt BoekhoudingPage, RapportenPage
│   │       │               # en AccijnsPage. Een sectie houdt zijn eigen formulieren, filters en modals;
│   │       │               # zelfstandige onderdelen staan in de submap met dezelfde naam
│   │       ├── AdministratiePage.tsx # Container van Facturen, Bank, Aangiftes en Rapporten (`sectie`): de
│   │       │               # props uit App, plus wat meer dan één sectie nodig heeft (BTW-rollover,
│   │       │               # alt-rekeningschuld, BTW-/accijnsbetaling (ont)koppelen, `markeerBetaald`,
│   │       │               # `bankTransacties` met de vlaggen uit `herstelKoppelingVlaggen`, en de
│   │       │               # PSP-kostenverrekening: `verrekenPspKosten`, `werkVerrekendeFacturenBij`,
│   │       │               # `kostenpostMagVervallen` — Bank én Facturen). Wist het
│   │       │               # navigatiedoel na het mounten (`onNavDoelConsumed`)
│   │       ├── adminContext.ts # `AdminContextWaarde` + `useAdmin()`. Wordt iets later gedeeld, dan verhuist
│   │       │               # het naar AdministratiePage en komt het hier bij — geen tweede kopie in een sectie
│   │       ├── FacturenSectie.tsx # Verkoop | Inkoop: filterbalk, lijst, detail, postvak als status
│   │       │               # "Te verwerken", CSV van precies de gefilterde lijst
│   │       ├── facturen/   # VerkoopDetail/InkoopDetail, Tijdlijn ("Gebeurd"), FactuurPil, DetailKnoppen
│   │       │               # (één primaire knop + "Meer"), lijsten (kolommen + telefoonkaarten),
│   │       │               # LosseFactuurModal, AltRekeningKiezer, UblWaarschuwing, Melding (i.p.v. alert()),
│   │       │               # PspVerrekenModal (de factuur van Mollie e.d. verrekenen met de uitbetalingen)
│   │       ├── BankSectie.tsx # Werkwachtrij Te koppelen | Gekoppeld | Alles: rekeningkeuze, saldo,
│   │       │               # aansluitregel, één voorstel + één knop per transactie, import en afschriften
│   │       ├── bank/       # Aansluiting, AfschriftenModal (lijst + verwijderen met terugweg),
│   │       │               # FactuurKiezer (zoeken i.p.v. keuzelijst), KeuzeModal (periode/maand/rekening),
│   │       │               # TransactieModal ("Wat is deze transactie?"), PspModal (uitsplitsen: verslag +
│   │       │               # facturen + kosten verrekenen/factuur volgt/kostenpost), VerslagBlok (het
│   │       │               # uitbetalingsverslag en de factuur per regel; "Factuur maken" voor een betaalde
│   │       │               # bestelling die nog geen factuur heeft), verslagLezen (eerst de tekstlaag,
│   │       │               # anders Claude: scan, foto's, onbekende opmaak), KapitaalModal, bankTekst
│   │       ├── AangiftesSectie.tsx # BTW | Accijns: periodelijst met stappen, detail met invulhulp,
│   │       │               # controle, indienen en betaling; webshopverkopen ophalen
│   │       ├── aangiftes/  # PeriodeLijst (één component voor beide), BtwRubrieken, AccijnsBoekingen,
│   │       │               # ControleBlok (vier ogen), BetalingBlok, onderdelen (stappenbalk, pil),
│   │       │               # useRollenConfig (`gebruikers_rollen` met een gewone GET, geen useStore)
│   │       ├── RapportenSectie.tsx # Periodebalk + rapportmenu (bureau ≥ 1024 px links, anders een
│   │       │               # keuzelijst); onthoudt rapport, vergelijking en journaalfilter in sessionStorage
│   │       ├── rapporten/  # WinstVerlies, MargeKostprijs, Balans (peildatum, jaarafsluiting, alt-schuld),
│   │       │               # OpenstaandePosten, OmzetPerArtikel, Journaal, exportZip ("Alles exporteren"),
│   │       │               # hulp (`useCsvExport`: elk rapport registreert zijn eigen CSV)
│   │       ├── VoorraadPage.tsx # Segment AGP-stand | Verloop | Tellingen rond de drie pagina's hierboven
│   │       └── voorraad/   # LocatiesModal, Melding (rode regel i.p.v. alert())
│   ├── utils/
│   │   ├── api.ts          # API client & state management
│   │   ├── route.ts        # Hash-routing van de schil: werkruimte/pagina/batch ↔ `#/…`, PAGINA_WERKRUIMTE, isDetailRoute;
│   │   │                   # `PAGINA_ALIAS` + `resolveerDoel`: oude pagina-id's (`boekhouding` + tabblad, `agp`,
│   │   │                   # `inventarisatie`, `voorraadverloop`) landen op de plek waar het onderdeel nu staat
│   │   ├── kleurContrast.ts # WCAG-luminantie/contrast; `afgeleideThemaKleuren` maakt het accent donkerder tot het als tekst (4,5:1) en rand (3:1) leesbaar is
│   │   ├── undo.ts         # `UitgesteldeActiePlanner`: terugweg van vijf seconden i.p.v. confirm() (UI: components/ui/UndoBar.tsx)
│   │   ├── menuPositie.ts  # Waar het ⋯-menu van RowActions komt: onder de knop, anders erboven, anders aan de
│   │   │                   # kant met de meeste ruimte (met maximale hoogte); altijd binnen het venster
│   │   ├── rollen.ts       # Rollentabel hoofdletterongevoelig (zoals HA gebruikersnamen vergelijkt):
│   │   │                   # spiegel van `_rol_uit_tabel`/`_rollen_lockout` in server.py voor het rollenbeheer
│   │   ├── geheimen.ts     # Sentinel `__SECRET__` alleen bij een ongewijzigde bestemming (storeUrl;
│   │   │                   # SMTP-host/-poort/-gebruiker/-beveiliging) — spiegel van `_SECRET_BESTEMMING`
│   │   ├── bijlage.ts      # `uploadBijlage` (afboeking/vernietiging): servernaam bewaren, mislukte
│   │   │                   # upload melden (`uploadFoutSleutel`) i.p.v. stil laten vallen
│   │   ├── integriteitHerstel.ts # Herstel van kapotte verwijzingen uit `integriteit.ts` (Instellingen →
│   │   │                   # App → Data-gezondheid): alleen stamgegevens-koppelingen (lot → ingrediënt,
│   │   │                   # batch/afvulling/artikel → product, → verpakking), met een voorstel op naam
│   │   │                   # uit het record of het ontvangstlog; boekingen (accijns, uitleveringen,
│   │   │                   # picks, facturen) nooit
│   │   ├── merge.ts        # Conflict-samenvoeging bij een 409: lokale en serverwijziging op
│   │   │                   # verschillende records gaan beide mee; alleen hetzelfde record aan
│   │   │                   # beide kanten is een botsing (server wint). Arrays met `id` + objecten
│   │   ├── commit.ts       # Commit-buffer: `verdeelCommit` knipt een bundel boven `COMMIT_MAX_KEYS`
│   │   │                   # (= server.py, pytest bewaakt het) in groepen (backup terugzetten,
│   │   │                   # fabrieksreset); `commitVervolg`: een 403/422 op één key laat een gewone
│   │   │                   # handeling in zijn geheel vallen — nooit de rest los nasturen
│   │   ├── audit.ts        # Auditlogboek: `logAudit` (losse gebeurtenis) en
│   │   │                   # `logAuditVeld` (velden die tijdens het typen opslaan —
│   │   │                   # voegt een reeks samen tot één regel per veld). `AUDIT_SOORTEN`
│   │   │                   # is de enige plek voor soortnamen; een test faalt bij een
│   │   │                   # naam die daar niet in staat
│   │   ├── constants.ts    # Enums, mappings, defaults
│   │   ├── format.ts       # Formatting utilities
│   │   ├── calculations.ts # Business logic calculations
│   │   ├── etiket.ts       # Etiket & website — de énige bron (zie "Etiket & website" hieronder):
│   │   │                   # `etiketWaarden` (per waarde getal + bron), `abvBerekend` (Balling via
│   │   │                   # `abvBalling`, + suiker na de kook), `energiePer100ml` (kcal én kJ), `abvMarge`,
│   │   │                   # `vergelijkEtiket`/`etiketStatus`, `allergeenRegel` ("Bevat: …"),
│   │   │                   # `referentieBatch`, `productEtiketWaarden`, `legEtiketVast` (énige schrijfweg),
│   │   │                   # `volgendeEtiketVersie`, `websiteLooptAchter`, `webshopBevatRegel`
│   │   ├── etiketKaart.ts  # Het model van de EtiketKaart (blokken, rijen, oordelen) bovenop etiket.ts
│   │   ├── afvulControle.ts # De afvulcontrole (tankvolume, ABV): fout = knop uit, waarschuwing = bevestigen in de knop
│   │   ├── productKeten.ts # De keten recept › batch › product: `receptHoofdId`/`hoofdIdResolver` (een
│   │   │                   # Brewfather-versie `<parent>__v<_id>` telt voor zijn hoofdrecept — gebruik
│   │   │                   # nooit een eigen regex), `batchTitel` (product → recept → naam; overal dezelfde
│   │   │                   # titel), `receptenVanProduct` (recept_ids ∪ recepten van zijn batches, afgeleid),
│   │   │                   # `huidigReceptVoorProduct`, `productVoorstelVoorRecept`, `productVoorBatch`,
│   │   │                   # `receptVoorBatch`, `nieuwProductUitBatch` (geen ABV, geen allergenen),
│   │   │                   # `tankBeschikbaarOp` (gereserveerd ≠ bezet), `productenVoorKeuze`
│   │   ├── batchKeten.ts   # Het product bij plannen (één kandidaat = koppelen met terugweg, meer = kiezen,
│   │   │                   # geen = nieuw/later) en de ketenregel in de batchkop
│   │   ├── receptNaarBatch.ts # De énige vertaling recept → batch + batchregels (plannen én opnieuw toepassen)
│   │   ├── nieuweBatch.ts  # Het blad "Wat brouw je?": `planNieuweBatch`, tankstatus op de brouwdatum
│   │   ├── receptGebruik.ts # Recepten "in gebruik" (zie Key Domain Concepts): `receptGebruik`,
│   │   │                   # `receptenPerProduct`, `receptenVoorKiezer`, `tellingen`
│   │   ├── receptLijst.ts  # De receptenpagina: In gebruik · Archief · Verborgen, tags als filter, zoeken
│   │   ├── verkoopOverzicht.ts # Eén voorraadtelling voor Verkoop: `voorraadPerProduct` (per verpakking —
│   │   │                   # flessen en fusten nooit opgeteld; vrij · AGP · besteld · tekort/uitTeSlaan),
│   │   │                   # `komtEraan` (batches Gepland t/m Conditioneren, geschatte stuks),
│   │   │                   # `dekkingWeken`, `orderRegelLevering`. Overzicht, Producten, Kassa en
│   │   │                   # Bestellingen delen één `verkoopCtx` uit App.tsx — nooit een eigen telling
│   │   ├── volgendeStap.ts # De ene volgende stap per batch (tankkaart, Batches › Lopend, ActieBalk):
│   │   │                   # met › = openen (`stapNaarBatchDoel`), zonder › = uitvoeren
│   │   ├── batchesLijst.ts # Tab Batches: groepering per fase, filter, `stapNaarBatchDoel`/`batchAankomst`
│   │   ├── batchAgenda.ts  # De brouwagenda per tank (balkposities, bereik)
│   │   ├── productPagina.ts # Productpagina: lijstgroepen, chips, `tekortChip` (echt tekort naast het AGP-deel),
│   │   │                   # kostprijs per stuk (liter zonder verpakking × inhoud + verpakking)
│   │   ├── productAandacht.ts # Selecties achter de attentieposten `etiket`, `afgevuld_zonder_artikel`,
│   │   │                   # `bier_tht`, `sku_conflict` (attentieTekst.ts maakt er de tekst van)
│   │   ├── verkoopDashboard.ts # Rijen en teksten van Verkoop › Overzicht (te picken, voorraadchips, komt eraan)
│   │   ├── bestelling.ts   # Bestellingen: zoeken, statustellingen, de ene volgende stap, totalen (= factuur)
│   │   ├── kassaCatalogus.ts # Kassategels per product_id; `kassaAllocatie` boekt uit dezelfde lots als de tegel
│   │   ├── productLogboek.ts # Het logboek van één product (eigen mutaties + webshopregels)
│   │   ├── detailTitel.ts  # Kopbalktitel op een detailscherm ("Kadeblond #2609", receptnaam, WC-4321)
│   │   ├── brouwzaal.ts    # De brouwzaal: tankrijen, andere batches, komende 14 dagen
│   │   ├── batchActieBalk.ts # De stap van de fase in de ActieBalk van de batch (telefoon)
│   │   ├── centen.ts       # Cent-exacte geldberekening (ERP 2.2): totaliseerRegels/totaliseerInkoop — gebruik dit voor élk factuurtotaal
│   │   ├── journaal.ts     # Journaalboekingen (ERP 2.1): boekingsbouwers, storno, W&V uit journaal
│   │   ├── kostensoortHerindeling.ts # De kostensoort van inkoopregels achteraf anders ("Overig" →
│   │   │                   # "Installatie"), óók in een ingediende of betaalde BTW-periode: alleen het
│   │   │                   # veld `kostensoort` (voorraadregels liggen vast), journaal = storno +
│   │   │                   # herboeking op dezelfde datum en in dezelfde periode; `null` als dat een
│   │   │                   # bedrag of de BTW zou verschuiven. UI: `admin/facturen/KostensoortBlad.tsx`
│   │   ├── balans.ts       # Balansposten uit het journaal: `btwPositieCent` = nog af te dragen
│   │   │                   # BTW (verkoop − voorbelasting) over de niet-afgerekende periodes;
│   │   │                   # `btwAfgerekendOp`/`btwPositieOp` = hetzelfde op een peildatum (journaalregels
│   │   │                   # t/m die dag, afgerekend = betaling of nihil-aangifte op of vóór die dag)
│   │   ├── rapporten.ts    # Rapporten: menu (`RAPPORT_GROEPEN`; oude tabbladen `ouderdom`/`omzet_cat`/
│   │   │                   # `transacties` via `leesRapport`), W&V van boven naar beneden (`wvOpbouw`:
│   │   │                   # omzet − grondstoffen − verpakking = brutomarge − overige kosten − accijns =
│   │   │                   # netto; een test bewaakt dat het optelt tot `nettowinst`), `peildatumVoor`
│   │   │                   # (einde periode, nooit na vandaag) + `balansOp`/`openVerkoopOp`/`openInkoopOp`
│   │   │                   # (open zoals `facturen.ts`, plus betaald ná de peildatum), `liquideMiddelenOp`
│   │   │                   # (laatste bewaarde afschrift t/m de peildatum, of beginsaldo + transacties als
│   │   │                   # de peildatum er midden in valt; anders `bank_saldi`), openstaande posten
│   │   │                   # (`ouderdomsAnalyse`), omzet per artikel, journaal met dagboekfilter +
│   │   │                   # kapitaalboekingen als losse regels, `csvProcent`
│   │   ├── tankbewaking.ts # Bewaking tanktemperatuur: getoetst aan het wérkelijke setpoint van de
│   │   │                   # gekoppelde koeling (key `tank_setpoints`, terugval = vergistings-
│   │   │                   # schema/cold-crash), tolerantieband, instelruimte na een setpoint-/
│   │   │                   # stapwissel, wegloopdetectie (Theil-Sen-trend) en sensorstilte —
│   │   │                   # server.py spiegelt deze regels in Python
│   │   ├── haccp.ts        # Kritische beheerspunten CCP 1/2/3: risicoklasse, stabiliteit, vrijgave-oordeel, sluitcontrole, allergenenvergelijking, afwijkingen
│   │   ├── afvulsessie.ts  # Afvulsessie: lotcode L<batch>-B<n>, THT per klasse, sessie-blokkades
│   │   ├── agp.ts          # Verplaatsen/uitslaan uit de AGP (verplaatsing + accijns), uitslag op
│   │   │                   # productniveau (FEFO) en `bouwUitslagBoekingen` (gedeeld door kassa en
│   │   │                   # bestellingen); `verkoopUitAgpToegestaan` = de regel "verkoop nooit
│   │   │                   # rechtstreeks uit de AGP, behalve export/intra-EU". Eén accijnswaardering
│   │   │                   # van wat er ligt (`accijnsWaardeVoorraad`: de bevroren voorcalculatie van de
│   │   │                   # afvulling, anders `geschat` tegen het tarief van de peildatum) voor AGP-stand,
│   │   │                   # Verloop én Tellingen — boekt niets; `agpWaardeOpDag`/`gemAgpWaardeInPeriode`
│   │   │                   # (de gemiddelden op de tegel), `uitgeslagenAccijnsStatus` (betaald/open uit de
│   │   │                   # echte accijnsrecords, niet meer altijd "betaald"), `filterVerplaatsingen`
│   │   ├── uitlevering.ts  # Verkoop → uitleveringen (kassa én bestellingen): vrije voorraad eerst,
│   │   │                   # nooit uit de AGP (behalve export/intra-EU), nooit accijns.
│   │   │                   # `bouwPickTerugdraaiing`: picks van een nog niet verzonden order
│   │   │                   # terugdraaien (annuleren, "Picks terugdraaien") — uitleveringen
│   │   │                   # vervallen, picks worden concept, tegenregel `verkoop` met negatieve
│   │   │                   # hoeveelheid; `orderUitgeleverd` blokkeert opnieuw picken
│   │   ├── statiegeld.ts   # Statiegeldregels op de orderfactuur (SND/fust, 0% BTW) — nooit bij een
│   │   │                   # webshoporder: daar zijn de WooCommerce-bedragen leidend
│   │   ├── beschikbaarheid.ts # Wat er van een afvulling nog vrij is na open picks (totaal: afgevuld −
│   │   │                   # picks − uitgeleverd − afgeboekt; per locatie). Een pick zonder
│   │   │                   # bronlocatie legt eerst vrije voorraad vast, net als de uitlevering —
│   │   │                   # alleen de rest telt op de AGP. Gedeeld door kassa, bestellingen,
│   │   │                   # producten en `agpGereserveerdPerAfvulling` (kassa.ts)
│   │   ├── trace.ts        # Traceerbaarheid & recall (hoofdstuk 11): één stap terug/vooruit, massabalans, traceergaten, traceeroefening
│   │   ├── merch.ts        # Merch-artikelen: herkenning op SKU/naam (onthouden vanuit een orderregel) + eigen voorraad (mutaties, tekorten, waardering) voor merch die je zélf op voorraad hebt
│   │   ├── sku.ts          # SKU-identiteit: één SKU hoort bij één artikel. Spoort dubbele
│   │   │                   # artikelnummers op (formulier weigert ze, lijst toont ze) en
│   │   │                   # brengt een orderregel bij het juiste product — bij een SKU die
│   │   │                   # aan twee bieren hangt beslist de biernaam. Gedeeld door de
│   │   │                   # picking (`orderProductId`), de reserveringen
│   │   │                   # (`gereserveerdVoorArtikel`) en de productenpagina
│   │   ├── wcProduct.ts    # WooCommerce-productkaart per artikel: payload bouwen (lege velden gaan
│   │   │                   # nooit mee — een push wist niets), winkelantwoord lezen, verschillen
│   │   │                   # app ↔ winkel, prijsomrekening excl./incl. BTW, categorieënboom
│   │   ├── batchRapport.ts # Batchdossier (vanaf Brouwen te openen; `batchIsAfgerond` =
│   │   │                   # Afgevuld/Verpakt/Gesloten markeert het definitieve dossier, een
│   │   │                   # eerder dossier noemt de fase): kerncijfers, tijdlijn,
│   │   │                   # ingrediënten mét leverancierslot, metingen, CCP 1/2/3,
│   │   │                   # afvullingen, verlies, afwijkingen, kostprijs. Rekent zelf
│   │   │                   # niets uit wat een scherm al toont — het leent de bestaande
│   │   │                   # afleidingen, anders krijgt het dossier eigen getallen.
│   │   │                   # Geeft i18n-sleutels terug; opmaak in
│   │   │                   # `components/BatchRapportExport.tsx`
│   │   ├── pdfPaginering.ts # Waar een lang document geknipt mag worden: `paginaIndeling`
│   │   │                   # houdt blokken (tabelrijen, kaarten) heel en laat een kopje
│   │   │                   # niet als weesregel achter. Gebruikt door `pdf.ts`
│   │   ├── batchStats.ts   # Wat de batches over een bier zeggen: aantal, gebrouwen liters,
│   │   │                   # gemeten ABV/OG/FG/kleur/rendement/kostprijs-per-liter (gemiddelde,
│   │   │                   # spreiding, trend t.o.v. de vorige brouw, reeks voor een lijntje) en
│   │   │                   # of de vastgelegde bierinformatie daarvan afwijkt
│   │   ├── brouwKosten.ts  # Vaste kosten van een brouwdag (elektra, water, schoonmaak,
│   │   │                   # overig): gemiddelde uit de eigen batches, anders uit de
│   │   │                   # inkoopfacturen met de bijbehorende kostensoort over dezelfde
│   │   │                   # periode, anders handmatig. **Elke nieuwe bron voor deze
│   │   │                   # kosten hoort hier** — zie "Afgeleide kosten" hieronder
│   │   ├── verpakkingKosten.ts # Kostprijs van één verpakte eenheid (onderdelen, anders de
│   │   │                   # losse velden) — de enige implementatie, ook gebruikt door
│   │   │                   # `berekenBatchKostprijs` en de pagina's — plus de verpakkingsmix
│   │   │                   # per liter uit de eigen afvullingen (anders die van de hele
│   │   │                   # brouwerij) en `referentieVerpakking`: de 33 cl-fles waarmee de
│   │   │                   # receptvoorcalculatie rekent (mix = terugval)
│   │   ├── receptKostprijs.ts # Voorcalculatie bij het recept: prijs per ingrediënt uit de lots
│   │   │                   # (gewogen gemiddelde van wat er ligt, anders de laatste inkoop),
│   │   │                   # gemiddeld verlies uit de eigen brouwhistorie (vergist versus
│   │   │                   # afgevuld, gewogen op liters; anders de verliesposten, anders 8%),
│   │   │                   # verpakking over de liters ná verlies, en de kostprijs per
│   │   │                   # brouwzaalliter, per verkoopbare liter én per verpakte eenheid
│   │   │                   # (`kostprijsPerEenheid`: bier per liter + de échte verpakkingsprijs
│   │   │                   # van díe eenheid; het recept rekent op de 33 cl-fles). `receptAccijns`
│   │   │                   # geeft de accijns per liter uit ABV/Plato + tarief — apart van
│   │   │                   # `totaal`, want die schuld ontstaat pas bij uitslag
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
│   │   ├── adres.ts        # Straat + huisnummer uit een WooCommerce-order: losse velden van een
│   │   │                   # NL-checkoutplugin (`_billing_house_number`/`_suffix`/`_street_name`)
│   │   │                   # eerst, anders `address_1` gesplitst; `address_2` achter het nummer
│   │   ├── wcOrderImport.ts # WooCommerce-orderimport (ophalen, order → bestelling, bekende orders
│   │   │                   # verversen, dedup bij toepassen, lease voor de automatische import) —
│   │   │                   # gedeeld door de bestellingenknop en de periodieke import in App.tsx
│   │   ├── websiteTelemetrie.ts # Website-telemetrie (plugin Craftery Brouwerij): opslagvorm
│   │   │                   # `website_telemetrie`, standaard alles uit, foutcode → i18n,
│   │   │                   # houdbaarheidswaarschuwing. Het bericht zelf bouwt server.py
│   │   │                   # (`_website_bericht`), ook voor het voorbeeld in de app.
│   │   │                   # UI: components/WebsiteTelemetrie.tsx
│   │   ├── wcTerugschrijven.ts # Orderstatus terug naar WooCommerce (completed/cancelled + privé-
│   │   │                   # notitie); annuleren alleen zolang er niets is uitgeslagen (voorraad)
│   │   ├── levering.ts     # Afhalen of verzenden per bestelling: uit de WooCommerce-verzendregel
│   │   │                   # (`local_pickup`/`pickup_location` = afhalen) + het afhaalmoment en de
│   │   │                   # afhaalpagina van het Craftery-thema (`?afhaalmoment=<id>&sleutel=<order_key>`),
│   │   │                   # bij elke import ververst; mailvariabelen `{levering}` (bestelbevestiging),
│   │   │                   # `{trackregel}` (verzendbevestiging bij "Markeer verzonden") en
│   │   │                   # `{afhaalregel}` (afspraak-gemist-mail: moment voorbij, order nog open);
│   │   │                   # de afhaalpagina-link zelf komt als knop onder de mail (`afhaalMailKnop`:
│   │   │                   # kiezen/verzetten, `afhaalGemistMailKnop`: nieuw moment) — `MailKnop`;
│   │   │                   # `bestelPaginaLink` = link naar de bestelling in de webshop, bij de import
│   │   │                   # per order bepaald (`wc_bestel_url`): klant met account → Mijn account via
│   │   │                   # pagina-ID (`?page_id=8&view-order=<id>`, slug-onafhankelijk), gast → de
│   │   │                   # bedankpagina met ordersleutel (uit `payment_url`, anders afreken-pagina-ID);
│   │   │                   # pagina-ID's/slugs uit `settings/advanced` (`leesWcPaginas`). `bestelLink` =
│   │   │                   # knop "Bekijk je bestelling": sjabloon `woocommerce_creds.bestelUrl`, anders
│   │   │                   # `wc_bestel_url`; anders géén knop (geen gok)
│   │   ├── bierKleur.ts    # EBC → bierkleur (één tabel voor tank-SVG, productlijst, kassa,
│   │   │                   # orderregels, tankkaarten): `productEbc`/`batchEbc` (eigen veld →
│   │   │                   # product → recept), `tekstKleurOp`. Component: ui/BierKleur.tsx
│   │   ├── beslissingen.ts # Administratie-dashboard: één rij per ding dat je afhandelt (elke vervallen
│   │   │                   # verkoop-/achterstallige inkoopfactuur, elke open BTW-periode, elke open
│   │   │                   # accijnsmaand, elke rekening waarvan het laatste afschrift niet aansluit;
│   │   │                   # het postvak en de te koppelen banktransacties elk één rij). Per rij `soort`,
│   │   │                   # urgentie (te_laat/klopt_niet/wacht_op_jou/deadline; een BTW-periode of
│   │   │                   # accijnsmaand voorbij zijn uiterste datum = te_laat), bedrag, actie en een
│   │   │                   # doel dat het ding zelf opent (factuur-`id`, periodesleutel, maand). Uit de
│   │   │                   # bestaande selecties in facturen/btw/calculations/bank/factuurFilter — nooit
│   │   │                   # een eigen sommetje. `overzichtCijfers`: de vier tegels met dezelfde filter-
│   │   │                   # en totaalfuncties als Facturen; `beslissingenPerPagina`
│   │   ├── attentie.ts     # Attentieposten per werkruimte (badge op de werkruimte-knop + de
│   │   │                   # "Vraagt om aandacht"-lijst op de dashboards): per post een id,
│   │   │                   # i18n-sleutel, aantal en navigatiedoel (pagina + tab/filter/`id`/`actie`). De
│   │   │                   # tellingen zelf leven in taken/calculations/picking/btw/facturen —
│   │   │                   # een nieuw aandachtspunt = een post hier, nooit een los sommetje in
│   │   │                   # App.tsx of een dashboard. Administratie = `adminPosten(beslissingen)`:
│   │   │                   # de rijen per soort gebundeld, dus werkruimte-badge = aantal dashboardrijen
│   │   │                   # = som van de menubadges; wijst een post één rij aan, dan neemt hij dat doel
│   │   ├── facturen.ts     # Vervallen verkoopfacturen (factuurdatum + betalingstermijn klant →
│   │   │                   # brouwerij → 14 dagen, dagen te laat) en achterstallige
│   │   │                   # inkoopfacturen (onbetaald > `INKOOP_ACHTERSTALLIG_DAGEN`); gedeeld
│   │   │                   # door de badge, het Administratie-dashboard, Facturen en Rapporten.
│   │   │                   # `isVerkoopFactuurOpen` is dé definitie van "open" (geen creditnota's) —
│   │   │                   # ook voor debiteuren op de balans en de openstaande posten.
│   │   │                   # `breweryMetTermijn`/`vervaldatumTekst`: geef díe mee aan élke
│   │   │                   # factuur-, herinnerings- en mailopbouw (Facturen, Bestellingen,
│   │   │                   # kassa) — nooit een eigen `?? 14`, anders noemt het document een
│   │   │                   # andere vervaldatum dan de badge
│   │   ├── orderFactuur.ts # De verkoopfactuur van een bestelling (`bouwOrderFactuur`: afronden, "Factuur maken"
│   │   │                   # en Bank) en de creditnota bij annuleren (`bouwCreditnota`). Een betaalde webshoporder
│   │   │                   # kan zijn factuur al vóór het ophalen of verzenden krijgen (`voorafFactuurBlokkade`:
│   │   │                   # betaald, niet afgebroken, nog geen factuur — picken hoeft niet); afronden maakt dan
│   │   │                   # geen tweede en de regels liggen vast. `orderFactuurVan` (via `factuur_id`, anders
│   │   │                   # `bestelling_id`), `teFacturerenUitVerslag` (bestellingen zonder factuur in een
│   │   │                   # PSP-uitbetaling: uitkomst `geen_factuur` van `koppelPspVerslag`)
│   │   ├── factuurFilter.ts # Filterregels van Facturen: status (`open`/`te_laat`/`betaald`/`credit`/
│   │   │                   # `alles`, Inkoop ook `te_verwerken` = het postvak), `periodeGeldtVoorStatus`
│   │   │                   # (niet bij Open/Te laat/Te verwerken), zoeken (`zoekPast`: nummer, relatie,
│   │   │                   # omschrijving, bedrag — "496,10" vindt € 496,10), klant/leverancier,
│   │   │                   # chiptellingen en de totaalregel in centen; `leesFactuurFilter` leest
│   │   │                   # `navDoel.filter` (status, `klant:<id>`, `leverancier:<naam>`). Hergebruikt de
│   │   │                   # selecties van `facturen.ts` letterlijk — geen tweede definitie van "open"
│   │   ├── factuurTijdlijn.ts # Het factuurdetail: statuspil (`verkoopStand`/`inkoopStand`), volgende
│   │   │                   # herinnering, de ene handeling die bij de stand past (`verkoopPrimaireActie`),
│   │   │                   # de bijschrijving uit `bank_koppelingen` (ook binnen een PSP-uitbetaling,
│   │   │                   # `bankBetalingVoor`) en de tijdlijn "Gebeurd" (`verkoopTijdlijn`)
│   │   ├── klantFacturen.ts # Welke verkoopfacturen bij een klant horen (live klantkaart, ook via het
│   │   │                   # e-mailadres — dezelfde regel als de filter `klant:<id>`) en welke klanten
│   │   │                   # een écht vervallen factuur hebben (de oranje stip op Verkoop › Klanten)
│   │   ├── periode.ts      # Eén periodekeuze voor de administratie (deze/vorige maand, dit/vorig kwartaal,
│   │   │                   # dit/vorig jaar, alles, eigen datums): `periodeBereik` (hele kalenderperiodes,
│   │   │                   # lokale dagen — nooit `toISOString()`), `inBereik`, `begrensOpVandaag` +
│   │   │                   # `vergelijkBereik` (dezelfde dagen vorig jaar); teksten als i18n-sleutel.
│   │   │                   # UI: `ui/PeriodeKiezer`, gedeelde stand `ui/useGedeeldePeriode`
│   │   ├── bank.ts         # MT940 (`parseMT940`, ook begin-/einddatum), matching (`besteMatch`,
│   │   │                   # PSP-kandidaten), `saldoControle`, `txKey` (de enige definitie: sleutel van
│   │   │                   # `bank_koppelingen`). Bewaarde afschriften: `bouwBankImport` (samenvoegen
│   │   │                   # zonder dubbelen, geteld per txKey), `herstelKoppelingVlaggen` (de gekoppeld*-
│   │   │                   # vlaggen altijd opnieuw uit `bank_koppelingen`), `vorigEindsaldoVoor`
│   │   │                   # (aansluiting live uit de afschriften; overlap = geen aansluiting),
│   │   │                   # `verwijderAfschrift` + `bankSaldiNaVerwijderen`; werklijst:
│   │   │                   # `filterBankTransacties`/`telBankStatussen` (Te koppelen negeert de periode),
│   │   │                   # `koppelingVan`, `standaardBankStatus`
│   │   ├── bankVoorstel.ts # Bank als wachtrij: hooguit één koppelvoorstel per transactie, met de reden
│   │   │                   # (i18n-sleutel). Facturen via `besteMatch` mét datumgrens (factuur hooguit
│   │   │                   # `VOORSTEL_MAX_DAGEN_VOORUIT` = 7 dagen ná de betaling, ERP-plan F11); ambigu
│   │   │                   # of storno = geen voorstel; PSP-uitbetaling; ingediende BTW/accijns op € 1
│   │   │                   # (`AANGIFTE_MARGE_CENT`), teken klopt, niet van vóór de periode. Kiezers:
│   │   │                   # `factuurKiezerKandidaten` (een open factuur die al aan een andere transactie
│   │   │                   # hangt staat onderaan: deelbetaling), `btw-`/`accijnsKiezerKandidaten`.
│   │   │                   # `besteMatchBinnenDatum` = die datumgrens, gedeeld met de import
│   │   ├── bankImportKoppeling.ts # Automatische koppeling bij het inlezen (`autoKoppelImport`): een koppeling uit
│   │   │                   # `bank_koppelingen` komt terug, nooit een storno, facturen via `besteMatchBinnenDatum`
│   │   │                   # (zelfde datumgrens als het voorstel), BTW/accijns op ± € 1, PSP alleen als voorstel
│   │   ├── pspVerslag.ts   # Het uitbetalingsverslag van Mollie e.d. (PDF, tekstlaag via pdf.js): `leesPspVerslag`
│   │   │                   # (regels: datum, methode, bedragen, omschrijving, consument; soort betaling/
│   │   │                   # terugbetaling/kosten/compensatie/overig; kenmerk + totaal) en `koppelPspVerslag`
│   │   │                   # (factuur via `wc_order_nummer` → `bestelling_id` of het factuurnummer van de
│   │   │                   # betaallink; terugstorting in hetzelfde verslag = netto nul, anders de creditnota;
│   │   │                   # kosten per factuur van de PSP via `verslagKosten`; een betaling van een bestelling
│   │   │                   # zonder factuur = `geen_factuur` met `bestellingId`). Koppelt zelf niets
│   │   ├── pspVerslagScan.ts # Terugval voor wat de tekstlaag niet levert (scan, foto's, andere PSP of
│   │   │                   # opmaak): schema + prompt voor Claude, die alleen de tabel overschrijft — zonder
│   │   │                   # consument en zonder het uitbetaalde bedrag (de optelcontrole blijft echt);
│   │   │                   # `normaliseerVerslagScan` duidt de regels met dezelfde `verslagRegel` als de
│   │   │                   # tekstlaag, `verslagInvoer` (eerste PDF, anders hooguit tien foto's)
│   │   ├── pspUitbetaling.ts # De kosten van een PSP-uitbetaling verrekenen met de factuur van de PSP:
│   │   │                   # `kostenCent`/`kostenVerrekend` op de koppeling, open kosten ("factuur volgt"),
│   │   │                   # `pspVerrekeningenVoor` (factuur → uitbetalingen), `inkoopNaVerrekening` (helemaal
│   │   │                   # gedekt = betaald, `betaald_door_verrekening`), `verrekenKandidaten` (het verslag
│   │   │                   # noemt het nummer = voorgesteld), `pasPspVerrekeningToe` (een oude kostenpost
│   │   │                   # vervalt), `kostenFactuurKandidaten`, `pspKostenRegels`, `verslagInfo` (las Claude
│   │   │                   # het verslag, dan ook de regels, `bron`, `model`) + `verslagUitInfo` (terug)
│   │   ├── aangifteStappen.ts # BTW en accijns in hetzelfde ritme: Lopend → Berekend → Gecontroleerd →
│   │   │                   # Ingediend → Betaald (of Terugontvangen; € 0 ingediend = Nihil). Per periode de
│   │   │                   # stap, het bedrag met teken (centen), de uiterste datum, de ene volgende
│   │   │                   # handeling en de teksten; `btwPeriodeCijfers` (de rubrieken), de vier-ogen-
│   │   │                   # controle (`btwControleRecord`/`metBtwControle` op de periodesleutel,
│   │   │                   # `controleBlokkade`, `zelfdePersoon`), `betalingKandidaten` uit de bewaarde
│   │   │                   # afschriften, `leesAangifteDoel`. "Vraagt actie" = de badgeregel
│   │   │                   # (`telOpenstaandeBtwPerioden`, `openAccijnsMaanden`) — een test bewaakt dat
│   │   ├── sndAfdracht.ts  # SNd-statiegeld per periode + afdrachtstatus uit de bankkoppeling
│   │   │                   # `{soort:'snd', periodeKey}` (Statiegeld-pagina, Bank).
│   │   │                   # Een webshopfactuur draagt geen statiegeldregel; geef `{bestellingen,
│   │   │                   # verpakkingen}` mee, dan tellen de SND-stuks uit de orderregels
│   │   │                   # (`statiegeldVanOrder`) — anders valt de afdracht te laag uit
│   │   ├── btwCategorie.ts # BTW-categoriecodes (UNCL5305) voor e-facturatie: afleiding uit tarief + land + BTW-nummer, VATEX-codes, EU-landenlijst, landkeuzelijst
│   │   ├── template.ts     # Mustache-subset renderer ({{waarde}}, {{{ruw}}}, {{#sectie}}, {{^omgekeerd}}) — documentlayouts als data
│   │   ├── factuurTemplate.ts # Standaard factuurlayout + contextbouwer; eigen layout via brewery_details.factuur_template, bij een fout stille terugval
│   │   ├── factuurMail.ts  # Welke mailtekst bij een verkoopfactuur: `factuur` (open) of `factuur_betaald`
│   │   │                   # (al voldaan — webshoporder betaald in WooCommerce, kassa, vinkje) + de
│   │   │                   # betaalvariabelen {betaalregel}/{betaaldatum}/{betaalwijze}; gedeeld door
│   │   │                   # Facturen en de bestellingenpagina
│   │   ├── mollieLink.ts   # Eén Mollie-betaallink per verkoopfactuur (`mollie_link`), hergebruikt door elke volgende mail
│   │   ├── ubl.ts          # E-factuur in UBL 2.1 / PEPPOL BIS Billing 3.0: cent-exact, multi-tarief TaxSubtotals, kortingen als AllowanceCharge, creditnota als CreditNote-document
│   │   ├── csv.ts          # CSV-export: `csvCel`/`csvRij`/`csvTekst` zijn formule-veilig (apostrof vóór = + - @ tab/CR,
│   │   │                   # een getal blijft een getal) — gebruik ze voor élke CSV-export, nooit eigen quoting;
│   │   │                   # `inkoopRegelExport` leest de kolommen van een inkoopregel (ook oude boekingen)
│   │   ├── inkoopOntvangst.ts # Inkoopformulier → lots + ontvangst-log, onderdelenvoorraad, factuurregels en
│   │   │                   # merch-inkopen; gedeeld door de gewone inkoopfactuur, de boeking vanuit de bank én
│   │   │                   # de ontvangst op de ingrediëntenpagina. Een productregel met `lots` wordt één lot
│   │   │                   # per lotnummer; `etiket_fotos` komen op elk lot van die regel
│   │   ├── inkoopRegels.ts # Eén regel van het inkoopformulier, elke soort (ingrediënt/verpakkingsmateriaal/
│   │   │                   # overig): hoeveelheid ↔ prijs ↔ bedrag (excl./incl.), soort wisselen, meer lots per
│   │   │                   # regel (`DeelLot`, verdelen, som bewaken), controle per regel (i18n-sleutels),
│   │   │                   # totalen in centen zoals geboekt, `naarOpslag`/`vanFactuur` (de oude drie lijsten),
│   │   │                   # `laatsteInkoop` (prijs/eenheid/leverancier van het vorige lot)
│   │   ├── claudeScan.ts   # Eén aanroep van Claude voor alle scans (factuur, etiket, waterrapport):
│   │   │                   # gestructureerde uitvoer (`output_config.format`), geen temperature, modelketen
│   │   │                   # `SCAN_MODELLEN` (terugval alleen als een model niet beschikbaar is) + server-side
│   │   │                   # `fallbacks: "default"`, `ScanFout` bij afgekapt/geweigerd/leeg/onleesbaar
│   │   ├── factuurScan.ts  # Schema + prompt van de factuurscan (alles verplicht, "leeg" = "" of 0), PDF als
│   │   │                   # document of foto's als pagina's (`factuurScanModus`), opschonen, regels verdelen
│   │   │                   # (`regelsUitScan`: geheugen eerst, "overig" blijft overig, NL-tarief bij verlegd)
│   │   ├── etiketScan.ts   # Etiketfoto's (meer foto's per regel, één verzoek) → lotnummer(s), THT, eigenschappen;
│   │   │                   # `pasEtiketToe` (invoer van de gebruiker blijft staan), `lotsVoorRegel` (hoeveelheid
│   │   │                   # verdelen over de lots), `etiketVoorLot` (bestaand lot), `productKlopt`
│   │   ├── scanGeheugen.ts # Het scangeheugen (`scan_correcties`): per leverancier + artikelnummer of omschrijving
│   │   │                   # hoe een regel geboekt is; geleerd bij elk opslaan (`koppelingenUitRegels`)
│   │   ├── inkoopControle.ts # Totaal tegen de factuur (of de afschrijving), "Neem over" → correctieregel,
│   │   │                   # handmatige totalen (`effectieveTotalen`, `naarTotaalManual`), dubbele factuur
│   │   ├── afbeelding.ts   # Foto → JPEG op maat (scan 2576 px, archief 1600 px; HEIC alleen in Safari) en
│   │   │                   # factuurfoto's samen als één PDF-bijlage (jsPDF)
│   │   ├── pdfZoek.ts      # Waar staat een factuurregel in de PDF (tekstlaag per regel, bedrag weegt mee)
│   │   ├── inkoopInbox.ts  # Facturen per e-mail: opslagvorm van `inkoop_inbox`/`inkoop_inbox_status`/`imap_creds`,
│   │   │                   # de pure handelingen op de wachtrij (verwerkt, genegeerd, terugzetten, factuur verwijderd,
│   │   │                   # definitief verwijderen), foutcodes en redenen → i18n en het afzenderfilter (spiegel van
│   │   │                   # `_inbox_afzenders`). De server haalt de PDF's op (`_inbox_tick`); er wordt nooit iets
│   │   │                   # geboekt zonder dat iemand het item opent, de scan nakijkt en de factuur opslaat
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

### De schil (navigatie) — v1.12.96

Eén schil, één omslagpunt (768 px). Het **hoofdmenu** zijn de drie
werkruimtes, het **tweede menu** de pagina's van de gekozen werkruimte.

- **Bureau:** `Rail` (84 px links: werkruimtes, onderaan Instellingen +
  `SyncDot`) en `PaginaNav variant="tabs"` in een witte bovenbalk. Bewust
  géén tekstkolom van 216 px: de pagina's zijn brede tabellen.
- **Telefoon:** `Onderbalk` (Productie · Verkoop · **Meten** · Admin · Meer;
  vast, hooguit vijf vakjes, attentie als stip) en `Kopbalk` met
  `PaginaNav variant="chips"` eronder. Een subscherm (Instellingen, batch als
  eigen pagina) krijgt een terugknop; een detailscherm (`isDetailRoute`)
  géén onderbalk. `MeerPage` = wie je bent, verbinding, Instellingen,
  Uitloggen.
- **Hash-routing** (`utils/route.ts`): `#/<werkruimte>/<pagina>[/<id of stand>]`;
  `PAGINA_WERKRUIMTE` staat dáár. Een batch is altijd zijn eigen pagina
  (`#/productie/batches/<id>`, ook vanaf een tankkaart; er is geen paneel onder
  de tanks meer); `#/productie/batches/lopend|gesloten|agenda` is de stand van
  de lijst. Recepten, producten en bestellingen hebben een `recordId`
  (`#/productie/recepten/<id>`, `#/verkoop/producten/<id>`,
  `#/verkoop/bestellingen/<id>`; encodeURIComponent, een kapotte encoding = geen
  record). Oude links blijven werken (`PAGINA_ALIAS`: `batchflow` → `batches`,
  `dashboard/<n>` → `batches/<n>`, `planning` → `batches/agenda`, en de oude
  administratiepagina's — zie hieronder).
  State → hash is een history-entry (met een markering in `history.state`,
  `historieStap`), hash → state via `hashchange`/`popstate`; nooit zelf
  `location.hash` zetten in een pagina — navigeer via **`gaNaar(doel)`** (prop
  vanuit App.tsx; `{pagina, id?, tab?, filter?, lotId?, stand?, actie?}` →
  eerst `resolveerDoel`, dan `doelNaarRoute`), ook voor een sprong naar een
  andere werkruimte, voor attentieposten en voor de rijen van het
  Administratie-dashboard. Het `id` van een batch, recept, product of
  bestelling gaat in de route; tab, filter, lot, `actie` en het `id` van een
  pagina zonder eigen route (een factuur, een klant) gaan als eenmalig
  navigatiedoel naar de pagina. Oudere pagina's en die van Administratie
  krijgen dezelfde functie onder de prop-naam `gaNaarDoel`.
- **Tabs:** Productie = Brouwzaal (`dashboard`) · Batches · Recepten ·
  Ingrediënten · HACCP · Gereedschap; Verkoop = Overzicht (`dashboard`) ·
  Producten · Bestellingen · Kassa · Klanten · Statiegeld; Administratie =
  Facturen · Bank · Aangiftes · Voorraad · Rapporten (het dashboard is het
  startpunt van de werkruimte). De werkruimtetitel in de bovenbalk is een
  gewoon label.
- **Detailscherm** (`isDetailRoute`: batch of record): op de telefoon geen
  onderbalk en geen chips; de kopbalk toont de naam (`detailTitel`) met één
  terugknop (`history.back()` als de vorige entry van de app zelf is, anders de
  lijst). Een pagina heeft dan geen tweede terugweg; de volgende stap staat in
  een vaste `ActieBalk` onderin.
- **Maten:** `--kopbalk`, `--onderbalk` (incl. `--safe-top`/`--safe-bottom`,
  alleen in standalone-modus op `env()`), `--kb-inset`; toetsenbord open =
  `body.kb-open` (`components/ui/toetsenbord.ts`). Elke vaste actiebalk
  rekent met `var(--onderbalk)`; `.schil-inhoud` houdt de ruimte onderaan.
- **Themacontrast:** `--t-accent-text`/`--t-accent-edge` uit
  `utils/kleurContrast.ts` — gebruik die (via `.t-accent-text`) voor het
  accent als tekst of rand, nooit `--t-accent` rechtstreeks op wit.
- De "Nu actief"-strook blijft in de schil (lichte strook onder de
  bovenbalk), want tankalarmen horen op élk scherm zichtbaar te zijn.

#### Administratie (v1.12.89/90)

- **Tweede menu:** Facturen · Bank · Aangiftes · Voorraad · Rapporten, met het
  dashboard (Overzicht) als startpunt. Daaronder hooguit één segment
  (Verkoop | Inkoop, BTW | Accijns, AGP-stand | Verloop | Tellingen) — nooit
  een derde menulaag; de rest opent als detail. Klanten staan alleen in
  Verkoop › Klanten.
- **Oude id's:** `boekhouding` (met een oud tabblad), `agp`, `inventarisatie`
  en `voorraadverloop` bestaan niet meer als pagina. `PAGINA_ALIAS` (in
  `parseRoute`, een oude hash wordt herschreven) en `resolveerDoel` (in
  `gaNaar`, dus ook `setPage`) sturen ze naar de nieuwe plek mét het segment.
  Nieuwe code navigeert nooit naar een oude id.
- **Navigatiedoel** (`AttentieDoel`: `{pagina, tab?, filter?, id?, actie?}`,
  via `gaNaar` — bij deze pagina's de prop `gaNaarDoel`). Elke pagina leest het alleen in haar beginstand en meldt
  het daarna verwerkt (`onNavDoelConsumed`); naar dezelfde pagina navigeren
  verhoogt `navNonce`, dus de pagina mount opnieuw. Wat er geldt:

  | Pagina | `tab` | `filter` | `id` | `actie` |
  |---|---|---|---|---|
  | `facturen` | `verkoop`/`inkoop` (zonder: Inkoop bij `te_verwerken` of een leverancier) | `open`, `te_laat`, `betaald`, `credit`, `alles`, `te_verwerken`, `klant:<id>`, `leverancier:<naam>` | die factuur in het detail; valt hij buiten de filter, dan gaan status en gedeelde periode naar Alles | `nieuw` (losse factuur / inkoop boeken) |
  | `bank` | — | `te_koppelen`, `gekoppeld`, `alles` (zonder: Te koppelen als daar iets staat) | — | `importeren` (bestandskiezer) |
  | `aangiftes` | `btw`/`accijns` | periodesleutel `2026-Q3`/`2026-M09` (ander periodetype → de periode waar hij in valt) of accijnsmaand `2026-09` (zonder tab = Accijns): die periode open, jaar volgt | — | — |
  | `rapporten` | `wv`, `marge`, `balans`, `openstaand`, `omzet`, `journaal` (oud: `ouderdom`, `omzet_cat`, `transacties`; ook in `filter`) | een dagboek (`alle`, `verkoop`, `inkoop`, `accijns`, `btw`, `memoriaal`, `kapitaal`) zet het journaalfilter (open het journaal met `tab: 'journaal'`) | — | — |
  | `voorraad` | `agp`, `verloop`, `tellingen` | — | — | — |
  | `klanten` | — | — | die klant | — |

  Een link wijst het ding zelf aan (de factuur, de periode, de maand), niet
  alleen het tabblad. De periode zet je vóór de navigatie met
  `zetGedeeldePeriode` (dashboardtegel "deze maand", "Facturen van deze
  klant" → alles).
- **Eén getal:** de badge op het Admin-icoon = het aantal rijen op het
  dashboard = de som van de menubadges (Facturen, Bank, Aangiftes). App
  rekent de rijen één keer uit (`adminRijen` = `beslissingen()`) en geeft ze
  aan het dashboard én aan `attentiePosten` (`adminPosten`). Eén rij per ding
  dat je afhandelt: per vervallen verkoop- of achterstallige inkoopfactuur, per open BTW-periode, per open
  accijnsmaand, per rekening met een aansluitverschil; een wachtrij (postvak,
  te koppelen banktransacties) is één rij. Een nieuw aandachtspunt in
  Administratie is een rij in `beslissingen.ts` — nooit een losse telling op
  een menu-item.

### Frontend → Backend communication

- All HTTP via `/api/` prefix
- `src/utils/api.ts` — central fetch abstraction (`_postToServer`, `useStore` hook)
- `useStore(key)` — localStorage-cached, server-synced state per data key
- Delta-sync (ERP 4.3): saves van array-keys gaan waar mogelijk als
  record-delta naar `POST /api/delta/<key>` (pure logica in
  `src/utils/delta.ts`); bij herordening, records zonder id of een oude
  server valt de client stil terug op de volledige POST
- Conflict-samenvoeging: het versieslot van de optimistic locking zit op de
  hele key, terwijl een 409 bijna altijd over een ánder record gaat (de
  servertick schrijft zelf in `batches`/`gist_metingen` — en verwijdert daar
  ook oude automatische metingen — en een tweede tab of
  de telefoon schrijft ook mee). `_losConflictOp` in `api.ts` haalt daarom de
  verse serverstand op en legt de eigen wijziging er per record overheen
  (pure logica in `src/utils/merge.ts`, werkt op arrays met `id` én op
  objecten). Alleen wanneer hetzelfde record aan beide kanten anders werd
  wint de server en volgt een melding; een enkele waarde (thema, appnaam,
  ingeklapt-stand) wordt stil opnieuw weggeschreven. **Een conflict is dus
  geen reden meer om de invoer van de gebruiker weg te gooien** — houd dat zo
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
| PDF | pdfjs-dist 3.11.174 (lezen, factuur-scan, tekenen in het inkoopwerkblad); jsPDF 3 + html2canvas (genereren — mail-bijlagen, het batchdossier, factuurfoto's als één PDF) |
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
velden, stapelen per niveau, ingrediëntenlijst uit het recept), de
batchsamenvatting bij een product + de vertaling
naar het webshopthema, de receptvoorcalculatie (ingrediëntprijs uit de lots,
gemiddeld verlies, verpakking, kostprijs per liter), de afgeleide brouwkosten
(gemeten batches → inkoopfacturen → handmatig, schaling naar batchgrootte), de
verpakkingskosten (prijs per eenheid uit de onderdelen, mix uit de eigen
afvullingen), de
templaterenderer + factuurlayout, de Excel-backup-round-trip, de
tanktemperatuurbewaking (incl. het werkelijke setpoint van
de koeling) en de HACCP-beheerspunten
(risicoclassificatie, stabiliteit, vrijgave-oordeel, sluitcontrole,
allergenenvergelijking, lotcode en THT), de traceerbaarheid
(één stap terug/vooruit, massabalans, traceergaten, oefeningstatus) en de
conflict-samenvoeging (`merge.ts` + het 409-pad van `api.ts`), de hash-routing
van de schil (`route.ts`), het themacontrast (`kleurContrast.ts`, alle zeven
thema's), de undo-planner (`undo.ts`), het batchdossier (`batchRapport.ts`:
afbakening op de batch, kerncijfers, traceerregels, CCP-registraties,
kostprijs), de pagina-indeling van de PDF-export (`pdfPaginering.ts`) en het
inkoopformulier: de regels (`inkoopRegels.ts`, ook meer lots per regel), de
scanhelper (`claudeScan.ts`: modelketen, geen temperature, foutcodes), de
factuur- en etiketscan (schema's binnen de grenzen van gestructureerde
uitvoer, opschonen, toepassen zonder invoer van de gebruiker te overschrijven),
het scangeheugen, de totaal- en dubbelecontrole, de foto-omzetting
(`afbeelding.ts`) en de regel-zoeker in de PDF (`pdfZoek.ts`).
De administratie (v1.12.89/90) heeft een eigen blok: de periodekeuze
(`periode.test.ts`), de factuurfilter (`factuurFilter.test.ts`: een vervallen
factuur van vorig jaar staat onder Te laat terwijl de periode "dit jaar" is, en
elk chipaantal is de lengte van de lijst eronder), het factuurdetail
(`factuurTijdlijn.test.ts`), de facturen per klant (`klantFacturen.test.ts`), de
bewaarde afschriften (`bankAfschriften.test.ts`: import zonder dubbelen, vlaggen
uit `bank_koppelingen`, aansluiting per afschrift, verwijderen +
`bank_saldi`), de bankwerklijst en de koppelvoorstellen
(`bankWerklijst.test.ts`, `bankVoorstel.test.ts`: datumgrens, ambigu, storno,
één factuur één betaling, deelbetaling in de kiezer), de automatische koppeling
bij het inlezen (`bankImportKoppeling.test.ts`: dezelfde datumgrens), het uitbetalingsverslag van Mollie (`pspVerslag.test.ts`: bedragen en datums in vijf talen, kolommen uit de kopregel, een streepje is geen minteken, terugstorting tegen betaling, creditnota, in twee keer betaald, kosten per factuur van de PSP), de terugval op Claude (`pspVerslagScan.test.ts`: schema binnen de grenzen en zonder consument, hetzelfde verslag en dezelfde koppeling als de tekstlaag, opschonen, kosten per transactie, bewaren en teruglezen), de factuur bij een bestelling (`orderFactuur.test.ts`: WooCommerce-bedragen cent-exact, betaald = betaald, vooraf factureren alleen als hij betaald is, creditnota precies min de factuur en het journaal valt weg, en de Mollie-uitbetaling die na de factuur vooraf wél uitsplitst) en de kostenverrekening (`pspUitbetaling.test.ts`: vier uitbetalingen dekken de factuur → betaald op de laatste dag, ontkoppelen → weer open, een eigen 'betaald' blijft staan, kostenpost vervalt, nooit meer dan de kosten), de aangiftestappen
(`aangifteStappen.test.ts`: de telling op het segment = die van de badge, in
kwartaal- én maandmodus; nihil; controlesleutel en migratie; navigatiedoel), de
kostensoort-herindeling (`kostensoortHerindeling.test.ts`: BTW per periode
gelijk en de W&V verschuift, de geboekte periode blijft ook bij een ander
periodetype of een rollover, nog een keer kan, journaal wijkt af = niets), de
rapporten (`rapporten.test.ts`: W&V telt op tot `nettowinst`, peildatum, open
en liquide middelen op een peildatum, openstaande posten, omzet per artikel,
journaalfilter) en `balans.test.ts` op een peildatum, de accijnswaardering van
de voorraad (`agpWaardering.test.ts`), de stapper van het voorraadverloop
(`voorraadverloopStapper.test.ts`), de tellingenfilters
(`inventarisatieFilter.test.ts`), de oude routes (`route.test.ts`), de plek
van het ⋯-menu (`menuPositie.test.ts`) en
beslissingen + attentie (`beslissingen.test.ts`, `attentie.test.ts`:
werkruimte-badge = aantal dashboardrijen = som van de menubadges, één rij per
BTW-periode en per accijnsmaand).
Ook de keten en het etiket (opzet Productie & Verkoop): `etiket.ts` (Balling-ABV,
energie in kcal/kJ met vaste testwaarden 1.050/1.010 → 46/194 … 1.090/1.018 →
85/354, de ABV-marge, Bevat-regel, versie-ophoging, `legEtiketVast`),
`productKeten.ts`, `batchKeten.ts`, `receptNaarBatch.ts` (karakteriseringstests
op het oude gedrag), `receptGebruik.ts`/`receptLijst.ts`, `verkoopOverzicht.ts`
(ook: dezelfde "vrij" als de kassa), `volgendeStap.ts`, `nieuweBatch.ts`,
`batchesLijst.ts`/`batchAgenda.ts`, `productPagina.ts`, `bestelling.ts`,
`kassaCatalogus.ts` en de routes (`route.ts`: aliassen, recordId, historie).
Testdata van de demo-brouwerij uit het opzet: `__tests__/demoBrouwerij.ts`.

`server.py` heeft een pytest-suite (ERP-plan 3.2) in `tests/test_server.py`:
key-/upload-validatie, schemavalidatie (422), append-only-guard (422),
optimistic locking (409), atomaire commits, atomaire nummerreeksen (ook
onder parallelle clients), rate-limiting (429), secrets-maskering, de
server-audit, de SQLite-opslaglaag (WAL, JSON-migratie, backup-export), de
HACCP-sluitcontrole-herinnering, de WooCommerce-ordercontrole (`_wc_orders_tick`:
nieuwe webshoporders eenmalig melden, `wc_import_status` alleen bij verandering
schrijven, de import-lease van de app ongemoeid laten), de website-telemetrie
(het bericht: schakelaars, lege tanks, sensorstatus, temperatuurleeftijd,
contractgrenzen, geen vreemde velden; `_voorraad_per_locatie`; `_wc_request`
zonder `api_pad` ongewijzigd; de loop verstuurt niets als hij uit staat of
WooCommerce ontbreekt, en ruimt de site op bij uitzetten) en de tanktemperatuurbewaking (het oordeel
zelf, het uitlezen van het werkelijke climate-setpoint én de
alarmadministratie; tests bewaken dat de drempel-defaults en de
setpoint-leeftijd in server.py en tankbewaking.ts gelijk blijven).
De facturen per e-mail hebben een eigen blok: `_inbox_lees_bericht` (PDF's herkennen
op inhoud i.p.v. type of naam, doorgestuurd als bijlage, afzenderfilter, dubbel, grenzen,
kapotte invoer), de ophaalronde tegen een nepclient én tegen een echte mini-IMAP-server
met de echte `imaplib` (waterlijn per map en UIDVALIDITY — ook een server die hem niet meldt —,
alleen lezen, uitval halverwege, plafond op onverwerkte facturen en op de mailgrootte, gequote
gebruikersnaam, mapnamen met haken/accenten als modified UTF-7, opnieuw doorlopen en het
loslaten van de waterlijn bij een teruggezette lijst), verbindingsfouten → codes, de rollen,
de secret-bestemming en de backup-versleuteling van `imap_creds`.
`TestBankAfschriften` bewaakt de bewaarde bankafschriften: `bank_transacties`
en `bank_afschriften` alleen als lijst (422), `productie` krijgt 403 (ook in
een commit), `boekhouding` mag schrijven, delta toevoegen/verwijderen werkt.
Het uitbetalingsverslag op een banktransactie (`verslag.bestand`) houdt zijn
PDF vast tegen `/api/delete_upload` (409), net als een factuurbijlage.
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
| React component files | `PascalCase.tsx` — `BatchFlowPage.tsx` |
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

- Pages are large single-file components (`~1,000–4,000 lines`) with inline state.
  Uitzondering die de richting aangeeft: Administratie (`pages/admin/`) is
  een container met secties, een gedeelde context en per sectie een submap
  met de zelfstandige onderdelen
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
  (zie `VoorraadPageProps` in `pages/admin/VoorraadPage.tsx`) i.p.v. `: any` — boy-scout-regel
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
| Rij-acties in een lijst/tabel | Gebruik `<RowActions primair={…} acties={[…]}>` uit `src/components/ui/RowActions.tsx` |
| Bierkleur (wélk bier) | `<BierKleur ebc={…} s="sm|md|lg">` uit `src/components/ui/BierKleur.tsx`; EBC via `productEbc`/`batchEbc` — nooit een eigen stip |
| Accent-kleur inline tekst/link | `t-accent-text` (of `style={{color: 'var(--t-accent)'}}`) — nooit `text-amber-*` hardcoden |
| Sectie-label binnen een card | `text-sm font-semibold text-gray-800` — géén `uppercase tracking-wide` |
| Veldlabel in een formulier | `text-sm font-medium text-gray-700` (zit al in `Inp`/`Sel`) |
| Fallback tekst (onbekende naam) | Altijd via i18n: `t('lbl_onbekend')` of `t('lbl_naamloos')` |
| Destructieve of statuswijzigende actie | Geen `confirm()`: `const undo = useUndo(); undo.plan(id, label, uitvoeren)` (`UndoBar.tsx`, vijf seconden terugweg) of `<BevestigKnop vraag=…>` (bevestiging ín de knop) |
| Lege lijst / mislukte lading | `<LegeStaat titel tekst icoon>` met de knop als kind; `<FoutKaart onOpnieuw>` — nooit een lege tabel die "geen …" zegt terwijl het bereik weg is |
| Tapdoel op een telefoon | `min-h-tap` (44 px) / `min-h-tapLg` (48 px), `sm:min-h-0` op een bureau — zit al in `Btn`/`Inp`/`Sel`/`SearchInput` |
| Tekstgrootte van een invoerveld | `text-sm`/`text-xs` (zit al in `Inp`/`Sel`); `index.css` maakt daar in de telefoonlayout en op iOS/iPadOS 16px van — kleiner laat iOS bij het aantikken inzoomen en ingezoomd (zijwaarts schuifbaar) achter. Geen `text-[13px]` e.d. op een `input`/`select`/`textarea`: daar geldt die regel niet |
| Datumveld | `type="date"` met `w-full` (of `flex-1`/`min-w-0`) is genoeg: op iOS zet `index.css` dan de eigen weergave uit, anders legt iOS een minimumbreedte op en steekt het veld buiten een smalle kolom |
| Verticaal scrollend paneel op een telefoon | `overflow-y-auto overflow-x-hidden`; een lang woord zonder spaties (bestandsnaam) in een flex-rij krijgt `min-w-0 break-words` |
| Foto-/bestandsinvoer in een venster dat in code van indeling wisselt (`useSmalScherm`) | De `<input type="file">` op een plek die de wissel overleeft (zoals `invoer` in InkoopFactuurModal). Draait iemand de telefoon terwijl de camera open staat, dan verdwijnt een invoer in het gewisselde deel: de foto komt binnen op een losgekoppeld element en er gebeurt niets — geen foto, geen melding |

**Regels:**
- Gebruik `<SectionHeader title=... open=... onToggle=... info=... solid? rounded?>`
  voor alle sectie-headers. Een chevron verschijnt automatisch bij `onToggle`;
  extra info (telling, voortgang, status-pill) gaat rechts via `info`.
- **`solid` is de uitzondering, niet de regel.** Standaard is een sectiekop
  rustig (donkere tekst op wit met een haarlijn). De geverfde themabalk is er
  alleen voor het onderwerp van de pagina zelf — één per scherm. Meerdere
  gekleurde balken onder elkaar maken elke sectie even belangrijk en zijn het
  duidelijkste "gegenereerd"-signaal in een UI.
- **Geen `uppercase tracking-wide` op labels.** Klein-kapitaal is voorbehouden
  aan badges (een afgeronde chip mét eigen achtergrond). Gewone zinsvorm leest
  rustiger en is in vijf talen beter te zetten.
- **Geen emoji's, nergens** (ook niet in i18n-strings). Een pictogram is een
  monochroom lijn-icoon via `<Icon n="…">` uit `src/components/ui/Icon.tsx`
  (nieuw icoon = één pad-string daar); puur typografische tekens (✓ ✕ ✎ ✉ ⚠)
  blijven tekst. Emoji's tekenen per platform anders, kleuren niet mee met het
  thema en zijn een "gegenereerd"-signaal.
- Zet **geen emoji's of icon-afbeeldingen** in de bruine headerbalk; gebruik
  tekstlabels via `t()`.
- Zoekbalken altijd via `<SearchInput value onChange placeholder cls? onKeyDown?>`.
- **Maximaal één actieknop per rij zichtbaar**; de rest hoort in het
  `⋯`-menu van `RowActions`. Zes knoppen op elke regel maken de inhoud van
  de rij onleesbaar.
- Gebruik `t-accent-text` / `var(--t-accent)` voor themagevoelige kleuren — dit werkt correct bij alle 6 thema's
- **Lege staat = korte regel + de knop zelf**, nooit een zin die uitlegt waar
  de knop staat. Een sectie die leeg is en waar niets te doen valt, toon je
  helemaal niet.

### Administratie — patronen (lijstpagina's)

Bindend voor de lijsten in Administratie (Facturen, Bank, Aangiftes, Voorraad,
Rapporten › Journaal) en voor elke lijst die daar bijkomt:

- **Eén filterbalk:** `<FilterBalk zoek onZoek status={{chips, waarde, onKies}}
  periode={{keuze, onKeuze, eigen, onEigen, uit}}>`; extra filters (klant,
  leverancier, rekening, type) als kinderen. Status als `StatusChips` met
  aantallen (`nadruk` = rood zodra Te laat > 0). De periode is gedeeld:
  `useGedeeldePeriode()` + `periodeBereik` (`utils/periode.ts`) — nooit een
  eigen van/tot-veld of periodestate in de pagina. Enige uitzondering:
  Aangiftes kiest een jaar, want daar ís de lijst de perioden.
- **Wat aandacht vraagt filter je niet weg:** Open, Te laat, Te verwerken
  (Facturen) en Te koppelen (Bank) negeren de periode; de kiezer staat dan
  uit mét de reden (`uit`, bijv. `periode_uit_open`). Die regel staat in de
  util (`periodeGeldtVoorStatus`, `bankPeriodeGeldt`), niet in de pagina. Een
  chip noemt precies het aantal regels eronder, en de totaalregel rekent met
  wat er staat.
- **Lijst:** `<ResponsiveLijst>` — een tabel op het bureau, kaarten op de
  telefoon (nooit een tabel die zijwaarts scrolt). Een klik op de rij opent
  het detail; een knop in een telefoonkaart krijgt `KAART_INTERACTIEF`.
  Minder belangrijke kolommen `breed` (pas vanaf 1024 px), zodat de tabel
  naast een open detail past.
- **Eén zichtbare handeling per rij**, de handeling die bij de stand past
  (herinnering, Markeer betaald, Koppel, Verplaatsen, Controleren); de rest
  onder ⋯ (`RowActions`) of in het detail.
- **Detail:** `<LijstMetDetail lijst detail open>` met een `<DetailPaneel
  titel onSluit acties>` — op het bureau naast de lijst, op de telefoon een
  eigen scherm met terugknop en een vaste actiebalk (één primaire knop, de
  rest onder "Meer"). Half ingevulde invoer hoort in de state van de pagina:
  bij een indelingswissel wordt het detail opnieuw opgebouwd.
- **Beslissen in een util, tonen in de pagina:** status, stap, voorstel en
  tellingen zijn pure functies met een test die i18n-sleutels teruggeven
  (`factuurFilter.ts`, `factuurTijdlijn.ts`, `bankVoorstel.ts`,
  `aangifteStappen.ts`, `rapporten.ts`), op de bestaande selecties
  (`facturen.ts`, `btw.ts`, `bank.ts`) — geen tweede definitie van "open".
  Meldingen zonder `alert()`/`confirm()`: een meldingsbalk of rode regel,
  `BevestigKnop` of `useUndo`.
- **Een nieuwe lijst toevoegen:** (1) filter- en telregels in `src/utils/`
  met test; (2) FilterBalk + StatusChips + gedeelde periode; (3)
  ResponsiveLijst met telefoonkaart; (4) LijstMetDetail/DetailPaneel; (5)
  het navigatiedoel in de beginstand lezen en in de tabel bij "De schil"
  zetten; (6) vraagt iets aandacht, dan een rij in `beslissingen.ts` — de
  badges volgen vanzelf.

---

## Color Conventions

### Theme-Aware Colors (gebruik altijd voor algemene UI)
De app ondersteunt 7 kleurenthema's (amber, green, blue, slate, red, purple, sand). Gebruik **altijd** CSS-klassen die op de theemavariabelen steunen voor interactieve elementen:

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

## Afgeleide kosten — nooit laten intypen wat de app kan weten

**Uitgangspunt van de gebruiker (blijvend):** elk kostencijfer dat de app zelf
kan afleiden, leidt de app zelf af. Energie, water, schoonmaak en soortgelijke
brouwkosten zijn géén invulveld: ze komen uit wat er al in de administratie
staat. Een handmatige waarde is altijd alleen een *overschrijving*, nooit de
enige weg — en het scherm zegt altijd wáár het cijfer vandaan komt.

De vaste bronvolgorde staat in **`src/utils/brouwKosten.ts`**
(`KOSTEN_POSTEN` + `brouwKosten`/`kostenVoorBrouw`):

1. `gemeten` — gemiddelde van de eigen recente batches (`electra_kosten`,
   `water_kosten`, `schoonmaak_kosten`, `overige_kosten`)
2. `boekhouding` — inkoopregels met de bijbehorende `kostensoort` (Energie,
   Water, Schoonmaak …) over dezelfde periode, gedeeld door het aantal
   brouwsels in die periode. Bewust **niet** de kostensoort `Overig`: daar zit
   van alles in wat niets met brouwen te maken heeft
3. `handmatig` — wat de gebruiker opgeeft
4. `geen` — nul, en de app zegt dat erbij

**Voeg nieuwe slimmigheid altijd hier toe, niet in een pagina.** Denk aan: een
HA-energiemeter die per brouwdag meet, een watermeter, schoonmaakmiddel dat via
de lots wordt afgeboekt, een urenregistratie, gasverbruik per kooktijd. Zo'n
bron wordt een extra stap in `postCijfer` (of een extra post in
`KOSTEN_POSTEN`); alles wat met deze kosten rekent — de receptvoorcalculatie,
de batchkostprijs, de W&V — erft de verbetering dan automatisch. Nergens anders
hoort een eigen sommetje over energie of water te staan.

Zelfde principe, andere hoek: `berekenBatchKostprijs` in `utils/calculations.ts`
neemt een **optionele** `accijnsInst` mee. Krijgt hij die, dan schat hij de
accijns van afvullingen die noch een uitslag noch een bevroren
voorcalc-snapshot hebben (van vóór v2.4) uit ABV/Plato, in plaats van ze stil
als nul mee te tellen; het resultaat zegt via `accijns_bron` of het cijfer
`geboekt`, `voorcalc`, `geschat` of `geen` is. **Geef dat argument alleen mee in
schermen, nooit in de W&V of de COGS** — die mogen niet op een schatting
draaien, en zonder het argument is het gedrag ongewijzigd.

**Kostprijs van één verpakte eenheid: nooit prijs-per-liter × inhoud.**
Verpakking is de enige kostenpost die níét met het volume meeschaalt — 20 liter
in flesjes kost aan glas, kroonkurk en etiket een veelvoud van dezelfde 20 liter
in één fust. In `kostprijs_per_liter` is die post over álle verpakkingstypen van
de batch uitgesmeerd, dus daar mag je de prijs van één verpakking niet uit
afleiden: een fust betaalt dan mee aan de flesjes en de flesjes komen te goedkoop
uit, waardoor artikelmarges onderling niet meer kloppen. Reken altijd met
`kostprijs_per_liter_excl_verpakking × inhoud + verpakkingKostenPerStuk(vp,
onderdelen)` — zo doet `receptKostprijs.ts` het al (`kostprijsPerEenheid`),
sinds v1.12.48 ook de artikelmarge op de productenpagina, en de COGS
(`berekenCogs`, per uitlevering met de verpakking van díe afvulling).

**Eén batchkostprijs.** `berekenBatchKostprijs` is de enige afleiding van wat
een batch kost; de batchpagina ("Financieel resultaat"), het batchdossier, de
productmarges en de COGS lezen hun posten eruit. Ingrediëntkosten lopen via
`batchRegelKosten`/`lotKostenVoorRegel` (lotprijs omgerekend naar de eenheid
van de regel: hop in g uit een lot in kg), accijns via `accijnsVoorKostprijs`
(geboekt voor wat is uitgeslagen + voorcalc naar rato van wat nog in de AGP
ligt). Geen eigen sommetje in een pagina.

Hetzelfde principe geldt voor de andere afgeleide cijfers die er al zijn: het
verliespercentage (`gemiddeldVerlies` in `utils/receptKostprijs.ts`), de
ingrediëntprijs (`ingredientPrijs`, uit de lots), de verpakkingsmix
(`verpakkingMix` in `utils/verpakkingKosten.ts`, uit de eigen afvullingen) en de
afgeleide bierinformatie (`afgeleideBierInfo` in `utils/bierinfo.ts`). Vraag het niet nóg een keer aan de
gebruiker als het al ergens in de administratie staat.

---

## Etiket & website — één bron, één schrijfweg

Aan het einde van een batch moet zichtbaar zijn wat er op het etiket en de
website hoort (zie `docs/OPZET-PRODUCTIE-VERKOOP.md` hoofdstuk 5). Regels:

- **Eén bron.** Elk getal en elk oordeel op de EtiketKaart, in het
  batchdossier, op de productpagina, in het blad *Wat brouw je?* en in CCP 3
  komt uit `utils/etiket.ts` (`etiketWaarden` met per waarde een **bron**:
  vastgezet · lab · Brewfather · berekend uit OG/FG · verwacht (recept)).
  Componenten rekenen niets zelf uit.
- **ABV.** Berekend met Balling (`abvBalling` in calculations.ts, de enige
  implementatie; niet ×131,25). *ABV vastzetten* (`abv_definitief`,
  `abv_bron`) is verplicht vóór de eerste afvulsessie (`abvVastgezetBlokkade`,
  `magNaarAfvullen`, `magSessieStarten`), omdat accijns, voorcalc en THT-klasse
  `batch.ABV` lezen; een batch die al een sessie heeft of afgevuld is, wordt
  niet met terugwerkende kracht geblokkeerd. De Brewfather-sync zet
  `abv_bron: 'brewfather'` en overschrijft een vastgezette ABV nooit.
  Wettelijke marge (`abvMarge`): ±0,5 % vol tot en met 5,5 %, ±1,0 daarboven;
  liggen etiket en batch aan weerszijden van 5,5, dan ±0,5.
- **Energie** altijd kcal én kJ per 100 ml, elk met de factoren van bijlage
  XIV (kcal = 7·alcohol + 4·koolhydraten, kJ = 29·alcohol + 17·koolhydraten) —
  nooit kJ = kcal × 4,184. Op het product staat energie alleen vast bij
  `energie_op_etiket === 'vermeld'`; anders volgt de website de afleiding.
  IBU is "berekend (Tinseth)", EBC "recept, niet gemeten" — nooit "gemeten".
- **Het etiket schrijf je op één plek.** `product.allergenen` en
  `etiket_versie` veranderen alleen via `legEtiketVast`, aangeroepen door de
  dialoog `EtiketBijwerken` (`useEtiketBijwerken()?.open(…)`). Wijzigen
  allergenen of ABV, dan is een nieuwe versie verplicht. De HACCP-matrix is
  alleen-lezen. Nooit allergenen voorvinken vanuit de batch, nergens "neem
  over" — CCP 3 blijft een onafhankelijke controle: het veld etiketversie
  begint leeg ("verwacht: v4" als tekst), en nieuwe EtiketControle-records
  bevriezen `etiket_versie_gelezen`/`_verwacht`, `abv_batch`,
  `abv_etiket_verwacht` en `abv_marge`. Gluten wordt niet genormaliseerd
  (gelijk aan CCP 3: een etiket met alleen "gerst" bij ingrediënten met
  "gluten" is rood).
- **Allergenen via het lot**: geef `lots` mee aan `allergenenUitBatch` /
  `ingredientVoorBatchRegel` / `risicoVoorBatch`, anders zien de kaart en CCP 3
  iets anders.
- **Webshop.** `afgeleideBierInfo` voor de push leest alleen productwaarden
  (nooit stil een batchwaarde). Bij elke push en pull bewaart de app de
  `_cf_`-meta als `wc.meta_stand` + `meta_stand_op` op het artikel; "website
  loopt achter" vergelijkt die stand met het product, nooit met de batch. De
  Bevat-regel (vereniging van de etiketversies die nog op voorraad liggen,
  `webshopBevatRegel`) gaat als laatste zin achter `_cf_ingredienten` en gaat er
  bij een pull weer af. Nooit automatisch pushen; nooit prijs of voorraad in de
  etiketstap.

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

### Afboeken: de locatie bepaalt de accijns

Een afboeking (`afboekingen`) legt in `bron_locatie_id` vast wáár het bier lag
toen het brak, vermist raakte of vernietigd werd. Dat veld stuurt twee dingen,
en die horen bij elkaar te blijven:

- **Voorraad.** `voorraadPerLocatie` haalt het aantal van díe locatie af. Ging
  het altijd van de AGP af — zoals vóór v1.12.52 — dan zakte die door nul
  terwijl de andere locatie bier bleef tonen dat allang weg was, en telde de app
  in totaal méér dan er ooit is afgevuld.
- **Accijns.** De heffing ontstaat zodra het bier de schorsingsregeling
  verlaat. Uit de AGP is een vermissing dus accijnsplichtig
  (`afboekingAccijnsplichtig` → `bouwAfboekingAccijnsRecord`). Lag het al
  daarbuiten, dan is de accijns bij de uitslag al geboekt en mag hij hier
  **niet** nog eens: dat belast dezelfde flesjes twee keer.

Geef daarom altijd de AGP-locatie mee aan `afboekingAccijnsplichtig` /
`bouwAfboekingAccijnsRecord` wanneer je die aanroept. Een afboeking zónder
locatie geldt als AGP — zo blijven bestaande records exact hetzelfde
gewaardeerd, en voor de voorraadtelling schuift alleen zo'n oud record nog door
naar een locatie die wél voorraad heeft.

De inventarisatie (Voorraad › Tellingen, `InventarisatiePage`) telt bewust locatieloos: een geteld
tekort is daar een AGP-discrepantie, dus die afboekingen krijgen geen locatie
en blijven accijnsplichtig.

### Uitslaan ≠ verkopen (v1.12.80)

Twee aparte stappen, in deze volgorde:

1. **Uitslaan** — het bier verlaat de AGP naar een vrije voorraadlocatie. Dát
   is het belastbare feit: verplaatsing + accijnsrecord + logregel `uitslaan`
   (`bouwVerplaatsing` / `bouwUitslagBoekingen` in `utils/agp.ts`). Kan op
   Voorraad › AGP-stand, de productpagina, in de kassa (tegel met AGP-voorraad), in de
   pickmodal en bij het aanmaken van een bestelling (`UitslagModal`).
2. **Verkopen** — kassa, bestelling of webshop, privé én zakelijk: altijd uit
   vrije voorraad buiten de AGP (`bouwVerkoopUitleveringen` in
   `utils/uitlevering.ts`). Een verkoop boekt **nooit** accijns en pakt nooit
   zelf bier uit de AGP; logregel `verkoop`. Te weinig vrij = eerst uitslaan.

Enige uitzondering: `type_uitlevering` `export`/`intra_eu`
(`verkoopUitAgpToegestaan`) gaat onder schorsing rechtstreeks uit de AGP, zonder
Nederlandse accijns. Het klanttype (privé/zakelijk) bepaalt alleen nog prijs en
factuur, niet meer waar het bier vandaan komt. Vóór v1.12.80 leverde een
zakelijke order zijn tekort stil uit de AGP en boekte daarbij accijns (bron
`uitlevering`) — die oude records blijven geldig, er komen er alleen geen bij.

### Tankbezetting: gereserveerd ≠ bezet

Een tank is pas **bezet** als er bier in zit (`Vergisten`/`Conditioneren` —
`TANK_BEZET_STATUSSEN`, `tankBezetter` in `utils/calculations.ts`). Bij
`Gepland`/`Brouwen` is de toegewezen tank alleen **gereserveerd**
(`tankReserveringen`): hij is nog leeg, reinigen/ontsmetten gebeurt tijdens de
brouwdag (stap "Gisttank gereed" in de batch-flow, of de vrije-tankkaart op het
Productie-dashboard) en het omwisselen van een reservering maakt de oude tank
níét vuil. De claim valt bij de stap naar `Vergisten` (`tankClaimCheck`: een
andere batch erin = harde blokkade, niet aantoonbaar ontsmet = bevestiging
vragen). `TANK_STATUSSEN` (mét `Brouwen`) is de AGP-blik "bier in proces", niet
de fysieke bezetting. server.py (tankbewaking, auto-metingen) kijkt alleen naar
`Vergisten`/`Conditioneren` — houd die twee kanten gelijk.

### Recepten "in gebruik" en de keten

- **Eenheid = het hoofdrecept.** Een Brewfather-versie (`is_huidige: false`,
  id `<parent>__v<_id>`) telt voor zijn hoofdrecept en staat nooit als eigen
  regel in een lijst of kiezer. `batch.recept_id` is altijd het hoofdrecept;
  een gekozen versie staat in `batch.recept_versie_id`.
- **In gebruik** (`receptGebruik`, eerste regel die geldt): verborgen (wint
  altijd) → vastgepind (`recept.vastgepind`, sync-bestendig) → gepland/lopend →
  huidig recept van een niet-gearchiveerd product → gekoppeld → gebrouwen in de
  laatste 18 maanden → archief. Uit roulatie telt mee (seizoensbier).
- **Sync:** `voegReceptSyncSamen` bewaart een recept dat uit Brewfather
  verdwijnt zolang een batch of product ernaar verwijst of het vastgepind is
  (`niet_in_brewfather: true`); een mislukte Brewfather-pagina breekt de sync
  af (`bfGetRecipes` gooit) — nooit stil recepten weggooien.
- **Product bij een batch:** een nieuwe batch krijgt het product van zijn
  recept als er precies één kandidaat is (met terugweg); `product.recept_ids`
  wordt nooit automatisch bijgeschreven (`receptenVanProduct` is afgeleid).
  Een product dat bij het afvullen ontstaat erft naam, stijl en recept, maar
  geen ABV en geen allergenen.
- **Nieuwe batch** gaat altijd via het blad *Wat brouw je?*
  (`useNieuweBatch()?.open({receptId?, versieId?, productId?, tank?, datum?})`)
  en `receptNaarBatch` — er is geen tweede planformulier.

### Data keys (opgeslagen in SQLite, `/data/brewadmin.db`)

Key names are alphanumeric + underscore only (enforced by server). All active keys:

| Key | Type | Inhoud |
|-----|------|--------|
| `ingredienten` | array | Ingrediënten |
| `lots` | array | Ingrediëntlots (voorraadeenheden). `etiket_fotos: [{naam, bestand}]` = foto's van het etiket (bewijs bij een controle of terugroepactie); een inkoopregel met meer lotnummers geeft elk lot dezelfde foto's. `_bijlage_in_gebruik` houdt zo'n bestand vast |
| `batches` | array | Brouwbatches. `recept_id` = hoofdrecept, `recept_versie_id` = gekozen Brewfather-versie, `product_id`/`product_ids`, `ABV` + `abv_definitief`/`abv_bron` (vastgezet vóór de eerste afvulsessie) |
| `producten` | array | Verkoopbare producten (bieren): naam, stijl, `status` (`actief`/`gearchiveerd`), `uit_roulatie`, `recept_ids`, `recept_huidig_id` (vastgezet huidig recept; leeg = afgeleid), de etiketgegevens (`allergenen` — ontbrekend ≠ `[]` —, `etiket_versie`, `etiket_bijgewerkt`, `abv`, `ibu`, `ebc`, `kcal`/`kj` + `energie_op_etiket`; alleen via `legEtiketVast`) en de bierinformatie (`utils/bierinfo.ts`) |
| `product_artikelen` | array | Artikel per product + verpakking: SKU, EAN, prijzen, BTW, `wc` (WooCommerce-productkaart, incl. `meta_stand`/`meta_stand_op` = de `_cf_`-meta bij de laatste push/pull) |
| `batch_ingredienten` | array | Koppelingen batch ↔ ingredient |
| `afvullingen` | array | Afvullingen / releases |
| `uitslagen` | array | Biervoorraaduitslagen |
| `accijns` | array | Accijnsrecords |
| `verpakkingen` | array | Verpakkingstypen |
| `onderdelen` | array | Apparatuur-onderdelen |
| `voorraad_log` | array | Mutatielog ingrediënten én bier: `afvullen`, `uitslaan` (AGP → vrije voorraad, met accijns), `verkoop` (uitlevering aan een klant; vóór v1.12.80 stond een verkoop óók als `uitslaan` gelogd; een teruggedraaide pick krijgt een tegenregel `verkoop` met negatieve hoeveelheid), `afboeking`, `rebrand` |
| `voorraad_archief` | array | Gearchiveerde voorraadmutaties |
| `voorraad_gesloten_bieren` | array | Afgesloten biersoorten |
| `recepten` | array | Recepten (lokaal + Brewfather; versies als `<parent>__v<_id>` met `parent_id`/`is_huidige: false`). Eigen velden van de app (`kostprijs_overig` = vaste kosten per brouw, `kostprijs_verlies_pct` = handmatig verliespercentage, `vastgepind`) blijven bij een Brewfather-sync behouden — zie `RECEPT_EIGEN_VELDEN` in `utils/receptSync.ts`; `niet_in_brewfather` = verdwenen uit Brewfather maar nog verwezen, dus bewaard |
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
| `haccp_ccp_metingen` | array | *(legacy)* Metingen op die definities, met limietcheck en automatische CAPA. Sinds het verwijderen van de oude Batches-pagina (1.12.42) nergens meer zichtbaar of registreerbaar; de data blijft in de database en de Excel-backup |
| `haccp_capa` | array | Corrigerende en preventieve maatregelen |
| `haccp_waterkwaliteit` | array | Watermonsters tappunt brouwerij |
| `haccp_ongedierte` | array | Ongediertecontroles en -waarnemingen |
| `haccp_opleidingen` | array | Opleidings- en instructieregister |
| `haccp_vrijgaven` | array | **CCP 1** — vrijgave voor afvullen per batch: stabiliteitstoets, forced fermentation, sensorisch oordeel. Server-side append-only; correctie via een nieuwe registratie met `vervangt_id`. Zonder vrijgegeven registratie kan er niet afgevuld worden |
| `afvul_sessies` | array | Afvulsessie met lotcode `L<batchnr>-B<n>` (bijv. `L2431-B1`) en berekende THT; anker voor CCP 2 en CCP 3. Bewust **niet** append-only: een sessie wordt afgesloten |
| `haccp_sluitcontroles` | array | **CCP 2** — sluitcontroles per sessie (visueel + omkeerproef). Append-only. Bij afkeur worden de afvullingen sinds de laatste goedkeuring geblokkeerd |
| `haccp_etiketcontroles` | array | **CCP 3** — etiketcontrole per sessie met blokkerende allergenenvergelijking recept ↔ etiket. Nieuwe records bevriezen ook `etiket_versie_gelezen`/`_verwacht`, `abv_batch`, `abv_etiket_verwacht`, `abv_marge`. Append-only |
| `haccp_afwijkingen` | array | Expliciete afwijkingsregistraties: de enige manier om langs een harde CCP-blokkade te komen, altijd met onderbouwing + CAPA. Append-only |
| `haccp_trace_oefeningen` | array | **Traceeroefeningen** (hoofdstuk 11): periodieke mock recall met bevroren omvang (lotcodes, afnemers), massabalans, traceergaten, doorlooptijd en conclusie. Append-only — een tegenvallende oefening mag niet achteraf bijgesteld worden |
| `haccp_instellingen` | object | Kritische grenzen uit het handboek: stabiliteitsdagen, forced-fermentation-marge, THT-maanden per klasse, halfuurinterval sluitcontrole, traceeroefening-interval/-maximumduur/-normpercentage. **Beheer-only** — beleid, geen werkinstelling |
| `inkoop_facturen` | array | Inkoopfacturen. `betaald_via_alt_id` = betaald vanaf een alt-rekening; `betaald_door_verrekening` = de factuur van een PSP staat op betaald omdat de uitbetalingen hem dekken (`kostenVerrekend` in `bank_koppelingen`); `vorige_stand` = de stand van vóór een afrekening via een alt-rekening (ongedaan maken zet hem terug) |
| `scan_correcties` | array | Het scangeheugen (`utils/scanGeheugen.ts`): `{tekst, soort, leverancier?, artikelcode?, naam?, kostensoort?, eenheid?}`, de nieuwste 500. Bij elk opslaan van een gescande factuur geleerd (per leverancier + artikelnummer, anders omschrijving); de oude `{tekst, soort}` blijft gelden als algemene correctie. Gaat vóór de indeling van het model |
| `inkoop_inbox` | array | Facturen per e-mail: de PDF-bijlagen die de server-tick `_inbox_tick` uit het postvak (IMAP) haalde, met `status` `nieuw`/`verwerkt`/`genegeerd`. Item: `{id, ontvangen, mail_datum, van, van_naam, onderwerp, message_id, bijlage: {naam, bestand}, grootte, sha256, status, factuur_id?, afgehandeld?}`. De server voegt alleen nieuwe items toe (bestand `inbox_<sha256[:20]>.pdf` in de bijlagenmap); verwerken, negeren, terugzetten en verwijderen doet de app. Een PDF met een `sha256` die er al in staat (ook genegeerd/verwerkt) komt er nooit nog eens bij. Financiële key: alleen `boekhouding`/`beheer` schrijven. Wel in de Excel-backup |
| `verkoop_facturen` | array | Verkoopfacturen. `verrekend_alt_id` = verrekend met de schuld aan een alt-rekening (ook nadat de factuur met de hand op betaald is gezet); `vorige_stand` = de stand daarvoor. De factuur van een bestelling draagt `bestelling_id` (opgebouwd door `bouwOrderFactuur` in `utils/orderFactuur.ts`); wordt een gefactureerde bestelling geannuleerd, dan komt er een creditnota met `credit_van_factuur_id` en hetzelfde `bestelling_id` |
| `bestellingen` | array | WooCommerce-bestellingen. `factuur_id`/`factuur_nummer` = de verkoopfactuur; die kan er al zijn vóór `afgerond` — een betaalde order die nog niet is opgehaald of verzonden, vooraf gefactureerd (Bestellingen "Factuur maken", of Bank vanuit een PSP-uitbetaling). Afronden maakt dan geen tweede factuur, de orderregels liggen vast en annuleren maakt een creditnota |
| `bestelling_picks` | array | Pickregels per bestelling |
| `afboekingen` | array | Biervoorraadbewegingen (vermis, vernietiging, overig). `bron_locatie_id` = waar het bier lág — bepaalt van welke locatie het afgaat én of er accijns verschuldigd wordt. Ontbreekt op records van vóór v1.12.52; die gelden als AGP |
| `klanten` | array | Klanten |
| `gist_metingen` | array | Gistingsmetingen per batch. Automatische metingen (`auto: true`, server-tick `_auto_metingen_tick`) dragen naast de lokale `datum`/`tijd` een absoluut `ts` (ISO met offset) — dat gaat in de bewaking voor (`_meting_epoch`/`metingTs`), anders geeft de wintertijdwissel een vals "sensor stil". De server dunt automatische metingen ouder dan 48 u eens per dag uit tot één per batch per uur (`_dun_auto_metingen`); handmatige rijen blijven altijd staan |
| `tank_setpoints` | array | Werkelijk setpoint per tank, gelezen van de gekoppelde climate-entity door de server-tick `_lees_tank_setpoints`: `{tank, entity, setpoint, sinds, gezien}`. `sinds` = moment van de laatste setpoint-wissel (leeg bij de eerste waarneming — een herstart mag geen instelvenster starten), `gezien` = laatste geslaagde uitlezing (ouder dan 2 uur = terugval op het schema). Alleen de server schrijft hier; bewust **niet** in de Excel-backup (regenereert vanzelf) |
| `wc_import_status` | object | Stand van de automatische WooCommerce-import. Server (`_wc_orders_tick`, interval = `woocommerce_creds.importInterval`): `nieuw` = webshoporders die nog niet als bestelling bestaan, `gemeld_ids` = waarvoor al een HA-melding ging, `laatste_check`/`laatste_fout`. Tabbladen: `bezig_tot`/`door` = import-lease, `laatste_import*`. Bewust **niet** beheer-only (elke schrijvende rol importeert) en niet in de backup (regenereert). De import zelf blijft in de app (`utils/wcOrderImport.ts`) |
| `website_telemetrie` | object | Website-telemetrie naar de plugin Craftery Brouwerij: `{enabled, interval_min (15–240, default 60), onderdelen: {gisting, sensoren, hop_kg, mout_kg, liters_tank, liters_verpakt, batches_gebrouwen}}` — alles standaard uit, alleen een echte `true` telt. **Beheer-only**; wel in de Excel-backup |
| `website_telemetrie_status` | object | Stand van de website-telemetrie, alleen door de server geschreven (`_website_verstuur`): `laatste_poging`, `laatst_gelukt`, `gelukt`, `fout` (`{code, http, oorzaak?}`), `antwoord` (begrensd plugin-antwoord: versie, ontvangen, vers, max_leeftijd, regels, plaatshouders), `op_site` (staan er cijfers op de site — stuurt het ene lege bericht bij uitzetten), `leeg`, `handmatig`. Beheer-only, de app leest hem met een gewone GET (geen useStore: die zou de key vanuit de client aanmaken). Niet in de backup (regenereert) |
| `inkoop_inbox_status` | object | Stand van het postvak, alleen door de server geschreven (`_inbox_ophalen`): `laatste_check`, `laatst_gelukt`, `handmatig`, `fout` (`{code, oorzaak?}`), `mailbox`, `uidvalidity` + `laatste_uid` (de waterlijn: wat al bekeken is), `laatste_ronde` (`{berichten, nieuw, dubbel, overgeslagen}`), `overgeslagen` (nieuwste eerst, max 20: `{ts, van, onderwerp, reden, naam?}`). Beheer-only schrijven, iedereen leest hem met een gewone GET (geen useStore). Niet in de backup en niet terug te zetten (regenereert). De waterlijn hoort bij de lijst: `/api/backups/restore` van `inkoop_inbox` laat hem los (`_inbox_waterlijn_vrijgeven`) en *Opnieuw doorlopen* doet dat op verzoek |
| `tank_alarmen` | array | Temperatuurstoringen per tank/batch, geopend en gesloten door de server-tick `_tank_bewaking_tick` (soort `waarschuwing`/`alarm`/`sensor_stil`, reden, piekafwijking, hersteltijdstip). De app leest ze voor de banner en zet `bevestigd` bij wegklikken — nooit zelf openen of sluiten |
| `carbonatie_sessies` | array | Carbonisatie-sessies per batch (CO₂-stone of kopdruk) |
| `verlies_registraties` | array | Verliesposten per batch (tankrest, leiding, schuim, monster, afgekeurd, overig) |
| `batch_notities` | array | Vrije, handmatige notities per batch (timestamped logje) |
| `water_profielen` | array | Waterprofielen bronwater (gereedschap Waterprofiel): ionen in mg/L uit een gescand waterkwaliteitsrapport of handmatige invoer |
| `water_doelprofielen` | array | Eigen doelprofielen brouwwater (gereedschap Waterprofiel), naast de ingebouwde stijlprofielen |
| `kapitaal_boekingen` | array | Kapitaalstortingen / -onttrekkingen |
| `journaal` | array | Onveranderlijke journaalregels (ERP 2.1): geboekt bij definitief maken van facturen/aangiftes, bedragen in centen, correcties via storno — server-side append-only (422 bij wijzigen/verwijderen van bestaande regels) |
| `jaarafsluitingen` | array | Jaarafsluitingen (ERP 2.3): snapshot balansposten + eigen vermogen per afgesloten boekjaar; beginbalans voor het EV-verloop op de balans |
| `bank_saldi` | object | Laatst bekende MT940-eindsaldo per IBAN (ERP 2.3): `{iban, eindsaldo, beginsaldo, datum, afschrift_nr, geimporteerd_op}`, gezet bij bankimport. `datum` = het einde van de periode van het afschrift (`tot`); een ouder afschrift draait een nieuwer saldo niet terug, en na het verwijderen van een afschrift geldt weer het laatst overgebleven afschrift van die rekening (of geen saldo). De balans leest de liquide middelen uit de bewaarde afschriften en valt hierop terug (`liquideMiddelenOp`) |
| `bank_transacties` | array | Bewaarde banktransacties (v1.12.89): een regel uit `parseMT940` met `{id, afschrift_id, iban, datum, type: C\|D, bedrag, referentie?, tegenpartij?, omschrijving?, storno?}` plus de gekoppeld*-vlaggen (`gekoppeldFactuurId`, `gekoppeldBtwPeriode`, `gekoppeldAccijnsMaand`, …) en de markeringen van de automatische koppeling. **`bank_koppelingen` blijft de bron van waarheid** (sleutel `txKey`): de vlaggen worden bij elke lezing opnieuw gezet (`herstelKoppelingVlaggen` in AdministratiePage) — lees ze uit de context en wijzig een transactie op `id`/`txKey`, nooit op haar plek in de lijst. Hetzelfde bestand twee keer inlezen voegt niets dubbel toe (`bouwBankImport`). Een PSP-uitbetaling kan een `verslag` dragen: het uitbetalingsverslag (PDF in de bijlagenmap) plus kenmerk, totalen en de ingehouden kosten per factuur van de PSP (`utils/pspUitbetaling.ts`, geen klantnamen) — las Claude het, dan ook `bron`, `model` en de regels zonder consument; dat blijft staan als de koppeling verdwijnt. Financieel (`boekhouding`/`beheer`); Excel-sheet `BankTransacties` |
| `bank_afschriften` | array | Ingelezen MT940-bestanden: `{id, iban, referentie, afschriftNr, beginsaldo, eindsaldo, van, tot, geimporteerd_op, aantal, nieuw, overgeslagen, transactie_ids, vorig_eindsaldo?}`. `transactie_ids` = álle transacties uit het bestand, ook die er al waren (de saldocontrole per afschrift); de aansluiting op het vorige afschrift rekent live (`vorigEindsaldoVoor`; overlap = geen aansluiting). Verwijderen (vijf seconden terugweg, audit `Bankafschrift`) haalt alleen transacties weg die in geen ander afschrift staan, laat `bank_koppelingen` staan — opnieuw inlezen zet de koppelingen terug — en zet `bank_saldi` terug (`bankSaldiNaVerwijderen`). Financieel; Excel-sheet `BankAfschriften` |
| `btw_aangiftes` | array | Twee soorten record in één key. **Indiening:** `{id, periodeKey, ingediend_datum, bedrag, ingediend_door?}` — een record mét `periodeKey` betekent "ingediend" (`geslotenPeriodeSets` in `utils/btw.ts`); `bedrag` in hele euro's, negatief = teruggave; terugzetten = het record weg + storno in het journaal. **Controle:** `{periode, status, berekend_datum, berekend_door, reviewer, controle_status, controle_datum, controle_door, bevindingen, zelfde_persoon_akkoord?}` met `periode` = de periodesleutel (`2026-Q3`, `2026-M09`) en nooit een `periodeKey`; een oud record onder `<jaar>-<maandnaam in de schermtaal>` wordt bij de volgende schrijfactie omgezet (`btwControleRecord`/`metBtwControle`). Wie berekende, controleerde en indiende is de ingelogde gebruiker (`whoami`); de controleur kies je uit `gebruikers_rollen` (zonder gebruikers: vrije naam) — nooit een vaste naam. Controleur = berekenaar/indiener mag alleen met "toch akkoord" + bevindingen. Financieel |
| `accijns_aangiftes` | array | Eén record per maand: `{maand: 'JJJJ-MM', status: open\|berekend\|ingediend\|betaald, berekend_datum, berekend_door, reviewer, controle_status, controle_datum, controle_door, bevindingen, zelfde_persoon_akkoord?, ingediend_datum, ingediend_door, bedrag, betaald_datum}`. "Vraag controle aan" zet `berekend`; indienen kan pas na akkoord en legt het maandtotaal vast als `bedrag` (euro's) — dat maakt het matchen van de bankbetaling mogelijk. € 0 ingediend = nihil (afgerond, geen betaling). Betaald via een bankkoppeling (`{soort:'accijns', maandKey}`, transactiedatum) of met de hand met een gekozen datum. Financieel |
| `btw_tarieven` | array | Actieve BTW-tarieven (bijv. `[0, 9, 21]`) |
| `ing_types` | array | Ingrediënttypen |
| `accijns_instellingen` | object | Accijnstarieven |
| `btw_instellingen` | object | BTW-aangifte-instellingen: `periode` + `standaard_btw` (voorgesteld tarief bij nieuwe artikelen/verkoopregels, default 21% via `standaardBtwPct` in `utils/btw.ts`) |
| `ing_type_btw` | object | Standaard BTW% per ingrediënttype |
| `brewery_details` | object | Brouwerijnaam, adres, land (ISO-2), BTW-nr., KvK, PEPPOL-ID/-schema (e-factuur), website (klikbaar logo in mail), `factuur_velden` (zichtbaarheid) en `factuur_template` (`{html, css}` — eigen factuurlayout, leeg = de ingebouwde standaard uit `utils/factuurTemplate.ts`) |
| `mail_templates` | object | Aangepaste mail-templates per kind (`pakbon`, `factuur`, `factuur_betaald`, `bestelling`, `verzending`, `afhaal_gemist`) met `subject`/`body`; leeg = i18n-default. `bestelling` kent `{levering}` (afhaal-/bezorgtekst incl. de link naar de afhaalpagina van de klant), `verzending` is de verzendbevestiging met `{trackregel}`/`{track}`, `afhaal_gemist` de mail voor een afhaalklant die niet kwam (`{afhaalmoment}` + `{afhaalregel}` met dezelfde link om een nieuw moment te kiezen; knop verschijnt via `afhaalmomentVerstreken`) — zie `utils/levering.ts` |
| `gebruikers_rollen` | object | Rollen per HA-ingress-gebruiker (ERP 4.2): `{gebruikers: {naam: rol}, standaard_rol}` met rollen `beheer`/`boekhouding`/`productie`/`alleen_lezen` — server-side afgedwongen, alleen door `beheer` te wijzigen, lockout-guard |
| `login_instellingen` | object | Styling van de loginpagina op de directe-toegangspoort: titel/ondertitel/knoptekst, accent-/achtergrondkleur (hex), achtergrondafbeelding (data-url), `logo_tonen`. Server rendert met strikte validatie (`_login_pagina`) — pre-auth, dus nooit ongefilterd |
| `factuur_counter` | object | *(legacy)* Doorlopend factuurnummer per jaar — vervangen door `nummer_reeksen`, alleen nog als migratie-seed gelezen |
| `nummer_reeksen` | object | Server-beheerde nummerreeksen (`factuur`/`creditnota` per jaar; `bestelling` = kort doorlopend `M-`-nummer voor handmatige orders, geen jaarreset), atomair uitgegeven via `POST /api/nextnr` — nooit client-side muteren |
| `ha_instellingen` | object | Home Assistant sensor-instellingen (incl. CO₂-cilinder weegsensor: `co2_enabled`/`co2_entity`/`co2_unit`, en `bewaking` = drempels van de temperatuurbewaking; leeg veld = default uit `utils/tankbewaking.ts`) |
| `notificatie_instellingen` | object | Meldingsinstellingen: HA `notify`-service + scherm-melding (herbruikbaar voor alle notificaties) |
| `bank_koppelingen` | object | Koppeling banktransacties (sleutel `txKey`) aan facturen, BTW, accijns, SNd, kapitaal, aflossing en PSP-bundels — dé bron van wat er gekoppeld is; de vlaggen op `bank_transacties` volgen hieruit (zie hieronder) |
| `app_logo` | string\|null | Base64 app-logo |
| `app_logo_icoon` | object | Automatisch gegenereerd 180×180-PNG-icoon uit het logo (`{van, icoon}`) t.b.v. `GET /api/app_icoon` (iOS-home-screen); afgeleide data — beheer-only, bewust níét in de Excel-backup (regenereert vanzelf) |
| `factuur_logo` | string\|null | Base64 factuurlogo |
| `app_name` | string | Naam van de brouwerij-app |
| `nav_theme` | string | UI-thema (`amber`/`green`/`blue`/`slate`/`red`/`purple`) |
| `brewfather_creds` *(secure)* | object | Brewfather API-credentials (nooit in backup) |
| `woocommerce_creds` *(secure)* | object | WooCommerce API-credentials + import-instellingen (`importStatussen`, standaard incl. `completed`; `importVanaf`-datum) `prijzenInclBtw` (voert de winkel prijzen incl. BTW in? default ja — bepaalt de omrekening bij een productpush) en `themaVelden` (Craftery-`_cf_`-velden beheren, default aan), `bestelUrl` (eigen sjabloon voor de bestelpagina van de klant met `{winkel}`/`{id}`/`{sleutel}`; leeg = de bij de import per order bepaalde `wc_bestel_url` — knop in de bestelbevestiging via `bestelLink` in `utils/levering.ts`) — nooit in backup |
| `claude_creds` *(secure)* | object | Anthropic API-key (nooit in backup) |
| `smtp_creds` *(secure)* | object | SMTP-server (host/port/user/pass/from/security/enabled) voor pakbon-, factuur- en bestelmail (nooit in backup) |
| `imap_creds` *(secure)* | object | Postvak voor facturen per e-mail: `{enabled, host, port, security (ssl/starttls/none), username, password, mailbox (INBOX), interval (min, 5–1440, default 15), afzenders[]}` (nooit in backup; wachtwoord afgeschermd en bij een gewijzigde bestemming niet ingevuld, net als SMTP). Beheer-only |
| `mollie_creds` *(secure)* | object | Mollie API-key + `enabled` + `redirectUrl` voor de online betaallink op verkoopfacturen (nooit in backup); server-side proxy voegt de key toe |

---

## Backup & Restore

Backup en restore gaan via Excel (`.xlsx`) — **niet** via JSON. De functies `excelExport` en `excelImport` in `src/utils/excel.ts` verwerken alle data.

- **Export:** `doExport()` in `App.tsx` → `excelExport(data)` → downloadt `brewadmin_backup_YYYY-MM-DD.xlsx`
- **Import:** `doImport(e)` in `App.tsx` → `excelImport(file, cb, onError)` → stelt alle state in
- **UI:** Instellingen → App → Data import & export (`accept=".xlsx"`)
- **Bestandsstructuur:** 81 array-sheets (één per datasleutel, `bouwBackupWerkboek`; o.a. `BankTransacties` en `BankAfschriften` voor de bewaarde bankafschriften, `AccijnsAangiftes`, `BtwAangiftes`, `Journaal`; lijsten van losse waarden als rijen `{waarde}`) + één `Instellingen`-sheet voor objects (`INST_JSON_KEYS`, o.a. `bank_koppelingen` en `bank_saldi`), primitieven en logo's
- **Geneste objecten** binnen array-items worden als JSON-string opgeslagen en bij import teruggeparsed
- **Credentials** (`brewfather_creds`, `woocommerce_creds`, `claude_creds`, `imap_creds`) zitten **nooit** in de Excel-backup en alleen gemaskeerd in de download-ZIP van een serverbackup (zonder db-kopie, `_backup_to_zip`); de serverbackup op schijf en offsite bevat ze **alleen versleuteld** (ERP 5.8, zie "Security constraints"), zodat die volledig herstelbaar blijft zonder leesbare geheimen
- **Afgeleide serverdata** (`app_logo_icoon`, `tank_setpoints`, `wc_import_status`, `website_telemetrie_status`, `inkoop_inbox_status`) staat bewust niet in de backup — die regenereert vanzelf

Wanneer je een nieuwe `useStore`-sleutel toevoegt, voeg deze dan ook toe aan `excelExport` (nieuw sheet of rij in Instellingen) én aan de import-callback in `doImport`.

---

## BTW Aangifte — implementatiedetails

### Periodeberekening

`getPeriodes(year, periode)` in `utils/btw.ts` berekent kwartaal- of maandperiodes (`key` = `2026-Q3` of `2026-M09`). Aangiftes (`pages/admin/AangiftesSectie.tsx`) toont per jaar de perioden die al begonnen zijn, als stappen (`btwRijen` in `utils/aangifteStappen.ts`); de gekozen periode is het detail, niet een filter op de pagina. De cijfers van één periode — rubrieken 1a/1b/1d/2a/4a/4b/5b, voorbelasting per tarief, het te betalen of terug te ontvangen bedrag in centen — komen uit `btwPeriodeCijfers`, het jaartotaal in de kop uit `btwJaarCijfers`.

- **Facturen tellen op hun effectieve periode** (`inBtwPeriode`/`inBtwJaar` in `utils/btw.ts`), inkoop én verkoop: een factuur met een datum in een al ingediende of betaalde periode krijgt bij aanmaken `btw_periode` (rollover) en telt in de lopende aangifte. WooCommerce-orders blijven op betaaldatum.
- **Eén bron per verkoop:** een opgehaalde WooCommerce-order telt alleen mee zolang er in de app geen verkoopfactuur voor bestaat (`wcOrdersNogNietGefactureerd`); een gefactureerde webshoporder (afgerond, of vooraf gefactureerd zodra hij betaald was) telt via zijn factuur.
- **Handmatige inkooptotalen** worden een correctieregel (`inkoopRegelsMetCorrectie` in `utils/centen.ts`), zodat journaal, W&V, rubriek 5b en de periodekaart dezelfde voorbelasting tellen.
- **Periode-lock en kostensoort:** een factuur in een ingediende of betaalde periode is niet meer te bewerken of te verwijderen (`magFactuurMuteren`). De kostensoort van een inkoopregel wél (`utils/kostensoortHerindeling.ts`, knop *Kostensoort wijzigen* in het inkoopdetail): die zegt alleen waar de kosten in de W&V staan. De herindeling boekt storno + herboeking in de geboekte periode en weigert (`null`) als dat per datum, periode, tarief en soort een ander bedrag zou geven — verruim deze uitzondering nooit naar bedragen, datum, tarief of leverancier.

### Periodestatus: vijf stappen (v1.12.90)

BTW en accijns lopen in hetzelfde ritme (`utils/aangifteStappen.ts`, één
`PeriodeLijst` voor beide):

| Stap | Conditie (BTW) | In de lijst |
|------|----------------|-------------|
| Lopend | `p.to ≥ vandaag`, niets ingediend of betaald | pil blauw, bedrag "tot nu" |
| Berekend | voorbij, geen akkoord van de controleur | knop *Controleren* (zonder activiteit en € 0: grijze pil, geen knop) |
| Gecontroleerd | `controle_status: 'akkoord'` in het controlerecord | knop *Indienen* |
| Ingediend | record mét `periodeKey` in `btw_aangiftes` | knop *Koppel betaling* (één transactie binnen € 1: meteen met die transactie) |
| Betaald / Terugontvangen / Nihil | BTW-koppeling in `bank_koppelingen`, of ingediend met € 0 | pil groen "afgerond" |

Een periode is pas afgerond wanneer er een banktransactie aan gekoppeld is als
bewijs van betaling (of de aangifte nihil was). Wat om actie vraagt staat
bovenaan (vroegste uiterste datum eerst — één maand na afloop); de telling op
het segment en de dashboardrijen volgen dezelfde regel als
`telOpenstaandeBtwPerioden` (voorbij, niet ingediend of betaald, wél
activiteit). Toekomstige perioden en de oude jaarweergave van de rubrieken
bestaan niet meer. BTW indienen zonder controle kan nog (bevestiging in de knop,
"Indienen zonder controle"), behalve in een periode die al betaald is; accijns
indienen blijft geblokkeerd tot het akkoord.

### `bankKoppelingen` — koppelingtypen

Het `bankKoppelingen` object (sleutel: `txKey(tx)`, de enige definitie staat in `utils/bank.ts`) kent deze soorten koppelingen:

```ts
// Verkoopfactuur
{ soort: 'verkoop', factuurId: number }

// Inkoopfactuur
{ soort: 'inkoop', factuurId: number }

// BTW-afdracht (debettransactie) of -teruggave (credit) ↔ een BTW-periode
{ soort: 'btw', periodeKey: string }  // bijv. '2026-Q1' of '2026-M04'

// Accijnsbetaling ↔ een accijnsmaand; zet de maand en haar accijnsrecords
// op betaald met de transactiedatum (koppelAccijnsBetaling)
{ soort: 'accijns', maandKey: string }  // bijv. '2026-09'

// Kapitaalstorting/-onttrekking (factuurId = id van de kapitaalboeking)
{ soort: 'kapitaal', factuurId: number }

// Aflossing aan een alternatieve rekening (telt in schuldPerAltRekening)
{ soort: 'aflossing', altRekeningId: number, bedrag: number }

// SNd-afdracht (statiegeld aan Statiegeld Nederland): debettransactie ↔
// SNd-periode; zet die periode op de Statiegeld-pagina op "afgedragen".
// Een kwartaalkoppeling dekt de maanden erin (utils/sndAfdracht.ts)
{ soort: 'snd', periodeKey: string }

// PSP-uitbetaling (Mollie e.d.): één credittransactie dekt meerdere
// verkoopfacturen (ook een creditnota bij een terugstorting); het verschil
// zijn de kosten die de PSP inhield (kostenCent). Die kosten zijn óf
// automatisch als betaalde inkoopfactuur geboekt (kostenFactuurId, de oude
// manier), óf verrekend met de factuur die de PSP er per maand voor stuurt
// (kostenVerrekend: per inkoopfactuur het deel uit deze uitbetaling), óf nog
// open ("factuur volgt"). gemarkeerdBetaald bevat de factuur-ids die door de
// koppeling op betaald zijn gezet, zodat ontkoppelen ze kan terugzetten.
{ soort: 'psp', factuurIds: number[], gemarkeerdBetaald: number[], kostenCent?: number,
  kostenFactuurId?: number, kostenVerrekend?: { factuurId: number, cent: number }[] }
```

**Het uitbetalingsverslag** (de PDF van Mollie bij een uitbetaling) hoort bij
de transactie, niet bij de koppeling: `bank_transacties[].verslag` (`{naam,
bestand, referentie, som_cent, totaal_cent, aantal, kosten: [{nummer, cent}]}`
— geen klantnamen; `_bijlage_in_gebruik` houdt de PDF vast). Bij het
uitsplitsen leest de app de PDF opnieuw (`koppelPspVerslag`) en vinkt de
facturen aan. Levert de tekstlaag niets op (een scan, foto's — die worden
samen één PDF-bijlage —, een andere PSP of opmaak), dan leest Claude het
verslag (`pages/admin/bank/verslagLezen.ts`, `utils/pspVerslagScan.ts`; alleen
met een sleutel). Dan staan ook `bron: 'claude'`, `model` en de regels zelf op
`verslag` (`{datum, methode, bedrag_cent, uitbetaald_cent, omschrijving}`,
zonder consument): het venster leest die terug (`verslagUitInfo`) in plaats
van opnieuw te laten lezen, en zegt dat Claude het las — nakijken voor het
koppelen. Ook dan koppelt niets vanzelf. De factuur van de PSP (inkoop) staat op betaald zodra de
uitbetalingen hem helemaal dekken (`inkoopNaVerrekening`, met
`betaald_door_verrekening` — alleen dan zet ontkoppelen hem weer open); hij
telt als gekoppeld in `gekoppeldeFactuurIds`. Verrekenen kan vanaf de
uitbetaling (Bank: "Kosten verrekenen") en vanaf de factuur (Facturen ›
Inkoop: "Verrekenen met uitbetalingen"); de vastlegging is gedeeld
(`verrekenPspKosten` in AdministratiePage). Een factuur die met de hand op
betaald is gezet hangt nergens aan (`verkoopAfrekening`/`inkoopAfrekening` in
`utils/factuurTijdlijn.ts` = null): verrekenen met een alt-rekening of met
uitbetalingen kan dan nog, en ongedaan maken zet hem terug in zijn
`vorige_stand`.

De computed `btwBetaaldePerioden` (memo in `pages/admin/AdministratiePage.tsx`, via `useAdmin()` in elke sectie) leest alle `soort: 'btw'`-entries en bouwt een `Set<string>` van betaalde periodeKeys; `aangifteStappen.ts` en `geslotenPeriodeSets` (`utils/btw.ts`) lezen dezelfde bron. Omdat de transacties bewaard worden (`bank_transacties`) zijn de gekoppeld*-vlaggen alleen nog een afgeleide: `herstelKoppelingVlaggen` zet ze bij elke lezing gelijk aan dit object (ook na ontkoppelen vanuit Aangiftes, een ander apparaat of een teruggezette backup), en een opnieuw ingelezen afschrift krijgt zijn koppelingen hieruit terug. Een BTW-, accijns- of SNd-ontkoppeling haalt elke betaling van die periode weg.

---

## Backend (server.py) Reference

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data/<key>` | Load data key (JSON, uit SQLite) |
| POST | `/api/data/<key>` | Save data key (JSON, naar SQLite) |
| GET | `/api/health` | Health-check (ERP 3.6): status achtergrondthreads, laatste-backupdatum, data-dir, uptime, `backup_versleuteling` (`{methode: 'wachtwoord'\|'sleutelbestand'}`) — dashboard en de backupkaart tonen dit |
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
| POST | `/api/delta/<key>` | Delta-sync per record (ERP 4.3): `{upsert:[records], delete:[ids]}` met verplichte `X-Data-Version` (en unieke id's: een dubbele id binnen één upsert, of een id in zowel `upsert` als `delete`, geeft 400 — anders komt hetzelfde record twee keer in de opslag en verliest de key permanent delta-ondersteuning); client valt bij 400/404 automatisch terug op de volledige POST |
| POST | `/api/website/voorbeeld` | Het telemetriebericht dat er nu verstuurd zou worden (`{instellingen?}` → `{bericht, bytes, max_bytes}`), met dezelfde code als de echte verzending — beheer-only |
| POST | `/api/website/test` | GET op de plugin-route (`/wp-json/wc-craftery/v1/brouwerij`): versie, laatst ontvangen, vers — verandert niets; beheer-only |
| POST | `/api/website/verstuur` | Telemetrie nu versturen, buiten het interval (`{instellingen?}`); 409 als de koppeling of alle onderdelen uit staan, `te_snel` binnen 10 s na het vorige bericht. Beheer-only, audit `website_verstuur` |
| POST | `/api/mail/test` | Test SMTP-credentials (login probe, niets opslaan) |
| POST | `/api/inbox/test` | Facturen per e-mail: met de ingevulde instellingen verbinden, inloggen en de map openen (alleen lezen); `{ok, berichten, mailbox}` of `{ok: false, fout: {code, oorzaak?}}`. Slaat niets op en haalt niets op. Sentinel-wachtwoord + gewijzigd adres → 400 `secret_opnieuw_invoeren`. Beheer-only |
| POST | `/api/inbox/ophalen` | Het postvak nu ophalen, buiten het interval om (max. 45 s per ronde; de rest volgt vanzelf); 409 `uit` als de koppeling uit staat of niet ingevuld is, fout `te_snel` binnen 10 s na de vorige ronde, `bezig` als er al een loopt. Body `{"opnieuw": true}` (alleen een echte `true`) laat de waterlijn los en loopt de nieuwste 50 berichten weer door — na een teruggezette lijst, een verruimd afzenderfilter of een per ongeluk verwijderde factuur; wat al in de lijst staat komt er niet dubbel bij. `boekhouding` + `beheer`, audit `inbox_ophalen` |
| POST | `/api/mail/send` | Verstuur HTML+text-mail via opgeslagen SMTP-creds (max 20 MB, max 50 recipients, max 15 MB bijlagen, optionele CID-inline images) |
| POST | `/api/mollie/test` | Test een Mollie API-key (beheer-only, niets opslaan); key mag de sentinel zijn |
| POST | `/api/mollie/payment` | Maak een Mollie **betaallink** (Payment Links API, `/v2/payment-links`) aan voor een factuur (boekhouding); `{amountCent, description, redirectUrl}` → `{checkoutUrl, id, expiresAt}`. Key wordt server-side toegevoegd. Bewust géén Payments API: die levert een kortlevende checkout die na verlopen naar de website doorstuurt |
| GET | `/api/backups[/<datum>]` | Serverbackups (`/data/backups/JJJJ-MM-DD/`, dagelijks, elke key als `<key>.json` + db-kopie, 0600 in een 0700-map) opsommen of als ZIP downloaden — beheer-only. De download-ZIP bevat geen db-kopie en de credentials gemaskeerd (`__SECRET__`) |
| POST | `/api/backups/trigger` | Nu een backup maken (beheer-only) |
| POST | `/api/backups/restore` | Eén data-key terugzetten uit een serverbackup (`{date, key}`) — beheer-only, geweigerd voor append-only keys, credentials en server-beheerde keys (`_NIET_TERUGZETBAAR`: `nummer_reeksen` + afgeleide serverdata), zelfde schrijfweg als `/api/data` (schemavalidatie, rollenvalidatie + lockout-guard via `_key_guard_fout`, versie, audit `backup_restore`). De rest van de administratie blijft staan |
| POST | `/api/upload` | File upload (PDF/image, max 20 MB). Overschrijft nooit een bestaande bijlage: bij een botsing wijkt de server uit naar een vrije naam en geeft die terug als `bestand` — de client bewaart díé naam |
| POST | `/api/delete_upload/<naam>` | Bijlage verwijderen; 409 zolang een inkoopfactuur, postvak-item, afboeking, verliesregistratie, lot (`etiket_fotos`) of banktransactie (`verslag`, het uitbetalingsverslag van een PSP) ernaar verwijst (`_bijlage_in_gebruik`) |
| GET | `/*` | Serve `index.html` (SPA fallback) |

### Security constraints (do not remove)

- Credentials in de serverbackup zijn versleuteld (ERP 5.8): elke
  `_SECURE_FIELDS`-waarde gaat als envelop (`__brewadmin_versleuteld__`) in
  `<key>.json` én in de kv-tabel van de db-kopie (daarna `VACUUM`, geen oude
  pagina's), dus ook in de offsite-ZIP. Sleutel: addon-optie
  `backup_password` (scrypt, salt in de envelop) of anders
  `/data/brewadmin_backup.sleutel` (32 willekeurige bytes, 0600, nooit in een
  backup, nooit overschreven als hij onleesbaar is). Stdlib-only: HMAC-SHA256
  in tellermodus + encrypt-then-MAC. Geen bruikbare sleutel = de credentials
  blijven buiten de backup (dicht falen), nooit leesbaar wegschrijven. Oude
  dagmappen/ZIP's zet `_versleutel_bestaande_backups` elke ronde om (idempotent,
  ZIP-commentaar als merkteken). Bij de start ontsleutelt
  `_herstel_versleutelde_geheimen` een teruggezette envelop; lukt dat niet, dan
  blijft hij staan en toont GET lege credentials. Nooit een tweede, leesbare
  kopie van de credentials in `/data/backups` of `/backup` zetten
- Backup-retentie heeft een ondergrens: `_MIN_BACKUPS_BEWAREN` /
  `_MIN_AUDIT_BEWAREN` houden de nieuwste backups en auditmaanden altijd
  overeind. Het beleid zelf hangt aan `date.today()`, dus een klok die
  vooruitspringt zou anders in één ronde de lokale mappen, de offsite-ZIP's
  én het auditspoor wissen — nooit weghalen
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
- Secrets-maskering: GET op creds-keys vervangt gevoelige velden door `__SECRET__`; POST vult de sentinel server-side terug in (`_mask_secrets`/`_unmask_secrets`) — nooit omzeilen of de sentinel-waarde opslaan. Wijkt de bestemming af (`_SECRET_BESTEMMING`: `storeUrl`; SMTP- en IMAP-host/-poort/-gebruiker/-beveiliging), dan vult hij níét in maar antwoordt 400 `secret_opnieuw_invoeren` (data-POST, commit, mail-/WC-test; UI-spiegel `utils/geheimen.ts`)
- Inkomende mail (`_inbox_*`) is onbetrouwbare invoer: het postvak gaat alleen-lezen open (EXAMINE + `BODY.PEEK`), bijlagen tellen alleen als ze echt met `%PDF-` beginnen (nooit op type of naam), begrensd in grootte (`INBOX_MAX_PDF_BYTES`/`INBOX_MAX_MAIL_BYTES`) en aantal, de bestandsnaam uit de mail is alleen weergavetekst (op schijf heet het bestand naar zijn SHA-256), mapnaam en inloggegevens mogen geen stuurtekens bevatten (geen tweede IMAP-commando in de sessie; imaplib quote alleen het wachtwoord, de gebruikersnaam quoten we zelf), een bericht komt nooit heel binnen zonder dat zijn grootte onder het plafond blijft (gedeeltelijke FETCH `BODY.PEEK[]<0.plafond+1>`, dus ook als de server geen grootte meldt), en `INBOX_MAX_OPEN` houdt de wachtrij begrensd. Nooit een bijlage of kop uit een mail als pad, HTML of commando gebruiken
- Server-audit: elke data-write wordt append-only gelogd naar `/data/server_audit/audit_YYYY-MM.jsonl` (`_audit_write`) — niet bereikbaar via de data-API, nooit verwijderen of omzeilen
- Schemavalidatie: `_KEY_TYPES` dwingt containertypes af (422). Nieuwe data-key? Voeg hem toe aan `_KEY_TYPES`
- Geen NaN/Infinity in de opslag: de schrijfwegen lezen via `_json_laden_strikt` (400), HA-waarden gaan door `_eindig_of_none`, en `_json_compact` maakt van een toch binnengekomen niet-eindig getal `null` (Python schreef anders letterlijk `NaN`, wat de app niet kan parsen)
- Append-only keys: `_APPEND_ONLY` (`journaal` + de HACCP-registraties `haccp_vrijgaven`, `haccp_sluitcontroles`, `haccp_etiketcontroles`, `haccp_afwijkingen`, `haccp_trace_oefeningen`) — bestaande records mogen nooit gewijzigd of verwijderd worden (422); correcties gaan via storno- resp. vervangende regels. `_append_only_ok` vergelijkt per id als multiset: een dubbele id, een nieuw record zonder id of een extra variant naast een bestaande id wordt ook geweigerd. Nooit omzeilen. Een CCP-registratie is bewijs richting de NVWA (HACCP-handboek bijlage A.1): wie en wanneer worden automatisch vastgelegd en zijn niet handmatig invulbaar
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
- Auto-sync: draait **één keer per mount** van `App.tsx` (`bfAutoSynced`-ref), niet
  op een interval; een nieuwe sync vergt een herlaad of de handmatige knop.
  Let op: de sync overschrijft `vergistingsprofiel`/`maischprofiel`/OG/FG
  onvoorwaardelijk — zie `docs/ERP-VERBETERPLAN-2.md` W6 (fase 7.4)
- De status gaat alleen vooruit langs de regels van de batch-flow
  (`bfStatusOvergang` in `utils/bfStatus.ts`): tankclaim bij Vergisten, CCP 1
  vóór Afgevuld, tank op Vuil bij vertrek, statusregel + audit. Wat daar
  zou blokkeren of een bevestiging vraagt wordt níét overgenomen
- Automatische schrijfacties bij het openen (deze sync, de klantkoppeling,
  de 'ingelogd'-auditregel) wachten op `whoami` en slaan een key over die de
  rol niet mag schrijven (`rolMagKey` in `utils/rollen.ts`, spiegel van
  `_rol_mag_key`); `lastSync` in de creds schrijft alleen beheer

### WooCommerce API

- REST API v3, Basic auth (consumer key + secret)
- Used for: order fetch, product lookup by SKU, betaalstatus van een order
  (`date_paid` + status; zie `utils/wcImport.ts`). Bij elke import wordt de
  betaalstatus van al bestaande orders ververst — een order die als `pending`
  binnenkwam kan later betaald zijn. Een order die in WooCommerce betaald is,
  levert bij afronden een verkoopfactuur met status `betaald` (die factuur
  vraagt niet meer om een overboeking, in de mail noch op de PDF). Die factuur
  kan ook al eerder, zodra de order betaald is ("Factuur maken" op de
  bestelling, `utils/orderFactuur.ts`): een afhaalklant die zijn bier nog niet
  ophaalde houdt de order open, maar de betaling zit al in een
  Mollie-uitbetaling. Afronden maakt dan geen tweede factuur
- **Annulering in de winkel** (`utils/wcOrderImport.ts`): open bestellingen
  die niet in de statusselectie zaten, haalt elke import apart per id op
  (`include=…&status=any`, alleen verversen, nooit nieuw). Geannuleerd, mislukt
  of terugbetaald → `wc_status` op de bestelling (badge + attentiepost
  `webshop_afgebroken`); `cancelled`/`refunded` zonder picks bij status
  `nieuw`/`bevestigd` → de import zet hem zelf op `geannuleerd` (zonder terug
  te schrijven). Onze eigen `completed` (terugschrijven) op een onbetaalde
  order telt niet als betaling: `wc_sync.onbetaald` →
  `betaalVeldenNaEigenSync` in `utils/wcImport.ts`
- **Afhalen of verzenden** (`utils/levering.ts`): de verzendregel van de order
  zegt of de klant afhaalt (`local_pickup`/`pickup_location`) of laat bezorgen.
  Het Craftery-thema bewaart bij een afhaalorder het gekozen afhaalmoment
  (`_craftery_afhaalmoment`: `JJJJ-MM-DD UU:MM` of `overleg`) en biedt de
  klant een privépagina `<winkel>/?afhaalmoment=<order-id>&sleutel=<order_key>`
  om dat moment te kiezen of te verzetten. De app leest dit bij elke import mee
  (ook voor bestaande orders — het moment wordt vaak pas later gekozen) en zet
  het in de bestelbevestiging via `{levering}`; de link naar die pagina staat
  niet in de tekst maar als knop onder de mail (`afhaalMailKnop`: *Kies je
  afhaalmoment* / *Verzet je afhaalmoment*; `MailModal` zet elke `MailKnop`
  in de platte tekst als regel + kale link). Een bezorgorder krijgt bij
  *Markeer verzonden* meteen de verzendbevestiging aangeboden (template
  `verzending`, met track & trace). Is het gekozen afhaalmoment voorbij en
  staat de order nog open, dan biedt de bestelpagina *Mail afspraak gemist*
  (template `afhaal_gemist`): dezelfde afhaalpagina als knop *Kies een nieuw
  afhaalmoment* (`afhaalGemistMailKnop`); het nieuwe moment komt bij de
  volgende import mee. De
  bestelbevestiging van een webshoporder krijgt een knop *Bekijk je
  bestelling* (`bestelLink`: het sjabloon `woocommerce_creds.bestelUrl`, anders
  `wc_bestel_url` — bij elke import per order bepaald door `bestelPaginaLink`:
  een klant met account krijgt de bestelling in Mijn account via de pagina-ID
  (`?page_id=8&view-order=<id>`; WordPress stuurt door naar de mooie URL, dus
  de slug van de winkel doet er niet toe), een gast de bedankpagina met
  ordersleutel (uit `payment_url`, anders via de afreken-pagina-ID). De
  pagina-ID's en endpoint-slugs komen uit `wc/v3/settings/advanced`
  (`haalWcPaginas` in `utils/wcOrderImport.ts`, één verzoek per import;
  mislukt = stil overslaan, nooit de import laten falen). Nooit gegokt:
  zonder link en zonder sjabloon geen knop); `MailModal` rendert de
  `linkButtons` (afhaalknop eerst, dan de orderknop) als knoppen in de HTML en als regel + kale link in de platte tekst
- **Periodiek ophalen** (`woocommerce_creds.importInterval`, minuten, default 15,
  0 = uit): App.tsx importeert elke N minuten zelf (`autoImportWc`, dezelfde
  `importeerWcOrders` als de knop) zolang een tabblad open staat en de rol mag
  schrijven; een lease in `wc_import_status` houdt tabbladen uit elkaar, en
  `verwijderDubbeleWcOrders` ruimt een onaangeroerde dubbel (status `nieuw`,
  geen picks, geen factuur) op als twee tabbladen toch tegelijk waren. De
  server-thread `_wc_orders_loop` kijkt in hetzelfde ritme of er webshoporders
  zijn die hier nog ontbreken, stuurt daar één HA-melding over en zet ze in
  `wc_import_status.nieuw`; de app importeert dan meteen en de Verkoop-header
  telt ze (`attentie_webshop_nieuw`). Een servertick importeert bewust niet
  zelf: de artikel-/merchherkenning leeft in de app
- **Terugschrijven** (`utils/wcTerugschrijven.ts`, instelling
  `woocommerce_creds.terugschrijven`, standaard uit): `verzonden`/`afgerond` →
  `PUT orders/<id> {status: completed}` (+ privé-ordernotitie met de track &
  trace via `POST orders/<id>/notes`, `customer_note: false`), `geannuleerd` →
  `cancelled`. **Voorraadregel:** WooCommerce boekt bij `cancelled` de
  voorraad terug; dat klopt alleen zolang er in BrewAdmin nog niets is
  uitgeslagen (dan valt hier de reservering weg en stijgt de volgende
  voorraadpush evenveel). Is er al uitgeslagen, dan gaat er géén status maar
  alleen een notitie — anders komt bier te koop dat er niet meer is. De
  uitkomst staat als `wc_sync` op de bestelling (badge + knop "opnieuw").
  Altijd fire-and-forget ná de lokale statuswijziging. `completed` laat
  WooCommerce zelf de klantmail "Voltooide bestelling" sturen — de
  instellingen vragen die uit te zetten, BrewAdmin's verzendbevestiging is
  leidend
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
  artikelformulier — niet in een apart webshopscherm. De productpagina toont
  het bier meteen zoals de webshop dat doet (`components/BierInfoWeergave.tsx`:
  cijferstrip, smaakbalken, spectabel, tekstblokken); `weergave` op de
  velddefinitie bepaalt waar een veld belandt.
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
- **Website-telemetrie** (server: `_website_tick`/`_website_loop`, thread
  `website`; UI: `components/WebsiteTelemetrie.tsx`; standaard uit): elk
  interval (default 60 min, 15–240) een momentopname naar de plugin
  **Craftery Brouwerij 1.1.0+** op `{storeUrl}/wp-json/wc-craftery/v1/brouwerij`,
  met dezelfde consumer key via `_wc_request(..., api_pad=WEBSITE_API_PATH)`.
  Een POST vervangt het vorige bericht helemaal; zonder herkansing (de volgende
  ronde komt vanzelf). `_website_bericht` is een pure functie (data + live
  HA-staat in, dict uit) en haalt alle grenzen van het contract (8 tanks,
  tank 12 / bier 60 tekens, temp −30…120, sensoren 0…999, 20 waarden met naam
  `[a-z0-9_]{1,32}`, 8 kB). Alleen wat per onderdeel aan staat gaat mee, en
  alleen afgeleide échte getallen: temperatuur live van de sensor, anders een
  `gist_metingen`-rij van hooguit twee uur oud, anders niets; koeling/
  verwarming gaat niet mee (de app kent geen percentage). `liters_verpakt`
  gebruikt `_voorraad_per_locatie`, de **Python-spiegel van
  `voorraadPerLocatie`** — wijzig je die in `calculations.ts`, wijzig hem daar
  ook (idem `_tank_rest_volume` ↔ `tankRestVolume`). Uitgezet terwijl er
  cijfers op de site staan (`op_site`) → één leeg bericht `{}`.
  **Nooit** klanten, bestellingen, prijzen, recepten of financiële data in het
  bericht zetten
- Afbeeldingen zijn verwijzingen, geen uploads: de WC REST API accepteert een
  media-`id` of een publieke `src`-URL. Base64 uit deze app kan er niet in —
  uploaden blijft WordPress-werk

### Claude AI (Anthropic)

- Used for: de inkoopfactuur (PDF of foto's), foto's van het etiket op een zak (lotnummer, THT, eigenschappen),
  het waterrapport (Gereedschap → Waterprofiel) en het uitbetalingsverslag van een PSP als de tekstlaag van de
  PDF niets oplevert (Bank: scan, foto's, onbekende opmaak — `utils/pspVerslagScan.ts`)
- Eén plek: `utils/claudeScan.ts` (`voerScanUit`). Gestructureerde uitvoer via `output_config.format`
  (`json_schema`), **geen temperature** en **geen geforceerde tool-aanroep** (de huidige modellen weigeren
  beide met een 400), `max_tokens` 16k (het nadenken telt mee), `stop_reason` `max_tokens`/`refusal` →
  `ScanFout`. Modelketen `SCAN_MODELLEN`; een volgend model alleen bij "niet beschikbaar" (404/`not_found_error`,
  of 400/403 die het model noemt) — nooit op tekst raden. De oude regel `/not_found|model/i` liet elke scan
  stil op het kleinste model draaien
- Schema's zonder optionele velden en zonder null (grens: 24 optionele / 16 keuze-typen): "staat er niet" is
  `""`, `0` of `false`. De opschoning (`normaliseer…`) maakt daar null van
- Een PDF gaat als `document`-blok mee (tekst én opmaak; geen beta-header nodig), foto's als JPEG ≤ 2576 px
  (`utils/afbeelding.ts`), de inhoud vóór de vraag. Zonder sleutel: lokaal alleen datum + factuurnummer uit de
  PDF-tekst
- API-key in de secure key `claude_creds`; de proxy (`_claude_proxy`) voegt hem server-side toe, stuurt de
  beta-header `server-side-fallback-2026-07-01` mee (spiegel van `TERUGVAL_BETA`, pytest bewaakt dat) en
  wacht `CLAUDE_TIMEOUT` (180 s)
- De scan boekt nooit zelf: hij vult het formulier, de gebruiker controleert en slaat op. Wat de gebruiker al
  invulde, overschrijft een (latere) scan niet

### Facturen per e-mail (postvak, IMAP)

- **Waarom pollen:** de addon is doorgaans niet publiek bereikbaar en kan dus geen mail *ontvangen*. De brouwer stuurt een inkoopfactuur door naar een eigen postvak; de server-thread `inbox` (`_inbox_loop` → `_inbox_tick`, interval `imap_creds.interval`, standaard 15 min) haalt de PDF-bijlagen er zelf uit via `imaplib` (stdlib). Postvakken die alleen met OAuth werken (Microsoft 365, Outlook.com) kunnen niet; Gmail kan met een app-wachtwoord
- **Alleen lezen, waterlijn per map:** de map gaat met EXAMINE open; niets wordt als gelezen gemarkeerd, verplaatst of verwijderd. Wat al bekeken is staat als UID-waterlijn (`uidvalidity` + `laatste_uid`, per `mailbox`) in `inkoop_inbox_status`; `UID n:*` geeft altijd minstens het laatste bericht, dus filter op `uid > waterlijn`. Wisselt de map of de UIDVALIDITY, dan begint hij opnieuw (een server die UIDVALIDITY niet meldt houdt zijn waterlijn: `None` == `None`). Een mapnaam mag alles zijn behalve stuurtekens, aanhalingsteken en backslash (`[Gmail]/Alle berichten`, `Facturen ë`); niet-ASCII gaat als modified UTF-7 (`_inbox_imap_utf7`), `IMAP_MAP_RE` in `utils/inkoopInbox.ts` spiegelt de regex. De allereerste ronde in een map kijkt naar de nieuwste 50 berichten (`INBOX_MAX_BERICHTEN`), latere rondes nemen hooguit 50 nieuwe tegelijk mee — de rest volgt de volgende ronde
- **Nooit twee keer dezelfde PDF:** `sha256` van de bytes tegen alle items in `inkoop_inbox` (ook genegeerd of verwerkt). Definitief verwijderen van een genegeerd item (record + bestand) maakt hem weer importeerbaar — dat is bedoeld
- **Wat er in komt:** `_inbox_lees_bericht` (zuivere functie) zoekt in het hele bericht, ook in een als bijlage doorgestuurd bericht (`message/rfc822`). Overgeslagen berichten krijgen een reden (`geen_pdf`, `afzender`, `te_groot`, `te_veel`, `onleesbaar`, `dubbel`) in `inkoop_inbox_status.overgeslagen` en dus zichtbaar onder Facturen › Inkoop › *Te verwerken* en in de instellingen — een doorgestuurde factuur die niet verschijnt moet altijd te verklaren zijn. Het afzenderfilter (`afzenders`: adressen of `@domein`; leeg = iedereen) kijkt naar de afzender van de doorstuurmail, niet naar die van de leverancier; het is geen echte beveiliging (een afzender is te vervalsen)
- **Verwerken = het gewone inkoopformulier:** Facturen › Inkoop → status *Te verwerken* (de chip, of `{pagina:'facturen', tab:'inkoop', filter:'te_verwerken'}`) → *Verwerk* opent `InkoopFactuurModal` met `inboxItem`: de PDF wordt geladen, naast het formulier gezet en meteen gescand. Bij opslaan wijst de factuur naar **hetzelfde bestand** (`bijlage` = `inboxItem.bijlage`, geen tweede upload) en wordt het item `verwerkt` met `factuur_id`. `_bijlage_in_gebruik` telt `inkoop_inbox` mee, dus zo'n bestand gaat nooit weg zolang het item of de factuur ernaar wijst. Wordt de factuur verwijderd, dan komt het item terug op de wachtlijst (`inboxFactuurVerwijderd`). Wachten er meer, dan biedt het formulier *Opslaan en volgende*: de pagina opent meteen het volgende item (de modal is per item gesleuteld, `key={inboxVerwerk.id}`). Zonder leverancier én factuurnummer maakt de pagina geen factuur; voor een postvak-item boekt ze dan ook geen voorraad en blijft het formulier open (`inbox_vul_factuurgegevens`) — anders stonden de lots er al in terwijl het item op `nieuw` bleef en het volgende verwerken ze nog eens boekte
- **Er wordt niets automatisch geboekt.** Ook niet als de scan alles goed heeft: het postvak is een wachtrij, de boeking blijft een handeling van een mens
- **Zichtbaarheid:** "n te verwerken" op het segment Inkoop en de chip *Te verwerken*, attentiepost `inkoop_inbox` (werkruimte Administratie; het postvak is één rij en telt dus 1 in de badge, label `attentie_postvak`), een rij op het Administratie-dashboard (`beslissingen.ts`, `wacht_op_jou`) en één HA-melding per ophaalronde met nieuwe facturen (`notificatie_instellingen`). Een fout van de laatste ronde (`fout.code`: `verbinding`, `certificaat`, `tls`, `login`, `map`, `protocol`, `opslag`, `vol`) staat op de kaart met — bij een instellingsfout — een link die naar de kaart in Instellingen → Koppelingen scrolt; op Inkoop staat dan ook een rode regel "Postvak: …" die naar *Te verwerken* springt, zodat een kapot postvak niet achter de chip verdwijnt
- **Rollen:** `imap_creds` en `inkoop_inbox_status` alleen `beheer` (in `_BEHEER_KEYS`; `utils/rollen.ts` spiegelt), `inkoop_inbox` is financieel (`boekhouding` + `beheer`). *Test verbinding* is beheer-only, *Nu ophalen* ook voor `boekhouding`

### Mollie (betaallink op facturen)

- Used for: online betaallink (iDEAL, creditcard, Bancontact …) op **verkoop­facturen** die per mail worden verstuurd
- API-key + `enabled` + `redirectUrl` in de secure key `mollie_creds`; server voegt de key server-side toe (proxy — key nooit naar de browser)
- Flow: `mailVerkoopFactuur` (`pages/admin/FacturenSectie.tsx`) bouwt de Mollie-context (bedrag in centen, omschrijving, redirect-URL) → `MailModal` toont een checkbox **"Mollie betaallink toevoegen"** → bij verzenden roept `mollieCreatePayment` (`POST /api/mollie/payment`) de betaal-URL op → knop in de HTML-mail (`buildMailHtml` `payButton`) + kale link in de platte tekst
- Server gebruikt de **Payment Links API** (`/v2/payment-links`), niet de Payments API: een betaallink **verloopt standaard niet** en blijft geldig tot de klant betaalt. De deelbare URL komt uit `_links.paymentLink.href` (pure helper `_mollie_link_url`). Een Payments-checkout zou kortlevend zijn en na verlopen naar de `redirectUrl` (de website/homepagina) leiden
- **Eén link per factuur** (`utils/mollieLink.ts`): omdat een link niet verloopt, komt de eerste link op de verkoopfactuur (`mollie_link: {id, url, amount_cent, aangemaakt}`) en gebruikt elke volgende mail (herinnering, aanmaning, opnieuw versturen) díe link zolang de factuur openstaat en het bedrag gelijk is (`herbruikbareBetaallink`). Maak nooit per mail een nieuwe link: twee links = de klant kan dezelfde factuur twee keer betalen. Een link die na betaling via de bank of een creditnota nog openstaat, wordt (nog) niet bij Mollie gearchiveerd
- Redirect-URL valt terug op `brewery_details.website`; zonder een geldige URL blijft de checkbox uitgeschakeld (Mollie vereist een `redirectUrl`)
- Betaling-terugkoppeling loopt via de bestaande **PSP-bankreconciliatie** (`bank.ts`): een Mollie-uitbetaling op het afschrift wordt aan de factuur/facturen gekoppeld — er is (bewust) geen webhook, want de addon is doorgaans niet publiek bereikbaar. Met het **uitbetalingsverslag** (PDF) erbij zoekt de app de facturen zelf (`utils/pspVerslag.ts`: "Factuur F2026-0044" = de betaallink, "Bestelling 3289" = de webshoporder) en worden de ingehouden kosten verrekend met de maandfactuur van Mollie (`utils/pspUitbetaling.ts`, zie "`bankKoppelingen` — koppelingtypen"). Een betaalde bestelling die nog niet is afgerond (de klant heeft hem nog niet opgehaald) heeft nog geen factuur: het venster noemt die regel `geen_factuur` en maakt de factuur met één klik (`teFacturerenUitVerslag` + `bouwOrderFactuur`); de order blijft open

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
- Fallback chain: requested lang → Dutch → `fallback`-argument → key name
- **Sleutel uit data opgebouwd? Geef een fallback mee:** `t(\`orders_status_${s}\`, s)`.
  `t()` geeft bij een missende sleutel de sleutelnaam terug — een niet-lege,
  dus truthy string. `t(...) || s` vangt dat níét af en zet een rauwe
  `orders_status_iets` in beeld. Het tweede argument doet dat wel
- Language stored in `localStorage` under `lang`; `setLang` zet ook
  `document.documentElement.lang` (schermlezers)
- **When adding UI text:** always add keys to all 5 translation files

---

## Adding New Features — Checklist

1. **Type first:** add new interfaces to `src/types/index.ts`
2. **Constants:** add new enums/mappings to `src/utils/constants.ts`
3. **Translations:** add i18n keys to all 5 `src/i18n/*.json` files
4. **Page component:** create in `src/pages/` following existing patterns (Administratie: een sectie in `src/pages/admin/`, lijsten volgens "Administratie — patronen")
5. **Navigation:** register page in `App.tsx` nav array (`navPerWerkruimte`) and in `PAGINA_WERKRUIMTE` (`utils/route.ts`); een pagina die verdwijnt of verhuist krijgt een regel in `PAGINA_ALIAS`/`resolveerDoel`, zodat oude links blijven werken
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
