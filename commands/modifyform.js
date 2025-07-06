const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { config } = require('../utils/config.js');

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
      const selectedForm = guildForms[formId];
      
      // Construire l'URL pour l'édition du formulaire
      const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
      const editUrl = `${baseUrl}/edit/${guildId}/${formId}`;
      
      const embed = new EmbedBuilder()
        .setTitle('🖊️ Modification de formulaire')
        .setDescription(`Cliquez sur le lien ci-dessous pour modifier votre formulaire **"${selectedForm.title}"**.\n\nVous serez redirigé vers la page d'authentification Discord si nécessaire.`)
        .addFields(
          { name: '📋 Formulaire', value: selectedForm.title, inline: true },
          { name: '❓ Questions', value: selectedForm.questions.length.toString(), inline: true },
          { name: '🆔 ID', value: formId, inline: true }
        )
        .setColor(0x3498db)
        .setFooter({ text: 'Cliquez sur le lien pour accéder à l\'interface de modification' });
      
      const linkButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🖊️ Modifier le formulaire')
          .setStyle(ButtonStyle.Link)
          .setURL(editUrl)
      );
      
      await i.update({ 
        content: '', 
        embeds: [embed], 
        components: [linkButton] 
      });
    });
    
    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({ content: 'Sélection expirée. Veuillez réessayer la commande.', components: [], ephemeral: true }).catch(() => {});
      }
    });
  }
};