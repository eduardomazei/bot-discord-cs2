// Constantes compartilhadas entre /importar-partida (opções do slash command) e /mix-info
// (agrupamento/ordenação de exibição). Ver docs/adr/0005-times-com-nome-de-cor-e-mix-id.md

// Paleta fixa de nomes de time (cores) usada em /importar-partida -- fixa em vez de texto
// livre pra o /mix-info conseguir agrupar com confiança (sem risco de "roxo" vs "Roxo"
// digitado diferente entre rodadas do mesmo dia). Editar esta lista exige `npm run deploy`
// pra Discord atualizar os dropdowns de cor_time_a/cor_time_b.
const CORES_TIMES = [
  'Amarelo', 'Vermelho', 'Azul', 'Roxo', 'Laranja', 'Marrom',
  'Verde', 'Rosa', 'Branco', 'Preto',
];

// Fases de um mix day, na ordem em que devem aparecer no /mix-info -- não é a ordem em que os
// admins necessariamente rodam /importar-partida (ex: importar a final antes de arrumar o CSV
// do aquecimento). Uma partida com "rodada" fora dessa lista (não deveria acontecer, já que o
// campo é um dropdown fixo) ainda aparece no /mix-info, só que depois destas quatro.
const RODADAS = ['Aquecimento', 'Eliminatório', 'Semifinal', 'Final'];

// Emoji de círculo colorido pra cada nome de time em CORES_TIMES -- usado pelo /mix-info pra dar
// identidade visual aos confrontos sem precisar de emoji customizado por cor (que exigiria upload
// manual no servidor Discord). "Rosa" usa o coração 🩷 porque não existe círculo rosa no Unicode
// padrão (só as 9 cores de 🟡🔴🔵🟣🟠🟤🟢⚪⚫).
const EMOJI_CORES = {
  Amarelo: '🟡',
  Vermelho: '🔴',
  Azul: '🔵',
  Roxo: '🟣',
  Laranja: '🟠',
  Marrom: '🟤',
  Verde: '🟢',
  Rosa: '🩷',
  Branco: '⚪',
  Preto: '⚫',
};

// Ícone por fase, só pra dar textura ao heading de cada rodada no /mix-info -- puramente
// decorativo, não usado em nenhuma lógica de agrupamento/ordenação (isso é o RODADAS acima).
const EMOJI_RODADAS = {
  Aquecimento: '🔥',
  Eliminatório: '⚔️',
  Semifinal: '🥈',
  Final: '🏆',
};

module.exports = { CORES_TIMES, RODADAS, EMOJI_CORES, EMOJI_RODADAS };
