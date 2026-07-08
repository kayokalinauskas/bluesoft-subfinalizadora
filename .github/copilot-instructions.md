# Bluesoft Subfinalizadora — Frontend

## Overview

Single-page application (SPA) in vanilla JavaScript for sending "mapa de subfinalizadora" records to the Bluesoft ERP REST API. Uses a Vercel serverless proxy (separate repo) to bypass CORS. Deployed to GitHub Pages.

**This is the frontend-only repository.** The CORS proxy lives in a separate GitHub repo. Do not add backend logic here — `ApiService` calls the proxy URL in `CONFIG.PROXY_URL` and that is the only coupling between the two repos.

---

## Build & Dev

```bash
npm run dev       # Vite dev server (http://localhost:5173/bluesoft-subfinalizadora/)
npm run build     # Production build (outputs to dist/)
npm run preview   # Preview the production build locally
```

Base path for GitHub Pages: `/bluesoft-subfinalizadora/` (set in `vite.config.js`).

### Environment variables

All configuration that varies per environment lives in `.env`:

```
VITE_PROXY_URL=https://...vercel.app/api/proxy
```

`import.meta.env.VITE_PROXY_URL` is read in `src/config.js`. If the variable is missing, a `console.warn` fires at startup. Never put secrets in `.env` — Vite embeds `VITE_*` vars in the client bundle.

---

## Module Structure

```
src/
  main.js                     — Entry point: DOMContentLoaded → new BluesoftIntegrationApp().init()
  config.js                   — CONFIG constants + DOM_ELEMENTS cache (both exported)
  app.js                      — BluesoftIntegrationApp: event wiring, UI orchestration
  state.js                    — AppState: in-memory state + localStorage persistence
  style.css                   — Custom Tailwind @theme tokens
  workers/
    excel.worker.js           — Web Worker (Vite-bundled via ?worker import)
  services/
    api.js                    — ApiService: POSTs to proxy
    storage.js                — StorageManager: localStorage wrapper
  processors/
    dataProcessor.js          — DataProcessor: CSV/Excel parsing + row→payload mapping
    validator.js              — DataValidator: validates API payload shape
  ui/
    alerts.js                 — AlertManager: toast notifications + escapeHtml
```

### Module responsibilities

| Module | Class | Responsibility |
|---|---|---|
| `config.js` | — | `CONFIG` (constants/URLs) and `DOM_ELEMENTS` (cached selectors). **All** magic numbers and DOM refs live here. |
| `app.js` | `BluesoftIntegrationApp` | Mounts all event listeners, tab switching, UI orchestration. Coordinates the other classes. |
| `state.js` | `AppState` | Owns `fileData`, `processingResults`, `history`. Persists history to localStorage. |
| `services/api.js` | `ApiService` | `sendData(tenant, token, data)` — POSTs to the Vercel proxy. |
| `services/storage.js` | `StorageManager` | `get/set/remove` localStorage wrapper with try/catch. |
| `processors/dataProcessor.js` | `DataProcessor` | Parses CSV (`PapaParse worker:true`) and Excel (Vite Web Worker). Maps row fields → API payload via `convertRowToJson`. |
| `processors/validator.js` | `DataValidator` | `validateSubmissionData(data)` — validates the API payload before sending. |
| `ui/alerts.js` | `AlertManager` | `show(message, type)` — auto-dismissing toasts. `escapeHtml(str)` — always use this before injecting user-controlled strings into innerHTML. |
| `workers/excel.worker.js` | — | Runs XLSX parsing off the main thread. Imported as `import ExcelWorker from '...?worker'` in `dataProcessor.js`. |

---

## Key Conventions

### CONFIG and DOM_ELEMENTS

Both are exported from `src/config.js` and populated at module initialization time. This is safe because `type="module"` scripts are deferred — the DOM is fully parsed before any module executes.

```js
// ALWAYS import from config.js — never use document.getElementById inline
import { CONFIG, DOM_ELEMENTS } from './config.js';
```

- **New constant** (URL, timeout, limit) → add to `CONFIG` in `src/config.js`
- **New DOM element** → add to `DOM_ELEMENTS` in `src/config.js` before referencing it

### API proxy

`CONFIG.PROXY_URL` receives the real ERP URL as `?url=<encoded>`. Authentication via `X-Customtoken` header. The proxy lives in a separate Vercel repo — notify its owner if the allowed origin changes.

### UI language and styling

- All labels, messages, and code comments: **Portuguese**
- Styling: **Tailwind CSS v4** utility classes in `index.html`; no component CSS except `src/style.css`
- Custom color tokens in `src/style.css` under `@theme`: `--color-primary`, `--color-secondary`, `--color-success`, `--color-danger`, `--color-warning`, `--color-info`
- Icons: **Font Awesome 6** via CDN (`fas fa-*`)

### File parsing (performance)

- **Excel**: parsed in a dedicated Vite Web Worker (`excel.worker.js`). Worker has a 60-second timeout with a `settle` guard (Promise resolves/rejects exactly once). XLSX flags `cellDates/cellNF/cellHTML/cellStyles: false` + `dense: true` for speed.
- **CSV**: parsed by PapaParse with `worker: true` (PapaParse's internal worker).
- Neither parser blocks the main thread.

### Button guard pattern

`processFileBtn` is disabled during:
1. File loading (`handleFileUpload`) — re-enabled in `finally`
2. API processing (`showProcessingUI`) — re-enabled in `showResults`

This prevents double-fire. Follow the same pattern for any new async action tied to a button.

### Security

- Always use `AlertManager.escapeHtml()` when interpolating user-controlled or API-returned strings into `innerHTML` templates. Plain `.textContent` is always safe — prefer it for simple nodes.
- The token is stored in `localStorage` in plain text — acceptable for this tool's threat model, but **never log it**.
- `window.app` is only exposed when `import.meta.env.DEV` is true.

---

## API Payload Shape

```json
{
  "tipoTef": "SITEF" | "POS",
  "codigoBandeira": <integer>,
  "tipoCartao": "CARTAO_DEBITO" | "CARTAO_CREDITO" | "CARTAO_VOUCHER" | "CARTAO_PARCELADO",
  "codigoAdministradora": "<string>",
  "subFinalizadoraKey": <integer>
}
```

Validation: `DataValidator.validateSubmissionData()` in `src/processors/validator.js`.  
Mapping: `DataProcessor.convertRowToJson()` in `src/processors/dataProcessor.js`.

---

## File Format (CSV / Excel)

Required columns (snake_case):

| Column | Type | Notes |
|---|---|---|
| `sub_finalizadora_key` | INTEGER | |
| `codigo_autorizadora` ou `codigo_administradora` | STRING | Aceita ambos; `codigo_autorizadora` tem prioridade |
| `codigo_bandeira` | INTEGER | |
| `tipo_tef_key` | INTEGER | 1 = SITEF, 2 = POS |
| `tipo_cartao` | STRING | Substring match (case-insensitive): "parcelado" → `CARTAO_PARCELADO` (checked first), "crédito"/"credito" → `CARTAO_CREDITO`, "voucher" → `CARTAO_VOUCHER`; default = `CARTAO_DEBITO` |

---

## Adding New Features — Checklist

### New tab

1. Add `<button class="tab-button" data-tab="<name>">` inside `<!-- Tabs Navigation -->` in `index.html`
2. Add `<div class="tab-content hidden fade-in" id="<name>-tab">` content block in `index.html`
3. The existing `setupTabs()` in `app.js` picks it up automatically — no code change needed there

### New API field

Touch these three files together:
1. `src/processors/validator.js` — add validation rule in `validateSubmissionData`
2. `src/processors/dataProcessor.js` — add mapping in `convertRowToJson`
3. `src/services/api.js` — include in the request body in `sendData` (if the field isn't already part of the payload object)

### New DOM element

Add to `DOM_ELEMENTS` in `src/config.js`:
```js
myNewElement: document.getElementById("myNewElement"),
```
Then import `DOM_ELEMENTS` wherever you need it.

### New npm package

```bash
npm install <package>
```
Import directly in the module that needs it. Do **not** use CDN `<script>` tags for new libraries — Vite handles bundling.

### New async button action

```js
DOM_ELEMENTS.myBtn.disabled = true;
try {
  await doSomethingAsync();
} finally {
  DOM_ELEMENTS.myBtn.disabled = false;
}
```

---

## External Libraries

| Library | How loaded | Used in |
|---|---|---|
| `xlsx@^0.18` | npm (bundled by Vite into `excel.worker` chunk) | `src/workers/excel.worker.js` |
| `papaparse@^5.4` | npm (bundled into main chunk) | `src/processors/dataProcessor.js` |
| Font Awesome 6 | CDN `<link>` in `index.html` | `index.html` (icons) |
| Tailwind CSS v4 | npm via `@tailwindcss/vite` plugin | `index.html`, `src/style.css` |
