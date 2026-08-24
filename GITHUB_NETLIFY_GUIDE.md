# 天机枢 v2.0.7 — GitHub + Netlify 完整保姆级教程

> **总耗时 30-40 分钟**。每一步都告诉你**点哪里、填什么、等什么**。
> 即使你从没碰过 GitHub,照着做也能搞定。

---

## 📋 整体流程一览

```
【本机/沙箱】                 【GitHub】              【Netlify】
   代码 + dist          →    push 到仓库      →    自动 build
                                                       ↑
                                                  每天 09:00
                                                GitHub Actions 自动
                                                跑 fetch_*.py 提交
                                                       ↓
                                                  自动 rebuild
                                                  → 网站数据自动更新
```

**分 3 大块**:
- 第一块:在 GitHub 创建仓库(5 分钟)
- 第二块:把代码推上 GitHub(15 分钟)
- 第三块:在 Netlify 部署 + 启用定时任务(15 分钟)

---

## 第一块:GitHub 创建仓库(5 分钟)

### 1.1 登录 GitHub

1. 打开 https://github.com
2. 输入**用户名 + 密码**登录(没账号就点 **Sign up** 注册,需要邮箱)
3. 进 https://github.com/dashboard(个人主页)

### 1.2 创建新仓库

1. 右上角 **+** 号 → **New repository**
2. 填表:
   - **Repository name**(仓库名):填 `tianjishu-a`(后面我给的命令就用这个,你想改也行,但要全局替换)
   - **Description**(描述):填 `A股每日复盘报告 - 天机枢`(可空)
   - **Public** ✅ 选这个(Public 才能用 GitHub Actions 免费额度)
   - **Add a README file** ❌ **不勾**(我们已经准备好了 README)
   - **Add .gitignore** ❌ 不勾
   - **Choose a license** ❌ 不勾
3. 点绿色按钮 **Create repository**

### 1.3 记下你的仓库地址

创建后会跳转到一个空仓库页面,顶部会显示:

```
https://github.com/<你的用户名>/tianjishu-a
```

**记下这个 URL**,后面要用。把 `<你的用户名>` 替换成你的真实用户名,比如 `zhangsan/tianjishu-a`。

### 1.4 配置 Git 用户信息(只做一次)

打开终端 / 命令行 / PowerShell(看你用什么系统):

**Mac/Linux**:
```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的注册邮箱"
```

**Windows PowerShell**:
```powershell
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的注册邮箱"
```

### 1.5 创建 Personal Access Token(PAT,推代码用)

GitHub 2022 年开始不让你用密码推代码了,必须用 PAT:

1. 进 https://github.com/settings/tokens
2. 点 **Generate new token** → **Generate new token (classic)**
3. 填:
   - **Note**:`netlify-deploy`(随便起)
   - **Expiration**:`No expiration`(永不过期,简单)或 `90 days`
   - **Scopes**:**全勾** ✅(或者至少勾 `repo` + `workflow`)
4. 拉到最下,点 **Generate token**
5. **复制显示的 token 字符串**(`ghp_xxxxxxxx`),**只显示一次,关掉就没了!**

> 💡 **小贴士**:把这个 token 粘贴到记事本存好,后面 push 要用。

---

## 第二块:推送代码到 GitHub(15 分钟)

### 2.1 在沙箱终端执行命令(我帮你准备好)

我下面给的命令是**在沙箱里执行**(Mavis 帮你跑),但**你需要授权我执行 git push**。

如果你想自己跑,把下面的命令复制到本机终端(需要先安装 git + node 20+):

### 2.2 git push 命令(我帮你在沙箱跑)

我在沙箱里执行:

```bash
cd /workspace/fupan
git init
git add .
git commit -m "天机枢 v2.0.7 首发"
git branch -M main
# 用 PAT 推送(替换 USERNAME 和 TOKEN)
git remote add origin https://USERNAME:TOKEN@github.com/USERNAME/tianjishu-a.git
git push -u origin main
```

> ⚠️ **安全提示**:PAT 包含密码权限,别 commit 到仓库里。`.gitignore` 已经排除了常见的泄露文件,但你**别在别处粘贴这个 token**。

### 2.3 验证

推完后,刷新 https://github.com/你的用户名/tianjishu-a,应该看到一堆文件:

```
.github/
netlify.toml
public/
scripts/
src/
package.json
...
```

如果看到了,**第一二块搞定**。

### 2.4 (如果出现错误)排错

| 错误 | 解决 |
|---|---|
| `fatal: unable to access 'https://...'` | PAT 错了,重新生成 |
| `! [remote rejected] main -> main (fetch first)` | 仓库非空,先 `git pull --rebase origin main --allow-unrelated-histories` 再 push |
| `Permission denied (publickey)` | 走 HTTPS 不是 SSH,改用上面的 `https://USERNAME:TOKEN@...` 格式 |
| `Repository not found` | 用户名写错,或者仓库名不是 `tianjishu-a` |

---

## 第三块:Netlify 部署 + 定时任务(15 分钟)

### 3.1 注册 Netlify

1. 打开 https://app.netlify.com
2. 点 **Sign up** → 选 **GitHub**(用 GitHub 账号一键登录,不用重新注册)
3. 授权 Netlify 访问你的 GitHub(勾选 **All repositories** 或至少勾 `tianjishu-a`)

### 3.2 创建新站点

1. Netlify 后台 → **Add new site** → **Import an existing project**
2. 选 **GitHub** → 找到 `tianjishu-a` → 点它
3. 配置:
   - **Branch to deploy**:`main`
   - **Build command**:**留空**(netlify.toml 已经写了 `npm run build`)
   - **Publish directory**:**留空**(netlify.toml 已经写了 `dist`)
   - **Environment variables**:不需要
4. 点 **Deploy tianjishu-a**

### 3.3 等 30 秒看 build

Netlify 会跑:
- `npm install`(装依赖,~1 分钟)
- `npm run build`(build,~20 秒)
- 部署 `dist/` 到 CDN

页面会显示 **"Site deploy in progress"**,**日志**里看到 `✓ built in 20s` 就成功了。

如果失败,日志会显示红色错误,常见错误:
- `Cannot find module 'antd'`:package.json 没传,检查 `.gitignore` 没误删 `dependencies`
- `tsc error ...`:TypeScript 编译失败,把错误贴给我

### 3.4 看到网址

build 成功后 Netlify 给你一个网址:

```
https://<随机名>.netlify.app
```

比如 `https://tianjishu-a-1a2b3c.netlify.app`。

**点开这个网址,应该看到大盘总览**(6 指数 + 热力图 + 曲线图)。

### 3.5 测试 SPA 路由

直接在浏览器地址栏输:
- `https://<随机名>.netlify.app/` → 大盘总览 ✅
- `https://<随机名>.netlify.app/pre-scan` → 盘前扫描 ✅
- `https://<随机名>.netlify.app/surgery` → 全景手术台 ✅

如果 `/pre-scan` 和 `/surgery` 都能正常打开 → SPA 路由 fallback 生效。✅

如果显示 "Page not found" → 检查 `public/_redirects` 文件是否上传(应该会自动 deploy)。

### 3.6 启用 GitHub Actions 定时跑 fetch

这一步是让数据**每个交易日 09:00 自动更新**。

1. 打开你的 GitHub 仓库:`https://github.com/你的用户名/tianjishu-a`
2. 点 **Settings** 标签
3. 左侧菜单 → **Actions** → **General**
4. 找到 **Workflow permissions**,选:
   - **Read and write permissions** ✅
5. 点 **Save**

> ⚠️ 这一步很关键,默认是 Read-only,改成 Read-and-write 才能让 Actions 提交数据回仓库。

### 3.7 测试 Actions(手动跑一次)

1. 仓库页 → **Actions** 标签
2. 左侧选 **"每日抓 A 股 + 盘前数据"**
3. 右侧 **Run workflow** 按钮 → 绿色 **Run workflow**
4. 等 1-2 分钟,刷新页面,看到 ✅ 绿色对勾 = 跑通

跑通后会自动 commit 一份新 `public/data.json`,Netlify 会自动 rebuild,网站数据更新。

### 3.8 验证数据自动更新

1. 打开 https://github.com/你的用户名/tianjishu-a/commits/main
2. 看到类似 `data: 每日抓数 2026-08-09` 的 commit = ✅
3. Netlify 后台 **Deploys** 标签看到新一次 deploy = ✅
4. 打开你部署的网站,数据已经是新的了

---

## 第四块:绑阿里云域名(可选,10 分钟)

### 4.1 买域名

1. 打开 https://wanwang.aliyun.com
2. 搜索想用的域名(比如 `tianjishu.com`、 `tianjishu.cn`)
3. 选后缀,加购物车,付款(70 元/年起)
4. 域名控制台 → 完成**实名认证**(可能要上传身份证,审核 1-2 小时)

### 4.2 Netlify 绑域名(推荐方式)

1. Netlify 后台 → 你的站点 → **Domain settings**
2. **Custom domains** → 输入 `tianjishu.com` → 点 **Verify**
3. Netlify 检测到这是新域名,弹窗 → **Add domain**
4. 同样方法加 `www.tianjishu.com`
5. Netlify 给你 3 个 **Nameservers**(类似 `dns1.p01.nsone.net`、`dns2.p01.nsone.net`、`dns3.p01.nsone.net`)

### 4.3 阿里云改 DNS 服务器

1. 阿里云控制台 → **域名** → 找到你的域名 → **管理**
2. 左侧 **DNS 修改** → **修改 DNS 服务器**
3. 把阿里云默认的 3 个 NS(类似 `dns9.hichina.com`)改成 Netlify 给的 3 个
4. 点 **保存**

### 4.4 等 NS 生效

- **DNS 生效时间**:10 分钟 ~ 2 小时(一般 30 分钟)
- 检查:打开 https://dnschecker.org 输入 `tianjishu.com` 看 NS 记录是否已变成 Netlify
- 生效后 Netlify 自动签发 Let's Encrypt SSL
- 打开 `https://tianjishu.com` 应该看到网站

### 4.5 强制 HTTPS(Netlify)

- Domain settings → **HTTPS** → 点 **Verify DNS** → 等通过 → 点 **Provision certificate**
- 自动跳转 HTTP → HTTPS

---

## 🎉 完整后的样子

- ✅ GitHub 仓库:`https://github.com/你的用户名/tianjishu-a`
- ✅ Netlify 站点:`https://<随机名>.netlify.app`
- ✅ 自定义域名:`https://tianjishu.com`(可选)
- ✅ 每个交易日 09:00 数据自动更新
- ✅ HTTPS 证书自动续期(Netlify 帮你管)

---

## ❓ 常见问题

### Q: 推代码时 PAT 怎么用?
A: 直接粘到 URL 里,不要弹窗输入。命令里我已经写成 `https://USERNAME:TOKEN@github.com/...` 的格式。

### Q: GitHub Actions 跑失败?
A: 进仓库 **Actions** 标签 → 点失败的 run → 看日志,通常是 `pip install akshare` 失败(网络问题)或 `python scripts/fetch_real_data.py` 失败(A 股接口限流)。把日志贴给我。

### Q: Netlify build 慢?
A: 第一次 1-2 分钟,后续会缓存,30 秒左右。

### Q: 域名备案?
A: `.com` 国际域名**不需要备案**,直接用。`.cn` 国内域名需要备案(7-15 天)。

### Q: 每天定时跑能不能改成不同时间?
A: 改 `.github/workflows/fetch-data.yml` 里的 `cron`,比如改成 `0 2 * * 1-5` 是北京时间 10:00 跑。**注意 cron 是 UTC 时间**。

### Q: 想要凌晨就跑?
A: `cron: '0 17 * * 0-4'` = UTC 17:00 = 北京时间次日 1:00(凌晨跑数据更新,但这需要美股数据已收盘,北京时间 1:00 美股 12:00 还没收盘,不建议)。

**推荐**:`cron: '0 1 * * 1-5'` = UTC 01:00 = 北京时间 09:00(每个交易日 09:00 跑一次)。

### Q: 部署后代码怎么改?
A: 在沙箱里改完 → `git add . && git commit -m "改了啥" && git push` → Netlify 自动 rebuild。

---

## 📞 卡住了找我

任何一步报错,把**错误截图 / 错误日志**贴给我,我帮你看。

最常见卡点(我会重点关注):
1. **GitHub PAT 失效** → 重新生成一个
2. **Netlify build 失败** → 看 log,通常是 tsc 编译错误
3. **Actions 没跑** → 检查 Workflow permissions 是 Read and write
4. **域名不生效** → 等 2 小时,或检查 NS 是否改对
