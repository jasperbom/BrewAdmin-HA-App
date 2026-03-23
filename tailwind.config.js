export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.08)',
      },
    },
  },
  plugins: [],
}
