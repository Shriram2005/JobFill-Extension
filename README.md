# JobFill

A Chrome extension that fills job application forms from your `profile.json`.
It matches obvious fields locally for free, asks Gemini only for what's left,
and **never submits anything for you.**

## Install (unpacked, for personal use)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `jobfill-extension` folder.
4. The "J_" icon appears in your toolbar.

## Set up

1. Click the toolbar icon → **Profile & API key settings** (or right-click the
   icon → Options).
2. **API key**: paste your Gemini API key, click **Save key**, then
   **Test key** to confirm it works. The key is stored only in this browser's
   local extension storage (`chrome.storage.local`) — it is never bundled
   into code, synced anywhere, or sent anywhere except directly to
   `generativelanguage.googleapis.com`.
3. **Profile**: click **Choose file** and select your `profile.json`
   (`sample-profile.json` in this folder is your actual file, already in the
   right shape — upload that one, or your latest version of it), then
   **Save profile**.
4. **Models**: defaults are already sensible — Flash for field mapping,
   Pro for written answers — but you can change either in this screen at
   any time.

## Use it

1. Open an actual job application page (Greenhouse and Lever postings are
   good first tests — they're common, fairly standardized ATS platforms).
2. Click the toolbar icon → **Fill this application**.
3. Watch the small status badge that appears in the bottom-right of the page
   — it reports what it's doing as it goes.
4. When it's done, fields are outlined by how they were filled:
   - **Mint outline** — matched locally from your profile, no API call.
   - **Blue outline** — filled by Gemini (field mapping or a written answer).
   - **Orange outline** — needs you: a file upload, or a question your
     profile doesn't have enough data to answer honestly (salary
     expectations and work-authorization questions usually land here, on
     purpose — those shouldn't be guessed).
5. **Review everything, then click Submit yourself.** JobFill will not do
   this step for you, ever.
6. If the form has multiple steps/pages, click **Fill this application**
   again after you advance to the next one.

## How the cost-control actually works

- Most standard fields (name, email, location, current title, skills,
  education) are matched with plain pattern-matching in `rules.js` — **zero
  API cost.**
- Only whatever's left (dropdowns, radio/checkbox groups, short leftover
  text fields) goes to Gemini Flash in **one batched call per page**, not
  one call per field.
- Genuinely open-ended questions ("why do you want to work here") go to
  Gemini Pro, once each, since those are worth a better model.
- Realistic cost per application: a fraction of a cent to a couple of cents,
  even on a page with a lot of custom questions.

## Known limitations (by design, not oversights)

- **File uploads are always manual.** Browsers don't allow scripts to set
  the value of `<input type="file">` for security reasons — resume/cover
  letter attachments always get flagged orange for you to attach yourself.
- **CAPTCHAs stop the run.** JobFill detects reCAPTCHA/hCaptcha/Turnstile
  and pauses rather than trying to solve or bypass them — solve it
  yourself, then click Fill again if needed.
- **One page at a time.** Multi-step application wizards need you to click
  the extension again on each step. This is safer than guessing at "Next"
  vs. "Submit" buttons on sites JobFill has never seen.
- **It never clicks Submit/Apply.** Not a setting — hardcoded.
- Many job platforms restrict automated form-filling in their terms of
  service. This tool is built to look like — and behave like — a human
  reviewing and clicking through their own application, one tab at a time,
  rather than an unattended bot, but you're using it at your own judgment
  and risk on any given site.

## Extending it

- Add more local match rules in `rules.js` — each is just a regex on the
  field's label plus a function that pulls a value from your profile.
- Change either model in the Options page any time, or edit the defaults in
  `constants.js`.
- `background.js` is the only file that talks to the network — everything
  else only ever messages it.
