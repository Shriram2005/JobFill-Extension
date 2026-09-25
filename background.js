// background.js — the ONLY place API calls happen. Holds the API key
// (chrome.storage.local, never bundled into code, never sent anywhere but
// generativelanguage.googleapis.com) and routes requests to the cheap model or the good
// model depending on what's being asked.

importScripts("constants.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "mapFields") {
    handleMapFields(message.fields, message.profile)
      .then((mapping) => sendResponse({ mapping }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (message.action === "writeAnswer") {
    handleWriteAnswer(message.question, message.profile, message.jobContext)
      .then((answer) => sendResponse({ answer }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "testApiKey") {
    handleTestApiKey()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function getConfig() {
  const keys = JOBFILL_DEFAULTS.STORAGE_KEYS;
  const stored = await chrome.storage.local.get([
    keys.API_KEY,
    keys.MAPPING_MODEL,
    keys.WRITING_MODEL,
  ]);
  return {
    apiKey: stored[keys.API_KEY],
    mappingModel: stored[keys.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL,
    writingModel: stored[keys.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL,
  };
}

async function callGemini({ model, system, userText, maxTokens }) {
  const { apiKey } = await getConfig();
  if (!apiKey) {
    throw new Error("No Gemini API key set. Open JobFill's options page and add one.");
  }

  const url = `${JOBFILL_DEFAULTS.API_URL}/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${jobfillTruncateErr(text)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || "";
}

function jobfillTruncateErr(text) {
  return text.length > 300 ? text.slice(0, 300) + "…" : text;
}

async function handleMapFields(fields, profile) {
  const { mappingModel } = await getConfig();

  const system = [
    "You are filling out a job application form on behalf of a candidate.",
    "You will receive a JSON array of form fields (id, label, placeholder, matchType, options)",
    "and the candidate's profile as JSON.",
    "Return ONLY a single JSON object mapping each field's id to the best value.",
    "Rules:",
    "- For 'select' fields, the value MUST be one of the given options, copied exactly.",
    "- For 'radio'/'checkbox' fields, respond with the string \"yes\" if the profile supports",
    "  checking it, otherwise \"no\".",
    "- Never invent facts (employers, dates, degrees, skills, work authorization, salary) that",
    "  are not present in the profile JSON.",
    "- If a field cannot be confidently and honestly answered from the given profile, set its",
    `  value to the exact string "${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN}".`,
    "- Output raw JSON only. No markdown fences, no commentary, no text outside the object.",
  ].join("\n");

  const userText = JSON.stringify({ fields, profile });

  const raw = await callGemini({
    model: mappingModel,
    system,
    userText,
    maxTokens: JOBFILL_DEFAULTS.MAPPING_MAX_TOKENS,
  });

  return jobfillParseJsonLoose(raw);
}

async function handleWriteAnswer(question, profile, jobContext) {
  const { writingModel } = await getConfig();

  const system = [
    "You are drafting one short answer to a job application question on behalf of a candidate,",
    "using ONLY the facts in the candidate's profile JSON below. Do not fabricate employers,",
    "projects, dates, or skills that are not present in the profile.",
    "Keep the tone professional, first person, and concise — match the answer's length to what",
    "the question is asking, typically 2-5 sentences.",
    "If the question is about salary expectations, visa or work-authorization status, notice",
    "period, or anything else the profile has no data for, respond with EXACTLY:",
    `"${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN} — <one short sentence on what's missing>"`,
    "Output the answer text only. No preamble, no quotation marks around it.",
  ].join("\n");

  const userText = JSON.stringify({ question, profile, jobPostingContext: jobContext || "" });

  const answer = await callGemini({
    model: writingModel,
    system,
    userText,
    maxTokens: JOBFILL_DEFAULTS.WRITING_MAX_TOKENS,
  });

  return answer.trim();
}

async function handleTestApiKey() {
  await callGemini({
    model: JOBFILL_DEFAULTS.MAPPING_MODEL,
    system: "Reply with exactly one word: ok",
    userText: "ping",
    maxTokens: 10,
  });
}

function jobfillParseJsonLoose(raw) {
  const trimmed = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    console.error("JobFill: failed to parse model JSON:", trimmed);
    return {};
  }
}
