const fs = require('fs-extra');
const path = require('path');

// Chemin vers le fichier de stockage des timestamps
const timestampsPath = path.join(__dirname, '../vote-timestamps.json');

// Map pour stocker les timestamps de vote
let voteTimestamps = new Map();

// Fonction pour charger les timestamps depuis le fichier
function loadVoteTimestamps() {
  try {
    if (fs.existsSync(timestampsPath)) {
      const data = fs.readJsonSync(timestampsPath);
      voteTimestamps.clear();
      
      // Convertir l'objet en Map
      if (data && typeof data === 'object') {
        Object.entries(data).forEach(([userId, timestamp]) => {
          voteTimestamps.set(userId, timestamp);
        });
      }
      
      console.log(`Timestamps de vote chargés: ${voteTimestamps.size} utilisateurs`);
    } else {
      console.log('Fichier vote-timestamps.json inexistant, création d\'une nouvelle base');
      saveVoteTimestamps();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des timestamps de vote:', error);
    voteTimestamps.clear();
  }
  return voteTimestamps;
}

// Fonction pour sauvegarder les timestamps dans le fichier
function saveVoteTimestamps() {
  try {
    // Convertir la Map en objet pour la sérialisation JSON
    const dataToSave = {};
    voteTimestamps.forEach((timestamp, userId) => {
      dataToSave[userId] = timestamp;
    });
    
    fs.writeJsonSync(timestampsPath, dataToSave, { spaces: 2 });
    console.log(`Timestamps de vote sauvegardés: ${Object.keys(dataToSave).length} utilisateurs`);
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des timestamps de vote:', error);
    return false;
  }
}

// Fonction pour enregistrer un timestamp de vote
function recordVoteTimestamp(userId) {
  const timestamp = Date.now();
  voteTimestamps.set(userId, timestamp);
  saveVoteTimestamps();
  return timestamp;
}

// Fonction pour obtenir le timestamp de vote d'un utilisateur
function getVoteTimestamp(userId) {
  return voteTimestamps.get(userId) || null;
}

// Fonction pour vérifier si un utilisateur peut recevoir un rappel
function canSendReminder(userId) {
  const lastVote = voteTimestamps.get(userId);
  if (!lastVote) return false;
  
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000; // 12 heures en millisecondes
  
  return (now - lastVote) >= twelveHours;
}

// Fonction pour obtenir les utilisateurs éligibles pour un rappel
function getUsersEligibleForReminder() {
  const eligible = [];
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000;
  
  for (const [userId, timestamp] of voteTimestamps.entries()) {
    if ((now - timestamp) >= twelveHours) {
      eligible.push({
        userId,
        lastVote: timestamp,
        timeSinceVote: now - timestamp
      });
    }
  }
  
  return eligible;
}

// Fonction pour supprimer un timestamp (après envoi du rappel)
function removeVoteTimestamp(userId) {
  const deleted = voteTimestamps.delete(userId);
  if (deleted) {
    saveVoteTimestamps();
  }
  return deleted;
}

// Nettoyer les anciens timestamps (plus de 24 heures)
function cleanOldTimestamps() {
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let hasChanges = false;
  
  for (const [userId, timestamp] of voteTimestamps.entries()) {
    if ((now - timestamp) > twentyFourHours) {
      voteTimestamps.delete(userId);
      hasChanges = true;
    }
  }
  
  if (hasChanges) {
    saveVoteTimestamps();
    console.log('Nettoyage automatique des anciens timestamps effectué');
  }
}

// Nettoyer automatiquement toutes les heures
setInterval(cleanOldTimestamps, 60 * 60 * 1000);

// Charger les timestamps au démarrage
loadVoteTimestamps();

module.exports = {
  loadVoteTimestamps,
  saveVoteTimestamps,
  recordVoteTimestamp,
  getVoteTimestamp,
  canSendReminder,
  getUsersEligibleForReminder,
  removeVoteTimestamp,
  cleanOldTimestamps,
  voteTimestamps
};
