const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Gérer la blacklist des utilisateurs pour les formulaires')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à ajouter/retirer de la blacklist')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('utilisateur');
    
    // Vérifier si le serveur est premium
    const isPremium = client.premiumGuilds && client.premiumGuilds.includes(guildId);
    if (!isPremium) {
      return interaction.reply({ 
        content: '❌ Cette commande est réservée aux serveurs premium. Passez en premium pour accéder à cette fonctionnalité.', 
        ephemeral: true 
      });
    }

    // Vérifier les permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ 
        content: '❌ Vous n\'avez pas la permission de gérer la blacklist.', 
        ephemeral: true 
      });
    }

    // Empêcher l'auto-blacklist
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ 
        content: '❌ Vous ne pouvez pas vous blacklister vous-même.', 
        ephemeral: true 
      });
    }

    // Empêcher de blacklister des bots
    if (targetUser.bot) {
      return interaction.reply({ 
        content: '❌ Vous ne pouvez pas blacklister un bot.', 
        ephemeral: true 
      });
    }

    try {
      // Charger la blacklist actuelle
      const blacklist = client.loadBlacklist();
      
      // Initialiser la blacklist du serveur si elle n'existe pas
      if (!blacklist[guildId]) {
        blacklist[guildId] = [];
      }

      const isBlacklisted = blacklist[guildId].includes(targetUser.id);
      
      if (isBlacklisted) {
        // Retirer de la blacklist
        blacklist[guildId] = blacklist[guildId].filter(userId => userId !== targetUser.id);
        client.saveBlacklist(blacklist);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Utilisateur retiré de la blacklist')
          .setDescription(`${targetUser.tag} peut maintenant répondre aux formulaires de ce serveur.`)
          .setColor('#00ff00')
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } else {
        // Ajouter à la blacklist
        blacklist[guildId].push(targetUser.id);
        client.saveBlacklist(blacklist);
        
        const embed = new EmbedBuilder()
          .setTitle('🚫 Utilisateur ajouté à la blacklist')
          .setDescription(`${targetUser.tag} ne peut plus répondre aux formulaires de ce serveur.`)
          .setColor('#ff0000')
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      // Log l'action
      console.log(`[BLACKLIST] ${interaction.user.tag} ${isBlacklisted ? 'a retiré' : 'a ajouté'} ${targetUser.tag} ${isBlacklisted ? 'de' : 'à'} la blacklist du serveur ${interaction.guild.name} (${guildId})`);
      
    } catch (error) {
      console.error('Erreur lors de la gestion de la blacklist:', error);
      
      // Vérifier si on a déjà répondu à l'interaction
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ Une erreur est survenue lors de la gestion de la blacklist.', 
          ephemeral: true 
        });
      }
    }
  }
};
