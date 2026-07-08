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
