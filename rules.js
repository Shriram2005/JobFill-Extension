// rules.js — local, zero-cost matching between a form field's label and a
// value from the user's profile.json. This runs BEFORE any API call; only
// fields that fail every rule here get sent to Gemini. Extend RULES freely —
// each entry is just { patterns: [RegExp...], get: profile => value }.

function jobfillGetLatest(list) {
  if (!Array.isArray(list) || list.length === 0) return {};
  // Prefer an entry whose duration says "Present"; otherwise the first one
  // (profiles conventionally list most-recent first).
  const present = list.find(
    (item) => typeof item.duration === "string" && /present/i.test(item.duration)
  );
  return present || list[0];
}

function jobfillBuildRules(profile) {
  const personal = profile.personal_info || {};
  const nameParts = String(personal.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const latestExperience = jobfillGetLatest(profile.experience);
  const latestEducation = jobfillGetLatest(profile.education);
  const techSkills = (profile.skills && profile.skills.technologies) || [];
  const coreSkills = (profile.skills && profile.skills.core_competencies) || [];

  // Parse location components if not provided separately
  const locParts = String(personal.location || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const city = personal.city || (locParts.length > 0 ? locParts[0] : "");
  const state = personal.state || (locParts.length > 2 ? locParts[1] : (locParts.length === 2 ? locParts[1] : ""));
  const country = personal.country || (locParts.length >= 3 ? locParts[locParts.length - 1] : "");

  // Extract a clean 4-digit graduation year from education duration
  const gradYearMatches = String(latestEducation.duration || "").match(/\b(19\d\d|20\d\d)\b/g);
  const gradYear = gradYearMatches ? gradYearMatches[gradYearMatches.length - 1] : latestEducation.duration;

  const phone = personal.phone || personal.mobile || personal.tel || personal.contact || profile.phone || "";
  const linkedin = personal.linkedin || personal.linkedin_url || profile.linkedin || "";
  const github = personal.github || personal.github_url || profile.github || "";

  return [
    { patterns: [/first\s*name|given\s*name|^fname$/i], get: () => firstName },
    { patterns: [/last\s*name|family\s*name|surname|^lname$/i], get: () => lastName },
    {
      patterns: [/full\s*name|^name$|your\s*name|applicant\s*name|candidate\s*name/i],
      get: () => personal.name,
    },
    { patterns: [/e-?mail/i], get: () => personal.email },
    {
      patterns: [/phone|mobile|cell|telephone|contact\s*number/i],
      get: () => phone,
    },
    {
      patterns: [/linkedin|linked-in/i],
      get: () => linkedin,
    },
    {
      patterns: [/github|git-hub/i],
      get: () => github,
    },
    {
      patterns: [/portfolio|personal\s*site|website|personal\s*url/i],
      get: () => personal.website,
    },
    {
      patterns: [/^city$|current\s*city/i],
      get: () => city,
    },
    {
      patterns: [/^state$|^province$|^region$/i],
      get: () => state,
    },
    {
      patterns: [/^country$/i],
      get: () => country,
    },
    {
      patterns: [/zip(\s*code)?|postal(\s*code)?/i],
      get: () => personal.zip || personal.postal_code || "",
    },
    {
      patterns: [/^address(\s*line\s*1)?|street\s*address/i],
      get: () => personal.address || personal.location,
    },
    {
      patterns: [/current\s*location|based\s*in|^location$|where\s*are\s*you\s*located/i],
      get: () => personal.location,
    },
    {
      patterns: [/current\s*title|headline|professional\s*title/i],
      get: () => personal.title,
    },
    {
      patterns: [/summary|about\s*you|^bio$|profile\s*summary|objective/i],
      get: () => profile.summary,
    },
    {
      patterns: [/years?\s*of\s*experience|total\s*experience/i],
      get: () => profile.stats && profile.stats.years_experience,
    },
    {
      patterns: [/current\s*(employer|company)|company\s*name|most\s*recent\s*employer/i],
      get: () => latestExperience.company,
    },
    {
      patterns: [/current\s*(role|position|job\s*title)|most\s*recent\s*(role|title)/i],
      get: () => latestExperience.role,
    },
    {
      patterns: [/skills|technologies|tech\s*stack/i],
      get: () => techSkills.concat(coreSkills).join(", "),
    },
    { patterns: [/degree|qualification/i], get: () => latestEducation.degree },
    {
      patterns: [/university|college|institution|school\s*name/i],
      get: () => latestEducation.institution,
    },
    {
      patterns: [/graduation\s*year|year\s*of\s*passing|graduation\s*date/i],
      get: () => gradYear,
    },
    { patterns: [/\bcgpa\b|\bgpa\b|\bpercentage\b|academic\s*grade/i], get: () => latestEducation.grade },
  ];
}

// Only plain, single-value text-ish inputs are attempted here. Selects,
// radios, checkboxes, and long-form textareas are always routed to Gemini
// (rules.js can't safely guess among arbitrary option sets or write prose).
const JOBFILL_RULE_ELIGIBLE_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "search",
  "number",
  "textarea-short",
]);

// Map HTML5 autocomplete attributes to profile extraction
function jobfillMatchAutocomplete(field, profile) {
  const ac = (field.autocomplete || "").trim().toLowerCase();
  if (!ac) return null;

  const personal = profile.personal_info || {};
  const nameParts = String(personal.name || "").trim().split(/\s+/);
  const latestExperience = jobfillGetLatest(profile.experience);

  const locParts = String(personal.location || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const city = personal.city || (locParts.length > 0 ? locParts[0] : "");
  const state = personal.state || (locParts.length > 2 ? locParts[1] : (locParts.length === 2 ? locParts[1] : ""));
  const country = personal.country || (locParts.length >= 3 ? locParts[locParts.length - 1] : "");

  switch (ac) {
    case "given-name":
      return nameParts[0] || "";
    case "family-name":
      return nameParts.slice(1).join(" ") || "";
    case "name":
      return personal.name || "";
    case "email":
      return personal.email || "";
    case "tel":
    case "tel-national":
      return personal.phone || personal.mobile || personal.tel || "";
    case "url":
      return personal.website || "";
    case "organization":
      return latestExperience.company || "";
    case "organization-title":
      return latestExperience.role || "";
    case "address-level2":
      return city;
    case "address-level1":
      return state;
    case "country":
    case "country-name":
      return country;
    case "postal-code":
      return personal.zip || personal.postal_code || "";
    case "street-address":
    case "address-line1":
      return personal.address || personal.location || "";
    default:
      return null;
  }
}

function jobfillMatchField(field, profile) {
  if (!JOBFILL_RULE_ELIGIBLE_TYPES.has(field.matchType)) return null;

  // 1. Try HTML5 autocomplete first
  const acValue = jobfillMatchAutocomplete(field, profile);
  if (acValue !== null && acValue !== undefined && String(acValue).trim() !== "") {
    return String(acValue);
  }

  // 2. Try text pattern rules against label, then placeholder, then name/id
  const rules = jobfillBuildRules(profile);
  const candidateTexts = [
    (field.label || "").trim(),
    (field.placeholder || "").trim(),
    (field.name || "").trim(),
    (field.id || "").replace(/^jobfill-\d+$/, "").trim()
  ].filter(Boolean);

  for (const text of candidateTexts) {
    for (const rule of rules) {
      if (rule.patterns.some((re) => re.test(text))) {
        const value = rule.get();
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return String(value);
        }
      }
    }
  }

  return null;
}
