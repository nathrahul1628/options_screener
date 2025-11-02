import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tickers, technical_data } = req.body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'tickers array is required' 
      });
    }

    if (!technical_data || !Array.isArray(technical_data)) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'technical_data array is required' 
      });
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Build prompt for Claude
    const prompt = buildPrompt(tickers, technical_data);

    // Call Claude API
    const message = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    // Parse response
    const responseText = message.content[0].text;
    
    // Try to parse as JSON
    let signals;
    try {
      signals = JSON.parse(responseText);
    } catch (parseError) {
      // If not valid JSON, try to extract JSON from markdown
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        signals = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Could not parse Claude response as JSON');
      }
    }

    return res.status(200).json({
      signals: signals.signals || signals,
      analysis_timestamp: new Date().toISOString(),
      model_used: "claude-3-5-haiku-20241022"
    });

  } catch (error) {
    console.error('Error analyzing stocks:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

function buildPrompt(tickers, technical_data) {
  const stocksInfo = technical_data.map(stock => {
    const parts = [
      `Ticker: ${stock.ticker}`,
      `Price: $${safeNumber(stock.current_price, 2)}`,
      `Technical Score: ${safeNumber(stock.technical_score, 0)}/100`,
      `RSI: ${safeNumber(stock.rsi, 1)}`,
      `MACD: ${safeNumber(stock.macd, 4)}`,
      `Volume Ratio: ${safeNumber(stock.volume_ratio, 2)}x`,
      `Reasons: ${stock.score_reasons?.join(', ') || 'N/A'}`
    ];

    // Add options data if available
    if (stock.options) {
      parts.push(`\nOptions Data:`);
      parts.push(`  Strike: $${safeNumber(stock.options.strike, 2)}`);
      parts.push(`  Expiration: ${stock.options.expiration || 'N/A'}`);
      parts.push(`  IV: ${safeNumber(stock.options.implied_vol, 1)}%`);
      parts.push(`  IV Rank: ${safeNumber(stock.options.iv_rank, 0)}/100`);
      parts.push(`  Spread: $${safeNumber(stock.options.spread, 2)} (${safeNumber(stock.options.spread_pct, 1)}%)`);
      parts.push(`  Volume: ${safeNumber(stock.options.volume, 0)}`);
      parts.push(`  Open Interest: ${safeNumber(stock.options.open_interest, 0)}`);
      
      if (stock.options.delta !== null && stock.options.delta !== undefined) {
        parts.push(`  Delta: ${safeNumber(stock.options.delta, 2)}`);
      }
      if (stock.options.theta !== null && stock.options.theta !== undefined) {
        parts.push(`  Theta: $${safeNumber(stock.options.theta, 2)}/day`);
      }
    }

    return parts.join('\n');
  }).join('\n\n---\n\n');

  return `You are an expert options trader analyzing call option opportunities.

Analyze these stocks and provide a JSON response with trading signals.

STOCKS DATA:
${stocksInfo}

INSTRUCTIONS:
1. Evaluate each stock's potential for call options
2. Consider: technical score, momentum (RSI, MACD), volume, and options data if provided
3. Rate each 0-10 (10 = strongest buy signal)
4. Provide signal: "STRONG BUY" (9-10), "BUY" (7-8), "HOLD" (5-6), or "AVOID" (0-4)
5. Recommend strike price (10% OTM) and expiration (3 months)
6. Give brief reasoning (max 100 words)

If options data is provided:
- Prefer stocks with IV < 40% (not overpriced)
- Prefer IV Rank < 50 (good entry timing)
- Prefer tight spreads < 3% (liquid)
- Prefer high open interest > 1,000 (tradeable)

REQUIRED JSON FORMAT:
{
  "signals": [
    {
      "ticker": "AAPL",
      "score": 8,
      "signal": "BUY",
      "callOption": {
        "strikePrice": "245.50",
        "expiration": "Feb 21, 2026",
        "reasoning": "Consider IV and liquidity if options data provided"
      },
      "recommendation": "Brief analysis here (max 100 words)"
    }
  ]
}

Respond with ONLY valid JSON. No markdown, no code blocks, just pure JSON.`;
}

// Helper function to safely format numbers
function safeNumber(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }
  return Number(value).toFixed(decimals);
}
