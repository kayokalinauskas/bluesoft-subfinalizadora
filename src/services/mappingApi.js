import { DataValidator } from "../processors/validator.js";

export const MAPPING_FIELDS = ["tipoTef", "codigoBandeira", "tipoCartao", "codigoAdministradora", "subFinalizadoraKey"];
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const TIMEOUT_MS = 25000;

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function errorMessage(body) {
  if (typeof body === "string") {
    try { return errorMessage(JSON.parse(body)); } catch { return body; }
  }
  if (!body || typeof body !== "object") return "";
  return errorMessage(body.details) || body.detail || body.message || body.title || body.error || "";
}

function snapshot(record) {
  const result = Object.fromEntries(MAPPING_FIELDS.map(field => [field, record[field]]));
  if (typeof result.tipoTef === "string") result.tipoTef = result.tipoTef.trim().toUpperCase();
  for (const field of ["codigoBandeira", "subFinalizadoraKey"]) {
    if (typeof result[field] === "string" && /^\d+$/.test(result[field])) result[field] = Number(result[field]);
  }
  // O código da administradora é textual: zeros à esquerda são significativos.
  if (typeof result.codigoAdministradora === "number") result.codigoAdministradora = String(result.codigoAdministradora);
  if (!DataValidator.validateSubmissionData(result).isValid) throw new Error("A consulta retornou um mapa com dados inválidos. Revise no ERP.");
  return Object.freeze(result);
}

function mapId(value) {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new Error("A consulta não retornou mapaSubfinalizadoraTefKey válido. Atualização bloqueada.");
  return id;
}

export class MappingApi {
  constructor(proxyUrl, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = TIMEOUT_MS) {
    this.proxyUrl = proxyUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(tenant, token, method, suffix = "", data, query) {
    if (typeof tenant !== "string" || !/^[a-zA-Z0-9_-]+$/.test(tenant)) throw new Error("Tenant inválido. Informe apenas o identificador do ERP.");
    if (typeof token !== "string" || !token.trim()) throw new Error("Token não configurado.");
    if (!this.proxyUrl) throw new Error("URL do proxy não configurada (VITE_PROXY_URL).");
    const target = new URL(`https://erp.bluesoft.com.br/${tenant}/api/financeiro/mapa-subfinalizadora${suffix}`);
    if (query) for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
    const proxy = new URL(this.proxyUrl);
    proxy.searchParams.set("url", target.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(proxy.href, {
        method,
        headers: { "Content-Type": "application/json", "X-Customtoken": token, Accept: "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (!response.ok) throw new ApiError(String(errorMessage(body) || `Erro HTTP ${response.status}`), response.status, body);
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`${controller.signal.aborted ? "Tempo limite excedido" : "Falha de comunicação"}.${method !== "GET" ? " O resultado da gravação pode ser desconhecido; consulte novamente antes de reenviar." : " Nenhuma gravação foi realizada nesta consulta."}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async findExisting(tenant, token, data) {
    const candidates = [];
    const seen = new Set();
    let expectedPages;
    for (let currentPage = 0; currentPage < MAX_PAGES; currentPage++) {
      const response = await this.request(tenant, token, "GET", "", undefined, {
        subFinalizadoraKey: data.subFinalizadoraKey, currentPage, pageSize: PAGE_SIZE,
      });
      const items = Array.isArray(response) ? response : response?.content ?? response?.items ?? response?.data;
      if (!Array.isArray(items)) throw new Error("Formato de consulta não reconhecido. Nenhum dado será gravado.");
      if (!Array.isArray(response) && response.currentPage !== undefined && response.currentPage !== currentPage) {
        throw new Error("O ERP retornou uma página diferente da solicitada. Envio bloqueado.");
      }
      const totalPages = Array.isArray(response) ? undefined : response.totalPages ?? response.pagination?.totalPages;
      if (totalPages !== undefined) {
        if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > MAX_PAGES || (totalPages === 0 && items.length > 0) || (currentPage > 0 && totalPages !== expectedPages)) {
          throw new Error("Paginação inconsistente na consulta ao ERP.");
        }
      } else if (expectedPages !== undefined) throw new Error("A consulta perdeu os dados de paginação.");
      expectedPages = totalPages;
      for (const record of items) {
        if (!record || typeof record !== "object") throw new Error("Mapa inválido na consulta ao ERP.");
        const existing = snapshot(record);
        if (existing.subFinalizadoraKey !== data.subFinalizadoraKey) throw new Error("O ERP não respeitou o filtro de subfinalizadora. Revise a consulta antes de enviar.");
        const id = mapId(record.mapaSubfinalizadoraTefKey);
        if (seen.has(id)) throw new Error("A consulta retornou mapas repetidos. Revise a paginação no ERP.");
        seen.add(id);
        candidates.push({ id, data: existing });
      }
      if (items.length === 0) {
        if (totalPages !== undefined && currentPage + 1 < totalPages) throw new Error("Página vazia antes do final da consulta ao ERP.");
        return candidates;
      }
      if (totalPages !== undefined && currentPage + 1 === totalPages) return candidates;
    }
    throw new Error("Limite de páginas excedido. Consulta incompleta; envio bloqueado.");
  }

  async plan(tenant, token, data, mode = "create") {
    if (!["create", "reconcile"].includes(mode)) throw new Error("Modo de importação inválido.");
    const validation = DataValidator.validateSubmissionData(data);
    if (!validation.isValid) throw new Error(validation.errors.join("; "));
    const payload = snapshot(data);
    const candidates = await this.findExisting(tenant, token, payload);
    if (candidates.length > 1) throw new Error("Mais de um mapa encontrado para esta subfinalizadora. Revise os registros no ERP; não é seguro escolher automaticamente.");
    const existing = candidates[0]?.data ?? null;
    const differences = existing ? MAPPING_FIELDS.filter(field => existing[field] !== payload[field]) : [];
    const action = existing ? (differences.length ? "update" : "unchanged") : "create";
    if (action === "update" && mode !== "reconcile") throw new Error("Já existe um mapa com dados diferentes. Selecione 'Criar e atualizar existentes' e analise novamente.");
    return Object.freeze({ action, id: candidates[0]?.id ?? null, data: payload, existing, differences: Object.freeze(differences), mode });
  }

  async execute(tenant, token, plan) {
    // Reconsulta antes de gravar: a revisão pode ter ficado desatualizada.
    const current = await this.plan(tenant, token, plan.data, plan.mode);
    if (current.action !== plan.action || current.id !== plan.id || JSON.stringify(current.existing) !== JSON.stringify(plan.existing)) {
      throw new Error("O mapa mudou desde a análise. Analise novamente antes de enviar.");
    }
    if (current.action === "unchanged") return "unchanged";
    await this.request(tenant, token, current.action === "create" ? "POST" : "PUT", current.action === "update" ? `/${current.id}` : "", current.data);
    return current.action;
  }
}
