const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createform')
    .setDescription('Démarrer la création de formulaire')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    // Vérifier la limite de formulaires pour ce serveur
    const guildId = interaction.guildId;
    const formsForGuild = client.forms[guildId] || {};
    const formCount = Object.keys(formsForGuild).length;
    const isPremium = client.premiumGuilds && client.premiumGuilds.includes(guildId);
    if (!isPremium && formCount >= 3) {
      return interaction.reply({ content: 'Limite atteinte: 3 formulaires max. Passez en premium pour des formulaires illimités.', ephemeral: true });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'Vous n\'avez pas la permission de créer des formulaires.', ephemeral: true });
    }
    
    // Créer l'URL pour la création du formulaire
    const formUrl = `${config.webserver.baseUrl}/create/${guildId}`;
    
    const embed = new EmbedBuilder()
      .setTitle('Création de formulaire')
      .setDescription(`Cliquez sur le lien ci-dessous pour créer votre formulaire. Vous serez redirigé vers la page d'authentification Discord si nécessaire.\n\n**[Créer un formulaire](${formUrl})**`)
      .setColor('#3498db');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};