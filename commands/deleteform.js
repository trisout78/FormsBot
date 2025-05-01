const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deleteform')
    .setDescription('Supprimer un formulaire existant'),

  async execute(interaction, client) {
    const guildForms = client.forms[interaction.guildId] || {};
    const keys = Object.keys(guildForms);
    if (!keys.length) {
      return interaction.reply({ content: 'Aucun formulaire trouvé.', ephemeral: true });
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('deleteform_select')
      .setPlaceholder('Sélectionnez un formulaire à supprimer')
      .addOptions(
        keys.map(id => ({
          label: guildForms[id].title || id,
          value: id,
          description: `${guildForms[id].questions.length} questions`
        }))
      );
    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ content: 'Choisissez un formulaire à supprimer :', components: [row], ephemeral: true });
  }
};