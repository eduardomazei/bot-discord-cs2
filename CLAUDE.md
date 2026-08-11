# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
node index.js         # run the bot (also: npm start)
npm run deploy         # register/update slash commands with Discord (node deploy-commands.js)
```

There is no lint script and no test suite (`npm test` is an unconfigured stub — don't assume tests exist or try to run them).

After changing any `commands/<categoria>/*.js` file's `data` (name, description, options, `setDefaultMemberPermissions`), you must run `npm run deploy` for Discord to pick up the change — restarting the bot process alone is **not** enough for command *definitions*, only for command *behavior*. Conversely, `npm run deploy` does not restart the running bot process; after editing any handler logic, kill and restart `node index.js` separately. Both steps are commonly needed together.

`deploy-commands.js` is standalone (uses only the REST manager, no gateway connection) and registers commands to a single guild (`GUILD_ID` in `.env`) — not global commands.

## Architecture

### Commands are modular; `legacy/` only handles select menus and modals

The strangler-fig migration described in `docs/plans/modularizacao-index-js.md` is complete — every one of the original ~29 commands lives in `commands/<categoria>/*.js` as `{ data, execute }` (plus optional `exigeRegistro`/`apenasAdm` metadata), loaded dynamically by `loaders/loadCommands.js` (shared by both `index.js` and `deploy-commands.js`, so the running bot and the registered command set never diverge). `commands/_definicoes.js` (the temporary flat array the plan describes) no longer exists.

`events/interactionCreate.js` looks up `client.commands` by name and runs guard checks (`command.apenasAdm`, `command.exigeRegistro`) before calling `command.execute(interaction)`. It only falls through to `legacy/interactionRouter.js` (`legacy.execute(interaction)`) for interactions that *aren't* a recognized chat-input command — in practice today that's just the `/regras` select menu (`select_regras`) and the two modal submissions (`/registrar`'s `modal_registrar_<id>`, `/importar-partida`'s `modal_importar_partida`, including its Confirm/Cancel button collector). There's no component loader yet for select menus/modals (unlike `loaders/loadCommands.js` for commands), so those three handlers stay in `legacy/interactionRouter.js` — do not add new command logic there, and do not delete the file, it's still load-bearing for those three flows.

When adding a **new** command, put it in `commands/<categoria>/` following the modular pattern (see any file in `commands/geral/`, `commands/stats/`, or `commands/mix/` for the `{ data, execute }` shape). Small pieces of logic shared by more than one command have their own module rather than being duplicated or left as legacy closures — see `services/registroService.js` (the registration cache/gate), `state/presencaStore.js` (the presence-list state, read by `/presenca` and `/sortear`), `utils/elenco.js` (roster-cell parsing, used by `/partida-info`), `utils/servidores.js` (server-id → label), and `utils/advertencias.js` (punishment constants + the shared write path used by `/advertir` and `/ausente`).

### Two incompatible rendering systems

Both systems are used across `commands/<categoria>/*.js` — which one a given command uses is a per-command choice made when it was written/migrated, not tied to its file location:

- **Components V2** (`utils/containers.js`: `buildContainer()` + `componentsV2Payload()`) — the simple-display commands (`/elo`, `/player`, `/ranking`, `/hall-da-fama`, `/stats-mapa`, `/partida-info`, `/x1`, `/regras`, `/server`, plus the originally-modular `/help`, `/anuncio`, `/config`, `/lives`, `/addstreamer`, `/removerstreamer`, `/clear`). One title + one flowing body of markdown text + optional thumbnail/banner image/footer/buttons — there is no `addFields()` grid equivalent; multi-item content is composed as a single markdown string.
- **Classic `EmbedBuilder`** — the more complex commands (`/presenca`, `/pick`, `/registrar`, `/advertir`, `/ausente`, `/desadvertir`, `/mover-times`, `/reunir`, `/mudar-nick`, `/sortear`, `/importar-partida`, `/resultado` calculations), especially ones with stateful button/collector flows or `addFields()`-heavy layouts. (`/resultado` itself was removed — see the `Partidas` sheet section below — but the command file it briefly had, and the pattern, are gone; `/importar-partida` is the only supported way to record a match result now.)

**A single Discord message cannot mix the two** — a message flagged `IsComponentsV2` cannot also carry a plain `embeds` array, and the flag can't be removed on a later edit. This means: if a command calls `interaction.deferReply()` before eventually sending a `buildContainer()` result, the `deferReply()` call itself must already pass `{ flags: MessageFlags.IsComponentsV2 }` (see e.g. `commands/stats/elo.js` for the pattern) — you cannot add the flag later via `editReply()`. Do not migrate a command to Components V2 halfway; every reply/editReply/followUp in that command's whole interaction flow must switch together.

### Color palette

`utils/colors.js` exports `CORES` — six semantic constants (`SUCESSO`, `ERRO`, `AVISO`, `INFO`, `NEUTRO`, `ENCERRADO`) that both rendering systems draw from (`.setColor(CORES.X)` for embeds, `cor: CORES.X` for `buildContainer`). Use these instead of introducing new hex literals for status-type colors. A few colors are deliberately *not* in this palette because they're feature identity, not status — Twitch purple (`0x9146ff`, streamer/lives embeds) and the dynamic Time A/Time B winner color in `/partida-info` — leave those as-is.

### Google Sheets is the database

`utils/sheets.js` exports `getSheet(title)` / `doc` (a `GoogleSpreadsheet` instance, `google-spreadsheet` + `google-auth-library`, JWT service-account auth). There is no caching or batching at this layer — every `getSheet()`/`getRows()` call is a fresh network round-trip. The sheet tabs the bot depends on: `Jogadores` (player registry — `discord_id`, `steamid64`, Elo/stats, ban flags), `Partidas` (one row per imported match — see below), `Stats_Partidas` (one row per player per match), `Streamers` (`discord_id`, `Canal Twitch`, `Ativo` — must be created manually with that exact header before `/lives`/`/addstreamer`/`/removerstreamer` work).

`services/registroService.js` maintains a 30-second in-memory cache (`registroCache`, module-level singleton) of `Jogadores` data specifically for the "is this person registered" gate that `events/interactionCreate.js` runs before almost every command (`command.exigeRegistro !== false`) — this exists because a burst of concurrent interactions (e.g. many people confirming `/presenca` at once) can otherwise blow past Discord's 3-second interaction-acknowledgment window. Call `invalidarRegistroCache()` after any write to `Jogadores` outside that cache's own write paths, or the change won't be visible for up to 30s.

### `Partidas` sheet: elenco format and live resolution

`team_a_ids`/`team_b_ids` cells store `steamid64:nomeCS2` pairs (comma-separated) per participant — not Discord mentions. Resolution to a `<@discordId>` mention (if the player is registered) or plain CS2 name (if not) happens **at read time** (`/partida-info`, `/x1`), not at import time — see `docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md`. This means a player who registers *after* playing in a match will retroactively show up correctly the next time that old match is queried, with zero migration needed. Cells written before this scheme (`<@id>` format) are still detected and handled — see `interpretarCelulaElenco()`/`resolverElencoParaExibicao()` in `utils/elenco.js`.

`matchid` is **not** unique on its own — each of the 3-4 Pterodactyl-hosted CS2 servers has its own independent MatchZy numbering, so the same `matchid` can legitimately exist once per server. Always pair `matchid` with `server_id` when looking up a specific match (see `verificarPartidaJaImportada()` in `firegamesService.js` and the servidor dropdown option on `/partida-info`).

`/importar-partida` calculates everything (roster, winner, MVP, Elo deltas) in memory first (`calcularPartida()`), shows the admin a preview with Confirm/Cancel buttons, and only writes to the three sheets (`gravarPartida()`) after explicit confirmation — see `docs/adr/0002-importar-partida-preview-antes-de-gravar.md`. Never make this write unconditionally again; a wrong Score A/B input silently corrupts registered players' career Elo/stats otherwise, and that damage doesn't undo when the bad row is deleted.

### `/presenca`: Confirmados vs Reserva

Once the official roster (`jogadores`) is full, further `/presenca confirmar` calls go to a separate waitlist array (`reservas`), not a hard rejection — unless `vagasReserva` is `0` (opt-out) or the waitlist itself is full. The list never auto-closes anymore (it used to flip `aberta = false` on filling up); only `/presenca finalizar` closes it, both roster and waitlist together — see `docs/adr/0003-lista-de-presenca-nunca-fecha-sozinha.md`. Canceling a confirmed spot auto-promotes the earliest waitlisted player (re-checking their ban/punishment status before promoting); `/presenca promover` lets an admin promote out of order, optionally swapping out a specific confirmed player. `/sortear origem:presenca` only ever reads `jogadores`, never `reservas` — that's intentional (waitlisted players haven't secured a spot).

`state/presencaStore.js` is the single owner of this in-memory state (`presencaConfig`), shared between `commands/mix/presenca.js` and `commands/mix/sortear.js` — read it via `presencaStore.obter()` (returns the live object; mutate its arrays/fields directly, that's visible to every other caller) and only ever *replace* it wholesale via `presencaStore.definir(novoObjeto)` (only `/presenca criar` does this today). Never hold onto an `obter()` result across an `await` boundary if another handler could call `definir()` in between — re-call `obter()` after any await if you need the freshest reference. It persists to `data/presenca.json` via `state/presencaPersistence.js` (gitignored — runtime data, not source), which `presenca.js` calls directly (`presencaPersistence.salvar(presencaConfig)`) after every mutation.

### Admin command visibility

Commands restricted to Owner/Directors/Founders/🕸️Trupe (`utils/permissions.js`: `CARGOS_ADM_IDS`, checked by `ehAdministrador()`) additionally call `.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)` on their `SlashCommandBuilder`, which hides them from Discord's command picker for anyone lacking the guild's native "Administrator" permission — all four of those roles already carry it. This is Discord-permission-bit-based, not role-ID-based, so it's an approximation of `CARGOS_ADM_IDS`, not a mirror of it; keep the two in sync if the admin role set changes. See `docs/adr/0004-comandos-admin-escondidos-via-permissao-administrador.md`. `/presenca` is deliberately excluded from this even though it has admin-only subcommands (`criar`/`finalizar`/`promover`) — Discord can't hide individual subcommands, only whole commands, and most of `/presenca`'s subcommands are open to everyone.

### Domain glossary and decisions

`CONTEXT.md` at the repo root is the canonical glossary for domain terms (Partida, Time A/Time B, Jogador Registrado, Reserva, Cargo Admin, etc.) — check it before introducing new terminology. `docs/adr/` holds numbered ADRs for non-obvious, hard-to-reverse decisions; read the relevant one before changing behavior it documents.
