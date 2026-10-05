#!/bin/sh
# ── 自迭代切换：file: → link: ─────────────────────────────────────────────────
#
# 为什么需要它：`file:` 安装是【拷贝】，所以改代码需要 build + 重装
# （不是"重启"能替代 —— 拷贝一直没更新）。`link:` 让 profile 指向源码目录，
# 改完 build 即时生效。
#
# ★ 必须由人在终端执行：profile 在 ~/.dsh/ 下，AgentTeams 会话的沙箱
#   不允许写工作区之外（实测 EPERM）。
#
# 用法：sh scripts/switch-to-link.sh [profile名]     （默认 desktop）
set -e

REPO=/Users/abab/Desktop/agent-teams-dev
PROFILE_NAME="${1:-desktop}"
PROFILE="$HOME/.dsh/profiles/$PROFILE_NAME"

[ -d "$PROFILE" ] || { echo "★ 找不到 profile: $PROFILE"; exit 1; }
[ -f "$PROFILE/package.json" ] || { echo "★ 该 profile 没有 package.json"; exit 1; }

echo "① 备份"
cp "$PROFILE/package.json" "$PROFILE/package.json.bak.$(date +%s)"
echo "  已备份"

echo "② 改依赖指向"
PROFILE="$PROFILE" REPO="$REPO" node -e '
const fs = require("node:fs");
const path = process.env.PROFILE + "/package.json";
const json = JSON.parse(fs.readFileSync(path, "utf8"));
const key = "@nanmicoder/dsh-agent-teams";
if (json.dependencies?.[key] === undefined) {
  console.error("★ 该 profile 未安装 " + key + "，无需切换");
  process.exit(1);
}
const before = json.dependencies[key];
json.dependencies[key] = "link:" + process.env.REPO;
fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
console.log("  " + before + "\n  →  " + json.dependencies[key]);
'

echo "③ 重装依赖"
(cd "$PROFILE" && pnpm install)

echo "④ 验证指向"
LINK=$(readlink "$PROFILE/node_modules/@nanmicoder/dsh-agent-teams" 2>/dev/null || echo "")
echo "  链接: ${LINK:-(不是链接)}"
if [ -z "$LINK" ]; then
  echo "  ★ 不是符号链接 —— 仍是拷贝。回退：cp $PROFILE/package.json.bak.* $PROFILE/package.json && (cd $PROFILE && pnpm install)"
  exit 1
fi
# ★ 实测修正：readlink 返回的可能是【相对路径】(pnpm 就是这么写的)。
#   拿它直接与绝对路径做字符串比较会【假报失败】—— 第一次跑脚本就踩到了。
#   必须解析成绝对路径后再比。
TARGET=$(cd "$PROFILE/node_modules/@nanmicoder/dsh-agent-teams" 2>/dev/null && pwd -P || echo "")
echo "  解析后: ${TARGET:-(解析失败)}"
if [ "$TARGET" != "$REPO" ]; then
  echo "  ★ 未指向源码。回退：cp $PROFILE/package.json.bak.* $PROFILE/package.json && (cd $PROFILE && pnpm install)"
  exit 1
fi
echo "  ✓ 正确"

echo "⑤ 验证新判据已可见，且与源码一致"
INSTALLED="$PROFILE/node_modules/@nanmicoder/dsh-agent-teams"
if ! ls "$INSTALLED/lib/gates/" >/dev/null 2>&1; then
  echo "  ★ 没看到 lib/gates/ —— 在仓库里跑 pnpm build 后重试"
  exit 1
fi
ls "$INSTALLED/lib/gates/"
# ★ 目录存在还不够：断链也可能留个空壳。逐字节比一个关键文件。
if cmp -s "$INSTALLED/lib/gates/index.js" "$REPO/lib/gates/index.js"; then
  echo "  ✓ 判据层可见，且 index.js 与源码逐字节相同"
else
  echo "  ★ lib/gates/index.js 与源码不一致 —— 跑 pnpm build 后重试"
  exit 1
fi

echo
echo "完成。之后：改 src → pnpm build → 下一个新任务即用新代码。"
echo "（正在跑的任务不受影响 —— 这是刻意的，避免'看到两版代码'）"
