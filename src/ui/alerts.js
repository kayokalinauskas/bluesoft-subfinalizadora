import { CONFIG } from "../config.js";

export class AlertManager {
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
