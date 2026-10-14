# Ready2Go Learning architecture — v0.1.0

## Implemented in the prototype

- Static PWA: HTML, CSS and vanilla JavaScript ES modules; no npm, Node.js, React or Vite required for this build.
- App shell: overview, subject catalogue, practice setup, CBT-like question screen, question navigator, flag-for-review, answer scoring, explanations and progress history.
- Themes: light and dark, stored locally.
- Onboarding/preferences: exactly three categories — Science, Humanities & Arts, Commerce. Student subject selection is editable offline.
- Local storage: IndexedDB for profile, theme and completed sessions, with localStorage fallback.
- Optional Firebase Authentication (Email/Password and Google) via browser-module CDN imports, loaded when online. Authentication profile stores account identity/email/display name. Desktop Google sign-in uses a popup; mobile Google sign-in uses redirect. No Firestore syncing yet.
- Service worker and install manifest for app-shell caching.
- Starter question packs: 30 original Mathematics questions and 20 original Use of English questions for internal testing only.

## Not implemented yet

- R2 remote downloads, versioned pack updater or Cloudflare Worker.
- Cloud Firestore profile/progress sync, teacher referral records, server-side commission ledger or payout logic.
- Payments, premium entitlements, Paystack or payment verification.
- Passwordless auth, email verification enforcement, account deletion UI, moderation, analytics or crash reporting.
- Full reviewed question banks across every UTME subject.

## Key data separation

- Question packs: public-publishable JSON files served from Cloudflare, after quality and rights review.
- Account identity: Firebase Authentication.
- Local preferences and practice history: IndexedDB on the student's device.
- Future cloud sync and business data: Firestore only after schemas and rules are designed.
- Future trusted operations: Cloudflare Worker or Firebase Functions; secrets are server-side only.

## Security principles

- Never put a service-account key, R2 secret, Cloudflare API token or payment secret in frontend files.
- Firebase web config is a public client identifier, not an authorization mechanism. Configure Firebase Authentication authorized domains and appropriate security controls.
- Keep the R2 bucket private until the public delivery architecture is chosen. If it is made public, store only files that are intended to be publicly downloadable.
- Prototype legal pages are drafts and require review before launch.
- Use HTTPS for deployment and localhost/HTTPS for service worker testing. Do not open `index.html` directly via `file://`.
