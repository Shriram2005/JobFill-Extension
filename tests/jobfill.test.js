// tests/jobfill.test.js — Automated test suite for JobFill core logic

const assert = require("assert");

// Load modules under test
const rules = require("../rules.js");
const background = require("../background.js");

console.log("==========================================");
console.log(" Running JobFill Comprehensive Test Suite");
console.log("==========================================");

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
  }
}

// Mock Candidate Profile
const mockProfile = {
  personal_info: {
    name: "Alex Morgan",
    first_name: "Alex",
    last_name: "Morgan",
    title: "Senior Software Engineer",
    email: "alex.morgan@example.com",
    phone: "+1 555-0192",
    location: "San Francisco, CA, USA",
    city: "San Francisco",
    state: "California",
    country: "United States",
    zip: "94105",
    linkedin: "https://linkedin.com/in/alexmorgan-dev",
    github: "https://github.com/alexmorgan-dev",
    website: "https://alexmorgan.dev",
    work_authorization: "Authorized to work in US without sponsorship",
    sponsorship_required: "No",
    notice_period: "2 weeks",
    willing_to_relocate: "Yes",
    gender: "Non-Binary",
    pronouns: "They/Them",
    veteran_status: "I am not a protected veteran",
    disability_status: "No, I do not have a disability",
    race_ethnicity: "Two or more races",
    job_source: "LinkedIn",
  },
  summary: "Experienced software engineer specializing in scalable web systems.",
  stats: {
    years_experience: "5+",
    projects_completed: "20+",
  },
  skills: {
    technologies: ["React", "TypeScript", "Node.js", "PostgreSQL"],
    core_competencies: ["Clean Architecture", "API Design"],
  },
  experience: [
    {
      company: "Apex Cloud Systems",
      role: "Senior Frontend Developer",
      duration: "2023 - Present",
    },
    {
      company: "Nexus Interactive",
      role: "Full Stack Engineer",
      duration: "2021 - 2023",
    },
  ],
  education: [
    {
      institution: "UC Berkeley",
      degree: "B.S. in Computer Science",
      duration: "2017 - 2021",
      grade: "3.8 GPA",
      field_of_study: "Computer Science",
    },
  ],
};

// 1. Text Normalization Tests
it("should normalize field labels by stripping asterisks and punctuation", () => {
  const norm1 = rules.jobfillNormalizeText("First Name *:");
  assert.strictEqual(norm1, "first name");

  const norm2 = rules.jobfillNormalizeText("LinkedIn Profile URL [Optional]?");
  assert.strictEqual(norm2, "linkedin profile url optional");
});

// 2. Local Rule Matching Tests
it("should match first name, last name, and full name locally", () => {
  const f1 = { id: "f1", matchType: "text", label: "First Name *" };
  assert.strictEqual(rules.jobfillMatchField(f1, mockProfile), "Alex");

  const f2 = { id: "f2", matchType: "text", label: "Last Name" };
  assert.strictEqual(rules.jobfillMatchField(f2, mockProfile), "Morgan");

  const f3 = { id: "f3", matchType: "text", label: "Legal Full Name" };
  assert.strictEqual(rules.jobfillMatchField(f3, mockProfile), "Alex Morgan");
});

it("should match contact info and links locally", () => {
  const emailField = { id: "f4", matchType: "email", label: "Email Address" };
  assert.strictEqual(rules.jobfillMatchField(emailField, mockProfile), "alex.morgan@example.com");

  const phoneField = { id: "f5", matchType: "tel", label: "Mobile Phone" };
  assert.strictEqual(rules.jobfillMatchField(phoneField, mockProfile), "+1 555-0192");

  const linkedInField = { id: "f6", matchType: "url", label: "LinkedIn URL" };
  assert.strictEqual(rules.jobfillMatchField(linkedInField, mockProfile), "https://linkedin.com/in/alexmorgan-dev");

  const githubField = { id: "f7", matchType: "url", label: "GitHub Profile" };
  assert.strictEqual(rules.jobfillMatchField(githubField, mockProfile), "https://github.com/alexmorgan-dev");
});

it("should match education details (degree, institution, grad year, GPA)", () => {
  const deg = { id: "f8", matchType: "text", label: "Highest Degree Completed" };
  assert.strictEqual(rules.jobfillMatchField(deg, mockProfile), "B.S. in Computer Science");

  const school = { id: "f9", matchType: "text", label: "University / School Name" };
  assert.strictEqual(rules.jobfillMatchField(school, mockProfile), "UC Berkeley");

  const grad = { id: "f10", matchType: "text", label: "Graduation Year" };
  assert.strictEqual(rules.jobfillMatchField(grad, mockProfile), "2021");

  const gpa = { id: "f11", matchType: "text", label: "Cumulative GPA" };
  assert.strictEqual(rules.jobfillMatchField(gpa, mockProfile), "3.8 GPA");
});

it("should match current company and title from most recent experience", () => {
  const comp = { id: "f12", matchType: "text", label: "Current Employer / Company Name" };
  assert.strictEqual(rules.jobfillMatchField(comp, mockProfile), "Apex Cloud Systems");

  const title = { id: "f13", matchType: "text", label: "Current Job Title" };
  assert.strictEqual(rules.jobfillMatchField(title, mockProfile), "Senior Frontend Developer");
});

it("should match HTML5 autocomplete tokens directly", () => {
  const acEmail = { id: "f14", matchType: "email", autocomplete: "email", label: "Some custom label" };
  assert.strictEqual(rules.jobfillMatchField(acEmail, mockProfile), "alex.morgan@example.com");

  const acGiven = { id: "f15", matchType: "text", autocomplete: "given-name", label: "" };
  assert.strictEqual(rules.jobfillMatchField(acGiven, mockProfile), "Alex");

  const acFamily = { id: "f16", matchType: "text", autocomplete: "family-name", label: "" };
  assert.strictEqual(rules.jobfillMatchField(acFamily, mockProfile), "Morgan");
});

// 3. Memory Retrieval & Relevance Threshold Tests
it("should score relevant memory questions above threshold and return formatted Q&A", () => {
  const sampleMemory = {
    "what are your salary expectations": {
      answer: "$140,000 - $160,000 base salary",
      lastUsed: "2026-10-10T10:00:00Z",
    },
    "are you willing to relocate to san francisco": {
      answer: "Yes, I am already based in San Francisco.",
      lastUsed: "2026-10-11T10:00:00Z",
    },
  };

  const formatted = background.formatMemoryForPrompt(sampleMemory, "What is your target salary or compensation?");
  assert(formatted.includes("$140,000 - $160,000"), "Should contain the relevant salary answer");
});

it("should NOT inject unrelated memory answers when no relevant match exists", () => {
  const sampleMemory = {
    "what are your salary expectations": {
      answer: "$140,000 base",
      lastUsed: "2026-10-10T10:00:00Z",
    },
  };

  const formatted = background.formatMemoryForPrompt(sampleMemory, "Do you hold a valid commercial drivers license?");
  assert(
    formatted.includes("No directly relevant past answers"),
    "Should not include irrelevant past answers"
  );
  assert(!formatted.includes("$140,000"), "Should not leak unrelated salary answers");
});

// 4. AI Response Validation Tests
it("should validate and enforce dropdown select options in AI field mapping", () => {
  const fields = [
    {
      id: "sel1",
      matchType: "select",
      options: ["Full-time", "Part-time", "Contract"],
    },
    {
      id: "txt1",
      matchType: "text",
      maxLength: 10,
    },
  ];

  const rawMapping = {
    sel1: "full-time", // Case difference
    txt1: "This is a very long string that exceeds 10 characters",
    unknownField: "Malicious or invalid response",
  };

  const validated = background.validateFieldMapping(rawMapping, fields);

  assert.strictEqual(validated.sel1, "Full-time", "Should match exact case from options");
  assert.strictEqual(validated.txt1, "This is a ", "Should enforce maxLength 10");
  assert.strictEqual(validated.unknownField, undefined, "Should reject unrequested field IDs");
});

// 5. Data Minimization & Security Tests
it("should strip sensitive credentials from candidate profile before sending to AI", () => {
  const profileWithSecrets = {
    ...mockProfile,
    personal_info: {
      ...mockProfile.personal_info,
      password: "SuperSecretPassword123",
      ssn: "123-45-6789",
      credit_card: "4111111111111111",
    },
  };

  const minimized = background.minimizeProfileForAI(profileWithSecrets);
  assert.strictEqual(minimized.personal_info.password, undefined);
  assert.strictEqual(minimized.personal_info.ssn, undefined);
  assert.strictEqual(minimized.personal_info.credit_card, undefined);
  assert.strictEqual(minimized.personal_info.name, "Alex Morgan");
});

it("should sanitize error messages to prevent API key leaks", () => {
  const rawErr = "Failed to query URL https://generativelanguage.googleapis.com?key=AIzaSyA1234567890XYZ with status 400";
  const sanitized = background.sanitizeErrorMessage(rawErr);
  assert(!sanitized.includes("AIzaSyA1234567890XYZ"), "Must redact API key");
  assert(sanitized.includes("[REDACTED_API_KEY]") || sanitized.includes("[REDACTED]"), "Must show redacted placeholder");
});

// 6. Work Authorization, Sponsorship & Notice Period Tests
it("should match work authorization, sponsorship, and notice period", () => {
  const authField = { id: "f20", matchType: "text", label: "Are you authorized to work in the US?" };
  assert.strictEqual(rules.jobfillMatchField(authField, mockProfile), "Authorized to work in US without sponsorship");

  const sponsorField = { id: "f21", matchType: "text", label: "Will you now or in the future require visa sponsorship?" };
  assert.strictEqual(rules.jobfillMatchField(sponsorField, mockProfile), "No");

  const noticeField = { id: "f22", matchType: "text", label: "What is your earliest availability or notice period?" };
  assert.strictEqual(rules.jobfillMatchField(noticeField, mockProfile), "2 weeks");
});

// 7. Sensitive Fields Exclusion Regex Test
it("should identify sensitive fields that should never be saved to learning memory", () => {
  const sensitiveLabels = [
    "Enter your Password",
    "Social Security Number (SSN)",
    "Confirm Account PIN",
    "Credit Card Number",
    "CVV / CVC Security Code",
    "Bank Account Number",
    "Mother's Maiden Name (Secret question)",
  ];

  const sensitivePattern = /password|passcode|ssn|social\s*security|pin\b|credit\s*card|debit\s*card|cvv|cvc|bank\s*account|routing|security\s*code|secret/i;

  for (const label of sensitiveLabels) {
    assert(sensitivePattern.test(label), `Should flag "${label}" as sensitive`);
  }

  const safeLabels = [
    "What is your target salary?",
    "Why are you interested in this role?",
    "Describe your experience with React",
    "Are you willing to relocate?",
  ];

  for (const label of safeLabels) {
    assert(!sensitivePattern.test(label), `Should NOT flag safe label "${label}"`);
  }
});

// 8. Dropdown Select Option Intelligent Matching Tests
it("should match select dropdown options intelligently", () => {
  // Country dropdown
  const countryField = {
    id: "sel_country",
    matchType: "select",
    label: "Country of Residence",
    options: ["Canada", "Mexico", "United States", "United Kingdom"],
  };
  assert.strictEqual(
    rules.jobfillMatchSelectOption(countryField, mockProfile),
    "United States",
    "Should match United States"
  );

  // Visa sponsorship dropdown
  const sponsorField = {
    id: "sel_sponsor",
    matchType: "select",
    label: "Will you now or in the future require visa sponsorship?",
    options: [
      "-- Select an option --",
      "Yes, I will require sponsorship",
      "No, I will not require visa sponsorship",
    ],
  };
  assert.strictEqual(
    rules.jobfillMatchSelectOption(sponsorField, mockProfile),
    "No, I will not require visa sponsorship",
    "Should select the negative sponsorship option"
  );

  // Gender dropdown
  const genderField = {
    id: "sel_gender",
    matchType: "select",
    label: "Gender Identity",
    options: ["Please select", "Female", "Male", "Non-Binary", "Decline to state"],
  };
  assert.strictEqual(
    rules.jobfillMatchSelectOption(genderField, mockProfile),
    "Non-Binary",
    "Should match candidate gender"
  );

  // Job Referral Source dropdown
  const sourceField = {
    id: "sel_source",
    matchType: "select",
    label: "How did you hear about this position?",
    options: ["Indeed", "Company Website", "LinkedIn", "Referral", "Other"],
  };
  assert.strictEqual(
    rules.jobfillMatchSelectOption(sourceField, mockProfile),
    "LinkedIn",
    "Should match default job source"
  );

  // Highest Degree dropdown
  const degreeField = {
    id: "sel_degree",
    matchType: "select",
    label: "Highest Level of Education Completed",
    options: ["High School", "Associate Degree", "Bachelor's Degree", "Master's Degree", "Doctorate"],
  };
  assert.strictEqual(
    rules.jobfillMatchSelectOption(degreeField, mockProfile),
    "Bachelor's Degree",
    "Should match Bachelor's degree from B.S. in Computer Science"
  );
});

// 9. Radio Button Group Matching Tests
it("should match radio button groups to the correct option", () => {
  // Sponsorship radio group
  const sponsorRadio = {
    id: "jobfill-group-sponsorship",
    matchType: "radio-group",
    groupQuestion: "Will you now or in the future require visa sponsorship?",
    options: [
      { id: "opt_yes", label: "Yes", value: "yes" },
      { id: "opt_no", label: "No", value: "no" },
    ],
  };
  const matchedSponsor = rules.jobfillMatchRadioGroup(sponsorRadio, mockProfile);
  assert.ok(matchedSponsor, "Should find matching radio option");
  assert.strictEqual(matchedSponsor.id, "opt_no", "Should select No for sponsorship");

  // Relocation radio group
  const relocateRadio = {
    id: "jobfill-group-relocate",
    matchType: "radio-group",
    groupQuestion: "Are you willing to relocate for this position?",
    options: [
      { id: "rel_yes", label: "Yes, I am open to relocating", value: "yes" },
      { id: "rel_no", label: "No, remote only", value: "no" },
    ],
  };
  const matchedRelocate = rules.jobfillMatchRadioGroup(relocateRadio, mockProfile);
  assert.ok(matchedRelocate, "Should find relocation radio");
  assert.strictEqual(matchedRelocate.id, "rel_yes", "Should select Yes for relocation");

  // Work Authorization radio group
  const authRadio = {
    id: "jobfill-group-auth",
    matchType: "radio-group",
    groupQuestion: "Are you legally authorized to work in the country of this role?",
    options: [
      { id: "auth_yes", label: "Yes, I am authorized", value: "yes" },
      { id: "auth_no", label: "No, I am not authorized", value: "no" },
    ],
  };
  const matchedAuth = rules.jobfillMatchRadioGroup(authRadio, mockProfile);
  assert.ok(matchedAuth, "Should find authorization radio");
  assert.strictEqual(matchedAuth.id, "auth_yes", "Should select Yes for authorization");
});

// 10. Date Formatting Tests
it("should format dates cleanly for date and month inputs", () => {
  assert.strictEqual(rules.jobfillFormatDate("2026-10-15", "date"), "2026-10-15");
  assert.strictEqual(rules.jobfillFormatDate("2026-10-15", "month"), "2026-10");
  assert.strictEqual(rules.jobfillFormatDate("2025", "date"), "2025-05-01");
  assert.strictEqual(rules.jobfillFormatDate("2025", "month"), "2025-05");
});

// 11. Profile Photo and Resume Field Type Detection Tests
it("should distinguish profile photos and resumes for file inputs", () => {
  const photoPatterns = /photo|picture|avatar|headshot|portrait|candidate\s*image|profile\s*image/i;
  const resumePatterns = /resume|cv|curriculum\s*vitae/i;

  const photoLabels = [
    "Upload Profile Photo",
    "Candidate Picture",
    "Upload Headshot (JPG/PNG)",
    "Avatar Image",
    "Applicant Photo",
  ];

  for (const label of photoLabels) {
    assert(photoPatterns.test(label), `"${label}" should be detected as photo`);
    assert(!resumePatterns.test(label), `"${label}" should NOT be detected as resume`);
  }

  const resumeLabels = [
    "Upload Resume",
    "Attach CV",
    "Curriculum Vitae",
    "Resume / CV (PDF)",
  ];

  for (const label of resumeLabels) {
    assert(resumePatterns.test(label), `"${label}" should be detected as resume`);
  }
});

// 12. ATS & Workday Compatibility Tests
it("should match Workday automation IDs and common ATS screening questions", () => {
  // Workday automation ID matching
  const wdFirst = { id: "wd1", matchType: "text", label: "legalnamesection_firstname" };
  assert.strictEqual(rules.jobfillMatchField(wdFirst, mockProfile), "Alex", "Should match Workday first name automation ID");

  const wdLast = { id: "wd2", matchType: "text", label: "legalnamesection_lastname" };
  assert.strictEqual(rules.jobfillMatchField(wdLast, mockProfile), "Morgan", "Should match Workday last name automation ID");

  const wdCity = { id: "wd3", matchType: "text", label: "addresssection_city" };
  assert.strictEqual(rules.jobfillMatchField(wdCity, mockProfile), "San Francisco", "Should match Workday city automation ID");

  const wdZip = { id: "wd4", matchType: "text", label: "addresssection_postalcode" };
  assert.strictEqual(rules.jobfillMatchField(wdZip, mockProfile), "94105", "Should match Workday postal code automation ID");

  // Common ATS screening questions
  const prevEmp = { id: "s1", matchType: "text", label: "Have you previously worked or been employed by our company?" };
  assert.strictEqual(rules.jobfillMatchField(prevEmp, mockProfile), "No");

  const relatives = { id: "s2", matchType: "text", label: "Do you have any relatives or family members employed here?" };
  assert.strictEqual(rules.jobfillMatchField(relatives, mockProfile), "No");

  const nonCompete = { id: "s3", matchType: "text", label: "Are you subject to any active non-compete or restrictive covenant?" };
  assert.strictEqual(rules.jobfillMatchField(nonCompete, mockProfile), "No");

  const bgConsent = { id: "s4", matchType: "text", label: "Do you consent to a standard pre-employment background check?" };
  assert.strictEqual(rules.jobfillMatchField(bgConsent, mockProfile), "Yes");

  const latinoQ = { id: "s5", matchType: "text", label: "Are you Hispanic or Latino?" };
  assert.strictEqual(rules.jobfillMatchField(latinoQ, mockProfile), "No");
});

console.log("==========================================");
console.log(` Summary: ${passed}/${total} tests passed!`);
console.log("==========================================");

if (passed !== total) {
  process.exit(1);
}

