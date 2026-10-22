export class DataValidator {
  static validateSubmissionData(data) {
    const errors = [];
    if (!data || typeof data !== "object") return { isValid: false, errors: ["Dados de mapeamento inválidos"] };

    if (!data.tipoTef || !["SITEF", "POS"].includes(data.tipoTef)) {
      errors.push("Tipo TEF inválido. Deve ser 1 (SITEF) ou 2 (POS)");
    }

    if (!Number.isSafeInteger(data.codigoBandeira) || data.codigoBandeira <= 0 || data.codigoBandeira > 99999999) {
      errors.push("Código Bandeira inválido: use um inteiro entre 1 e 99999999");
    }

    const validTiposCartao = ["CARTAO_DEBITO", "CARTAO_CREDITO", "CARTAO_VOUCHER", "CARTAO_PARCELADO"];
    if (!data.tipoCartao || !validTiposCartao.includes(data.tipoCartao)) {
      errors.push("Tipo Cartão inválido");
    }

    if (typeof data.codigoAdministradora !== "string" || !data.codigoAdministradora.trim() || data.codigoAdministradora.length > 3) {
      errors.push("Código Administradora inválido: use de 1 a 3 caracteres");
    }

    if (!Number.isSafeInteger(data.subFinalizadoraKey) || data.subFinalizadoraKey <= 0) {
      errors.push("Subfinalizadora Key inválida");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
