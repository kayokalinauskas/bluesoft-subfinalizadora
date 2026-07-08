export class DataValidator {
  static validateSubmissionData(data) {
    const errors = [];

    if (!data.tipoTef || !["SITEF", "POS"].includes(data.tipoTef)) {
      errors.push("Tipo TEF inválido. Deve ser 'SITEF' ou 'POS'");
    }

    if (!data.codigoBandeira || isNaN(data.codigoBandeira) || data.codigoBandeira <= 0) {
      errors.push("Código Bandeira inválido");
    }

    const validTiposCartao = ["CARTAO_DEBITO", "CARTAO_CREDITO", "CARTAO_VOUCHER", "CARTAO_PARCELADO"];
    if (!data.tipoCartao || !validTiposCartao.includes(data.tipoCartao)) {
      errors.push("Tipo Cartão inválido");
    }

    if (!data.codigoAdministradora || data.codigoAdministradora.trim() === "") {
      errors.push("Código Administradora inválido");
    }

    if (!data.subFinalizadoraKey || isNaN(data.subFinalizadoraKey) || data.subFinalizadoraKey <= 0) {
      errors.push("Subfinalizadora Key inválida");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
