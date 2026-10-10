#!/bin/sh
# ── 一键：重启 App（整个退出 → 再拉起来）────────────────────────────────────────
#
# ── 为什么不能只杀 host（2026-10-10 第一次真跑，失败了，而失败给出了架构）────────
#
#   Electron App（shell）              ← 用户打开的那个
#     └─ host（node，监听 GUI 端口）    ← 只杀它会出事
#
#   崩溃报告（~/Library/Logs/DeepSeek Harness/crash-*.log）逐字：
#     source: host / phase: running / shell pid: 91473
#     Error: dsh desktop host stopped: (node:91504) …
#       at ChildProcess.<anonymous> (…/main.js:3725:36)      ← ★ ChildProcess
#
#   ⇒ App 把 host 当**子进程**管。杀掉 host（哪怕 SIGTERM）⇒ App 认为"宿主崩了"⇒
#     它弹一条崩溃提示并**自己退出**；而那一刻 `open -a` 看到的还是一个正在退出的
#     实例 ⇒ 它只是**激活**、不启动新的 ⇒ 端口无人听。
#
#     实测读数（第一次真跑）：
#       [22:52:25] SIGTERM 91504
#       [22:52:29] 已退出
#       [22:52:34] 拉起: open -a 'DeepSeek Harness'
#       [22:52:47] ★ 端口 19387 仍无人听        ← 脚本【如实报了自己失败】
#
# ── 所以这一步要杀的是【整个 App】，而 `ps` 在本沙箱里被禁 ──────────────────────
#
#   $ /bin/ps -o ppid= -p <host>   ⇒ "Operation not permitted"
#   ⇒ 拿不到父 PID ⇒ **不能**用 `kill <parent>` 来实现。
#
#   ★ 本脚本用的替代判据：用 `lsof` 数「还有几个进程持有这个 App」，
#     在 host 消失之后**轮询到 0**（上限 EXIT_TIMEOUT 秒）再 `open`。
#     它与"杀父"等价 —— 等到一个都不剩，App 就是真的退完了。
#
# ── 用法 ──────────────────────────────────────────────────────────────────────
#
#   sh scripts/restart-cycle.sh            # 干跑：只打印它要做什么
#   sh scripts/restart-cycle.sh --yes      # 真做（当前调用者会被杀掉）
#   sh scripts/restart-cycle.sh --log      # 看上次的日志
#   DSH_GUI_PORT=19388 sh …                # 覆盖端口
#
# ★ 失败模式是安全的：若最后 `open` 没成功，App 就是退出了 ——
#   与"手动关掉 App"完全一样，手动打开即可，不会更糟。
#   而脚本会**如实报出**它没起来，不假成功。

set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PORT="${DSH_GUI_PORT:-19387}"
APP="DeepSeek Harness"
APP_PATH="/Applications/$APP.app"
LOG="${TMPDIR:-/tmp}/dsh-restart-cycle.log"

DO_IT=0
SHOW_LOG=0
BEFORE_KILL=3
EXIT_TIMEOUT=25

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) DO_IT=1 ;;
    --log) SHOW_LOG=1 ;;
    --wait) shift; BEFORE_KILL="${1:-3}" ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$SHOW_LOG" = "1" ]; then
  echo "──── $LOG ────"
  [ -f "$LOG" ] && cat "$LOG" || echo "(还没有日志)"
  exit 0
fi

# 端口上的 host PID。
# ★ 用 lsof 而**不是** pgrep：本机实测 `pgrep -fl DeepSeek` 返回空，
#   而同一个进程 `lsof -iTCP:<port>` 看得到。两者读数不一致，而 lsof 是对的。
host_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2}' | head -1
}

# 还有几个进程持有这个 App —— "整个 App 退完了没有"的判据（见文件头）。
app_procs() {
  lsof 2>/dev/null | grep -F "$APP_PATH" | awk '{print $2}' | sort -u | wc -l | tr -d ' '
}

HOST_PID="$(host_pid || true)"

echo "=========================================================="
echo " 重启 App（整个退出 → 再拉起来）"
echo "=========================================================="
echo "  仓库            : $REPO"
echo "  GUI 端口        : $PORT"
echo "  端口上的 host   : ${HOST_PID:-（没找到）}"
echo "  App             : $APP_PATH"
echo "  持有 App 的进程 : $(app_procs) 个"
echo "  kill 前等待     : ${BEFORE_KILL}s"
echo "  退出等待上限    : ${EXIT_TIMEOUT}s"
echo "  日志            : $LOG"
echo

if [ ! -d "$APP_PATH" ]; then
  echo "★ 找不到 $APP_PATH —— 无法拉起。" >&2
  exit 1
fi

if [ "$DO_IT" != "1" ]; then
  echo "── 干跑：将要启动的后台进程是 ─────────────────────────────"
  echo
  echo "   sleep $BEFORE_KILL"
  echo "   kill -TERM ${HOST_PID:-<host>}       # 先礼后兵"
  echo "   （再等 4s，仍站着就补 -9）"
  echo "   ★ 轮询『还有几个进程持有 App』⇒ 等到 0（上限 ${EXIT_TIMEOUT}s）"
  echo "   open -a \"$APP\"                      # ★ 这时才是真的启动新实例"
  echo "   再轮询端口 ⇒ 报出新 host PID，或如实说没起来"
  echo
  echo "=========================================================="
  echo " 这是干跑。真要执行："
  echo "     sh scripts/restart-cycle.sh --yes"
  echo "=========================================================="
  exit 0
fi

# ── 真做：整段放进 nohup 后台进程 ──────────────────────────────────────────────
#
# ★ kill 会杀掉当前调用者的祖先（宿主），所以 kill 之后还有代码留在前台的话，
#   那段代码永远不会执行。⇒ 整段必须在一个不属于宿主父链的进程里。
#
# ★ 调用【独立文件】而不是 `sh -c "…"` —— 见该文件头部：
#   字符串里的 `$VAR` 仍会被外层展开，引号层层嵌套，一处配错就整段死在启动前。
#   独立文件让每一层的引号都只有一层。
nohup sh "$REPO/scripts/restart-cycle-child.sh" \
  "$HOST_PID" "$PORT" "$BEFORE_KILL" "$EXIT_TIMEOUT" "$LOG" \
  > /dev/null 2>&1 &

echo "✓ 已启动重启周期（后台）。当前调用者稍后会被杀掉 —— 那是预期行为。"
echo
echo "  ★ 看结果：  sh scripts/restart-cycle.sh --log"
echo "  ★ 若 App 没自动回来：手动打开即可。"
