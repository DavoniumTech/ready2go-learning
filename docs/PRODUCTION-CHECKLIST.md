# Ready2Go pre-launch checklist

This starter is not yet a public-launch certification. Complete the items below before advertising a production release.

## Content quality

- [ ] Review every question, answer and explanation with a qualified subject reviewer. Current starter has 145 original items; 50 are tagged `internal_pilot` and 95 `needs_human_review`.
- [ ] Verify rights and source attribution for all content; import no unlicensed official past-question corpus or book text.
- [ ] Map every released topic to the current IBASS syllabus.
- [ ] Validate institution/course/year requirements through official sources; keep the cutoff table empty until verified.
- [ ] Change an R2 manifest status to `published` only after content and rights approval.

## PWA and UI

- [ ] Test 320px, 390px, tablet and desktop widths, keyboard navigation, screen-reader labels and contrast in both themes.
- [ ] Test service worker update, new app versions, offline first launch versus offline after one successful visit, IndexedDB storage and quota/cleared-data recovery.
- [ ] Test installing on Android Chrome, desktop Chromium/Edge, and iOS Safari where available. The app cannot force a system install prompt.
- [ ] Verify all legal links, external links and course-guide disclaimers.

## Firebase and privacy

- [ ] Verify Firebase Authentication authorised domains; test Google and email/password flows.
- [ ] Create Firestore in a deliberate location; merge, do not overwrite, rules if other products use the same database.
- [ ] Run Firebase Emulator tests for rules and Functions, signed-out calls, access isolation and duplicate-session concurrency.
- [ ] Configure Firebase App Check, abuse monitoring, suitable quotas and billing alerts. Alerts are not hard spend caps.
- [ ] Implement account deletion, export/data-retention policy, cloud-sync recovery/conflict handling and a support/correction channel before public scale.

## R2 and deployments

- [ ] Keep R2 Public Access disabled, issue a bucket-scoped R2 token, and never place keys in the app or repository.
- [ ] Verify Worker binding `CONTENT_BUCKET` and test health, manifest, published packs and 404 for draft/unlisted packs.
- [ ] Configure `js/content-config.js` with the exact deployed Worker origin.
- [ ] Test CORS/HTTPS and download-cache behavior across devices.
- [ ] Push only after inspecting `git status` and create a rollback tag/backup.

## Business readiness

- [ ] Finish legal review for privacy, terms, content, complaints/corrections and teacher partner agreement.
- [ ] Keep teacher attribution separate from earned commissions. Do not create commission amounts until a server verifies an eligible payment and refund/chargeback behaviour is defined. Payment/payout features are not active in this release.
- [ ] Recruit a small voluntary student test group, collect feedback and fix issues before marketing broadly.
