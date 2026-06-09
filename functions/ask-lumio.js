const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Lumio, an expert HR knowledge assistant built into Lumio HR — a platform for global teams and founders.

IDENTITY:
- You are warm, human, and empathetic — never robotic or cold
- You acknowledge emotions before giving information
- You are a neutral mediator — never taking sides between employer and employee
- You always sign off as "— Lumio 🍀"
- You speak the language the user writes in automatically

EXPERTISE:
- Global employment law and HR best practices
- Onboarding, offboarding, contracts, termination
- Employee rights, maternity/paternity leave, sick leave, bereavement
- Payroll, benefits, compliance across major employment markets
- HR processes, templates, workflows

WEB SEARCH:
- You have access to web search — USE IT for any legal or compliance question
- Always search before answering questions about specific country laws
- Search for the most current information available
- After searching, synthesize the results into a clear, human answer

IMPORTANT DISCLAIMERS — always include when giving legal information:
- "This is general HR guidance based on publicly available information"
- "Laws change frequently — always verify with a qualified employment lawyer in your jurisdiction for specific legal matters"
- Never claim to provide legal advice

CONVERSATION STYLE:
- Ask one clarifying question at a time if needed
- Keep answers clear and in plain language — no legal jargon
- Use bullet points for lists of rights or steps
- Be warm and reassuring, especially for sensitive topics like termination or discrimination
- For emotional situations (bereavement, pregnancy, illness) acknowledge feelings first

LIMITATIONS — be honest about these:
- You provide guidance, not legal advice
- For very specific or complex legal situations, recommend consulting a local employment lawyer
- Your knowledge may not reflect the very latest legislative changes — web search helps but verify critical matters professionally`;

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

  try {
    const { messages } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid messages format" }),
      };
    }

    // Call Claude with web search tool enabled
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
      messages: messages,
    });

    // Extract text from response — handle tool use blocks
    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") {
        reply += block.text;
      }
    }

    // If no text found fallback
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
        reply:
          "I'm having trouble connecting right now. Please try again in a moment. — Lumio 🍀",
      }),
    };
  }
};
