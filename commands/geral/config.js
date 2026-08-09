const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { CANAIS } = require('../../utils/config');
const { ehAdministrador, replyNoPermission } = require('../../utils/permissions');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');

const COR_PRINCIPAL = 0xff6600;

function buildPainelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('config:help')
      .setLabel('Ajuda')
      .setEmoji('<:trupe_discord:1535757221470675034>')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPainelContainer() {
  const corpo = [
    `<a:trupe_live:1535757229939232791> **Canal de Lives:** ${CANAIS.lives ? `<#${CANAIS.lives}>` : '*Não configurado*'}`,
    `<:trupe_aviso:1535757212541128724> **Canal de Logs:** ${CANAIS.logs ? `<#${CANAIS.logs}>` : '*Não configurado*'}`,
    `<:trupe_anuncio:1535757207402971278> **Canal de Anúncios:** ${CANAIS.anuncios ? `<#${CANAIS.anuncios}>` : '*Não configurado*'}`,
  ].join('\n');

  return buildContainer({
    cor: COR_PRINCIPAL,
    titulo: '<:trupe_config:1535757218534658098> Painel de Configuração — Mix Trupe CS2',
    corpo: `Canais utilizados pelo bot neste servidor (definidos via \`.env\` — para alterar, edite o \`.env\` e reinicie o bot).\n\n${corpo}`,
    actionRows: [buildPainelRow()],
  });
}

function buildAjudaContainer() {
  return buildContainer({
    cor: COR_PRINCIPAL,
    titulo: '<:trupe_discord:1535757221470675034> Ajuda — Configurações do Mix Trupe CS2',
    corpo: [
      'Entenda o que cada canal configurado faz:',
      '',
      '<a:trupe_live:1535757229939232791> **Lives** — canal onde o bot posta o aviso automático quando um streamer usa `/lives`.',
      '<:trupe_aviso:1535757212541128724> **Logs** — canal reservado para logs de moderação (ainda sem comandos consumindo, guardado para uso futuro).',
      '<:trupe_anuncio:1535757207402971278> **Anúncios** — canal sugerido por padrão para o comando `/anuncio`.',
      '',
      'Esses canais são fixos via `.env` — para trocar, edite o `.env` e reinicie o bot.',
    ].join('\n'),
  });
}

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem do
  // despacho antecipado dos comandos modulares em index.js. Ver docs/plans/modularizacao-index-js.md, seção 4.1.
  exigeRegistro: false,

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
              content: '<:trupe_bloqueado:1535757215359828080> Apenas quem executou o comando pode usar esse botão.',
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
          content: '<:trupe_erro:1535757225631686686> Ocorreu um erro ao abrir o painel de configuração. Tente novamente.',
          ephemeral: true,
        });
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /config:', fallbackError);
      }
    }
  },
};
