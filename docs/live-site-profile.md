# 核对并配置真实 Cityline 页面

`config/cityline.example.json` 是未验证模板。它不是当前 Cityline 页面的逆向结果，也不证明美国 +1 或 DuoPlus 短信兼容性。

## 2026年10月28日现场记录

官网 `Events.html` 导航中的“登入”会打开弹窗，提供“电邮地址 / 登入名称”文本框和“登 入”按钮，提示可用 OTP 登录或直接开户。继续操作出现 Cityline 自有图片人机验证。用户在本地亲自完成图形验证、OTP 与会员资料提交，随后 `Member/MemberInfo.html` 显示资料更新后需重新登入；账号步骤由用户确认完成。

本轮没有完整捕获真实 OTP DOM、验证动作及它们是否直接创建账号的后果。因此，人工账号完成不能作为当前驱动自动注册已验证的依据；页面配置仍为 `verified:false`，真实模式未启用。在当日10:47（北京时间，UTC+8）的快照中，抽签尚未开放，计划11:00开放，是否必须先有账号仍待实际报名表核对。

## 本机配置

1. 将例子复制为 `config/cityline.local.json`。该文件被 Git 忽略，不提交个人资料或浏览器档案。
2. 在你自己的浏览器打开官方账号和实际抽签报名页面，确认最终 URL 都是 Cityline HTTPS 域名。活动说明页面不等于报名表。
3. 按阶段记录真实字段、按钮和成功提示。账号阶段填写 `accountUrl` 与账号选择器，不必为了准备账号而猜测尚未开放的 `ballotUrl`；进入抽签阶段前，再核对 `ballotUrl` 与抽签选择器。保持 `verified:false`，直到将要执行的阶段及其动作语义已实际核实。
4. 核对 `phoneFormat`：`e164` 写入带 + 的完整号码；`national` 写入不带国家区号的本地号码。若页面有国家区号下拉框，填写实际字段及 `countryOptions` 的对应选项值。固定区号页面需要准确设置 `fixedCountryCode`。
5. 对注册所需的 OTP、密码、图形验证及条款，按真实页面配置对应字段或成功标记。不存在的可选步骤保持为空，不要添加猜测选择器。
6. 必须实际确认**只有点击 `accountSubmit` 才会创建账号**，再将 `accountCreationTrigger` 设为 `accountSubmit`。如果发送验证码、填满验证码或另点验证按钮就会创建账号，当前驱动不支持该建号语义；不能仅修改这个字段绕过适配。
7. 每一个配置了的 OTP 普通操作，都必须先核实它不会创建账号或接受条款，再将对应标记设为 `true`：`accountSendOtpIsNonConsequential` 对应发送验证码按钮；`accountOtpInputIsNonConsequential` 对应验证码输入；`accountVerifyOtpIsNonConsequential` 对应独立验证码验证按钮。默认的 `false` 表示尚未核实，程序会在启动浏览器前拒绝执行。
8. 若真实流程有**独立且不会建号的验证码验证步骤**，配置 `accountVerifyOtp` 及其后出现的 `accountVerified` 标记。它不能与最终 `accountSubmit` 或 `accountSuccess` 混用。若验证后需跳到资料补全页，填写 `accountDetailsUrl`；如网站自己导航到后续资料页，可留空该 URL 并配置 `accountInitialEmail`，驱动会等后续资料字段后继续。初始阶段只填写邮箱，验证后才填写 `accountFullName`、`accountEmail`、`accountPhone` 等已配置输入字段。
9. 如果 OTP 页隐藏初始邮箱输入框，并以静态文本显示当前邮箱，可配置 `accountEmailIdentity`。最终账号提交的资料保护会核对该可见文本与参与者邮箱一致，并在确认前后把它加入保护摘要；文本变化会拒绝旧确认。若邮箱输入框与静态文本同时可见，两者都必须匹配。该支持不意味着可以把所有静态文本当输入框；需填写邮箱的资料页仍应配置实际输入字段。iframe 或新窗口分支仍需专门适配。
10. 条款可填一个复选框选择器或复选框选择器数组，由你在本地浏览器逐项处理。独立验证码验证不会替代最终账号创建的当次确认。
11. 核对 `accountSuccess`、`ballotSuccess` 和可选的 `ballotConfirmationNumber`。若初次打开时已经登录，必须配置 `accountIdentity`，其可见文本须准确匹配当前参与者的邮箱，才能跳过注册；它与 OTP／提交页的 `accountEmailIdentity` 作用不同，通用头像或登录导航不够。页面显示成功仍不等于实际收到了官方确认邮件；程序最后会要求确认邮件中的编号，并保留 `user_reported` 来源。

## 启用条件

当将要执行阶段的 URL、字段、步骤、真实建号触发点、各 OTP 操作语义和结果标记都已由你核实后，给配置填写新的 `revision`，再由本地维护者决定是否将 `verified` 改为 true 并启用 `CITYLINE_ALLOW_LIVE`。目前现场证据尚未满足这些条件，不应仅因人工账号已完成而改动开关。启用后仍应从一位参与者、一个真实任务开始，观察实际页面，每个当前确认步骤单独继续。

驱动会在账号启动前只校验账号阶段，在账号完成后单独校验抽签阶段。若账号已完成但抽签配置尚未核实，任务停在 `blocked / configuration_required`。原进程与原浏览器会话仍在时，维护者补全抽签配置后，可对**同一个任务再次 start**，只重试进入抽签阶段，不重新发送账号 OTP 或重新建号。不要为此创建第二份任务或复用旧挑战 ID。

普通字段会在 `timeoutMs` 内等待可见与可用。打开账号页、发送验证码、独立验证码验证和最终提交后，也会有界等待已配置的相应状态标记。这些等待处理正常的 SPA 延迟渲染，但不会猜测未知页面结构或自动重发可能已经产生效果的操作。超时后仍需查看浏览器与官方记录。

独立 OTP 验证后会记录会话内的已验证状态。后续资料页新出现的密码和图形验证仍会交给你现场处理，完成后继续检查条款；不会为了进入这些步骤而再次发送、询问或验证同一个 OTP。后续页的图形验证会重新核对，初始页的人工确认不自动替代它。

## 导航开窗与实际发送 OTP

如果账号入口先点击导航栏“登入”才显示邮箱弹窗，将这个**只打开弹窗**的按钮配置为 `selectors.accountOpenDialog`。对应 `accountOpenDialogIsNonConsequential` 默认为 false；只有确认它不发送验证码、不创建账号且不接受条款后，才能由维护者改为 true。如果邮箱表单本来已显示，可将该选择器留空。

弹窗中真正发送 OTP 的按钮仍配置为 `selectors.accountSendOtp`，并单独核实 `accountSendOtpIsNonConsequential`。这两个动作不能混用；相同文字或都叫“登入”，不代表后果相同。未知动作语义继续阻止程序执行，不能为跳过缺失配置而把导航栏按钮填进发送 OTP 字段。

## Turnstile 的最小资源放行

默认浏览器请求接收规则为 Cityline HTTPS，`allowTurnstileResources` 默认为 false。核实并明确选择开启后，对实际进入 Playwright `route` 的初始可见请求，按当前 Cityline 页面与可信子 frame 上下文判断，最小放行精确来源 `https://challenges.cloudflare.com`（HTTPS、443且无 URL 凭据），供组件脚本、子 iframe 及组件内部资源请求使用。它不是任意第三方资源列表，也不开放任意 frame 上下文。

对可见的主框架／新窗口请求仍按 Cityline HTTPS 范围核对；观察到范围外导航时停止并关闭相应页面。对进入拦截器但缺少可信 frame 或来源不匹配的请求予以拒绝，并保留阻止 Service Worker、关闭可观察 WebSocket 的设置。这个开关不会改写页面 CSP、安全响应头或浏览器安全设置，程序不直接读取、生成、替换或转交挑战 token，不调用挑战验证接口，也不代做人机验证。用户仍在本地页面完成需要人工进行的挑战。

Playwright 官方说明，重定向时路由处理器可能只接收到首个 URL。因此，上述检查只针对实际进入路由的请求，导航提交后的观察与关闭也不是请求发出前的每跳隔离；它不是网络防火墙，本项目不能据此保证全部重定向跳转的网络出站隔离。[路由能力限制](https://playwright.dev/dotnet/docs/api/class-page#page-route)

Cloudflare 官方 CSP 文档说明 Turnstile 的脚本和 iframe 使用该来源，客户端渲染文档说明官方脚本应直接由 Cloudflare 的原始地址加载。本项目不代理、缓存或注入替代脚本，不修改网站自身的集成。[CSP 参考](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)、[客户端渲染](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)

这项资源兼容支持不代表真实 Cityline 的组件已经加载成功、挑战已经通过或完整注册已验收。若页面还需要其他第三方资源，先核实并专门适配，不得为使演示通过直接放行所有域名。

## 需要你现场完成的步骤

- 一旦进入新密码流程，密码输入、确认和账号提交全过程由你在本地页面亲自完成，不经 GPT、API 请求或日志传递。驱动只等待已配置的 `accountSuccess`，再用 `accountIdentity` 核对同一参与者的邮箱；不会在你只完成密码输入后代点最终提交。
- 图形验证码在本地页面完成。没有可验证的完成标记时，程序只能记录你报告已完成，最终是否通过由实际表单受理结果决定。
- 条款复选框由你在页面阅读并处理；驱动检查相应状态，不代你自动接受。
- 由程序执行的建号与抽签最终提交，各需要一次针对当前动作的明确确认。确认 ID 绑定当前任务和阶段，不可复用；新密码分支的账号提交由你自行完成，不使用程序点击作为替代。

如果网站流程与模板结构不同，例如多个独立 OTP、输入 OTP 即自动建号、验证链接、不同国家分支、嵌入第三方认证或新窗口注册，需要修改驱动并补测试。只填入选择器或将语义标记设为 true，不会自动适配这些流程。

## 重启与结果不明

本机任务记录与浏览器步骤可能因断网、重启或页面重绘而不一致。账号完成后等待抽签配置的安全重试只适用于原浏览器会话仍在的情况；进程重启或会话丢失后会保守进入人工恢复，不重新创建账号。先查实际账号状态、已提交记录和确认邮件，再决定如何继续。不要直接创建第二个任务或反复提交。

官方活动说明：[Online Registration for Ballot Ticketing](https://cultural.cityline.com/en/2026/baleasonregchan.html)。
