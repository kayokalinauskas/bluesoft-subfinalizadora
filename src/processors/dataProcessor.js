import Papa from "papaparse";
import ExcelWorker from "../workers/excel.worker.js?worker";

export class DataProcessor {
  static parseStrictInt(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;
  }

  static normalizeRowKeys(row) {
    if (!row || typeof row !== "object") return {};
    const normalized = {};

    const normalizeStr = (str) => {
      return String(str)
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove acentos
        .replace(/[^a-z0-9_]/g, "_")      // substitui não-alfanuméricos por underscore
        .replace(/_+/g, "_")              // remove múltiplos underscores seguidos
        .replace(/^_+|_+$/g, "");         // remove underscores no início ou fim
    };

    for (const [key, val] of Object.entries(row)) {
      const normKey = normalizeStr(key);

      if (/^sub_?finalizadora(_?key)?$/i.test(normKey) || normKey === "codigo_subfinalizadora" || normKey === "subfinalizadorakey") {
        normalized.sub_finalizadora_key = val;
      } else if (/^tipo_?tef(_?key)?$/i.test(normKey) || normKey === "tef" || normKey === "tef_key" || normKey === "tipotefkey") {
        normalized.tipo_tef_key = val;
      } else if (/^tipo_?(de_?)?cartao$/i.test(normKey) || normKey === "cartao" || normKey === "tipocartao") {
        normalized.tipo_cartao = val;
      } else if (/^(cod_?bandeira|codigo_?bandeira|bandeira|codigo_?da_?bandeira)$/i.test(normKey)) {
        normalized.codigo_bandeira = val;
      } else if (/^(cod_?administradora|codigo_?administradora|administradora|codigo_?da_?administradora)$/i.test(normKey)) {
        normalized.codigo_administradora = val;
      } else if (/^(cod_?autorizadora|codigo_?autorizadora|autorizadora|codigo_?da_?autorizadora)$/i.test(normKey)) {
        normalized.codigo_autorizadora = val;
      } else {
        normalized[normKey] = val;
      }
    }
    return normalized;
  }

  static convertRowToJson(row) {
    const normRow = this.normalizeRowKeys(row);
    const tipoTef = this.mapTipoTef(normRow.tipo_tef_key);
    const tipoCartao = this.mapTipoCartao(normRow.tipo_cartao);

    return {
      tipoTef,
      codigoBandeira: this.parseStrictInt(normRow.codigo_bandeira),
      tipoCartao,
      codigoAdministradora: String(normRow.codigo_autorizadora ?? normRow.codigo_administradora ?? ""),
      subFinalizadoraKey: this.parseStrictInt(normRow.sub_finalizadora_key),
    };
  }

  static mapTipoTef(tipoTefKey) {
    if (tipoTefKey === null || tipoTefKey === undefined) return null;
    const val = String(tipoTefKey).trim().toUpperCase();
    if (val === "1" || val === "SITEF") return "SITEF";
    if (val === "2" || val === "POS") return "POS";
    return null;
  }

  static mapTipoCartao(tipoCartao) {
    if (!tipoCartao) return null;

    const tipo = tipoCartao.toLowerCase();
    const mapping = {
      parcelado: "CARTAO_PARCELADO",
      crédito: "CARTAO_CREDITO",
      credito: "CARTAO_CREDITO",
      debito: "CARTAO_DEBITO",
      débito: "CARTAO_DEBITO",
      voucher: "CARTAO_VOUCHER",
    };

    for (const [key, value] of Object.entries(mapping)) {
      if (tipo.includes(key)) return value;
    }

    return null;
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
      Papa.parse(file, {
        worker: true,
        header: hasHeader,
        skipEmptyLines: true,
        dynamicTyping: false,
        encoding: "UTF-8",
        complete: (results) => {
          if (results.errors.length > 0) {
            reject(new Error(`Erros no parsing do CSV: ${results.errors.map((e) => e.message).join(", ")}`));
            return;
          }
          resolve(results.data);
        },
        error: (err) => reject(new Error(`Falha ao processar CSV: ${err.message}`)),
      });
    });
  }

  static processExcel(file) {
    return new Promise((resolve, reject) => {
      const worker = new ExcelWorker();
      let done = false;

      const settle = (fn) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        worker.terminate();
        fn();
      };

      const timeoutId = setTimeout(
        () => settle(() => reject(new Error("Timeout ao processar Excel (arquivo muito grande?)"))) ,
        60_000
      );

      const reader = new FileReader();
      reader.onload = (e) => worker.postMessage(e.target.result, [e.target.result]);
      reader.onerror = () => settle(() => reject(new Error("Falha ao ler arquivo")));
      reader.readAsArrayBuffer(file);

      worker.onmessage = (e) =>
        settle(() =>
          e.data.ok
            ? resolve(e.data.data)
            : reject(new Error(`Falha ao processar Excel: ${e.data.error}`))
        );

      worker.onerror = (e) =>
        settle(() => reject(new Error(`Falha ao processar Excel: ${e.message}`)));
    });
  }
}
