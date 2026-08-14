const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { getSheet } = require('../../utils/sheets');
const { CORES } = require('../../utils/colors');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { enviarNotificacaoDM } = require('../../services/notificacoesService');
const { BANNERS } = require('../../utils/banners');

// Mesmo prazo do preview de /importar-partida -- ver docs/adr/0002-importar-partida-preview-antes-de-gravar.md.
// Aqui o preview é antes de ENVIAR em massa, não gravar, mas o motivo é o mesmo: dar tempo do
// ADM conferir antes de uma ação que não tem como desfazer (não dá pra "cancelar" uma DM já enviada).
const TTL_PREVIEW_MS = 10 * 60 * 1000;

// Mensagem padrão: usada sem filtro de cargo E para o cargo Hubmix (gente que já joga o mix,
// só falta cadastrar).
const TITULO_CONVITE = '<:trupe_teia:1536412408203976888> Bora jogar com a gente?';
const CORPO_CONVITE =
  'Vimos que você ainda não fez seu cadastro no **Mix Trupe CS2**! ' +
  'Registrar é rápido e libera todos os comandos do bot -- confirmar presença, entrar nos mixes, acompanhar seu Elo e muito mais.\n\n' +
  'Use `/registrar` aqui no servidor pra vincular sua conta Steam e começar a jogar com a gente!';

// Mensagem específica pro cargo PlayerOld: apesar do nome, são players que NUNCA jogaram o mix
// -- esse convite é pra vir conhecer/começar, não pra "voltar".
const NOME_CARGO_NUNCA_JOGOU = 'playerold';
const TITULO_CONVITE_NUNCA_JOGOU = '<:trupe_teia:1536412408203976888> Vem jogar seu primeiro mix com a gente!';
const CORPO_CONVITE_NUNCA_JOGOU =
  'Você faz parte do nosso servidor mas ainda não jogou nenhum mix com a gente! ' +
  'Registrar é rápido e libera todos os comandos do bot -- confirmar presença, entrar nos mixes, acompanhar seu Elo e muito mais.\n\n' +
  'Use `/registrar` aqui no servidor pra vincular sua conta Steam e vir jogar seu primeiro mix!';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('convite-registro')
    .setDescription('[Owner/Directors] Notifica por DM quem ainda não fez /registrar')
    .addRoleOption(option =>
      option
        .setName('cargo')
        .setDescription('Notificar só quem tem esse cargo (padrão: todo mundo do servidor)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!',
        ephemeral: true
      });
    }

    const cargoFiltro = interaction.options.getRole('cargo');

    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via
    // editReply. Efêmero: é uma ação sensível (dispara DM em massa), só o ADM que rodou precisa ver.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

    try {
      const sheetJogadores = await getSheet('Jogadores');
      const rows = await sheetJogadores.getRows();
      const registrados = new Set(
        rows
          .filter(r => {
            const steamId = r.get('steamid64');
            return r.get('discord_id') && steamId && steamId !== 'N/A';
          })
          .map(r => r.get('discord_id'))
      );

      const membros = await interaction.guild.members.fetch();
      let semRegistro = [...membros.values()].filter(m => !m.user.bot && !registrados.has(m.id));
      if (cargoFiltro) {
        semRegistro = semRegistro.filter(m => m.roles.cache.has(cargoFiltro.id));
      }

      const escopoTexto = cargoFiltro ? ` com o cargo **${cargoFiltro.name}**` : ' do servidor';
      // Só o cargo PlayerOld usa a mensagem de "nunca jogou" -- sem filtro e qualquer outro
      // cargo (ex: Hubmix) usam a mensagem padrão.
      const ehCargoNuncaJogou = cargoFiltro?.name?.trim().toLowerCase() === NOME_CARGO_NUNCA_JOGOU;
      const tituloDM = ehCargoNuncaJogou ? TITULO_CONVITE_NUNCA_JOGOU : TITULO_CONVITE;
      const corpoDM = ehCargoNuncaJogou ? CORPO_CONVITE_NUNCA_JOGOU : CORPO_CONVITE;

      if (semRegistro.length === 0) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.SUCESSO,
            titulo: '<:trupe_sucesso:1536412279778574356> Ninguém pra notificar',
            corpo: `Todo mundo${escopoTexto} já tem cadastro via \`/registrar\`! 🎉`,
          })
        ));
      }

      const previewLista = semRegistro.slice(0, 20).map(m => `• ${m.displayName}`).join('\n');
      const previewCorpo =
        `**${semRegistro.length} membro(s)${escopoTexto} sem cadastro** vão receber a DM de convite:\n${previewLista}` +
        (semRegistro.length > 20 ? `\n*(+${semRegistro.length - 20} outro(s))*` : '') +
        '\n\n⚠️ Confira a lista antes de confirmar. Pode mandar um teste pra sua própria DM primeiro.';

      const rowBotoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('convite_registro_teste').setLabel('Mandar teste pra mim').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('convite_registro_confirmar').setLabel(`Confirmar envio (${semRegistro.length})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('convite_registro_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger),
      );

      const previewMessage = await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.AVISO,
          titulo: '<:trupe_aviso:1536410370829328434> Pré-visualização do convite de registro',
          corpo: previewCorpo,
          actionRows: [rowBotoes],
        })
      ));

      const collector = previewMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: TTL_PREVIEW_MS,
      });

      collector.on('collect', async (i) => {
        if (i.customId === 'convite_registro_cancelar') {
          await i.update(componentsV2Payload(
            buildContainer({ cor: CORES.NEUTRO, titulo: '<:trupe_erro:1536410911617843322> Cancelado', corpo: 'Nada foi enviado.' })
          ));
          return collector.stop('CONCLUIDO');
        }

        if (i.customId === 'convite_registro_teste') {
          await i.deferUpdate();
          const ok = await enviarNotificacaoDM(interaction.client, interaction.user.id, {
            bannerKey: BANNERS.REGISTRAR,
            cor: CORES.AVISO,
            titulo: tituloDM,
            corpo: corpoDM,
          });
          await interaction.followUp({
            content: ok
              ? '<:trupe_sucesso:1536412279778574356> Teste enviado pra sua DM.'
              : '<:trupe_erro:1536410911617843322> Não consegui te mandar DM -- confira se está com DM aberta pro bot.',
            ephemeral: true,
          });
          return; // não para o collector -- pode testar de novo ou seguir pra confirmar/cancelar
        }

        if (i.customId === 'convite_registro_confirmar') {
          await i.update(componentsV2Payload(
            buildContainer({
              cor: CORES.INFO,
              titulo: '<:trupe_teia:1536412408203976888> Enviando...',
              corpo: `Notificando ${semRegistro.length} jogador(es), aguarde.`,
            })
          ));

          let sucesso = 0;
          let falha = 0;
          for (const membro of semRegistro) {
            const ok = await enviarNotificacaoDM(interaction.client, membro.id, {
              bannerKey: BANNERS.REGISTRAR,
              cor: CORES.AVISO,
              titulo: tituloDM,
              corpo: corpoDM,
            });
            ok ? sucesso++ : falha++;
          }

          await interaction.editReply(componentsV2Payload(
            buildContainer({
              cor: CORES.SUCESSO,
              titulo: '<:trupe_sucesso:1536412279778574356> Convites enviados',
              corpo: `**${sucesso}** notificado(s) com sucesso.\n**${falha}** falharam (provavelmente DM fechada pro bot).`,
            })
          ));
          return collector.stop('CONCLUIDO');
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason !== 'CONCLUIDO') {
          await interaction.editReply(componentsV2Payload(
            buildContainer({
              cor: CORES.NEUTRO,
              titulo: '⏱️ Tempo esgotado',
              corpo: 'Nada foi enviado -- rode `/convite-registro` de novo se quiser tentar outra vez.',
            })
          )).catch(() => {});
        }
      });
    } catch (error) {
      console.error('Erro no /convite-registro:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao buscar os jogadores sem cadastro.' })
      ));
    }
  },
};
