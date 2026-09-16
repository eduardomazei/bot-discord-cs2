// URLs do site (trupemix.com.br) -- usado pelos comandos de stats que decidimos parar de montar
// embed com dado da planilha e passar a só apontar pra página do site que já mostra aquilo,
// bonito e sempre atualizada (decisão de 15/09/2026: centralizar tudo no site, ver
// CLAUDE.md/memória do projeto trupe-site). SITE_URL é opcional no .env -- cai pro domínio de
// produção se não estiver definido.
const SITE_URL = (process.env.SITE_URL || 'https://trupemix.com.br').replace(/\/$/, '');

const linkJogador = (discordId) => `${SITE_URL}/jogadores/${discordId}`;
const linkPartida = (matchId) => `${SITE_URL}/partidas/${matchId}`;
const linkRanking = () => `${SITE_URL}/ranking`;
const linkSeason = () => `${SITE_URL}/season`;
const linkResultados = () => `${SITE_URL}/resultados`;
const linkMixes = () => `${SITE_URL}/mixes`;
const linkRegistro = () => `${SITE_URL}/registro`;
const linkPresenca = () => `${SITE_URL}/presenca`;

module.exports = {
  SITE_URL,
  linkJogador,
  linkPartida,
  linkRanking,
  linkSeason,
  linkResultados,
  linkMixes,
  linkRegistro,
  linkPresenca,
};
