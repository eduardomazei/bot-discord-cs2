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
// Usada só pelo texto de "Mecânicas do Bot" do select_regras.
const { PONTOS_POR_PUNICAO } = require('../utils/advertencias');
// jogadorEstaRegistrado/invalidarRegistroCache continuam exportados daqui embaixo -- usados por
// events/interactionCreate.js (trava de registro dos comandos modulares) e pelo modal de
// /registrar (invalidarRegistroCache, logo após gravar um cadastro novo).
const { jogadorEstaRegistrado, invalidarRegistroCache } = require('../services/registroService');
// Onboarding gate (docs/plans/) -- verificarEDesbloquear roda depois de CADA um dos dois passos
// (registro OU concordo), em qualquer ordem, pra liberar acesso ao resto do servidor.
const { verificarEDesbloquear } = require('../utils/onboarding');
const regrasAceitasStore = require('../state/regrasAceitasStore');
const { construirModalRegistro } = require('../utils/modalRegistro');

async function executarRoteadorLegado(interaction) {


  // ==========================================
  // 0. PROCESSAMENTO DE MENUS DE SELEÇÃO (SELECT MENU)
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_regras') {
      const opcao = interaction.values[0];

      // Regras oficiais do servidor (17 seções) -- agrupadas em 5 categorias temáticas pra caber
      // no limite de caracteres de um TextDisplay (Components V2), mantendo a numeração original
      // de cada seção como sub-título (pra continuar batendo com o texto que a Staff usa quando
      // cita "regra 11" etc). "Mecânicas do Bot" é uma 6ª categoria à parte -- Elo/presença/
      // advertência não são regras de conduta que alguém "concorda" ao clicar no botão, são só
      // como o bot funciona, mas ficam aqui porque também é informação que a galera nova procura.
      const CATEGORIAS_REGRAS = {
        regras_respeito: {
          titulo: '<:trupe_teia:1536412408203976888> Respeito e Convivência',
          cor: CORES.ERRO,
          corpo: [
            '**1. Respeito acima de tudo**',
            'Todos os membros devem ser tratados com respeito, independentemente de amizade, habilidade, cargo ou tempo de participação na comunidade. Não serão tolerados:',
            '• Racismo, xenofobia, homofobia ou qualquer forma de discriminação',
            '• Assédio, perseguição ou intimidação',
            '• Ameaças, humilhações ou ataques pessoais',
            '• Comentários ofensivos sobre aparência, origem, gênero, religião ou condição pessoal',
            '• Incentivo ao ódio ou à violência',
            'Brincadeiras são permitidas, desde que todos os envolvidos estejam confortáveis e sem ultrapassar os limites do respeito.',
            '',
            '**2. Linguagem e comportamento**',
            'Discussões, opiniões diferentes e rivalidade competitiva são permitidas, desde que civilizadas. É proibido:',
            '• Provocar outros membros de forma excessiva',
            '• Criar discussões com o objetivo de causar confusão',
            '• Insistir numa provocação depois que a pessoa pediu pra parar',
            '• Usar palavrões pra atacar ou humilhar alguém',
            '• Praticar toxicidade constante nos canais',
            'A Staff pode interromper qualquer discussão que esteja prejudicando o ambiente da comunidade.',
            '',
            '**6. Nome, foto e perfil**',
            'O membro deve usar um nome que permita sua identificação na comunidade. Não são permitidos:',
            '• Nomes ofensivos ou discriminatórios',
            '• Fotos de perfil com conteúdo sexual ou inadequado',
            '• Perfis que imitem membros da Staff',
            '• Nomes usados pra confundir, provocar ou prejudicar outros participantes',
            '• Símbolos ou referências a movimentos de ódio',
            'A Staff pode solicitar a alteração do nome, apelido ou foto de perfil.',
          ].join('\n'),
        },
        regras_conteudo: {
          titulo: '<:trupe_teia:1536412408203976888> Conteúdo, Spam e Divulgação',
          cor: CORES.ERRO,
          corpo: [
            '**3. Conteúdo proibido**',
            'É terminantemente proibido publicar, enviar ou divulgar:',
            '• Pornografia ou conteúdo sexual explícito',
            '• Conteúdo envolvendo violência extrema',
            '• Material preconceituoso ou discriminatório',
            '• Vírus, arquivos suspeitos ou links maliciosos',
            '• Golpes, fraudes ou tentativas de enganar membros',
            '• Conteúdo ilegal',
            '• Imagens ou vídeos usados pra constranger outra pessoa',
            'Conteúdos inadequados podem ser removidos imediatamente, mesmo que não estejam descritos exatamente aqui.',
            '',
            '**4. Spam, flood e menções**',
            'Não é permitido:',
            '• Enviar a mesma mensagem repetidamente',
            '• Usar letras, símbolos ou emojis em excesso',
            '• Fazer menções repetidas a membros ou cargos',
            '• Marcar a Staff sem necessidade',
            '• Enviar comandos de bots fora dos canais apropriados',
            '• Entrar e sair repetidamente de canais de voz pra causar incômodo',
            '• Usar efeitos sonoros de forma excessiva',
            '',
            '**5. Divulgação e publicidade**',
            'Divulgar outros servidores, comunidades, campeonatos, redes sociais, canais, produtos ou serviços depende de autorização prévia da Staff. Divulgação por mensagem privada usando membros encontrados aqui também é proibida. Links pessoais podem ser compartilhados nos canais apropriados, desde que não virem spam/publicidade abusiva.',
          ].join('\n'),
        },
        regras_privacidade: {
          titulo: '<:trupe_teia:1536412408203976888> Contas, Privacidade e Segurança',
          cor: CORES.AVISO,
          corpo: [
            '**7. Contas secundárias**',
            'Usar contas alternativas pra obter vantagens, participar mais de uma vez, fugir de punições ou esconder a própria identidade é proibido. Se uma conta secundária for necessária por motivo legítimo, avise a Staff antecipadamente. Contas usadas pra escapar de punição podem ser banidas junto com a principal.',
            '',
            '**8. Privacidade e segurança**',
            'Não compartilhe informações pessoais de outros membros sem autorização. É proibido divulgar:',
            '• Número de telefone',
            '• Endereço residencial',
            '• Documentos',
            '• Fotografias privadas',
            '• Conversas particulares',
            '• Dados de acesso',
            '• Informações bancárias',
            '• Qualquer conteúdo que possa colocar uma pessoa em risco',
            '',
            '**12. Imagens, áudios e gravações**',
            'Ao participar de canais públicos, transmissões ou eventos da TRUPE, você reconhece que sua voz, nome de usuário, gameplay ou mensagens podem aparecer em conteúdos da comunidade. Ainda assim, é proibido usar gravações pra humilhar um participante, expor conversas privadas, criar acusações falsas, prejudicar a imagem de alguém ou publicar informações pessoais. Em denúncias, gravações podem ser enviadas de forma privada à Staff como prova.',
          ].join('\n'),
        },
        regras_canais_jogos: {
          titulo: '<:trupe_teia:1536412408203976888> Canais e Conduta nos Jogos/MIX',
          cor: CORES.INFO,
          corpo: [
            '**9. Canais de texto**',
            'Cada canal tem uma finalidade e deve ser usado corretamente: publique mensagens relacionadas ao tema do canal, use comandos só nos locais indicados, evite conversa paralela em canais de avisos, não atrapalhe inscrições/enquetes/comunicados oficiais e respeite mensagens fixadas. Mensagens no lugar errado podem ser removidas ou transferidas.',
            '',
            '**10. Canais de voz**',
            'Não é permitido:',
            '• Gritar propositalmente',
            '• Usar modificadores de voz pra incomodar',
            '• Reproduzir músicas ou sons sem autorização',
            '• Interromper constantemente outras pessoas',
            '• Entrar em canais privados sem permissão',
            '• Causar ruído excessivo',
            '• Gravar ou transmitir conversas privadas sem consentimento',
            'Durante os MIX, os jogadores devem permanecer nos canais definidos pra suas equipes.',
            '',
            '**11. Conduta nos jogos e MIX**',
            'Além das regras do servidor, os participantes devem preservar a integridade das partidas organizadas pela TRUPE. É proibido:',
            '• Usar cheats, scripts ou programas ilegais',
            '• Compartilhar conta',
            '• Receber informações de espectadores',
            '• Praticar stream sniping',
            '• Entregar partidas ou rounds propositalmente',
            '• Abandonar uma partida sem justificativa',
            '• Sabotar o próprio time',
            '• Combinar resultados',
            '• Explorar bugs intencionalmente',
            '• Desrespeitar adversários, capitães ou administradores',
            'Infrações durante os jogos também podem gerar punições dentro do Discord.',
          ].join('\n'),
        },
        regras_staff_punicoes: {
          titulo: '<:trupe_teia:1536412408203976888> Denúncias, Staff e Punições',
          cor: CORES.ERRO,
          corpo: [
            '**13. Denúncias**',
            'Trate problemas e denúncias por ticket ou mensagem privada com a equipe responsável. Envie, se possível: nome dos envolvidos, data/horário aproximado, explicação do ocorrido, prints/vídeos/gravações e links das mensagens. Evite acusação pública ou discussão no servidor -- denúncias falsas ou manipuladas também podem ser punidas.',
            '',
            '**14. Staff e decisões administrativas**',
            'As orientações da Staff devem ser respeitadas durante a análise de uma situação. Discordou de uma decisão? Abra um ticket e apresente seu ponto de vista com respeito. É proibido ofender membros da Staff, criar tumulto por causa de uma punição, pressionar administradores em DM ou usar amizade/cargo pra pedir tratamento diferente. A Staff também está sujeita às regras.',
            '',
            '**15. Punições**',
            'Aplicadas conforme a gravidade da infração, o histórico do membro e a reincidência: orientação, advertência, remoção de mensagem, silenciamento temporário, remoção de canal de voz, suspensão de atividades/MIX, expulsão, banimento temporário ou permanente. Infrações graves podem resultar em banimento imediato, sem advertência prévia.',
            '',
            '**16. Tentativa de burlar as regras**',
            'Explorar brechas, manipular situações ou alegar que algo "não estava escrito" não impede a punição. A Staff pode agir diante de qualquer comportamento que prejudique a segurança dos membros, a organização do servidor, a integridade dos campeonatos ou a imagem da TRUPE.',
            '',
            '**17. Alterações no regulamento**',
            'As regras podem ser atualizadas quando necessário -- mudanças importantes são comunicadas nos canais oficiais. Permanecer no servidor após uma atualização representa aceitação das novas regras.',
          ].join('\n'),
        },
        regras_mecanicas_bot: {
          titulo: '<:trupe_teia:1536412408203976888> Mecânicas do Bot (Elo, Presença)',
          cor: CORES.NEUTRO,
          corpo: [
            '**Elo e Rank**',
            'Todos os jogadores começam com **1000 de Elo**. A variação por partida escala com o seu **KD daquela partida específica**: vitória vai de **+10** (KD baixo) a **+40** (KD alto); derrota vai de **-30** a **-5** no mesmo sentido -- jogar bem numa derrota pesa menos, só "pegar carona" numa vitória rende menos. Use `/rank` pra ver seu rank atual (E a SS) e o que falta pro próximo.',
            '',
            '**Presença e Servidores**',
            'Apenas jogadores cadastrados via `/registrar` podem confirmar presença com `/presenca confirmar`. Assim que a lista atinge as vagas definidas em `/presenca criar`, os capitães iniciam o veto com `/pick`. Use o comando `connect` exibido em `/server` pra entrar no servidor do CS2.',
            '',
            '**Advertências e Punições do Mix**',
            `Faltar após confirmar presença gera advertência automática via \`/ausente\` (1 ponto). Advertências valem 1 a 3 pontos conforme o tipo; a cada **${PONTOS_POR_PUNICAO} pontos** acumulados o jogador recebe 1 punição automática -- a **1ª** bloqueia \`/presenca confirmar\` por **1 semana**, a **2ª** bane do Mix até o **fim da temporada**.`,
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
  // 0.5 PROCESSAMENTO DE BOTÕES (BUTTON)
  // ==========================================
  if (interaction.isButton()) {
    // Botão "Cadastrar agora" no #registro -- mesmo modal do /registrar, só que sem precisar
    // digitar o comando. Sempre auto-cadastro (quem clica cadastra a si mesmo); a opção de
    // cadastrar OUTRA pessoa continua exclusiva do /registrar usuario:<alvo> (checagem de admin).
    if (interaction.customId === 'abrir_registro') {
      const modal = construirModalRegistro(interaction.user.id, null);
      return await interaction.showModal(modal);
    }

    // Botão "Eu li e concordo com as regras" no #regras -- ver utils/onboarding.js pro
    // desbloqueio de verdade (só acontece quando os dois passos, registro + concordo, batem).
    if (interaction.customId === 'regras_concordo') {
      await interaction.deferReply({ ephemeral: true });

      try {
        regrasAceitasStore.marcarAceito(interaction.user.id);

        const liberado = await verificarEDesbloquear(interaction.member);

        return await interaction.editReply({
          content: liberado
            ? '<:trupe_sucesso:1536412279778574356> **Regras aceitas!** Seu acesso ao servidor foi liberado.'
            : '<:trupe_sucesso:1536412279778574356> **Regras aceitas!** Falta só completar o cadastro com `/registrar` (ou o botão em <#' + (process.env.CANAL_REGISTRO_ID || '') + '>) pra liberar o resto do servidor.'
        });
      } catch (err) {
        console.error('Erro ao processar "Concordo com as regras":', err);
        return await interaction.editReply({
          content: '<:trupe_aviso:1536410370829328434> Erro ao registrar sua confirmação. Tente de novo em alguns segundos.'
        });
      }
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

        // Onboarding gate: se essa pessoa já tinha clicado "Concordo" antes de registrar, o
        // registro agora é o segundo dos dois passos -- libera o acesso ao resto do servidor.
        // targetMember é null se o admin cadastrou alguém que não está mais no servidor; nesse
        // caso não tem cargo pra tirar mesmo, então liberado fica false sem gerar erro.
        const liberado = await verificarEDesbloquear(targetMember);

        const embedRegistro = new EmbedBuilder()
          .setTitle('<:trupe_teia:1536412408203976888> Cadastro Concluído no Mix Trupe!')
          .setColor(CORES.SUCESSO)
          .setDescription(
            acaoTexto + (liberado
              ? '\n\n<:trupe_sucesso:1536412279778574356> Seu acesso ao resto do servidor foi liberado!'
              : '\n\n<:trupe_aviso:1536410370829328434> Falta clicar em **"Eu li e concordo com as regras"** no canal de regras pra liberar o resto do servidor.')
          )
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
