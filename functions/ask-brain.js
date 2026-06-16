const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COMPANY_ID = "2db68ac5-3e3c-4774-a194-6e1d08504384";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPTS = {
  employee: `You are LumioHR Brain, helping an EMPLOYEE understand their rights and company policies.
- Explain policies in plain, friendly language
- Compare company policy to the law
- Cite sources clearly
- Be empowering and supportive`,
  manager: `You are LumioHR Brain, helping a MANAGER with policies and compliance.
- Explain policies clearly
- Flag compliance risks
- Suggest actions
- Be professional and precise`,
  admin: `You are LumioHR Brain, helping HR/Admin spot gaps and manage policies.
- Check policies against law
- Identify gaps
- Suggest improvements
- Be thorough and careful`,
};

exports.handler = async (event) => {
  console.log("[ask-brain] Handler called");
  console.log("[ask-brain] Body:", event.body);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "OK",
    };
  }

  try {
    // 1. Parse request
    let question, role;
    try {
      const body = JSON.parse(event.body);
      question = body.question;
      role = body.role || "employee";
      console.log(`[ask-brain] Question: ${question}`);
      console.log(`[ask-brain] Role: ${role}`);
    } catch (e) {
      console.error("[ask-brain] JSON parse error:", e);
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Invalid request format",
          reply: "I couldn't understand your request. Please try again.",
        }),
      };
    }

    // 2. Get system prompt for role
    const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.employee;
    console.log(`[ask-brain] Using ${role} system prompt`);

    // 3. Query Supabase chunks table for company content
    console.log(`[ask-brain] Querying Supabase chunks for company ${COMPANY_ID}`);
    let docContext = "";
    
    try {
      const { data: chunks, error } = await supabase
        .from("chunks")
        .select("content")
        .eq("company_id", COMPANY_ID)
        .limit(20);

      if (error) {
        console.error("[ask-brain] Supabase error:", error);
      } else if (chunks && chunks.length > 0) {
        console.log(`[ask-brain] Found ${chunks.length} content chunks`);
        docContext =
          "\n\nCOMPANY POLICIES (from knowledge base):\n" +
          chunks
            .map((c) => c.content || "")
            .join("\n");
      } else {
        console.log("[ask-brain] No chunks found in Supabase");
      }
    } catch (e) {
      console.error("[ask-brain] Supabase query failed:", e.message);
      docContext = "";
    }

    // 4. Build user message with context
    const userMessage = `${question}\n\nCompany context:\n${
      docContext || "[No company documents found in knowledge base]"
    }\n\nBased on the company policies above, answer the question. If the policies don't address it, explain what information would be needed.`;

    console.log(`[ask-brain] Calling Claude API with ${docContext.length} chars of context`);

    // 5. Call Claude
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    console.log(`[ask-brain] Claude response received`);

    // 6. Extract text from response
    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") {
        reply += block.text;
      }
    }

    if (!reply) {
      reply =
        "I wasn't able to generate a response. Please try again. — LumioHR";
    }

    console.log(`[ask-brain] Success - returning reply`);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: reply }),
    };
  } catch (error) {
    console.error("[ask-brain] Fatal error:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message,
        reply: "I'm having trouble connecting right now. Please try again. — LumioHR",
      }),
    };
  }
};
