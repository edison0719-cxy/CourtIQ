#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo '请先按 README.md 创建 Python 环境并安装 requirements.txt。'
  read -r -p '按回车关闭…'
  exit 1
fi
echo 'CourtIQ 工作台：http://127.0.0.1:8765'
echo '请保持终端窗口打开；按 Control+C 停止服务。'
exec .venv/bin/python app.py
