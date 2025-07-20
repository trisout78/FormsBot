const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { config } = require('../utils/config.js');
const { 
  shouldAutoAddToSupport, 
  setUserAutoAddPreference, 
  hasBeenAddedToSupport,
  loadUserPreferences
} = require('../utils/support-auto-add.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('support-admin')
    .setDescription('🔧 Gestion du système d\'ajout automatique au serveur de support')
    .addSubcommand(subcommand =>
      subcommand
        .setName('user-status')
        .setDescription('Vérifier le statut d\'un utilisateur concernant l\'ajout automatique')
        .addUserOption(option =>
          option.setName('utilisateur')
            .setDescription('L\'utilisateur à vérifier')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-preference')
        .setDescription('Modifier la préférence d\'un utilisateur')
        .addUserOption(option =>
          option.setName('utilisateur')
            .setDescription('L\'utilisateur à modifier')
            .setRequired(true))
        .addBooleanOption(option =>
          option.setName('auto-add')
            .setDescription('Autoriser l\'ajout automatique au support')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('statistics')
        .setDescription('Afficher les statistiques du système'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // Marquer cette commande comme réservée au staff
  staffOnly: true,

  async execute(interaction, client) {
    // Double vérification staff
    if (!config.staff.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Vous n\'avez pas les permissions nécessaires pour utiliser cette commande.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'user-status':
          await handleUserStatus(interaction);
          break;
        case 'set-preference':
          await handleSetPreference(interaction);
          break;
        case 'statistics':
          await handleStatistics(interaction, client);
          break;
        default:
          await interaction.reply({
            content: '❌ Sous-commande inconnue.',
            ephemeral: true
          });
      }
    } catch (error) {
      console.error('Erreur dans la commande support-admin:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Une erreur est survenue lors de l\'exécution de la commande.',
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: '❌ Une erreur est survenue lors de l\'exécution de la commande.',
          ephemeral: true
        });
      }
    }
  }
};

async function handleUserStatus(interaction) {
  const targetUser = interaction.options.getUser('utilisateur');
  
  await interaction.deferReply({ ephemeral: true });

  const autoAddEnabled = shouldAutoAddToSupport(targetUser.id);
  const hasBeenAdded = hasBeenAddedToSupport(targetUser.id);

  const embed = new EmbedBuilder()
    .setTitle('📊 Statut de l\'utilisateur - Support automatique')
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: 'Utilisateur', value: `${targetUser.tag} (ID: ${targetUser.id})`, inline: false },
      { name: 'Ajout automatique activé', value: autoAddEnabled ? '✅ Oui' : '❌ Non', inline: true },
      { name: 'A été ajouté au support', value: hasBeenAdded ? '✅ Oui' : '❌ Non', inline: true }
    )
    .setColor(autoAddEnabled ? 0x00FF00 : 0xFF0000)
    .setTimestamp()
    .setFooter({ text: 'MyForm • Administration du support' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetPreference(interaction) {
  const targetUser = interaction.options.getUser('utilisateur');
  const autoAdd = interaction.options.getBoolean('auto-add');
  
  await interaction.deferReply({ ephemeral: true });

  // Modifier la préférence
  setUserAutoAddPreference(targetUser.id, autoAdd);

  const embed = new EmbedBuilder()
    .setTitle('✅ Préférence mise à jour')
    .setDescription(`La préférence d'ajout automatique de **${targetUser.tag}** a été ${autoAdd ? 'activée' : 'désactivée'}.`)
    .addFields(
      { name: 'Utilisateur', value: `${targetUser.tag} (ID: ${targetUser.id})`, inline: true },
      { name: 'Nouvelle préférence', value: autoAdd ? '✅ Ajout automatique activé' : '❌ Ajout automatique désactivé', inline: true },
      { name: 'Modifié par', value: `${interaction.user.tag}`, inline: true }
    )
    .setColor(autoAdd ? 0x00FF00 : 0xFF0000)
    .setTimestamp()
    .setFooter({ text: 'MyForm • Administration du support' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleStatistics(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  // Charger les préférences pour calculer les statistiques
  loadUserPreferences();
  const fs = require('fs-extra');
  const path = require('path');
  
  try {
    const prefsPath = path.join(__dirname, '../user-support-preferences.json');
    const userPreferences = fs.existsSync(prefsPath) ? fs.readJsonSync(prefsPath) : {};
    
    let totalUsers = 0;
    let usersWithAutoAdd = 0;
    let usersWithoutAutoAdd = 0;
    let usersAddedToSupport = 0;

    for (const [userId, prefs] of Object.entries(userPreferences)) {
      totalUsers++;
      
      if (prefs.autoAddToSupport !== false) {
        usersWithAutoAdd++;
      } else {
        usersWithoutAutoAdd++;
      }
      
      if (prefs.hasBeenAddedToSupport) {
        usersAddedToSupport++;
      }
    }

    // Statistiques du serveur de support
    const supportServerId = config['staff-server'];
    const supportGuild = client.guilds.cache.get(supportServerId);
    const supportMemberCount = supportGuild ? supportGuild.memberCount : 'Serveur introuvable';

    const embed = new EmbedBuilder()
      .setTitle('📈 Statistiques du support automatique')
      .addFields(
        { name: '👥 Utilisateurs total dans la base', value: totalUsers.toString(), inline: true },
        { name: '✅ Avec ajout automatique', value: usersWithAutoAdd.toString(), inline: true },
        { name: '❌ Sans ajout automatique', value: usersWithoutAutoAdd.toString(), inline: true },
        { name: '➕ Ajoutés au support', value: usersAddedToSupport.toString(), inline: true },
        { name: '🔧 Membres du serveur support', value: supportMemberCount.toString(), inline: true },
        { name: '📊 Taux d\'opt-out', value: totalUsers > 0 ? `${((usersWithoutAutoAdd / totalUsers) * 100).toFixed(1)}%` : '0%', inline: true }
      )
      .setColor(0x3498DB)
      .setTimestamp()
      .setFooter({ 
        text: `MyForm • Support automatique • Serveur: ${client.guilds.cache.size}`,
        iconURL: client.user.displayAvatarURL()
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Erreur lors du calcul des statistiques:', error);
    await interaction.editReply({
      content: '❌ Erreur lors du calcul des statistiques.',
      ephemeral: true
    });
  }
}
