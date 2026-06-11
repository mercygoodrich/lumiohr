/**
 * Lumio — ask-brain function (Company Brain)
 * Answers questions using ONLY the company's uploaded documents,
 * with source citations, and refuses when the documents don't contain it.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COMPANY_ID = process.env.LUMIO_COMPANY_ID || "REPLACE_WITH_COMPANY_ID";
const SIMILARITY_FLOOR = 0.4;

const SYSTEM_PROMPT = `You are Lumio, a company knowledge as
