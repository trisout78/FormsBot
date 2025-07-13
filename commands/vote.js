const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('🗳️ Votez pour MyForm sur Top.gg et gagnez des crédits IA !'),
  
  async execute(interaction, client) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Votez pour MyForm sur Top.gg !')
        .setDescription('Soutenez MyForm en votant sur Top.gg et recevez des **crédits IA gratuits** !')
        .setColor(0x00D4AA)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          {
            name: '🎁 Récompenses de vote',
            value: '• **0.5 crédit IA** par vote normal\n• **1 crédit IA** pendant les weekends\n• **1 crédit = 1 requête IA** supplémentaire',
            inline: false
          },
          {
            name: '⏰ Fréquence',
            value: 'Vous pouvez voter **toutes les 12 heures**',
            inline: true
          },
          {
            name: '🌍 Portée',
            value: 'Crédits utilisables sur **tous les serveurs**',
            inline: true
          },
          {
            name: '🤖 Comment ça marche ?',
            value: 'Quand vous dépassez vos limites IA normales (3/jour gratuit, 20/heure premium), vos crédits de vote s\'utilisent automatiquement !',
            inline: false
          },
          {
            name: '⚡ Exemple concret',
            value: 'Si vous êtes utilisateur gratuit (3 IA/jour) et avez 1 crédit de vote, vous pourrez faire **4 requêtes IA** au total !',
            inline: false
          }
        )
        .setFooter({ 
          text: 'Merci de soutenir MyForm ! 💙',
          iconURL: interaction.guild?.iconURL() || client.user.displayAvatarURL()
        })
        .setTimestamp();

      // Bouton pour voter
      const voteButton = new ButtonBuilder()
        .setLabel('🗳️ Voter sur Top.gg')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://top.gg/bot/${client.user.id}/vote`);

      // Bouton pour vérifier les crédits
      const creditsButton = new ButtonBuilder()
        .setCustomId('check_vote_credits')
        .setLabel('Mes crédits')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('💰');

      const row = new ActionRowBuilder().addComponents(voteButton, creditsButton);

      await interaction.reply({
        embeds: [embed],
        components: [row]
      });

    } catch (error) {
      console.error('Erreur lors de l\'affichage de la commande vote:', error);
      
      await interaction.reply({
        content: 'Une erreur est survenue lors de l\'affichage des informations de vote.',
        ephemeral: true
      });
    }
  }
};
