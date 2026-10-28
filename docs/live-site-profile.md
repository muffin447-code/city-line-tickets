# 核对并配置真实 Cityline 页面

`config/cityline.example.json` 是未验证模板。它不是当前 Cityline 页面的逆向结果，也不证明美国 +1 或 DuoPlus 短信兼容性。

## 本机配置

1. 将例子复制为 `config/cityline.local.json`。该文件被 Git 忽略，不提交个人资料或浏览器档案。
2. 在你自己的浏览器打开官方账号和实际抽签报名页面，确认最终 URL 都是 Cityline HTTPS 域名。活动说明页面不等于报名表。
3. 记录账号流程与抽签流程中的真实字段、按钮和成功提示。填入 `accountUrl`、`ballotUrl` 及 `selectors` 对象。保持 `verified:false`，直到完整核对结束。
4. 核对 `phoneFormat`：`e164` 写入带 + 的完整号码；`national` 写入不带国家区号的本地号码。若页面有国家区号下拉框，填写实际字段及 `countryOptions` 的对应选项值。固定区号页面需要准确设置 `fixedCountryCode`。
5. 对注册所需的 OTP、密码、图形验证及条款，按真实页面配置对应字段或成功标记。不存在的可选步骤保持为空，不要添加猜测选择器。
6. 必须实际确认**只有点击 `accountSubmit` 才会创建账号**，再将 `accountCreationTrigger` 设为 `accountSubmit`。如果发送验证码、填满验证码或另点验证按钮就会创建账号，当前驱动不支持该建号语义；不能仅修改这个字段绕过适配。
7. 每一个配置了的 OTP 普通操作，都必须先核实它不会创建账号或接受条款，再将对应标记设为 `true`：`accountSendOtpIsNonConsequential` 对应发送验证码按钮；`accountOtpInputIsNonConsequential` 对应验证码输入；`accountVerifyOtpIsNonConsequential` 对应独立验证码验证按钮。默认的 `false` 表示尚未核实，程序会在启动浏览器前拒绝执行。
8. 若真实流程有**独立且不会建号的验证码验证步骤**，配置 `accountVerifyOtp` 及其后出现的 `accountVerified` 标记。它不能与最终 `accountSubmit` 或 `accountSuccess` 混用。若验证后需跳到资料补全页，填写 `accountDetailsUrl`；如网站自己导航到后续资料页，可留空该 URL 并配置 `accountInitialEmail`，驱动会等后续资料字段后继续。初始阶段只填写邮箱，验证后才填写 `accountFullName`、`accountEmail`、`accountPhone` 等已配置字段。后续邮箱字段必须仍是与该参与者一致的可编辑或只读输入框；静态文本、iframe 或新窗口分支需要继续适配。
9. 条款可填一个复选框选择器或复选框选择器数组，由你在本地浏览器逐项处理。独立验证码验证不会替代最终账号创建的当次确认。
10. 核对 `accountSuccess`、`ballotSuccess` 和可选的 `ballotConfirmationNumber`。若初次打开时已经登录，必须配置 `accountIdentity`，其可见文本须准确匹配当前参与者的邮箱，才能跳过注册；通用头像或登录导航不够。页面显示成功仍不等于实际收到了官方确认邮件；程序最后会要求确认邮件中的编号，并保留 `user_reported` 来源。

## 启用条件

当 URL、字段、步骤、真实建号触发点、各 OTP 操作语义和结果标记都已由你核实后，给配置填写新的 `revision`，再将 `verified` 改为 true。在本机 `.env` 设置 `CITYLINE_ALLOW_LIVE=true`，重启服务。此时仍应从一位参与者、一个真实任务开始，观察实际页面，每个当前确认步骤单独继续。

普通字段会在 `timeoutMs` 内等待可见与可用。打开账号页、发送验证码、独立验证码验证和最终提交后，也会有界等待已配置的相应状态标记。这些等待处理正常的 SPA 延迟渲染，但不会猜测未知页面结构或自动重发可能已经产生效果的操作。超时后仍需查看浏览器与官方记录。

独立 OTP 验证后会记录会话内的已验证状态。后续资料页新出现的密码和图形验证仍会交给你现场处理，完成后继续检查条款；不会为了进入这些步骤而再次发送、询问或验证同一个 OTP。后续页的图形验证会重新核对，初始页的人工确认不自动替代它。

驱动默认仅允许 Cityline HTTPS 请求。第三方组件会被阻止，可能影响验证码、字体或其他资源；这意味着需要进一步针对实际网站适配，不能视为程序已支持完整真实流程。不要为了让演示看起来成功而放宽为所有域名。

## 需要你现场完成的步骤

- 密码在本地页面填写，不经 GPT、API 请求或日志传递。
- 图形验证码在本地页面完成。没有可验证的完成标记时，程序只能记录你报告已完成，最终是否通过由实际表单受理结果决定。
- 条款复选框由你在页面阅读并处理；驱动检查相应状态，不代你自动接受。
- 建号与抽签最终提交，各需要一次针对当前动作的明确确认。确认 ID 绑定当前任务和阶段，不可复用。

如果网站流程与模板结构不同，例如多个独立 OTP、输入 OTP 即自动建号、验证链接、不同国家分支、嵌入第三方认证或新窗口注册，需要修改驱动并补测试。只填入选择器或将语义标记设为 true，不会自动适配这些流程。

## 重启与结果不明

本机任务记录与浏览器步骤可能因断网、重启或页面重绘而不一致。程序会停在需恢复核对的状态；先查实际账号状态、已提交记录和确认邮件，再决定如何继续。不要直接创建第二个任务或反复提交。

官方活动说明：[Online Registration for Ballot Ticketing](https://cultural.cityline.com/en/2026/baleasonregchan.html)。
