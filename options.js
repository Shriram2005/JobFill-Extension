// options.js — Enhanced Command Center Logic for JobFill

const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || {
  API_KEY: "jobfill_api_key",
  PROFILE: "jobfill_profile",
  MAPPING_MODEL: "jobfill_mapping_model",
  WRITING_MODEL: "jobfill_writing_model",
  LOG: "jobfill_log",
  RESUMES: "jobfill_resumes",
  USER_MEMORY: "jobfill_user_memory",
};

// DOM References - Navigation & Layout
const navItems = document.querySelectorAll(".nav-item");
const tabPanes = document.querySelectorAll(".tab-pane");
const toast = document.getElementById("toast");

// API Key Elements
const apiKeyInput = document.getElementById("apiKey");
const toggleKeyVisibility = document.getElementById("toggleKeyVisibility");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const testKeyBtn = document.getElementById("testKeyBtn");
const keySpinner = document.getElementById("keySpinner");
const keyStatus = document.getElementById("keyStatus");

// Profile Elements
const viewVisualBtn = document.getElementById("viewVisualBtn");
const viewJsonBtn = document.getElementById("viewJsonBtn");
const visualProfileView = document.getElementById("visualProfileView");
const jsonProfileView = document.getElementById("jsonProfileView");

const profileFile = document.getElementById("profileFile");
const profileText = document.getElementById("profileText");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileStatus = document.getElementById("profileStatus");
const formatJsonBtn = document.getElementById("formatJsonBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const resetDefaultBtn = document.getElementById("resetDefaultBtn");

// Visual Form Fields
const profName = document.getElementById("profName");
const profTitle = document.getElementById("profTitle");
const profEmail = document.getElementById("profEmail");
const profPhone = document.getElementById("profPhone");
const profLocation = document.getElementById("profLocation");
const profStatus = document.getElementById("profStatus");
const profLinkedin = document.getElementById("profLinkedin");
const profGithub = document.getElementById("profGithub");
const profWebsite = document.getElementById("profWebsite");
const profTelegram = document.getElementById("profTelegram");
const profSummary = document.getElementById("profSummary");
const profExpYears = document.getElementById("profExpYears");
const profProjects = document.getElementById("profProjects");
const profTechSkills = document.getElementById("profTechSkills");
const profCoreSkills = document.getElementById("profCoreSkills");
const saveVisualProfileBtn = document.getElementById("saveVisualProfileBtn");
const visualProfileStatus = document.getElementById("visualProfileStatus");

// Resumes Elements
const resumeDropzone = document.getElementById("resumeDropzone");
const resumeFile = document.getElementById("resumeFile");
const resumeRole = document.getElementById("resumeRole");
const addResumeBtn = document.getElementById("addResumeBtn");
const resumeStatus = document.getElementById("resumeStatus");
const resumeList = document.getElementById("resumeList");

// Models Elements
const mappingModelInput = document.getElementById("mappingModel");
const writingModelInput = document.getElementById("writingModel");
const saveModelsBtn = document.getElementById("saveModelsBtn");
const modelStatus = document.getElementById("modelStatus");
const presetPills = document.querySelectorAll(".preset-pill");

// Memory Elements
const viewMemoryBtn = document.getElementById("viewMemoryBtn");
const memoryCount = document.getElementById("memoryCount");

// Overview Elements
const overviewKeyStatus = document.getElementById("overviewKeyStatus");
const overviewProfileStatus = document.getElementById("overviewProfileStatus");
const overviewMemoryStatus = document.getElementById("overviewMemoryStatus");
const overviewEditProfileBtn = document.getElementById("overviewEditProfileBtn");
const overviewTestKeyBtn = document.getElementById("overviewTestKeyBtn");
const overviewOpenMemoryBtn = document.getElementById("overviewOpenMemoryBtn");

let currentProfile = {};
let resumes = [];
let toastTimer = null;

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupEyeToggle();
  setupProfileViewSwitch();
  setupResumeDropzone();
  setupPresetPills();
  await loadExisting();
});

// ---------- Navigation Handling ----------
function setupNavigation() {
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  if (overviewEditProfileBtn) {
    overviewEditProfileBtn.addEventListener("click", () => switchTab("tab-profile"));
  }
  if (overviewTestKeyBtn) {
    overviewTestKeyBtn.addEventListener("click", () => {
      switchTab("tab-api");
      testKeyBtn.click();
    });
  }
  if (overviewOpenMemoryBtn) {
    overviewOpenMemoryBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
    });
  }
}

function switchTab(tabId) {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-tab") === tabId);
  });
  tabPanes.forEach((pane) => {
    pane.classList.toggle("active", pane.id === tabId);
  });
}

// ---------- Show/Hide API Key ----------
function setupEyeToggle() {
  toggleKeyVisibility.addEventListener("click", () => {
    const isPass = apiKeyInput.type === "password";
    apiKeyInput.type = isPass ? "text" : "password";
    toggleKeyVisibility.innerHTML = isPass
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });
}

// ---------- Profile Studio View Switcher ----------
function setupProfileViewSwitch() {
  viewVisualBtn.addEventListener("click", () => {
    viewVisualBtn.classList.add("active");
    viewJsonBtn.classList.remove("active");
    visualProfileView.classList.remove("hidden");
    jsonProfileView.classList.add("hidden");
    // Sync JSON edits back to Visual form
    syncJsonToVisual();
  });

  viewJsonBtn.addEventListener("click", () => {
    viewJsonBtn.classList.add("active");
    viewVisualBtn.classList.remove("active");
    jsonProfileView.classList.remove("hidden");
    visualProfileView.classList.add("hidden");
    // Sync Visual edits to JSON text
    syncVisualToJson();
  });
}

// ---------- Presets for Model Inputs ----------
function setupPresetPills() {
  presetPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const targetInput = document.getElementById(pill.getAttribute("data-target"));
      const val = pill.getAttribute("data-val");
      if (targetInput && val) {
        targetInput.value = val;
        showToast(`Set model to ${val}`);
      }
    });
  });
}

// ---------- Data Loading ----------
async function loadExisting() {
  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.MAPPING_MODEL,
    K.WRITING_MODEL,
    K.RESUMES,
    K.USER_MEMORY,
  ]);

  // 1. API Key
  if (stored[K.API_KEY]) {
    apiKeyInput.value = stored[K.API_KEY];
    overviewKeyStatus.textContent = "Connected";
    overviewKeyStatus.style.color = "var(--status-ok)";
  } else {
    overviewKeyStatus.textContent = "Not Configured";
    overviewKeyStatus.style.color = "var(--status-warn)";
  }

  // 2. Profile
  if (stored[K.PROFILE]) {
    currentProfile = stored[K.PROFILE];
  } else {
    try {
      const res = await fetch(chrome.runtime.getURL("profile.json"));
      currentProfile = await res.json();
    } catch (_) {
      currentProfile = {};
    }
  }

  profileText.value = JSON.stringify(currentProfile, null, 2);
  populateVisualForm(currentProfile);

  const candidateName = currentProfile?.personal_info?.name || "Ready";
  overviewProfileStatus.textContent = candidateName.split(" ")[0] || "Active";

  // 3. Models
  mappingModelInput.value = stored[K.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL;
  writingModelInput.value = stored[K.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL;

  // 4. Resumes
  resumes = stored[K.RESUMES] || [];
  renderResumes(resumes);

  // 5. Continual Memory
  const memory = stored[K.USER_MEMORY] || {};
  const memCount = Object.keys(memory).length;
  updateMemoryDisplays(memCount);
}

function updateMemoryDisplays(count) {
  overviewMemoryStatus.textContent = `${count} answer${count === 1 ? "" : "s"}`;
  memoryCount.textContent = count === 0
    ? "No learned answers yet"
    : `${count} learned answer${count === 1 ? "" : "s"} in memory`;
}

// ---------- API Key Handlers ----------
saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, "Please enter a key first.", "error");
    return;
  }
  await chrome.storage.local.set({ [K.API_KEY]: key });
  setStatus(keyStatus, "Saved locally.", "ok");
  overviewKeyStatus.textContent = "Connected";
  overviewKeyStatus.style.color = "var(--status-ok)";
  showToast("Gemini API key saved securely.");
});

testKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, "Enter a key first.", "error");
    return;
  }

  setStatus(keyStatus, "Testing latency…", "");
  keySpinner.classList.remove("hidden");
  testKeyBtn.disabled = true;

  const startTime = Date.now();
  await chrome.storage.local.set({ [K.API_KEY]: key });

  try {
    const res = await chrome.runtime.sendMessage({ action: "testApiKey" });
    const latency = Date.now() - startTime;
    keySpinner.classList.add("hidden");
    testKeyBtn.disabled = false;

    if (res && res.ok) {
      setStatus(keyStatus, `✓ Connected successfully (${latency}ms)`, "ok");
      overviewKeyStatus.textContent = "Active";
      overviewKeyStatus.style.color = "var(--status-ok)";
      showToast(`Key works! Latency: ${latency}ms`);
    } else {
      setStatus(keyStatus, `Failed: ${res?.error || "Invalid response"}`, "error");
      showToast("API Key test failed. Check key & quota.");
    }
  } catch (err) {
    keySpinner.classList.add("hidden");
    testKeyBtn.disabled = false;
    setStatus(keyStatus, `Error: ${err.message}`, "error");
  }
});

// ---------- Visual Profile Form Logic ----------
function populateVisualForm(profile) {
  const p = profile || {};
  const info = p.personal_info || {};
  const stats = p.stats || {};
  const skills = p.skills || {};

  profName.value = info.name || "";
  profTitle.value = info.title || "";
  profEmail.value = info.email || "";
  profPhone.value = info.phone || "";
  profLocation.value = info.location || "";
  profStatus.value = info.status || "";

  profLinkedin.value = info.linkedin || "";
  profGithub.value = info.github || "";
  profWebsite.value = info.website || "";
  profTelegram.value = info.telegram || "";

  profSummary.value = p.summary || "";
  profExpYears.value = stats.years_experience || "";
  profProjects.value = stats.projects_completed || "";

  profTechSkills.value = Array.isArray(skills.technologies) ? skills.technologies.join(", ") : "";
  profCoreSkills.value = Array.isArray(skills.core_competencies) ? skills.core_competencies.join(", ") : "";
}

function syncVisualToJson() {
  currentProfile.personal_info = currentProfile.personal_info || {};
  currentProfile.personal_info.name = profName.value.trim();
  currentProfile.personal_info.title = profTitle.value.trim();
  currentProfile.personal_info.email = profEmail.value.trim();
  currentProfile.personal_info.phone = profPhone.value.trim();
  currentProfile.personal_info.location = profLocation.value.trim();
  currentProfile.personal_info.status = profStatus.value.trim();

  currentProfile.personal_info.linkedin = profLinkedin.value.trim();
  currentProfile.personal_info.github = profGithub.value.trim();
  currentProfile.personal_info.website = profWebsite.value.trim();
  currentProfile.personal_info.telegram = profTelegram.value.trim();

  currentProfile.summary = profSummary.value.trim();

  currentProfile.stats = currentProfile.stats || {};
  currentProfile.stats.years_experience = profExpYears.value.trim();
  currentProfile.stats.projects_completed = profProjects.value.trim();

  currentProfile.skills = currentProfile.skills || {};
  currentProfile.skills.technologies = profTechSkills.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  currentProfile.skills.core_competencies = profCoreSkills.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  profileText.value = JSON.stringify(currentProfile, null, 2);
}

function syncJsonToVisual() {
  try {
    const parsed = JSON.parse(profileText.value);
    currentProfile = parsed;
    populateVisualForm(parsed);
  } catch (_) {}
}

saveVisualProfileBtn.addEventListener("click", async () => {
  syncVisualToJson();
  await chrome.storage.local.set({ [K.PROFILE]: currentProfile });
  setStatus(visualProfileStatus, "Profile saved successfully.", "ok");
  showToast("Profile updated successfully!");
});

// ---------- JSON Mode Logic ----------
saveProfileBtn.addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(profileText.value);
    currentProfile = parsed;
    await chrome.storage.local.set({ [K.PROFILE]: parsed });
    populateVisualForm(parsed);
    setStatus(profileStatus, "Profile saved.", "ok");
    showToast("Profile saved from JSON.");
  } catch (err) {
    setStatus(profileStatus, `Invalid JSON: ${err.message}`, "error");
  }
});

formatJsonBtn.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(profileText.value);
    profileText.value = JSON.stringify(parsed, null, 2);
    showToast("JSON formatted.");
  } catch (err) {
    showToast("Invalid JSON syntax — cannot format.");
  }
});

copyJsonBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(profileText.value);
    showToast("JSON copied to clipboard!");
  } catch (_) {
    showToast("Couldn't copy to clipboard.");
  }
});

resetDefaultBtn.addEventListener("click", async () => {
  if (confirm("Reset profile to the bundled sample profile? Any uncommitted edits will be lost.")) {
    try {
      const res = await fetch(chrome.runtime.getURL("profile.json"));
      const bundled = await res.json();
      currentProfile = bundled;
      profileText.value = JSON.stringify(bundled, null, 2);
      populateVisualForm(bundled);
      await chrome.storage.local.set({ [K.PROFILE]: bundled });
      showToast("Reset to sample profile.");
    } catch (err) {
      showToast("Error loading sample profile.");
    }
  }
});

profileFile.addEventListener("change", async () => {
  const file = profileFile.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    currentProfile = parsed;
    profileText.value = JSON.stringify(parsed, null, 2);
    populateVisualForm(parsed);
    await chrome.storage.local.set({ [K.PROFILE]: parsed });
    setStatus(profileStatus, "Loaded and saved from file.", "ok");
    showToast(`Loaded ${file.name}`);
  } catch (err) {
    setStatus(profileStatus, `Invalid JSON file: ${err.message}`, "error");
  }
});

// ---------- Resume Vault Logic ----------
function setupResumeDropzone() {
  resumeDropzone.addEventListener("click", () => resumeFile.click());

  resumeDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    resumeDropzone.classList.add("dragover");
  });

  resumeDropzone.addEventListener("dragleave", () => {
    resumeDropzone.classList.remove("dragover");
  });

  resumeDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    resumeDropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        resumeFile.files = e.dataTransfer.files;
        handleFileSelected(file);
      } else {
        showToast("Only PDF resumes are supported.");
      }
    }
  });

  resumeFile.addEventListener("change", () => {
    if (resumeFile.files.length > 0) {
      handleFileSelected(resumeFile.files[0]);
    }
  });
}

function handleFileSelected(file) {
  showToast(`Selected ${file.name}. Enter a target role and click Add.`);
  if (!resumeRole.value.trim()) {
    // Attempt role heuristic from filename
    const clean = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
    resumeRole.value = clean;
    resumeRole.focus();
  }
}

addResumeBtn.addEventListener("click", async () => {
  const role = resumeRole.value.trim();
  const file = resumeFile.files[0];
  if (!role || !file) {
    setStatus(resumeStatus, "Please provide a target role and select a PDF resume.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const data = e.target.result;
    resumes.push({
      id: "resume_" + Date.now(),
      role: role,
      filename: file.name,
      fileSize: formatBytes(file.size),
      dateAdded: new Date().toISOString(),
      data: data,
    });

    try {
      await chrome.storage.local.set({ [K.RESUMES]: resumes });
      renderResumes(resumes);
      resumeRole.value = "";
      resumeFile.value = "";
      setStatus(resumeStatus, "Resume added successfully!", "ok");
      showToast(`Added resume for "${role}"`);
    } catch (err) {
      setStatus(resumeStatus, "Error saving: " + err.message, "error");
    }
  };
  reader.readAsDataURL(file);
});

function renderResumes(list) {
  resumes = list || [];
  resumeList.innerHTML = "";

  if (resumes.length === 0) {
    resumeList.innerHTML = `<li style="color: var(--text-muted); font-size: 12.5px; padding: 12px 0;">No resumes uploaded yet.</li>`;
    return;
  }

  resumes.forEach((r, idx) => {
    const li = document.createElement("li");
    li.className = "resume-card-item";
    li.innerHTML = `
      <div class="resume-item-info">
        <div class="pdf-icon-badge">PDF</div>
        <div class="resume-text-meta">
          <strong>${escapeHtml(r.role)}</strong>
          <span class="resume-filename">${escapeHtml(r.filename)} ${r.fileSize ? `(${r.fileSize})` : ""}</span>
        </div>
      </div>
      <div class="resume-actions">
        <button class="ghost-btn preview-btn" data-idx="${idx}">Preview</button>
        <button class="ghost-btn danger-hover remove-btn" data-idx="${idx}">Delete</button>
      </div>
    `;
    resumeList.appendChild(li);
  });

  // Attach actions
  resumeList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = e.target.getAttribute("data-idx");
      resumes.splice(idx, 1);
      await chrome.storage.local.set({ [K.RESUMES]: resumes });
      renderResumes(resumes);
      showToast("Resume deleted.");
    });
  });

  resumeList.querySelectorAll(".preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = e.target.getAttribute("data-idx");
      const r = resumes[idx];
      if (r && r.data) {
        const win = window.open();
        win.document.write(`<iframe src="${r.data}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;" allowfullscreen></iframe>`);
      }
    });
  });
}

// ---------- Model Tuning Handlers ----------
saveModelsBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    [K.MAPPING_MODEL]: mappingModelInput.value.trim() || JOBFILL_DEFAULTS.MAPPING_MODEL,
    [K.WRITING_MODEL]: writingModelInput.value.trim() || JOBFILL_DEFAULTS.WRITING_MODEL,
  });
  setStatus(modelStatus, "Model settings saved.", "ok");
  showToast("AI models configured.");
});

// ---------- Continual Memory Handlers ----------
viewMemoryBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
});

// Listen for memory updates in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[K.USER_MEMORY]) {
    const mem = changes[K.USER_MEMORY].newValue || {};
    updateMemoryDisplays(Object.keys(mem).length);
  }
});

// ---------- Toast Notification Utility ----------
function showToast(text, duration = 2800) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status-msg ${kind || ""}`;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
