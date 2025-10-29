import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/bluesoft-subfinalizadora/",
  plugins: [tailwindcss()],
  build: {
    sourcemap: false,
  },
});
