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
          50:  '#f0f7ff',   // page bg  — clean, barely-perceptible blue-white
          100: '#d6e8fc',   // borders
          200: '#aacdf5',   // accents
          300: '#68aff0',
          400: '#2d8fdf',
          500: '#0a73cc',   // focus rings
          600: '#0a5ca0',   // primary buttons — slightly deeper corporate blue
          700: '#084d87',   // hover states
          800: '#063d6e',
          900: '#042d52',
          950: '#021d38',
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
