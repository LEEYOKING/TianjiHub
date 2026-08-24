# Cloudflare Pages 部署指南 — v2.0.7br

## 5 分钟部署步骤

### 步骤 1:注册 Cloudflare 账号(1 分钟)

1. 打开 https://dash.cloudflare.com/sign-up
2. 邮箱 + 密码注册(免信用卡)
3. 验证邮箱

### 步骤 2:创建 Pages 项目(1 分钟)

1. 登录后,左侧菜单 **Workers & Pages** → **Create application**
2. 选 **Pages** 标签 → **Connect to Git**
3. 选 **GitHub** → 授权 Cloudflare 访问 GitHub
4. 选仓库 `LEEYOKING/tianjishu-a` → **Begin setup**

### 步骤 3:配置 Build(1 分钟)

| 字段 | 值 |
|---|---|
| Project name | `tianjishu-a` |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (留空) |
| Environment variables | (留空,暂时不需要) |

点 **Save and Deploy**。

### 步骤 4:等待首次部署(2-3 分钟)

Cloudflare 自动:
1. clone 你的 repo
2. 跑 `npm ci && npm run build`
3. 部署 `dist/` 到全球 CDN

完成后给你一个域名:`https://tianjishu-a-6is.pages.dev`(`-6is` 是你 Cloudflare 账号 suffix)

### 步骤 5:绑定自定义域名(可选)

如果你有自己的域名(比如 tianjishu.com):
1. Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入域名,Cloudflare 自动加 DNS 记录
3. 5-10 分钟生效

## 自动部署

之后你每次 `git push origin main`:
- Cloudflare 自动触发部署
- 1-2 分钟完成
- `https://tianjishu-a-6is.pages.dev` 自动更新到最新版

## 国内访问速度

实测从中国大陆访问 `*.pages.dev`:
- 平均 200-400ms
- 比 Vercel (300-1500ms) 稳
- 比 Netlify (500-1500ms) 快

## 故障排查

### 部署失败
- 看 Cloudflare Pages → **Deployments** → 失败的 build → **Build log**
- 常见:`npm install` 失败 → 加 `package-lock.json`
- 常见:`npm run build` 报错 → 本地先 `npm run build` 验证

### 国内打不开
- 临时:换 ISP 试(电信/联通/移动)
- 长期:用 mcode 沙箱(84ms) / EdgeOne 海外版(280-610ms) 备选

### GitHub Actions 部署(可选,优于 Git 集成)

如果用 GitHub Actions:
1. Cloudflare 控制台 → **My Profile** → **API Tokens** → **Create Token**
2. 模板选 **Edit Cloudflare Pages**
3. 选你的 account + 项目 tianjishu-a
4. 创建 token,复制
5. GitHub repo → **Settings** → **Secrets and variables** → **Actions**
6. 加 `CLOUDFLARE_API_TOKEN` (上面那个 token)
7. 加 `CLOUDFLARE_ACCOUNT_ID` (在 Cloudflare 控制台右下角)
