# Deployment runbook — v0.4.0

Use the root `DEPLOYMENT-QUICKSTART.md` in the complete release bundle for the current, checked deployment commands. Do not use prior v0.3 instructions below if they disagree with the root quickstart.

The provided Windows CMD helpers are `deploy-frontend.cmd` and `deploy-cloudflare.cmd`. The Firebase backend has `firebase-backend/deploy-functions.sh`, which must be run inside Google Cloud Shell. Firestore rules are intentionally not deployed automatically.

The content Worker URL is `https://ready2go-content.dawudaminu4321.workers.dev`; bucket `ready2go-question-packs` stays private. Draft question packs intentionally return 404 from the Worker until the manifest, pack, and all questions are approved.

# Ready2Go Learning v0.3.0 — deployment runbook

This runbook is written to preserve the existing GitHub repository, Firebase project and Cloudflare resources. Verify names and paths before each push/deploy.

## 0. Keep a rollback copy

1. Download your current `ready2go-learning` GitHub repository ZIP and retain the old prototype ZIP.
2. Extract `Ready2Go-Learning-App-v0.3.0.zip` to a new folder such as `C:\Ready2Go-Learning-v0.3`. Do not extract over your company website, Cognitia/LinexAI, Marvel Chat or another project.
3. Serve it locally and review all pages before deploying (see `README.md`).

## 1. Push the app to the existing GitHub repository

Install Git for Windows if `git --version` is not recognised. If the repository already exists (likely), clone it rather than running `git init` in the extracted ZIP:

```bat
git clone https://github.com/DavoniumTech/ready2go-learning.git C:\Ready2Go-Learning
```

If the actual repository URL differs, copy the exact URL from GitHub and replace this example. Copy the **contents** of the extracted v0.3 app folder into `C:\Ready2Go-Learning`, replacing project files when prompted, but do not copy any `.git` folder from elsewhere. Then:

```bat
cd /d C:\Ready2Go-Learning
git status
git add .
git commit -m "Upgrade Ready2Go Learning to v0.3.0"
git push
```

If `git status` shows changes you did not intend to replace, stop and inspect before `git add .`. If GitHub asks for authentication, use the official browser/Git Credential Manager flow; do not paste a token into chat. If the repo is new and truly empty, follow GitHub's create-repository instructions then add its exact remote URL.

## 2. GitHub → Cloudflare Pages

In Cloudflare, open Workers & Pages → the Ready2Go Pages project. Verify the connected repository, production branch and output directory. Use **no framework/build command**, output directory `.` (the folder with root `index.html`). The frontend does not need a build step. A push to the configured branch should trigger a new deploy if Git integration is enabled.

After the first deploy, add the exact HTTPS Pages hostname under Firebase Console → Authentication → Settings → Authorized domains. Do not add a URL path, wildcard or unverified custom domain. Keep the Davonium company website on its existing repository/domain configuration.

## 3. Seed the existing R2 bucket

Use the separately supplied `Ready2Go-R2-Content-Starter-v0.3.0.zip`. Follow its README. The target is the existing private bucket `ready2go-question-packs`; do not create another Cloudflare account and do not toggle Public Access on. Upload the contained `public/` tree as the object prefix `public/` using Cloud Shell and a bucket-scoped R2 token.

## 4. Deploy content Worker, then connect the app

Deploy `worker.js` as `ready2go-content` in the same Cloudflare account and add R2 binding `CONTENT_BUCKET` → `ready2go-question-packs`. Test `/v1/health` and `/v1/manifest.json`. All starter packs are intentionally blocked until their subject content and rights are reviewed, so `/v1/packs/biology.json` should return 404 at first. Unknown or draft packs must remain blocked. After a pack and every question are approved, mark both the pack and its manifest entry `published`, set every question `reviewStatus` to `approved`, align version/count fields, upload again and confirm that approved pack returns 200. Copy the Worker origin into `js/content-config.js` as `R2_CONTENT_API_BASE`, commit and push that change. Until then, the app uses bundled local packs.

## 5. Firebase Cloud Shell

Use `Ready2Go-Firebase-Backend-Starter-v0.3.0.zip`. Confirm project ID `ready2go-learning`. If Firestore doesn't exist, create it in Firebase Console first and carefully choose the location. The included rules are default-deny and will **replace the project's current rules when deployed**; if any other app uses this project's Firestore, merge the rules manually before deployment.

Then follow that package's README to use Firebase CLI in Google Cloud Shell, install the Functions dependencies and deploy rules/indexes/functions. Functions runtime is Node.js 22. Test signed-out calls, profile sync, duplicate session IDs, user isolation and direct-write denial. The frontend uses region `us-central1`; update both frontend `getFunctions` and backend `setGlobalOptions` if you choose another region.

## 6. Final smoke tests

Test on desktop and Android Chrome, and test iOS Safari if accessible:

- first-visit onboarding, save and re-open preferences
- state/type changes repopulate the institution list
- Other university and college/Polytechnic are available where the curated list does not match
- offline after the app and question pack have been downloaded; scores and explanations still work
- refresh/offline shell, light/dark theme, mobile sidebar close and Escape key
- Google and email sign-in after HTTPS host is added to Firebase Authorized domains
- after a pack has been reviewed/published, its remote download works, appears in practice and remains available offline
- no fake cut-off marks; course page links to official JAMB IBASS
- no commission displays as earned and no payment/payout code is activated
- legal pages and content-rights status are reviewed

A PWA install prompt cannot be forcibly displayed on every device on the first visit. The app uses the browser's native prompt when available and otherwise explains browser-specific steps. HTTPS, manifest, service worker and browser criteria must be satisfied.
