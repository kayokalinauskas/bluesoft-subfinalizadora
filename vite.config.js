import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/bluesoft-subfinalizadora/",
  plugins: [tailwindcss()],
  optimizeDeps: { include: ["xlsx"] },
  build: {
    sourcemap: false,
  },
});
