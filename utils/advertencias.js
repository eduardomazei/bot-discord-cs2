// Extraído de legacy/interactionRouter.js na migração de /desadvertir (comando 14/21) --
// compartilhado com o texto do select_regras (ainda no legado) e com /advertir e /ausente
// (ainda não migrados).
const MAX_ADVERTENCIAS = 3;

// A cada X pontos de advertência acumulados, o jogador recebe 1 punição automática
const PONTOS_POR_PUNICAO = MAX_ADVERTENCIAS;
const DURACAO_BAN_SEMANAL_MS = 7 * 24 * 60 * 60 * 1000; // 1ª punição: 1 semana banido do Mix

// Tipos de advertência disponíveis em /advertir e sua pontuação
const TIPOS_ADVERTENCIA = {
  falta_atraso: { label: 'Falta ou Atraso', pontos: 1 },
  falta_respeito: { label: 'Falta de Respeito com ADM/Staff', pontos: 2 },
  ragequit_troll: { label: 'Ragequit ou Troll', pontos: 3 },
};

module.exports = { MAX_ADVERTENCIAS, PONTOS_POR_PUNICAO, DURACAO_BAN_SEMANAL_MS, TIPOS_ADVERTENCIA };
