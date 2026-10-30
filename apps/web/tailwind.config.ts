import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Necro-Ops spooky theme palette
        morgue: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          text: "#e2e8f0",
          muted: "#94a3b8",
        },
        "formaldehyde-green": {
          DEFAULT: "#39d353",
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#39d353",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
        "stitch-red": {
          DEFAULT: "#dc2626",
          light: "#ef4444",
          dark: "#991b1b",
        },
        severity: {
          info: "#60a5fa",
          warning: "#fbbf24",
          critical: "#ef4444",
        },
        source: {
          datadog: "#632ca6",
          k8s: "#326ce5",
          terraform: "#7b42bc",
          slack: "#4a154b",
          mock: "#0f766e",
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        flicker: "flicker 2s linear infinite",
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
          "25%, 75%": { opacity: "0.95" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
