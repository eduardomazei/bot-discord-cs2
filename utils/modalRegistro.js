// Modal de cadastro (/registrar) -- extraído pra cá pra ser reaproveitado pelo botão
// "Cadastrar agora" do canal #registro (customId abrir_registro, tratado em
// legacy/interactionRouter.js), sem duplicar os TextInputBuilder em dois arquivos.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

/**
 * @param {string} targetId - discord_id de quem está sendo cadastrado (vira parte do customId
 *   do modal, pra o handler de submit em legacy/interactionRouter.js saber quem gravar).
 * @param {string|null} nomeExibicao - nome pra aparecer no título quando um admin cadastra OUTRA
 *   pessoa (via /registrar usuario:<alvo>). null/undefined = auto-cadastro (título genérico).
 */
function construirModalRegistro(targetId, nomeExibicao) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_registrar_${targetId}`)
    .setTitle(nomeExibicao ? `Cadastro de Jogador — ${nomeExibicao}` : 'Cadastro de Jogador — Mix Trupe');

  const inputSteam = new TextInputBuilder()
    .setCustomId('input_steam')
    .setLabel('🎮 SteamID64 ou Link do Perfil Steam')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: 76561198012345678 ou steamcommunity.com/id/seu_nick')
    .setMinLength(5)
    .setMaxLength(100)
    .setRequired(true);

  const inputFaceit = new TextInputBuilder()
    .setCustomId('input_faceit')
    .setLabel('🌐 Perfil FACEIT (Opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: faceit.com/pt/players/SeuNick')
    .setMaxLength(100)
    .setRequired(false);

  const inputGc = new TextInputBuilder()
    .setCustomId('input_gc')
    .setLabel('⚡ Perfil Gamers Club (Opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: gamersclub.com.br/player/12345')
    .setMaxLength(100)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputSteam),
    new ActionRowBuilder().addComponents(inputFaceit),
    new ActionRowBuilder().addComponents(inputGc)
  );

  return modal;
}

module.exports = { construirModalRegistro };
