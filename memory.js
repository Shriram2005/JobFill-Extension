// memory.js — Compact & Enhanced UI for viewing and managing learned answers

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
    noMatch.style.padding = "24px 16px";
    noMatch.innerHTML = `
      <div style="font-size: 20px; margin-bottom: 6px;">🔍</div>
      <p style="color: var(--text-muted); font-size: 12.5px;">No answers match "<strong>${escapeHtml(searchInput.value)}</strong>"</p>
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
 * Build compact memory card
 */
function createMemoryCard(entry) {
  const card = document.createElement("div");
  card.className = "memory-item";
  card.dataset.question = entry.question;

  const isLong = entry.answer.length > 140 || (entry.answer.match(/\n/g) || []).length > 2;

  card.innerHTML = `
    <div class="view-mode">
      <div class="memory-item-top">
        <div class="question-wrap">
          <span class="question-text">${escapeHtml(entry.question)}</span>
          <span class="pill pill-count">${entry.timesUsed || 1}×</span>
          <span class="pill pill-time">${formatRelativeDate(entry.lastUsed)}</span>
          <span class="pill pill-source">${entry.source === "manual" ? "manual" : "learned"}</span>
        </div>
        <div class="item-actions">
          <button class="action-btn copy-btn" title="Copy Answer">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
            <span class="btn-text">Copy</span>
          </button>
          <button class="action-btn edit-btn" title="Edit Entry">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM9.75 4.81l-6.97 6.97a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064l6.97-6.97-1.439-1.44Z"/>
            </svg>
            Edit
          </button>
          <button class="action-btn delete delete-btn" title="Delete Entry">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.15l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.5h3a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="answer-box ${isLong ? 'clamped' : ''}">${escapeHtml(entry.answer)}</div>
      ${isLong ? '<button class="toggle-more-btn">Show more</button>' : ''}
    </div>

    <div class="inline-edit hidden">
      <div class="form-group">
        <label>Question / Prompt</label>
        <input type="text" class="edit-question" value="${escapeHtml(entry.question)}" />
      </div>
      <div class="form-group">
        <label>Answer</label>
        <textarea class="edit-answer" rows="3">${escapeHtml(entry.answer)}</textarea>
      </div>
      <div class="inline-edit-actions">
        <button class="btn btn-primary edit-save-btn">Save</button>
        <button class="btn btn-ghost edit-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Attach card event listeners
  const viewMode = card.querySelector(".view-mode");
  const editMode = card.querySelector(".inline-edit");
  const copyBtn = card.querySelector(".copy-btn");
  const editBtn = card.querySelector(".edit-btn");
  const deleteBtn = card.querySelector(".delete-btn");
  const toggleMoreBtn = card.querySelector(".toggle-more-btn");
  const answerBox = card.querySelector(".answer-box");

  // Copy handler
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(entry.answer);
      copyBtn.classList.add("copied");
      copyBtn.querySelector(".btn-text").textContent = "Copied!";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.querySelector(".btn-text").textContent = "Copy";
      }, 1500);
    } catch (err) {
      showToast("Failed to copy");
    }
  });

  // Toggle more / less
  if (toggleMoreBtn) {
    toggleMoreBtn.addEventListener("click", () => {
      const isClamped = answerBox.classList.contains("clamped");
      answerBox.classList.toggle("clamped", !isClamped);
      toggleMoreBtn.textContent = isClamped ? "Show less" : "Show more";
    });
  }

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
    showToast("Answer updated");
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

    // Also trigger background helper if active
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

    const isUpdate = !!memory[q];
    memory[q] = {
      answer: a,
      lastUsed: new Date().toISOString(),
      timesUsed: isUpdate ? (memory[q].timesUsed || 1) + 1 : 1,
      source: "manual",
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: memory });

    // Update in-memory entries
    const existingIndex = allMemoryEntries.findIndex((e) => e.question === q);
    if (existingIndex !== -1) {
      allMemoryEntries[existingIndex] = { question: q, ...memory[q] };
    } else {
      allMemoryEntries.unshift({ question: q, ...memory[q] });
    }

    toggleAddDrawer(false);
    applyFilterAndSort();
    updateHeaderStats();
    showToast(isUpdate ? "Updated existing answer" : "New answer added");
  } catch (err) {
    console.error("Error adding entry:", err);
    drawerStatus.textContent = "Failed to save";
    drawerStatus.className = "status-msg error";
  }
}

/**
 * Export Memory to JSON file download
 */
async function handleExportMemory() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const memory = data[STORAGE_KEY] || {};

    if (Object.keys(memory).length === 0) {
      showToast("No memory entries to export");
      return;
    }

    const jsonStr = JSON.stringify(memory, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `jobfill-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Memory exported to JSON");
  } catch (err) {
    console.error("Export failed:", err);
    showToast("Export failed");
  }
}

/**
 * Import Memory from JSON file
 */
function handleImportMemory(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Invalid memory format. Must be a JSON object.");
      }

      // Validate entries
      let importedCount = 0;
      const validEntries = {};
      for (const [q, val] of Object.entries(parsed)) {
        if (!q.trim()) continue;
        if (typeof val === "string") {
          validEntries[q] = {
            answer: val,
            lastUsed: new Date().toISOString(),
            timesUsed: 1,
            source: "imported",
          };
          importedCount++;
        } else if (typeof val === "object" && val.answer) {
          validEntries[q] = {
            answer: String(val.answer),
            lastUsed: val.lastUsed || new Date().toISOString(),
            timesUsed: Number(val.timesUsed) || 1,
            source: val.source || "imported",
          };
          importedCount++;
        }
      }

      if (importedCount === 0) {
        showToast("No valid entries found in JSON");
        return;
      }

      const data = await chrome.storage.local.get(STORAGE_KEY);
      const existing = data[STORAGE_KEY] || {};
      const merged = { ...existing, ...validEntries };

      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
      await loadMemory();
      showToast(`Imported ${importedCount} answers`);
    } catch (err) {
      console.error("Import error:", err);
      showToast("Invalid JSON file: " + err.message, 3500);
    } finally {
      importFileInput.value = "";
    }
  };

  reader.readAsText(file);
}

/**
 * Update header badge and last updated label
 */
function updateHeaderStats() {
  const count = allMemoryEntries.length;
  totalBadge.textContent = `${count} learned`;

  if (count === 0) {
    lastUpdated.textContent = "Never updated";
    return;
  }

  const newest = allMemoryEntries.reduce((latest, entry) => {
    const d = new Date(entry.lastUsed);
    return d > latest ? d : latest;
  }, new Date(0));

  lastUpdated.textContent = `Active ${formatRelativeDate(newest)}`;
}

/**
 * Update toolbar meta count summary
 */
function updateToolbarMeta(filteredCount) {
  const total = allMemoryEntries.length;
  if (total === 0) {
    filterSummary.textContent = "0 items";
  } else if (filteredCount === total) {
    filterSummary.textContent = `${total} item${total === 1 ? "" : "s"}`;
  } else {
    filterSummary.textContent = `${filteredCount} of ${total}`;
  }
}

/**
 * Format relative dates ("just now", "5m ago", "2h ago", "3d ago")
 */
function formatRelativeDate(dateStr) {
  if (!dateStr) return "recently";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "recently";

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Custom Confirmation Modal
 */
function showConfirmModal(title, message, onConfirm) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  pendingModalAction = onConfirm;
  confirmModal.classList.remove("hidden");
  modalConfirmBtn.focus();
}

function closeModal() {
  confirmModal.classList.add("hidden");
  pendingModalAction = null;
}

/**
 * Toast notification
 */
function showToast(msg, duration = 2200) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
