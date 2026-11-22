import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // System fonts keep local and hosted builds independent of Google Fonts.
        serif: ["Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      colors: {
        chalkboard: "#0D1512",
        panel: "#16211C",
        chalk: "#EDEAE0",
        role: {
          teacher: "#E3B23C",
          parent: "#A6567A",
          student: "#3E9C82",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
