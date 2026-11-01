export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Grijs via CSS-variabelen (`--grijs-*`, RGB-drietallen in index.css):
        // standaard exact het grijs van Tailwind, een thema kan er een eigen
        // schaal van maken (Craftery: warm, met 400/500 op 4,5:1 — craftery.css).
        gray: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
            .map(n => [n, `rgb(var(--grijs-${n}) / <alpha-value>)`]),
        ),
        // Oranje = "let op" (waarschuwing, BTW, overige kosten). Standaard het
        // oranje van Tailwind; Craftery maakt er roest van, zodat een
        // waarschuwing niet op de amber knoppen lijkt.
        orange: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
            .map(n => [n, `rgb(var(--oranje-${n}) / <alpha-value>)`]),
        ),
        brew: {
          50:  '#fef9f0',
          100: '#fef0d6',
          200: '#fcdda8',
          300: '#f9c170',
          400: '#f59e3a',
          500: '#f27d14',
          600: '#e35f09',
          700: '#bc450a',
          800: '#963710',
          900: '#792e10',
          950: '#411508',
        },
      },
      // Tapdoelen als token: `min-h-tap` (44 px, ondergrens voor alles wat je
      // met een vinger raakt), `min-h-tapLg` (48 px, de primaire actie).
      spacing: {
        tap: '2.75rem',
        tapLg: '3rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)',
        'card-lg': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}
