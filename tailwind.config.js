/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#0b0e14",
        card: "#121721",
        border: "#1e2638",
        accent: "#38bdf8",
        meteora: {
          cyan: "#00f0ff",
          purple: "#9d4edd",
          orange: "#ff8400",
          green: "#10b981",
          red: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
