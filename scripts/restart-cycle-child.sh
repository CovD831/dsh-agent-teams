#!/bin/sh
# ── 重启周期的【后台那一半】──────────────────────────────────────────────────────
#
# 这个文件由 `scripts/restart-cycle.sh --yes` 用 nohup 启动，参数是：
#     $1 = 要杀的 host PID
#     $2 = GUI 端口
#     $3 = kill 前等待秒数
#     $4 = 等 App 完全退出的上限秒数
#     $5 = 日志文件
#
# ── ★ 为什么它是一个【独立的文件】，而不是 `sh -c "…"` 里的一段字符串 ──────────────
#
# MEASURED（2026-10-11，第一次真跑，`sh -c "…"` 版失败了）：
#     scripts/restart-cycle.sh: line 129: APP?: unbound variable
#
#   根因：那段字符串里用 `\"` 转义双引号，而**外层 shell 仍会展开其中的 `$VAR`**。
#   块里同时含有 `$APP`（外层解析器在 `$APP` 后面遇到 `'` 时读成了 `${APP?…}` 的
#   参数展开语法，于是报 `APP?: unbound variable`）与大量单引号 ⇒ 引号层层嵌套，
#   一旦有一处配对错，**整段后台脚本在启动前就死了** ⇒ 连 kill 都没做（用户实测：
#   "好像没用，连关都没去关掉"）。
#
#   ⇒ 独立文件让**每一层的引号都只有一层**：本文件由 `sh` 直接解释，
#     没有"字符串里的字符串"这回事。★ 这是引号嵌套问题的结构性解法，
#     而不是把转义再调准一次。
#
# ── 架构（为什么不能只杀 host）──────────────────────────────────────────────────
#
#   Electron App（shell）
#     └─ host（node，监听 GUI 端口）   ← 只杀它会出事
#
#   杀掉 host（哪怕 SIGTERM）⇒ App 认为"宿主崩了"⇒ 它弹崩溃提示并**自己退出**；
#   而那一刻 `open -a` 看到的还是一个正在退出的实例 ⇒ 它只是**激活**、
#   不启动新的 ⇒ 端口无人听。
#
#   ⇒ 所以要等【整个 App】退完再 open。而 `ps` 在本沙箱被禁
#     （`/bin/ps -o ppid= -p <host>` ⇒ "Operation not permitted"）⇒ 拿不到父 PID。
#   ⇒ 替代判据：`lsof` 数「还有几个进程持有这个 App」，等到 0。

set -u

HOST_PID="$1"
PORT="$2"
BEFORE_KILL="$3"
EXIT_TIMEOUT="$4"
LOG="$5"

APP="DeepSeek Harness"
APP_PATH="/Applications/$APP.app"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

# 还有几个进程持有这个 App —— "整个 App 退完了没有"的判据。
app_procs() {
  lsof 2>/dev/null | grep -F "$APP_PATH" | awk '{print $2}' | sort -u | wc -l | tr -d ' '
}

# 端口上现在有没有 host。
host_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2}' | head -1
}

{
  log "cycle start (host=$HOST_PID port=$PORT)"

  # ① 先礼：让它自己收尾（关 session.lock、flush 状态）
  sleep "$BEFORE_KILL"
  log "SIGTERM $HOST_PID"
  kill -TERM "$HOST_PID" 2>/dev/null || log "  (TERM 失败，可能已退出)"

  # ② 后兵
  sleep 4
  if kill -0 "$HOST_PID" 2>/dev/null; then
    log "仍在 ⇒ SIGKILL（不给收尾机会）"
    kill -9 "$HOST_PID" 2>/dev/null || true
  else
    log "host 已退出"
  fi

  # ③ ★ 等【整个 App】退完 —— 这是本次修法的核心。
  #    上一次失败正是只等 host 消失：那时 App 还在弹崩溃提示，
  #    于是 open 只是激活了一个正在退出的实例。
  waited=0
  while [ "$waited" -lt "$EXIT_TIMEOUT" ]; do
    n="$(app_procs)"
    if [ "$n" = "0" ]; then
      log "App 已完全退出（等了 ${waited}s）"
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$waited" -ge "$EXIT_TIMEOUT" ]; then
    log "★ 等了 ${EXIT_TIMEOUT}s 仍有 $(app_procs) 个进程持有 App —— 照旧尝试 open（可能只是激活）"
  fi

  # ④ 再等一拍，让 LaunchServices 把旧实例清掉
  sleep 2
  log "拉起: open -a $APP"
  open -a "$APP" || log "  ★ open 失败 —— 请手动打开"

  # ⑤ 如实报结果，**不许假成功**
  ok=0
  i=0
  while [ "$i" -lt 20 ]; do
    sleep 1
    i=$((i + 1))
    new="$(host_pid)"
    if [ -n "$new" ]; then
      log "✓ 新 host PID=${new}，端口 $PORT 已在听（等了 ${i}s）"
      ok=1
      break
    fi
  done
  [ "$ok" = "1" ] || log "★ 端口 $PORT 仍无人听 —— 请【手动打开】${APP}（与手动关掉再开完全一样）"
} >> "$LOG" 2>&1
