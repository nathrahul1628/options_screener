// =============================================================================
// VERCEL BACKEND - HAIKU ENDPOINT
// File: /api/analyze-haiku.js
// 
// This endpoint receives pre-analyzed technical data from your Python script
// and uses Claude Haiku 4.5 to provide final AI scoring and recommendations.
// 
// Cost: ~$0.02 per stock (67% cheaper than Sonnet)
// Speed: ~3 seconds per stock
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tickers, technical_data } = req.body;

  if (!tickers || !Array.isArray(tickers)) {
    return res.status(400).json({ 
      error: 'Invalid request. Please provide tickers array.' 
    });
  }

  if (!technical_data || !Array.isArray(technical_data)) {
    return res.status(400).json({ 
      error: 'Invalid request. Please provide technical_data array.' 
    });
  }

  console.log(`🔍 Analyzing ${tickers.length} tickers with Claude Haiku 4.5...`);
  console.log(`Cost estimate: $${(tickers.length * 0.02).toFixed(2)}`);

  try {
    const signals = [];
    
    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      const techData = technical_data[i];
      
      console.log(`📊 Analyzing ${ticker}...`);
      
      // Calculate 10% OTM strike
      const currentPrice = techData.current_price;
      const otmStrike = (currentPrice * 1.10).toFixed(2);
      
      // Calculate 3-4 month expiration
      const today = new Date();
      const expirationDate = new Date(today);
      expirationDate.setMonth(today.getMonth() + 3);
      const expiration = expirationDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      
      // Create prompt with pre-calculated data (NO web searches needed)
      const prompt = `You are an expert options trading analyst. Based on the technical data below, provide a final assessment for naked call buying.

STOCK: ${ticker}
CURRENT PRICE: $${currentPrice}

TECHNICAL INDICATORS:
- RSI (14-day): ${techData.rsi}
- MACD: ${techData.macd.toFixed(4)}
- MACD Signal: ${techData.macd_signal.toFixed(4)}
- MACD Histogram: ${techData.macd_histogram.toFixed(4)}
- 20-day SMA: $${techData.sma_20}
- 50-day SMA: $${techData.sma_50}
- Bollinger Upper: $${techData.bb_upper}
- Bollinger Lower: $${techData.bb_lower}
- Volume vs Average: ${techData.volume_ratio}x
- Days Until Earnings: ${techData.days_until_earnings || 'Unknown (safe)'}

PYTHON TECHNICAL SCORE: ${techData.technical_score}/100
SCORING REASONS: ${techData.score_reasons.join('; ')}

ASSESSMENT CRITERIA:
- Conservative scoring (8/10 minimum for BUY)
- 10+ days until earnings required
- Focus on momentum + trend alignment
- Risk-adjusted recommendations

Provide your assessment in EXACTLY this JSON format (no markdown, no extra text):
{
  "ticker": "${ticker}",
  "signal": "STRONG BUY | BUY | HOLD | AVOID",
  "score": 0-10,
  "callOption": {
    "strikePrice": "${otmStrike}",
    "expiration": "${expiration}"
  },
  "recommendation": "Brief 1-2 sentence recommendation focusing on entry timing and setup quality",
  "risks": ["risk 1", "risk 2", "risk 3"]
}

Rules:
- STRONG BUY: 9-10 (excellent setup, all indicators aligned)
- BUY: 7-8 (good setup, most indicators positive)
- HOLD: 5-6 (mixed signals, wait for confirmation)
- AVOID: 0-4 (poor setup or elevated risk)
- Keep recommendation under 150 characters
- List 2-3 specific risks
- Be conservative - favor HOLD over BUY if uncertain`;

      try {
        const message = await client.messages.create({
          model: "claude-haiku-4-5-20251001",  // ✅ Correct - Latest Haiku",  // Haiku 4.5 - fast & cheap
          max_tokens: 1024,
          temperature: 0.3,  // Lower temperature for consistent scoring
          messages: [{
            role: "user",
            content: prompt
          }]
        });

        const responseText = message.content[0].text;
        
        // Parse JSON response (strip any markdown if present)
        const cleanedResponse = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          
          // Add technical score for reference
          analysis.technicalScore = techData.technical_score;
          analysis.company = techData.company || ticker;
          
          signals.push(analysis);
          
          console.log(`✓ ${ticker}: ${analysis.signal} (${analysis.score}/10)`);
        } else {
          console.error(`Failed to parse JSON for ${ticker}`);
          signals.push({
            ticker,
            error: "Could not parse AI response",
            signal: "ERROR",
            score: 0
          });
        }

      } catch (error) {
        console.error(`Error analyzing ${ticker}:`, error.message);
        signals.push({
          ticker,
          error: error.message,
          signal: "ERROR",
          score: 0
        });
      }
    }

    // Sort by AI score (highest first)
    signals.sort((a, b) => (b.score || 0) - (a.score || 0));

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      model: "claude-haiku-4.5",
      signals,
      summary: {
        total: signals.length,
        strongBuy: signals.filter(s => s.signal === 'STRONG BUY').length,
        buy: signals.filter(s => s.signal === 'BUY').length,
        hold: signals.filter(s => s.signal === 'HOLD').length,
        avoid: signals.filter(s => s.signal === 'AVOID').length,
        errors: signals.filter(s => s.signal === 'ERROR').length
      },
      cost_estimate: `$${(tickers.length * 0.02).toFixed(2)}`
    };

    console.log('✅ Haiku analysis complete');
    console.log(`Summary: ${response.summary.strongBuy} Strong Buy, ${response.summary.buy} Buy`);
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    return res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
