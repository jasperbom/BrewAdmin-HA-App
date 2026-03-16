# 🍺 Brouwerij Admin — Home Assistant Addon

Een Home Assistant addon voor het beheren van een kleine brouwerij. Registreer batches, beheer ingrediënten en voorraad, volg accijnsverplichtingen en synchroniseer met Brewfather en WooCommerce — alles vanuit één overzichtelijke interface direct in je HA dashboard.

## Volledig gemaakt met Claude AI.

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fjasperbom%2FBrewAdmin-HA-App)

## Functies

### Dashboard
- Overzicht van actieve batches, beschikbare voorraad, open accijns en actieve lots
- Visuele tankstatus per fermentatie- of lagertank
- Waarschuwingen voor verlopen of bijna-verlopen THT-datums

### Ingrediënten
- Beheer ingrediënten met lots, hoeveelheden en THT-datums
- Ondersteuning voor meerdere eenheden en verpakkingstypes
- Mutatielogboek per ingredient

### Batches
- Volledige batch-administratie: naam, stijl, status, tank, datums
- Metingen: OG, FG, ABV, liters, pH-waarden en rendementen
- Kostenoverzicht per batch (electra, water, schoonmaak, overig)
- Ingrediënten koppelen met automatische voorraadaftrek
- Afvullen en uitslaan van gereed bier
- Hygiënechecklist per batch: aangepaste groepen en items, afvinkbaar per stap
- Tankbezetting-validatie (dubbele bezetting wordt geblokkeerd)
- Logboek per batch met alle mutaties

### Recepten
- Brewfather recepten importeren en bekijken
- Voorraadstatus per recept: zie direct of ingrediënten beschikbaar zijn

### Uitgeslagen Voorraad
- Overzicht per bier, batch en verpakkingstype
- Verkochte stuks bijhouden per uitslag
- Artikelenstambestand met SKU, EAN, verkoopprijs en BTW-percentage
- Rode markering voor uitslagen waarover accijns nog niet betaald is
- Automatische WooCommerce voorraadupdate bij uitslaan
- Archivering van volledig verkochte uitslagen

### Accijns
- Automatische accijnsberekening bij uitslaan (liters × ABV × tarief)
- Overzicht van open en betaalde aangiftes
- Markeer accijns als betaald met één klik
- Alleen voorraad met betaalde accijns telt mee in WooCommerce

### Instellingen
De instellingenpagina is ingedeeld met een zijbalk navigatie:

- **Brouwerij** — brouwerijnaam, logo en tanks beheren
- **Brewfather** — API koppeling (User ID + API key), handmatige sync
- **WooCommerce** — webshop koppeling (store URL + consumer key/secret), handmatige voorraadpush, synchronisatielog
- **Accijns** — tarieven instellen (per hl/ABV en per hl)
- **Hygiëne** — checklist-items en groepen beheren die verschijnen per batch
- **Data** — export en import van alle data (Excel backup), mutatielog


## Installatie

Voeg deze repo toe aan je Home Assistant apps en installeren maar :)


