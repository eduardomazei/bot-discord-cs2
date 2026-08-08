# Discord.js v14 Bot Architecture — Best Practices Research

**Scope.** This document researches architectural patterns for a growing discord.js v14 (Node.js, CommonJS) bot with an increasing number of slash commands and external integrations (Google Sheets, third-party REST APIs), to inform a follow-up planning/implementation step for this repository (`bot-mix-cs2`).

**Methodology.** Every claim below was verified by fetching the actual page content of a primary source — the official [discordjs.guide](https://discordjs.guide), [discord.js.org](https://discord.js.org) API reference, [Discord Developer Docs](https://docs.discord.com/developers), and [Node.js official docs](https://nodejs.org/api/) — rather than recalled from memory or taken from blog posts/tutorials. Web search was used only to *locate* the correct primary-source URL, never as a citation itself. The one deliberate exception is a short, explicitly-labelled "light scan" of two real-world open-source discord.js v14 bot repositories on GitHub, done only to sanity-check folder-naming conventions against practice, not as a source of normative claims. Where a claim is general software-engineering practice rather than something discord.js/Discord itself prescribes, it is labelled **[general SWE practice]** and cited to a widely-regarded architecture reference (Martin Fowler) instead of to discord.js docs.

Note: the current discordjs.guide site serves its full prose guide (folder structures, command/event handling, deployment, error handling) under `/legacy/...` paths (the "legacy" label refers to the pre-rewrite JS-only guide content, which is still the canonical, actively-served documentation for these topics at the time of writing, 2026-08-07); shorter reference-style pages (e.g. autocomplete, collections) live at the un-prefixed paths. Both are cited below exactly as fetched.

---

## 1. Recommended folder structure (commands/events + dynamic Collection-based loader)

The official guide's command-handling walkthrough has bot code load commands from a `commands/` directory that is itself split into **category subfolders**, e.g.:

```
commands/
└── utility/
    ├── ping.js
    ├── server.js
    └── user.js
```
— exactly as shown in [discordjs.guide "Command handling"](https://discordjs.guide/legacy/app-creation/handling-commands).

The loader walks that structure with Node's built-in `fs`/`path` modules — first `fs.readdirSync` over the category folders, then `fs.readdirSync` again inside each folder filtered to `.js` files — and `require()`s each file:

```javascript
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    }
}
```
(source and quote: [discordjs.guide "Command handling"](https://discordjs.guide/legacy/app-creation/handling-commands))

Loaded commands are stored in a `Collection` attached to the client instance, `client.commands = new Collection()`, keyed by command name for O(1) lookup at execution time — same source. `Collection` itself is documented by discord.js as "*a Map with additional utility methods. This is used throughout discord.js rather than Arrays for anything that has an ID, for significantly improved performance and ease-of-use*" ([discord.js.org — Collection class](https://discord.js.org/docs/packages/collection/main/Collection:class)).

The parallel **event** loader (see §4) uses the identical `fs.readdirSync`-over-a-folder pattern against an `events/` directory sitting alongside `commands/` ([discordjs.guide "Event handling"](https://discordjs.guide/legacy/app-creation/handling-events)) — so the guide's own worked example nets out to a `commands/<category>/<name>.js` + `events/<name>.js` project shape, both populated automatically at startup rather than requiring manual `require()` lists.

The guide does not itself prescribe `services/`, `models/`, or `repositories/` folders — that layer is general software-architecture practice, discussed in §5.

---

## 2. Separating command deployment from the running client

discordjs.guide has slash-command **registration** live in a dedicated, standalone script — conventionally `deploy-commands.js` — that is run manually/out-of-band, not executed as part of the bot's normal `client.login()` process. The guide is explicit about why:

> "it's not necessary nor desirable to connect a whole client to the gateway or do this on every ready event"
([discordjs.guide "Registering Commands"](https://discordjs.guide/legacy/app-creation/deploying-commands))

The script uses the lightweight `REST` manager (not the full `Client`) plus `Routes` to PUT the full command set:

```javascript
// guild-scoped (instant, good for development)
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

// global (propagates over up to an hour, for production)
await rest.put(Routes.applicationCommands(clientId), { body: commands });
```
(source and quotes: [discordjs.guide "Registering Commands"](https://discordjs.guide/legacy/app-creation/deploying-commands))

The guide frames this as a deliberate split between the command **definition** (name/description/options — deployed rarely, deliberately) and the command **logic** (the `execute` function body — changed freely, requires no redeployment, just a process restart): *"Slash commands only need to be registered once, and updated when the definition (description, options etc) is changed"*, and developers can "modify parts such as the execute function as much as you like without redeployment" (same source). This separation also respects Discord's daily application-command creation rate limits, per the same page.

`Routes.applicationGuildCommands` / `Routes.applicationCommands` are part of the REST route-builder shipped with discord.js (`discord-api-types`), reflected in the API reference tree under [discord.js.org/docs](https://discord.js.org/docs) and the community-maintained [discord-api-types RoutesDeclarations](https://discord-api-types.dev/api/discord-api-types-v10) interface, consistent with the guide's usage.

---

## 3. The official "command module" pattern (`data` + `execute`, subcommands, autocomplete)

Every command file exports a plain object with two required properties — `data`, a `SlashCommandBuilder` instance describing the command for registration, and `execute`, an async function that runs when the command is invoked:

```javascript
module.exports = {
    data: new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
    async execute(interaction) {
        await interaction.reply('Pong!');
    },
};
```
(source and quote: [discordjs.guide "Command handling"](https://discordjs.guide/legacy/app-creation/handling-commands); `SlashCommandBuilder` requirements — name/description mandatory, name constrained to 1–32 chars, lowercase, no spaces except `-`/`_` — per [discordjs.guide "Creating commands"](https://discordjs.guide/legacy/app-creation/creating-commands))

The command handler's `interactionCreate` listener then looks the command up in `client.commands` by `interaction.commandName` and calls `command.execute(interaction)` inside a `try/catch` (see §7 for the exact error-handling code).

**Subcommands** are added to the builder with `.addSubcommand()` — e.g. an `info` command branching into `user`/`server` subcommands — and the guide states this "*allows you to branch a single command to require different options depending on the subcommand chosen*" ([discordjs.guide "Advanced Command Creation"](https://discordjs.guide/legacy/slash-commands/advanced-creation)). At runtime, the single `execute()` function branches on `interaction.options.getSubcommand()`:

```javascript
if (interaction.options.getSubcommand() === 'user') {
    const user = interaction.options.getUser('target');
    // ...
} else if (interaction.options.getSubcommand() === 'server') {
    // ...
}
```
(source: [discordjs.guide "Parsing options"](https://discordjs.guide/legacy/slash-commands/parsing-options)) — i.e. subcommands stay inside one file/one `execute`, not split across files.

**Autocomplete** is opt-in per option via `SlashCommandStringOption#setAutocomplete(true)` on the builder, and handled by adding a **third** export, `autocomplete(interaction)`, alongside `data`/`execute`; the interactionCreate router dispatches to it after checking `interaction.isAutocomplete()`:

```javascript
async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const filtered = choices.filter((choice) => choice.startsWith(focusedValue));
    await interaction.respond(filtered.map((choice) => ({ name: choice, value: choice })));
}
```
The guide notes *"by adding a separate `autocomplete` function to the `module.exports` of commands that require autocompletion, you can safely separate the logic"* and that `respond()` accepts up to 25 choice objects ([discordjs.guide "Autocomplete"](https://discordjs.guide/slash-commands/autocomplete)).

---

## 4. Separate event listener files (`once`/`on`, dynamic loading)

The guide moves event-handling code out of the main file into individual files under an `events/` folder, one file per Discord event, mirroring the command loader:

```
discord-bot/
├── events/
│   ├── ready.js
│   └── interactionCreate.js
```
Each file exports `name` (the event, typically from the `Events` enum), `once` (boolean — run a single time vs. every emission), and `execute` (the handler body) — e.g. for `ready`: `name: Events.ClientReady, once: true, execute(client) { ... }` ([discordjs.guide "Event Handling"](https://discordjs.guide/legacy/app-creation/handling-events)).

The loader enumerates the folder the same way the command loader does (`fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'))`) and registers each file conditionally on its `once` flag:

```javascript
if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
} else {
    client.on(event.name, (...args) => event.execute(...args));
}
```
(source and quotes: [discordjs.guide "Event Handling"](https://discordjs.guide/legacy/app-creation/handling-events)) — the rest/spread `...args` is used because different Discord events pass different argument shapes (e.g. `messageUpdate` passes `oldMessage, newMessage`), and the guide calls out that argument order/positioning matters for such multi-argument events (same source).

---

## 5. A services/repository layer for external integrations (Google Sheets, REST APIs)

**This point is *not* discord.js-specific.** discordjs.guide's worked examples stop at commands/events/deployment; it does not itself define or name a "services" or "repository" layer, and no discordjs.guide page fetched during this research prescribes one. Everything in this section is general software-engineering practice, cited to established architecture references rather than to discord.js docs, as instructed.

- **[general SWE practice]** Separating an application into presentation, domain/business-logic, and data-access layers so that, e.g., a change to *how* data is fetched (a different Sheets client, a different REST endpoint) doesn't require touching the code that *decides what to do* with that data, is the classic "Presentation-Domain-Data Layering" split: *"separate it into three broad layers: presentation..., domain logic..., and data access... If you need to change the database, you only need to modify the data access layer without affecting the rest of the application"* ([Martin Fowler, "PresentationDomainDataLayering"](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)).
- **[general SWE practice]** The specific shape of "one module per external system, exposing domain-shaped methods instead of leaking the wire format" is the **Repository pattern**: it "*mediates between the domain and data mapping layers using a collection-like interface for accessing domain objects*" and maintains "*a more object-oriented view of the persistence layer*", keeping a one-way dependency from domain logic down to the external-system client rather than letting API/SDK specifics leak into command files ([Martin Fowler, "Repository"](https://martinfowler.com/eaaCatalog/repository.html)).
- Applied to a command handler specifically, this means: a command file's `execute()` should call something like `googleSheetsService.getPlayerRank(id)` or `firegamesService.processarPartida(payload)`, and the service module — not the command file — owns the Sheets/REST client instantiation, auth, retries, and response-shape parsing. This is an extrapolation of the general pattern above to this project's context, not a discord.js-documented convention.
- The one discord.js-specific fact relevant here: the guide's command files as shown are already required to export only `{ data, execute[, autocomplete] }` ([discordjs.guide "Command handling"](https://discordjs.guide/legacy/app-creation/handling-commands)) — there is no framework hook for a service layer, but equally nothing in the module contract prevents `execute()` from delegating to one; the loader only inspects `'data' in command && 'execute' in command` on the required object, so any additional internal structure of the file is invisible to and unconstrained by the framework (same source).

---

## 6. Configuration / env var management

discordjs.guide presents **two** token-storage options side by side and treats env vars as the safer/preferred one for shared or public code:

- **`config.json`**: create a `config.json` with `{ "token": "your-token-goes-here" }` and `require()` it from other files ([discordjs.guide "Project Setup"](https://discordjs.guide/legacy/app-creation/project-setup)).
- **`.env` + `process.env`**: create a `.env` file (e.g. `DISCORD_TOKEN=your-token-here`) and either run with Node's native `--env-file=.env` flag or load it via a package; values are read through the `process.env` global "*in any file*", and the guide notes "*values passed this way will always be strings*" (same source).
- Either way, the guide is explicit that secrets must be excluded from version control: *"you should not commit files containing secrets"*, listing `.env`/`config.json` in a `.gitignore` alongside `node_modules` (same source).
- Separately, the bot-token page repeats the security framing without prescribing a storage mechanism: *"it is vital that you do not ever share this token with anybody, purposely or accidentally"* ([discordjs.guide "Application Setup"](https://discordjs.guide/legacy/preparations/app-setup)).
- The main-file walkthrough itself imports the token via `const { token } = require('./config.json');` in its base example ([discordjs.guide "The Main File"](https://discordjs.guide/legacy/app-creation/main-file)), i.e. the guide's own primary code sample uses `config.json`, with `.env` documented as the alternative on the setup page above. This repo already uses `dotenv` (per `package.json`) and `require('dotenv').config()` at the top of `index.js`, which matches the `.env`/`process.env` path described above.
- **[general SWE practice, not discord.js-specific]** *Validating* configuration at startup (asserting required env vars like `DISCORD_TOKEN`/`GUILD_ID`/spreadsheet IDs are present and well-formed before the process proceeds, and failing fast with a clear error rather than surfacing a confusing failure deep inside a command handler) is standard defensive-programming/fail-fast practice; discordjs.guide does not document a config-validation step or library, so no discord.js source is cited for this sub-point — it is included here only as a recommendation grounded in general engineering practice.

---

## 7. Centralized error handling and logging

**Per-command error handling** (discord.js-specific): the guide's `interactionCreate` command router wraps the `execute()` call in try/catch, logs to console, and replies to the user — checking whether a reply/defer already happened so it doesn't double-acknowledge the interaction:

```javascript
try {
    await command.execute(interaction);
} catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
            content: 'There was an error while executing this command!',
            flags: MessageFlags.Ephemeral,
        });
    } else {
        await interaction.reply({
            content: 'There was an error while executing this command!',
            flags: MessageFlags.Ephemeral,
        });
    }
}
```
(source: [discordjs.guide "Command handling"](https://discordjs.guide/legacy/app-creation/handling-commands))

**Process-level unhandled-rejection logging** (discord.js-specific advice, general-purpose mechanism): the guide's error-handling page recommends attaching a top-level listener in the bot's main file specifically to surface swallowed API errors: *"API Errors can be tracked down by adding an event listener for unhandled rejections and looking at the extra info. This can be done by adding this to your main file"*:

```javascript
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});
```
(source and quote: [discordjs.guide "Common Errors"](https://discordjs.guide/legacy/popular-topics/errors)). The same page also recommends listening for `Events.ShardError` to log otherwise-internal WebSocket-layer errors (same source).

**The `unhandledRejection` and `uncaughtException` events themselves are Node.js runtime features, not discord.js features** — cited to Node's own docs, not the discord.js guide, per the task's instruction:
- `'unhandledRejection'` "*is emitted whenever a Promise is rejected and no error handler is attached to the promise within a turn of the event loop*", with callback signature `(reason, promise) => {}`, and if left unhandled it "*will be raised as an uncaught exception*" ([Node.js docs — `process` event: `'unhandledRejection'`](https://nodejs.org/api/process.html#event-unhandledrejection)).
- `'uncaughtException'` "*is emitted when an uncaught JavaScript exception bubbles all the way back to the event loop*", callback signature `(err, origin) => {}`. Node's docs are emphatic that this is a last resort and **not** a mechanism for resuming normal operation: *"'uncaughtException' is a crude mechanism for exception handling intended to be used only as a last resort... It is not safe to resume normal operation after 'uncaughtException'."* The documented correct use is *"synchronous cleanup of allocated resources... before shutting down the process"*, and Node's own recommendation for reliable recovery is to run *"an external monitor... in a separate process to detect application failures and recover or restart as needed"* rather than trying to keep the same process alive ([Node.js docs — `process` event: `'uncaughtException'`](https://nodejs.org/api/process.html#event-uncaughtexception)).

Taken together: discordjs.guide's own primary-source coverage of "centralized" error handling is essentially the two code blocks above (per-command try/catch, and one `unhandledRejection` listener for diagnostics); it does not document `uncaughtException` handling or a restart/process-supervisor strategy at all — that portion of "centralized error handling" is filled in here by Node's own docs plus (implicitly) general process-supervision practice (e.g. running the bot under a process manager), which was not separately verified against a primary source and is not claimed as discord.js- or Node-prescribed beyond the "use an external monitor" line quoted above.

---

## 8. Testing approaches for Discord bots

**Primary-source coverage is minimal to non-existent.** Every discordjs.guide page fetched for this research (command handling, event handling, deployment, error handling, autocomplete, advanced command creation, sharding) is silent on unit testing, integration testing, mocking the Discord API, or any testing framework. No dedicated "Testing" page was found on discordjs.guide, and discord.js.org is an API reference (classes/methods), not a guide — it likewise does not document testing methodology. The [Discord Developer Docs](https://docs.discord.com/developers) cover the platform's REST/Gateway contracts, not client-side testing practice for bots built against it.

Given that, this document makes **no primary-sourced claims about testing** approaches. If a testing strategy is wanted for this project (e.g. unit-testing `execute()` functions and service modules by injecting a mock `interaction` object and mocking `axios`/`google-spreadsheet` calls with a library like Jest), that would be **community consensus / general Node.js testing practice**, not something drawn from or endorsed by an official discord.js or Discord source — flagged here explicitly as such per the task's instructions, and not elaborated further since it could not be verified against a primary source in this research pass.

---

## 9. Sharding / horizontal scalability

**Discord's requirement thresholds** (Discord Developer Docs, primary source): each shard supports at most 2,500 guilds, and *"apps that are in 2500+ guilds must enable sharding"*. Bots crossing roughly 150,000 guilds move into "large bot sharding," which changes session-start-limit math (*"max(2000, (guild_count / 1000) * 5) per day"*) and `max_concurrency` for shard startup, and Discord actively migrates and notifies bot owners when this threshold is approached ([Discord Developer Docs — Gateway, sharding section](https://docs.discord.com/developers/events/gateway)). The docs also note that the Get Gateway Bot endpoint always returns the correct recommended shard count, so a bot querying it doesn't need to hardcode threshold logic itself (same source).

**discord.js's built-in mechanism** (discord.js.org, primary source): `ShardingManager` is described as *"a utility class that makes multi-process sharding of a bot an easy and painless experience"* — it spawns a self-contained child process or worker per shard, each running a full `Client` instance, with a communication channel back to the manager process ([discord.js.org — `ShardingManager` class](https://discord.js.org/docs/packages/discord.js/14.23.2/ShardingManager:Class)). Setup restructures the project so the manager script launches a separate bot-process file:

```javascript
const { ShardingManager } = require('discord.js');
const manager = new ShardingManager('./bot.js', { token: 'your-token-goes-here' });
manager.on('shardCreate', (shard) => console.log(`Launched shard ${shard.id}`));
manager.spawn();
```
(source: [discordjs.guide "App Sharding"](https://discordjs.guide/legacy/sharding)). The guide additionally recommends roughly 1,000 guilds per shard as a rule of thumb, and steers away from discord.js's *internal* sharding option for larger bots because of the memory overhead of running everything in one process — same source.

**Applicability to this project:** `bot-mix-cs2` operates in a single guild (the deploy code registers commands via `Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID)` in `index.js`), several orders of magnitude below the 2,500-guild mandatory-sharding threshold and the 150,000-guild large-bot threshold documented above. Sharding is therefore **not currently applicable** and is documented here only for completeness/future reference, per the task's framing.

---

## 10. Naming/organization conventions used in discord.js's own guide examples

As literally shown across the fetched discordjs.guide pages:

- Top-level folders are lower-case, unprefixed nouns: `commands/`, `events/` ([Command handling](https://discordjs.guide/legacy/app-creation/handling-commands), [Event handling](https://discordjs.guide/legacy/app-creation/handling-events)).
- Command category subfolders are lower-case singular/plural nouns describing the grouping, e.g. `commands/utility/` (same source).
- Individual command files are named after the command itself, lower-case, no separators, `.js` extension: `ping.js`, `server.js`, `user.js` (same source).
- Event files are named after the exact event they handle, camelCase matching the discord.js `Events` enum member's runtime name: `ready.js`, `interactionCreate.js` ([Event handling](https://discordjs.guide/legacy/app-creation/handling-events)).
- The command module's exported command-definition property is literally named `data`, and the handler function literally named `execute` — this exact naming is load-bearing because the loader checks for it (`'data' in command && 'execute' in command`) ([Command handling](https://discordjs.guide/legacy/app-creation/handling-commands)). The optional autocomplete export is likewise literally named `autocomplete` ([Autocomplete](https://discordjs.guide/slash-commands/autocomplete)).
- The main/entry file is conventionally `index.js`, though the guide notes this is a convention, not a requirement — *"You'll require the discord.js module you installed earlier, as well as create a new Client instance..."* set up in a file the guide names `index.js` throughout, while acknowledging other names work ([The Main File](https://discordjs.guide/legacy/app-creation/main-file)).
- The deployment script is conventionally named `deploy-commands.js`, matching its single responsibility ([Registering Commands](https://discordjs.guide/legacy/app-creation/deploying-commands)).
- Config file, when used, is `config.json` at the project root, read via `require('./config.json')` ([Project Setup](https://discordjs.guide/legacy/app-creation/project-setup), [The Main File](https://discordjs.guide/legacy/app-creation/main-file)).
- Class/enum naming follows discord.js's own API surface, e.g. `Events.ClientReady`, `Events.InteractionCreate`, `GatewayIntentBits.Guilds` — PascalCase classes/enums, PascalCase enum members ([The Main File](https://discordjs.guide/legacy/app-creation/main-file), [Event handling](https://discordjs.guide/legacy/app-creation/handling-events)).

### Light real-world GitHub scan (explicitly a non-primary, real-world-reference exception)

Two well-known open-source discord.js v14 templates were briefly scanned (top-level tree + README only, no deep code read) purely to sanity-check the guide's conventions against real-world usage — these are **not** treated as authoritative and no normative claim above is sourced to them:

- **[NamVr/DiscordBot-Template](https://github.com/NamVr/DiscordBot-Template)** (328 stars at time of research) — explicitly states it is "based on https://discordjs.guide/". Top level: `commands/<category>/`, `events/`, `interactions/`, `messages/`, `triggers/reactions/`, entry file `bot.js`, `config-example.json`. README confirms the same dynamic-loader philosophy as the guide: *"All events goes inside the events folder. You don't need to use client.on() in the main bot.js file."* This closely mirrors §1/§4 above, plus extra folders (`interactions/`, `triggers/`) for concerns the base guide doesn't cover (buttons, modals, reaction triggers).
- **[TFAGaming/DiscordJS-V14-Bot-Template](https://github.com/TFAGaming/DiscordJS-V14-Bot-Template)** (411 stars at time of research) — organizes everything under a single `src/` root rather than top-level `commands`/`events` folders, with handler-driven auto-loading for commands, components, and events, plus a lightweight YAML "database." This shows folder-structure conventions vary in real projects (e.g. `src/`-rooted vs. flat-rooted) even while keeping the same commands/events/handler *concepts* from the guide.

---

## Key takeaways for this project

Concrete, implementation-ready translations of the above for `bot-mix-cs2` (currently a single root `index.js`, `commands/`, `utils/`, `firegamesService.js`, CommonJS, discord.js 14.27.0, `dotenv`, `google-spreadsheet`/`google-auth-library`, `axios`):

- **Split `index.js`.** Keep a slim `index.js` that only builds the `Client`, wires up dynamic command/event loading (§1, §4), and calls `client.login()`. Move the current inline command map (`{ help: require('./commands/help'), ... }` at the top of `index.js`) and the inline `REST`/`Routes` deploy block (around line 506) out into the patterns below — the guide's own loader already replaces both with `fs.readdirSync` over folders, so this isn't a stylistic choice, it's the documented alternative to what the file currently does.
- **`commands/<category>/<name>.js`** exporting `{ data, execute }` (add `autocomplete` only on commands that need it) — group the existing seven commands (`help`, `lives`, `anuncio`, `addstreamer`, `removerstreamer`, `config`, `clear`) into category subfolders (e.g. `commands/streamers/`, `commands/moderation/`, `commands/general/`) per §1/§3, replacing the flat `commands/` directory.
- **`events/<eventName>.js`** exporting `{ name, once, execute }`, loaded the same way as commands (§4) — pull the `ready`/`interactionCreate` handling that currently lives inline in `index.js` into `events/ready.js` and `events/interactionCreate.js`.
- **`deploy-commands.js`** as a standalone script at the project root, run manually (`node deploy-commands.js`) — move the existing inline `rest.put(Routes.applicationGuildCommands(...))` block out of `index.js` entirely, per §2, so command registration is no longer coupled to every bot startup.
- **`services/` layer** for external integrations, one file per integration, exposing domain-shaped functions rather than raw client calls (§5, general practice applied to this repo): `services/googleSheetsService.js` (wrapping today's `utils/sheets.js` `doc`/`getSheet`), `services/firegamesService.js` (relocating the existing root-level `firegamesService.js`). Command files call these services; the services own the `google-spreadsheet`/`google-auth-library`/`axios` client setup and error/response shaping.
- **`utils/`** stays for cross-cutting, non-integration helpers only (the existing `permissions.js`, `containers.js`, `config.js` fit here) — don't let integration/API code accumulate in `utils/`; that's what the new `services/` folder is for (§5 distinction).
- **Config validation at startup** (§6, general practice): add an explicit check early in `index.js` (or a small `config.js`/`env.js` loaded first) that asserts `DISCORD_TOKEN`, `GUILD_ID`, and any Sheets/Firegames-related env vars are present, failing fast with a clear message rather than letting a missing var surface as a confusing runtime error deep inside a command.
- **Centralize interaction error handling** (§7): wrap `command.execute(interaction)` in the `events/interactionCreate.js` file with the guide's exact try/catch + `replied`/`deferred` branch shown in §7, and add the single `process.on('unhandledRejection', ...)` listener in `index.js` as the guide recommends, understanding (per Node's own docs, §7) that it's for logging/diagnostics, not recovery.
- **Don't add sharding.** Per §9, this bot is single-guild and nowhere near the 2,500-guild threshold that makes sharding mandatory — no action needed now; revisit only if the bot is ever deployed to many guilds.
- **Testing: no primary-sourced pattern to follow.** Per §8, if tests are added later, that decision should be made independently of discord.js/Discord documentation (which says nothing on the topic) — e.g. unit-testing service modules and command `execute()` functions with mocked `interaction` objects, understood explicitly as a community convention rather than something discord.js prescribes.
