/**
 * Lumio Sprint 1 — ask-lumio function
 * ------------------------------------
 * The Company Brain. Answers questions using ONLY the company's
 * uploaded documents, with source citations, and refuses to answer
 * when the documents don't contain the information.
 *
 * Flow:
 *   1. Embed the user's question with Voyage
 *   2. Retrieve the most relevant chunks from Supabase (match_chunks RPC)
 *   3. Ask Claude to answer using ONLY those chunks
 *   4. Return the answer + the source filenames used
 */

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// The seeded company. (Sprint 1 = single company.)
// Replace this with the COMPANY_ID printed by the seed script.
const COMPANY_ID = process.env.LUMIO_COMPANY_ID || "REPLACE_WITH_COMPANY_ID";

const SIMILARITY_FLOOR = 0.4; // below this, treat as "not found"

const SYSTEM_PROMPT = `You are Lumio, a company knowledge assistant.

STRICT RULES:
- Answer ONLY using the information in the COMPANY DOCUMENTS provided below.
- If the answer is not in the documents, say exactly: "I don't have that information in your company documents." Do not guess, infer, or use outside knowledge.
- Never invent numbers, dates, or policies.
- Keep answers short, clear, and factual.
- After your answer, do not list sources yourself — the system adds citations automatically.

Be warm but concise. Sign off with "— Lumio 🍀"`;

async function embedQuestion(question) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [question],
      model: "voyage-3-lite",
      input_type: "query",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    // Accept either { question } or { messages: [...] }
    const question =
      body.question ||
      (Array.isArray(body.messages) && body.messages.length
        ? body.messages[body.messages.length - 1].content
        : null);

    if (!question || typeof question !== "string") {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing question" }) };
    }
    if (question.length > 1000) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ reply: "Please keep questions under 1000 characters. — Lumio 🍀" }),
      };
    }

    // 1. Embed the question
    const queryEmbedding = await embedQuestion(question);

    // 2. Retrieve relevant chunks
    const { data: matches, error: matchErr } = await supabase.rpc("match_chunks", {
      query_embedding: queryEmbedding,
      match_company_id: COMPANY_ID,
      match_count: 5,
    });
    if (matchErr) throw matchErr;

    // Filter by similarity floor — if nothing clears it, refuse.
    const relevant = (matches || []).filter((m) => m.similarity >= SIMILARITY_FLOOR);

    if (relevant.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          reply: "I don't have that information in your company documents. — Lumio 🍀",
          sources: [],
        }),
      };
    }

    // Get source filenames for the matched chunks
    const docIds = [...new Set(relevant.map((m) => m.document_id))];
    const { data: docs } = await supabase
      .from("documents")
      .select("id, filename")
      .in("id", docIds);
    const filenameById = {};
    (docs || []).forEach((d) => (filenameById[d.id] = d.filename));

    // 3. Build context and ask Claude
    const context = relevant
      .map((m, i) => `[Source ${i + 1}: ${filenameById[m.document_id] || "document"}]\n${m.content}`)
      .join("\n\n---\n\n");

    const userMessage = `COMPANY DOCUMENTS:\n\n${context}\n\n---\n\nQUESTION: ${question}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    let reply = "";
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
    }
    if (!reply) reply = "I couldn't generate a response. Please try again. — Lumio 🍀";

    // 4. Unique source filenames for citation display
    const sources = [...new Set(relevant.map((m) => filenameById[m.document_id]).filter(Boolean))];

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ reply, sources }),
    };
  } catch (error) {
    console.error("Lumio error:", error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        reply: "I'm having trouble right now. Please try again in a moment. — Lumio 🍀",
        error: error.message,
      }),
    };
  }
};
