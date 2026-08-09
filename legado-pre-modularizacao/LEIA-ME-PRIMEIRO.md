# ⚠️ Código legado — não executar

Este é um **snapshot congelado** do bot exatamente como ele estava antes da
modularização do `index.js` (commit `5330e89`, tag `pre-modularizacao`).

Guardado aqui só como referência visual rápida do "antes" (o `README.md` ao
lado é o README antigo, também congelado nesse ponto). A forma correta e
completa de recuperar este estado (incluindo `.gitignore`, histórico
completo, etc.) é pelo Git, não por esta pasta:

```
git checkout pre-modularizacao
```

**Não rode `npm install` nem `node index.js` dentro desta pasta.** Ela não
tem `.env`, não tem `node_modules`, e o `commands/` daqui referencia
`../utils/` relativo a esta própria pasta — não foi pensado pra ser
executado isolado, só pra leitura/comparação.

Ver [`docs/plans/modularizacao-index-js.md`](../docs/plans/modularizacao-index-js.md)
para o diagnóstico completo do que motivou a reestruturação.
