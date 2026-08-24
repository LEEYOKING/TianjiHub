#!/bin/bash
# 一键部署到 Cloudflare Pages — 天机枢 v2.0.7bu
# 用法: ./deploy.sh
set -e

echo "=== 1/5 git pull 拉最新代码 ==="
git pull origin main

echo "=== 2/5 装依赖 ==="
npm install --no-audit --no-fund

echo "=== 3/5 build ==="
npm run build

echo "=== 4/5 cp 数据文件 ==="
cp public/data.json dist/data.json
cp public/surgery.json dist/surgery.json
cp public/prescan.json dist/prescan.json

echo "=== 5/5 wrangler pages deploy ==="
npx wrangler pages deploy dist --project-name=tianjishu-a --branch=main --commit-dirty=true

echo ""
echo "✓ 部署完成! 访问 https://tianjishu-a-6is.pages.dev"
