// popup.js — Clean, understated logic for JobFill popup

const fillBtn = document.getElementById("fillBtn");
const fillBtnText = document.getElementById("fillBtnText");
const statusRow = document.getElementById("statusRow");
const statusSpinner = document.getElementById("statusSpinner");
const statusText = document.getElementById("statusText");
const logList = document.getElementById("logList");
const exportBtn = document.getElementById("exportBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const optionsBtn = document.getElementById("optionsBtn");
const memoryBtn = document.getElementById("memoryBtn");
const trackerBtn = document.getElementById("trackerBtn");
const memoryCountBadge = document.getElementById("memoryCountBadge");
const popupOverwriteToggle = document.getElementById("popupOverwriteToggle");
const unsupportedBanner = document.getElementById("unsupportedBanner");
const unsupportedMsg = document.getElementById("unsupportedMsg");

const tabDomain = document.getElementById("tabDomain");
const tabType = document.getElementById("tabType");
const headerStatusDot = document.getElementById("headerStatusDot");

const keyCheck = document.getElementById("keyCheck");
const keyVal = document.getElementById("keyVal");
const keyBullet = document.getElementById("keyBullet");
const profileCheck = document.getElementById("profileCheck");
const profileVal = document.getElementById("profileVal");
const profileBullet = document.getElementById("profileBullet");
const resumeCheck = document.getElementById("resumeCheck");
const resumeVal = document.getElementById("resumeVal");
const resumeBullet = document.getElementById("resumeBullet");

document.addEventListener("DOMContentLoaded", async () => {
  setupListeners();
  await inspectCurrentTab();
  await checkReadiness();
  await renderLog();
});

function setupListeners() {
  optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

  trackerBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#tab-tracker") });
  });

  memoryBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
  });

  keyCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());
  profileCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());
  resumeCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());

  fillBtn.addEventListener("click", handleFillClick);
  exportBtn.addEventListener("click", handleExportLog);
  clearLogBtn.addEventListener("click", handleClearLog);

  popupOverwriteToggle.addEventListener("change", async () => {
    const key = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.OVERWRITE_EXISTING) || "jobfill_overwrite_existing";
    await chrome.storage.local.set({ [key]: popupOverwriteToggle.checked });
  });
}

async function inspectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      setTabInfo("No active tab", "Idle");
      showUnsupported("No active browser tab found.");
      return;
    }

    // Check for internal browser URLs
    if (/^(chrome|edge|opera|about|view-source|chrome-extension):\/\//i.test(tab.url)) {
      setTabInfo("Browser page", "Restricted");
      showUnsupported(
        "Autofill is restricted on browser internal and extension pages. Navigate to a job posting or application form (e.g. Greenhouse, Lever, Workday, LinkedIn) to use JobFill."
      );
      fillBtn.disabled = true;
      fillBtnText.textContent = "Unavailable on this page";
      return;
    }

    if (!/^https?:\/\//i.test(tab.url)) {
      setTabInfo("Local page", "Restricted");
      showUnsupported("JobFill requires a standard http:// or https:// job application URL.");
      fillBtn.disabled = true;
      fillBtnText.textContent = "Unavailable on this page";
      return;
    }

    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname.replace(/^www\./, "");

    const knownBoards = [
      "greenhouse.io",
      "lever.co",
      "workday.com",
      "ashbyhq.com",
      "myworkdayjobs.com",
      "smartrecruiters.com",
      "bamboohr.com",
      "icims.com",
      "taleo.net",
      "linkedin.com",
      "indeed.com",
    ];
    const isKnownJobBoard = knownBoards.some((board) => domain.endsWith(board));

    setTabInfo(domain, isKnownJobBoard ? "Job application" : "Web form");
    unsupportedBanner.classList.add("hidden");
  } catch (err) {
    setTabInfo("Active tab", "Ready");
  }
}

function showUnsupported(msg) {
  unsupportedMsg.textContent = msg;
  unsupportedBanner.classList.remove("hidden");
}

function setTabInfo(domain, type) {
  tabDomain.textContent = domain;
  tabType.textContent = type;
}

async function checkReadiness() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || {
    API_KEY: "jobfill_api_key",
    PROFILE: "jobfill_profile",
    RESUMES: "jobfill_resumes",
    USER_MEMORY: "jobfill_user_memory",
    OVERWRITE_EXISTING: "jobfill_overwrite_existing",
  };

  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.RESUMES,
    K.USER_MEMORY,
    K.OVERWRITE_EXISTING,
  ]);

  popupOverwriteToggle.checked = Boolean(stored[K.OVERWRITE_EXISTING]);

  let allReady = true;

  // 1. API Key
  const hasKey = Boolean(stored[K.API_KEY] && stored[K.API_KEY].trim().length > 0);
  if (hasKey) {
    keyVal.textContent = "Configured";
    keyBullet.className = "tag-bullet bullet-ok";
  } else {
    keyVal.textContent = "Missing";
    keyBullet.className = "tag-bullet bullet-err";
    allReady = false;
  }

  // 2. Profile
  const profile = stored[K.PROFILE];
  const hasProfile = Boolean(profile && typeof profile === "object" && Object.keys(profile).length > 0);
  if (hasProfile) {
    const candidateName = profile.personal_info?.name || "Active";
    profileVal.textContent = candidateName.split(" ")[0] || "Active";
    profileBullet.className = "tag-bullet bullet-ok";
  } else {
    profileVal.textContent = "Configured";
    profileBullet.className = "tag-bullet bullet-ok";
  }

  // 3. Resumes
  const resumes = stored[K.RESUMES];
  const resumeCount = Array.isArray(resumes) ? resumes.length : 0;
  if (resumeCount > 0) {
    resumeVal.textContent = `${resumeCount} attached`;
    resumeBullet.className = "tag-bullet bullet-ok";
  } else {
    resumeVal.textContent = "None";
    resumeBullet.className = "tag-bullet bullet-warn";
  }

  // 4. Memory count badge
  const memory = stored[K.USER_MEMORY] || {};
  const memCount = Object.keys(memory).length;
  if (memCount > 0) {
    memoryCountBadge.textContent = memCount > 99 ? "99+" : memCount;
    memoryCountBadge.classList.remove("hidden");
  } else {
    memoryCountBadge.classList.add("hidden");
  }

  if (headerStatusDot) {
    headerStatusDot.className = allReady ? "status-indicator" : "status-indicator warn";
  }
}

async function handleFillClick() {
  if (fillBtn.disabled) return;

  fillBtn.disabled = true;
  fillBtnText.textContent = "Filling application…";
  showStatus("Scanning fields on page…", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab found.");
    if (!/^https?:\/\//i.test(tab.url || "")) {
      throw new Error("JobFill cannot run on restricted or browser internal URLs.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["constants.js", "rules.js", "content.js"],
    });

    showStatus("Active on page", true);
    setTimeout(renderLog, 3000);
  } catch (err) {
    showStatus(`Failed: ${err.message}`, false, true);
  } finally {
    fillBtn.disabled = false;
    fillBtnText.textContent = "Fill application";
  }
}

function showStatus(text, isDone = false, isErr = false) {
  statusRow.classList.remove("hidden");
  statusText.textContent = text;
  statusText.style.color = isErr ? "#ef4444" : isDone ? "#10b981" : "#a1a1aa";
  if (isDone || isErr) {
    statusSpinner.classList.add("hidden");
    setTimeout(() => statusRow.classList.add("hidden"), 4000);
  } else {
    statusSpinner.classList.remove("hidden");
  }
}

async function renderLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.LOG) || "jobfill_log";
  const { [K]: log } = await chrome.storage.local.get(K);
  logList.innerHTML = "";

  if (!Array.isArray(log) || log.length === 0) {
    logList.innerHTML = '<li class="log-empty">No applications filled yet</li>';
    return;
  }

  log.slice(0, 10).forEach((entry) => {
    const li = document.createElement("li");
    li.className = "log-item";

    const title = entry.title || new URL(entry.url).hostname;
    const date = new Date(entry.date);
    const timeStr = isNaN(date.getTime())
      ? "Recent"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    li.innerHTML = `
      <div class="log-title">${escapeHtml(title)}</div>
      <div class="log-meta">
        <span class="log-stats">
          <span class="stat-tag tag-rule">${entry.filledByRule || 0} rule</span>
          <span class="stat-tag tag-ai">${entry.filledByAI || 0} AI</span>
          <span class="stat-tag tag-manual">${entry.needsManual || 0} manual</span>
        </span>
        <span class="log-time">${timeStr}</span>
      </div>
    `;
    logList.appendChild(li);
  });
}

async function handleExportLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.LOG) || "jobfill_log";
  const { [K]: log } = await chrome.storage.local.get(K);
  if (!log || log.length === 0) return;

  const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobfill-history-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleClearLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.LOG) || "jobfill_log";
  await chrome.storage.local.set({ [K]: [] });
  await renderLog();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
