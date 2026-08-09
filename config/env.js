// Carrega e valida as variáveis de ambiente do bot. Deve ser o PRIMEIRO require de
// qualquer entrypoint (index.js, deploy-commands.js) — vários módulos do projeto
// (ex: utils/sheets.js) leem process.env no momento do próprio require, então se
// isso rodar depois deles, o .env já pode ter sido lido com valores ausentes.
//
// Ver docs/plans/modularizacao-index-js.md §8.1.
require('dotenv').config();

const OBRIGATORIAS = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'SPREADSHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
];

const OPCIONAIS = [
  'CANAL_LIVES_ID',
  'CANAL_LOGS_ID',
  'CANAL_ANUNCIOS_ID',
  'PTERODACTYL_URL',
  'PTERODACTYL_API_KEY',
];

const faltando = OBRIGATORIAS.filter((chave) => !process.env[chave]);
if (faltando.length) {
  console.error(`[env] Variáveis obrigatórias ausentes no .env: ${faltando.join(', ')}`);
  process.exit(1);
}

for (const chave of OPCIONAIS) {
  if (!process.env[chave]) {
    console.warn(`[env] ${chave} não configurada — funcionalidade relacionada ficará indisponível.`);
  }
}
