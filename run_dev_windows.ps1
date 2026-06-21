# 一键启动：先确保 Electron 正常安装，再启动桌面壳
powershell -ExecutionPolicy Bypass -File .\scripts\fix_electron_cn.ps1
npm.cmd start
