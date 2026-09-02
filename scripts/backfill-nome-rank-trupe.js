// One-off: preenche as colunas `nome` e `rank_trupe` da aba "Jogadores" e padroniza o
// apelido de todo mundo no Discord pro novo formato ("✶𝖠 ┃ MAZEI"), derivando o rank do
// Elo atual de cada jogador.
//
// Uso (na raiz do repo bot-mix-cs2):
//   node scripts/backfill-nome-rank-trupe.js          -> DRY RUN (só mostra o que faria)
//   node scripts/backfill-nome-rank-trupe.js --go     -> aplica de verdade
//
// Idempotente: rodar de novo só reconcilia o que estiver fora do lugar. Nunca apaga
// linhas nem toca em Elo/stats.
require('../config/env');
const { Client, GatewayIntentBits } = require('discord.js');
const { getSheet } = require('../utils/sheets');
const { obterRank, TAG_POR_RANK, montarNick, nomeLimpo, normalizarLetras } = require('../utils/ranks');

const APLICAR = process.argv.includes('--go');
const PAUSA_MS = 900;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(APLICAR ? '>>> MODO APLICAR <<<\n' : '>>> DRY RUN (use --go pra aplicar) <<<\n');

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(process.env.DISCORD_TOKEN);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.members.fetch(); // popula o cache de membros

  const sheet = await getSheet('Jogadores');
  const header = sheet.headerValues || [];
  for (const col of ['nome', 'rank_trupe']) {
    if (!header.includes(col)) {
      console.error(`❌ A coluna "${col}" não existe na aba Jogadores. Crie o cabeçalho antes de rodar.`);
      await client.destroy();
      process.exit(1);
    }
  }

  const rows = await sheet.getRows();
  const resumo = { linhas: 0, nomePreenchido: 0, rankTrupe: 0, renomeados: 0, semPermissao: 0, foraDoServer: 0, jaOk: 0 };

  for (const row of rows) {
    const discordId = (row.get('discord_id') || '').trim();
    if (!discordId) continue;
    resumo.linhas++;

    const elo = parseInt(row.get('elo') || 1000, 10);
    const rankLetra = obterRank(elo).nome;
    const member = guild.members.cache.get(discordId);
    // Nome: coluna `nome` se já preenchida (re-normalizada, caso tenha entrado com fonte
    // estilizada numa passada anterior); senão tira a tag do apelido ATUAL no Discord
    // (member.displayName) -- a coluna discord_nick da planilha costuma estar desatualizada.
    const baseNome = member ? member.displayName : row.get('discord_nick');
    const nome = normalizarLetras((row.get('nome') || '').trim()) || nomeLimpo(baseNome) || 'Jogador';
    const nickNovo = montarNick(nome, TAG_POR_RANK[rankLetra]);

    const nomeAntes = (row.get('nome') || '').trim();
    const rankTrupeAntes = (row.get('rank_trupe') || '').trim();
    if (nomeAntes !== nome) resumo.nomePreenchido++;
    if (rankTrupeAntes !== rankLetra) resumo.rankTrupe++;

    let statusNick;
    if (!member) {
      statusNick = 'fora do servidor';
      resumo.foraDoServer++;
    } else if (member.displayName === nickNovo) {
      statusNick = 'já ok';
      resumo.jaOk++;
    } else if (!member.manageable) {
      statusNick = `SEM PERMISSÃO (queria "${nickNovo}")`;
      resumo.semPermissao++;
    } else {
      statusNick = `"${member.displayName}" -> "${nickNovo}"`;
      resumo.renomeados++;
    }

    console.log(`${discordId.padEnd(20)} elo ${String(elo).padEnd(5)} ${rankLetra.padEnd(2)} | ${statusNick}`);

    if (APLICAR) {
      row.set('nome', nome);
      row.set('rank_trupe', rankLetra);
      row.set('discord_nick', nickNovo);
      await row.save();
      if (member && member.manageable && member.displayName !== nickNovo) {
        try {
          await member.setNickname(nickNovo, 'Backfill: padroniza tag de rank pelo Elo');
        } catch (err) {
          console.warn(`  ⚠️  falha ao renomear ${discordId}: ${err.message}`);
        }
        await dormir(PAUSA_MS);
      }
    }
  }

  console.log('\nResumo:', JSON.stringify(resumo, null, 2));
  if (!APLICAR) console.log('\nNada foi gravado. Rode de novo com --go pra aplicar.');
  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
