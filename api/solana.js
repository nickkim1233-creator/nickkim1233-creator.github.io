// Reads Solana wallet positions: native SOL, SPL tokens, and stake accounts.
// Uses Solana's public RPC (free, no key) plus Jupiter token list for metadata.

const RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';

// Hardcoded list of well-known SPL tokens we want to surface with full metadata.
// (Full Jupiter token list is huge; we'll fetch metadata for unknowns separately if needed.)
const KNOWN_TOKENS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', kind: 'stable' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD', kind: 'stable' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade Staked SOL', kind: 'lst' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', name: 'Ether (Wormhole)', kind: 'wrapped', unwraps_to: 'ETH', from_chain: 'ethereum' },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', name: 'Jito Staked SOL', kind: 'lst' },
  'pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL': { symbol: 'pSOL', name: 'Phantom Staked SOL', kind: 'lst' },
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': { symbol: 'bSOL', name: 'BlazeStake Staked SOL', kind: 'lst' },
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh': { symbol: 'wBTC', name: 'Wrapped BTC (Wormhole)', kind: 'wrapped', unwraps_to: 'BTC', from_chain: 'bitcoin' },
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij': { symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', kind: 'wrapped', unwraps_to: 'BTC', from_chain: 'bitcoin' },
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E': { symbol: 'BTC', name: 'Bitcoin (Wormhole)', kind: 'wrapped', unwraps_to: 'BTC', from_chain: 'bitcoin' },
};

const CACHE = new Map();
const TTL_MS = 30_000;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!r.ok) throw new Error(`RPC ${method} failed: ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'Missing address' });

  const cacheKey = address;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    // 1. Native SOL balance
    const balResp = await rpc('getBalance', [address]);
    const solBalance = (balResp.value || 0) / 1e9;

    // 2. SPL token accounts owned by this wallet
    const tokensResp = await rpc('getTokenAccountsByOwner', [
      address,
      { programId: TOKEN_PROGRAM },
      { encoding: 'jsonParsed' }
    ]);
    const tokens = [];
    for (const acc of (tokensResp.value || [])) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const mint = info.mint;
      const amount = info.tokenAmount;
      const balance = parseFloat(amount?.uiAmountString || '0');
      if (balance <= 0) continue;
      const known = KNOWN_TOKENS[mint] || null;
      tokens.push({
        mint,
        balance,
        decimals: amount?.decimals ?? 0,
        symbol: known?.symbol || mint.slice(0, 4) + '…',
        name: known?.name || 'Unknown SPL Token',
        kind: known?.kind || 'token',
        unwraps_to: known?.unwraps_to || null,
        from_chain: known?.from_chain || null,
      });
    }

    // 3. Stake accounts (native SOL staking)
    let stakeAccounts = [];
    try {
      // Get stake accounts with this wallet as the withdraw authority
      const stakeResp = await rpc('getProgramAccounts', [
        STAKE_PROGRAM,
        {
          encoding: 'jsonParsed',
          filters: [
            { memcmp: { offset: 44, bytes: address } } // withdrawer authority offset
          ]
        }
      ]);
      stakeAccounts = (stakeResp || []).map(acc => {
        const lamports = acc.account?.lamports || 0;
        const stakeInfo = acc.account?.data?.parsed?.info?.stake?.delegation;
        return {
          pubkey: acc.pubkey,
          balance: lamports / 1e9,
          activationEpoch: stakeInfo?.activationEpoch,
          deactivationEpoch: stakeInfo?.deactivationEpoch,
          voter: stakeInfo?.voter,
        };
      }).filter(s => s.balance > 0);
    } catch (e) {
      // Stake account fetching can occasionally rate-limit; not fatal
    }

    const data = {
      address,
      native: { symbol: 'SOL', balance: solBalance },
      tokens,
      stakeAccounts,
    };
    CACHE.set(cacheKey, { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
