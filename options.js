const K = JOBFILL_DEFAULTS.STORAGE_KEYS;

const apiKeyInput = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");
const profileFile = document.getElementById("profileFile");
const profileText = document.getElementById("profileText");
const profileStatus = document.getElementById("profileStatus");
const mappingModelInput = document.getElementById("mappingModel");
const writingModelInput = document.getElementById("writingModel");
const modelStatus = document.getElementById("modelStatus");

const resumeList = document.getElementById("resumeList");
const resumeRole = document.getElementById("resumeRole");
const resumeFile = document.getElementById("resumeFile");
const resumeStatus = document.getElementById("resumeStatus");
const addResumeBtn = document.getElementById("addResumeBtn");

let resumes = [];

document.addEventListener("DOMContentLoaded", loadExisting);

async function loadExisting() {
  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.MAPPING_MODEL,
    K.WRITING_MODEL,
    K.RESUMES,
  ]);

  if (stored[K.API_KEY]) apiKeyInput.value = stored[K.API_KEY];
  if (stored[K.PROFILE]) profileText.value = JSON.stringify(stored[K.PROFILE], null, 2);
  mappingModelInput.value = stored[K.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL;
  writingModelInput.value = stored[K.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL;
  renderResumes(stored[K.RESUMES] || []);
}

document.getElementById("saveKeyBtn").addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, "Enter a key first.", "error");
    return;
  }
  await chrome.storage.local.set({ [K.API_KEY]: key });
  setStatus(keyStatus, "Saved.", "ok");
});

document.getElementById("testKeyBtn").addEventListener("click", async () => {
  setStatus(keyStatus, "Testing…", "");
  const key = apiKeyInput.value.trim();
  if (key) await chrome.storage.local.set({ [K.API_KEY]: key });
  const res = await chrome.runtime.sendMessage({ action: "testApiKey" });
  if (res && res.ok) setStatus(keyStatus, "Key works.", "ok");
  else setStatus(keyStatus, `Failed: ${res && res.error}`, "error");
});

profileFile.addEventListener("change", async () => {
  const file = profileFile.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    profileText.value = JSON.stringify(parsed, null, 2);
    setStatus(profileStatus, "Loaded from file — click Save profile to store it.", "ok");
  } catch (err) {
    setStatus(profileStatus, `That file isn't valid JSON: ${err.message}`, "error");
  }
});

document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(profileText.value);
    await chrome.storage.local.set({ [K.PROFILE]: parsed });
    setStatus(profileStatus, "Profile saved.", "ok");
  } catch (err) {
    setStatus(profileStatus, `Invalid JSON: ${err.message}`, "error");
  }
});

document.getElementById("saveModelsBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({
    [K.MAPPING_MODEL]: mappingModelInput.value.trim() || JOBFILL_DEFAULTS.MAPPING_MODEL,
    [K.WRITING_MODEL]: writingModelInput.value.trim() || JOBFILL_DEFAULTS.WRITING_MODEL,
  });
  setStatus(modelStatus, "Saved.", "ok");
});

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status ${kind || ""}`;
}

function renderResumes(list) {
  resumes = list;
  resumeList.innerHTML = "";
  resumes.forEach((r, idx) => {
    const li = document.createElement("li");
    li.style.marginBottom = "5px";
    li.innerHTML = `<strong>${r.role}</strong> (${r.filename}) <button data-idx="${idx}" class="secondary" style="margin-left: 10px;">Remove</button>`;
    resumeList.appendChild(li);
  });
  
  resumeList.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = e.target.getAttribute("data-idx");
      resumes.splice(idx, 1);
      await chrome.storage.local.set({ [K.RESUMES]: resumes });
      renderResumes(resumes);
    });
  });
}

addResumeBtn.addEventListener("click", async () => {
  const role = resumeRole.value.trim();
  const file = resumeFile.files[0];
  if (!role || !file) {
    setStatus(resumeStatus, "Provide a role and select a PDF file.", "error");
    return;
  }
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const data = e.target.result;
    resumes.push({
      id: "resume_" + Date.now(),
      role: role,
      filename: file.name,
      data: data
    });
    try {
      await chrome.storage.local.set({ [K.RESUMES]: resumes });
      renderResumes(resumes);
      resumeRole.value = "";
      resumeFile.value = "";
      setStatus(resumeStatus, "Resume added.", "ok");
    } catch(err) {
      setStatus(resumeStatus, "Error saving (storage limit?). " + err.message, "error");
    }
  };
  reader.readAsDataURL(file);
});


// ---------- Continual Learning Memory Management ----------

const viewMemoryBtn = document.getElementById("viewMemoryBtn");
const memoryCount = document.getElementById("memoryCount");

// Load memory count on page load
async function loadMemoryCount() {
  try {
    const { jobfill_user_memory: memory } = await chrome.storage.local.get("jobfill_user_memory");
    const count = memory ? Object.keys(memory).length : 0;
    memoryCount.textContent = count === 0 
      ? "No learned answers yet" 
      : `${count} learned answer${count > 1 ? "s" : ""}`;
  } catch (err) {
    memoryCount.textContent = "Error loading";
  }
}

viewMemoryBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
});

// Load memory count on startup
document.addEventListener("DOMContentLoaded", loadMemoryCount);

// Listen for memory updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.jobfill_user_memory) {
    loadMemoryCount();
  }
});
