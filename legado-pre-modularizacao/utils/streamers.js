const { getSheet } = require('./sheets');

// Nomes reais das colunas na aba "Streamers" da planilha (definidos pelo usuário ao criar a aba).
const COL_DISCORD_ID = 'discord_id';
const COL_CANAL_TWITCH = 'Canal Twitch';
const COL_ATIVO = 'Ativo';

/**
 * Busca a linha do streamer ativo (Ativo = TRUE) na aba "Streamers" pelo discord_id.
 * @param {string} discordId
 * @returns {Promise<import('google-spreadsheet').GoogleSpreadsheetRow|null>}
 */
async function getStreamerAtivo(discordId) {
  const sheet = await getSheet('Streamers');
  if (!sheet) return null;

  const rows = await sheet.getRows();
  const row = rows.find(
    (r) => r.get(COL_DISCORD_ID) === discordId && (r.get(COL_ATIVO) || '').toString().toUpperCase() === 'TRUE'
  );

  return row || null;
}

/**
 * Cria ou atualiza o registro de streamer de um jogador, marcando-o como ativo.
 * @param {string} discordId
 * @param {string} canalTwitch
 * @returns {Promise<import('google-spreadsheet').GoogleSpreadsheetRow>}
 */
async function upsertStreamer(discordId, canalTwitch) {
  const sheet = await getSheet('Streamers');
  if (!sheet) throw new Error('Aba "Streamers" não encontrada na planilha.');

  const rows = await sheet.getRows();
  const row = rows.find((r) => r.get(COL_DISCORD_ID) === discordId);

  if (row) {
    row.set(COL_CANAL_TWITCH, canalTwitch);
    row.set(COL_ATIVO, 'TRUE');
    await row.save();
    return row;
  }

  return sheet.addRow({ [COL_DISCORD_ID]: discordId, [COL_CANAL_TWITCH]: canalTwitch, [COL_ATIVO]: 'TRUE' });
}

/**
 * Marca o streamer como inativo (Ativo = FALSE), sem apagar a linha.
 * @param {string} discordId
 * @returns {Promise<import('google-spreadsheet').GoogleSpreadsheetRow|null>} A linha desativada, ou null se não havia streamer ativo.
 */
async function desativarStreamer(discordId) {
  const sheet = await getSheet('Streamers');
  if (!sheet) return null;

  const rows = await sheet.getRows();
  const row = rows.find(
    (r) => r.get(COL_DISCORD_ID) === discordId && (r.get(COL_ATIVO) || '').toString().toUpperCase() === 'TRUE'
  );
  if (!row) return null;

  row.set(COL_ATIVO, 'FALSE');
  await row.save();
  return row;
}

module.exports = { getStreamerAtivo, upsertStreamer, desativarStreamer };
