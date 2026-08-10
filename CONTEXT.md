# Bot Mix CS2

Bot de Discord que organiza mixes (partidas amistosas) de CS2 para a comunidade: registra jogadores, importa resultados de partidas via CSV do MatchZy, calcula Elo/MVP, e expõe tudo via slash commands.

## Language

**Partida**:
Uma sessão de CS2 jogada e registrada no sistema, com mapa, placar, elenco dos dois times e (quando importada via CSV) MVP calculado. Vive na aba `Partidas` da planilha, uma linha por partida, identificada por `matchid`.
_Avoid_: Jogo, match (em código já usa `matchid`, mas na conversa/domínio o termo é "Partida")

**Time A / Time B**:
Os dois lados de uma Partida, sempre rotulados assim no `/partida-info` (rótulo fixo, não o nome bruto do time que veio do CSV do MatchZy). O campo `team_winner` também deve gravar literalmente `"Time A"` ou `"Time B"` — não o nome de time cru do CSV (ex.: `"CT"`, `"TERRORIST"`, tag de clã) — para bater com os rótulos do elenco.
_Avoid_: Team A/Team B, o nome literal do time do CSV como rótulo de exibição

**Jogador Registrado**:
Uma pessoa com linha própria na aba `Jogadores`, vinculando `discord_id` (ID numérico do Discord) a `steamid64` (conta Steam). Só um Jogador Registrado pode aparecer no elenco de uma Partida como menção Discord (`<@id>`).
_Avoid_: Usuário cadastrado, membro

**Jogador não cadastrado**:
Um participante de uma Partida (presente no CSV do MatchZy, com `steamid64` próprio) que ainda não tem linha na aba `Jogadores` — ou seja, sem `discord_id` vinculado. Aparece no elenco do Time A/B como texto puro (nome do CS2), não como menção Discord.
_Avoid_: Jogador sem conta, convidado

**discord_id vs discord_nick**:
`discord_id` é o ID numérico do Discord da pessoa (imutável, usado como chave). `discord_nick` é o apelido de exibição no servidor (`displayName`), sempre buscado automaticamente a partir do `discord_id` — nunca digitado manualmente.
_Avoid_: Usar "discord_nick" como se fosse chave/identificador estável

**MVP**:
O jogador com mais abates (empate: mais dano) em uma Partida importada via CSV. Gravado na aba `Partidas` já como menção Discord (`<@id>`) se o jogador for Registrado, ou como nome cru do CS2 caso contrário.

**Lista de Presença**:
Convocação para o próximo Mix, criada via `/presenca criar` com um número fixo de vagas. Tem dois grupos de pessoas: os **Confirmados** (preenchem as vagas oficiais, entram em `/sortear origem:presenca`) e a **Reserva** (fila de espera separada, formada por quem confirmou depois que as vagas oficiais já estavam preenchidas).
_Avoid_: Lista de presença como sinônimo só dos confirmados — o conceito completo inclui a Reserva

**Reserva**:
Um jogador que confirmou presença depois que a Lista de Presença já estava com todas as vagas oficiais preenchidas. Fica numa fila separada dos Confirmados, ordenada por ordem de chegada (não entra em `/sortear`). Quando um Confirmado cancela, o primeiro da Reserva é promovido automaticamente a Confirmado.
_Avoid_: Suplente, fila de espera (usar sempre "Reserva")
