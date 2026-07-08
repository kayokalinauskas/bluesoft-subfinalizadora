import Papa from "papaparse";
import ExcelWorker from "../workers/excel.worker.js?worker";

export class DataProcessor {
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
      parcelado: "CARTAO_PARCELADO",
      crédito: "CARTAO_CREDITO",
      credito: "CARTAO_CREDITO",
      voucher: "CARTAO_VOUCHER",
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
