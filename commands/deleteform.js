const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deleteform')
    .setDescription('Supprimer un formulaire existant')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'Vous n\'avez pas la permission de supprimer des formulaires.', ephemeral: true });
    }

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