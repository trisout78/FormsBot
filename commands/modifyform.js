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
      .setCustomId('formSelect')
      .setPlaceholder('Sélectionnez un formulaire')
      .addOptions(keys.map(formId => ({
        label: guildForms[formId].title || `Formulaire ${formId}`,
        value: formId
      })));
    
    const row = new ActionRowBuilder().addComponents(menu);
    
    await interaction.reply({ 
      content: 'Sélectionnez le formulaire que vous souhaitez modifier:',
      components: [row],
      ephemeral: true 
    });
    
    // Créer un collecteur pour la sélection du formulaire
    const filter = i => i.customId === 'formSelect' && i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });
    
    collector.on('collect', async i => {
      const formId = i.values[0];
      const guildId = interaction.guildId;
      
      // Construire l'URL pour l'édition du formulaire
      const editUrl = `${config.webserver.baseUrl}/edit/${guildId}/${formId}`;
      
      const embed = new EmbedBuilder()
        .setTitle('Modification de formulaire')
        .setDescription(`Cliquez sur le lien ci-dessous pour modifier votre formulaire. Vous serez redirigé vers la page d'authentification Discord si nécessaire.\n\n**[Modifier le formulaire](${editUrl})**`)
        .setColor('#3498db');
      
      await i.update({ content: null, embeds: [embed], components: [] });
    });
    
    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({ content: 'Sélection expirée. Veuillez réessayer la commande.', components: [], ephemeral: true }).catch(() => {});
      }
    });
  }
};