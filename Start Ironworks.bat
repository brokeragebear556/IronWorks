@echo off
rem Starts Ironworks and opens it in your browser.
rem Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"

set "VENV=.venv"
if exist ".venv\" if not exist ".venv\Scripts\python.exe" set "VENV=.venv-windows"

rem First run (or something missing): install everything with setup.bat
if not exist "%VENV%\Scripts\python.exe" goto :setup
if not exist "web\dist\index.html" goto :setup
goto :run

:setup
echo First run: installing what the app needs...
call setup.bat --quiet || goto :fail
set "VENV=.venv"
if exist ".venv\" if not exist ".venv\Scripts\python.exe" set "VENV=.venv-windows"

:run
rem Open the browser 2 seconds after the server starts.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:8080"
"%VENV%\Scripts\python.exe" -m server
pause
exit /b

:fail
echo.
echo Setup didn't finish. See the messages above, fix what they say, then run this again.
pause
