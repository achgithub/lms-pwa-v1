/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: { DEFAULT: '#818cf8', hover: '#6d79f5', dim: 'rgba(129,140,248,0.18)' },
        emerald: { DEFAULT: '#34d399', dim: 'rgba(52,211,153,0.12)' },
      },
      fontFamily: {
        sans: ['Inter', 'Atkinson Hyperlegible', 'system-ui', 'sans-serif'],
      },
      maxWidth: { app: '600px' },
    },
  },
  plugins: [],
}
