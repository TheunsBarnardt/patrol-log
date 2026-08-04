/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Wierdabrug CPF logo palette
          primary: "#0B3D8C",
          primarySoft: "#E8F0FA",
          primaryDark: "#072C66",
          accent: "#E30613",
          yellow: "#F5C518",
          green: "#1E7A3A",
          greenSoft: "#E8F6EC",
          ink: "#0B1220",
          muted: "#5B6B85",
          line: "#D7E0EE",
          canvas: "#F3F6FB",
          // semantic aliases used across pages
          info: "#0B3D8C",
          danger: "#E30613",
          warning: "#F5C518",
          success: "#1E7A3A",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 61, 140, 0.04), 0 8px 24px rgba(11, 61, 140, 0.06)",
        soft: "0 10px 30px rgba(11, 61, 140, 0.10)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
