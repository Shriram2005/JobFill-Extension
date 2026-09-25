const fillBtn = document.getElementById("fillBtn");
const statusRow = document.getElementById("statusRow");
const statusText = document.getElementById("statusText");
const logList = document.getElementById("logList");
const exportBtn = document.getElementById("exportBtn");
const optionsBtn = document.getElementById("optionsBtn");

document.addEventListener("DOMContentLoaded", renderLog);

fillBtn.addEventListener("click", async () => {
  fillBtn.disabled = true;
  showStatus("Injecting JobFill into this tab…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab found.");
    if (!/^https?:\/\//.test(tab.url || "")) {
      throw new Error("Open an actual job application page first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["constants.js", "rules.js", "content.js"],
    });

    showStatus("Running on the page — watch the status badge in the bottom-right corner of the tab.");
  } catch (err) {
    showStatus(`Couldn't start: ${err.message}`);
  } finally {
    fillBtn.disabled = false;
  }
});

optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

exportBtn.addEventListener("click", async () => {
  const { jobfill_log: log } = await chrome.storage.local.get("jobfill_log");
  const blob = new Blob([JSON.stringify(log || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads
    ? chrome.downloads.download({ url, filename: "jobfill-log.json" })
    : window.open(url);
});

function showStatus(text) {
  statusRow.classList.remove("hidden");
  statusText.textContent = text;
}

async function renderLog() {
  const { jobfill_log: log } = await chrome.storage.local.get("jobfill_log");
  if (!log || log.length === 0) return;

  logList.innerHTML = "";
  log.slice(0, 10).forEach((entry) => {
    const li = document.createElement("li");
    const date = new Date(entry.date);
    li.innerHTML = `
      <span class="log-title">${escapeHtml(entry.title || entry.url)}</span>
      <span class="log-meta">${date.toLocaleDateString()} — ${entry.filledByRule} local, ${entry.filledByAI} AI, ${entry.needsManual} manual</span>
    `;
    logList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
