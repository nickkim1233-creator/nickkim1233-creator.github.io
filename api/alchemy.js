// Proxies Alchemy's EVM token balances API.
// Free tier: 300M compute units/month — plenty for portfolio use.

const CACHE = new Map();
const TTL_MS = 30_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address, network } = req.body || {};
  if (!address) return res.status(400).json({ error: 'Missing address' });

  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return res.status(500).json({ error: 'ALCHEMY_API_KEY not configured' });

  // Default to Ethereum mainnet, support a couple of EVM chains
  const networks = {
    ethereum: 'eth-mainnet',
    base:     'base-mainnet',
    polygon:  'polygon-mainnet',
    arbitrum: 'arb-mainnet',
  };
  const net = networks[network || 'ethereum'] || networks.ethereum;
  const cacheKey = `${net}:${address}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return res.status(200).json(cached.data);
  }

  const url = `https://${net}.g.alchemy.com/v2/${key}`;

  try {
    // 1. Get native balance
    const nativeRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getBalance',
        params: [address, 'latest']
      })
    });
    const nativeJson = await nativeRes.json();
    const nativeBalanceWei = parseInt(nativeJson.result || '0x0', 16);
    const nativeBalance = nativeBalanceWei / 1e18;

    // 2. Get ERC-20 token balances
    const tokenRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'alchemy_getTokenBalances',
        params: [address]
      })
    });
    const tokenJson = await tokenRes.json();
    const rawBalances = (tokenJson.result?.tokenBalances || [])
      .filter(t => t.tokenBalance && t.tokenBalance !== '0x' && parseInt(t.tokenBalance, 16) > 0);

    // 3. Get metadata for tokens with positive balance (cap at 25 to keep it fast)
    const tokens = [];
    const limited = rawBalances.slice(0, 25);
    for (const t of limited) {
      try {
        const metaRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 3, method: 'alchemy_getTokenMetadata',
            params: [t.contractAddress]
          })
        });
        const metaJson = await metaRes.json();
        const meta = metaJson.result || {};
        const decimals = meta.decimals ?? 18;
        const balRaw = parseInt(t.tokenBalance, 16);
        const balance = balRaw / Math.pow(10, decimals);
        if (balance > 0 && meta.symbol) {
          tokens.push({
            contract: t.contractAddress,
            symbol: meta.symbol,
            name: meta.name || meta.symbol,
            balance,
            decimals,
            logo: meta.logo || null
          });
        }
      } catch {}
    }

    const data = {
      network: network || 'ethereum',
      address,
      native: { symbol: 'ETH', balance: nativeBalance },
      tokens
    };
    CACHE.set(cacheKey, { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
