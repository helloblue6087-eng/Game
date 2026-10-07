/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#07060c",
          900: "#0b0913",
          850: "#110e1c",
          800: "#171325",
          700: "#221c36",
          600: "#2f2749",
        },
        accent: {
          DEFAULT: "#a06bff",
          soft: "#c4a3ff",
          dim: "#6d4bc4",
        },
        signal: {
          ok: "#3ddc97",
          warn: "#ffb454",
          danger: "#ff5d6c",
          info: "#5db8ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(160,107,255,0.25), 0 8px 40px -12px rgba(160,107,255,0.45)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.24,0.6,0.35,1) infinite",
        "fade-up": "fade-up 0.25s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
