// Painel de regras compartilhado entre /regras (commands/servidor/regras.js) e o post fixo no
// canal #regras (script de provisionamento do onboarding) -- os dois precisam do mesmo
// select menu + botão "Concordo", então ficam num módulo só em vez de duas cópias divergindo.
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { buildContainer } = require('./containers');
const { CORES } = require('./colors');

function construirPainelRegras() {
  const selectMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_regras')
      .setPlaceholder('📌 Clique aqui para escolher a categoria das regras...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Respeito e Convivência')
          .setDescription('Respeito, linguagem/comportamento e nome/foto de perfil')
          .setValue('regras_respeito')
          .setEmoji('🤝'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Conteúdo, Spam e Divulgação')
          .setDescription('Conteúdo proibido, spam/flood e divulgação')
          .setValue('regras_conteudo')
          .setEmoji('🚫'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Contas, Privacidade e Segurança')
          .setDescription('Contas secundárias, dados pessoais e gravações')
          .setValue('regras_privacidade')
          .setEmoji('🔒'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Canais e Conduta nos Jogos/MIX')
          .setDescription('Uso de canais de texto/voz e integridade das partidas')
          .setValue('regras_canais_jogos')
          .setEmoji('🎮'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Denúncias, Staff e Punições')
          .setDescription('Como denunciar, decisões da Staff e escala de punição')
          .setValue('regras_staff_punicoes')
          .setEmoji('⚖️'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Mecânicas do Bot (Elo, Presença)')
          .setDescription('Como funcionam Elo/Rank, presença e advertências no bot')
          .setValue('regras_mecanicas_bot')
          .setEmoji('<:trupe_elo_up:1536410866709176492>')
      )
  );

  const botaoConcordo = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('regras_concordo')
      .setLabel('Eu li e concordo com as regras')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  return buildContainer({
    cor: CORES.ERRO,
    titulo: '<:trupe_teia:1536412408203976888> Regras Oficiais — Servidor TRUPE',
    corpo:
      'Seja bem-vindo(a) ao **Mix Trupe**!\n\n' +
      'Selecione uma categoria no **menu abaixo** pra ler as regras completas. Depois de ler, ' +
      'clique em **"Eu li e concordo com as regras"** -- combinado com o `/registrar`, isso libera o resto do servidor.',
    rodape: 'Mix Trupe CS2 • Leia com atenção antes de concordar',
    actionRows: [selectMenu, botaoConcordo],
  });
}

module.exports = { construirPainelRegras };
