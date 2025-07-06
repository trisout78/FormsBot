const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs-extra');
const { logToWebhookAndConsole } = require('../utils/logger.js');

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
      return interaction.reply({ content: 'Aucun formulaire trouvé sur ce serveur.', ephemeral: true });
    }
    
    const menu = new StringSelectMenuBuilder()
      .setCustomId('deleteform_select')
      .setPlaceholder('Sélectionnez un formulaire à supprimer')
      .addOptions(
        keys.slice(0, 25).map(id => ({
          label: guildForms[id].title || `Formulaire ${id}`,
          value: id,
          description: `${guildForms[id].questions.length} questions - ID: ${id}`
        }))
      );
    
    const row = new ActionRowBuilder().addComponents(menu);
    
    await interaction.reply({ 
      content: '⚠️ **Attention**: La suppression d\'un formulaire est irréversible!\n\nChoisissez un formulaire à supprimer:', 
      components: [row], 
      ephemeral: true 
    });
    
    // Créer un collecteur pour la sélection du formulaire
    const filter = i => i.customId === 'deleteform_select' && i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });
    
    collector.on('collect', async i => {
      const formId = i.values[0];
      const form = guildForms[formId];
      
      // Créer l'embed de confirmation
      const confirmEmbed = new EmbedBuilder()
        .setTitle('🗑️ Confirmation de suppression')
        .setDescription(`Êtes-vous sûr de vouloir supprimer ce formulaire?\n\n**Cette action est irréversible!**`)
        .addFields(
          { name: '📋 Formulaire', value: form.title, inline: true },
          { name: '❓ Questions', value: form.questions.length.toString(), inline: true },
          { name: '🆔 ID', value: formId, inline: true },
          { name: '📝 Réponses', value: Object.keys(form.respondents || {}).length.toString(), inline: true }
        )
        .setColor(0xED4245)
        .setFooter({ text: 'Cette action supprimera définitivement le formulaire et toutes ses données.' });
      
      const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_delete_${formId}`)
        .setLabel('🗑️ Supprimer définitivement')
        .setStyle(ButtonStyle.Danger);
      
      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_delete')
        .setLabel('❌ Annuler')
        .setStyle(ButtonStyle.Secondary);
      
      const confirmRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
      
      await i.update({ 
        content: '', 
        embeds: [confirmEmbed], 
        components: [confirmRow] 
      });
      
      // Créer un collecteur pour la confirmation
      const confirmFilter = ci => 
        (ci.customId === `confirm_delete_${formId}` || ci.customId === 'cancel_delete') && 
        ci.user.id === interaction.user.id;
      
      const confirmCollector = interaction.channel.createMessageComponentCollector({ 
        filter: confirmFilter, 
        time: 30000, 
        max: 1 
      });
      
      confirmCollector.on('collect', async ci => {
        if (ci.customId === 'cancel_delete') {
          await ci.update({
            content: '❌ Suppression annulée.',
            embeds: [],
            components: []
          });
          return;
        }
        
        if (ci.customId === `confirm_delete_${formId}`) {
          try {
            // Supprimer le message embed si il existe
            if (form.embedMessageId && form.embedChannelId) {
              try {
                const embedChannel = await client.channels.fetch(form.embedChannelId);
                const embedMessage = await embedChannel.messages.fetch(form.embedMessageId);
                await embedMessage.delete();
              } catch (error) {
                console.log(`Message embed non trouvé ou déjà supprimé: ${error.message}`);
              }
            }
            
            // Supprimer le formulaire des données
            delete client.forms[interaction.guildId][formId];
            
            // Sauvegarder les changements
            await fs.writeJson(client.formsPath, client.forms, { spaces: 2 });
            
            // Log de la suppression
            await logToWebhookAndConsole(
              "🗑️ Formulaire supprimé",
              `**${interaction.user.username}** a supprimé le formulaire "${form.title}"`,
              [
                { name: "Formulaire", value: form.title, inline: true },
                { name: "ID", value: formId, inline: true },
                { name: "Questions", value: form.questions.length.toString(), inline: true },
                { name: "Réponses", value: Object.keys(form.respondents || {}).length.toString(), inline: true },
                { name: "Serveur", value: interaction.guild.name, inline: false },
                { name: "Supprimé par", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: false }
              ],
              0xED4245
            );
            
            const successEmbed = new EmbedBuilder()
              .setTitle('✅ Formulaire supprimé')
              .setDescription(`Le formulaire **"${form.title}"** a été supprimé avec succès.`)
              .addFields(
                { name: 'Actions effectuées', value: '• Formulaire supprimé des données\n• Message embed supprimé (si applicable)\n• Toutes les réponses supprimées', inline: false }
              )
              .setColor(0x57F287);
            
            await ci.update({
              content: '',
              embeds: [successEmbed],
              components: []
            });
            
          } catch (error) {
            console.error('Erreur lors de la suppression du formulaire:', error);
            
            const errorEmbed = new EmbedBuilder()
              .setTitle('❌ Erreur')
              .setDescription('Une erreur est survenue lors de la suppression du formulaire.')
              .setColor(0xED4245);
            
            await ci.update({
              content: '',
              embeds: [errorEmbed],
              components: []
            });
          }
        }
      });
      
      confirmCollector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({ 
            content: '⏰ Temps écoulé. Suppression annulée.', 
            embeds: [], 
            components: [] 
          }).catch(() => {});
        }
      });
    });
    
    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({ 
          content: '⏰ Temps écoulé. Utilisez à nouveau la commande pour supprimer un formulaire.', 
          components: [] 
        }).catch(() => {});
      }
    });
  }
};