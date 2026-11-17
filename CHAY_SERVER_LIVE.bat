@echo off
chcp 65001 >nul
title TECH CLASH 2026 - LIVE SERVER & CLOUDFLARE PUBLIC LINK
cd /d "%~dp0"
echo ============================================================================
echo 🚀 ĐANG KHỞI ĐỘNG SERVER REAL-TIME TECH CLASH 2026 (PORT 8088)...
echo ============================================================================
start "TechClash_Node_Server" cmd /k "node server.js"
timeout /t 2 >nul
echo.
echo 🌐 ĐANG TẠO LINK CLOUDFLARE TUNNEL ONLINE (KHÔNG BỊ RỚT KẾT NỐI)...
echo 👇 Hãy nhìn khung chữ nhật bên dưới có dòng https://....trycloudflare.com:
echo    - Thêm /obs.html ở cuối để mở trên Máy 1 (Phát OBS)
echo    - Thêm /admin.html ở cuối để gửi cho Máy 2 (Trọng Tài Điền Điểm)
echo ============================================================================
npx --yes cloudflared tunnel --url http://127.0.0.1:8088
pause
