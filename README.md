# 天机枢 v2.0.7 — A 股每日复盘系统

> 涨跌停梯队、板块轮动、龙虎榜、盘前决策仪表盘、全景手术台一站式查看。

## ✨ 功能

- **大盘总览**:6 核心指数 + 28 行业热力图(7 档色)+ 成交量/涨家数/涨跌停/市场涨跌幅 多周期折线
- **板块涨跌**:申万 28 行业 + 同花顺 90 概念 + 16 地域
- **连板天梯 / 跌停梯队 / 异动监控**:放量突破 / 突破前高 / 低位放量
- **龙虎榜**:游资动向
- **盘前扫描**:离岸人民币 / 黄金 / 原油 / 标普 500 / 纳指 / 道指 联动比价 + 重大事件预期差
- **全景手术台**:涨停封成比评分 + 亏钱效应传导 + 北向资金真假外资

## 🚀 部署

**完整教程见 [GITHUB_NETLIFY_GUIDE.md](./GITHUB_NETLIFY_GUIDE.md)**

30 分钟部署到 Netlify + 绑阿里云域名。

## 🛠 开发

```bash
npm install
npm run dev          # 本地开发
npm run build        # 打包
```

## 📦 数据源

- **后端 fetch**:`scripts/fetch_real_data.py` + `scripts/fetch_surgery_data.py`
- **数据接口**:akshare / sina / 腾讯 qt.gtimg.cn / 同花顺
- **前端实时**:60s 轮询 `qt.gtimg.cn` 拉 6 核心指数现价

## 🎨 设计规范

- 涨跌色:`#ff4d4f` 红 / `#0ecd70` 绿 / `#111827` 黑
- 品牌色:紫 `rgb(154,129,252)` / 蓝 `rgb(80,162,254)`
- 卡片:`border: 1px solid #E5E7EB` + 浅投影 + 圆角 14
- 表格:14px 加粗黑色居中
- 时间:东八区(Asia/Shanghai)

## 🚀 部署

推荐使用 **Cloudflare Pages**(国内 200-400ms,免备案,免费 500 build/月):
- 详细步骤: [`docs/CLOUDFLARE-DEPLOY.md`](docs/CLOUDFLARE-DEPLOY.md)
