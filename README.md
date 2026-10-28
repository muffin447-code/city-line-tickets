# Cityline GPT Bridge

围绕同一位参与者的本地浏览器登记程序。你可以从 ChatGPT 自定义 GPT 或 Codex 提交资料，创建任务、启动浏览器流程、提交当前验证码并查看进度。

基于 [Microsoft Playwright](https://github.com/microsoft/playwright) 的开源浏览器自动化能力，使用 Node.js 自带 HTTP 服务。项目不调用 OpenAI API，也不需要 OpenAI API key。

**当前提供完整源码和可运行的本地演示。真实 Cityline 适配默认关闭，实际页面、区号和短信通道尚未验证，不能将本项目视为已经完成真实注册或抽签。** GitHub 仓库与 ChatGPT 接入也不会自动创建。

## 已实现

- 单人资料校验、任务持久化、已有任务恢复和重复任务防护。
- HTTP API 与 GPT Actions OpenAPI；本地 stdio MCP 与四个 Codex 工具。
- 本地完整演示：注册验证码 → 条款人工步骤 → 建号确认 → 抽签图形验证 → 条款人工步骤 → 登记提交确认 → 用户提供确认邮件编号。
- 可配置的 Playwright 真实页面驱动。页面配置缺失或尚未验证时返回 blocked。
- 每个当前挑战独立续跑。验证码只在本次请求和内存中使用，不写入任务日志。
- 私有数据目录加独占进程锁；两个服务不能同时执行同一份登记。服务中断后，进行中的任务进入待核对状态。

## 快速开始

需要 Node.js 22 或更新版本：

```bash
npm install
npm run init
npm test
npm run demo
```

`init` 创建本机私有 `.env` 和服务令牌；不要提交到 GitHub。`demo` 使用虚构资料和临时状态，完整走过模拟流程，不访问 Cityline。

启动长期运行的本机服务：

```bash
npm start
```

默认只监听 `127.0.0.1:8787`。打开本机控制页后，可先使用演示模式查看流程。服务需要保持运行，浏览器执行任务时也需要所在电脑在线。

## 聊天入口

| 入口 | 接入材料 | 还需要的设置 |
|---|---|---|
| ChatGPT 自定义 GPT | `integrations/openapi.json`、`integrations/gpt-instructions.txt` | 你控制的已认证 HTTPS API 入口与 GPT Action 配置 |
| 当前 Codex 聊天 | `integrations/mcp.mjs`、`integrations/codex.example.toml` | 本机服务与本地 stdio MCP 配置 |

步骤见 [ChatGPT 配置](docs/chatgpt-setup.md) 和 [Codex 配置](docs/codex-setup.md)。源码没有替你部署服务、打开公网入口、安装 MCP 或发布 GitHub 仓库。

本次本机部署选择 Codex：已启用 `cityline_single` 配置，并用相同启动入口验证了四个工具和完整模拟流程。客户端仍需重新加载 MCP／重启后，才能在聊天中发现新工具。ChatGPT 自定义 GPT 的公网接入暂不部署；上表中的对应材料作为可选源码保留。

## 接入真实 Cityline

本次官方活动说明没有给出可直接使用的全部报名字段和账号流程，因此配置例子中的真实选择器留空且 `verified:false`。先按 [真实页面配置说明](docs/live-site-profile.md) 在本机核对当前页面，再开启 `CITYLINE_ALLOW_LIVE`。首次安装浏览器可使用官方包命令：

```bash
npx playwright install chromium
```

真实页面驱动只允许 Cityline HTTPS 页面。密码、图形验证、条款确认需要你在本地页面完成；建号与提交抽签需要针对当前动作确认。它不接码绕过、不伪造身份、不购票、不付款。美国 +1 是否受理、DuoPlus 是否能收到 Cityline 短信，仍须实际核验。

## 资料与结果

参与者资料保存在本机私有数据目录，聊天工具只返回遮蔽后的姓名、邮箱和号码。输入到 ChatGPT/Codex 的资料仍受相应产品的数据处理规则约束；通过 GPT Action 提交时也会传到你配置的服务。真实模式填表时，必要资料会进入 Cityline。

`completed` 必须结合证据解读：`mode=demo` 只代表模拟完成；`evidence.source=user_reported` 代表记录了你提供的确认邮件编号，服务没有独立读取邮件。登记完成不等于中签或购票完成。

`.env`、`.data`、浏览器档案、日志和参与者文件均被 `.gitignore` 排除。公开前仍应检查提交清单，只发布源码及虚构示例。

进程异常停止留下锁时，先在本机确认旧服务已经停止，并核对浏览器与邮件。随后可运行 `npm run unlock -- --reviewed`；恢复工具拒绝解除仍在运行的进程锁。它不会重新提交任务，中断的任务仍须人工核对。

## 验证记录

42项测试通过，包含自启动本机服务、真实 MCP 子进程 → 本机 HTTP 服务 → 完整模拟注册与登记流程，以及页面延迟和多步账号验证的回归检查。另通过实际配置的 Codex 启动命令完成一次本机模拟。浏览器驱动使用离线替身测试，未在 Cityline 真实页面执行注册或提交。详见 [验证范围](docs/validation.md) 与 [自动化审计](docs/automation-audit.md)。

## 开源

本项目源码按 MIT License 提供；Playwright 使用其自身的 Apache-2.0 License。你可以将源码上传到自己的 GitHub。CI 仅安装依赖并运行测试，不会运行真实 Cityline 流程或接触参与者资料。

官方参考：[GPT Actions](https://developers.openai.com/api/docs/actions/introduction)、[Action 认证](https://developers.openai.com/api/docs/actions/authentication)、[HTTPS、超时与确认要求](https://developers.openai.com/api/docs/actions/production)、[Codex MCP](https://developers.openai.com/codex/mcp)。
