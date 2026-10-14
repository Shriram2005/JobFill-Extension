// content.js — injected on demand (via chrome.scripting.executeScript) when
// the user clicks "Fill this application" in the popup. Runs once, top to
// bottom, and never re-injects itself automatically.
//
// IMPORTANT SCOPE NOTES (read before relying on this):
// - This fills ONE page/step at a time. If a form spans multiple steps,
//   click "Fill this application" again after you advance to the next step.
// - <input type="file"> cannot be set programmatically for security reasons
//   built into browsers — resume/cover-letter uploads are always flagged
//   for you to attach by hand.
// - This NEVER clicks a Submit/Apply button. That is a hard rule, not a
//   setting.

(async function jobfillRun() {
  // Prevent concurrent runs if the script is injected again while already running
  if (window._jobfillRunning) return;
  window._jobfillRunning = true;

  // Clear highlight data from any previous run on this page
  window._jobfillManualFields = [];
  window._jobfillHighlightedElements = [];

  const badge = jobfillCreateBadge();
  badge.setStatus("Scanning page\u2026");

  try {
    if (jobfillDetectCaptcha()) {
      badge.setStatus(
        "CAPTCHA detected — please solve it yourself, then click Fill again.",
        "warn"
      );
      return;
    }

    let profile;
    try {
      const stored = await chrome.storage.local.get(JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE);
      if (
        stored &&
        stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE] &&
        typeof stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE] === "object" &&
        Object.keys(stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE]).length > 0
      ) {
        profile = stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE];
      } else {
        const res = await fetch(chrome.runtime.getURL("profile.json"));
        profile = await res.json();
      }
    } catch (e) {
      badge.setStatus(
        "No profile found. Please upload or save your profile in extension settings.",
        "error"
      );
      return;
    }

    const fields = jobfillScanFields();
    if (fields.length === 0) {
      badge.setStatus("No fillable form fields found on this page.", "warn");
      return;
    }

    const counts = { rule: 0, ai: 0, manual: 0 };

    // Pass 1 — free, local matching.
    const leftoverShort = [];
    const leftoverEssay = [];
    const leftoverChoice = [];
    const leftoverResume = [];

    for (const field of fields) {
      if (field.matchType === "file") {
        if (/resume|cv|curriculum vitae/i.test(field.label)) {
          leftoverResume.push(field);
        } else {
          jobfillMarkManual(field, "File upload — attach this yourself.");
          counts.manual++;
        }
        continue;
      }
      if (field.matchType === "select" || field.matchType === "radio" || field.matchType === "checkbox") {
        leftoverChoice.push(field);
        continue;
      }
      if (field.matchType === "textarea-long") {
        leftoverEssay.push(field);
        continue;
      }
      const value = jobfillMatchField(field, profile);
      if (value !== null) {
        jobfillFillField(field, value);
        jobfillMarkFilled(field, "rule");
        counts.rule++;
      } else {
        leftoverShort.push(field);
      }
    }

    // Pass 2 — short/leftover + choice fields go to Gemini Flash as one
    // batched field-mapping call (cheap, and one call beats N calls).
    const mappingTargets = [...leftoverShort, ...leftoverChoice];
    if (mappingTargets.length > 0) {
      badge.setStatus(`Asking Gemini to map ${mappingTargets.length} remaining field(s)…`);
      try {
        const mapping = await jobfillRequestFieldMapping(mappingTargets, profile);
        for (const field of mappingTargets) {
          const raw = mapping[field.id];
          if (
            raw === null ||
            raw === undefined ||
            String(raw).includes(JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN) ||
            String(raw).trim() === ""
          ) {
            jobfillMarkManual(field, "Needs your input — not enough profile data.");
            counts.manual++;
          } else {
            jobfillFillField(field, String(raw));
            jobfillMarkFilled(field, "ai");
            counts.ai++;
          }
        }
      } catch (err) {
        mappingTargets.forEach((f) =>
          jobfillMarkManual(f, "AI mapping failed — fill this one by hand.")
        );
        counts.manual += mappingTargets.length;
        console.error("JobFill mapping error:", err);
      }
    }

    const jobContext = (leftoverEssay.length > 0 || leftoverResume.length > 0) ? jobfillExtractJobContext() : "";

    // Pass 3 — genuinely open-ended questions go to Sonnet, one call each,
    // since each deserves its own tailored answer.
    if (leftoverEssay.length > 0) {
      for (const field of leftoverEssay) {
        badge.setStatus(`Drafting an answer for: "${jobfillTruncate(field.label, 50)}"…`);
        try {
          const answer = await jobfillRequestWrittenAnswer(field, profile, jobContext);
          if (!answer || answer.includes(JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN)) {
            jobfillMarkManual(field, "Needs your input — not enough profile data.");
            counts.manual++;
          } else {
            jobfillFillField(field, answer);
            jobfillMarkFilled(field, "ai");
            counts.ai++;
          }
        } catch (err) {
          jobfillMarkManual(field, "AI drafting failed — fill this one by hand.");
          counts.manual++;
          console.error("JobFill writing error:", err);
        }
      }
    }

    // Pass 4 — Resumes
    if (leftoverResume.length > 0) {
      for (const field of leftoverResume) {
        badge.setStatus(`Choosing best resume for: "${jobfillTruncate(field.label, 50)}"…`);
        try {
          const resume = await jobfillRequestResume(jobContext);
          if (resume) {
            jobfillFillFile(field, resume);
            jobfillMarkFilled(field, "ai");
            counts.ai++;
          } else {
            jobfillMarkManual(field, "No resumes uploaded in settings.");
            counts.manual++;
          }
        } catch (err) {
          jobfillMarkManual(field, "Resume AI selection failed.");
          counts.manual++;
          console.error("JobFill resume error:", err);
        }
      }
    }

    badge.setStatus(
      `Done — ${counts.rule} filled locally, ${counts.ai} filled by AI, ${counts.manual} need your input. Review before you submit.`,
      "done",
      counts,
      fields
    );

    await jobfillAppendLog({
      url: location.href,
      title: document.title,
      date: new Date().toISOString(),
      filledByRule: counts.rule,
      filledByAI: counts.ai,
      needsManual: counts.manual,
    });

    // Inject the "Save My Answers" button for continual learning
    jobfillInjectLearningButton(fields);
  } catch (err) {
    console.error("JobFill fatal error:", err);
    badge.setStatus(`Something went wrong: ${err.message}`, "error");
  } finally {
    // Allow another Fill run once this one is complete (or has errored out)
    window._jobfillRunning = false;
  }
})();

// ---------- scanning ----------

function jobfillScanFields() {
  const nodes = Array.from(document.querySelectorAll("input, select, textarea, [contenteditable='true'], [role='textbox']"));
  const fields = [];
  let counter = 0;

  for (const el of nodes) {
    if (el.disabled || el.readOnly) continue;
    if (el.type && ["hidden", "submit", "button", "reset", "image"].includes(el.type)) continue;
    if (!jobfillIsVisible(el)) continue;

    counter += 1;
    const id = `jobfill-${counter}`;
    el.setAttribute("data-jobfill-id", id);

    const label = jobfillFindLabel(el);
    let matchType;
    if (el.tagName === "SELECT") matchType = "select";
    else if (el.type === "radio") matchType = "radio";
    else if (el.type === "checkbox") matchType = "checkbox";
    else if (el.type === "file") matchType = "file";
    else if (el.tagName === "TEXTAREA") {
      // Heuristic: short textareas (small maxlength, or rows <= 2) are
      // treated like text inputs; larger ones are "essay" questions that
      // deserve a written answer rather than a direct profile lookup.
      const maxLen = el.maxLength && el.maxLength > 0 ? el.maxLength : Infinity;
      matchType = maxLen <= 100 || el.rows <= 2 ? "textarea-short" : "textarea-long";
    } else if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
      matchType = "textarea-long";
    } else {
      matchType = el.type || "text";
    }

    // Detect group question for radios and checkboxes (e.g. from <fieldset><legend> or role="radiogroup")
    let groupQuestion = "";
    if (matchType === "radio" || matchType === "checkbox") {
      const fieldset = el.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend && legend.textContent.trim()) {
          groupQuestion = legend.textContent.trim();
        }
      }
      if (!groupQuestion) {
        const groupContainer = el.closest("[role='radiogroup'], [role='group']");
        if (groupContainer) {
          const groupLabel = groupContainer.getAttribute("aria-label") ||
            (groupContainer.getAttribute("aria-labelledby") && document.getElementById(groupContainer.getAttribute("aria-labelledby"))?.textContent);
          if (groupLabel) groupQuestion = groupLabel.trim();
        }
      }
    }

    const autocomplete = el.getAttribute("autocomplete") || "";

    const field = {
      id,
      tag: el.tagName.toLowerCase(),
      matchType,
      label: groupQuestion ? `${groupQuestion} [Option: ${label || el.value}]` : label,
      rawLabel: label,
      groupQuestion,
      autocomplete,
      placeholder: el.getAttribute("placeholder") || "",
      name: el.getAttribute("name") || "",
    };

    if (matchType === "select") {
      field.options = Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean);
    }
    if (matchType === "radio" || matchType === "checkbox") {
      field.groupValue = el.value;
    }

    fields.push(field);
  }
  return fields;
}

function jobfillIsVisible(el) {
  if (!el.offsetParent && el.tagName !== "INPUT") return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function jobfillFindLabel(el) {
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel && forLabel.textContent.trim()) return forLabel.textContent.trim();
  }
  const closestLabel = el.closest("label");
  if (closestLabel && closestLabel.textContent.trim()) {
    return closestLabel.textContent.replace(el.value || "", "").trim();
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref && ref.textContent.trim()) return ref.textContent.trim();
  }
  // Walk a few previous siblings/parents looking for label-ish text.
  let node = el.previousElementSibling;
  let hops = 0;
  while (node && hops < 3) {
    const text = node.textContent && node.textContent.trim();
    if (text && text.length < 150) return text;
    node = node.previousElementSibling;
    hops++;
  }
  return el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

// ---------- filling & marking ----------

function jobfillFillField(field, value) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;

  if (field.matchType === "select") {
    const valTrimmed = String(value).trim().toLowerCase();
    const match = Array.from(el.options).find(
      (o) =>
        o.textContent.trim().toLowerCase() === valTrimmed ||
        o.value.trim().toLowerCase() === valTrimmed ||
        (valTrimmed.length > 2 && o.textContent.trim().toLowerCase().includes(valTrimmed))
    );
    if (match) {
      el.value = match.value;
      el.selectedIndex = match.index;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  if (field.matchType === "radio" || field.matchType === "checkbox") {
    const valStr = String(value).trim().toLowerCase();
    const fieldVal = String(field.groupValue || el.value || "").trim().toLowerCase();
    const fieldLabel = String(field.rawLabel || field.label || "").trim().toLowerCase();

    const isYes = /^(yes|true|y|1)$/i.test(valStr);
    const isNo = /^(no|false|n|0)$/i.test(valStr);

    let shouldCheck = false;
    if (isYes) {
      if (fieldVal === "yes" || fieldVal === "true" || fieldVal === "1" || /^(yes|agree)$/i.test(fieldLabel)) {
        shouldCheck = true;
      }
    } else if (isNo) {
      if (fieldVal === "no" || fieldVal === "false" || fieldVal === "0" || /^(no|disagree)$/i.test(fieldLabel)) {
        shouldCheck = true;
      }
    } else {
      if (valStr === fieldVal || valStr === fieldLabel || fieldLabel.includes(valStr) || valStr.includes(fieldLabel)) {
        shouldCheck = true;
      }
    }

    if (field.matchType === "checkbox" && isYes) {
      shouldCheck = true;
    }

    if (shouldCheck) {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // React 16+ / Vue / modern framework controlled component prototype setter bypass
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function jobfillFillFile(field, resume) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;

  const dataUriParts = resume.data.split(',');
  const byteString = atob(dataUriParts[1]);
  const mimeString = dataUriParts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeString });
  const file = new File([blob], resume.filename, { type: mimeString });

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  el.files = dataTransfer.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}




function jobfillMarkFilled(field, source) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.setAttribute("data-jobfill-filled", source);
  const color = source === "rule" ? "#10b981" : "#3b82f6";
  el.style.setProperty("outline", `1.5px solid ${color}`, "important");
  el.style.setProperty("outline-offset", "1px", "important");
  el.title = source === "rule" 
    ? "Filled by JobFill (profile match)" 
    : "Filled by JobFill (AI)";
  window._jobfillHighlightedElements.push(el);
}

function jobfillMarkManual(field, reason) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.setAttribute("data-jobfill-manual", "true");
  el.style.setProperty("outline", "1.5px solid #f59e0b", "important");
  el.style.setProperty("outline-offset", "1px", "important");
  el.title = `JobFill review: ${reason}`;
  window._jobfillManualFields.push({ el, field, reason });
  window._jobfillHighlightedElements.push(el);
}

// ---------- CAPTCHA detection ----------

function jobfillDetectCaptcha() {
  const selectors = [
    "iframe[src*='recaptcha']",
    "iframe[src*='hcaptcha']",
    "iframe[src*='turnstile']",
    "div.g-recaptcha",
    "div.h-captcha",
    "[class*='cf-turnstile']",
  ];
  return selectors.some((sel) => document.querySelector(sel));
}

// ---------- best-effort job description extraction ----------

function jobfillExtractJobContext() {
  const candidates = [
    "[class*='job-description']",
    "[class*='jobDescription']",
    "#content",
    "main",
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return jobfillTruncate(el.textContent.trim(), 3000);
    }
  }
  return jobfillTruncate(document.body.innerText || "", 1500);
}

function jobfillTruncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ---------- background messaging ----------

function jobfillRequestFieldMapping(fields, profile) {
  return chrome.runtime.sendMessage({
    action: "mapFields",
    fields: fields.map(({ id, label, placeholder, matchType, options }) => ({
      id,
      label,
      placeholder,
      matchType,
      options,
    })),
    profile,
  }).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return (res && res.mapping) || {};
  });
}

function jobfillRequestWrittenAnswer(field, profile, jobContext) {
  return chrome.runtime.sendMessage({
    action: "writeAnswer",
    question: field.label,
    profile,
    jobContext,
  }).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res && res.answer;
  });
}

function jobfillRequestResume(jobContext) {
  return chrome.runtime.sendMessage({
    action: "chooseResume",
    jobContext
  }).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res && res.resumeData;
  });
}

async function jobfillAppendLog(entry) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.LOG;
  const { [key]: existing } = await chrome.storage.local.get(key);
  const log = Array.isArray(existing) ? existing : [];
  log.unshift(entry);
  await chrome.storage.local.set({ [key]: log.slice(0, JOBFILL_DEFAULTS.MAX_LOG_ENTRIES) });
}

// ---------- on-page JobFill Floating Toolbar (Shadow DOM, isolated from page styles) ----------

let _jobfillActiveBar = null;

function jobfillCreateBadge() {
  if (_jobfillActiveBar && _jobfillActiveBar.remove) {
    _jobfillActiveBar.remove();
  }

  const host = document.createElement("div");
  host.setAttribute("data-jobfill-toolbar", "true");
  host.style.position = "fixed";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    .bar {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      font-size: 12px;
      line-height: 1.4;
      background: #121215;
      color: #f4f4f5;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 7px 12px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: fadeIn 0.15s ease;
    }

    .bar-spinner {
      width: 11px;
      height: 11px;
      border: 1.5px solid #3f3f46;
      border-top-color: #f4f4f5;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    .bar-title {
      font-weight: 600;
      color: #fff;
    }

    .bar-status {
      color: #a1a1aa;
    }

    .bar-btn {
      background: transparent;
      border: 1px solid #27272a;
      color: #f4f4f5;
      font-size: 11.5px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .bar-btn:hover {
      background: #1c1c20;
      border-color: #3f3f46;
    }

    .bar-btn-accent {
      background: #27272a;
      border-color: #3f3f46;
      color: #fff;
    }
    .bar-btn-accent:hover {
      background: #3f3f46;
    }

    .bar-close {
      background: none;
      border: none;
      color: #71717a;
      font-size: 15px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
    }
    .bar-close:hover {
      color: #f4f4f5;
    }

    .hidden {
      display: none !important;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  const root = document.createElement("div");
  root.innerHTML = `
    <div class="bar" id="bar">
      <span class="bar-spinner" id="spinner"></span>
      <span class="bar-status" id="statusMsg">Scanning form fields…</span>
      <button class="bar-btn bar-btn-accent hidden" id="nextBtn">Next field →</button>
      <button class="bar-btn hidden" id="saveBtn">Save answers</button>
      <button class="bar-close" id="closeBtn" title="Dismiss">×</button>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(root);

  const spinner = shadow.getElementById("spinner");
  const statusMsg = shadow.getElementById("statusMsg");
  const nextBtn = shadow.getElementById("nextBtn");
  const saveBtn = shadow.getElementById("saveBtn");
  const closeBtn = shadow.getElementById("closeBtn");

  let currentFields = [];
  let manualIndex = 0;

  closeBtn.addEventListener("click", () => {
    host.remove();
  });

  nextBtn.addEventListener("click", () => {
    const list = window._jobfillManualFields || [];
    if (list.length === 0) {
      statusMsg.textContent = "All review fields complete";
      nextBtn.classList.add("hidden");
      return;
    }

    const item = list[manualIndex % list.length];
    manualIndex++;

    if (item && item.el) {
      item.el.scrollIntoView({ behavior: "smooth", block: "center" });
      item.el.focus();
      statusMsg.textContent = `Review: ${item.field.label || "Manual input"}`;
    }
  });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await jobfillCaptureUserInputs(currentFields);
      saveBtn.textContent = "Saved";
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save answers";
      }, 2000);
    } catch (_) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save answers";
    }
  });

  const controller = {
    setStatus(text, kind, counts, fields) {
      statusMsg.textContent = text;

      if (kind === "done") {
        spinner.classList.add("hidden");
        saveBtn.classList.remove("hidden");

        if (counts) {
          statusMsg.textContent = `${counts.rule} local · ${counts.ai} AI · ${counts.manual} manual`;

          if (counts.manual > 0) {
            nextBtn.classList.remove("hidden");
          }
        }

        if (fields) {
          currentFields = fields;
        }
      } else {
        spinner.classList.remove("hidden");
      }
    },

    remove() {
      host.remove();
    }
  };

  _jobfillActiveBar = controller;
  return controller;
}

function jobfillInjectLearningButton(fields) {
  // Gracefully handled inside floating bar
}

/**
 * Capture all user inputs from the form and store new/updated answers in memory.
 * This implements the "observation loop" - detecting what the user filled manually.
 */
async function jobfillCaptureUserInputs(fields) {
  const memoryEntries = {};
  let capturedCount = 0;

  for (const field of fields) {
    const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
    if (!el) continue;

    // Skip file inputs - can't learn from these
    if (field.matchType === "file") continue;

    let currentValue = null;

    // Extract current value based on field type
    if (field.matchType === "select") {
      const selectedOption = el.options[el.selectedIndex];
      currentValue = selectedOption ? selectedOption.textContent.trim() : null;
    } else if (field.matchType === "radio") {
      currentValue = el.checked ? "yes" : null;
    } else if (field.matchType === "checkbox") {
      currentValue = el.checked ? "yes" : null;
    } else if (el.hasAttribute("contenteditable")) {
      currentValue = el.textContent.trim();
    } else {
      currentValue = el.value.trim();
    }

    // Only capture if there's actual content
    if (currentValue && currentValue.length > 0) {
      // Normalize the question/label
      const question = jobfillNormalizeQuestion(field.label || field.placeholder || field.name);
      
      if (question) {
        memoryEntries[question] = {
          answer: currentValue,
          fieldType: field.matchType,
          lastUsed: new Date().toISOString(),
          timesUsed: 1, // Will be incremented if already exists
          source: "user_input"
        };
        capturedCount++;
      }
    }
  }

  if (capturedCount > 0) {
    await jobfillSaveToMemory(memoryEntries);
    console.log(`JobFill: Learned ${capturedCount} new answers from your input.`);
  }

  // Send notification to background script
  chrome.runtime.sendMessage({
    action: "memoryUpdated",
    count: capturedCount
  });
}

/**
 * Normalize question text for better matching in the future.
 * Removes extra whitespace, standardizes casing, removes special characters.
 */
function jobfillNormalizeQuestion(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[*:?!]/g, "") // Remove special punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 300); // Limit length
}

/**
 * Save captured answers to the user memory storage.
 * Merges with existing memory, updating counts and timestamps.
 */
async function jobfillSaveToMemory(newEntries) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const { [key]: existingMemory } = await chrome.storage.local.get(key);
  const memory = existingMemory || {};

  // Merge new entries with existing memory
  for (const [question, data] of Object.entries(newEntries)) {
    if (memory[question]) {
      // Update existing entry
      memory[question].answer = data.answer; // Overwrite with latest answer
      memory[question].lastUsed = data.lastUsed;
      memory[question].timesUsed = (memory[question].timesUsed || 0) + 1;
    } else {
      // Add new entry
      memory[question] = data;
    }
  }

  // Enforce maximum entries limit (keep most recently used)
  const entries = Object.entries(memory);
  if (entries.length > JOBFILL_DEFAULTS.MAX_MEMORY_ENTRIES) {
    // Sort by lastUsed descending and keep top N
    const sorted = entries.sort((a, b) => 
      new Date(b[1].lastUsed) - new Date(a[1].lastUsed)
    );
    const trimmed = Object.fromEntries(
      sorted.slice(0, JOBFILL_DEFAULTS.MAX_MEMORY_ENTRIES)
    );
    await chrome.storage.local.set({ [key]: trimmed });
  } else {
    await chrome.storage.local.set({ [key]: memory });
  }
}

/**
 * Retrieve user memory for injection into AI prompts.
 */
async function jobfillGetMemory() {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const { [key]: memory } = await chrome.storage.local.get(key);
  return memory || {};
}
