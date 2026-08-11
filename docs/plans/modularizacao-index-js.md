# Plano de Modularização do `index.js` — bot-mix-cs2

**Status:** concluído (2026-08-11) — todos os comandos migraram pro padrão modular; `/resultado` foi removido em vez de migrado (decisão do usuário). `legacy/interactionRouter.js` ficou reduzido a só o select de `/regras` e os modais de `/registrar`/`/importar-partida` (nenhum loader de componentes foi construído — ver §11, "fora do escopo"). A camada `services/`/`domain/` completa descrita neste plano (§5) **não** foi construída como um todo; só o que cada migração precisou (`services/registroService.js`, `state/presencaStore.js`, `utils/elenco.js`, `utils/advertencias.js`, `utils/servidores.js`) foi extraído sob demanda. Ver `CLAUDE.md` pro estado atual resumido.
**Base normativa:** `docs/research/discord-bot-architecture-best-practices.md` (citado neste documento como *[pesquisa §N]*)
**Alvo:** sair de um `index.js` de 2353 linhas para uma estrutura `commands/` + `events/` + `services/` carregada dinamicamente, **sem downtime e sem quebrar o bot em produção**.

---

## 1. Diagnóstico

### 1.1 O que existe hoje

| Arquivo | Linhas | Papel real |
|---|---|---|
| `index.js` | 2353 | Tudo: config, estado global, helpers, 22 `SlashCommandBuilder`, registro REST no boot, e um único `interactionCreate` monolítico |
| `firegamesService.js` (raiz) | 298 | Integração Pterodactyl/MatchZy (CSV → Sheets). Usado só por `/importar-partida` |
| `commands/*.js` | 7 arquivos, 584 linhas | Únicos comandos já modulares (`data` + `execute`), estilo Components V2 |
| `utils/sheets.js` | 20 | Cliente Google Sheets (`doc`, `getSheet`) |
| `utils/permissions.js` | 53 | `ehAdministrador`, `replyNoPermission`, `CARGOS_ADM_IDS` (IDs hardcoded) |
| `utils/containers.js` | 84 | Helpers Components V2 (`buildContainer`, `componentsV2Payload`) |
| `utils/streamers.js` | 68 | CRUD da aba "Streamers" — **já é um service de fato, só está na pasta errada** |
| `utils/config.js` | 9 | Mapa `CANAIS` lido do `.env` |

**Total de slash commands: 29** — 22 definidos no array de `index.js` (linhas 208–500) + 7 vindos de `commands/` (empurrados no array na linha 503).

### 1.2 Anatomia do `index.js` (mapa por linha)

| Linhas | Conteúdo |
|---|---|
| 1–37 | `dotenv`, imports discord.js, import de `firegamesService`, `utils/sheets`, `utils/permissions` e o **mapa fixo** `commandModules` dos 7 comandos |
| 39–51 | Constantes de disciplina: `MAX_ADVERTENCIAS`, `PONTOS_POR_PUNICAO`, `DURACAO_BAN_SEMANAL_MS`, `TIPOS_ADVERTENCIA` |
| 53–60 | **Estado global** `presencaConfig` (lista de presença em memória) |
| 62–114 | **Estado global** `registroCache` + `carregarRegistroCache`, `invalidarRegistroCache`, `jogadorEstaRegistrado` (TTL 30s + lock anti-concorrência) |
| 116–145 | `verificarBloqueioJogador` (lê bans e **escreve** na planilha para liberar ban expirado) |
| 147–164 | Criação do `Client`, `client.on('error')`, `process.on('unhandledRejection')` |
| 166–205 | `construirEmbedPresenca` e `atualizarPainelPresenca` (dependem de `presencaConfig` **e** do `client`) |
| 207–503 | Array `commands` com 22 `SlashCommandBuilder` + push dos 7 modulares |
| 505–523 | `rest.put(...)` de registro **dentro do `client.once('clientReady')`** — roda a cada boot; e ainda faz `rest.put(Routes.applicationCommands(...), { body: [] })` limpando os comandos globais toda vez |
| 526–2352 | **Um único `client.on('interactionCreate')`** com: select menus (531–568), modais (573–689), dispatch dos 7 comandos modulares (699–706), trava de registro (708–727) e ~20 blocos `if (commandName === '...')` sequenciais com a regra de negócio inline |

### 1.3 Por que isso não escala

1. **Não há roteamento.** Toda interação percorre a cadeia de `if` na ordem do arquivo. Não há `else`, então cada bloco depende de um `return` correto para não vazar para o próximo — e alguns blocos (ex: `/sortear` linha 1727, `/conectar` linha 974, `/regras` linha 1015, `/pick` linha 2316) **não retornam**, só funcionam porque nenhuma condição posterior casa. É uma armadilha silenciosa para o próximo comando adicionado.
2. **Impossível abrir dois comandos ao mesmo tempo sem conflito de merge.** Qualquer alteração em qualquer comando toca o mesmo arquivo de 2353 linhas.
3. **Regra de negócio acoplada ao transporte.** Cálculo de elo (linhas 1041–1045), regra de punição (1988–2006), balanceamento de times (1676–1704), ordem de veto (2111–2129) estão dentro de handlers de interação. Nada disso é reutilizável nem testável.
4. **Acesso ao Sheets espalhado.** `getSheet('Jogadores')` aparece em 9 lugares diferentes, cada um relendo e reinterpretando as mesmas colunas. O layout da planilha (nomes de coluna, `'TRUE'` como string, `Banido_Até` em ISO) é conhecimento duplicado em ~10 pontos.
5. **Registro de comandos acoplado ao boot.** Contraria explicitamente a orientação oficial: *"it's not necessary nor desirable to connect a whole client to the gateway or do this on every ready event"* [pesquisa §2]. Pior: a cada restart o bot dispara **duas** chamadas `PUT` de application commands, uma delas apagando os comandos globais.
6. **Estado em memória sem dono.** `presencaConfig` e `registroCache` são variáveis soltas no escopo do módulo, lidas e escritas por 3 comandos diferentes (`/presenca`, `/sortear`, e a trava de registro que roda em **todo** comando). Um restart derruba a lista de presença silenciosamente — o código já reconhece isso na mensagem de erro da linha 1272.
7. **Duas arquiteturas convivendo sem regra escrita.** 7 comandos seguem o padrão oficial `module.exports = { data, execute }` [pesquisa §3] e usam Components V2; 22 são blocos `if` com `EmbedBuilder`. Não há critério documentado sobre qual usar em um comando novo.

---

## 2. Estrutura de pastas alvo

```
bot-mix-cs2/
├── index.js                       # ~50 linhas: env → client → loaders → login
├── deploy-commands.js             # registro dos slash commands (rodado à mão)
│
├── config/
│   ├── env.js                     # carrega dotenv + valida e exporta as env vars (fail-fast)
│   ├── canais.js                  # ex-utils/config.js — CANAIS.lives/logs/anuncios
│   └── cargos.js                  # IDs de Owner/Directors (hoje hardcoded em utils/permissions.js)
│
├── loaders/
│   ├── loadCommands.js            # fs.readdirSync sobre commands/<categoria>/*.js → Collection
│   ├── loadEvents.js              # fs.readdirSync sobre events/*.js → client.on/once
│   └── loadComponents.js          # fs.readdirSync sobre components/**/*.js → Collection de customId
│
├── events/
│   ├── clientReady.js             # { name: Events.ClientReady, once: true }
│   ├── interactionCreate.js       # ROTEADOR ÚNICO: comandos, autocomplete, selects, modais
│   └── error.js                   # { name: Events.Error } — hoje inline nas linhas 158-160
│
├── commands/
│   ├── mix/                       # presenca.js, sortear.js, pick.js
│   ├── stats/                     # player.js, elo.js, ranking.js, hall-da-fama.js,
│   │                              #   x1.js, stats-mapa.js, partida-info.js
│   ├── partidas/                  # resultado.js, importar-partida.js
│   ├── moderacao/                 # advertir.js, ausente.js, desadvertir.js, clear.js
│   ├── voz/                       # mover-times.js, reunir.js
│   ├── jogadores/                 # registrar.js, mudar-nick.js
│   ├── streamers/                 # addstreamer.js, removerstreamer.js, lives.js
│   ├── servidor/                  # conectar.js, server.js, regras.js
│   └── geral/                     # help.js, anuncio.js, config.js
│
├── components/                    # handlers de interações que NÃO são slash commands
│   ├── modals/                    # registrar.js (prefixo modal_registrar_),
│   │                              #   importarPartida.js (modal_importar_partida)
│   └── selects/                   # regras.js (select_regras)
│
├── services/                      # I/O com sistemas externos (Sheets, Pterodactyl)
│   ├── sheetsClient.js            # ex-utils/sheets.js — doc, getSheet, memoização do loadInfo
│   ├── jogadoresService.js        # aba "Jogadores"
│   ├── partidasService.js         # abas "Partidas" e "Stats_Partidas"
│   ├── streamersService.js        # ex-utils/streamers.js (movido, sem mudança de código)
│   ├── registroService.js         # cache de SteamID + jogadorEstaRegistrado + invalidar
│   └── firegamesService.js        # ex-raiz/firegamesService.js (movido)
│
├── domain/                        # regra de negócio PURA (zero discord.js, zero I/O)
│   ├── elo.js                     # calcularVariacaoElo({ vitoria, adr })
│   ├── advertencias.js            # TIPOS_ADVERTENCIA, PONTOS_POR_PUNICAO, calcularPunicao()
│   ├── sorteio.js                 # parseRank(), balancearTimes()
│   ├── veto.js                    # MAP_POOL, passos MD1/MD3, avancarVeto()
│   └── mapas.js                   # lista canônica de mapas (choices + pool)
│
├── state/
│   └── presencaStore.js           # ÚNICO dono do estado da lista de presença
│
├── ui/
│   ├── containers.js              # ex-utils/containers.js (Components V2)
│   └── presencaEmbed.js           # construirEmbedPresenca + atualizarPainelPresenca
│
├── utils/
│   ├── permissions.js             # ehAdministrador, replyNoPermission (fica)
│   ├── logger.js                  # NOVO: console com timestamp + nível + escopo
│   └── respond.js                 # NOVO: safeReply/safeEditReply (trata replied/deferred)
│
└── docs/
    ├── plans/modularizacao-index-js.md
    └── research/discord-bot-architecture-best-practices.md
```

### 2.1 Responsabilidade de cada camada

- **`index.js`** — só monta: `require('./config/env')` (primeira linha, antes de qualquer coisa que leia `process.env`), cria o `Client` com os 3 intents atuais, chama `loadCommands`/`loadEvents`/`loadComponents`, registra `process.on('unhandledRejection')` [pesquisa §7] e `client.login()`. **Nunca** registra comandos na API.
- **`deploy-commands.js`** — usa o mesmo `loadCommands` e faz `rest.put(Routes.applicationGuildCommands(...))`. Ver §7.
- **`config/`** — leitura e validação de ambiente. Nada aqui importa discord.js.
- **`loaders/`** — três funções puras de infraestrutura, sem regra de negócio. `loadCommands` é compartilhado por `index.js` e `deploy-commands.js` para que **a lista de comandos nunca divirja** entre o que roda e o que é registrado.
- **`commands/<categoria>/<nome>.js`** — um arquivo por comando, exportando `{ data, execute }` (+ `autocomplete` quando existir) [pesquisa §1, §3]. Contém **orquestração**: valida opções, chama services/domain, monta a resposta. Não fala com `google-spreadsheet` nem `axios` diretamente.
- **`components/`** — handlers de select menu e modal, hoje presos nas linhas 531–689 do `interactionCreate`. Padrão de módulo em §4.2. A pasta cobre a lacuna que o guia oficial não documenta (o guia só descreve `commands/` e `events/`) [pesquisa §1] e segue o que templates reais fazem com uma pasta dedicada de interações [pesquisa §10, scan de GitHub].
- **`services/`** — um módulo por sistema externo/domínio de dados, expondo funções em linguagem de domínio (`buscarJogador(discordId)`, `aplicarResultado(...)`) em vez de vazar `row.get('Advertências')` para os comandos. É a aplicação do padrão Repository [pesquisa §5], explicitamente rotulado ali como prática geral de engenharia, não algo prescrito pelo discord.js.
- **`domain/`** — funções puras. É o que torna a regra de negócio testável no futuro sem mockar Discord nem Sheets. Separação apresentação/domínio/dados [pesquisa §5].
- **`state/`** — estado de processo compartilhado entre comandos. Ver §2.2.
- **`ui/`** — builders de mensagem reaproveitados por mais de um comando. Embeds usados por um único comando ficam no próprio arquivo do comando.
- **`utils/`** — só helpers transversais que não são integração externa. A pesquisa é explícita: *"don't let integration/API code accumulate in `utils/`"* [pesquisa §5 / takeaways]. Por isso `utils/streamers.js` vira `services/streamersService.js` e `utils/sheets.js` vira `services/sheetsClient.js`.

### 2.2 Onde entram `presencaConfig` e `registroCache`

São os dois pedaços de estado que **não pertencem a nenhum comando** e por isso hoje forçam tudo a morar no mesmo arquivo. Eles vão para lugares diferentes porque têm naturezas diferentes:

**`state/presencaStore.js`** — estado de sessão puro do bot (não existe fora do processo, não vem de lugar nenhum). Exporta **funções**, nunca o objeto:

```js
// state/presencaStore.js
let estado = { aberta: false, capacidade: 10, jogadores: [], canalId: null, mensagemId: null };

function abrir({ capacidade, canalId }) { estado = { aberta: true, capacidade, jogadores: [], canalId, mensagemId: null }; }
function definirMensagemId(id) { estado.mensagemId = id; }
function confirmar({ id, name }) { /* retorna { ok, motivo, posicao, cheia } */ }
function cancelar(discordId) { /* retorna o removido ou null */ }
function fechar() { estado.aberta = false; }
function snapshot() { return { ...estado, jogadores: [...estado.jogadores].sort((a, b) => a.timestamp - b.timestamp) }; }
module.exports = { abrir, definirMensagemId, confirmar, cancelar, fechar, snapshot };
```

> **Por que funções e não o objeto:** a linha 1175 de hoje faz `presencaConfig = { ... }`, ou seja **reatribui a variável**. Se um módulo exportasse `module.exports = presencaConfig`, os outros arquivos continuariam segurando a referência antiga depois de um `/presenca criar` e a lista ficaria fantasma. Esse é o erro mais provável desta migração inteira — ver §10, risco R1.

A ordenação por `timestamp` (repetida hoje nas linhas 1251, 1330, 1622 e dentro de `construirEmbedPresenca`) passa a existir num lugar só: `snapshot()`.

**`services/registroService.js`** — apesar de ser cache em memória, ele é *cache de um recurso externo* (aba "Jogadores"), com TTL, lock de concorrência e invalidação após escrita. Isso é responsabilidade do serviço que fala com a planilha, não de um store genérico. Mantém a API atual: `jogadorEstaRegistrado(discordId)` e `invalidarCache()` (chamado hoje na linha 640, depois do `/registrar`). O comentário das linhas 63–67 explicando **por que** o cache existe (evitar estourar os 3s de ACK do Discord sob rajada de `/presenca confirmar`) deve ser movido junto — é conhecimento operacional caro de redescobrir.

`ui/presencaEmbed.js` guarda `construirEmbedPresenca(snapshot, tituloOverride, corOverride)` e `atualizarPainelPresenca(client)`. Note que `atualizarPainelPresenca` usa `client.channels.fetch` (linha 193): no formato novo o `client` vem por parâmetro, obtido de `interaction.client` dentro do comando — nada de import circular do `index.js`.

---

## 3. Categorização dos 29 comandos

### `commands/mix/` — fluxo de organização do Mix (3)

| Comando | Origem hoje | Consome |
|---|---|---|
| `presenca` (5 subcomandos) | index.js 1163–1367 | `state/presencaStore`, `ui/presencaEmbed`, `services/jogadoresService` (bloqueio), `services/registroService`, `utils/permissions` |
| `sortear` | index.js 1600–1728 | `state/presencaStore` (origem `presenca`), `domain/sorteio` |
| `pick` | index.js 2082–2317 | `domain/veto`, `domain/mapas` |

Subcomandos ficam **num arquivo só**, com `interaction.options.getSubcommand()` dentro do `execute` — é exatamente o que o guia oficial mostra [pesquisa §3]. `/presenca` continua sendo um arquivo, com as 5 branches internas.

### `commands/stats/` — consulta somente leitura (7)

| Comando | Origem | Abas lidas |
|---|---|---|
| `player` | 841–940 | Jogadores |
| `elo` | 1369–1407 | Jogadores |
| `ranking` | 1730–1773 | Jogadores |
| `hall-da-fama` | 1409–1473 | Stats_Partidas + Jogadores |
| `x1` | 1475–1525 | Partidas |
| `stats-mapa` | 1775–1897 | Stats_Partidas + Partidas |
| `partida-info` | 1899–1943 | Partidas |

Consomem `services/jogadoresService` e `services/partidasService`. São o **melhor lote para migrar primeiro entre os que tocam a planilha**: só leem, então um bug de migração não corrompe dados.

### `commands/partidas/` — escrita de resultado (2)

| Comando | Origem | Consome |
|---|---|---|
| `resultado` | 1019–1161 | `domain/elo`, `domain/mapas`, `services/jogadoresService`, `services/partidasService` |
| `importar-partida` | 782–838 (abre o modal) + 669–688 (processa) | `services/firegamesService`, `components/modals/importarPartida` |

### `commands/moderacao/` — disciplina (4)

| Comando | Origem | Consome |
|---|---|---|
| `advertir` | 1945–2027 (compartilha bloco com `ausente`) | `domain/advertencias`, `services/jogadoresService` |
| `ausente` | mesmo bloco, `tipoKey = 'falta_atraso'` fixo | idem |
| `desadvertir` | 2029–2080 | idem |
| `clear` | `commands/clear.js` | `utils/permissions` |

`advertir` e `ausente` viram dois arquivos que importam a mesma função de `domain/advertencias` — `ausente` é literalmente `advertir` com tipo fixo e motivo fixo (linhas 1957–1961).

### `commands/voz/` — movimentação de canais (2)

`mover-times` (1527–1565) e `reunir` (1567–1598). Não tocam Sheets. Só `utils/permissions`. **`/reunir` tem um bug real hoje — ver §10, risco R8.**

### `commands/jogadores/` — cadastro e identidade (2)

| Comando | Origem | Consome |
|---|---|---|
| `registrar` | 730–779 (abre modal) + 574–667 (grava) | `services/jogadoresService`, `services/registroService`, `components/modals/registrar` |
| `mudar-nick` | 2319–2351 | `utils/permissions` |

### `commands/streamers/` (3)

`addstreamer`, `removerstreamer`, `lives` — já modulares. Trocam `require('../utils/streamers')` por `require('../../services/streamersService')`.

### `commands/servidor/` — informação estática (3)

`conectar` e `server` (943–975, **hoje um bloco só, dois nomes**) e `regras` (978–1016, dono do select `select_regras`). Ver §10, risco R3 sobre o alias.

### `commands/geral/` (3)

`help`, `anuncio`, `config` — já modulares.

---

## 4. Padrão de módulo

### 4.1 Comando

```js
// commands/stats/elo.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const jogadores = require('../../services/jogadoresService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Exibe a pontuação de Elo e histórico de performance de um jogador')
    .addUserOption((o) => o.setName('usuario').setDescription('Jogador para consultar o Elo')),

  // --- metadados próprios deste projeto, lidos pelo roteador ---
  exigeRegistro: true,   // default true; os 7 comandos utilitários declaram false
  apenasAdm: false,      // true só quando o comando inteiro é restrito

  async execute(interaction) {
    await interaction.deferReply();
    const alvo = interaction.options.getUser('usuario') ?? interaction.user;
    const jogador = await jogadores.buscarPorDiscordId(alvo.id);
    // ...monta e envia o embed
  },
};
```

`data` e `execute` são nomes **obrigatórios** — o loader checa literalmente `'data' in command && 'execute' in command` [pesquisa §1, §10]. `autocomplete` só entra em comandos que precisarem [pesquisa §3]; hoje **nenhum** comando usa autocomplete, mas `/partida-info id` e `/stats-mapa` são candidatos naturais no futuro.

`exigeRegistro` e `apenasAdm` são extensões **deste projeto**, não do discord.js — o guia deixa claro que o loader só inspeciona `data`/`execute` e que qualquer estrutura extra no arquivo é invisível ao framework [pesquisa §5]. Eles existem para transformar duas regras hoje implícitas em declarações explícitas:

- `exigeRegistro` substitui o array hardcoded `comandosLiberados = ['registrar','regras','conectar','server']` (linha 709) **e** o `return` antecipado dos 7 comandos modulares (linhas 699–706), que hoje é o único motivo de `/help` não exigir cadastro. Ver §10, risco R2.
- `apenasAdm` cobre os comandos 100% restritos (`importar-partida`, `resultado`, `mover-times`, `reunir`, `advertir`, `ausente`, `desadvertir`, `mudar-nick`, `anuncio`, `addstreamer`, `removerstreamer`, `config`, `clear`). Os de permissão **parcial** — `/registrar` (só exige ADM ao cadastrar outra pessoa, linha 734) e `/presenca` (só em `criar`/`finalizar`, linhas 1167 e 1314) — mantêm o `ehAdministrador()` dentro do `execute`. Não force esses dois no flag: seria uma mudança de comportamento visível ao usuário.

### 4.2 Componente (select menu / modal)

```js
// components/modals/registrar.js
module.exports = {
  prefix: 'modal_registrar_',   // ou `id: 'select_regras'` para match exato
  async execute(interaction) { /* corpo hoje nas linhas 574-667 */ },
};
```

Resolução no roteador: **match exato de `id` primeiro, depois `prefix` mais longo**. Isso é necessário porque os customIds atuais não são disjuntos por um simples `split('_')`: existem `modal_registrar_<discordId>` (dinâmico) e `modal_importar_partida` (estático) sob o mesmo primeiro token `modal`.

> **Não renomeie os customIds existentes.** Mensagens já publicadas no servidor (o painel de `/regras`, por exemplo) carregam os IDs antigos; trocá-los quebra silenciosamente qualquer mensagem antiga com a qual alguém ainda interaja. A convenção `namespace:acao:payload` fica valendo apenas para componentes **novos**.

### 4.3 Evento

```js
// events/clientReady.js
const { Events } = require('discord.js');
module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) { console.log(`Bot online como ${client.user.tag}`); },
};
```

Formato `{ name, once, execute }` carregado com `client.once` / `client.on` conforme o flag, exatamente como no guia [pesquisa §4]. Nome do arquivo = nome do evento em camelCase (`clientReady.js`, `interactionCreate.js`, `error.js`).

### 4.4 Components V2 vs `EmbedBuilder` — decisão

**Os dois estilos convivem. `EmbedBuilder` continua sendo o padrão dos 22 comandos existentes; Components V2 é o padrão para comandos novos e para reescritas já planejadas.**

Justificativa:

1. **Risco/benefício.** Converter os 22 embeds para containers muda a aparência de tudo que a comunidade já usa, sem ganho funcional, no meio de um refactor estrutural. Refactor de estrutura e redesign visual não devem viajar no mesmo PR — se algo quebrar visualmente, você não saberá qual dos dois causou.
2. **Restrição técnica real.** Uma mensagem com `MessageFlags.IsComponentsV2` **não pode** conter `content` nem `embeds`, e a flag precisa ser declarada já no `deferReply` — o próprio `commands/addstreamer.js` documenta isso num comentário (linhas 29–30). Ou seja, a escolha é por mensagem, não é mesclável. Não existe conversão parcial barata.
3. **Onde V2 rende de verdade:** respostas longas e formatadas (`/help`, `/regras`, `/anuncio`) e qualquer coisa com seções/thumbnails. Onde não rende: painéis com `addFields` numéricos densos (`/player`, `/elo`, `/ranking`, `/stats-mapa`), que é justamente o que os 22 comandos fazem.

**Regra a documentar no README:** comando novo → `ui/containers.js` (Components V2). Comando existente → mantém `EmbedBuilder`; migrar para V2 só como tarefa própria, um comando por PR, com print do antes/depois. `/regras` é o melhor primeiro candidato voluntário (é conteúdo textual longo), mas **fora do escopo deste plano**.

---

## 5. Camada de services

### 5.1 Granularidade escolhida: **por domínio de dados, não por tecnologia**

Rejeitado: um `googleSheetsService.js` único. Ele acabaria com ~30 funções (`buscarJogador`, `salvarStats`, `listarPartidas`, `upsertStreamer`, `aplicarBan`, …) sobre 4 abas diferentes, ou seja, exatamente o `index.js` de hoje com outro nome. O critério do padrão Repository é *uma coleção de objetos de domínio por módulo* [pesquisa §5], e as abas da planilha já são as coleções naturais.

| Service | Aba(s) | Chamadores | Justificativa |
|---|---|---|---|
| `sheetsClient.js` | — | os outros services | Infraestrutura: auth JWT + `doc` + `getSheet`. **Nenhum comando importa isto.** |
| `jogadoresService.js` | Jogadores | 14 comandos | A aba mais lida do projeto (9 pontos hoje). Concentra o conhecimento das colunas (`elo`, `Advertências`, `Punições`, `Banido_Até`, `Banido_Temporada`, `steamid64`, `link_faceit`, `link_gc`) |
| `partidasService.js` | Partidas, Stats_Partidas | 6 comandos | As duas abas são sempre lidas juntas (`/stats-mapa` linhas 1782–1783, `/hall-da-fama` 1413–1414). Separá-las criaria dois módulos que só se chamam mutuamente |
| `streamersService.js` | Streamers | 3 comandos | Já existe e já tem a forma certa — só muda de pasta |
| `registroService.js` | Jogadores (só a coluna `steamid64`) | roteador + `/presenca` + `/registrar` | Separado do `jogadoresService` porque tem responsabilidade distinta: cache, TTL, lock e invalidação. É lido em **toda** interação de comando |
| `firegamesService.js` | — (Pterodactyl HTTP) | `/importar-partida` | Já existe e já tem a forma certa — só muda de pasta |

### 5.2 O que **não** vira service (evitando camada anêmica)

- `/conectar`, `/server`, `/regras`, `/mudar-nick`, `/mover-times`, `/reunir`, `/clear` não têm I/O externo — nada a extrair. Um `voiceService.js` que só embrulhasse `member.voice.setChannel()` seria indireção pura.
- `/sortear` e `/pick` não tocam Sheets: a lógica deles vai para `domain/sorteio.js` e `domain/veto.js`, que são funções puras, **não** services.
- Nada de `commandService`/`interactionService`. A camada de orquestração é o próprio `execute`.

### 5.3 Regra de contrato

Um service **não recebe e não retorna `interaction`, `EmbedBuilder` nem `GoogleSpreadsheetRow`**. Ele recebe tipos primitivos/objetos simples e devolve objetos simples. Isso é o que impede o vazamento de `row.get('Advertências')` de volta para os comandos e o que torna `domain/` testável depois.

Exceção pragmática, a decidir na hora da extração: `verificarBloqueioJogador` hoje recebe uma `row` e **escreve nela** (linhas 139–140). Ver §10, risco R4.

---

## 6. Roteamento do `interactionCreate`

De 1827 linhas de `if` para ~60 linhas de roteador:

```js
// events/interactionCreate.js
const { Events, MessageFlags } = require('discord.js');
const registro = require('../services/registroService');
const { ehAdministrador, replyNoPermission } = require('../utils/permissions');
const log = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // 1) componentes: selects e modais
    if (interaction.isStringSelectMenu() || interaction.isModalSubmit() || interaction.isButton()) {
      const handler = resolverComponente(interaction.client.components, interaction.customId);
      if (!handler) return;                       // botões de collector (/pick) caem aqui e são ignorados
      try { await handler.execute(interaction); }
      catch (e) { log.error(`componente ${interaction.customId}`, e); await responderErro(interaction); }
      return;
    }

    // 2) autocomplete (ainda não usado por nenhum comando, já preparado)
    if (interaction.isAutocomplete()) { /* command.autocomplete?.(interaction) */ return; }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return log.warn(`Comando desconhecido: ${interaction.commandName}`);

    // 3) guardas declarativas (substituem as linhas 699-727 do index.js atual)
    if (command.apenasAdm && !(await ehAdministrador(interaction))) return replyNoPermission(interaction);
    if (command.exigeRegistro !== false && !(await registro.jogadorEstaRegistrado(interaction.user.id))) {
      return interaction.reply({ embeds: [embedTrava(interaction.user.id)], flags: MessageFlags.Ephemeral });
    }

    // 4) execução com try/catch central
    try {
      await command.execute(interaction);
    } catch (error) {
      log.error(`Erro no /${interaction.commandName}`, error);
      await responderErro(interaction);
    }
  },
};
```

`responderErro` implementa exatamente o padrão do guia — checar `interaction.replied || interaction.deferred` e escolher entre `followUp` e `reply` [pesquisa §7] — e é o mesmo helper de `utils/respond.js`.

**Ordem das guardas é comportamento observável**, não detalhe interno: hoje `apenasAdm` é checado *dentro* de cada comando, ou seja **depois** da trava de registro (linhas 708–727 vêm antes dos blocos). Se a checagem de ADM subir para o roteador antes da trava, um ADM não cadastrado passa a receber a mensagem de permissão em vez da de cadastro. Escolha aqui: **manter registro antes de ADM** para não mudar nada, ou seja, inverter as linhas 3 do trecho acima. (Recomendo manter idêntico ao atual: trava de registro primeiro.)

**Botões:** os customIds `veto_<mapa>` e `side_CT`/`side_TR` (linhas 2152, 2170, 2175) **não** vão para `components/buttons/`. Eles são coletados por um `createMessageComponentCollector` local ao `/pick` (linha 2220) que fecha sobre `mapPool`, `passos`, `passoAtual`, `bans`, `picks` — estado de sessão vivo dentro da closure. Movê-los para o roteador global exigiria um store de sessões de veto indexado por `messageId`. **Fora do escopo deste plano** (ver §11). O roteador simplesmente ignora botões sem handler registrado, e o collector continua funcionando como hoje.

**Loader de comandos** (compartilhado entre `index.js` e `deploy-commands.js`), conforme o guia [pesquisa §1]:

```js
// loaders/loadCommands.js
function carregarComandos() {
  const collection = new Collection();
  const base = path.join(__dirname, '..', 'commands');
  for (const categoria of fs.readdirSync(base)) {
    const dir = path.join(base, categoria);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const command = require(path.join(dir, file));
      if ('data' in command && 'execute' in command) collection.set(command.data.name, command);
      else console.warn(`[loader] ${categoria}/${file} ignorado: falta 'data' ou 'execute'`);
    }
  }
  return collection;
}
```

O `Collection` do discord.js é um `Map` com utilidades, usado no framework inteiro para lookup por ID [pesquisa §1].

---

## 7. `deploy-commands.js`

```js
// deploy-commands.js
require('./config/env');
const { REST, Routes } = require('discord.js');
const { carregarComandos } = require('./loaders/loadCommands');

const body = [...carregarComandos().values()].map((c) => c.data.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body })
  .then((data) => console.log(`${data.length} comandos registrados na guild ${process.env.GUILD_ID}.`))
  .catch(console.error);
```

Pontos de atenção específicos deste repo:

1. **Precisa de `CLIENT_ID` no `.env`.** Hoje o registro usa `client.user.id` (linha 515), que só existe porque há um `Client` logado. O script standalone usa só o `REST`, sem gateway — é justamente o ponto do guia [pesquisa §2]. Adicione `CLIENT_ID` ao `.env` e ao `.env.example`.
2. **Remover o wipe global do boot.** A linha 513 faz `rest.put(Routes.applicationCommands(client.user.id), { body: [] })` a cada restart. Isso apaga comandos globais toda vez e consome o rate limit diário de criação de application commands que o guia menciona [pesquisa §2]. Se ainda for necessário limpar globais uma vez, vire uma flag opcional (`node deploy-commands.js --limpar-global`), não um efeito de boot.
3. **`scripts` no `package.json`:**
   ```json
   "scripts": { "start": "node index.js", "deploy": "node deploy-commands.js" }
   ```
4. **Consequência operacional ótima para a migração:** como as *definições* (`data`) não mudam durante o refactor, só o corpo dos `execute`, você **não precisa rodar `npm run deploy` nenhuma vez** entre o PR2 e o final. Comandos não somem da UI do Discord em nenhum passo. É a garantia de segurança mais forte de todo este plano [pesquisa §2: *"you can modify parts such as the execute function as much as you like without redeployment"*].

---

## 8. Config, erro e logging

### 8.1 `config/env.js` (fail-fast)

```js
require('dotenv').config();

const OBRIGATORIAS = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID',
  'SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
const OPCIONAIS = ['CANAL_LIVES_ID', 'CANAL_LOGS_ID', 'CANAL_ANUNCIOS_ID',
  'PTERODACTYL_URL', 'PTERODACTYL_API_KEY'];

const faltando = OBRIGATORIAS.filter((k) => !process.env[k]);
if (faltando.length) {
  console.error(`[env] Variáveis obrigatórias ausentes: ${faltando.join(', ')}`);
  process.exit(1);
}
for (const k of OPCIONAIS) if (!process.env[k]) console.warn(`[env] ${k} não configurada — funcionalidade relacionada ficará indisponível.`);
```

Validar config no boot é prática geral de engenharia, não algo prescrito pelo discord.js — a pesquisa marca isso explicitamente [pesquisa §6].

**Detalhe de ordem que quebra tudo se ignorado:** `utils/sheets.js` lê `process.env` **no momento do `require`** (cria o `JWT` e o `GoogleSpreadsheet` no topo do módulo), e `utils/config.js` também. Hoje isso funciona porque `require('dotenv').config()` é a linha 1 do `index.js`. Com múltiplos entrypoints (`index.js` **e** `deploy-commands.js`), `require('./config/env')` tem que ser a **primeira linha de cada entrypoint**, antes de qualquer outro require do projeto.

**Bônus de config:** `utils/permissions.js` tem os IDs de Owner/Directors hardcoded (linhas 2–5) e `/conectar` tem IPs e **senhas de servidor** hardcoded (linhas 950–966). Movê-los para `config/cargos.js` e `config/servidores.js` (alimentados por `.env`) é barato e tira credenciais do código versionado. O `.env.example` também está incompleto: falta `CLIENT_ID`, `PTERODACTYL_URL` e `PTERODACTYL_API_KEY` (o README já documenta as duas últimas nas linhas 97–98, mas o exemplo não).

### 8.2 Erro

Três camadas, sem redundância:

1. **Roteador** (`events/interactionCreate.js`): `try/catch` em volta de `execute`, com o branch `replied`/`deferred` do guia [pesquisa §7]. Passa a ser o *único* lugar obrigatório de tratamento.
2. **Processo** (`index.js`): `process.on('unhandledRejection')` — já existe hoje na linha 162, mantém. Vale lembrar o que a pesquisa cita da doc do Node: é diagnóstico, **não** recuperação [pesquisa §7]. `uncaughtException` não deve ser adicionado para "manter o bot vivo"; se quiser resiliência, use supervisor de processo (pm2/systemd).
3. **Cliente**: `client.on('error')` (linhas 158–160) vira `events/error.js`.

Com o try/catch central em pé, os `try/catch` + fallback de resposta duplicados dentro de cada um dos 7 comandos modulares (`help.js` 96–110, `clear.js` 34–48, `addstreamer.js` 44–58, etc.) podem ser removidos **um a um, conforme cada comando for tocado** — não num sweep só. Onde o catch local produz uma mensagem específica e útil ao usuário (ex: `/clear` explicando o limite de 14 dias, `/mudar-nick` explicando hierarquia de cargos, linhas 2347–2349), **mantenha o catch local**: ele carrega informação que a mensagem genérica não tem.

### 8.3 Logging

`utils/logger.js` mínimo, sem dependência nova: `log.info/warn/error(escopo, ...args)` com timestamp ISO e prefixo. Substitui os ~25 `console.error('Erro ao ...')` espalhados, que hoje não têm timestamp nem identificação de comando — em produção, isso é a diferença entre "achei o erro" e "não faço ideia de quando isso aconteceu". Trocar `console.*` por `logger.*` é feito **junto com a migração de cada comando**, não num PR separado de find-replace.

---

## 9. Estratégia de migração incremental

**Princípios:**
- Cada PR é um commit revertível que deixa `main` executável. Rollback = `git revert` + restart.
- **Padrão strangler fig:** o `interactionCreate` novo tenta o `Collection` primeiro e, se não achar, cai no if-chain antigo preservado num arquivo `legacy/`. Os dois caminhos coexistem até o último PR.
- Migrar um comando = **mover o código, não reescrever**. Refatorar o corpo do comando é um PR separado, depois que ele já estiver no arquivo próprio.
- **Ambiente de teste:** o jeito mais seguro de validar cada passo é subir o bot com `GUILD_ID` apontando para um servidor de testes (o `.env` já é single-guild, então isso é literalmente trocar uma variável). Vale o esforço de criar esse servidor **antes do PR1**.

### PR 0 — Preparação (zero mudança de comportamento)
- `docs/plans/modularizacao-index-js.md` (este arquivo) + `docs/research/...` commitados.
- `package.json`: adiciona `"start"` e `"deploy"`.
- `.env.example`: adiciona `CLIENT_ID`, `PTERODACTYL_URL`, `PTERODACTYL_API_KEY`.
- **Teste:** `npm start` sobe o bot igual a hoje.

### PR 1 — `config/env.js` + `utils/logger.js`
- Cria os dois módulos. `index.js` passa a começar com `require('./config/env')` no lugar do `require('dotenv').config()`.
- **Teste:** subir com uma env obrigatória removida → o processo deve morrer com mensagem clara. Restaurar → sobe normal.
- **Rollback:** trivial (1 linha no `index.js`).

### PR 2 — `deploy-commands.js` (o de menor risco e maior ganho)
- Move o array `commands` (linhas 208–503) inteiro, **sem alterar nada**, para `commands/_definicoes.js` (arquivo temporário, com `_` no nome para o loader futuro ignorá-lo).
- Cria `deploy-commands.js` lendo dele + dos 7 modulares.
- **Remove** o bloco `client.once('clientReady')` de registro (505–523), deixando só o log de "bot online".
- **Teste:** `npm run deploy` → conferir "29 comandos registrados"; abrir o Discord e ver os 29 na lista; `npm start` e rodar 3 comandos de categorias diferentes.
- **Rollback:** restaurar o bloco `clientReady`. Os comandos já estão registrados na guild, então nada some.

### PR 3 — Loaders + `events/` + seam do strangler
- `loaders/loadCommands.js` e `loaders/loadEvents.js`.
- `events/clientReady.js`, `events/error.js`, `events/interactionCreate.js`.
- O corpo atual do `interactionCreate` (linhas 526–2352) é **recortado e colado sem edição** em `legacy/interactionRouter.js`, exportando uma função `(interaction) => {...}`. O novo `events/interactionCreate.js` faz: componentes → comandos do `Collection` → **fallback** `legacy(interaction)`.
- Os 7 comandos modulares migram de pasta (`commands/geral/`, `commands/streamers/`, `commands/moderacao/clear.js`) e **saem** do mapa `commandModules`; passam a vir do loader. **Corrigir `../utils/` → `../../utils/`** nos 7 arquivos.
- **Teste (o mais importante do plano):** rodar **os 29 comandos** manualmente. Especialmente: `/help` com e sem cargo de ADM (para provar que `exigeRegistro: false` reproduziu o bypass antigo das linhas 699–706) e um comando qualquer com uma conta **não cadastrada** (para provar que a trava de registro continua ativa).
- **Rollback:** reverter o PR restaura o handler inline.

### PR 4 — `services/` + `domain/` (ainda sem mover comandos)
- `utils/sheets.js` → `services/sheetsClient.js`; `utils/streamers.js` → `services/streamersService.js`; `firegamesService.js` (raiz) → `services/firegamesService.js`. Atualizar os imports (poucos e localizados).
- Extrair `registroCache` + `jogadorEstaRegistrado` + `invalidarRegistroCache` (linhas 62–114) para `services/registroService.js`; extrair `verificarBloqueioJogador` (116–145) para `services/jogadoresService.js`.
- Criar `domain/elo.js`, `domain/advertencias.js`, `domain/sorteio.js`, `domain/veto.js`, `domain/mapas.js` com as funções puras copiadas do `legacy/`.
- O `legacy/interactionRouter.js` passa a **chamar** esses módulos em vez das cópias locais.
- **Teste:** `/registrar` (cadastrar de verdade e confirmar que o comando seguinte já reconhece — valida a invalidação de cache), `/presenca confirmar` com jogador banido, `/resultado`, `/advertir` até estourar 3 pontos, `/importar-partida`.
- **Rollback:** reverter. Este é o PR com maior superfície de erro depois do PR3 — não junte com nenhum outro.

### PR 5 — Lote A: comandos sem I/O e sem estado (6)
`conectar`, `server`, `regras` (+ `components/selects/regras.js`), `mudar-nick`, `mover-times`, `reunir`.
- Cada comando movido é **deletado** do `legacy/` no mesmo commit.
- **Teste:** os 6, incluindo os 3 itens do dropdown de `/regras`.

### PR 6 — Lote B: leitura de planilha (7)
`player`, `elo`, `ranking`, `hall-da-fama`, `x1`, `stats-mapa`, `partida-info`.
- Só leem. Um erro aqui produz resposta feia, nunca dado corrompido.
- **Teste:** cada um com jogador existente, jogador inexistente e sem argumento.

### PR 7 — Lote C: escrita de planilha (6)
`registrar` (+ `components/modals/registrar.js`), `importar-partida` (+ `components/modals/importarPartida.js`), `resultado`, `advertir`, `ausente`, `desadvertir`.
- **Faça uma cópia da planilha antes.** É o único PR que pode causar dano não reversível por restart.
- **Teste:** conferir linha por linha na planilha após cada comando; testar `/advertir` cruzando o limiar de punição (1ª punição = ban semanal, 2ª = ban de temporada) e `/desadvertir` liberando.

### PR 8 — Lote D: estado compartilhado (3) — o mais delicado, por último
`presenca`, `sortear`, `pick` + `state/presencaStore.js` + `ui/presencaEmbed.js`.
- **Teste (sequência completa, sem restart no meio):** `/presenca criar vagas:3` → 3× `/presenca confirmar` (contas diferentes) → conferir o painel fixo se atualizando e o aviso de "LISTA CHEIA" → `/sortear origem:presenca` → `/presenca cancelar` → `/presenca lista` → `/presenca finalizar`. Depois, um veto `/pick modo:MD3` completo com dois capitães, até o decider.
- **Rollback:** reverter derruba a lista de presença em memória (como qualquer restart já faz hoje). Faça este deploy fora do horário de Mix.

### PR 9 — Limpeza
- Deletar `legacy/` e `commands/_definicoes.js`.
- `index.js` final: ~50 linhas.
- Atualizar a seção "Estrutura do projeto" do `README.md` (linhas 22–46), que hoje descreve a árvore antiga.
- Documentar no README a regra do §4.4 (V2 vs embeds) e a convenção do §12.

**Resumo da ordem de risco:** infraestrutura (0–2) → seam (3) → dados (4) → sem estado (5) → leitura (6) → escrita (7) → estado compartilhado (8) → limpeza (9).

---

## 10. Riscos e cuidados específicos deste código

**R1 — `presencaConfig` é *reatribuído*, não mutado (linha 1175).** `/presenca criar` faz `presencaConfig = { ... }`. Se o novo módulo exportar o objeto (`module.exports = presencaConfig`), todo consumidor que já tenha importado fica com a referência antiga e a lista vira fantasma: `/presenca confirmar` grava num objeto, `/sortear` lê de outro. **Mitigação:** `state/presencaStore.js` exporta só funções (§2.2). É o erro mais provável de todo o refactor.

**R2 — A ordem "7 comandos modulares → trava de registro" é comportamento, não acaso.** Linhas 699–706 despacham os 7 comandos e retornam **antes** da trava das linhas 708–727. Se o roteador unificado aplicar a trava a todos, `/help`, `/config`, `/clear`, `/lives`, `/anuncio`, `/addstreamer` e `/removerstreamer` passam a exigir `/registrar` — regressão imediata e visível para ADMs que nunca se cadastraram. **Mitigação:** `exigeRegistro: false` explícito nos 7 (§4.1), verificado no teste do PR3.

**R3 — `/conectar` e `/server` são o mesmo bloco com dois nomes (linha 943).** O `Collection` do loader é chaveado por `command.data.name`, então um arquivo só não pode servir os dois. **Mitigação:** dois arquivos em `commands/servidor/`, ambos importando o mesmo `montarEmbedServidores()` local, cada um com seu `SlashCommandBuilder`. Não tente inventar um campo `aliases` no loader — é divergir do padrão oficial para economizar 8 linhas.

**R4 — `verificarBloqueioJogador` é um "read" que escreve (linhas 139–140).** Quando encontra um ban temporário expirado, ele limpa `Banido_Até` e faz `await rowJogador.save()`. Ao virar `jogadoresService.verificarBloqueio()`, é tentador transformá-lo numa consulta pura — isso faria bans expirados **nunca serem limpos** da planilha e o jogador seria reavaliado toda vez. **Mitigação:** manter o efeito colateral e documentá-lo no JSDoc do service, ou separar explicitamente em `verificarBloqueio()` + `liberarBanExpirado()` chamados em sequência.

**R5 — A checagem de bloqueio no `/presenca confirmar` falha *aberto* (linhas 1225–1227).** O `catch` só loga e o fluxo continua, ou seja: se o Sheets estiver fora do ar, um jogador banido **entra** na lista. Isso pode ser intencional (preferir disponibilidade a rigor) ou um descuido. **Mitigação:** decidir conscientemente ao mover — não deixe o comportamento mudar por acidente ao reorganizar o `try`.

**R6 — O lock do `registroCache` propaga falha para todos os concorrentes (linhas 100–106).** Se `carregarRegistroCache()` rejeitar, todas as interações que estavam aguardando `registroCache.carregando` recebem a rejeição, caem no `catch` da linha 110 e retornam `false` — ou seja, **jogadores cadastrados veem "Acesso Negado! ... você precisa vincular o seu SteamID64"** por uma falha transitória de rede. Sob rajada (o cenário exato que o cache existe para resolver), uma falha atinge todo mundo de uma vez. **Mitigação:** ao extrair para `registroService.js`, decidir a política de falha (retry único? fail-open com aviso?) — mas **em commit separado**, para que a mudança de comportamento seja atribuível.

**R7 — Ausência de `return` em blocos finais.** `/conectar`+`/server` (974), `/regras` (1015), `/sortear` (1727) e `/pick` (2316) terminam sem `return`. Hoje é inofensivo porque nenhuma condição posterior casa, mas se durante a migração alguém reordenar os blocos do `legacy/` (ex: para agrupar os já migrados), um comando pode passar a executar dois handlers. **Mitigação:** nunca reordenar o `legacy/interactionRouter.js` — só **remover** blocos, de cima para baixo ou de baixo para cima, nunca mover.

**R8 — `/reunir` está quebrado hoje (linha 1586).** `for (const [mId, member] of channel.members.values())` desestrutura cada `GuildMember` como se fosse um array; `GuildMember` não é iterável, então isso lança `TypeError` na primeira iteração, cai no `catch` da linha 1594 e o comando **sempre** responde "❌ Erro ao reunir jogadores". O correto é `for (const member of channel.members.values())` (ou `for (const [id, member] of channel.members)`). **Mitigação:** corrigir, mas em **commit próprio** dentro do PR 5 — se vier junto com a movimentação do arquivo, você perde a rastreabilidade de "quando o /reunir voltou a funcionar".

**R9 — `getSheet()` faz `doc.loadInfo()` a cada chamada (`utils/sheets.js` linha 14).** `/resultado` e `/stats-mapa` chamam duas vezes cada, `/hall-da-fama` idem. São round-trips extras à API do Google em comandos que já estão perto do limite de ACK do Discord, e consomem quota. A extração para `services/sheetsClient.js` é o momento natural de memoizar o `loadInfo` (com TTL), mas isso **muda o comportamento em caso de alteração de estrutura da planilha em tempo de execução** — trate como otimização deliberada, em commit próprio, não como efeito colateral da mudança de pasta.

**R10 — APIs deprecadas espalhadas.** `ephemeral: true` (25+ ocorrências) deveria ser `flags: MessageFlags.Ephemeral`, e `fetchReply: true` (linhas 1185 e 2217) foi substituído por `withResponse`. **Não faça find-replace.** As duas ocorrências de `fetchReply` têm o valor de retorno usado logo em seguida (`mensagem.id` na linha 1188 e `replyMessage.createMessageComponentCollector` na 2220) e `withResponse` retorna um **shape diferente**. Trocar às cegas quebra o painel de presença e o veto inteiro. Faça comando a comando, com teste.

**R11 — Mudança de pasta quebra caminhos relativos.** Os 7 comandos atuais usam `require('../utils/containers')`. Ao irem para `commands/geral/` etc., viram `../../ui/containers`. É óbvio, é garantido de acontecer, e o erro só aparece em runtime (CommonJS não valida no boot se o require estiver dentro de um módulo carregado sob demanda — mas o loader carrega tudo no start, então o bot **não sobe**: falha barulhenta, que é o melhor caso). Rodar `npm start` após cada movimentação é suficiente para pegar.

**R12 — Estado morre no restart.** `presencaConfig` e o `mensagemId` do painel não sobrevivem a um deploy. O código já sabe disso (mensagem da linha 1272 menciona explicitamente "ou o bot reiniciou desde o `/presenca criar`"). A modularização **não resolve** isso — só torna a solução possível depois (basta trocar a implementação de `presencaStore` por uma persistente). Enquanto isso: **todo deploy deve ser feito fora do horário de Mix**, e isso vale especialmente para o PR8.

**R13 — Segredos e IDs no código versionado.** `CARGOS_ADM_IDS` (`utils/permissions.js` 2–5), IPs e **senhas** dos 4 servidores CS2 (`index.js` 950–966) e IDs de servidores Pterodactyl no placeholder do modal (linha 805) estão hardcoded. Não é bloqueante para o refactor, mas mover para `.env` durante o PR1/PR5 é barato.

---

## 11. Fora de escopo

| Item | Por quê |
|---|---|
| **Sharding** | O bot é single-guild (`Routes.applicationGuildCommands` com um `GUILD_ID`). O limiar obrigatório do Discord é 2.500 guilds [pesquisa §9] — não há nada a fazer aqui, hoje nem em qualquer futuro plausível deste projeto |
| **Testes automatizados** | Nem o discordjs.guide nem a doc do Discord documentam qualquer abordagem de teste — a pesquisa é explícita quanto a isso [pesquisa §8]. Trabalho futuro **não bloqueante**: depois do PR4, `domain/elo.js`, `domain/advertencias.js` e `domain/sorteio.js` são funções puras e testáveis com qualquer runner (inclusive `node:test`, sem dependência nova). Esse é o ponto de entrada natural, não os comandos |
| **Persistência do estado de presença** (SQLite/Redis/aba na planilha) | Resolve o R12, mas é mudança de produto, não de estrutura. Fica **muito** mais fácil depois que `state/presencaStore.js` existir — é literalmente trocar a implementação por trás da mesma interface |
| **Roteador global de botões (sessões de `/pick`)** | Exigiria um store de sessões de veto por `messageId`. O collector atual funciona; migrar sem necessidade é risco puro |
| **Reescrita dos 22 embeds para Components V2** | Ver §4.4 — mudança visual, não estrutural |
| **TypeScript / ESM** | `package.json` é `"type": "commonjs"` e o guia oficial usa CommonJS nos exemplos citados. Migrar linguagem/módulo junto com reestruturação de pastas dobra a superfície de erro |
| **Otimização de quota do Sheets** (batching, cache de rows) | Vale a pena (ver R9), mas depois que os services existirem — é exatamente para isso que a camada serve |

---

## 12. Convenção de nomenclatura

Alinhada ao que os exemplos oficiais mostram literalmente [pesquisa §10]:

| Elemento | Regra | Exemplos deste repo |
|---|---|---|
| Pastas de topo | minúsculas, substantivo, sem prefixo | `commands/`, `events/`, `services/`, `domain/`, `state/`, `ui/`, `config/`, `loaders/`, `components/` |
| Categoria de comando | minúsculas, substantivo em pt-BR (o projeto já é pt-BR) | `mix/`, `stats/`, `partidas/`, `moderacao/`, `voz/`, `jogadores/`, `streamers/`, `servidor/`, `geral/` — **sem acento** nos nomes de pasta |
| Arquivo de comando | **idêntico ao `setName()` do comando**, `.js` | `hall-da-fama.js`, `stats-mapa.js`, `importar-partida.js`, `mover-times.js`, `mudar-nick.js`, `partida-info.js` |
| Exports de comando | literalmente `data`, `execute`, `autocomplete` — o loader checa por nome | — |
| Arquivo de evento | camelCase igual ao membro do enum `Events` | `clientReady.js`, `interactionCreate.js`, `error.js` |
| Exports de evento | `name`, `once`, `execute` | — |
| Service | `<dominio>Service.js`, camelCase (segue o `firegamesService.js` que já existe) | `jogadoresService.js`, `partidasService.js`, `streamersService.js`, `registroService.js`; exceção: `sheetsClient.js` (é cliente, não domínio) |
| Domain / utils / config | substantivo minúsculo | `elo.js`, `advertencias.js`, `sorteio.js`, `veto.js`, `mapas.js`, `logger.js`, `respond.js`, `env.js` |
| Componente | camelCase descrevendo a ação, dentro de `modals/` ou `selects/` | `modals/registrar.js`, `modals/importarPartida.js`, `selects/regras.js` |
| Arquivo temporário/ignorado pelo loader | prefixo `_` | `commands/_definicoes.js` (some no PR9) |
| Entrypoints | `index.js` e `deploy-commands.js` na raiz | — |
| Identificadores no código | pt-BR, como já é hoje (`jogadorEstaRegistrado`, `presencaConfig`, `construirEmbedPresenca`) | não introduza inglês no meio — consistência vale mais que preferência |
| customId de componente **novo** | `namespace:acao:payload` (`:` como separador) | os antigos (`modal_registrar_`, `select_regras`, `veto_`, `side_`) **não mudam** — ver §4.2 |
