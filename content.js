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

    const { [JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE]: profile } =
      await chrome.storage.local.get(JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE);

    if (!profile) {
      badge.setStatus(
        "No profile found. Open the extension's Options page and add your profile.json first.",
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

    for (const field of fields) {
      if (field.matchType === "file") {
        jobfillMarkManual(field, "File upload — attach this yourself.");
        counts.manual++;
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

    // Pass 3 — genuinely open-ended questions go to Sonnet, one call each,
    // since each deserves its own tailored answer.
    if (leftoverEssay.length > 0) {
      const jobContext = jobfillExtractJobContext();
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

    badge.setStatus(
      `Done — ${counts.rule} filled locally, ${counts.ai} filled by AI, ${counts.manual} need your input. Review before you submit.`,
      "done"
    );

    await jobfillAppendLog({
      url: location.href,
      title: document.title,
      date: new Date().toISOString(),
      filledByRule: counts.rule,
      filledByAI: counts.ai,
      needsManual: counts.manual,
    });
  } catch (err) {
    console.error("JobFill fatal error:", err);
    badge.setStatus(`Something went wrong: ${err.message}`, "error");
  }
})();

// ---------- scanning ----------

function jobfillScanFields() {
  const nodes = Array.from(document.querySelectorAll("input, select, textarea"));
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
    } else {
      matchType = el.type || "text";
    }

    const field = {
      id,
      tag: el.tagName.toLowerCase(),
      matchType,
      label,
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
    const match = Array.from(el.options).find(
      (o) => o.textContent.trim().toLowerCase() === String(value).trim().toLowerCase()
    );
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  if (field.matchType === "radio" || field.matchType === "checkbox") {
    const shouldCheck = /^(yes|true|y)$/i.test(String(value).trim());
    if (shouldCheck) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function jobfillMarkFilled(field, source) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.style.outline = source === "rule" ? "2px solid #5eead4" : "2px solid #60a5fa";
  el.style.outlineOffset = "1px";
  el.title = source === "rule" ? "Filled by JobFill (local match)" : "Filled by JobFill (AI)";
}

function jobfillMarkManual(field, reason) {
  const el = document.querySelector(`[data-jobfill-id="${field.id}"]`);
  if (!el) return;
  el.style.outline = "2px solid #fb923c";
  el.style.outlineOffset = "1px";
  el.title = `JobFill: ${reason}`;
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

async function jobfillAppendLog(entry) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.LOG;
  const { [key]: existing } = await chrome.storage.local.get(key);
  const log = Array.isArray(existing) ? existing : [];
  log.unshift(entry);
  await chrome.storage.local.set({ [key]: log.slice(0, JOBFILL_DEFAULTS.MAX_LOG_ENTRIES) });
}

// ---------- on-page status badge (shadow DOM, isolated from page styles) ----------

function jobfillCreateBadge() {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .box {
      font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0f1115;
      color: #e6e6e6;
      border: 1px solid #2a2e37;
      border-left: 3px solid #5eead4;
      border-radius: 8px;
      padding: 10px 14px;
      max-width: 320px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
    }
    .box.warn { border-left-color: #fb923c; }
    .box.error { border-left-color: #f87171; }
    .box.done { border-left-color: #5eead4; }
    .label {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 11px;
      color: #8b93a3;
      letter-spacing: 0.02em;
      margin-bottom: 4px;
    }
  `;
  const box = document.createElement("div");
  box.className = "box";
  box.innerHTML = `<div class="label">JobFill</div><div class="msg"></div>`;
  shadow.appendChild(style);
  shadow.appendChild(box);

  return {
    setStatus(text, kind) {
      box.className = `box${kind ? " " + kind : ""}`;
      box.querySelector(".msg").textContent = text;
      if (kind === "done") {
        setTimeout(() => host.remove(), 15000);
      }
    },
  };
}
