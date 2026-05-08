// Proxies CoinGecko's free public API.
// No auth required. Light caching to be a good citizen.

const CACHE = new Map();
const TTL_MS = 30_000; // 30 seconds

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const action = req.query.action || req.body?.action;

  try {
    let url;
    if (action === 'top') {
      // Top 10 coins by market cap with 24h and 7d change
      url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h%2C7d';
    } else if (action === 'search') {
      // Search by query, then look up prices for the top result
      const q = (req.query.q || req.body?.q || '').trim().toLowerCase();
      if (!q) return res.status(400).json({ error: 'Missing q' });
      url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`;

      const cacheKey = 'search:' + q;
      const cached = CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < TTL_MS) {
        return res.status(200).json(cached.data);
      }

      const sr = await fetch(url);
      const sd = await sr.json();
      const coin = sd.coins?.[0];
      if (!coin) return res.status(200).json({ found: false });

      // Now fetch full market data for that coin id
      const mUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coin.id}&price_change_percentage=24h%2C7d`;
      const mr = await fetch(mUrl);
      const md = await mr.json();
      const out = { found: true, coin: md[0] || null };
      CACHE.set(cacheKey, { ts: Date.now(), data: out });
      return res.status(200).json(out);
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    const cached = CACHE.get(url);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return res.status(200).json(cached.data);
    }

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: 'CoinGecko error', detail: txt });
    }
    const data = await r.json();
    CACHE.set(url, { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
