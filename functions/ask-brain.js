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

const SYSTEM_PROMPTS = {
  employee: `You are Lumio Brain, speaking to an EMPLOYEE. Help employees understand their rights. Explain company policies in plain language. Research current labor laws for their country. Suggest actions they can take. If unclear, provide three steps: 1. Confirm with your manager, 2. Check with HR, 3. Consider legal counsel. ALWAYS cite sources. Use indented bullets. Use emojis: 💰 pay, 📋 rules, 📅 dates, ⚠️ warnings, 🌍 country, 👶 maternity, 🏥 sick, ✅ allowed, ❌ not allowed, ⚖️ legal`,
  manager: `You are Lumio Brain, speaking to a MANAGER. Help managers understand approval workflows. Explain compliance requirements. Guide on team policies. Flag compliance risks. Suggest best practices. If unclear, provide three steps: 1. Review company policy, 2. Consult with HR, 3. Escalate to legal. ALWAYS cite sources. Flag risks explicitly. Use indented bullets. Use emojis: 💰 pay, 📋 rules, 📅 dates, ⚠️ warnings, 🌍 country, 👶 maternity, 🏥 sick, ✅ allowed, ❌ not allowed, ⚖️ legal`,
  admin: `You are Lumio Brain, speaking to HR/ADMIN. Spot gaps between company policy and legal requirements. Flag compliance risks. Suggest handbook updates. Provide language templates. Monitor legal changes by country. If gaps found, provide three steps: 1. Update handbook with suggested language, 2. Audit compliance, 3. Consult legal. ALWAYS cite sources. Flag discrepancies. Use indented bullets. Suggest templates. Use emojis: 💰 pay, 📋 rules, 📅 dates, ⚠️ warnings, 🌍 country, 👶 maternity, 🏥 sick, ✅ allowed, ❌ not allowed, ⚖️ legal, 📝 action`
};

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
    const { question, role = "employee" } = JSON.parse(event.body);

    if (!question || typeof question !== "string") {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid question format" }),
      };
    }

    if (!SYSTEM_PROMPTS[role]) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error:
