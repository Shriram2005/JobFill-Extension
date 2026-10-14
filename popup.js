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
const memoryCountBadge = document.getElementById("memoryCountBadge");

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

    if (!tab || !tab.url) {
      setTabInfo("No active tab", "Idle");
      return;
    }

    if (!/^https?:\/\//i.test(tab.url)) {
      setTabInfo("Browser page", "Restricted");
      fillBtn.disabled = true;
      fillBtnText.textContent = "Open a job page first";
      return;
    }

    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname.replace(/^www\./, "");
    
    const knownBoards = ["greenhouse.io", "lever.co", "workday.com", "ashbyhq.com", "myworkdayjobs.com", "smartrecruiters.com", "bamboohr.com", "icims.com", "taleo.net", "linkedin.com", "indeed.com"];
    const isKnownJobBoard = knownBoards.some(board => domain.endsWith(board));

    setTabInfo(domain, isKnownJobBoard ? "Job application" : "Web form");
  } catch (err) {
    setTabInfo("Active tab", "Ready");
  }
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
  };

  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.RESUMES,
    K.USER_MEMORY,
  ]);

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
    profileVal.textContent = "Sample";
    profileBullet.className = "tag-bullet bullet-warn";
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
      throw new Error("Open an actual job application first.");
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
  
  if (isDone) {
    statusSpinner.classList.add("done");
  } else {
    statusSpinner.classList.remove("done");
  }

  if (isErr) {
    statusRow.style.borderColor = "var(--accent-err)";
  } else {
    statusRow.style.borderColor = "var(--border-subtle)";
  }
}

async function renderLog() {
  const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || { LOG: "jobfill_log" };
  const { [K.LOG]: log } = await chrome.storage.local.get(K.LOG);

  if (!log || !Array.isArray(log) || log.length === 0) {
    logList.innerHTML = `<li class="log-empty">No applications filled yet</li>`;
    return;
  }

  logList.innerHTML = "";
  log.slice(0, 8).forEach((entry) => {
    const li = document.createElement("li");
    li.className = "log-row";
    
    const relativeTime = getRelativeTime(new Date(entry.date));
    const title = entry.title || formatDomain(entry.url);

    li.innerHTML = `
      <div class="log-left">
        <span class="log-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="log-time">${relativeTime}</span>
      </div>
      <span class="log-meta-tag">${entry.filledByRule || 0} local · ${entry.filledByAI || 0} AI${entry.needsManual ? ` · ${entry.needsManual} review` : ''}</span>
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
    return "Application page";
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
