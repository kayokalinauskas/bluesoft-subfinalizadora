// vite.config.js
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/bluesoft-subfinalizadora/", // 👈 coloque o nome do repositório aqui
  plugins: [tailwindcss()],
});
