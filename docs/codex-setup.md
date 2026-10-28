# 接入当前 Codex 聊天

本项目的本地 MCP 入口会检查并按需启动本机服务，再提供四个任务工具。它不会自行注册到 Codex。Codex 支持本地 stdio MCP 进程及环境变量配置。[官方 MCP 文档](https://developers.openai.com/codex/mcp)

1. 按 README 安装 Node 依赖，执行 `npm run init`。使用 `integrations/local-mcp.mjs` 时，不必另外运行 `npm start`；本机 API 默认位于 `http://127.0.0.1:8787`。
2. 查看 `integrations/codex.example.toml`，把三个 `/ABSOLUTE/PATH/…` 改为实际绝对路径。Node 不在 Codex 的 PATH 时，`command` 也改为 Node 的绝对路径。
3. 通过 Codex 的 MCP 设置添加本地 stdio 服务，或手动把示例表格合并到你自己的 MCP 配置中。不要覆盖已有配置；本项目不会自动修改它。
4. 重启或刷新 MCP 连接，确认能发现 `create_cityline_task`、`get_cityline_task`、`start_cityline_task`、`resume_cityline_task` 四个工具。
5. 对 Codex 说：“使用 cityline_single，为同一位参与者运行 demo；遇到当前验证或确认步骤时停下来问我。”先用虚构资料验证。

`integrations/gpt-instructions.txt` 中关于参与者、确认和结果陈述的规则也适用于 Codex。可以把这些规则加入你为本工具设定的说明，不必把任何私密资料放进长期配置。

## 环境变量

MCP 使用 `CITYLINE_BRIDGE_TOKEN` 认证本地 API。示例通过 Node 的 `--env-file` 从私有 `.env` 读取；程序不重新解析或复制令牌。服务端口不为 8787 时，在同一个私有文件里设置匹配的端口与地址：

```dotenv
CITYLINE_PORT=8788
CITYLINE_BRIDGE_URL=http://127.0.0.1:8788
```

本地自启动入口仅接受 `http://127.0.0.1` 及配置的端口，拒绝远程地址、URL 中的账户密码、查询参数和重定向。`CITYLINE_BRIDGE_URL` 可以省略，省略时按 `CITYLINE_PORT` 生成。本机服务的资料目录、网站配置、真实模式开关及可选公开 origin，沿用服务端相同的 `CITYLINE_DATA_DIR`、`CITYLINE_PROFILE_PATH`、`CITYLINE_ALLOW_LIVE`、`CITYLINE_PUBLIC_ORIGIN` 设置；真实模式仍默认关闭。

## 服务生命周期

- 如果端口未监听，本地 MCP 在同一进程创建自己的服务，并遵守私有资料目录的进程锁。
- 如果端口已有服务，必须先用当前 Bearer token 访问一个不存在的任务，得到预期 `404 / NOT_FOUND`，才会复用该服务。
- 认证失败、端口上是别的程序、响应超时或资料目录已经锁定时，会停止；不会终止已有进程、删除锁或默默换端口。
- MCP 输入关闭后，仅关闭它自己创建的服务。复用的已有服务继续运行。
- 若希望连接已经独立部署的远程 HTTPS 服务，使用 `integrations/mcp.mjs` 转发入口并按其设置配置；这与本地自启动入口是不同模式。

## 验证与排查

- `npm test` 包含不访问外网的 MCP 协议及转发测试。
- MCP 标准输出只用于一行一个 JSON-RPC 消息，不应加入启动横幅或调试日志。
- 若提示本地启动失败，检查端口、私有资料目录锁和 `.env` 是否匹配。不要把 `.env` 内容粘贴到聊天中，也不要未经核查删除已有锁。
- 工具列出成功不等于网站自动化完成。`live` 默认被禁用，且真实 Cityline 配置必须先验证。
