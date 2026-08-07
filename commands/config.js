const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { CANAIS } = require('../utils/config');
const { ehAdministrador, replyNoPermission } = require('../utils/permissions');
const { buildContainer, componentsV2Payload } = require('../utils/containers');

const COR_PRINCIPAL = 0xff6600;

function buildPainelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('config:help')
      .setLabel('Ajuda')
      .setEmoji('<a:trupe_ajuda:1535106689961951232>')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPainelContainer() {
  const corpo = [
    `<:trupe_live:1535106655681912955> **Canal de Lives:** ${CANAIS.lives ? `<#${CANAIS.lives}>` : '*Não configurado*'}`,
    `<:trupe_logs:1535106662199730176> **Canal de Logs:** ${CANAIS.logs ? `<#${CANAIS.logs}>` : '*Não configurado*'}`,
    `<a:trupe_anuncio:1535106696395890708> **Canal de Anúncios:** ${CANAIS.anuncios ? `<#${CANAIS.anuncios}>` : '*Não configurado*'}`,
  ].join('\n');

  return buildContainer({
    cor: COR_PRINCIPAL,
    titulo: '<:trupe_config:1535106642188705802> Painel de Configuração — Mix Trupe CS2',
    corpo: `Canais utilizados pelo bot neste servidor (definidos via \`.env\` — para alterar, edite o \`.env\` e reinicie o bot).\n\n${corpo}`,
    actionRows: [buildPainelRow()],
  });
}

function buildAjudaContainer() {
  return buildContainer({
    cor: COR_PRINCIPAL,
    titulo: '<a:trupe_ajuda:1535106689961951232> Ajuda — Configurações do Mix Trupe CS2',
    corpo: [
      'Entenda o que cada canal configurado faz:',
      '',
      '<:trupe_live:1535106655681912955> **Lives** — canal onde o bot posta o aviso automático quando um streamer usa `/lives`.',
      '<:trupe_logs:1535106662199730176> **Logs** — canal reservado para logs de moderação (ainda sem comandos consumindo, guardado para uso futuro).',
      '<a:trupe_anuncio:1535106696395890708> **Anúncios** — canal sugerido por padrão para o comando `/anuncio`.',
      '',
      'Esses canais são fixos via `.env` — para trocar, edite o `.env` e reinicie o bot.',
    ].join('\n'),
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Mostra o painel de configuração dos canais do bot (apenas ADM)'),

  async execute(interaction) {
    try {
      if (!(await ehAdministrador(interaction))) {
        await replyNoPermission(interaction);
        return;
      }

      await interaction.reply(componentsV2Payload(buildPainelContainer(), { ephemeral: true }));

      const mensagem = await interaction.fetchReply();

      const collector = mensagem.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000,
      });

      collector.on('collect', async (i) => {
        try {
          if (i.user.id !== interaction.user.id) {
            await i.reply({
              content: '<:trupe_bloqueado:1535106635477811242> Apenas quem executou o comando pode usar esse botão.',
              ephemeral: true,
            });
            return;
          }

          await i.reply(componentsV2Payload(buildAjudaContainer(), { ephemeral: true }));
        } catch (collectError) {
          // O listener de um collector não é aguardado por ninguém: uma exceção aqui vira
          // rejeição não tratada e derruba o processo inteiro se não for capturada aqui.
          console.error('Erro no botão Ajuda do /config:', collectError);
        }
      });
    } catch (error) {
      console.error('Erro no /config:', error);
      try {
        // Se já respondemos (o painel já apareceu), não faz sentido sobrescrever com
        // texto puro — a mensagem original foi criada como IsComponentsV2 e editReply
        // com `content` puro quebraria essa mensagem. Só reporta o erro nesse caso.
        if (interaction.deferred || interaction.replied) {
          console.error('Painel do /config já havia sido enviado; erro ocorreu depois (ex: configuração do botão Ajuda).');
          return;
        }

        await interaction.reply({
          content: '<a:trupe_erro:1535106712359407626> Ocorreu um erro ao abrir o painel de configuração. Tente novamente.',
          ephemeral: true,
        });
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /config:', fallbackError);
      }
    }
  },
};
