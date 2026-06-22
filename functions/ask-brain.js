const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Public sample company — used by the marketing site's "sample" chat when NO access key is sent.
const DEMO_COMPANY_ID = "2db68ac5-3e3c-4774-a194-6e1d08504384";

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

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "OK" };
  }

  try {
    // 1. Parse request
    let question, role, accessKey;
    try {
      const body = JSON.parse(event.body);
      question = body.question;
      role = body.role || "employee";
      // accept either spelling from the client
      accessKey = body.access_key || body.accessKey || null;
      console.log(`[ask-brain] Role: ${role} | accessKey present: ${!!accessKey}`);
    } catch (e) {
      console.error("[ask-brain] JSON parse error:", e);
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Invalid request format",
          reply: "I couldn't understand your request. Please try again. — LumioHR",
        }),
      };
    }

    if (!question || !String(question).trim()) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          reply: "Please type a question and I'll help. — LumioHR",
        }),
      };
    }

    // 2. Resolve WHICH company's data to use.
    //    The browser never sends a company_id directly — it sends a secret access key,
    //    and the SERVER decides which company that maps to. This is what keeps each
    //    customer's data isolated: a stolen key can only ever unlock one company.
    let companyId = DEMO_COMPANY_ID;
    let usingDemo = true;

    if (accessKey) {
      const { data: company, error: keyErr } = await supabase
        .from("companies")
        .select("id")
        .eq("access_key", accessKey)
        .maybeSingle();

      if (keyErr) {
        console.error("[ask-brain] access-key lookup error:", keyErr.message);
      }

      if (!company) {
        // Unknown / expired key — do NOT fall back to anyone's data.
        console.log("[ask-brain] access key not recognized — refusing");
        return {
          statusCode: 403,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({
            reply:
              "That access key isn't recognized. Please check the link your LumioHR contact sent you, or reach out to hello@lumio-hr.com. — LumioHR",
          }),
        };
      }

      companyId = company.id;
      usingDemo = false;
    }

    console.log(
      `[ask-brain] Using ${usingDemo ? "DEMO (sample)" : "customer"} company ${companyId}`
    );

    // 3. System prompt for role
    const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.employee;

    // 4. Query Supabase chunks for THIS company only
    let docContext = "";
    try {
      const { data: chunks, error } = await supabase
        .from("chunks")
        .select("content")
        .eq("company_id", companyId)
        .limit(20);

      if (error) {
        console.error("[ask-brain] Supabase chunks error:", error);
      } else if (chunks && chunks.length > 0) {
        console.log(`[ask-brain] Found ${chunks.length} content chunks`);
        docContext =
          "\n\nCOMPANY POLICIES (from knowledge base):\n" +
          chunks.map((c) => c.content || "").join("\n");
      } else {
        console.log("[ask-brain] No chunks found for this company");
      }
    } catch (e) {
      console.error("[ask-brain] Supabase query failed:", e.message);
      docContext = "";
    }

    // 4b. Pull THIS company's employee roster so answers can be personalized.
    //     If the question names an employee, inject their (non-sensitive) record.
    //     This is the thing a generic chatbot cannot do: policy × this specific person.
    let employeeContext = "";
    try {
      const { data: emps, error: empErr } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId);

      if (empErr) {
        console.error("[ask-brain] employees query error:", empErr.message);
      } else if (emps && emps.length) {
        const ql = String(question).toLowerCase();
        const nameOf = (e) =>
          (e.name || e.full_name || e.fullName || e.Full_Name || e["Full Name"] || "").toString();

        let match = null;
        for (const e of emps) {
          const full = nameOf(e).toLowerCase().trim();
          if (!full) continue;
          const first = full.split(/\s+/)[0];
          if (ql.includes(full)) { match = e; break; }          // full name wins
          if (first.length > 2 && ql.includes(first)) match = e; // else first-name match
        }

        if (match) {
          const pick = (keys) => {
            for (const k of keys) {
              if (match[k] != null && String(match[k]).trim() !== "") return String(match[k]);
            }
            return "";
          };
          const name    = nameOf(match);
          const country = pick(["country", "Country"]);
          const title   = pick(["job_title", "title", "Job Title", "jobTitle"]);
          const dept    = pick(["department", "Department"]);
          const etype   = pick(["employment_type", "Employment Type", "employmentType"]);
          const manager = pick(["manager", "Manager"]);
          const start   = pick(["start_date", "Start Date", "startDate"]);

          // NOTE: salary and email are deliberately NOT included — never sent to the model.
          employeeContext =
            "\n\nEMPLOYEE RECORD (use to personalize the answer):\n" +
            `- Name: ${name}\n` +
            (country ? `- Country: ${country}\n` : "") +
            (title   ? `- Job title: ${title}\n` : "") +
            (dept    ? `- Department: ${dept}\n` : "") +
            (etype   ? `- Employment type: ${etype}\n` : "") +
            (manager ? `- Manager: ${manager}\n` : "") +
            (start   ? `- Start date: ${start}\n` : "");
          console.log(`[ask-brain] matched employee: ${name}`);
        }
      }
    } catch (e) {
      console.error("[ask-brain] employees lookup failed:", e.message);
    }

    // 5. Build user message with context
    const userMessage =
      `${question}\n\n` +
      `Company policies:\n${docContext || "[No company documents found in knowledge base]"}` +
      `${employeeContext}\n\n` +
      `Instructions: Answer using the company policies above. ` +
      `If an EMPLOYEE RECORD is included, tailor the answer to that specific person — ` +
      `for example, apply the policy for their country and reference their situation. ` +
      `Never state, list, or hint at any employee's salary or email address. ` +
      `IMPORTANT — leave balances: you do NOT have access to anyone's used or remaining leave. ` +
      `Never invent, estimate, or state how many days a person has "used", "left", "remaining", or "available". ` +
      `If asked about a remaining balance, give the annual entitlement from the policy, then say the current ` +
      `balance should be confirmed with HR — LumioHR will show live balances once the company's HR system is connected. ` +
      `If the policies don't address the question, explain what information would be needed.`;

    console.log(`[ask-brain] Calling Claude with ${docContext.length} chars of context`);

    // 6. Call Claude
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // 7. Extract text
    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
    }
    if (!reply) {
      reply = "I wasn't able to generate a response. Please try again. — LumioHR";
    }

    console.log("[ask-brain] Success — returning reply");
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
