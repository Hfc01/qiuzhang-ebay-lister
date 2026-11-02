@echo off
chcp 65001 >nul
rem 数字酋长批量刊登工具 - 一键停止（监控服务 + 调试浏览器）
cd /d "%~dp0"

echo [1/2] 停止监控服务...
if exist server.pid goto bypid
goto byport

:bypid
set /p STOPPID=<server.pid
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:STOPPID) -ErrorAction SilentlyContinue; if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.mjs') { Stop-Process -Id $p.ProcessId -Force -Confirm:$false; Write-Host ('    已停止监控服务 (PID ' + $p.ProcessId + ')') } else { Write-Host '    服务未在运行（清理过期记录）' }"
del /q server.pid >nul 2>nul
goto browser

:byport
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess); if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.mjs') { Stop-Process -Id $p.ProcessId -Force -Confirm:$false; Write-Host ('    已停止监控服务 (PID ' + $p.ProcessId + ')') } else { Write-Host '    8899 端口被其他程序占用，未动它' } } else { Write-Host '    监控服务未在运行' }"

:browser
echo [2/2] 关闭调试浏览器（只关本项目启动的那个，不动你的日常 Chrome）...
powershell -NoProfile -Command "$ps = Get-CimInstance Win32_Process -Filter 'Name=''chrome.exe''' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'chrome-debug' }; if ($ps) { $ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }; Write-Host ('    已关闭调试 Chrome (' + @($ps).Count + ' 个进程)') } else { Write-Host '    调试 Chrome 未在运行' }"

echo.
echo 全部停止。登录态已保留，下次「启动调试浏览器.bat」打开仍是登录好的。
pause
