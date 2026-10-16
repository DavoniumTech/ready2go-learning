@echo off
setlocal

echo Ready2Go Learning - guarded Git push helper
echo.
if not exist ".git\" (
  echo ERROR: This folder is not the root of a cloned Git repository.
  echo First copy the app files into your existing ready2go-learning repository clone.
  echo Read docs\DEPLOYMENT-RUNBOOK.md for the exact steps.
  exit /b 1
)
if not exist "index.html" (
  echo ERROR: index.html was not found. Run this from the app repository root.
  exit /b 1
)

echo Current Git status:
git status --short
echo.
echo IMPORTANT: Confirm that this repository is Ready2Go Learning, not the Davonium company website,
echo Marvel Chat, or Cognitia/LinexAI. Review changes above before proceeding.
set /p STAGE=Type STAGE to stage all changes in this Ready2Go repository, or anything else to cancel: 
if /I not "%STAGE%"=="STAGE" (
  echo Cancelled. No files were staged.
  exit /b 0
)

git add -A
if errorlevel 1 exit /b 1

echo.
echo Staged change summary:
git diff --cached --stat
echo.
set /p PUSH=Type PUSH to commit and push these staged changes, or anything else to cancel: 
if /I not "%PUSH%"=="PUSH" (
  echo Cancelled before commit/push. Staged files remain staged for your review.
  exit /b 0
)

git commit -m "Upgrade Ready2Go Learning to v0.3.0"
if errorlevel 1 (
  echo Commit failed or there were no staged changes. Review the message above.
  exit /b 1
)
git push
if errorlevel 1 (
  echo Push failed. Check the Git message and authentication; do not paste tokens into chat.
  exit /b 1
)
echo.
echo Push completed. Check your GitHub Actions/Cloudflare Pages deployment status.
endlocal
