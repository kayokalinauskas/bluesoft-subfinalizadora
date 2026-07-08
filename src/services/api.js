import { CONFIG } from "../config.js";

export class ApiService {
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
    } catch {
      errorMessage = `${errorMessage}: ${response.statusText}`;
    }

    throw new Error(errorMessage);
  }
}
