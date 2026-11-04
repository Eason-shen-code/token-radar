@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 抓取官方定价 ===
node scripts\run.mjs
echo.
echo === 生成页面 ===
node scripts\build.mjs
echo.
echo 完成。页面位置：public\index.html
pause
