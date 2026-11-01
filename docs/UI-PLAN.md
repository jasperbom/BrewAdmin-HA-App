# UI-verbeterplan — BrewAdmin in de huisstijl van Craftery

Opgesteld met de skill *ui-ux-pro-max* (prioriteit: toegankelijkheid → interactie →
layout → typografie & kleur → beweging → stijl), op versie 1.13.10 met het
Craftery-thema en de demo-brouwerij uit de tests. Alleen een plan: er is nog niets
van gebouwd.

Uitgangspunt van de skill voor dit soort app: **data-dicht met doorklikken**
(veel tabellen, tellers, één volgende stap) — geen sierlijke vormen, wel duidelijke
filters, rijen die oplichten en cijfers die je in één oogopslag leest. De kleuren en
lettertypes die de skill generiek voorstelt (bordeaux, Fira) vervallen: de
huisstijl van Craftery gaat voor.

Elke stap: wat, waarom (gemeten), hoe, en hoe groot (S = uur, M = dagdeel, L = dag+).

## Stand: alles gebouwd (1.13.13 – 1.13.18)

| Fase | Versie | Wat er anders liep dan gepland |
|------|--------|--------------------------------|
| 1.1, 2.1 | 1.13.13 | — |
| 1.2–1.5 | 1.13.14 | 1.3: het "let op"-probleem is opgelost door oranje per thema te vervangen (roest bij Craftery), zodat álle 441 oranje plekken meegaan. `StatusPil`/`PIL_KLEUR` vervangt de vier losse kleurtabellen; bestaande pillen elders blijven hun klassen houden en kleuren vanzelf mee |
| 3.1 | 1.13.15 | Het waren 61 echte aanroepen (de 93 telde commentaarregels mee). Ook `prompt()` bij *Alle data wissen* is weg. Backup terugzetten en de lege-facturen-opruiming vragen toestemming in een venster: een terugweg van vijf seconden bij het opstarten is te stil |
| 2.2, 2.3, 3.3, 3.4 | 1.13.16 | 3.2 bleek al geregeld (`index.css`). 2.1: metatekst op de telefoon bewust níét 13 px — dat zou elke `text-xs` op de telefoon groter maken en chips en tabs laten overlopen |
| 4.1–4.5, 5.1 | 1.13.17 | 4.1: één variant gebouwd, het omlijnde tabblok van de site. 4.3: niet alle 1355 `rounded` aangepast; kaarten in kaartkleur en de inktrand alleen voor een tank die aandacht vraagt |
| 5.2, 5.3 | 1.13.18 | 5.2: vergelijking met de hele vorige maand. 5.3: de bon stond al vast rechts; hij scrolt nu zelf als hij lang wordt |

---

## Fase 1 — Wat het Craftery-thema nu nog breekt (eerst doen)

Amber is een licht accent. De app is gebouwd met donkere accenten (amber-700,
groen-700 …), dus op een paar plekken werkt dat nu tegen.

| # | Wat | Gemeten | Hoe | Grootte |
|---|-----|---------|-----|---------|
| 1.1 | **Amber als tekst** wordt onleesbaar ("20°C" en "100% vergist" op de batchpagina) | 28 plekken met `var(--t-accent)` als tekstkleur; amber op wit = 2,1:1 (norm 4,5:1) | Overal `t-accent-text` (rekent de tint al donkerder tot 4,5:1). In CLAUDE.md de regel "of `style={{color:'var(--t-accent)'}}`" schrappen | S |
| 1.2 | **Grijze tekst te licht, en koel naast warm papier** | `text-gray-400` 422×: 2,2:1 op papier, 2,5:1 op wit. `text-gray-500` 4,2:1 op papier | Tailwind-grijs via CSS-variabelen (standaard = huidige grijzen, dus de andere thema's veranderen niet). Craftery krijgt warme grijzen met een bruine ondertoon zoals op de site, met 400/500 zo donker dat ze 4,5:1 halen. Eén wijziging in `tailwind.config.js` + `craftery.css`, geen pagina's | M |
| 1.3 | **Merkkleur en waarschuwing zijn dezelfde kleur.** De Volgende-stap-knop, de pil "Vergisten" en "Etiket: tarwe ontbreekt" zijn alle drie amber/oranje: je ziet niet meer wat een actie is en wat een probleem | 138 amber/oranje/gele badges | Eén `StatusPil` met een soort (`ok`, `bezig`, `let_op`, `fout`, `info`). Amber is alleen nog voor wat je aanklikt en wat geselecteerd is; "let op" wordt roest (rood-oranje), "bezig" blauw. Eerst op Brouwzaal, Batch, Producten en Bestellingen | M |
| 1.4 | **"Naamloos" in Nu actief** terwijl de tank "Kadeblond" zegt | 5× `b.naam \|\| b.biernaam` in App.tsx | `batchTitel` (product → recept → naam), zoals CLAUDE.md voorschrijft | S |
| 1.5 | **Tank zonder EBC is blauw** (Nieuwbier) | `BierKleur`/tank-SVG zonder kleur | Neutraal (papier met inktrand), zodat blauw niet als "koud" of "water" leest | S |

## Fase 2 — Letters en cijfers

| # | Wat | Gemeten | Hoe | Grootte |
|---|-----|---------|-----|---------|
| 2.1 | **Te kleine tekst** | 194× `text-[9px]`…`text-[11px]` | Ondergrens 12 px (11 px alleen nog in een badge met eigen achtergrond); op de telefoon metatekst 13 px | M |
| 2.2 | **Cijfers als op de site: mono** — bedragen, metingen (SG, °C, pH), lotcodes en tellers | Kerncijfers staan nu in Space Grotesk, proportioneel | Een klasse `.cijfer` (`tabular-nums`; bij Craftery IBM Plex Mono). Eerst op de tegels van het Administratie-overzicht, de kassa (prijzen, bon), de tankkaarten en de totaalregels van Facturen | S–M |
| 2.3 | **Eén typeschaal** | Koppen variëren per pagina (`text-base`…`text-2xl`, semibold/bold) | Vier stappen vastleggen en in CLAUDE.md zetten: paginatitel (Jost, 24 px), sectiekop (15 px semibold), tekst (14–15 px), meta (12–13 px) | S |

## Fase 3 — Interactie en toegankelijkheid

| # | Wat | Gemeten | Hoe | Grootte |
|---|-----|---------|-----|---------|
| 3.1 | **Nog `alert()`/`confirm()`** (CLAUDE.md verbiedt ze; op een telefoon blokkeren ze het hele scherm en ze zijn niet te stylen) | 93× in 8 bestanden: Instellingen 29, Ingrediënten 17, BatchFlow 13, Bestellingen 12 | `Melding` (rode regel), `BevestigKnop` of `useUndo`, per pagina één commit | L |
| 3.2 | **Beweging zonder uitzondering** | 11× `animate-*`, 1× rekening gehouden met "minder beweging" | `motion-safe:` ervoor; het knipperende Nu-actief-bolletje stil bij `prefers-reduced-motion` | S |
| 3.3 | **Uitgeschakelde knop leest als "bijna aan"** (bleek amber met bleke tekst, zoals "Meting toevoegen") | `Btn` doet bij uitgeschakeld alleen `opacity-50`, losse knoppen `disabled:opacity-40` | Grijs vlak + grijze tekst, en de reden er zichtbaar onder (een `title` zie je op de telefoon niet) | S |
| 3.4 | **Eén focusring** | Ringen wisselen per component (ring-2, ring-offset, wit/80 …) | Zoals de site: 3 px amber met 3 px afstand, overal via `focus-visible` | S |

## Fase 4 — De huisstijl verder doortrekken (Craftery)

Eerst een voorbeeld laten zien, dan pas bouwen: dit is smaak.

| # | Wat | Hoe | Grootte |
|---|-----|-----|---------|
| 4.1 | **Tabs op het bureau zoals op de site** | De paginatabs in IBM Plex Mono, de actieve met een inktlijn eronder (de site heeft een omlijnd tabblok — twee varianten tonen) | S |
| 4.2 | **Actieve werkruimte in de balk** | Een amber streep links naast het actieve icoon i.p.v. wit/20 | S |
| 4.3 | **Eén afronding, warme randen** | Nu `rounded` 1355×, `rounded-lg` 386×, `rounded-xl` 175×. Kaarten 12 px, velden 8 px, pillen rond. Een 2 px inktrand alleen voor het ene ding dat nu aandacht vraagt (de tank met een open stap), niet op elke kaart — de skill waarschuwt juist tegen sierlijkheid in een data-app | M |
| 4.4 | **Factuur en pakbon in de huisstijl** | Bij het thema Craftery een laag over de standaardlayout (`FACTUUR_HTML_DEFAULT`/`FACTUUR_CSS_DEFAULT`): logo, inkt, amber accentlijn, Space Grotesk, bedragen in mono. Een eigen layout van de gebruiker blijft voorgaan | M |
| 4.5 | **Loginpagina van de directe poort** (staat standaard uit) | Standaardkleuren Craftery en inkt op de amber knop i.p.v. wit | S |

## Fase 5 — Schermen (per scherm, met voorbeeld vooraf)

| # | Wat | Hoe | Grootte |
|---|-----|-----|---------|
| 5.1 | **Tankkaart zonder meting** neemt drie lege kolommen (Gravity/°C/pH met streepjes + "nog geen meting") | Eén regel "Nog geen meting" met de knop Meten; de kolommen pas als er een meting is | S |
| 5.2 | **Administratie-overzicht** als alles in orde is: vier tegels € 0,00 en drie losse knoppen even breed als de tegels | Tegels compacter met de vergelijking met vorige maand; de drie handelingen als gewone knoppen rechts boven | M |
| 5.3 | **Kassa op een tablet** | Grotere tegels (de hele tegel tikt), prijs in mono rechtsboven, de bon vast rechts | M |

---

## Aanbevolen volgorde

1. **Fase 1** in één werkgang (1.1, 1.2, 1.4, 1.5 klein; 1.3 de grootste) — daarna
   klopt het thema overal.
2. **Fase 2.2 en 3.2–3.4** — klein, en direct zichtbaar.
3. **Fase 3.1** per pagina, los van de rest (veel bestanden, weinig risico per stap).
4. **Fase 4 en 5** na een voorbeeld per onderdeel.

Elke stap: `npm test`, typecheck, screenshots op 390 px en 1400 px voor en na (de
verify-skill), en een contrastcontrole van nieuwe kleuren (`kleurContrast.ts`).
Wat algemeen is (1.1, 1.2-mechanisme, 1.4, 2.x, 3.x) kan daarna ook naar de publieke
repo; wat Craftery is (de warme grijzen, fase 4) blijft hier.
