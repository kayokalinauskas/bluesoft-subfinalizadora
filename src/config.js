if (!import.meta.env.VITE_PROXY_URL) {
  console.warn("[config] VITE_PROXY_URL não está definida. Verifique o arquivo .env");
}

export const CONFIG = {
  PROXY_URL: import.meta.env.VITE_PROXY_URL,
  MAX_HISTORY_ITEMS: 60,
  API_DELAY_MS: 100,
  ALERT_DISPLAY_TIME: 3000,
};

export const DOM_ELEMENTS = {
  tenantInput: document.getElementById("tenant"),
  tokenInput: document.getElementById("token"),
  saveSettingsBtn: document.getElementById("saveSettings"),
  clearSettingsBtn: document.getElementById("clearSettings"),
  fileInput: document.getElementById("fileInput"),
  csvOptions: document.getElementById("csvOptions"),
  hasHeader: document.getElementById("hasHeader"),
  filePreview: document.getElementById("filePreview"),
  previewBody: document.getElementById("previewBody"),
  previewSummary: document.getElementById("previewSummary"),
  previewFilterInfo: document.getElementById("previewFilterInfo"),
  processFileBtn: document.getElementById("processFile"),
  processingSection: document.getElementById("processingSection"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  resultsSection: document.getElementById("resultsSection"),
  resultsBody: document.getElementById("resultsBody"),
  downloadReportBtn: document.getElementById("downloadReport"),
  manualForm: document.getElementById("manualForm"),
  manualResults: document.getElementById("manualResults"),
  manualResultMessage: document.getElementById("manualResultMessage"),
  historyList: document.getElementById("historyList"),
  clearHistoryBtn: document.getElementById("clearHistory"),
  tabButtons: document.querySelectorAll(".tab-button"),
  tabContents: document.querySelectorAll(".tab-content"),
  manualTipoTef: document.getElementById("tipoTef"),
  manualCodigoBandeira: document.getElementById("codigoBandeira"),
  manualTipoCartao: document.getElementById("tipoCartao"),
  manualCodigoAdministradora: document.getElementById("codigoAdministradora"),
  manualSubFinalizadoraKey: document.getElementById("subFinalizadoraKey"),
};
