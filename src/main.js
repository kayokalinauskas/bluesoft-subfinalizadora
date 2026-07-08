import { BluesoftIntegrationApp } from "./app.js";

document.addEventListener("DOMContentLoaded", function () {
  const app = new BluesoftIntegrationApp();
  app.init();
  if (import.meta.env.DEV) window.app = app;
});
