import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8f5ff',   // page bg  — clearly light blue, not near-white
          100: '#cce9fb',   // borders  — visibly blue on white cards
          200: '#99d3f7',   // accents
          300: '#57b8f0',
          400: '#239de6',
          500: '#0783cc',   // focus rings
          600: '#0270b5',   // primary buttons / links — confident corporate blue
          700: '#005d97',   // hover states
          800: '#004c7c',
          900: '#003c62',
          950: '#002744',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
