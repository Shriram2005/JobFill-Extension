// content.js — Injected on demand (via chrome.scripting.executeScript) when
// the user clicks "Fill application" or triggers the keyboard shortcut.
//
// Key Principles:
// - Never submits or applies automatically.
// - Local rules execute first (0 API cost, instant, 100% private).
// - Preserves existing values by default unless overwrite is enabled.
// - Full Undo snapshot to restore all fields at any time.
// - Verified field setting with DOM feedback.
// - Explicit confirmation for saving learned answers (with sensitive data exclusion).
// - Explicit confirmation for resume attachment.
// - Quick logging to the built-in Application Tracker.

const _global = typeof window !== "undefined" ? window : global;
var _jobfillActiveBar = _global._jobfillActiveBar || null;
_global._jobfillSnapshot = _global._jobfillSnapshot || new Map();
_global._jobfillObserverActive = _global._jobfillObserverActive || false;

_global.jobfillRun = async function jobfillRun() {
  if (window._jobfillRunning) return;
  window._jobfillRunning = true;

  // Clear per-run review tracking
  window._jobfillManualFields = [];
  window._jobfillHighlightedElements = [];

  const isTopFrame = window === window.top;
  const initialFields = jobfillScanFields();

  // If executing in a child frame (ad, tracker, widget) with 0 fields, exit silently
  if (!isTopFrame && initialFields.length === 0) {
    window._jobfillRunning = false;
    return;
  }

  const badge = jobfillCreateBadge();
  badge.setStatus("Scanning form fields…");

  try {
    // 1. Check for CAPTCHA
    if (jobfillDetectCaptcha()) {
      badge.setStatus(
        "CAPTCHA detected — please solve it, then click Fill again.",
        "warn"
      );
      return;
    }

    // 2. Fetch User Profile & Preferences
    const stored = await chrome.storage.local.get([
      JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE,
      JOBFILL_DEFAULTS.STORAGE_KEYS.OVERWRITE_EXISTING,
      JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE_PHOTO,
    ]);

    const profile = stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE];
    const overwriteExisting = Boolean(stored[JOBFILL_DEFAULTS.STORAGE_KEYS.OVERWRITE_EXISTING]);
    const profilePhoto = stored[JOBFILL_DEFAULTS.STORAGE_KEYS.PROFILE_PHOTO];

    if (!profile || typeof profile !== "object" || Object.keys(profile).length === 0) {
      badge.setStatus(
        "No profile found in storage. Open JobFill settings to configure your profile.",
        "error"
      );
      return;
    }

    // 3. Scan Visible Fillable Fields
    const fields = initialFields.length > 0 ? initialFields : jobfillScanFields();
    if (fields.length === 0) {
      const hasIframes = document.querySelectorAll("iframe").length > 0;
      if (hasIframes) {
        badge.setStatus("Embedded application frame detected — filling…", "done");
        setTimeout(() => {
          if (badge && (!window._jobfillHighlightedElements || window._jobfillHighlightedElements.length === 0)) {
            badge.setStatus("Autofill active in embedded frame ✓", "done");
          }
        }, 1500);
      } else {
        badge.setStatus(
          "No fillable form fields found on this page.",
          "warn"
        );
      }
      return;
    }

    // Listen for manual edits so the user can easily save custom answers
    jobfillAttachEditListeners(fields);

    const counts = { rule: 0, ai: 0, manual: 0, skipped: 0 };
    const leftoverShort = [];
    const leftoverEssay = [];
    const leftoverChoice = [];
    const leftoverResume = [];
    const leftoverPhoto = [];

    // Pass 1: Local Rule Matching
    for (const field of fields) {
      // 1. Handle file uploads (Photos & Resumes)
      if (
        field.matchType === "file" ||
        field.matchType === "file-resume" ||
        field.matchType === "file-photo"
      ) {
        if (
          field.matchType === "file-resume" ||
          /resume|cv|curriculum\s*vitae/i.test(field.label || field.name || "")
        ) {
          leftoverResume.push(field);
        } else if (
          field.matchType === "file-photo" ||
          /photo|picture|avatar|headshot|portrait/i.test(field.label || field.name || "")
        ) {
          leftoverPhoto.push(field);
        } else {
          jobfillMarkManual(field, "File upload — please attach manually.");
          counts.manual++;
        }
        continue;
      }

      // 2. Handle Radio Groups
      if (field.matchType === "radio-group") {
        const hasExisting = field.options.some((opt) => {
          const optEl = jobfillFindElement(opt.id);
          return optEl && optEl.checked;
        });
        if (!overwriteExisting && hasExisting) {
          counts.skipped++;
          continue;
        }

        const matchedOpt =
          typeof jobfillMatchRadioGroup === "function"
            ? jobfillMatchRadioGroup(field, profile)
            : null;

        if (matchedOpt) {
          const optEl = jobfillFindElement(matchedOpt.id);
          if (optEl) {
            jobfillSnapshotField(optEl, "radio");
            if (!optEl.checked) optEl.click();
            optEl.checked = true;
            const nativeSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "checked"
            )?.set;
            if (nativeSetter) nativeSetter.call(optEl, true);
            const tracker = optEl._valueTracker;
            if (tracker) tracker.setValue("");
            optEl.dispatchEvent(new Event("input", { bubbles: true }));
            optEl.dispatchEvent(new Event("change", { bubbles: true }));
            optEl.dispatchEvent(new Event("click", { bubbles: true }));
            jobfillMarkFilled({ id: matchedOpt.id }, "rule");
            counts.rule++;
          } else {
            leftoverChoice.push(field);
          }
        } else {
          leftoverChoice.push(field);
        }
        continue;
      }

      const el = jobfillFindElement(field.id);
      if (!el) continue;

      // Check if field already contains a value
      if (!overwriteExisting && jobfillHasValue(el, field.matchType)) {
        counts.skipped++;
        continue;
      }

      // 3. Handle Dropdowns / Select / Combobox
      if (field.matchType === "select" || field.matchType === "combobox") {
        const matched =
          typeof jobfillMatchSelectOption === "function"
            ? jobfillMatchSelectOption(field, profile)
            : null;

        if (matched) {
          jobfillSnapshotField(el, field.matchType);
          const success = jobfillFillField(field, matched);
          if (success) {
            jobfillMarkFilled(field, "rule");
            counts.rule++;
          } else {
            leftoverChoice.push(field);
          }
        } else {
          leftoverChoice.push(field);
        }
        continue;
      }

      // 4. Handle Checkboxes (Agreements, certifications & skills)
      if (field.matchType === "checkbox") {
        const isAgreement =
          /agree|certify|consent|confirm|acknowledge|truthful|accept|terms|accurate|signature/i.test(
            field.rawLabel || field.label || field.name || ""
          );

        if (isAgreement) {
          jobfillSnapshotField(el, "checkbox");
          const success = jobfillFillField(field, "yes");
          if (success) {
            jobfillMarkFilled(field, "rule");
            counts.rule++;
          } else {
            leftoverChoice.push(field);
          }
          continue;
        }

        const allSkills = [
          ...(profile.skills?.technologies || []),
          ...(profile.skills?.core_competencies || []),
        ];
        const labelLower = (field.rawLabel || field.label || "").trim().toLowerCase();
        const hasSkill = allSkills.some(
          (s) => s.toLowerCase() === labelLower || labelLower.includes(s.toLowerCase())
        );

        if (hasSkill) {
          jobfillSnapshotField(el, "checkbox");
          const success = jobfillFillField(field, "yes");
          if (success) {
            jobfillMarkFilled(field, "rule");
            counts.rule++;
          } else {
            leftoverChoice.push(field);
          }
          continue;
        }

        leftoverChoice.push(field);
        continue;
      }

      // 5. Handle Long Essays
      if (field.matchType === "textarea-long") {
        leftoverEssay.push(field);
        continue;
      }

      // 6. Try local rule match for text, email, tel, date, month, etc.
      const value = jobfillMatchField(field, profile);
      if (value !== null && String(value).trim() !== "") {
        jobfillSnapshotField(el, field.matchType);
        const success = jobfillFillField(field, value);
        if (success) {
          jobfillMarkFilled(field, "rule");
          counts.rule++;
        } else {
          jobfillMarkManual(field, "Could not set value — verify manually.");
          counts.manual++;
        }
      } else {
        leftoverShort.push(field);
      }
    }

    // Pass 2: Gemini Field Mapping (batched for remaining short + choice fields)
    const mappingTargets = [...leftoverShort, ...leftoverChoice];
    if (mappingTargets.length > 0) {
      badge.setStatus(`AI mapping ${mappingTargets.length} field(s)…`);
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
            jobfillMarkManual(field, "Needs your input — profile lacks this info.");
            counts.manual++;
            continue;
          }

          // Handle Radio Group AI selection
          if (field.matchType === "radio-group") {
            const rawStr = String(raw).trim().toLowerCase();
            const isYes = /^(yes|true|y|1)$/i.test(rawStr);
            const isNo = /^(no|false|n|0)$/i.test(rawStr);
            let chosen = null;

            for (const opt of field.options) {
              const optLabel = String(opt.label || "").trim().toLowerCase();
              const optVal = String(opt.value || "").trim().toLowerCase();
              if (
                isYes &&
                (/^(yes|true|y|1)$/i.test(optVal) ||
                  /^(yes|true|y|1)$/i.test(optLabel) ||
                  optLabel.startsWith("yes"))
              ) {
                chosen = opt;
                break;
              }
              if (
                isNo &&
                (/^(no|false|n|0)$/i.test(optVal) ||
                  /^(no|false|n|0)$/i.test(optLabel) ||
                  optLabel.startsWith("no"))
              ) {
                chosen = opt;
                break;
              }
              if (
                optLabel === rawStr ||
                optVal === rawStr ||
                optLabel.includes(rawStr) ||
                rawStr.includes(optLabel)
              ) {
                chosen = opt;
                break;
              }
            }

            if (chosen) {
              const optEl = jobfillFindElement(chosen.id);
              if (optEl) {
                jobfillSnapshotField(optEl, "radio");
                if (!optEl.checked) optEl.click();
                optEl.checked = true;
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "checked"
                )?.set;
                if (nativeSetter) nativeSetter.call(optEl, true);
                const tracker = optEl._valueTracker;
                if (tracker) tracker.setValue("");
                optEl.dispatchEvent(new Event("input", { bubbles: true }));
                optEl.dispatchEvent(new Event("change", { bubbles: true }));
                optEl.dispatchEvent(new Event("click", { bubbles: true }));
                jobfillMarkFilled({ id: chosen.id }, "ai");
                counts.ai++;
              } else {
                jobfillMarkManual(field, "Could not find radio element — check manually.");
                counts.manual++;
              }
            } else {
              jobfillMarkManual(field, "Verification failed — verify manually.");
              counts.manual++;
            }
            continue;
          }

          const el = jobfillFindElement(field.id);
          if (!el) continue;

          jobfillSnapshotField(el, field.matchType);
          const success = jobfillFillField(field, String(raw));
          if (success) {
            jobfillMarkFilled(field, "ai");
            counts.ai++;
          } else {
            jobfillMarkManual(field, "Verification failed — verify manually.");
            counts.manual++;
          }
        }
      } catch (err) {
        mappingTargets.forEach((f) =>
          jobfillMarkManual(f, "AI mapping failed — please fill manually.")
        );
        counts.manual += mappingTargets.length;
        console.error("JobFill mapping error:", err);
      }
    }

    const jobContext =
      leftoverEssay.length > 0 || leftoverResume.length > 0
        ? jobfillExtractJobContext()
        : "";

    // Pass 3: Open-ended Written Answers (Gemini tailored responses)
    if (leftoverEssay.length > 0) {
      for (const field of leftoverEssay) {
        badge.setStatus(`Drafting answer: "${jobfillTruncate(field.label, 40)}"…`);
        try {
          const answer = await jobfillRequestWrittenAnswer(field, profile, jobContext);
          const el = jobfillFindElement(field.id);
          if (!answer || answer.includes(JOBFILL_DEFAULTS.NEEDS_INPUT_TOKEN)) {
            jobfillMarkManual(field, "Needs your input — profile lacks this info.");
            counts.manual++;
          } else if (el) {
            jobfillSnapshotField(el, field.matchType);
            const success = jobfillFillField(field, answer);
            if (success) {
              jobfillMarkFilled(field, "ai");
              counts.ai++;
            } else {
              jobfillMarkManual(field, "Could not set answer — check manually.");
              counts.manual++;
            }
          }
        } catch (err) {
          jobfillMarkManual(field, "AI drafting error — fill manually.");
          counts.manual++;
          console.error("JobFill writing error:", err);
        }
      }
    }

    // Pass 4: File Attachments (Profile Photos & Resumes)
    if (leftoverPhoto.length > 0) {
      for (const field of leftoverPhoto) {
        if (profilePhoto && profilePhoto.data) {
          badge.promptPhotoAttach(field, profilePhoto);
        } else {
          jobfillMarkManual(
            field,
            "Profile photo detected — upload your photo in JobFill settings to auto-attach."
          );
          counts.manual++;
        }
      }
    }

    if (leftoverResume.length > 0) {
      for (const field of leftoverResume) {
        badge.setStatus(`Selecting best resume for: "${jobfillTruncate(field.label, 40)}"…`);
        try {
          const resumeSelection = await jobfillRequestResume(jobContext);
          if (resumeSelection && resumeSelection.data) {
            badge.promptResumeAttach(field, resumeSelection);
          } else {
            jobfillMarkManual(field, "No resumes configured in Settings.");
            counts.manual++;
          }
        } catch (err) {
          jobfillMarkManual(field, "Resume selection error.");
          counts.manual++;
          console.error("JobFill resume selection error:", err);
        }
      }
    }

    // Update floating badge with summary
    badge.showSummary(counts, fields);

    // Initialize multi-step / wizard listener for platforms like Workday, Taleo, Ashby
    jobfillSetupMultiStepObserver(badge);

    // Append to local log
    await jobfillAppendLog({
      url: location.href,
      title: document.title,
      date: new Date().toISOString(),
      filledByRule: counts.rule,
      filledByAI: counts.ai,
      needsManual: counts.manual,
      skipped: counts.skipped,
    });
  } catch (err) {
    console.error("JobFill fatal error:", err);
    badge.setStatus(`Something went wrong: ${err.message}`, "error");
  } finally {
    window._jobfillRunning = false;
  }
};

// Immediate execution when injected into a browser page
if (typeof window !== "undefined" && typeof window.jobfillRun === "function") {
  if (!window._jobfillNoAutoRun) {
    window.jobfillRun();
  }
}

// Runtime message listener for on-demand execution (e.g. from popup or shortcut)
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "jobfillRun") {
      if (typeof window !== "undefined" && typeof window.jobfillRun === "function") {
        window.jobfillRun();
        sendResponse({ ok: true });
      }
      return true;
    }
  });
}

// ---------- Form Field Scanning & DOM Analysis (with Shadow DOM Support) ----------

function jobfillFindElement(id) {
  if (!id) return null;
  const fast = document.querySelector(`[data-jobfill-id="${id}"]`);
  if (fast) return fast;

  let found = null;
  function search(node) {
    if (found || !node) return;
    if (node.querySelector) {
      try {
        const m = node.querySelector(`[data-jobfill-id="${id}"]`);
        if (m) {
          found = m;
          return;
        }
      } catch (_) {}
    }
    if (node.shadowRoot) search(node.shadowRoot);
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        if (found) return;
        const c = node.children[i];
        if (c) {
          if (c.shadowRoot) search(c.shadowRoot);
          if (c.children && c.children.length > 0) search(c);
        }
      }
    }
  }
  search(document.body || document.documentElement);
  return found;
}

function jobfillQuerySelectorAllDeep(selector, root = document) {
  const results = [];
  const seen = new Set();
  function traverse(node) {
    if (!node) return;
    if (node.querySelectorAll) {
      try {
        const found = node.querySelectorAll(selector);
        for (let i = 0; i < found.length; i++) {
          if (!seen.has(found[i])) {
            seen.add(found[i]);
            results.push(found[i]);
          }
        }
      } catch (_) {}
    }
    if (node.shadowRoot) {
      traverse(node.shadowRoot);
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c && c.shadowRoot) {
          traverse(c.shadowRoot);
        }
      }
    }
  }
  traverse(root);
  return results;
}

function jobfillScanFields() {
  const atsSelector = [
    "input",
    "select",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='searchbox']",
    "[role='checkbox']",
    "[role='radio']",
    "button[aria-haspopup='listbox']",
    "button[data-automation-id*='dropdown']",
    "button[data-automation-id*='select']",
    "div[data-automation-id*='select']",
    "div[data-uxi-element-id*='select']",
  ].join(", ");

  const nodes = jobfillQuerySelectorAllDeep(atsSelector);
  const fields = [];
  const radioGroups = new Map();
  let counter = 0;

  for (const el of nodes) {
    if (el.disabled || el.readOnly) continue;
    if (el.tagName === "BUTTON") {
      const isCombobox =
        el.getAttribute("role") === "combobox" ||
        el.getAttribute("aria-haspopup") === "listbox" ||
        el.getAttribute("role") === "checkbox" ||
        el.getAttribute("role") === "radio" ||
        /dropdown|select/i.test(el.getAttribute("data-automation-id") || "");
      if (!isCombobox) continue;
    } else if (el.type && ["hidden", "submit", "button", "reset", "image"].includes(el.type)) {
      continue;
    }
    if (!jobfillIsVisible(el)) continue;

    counter += 1;
    const id = `jobfill-${counter}`;
    el.setAttribute("data-jobfill-id", id);

    const label = jobfillFindLabel(el);
    let matchType;
    if (el.tagName === "SELECT") {
      matchType = "select";
    } else if (el.type === "radio" || el.getAttribute("role") === "radio") {
      matchType = "radio";
    } else if (el.type === "checkbox" || el.getAttribute("role") === "checkbox") {
      matchType = "checkbox";
    } else if (el.type === "file") {
      const isResume = /resume|cv|curriculum\s*vitae/i.test(label || el.name || el.id || "");
      const isPhoto =
        /photo|picture|avatar|headshot|portrait|candidate\s*image|profile\s*image/i.test(
          label || el.name || el.id || ""
        ) || (el.accept && /image/i.test(el.accept) && !isResume);
      matchType = isResume ? "file-resume" : isPhoto ? "file-photo" : "file";
    } else if (el.type === "date") {
      matchType = "date";
    } else if (el.type === "month") {
      matchType = "month";
    } else if (
      el.getAttribute("role") === "combobox" ||
      el.getAttribute("aria-haspopup") === "listbox" ||
      el.getAttribute("role") === "searchbox" ||
      /dropdown|select/i.test(el.getAttribute("data-automation-id") || "")
    ) {
      matchType = "combobox";
    } else if (el.tagName === "TEXTAREA") {
      const maxLen = el.maxLength && el.maxLength > 0 ? el.maxLength : Infinity;
      matchType = maxLen <= 120 || el.rows <= 2 ? "textarea-short" : "textarea-long";
    } else if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
      matchType = "textarea-long";
    } else {
      matchType = el.type || "text";
    }

    // Detect group question for radios and checkboxes
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
          const groupLabel =
            groupContainer.getAttribute("aria-label") ||
            (groupContainer.getAttribute("aria-labelledby") &&
              document.getElementById(groupContainer.getAttribute("aria-labelledby"))?.textContent);
          if (groupLabel) groupQuestion = groupLabel.trim();
        }
      }
      if (!groupQuestion && el.name) {
        let prev = el.closest("div")?.previousElementSibling;
        if (prev && /h[1-6]|p|label/i.test(prev.tagName) && prev.textContent.trim().length < 150) {
          groupQuestion = prev.textContent.trim();
        }
      }
    }

    // Handle Radio Buttons: Group by name or group container
    if (matchType === "radio") {
      const groupKey = el.name
        ? `name:${el.name}`
        : groupQuestion
        ? `q:${groupQuestion}`
        : `id:${id}`;
      if (!radioGroups.has(groupKey)) {
        radioGroups.set(groupKey, {
          id: `jobfill-group-${groupKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          tag: "radiogroup",
          matchType: "radio-group",
          groupQuestion: groupQuestion,
          label: groupQuestion || label || el.name || "Radio Selection",
          name: el.name || "",
          options: [],
        });
      }
      const grp = radioGroups.get(groupKey);
      grp.options.push({
        id,
        label: label || el.value || `Option ${grp.options.length + 1}`,
        value: el.value || "",
      });
      continue;
    }

    const autocomplete = el.getAttribute("autocomplete") || "";
    const maxLength = el.maxLength && el.maxLength > 0 ? el.maxLength : null;

    const field = {
      id,
      tag: el.tagName.toLowerCase(),
      matchType,
      label,
      rawLabel: label,
      groupQuestion,
      autocomplete,
      maxLength,
      placeholder: el.getAttribute("placeholder") || "",
      name: el.getAttribute("name") || "",
    };

    if (matchType === "select") {
      field.options = Array.from(el.options)
        .map((o) => o.textContent.trim())
        .filter(Boolean);
    }
    if (matchType === "combobox") {
      const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      if (listId) {
        const listEl = document.getElementById(listId);
        if (listEl) {
          field.options = Array.from(listEl.querySelectorAll("[role='option'], li, div"))
            .map((o) => o.textContent.trim())
            .filter(Boolean);
        }
      }
    }
    if (matchType === "checkbox") {
      field.groupValue = el.value;
    }

    fields.push(field);
  }

  // Append composite radio groups into scanned fields
  for (const grp of radioGroups.values()) {
    fields.push(grp);
  }

  return fields;
}

function jobfillIsVisible(el) {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.closest("fieldset[disabled]")) return false;

  // Workday, Greenhouse & modern CSS frameworks frequently visually hide native
  // checkboxes, radios, or file inputs behind styled labels, spans, or dropzones.
  const isCheckOrRadio =
    el.type === "checkbox" ||
    el.type === "radio" ||
    el.getAttribute("role") === "checkbox" ||
    el.getAttribute("role") === "radio";
  const isFileInput = el.type === "file";

  if (isCheckOrRadio || isFileInput) {
    const parentWrapper = el.closest("label, [data-automation-id*='formLabel'], .form-group, div");
    if (parentWrapper) {
      const pStyle = window.getComputedStyle(parentWrapper);
      if (pStyle.display === "none" || pStyle.visibility === "hidden") {
        return false;
      }
      const pRect = parentWrapper.getBoundingClientRect();
      if (pRect.width > 0 && pRect.height > 0) {
        return true;
      }
    }
  }

  if (el.closest("[aria-hidden='true']:not([role='combobox']):not(button)")) return false;

  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  if (!isCheckOrRadio && !isFileInput && style.opacity === "0") {
    return false;
  }

  // Geometry check
  const rect = el.getBoundingClientRect();
  if (!isCheckOrRadio && !isFileInput && rect.width === 0 && rect.height === 0 && style.position !== "fixed") {
    return false;
  }

  return true;
}

function jobfillFindLabel(el) {
  // 1. Workday data-automation-id
  const autoId = el.getAttribute("data-automation-id") || "";

  // 2. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const text = ids
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  // 4. label[for="id"]
  if (el.id) {
    try {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel && forLabel.textContent.trim()) return forLabel.textContent.trim();
    } catch (_) {}
  }

  // 5. Workday form label container
  const wdLabel = el.closest("[data-automation-id*='formLabel'], [data-automation-id*='formField']")?.querySelector("label, [data-automation-id*='label']");
  if (wdLabel && wdLabel.textContent.trim()) {
    const clone = wdLabel.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((c) => c.remove());
    if (clone.textContent.trim()) return clone.textContent.trim();
  }

  // 6. Closest wrapping label or field container (Greenhouse, Lever, Ashby)
  const closestLabel = el.closest("label, .field, .application-question, .form-group, [data-automation-id*='formGroup']");
  if (closestLabel) {
    const labelEl = closestLabel.querySelector("label, .field-label, .application-label, legend");
    if (labelEl && labelEl !== el && labelEl.textContent.trim()) {
      const clone = labelEl.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((c) => c.remove());
      if (clone.textContent.trim()) return clone.textContent.trim();
    }
  }

  // 7. Surrounding container / heading text
  let node = el.previousElementSibling;
  let hops = 0;
  while (node && hops < 3) {
    const text = node.textContent && node.textContent.trim();
    if (text && text.length > 1 && text.length < 150) return text;
    node = node.previousElementSibling;
    hops++;
  }

  // 8. If nothing found, parse data-automation-id (e.g. legalNameSection_firstName -> "legal name first name")
  if (autoId) {
    const cleanAutoId = autoId
      .replace(/section/i, " ")
      .replace(/formfield/i, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .trim();
    if (cleanAutoId.length > 2) return cleanAutoId;
  }

  return el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function jobfillHasValue(el, matchType) {
  if (!el) return false;
  if (matchType === "select") {
    return el.selectedIndex > 0 && String(el.value || "").trim() !== "";
  }
  if (matchType === "radio" || matchType === "checkbox") {
    return Boolean(el.checked);
  }
  if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
    return (el.textContent || "").trim().length > 0;
  }
  return String(el.value || "").trim().length > 0;
}

// Snapshot original values prior to modifying for full Undo support
function jobfillSnapshotField(el, matchType) {
  if (!el) return;
  const id = el.getAttribute("data-jobfill-id");
  if (!id || window._jobfillSnapshot.has(id)) return;

  if (matchType === "select") {
    window._jobfillSnapshot.set(id, {
      type: "select",
      value: el.value,
      selectedIndex: el.selectedIndex,
    });
  } else if (matchType === "radio" || matchType === "checkbox") {
    window._jobfillSnapshot.set(id, {
      type: "check",
      checked: el.checked,
    });
  } else if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
    window._jobfillSnapshot.set(id, {
      type: "contenteditable",
      text: el.textContent,
    });
  } else {
    window._jobfillSnapshot.set(id, {
      type: "value",
      value: el.value,
    });
  }
}

// ---------- Field Filling & Value Verification (with React & ATS Support) ----------

function jobfillFillCustomDropdown(el, targetValue, field) {
  try {
    const valStr = String(targetValue).trim().toLowerCase();

    // Check if element already shows the desired value
    if (el.textContent && el.textContent.trim().toLowerCase().includes(valStr)) {
      return true;
    }

    el.focus();
    el.click();

    // Workday and Radix UI render listbox either via aria-controls or in a body portal
    const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    let listEl = listId ? document.getElementById(listId) : null;

    if (!listEl) {
      listEl = document.querySelector(
        "[role='listbox'], ul[data-automation-id*='menu'], div[data-uxi-element-id*='select'], .select__menu, [data-radix-popper-content-wrapper]"
      );
    }

    if (listEl) {
      const options = Array.from(
        listEl.querySelectorAll("[role='option'], li, div[data-automation-id*='menuItem'], button")
      );

      const matched = options.find((opt) => {
        const text = opt.textContent.trim().toLowerCase();
        return text === valStr || text.includes(valStr) || valStr.includes(text);
      });

      if (matched) {
        matched.click();
        matched.dispatchEvent(new Event("click", { bubbles: true }));
        return true;
      }
    }

    el.setAttribute("aria-label", String(targetValue));
    return true;
  } catch (err) {
    console.warn("JobFill custom dropdown interaction:", err);
    return false;
  }
}

function jobfillSelectOptionFromOpenPopup(targetValue) {
  try {
    const valStr = String(targetValue).trim().toLowerCase();
    const popup = document.querySelector(
      "[role='listbox']:not([aria-hidden='true']), ul[data-automation-id*='menu'], .select__menu, div[data-uxi-element-id*='popup']"
    );
    if (!popup) return false;

    const items = Array.from(popup.querySelectorAll("[role='option'], li, div[data-automation-id*='menuItem']"));
    const match = items.find((item) => {
      const text = item.textContent.trim().toLowerCase();
      return text === valStr || (valStr.length > 2 && text.includes(valStr)) || (text.length > 2 && valStr.includes(text));
    });

    if (match) {
      match.click();
      return true;
    }
  } catch (_) {}
  return false;
}

function jobfillFillField(field, value) {
  const el = jobfillFindElement(field.id);
  if (!el) return false;

  if (field.matchType === "select") {
    const valTrimmed = String(value).trim().toLowerCase();
    const match = Array.from(el.options).find(
      (o) =>
        o.textContent.trim().toLowerCase() === valTrimmed ||
        o.value.trim().toLowerCase() === valTrimmed ||
        (valTrimmed.length > 2 && o.textContent.trim().toLowerCase().includes(valTrimmed)) ||
        (o.textContent.trim().length > 2 && valTrimmed.includes(o.textContent.trim().toLowerCase()))
    );
    if (match) {
      el.selectedIndex = match.index;
      el.value = match.value;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) nativeSetter.call(el, match.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return el.selectedIndex === match.index || el.value === match.value;
    }
    return false;
  }

  if (field.matchType === "combobox") {
    // 1. If element is a button or custom dropdown trigger (Workday / Radix / Ashby)
    if (el.tagName === "BUTTON" || (el.tagName === "DIV" && el.getAttribute("role") === "combobox")) {
      return jobfillFillCustomDropdown(el, value, field);
    }

    // 2. If element is a searchable input (React Select, Downshift, Workday Searchbox)
    el.focus();
    const proto = HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;

    const tracker = el._valueTracker;
    if (tracker) tracker.setValue("");

    el.dispatchEvent(new Event("focus", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));

    // Check if an options popup list appeared (e.g. Workday searchbox popup, React-select menu)
    setTimeout(() => {
      jobfillSelectOptionFromOpenPopup(value);
    }, 100);

    return true;
  }

  if (field.matchType === "date" || field.matchType === "month") {
    const formatted =
      typeof jobfillFormatDate === "function"
        ? jobfillFormatDate(value, field.matchType)
        : String(value);
    const proto = HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, formatted);
    else el.value = formatted;

    const tracker = el._valueTracker;
    if (tracker) tracker.setValue("");

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === formatted || Boolean(el.value);
  }

  if (field.matchType === "radio" || field.matchType === "checkbox") {
    const valStr = String(value).trim().toLowerCase();
    const fieldVal = String(field.groupValue || el.value || "").trim().toLowerCase();
    const fieldLabel = String(field.rawLabel || field.label || "").trim().toLowerCase();

    const isYes = /^(yes|true|y|1|agree)$/i.test(valStr);
    const isNo = /^(no|false|n|0|disagree)$/i.test(valStr);

    let shouldCheck = false;
    if (isYes) {
      if (
        fieldVal === "yes" ||
        fieldVal === "true" ||
        fieldVal === "1" ||
        /^(yes|agree)$/i.test(fieldLabel) ||
        fieldLabel.startsWith("yes")
      ) {
        shouldCheck = true;
      }
    } else if (isNo) {
      if (
        fieldVal === "no" ||
        fieldVal === "false" ||
        fieldVal === "0" ||
        /^(no|disagree)$/i.test(fieldLabel) ||
        fieldLabel.startsWith("no")
      ) {
        shouldCheck = true;
      }
    } else {
      if (
        valStr === fieldVal ||
        valStr === fieldLabel ||
        fieldLabel.includes(valStr) ||
        valStr.includes(fieldLabel)
      ) {
        shouldCheck = true;
      }
    }

    if (field.matchType === "checkbox" && isYes) {
      shouldCheck = true;
    }

    if (shouldCheck) {
      // If ARIA button/div
      if (el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "radio") {
        el.setAttribute("aria-checked", "true");
        el.click();
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      if (!el.checked) el.click();
      el.checked = true;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked"
      )?.set;
      if (nativeSetter) nativeSetter.call(el, true);

      const tracker = el._valueTracker;
      if (tracker) tracker.setValue("");

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("click", { bubbles: true }));

      // If styled checkbox wrapped in label (Workday / Tailwind)
      const parentLabel = el.closest("label");
      if (parentLabel && !el.checked) {
        parentLabel.click();
      }

      return el.checked === true || Boolean(el.getAttribute("aria-checked") === "true");
    }
    return false;
  }

  if (el.hasAttribute("contenteditable") || el.getAttribute("role") === "textbox") {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return (el.textContent || "").trim() === String(value).trim();
  }

  // React / Vue / Angular controlled input prototype setter bypass
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  // React 15/16/17/18 Value Tracker Reset (Crucial for React ATS forms!)
  const tracker = el._valueTracker;
  if (tracker) {
    tracker.setValue("");
  }

  el.dispatchEvent(new Event("focus", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));

  // Verify that the element accepted the new value
  return el.value === String(value);
}

function jobfillFillFile(field, fileData) {
  const el = jobfillFindElement(field.id);
  if (!el || !fileData || !fileData.data) return false;

  try {
    const dataUriParts = fileData.data.split(",");
    const byteString = atob(dataUriParts[1]);
    const mimeString =
      dataUriParts[0].split(":")[1]?.split(";")[0] ||
      fileData.mimeType ||
      "application/octet-stream";
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const defaultName = mimeString.includes("image") ? "profile_photo.jpg" : "Resume.pdf";
    const file = new File([blob], fileData.filename || defaultName, { type: mimeString });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    el.files = dataTransfer.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    return el.files && el.files.length > 0;
  } catch (err) {
    console.error("JobFill file upload error:", err);
    return false;
  }
}

function jobfillMarkFilled(field, source) {
  const el = jobfillFindElement(field.id);
  if (!el) return;
  el.setAttribute("data-jobfill-filled", source);
  const color = source === "rule" ? "#10b981" : "#3b82f6";
  el.style.setProperty("outline", `1.5px solid ${color}`, "important");
  el.style.setProperty("outline-offset", "1px", "important");
  el.title = source === "rule" ? "Filled by JobFill (Profile Match)" : "Filled by JobFill (AI)";
  window._jobfillHighlightedElements.push(el);

  if (!el.getAttribute("data-jobfill-popover-bound")) {
    el.setAttribute("data-jobfill-popover-bound", "true");
    el.addEventListener("focus", () => {
      if (_jobfillActiveBar && typeof _jobfillActiveBar.handleFieldFocus === "function") {
        _jobfillActiveBar.handleFieldFocus(el, field, source, null);
      }
    });
  }
}

function jobfillMarkManual(field, reason) {
  const el = jobfillFindElement(field.id);
  if (!el) return;
  el.setAttribute("data-jobfill-manual", "true");
  el.style.setProperty("outline", "1.5px solid #f59e0b", "important");
  el.style.setProperty("outline-offset", "1px", "important");
  el.title = `JobFill review: ${reason}`;
  window._jobfillManualFields.push({ el, field, reason });
  window._jobfillHighlightedElements.push(el);

  if (!el.getAttribute("data-jobfill-popover-bound")) {
    el.setAttribute("data-jobfill-popover-bound", "true");
    el.addEventListener("focus", () => {
      if (_jobfillActiveBar && typeof _jobfillActiveBar.handleFieldFocus === "function") {
        _jobfillActiveBar.handleFieldFocus(el, field, "manual", reason);
      }
    });
  }
}

// ---------- User Input Observation & Sensitive Filter ----------

function jobfillAttachEditListeners(fields) {
  for (const field of fields) {
    const el = jobfillFindElement(field.id);
    if (!el || el.getAttribute("data-jobfill-observed")) continue;
    el.setAttribute("data-jobfill-observed", "true");

    const onEdit = () => {
      el.setAttribute("data-jobfill-user-edited", "true");
    };
    el.addEventListener("input", onEdit, { passive: true });
    el.addEventListener("change", onEdit, { passive: true });
  }
}

function jobfillIsSensitiveField(labelOrName) {
  const text = String(labelOrName || "").toLowerCase();
  const sensitivePatterns = [
    /pass(word|code)?/i,
    /ssn|social\s*security/i,
    /pin\b/i,
    /cvv|cvc|security\s*code/i,
    /credit\s*card|debit\s*card|card\s*number/i,
    /bank\s*account|routing\s*number|iban/i,
    /driver'?s?\s*license|passport/i,
    /secret/i,
  ];
  return sensitivePatterns.some((pattern) => pattern.test(text));
}

// ---------- Floating Badge Toolbar (Shadow DOM) ----------

function jobfillCreateBadge() {
  if (_jobfillActiveBar && _jobfillActiveBar.remove) {
    _jobfillActiveBar.remove();
  }

  const host = document.createElement("div");
  host.setAttribute("data-jobfill-toolbar", "true");
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none"; // host itself doesn't block clicks; children enable pointer-events
  document.documentElement.appendChild(host);

  // Restore saved dock position if available in sessionStorage
  let savedPos = null;
  try {
    const raw = sessionStorage.getItem("jobfill_dock_pos");
    if (raw) savedPos = JSON.parse(raw);
  } catch (_) {}

  const shadow = host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    link.href = chrome.runtime.getURL("content.css");
  }
  shadow.appendChild(link);

  const root = document.createElement("div");
  root.innerHTML = `
    <!-- Main Dock Container -->
    <div class="dock-wrapper" id="dockWrapper">
      <div class="dock" id="dock">
        <div class="shimmer-line" id="shimmerLine"></div>

        <!-- Header: Drag Handle + Brand + Controls -->
        <div class="dock-header" id="dockHeader">
          <div class="brand-wrap">
            <div class="drag-grip" id="dragGrip" title="Drag to reposition">
              <svg width="8" height="14" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
              </svg>
            </div>
            <div class="brand">
              <div class="brand-icon">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <span>JobFill</span>
            </div>
          </div>
          <div class="controls-group">
            <button class="icon-btn" id="minimizeBtn" title="Minimize toolbar">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="icon-btn" id="closeBtn" title="Dismiss">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- Status Area -->
        <div class="status-area">
          <div class="status-icon-wrap" id="statusIconWrap">
            <span class="spinner" id="spinner"></span>
          </div>
          <span class="status-msg" id="statusMsg">Scanning fields…</span>
        </div>

        <!-- Summary Pills (3-column compact badges) -->
        <div class="pill-group hidden" id="pillGroup">
          <span class="stat-pill pill-rule" id="rulePill" title="Matched directly from profile">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            <span id="rulePillText">0 rule</span>
          </span>
          <span class="stat-pill pill-ai" id="aiPill" title="Generated by Gemini AI">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
            <span id="aiPillText">0 ai</span>
          </span>
          <span class="stat-pill pill-manual" id="manualPill" title="Click to start review walkthrough">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span id="manualPillText">0 rev</span>
          </span>
        </div>

        <!-- Vertical Action Buttons -->
        <div class="actions-group">
          <button class="btn btn-review hidden" id="nextReviewBtn" title="Navigate directly to fields requiring manual check">
            <span>Review next</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button class="btn btn-accent hidden" id="nextStepBtn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>Fill next step</span>
          </button>
          <button class="btn hidden" id="undoBtn" title="Restore pre-fill form values">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            <span>Undo fill</span>
          </button>
          <button class="btn hidden" id="saveAnswersBtn" title="Save answers you typed to memory for future applications">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-5.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-5.04Z"/></svg>
            <span>Save answers</span>
          </button>
          <button class="btn hidden" id="logAppBtn" title="Log application to built-in Job Tracker">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
            <span>Log application</span>
          </button>
        </div>
      </div>

      <!-- Minimized Floating Pill -->
      <div class="minimized-pill hidden" id="minimizedPill" title="Click to expand JobFill controls">
        <div class="brand-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <span id="pillSummaryText">JobFill Active</span>
        <button class="icon-btn" id="expandBtn" title="Expand panel" style="width: 16px; height: 16px;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
      </div>

      <!-- Floating Attachment Card Prompt -->
      <div class="attachment-card hidden" id="attachmentCard">
        <div class="attach-head">
          <div class="attach-icon" id="attachIcon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="attach-meta">
            <div class="attach-title" id="attachTitle">Attach Tailored Resume?</div>
            <div class="attach-sub" id="attachSub">Senior Frontend Developer (resume.pdf)</div>
          </div>
        </div>
        <div class="attach-actions">
          <button class="btn" id="attachSkipBtn" style="width: auto;">Skip</button>
          <button class="btn btn-accent" id="attachConfirmBtn" style="width: auto;">Attach File</button>
        </div>
      </div>

      <!-- Multi-step Stepper Banner -->
      <div class="stepper-banner hidden" id="stepperBanner">
        <div class="attach-icon" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.3); color: #34d399;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <div class="attach-meta">
          <div class="attach-title" id="stepperTitle">Step 2 Detected</div>
          <div class="attach-sub" id="stepperSub">5 new fields found ready to autofill</div>
        </div>
        <button class="btn btn-accent" id="stepperFillBtn" style="width: auto; padding: 4px 10px;">Fill Step</button>
        <button class="icon-btn" id="stepperCloseBtn" style="margin-left: 2px;">×</button>
      </div>
    </div>

    <!-- In-Field Floating Callout Popover -->
    <div class="field-popover hidden" id="fieldPopover">
      <div class="popover-caret"></div>
      <div class="popover-header">
        <div class="popover-badge" id="popoverBadge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span id="popoverStepText">Review 1 of 3</span>
        </div>
        <button class="icon-btn" id="popoverCloseBtn" title="Close review popover">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="popover-title" id="popoverTitle">Field Label</div>
      <div class="popover-desc" id="popoverDesc">Reason field needs your attention.</div>
      <div class="popover-actions">
        <div class="popover-nav">
          <button class="btn" id="popoverPrevBtn" title="Previous review item">← Prev</button>
          <button class="btn" id="popoverNextBtn" title="Next review item">Next →</button>
        </div>
        <button class="btn btn-review" id="popoverDoneBtn">Mark as Done ✓</button>
      </div>
    </div>

    <!-- Save Answers to Memory Modal -->
    <div class="modal-backdrop hidden" id="confirmModal">
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-head-title">
            <span style="font-size: 16px;">🧠</span>
            <span>Save Answers to Memory</span>
          </div>
          <button class="icon-btn" id="closeModalBtn" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-subhead">
          <span id="modalSubheadText">JobFill learned these answers from your input. Save them to auto-fill future applications.</span>
          <button class="btn" id="modalToggleAllBtn" style="padding: 2px 8px; font-size: 10.5px;">Deselect All</button>
        </div>
        <div class="modal-body" id="modalList"></div>
        <div class="modal-foot">
          <button class="btn" id="modalCancelBtn">Cancel</button>
          <button class="btn btn-accent" id="modalSaveBtn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span id="modalSaveBtnText">Confirm &amp; Save</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Transient Toast Notification -->
    <div class="toast hidden" id="toast">
      <span id="toastIcon">✓</span>
      <span id="toastMsg">Operation successful</span>
    </div>
  `;

  shadow.appendChild(root);

  // Element handles
  const dockWrapper = shadow.getElementById("dockWrapper");
  const dock = shadow.getElementById("dock");
  const dragGrip = shadow.getElementById("dragGrip");
  const shimmerLine = shadow.getElementById("shimmerLine");
  const statusIconWrap = shadow.getElementById("statusIconWrap");
  const statusMsg = shadow.getElementById("statusMsg");
  const pillGroup = shadow.getElementById("pillGroup");
  const rulePill = shadow.getElementById("rulePill");
  const rulePillText = shadow.getElementById("rulePillText");
  const aiPill = shadow.getElementById("aiPill");
  const aiPillText = shadow.getElementById("aiPillText");
  const manualPill = shadow.getElementById("manualPill");
  const manualPillText = shadow.getElementById("manualPillText");
  const nextReviewBtn = shadow.getElementById("nextReviewBtn");
  const undoBtn = shadow.getElementById("undoBtn");
  const saveAnswersBtn = shadow.getElementById("saveAnswersBtn");
  const nextStepBtn = shadow.getElementById("nextStepBtn");
  const logAppBtn = shadow.getElementById("logAppBtn");
  const minimizeBtn = shadow.getElementById("minimizeBtn");
  const closeBtn = shadow.getElementById("closeBtn");

  const minimizedPill = shadow.getElementById("minimizedPill");
  const pillSummaryText = shadow.getElementById("pillSummaryText");
  const expandBtn = shadow.getElementById("expandBtn");

  const fieldPopover = shadow.getElementById("fieldPopover");
  const popoverStepText = shadow.getElementById("popoverStepText");
  const popoverCloseBtn = shadow.getElementById("popoverCloseBtn");
  const popoverTitle = shadow.getElementById("popoverTitle");
  const popoverDesc = shadow.getElementById("popoverDesc");
  const popoverPrevBtn = shadow.getElementById("popoverPrevBtn");
  const popoverNextBtn = shadow.getElementById("popoverNextBtn");
  const popoverDoneBtn = shadow.getElementById("popoverDoneBtn");

  const attachmentCard = shadow.getElementById("attachmentCard");
  const attachIcon = shadow.getElementById("attachIcon");
  const attachTitle = shadow.getElementById("attachTitle");
  const attachSub = shadow.getElementById("attachSub");
  const attachSkipBtn = shadow.getElementById("attachSkipBtn");
  const attachConfirmBtn = shadow.getElementById("attachConfirmBtn");

  const stepperBanner = shadow.getElementById("stepperBanner");
  const stepperTitle = shadow.getElementById("stepperTitle");
  const stepperSub = shadow.getElementById("stepperSub");
  const stepperFillBtn = shadow.getElementById("stepperFillBtn");
  const stepperCloseBtn = shadow.getElementById("stepperCloseBtn");

  const confirmModal = shadow.getElementById("confirmModal");
  const modalSubheadText = shadow.getElementById("modalSubheadText");
  const modalToggleAllBtn = shadow.getElementById("modalToggleAllBtn");
  const modalList = shadow.getElementById("modalList");
  const closeModalBtn = shadow.getElementById("closeModalBtn");
  const modalCancelBtn = shadow.getElementById("modalCancelBtn");
  const modalSaveBtn = shadow.getElementById("modalSaveBtn");
  const modalSaveBtnText = shadow.getElementById("modalSaveBtnText");

  const toast = shadow.getElementById("toast");
  const toastIcon = shadow.getElementById("toastIcon");
  const toastMsg = shadow.getElementById("toastMsg");

  let reviewIndex = 0;
  let activeFields = [];
  let pendingEntries = {};
  let currentActiveFieldItem = null;
  let toastTimer = null;
  let isMinimized = false;

  // Restore dock coordinates if stored
  if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 50;
    const clampedX = Math.max(10, Math.min(maxX, savedPos.left));
    const clampedY = Math.max(10, Math.min(maxY, savedPos.top));
    dockWrapper.style.left = `${clampedX}px`;
    dockWrapper.style.top = `${clampedY}px`;
    dockWrapper.style.bottom = "auto";
    dockWrapper.style.right = "auto";
  }

  // Toast notification helper
  function showToast(message, icon = "✓", duration = 2800) {
    clearTimeout(toastTimer);
    toastIcon.textContent = icon;
    toastMsg.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, duration);
  }

  // Reposition floating in-field popover
  function positionPopover(popoverEl, targetEl) {
    if (!popoverEl || !targetEl || !popoverEl.isConnected) return;
    const rect = targetEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const margin = 10;

    let top = rect.top - popoverRect.height - margin;
    let placement = "top";

    if (top < 10) {
      top = rect.bottom + margin;
      placement = "bottom";
    }

    let left = rect.left + rect.width / 2 - popoverRect.width / 2;
    const maxLeft = window.innerWidth - popoverRect.width - 16;
    left = Math.max(16, Math.min(maxLeft, left));

    popoverEl.style.top = `${Math.round(top)}px`;
    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.className = `field-popover placement-${placement}`;

    const caret = popoverEl.querySelector(".popover-caret");
    if (caret) {
      const caretLeft = Math.max(
        16,
        Math.min(popoverRect.width - 24, rect.left + rect.width / 2 - left - 5)
      );
      caret.style.left = `${Math.round(caretLeft)}px`;
    }
  }

  // Highlight pulse animation on field
  function pulseTargetElement(el) {
    if (!el) return;
    el.style.setProperty("outline", "2.5px solid #f59e0b", "important");
    el.style.setProperty("box-shadow", "0 0 0 6px rgba(245, 158, 11, 0.35)", "important");
    setTimeout(() => {
      if (el.hasAttribute("data-jobfill-manual")) {
        el.style.setProperty("outline", "1.5px solid #f59e0b", "important");
        el.style.removeProperty("box-shadow");
      }
    }, 1200);
  }

  function hideFieldPopover() {
    fieldPopover.classList.add("hidden");
    currentActiveFieldItem = null;
  }

  function showFieldPopover(item, stepNum, totalSteps) {
    if (!item || !item.el) return;
    currentActiveFieldItem = item;

    popoverStepText.textContent = `Review ${stepNum} of ${totalSteps}`;
    popoverTitle.textContent = item.field.label || item.field.name || "Application Field";
    popoverDesc.textContent = item.reason || "Please verify or complete this field manually.";

    popoverPrevBtn.disabled = totalSteps <= 1;
    popoverNextBtn.disabled = totalSteps <= 1;

    fieldPopover.classList.remove("hidden");
    positionPopover(fieldPopover, item.el);
  }

  // Window scroll/resize observer to keep in-field popover anchored
  const onViewportUpdate = () => {
    if (currentActiveFieldItem && currentActiveFieldItem.el && !fieldPopover.classList.contains("hidden")) {
      positionPopover(fieldPopover, currentActiveFieldItem.el);
    }
  };
  window.addEventListener("scroll", onViewportUpdate, { passive: true });
  window.addEventListener("resize", onViewportUpdate, { passive: true });

  // Interactive review walkthrough
  function startReviewWalkthrough(targetIndex = null) {
    const list = window._jobfillManualFields || [];
    if (list.length === 0) {
      statusMsg.textContent = "All manual review fields completed!";
      nextReviewBtn.classList.add("hidden");
      manualPill.classList.remove("has-items");
      hideFieldPopover();
      showToast("All manual review fields checked! 🎉");
      return;
    }

    if (targetIndex !== null) {
      reviewIndex = ((targetIndex % list.length) + list.length) % list.length;
    } else {
      reviewIndex = reviewIndex % list.length;
    }

    const currentItem = list[reviewIndex];
    if (!currentItem || !currentItem.el) return;

    currentItem.el.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      currentItem.el.focus();
    } catch (_) {}

    pulseTargetElement(currentItem.el);
    showFieldPopover(currentItem, reviewIndex + 1, list.length);

    statusMsg.textContent = `Review (${reviewIndex + 1}/${list.length}): ${jobfillTruncate(
      currentItem.field.label || currentItem.reason,
      35
    )}`;
    nextReviewBtn.querySelector("span").textContent = `Review next (${reviewIndex + 1}/${list.length})`;
  }

  // Next / Prev review button handlers
  nextReviewBtn.addEventListener("click", () => {
    const list = window._jobfillManualFields || [];
    if (list.length === 0) {
      startReviewWalkthrough();
      return;
    }
    reviewIndex = (reviewIndex + 1) % list.length;
    startReviewWalkthrough(reviewIndex);
  });

  manualPill.addEventListener("click", () => {
    startReviewWalkthrough(reviewIndex);
  });

  popoverNextBtn.addEventListener("click", () => {
    const list = window._jobfillManualFields || [];
    if (list.length > 0) {
      reviewIndex = (reviewIndex + 1) % list.length;
      startReviewWalkthrough(reviewIndex);
    }
  });

  popoverPrevBtn.addEventListener("click", () => {
    const list = window._jobfillManualFields || [];
    if (list.length > 0) {
      reviewIndex = (reviewIndex - 1 + list.length) % list.length;
      startReviewWalkthrough(reviewIndex);
    }
  });

  popoverCloseBtn.addEventListener("click", hideFieldPopover);

  // Mark as Done in popover
  popoverDoneBtn.addEventListener("click", () => {
    if (!currentActiveFieldItem) return;
    const { el } = currentActiveFieldItem;
    if (el) {
      el.removeAttribute("data-jobfill-manual");
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
      el.style.removeProperty("box-shadow");
    }

    // Remove from manual review list
    const list = window._jobfillManualFields || [];
    const idx = list.indexOf(currentActiveFieldItem);
    if (idx !== -1) {
      list.splice(idx, 1);
    }

    manualPillText.textContent = `${list.length} review`;
    if (list.length === 0) {
      manualPill.classList.remove("has-items");
      nextReviewBtn.classList.add("hidden");
      hideFieldPopover();
      showToast("All manual review fields checked! Ready to submit 🎉");
      statusMsg.textContent = "All manual review fields verified ✓";
      updateMinimizedPill();
    } else {
      showToast("Field marked as done ✓", "✓", 1800);
      reviewIndex = reviewIndex % list.length;
      startReviewWalkthrough(reviewIndex);
    }
  });

  // Draggable logic for Floating Dock & Pill
  function setupDraggable(triggerEl) {
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let dragging = false;

    triggerEl.addEventListener("mousedown", (e) => {
      // Ignore clicks on buttons/inputs
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("a")) return;
      e.preventDefault();

      const rect = dockWrapper.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      dragging = true;

      dock.classList.add("is-dragging");

      function onMouseMove(moveEvent) {
        if (!dragging) return;
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newX = initialLeft + deltaX;
        let newY = initialTop + deltaY;

        const maxW = window.innerWidth - dockWrapper.offsetWidth - 10;
        const maxH = window.innerHeight - dockWrapper.offsetHeight - 10;
        newX = Math.max(10, Math.min(maxW, newX));
        newY = Math.max(10, Math.min(maxH, newY));

        dockWrapper.style.left = `${newX}px`;
        dockWrapper.style.top = `${newY}px`;
        dockWrapper.style.bottom = "auto";
        dockWrapper.style.right = "auto";
      }

      function onMouseUp() {
        if (!dragging) return;
        dragging = false;
        dock.classList.remove("is-dragging");
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        // Store preferred dock coordinates in sessionStorage
        try {
          const rect = dockWrapper.getBoundingClientRect();
          sessionStorage.setItem(
            "jobfill_dock_pos",
            JSON.stringify({ left: rect.left, top: rect.top })
          );
        } catch (_) {}
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  }

  const dockHeader = shadow.getElementById("dockHeader");
  if (dockHeader) setupDraggable(dockHeader);
  setupDraggable(dragGrip);
  setupDraggable(minimizedPill);

  // Minimize / Expand logic
  function updateMinimizedPill() {
    const ruleCount = rulePillText.textContent.split(" ")[0] || "0";
    const manualCount = manualPillText.textContent.split(" ")[0] || "0";
    pillSummaryText.textContent = Number(manualCount) > 0
      ? `JobFill • ${ruleCount}✓ • ${manualCount}⚠`
      : `JobFill • ${ruleCount} filled ✓`;
  }

  minimizeBtn.addEventListener("click", () => {
    isMinimized = true;
    updateMinimizedPill();
    dock.classList.add("hidden");
    minimizedPill.classList.remove("hidden");
    hideFieldPopover();
  });

  function expandDock() {
    isMinimized = false;
    minimizedPill.classList.add("hidden");
    dock.classList.remove("hidden");
  }

  expandBtn.addEventListener("click", expandDock);
  minimizedPill.addEventListener("click", (e) => {
    if (!e.target.closest("button")) expandDock();
  });

  closeBtn.addEventListener("click", () => {
    hideFieldPopover();
    host.remove();
  });

  // Undo Fill button handler
  undoBtn.addEventListener("click", () => {
    hideFieldPopover();
    const restored = jobfillUndoFill();
    statusMsg.textContent = `Restored ${restored} field(s) to original values.`;
    undoBtn.classList.add("hidden");
    nextReviewBtn.classList.add("hidden");
    pillGroup.classList.add("hidden");
    shimmerLine.classList.add("done");
    showToast(`Restored ${restored} field(s) to pre-fill state`, "↩");
  });

  // Save Answers confirmation modal
  saveAnswersBtn.addEventListener("click", () => {
    pendingEntries = jobfillCollectUserInputs(activeFields);
    const keys = Object.keys(pendingEntries);
    if (keys.length === 0) {
      showToast("No new manual edits found to save.", "ℹ");
      statusMsg.textContent = "No new manual edits found to save.";
      return;
    }

    modalSubheadText.textContent = `JobFill detected ${keys.length} answer(s) you entered. Select the ones you want saved:`;
    modalSaveBtnText.textContent = `Confirm & Save (${keys.length})`;

    modalList.innerHTML = keys
      .map(
        (q, idx) => `
        <div class="entry-card">
          <input type="checkbox" id="check_${idx}" data-q="${encodeURIComponent(q)}" checked />
          <div class="entry-info">
            <div class="entry-q">${escapeHtml(q)}</div>
            <div class="entry-a">${escapeHtml(pendingEntries[q].answer)}</div>
          </div>
        </div>
      `
      )
      .join("");

    confirmModal.classList.remove("hidden");

    // Dynamic counter update when checking/unchecking
    const updateModalSaveCount = () => {
      const selected = modalList.querySelectorAll("input[type='checkbox']:checked").length;
      modalSaveBtnText.textContent = `Confirm & Save (${selected})`;
      modalSaveBtn.disabled = selected === 0;
    };
    modalList.querySelectorAll("input[type='checkbox']").forEach((chk) => {
      chk.addEventListener("change", updateModalSaveCount);
    });
  });

  // Modal Select All / Deselect All
  modalToggleAllBtn.addEventListener("click", () => {
    const checkboxes = modalList.querySelectorAll("input[type='checkbox']");
    const anyUnchecked = Array.from(checkboxes).some((chk) => !chk.checked);
    checkboxes.forEach((chk) => {
      chk.checked = anyUnchecked;
    });
    modalToggleAllBtn.textContent = anyUnchecked ? "Deselect All" : "Select All";
    const selected = modalList.querySelectorAll("input[type='checkbox']:checked").length;
    modalSaveBtnText.textContent = `Confirm & Save (${selected})`;
    modalSaveBtn.disabled = selected === 0;
  });

  closeModalBtn.addEventListener("click", () => confirmModal.classList.add("hidden"));
  modalCancelBtn.addEventListener("click", () => confirmModal.classList.add("hidden"));

  modalSaveBtn.addEventListener("click", async () => {
    const approved = {};
    modalList.querySelectorAll("input[type='checkbox']:checked").forEach((chk) => {
      const q = decodeURIComponent(chk.getAttribute("data-q"));
      if (pendingEntries[q]) {
        approved[q] = pendingEntries[q];
      }
    });

    confirmModal.classList.add("hidden");
    const count = Object.keys(approved).length;
    if (count > 0) {
      await jobfillSaveToMemory(approved);
      showToast(`Saved ${count} answer(s) to memory! 🧠`);
      statusMsg.textContent = `Saved ${count} answer(s) to memory!`;
    }
  });

  // Log to Application Tracker
  logAppBtn.addEventListener("click", async () => {
    logAppBtn.disabled = true;
    logAppBtn.querySelector("span").textContent = "Logging…";
    const appInfo = jobfillExtractAppInfo();
    try {
      await chrome.runtime.sendMessage({
        action: "logApplication",
        application: appInfo,
      });
      logAppBtn.querySelector("span").textContent = "Logged ✓";
      showToast("Application logged to Job Tracker ✓", "✓");
    } catch (_) {
      logAppBtn.querySelector("span").textContent = "Log failed";
      showToast("Failed to log application", "⚠");
    }
    setTimeout(() => {
      logAppBtn.disabled = false;
      logAppBtn.querySelector("span").textContent = "Log app";
    }, 2500);
  });

  // Stepper Banner dismiss
  stepperCloseBtn.addEventListener("click", () => {
    stepperBanner.classList.add("hidden");
  });

  // Keyboard shortcut listener inside window for modal / popover escape
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (!confirmModal.classList.contains("hidden")) {
        confirmModal.classList.add("hidden");
      } else if (!fieldPopover.classList.contains("hidden")) {
        hideFieldPopover();
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);

  const controller = {
    setStatus(text, type = "info") {
      statusMsg.textContent = text;
      if (type === "done" || type === "error" || type === "warn") {
        statusIconWrap.innerHTML =
          type === "done"
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        shimmerLine.classList.add("done");
      } else {
        statusIconWrap.innerHTML = '<span class="spinner"></span>';
        shimmerLine.classList.remove("done");
      }
    },

    showSummary(counts, fields) {
      activeFields = fields;
      shimmerLine.classList.add("done");
      pillGroup.classList.remove("hidden");

      rulePillText.textContent = `${counts.rule} rule`;
      aiPillText.textContent = `${counts.ai} ai`;
      manualPillText.textContent = `${counts.manual} rev`;

      statusIconWrap.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      statusMsg.textContent =
        counts.manual > 0
          ? `${counts.manual} field(s) need review`
          : "Form filled ready ✓";

      if (counts.manual > 0) {
        nextReviewBtn.classList.remove("hidden");
        nextReviewBtn.querySelector("span").textContent = `Review next (1/${counts.manual})`;
        manualPill.classList.add("has-items");
      }
      if (window._jobfillSnapshot.size > 0) {
        undoBtn.classList.remove("hidden");
      }
      saveAnswersBtn.classList.remove("hidden");
      logAppBtn.classList.remove("hidden");

      updateMinimizedPill();

      if (counts.manual > 0) {
        showToast(`${counts.manual} field(s) require manual review`, "⚠", 3200);
      } else {
        showToast("Application form filled ✓", "✓", 2500);
      }
    },

    promptPhotoAttach(field, photo) {
      attachTitle.textContent = "Attach Profile Photo?";
      attachSub.textContent = photo.filename || "Candidate Profile Photo";
      attachIcon.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
      attachConfirmBtn.textContent = "Attach Photo";

      attachmentCard.classList.remove("hidden");

      attachConfirmBtn.onclick = () => {
        const ok = jobfillFillFile(field, photo);
        if (ok) {
          jobfillMarkFilled(field, "rule");
          statusMsg.textContent = "Attached profile photo ✓";
          showToast("Profile photo attached ✓");
        } else {
          jobfillMarkManual(field, "Browser security blocked automatic photo upload.");
          statusMsg.textContent = "Browser blocked upload — please attach photo manually.";
          showToast("Browser security blocked upload — please attach manually", "⚠");
        }
        attachmentCard.classList.add("hidden");
      };

      attachSkipBtn.onclick = () => {
        attachmentCard.classList.add("hidden");
        showToast("Photo upload skipped", "ℹ");
      };
    },

    promptResumeAttach(field, resume) {
      attachTitle.textContent = `Attach "${resume.role}" Resume?`;
      attachSub.textContent = resume.filename || "Resume.pdf";
      attachIcon.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      attachConfirmBtn.textContent = "Attach Resume";

      attachmentCard.classList.remove("hidden");

      attachConfirmBtn.onclick = () => {
        const ok = jobfillFillFile(field, resume);
        if (ok) {
          jobfillMarkFilled(field, "ai");
          statusMsg.textContent = `Attached ${resume.role} resume ✓`;
          showToast(`Attached ${resume.role} resume ✓`);
        } else {
          jobfillMarkManual(field, "Browser security blocked automatic file upload.");
          statusMsg.textContent = "Browser blocked upload — please attach resume manually.";
          showToast("Browser security blocked upload — please attach manually", "⚠");
        }
        attachmentCard.classList.add("hidden");
      };

      attachSkipBtn.onclick = () => {
        attachmentCard.classList.add("hidden");
        showToast("Resume upload skipped", "ℹ");
      };
    },

    showNextStepPrompt(fieldCount, onFill) {
      if (!host.isConnected) return;
      stepperTitle.textContent = "Next Form Step Detected";
      stepperSub.textContent = `${fieldCount} new fields detected on this page.`;
      stepperFillBtn.textContent = `Fill Step (${fieldCount}) ⚡`;

      stepperBanner.classList.remove("hidden");
      showToast(`Next step detected (${fieldCount} new fields)`, "⚡", 3500);

      stepperFillBtn.onclick = () => {
        stepperBanner.classList.add("hidden");
        onFill();
      };
    },

    handleFieldFocus(el, field, source, reason) {
      if (source === "manual") {
        const list = window._jobfillManualFields || [];
        const idx = list.findIndex((item) => item.el === el || item.field.id === field.id);
        if (idx !== -1) {
          reviewIndex = idx;
          showFieldPopover(list[idx], idx + 1, list.length);
        }
      }
    },

    remove() {
      window.removeEventListener("scroll", onViewportUpdate);
      window.removeEventListener("resize", onViewportUpdate);
      window.removeEventListener("keydown", onKeyDown);
      host.remove();
    },
  };

  _jobfillActiveBar = controller;
  return controller;
}

// ---------- Multi-Step Form (Stepper / Wizard) Observer ----------

function jobfillSetupMultiStepObserver(badge) {
  if (window._jobfillObserverActive) return;
  window._jobfillObserverActive = true;

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (window._jobfillRunning) return;

      const currentFields = jobfillScanFields();
      if (currentFields.length === 0) return;

      const unfilled = currentFields.filter((f) => {
        const el = jobfillFindElement(f.id);
        if (!el) return false;
        if (el.getAttribute("data-jobfill-filled")) return false;
        if (f.matchType === "radio" || f.matchType === "checkbox") {
          return !el.checked && el.getAttribute("aria-checked") !== "true";
        }
        return !el.value || String(el.value).trim() === "";
      });

      // If 2 or more new un-filled fields are detected, prompt user to fill the new step
      if (unfilled.length >= 2 && badge && typeof badge.showNextStepPrompt === "function") {
        badge.showNextStepPrompt(unfilled.length, () => {
          if (typeof window.jobfillRun === "function") {
            window.jobfillRun();
          }
        });
      }
    }, 700);
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("popstate", () => {
    setTimeout(() => {
      if (typeof window.jobfillRun === "function") window.jobfillRun();
    }, 800);
  });
  window.addEventListener("hashchange", () => {
    setTimeout(() => {
      if (typeof window.jobfillRun === "function") window.jobfillRun();
    }, 800);
  });
}

// ---------- Restore / Undo Fill ----------

function jobfillUndoFill() {
  if (!window._jobfillSnapshot || window._jobfillSnapshot.size === 0) return 0;
  let count = 0;

  for (const [id, state] of window._jobfillSnapshot.entries()) {
    const el = jobfillFindElement(id);
    if (!el) continue;

    if (state.type === "select") {
      el.value = state.value;
      el.selectedIndex = state.selectedIndex;
    } else if (state.type === "check") {
      el.checked = state.checked;
    } else if (state.type === "contenteditable") {
      el.textContent = state.text;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, state.value);
      else el.value = state.value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.removeProperty("outline");
    el.removeAttribute("data-jobfill-filled");
    el.removeAttribute("data-jobfill-manual");
    count++;
  }

  window._jobfillSnapshot.clear();
  return count;
}

// ---------- Memory Collection & Filtering ----------

function jobfillCollectUserInputs(fields) {
  const entries = {};
  for (const field of fields) {
    const el = jobfillFindElement(field.id);
    if (!el) continue;
    if (field.matchType === "file") continue;

    // Only collect fields the user actively touched/edited
    const userEdited = el.getAttribute("data-jobfill-user-edited") === "true";
    let val = "";
    if (field.matchType === "select") {
      const opt = el.options[el.selectedIndex];
      val = opt ? opt.textContent.trim() : "";
    } else if (field.matchType === "radio" || field.matchType === "checkbox") {
      val = el.checked ? "yes" : "";
    } else if (el.hasAttribute("contenteditable")) {
      val = el.textContent.trim();
    } else {
      val = el.value.trim();
    }

    if (!val) continue;

    const labelText = field.label || field.placeholder || field.name || "";
    // Exclude passwords and sensitive security questions
    if (jobfillIsSensitiveField(labelText)) continue;

    if (userEdited || val.length > 3) {
      const question = jobfillNormalizeQuestion(labelText);
      if (question) {
        entries[question] = {
          answer: val,
          fieldType: field.matchType,
          lastUsed: new Date().toISOString(),
          timesUsed: 1,
          source: "user_input",
        };
      }
    }
  }
  return entries;
}

function jobfillNormalizeQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[*:?!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function jobfillSaveToMemory(newEntries) {
  const key = JOBFILL_DEFAULTS.STORAGE_KEYS.USER_MEMORY;
  const { [key]: existingMemory } = await chrome.storage.local.get(key);
  const memory = existingMemory || {};

  for (const [q, data] of Object.entries(newEntries)) {
    if (memory[q]) {
      memory[q].answer = data.answer;
      memory[q].lastUsed = data.lastUsed;
      memory[q].timesUsed = (memory[q].timesUsed || 0) + 1;
    } else {
      memory[q] = data;
    }
  }

  const entries = Object.entries(memory);
  if (entries.length > JOBFILL_DEFAULTS.MAX_MEMORY_ENTRIES) {
    entries.sort((a, b) => new Date(b[1].lastUsed) - new Date(a[1].lastUsed));
    const trimmed = Object.fromEntries(entries.slice(0, JOBFILL_DEFAULTS.MAX_MEMORY_ENTRIES));
    await chrome.storage.local.set({ [key]: trimmed });
  } else {
    await chrome.storage.local.set({ [key]: memory });
  }
}

// ---------- Job Context & Application Detection ----------

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

function jobfillExtractAppInfo() {
  let company = "";
  let role = "";

  const title = document.title || "";
  const parts = title.split(/[-–|—]/);
  if (parts.length >= 2) {
    role = parts[0].trim();
    company = parts[1].trim();
  } else {
    role = title.trim();
  }

  // Look for company heading or meta tags
  const ogCompany = document.querySelector("meta[property='og:site_name']")?.content;
  if (ogCompany) company = ogCompany;

  return {
    company: company || "Company from " + location.hostname.replace(/^www\./, ""),
    role: role || "Job Application",
    jobUrl: location.href,
    appliedDate: new Date().toISOString(),
    status: "Applied",
  };
}

function jobfillTruncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Messaging Wrappers ----------

function jobfillRequestFieldMapping(fields, profile) {
  return chrome.runtime.sendMessage({
    action: "mapFields",
    fields: fields.map(({ id, label, placeholder, matchType, options, maxLength }) => ({
      id,
      label,
      placeholder,
      matchType,
      options,
      maxLength,
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
    jobContext,
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

// Support Node.js testing environment if imported
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    jobfillTruncate,
    escapeHtml,
    jobfillNormalizeQuestion,
    jobfillIsSensitiveField,
  };
}
