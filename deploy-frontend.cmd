@echo off
setlocal EnableExtensions
set "REPO_URL=https://github.com/DavoniumTech/ready2go-learning.git"
set "BRANCH=main"
set "WORK=C:\Ready2Go-v041-publish-%RANDOM%-%RANDOM%"
if exist "%~dp0app\index.html" (for %%I in ("%~dp0app\.") do set "SOURCE=%%~fI") else (for %%I in ("%~dp0.") do set "SOURCE=%%~fI")
if not exist "%SOURCE%\index.html" (
  echo ERROR: index.html not found in the frontend source.
  exit /b 1
)
where git >nul 2>&1 || (echo ERROR: Git is not installed or not in PATH.& exit /b 1)
echo.
echo Ready2Go Learning v0.4.1 frontend publisher
echo Source: %SOURCE%
echo Repository: %REPO_URL%
echo Target branch: %BRANCH%
echo A backup branch will be created before main is updated.
echo.
git clone --branch %BRANCH% "%REPO_URL%" "%WORK%"
if errorlevel 1 (echo ERROR: Clone failed. Check GitHub credentials, repository access and branch name.& exit /b 1)
set "BACKUP_BRANCH=backup-main-before-r2g-v041-%RANDOM%-%RANDOM%"
git -C "%WORK%" push origin "origin/%BRANCH%:refs/heads/%BACKUP_BRANCH%"
if errorlevel 1 (echo ERROR: Could not create remote backup branch. No app files have been committed.& exit /b 1)
robocopy "%SOURCE%" "%WORK%" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1
if errorlevel 8 (echo ERROR: Robocopy failed. See the report above.& exit /b 1)
if exist "%WORK%\teacher-partner-terms.html" del /q "%WORK%\teacher-partner-terms.html"
if not exist "%WORK%\js" mkdir "%WORK%\js"
> "%WORK%\js\content-config.js" echo export const R2_CONTENT_API_BASE = "https://ready2go-content.dawudaminu4321.workers.dev";
git -C "%WORK%" add -A
if errorlevel 1 (echo ERROR: git add failed.& exit /b 1)
git -C "%WORK%" diff --cached --quiet
if errorlevel 1 (
  git -C "%WORK%" commit -m "Upgrade Ready2Go Learning frontend v0.4.1"
  if errorlevel 1 (echo ERROR: Commit failed.& exit /b 1)
) else (
  echo No tracked changes were found. The repository may already contain this version.
)
git -C "%WORK%" push origin "%BRANCH%"
if errorlevel 1 (echo ERROR: Push failed. Review the message above; do not force-push.& exit /b 1)
echo.
echo SUCCESS: Frontend pushed to GitHub branch %BRANCH%.
echo Backup branch: %BACKUP_BRANCH%
echo Temporary clone: %WORK%
echo If the live custom domain does not update, verify that its deployment is connected to this repository and branch.
pause
