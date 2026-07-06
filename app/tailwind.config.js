/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#ffffff', 2: '#a3a3a3', 3: '#666666' },
        hairline: '#262626',
        surface: { DEFAULT: '#0a0a0a', 2: '#111111' },
      },
    },
  },
  plugins: [],
}
