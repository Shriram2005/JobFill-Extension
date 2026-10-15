# JobFill — Assisted Job Application Filler

A privacy-focused Chrome Extension (Manifest V3) that intelligently auto-populates job applications using your candidate profile and local matching rules, asking Google Gemini only for what is left, and **never submitting forms automatically.**

---

## Key Features

### 1. Zero-Cost Local Matching First
- Standard fields (names, email, phone, address, graduation dates, GPA, current role/employer, LinkedIn, GitHub, portfolio, work authorization) are matched locally in `rules.js` before any network request.
- Uses HTML5 autocomplete tokens and normalized label synonyms.
- **Cost: $0.00 — 100% private and instant.**

### 2. Built-in Job Application Tracker
- Automatically logs or lets you track applications directly in your browser.
- Dashboard metrics: Total Applications, Applied, Interviewing, Offered, and Rejected.
- Filter by status, search by company or role, manage follow-up dates, and export records as CSV.

### 3. AI Cover Letter & Custom Question Generator
- Drafts targeted cover letters and application essays in seconds.
- Tone selection (Professional, Enthusiastic, Confident, Concise) and length controls (Short ~150 words, Medium ~300 words, Detailed ~450 words).
- **Strictly fact-grounded**: Never fabricates skills, dates, or experience outside your verified profile.

### 4. Import Profile Directly from Resume
- Paste your resume text or upload your PDF in the Profile settings tab.
- Gemini extracts contact info, summary, core competencies, experience, education, and projects into structured JSON.
- Review and confirm before merging into your active candidate profile.

### 5. Continual Learning Memory (with Sensitive Data Filter)
- Observes questions and answers you manually fill on job forms.
- Interactive confirmation modal lets you select which Q&A pairs to remember.
- Sensitive credentials (passwords, SSNs, credit cards, PINs, bank accounts) are **strictly excluded** by default.
- Uses relevance similarity thresholds so unrelated questions are never polluted with past answers.

### 6. Overwrite Protection & Instant Undo
- Skips already-filled fields by default to prevent overwriting manual answers.
- Toggle "Overwrite existing answers" in popup or options whenever needed.
- Full snapshot taken prior to filling: click **"Undo Fill"** in the floating badge to restore all fields immediately.

### 7. Secure Header-Based API Key Transmission
- Transmits API keys exclusively via `x-goog-api-key` HTTP headers (never via URL query parameters).
- Candidate profiles are sanitized to minimize data sent to the AI model.
- Error logs automatically redact potential key leaks.

### 8. Interactive Resume Attachment
- Compares job requirements against your uploaded PDF resumes.
- Provides match explanation and matching/missing skills.
- Explicitly prompts you to approve attaching the resume file to the application form.

---

## Supported Gemini Models

JobFill defaults to Google's active **Gemini 3.8** family on Google AI Studio:

| Task | Default Model | Description |
|------|---------------|-------------|
| **Field Mapping** | `gemini-3.8-flash` | Ultra-fast categorization and multiple-choice matching |
| **Written Answers** | `gemini-3.8-flash` | Cohesive, concise tailored paragraphs for open-ended questions |
| **Deep Reasoning** | `gemini-3.8-pro` | Optional preset for complex technical questions |

You can configure model IDs and test connection anytime in **Settings → AI Models**.

---

## Installation

1. Open `chrome://extensions/` in Chrome or Brave.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `jobfill-extension` directory.
4. The JobFill icon appears in your browser toolbar.

---

## Initial Setup

1. Click the JobFill icon → **Settings** (or right-click → Options).
2. **API Key**: Paste your key from [Google AI Studio](https://aistudio.google.com/app/apikey) and click **Test connection**.
3. **Candidate Profile**: Fill out the visual form, import a JSON file, or use **Import from Resume**.
4. **Resumes (Optional)**: In the Resumes tab, upload PDF versions of your resume tailored for different roles.

---

## How to Use

1. Navigate to any job application page (Greenhouse, Lever, Workday, Ashby, Taleo, LinkedIn, etc.).
2. Click **Fill application** in the popup or press `Alt+Shift+F`.
3. An on-page floating toolbar will display progress:
   - **Green outline**: Matched locally from your profile (no API call).
   - **Blue outline**: Filled by Gemini AI.
   - **Orange outline**: Flagged for manual review (file uploads, missing profile details, or CAPTCHAs).
4. Review all answers, click **Log application** to save to your tracker, and submit the application yourself.

---

## Testing

Run the automated test suite locally:
```bash
node tests/jobfill.test.js
```
Validates local rule matching, memory relevance scoring, sensitive data redaction, profile minimization, and AI response validation.
