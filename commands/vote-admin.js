const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { config } = require('../utils/config.js');
const { getVoteTimestamp, recordVoteTimestamp } = require('../utils/vote-timestamps.js');
const { getUserVoteCredits } = require('../web/routes/webhooks.js');
const { sendVoteReminder } = require('../utils/vote-reminders.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote-admin')
    .setDescription('🗳️ Administration des votes et crédits (Staff uniquement)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('user-info')
        .setDescription('Voir les informations de vote d\'un utilisateur')
        .addUserOption(option =>
          option
            .setName('utilisateur')
            .setDescription('L\'utilisateur à vérifier')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('send-reminder')
        .setDescription('Envoyer un rappel de vote à un utilisateur')
        .addUserOption(option =>
          option
            .setName('utilisateur')
            .setDescription('L\'utilisateur à qui envoyer le rappel')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list-eligible')
        .setDescription('Lister les utilisateurs éligibles pour un rappel'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('send-all-reminders')
        .setDescription('Envoyer tous les rappels en attente'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('statistics')
        .setDescription('Voir les statistiques globales des votes')),
  staffOnly: true,  // Marquer cette commande comme staff uniquement
  
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
        case 'user-info':
          await handleUserInfo(interaction);
          break;
        case 'send-reminder':
          await handleSendReminder(interaction, client);
          break;
        case 'list-eligible':
          await handleListEligible(interaction);
          break;
        case 'send-all-reminders':
          await handleSendAllReminders(interaction, client);
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
      console.error('Erreur dans la commande vote-admin:', error);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Erreur')
        .setDescription(`Une erreur est survenue: \`${error.message}\``)
        .setTimestamp();
        
      if (interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
};

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('utilisateur');
  const timestamp = getVoteTimestamp(user.id);
  const credits = getUserVoteCredits(user.id);
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🗳️ Informations de Vote - ${user.tag}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '💰 Crédits IA', value: credits.toString(), inline: true }
    );

  if (!timestamp) {
    embed.addFields(
      { name: '🗳️ Dernier vote', value: 'Aucun vote enregistré', inline: true },
      { name: '⏰ Prochain vote', value: 'Disponible maintenant', inline: true },
      { name: '📊 Statut', value: '🔴 Jamais voté', inline: false }
    );
    embed.setDescription('❌ Cet utilisateur n\'a pas encore voté ou ses données ont été supprimées.');
  } else {
    const now = Date.now();
    const timeSinceVote = now - timestamp;
    const twelveHours = 12 * 60 * 60 * 1000;
    
    const hours = Math.floor(timeSinceVote / (1000 * 60 * 60));
    const minutes = Math.floor((timeSinceVote % (1000 * 60 * 60)) / (1000 * 60));
    
    const isEligible = timeSinceVote >= twelveHours;
    const timeUntilNext = isEligible ? 0 : twelveHours - timeSinceVote;
    
    embed.addFields(
      { name: '🗳️ Dernier vote', value: `<t:${Math.floor(timestamp / 1000)}:F>`, inline: false },
      { name: '⏱️ Temps écoulé', value: `${hours}h ${minutes}m`, inline: true },
      { name: '⏰ Prochain vote', value: isEligible ? '✅ Disponible maintenant' : `⏳ Dans ${Math.floor(timeUntilNext / (1000 * 60 * 60))}h ${Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60))}m`, inline: true },
      { name: '📊 Statut', value: isEligible ? '🟢 Peut voter' : '🟡 En cooldown', inline: true }
    );
    
    if (isEligible) {
      embed.setDescription('✅ Cet utilisateur peut recevoir un rappel de vote.');
      embed.setColor(0x00FF00);
    } else {
      embed.setDescription('⏳ Cet utilisateur doit encore attendre avant de pouvoir voter à nouveau.');
      embed.setColor(0xFFAA00);
    }
  }
  
  embed.addFields(
    { name: '🔗 Actions', value: '• Utilisez `/vote-admin send-reminder` pour envoyer un rappel\n• Utilisez `/vote-admin send-all-reminders` pour tous les rappels', inline: false }
  );

  embed.setTimestamp();
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSendReminder(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  
  const user = interaction.options.getUser('utilisateur');
  
  try {
    const success = await sendVoteReminder(client, user.id);
    
    const embed = new EmbedBuilder()
      .setColor(success ? 0x00FF00 : 0xFF6600)
      .setTitle(success ? '✅ Rappel Envoyé' : '⚠️ Rappel Tenté')
      .setDescription(success 
        ? `Le rappel de vote a été envoyé avec succès à **${user.tag}**.`
        : `Tentative d'envoi du rappel à **${user.tag}** (peut avoir échoué si les DM sont fermés).`)
      .addFields(
        { name: '👤 Utilisateur', value: `${user.tag} (${user.id})`, inline: true },
        { name: '📅 Date d\'envoi', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
      )
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Erreur lors de l\'envoi du rappel:', error);
    await interaction.editReply({
      content: `❌ Erreur lors de l'envoi du rappel à ${user.tag}: ${error.message}`
    });
  }
}

async function handleListEligible(interaction) {
  const { getUsersEligibleForReminder } = require('../utils/vote-timestamps.js');
  const eligibleUsers = getUsersEligibleForReminder();
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🗳️ Utilisateurs Éligibles pour un Rappel')
    .setTimestamp();

  if (eligibleUsers.length === 0) {
    embed.setDescription('✅ Aucun utilisateur n\'est actuellement éligible pour un rappel de vote.');
    embed.setColor(0x00FF00);
  } else {
    const userList = eligibleUsers.slice(0, 15).map((userInfo, index) => {
      const timeSinceVote = Math.floor((Date.now() - userInfo.lastVote) / (1000 * 60 * 60));
      return `**${index + 1}.** <@${userInfo.userId}> - il y a ${timeSinceVote}h`;
    }).join('\n');
    
    embed.setDescription(`**${eligibleUsers.length} utilisateur(s) éligible(s)**\n\n${userList}`);
    
    if (eligibleUsers.length > 15) {
      embed.setFooter({ text: `... et ${eligibleUsers.length - 15} autre(s)` });
    }
    
    embed.addFields({
      name: '🔗 Actions',
      value: '• `/vote-admin send-all-reminders` - Envoyer tous les rappels\n• `/vote-admin send-reminder @user` - Rappel individuel',
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSendAllReminders(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  
  const { checkAndSendVoteReminders } = require('../utils/vote-reminders.js');
  const { getUsersEligibleForReminder } = require('../utils/vote-timestamps.js');
  
  const eligibleUsers = getUsersEligibleForReminder();
  
  if (eligibleUsers.length === 0) {
    return interaction.editReply('ℹ️ Aucun rappel à envoyer pour le moment.');
  }
  
  const startTime = Date.now();
  
  const progressEmbed = new EmbedBuilder()
    .setColor(0xFFAA00)
    .setTitle('🔄 Envoi des Rappels en Cours')
    .setDescription(`Envoi en cours pour ${eligibleUsers.length} utilisateur(s)...`)
    .setTimestamp();
    
  await interaction.editReply({ embeds: [progressEmbed] });
  
  await checkAndSendVoteReminders(client);
  
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  const finalEmbed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Rappels Envoyés')
    .setDescription(`${eligibleUsers.length} rappel(s) de vote ont été traités avec succès.`)
    .addFields(
      { name: '📊 Statistiques', value: [
        `**Utilisateurs traités:** ${eligibleUsers.length}`,
        `**Durée:** ${duration}s`,
        `**Moyenne:** ${eligibleUsers.length > 0 ? Math.round(duration / eligibleUsers.length * 100) / 100 : 0}s par utilisateur`
      ].join('\n'), inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [finalEmbed] });
}

async function handleStatistics(interaction, client) {
  const { voteTimestamps } = require('../utils/vote-timestamps.js');
  const { getUsersEligibleForReminder } = require('../utils/vote-timestamps.js');
  const { voteCredits } = require('../web/routes/webhooks.js');
  
  const totalTrackedUsers = voteTimestamps.size;
  const eligibleUsers = getUsersEligibleForReminder().length;
  const totalCredits = Array.from(voteCredits.values()).reduce((sum, user) => sum + user.credits, 0);
  const usersWithCredits = Array.from(voteCredits.values()).filter(user => user.credits > 0).length;
  
  // Statistiques temporelles
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const sixHours = 6 * oneHour;
  const twelveHours = 12 * oneHour;
  
  let recentVotes = 0;
  let mediumVotes = 0;
  let oldVotes = 0;
  
  for (const timestamp of voteTimestamps.values()) {
    const timeSince = now - timestamp;
    if (timeSince < oneHour) recentVotes++;
    else if (timeSince < sixHours) mediumVotes++;
    else if (timeSince < twelveHours) oldVotes++;
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 Statistiques des Votes')
    .addFields(
      {
        name: '👥 Utilisateurs',
        value: [
          `**Total suivi:** ${totalTrackedUsers}`,
          `**Éligibles rappel:** ${eligibleUsers}`,
          `**Avec crédits:** ${usersWithCredits}`
        ].join('\n'),
        inline: true
      },
      {
        name: '💰 Crédits IA',
        value: [
          `**Total distribué:** ${totalCredits}`,
          `**Moyenne par utilisateur:** ${usersWithCredits > 0 ? Math.round(totalCredits / usersWithCredits * 100) / 100 : 0}`,
          `**Utilisateurs actifs:** ${usersWithCredits}`
        ].join('\n'),
        inline: true
      },
      {
        name: '⏰ Répartition Temporelle',
        value: [
          `**< 1h:** ${recentVotes} votes`,
          `**1-6h:** ${mediumVotes} votes`,
          `**6-12h:** ${oldVotes} votes`,
          `**> 12h:** ${eligibleUsers} votes`
        ].join('\n'),
        inline: false
      },
      {
        name: '🔗 Actions Rapides',
        value: [
          '• `/vote-admin list-eligible` - Voir les éligibles',
          '• `/vote-admin send-all-reminders` - Envoyer tous les rappels',
          '• `/vote-admin user-info @user` - Info utilisateur'
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: `Serveurs connectés: ${client.guilds.cache.size}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
