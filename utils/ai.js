const OpenAI = require('openai');
const { config } = require('./config.js');

// Initialize OpenAI
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Rate limiting pour l'IA - 10 requêtes par heure par utilisateur
const aiRateLimit = new Map(); // userId -> { count, resetTime }

function checkAIRateLimit(userId) {
  const now = Date.now();
  const userLimit = aiRateLimit.get(userId);
  
  // Si pas d'entrée ou si l'heure est passée, reset
  if (!userLimit || now > userLimit.resetTime) {
    aiRateLimit.set(userId, {
      count: 1,
      resetTime: now + (60 * 60 * 1000) // 1 heure
    });
    return { allowed: true, remaining: 9, resetTime: now + (60 * 60 * 1000) };
  }
  
  // Si limite atteinte
  if (userLimit.count >= 10) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetTime: userLimit.resetTime,
      timeLeft: Math.ceil((userLimit.resetTime - now) / (60 * 1000)) // minutes restantes
    };
  }
  
  // Incrémenter le compteur
  userLimit.count++;
  aiRateLimit.set(userId, userLimit);
  
  return { 
    allowed: true, 
    remaining: 10 - userLimit.count, 
    resetTime: userLimit.resetTime 
  };
}

// Nettoyer les anciennes entrées toutes les heures
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of aiRateLimit.entries()) {
    if (now > data.resetTime) {
      aiRateLimit.delete(userId);
    }
  }
}, 60 * 60 * 1000);

async function generateReviewResponse(isAccept, formTitle, reason = null, instructions = null, feedback = null, embedContent = null) {
  try {
    const action = isAccept ? 'acceptation' : 'refus';
    const actionPast = isAccept ? 'acceptée' : 'refusée';
    
    let prompt = `Tu es un assistant IA qui aide à rédiger des messages ${isAccept ? 'd\'acceptation' : 'de refus'} pour des formulaires Discord de manière professionnelle et bienveillante.

Contexte:
- Formulaire: "${formTitle}"
- Action: ${action}
- Description du formulaire: "${embedContent}"
- Ton: ${isAccept ? 'Positif et encourageant' : 'Respectueux et constructif'}`;

    if (reason && reason.trim()) {
      prompt += `\n- MOTIF PRINCIPAL À MENTIONNER OBLIGATOIREMENT: ${reason}`;
      prompt += `\n- Tu DOIS absolument expliquer ce motif dans ton message de manière claire`;
    }
    
    if (instructions && instructions.trim()) {
      prompt += `\n- Instructions particulières: ${instructions}`;
    }
    
    if (feedback && feedback.trim()) {
      prompt += `\n- RETOUR UTILISATEUR IMPORTANT À INCORPORER ABSOLUMENT: ${feedback}`;
      prompt += `\n- Tu DOIS prendre en compte ce retour et adapter ton message en conséquence.`;
    }

    prompt += `\n\nRédige un message ${isAccept ? 'd\'acceptation' : 'de refus'} professionnel et bienveillant. Le message doit être:
- Clair et direct`;

    if (reason && reason.trim()) {
      prompt += `\n- OBLIGATOIREMENT mentionner et expliquer le motif: "${reason}"`;
    }

    prompt += `\n- ${isAccept ? 'Féliciter l\'utilisateur' : 'Respectueux malgré le refus'}
- Personnalisé selon le contexte fourni`;

    if (feedback && feedback.trim()) {
      prompt += `\n- IMPÉRATIVEMENT adapté selon le retour utilisateur fourni ci-dessus`;
    }

    prompt += `\n- En français
- Entre 50 et 200 mots
- Sans utiliser de markdown (pas de **gras** ou *italique*)

${isAccept ? 'Commence par féliciter l\'utilisateur pour son acceptation.' : 'Commence par remercier l\'utilisateur pour sa réponse.'}`;

    if (reason && reason.trim()) {
      prompt += `\n\nIMPORTANT: Le motif "${reason}" doit être clairement expliqué dans ta réponse. C'est la raison principale de l'${action}.`;
    }

    if (feedback && feedback.trim()) {
      prompt += `\n\nATTENTION: Assure-toi de bien incorporer le retour utilisateur "${feedback}" dans ta réponse. C'est une demande spécifique qui doit être prise en compte.`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es un assistant IA spécialisé dans la rédaction de messages professionnels et bienveillants pour des formulaires Discord. Tu dois toujours répondre en français et de manière appropriée au contexte. 

RÈGLES IMPORTANTES:
1. Quand un utilisateur te donne un retour spécifique, tu DOIS absolument en tenir compte dans ta réponse.
2. Quand un motif/raison est fourni, tu DOIS l'expliquer clairement dans ton message.
3. Le motif est la raison principale de l'acceptation/refus et doit être mentionné de façon évidente.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 350,
      temperature: 0.6
    });

    const response = completion.choices[0].message.content.trim();
    
    // Nettoyer la réponse de tout markdown résiduel
    const cleanResponse = response
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1');

    return {
      success: true,
      message: cleanResponse
    };
  } catch (error) {
    console.error('Erreur lors de la génération de la réponse IA:', error);
    return {
      success: false,
      error: 'Erreur lors de la génération de la réponse IA'
    };
  }
}

module.exports = {
  openai,
  checkAIRateLimit,
  generateReviewResponse
};
