/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        panel: '0 18px 50px rgba(28, 49, 31, 0.12)'
      }
    }
  },
  plugins: []
};
