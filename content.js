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
  const badge = jobfillCreateBadge();
  badge.setStatus("Scanning page…");

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

window._jobfillManualFields = [];
window._jobfillHighlightedElements = [];

function jobfillMarkFilled(field, source) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.setAttribute("data-jobfill-filled", source);
  const color = source === "rule" ? "#10b981" : "#38bdf8";
  const glow = source === "rule" ? "rgba(16, 185, 129, 0.3)" : "rgba(56, 189, 248, 0.3)";
  el.style.setProperty("box-shadow", `0 0 0 2px ${color}, 0 0 12px ${glow}`, "important");
  el.style.setProperty("border-radius", "5px", "important");
  el.title = source === "rule" 
    ? "✓ Filled by JobFill (auto-matched from your profile)" 
    : "🤖 Filled by JobFill (tailored with Gemini AI)";
  window._jobfillHighlightedElements.push(el);
}

function jobfillMarkManual(field, reason) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.setAttribute("data-jobfill-manual", "true");
  el.style.setProperty("box-shadow", "0 0 0 2px #f59e0b, 0 0 14px rgba(245, 158, 11, 0.35)", "important");
  el.style.setProperty("border-radius", "5px", "important");
  el.title = `⚠️ JobFill review needed: ${reason}`;
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

// ---------- on-page JobFill Copilot Dock (Shadow DOM, isolated from page styles) ----------

let _jobfillActiveDock = null;

function jobfillCreateBadge() {
  if (_jobfillActiveDock && _jobfillActiveDock.remove) {
    _jobfillActiveDock.remove();
  }

  const host = document.createElement("div");
  host.setAttribute("data-jobfill-copilot", "true");
  host.style.position = "fixed";
  host.style.bottom = "18px";
  host.style.right = "18px";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    .copilot-card {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      background: rgba(14, 18, 27, 0.94);
      color: #f1f5f9;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 14px 16px;
      width: 320px;
      box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .copilot-card.minimized {
      display: none;
    }

    /* Floating Orb (Minimized State) */
    .copilot-orb {
      display: none;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #059669 0%, #0284c7 100%);
      color: #fff;
      box-shadow: 0 4px 18px rgba(6, 182, 212, 0.45);
      cursor: pointer;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: transform 0.2s ease;
    }

    .copilot-orb:hover {
      transform: scale(1.08);
    }

    .copilot-orb.visible {
      display: flex;
    }

    .orb-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      background: #f59e0b;
      color: #000;
      font-size: 9px;
      font-weight: 800;
      border-radius: 999px;
      min-width: 16px;
      height: 16px;
      line-height: 16px;
      text-align: center;
      padding: 0 3px;
    }

    /* Header */
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      transition: background 0.2s;
    }
    .status-dot.warn { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
    .status-dot.error { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .status-dot.busy {
      background: #38bdf8;
      box-shadow: 0 0 8px #38bdf8;
      animation: pulse 1s infinite alternate;
    }

    .brand-title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: -0.2px;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .brand-badge {
      font-size: 9px;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 999px;
      background: rgba(45, 212, 191, 0.15);
      color: #2dd4bf;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .ctrl-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 13px;
      transition: all 0.15s ease;
    }
    .ctrl-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    /* Message */
    .status-msg {
      color: #cbd5e1;
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 10px;
    }

    /* Metric Badges */
    .metric-strip {
      display: none;
      gap: 6px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .metric-strip.visible {
      display: flex;
    }

    .pill {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .pill.rule { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .pill.ai { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .pill.manual { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }

    /* Actions Grid */
    .action-grid {
      display: none;
      flex-direction: column;
      gap: 6px;
    }
    .action-grid.visible {
      display: flex;
    }

    .copilot-btn {
      width: 100%;
      border: none;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .btn-review-next {
      background: rgba(245, 158, 11, 0.18);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.4);
    }
    .btn-review-next:hover {
      background: rgba(245, 158, 11, 0.28);
    }

    .btn-learn {
      background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
      color: #fff;
      box-shadow: 0 2px 10px rgba(6, 182, 212, 0.3);
    }
    .btn-learn:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
    .btn-learn.success {
      background: #10b981;
    }

    .utility-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .subtle-btn {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 11px;
      cursor: pointer;
      padding: 2px 4px;
      transition: color 0.15s ease;
    }
    .subtle-btn:hover {
      color: #fff;
    }

    @keyframes pulse {
      from { opacity: 0.6; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1.15); }
    }
  `;

  // HTML Structure
  const root = document.createElement("div");
  root.innerHTML = `
    <!-- Expanded Floating HUD Card -->
    <div class="copilot-card" id="card">
      <div class="card-header">
        <div class="brand-wrap">
          <div class="status-dot busy" id="dot"></div>
          <span class="brand-title">JobFill <span class="brand-badge">Copilot</span></span>
        </div>
        <div class="header-controls">
          <button class="ctrl-btn" id="minBtn" title="Minimize to small orb">_</button>
          <button class="ctrl-btn" id="closeBtn" title="Dismiss Copilot">×</button>
        </div>
      </div>

      <div class="status-msg" id="msg">Scanning form fields…</div>

      <div class="metric-strip" id="metricStrip">
        <span class="pill rule" id="pillRule">⚡ 0 local</span>
        <span class="pill ai" id="pillAi">🤖 0 AI</span>
        <span class="pill manual" id="pillManual">⚠️ 0 review</span>
      </div>

      <div class="action-grid" id="actionGrid">
        <button class="copilot-btn btn-review-next" id="reviewNextBtn">
          <span>🎯 Review Next Field (<span id="reviewRemain">0</span>)</span>
        </button>
        <button class="copilot-btn btn-learn" id="saveAnswersBtn">
          <span>💾 Save My Answers</span>
        </button>
        <div class="utility-row">
          <button class="subtle-btn" id="toggleHighlightsBtn">Toggle Highlights</button>
          <span style="font-size: 10px; color: #64748b;">Never auto-submits</span>
        </div>
      </div>
    </div>

    <!-- Collapsed Floating Orb -->
    <div class="copilot-orb" id="orb" title="JobFill Copilot (Click to open)">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
      <span class="orb-badge" id="orbBadge">0</span>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(root);

  // References inside shadow root
  const card = shadow.getElementById("card");
  const orb = shadow.getElementById("orb");
  const orbBadge = shadow.getElementById("orbBadge");
  const dot = shadow.getElementById("dot");
  const msg = shadow.getElementById("msg");
  const minBtn = shadow.getElementById("minBtn");
  const closeBtn = shadow.getElementById("closeBtn");
  const metricStrip = shadow.getElementById("metricStrip");
  const pillRule = shadow.getElementById("pillRule");
  const pillAi = shadow.getElementById("pillAi");
  const pillManual = shadow.getElementById("pillManual");
  const actionGrid = shadow.getElementById("actionGrid");
  const reviewNextBtn = shadow.getElementById("reviewNextBtn");
  const reviewRemain = shadow.getElementById("reviewRemain");
  const saveAnswersBtn = shadow.getElementById("saveAnswersBtn");
  const toggleHighlightsBtn = shadow.getElementById("toggleHighlightsBtn");

  let currentFields = [];
  let currentManualIndex = 0;
  let outlinesVisible = true;

  // Minimize / Expand logic
  minBtn.addEventListener("click", () => {
    card.classList.add("minimized");
    orb.classList.add("visible");
  });

  orb.addEventListener("click", () => {
    orb.classList.remove("visible");
    card.classList.remove("minimized");
  });

  closeBtn.addEventListener("click", () => {
    host.remove();
  });

  // Review Next Field Navigation
  reviewNextBtn.addEventListener("click", () => {
    const list = window._jobfillManualFields || [];
    if (list.length === 0) {
      msg.textContent = "All manual fields have been reviewed! 🎉";
      reviewNextBtn.style.display = "none";
      return;
    }

    const item = list[currentManualIndex % list.length];
    currentManualIndex++;

    if (item && item.el) {
      item.el.scrollIntoView({ behavior: "smooth", block: "center" });
      item.el.focus();
      // Temporary ripple animation
      item.el.style.setProperty("outline", "3px solid #f59e0b", "important");
      setTimeout(() => {
        item.el.style.removeProperty("outline");
      }, 1500);

      reviewRemain.textContent = `${list.length - (currentManualIndex % list.length)}`;
      msg.textContent = `Reviewing: ${item.field.label || "Required field"}`;
    }
  });

  // Save My Answers
  saveAnswersBtn.addEventListener("click", async () => {
    saveAnswersBtn.disabled = true;
    saveAnswersBtn.textContent = "Learning answers…";

    try {
      await jobfillCaptureUserInputs(currentFields);
      saveAnswersBtn.textContent = "✓ Saved to Memory!";
      saveAnswersBtn.classList.add("success");
      setTimeout(() => {
        saveAnswersBtn.disabled = false;
        saveAnswersBtn.classList.remove("success");
        saveAnswersBtn.textContent = "💾 Save My Answers";
      }, 2500);
    } catch (err) {
      saveAnswersBtn.textContent = "Error saving";
      saveAnswersBtn.disabled = false;
    }
  });

  // Toggle Highlights
  toggleHighlightsBtn.addEventListener("click", () => {
    outlinesVisible = !outlinesVisible;
    const elements = window._jobfillHighlightedElements || [];
    elements.forEach((el) => {
      if (outlinesVisible) {
        const isManual = el.getAttribute("data-jobfill-manual");
        const filledType = el.getAttribute("data-jobfill-filled");
        if (isManual) {
          el.style.setProperty("box-shadow", "0 0 0 2px #f59e0b, 0 0 14px rgba(245, 158, 11, 0.35)", "important");
        } else if (filledType === "rule") {
          el.style.setProperty("box-shadow", "0 0 0 2px #10b981, 0 0 10px rgba(16, 185, 129, 0.3)", "important");
        } else {
          el.style.setProperty("box-shadow", "0 0 0 2px #38bdf8, 0 0 10px rgba(56, 189, 248, 0.3)", "important");
        }
      } else {
        el.style.removeProperty("box-shadow");
      }
    });
    toggleHighlightsBtn.textContent = outlinesVisible ? "Hide Highlights" : "Show Highlights";
  });

  const copilotController = {
    setStatus(text, kind, counts, fields) {
      msg.textContent = text;
      dot.className = "status-dot";

      if (kind === "warn") dot.classList.add("warn");
      else if (kind === "error") dot.classList.add("error");
      else if (kind === "done") {
        dot.style.background = "#10b981";
        metricStrip.classList.add("visible");
        actionGrid.classList.add("visible");

        if (counts) {
          pillRule.textContent = `⚡ ${counts.rule} local`;
          pillAi.textContent = `🤖 ${counts.ai} AI`;
          pillManual.textContent = `⚠️ ${counts.manual} review`;

          if (counts.manual > 0) {
            reviewRemain.textContent = counts.manual;
            orbBadge.textContent = counts.manual;
          } else {
            reviewNextBtn.style.display = "none";
            orbBadge.style.display = "none";
          }
        }

        if (fields) {
          currentFields = fields;
        }
      } else {
        dot.classList.add("busy");
      }
    },

    remove() {
      host.remove();
    }
  };

  _jobfillActiveDock = copilotController;
  return copilotController;
}

function jobfillInjectLearningButton(fields) {
  // Gracefully hand over fields to the active Copilot dock
  if (_jobfillActiveDock && _jobfillActiveDock.setStatus) {
    // Already integrated into the dock!
    return;
  }
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
