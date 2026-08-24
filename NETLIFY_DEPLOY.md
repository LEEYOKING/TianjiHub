# 天机枢 v2.0.7 → Netlify 部署教程

> 部署完成后,用户访问 `https://<site-name>.netlify.app` 即可看到完整大盘总览 / 盘前扫描 / 全景手术台。
> 当前 dist 大小 **≈ 2.4MB**,build 时间 **≈ 20s**。

---

## 0. 你需要准备什么

| 材料 | 是否必须 | 备注 |
|---|---|---|
| GitHub 仓库 | 必须 | Netlify 直接连 GitHub 自动 build |
| `netlify.toml` | 必须 | 已生成在仓库根 |
| `public/_redirects` | 必须 | 已生成,SPA 路由 fallback |
| Node.js 18+ | 必须(Netlify 自动配) | 已在 `netlify.toml` 锁 20 |
| `public/data.json` | 必须 | 后端脚本生成,见 §4 |
| `public/prescan.json` | 必须 | 后端脚本生成,见 §4 |
| `public/surgery.json` | 必须 | 后端脚本生成,见 §4 |
| 环境变量 | 不必须 | 默认走 `public/data.json` |

---

## 1. 5 分钟部署(推荐方式)

### 1.1 把代码推到 GitHub

```bash
cd /workspace/fupan
git init
git add .
git commit -m "天机枢 v2.0.7"
git branch -M main
git remote add origin https://github.com/<你的用户名>/tianjishu-a.git
git push -u origin main
```

> ⚠️ **别把 `node_modules` / `dist` / `.env` 提交**,`.gitignore` 已经处理。

### 1.2 Netlify 后台连 GitHub

1. 登录 https://app.netlify.com
2. **Add new site → Import an existing project**
3. 选 **GitHub** → 授权 → 选 `tianjishu-a` 仓库
4. **Branch to deploy**:`main`
5. **Build command**:`npm run build`(netlify.toml 已写,可不填)
6. **Publish directory**:`dist`(netlify.toml 已写,可不填)
7. 点 **Deploy site**

### 1.3 等 30 秒,自动生成网址

Netlify 会跑 `npm install` + `npm run build` + 把 `dist/` 部署到 CDN。
日志里看到 `✓ built in 20s` 就成功了。

---

## 2. 数据怎么更新?最关键的点 ⚠️

**Netlify 是纯静态托管,没有 cron。** 当前 `data.json` 是后端 `fetch_real_data.py` 跑出来的,部署后**不会自动更新**。

### 方案 A(推荐):GitHub Actions 定时跑 fetch

仓库根加 `.github/workflows/fetch-data.yml`:

```yaml
name: 每日抓 A 股数据
on:
  schedule:
    - cron: '0 1 * * 1-5'   # 每个交易日 09:00 北京时间
  workflow_dispatch:            # 手动触发
jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install akshare --break-system-packages
      - run: python scripts/fetch_real_data.py
      - run: python scripts/fetch_surgery_data.py
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "actions@github.com"
          git add public/data.json public/prescan.json public/surgery.json
          git commit -m "data: 每日抓数 $(date +%F)" || exit 0
          git push
```

工作流会把新 `data.json` 提交回 main → Netlify 自动 rebuild。

### 方案 B:浏览器端 live 拉(无需 data.json)

当前 `useLiveData` 已经在用腾讯 `qt.gtimg.cn` 拉实时指数,绕过 data.json 的 A 股指数字段。
但板块 / 涨停 / 龙虎榜还是依赖 data.json。

**纯静态可用的实时字段**:上证/深证/创业板/沪深300 的现价、涨跌(每 60s 刷新)
**仍依赖 data.json 的字段**:板块涨跌幅、涨停梯队、龙虎榜、行业 K 线

### 方案 C(简单):手动跑 fetch → git push

每天收盘后 15:30 自己跑 `python3 scripts/fetch_*.py` 然后 `git push`,Netlify 也会自动 rebuild。

---

## 3. 自定义域名(可选)

Netlify 部署后默认给你 `https://<random>.netlify.app` 网址。
要绑自己域名(如 `tianjishu.com`):
1. **Domain settings → Add custom domain**
2. 按提示到你的 DNS 服务商加 CNAME / A 记录
3. Netlify 自动签发 Let's Encrypt SSL

---

## 4. 后端 fetch 脚本依赖

`fetch_real_data.py` / `fetch_surgery_data.py` 需要:
- `pip install akshare --break-system-packages`
- 网络能访问 akshare / 新浪 / 同花顺 / 雪球 等接口
- 数据写入 `public/data.json` / `public/prescan.json` / `public/surgery.json`

GitHub Actions Ubuntu runner 全部支持。

---

## 5. 部署后验证清单

- [ ] `https://<your-site>.netlify.app/` 进站默认大盘总览(看 6 个指数卡片)
- [ ] 6 指数显示:上证/深证/创业板/科创50/沪深300/微盘指数
- [ ] 热力图 28 cell 7 档色(右上角图例)
- [ ] 点 "盘前扫描" Tab,看 6 个全球资产卡片(USDCNH/黄金/原油/标普/纳指/道指)
- [ ] 看 "全球资产联动比价图",起点不再是 0
- [ ] 点 "全景手术台",标题区 sticky 悬浮
- [ ] 直接刷新 `https://<your-site>.netlify.app/surgery` 看是否 404(应该 200,走 SPA fallback)

---

## 6. 常见问题

### Q: build 失败,日志说 `Could not resolve "antd"`?
A: 检查 `package.json` 里 `antd` 在 `dependencies` 而非 `devDependencies`,Netlify 默认 `npm install` 装 prod 依赖。

### Q: 部署后页面 404?
A: `netlify.toml` 里的 `[[redirects]] from = "/*" to = "/index.html" status = 200` 没生效。检查文件在仓库根 + Netlify 后台 Build log 显示 "Found netlify.toml"。

### Q: data.json 太大(388K),加载慢?
A: 已经加 `Cache-Control: max-age=300`(5 分钟),CDN 会缓存。再次 deploy 才会更新。

### Q: 想关掉 sitemap / robots?
A: Netlify 自动生成 `/robots.txt` / `/sitemap.xml`,不需要可以加到 `netlify.toml` 的 `[[headers]]` 设 404。

---

## 7. 一键部署按钮(给 README 用)

```markdown
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/<你的用户名>/tianjishu-a)
```

用户点这个按钮 → Netlify 自动 clone + build + deploy(需要 GitHub 授权)。

---

## 8. 仓库结构(部署需要)

```
tianjishu-a/
├── netlify.toml              ← 已生成
├── package.json              ← 已有
├── vite.config.ts            ← 已有
├── tsconfig.json             ← 已有
├── index.html                ← 已有
├── public/
│   ├── _redirects            ← 已生成(SPA 路由)
│   ├── data.json             ← fetch_real_data.py 生成
│   ├── prescan.json          ← fetch_surgery_data.py 生成
│   ├── surgery.json          ← fetch_surgery_data.py 生成
│   ├── favicon.svg           ← 已有
│   └── icons.svg             ← 已有
├── scripts/
│   ├── fetch_real_data.py    ← 后端抓数(A 股)
│   └── fetch_surgery_data.py  ← 后端抓数(盘前 + 手术)
├── src/                      ← 前端代码
│   ├── App.tsx
│   ├── pages/
│   │   ├── Overview.tsx      ← 大盘总览
│   │   ├── PreScan.tsx       ← 盘前扫描
│   │   ├── Sector.tsx
│   │   ├── LimitUp.tsx / LimitDown.tsx
│   │   ├── AnomalyStock.tsx
│   │   ├── DragonTiger.tsx
│   │   └── Surgery.tsx       ← 全景手术台
│   ├── components/
│   ├── hooks/
│   ├── data/                 ← loader + live
│   └── utils/
└── .github/
    └── workflows/
        └── fetch-data.yml     ← (推荐)定时跑 fetch
```

**注意**:`.env` / `node_modules` / `dist` 必须在 `.gitignore` 里,别提交。

---

## 9. 联系 / 问题

部署过程中有任何报错,把 **Netlify build log** 完整贴过来,我帮你看。
