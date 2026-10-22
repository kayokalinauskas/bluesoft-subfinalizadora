# Revisão técnica e correção da importação

A aplicação tinha uma separação útil entre interface, processamento em worker, validação e armazenamento. Faltavam testes automatizados e uma decisão explícita entre inclusão e atualização. O fluxo antigo enviava somente POST, inclusive para registros já cadastrados. Uma mensagem de duplicidade, isoladamente, não permite diagnosticar corrupção no banco.

## Comportamento corrigido

- A análise consulta o ERP sem gravar, percorre a paginação e apresenta ação, ID do mapa e diferenças por campo.
- O modo padrão cria ausentes e preserva os idênticos. Mapas diferentes exigem o modo de atualização e confirmação explícita.
- PUT usa `mapaSubfinalizadoraTefKey` retornado pela consulta; `subFinalizadoraKey` não identifica o mapa a atualizar.
- Mais de um mapa para a subfinalizadora, dados inconsistentes, paginação repetida, formato desconhecido e falhas de consulta bloqueiam a confirmação de todo o lote. Não presumimos uma regra de unicidade ausente da documentação.
- Linhas inválidas e subfinalizadoras repetidas no arquivo precisam ser corrigidas; não são descartadas silenciosamente.
- Cada item é consultado novamente antes da execução. Uma mudança de ação, ID ou dados existentes exige nova análise. Isso reduz o risco de sobrescrever dados desatualizados, mas não substitui escrita condicional/ETag no ERP: ainda há uma janela entre GET e PUT.
- Não há fallback automático de POST com erro para PUT, nem repetição automática de escritas. Em falhas de comunicação, a gravação pode ter ocorrido; uma nova análise é necessária antes de reenviar.
- A execução é sequencial. Cancelar interrompe os próximos itens, depois da operação em andamento. Não existe transação ou reversão automática do lote.
- O histórico local é auxiliar; sua indisponibilidade não altera o resultado de uma gravação. Relatórios neutralizam mensagens que poderiam ser interpretadas como fórmulas de planilha.

## Contrato de integração

O GET usa o endpoint da coleção, com `subFinalizadoraKey`, `currentPage` (base zero) e `pageSize=100`. O envelope real foi confirmado no beta: `{ currentPage, pageSize, data: [...] }`. Aceitamos também listas JSON ou objetos com `content`/`items` e, opcionalmente, `totalPages`/`pagination.totalPages`. Sem contagem de páginas, percorremos até página vazia; uma página curta não prova que a consulta acabou. Qualquer formato diferente é bloqueado para revisão do contrato, em vez de ser tratado como ausência de registros.

As permissões documentadas são 4301 (consultar), 4302 (incluir) e 4303 (atualizar). O contrato foi confirmado por consultas autenticadas ao tenant `beta` e pelo OpenAPI oficial em `https://erp.bluesoft.com.br/beta/api/v3/api-docs`. O ERP pode retornar `SiTef` como nome de exibição; a comparação normaliza esse valor para `SITEF`. Uma página com índice diferente do solicitado bloqueia a importação.

## Segurança do proxy

O proxy agora limita destinos a HTTPS no host `erp.bluesoft.com.br` e ao caminho de mapas, valida métodos e IDs, rejeita origens desconhecidas e não segue redirecionamentos. Removemos os logs de token e corpo, adicionamos timeout e limite de corpo, preservamos status/corpo do ERP e suportamos tanto JSON já interpretado pela Vercel quanto streams locais. Headers CORS estáticos conflitantes foram removidos de `vercel.json`.

CORS é uma restrição do navegador; não autentica clientes. O ERP continua responsável por autenticar o token e autorizar cada operação. O token continua persistido no localStorage, conforme o comportamento anterior: isso merece revisão se o aplicativo for usado em computadores compartilhados. Não registrar nem incluir tokens em relatórios, testes ou commits.

## Dependências e limitações

As dependências foram atualizadas, incluindo SheetJS 0.20.3 obtido pela distribuição oficial `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. O lockfile registra a URL e a integridade do artefato. A auditoria passou de 11 pacotes com alertas para zero vulnerabilidades reportadas. Não foram usados forks nem desativadas verificações de TLS/integridade.

Foram removidas do proxy as dependências de desenvolvimento TypeScript/@vercel/node não usadas pelo código JavaScript. Os dois projetos usam Node 24. Os testes de interface usam DOM simulado; o parsing real do worker é exercitado em contexto isolado. A interface também foi exercitada em Chromium contra o proxy local e o ERP beta.

## Planilhas recebidas

Os dois anexos têm o mesmo SHA-256 e o mesmo conteúdo: 31 linhas, 31 subfinalizadoras distintas, todas válidas segundo os limites documentados. Os arquivos do cliente não foram adicionados ao Git. A subfinalizadora 5001 não existe no beta, portanto o teste de escrita usou uma fixture separada na subfinalizadora 26. O beta aceitou inclusive um POST idêntico a um mapa existente, demonstrando que o cliente não pode depender de uma rejeição de duplicidade pelo servidor. Não houve diagnóstico de sujeira em banco de produção.

## Entrega

Publicar o proxy e o frontend em seus respectivos fluxos. O frontend lê `VITE_PROXY_URL` durante o build; essa variável deve apontar para o proxy correto. Os testes de regressão e o build devem passar antes da publicação. Os testes autenticados fizeram gravações apenas no tenant beta, com remoção das fixtures ao final. Os mapas preexistentes foram preservados. Nenhuma operação foi enviada a tenant de produção.
