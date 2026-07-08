// Configurações e constantes
const CONFIG = {
  PROXY_URL: "https://nodejs-serverless-function-express-blue-seven-39.vercel.app/api/proxy",
  MAX_HISTORY_ITEMS: 60,
  API_DELAY_MS: 100,
  PREVIEW_ROWS_LIMIT: 10,
  ALERT_DISPLAY_TIME: 3000,
};

const DOM_ELEMENTS = {
  tenantInput: document.getElementById("tenant"),
  tokenInput: document.getElementById("token"),
  saveSettingsBtn: document.getElementById("saveSettings"),
  clearSettingsBtn: document.getElementById("clearSettings"),
  fileInput: document.getElementById("fileInput"),
  csvOptions: document.getElementById("csvOptions"),
  hasHeader: document.getElementById("hasHeader"),
  filePreview: document.getElementById("filePreview"),
  previewBody: document.getElementById("previewBody"),
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

// Classes
class StorageManager {
  static get(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error(`Erro ao ler do localStorage: ${error}`);
      return null;
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error(`Erro ao salvar no localStorage: ${error}`);
      throw new Error("Falha ao salvar configurações");
    }
  }

  static remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Erro ao remover do localStorage: ${error}`);
    }
  }
}

class AlertManager {
  static escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  static show(message, type = "info") {
    const typeConfig = {
      success: { bg: "bg-green-100", text: "text-green-800", border: "border-green-200", icon: "fa-check-circle" },
      warning: { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-200", icon: "fa-exclamation-triangle" },
      error:   { bg: "bg-red-100",   text: "text-red-800",   border: "border-red-200",   icon: "fa-exclamation-circle" },
      info:    { bg: "bg-blue-100",  text: "text-blue-800",  border: "border-blue-200",  icon: "fa-info-circle" },
    };

    const config = typeConfig[type] || typeConfig.info;

    const alertDiv = document.createElement("div");
    alertDiv.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 max-w-sm ${config.bg} ${config.text} ${config.border}`;

    const inner = document.createElement("div");
    inner.className = "flex items-center";
    inner.innerHTML = `<i class="fas ${config.icon} mr-2"></i>`;
    const span = document.createElement("span");
    span.textContent = message;
    inner.appendChild(span);
    alertDiv.appendChild(inner);

    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), CONFIG.ALERT_DISPLAY_TIME);
  }
}

class DataValidator {
  static validateSubmissionData(data) {
    const errors = [];

    if (!data.tipoTef || !["SITEF", "POS"].includes(data.tipoTef)) {
      errors.push("Tipo TEF inválido. Deve ser 'SITEF' ou 'POS'");
    }

    if (!data.codigoBandeira || isNaN(data.codigoBandeira) || data.codigoBandeira <= 0) {
      errors.push("Código Bandeira inválido");
    }

    const validTiposCartao = ["CARTAO_DEBITO", "CARTAO_CREDITO", "CARTAO_VOUCHER", "CARTAO_PARCELADO"];
    if (!data.tipoCartao || !validTiposCartao.includes(data.tipoCartao)) {
      errors.push("Tipo Cartão inválido");
    }

    if (!data.codigoAdministradora || data.codigoAdministradora.trim() === "") {
      errors.push("Código Administradora inválido");
    }

    if (!data.subFinalizadoraKey || isNaN(data.subFinalizadoraKey) || data.subFinalizadoraKey <= 0) {
      errors.push("Subfinalizadora Key inválida");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

class DataProcessor {
  static convertRowToJson(row) {
    const tipoTef = this.mapTipoTef(row.tipo_tef_key);
    const tipoCartao = this.mapTipoCartao(row.tipo_cartao);

    return {
      tipoTef,
      codigoBandeira: parseInt(row.codigo_bandeira, 10),
      tipoCartao,
      codigoAdministradora: String(row.codigo_autorizadora ?? row.codigo_administradora ?? ""),
      subFinalizadoraKey: parseInt(row.sub_finalizadora_key, 10),
    };
  }

  static mapTipoTef(tipoTefKey) {
    const mapping = { 1: "SITEF", 2: "POS" };
    return mapping[tipoTefKey] || "POS";
  }

  static mapTipoCartao(tipoCartao) {
    if (!tipoCartao) return "CARTAO_DEBITO";

    const tipo = tipoCartao.toLowerCase();
    const mapping = {
      crédito: "CARTAO_CREDITO",
      credito: "CARTAO_CREDITO",
      voucher: "CARTAO_VOUCHER",
      parcelado: "CARTAO_PARCELADO",
    };

    for (const [key, value] of Object.entries(mapping)) {
      if (tipo.includes(key)) return value;
    }

    return "CARTAO_DEBITO";
  }

  static async processFile(file, hasHeader) {
    if (file.name.endsWith(".csv") || file.type === "text/csv") {
      return await this.processCSV(file, hasHeader);
    } else {
      return await this.processExcel(file);
    }
  }

  static processCSV(file, hasHeader) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const results = Papa.parse(e.target.result, {
            header: hasHeader,
            skipEmptyLines: true,
            dynamicTyping: false,
            encoding: "UTF-8",
          });

          if (results.errors.length > 0) {
            reject(new Error(`Erros no parsing do CSV: ${results.errors.map((e) => e.message).join(", ")}`));
            return;
          }

          resolve(results.data);
        } catch (error) {
          reject(new Error(`Falha ao processar CSV: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsText(file, "UTF-8");
    });
  }

  static processExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          resolve(jsonData);
        } catch (error) {
          reject(new Error(`Falha ao processar Excel: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsArrayBuffer(file);
    });
  }
}

class ApiService {
  static async sendData(tenant, token, data) {
    const targetUrl = `https://erp.bluesoft.com.br/${tenant}/api/financeiro/mapa-subfinalizadora`;
    const encodedUrl = encodeURIComponent(targetUrl);
    const proxyUrl = `${CONFIG.PROXY_URL}?url=${encodedUrl}`;

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Customtoken": token,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return await response.json();
  }

  static async handleErrorResponse(response) {
    let errorMessage = `Erro ${response.status}`;

    try {
      const errorData = await response.json();
      errorMessage = errorData.details?.message || errorData.message || errorMessage;
    } catch (e) {
      errorMessage = `${errorMessage}: ${response.statusText}`;
    }

    throw new Error(errorMessage);
  }
}

// Estado da aplicação
class AppState {
  constructor() {
    this.fileData = [];
    this.processingResults = [];
    this.history = [];
  }

  addHistoryItem(type, data, success, message = "") {
    const historyItem = {
      timestamp: new Date().toISOString(),
      type,
      data,
      success,
      message,
    };

    this.history.unshift(historyItem);

    if (this.history.length > CONFIG.MAX_HISTORY_ITEMS) {
      this.history.pop();
    }

    this.saveHistory();
  }

  saveHistory() {
    StorageManager.set("bluesoftHistory", JSON.stringify(this.history));
  }

  loadHistory() {
    const savedHistory = StorageManager.get("bluesoftHistory");
    if (savedHistory) {
      try {
        this.history = JSON.parse(savedHistory);
      } catch (error) {
        console.error("Erro ao carregar histórico:", error);
        this.history = [];
      }
    }
  }

  clearHistory() {
    this.history = [];
    StorageManager.remove("bluesoftHistory");
  }
}

// Classe principal da aplicação
class BluesoftIntegrationApp {
  constructor() {
    this.state = new AppState();
  }

  init() {
    this.loadSettings();
    this.state.loadHistory();
    this.setupEventListeners();
    this.setupTabs();
    this.renderHistory();
  }

  loadSettings() {
    DOM_ELEMENTS.tenantInput.value = StorageManager.get("bluesoftTenant") || "";
    DOM_ELEMENTS.tokenInput.value = StorageManager.get("bluesoftToken") || "";
  }

  setupEventListeners() {
    DOM_ELEMENTS.saveSettingsBtn.addEventListener("click", () => this.saveSettings());
    DOM_ELEMENTS.clearSettingsBtn.addEventListener("click", () => this.clearSettings());
    DOM_ELEMENTS.fileInput.addEventListener("change", (e) => this.handleFileUpload(e));
    DOM_ELEMENTS.processFileBtn.addEventListener("click", () => this.processFileData());
    DOM_ELEMENTS.downloadReportBtn.addEventListener("click", () => this.downloadReport());
    DOM_ELEMENTS.manualForm.addEventListener("submit", (e) => this.handleManualSubmit(e));
    DOM_ELEMENTS.clearHistoryBtn.addEventListener("click", () => this.clearHistory());
  }

  setupTabs() {
    DOM_ELEMENTS.tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tabId = button.getAttribute("data-tab");
        this.switchTab(tabId, button);
      });
    });
  }

  switchTab(tabId, activeButton) {
    // Atualizar botões da aba
    DOM_ELEMENTS.tabButtons.forEach((btn) => {
      btn.classList.remove("border-primary", "text-primary", "bg-blue-50");
      btn.classList.add("border-transparent", "text-gray-600");
    });

    activeButton.classList.remove("border-transparent", "text-gray-600");
    activeButton.classList.add("border-primary", "text-primary", "bg-blue-50");

    DOM_ELEMENTS.tabContents.forEach((content) => content.classList.remove("active"));
    document.getElementById(`${tabId}-tab`).classList.add("active");
  }

  saveSettings() {
    const tenant = DOM_ELEMENTS.tenantInput.value.trim();
    const token = DOM_ELEMENTS.tokenInput.value.trim();

    if (!tenant || !token) {
      AlertManager.show("Por favor, preencha ambos os campos: Tenant e Token", "warning");
      return;
    }

    try {
      StorageManager.set("bluesoftTenant", tenant);
      StorageManager.set("bluesoftToken", token);
      AlertManager.show("Configurações salvas com sucesso!", "success");
    } catch (error) {
      AlertManager.show(error.message, "error");
    }
  }

  clearSettings() {
    if (confirm("Tem certeza que deseja limpar as configurações?")) {
      StorageManager.remove("bluesoftTenant");
      StorageManager.remove("bluesoftToken");
      DOM_ELEMENTS.tenantInput.value = "";
      DOM_ELEMENTS.tokenInput.value = "";
      AlertManager.show("Configurações removidas!", "success");
    }
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Mostrar/ocultar opções de CSV
    DOM_ELEMENTS.csvOptions.classList.toggle("hidden", !file.name.endsWith(".csv") && file.type !== "text/csv");

    try {
      this.state.fileData = await DataProcessor.processFile(file, DOM_ELEMENTS.hasHeader.checked);
      this.showFilePreview();
    } catch (error) {
      console.error("Erro no upload:", error);
      AlertManager.show(`Erro ao processar arquivo: ${error.message}`, "warning");
    }
  }

  showFilePreview() {
    if (this.state.fileData.length === 0) {
      AlertManager.show("O arquivo não contém dados válidos.", "warning");
      return;
    }

    const totalRows = this.state.fileData.length;
    this.state.fileData = this.state.fileData.filter((row) => {
      try {
        const jsonData = DataProcessor.convertRowToJson(row);
        return DataValidator.validateSubmissionData(jsonData).isValid;
      } catch {
        return false;
      }
    });

    const skipped = totalRows - this.state.fileData.length;
    if (skipped > 0) {
      AlertManager.show(`${skipped} linha(s) inválida(s) removida(s) do arquivo.`, "warning");
    }

    if (this.state.fileData.length === 0) {
      AlertManager.show("Nenhuma linha válida encontrada no arquivo. Verifique as colunas necessárias.", "warning");
      DOM_ELEMENTS.filePreview.classList.add("hidden");
      return;
    }

    DOM_ELEMENTS.previewBody.innerHTML = "";

    for (let i = 0; i < Math.min(this.state.fileData.length, CONFIG.PREVIEW_ROWS_LIMIT); i++) {
      const jsonData = DataProcessor.convertRowToJson(this.state.fileData[i]);
      DOM_ELEMENTS.previewBody.appendChild(this.createPreviewRow(jsonData));
    }

    this.addPreviewInfoRow();
    DOM_ELEMENTS.filePreview.classList.remove("hidden");
  }

  createPreviewRow(data) {
    const row = document.createElement("tr");

    ["tipoTef", "codigoBandeira", "tipoCartao", "codigoAdministradora", "subFinalizadoraKey"].forEach((field) => {
      const cell = document.createElement("td");
      cell.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
      cell.textContent = data[field];
      row.appendChild(cell);
    });

    return row;
  }

  addPreviewInfoRow() {
    if (this.state.fileData.length <= CONFIG.PREVIEW_ROWS_LIMIT) return;

    const infoRow = document.createElement("tr");
    const infoCell = document.createElement("td");
    infoCell.colSpan = 5;
    infoCell.className = "px-6 py-4 text-center text-sm text-gray-500";
    infoCell.textContent = `... e mais ${this.state.fileData.length - CONFIG.PREVIEW_ROWS_LIMIT} linhas`;
    infoRow.appendChild(infoCell);
    DOM_ELEMENTS.previewBody.appendChild(infoRow);
  }

  async processFileData() {
    if (!this.validateCredentials()) return;
    if (this.state.fileData.length === 0) {
      AlertManager.show("Nenhum dado para processar.", "warning");
      return;
    }

    this.showProcessingUI();
    await this.processAllRows();
  }

  validateCredentials() {
    const tenant = StorageManager.get("bluesoftTenant");
    const token = StorageManager.get("bluesoftToken");

    if (!tenant || !token) {
      AlertManager.show("Por favor, configure o Tenant e Token antes de enviar os dados.", "warning");
      return false;
    }

    return true;
  }

  showProcessingUI() {
    DOM_ELEMENTS.processingSection.classList.remove("hidden");
    DOM_ELEMENTS.resultsSection.classList.add("hidden");
    this.state.processingResults = [];
  }

  async processAllRows() {
    const tenant = StorageManager.get("bluesoftTenant");
    const token = StorageManager.get("bluesoftToken");
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < this.state.fileData.length; i++) {
      this.updateProgress(i, this.state.fileData.length);

      try {
        await this.processSingleRow(this.state.fileData[i], tenant, token);
        successCount++;
      } catch (error) {
        errorCount++;
      }

      await this.delay(CONFIG.API_DELAY_MS);
    }

    this.showResults(successCount, errorCount);
  }

  updateProgress(currentIndex, total) {
    const progress = Math.round(((currentIndex + 1) / total) * 100);
    DOM_ELEMENTS.progressBar.style.width = `${progress}%`;
    DOM_ELEMENTS.progressBar.textContent = `${progress}%`;
    DOM_ELEMENTS.progressText.textContent = `${progress}% (${currentIndex + 1}/${total})`;
  }

  async processSingleRow(row, tenant, token) {
    const jsonData = DataProcessor.convertRowToJson(row);
    const validation = DataValidator.validateSubmissionData(jsonData);

    if (!validation.isValid) {
      throw new Error(validation.errors[0]);
    }

    try {
      await ApiService.sendData(tenant, token, jsonData);

      this.state.processingResults.push({
        subFinalizadoraKey: jsonData.subFinalizadoraKey,
        status: "success",
        message: "Enviado com sucesso",
      });

      this.state.addHistoryItem("Arquivo", jsonData, true);
    } catch (error) {
      this.state.processingResults.push({
        subFinalizadoraKey: jsonData.subFinalizadoraKey,
        status: "error",
        message: error.message,
      });

      this.state.addHistoryItem("Arquivo", jsonData, false, error.message);
      throw error;
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  showResults(successCount, errorCount) {
    DOM_ELEMENTS.processingSection.classList.add("hidden");
    DOM_ELEMENTS.resultsSection.classList.remove("hidden");

    this.renderResultsTable();
    this.addResultsSummary(successCount, errorCount);
    this.renderHistory();
  }

  renderResultsTable() {
    DOM_ELEMENTS.resultsBody.innerHTML = "";

    this.state.processingResults.forEach((result) => {
      const row = document.createElement("tr");

      const keyCell = document.createElement("td");
      keyCell.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
      keyCell.textContent = result.subFinalizadoraKey;
      row.appendChild(keyCell);

      const statusCell = document.createElement("td");
      statusCell.className = `px-6 py-4 whitespace-nowrap text-sm font-medium ${
        result.status === "success" ? "text-green-600" : "text-red-600"
      }`;
      statusCell.textContent = result.status === "success" ? "Sucesso" : "Erro";
      row.appendChild(statusCell);

      const messageCell = document.createElement("td");
      messageCell.className = "px-6 py-4 text-sm text-gray-800";
      messageCell.textContent = result.message;
      row.appendChild(messageCell);

      DOM_ELEMENTS.resultsBody.appendChild(row);
    });
  }

  addResultsSummary(successCount, errorCount) {
    const summaryRow = document.createElement("tr");
    const summaryCell = document.createElement("td");
    summaryCell.colSpan = 3;
    summaryCell.className = "px-6 py-4 bg-blue-50 text-sm font-medium text-gray-800";
    summaryCell.textContent = `Resumo: ${successCount} sucesso(s), ${errorCount} erro(s)`;
    summaryRow.appendChild(summaryCell);
    DOM_ELEMENTS.resultsBody.appendChild(summaryRow);
  }

  downloadReport() {
    if (this.state.processingResults.length === 0) {
      AlertManager.show("Nenhum resultado para exportar.", "warning");
      return;
    }

    const csvContent = this.generateReportCSV();
    this.downloadCSV(csvContent, `relatorio_subfinalizadoras_${new Date().toISOString().split("T")[0]}.csv`);
    AlertManager.show("Relatório baixado com sucesso!", "success");
  }

  generateReportCSV() {
    const rows = ["Subfinalizadora,Status,Mensagem"];

    this.state.processingResults.forEach((result) => {
      const status = result.status === "success" ? "Sucesso" : "Erro";
      const message = result.message.replace(/"/g, '""');
      rows.push(`${result.subFinalizadoraKey},${status},"${message}"`);
    });

    return rows.join("\n");
  }

  downloadCSV(content, filename) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async handleManualSubmit(event) {
    event.preventDefault();

    if (!this.validateCredentials()) return;

    const formData = this.collectManualFormData();
    const validation = DataValidator.validateSubmissionData(formData);

    if (!validation.isValid) {
      this.showManualResult(validation.errors[0], false);
      return;
    }

    await this.submitManualForm(formData);
  }

  collectManualFormData() {
    return {
      tipoTef: DOM_ELEMENTS.manualTipoTef.value,
      codigoBandeira: parseInt(DOM_ELEMENTS.manualCodigoBandeira.value, 10),
      tipoCartao: DOM_ELEMENTS.manualTipoCartao.value,
      codigoAdministradora: DOM_ELEMENTS.manualCodigoAdministradora.value,
      subFinalizadoraKey: parseInt(DOM_ELEMENTS.manualSubFinalizadoraKey.value, 10),
    };
  }

  async submitManualForm(formData) {
    const tenant = StorageManager.get("bluesoftTenant");
    const token = StorageManager.get("bluesoftToken");

    try {
      await ApiService.sendData(tenant, token, formData);
      this.showManualResult("Dados enviados com sucesso!", true);
      this.state.addHistoryItem("Manual", formData, true);
      DOM_ELEMENTS.manualForm.reset();
    } catch (error) {
      this.showManualResult(`Erro ao enviar: ${error.message}`, false);
      this.state.addHistoryItem("Manual", formData, false, error.message);
    } finally {
      this.renderHistory();
    }
  }

  showManualResult(message, isSuccess) {
    DOM_ELEMENTS.manualResults.classList.remove("hidden");

    const bgClass = isSuccess ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
    const icon = isSuccess ? "fa-check-circle" : "fa-exclamation-triangle";

    DOM_ELEMENTS.manualResultMessage.className = `${bgClass} p-4 rounded-lg flex items-center`;
    DOM_ELEMENTS.manualResultMessage.innerHTML = `<i class="fas ${icon} mr-2"></i>`;
    const span = document.createElement("span");
    span.textContent = message;
    DOM_ELEMENTS.manualResultMessage.appendChild(span);
  }

  renderHistory() {
    if (this.state.history.length === 0) {
      DOM_ELEMENTS.historyList.innerHTML =
        '<p class="text-gray-500 text-center py-4">Nenhum envio registrado no histórico.</p>';
      return;
    }

    DOM_ELEMENTS.historyList.innerHTML = this.state.history.map((item) => this.createHistoryItemHTML(item)).join("");
  }

  createHistoryItemHTML(item) {
    const date = new Date(item.timestamp).toLocaleString();
    const statusClass = item.success ? "border-l-green-500 bg-green-50" : "border-l-red-500 bg-red-50";
    const statusIcon = item.success ? "fa-check-circle text-green-500" : "fa-times-circle text-red-500";
    const statusText = item.success ? "Sucesso" : "Falha";
    const messageLine = item.message
      ? `<p class="text-sm text-gray-600 mt-1"><span class="font-medium">Mensagem:</span> ${AlertManager.escapeHtml(item.message)}</p>`
      : "";

    return `
      <div class="history-item border-l-4 ${statusClass} p-4 mb-4 rounded-r-lg">
        <div class="flex justify-between items-start">
          <h3 class="font-medium text-gray-800">${date}</h3>
          <span class="flex items-center ${item.success ? "text-green-600" : "text-red-600"}">
            <i class="fas ${statusIcon} mr-1"></i> ${statusText}
          </span>
        </div>
        <p class="text-sm text-gray-600 mt-1"><span class="font-medium">Tipo:</span> ${AlertManager.escapeHtml(item.type)}</p>
        <p class="text-sm text-gray-600"><span class="font-medium">Subfinalizadora:</span> ${AlertManager.escapeHtml(String(item.data.subFinalizadoraKey))}</p>
        ${messageLine}
      </div>
    `;
  }

  clearHistory() {
    if (confirm("Tem certeza que deseja limpar todo o histórico?")) {
      this.state.clearHistory();
      this.renderHistory();
      AlertManager.show("Histórico limpo com sucesso!", "success");
    }
  }
}

// Inicialização da aplicação
document.addEventListener("DOMContentLoaded", function () {
  const app = new BluesoftIntegrationApp();
  app.init();
  window.app = app; // Para debugging, se necessário
});
