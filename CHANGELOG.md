# Changelog

All notable changes to this project are documented here.

---

## [1.10.53] — 2026-07-06

### Verbeterd — Verlegde BTW zichtbaar in de factuurmodal + waarschuwing bij 0%-regels

Bij een verlegde factuur (intracommunautair / import) toonde de modal
"BTW: €0,00" en was de zelfberekende BTW voor rubriek 4a/4b nergens
zichtbaar — het leek alsof er niets berekend werd. Bovendien telde een
verlegde regel die (nog) op 0% stond geruisloos voor €0 mee in rubriek
4a/4b. Nu:

- De factuurmodal toont bij verlegde BTW een paars informatieblok onder de
  totalen: **"Zelf aan te geven BTW (rubriek 4a/4b): €X"** met uitsplitsing
  per tarief, plus uitleg dat dit bedrag niet in de factuurtotalen zit
  (verschuldigd én voorbelasting, per saldo €0).
- Staan er verlegde regels op 0%, dan verschijnt daar een waarschuwing met
  het bedrag en een knop **"Vul standaardtarieven"** (ingrediënten volgens
  ingrediënttype, onderdelen/overig 21%). Handig ook om een eerder
  opgeslagen factuur te repareren: openen → knop → opslaan.
- Het rubriek 4a/4b-kaartje in de BTW-aangifte waarschuwt wanneer er
  verlegde regels op 0% in de periode zitten, met het bedrag waarover geen
  BTW wordt berekend.

## [1.10.52] — 2026-07-06

### Verbeterd — Factuurscan herkent verlegde BTW (intracommunautaire verwerving)

Bij een intracommunautaire verwerving of import van buiten de EU staat 0%
BTW op de factuur, terwijl voor de aangifte (rubriek 4a/4b) het Nederlandse
tarief zelf berekend moet worden. De scan hield daar geen rekening mee:
regels kregen het gescande 0% en de BTW-soort bleef op "Binnenlands" staan.
Nu:

- **De scan herkent verlegde BTW** (0% BTW plus signalen als
  "intracommunautaire levering", "BTW verlegd", "reverse charge",
  buitenlands BTW-nummer) en zet de BTW-soort automatisch op
  Intracommunautair (EU) of Import (niet-EU). Een handmatige keuze van de
  gebruiker wordt nooit overschreven.
- **Bij verlegde BTW vult de scan per regel het Nederlandse tarief in** in
  plaats van het gescande 0%: voor ingrediënten het standaard-BTW% per
  ingrediënttype (instelbaar; anders 9%), voor onderdelen en overige regels
  21%. Zo klopt de zelfberekende BTW in rubriek 4a/4b direct.
- **Handmatig omzetten** van Binnenlands naar een verlegde soort terwijl er
  regels op 0% staan: de app biedt aan om die regels met het
  standaardtarief te vullen.

## [1.10.51] — 2026-07-06

### Toegevoegd — Factuurregels verplaatsen tussen categorieën + zelflerende scan

Een verkeerd ingedeelde regel (bijv. een product dat als onderdeel werd
gezien terwijl het een vrije regel moest zijn) is nu direct te corrigeren:

- Elke regel in de toegevoegde-productenlijst heeft een **⇄-knopje** waarmee
  je hem naar één van de andere twee categorieën verplaatst (ingrediënt ↔
  onderdeel ↔ vrije regel, alle richtingen). Bij het verplaatsen wordt
  automatisch geprobeerd te koppelen aan een bestaand ingredient/onderdeel.
- Een vrije regel heeft geen hoeveelheid; bij verplaatsen náár ingrediënt of
  onderdeel wordt het invoerformulier voorgevuld (incl. gescande hoeveelheid
  en eenheid als die bekend zijn) zodat je alleen hoeft aan te vullen en op
  "Toevoegen" te klikken.
- **De scan leert van je correcties.** Elke verplaatsing wordt opgeslagen
  (nieuwe datasleutel `scan_correcties`, max. 300, zit in de Excel-backup).
  Bij een volgende scan krijgt de AI de eerdere correcties mee in de prompt
  én overrulet de app de classificatie lokaal wanneer dezelfde omschrijving
  opnieuw voorkomt — die regel komt dan meteen in de juiste categorie.

## [1.10.50] — 2026-07-06

### Verbeterd — Factuurscan koppelt regels aan ingrediënten en onderdelen

De factuurscan zette elke herkende regel op het tabblad **Vrije regels**,
waarna alles handmatig verplaatst moest worden. De scan verdeelt de regels
nu automatisch:

- **Ingrediëntregels** (mout, hop, gist, …) komen op het ingrediënten-tabblad
  terecht, mét hoeveelheid, eenheid, prijs per eenheid en BTW. Bestaat het
  ingredient al, dan wordt de regel eraan gekoppeld (het lot komt bij het
  juiste ingredient); anders wordt de regel als nieuw ingredient voorgesteld.
- **Onderdeelregels** (flessen, blikken, kroonkurken, etiketten, …) komen op
  het onderdelen-tabblad en worden gekoppeld aan het bestaande onderdeel
  zodat de voorraad op het juiste product bijgeboekt wordt; onbekende
  onderdelen worden als nieuw onderdeel voorgesteld.
- Alleen wat écht overig is (statiegeld, transport, kortingen, diensten)
  blijft een vrije regel — met een passende kostensoort voorgeselecteerd.

Het herkennen gebeurt op twee manieren: de AI-scan krijgt de lijst met
bekende ingrediënten en onderdelen mee en wijst zelf de match aan, en als
vangnet matcht de app lokaal op (genormaliseerde) naam. Regels zonder
bruikbare hoeveelheid of met een negatief bedrag blijven bewust vrije
regels, zodat er nooit een onbetrouwbare voorraadmutatie ontstaat. De
melding na de scan toont de verdeling over de drie tabbladen.

## [1.10.49] — 2026-07-06

### Toegevoegd — Vast kortingspercentage per klant (niet op verzendkosten)

Op de klantkaart staat een nieuw veld **"Vaste korting (%)"**. Bij het
aanmaken van een handmatige bestelling voor die klant (herkend op e-mail,
anders op exacte naam) wordt de korting automatisch als negatieve
kortingsregel toegevoegd — berekend over de productregels, bewust **niet**
over de verzendkosten. Bij gemengde BTW-tarieven komt er één kortingsregel
per tarief zodat de BTW-aangifte blijft kloppen. Het bestelformulier toont
vooraf een melding dat de korting toegepast gaat worden, en op de
orderdetail is de kortingsregel herkenbaar aan een %-teken.

### Verbeterd — Kosten en marges zichtbaar bij artikelen/SKU's

Bij Producten → Artikelen was de marge maar een kaal percentage. Nu:

- **Tijdens het aanmaken/bewerken** van een artikel verschijnt direct een
  live inschatting: kostprijs per stuk (kostprijs/liter van het product ×
  inhoud van de gekozen verpakking — inclusief ingrediënten, utility,
  verpakking én accijns) en de marge in % en € voor zowel de consumenten-
  als de B2B-prijs. De berekening respecteert de incl/excl-BTW-toggles.
- De **artikeltabel** kreeg een kolom "Kostprijs/stuk" en toont de marge nu
  in % én € (groen/rood), met de B2B-marge eronder.
- Is er nog geen kostprijs (geen afgevulde batch), dan legt een hint dat uit
  in plaats van stil niets te tonen.

---

## [1.10.48] — 2026-07-06

### Toegevoegd — Verkoopfactuur verrekenen met alt-rekening-schuld (aflossing in natura)

Bier leveren en dat als aflossing van de schuld aan bijv. je privérekening
laten tellen, in plaats van een bankbetaling te ontvangen:

- Op een openstaande verkoopfactuur (Boekhouding → Verkoop) staat nu een
  knop **"Verrekenen"** (zichtbaar zodra er alternatieve betaalrekeningen
  bestaan). Kies de rekening: de factuur gaat op **betaald** en het
  **brutobedrag** wordt als aflossing van die schuld geteld.
- De openstaande schuld daalt overal mee: balans (passiva), Bank-tab en de
  rekeningtabel in Instellingen (met de openstaande schuld per rekening ook
  zichtbaar in de keuzemodal).
- De verrekende factuur toont een paars "Verrekend met …"-label; via het
  ×-je is de verrekening ongedaan te maken (factuur terug naar open, schuld
  weer omhoog).
- Omzet, BTW en accijns blijven gewoon via de normale factuur-/bestelflow
  lopen — de verrekening raakt alleen de betaalkant. Zo blijft een levering
  aan de eigenaar fiscaal correct (BTW over de verkoop, accijns via
  picking/uitslag).

---

## [1.10.47] — 2026-07-06

### Toegevoegd — Accijnsbetaling achteraf koppelen op betaalde maanden

Maanden die al (handmatig) op **betaald** stonden vóórdat de accijns-
bankkoppeling bestond, konden het betaalbewijs niet meer koppelen: de
selector verscheen alleen bij status "ingediend". Op zo'n maandkaart
verschijnt nu alsnog de koppel-selector met een hint ("koppel alsnog het
betaalbewijs"), inclusief voorgestelde matches op het maandbedrag. Bij het
koppelen wordt de betaaldatum van de aangifte bijgewerkt naar de werkelijke
transactiedatum. Dit werkt ook voor oude maanden van vóór de
aangifte-workflow (records betaald zonder aangifte-record).

---

## [1.10.46] — 2026-07-06

### Verbeterd — Factuurscanner (AI) fors betrouwbaarder

De AI-factuurscan was onbetrouwbaar door een stapeling van oorzaken; die zijn
stuk voor stuk aangepakt:

- **Gegarandeerd geldige uitvoer.** De scan dwingt nu structured output af via
  tool-use (`tool_choice`) — de API valideert het antwoord tegen een schema.
  Voorheen werd JSON met een regex uit vrije tekst gevist, wat regelmatig
  misging.
- **Deterministische extractie.** `temperature: 0` in plaats van de default
  (1.0) — dezelfde factuur gaf voorheen wisselende resultaten.
- **Beter model.** Scans draaien nu op Claude Sonnet (aanzienlijk sterker op
  gescande/gefotografeerde facturen), met automatische terugval op Haiku als
  de API-sleutel dat model niet ondersteunt.
- **Slimmere prompt.** Expliciete Nederlandse factuurregels: factuurdatum ≠
  vervaldatum, factuurnummer ≠ klant-/order-/BTW-nummer, leverancier = de
  afzender (nooit de eigen brouwerij — de brouwerijnaam gaat mee als context)
  en herkenning van bekende leveranciers zodat de schrijfwijze consistent
  blijft. Ook Nederlandse bedragnotatie (1.234,56) wordt benoemd.
- **Factuurregels worden nu ook gescand.** Naast leverancier/nummer/datum
  neemt de scan de factuurregels over als vrije regels (omschrijving, netto,
  BTW%) — alleen wanneer er nog niets handmatig is ingevoerd. Het tabblad
  springt naar de regels en een melding vraagt om controle.
- **Leesbare foutmeldingen.** API-fouten toonden "[object Object]"; nu de
  echte foutmelding (bijv. ongeldige API-sleutel).

---

## [1.10.45] — 2026-07-06

### Toegevoegd — Accijnsbetaling koppelen aan een banktransactie

De accijnsaangifte kent nu hetzelfde bankkoppelingspad als de BTW-aangifte:

- Bij **"markeer als ingediend"** wordt het maandtotaal als aangiftebedrag
  vastgelegd.
- Bij MT940-import wordt een debettransactie **automatisch gematcht** op een
  ingediende accijnsaangifte (±€1 tolerantie); handmatig koppelen kan via een
  selector op de maandkaart van de Accijns-pagina (voorgestelde matches
  bovenaan).
- Bij het koppelen gaat de aangifte naar **betaald** en worden alle
  accijnsrecords van de maand betaald gemarkeerd met de **werkelijke
  transactiedatum** als betaaldatum (voorheen: de dag van aanklikken) — beter
  audittrail richting Douane, met de banktransactie als betaalbewijs.
- Ontkoppelen draait de status terug naar "ingediend" en herstelt de
  betaald-vlaggen. Koppelingen overleven een MT940-herimport.
- In de banktransactielijst toont een gekoppelde accijnsbetaling een eigen
  "✓ Accijns"-label.

De knop "markeer als betaald" blijft werken als handmatige fallback zonder
bankafschrift.

### Gerepareerd — BTW-teruggave was niet te koppelen

Een aangifte met negatief bedrag (teruggave) wordt door de Belastingdienst
**uitbetaald** en komt dus als credittransactie binnen. De koppel-selector op
de periodekaart en de automatische matching keken alleen naar
debettransacties, waardoor een teruggave nooit te koppelen was en de periode
op "Openstaand" bleef staan. Nu:

- Bij een teruggave toont de selector **credittransacties** ("Koppel
  teruggave") en matcht de MT940-import automatisch op binnenkomende
  betalingen.
- Een positieve aangifte matcht alleen nog op debet-, een negatieve alleen op
  credittransacties (voorheen kon een teruggave per ongeluk aan een
  debettransactie van hetzelfde bedrag gematcht worden).
- De gekoppelde teruggave is ook zichtbaar (en te ontkoppelen) op de
  creditregel in de banktransactielijst.

---

## [1.10.44] — 2026-07-06

### Gerepareerd — WooCommerce-voorraadpush pushte te weinig (of 0)

Twee oorzaken gevonden en verholpen:

1. **Verkeerde artikel↔afvulling-matching.** De push zocht afvullingen
   uitsluitend via de *batch* (batch-productkoppeling of batchnaam ==
   productnaam). Maar bij het afvullen wordt het product juist op de
   *afvulling* gezet (product + artikel-SKU), niet op de batch. Afvullingen
   van batches zonder productkoppeling telden daardoor niet mee en er werd
   te weinig — vaak 0 — naar WooCommerce gepusht. De matching gebruikt nu
   dezelfde drie tiers als de bestellingenpagina: eerst de artikel-SKU op de
   afvulling, dan het product op de afvulling, pas daarna de batch. De
   verpakkingsmatch is bovendien hoofdletterongevoelig gemaakt.

2. **Dubbeltelling tussen picken en afronden.** Bij volledig picken worden
   uitslag-records aangemaakt, maar de picks bleven óók als reservering
   meetellen totdat de order werd afgerond. De beschikbare voorraad (en dus
   de push) was in die periode dubbel verlaagd. Picks waarvoor al een
   uitslag bestaat tellen nu niet meer mee als aparte reservering — dit is
   ook rechtgetrokken in het voorraadoverzicht op de productpagina en in de
   beschikbaarheidscontrole bij het picken.

Daarnaast logt de push nu een waarschuwing in het WC-logboek wanneer een
SKU niet in WooCommerce gevonden wordt, in plaats van het artikel stil over
te slaan.

---

## [1.10.43] — 2026-07-06

### Gewijzigd — WooCommerce-import: privé/zakelijk-detectie gerepareerd

Elke WooCommerce-order werd bij import onterecht als **zakelijk** gemarkeerd.
Oorzaak: de BTW-nummer-detectie matchte op élke metadata-key met "vat" of
"btw" erin, en WooCommerce zet standaard op iedere order de meta
`is_vat_exempt: "no"` — waardoor altijd een "BTW-nummer" gevonden werd. De
detectie kijkt nu alleen naar échte BTW-nummervelden (zoals
`_billing_vat_number`, `billing_eu_vat_number`, `btw_nummer`) en eist dat de
waarde op een BTW-nummer lijkt. Een order is nu alleen zakelijk als er een
bedrijfsnaam of geldig BTW-nummer op staat.

Daarnaast kan het klanttype (privé/zakelijk) van een bestaande order nu op de
orderdetailpagina gecorrigeerd worden zolang er nog niet gepickt is — daarna
is het bevroren omdat de AGP-allocatie erop is gebaseerd.

### Toegevoegd — Voorraadreservering voor open bestellingen

Geïmporteerde (en handmatige) bestellingen reserveren het bestelde bier nu
direct in de voorraad, net zoals WooCommerce zelf de voorraad verlaagt zodra
een bestelling binnenkomt:

- Op de productpagina toont het voorraadoverzicht per verpakkingstype een
  nieuwe telling **"In bestellingen"** (nog niet gepickte regels van open
  orders) en is **"Beschikbaar"** verlaagd met die reservering. De
  voorraad-statistiek van het product rekent de reservering ook mee.
- De **WooCommerce-voorraadpush** trekt de open reserveringen af van de
  gepushte aantallen. Voorheen zette een push de voorraad in WooCommerce
  terug omhoog terwijl daar al een bestelling op die voorraad liep
  (oversell-risico).
- Zodra een regel gepickt is, gaat de reservering over in de bestaande
  "Gereserveerd"-telling (picks); dubbeltellen wordt voorkomen.

---

## [1.10.42] — 2026-07-02

### Toegevoegd — BTW corrigeren op een reeds afgeronde bestelling

Een afgeronde bestelling is normaal vergrendeld, maar een verkeerd
geïmporteerd BTW-tarief (bijv. bier op 9% i.p.v. 21%) moest alsnog te
herstellen zijn. Via de knop **"BTW corrigeren"** in de kop van de
orderregeltabel ontgrendel je bewust de BTW-dropdown op een afgeronde order.

Belangrijk: bij het afronden wordt een verkoopfactuur opgesteld die een
bevroren kopie is van de orderregels, en de BTW-aangifte leest uit die factuur.
De correctie werkt daarom **ook de gekoppelde verkoopfactuur bij** — inclusief
herberekende btw-bedragen, btw-overzicht en totalen — zodat de BTW-aangifte weer
klopt. De wijziging wordt vastgelegd in de audit-log.

---

## [1.10.41] — 2026-07-02

### Toegevoegd — BTW-tarief per orderregel aanpasbaar

Op een bestaande bestelling kun je nu per regel het BTW-tarief wijzigen via een
dropdown in de orderregeltabel (tarieven uit je BTW-instellingen). Zo corrigeer
je bijvoorbeeld een WooCommerce-import waarbij bier op 9% i.p.v. 21% stond,
zonder de bestelling opnieuw te hoeven importeren. Aanpassen kan zolang de
bestelling niet is afgerond of geannuleerd.

### Fixed — Product toonde "0 batches" na afvullen

Een product dat tijdens het afvullen aan een batch werd gekoppeld, toonde op de
Productenpagina "0 batches gebrouwen". De telling keek alleen naar
`batch.product_id`, terwijl de koppeling bij afvullen op de afvulling wordt
gezet. De telling neemt nu ook batches mee die via een afvulling aan het product
hangen.

### Fixed — App crashte bij uploaden van een productfoto

Een productfoto werd ongecomprimeerd (volledige base64) in de lokale opslag
bewaard; een grote foto overschreed de localStorage-quota, wat een onafgevangen
fout en een crash gaf. Foto's worden nu vóór opslag verkleind (max 1000 px) en
als JPEG gecomprimeerd, en een volle localStorage laat de app niet langer
crashen.

---

## [1.10.40] — 2026-07-02

### Fixed — WooCommerce-import zette bier met 21% BTW op 9%

Bij het importeren van WooCommerce-bestellingen kregen alle regels het lage
tarief van 9% BTW, ook bier dat op 21% hoort. Oorzaak: de import las het
BTW-tarief uit het niet-bestaande veld `art.btw` (het artikelveld heet
`btw_pct`), waardoor de code altijd terugviel op de hardcoded `9`.

- **Artikel-tarief wordt nu correct gelezen** via `btw_pct`, zodat bier het
  ingestelde tarief (21%) meekrijgt.
- **Afgeleid tarief als fallback:** is er geen gekoppeld artikel, dan wordt het
  BTW% berekend uit de WooCommerce-belasting op de regel (`total_tax / total`).
- **Standaard 21% i.p.v. 9%** wanneer geen enkele bron een tarief oplevert —
  passend voor bier.

---

## [1.10.39] — 2026-06-15

### Fixed — CO₂-bewaking liet de app vastlopen op opslaan + foute startwaarde

Een carbonisatiesessie met een fout vastgelegd startgewicht (bv. uit een sessie
van vóór de eenheid-fix: `Start 0.02 kg` terwijl de fles 23 kg weegt) bereikte
het doel nooit, waardoor de server `carbonatie_sessies` **elke minuut** bleef
herschrijven en de UI telkens her-renderde — wat als "vastlopen op opslaan"
voelde.

- **Auto-herstel:** is de fles zwaarder dan bij start (> 50 g), dan herijkt de
  server het nulpunt naar de huidige meting. Een mismatch- of verwisselde-fles-
  sessie repareert zichzelf binnen één minuut — herstarten is niet nodig.
- **Geen schrijf-churn meer:** de server schrijft de sessie alleen terug bij een
  echte verandering (≥ 1 g) of wanneer het doel net bereikt is.
- **Frontend pollt gerichter:** de app ververst de sessies alleen nog wanneer er
  daadwerkelijk een actieve bewaakte sessie is.

## [1.10.38] — 2026-06-15

### Fixed — CO₂-eenheid (kg) werd als gram behandeld

De eenheid-keuzelijst toonde standaard "kg" maar sloeg `co2_unit` pas op bij een
actieve wijziging. Een lege waarde werd bij het vastleggen van het startgewicht
als **gram** geïnterpreteerd (alleen exact `kg` telde), terwijl de server juist
kg als standaard nam. Daardoor leek de sensor "in gram" te werken.

- Frontend gaat nu overal uit van **kg als standaard** (gram alleen indien
  expliciet ingesteld), consistent met de server.
- Het flesgewicht in het carbonisatie-blok wordt nu getoond in de gekozen
  eenheid (bv. `6,50 kg` i.p.v. `6500 g`). De *toegevoegde* CO₂ blijft in gram.

> Een carbonisatiesessie die vóór deze fix is gestart heeft het startgewicht in
> de verkeerde eenheid vastgelegd — breek die af en start opnieuw.

## [1.10.37] — 2026-06-15

### Added — Carbonisatiebewaking via CO₂-weegsensor

De carbonisatie-tool kan nu het verbruik van de CO₂-fles live volgen en een
melding geven zodra het berekende doel bereikt is:

- **Instellingen → Home Assistant → CO₂-cilinder weegsensor** — koppel een
  HA-sensor die het flesgewicht meet en kies of die in **kg** of **gram**
  rapporteert (de app rekent intern altijd in gram).
- **Start carbonisatie** legt het flesgewicht vast als nulpunt. De server volgt
  daarna elke minuut het verbruik (start − huidig gewicht) en vergelijkt dit met
  het berekende `doel_co2_gram_verbruik`. Een voortgangsbalk toont het percentage
  in het carbonisatie-blok (Batches én Batchflow). Werkt ook als de browser dicht
  is — de bewaking draait server-side.
- **Instellingen → Meldingen** — nieuwe sectie voor notificaties. Kies een HA
  `notify`-service (bv. `notify.mobile_app_iphone`) en stuur een testmelding.
  Zodra het CO₂-doel bereikt is, verschijnt een melding op het scherm én een
  push naar de gekozen HA-gebruiker. Deze meldingsinstellingen zijn herbruikbaar
  voor toekomstige notificaties.

## [1.10.36] — 2026-06-12

### Added — Batchflow (bèta): volledige werkbladen per fase

Elke fase heeft nu invulvelden en afvinkbare taken voor het hele brouwproces:

- **Gepland** — receptkaart met doelen (OG/FG/ABV/IBU/volume), ingrediëntenlijst
  met voorraadcheck per regel (op voorraad / tekort / geen voorraad), tank- en
  datumkeuze en de Voorbereiding-checklist uit het batch-takensysteem.
- **Brouwen** — chronologisch werkblad: brouwwater (volumes/pH/mineralen) →
  ingrediënten afwegen & per regel afboeken van de voorraad (lot-keuze, zelfde
  FEFO-gedrag als de Batches-pagina) → brouwdag-wizard met maischschema,
  hopschema en meetpunten → wortkoeling → Brouwen/Brouwdag-taken.
- **Vergisten** — vergistingsschema met stap-navigatie (staptemperatuur wordt
  automatisch naar de gekoppelde HA-climate gestuurd), tanktemperatuur lezen
  én setpoint sturen via Home Assistant, fermentatie-progressiebar (OG →
  doel-FG op basis van de laatste meting), snelle metingen + grafiek, dry-hop
  afboeken + dry-hopschema en verliesregistratie (monsters).
- **Conditioneren** — temperatuurcontrols (incl. cold-crash-doel), compacte
  carbonisatiesessies (start/voltooi/afbreek met drukberekening), definitieve
  ABV, verliesregistratie (gist dump e.d.) en tankverplaatsing naar een
  ontsmette bright tank.
- **Afvullen** (hernoemd van "Afgevuld" in de flow) — Botteldag/hygiëne-
  checklist, volledige afvulregistratie (product, verpakking incl. voorraad,
  THT, accijns-voorcalc) en definitieve verliezen met restvolume-indicator.
- **Gereed** (hernoemd van "Gesloten" in de flow) — kerngetallen (OG, FG, ABV,
  rendement, liters, verliezen) en financieel resultaat: kostprijs (brouwkosten
  + verpakking + accijns, per liter/stuk) plus potentiële opbrengst en marge op
  basis van de verkoopprijzen van gekoppelde artikelen.

De fase-checklists zijn per fase gekoppeld aan de juiste takengroepen
(Voorbereiding, Brouwen/Brouwdag, Gisting, Botteldag). De statuslabels elders
in de app blijven ongewijzigd; alleen de flow gebruikt de actiegerichte namen.

Bestanden: `src/pages/BatchFlowPage.tsx`, `src/App.tsx`, `src/i18n/*.json`.

## [1.10.35] — 2026-06-10

### Added — Batches: hoeveelheid aanpasbaar bij het boeken van ingrediënten

In de ingrediëntentabel van een batch is de hoeveelheid nu **inline aan te
passen** zolang de regel nog niet is afgeboekt (klik op het getal en typ een
nieuwe waarde). Wijkt de totale hoeveelheid van een ingredient af van het
gekoppelde recept, dan verschijnt een **subtiele amberkleurige indicator**
(`≠ recept: …`) naast de hoeveelheid, met een tooltip die de receptwaarde
toont. Afgeboekte regels blijven alleen-lezen.

Bestanden: `src/pages/BatchesPage.tsx`, `src/i18n/*.json`.

## [1.10.34] — 2026-06-10

### Changed — Batchflow (bèta): elke fase als inklapbare kaart

De detailweergave toont nu **alle zes fasen als losse inklapbare kaarten** in
plaats van één paneel met een stepper. Daardoor kun je elke fase openen en
bewerken/corrigeren, óók als die nog niet (of niet meer) aan de beurt is:

- De actieve fase klapt automatisch open; de andere staan dicht.
- Open of sluit een kaart via het pijltje in de balk of via de stepper bovenaan.
- Elke kaart toont rechts zijn voortgang (bv. "3/4") en een status-pill
  (Nu / Afgerond / Later).
- Alle invulvelden (tank, datum, OG, FG, ABV, pH's, metingen) zijn in elke
  fase bewerkbaar; de fase-overgangsknoppen blijven alleen op de actieve fase.

Bestanden: `src/pages/BatchFlowPage.tsx`, `src/i18n/*.json`.

## [1.10.33] — 2026-06-10

### Improved — Batchflow (bèta): slimmer invullen

Verfijningen aan het inline-invullen uit 1.10.32:

- **ABV definitief** is nu ook in de Batchflow te bevestigen (met badge,
  log-entry en vergrendeld veld) en weer vrij te geven — net als op de
  Batches-pagina. Voorheen bleef die checklist-regel onbereikbaar.
- **OG invullen berekent automatisch het platogehalte** (zelfde formule als
  de Batches-pagina).
- **Tankkeuze toont de reinigingsstatus** (bv. "FV2 — Vuil") en geeft een
  waarschuwing als de gekozen tank niet ontsmet is; de checklist-status is nu
  vertaald i.p.v. de ruwe waarde.
- **Ongewijzigde velden worden niet meer opgeslagen** (geen overbodige
  server-writes bij het verlaten van een veld).
- **Kook-pH** verschijnt nu ook op de afdruk van een batch.

Bestanden: `src/pages/BatchFlowPage.tsx`, `src/pages/BatchesPage.tsx`,
`src/i18n/*.json`.

## [1.10.32] — 2026-06-10

### Added — Batchflow (bèta): inline invullen + kook-pH

In de Batchflow kun je nu de kerngegevens per fase rechtstreeks invullen
zonder naar de Batches-pagina te springen; het overzicht (fasen-checklist)
vinkt live mee af:

- **Gepland**: tank kiezen en brouwdatum.
- **Brouwen**: OG, vergist volume, maisch-pH en **kook-pH**.
- **Vergisten**: FG.
- **Conditioneren**: ABV en product-pH.

Velden worden bij verlaten (of Enter) opgeslagen, zodat de server niet bij
elke toetsaanslag wordt aangeroepen.

Nieuw batchveld **kook-pH** (`kook_ph`) is ook toegevoegd aan de Batches-pagina
(info-overzicht + bewerkformulier) en aan de Excel-backup.

Bestanden: `src/pages/BatchFlowPage.tsx`, `src/pages/BatchesPage.tsx`,
`src/types/index.ts`, `src/i18n/*.json`.

## [1.10.31] — 2026-06-10

### Fixed — pH-correctie schoot door bij brouwwater

De pH-correctie-tool (1.10.28) gebruikte één rekenmodel voor zowel maisch als
brouwwater. Dat klopt voor maisch/wort (zwaar gebufferd door de mout), maar
schiet fors door bij brouwwater: water heeft nauwelijks buffer en je
neutraliseert er de alkaliniteit (HCO₃⁻), niet een pH-daling. De tool heeft nu
twee modi:

- **Maisch / wort** — onveranderd: volume + huidige pH + doel-pH → dosis schaalt
  met de pH-daling.
- **Brouwwater** — nieuw: volume + alkaliniteit (mg/L CaCO₃) → dosis op basis
  van de te neutraliseren alkaliniteit (1 mEq = 50 mg CaCO₃; effectieve
  zuursterkte ±10,3 mEq/mL voor melkzuur 80%), gedoseerd op ±95% zodat de pH
  niet richting 4,3 doorschiet.

Bestanden: `src/utils/calculations.ts`, `src/utils/constants.ts`,
`src/pages/GereedschapPage.tsx`, `src/i18n/*.json`.

## [1.10.30] — 2026-06-10

### Fixed — Wit scherm in Home Assistant ingress

De security-hardening van 1.10.18 zette `X-Frame-Options: DENY` op elke
response. Home Assistant ingress toont de addon echter in een iframe, dus
elke build vanaf 1.10.18 gaf een wit scherm in HA ("Refused to display …
in a frame"). Dit bleef onopgemerkt doordat de Docker-build sinds 1.10.25
stuk was (gefixt in 1.10.29).

- `X-Frame-Options` is nu `SAMEORIGIN`: de HA-frontend framet de addon
  vanaf dezelfde origin en werkt weer; vreemde sites blijven geblokkeerd.
- CSP uitgebreid met `frame-ancestors 'self'` (het moderne equivalent).

Bestanden: `server.py`.

## [1.10.29] — 2026-06-10

### Fixed — Docker-build van de addon faalde sinds 1.10.25

Sinds 1.10.25 leest `vite.config.ts` de app-versie uit `config.yaml`, maar de
Dockerfile kopieerde dat bestand niet naar de frontend-build-stage. De
addon-build faalde daardoor met `ENOENT: no such file or directory, open
'/build/config.yaml'`. Twee fixes:

- `config.yaml` wordt nu meegekopieerd in de Dockerfile, zodat het juiste
  versienummer in de bundle komt.
- `vite.config.ts` valt terug op `'dev'` als `config.yaml` ontbreekt, zodat
  een ontbrekend bestand de build nooit meer laat crashen.

Bestanden: `Dockerfile`, `vite.config.ts`.

## [1.10.28] — 2026-06-10

### Added — Menu "Gereedschap" met pH-correctie

Nieuw hoofdmenu **Gereedschap** met als eerste tool **pH-correctie**: vul
volume, huidige pH en doel-pH in en kies een zuur (voorlopig melkzuur 80%);
de tool berekent de benodigde dosis in mL en gram, plus een tip om ±80%
vooraf te doseren en daarna bij te meten.

Het rekenmodel is volume-gebaseerd op de brouw-vuistregel (±1 mL melkzuur
88% per 19 L per 0,1 pH, geschaald naar de gekozen concentratie). Zuurmiddelen
staan in `ZUUR_MIDDELEN` (`constants.ts`) zodat extra middelen later met één
regel toegevoegd kunnen worden; de berekening zit in `berekenZuurCorrectie`
(`calculations.ts`).

Bestanden: `src/pages/GereedschapPage.tsx` (nieuw), `src/utils/constants.ts`,
`src/utils/calculations.ts`, `src/App.tsx`, `src/i18n/*.json`.

## [1.10.27] — 2026-06-10

### Added — Fermentatiegrafiek in Batchflow (bèta)

De fermentatiegrafiek (SG/temp/pH met zoom, pan en tooltip) is nu ook
zichtbaar in de Batchflow-fasen Vergisten en Conditioneren. Het
grafiekcomponent is daarvoor uit `BatchesPage.tsx` geëxtraheerd naar het
gedeelde `src/components/batch/FermentatieGrafiek.tsx` — beide pagina's
gebruiken nu exact dezelfde grafiek.

Bestanden: `src/components/batch/FermentatieGrafiek.tsx` (nieuw),
`src/pages/BatchesPage.tsx`, `src/pages/BatchFlowPage.tsx`.

## [1.10.26] — 2026-06-10

### Added — Batchflow (bèta): stapsgewijs door de batch

Nieuwe pagina **Brouwerij → Batchflow (bèta)**: een begeleide, stapsgewijze
weergave die je georganiseerd door de batch heen leidt — van Gepland via
Brouwen, Vergisten en Conditioneren naar Afgevuld en Gesloten.

- Overzicht met voortgangskaarten per actieve batch (fase x van 6).
- Fasen-stepper per batch; eerdere/toekomstige fasen zijn ter referentie te
  bekijken.
- Per fase een automatische checklist op basis van de echte batchdata
  (recept gekoppeld, ingrediënten afgeboekt, OG/FG, SG stabiel,
  carbonatie voltooid, ABV definitief, afvullingen, restvolume).
- Fase-overgangen met bevestiging bij openstaande punten; tank wordt net als
  op de Batches-pagina automatisch op `Vuil` gezet bij vertrek.
- Snelle SG/temp/pH-meting tijdens vergisten/conditioneren en gedeelde
  batchnotities; doorklik naar de volledige Batches-pagina voor de rest.
- Volledig vertaald (nl/en/de/fr/es).

Bestanden: `src/pages/BatchFlowPage.tsx` (nieuw), `src/App.tsx`,
`src/i18n/*.json`.

## [1.10.25] — 2026-06-10

### Fixed — Versienummer in de app liep achter

`__APP_VERSION__` stond hardcoded op `1.8.1` in `vite.config.ts`, waardoor de
UI een verkeerd versienummer toonde. De build leest de versie nu rechtstreeks
uit `config.yaml` (single source of truth), zodat dit niet opnieuw kan
verlopen.

- `vite.config.ts`.

## [1.10.24] — 2026-06-10

### Fixed — BTW-periodestatus gebruikte UTC-datum

Het BTW-aangifte-tabblad bepaalde "vandaag" met `toISOString()` (UTC). Voor
NL/BE (CET/CEST) leverde dat rond middernacht en bij jaar-/kwartaalgrenzen
de verkeerde kalenderdag op, waardoor een periode een dag te vroeg of te
laat als Lopend/Openstaand werd geclassificeerd. Nu via `tod()` (lokale
kalenderdag) uit `format.ts`.

- `src/pages/BoekhoudingPage.tsx`.

## [1.10.23] — 2026-06-10

### Fixed — Lokale PDF-factuur-scan werkte niet (dode pdfjs-dependency)

`extractPdfText()` wachtte op `window.pdfjsLib`, maar niets laadde die global
— de lokale PDF-tekstextractie retourneerde dus altijd een lege string,
waardoor élke PDF-factuur (onnodig) naar de Claude-API ging en gebruikers
zonder Claude-key helemaal niet konden scannen. `pdfjs-dist` wordt nu echt
meegebundeld; de worker draait via een blob-URL (past binnen de CSP
`worker-src blob:`). De `getDocument`-call gebruikt `isEvalSupported: false`
als mitigatie voor CVE-2024-4367 (JS-executie via een kwaadaardig PDF-font).

- `src/components/InkoopFactuurModal.tsx`.

## [1.10.22] — 2026-06-10

### Fixed — Mislukte saves worden automatisch opnieuw geprobeerd

Een POST naar `/api/data/<key>` die faalde (server kort onbereikbaar) liet de
`modified`-vlag permanent op true staan zonder nieuwe poging — de wijziging
stond dan alleen nog in localStorage en kon stil verloren gaan. `useStore`
houdt nu per key de laatste mislukte payload bij en probeert die elke 15
seconden opnieuw; een sequence-nummer per key voorkomt dat een oude retry een
nieuwere save overschrijft.

- `src/utils/api.ts`.

## [1.10.21] — 2026-06-10

### Fixed — `brouwproces_instellingen` ontbrak in Excel-backup

De sleutel `brouwproces_instellingen` (o.a. `hop_storage`) werd door
`doExport`/`doImport` in `App.tsx` wel doorgegeven, maar `excel.ts` schreef
hem niet naar het Instellingen-sheet en las hem niet terug. Hierdoor ging
deze instelling bij elke backup/restore-cyclus verloren.

- `src/utils/excel.ts`.

## [1.10.20] — 2026-06-10

### Security — Custom accijnsformule draait niet langer als JavaScript

De custom accijnsformule werd via `new Function()` als echt JavaScript
uitgevoerd. Omdat `accijns_instellingen` in de Excel-backup zit, kon een
kwaadaardig backup-bestand zo stille code-executie krijgen (toegang tot
`fetch`, `localStorage`, …). De formule gaat nu door een eigen veilige
expressie-evaluator (`evalAccijnsFormule`) die alleen rekenkunde toestaat:
getallen, de variabelen `liter`/`abv`/`hl`/`r1`/`r2`/`plato`, `+ - * / % **`,
vergelijkingen, `&& || !`, ternary en een whitelist van `Math.`-functies.

Tevens gefixt: de formule-preview in Instellingen testte zonder `plato`,
waardoor de preview kon afwijken van de werkelijke berekening — de preview
gebruikt nu exact dezelfde evaluator en parameterset.

- `src/utils/calculations.ts`, `src/pages/InstellingenPage.tsx`.

## [1.10.19] — 2026-06-10

### Security — Stored XSS in pakbon/factuur/herinnering-print verholpen

Klant- en ordervelden uit WooCommerce (bedrijfsnaam, naam, adres, opmerkingen,
biernaam, omschrijvingen) werden zonder HTML-escaping in de print-HTML
geïnterpoleerd die via `document.write` in een same-origin popup wordt gezet.
Een kwaadwillende bestelnaam kon zo scripts uitvoeren in de app-context.
Alle geïnterpoleerde datavelden gaan nu door een `esc()`-helper (zelfde
patroon als `mailTemplate.ts`).

- `src/components/PakbonExport.tsx`.

## [1.10.18] — 2026-06-10

### Security — Server-hardening (security-review)

- **Ingress source-IP-check**: wanneer de app als HA-addon draait
  (`SUPERVISOR_TOKEN` aanwezig) accepteert de server alleen nog requests van
  de HA-ingress-gateway (`172.30.32.2`) en loopback. Voorheen kon elke andere
  addon/container op het interne hassio-netwerk de ongeauthenticeerde API
  benaderen, inclusief opgeslagen credentials en de HA service-call-proxy.
- **CSP aangescherpt**: de CDN-whitelist (`unpkg.com`, `cdn.tailwindcss.com`,
  `cdn.sheetjs.com`) is verwijderd uit `script-src`/`worker-src`/`connect-src`
  — de build is volledig single-file, dus externe scripts zijn nooit nodig.
- **ThreadingHTTPServer**: één trage upstream-call (Claude/Brewfather/SMTP)
  blokkeert niet langer alle andere requests.
- **Atomaire data-writes**: `/api/data/<key>`-saves en interne JSON-writes
  gaan nu via tempbestand + `os.replace` en onder de bestaande `_data_lock`,
  zodat een crash mid-write geen corrupt JSON-bestand achterlaat en
  achtergrondthreads geen halve merges overschrijven.

- `server.py`.

## [1.10.17] — 2026-06-09

### Fixed — Privé-order buiten AGP kon niet afgesloten worden

Bij het picken van een privé-order uit voorraad **buiten de AGP** werden de
uitslagrecords al direct bij het picken aangemaakt (belastbaar feit op moment
van picken). Bij het vervolgens **afsluiten** van de order draaide de privé
pre-flight controle opnieuw over álle picks — óók die al uitgeslagen waren.
Voor die picks was de voorraad-buiten-AGP al afgetrokken, waardoor de controle
de voorraad onterecht als ontoereikend zag en het afsluiten blokkeerde met de
melding "Onvoldoende voorraad buiten AGP".

- De pre-flight in `rondeAf` valideert nu alléén picks die nog géén
  uitslagrecords hebben; reeds uitgeslagen picks (al gevalideerd bij het
  picken) worden niet meer dubbel geteld.

- `src/pages/BestellingenPage.tsx`.

## [1.10.16] — 2026-06-09

### Fixed — Brewfather-sync overschreef de bevestigde definitieve ABV

De Brewfather batch-sync (zowel de automatische in `App.tsx` als de handmatige
`runBfSync` in `BatchesPage.tsx`) zette OG/FG/ABV onvoorwaardelijk terug naar
de Brewfather-waarde. Daardoor werd een door de gebruiker **bevestigde
definitieve ABV** (`abv_definitief`) bij elke sync overschreven met de
Brewfather-/receptwaarde — vandaar dat het ABV-probleem op een afgeronde batch
"terugkeerde".

- Een batch met `abv_definitief` wordt **niet meer overschreven** door de sync.
- Gesynchroniseerde OG/FG (3 dec) en ABV (2 dec) worden nu afgerond, net als
  bij het toepassen van een recept (v1.10.15).

- `src/App.tsx`, `src/pages/BatchesPage.tsx`.

## [1.10.15] — 2026-06-09

### Fixed — Recept koppelen triggerde status-suggestie + OG-afronding

- **Status-suggestie 'Aan het gisten' ging te vroeg af.** De suggestie vuurde
  zodra `OG > 1`, maar dat is ook de overgenomen recept-schatting. Het koppelen
  van een recept suggereerde daardoor meteen 'Aan het gisten'. De suggestie
  verschijnt nu pas wanneer de OG echt gemeten is: status al op 'Brouwen' óf
  de brouwdag afgerond (`brouwdag_voltooid`).
- **OG/FG/ABV werden lelijk afgerond.** Brewfather-recepten kunnen
  floating-point-artefacten teruggeven (bv. `1.0479999…`). Die werden rauw
  overgenomen. OG/FG worden nu op 3 decimalen en ABV op 2 decimalen afgerond,
  zowel bij het toepassen van een recept (`applyReceptToBatch`) als bij de
  Brewfather-mapping (`bfMapRecipe`).

- `src/components/batch/StatusSuggestion.tsx`, `src/pages/BatchesPage.tsx`,
  `src/utils/api.ts`.

## [1.10.14] — 2026-06-09

### Fixed — "Recept toepassen" ook zonder gekoppeld recept

De knop om een recept (opnieuw) op een batch toe te passen verscheen alléén
als de batch al aan een huidig recept gekoppeld was (`recept_id`). Bij een
handmatig aangemaakte batch (of een batch waarvan het recept niet meer als
"huidige" versie bestond) was er dus geen knop — vandaar dat hij niet zichtbaar
was.

De knop verschijnt nu bij elke batch met status **Gepland** zodra er recepten
zijn. Hij opent een **recept-kiezer** (met zoekveld) waarmee je een recept
selecteert; dat wordt gekoppeld (`recept_id`) en de gegevens incl. hopschema
worden overgenomen. Een al gekoppeld recept wordt met "huidig" gemarkeerd.

- `src/pages/BatchesPage.tsx` — `syncReceptToBatch` veralgemeniseerd naar
  `applyReceptToBatch(r)` (zet ook `recept_id`); nieuwe recept-kiezer-modal;
  header-knop toont bij status Gepland (label "Recept toepassen" of, indien al
  gekoppeld, "⟳ Sync recept").
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe `batch_apply_recept*` /
  `batch_recept_picker_*`-sleutels.

## [1.10.13] — 2026-06-09

### Changed — Hopschema bewerkbaar in recept-editor

Onderzoek naar "het hopschema kwam niet goed over" wees uit dat het
overname-pad (recept → batch) de tijden correct mapt (`tijd` → `tijdstip_min`)
in alle drie de routes (Brouwen-vanuit-recept, nieuwe batch, en
recept-opnieuw-toepassen). Het echte gat: **hop-tijden en -gebruik waren in
de recept-editor niet te bewerken** — alleen de ingredient-koppeling. Als de
tijden in een (lokaal) recept ontbraken, kon je ze nergens corrigeren.

- `src/pages/ReceptenPage.tsx` — hop-rijen van de huidige receptversie hebben
  nu een inline-editor voor **gebruik** (koken/whirlpool/dry-hop/maisch) en
  **tijd** (min, of dagen bij dry-hop). Tijd-weergave toont nu ook een waarde
  van 0 (flame-out) i.p.v. die te verbergen.

Workflow: corrigeer het hopschema in het recept en gebruik daarna
**"Recept opnieuw toepassen"** op de batch (beschikbaar zolang de status nog
**Gepland** is, dus vóór 'Brouwen') om de bijgewerkte tijden over te nemen.

## [1.10.12] — 2026-06-09

### Fixed — Carbonatie-kopdruk werd onderschat

`carbDrukBar` gebruikte een lineaire benadering met een te flauwe helling
(0.30 bar per volume CO₂, terwijl de werkelijke ~0.68 bar/vol is). Daardoor
kwam de benodigde kopdruk te laag uit, vooral bij hogere CO₂-volumes
(Belgische stijlen). Vervangen door de standaard carbonatie-vergelijking
`V = (Pg + 14.695)·(0.01821 + 0.09011·e^(−(T_F−32)/43.11)) − 0.003342`,
opgelost naar gauge-druk en omgerekend naar bar.

Voorbeeld (2 °C): 3.5 vols ging van 1.15 bar (16.7 PSI) → 1.38 bar (19.9 PSI);
4.5 vols van 1.45 bar → 2.06 bar. Reeds opgeslagen carbonatie-sessies behouden
hun historische streefdruk; nieuwe sessies en de live-preview gebruiken de
gecorrigeerde formule.

- `src/utils/calculations.ts` — `carbDrukBar` herschreven.

## [1.10.11] — 2026-06-09

### Changed — Notitie-logje standaard ingeklapt

Het notitie-paneel start nu ingeklapt (alleen de balk met de telling); de
in-/uitgeklapte stand wordt nog steeds onthouden.

- `src/pages/BatchesPage.tsx` — default van `batches_notities_ingeklapt` → `true`.

## [1.10.10] — 2026-06-09

### Added — Notitie-logje per batch (altijd zichtbaar)

Je kunt nu heel eenvoudig vrije notities bij een batch maken. Ze komen in een
simpel, getimestampt logje dat **onder de tab-navigatie** staat en dus op
**elk** tabblad zichtbaar is — onafhankelijk van info/brouwdag/vergisting/etc.
Het paneel is inklapbaar (stand wordt onthouden) en toont het aantal notities
in de header. Enter of de "+ Notitie"-knop voegt toe; nieuwste bovenaan.

- `src/components/batch/BatchNotitiesSection.tsx` — nieuw component.
- `src/pages/BatchesPage.tsx` — gerenderd direct onder `<BatchTabs>`; nieuwe
  collapse-state `batches_notities_ingeklapt`.
- `src/App.tsx` — nieuwe data-key `batch_notities` (useStore), doorgegeven aan
  `BatchesPage` en opgenomen in Excel-export/import + reset.
- `src/utils/excel.ts` — sheet `BatchNotities` toegevoegd aan backup.
- `src/types/index.ts` — `BatchNotitie`-interface.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe `batch_notitie(s)_*`-sleutels.

## [1.10.9] — 2026-06-09

### Changed — Koeling-log verplaatst naar brouwdag

De koeling-log registreert wortkoeling (platenwisselaar, dompelkoeler,
counterflow) — dat hoort bij het einde van de brouwdag, niet bij de
conditionering. De sectie staat nu in het **Brouwdag**-tabblad (onder de
water­additie-sectie) in plaats van bij **Conditionering**. Geen datawijziging:
de records (`koel_logs`) blijven ongewijzigd.

- `src/pages/BatchesPage.tsx` — `KoelLogSection` verplaatst van het
  `conditionering`- naar het `brouwdag`-tabblad.

## [1.10.8] — 2026-06-09

### Fixed — Vier batch-issues

- **Definitief ABV-veld sprong/rondde af.** Een number-input gekoppeld aan een
  numerieke state herformatteerde tijdens het typen ("8.10" → 8.1), waardoor
  cijfers wegsprongen. Het veld gebruikt nu een losse tekstbuffer
  (`abvDraft`) en parset de waarde apart; comma-invoer wordt ondersteund.
- **"Klaar met afvullen" bij afgevulde/gesloten batches verborgen.** De
  bevestigingsbalk verschijnt niet langer zodra de status `Afgevuld`,
  `Verpakt` of `Gesloten` is.
- **Priming sugar calculator is nu een instelling (standaard uit).** Toggle
  toegevoegd onder Instellingen → Brouwproces (`brouwproces_instellingen.
  priming_sugar_enabled`); de calculator in het afvul-tabblad verschijnt alleen
  wanneer aangezet.
- **Tank bleef op 'Ontsmet' na afvullen.** De "Klaar met afvullen"-knop zette
  de status direct via `setBat` en omzeilde zo de tank-markering. De knop
  gebruikt nu `handleStatusChange('Afgevuld')`, waardoor de vrijgekomen tank
  automatisch op 'Vuil' wordt gezet (HACCP-traceerbaarheid).

**Gewijzigde bestanden:** `src/pages/BatchesPage.tsx`,
`src/pages/InstellingenPage.tsx`, `src/i18n/{nl,en,de,fr,es}.json`,
`config.yaml`.

## [1.10.7] — 2026-06-09

### Added — Vernietigingsregels bij afgekeurd bier tijdens vergisting

De Douane-vernietigingsflow die al bestond voor afgevuld bier
(ProductenPage) is nu ook beschikbaar in de **verliesregistratie** van een
batch tijdens de vergisting. Wanneer je een verliespost met bron
**Afgekeurd** registreert, start dezelfde 3-staps-flow onder de
schorsingsregeling (AGP):

1. **Aangevraagd** — datum indiening verklaring vernietiging + upload van de
   bij de Douane ingediende verklaring (PDF) zijn verplicht.
2. **Toegestaan** — verwerk de schriftelijke toestemming van de Douane
   (datum + optioneel kenmerk).
3. **Uitgevoerd** — registreer de uitvoeringsdatum en upload bewijs
   (foto/video). Hierbij vervalt de potentiële accijnsschuld voor deze
   hoeveelheid.

De status wordt als pill in de verliestabel getoond met een knop om de
volgende stap te verwerken.

- `src/types/index.ts` — `VerliesRegistratie` uitgebreid met
  `vernietiging_status`, `verklaring_ingediend_op`, `toestemming_ontvangen_op`,
  `kenmerk_douane`, `uitgevoerd_op` en `bijlagen`.
- `src/pages/BatchesPage.tsx` — stap-1-velden in het verlies-formulier,
  statuspill + doorzetknop in de tabel, en een vernietigingsreview-modal.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe `verlies_vern_*`-sleutels.

## [1.10.6] — 2026-05-22

### Added — E-mailtemplates instelbaar + klikbaar logo in mail

**E-mailtemplates** voor pakbon-, factuur- en bestelbevestiging-mails zijn
nu vanuit Instellingen → Bedrijf aanpasbaar. Per template kun je het
onderwerp en de tekst overschrijven; leeg laten = standaardtekst
gebruiken. Per template wordt een knop "Reset naar standaard" getoond
zodra je iets hebt aangepast. Beschikbare placeholders (`{naam}`, `{nr}`,
`{brouwerij}`, …) worden onder elk template opgesomd.

- Nieuwe datasleutel `mail_templates` (object met `pakbon`/`factuur`/
  `bestelling`, elk met `subject` en `body`). Opgenomen in de Excel-backup.
- `BestellingenPage` en `BoekhoudingPage` lezen via een nieuwe
  `tplOrDefault()`-helper; bij lege string valt het terug op de bestaande
  `mail_*_default` i18n-strings — bestaande gebruikers merken niets.

**Klikbaar logo** in uitgaande mails: voeg in Instellingen → Bedrijf het
website-veld in en het logo bovenaan de mail wordt automatisch een
`<a>`-link (met `target="_blank"` en `rel="noopener noreferrer"`) naar
die URL. Bij ontbrekend protocol wordt automatisch `https://` voorgevoegd.

- Nieuw `website`-veld in `brewery_details`
- `MailBrewery`-interface in `mailTemplate.ts` uitgebreid
- Geen wijziging als het website-veld leeg blijft

## [1.10.5] — 2026-05-22

### Fixed — Verschoven borders op gegenereerde PDF-facturen

Bij het mailen van facturen wordt de PDF via `html2canvas` + `jsPDF`
gerasterd. Borders op `td`/`th`-cellen (met `border-collapse: collapse`)
worden door html2canvas per cel gerenderd, waardoor lijnen niet
uitlijnen met de tekst — vooral zichtbaar als gebroken horizontale
streepjes onder cellen en bij de scheidingslijn boven "Totaal incl. BTW".

- Tabel-stijl: `border-collapse: collapse` → `border-collapse: separate;
  border-spacing: 0`. Tussenrij-borders nu via
  `tbody tr + tr td { border-top: 1px solid #f0f0f0 }` (één lijn per rij
  in plaats van per cel-onderkant).
- Totalenblok: omgezet van `<table>` met `border-top` op de grand-total
  rij naar een `<div>`-structuur met een vol-breed `1px`-scheidingsdiv.
  Renders cleaner in html2canvas en de lijn loopt netjes door over de
  hele kolombreedte.

## [1.10.4] — 2026-05-22

### Changed — Zachtere stijl voor factuur- en pakbon-tabellen

De donkere `#333` headerbalken en zware accentlijnen op de factuur (en
pakbon) gaven een harde, "zwarte randen"-uitstraling. Vervangen door een
licht-grijze headerachtergrond (`#f3f4f6`) met donkere tekst en subtiele
borders (`#d1d5db`):

- Tabelheader: lichtgrijze achtergrond + dunne `1px` border-bottom in
  plaats van solide `#333`-balk
- Klantblok (`.kb`): linker accent-border van `#333` naar `#d1d5db`
- Grand-total rij in totalenblok: van `2px solid #333` naar `1px solid
  #d1d5db`

## [1.10.3] — 2026-05-22

### Fixed — Kosten weer zichtbaar bij batch-ingrediënten met meerdere regels

(Eerder geland op `claude/fix-batch-data-loss-qILOs` als 1.9.84, maar die
versie was inmiddels op main toegekend aan een andere feature; daarom nu
opnieuw geland onder 1.10.3.)

Wanneer een ingrediënt in een batch uit meerdere regels bestond (bv. omdat
er meerdere lots aan gekoppeld zijn), werd de Kosten-kolom volledig
verborgen.

- In de groepskop overspande `colSpan={2}` zowel de Lot- als de
  Kosten-kolom voor de boekingsstatus, waardoor de Kosten-cel ontbrak.
- In de detail-rijen werd de Kosten-cel via `{!multi && <td>…</td>}`
  weggelaten zodra het multi-row was, en de Lot-cel gebruikte
  `colSpan={multi ? 2 : 1}` zodat hij de Kosten-kolom inslikte.

Nu toont de groepskop in de Kosten-kolom een **totaal** (som van alle
regels) en toont elke detail-rij zijn eigen kosten — net als bij een
enkele-regel ingrediënt. De boekingsstatus blijft op zijn oude plek in de
Lot-kolom.

## [1.10.2] — 2026-05-22

### Changed — Pakbon toont biernaam i.p.v. batchnaam (batch # blijft staan)

De eerste kolom op de pakbon-PDF gebruikte `batch.naam`, wat
intern-administratieve waarden bevat zoals *"James Blond V1"*. Op de
pakbon hoort gewoon de **biernaam** te staan zoals besteld.

`PakbonExport.buildPakbonBody` zoekt nu eerst de orderregel via
`pick.regel_id` en gebruikt diens `bier_naam`; valt anders terug op
`batch.biernaam` en pas als laatste op `batch.naam`. De `Batch #`-kolom
blijft naast de biernaam staan voor traceability.

## [1.10.1] — 2026-05-22

### Fixed — Pakbon-datum is voortaan de pickdatum (niet de orderdatum)

De pakbon toonde nog steeds `verzend_datum || datum`, wat voor een
net-gepickte (nog niet verzonden) order neerkomt op de orderdatum. Dat
klopt niet: de pakbon hoort de datum van het picken te dragen.

- `savePicks` schrijft nu `pick_datum: tod()` op de order bij volledige
  pickbevestiging (en bij eventueel later opnieuw bevestigen).
- `PakbonExport.buildPakbonBody` leest de datum als
  `pakbon_datum || pick_datum || verzend_datum || datum` — pickmoment
  wint dus altijd zodra dat is vastgelegd.
- `printOrderPakbon` / `mailOrderPakbon` leiden voor oudere 'gepickt'
  orders zonder `pick_datum` de pakbon-datum af uit de gekoppelde
  uitleveringen (die zijn gestempeld op het moment van pickbevestiging).
- Het order-detail-info-blok toont voortaan ook de **Pickdatum** zodra
  die afwijkt van de orderdatum, met nieuwe i18n-sleutel
  `orders_pick_date` in alle vijf de taalbestanden.

### Datumvelden overzicht (ter info)

Voor toekomstige referentie: dit zijn de datumvelden die de app op
bestelling-/factuur-niveau bijhoudt:

| Veld | Wanneer gezet | Waar gebruikt |
|---|---|---|
| `order.datum` | Aanmaak van de bestelling (WC-import of handmatig) | Lijst, orderdetail, factuur (leverdatum-fallback) |
| `order.pick_datum` | Volledige pickbevestiging (`savePicks`) | Pakbon-datum |
| `order.verzend_datum` | *Markeer verzonden* of bij *Afronden* | Order-info, factuur-leverdatum |
| `factuur.datum` | Bij *Afronden* (`rondeAf`) | Factuur, BTW-aangifte, vervaldatum-berekening |
| `uitlevering.datum` | Pickbevestiging | Accijns-, AGP- en voorraad-mutaties |
| `accijns.datum` | Pickbevestiging (AGP) | Accijns-aangifte |

## [1.10.0] — 2026-05-22

### Changed — Klantgegevens overal live uit de klantkaart (PDF, mail, lijsten, export)

De vorige patch (1.9.99) liet de orderdetail-pagina al live klantgegevens
zien, maar de **factuur-PDF** en de **mail-bijlage** lazen nog steeds uit
het opgeslagen snapshot. Daardoor stond op de gegenereerde factuur het
oude e-mailadres, ook al was de klantkaart inmiddels bijgewerkt.

Centrale helpers `findLiveKlant` en `resolveKlantSnapshot`
(in `src/utils/klant.ts`) zoeken de live klantkaart op via `klant_id` of
case-insensitieve email-match en geven een verrijkt snapshot terug met
de actuele klant_*-velden. Deze helpers worden nu gebruikt op alle
plaatsen waar klantgegevens uit een snapshot worden gerenderd of
gemaild:

**BestellingenPage**
- `printPakbon`, `buildPakbonHTML`, `printFactuur`, `buildFactuurHTML`
  ontvangen voortaan een resolved snapshot in plaats van de raw
  `selectedOrder` — de gegenereerde PDF toont de actuele klantgegevens.
- Mail-template variabelen (`naam`) komen uit de resolved snapshot.
- Bij het afronden van een order (`rondeAf`) krijgt het verkoopfactuur-
  record nu ook `klant_id`, `klant_email` en de losse adresvelden mee,
  zodat de boekhoudingspagina dezelfde klant later via id terugvindt.

**BoekhoudingPage**
- `genereerFactuurPDF`, `mailVerkoopFactuur`, `genereerEnMarkeer`
  (herinnering/aanmaning) en de boekhouding-export gebruiken nu de
  resolved snapshot voor PDF-generatie.
- De mailontvanger komt eerst uit de live klantkaart, met de resolved
  snapshot-email als fallback voor losse facturen zonder klant_id.
- Verkoopfacturen-overzichten en CSV-/journaal-exports tonen de klantnaam
  via `klantNaamVoor()`, zodat een hernoemde klant overal direct doorwerkt.

Bestaande factuur-records worden niet aangepast — het snapshot blijft
de historische bron voor reeds gegenereerde PDF's. Alleen nieuwe
rendering en mailing volgen de actuele klantkaart.

## [1.9.99] — 2026-05-22

### Fixed — Orderdetail: klantgegevens & mail-adres lezen live van klantkaart

Wijzigingen op de klantenpagina (vooral het e-mailadres) werkten niet
altijd door naar bestaande bestellingen. De `klant_email` op de
bestelling is een snapshot dat alleen werd bijgewerkt op het moment dat
de gebruiker via *Klanten* opnieuw opslaat — orders die geen `klant_id`
hadden of buiten de syncable-statussen vielen, bleven hangen op het oude
adres. Het mailmodaal vulde daardoor nog het oude adres in als ontvanger.

De orderdetailpagina leest klantgegevens nu eerst van de live klantkaart
(via `klant_id`, met fallback case-insensitieve email-match) en valt
alleen terug op het order-snapshot als er geen koppeling te leggen is.
Dat geldt voor:

- het *Klantgegevens*-blok rechtsboven op het orderdetail,
- de pre-fill van het *Aan*-veld bij *Mail pakbon*, *Mail factuur* en
  *Mail bestelbevestiging*.

Reeds gegenereerde pakbon- en factuur-PDF's blijven hun historische
snapshot houden (de PDF zelf wordt niet aangepast — alleen het verzend-
adres en het scherm-overzicht volgen de actuele klantkaart).

## [1.9.98] — 2026-05-22

### Fixed — Order-detail: pakbon-knoppen op 'gepickt' + mobiele tabel-layout

Op de order-detailpagina liepen twee dingen scheef:

- **Pakbon onbereikbaar bij self-pickup:** zodra alles gepickt was kreeg
  je alleen *Markeer verzonden*, *Afronden* en *Annuleren* te zien. Wie
  de bestelling zelf wegbrengt heeft de pakbon op dat moment nodig, niet
  pas na het verzonden- of afgerond-status. De *Pakbon afdrukken* en
  *Mail pakbon* knoppen worden nu ook getoond bij status `gepickt` zodra
  alle regels gepickt zijn (de bestaande pakbon-bouwer valt netjes terug
  op `P-<id>` zolang er nog geen definitief pakbonnummer is toegekend).
- **Brouwn sectie-header werd op mobiel afgekapt:** de `SectionHeader`
  van *Orderregels* en *Picks overzicht* zat *binnen* hetzelfde
  `overflow-x-auto`-blok als de bredere tabel. Daardoor kreeg de
  bruine balk de breedte van de scrollende content i.p.v. de viewport
  en eindigde halverwege het scherm. Header en scroll-container zijn
  nu gescheiden: de header blijft full-width, alleen de tabel scrolt
  horizontaal.

## [1.9.97] — 2026-05-21

### Changed — Klantnummer is altijd auto-toegekend (geen handmatige invoer)

Het klantnummer-veld in de detail-view van een klant is niet langer
bewerkbaar. Voorheen kon de gebruiker zelf een nummer typen, met als
risico dat per ongeluk duplicaten ontstonden. Vanaf nu:

- Bij **nieuwe klant**: wordt bij opslaan altijd `nextKlantnummer(klanten)`
  toegekend — gegarandeerd uniek omdat het altijd max+1 is.
- Bij **bestaande klant**: blijft het bestaande nummer behouden (of
  wordt het alsnog toegekend als het ergens leeg was, bv. na een
  Excel-restore).
- Het veld op de klantkaart is een grijs, read-only display met de
  monospace nummerweergave en het label "Automatisch" rechts in beeld
  — visueel duidelijk dat het niet bewerkbaar is.

Hiermee is geen "dubbele klantnummers"-scenario meer mogelijk via de
UI. (Eventuele dubbelingen uit vóór deze versie blijven staan; die
zijn met de hand of via een export/import op te lossen.)

### Files

- `src/pages/KlantenPage.tsx` — `save()` negeert nu `form.klantnummer`
  en gebruikt altijd `nextKlantnummer()`. Het Inp-veld voor klantnummer
  is vervangen door een read-only div met label "Automatisch".
- `src/i18n/{nl,en,de,fr,es}.json` — `klanten_klantnummer_auto_hint`
  vervangen door `klanten_klantnummer_auto_label`.

---

## [1.9.96] — 2026-05-21

### Added — Auto-toegekende klantnummers (001, 002, 003, …)

Het `klantnummer`-veld op de klantkaart was voorheen vrije tekst. Nu wordt
het automatisch toegekend bij het opslaan van een nieuwe klant — puur
numeriek, 3-cijferig zero-padded (`001`, `002`, `003`, …), doorlopend
zonder jaar-reset. Tot 999 wordt zero-gepad, daarna loopt het natuurlijk
door (`1000`, `1001`, …).

- Nieuwe util `src/utils/klant.ts` met `nextKlantnummer(klanten)` —
  zoekt de hoogste numerieke waarde in bestaande nummers en geeft de
  volgende terug. Niet-numerieke klantnummers (handmatige imports met
  prefix of letters) worden genegeerd zodat ze de auto-numbering niet
  doorbreken.
- `KlantenPage.save()` kent het nummer toe bij een nieuwe klant met leeg
  veld; bij bestaande klant wordt het oude nummer behouden tenzij dat
  leeg was.
- `BoekhoudingPage.saveKlant()` (gebruikt bij losse facturen) krijgt
  dezelfde auto-toekenning — anders zouden klanten gemaakt vanaf die
  pagina alleen via de backfill een nummer krijgen.
- **Backfill bij eerste pagina-open**: een useEffect detecteert klanten
  zonder klantnummer en kent ze er één toe in aanmaakvolgorde (sorted op
  id). De `needsBackfill`-check is zelf de guard — werkt ook als
  server-data ná de initiële render arriveert of als een Excel-restore
  nieuwe nummer-loze klanten toevoegt. Audit-log noteert "{n}
  klantnummer(s) automatisch toegekend".
- **Zichtbaarheid**: het klantnummer staat nu als kleine monospace
  prefix vóór de naam in zowel de lijst-view als de detail-header.
- Bij het aanmaken van een nieuwe klant toont het klantnummer-veld als
  placeholder het eerstvolgende vrije nummer met label `(automatisch)`.

### WooCommerce-orders: geen impact

WC sync importeert bestellingen met klant_email/klant_naam maar maakt
nooit zelf klanten aan. Pas wanneer de gebruiker via de Klanten-page
een synth-klant omzet naar een echte klantkaart, kent `save()` netjes
een klantnummer toe — los van of de oorspronkelijke order via WC of
handmatig binnenkwam.

### Files

- `src/utils/klant.ts` *(nieuw)* — `nextKlantnummer()` helper.
- `src/pages/KlantenPage.tsx` — backfill useEffect, save() auto-assign,
  klantnummer-prefix in lijst en detail-header, placeholder met
  preview van het volgende vrije nummer.
- `src/pages/BoekhoudingPage.tsx` — `saveKlant()` kent ook auto-nummer
  toe (zowel bij aanmaken als bij bewerken van een klant zonder
  nummer).
- `src/i18n/{nl,en,de,fr,es}.json` — `klanten_klantnummer_auto_hint`.

---

## [1.9.95] — 2026-05-21

### Added — Order-status 'Bevestigd' + logboek per order + klantsync

**Nieuwe order-status 'Bevestigd'** tussen 'Nieuw' en 'Gepickt'. Wordt
automatisch gezet zodra de bestelbevestigingsmail succesvol is
verzonden. De status-overgang gebeurt alleen vanuit `nieuw` —
opnieuw versturen op een `bevestigd` order verandert de status niet
verder. De mail-knop heet bij heropvragen "Bevestiging opnieuw mailen".

- `BestellingStatus`-type uitgebreid met `'bevestigd'`; cyaan-kleur in
  `STATUS_COLORS` (BestellingenPage + DashboardPage).
- Status-filter-tabbalk en alle action-button-condities accepteren
  `bevestigd` overal waar `nieuw` werkte (picken, vrije regel,
  verzendkosten, annuleren). Een bevestigd order gedraagt zich dus als
  een onbewerkte order tot het gepickt wordt.
- Dashboard-widget "Open bestellingen" toont bevestigde orders óók —
  ze zijn immers nog niet ingepakt.

**Logboekje per order**: onderaan de order-detail-view een chronologisch
overzicht (nieuw → oud) van alle audit-log-entries voor die specifieke
bestelling. Toont voor elke actie de omschrijving, tijdstempel en
(indien aanwezig) gebruiker. Gekleurde stip naast elke regel
visualiseert het actietype:
- 🔵 aangemaakt
- 🟡 gewijzigd (status, picks, regels, mail-verzending …)
- 🔴 verwijderd

De entries komen direct uit de globale `auditLog` — geen aparte data-
store nodig. Bestaande logAudit-calls in BestellingenPage worden dus
automatisch zichtbaar in dit logboekje.

### Fixed — Klant-mutaties propageren naar open bestellingen

Wijzigingen aan een bestaande klant (e-mail, naam, bedrijf, adres,
BTW-nr.) werden alleen in de klantkaart opgeslagen, maar niet
overgenomen op reeds gekoppelde bestellingen. Daardoor toonde de
order na een typo-fix nog steeds het oude adres.

Nu schrijft `KlantenPage.save()` de hele klantsnapshot (naam, e-mail,
bedrijf, straat, huisnummer, postcode, stad, BTW-nr., type) naar alle
bestellingen met `klant_id === klantId` ÉN status in `['nieuw',
'bevestigd', 'gepickt']`. Afgeronde / verzonden / geannuleerde orders
worden expliciet NIET aangepast — hun snapshot is al bevroren in de
uitgegeven factuur/pakbon en moet historisch correct blijven. Audit-log
krijgt een regel "Klantgegevens bijgewerkt in N open bestelling(en)"
zodra er iets gesynchroniseerd is.

### Files

- `src/types/index.ts` — `BestellingStatus` uitgebreid met `'bevestigd'`.
- `src/pages/BestellingenPage.tsx` — `STATUS_COLORS` + `StatusFilter`
  uitgebreid; action-button-condities accepteren `bevestigd`; mail-
  modal-state heeft een `kind`-veld dat de bevestiging onderscheidt van
  pakbon/factuur; `onSent` schrijft per-type log-regel en doet status-
  overgang `nieuw → bevestigd` bij succesvolle bevestigingsmail. Nieuw
  logboek-blok onderaan de detail-view.
- `src/pages/DashboardPage.tsx` — open-bestellingen-filter incl.
  `bevestigd`; status-badge kleurt cyaan.
- `src/pages/KlantenPage.tsx` — `save()` propageert klantsnapshot naar
  open gekoppelde bestellingen (status in nieuw/bevestigd/gepickt) en
  logt het aantal gesynchroniseerde orders.
- `src/i18n/{nl,en,de,fr,es}.json` — 9 nieuwe sleutels:
  `orders_filter_bevestigd`, `orders_status_bevestigd`,
  `orders_logboek`, `order_mail_bevestiging_resend`, vier
  `audit_actie_*` labels.

---

## [1.9.94] — 2026-05-21

### Fixed — "Open bestellingen"-widget op het dashboard werkt nu

De stat-card "Open orders" en de "Open bestellingen"-lijst op het
dashboard toonden altijd 0, ongeacht het aantal openstaande
bestellingen. Oorzaak: `openBestellingen` werd berekend als
`bi.filter((b) => ['nieuw','gepickt'].includes(b.status))` — maar `bi`
is `batch_ingredienten` (de koppelingen tussen batches en
ingrediënten), niet bestellingen. Bovendien werd `bestellingen` als
data nooit aan `DashboardPage` doorgegeven.

Fix:
- `App.tsx` geeft nu `bestellingen` en `setOpenOrderId` mee aan
  `DashboardPage`.
- De filter op regel 253 gebruikt nu `bestellingen` i.p.v. `bi`.
- Klikken op een specifieke regel in de "Open bestellingen"-widget
  opent vanaf nu meteen díé order (via `setOpenOrderId(b.id)`), in
  plaats van enkel naar de bestellingen-lijst te navigeren.
- De status-badge gebruikt nu de vertaalde label
  (`t('orders_status_<status>')`) i.p.v. de ruwe waarde.

### Files

- `src/pages/DashboardPage.tsx` — props uitgebreid met `bestellingen`
  en `setOpenOrderId`; filter op de juiste data; click-through naar
  specifieke order; vertaalde status-badge.
- `src/App.tsx` — props doorgeven aan `<DashboardPage>`.

---

## [1.9.93] — 2026-05-21

### Changed — Omzet = strikt gefactureerd; pipeline als aparte stat

Omzet werd in 1.9.91 berekend als facturen + pending orders. Conceptueel
is dat onzuiver: een bestelling is pas omzet zodra hij gefactureerd is
(juridisch / NL GAAP / IFRS 15). Vanaf nu telt de Klanten-pagina:

- **Omzet** — strikt: som van alle verkoopfacturen voor deze klant
  (creditnota's tellen negatief). Consistent met `verkoopTotals.bruto`
  in de Boekhouding-pagina.
- **Open orders** (nieuw) — pipeline: bruto-totaal van bestellingen die
  nog niet gefactureerd zijn, exclusief geannuleerde. Worden omzet
  zodra ze afgerond worden en een factuur krijgen.

Lijstweergave krijgt een extra kolom "Open orders" (blauw) tussen
"Omzet" en "Openstaand". De top-stats-rij gaat van 3 naar 4 kaarten
met "Totaal open orders" erbij. Detail-view stat-cards vervangen de
"Laatste bestelling"-kaart door "Open orders"; de laatste-besteldatum
verschijnt nu als subtitel onder de # bestellingen-kaart.

Sub-labels onder de stat-kaarten verduidelijken de scheiding:
- Omzet → "Gefactureerd"
- Open orders → "Nog te factureren"

Synthetische klanten (uit bestellingen zonder klantkaart) hebben per
definitie nog geen factuur, dus hun Omzet is 0 en hun Open orders =
bruto van alle niet-geannuleerde bestellingen.

### Fixed — "Niet-opgeslagen wijzigingen" verscheen onterecht

Klikken op "+ Nieuwe klant" of een synth-rij "Uit bestelling" markeerde
het formulier meteen als `dirty=true` zodat de Save-knop direct
beschikbaar was. Maar daardoor verscheen óók de
"Niet-opgeslagen wijzigingen, toch terug?"-confirm bij het direct
terugklikken — terwijl je nog niets had aangepast. Nu wordt `dirty`
alleen op `true` gezet wanneer de gebruiker echt iets in een veld
typt (via `update()`). De Save-knop blijft beschikbaar dankzij een
aangepaste enable-conditie: ingeschakeld zodra er een naam ingevuld is
EN (nieuwe klant OF synth-source OF echt gewijzigd).

### Files

- `src/pages/KlantenPage.tsx` — `statsPerKlant.omzet` is nu strikt
  facturen; nieuwe `openOrders`-veld bevat de pipeline. Idem in
  `syntheticKlanten._stats`. Stat-cards (lijst + detail) en
  lijst-tabel uitgebreid met Open orders. `openNew` en
  `openNewFromSynth` zetten `dirty` op false; Save-knop's
  disabled-conditie aangepast.
- `src/i18n/{nl,en,de,fr,es}.json` — 7 nieuwe sleutels:
  `klanten_stat_open_orders`, `_totaal`, `klanten_omzet_sub`,
  `klanten_open_orders_sub`, `klanten_omzet_tooltip`,
  `klanten_open_orders_tooltip`.

---

## [1.9.92] — 2026-05-21

### Fixed — Geannuleerde bestellingen tellen niet mee in omzet

De omzet-berekening op de Klanten-pagina telde alle bestellingen voor
een klant op (gefactureerd + pending). Geannuleerde bestellingen werden
echter óók meegerekend, wat misleidend is — een geannuleerde order is
nooit gefactureerd en levert geen omzet op. Beide stat-berekeningen
(echte klanten in `statsPerKlant` en synthetische klanten via
`_stats.omzet`) filteren nu `status === 'geannuleerd'` weg vóór ze de
pending-orders bij de gefactureerde omzet optellen. De order zelf
blijft zichtbaar in de bestellingen-tabel van de klant (met grijze
"Geannuleerd"-badge), alleen het bedrag telt niet meer mee.

### Fixed — E-mail aanpassen bij synth-klant maakte dubbele klant aan

Sinds 1.9.91 verschenen bestellingen zonder klantkaart als synthetische
"Uit bestelling"-rijen in de Klanten-lijst. Klik je daarop en pas je
het e-mailadres aan (bijv. een typo herstellen), dan zocht de
auto-koppel-logica naar bestellingen met het **nieuwe** adres en vond
niets — de bestelling had immers nog het oude adres. Resultaat: er
verscheen een nieuwe klantkaart **naast** de oorspronkelijke synth-rij,
in plaats van dat die synth-rij in een echte klantkaart werd omgezet.

**Oplossing**: bij het openen van een synth-rij houdt de page de
**synth-source-key** vast (e-mail of naam waarop de synth-groep
gebouwd was). Bij opslaan worden de bestellingen uit die groep alsnog
gekoppeld, onafhankelijk van of de gebruiker het e-mailadres in het
formulier intussen heeft gewijzigd. De typo-fix-flow werkt nu zoals
verwacht: bestelling met `sterrennberg.nl` → klik op synth-rij →
corrigeer naar `sterrenberg.nl` → opslaan → 1 echte klantkaart,
bestelling gekoppeld, synth-rij weg.

Tegelijk dekt de save-logica nu ook drie andere edge-cases:

1. **Nieuwe klant + nieuw e-mailadres**: bestellingen die dat adres
   gebruiken worden meegekoppeld (was er al, blijft).
2. **Bestaande klant, e-mail wijzigen**: bestellingen die via email-
   fallback aan deze klant gematcht waren, krijgen nu hun `klant_id`
   gezet vóórdat het adres verandert — zodat ze niet "ongekoppeld"
   achterblijven.
3. **Synth-source**: zoals beschreven, koppelt op groep-key.

### Files

- `src/pages/KlantenPage.tsx` — nieuwe `synthSourceKey` state, gezet in
  `openNewFromSynth`, gewist in `openDetail` / `openNew` / `goBack`.
  `save()` herschreven met drie-strategie auto-koppel: synth-source-key,
  nieuwe e-mail, oude e-mail bij bestaande klant.

---

## [1.9.91] — 2026-05-21

### Fixed — Nieuwe bestellingen tonen nu automatisch een (synthetische) klant

In 1.9.90 verscheen een klant pas in de Klanten-lijst zodra er een
klantkaart was aangemaakt. Bestellingen die binnenkwamen met alleen
`klant_naam`/`klant_email` (zoals WooCommerce-imports en handmatige
orders) bleven dus onzichtbaar in Klanten tot de gebruiker zelf op
"+ Nieuwe klant" klikte. Dat is precies wat de feedback "ik heb een
nieuwe bestelling die staat al bij orders maar niet bij klanten"
beschreef.

**Oplossing**: de Klanten-lijst toont nu ook **synthetische klantkaarten**
voor elke unieke `klant_email` (of, als die ontbreekt, `klant_naam`) uit
bestellingen die nog niet aan een echte klantkaart zijn gekoppeld.

- Synthetische rijen krijgen een lichtblauwe achtergrond + badge
  **"Uit bestelling"** zodat de gebruiker direct ziet dat dit nog geen
  echte klantkaart is.
- Per synthetische klant worden alle matchende bestellingen geteld en
  hun bruto-totaal getoond als omzet — dezelfde stats als bij echte
  klanten.
- Klikken op een synthetische rij opent het detail-formulier met de
  klantgegevens uit de bestelling al ingevuld. De gebruiker kan ze
  controleren/aanpassen (bijv. een typo in het e-mailadres herstellen)
  en op opslaan worden:
  1. een echte klantkaart aangemaakt
  2. ALLE bestellingen met dat e-mailadres automatisch aan de nieuwe
     klant gekoppeld (`klant_id` ingevuld)
- Bovenaan de lijst staat een korte uitleg-banner wanneer er
  synthetische klanten zijn, en het stat-cijfer "Totaal klanten" toont
  `{echte}+{synth}` zodat duidelijk is dat er nog werk te doen is.
- De detail-view toont nu óók bij het aanmaken van een nieuwe klant een
  preview "{n} bestaande bestelling(en) worden automatisch gekoppeld bij
  opslaan" — vroeger zag je dat alleen voor bestaande klanten.

**Omzet-berekening uitgebreid**: voor bestaande klanten telt nu ook het
bruto-totaal van bestellingen die nog niet aan een factuur gekoppeld
zijn (pending orders). Hiermee zie je direct het effect van een nieuwe
order op je klant-pipeline, zonder te wachten tot de factuur is gemaakt.

### Files

- `src/pages/KlantenPage.tsx` — `syntheticKlanten` useMemo (groepeert
  ongekoppelde bestellingen op e-mail/naam), `openNewFromSynth()` om het
  formulier voor te vullen, auto-koppel-logica in `save()` voor elke
  nieuwe klant met e-mail, lijst-renderer met conditional `_synthetic`
  styling, en banner met `klanten_synth_explainer`. Nieuwe helper
  `orderBruto()` voor de pipeline-omzet.
- `src/i18n/{nl,en,de,fr,es}.json` — 3 nieuwe sleutels:
  `klanten_synth_badge`, `klanten_synth_explainer`,
  `klanten_unlinked_hint_new`.

---

## [1.9.90] — 2026-05-21

### Added — Klanten-pagina met orderhistorie

Een nieuw top-level menu-item **Klanten** (tussen Bestellingen en AGP)
biedt een dedicated klantenbeheer-omgeving. Aanleiding: typefouten in
klantgegevens (zoals `sterrennberg.nl` i.p.v. `sterrenberg.nl` in een
bestelling) zijn nu in één klik te corrigeren — voorheen moest dat per
bestelling apart.

**Lijstweergave**
- Tabel met naam/bedrijf, e-mail, telefoon, # bestellingen, omzet,
  openstaand bedrag en datum laatste bestelling.
- Oranje stip naast klanten met openstaande facturen.
- Vrij-tekst zoekveld over naam, bedrijf, e-mail, telefoon en
  klantnummer.
- Stats-kaarten bovenaan: totaal klanten, totale omzet, totaal
  openstaand.

**Detailweergave**
- Bewerkbaar formulier met klantgegevens (naam, klantnummer, type
  privé/zakelijk, bedrijf, e-mail, telefoon, betalingstermijn) en
  adresvelden (straat, huisnr., postcode, stad, BTW-nr., KvK-nr.,
  notities).
- **Inline e-mail-validatie**: rood kader + waarschuwing bij ongeldig
  formaat, met expliciete hint om typefouten in de domeinnaam te
  checken.
- Vier stats-kaarten boven het formulier: # bestellingen, omzet,
  openstaand, datum laatste bestelling.
- **Bestellingen-tabel**: klik op een rij → opent direct die order in de
  Bestellingen-pagina (via `setOpenOrderId`).
- **Verkoopfacturen-tabel**: status-badge, datum, factuurnummer, bedrag.
- **Mail-knop** opent de MailModal met de klant als ontvanger en een
  voorgevulde aanhef — verstuurt een HTML-mail met logo en signature
  (geen PDF-bijlage; bedoeld voor vrije communicatie).
- **Auto-koppel WC-orders op e-mail**: als er WooCommerce-bestellingen
  zijn met hetzelfde e-mailadres maar zonder `klant_id`, verschijnt een
  blauwe banner met één-klik koppeling.

**Matching-logica**

Bestellingen worden gematcht via `klant_id` OF (fallback)
case-insensitive `klant_email`. Hierdoor tellen losse WooCommerce-orders
die nooit aan een klantkaart zijn gekoppeld, automatisch mee in de
stats. Verkoopfacturen matchen alleen op `klant_id` — facturen worden
altijd aan een klant gekoppeld bij aanmaken, dus die fallback is daar
niet nodig.

Het bestaande Klanten-tabblad in **Boekhouding** blijft beschikbaar
(wordt intern gebruikt bij het maken van losse facturen via
`handleKlantSelectInFactuur`), maar de nieuwe pagina is vanaf nu de
primaire plek voor klantbeheer.

### Files

- `src/pages/KlantenPage.tsx` *(nieuw)* — volledige page met list- en
  detail-view, klant-CRUD, order/factuur-tabellen, e-mail-validatie,
  auto-koppel-flow en MailModal-integratie.
- `src/App.tsx` — nav-item `klanten` toegevoegd; import + routing.
- `src/i18n/{nl,en,de,fr,es}.json` — 39 nieuwe sleutels (klanten_*,
  lbl_straat/huisnummer/postcode/stad/btw_nr/kvk, lbl_dear/kind_regards,
  settings_betalingstermijn, nav_klanten).

---

## [1.9.89] — 2026-05-21

### Added — HTML-mails met inline brouwerijlogo

De mails uit 1.9.87 hadden een plain-text body. Vanaf nu wordt elke mail
verstuurd als **HTML-mail met logo + nette signature** — naast de plain-text
versie als fallback (`multipart/alternative`).

- Het brouwerijlogo (`factuur_logo` of `app_logo`) wordt als RFC-conforme
  CID-inline image meegestuurd: server bouwt een `multipart/mixed >
  multipart/alternative > multipart/related`-structuur en zet
  `Content-Disposition: inline` op de afbeelding. Werkt in Gmail, Outlook
  (web + desktop), Apple Mail, Thunderbird, mobiele clients.
- HTML-template (`src/utils/mailTemplate.ts`) heeft een gecentreerd
  logo-blok, accent-rand bovenaan, body met `<p>`/`<br>`-formatting, en
  een signature-blok met brouwerijnaam, adres, e-mail, telefoon, BTW-nr.
  en IBAN — alle waarden HTML-escaped tegen XSS.
- MailModal bouwt de HTML-body automatisch uit de bewerkte tekst en toont
  standaard een live preview-iframe (data:-URI-variant van het logo, zodat
  CID-verwijzingen in de browser werken). De gebruiker bewerkt alleen
  plain text — de HTML-wrapping gebeurt onzichtbaar.

### Files

- `server.py` — `_build_email` accepteert nu `inlineImages` (lijst met
  `{filename, contentBase64, mimeType, contentId}`); valideert CID strikt
  op `[A-Za-z0-9._-]{1,80}` en alleen `image/*` mimeTypes; gebruikt
  `add_related(..., disposition='inline')` op de HTML-alternative.
- `src/utils/api.ts` — `MailInlineImage` interface; `MailSendBody.inlineImages?`.
- `src/utils/mailTemplate.ts` *(nieuw)* — `buildMailHtml(text, brewery, opts)`
  en `dataUriToInlineImage(dataUri, cid, filename)` helpers.
- `src/components/MailModal.tsx` — interne HTML-body-generatie met
  `useMemo`, automatische omzetting van het brouwerijlogo (data:-URI) naar
  CID-inline image; preview-iframe vervangt CID door data:-URI zodat het
  in de browser te zien is.
- `src/pages/BestellingenPage.tsx`, `BoekhoudingPage.tsx` — geven
  `brewery` en `logoDataUri` mee aan de MailModal; `previewHtml`-prop
  verwijderd uit modal-state (preview wordt nu door MailModal zelf
  gegenereerd uit de tekst).

---

## [1.9.88] — 2026-05-21

### Added — PDF-bijlage in mailmodule

De mailmodule uit 1.9.87 stuurde de pakbon/factuur inline in de HTML-body. Dat
is voor sommige ontvangers prima maar minder geschikt voor archivering of
doorsturen aan de boekhouder. Vanaf nu wordt de pakbon/factuur als echte
**PDF-bijlage** meegestuurd:

- Nieuwe `src/utils/pdf.ts` met `htmlToPdfBase64()`: rendert de standalone
  HTML in een verborgen iframe, captureert met `html2canvas` en pakt het in
  een A4-PDF via `jsPDF` (multi-page wanneer de inhoud langer is dan één
  pagina). Geeft base64 terug zonder `data:`-prefix.
- `BestellingenPage.mailOrderPakbon` en `mailOrderFactuur` zijn async
  geworden: ze genereren eerst de PDF (knop toont "PDF maken…") en openen
  daarna pas de MailModal met de bijlage al ingevoegd.
- `BoekhoudingPage.mailVerkoopFactuur` idem; tijdens generatie toont de
  mail-knop in de tabel een ⏳-spinner per factuur.
- `MailModal` splitst nu `previewHtml` (alleen voor het preview-iframe) van
  de daadwerkelijke mailbody — de mail bevat plain text + PDF-bijlage in
  plaats van een grote HTML-body.

Dependencies: `jspdf` 3.x en `html2canvas` 1.x toegevoegd aan
`package.json`. Bundle-impact: ~780 KB ongezipt (652 → 894 KB gzip). Geen
extra backend-dependencies — `server.py` blijft Python stdlib only.

### Files

- `src/utils/pdf.ts` *(nieuw)* — `htmlToPdfBase64(html)` helper.
- `src/components/MailModal.tsx` — `html` prop hernoemd naar `previewHtml`;
  `html`-veld niet meer doorgegeven aan `mailSendApi`.
- `src/pages/BestellingenPage.tsx` — async mail-handlers, `mailGenerating`-
  state, knoplabels tonen "⏳ PDF maken…" tijdens generatie.
- `src/pages/BoekhoudingPage.tsx` — async `mailVerkoopFactuur`, `mailGenerating`-
  state per factuur-ID, ⏳-spinner in alle drie de tabellen.
- `src/i18n/{nl,en,de,fr,es}.json` — twee nieuwe sleutels:
  `mail_generating_pdf`, `mail_pdf_failed`.
- `package.json` / `package-lock.json` — `jspdf` en `html2canvas` als
  dependencies.
- `CLAUDE.md` — Tech Stack-tabel bijgewerkt met jsPDF + html2canvas.

---

## [1.9.87] — 2026-05-21

### Added — Eigen SMTP-server: pakbon/factuur/bestelling per e-mail

BrewAdmin kan nu vanuit de app rechtstreeks e-mails versturen via een eigen
SMTP-server. Geen externe service nodig — je configureert host, poort,
gebruikersnaam, wachtwoord en afzenderadres in **Instellingen → Koppelingen →
E-mailserver (SMTP)**. Ondersteund: STARTTLS, SSL/TLS en (op eigen
verantwoordelijkheid) een onversleutelde verbinding voor interne mailservers.

- **Verbinding testen** los van het verzenden: één klik probeert verbinding
  + login zonder iets op te slaan, en geeft een korte foutclassificatie
  (`auth`, `SMTPException`, `SSLError`, `timeout`) terug.
- **Testmail-knop** stuurt een vooraf gevuld testbericht naar een opgegeven
  adres — handig om DNS/SPF/relay-instellingen te controleren.
- **Pakbon mailen** vanuit de orderdetail-pagina: de pakbon-HTML wordt
  inline als mailbody verstuurd (zelfde lay-out als de print-versie),
  ontvanger-/onderwerp-/tekstvelden zijn vóór verzenden te bewerken.
- **Verkoopfactuur mailen** vanuit Boekhouding (drie tabellen: vervallen,
  hoofdoverzicht, klantdetail) én vanuit Bestellingen. Onderwerp en
  begeleidende tekst worden automatisch ingevuld met factuurnummer, bedrag,
  vervaldatum, IBAN en brouwerijnaam.
- **Bestelbevestiging mailen** bij nieuwe bestellingen, met automatisch
  gegenereerde regel-opsomming.
- Een `<MailModal>`-component biedt een uniforme verzend-UI met optioneel
  HTML-voorbeeld via `<iframe srcDoc>`.

Beveiliging: SMTP-credentials worden net als `brewfather_creds`,
`woocommerce_creds` en `claude_creds` als `secure: true` opgeslagen — niet
in localStorage, niet in de Excel-backup. De backend valideert payloads
streng (max 50 ontvangers, max 15 MB aan bijlagen, alleen toegestane
e-mailtekens) en classificeert SMTP-fouten zonder credentials of stack
traces terug te geven.

### Files

- `server.py` — `smtplib`/`email.message`-imports toegevoegd; helpers
  `_load_smtp_creds`, `_smtp_connect`, `_valid_recipient_list`,
  `_build_email`; endpoints `POST /api/mail/test` en `POST /api/mail/send`
  met handlers `_mail_test`/`_mail_send`.
- `src/utils/api.ts` — `mailTestApi()`, `mailSendApi()` en `MailAttachment`-
  interface.
- `src/App.tsx` — `smtpCreds`-useStore (secure) en wiring naar
  `InstellingenPage`, `BestellingenPage` en `BoekhoudingPage`.
- `src/components/MailModal.tsx` — nieuwe generieke verzend-modal.
- `src/components/PakbonExport.tsx` — `buildPakbonHTML()`-helper (analoog
  aan `buildFactuurHTML`).
- `src/pages/InstellingenPage.tsx` — SMTP-card in de Koppelingen-sectie
  met host/poort/security/credentials, test- en testmail-knop.
- `src/pages/BestellingenPage.tsx` — mail-knoppen voor pakbon, factuur en
  bestelbevestiging in de orderdetail-actiebar.
- `src/pages/BoekhoudingPage.tsx` — mail-knop in alle drie de
  verkoopfactuur-tabellen.
- `src/i18n/{nl,en,de,fr,es}.json` — 47 nieuwe sleutels voor SMTP-
  configuratie, mailmodal-labels en standaard onderwerp-/lichaam-templates.

---

## [1.9.86] — 2026-05-21

### Changed — Definitief ABV gereed product

Het invoerveld "ABV gereed product" was tot nu toe altijd zichtbaar zodra de
brouwdag voorbij was en gaf geen feedback wanneer de waarde definitief
gemaakt werd. Dat veld is nu een expliciet bevestigingsproces:

- Het veld verschijnt pas vanaf de fase **Conditioneren**. Daarvoor is
  geen ABV-invoer zichtbaar (de berekende ABV uit metingen blijft wel
  zichtbaar tijdens Vergisten).
- Tijdens Conditioneren staat het veld open met een **Bevestig
  definitief**-knop. Na bevestiging wordt het ABV vastgelegd als
  `abv_definitief: true` en is dit de basis voor accijns en afvulling.
- Daarna toont het veld een groene **Definitief**-badge en de waarde
  read-only in een groen kader. Een **Bewerken**-knop ontgrendelt het
  veld weer (met confirm-dialog), zodat rekenfouten gecorrigeerd kunnen
  worden.
- Voor batches die al in Afgevuld/Gesloten staan en al een ABV-waarde
  hebben (legacy data zonder de definitief-flag), behandelt de UI de
  bestaande waarde als definitief.
- De voor-afvul-waarschuwing "ABV is vermoedelijk een schatting" wordt
  overgeslagen wanneer `abv_definitief` op true staat.

### Files

- `src/pages/BatchesPage.tsx` — ABV-blok herschreven met definitief/edit-
  toestanden, `bevestigDefinitief()`/`startBewerken()` handlers, en
  `doAfvullen()` skipt de schatting-waarschuwing voor bevestigde ABVs.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutels voor de bevestig-,
  bewerk- en badge-labels plus de bijbehorende confirm-tekst.

---

## [1.9.85] — 2026-05-21

### Changed — Eindfase batch springt naar Financieel-tabblad

Na "Klaar met afvullen" (of een handmatige statuswissel naar
`Afgevuld`/`Verpakt`/`Gesloten`) opent voortaan automatisch het
Financieel-tabblad en verschuift de groene fase-indicator van het
Afvulling-tabblad naar Financieel. De brouwer ziet zo direct het
kostprijsoverzicht in plaats van het inmiddels afgeronde afvulscherm.

De UI-teksten zijn gelijk getrokken op "Afgevuld" (canoniek datamodel
sinds v1.9.75): de bevestigingsdialogen en de helptekst onder de
"Klaar met afvullen"-knop spreken niet langer over "Verpakt".

### Files

- `src/components/batch/BatchTabs.tsx` — groene fase-indicator verplaatst
  van Afvulling-tab naar Financieel-tab voor `Afgevuld/Verpakt/Gesloten`.
- `src/pages/BatchesPage.tsx` — `handleStatusChange()` en de "Klaar met
  afvullen"-knop wisselen `activeTab` naar `financieel`; tab-default voor
  Afgevuld/Verpakt/Gesloten gaat naar Financieel.
- `src/i18n/nl.json` — `batch_ready_text`, `err_confirm_mark_packed` en
  `carb_no_session_confirm` gebruiken consequent "Afgevuld".

---

## [1.9.84] — 2026-05-21

### Added — Brewfather batch-import via bevestigings-popup

Bij een Brewfather-sync werden alle nieuwe batches die nog niet in BrewAdmin
stonden voorheen stilletjes geïmporteerd. Dat is nu opt-in: na `Sync
Brewfather` opent een popup met alle nieuwe BF-batches en een checkbox per
batch. De gebruiker selecteert welke daadwerkelijk in BrewAdmin terecht
komen.

- Bestaande batches worden, net als voorheen, automatisch bijgewerkt
  (status, OG/FG/ABV, profielen, etc.).
- De auto-sync bij het opstarten van de app importeert geen nieuwe batches
  meer — alleen handmatige sync triggert de import-popup.

### Files

- `src/pages/BatchesPage.tsx` — `runBfSync()` verzamelt nieuwe batches als
  kandidaten; nieuwe `doBfImport()` voert de import uit na bevestiging;
  modal aan render toegevoegd.
- `src/App.tsx` — auto-sync slaat nieuwe batches over (`continue`) zodat ze
  niet ongezien worden aangemaakt.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutels voor de import-popup.

---

## [1.9.83] — 2026-05-18

### Fixed — Batch-data-verlies door race tussen migraties en server-fetch

Twee migraties in `App.tsx` startten meteen op de localStorage-cache zonder te
wachten op de server-fetch voor `batches` (en `recepten`):

- de sanitizer voor `vergistings-/maischprofiel`-tijden;
- de backfill van `kleur`/`vergistingsprofiel`/`maischprofiel`/`kooktijd`/
  `kook_volume` vanuit het gekoppelde recept (geïntroduceerd in v1.9.81).

Als de cache verouderd was (bv. omdat de batches op een ander apparaat zijn
aangemaakt of bewerkt), patchten deze migraties de oude versie en riepen
direct `setBat()` aan. Dat zette `modified.current = true` in `useStore`,
waardoor de daaropvolgende server-response werd verworpen en de
gecachte/gepatchte versie naar de server werd weggeschreven. Nieuwere batches
of veld-edits die alleen op de server stonden gingen daardoor verloren.

Beide migraties wachten nu expliciet tot `_fetchedKeys` aangeeft dat de
server-fetch voor `batches` (en voor de backfill ook `recepten`) is voltooid
voordat ze draaien — dezelfde guard die de andere migraties in dit bestand
(taken, tank-status, lege facturen, Verpakt→Afgevuld) al hadden.

### Files

- `src/App.tsx` — `_fetchedKeys.has('batches')`-guard toegevoegd aan de
  vergistings-/maischprofiel-sanitizer en aan de recept-backfill (die ook op
  `recepten` wacht).

---

## [1.9.82] — 2026-05-18

### Added — Alternatieve betaalrekeningen met schuldregistratie

Soms betaal je een inkoopfactuur niet vanaf de eigen bankrekening, maar vanaf
een privérekening of een andere rekening. Voorheen kon je dit niet zuiver in de
boekhouding verwerken: de factuur bleef "open" tot er een MT940-transactie was
om te koppelen, terwijl de uitgave wél al was gedaan. Daardoor werd ook de
schuld die de brouwerij zo opbouwt aan de eigenaar/derde niet zichtbaar.

Deze release voegt een volwaardig systeem toe voor alternatieve betaal­rekeningen:

- **Instellingen → Bedrijf → "Alternatieve betaalrekeningen"** — beheer een lijst
  van rekeningen (naam, IBAN, eigenaar, notitie). Per rekening wordt het
  openstaand saldo in real-time getoond.
- **Boekhouding → Inkoop** — op elke open inkoopfactuur staat nu een paarse
  knop **"Via alt. rekening"**. Daarmee markeer je de factuur als betaald vanaf
  de gekozen rekening; de factuur krijgt status `betaald` met een paarse
  badge `↪ <naam>` (te ontkoppelen via het `×`-icoon).
- **Boekhouding → Bank** — een nieuwe sectie **"Schulden aan alternatieve
  rekeningen"** toont per rekening de totale opname, aflossing en
  openstaande schuld. Bij elke debettransactie kun je nu naast "Nieuwe boeking"
  ook een **"Aflossing"**-koppeling maken: kies de rekening en de transactie
  telt automatisch mee als aflossing van die schuld.
- **Boekhouding → Rapporten → Balans** — onder Passiva is een rij
  **"Schuld alt. rekeningen"** toegevoegd, zodat de schuld correct meetelt in
  het eigen vermogen.

De aflossing-koppelingen worden in `bank_koppelingen` opgeslagen met
`{soort:'aflossing', altRekeningId, bedrag}` en worden bij MT940-herimport
automatisch hersteld. De alt-rekeningen zelf zitten in een nieuwe data-key
`alt_rekeningen` en worden meegenomen in de Excel backup/restore.

### Files
- `src/types/index.ts` — `AltRekening`-interface; `InkoopFactuur.betaald_via_alt_id`.
- `src/App.tsx` — `useStore('alt_rekeningen')`, props naar Instellingen-/Boekhoudingpage, backup/restore.
- `src/pages/InstellingenPage.tsx` — CRUD-card "Alternatieve betaalrekeningen" onder bedrijf.
- `src/pages/BoekhoudingPage.tsx` — Schulden-overzicht op Bank-tab, "Via alt. rekening"-knop op Inkoop-tab, Aflossing-koppeling op debet-transacties, balans-uitbreiding, MT940-herstel.
- `src/utils/excel.ts` — nieuw `AltRekeningen`-sheet in export/import.
- `src/i18n/{nl,en,de,fr,es}.json` — ~30 nieuwe sleutels.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.81 → 1.9.82.

---

## [1.9.81] — 2026-05-17

### Fixed — Bestaande batches vullen brouwkundige info alsnog aan vanuit recept

Aanvulling op v1.9.80. De fix daar zorgde dat **nieuwe** batches vanuit een lokaal recept de juiste velden meekrijgen, maar **bestaande** batches in de database bleven met lege `kleur` / `vergistingsprofiel` zitten. `App.tsx` voert nu een eenmalige backfill uit zodra batches én recepten geladen zijn: voor elke batch met een geldige `recept_id` worden ontbrekende velden (`kleur`, `kooktijd`, `kook_volume`, `vergistingsprofiel`, `maischprofiel`) alsnog uit het gekoppelde recept gehaald.

De backfill is **niet-destructief**: bestaande waarden op de batch worden nooit overschreven. Een door de gebruiker bewust geleegde `vergistingsprofiel: []` (length 0) wordt met rust gelaten — alleen `undefined` wordt aangevuld. Batches zonder `recept_id` (bijv. Brewfather-imports, die de velden al direct hebben, of puur handmatig aangemaakte batches zonder recept-koppeling) worden niet aangeraakt.

### Files
- `src/App.tsx` — eenmalige `receptBackfillRef`-migratie naast de bestaande sanitizer; vult ontbrekende brouwkundige velden vanuit het gekoppelde recept.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.80 → 1.9.81.

---

## [1.9.80] — 2026-05-17

### Fixed — Kleur en vergistingsschema ontbraken op Dashboard bij batch vanuit lokaal recept

Wanneer je via de "Brouwen"-knop op een recept een nieuwe batch startte, werden alleen de basisvelden (`naam`, `stijl`, `OG`, `FG`, `ABV`, `liter_vergist`) overgenomen. De brouwkundige eigenschappen `kleur`, `vergistingsprofiel`, `maischprofiel`, `kooktijd` en `kook_volume` bleven leeg, waardoor het Dashboard de bierkleur in de tankvisualisatie en het vergistingsschema niet kon tonen. Bij een Brewfather-import (`bfMapBatch` in `src/utils/api.ts`) werden deze velden al wel correct gemapt — vandaar dat geïmporteerde batches het probleem niet hadden.

De `setPreNieuwBatch`-aanroep in `ReceptenPage.tsx` neemt nu dezelfde velden mee als `bfMapBatch`, zodat een handmatig gestarte batch precies dezelfde dashboard-weergave krijgt als een geïmporteerde batch.

### Files
- `src/pages/ReceptenPage.tsx` — `setPreNieuwBatch` neemt nu ook `kleur`, `kooktijd`, `kook_volume`, `vergistingsprofiel` en `maischprofiel` over van het bronrecept.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.79 → 1.9.80.

---

## [1.9.79] — 2026-05-15

### Fixed — α-percentage ook overgenomen bij lot-select op batch-ingrediënten

De lot-`<select>` in de Ingrediënten-sectie van de batch (`BatchesPage.tsx`, rij 2521) was de tweede plek waar lots aan een batch worden gekoppeld — daar gebeurde de α-overname nog niet. Nu wordt voor hop-ingrediënten `alpha_pct` direct gevuld met `getEffectiveBrewProp(lot, ingredient, 'alpha')` zodra je een lot kiest. Dezelfde resolver-volgorde als in `IngredientenPage`: lot wint, anders fallback naar het ingrediënt.

### Changed — Hop-schema sortering: whirlpool/dry-hop ná boil

De hop-schema-tabel in de brouwdag-wizard sorteerde puur op `tijdstip_min` aflopend. Daardoor kwam een whirlpool met tijdstip 10' tussen boil-hops met tijdstip 15' en 5' te staan. De nieuwe groep-volgorde is **mash → boil → whirlpool → dry hop** (binnen elke groep nog steeds aflopend op tijdstip). Whirlpool-toevoegingen staan nu altijd onder de kook-additions, dry-hops onderaan.

### Files
- `src/pages/BatchesPage.tsx` — `getEffectiveBrewProp`-import; lot-`<select>` in ingrediënten-sectie zet ook `alpha_pct` voor hop-rijen.
- `src/components/batch/BrouwdagWizard.tsx` — hop-schema-sortering eerst op groep, dan op tijdstip.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.78 → 1.9.79.

---

## [1.9.78] — 2026-05-15

### Fixed — α-percentage hop-schema toonde nog steeds leeg veld

De v1.9.77-fix vulde α alleen aan bij een nieuwe lot-keuze, en keek alleen naar `lot.bf_props.alpha`. Twee aanvullingen:

- **Ingredient-fallback**: bij lot-keuze wordt nu `getEffectiveBrewProp(lot, ing, 'alpha')` gebruikt — als het lot geen α heeft, valt het terug op de α van het ingrediënt zelf. Identiek aan hoe `IngredientenPage` lot-waarden resolved.
- **Eenmalige sync bij open van wizard**: voor elke hop met een gekoppeld lot/ingredient maar leeg `alpha_pct`, wordt de effectieve α nu alsnog ingevuld. Dit lost batches op die vóór v1.9.77 een lot kregen zonder dat α werd overgenomen. De sync runt één keer per batch-open (via `hopAlphaSyncRef`) zodat een handmatige leegmaak binnen dezelfde sessie niet wordt overschreven.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — `getEffectiveBrewProp`-import; `updHopLot` met ingredient-fallback; nieuwe `useEffect` met `hopAlphaSyncRef` voor eenmalige sync.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.77 → 1.9.78.

---

## [1.9.77] — 2026-05-15

### Fixed — α-percentage van lot wordt nu overgenomen in hop-schema

Wanneer je in het hop-schema een lot selecteert, neemt het α-veld direct de waarde uit `lot.bf_props.alpha` over. Daarvoor moest je de waarde uit de placeholder/tooltip aflezen — het invoerveld bleef leeg of toonde een oudere waarde.

**Gedrag:**
- Lot-keuze ⇒ `alpha_pct` van de batch-hop wordt gevuld met de raw α uit het lot.
- Verouderings-correctie blijft via `effectieveAlpha` werken (kijkt naar `lot.bf_props.year`), dus de IBU-berekening verandert niet — alleen het zichtbare veld klopt nu.
- "Geen lot" kiezen laat de overgenomen waarde staan als handmatige override.
- Bestaande batches met al-gekoppeld lot maar leeg α-veld: kies het lot opnieuw om α over te nemen.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — nieuwe `updHopLot`-handler die lot_id + alpha_pct gelijktijdig zet; lot-`<select>` gebruikt deze nu.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.76 → 1.9.77.

---

## [1.9.76] — 2026-05-15

### Fixed — IBU Tinseth-berekening gaf te hoge waarde bij ontbrekende OG

Wanneer een batch nog geen gemeten OG had **én** het gekoppelde recept geen OG-doel had, viel de bigness-factor in de Tinseth-formule terug op `1.65` (maximum, alsof het wort water was). Dit gaf ~30-70% te hoge IBU t.o.v. een normale 1.050 wort. De berekening returnt nu `0` (en de UI toont "OG nodig") in plaats van een misleidende waarde — pas zodra OG bekend is komt er een IBU op het scherm.

### Added — Recept-doel naast berekende waarden in brouwdag

Drie plekken tonen nu ook wat het recept als doel heeft, zodat afwijkingen direct zichtbaar zijn:

- **Live calculaties (CalcCard's)**: IBU-card toont `Doel: 40.0` onder de berekende waarde wanneer het recept een IBU-doel heeft.
- **Hop-schema header**: tekstje `12 hopen · IBU 35.2` wordt `12 · IBU 35.2 / doel 40.0`.
- **Batch-log entries**: bij wijziging van OG/FG/ABV via het batch-formulier wordt het recept-doel meegelogd, bijv. `OG: 1.048 → 1.052 (doel: 1.055)`.

### Files
- `src/utils/calculations.ts` — `iBUTinseth` returnt 0 bij ontbrekende OG; comment toegevoegd.
- `src/components/batch/BrouwdagWizard.tsx` — `ibuBijdrageVoor` zelfde fix; `CalcCard` accepteert `target`-prop; IBU-card en hop-schema header tonen doel.
- `src/pages/BatchesPage.tsx` — `wijz`-mapper voegt recept-doel toe achter OG/FG/ABV in log-regel.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutel `brouwdag_ibu_geen_og`.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.75 → 1.9.76.

---

## [1.9.75] — 2026-05-15

### Changed — Status 'Verpakt' hernoemd naar 'Afgevuld'

De canonieke batch-status voor de fase na conditioneren is nu **'Afgevuld'** (sluit aan op de activiteit "Afvullen" en het tabblad "Afvulling"). 'Verpakt' blijft als alias herkend zodat oude backups/data nooit breken.

**Eenmalige migratie** via nieuwe data-key `batch_status_afgevuld_migratie_v1` zet bestaande batches met `status='Verpakt'` éénmalig om naar `'Afgevuld'` bij de eerste app-load. Daarna staat de migratie op `'v1'` zodat deze niet opnieuw draait.

**Bijkomende fix:** in v1.9.69–1.9.74 had `StatusSuggestion.tsx` al `'Afgevuld'` als doel-status terwijl `STATUSSEN` nog `'Verpakt'` als waarde had. Daardoor kon de "Bevestig status"-knop een waarde zetten die niet in de status-dropdown stond. Met deze release zijn beide gelijk getrokken.

### Files
- `src/utils/constants.ts` — `STATUSSEN` array, `STATUS_CLR` map en `BF_TO_APP` mapping gebruiken nu `'Afgevuld'`; `'Verpakt'` blijft als alias in `STATUS_CLR`.
- `src/components/ui/Badge.tsx` — `STATUS_LABELS` accepteert beide.
- `src/pages/DashboardPage.tsx`, `src/pages/InstellingenPage.tsx`, `src/pages/ProductenPage.tsx` — beide status-waarden behandelen.
- `src/pages/BatchesPage.tsx` — alle `'Verpakt'`-checks accepteren ook `'Afgevuld'`; nieuwe status-write gebruikt `'Afgevuld'`.
- `src/components/batch/BatchTabs.tsx`, `src/components/batch/StatusSuggestion.tsx` — `'Verpakt'` als afgeronde-status alias toegevoegd.
- `src/App.tsx` — nieuwe `batchAfgevuldMigratieRef`-useEffect met migratie-flag `batch_status_afgevuld_migratie_v1`.
- `src/i18n/nl.json` — `status_packaged` value: "Verpakt" → "Afgevuld".
- `config.yaml`, `CHANGELOG.md` — versie 1.9.74 → 1.9.75.

---

## [1.9.74] — 2026-05-15

### Fixed — Lot-α wint nu van recept-α voor IBU-berekening

Wanneer een hop-additie zowel een gekoppeld lot (met α uit `bf_props.alpha`) als een batch_ingredient.alpha_pct had (uit recept-import), werd ten onrechte de recept-α gebruikt. De resolutie volgorde was `manual > lot > ingredient` — maar bij batches die uit een recept zijn aangemaakt is `alpha_pct` altijd gevuld, waardoor het lot nooit doorkwam.

**Nieuwe volgorde:** `lot > batch_ingredient > ingredient`. Een gekoppeld lot represente­ert de chargespecifieke gemeten waarde (uit de lab-analyse op die specifieke partij) en wint daarom van zowel recept-default als handmatige invoer. De gebruiker kiest impliciet welke α wordt gebruikt door wel/niet een lot te selecteren in de ingrediënten-sectie.

Voor brouwers die echt handmatig willen overschrijven: laat de lot-keuze leeg, of pas `bf_props.alpha` op het lot zelf aan in de lot-edit modal.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — `effectieveAlpha()` resolutie-volgorde gewijzigd; lot-check staat nu eerst.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.73 → 1.9.74.

---

## [1.9.73] — 2026-05-15

### Fixed — IBU te hoog bij batch zonder gemeten OG

Zonder gemeten OG kreeg de Tinseth-formule `sg = 0 || 1 = 1` als invoer, waardoor de bigness-factor altijd maximaal werd (1.65) — dit verhoogde de IBU met ~70% t.o.v. een werkelijk wort van 1.060.

**Fixes:**

- **OG-fallback uit recept-doel.** `ibuOG = batch.OG > 0 ? batch.OG : recept.OG > 0 ? recept.OG : 0`. Voor een geplande batch wordt nu de recept-doel-OG gebruikt zodat de IBU consistent is met Brewfather. Zodra de werkelijke OG wordt ingevuld, schakelt de berekening over.
- **Per-hop IBU-kolom in het Hop-schema** toont de bijdrage van elke individuele hop (afgerond op 0.1). Whirlpool/dry-hop/mash tonen een `—` omdat Tinseth daar verwaarloosbare bijdrage aan toekent.
- **Hover-tooltip op de IBU-totaalbox** toont welke OG (gemeten of doel) en welk kook-volume zijn gebruikt — handig om verschillen met Brewfather snel te herleiden.

Met deze fix zou de berekende IBU binnen ~1–2 IBU van Brewfather's output moeten zitten voor dezelfde inputs. Overgebleven kleine verschillen kunnen komen door Brewfather's "Hop Utilization Factor" (default 100%, configureerbaar per equipment-profile) of doordat BF whirlpool-IBU bijtelt op basis van temperatuur — die laatste correctie voegen we later toe als gewenst.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — `ibuOG`-fallback uit `batchRecept.OG`; `ibuBijdrageVoor()`-helper per hop; nieuwe "IBU"-kolom in het Hop-schema; hover-tooltip op IBU-box met OG-bron en volume.
- `src/i18n/{nl,en,de,fr,es}.json` — 1 nieuwe sleutel (`brouwdag_calc_ibu_volume`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.72 → 1.9.73.

---

## [1.9.72] — 2026-05-15

### Fixed — IBU-berekening werkte niet (gram vs hoeveelheid mismatch)

De Tinseth-formule las `h.gram` maar `batch_ingredienten` slaan de hoeveelheid op als `h.hoeveelheid` — door de `as any`-cast bij de aanroep zag TypeScript dit niet, en omdat `Number(undefined) || 0 = 0` werd elke hop als 0 gram behandeld en kwam de IBU altijd uit op 0.

**Twee fixes:**

1. `iBUTinseth()` leest nu `h.gram ?? h.hoeveelheid` zodat beide naamgevingen werken. `HopVoorIBU` interface bijgewerkt: beide velden zijn optioneel.
2. `BrouwdagWizard` zet `gram: Number(h.hoeveelheid)` expliciet in de IBU-map om de Tinseth-aanname te ondersteunen.

**Volume-fallback verbeterd.** Voor het kookvolume valt het systeem nu in deze volgorde terug:
`kook_volume_eind_l` (gemeten post-boil) → `kook_volume` (recept boil size) → `gist_volume_l` → `liter_vergist`

Hierdoor werkt IBU ook in geplande batches die nog geen kook-volume gemeten hebben.

### Files
- `src/utils/calculations.ts` — `HopVoorIBU.gram` en `.hoeveelheid` beide optioneel; Tinseth-reader gebruikt `gram ?? hoeveelheid`.
- `src/components/batch/BrouwdagWizard.tsx` — `hopsVoorIBU` zet `gram: Number(h.hoeveelheid)` expliciet; volume-fallback uitgebreid met `gist_volume_l` en `liter_vergist`.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.71 → 1.9.72.

---

## [1.9.71] — 2026-05-15

### Fixed — Brewfather "Aroma" hops mappen naar whirlpool + whirlpool-temperatuur overgenomen

Brewfather levert voor flame-out / hopstand-additions de use-waarde **"Aroma"** (en soms "Hopstand" of "Hop Stand"). Onze app kende alleen `boil`/`whirlpool`/`dry hop`/`mash`, dus die Aroma-hops vielen onder de generieke `boil`-fallback en telden ten onrechte mee voor IBU.

**Nieuwe normaliser** `mapHopGebruik()` mapt Brewfather's use-waarden naar onze 4 categorieën:
- `Boil`, `First Wort` → `boil`
- `Aroma`, `Whirlpool`, `Hopstand`, `Hop Stand` → `whirlpool`
- `Dry Hop` → `dry hop`
- `Mash` → `mash`

Wordt nu toegepast in `bfMapRecept` (recept-import), `bfMapBis` (batch-import) en `syncHopUitRecept` ("Tijden uit recept"-knop in Hop-schema). Tinseth-IBU excludeert al niet-boil hops, dus whirlpool-additions tellen nu correct met ~0 IBU.

**Whirlpool-temperatuur overgenomen.** Brewfather's `h.temp` (typisch 75–90°C voor whirlpool/aroma) wordt nu doorgezet via `Recept.hop.temp_c` en `BatchIngredient.temp_c`. In het Hop-schema is een **extra kolom "Temp (whirlpool)"** toegevoegd die alleen voor whirlpool-rijen bewerkbaar is — voor boil/dry-hop/mash toont een `—`.

### Files
- `src/utils/api.ts` — nieuwe `mapHopGebruik()`-helper; `bfMapRecept` en `bfMapBis` normaliseren `gebruik` en nemen `temp_c` over uit `h.temp`.
- `src/types/index.ts` — `BatchIngredient.temp_c?` en `ReceptIngredient.temp_c?` toegevoegd.
- `src/pages/ReceptenPage.tsx` — `_receptIngredienten` mapping neemt `temp_c` mee.
- `src/pages/BatchesPage.tsx` — `pendingBatchIngredienten` save en `syncReceptToBatch` schrijven `temp_c`.
- `src/components/batch/BrouwdagWizard.tsx` — `syncHopUitRecept` normaliseert gebruik via `mapHopGebruik` en kopieert `temp_c`; Hop-schema krijgt nieuwe `Temp`-kolom met whirlpool-input.
- `src/i18n/{nl,en,de,fr,es}.json` — 1 nieuwe sleutel (`hop_schema_temp`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.70 → 1.9.71.

---

## [1.9.70] — 2026-05-15

### Added — Doel-waardes uit recept en IBU prominent in Hop-schema

**Doel-waardes onder kerngegevens.** Bij elke invoer in de Brouwdag-tab toont nu een mini-label de doelwaarde uit het gekoppelde recept — zo zie je tijdens het brouwen direct waar je naartoe werkt:

- **Pre-boil SG**: berekend uit recept-OG × (batch_size / kook_volume)
- **Pre-boil volume**, **kook-volume start**: `recept.kook_volume`
- **Kook-volume eind**, **gist-volume**, **liter vergist**: `recept.batch_size`
- **OG**: `recept.OG`
- **Maisch-pH / product-pH**: typische bereiken (5.2–5.4 / 4.2–4.6) — staan zelden in een recept

Velden zonder doelwaarde tonen niets — geen lege "Doel: —" labels.

**IBU prominent in het Hop-schema.** De berekende IBU staat nu op twee plekken in de Brouwdag-tab:

1. In de **section-header** van het Hop-schema, naast het aantal hops: `5 · IBU 42.3`.
2. In een **highlightbox bovenaan de tabel** met de berekende IBU groot (themakleur) plus — indien aanwezig — het doel-IBU uit het recept en het verschil (+/−) in amber/blauw.

De IBU-tegel boven de kerngegevens blijft behouden voor het overzicht. Wijzigen van lot, α, tijdstip of gebruik werkt direct door op alle drie de displays.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — `<Doel>`-helper-component voor mini-labels onder inputs; doel-waardes uit `batchRecept` + afgeleide pre-boil SG; IBU-totaalbox boven de hop-tabel; IBU in SectionHeader-info naast aantal hops.
- `src/i18n/{nl,en,de,fr,es}.json` — 1 nieuwe sleutel (`brouwdag_typisch`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.69 → 1.9.70.

---

## [1.9.69] — 2026-05-15

### Added — "Tijden uit recept"-knop in Hop-schema

Bestaande batches die zijn aangemaakt vóór v1.9.64 hadden geen hop-tijden in `batch_ingredienten`, omdat de "Brouwen"-flow toen alleen naam/hoeveelheid overdroeg. Ook batches uit lokale recepten zonder ingevulde tijden bleven leeg. Een nieuwe knop **"Tijden uit recept"** verschijnt in het Hop-schema (alleen als de batch een `recept_id` heeft) en kopieert tijden, α-zuur en gebruik uit het gekoppelde recept naar de batch.

Matching gebeurt op hop-naam (case-insensitive). De knop is een vangnet: het overschrijft géén bestaande handmatige waarden, alleen lege velden worden gevuld. Voor batches zonder gekoppeld recept verschijnt de knop niet — daar moeten tijden handmatig of via Brewfather-sync komen.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — nieuwe `syncHopUitRecept()`-functie + "Tijden uit recept"-knop naast "Sync hop-stappen" in het Hop-schema; prop `recepten` toegevoegd.
- `src/pages/BatchesPage.tsx` — `recepten` doorgegeven aan `BrouwdagWizard`.
- `src/i18n/{nl,en,de,fr,es}.json` — 3 nieuwe sleutels (`hop_schema_uit_recept`, `hop_schema_uit_recept_hint`, `hop_schema_recept_geen_hops`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.68 → 1.9.69.

---

## [1.9.68] — 2026-05-15

### Changed — Instellingen-card hernoemd naar "Hop-opslag defaults"

De in v1.9.67 toegevoegde card "Brouwproces-defaults" heeft alleen een hop-opslag instelling — de titel is daarom aangescherpt naar **"Hop-opslag defaults"**. Beschrijving en field-label aangepast voor consistentie (`settings_hop_storage` → "Opslag-conditie" want context is via de card-titel al duidelijk).

De onderliggende data-key (`brouwproces_instellingen`) blijft ongewijzigd — geen migratie nodig.

### Files
- `src/i18n/{nl,en,de,fr,es}.json` — `settings_brouwproces_title`, `settings_brouwproces_desc`, `settings_hop_storage` aangepast in alle 5 talen.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.67 → 1.9.68.

---

## [1.9.67] — 2026-05-15

### Added — Globale hop-opslag default in instellingen

Nieuwe instellingen-card **"Brouwproces-defaults"** met daarin de standaard hop-opslag conditie. Deze geldt als globale fallback voor alle hop-lots die geen eigen `bf_props.storage` hebben — handig wanneer je hele inventaris in dezelfde koelkast/diepvries staat en je niet per lot apart wilt instellen.

Resolutie-volgorde voor opslag-conditie in de IBU-verouderingsberekening:
1. **Lot-eigen** `bf_props.storage` (per-lot override in de lot-edit modal)
2. **Globale default** uit instellingen (`brouwproces_instellingen.hop_storage`)
3. Hardcoded fallback `vacuum_koel`

Nieuwe data-key `brouwproces_instellingen` wordt in de Excel-backup meegenomen.

### Files
- `src/App.tsx` — `useStore('brouwproces_instellingen', {hop_storage:'vacuum_koel'})`, doorgegeven aan `BatchesPage` en `InstellingenPage`, opgenomen in Excel-export/import.
- `src/pages/InstellingenPage.tsx` — nieuwe card "Brouwproces-defaults" naast Planning-card met dropdown voor 5 opslag-opties.
- `src/pages/BatchesPage.tsx` — prop `brouwprocesInst` toegevoegd; doorgegeven aan `BrouwdagWizard` als `hopStorageDefault`.
- `src/components/batch/BrouwdagWizard.tsx` — `effectieveAlpha()` neemt nu een `storageDefault`-parameter (default `vacuum_koel`); lot-dropdown-preview gebruikt ook globale default.
- `src/i18n/{nl,en,de,fr,es}.json` — 4 nieuwe sleutels (`settings_brouwproces_title`, `settings_brouwproces_desc`, `settings_hop_storage`, `settings_brouwproces_hop_storage_hint`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.66 → 1.9.67.

---

## [1.9.66] — 2026-05-15

### Added — Hop-veroudering in IBU-berekening (Garetz / Hieronymus)

α-zuur in hop degradeert exponentieel afhankelijk van opslag-conditie en leeftijd. De IBU-berekening past nu automatisch verouderings-correctie toe wanneer een hop-lot een oogstjaar (`bf_props.year`) of een aankoopdatum heeft.

**Formule** (vereenvoudigde Garetz/Hieronymus):

`α(t) = α₀ × e^(−k · t · hsi/0.30)`

waarbij `k` de opslag-constante is (verlies per jaar bij standaard HSI=0.30), `t` de leeftijd in jaren sinds oogst en `hsi` de Hop Stability Index (default 0.30 wanneer onbekend). Een vacuum-verpakt lot in de koelkast verliest ~10%/jaar bij gemiddelde HSI; in een luchtdoorlatende zak bij kamertemp ~50%/jaar.

**Opslag-constanten:**
| Opslag | Verlies/jaar |
|---|---|
| Vacuum + diepvries (-18°C) | 5% |
| Vacuum + koel (4°C) / Lucht + diepvries | 10% |
| Lucht + koel | 20% |
| Lucht + kamertemp | 50% |

**UI in het Hop-schema:**
- Lot-dropdown toont per optie de verouderingsindicatie: `Galaxy 2024 · α 14.0% → 13.2% (8m)`.
- α-cel kleurt **amber** wanneer verouderings-correctie wordt toegepast (vs groen voor lot-α zonder leeftijd). Tooltip toont oorspronkelijke α, leeftijd, behoud% en opslag-conditie.
- Onder de α-cel een mini-label `uit lot · 94% behoud`.
- IBU-tegel boven het schema werkt direct met de gecorrigeerde α.

**Lot-edit modal** (IngredientenPage): Hop-lots krijgen een extra `storage`-veld (select met 5 opties) in de brouw-eigenschappen sectie naast de bestaande `alpha`/`hsi`/`year`. Defaults op `vacuum_koel`.

De brouwdatum geldt als referentie voor de leeftijd-berekening, zodat IBU consistent blijft als de batch later opnieuw wordt geopend.

### Files
- `src/utils/calculations.ts` — `HOP_OPSLAG_FACTOR`-lookup, `hopOpslagFactor()`, `hopVerouderdeAlpha()`-helper met Garetz/Hieronymus-formule.
- `src/utils/constants.ts` — `LOT_BREW_FIELDS_PER_TYPE.Hop` krijgt `storage`-select met 5 opslag-opties.
- `src/components/batch/BrouwdagWizard.tsx` — `effectieveAlpha()` past nu verouderings-correctie toe wanneer lot een oogstjaar/aankoopdatum heeft; nieuwe bron `lot_verouderd`. Hop-schema toont verouderde α + leeftijd in dropdown, behoud% onder α-cel, amber kleur en uitgebreide tooltip.
- `src/i18n/{nl,en,de,fr,es}.json` — 13 nieuwe sleutels (`hop_schema_bron_lot_verouderd`, `hop_schema_alpha_verouderd`, `hop_opslag_*`, `brew_storage_*`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.65 → 1.9.66.

---

## [1.9.65] — 2026-05-15

### Added — IBU-berekening met chargespecifieke α-zuur uit hop-lots

De IBU-berekening (Tinseth) gebruikt nu de **lot-specifieke α-zuur waarde** uit `Lot.bf_props.alpha` wanneer een hop-additie aan een lot is gekoppeld. Een Galaxy-lot uit 2024 kan bv. 13.8% α leveren terwijl het recept generiek 14.0% noteert — het verschil werkt nu direct door in de IBU-berekening.

In het Hop-schema is een **lot-dropdown** toegevoegd per hop-additie. De α%-cel toont:
- Achtergrondkleur **groen** wanneer α uit lot komt (chargespecifiek).
- Achtergrondkleur **blauw** wanneer α uit de ingredient-default komt (`Ingredient.bf_props.alpha`).
- Geen kleur wanneer de gebruiker een handmatige waarde heeft ingevuld — die overruled de lot/ingredient-default.

De resolutie-volgorde voor α: **handmatige override → lot.bf_props.alpha → ingredient.bf_props.alpha**. Wijzigen van het lot of het invullen van α werkt direct door in de IBU-tegel boven het schema.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — `effectieveAlpha()`-helper, IBU-berekening map nu hop's met effectieve α, hop-schema-tabel kreeg lot-kolom met dropdown en bron-indicator op de α-cel. Props `lots` en `ingredienten` toegevoegd.
- `src/pages/BatchesPage.tsx` — `lots` en `ing` doorgegeven aan `BrouwdagWizard`.
- `src/i18n/{nl,en,de,fr,es}.json` — 7 nieuwe sleutels (`hop_schema_lot`, `hop_schema_geen_lot`, `hop_schema_alpha_uit_*`, `hop_schema_bron_*`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.64 → 1.9.65.

---

## [1.9.64] — 2026-05-15

### Fixed — Hop-tijden en mout-extract% uit recept overnemen bij batch-creatie

Wanneer een batch werd aangemaakt vanuit een (lokaal of Brewfather-)recept via de "Brouwen"-knop, gingen alleen naam/hoeveelheid/eenheid mee naar `batch_ingredienten`. De hop-tijden (`tijd`/`gebruik`) en alpha%, plus mout-yield, bleven leeg — waardoor de IBU- en efficiency-berekeningen in de Brouwdag-wizard niet werkten en hop-stappen "@ ?min" toonden.

Nu wordt bij batch-creatie én bij "Sync recept" overgenomen:
- **Mout / Suiker**: `extract_pct` uit `recept.mout.extract_pct` of fallback uit `Ingredient.bf_props.yield`.
- **Hop**: `tijdstip_min` (uit `recept.hop.tijd`), `alpha_pct` (uit recept of `bf_props.alpha`), `gebruik` (boil/whirlpool/dry-hop/mash) — default `boil`.

Voor recepten die uit Brewfather zijn gesynchroniseerd worden yield% en alpha% nu ook in het recept zelf bewaard (`bfMapRecept`), zodat de waarden ook bij latere wijzigingen behouden blijven.

### Files
- `src/types/index.ts` — `ReceptIngredient.alpha_pct?` en `extract_pct?` toegevoegd.
- `src/utils/api.ts` — `bfMapRecept` neemt nu `yield`/`potential` (mout → extract_pct) en `alpha` (hop → alpha_pct) over uit Brewfather.
- `src/pages/ReceptenPage.tsx` — "Brouwen"-knop neemt `extract_pct` (mout), `tijdstip_min`/`gebruik`/`alpha_pct` (hop), en `gebruik` (overig) mee in `_receptIngredienten`.
- `src/pages/BatchesPage.tsx` — `pendingBatchIngredienten`-verwerking én `syncReceptToBatch` zetten brouwkundige velden op nieuwe `batch_ingredienten` met fallback uit `Ingredient.bf_props`.
- `config.yaml`, `CHANGELOG.md` — versie 1.9.63 → 1.9.64.

---

## [1.9.63] — 2026-05-15

### Fixed — Hop-additie stappen tonen werkelijke tijd

Hop-additie stappen in de Brouwdag-stappenlijst toonden "@ ?min" als het tijdstip op het moment van genereren leeg was (oude batches of Brewfather-recepten zonder hop-timing). Het label was statisch en updatete niet wanneer de gebruiker het tijdstip in het Hop-schema invulde.

- `BrouwdagStap` heeft nu een optioneel `batch_ingredient_id` veld dat de stap koppelt aan de bron-hop. Bij render wordt het label live opgebouwd uit `batch_ingredienten`, zodat wijzigingen in het Hop-schema (tijdstip, naam, α-zuur) direct doorwerken in de stappenlijst.
- Voor bestaande stappen zonder `batch_ingredient_id` valt de render-laag terug op naam-matching uit het opgeslagen label ("Hop-additie: NAAM @").
- Nieuwe **"Sync hop-stappen"** knop in de Hop-schema-sectie wist en regenereert alle hop-stappen op basis van het actuele schema. Handig wanneer hops zijn toegevoegd/verwijderd of wanneer de oude labels niet meer kloppen.
- Bij genereren worden alleen hops met `gebruik=boil` (of leeg) als koken-stap toegevoegd; dry-hop/whirlpool/mash-hops verschijnen niet meer in de kook-fase.

### Files
- `src/types/index.ts` — `BrouwdagStap.batch_ingredient_id?: number` toegevoegd.
- `src/components/batch/BrouwdagWizard.tsx` — `hopAddLabel()`-helper, `resolveStapLabel()` met fallback-name-match, `syncHopStappen()`-knop, `genereerStappen` zet nu `batch_ingredient_id` en filtert op `gebruik`, `StapRij` accepteert `label`-override prop.
- `src/i18n/{nl,en,de,fr,es}.json` — 2 nieuwe sleutels (`hop_schema_sync`, `hop_schema_sync_hint`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.62 → 1.9.63.

---

## [1.9.62] — 2026-05-15

### Changed — Brouwdag-wizard verfijnd op basis van feedback

- **pH-velden toegevoegd** aan de kerngegevens van de Brouwdag-tab: maisch-pH en product-pH zijn nu direct invulbaar naast OG/SG/volumes. De velden bestonden al op `Batch` (en werden in de Info-card getoond) maar konden niet zonder via-de-edit-modal worden bijgewerkt.
- **Tank-selector** toegevoegd aan de kerngegevens. Bij batches met geconfigureerde tanks wordt een dropdown getoond; anders een vrije tekstinvoer. Zo wordt de tank al gekoppeld tijdens het brouwen i.p.v. pas bij overgang naar Vergisten.
- **Hop-schema** als nieuwe sub-sectie onder de kerngegevens. Tabel met alle hop-ingrediënten van de batch (sortering op tijdstip aflopend) met directe invoer voor α-zuur%, tijdstip in minuten vóór einde koken, en gebruik (Koken / Whirlpool / Dry-hop / Maisch). Wijzigingen werken direct door in de IBU-berekening (Tinseth).
- **Stappenlijst inklapbaar** gemaakt met een SectionHeader; toont voortgang (`voltooid/totaal`) in de header. Hop-schema is ook inklapbaar.
- **Volumes & gistingsvoortgang** worden niet meer getoond zolang de batch op status `Gepland` of `Brouwen` staat (tenzij `brouwdag_voltooid=true`). Hierdoor lijkt een uit Brewfather geïmporteerde `estimatedBatchSize` niet ten onrechte "in tank" te staan voordat er werkelijk is gebrouwen.

### Files
- `src/components/batch/BrouwdagWizard.tsx` — kerngegevens uitgebreid met `maisch_ph`, `product_ph` en tank-selector; nieuwe sub-sectie `hop-schema` met inline-edit op `batch_ingredienten` (alpha_pct, tijdstip_min, gebruik); stappenlijst nu in inklapbare SectionHeader; extra props `setBi`, `tanks`.
- `src/pages/BatchesPage.tsx` — `setBi` en `tanks` doorgegeven aan `BrouwdagWizard`; volumes-blok en gistingsvoortgang-blok krijgen extra guard (`status in {Vergisten,Conditioneren,Verpakt,Afgevuld,Gesloten} || brouwdag_voltooid`).
- `src/i18n/{nl,en,de,fr,es}.json` — 10 nieuwe sleutels (`brouwdag_stappen_titel`, `hop_schema_*`, `hop_gebruik_*`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.61 → 1.9.62.

---

## [1.9.61] — 2026-05-15

### Added — Brouwdag-wizard, batch-tabs en extra calculaties

De batch-detailweergave is opgesplitst in zes tabbladen (**Info**, **Brouwdag**, **Vergisting**, **Conditionering**, **Afvulling**, **Financieel**) die automatisch de actieve fase volgen. Boven de tabs verschijnt een statussuggestie-banner zodra een overgang voor de hand ligt (OG gemeten → Vergisten, FG stabiel → Conditioneren, tank leeg → Afgevuld) — de gebruiker bevestigt of negeert.

In de **Brouwdag**-tab staat een wizard die stappen uit het recept genereert (water → maisch → lauter → koken met hop-additie-momenten → koelen → OG). Per stap toon je verwachte vs gemeten waarde, plus een opmerking. Onder de wizard berekent het systeem live: maisch-efficiency (uit pre-boil SG + volume + extract% van de mout), brouwzaal-efficiency (uit OG + volume-naar-gisttank), kook-verdamping per uur en IBU volgens Tinseth (uit hop-additie-tijden + α-zuur).

Nieuwe registraties: **Water-addities & mineralen** (per fase: volume, pH, EC, vrije mineralen-string), **Dry-hop / fermentatie-addities** (datum, gram, contactdagen + automatische verwijderdatum), **Koel-log** (start/eindtemp, duur, methode). Op de **Afvulling**-tab staat een **priming-sugar-calculator** met suikertype-keuze (dextrose/sucrose/DME/honing/bruine suiker), residueel-CO₂ uit biertemperatuur en doel-CO₂-vols.

Nieuwe calculaties in `calculations.ts`: `sgToPlato`/`platoToSg`, `apparentAttenuation`, `realAttenuation`, `voorspelFG`, `mashEfficiency`, `brouwzaalEfficiency`, `kookVerdampingPct`, `iBUTinseth`, `primingSugarG`, `residualCO2`, `fgStabiel`. Brewfather-import in `bfMapBis` neemt nu yield% (extract), α-zuur en hop-kooktijden over.

Bestaande data blijft volledig intact en bewerkbaar — er is geen migratie nodig. De nieuwe data-sleutels `brouwdag_stappen`, `water_addities`, `hop_addities`, `dry_hops` en `koel_logs` zijn toegevoegd aan de Excel-backup.

### Files
- `src/types/index.ts` — 5 nieuwe interfaces (`BrouwdagStap`, `WaterAdditie`, `HopAdditie`, `DryHop`, `KoelLog`) + uitbreiding `Batch` (pre_boil_sg/volume, kook_volume_start/eind_l, gist_volume_l, mash/brouwzaal_efficiency_pct, kook_verdamping_pct, ibu_berekend, gist_attenuation_pct, brouwdag_voltooid) + uitbreiding `BatchIngredient` (extract_pct, alpha_pct, tijdstip_min, gebruik).
- `src/utils/calculations.ts` — 11 nieuwe brouw-calculaties (Plato↔SG, attenuatie, FG-voorspelling, mash/brouwzaal-efficiency, kookverdamping, IBU Tinseth, priming sugar, residueel CO₂, FG-stabiliteit).
- `src/utils/api.ts` — `bfMapBis` neemt nu yield/extract% (mout), alpha%, kooktijd en gebruik (hop) over uit Brewfather.
- `src/utils/excel.ts` — 5 nieuwe sheets (BrouwdagStappen, WaterAddities, HopAddities, DryHops, KoelLogs) in backup-export/import.
- `src/components/batch/BatchTabs.tsx` — tabnavigatie met fase-indicator.
- `src/components/batch/BrouwdagWizard.tsx` — wizard met stappen, kerngegevens-invoer en live calculaties.
- `src/components/batch/DryHopSection.tsx` — dry-hop registratie met contactdagen-teller en verwijder-suggestie.
- `src/components/batch/KoelLogSection.tsx` — koeling-log.
- `src/components/batch/WaterAdditieSection.tsx` — water/mineralen-registratie.
- `src/components/batch/PrimingSugarCalc.tsx` — priming-sugar calculator.
- `src/components/batch/StatusSuggestion.tsx` — banner met status-suggesties.
- `src/pages/BatchesPage.tsx` — tab-state, conditionele rendering, nieuwe componenten geïntegreerd, nieuwe props.
- `src/App.tsx` — 5 nieuwe `useStore`-sleutels (`brouwdag_stappen`, `water_addities`, `hop_addities`, `dry_hops`, `koel_logs`), excel-export/import wiring, reset-app uitgebreid.
- `src/i18n/{nl,en,de,fr,es}.json` — ~110 nieuwe i18n-sleutels (tabs, brouwdag-wizard, dry-hop, water, koeling, priming, attenuatie, status-suggesties, calc-labels).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.60 → 1.9.61.

---

## [1.9.60] — 2026-05-15

### Added — "Sync recept"-knop op geplande batches

Wanneer een batch via de Recepten-pagina is aangemaakt (knop "Brouwen") wordt het recept-id voortaan op de batch bewaard (`recept_id`). Zolang de batch op status **Gepland** staat verschijnt in de batch-header een nieuwe knop **⟳ Sync recept** waarmee het oorspronkelijke recept opnieuw naar de batch kan worden gesynchroniseerd. Dit is handig wanneer het recept ná het aanmaken van de batch nog is aangepast (bijvoorbeeld via Brewfather-sync of een lokale wijziging).

De synchronisatie vervangt de batch-velden (naam, stijl, OG/FG/ABV, batch-volume, kook-/vergistings-/maischprofiel) én de volledige ingrediëntenlijst van de batch. Lot-koppelingen worden gereset omdat de hoeveelheden en typen kunnen wijzigen. Een bevestigingsdialoog waarschuwt vooraf, en de actie wordt gelogd in zowel het batch-log als de audit trail. Zodra de batch verder is dan "Gepland" verdwijnt de knop, zodat eenmaal geboekte ingrediënten of metingen niet per ongeluk worden overschreven.

### Files
- `src/types/index.ts` — `Batch.recept_id?: string` toegevoegd.
- `src/pages/ReceptenPage.tsx` — `recept_id` doorgegeven aan `setPreNieuwBatch`.
- `src/pages/BatchesPage.tsx` — `recepten`-prop, `syncReceptToBatch`-handler en "Sync recept"-knop in zowel desktop- als mobiele headerbalk.
- `src/App.tsx` — `recepten` doorgegeven aan `BatchesPage`.
- `src/i18n/{nl,en,de,fr,es}.json` — 5 nieuwe vertalingen (`batch_sync_recept*`).
- `config.yaml`, `CHANGELOG.md` — versie 1.9.59 → 1.9.60.

---

## [1.9.59] — 2026-05-13

### Fixed — Dashboard-tegel "Voorraad beschikbaar" leidt nu naar AGP

De `StatCard` "Voorraad beschikbaar" op het dashboard riep `setPage('voorraad')` aan, maar die routesleutel bestaat niet in `App.tsx`. Daardoor gebeurde er niets bij klikken. De waarde wordt berekend uit `voorraadPerLocatie`, dezelfde bron die de AGP-pagina gebruikt om bier­voorraad per locatie te tonen, dus de tegel verwijst nu naar `'agp'`.

### Files
- `src/pages/DashboardPage.tsx` — `onClick` van `lbl_stock_available` zet pagina op `'agp'` in plaats van een niet-bestaande `'voorraad'`.
- `config.yaml` — versie bump 1.9.58 → 1.9.59.

---

## [1.9.58] — 2026-05-13

### Fixed — Productkostprijs/liter komt nu overeen met het kostprijsoverzicht op de Batch-pagina

De kostprijs/liter op de Producten-pagina liet alleen ingrediënten en utility-kosten zien, gedeeld door `liter_vergist`. Op de Batch-pagina wordt voor verpakte/gesloten batches een uitgebreider kostprijsoverzicht getoond dat naast brouwkosten ook verpakkingskosten en accijns meeneemt, gedeeld door de werkelijk afgevulde liters uit `afvullingen`. Daardoor week de productkostprijs structureel af.

`berekenProductKostprijs` is uitgebreid met `afvullingen`, `verpakkingen`, `onderdelen` en `accijns`, en past nu exact dezelfde logica toe als het batch-overzicht: per batch worden brouwoverhead, ingrediënten, verpakkingskosten per type (incl. onderdelen-fallback) en accijns (werkelijk geboekt of voorcalc-snapshot) opgeteld en gedeeld door de som van afgevulde liters. Batches zonder afvullingen tellen niet mee, anders zou hun volume nul zijn en zou alleen hun kostpost de uitkomst vertekenen. `ProductenPage.productStats` gebruikt nu deze gedeelde util.

### Files
- `src/utils/calculations.ts` — `berekenProductKostprijs` rekent inclusief verpakking + accijns op basis van afgevulde liters.
- `src/pages/ProductenPage.tsx` — `productStats` gebruikt `berekenProductKostprijs`; ontvangt `onderdelen` als prop.
- `src/App.tsx` — `onderdelen`-prop doorgegeven aan `ProductenPage`.
- `config.yaml` — versie bump 1.9.57 → 1.9.58.

---

## [1.9.57] — 2026-05-13

### Added — Per verpakkingssoort instellen of voorraad naar WooCommerce wordt gepusht

Op de Producten-pagina staat bij elk artikel een nieuwe checkbox "Meenemen in WooCommerce-voorraadpush". Standaard staat die aan, bestaande artikelen behouden hun huidige gedrag (ontbrekend `wc_push` wordt als ingeschakeld behandeld). Zet hem uit voor verpakkingen die je niet in je webshop verkoopt (bijv. losse 30L-fusten voor horeca), dan slaat de WooCommerce-push die SKU over. Naast de verpakkingsnaam staat een klein WooCommerce-paars bolletje als visuele indicator; grijs-transparant betekent uitgeschakeld.

### Files
- `src/types/index.ts` — `ProductArtikel.wc_push?: boolean`.
- `src/pages/ProductenPage.tsx` — toggle in artikel-form, indicator in tabel, `wcPushAll` filtert `wc_push === false`.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutels `lbl_artikel_wc_push`, `tip_artikel_wc_push`, `tip_artikel_wc_push_aan`, `tip_artikel_wc_push_uit`.
- `config.yaml` — versie bump 1.9.56 → 1.9.57.

---

## [1.9.56] — 2026-05-13

### Fixed — Productkostprijs en marge te laag/hoog door ontbrekende lot-fallback

Op de Producten-pagina werd de kostprijs per liter berekend door alleen het expliciete `kosten`-veld van elke batch-ingredient op te tellen. Wanneer de gebruiker bij het toewijzen van een lot geen handmatig bedrag invoerde, blijft `kosten` echter `null` en hoort de prijs uit `lot.prijs_per_eenheid × hoeveelheid` te komen — precies wat `ingKosten()` op de Batches-pagina al doet. Door die ontbrekende fallback kwamen ingrediënten zonder expliciete kosten als gratis uit de berekening, viel de productkostprijs te laag uit en zag de getoonde marge er onrealistisch hoog uit.

De fallback uit `BatchesPage.ingKosten()` is overgenomen in `productStats` en in de gedeelde util `berekenProductKostprijs` (waarvan de `lots`-parameter al bestond maar niet gebruikt werd).

### Files
- `src/pages/ProductenPage.tsx` — `productStats`-memo gebruikt nu de lot-prijs als fallback en heeft `lots` in zijn dependency-array.
- `src/utils/calculations.ts` — `berekenProductKostprijs` past dezelfde fallback toe; `_lots` → `lots`.
- `config.yaml` — versie bump 1.9.55 → 1.9.56.

---

## [1.9.55] — 2026-05-13

### Changed — Planning en tank-bezetting samengevoegd tot één agenda

De Planning-pagina had drie aparte secties: maand-grid, lijstweergave en tank-bezetting. Die zijn vervangen door één tank-tijdlijn die als agenda werkt. Geplande batches zijn nu sleepbaar: horizontaal versleept de brouwdatum, verticaal naar een andere rij wijst een andere tank toe. Batches zonder tank verschijnen in een aparte rij "Zonder tank" bovenaan; sleep ze naar een tankrij om toe te wijzen. Tijdens het slepen toont een verticale lijn met datum-label de nieuwe positie. Klikken op een geplande balk selecteert hem voor de "Behoefte vs voorraad"-berekening (zoals voorheen in de maand-grid).

Lopende batches (Vergisten/Conditioneren) staan informatief in de tijdlijn maar zijn niet sleep- of klikbaar.

### Files
- `src/pages/PlanningPage.tsx` — maand-grid en lijstweergave verwijderd; één agenda-sectie met HTML5 drag-and-drop op de tank-tijdlijn (incl. "Zonder tank"-rij en drop-preview).
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutels `plan_agenda_help`, `plan_agenda_sleep_tip`.
- `config.yaml` — versie bump 1.9.54 → 1.9.55.

---

## [1.9.54] — 2026-05-13

### Fixed — Geplande brouwsels op dashboard toonden liters als bedrag

De agenda-widget op het dashboard formatteerde `liter_vergist` met `fmt()`, die het euroteken én twee decimalen forceert. Een batch van 20 L verscheen daardoor als `€20,00 L` (en bij 1 L als `€1,00 L`), wat overkwam als een kostprijs van een euro per liter. De waarde wordt nu via `fmtQty()` getoond — gewoon `20 L` zonder euroteken.

### Files
- `src/pages/DashboardPage.tsx` — agenda-widget gebruikt `fmtQty(b.liter_vergist)` in plaats van `fmt(b.liter_vergist)`.
- `config.yaml` — versie bump 1.9.53 → 1.9.54.

---

## [1.9.53] — 2026-05-11

### Changed — Coldcrash streept warmere vergistingsstappen af

Als de brouwer op **Cold-crash** klikt, springen alle vergistingsprofiel-stappen met een temperatuur hoger dan de cold-crash target nu automatisch naar de status "afgerond" (line-through). De `vergisting_stap_idx` wordt verplaatst naar de eerste stap die op of onder het target ligt — typisch de cold-crash-stap zelf, of de laatste stap als er geen lagere temp in het profiel staat.

De doel-stap wordt nooit teruggedraaid: als de batch al verder was dan de berekende sprong, blijft de huidige positie staan.

### Files
- `src/pages/DashboardPage.tsx` — `startColdCrash` zoekt de eerste stap met `temp ≤ target` en update `vergisting_stap_idx` + `vergisting_stap_start` in dezelfde batch-patch; audit-omschrijving vermeldt de stapsprong.
- `config.yaml` — versie bump 1.9.52 → 1.9.53.

---

## [1.9.52] — 2026-05-11

### Fixed — Status-pill en actieknop overlapten tanknaam

Op smalle tank-cards (288 px) viel de combinatie `[pill] [Naar Schoon/Ontsmet]` rechts naast de tanknaam over de naam heen. Pill en knop staan nu verticaal gestapeld in een kolom rechtsboven, pill bovenaan met `whitespace-nowrap` zodat hij niet breekt, actieknop daaronder.

### Files
- `src/pages/DashboardPage.tsx` — top-row gewijzigd naar `flex-col items-end` voor de status-kolom.
- `config.yaml` — versie bump 1.9.51 → 1.9.52.

---

## [1.9.51] — 2026-05-11

### Fixed — Lege tank toonde nog "In gebruik" na Verpakt-overgang

`anyBatch` op het dashboard filterde tot nu toe op `status !== 'Gesloten'`, waardoor een batch met status `Verpakt` (of `Gepland`) de tank visueel nog steeds als "In gebruik" markeerde — terwijl de tank fysiek leeg is en de auto-Vuil trigger al gevuurd had. De filter gebruikt nu `TANK_STATUSSEN` uit `calculations.ts` (`Brouwen` / `Vergisten` / `Conditioneren`), wat overeenkomt met de logica van de auto-Vuil trigger. Een Verpakt/Gesloten batch laat `batch.tank` nog als historische referentie staan, maar telt niet meer mee voor de "In gebruik"-pill.

### Files
- `src/pages/DashboardPage.tsx` — `anyBatch` filtert op `TANK_STATUSSEN`; import uitgebreid.
- `config.yaml` — versie bump 1.9.50 → 1.9.51.

---

## [1.9.50] — 2026-05-11

### Changed — Tank-cyclus en dashboard-layout

`In gebruik` valt nu samen met de hygiënecyclus, zodat elke tank op het dashboard precies één status-pill heeft i.p.v. twee badges naast elkaar:

- Volgorde: **In gebruik → Vuil → Schoon → Ontsmet → In gebruik**. "In gebruik" is een afgeleide status (computed) zodra er een actieve batch in de tank zit; zodra die de tank verlaat valt de tank terug op `Vuil` (auto-trigger).
- Top-right van elke tank-card toont één pill (amber/rood/blauw/groen) met direct ernaast de actieknop voor de volgende stap (`Naar Schoon` bij Vuil, `Naar Ontsmet` bij Schoon). Bij `Ontsmet` en `In gebruik` is er geen knop — er valt niets te doen.
- De batch-status (Vergisten/Conditioneren) is verplaatst naar het batch-info-blokje onder de tank-naam, weg uit de drukke header-rij.
- De "Markeer Vuil"-actie voor herreiniging is een onopvallende ghost-link onderaan de card, alleen zichtbaar bij Schoon/Ontsmet.
- Voor lege tanks toont het lege-staat-label nu ook de datum sinds wanneer de tank leeg/op die status staat.

### Files
- `src/pages/DashboardPage.tsx` — top-row vereenvoudigd, hygiëne en batch-status samengevoegd in één cyclus, dead code (`statusBadgeCls`) verwijderd.
- `config.yaml` — versie bump 1.9.49 → 1.9.50.

---

## [1.9.49] — 2026-05-11

### Changed — Tankhygiëne verhuist naar het dashboard

De aparte Tanks-pagina verviel; alle reinigingsstatus + acties zijn nu geïntegreerd in de bestaande tank-cards op het dashboard.

- Elke tank-card toont een `Hygiëne`-rij met statusbadge (Vuil/Schoon/Ontsmet) en de datum sinds wanneer.
- Wanneer een tank in gebruik is door een batch verschijnt een amberkleurige `In gebruik`-badge naast de status-pill; de reinigingsknoppen zijn dan verborgen.
- Voor lege tanks zijn de stapsgewijze actieknoppen direct beschikbaar op de card (`Naar Schoon` → `Naar Ontsmet`, plus `Markeer Vuil` voor herreiniging). De modal voor uitvoerder/middel/CIP/opmerking opent vanaf de card.
- De Tanks-navigatie-entry onder Brouwerij is verwijderd. De HACCP-audittrail blijft raadpleegbaar onder HACCP → Tankreiniging.

### Files
- `src/pages/DashboardPage.tsx` — tank-card uitgebreid met hygiëne-rij, `In gebruik`-badge en reinigingsmodal; nieuwe props `tankStatussen` / `setTankStatussen` / `tankLog` / `setTankLog`.
- `src/pages/TanksPage.tsx` — verwijderd.
- `src/App.tsx` — `TanksPage`-import, nav-entry en render-blok verwijderd; dashboard krijgt tank-status props.
- `src/i18n/{nl,en,de,fr,es}.json` — sleutels `tanks_hygiene` en `tanks_in_gebruik` toegevoegd.
- `config.yaml` — versie bump 1.9.48 → 1.9.49.

---

## [1.9.48] — 2026-05-11

### Added — Tankreinigingsstatus + HACCP-logging

Iedere tank krijgt nu een reinigingsstatus (`Vuil` → `Schoon` → `Ontsmet`) die de HACCP-flow tussen twee batches afdwingt:

- Zodra een batch een tank verlaat (overpompen naar bright tank, status naar `Verpakt`/`Gesloten`, of tankwijziging via formulier/verplaatsmodal) gaat de oude tank automatisch op `Vuil`. De auto-trigger is idempotent — herhaaldelijke statuswijzigingen produceren slechts één log-entry.
- De brouwer schakelt handmatig naar `Schoon` en daarna naar `Ontsmet` via een nieuwe **Tanks**-pagina onder Brouwerij. Elke stap vraagt om uitvoerder, schoonmaakmiddel, CIP/handmatig en opmerking — opgeslagen in een onuitwisbare HACCP-log.
- Een batch kan alleen aan een tank toegewezen worden die status `Ontsmet` heeft. Zowel het nieuwe-batch-formulier als de verplaatsmodal disablen niet-ontsmette tanks; `saveBatch` en `handleMoveTank` blokkeren extra met `err_tank_not_sanitized`.
- HACCP-pagina krijgt een tab **Tankreiniging** met de volledige (read-only) log: tank-filter, statusfilter, datumbereik en vrije tekstzoek.
- Bestaande tanks krijgen via een eenmalige migratie (`tank_status_migratie_v1`) default status `Ontsmet` zodat huidige workflows niet breken.

### Files
- `src/types/index.ts` — `TankReinigingStatus`, `TankStatusEntry`, `TankStatusMap`, `TankReinigingLog` toegevoegd.
- `src/utils/constants.ts` — `TANK_REINIGING_STATUSSEN`, `TANK_REINIGING_KLEUR`, `TANK_REINIGING_LABEL_KEY`.
- `src/utils/calculations.ts` — `markTankVuilBijVertrek` helper (idempotent, forceert `Vuil` ongeacht oude status).
- `src/utils/excel.ts` — backup-sheets `TankStatussen` (object plat geslagen) + `TankReinigingLog`.
- `src/App.tsx` — nieuwe `useStore`-keys, migratie-effect, nav-entry `tanks`, render-blok, doImport-handlers.
- `src/pages/TanksPage.tsx` *(nieuw)* — statusoverzicht per soort + modal + per-tank log.
- `src/pages/HACCPPage.tsx` — tab `tankreiniging` + `TankReinigingTab` (raadpleegbare audittrail).
- `src/pages/BatchesPage.tsx` — guards, disabled-filters in beide tank-dropdowns, auto-Vuil triggers bij tankwijziging en batch-statusovergang naar `Verpakt`/`Gesloten`.
- `src/i18n/{nl,en,de,fr,es}.json` — alle nieuwe sleutels in 5 talen.
- `config.yaml` — versie bump 1.9.47 → 1.9.48.

---

## [1.9.47] — 2026-05-09

### Fixed — Dashboard: beschikbare voorraad en THT-alerts kloppen weer

De stat-kaart "Voorraad beschikbaar" en de THT-waarschuwingen op het dashboard rekenden op `uitleveringen.aantal − uitleveringen.verkocht_stuks`. Sinds `verkocht_stuks` bij het aanmaken van een uitlevering automatisch gelijk wordt gezet aan `aantal` (`BestellingenPage.tsx:515`) was het verschil voor nieuwe data altijd 0 — de teller kwam structureel te laag uit en de THT-alerts pakten alleen oude (niet-WC-gemigreerde) records.

De berekening gebruikt nu dezelfde bron als de AGP-, Bestellingen- en Producten-pagina's: `voorraadPerLocatie(afv, locaties, uit, verplaatsingen, afboekingen)` per afvulling, gesommeerd over alle locaties. De THT-waarschuwingen zijn eveneens omgezet naar afvullingen (de bron van waarheid voor THT en resterende voorraad), zodat alleen bier dat fysiek nog op voorraad staat een waarschuwing genereert.

### Files
- `src/pages/DashboardPage.tsx` — `voorraadPerLocatie` import toegevoegd; `beschVoorraad`, `uitMetTht`, `uitVerlopen` en `uitBinnen30` afgeleid van afvullingen i.p.v. uitleveringen; `VoorraadRow` accepteert nu `{afv, beschik}` met de werkelijk resterende voorraad.
- `config.yaml` — versie bump 1.9.46 → 1.9.47.

---

## [1.9.46] — 2026-05-09

### Fixed/Added — AGP-Mutaties: alle verplaatsingen zichtbaar + verwijderbaar

De Mutaties-tabel op de AGP-pagina toonde alleen de 20 meest recente verplaatsingen (`recenteMutaties.slice(0, 20)`). Bij meer dan 20 verplaatsingen verdween een ouder record uit het zicht — terwijl `voorraadPerLocatie` het record nog wél meetelt. Effect: een afvulling kon "buiten AGP" staan zonder dat er een zichtbare mutatie voor te vinden was.

De slice is verwijderd: alle verplaatsingen zijn nu zichtbaar, gesorteerd op datum (nieuwste eerst), met een zoekveld erboven dat filtert op batchnaam, batchnummer, verpakking, locatie en datum. De badge-info naast de header toont voortaan het werkelijke aantal records (niet de gefilterde count).

Tegelijkertijd is een verwijder-knop per regel toegevoegd, zodat een foutieve verplaatsing direct kan worden teruggedraaid:

- Voert een bevestigingsdialoog uit met een duidelijke beschrijving (aantal, van, naar) en — indien van toepassing — het accijnsbedrag dat wordt teruggedraaid.
- Verwijdert het verplaatsings-record uit `verplaatsingen`.
- Verwijdert het gekoppelde accijnsrecord (`accijns_record_id`) als de verplaatsing AGP→buiten was. Hierdoor keert de voorraad terug onder schorsing op AGP.
- Blokkeert verwijdering als het gekoppelde accijnsrecord al `betaald: true` is — in dat geval moet eerst de betaling worden ontkoppeld.
- Logt de actie in de audit-log.

### Files
- `src/pages/AgpPage.tsx` — `.slice(0, 20)` verwijderd; `mutZoek`-state + `SearchInput`; nieuwe `deleteVerplaats`-handler met betaald-blokkade en automatische accijns-teruggave; extra kolom met verwijder-knop in de Mutaties-tabel.
- `src/i18n/{nl,en,de,fr,es}.json` — 5 nieuwe sleutels: `agp_zoek_mutaties`, `agp_zoek_geen_resultaten`, `agp_verplaats_delete_confirm`, `agp_verplaats_delete_confirm_acc`, `agp_err_verplaats_acc_betaald`.
- `config.yaml` — versie bump 1.9.45 → 1.9.46.

---

## [1.9.45] — 2026-05-09

### Fixed — Datum-stempels rond middernacht en AGP-gemiddelden in CET/CEST

In de hele app werd "vandaag" en het einde van een datum-iteratie afgeleid uit
`new Date().toISOString().slice(0,10)`. Die geeft de **UTC-dag** terug, niet de
lokale kalenderdag. Voor een brouwerij in Nederland/België (CET = UTC+1, CEST =
UTC+2) leverde dat twee concrete fouten op:

1. **Records gestempeld met de verkeerde datum.** Tussen lokaal middernacht en
   01:00 (winter) of 02:00 (zomer) staat de UTC-klok nog op de vorige dag. Een
   afboeking, gistingsmeting, herinnering, factuur-betaaldatum, etc. die op
   16 januari 00:30 lokaal werd ingevoerd, kreeg `datum: "2024-01-15"` in plaats
   van `2024-01-16`. Dit verstoorde latere periode-filters (BTW-aangifte, accijns,
   statiegeld, omzet per kwartaal).
2. **`gemAgpInPeriode` itereerde over de verkeerde dagen.** De helper bouwde
   `cur` op met lokale dag-componenten en haalde er vervolgens `toISOString()`
   uit — een dubbele conversie die in CET één dag terug schuift. Een gemiddelde
   over "1–31 januari" werd dus berekend over "31 december – 30 januari". Dat
   raakte de Vorige maand / Dit jaar / Vorig jaar AGP-gemiddelden op de AGP-pagina.

Daarnaast was `firstOfYear` op de Boekhoudingspagina via dezelfde dubbele
conversie verkeerd: `new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10)`
gaf in CET "31 december van vorig jaar" terug, waardoor het standaard
datumbereik van de boekhoudingsfilter een dag te vroeg begon.

### Aanpak

Centraal in `src/utils/format.ts` is een nieuwe helper `ymd(d)` toegevoegd die
een Date naar `YYYY-MM-DD` formatteert volgens de **lokale** tijdzone via
`getFullYear()`/`getMonth()`/`getDate()`, zonder UTC-tussenstap. `tod()`
gebruikt deze helper en is nu lokaal-correct. De UTC-patronen in `App.tsx`,
de boekhouding-, dashboard-, statiegeld-, voorraadverloop-, producten- en
instellingenpagina's zijn vervangen door `tod()` / `ymd(d)`. De backupfile-naam
in `excel.ts` is bewust UTC gelaten (filename-consistentie tussen tijdzones).

### Files
- `src/utils/format.ts` — `ymd(d)` helper toegevoegd; `tod()` gebruikt nu lokale dag-componenten.
- `src/utils/calculations.ts` — `gemAgpInPeriode` gebruikt `ymd(cur)` i.p.v. `cur.toISOString().slice(0,10)`; import van `ymd` toegevoegd.
- `src/pages/BoekhoudingPage.tsx` — `firstOfYear`, `dateTo`, `rapportVan`, `rapportTot`, `factuurDatum` en alle `vandaag`/`today`/`betaald_datum` stempels via `tod()`/`ymd()`; import uitgebreid.
- `src/pages/DashboardPage.tsx` — `gist_meting.datum` en `haccp_log.datum` via `tod()`; import uitgebreid.
- `src/pages/StatiegeldPage.tsx` — periodestatus-vergelijking en factuurdatum via `tod()`; import uitgebreid.
- `src/pages/VoorraadverloopPage.tsx` — `today`-filter via `tod()`; import toegevoegd.
- `src/pages/ProductenPage.tsx` — alle afboeking- en log-datumstempels (3×) via `tod()`.
- `src/pages/InstellingenPage.tsx` — voorbeeld-factuurdatum via `tod()`; import uitgebreid.
- `src/App.tsx` — uitlevering-migratie datum-fallback via `tod()`.
- `config.yaml` — versie bump 1.9.44 → 1.9.45.

---

## [1.9.44] — 2026-05-09

### Fixed — Ontbrekende vertalingen en hardcoded UI-strings opgeschoond

Een controle van de hele app legde vier ontbrekende i18n-sleutels en een reeks
hardcoded Nederlandse strings bloot die de meertalige UI doorbraken. Drie
sleutels (`excise_release_date`, `lbl_betaald`, `err_cannot_delete_has_releases`)
waren in **geen enkele** taal gedefinieerd, waardoor accijns-tabelheaders, de
Boekhouding-klantentabel en een verwijdermelding op afvullingen de ruwe sleutel
toonden in plaats van een label. Daarnaast bestond `order_mark_shipped` alleen
in NL en viel terug op Nederlands voor EN/DE/FR/ES.

Tegelijk zaten er nog negen hardcoded gebruikersgerichte strings in de code (4
`alert(...)`-meldingen, 1 `throw new Error`, 3 `title`-tooltips en 1
`placeholder`), die in strijd zijn met de i18n-regel uit `CLAUDE.md` ("NOOIT
hardcoded gebruikersgerichte tekst"). Alle nieuwe sleutels zijn toegevoegd in
nl/en/de/fr/es; alle 5 taalbestanden hebben nu exact 1.812 sleutels.

### Files
- `src/i18n/{nl,en,de,fr,es}.json` — 10 nieuwe sleutels toegevoegd in alle 5 talen, plus `order_mark_shipped` aangevuld in EN/DE/FR/ES.
- `src/pages/BatchesPage.tsx` — `err_cannot_delete_has_releases` → `err_cannot_delete_filling` (bestaande sleutel hergebruikt).
- `src/pages/AccijnsPage.tsx` — alert vervangen door `t('excise_reviewer_required')`.
- `src/pages/BestellingenPage.tsx` — alert + tooltip via `t('err_no_invoice_for_order')` resp. `t('tooltip_logistical_status')`.
- `src/pages/IngredientenPage.tsx` — alert via `t('err_cannot_delete_active_lots')`; placeholder `"— kies type —"` → `t('packaging_choose_type')`.
- `src/pages/ProductenPage.tsx` — tooltip via `t('tooltip_status_per_douane')`.
- `src/pages/BoekhoudingPage.tsx` — tooltip via `t('tooltip_expired_invoices')`.
- `src/components/InkoopFactuurModal.tsx` — `throw new Error(...)` via `t('err_no_json_in_claude_response')`.
- `src/utils/excel.ts` — `t`-import toegevoegd; export-fout via `t('err_export_failed')` met `{msg}`-substitutie.
- `config.yaml` — versie bump 1.9.43 → 1.9.44.

---

## [1.9.43] — 2026-05-09

### Fixed — Phantom voorraad per locatie bij inconsistente verplaatsingen

Op de Productenpagina kon de voorraad-per-locatie groter zijn dan het aantal afgevulde stuks. Voorbeeld uit het veld: 1× Poly Fust 20 afgevuld, "Beschikbaar: 1×", maar de locatie-badge toonde "Bijkeuken: 2×". Oorzaak zat in `voorraadPerLocatie` (`src/utils/calculations.ts`): elke verplaatsing/uitlevering/afboeking werd ongecapt op de bestemming opgeteld, waarna de bron-locatie met een eventuele negatieve waarde naar 0 werd geclampt. Een verplaatsing van 2× terwijl er maar 1× op de bron stond (bv. door een data-inconsistentie of een afvulling die later naar beneden is bijgesteld), resulteerde dan in 0 op AGP + 2 op Bijkeuken — phantom voorraad.

Elke beweging wordt nu gecapt op werkelijk beschikbare bron-voorraad: een verplaatsing kan nooit meer verzetten dan er op dat moment op de bron staat. De som over alle locaties is daarmee altijd ≤ `afgevuld − uitgeleverd − afgeboekt`, en de badge ‘Bijkeuken: 2×’ verandert in het werkelijke aantal (1× in dit geval). De `voorraadPerLocatieRaw`-variant blijft ongewijzigd, zodat de S-5-signalering voor negatieve voorraad ruwe waarden blijft tonen voor diagnostiek.

### Files
- `src/utils/calculations.ts` — `voorraadPerLocatie`: verplaatsingen, uitleveringen en afboekingen worden gecapt op `Math.min(aantal, max(0, result[bron]))`. `voorraadPerLocatieRaw` blijft gelijk.
- `config.yaml` — versie bump 1.9.42 → 1.9.43.

---

## [1.9.42] — 2026-05-09

### Added — Toon ABV waarmee de accijns is berekend in batch-kostprijs

In het kostprijsoverzicht van een batch staat nu achter elke accijnsregel het ABV-percentage waarmee de accijns is gerekend (bv. *"Accijns · 5,5% ABV (voorcalc.)"*). Bron:

- Voor werkelijke accijns: `abv` op het accijnsrecord (door de uitleverflow gezet).
- Voor voorcalc-fallback: `voorcalc_tarief_snapshot.abv` op de afvulling, bevroren bij afvullen.

Zo kan de brouwer in één oogopslag controleren of de berekening klopt — bijvoorbeeld of de gebruikte ABV daadwerkelijk de gemeten ABV is en niet de receptschatting (zie ook de waarschuwing toegevoegd in 1.9.41).

Het ABV wordt zowel per verpakkingstype als in de eindregel "Totaal accijns" getoond. Als er meerdere verschillende ABV-waarden in de bron zitten (zou eigenlijk niet voorkomen binnen één batch) wordt het ABV-suffix bewust weggelaten om misleiding te voorkomen.

### Files
- `src/pages/BatchesPage.tsx` — `typeData`-loop bepaalt `abvUsed` uit `accRows[].abv` (werkelijk) of `rows[].voorcalc_tarief_snapshot.abv` (voorcalc); `somAbvUsed` voor het eindtotaal werkt alleen als alle types dezelfde ABV gebruiken. Toegevoegd aan zowel de per-type accijnsregel als de totaal-regel.
- `config.yaml` — versie bump 1.9.41 → 1.9.42.

---

## [1.9.41] — 2026-05-09

### Added — Waarschuwing bij afvullen als batch-ABV nog de receptschatting kan zijn

De voorcalculatie-accijns wordt op het moment van afvullen bevroren op de afvulling. Die berekening leest `batch.ABV` direct — er wordt niet zelf uit OG/FG herrekend en de schatting uit het recept (`b.measuredAbv || b.estimatedAbv` bij Brewfather-import) wordt niet onderscheiden van een echte meting. Als de brouwer vergeet de gemeten ABV in te vullen, wordt het voorcalc-bedrag dus berekend met de receptschatting en blijft dat bedrag onherroepelijk op de afvulling staan.

`doAfvullen` controleert nu vóór afvullen:

1. **`batch.ABV` ontbreekt of is 0** — confirm-dialoog: "Geen ABV ingevuld op deze batch. De voorcalculatie van de accijns valt terug op het basistarief (€/hL zonder ABV-component) en wordt zo vastgelegd op de afvulling. Wil je toch afvullen?"
2. **`batch.ABV` is wél gezet, maar er is géén FG ingevuld én géén `gist_metingen`-record met `sg`-waarde** — confirm-dialoog: "Er is geen FG-meting of eind-SG ingevuld op deze batch. De ABV ({abv}%) op de batch komt vermoedelijk nog uit het recept (schatting), niet uit een werkelijke meting. Dit beïnvloedt de voorcalculatie-accijns die op de afvulling wordt bevroren. Wil je toch afvullen?"

Beide dialogen zijn niet-blokkerend: de brouwer kan bewust doorgaan (bv. als er andere bewijsstukken zijn).

### Files
- `src/pages/BatchesPage.tsx` — `doAfvullen` toetst `selB.ABV` en de aanwezigheid van een FG / SG-meting (via `gistMetingen`) vóór de voorcalc-snapshot wordt vastgelegd; toont confirms met de bestaande i18n-helpers.
- `src/i18n/{nl,en,de,fr,es}.json` — 2 nieuwe sleutels: `warn_afvullen_no_abv`, `warn_afvullen_abv_estimate`.
- `config.yaml` — versie bump 1.9.40 → 1.9.41.

---

## [1.9.40] — 2026-05-09

### Fixed/Changed — Accijns op €0 in batch-kostprijs + duidelijke "excl. BTW"-vermelding

Twee problemen in het kostprijsoverzicht van een batch:

1. **Accijns stond op €0 zolang er nog niets was uitgeleverd.** De berekening telde alleen daadwerkelijk geboekte accijnsregels op (uit uitslagen/orders). Een net afgevulde batch heeft die nog niet, dus de regel bleef leeg — terwijl op elke afvulling al een voorcalculatie-snapshot (`voorcalc_accijns_totaal`) staat. De kostprijs valt nu terug op die voorcalc als er nog geen werkelijke accijns is geboekt; de regel krijgt het label `(voorcalc.)` zodat zichtbaar is dat het om de potentiële accijnsschuld onder schorsing gaat. Zodra de batch wordt uitgeleverd en de werkelijke accijns geboekt is, schakelt het overzicht automatisch over op de werkelijke bedragen.

2. **Niet duidelijk dat alle bedragen excl. BTW zijn.** Het info-label rechtsboven was klein en makkelijk te missen. Direct onder de header staat nu een opvallende amber hint-strook: "**EXCL. BTW** — Alle bedragen zijn exclusief BTW. BTW op grondstoffen, verpakking en overhead is aftrekbaar als voorbelasting."

### Files
- `src/pages/BatchesPage.tsx` — `typeData`-loop berekent nu `totAccActueel` (uit `batchAcc`) en `totAccVoorcalc` (uit `rows.voorcalc_accijns_totaal`); `totAcc` neemt de actuele waarde, anders de voorcalc, met flag `accIsVoorcalc`. `somAcc` somt nu `typeData.totAcc` op (zodat fallback ook in het eindtotaal meeloopt). UI: amber hint-strook "excl. BTW" onder de SectionHeader, en `(voorcalc.)`-label achter de accijnsregels wanneer fallback actief is.
- `src/i18n/{nl,en,de,fr,es}.json` — 2 nieuwe sleutels: `lbl_voorcalc`, `batch_costs_excl_vat_hint`.
- `config.yaml` — versie bump 1.9.39 → 1.9.40.

---

## [1.9.39] — 2026-05-09

### Fixed — Verpakkingskosten in batch-kostprijsoverzicht (onderdelen-verpakkingen)

In het kostprijsoverzicht van een batch (status Verpakt/Gesloten) werd "Verpakkingskosten" altijd op 0 / "Niet opgegeven" gezet wanneer de verpakking is opgebouwd uit onderdelen (bv. krat = 1× kratbodem + 24× kroonkurk + 24× etiket). De berekening keek alleen naar de oude directe velden `kosten_verpakking`/`kosten_afsluiting`/`kosten_label` en negeerde de samengestelde onderdelen. Het overzicht in `IngredientenPage` deed dit al wel correct via `vpKosten`, dus de bedragen klopten daar — alleen de batch-kostprijs niet.

Vanaf nu sommeert de batch-kostprijs voor onderdelen-verpakkingen `onderdeel.kosten_per_stuk × onderdeel.aantal`, en valt pas terug op de legacy velden als de verpakking geen onderdelen heeft. Het totaal verschijnt zowel per verpakkings­type als in de eindregel "Totaal verpakkingskosten".

### Files
- `src/pages/BatchesPage.tsx` — `kPerStuk` in het kostprijsoverzicht berekent nu eerst via `vp.onderdelen` (met lookup in `onderdelen` voor `kosten_per_stuk`); fallback op `kosten_verpakking + kosten_afsluiting + kosten_label`. Spiegelt de logica van `vpKosten` in `IngredientenPage.tsx`.
- `config.yaml` — versie bump 1.9.38 → 1.9.39.

---

## [1.9.38] — 2026-05-09

### Added — Intracommunautaire BTW-compliance op inkoopfacturen (rubriek 4a/4b)

Wanneer je inkoopt bij een Belgische (of andere EU-)leverancier rekent die geen BTW (BTW-verlegd binnen de EU). De afnemer moet die BTW echter zelf berekenen en aangeven in **rubriek 4b** (verschuldigd) én tegelijk aftrekken in **rubriek 5b** (voorbelasting). Per saldo €0, maar wettelijk verplicht te rapporteren. Voor invoer van buiten de EU geldt hetzelfde via **rubriek 4a**.

De inkoopfactuur-modal heeft nu een **"BTW-soort van factuur"**-keuze:

- **Binnenlands (NL)** — leverancier rekent BTW (huidige gedrag, default)
- **Intracommunautaire verwerving (EU)** — BTW verlegd, automatisch in rubriek 4b/5b
- **Invoer van buiten EU** — BTW verlegd, automatisch in rubriek 4a/5b

Bij verlegde facturen factureert de leverancier €0 BTW. De app slaat het regel-tarief (21%/9%) wel op — dat is de rate die de afnemer over de netto-grondslag zelf berekent voor de aangifte. In het BTW-aangiftepaneel zijn twee nieuwe kaarten toegevoegd (rubriek 4a en 4b) en de rubriek 5b-totaal telt de zelfberekende verlegde BTW automatisch op bij de binnenlandse voorbelasting.

### Files
- `src/types/index.ts` — `FactuurRegel.btw_soort?: 'binnenlands' | 'intracom_eu' | 'import_niet_eu'` + `btw_bedrag?` toegevoegd. Backwards compatible: regels zonder `btw_soort` worden behandeld als `binnenlands`.
- `src/components/InkoopFactuurModal.tsx` — `btwSoort`-state + dropdown bovenin het factuurpaneel; pre-select op basis van bestaande regels bij bewerken; verlegd-hintbox; `totaalBtw`/`btwTarieven`-totals worden 0 bij verlegde facturen; `btw_soort` propageert via `factuurForm` naar de save-handlers.
- `src/pages/BoekhoudingPage.tsx` — `saveVrijeFactuur`, `updateFactuur` en `saveBoekingFactuur` zetten `btw_soort` op elke regel en `btw_bedrag = 0` bij verlegd. Nieuwe memo `verlegdAangifte` aggregeert netto+verschuldigde BTW per soort over de geselecteerde periode/jaar. `btwPerTariefAangifte` filtert nu alleen binnenlandse regels (verlegde regels gaan naar 4a/4b). Twee nieuwe rubriekkaarten (4a + 4b) in het BTW-hulppaneel; rubriek 5b-totaal includeert nu zowel binnenlandse voorbelasting als verlegde BTW uit 4a+4b.
- `src/pages/IngredientenPage.tsx` — `saveOntvangst` propageert `btw_soort` naar elke regel en zet `btw_bedrag = 0` bij verlegde facturen.
- `src/i18n/{nl,en,de,fr,es}.json` — 11 nieuwe sleutels: `lbl_rubriek_4a`/`_hint`, `lbl_rubriek_4b`/`_hint`, `lbl_btw_soort`, `lbl_btw_soort_binnenlands`/`_intracom_eu`/`_import_niet_eu`, `hint_btw_verlegd_intracom`/`_import`.
- `config.yaml` — versie bump 1.9.37 → 1.9.38.

---

## [1.9.37] — 2026-05-06

### Changed — Carbonisatie-richtlijn op basis van BKG Biertypen v2.4 (2021)

De CO₂-richtlijntabel is volledig hergeijkt op de officiële Nederlandse stijlgids van het Bierkeurmeestersgilde (`BKG Biertypen v2.4 — juli 2021`, 69 typen). Voor elke stijl wordt nu het door BKG opgegeven koolzuurgehalte in **g/L** omgerekend naar vols via de bestaande constante `CO2_G_PER_L_PER_VOL` (1 vol ≈ 1.9632 g/L). Dat geeft o.a.:

- Berliner Weisse: 5,0–6,5 g/L → 2,5–3,3 vols
- Tripel: 5,5–7,0 g/L → 2,8–3,6 vols
- Russian Imperial Stout: 3,2–4,5 g/L → 1,6–2,3 vols
- Saison: 6,5–8,0 g/L → 3,3–4,1 vols
- Brut (Méthode Champenoise): 8,0–10,0 g/L → 4,1–5,1 vols

De stijl-keuze in de carbonisatie-sectie toont nu **alle 69 BKG-stijlen** verdeeld over de vier BKG-klassen (A-licht-licht, B-donker-licht, C-licht-zwaar, D-donker-zwaar) met de exacte stijlnamen uit de gids ("Pils(ener)", "Bo(c)kbier", "Sterke Vlaamse Bruine", "Bière de Garde (Ambreé)", enz.). De auto-detectie op `selB.stijl` werkt onveranderd via case-insensitive `includes`-match; sleutels zijn nu gesorteerd op aflopende lengte zodat specifieke namen ("russian imperial stout") altijd vóór generieke ("stout") matchen.

Voor freeform stijlen die niet exact in BKG voorkomen (bv. "IPA", "Stout", "Pale Ale") is een korte aliassen-tabel toegevoegd die naar het meest passende BKG-bereik wijst.

### Files
- `src/utils/calculations.ts` — `BkgKlasse`-type, `BkgStyle`-interface en `BKG_BEER_STYLES`-array (69 entries, 4 klassen, met g/L-bron) toegevoegd. `CARB_RANGES` en `CARB_STYLE_OPTIONS` afgeleid uit deze bron via `_gToVols`-helper. Korte aliassen via `BKG_ALIASES`.
- `src/pages/BatchesPage.tsx` — picker rendert nu de BKG-naam direct (`opt.label`) i.p.v. via i18n; `displayStijl` gebruikt de BKG-label-tekst in de hint zodat overrides als "Tripel" of "Russian Imperial Stout" leesbaar blijven.
- `src/i18n/{nl,en,de,fr,es}.json` — 9 oude `carb_style_grp_*`-sleutels plus ~50 obsolete `carb_style_opt_*`-sleutels verwijderd; vervangen door 4 nieuwe `carb_style_grp_klasse_a/b/c/d`-sleutels met BKG-klassebeschrijving (kleur + OG-grens). Hint-strings vermelden `(BKG)` als bron bij gekozen preset.
- `config.yaml` — versie bump 1.9.36 → 1.9.37.

---

## [1.9.36] — 2026-05-06

### Changed — Carbonisatie-stijltabel uitgebreid van 17 naar ±70 stijlen

De CO₂-richtlijntabel matcht nu een veel bredere set BJCP-2021-stijlen, waaronder Belgian Blonde Ale, Belgian Strong Ale, Belgian Strong Dark Ale, Belgian Pale Ale, Bière de Garde, Helles, Dunkel, Doppelbock, Maibock, Eisbock, Schwarzbier, Märzen/Oktoberfest, Vienna Lager, Kölsch, Altbier, Rauchbier, NEIPA/Hazy IPA, Double/Imperial IPA, Black IPA, Session IPA, Belgian IPA, Amber/Red/Brown/Cream/Blonde Ale, Imperial Stout, Milk Stout, Oatmeal Stout, Bitter/ESB, Mild, Scotch Ale/Wee Heavy, Barleywine, Old Ale, Berliner Weisse, Gose, Lambic, Gueuze, Kriek, Wild Ale, Weizenbock en American Wheat. Generieke matches (`pils`, `lager`, `ipa`, `stout`, `bock`, `blonde`, `wheat`, …) staan nu **na** de specifieke varianten, zodat bv. "Imperial Russian Stout" eerst op `imperial stout` matcht voordat het naar `stout` zou vallen.

De handmatige stijl-kiezer onder het CO₂-veld toont de presets nu in 9 categorie-`<optgroup>`'s (Lager & Pils, Pale Ale & IPA, Amber/Red/Brown, Stout & Porter, English & Scottish, Belgian, Wheat & Witbier, Sour & Wild, Other) zodat de ±50 opties scanbaar blijven.

### Files
- `src/utils/calculations.ts` — `CARB_RANGES` herordend en uitgebreid (specifiek→generiek); `CARB_STYLE_OPTIONS` heeft nu een `groupKey`-veld per preset.
- `src/pages/BatchesPage.tsx` — de picker rendert `<optgroup>`'s op basis van de `groupKey`-volgorde uit `CARB_STYLE_OPTIONS`.
- `src/i18n/{nl,en,de,fr,es}.json` — 9 groep-sleutels (`carb_style_grp_*`) en ~40 nieuwe optie-sleutels (`carb_style_opt_*`) toegevoegd; bestaande sleutels (pils, lager, ipa, …) behouden.
- `config.yaml` — versie bump 1.9.35 → 1.9.36.

---

## [1.9.35] — 2026-05-06

### Added — Stijl-keuze voor CO₂-richtlijn als batch-stijl niet matcht

Wanneer de batch geen stijl heeft of de stijl niet voorkomt in de tabel met gangbare CO₂-bereiken, verschijnt onder de hint nu een dropdown waarmee de gebruiker handmatig een stijl-preset kan kiezen (Pils, Tripel, Stout, Witbier, …). Direct na keuze toont de hint de richtwaarde voor die stijl en wordt de placeholder van het "Doel CO₂"-veld bijgewerkt naar het midden van het bereik. De out-of-range ⚠-detectie werkt op de gekozen range. De override is lokaal voor de huidige batch en wordt automatisch gewist bij het wisselen van batch — `selB.stijl` wordt niet aangepast.

### Files
- `src/utils/calculations.ts` — `CARB_STYLE_OPTIONS` array (15 unieke presets) toegevoegd, met `value`-keys die matchen op `CARB_RANGES` en i18n `labelKey`-verwijzingen.
- `src/pages/BatchesPage.tsx` — `carbStyleOverride` state (lokaal, reset op batch-wissel via `useEffect([sel])`); `effectiveStijl` afgeleid en gebruikt voor `defaultCarbVols` + `carbRangeForStyle`; dropdown rendert alleen wanneer `selB.stijl` niet auto-matcht.
- `src/i18n/{nl,en,de,fr,es}.json` — 18 nieuwe sleutels: `carb_style_range_picked`, `carb_style_pick_placeholder`, `carb_style_pick_tooltip` + 15 `carb_style_opt_*`-labels.
- `config.yaml` — versie bump 1.9.34 → 1.9.35.

---

## [1.9.34] — 2026-05-06

### Added — Carbonisatie toont gangbaar CO₂-bereik per bierstijl

De carbonisatie-sectie op de batchpagina toont onder het "Doel CO₂ (vols)"-veld een hint met het gangbare CO₂-bereik voor de stijl van de batch. Zodra de gebruiker een waarde buiten dat bereik invult, kleurt de hint oranje met een ⚠-indicator. Wanneer de batch geen stijl heeft of de stijl niet matcht in de tabel, valt de hint terug op een algemeen ale/lager-bereik (2.3–2.7 vols) in lichtgrijs. Bron: BJCP-stijlgidsen + brouwersconsensus (Palmer "How To Brew").

De bestaande default-vols-placeholder werkt door op de nieuwe range: het midden van de range wordt als suggestie ingevuld, zodat de hint en de placeholder altijd consistent zijn.

### Files
- `src/utils/calculations.ts` — `CARB_RANGES` map (17 stijlen) + `carbRangeForStyle(stijl)` helper toegevoegd; `defaultCarbVols` derived uit het midden van de range zodat één bron-of-truth blijft.
- `src/pages/BatchesPage.tsx` — `carbRangeForStyle` import; hint-regel onder `carb_target_vols` met out-of-range-detectie (oranje ⚠ als de ingevulde waarde buiten min/max valt).
- `src/i18n/{nl,en,de,fr,es}.json` — twee nieuwe sleutels: `carb_style_range` (`Gangbaar voor {stijl}: {min}–{max} vols`) en `carb_style_range_unknown` (fallback-tekst zonder stijl).
- `config.yaml` — versie bump 1.9.33 → 1.9.34.

---

## [1.9.33] — 2026-05-05

### Added — Hop-lot-overzicht toont nu alfazuur en oogstjaar per lot

- `src/pages/IngredientenPage.tsx` — De lot-tabel onder een hop-ingredient krijgt twee extra kolommen: **Alfazuur** (%) en **Oogstjaar**. Beide gebruiken `getEffectiveBrewProp(lot, selIng, key)` zodat de waarde valt onder dezelfde fallback-regel — eerst lot.bf_props, anders Ingredient.bf_props (Brewfather-bron). Ontbrekende waardes tonen `—`. Voor andere ingredient-typen blijft de tabel ongewijzigd (4 kolommen). Werkt zowel voor actieve als gearchiveerde lots; lege-state colSpan is dynamisch.
- Geen aanpassingen aan i18n nodig — bestaande sleutels `bf_alpha` en `bf_year` worden hergebruikt.
- Branch gemerged met `origin/main` (PR #132 douane-terminologie en PR #133 recept-voorraadcheck-aggregatie inbegrepen).
- `config.yaml` — versie bump 1.9.32 → 1.9.33.

---

## [1.9.32] — 2026-05-05

### Fixed — Recept-voorraadcheck somt nu regels met hetzelfde ingrediënt op

Wanneer een recept hetzelfde ingrediënt op meerdere regels gebruikt (bijv. dezelfde mout in twee giften, of dezelfde hop op verschillende kookmomenten), werd elke regel afzonderlijk tegen de totale voorraad vergeleken. Daardoor kon je per regel groen krijgen terwijl het opgetelde recept-totaal de voorraad overschreed.

`checkStock` in `src/pages/ReceptenPage.tsx` aggregeert nu alle regels binnen het geselecteerde recept die naar hetzelfde ingrediënt verwijzen (op `ingredient_id`, met fallback naar naam-match) en vergelijkt die som met de actieve lots. De per-regel-status (groen/geel/rood), de sectie-badge, de overall-status én de status-stip in de receptenlijst gebruiken vanaf nu deze geaggregeerde behoefte.

In de "Benodigd"-kolom verschijnt een klein grijs label `(totaal: X eenheid)` op regels die een ingrediënt delen, met een tooltip die het receptaire totaal voluit toont.

### Files
- `src/pages/ReceptenPage.tsx` — `findIngMatch` helper toegevoegd; `checkStock(item, recept?)` somt nu binnen het recept; `IngRow`/`IngSection`/`cardStocks` geven het recept mee.
- `src/i18n/{nl,en,de,fr,es}.json` — twee nieuwe sleutels: `recipe_total_short`, `recipe_total_in_recipe`.
- `config.yaml` — versie bump 1.9.31 → 1.9.32.

---

## [1.9.31] — 2026-05-05

### Changed — Douane-terminologie "Latente schuld" → "Pot. accijnsschuld" (§7.4)

Voorraadverloop — kolomlabel hernoemd zodat de app dezelfde terminologie hanteert als bedrijfshandboek v2.4 §7.4 en consistent is met de reeds gebruikte i18n-sleutel `lbl_pot_accijnsschuld`:

- UI-tabel: "Latente schuld" → "Pot. accijnsschuld"
- Excel-export (sheet "Gereed product"): "Potentiële accijnsschuld (€)" via nieuwe i18n-sleutel `gpa_accijns_latent_eind_excel`
- Group-tooltip (Accijns-kolomgroep) bijgewerkt naar "Potentiële accijnsschuld" in alle 5 talen

Onderliggende dataveldnamen (`accijnsLatentEind`) en sleutelnaam `gpa_accijns_latent_eind` blijven ongewijzigd — alleen de gebruikersgerichte labels verschuiven.

### Files
- `src/pages/VoorraadverloopPage.tsx`
- `src/i18n/{nl,en,de,fr,es}.json` (3 sleutels per bestand)
- `config.yaml` — versie bump 1.9.30 → 1.9.31.

---

## [1.9.30] — 2026-05-05

### Added — Oogstjaar (`year`) als optioneel veld op hop-lots

- `src/utils/constants.ts` — `LOT_BREW_FIELDS_PER_TYPE.Hop` heeft nu een extra veld `year` (Brewfather-key, integer 4-cijferig). Belangrijk omdat alpha-zuren gemiddeld zo'n 5–15% per jaar afnemen — combineer met HSI om de effectieve alpha te schatten op moment van brouwen.
- `src/i18n/{nl,en,de,fr,es}.json` — Nieuwe sleutel `bf_year` (NL "Oogstjaar", EN "Crop year", DE "Erntejahr", FR "Année de récolte", ES "Año de cosecha"). Bestaande `bf_*`-fallback-resolver pakt automatisch `Ingredient.bf_props.year` uit Brewfather-sync.
- Geen unit in `BREW_PROP_UNITS` (een jaartal heeft geen suffix), geen verdere code-aanpassingen nodig — het curated formulier en de fallback-hint werken automatisch via dezelfde generieke render-logica.
- `config.yaml` — versie bump 1.9.29 → 1.9.30.

---

## [1.9.29] — 2026-05-05

### Fixed — Klikbare BF-fallback geeft nu exact dezelfde waarde als de hint toont

- `src/pages/IngredientenPage.tsx` + `src/components/InkoopFactuurModal.tsx` — Bij het klikken op de Brewfather-fallback-link wordt nu de **geformatteerde** waarde in het invoerveld gezet via `formatBrewValue`, in plaats van de rauwe `Number(ingFallback)`. Voorheen kon de hint bijvoorbeeld "82.5" tonen (door `formatBrewValue`-afronding van een float-artefact als `82.4999999999999...`) terwijl bij klikken de rauwe `82.4999999999999...` in het veld belandde — wat de gebruiker zag als "afronding gaat fout". Nu zijn hint-tekst en click-resultaat altijd identiek, en wordt de geformatteerde tekst voor number-velden weer naar `Number()` geparsed zodat bf_props een echt getal blijft.
- `config.yaml` — versie bump 1.9.28 → 1.9.29.

---

## [1.9.28] — 2026-05-05

### Fixed — Brewfather-waardes werden onterecht naar 2 decimalen afgerond

- `src/utils/brewProps.ts` — Nieuwe helper `formatBrewValue` die getallen naar maximaal 6 decimalen formatteert via `toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false })`. Behoudt de oorspronkelijke precisie en strijkt float-artefacten als `1.0370000000000001` glad zonder echte waardes te verminken.
- `src/pages/IngredientenPage.tsx` — Brewfather-info-paneel én effectieve-waardes-paneel én fallback-hint gebruiken nu `formatBrewValue`. Voorheen werd `v.toFixed(2).replace(/\.?0+$/, '')` gebruikt, wat o.a. `1.037` (SG potential) als `1.04` toonde en heel kleine waardes (`0.005`) als lege string. Nu klopt de weergave: `1.037` blijft `1.037`, `78.5` blijft `78.5`, `100` blijft `100`.
- `src/components/InkoopFactuurModal.tsx` — Idem voor de fallback-hint onder elk veld in het Inkoopfactuur-modal: de getoonde Brewfather-waarde gebruikt nu `formatBrewValue` zodat klikken niet leidt tot een onverwachte waarde in het invoerveld.
- `config.yaml` — versie bump 1.9.27 → 1.9.28.

---

## [1.9.27] — 2026-05-05

### Changed — Brouw-props: `potentialPercentage` als BF-key voor extractrendement, SG-veld weg, GN-code uit lot-edit

- `src/utils/constants.ts` — Voor mout en suiker is `LOT_BREW_FIELDS_PER_TYPE` aangepast naar key **`potentialPercentage`** in plaats van `yield`. Dat is het Brewfather-veld dat het extract-potentieel als percentage van het droge gewicht weergeeft, dus nu klopt de fallback naar `Ingredient.bf_props.potentialPercentage` (en de klikbare hint vult de juiste BF-waarde). `BREW_PROP_UNITS` kreeg `potentialPercentage: '%'`.
- Het losse **Potentieel (SG)**-invoerveld is verwijderd uit het mout- en suiker-formulier (zinloos zolang het percentage al volstaat). Het `potential`-veld blijft wel zichtbaar in het algemene Brewfather-info-paneel als BF die data levert, met label "Potentieel (SG)" zodat onderscheid met het percentage duidelijk is.
- `src/i18n/{nl,en,de,fr,es}.json` — Nieuwe sleutel `bf_potentialPercentage` (NL "Extractrendement", EN "Extract yield", DE "Extraktausbeute", FR "Rendement extrait", ES "Rendimiento extracto"). `bf_yield` is nu generieker "Yield" zodat als BF beide raw-velden levert, ze ieder hun eigen label hebben in het info-paneel. `bf_potential` heeft nu de SG-toevoeging in het label.
- `src/pages/IngredientenPage.tsx` — Het GN-code-invoerveld is uit het lot-bewerk-modal gehaald. GN-code is een douane-nomenclatuur voor verpakt bier (zie batch- en afvulling-niveau), niet voor een ingredient-charge. Bestaande `lot.gn_code`-data blijft behouden via openLot/saveLot (backward-compat), enkel het input-veld is weg.
- `config.yaml` — versie bump 1.9.26 → 1.9.27.

---

## [1.9.26] — 2026-05-05

### Changed — Brouwkundige eigenschappen: potentieel-veld, klikbare BF-fallback overal, dubbele eenheden weg

- `src/utils/constants.ts` — Nieuwe flat map `BREW_PROP_UNITS` als enige bron voor BF-prop-eenheden (`alpha:%`, `color:EBC`, `minTemp:°C`, `diastaticPower:°L`, …). `LOT_BREW_FIELDS_PER_TYPE` heeft geen `unit`-veld meer; alle eenheden komen uit `BREW_PROP_UNITS`. Nieuw veld **`potential`** toegevoegd voor Mout en Suiker (Brewfather's `potential` is de extract-SG, bv. 1.037 voor pilsmout — naast `yield` (% extractrendement)).
- `src/i18n/{nl,en,de,fr,es}.json` — Eenheden uit `bf_*`-labels gestript (NL: "Kleur (EBC)" → "Kleur"; "Vergistingsgraad %" → "Vergistingsgraad"; "Min. temp. (°C)" → "Min. temp."; etc. in alle 5 talen). Hierdoor verschijnt elke eenheid nog maar één keer in de UI in plaats van zowel in het label als achter het veld. Nieuwe sleutel `bf_potential` voor het potentieel-veld.
- `src/pages/IngredientenPage.tsx` — Brewfather-info-paneel onder de lot-tabel toont nu de eenheid achter de waarde via `BREW_PROP_UNITS`. Brouwkundige eigenschappen-blok in de lot-popup is nu **inklapbaar** (default open, persistent via `lot_brew_open`). Effectieve-waardes-paneel toont eenheid achter de waarde en routeert lange waardes (>60 tekens of key `note*`) naar de "Notitie bekijken"-modal — dezelfde behandeling als het Brewfather-info-paneel.
- `src/components/InkoopFactuurModal.tsx` — Bij het toevoegen van een nieuw lot is per veld nu een klikbare *Brewfather*-fallback-link onder het invoerveld (alleen bij een gekozen bestaand ingredient). Eén klik vult de Brewfather-waarde — gelijk aan het lot-bewerk-modal. Werkt voor number, text en select. De "Neem over van vorig lot"-knop blijft bestaan voor één-klik-overname van het hele vorige lot.
- `config.yaml` — versie bump 1.9.25 → 1.9.26.

---

## [1.9.25] — 2026-05-05

### Changed — Brewfather-paneel overzichtelijker en BF-fallback klikbaar

- `src/i18n/{nl,en,de,fr,es}.json` — `bf_yield` heet nu *Extractrendement %* (NL) / *Extract yield %* / *Extraktausbeute %* / *Rendement extrait %* / *Rendimiento extracto %*. Brewfather's `yield`-veld is het extract-potentieel als percentage van het droge gewicht (correleert met PPG); de eerdere generieke "Rendement"-vertaling was verwarrend. Nieuwe sleutels `bf_notes`, `lbl_view_note`, `btn_use_bf_value` toegevoegd.
- `src/pages/IngredientenPage.tsx` — In de lot-bewerk-modal is de Brewfather-fallback-hint per veld nu een klikbare knop: één klik vult de getoonde Brewfather-waarde in het invoerveld (number/text/select). Hover toont *Gebruik Brewfather-waarde*.
- `src/pages/IngredientenPage.tsx` — Het Brewfather-paneel onder de lot-tabel is nu collapsible (standaard ingeklapt, persistent via `useStore('ing_bf_panel_open')`). Header toont aantal velden zodat je weet hoeveel BF-data verborgen zit.
- `src/pages/IngredientenPage.tsx` — Lange Brewfather-waardes (string > 60 tekens of veld-key beginnend met `note`) worden nu gerenderd als *Notitie bekijken →*-link in het paneel; klik opent een modal met de volledige tekst (`whitespace-pre-wrap`, scroll bij heel lange notities). Voorheen werd de hele notitie als platte tekst getruncated of de cel werd onevenredig breed.
- `config.yaml` — versie bump 1.9.24 → 1.9.25.

---

## [1.9.24] — 2026-05-05

### Added — Brouwkundige eigenschappen per Lot (met fallback naar Ingredient)

Een lot kan nu optioneel charge-specifieke brouwkundige waardes bevatten (alpha% bij hop, kleur/yield bij mout, attenuation/min-max-temp/flocculatie bij gist, …). Lege waardes vallen automatisch terug op `Ingredient.bf_props` (Brewfather-bron), zodat één plek volstaat als alle charges hetzelfde zijn.

- `src/types/index.ts` — `Lot.bf_props?: Record<string, any>` toegevoegd, gespiegeld aan `Ingredient.bf_props`.
- `src/utils/constants.ts` — `LOT_BREW_FIELDS_PER_TYPE` curates per ingredient-type welke velden zichtbaar zijn (Mout: kleur/yield/diastatisch/vocht; Hop: alpha/beta/cohumulone/HSI; Gist: attenuation/min-/maxTemp/flocculatie/alcoholtolerantie; Suiker: yield/kleur; Overig: concentratie/kleur). Keys zijn identiek aan `extractBfProps`-output zodat fallback een directe key-lookup is.
- `src/utils/brewProps.ts` (nieuw) — `getEffectiveBrewProp`, `getEffectiveBrewProps` (met bron `'lot'|'ingredient'`) en `stripEmptyBrewProps`.
- `src/components/InkoopFactuurModal.tsx` — collapsible sectie *Brouwkundige eigenschappen (optioneel)* in het Ontvangst-modal, dynamisch op basis van `productForm.type`. Knop *Neem over van vorig lot* hergebruikt de bestaande `lastLot`-detectie zodat één klik de waardes van de vorige charge kopieert (geen autoprefill — anders blokkeert het de fallback).
- `src/pages/IngredientenPage.tsx` — `saveOntvangst` strip lege waardes en schrijft `lot.bf_props`. Lot-bewerk-modal heeft nu een edit-sectie met fallback-hint per veld ("← Brewfather: 5,5") plus een read-only effectieve-waardes-paneel met badge `lot` of `Brewfather` per key.
- `src/pages/BoekhoudingPage.tsx` — mirror van saveOntvangst-uitbreiding zodat ook via *Boekhouding → Inkoopfactuur* de brouwwaardes op het lot terechtkomen.
- `src/i18n/{nl,en,de,fr,es}.json` — 5 nieuwe sleutels: `brew_props_section`, `btn_copy_from_last_lot`, `brew_props_fallback_hint`, `src_lot`, `src_ingredient`. Bestaande `bf_*`-keys (alpha, color, yield, attenuation, …) worden hergebruikt voor veldlabels.
- Excel-backup ondersteunt `lot.bf_props` automatisch — `excel.ts` JSON-stringifyt geneste objecten en parsed bij import terug.
- Toekomst: dezelfde resolver vormt het fundament voor automatische substitutie-suggesties bij voorraadtekort tijdens brouwen — niet onderdeel van deze release.
- `config.yaml` — versie bump 1.9.23 → 1.9.24.

---

## [1.9.23] — 2026-05-05

### Changed — Ingrediëntenlijst: fabrikant zichtbaar en strakker uitgelijnd

- `src/pages/IngredientenPage.tsx` — De linkerlijst toont nu per ingredient de fabrikant als kleine, grijze ondertitel onder de naam (alleen als die is ingevuld). De voorraadkolom is uitgelijnd met `tabular-nums` (gelijke cijferbreedte) en geformatteerd via `fmtQty` (Nederlandse notatie). De eenheid staat als kleine, grijze achtervoegsel zodat het getal zelf strak rechts uitlijnt over alle rijen heen. Cellen gebruiken `align-top` zodat namen + fabrikanten en hoeveelheden netjes naast elkaar starten. Het zoekveld doorzoekt nu ook de fabrikant.
- `config.yaml` — versie bump 1.9.22 → 1.9.23.

---

## [1.9.22] — 2026-05-05

### Changed — Fabrikant beter zichtbaar bij toevoegen en in dropdowns

- `src/components/InkoopFactuurModal.tsx` — het Fabrikant-veld in het Ontvangst-modal verschijnt nu zodra er geen bestaand ingredient gekozen is (eerder pas nadat er een nieuwe naam was getypt). Daardoor is direct duidelijk dat je bij een nieuw ingredient ook de fabrikant kan vastleggen.
- `src/pages/BatchesPage.tsx` — ingredient-dropdowns (zowel de receptkoppeling als de hoofdkeuze "ingredient toevoegen aan batch") tonen nu `Naam (Fabrikant)` waar een fabrikant ingevuld is, in lijn met het Ontvangst-modal.
- `src/pages/ReceptenPage.tsx` — receptkoppelings-dropdown toont eveneens `Naam (Fabrikant)`.
- `config.yaml` — versie bump 1.9.21 → 1.9.22.

---

## [1.9.21] — 2026-05-05

### Changed — Ingrediëntenpagina: "+ lot" vult ingredient-context vooraf in

- `src/components/InkoopFactuurModal.tsx` — nieuwe optionele prop `lots`. Wanneer het Ontvangst-modal wordt geopend met een specifiek `initialIngId` (via *+ lot* op de Ingrediëntenpagina), worden product-velden afgeleid uit het ingredient en zijn laatste lot:
  - `type` = type van het ingredient (zonder dit verscheen het ingredient niet eens in de dropdown).
  - `eenh` = meest gebruikte eenheid van eerdere lots (fallback: laatste lot).
  - `prijs` = `prijs_per_eenheid` van het laatste lot.
  - `btw_tarief` = `btw_tarief` van het laatste lot, anders mapping op type.
  - Leverancier wordt voorgeselecteerd op de laatst gebruikte leverancier voor dit ingredient (in de bekend-lijst of als nieuw).
- `src/pages/IngredientenPage.tsx` — geeft `lots` door aan `<InkoopFactuurModal>`.
- `config.yaml` — versie bump 1.9.20 → 1.9.21.

---

## [1.9.20] — 2026-05-05

### Changed — Batch-detail UI: header opgesplitst en fase-bewuste section cards

- `src/pages/BatchesPage.tsx` — *Header card* bevat nu alleen nog de status-snapshot (titel + acties + tank-picker + Vergistingsvoortgang + Volumes). De **Info collapse** en **Kosten samenvatting** zijn uit de header gehaald en zijn nu eigen uitklapbare section cards (consistent met Gistgrafiek, Verliesregistratie en Taken).
- Nieuwe per-batch open-states `batches_info_open` en `batches_kosten_open` (vervangen de oude lokale `infoIngeklapt`-state). De Kosten-card staat direct vóór het Kostprijsoverzicht zodat alle financiële info bij elkaar zit.
- Nieuwe helper `sectieOpen(map, batchId, fase, sectie)` past **fase-bewuste defaults** toe wanneer de gebruiker zelf nog geen voorkeur heeft gekozen:
  - `gist`: open bij *Vergisten*
  - `verlies`: open bij *Vergisten* en *Conditioneren*
  - `kosten`: open bij *Verpakt* en *Gesloten*
  - `info`: standaard dicht
  - User-toggles worden persistent bewaard en winnen altijd van de fase-default.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe sleutel `batch_kosten_card_title` (NL: *Kosten samenvatting*).
- `config.yaml` — versie bump 1.9.19 → 1.9.20.

---

## [1.9.19] — 2026-05-05

### Changed — Batchpagina: volumes, verlies en duidelijkere CCP-meting

- `src/utils/constants.ts` + `src/types/index.ts` — nieuwe verlies-bron `gist_dump` (Gist dump) toegevoegd aan `VERLIES_BRONNEN` en `VerliesBron`-type.
- `src/utils/calculations.ts` — `tankRestVolume` accepteert nu een derde parameter `verliezen` en trekt die liters af van het tankvolume zodat het in-tank volume altijd klopt. Negatieve verliezen werken als correctie (bijvoorbeeld wanneer er meer is afgevuld dan in tank zat). `tankAccijnsWaarde` en `agpOverzicht` kregen dezelfde optionele parameter.
- `src/pages/BatchesPage.tsx` — nieuwe sectie **Volumes** direct onder *Vergistingsvoortgang* met Vergist, In tank, Verpakt en Verlies (met klikbare snelkoppeling naar verliesregistratie). De oude volume-strook in de kostensamenvatting is verwijderd. Het verlies-invoerveld accepteert nu negatieve waarden voor correcties. Bij Kritische Controle Punten toont het meetformulier nu de eenheid in het label (`Gemeten waarde (°C)`), een placeholder en een expliciete `Kritische grens`-regel zodat duidelijk is wat ingevuld moet worden.
- `src/i18n/{nl,en,de,fr,es}.json` — sleutel `batch_abv_accijns_label` hernoemd van *ABV voor accijns* naar *ABV gereed product* (en hint bijgewerkt). Nieuwe sleutels `verlies_bron_gist_dump` en `batch_volumes_header` in alle 5 talen.
- `config.yaml` — versie bump 1.9.18 → 1.9.19.

---

## [1.9.18] — 2026-05-04

### Added — Eenmalige opruiming van lege inkoopfacturen

- `src/App.tsx` — eenmalige migratie die bij het opstarten controleert of er bestaande `inkoop_facturen` zijn zonder leverancier én zonder factuurnummer. Als die er zijn, wordt de gebruiker eenmalig gevraagd of de records opgeruimd mogen worden. Bij bevestiging worden de facturen verwijderd plus alle `bank_koppelingen` met `soort: 'inkoop'` die naar deze facturen verwezen. De bijbehorende `lots` en `voorraad_log`-entries blijven onaangeroerd, zodat de fysieke voorraad klopt zonder financiële tegenboeking.
- Status wordt vastgelegd in nieuwe data-key `lege_facturen_migratie_v1` (`null` → `'done'`) zodat de prompt na keuze (ja of nee) niet opnieuw verschijnt.
- Wijziging logt audit-entry via `logAudit`.
- i18n: nieuwe sleutels `confirm_lege_facturen_opruimen` en `audit_lege_facturen_opgeruimd` in `nl/en/de/fr/es`.
- `config.yaml` — versie bump 1.9.17 → 1.9.18.

---

## [1.9.17] — 2026-05-04

### Changed — Lot toevoegen zonder factuur in boekhouding

- `InkoopFactuurModal` slaat geen `inkoop_facturen`-record meer op wanneer zowel leverancier als factuurnummer leeg zijn. De ontvangst wordt dan beschouwd als voorraadcorrectie: lots en `voorraad_log`-entries worden wél aangemaakt, zodat de fysieke voorraad klopt zonder financiële tegenboeking.
- `src/pages/IngredientenPage.tsx` — `saveOntvangst` controleert `factuurForm.leverancier` en `factuurForm.factuur` voordat een inkoopfactuur wordt weggeschreven.
- `src/pages/BoekhoudingPage.tsx` — `saveVrijeFactuur` past dezelfde logica toe.
- `src/components/InkoopFactuurModal.tsx` — toont een blauwe info-hint zodra beide velden leeg zijn, zodat de gebruiker weet dat de ontvangst als correctie wordt opgeslagen.
- i18n: nieuwe sleutel `hint_correctie_geen_factuur` toegevoegd aan `nl/en/de/fr/es`.
- `config.yaml` — versie bump 1.9.16 → 1.9.17.

---

## [1.9.16] — 2026-05-04

### Removed — Opruiming van dode paginabestanden

- `src/pages/HygienePage.tsx` verwijderd: 8-regelige stub die `null` returnde. De hygiëne-checklist zit ingebed in `BatchesPage`; `DEFAULT_HYGIENE_GROUPS` en `DEFAULT_HYGIENE_ITEMS` worden direct uit `src/utils/constants.ts` geïmporteerd, dus de re-export was overbodig.
- `src/pages/AfvullenPage.tsx` verwijderd: werd geïmporteerd in `App.tsx` maar nergens als JSX gerenderd. De afvul-flow zit in `BatchesPage` en `ProductenPage`.
- `src/pages/VoorraadPage.tsx` verwijderd: nergens geïmporteerd. Voorraad-functionaliteit zit in `IngredientenPage`, `InventarisatiePage` en `VoorraadverloopPage`.
- Ongebruikte `AfvullenPage`-import uit `src/App.tsx` verwijderd.
- `config.yaml` — versie bump 1.9.15 → 1.9.16.

---

## [1.9.15] — 2026-05-04

### Changed — Consistente afronding van bedragen en hoeveelheden

- **Bedragen altijd op 2 decimalen:** netto, btw_bedrag en totalen worden nu bij opslag afgerond via een nieuwe `r2()` helper i.p.v. ruwe float-arithmetic. Voorkomt floating-point junk zoals `0.30000000000000004` in de opgeslagen data — daardoor blijven sommen ook na meerdere bewerkingen schoon.
- **Hoeveelheden tot maximaal 3 decimalen** (`r3` voor opslag, `fmtQty` voor display) zonder geforceerde trailing zeros: `0.500` → `0,5`, `1.2300004` → `1,23`. Lot-mutaties bij correctie en afboeking ronden nu ook stelselmatig af.
- Nieuwe helpers in `src/utils/format.ts`: `fmtAmt(v)`, `fmtQty(v, max=3)`, `r2(n)`, `r3(n)`.
- Display van `lot.hoeveelheid` en bewegingsregels gaat nu via `fmtQty` op alle relevante plekken: ingrediëntlijst, voorraadlog, batch-grondstoffen, lot-keuze, dashboard-waarschuwingen, statiegeldoverzicht, factuurregels in pakbon en productenlog.
- Raakt geen bestaande data aan (alleen nieuwe opslagen worden afgerond), en breekt niet met formuliervelden — input blijft ongerond zodat de gebruiker tijdens typen vrij is.
- `config.yaml` — versie bump 1.9.14 → 1.9.15.

---

## [1.9.14] — 2026-05-04

### Added — BTW-suppletie via doorrol naar huidige aangifte

- Inkoopfacturen die in een al **ingediende of betaalde** BTW-periode worden geboekt, krijgen automatisch het veld `btw_periode` met de huidige openstaande periodeKey (bv. `2026-Q2`). De BTW van deze factuur wordt zo in de lopende aangifte meegenomen i.p.v. de afgesloten periode achteraf te wijzigen.
- **Waarschuwingsbanner in de inkoopfactuurmodal:** zodra de gekozen factuurdatum in een afgesloten periode valt, ziet de gebruiker direct dat de BTW doorgerold wordt en naar welke periode (`msg_btw_rollover`).
- **Badge in de inkoopfacturenlijst:** facturen met `btw_periode` tonen `↪ BTW {periode}` zodat in één oogopslag zichtbaar is dat de BTW elders wordt geclaimd.
- **BTW-overzicht per periode** filtert nu op effectieve periodeKey (`btw_periode || datum`) i.p.v. op datumbereik. Doorgerolde facturen verschijnen in de huidige openstaande aangifte; afgesloten perioden blijven onaangeroerd.
- Nieuwe utility `src/utils/btw.ts` met `datumToPeriodeKey`, `huidigePeriodeKey`, `isPeriodeGesloten`, `effectievePeriodeKey` en `bepaalRollover`.
- Werkt in alle 4 inkoopfactuur-flows: ingrediëntontvangst, vrije inkoopfactuur, factuur bewerken én bankboeking.
- Vertalingen toegevoegd in NL, EN, DE, FR, ES.
- `config.yaml` — versie bump 1.9.13 → 1.9.14.

---

## [1.9.13] — 2026-04-27

### Changed — Belastbaar feit verschoven naar Picken (Douane v2.4 §10.2)

- **Picken = uitslag uit AGP.** `savePicks()` maakt nu zelf de `Uitlevering`- en `Accijns`-records aan zodra alle picks compleet zijn; voorheen ontstonden die pas bij Afronden. Dit volgt §10.2 van het bedrijfshandboek: "Op dit moment verlaat het bier de AGP en is het veraccijnsd."
- **Nieuwe knop "📦 Markeer verzonden"** tussen Gepickt en Afgerond — een logistieke statusovergang zonder fiscaal effect.
- **Order afronden** is teruggebracht tot factuur + pakbon + status `'afgerond'`. De afrondmodal communiceert dit nu expliciet.
- **Picking-modal sectie "Uitslag uit AGP"** — `type_uitlevering` (binnenland / intra-EU / export), bestemming en vervoerder worden nu vóór bevestiging ingevuld.
- **Achterwaarts compatibel:** legacy-picks zonder `uitlevering_ids` triggeren een fallback in `rondeAf` zodat oude data probleemloos blijft werken.
- Refactor: `bouwUitslagRecords()` extraheert de per-locatie-allocatie en record-creatie uit `rondeAf` voor hergebruik.

### Changed — Vernietigingsflow met statussen Aangevraagd → Toegestaan → Uitgevoerd (Douane v2.4 §7.2.3)

- **Stap 1 — Aangevraagd.** Bij aanmaken van een vernietiging is verplicht: datum indiening verklaring + minstens één bijlage met rol `douane_verklaring`. De UI verwijst naar het Douane-formulier "Verklaring vernietiging accijns- of verbruiksbelastinggoederen vanuit een schorsingsregeling/vrijstelling" op www.douane.nl. Voorraad wordt gereserveerd.
- **Stap 2 — Toegestaan.** Nieuwe vervolgmodal voor het verwerken van schriftelijke toestemming Douane: datum + optioneel kenmerk.
- **Stap 3 — Uitgevoerd.** Datum uitvoering + minstens één bijlage met rol `bewijs` (foto/video). Bij bevestigen wordt de voorraad definitief afgeboekt en logt het auditlog dat de potentiële accijnsschuld vervalt voor de vernietigde hoeveelheid.
- **Statusbadges** (Aangevraagd geel, Toegestaan blauw, Uitgevoerd groen) in de afboekingenlijst per afvulling, met "→ Toestemming verwerken" / "→ Uitvoeren registreren" knoppen.
- **Bijlagen tonen hun rol** als label ("verklaring" / "bewijs").
- Legacy-afboekingen zonder status worden weergegeven als `'aangevraagd'`.

### Fixed — Pre-existing TypeScript-errors

Alle 17 baseline-tsc-errors opgelost zodat `tsc --noEmit` nu schoon door komt:
- `Btn.title?: string` toegevoegd aan `BtnProps` (lost BatchesPage 1396 + nieuwe BestellingenPage-knop op).
- `IngredientenPage.Props` uitgebreid met optionele `auditLog` en `setAuditLog` (lost App.tsx 824 op).
- `BestellingenPage` `draftPicks` type uitgebreid met `bron_locatie_id?: number | null`.
- `InkoopFactuurModal` `parseFloat(...||0)` → `parseFloat(String(...||'0'))` (2x).
- `BoekhoudingPage.knownLeveranciers` als `useMemo<string[]>` getypeerd; `replace('{n}', n)` met `String(...)` cast.
- `DashboardPage` `<SectionHeader rounded>` → `rounded="top"`.
- `IngredientenPage` `<Btn onClick={(e) => ...}>` met argument verpakt in `<span onClick>` wrapper (2x); `setOdEditForm({...})` aangevuld met `od_id` + `lotnr`; `replace('{n}', ...)` met `String()` cast.

### Bestanden gewijzigd

- `src/pages/BestellingenPage.tsx` — belastbaar feit naar picken, `markVerzonden`, picking-modal uitlevering-sectie.
- `src/pages/ProductenPage.tsx` — 3-staps vernietigingsflow + vernietigingsreview-modal.
- `src/i18n/nl.json` — `order_mark_shipped` toegevoegd, `order_complete` herbenoemd naar "Afronden".
- `src/components/ui/Btn.tsx` — `title?: string` prop.
- `src/components/InkoopFactuurModal.tsx` — type-coercion fix.
- `src/pages/BoekhoudingPage.tsx`, `DashboardPage.tsx`, `IngredientenPage.tsx` — diverse type-fixes.
- `config.yaml` — versie bump 1.9.12 → 1.9.13.

---

## [1.9.12] — 2026-04-27

### Improved — CCP-meting invoer is nu zelfsturend

- **Eenheid in label** — het waarde-veld toont de eenheid van de gekozen CCP direct in het label (bv. "Gemeten waarde (°C)").
- **Acceptabele waarde inline** — onder het invoerveld verschijnen de min/max-grenzen uit de CCP-definitie, zodat duidelijk is wat als afwijking telt.
- **Monitoring-methode + kritische grens bovenin** — direct onder de CCP-keuze tonen we de bijhorende monitoringmethode en de tekstuele kritische grens, zodat de operator niet hoeft te zoeken wat er gemeten moet worden.
- **Real-time afwijkingsindicator** — wanneer de ingevulde waarde buiten de grenzen valt, kleurt het help-blokje rood met een waarschuwingspictogram en de melding dat een CAPA-record automatisch wordt aangemaakt.
- **HTML5 min/max** — browser-validatie via min/max-attributen op de number input.

### Bestanden gewijzigd
- `src/pages/HACCPPage.tsx` — `ccp_met`-modal omgebouwd tot IIFE die de geselecteerde CCP-definitie ophaalt en context toont; placeholder, label-suffix met eenheid en help-strip met range + out-of-range-indicator toegevoegd.
- `src/i18n/{nl,en,de,fr,es}.json` — 4 nieuwe sleutels (`haccp_ccp_waarde_ph`, `haccp_ccp_waarde_ph_geen_eenheid`, `haccp_ccp_acceptabele_range`, `haccp_ccp_buiten_grenzen`).

---

## [1.9.11] — 2026-04-27

### Changed — AGP is geen geldige bestemming voor verplaatsingen

- Bier dat de AGP heeft verlaten kan niet onder schorsing terug — dat is geen
  reguliere voorraadbeweging maar een teruggaaf-procedure (apart traject).
- AGP-locatie is uit de `naar_locatie`-dropdown van de verplaatsing-modal
  gefilterd; harde guard in `saveVerplaats` met duidelijke foutmelding.
- AGP-eind in Voorraadverloop telt geen verplaatsingen-naar-AGP meer als
  positieve instroom — bier komt op AGP alleen via afvullen (productie).
- i18n: `agp_info_geen_accijns_retour` (5 talen) vervangen door
  `agp_err_geen_retour_naar_agp` met de juiste juridische framing.

---

## [1.9.10] — 2026-04-27

### Fixed — Dockerfile kopieert vendor/ vóór npm install

- `COPY package.json package-lock.json ./` + `COPY vendor/ ./vendor/`
  vóór `RUN npm ci`. De vorige stap kopieerde alleen `package.json`,
  waardoor de `file:./vendor/xlsx-0.20.3.tgz`-dependency niet gevonden
  werd en de HA-addon-build faalde met `ENOENT: vendor/xlsx-0.20.3.tgz`.
- Switch van `npm install` naar `npm ci` voor deterministische installs
  (vereist `package-lock.json`, ~3× sneller).

---

## [1.9.9] — 2026-04-27

### Changed — `package-lock.json` synchroniseren met vendored xlsx

- Lockfile geregenereerd zodat de `resolved`-URL voor `xlsx` naar
  `file:vendor/xlsx-0.20.3.tgz` wijst in plaats van naar de CDN. Maakt
  `npm ci` reproduceerbaar in de Claude Code-sandbox.

---

## [1.9.8] — 2026-04-27

### Changed — `xlsx` gevendord + SessionStart-hook voor Claude Code op het web

- `xlsx@0.20.3` wordt nu vanuit `vendor/xlsx-0.20.3.tgz` geïnstalleerd in plaats
  van `https://cdn.sheetjs.com/...`. SheetJS publiceert niet op npm en de
  CDN is onbereikbaar vanuit de Claude Code-sandbox; vendoren maakt installs
  deterministisch en offline-capable.
- `.claude/hooks/session-start.sh` + registratie in `.claude/settings.json`
  draait `npm install` bij sessiestart in de remote-sandbox (idempotent: skipt
  als `node_modules` al gevuld is). Lokale dev-omgevingen worden niet geraakt
  (`CLAUDE_CODE_REMOTE`-guard).
- `vendor/README.md` documenteert hoe de tarball ververst wordt.

---

## [1.9.7] — 2026-04-27

### Added — AGP-perspectief en accijns in Voorraadverloop

- **Voorraadverloop "Gereed product"-tabel uitgebreid** met drie kolomgroepen:
  totaalvoorraad (begin/productie/binnenland/export/bijz./eind), AGP-voorraad onder
  schorsing (begin/uitgeslagen/eind) en accijns (latente schuld op AGP-eindvoorraad +
  te betalen accijns over de periode).
- **Latente schuld** wordt berekend met de bevroren `voorcalc_accijns_per_eenheid`
  snapshot per afvulling, zodat tariefwijzigingen historische cijfers niet aantasten.
- **Te betalen accijns** somt alle uitstroom uit AGP in de periode (uitleveringen +
  verplaatsingen naar niet-AGP-locaties), met export als niet-belastbaar feit.
- Excel-export bevat de nieuwe kolommen.

### Removed — Intracommunautair en e-AD geschrapt

- `TypeUitlevering = 'intracommunautair'` is verwijderd. Bestaande records met
  deze waarde renderen leeg in de UI.
- e-AD register-tab in `AccijnsPage` is verwijderd, inclusief `EADDocument`,
  `EADType`, `EADStatus` types en de `ead_documenten`-data sleutel.
- IC-optie + e-AD-waarschuwing in de bestelling-uitleverings-modal verdwenen.
- `agp_stroom_eu` badge in het AGP-stroomdiagram (Instellingen) verdwenen.
- ARC-nummer-veld op ingrediëntlots verdwenen. e-AD-sheet uit Excel-backup verdwenen.
- 30+ i18n-sleutels in 5 talen opgeruimd, AGP/accijns-sleutels toegevoegd.
- BTW-rubriek 2a (intracommunautaire BTW-aangifte) blijft staan — separate van accijns.

---

## [1.9.6] — 2026-04-27

### Added — Privé vs. zakelijk onderscheid op orders + AGP-restrictie privé

- **Klanttype op `Bestelling` en `Klant`** — nieuw veld `klant_type: 'prive' | 'zakelijk'`. Handmatige orders krijgen een toggle bij het aanmaken, met privé als default. Bedrijfsnaam is verplicht voor zakelijke orders.
- **WooCommerce-import** — `klant_type` wordt afgeleid uit `billing.company` (en BTW-nummer indien aanwezig in metadata): gevuld → zakelijk, anders → privé.
- **Hard blokkeren AGP voor privéklanten** — privéklanten mogen wettelijk niet uit de Accijnsgoederenplaats geleverd worden. De picking modal toont voor privé-orders alleen voorraad buiten AGP, de locatie-keuze sluit AGP uit, en `rondeAf` valt niet meer terug op AGP. Bij ontoereikende non-AGP-voorraad volgt een duidelijke foutmelding met instructie om eerst voorraad uit AGP te verplaatsen.
- **Lazy backfill** — bestaande orders zonder `klant_type` worden afgeleid uit `klant_bedrijf`, maar alleen voor niet-verzonden orders, zodat historische allocaties intact blijven.
- **UI** — privé/zakelijk-badges op de orderlijst en order-detailpagina; info-banner op de pickmodal voor privé-orders.

### Bestanden gewijzigd
- `src/types/index.ts` — `KlantType`-type, `klant_type` op `Bestelling` en `Klant`.
- `src/pages/BestellingenPage.tsx` — `effectiveKlantType`, `beschikbaarBuitenAgpVoorAfvulling`, klant-type-toggle in handmatige order-modal, AGP-filter in pick modal, validatie in `savePicks` en `rondeAf`, badges in lijst en detail.
- `src/i18n/{nl,en,de,fr,es}.json` — 7 nieuwe sleutels (`lbl_klant_type`, `lbl_zakelijk`, `lbl_prive`, `info_prive_buiten_agp`, `err_order_company_required`, `err_prive_geen_agp`, `err_prive_buiten_agp_ontoereikend`).

---

## [1.9.5] — 2026-04-25

### Added — Douane-compliance v2.4 (reactie Douane op Bedrijfshandboek v2.3)

Deze release verwerkt de aanvullende eisen van de Nederlandse Douane op het Craftery Brewing-bedrijfshandboek v2.3, en bevat direct de kwaliteitspas die uit een test-pass van de v2.4-implementatie naar voren kwam.

- **Voorcalculatie accijns per afvulling (§7.1)** — bij elke afvulling wordt nu automatisch de potentiële accijnsschuld berekend en bevroren opgeslagen op basis van ABV/Plato/volume + tarief uit de stamgegevens. Zichtbaar op het batchverpakkingsformulier en in de afvullingstabel. Werkt zowel via `BatchesPage` als `AfvullenPage`.
- **Voorcalculatie bij afboekingen (§7.2.1)** — bij het registreren van vermis, intern gebruik of vernietiging toont BrewAdmin direct het accijnsbedrag dat met de afboeking gemoeid is. Bedrag wordt vastgelegd op de mutatie en meegenomen in het maandoverzicht.
- **Verklaring vernietiging vanuit schorsingsregeling (§7.2.3)** — vernietiging-mutaties hebben nu een statusflow `aangevraagd → toegestaan → uitgevoerd` met verplichte upload van de Douane-verklaring (PDF) en bewijsmateriaal (foto/video) bij `uitgevoerd`.
- **Voorcalc + kleurcodering bij inventarisatie (§7.3)** — afwijkingen tonen direct de accijnsimpact (verschil × voorcalc per eenheid). Totaalbalk splitst tekorten en overschotten.
- **Voorraadverloop met potentiële accijnsschuld (§7.4)** — gereed-product-rapport bevat de kolom "Pot. accijnsschuld (€)" en totaal per periode. Excel-export bevat de extra kolommen.
- **Webshop §10.2: belastbaar feit bij picken** — voor consumentenorders verlaten goederen de AGP op het moment van picken, niet bij verzenden. BrewAdmin maakt vanaf nu de Uitslag- en AccijnsRecord-records aan tijdens `savePicks`. De afrond-flow vult alleen bestemmingsdetails aan en maakt factuur/pakbon. Pickmodal toont een Douane-banner.
- **4-ogen-controle op aangiftes (§12.2 + §12.4)** — controleblokken op zowel accijns- als BTW-aangifte met reviewer (default Elise Kok), controle-datum, bevindingen en statussen `open / akkoord / opmerkingen`. Accijnsaangifte kan pas naar `ingediend` na `akkoord`. Alle controleacties belanden in het `audit_log`.
- **Nieuw datatype:** `btw_aangiftes` (`useStore('btw_aangiftes', [])`) — wordt meegenomen in export, import en reset.

### Fixed — kwaliteitspas op v2.4-implementatie
- **Runtime crash AccijnsPage** — verwijzing naar niet-bestaande `getGn(...)` in de lopende-maand-tabel vervangen door `getGnForRecord(...)`. Voorheen ReferenceError zodra je een lopende maand zonder aangifte-view opende.
- **Backup-dekking** — `useStore('btw_aangiftes')` is nu opgenomen in `excelExport`/`excelImport` (sheet `BtwAangiftes`). Voorheen ging de 4-ogen-controlevastlegging op BTW-aangiftes verloren bij een Excel-roundtrip.
- **Voorcalc-snapshot consistent** — `AfvullenPage` zet net als `BatchesPage` de drie `voorcalc_*`-velden bij het aanmaken van een afvulling, zodat de claim "bevroren op afvullingsmoment" voor élke afvulling klopt.
- **Type-interfaces aangevuld** — `BatchesPageProps` (`preNieuwBatch`, `setPreNieuwBatch`) en `BestellingenPageProps` (`klanten`, `setKlanten`) declareren nu de props die `App.tsx` doorgeeft.
- **i18n volledig hersteld** — alle door v2.4 geïntroduceerde gebruikersgerichte teksten lopen via `t()` met sleutels in alle 5 taalbestanden. Drie reeds ontbrekende oude FR/ES-sleutels (`err_confirm_delete_inkoop`, `msg_fetch_error`, `msg_wc_not_active_settings`) ook ingevuld. Pariteit hersteld op 1167+ sleutels per taal.

### Bestanden gewijzigd
- `src/types/index.ts` — uitbreiding `Afvulling`, `Afboeking`, `InventarisatieTelling`, `AccijnsAangifte`. Nieuw: `AfboekingBijlage`, `VernietigingStatus`, `AangifteControle`, `BtwAangifte`, `ControleStatus`.
- `src/utils/calculations.ts` — nieuwe helper `berekenVoorcalcVoorAfvulling()`.
- `src/utils/excel.ts` — nieuwe sheet `BtwAangiftes` voor backup/restore.
- `src/pages/BatchesPage.tsx`, `AfvullenPage.tsx`, `ProductenPage.tsx`, `InventarisatiePage.tsx`, `VoorraadverloopPage.tsx`, `BestellingenPage.tsx`, `AccijnsPage.tsx`, `BoekhoudingPage.tsx` — implementatie + i18n.
- `src/App.tsx` — `btwAangiftes` store toegevoegd, doorgegeven aan `BoekhoudingPage`.
- `src/i18n/{nl,en,de,fr,es}.json` — nieuwe v2.4-sleutels.

---

## [1.9.4] — 2026-04-24

### Fixed — Dashboard toonde "Invalid Date" bij cold-crash start

`fmtD` plakte altijd `T12:00:00` achter de input, wat prima werkt voor
`YYYY-MM-DD`-strings maar een volledige ISO-timestamp corrumpeerde
(`…Z` + `T12:00:00` → onparseerbaar). `cold_crash_datum` wordt opgeslagen
als `new Date().toISOString()`, dus op het dashboard stond altijd
"Gestart: Invalid Date".

- `fmtD` detecteert nu of de input al een `T`-separator bevat en parseert
  ISO-timestamps direct. Bestaande callsites met `YYYY-MM-DD` blijven werken.
- Ongeldige input levert lege string i.p.v. "Invalid Date".

## [1.9.3] — 2026-04-24

### Fixed — Cold-crash tick crashte op "can't subtract offset-naive and offset-aware datetimes"

De frontend slaat `cold_crash_laatste_stap` op met `new Date().toISOString()`,
wat altijd UTC met `Z`-suffix oplevert (offset-aware). De backend deed echter
`datetime.datetime.now()` (offset-naive) en kon daarom geen `now - last_dt`
uitrekenen. Gevolg: in elke tick een exception en geen enkele stap.

- `now` gebruikt nu `datetime.datetime.now(datetime.timezone.utc)`.
- `last_dt` wordt genormaliseerd: `Z` → `+00:00` vóór `fromisoformat`, en
  naive timestamps uit oudere batches krijgen alsnog UTC-tzinfo.

## [1.9.2] — 2026-04-24

### Fixed — Cold-crash reageert nu binnen een minuut en logt diagnostisch

De cold-crash-stapper zat mee in de auto-metingen-loop (elke 10 min). Daardoor
kon er na het uur-moment nog tot 10 min vertraging zitten voor het setpoint
werd verlaagd, en waren er geen logregels om te zien waarom een stap niet
gebeurde.

- Eigen `_cold_crash_loop` thread gestart die elke 60 seconden tikt. De
  ramp-stap blijft strikt uurlijks (alleen de reactietijd is sneller).
- `_cold_crash_tick` logt nu expliciet waarom een batch wordt overgeslagen:
  `climates_enabled=false`, geen climate gekoppeld, setpoint niet te lezen,
  target bereikt, set_temperature faalde. Als er >0 actieve batches zijn en
  het uur nog niet voorbij is, volgt elke 10 min een heartbeat-regel.
- Iedere geslaagde stap logt `batch X: setpoint → Y°C (N stap(pen))` zoals
  voorheen.

Bekijk `Addons → BrewAdmin → Log` om te zien wat de thread aan het doen is.

## [1.9.1] — 2026-04-24

### Added — Cold-crash toggle en live voortgangsindicator op het Dashboard

Aanvulling op 1.9.0: de cold-crash-ramp draait in de achtergrond-thread van de
server (dus ook als de app-tab dicht staat), maar dat was op het Dashboard niet
zichtbaar.

- Cold-crash-knop gedraagt zich nu als een toggle. Tijdens een actieve
  cold-crash verschijnt een knipperende paarse pill ("Cold-crash actief")
  met daarnaast een **Stop**-knop. Als het setpoint het target bereikt,
  wordt de pill groen ("Target bereikt").
- Onder de pill staat een regel met het huidige setpoint → target, de
  ramp-snelheid, en een aftelling "Volgende stap over X min" (elke 30s
  ververst op de UI). Zo is in één oogopslag te zien dat de app bezig is.
- Stoppen wist alleen de cold-crash-metadata op de batch; het status-veld
  blijft op Conditioneren staan.

## [1.9.0] — 2026-04-24

### Changed — Cold-crash verloopt nu geleidelijk in plaats van direct

Voorheen werd bij het starten van de cold-crash het setpoint van het gekoppelde
climate-apparaat ineens op de doeltemperatuur gezet; de ramp-snelheid was
slechts een referentiewaarde.

- Bij klikken op de cold-crash-knop wordt het setpoint nu één ramp-stap onder
  het huidige setpoint gezet (begrensd door het target).
- Een achtergrondthread in `server.py` verlaagt vervolgens elk uur het
  setpoint met de geconfigureerde `ramp_per_uur`, tot de doeltemperatuur is
  bereikt. De laatste stap wordt per batch bijgehouden in
  `cold_crash_laatste_stap`, dus onderbrekingen (app gesloten, server
  herstart) halen hun achterstand automatisch in.
- `settings_coldcrash_desc` in alle 5 talen bijgewerkt om het nieuwe gedrag
  te beschrijven.

## [1.8.99] — 2026-04-23

### Changed — Instellingen-pagina: multi-column layout op brede schermen

De Instellingen-content zat met een `max-w-2xl` cap (672px), waardoor
op een breed scherm alle cards smal onder elkaar stonden met veel lege
ruimte rechts.

- Max-width cap verwijderd; content gebruikt nu de volledige beschikbare
  breedte naast de linker-navigatie.
- Op schermen ≥1280px (xl) stromen de cards in 2 kolommen via
  CSS `columns: 2`. Elke card krijgt `break-inside-avoid` zodat hij
  niet over de kolom-grens splitst.
- Brede cards (Auditlog, Accijnstarieven per jaar, Goederenstroom-AGP,
  Batch-taken) krijgen `[column-span:all]` zodat ze over beide kolommen
  blijven — dat zijn de secties met een brede tabel of horizontale
  flow die te smal zou worden in een enkele kolom.
- Op mobiel/tablet/desktop-tot-1280px blijft alles 1-koloms (zoals
  voorheen), zonder regressies.

## [1.8.98] — 2026-04-23

### Added — Accijnstarieven per jaar + impact-rapport

Accijnstarieven kunnen nu per jaar worden vastgelegd. Elke batch gebruikt
bij berekening automatisch het tarief van het brouwjaar (fallback:
root-level tarief). Historische berekeningen blijven dus correct wanneer
het tarief mid-jaar of met terugwerkende kracht wijzigt.

- **Nieuwe tab-card "💶 Accijnstarieven per jaar"** in Instellingen →
  Financieel, onder de bestaande accijns-card. Tabel met kolommen jaar,
  €/hL×ABV%, €/hL basis, €/hL×Plato, notitie.
- **📊 Impact-knop** per jaar: opent een modaal rapport dat elke batch
  van dat jaar herberekent met het voorgestelde nieuwe tarief en toont:
  oude accijns, nieuwe accijns, verschil per batch, en totaal. Kleurcode:
  rood = bijbetalen, groen = retour. Inclusief CSV-export en print.
- **Retro-situatie support**: handig als de bieraccijns met
  terugwerkende kracht stijgt of daalt — je ziet meteen wat er per batch
  nog verschuldigd is of terug te ontvangen.
- `AccijnsInst.tarieven_historie: AccijnsTariefJaar[]` — nieuw veld.
  `tariefVoorDatum(inst, datum)` helper kiest het geldende tarief.
  `accijnsCalcBatch` en alle relevante callers (App.tsx, AgpPage,
  BestellingenPage, tankAccijnsWaarde, agpOverzicht, agpValueAt) kijken
  nu naar het jaar van de batch.
- `berekenAccijnsImpact(batches, inst, jaar, nieuwTarief)` helper
  produceert het impact-rapport.

### Changed

- **Inkoop-factuurbijlagen** verhuizen terug van **Bedrijf** naar
  **Financieel** (accounting-bewaarplicht hoort bij de financiële
  administratie).

### Fixed

- `saveTarieven`/`resetTarieven` wisten voorheen het hele `accijnsInst`
  object; nu wordt `tarieven_historie` en andere velden behouden.

## [1.8.97] — 2026-04-23

### Changed — Cold-crash preset verhuist naar Brouwerij-tab

Cold-crash is conceptueel een brouwproces­instelling (doeltemperatuur,
ramp-snelheid) vergelijkbaar met de conditioneren-duur in Planning-
defaults — dat de trigger-knop via een HA-climate-call loopt is een
implementatie­detail. De card is daarom verhuisd van **Home Assistant**
naar **Brouwerij**, direct onder Planning-defaults. HA-sectie bevat nu
alleen nog de pure integratie (sensoren, climate/dimmer/switch entities).

## [1.8.96] — 2026-04-23

### Changed — Instellingen-pagina herindeling

De Instellingen-pagina had door recente uitbreidingen 9 tabbladen en een
paar dubbele `activeSection`-blokken, waardoor sommige kaarten op een
onlogische plek stonden. Navigatie is teruggebracht naar 8 heldere tabs:

- **🏭 Brouwerij** — branding, tanks, planning-defaults
- **🏢 Bedrijf** *(nieuw)* — bedrijfsgegevens, factuurlogo,
  factuurvelden, verzendkosten, inkoop-factuurbijlagen-download
- **💶 Financieel** — accijns, BTW-periode, BTW-tarieven, AGP,
  GN-codes (uit eigen tab hierheen)
- **🔗 Koppelingen** — Brewfather, WooCommerce, Claude AI
- **🏠 Home Assistant** — sensoren, climate, dimmers, switches,
  cold-crash
- **🗂 Categorieën** *(nieuw)* — ingrediënttypen, kostensoorten,
  mutatielog-opruim (drie losse tabs samengevoegd)
- **📋 Batch-taken** — ongewijzigd
- **⚙️ App** — thema, taal, data import/export, backup, audit

Geen dubbele `activeSection`-blokken meer. Geen verwijderde
functionaliteit — alle kaarten verhuisd naar hun logische tab.
Nieuwe i18n-sleutels `settings_bedrijf` en `settings_categorieen`
toegevoegd in alle 5 talen.

## [1.8.95] — 2026-04-23

### Added — Tanktijd berekenen uit vergistingsprofiel + conditioneren-basis

De tanktijd op zowel Planning als Batch-info kan nu berekend worden vanuit
het vergistingsprofiel van de batch plus een instelbare conditioneren-duur.

- **Instellingen → Brouwerij → Planning-defaults**: nieuw card met
  `Conditioneren-duur` (dagen, default 14). Dit is de basis die bij de
  som van de vergistingsstappen wordt opgeteld.
- **Batch-info**: naast het tanktijd-invoerveld verschijnt een 🔢 Bereken
  knop. Klikken zet tanktijd = som(vergistingsprofiel.tijd + ramp/24) +
  conditioneren-dagen (afgerond naar boven). De tooltip toont de splitsing.
  Knop is disabled als er geen vergistingsprofiel is. Het invoerveld
  blijft vrij editeerbaar — de gebruiker kan de berekende waarde altijd
  overschrijven.
- **Planning-tabel**: zelfde 🔢 knop inline naast de tanktijd-cel, zodat
  je meerdere batches achter elkaar kunt berekenen zonder naar Batch-info
  te navigeren.
- Nieuwe data-key `planning_instellingen` + opgenomen in Excel-backup
  export/import.
- Nieuwe type `PlanningInst` + utility-functies `sumVergistingDagen()`
  en `berekenTanktijd()` in `src/utils/calculations.ts`.

## [1.8.94] — 2026-04-23

### Changed — Tankkaart: metingen nu boven klimaatpaneel

De volgorde op elke tankkaart op het Dashboard is aangepast zodat de
frequent gebruikte meet-acties bovenaan staan:

1. Tank visueel + batch-info
2. SG-voortgangsbalk
3. + Meting toevoegen
4. Klimaatpaneel (setpoint/HVAC) + vergistingsschema + cold-crash knop

Voorheen stond het klimaatpaneel tussen tank-info en SG-voortgang in.

## [1.8.93] — 2026-04-23

### Added — Tank climate control, vergistingsschema & cold-crash op Dashboard

Het Dashboard laat nu per tank met een gekoppeld climate-apparaat een
compacte controlepaneel zien. Daarnaast is er een cold-crash preset dat
centraal geconfigureerd wordt.

- **Climate op tankkaart**: huidige temperatuur + setpoint + HVAC-modus
  direct bedienbaar vanuit het Dashboard. Elke 60s ververst gelijk met
  de bestaande sensor-refresh.
- **Vergistingsschema**: toont alle stappen uit `batch.vergistingsprofiel`
  met de actieve stap gehighlight, hoeveel dagen er verstreken zijn en
  hoeveel er nog gepland staan (inclusief "gepland verlopen"-markering).
  Met een dropdown of ◀/▶ knoppen kun je direct naar een andere stap;
  bij doorklikken wordt het setpoint meteen naar het climate-apparaat
  gestuurd.
- **Cold-crash preset** in Instellingen → Home Assistant: doeltemperatuur
  (°C) + ramp-snelheid (°C/uur). De waarden worden getoond op de
  tankkaart naast de cold-crash knop.
- **Cold-crash knop** per tank (als er een climate gekoppeld is): zet
  het climate-setpoint direct naar de doeltemperatuur, wijzigt de batch
  naar status `Conditioneren` en slaat `cold_crash_datum`, `_target` en
  `_ramp` op de batch op voor audit/trace.
- Batch-type: nieuwe velden `vergisting_stap_idx`, `vergisting_stap_start`,
  `cold_crash_datum`, `cold_crash_target`, `cold_crash_ramp`.
- Nieuwe data-key `coldcrash_instellingen` + toegevoegd aan Excel-backup
  (export en import) zodat instellingen meereizen.

## [1.8.92] — 2026-04-23

### Changed — HA entity-picker: zoekveld, type-filter en PWM-herdefinitie

Opvolger van 1.8.91. Twee verbeteringen:

- **Zoek- en typefilter**: elke entity-dropdown (sensor, climate, light, switch)
  heeft nu een zoekveld erboven dat filtert op entity_id én friendly name.
  Voor elk domein met meerdere `device_class`-waarden komt er bovenin ook
  een dropdown "Alle types" om bv. alleen temperature-sensoren te tonen.
  Het aantal gefilterde/totaal wordt in de placeholder getoond.
- **Dimmers als PWM i.p.v. lamp**: het `light`-domein wordt in brouwsetups
  vooral gebruikt als PWM-regeling (hitte-elementen, regelbare pompen,
  ventilatoren) — niet voor verlichting. Sectie hernoemd naar
  "Dimmers (PWM)", slider-label naar "Vermogen (PWM duty)", placeholders
  passen daarbij. De onderliggende HA-service-calls blijven identiek
  (`light.turn_on` met `brightness_pct`).

## [1.8.91] — 2026-04-23

### Added — Home Assistant: Climate, Dimmers & Switches

De Home Assistant-koppeling ondersteunde tot nu toe alleen temperatuur­sensoren
(lezen). Vanaf deze versie kunnen ook **klimaatapparaten**, **dimbare
verlichting** en **switches** gekoppeld én **bestuurd** worden vanuit
Instellingen → Home Assistant.

- **Climate** (thermostaten, koelcellen, HVAC): koppeling per entiteit,
  optioneel aan een tank; setpoint (`set_temperature`) en HVAC-modus
  (`set_hvac_mode`) direct instellen; "Auto setpoint" om het
  vergistingsprofiel te volgen.
- **Lampen & dimmers**: aan/uit en helderheidsslider (0–100%) via
  `light.turn_on` / `light.turn_off`; min%/max% om de slider te begrenzen
  (bijv. een warmtelamp nooit boven 60%).
- **Switches**: `switch.turn_on`, `switch.turn_off` en `toggle` voor pompen,
  ventilatoren, verwarming en andere brouwapparatuur.
- **Entity-discovery**: een "Entiteiten ophalen"-knop per domein vult een
  dropdown met alle beschikbare entities (geen handmatig typen meer nodig).
- **Security**: de HA-proxy (`/api/homeassistant/_service/<domain>/<service>`)
  heeft een strikte whitelist op toegestane services en valideert dat het
  entity_id in het juiste domein zit.
- Instellingen zitten in dezelfde `ha_instellingen` key en reizen dus
  automatisch mee in de Excel-backup.

## [1.8.90] — 2026-04-23

### Changed — Eén unified batch-takensysteem (vervangt 4 losse systemen)

In een batch werden voorheen vier aparte "af te vinken"-lijsten getoond:
hygiëne-checklist, brouwdag-checklist, botteldag-checklist en CCP-monitoring.
Dat leverde vier configuratieplekken in Instellingen en vier secties in de
batch-weergave op.

Vanaf deze versie is dat één systeem geworden: **Batch-taken**. Elke taak is
ofwel een aanvink-item (`check`) of een numerieke meting met limieten
(`meting`). Taken worden in zelfgekozen groepen gezet (bv. Voorbereiding,
Brouwdag, Botteldag, Kritische controlepunten) en samen getoond in één sectie
per batch. De CCP-afwijking → automatische CAPA-flow blijft identiek.

- Nieuwe data-keys: `batch_taken_items`, `batch_taken_groepen`.
- Nieuwe instellingensectie: "Batch-taken" (vervangt "Hygiëne" + "Checklists").
- Nieuw batch-veld: `taken_checks: Record<number, boolean>`.
- Bestaande gebruikers: bij eerste load worden hygiëne-items, brouwdag- en
  botteldag-checklists en CCP-definities automatisch samengevoegd tot het
  nieuwe model; afgevinkte items en metingen blijven behouden.
- Oude data-keys blijven op de server staan voor veiligheid (read-only).
- Backup (Excel): nieuwe sheets `BatchTakenItems` en `BatchTakenGroepen`.

## [1.8.89] — 2026-04-23

### Added — Live alcoholpercentage uit SG-metingen + expliciet accijns-ABV

Op het batch-detailpaneel toont de sectie "Gistingsvoortgang" nu het
actuele alcoholpercentage, berekend uit de SG-metingen tijdens de
vergisting (formule: `ABV = (OG − FG) × 131.25`). Zolang de gisting
loopt wordt het gemarkeerd als *voorlopig*.

Daarnaast staat naast de berekende waarde een duidelijk invoerveld
**"ABV voor accijns"** dat direct schrijft naar `batch.ABV` — het veld
dat `accijnsCalcBatch` gebruikt voor de accijnsberekening. Een
"Neem over"-knop kopieert de berekende waarde één-op-één naar het
accijnsveld.

- **Frontend** (`src/pages/BatchesPage.tsx`): nieuwe berekening- en
  invoerrij in de fermentatie-progressiesectie; gebruikt
  `berekenLiveABV` om OG (of eerste SG) en laatste SG-meting te
  combineren.
- **Utils** (`src/utils/calculations.ts`): nieuwe helpers `berekenABV`
  (OG/FG → %) en `berekenLiveABV` (batch + metingen → actuele ABV met
  bron-indicatie).
- **i18n**: 8 nieuwe sleutels in nl/en/de/fr/es.

## [1.8.88] — 2026-04-22

### Fixed — Logo's raken niet meer weg bij Excel-backup import

Voorheen schreef `excelExport` de logo's wél als argument door, maar ze
belandden niet in het Instellingen-sheet (het oude compromis "te groot
voor cellen"). Bij import werd `instMap['app_logo']` dus `undefined` en
liet de `|| null`-fallback het bestaande logo wissen.

- **Export** (`src/utils/excel.ts`): `app_logo` en `factuur_logo`
  worden als base64 in het Instellingen-sheet geschreven. Bij base64
  groter dan de Excel-cel-limiet (~32767 chars) wordt de string
  opgesplitst in chunks van 30 000 tekens (`app_logo__0`,
  `app_logo__1`, …).
- **Import**: nieuwe `readLogo(key)` leest het logo uit een enkele cel
  óf voegt de chunks weer aaneen. Ontbreekt de sleutel volledig in de
  backup, dan retourneert het `undefined` zodat `doImport` het
  bestaande logo ongemoeid laat (eerder werd dat naar `null` gezet).
- Backward compatible: oudere backups zonder logo-velden overschrijven
  niets meer, en backups met één enkele logo-cel blijven leesbaar.

---

## [1.8.87] — 2026-04-22

### Added — Aanpasbare brouwdag- en botteldag-checklists
- **Instellingen → Checklists**: nieuwe sectie waar de items van de
  Brouwdag- en Botteldag-checklist volledig aanpasbaar zijn. De
  standaardlijst (12 brouwdag- + 9 botteldag-items) staat vooringevuld,
  maar items kunnen worden verwijderd, hernoemd (klik op een item om te
  bewerken), herschikt met pijltjes omhoog/omlaag, en nieuwe items
  kunnen worden toegevoegd. Knoppen voor "Terugzetten naar standaard"
  per checklist. De per-batch checklist op de detailpagina gebruikt
  automatisch de ingestelde items.
- Nieuwe datasleutels `brouwdag_checklist` en `botteldag_checklist`
  (incl. Excel-backup/restore).

---

## [1.8.86] — 2026-04-22

### Added — Batch-ingredienten koppelen aan voorraad-ingredienten

- In de batch-detailweergave (ingrediënten-tabel) staat nu naast de
  ingrediëntnaam een koppel-pill. Wanneer de naam niet overeenkomt
  met een voorraad-ingrediënt verschijnt een oranje "Koppelen"-knop
  die een dropdown opent met alle voorraad-ingredienten van het
  juiste type (Mout/Hop/Gist/Suiker/Overig). Bij expliciete koppeling
  verschijnt een blauwe 🔗-pill.
- De koppeling werkt op **groepsniveau**: alle batch-regels met
  hetzelfde `ingredient_id` of dezelfde naam krijgen in één keer de
  nieuwe koppeling. Handig bij meerdaagse dryhops of gefaseerde
  giststortingen waar dezelfde ingredient vaker voorkomt.
- Hergebruikt de i18n-sleutels uit v1.8.85 (`recipe_link_auto`,
  `recipe_link_edit`, `recipe_link_none`).

---

## [1.8.85] — 2026-04-22

### Added — Recept-ingredienten koppelen aan voorraad-ingredienten

- In de recept-detailweergave staat nu een extra kolom "Gekoppeld aan"
  met per rij een koppel-control. Als de recept-ingrediëntnaam exact
  overeenkomt met een voorraad-ingrediënt wordt die automatisch
  getoond; bij afwijkende namen verschijnt een oranje "Koppelen"-knop
  die een dropdown opent met alle ingredienten van het juiste type
  (Mout/Hop/Gist/Overig — voor "Overig" wordt ook "Suiker" getoond).
- `ReceptIngredient` uitgebreid met `ingredient_id?: number | null`.
  De voorraadcheck (`checkStock`) geeft voorrang aan deze expliciete
  koppeling en valt terug op naam-matching voor backward compat.
- Bij de "Brouwen"-actie wordt `ingredient_id` meegegeven aan
  `BatchIngredient`, zodat de batch direct gekoppeld start.
- De Brewfather-sync bewaart gebruikersgekoppelingen: per recept-id
  en per sectie wordt op naam gematcht om `ingredient_id` over te
  nemen van de oude naar de nieuwe receptversie.
- Versie-snapshots zijn alleen-lezen; koppelen kan alleen op de
  huidige versie.
- Nieuwe i18n-sleutels (nl/en/de/fr/es): `recipe_linked_to`,
  `recipe_link_auto`, `recipe_link_edit`, `recipe_link_none`.

---

## [1.8.84] — 2026-04-22

### Added — Brewfather-recept-versies ophalen en tonen

- De Brewfather-sync haalt nu per recept ook de versie-snapshots op via
  `GET /recipes/{id}/versions`. Snapshots worden als aparte, alleen-
  lezen entries onder het hoofdrecept getoond met een collapsible
  versie-lijst en een versie-pill in de detail-header.
- Nieuwe helpers `bfMapRecipe()`, `bfGetRecipeVersions()` en
  `bfGetRecipesWithVersions()` in `src/utils/api.ts`. Versies worden
  in parallelle batches van 10 opgehaald.
- Defensief: als het versies-endpoint niet beschikbaar is (404/403/501),
  slaat de sync dit stil over en toont de melding
  `msg_bf_sync_no_versions`.
- `Recept` interface uitgebreid met `versie`, `versie_id`, `parent_id`,
  `is_huidige` en `versie_datum`. Backward compatible: bestaande
  recepten zonder deze velden gedragen zich als huidige versie, en
  bestaande batch-/productkoppelingen via `recept_id`/`rid` blijven
  matchen op de parent `_id`.
- Brouwen is alleen mogelijk vanaf de huidige versie; snapshots tonen
  een "alleen-lezen" label.
- Nieuwe i18n-sleutels (nl/en/de/fr/es): `recipe_version_current`,
  `recipe_version_snapshot`, `recipe_version_readonly`,
  `recipe_versions_count`, `msg_bf_sync_with_versions`,
  `msg_bf_sync_no_versions`.

---

## [1.8.83] — 2026-04-22

### Added — Brewfather-batchnummer zichtbaar in batch-detail

- In de batch-detail-header wordt nu naast het app-eigen `#batch_nummer`
  ook `BF #brewfather_batch_nummer` getoond (alleen als dat veld
  gevuld is, voorafgegaan door een bullet-scheiding).
- In de info-grid (`BatchesPage.tsx:1309`) is een nieuwe rij
  "Brewfather #" toegevoegd, alleen zichtbaar voor batches die via
  Brewfather zijn geïmporteerd.
- Nieuwe i18n-sleutel `batch_info_bf_batch_nr` in nl/en/de/fr/es.

---

## [1.8.82] — 2026-04-22

### Fixed — Brewfather-sync koppelt geen batches meer verkeerd

Voorheen kon een Brewfather-sync twee verschillende batches per ongeluk
aan elkaar koppelen omdat matching naast `brewfather_id` ook op een
toevallige gelijkenis tussen app-`batch_nummer` en BF-`batchNo`
plaatsvond. Dat overschreef status, OG/FG/ABV, rendement en vergistings-/
maischprofielen van de verkeerde batch en plakte die permanent aan het
verkeerde `brewfather_id` vast.

### Changed — App-eigen batchnummering losgekoppeld van Brewfather

- **Nieuw veld** `brewfather_batch_nummer` (zie `src/types/index.ts`) houdt
  het Brewfather-`batchNo` als losstaande referentie bij; `batch_nummer`
  blijft het app-eigen nummer. Bij bestaande batches vult de sync
  `brewfather_batch_nummer` één keer aan (zonder te overschrijven).
- **Bij nieuwe BF-import** kent de app automatisch een eigen volgnummer
  toe via de gedeelde helper `nextBatchNummer(batches)` in
  `src/utils/calculations.ts` (zelfde logica als de "Nieuwe batch"-knop:
  prefix/jaar/padding behouden, staart met 1 verhoogd).
- **Sync matcht alléén nog op `brewfather_id`** (in `App.tsx` auto-sync
  én `BatchesPage.tsx` `runBfSync`). Zo kan toevallige gelijkenis tussen
  twee onafhankelijke nummerruimten nooit meer leiden tot verstrengelde
  batches.

---

## [1.8.81] — 2026-04-22

### Changed — Fermentatiegrafiek: X-as vanaf Vergisten-moment

- De X-as van de gistgrafiek (`FermentatieGrafiek` in `BatchesPage.tsx`)
  start nu bij het moment dat de batch op **Vergisten** ging, niet bij de
  eerste meting. Bron: eerste `tank_historie`-entry met
  `status='Vergisten'`, fallback `batch.datum`. Zo is de volledige
  fermentatie-aanloop zichtbaar — óók als de eerste meting pas later is
  gedaan.
- Een groene gestippelde verticale lijn met label "Vergisten" markeert
  het startmoment in de grafiek (alleen zichtbaar als het vóór de eerste
  meting ligt en binnen de huidige zoomview valt).
- Nieuwe i18n-sleutel `batch_gist_start` in alle 5 talen.

---

## [1.8.80] — 2026-04-22

### Fixed — Nette afhandeling van rate-limit-fouten (HTTP 429)

- **Server**: de 429-respons (`{"error":"too many requests"}`) bevat voortaan
  een `Retry-After`-header met het aantal seconden tot de oudste request in
  het per-IP-venster vervalt, zodat clients weten hoe lang te wachten.
- **Frontend (`src/utils/api.ts`)**: alle calls naar `/api/data/`,
  Brewfather, WooCommerce, Home Assistant en Claude gaan nu via
  `_fetchWithRetry`, die automatisch opnieuw probeert bij 429 met respect
  voor de `Retry-After`-header (min. 1s, max. 30s). 429-responses tellen
  niet meer mee als sync-fout en de client hamert de server niet langer.
- **UI**: de `SyncDot` heeft een nieuwe oranje pulserende status
  **rate_limited** met de tooltip "Te veel verzoeken — even wachten"
  (5 talen), zodat de gebruiker onderscheid ziet tussen een echte
  verbindingsfout en tijdelijke throttling.

---

## [1.8.79] — 2026-04-18

### Added — Auto-invul batchnummer bij nieuwe batch
- Het veld **Batch #** wordt bij het aanmaken van een nieuwe batch
  automatisch ingevuld met het volgende opeenvolgende nummer, afgeleid
  van de meest recente bestaande batch. De numerieke staart wordt met 1
  verhoogd met behoud van prefix en zero-padding (bv. `B-2026-012` →
  `B-2026-013`). Werkt zowel voor de gewone "Nieuwe batch"-knop als voor
  batches die vanuit een recept worden aangemaakt. Fallback bij een lege
  lijst: `B-{huidigjaar}-001`.

---

## [1.8.78] — 2026-04-18

### Added — Visuele tank-bezetting + slimme tank-keuze in batchformulier
- **PlanningPage**: de oude gegroepeerde "Tank-planning" is vervangen door
  een horizontale Gantt-achtige tijdlijn. Één rij per tank, bars met de
  bezetting per batch (datum → datum + tank_dagen). Kleuren markeren de
  status: Gepland (amber), Vergisten (groen), Conditioneren (paars).
  Gestippelde rand betekent dat er geen `tank_dagen` is ingevuld en er een
  default van 14 dagen wordt getoond. Lopende batches in Vergisten/
  Conditioneren tellen mee, niet alleen de geplande.
- **BatchesPage** (nieuw-/bewerk-formulier):
  - Tank-dropdown toont naast elke tank of hij vrij is of bezet door welke
    batch (met bezettingsperiode) — gebaseerd op datum-overlap, niet meer
    alleen "is er ergens een actieve batch".
  - Nieuw veld **Tanktijd (dgn)** naast Tank en Datum; wordt opgeslagen
    als `batch.tank_dagen`.
  - Inline waarschuwing onder de tank-dropdown als de geselecteerde tank
    overlapt in de planning.
  - Bij opslaan: confirm-dialog bij niet-blokkerende datum-overlap (Gepland);
    harde block blijft voor actief gebruik (Vergisten/Conditioneren) zoals
    voorheen.
- i18n: nieuwe sleutels `plan_status_gepland`, `plan_status_vergisten`,
  `plan_status_conditioneren`, `plan_tank_legend_schatting`,
  `plan_tank_schatting`, `plan_geen_tanks`, `tank_vrij`, `tank_bezet`,
  `tank_overlap_waarschuwing`, `err_tank_overlap` (nl/en/de/fr/es).

---

## [1.8.77] — 2026-04-18

### Fixed — Gist-grafiek: data van verwijderde batch niet meer zichtbaar op nieuwe batch
- `removeBatch` (BatchesPage) cascade-ruimt nu alle aan de batch gekoppelde
  records op: `afvullingen`, `gist_metingen`, `carbonatie_sessies`,
  `verlies_registraties`, `ccp_metingen` en batch-log-entries. Voorheen bleven
  deze achter met `batch_id` dat verwees naar de verwijderde batch.
- `newId` hergebruikt het laagste vrije id, dus een nieuw aangemaakte
  (geplande) batch kon het id van een eerder verwijderde batch overerven,
  waardoor oude gistmetingen plotseling in de gist-grafiek van de nieuwe
  geplande batch verschenen. Cascade-cleanup voorkomt deze "spookdata".

---

## [1.8.76] — 2026-04-18

### Fixed — Planning behoefte: reeds afgeboekte ingrediënten niet meer meegeteld
- `aggregateBatchNeeds` negeert nu `batch_ingredienten` met
  `afgeboekt: true`. Die items zijn al gededuceerd uit de voorraad en horen
  niet meer als "nodig" in de bestellijst/planning te verschijnen. Dit
  voorkomt dat ingrediënten van een reeds gebrouwen batch per ongeluk bij
  de behoefte van een geselecteerde geplande batch opgeteld leken.

---

## [1.8.75] — 2026-04-18

### Changed — Planning: tank-toewijzing + tanktijd per brouwdag
- Nieuw veld `tank_dagen` op Batch: geplande tank-bezetting in dagen.
- **PlanningPage** lijstweergave: brouwdag, tank en tanktijd zijn nu
  inline-bewerkbare invulvelden. Een extra kolom "Tank vrij op" toont de
  afgeleide einddatum (`datum + tank_dagen`).
- Nieuwe sectie **"Tank-planning"** groepeert de geplande brouwsels per
  tank met hun bezettingsperiode (start → eind) en dagen, zodat je in
  één oogopslag ziet wanneer welke tank bezet is.
- i18n-sleutels `plan_tank_tijd`, `plan_tank_vrij_op`, `plan_tank_planning`,
  `plan_zonder_tank`, `plan_dagen` in nl/en/de/fr/es.

---

## [1.8.74] — 2026-04-18

### Added — Planningsmodule: brouwagenda + bestellijst
- **DashboardPage**: nieuwe sectie "Brouwagenda" toont de eerstvolgende 8
  geplande brouwsels (status `Gepland` met `datum ≥ vandaag`). Klik op een
  regel opent de Planning-pagina met die batch vooraf-geselecteerd.
- **Nieuwe Planning-pagina** (`src/pages/PlanningPage.tsx`) met twee
  weergaven: maand-grid (7×6, maandag-eerst) en lijst. Multi-select van
  geplande brouwdagen via checkboxes plus "Alles deze maand" / "Selectie
  leegmaken"-shortcuts. Zoek in de lijstweergave op biernaam.
- **Behoefte vs voorraad**: voor de geselecteerde batches wordt de
  aggregaat-ingrediëntbehoefte per categorie (mout/hop/gist/overig)
  afgezet tegen de huidige voorraad (som van actieve lots).
  Eenheidverschillen worden automatisch omgerekend waar mogelijk;
  incompatibele eenheden krijgen een waarschuwing.
- **BestellijstModal** (`src/components/BestellijstModal.tsx`): bekijkbare
  lijst met alleen de tekorten, gegroepeerd per categorie, met laatste
  leverancier uit de meest recente lot. Sessie-lokale "besteld"-checkboxes.
- Nieuwe helpers in `src/utils/calculations.ts`: `scaleRecipeNeeds`,
  `aggregateBatchNeeds`, `compareNeedsToStock`.
- Navigatie: nieuwe submenu-entry "Planning" onder "Brouwerij".
- i18n-sleutels (`nav_planning`, `plan_*`) toegevoegd in nl/en/de/fr/es.

---

## [1.8.73] — 2026-04-18

### Added — BTW-aangifte indienen + dashboard-signalering openstaande aangiftes
- Nieuwe data-key `btw_aangiftes` (array van `{periodeKey, ingediend_datum,
  bedrag}`), opgenomen in Excel-backup/-import.
- **BoekhoudingPage**: openstaande BTW-periode-kaart krijgt nu een knop
  "Aangifte ingediend". Daarna verandert de status naar "Ingediend"
  (amber) en verschijnt een koppel-selector met een voorgesteld-match-
  groep voor banktransacties binnen € 1 van het aangifte-bedrag (BTW
  wordt afgerond op hele euro's). MT940-import koppelt automatisch een
  debittransactie met dezelfde tolerantie.
- **DashboardPage**: nieuwe oranje stat-cards "BTW-aangifte open" en
  "Accijnsaangifte open" verschijnen alleen als de afgelopen periode
  resp. afgelopen maand nog niet als ingediend is gemarkeerd. Klik
  navigeert naar de boekhouding.
- i18n-sleutels toegevoegd in nl/en/de/fr/es.

---

## [1.8.72] — 2026-04-18

### Changed — SearchInput met loep-icoon + uniforme knopmaat Producten
- `SearchInput` toont nu links een loep-icoon (inspringing via `pl-9`) —
  alle zoekvelden in de app krijgen dit vanzelf.
- Placeholder `ph_product_zoek` vereenvoudigd naar "Zoek product" (nl/en/
  de/fr/es).
- `btn_wc_push_stock`-knop op ProductenPage heeft nu dezelfde hoogte en
  padding als de `+ Product`-knop (`px-4 py-1.5 text-sm rounded-lg`).

---

## [1.8.71] — 2026-04-18

### Changed — ProductenPage in BatchesPage-stijl
- Titel en actieknoppen (inclusief `+ Product`) staan nu rechtsboven boven de
  lijst, consistent met BatchesPage.
- Lijst is omgezet van thumbnail-kaarten naar compacte rij-weergave met
  `flex-1 min-w-0` detail-pane, `w-60` sidebar en mobile back-knop.
- Gearchiveerde producten verhuizen van checkbox-toggle naar ingeklapt
  `SectionHeader`-blok onderaan de lijst.
- Logboek staat nu als volledig-brede sectie onder de lijst i.p.v. in de
  smalle sidebar.
- Knoplabel `btn_nieuw_product` genormaliseerd naar `+ Product` in nl/en/de/
  fr/es.

---

## [1.8.70] — 2026-04-18

### Changed — Uniforme sectieheaders & zoekbalken
- Nieuwe UI-primitives `SectionHeader` en `SearchInput` in `src/components/ui/`.
- Alle klikbare sectieheaders gebruiken nu dezelfde afgeronde bruine `t-hdr`
  balk met links één roterend `▶` en extra info rechts zonder achtergrondkleur.
- Alle zoekvelden op Recepten, Batches, Ingrediënten, Producten en HACCP
  delen dezelfde stijl (border, padding, focus-ring).
- **AccijnsPage**: maand-kaart-header is niet meer groen/amber afhankelijk van
  status; de statuspill blijft semantisch gekleurd maar staat rechts in de
  headerbalk.
- **BatchesPage**: emoji's 🍺, 🛢, 🫙, 🖨, ↪ verwijderd uit de batch-detail-
  header en knoplabels.
- **Dashboard**: navigatieheaders (open bestellingen, HACCP-widget, actieve
  batches) tonen nu het links-roterende `▶` in plaats van `→` rechts.

---

## [1.8.69] — 2026-04-17

### Added — S-5: Negatieve-voorraad-signalering
- **DashboardPage**: nieuwe rode stat-card "Negatieve voorraad" die alleen
  verschijnt als er één of meer voorraadposities met een negatief saldo zijn.
  Klik navigeert naar de voorraadverloop-pagina.
- **VoorraadverloopPage**: nieuwe tab **Controle negatieve voorraad** met
  detaillijst (batch #, product, verpakking, locatie, voorraad) en een
  **CSV-export**-knop. Toont uitleg over oorzaken (uitlevering groter dan
  voorraad op locatie, onjuiste verplaatsingen, dubbele afboekingen) en
  suggereert correctie via inventarisatie of mutatie-aanpassing.
- **utils/calculations.ts**: nieuwe helpers `voorraadPerLocatieRaw()` (zonder
  normalisatie naar 0) en `getNegatieveVoorraadPosities()` bouwen op de
  bestaande `voorraadPerLocatie`-logica; geen nieuwe data-stores nodig.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.68] — 2026-04-17

### Added — S-4: Brouwdag- & botteldag-checklists (HACCP Bijlage A.1 / A.2)
- **BatchesPage**: twee nieuwe checklists per batch, uitklapbaar en standaard
  ingeklapt. De **brouwdag-checklist** (12 items — A.1) verschijnt in de
  `Brouwen`-fase naast de bestaande hygiëne-checklist. De **botteldag-checklist**
  (9 items — A.2) verschijnt bij de afvul-/botteling-stap.
- Voortgang wordt per batch opgeslagen in de nieuwe velden `brouwdag_checks`
  en `botteldag_checks` op `Batch` (beide `Record<number, boolean>`) en via
  de bestaande Excel-backup automatisch meegenomen.
- Elk item (vinken/ontvinken/reset) logt naar de audit-trail.
- Routinekarakter — helpend, niet blokkerend voor batch-statuswijzigingen.
- **constants.ts**: `DEFAULT_BROUWDAG_CHECKLIST` (12) en
  `DEFAULT_BOTTELDAG_CHECKLIST` (9) met i18n-labelKeys.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.67] — 2026-04-17

### Added — M-1: Bijzondere mutaties (vermis / intern gebruik / vernietiging)
- **ProductenPage**: het afboek-modaal kreeg tabbladen per reden. Voor de reden
  **vernietiging** is een Douane-compliance-paneel toegevoegd met verplichte
  velden: toestemming Douane (checkbox), toestemmingsdatum, kenmerk/referentie
  en minimaal één bewijsbijlage (foto of PDF). Zonder deze velden kan de
  afboeking niet worden opgeslagen.
- Bewijsmateriaal wordt via `/api/upload/{filename}` op de add-on-server
  opgeslagen. Toegestane formaten: PDF, JPG, PNG, GIF, WebP, TIFF, BMP,
  HEIC/HEIF (video niet ondersteund — expliciet alleen in-app, geen
  automatische Douane-e-mail).
- **types/index.ts**: Afboeking uitgebreid met `toestemming_douane`,
  `toestemming_datum`, `kenmerk_douane` en `bijlagen: AfboekingBijlage[]`;
  nieuwe `AfboekingBijlage`-interface.
- Audit-log registreert iedere vernietigings-afboeking met verwijzing naar
  de bijlagen.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.66] — 2026-04-16

### Added — Bierverlies-registratie module
- Nieuwe "Verliesregistratie" sectie op de batch-detailweergave waar verlies
  per bron (tankrest, leidingrest, schuim, monsters, afgekeurde flessen,
  overig) met datum, liters en notitie kan worden vastgelegd.
- Per batch tonen we het totaal geregistreerde verlies, het afgeleide verlies
  (liter_vergist − totaal afgevuld) en het nog-niet-toegewezen deel, plus een
  uitsplitsing per bron.
- Het kostprijsblok toont onder "Verlies" een klikbare snelkoppeling naar de
  registratie-sectie. De kostprijs per liter blijft afgeleid van het
  werkelijk afgevulde volume.
- Nieuwe data-sleutel `verlies_registraties` (patroon van `gist_metingen` /
  `carbonatie_sessies`); opgenomen in Excel-backup en -restore.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.65] — 2026-04-16

### Added — Dashboard: HACCP taken widget
- Nieuwe widget op het dashboard toont achterstallige en vandaag-te-doen
  schoonmaaktaken direct, zonder naar de HACCP-pagina te hoeven navigeren.
- Per taak is een **Uitvoeren**-knop beschikbaar die een inline formulier opent
  (Uitgevoerd door, Opmerking, CIP-cyclus) — analoog aan de bestaande inline
  gistmeting op tankkaarten.
- Open CAPA's worden eveneens in de widget getoond met status-badge.
- Bij alle taken bijgewerkt toont de widget een groene "Alles bijgewerkt ✓" staat.
- De widget-header is klikbaar en navigeert naar de volledige HACCP-pagina.
- Vertaald in alle 5 talen (nl/en/de/fr/es).

---

## [1.8.64] — 2026-04-16

### Fixed — Bestellingen: verwarrende dubbele "Annuleren" knoppen
- In de bevestigingsdialoog voor het annuleren van een bestelling stonden twee
  knoppen met exact dezelfde tekst "Annuleren". De bevestig-knop toont nu
  "Ja, annuleren" zodat duidelijk is welke knop de bestelling daadwerkelijk
  annuleert en welke de dialoog sluit.

---

## [1.8.63] — 2026-04-15

### Added — Carbonisatie: tanktemperatuur uit HA-sensor
- **BatchesPage**: in de Carbonisatie-sectie wordt de actuele tanktemperatuur
  nu automatisch gebruikt als pre-fill wanneer er een Home Assistant-sensor
  aan de tank van de batch gekoppeld is. Een **🌡 HA: x.x°C** knop onder het
  tanktemperatuur-veld neemt de meting met één klik over.
- **Placeholder**: het invoerveld toont de live sensorwaarde als placeholder
  zodat de gebruiker direct ziet welke temperatuur de tank heeft.
- **i18n**: nieuwe sleutel `carb_use_sensor_tooltip` (NL/EN/DE/FR/ES).

---

## [1.8.62] — 2026-04-15

### Added — Carbonisatie per batch (CO₂ + carb stone of kopdruk)
- **BatchesPage**: nieuwe **Carbonisatie**-sectie in de `Conditioneren`-fase
  per batch. Brouwer kiest methode (carb stone of kopdruk), doel-CO₂ in vols
  en tanktemperatuur. De app berekent live de benodigde **kopdruk in bar +
  PSI** (Henry's-law lineaire benadering) én het benodigde **CO₂-gewicht** in
  gram (opgelost + totaalverbruik incl. verliesfactor). Dit laat een brouwer
  met een weegschaal onder de fles werken zonder Zahm-Nagel meter.
- **Live indicator** tijdens een actieve sessie: groen / geel / rood naast
  het verbruikt-CO₂-veld — vergelijkt de werkelijke gewichtsname tegen het
  doel (±10% groen, ±25% geel, >25% rood).
- **Standaard CO₂-volumes per bierstijl** (case-insensitive `includes` op
  `batch.stijl`): Pils/Lager/IPA → 2.5, Weizen → 3.2, Stout → 2.0, Saison →
  3.0, Cider → 3.5 (fallback 2.5). Pre-fillt het doel-veld bij start.
- **Sessie-historie**: tabel onder de actieve sessie met alle voltooide en
  afgebroken sessies (datum, methode, doel, druk, verbruikt CO₂, gemeten,
  duur, status). Eén actieve sessie per batch tegelijk.
- **Verpakt-overgang**: bij `Conditioneren → Verpakt` waarschuwt de app als
  er geen voltooide carbonisatie is geregistreerd. Niet blokkerend.

### Data
- Nieuwe datasleutel `carbonatie_sessies` (array). Volgt het `gist_metingen`-
  patroon: gepersisteerd in `/data/carbonatie_sessies.json`, opgenomen in
  Excel-backup als sheet `CarbonatieSessies`, audit-log via entiteit
  `Carbonatiesessie`.
- Nieuw type `CarbonatieSessie` in `src/types/index.ts`.

### Helpers (calculations.ts)
- `carbDrukBar(vols, tempC)` — lineaire Henry's-law benadering (±0.05 bar
  in 0–10 °C / 1.8–3.8 vols)
- `co2GramOpgelost(vols, L)` — opgeloste massa via `1.9632 g/L per vol`
- `co2GramTotaalVerbruik(vols, L, verlies)` — opgelost × (1 + verlies)
- `barToPsi(bar)` — eenheidsconversie
- `defaultCarbVols(stijl)` — pre-fill via `CARB_DEFAULT_VOLS` lookup

### i18n (nl/en/de/fr/es)
- Nieuw: 41 `carb_*`-sleutels (titel, methode, doel, indicatorlabels,
  status, knoppen, bevestigingsdialogen).

## [1.8.61] — 2026-04-14

### Added — Voorraad per locatie + locatie-keuze bij picken
- **ProductenPage**: elke afvulling toont nu per locatie hoeveel er beschikbaar
  is (bv. `AGP: 20×`, `Magazijn: 10×`) als pills onder de regel. Voorraad in AGP
  krijgt een paarse badge, voorraad buiten AGP een blauwe.
- **Picking modal (BestellingenPage)**: bij elke pick-regel verschijnt een
  locatie-dropdown waarin de gebruiker kan kiezen uit welke voorraad-locatie
  het bier gepakt wordt. De opties tonen de huidige beschikbare hoeveelheid
  per locatie. "Automatisch" laat het systeem zelf kiezen (niet-AGP eerst,
  dan AGP) — bestaand gedrag.
- **Validatie**: bij het opslaan van picks wordt gecontroleerd of de gekozen
  locatie voldoende voorraad heeft; anders foutmelding met locatie-naam.
- **`BestellingPick.bron_locatie_id`**: nieuw optioneel veld; bij order
  afronden wordt de `Uitlevering` met deze locatie aangemaakt (accijns wordt
  alleen geboekt als de gekozen locatie AGP is).

### i18n (nl/en/de/fr/es)
- Nieuw: `picking_bron_locatie`, `picking_locatie_auto`,
  `err_locatie_voorraad_ontoereikend`, `lbl_agp_voorraad`,
  `lbl_niet_agp_voorraad`.

---

## [1.8.60] — 2026-04-14

### Changed — "Uitslaan" terminologie opschonen
Volledige rename van de verkoop-entiteit naar `Uitlevering` conform de AGP-definitie:
"Uitslaan = bier uit de AGP halen" (via uitlevering óf verplaatsing AGP → niet-AGP).

- **Datamodel**: `Uitslag` → `Uitlevering`, `TypeUitslag` → `TypeUitlevering` met nieuwe
  waarde `'intern'`. `AccijnsRecord.uitslag_id` → `uitlevering_id`,
  `bron: 'uitslag'` → `'uitlevering'`. `EADDocument.uitslag_id` → `uitlevering_id`.
- **Afboeking**: reden `'intern_gebruik'` verwijderd — verhuisd naar de
  uitlevering-flow mét accijnsboeking (`type_uitlevering = 'intern'`).
- **AgpPage**: bij AGP → niet-AGP verplaatsing wordt nu ook een `voorraad_log`
  entry met type `'uitslaan'` aangemaakt (dit is óók AGP-exit).
- **VoorraadPage**: misleidende instructie "Sla bier uit via de Batches pagina"
  verwijderd uit de leegstaat.
- **UI-labels**: "Uitgeslagen" → **"Uitgeleverd"** in verkoopcontext
  (ProductenPage-tegel, VoorraadPage, BatchesPage, AfvullenPage, DashboardPage).
  AGP-context behoudt terecht "Uitslag/Uitgeslagen voorraad".
- **Backup (Excel)**: sheet `Uitslagen` → `Uitleveringen`, met fallback-migratie
  voor oude backups.
- **Data-migratie**: one-shot bij app-load — oude `uitslagen`-sleutel wordt
  omgezet naar `uitleveringen`, `AccijnsRecord`-velden worden hernoemd, en
  `intern_gebruik`-afboekingen worden geconverteerd naar uitleveringen mét
  accijnsboeking. Beveiligd met een localStorage-flag `brewadmin_migrated_uitlevering_v1`.

### i18n (nl/en/de/fr/es)
- Nieuw: `lbl_product_uitgeleverd`, `voorraad_uitgeleverd`, `batch_stat_uitgeleverd`,
  `filling_summary_uitgeleverd`, `stock_date_uitgeleverd`, `stock_no_uitgeleverd`,
  `lbl_units_uitgeleverd`, `lbl_type_uitlevering`, `ead_gekoppelde_uitlevering`,
  `type_uitlevering_intern`.
- `stock_no_uitgeleverd` bevat geen verwijzing meer naar de Batches-pagina.
- `stock_archive_count` gebruikt nu "gearchiveerd" i.p.v. "uitgeslagen".

---

## [1.8.59] — 2026-04-14

### Added — Voorraad per locatie zichtbaar bij picken + uitgeslagen-tegel
- **Picking modal**: per afvulling-optie wordt nu de voorraadverdeling per locatie
  getoond (bv. "AGP: 20, Magazijn: 10"). Per reeds toegevoegde pick-regel
  verschijnt onder de regel een kleine info-tekst met de huidige verdeling.
- **ProductenPage**: extra KPI-tegel "Uitgeslagen" naast Beschikbare voorraad,
  toont totaal aantal uitgeslagen eenheden per product.
- Nieuwe helper `voorraadPerLocLabel(a)` in `BestellingenPage` die compact
  voorraad per locatie weergeeft.

### Changed — Naamswijziging "Voorraad buiten AGP" → "Uitgeslagen voorraad"
- Sectie-titel op AGP-pagina hernoemd in alle 5 talen
- Bijbehorende empty-state melding aangepast

### i18n
- Nieuw: `lbl_product_uitgeslagen`, `picking_voorraad_per_locatie` in
  nl/en/de/fr/es

---

## [1.8.58] — 2026-04-14

### Added — Historische gemiddelden op AGP-tegels
- Nieuwe tegel "Totale accijnswaarde AGP" (verpakt + tank)
- Onder elke accijnstegel staan nu kleine subregels met:
  - Gemiddelde waarde van vorige maand
  - Gemiddelde waarde van dit jaar
  - In januari ook het gemiddelde van vorig jaar (omdat dit jaar nog kort is)
- Tegellabels expliciet voorzien van "in AGP" / "(AGP)" zodat duidelijk
  is dat de waarden over de accijnsgoederenplaats gaan
- Nieuwe helpers `agpValueAt(datum,...)` en `gemAgpInPeriode(start,end,...)`
  in `calculations.ts` die de AGP-waarde reconstrueren uit historische
  events (afvullingen, uitslagen, verplaatsingen, afboekingen)

---

## [1.8.57] — 2026-04-14

### Changed — AGP als top-level menu + correctie tank-statussen
- AGP-overzicht verplaatst van Accijns-tab naar eigen pagina in hoofdmenu (`AgpPage`)
- TANK_STATUSSEN gecorrigeerd: `Vergisten` (i.p.v. `Gisten`) — tanks met bier in vergisting waren onzichtbaar
- Afvulling-veldnamen genormaliseerd: gebruikt nu `hoeveelheid`/`inhoud_per_eenheid` met fallback op `aantal`/`inhoud_liter` — verpakte voorraad werd niet getoond

---

## [1.8.56] — 2026-04-14

### Added — AGP-inzicht & verplaats-flow
- Nieuw `Locatie`-model met `is_agp`-vlag; standaardlocatie "AGP" wordt automatisch geseed
- Nieuw `Verplaatsing`-model voor stockmutaties tussen locaties (met automatische accijnsboeking bij vertrek uit AGP)
- Nieuw tabblad **AGP** in Accijns-pagina toont voorraad en accijnswaarde van bier in tank (geschat ABV uit OG) en verpakt
- Verplaats-modal: stock buiten AGP halen → genereert AccijnsRecord met bron `'verplaatsing'`
- Locatiebeheer-modal: locaties toevoegen, hernoemen, verwijderen (AGP beschermd)
- Verkoop-flow splitst pick per locatie: niet-AGP eerst (geen extra accijns), AGP-deel boekt accijns
- `Uitslag.bron_locatie_id`, `AccijnsRecord.bron`/`verplaatsing_id`, `BestellingPick.uitslag_ids/accijns_ids` toegevoegd
- Locaties + verplaatsingen meegenomen in Excel backup/restore

---

## [1.8.55] — 2026-04-14

### Fixed — Accijns pagina crash
- `getGn(a.batch_id)` → `getGnForRecord(a)` — niet-bestaande functie veroorzaakte runtime error

---

## [1.8.54] — 2026-04-14

### Changed — Inkoop factuur modal
- Label "Aankoopdatum" hernoemd naar "Factuurdatum" in het inkoop factuur formulier
- Bij een betaalde factuur wordt bovenin de modal "Betaald op: [datum]" getoond
- Betaaldatum wordt ook opgehaald uit eerder gekoppelde bankmutaties (bankTransacties + bankKoppelingen fallback)

---

## [1.8.52] — 2026-04-14

### Added — CCP Monitoring in batch detail
- **CCP-sectie** bij de hygiëne-checklist in de batch-detailweergave
- Snel CCP-metingen registreren per batch met dropdown, waarde, datum en uitvoerder
- Automatische limiet-check met visuele groen/rood indicator
- Bij afwijking wordt automatisch een CAPA aangemaakt
- Metingenlog met status per batch
- Badge toont aantal metingen en eventuele afwijkingen

---

## [1.8.51] — 2026-04-13

### Added — NVWA/HACCP Compliance pagina
- **Nieuwe HACCP-pagina** met 9 tabs: Dashboard, Schoonmaak, CCP Monitoring,
  Allergenen, Traceerbaarheid, CAPA, Waterkwaliteit, Ongedierte, Opleidingen
- **Schoonmaakschema**: Definieer terugkerende schoonmaaktaken (dagelijks/wekelijks/
  maandelijks/per batch) met logboek en achterstallig-indicator
- **CCP Monitoring**: Definieer Critical Control Points met grenswaarden, registreer
  metingen per batch. Automatische CAPA-aanmaak bij afwijkingen
- **Allergenenbeheer**: Allergeenmatrix op ingrediënten met automatische per-batch
  allergeendeclaratie afgeleid uit batch-ingrediënten
- **Traceerbaarheidstool**: Trace forward (lot → batch → verpakking → klant) en
  backward (batch → lot → leverancier) met mock recall rapportgenerator
- **CAPA**: Corrigerende acties registratie met statusworkflow (open → in behandeling → afgerond)
- **Waterkwaliteit**: Testregistratie met pH, hardheid, chloor en waarschuwing bij >6 maanden
- **Ongediertebestrijding**: Controle- en waarnemingslogboek
- **Opleidingen**: Medewerkersopleidingen met geldigheid en verloopwaarschuwing
- **Dashboard**: Compliance-overzicht met kleurgecodeerde statuscards
- **8 nieuwe data keys** voor HACCP-registraties (haccp_schoonmaak_taken, etc.)
- **Excel backup**: Alle HACCP-data meegenomen in export/import
- **i18n**: Alle 5 talen (NL/EN/DE/FR/ES) voorzien van ~120 HACCP-sleutels
- **Allergeen-veld** toegevoegd aan Ingredient type (gluten, gerst, tarwe, etc.)

---

## [1.8.50] — 2026-04-13

### Added — Hygiëne groepen hernoembaar in instellingen
- **Inline hernoemen**: Klik op een groepsnaam in Instellingen → Hygiëne om deze
  te hernoemen. Enter bevestigt, Escape annuleert. Duplicaatnamen worden geblokkeerd.

---

## [1.8.49] — 2026-04-13

### Fixed — Lot-informatie verdwenen door Brewfather-eigenschappen
- **Layout fix**: Het Brewfather-properties blok was een apart flex-item in de
  desktop layout waardoor de lots tabel weggedrukt werd. Nu zitten de lots card
  en het Brewfather blok samen in één `flex-1` wrapper zodat ze verticaal
  gestapeld worden.

---

## [1.8.48] — 2026-04-13

### Added — Filter "Alleen op voorraad" op ingrediëntenpagina
- **Checkbox**: Boven de ingrediëntenlijst staat nu een vinkbox "Alleen op voorraad"
  die ingrediënten zonder voorraad verbergt. Instelling wordt onthouden via `useStore`.

---

## [1.8.47] — 2026-04-13

### Enhanced — Alle Brewfather ingrediënt-eigenschappen ophalen
- **Complete data**: Brewfather ingrediënt sync haalt nu alle beschikbare
  eigenschappen op (`complete=true`): alfazuur, kleur, rendement, vergistingsgraad,
  temperatuurbereik, uitvlokking, herkomst, etc.
- **bf_props veld**: Extra Brewfather-eigenschappen worden opgeslagen in `bf_props`
  op het Ingredient object (behalve voorraad, THT en productiedatum).
- **Detail weergave**: Bij het selecteren van een ingrediënt worden alle
  Brewfather-eigenschappen getoond in een compact grid onder de lots tabel.
- **i18n**: Labels voor 30+ Brewfather-veldnamen in alle 5 talen.

---

## [1.8.46] — 2026-04-13

### Fixed — Gist afboeken eenheidsconversie (stuk/stuks/pkg)
- **Bug fix**: Bij het afboeken van gist in een batch kwam de foutmelding
  "Kan stuk niet omrekenen naar stuks". De eenheden `stuk`, `stuks` en `pkg`
  zijn nu als equivalente count-eenheden geregistreerd in `UNIT_BASE`.
- **Data fix**: Brewfather batch import gebruikte `'stuk'` als eenheid voor
  gist, gewijzigd naar `'stuks'` (de standaard eenheid in de app).

---

## [1.8.45] — 2026-04-13

### Added — Brewfather ingrediënten import + voorraad push
- **Ingrediënten sync**: Nieuwe "Sync Brewfather" knop op de ingrediëntenpagina
  importeert alle ingrediënten (fermentables, hops, yeasts, miscs) vanuit
  Brewfather's inventory API. Deduplicatie op `brewfather_id` of naam.
- **Type mapping**: Brewfather fermentable subtypes worden correct gemapt
  (Grain/Extract → Mout, Sugar/Honey → Suiker, Adjunct/Juice → Overig).
- **Voorraad push**: Per ingrediënt met Brewfather-koppeling kan de totale
  voorraad gepusht worden naar Brewfather via PATCH API.
- **Server PATCH proxy**: Nieuwe `_bf_proxy_patch()` route in server.py
  voor write-operaties naar de Brewfather API.

---

## [1.8.44] — 2026-04-13

### Fixed — Kostensoort in inkoop popup op ingrediëntenpagina
- **Bug fix**: De kostensoort-dropdown in de inkoop boeken popup op de ingrediëntenpagina
  gebruikte altijd de standaard kostensoorten in plaats van de aangepaste instellingen.
  De `kostenSoorten` prop wordt nu correct doorgegeven van App → IngredientenPage → InkoopFactuurModal.

---

## [1.8.43] — 2026-04-13

### Added — HA User Login Tracking & Audit Trail Gebruiker
- **Login-tracking**: Bij het openen van de app wordt automatisch gedetecteerd
  welke Home Assistant gebruiker ingelogd is (via `window.__hass.user`).
  Er wordt een audit trail entry aangemaakt met actie "Ingelogd" (met 5-min dedup).
- **Automatische gebruiker in audit trail**: Alle bestaande audit entries krijgen
  nu automatisch de naam van de ingelogde HA-gebruiker mee via `setAuditUser()`.
- **Gebruiker-kolom in audit trail**: De audit trail tabel in Instellingen toont
  nu een "Gebruiker" kolom zodat zichtbaar is wie elke actie heeft uitgevoerd.
- **HAUser type**: Nieuw `HAUser` interface (id, name, is_admin, is_owner) als
  voorbereiding op toekomstig accountbeheer en restricties.
- **i18n**: Nieuwe vertaalsleutels voor login-tracking in alle 5 talen.

## [1.8.42] — 2026-04-13

### Added — Hygiëne checklist in audit trail
- **BatchesPage**: Elk afvinken/ongedaan maken van een hygiëne-item per batch
  wordt nu gelogd in de audit trail, inclusief groep- en itemnaam.
- Ook de "checklist reset" actie wordt gelogd.

## [1.8.41] — 2026-04-13

### Fixed — Build error: esbuild `as` casts in parameter defaults
- Verwijderd `as any[]` / `as any` type casts uit destructured parameter defaults
  in 7 pagina-bestanden. Esbuild ondersteunt deze syntax niet in default values.

## [1.8.40] — 2026-04-13

### Added — Uitgebreide audit trail logging
- **Alle pagina's** loggen nu mutaties naar de audit trail via `logAudit()`:
  - BatchesPage (11): status, tank, aanmaken, bewerken, afvullen, metingen
  - IngredientenPage (21): ingrediënt/lot CRUD, correcties, afboeken, ontvangst
  - InstellingenPage (31): tanks, credentials, thema, taal, accijns, BTW, hygiëne, ingTypes
  - BoekhoudingPage (22): in-/verkoopfacturen, klanten, bankkoppelingen, kapitaal
  - ProductenPage (9): producten, artikelen, WooCommerce sync
  - BestellingenPage (9): orders, picks, afronden, annuleren, vrije regels
  - AccijnsPage (5): aangifte status, maand betaald, e-AD documenten
  - StatiegeldPage (3): verpakkingen, creditnota's
  - InventarisatiePage (3): inventarisaties aanmaken/afronden
  - DashboardPage (2): gistmetingen
  - ReceptenPage (2): Brewfather sync
- **118 logAudit calls** in totaal, waardoor elke data-mutatie in de app
  wordt vastgelegd met entiteit, actie, omschrijving en timestamp.

## [1.8.39] — 2026-04-13

### Fixed — Race condition HA gist_metingen sync
- **api.ts**: `useStore` retourneert nu een derde `refresh()`-functie die
  server-data ophaalt en lokaal bijwerkt **zonder** terug te posten naar de
  server. Voorkomt dat de periodieke sync lokale wijzigingen overschrijft.
- **App.tsx**: HA gist_metingen periodic sync gebruikt nu `refresh()` in
  plaats van de save-functie. Dit voorkomt de race condition waarbij net
  toegevoegde metingen werden overschreven met verouderde server-data.

## [1.8.38] — 2026-04-13

### Fixed — Brewfather sync overschrijft handmatige status niet meer
- **App.tsx / BatchesPage.tsx**: Brewfather sync kan batchstatus alleen nog
  *vooruit* zetten in de lifecycle (Gepland→Brouwen→Vergisten→Conditioneren→
  Verpakt→Gesloten), niet meer achteruit. Voorkomt dat handmatige statuswijzigingen
  (bijv. "Conditioneren") worden teruggedraaid naar een eerdere Brewfather-status
  (bijv. "Vergisten").
- **api.ts**: `_syncErrors` reset verplaatst naar na `r.ok` check, zodat
  foutstatussen niet gemaskeerd worden.

## [1.8.37] — 2026-04-13

### Fixed — Caching-problemen opgelost
- **server.py**: `Cache-Control: no-store` header toegevoegd aan alle API-responses,
  `Cache-Control: no-cache, must-revalidate` aan de SPA HTML-response. Voorkomt
  dat browsers verouderde data of een oude app-versie serveren.
- **api.ts**: `modified` flag in `useStore` reset nu na succesvolle server-sync,
  zodat server-updates niet permanent genegeerd worden na een lokale wijziging.
- **api.ts**: `_syncErrors` teller reset naar 0 bij succesvolle sync, zodat de
  sync-indicator (SyncDot) niet permanent op fout blijft staan na een tijdelijke
  netwerkstoring.
- **api.ts**: `Cache-Control: no-cache` header toegevoegd aan fetch-calls om
  browser-caching van API-requests te voorkomen.

## [1.8.36] — 2026-04-13

### Fixed — Dubbel puntje gistgrafiek header
- **BatchesPage**: Groen pulserend bolletje vervangt nu de ▶ chevron bij actieve
  vergisting, zodat er geen twee puntjes naast elkaar staan.

## [1.8.35] — 2026-04-13

### Changed — Alleen handmatige metingen tellen in header
- **BatchesPage**: Aantal metingen in gistgrafiek header telt alleen handmatige
  metingen, niet de automatische.

## [1.8.34] — 2026-04-13

### Fixed — Actief-bolletje gistgrafiek header
- **BatchesPage**: Pulserend groen bolletje terug bij "Actief" indicator in de
  gistgrafiek header (was verloren gegaan bij t-hdr omzetting).

## [1.8.33] — 2026-04-13

### Changed — Automatische metingen zonder punten in grafiek
- **BatchesPage**: Automatische metingen (server-side) tonen alleen de lijn in de
  gistgrafiek, geen puntjes. Handmatige metingen behouden hun punten.

## [1.8.32] — 2026-04-13

### Changed — Server-side automatische gistingsmetingen
- **server.py**: Automatische 10-minuut temperatuurmetingen draaien nu server-side
  in een achtergrondthread, onafhankelijk van of de app open is in de browser.
- **App.tsx**: Client-side auto-fetch verwijderd; periodieke sync (5 min) haalt
  server-side metingen op zodat ze zichtbaar worden in de UI.

## [1.8.31] — 2026-04-13

### Fixed — Vergistingsgrafiek header kleurstelling
- **BatchesPage**: Header van de gistgrafiek gebruikt nu `t-hdr` themastyling
  (was `bg-gray-50` grijs) met `→` pijl, consistent met alle andere secties.

## [1.8.30] — 2026-04-13

### Added — Product & SKU selectie bij afvullen
- **BatchesPage**: Verplicht productveld toegevoegd aan het afvulformulier. Een
  batch kan nu naar verschillende producten afgevuld worden.
- **BatchesPage**: Automatische SKU-weergave op basis van product + verpakking
  combinatie. Als geen SKU bestaat, kan deze inline worden aangemaakt.
- **BatchesPage**: Inline nieuw product aanmaken via simpel naamveld.
- **BatchesPage**: Product- en SKU-kolom toegevoegd aan afgevulde voorraad-tabel.
- **ProductenPage**: Voorraadberekening prefereert nu `afvulling.product_id`
  boven `batch.product_id` voor nauwkeurigere productkoppeling.
- **BestellingenPage**: Picking-logica uitgebreid met `afvulling.product_id`.
- **Types**: `product_id` en `artikel_sku` toegevoegd aan Afvulling interface.

## [1.8.29] — 2026-04-12

### Changed — Tank in batch header
- **BatchesPage**: Huidige tank wordt getoond in de batch header (naast
  batchnummer/stijl) met een icoontje (🫙 fermentatie, 🛢 barrel). Alleen
  zichtbaar als de batch actief in een tank zit (status Vergisten/Conditioneren).

## [1.8.28] — 2026-04-12

### Improved — Batch info UI responsive + gistingsvoortgang
- **BatchesPage**: Header-knoppen wrappen nu op mobiel (status dropdown
  full-width, compactere knoppen).
- **BatchesPage**: Gistingsvoortgangsbalk (SG progress) is nu zichtbaar in de
  batch-detailweergave, identiek aan het dashboard — altijd zichtbaar boven de
  inklapbare info-sectie.
- **BatchesPage**: Batch info-sectie is standaard ingeklapt.
- **BatchesPage**: Kostenoverzicht grid is responsive (1 kolom op mobiel,
  2 kolommen op tablet+).

## [1.8.27] — 2026-04-12

### Fixed — Vergistingsprofiel duur uit Brewfather
- **api.ts**: `bfGetRecipes()` gebruikte `actualTime` (unix-ms-timestamp) als
  fallback voor `stepTime` — hierdoor werden vergistingsstappen weergegeven als
  bijv. 1775858400000 dagen i.p.v. 14 dagen. Fallback verwijderd.
- **App.tsx / BatchesPage.tsx**: Bij Brewfather-sync wordt het vergistings- en
  maischprofiel nu ook bijgewerkt voor reeds geïmporteerde batches.
- **App.tsx**: Eénmalige data-sanitizer die bij het laden corrupte `tijd`-waarden
  (>365) in bestaande batches herstelt.

## [1.8.26] — 2026-04-11

### Changed — Barrel cradle en bunghole
- **DashboardPage**: `BarrelVisual` heeft nu een compactere, gebogen
  cradle die met dezelfde straal als het vat meeloopt — de bovenkant van
  de wieg volgt de onderkant van de cirkel in plaats van een plat
  trapezium eronder. De cradle is zo'n 2/3e lager dan voorheen.
- **DashboardPage**: de bunghole zit nu als een ellips bovenop het vat
  (op de top van de cirkel) in plaats van op de voorkant, wat het
  perspectief vanaf de voorkant natuurlijker maakt.

## [1.8.25] — 2026-04-11

### Changed — Barrel vanaf de voorkant
- **DashboardPage**: `BarrelVisual` is opnieuw getekend als een ronde
  kopkant gezien vanaf de voorkant — een cirkel met een donkere metalen
  hoepel eromheen, houten duig-naden binnen de kopkant, en een bunghole
  bovenin. De vloeistof vult het vat als een horizontale chord door de
  cirkel. Een trapezoidale houten wieg houdt het ronde vat vast.

## [1.8.24] — 2026-04-11

### Added — Tank-geschiedenis per batch
- **BatchesPage**: nieuwe sectie "Tank geschiedenis" in het batch-info
  blok toont alle tanks waarin de batch heeft gezeten, gestapeld van oud
  naar nieuw. De onderste regel is de huidige tank en telt dagen vanaf
  het moment van verplaatsen (start dus op 0).
- **Batch-interface**: nieuw veld `tank_historie` met entries
  `{tank, from, to?, status}`. `handleMoveTank` en het bewerken van de
  tank via het edit-formulier werken de historie automatisch bij.
  Legacy-batches zonder historie krijgen een gesynthetiseerde eerste
  entry op basis van `batch.datum` + `batch.tank`.
- **DashboardPage**: het "X dagen in tank"-label op de tankkaart gebruikt
  nu de tijd sinds de laatste verplaatsing in plaats van de brouwdatum —
  direct na een move staat de teller op 0.

### Fixed — Brewfather vergistingsprofiel in batches
- `bfMapBatch` in `utils/api.ts` las `s.actualTime` (een unix
  ms-timestamp, bijv. `1775858400000`) als de geplande duur in dagen,
  waardoor het vergistingsprofiel op de batchpagina absurd hoge waarden
  toonde. Nu wordt `s.stepTime` gebruikt — dezelfde bron als de
  recept-mapping — zodat de waarden overeenkomen met wat in het recept
  staat (bijv. 14 d, 2 d).

## [1.8.23] — 2026-04-11

### Fixed — Dashboard tankvormen
- **Bright tank**: de poten zijn nu recht in plaats van licht naar buiten
  hellend, matching de stijl van de fermentor.
- **Barrel**: het houten vat ligt nu horizontaal op een cradle met twee
  driehoekige steunen in plaats van rechtop te staan. De metalen hoepels
  zijn herschikt als verticale banden, de duigen lopen horizontaal langs
  de lengte van het vat, en de bunghole zit bovenop.

## [1.8.22] — 2026-04-11

### Added — Bright tanks, barrels en verplaatsen tussen tanks
- **Tank-instellingen**: elke tank krijgt een soort (`fermentatie`,
  `bright` of `barrel`). Bij het toevoegen kies je de soort en bestaande
  tanks kunnen achteraf omgeschakeld worden via een dropdown.
- **Batch verplaatsen**: in de batch-header verschijnt een
  `↪ Verplaatsen`-knop wanneer de batch in status *Vergisten* of
  *Conditioneren* staat. De inline picker toont alle beschikbare tanks
  (inclusief de soort) en respecteert tank-bezetting. Bij verplaatsen
  van een fermentatietank naar een bright tank of barrel wisselt de
  batch automatisch naar *Conditioneren*. De verplaatsing wordt
  gelogd onder `gewijzigd`.
- **Dashboard**: bright tanks krijgen een rechtopstaande drukketel met
  twee koepels en een drukmeter; barrels worden weergegeven als houten
  vat met duigen en metalen hoepels. Fermentatietanks behouden de
  bestaande conische vorm.

## [1.8.21] — 2026-04-11

### Fixed — Hygiëne-instellingen
- **InstellingenPage**: hygiënegroepen worden nu opgeslagen met het juiste
  veld `naam` (i.p.v. `label`), waardoor toevoegen, weergeven en verwijderen
  van groepen weer correct werkt. De duplicaat-check leest eveneens uit
  `naam`. Nieuwe groepen en items krijgen automatisch een `volgorde`-veld,
  consistent met de defaults.
- **BatchesPage** hygiëne-checklist: groepskoppen en log-referenties tonen
  nu `group.naam` in plaats van het niet-bestaande `group.label`, zodat
  groepsnamen niet meer als `undefined` verschijnen.

## [1.8.20] — 2026-04-09

### Fixed — Productnaam in Voorraadverloop
- **VoorraadverloopPage** toont nu de productnaam (via `product_id`) in plaats van de batchnaam in het gereed product-overzicht. Fallback op `biernaam` en `naam` als er geen product gekoppeld is.

## [1.8.19] — 2026-04-09

### Fixed — Uniforme paginaheaders
- **ProductenPage**: header gebruikt nu standaard `h2 text-gray-800` i.p.v. accentkleur `h1`.
- **VoorraadverloopPage**: paginatitel toegevoegd (ontbrak).
- **InventarisatiePage**: font aangepast naar `text-xl font-bold` (was `text-lg font-semibold`).

## [1.8.18] — 2026-04-09

### Changed — Administratie-menu
- **Administratie-dropdown** toegevoegd met Boekhouding, Inventarisatie, Voorraadverloop en Statiegeld als sub-items.
- **Voorraadverloop** pagina nu bereikbaar via navigatie (was eerder niet gerouteerd).
- **Dropdown-logica gegeneraliseerd** — meerdere dropdown-menu's ondersteunen via dezelfde code.

## [1.8.17] — 2026-04-09

### Changed — Navigatie herstructurering
- **Brouwerij-menu** toegevoegd als dropdown met Ingrediënten, Recepten en Batches als sub-items.
- **Navigatie vereenvoudigd** — minder items op het hoogste niveau, logische groepering van brouwerij-gerelateerde pagina's.

## [1.8.16] — 2026-04-09

### Changed — BierVoorraadPage samengevoegd met ProductenPage
- **BierVoorraadPage verwijderd** — voorraadoverzicht, afboeken en logboek zijn nu geïntegreerd in de Producten-pagina.
- **Logboek** met voorraadmutaties (afvullen, uitslaan, afboeken) en WooCommerce sync-log toegevoegd aan ProductenPage.
- **WooCommerce push** knop verplaatst naar de Producten-pagina.
- **Navigatie vereenvoudigd** — "Voorraad" menu-item verwijderd.

## [1.8.15] — 2026-04-09

### Fixed — Picking en kostensoorten
- **Picking-bug opgelost** — orders met verpakkingstype uit productArtikelen ("fles") matchen nu correct met afvullingen die het oude naam-formaat gebruiken ("Fles 33cL") via de verpakkingen-store.
- **GN-code selector** op artikelniveau met beheerbare codes in Instellingen.
- **BTW incl/excl toggle** op verkoopprijs en B2B-prijs bij productartikelen.
- **B2B-prijs** per artikel, met per-orderregel prijstype (Normaal/B2B) bij bestellingen.
- **Verzendkosten** toevoegbaar bij handmatige bestellingen.
- **Negatief afboeken** toegestaan bij voorraadcorrecties.

## [1.8.14] — 2026-04-09

### Changed — Producten-pagina verbeterd
- **ABV, EBC en IBU** toegevoegd als bierkenmerken op het product.
- **Foto upload limiet** verhoogd van 500KB naar 2MB per afbeelding.
- **Voorraad-overzicht geïntegreerd** in productdetailpagina — per verpakkingstype worden afvullingen, gepickt, uitgeslagen, afgeboekt en beschikbaar getoond, inclusief afboekfunctionaliteit.
- **GN-code verwijderd** van Product (blijft op Batch-niveau).

## [1.8.13] — 2026-04-09

### Added — Producten-pagina
- **Product als first-class entiteit** — nieuw concept dat recepten, batches, voorraad en verkoop verbindt.
- **Producten-pagina** — beheer producten met naam, stijl, categorie, productfoto's (max 5), en gekoppelde recepten.
- **Product-artikelen (SKU's)** — per product meerdere verpakkingsvarianten met artikelnummer, EAN, verkoopprijs en BTW%.
- **Kostprijs & marge** — automatische berekening van kostprijs per liter op basis van ingrediënt- en utilitykosten, met marge per SKU.
- **Product-selector in batches** — bij het aanmaken van een batch kan een product worden geselecteerd, waarmee biernaam, stijl en GN-code automatisch worden ingevuld.
- **Automatische migratie** — bestaande biernamen en artikelen worden automatisch omgezet naar Product-entiteiten bij eerste gebruik.
- **WooCommerce-integratie uitgebreid** — voorraadsync en bestellingen werken nu ook met product-artikelen.
- **Excel backup** — producten en product-artikelen worden meegenomen in backup export/import.

## [1.8.12] — 2026-04-09

### Changed — GN-codes bij afvulling + automatische Plato-berekening
- **GN-codes verplaatst naar afvulling** — GN-code wordt nu per afvulling gekozen (niet meer op batch-niveau), omdat het afhankelijk is van het verpakkingsformaat.
- **Nieuwe GN-codes** — 2203 00 01 (kleine verpakking), 2203 00 09 (groot formaat), 2206 (bier-frisdrankmengsel), 2202 91 00 (alcoholvrij bier).
- **Automatische Plato-berekening** — bij het invullen van OG wordt het platogehalte automatisch berekend. Ook bij Brewfather-sync wordt Plato automatisch afgeleid uit OG.

## [1.8.11] — 2026-04-09

### Added — EBC-bierkleur in tankvisualisatie
- **Realistische bierkleur** — de vloeistof in de fermentatietank toont nu de werkelijke bierkleur op basis van de EBC-waarde uit het recept (SRM-kleurtabel, 40 tinten van lichtgeel tot zwart).
- **Fallback** — zonder EBC-waarde valt de kleur terug op blauw (gisting) of amber (conditionering).

## [1.8.10] — 2026-04-09

### Improved — Fermentatietank-visualisatie op dashboard
- **Nieuwe SVG-tank** — de eenvoudige CSS-rechthoek is vervangen door een realistische conische fermentor met cilindervormig lichaam, conische bodem, manway/dome, poten, voetjes en aftapkraan.
- **Metallic gradient** op de tankwand voor een professionele uitstraling.
- **Geanimeerde bubbels** tijdens actieve gisting (status "Vergisten").
- **Vloeistofvulling** met gradient, oppervlaktegolf en percentage-label, geclipped op de tankvorm.

## [1.8.9] — 2026-04-09

### Improved — Security hardening, code cleanup en dode code verwijderd
- **SSRF bescherming** — `_wc_test()` blokkeert nu requests naar private/interne IP-adressen.
- **Error message hardening** — foutmeldingen lekken geen interne details meer naar de client.
- **CSP aangescherpt** — `unsafe-eval` verwijderd uit Content Security Policy.
- **CORS beperkt** — alleen nog `localhost:5173` en `localhost:8099` als trusted origins.
- **Type safety** — 6x `@ts-ignore` in DashboardPage vervangen door correcte `.getTime()` calls.
- **Dode code verwijderd** — ongebruikte `verpKostenLabels` functie verwijderd, `SUPPORTED_LANGS` niet meer geëxporteerd.
- **i18n opgeschoond** — ~236 ongebruikte vertaalsleutels verwijderd uit alle 5 taalbestanden.

## [1.8.8] — 2026-04-09

### Added — Herinnering, 2e herinnering en aanmaning voor verkoopfacturen
- **Vervallen facturen sectie** — boven de factuurlijst verschijnt een rood gemarkeerd blok met alle facturen waarvan de betaaltermijn verstreken is, direct zichtbaar ongeacht datumfilter.
- **Escalatie-actieknoppen** — elke vervallen factuur toont de volgende logische stap: "1e Herinnering" → "2e Herinnering" → "Aanmaning". Klikken genereert direct het PDF-document én past de status aan.
- **Herinnering/aanmaning PDF** — professionele documenten met brouwerijlogo, klantgegevens, factuurreferentie, openstaand bedrag en nieuwe betaaldeadline. Stijl past zich aan op urgentie (oranje/rood).
- **4 statusniveaus** — facturen kunnen nu `open`, `herinnering`, `tweede_herinnering`, `aanmaning` of `betaald` zijn, elk met eigen badge-kleur (oranje → geel → oranje → rood → groen).
- **Dashboard widget** — vervallen facturen verschijnen als aparte widget op het dashboard met een rode teller-badge en overzicht van de eerste 5. Stat card vervangt BTW-openstaand.
- **Datumlogs** — `herinnering_datum`, `tweede_herinnering_datum` en `aanmaning_datum` worden bijgehouden zodat je weet wanneer elke stap is verzonden.
- **Klant factuurhistorie** — ook in de klant-detailweergave zijn de nieuwe statussen en escalatieknoppen zichtbaar.

---

## [1.8.7] — 2026-04-09

### Added — Bijschrift koppelen aan negatieve inkoopfactuur
- **Creditnota leverancier via MT940** — een bijschrift (geld ontvangen) kan nu ook gekoppeld worden aan een inkoopfactuur met negatief totaalbedrag (creditnota). Een tweede dropdown "of creditnota inkoop:" verschijnt automatisch zodra er open negatieve inkoopfacturen bestaan.
- **Auto-matching** — bij het importeren van een MT940-bestand worden bijschriften nu ook automatisch gematcht aan negatieve inkoopfacturen als er geen verkoopfactuur overeenkomt.
- **Wederzijdse uitsluiting** — koppelen aan inkoop wist automatisch de eventuele verkoopkoppeling en vice versa.

---

## [1.8.6] — 2026-04-09

### Fixed — MT940 beginsaldo
- **Beginsaldo correct bij meerdere statements** — bij MT940 bestanden met meerdere bankafschriften werd het beginsaldo overschreven door het beginsaldo van het laatste statement (dat gelijk is aan het eindsaldo van het voorgaande). Nu wordt alleen het eerste beginsaldo bewaard.

---

## [1.8.5] — 2026-04-09

### Fixed — Banktransactie-koppelingen (onthouden)
- **Dropdown toont nu ook betaalde facturen** — als een onthouden koppeling naar een reeds betaalde factuur verwijst, verschijnt deze alsnog in de dropdown
- **Kapitaalstortingen worden nu correct onthouden** — bij herimport van MT940 wordt `gekoppeldKapitaalId` hersteld
- **Knoppen verborgen bij onthouden koppelingen** — "+Nieuwe boeking" en "+Kapitaalstorting" worden niet meer getoond wanneer een boeking al onthouden is
- **Onthouden koppelingen opnieuw koppelen** — ×-knop naast "↩ Onthouden koppeling" badge om een onjuiste koppeling te wissen en opnieuw in te stellen

---

## [1.8.4] — 2026-04-09

### Added — Factuurvelden zichtbaarheid
- **Zichtbare velden op factuur & pakbon** — per veld instellen welke bedrijfsgegevens op facturen en pakbonnen verschijnen (logo, adres, BTW-nr, KvK, IBAN, e-mail, telefoon, betaalblok)
- **Factuurvoorbeeld** — preview-knop in Instellingen → Brouwerij om direct te zien hoe de factuur eruitziet met de huidige instellingen

---

## [1.8.3] — 2026-04-09

### Added — App reset
- **Reset App knop** — alle data wissen en app herstellen naar fabrieksinstellingen via Instellingen → App, met dubbele bevestiging (typ "RESET")

---

## [1.8.2] — 2026-04-09

### Added — Kostensoorten
- **Kostensoorten op inkoopfacturen** — vrije regels op inkoopfacturen krijgen een kostensoort-dropdown (Grondstoffen, Verpakkingsmateriaal, Energie, Huur, Transport, Onderhoud, Marketing, Administratie, Overig)
- **Dynamische Winst & Verlies rapportage** — inkoopkosten worden nu per kostensoort uitgesplitst in plaats van de vaste driedeling ingrediënten/verpakking/overig
- **Aanpasbare kostensoorten** — eigen kostensoorten toevoegen, hernoemen of verwijderen via Instellingen
- **Excel backup** — kostensoorten worden meegenomen in backup export/import

---

## [1.8.1] — 2026-04-09

### Added — AGP-compliance (Accijnsgoederenplaats)
- **e-AD Register** — volledig documentbeheer voor e-AD's, noodprocedures en ontvangstbevestigingen met ARC-nummers, statusverloop (aangemaakt → verzonden → ontvangen → geannuleerd), bestemming, vervoerder en audit trail
- **Voorraadverloop / GPA-rapport** — nieuw tabblad in Boekhouding met per periode (maand/kwartaal/jaar): beginvoorraad + inslagen + productie − uitslagen (binnenland/EU/export) − bijzondere mutaties = eindvoorraad, voor zowel grondstoffen als gereed product; Excel-export
- **Inventarisatiemodule** — eigen pagina voor voorraadtellingen (ingrediënten, bier of volledig); administratieve vs. fysieke voorraad per item, verschilverklaring verplicht, optioneel automatische correcties doorvoeren
- **GN-code en Platogehalte** — beschikbaar op batches en lots; GN-code selecteerbaar uit standaardlijst (2203 00 01/09/10); Platogehalte geïntegreerd in accijnsberekening
- **Type uitslag** — uitslagen registreren nu type (binnenland/intracommunautair/export), bestemming (naam, adres, land), vervoerder en e-AD/ARC-koppeling
- **Accijns-aangifteworkflow** — statusverloop per maand: open → berekend → ingediend → betaald, met datumregistratie per stap
- **Audit trail** — alle wijzigingen aan kritieke entiteiten worden gelogd met tijdstip, entiteit, actie, veldwijzigingen en gebruikersnaam; viewer in Instellingen met filters
- **Geautomatiseerde backups** — dagelijkse server-side backups met AGP-retentiebeleid (dagelijks 30 dagen, wekelijks 1 jaar, maandelijks 7 jaar); backup-overzicht en handmatige trigger in Instellingen
- **Negatieve-voorraadvalidatie** — harde validatie op 4 plaatsen: ingrediëntcorrecties, ingrediëntafboekingen, batchproductie en bestelling-picking
- **Goederenstroomdiagram** — visueel AGP-stroomdiagram in Instellingen (inkoop → opslag → productie → verpakking → opslag → uitslag)
- **Inslag-e-AD koppeling** — lots kunnen nu gelinkt worden aan een ontvangen e-AD via ARC-nummer
- **AGP-instellingen** — AGP-nummer, Douane-nummer en accijns-verantwoordelijke in brouwerijgegevens
- **Versieweergave** — app-versie zichtbaar in Instellingen
- **Stamgegevensvalidatie** — waarschuwing bij ontbrekende GN-code/Platogehalte, duplicaat-preventie ingrediënten
- **Gebruikersidentificatie** — audit trail detecteert HA-gebruikersnaam of valt terug op accijns-verantwoordelijke
- **created_at timestamps** — automatisch op batches, lots, uitslagen en afboekingen

### Changed
- Accijnsberekening ondersteunt nu Plato-tarief naast ABV- en minimum-tarief
- i18n uitgebreid met ~150 keys in alle 5 talen (nl/en/de/fr/es)

---

## [1.7.0] — 2026-03-31

### Added
- **Transactieoverzicht** — nieuw 4e sub-tabblad in Rapporten (Boekhouding) met een chronologisch overzicht van alle inkoop-, verkoop- en accijnsmutaties per dagboek; gefilterd op de ingestelde rapportageperiode; CSV-export en kleurgecodeerde dagboekbadges
- **Alles exporteren als ZIP** — knop in de datumfilter-balk van Rapporten downloadt alle CSV's (W&V, omzet per categorie, inkoop, verkoop, transactieoverzicht) plus HTML-versies van verkoopfacturen en originele inkoop­bijlagen in één ZIP-bestand
- **JSON back-up export/import** — vervangt de Excel import/export in Instellingen → App; exporteert een volledig `brewadmin_backup_YYYY-MM-DD.json` met alle app-data (batches, ingrediënten, lots, recepten, facturen, bestellingen, klanten, instellingen, enz.); importeer een back-upbestand om alle data te herstellen
- **MT940 .swi bestandsformaat** — bankafschriften met de extensie `.swi` (ING/SWIFT) worden nu herkend en geïmporteerd; ook `.940` en `.swift` toegevoegd naast de bestaande `.sta`, `.txt` en `.mt940`
- **PDF bestandsnaam** — gedownloade factuur-PDF's en pakbonnen gebruiken nu het factuur-/pakbonnummer als bestandsnaam in plaats van een timestamp

### Changed
- **Verkoopfacturen als HTML in ZIP** — factuur-HTML kan in de browser worden geopend en via Afdrukken → PDF worden opgeslagen
- Verwijder push-voorraad knop van de VoorraadPage (was duplicaat van WC sync)
- BF JSON-importknop verwijderd van Batches-pagina (Brewfather-sync via API volstaat)
- Losse verkoopfactuur (niet gekoppeld aan bestelling) toegevoegd in Boekhouding

### Fixed
- WC pull-knop kleur gecorrigeerd (bg-purple-600)
- Accijnsrijen in Transactieoverzicht worden alleen getoond bij `betaald = true` (afdracht)
- Diverse responsive verbeteringen op kleine schermen

---

## [1.6.4] — 2026-03-30

### Changed
- **Navigatie volgorde** — Recepten staat nu voor Batches; Voorraad staat voor Bestellingen
- **Logo upload stijl** — App logo gebruikt dezelfde stijl als factuurlogo (gestippelde rand, ✕ overlay knop)
- **Verzendkosten standaard prijs** — Nieuw veld in Instellingen voor een standaard verzendkosten prijs
- **BTW per tarief** verplaatst van inkoop sub-tab naar BTW aangifte pagina (berekend per jaar); inkoop sub-tabs (Facturen / BTW tarief) verwijderd — facturen tabel altijd zichtbaar
- **BTW aangifte invoerhulp** — Rubriek 1a/1b toont nu de totale omzetbelasting voor het geselecteerde jaar (eigen verkoopfacturen + WooCommerce orders)
- **Verkoopfacturen in BTW aangifte** — Waarden worden altijd weergegeven, ook zonder WooCommerce koppeling of eigen facturen in de periode

### Fixed
- Jaar werd naast "Boekhouding" getoond bij BTW aangifte tab — verwijderd
- CSV knop verkoop verplaatst naar het periode-filter bovenaan (consistent met inkoop); koptekst "Eigen verkoopfacturen" verwijderd

---

## [1.6.0]

### Added —
 i18n-translation, Vite/React/TS-migratie, bundled Tailwind, multi-stage Docker build


## [1.5.1]

### Added
- **Invoice scanning with Claude AI** — upload a PDF or image of a purchase invoice and let Claude AI extract the supplier, date, invoice number and all line items (with VAT per line) automatically; a local PDF text-extraction step runs first so no API call is needed for plain-text PDFs
- **PDF viewer in invoice form** — preview the uploaded attachment side by side with the entry form while filling in invoice details
- **Number of units + content per unit** — ingredient lines in the invoice form now support `aantal stuks` × `inhoud per stuk`; this is also extracted during scanning and stored on the invoice record
- **Inline editing of invoice line items** — click any ingredient, packaging or free-form line in the invoice form to edit it in place; no need to remove and re-add
- **BTW toggle (excl / incl)** — each price field in the invoice form has an optional toggle to enter prices including VAT; the exclusive amount is calculated automatically
- **Editable end totals** — the netto, BTW and bruto totals at the bottom of the invoice form can be manually overridden for rounding differences; a recalculate button restores the computed values
- **BTW breakdown per tariff** in the invoice totals section showing the split between 0 %, 9 % and 21 % VAT lines
- **BTW per ingredient type** — default VAT rate can be configured per ingredient type in Settings; automatically pre-filled when adding an ingredient line to an invoice
- **Edit existing purchase invoice** — clicking a row in the Accounting → Inkoop table opens the full invoice form pre-filled with all existing data (supplier, date, line items, attachment); save updates the record in place
- **Ingredient edit & delete** — existing ingredients can be edited (name, type, unit, notes) and deleted directly from the Ingredients page
- **Configurable ingredient types** — add or remove ingredient types (Mout, Hop, Gist, etc.) in Settings; custom types are available throughout the app

### Changed
- **Accounting date filter** defaults to 1 January of the current year instead of the first of the current month, so all invoices for the year are visible immediately
- **Excel import/export** now includes all ingredient and lot fields (lot number, best-before date, price, supplier, invoice number, etc.)
- **Push stock tooltip** no longer states that only stock with paid excise duty is synchronised
- **Collapse/expand arrows** are now consistently positioned on the left throughout the entire app (batch archive, batch info, fill registration, filled stock, archived tags, hidden articles)

### Fixed
- Manually adjusted invoice totals (netto/BTW/bruto overrides) are now correctly saved when booking from both the Ingredients page and the Accounting page
- Modal overlay (blur) now fully covers the sticky navigation bar by rendering via `ReactDOM.createPortal`
- Warning shown in the invoice edit popup when stock movements will not be reprocessed

---

## [1.5.0]

### Added
- **Boekhouding (Accounting) page** — new navigation item and module for purchase invoice management
- **Purchase invoice attachments** — upload PDF or image files (JPG, PNG, WEBP, GIF, TIFF, BMP, HEIC) to individual invoices; download all attachments for a given year as a ZIP
- **Packaging components** — define and manage individual packaging components (bottle, cap, label, etc.) with type, cost per unit and available quantity; assign components with qty-per-unit to packaging types
- **Excise duty declaration view** — grouped month view with month totals, rate per litre display, one-click mark-all-paid per month and collapse/expand per month
- **App branding settings** — customise the app name shown in the navigation bar alongside the logo
- Separate **Webshop** tab in Settings sidebar for WooCommerce configuration
- New server endpoints: `POST /api/upload/<filename>`, `GET /api/file/<filename>`, `POST /api/delete_upload/<filename>`, `GET /api/download_bijlagen/<year>`

### Changed
- Settings → Logo section renamed to **Branding**; now also exposes the app-name field
- Settings sidebar split: WooCommerce moved to its own **Webshop** tab, separate from **Brewery**

---

## [1.4.0]

### Added
- Colour theme system: six themes (Amber, Green, Blue, Slate, Red, Purple) — select in Settings → Appearance
- Subtle per-theme page background tint applied app-wide for a more cohesive feel
- Beer stock page
- Brewfather sync button always visible on the Batches page (disabled when Brewfather is not configured), consistent with the Recipes page
- Clickable logo in the navigation bar (returns to Dashboard)

### Changed
- Complete UI restyle using modern Tailwind design: cards with shadows, rounded corners, improved spacing
- Navigation renamed: "Brewery Admin" → "Dashboard"
- Default header logo replaced with `logo.png` (brewery logo)
- All section headers, modal headers and card tops now use the active theme colour palette
- All hardcoded amber UI elements replaced with theme-aware CSS variables (`--t-accent`, `--t-light`, `--t-pale`, `--t-text`, `--t-btn`, etc.)
- Ingredient and packaging receiving modals merged into one unified form

### Fixed
- Logo in navigation limited to 36 px height to prevent layout overflow
- Page layout no longer shifts when a scrollbar appears (scrollbar-gutter: stable)
- Responsive server-URL field, colour-theme spelling correction, missing translations

---

## [1.3.1]

### Fixed
- Batch status dropdown in the detail header rendered raw Dutch values instead of the active language — now translated via lookup object
- Dashboard tank status badge rendered raw Dutch status — now translated
- Ingredient type column in the batch ingredient list rendered raw Dutch data keys — now translated
- Status `<Badge>` component translated correctly across all pages (batch list, archive, detail info card)
- Packaging type selectors on Ingredients and Batches pages now show translated labels
- Unit selectors (EENHEDEN) on Ingredients and Batches pages now show translated labels
- Ingredient type selectors (ING_TYPES) on Ingredients and Batches pages now show translated labels
- Brewfather status mapping display translated to active language
- HA server status labels and descriptions translated to active language
- Settings: logo upload button, add-row buttons, Excel import/export, log count/clear, hygiene buttons, excise tariff fields and formula label all translated
- Translation object syntax errors (double commas `,,`) fixed — caused all translations to fall back to raw keys

---

## [1.3.0]

### Added
- Internationalisation (i18n): full UI available in Dutch, English, German, French and Spanish
- Separate language files (`lang/nl.js`, `lang/en.js`, `lang/de.js`, `lang/fr.js`, `lang/es.js`)
- Automatic browser/system language detection on first launch — falls back to English if unsupported
- Language selector in Settings → Language (flag buttons, preference stored persistently)
- Custom excise duty formula: define a free-form JavaScript expression in Settings → Excise Duty
  - Available variables: `liter`, `abv`, `hl` (= liter/100), `r1`, `r2`
  - Formula is validated on save and highlighted inline on error
- Mobile collapsible sidebars on Ingredients, Batches, Packaging and Recipes pages — list hides when an item is selected, "← Back to overview" button appears

### Fixed
- Blank page on startup caused by optional catch binding (`catch {}`) not supported by the Babel standalone version in use — fixed to `catch(e) {}`
- "Invalid Date" shown for last sync timestamp — `fmtD` was incorrectly used for full ISO timestamps; switched to `fmtTs`
- WooCommerce stock push incorrectly included releases with unpaid excise duty — now uses `filter` + `every` to check all excise records per release (handles duplicate records)
- JSX fragment (`<>`) not closed correctly in BatchesPage and AfvullenPage after mobile refactor, causing parse errors

---

## [1.2.5]

### Added
- WooCommerce integration: automatically update stock in the webshop on release
- Manual bidirectional sync on the Stock page (↕ WC Sync button): pulls sales from WooCommerce and distributes the difference FIFO across releases
- WooCommerce API settings in Settings (URL, Consumer Key, Consumer Secret, enabled toggle, connection test)
- Hygiene checklist per batch: configurable items with group structure (Preparation, Brewing, Filling, etc.)
- Hygiene check-off actions are now recorded in the batch log

---

## [1.2.0]

### Added
- Article master data per beer + packaging type (SKU, EAN, selling price, VAT)
- Red indicator in released stock for unpaid excise duty
- Tank cards on dashboard enlarged for better readability of status labels
- Brewfather sync extended: brewhouse and mash efficiency, pH values, notes
- Collapsible "Batch info" section on the batches page
- Log now shows all changed fields on batch edits

### Changed
- Excise duty is now tracked per release (via `uitslag_id`)
- Stock archive is included in totals on the stock page

---

## [1.1.0]

### Added
- Released stock with sales tracking per packaging type
- Excise duty calculation and overview
- Archiving of fully sold releases
- Best-before warnings on the dashboard (expired + within 30/90 days)
- Brewfather recipe synchronisation

### Changed
- Navigation extended with Stock and Excise Duty pages

---

## [1.0.0]

### Initial release
- Batch management (create, edit, status changes)
- Ingredients and lots
- Tank overview and occupancy validation
- Home Assistant ingress support
- Data synchronisation via HA API + localStorage fallback
