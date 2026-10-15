// options.js — Comprehensive settings, Tracker, Writing Assistant, and Profile manager

const K = (typeof JOBFILL_DEFAULTS !== "undefined" && JOBFILL_DEFAULTS.STORAGE_KEYS) || {
  API_KEY: "jobfill_api_key",
  PROFILE: "jobfill_profile",
  MAPPING_MODEL: "jobfill_mapping_model",
  WRITING_MODEL: "jobfill_writing_model",
  LOG: "jobfill_log",
  RESUMES: "jobfill_resumes",
  USER_MEMORY: "jobfill_user_memory",
  APPLICATIONS: "jobfill_applications",
  OVERWRITE_EXISTING: "jobfill_overwrite_existing",
  COVER_LETTERS: "jobfill_cover_letters",
};

// DOM References
const navItems = document.querySelectorAll(".nav-item");
const tabPanes = document.querySelectorAll(".tab-pane");
const toast = document.getElementById("toast");

// General Elements
const apiKeyInput = document.getElementById("apiKey");
const toggleKeyVisibility = document.getElementById("toggleKeyVisibility");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const testKeyBtn = document.getElementById("testKeyBtn");
const keySpinner = document.getElementById("keySpinner");
const keyStatus = document.getElementById("keyStatus");
const overwriteExistingToggle = document.getElementById("overwriteExistingToggle");

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
// Photo Elements
const photoFileInput = document.getElementById("photoFileInput");
const uploadPhotoBtn = document.getElementById("uploadPhotoBtn");
const removePhotoBtn = document.getElementById("removePhotoBtn");
const photoPreviewImg = document.getElementById("photoPreviewImg");
const photoPlaceholder = document.getElementById("photoPlaceholder");
const photoStatus = document.getElementById("photoStatus");

// Additional Demographic & Logistics Visual Form Fields
const profWorkAuth = document.getElementById("profWorkAuth");
const profSponsorship = document.getElementById("profSponsorship");
const profNotice = document.getElementById("profNotice");
const profRelocate = document.getElementById("profRelocate");
const profGender = document.getElementById("profGender");
const profPronouns = document.getElementById("profPronouns");
const profVeteran = document.getElementById("profVeteran");
const profDisability = document.getElementById("profDisability");
const profEthnicity = document.getElementById("profEthnicity");
const profJobSource = document.getElementById("profJobSource");

// Import from Resume Modal
const openResumeImportBtn = document.getElementById("openResumeImportBtn");
const resumeImportModal = document.getElementById("resumeImportModal");
const closeImportModalBtn = document.getElementById("closeImportModalBtn");
const cancelImportBtn = document.getElementById("cancelImportBtn");
const startImportBtn = document.getElementById("startImportBtn");
const importSpinner = document.getElementById("importSpinner");
const rawResumeText = document.getElementById("rawResumeText");

// Application Tracker Elements
const totalAppsMetric = document.getElementById("totalAppsMetric");
const appliedAppsMetric = document.getElementById("appliedAppsMetric");
const interviewingAppsMetric = document.getElementById("interviewingAppsMetric");
const offeredAppsMetric = document.getElementById("offeredAppsMetric");
const rejectedAppsMetric = document.getElementById("rejectedAppsMetric");
const trackerSearch = document.getElementById("trackerSearch");
const trackerStatusFilter = document.getElementById("trackerStatusFilter");
const exportAppsBtn = document.getElementById("exportAppsBtn");
const addAppBtn = document.getElementById("addAppBtn");
const appsTableBody = document.getElementById("appsTableBody");

// Add / Edit Application Modal
const appEditModal = document.getElementById("appEditModal");
const appModalTitle = document.getElementById("appModalTitle");
const closeAppModalBtn = document.getElementById("closeAppModalBtn");
const cancelAppBtn = document.getElementById("cancelAppBtn");
const saveAppRecordBtn = document.getElementById("saveAppRecordBtn");
const editAppId = document.getElementById("editAppId");
const appCompany = document.getElementById("appCompany");
const appRole = document.getElementById("appRole");
const appStatus = document.getElementById("appStatus");
const appDate = document.getElementById("appDate");
const appFollowUp = document.getElementById("appFollowUp");
const appSalary = document.getElementById("appSalary");
const appJobUrl = document.getElementById("appJobUrl");
const appNotes = document.getElementById("appNotes");

// AI Writing Assistant Elements
const writerMode = document.getElementById("writerMode");
const writerTone = document.getElementById("writerTone");
const writerCompany = document.getElementById("writerCompany");
const writerRole = document.getElementById("writerRole");
const writerQuestion = document.getElementById("writerQuestion");
const writerJobDesc = document.getElementById("writerJobDesc");
const writerLenBtns = document.querySelectorAll(".writer-len-btn");
const generateWritingBtn = document.getElementById("generateWritingBtn");
const writerSpinner = document.getElementById("writerSpinner");
const writerStatus = document.getElementById("writerStatus");
const writerOutputCard = document.getElementById("writerOutputCard");
const writerWordCount = document.getElementById("writerWordCount");
const copyWriterBtn = document.getElementById("copyWriterBtn");
const saveDraftBtn = document.getElementById("saveDraftBtn");
const writerOutputText = document.getElementById("writerOutputText");

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
const presetPills = document.querySelectorAll(".preset-pill[data-target]");

// Memory Elements
const viewMemoryBtn = document.getElementById("viewMemoryBtn");
const memoryCount = document.getElementById("memoryCount");

let currentProfile = {};
let resumes = [];
let applications = [];
let selectedWriterLength = "medium";
let toastTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupEyeToggle();
  setupProfileViewSwitch();
  setupPhotoUpload();
  setupResumeDropzone();
  setupPresetPills();
  setupTracker();
  setupWriter();
  setupResumeImport();
  await loadExisting();
});

// ---------- Navigation ----------
function setupNavigation() {
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });
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
      ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });
}

// ---------- Profile View Switcher ----------
function setupProfileViewSwitch() {
  viewVisualBtn.addEventListener("click", () => {
    viewVisualBtn.classList.add("active");
    viewJsonBtn.classList.remove("active");
    visualProfileView.classList.remove("hidden");
    jsonProfileView.classList.add("hidden");
    syncJsonToVisual();
  });

  viewJsonBtn.addEventListener("click", () => {
    viewJsonBtn.classList.add("active");
    viewVisualBtn.classList.remove("active");
    jsonProfileView.classList.remove("hidden");
    visualProfileView.classList.add("hidden");
    syncVisualToJson();
  });
}

// ---------- Presets for Models ----------
function setupPresetPills() {
  presetPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const targetInput = document.getElementById(pill.getAttribute("data-target"));
      const val = pill.getAttribute("data-val");
      if (targetInput && val) {
        targetInput.value = val;
        showToast(`Model preset: ${val}`);
      }
    });
  });
}

// ---------- Photo Upload & Preview ----------
function setupPhotoUpload() {
  uploadPhotoBtn.addEventListener("click", () => photoFileInput.click());

  photoFileInput.addEventListener("change", () => {
    if (photoFileInput.files && photoFileInput.files[0]) {
      const file = photoFileInput.files[0];
      if (!file.type.startsWith("image/")) {
        showToast("Please select an image file (JPG, PNG, WEBP)");
        return;
      }
      if (file.size > 3.5 * 1024 * 1024) {
        showToast("Image too large (maximum 3.5 MB)");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUri = e.target.result;
        const photoObj = {
          filename: file.name,
          data: dataUri,
          mimeType: file.type,
        };
        await chrome.storage.local.set({ [K.PROFILE_PHOTO]: photoObj });
        renderPhotoPreview(photoObj);
        showToast("Profile photo updated ✓");
      };
      reader.readAsDataURL(file);
    }
  });

  removePhotoBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove(K.PROFILE_PHOTO);
    renderPhotoPreview(null);
    showToast("Profile photo removed");
  });
}

function renderPhotoPreview(photoObj) {
  if (photoObj && photoObj.data) {
    photoPreviewImg.src = photoObj.data;
    photoPreviewImg.classList.remove("hidden");
    photoPlaceholder.classList.add("hidden");
    removePhotoBtn.classList.remove("hidden");
  } else {
    photoPreviewImg.src = "";
    photoPreviewImg.classList.add("hidden");
    photoPlaceholder.classList.remove("hidden");
    removePhotoBtn.classList.add("hidden");
  }
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
    K.APPLICATIONS,
    K.OVERWRITE_EXISTING,
    K.PROFILE_PHOTO,
  ]);

  if (stored[K.API_KEY]) {
    apiKeyInput.value = stored[K.API_KEY];
  }

  overwriteExistingToggle.checked = Boolean(stored[K.OVERWRITE_EXISTING]);

  renderPhotoPreview(stored[K.PROFILE_PHOTO] || null);

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

  mappingModelInput.value = stored[K.MAPPING_MODEL] || JOBFILL_DEFAULTS.MAPPING_MODEL;
  writingModelInput.value = stored[K.WRITING_MODEL] || JOBFILL_DEFAULTS.WRITING_MODEL;

  resumes = stored[K.RESUMES] || [];
  renderResumes(resumes);

  applications = stored[K.APPLICATIONS] || [];
  renderApplications(applications);

  const memory = stored[K.USER_MEMORY] || {};
  updateMemoryCount(Object.keys(memory).length);
}

function updateMemoryCount(count) {
  memoryCount.textContent =
    count === 0 ? "No learned answers yet" : `${count} answer${count === 1 ? "" : "s"} saved in memory`;
}

// ---------- API Key & Overwrite Handlers ----------
saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, "Please enter an API key", "error");
    return;
  }
  await chrome.storage.local.set({ [K.API_KEY]: key });
  setStatus(keyStatus, "Key saved", "ok");
  showToast("API key saved");
});

testKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(keyStatus, "Enter a key first", "error");
    return;
  }

  testKeyBtn.disabled = true;
  keySpinner.classList.remove("hidden");
  setStatus(keyStatus, "Testing...", "");

  try {
    const res = await chrome.runtime.sendMessage({ action: "testApiKey" });
    if (res && res.ok) {
      setStatus(keyStatus, "Connection verified ✓", "ok");
      showToast("Gemini API connection successful");
    } else {
      setStatus(keyStatus, `Error: ${res?.error || "Connection failed"}`, "error");
    }
  } catch (err) {
    setStatus(keyStatus, `Error: ${err.message}`, "error");
  } finally {
    testKeyBtn.disabled = false;
    keySpinner.classList.add("hidden");
  }
});

overwriteExistingToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ [K.OVERWRITE_EXISTING]: overwriteExistingToggle.checked });
  showToast(overwriteExistingToggle.checked ? "Overwrite enabled" : "Overwrite disabled");
});

// ---------- Visual Profile Form Population & Sync ----------
function populateVisualForm(profile) {
  const p = profile.personal_info || {};
  profName.value = p.name || "";
  profTitle.value = p.title || "";
  profEmail.value = p.email || "";
  profPhone.value = p.phone || "";
  profLocation.value = p.location || "";
  profStatus.value = p.status || "";
  profLinkedin.value = p.linkedin || "";
  profGithub.value = p.github || "";
  profWebsite.value = p.website || "";
  profTelegram.value = p.telegram || "";

  // Demographic & Logistics
  profWorkAuth.value = p.work_authorization || "";
  profSponsorship.value = p.sponsorship_required || "No";
  profNotice.value = p.notice_period || "";
  profRelocate.value = p.willing_to_relocate || "Yes";
  profGender.value = p.gender || "Male";
  profPronouns.value = p.pronouns || "";
  profVeteran.value = p.veteran_status || "I am not a protected veteran";
  profDisability.value = p.disability_status || "No, I do not have a disability";
  profEthnicity.value = p.race_ethnicity || "";
  profJobSource.value = p.job_source || "LinkedIn";

  profSummary.value = profile.summary || "";

  const stats = profile.stats || {};
  profExpYears.value = stats.years_experience || "";
  profProjects.value = stats.projects_completed || "";

  const skills = profile.skills || {};
  profTechSkills.value = (skills.technologies || []).join(", ");
  profCoreSkills.value = (skills.core_competencies || []).join(", ");
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

  // Demographic & Logistics
  currentProfile.personal_info.work_authorization = profWorkAuth.value.trim();
  currentProfile.personal_info.sponsorship_required = profSponsorship.value.trim();
  currentProfile.personal_info.notice_period = profNotice.value.trim();
  currentProfile.personal_info.willing_to_relocate = profRelocate.value.trim();
  currentProfile.personal_info.gender = profGender.value.trim();
  currentProfile.personal_info.pronouns = profPronouns.value.trim();
  currentProfile.personal_info.veteran_status = profVeteran.value.trim();
  currentProfile.personal_info.disability_status = profDisability.value.trim();
  currentProfile.personal_info.race_ethnicity = profEthnicity.value.trim();
  currentProfile.personal_info.job_source = profJobSource.value.trim();

  currentProfile.summary = profSummary.value.trim();

  const stats = currentProfile.stats || {};
  currentProfile.stats = stats;
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
  setStatus(visualProfileStatus, "Saved ✓", "ok");
  showToast("Profile saved successfully");
});

// ---------- JSON Mode Handlers ----------
saveProfileBtn.addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(profileText.value);
    currentProfile = parsed;
    await chrome.storage.local.set({ [K.PROFILE]: parsed });
    populateVisualForm(parsed);
    setStatus(profileStatus, "Saved ✓", "ok");
    showToast("Profile JSON saved");
  } catch (err) {
    setStatus(profileStatus, `Invalid JSON: ${err.message}`, "error");
  }
});

formatJsonBtn.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(profileText.value);
    profileText.value = JSON.stringify(parsed, null, 2);
    showToast("JSON formatted");
  } catch (err) {
    showToast("Invalid JSON");
  }
});

copyJsonBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(profileText.value);
    showToast("Copied to clipboard");
  } catch (_) {
    showToast("Copy failed");
  }
});

resetDefaultBtn.addEventListener("click", async () => {
  if (confirm("Reset profile to sample template?")) {
    try {
      const res = await fetch(chrome.runtime.getURL("profile.json"));
      const bundled = await res.json();
      currentProfile = bundled;
      profileText.value = JSON.stringify(bundled, null, 2);
      populateVisualForm(bundled);
      await chrome.storage.local.set({ [K.PROFILE]: bundled });
      showToast("Profile reset to sample");
    } catch (_) {
      showToast("Error resetting profile");
    }
  }
});

profileFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      currentProfile = parsed;
      profileText.value = JSON.stringify(parsed, null, 2);
      populateVisualForm(parsed);
      await chrome.storage.local.set({ [K.PROFILE]: parsed });
      showToast("Profile imported from file");
    } catch (err) {
      alert("Invalid JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
});

// ---------- Import Profile from Resume Modal ----------
function setupResumeImport() {
  openResumeImportBtn.addEventListener("click", () => {
    rawResumeText.value = "";
    resumeImportModal.classList.remove("hidden");
  });

  closeImportModalBtn.addEventListener("click", () => resumeImportModal.classList.add("hidden"));
  cancelImportBtn.addEventListener("click", () => resumeImportModal.classList.add("hidden"));

  startImportBtn.addEventListener("click", async () => {
    const text = rawResumeText.value.trim();
    if (text.length < 50) {
      alert("Please paste at least 50 characters of resume text.");
      return;
    }

    startImportBtn.disabled = true;
    importSpinner.classList.remove("hidden");

    try {
      const res = await chrome.runtime.sendMessage({
        action: "parseResumeToProfile",
        resumeText: text,
      });

      if (res && res.profile) {
        const extracted = res.profile;
        if (confirm("Resume extracted successfully! Merge details into your profile?")) {
          // Merge personal info
          currentProfile.personal_info = {
            ...(currentProfile.personal_info || {}),
            ...(extracted.personal_info || {}),
          };
          if (extracted.summary) currentProfile.summary = extracted.summary;
          if (extracted.skills) {
            currentProfile.skills = currentProfile.skills || {};
            currentProfile.skills.technologies = Array.from(
              new Set([
                ...(currentProfile.skills.technologies || []),
                ...(extracted.skills.technologies || []),
              ])
            );
            currentProfile.skills.core_competencies = Array.from(
              new Set([
                ...(currentProfile.skills.core_competencies || []),
                ...(extracted.skills.core_competencies || []),
              ])
            );
          }
          if (Array.isArray(extracted.experience) && extracted.experience.length > 0) {
            currentProfile.experience = extracted.experience;
          }
          if (Array.isArray(extracted.education) && extracted.education.length > 0) {
            currentProfile.education = extracted.education;
          }

          populateVisualForm(currentProfile);
          profileText.value = JSON.stringify(currentProfile, null, 2);
          await chrome.storage.local.set({ [K.PROFILE]: currentProfile });
          resumeImportModal.classList.add("hidden");
          showToast("Profile merged from resume ✓");
        }
      } else {
        alert("Could not extract profile details: " + (res?.error || "Unknown error"));
      }
    } catch (err) {
      alert("Extraction error: " + err.message);
    } finally {
      startImportBtn.disabled = false;
      importSpinner.classList.add("hidden");
    }
  });
}

// ---------- Application Tracker ----------
function setupTracker() {
  trackerSearch.addEventListener("input", filterAndRenderApps);
  trackerStatusFilter.addEventListener("change", filterAndRenderApps);

  addAppBtn.addEventListener("click", () => {
    openAppModal();
  });

  closeAppModalBtn.addEventListener("click", () => appEditModal.classList.add("hidden"));
  cancelAppBtn.addEventListener("click", () => appEditModal.classList.add("hidden"));

  saveAppRecordBtn.addEventListener("click", async () => {
    const comp = appCompany.value.trim();
    const role = appRole.value.trim();
    if (!comp || !role) {
      alert("Company Name and Job Title are required.");
      return;
    }

    const appRecord = {
      id: editAppId.value || "app_" + Date.now(),
      company: comp,
      role: role,
      status: appStatus.value,
      appliedDate: appDate.value || new Date().toISOString().split("T")[0],
      followUpDate: appFollowUp.value || "",
      salary: appSalary.value.trim(),
      jobUrl: appJobUrl.value.trim(),
      notes: appNotes.value.trim(),
      lastUpdated: new Date().toISOString(),
    };

    const idx = applications.findIndex((a) => a.id === appRecord.id);
    if (idx >= 0) {
      applications[idx] = appRecord;
    } else {
      applications.unshift(appRecord);
    }

    await chrome.storage.local.set({ [K.APPLICATIONS]: applications });
    appEditModal.classList.add("hidden");
    renderApplications(applications);
    showToast("Application saved");
  });

  exportAppsBtn.addEventListener("click", () => {
    if (applications.length === 0) {
      showToast("No applications to export");
      return;
    }
    const headers = ["Company", "Role", "Status", "Date Applied", "Follow Up", "Salary", "URL", "Notes"];
    const rows = applications.map((a) => [
      `"${(a.company || "").replace(/"/g, '""')}"`,
      `"${(a.role || "").replace(/"/g, '""')}"`,
      `"${a.status || "Applied"}"`,
      `"${a.appliedDate || ""}"`,
      `"${a.followUpDate || ""}"`,
      `"${(a.salary || "").replace(/"/g, '""')}"`,
      `"${(a.jobUrl || "").replace(/"/g, '""')}"`,
      `"${(a.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `jobfill_applications_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

function openAppModal(existing = null) {
  if (existing) {
    appModalTitle.textContent = "Edit Application";
    editAppId.value = existing.id;
    appCompany.value = existing.company || "";
    appRole.value = existing.role || "";
    appStatus.value = existing.status || "Applied";
    appDate.value = existing.appliedDate ? existing.appliedDate.split("T")[0] : "";
    appFollowUp.value = existing.followUpDate || "";
    appSalary.value = existing.salary || "";
    appJobUrl.value = existing.jobUrl || "";
    appNotes.value = existing.notes || "";
  } else {
    appModalTitle.textContent = "New Job Application";
    editAppId.value = "";
    appCompany.value = "";
    appRole.value = "";
    appStatus.value = "Applied";
    appDate.value = new Date().toISOString().split("T")[0];
    appFollowUp.value = "";
    appSalary.value = "";
    appJobUrl.value = "";
    appNotes.value = "";
  }
  appEditModal.classList.remove("hidden");
}

function renderApplications(list) {
  applications = list || [];
  updateTrackerMetrics(applications);
  filterAndRenderApps();
}

function updateTrackerMetrics(list) {
  totalAppsMetric.textContent = list.length;
  appliedAppsMetric.textContent = list.filter((a) => a.status === "Applied").length;
  interviewingAppsMetric.textContent = list.filter((a) => a.status === "Interviewing").length;
  offeredAppsMetric.textContent = list.filter((a) => a.status === "Offered").length;
  rejectedAppsMetric.textContent = list.filter((a) => a.status === "Rejected").length;
}

function filterAndRenderApps() {
  const query = (trackerSearch.value || "").toLowerCase().trim();
  const statusFilter = trackerStatusFilter.value;

  const filtered = applications.filter((app) => {
    const matchesQuery =
      !query ||
      (app.company && app.company.toLowerCase().includes(query)) ||
      (app.role && app.role.toLowerCase().includes(query));
    const matchesStatus = statusFilter === "ALL" || app.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  appsTableBody.innerHTML = "";
  if (filtered.length === 0) {
    appsTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px;">
          ${applications.length === 0 ? "No applications recorded yet." : "No applications match your filter."}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((app) => {
    const tr = document.createElement("tr");
    const statusClass = `status-${(app.status || "applied").toLowerCase()}`;
    const dateStr = app.appliedDate ? app.appliedDate.split("T")[0] : "-";
    const followUpStr = app.followUpDate || "-";

    tr.innerHTML = `
      <td style="font-weight: 600; color: #fff;">
        ${escapeHtml(app.company)}
        ${app.jobUrl ? `<a href="${escapeHtml(app.jobUrl)}" target="_blank" rel="noopener" style="color: var(--text-dim); margin-left: 4px; font-size: 11px;">↗</a>` : ""}
      </td>
      <td>${escapeHtml(app.role)}</td>
      <td style="color: var(--text-muted);">${dateStr}</td>
      <td>
        <select class="status-badge ${statusClass} app-status-select" data-id="${app.id}" style="border: none; cursor: pointer; outline: none; background: transparent;">
          <option value="Applied" ${app.status === "Applied" ? "selected" : ""}>Applied</option>
          <option value="Interviewing" ${app.status === "Interviewing" ? "selected" : ""}>Interviewing</option>
          <option value="Offered" ${app.status === "Offered" ? "selected" : ""}>Offered</option>
          <option value="Rejected" ${app.status === "Rejected" ? "selected" : ""}>Rejected</option>
          <option value="Wishlist" ${app.status === "Wishlist" ? "selected" : ""}>Wishlist</option>
        </select>
      </td>
      <td style="color: var(--text-muted);">${followUpStr}</td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="btn-subtle edit-app-btn" data-id="${app.id}" style="padding: 2px 8px; font-size: 11px;">Edit</button>
          <button class="btn-subtle text-danger delete-app-btn" data-id="${app.id}" style="padding: 2px 8px; font-size: 11px;">Delete</button>
        </div>
      </td>
    `;
    appsTableBody.appendChild(tr);
  });

  appsTableBody.querySelectorAll(".app-status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const newStatus = e.target.value;
      const app = applications.find((a) => a.id === id);
      if (app) {
        app.status = newStatus;
        await chrome.storage.local.set({ [K.APPLICATIONS]: applications });
        updateTrackerMetrics(applications);
        showToast(`Status updated to ${newStatus}`);
      }
    });
  });

  appsTableBody.querySelectorAll(".edit-app-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const app = applications.find((a) => a.id === id);
      if (app) openAppModal(app);
    });
  });

  appsTableBody.querySelectorAll(".delete-app-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (confirm("Delete this application record?")) {
        applications = applications.filter((a) => a.id !== id);
        await chrome.storage.local.set({ [K.APPLICATIONS]: applications });
        renderApplications(applications);
        showToast("Application deleted");
      }
    });
  });
}

// ---------- AI Writing Assistant ----------
function setupWriter() {
  writerLenBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      writerLenBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedWriterLength = btn.getAttribute("data-len");
    });
  });

  generateWritingBtn.addEventListener("click", async () => {
    const comp = writerCompany.value.trim();
    const role = writerRole.value.trim();
    const jobDesc = writerJobDesc.value.trim();
    const q = writerQuestion.value.trim();

    if (!comp && !role && !jobDesc) {
      setStatus(writerStatus, "Please provide company, role, or job description.", "error");
      return;
    }

    generateWritingBtn.disabled = true;
    writerSpinner.classList.remove("hidden");
    setStatus(writerStatus, "Generating draft with Gemini…", "");

    try {
      const res = await chrome.runtime.sendMessage({
        action: "generateCoverLetter",
        data: {
          mode: writerMode.value,
          company: comp,
          role: role,
          jobDescription: jobDesc,
          tone: writerTone.value,
          length: selectedWriterLength,
          customPrompt: q,
          profile: currentProfile,
        },
      });

      if (res && res.result) {
        writerOutputText.value = res.result;
        writerOutputCard.classList.remove("hidden");
        updateWordCount(res.result);
        setStatus(writerStatus, "Generated successfully ✓", "ok");
      } else {
        setStatus(writerStatus, `Error: ${res?.error || "Generation failed"}`, "error");
      }
    } catch (err) {
      setStatus(writerStatus, `Error: ${err.message}`, "error");
    } finally {
      generateWritingBtn.disabled = false;
      writerSpinner.classList.add("hidden");
    }
  });

  copyWriterBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(writerOutputText.value);
      showToast("Draft copied to clipboard ✓");
    } catch (_) {
      showToast("Copy failed");
    }
  });

  saveDraftBtn.addEventListener("click", async () => {
    const draft = writerOutputText.value.trim();
    if (!draft) return;
    const { [K.COVER_LETTERS]: drafts } = await chrome.storage.local.get(K.COVER_LETTERS);
    const list = Array.isArray(drafts) ? drafts : [];
    list.unshift({
      id: "draft_" + Date.now(),
      company: writerCompany.value.trim() || "General",
      role: writerRole.value.trim() || "Cover Letter",
      text: draft,
      date: new Date().toISOString(),
    });
    await chrome.storage.local.set({ [K.COVER_LETTERS]: list.slice(0, 50) });
    showToast("Draft saved to library");
  });

  writerOutputText.addEventListener("input", () => {
    updateWordCount(writerOutputText.value);
  });
}

function updateWordCount(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  writerWordCount.textContent = `${words} words`;
}

// ---------- Resume Dropzone & Management ----------
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
        showToast("Please select a PDF file");
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
  if (!resumeRole.value.trim()) {
    const clean = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
    resumeRole.value = clean;
    resumeRole.focus();
  }
}

addResumeBtn.addEventListener("click", async () => {
  const role = resumeRole.value.trim();
  const file = resumeFile.files[0];
  if (!role || !file) {
    setStatus(resumeStatus, "Please provide a target role and choose a PDF", "error");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    setStatus(resumeStatus, "PDF exceeds 5 MB limit", "error");
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
      setStatus(resumeStatus, "Resume added ✓", "ok");
      showToast("Resume uploaded successfully");
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
    resumeList.innerHTML = `<li style="color: var(--text-dim); font-size: 12px; padding: 6px 0;">No resumes attached yet</li>`;
    return;
  }

  resumes.forEach((r, idx) => {
    const li = document.createElement("li");
    li.className = "resume-row";
    li.innerHTML = `
      <div class="resume-meta">
        <span class="resume-badge">PDF</span>
        <span class="resume-role">${escapeHtml(r.role)}</span>
        <span class="resume-filename">(${escapeHtml(r.filename)})</span>
      </div>
      <div class="resume-actions">
        <button class="resume-btn preview-btn" data-idx="${idx}">Preview</button>
        <button class="resume-btn remove-btn text-danger" data-idx="${idx}">Remove</button>
      </div>
    `;
    resumeList.appendChild(li);
  });

  resumeList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = e.target.getAttribute("data-idx");
      resumes.splice(idx, 1);
      await chrome.storage.local.set({ [K.RESUMES]: resumes });
      renderResumes(resumes);
      showToast("Resume removed");
    });
  });

  resumeList.querySelectorAll(".preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = e.target.getAttribute("data-idx");
      const r = resumes[idx];
      if (r && r.data) {
        const win = window.open();
        win.document.write(
          `<iframe src="${r.data}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;" allowfullscreen></iframe>`
        );
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
  setStatus(modelStatus, "Saved ✓", "ok");
  showToast("Model settings saved");
});

// ---------- Memory Handlers ----------
viewMemoryBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
});

// ---------- Utilities ----------
function setStatus(el, msg, type = "") {
  el.textContent = msg;
  el.className = `inline-status ${type}`;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

function formatBytes(bytes) {
  if (!+bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
