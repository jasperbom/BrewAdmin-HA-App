// Pagina-indeling voor de PDF-export.
//
// `utils/pdf.ts` rendert een document als één lange afbeelding en schuift die
// per paginahoogte omhoog. Bij een pakbon of factuur van één pagina valt dat
// niet op; bij een langer document — het batchdossier — valt de knip midden
// door een tabelregel: de bovenste helft van de letters staat onderaan de ene
// pagina, de onderste helft bovenaan de volgende.
//
// Deze module rekent uit wáár geknipt mag worden. De aanroeper geeft de
// verticale posities van de blokken die heel moeten blijven (tabelrijen,
// kaarten, koppen) en krijgt per pagina terug welk stuk van de afbeelding
// erop komt. Puur rekenwerk in pixels, geen DOM — vandaar hier en niet in
// pdf.ts, zodat de Vitest-suite en de strict-ratchet eroverheen gaan.

/** Verticale uitsnede van een element dat niet doormidden geknipt mag worden.
 *  Posities zijn pixels ten opzichte van de bovenkant van het document. */
export interface PdfBlok {
  top: number
  bottom: number
}

/** Eén pagina: welk stuk van de lange afbeelding erop komt. */
export interface PdfPagina {
  top: number
  hoogte: number
}

/**
 * Deelt een document van `totaleHoogte` pixels op in pagina's van hooguit
 * `paginaHoogte` pixels, zonder een blok doormidden te knippen.
 *
 * Valt de knip binnen een blok, dan schuift hij omhoog naar het begin van dat
 * blok — het blok gaat dan in zijn geheel naar de volgende pagina. Dat mag
 * niet oneindig doorgaan: zou de pagina daardoor minder dan `minVulling` van
 * haar hoogte vullen (denk aan een tabel die zelf hoger is dan een pagina),
 * dan knippen we tóch hard. Een halve regel is dan het minste kwaad; een lege
 * pagina of een oneindige lus is het grootste.
 */
export function paginaIndeling(
  totaleHoogte: number,
  paginaHoogte: number,
  blokken: PdfBlok[] | null | undefined = [],
  minVulling = 0.2,
): PdfPagina[] {
  if (!(totaleHoogte > 0) || !(paginaHoogte > 0)) return []

  // Alleen blokken die ergens in het document liggen en echt hoogte hebben;
  // een blok van nul pixels kan per definitie niet doorgeknipt worden.
  const gesorteerd = (blokken || [])
    .filter(b => b && Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
    .sort((a, b) => a.top - b.top)

  const paginas: PdfPagina[] = []
  const ondergrens = paginaHoogte * Math.min(Math.max(minVulling, 0), 1)
  let cursor = 0

  // Harde bovengrens op het aantal pagina's: zonder vooruitgang stopt de lus
  // hoe dan ook, ook als er ooit een rare blokopgave binnenkomt.
  const maxPaginas = Math.ceil(totaleHoogte / paginaHoogte) + gesorteerd.length + 1

  while (cursor < totaleHoogte && paginas.length < maxPaginas) {
    const ideaal = cursor + paginaHoogte
    if (ideaal >= totaleHoogte) {
      paginas.push({top: cursor, hoogte: totaleHoogte - cursor})
      break
    }

    // Het eerste blok waar de knip middenin valt bepaalt de uitwijk: alles
    // vanaf de bovenkant van dat blok gaat mee naar de volgende pagina.
    const doorsneden = gesorteerd.find(b => b.top < ideaal && b.bottom > ideaal)
    const uitwijk = doorsneden ? doorsneden.top : ideaal
    const knip = uitwijk - cursor >= ondergrens ? uitwijk : ideaal

    paginas.push({top: cursor, hoogte: knip - cursor})
    cursor = knip
  }

  return paginas
}
