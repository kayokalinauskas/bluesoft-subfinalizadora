# Desempenho da importação — 22/10/2026

O fluxo anterior fazia consultas filtradas por linha, inclusive páginas vazias adicionais, repetia tudo na confirmação e gravava em sequência com pausa de 100 ms por item. A nova implementação compartilha o inventário paginado entre as linhas do lote, solicita 1.000 mapas por página e interpreta o tamanho efetivo retornado pelo ERP. Na confirmação, faz uma nova leitura compartilhada e valida todo o lote antes da primeira escrita. As gravações têm concorrência limitada a quatro, sem pausa artificial e sem repetição automática.

## Comparação real de leitura

Mesmo ambiente, token, tenant beta e proxy HTTPS de produção, usando a implementação da main anterior e a implementação nova. Lote de 31 registros: oito mapas existentes idênticos e 23 chaves sem mapa. O beta tinha 74 mapas, que couberam em uma página. Este benchmark fez somente GET; as chaves ausentes não foram usadas para gravação.

| Análise de 31 registros | Antes | Depois |
| --- | ---: | ---: |
| Requisições | 39 | 1 |
| Tempo | 9,706 s | 0,226 s |

A análise foi aproximadamente 43 vezes mais rápida nessa execução. São medições de uma execução comparativa, sem garantia de tempo para todos os tenants. O volume total de mapas, a latência, o aquecimento do proxy e o tempo do ERP influenciam o resultado. Coleções maiores precisam de mais páginas; a quantidade de consultas depende do inventário, em vez do número de linhas da planilha. O envio manual mantém o filtro por subfinalizadora.

## Validação de gravações no navegador

Chromium com frontend novo local, proxy HTTPS de produção e ERP beta. Cada lote continha dois registros: mapa preexistente 6/subfinalizadora 25 e fixture na subfinalizadora 26.

| Operação | Análise | Análise + confirmação | Requisições |
| --- | ---: | ---: | --- |
| Criar fixture e preservar existente | 0,405 s | 1,159 s | GET, GET, POST |
| Reimportar ambos idênticos | 0,227 s | 0,844 s | GET, GET |
| Atualizar administradora e preservar existente | 0,289 s | 1,034 s | GET, GET, PUT |

Esses tempos incluem a automação de cliques; não incluem o intervalo de decisão humana. A revisão mostrou `TST → TS2` antes do PUT. Não houve erros JavaScript, e o mapa preexistente foi comparado integralmente e preservado. A fixture 168 foi removida ao final; nenhuma escrita foi enviada a tenant de produção.

Um PUT no ID ausente 201 retornou 404, com a mensagem de mapa não encontrado, e não criou registro. Portanto, o fluxo único decide entre POST para ausentes e PUT para existentes; não expõe seletor de modo.

## Regressões e limites

Os 45 testes automatizados cobrem o lote misto de 31 linhas, apenas duas leituras compartilhadas entre análise e confirmação, preservação de idênticos, paginação com tamanho reduzido pelo ERP, IDs corretos no PUT, ambiguidades, bloqueio de todo o lote se o último registro mudou, erros por item e ausência de tentativas automáticas. Testes com oito gravações controladas verificam paralelismo real e limite de quatro requisições em andamento; o cancelamento aguarda essas quatro e impede as demais.

Não há transação ou escrita condicional no contrato utilizado. A revalidação reduz o risco de revisão desatualizada, mas não elimina alterações concorrentes no ERP entre consulta e gravação. O relatório registra o resultado individual; cancelar não desfaz gravações concluídas ou em andamento. Dados e tokens não são armazenados em cache pelo serviço.
