#!/usr/bin/env bash
# 初始化本地仓库并推送到 GitHub。token 从环境变量 GHP 读，不写进任何文件。
set -u
cd "C:/Users/紫枫/.dsh/ungrouped/dsh-playmate" || exit 1

REPO="ZiFeng11/dsh-playmate"
TOKEN="${GHP:?需要 GHP 环境变量}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b main
git config user.name "ZiFeng11"
git config user.email "ZiFeng11@users.noreply.github.com"
git config core.autocrlf false
git config core.safecrlf false

echo "=== 待提交文件 ==="
git add -A
git status --short | head -30
echo "文件数: $(git status --short | wc -l)"

git commit -q -m "feat: dsh-playmate 0.1.0

看屏幕（手动/自动三档）、热键语音输入（说完自动停）、把回答念出来（外接 TTS）。
不附带任何声音模型与参考音频。" || echo "(没有新改动可提交)"

git remote remove origin >/dev/null 2>&1 || true
git remote add origin "https://github.com/${REPO}.git"

echo "=== 推送 ==="
git push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" HEAD:main 2>&1 | tail -5

echo "=== 打 tag v0.1.0 ==="
git tag -f v0.1.0
git push "https://x-access-token:${TOKEN}@github.com/${REPO}.git" v0.1.0 --force 2>&1 | tail -3

echo "=== 结果 ==="
git log --oneline -1
git tag --list
