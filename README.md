# Ready2Go Learning — GitHub-connected prototype v0.2.0

A clean, installable PWA prototype for UTME practice by Davonium Technologies. Built with plain HTML, CSS and JavaScript ES modules. No React, Vite, npm or Node.js build is required.

## What is included

- Light/dark themes and R2G icon assets.
- Onboarding categories exactly: Science, Humanities & Arts, Commerce.
- Editable subject preferences stored locally.
- Preliminary subject catalogue.
- Original pilot packs: 30 Mathematics questions and 20 Use of English questions (internal prototype content only).
- Topic practice, question-count/difficulty filtering, no duplicate question IDs within a session, optional timer, CBT navigator, scoring and explanations.
- IndexedDB local profile/session storage with fallback.
- Firebase Authentication through browser-module CDN imports: Email/Password and Google. Google sign-in uses popup on desktop and redirect on mobile.
- PWA manifest/service worker, draft privacy and terms pages.
- GitHub + Cloudflare Pages setup guide: `docs/GITHUB-CLOUDFLARE-DEPLOYMENT.md`.

## Important: status and limits

This is a working prototype, not the completed production product. The included question banks are small internal pilots; most catalogue subjects do not yet have question packs. R2 remote pack delivery, synced cloud progress, teacher referral/commission processing, payment verification, premium access and payout processing are not yet implemented. Legal pages are drafts that require review before public launch. Never label original items as official JAMB questions. Do not redistribute a large past-question corpus without permission or another valid legal basis.

## Before testing Google sign-in

1. In Firebase Console, make sure Authentication → Sign-in method has **Google** and **Email/Password** enabled.
2. In Authentication → Settings → Authorized domains, add the exact hostname of your test site when it exists, for example `ready2go-learning.pages.dev` and later `ready2go.davoniumtech.com` (only if those are the actual hostnames assigned).
3. Use HTTPS for the deployed test and never share your password or service-account key.
4. For mobile, Google sign-in redirects to Google and then returns to the app. For desktop, a popup opens.

## GitHub and Cloudflare

Follow `docs/GITHUB-CLOUDFLARE-DEPLOYMENT.md`. Recommended hosting path is GitHub repository → Cloudflare Pages Git integration → Cloudflare custom domain. Do not set the Ready2Go custom domain in GitHub Pages if Cloudflare Pages will host it. Keep the existing `davoniumtech-website` repository separate and unchanged.

## Data and security

- Firebase Authentication stores the account identity and profile display name.
- Preferences, theme and practice history are local to each browser/device in this version; no cloud sync exists yet.
- Question packs currently load from the app's static `data/` directory; R2 integration is not active yet.
- Never place R2 access keys, Cloudflare API tokens, Firebase service-account JSON, or payment secrets in the front end.
- Anyone who can reach a public deployment can view its static files. If you need a test URL restricted to only your email, protect the app with Cloudflare Access. Firebase sign-in by itself does not restrict registration to only one person.

## Local test option (if needed)

Extract the ZIP, open a Command Prompt in this folder, run `py -m http.server 8000`, then open `http://localhost:8000`. If Firebase reports `auth/unauthorized-domain`, add `localhost` to Firebase Authentication → Settings → Authorized domains.
