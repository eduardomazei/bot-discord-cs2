# 🤖 CS2 Mix Bot — Discord & Google Sheets Integration

Bot automatizado para gerenciamento de partidas de Mix de Counter-Strike 2 no Discord, integrado em tempo real com Google Sheets para acompanhamento de estatísticas, sistema de Elo dinâmico e utilidades administrativas (lives, anúncios, streamers).

## 🚀 Funcionalidades
- **📅 Presença (`/presenca`)**: lista de confirmação com vagas limitadas, painel fixo auto-atualizado.
- **🗺️ Veto de Mapas (`/pick`)**: sistema dinâmico de Ban & Pick para MD1 e MD3.
- **🎖️ Sistema de Elo / MMR (`/elo`, `/resultado`)**: atualização automática de pontos por partida e performance individual (ADR/K-D).
- **📊 Estatísticas Avançadas (`/hall-da-fama`, `/x1`, `/stats-mapa`)**: recordes históricos da comunidade e confronto direto entre jogadores.
- **🎲 Sorteio Balanceado (`/sortear`)**: forma times de até 5 lendo o rank na tag do nick.
- **⚙️ Automação de Voz (`/mover-times`, `/reunir`)**: movimentação automática entre canais de voz do Discord.
- **📺 Streamers e Lives (`/lives`, `/addstreamer`, `/removerstreamer`)**: aviso automático no Discord quando um streamer oficial entra ao vivo.
- **📢 Utilidades administrativas (`/anuncio`, `/config`, `/clear`, `/help`)**: migradas do bot antigo (trupe-bot), com visual em Components V2.

## 🛠️ Tecnologias Utilizadas
- Node.js
- Discord.js v14 (Components V2)
- Google Spreadsheet API (`google-spreadsheet` + `google-auth-library`)
- dotenv
- axios / csv-parser (integração com API do MatchZy/Firegames)

## 🗂️ Estrutura do projeto
```
bot-mix-cs2/
├── index.js               # Entry point: cliente Discord, ~21 comandos "legados" (embeds normais),
│                           #   registro dos slash commands e o interactionCreate principal
├── firegamesService.js     # Integração com a API do MatchZy/Firegames (usado por /importar-partida)
├── commands/                # Comandos modulares migrados do trupe-bot (Components V2)
│   ├── help.js
│   ├── lives.js
│   ├── anuncio.js
│   ├── addstreamer.js
│   ├── removerstreamer.js
│   ├── config.js
│   └── clear.js
├── utils/                   # Utilitários compartilhados entre index.js e commands/
│   ├── sheets.js             # Conexão com Google Sheets (getSheet, doc)
│   ├── permissions.js        # ehAdministrador, replyNoPermission
│   ├── containers.js         # Helpers do Components V2 (buildContainer, componentsV2Payload)
│   ├── streamers.js          # CRUD da aba "Streamers"
│   └── config.js             # Canais fixos lidos do .env (CANAIS.lives/logs/anuncios)
├── .env.example
└── package.json
```
> Nota: os comandos "legados" ficam inline no `index.js` e usam `EmbedBuilder` tradicional; os 7 comandos migrados do trupe-bot vivem em `commands/` e usam o sistema Components V2 (containers). Os dois estilos convivem de propósito — comandos novos que sigam o padrão do trupe-bot devem ir em `commands/`.

## 📜 Comandos disponíveis

### Todos podem usar
| Comando | Descrição |
|---|---|
| `/help` | Mostra os comandos disponíveis (se você for Owner/Directors, também mostra os comandos ADM) |
| `/registrar [usuario]` | Abre o formulário pra vincular SteamID64/Faceit/Gamers Club |
| `/presenca confirmar [jogador]` | Confirma presença no próximo Mix |
| `/presenca cancelar [jogador]` | Cancela uma presença confirmada |
| `/presenca lista` | Mostra a lista atual de confirmados |
| `/elo [usuario]` | Elo e histórico de performance |
| `/player [usuario]` | Perfil do jogador no Mix |
| `/ranking` | Top 10 do Mix |
| `/stats-mapa [mapa] [jogador]` | Estatísticas filtradas por mapa |
| `/x1 adversario` | Comparação head-to-head |
| `/hall-da-fama` | Recordes históricos da comunidade |
| `/partida-info [id]` | Placar e detalhes de uma partida |
| `/sortear [origem]` | Sorteia times balanceados por rank |
| `/pick modo [capitao_a] [capitao_b]` | Veto de mapas (Pick & Ban) |
| `/conectar` / `/server` | IPs dos servidores de CS2 |
| `/regras` | Painel de regras do Mix |
| `/lives` | Avisa no canal de lives que você (streamer oficial) está ao vivo |

### Somente Owner/Directors
| Comando | Descrição |
|---|---|
| `/presenca criar vagas` | Abre uma nova lista de presença |
| `/presenca finalizar` | Encerra a lista de presença manualmente |
| `/resultado ...` | Registra o resultado de uma partida (Stats + Elo) |
| `/importar-partida` | Puxa o CSV do MatchZy via API e atualiza Elo/Stats |
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
| `GUILD_ID` | ✅ | ID do servidor Discord (os slash commands são registrados por guild) |
| `SPREADSHEET_ID` | ✅ | ID da planilha do Google Sheets |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | E-mail da Service Account do Google |
| `GOOGLE_PRIVATE_KEY` | ✅ | Chave privada da Service Account |
| `PTERODACTYL_API_KEY` | Só p/ `/importar-partida` | API key do painel Pterodactyl (MatchZy) |
| `PTERODACTYL_URL` | Só p/ `/importar-partida` | URL do painel Pterodactyl |
| `SERVER_ID_1` … `SERVER_ID_4` | Só p/ `/importar-partida` | IDs dos servidores de CS2 no painel |
| `CANAL_LIVES_ID` | Recomendada | Canal onde o `/lives` posta o aviso — sem isso, `/lives` avisa que não está configurado |
| `CANAL_LOGS_ID` | Opcional | Canal reservado pra logs de moderação (ainda sem comando consumindo) |
| `CANAL_ANUNCIOS_ID` | Opcional | Só informativo no painel do `/config` — `/anuncio` sempre pede o canal na hora, não lê essa variável |

## 📊 Planilha do Google Sheets
O bot espera as seguintes abas na spreadsheet (`SPREADSHEET_ID`):
| Aba | Uso |
|---|---|
| `Jogadores` | Cadastro (SteamID64, Faceit, Elo, stats, advertências, etc.) |
| `Partidas` | Histórico de partidas |
| `Stats_Partidas` | Estatísticas por jogador/partida |
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

# 4. Rode o bot
node index.js
```
