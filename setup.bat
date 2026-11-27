@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ---------------------------------------------------------------------------
rem  Ironworks setup for Windows.
rem  Installs everything the app needs: the Python packages (in .venv) and the
rem  web app's npm packages, then builds the web app. Safe to run again.
rem  Needs Python 3.10+ and Node.js 20+. If either is missing it offers to
rem  install it with winget.
rem ---------------------------------------------------------------------------
cd /d "%~dp0"
echo.
echo === Ironworks setup ===
echo.

rem ---- Python 3.10 or newer ----
set "PY="
for %%C in ("py -3" "python" "python3") do (
  if not defined PY (
    %%~C -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=%%~C"
  )
)
if not defined PY (
  echo Python 3.10 or newer was not found.
  call :offer_winget Python.Python.3.12 "Python 3.12"
  goto :restart_needed
)
for /f "usebackq delims=" %%V in (`!PY! -c "import platform; print(platform.python_version())"`) do echo Python  %%V  ^(!PY!^)

rem ---- Node.js 20 or newer (with npm) ----
set "NODE_OK="
for /f "usebackq delims=" %%V in (`node -p "process.versions.node.split('.')[0]" 2^>nul`) do (
  if %%V GEQ 20 set "NODE_OK=1"
)
if not defined NODE_OK (
  echo Node.js 20 or newer was not found.
  call :offer_winget OpenJS.NodeJS.LTS "Node.js LTS"
  goto :restart_needed
)
for /f "delims=" %%V in ('node -v') do echo Node.js %%V
where npm >nul 2>&1 || (echo npm was not found next to Node.js. Reinstall Node.js from https://nodejs.org & goto :fail)

rem ---- Python packages ----
rem A .venv copied from Linux only has Linux programs; use a separate one then.
set "VENV=.venv"
if exist ".venv\" if not exist ".venv\Scripts\python.exe" set "VENV=.venv-windows"
if not exist "%VENV%\Scripts\python.exe" (
  echo.
  echo Creating the Python environment in %VENV% ...
  !PY! -m venv "%VENV%" || goto :fail
)
echo.
echo Installing Python packages ...
"%VENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip || goto :fail
"%VENV%\Scripts\python.exe" -m pip install --quiet -r requirements.txt || goto :fail

rem ---- npm packages and the web build ----
echo.
echo Installing npm packages (npm ci) ...
pushd web
call npm ci --no-fund --no-audit
if errorlevel 1 (
  echo npm ci failed; trying npm install instead ...
  call npm install --no-fund --no-audit || (popd & goto :fail)
)
echo.
echo Building the web app ...
call npm run build || (popd & goto :fail)
popd

echo.
echo === Setup finished ===
echo Start the app with:  Start Ironworks.bat   ^(then open http://127.0.0.1:8080^)
echo.
if /i not "%~1"=="--quiet" pause
exit /b 0

rem ---------------------------------------------------------------------------
:offer_winget
where winget >nul 2>&1 || (
  echo Install %~2 yourself from https://www.python.org or https://nodejs.org, then run setup.bat again.
  exit /b 1
)
set "ANS="
set /p "ANS=Install %~2 now with winget? [Y/N] "
if /i "!ANS!"=="Y" (
  winget install --exact --id %~1 --accept-package-agreements --accept-source-agreements
) else (
  echo Skipped. Install %~2, then run setup.bat again.
)
exit /b 0

:restart_needed
echo.
echo When the install finishes, close this window and run setup.bat again
echo ^(a new window picks up the newly installed programs^).
if /i not "%~1"=="--quiet" pause
exit /b 1

:fail
echo.
echo Setup failed. See the messages above.
if /i not "%~1"=="--quiet" pause
exit /b 1
