// Import de toutes les routes
const authRoutes = require('./auth.js');
const formRoutes = require('./forms.js');
const apiRoutes = require('./api.js');
const paymentRoutes = require('./payments.js');
const staticRoutes = require('./static.js');
const webhookRoutes = require('./webhooks.js');

function setupRoutes(app, client) {
  // Routes d'authentification
  authRoutes(app, client);
  
  // Routes des formulaires
  formRoutes(app, client);
  
  // Routes API
  apiRoutes(app, client);
  
  // Routes de paiement
  paymentRoutes(app, client);
  
  // Routes de webhooks
  webhookRoutes.setupWebhookRoutes(app, client);
  
  // Routes statiques
  staticRoutes(app, client);
}

module.exports = {
  setupRoutes
};
