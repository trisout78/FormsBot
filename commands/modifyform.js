const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modifyform')
    .setDescription('Modifier un formulaire existant')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'Vous n\'avez pas la permission de modifier des formulaires.', ephemeral: true });
    }
    
    const guildForms = client.forms[interaction.guildId] || {};
    const keys = Object.keys(guildForms);
    if (!keys.length) {
      return interaction.reply({ content: 'Aucun formulaire trouvé.', ephemeral: true });
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('modifyform_select')
      .setPlaceholder('Sélectionnez un formulaire à modifier')
      .addOptions(
        keys.map(id => ({ label: guildForms[id].title || id, value: id }))
      );
    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ content: 'Choisissez un formulaire à modifier :', components: [row], ephemeral: true });
  }
};