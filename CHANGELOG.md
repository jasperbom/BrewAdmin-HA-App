# Changelog

Alle wijzigingen in dit project worden hier bijgehouden.

---

## [1.2.5]

### Toegevoegd
- WooCommerce koppeling: automatisch voorraad bijwerken in webshop bij uitslaan
- Handmatige bidirectionele sync op de Voorraad pagina (↕ WC Sync knop): haalt verkopen op uit WooCommerce en verdeelt het verschil FIFO over uitslagen
- WooCommerce API-instellingen in de Instellingen pagina (URL, Consumer Key, Consumer Secret, ingeschakeld-schakelaar, verbindingstest)
- Hygiëne checklist per batch: configureerbare items met groepsindeling (Voorbereiding, Brouwen, Afvullen, etc.)
- Hygiëne afvink-acties worden nu geregistreerd in het batch logboek

---

## [1.2.0]

### Toegevoegd
- Artikelenstambestand per bier + verpakkingstype (SKU, EAN, verkoopprijs, BTW)
- Rode markering in uitgeslagen voorraad voor onbetaalde accijns
- Tankkaarten op dashboard vergroot voor betere leesbaarheid van statuslabels
- Brewfather sync uitgebreid: brouwzaal- en maischrendement, pH-waarden, notities
- Inklapbare "Batch info" sectie op de batches pagina
- Logboek toont nu alle gewijzigde velden bij batch-bewerkingen

### Gewijzigd
- Accijns wordt nu per uitslag bijgehouden (via `uitslag_id`)
- Voorraad archief telt mee in de totalen op de voorraadpagina

---

## [1.1.0]

### Toegevoegd
- Uitgeslagen voorraad met verkoop-tracking per verpakkingstype
- Accijnsberekening en -overzicht
- Archivering van volledig verkochte uitslagen
- THT-waarschuwingen op het dashboard (verlopen + binnen 30/90 dagen)
- Brewfather recepten synchronisatie

### Gewijzigd
- Navigatie uitgebreid met Voorraad en Accijns pagina's

---

## [1.0.0]

### Eerste release
- Batch beheer (aanmaken, bewerken, statuswijzigingen)
- Ingrediënten en lots
- Tankoverzicht en bezettingsvalidatie
- Home Assistant ingress ondersteuning
- Data synchronisatie via HA API + localStorage fallback
