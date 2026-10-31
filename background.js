// background.js — Central service worker for JobFill API calls and background tasks.
// Holds the API key securely (chrome.storage.local) and passes it strictly via HTTP headers.

if (typeof importScripts !== "undefined") {
  importScripts("constants.js");
  try {
    importScripts("config.js");
  } catch (e) {
    // config.js is optional (credentials can also be configured via options page)
  }
} else if (typeof require !== "undefined") {
  global.JOBFILL_DEFAULTS = require("./constants.js");
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "mapFields") {
    handleMapFields(message.fields, message.profile)
      .then((mapping) => sendResponse({ mapping }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "writeAnswer") {
    handleWriteAnswer(message.question, message.profile, message.jobContext)
      .then((answer) => sendResponse({ answer }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "generateCoverLetter") {
    handleGenerateCoverLetter(message.data)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "parseResumeToProfile") {
    handleParseResumeToProfile(message.resumeText)
      .then((extractedProfile) => sendResponse({ profile: extractedProfile }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "testApiKey") {
    handleTestApiKey()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "chooseResume") {
    handleChooseResume(message.jobContext)
      .then((resumeData) => sendResponse({ resumeData }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "logApplication") {
    handleLogApplication(message.application)
      .then((saved) => sendResponse({ ok: true, application: saved }))
      .catch((err) => sendResponse({ ok: false, error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "getApplications") {
    handleGetApplications()
      .then((apps) => sendResponse({ applications: apps }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "deleteApplication") {
    handleDeleteApplication(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "memoryUpdated") {
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === "getMemoryStats") {
    handleGetMemoryStats()
      .then((stats) => sendResponse(stats))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "deleteMemoryEntry") {
    handleDeleteMemoryEntry(message.question)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  if (message.action === "clearMemory") {
    handleClearMemory()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: sanitizeErrorMessage(err.message) }));
    return true;
  }
  });
}

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

/**
 * Executes a call to the Gemini API securely.
 * Sends the API key via the "x-goog-api-key" header to avoid exposing keys in URL query params.
 */
async function callGemini({ model, system, userText, maxTokens, isJson = false }) {
  const { apiKey } = await getConfig();
  if (!apiKey) {
    throw new Error("No Gemini API key set. Open JobFill settings to configure your key.");
  }

  // Secure URL without query parameters
  const url = `${JOBFILL_DEFAULTS.API_URL}/${model}:generateContent`;

  const generationConfig = { maxOutputTokens: maxTokens };
  if (isJson) {
    generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${sanitizeErrorMessage(text)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || "";
}

function sanitizeErrorMessage(msg) {
  return String(msg || "")
    .replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]")
    .replace(/AIza[a-zA-Z0-9_\-]+/g, "[REDACTED_API_KEY]")
    .slice(0, 300);
}

/**
 * Minimizes candidate profile payload sent to the AI model.
 * Removes sensitive fields, unnecessary credentials, or empty values.
 */
function minimizeProfileForAI(profile) {
  if (!profile || typeof profile !== "object") return {};
  const personal = { ...(profile.personal_info || {}) };

  // Strip sensitive PII that an AI never needs for field matching
  delete personal.password;
  delete personal.ssn;
  delete personal.sin;
  delete personal.pin;
  delete personal.bank_account;
  delete personal.credit_card;

  return {
    personal_info: personal,
    summary: profile.summary || "",
    skills: profile.skills || {},
    experience: (profile.experience || []).slice(0, 4).map((e) => ({
      role: e.role,
      company: e.company,
      duration: e.duration,
      location: e.location,
      key_achievements: (e.key_achievements || []).slice(0, 3),
      technologies_used: e.technologies_used || [],
    })),
    education: (profile.education || []).slice(0, 2).map((ed) => ({
      institution: ed.institution,
      degree: ed.degree,
      duration: ed.duration,
      grade: ed.grade,
      field_of_study: ed.field_of_study || "",
    })),
    stats: profile.stats || {},
  };
}

/**
 * Validates AI-generated mapping responses before returning to content script.
 * Enforces valid field IDs, exact or closest dropdown options, and length limits.
 */
function validateFieldMapping(rawMapping, fields) {
  if (!rawMapping || typeof rawMapping !== "object") return {};
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const validated = {};

  for (const [id, value] of Object.entries(rawMapping)) {
    const field = fieldMap.get(id);
    if (!field) continue; // Reject unknown field IDs

    if (value === null || value === undefined) {
      validated[id] = JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN;
      continue;
    }

    const valStr = String(value).trim();
    if (valStr.includes(JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN) || valStr === "") {
      validated[id] = JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN;
      continue;
    }

    // Dropdown / Select / Combobox validation
    if ((field.matchType === "select" || field.matchType === "combobox") && Array.isArray(field.options) && field.options.length > 0) {
      const targetLower = valStr.toLowerCase();
      // 1. Exact match
      let matchedOption = field.options.find((opt) => opt.trim().toLowerCase() === targetLower);
      // 2. Contains match
      if (!matchedOption) {
        matchedOption = field.options.find(
          (opt) =>
            opt.toLowerCase().includes(targetLower) ||
            targetLower.includes(opt.toLowerCase())
        );
      }
      if (matchedOption) {
        validated[id] = matchedOption;
      } else {
        // Can't validate option safely — flag for user manual choice
        validated[id] = JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN;
      }
      continue;
    }

    // Radio / Radio Group / Checkbox validation
    if (field.matchType === "radio" || field.matchType === "radio-group" || field.matchType === "checkbox") {
      const lower = valStr.toLowerCase();
      if (/^(yes|true|1|y)$/i.test(lower)) {
        validated[id] = "yes";
      } else if (/^(no|false|0|n)$/i.test(lower)) {
        validated[id] = "no";
      } else if (Array.isArray(field.options)) {
        const matched = field.options.find((o) => {
          const optText = typeof o === "string" ? o : o.label || o.value || "";
          return optText.toLowerCase() === lower || optText.toLowerCase().includes(lower) || lower.includes(optText.toLowerCase());
        });
        validated[id] = matched ? (typeof matched === "string" ? matched : matched.label || matched.value) : valStr;
      } else {
        validated[id] = valStr;
      }
      continue;
    }

    // Text length limits
    if (field.maxLength && field.maxLength > 0 && valStr.length > field.maxLength) {
      validated[id] = valStr.slice(0, field.maxLength);
      continue;
    }

    validated[id] = valStr;
  }

  return validated;
}

async function handleMapFields(fields, profile) {
  const { mappingModel } = await getConfig();

  // Fetch user memory for RAG-based learning
  const memory = await getUserMemory();
  const memoryContext = formatMemoryForPrompt(memory, fields);
  const sanitizedProfile = minimizeProfileForAI(profile);

  const system = [
    "You are an assistant accurately filling out a job application form on behalf of a candidate.",
    "You will receive a JSON array of form fields (id, label, placeholder, matchType, options)",
    "and the candidate's verified profile as JSON.",
    "",
    "IMPORTANT: You also have access to 'Past Answers' — verified answers previously given by the user.",
    "If a form field question matches or is conceptually similar to a question in 'Past Answers',",
    "PRIORITIZE using that past answer over guessing from the profile.",
    "",
    "Return ONLY a single JSON object mapping each field's id to the best value.",
    "Rules:",
    "- For 'select' fields, the value MUST be chosen from the given field.options list, copied exactly.",
    "- For 'radio'/'checkbox' fields, respond with \"yes\" or \"no\" or the matching option text.",
    "- NEVER invent facts (employers, dates, degrees, skills, work authorization, salary) not present in profile or Past Answers.",
    `- If a field cannot be confidently and honestly answered from the given profile, set its value to "${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN}".`,
    "- Output raw JSON only. No markdown fences, no text outside the object.",
  ].join("\n");

  const userText = JSON.stringify({
    fields,
    profile: sanitizedProfile,
    pastAnswers: memoryContext,
  });

  const raw = await callGemini({
    model: mappingModel,
    system,
    userText,
    maxTokens: JOBFILL_DEFAULTS.MAPPING_MAX_TOKENS,
    isJson: true,
  });

  const parsed = jobfillParseJsonLoose(raw);
  return validateFieldMapping(parsed, fields);
}

async function handleWriteAnswer(question, profile, jobContext) {
  const { writingModel } = await getConfig();

  const memory = await getUserMemory();
  const memoryContext = formatMemoryForPrompt(memory, question);
  const sanitizedProfile = minimizeProfileForAI(profile);

  const system = [
    "You are drafting one concise, tailored answer to a job application question on behalf of a candidate,",
    "using ONLY the facts in the candidate's profile JSON below. Do not fabricate employers,",
    "projects, dates, or skills that are not present in the profile.",
    "",
    "IMPORTANT: If this question matches a question in 'Past Answers', use that past answer as your primary source.",
    "",
    "Keep the tone professional, first person, and concise — match the answer's length to what the question asks.",
    `If the candidate's profile genuinely does not support an answer, return exactly "${JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN}".`,
  ].join("\n");

  const userText = JSON.stringify({
    question,
    jobDescription: jobContext,
    profile: sanitizedProfile,
    pastAnswers: memoryContext,
  });

  const answer = await callGemini({
    model: writingModel,
    system,
    userText,
    maxTokens: JOBFILL_DEFAULTS.WRITING_MAX_TOKENS,
  });

  return answer.trim();
}

/**
 * AI Cover Letter and Application Answer Generator
 */
async function handleGenerateCoverLetter({ mode, company, role, jobDescription, tone, length, customPrompt, profile }) {
  const { writingModel } = await getConfig();
  const sanitizedProfile = minimizeProfileForAI(profile);

  const lengthInstructions = {
    short: "Keep it under 150 words. Punchy, focused, and immediately impactful.",
    medium: "Target around 250-300 words. 3-4 structured paragraphs covering motivation, key experience, and culture fit.",
    detailed: "Target around 400-450 words. Comprehensive cover letter with detailed achievement highlights and tailored company alignment."
  }[length || "medium"] || "Target around 250-300 words.";

  const toneInstructions = {
    professional: "Polished, courteous, and authoritative.",
    enthusiastic: "High energy, passionate about the mission, and engaging.",
    confident: "Direct, results-oriented, emphasizing proven business impact.",
    concise: "No fluff, straight to the point, data and skills driven."
  }[tone || "professional"] || "Polished and professional.";

  const isQuestion = mode === "question";
  const system = [
    isQuestion
      ? "You are an expert career advisor drafting a response to a specific job application question."
      : "You are an expert career advisor crafting a high-impact, tailored cover letter for a candidate.",
    "",
    "STRICT FACTUAL INTEGRITY RULES:",
    "- Use ONLY the genuine facts, employers, metrics, and skills present in the candidate's profile JSON.",
    "- NEVER fabricate experience, tools, certifications, or statistics.",
    "- Connect the candidate's real achievements directly to the job description requirements.",
    `- Tone: ${toneInstructions}`,
    `- Length: ${lengthInstructions}`,
    "- Write in the first person ('I'). Do not use overly generic cliches.",
  ].join("\n");

  const userText = JSON.stringify({
    task: isQuestion ? "Application Question Answer" : "Cover Letter",
    targetCompany: company || "The Company",
    targetRole: role || "Target Role",
    jobDescription: jobDescription || "",
    specificQuestion: isQuestion ? customPrompt : undefined,
    candidateProfile: sanitizedProfile,
  });

  const raw = await callGemini({
    model: writingModel,
    system,
    userText,
    maxTokens: 1200,
  });

  return raw.trim();
}

/**
 * Resume Parser: extracts structured profile JSON from raw resume text
 */
async function handleParseResumeToProfile(resumeText) {
  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error("Resume text is too short to extract profile details.");
  }

  const { writingModel } = await getConfig();

  const system = [
    "You are a resume parsing assistant.",
    "Extract all candidate information from the provided resume text into a clean JSON structure matching this schema:",
    "{",
    '  "personal_info": { "name": "", "title": "", "email": "", "phone": "", "location": "", "linkedin": "", "github": "", "website": "" },',
    '  "summary": "",',
    '  "skills": { "core_competencies": ["..."], "technologies": ["..."] },',
    '  "experience": [ { "role": "", "company": "", "duration": "", "location": "", "key_achievements": ["..."], "technologies_used": ["..."] } ],',
    '  "education": [ { "institution": "", "degree": "", "duration": "", "grade": "", "field_of_study": "" } ],',
    '  "projects": [ { "title": "", "description": "", "technologies": ["..."] } ]',
    "}",
    "Rules:",
    "- Extract only information explicitly mentioned in the text.",
    "- Leave unknown fields as empty string or empty array.",
    "- Output raw JSON only. No markdown fences, no explanatory text.",
  ].join("\n");

  const raw = await callGemini({
    model: writingModel,
    system,
    userText: resumeText.slice(0, 8000),
    maxTokens: 2000,
    isJson: true,
  });

  return jobfillParseJsonLoose(raw);
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

/**
 * Intelligent resume selection: compares job context with resume content and skills.
 * Provides matching skills, missing skills, and match explanation.
 */
async function handleChooseResume(jobContext) {
  const { [JOBFILL_DEFAULTS.STORAGE_KEYS.RESUMES]: resumes } = await chrome.storage.local.get(
    JOBFILL_DEFAULTS.STORAGE_KEYS.RESUMES
  );
  if (!resumes || resumes.length === 0) return null;

  if (resumes.length === 1) {
    return {
      ...resumes[0],
      matchScore: 100,
      explanation: "Default active resume selected.",
      matchingSkills: [],
      missingSkills: [],
    };
  }

  const { mappingModel } = await getConfig();
  const system = [
    "You are an assistant helping a candidate pick the best resume for a specific job application.",
    "Compare the provided job description against the available candidate resumes (including target role and filename).",
    "Return ONLY a single JSON object with:",
    "- 'bestResumeId': ID of the best matching resume.",
    "- 'matchScore': Integer between 0 and 100.",
    "- 'matchingSkills': Array of key skills matching the job requirements.",
    "- 'missingSkills': Array of required skills not clearly present in the resume.",
    "- 'explanation': Brief 1-2 sentence explanation of why this resume is best suited.",
    "Output raw JSON only.",
  ].join("\n");

  const resumeList = resumes.map((r) => ({
    id: r.id,
    role: r.role,
    filename: r.filename,
    skills: r.skills || [],
  }));

  const userText = JSON.stringify({
    jobDescription: jobContext || "General Application",
    availableResumes: resumeList,
  });

  const raw = await callGemini({
    model: mappingModel,
    system,
    userText,
    maxTokens: 250,
    isJson: true,
  });

  const parsed = jobfillParseJsonLoose(raw);
  const bestId = parsed.bestResumeId;
  const match = resumes.find((r) => r.id === bestId) || resumes[0];

  return {
    ...match,
    matchScore: parsed.matchScore || 85,
    matchingSkills: parsed.matchingSkills || [],
    missingSkills: parsed.missingSkills || [],
    explanation: parsed.explanation || `Best match for ${match.role}`,
  };
}

// ---------- Continual Learning & Memory Retrieval ----------

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
 * Calculates relevance score between candidate question and memory question.
 * Returns score > 0 only if there is meaningful overlap or phrase match.
 */
function calculateQuestionSimilarity(queryTokens, queryText, memoryQuestion) {
  const memLower = memoryQuestion.toLowerCase();
  const memTokens = jobfillTokenize(memLower);
  if (memTokens.length === 0 || queryTokens.length === 0) return 0;

  // Exact phrase match
  if (queryText.includes(memLower) || memLower.includes(queryText)) {
    return 10.0;
  }

  // Token intersection
  const querySet = new Set(queryTokens);
  let intersection = 0;
  for (const t of memTokens) {
    if (querySet.has(t)) intersection++;
  }

  // Jaccard similarity
  const unionSize = new Set([...queryTokens, ...memTokens]).size;
  const jaccard = unionSize > 0 ? intersection / unionSize : 0;

  // Score weighted by overlap
  return intersection * 2.0 + jaccard * 5.0;
}

/**
 * Formats memory for AI prompt (RAG approach).
 * STRICT: Only includes entries that meet the relevance threshold.
 * If no relevant memory is found, returns a notice rather than injecting arbitrary past answers.
 */
function formatMemoryForPrompt(memory, queryOrFields) {
  const entries = Object.entries(memory);
  if (entries.length === 0) {
    return "No past answers available.";
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

  // Minimum threshold required for an answer to be considered relevant
  const RELEVANCE_THRESHOLD = 3.0;

  const matches = [];
  for (const [question, data] of entries) {
    const score = calculateQuestionSimilarity(queryTokens, queryText, question);
    if (score >= RELEVANCE_THRESHOLD) {
      matches.push({ question, data, score });
    }
  }

  // If no relevant memories meet threshold, DO NOT inject unrelated recent entries!
  if (matches.length === 0) {
    return "No directly relevant past answers found for these questions.";
  }

  matches.sort((a, b) => b.score - a.score);
  return matches
    .slice(0, 10)
    .map(({ question, data }) => `Q: ${question}\nA: ${data.answer}`)
    .join("\n\n");
}

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

async function handleDeleteMemoryEntry(question) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const memory = await getUserMemory();
  if (memory[question]) {
    delete memory[question];
    await chrome.storage.local.set({ [key]: memory });
  }
}

async function handleClearMemory() {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  await chrome.storage.local.set({ [key]: {} });
}

// ---------- Application Tracker Functions ----------

async function handleLogApplication(app) {
  if (!app || typeof app !== "object") throw new Error("Invalid application data");
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.APPLICATIONS;
  const { [key]: existing } = await chrome.storage.local.get(key);
  const list = Array.isArray(existing) ? existing : [];

  const record = {
    id: app.id || "app_" + Date.now(),
    company: app.company || "Unknown Company",
    role: app.role || "Job Application",
    jobUrl: app.jobUrl || "",
    appliedDate: app.appliedDate || new Date().toISOString(),
    status: app.status || "Applied",
    selectedResume: app.selectedResume || "",
    salary: app.salary || "",
    notes: app.notes || "",
    followUpDate: app.followUpDate || "",
    lastUpdated: new Date().toISOString(),
  };

  const idx = list.findIndex((a) => a.id === record.id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }

  const trimmed = list.slice(0, JOBFILL_DEFAULTS.MAX_APPLICATIONS || 1000);
  await chrome.storage.local.set({ [key]: trimmed });
  return record;
}

async function handleGetApplications() {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.APPLICATIONS;
  const { [key]: existing } = await chrome.storage.local.get(key);
  return Array.isArray(existing) ? existing : [];
}

async function handleDeleteApplication(id) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.APPLICATIONS;
  const { [key]: existing } = await chrome.storage.local.get(key);
  const list = Array.isArray(existing) ? existing : [];
  const filtered = list.filter((a) => a.id !== id);
  await chrome.storage.local.set({ [key]: filtered });
}

// Extension Installation & First-Run Welcome Handler
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    }
  });
}

// Global Keyboard Shortcut Listener
if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "fill_application") {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;

        const isOwnExtension = Boolean(
          tab.url && chrome.runtime && chrome.runtime.getURL && tab.url.startsWith(chrome.runtime.getURL(""))
        );
        const isSandbox = isOwnExtension || /sandbox\.html/i.test(tab.url || "");

        if (isSandbox) {
          try {
            await chrome.tabs.sendMessage(tab.id, { action: "jobfillRun" });
          } catch (_) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: ["constants.js", "rules.js", "content.js"],
            });
          }
        } else if (/^https?:\/\//i.test(tab.url || "")) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ["constants.js", "rules.js", "content.js"],
          });
        }
      } catch (err) {
        console.error("JobFill shortcut error:", err);
      }
    }
  });
}

// Support Node.js testing environment if imported
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    jobfillTokenize,
    calculateQuestionSimilarity,
    formatMemoryForPrompt,
    validateFieldMapping,
    minimizeProfileForAI,
    sanitizeErrorMessage,
  };
}
