// constants.js — single place to tune models, storage keys, and limits.
// Loaded before every other script (see manifest/executeScript ordering).

var JOBFILL_DEFAULTS = {
  // Cheapest/fastest current tier — used for field-classification/mapping,
  // which is closer to matching a label to a value than to writing.
  MAPPING_MODEL: "gemini-3.8-flash",

  // Best speed/quality tradeoff — used only for actual writing (tailored
  // bullet points, short cover-letter-style answers), once per job.
  WRITING_MODEL: "gemini-3.8-flash",

  API_URL: "https://generativelanguage.googleapis.com/v1beta/models",

  MAPPING_MAX_TOKENS: 1024,
  WRITING_MAX_TOKENS: 700,

  // Sentinel the model is told to return when profile data genuinely
  // doesn't cover a question (salary, sponsorship, notice period, etc.)
  // so JobFill can flag it instead of inventing an answer.
  NEEDS_INPUT_TOKEN: "[NEEDS YOUR INPUT]",

  STORAGE_KEYS: {
    API_KEY: "jobfill_api_key",
    PROFILE: "jobfill_profile",
    MAPPING_MODEL: "jobfill_mapping_model",
    WRITING_MODEL: "jobfill_writing_model",
    LOG: "jobfill_log",
    RESUMES: "jobfill_resumes",
    USER_MEMORY: "jobfill_user_memory", // Continual learning memory
    APPLICATIONS: "jobfill_applications", // Application tracker records
    OVERWRITE_EXISTING: "jobfill_overwrite_existing", // Overwrite existing values toggle
    COVER_LETTERS: "jobfill_cover_letters", // Saved cover letters & answers
    PROFILE_PHOTO: "jobfill_profile_photo", // Candidate profile picture/avatar
  },

  MAX_LOG_ENTRIES: 200,
  MAX_MEMORY_ENTRIES: 500, // Maximum number of learned Q&A pairs
  MAX_APPLICATIONS: 1000,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = JOBFILL_DEFAULTS;
}
