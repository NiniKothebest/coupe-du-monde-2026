// api/odds.js — Proxy serverless Vercel pour The Odds API
//
// ⚠️  La clé API ne doit JAMAIS apparaître dans ce fichier.
//     Elle est lue depuis la variable d'environnement ODDS_API_KEY,
//     configurée dans Vercel Dashboard > Settings > Environment Variables.
//
// Routes : GET /api/odds
// - Appelle the-odds-api.com côté serveur avec la clé secrète
// - Cache la réponse 6 heures en mémoire (économise le quota mensuel)
// - Retourne un cache périmé plutôt qu'une erreur si l'API est indisponible

/** Cache en mémoire (partagé entre invocations du même container chaud). */
let _data = null;
let _exp  = 0;
const TTL = 6 * 60 * 60 * 1000; // 6 heures en millisecondes

export default async function handler(req, res) {
  // Uniquement les requêtes GET
  if (req.method !== 'GET') return res.status(405).end();

  // ── Cache valide → répondre immédiatement ──
  if (_data && Date.now() < _exp) {
    res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_data);
  }

  // ── Lire la clé depuis l'environnement ──
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    // La variable n'est pas configurée : répondre 503 (le front basculera en mode modèle)
    return res.status(503).json({ error: 'ODDS_API_KEY not configured' });
  }

  // ── Appeler The Odds API ──
  const url =
    'https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/' +
    `?apiKey=${apiKey}` +
    '&regions=eu' +
    '&markets=h2h' +
    '&oddsFormat=decimal';

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(10_000), // timeout 10 s
    });

    if (!upstream.ok) {
      // Quota dépassé (429) ou autre erreur upstream
      // → servir le cache périmé si disponible, sinon erreur silencieuse
      if (_data) {
        res.setHeader('X-Cache', 'STALE');
        return res.status(200).json(_data);
      }
      return res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
    }

    const json = await upstream.json();

    // Mettre en cache
    _data = json;
    _exp  = Date.now() + TTL;

    res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(json);

  } catch (err) {
    // Réseau ou timeout → cache périmé ou mode dégradé silencieux
    if (_data) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json(_data);
    }
    return res.status(503).json({ error: 'Service unavailable' });
  }
}
