#!/bin/sh
# ── 重启看门狗（由 launchd 常驻跑，与任何会话、与 App 都无亲缘关系）────────────────
#
# ── 为什么需要它（两次实测的失败链）──────────────────────────────────────────────
#
# 第一次：`sh -c "…"` 后台链 —— 字符串里 $VAR 被外层展开 + 引号嵌套 ⇒ 启动前就死。
# 第二次：独立文件 + nohup —— child 走完了 kill，但【它自己是调用者终端的子进程】，
#         App 整体退出时把它所在的会话环境一起带走了 ⇒ 日志断在"host 已退出"。
#         （实测 2026-10-11 00:18：有 SIGTERM、有"host 已退出"，没有"拉起"那一行。）
#
#   ⇒ nohup 挡不住"整个进程组/会话被收走"。能挡住的只有【系统级】的父：
#     launchd。它与任何会话无亲缘，App 死不死它都在。
#
# ── 工作方式 ────────────────────────────────────────────────────────────────────
#
#   常驻轮询 $TRIGGER 文件是否存在：
#     出现 ⇒ 读出里面的 host PID ⇒ 执行 kill + 等 App 退完 + open ⇒ 删触发文件。
#
#   队长侧只需一句：  echo <host_pid> > /tmp/dsh-restart.trigger
#   （而 PID 由 lsof 查，见 restart-cycle.sh）
#
#   ★ 失败模式与之前一样是安全的：若 open 没成功，App 就是退出了，
#     手动打开即可；而每一步都写进日志（${LOG}），如实报、不假成功。

set -u

PORT="${DSH_GUI_PORT:-19387}"
APP="DeepSeek Harness"
APP_PATH="/Applications/$APP.app"
LOG="${DSH_WATCHDOG_LOG:-${TMPDIR:-/tmp}/dsh-restart-cycle.log}"
TRIGGER="${DSH_WATCHDOG_TRIGGER:-${TMPDIR:-/tmp}/dsh-restart.trigger}"
EXIT_TIMEOUT=25

log() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG"; }

# 还有几个进程持有这个 App —— "整个 App 退完了没有"的判据。
app_procs() {
  lsof 2>/dev/null | grep -F "$APP_PATH" | awk '{print $2}' | sort -u | wc -l | tr -d ' '
}

host_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2}' | head -1
}

log "watchdog started (pid=$$, port=$PORT, trigger=$TRIGGER)"

while :; do
  if [ -f "$TRIGGER" ]; then
    HOST_PID="$(cat "$TRIGGER" 2>/dev/null | head -1 | tr -dc '0-9')"
    rm -f "$TRIGGER"
    log "═══ trigger 收到（host=${HOST_PID:-空}）═══"

    # 若触发文件里没有 PID，现场查一个
    [ -n "$HOST_PID" ] || HOST_PID="$(host_pid || true)"
    [ -n "$HOST_PID" ] || { log "★ 端口 $PORT 上没有 host —— 无需重启，忽略"; continue; }

    # ① 先礼
    sleep 2
    log "SIGTERM $HOST_PID"
    kill -TERM "$HOST_PID" 2>/dev/null || log "  (TERM 失败，可能已退出)"
    sleep 4
    if kill -0 "$HOST_PID" 2>/dev/null; then
      log "仍在 ⇒ SIGKILL"
      kill -9 "$HOST_PID" 2>/dev/null || true
    else
      log "host 已退出"
    fi

    # ② ★ 等端口释放（★★ 第三次实测改的判据）
    #
    # MEASURED（2026-10-11 00:30）：launchd 上下文里 `lsof`【全量扫描】会挂住 ——
    #   日志断在"host 已退出"，下一行本该是 app_procs() 的轮询结果，35 分钟没动静，
    #   而 watchdog 进程还活着、卡在一个子命令上。
    #   ⇒ 疑因：launchd 起的进程没有 TCC 的完全磁盘访问，lsof 全量（要扫所有进程）
    #     被系统挂起。而 `lsof -iTCP:单端口` 在同一上下文里【成功过】
    #     （SIGTERM 前后两处都用了它，日志正常）。
    #   ⇒ 判据换成"端口上还有没有 host"—— 同一个已验证可用的调用。
    #   ★ 语义差异如实记：端口释放 ≠ App 完全退出（GUI 进程可能还活着）。
    #     但对"open 只是激活旧实例"那个失败模式，端口释放已经足够：
    #     旧 host 一退，open 出来的新实例就会重新 bind 端口。
    waited=0
    while [ "$waited" -lt "$EXIT_TIMEOUT" ]; do
      [ -z "$(host_pid)" ] && { log "端口已释放（等了 ${waited}s）"; break; }
      sleep 1
      waited=$((waited + 1))
    done
    [ "$waited" -lt "$EXIT_TIMEOUT" ] || log "★ 等了 ${EXIT_TIMEOUT}s 端口仍被占 —— 照旧尝试 open"

    # ③ 拉起
    sleep 2
    log "拉起: open -a $APP"
    open -a "$APP" || log "  ★ open 失败 —— 请手动打开"

    # ④ 如实报结果
    ok=0
    i=0
    while [ "$i" -lt 30 ]; do
      sleep 1
      i=$((i + 1))
      new="$(host_pid)"
      [ -n "$new" ] && { log "✓ 新 host PID=${new}，端口 $PORT 已在听（等了 ${i}s）"; ok=1; break; }
    done
    [ "$ok" = "1" ] || log "★ 端口 $PORT 仍无人听 —— 请【手动打开】$APP"
  fi
  sleep 2
done
