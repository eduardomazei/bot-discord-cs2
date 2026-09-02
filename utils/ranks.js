// Sistema de Ranks (E -> SS) e cálculo de variação de Elo por performance na partida.
//
// Elo de partida (ver firegamesService.js): a variação não é mais fixa (+25/-20 com bônus de
// ADR) -- agora escala com o KD da própria partida (kills/deaths, já coletado do CSV do
// MatchZy), pra premiar quem carrega o time mesmo numa derrota e punir mais quem só "farmou"
// uma vitória sem contribuir. As faixas cobrem o intervalo -30 a +40 pedido no design.
const FAIXAS_KD = [
  { limite: 0.60, vitoria: 10, derrota: -30 },
  { limite: 1.00, vitoria: 18, derrota: -23 },
  { limite: 1.30, vitoria: 25, derrota: -15 },
  { limite: 1.70, vitoria: 32, derrota: -10 },
  { limite: Infinity, vitoria: 40, derrota: -5 },
];

/**
 * Calcula quanto Elo o jogador ganha (vitória) ou perde (derrota) numa partida, com base no KD
 * que ele fez NAQUELA partida específica -- não no KD acumulado da carreira.
 * @param {number} kills
 * @param {number} deaths
 * @param {boolean} venceu
 * @returns {number} variação de Elo (positiva ou negativa)
 */
function calcularVariacaoElo(kills, deaths, venceu) {
  // deaths=0 (ninguém te matou) não pode zerar o divisor -- trata como se tivesse morrido 1x.
  const kd = kills / Math.max(deaths, 1);
  const faixa = FAIXAS_KD.find(f => kd < f.limite) || FAIXAS_KD[FAIXAS_KD.length - 1];
  return venceu ? faixa.vitoria : faixa.derrota;
}

// Escada de ranks -- "min" é o Elo mínimo pra alcançar aquele rank. E começa no próprio Elo
// base (1000, todo cadastro novo já nasce nele); não existe rank abaixo de E -- quem cai
// abaixo de 1000 (Elo tem piso 0, ver Math.max em firegamesService.js) continua em E.
const RANKS = [
  { nome: 'E', min: 1000, emoji: '<:trupe_tier_e_mazei:1540075381493858305>' },
  { nome: 'D', min: 1300, emoji: '<:trupe_tier_d_mazei:1540075417342443690>' },
  { nome: 'C', min: 1600, emoji: '<:trupe_tier_c_mazei:1540075444215357581>' },
  { nome: 'B', min: 1900, emoji: '<:trupe_tier_b_mazei:1540075489454985278>' },
  { nome: 'A', min: 2200, emoji: '<:trupe_tier_a_mazei:1540075518035230840>' },
  { nome: 'S', min: 2500, emoji: '<:trupe_tier_s_mazei:1540075351525425203>' },
  { nome: 'SS', min: 2800, emoji: '<:trupe_tier_ss_mazei:1540075313529102506>' },
];

/**
 * Retorna o rank (objeto de RANKS) correspondente a um valor de Elo.
 * @param {number} elo
 */
function obterRank(elo) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (elo >= RANKS[i].min) return RANKS[i];
  }
  return RANKS[0]; // fallback -- não deveria ocorrer já que RANKS[0].min é o próprio piso de Elo (0 < 1000, mas elo nunca é negativo)
}

/**
 * Retorna o próximo rank na escada, ou null se o jogador já está no rank máximo (SS).
 * @param {number} elo
 */
function obterProximoRank(elo) {
  const atual = obterRank(elo);
  const idxAtual = RANKS.findIndex(r => r.nome === atual.nome);
  return RANKS[idxAtual + 1] || null;
}

// --- Tag de rank no apelido do Discord ----------------------------------------------
// O rank (letra) É derivado do Elo (obterRank) -- a tag no nick é 100% decorativa e é
// remontada a partir dele. A coluna `rank_trupe` na aba Jogadores guarda a letra do rank
// do jogador (E/D/C/B/A/S/SS), ou vazio enquanto a administração não rankeou (apelido fica
// com a TAG_NEUTRA). O site (trupe-site) NÃO usa essa string -- mostra só a coluna `nome`
// limpa + um badge de rank; se mudar o formato aqui, espelhe em trupe-site/lib/ranks.js
// (TAG_POR_RANK).
const TAG_POR_RANK = {
  SS: '♛ 𝕊𝕊 ┃ ',
  S: '✧ 𝕊 ┃ ',
  A: '✶𝖠 ┃ ',
  B: '✶𝖡 ┃ ',
  C: '✶𝖢 ┃ ',
  D: '✶𝖣 ┃ ',
  E: '✶𝖤 ┃ ',
};

// Cadastro novo ainda não rankeado pela administração (rank_trupe vazio) -- fica com um
// marcador sem letra até um /rankear.
const TAG_NEUTRA = '✶ ┃ ';

// Elo que o /rankear atribui: o MEIO da faixa do rank escolhido (min + metade da largura
// até o próximo degrau; SS não tem teto, usa min + 150). Dá uma folga pra não cair de
// rank já na primeira derrota. Se o jogador já estiver na faixa certa, o /rankear não
// mexe no Elo (ver commands/jogadores/rankear.js).
const ELO_MEIO_FAIXA = RANKS.reduce((acc, r, i) => {
  const proximo = RANKS[i + 1];
  acc[r.nome] = proximo ? Math.round((r.min + proximo.min) / 2) : r.min + 150;
  return acc;
}, {});

// Separadores verticais que aparecem entre a tag e o nome ("♛ 𝕊𝕊 ┃ MAZEI", "👑SS | GLE1N",
// "A｜MD", "♕ 𝖲𝖲 ❘ LORKATS"). Cobre o ┃ novo, a barra comum, a fullwidth ｜, a ❘ (usada em
// vários nicks antigos) e outras variantes de traço vertical.
const SEPARADOR_TAG = /\s*[|｜┃▎▏│┋∣❘❙❚¦]\s*/;

/**
 * Nome sem a tag de rank do começo. Prefira a coluna `nome` da aba Jogadores; isto é o
 * fallback pra linha ainda não migrada ou pro displayName cru na hora do /registrar.
 * @param {string} nickCru
 * @returns {string}
 */
function nomeLimpo(nickCru) {
  const s = String(nickCru || '').trim();
  if (!s) return '';
  const partes = s.split(SEPARADOR_TAG);
  if (partes.length > 1) {
    const nome = partes[partes.length - 1].trim();
    if (nome) return nome;
  }
  // Sem separador: tenta tirar "SS "/"A " logo depois de eventuais símbolos iniciais.
  const semSimbolo = s.replace(/^[^\p{L}\p{N}]+/u, '');
  const m = semSimbolo.match(/^(SS|S|A|B|C|D|E)\s+(\p{L}.*)$/iu);
  if (m) return m[2].trim();
  return semSimbolo || s;
}

/**
 * Monta o apelido completo pro Discord: "✶𝖠 ┃ MAZEI".
 * @param {string} nome  nome já limpo
 * @param {string} tag   uma das TAG_POR_RANK, ou TAG_NEUTRA
 */
function montarNick(nome, tag) {
  return `${tag || ''}${String(nome || '').trim()}`;
}

/**
 * Tag decorativa correspondente a um Elo. rank_trupe vazio/ausente = jogador ainda não
 * rankeado, devolve a tag neutra.
 * @param {number} elo
 * @param {string} [rankTrupeAtual] valor da coluna rank_trupe (se vazio, jogador não rankeado)
 */
function tagDoElo(elo, rankTrupeAtual) {
  if (!rankTrupeAtual) return TAG_NEUTRA;
  return TAG_POR_RANK[obterRank(elo).nome] || TAG_NEUTRA;
}

module.exports = {
  RANKS, FAIXAS_KD, calcularVariacaoElo, obterRank, obterProximoRank,
  TAG_POR_RANK, TAG_NEUTRA, ELO_MEIO_FAIXA, nomeLimpo, montarNick, tagDoElo,
};
