import { CONFIG } from "./config.js";
import { StorageManager } from "./services/storage.js";

export class AppState {
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

    try { this.saveHistory(); }
    catch { /* A indisponibilidade do histórico não altera o resultado da gravação no ERP. */ }
  }

  saveHistory() {
    StorageManager.set("bluesoftHistory", JSON.stringify(this.history));
  }

  loadHistory() {
    const savedHistory = StorageManager.get("bluesoftHistory");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        this.history = Array.isArray(parsed) ? parsed.filter(item => item && item.data && typeof item.type === "string").slice(0, CONFIG.MAX_HISTORY_ITEMS) : [];
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
