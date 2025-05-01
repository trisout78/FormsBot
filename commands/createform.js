const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createform')
    .setDescription('Démarrer la création de formulaire'),

  async execute(interaction, client) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    // Créer l'URL unique pour la création du formulaire
    const formUrl = `${config.webserver.baseUrl}/create/${guildId}`;
    
    const embed = new EmbedBuilder()
      .setTitle('Création de formulaire')
      .setDescription(`Cliquez sur le lien ci-dessous pour créer votre formulaire. Ce lien est à usage unique et expirera dans 15 minutes.\n\n**[Créer un formulaire](${formUrl})**`)
      .setColor('#3498db');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};