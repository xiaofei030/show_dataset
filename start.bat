@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "data\catalog.json" (
  echo 数据尚未构建，请先运行: .venv\Scripts\python.exe etl\build_dataset.py
  pause
  exit /b 1
)

if not exist "web\dist\index.html" (
  echo 正在构建前端...
  pushd web
  call npm run build
  if errorlevel 1 (
    echo 前端构建失败，请检查 npm 环境。
    popd
    pause
    exit /b 1
  )
  popd
)

start "MIMIC-IV Viewer" ".venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000
timeout /t 4 >nul
start "" http://127.0.0.1:8000
