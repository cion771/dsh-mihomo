# DSH 专用代理 / DSH-only Proxy

原创的 DSH Cordis Host/Client 插件，参考 Clash Verge Rev 的“内核 + 订阅 + 节点”管理思路。没有复制该项目的代码或图标。

## 使用

安装后在 **设置 → DSH 专用代理**（安装器报告 `restart-required` 时，需要重启 DSH Host，再刷新页面；仅刷新浏览器不能重新加载 Host 模块）：

1. 点击 **下载并校验内核**，下载官方固定版本 Mihomo v1.19.32。仅支持 Windows x64（通用 v1 CPU 构建）和 ARM64；无需管理员权限。
2. 输入订阅的 **Clash/Mihomo YAML** 地址，或粘贴含 `proxies` 的配置，然后导入。无需把订阅或密码发到聊天。
3. 从自绘的节点列表里选一个节点，点击 **启动 DSH 代理**，再点击 **测试 DSH 连通性**。启动后可点 **检测延迟** 逐个测量节点往返延迟：结果按毫秒显示在列表里，绿色 <300ms、黄色 >800ms、红色表示不通。检测最多并发 8 个节点、整体 18 秒内返回，未测完的节点标记为超时。
4. 节点列表是本插件自己渲染的（不是系统 `<select>` 弹层），因为原生弹层在深/浅主题下无法可靠着色，选中行会变成不可读的蓝底深字。列表支持点击选择、方向键移动、Enter 确认、Esc 关闭、点击外部关闭。
4. 导入或更新节点前，先停止。停止恢复启动代理前的 dispatcher 策略（不保证原策略本身是直连）。
5. “随插件加载自动启动”默认关闭，启用后下一次挂载插件会自动使用已保存内核与节点。停止不会重置该偏好。

## 精确范围

- **代理：** 同一 DSH Host 主进程中使用 Node 全局 HTTP dispatcher 的 `global fetch`，包括采用它的模型/API 和 HTTP SDK 请求。影响该 Host 的所有会话，不是仅当前会话。
- **不会改：** Windows 注册表、WinINET/WinHTTP 系统代理、网卡、路由、防火墙、TUN。不会设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或改变子进程环境。
- **不覆盖：** 内置/外部浏览器、外部命令和 SDK 独立网络栈、其他 DSH 进程、worker、`node:http` 遥测、独立/显式 dispatcher。当前 DSH 自带 `web_fetch` 的地址钉扎传输也是一个明确例外；不要把它的失败误判成模型代理失败。
- 回环地址、`.localhost`、`.local` 及私有 IP 字面地址直接连接。其他域名由 Mihomo 代理解析；本地网络的自定义域名不自动加入直连名单。
- 只接管支持范围，不宣称全进程流量强制隔离或完整 kill switch。运行中的内核意外退出时，不自动恢复直连；公开 fetch 会通过关闭的本地端口失败，显式停止恢复原策略。启动完成前尚未接管；启动失败也恢复原策略。
- 同一机器的其他程序不会自动使用此代理。Mihomo 的本地 mixed-port 还有随机认证，controller 另有独立随机 secret，不对前端公开。

## 订阅格式和安全配置

仅导入 `proxies` / `payload` 节点数组或 YAML 节点数组。导入远端节点不等于认可服务商安全：其服务器可以观察出口请求的网络元数据。请只使用信任的订阅。

不支持 provider-only 配置、Base64/URI 列表、自动订阅转换、规则订阅或完整 Clash 配置保留。订阅通常需要在服务商页面选择 Clash/Mihomo 格式。地址要求 HTTPS；本地地址可以 HTTP。文件证书、代理串联、接口绑定、脚本和未知外部插件被拒绝。

**保留服务商必需的节点选项。** 很多机场的节点地址是私有域名（例如 `sailing.node`），只能由订阅自带的加密 DNS 解析；同时节点普遍要求 `skip-cert-verify: true`。早期版本为了“更安全”丢弃 DNS 并把该选项强制改为 `false`，结果导致**所有节点都无法连接**。现在这两项按订阅原样保留，因为改写它们等于让订阅不可用：

- **DNS**：只保留解析节点地址所需的部分（`proxy-server-nameserver` 与 `proxy-server-nameserver-policy`），并把 `enhanced-mode` 固定为 `normal`。`fake-ip`、`use-hosts`、通用 `nameserver-policy` 与任何 DNS 监听仍然丢弃。
- **TLS**：节点自带的 `skip-cert-verify` 会被保留。界面会显示有多少个节点关闭了证书校验。关闭后，到代理节点的这段 TLS 无法被验证；链路上的第三方可观察元数据（目标站点的 HTTPS 仍是端到端加密）。若你无法接受，请换用不要求该选项的服务商。

生成全新受控 YAML：仅 `DSH` 选择组和 `MATCH,DSH` 规则，loopback bind，禁止 LAN；TUN、DNS 监听及其他代理端口均关闭。订阅的 TUN、规则、监听、controller、脚本和 external-ui 等配置不会被传给内核。

启动会先验证链路：先让内核自测所选节点，再用 DSH 自己的 global fetch 实测一次。任一步失败就**自动回滚**到启动前的 dispatcher 并报出真实原因，避免把 DSH 自身的模型请求困在坏代理里。

内核子进程使用严格环境白名单，不继承 `CLASH_*`（包括能执行 post-up/down 脚本的变量）、`SAFE_PATHS`、系统代理变量或 PATH。只运行插件管理的绝对路径可执行文件；下载校验前不会执行它。归档采用下载大小与解压大小限制，仅允许一个 Mihomo EXE，不把归档目录写入磁盘。

## 数据与凭据

运行时文件由插件存储在当前 `DSH_PROFILE_DIR/data/dsh-mihomo`；无 profile 时是用户 `.dsh/data/dsh-mihomo`。包含官方内核、完整性记录、节点与订阅状态、生成配置。订阅 URL、节点密码和运行 secret 属于本机敏感数据；JSON/YAML **不是加密存储**，继承该用户目录的 Windows 权限，创建文件在支持的平台上使用 0600。不要上传此数据目录或给予其他账户访问权限。插件卸载默认不删除凭据或内核，避免意外数据丢失；可以在停止并卸载后手动删除这个专用目录。

UI 不回显保存的订阅地址或节点凭据，不记录到会话。`dsh_proxy` agent 工具提供相同操作；**工具输入会被 DSH 会话记录**，因此导入凭据请优先使用 UI。状态和工具输出只含节点名称、类型与必要状态，不含 URL、服务器和密码。网络/内核错误采用不包含原始配置的信息。

官方归档 SHA256 取自精确版本的 GitHub Release asset digest，先校验后解压，启动前再次校验 EXE。该校验可检测损坏，但不是独立发行者签名，也不能抵御发布账号与 metadata 同时被攻破。内核固定版本而非静默升级；替换内核必须先停止。

## 排障

连接失败时按此顺序看：

1. **节点延迟**：`测试` 会先让内核自测节点，再实测 DSH 的 global fetch。若内核自测就失败，问题在节点或订阅（例如节点地址解析不了），换节点或重新导入。
2. **节点域名解析**：如果订阅用私有域名做节点地址，必须保留其 DNS 配置。若状态里 `proxyServerDns` 显示 `system`，而节点地址是私有域名，就会全部连不上——重新导入订阅即可。
3. **证书校验**：状态里的 `tlsVerificationDisabled` 显示有多少节点要求跳过校验。
4. **内核下载**：沿用插件加载时的 DSH 网络策略，不会绕过 HTTPS 验证。GitHub 返回 502 时检查当前网络后重试；校验失败不会安装或执行任何文件。若通过本地 HTTPS 网关访问 GitHub，Windows 信任其证书并不代表 Node 也信任——在 DSH 启动环境中用 `NODE_EXTRA_CA_CERTS` 指向你确认可信的 CA 并重启 DSH。**不要**设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
5. **内核日志**：运行日志写在数据目录的 `core.log`（已截断到最近一次启动）。内核意外退出时，界面会显示脱敏后的最后错误行。

## 生命周期

正常停止或插件卸载会解除 dispatcher 并结束所拥有的内核。只有当全局 dispatcher 仍是本插件实例时才恢复原值，避免覆盖后来其他插件的网络策略。异常强杀 DSH/系统断电不是正常卸载，Windows 下可能残留非监听系统代理的 Mihomo 子进程；必要时在任务管理器结束它。不要同时运行多个同名插件实例。

## 开发与验收

`npm test` / `node --test test/*.test.js`。Client 是原生动态模块，仅加载页面已有 React，使用 DSH settings slot、locale、主题变量，不需要另起 Web 服务。API 通过 DSH 已认证的 `/api` exact-fetch 路由，UI 与 agent 工具都调用同一 Host controller。

测试分三层，共 20 项：

- **Host 策略**（`test/policy.test.js`）：节点校验、DNS 清洗、TLS 选项保留、凭证与代理环境隔离、日志脱敏。
- **Host 控制器**（`test/controller.test.js`）：真实 dispatcher 的带认证 CONNECT、本地直连、安装校验、启动回滚、延迟并发上限。
- **Client 界面**（`test/client.test.js`）：用 jsdom + 页面同版本 React 18 真实渲染设置页并模拟点击，覆盖"点节点能选中并应用""Esc/点外关闭""延迟数值渲染"，以及一条静态约束——**任何控件的文字颜色都不允许使用背景 token**（这个撞色 bug 出现过两次）。

`devDependencies`（jsdom、react、react-dom）只用于跑测试，不随插件分发。界面在真实 DSH 页面里的最终观感仍需人工确认：本环境的内置浏览器缺少 Electron 运行时，无法截图。

需要真实用户订阅才能验收最终出口连接；测试专用节点或直连夹具不等于服务商节点可用。

## 许可与参考

插件代码和原创图标：MIT。Mihomo 固定版本 v1.19.32：GPLv3；不会打包其二进制，由用户显式操作从官方 Release 下载。[第三方说明](./THIRD_PARTY.md)。

- https://github.com/clash-verge-rev/clash-verge-rev
- https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.32
- https://wiki.metacubex.one/en/api/
