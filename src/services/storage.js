export class StorageManager {
  static get(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error(`Erro ao ler do localStorage: ${error}`);
      return null;
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error(`Erro ao salvar no localStorage: ${error}`);
      throw new Error("Falha ao salvar configurações");
    }
  }

  static remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Erro ao remover do localStorage: ${error}`);
    }
  }
}
