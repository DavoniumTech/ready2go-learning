# Ready2Go Learning frontend — v1.1.0

Static progressive web app source. Use a local HTTP server or the existing host; do not open `index.html` from `file://` when testing service workers, modules or offline caching.

## Main files
- `index.html`: app shell, accessible navigation, install affordance and Firebase sign-in dialog.
- `styles.css`: light/dark app design system, responsive fixed viewport and individual page layouts.
- `js/app.js`: navigation, onboarding, question setup, CBT exam, result review, analytics and Study Boost.
- `js/store.js`: IndexedDB record storage with a localStorage fallback.
- `sw.js`: versioned app-shell and local question-pack cache for offline practice after a successful online visit/cache.
- `data/`: local content, course/institution catalogues and question archive metadata.
- `assets/study-buddies.webp`: compressed study photo used on the welcome/account screens and dashboard.

## Offline behavior
The app must first be opened online at least once so the service worker can install and cache its core files and included question packs. User-approved PWA installation is required for an installed app icon, but the app can also be used in the browser. Cloud account authentication and synchronization need an internet connection.

## Content caveat
The 1,040 included items remain original draft/pilot practice questions, not verified official JAMB past questions. Human subject review is required before claims of correctness or remote publication.
