// memory.js — Modern logic for JobFill Continual Learning Dashboard

const STORAGE_KEY = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS?.USER_MEMORY) || "jobfill_user_memory";

// DOM Elements
const memoryList = document.getElementById("memoryList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const sortSelect = document.getElementById("sortSelect");
const filterSummary = document.getElementById("filterSummary");
const totalBadge = document.getElementById("totalBadge");
const lastUpdated = document.getElementById("lastUpdated");
const backBtn = document.getElementById("backBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

// Hero Stats Elements
const statTotalEntries = document.getElementById("statTotalEntries");
const statTotalReuses = document.getElementById("statTotalReuses");
const statTimeSaved = document.getElementById("statTimeSaved");

// Add Entry Drawer Elements
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

// Export / Import Elements
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

// Modal & Toast Elements
const confirmModal = document.getElementById("confirmModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const toast = document.getElementById("toast");

let allMemoryEntries = [];
let pendingModalAction = null;
let toastTimeout = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  loadMemory();
  setupEventListeners();
});

function setupEventListeners() {
  // Navigation
  backBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Search & Filtering
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

  // Add Drawer toggle
  addEntryBtn.addEventListener("click", () => toggleAddDrawer(true));
  closeDrawerBtn.addEventListener("click", () => toggleAddDrawer(false));
  cancelDrawerBtn.addEventListener("click", () => toggleAddDrawer(false));
  emptyAddBtn.addEventListener("click", () => toggleAddDrawer(true));
  saveDrawerBtn.addEventListener("click", handleSaveNewEntry);

  // Test Matcher toggle
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

  // Clear all
  clearAllBtn.addEventListener("click", () => {
    if (allMemoryEntries.length === 0) {
      showToast("Memory is already empty");
      return;
    }
    showConfirmModal(
      "Clear All Learned Memory?",
      "Are you sure you want to delete all learned questions and answers? This action cannot be undone.",
      async () => {
        try {
          await chrome.storage.local.set({ [STORAGE_KEY]: {} });
          try {
            await chrome.runtime.sendMessage({ action: "clearMemory" });
          } catch (_) {}
          allMemoryEntries = [];
          applyFilterAndSort();
          updateHeaderStats();
          showToast("All learning memory cleared");
        } catch (err) {
          console.error("Failed to clear memory:", err);
          showToast("Error clearing memory", 3000);
        }
      }
    );
  });

  // Modal actions
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

/**
 * Load memory entries from chrome storage
 */
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

    updateHeaderStats();
    applyFilterAndSort();
  } catch (err) {
    console.error("Error loading memory:", err);
    showToast("Failed to load memory");
  }
}

/**
 * Filter, sort, and re-render entries
 */
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

  // Sort entries
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
    // Default 'recent'
    return new Date(b.lastUsed) - new Date(a.lastUsed);
  });

  renderList(filtered);
  updateToolbarMeta(filtered.length);
}

/**
 * Render items to DOM
 */
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
    const noMatch = document.createElement("div");
    noMatch.className = "card empty-state";
    noMatch.style.padding = "28px 16px";
    noMatch.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
      <p style="color: var(--text-muted); font-size: 13px;">No answers match "<strong>${escapeHtml(searchInput.value)}</strong>"</p>
    `;
    memoryList.appendChild(noMatch);
    return;
  }

  entries.forEach((entry) => {
    const item = createMemoryCard(entry);
    memoryList.appendChild(item);
  });
}

/**
 * Build sleek memory card
 */
function createMemoryCard(entry) {
  const card = document.createElement("div");
  card.className = "memory-item";
  card.dataset.question = entry.question;

  card.innerHTML = `
    <div class="view-mode">
      <div class="memory-item-top">
        <div class="question-wrap">
          <span class="question-text">${escapeHtml(entry.question)}</span>
          <span class="pill pill-count">⚡ ${entry.timesUsed || 1}× used</span>
          <span class="pill pill-time">${formatRelativeDate(entry.lastUsed)}</span>
          <span class="pill pill-source">${entry.source === "manual" ? "manual" : "learned"}</span>
        </div>
        <div class="item-actions">
          <button class="action-btn copy-btn" title="Copy Answer">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="btn-text">Copy</span>
          </button>
          <button class="action-btn edit-btn" title="Edit Entry">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>Edit</span>
          </button>
          <button class="action-btn delete-btn" title="Delete Entry">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="answer-body">${escapeHtml(entry.answer)}</div>
    </div>

    <div class="edit-mode hidden">
      <div class="form-group">
        <label>Question / Prompt</label>
        <input type="text" class="edit-question" value="${escapeHtml(entry.question)}" />
      </div>
      <div class="form-group">
        <label>Preferred Answer</label>
        <textarea class="edit-answer" rows="3">${escapeHtml(entry.answer)}</textarea>
      </div>
      <div class="edit-actions">
        <button class="btn btn-primary edit-save-btn">Save</button>
        <button class="btn btn-ghost edit-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Attach card event listeners
  const viewMode = card.querySelector(".view-mode");
  const editMode = card.querySelector(".edit-mode");
  const copyBtn = card.querySelector(".copy-btn");
  const editBtn = card.querySelector(".edit-btn");
  const deleteBtn = card.querySelector(".delete-btn");

  // Copy handler
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(entry.answer);
      copyBtn.querySelector(".btn-text").textContent = "Copied!";
      setTimeout(() => {
        copyBtn.querySelector(".btn-text").textContent = "Copy";
      }, 1500);
    } catch (err) {
      showToast("Failed to copy");
    }
  });

  // Edit toggle
  editBtn.addEventListener("click", () => {
    viewMode.classList.add("hidden");
    editMode.classList.remove("hidden");
    const input = editMode.querySelector(".edit-question");
    input.focus();
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
      showToast("Question and answer cannot be empty");
      return;
    }

    await handleSaveEditedEntry(entry.question, updatedQ, updatedA);
  });

  // Delete handler
  deleteBtn.addEventListener("click", () => {
    showConfirmModal(
      "Delete Learned Answer?",
      `Are you sure you want to delete the answer for: "${entry.question}"?`,
      () => handleDeleteEntry(entry.question)
    );
  });

  return card;
}

/**
 * Handle saving edits to an existing memory item
 */
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

    // Update in-memory array
    const idx = allMemoryEntries.findIndex((e) => e.question === oldQuestion);
    if (idx !== -1) {
      allMemoryEntries[idx] = {
        question: newQuestionText,
        ...memory[newQuestionText],
      };
    }

    applyFilterAndSort();
    updateHeaderStats();
    showToast("Answer updated successfully");
  } catch (err) {
    console.error("Error updating entry:", err);
    showToast("Failed to save changes");
  }
}

/**
 * Delete a single memory entry
 */
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
    updateHeaderStats();
    showToast("Answer deleted");
  } catch (err) {
    console.error("Error deleting entry:", err);
    showToast("Failed to delete entry");
  }
}

/**
 * Toggle Add Entry Drawer
 */
function toggleAddDrawer(show) {
  addDrawer.classList.toggle("hidden", !show);
  drawerStatus.textContent = "";
  if (show) {
    newQuestion.value = "";
    newAnswer.value = "";
    newQuestion.focus();
    addDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Toggle Matcher Drawer
 */
function toggleMatcherDrawer(show) {
  testMatcherDrawer.classList.toggle("hidden", !show);
  testMatchResult.classList.add("hidden");
  if (show) {
    testQuestionInput.value = "";
    testQuestionInput.focus();
    testMatcherDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Simulate matching against current memory entries
 */
function handleRunMatchTest() {
  const query = testQuestionInput.value.trim();
  if (!query) {
    showToast("Enter a test question first");
    return;
  }

  if (allMemoryEntries.length === 0) {
    testMatchResult.classList.remove("hidden");
    testMatchResult.innerHTML = `<em>No memory entries exist yet. Add an answer first!</em>`;
    return;
  }

  // Tokenize query
  const stopWords = new Set(["the", "a", "an", "is", "are", "do", "you", "have", "your", "what", "which", "in", "for", "with"]);
  const queryTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
  const queryTokenSet = new Set(queryTokens);

  // Score each entry
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
      <div style="margin-bottom: 6px;">
        <strong>🎯 Matched Question:</strong> "${escapeHtml(best.question)}"
        <span class="pill pill-count" style="margin-left: 6px;">Confidence Score: ${Math.round(best.score)}</span>
      </div>
      <div><strong>Answer JobFill Will Inject:</strong></div>
      <div style="margin-top: 4px; color: var(--text-main); font-style: italic;">"${escapeHtml(best.answer)}"</div>
    `;
  } else {
    testMatchResult.innerHTML = `
      <div><strong>⚠️ Low Confidence:</strong> No learned memory strongly matches this specific question. JobFill will fall back to extracting from your general profile summary.</div>
    `;
  }
}

/**
 * Handle adding a new entry manually
 */
async function handleSaveNewEntry() {
  const q = newQuestion.value.trim();
  const a = newAnswer.value.trim();

  if (!q) {
    drawerStatus.textContent = "Please enter a question label";
    drawerStatus.className = "status-msg error";
    newQuestion.focus();
    return;
  }

  if (!a) {
    drawerStatus.textContent = "Please enter an answer";
    drawerStatus.className = "status-msg error";
    newAnswer.focus();
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
    updateHeaderStats();
    showToast(isUpdate ? "Answer updated" : "New answer added");
  } catch (err) {
    console.error("Error saving new entry:", err);
    drawerStatus.textContent = "Failed to save entry";
    drawerStatus.className = "status-msg error";
  }
}

/**
 * Export memory to a JSON file
 */
async function handleExportMemory() {
  if (allMemoryEntries.length === 0) {
    showToast("Memory is empty, nothing to export");
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

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobfill-memory-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Memory exported to JSON");
}

/**
 * Import memory from a JSON file
 */
async function handleImportMemory(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    if (typeof imported !== "object" || imported === null) {
      throw new Error("Invalid format: expected a JSON object");
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
    showToast(`Successfully imported ${count} answers`);
  } catch (err) {
    console.error("Import error:", err);
    showToast(`Import failed: ${err.message}`, 4000);
  } finally {
    importFileInput.value = "";
  }
}

/**
 * Update Header and Banner Stats
 */
function updateHeaderStats() {
  const total = allMemoryEntries.length;
  totalBadge.textContent = `${total} learned`;

  if (statTotalEntries) statTotalEntries.textContent = total;
  
  const totalReuses = allMemoryEntries.reduce((acc, curr) => acc + (curr.timesUsed || 1), 0);
  if (statTotalReuses) statTotalReuses.textContent = totalReuses;

  const minutesSaved = Math.round(totalReuses * 1.5);
  if (statTimeSaved) statTimeSaved.textContent = `${minutesSaved}m`;

  if (total === 0) {
    lastUpdated.textContent = "Never updated";
    return;
  }

  const latest = allMemoryEntries.reduce((latestDate, curr) => {
    const d = new Date(curr.lastUsed);
    return d > latestDate ? d : latestDate;
  }, new Date(0));

  lastUpdated.textContent = `Updated ${formatRelativeDate(latest.toISOString())}`;
}

function updateToolbarMeta(filteredCount) {
  const total = allMemoryEntries.length;
  if (filteredCount === total) {
    filterSummary.textContent = `${total} item${total === 1 ? "" : "s"}`;
  } else {
    filterSummary.textContent = `${filteredCount} of ${total}`;
  }
}

/**
 * Format date to friendly relative string
 */
function formatRelativeDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Confirmation Modal
 */
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

/**
 * Toast notification
 */
function showToast(message, duration = 2500) {
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
