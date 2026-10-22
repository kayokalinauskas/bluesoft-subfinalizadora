# Validação autenticada no beta — 22/10/2026

A conta GitHub foi confirmada como `kayokalinauskas`, com permissão de push nos dois repositórios. O token do ERP foi recebido somente pela variável de ambiente `tenant_token`; seu valor não foi salvo no Git, nos relatórios ou nos scripts.

## Resultado

- Consultas autenticadas pelo proxy local confirmaram o envelope `{ currentPage, pageSize, data }`, a paginação base zero e o nome de exibição `SiTef`.
- A preservação de mapa idêntico foi verificada com o mapa 6/subfinalizadora 25, sem modificá-lo.
- A subfinalizadora 601 retornou cinco mapas; a conciliação bloqueou a seleção automática.
- O beta aceitou um POST idêntico a um mapa existente. A fixture 161 foi usada para verificar o PUT por ID, depois removida. O mapa original 6 foi comparado ao estado inicial e preservado integralmente. Portanto, não se deve depender de erro de duplicidade do ERP para decidir entre POST e PUT.
- A subfinalizadora 5001 da planilha recebida não existe no beta. A tentativa foi rejeitada pelo ERP com erro de referência, sem criação de mapa.
- Foi confirmada uma subfinalizadora válida e sem mapa, 26. A fixture de descoberta 162 foi removida antes do teste pela interface.
- No Chromium, o upload de um XLSX de teste para a subfinalizadora 26 foi analisado e confirmado: POST criou o mapa 163. A reimportação identificou os dados idênticos e não fez POST/PUT. Uma nova planilha alterou somente `codigoAdministradora` de `TST` para `TS2`; a revisão mostrou a diferença e a confirmação fez PUT no mapa 163. Não houve erros JavaScript de página.
- O XLSX original também foi carregado no Chromium com o SheetJS atualizado: as 31 linhas foram lidas e validadas, sem envio ao ERP.
- A fixture 163 foi removida pela API documentada de exclusão, e uma nova consulta confirmou ausência de mapas para a subfinalizadora 26. A exclusão foi usada apenas na limpeza das fixtures criadas pelo teste e não foi adicionada à interface nem ao proxy de produção.

As escritas foram feitas exclusivamente no tenant `beta`. Não houve requisição a tenant de produção. Os scripts locais de teste ao vivo não fazem parte de `npm test`; essa suíte continua sem dependência de credenciais ou do ERP.

## Verificações automatizadas

A instalação congelada pelo lockfile, a auditoria (`npm run audit:security`), os 38 testes do frontend/serviço/worker, os 10 testes do proxy e o build passaram. O SheetJS foi atualizado para 0.20.3 pela distribuição oficial; a auditoria não reportou vulnerabilidades.

## Limites

A reconsulta anterior à gravação não oferece atomicidade entre GET e PUT. O ERP precisa oferecer escrita condicional para eliminar essa janela. O contrato e a interface foram validados no beta; permissões, dados e regras de negócio podem variar nos demais tenants. A publicação do frontend e do proxy continua necessária para disponibilizar a correção aos usuários.
