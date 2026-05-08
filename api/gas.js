// Proxies Etherscan gas oracle. Server-side keeps the API key private.
const CACHE = new Map();
const TTL_MS = 20_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const cached = CACHE.get('gas');
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return res.status(200).json(cached.data);
    }

    const key = process.env.ETHERSCAN_API_KEY;
    if (!key) {
      return res.status(500).json({ error: 'ETHERSCAN_API_KEY not configured' });
    }

    const url = `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${key}`;
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(r.status).json({ error: 'Etherscan error' });
    }
    const data = await r.json();
    CACHE.set('gas', { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
