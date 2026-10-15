@echo off
REM Starts a tiny local web server so the browser can load the 3D models, then opens the game.
cd /d "%~dp0"
start "" "http://localhost:8000/index.html"
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p 8000 & goto :eof)
echo Could not find Python or Node.js. Install Python from python.org, then run this again.
pause
