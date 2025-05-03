const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createform')
    .setDescription('Démarrer la création de formulaire')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'Vous n\'avez pas la permission de créer des formulaires.', ephemeral: true });
    }
    
    const guildId = interaction.guildId;
    
    // Créer l'URL pour la création du formulaire
    const formUrl = `${config.webserver.baseUrl}/create/${guildId}`;
    
    const embed = new EmbedBuilder()
      .setTitle('Création de formulaire')
      .setDescription(`Cliquez sur le lien ci-dessous pour créer votre formulaire. Vous serez redirigé vers la page d'authentification Discord si nécessaire.\n\n**[Créer un formulaire](${formUrl})**`)
      .setColor('#3498db');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};