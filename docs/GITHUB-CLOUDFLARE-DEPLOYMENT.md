# Push Ready2Go to GitHub and connect it to Cloudflare Pages

This guide uses a **separate** GitHub repository named `ready2go-learning`. Do not replace or upload these files into the existing `davoniumtech-website` repository; keep the company website separate.

## A. Prepare the folder

1. Download and extract the main GitHub prototype ZIP to `C:\Ready2Go-Learning`.
2. Open that extracted folder. The root of this folder should contain `index.html`, `styles.css`, `js`, `data`, and `assets`.
3. In the File Explorer address bar, type `cmd` and press Enter. A Command Prompt opens in the project folder.
4. Check whether Git is installed:

   ```bat
   git --version
   ```

   If Windows says Git is not recognised, install Git for Windows from https://git-scm.com/download/win, keep the usual installation defaults, then close and reopen Command Prompt.

## B. Create an empty GitHub repository

1. Open https://github.com/new and sign in to the `DavoniumTech` account.
2. Repository name: `ready2go-learning`.
3. Choose **Private** while you are testing. (The deployed site is still public unless separately protected by Cloudflare Access.)
4. Do **not** initialise it with a README, `.gitignore`, or licence because the project folder already contains files.
5. Click **Create repository**. Keep that browser page open so you can copy the repository URL.

## C. Push the project using Command Prompt

Make sure Command Prompt is open in `C:\Ready2Go-Learning`, then run these commands one at a time:

```bat
git init
git add .
git commit -m "Initial Ready2Go Learning prototype"
git branch -M main
git remote add origin https://github.com/DavoniumTech/ready2go-learning.git
git push -u origin main
```

If Git says a user name/email is missing, set the identity you want recorded on commits, using your own account details:

```bat
git config --global user.name "Your Name"
git config --global user.email "YOUR_GITHUB_EMAIL"
```

Then run the `git commit` and `git push` commands again. For authentication, follow Git Credential Manager/browser prompts. GitHub account passwords are not accepted as Git-over-HTTPS passwords. Never paste a personal access token into a chat.

If you already made a local Git repository or receive an error that `origin` already exists, stop and show the exact error instead of running commands blindly.

## D. Connect GitHub directly to Cloudflare Pages

**Use Git integration. Do not use the Pages upload ZIP for this route.** Cloudflare Git integration automatically deploys when you push commits to the connected branch. You cannot later change the same Pages project from Git integration to Direct Upload, so Git integration is the recommended choice here.

1. Open https://dash.cloudflare.com/ and choose the account where your domain and R2 bucket live.
2. Open **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** (wording may vary).
3. Connect GitHub if asked. Authorise access to the new `ready2go-learning` repository only if possible; do not grant broad access unnecessarily.
4. Select repository `DavoniumTech/ready2go-learning`.
5. Production branch: `main`.
6. Framework preset: **None** / **No framework**.
7. Build command: leave blank if accepted; if the dashboard requires a command use `exit 0`.
8. Build output directory: `.` (the repository root, where `index.html` is).
9. Create/deploy the project. Wait for the build to succeed, then open the `*.pages.dev` link.

The root `index.html` must be in the repository root. Do not set a build command that runs npm.

## E. Restrict the testing site to yourself

A private GitHub repository does **not** make the deployed Pages site private. Anyone with the deployment URL may be able to open it, and the Firebase signup form allows new accounts if publicly available.

Before sharing the test URL, protect the production hostname with Cloudflare Access and create an Allow policy for your own email address (use a one-time PIN sign-in method if offered). Cloudflare has separate Access configuration for `*.pages.dev` and custom hostnames; follow the Pages Access policy flow for both the Pages URL and any custom domain. Test the protection in a signed-out/private browser window before sharing the link. Do not rely on a client-side email check as security.

## F. Connect the Ready2Go custom domain (after deploy works)

1. In Cloudflare → Workers & Pages → `ready2go-learning` → Custom domains → **Set up a custom domain**.
2. Use `ready2go.davoniumtech.com` only after confirming the registered root domain is exactly `davoniumtech.com` in your Cloudflare dashboard.
3. Follow Cloudflare's guided DNS step. Because Cloudflare manages the zone, it may create the CNAME record automatically.
4. In Firebase Console → Authentication → Settings → Authorized domains, add the exact `pages.dev` hostname and custom hostname shown for this app. Add only exact hosts—no scheme, path or wildcard.
5. Test Email/Password and Google login at the HTTPS custom hostname.

Do not assign `ready2go.davoniumtech.com` as a GitHub Pages custom domain. Cloudflare Pages is hosting Ready2Go.

## G. Main company website versus Ready2Go

Keep the current company site repository `davoniumtech-website` separate. You may configure `davoniumtech.com` or `www.davoniumtech.com` for that existing GitHub Pages site later, after checking your exact domain and carefully setting the corresponding DNS records. The Ready2Go app should use a different hostname such as `ready2go.davoniumtech.com`. One hostname must not point to both GitHub Pages and Cloudflare Pages at the same time.

## H. Updates

After Cloudflare is connected, each update follows this pattern:

```bat
git add .
git commit -m "Describe the change"
git push
```

Cloudflare will automatically deploy the new version from GitHub. Check deployment status before testing changes live.
