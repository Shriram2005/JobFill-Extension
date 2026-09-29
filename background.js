// background.js — the ONLY place API calls happen. Holds the API key
// (chrome.storage.local, never bundled into code, never sent anywhere but
// generativelanguage.googleapis.com) and routes requests to the cheap model or the good
// model depending on what's being asked.

importScripts("constants.js");
try {
  importScripts("config.js");
} catch (e) {
  // config.js is optional (credentials can also be configured via options page)
}

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
  if (message.action === "chooseResume") {
    handleChooseResume(message.jobContext)
      .then((resumeData) => sendResponse({ resumeData }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "memoryUpdated") {
    // Just acknowledge - used for notifications
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === "getMemoryStats") {
    handleGetMemoryStats()
      .then((stats) => sendResponse(stats))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "deleteMemoryEntry") {
    handleDeleteMemoryEntry(message.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "clearMemory") {
    handleClearMemory()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
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
  const envKey = typeof CONFIG !== "undefined" && CONFIG.GEMINI_API_KEY ? CONFIG.GEMINI_API_KEY : "";
  return {
    apiKey: stored[keys.API_KEY] || envKey,
    mappingModel: stored[keys.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL,
    writingModel: stored[keys.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL,
  };
}

async function callGemini({ model, system, userText, maxTokens, isJson = false }) {
  const { apiKey } = await getConfig();
  if (!apiKey) {
    throw new Error("No Gemini API key set. Open JobFill's options page and add one.");
  }

  const url = `${JOBFILL_DEFAULTS.API_URL}/${model}:generateContent?key=${apiKey}`;

  const generationConfig = { maxOutputTokens: maxTokens };
  if (isJson) {
    generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig,
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

  // Fetch user memory for RAG-based learning
  const memory = await getUserMemory();
  const memoryContext = formatMemoryForPrompt(memory, fields);

  const system = [
    "You are filling out a job application form on behalf of a candidate.",
    "You will receive a JSON array of form fields (id, label, placeholder, matchType, options)",
    "and the candidate's profile as JSON.",
    "",
    "IMPORTANT: You also have access to 'Past Answers' — a history of how the user has answered",
    "similar questions before. If a form field question matches or is conceptually similar to",
    "a question in the 'Past Answers' section, PRIORITIZE using that past answer over guessing",
    "from the profile. The user has manually provided these answers, so they are the most accurate.",
    "",
    "Return ONLY a single JSON object mapping each field's id to the best value.",
    "Rules:",
    "- For 'select' fields, the value MUST be one of the given options, copied exactly.",
    "- For 'radio'/'checkbox' fields, respond with the string \"yes\" if the profile supports",
    "  checking it, otherwise \"no\".",
    "- Never invent facts (employers, dates, degrees, skills, work authorization, salary) that",
    "  are not present in the profile JSON or Past Answers.",
    "- If a field cannot be confidently and honestly answered from the given profile, set its",
    `  value to the exact string "${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN}".`,
    "- Output raw JSON only. No markdown fences, no commentary, no text outside the object.",
  ].join("\n");

  const userText = JSON.stringify({ 
    fields, 
    profile,
    pastAnswers: memoryContext 
  });

  const raw = await callGemini({
    model: mappingModel,
    system,
    userText,
    maxTokens: JOBFILL_DEFAULTS.MAPPING_MAX_TOKENS,
    isJson: true,
  });

  return jobfillParseJsonLoose(raw);
}

async function handleWriteAnswer(question, profile, jobContext) {
  const { writingModel } = await getConfig();

  // Fetch user memory for RAG-based learning
  const memory = await getUserMemory();
  const memoryContext = formatMemoryForPrompt(memory, question);

  const system = [
    "You are drafting one short answer to a job application question on behalf of a candidate,",
    "using ONLY the facts in the candidate's profile JSON below. Do not fabricate employers,",
    "projects, dates, or skills that are not present in the profile.",
    "",
    "IMPORTANT: You also have access to 'Past Answers' — a history of how the user has answered",
    "similar questions before. If this question matches or is conceptually similar to a question",
    "in the 'Past Answers' section, USE that past answer as your primary source. The user has",
    "manually crafted these answers, so they represent the user's preferred way of responding.",
    "",
    "Keep the tone professional, first person, and concise — match the answer's length to what",
    "the question is asking, typically 2-5 sentences.",
    "If the question is about salary expectations, visa or work-authorization status, notice",
    "period, or anything else the profile has no data for, respond with EXACTLY:",
    `"${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN} — <one short sentence on what's missing>"`,
    "Output the answer text only. No preamble, no quotation marks around it.",
  ].join("\n");

  const userText = JSON.stringify({ 
    question, 
    profile, 
    jobPostingContext: jobContext || "",
    pastAnswers: memoryContext
  });

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
  const match = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const trimmed = match ? match[1].trim() : String(raw).trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    console.error("JobFill: failed to parse model JSON:", trimmed);
    return {};
  }
}

async function handleChooseResume(jobContext) {
  const { [JOBFILL_DEFAULTS.STORAGE_KEYS.RESUMES]: resumes } = await chrome.storage.local.get(JOBFILL_DEFAULTS.STORAGE_KEYS.RESUMES);
  if (!resumes || resumes.length === 0) return null;

  if (resumes.length === 1) {
    return resumes[0];
  }

  const { mappingModel } = await getConfig();
  const system = [
    "You are an assistant helping a candidate pick the best resume for a job.",
    "You will receive the job description and a list of available resumes (each with an id and a target role).",
    "Return ONLY a single JSON object with a single key 'bestResumeId' containing the id of the best resume.",
    "If none match well, pick the most generic one or just the first one.",
    "Output raw JSON only."
  ].join("\n");

  const resumeList = resumes.map(r => ({ id: r.id, role: r.role, filename: r.filename }));
  const userText = JSON.stringify({ jobDescription: jobContext || "Generic Application", availableResumes: resumeList });

  const raw = await callGemini({
    model: mappingModel,
    system,
    userText,
    maxTokens: 50,
    isJson: true,
  });
  
  const parsed = jobfillParseJsonLoose(raw);
  const bestId = parsed.bestResumeId;
  const match = resumes.find(r => r.id === bestId) || resumes[0];
  return match;
}


// ---------- Continual Learning / Memory Functions ----------

/**
 * Retrieve user memory from storage
 */
async function getUserMemory() {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const { [key]: memory } = await chrome.storage.local.get(key);
  return memory || {};
}

const JOBFILL_STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "up",
  "about", "into", "over", "after", "your", "you", "my", "me", "our",
  "we", "us", "this", "that", "these", "those", "and", "or", "but",
  "if", "what", "which", "who", "whom", "how", "when", "where", "why",
  "please", "enter", "select", "choose", "provide", "optional", "required"
]);

function jobfillTokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !JOBFILL_STOP_WORDS.has(w));
}

/**
 * Format memory for inclusion in AI prompts (RAG approach)
 * Selects only the most relevant Q&A pairs matching the fields or question
 */
function formatMemoryForPrompt(memory, queryOrFields) {
  const entries = Object.entries(memory);
  if (entries.length === 0) {
    return "No past answers available yet.";
  }

  let queryTokens = [];
  let queryText = "";
  if (typeof queryOrFields === "string") {
    queryText = queryOrFields.toLowerCase();
    queryTokens = jobfillTokenize(queryText);
  } else if (Array.isArray(queryOrFields)) {
    queryText = queryOrFields
      .map((f) => `${f.label || ""} ${f.placeholder || ""}`)
      .join(" ")
      .toLowerCase();
    queryTokens = jobfillTokenize(queryText);
  }

  const queryTokenSet = new Set(queryTokens);

  // Score each entry based on exact phrase containment and token overlap
  const scored = entries.map(([question, data]) => {
    const qLower = question.toLowerCase();
    const entryTokens = jobfillTokenize(qLower);

    let score = 0;
    if (queryText && (queryText.includes(qLower) || qLower.includes(queryText))) {
      score += 15;
    }

    for (const t of entryTokens) {
      if (queryTokenSet.has(t)) {
        score += 3;
      }
    }

    const timesUsed = data.timesUsed || 1;
    score += Math.min(timesUsed * 0.5, 3);

    return {
      question,
      data,
      score,
      lastUsed: new Date(data.lastUsed || 0).getTime(),
    };
  });

  let relevant;
  const matches = scored.filter((item) => item.score > 1);
  if (matches.length > 0) {
    matches.sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed);
    relevant = matches.slice(0, 15);
  } else {
    scored.sort((a, b) => b.lastUsed - a.lastUsed);
    relevant = scored.slice(0, 10);
  }

  const formatted = relevant
    .map(({ question, data }) => `Q: ${question}\nA: ${data.answer}`)
    .join("\n\n");

  return formatted;
}

/**
 * Get memory statistics for the UI
 */
async function handleGetMemoryStats() {
  const memory = await getUserMemory();
  const entries = Object.entries(memory);
  
  return {
    totalEntries: entries.length,
    oldestEntry: entries.length > 0 
      ? entries.reduce((oldest, [_, data]) => 
          new Date(data.lastUsed) < new Date(oldest) ? data.lastUsed : oldest, 
          entries[0][1].lastUsed
        )
      : null,
    newestEntry: entries.length > 0
      ? entries.reduce((newest, [_, data]) => 
          new Date(data.lastUsed) > new Date(newest) ? data.lastUsed : newest,
          entries[0][1].lastUsed
        )
      : null,
  };
}

/**
 * Delete a specific memory entry
 */
async function handleDeleteMemoryEntry(question) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const memory = await getUserMemory();
  
  if (memory[question]) {
    delete memory[question];
    await chrome.storage.local.set({ [key]: memory });
  }
}

/**
 * Clear all memory
 */
async function handleClearMemory() {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  await chrome.storage.local.set({ [key]: {} });
}
