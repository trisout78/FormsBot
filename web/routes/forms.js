const path = require('path');
const { isAuthenticated, hasGuildPermission } = require('../middleware/auth.js');

function setupFormRoutes(app, client) {
  // Route pour créer un nouveau formulaire
  app.get('/create/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId } = req.params;
    const formsForGuild = client.forms[guildId] || {};
    const formCount = Object.keys(formsForGuild).length;
    const isPremium = client.premiumGuilds.includes(guildId);
    
    // Si limite atteinte et non premium
    if (!isPremium && formCount >= 3) {
      return res.status(403).sendFile(path.join(__dirname, '../../public', 'error.html'));
    }
    
    res.sendFile(path.join(__dirname, '../../public', 'editor.html'));
  });

  // Route pour modifier un formulaire existant
  app.get('/edit/:guildId/:formId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId, formId } = req.params;
    const form = client.forms[guildId]?.[formId];
    
    if (!form) {
      return res.status(404).send('Formulaire introuvable');
    }
    
    res.sendFile(path.join(__dirname, '../../public', 'editor.html'));
  });
}

module.exports = setupFormRoutes;
