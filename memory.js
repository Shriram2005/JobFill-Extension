// memory.js — Clean, understated logic for JobFill Learned Answers

const STORAGE_KEY = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.USER_MEMORY) || "jobfill_user_memory";

// DOM Elements
const memoryList = document.getElementById("memoryList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const sortSelect = document.getElementById("sortSelect");
const filterSummary = document.getElementById("filterSummary");
const totalBadge = document.getElementById("totalBadge");
const backBtn = document.getElementById("backBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

// Add Entry Elements
const addEntryBtn = document.getElementById("addEntryBtn");
const addDrawer = document.getElementById("addDrawer");
const closeDrawerBtn = document.getElementById("closeDrawerBtn");
const newQuestion = document.getElementById("newQuestion");
const newAnswer = document.getElementById("newAnswer");
const saveDrawerBtn = document.getElementById("saveDrawerBtn");
const cancelDrawerBtn = document.getElementById("cancelDrawerBtn");
const drawerStatus = document.getElementById("drawerStatus");
const emptyAddBtn = document.getElementById("emptyAddBtn");

// Test Matcher Elements
const testMatcherBtn = document.getElementById("testMatcherBtn");
const testMatcherDrawer = document.getElementById("testMatcherDrawer");
const closeMatcherBtn = document.getElementById("closeMatcherBtn");
const testQuestionInput = document.getElementById("testQuestionInput");
const runMatchTestBtn = document.getElementById("runMatchTestBtn");
const testMatchResult = document.getElementById("testMatchResult");

// Export / Import
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

// Modal & Toast
const confirmModal = document.getElementById("confirmModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const toast = document.getElementById("toast");

let allMemoryEntries = [];
let pendingModalAction = null;
let toastTimeout = null;

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadMemory();
});

function setupEventListeners() {
  backBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    clearSearchBtn.classList.toggle("hidden", val.length === 0);
    applyFilterAndSort();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    searchInput.focus();
    applyFilterAndSort();
  });

  sortSelect.addEventListener("change", applyFilterAndSort);

  // Add Drawer
  addEntryBtn.addEventListener("click", () => toggleAddDrawer(true));
  closeDrawerBtn.addEventListener("click", () => toggleAddDrawer(false));
  cancelDrawerBtn.addEventListener("click", () => toggleAddDrawer(false));
  emptyAddBtn.addEventListener("click", () => toggleAddDrawer(true));
  saveDrawerBtn.addEventListener("click", handleSaveNewEntry);

  // Test Matcher
  testMatcherBtn.addEventListener("click", () => toggleMatcherDrawer(true));
  closeMatcherBtn.addEventListener("click", () => toggleMatcherDrawer(false));
  runMatchTestBtn.addEventListener("click", handleRunMatchTest);
  testQuestionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleRunMatchTest();
  });

  // Export / Import
  exportBtn.addEventListener("click", handleExportMemory);
  importBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", handleImportMemory);

  // Clear All
  clearAllBtn.addEventListener("click", () => {
    if (allMemoryEntries.length === 0) {
      showToast("Memory is already empty");
      return;
    }
    showConfirmModal(
      "Clear all answers",
      "Are you sure you want to delete all saved answers? This action cannot be undone.",
      async () => {
        try {
          await chrome.storage.local.set({ [STORAGE_KEY]: {} });
          try {
            await chrome.runtime.sendMessage({ action: "clearMemory" });
          } catch (_) {}
          allMemoryEntries = [];
          applyFilterAndSort();
          updateStats();
          showToast("All answers cleared");
        } catch (err) {
          showToast("Failed to clear");
        }
      }
    );
  });

  // Modal
  modalCancelBtn.addEventListener("click", closeModal);
  modalConfirmBtn.addEventListener("click", () => {
    if (typeof pendingModalAction === "function") {
      const action = pendingModalAction;
      pendingModalAction = null;
      closeModal();
      action();
    } else {
      closeModal();
    }
  });

  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeModal();
  });
}

async function loadMemory() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const memory = data[STORAGE_KEY] || {};

    allMemoryEntries = Object.entries(memory).map(([question, details]) => ({
      question,
      answer: details.answer || "",
      lastUsed: details.lastUsed || new Date().toISOString(),
      timesUsed: details.timesUsed || 1,
      source: details.source || "user_input",
    }));

    updateStats();
    applyFilterAndSort();
  } catch (err) {
    showToast("Failed to load memory");
  }
}

function applyFilterAndSort() {
  const query = searchInput.value.toLowerCase().trim();
  const sortMode = sortSelect.value;

  let filtered = allMemoryEntries.filter((entry) => {
    if (!query) return true;
    return (
      entry.question.toLowerCase().includes(query) ||
      entry.answer.toLowerCase().includes(query)
    );
  });

  filtered.sort((a, b) => {
    if (sortMode === "frequent") {
      return (b.timesUsed || 1) - (a.timesUsed || 1);
    }
    if (sortMode === "alpha") {
      return a.question.localeCompare(b.question);
    }
    if (sortMode === "oldest") {
      return new Date(a.lastUsed) - new Date(b.lastUsed);
    }
    return new Date(b.lastUsed) - new Date(a.lastUsed);
  });

  renderList(filtered);
  filterSummary.textContent = `${filtered.length} of ${allMemoryEntries.length}`;
}

function renderList(entries) {
  memoryList.innerHTML = "";

  if (allMemoryEntries.length === 0) {
    emptyState.classList.remove("hidden");
    memoryList.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  memoryList.classList.remove("hidden");

  if (entries.length === 0) {
    memoryList.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-dim); font-size: 13px;">
        No answers found matching "${escapeHtml(searchInput.value)}"
      </div>
    `;
    return;
  }

  entries.forEach((entry) => {
    const item = createMemoryCard(entry);
    memoryList.appendChild(item);
  });
}

function createMemoryCard(entry) {
  const card = document.createElement("div");
  card.className = "answer-card";
  card.dataset.question = entry.question;

  card.innerHTML = `
    <div class="view-mode">
      <div class="card-top">
        <div class="card-question-row">
          <span class="card-question">${escapeHtml(entry.question)}</span>
          <span class="card-tag">Used ${entry.timesUsed || 1}×</span>
          <span class="card-tag">${formatRelativeDate(entry.lastUsed)}</span>
        </div>
        <div class="card-actions">
          <button class="btn-card-action copy-btn">
            <span class="btn-text">Copy</span>
          </button>
          <button class="btn-card-action edit-btn">Edit</button>
          <button class="btn-card-action text-danger delete-btn">Delete</button>
        </div>
      </div>
      <div class="answer-body">${escapeHtml(entry.answer)}</div>
    </div>

    <div class="edit-mode hidden">
      <div class="field">
        <label>Question / Prompt</label>
        <input type="text" class="edit-question" value="${escapeHtml(entry.question)}" />
      </div>
      <div class="field" style="margin-top: 8px;">
        <label>Answer</label>
        <textarea class="edit-answer" rows="3">${escapeHtml(entry.answer)}</textarea>
      </div>
      <div class="edit-actions" style="margin-top: 10px;">
        <button class="btn-solid edit-save-btn">Save</button>
        <button class="btn-subtle edit-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  const viewMode = card.querySelector(".view-mode");
  const editMode = card.querySelector(".edit-mode");
  const copyBtn = card.querySelector(".copy-btn");
  const editBtn = card.querySelector(".edit-btn");
  const deleteBtn = card.querySelector(".delete-btn");

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(entry.answer);
      copyBtn.querySelector(".btn-text").textContent = "Copied";
      setTimeout(() => {
        copyBtn.querySelector(".btn-text").textContent = "Copy";
      }, 1400);
    } catch (_) {
      showToast("Copy failed");
    }
  });

  editBtn.addEventListener("click", () => {
    viewMode.classList.add("hidden");
    editMode.classList.remove("hidden");
    editMode.querySelector(".edit-question").focus();
  });

  const cancelEditBtn = editMode.querySelector(".edit-cancel-btn");
  cancelEditBtn.addEventListener("click", () => {
    editMode.classList.add("hidden");
    viewMode.classList.remove("hidden");
  });

  const saveEditBtn = editMode.querySelector(".edit-save-btn");
  saveEditBtn.addEventListener("click", async () => {
    const updatedQ = editMode.querySelector(".edit-question").value.trim();
    const updatedA = editMode.querySelector(".edit-answer").value.trim();

    if (!updatedQ || !updatedA) {
      showToast("Fields cannot be empty");
      return;
    }

    await handleSaveEditedEntry(entry.question, updatedQ, updatedA);
  });

  deleteBtn.addEventListener("click", () => {
    showConfirmModal(
      "Delete answer",
      `Delete saved answer for "${entry.question}"?`,
      () => handleDeleteEntry(entry.question)
    );
  });

  return card;
}

async function handleSaveEditedEntry(oldQuestion, newQuestionText, newAnswerText) {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const memory = data[STORAGE_KEY] || {};

    const existingData = memory[oldQuestion] || {
      timesUsed: 1,
      lastUsed: new Date().toISOString(),
      source: "manual",
    };

    if (oldQuestion !== newQuestionText) {
      delete memory[oldQuestion];
    }

    memory[newQuestionText] = {
      answer: newAnswerText,
      lastUsed: new Date().toISOString(),
      timesUsed: existingData.timesUsed || 1,
      source: existingData.source || "manual",
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: memory });

    const idx = allMemoryEntries.findIndex((e) => e.question === oldQuestion);
    if (idx !== -1) {
      allMemoryEntries[idx] = {
        question: newQuestionText,
        ...memory[newQuestionText],
      };
    }

    applyFilterAndSort();
    updateStats();
    showToast("Answer updated");
  } catch (err) {
    showToast("Failed to save");
  }
}

async function handleDeleteEntry(question) {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const memory = data[STORAGE_KEY] || {};

    delete memory[question];
    await chrome.storage.local.set({ [STORAGE_KEY]: memory });

    try {
      await chrome.runtime.sendMessage({ action: "deleteMemoryEntry", question });
    } catch (_) {}

    allMemoryEntries = allMemoryEntries.filter((e) => e.question !== question);
    applyFilterAndSort();
    updateStats();
    showToast("Answer deleted");
  } catch (err) {
    showToast("Delete failed");
  }
}

function toggleAddDrawer(show) {
  addDrawer.classList.toggle("hidden", !show);
  drawerStatus.textContent = "";
  if (show) {
    newQuestion.value = "";
    newAnswer.value = "";
    newQuestion.focus();
  }
}

function toggleMatcherDrawer(show) {
  testMatcherDrawer.classList.toggle("hidden", !show);
  testMatchResult.classList.add("hidden");
  if (show) {
    testQuestionInput.value = "";
    testQuestionInput.focus();
  }
}

function handleRunMatchTest() {
  const query = testQuestionInput.value.trim();
  if (!query) return;

  if (allMemoryEntries.length === 0) {
    testMatchResult.classList.remove("hidden");
    testMatchResult.textContent = "No saved answers available to match.";
    return;
  }

  const stopWords = new Set(["the", "a", "an", "is", "are", "do", "you", "have", "your", "what", "which", "in", "for", "with"]);
  const queryTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
  const queryTokenSet = new Set(queryTokens);

  const scored = allMemoryEntries.map(entry => {
    let score = 0;
    const qLower = entry.question.toLowerCase();
    if (query.toLowerCase().includes(qLower) || qLower.includes(query.toLowerCase())) {
      score += 15;
    }
    const entryTokens = qLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    for (const t of entryTokens) {
      if (queryTokenSet.has(t)) score += 3;
    }
    score += Math.min((entry.timesUsed || 1) * 0.5, 3);
    return { ...entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  testMatchResult.classList.remove("hidden");
  if (best.score > 2) {
    testMatchResult.innerHTML = `
      <div style="margin-bottom: 4px; color: var(--text-dim); font-size: 11.5px;">Matched question:</div>
      <div style="font-weight: 600; color: var(--text-main); margin-bottom: 8px;">"${escapeHtml(best.question)}"</div>
      <div style="margin-bottom: 4px; color: var(--text-dim); font-size: 11.5px;">Answer to be used:</div>
      <div style="color: var(--text-muted); font-size: 12px; background: var(--bg-surface); padding: 8px; border-radius: 4px; border: 1px solid var(--border-subtle);">${escapeHtml(best.answer)}</div>
    `;
  } else {
    testMatchResult.innerHTML = `<span style="color: var(--text-dim);">No close match found in memory. JobFill will fall back to your general profile info.</span>`;
  }
}

async function handleSaveNewEntry() {
  const q = newQuestion.value.trim();
  const a = newAnswer.value.trim();

  if (!q || !a) {
    drawerStatus.textContent = "Please fill in both fields";
    drawerStatus.className = "inline-status error";
    return;
  }

  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const memory = data[STORAGE_KEY] || {};

    const isUpdate = Boolean(memory[q]);
    memory[q] = {
      answer: a,
      lastUsed: new Date().toISOString(),
      timesUsed: isUpdate ? (memory[q].timesUsed || 0) + 1 : 1,
      source: "manual",
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: memory });

    const existingIdx = allMemoryEntries.findIndex((e) => e.question === q);
    if (existingIdx !== -1) {
      allMemoryEntries[existingIdx] = { question: q, ...memory[q] };
    } else {
      allMemoryEntries.unshift({ question: q, ...memory[q] });
    }

    toggleAddDrawer(false);
    applyFilterAndSort();
    updateStats();
    showToast("Answer saved");
  } catch (err) {
    drawerStatus.textContent = "Failed to save";
    drawerStatus.className = "inline-status error";
  }
}

async function handleExportMemory() {
  if (allMemoryEntries.length === 0) {
    showToast("No answers to export");
    return;
  }

  const exportData = {};
  allMemoryEntries.forEach((entry) => {
    exportData[entry.question] = {
      answer: entry.answer,
      lastUsed: entry.lastUsed,
      timesUsed: entry.timesUsed,
      source: entry.source,
    };
  });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobfill-answers-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImportMemory(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    if (typeof imported !== "object" || imported === null) {
      throw new Error("Invalid file format");
    }

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const existing = data[STORAGE_KEY] || {};
    let count = 0;

    for (const [q, details] of Object.entries(imported)) {
      if (typeof q === "string" && details && typeof details.answer === "string") {
        existing[q] = {
          answer: details.answer,
          lastUsed: details.lastUsed || new Date().toISOString(),
          timesUsed: details.timesUsed || 1,
          source: details.source || "imported",
        };
        count++;
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: existing });
    await loadMemory();
    showToast(`Imported ${count} answers`);
  } catch (err) {
    showToast("Import failed: " + err.message);
  } finally {
    importFileInput.value = "";
  }
}

function updateStats() {
  const total = allMemoryEntries.length;
  totalBadge.textContent = `${total} answer${total === 1 ? "" : "s"}`;
}

function formatRelativeDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function showConfirmModal(title, message, onConfirm) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  pendingModalAction = onConfirm;
  confirmModal.classList.remove("hidden");
}

function closeModal() {
  confirmModal.classList.add("hidden");
  pendingModalAction = null;
}

function showToast(message, duration = 2200) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
