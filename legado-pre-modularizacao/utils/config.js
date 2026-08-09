// Canais fixos do bot (servidor único) — configurados via .env.
// Para trocar um canal, edite o .env e reinicie o bot.
const CANAIS = {
  lives: process.env.CANAL_LIVES_ID || null,
  logs: process.env.CANAL_LOGS_ID || null,
  anuncios: process.env.CANAL_ANUNCIOS_ID || null,
};

module.exports = { CANAIS };
