# Bluesoft - Mapeamento de Finalizadoras

Ferramenta web para importação em lote de mapeamentos de subfinalizadoras via API REST do Bluesoft ERP. 

![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Vite](https://img.shields.io/badge/vite-7.x-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/javascript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Deploy](https://img.shields.io/badge/deploy-GitHub%20Pages-222?logo=github)

---

## Funcionalidades

- **Importação por planilha** — suporte a `.xlsx`, `.xls` e `.csv`
- **Preview antes de enviar** — mostra as primeiras linhas mapeadas para confirmação
- **Validação automática** — linhas inválidas são sinalizadas antes do envio, não durante
- **Progresso em tempo real** — barra de progresso linha a linha
- **Relatório de erros** — exportável como CSV ao final do processamento
- **Envio manual** — formulário para enviar registros individuais sem planilha
- **Histórico de envios** — persiste localmente entre sessões

---

## Stack

| Camada | Tecnologia |
|---|---|
| Build | [Vite 7](https://vitejs.dev/) |
| Estilo | [Tailwind CSS v4](https://tailwindcss.com/) |
| Parsing Excel | [SheetJS (xlsx)](https://sheetjs.com/) via Web Worker |
| Parsing CSV | [PapaParse](https://www.papaparse.com/) com worker interno |
| CORS Proxy | Serverless function no [Vercel](https://vercel.com/) (repo separado) |
| Deploy | GitHub Pages |

---

## Arquitetura

A aplicação é vanilla JS modular, sem framework. Cada módulo tem uma responsabilidade única:

```
src/
  main.js                   # Entry point: 7 linhas
  config.js                 # CONFIG (constantes) + DOM_ELEMENTS (cache de seletores)
  app.js                    # Controlador principal: eventos e orquestração de UI
  state.js                  # Estado em memória + persistência no localStorage
  workers/
    excel.worker.js         # Parsing de Excel off-thread (Web Worker Vite-bundled)
  services/
    api.js                  # POST para o proxy Vercel
    storage.js              # Wrapper de localStorage
  processors/
    dataProcessor.js        # Parse de arquivos + mapeamento de colunas → payload
    validator.js            # Validação do payload antes do envio
  ui/
    alerts.js               # Toast notifications
```

### Destaques técnicos

**Parsing não-bloqueante**  
O parsing de Excel é delegado a um [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) real (bundlado pelo Vite com `?worker`), com transferência de `ArrayBuffer` por ownership (zero cópia). Flags de otimização do SheetJS (`dense: true`, sem `cellDates/cellNF/cellHTML/cellStyles`) reduzem o tempo de parsing em 3–5×. O CSV usa o modo worker nativo do PapaParse. A UI nunca congela durante o carregamento de arquivos grandes.

**Validação assíncrona por chunks**  
O loop de validação pós-parse processa 500 linhas por iteração e cede o event loop (`setTimeout(0)`) entre chunks, mantendo a UI responsiva mesmo com planilhas de milhares de linhas.

**Worker com settle guard**  
O worker de Excel usa uma flag `done` + `clearTimeout` para garantir que a Promise resolve/rejeita exatamente uma vez, mesmo em race conditions entre `onmessage`, `onerror` e o timeout de 60s.

---

## Configuração local

```bash
git clone https://github.com/<seu-usuario>/bluesoft-subfinalizadora.git
cd bluesoft-subfinalizadora

npm install
```

Crie o arquivo `.env` na raiz:

```env
VITE_PROXY_URL=https://seu-proxy.vercel.app/api/proxy
```

> O proxy é uma serverless function separada que repassa as requisições para o ERP e contorna o CORS. Você precisa de uma instância própria.

```bash
npm run dev      # http://localhost:5173/bluesoft-subfinalizadora/
npm run build    # gera dist/
npm run preview  # preview do build de produção
```

---

## Formato da planilha

| Coluna | Tipo | Observação |
|---|---|---|
| `sub_finalizadora_key` | inteiro | |
| `codigo_autorizadora` ou `codigo_administradora` | string | `codigo_autorizadora` tem prioridade |
| `codigo_bandeira` | inteiro | |
| `tipo_tef_key` | inteiro | `1` = SITEF · `2` = POS |
| `tipo_cartao` | string | Substring match: "parcelado" → `CARTAO_PARCELADO`, "crédito" → `CARTAO_CREDITO`, "voucher" → `CARTAO_VOUCHER`; padrão = `CARTAO_DEBITO` |

Linhas inválidas são removidas automaticamente antes do envio, com contagem exibida ao usuário.

---

## Deploy

O build é publicado automaticamente no GitHub Pages via GitHub Actions a cada push na `main`. O Vite gera assets com hash no nome para cache-busting automático.
