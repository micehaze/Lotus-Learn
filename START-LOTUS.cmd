@echo off
cd /d "%~dp0"
echo Starting Lotus Learn Version 5 at http://localhost:3005
echo Keep this window open while using Lotus Learn.
node tools/start-all.mjs
pause
