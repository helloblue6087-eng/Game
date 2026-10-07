import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Freebuff manages the preview port and requires HMR to stay disabled.
// `PORT` is injected by the platform; 5173 is only the local fallback.
const port = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port,
    strictPort: false,
    hmr: false,
    // The platform serves the app from its own generated hostname.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
