@echo off
rem Digital Cuishou tool - launch debug browser (auto-detect Chrome/Edge, no manual path editing needed)
cd /d "%~dp0"
set NO_PROXY=127.0.0.1,localhost
set no_proxy=127.0.0.1,localhost
set "CHROME="

rem ---- 1) find Chrome from registry (covers most install locations incl. custom paths) ----
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "CHROME=%%~B"
if defined CHROME goto launch
for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "CHROME=%%~B"
if defined CHROME goto launch

rem ---- 2) common install paths fallback ----
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if defined CHROME goto launch
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if defined CHROME goto launch
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME goto launch

rem ---- 3) last resort: use Edge (same Chromium engine, fully compatible) ----
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "CHROME=%%~B"
if defined CHROME goto launch

echo [ERROR] Neither Chrome nor Edge was found.
echo Please install Chrome and retry, or edit this file to set the browser path manually.
pause
exit /b 1

:launch
echo [1/2] Using browser: %CHROME%
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%~dp0tmp\chrome-debug" --no-first-run --no-default-browser-check "https://erp.datacaciques.com/ebay/post/listing/online"
echo [2/2] Started. You can close this window, the browser keeps running.
timeout /t 2 >nul
