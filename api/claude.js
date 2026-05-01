export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic CORS — restrict to your actual domain in production
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { system, messages, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: max_tokens || 1000,
        system,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("ANTHROPIC ERROR:", data);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
console.log("API KEY:", process.env.ANTHROPIC_API_KEY);
console.log("KEY LENGTH:", process.env.ANTHROPIC_API_KEY?.length);
