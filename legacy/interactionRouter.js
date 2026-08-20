// legacy/interactionRouter.js
//
// Todos os 21 comandos que viviam aqui já migraram pro padrão modular
// (commands/<categoria>/*.js) -- ver git log de "migração legacy -> modular". O que resta
// neste arquivo é só o que ainda não tem lar modular: o handler do select menu de /regras
// (customId select_regras) e o formulário (isModalSubmit) de /registrar -- não existe ainda um
// loader de componentes (select/modal) no padrão modular, então esses dois handlers ficam aqui
// até essa peça ser construída. Ver docs/plans/modularizacao-index-js.md §6 e §11 (fora do
// escopo daquele plano original). /importar-partida usava um terceiro handler aqui (modal), mas
// migrou pra opções de slash command e ficou autocontido em commands/partidas/importar-partida.js
// -- ver docs/adr/0005-times-com-nome-de-cor-e-mix-id.md.
//
// events/interactionCreate.js cai aqui pra QUALQUER interação que não seja um slash command
// reconhecido em commands/<categoria>/ -- na prática, hoje isso é só select/modal
// (todo comando real já é resolvido antes de chegar aqui).

const {
  EmbedBuilder,
} = require('discord.js');

const { getSheet } = require('../utils/sheets');
const { CORES } = require('../utils/colors');
const { buildContainer, componentsV2Payload } = require('../utils/containers');
// Usada só pelo texto de "Conduta e Punições" do select_regras.
const { PONTOS_POR_PUNICAO } = require('../utils/advertencias');
// jogadorEstaRegistrado/invalidarRegistroCache continuam exportados daqui embaixo -- usados por
// events/interactionCreate.js (trava de registro dos comandos modulares) e pelo modal de
// /registrar (invalidarRegistroCache, logo após gravar um cadastro novo).
const { jogadorEstaRegistrado, invalidarRegistroCache } = require('../services/registroService');

async function executarRoteadorLegado(interaction) {


  // ==========================================
  // 0. PROCESSAMENTO DE MENUS DE SELEÇÃO (SELECT MENU)
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_regras') {
      const opcao = interaction.values[0];

      const CATEGORIAS_REGRAS = {
        regras_conduta: {
          titulo: '<:trupe_teia:1536412408203976888> Regras de Conduta e Punições',
          cor: CORES.ERRO,
          corpo: [
            '**1. Respeito em Primeiro Lugar**',
            'Proibido qualquer tipo de ofensas pesadas, discriminação, racismo, homofobia ou toxicidade extrema no chat de voz ou texto.',
            '',
            '**2. Ausências e WO**',
            'Não comparecer após confirmar presença acarretará em advertência automática via `/ausente` (1 ponto).',
            '',
            '**3. Pontos e Punições**',
            `Advertências valem **1 a 3 pontos**, de acordo com o tipo. A cada **${PONTOS_POR_PUNICAO} pontos** acumulados o jogador recebe 1 punição automática: a **1ª** bloqueia o \`/presenca confirmar\` por **1 semana**; a **2ª** bane o jogador do Mix até o **fim da temporada atual**.`,
          ].join('\n'),
        },
        regras_filas: {
          titulo: '<:trupe_teia:1536412408203976888> Funcionamento da Presença e Servidores',
          cor: CORES.INFO,
          corpo: [
            '**1. Confirmação de Presença**',
            'Apenas jogadores cadastrados via `/registrar` podem confirmar presença com `/presenca confirmar`.',
            '',
            '**2. Fechamento da Lista**',
            'Assim que a lista de presença atinge o número de vagas definido em `/presenca criar`, o bot notifica todos e os capitães iniciam a fase de veto com `/pick`.',
            '',
            '**3. Conexão Direta**',
            'Utilize o comando `connect` exibido em `/server` para entrar no servidor do CS2.',
          ].join('\n'),
        },
        regras_elo: {
          titulo: '<:trupe_teia:1536412408203976888> Sistema de Elo e Estatísticas',
          cor: CORES.AVISO,
          corpo: [
            '**1. Pontuação Base**',
            'Todos os jogadores começam com **1000 de Elo** base no cadastro.',
            '',
            '**2. Vitórias e Derrotas**',
            'Vitórias concedem em média **+25 Elo** e derrotas removem em média **-20 Elo**.',
            '',
            '**3. Bônus de Performance (ADR)**',
            'Jogadores com ADR alto (>100) recebem bônus extra de Elo na partida (+5 pts).',
          ].join('\n'),
        },
      };

      const categoria = CATEGORIAS_REGRAS[opcao];
      if (!categoria) return;

      return await interaction.reply(componentsV2Payload(
        buildContainer({ cor: categoria.cor, titulo: categoria.titulo, corpo: categoria.corpo }),
        { ephemeral: true }
      ));
    }
  }

  // ==========================================
  // 1. PROCESSAMENTO DE FORMULÁRIOS (MODALS)
  // ==========================================
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('modal_registrar_')) {
      await interaction.deferReply({ ephemeral: true });

      const rawSteamInput = interaction.fields.getTextInputValue('input_steam').trim();
      const rawFaceitInput = interaction.fields.getTextInputValue('input_faceit').trim();
      const rawGcInput = interaction.fields.getTextInputValue('input_gc').trim();

      const linkFaceit = rawFaceitInput !== '' ? rawFaceitInput : 'N/A';
      const linkGc = rawGcInput !== '' ? rawGcInput : 'N/A';

      const discordId = interaction.customId.replace('modal_registrar_', '');
      const targetMember = discordId === interaction.user.id
        ? interaction.member
        : await interaction.guild.members.fetch(discordId).catch(() => null);
      const nickDiscord = targetMember ? targetMember.displayName : discordId;
      const avatarUrl = targetMember ? targetMember.user.displayAvatarURL({ dynamic: true }) : interaction.user.displayAvatarURL({ dynamic: true });

      let steamid64 = rawSteamInput;
      const match = rawSteamInput.match(/\d{17}/);
      if (match) steamid64 = match[0];

      if (!/^\d{17}$/.test(steamid64)) {
        return interaction.editReply({
          content: '<:trupe_erro:1536410911617843322> **SteamID64 inválido!** Insira o número de 17 dígitos (ex: `76561198012345678`) ou o link direto do perfil da Steam.'
        });
      }

      try {
        const sheet = await getSheet('Jogadores');
        const rows = await sheet.getRows();

        const existingRow = rows.find(r => r.get('discord_id') === discordId);
        let acaoTexto = '';

        if (existingRow) {
          existingRow.set('steamid64', steamid64);
          existingRow.set('discord_nick', nickDiscord);
          if (linkFaceit !== 'N/A') existingRow.set('link_faceit', linkFaceit);
          if (linkGc !== 'N/A') existingRow.set('link_gc', linkGc);
          await existingRow.save();
          acaoTexto = 'Seus dados foram **atualizados** com sucesso no banco do Mix!';
        } else {
          await sheet.addRow({
            'discord_id': discordId,
            'discord_nick': nickDiscord,
            'steamid64': steamid64,
            'rank_trupe': 'C',
            'elo': '1000',
            'matchs': '0',
            'wins': '0',
            'kills': '0',
            'deaths': '0',
            'assists': '0',
            'head_shot_kills': '0',
            'damage': '0',
            'kast': '0',
            'Advertências': '0',
            'Punições': '0',
            'Banido_Até': '',
            'Banido_Temporada': '',
            'link_faceit': linkFaceit,
            'link_gc': linkGc
          });
          acaoTexto = `Bem-vindo ao Mix, <@${discordId}>! Seu perfil foi vinculado com sucesso.`;
        }

        invalidarRegistroCache();

        const embedRegistro = new EmbedBuilder()
          .setTitle('<:trupe_teia:1536412408203976888> Cadastro Concluído no Mix Trupe!')
          .setColor(CORES.SUCESSO)
          .setDescription(acaoTexto)
          .setThumbnail(avatarUrl)
          .addFields(
            { name: '👤 Jogador', value: `${nickDiscord}`, inline: true },
            { name: '🆔 SteamID64', value: `\`${steamid64}\``, inline: true },
            { name: '🌐 FACEIT', value: linkFaceit, inline: false },
            { name: '🎮 Gamers Club', value: linkGc, inline: false }
          )
          .setFooter({ 
            text: 'Mix Trupe CS2 • Cadastro de Perfil Integrado', 
            iconURL: interaction.guild?.iconURL() || undefined
          })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embedRegistro] });

      } catch (error) {
        console.error('Erro ao registrar via modal:', error);
        return await interaction.editReply({
          content: '<:trupe_aviso:1536410370829328434> Erro ao salvar na planilha. Verifique as permissões da Service Account.'
        });
      }
    }
  }
}

// Usado pelo roteador novo (events/interactionCreate.js) pra mostrar a mesma mensagem de trava
// de cadastro em qualquer comando modular com exigeRegistro !== false (a maioria).
function responderTravaDeRegistro(interaction) {
  const embedTrava = new EmbedBuilder()
    .setTitle('<:trupe_bloqueado:1536410479273185330> Acesso Negado!')
    .setColor(CORES.ERRO)
    .setDescription(
      `Olá <@${interaction.user.id}>! Para utilizar qualquer comando do bot e participar do **Mix Trupe**, você precisa vincular o seu **SteamID64** primeiro.\n\n` +
      `👉 Execute o comando abaixo para abrir o formulário de cadastro:\n` +
      `\`\`\`\n/registrar\n\`\`\``
    )
    .setFooter({ text: 'Sistema de Proteção e Estatísticas do Mix Trupe' });

  return interaction.reply({ embeds: [embedTrava], ephemeral: true });
}

module.exports = {
  execute: executarRoteadorLegado,
  jogadorEstaRegistrado,
  invalidarRegistroCache,
  responderTravaDeRegistro,
};
