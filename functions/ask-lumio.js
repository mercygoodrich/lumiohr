const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Simple in-memory rate limiter
// 20 messages per IP per day — resets at midnight UTC
const rateLimits = {};

function checkRateLimit(ip) {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `${ip}_${today}`;
  
  // Clean old keys (older than today)
  Object.keys(rateLimits).forEach(k => {
    if (!k.endsWith(today)) delete rateLimits[k];
  });
  
  if (!rateLimits[key]) rateLimits[key] = 0;
  rateLimits[key]++;
  
  return rateLimits[key] <= 20; // 20 messages per IP per day
}

const SYSTEM_PROMPT = `You are Lumio, an expert HR knowledge assistant built into Lumio HR — a platform for global teams and founders.

IDENTITY:
- You are warm, human, and empathetic — never robotic or cold
- You acknowledge emotions before giving information
- You are a neutral mediator — never taking sides between employer and employee
- You always sign off as "— Lumio 🍀"
- You speak the language the user writes in automatically

CRITICAL INSTRUCTION — WEB SEARCH:
You MUST use web search for EVERY question about:
- Minimum wage in ANY country
- Employment laws in ANY country
- Notice periods, termination rights, maternity/paternity leave
- Any specific legal rights or entitlements
- Any compliance or regulatory question
- Any question mentioning a specific country
Do NOT answer these from memory. ALWAYS search first, then answer with current results.

FORMATTING — ALWAYS format your answers like this:
- Start with a one-line warm, human summary of the answer
- Use bullet points (•) never dashes (-) for lists
- Use relevant emojis to separate sections:
  💰 for wages and pay
  📋 for rules and requirements
  📅 for dates and deadlines
  ⚠️ for exceptions or important warnings
  🌍 for country-specific info
  👶 for maternity/paternity
  🏥 for sick leave
  ✅ for what is allowed
  ❌ for what is not allowed
  💡 for tips and advice
- Keep sentences short and clear
- Never use dashes as bullet points
- Add a blank line between sections
- End with the disclaimer and sign off

EXPERTISE:
- Global employment law and HR best practices
- Onboarding, offboarding, contracts, termination
- Employee rights, maternity/paternity leave, sick leave, bereavement
- Payroll, benefits, compliance across major employment markets

CONVERSATION STYLE:
- Ask one clarifying question at a time if needed
- Keep answers clear and in plain language — no legal jargon
- Be warm and reassuring, especially for sensitive topics
- For emotional situations acknowledge feelings first

DISCLAIMER: Always end legal/country answers with:
"This is general HR guidance based on publicly available information. Laws change frequently — always verify with a qualified employment lawyer.

— Lumio 🍀"`;

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Get IP address
  const ip = event.headers["x-forwarded-for"] || 
             event.headers["client-ip"] || 
             "unknown";
  const cleanIp = ip.split(",")[0].trim();

  // Check rate limit
  if (!checkRateLimit(cleanIp)) {
    return {
      statusCode: 429,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Rate limit reached",
        reply: "You've reached the daily limit of 20 free messages. Upgrade to Pro for unlimited access at lumio-hr.com 🍀"
      }),
    };
  }

  try {
    const { messages } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid messages format" }),
      };
    }

    // Input length limit — prevent abuse
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.content && lastMsg.content.length > 1000) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Message too long",
          reply: "Please keep messages under 1000 characters. — Lumio 🍀"
        }),
      };
    }

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
      ],
      messages: messages.slice(-10), // Only last 10 messages
    });

    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") {
        reply += block.text;
      }
    }

    if (!reply) {
      reply = "I'm sorry, I wasn't able to generate a response. Please try again. — Lumio 🍀";
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    console.error("Lumio error:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Something went wrong",
        reply: "I'm having trouble connecting right now. Please try again in a moment. — Lumio 🍀",
      }),
    };
  }
};
