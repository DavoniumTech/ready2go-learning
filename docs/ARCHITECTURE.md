# Ready2Go Learning — architecture v0.3.0

## Product layers

1. **PWA shell** — `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`. Responsible for responsive app UI, theme, installation help and shell cache.
2. **Learning engine** — `js/app.js`. Renders subject, course guide, syllabus, question library, study plan, CBT session, results and local progress views. Question selection/scoring are independent from Firebase.
3. **Local data** — `js/store.js` and IndexedDB `records`. Local profile, theme, session history and downloaded R2 pack copies live in the browser. Clearing browser site data may erase them.
4. **Content pipeline** — `data/manifest.json`, `data/*.json`, and the private R2 bucket `ready2go-question-packs`. R2 published content is served only via an allow-listed Worker route; browser code contains no credentials.
5. **Identity and optional cloud sync** — Firebase Authentication and callable Cloud Functions (`saveLearnerProfile`, `recordPracticeSummary`). Cloud writes go through trusted functions; browser Firestore writes are denied by rules. Session scores are still client-reported because offline answer keys are in downloaded packs.
6. **Partner and payment foundation** — server-only teacher code and attribution collections are scaffolded. Verified payment, commission generation and payout are deliberately not active. They must be added with an actual server-side payment integration and idempotent event handling.

## Content model

Every multiple-choice question has `id`, `subjectId`, `topic`, `type`, `sourceType`, `sourceLabel`, `difficulty`, `question`, A-D `options`, `correctAnswer`, `explanation`, and `reviewStatus`. A public pack must have unique question IDs and a clearly described provenance. Do not publish `needs_human_review` packs as verified final content.

`data/question-archive.json` is only a tracking register for requested past-question sources. It contains no full 2020 JAMB corpus or full novel text. `data/cutoff-marks.json` has no records by design. No cutoff should be displayed until an official source and admission year are recorded.

## Onboarding and admission guidance

The first-visit local profile asks whether the learner is preparing for JAMB, broad study area, state/FCT, institution type, institution and intended programme. The subject list is editable offline. Course names and institution names are discovery helpers only. Exact eligibility must be checked with JAMB IBASS for the intended admission year. Course availability differs by institution. The local institution list is a curated seed and must be expanded/verified against the live NUC directory and IBASS data.

## Offline contract

- The app shell and local starter packs are cached for returning access.
- Profile, theme, bookmarks if added, and practice history are local-first.
- R2 pack downloads require connection once; validated packs are saved into IndexedDB for offline sessions.
- Signup, Google auth, Cloud Functions, course eligibility checking and content downloads require internet.
- No website can force the browser's native PWA install prompt. Android/desktop browsers may emit `beforeinstallprompt`; iOS users usually use Share → Add to Home Screen in Safari.

## Teacher referral contract

An active code is assigned server-side to a teacher. First-touch attribution is sticky and self-referrals are rejected. Attribution is not a commission. A future commission may be created only after a trusted backend verifies an eligible successful payment, with idempotency, refunds and chargebacks handled. Do not present the commission UI as live until a full payout process and final partner agreement exist.

## Security boundaries

- Never ship R2 secrets or service account keys in client files.
- Keep R2 Public Access disabled; the Worker publishes only whitelisted manifest/catalogue/pack keys.
- Firestore client writes are denied for profile, referral, teacher and commission data. Callable functions validate fields and derive UID from verified Firebase Auth context.
- The prototype still has a public sign-up UI and is not access-restricted merely because the GitHub repository is private.
- Use Firebase App Check, rate-limit/abuse monitoring, Emulator Suite tests, and Cloudflare/Firebase spend alerts before public launch.
