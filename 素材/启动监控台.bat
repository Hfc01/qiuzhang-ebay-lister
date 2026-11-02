@echo off
chcp 65001 >nul
rem 数字酋长批量刊登工具 - 启动监控台
cd /d "%~dp0"
set NO_PROXY=127.0.0.1,localhost
set no_proxy=127.0.0.1,localhost
rem 优先使用工具自带的便携 Node，没有则用系统 Node
set NODE=node
if exist "%~dp0runtime\node.exe" set NODE="%~dp0runtime\node.exe"
where node >nul 2>nul || if not exist "%~dp0runtime\node.exe" (
  echo [错误] 本机没装 Node.js，且工具目录里没有 runtime\node.exe
  pause
  exit /b 1
)
echo [1/2] 启动监控服务...（浏览器将自动打开监控页，关闭本窗口即停止服务）
start "" http://127.0.0.1:8899
%NODE% server.mjs
