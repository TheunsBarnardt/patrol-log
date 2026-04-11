/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#1ABC9C",
          info: "#2563EB",
          danger: "#E74C3C",
          warning: "#D4A017",
        },
      },
    },
  },
  plugins: [],
};
