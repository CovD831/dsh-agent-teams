#!/bin/sh
# ── 一键安装重启看门狗（launchd 常驻）────────────────────────────────────────────
#
# ★ 为什么要把脚本【拷贝】到 ~/Library/Application Support/：
#   实测（2026-10-11）：plist 直接指向 Desktop 下的仓库脚本时，launchd 起的进程
#   报 "Operation not permitted"（TCC 对 Desktop 的执行保护）。拷进 App Support
#   就不在受保护路径上 ⇒ launchd 能执行。
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DST_DIR="$HOME/Library/Application Support/dsh-watchdog"
PLIST_DST="$HOME/Library/LaunchAgents/com.dsh.restart-watchdog.plist"

mkdir -p "$DST_DIR"
cp "$REPO/scripts/restart-watchdog.sh" "$DST_DIR/restart-watchdog.sh"
chmod +x "$DST_DIR/restart-watchdog.sh"

# plist 里指向拷贝，并给它可写的日志/触发路径
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_DST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dsh.restart-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DST_DIR/restart-watchdog.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DSH_GUI_PORT</key><string>19387</string>
    <key>DSH_WATCHDOG_LOG</key><string>$HOME/Library/Logs/dsh-restart-cycle.log</string>
    <key>DSH_WATCHDOG_TRIGGER</key><string>$HOME/Library/Application Support/dsh-watchdog/trigger</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/dsh-watchdog.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/dsh-watchdog.err</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "✓ watchdog 已安装并启动"
echo "  脚本: $DST_DIR/restart-watchdog.sh   (从仓库拷贝的副本)"
echo "  plist: $PLIST_DST"
echo "  触发:  touch \"\$HOME/Library/Application Support/dsh-watchdog/trigger\""
echo "         （或带 PID:  echo 12345 > 那个文件）"
