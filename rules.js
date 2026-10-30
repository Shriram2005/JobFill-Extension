// rules.js — local, zero-cost matching between a form field's label and a
// value from the user's profile. This runs BEFORE any API call; only
// fields that fail every rule here get sent to Gemini.

function jobfillGetLatest(list) {
  if (!Array.isArray(list) || list.length === 0) return {};
  // Prefer an entry whose duration says "Present"; otherwise the first one
  // (profiles conventionally list most-recent first).
  const present = list.find(
    (item) => typeof item.duration === "string" && /present/i.test(item.duration)
  );
  return present || list[0];
}

function jobfillNormalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[*:\(\)\[\]_#\?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jobfillBuildRules(profile) {
  if (!profile || typeof profile !== "object") return [];
  const personal = profile.personal_info || {};
  const nameParts = String(personal.name || "").trim().split(/\s+/);
  const firstName = personal.first_name || nameParts[0] || "";
  const lastName = personal.last_name || nameParts.slice(1).join(" ") || "";
  const latestExperience = jobfillGetLatest(profile.experience);
  const latestEducation = jobfillGetLatest(profile.education);
  const techSkills = (profile.skills && profile.skills.technologies) || [];
  const coreSkills = (profile.skills && profile.skills.core_competencies) || [];

  // Parse location components
  const locParts = String(personal.location || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const city = personal.city || (locParts.length > 0 ? locParts[0] : "");
  const state = personal.state || (locParts.length > 2 ? locParts[1] : (locParts.length === 2 ? locParts[1] : ""));
  const country = personal.country || (locParts.length >= 3 ? locParts[locParts.length - 1] : "");

  // Extract clean 4-digit graduation year
  const gradYearMatches = String(latestEducation.duration || "").match(/\b(19\d\d|20\d\d)\b/g);
  const gradYear = personal.graduation_year || (gradYearMatches ? gradYearMatches[gradYearMatches.length - 1] : latestEducation.duration || "");

  const phone = personal.phone || personal.mobile || personal.tel || personal.contact || profile.phone || "";
  const linkedin = personal.linkedin || personal.linkedin_url || profile.linkedin || "";
  const github = personal.github || personal.github_url || profile.github || "";
  const portfolio = personal.website || personal.portfolio || personal.portfolio_url || "";
  const workAuth = personal.work_authorization || "Yes";
  const sponsorship = personal.sponsorship_required || "No";
  const noticePeriod = personal.notice_period || "2 weeks";

  return [
    // Names
    {
      patterns: [/first\s*name|given\s*name|^fname$|legalnamesection[\s_]*firstname/i],
      get: () => firstName,
    },
    {
      patterns: [/last\s*name|family\s*name|surname|^lname$|legalnamesection[\s_]*lastname/i],
      get: () => lastName,
    },
    {
      patterns: [/full\s*name|^name$|your\s*name|applicant\s*name|candidate\s*name|legal\s*name/i],
      get: () => personal.name || `${firstName} ${lastName}`.trim(),
    },
    {
      patterns: [/preferred\s*name|nickname|goes\s*by/i],
      get: () => personal.preferred_name || firstName,
    },

    // Contact
    {
      patterns: [/e-?mail|email\s*address/i],
      get: () => personal.email,
    },
    {
      patterns: [/phone|mobile|cell|telephone|contact\s*number|phone\s*number/i],
      get: () => phone,
    },

    // Social & Links
    {
      patterns: [/linkedin|linked-in|linkedin\s*profile|linkedin\s*url/i],
      get: () => linkedin,
    },
    {
      patterns: [/github|git-hub|github\s*profile|github\s*url/i],
      get: () => github,
    },
    {
      patterns: [/portfolio|personal\s*site|personal\s*website|personal\s*url|homepage/i],
      get: () => portfolio,
    },
    {
      patterns: [/twitter|x\s*handle|x\s*profile/i],
      get: () => personal.twitter || "",
    },

    // Location & Address
    {
      patterns: [/^city$|current\s*city|addresssection[\s_]*city/i],
      get: () => city,
    },
    {
      patterns: [/^state$|^province$|^region$|state\s*\/\s*province|addresssection[\s_]*countryregion/i],
      get: () => state,
    },
    {
      patterns: [/^country$|country\s*of\s*residence|addresssection[\s_]*country/i],
      get: () => country,
    },
    {
      patterns: [/zip(\s*code)?|postal(\s*code)?|pincode|postcode|addresssection[\s_]*postalcode/i],
      get: () => personal.zip || personal.postal_code || "",
    },
    {
      patterns: [/^address(\s*line\s*1)?|street\s*address|residential\s*address|addresssection[\s_]*addressline1/i],
      get: () => personal.address || personal.location,
    },
    {
      patterns: [/current\s*location|based\s*in|^location$|where\s*are\s*you\s*located/i],
      get: () => personal.location,
    },

    // Professional Headline & Summary
    {
      patterns: [/current\s*title|headline|professional\s*title|desired\s*title/i],
      get: () => personal.title,
    },
    {
      patterns: [/summary|about\s*you|^bio$|profile\s*summary|professional\s*summary|objective/i],
      get: () => profile.summary,
    },
    {
      patterns: [/years?\s*of\s*experience|total\s*experience|experience\s*years/i],
      get: () => profile.stats && profile.stats.years_experience,
    },

    // Current / Latest Job Experience
    {
      patterns: [/current\s*(employer|company)|company\s*name|most\s*recent\s*employer|latest\s*company/i],
      get: () => latestExperience.company,
    },
    {
      patterns: [/current\s*(role|position|job\s*title)|most\s*recent\s*(role|title)|latest\s*role/i],
      get: () => latestExperience.role,
    },

    // Skills
    {
      patterns: [/skills|technologies|tech\s*stack|programming\s*languages|key\s*skills/i],
      get: () => {
        const combined = [...techSkills, ...coreSkills];
        return combined.filter(Boolean).join(", ");
      },
    },

    // Education
    {
      patterns: [/degree|qualification|highest\s*degree|level\s*of\s*education/i],
      get: () => latestEducation.degree,
    },
    {
      patterns: [/major|field\s*of\s*study|discipline|area\s*of\s*study/i],
      get: () => latestEducation.field_of_study || latestEducation.major || latestEducation.degree,
    },
    {
      patterns: [/university|college|institution|school\s*name/i],
      get: () => latestEducation.institution,
    },
    {
      patterns: [/graduation\s*year|year\s*of\s*passing|graduation\s*date|grad\s*year/i],
      get: () => gradYear,
    },
    {
      patterns: [/\bcgpa\b|\bgpa\b|\bpercentage\b|academic\s*grade/i],
      get: () => latestEducation.grade,
    },

    // Work Authorization & Logistics
    {
      patterns: [/authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|work\s*authorization/i],
      get: () => workAuth,
    },
    {
      patterns: [/require\s*sponsorship|visa\s*sponsorship|sponsorship\s*now\s*or\s*in\s*the\s*future/i],
      get: () => sponsorship,
    },
    {
      patterns: [/notice\s*period|availability|how\s*soon\s*can\s*you\s*start|earliest\s*start\s*date/i],
      get: () => noticePeriod,
    },
    {
      patterns: [/willing(ness)?\s*to\s*relocate|open\s*to\s*relocat|relocat/i],
      get: () => personal.willing_to_relocate || "Yes",
    },
    {
      patterns: [/remote\s*work|work\s*remotely|comfortable\s*working\s*remotely|hybrid\s*work/i],
      get: () => personal.remote_preference || "Yes",
    },
    {
      patterns: [/18\s*(years|years\s*of\s*age|or\s*older)|legal\s*age|at\s*least\s*18/i],
      get: () => "Yes",
    },
    {
      patterns: [/certify|terms\s*(and|&)\s*conditions|truthful|consent\s*to|acknowledge\s*that|privacy\s*policy|electronic\s*signature\s*consent/i],
      get: () => "Yes",
    },
    {
      patterns: [/start\s*date|available\s*from|earliest\s*date/i],
      get: () => personal.start_date || "Immediately",
    },

    // Demographics & Diversity (EEO)
    {
      patterns: [/^gender$|^sex$|gender\s*identity/i],
      get: () => personal.gender || "Male",
    },
    {
      patterns: [/pronoun/i],
      get: () => personal.pronouns || (personal.gender === "Female" ? "She/Her" : "He/Him"),
    },
    {
      patterns: [/veteran\s*status|protected\s*veteran|military\s*status|armed\s*forces/i],
      get: () => personal.veteran_status || "I am not a protected veteran",
    },
    {
      patterns: [/disability\s*status|physical\s*or\s*mental\s*impairment|individual\s*with\s*a\s*disability/i],
      get: () => personal.disability_status || "No, I do not have a disability",
    },
    // Specific Hispanic / Latino Yes-No Question (Workday / Taleo EEO)
    {
      patterns: [/hispanic\s*(or|\/)\s*latino|are\s*you\s*hispanic/i],
      get: () => (/hispanic|latino/i.test(personal.race_ethnicity || "") ? "Yes" : "No"),
    },
    // General Race / Ethnicity Selection
    {
      patterns: [/race|ethnicity|demographic/i],
      get: () => personal.race_ethnicity || "Asian",
    },
    {
      patterns: [/how\s*did\s*you\s*hear|source|referral\s*source|found\s*out\s*about\s*this/i],
      get: () => personal.job_source || "LinkedIn",
    },
    // Common ATS Screening Questions
    {
      patterns: [/previously\s*(worked|employed)|prior\s*employment\s*with|former\s*employee/i],
      get: () => "No",
    },
    {
      patterns: [/relatives?.*(employed|working)|family\s*members?.*(employed|working)|relative.*employed/i],
      get: () => "No",
    },
    {
      patterns: [/non-?compete|non-?solicitation|restrictive\s*covenant/i],
      get: () => "No",
    },
    {
      patterns: [/background\s*check|drug\s*(test|screen)|screening\s*consent/i],
      get: () => "Yes",
    },
    {
      patterns: [/felony|criminal\s*conviction|convicted\s*of\s*a\s*crime/i],
      get: () => "No",
    },
    {
      patterns: [/country\s*code|dial(ing)?\s*code|phone\s*code/i],
      get: () => {
        const m = String(phone).match(/^\+(\d{1,4})/);
        return m ? `+${m[1]}` : "+91";
      },
    },
  ];
}

var JOBFILL_RULE_ELIGIBLE_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "search",
  "number",
  "date",
  "month",
  "textarea-short",
  "select",
  "radio",
  "checkbox",
]);

// Map HTML5 autocomplete attributes to profile extraction
function jobfillMatchAutocomplete(field, profile) {
  if (!field || !profile) return null;
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
      return personal.first_name || nameParts[0] || "";
    case "family-name":
      return personal.last_name || nameParts.slice(1).join(" ") || "";
    case "name":
      return personal.name || "";
    case "nickname":
      return personal.preferred_name || nameParts[0] || "";
    case "email":
      return personal.email || "";
    case "tel":
    case "tel-national":
      return personal.phone || personal.mobile || personal.tel || "";
    case "tel-country-code":
      const m = String(personal.phone || "").match(/^\+(\d{1,4})/);
      return m ? `+${m[1]}` : "+91";
    case "url":
      return personal.website || personal.portfolio || "";
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
    case "address-line2":
      return personal.address2 || "";
    case "sex":
      return personal.gender || "Male";
    default:
      return null;
  }
}

function jobfillMatchField(field, profile) {
  if (!field || !profile) return null;
  if (!JOBFILL_RULE_ELIGIBLE_TYPES.has(field.matchType)) return null;

  // 1. Try HTML5 autocomplete first
  const acValue = jobfillMatchAutocomplete(field, profile);
  if (acValue !== null && acValue !== undefined && String(acValue).trim() !== "") {
    return String(acValue);
  }

  // 2. Try normalized text pattern rules against label, then placeholder, then name/id
  const rules = jobfillBuildRules(profile);
  const rawTexts = [
    (field.label || "").trim(),
    (field.placeholder || "").trim(),
    (field.name || "").trim(),
    (field.id || "").replace(/^jobfill-\d+$/, "").trim()
  ].filter(Boolean);

  for (const rawText of rawTexts) {
    const normalized = jobfillNormalizeText(rawText);
    for (const rule of rules) {
      if (rule.patterns.some((re) => re.test(rawText) || re.test(normalized))) {
        const value = rule.get();
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return String(value);
        }
      }
    }
  }

  return null;
}

/**
 * Intelligent dropdown option matching.
 * Compares candidate profile attributes against an array of dropdown option texts.
 */
function jobfillMatchSelectOption(field, profile) {
  if (!field || !profile || !Array.isArray(field.options) || field.options.length === 0) {
    return null;
  }

  const targetVal = jobfillMatchField({ ...field, matchType: "text" }, profile);
  if (!targetVal || String(targetVal).trim() === "") return null;

  const targetStr = String(targetVal).trim();
  const targetLower = targetStr.toLowerCase();

  const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // 1. Exact string match (case-insensitive)
  let found = field.options.find((opt) => opt.trim().toLowerCase() === targetLower);
  if (found) return found;

  // 2. Alphanumeric normalized match
  const targetClean = clean(targetStr);
  found = field.options.find((opt) => clean(opt) === targetClean);
  if (found) return found;

  // 3. Boolean / Authorization / Sponsorship / Status synonyms
  const isYesTarget =
    /^(yes|true|y|1)$/i.test(targetStr) ||
    /authorized|eligible|citizen|permanent\s*resident/i.test(targetStr);
  const isNoTarget =
    /^(no|false|n|0)$/i.test(targetStr) ||
    /not\s*(authorized|eligible|required)|no\s*sponsorship/i.test(targetStr);

  if (isYesTarget) {
    found = field.options.find((opt) => {
      const oLower = opt.toLowerCase().trim();
      return (
        /^(yes|true|y|1)$/i.test(oLower) ||
        oLower.startsWith("yes") ||
        oLower.includes("authorized") ||
        oLower.includes("eligible") ||
        oLower.includes("citizen") ||
        oLower.includes("permanent resident")
      );
    });
    if (found) return found;
  }

  if (isNoTarget) {
    found = field.options.find((opt) => {
      const oLower = opt.toLowerCase().trim();
      return (
        /^(no|false|n|0)$/i.test(oLower) ||
        oLower.startsWith("no") ||
        oLower.includes("not require") ||
        oLower.includes("will not require") ||
        oLower.includes("no sponsorship")
      );
    });
    if (found) return found;
  }

  // 4. Gender / Demographic synonyms
  if (/^male$/i.test(targetStr)) {
    found = field.options.find((opt) => /^(male|man|he\/him)$/i.test(opt.trim()));
    if (found) return found;
  }
  if (/^female$/i.test(targetStr)) {
    found = field.options.find((opt) => /^(female|woman|she\/her)$/i.test(opt.trim()));
    if (found) return found;
  }
  if (/not.*veteran/i.test(targetStr)) {
    found = field.options.find(
      (opt) =>
        /not\s*(a\s*)?(protected\s*)?veteran|^no$/i.test(opt.trim()) ||
        opt.toLowerCase().includes("not a protected veteran") ||
        opt.toLowerCase().includes("not a veteran")
    );
    if (found) return found;
  }
  if (/no.*disability/i.test(targetStr)) {
    found = field.options.find(
      (opt) =>
        /no.*disability|^no$/i.test(opt.trim()) ||
        opt.toLowerCase().includes("don't have a disability") ||
        opt.toLowerCase().includes("do not have a disability")
    );
    if (found) return found;
  }

  // 5. Degree / Education level synonyms
  if (/\b(b\.?s\.?|b\.?a\.?|b\.?tech|b\.?e\.?|bachelor)\b/i.test(targetStr)) {
    found = field.options.find((opt) => /bachelor/i.test(opt));
    if (found) return found;
  }
  if (/\b(m\.?s\.?|m\.?a\.?|m\.?tech|mba|master)\b/i.test(targetStr)) {
    found = field.options.find((opt) => /master/i.test(opt));
    if (found) return found;
  }
  if (/\b(ph\.?d\.?|doctor|doctorate)\b/i.test(targetStr)) {
    found = field.options.find((opt) => /doctor|ph\.?d/i.test(opt));
    if (found) return found;
  }
  if (/\b(associate)\b/i.test(targetStr)) {
    found = field.options.find((opt) => /associate/i.test(opt));
    if (found) return found;
  }

  // 6. Dial Code matching (e.g. "+91" matching "India (+91)" or "+91 (India)")
  if (/^\+\d+/.test(targetStr)) {
    found = field.options.find((opt) => opt.includes(targetStr));
    if (found) return found;
  }

  // 7. Substring containment
  if (targetLower.length >= 3) {
    found = field.options.find((opt) => {
      const oLower = opt.toLowerCase().trim();
      if (/^(select|choose|please select|--|none$)/i.test(oLower)) return false;
      return oLower.includes(targetLower) || targetLower.includes(oLower);
    });
    if (found) return found;
  }

  return null;
}

/**
 * Intelligent radio button group matching.
 * Matches a question and group of radio options to the best choice.
 */
function jobfillMatchRadioGroup(field, profile) {
  if (!field || !profile || !Array.isArray(field.options) || field.options.length === 0) {
    return null;
  }

  const questionLabel = field.groupQuestion || field.label || "";
  const targetVal = jobfillMatchField(
    { ...field, label: questionLabel, matchType: "text" },
    profile
  );
  if (!targetVal || String(targetVal).trim() === "") return null;

  const targetStr = String(targetVal).trim();
  const targetLower = targetStr.toLowerCase();

  const isYesTarget =
    /^(yes|true|y|1)$/i.test(targetStr) ||
    /authorized|eligible|citizen|permanent\s*resident/i.test(targetStr);
  const isNoTarget =
    /^(no|false|n|0)$/i.test(targetStr) ||
    /not\s*(authorized|eligible|required)|no\s*sponsorship/i.test(targetStr);

  for (const opt of field.options) {
    const optLabel = String(opt.label || "").trim().toLowerCase();
    const optVal = String(opt.value || "").trim().toLowerCase();

    if (isYesTarget) {
      if (
        /^(yes|true|y|1|agree|authorized)$/i.test(optVal) ||
        /^(yes|true|y|1|agree|authorized)$/i.test(optLabel) ||
        optLabel.startsWith("yes") ||
        optLabel.includes("authorized") ||
        optVal.includes("authorized")
      ) {
        return opt;
      }
    } else if (isNoTarget) {
      if (
        /^(no|false|n|0|disagree)$/i.test(optVal) ||
        /^(no|false|n|0|disagree)$/i.test(optLabel) ||
        optLabel.startsWith("no") ||
        optLabel.includes("not require") ||
        optLabel.includes("do not require")
      ) {
        return opt;
      }
    } else {
      if (
        optLabel === targetLower ||
        optVal === targetLower ||
        (targetLower.length >= 3 && (optLabel.includes(targetLower) || targetLower.includes(optLabel)))
      ) {
        return opt;
      }
    }
  }

  return null;
}

/**
 * Formats dates for standard HTML5 date and month inputs.
 */
function jobfillFormatDate(val, matchType) {
  if (!val) return "";
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return matchType === "month" ? s.slice(0, 7) : s;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    return matchType === "date" ? `${s}-01` : s;
  }
  if (/^\d{4}$/.test(s)) {
    return matchType === "month" ? `${s}-05` : `${s}-05-01`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return matchType === "month" ? `${yyyy}-${mm}` : `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

// Support Node.js testing environment if imported
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    jobfillGetLatest,
    jobfillNormalizeText,
    jobfillBuildRules,
    jobfillMatchAutocomplete,
    jobfillMatchField,
    jobfillMatchSelectOption,
    jobfillMatchRadioGroup,
    jobfillFormatDate,
    JOBFILL_RULE_ELIGIBLE_TYPES,
  };
}

