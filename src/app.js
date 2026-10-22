import { DOM_ELEMENTS } from "./config.js";
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
  static FIELD_LABELS = { tipoTef: "Tipo TEF", codigoBandeira: "Bandeira", tipoCartao: "Tipo de cartão", codigoAdministradora: "Administradora", subFinalizadoraKey: "Subfinalizadora" };

  constructor() {
    this.state = new AppState();
    this._filtersSetup = false;
    this.busy = false;
    this.review = null;
    this.fileHasErrors = false;
    this.workflowSource = "Arquivo";
    this.resultRows = new Map();
  }

  init() {
    this.loadSettings();
    this.state.loadHistory();
    this.setupEventListeners();
    this.setupTabs();
    this.renderHistory();
    this.setBusy(false);
  }

  loadSettings() {
    DOM_ELEMENTS.tenantInput.value = StorageManager.get("bluesoftTenant") || "";
    DOM_ELEMENTS.tokenInput.value = StorageManager.get("bluesoftToken") || "";
  }

  setupEventListeners() {
    DOM_ELEMENTS.saveSettingsBtn.addEventListener("click", () => this.saveSettings());
    DOM_ELEMENTS.clearSettingsBtn.addEventListener("click", () => this.clearSettings());
    DOM_ELEMENTS.fileInput.addEventListener("change", (e) => this.handleFileUpload(e));
    DOM_ELEMENTS.processFileBtn.addEventListener("click", () => this.workflowSource === "Manual"
      ? DOM_ELEMENTS.manualForm.requestSubmit() : this.processFileData());
    DOM_ELEMENTS.downloadReportBtn.addEventListener("click", () => this.downloadReport());
    DOM_ELEMENTS.manualForm.addEventListener("submit", (e) => this.handleManualSubmit(e));
    DOM_ELEMENTS.clearHistoryBtn.addEventListener("click", () => this.clearHistory());
    
    DOM_ELEMENTS.confirmReviewBtn.addEventListener("click", () => this.confirmReview());
    DOM_ELEMENTS.discardReviewBtn.addEventListener("click", () => {
      if (this.busy) this.isCancelled = true;
      else this.invalidateReview();
    });
    [DOM_ELEMENTS.tenantInput, DOM_ELEMENTS.tokenInput, DOM_ELEMENTS.manualForm].forEach(element => {
      element.addEventListener("input", () => this.invalidateReview());
      element.addEventListener("change", () => this.invalidateReview());
    });
    DOM_ELEMENTS.hasHeader.addEventListener("change", () => {
      if (DOM_ELEMENTS.fileInput.files.length) this.handleFileUpload({ target: DOM_ELEMENTS.fileInput });
    });

    DOM_ELEMENTS.cancelProcessingBtn.addEventListener("click", () => {
      this.isCancelled = true;
      DOM_ELEMENTS.cancelProcessingBtn.disabled = true;
      DOM_ELEMENTS.cancelProcessingBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Cancelando...';
    });
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
    if (this.busy) return;
    if (tabId === "upload" && this.workflowSource === "Manual") {
      this.mountWorkflow("Arquivo");
      this.invalidateReview();
    }
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
    this.invalidateReview();
    const tenant = DOM_ELEMENTS.tenantInput.value.trim();
    const token = DOM_ELEMENTS.tokenInput.value.trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(tenant) || !token) {
      AlertManager.show("Informe um tenant válido (letras, números, hífen ou sublinhado) e o token.", "warning");
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
      this.invalidateReview();
      StorageManager.remove("bluesoftTenant");
      StorageManager.remove("bluesoftToken");
      DOM_ELEMENTS.tenantInput.value = "";
      DOM_ELEMENTS.tokenInput.value = "";
      AlertManager.show("Configurações removidas!", "success");
    }
  }

  async handleFileUpload(event) {
    if (this.busy) return;
    this.invalidateReview();
    this.state.fileData = [];
    this.fileHasErrors = false;
    this.state.processingResults = [];
    this.resultRows.clear();
    const file = event.target.files[0];
    if (!file) {
      DOM_ELEMENTS.integrationFlow.classList.add("hidden");
      DOM_ELEMENTS.filePreview.classList.add("hidden");
      this.setBusy(false);
      return;
    }
    this.fileName = file.name;
    this.mountWorkflow("Arquivo");
    this.setWorkflowStage("reading", "Lendo e validando as linhas do arquivo…");
    this.setBusy(true);

    DOM_ELEMENTS.csvOptions.classList.toggle("hidden", !file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv");

    DOM_ELEMENTS.fileInput.disabled = true;
    DOM_ELEMENTS.processFileBtn.disabled = true;
    DOM_ELEMENTS.filePreview.classList.remove("hidden");
    DOM_ELEMENTS.previewBody.innerHTML =
      '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Processando arquivo...</td></tr>';

    try {
      this.state.fileData = await DataProcessor.processFile(file, DOM_ELEMENTS.hasHeader.checked);
      await this.showFilePreview();
      if (!this.state.fileData.length) this.showWorkflowBlock("O arquivo está vazio. Selecione um arquivo com registros.", "Arquivo");
      else this.setWorkflowStage("ready", this.fileHasErrors
        ? "Há linhas inválidas. Corrija o arquivo antes de continuar."
        : `${this.state.fileData.length} registros carregados. Valide a importação para conferir as alterações no ERP.`);
    } catch (error) {
      this.state.fileData = [];
      console.error("Erro no upload:", error);
      DOM_ELEMENTS.filePreview.classList.add("hidden");
      this.showWorkflowBlock(`Não foi possível ler o arquivo: ${error.message}`, "Arquivo");
    } finally {
      this.setBusy(false);
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

    // O lote inteiro precisa ser válido antes de consultar ou gravar.
    this.fileHasErrors = errorCount > 0;

    if (validCount === 0) {
      AlertManager.show("Nenhuma linha válida encontrada no arquivo. Verifique as colunas necessárias.", "warning");
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
    if (this.busy || !this.validateCredentials()) return;
    if (this.fileHasErrors || this.state.fileData.length === 0) {
      AlertManager.show("Corrija as linhas inválidas e carregue o arquivo novamente antes de analisar.", "warning");
      return;
    }
    await this.analyzeImport(this.state.fileData.map(row => DataProcessor.convertRowToJson(row)), "Arquivo");
  }

  validateCredentials() {
    const tenant = StorageManager.get("bluesoftTenant");
    const token = StorageManager.get("bluesoftToken");
    if (!tenant || !token || tenant !== DOM_ELEMENTS.tenantInput.value.trim() || token !== DOM_ELEMENTS.tokenInput.value.trim()) {
      AlertManager.show("Salve o Tenant e Token nas configurações antes de analisar os dados.", "warning");
      return false;
    }
    return true;
  }

  invalidateReview() {
    this.review = null;
    DOM_ELEMENTS.reviewSection.classList.add("hidden");
    DOM_ELEMENTS.confirmReviewBtn.disabled = true;
    if (this.workflowSource === "Arquivo" && this.state.fileData.length) {
      this.setWorkflowStage("ready", "Confira os dados do arquivo e valide a importação antes de enviar.");
    } else DOM_ELEMENTS.integrationFlow.classList.add("hidden");
  }

  mountWorkflow(source) {
    this.workflowSource = source;
    const host = source === "Manual" ? DOM_ELEMENTS.manualWorkflowHost : DOM_ELEMENTS.uploadWorkflowHost;
    if (DOM_ELEMENTS.integrationFlow.parentElement !== host) host.appendChild(DOM_ELEMENTS.integrationFlow);
    DOM_ELEMENTS.workflowFileName.textContent = source === "Manual" ? "Registro informado manualmente" : this.fileName || "Arquivo selecionado";
  }

  setWorkflowProgress(percent, text) {
    DOM_ELEMENTS.progressTrack.classList.remove("indeterminate");
    DOM_ELEMENTS.progressTrack.setAttribute("aria-valuenow", String(percent));
    DOM_ELEMENTS.progressBar.style.width = `${percent}%`;
    DOM_ELEMENTS.progressText.textContent = text;
  }

  setWorkflowStage(stage, summary) {
    const labels = { reading: "Lendo arquivo", ready: "Arquivo pronto", analyzing: "Validando", review: "Pronto para enviar",
      blocked: "Revisão necessária", checking: "Conferindo", sending: "Enviando", complete: "Concluído", failed: "Concluído com erros", interrupted: "Envio interrompido" };
    DOM_ELEMENTS.integrationFlow.classList.remove("hidden");
    DOM_ELEMENTS.integrationFlow.dataset.stage = stage;
    DOM_ELEMENTS.workflowState.textContent = labels[stage];
    if (summary !== undefined) DOM_ELEMENTS.reviewSummary.textContent = summary;
    const step = ["reading", "ready"].includes(stage) ? 1 : ["analyzing", "review", "blocked"].includes(stage) ? 2 : 3;
    DOM_ELEMENTS.workflowSteps.forEach(item => {
      const number = Number(item.dataset.step);
      if (number === step) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      item.dataset.complete = String(number < step || stage === "complete");
    });
    const waiting = ["reading", "analyzing", "checking"].includes(stage);
    DOM_ELEMENTS.workflowContent.setAttribute("aria-busy", String(waiting));
    DOM_ELEMENTS.filePreview.classList.toggle("hidden", !["ready", "reading"].includes(stage) || this.workflowSource !== "Arquivo");
    DOM_ELEMENTS.reviewSection.classList.toggle("hidden", !["analyzing", "review", "blocked"].includes(stage));
    DOM_ELEMENTS.resultsSection.classList.toggle("hidden", !["checking", "sending", "complete", "failed", "interrupted"].includes(stage));
    DOM_ELEMENTS.processFileBtn.classList.toggle("hidden", stage === "review");
    DOM_ELEMENTS.processFileBtn.textContent = { reading: "Preparando arquivo…", ready: "Validar importação", analyzing: "Validando…", checking: "Conferindo…", sending: "Enviando…" }[stage] || "Analisar novamente";
    DOM_ELEMENTS.confirmReviewBtn.classList.toggle("hidden", stage !== "review");
    DOM_ELEMENTS.discardReviewBtn.classList.toggle("hidden", stage !== "review");
    DOM_ELEMENTS.cancelProcessingBtn.classList.toggle("hidden", !["analyzing", "checking", "sending"].includes(stage));
    DOM_ELEMENTS.downloadReportBtn.classList.toggle("hidden", !["complete", "failed", "interrupted"].includes(stage) || !this.state.processingResults.length);
    DOM_ELEMENTS.processingSection.classList.remove("hidden");
    if (waiting) {
      DOM_ELEMENTS.progressTrack.classList.add("indeterminate");
      DOM_ELEMENTS.progressTrack.removeAttribute("aria-valuenow");
      DOM_ELEMENTS.progressText.textContent = stage === "reading" ? "Preparando o arquivo…" : stage === "analyzing" ? "Consultando o ERP. Nenhuma gravação foi iniciada." : "Conferindo as alterações antes do envio…";
    } else if (stage === "ready") this.setWorkflowProgress(0, "Aguardando validação");
    else if (stage === "review") this.setWorkflowProgress(100, "Validação concluída. Confira as alterações abaixo.");
    else if (stage === "blocked") this.setWorkflowProgress(0, "Envio bloqueado. Revise os detalhes abaixo e analise novamente.");
    else if (stage === "sending") this.setWorkflowProgress(0, "Iniciando o processamento…");
  }

  setBusy(busy) {
    this.busy = busy;
    const controls = [DOM_ELEMENTS.fileInput, DOM_ELEMENTS.hasHeader, DOM_ELEMENTS.processFileBtn,
      DOM_ELEMENTS.saveSettingsBtn, DOM_ELEMENTS.clearSettingsBtn,
      DOM_ELEMENTS.tenantInput, DOM_ELEMENTS.tokenInput, ...DOM_ELEMENTS.manualForm.elements, ...DOM_ELEMENTS.tabButtons];
    controls.forEach(control => { control.disabled = busy; });
    DOM_ELEMENTS.processFileBtn.disabled = busy || (this.workflowSource !== "Manual" && (this.fileHasErrors || !this.state.fileData.length));
    DOM_ELEMENTS.confirmReviewBtn.disabled = busy || !this.review || this.review.entries.some(entry => entry.error);
    DOM_ELEMENTS.cancelProcessingBtn.disabled = false;
    DOM_ELEMENTS.cancelProcessingBtn.textContent = "Cancelar";
  }

  async analyzeImport(payloads, source) {
    if (this.busy || !payloads.length) return;
    this.invalidateReview();
    const duplicateKeys = payloads.length !== new Set(payloads.map(data => data.subFinalizadoraKey)).size;
    if (duplicateKeys) {
      this.showWorkflowBlock("Há subfinalizadoras repetidas no lote. Corrija a planilha antes de analisar.", source);
      return;
    }
    const invalid = payloads.find(data => !DataValidator.validateSubmissionData(data).isValid);
    if (invalid) {
      this.showWorkflowBlock(DataValidator.validateSubmissionData(invalid).errors.join("; "), source);
      return;
    }
    const tenant = StorageManager.get("bluesoftTenant");
    const token = StorageManager.get("bluesoftToken");
    let entries;
    this.isCancelled = false;
    this.mountWorkflow(source);
    DOM_ELEMENTS.manualResults.classList.add("hidden");
    this.setBusy(true);
    DOM_ELEMENTS.reviewBody.replaceChildren();
    const loadingRow = document.createElement("tr");
    const loadingCell = document.createElement("td");
    loadingCell.colSpan = 4;
    loadingCell.className = "px-4 py-12 text-center text-gray-500";
    loadingCell.textContent = `Validando ${payloads.length} registros e identificando as subfinalizadoras afetadas…`;
    loadingRow.appendChild(loadingCell);
    DOM_ELEMENTS.reviewBody.appendChild(loadingRow);
    this.setWorkflowStage("analyzing", "Validando a importação. Você poderá conferir as alterações antes de enviar.");
    try {
      try {
        entries = await ApiService.planBatch(tenant, token, payloads, {
          isCancelled: () => this.isCancelled,
          onProgress: ({ records }) => { DOM_ELEMENTS.reviewSummary.textContent = `Consultando mapas no ERP: ${records} recebidos. Nenhum dado foi gravado.`; },
        });
      } catch (error) { entries = payloads.map(data => ({ data, error: error.message })); }
      if (this.isCancelled) {
        this.invalidateReview();
        if (source === "Arquivo") DOM_ELEMENTS.reviewSummary.textContent = "Validação cancelada. Nenhum dado foi gravado. Você pode tentar novamente.";
        return;
      }
      this.review = { entries, tenant, token, source };
      const fragment = document.createDocumentFragment();
      for (const entry of entries) this.appendReviewRow(entry, fragment);
      DOM_ELEMENTS.reviewBody.replaceChildren(fragment);
      const errors = entries.filter(entry => entry.error).length;
      const count = action => entries.filter(entry => entry.plan?.action === action).length;
      const changes = count("create") + count("update");
      DOM_ELEMENTS.confirmReviewBtn.textContent = changes ? `Enviar ${changes} registro${changes === 1 ? "" : "s"} para o ERP` : "Concluir sem alterações";
      this.setWorkflowStage(errors ? "blocked" : "review", `${count("create")} para criar, ${count("update")} para atualizar, ${count("unchanged")} sem alterações, ${errors} bloqueado(s). ` +
        (errors ? "Corrija os bloqueios e analise novamente." : ""));
    } finally {
      this.setBusy(false);
      if (this.review && !this.review.entries.some(entry => entry.error)) DOM_ELEMENTS.confirmReviewBtn.focus({ preventScroll: true });
    }
  }

  appendReviewRow(entry, container = DOM_ELEMENTS.reviewBody) {
    const row = document.createElement("tr");
    const plan = entry.plan;
    const labels = { create: "Criar", update: "Atualizar", unchanged: "Manter sem alterações" };
    const differences = plan?.differences.map(field => `${BluesoftIntegrationApp.FIELD_LABELS[field]}: ${plan.existing[field]} → ${plan.data[field]}`).join("; ");
    const details = entry.error || (plan?.action === "create"
      ? BluesoftIntegrationApp.PREVIEW_FIELDS.map(field => `${BluesoftIntegrationApp.FIELD_LABELS[field]}: ${entry.data[field]}`).join("; ")
      : differences || "Os dados já são idênticos; nenhuma gravação será feita.");
    for (const [index, text] of [entry.data.subFinalizadoraKey, plan ? labels[plan.action] : "Bloqueado", plan?.id ?? "—", details].entries()) {
      const cell = document.createElement("td");
      cell.dataset.label = ["Subfinalizadora", "Ação", "Mapa no ERP", "Dados e diferenças"][index];
      cell.className = "px-4 py-3 text-sm text-gray-800 border-b border-gray-100";
      cell.textContent = text;
      row.appendChild(cell);
    }
    if (entry.error) row.className = "bg-red-50";
    container.appendChild(row);
  }

  showWorkflowBlock(message, source) {
    this.mountWorkflow(source);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "px-4 py-6 text-red-700";
    cell.textContent = message;
    row.appendChild(cell);
    DOM_ELEMENTS.reviewBody.replaceChildren(row);
    this.setWorkflowStage("blocked", message);
  }

  async confirmReview() {
    const review = this.review;
    if (this.busy || !review || review.entries.some(entry => entry.error)) return;
    this.isCancelled = false;
    this.setBusy(true);
    this.state.processingResults = [];
    DOM_ELEMENTS.cancelProcessingBtn.disabled = false;
    DOM_ELEMENTS.cancelProcessingBtn.textContent = "Cancelar próximos envios";
    DOM_ELEMENTS.resultsBody.replaceChildren();
    this.resultRows.clear();
    for (const entry of review.entries) this.appendRealtimeResultRow({ subFinalizadoraKey: entry.data.subFinalizadoraKey, status: "pending", message: "Aguardando conferência do lote" });
    this.setWorkflowStage("checking", "Conferindo o lote antes do envio. Acompanhe o resultado de cada registro abaixo.");
    let successes = 0;
    let errors = 0;
    try {
      await ApiService.executeBatch(review.tenant, review.token, review.entries.map(entry => entry.plan), {
        isCancelled: () => this.isCancelled,
        onProgress: ({ records }) => { DOM_ELEMENTS.progressText.textContent = `Conferindo o lote: ${records} mapas consultados no ERP…`; },
        onStart: plan => {
          if (DOM_ELEMENTS.integrationFlow.dataset.stage === "checking") this.setWorkflowStage("sending");
          this.appendRealtimeResultRow({ subFinalizadoraKey: plan.data.subFinalizadoraKey, status: "processing", message: {
            create: "Criando mapa no ERP…", update: `Atualizando mapa ${plan.id}…`, unchanged: "Mantendo dados idênticos…",
          }[plan.action] });
        },
        onResult: (result, index) => {
          if (DOM_ELEMENTS.integrationFlow.dataset.stage === "checking") this.setWorkflowStage("sending");
          const entry = review.entries[index];
          if (result.status === "success") {
            result.message = { create: "Criado com sucesso", update: "Atualizado com sucesso", unchanged: "Já existente e idêntico; mantido sem alterações" }[result.action];
            successes++;
          } else errors++;
          // Falhas de histórico local não podem transformar um sucesso no ERP em erro.
          this.state.addHistoryItem(review.source, entry.data, result.status === "success", result.message);
          this.state.processingResults.push(result);
          this.appendRealtimeResultRow(result);
          const done = successes + errors;
          DOM_ELEMENTS.reviewSummary.textContent = `Processados ${done}/${review.entries.length}. ${successes} sucesso(s), ${errors} erro(s).`;
          const progress = Math.round(done / review.entries.length * 100);
          this.setWorkflowProgress(progress, `${progress}% · ${done} de ${review.entries.length} registros processados`);
        },
      });
      const skipped = review.entries.length - successes - errors;
      for (const entry of review.entries) {
        const row = this.resultRows.get(entry.data.subFinalizadoraKey);
        if (row?.dataset.status === "pending") {
          const result = { subFinalizadoraKey: entry.data.subFinalizadoraKey, status: "cancelled", message: "Não enviado: operação cancelada" };
          this.appendRealtimeResultRow(result);
          this.state.processingResults.push(result);
        }
      }
      const summary = `${successes} sucesso(s), ${errors} erro(s), ${skipped} cancelado(s).`;
      this.setWorkflowStage(skipped ? "interrupted" : errors ? "failed" : "complete", summary + " Você pode baixar o relatório ou analisar novamente.");
      this.setWorkflowProgress(Math.round((successes + errors) / review.entries.length * 100), `${successes + errors} de ${review.entries.length} registros processados`);
      this.renderHistory();
    } catch (error) {
      this.setWorkflowStage("blocked", error.message);
    } finally {
      this.review = null;
      this.setBusy(false);
      const nextAction = DOM_ELEMENTS.downloadReportBtn.classList.contains("hidden") ? DOM_ELEMENTS.processFileBtn : DOM_ELEMENTS.downloadReportBtn;
      nextAction.focus({ preventScroll: true });
    }
  }

  appendRealtimeResultRow(result) {
    let row = this.resultRows.get(result.subFinalizadoraKey);
    if (!row) {
      row = document.createElement("tr");
      this.resultRows.set(result.subFinalizadoraKey, row);
      DOM_ELEMENTS.resultsBody.appendChild(row);
    }
    row.replaceChildren();
    row.dataset.status = result.status;
    row.className = result.status === "error" ? "bg-red-50" : result.status === "success" ? "bg-green-50" : "";

    const keyCell = document.createElement("td");
    keyCell.dataset.label = "Subfinalizadora";
    keyCell.className = "px-6 py-4 whitespace-nowrap text-sm text-gray-800";
    keyCell.textContent = result.subFinalizadoraKey !== null && result.subFinalizadoraKey !== undefined ? result.subFinalizadoraKey : "—";
    row.appendChild(keyCell);

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status";
    statusCell.className = `px-6 py-4 whitespace-nowrap text-sm font-medium ${
      result.status === "success" ? "text-green-700" : result.status === "error" ? "text-red-700" : "text-gray-500"
    }`;
    statusCell.textContent = { success: "Sucesso", error: "Erro", pending: "Aguardando", processing: "Em andamento", cancelled: "Não enviado" }[result.status];
    row.appendChild(statusCell);

    const messageCell = document.createElement("td");
    messageCell.dataset.label = "Mensagem";
    messageCell.className = "px-6 py-4 text-sm text-gray-800";
    messageCell.textContent = result.message;
    row.appendChild(messageCell);

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
      const status = result.status === "success" ? "Sucesso" : result.status === "cancelled" ? "Não enviado" : "Erro";
      const message = (/^(?:\s*[=+@-]|[\t\r])/.test(result.message) ? "'" + result.message : result.message).replace(/"/g, '""');
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

    if (this.busy || !this.validateCredentials()) return;

    const formData = this.collectManualFormData();
    const validation = DataValidator.validateSubmissionData(formData);

    if (!validation.isValid) {
      this.showManualResult(validation.errors[0], false);
      return;
    }

    await this.analyzeImport([formData], "Manual");
  }

  collectManualFormData() {
    return {
      tipoTef: DOM_ELEMENTS.manualTipoTef.value,
      codigoBandeira: DataProcessor.parseStrictInt(DOM_ELEMENTS.manualCodigoBandeira.value),
      tipoCartao: DOM_ELEMENTS.manualTipoCartao.value,
      codigoAdministradora: DOM_ELEMENTS.manualCodigoAdministradora.value.trim(),
      subFinalizadoraKey: DataProcessor.parseStrictInt(DOM_ELEMENTS.manualSubFinalizadoraKey.value),
    };
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
