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

  return [
    { patterns: [/first\s*name|given\s*name/i], get: () => firstName },
    { patterns: [/last\s*name|family\s*name|surname/i], get: () => lastName },
    {
      patterns: [/full\s*name|^name$|your\s*name|applicant\s*name|candidate\s*name/i],
      get: () => personal.name,
    },
    { patterns: [/e-?mail/i], get: () => personal.email },
    {
      patterns: [/portfolio|personal\s*site|website|personal\s*url/i],
      get: () => personal.website,
    },
    {
      patterns: [/^city$|current\s*location|based\s*in|^location$|where\s*are\s*you\s*located/i],
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
      get: () => latestEducation.duration,
    },
    { patterns: [/cgpa|gpa|percentage|grade/i], get: () => latestEducation.grade },
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
  "textarea-short",
]);

function jobfillMatchField(field, profile) {
  if (!JOBFILL_RULE_ELIGIBLE_TYPES.has(field.matchType)) return null;
  const label = (field.label || "").trim();
  if (!label) return null;
  const rules = jobfillBuildRules(profile);
  for (const rule of rules) {
    if (rule.patterns.some((re) => re.test(label))) {
      const value = rule.get();
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value);
      }
    }
  }
  return null;
}
