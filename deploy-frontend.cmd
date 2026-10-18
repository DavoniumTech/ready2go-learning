@echo off
setlocal EnableExtensions
set "REPO_URL=https://github.com/DavoniumTech/ready2go-learning.git"
set "BRANCH=main"
set "RELEASE=1.0.1"
set "WORK=C:\Ready2Go-Production-v101-publish-%RANDOM%-%RANDOM%"
if exist "%~dp0app\index.html" (for %%I in ("%~dp0app\.") do set "SOURCE=%%~fI") else (for %%I in ("%~dp0.") do set "SOURCE=%%~fI")
if not exist "%SOURCE%\index.html" (echo ERROR: index.html not found in frontend source.& exit /b 1)
where git >nul 2>&1 || (echo ERROR: Git is not installed or not in PATH.& exit /b 1)
echo.
echo Ready2Go Learning v%RELEASE% frontend publisher
echo Source: %SOURCE%
echo Repository: %REPO_URL%
echo Target branch: %BRANCH%
echo A backup branch will be created before main is updated.
echo.
git clone --branch %BRANCH% "%REPO_URL%" "%WORK%"
if errorlevel 1 (echo ERROR: Clone failed. Check GitHub access.& exit /b 1)
set "BACKUP_BRANCH=backup-main-before-r2g-v101-%RANDOM%-%RANDOM%"
git -C "%WORK%" push origin "origin/%BRANCH%:refs/heads/%BACKUP_BRANCH%"
if errorlevel 1 (echo ERROR: Could not create backup branch. No app files have been committed.& exit /b 1)
robocopy "%SOURCE%" "%WORK%" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1
if errorlevel 8 (echo ERROR: Robocopy failed. See report above.& exit /b 1)
if exist "%WORK%\teacher-partner-terms.html" del /q "%WORK%\teacher-partner-terms.html"
if not exist "%WORK%\js" mkdir "%WORK%\js"
> "%WORK%\js\content-config.js" echo export const R2_CONTENT_API_BASE = "https://ready2go-content.dawudaminu4321.workers.dev";
git -C "%WORK%" add -A
if errorlevel 1 (echo ERROR: git add failed.& exit /b 1)
git -C "%WORK%" diff --cached --quiet
if errorlevel 1 (
  git -C "%WORK%" commit -m "Ready2Go Learning production app v%RELEASE%"
  if errorlevel 1 (echo ERROR: Commit failed.& exit /b 1)
) else (
  echo No tracked changes found. Repository already matches this release.
)
git -C "%WORK%" push origin "%BRANCH%"
if errorlevel 1 (echo ERROR: Push failed. Review the message above; do not force-push.& exit /b 1)
echo.
echo SUCCESS: Frontend pushed to GitHub branch %BRANCH%.
echo Backup branch: %BACKUP_BRANCH%
echo Temporary working clone: %WORK%
echo The live website updates only if its host is connected to this repository and branch.
exit /b 0
