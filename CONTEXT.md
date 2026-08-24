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

**Rank**:
Faixa de habilidade (E, D, C, B, A, S, SS) derivada do Elo de um Jogador Registrado — não é um dado próprio gravado na planilha, é sempre calculado na hora a partir do Elo atual (`obterRank()` em `utils/ranks.js`). O Elo mínimo de cada Rank sobe de 300 em 300 a partir do Elo base (1000 — todo cadastro novo via `/registrar` já nasce em E). Exibido em `/rank`, `/player` e `/ranking`.
_Avoid_: Confundir Rank com Elo — Elo é o número (pontuação contínua e ilimitada), Rank é a faixa/letra derivada dele.

**Variação de Elo por Partida**:
Quanto um jogador ganha (vitória) ou perde (derrota) de Elo ao ter uma Partida importada via CSV, escalado pelo KD (kills/deaths) que ele fez NAQUELA partida específica — não pelo KD acumulado de carreira. Ver `FAIXAS_KD` em `utils/ranks.js`: de +10 (KD < 0,60) a +40 (KD ≥ 1,70) numa vitória, de -30 a -5 no mesmo sentido numa derrota — pra punir menos quem carrega o time numa derrota e mais quem só pegou carona numa vitória.
_Avoid_: Achar que a variação é fixa por vitória/derrota (era assim antes, com bônus de ADR — não é mais)

**Lista de Presença**:
Convocação para o próximo Mix, criada via `/presenca criar` com um número fixo de vagas. Tem dois grupos de pessoas: os **Confirmados** (preenchem as vagas oficiais, entram em `/sortear origem:presenca`) e a **Reserva** (fila de espera separada, formada por quem confirmou depois que as vagas oficiais já estavam preenchidas).
_Avoid_: Lista de presença como sinônimo só dos confirmados — o conceito completo inclui a Reserva

**Reserva**:
Um jogador que confirmou presença depois que a Lista de Presença já estava com todas as vagas oficiais preenchidas. Fica numa fila separada dos Confirmados, ordenada por ordem de chegada (não entra em `/sortear`). Quando um Confirmado cancela, o primeiro da Reserva é promovido automaticamente a Confirmado.
_Avoid_: Suplente, fila de espera (usar sempre "Reserva")

**Cargo Admin**:
Um dos 4 cargos do Discord listados em `CARGOS_ADM_IDS` (`utils/permissions.js`): Owner, Directors, Founders, 🕸️ Trupe. Todos os 4 já têm a permissão nativa "Administrador" do Discord — por isso os comandos administrativos usam essa mesma permissão (`setDefaultMemberPermissions`) pra ficarem escondidos de quem não é Cargo Admin, sem precisar reconfigurar nada toda vez que um cargo novo for promovido.
_Avoid_: "ADM"/"Administrador" sozinho como sinônimo de Owner/Directors — hoje são 4 cargos, não 2
