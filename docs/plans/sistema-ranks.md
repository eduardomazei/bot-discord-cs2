# Sistema de Ranks (E → SS)

Status: **v1 implementada e em produção** (deploy + restart feitos em 2026-08-20). Este
documento resume a sessão que criou a feature, pra retomar depois sem precisar re-explicar o
contexto — ver "Próximos passos" pro que ficou pra depois.

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

| Rank | Elo mínimo | Emoji (placeholder) |
|---|---|---|
| E | 1000 | ⚪ |
| D | 1300 | 🟤 |
| C | 1600 | 🟢 |
| B | 1900 | 🔵 |
| A | 2200 | 🟣 |
| S | 2500 | 🟠 |
| SS | 2800 | 🔴 |

Os emojis são unicode simples por enquanto — candidatos naturais pra virarem emoji customizado
da trupe na leva de design mencionada em `next-session-design-pass` (memória do usuário).

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

## Próximos passos (não feito nesta sessão)

- `/player` e `/ranking` ainda não mostram o rank (letra/emoji) ao lado do Elo — só `/rank`
  mostra. Se fizer sentido, adicionar uma linha "Rank: X" nesses dois usando
  `obterRank()` de `utils/ranks.js`.
- `CONTEXT.md` (glossário de domínio) não foi atualizado com o termo "Rank" — vale registrar,
  já que agora é terminologia de domínio nova.
- Nenhum ADR foi escrito pra essa decisão (mudança na fórmula de Elo é meio "hard to reverse"
  pro histórico de partidas já gravadas, no sentido de que a fórmula antiga não é mais
  reproduzível a partir da linha salva — mas o valor em si não muda retroativamente). Avaliar se
  vale um `docs/adr/0006-...`.
- Emoji por rank são unicode genéricos — trocar por emoji customizado da trupe quando rolar a
  leva de design (ver memória `next-session-design-pass`).
- Não houve recálculo retroativo: a nova fórmula só vale pra partidas importadas **depois**
  dessa mudança. Elo acumulado de partidas antigas não foi tocado.
- Observação à parte (não relacionada à feature): o `dotenv` está imprimindo um "tip" no console
  apontando pra um domínio (`vestauth.com`) que não é um parceiro conhecido do dotenv — vale
  conferir a versão instalada em algum momento, sem urgência.
