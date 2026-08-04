# 愈心小筑 · Railway 部署指南

> 目标：把 `server/proxy-node.js` 部署到 Railway，获得一个可被前端 `__SHEET_API__` 引用的代理 URL，实现房态/订单/AI 的真·实时同步。

## 1. 为什么是 Railway

| 平台 | 能否跑 Node 后端 | 持久化磁盘 | 部署难度 | 成本 |
|---|---|---|---|---|
| **Railway** | ✅ 原生 | ✅ Volume | ⭐ 1 步 | $5/月起（free trial） |
| Render | ✅ 原生 | ✅ Disk | ⭐⭐ | 免费但休眠 |
| Surge | ❌ 纯静态 | ❌ | — | 不适用 |
| CloudStudio | ⚠️ 只跑静态 | ❌ | — | 已用于前端 |

**结论：代理 = Railway；前端 = CloudStudio；两者靠 URL 通信。**

## 2. 部署步骤（5 分钟）

### 2.1 准备工作

1. 注册 [railway.app](https://railway.app)（推荐 GitHub 登录）
2. 把本仓库推到你的 GitHub（如果还没有）
3. 准备一个 AI API Key（任选其一）：
   - **DeepSeek**（推荐）：[platform.deepseek.com](https://platform.deepseek.com) → API Keys → `sk-...`
   - 通义千问：阿里云百炼 → API-KEY
   - 腾讯混元：腾讯云控制台 → 混元 API Key
   - 智谱、OpenAI、Claude 兼容端点均可

### 2.2 创建 Railway 项目

1. **New Project → Deploy from GitHub Repo** → 选择你的仓库
2. Railway 自动识别为 Node 项目，使用 `package.json` 的 `start` 脚本
3. 默认会用 `node server/proxy-node.js` 启动（也已在 `railway.json` 显式声明）

### 2.3 添加持久化 Volume（重要！）

1. 进入项目 → Service → **Variables** 旁边 → **Settings** → **Volumes**
2. **New Volume** → Mount Path: `/data`
3. 这样 KV 数据会持久化到磁盘，重启不丢

### 2.4 设置环境变量

在 Service → **Variables** 添加：

| Key | Value | 必填 | 说明 |
|---|---|---|---|
| `PORT` | `3000` | ✅ | Railway 会自动覆盖 |
| `HOST` | `0.0.0.0` | ✅ | 监听所有接口 |
| `KV_DIR` | `/data` | ✅ | 与 Volume mount path 一致 |
| `FILE_ID` | `DYUdtRWlQTmxheW11` | ✅ | 腾讯文档 ID |
| `TDOC_CLI` | `tools/tencentdocs.py` | ⚠️ | 见下方"腾讯文档 MCP"小节 |
| `TDOC_PY` | `python` | ⚠️ | 同上 |
| `AI_API_KEY` | `sk-...` | ⭐ | 强烈建议填，否则 AI 走 Google Books |
| `AI_BASE_URL` | `https://api.deepseek.com` | ⭐ | DeepSeek 示例；OpenAI 改 `https://api.openai.com` |
| `AI_MODEL` | `deepseek-chat` | ⭐ | DeepSeek 用 `deepseek-chat`；OpenAI 用 `gpt-4o-mini` |
| `WEB_ROOT` | 留空 | ❌ | 不在这里服务静态文件（前端用 CloudStudio） |

### 2.5 部署与验证

Railway 自动部署。等待完成后：

1. 进入 Service → **Settings** → **Domains** → **Generate Domain**
   获得形如 `https://your-proxy.up.railway.app` 的 URL
2. 浏览器访问 `https://your-proxy.up.railway.app/health`
   应返回：
   ```json
   {
     "ok": true,
     "mode": "railway",
     "file_id": "DYUdtRWlQTmxheW11",
     "ai_configured": true,
     "kv_size": 0,
     "static_enabled": false
   }
   ```
3. `ai_configured: true` 表示 AI Key 已生效 ✅

### 2.6 在工作台填写代理 URL

1. 打开 [https://227314da213140ac98ff05a68a602cdf.sh2.agentos-app.net](https://227314da213140ac98ff05a68a602cdf.sh2.agentos-app.net)
2. 进入「**设置 → 云端同步**」
3. 「代理 Base URL」填入 `https://your-proxy.up.railway.app`
4. 点击「**保存并探测**」→ 看到 ✅ 代理可达 即成功
5. 进入「设置 → 云端同步」下方「**读书 AI 后端**」或「自媒体 → 内容生成」即可使用真实 AI

## 3. 腾讯文档 MCP 说明

⚠️ **如果你不打算用文档做"留痕"**，可以**完全跳过 MCP**，只用 KV（更稳定）。

如果你要启用文档双写：

1. 在 Railway 容器内安装 Python 与腾讯文档 MCP CLI：
   - 推荐创建 `tools/tencentdocs.py` 并 commit 到仓库
   - 或在 `nixpacks.toml` 中添加：
     ```toml
     [phases.setup]
     aptPkgs = ["python3", "python3-pip"]
     cmds = ["pip3 install requests"]
     ```
2. 把 MCP 凭据（账号、Token）通过 Railway Secret 注入：
   ```
   TDOC_USER=1390343237@1qq.com
   TDOC_PASS=Yuxin2026!
   ```
   （建议先在本地跑 `python tools/tencentdocs.py login` 把 token 持久化到 `/data/.tdoc_token`，再打包到镜像里）

⚠️ **实测警告**：经三轮 MCP 写入测试，腾讯文档的 `set_range_value` / `value_base64` 调用返回 success 但读回为空（平台/连接限制）。即使代理配好，**写入仍可能落不到文档**。但 KV 写入一定可靠，前端会以 KV 为准；文档仅作"显示看板"用途。

## 4. 工作台数据流（部署后）

```
┌─────────────────┐
│  浏览器（CloudStudio）
│  index.html + ai.js + biz-media.js
└─────────┬───────┘
          │ fetch (https://your-proxy.up.railway.app/...)
          ▼
┌─────────────────────────────────────────────┐
│  Railway 容器
│  node server/proxy-node.js (端口 3000)
│  ┌─────────┐  ┌──────────┐  ┌────────────┐
│  │  /kv/*  │  │ /api/*   │  │  /ai/*     │
│  │ 落磁盘  │  │ MCP 转发 │  │  转发 LLM  │
│  │ /data/  │  │ python   │  │ DeepSeek/  │
│  │ kv.json │  │ tdoc.py  │  │ OpenAI ... │
│  └─────────┘  └──────────┘  └────────────┘
└─────────────────────────────────────────────┘
          │              │              │
          ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │  本机磁盘 │   │ 腾讯文档  │   │ DeepSeek │
   │  (KV)    │   │ (留痕)   │   │  API     │
   └──────────┘   └──────────┘   └──────────┘
```

## 5. 故障排查

| 症状 | 排查 |
|---|---|
| `/health` 返回 502 | Railway 日志查看 Node 是否启动；检查 `KV_DIR` 路径 |
| `ai_configured: false` | 环境变量 `AI_API_KEY` 没生效，注意 Railway 区分大小写 |
| 写订单时控制台报 CORS | 已开启 `Access-Control-Allow-Origin: *`，如仍报错检查是否反向代理 |
| KV 数据每次重启丢失 | 忘记挂 Volume 到 `/data` |
| 文档写入不生效 | 这是已知平台限制；KV 一定可靠，文档作"留痕看板"用即可 |
| AI 返回空 | 检查 `AI_BASE_URL` 是否正确（不要带 `/v1` 后缀） |

## 6. 升级与维护

- 改代码后 `git push`，Railway 自动重部署
- 查看日志：Service → **Logs**
- 备份 KV：Service → **Shell** → `cat /data/kv_store.json`
- 不需要 MCP 时可禁用：`TDOC_CLI=/bin/false` + 关闭 `Sheet.MOCK=false`，前端自动走 KV 路径

---

部署好之后回我一声，我帮你把代理 URL 接入工作台并跑一遍端到端测试。
