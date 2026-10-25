#!/bin/sh
# ── 一键：配好 HMR → 重启宿主 ────────────────────────────────────────────────
#
# 用途：改完插件源码之后，让新代码真正生效。
#
# 为什么需要重启一次：
#   · 宿主进程持有插件的模块（ESM 绑定在求值时建立，之后永远指向同一个函数对象）
#   · `loadedStamp()` 是进程级、加载时读一次 ⇒ 不重启就测不到"现在用的是哪一版"
#   · `hmr` 那一行要在 apply 时读入 ⇒ 它自己免不了这一次
#     从此以后，改 src/** → pnpm build 即生效，不必再重启。
#
# 用法:
#   sh scripts/restart-dev.sh            # 干跑：只说它要做什么
#   sh scripts/restart-dev.sh --yes      # 直接做（配好 + 杀掉宿主）
#
# ★ 杀掉之后 GUI 会断开 —— 那是预期行为，重新打开 DeepSeek Harness 即可。

set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

DO_IT=0
[ "${1:-}" = "--yes" ] && DO_IT=1

echo "=========================================================="
echo " 一键：配好 HMR + 重启宿主"
echo " 仓库: $REPO"
echo "=========================================================="
echo

echo "── 步骤 1/3：检查 HMR 配置 ────────────────────────────────"
if node scripts/enable-hmr.mjs --check; then
  echo "   ⇒ HMR 已经配好了。"
  HMR_READY=1
else
  echo "   ⇒ HMR 还没配好。"
  HMR_READY=0
fi
echo

if [ "$HMR_READY" = "0" ]; then
  echo "── 步骤 2/3：写入 HMR 配置 ────────────────────────────────"
  if [ "$DO_IT" = "1" ]; then
    node scripts/enable-hmr.mjs --apply
  else
    echo "   (干跑) 将要执行: node scripts/enable-hmr.mjs --apply"
    node scripts/enable-hmr.mjs
    echo
    echo "=========================================================="
    echo " 这是干跑。真要执行："
    echo "     sh scripts/restart-dev.sh --yes"
    echo "=========================================================="
    exit 0
  fi
else
  echo "── 步骤 2/3：跳过（已经配好）──────────────────────────────"
fi
echo

echo "── 步骤 3/3：重启宿主 ─────────────────────────────────────"
if [ "$DO_IT" = "1" ]; then
  node scripts/restart-host.mjs --kill
else
  echo "   (干跑) 将要执行: node scripts/restart-host.mjs --kill"
  node scripts/restart-host.mjs
  echo
  echo "=========================================================="
  echo " 这是干跑。真要执行："
  echo "     sh scripts/restart-dev.sh --yes"
  echo "=========================================================="
  exit 0
fi

echo
echo "=========================================================="
echo " 完成。下一步："
echo "   ① 重新打开 DeepSeek Harness"
echo "   ② 确认:  node scripts/enable-hmr.mjs --check"
echo "   ③ 此后改 src/** → pnpm build 即生效，不必再重启"
echo "=========================================================="
