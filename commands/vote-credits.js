const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote-credits')
    .setDescription('🗳️ Vérifiez vos crédits IA obtenus par les votes'),
  
  async execute(interaction, client) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Récupérer les crédits de vote de l'utilisateur
      const { getUserVoteCredits } = require('../web/routes/webhooks.js');
      const voteCredits = getUserVoteCredits(interaction.user.id);
      
      // Calculer les requêtes IA possibles avec les crédits
      const aiRequestsFromCredits = Math.floor(voteCredits); // 1 crédit = 1 requête IA
      
      const embed = new EmbedBuilder()
        .setTitle('🗳️ Vos Crédits de Vote')
        .setColor(0x00D4AA)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      if (voteCredits > 0) {
        embed.setDescription(`Vous avez **${voteCredits} crédit${voteCredits > 1 ? 's' : ''} de vote** !`)
          .addFields(
            {
              name: '🤖 Requêtes IA disponibles',
              value: `**${aiRequestsFromCredits}** requêtes supplémentaires`,
              inline: true
            },
            {
              name: '⚡ Fonctionnement',
              value: 'Chaque requête IA consomme **1 crédit**',
              inline: true
            },
            {
              name: '📊 Utilisation',
              value: 'Ces crédits s\'utilisent automatiquement quand vous dépassez vos limites IA normales',
              inline: false
            },
            {
              name: '🔄 Comment en obtenir plus ?',
              value: '• Votez sur **Top.gg** (1 crédit/vote, 2 en weekend)\n• Votez toutes les 12 heures\n• Crédits valables sur **tous les serveurs**',
              inline: false
            }
          );
      } else {
        embed.setDescription('Vous n\'avez actuellement aucun crédit de vote.')
          .addFields(
            {
              name: '🎁 Comment obtenir des crédits ?',
              value: 'Votez pour **MyForm** sur Top.gg pour recevoir des crédits IA !',
              inline: false
            },
            {
              name: '⭐ Récompenses',
              value: '• **0.5 crédit** par vote normal\n• **1 crédit** pendant les weekends\n• Vote possible toutes les **12 heures**',
              inline: true
            },
            {
              name: '🌟 Avantages',
              value: '• Crédits **globaux** (utilisables sur tous les serveurs)\n• **1 requête IA** par crédit\n• **Aucune expiration**',
              inline: true
            },
            {
              name: '🔗 Voter maintenant',
              value: '[Cliquez ici pour voter sur Top.gg](https://top.gg/bot/' + client.user.id + '/vote)',
              inline: false
            }
          );
      }

      embed.setFooter({ 
        text: 'Les crédits de vote sont un bonus en plus de vos limites normales !',
        iconURL: client.user.displayAvatarURL()
      });

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('Erreur lors de la vérification des crédits de vote:', error);
      
      const errorMessage = 'Erreur lors de la récupération de vos crédits de vote.';
      
      if (interaction.deferred) {
        await interaction.editReply({
          content: errorMessage,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      }
    }
  }
};
