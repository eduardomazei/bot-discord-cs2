# 🤖 CS2 Mix Bot — Discord & Google Sheets Integration

Bot automatizado para gerenciamento de partidas de Mix de Counter-Strike 2 no Discord, integrado em tempo real com Google Sheets para acompanhamento de estatísticas, sistema de Elo dinâmico e utilidades administrativas (lives, anúncios, streamers).

## 🚀 Funcionalidades
- **📅 Presença (`/presenca`)**: lista de confirmação com vagas limitadas, painel fixo auto-atualizado, fila de **Reserva** quando a lista oficial lota (com promoção automática ao cancelar, ou manual via `/presenca promover`).
- **🗺️ Veto de Mapas (`/pick`)**: sistema dinâmico de Ban & Pick para MD1 e MD3.
- **🎖️ Sistema de Elo / MMR (`/elo`, `/resultado`, `/importar-partida`)**: atualização automática de pontos por partida e performance individual (ADR/K-D).
- **📊 Estatísticas Avançadas (`/hall-da-fama`, `/x1`, `/stats-mapa`, `/partida-info`)**: recordes históricos da comunidade, confronto direto entre jogadores e detalhes de partidas importadas.
- **🎲 Sorteio Balanceado (`/sortear`)**: forma times de até 5 lendo o rank na tag do nick ou a lista de presença confirmada.
- **⚙️ Automação de Voz (`/mover-times`, `/reunir`)**: movimentação automática entre canais de voz do Discord.
- **📺 Streamers e Lives (`/lives`, `/addstreamer`, `/removerstreamer`)**: aviso automático no Discord quando um streamer oficial entra ao vivo.
- **📢 Utilidades administrativas (`/anuncio`, `/config`, `/clear`, `/help`)**: visual em Components V2, comandos admin escondidos da lista de quem não tem o cargo.

## 🛠️ Tecnologias Utilizadas
- Node.js
- Discord.js v14 (Components V2)
- Google Spreadsheet API (`google-spreadsheet` + `google-auth-library`)
- dotenv
- axios / csv-parser (integração com API do MatchZy/Firegames)

## 🗂️ Estrutura do projeto

O bot está em migração progressiva (padrão *strangler fig*) de um `index.js` monolítico pra uma estrutura modular. Os dois sistemas convivem hoje:

```
bot-mix-cs2/
├── index.js                  # Entry point: cliente Discord, loaders, login
├── events/
│   └── interactionCreate.js  # Roteador principal: tenta client.commands (modular) primeiro,
│                              #   cai pra legacy/interactionRouter.js se não achar
├── legacy/
│   └── interactionRouter.js  # Comandos ainda não migrados (definidos em commands/_definicoes.js),
│                              #   + TODOS os modals/botões/select-menus do bot, ~2900 linhas
├── loaders/
│   ├── loadCommands.js       # Varre commands/<categoria>/*.js -> Collection { data, execute }
│   └── loadEvents.js
├── commands/
│   ├── _definicoes.js        # Array de SlashCommandBuilder dos comandos ainda não modularizados
│   ├── geral/                 # help, anuncio, config (modular, Components V2)
│   ├── moderacao/             # clear
│   └── streamers/             # lives, addstreamer, removerstreamer
├── firegamesService.js        # Integração com a API do MatchZy/Firegames (usado por /importar-partida)
├── state/
│   └── presencaPersistence.js # Persiste a lista de presença em data/presenca.json (sobrevive a restart)
├── utils/
│   ├── sheets.js               # Conexão com Google Sheets (getSheet, doc)
│   ├── permissions.js          # ehAdministrador, replyNoPermission, CARGOS_ADM_IDS
│   ├── containers.js           # Helpers do Components V2 (buildContainer, componentsV2Payload)
│   ├── colors.js               # Paleta de cor única por significado (CORES.SUCESSO/ERRO/AVISO/...)
│   ├── streamers.js            # CRUD da aba "Streamers"
│   └── config.js               # Canais fixos lidos do .env (CANAIS.lives/logs/anuncios)
├── docs/
│   ├── adr/                    # Decisões de arquitetura documentadas (ADRs numeradas)
│   ├── plans/                  # Plano da modularização em andamento
│   └── research/
├── CONTEXT.md                  # Glossário de domínio (Partida, Reserva, Cargo Admin, etc.)
├── CLAUDE.md                   # Guia do projeto pro Claude Code
├── .env.example
└── package.json
```

> Comando novo? Vai em `commands/<categoria>/` seguindo o padrão modular (`{ data, execute }`), não em `commands/_definicoes.js`/`legacy/interactionRouter.js` — esses dois estão sendo eliminados aos poucos. Ver `docs/plans/modularizacao-index-js.md`.

> **Dois sistemas de visual coexistem de propósito**: comandos modulares e os de exibição simples do `legacy/interactionRouter.js` (`/elo`, `/player`, `/ranking`, `/hall-da-fama`, `/stats-mapa`, `/partida-info`, `/x1`, `/regras`, `/server`) usam **Components V2** (`utils/containers.js`); os comandos com fluxo de botão/estado mais complexo (`/presenca`, `/pick`, `/registrar`, `/importar-partida`, etc.) ainda usam `EmbedBuilder` clássico. As duas coisas não podem ser misturadas na mesma mensagem — ver `CLAUDE.md` pra detalhes técnicos.

## 📜 Comandos disponíveis

### Todos podem usar
| Comando | Descrição |
|---|---|
| `/help` | Mostra os comandos disponíveis (se você for Owner/Directors, também mostra os comandos ADM) |
| `/registrar [usuario]` | Abre o formulário pra vincular SteamID64/Faceit/Gamers Club |
| `/presenca confirmar [jogador]` | Confirma presença no próximo Mix (entra na Reserva se a lista oficial já estiver cheia) |
| `/presenca cancelar [jogador]` | Cancela uma presença confirmada ou uma posição na Reserva |
| `/presenca lista` | Mostra a lista atual de confirmados e da Reserva |
| `/elo [usuario]` | Elo e histórico de performance |
| `/player [usuario]` | Perfil do jogador no Mix |
| `/ranking` | Top 10 do Mix |
| `/stats-mapa [mapa] [jogador]` | Estatísticas filtradas por mapa |
| `/x1 adversario` | Comparação head-to-head |
| `/hall-da-fama` | Recordes históricos da comunidade |
| `/partida-info [id] [servidor]` | Placar e detalhes de uma partida |
| `/sortear [origem]` | Sorteia times balanceados por rank ou pela lista de presença |
| `/pick modo [capitao_a] [capitao_b]` | Veto de mapas (Pick & Ban) |
| `/server` | IPs dos servidores de CS2 |
| `/regras` | Painel de regras do Mix |
| `/lives` | Avisa no canal de lives que você (streamer oficial) está ao vivo |

### Somente Owner/Directors/Founders/🕸️Trupe
> Esses comandos ficam escondidos da lista de `/` pra quem não tem um desses 4 cargos (todos com permissão nativa "Administrador" no Discord) — ver `docs/adr/0004`.

| Comando | Descrição |
|---|---|
| `/presenca criar vagas [vagas_reserva]` | Abre uma nova lista de presença (Reserva opcional, padrão 10 vagas) |
| `/presenca finalizar` | Encerra a lista de presença manualmente (oficial + Reserva) |
| `/presenca promover jogador [remover]` | Promove alguém da Reserva fora de ordem, opcionalmente trocando com um confirmado |
| `/resultado ...` | Registra o resultado de uma partida (Stats + Elo) |
| `/importar-partida` | Puxa o CSV do MatchZy via API, mostra preview e só grava Stats/Elo após confirmação |
| `/mover-times canal_time_a canal_time_b` | Move os dois times pras salas de voz |
| `/reunir canal_lobby` | Reúne todo mundo de volta no Lobby |
| `/advertir jogador tipo [motivo]` | Aplica advertência com pontuação |
| `/ausente jogador` | Registra ausência/WO |
| `/desadvertir jogador [pontos]` | Remove advertências |
| `/mudar-nick usuario novo_nick` | Altera o apelido de um membro |
| `/anuncio titulo descricao canal [cor] [imagem]` | Cria um anúncio personalizado |
| `/addstreamer jogador canal_twitch` | Registra um streamer oficial |
| `/removerstreamer jogador` | Remove o status de streamer oficial |
| `/config` | Painel com os canais configurados (lives/logs/anúncios) |
| `/clear quantidade` | Deleta mensagens do canal atual |

## 🔧 Variáveis de ambiente (`.env`)
| Variável | Obrigatória | Descrição |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Token do bot no Discord Developer Portal |
| `CLIENT_ID` | ✅ | ID da aplicação Discord (usado pelo `npm run deploy`) |
| `GUILD_ID` | ✅ | ID do servidor Discord (os slash commands são registrados por guild) |
| `SPREADSHEET_ID` | ✅ | ID da planilha do Google Sheets |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | E-mail da Service Account do Google |
| `GOOGLE_PRIVATE_KEY` | ✅ | Chave privada da Service Account |
| `PTERODACTYL_API_KEY` | Só p/ `/importar-partida` | API key do painel Pterodactyl (MatchZy) |
| `PTERODACTYL_URL` | Só p/ `/importar-partida` | URL do painel Pterodactyl |
| `SERVER_ID_1` … `SERVER_ID_4` | Só p/ `/importar-partida` | IDs dos servidores de CS2 no painel (também usados no dropdown de `/partida-info`) |
| `CANAL_LIVES_ID` | Recomendada | Canal onde o `/lives` posta o aviso — sem isso, `/lives` avisa que não está configurado |
| `CANAL_LOGS_ID` | Opcional | Canal reservado pra logs de moderação (ainda sem comando consumindo) |
| `CANAL_ANUNCIOS_ID` | Opcional | Só informativo no painel do `/config` — `/anuncio` sempre pede o canal na hora, não lê essa variável |

## 📊 Planilha do Google Sheets
O bot espera as seguintes abas na spreadsheet (`SPREADSHEET_ID`):
| Aba | Uso |
|---|---|
| `Jogadores` | Cadastro (SteamID64, Faceit, Elo, stats, advertências, etc.) |
| `Partidas` | Histórico de partidas — inclui `server_id` (cada servidor CS2 tem sua própria numeração de `matchid`, então os dois juntos identificam a partida) e o elenco (`team_a_ids`/`team_b_ids`) em formato `steamid64:nomeCS2`, resolvido pra menção Discord na leitura |
| `Stats_Partidas` | Estatísticas por jogador/partida — também com `server_id` |
| `Streamers` | Streamers oficiais (usada por `/lives`, `/addstreamer`, `/removerstreamer`) — colunas: **`discord_id`**, **`Canal Twitch`**, **`Ativo`** |

> A aba `Streamers` precisa ser criada manualmente na planilha antes de usar esses 3 comandos, com esse cabeçalho exato na primeira linha.

## ▶️ Como rodar
```bash
# 1. Instale as dependências
npm install

# 2. Configure o ambiente
cp .env.example .env
# preencha o .env com o token do bot, credenciais do Google Sheets e os canais desejados

# 3. Garanta que a planilha tem as abas Jogadores, Partidas, Stats_Partidas e Streamers
#    (a Streamers precisa do cabeçalho: discord_id | Canal Twitch | Ativo)

# 4. Registre os slash commands no seu servidor
npm run deploy

# 5. Rode o bot
node index.js
```

Depois de qualquer mudança em definição de comando (nome, descrição, opções), rode `npm run deploy` de novo — reiniciar o bot sozinho não atualiza isso no Discord.

## 📄 Mais contexto
- `CLAUDE.md` — guia técnico da arquitetura pra quem (ou qual IA) for mexer no código.
- `CONTEXT.md` — glossário dos termos de domínio (Partida, Time A/B, Reserva, Cargo Admin, etc.).
- `docs/adr/` — decisões de arquitetura não-óbvias, documentadas com o porquê.
