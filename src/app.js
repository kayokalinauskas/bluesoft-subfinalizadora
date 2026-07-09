import { CONFIG, DOM_ELEMENTS } from "./config.js";
import { StorageManager } from "./services/storage.js";
import { AlertManager } from "./ui/alerts.js";
import { DataValidator } from "./processors/validator.js";
import { DataProcessor } from "./processors/dataProcessor.js";
import { ApiService } from "./services/api.js";
import { AppState } from "./state.js";

export class BluesoftIntegrationApp {
  static FIELD_ERROR_MAP = {
    tipoTef: /tipo tef/i,
    codigoBandeira: /bandeira/i,
    tipoCartao: /tipo cart/i,
    codigoAdministradora: /administradora/i,
    subFinalizadoraKey: /subfinalizadora key/i,
  };

  static PREVIEW_FIELDS = ["tipoTef", "codigoBandeira", "tipoCartao", "codigoAdministradora", "subFinalizadoraKey"];

  constructor() {
    this.state = new AppState();
    this._filtersSetup = false;
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

    DOM_ELEMENTS.csvOptions.classList.toggle("hidden", !file.name.endsWith(".csv") && file.type !== "text/csv");

    DOM_ELEMENTS.fileInput.disabled = true;
    DOM_ELEMENTS.processFileBtn.disabled = true;
    DOM_ELEMENTS.filePreview.classList.remove("hidden");
    DOM_ELEMENTS.previewBody.innerHTML =
      '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Processando arquivo...</td></tr>';

    try {
      this.state.fileData = await DataProcessor.processFile(file, DOM_ELEMENTS.hasHeader.checked);
      await this.showFilePreview();
    } catch (error) {
      console.error("Erro no upload:", error);
      AlertManager.show(`Erro ao processar arquivo: ${error.message}`, "warning");
      DOM_ELEMENTS.filePreview.classList.add("hidden");
    } finally {
      DOM_ELEMENTS.fileInput.disabled = false;
      DOM_ELEMENTS.processFileBtn.disabled = false;
    }
  }

  async showFilePreview() {
    if (this.state.fileData.length === 0) {
      AlertManager.show("O arquivo não contém dados válidos.", "warning");
      DOM_ELEMENTS.filePreview.classList.add("hidden");
      return;
    }

    const allRows = this.state.fileData;
    const CHUNK = 500;
    const tableRows = [];

    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      for (const originalRow of chunk) {
        const jsonData = DataProcessor.convertRowToJson(originalRow);
        const validation = DataValidator.validateSubmissionData(jsonData);
        tableRows.push({ jsonData, isValid: validation.isValid, errors: validation.errors, originalRow });
      }
      if (i + CHUNK < allRows.length) await new Promise((r) => setTimeout(r, 0));
    }

    const validCount = tableRows.filter((r) => r.isValid).length;
    const errorCount = tableRows.length - validCount;

    // Apenas linhas válidas são enviadas à API
    this.state.fileData = tableRows.filter((r) => r.isValid).map((r) => r.originalRow);

    if (validCount === 0) {
      AlertManager.show("Nenhuma linha válida encontrada no arquivo. Verifique as colunas necessárias.", "warning");
      DOM_ELEMENTS.filePreview.classList.add("hidden");
      return;
    }

    DOM_ELEMENTS.previewSummary.innerHTML =
      `<span class="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium"><i class="fas fa-check mr-1"></i>${validCount} válida${validCount !== 1 ? "s" : ""}</span>` +
      (errorCount > 0
        ? `<span class="px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium"><i class="fas fa-times mr-1"></i>${errorCount} com erro</span>`
        : "") +
      `<span class="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">${tableRows.length} total</span>`;

    DOM_ELEMENTS.previewBody.innerHTML = "";
    tableRows.forEach((item, idx) => {
      DOM_ELEMENTS.previewBody.appendChild(
        this.createPreviewRow(item.jsonData, idx + 1, item.isValid, item.errors)
      );
    });

    this.setupPreviewFilters();
    this.updatePreviewFilterInfo(tableRows.length, tableRows.length);
    DOM_ELEMENTS.filePreview.classList.remove("hidden");
  }

  createPreviewRow(data, rowIndex, isValid, errors) {
    const { FIELD_ERROR_MAP, PREVIEW_FIELDS } = BluesoftIntegrationApp;

    const row = document.createElement("tr");
    row.dataset.valid = isValid ? "ok" : "erro";
    row.className = isValid ? "hover:bg-gray-50" : "bg-red-50 hover:bg-red-100";

    const numCell = document.createElement("td");
    numCell.className = "px-3 py-3 text-xs text-gray-400 select-none w-10";
    numCell.textContent = rowIndex;
    row.appendChild(numCell);

    PREVIEW_FIELDS.forEach((field) => {
      const cell = document.createElement("td");
      const matchingError = errors.find((e) => FIELD_ERROR_MAP[field]?.test(e));

      if (matchingError) {
        cell.className = "px-3 py-3 whitespace-nowrap text-sm text-red-700 font-medium";
        cell.title = matchingError;
      } else {
        cell.className = "px-3 py-3 whitespace-nowrap text-sm text-gray-800";
      }

      cell.textContent = (data[field] !== null && data[field] !== undefined && data[field] !== "") ? data[field] : "—";
      row.appendChild(cell);
    });

    const statusCell = document.createElement("td");
    statusCell.className = "px-3 py-3 whitespace-nowrap text-xs w-28";

    if (isValid) {
      statusCell.innerHTML = '<span class="px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ OK</span>';
    } else {
      const tooltip = AlertManager.escapeHtml(errors.join(" | "));
      statusCell.innerHTML = `<span class="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium cursor-help" title="${tooltip}">✗ Erro</span>`;
    }

    row.appendChild(statusCell);
    return row;
  }

  setupPreviewFilters() {
    if (this._filtersSetup) return;
    this._filtersSetup = true;
    document.querySelectorAll(".preview-filter").forEach((el) => {
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => this.applyPreviewFilters());
    });
  }

  applyPreviewFilters() {
    const colFilters = {};
    let statusFilter = "";

    document.querySelectorAll(".preview-filter").forEach((el) => {
      const col = el.dataset.col;
      if (col === "status") {
        statusFilter = el.value;
      } else {
        colFilters[parseInt(col)] = el.value.trim().toLowerCase();
      }
    });

    const rows = DOM_ELEMENTS.previewBody.querySelectorAll("tr");
    let visibleCount = 0;

    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      let show = true;

      if (statusFilter && row.dataset.valid !== statusFilter) show = false;

      if (show) {
        Object.entries(colFilters).forEach(([colIdx, val]) => {
          if (!val) return;
          const cell = cells[parseInt(colIdx)];
          if (cell && !cell.textContent.toLowerCase().includes(val)) show = false;
        });
      }

      row.style.display = show ? "" : "none";
      if (show) visibleCount++;
    });

    this.updatePreviewFilterInfo(visibleCount, rows.length);
  }

  updatePreviewFilterInfo(visible, total) {
    DOM_ELEMENTS.previewFilterInfo.textContent =
      visible === total ? `${total} linha${total !== 1 ? "s" : ""}` : `${visible} de ${total} linhas`;
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
    DOM_ELEMENTS.processFileBtn.disabled = true;
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
      } catch {
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
    DOM_ELEMENTS.processFileBtn.disabled = false;

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
      codigoBandeira: DataProcessor.parseStrictInt(DOM_ELEMENTS.manualCodigoBandeira.value),
      tipoCartao: DOM_ELEMENTS.manualTipoCartao.value,
      codigoAdministradora: DOM_ELEMENTS.manualCodigoAdministradora.value,
      subFinalizadoraKey: DataProcessor.parseStrictInt(DOM_ELEMENTS.manualSubFinalizadoraKey.value),
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
