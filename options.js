const K = JOBFILL_DEFAULTS.STORAGE_KEYS;

const apiKeyInput = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");
const profileFile = document.getElementById("profileFile");
const profileText = document.getElementById("profileText");
const profileStatus = document.getElementById("profileStatus");
const mappingModelInput = document.getElementById("mappingModel");
const writingModelInput = document.getElementById("writingModel");
const modelStatus = document.getElementById("modelStatus");

document.addEventListener("DOMContentLoaded", loadExisting);

async function loadExisting() {
  const stored = await chrome.storage.local.get([
    K.API_KEY,
    K.PROFILE,
    K.MAPPING_MODEL,
    K.WRITING_MODEL,
  ]);

  if (stored[K.API_KEY]) apiKeyInput.value = stored[K.API_KEY];
  if (stored[K.PROFILE]) profileText.value = JSON.stringify(stored[K.PROFILE], null, 2);
  mappingModelInput.value = stored[K.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL;
  writingModelInput.value = stored[K.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL;
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
