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
          50:  '#eff6ff',   // page bg — Tailwind blue-50
          100: '#dbeafe',   // borders
          200: '#bfdbfe',   // accents
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',   // focus rings
          600: '#1d4ed8',   // primary buttons — deep corporate royal blue
          700: '#1e40af',   // hover states
          800: '#1e3a8a',
          900: '#1e3272',
          950: '#172554',
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
