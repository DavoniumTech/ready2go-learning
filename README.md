# Ready2Go Learning — v0.3.0 production starter

Ready2Go Learning is an installable, offline-first UTME preparation app by Davonium Technologies. This release upgrades the uploaded prototype without using React, Vite or a frontend build system. It preserves the R2G logo and the violet/coral visual identity, and adds a more structured onboarding and content pipeline.

## Included in this starter

- Responsive PWA shell with light/dark modes, app icon, install-help banner and mobile sidebar scrim that closes on navigation/outside tap/Escape.
- Google/email Firebase Authentication UI using the existing `ready2go-learning` Firebase web configuration. Do not rotate or replace it casually; verify Authentication → Authorized domains for the exact HTTPS host.
- First-visit study-plan onboarding, with Science / Humanities & Arts / Commerce, a state/FCT selector, institution-type selector, curated institution starter directory, programme-name catalogue and editable subjects.
- Official JAMB IBASS course eligibility and syllabus links, plus an explicit policy not to guess cut-off marks or definitive subject combinations.
- CBT-style practice flow, question count 10/20/40/all, topic and difficulty filters, no duplicate IDs within a session, scoring, explanations, local session history and export.
- 145 original questions across 11 local packs: Mathematics (60), Use of English (40), and nine additional subjects with five each. 95 items are explicitly marked `needs_human_review`; every question needs subject-matter and rights review before public release. Additional packs are marked draft/review-needed where applicable; none is labelled as a JAMB 2020 item.
- IndexedDB storage and service-worker app-shell caching; optional on-demand pack delivery through a configurable Cloudflare Worker.
- Draft Privacy, Terms, Content & Corrections and Teacher Partner pages.

## This is a production *starter*, not a certified final product

The uploaded prototype has not been deployed or modified in your Cloudflare/Firebase accounts by this package. It must first be extracted, reviewed, pushed, and configured as explained in `docs/DEPLOYMENT-RUNBOOK.md`.

Not included or not activated yet: complete/synchronised account-profile loading across devices, account deletion workflow, offline sync conflict resolution, payment and premium entitlement, payment webhooks, real teacher commission creation/payouts, monitoring/alerts, analytics, full official course/programme data, and a licensed JAMB 2020 question bank. These are separate work items that need implementation and testing.

### Questions and rights

The 145 bundled items are Ready2Go originals: 50 inherited prototype questions tagged `internal_pilot` and 95 new draft questions tagged `needs_human_review`. All 145 require documented subject-matter verification before public release. The 2020 source archive records which packs need verification; it does not contain reproduced JAMB papers. The full text of *The Lekki Headmaster* is not included. We must get appropriate rights or use content with a valid legal basis, and accurately label every source.

### Admission guidance

The institution directory is a curated starter list for the 36 states and FCT, not a complete list of all universities, approved programmes, colleges or polytechnics. It is not proof that a specific course is available at a university. Use the official [JAMB IBASS Eligibility Checker](https://eligibility.jamb.gov.ng/) for exact entry mode, institution, course, O'Level requirements and UTME subject combination. Cut-off data is intentionally empty until a source, programme, institution, admission year and verification date are recorded. The [NUC Nigerian University System directory](https://enuc.nuc.edu.ng/nus) is a starting point for the institution catalogue.

### Cloud delivery

Set `js/content-config.js` to your Worker origin only after deploying `r2-content/worker.js` and uploading the `public/` directory to the existing private bucket `ready2go-question-packs`. Do not put an R2 API key, Cloudflare token, Firebase service-account key or payment secret in browser JS or GitHub.

### Local test

Serve the extracted folder over HTTP rather than opening `index.html` from `file://`:

```bat
py -m http.server 8000
```

Open `http://localhost:8000`. PWA install and Google sign-in require a valid web origin; the Google sign-in hostname must be listed under Firebase Authentication → Settings → Authorized domains.

### Production gate

Before public advertising, review all 145 questions (50 `internal_pilot` and 95 `needs_human_review`), manually test onboarding and navigation on Android/desktop/tablet/iOS, test offline mode after a successful first visit, test authentication and cloud sync in a separate test session, complete legal review, validate all data sources, and confirm Cloudflare/Firebase spending alerts.
