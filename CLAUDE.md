# BrewAdmin HA App – Development Guidelines

## Color Conventions

### Theme-Aware Colors (gebruik altijd voor algemene UI)
De app ondersteunt 6 kleurenthema's (amber, green, blue, slate, red, purple). Gebruik **altijd** CSS-klassen die op de theemavariabelen steunen voor interactieve elementen:

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
| `green-*` | Inkomsten, ontvangst, succes, verkoop |
| `red-*` | Uitgaven, fouten, tekort, gevaarlijke acties |
| `blue-*` | Inkoop, informatie, neutrale acties |
| `orange-*` | BTW, overige kosten, waarschuwingen |
| `purple-*` | Uitslaan (bier), Kapitaal-dagboek (badge), conditioneren/lagering fase |
| `gray-*` | Neutrale tekst, secondaire elementen |
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
