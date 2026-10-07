// popup.js — Modern logic for JobFill extension popup

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
const memoryCountBadge = document.getElementById("memoryCountBadge");

const tabDomain = document.getElementById("tabDomain");
const tabType = document.getElementById("tabType");
const tabIndicatorDot = document.querySelector(".tab-indicator-dot");

const overallStatusBadge = document.getElementById("overallStatusBadge");
const keyCheck = document.getElementById("keyCheck");
const keyVal = document.getElementById("keyVal");
const profileCheck = document.getElementById("profileCheck");
const profileVal = document.getElementById("profileVal");
const resumeCheck = document.getElementById("resumeCheck");
const resumeVal = document.getElementById("resumeVal");

let currentTab = null;

document.addEventListener("DOMContentLoaded", async () => {
  await inspectCurrentTab();
  await checkReadiness();
  await renderLog();
  setupListeners();
});

function setupListeners() {
  optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  
  memoryBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
  });

  keyCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());
  profileCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());
  resumeCheck.addEventListener("click", () => chrome.runtime.openOptionsPage());

  fillBtn.addEventListener("click", handleFillClick);
  exportBtn.addEventListener("click", handleExportLog);
  clearLogBtn.addEventListener("click", handleClearLog);
}

async function inspectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (!tab || !tab.url) {
      setTabInfo("No active tab", "Unknown", false);
      return;
    }

    if (!/^https?:\/\//i.test(tab.url)) {
      setTabInfo("Restricted Page", "Cannot run on browser system pages", false);
      fillBtn.disabled = true;
      fillBtnText.textContent = "Open a Job Page First";
      return;
    }

    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname.replace(/^www\./, "");
    
    // Check if domain is known job board
    const knownBoards = ["greenhouse.io", "lever.co", "workday.com", "ashbyhq.com", "myworkdayjobs.com", "smartrecruiters.com", "bamboohr.com", "icims.com", "taleo.net", "linkedin.com", "indeed.com"];
    const isKnownJobBoard = knownBoards.some(board => domain.endsWith(board));

    setTabInfo(
      domain, 
      isKnownJobBoard ? "🎯 Recognized Job Application" : "Web Form Target", 
      true
    );
  } catch (err) {
    setTabInfo("Error inspecting tab", err.message, false);
  }
}

function setTabInfo(domain, type, isLive) {
  tabDomain.textContent = domain;
  tabType.textContent = type;
  if (!isLive) {
    tabIndicatorDot.classList.add("offline");
  } else {
    tabIndicatorDot.classList.remove("offline");
  }
}

async function checkReadiness() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || {
    API_KEY: "jobfill_api_key",
    PROFILE: "jobfill_profile",
    RESUMES: "jobfill_resumes",
    USER_MEMORY: "jobfill_user_memory",
  };

  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.RESUMES,
    K.USER_MEMORY,
  ]);

  let allGood = true;

  // 1. API Key check
  const hasKey = Boolean(stored[K.API_KEY] && stored[K.API_KEY].trim().length > 0);
  if (hasKey) {
    keyVal.textContent = "Connected";
    keyCheck.className = "matrix-item ok";
  } else {
    keyVal.textContent = "Missing";
    keyCheck.className = "matrix-item err";
    allGood = false;
  }

  // 2. Profile check
  const profile = stored[K.PROFILE];
  const hasProfile = Boolean(profile && typeof profile === "object" && Object.keys(profile).length > 0);
  if (hasProfile) {
    const candidateName = profile.personal_info?.name || "Loaded";
    profileVal.textContent = candidateName.split(" ")[0] || "Loaded";
    profileCheck.className = "matrix-item ok";
  } else {
    profileVal.textContent = "Sample Only";
    profileCheck.className = "matrix-item warn";
  }

  // 3. Resumes check
  const resumes = stored[K.RESUMES];
  const resumeCount = Array.isArray(resumes) ? resumes.length : 0;
  if (resumeCount > 0) {
    resumeVal.textContent = `${resumeCount} Active`;
    resumeCheck.className = "matrix-item ok";
  } else {
    resumeVal.textContent = "Optional";
    resumeCheck.className = "matrix-item warn";
  }

  // 4. Memory badge count
  const memory = stored[K.USER_MEMORY] || {};
  const memCount = Object.keys(memory).length;
  if (memCount > 0) {
    memoryCountBadge.textContent = memCount > 99 ? "99+" : memCount;
    memoryCountBadge.classList.remove("hidden");
  } else {
    memoryCountBadge.classList.add("hidden");
  }

  // Overall badge
  if (allGood) {
    overallStatusBadge.textContent = "Ready to Fill";
    overallStatusBadge.className = "status-pill status-ready";
  } else {
    overallStatusBadge.textContent = "Setup Required";
    overallStatusBadge.className = "status-pill status-attention";
  }
}

async function handleFillClick() {
  if (fillBtn.disabled) return;

  fillBtn.disabled = true;
  fillBtnText.textContent = "Running JobFill…";
  showStatus("Injecting JobFill copilot into tab…", false);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab found.");
    if (!/^https?:\/\//i.test(tab.url || "")) {
      throw new Error("Open an active job application page first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["constants.js", "rules.js", "content.js"],
    });

    showStatus("Active on page! Look for the JobFill Copilot at bottom-right.", true);
    
    // Auto-refresh log and status after 3 seconds
    setTimeout(renderLog, 3000);
  } catch (err) {
    showStatus(`Failed to start: ${err.message}`, false, true);
  } finally {
    fillBtn.disabled = false;
    fillBtnText.textContent = "Fill This Application";
  }
}

function showStatus(text, isDone = false, isErr = false) {
  statusRow.classList.remove("hidden");
  statusText.textContent = text;
  
  if (isDone) {
    statusSpinner.classList.add("done");
  } else {
    statusSpinner.classList.remove("done");
  }

  if (isErr) {
    statusRow.style.borderColor = "var(--status-err)";
  } else {
    statusRow.style.borderColor = "var(--border-focus)";
  }
}

async function renderLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || { LOG: "jobfill_log" };
  const { [K.LOG]: log } = await chrome.storage.local.get(K.LOG);

  if (!log || !Array.isArray(log) || log.length === 0) {
    logList.innerHTML = `
      <li class="empty-log">
        <div class="empty-icon">📝</div>
        <span>No applications filled yet</span>
      </li>
    `;
    return;
  }

  logList.innerHTML = "";
  log.slice(0, 10).forEach((entry) => {
    const li = document.createElement("li");
    li.className = "log-item";
    
    const relativeTime = getRelativeTime(new Date(entry.date));
    const title = entry.title || formatDomain(entry.url);

    li.innerHTML = `
      <div class="log-item-header">
        <span class="log-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="log-time">${relativeTime}</span>
      </div>
      <div class="log-badges">
        <span class="mini-badge rule">⚡ ${entry.filledByRule || 0} local</span>
        <span class="mini-badge ai">🤖 ${entry.filledByAI || 0} AI</span>
        ${entry.needsManual ? `<span class="mini-badge manual">⚠️ ${entry.needsManual} review</span>` : ''}
      </div>
    `;
    logList.appendChild(li);
  });
}

async function handleExportLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || { LOG: "jobfill_log" };
  const { [K.LOG]: log } = await chrome.storage.local.get(K.LOG);
  const blob = new Blob([JSON.stringify(log || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobfill-activity-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleClearLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || { LOG: "jobfill_log" };
  await chrome.storage.local.set({ [K.LOG]: [] });
  await renderLog();
}

function formatDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "Application Page";
  }
}

function getRelativeTime(date) {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
