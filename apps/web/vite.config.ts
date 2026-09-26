import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": process.env.TEST_API_ORIGIN || "http://127.0.0.1:3001" },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(webRoot, "index.html"),
        instrumentLab: resolve(webRoot, "instrument-lab.html"),
      },
    },
  },
});
