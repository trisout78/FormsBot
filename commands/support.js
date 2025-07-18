const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { config } = require('../utils/config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('🆘 Besoin d\'aide ? Rejoignez notre serveur de support !'),
  
  async execute(interaction, client) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('🆘 Serveur de Support MyForm')
        .setDescription('Vous avez besoin d\'aide avec MyForm ? Notre équipe de support est là pour vous aider !')
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          {
            name: '💬 Support disponible',
            value: '• **Aide technique** et résolution de problèmes\n• **Assistance** pour la création de formulaires\n• **Suggestions** et retours d\'expérience\n• **Annonces** des nouvelles fonctionnalités',
            inline: false
          },
          {
            name: '⏰ Temps de réponse',
            value: 'Généralement sous **24 heures**',
            inline: true
          },
          {
            name: '🌍 Langue',
            value: 'Support en **français**',
            inline: true
          },
          {
            name: '📋 Avant de demander de l\'aide',
            value: '• Décrivez clairement votre problème\n• Précisez les étapes pour reproduire le bug\n• Joignez des captures d\'écran si possible',
            inline: false
          }
        )
        .setFooter({ 
          text: 'MyForm • Support communautaire', 
          iconURL: client.user.displayAvatarURL() 
        })
        .setTimestamp();

      // Créer le bouton de support
      const supportButton = new ButtonBuilder()
        .setLabel('🆘 Rejoindre le Support')
        .setStyle(ButtonStyle.Link)
        .setURL(config.supportServer?.inviteUrl || 'https://discord.gg/your-support-server')
        .setEmoji('🆘');

      // Créer le bouton pour la documentation (optionnel)
      const docsButton = new ButtonBuilder()
        .setLabel('📚 Documentation')
        .setStyle(ButtonStyle.Link)
        .setURL(`${config.webserver.baseUrl}/`)
        .setEmoji('📚');

      const row = new ActionRowBuilder()
        .addComponents(supportButton, docsButton);

      await interaction.reply({
        embeds: [embed],
        components: [row]
      });

    } catch (error) {
      console.error('Erreur dans la commande support:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de l\'affichage du support. Veuillez réessayer.')
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true
      });
    }
  }
};
