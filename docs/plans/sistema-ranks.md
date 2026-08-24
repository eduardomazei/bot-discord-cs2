# Sistema de Ranks (E → SS)

Status: **implementada e em produção**, incluindo a auditoria de exibição nos comandos que
consomem Elo/rank (2026-08-20/21). Este documento resume as sessões que criaram a feature e a
auditoria seguinte, pra retomar depois sem precisar re-explicar o contexto — ver "Próximos
passos" pro que ficou pra depois.

## Contexto / decisão

Objetivo: dar aos jogadores uma progressão visível de rank (E, D, C, B, A, S, SS) além do
número cru de Elo.

Duas abordagens foram discutidas e uma foi descartada:

1. **~~Puxar stats externas do Steam (KDR via Steam Web API) e ranquear por isso~~** — descartada.
   O usuário cogitou usar `ISteamUserStats/GetUserStatsForGame` (appid 730) pra ranquear pelo
   KDR de carreira do CS2, mas essa API não expõe ADR/rating e exige o perfil do jogador
   público. Decisão final: manter tudo dentro do próprio sistema de Elo do mix — mais simples,
   sem dependência externa, e `kills`/`deaths` por partida **já são coletados** do CSV do
   MatchZy (`firegamesService.js`), então dava pra fazer o rank baseado em performance sem
   puxar nada de fora.
2. **Elo interno do mix, com o ganho/perda por partida escalado pelo KD daquela partida** — a
   que foi implementada.

## Design final

### Variação de Elo por partida (substituiu o bônus fixo de ADR)

Antes: vitória sempre `+25` (±5 de bônus se ADR>100/<50), derrota sempre `-20` (±3). Isso não
diferenciava quem carregou o time de quem só "pegou carona" numa vitória.

Agora, a variação escala com o **KD da própria partida** (`kills / max(deaths, 1)`):

| KD na partida | Vitória | Derrota |
|---|---|---|
| < 0,60 | +10 | -30 |
| 0,60 – 0,99 | +18 | -23 |
| 1,00 – 1,29 | +25 | -15 |
| 1,30 – 1,69 | +32 | -10 |
| ≥ 1,70 | +40 | -5 |

Lógica: quem joga bem mas perde, perde menos; quem joga mal e perde, perde mais. Simétrico o
suficiente pra ser fácil de explicar num rodapé de embed.

### Escada de ranks

Elo mínimo pra cada rank (espaçamento fixo de 300, a partir do Elo base 1000 — não existe rank
abaixo de E, e o Elo tem piso 0):

| Rank | Elo mínimo | Emoji |
|---|---|---|
| E | 1000 | `trupe_tier_e_mazei` |
| D | 1300 | `trupe_tier_d_mazei` |
| C | 1600 | `trupe_tier_c_mazei` |
| B | 1900 | `trupe_tier_b_mazei` |
| A | 2200 | `trupe_tier_a_mazei` |
| S | 2500 | `trupe_tier_s_mazei` |
| SS | 2800 | `trupe_tier_ss_mazei` |

Emoji customizados da trupe (subidos e aplicados em sessão seguinte — ver "O que foi
implementado"), não mais unicode placeholder.

## O que foi implementado

- **`utils/ranks.js`** (novo módulo) — `calcularVariacaoElo(kills, deaths, venceu)`, `RANKS`
  (a escada acima), `obterRank(elo)`, `obterProximoRank(elo)`.
- **`firegamesService.js`** — `calcularPartida()` agora chama `calcularVariacaoElo()` em vez do
  bloco de bônus de ADR (que foi removido). Nada mudou no fluxo de preview/confirmação
  (`docs/adr/0002`) — só o número calculado.
- **`commands/stats/rank.js`** (novo comando `/rank`) — mesmo padrão visual do `/elo`
  (Components V2, `buildContainer`). Mostra Elo atual, rank atual, barra de progresso (▰▱) até
  o próximo rank com pontos faltando, e a escada completa com `▶️` marcando a posição atual.
  Rank máximo (SS) mostra mensagem de topo em vez de barra de progresso.
- **`commands/stats/elo.js`** — rodapé atualizado pra refletir a nova faixa (+10~40 / -5~30) e
  apontar pro `/rank`.
- **Deploy**: `npm run deploy` rodado (30 comandos registrados, incluindo `/rank`) e o processo
  do bot reiniciado — tudo já está valendo em produção, inclusive pra próximas partidas
  importadas via `/importar-partida`.

### Sessão seguinte — emoji customizados + auditoria de exibição

Depois da v1, o usuário subiu 9 emoji customizados na guild (`trupe_tier_e_mazei` até
`trupe_tier_ss_mazei`, `trupe_rank_mazei`, `trupe_aqui_mazei`, `trupe_barra_cheia`,
`trupe_barra_vazia`) e pediu pra trocar os placeholders unicode por eles em `utils/ranks.js` e
`commands/stats/rank.js` (barra de progresso e marcador "você está aqui").

Isso puxou uma auditoria maior nos comandos de stats, procurando o mesmo padrão de bug em todos
(nick como texto puro em vez de menção `<@id>`, sem emoji, cálculo de ADR aproximado):

- **`/stats-mapa`**: corrigido bug real de agrupamento por `discord_id` — jogadores não
  registrados compartilhavam a mesma chave literal `'NÃO_REGISTRADO'`, misturando as
  estatísticas de pessoas diferentes. Trocado pra agrupar por `steamid64`. Mentions + emoji +
  visual alinhados com `/partida-info`.
- **`/x1`**: `username` cru trocado por menção/`displayName`; cor fixa `CORES.ERRO` (semântica
  errada) trocada por cor dinâmica conforme quem está na frente no confronto; guarda pra não
  comparar consigo mesmo.
- **`/ranking`** e **`/hall-da-fama`**: mesmo bug de nick como texto, corrigido pra `<@id>` (com
  `❔` pra não-cadastrado em `hall-da-fama`, que lê de `Stats_Partidas`). `/ranking` ganhou o
  badge de tier ao lado do Elo.
- **`utils/partidas.js`** (novo módulo): `encontrarPartida()` + `totalRoundsDaPartida()` —
  extraído pra matar a duplicação do bug de ADR fixo em 24 rounds (existia em `hall-da-fama.js`
  e `stats-mapa.js`; agora usa o placar real da partida).
- **`/player`**: ganhou a linha de badge de tier ao lado do Elo (mesmo padrão do `/ranking`).
- **`CONTEXT.md`**: entradas "Rank" e "Variação de Elo por Partida" adicionadas ao glossário.

### Raio-x dos comandos EmbedBuilder clássicos (fora do Components V2)

Levantamento pedido explicitamente **sem incluir `/presenca`** (usuário pediu pra não mexer
nele). Achado principal: **`commands/mix/sortear.js` tinha seu próprio sistema de rank
paralelo**, lendo a tag de rank (E/D/C/B/A/S/SS) **do texto do nickname** do Discord (regex
antes do "┃") pra balancear os times, completamente desconectado do Elo real calculado em
`Jogadores`. Corrigido: agora usa `obterRank()` sobre o Elo de quem está registrado, e só cai
pro parser de nick pra quem não está cadastrado (`PESOS_RANK` preserva a mesma escala de peso
0/2/3/4/5/6/7 que já existia, pra não mudar o equilíbrio de quem dependia dela). A listagem de
jogadores no resultado do sorteio também passou a usar `<@id>` em vez do nick como texto.

Outros achados menores da mesma auditoria, também corrigidos: `mudar-nick.js` (mensagem de
sucesso usava `.username` cru, agora `<@id>`), e `utils/advertencias.js` (usado por `/advertir`
e `/ausente`) + `desadvertir.js` (título do embed usava `.username` cru — trocado por
`displayName`, já que **título de embed não renderiza menção**, só `description`/`fields`
renderizam `<@id>` como link).

`pick.js`, `mover-times.js`, `reunir.js` e `importar-partida.js` foram revisados e **não**
precisaram de mudança — já usam menção corretamente ou mostram nomes crus do CSV de propósito
(resolução tardia pra menção acontece na leitura, não no import — ver `docs/adr/0001`).

## Próximos passos (ainda não feito)

- **`/presenca` não foi tocado** — excluído explicitamente do escopo dessa auditoria a pedido do
  usuário. Se algum dia entrar no escopo, provavelmente tem o mesmo tipo de achado (nick vs
  menção) dado o padrão dos outros comandos.
- Nenhum ADR foi escrito pra decisão da fórmula de Elo (mudança "hard to reverse" pro histórico
  — a fórmula antiga não é mais reproduzível a partir da linha salva, embora o valor gravado não
  mude retroativamente). Avaliar se vale um `docs/adr/0006-...`.
- Não houve recálculo retroativo: a fórmula por KD só vale pra partidas importadas **depois**
  da mudança original. Elo acumulado de partidas antigas não foi tocado.
- Observação à parte (não relacionada à feature): o `dotenv` está imprimindo um "tip" no console
  apontando pra um domínio (`vestauth.com`) que não é um parceiro conhecido do dotenv — vale
  conferir a versão instalada em algum momento, sem urgência.
