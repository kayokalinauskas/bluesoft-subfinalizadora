# Bluesoft Subfinalizadora — Frontend

## Overview

Single-page application (SPA) in vanilla JavaScript for sending "mapa de subfinalizadora" records to the Bluesoft ERP REST API. Uses a Vercel serverless proxy (separate repo) to bypass CORS. Deployed to GitHub Pages.

**This is the frontend-only repository.** The CORS proxy lives in a separate GitHub repo. Do not add backend logic here — `ApiService` calls the proxy URL in `CONFIG.PROXY_URL` and that is the only coupling between the two repos.

## Build & Dev

```bash
npm run dev       # Vite dev server
npm run build     # Production build (outputs to dist/)
npm run preview   # Preview the production build locally
```

Base path for GitHub Pages: `/bluesoft-subfinalizadora/` (set in `vite.config.js`).

## Architecture

All application code lives in two files: `index.html` and `src/main.js`.

### Class responsibilities (`src/main.js`)

| Class | Responsibility |
|---|---|
| `StorageManager` | `localStorage` read/write/remove wrapper |
| `AlertManager` | Creates and auto-dismisses toast notifications; `escapeHtml(str)` for sanitizing user-controlled strings in HTML |
| `DataValidator` | Validates the API payload shape before sending |
| `DataProcessor` | Parses CSV (via PapaParse) and Excel (via SheetJS/XLSX) into row arrays, and maps row fields to API payload |
| `ApiService` | POSTs to the Vercel proxy, which forwards to the Bluesoft ERP endpoint |
| `AppState` | In-memory state (`fileData`, `processingResults`, `history`), persists history to localStorage |
| `BluesoftIntegrationApp` | Main controller: mounts event listeners, tab switching, UI orchestration |

### Constants

- `CONFIG` — top-level object for all magic numbers/URLs (proxy URL, delays, limits, display times)
- `DOM_ELEMENTS` — top-level object caching all `getElementById` / `querySelectorAll` results

**Always update `CONFIG` or `DOM_ELEMENTS` rather than adding inline `document.getElementById` calls.**

### API proxy

Proxy URL is `CONFIG.PROXY_URL`. The proxy appends the real Bluesoft target URL as a query parameter (`?url=`). Authentication uses the `X-Customtoken` header.

## UI Conventions

- Language: **Portuguese** for all UI labels, messages, and code comments
- Styling: **Tailwind CSS v4** applied directly as utility classes in `index.html`; no separate component CSS except `src/style.css`
- Custom color tokens defined in `src/style.css` under `@theme`: `--color-primary`, `--color-secondary`, `--color-success`, `--color-danger`, `--color-warning`, `--color-info`
- Icons: **Font Awesome 6** via CDN (class prefix `fas fa-*`)
- Tab system: buttons have `data-tab` attribute; content `<div>`s have `id="{tabId}-tab"`; active state toggled via `.active` class and `border-primary` / `bg-blue-50` CSS classes

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

Validation logic lives in `DataValidator.validateSubmissionData()`.

## File Format (CSV/Excel)

Required columns (snake_case):

| Column | Type | Notes |
|---|---|---|
| `sub_finalizadora_key` | INTEGER | |
| `codigo_autorizadora` ou `codigo_administradora` | STRING | Aceita ambos os nomes; `codigo_autorizadora` tem prioridade |
| `codigo_bandeira` | INTEGER | |
| `tipo_tef_key` | INTEGER | 1 = SITEF, 2 = POS |
| `tipo_cartao` | STRING | "crédito", "credito", "voucher", "parcelado" → mapped; default = CARTAO_DEBITO |

## Watch Out For

- The token is stored in `localStorage` in plain text — acceptable for this tool's threat model, but avoid logging it.
- `window.app` is exposed globally for debugging; do not rely on it in production code.
- Always use `AlertManager.escapeHtml()` when interpolating user-controlled or API-returned strings into innerHTML templates.

## Adding New Features — Checklist

- [ ] **New tab**: add `<button class="tab-button" data-tab="<name>">` in `<!-- Tabs Navigation -->`, add `<div class="tab-content hidden fade-in" id="<name>-tab">` content block, and register via the existing `setupTabs()` mechanism.
- [ ] **New API field**: update `DataValidator.validateSubmissionData`, `DataProcessor.convertRowToJson`, and `ApiService.sendData` together.
- [ ] **New DOM element**: add to `DOM_ELEMENTS` before referencing it anywhere.
- [ ] **New constant** (URL, limit, timeout): add to `CONFIG`.
- [ ] **Proxy origin change**: notify the backend repo owner to update `ALLOWED_ORIGINS` and redeploy to Vercel.

## External Libraries (CDN, no npm install)

- `xlsx@0.18.5` — Excel parsing (`XLSX` global)
- `papaparse@5.4.1` — CSV parsing (`Papa` global)
- `font-awesome@6.4.0` — Icons
