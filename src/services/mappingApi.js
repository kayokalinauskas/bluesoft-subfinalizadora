import { DataValidator } from "../processors/validator.js";

export const MAPPING_FIELDS = ["tipoTef", "codigoBandeira", "tipoCartao", "codigoAdministradora", "subFinalizadoraKey"];
export const ORIGIN_FIELDS = ["tipoTef", "codigoAdministradora", "codigoBandeira", "tipoCartao"];

// This is the ERP's functional lookup combination, not a database uniqueness constraint.
export function mappingOriginKey(record) {
  const normalized = snapshot(record);
  return JSON.stringify(ORIGIN_FIELDS.map(field => normalized[field]));
}

export class MappingConflictError extends Error {
  constructor(candidates) {
    super("Mais de um mapa encontrado para a mesma combinação de TEF, administradora, bandeira e cartão. Revise os candidatos no ERP; não é seguro escolher automaticamente.");
    this.candidates = candidates;
  }
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const TIMEOUT_MS = 25000;
const WRITE_CONCURRENCY = 4;

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

  async readMappings(tenant, token, filters = {}, { isCancelled = () => false, onProgress = () => {} } = {}) {
    const records = [];
    const seen = new Set();
    let expectedPages;
    for (let currentPage = 0; currentPage < MAX_PAGES; currentPage++) {
      if (isCancelled()) throw new Error("Análise cancelada. Nenhum dado foi gravado.");
      const response = await this.request(tenant, token, "GET", "", undefined, {
        ...filters, currentPage, pageSize: PAGE_SIZE,
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
        const id = mapId(record.mapaSubfinalizadoraTefKey);
        if (seen.has(id)) throw new Error("A consulta retornou mapas repetidos. Revise a paginação no ERP.");
        seen.add(id);
        records.push(record);
      }
      onProgress({ pages: currentPage + 1, records: records.length });
      if (items.length === 0) {
        if (totalPages !== undefined && currentPage + 1 < totalPages) throw new Error("Página vazia antes do final da consulta ao ERP.");
        return records;
      }
      if (totalPages !== undefined && currentPage + 1 === totalPages) return records;
      // O envelope real informa o tamanho efetivo da página. Sem esse contrato,
      // continuamos até página vazia, mesmo quando a lista é curta.
      if (totalPages === undefined && response.currentPage === currentPage && Number.isInteger(response.pageSize) && response.pageSize > 0 && items.length < response.pageSize) return records;
    }
    throw new Error("Limite de páginas excedido. Consulta incompleta; envio bloqueado.");
  }

  buildPlan(data, candidates) {
    const validation = DataValidator.validateSubmissionData(data);
    if (!validation.isValid) throw new Error(validation.errors.join("; "));
    const payload = snapshot(data);
    if (candidates.length > 1) throw new MappingConflictError(Object.freeze(candidates.map(candidate => Object.freeze({
      ...candidate, differences: Object.freeze(MAPPING_FIELDS.filter(field => candidate.data[field] !== payload[field])),
    }))));
    const existing = candidates[0]?.data ?? null;
    const differences = existing ? MAPPING_FIELDS.filter(field => existing[field] !== payload[field]) : [];
    const action = existing ? (differences.length ? "update" : "unchanged") : "create";
    return Object.freeze({ action, id: candidates[0]?.id ?? null, data: payload, existing, differences: Object.freeze(differences) });
  }

  async planBatch(tenant, token, payloads, options) {
    if (!payloads.length) return [];
    const wanted = new Set();
    for (const data of payloads) {
      const key = mappingOriginKey(data);
      if (wanted.has(key)) throw new Error("Há combinações de origem repetidas no lote (TEF, administradora, bandeira e cartão), inclusive com destinos diferentes.");
      wanted.add(key);
    }
    // Never filter by destination: the same origin may currently point elsewhere.
    // For a single row, the API supports band/card filters; TEF/admin are matched locally.
    const filters = payloads.length === 1 ? {
      codigoBandeira: payloads[0].codigoBandeira, tipoCartao: payloads[0].tipoCartao,
    } : {};
    const records = await this.readMappings(tenant, token, filters, options);
    const groups = new Map();
    for (const record of records) {
      const normalized = snapshot(record);
      const key = mappingOriginKey(normalized);
      if (!wanted.has(key)) continue;
      const group = groups.get(key) ?? [];
      group.push({ id: mapId(record.mapaSubfinalizadoraTefKey), data: normalized });
      groups.set(key, group);
    }
    return payloads.map(data => {
      try {
        const candidates = groups.get(mappingOriginKey(data)) ?? [];
        return { data, plan: this.buildPlan(data, candidates) };
      } catch (error) { return { data, error: error.message, candidates: error.candidates }; }
    });
  }

  async plan(tenant, token, data) {
    const [entry] = await this.planBatch(tenant, token, [data]);
    if (entry.error) {
      if (entry.candidates) throw new MappingConflictError(entry.candidates);
      throw new Error(entry.error);
    }
    return entry.plan;
  }

  async executeBatch(tenant, token, plans, { isCancelled = () => false, onResult = () => {}, onStart = () => {}, onProgress } = {}) {
    if (!plans.length || isCancelled()) return [];
    const current = await this.planBatch(tenant, token, plans.map(plan => plan.data), { isCancelled, onProgress });
    // Validamos o lote inteiro antes da primeira escrita, mantendo a revisão.
    for (let index = 0; index < plans.length; index++) {
      const before = plans[index];
      const after = current[index].plan;
      if (!after || before.action !== after.action || before.id !== after.id || JSON.stringify(before.existing) !== JSON.stringify(after.existing)) {
        throw new Error(`A subfinalizadora ${before.data.subFinalizadoraKey} mudou desde a análise. Analise novamente antes de enviar. Nenhum dado foi gravado.`);
      }
    }
    const results = new Array(plans.length);
    let next = 0;
    const worker = async () => {
      while (!isCancelled() && next < current.length) {
        const index = next++;
        const plan = current[index].plan;
        const result = { subFinalizadoraKey: plan.data.subFinalizadoraKey, action: plan.action };
        onStart(plan, index);
        try {
          if (plan.action !== "unchanged") await this.request(tenant, token, plan.action === "create" ? "POST" : "PUT", plan.action === "update" ? `/${plan.id}` : "", plan.data);
          result.status = "success";
        } catch (error) {
          result.status = "error";
          result.message = error.message;
          result.httpStatus = error.status;
          result.details = error.details;
        }
        results[index] = result;
        onResult(result, index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, plans.length) }, worker));
    return results.filter(Boolean);
  }

  async execute(tenant, token, plan) {
    const [result] = await this.executeBatch(tenant, token, [plan]);
    if (result.status === "error") throw new ApiError(result.message, result.httpStatus, result.details);
    return result.action;
  }
}
