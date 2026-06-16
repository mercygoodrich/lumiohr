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

// Helper: Find employee by name (case-insensitive)
function findEmployeeInQuestion(question, employees) {
  const lowerQuestion = question.toLowerCase();
  for (const emp of employees) {
    const firstName = emp.name.toLowerCase().split(" ")[0];
    if (lowerQuestion.includes(firstName)) {
      return emp;
    }
  }
  return null;
}

// Role-specific system prompts
const SYSTEM_PROMPTS = {
  employee: `You are Lumio Brain, speaking to an EMPLOYEE.
YOUR ROLE:
   Help employees understand their rights
   Explain company policies in plain language
   Research current labor laws for their country
   Suggest actions they can take
   Empower them with knowledge
TONE: Warm, supportive, empowering
IF THE POLICY OR LAW IS UNCLEAR:
   Provide three action steps:
      1. Confirm with your manager: Explain how to frame the conversation
      2. Check with HR: Suggest what documents to ask for
      3. Consider legal counsel: Explain when this is necessary
ALWAYS:
   Cite sources (company policy, labor law, legal requirement)
   Compare company policy to legal requirements
   Use indented bullets for lists
   Use emojis: pay, rules, dates, warnings, country, maternity, sick, allowed, not allowed, legal
Sign off as Lumio.`,
  manager: `You are Lumio Brain, speaking to a MANAGER.
YOUR ROLE:
   Help managers understand approval workflows
   Explain compliance requirements for their decisions
   Guide on team policies and guidelines
   Flag compliance risks
   Suggest best practices
TONE: Professional, supportive, compliance-focused
IF THE SITUATION IS UNCLEAR:
   Provide three action steps:
      1. Review company policy: Link to specific handbook sections
      2. Consult with HR: Explain what HR needs from you
      3. Escalate to legal: Explain when this is necessary for complex situations
ALWAYS:
   Cite sources (company policy, labor law, precedent)
   Flag compliance risks explicitly
   Use indented bullets for lists
Sign off as Lumio.`,
  admin: `You are Lumio Brain, speaking to HR / ADMIN.
YOUR ROLE:
   Spot gaps between company policy and current labor law
   Flag compliance risks before they become problems
   Suggest what to add or update in the company handbook
   Help maintain accurate, compliant policies
TONE: Strategic, precise, compliance-focused
WHEN YOU FIND A GAP OR DISCREPANCY:
   State clearly what the company policy says
   State what the law requires
   Explain the gap and the risk
   Suggest exact handbook language to fix it
IF THE SITUATION IS UNCLEAR:
   Provide three action steps:
      1. Review and update the relevant handbook section
      2. Document the change and notify affected employees
      3. Consult legal counsel for high-risk or ambiguous areas
ALWAYS:
   Cite sources (company policy, labor law, legal requirement)
   Be specific about which country's law applies
   Use indented bullets for lists
Sign off as Lumio.`,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const question = body.question;
    const role = body.role || "employee";

    if (!question || typeof question !== "string") {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Missing question" }),
      };
    }

    const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.employee;

    // 1. Pull employees for this company
    let employees = [];
    try {
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", COMPANY_ID);
      employees = data || [];
    } catch (e) {
      employees = [];
    }

    // 2. Detect if the question names an employee
    const matchedEmployee = findEmployeeInQuestion(question, employees);
    let employeeContext = "";
    if (matchedEmployee) {
      employeeContext =
        "\n\nEMPLOYEE CONTEXT (from company records):\n" +
        "Name: " + matchedEmployee.name + "\n" +
        "Country: " + (matchedEmployee.country || "unknown") + "\n" +
        "Department: " + (matchedEmployee.department || "unknown") + "\n" +
        "Employment type: " + (matchedEmployee.employment_type || "unknown") + "\n" +
        "Start date: " + (matchedEmployee.start_date || "unknown") + "\n" +
        "Manager: " + (matchedEmployee.manager || "unknown");
    }

    // 3. Pull company documents (policies) for grounding
    let docContext = "";
    try {
      const { data: docs } = await supabase
        .from("documents")
        .select("title, content")
        .eq("company_id", COMPANY_ID);
      if (docs && docs.length > 0) {
        docContext =
          "\n\nCOMPANY DOCUMENTS:\n" +
          docs
            .map(function (d) {
              return "--- " + (d.title || "Document") + " ---\n" + (d.content || "");
            })
            .join("\n\n");
      }
    } catch (e) {
      docContext = "";
    }

    const userMessage =
      question +
      employeeContext +
      docContext +
      "\n\nAnswer using the company documents and employee context above first. " +
      "If the documents do not contain the answer, research the current labor law for the relevant country and say so clearly. " +
      "Never invent a company policy that is not in the documents.";

    // 4. Call Claude with web search for current labor law
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") {
        reply += block.text;
      }
    }

    if (!reply) {
      reply = "I wasn't able to generate a response. Please try again. — Lumio";
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: reply }),
    };
  } catch (error) {
    console.error("ask-brain error:", error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Something went wrong",
        reply: "I'm having trouble connecting right now. Please try again. — Lumio",
      }),
    };
  }
};
