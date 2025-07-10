const path = require('path');
const { isAuthenticated } = require('../middleware/auth.js');

function setupStaticRoutes(app, client) {
  // Page d'accueil
  app.get('/', (req, res) => {
    if (req.session.user) {
      res.redirect('/dashboard');
    } else {
      res.sendFile(path.join(__dirname, '../../public', 'index.html'));
    }
  });

  // Routes authentifiées
  app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'dashboard.html'));
  });

  app.get('/success', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'success.html'));
  });

  app.get('/premium', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'premium.html'));
  });

  app.get('/webhook-status', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'webhook-status.html'));
  });

  // Routes publiques
  app.get('/error', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'error.html'));
  });

  app.get('/blacklisted', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'blacklisted.html'));
  });

  app.get('/payment-success', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'payment-success.html'));
  });

  app.get('/payment-cancel', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'payment-cancel.html'));
  });

  app.get('/token-used', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'token-used.html'));
  });

  // Routes des documents légaux
  app.get('/terms-of-service', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'terms-of-service.html'));
  });

  app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'privacy-policy.html'));
  });

  app.get('/terms-of-sale', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'terms-of-sale.html'));
  });
}

module.exports = setupStaticRoutes;
