const config = require('../config.json');
const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;

module.exports = {
  config,
  baseUrl
};
