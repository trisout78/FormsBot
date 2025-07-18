const axios = require('axios');
const fs = require('fs-extra');
const { isAuthenticated, hasGuildPermission, DISCORD_API_URL } = require('../middleware/auth.js');
const { openai, checkAIRateLimit } = require('../../utils/ai.js');
const { giftCodes, premiumGuilds, reloadGiftCodes, saveGiftCodes, savePremiumList } = require('../../utils/premium.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

function setupApiRoutes(app, client) {
  // API pour obtenir les informations de l'utilisateur
  app.get('/api/user', isAuthenticated, (req, res) => {
    res.json(req.session.user);
  });

  // API pour obtenir la liste des serveurs
  app.get('/api/guilds', isAuthenticated, async (req, res) => {
    const makeRequest = async (retryCount = 0) => {
      try {
        const guildsResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
          headers: {
            Authorization: `Bearer ${req.session.accessToken}`
          }
        });
        
        const managableGuilds = guildsResponse.data.filter(guild => {
          const permissions = BigInt(guild.permissions);
          return (permissions & BigInt(0x2000)) !== BigInt(0);
        });
        
        const botGuilds = client.guilds.cache;
        const availableGuilds = managableGuilds.filter(guild => 
          botGuilds.has(guild.id)
        );
        
        const guildsWithFormInfo = availableGuilds.map(guild => {
          const formCount = client.forms[guild.id] ? Object.keys(client.forms[guild.id]).length : 0;
          const isPremium = client.premiumGuilds.includes(guild.id);
          const limit = isPremium ? Infinity : 3;
          return {
            ...guild,
            formCount,
            isPremium,
            limit
          };
        });
        
        res.json(guildsWithFormInfo);
      } catch (error) {
        console.log('Erreur lors de la récupération des serveurs:', error);
        
        // Gestion spécifique des rate limits Discord
        if (error.response && error.response.status === 429) {
          const retryAfter = (error.response.data.retry_after || 1) * 1000; // Convertir en millisecondes
          const maxRetries = 3;
          
          if (retryCount < maxRetries) {
            console.log(`Rate limit atteint, retry dans ${retryAfter}ms (tentative ${retryCount + 1}/${maxRetries})`);
            setTimeout(() => {
              makeRequest(retryCount + 1);
            }, retryAfter);
            return;
          } else {
            return res.status(429).json({
              error: 'Rate limit atteint',
              message: 'You are being rate limited.',
              retry_after: error.response.data.retry_after || 1,
              global: error.response.data.global || false
            });
          }
        }
        
        res.status(500).json({ error: 'Erreur lors de la récupération des serveurs' });
      }
    };
    
    await makeRequest();
  });

  // API pour obtenir les formulaires d'un serveur
  app.get('/api/forms/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId } = req.params;
    
    if (!client.forms[guildId] || Object.keys(client.forms[guildId]).length === 0) {
      return res.json([]);
    }
    
    const forms = Object.entries(client.forms[guildId]).map(([id, form]) => ({
      id,
      title: form.title,
      questions: form.questions,
      embedChannelId: form.embedChannelId,
      responseChannelId: form.responseChannelId,
      embedText: form.embedText,
      buttonLabel: form.buttonLabel,
      singleResponse: form.singleResponse,
      reviewOptions: form.reviewOptions,
      embedMessageId: form.embedMessageId,
      respondents: form.respondents || {},
      disabled: form.disabled || false
    }));
    
    res.json(forms);
  });

  // API pour obtenir les données d'un formulaire spécifique
  app.get('/api/form/:guildId/:formId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId, formId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }
    
    const channels = guild.channels.cache
      .filter(c => c.type === 0)
      .map(c => ({ id: c.id, name: c.name }));
    
    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({ id: r.id, name: r.name }));

    let form = {
      title: '',
      questions: [{ text: '', style: 'SHORT' }],
      embedChannelId: '',
      responseChannelId: '',
      embedText: '',
      buttonLabel: '',
      singleResponse: false,
      createThreads: false,
      clartyProtection: false,
      reviewOptions: { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
    };

    if (formId && client.forms[guildId]?.[formId]) {
      form = { ...client.forms[guildId][formId] };
    }
    
    res.json({
      form: form,
      channels: channels,
      roles: roles,
      user: req.session.user,
      isPremium: client.premiumGuilds.includes(guildId)
    });
  });

  // API pour obtenir un formulaire vide
  app.get('/api/form/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }
    
    const channels = guild.channels.cache
      .filter(c => c.type === 0)
      .map(c => ({ id: c.id, name: c.name }));
    
    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({ id: r.id, name: r.name }));

    const form = {
      title: '',
      questions: [],
      embedChannelId: null,
      responseChannelId: null,
      embedText: '',
      buttonLabel: 'Répondre',
      singleResponse: false,
      createThreads: false,
      clartyProtection: false,
      reviewOptions: { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
    };

    res.json({
      form: form,
      channels: channels,
      roles: roles,
      user: req.session.user,
      isPremium: client.premiumGuilds.includes(guildId)
    });
  });

  // Suite des routes API...
  setupAiApiRoutes(app, client);
  setupFormApiRoutes(app, client);
  setupGiftCodeApiRoutes(app, client);
}

function setupFormApiRoutes(app, client) {
  // API pour sauvegarder un formulaire modifié
  app.post('/api/form/:guildId/:formId', isAuthenticated, hasGuildPermission, async (req, res) => {
    const { guildId, formId } = req.params;
    const updatedForm = req.body.form;
    
    if (!updatedForm) {
      return res.status(400).json({ error: 'Données du formulaire manquantes' });
    }
    
    // Vérification de la limite de formulaires pour les serveurs non premium
    const formsForGuild = client.forms[guildId] || {};
    const formCount = Object.keys(formsForGuild).length;
    if (!client.premiumGuilds.includes(guildId) && formCount >= 3 && !formsForGuild[formId]) {
      return res.status(403).json({ error: 'Limite atteinte', message: "Vous avez atteint la limite de 3 formulaires. Passez en premium pour des formulaires illimités." });
    }

    try {
      // Valider le formulaire
      if (!updatedForm.title || !updatedForm.embedText || !updatedForm.buttonLabel ||
          !updatedForm.embedChannelId || !updatedForm.responseChannelId || 
          !updatedForm.questions || updatedForm.questions.length === 0) {
        return res.status(400).json({ error: 'Formulaire incomplet' });
      }
      
      // Préparation pour sauvegarder dans client.forms
      client.forms[guildId] = client.forms[guildId] || {};
      const finalFormId = formId || Date.now().toString();
      
      // Récupérer l'ID du message existant si c'est une modification
      const existingMessageId = formId && client.forms[guildId][finalFormId]?.embedMessageId;
      
      // Stocker l'ancien formulaire pour les logs
      const oldForm = client.forms[guildId][finalFormId] ? {...client.forms[guildId][finalFormId]} : null;
      
      // Sauvegarder le formulaire
      client.forms[guildId][finalFormId] = {
        title: updatedForm.title,
        questions: updatedForm.questions,
        embedChannelId: updatedForm.embedChannelId,
        responseChannelId: updatedForm.responseChannelId,
        embedText: updatedForm.embedText,
        buttonLabel: updatedForm.buttonLabel,
        singleResponse: !!updatedForm.singleResponse,
        createThreads: !!updatedForm.createThreads,
        clartyProtection: !!updatedForm.clartyProtection,
        cooldownOptions: updatedForm.cooldownOptions || { enabled: false, duration: 60 },
        reviewOptions: updatedForm.reviewOptions || { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' },
        embedMessageId: existingMessageId,
        respondents: formId && client.forms[guildId][finalFormId]?.respondents ? 
          client.forms[guildId][finalFormId].respondents : {}
      };
      
      // Créer ou mettre à jour l'embed Discord
      const embedChan = await client.channels.fetch(updatedForm.embedChannelId);
      const btn = new ButtonBuilder()
        .setCustomId(`fill_${finalFormId}`)
        .setLabel(updatedForm.buttonLabel)
        .setStyle(ButtonStyle.Primary);
      
      const formEmbed = new EmbedBuilder()
        .setTitle(updatedForm.title)
        .setDescription(updatedForm.embedText);
      
      let sentMessage;
      
      if (existingMessageId) {
        try {
          sentMessage = await embedChan.messages.fetch(existingMessageId);
          await sentMessage.edit({
            embeds: [formEmbed],
            components: [new ActionRowBuilder().addComponents(btn)]
          });
          console.log(`Message de formulaire modifié avec succès: ${existingMessageId}`);
        } catch (error) {
          console.log(`Impossible de modifier le message existant ${existingMessageId}, création d'un nouveau:`, error);
          sentMessage = await embedChan.send({
            embeds: [formEmbed],
            components: [new ActionRowBuilder().addComponents(btn)]
          });
        }
      } else {
        sentMessage = await embedChan.send({
          embeds: [formEmbed],
          components: [new ActionRowBuilder().addComponents(btn)]
        });
        console.log(`Nouveau message de formulaire créé: ${sentMessage.id}`);
      }
      
      // Mettre à jour l'ID du message
      client.forms[guildId][finalFormId].embedMessageId = sentMessage.id;
      
      // Sauvegarder dans le fichier
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      
      // Log de modification de formulaire
      if (oldForm) {
        const guild = client.guilds.cache.get(guildId);
        await logToWebhookAndConsole(
          "📝 Modification de formulaire", 
          `**${req.session.user.username}** a modifié le formulaire "${updatedForm.title}" sur le serveur **${guild?.name || guildId}**`,
          [
            { name: "Titre", value: updatedForm.title, inline: true },
            { name: "Questions", value: `${updatedForm.questions.length}`, inline: true },
            { name: "Serveur", value: guild?.name || guildId, inline: true },
            { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
          ],
          0xFEE75C
        );
      }
      
      res.json({ success: true, redirect: '/success' });
    } catch (error) {
      console.log('Erreur lors de la sauvegarde du formulaire:', error);
      res.status(500).json({ error: 'Erreur lors de la sauvegarde du formulaire', details: error.message });
    }
  });

  // API pour créer un nouveau formulaire
  app.post('/api/form/:guildId', isAuthenticated, hasGuildPermission, async (req, res) => {
    const { guildId } = req.params;
    const updatedForm = req.body.form;
    
    if (!updatedForm) {
      return res.status(400).json({ error: 'Données du formulaire manquantes' });
    }
    
    // Vérification de la limite de formulaires pour les serveurs non premium
    const formsForGuild = client.forms[guildId] || {};
    const formCount = Object.keys(formsForGuild).length;
    if (!client.premiumGuilds.includes(guildId) && formCount >= 3) {
      return res.status(403).json({ error: 'Limite atteinte', message: "Vous avez atteint la limite de 3 formulaires. Passez en premium pour des formulaires illimités." });
    }

    try {
      // Valider le formulaire
      if (!updatedForm.title || !updatedForm.embedText || !updatedForm.buttonLabel ||
          !updatedForm.embedChannelId || !updatedForm.responseChannelId || 
          !updatedForm.questions || updatedForm.questions.length === 0) {
        return res.status(400).json({ error: 'Formulaire incomplet' });
      }
      
      // Préparation pour sauvegarder dans client.forms
      client.forms[guildId] = client.forms[guildId] || {};
      const finalFormId = Date.now().toString();
      
      // Sauvegarder le formulaire
      client.forms[guildId][finalFormId] = {
        title: updatedForm.title,
        questions: updatedForm.questions,
        embedChannelId: updatedForm.embedChannelId,
        responseChannelId: updatedForm.responseChannelId,
        embedText: updatedForm.embedText,
        buttonLabel: updatedForm.buttonLabel,
        singleResponse: updatedForm.singleResponse || false,
        createThreads: updatedForm.createThreads || false,
        clartyProtection: updatedForm.clartyProtection || false,
        cooldownOptions: updatedForm.cooldownOptions || { enabled: false, duration: 60 },
        reviewOptions: updatedForm.reviewOptions || { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' },
        embedMessageId: null,
        respondents: {}
      };
      
      // Créer l'embed Discord
      const embedChan = await client.channels.fetch(updatedForm.embedChannelId);
      const btn = new ButtonBuilder()
        .setCustomId(`fill_${finalFormId}`)
        .setLabel(updatedForm.buttonLabel)
        .setStyle(ButtonStyle.Primary);
      
      const formEmbed = new EmbedBuilder()
        .setTitle(updatedForm.title)
        .setDescription(updatedForm.embedText);
      
      // Nouveau formulaire, envoyer un nouveau message
      const sentMessage = await embedChan.send({
        embeds: [formEmbed],
        components: [new ActionRowBuilder().addComponents(btn)]
      });
      console.log(`Nouveau message de formulaire créé: ${sentMessage.id}`);
      
      // Mettre à jour l'ID du message
      client.forms[guildId][finalFormId].embedMessageId = sentMessage.id;
      
      // Sauvegarder dans le fichier
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      
      // Log de création de formulaire
      const guild = client.guilds.cache.get(guildId);
      await logToWebhookAndConsole(
        "✨ Création de formulaire", 
        `**${req.session.user.username}** a créé un nouveau formulaire "${updatedForm.title}" sur le serveur **${guild?.name || guildId}**`,
        [
          { name: "Titre", value: updatedForm.title, inline: true },
          { name: "Questions", value: `${updatedForm.questions.length}`, inline: true },
          { name: "Serveur", value: guild?.name || guildId, inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
        ],
        0x3498DB
      );
      
      res.json({ success: true, formId: finalFormId, redirect: '/success' });
    } catch (error) {
      console.log('Erreur lors de la sauvegarde du formulaire:', error);
      res.status(500).json({ error: 'Erreur lors de la sauvegarde du formulaire', details: error.message });
    }
  });

  // API pour supprimer un formulaire
  app.delete('/api/forms/:guildId/:formId', isAuthenticated, hasGuildPermission, async (req, res) => {
    const { guildId, formId } = req.params;
    
    try {
      // Vérifier si le formulaire existe
      if (!client.forms[guildId] || !client.forms[guildId][formId]) {
        return res.status(404).json({ error: 'Formulaire introuvable' });
      }
      
      // Récupérer les informations du formulaire pour le log
      const form = client.forms[guildId][formId];
      const guild = client.guilds.cache.get(guildId);
      
      // Supprimer l'embed du message Discord si possible
      if (form.embedMessageId && form.embedChannelId) {
        try {
          const channel = await client.channels.fetch(form.embedChannelId);
          const message = await channel.messages.fetch(form.embedMessageId);
          await message.delete();
          console.log(`Message de formulaire supprimé: ${form.embedMessageId}`);
        } catch (error) {
          console.log(`Impossible de supprimer le message existant ${form.embedMessageId}: ${error.message}`);
        }
      }
      
      // Supprimer le formulaire de la collection
      delete client.forms[guildId][formId];
      
      // Si c'était le dernier formulaire du serveur, supprimer l'entrée du serveur
      if (Object.keys(client.forms[guildId]).length === 0) {
        delete client.forms[guildId];
      }
      
      // Sauvegarder les modifications
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      
      // Log de suppression de formulaire
      await logToWebhookAndConsole(
        "🗑️ Suppression de formulaire", 
        `**${req.session.user.username}** a supprimé le formulaire "${form.title}" du serveur **${guild?.name || guildId}**`,
        [
          { name: "Titre", value: form.title, inline: true },
          { name: "Serveur", value: guild?.name || guildId, inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
        ],
        0xED4245
      );
      
      res.json({ success: true });
    } catch (error) {
      console.log('Erreur lors de la suppression du formulaire:', error);
      res.status(500).json({ error: 'Erreur lors de la suppression du formulaire' });
    }
  });

  // API pour activer/désactiver un formulaire
  app.post('/api/forms/:guildId/:formId/toggle', isAuthenticated, hasGuildPermission, async (req, res) => {
    const { guildId, formId } = req.params;
    const { status } = req.body;
    
    try {
      // Vérifier si le formulaire existe
      if (!client.forms[guildId] || !client.forms[guildId][formId]) {
        return res.status(404).json({ error: 'Formulaire introuvable' });
      }
      
      // Récupérer les informations du formulaire pour le log
      const form = client.forms[guildId][formId];
      const guild = client.guilds.cache.get(guildId);
      
      // Mettre à jour le statut du formulaire
      const isDisabled = status === 'disabled';
      client.forms[guildId][formId].disabled = isDisabled;
      
      // Mettre à jour l'embed Discord si possible
      if (form.embedMessageId && form.embedChannelId) {
        try {
          const channel = await client.channels.fetch(form.embedChannelId);
          const message = await channel.messages.fetch(form.embedMessageId);
          
          // Récupérer l'embed existant
          const embed = message.embeds[0];
          
          // Créer un nouveau bouton avec le statut correct
          const btn = new ButtonBuilder()
            .setCustomId(`fill_${formId}`)
            .setLabel(form.buttonLabel)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isDisabled);
          
          // Mettre à jour le message avec le nouveau bouton
          await message.edit({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(btn)]
          });
          
          console.log(`Message de formulaire mis à jour avec statut ${isDisabled ? 'désactivé' : 'activé'}: ${form.embedMessageId}`);
        } catch (error) {
          console.log(`Impossible de mettre à jour le message Discord: ${error.message}`);
        }
      }
      
      // Sauvegarder les modifications
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      
      // Log de changement de statut du formulaire
      await logToWebhookAndConsole(
        isDisabled ? "🔴 Formulaire désactivé" : "🟢 Formulaire activé", 
        `**${req.session.user.username}** a ${isDisabled ? 'désactivé' : 'activé'} le formulaire "${form.title}" du serveur **${guild?.name || guildId}**`,
        [
          { name: "Titre", value: form.title, inline: true },
          { name: "Serveur", value: guild?.name || guildId, inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
        ],
        isDisabled ? 0xFEE75C : 0x57F287
      );
      
      res.json({ success: true, status: status });
    } catch (error) {
      console.log('Erreur lors de la modification du statut du formulaire:', error);
      res.status(500).json({ error: 'Erreur lors de la modification du statut du formulaire' });
    }
  });
}

function setupAiApiRoutes(app, client) {
  // API pour la génération IA de formulaires
  app.post('/api/form/:guildId/generate-ai', isAuthenticated, hasGuildPermission, async (req, res) => {
    const { guildId } = req.params;
    const { subject, count } = req.body;
    const userId = req.session.user.id;
    
    if (!client.premiumGuilds.includes(guildId)) {
      return res.status(403).json({ error: 'Fonction réservée aux serveurs Premium' });
    }
    
    const rateLimitResult = checkAIRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({ 
        error: 'Limite de génération IA atteinte', 
        message: `Vous avez atteint la limite de 10 générations par heure. Veuillez réessayer dans ${rateLimitResult.timeLeft} minutes.`,
        resetTime: rateLimitResult.resetTime,
        timeLeft: rateLimitResult.timeLeft
      });
    }
    
    if (!subject || !count) {
      return res.status(400).json({ error: 'Sujet et nombre de questions requis' });
    }
    
    const { config } = require('../../utils/config.js');
    if (!config.openai.apiKey) {
      return res.status(500).json({ error: 'Clé OpenAI non configurée' });
    }
    
    try {
      const template = {
        title: "",
        questions: [{ text: "", style: "SHORT" }],
        embedChannelId: "",
        responseChannelId: "",
        embedText: "",
        buttonLabel: "",
        singleResponse: false,
        createThreads: false,
        reviewOptions: {
          enabled: false,
          customMessagesEnabled: false,
          acceptMessage: "",
          rejectMessage: "",
          acceptRoleId: "",
          rejectRoleId: ""
        },
        embedMessageId: "",
        respondents: {}
      };
      
      const prompt = `Template JSON: ${JSON.stringify(template)}

Sujet: ${subject}
Questions: ${count}

Instructions importantes:
- Le "title" doit être un titre accrocheur pour le formulaire
- Le "embedText" doit être une description engageante du formulaire (2-3 phrases)
- Le "buttonLabel" doit être un appel à l'action approprié (ex: "Postuler", "Répondre", "S'inscrire")
- Chaque question dans "questions" doit avoir:
  * "text": le texte de la question (MAXIMUM 45 caractères)
  * "style": soit "SHORT" pour réponse courte, soit "PARAGRAPH" pour réponse longue
- Varie les types de questions (SHORT/PARAGRAPH) selon leur nature
- Questions courtes (SHORT): nom, âge, pseudo, choix simple
- Questions longues (PARAGRAPH): motivation, expérience, description

ATTENTION CRITIQUE: Les textes des questions ne doivent JAMAIS dépasser 45 caractères !`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "Tu es un assistant expert en création de formulaires Discord. Tu dois créer des formulaires complets et engageants. Réponds UNIQUEMENT avec le JSON finalisé, sans explication ni markdown. Assure-toi que chaque question respecte la limite de 45 caractères et que les styles SHORT/PARAGRAPH sont appropriés au type de question."
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 2048
      });
      
      const generatedForm = JSON.parse(completion.choices[0].message.content);
      
      // Log de génération IA
      await logToWebhookAndConsole(
        "🤖 Génération IA de formulaire", 
        `**${req.session.user.username}** a généré un formulaire par IA sur le serveur **${client.guilds.cache.get(guildId)?.name || guildId}**`,
        [
          { name: "Sujet", value: subject, inline: true },
          { name: "Questions", value: count.toString(), inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false },
          { name: "Restantes", value: `${rateLimitResult.remaining}/10 générations restantes`, inline: true }
        ],
        0x00FF00
      );
      
      res.json({ success: true, form: generatedForm, rateLimitInfo: rateLimitResult });
    } catch (error) {
      console.error('Erreur génération IA:', error);
      res.status(500).json({ error: 'Erreur lors de la génération IA: ' + error.message });
    }
  });
}

function setupGiftCodeApiRoutes(app, client) {
  // API pour utiliser un code cadeau
  app.post('/api/gift-code/redeem', isAuthenticated, async (req, res) => {
    const { giftCode, guildId } = req.body;
    
    if (!giftCode || !guildId) {
      return res.status(400).json({ error: 'Code cadeau et ID du serveur requis' });
    }
    
    try {
      // Recharger les codes cadeaux depuis le fichier pour avoir la version la plus récente
      reloadGiftCodes();
      
      // Normaliser le code (supprimer les espaces et mettre en majuscules)
      const normalizedCode = giftCode.trim().toUpperCase();
      
      // Vérifier si le code existe et n'est pas utilisé
      const code = giftCodes[normalizedCode];
      if (!code) {
        console.log(`Code non trouvé: ${normalizedCode}`);
        console.log('Codes disponibles:', Object.keys(giftCodes));
        return res.status(404).json({ error: 'Code cadeau invalide' });
      }
      
      if (code.used) {
        return res.status(410).json({ error: 'Ce code cadeau a déjà été utilisé' });
      }
      
      // Vérifier si le serveur n'est pas déjà premium
      if (client.premiumGuilds.includes(guildId)) {
        return res.status(409).json({ error: 'Ce serveur est déjà premium' });
      }
      
      // Vérifier les permissions de l'utilisateur sur le serveur
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Serveur introuvable' });
      }
      
      // Vérifier que l'utilisateur a les permissions sur le serveur
      const checkPermissions = async (retryCount = 0) => {
        try {
          const guildsResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
            headers: {
              Authorization: `Bearer ${req.session.accessToken}`
            }
          });

          const userGuild = guildsResponse.data.find(g => g.id === guildId);
          if (!userGuild) {
            return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce serveur' });
          }

          const permissions = BigInt(userGuild.permissions || 0);
          const hasManageMessages = (permissions & BigInt(0x2000)) !== BigInt(0);
          const hasAdmin = (permissions & BigInt(0x8)) !== BigInt(0);
          
          if (!hasManageMessages && !hasAdmin && !userGuild.owner) {
            return res.status(403).json({ error: 'Vous n\'avez pas les permissions nécessaires sur ce serveur' });
          }
          
          return true; // Permissions OK
        } catch (permError) {
          if (permError.response && permError.response.status === 429) {
            const retryAfter = (permError.response.data.retry_after || 1) * 1000;
            const maxRetries = 3;
            
            if (retryCount < maxRetries) {
              console.log(`Rate limit pour permissions, retry dans ${retryAfter}ms (tentative ${retryCount + 1}/${maxRetries})`);
              return new Promise(resolve => {
                setTimeout(async () => {
                  const result = await checkPermissions(retryCount + 1);
                  resolve(result);
                }, retryAfter);
              });
            }
          }
          return res.status(500).json({ error: 'Erreur lors de la vérification des permissions' });
        }
      };
      
      const permissionResult = await checkPermissions();
      if (permissionResult !== true) {
        return; // La réponse a déjà été envoyée
      }
      
      // Marquer le code comme utilisé
      giftCodes[normalizedCode].used = true;
      giftCodes[normalizedCode].usedBy = req.session.user.id;
      giftCodes[normalizedCode].usedAt = new Date().toISOString();
      giftCodes[normalizedCode].guildId = guildId;
      
      // Ajouter le serveur à la liste premium avec synchronisation
      const premiumModule = require('../../utils/premium.js');
      const addSuccess = premiumModule.addPremiumGuild(guildId, client);
      
      // Sauvegarder les codes cadeaux
      const saveCodesSuccess = premiumModule.saveGiftCodesWithRollback();
      
      // Vérifier que les sauvegardes ont réussi
      if (!addSuccess || !saveCodesSuccess) {
        // Annuler les changements en cas d'erreur
        giftCodes[normalizedCode].used = false;
        giftCodes[normalizedCode].usedBy = null;
        giftCodes[normalizedCode].usedAt = null;
        giftCodes[normalizedCode].guildId = null;
        
        premiumModule.removePremiumGuild(guildId, client);
        
        return res.status(500).json({ error: 'Erreur lors de la sauvegarde. Veuillez réessayer.' });
      }
      
      // Log de l'utilisation du code cadeau
      await logToWebhookAndConsole(
        "🎁 Code cadeau utilisé", 
        `**${req.session.user.username}** a utilisé un code cadeau pour passer le serveur **${guild.name}** en Premium`,
        [
          { name: "Code", value: giftCode, inline: true },
          { name: "Serveur", value: guild.name, inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false },
          { name: "Créé par", value: `<@${code.createdBy}>`, inline: true }
        ],
        0xFFD700
      );
      
      res.json({ success: true, message: 'Code cadeau activé avec succès' });
    } catch (error) {
      console.error('Erreur lors de l\'utilisation du code cadeau:', error);
      res.status(500).json({ error: 'Erreur lors de l\'utilisation du code cadeau' });
    }
  });

  // API pour obtenir l'URL du serveur de support
  app.get('/api/config/support', (req, res) => {
    const { config } = require('../../utils/config.js');
    res.json({ 
      supportUrl: config.supportServer?.inviteUrl || 'https://discord.gg/your-support-server',
      supportName: config.supportServer?.name || 'Serveur de Support MyForm'
    });
  });
}

module.exports = setupApiRoutes;
