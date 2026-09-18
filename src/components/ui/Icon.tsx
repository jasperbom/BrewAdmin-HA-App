import React from 'react'

// Monochrome lijn-iconen (1em, currentColor) op de plekken waar eerder een
// emoji stond. Emoji's tekenen op elk platform anders, kleuren niet mee met
// het thema en ogen "gegenereerd"; een strakke lijn in de tekstkleur leest
// rustiger. Puur typografische tekens (✓ ✕ ✎ ✉ ⚠ ▶) blijven gewoon tekst.
// Nieuw icoon? Eén pad-string hier, nergens een losse <svg> in een pagina.
const PADEN: Record<string, string> = {
  package:     'M21 8l-9-5-9 5v8l9 5 9-5V8z M3 8l9 5 9-5 M12 13v8',
  paperclip:   'M21.4 11.05l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.66 5.66l-9.2 9.2a2 2 0 01-2.83-2.83l8.5-8.5',
  clipboard:   'M9 5H7a2 2 0 00-2 2v13a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 012-2h2a2 2 0 012 2 2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  thermometer: 'M14 14.76V5a2 2 0 10-4 0v9.76a4 4 0 104 0z',
  file:        'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z M14 3v5h5',
  brush:       'M18 3l3 3-9 9-3-3 9-9z M9 12l-5 5v4h4l5-5',
  beer:        'M6 4h9v16H6z M15 8h2a2 2 0 012 2v4a2 2 0 01-2 2h-2 M6 4l1-2h7l1 2',
  bottle:      'M10 2h4 M10 2v5l-2 3v11a1 1 0 001 1h6a1 1 0 001-1V10l-2-3V2',
  hourglass:   'M6 2h12 M6 22h12 M7 2v5l5 5-5 5v5 M17 2v5l-5 5 5 5v5',
  truck:       'M1 6h13v10H1z M14 10h4l3 3v3h-7 M6 19a2 2 0 100-4 2 2 0 000 4z M18 19a2 2 0 100-4 2 2 0 000 4z',
  home:        'M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10',
  hash:        'M4 9h16 M4 15h16 M10 3L8 21 M16 3l-2 18',
  euro:        'M19 6.5A8 8 0 1019 17.5 M3 10h12 M3 14h12',
  chart:       'M3 3v18h18 M8 17V9 M13 17V5 M18 17v-7',
  image:       'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z M8 11a2 2 0 100-4 2 2 0 000 4z M21 15l-5-5-8 8',
  bulb:        'M9 18h6 M10 22h4 M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z',
  sliders:     'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
  plug:        'M9 2v5 M15 2v5 M6 7h12v4a6 6 0 01-12 0V7z M12 17v5',
  calendar:    'M4 5h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z M3 10h18 M8 3v4 M16 3v4',
  link:        'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5 M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5',
  printer:     'M6 9V3h12v6 M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2 M6 14h12v7H6z',
  trash:       'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v6 M14 11v6',
  store:       'M3 9l1.5-5h15L21 9 M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0 M5 11v9h14v-9 M10 20v-5h4v5',
  bolt:        'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  info:        'M12 22a10 10 0 100-20 10 10 0 000 20z M12 16v-4 M12 8h.01',
  scan:        'M3 7V5a2 2 0 012-2h2 M17 3h2a2 2 0 012 2v2 M21 17v2a2 2 0 01-2 2h-2 M7 21H5a2 2 0 01-2-2v-2 M7 12h10',
  refresh:     'M21 12a9 9 0 11-3-6.7 M21 3v6h-6',
  sparkles:    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z',
  target:      'M12 22a10 10 0 100-20 10 10 0 000 20z M12 16a4 4 0 100-8 4 4 0 000 8z M12 12h.01',
  search:      'M11 19a8 8 0 100-16 8 8 0 000 16z M21 21l-4.3-4.3',
  receipt:     'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3z M9 8h6 M9 12h6',
  bank:        'M3 10l9-6 9 6 M4 10v9 M8 10v9 M12 10v9 M16 10v9 M20 10v9 M2 21h20',
  factory:     'M3 21V10l5 3V10l5 3V10l5 3V5h3v16H3z',
  building:    'M5 21V4a1 1 0 011-1h12a1 1 0 011 1v17 M2 21h20 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M9 15h2 M13 15h2',
  bell:        'M6 16V11a6 6 0 0112 0v5l2 2H4l2-2z M10 20a2 2 0 004 0',
  folder:      'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z',
  gear:        'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  download:    'M12 3v12 M7 10l5 5 5-5 M4 21h16',
}

export type IconNaam = keyof typeof PADEN

interface IconProps {
  n: IconNaam
  /** Extra klassen, bv. `text-4xl` voor een lege-staat-illustratie. */
  cls?: string
  /** Toegankelijke naam; zonder is het icoon decoratief (aria-hidden). */
  label?: string
}

const Icon: React.FC<IconProps> = ({ n, cls = '', label }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em"
    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={`inline-block align-[-0.125em] flex-shrink-0 ${cls}`}
    aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
    <path d={PADEN[n]} />
  </svg>
)

export default Icon
