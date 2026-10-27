# CourtIQ · 静态结果网站部署

[English](CLOUD_DEPLOY.md) · [项目说明](README.zh-CN.md)

默认方案：本地分析，结果上线。网站直接读取已发布的真实 JSON / CSV / 图表，支持双语、交互图表和轨迹回放，不接收录像，不调用在线模型。无需 Zero Trust、Access、支付信息或以下完整云端版的资源。

## 使用现有 GitHub 连接

| 设置 | 值 |
| --- | --- |
| Git 仓库 | `edison0719-cxy/CourtIQ` |
| 分支 / 根目录 | `main` / `/` |
| Build command | `npm ci --include=dev` |
| Deploy command | `npm run cloud:deploy:git` |

1. 将最新代码推送到 GitHub；Cloudflare 自动构建时会使用新的静态部署命令。
2. 旧的 `COURTIQ_*` 构建变量均不再需要，可以删除；`SKIP_DEPENDENCY_INSTALL=1` 可保留，显式 npm 构建仍会安装所需 JavaScript 工具。根目录已移除 Python 依赖入口，避免自动安装模型依赖。
3. 关闭 Preview builds，保存设置，在 Builds 中重试最新提交。
4. 构建成功后访问 **https://courtiq.edisonruby419.workers.dev**。`wrangler.site.jsonc` 会启用正式 workers.dev 地址，不需要购买域名。如果之前单独创建过该主机名的 Access 应用，需要在本人控制台移除该展示站的访问限制。

不需要 D1 ID、Access Team Domain、AUD、内部密钥、模型上传或本机 Docker。已创建的数据库保留不动。部署配置只有静态资源，没有在线计算或存储绑定；[Cloudflare 官方说明](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)静态资源请求免费，仍受文件数量、单文件大小和构建配额限制。

## 本地验证及发布新结果

```sh
npm ci --include=dev
npm test
npm run build:site
npm run site:dev
```

网站包输出到 `dist/`（不提交 Git）。部署过程不读取 `.env*`、`.dev.vars`、`data/` 或模型目录。当前 `published/` 只包含标记为公开示例的真实 5 秒分析，不代表学生训练效果。

学生录像在本地完成分析后，按 README 的 `publish.py` 命令显式导出。导出数据经过匿名化，仍须审核公开权限；推送后自动更新网站。原始视频继续留在本地。展示版暂不开放组间比较编辑和人工成绩录入，这些工作在本地工作站完成。

---

# 可选附录：完整云端上传与推理（当前不部署）

以下内容仅适用于将来明确启用在线处理时，包含付费资源及登录设置。静态网站请停留在以上步骤。

此版本保留 `python app.py` 本地工作站，并增加完整云端入口。仅把 `static/` 放到 Pages 无法运行视频分析。云端使用 Workers 静态资源、Access 登录、私有 R2、D1、Queues 和运行 Python 的 Containers。

## 推荐：直接从 GitHub 自动部署（无需本机 Docker）

Cloudflare 的 Workers Builds 可以直接从 GitHub 构建本项目的 Docker 镜像；使用 GitHub 登录 Cloudflare 后，还需要另行将仓库连接为构建来源。[官方 Containers 构建说明](https://developers.cloudflare.com/containers/guides/deploy/)。下文的本机 Docker/CLI 安装仅适用于选择本机部署的情况。

1. 将最新代码推送到 `edison0719-cxy/CourtIQ`。本地尚未推送的代码不会参与 GitHub 自动部署。
2. 在 Cloudflare 账号中开通 Workers Paid、启用 R2。付费确认由账号持有人完成。创建 D1 数据库 `courtiq`、私有 R2 桶 `courtiq-private` 和 Queue `courtiq-analysis`，记录 D1 UUID。
3. 在 Workers & Pages 页面查看/设置账号的 `workers.dev` 子域名。应用名使用 `courtiq`，正式网址为该账号下的 `courtiq.<账号子域名>.workers.dev`，无需购买域名。
4. 配置 Zero Trust：为这个正式主机名建立仅允许本人/教练邮箱的 Access 应用，复制团队域名与 AUD。另建同主机、更具体的 `/internal/storage/*` Bypass 应用，具体要求见下面“配置登录和容器回调”。
5. 在 Workers & Pages → Create application → GitHub 导入 `edison0719-cxy/CourtIQ`，Worker 名 `courtiq`，生产分支 `main`，根目录为仓库根目录 `/`。Build command 填 `npm ci --include=dev`；Deploy command 填 `npm run cloud:deploy:full`。
6. 在构建设置（Settings → Builds → Variables and secrets）填写下面五项，最后一项以 Secret 保存。若首次构建先启动并报告缺少配置，补齐后重试即可；缺少配置时部署脚本会直接停止。

| 构建变量 | 内容 |
| --- | --- |
| `COURTIQ_PUBLIC_ORIGIN` | 实际完整网址 `https://courtiq.<账号子域名>.workers.dev` |
| `COURTIQ_ACCESS_TEAM_DOMAIN` | 实际 `https://<团队名>.cloudflareaccess.com` |
| `COURTIQ_ACCESS_AUD` | 该主应用的 AUD tag |
| `COURTIQ_D1_DATABASE_ID` | D1 数据库 UUID |
| `COURTIQ_INTERNAL_SECRET` | 至少 32 字符的随机值，以构建 Secret 保存 |

脚本从构建变量生成部署配置，应用 D1 迁移，再调用完整 `wrangler deploy` 构建并发布 Worker 与容器。内部密钥通过临时 secret 文件传给运行时；不会进入 Git 或镜像，执行结束后删除。无需上传本机 `wrangler.local.jsonc`，也无需把 Cloudflare 登录密码或 OAuth token 放进仓库。

7. 把 README 中的两个真实模型一次性上传到私有 R2 的 `models/TrackNet_best.pt`、`models/yolov8s-pose.pt`。可以在 R2 控制台上传；此前的 `cloud:seed -- --remote` 也是可选方式。模型文件继续排除在 Git 外。
8. 触发或重试生产构建，查看 Build logs；完成后等待容器初始化，再按本文“上线验收”使用 5 秒真实录像验证。之后推送 `main` 会自动更新部署。

## 已实现的运行方式

- Access JWT 验签后按用户 `sub` 隔离训练档案；R2 不开放公共访问。
- 浏览器按 8 MiB 上传原片，暂停后重新选择同一文件可续传。已存在的每片也会核验 SHA-256。最终原片哈希由 Python 重算。
- Queues 只携带任务编号。一个 D1 推理槽串行运行任务，另一个容器提供预览、统计等操作；队列最多接受 20 个待处理记录。运行时使用 CPU。
- 分析任务每约 30 秒检查一次，等待任务约 60 秒检查一次；每两分钟的 watchdog 补发遗漏任务。网页关闭不影响执行。
- 容器重启后从 R2 原片重新分析，最多启动三次。所有结果按 8 MiB 分片保存，最后写 `completion.json`；之后才将 D1 标记为完成。已提交的结果可在新进程中恢复。
- 中英文界面、四角标定、视频回放、CSV/JSON/图表导出、统计研究和城市体育规划页面沿用现有计算。

默认上传上限 4 GiB、每次最多分析前 300 秒、从入队开始的任务时限两小时。建议先用 5 秒实拍片段评测 CPU 耗时和成本，再调整 `MAX_ANALYSIS_SECONDS` / `MAX_JOB_SECONDS`（任务时限最多 7,200 秒）。这些限制不等于实时处理性能承诺。统计模块与本地版共用 `services.py` / `research.py`。

## 可选：从本机部署

### 1. 准备账号与运行环境

需要 Cloudflare 账号、Workers Paid 与 Containers 可用权限、Cloudflare 管理的自定义域名、Node.js 22+、Python 3.13 和运行中的 Docker。Containers 按实际运行另行计费；配置默认最多两个 `standard-4` 实例，并不表示两个实例一直运行。参见 [官方价格](https://developers.cloudflare.com/containers/platform/pricing/)。本次代码改造不会自动开通付费服务。

在 CourtIQ 项目目录执行：

```sh
npm ci
npm test
.venv/bin/python -m unittest discover -s tests -q
npm run cloud:check
npx wrangler login
npx wrangler d1 create courtiq
npx wrangler r2 bucket create courtiq-private
npx wrangler queues create courtiq-analysis
```

记录 D1 返回的 `database_id`。这套登录属于 Cloudflare，和本机原有 GitHub 账号、SSH 密钥没有关联。上游权重必须按 README 下载到原来的 `vendor/.../weights/`，不提交进 Git。

## 2. 配置登录和容器回调

在 Zero Trust → Access controls → Applications 创建自托管应用，域名为准备使用的 CourtIQ 自定义域名，登录策略只允许指定学生/教练的邮箱，按需要启用邮箱验证码或现有身份源。复制应用的 AUD tag 和团队域名 `https://你的团队.cloudflareaccess.com`。

**另外创建同域名、更具体路径 `/internal/storage/*` 的 Access 应用，策略为 Bypass → Everyone。** 这是容器访问存储网关所需的通道；Worker 仍强制核验短期 HS256 capability，并限制用户、训练记录、运行编号、文件名与操作。该路径没有合法 capability 会返回 401；不要绕过整个站点或 `/api/*`。保留整个主应用的登录保护。

私有 R2 桶不要启用 `r2.dev`、公共自定义域名或公共访问策略。浏览器只访问同源 Worker，无需为 R2 开放 CORS。

## 3. 生成实际部署配置

把下面参数替换成账号里的真实值：

```sh
npm run cloud:configure -- \
  --origin https://你的域名 \
  --team-domain https://你的团队.cloudflareaccess.com \
  --aud 你的Access应用AUD \
  --db-id 你的D1数据库UUID
```

生成的 `wrangler.local.jsonc` 已被 Git 忽略。它设置自定义域名路由；`workers.dev` 和预览链接默认关闭。配置模板中空白值是尚未提供的账号信息，不能直接部署为可用站点。

```sh
npx wrangler d1 migrations apply courtiq --remote --config wrangler.local.jsonc
npx wrangler secret put INTERNAL_SECRET --config wrangler.local.jsonc
```

在终端秘密输入至少 32 字符的随机值；可先用 `openssl rand -hex 32` 生成。不要放入 Git、截图或聊天记录。Worker 将该值通过容器环境传给私有服务。

```sh
npm run cloud:seed
npm run cloud:seed -- --remote
npx wrangler r2 bucket lifecycle add courtiq-private courtiq-incomplete sessions/ --abort-multipart-days 1 --force
```

第一条只验证已有模型的固定哈希、不上传；第二条才上传两个真实模型。需要公开来源的流程验证视频时，额外执行 `npm run cloud:seed -- --remote --example`。这只增加私有账号内的真实上游样本，不会公开学生录像。超过一天的未完成分片由生命周期规则清理，未完成导入由 watchdog 清理。

## 4. 构建和部署

```sh
docker build --platform linux/amd64 -t courtiq .
npm run cloud:check -- --configured
npm run cloud:deploy
```

第一次构建会安装 Linux CPU 版 PyTorch 与 FFmpeg，下载量较大。镜像不含原片或权重；运行任务时按 capability 从 R2 获取，并核对固定模型哈希。两个实例最多支持一个推理任务和一个统计/预览服务，其他任务等待，不会无限扩容。

## 5. 上线验收

1. 未登录访问主域名应进入 Access 登录；未携带 capability 访问 `/internal/storage/source.mp4` 应返回 401。
2. 使用允许的邮箱登录，在“系统与来源”刷新运行状态，检查真实依赖与模型就绪。
3. 上传一段自己有权使用的录像，暂停、再次选择同一文件，确认续传与预览；切换中英文。
4. 保存球场标定，先分析前 5 秒，关闭网页后重新打开，检查任务继续运行。
5. 完成后播放分析视频、拖动进度、导出 CSV/JSON/图表，进入统计研究，保存人工观察记录。
6. 使用第二个允许的账号登录，确认无法看到第一个账号的档案或访问其文件链接。
7. 在测试任务中重启容器，确认未提交任务可重试、已提交结果仍可恢复。检查 Cloudflare 日志与实际 CPU/存储账单。

本机额外集成验证：

```sh
npm run test:integration
# 同时验证真实羽毛球轨迹模型：
COURTIQ_TEST_SHUTTLE=1 npm run test:integration
```

该命令使用临时 D1/R2、真实 Python 子进程与真实现有模型，验证续传、标定、推理、结果保存、进程重启恢复、统计与字节范围播放；不修改本地训练库。需要 README 中的模型及真实上游样本。

## 验证边界与维护

- Worker 编译、本地 D1/R2 集成与 Python 回归可以在没有 Cloudflare 账号时验证。真实 Linux 镜像、Access 策略、Containers 配额与生产性能必须在具备 Docker 和实际账号后验收；不能把本地通过写成已经上线。
- 登录信息不是匿名作品集链接。申请展示可录制系统操作，或在明确获得影像授权后另做公开展示；当前实现不会自动发布私人录像。
- 本地 `data/` 不会自动迁移到云端，也不会与云端双向同步；可重新导入原片。D1 元数据与 R2 文件共同构成训练档案，备份时需同时保留。
- 更新数据库时新增迁移文件，勿改已在生产应用过的迁移；当前 `0001.sql` 用于首次上线。
- 若遇到 403/登录 HTML 导致下载失败，先核查具体的内部路径 Bypass 应用与 `PUBLIC_ORIGIN`；不要关闭主应用的认证。模型校验失败时重新上传正确文件。队列中断时 watchdog 会补发，超时与重启超过上限会显示失败，不会生成虚构结果。
