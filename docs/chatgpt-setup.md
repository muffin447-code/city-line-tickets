# 接入 ChatGPT 自定义 GPT

本文件配置的是你自己的 GPT Actions。源码存在、服务启动、GPT 接入、真实网站验证，是四个独立状态；完成其中一项不会自动完成其余三项。

## 先在本机验证

按 README 安装、执行 `npm run init`、启动服务，并运行 `npm run demo`。确认本地任务流程可用。`demo` 不会发短信或访问 Cityline。

## 准备可访问的服务地址

ChatGPT Actions 需要从 OpenAI 的服务访问你部署的 API。本机 `http://127.0.0.1:8787` 不能直接作为公网 ChatGPT 的服务地址。为本地服务配置你控制的 HTTPS 入口，使用有效公开证书和 443 端口，并保留 `Authorization: Bearer` 验证。没有完成这一步时，不能从网页 ChatGPT 控制本机浏览器。[官方 HTTPS 与超时要求](https://developers.openai.com/api/docs/actions/production)

服务默认只监听本机。项目不会自动创建隧道、开放端口、发布服务或改写你的系统配置。若你决定配置反向代理，应仅代理本项目必要的路由，禁用包含请求体或 Authorization 的访问日志，并将外部主机填入服务端 `CITYLINE_PUBLIC_ORIGIN`。禁止将服务令牌放进 URL 参数。

## 导入 Action

1. 复制 `integrations/openapi.json`，将 `servers[0].url` 的保留示例域名 `https://cityline-bridge.example.invalid` 改为你实际控制的 HTTPS origin。
2. 在自己的 GPT 配置中添加 Action，导入这份 OpenAPI。
3. 在 Action 的认证设置选择 API Key，并使用 Bearer 认证。私有 key 填本机 `.env` 中的 `CITYLINE_BRIDGE_TOKEN`，不填 OpenAI API key。不要把私有 token 写入 OpenAPI、GitHub 或聊天。
4. 将 `integrations/gpt-instructions.txt` 粘贴到 GPT 的指令中；只分享给你自己使用。
5. 用虚构资料测试 `createCitylineTask`，选择 `mode=demo`，再启动并查询任务。每次当前挑战返回后，按提示完成该次输入或确认。

GPT Actions 支持 API key 等认证方式；本项目使用单一私有 Bearer token。[官方认证说明](https://developers.openai.com/api/docs/actions/authentication)

所有改变任务或操作浏览器的 POST 接口均标注 `x-openai-isConsequential: true`，ChatGPT 会在执行前要求确认。它不替代程序内每个当前挑战的确认。Actions 调用有 45 秒上限，因此启动和续跑接口快速返回任务，浏览器在后台执行，再使用 GET 查询。[官方 consequential 标记与 45 秒限制](https://developers.openai.com/api/docs/actions/production)

## 从演示切换到真实模式

先按 `docs/live-site-profile.md` 完成实际 Cityline 页面适配并验证。然后在本机将 `CITYLINE_ALLOW_LIVE=true`，重启服务，再由你明确要求以 `mode=live` 创建任务。配置例子的 `verified:false` 不能被视为已验证；助手也不应为了继续执行而改成 true。

当前源码没有证明本次活动接受美国 +1 或 DuoPlus VoIP 号码。只有实际表单和短信通道验证之后，才能描述对应支持情况。若注册最终需要密码、验证码、条款确认或图形验证，服务会停在对应步骤，按实际页面继续。

## 已知边界

- 该 GPT 必须连到你正在运行的服务，且服务所在电脑的本地浏览器仍可用。
- 项目没有自动读取 Gmail 或 DuoPlus，不会在后台收集邮箱密码；OTP 可以由你在当前对话提交后续跑。
- 提供确认邮件编号只产生 `evidence.source=user_reported`，不等于自动读取并独立验证邮件。
- 不要将这个单人服务和同一个静态 token 对外共享。多用户部署需要另行设计每用户认证、隔离和授权。
