# Opzet Productie & Verkoop — BrewAdmin

*Opzet van 7 oktober 2026, op versie 1.12.88. Gebaseerd op een lezing van de
code (BatchFlowPage, ProductieDashboard, PlanningPage, ReceptenPage,
ProductenPage, VerkoopDashboard, KassaPage, BestellingenPage en de utils
erachter) en op de draaiende app met testdata, bekeken op 1440 en 390 px. Elk
voorstel is daarna nagelopen op juistheid en volledigheid. De mockups (bureau en
telefoon) staan op het ontwerpcanvas "Opzet Productie & Verkoop".*

Dit is een opzet, nog geen bouwplan per regel. Hoofdstuk 10 deelt het op in
fases die elk los op te leveren zijn.

**Stand:** gebouwd in 1.12.90 t/m 1.12.96 (fases F1–F13, zie CHANGELOG). Wat
bewust anders is gebouwd of nog openstaat, staat in de CHANGELOG van 1.12.96.
Gluten-normalisatie (hoofdstuk 10, *Later*) is niet gebouwd.

---

## 1. Samenvatting

Het verkoopbare product wordt de draad door Productie en Verkoop. De schil
blijft zoals hij is: drie werkruimtes, Rail en tabs op het bureau, onderbalk en
chips op de telefoon, omslag op 768 px.

De drie vragen, en het antwoord:

1. **De connectie tussen batches, recepten en het verkoopbare product.** De app
   legt de keten zelf: een nieuwe batch krijgt het product van zijn recept, CCP 3
   en het afvullen beginnen bij dat product, en het huidige recept van een
   product is het laatst gebrouwen recept. Overal staat de keten als klikbare
   regel: *Recept › Product* op de batch, product en batches bij het recept, een
   ketenstrook op het product.
2. **Etiket- en websitewaarden aan het einde van de batch.** Eén kaart
   *Etiket & website*: wat op het etiket moet (alcohol met de wettelijke marge,
   allergenen met de Bevat-regel, lotcode en THT) en wat naar de website gaat
   (IBU, EBC, energie in kcal én kJ, ingrediënten). Elk getal heeft een bron en
   staat naast wat nu vastligt. Het etiket bijwerken blijft één bewuste
   handeling, zodat CCP 3 een onafhankelijke controle blijft.
3. **Alleen de recepten die je gebruikt.** Recepten opent op *In gebruik* (in de
   demo 9 van de 140), gegroepeerd per product. Dat wordt afgeleid uit batches en
   producten; je hoeft niets op te ruimen. Dezelfde regel voedt het blad *Wat
   brouw je?* bij een nieuwe batch, dat bij je producten begint.

Er komen geen nieuwe data-keys en server.py verandert niet; alleen velden op
bestaande records.

---

## 2. Wat er nu misgaat

1. **De keten recept › batch › product is nergens zichtbaar of klikbaar.** Een
   tankkaart en de batchkop tonen alleen de batchnaam; het recept zie je alleen
   in fase Gepland, het product in het ingeklapte blok Batchgegevens. Op de
   productpagina zijn recepten platte namen en batchrijen niet aan te klikken,
   en ReceptenPage krijgt de producten niet eens mee.
   *(ProductieDashboard.tsx:283-290; BatchFlowPage.tsx:4187-4198, 2661-2673, 464;
   ProductenPage.tsx:1820-1837, 2263-2270; App.tsx:2325)*
2. **Het product wordt laat en tot drie keer los gekozen.** `maakNieuweBatch`
   zet geen `product_id`, ook niet als het recept aan precies één product hangt.
   Daarna kies je het product in Batchgegevens, opnieuw in CCP 3 (begint leeg en
   toont ook gearchiveerde producten) en opnieuw bij de afvulling. Een product
   dat bij het afvullen ontstaat krijgt alleen een naam; CCP 3 blokkeert dan op
   "etiket onbekend". *(BatchFlowPage.tsx:680-718, 1491-1502, 3306-3330;
   AfvulSessieSectie.tsx:345-353, 1095-1097; haccp.ts:638-643)*
3. **Aan het einde van de batch staan de etiketwaarden nergens bij elkaar.**
   Gereed en het dossier tonen OG en FG (als "1.06" en "1.01"), ABV en liters.
   `ibu_berekend` wordt opgeslagen maar nergens gelezen; de EBC is een kopie van
   het recept die als meting wordt behandeld; kcal is een los tekstveld zonder
   kJ. Allergenen zie je in de batchflow alleen in een open afvulsessie (en op de
   HACCP-pagina achter een keuzelijst), nergens bij het product.
   *(BatchFlowPage.tsx:4133-4157; BrouwdagWizard.tsx:430-431; batchStats.ts:135;
   bierinfo.ts:81; batchRapport.ts:77-89; HACCPPage.tsx:325-340)*
4. **De waarden voor etiket en webshop lopen niet mee met de batches.** ABV,
   IBU, EBC en kcal zijn handmatige productvelden; "afgeleid" in `BIER_VELDEN`
   leest alleen het product zelf. Allergenen staan niet op de productpagina en
   `CRAFTERY_META` kent geen allergeensleutel. *(bierinfo.ts:71-81, 300-325;
   ProductenPage.tsx:1490-1503, 2224-2238; craftery.ts:18-44)*
5. **De ABV wordt twee keer ingetypt en het alcoholvinkje in CCP 3 is blind.**
   In Conditioneren typ je de ABV terwijl OG en FG gemeten zijn (`berekenABV`
   bestaat, geen scherm gebruikt hem); op het product nog eens. Dat getal stuurt
   accijns, THT-klasse, etiket en webshop. *(BatchFlowPage.tsx:242-244;
   calculations.ts:403, 1511; AfvulSessieSectie.tsx:217, 1155-1164)*
6. **De receptkeuze bij een nieuwe batch is een draaiwiel.** Een native select
   met alle Brewfather-recepten, alfabetisch, zonder zoeken, inclusief de
   recepten die je verborg. Het formulier staat onder de vouw van Planning
   (y = 860 bij een scherm van 900; op de telefoon y = 974 bij 844).
   *(BatchFlowPage.tsx:648-651, 2107-2163)*
7. **De receptenlijst verbergt juist wat je zoekt.** De groep "Zonder tag (0)"
   is altijd leeg, dus recepten zonder Brewfather-tag zijn onzichtbaar (ook voor
   zoeken). Een recept met twee tags staat dubbel. Verbergen en tagbeheer zijn
   hover-knoppen: op een aanraakscherm bestaan ze niet. Bij typen in de hoptijd
   verlies je na elke toets de focus. *(ReceptenPage.tsx:431-432, 477-479,
   403-405, 452-465, 175-177)*
8. **Er is geen batchlijst.** Planning is agenda, formulier en archief tegelijk.
   Een batch in Vergisten of Conditioneren zonder (bestaande) tank verdwijnt
   helemaal; de route `batches` bestaat maar rendert niets.
   *(App.tsx:1964-1974, 2327; route.ts:14; ProductieDashboard.tsx:155-157)*
9. **De batch op de telefoon.** De kopbalk heet "Planning", er zijn twee
   terugwegen, de stappenbalk stopt bij "Conditi…", en een koud geopende link
   toont fase 1 in plaats van de actuele fase. *(App.tsx:2264-2268;
   BatchFlowPage.tsx:4194-4196, 522-537)*
10. **De productpagina volgt de keten niet en breekt op de telefoon.** Drie
    knoppen in de kop drukken de naam weg tot "Ha" (en Verwijderen gebruikt
    `confirm()`); de Uitslaan-knop staat wit op wit; de batches staan onderaan
    met daaronder een logboek van álle bieren; drie verschillende kostprijzen per
    liter zonder bron. *(ProductenPage.tsx:1592-1603, 1672-1683, 1336-1338,
    278-279 vs 1098-1099)*
11. **Verkoop ziet niet wat er in de tanks ligt.** Een bier dat met 300 L
    conditioneert staat op "lage voorraad 0" en een bestelling stelt "Markeer als
    merch" voor. Dashboard en productlijst tellen de voorraad verschillend;
    flessen en fusten worden opgeteld tegen een vaste drempel van 12.
    *(VerkoopDashboard.tsx:13, 47-60; ProductenPage.tsx:272-276)*
12. **Kassa en bestellingen zijn niet voor de telefoon gemaakt.** De bon staat
    onder de hele catalogus; acht statusknoppen over drie regels en tot negen
    gelijkwaardige knoppen in een order; de pickmodal noemt het batchnummer
    "Lot", pakbon en picklijst tonen geen lotcode. *(KassaPage.tsx:914-916, 1112;
    BestellingenPage.tsx:2793-2802, 2234-2297, 2615; PakbonExport.tsx:244-247)*

---

## 3. Navigatie en routes

**Productie** — tabs/chips: **Brouwzaal · Batches · Recepten · Ingrediënten ·
HACCP · Gereedschap ▾**
- Brouwzaal = pagina-id `dashboard`, nu als zichtbare eerste tab. De werkruimte-
  titel in de bovenbalk wordt een gewoon label.
- Batches = de bestaande, lege pagina-id `batches`, met een Segment
  *Lopend · Gesloten · Agenda*. Agenda is de huidige brouwagenda met *Behoefte vs
  voorraad*; op de telefoon een lijst per tank. De tab Planning gaat hierin op
  (alias); het archief onderaan Planning wordt *Gesloten*.
- Recepten opent op *In gebruik*.

**Verkoop** — tabs/chips: **Overzicht · Producten · Bestellingen · Kassa ·
Klanten · Statiegeld**
- Overzicht = pagina-id `dashboard` als eerste tab; de drie grote knoppen
  vervallen. "Producten" blijft "Producten" (CCP 3, HACCP en de formulieren
  zeggen ook product). Merch blijft bij Bestellingen.

**Administratie** ongewijzigd.

**Routes** (`utils/route.ts`): `Route` houdt `batchId` en krijgt `recordId?:
string`.
- `#/productie/batches/<batchId>` — de batch, altijd dezelfde pagina (ook vanaf
  een tankkaart).
- `#/productie/recepten/<receptId>` (encodeURIComponent; `decodeURIComponent`
  in een try/catch, zodat een afgekapte link als onbekend geldt).
- `#/verkoop/producten/<productId>` en `#/verkoop/bestellingen/<orderId>`.
- Aliassen: `batchflow` → `batches`; `batchflow/<n>` en `dashboard/<n>` →
  `batches/<n>`; `planning` → `batches` in de stand Agenda.
- `isDetailRoute` = batches met batchId, of recepten/producten/bestellingen met
  recordId.

**Detailscherm op de telefoon**: geen onderbalk en geen chips; de kopbalk toont
de naam ("Kadeblond #2609", "Kadeblond v4", "Kadeblond", "WC-4321") met één
terugknop. Terug = `history.back()` als de vorige entry van de app zelf is
(markering in `history.state`), anders de lijst. `--onderbalk` wordt op een
detailscherm `var(--safe-bottom)`, beperkt tot de telefoonbreedte en met
`body.kb-open` nog steeds 0. Het ⋯-menu staat op de eerste regel van de pagina;
een vaste ActieBalk onderin draagt de volgende stap.

**Bureau**: Recepten en Producten als lijst links en detail rechts (het
recordId selecteert). Een batch en een bestelling vervangen de lijst; de knop
"← Brouwzaal" vervalt.

**Nieuwe batch** is één blad (modal op het bureau, onderblad op de telefoon)
met vijf ingangen: Brouwzaal en Batches ("+ Nieuwe batch"), een vrije tank
(tank ingevuld), "Brouwen" op een recept (recept en product ingevuld) en "Nieuwe
batch" op een product (product en huidig recept ingevuld). Na "Inplannen" opent
de nieuwe batch.

**Navigeren**: één helper `gaNaar({pagina, id?, tab?, filter?})` in App.tsx
vervangt `setNavBatchId` en `openBatchOpBrouwzaal`. Een sprong naar een andere
werkruimte laat Rail en onderbalk meewisselen; terug gaat via de history.

**Tussenbreedtes (768-1279 px)**: de rechterkolom van de Brouwzaal en het
Overzicht schuift onder de hoofdkolom; de etikettabel wordt onder ± 900 px
kaartbreedte de tegelweergave van de telefoon; Brouwsels staat altijd over de
volle breedte; de verbindingsblokken van een recept stapelen onder 1100 px.

---

## 4. De keten

Recept (Brewfather, met versies) › Batch (`recept_id`, `product_id`) ›
Afvulling = lot (lotcode `L<batch>-B<n>`, THT, verpakking, `artikel_sku`) ›
Product › Artikel (SKU en prijs per verpakking) › Voorraad (AGP → uitslaan →
vrij) › Verkoop (kassa, bestelling, webshop).

**Wat de app zelf koppelt**
- Bij het plannen: hangt het recept aan precies één niet-gearchiveerd product
  (via `receptenVanProduct`), dan zet `receptNaarBatch` het `product_id` en
  krijgt de batch de naam van het product. Twee kandidaten: je kiest. Geen: *Nieuw
  product* of *Later*. Producten die uit roulatie zijn tellen mee (een
  seizoensbier wordt juist dan gebrouwen).
- Recepten van een product = `product.recept_ids` ∪ de recepten van zijn
  batches. Afgeleid, er wordt niets weggeschreven.
- Huidig recept van een product = vastgezet, anders het recept van de nieuwste
  batch (ook gepland), anders het enige gekoppelde recept.
- CCP 3 en het afvulformulier beginnen bij `batch.product_id`; de producten van
  het recept staan bovenaan de keuze; gearchiveerde producten vallen eruit.
- Een nieuw product dat bij het afvullen ontstaat, erft naam, stijl en recept,
  maar **geen ABV en geen allergenen**: die zijn etiketgegevens en worden via
  *Etiket bijwerken* vastgelegd.
- Afvulling → artikel via product + verpakking (bestaand); lotcode en THT uit de
  afvulsessie (bestaand). Elke verpakking heeft een eigen sessie, lotcode, CCP 2
  en CCP 3.
- Voorraad per product en per verpakking, "komt eraan" en dekking komen uit één
  telling (`verkoopOverzicht.ts`) die Overzicht, Producten, Kassa en Bestellingen
  delen.

**Wat de gebruiker kiest**: het recept (in *Wat brouw je?*), het product bij
meer of geen kandidaten, tank en brouwdatum, de ABV vastzetten, de allergenen en
versie van het gedrukte etiket, of de webshop wordt bijgewerkt, uitslaan,
recepten vastpinnen of verbergen, en *Koppel aan product* voor een recept dat
nog niet gebrouwen is.

**Waar je doorklikt**
- Batch: in de kop de chips *Recept · Kadeblond v4 ›* en *Product · Kadeblond ›*.
- Recept: *Product · Kadeblond ›*, het blok Gebrouwen (elke batch), *Brouwen*.
- Product: de ketenstrook *Recept › Brouwsels › Etiket › Voorraad › Verkoop*;
  elke brouwselrij en lotcode opent de batch; *Open bestellingen met dit
  product*; *Nieuwe batch*.
- Overzicht: een productregel opent het product (stand Voorraad), *komt eraan
  #2609* opent de batch, een bestelling opent de bestelling.
- Bestelling: de regelnaam opent het product; *Komt eraan: #2609 …* opent de
  batch; na het picken opent de lotcode de batch.

---

## 5. Etiket & website

### 5.1 Waar en wanneer

Component `EtiketKaart` met de modi batch, product en recept. Witte kaart met een
accentrand links, nooit een gevulde kop.

- Gepland t/m Vergisten: geen kaart; één strook in de batchkop ("Doel 6,8 % ·
  22 IBU · 9 EBC · Bevat: gerst, tarwe").
- Conditioneren: bovenaan de fase zodra de FG gemeten is.
- Afvullen: bovenaan, boven de checklist.
- Gereed: bovenaan, alleen-lezen, vóór Financieel resultaat. Ook in het
  batchdossier.
- Product (Verkoop): vergeleken met de *referentiebatch* — de nieuwste batch van
  dit product met een gemeten FG, ook als hij nog conditioneert, anders de laatste
  afgevulde batch.
- Recept: *Etiket verwacht*.

### 5.2 Inhoud

Kolommen: **Waarde · Deze batch (met bron) · Nu vastgelegd · Oordeel**. Twee
blokken: eerst wat wettelijk op het etiket moet, dan wat naar de website gaat.

*Verplicht op het etiket*
1. **Alcohol** — bronketen: vastgezet → ingevoerd (lab) → Brewfather → berekend
   uit OG/FG → verwacht (recept). Altijd "x,x % vol". Oordeel tegen
   `product.abv`: verschil < 0,2 "Klopt"; daarboven maar binnen de marge grijs
   "Wijkt 0,8 af · binnen ±1,0 % vol" (er hoeft niets te gebeuren); buiten de
   marge rood; leeg oranje "Nog niet vastgelegd". Marge (Vo. 1169/2011 bijlage
   XII): ±0,5 % vol als het etiket 5,5 % of minder vermeldt, ±1,0 daarboven;
   liggen etiket en batch aan weerszijden van 5,5, dan geldt (bewust
   conservatief) ±0,5.
2. **Allergenen** — batch: `allergenenUitBatch` (regel → ingredient_id → lot →
   naam); etiket: `product.allergenen`. Oordeel met `vergelijkAllergenen`
   (ongewijzigd). Onder de chips de Bevat-regel van het etiket ("Bevat: gerst"),
   en bij een verschil "Moet worden: Bevat: gerst, tarwe". De graansoort bij
   naam, gluten niet apart; lactose → "melk (lactose)", sulfiet → "sulfieten"
   (pas boven 10 mg/L SO₂ verplicht).
3. **Lotcode & THT per verpakking** — lotcode uit de afvulsessie (vóór de eerste
   sessie "L2609-B1 e.v."); THT: handmatig → `berekenTht(thtKlasse)` → "geen THT
   (≥ 10 % vol)". Een verpakking zonder artikel krijgt oranje *Artikel maken*.

*Voor de website (vrijwillig op het etiket)*
4. **Bitterheid** — berekend (Tinseth, brouwdag; `ibu_berekend`) → recept.
   Nooit "gemeten". Verschil tot 3 "≈", nooit rood.
5. **Kleur** — recept, eerlijk gelabeld "niet gemeten". Verschil tot 2 "Gelijk".
6. **Energie per 100 ml** — altijd kcal én kJ, elk met de factoren van bijlage
   XIV. Bron: berekend uit OG/FG (van de batch, of bij een product van de
   referentiebatch) → verwacht (recept). Op het product wordt kcal/kJ alleen
   vastgelegd bij *Energie op het gedrukte etiket: Vermeld*; anders volgt de
   website de afleiding. Informatief: "Vrijwillig. Vermeld je het, dan kJ én
   kcal."
7. **Ingrediënten** (ingeklapt) — handmatig → uit de batch → huidig recept. Niet
   meer de vereniging van álle gekoppelde recepten.

**Statuschip** = de zwaarste regel, overal dezelfde tekst en kleur: rood
"Etiket: tarwe ontbreekt" (of "Etiket: buiten de marge"), oranje "Etiket nog
niet vastgelegd" of "Etiket: gegevens onvolledig", groen "Etiket klopt".

**Acties** (één primaire knop): rood → *Etiket bijwerken*; anders, als de
website achterloopt → *Naar webshop*; anders geen knop. Secundair: *Kopieer
etiketgegevens* (naam · stijl · x,x % vol · Bevat: … · inhoud · lotcode · THT ·
naam en adres van de brouwerij · EAN; energie alleen als hij vermeld wordt). In
⋯: *Bron per waarde* en *ABV handmatig (lab)*.

**Telefoon**: een 2×2-cijferblok (Alcohol, Bitterheid, Kleur, Energie); een
tik opent een laag onderblad met de bronketen. Daaronder de allergeenchips
(Batch / Etiket) met de Bevat-regel en de lotcode-regel; de knop van de kaart
staat in de kaart, de ActieBalk blijft voor de fasestap.

### 5.3 ABV vastzetten

De berekende ABV gebruikt de Balling-route die de energieberekening ook
gebruikt: ABW = (OE − RE) / (2,0665 − 0,010665·OE), ABV = ABW·FG/0,7907. De
lineaire `(OG − FG) × 131,25` onderschat sterke bieren (1.090/1.018: 9,45 tegen
9,76) en kan de 10 %-grens voor de THT laten kantelen. Suiker die na de kook is
toegevoegd (uit de batchregels) telt mee, met het bronlabel "berekend uit OG/FG
+ suiker na de kook"; hergisting op fles staat als "zonder hergisting op fles"
in het label. Boven ± 7 % vol of binnen 0,5 van de 10 %-grens raadt de kaart een
labwaarde aan.

**"ABV vastzetten" is verplicht vóór de eerste afvulsessie**, net als de CCP 1-
vrijgave: de voorcalc bij het afvullen, de uitslagaccijns, het accijnsrecord en
de THT-klasse lezen `batch.ABV` (met 0 als terugval), dus die mag op dat moment
niet leeg zijn. Het invulveld in Conditioneren wordt de regel "Alcohol voor
accijns en THT" met de berekende waarde, *ABV vastzetten* en *Labwaarde
invoeren*. De Brewfather-sync zet `abv_bron: 'brewfather'`.

### 5.4 Etiket bijwerken

Dialoog (modal / onderblad), ook te openen vanaf het product. Drie blokken:
1. **Allergenen op het gedrukte etiket** — `EtiketAllergenen`, beginnend bij het
   huidige etiket, nooit bij de batch; geen batchwaarden naast de vinkjes.
2. **Getallen** — vinkregels oud → nieuw uit de referentiebatch. Een vinkje staat
   standaard alleen aan bij een leeg veld of een ABV buiten de marge. Segment
   *Energie op het gedrukte etiket: Niet vermeld | Vermeld*.
3. **Etiketversie** — voorstel huidige versie + 1 (`volgendeEtiketVersie`
   herkent "v3", "3" en leeg) met de datum. Wijzigen allergenen of ABV, dan is
   een nieuwe versie verplicht, met het vinkje "Ik heb het gedrukte etiket v4
   voor me".

Opslaan via één pure helper `legEtiketVast(product, wijziging)` in
`utils/etiket.ts` (versieregel + auditregel "Product, gewijzigd, velden oud →
nieuw"), met de UndoBar. **Dit wordt de enige schrijfweg**: de
HACCP-allergenenmatrix (HACCPPage:246-322) wordt alleen-lezen met een knop
*Etiket bijwerken*, en de inline-invoer in CCP 3 opent dezelfde dialoog.

Daarna, als WooCommerce aan staat: *Ook naar de webshop?* met per artikel het
verschil, alleen voor de bierinformatie-meta (nooit prijs of voorraad), en de
knoppen *Naar webshop* en *Later*.

### 5.5 CCP 3 blijft onafhankelijk

- Etiketallergenen zijn altijd een eigen handeling: nergens voorgevinkt, nergens
  "neem over". De blokkerende vergelijking verandert niet; geen
  gluten-normalisatie in dit traject.
- Het veld **etiketversie** blijft **leeg**: de afvuller vult de versie op de rol
  in zijn hand in; "verwacht: v4" staat ernaast als tekst. Wijkt het af, dan
  volgt een blokkade of een afwijkingsregistratie. (Nu toont het veld
  `product.etiket_versie` als waarde, waardoor een oude rol juist níet opvalt —
  AfvulSessieSectie.tsx:1099, 403.)
- Naast "Alcoholgehalte op het etiket klopt" staat "batch 7,0 · vastgelegd etiket
  6,2 · kijk op de fles". Het vinkje blijft handwerk.
- Nieuwe EtiketControle-records bevriezen ook `etiket_versie_gelezen`,
  `etiket_versie_verwacht`, `abv_batch`, `abv_etiket_verwacht` en `abv_marge`.
  Append-only blijft gelden; oude records blijven ongemoeid.

### 5.6 De webshop

- `afgeleideBierInfo` blijft voor de push alleen productwaarden gebruiken (zoals
  nu); de kaart gebruikt een aparte `productEtiketWaarden`. Zo gaat er nooit stil
  een berekende waarde mee met *Push alles*. *Naar webshop* stuurt alleen de
  waarden die de gebruiker in het verschillenoverzicht koos.
- De app bewaart bij elke push en pull (enkel en bulk) de `_cf_`-meta als stand
  op `product_artikelen[].wc` (`meta_stand` + tijdstip). De kaart toont "Website:
  stand bij laatste push 12-9"; "loopt achter" vergelijkt die stand met het
  product (etiket), nooit met de batch in de tank.
- De Bevat-regel voor de webshop = de vereniging van de allergenen van de
  etiketversies die nog op voorraad liggen (uit de EtiketControle van de sessie
  van elk lot). Zo staat er tijdens de overgang v3 → v4 nooit te weinig.
- Een eigen allergeensleutel in `CRAFTERY_META` pas als het Craftery-thema er een
  heeft (open vraag); tot dan "Bevat: …" achter een afgeleide `_cf_ingredienten`,
  na verificatie dat het thema die tekst toont.

### 5.7 Regelgeving (te verifiëren bij de NVWA)

Bier boven 1,2 % vol is vrijgesteld van ingrediëntenlijst en voedingswaarde
(Vo. 1169/2011 art. 16 lid 4); allergenen moeten wel, met "Bevat:" (art. 21,
bijlage II). Energie mag vrijwillig, dan kJ én kcal per 100 ml (bijlage XIV);
of een berekening uit OG/FG volstaat (art. 31 lid 4) is na te gaan. ABV-marge:
bijlage XII. Verkoop op afstand: art. 14. Geen THT vanaf 10 % vol: bijlage X.
Naam en adres van de brouwerij: art. 9 lid 1 sub h.

---

## 6. Recepten "in gebruik"

**Eenheid = het hoofdrecept.** Een Brewfather-versie (`is_huidige: false`, id
`<parent>__v<n>`) telt mee voor zijn hoofdrecept en staat nooit als eigen regel
in een lijst of kiezer. `batch.recept_id` blijft het hoofdrecept; een gekozen
versie gaat in een nieuw veld `batch.recept_versie_id` (de vijf bestaande lezers
van `recept_id` — BrouwdagWizard, EBC-backfill, dossier, batchpagina,
ReceptKostprijs — blijven werken). Twee Brewfather-recepten met een eigen naam
("Kadeblond v3", "Kadeblond v4") zijn twee recepten.

**Status per hoofdrecept** (`receptGebruik()` in `utils/receptGebruik.ts`; de
eerste regel die geldt):
1. *verborgen* — in `recepten_verborgen`, of álle tags gearchiveerd. Wint altijd.
   Is het nog in gebruik, dan onder Verborgen de chip "nog in gebruik bij
   Kadeblond".
2. *vastgepind* — nieuw veld `recept.vastgepind` (in `RECEPT_EIGEN_VELDEN`, dus
   sync-bestendig).
3. *gepland of lopend* — een batch in Gepland t/m Conditioneren.
4. *huidig recept van <product>* — van een niet-gearchiveerd product.
5. *gekoppeld aan <product>* — in `receptenVanProduct` van een niet-gearchiveerd
   product.
6. *recent* — een batch met een `datum` in de laatste 18 maanden. Oude
   Brewfather-batches zonder `recept_id` maar mét `brewfather_id` tellen mee als
   hun naam exact de receptnaam is (alleen voor deze telling).
7. *archief* — al het andere.

"In gebruik" = 2 t/m 6. Actief product = `status !== 'gearchiveerd'` (uit
roulatie telt mee).

**Overal dezelfde regel**
- Receptenpagina: Segment *In gebruik · Archief · Verborgen*. In gebruik is
  gegroepeerd per product (huidig recept bovenaan, eerdere ingeklapt), met
  *Zonder product* onderaan. Archief is een platte lijst waarin elk recept één
  keer staat, met Brewfather-tags als filterchips (inclusief een werkende
  "zonder tag"). Zoeken doorzoekt alles ("Ook gevonden in Archief (2)"). Lege
  staat na een eerste import: "Nog geen recept in gebruik" + *Alle recepten
  (140)*. Acties via ⋯ (Brouwen, Vastpinnen, Koppel aan product, Verbergen met
  undo).
- *Wat brouw je?*: groep *Jouw producten* (met subgroep *Seizoen / uit
  roulatie*), groep *Andere recepten in gebruik*, het archief via zoeken.
- *Recept koppelen* op het product, *Recept opnieuw toepassen* (Gepland) en de
  receptfilter in Batches gebruiken dezelfde kiezer. In *Gesloten* toont de
  filter de recepten die in de getoonde batches voorkomen.

**Sync**: `receptSync` bewaart een recept dat uit Brewfather verdwijnt zolang
het nog in `batch.recept_id`, `product.recept_ids` of
`product.recept_huidig_id` staat of vastgepind is (`niet_in_brewfather: true`,
chip "niet meer in Brewfather"). Nooit stil verwijderen.

---

## 7. Afleidingen

| Waarde | Bronketen (bronlabel) | Bouwstenen |
|---|---|---|
| ABV batch | vastgezet → ingevoerd (lab) → Brewfather → berekend uit OG/FG (Balling, + suiker na de kook) → verwacht (recept) | `batch.ABV`, `abv_definitief`, nieuw `abv_bron`; `sgToPlato`; nieuw `etiketWaarden().abv` |
| IBU batch | berekend (Tinseth, brouwdag) → recept | `ibu_berekend` (nu ongelezen), `Recept.IBU` |
| EBC batch | recept (niet gemeten) | `batch.kleur`, `batchEbc` |
| Energie | (product: vermeld) → berekend uit OG/FG → verwacht (recept); kcal = 7·alcohol + 4·koolhydraten, kJ = 29·alcohol + 17·koolhydraten (g/100 ml) | nieuw `energiePer100ml()`; testwaarden 1.050/1.010 → 46/194, 1.048/1.010 → 45/187, 1.064/1.012 → 60/249, 1.090/1.018 → 85/354 |
| Allergenen batch | regel → ingredient_id → lot.ingredient_id (nieuw) → naam; "onvolledig" alleen voor Mout/Suiker/Overig zonder vastgelegde allergenen | `allergenenUitBatch`, `ingredientVoorBatchRegel` |
| Allergenen recept | receptregels → catalogus (label "verwacht") | nieuw `allergenenUitRecept()` |
| Etiketallergenen | alleen vastgelegd (`product.allergenen`), nooit afgeleid | `EtiketAllergenen`, nieuw `legEtiketVast` |
| Bevat-regel | uit het etiket; webshop: vereniging van de etiketten op voorraad | nieuw `allergeenRegel()` (i18n per allergeen) |
| Ingrediëntenlijst | handmatig → uit de referentiebatch → huidig recept | `bierIngredienten` + adapter `batchRegelsAlsRecept` |
| Referentiebatch | nieuwste batch met gemeten FG → laatste afgevulde | nieuw `referentieBatch()` |
| Huidig recept product | vastgezet (`recept_huidig_id`) → laatst gebrouwen → enige gekoppelde → `recept_ids[0]` | nieuw `huidigReceptVoorProduct()` |
| Product van een batch | `product_id` → bij plannen precies één kandidaat → meest voorkomende afvulling (oud) → "Kies product" | nieuw `productVoorstelVoorRecept()` |
| Titel van een batch | product → recept → `batch.naam` → "naamloos", overal gelijk | `batchTitels` verhuist als `batchTitel()` naar utils |
| Lotcode & THT | sessie (vóór de eerste: "L<batch>-B1 e.v.") ; THT handmatig → `berekenTht` → geen (≥ 10 %) | `nieuweLotcode`, `thtKlasseVoorBatch`, `berekenTht` |
| Voorraad per product | per afvulling − picks − uitgeleverd − afgeboekt, per locatie, min reserveringen; per verpakking, nooit opgeteld | `beschikbaarheid.ts`, nieuw `voorraadPerProduct()` |
| Komt eraan | batches Gepland t/m Conditioneren; stuks = liters × (1 − gemiddeld verlies) × verpakkingsmix ("geschat"); datum `verpakProjectie` ("verwacht") | `verpakProjectie`, `gemiddeldVerlies`, `verpakkingMix` |
| Dekking | (vrij + AGP) ÷ gemiddelde uitlevering per week (8 weken), alleen bij ≥ 3 weken verkoop; uit roulatie nooit "laag" | nieuw `dekkingWeken()` |
| Volgende stap | uit status, open taken, sessie, CCP 1, ABV vastgezet, etiketoordeel; knop met › = openen, zonder › = uitvoeren | nieuw `volgendeStap.ts` |
| Tankstatus op brouwdatum | schoon/vuil · gereserveerd (waarschuwing) · bezet tot ± datum (niet te kiezen) | nieuw `tankBeschikbaarOp()`; wijzigt bewust twee regels van `tankOptiesVoor`/`maakNieuweBatch` |
| Vaste brouwkosten in Gereed | `kostenVoorBrouw` (gemeten → boekhouding → handmatig → geen), alleen tonen | `brouwKosten.ts`; nooit in W&V of COGS, nooit op de batch schrijven |
| Etiketversie-voorstel | huidige + 1 met datum, verplicht bij wijziging allergenen/ABV | nieuw `volgendeEtiketVersie()` |

---

## 8. Data en code

- **`utils/route.ts`**: `recordId?: string`, aliassen, `decodeURIComponent` in
  try/catch, algemener `isDetailRoute`/`routeGelijk`; tests voor een id met
  `__v` en `%`, en elke alias.
- **App.tsx**: tabs (Productie: dashboard "Brouwzaal", batches, recepten,
  ingredienten, haccp, gereedschap; Verkoop: dashboard "Overzicht", producten,
  bestellingen, kassa, klanten, statiegeld); `gaNaar(doel)`; kopbalktitel op een
  detailroute; `history.state`-markering voor de terugknop; ReceptenPage krijgt
  producten en batches; VerkoopDashboard krijgt `attentie.verkoop`.
- **Nieuwe utils (strict, met tests)**:
  - `productKeten.ts` — `batchTitel`, `receptHoofdId`, `receptenVanProduct`,
    `huidigReceptVoorProduct`, `productVoorstelVoorRecept`, `receptVoorBatch`,
    `nieuwProductUitBatch` (naam, stijl, recept_ids; geen ABV, geen allergenen),
    `tankBeschikbaarOp`.
  - `receptGebruik.ts` — `receptGebruik()`, `receptenVoorKiezer()`.
  - `receptNaarBatch.ts` — de enige vertaling recept → {batch,
    batch_ingredienten}; vervangt `maakNieuweBatch` én `applyReceptToBatch`.
  - `etiket.ts` — `etiketWaarden`, `productEtiketWaarden`, `referentieBatch`,
    `abvBerekend` (Balling), `energiePer100ml`, `abvMarge`, `vergelijkEtiket`,
    `etiketStatus`, `allergeenRegel`, `allergenenUitRecept`,
    `volgendeEtiketVersie`, `legEtiketVast`, `batchRegelsAlsRecept`.
    Testgevallen o.a. etiket 5,6 tegenover batch 5,2 → ±0,5; 5,5/5,9 als
    randgeval; een sterk bier (1.090/1.018); "gluten" niet los naast "gerst";
    `undefined` ≠ `[]`.
  - `verkoopOverzicht.ts` — `voorraadPerProduct`, `komtEraan`, `dekkingWeken`.
  - `volgendeStap.ts`.
- **Velden op bestaande records** (geen nieuwe keys): Batch `abv_definitief`,
  `abv_bron`, `recept_versie_id`; BatchIngredient `afgeboekt`; Product
  `recept_huidig_id`, `kj`, `energie_op_etiket`; Recept `vastgepind`,
  `niet_in_brewfather`; EtiketControle `etiket_versie_gelezen`,
  `etiket_versie_verwacht`, `abv_batch`, `abv_etiket_verwacht`, `abv_marge`
  (alleen nieuwe records); `product_artikelen[].wc.meta_stand` + tijdstip;
  Ingredient: `allergenen` als lege lijst = "gecontroleerd, geen allergenen"
  (vinkje in de matrix). De Excel-round-trip-test krijgt de nieuwe velden erbij.
- **Bestaande utils**: `receptSync.ts` (verwezen recepten bewaren, test voor een
  verdwenen recept); `bierinfo.ts` (kcal afgeleid met overschrijving, placeholder
  "67" weg, ingrediënten uit de referentiebatch); `batchStats.ts` (rendement uit
  `brouwzaal_efficiency_pct`, ABV-terugval Balling, meting `ibu`, kleur geen
  meting); `haccp.ts`/`batchIngredienten.ts` (route via `lot_id`);
  `calculations.ts` (`schatABV` met gemeten FG; `berekenProductKostprijs` en
  `berekenBatchKostprijs` met een optioneel argument voor schermen — nooit in
  W&V/COGS); `taken.ts`/`attentie.ts` (tellen per batch; posten `etiket` in
  Productie én Verkoop, `afgevuld_zonder_artikel`, `bier_tht`, `sku_conflict`).
- **AfvulSessieSectie**: product start op `batch.product_id`; etiketversie leeg
  met verwachte versie ernaast; getallen naast de vinkjes; inline allergenen →
  dialoog; ABV vastgezet als poort vóór de eerste sessie.
- **Componenten (boy-scout)**: `batch/KetenRegel`, `batch/FaseKop`,
  `batch/EtiketKaart`, `batch/EtiketBijwerken`, `batch/NieuweBatchBlad`,
  `recept/ReceptKiezer`, `ui/ActieBalk`; `Onderblad` en `Segment` verhuizen naar
  `components/ui` (re-export op de oude plek); BatchFlowPage splitst in
  BatchesPage (lijst + Agenda) en het batchdetail; ProductenPage krijgt de kop met
  één knop + ⋯ en de blokken in ketenvolgorde; ReceptenPage haalt de componenten
  uit de render.
- **Kassa**: onder `lg` een vaste bonbalk met onderblad *Bon*; tegels per product
  op `product_id`; incl. BTW bij particulier (pure helper in `kassa.ts`);
  AGP-voorraad alleen als link naar de UitslagModal.
- **Bestellingen en PakbonExport**: zoeken en statuschips met tellers; een
  detailroute met één volgende stap en de rest in ⋯; lotcode in pickmodal,
  pickoverzicht, pakbon en picklijst; *komt eraan* in plaats van het
  merchvoorstel; `orderNummer` (picking.ts) ook in Klanten.
- **Batchdossier**: IBU en EBC met bron, energie kcal/kJ, allergenen (batch en
  etiket), etiketstatus, lotcode en THT per verpakking, OG/FG met drie decimalen,
  de getallen bij CCP 3.
- **Batches met meer producten** (`product_ids`, rebrand): de kaart toont per
  product een eigen oordeel; *Per verpakking* krijgt een kolom Product.
- **i18n**: alle nieuwe sleutels in vijf talen; sleutels uit data met fallback.
- **CLAUDE.md**: de schil, een sectie "Etiketwaarden", de nieuwe utils, en
  `producten`/`product_artikelen` in de key-tabel.

---

## 9. Snelle winst (fase 1)

- Recepten: de groep "Zonder tag" toont echt de recepten zonder tag; een recept
  met meer tags staat één keer; zoeken klapt groepen met treffers open en meldt
  "geen resultaat".
- Recepten: `IngRow`, `IngSection`, `RecepKaart` en `TagGroep` buiten de render
  (focusverlies in de hoptijd).
- ReceptKostprijs: geen `text-white` in een kop die niet solid is.
- Productpagina: de knop *Uitslaan (n× in AGP)* als secundaire knop (nu wit op
  wit); kop met *Bewerken* + ⋯ (Archiveren, Verwijderen met undo) in plaats van
  drie knoppen met `confirm()`; artikel verwijderen met undo; logboek alleen van
  het geopende product.
- SG, OG en FG overal met drie decimalen (ook de Gereed-tegels en "FG 1.01").
- Koude batchlink: de fase opnieuw bepalen zodra de batch geladen is.
- Batchgegevens: geen `gn_code` meer kopiëren van een product dat dat veld niet
  heeft.
- "Buiten de tanks" toont ook Vergisten/Conditioneren zonder (bestaande) tank.
- De receptkeuze bij *Nieuwe batch* en *Recept opnieuw toepassen* laat verborgen
  recepten en gearchiveerde tags weg (tot het nieuwe blad er is).
- CCP 3 en het afvulformulier beginnen op `batch.product_id`; gearchiveerde
  producten niet meer in de keuze.
- Pickmodal: onder "Lot" de lotcode, het batchnummer onder "Batch".
- De kcal-placeholder "67" verdwijnt.
- Types: `Batch.abv_definitief`, `BatchIngredient.afgeboekt`.
- Hardcoded tekst via i18n ("Batch", "d", "u", "{n}v" op de receptenpagina;
  "Order", "WC Push", "WC Pull"; de batchstatussen op de productpagina). Klanten
  gebruikt `orderNummer` onder de kop "Bestelnummer".

---

## 10. Fasering

Elke fase is los op te leveren; de drie vragen van de gebruiker eerst.

| Fase | Inhoud | Omvang |
|---|---|---|
| F1 | Snelle winst (hoofdstuk 9) | S |
| F2 | De keten: `productKeten.ts` en `receptNaarBatch.ts`; een nieuwe batch krijgt zijn product (met undo); CCP 3/afvullen beginnen bij dat product; nieuw product erft naam, stijl, recept; `batchTitel` overal; KetenRegel in de batchkop (klikbaar via een eenvoudige `gaNaar`) | M |
| F3 | Etiket & website in de batch: `etiket.ts`; EtiketKaart in Conditioneren, Afvullen en Gereed; ABV vastzetten als poort; CCP 3 met getallen, lege versie en snapshots; allergenen via het lot; batchStats-reparaties; dossier; vaste kosten via `kostenVoorBrouw` (alleen tonen) | M |
| F4 | Recepten In gebruik: `receptGebruik.ts`, `vastgepind`, Segment, groepering per product, tags als filter, acties in ⋯, verbindingsblokken in het detail, sync bewaart verwezen recepten; de ReceptKiezer in het bestaande nieuwe-batchformulier en bij het product | M |
| F5 | Etiket bijwerken (één schrijfweg, HACCP-matrix alleen-lezen) en de webshop (stand bewaren, verschillenoverzicht, Bevat-regel na themaverificatie) | M |
| F6 | Routes en schil: `recordId`, detailroutes voor recept, product en bestelling, kopbalktitel, terugknop, tabs Brouwzaal en Overzicht | M |
| F7 | Batches-tab: Lopend, Gesloten, Agenda; agenda als lijst per tank op de telefoon; een balk opent de batch (selectie voor de behoefte via vinkjes); attentiepost per batch | M |
| F8 | Het blad *Wat brouw je?* met vijf ingangen, tankstatus op de brouwdatum en vooruitblik op het etiket; het formulier onder Planning verdwijnt | M |
| F9 | Brouwzaal en batch op de telefoon: `volgendeStap.ts`, FaseKop, ActieBalk, nieuwe tankkaart, Andere batches, rechterkolom | L |
| F10 | Productpagina als knooppunt: ketenstrook, etiketkaart, Maken/Verkopen, `verkoopOverzicht.ts`, segmenten op de telefoon | L |
| F11 | Verkoop Overzicht: attentieposten, Te picken met inhoud en bedrag, voorraad met komt eraan | M |
| F12 | Kassa op de telefoon | S |
| F13 | Bestellingen op de telefoon, lotcode in pick, pakbon en picklijst | M |
| Later | "uit roulatie" en "gearchiveerd" samenvoegen; gluten-normalisatie (na toetsing aan het HACCP-handboek); EBC uit de mout (Morey); eigen Craftery-sleutel voor allergenen; Brewfather-batches als signaal voor in gebruik | — |

Bij elke fase: `npm test`, `npm run typecheck`, de UI handmatig op 1440 en 390 px
(verify-skill), en de versie +0.0.1.

---

## 11. Bewust niet

- Geen vierde werkruimte, geen gedeelde productentab in Productie, geen zesde
  vakje in de onderbalk.
- Allergenen gaan nooit van de batch naar het etiket: geen voorvinkje, geen
  "neem over", geen batchwaarden naast de vinkjes.
- Geen automatische aanpassing van de ABV op het etiket; binnen de marge hoeft
  er niets.
- Geen automatische push naar de webshop.
- Geen recepteditor, geen recepten aanmaken in de app, geen Brewfather-tags
  bewerken; versies nooit als losse regel.
- Geen Gantt en geen slepen op de telefoon, geen tabellen die zijwaarts scrollen.
- Geen nieuwe data-keys; `product.recept_ids` wordt niet automatisch
  bijgeschreven.
- Geen gemeten-EBC-veld, geen voedingswaardetabel.
- Geen bulkactie "verberg ongebruikte recepten" (In gebruik maakt hem overbodig).
- Uitslaan blijft een eigen handeling; de kassa verkoopt alleen vrije voorraad.
- De vaste brouwkosten worden niet op de batch weggeschreven en niet in de W&V of
  de COGS meegeteld.

---

## 12. Open vragen

1. **Het batchpaneel onder de tankkaarten** op het bureau weghalen, zodat een
   batch altijd één pagina is met één terugweg? *Advies: ja.*
2. **Allergenen in de webshop**: een eigen veld in het Craftery-thema
   (`_cf_allergenen`) dat vóór "In winkelwagen" staat? *Advies: ja; tot dan
   "Bevat: …" achter de ingrediënten.*
3. **Energie op het gedrukte etiket**? *Advies: op de website wel (als
   "berekend"), op het etiket pas na een labmeting of afstemming met de NVWA.*
4. **"Recent" = gebrouwen in de laatste 18 maanden**, zodat een kerstbier
   zichtbaar blijft? *Advies: zo laten.*
