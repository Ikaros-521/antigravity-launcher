# Antigravity Launcher · 反重力代理启动器

给 Google Antigravity 桌面客户端用的**进程级代理启动器**。它不接管整机网络，只在启动 Antigravity 的那一刻把代理信息塞进它的进程树。

A process-local proxy launcher for the Google Antigravity desktop client. It gives Antigravity and its child processes their own proxy environment instead of putting the whole machine behind TUN.

支持 Windows / macOS / Linux。不开 TUN，不改系统代理，不需要管理员权限。

## 下载 / Download

**安装包请到 [Releases](https://github.com/Ikaros-521/antigravity-launcher/releases) 页面下载**，每次打 tag 由 GitHub Actions 自动构建并上传三平台产物：

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `*-Setup-*-win-x64.exe` | NSIS 安装器，可选安装目录 |
| Windows | `*-win-x64.exe`（portable） | 免安装单文件 |
| macOS | `*-mac-arm64.dmg` / `*-mac-x64.dmg` | Apple Silicon 与 Intel，另有同名 `.zip` |
| Linux | `*-linux-x64.AppImage` / `.deb` | 含 arm64 版本 |

Please download installers from the Releases page. macOS builds are **not signed or notarised** — see [macOS 放行](#macos-放行--gatekeeper).

## 为什么需要它

Antigravity 不是一整个进程。真正发请求的是 `resources/bin/language_server`（Go 写的），OAuth、`loadCodeAssist`、`fetchAvailableModels`、模型流式输出全部走它。

问题在于这三套网络栈找代理的方式互不相通：

| 层 | 怎么找代理 |
|---|---|
| Electron / Chromium | 读操作系统的"系统代理"设置 |
| Go `net/http` | **只读环境变量**，读不到注册表 |
| Node 核心 `https` | 两者都不读 |

所以"我系统代理明明开了，反重力还是连不上"是必然结果：Go 那一层压根不看注册表，于是直连，于是 DNS 污染和 TLS 重置。典型日志是 `getaddrinfo ENOTFOUND daily-cloudcode-pa.googleapis.com` 和 `Client network socket disconnected before secure TLS connection was established`。

环境变量只能在**创建进程时**继承，无法事后注入正在运行的进程。这就是为什么必须由本工具来启动 Antigravity，也为什么必须先退干净旧实例。

## 它做什么

1. **定位客户端** — 扫描各平台常见安装目录，并用同目录下的 `resources/bin/language_server` 二次确认，避免认错同名程序。macOS 会读 `Info.plist` 的 `CFBundleExecutable` 拿到真实内层二进制。找不到就手动指定，结果会记住。
2. **验证代理** — 先读系统代理（Windows 注册表 / macOS `scutil --proxy` / Linux `gsettings` + 环境变量），再扫常见本地端口。每个候选都要通过**真实握手**：同时尝试 HTTP CONNECT 和 SOCKS5，对 `accounts.google.com` 和 `daily-cloudcode-pa.googleapis.com` 两个目标分别验证，据此判定 `http` / `socks5` / `mixed` / `dead`。端口能连上不等于它是可用代理，这里不靠猜。域名交给代理解析，因为本机 DNS 正是被污染的一环。
3. **检查残留实例** — 有未注入代理的实例在跑就亮红并给出终止按钮，不会假装启动成功。
4. **启动** — 注入 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 及小写变体，附带 `--proxy-server` 把 Chromium 层也钉在同一端点，然后拉起进程。界面下方会预览将要写入的完整变量表。

`NO_PROXY` 固定包含 loopback。这不是可选项：Antigravity 的 UI 由本地 Go 服务在 `127.0.0.1` 提供，OAuth 回调也监听 localhost，代理接管回环地址会直接白屏。

## 使用

```bash
npm install
npm start
```

打开后自动完成探测，三条通道全绿即可点底部启动条。代理端口非典型时用「手动指定」填 `http://127.0.0.1:12345` 或 `socks5://127.0.0.1:12345`。

## 界面

- **主题** — 自动（跟随系统）/ 浅色 / 深色三态，右上角切换，默认自动。
- **语言** — 中 / EN 切换，默认中文。日志按 key 存储，切换语言时历史日志会一并重译，不会留下中英混杂。
- **窗口** — 无边框自绘标题栏。顶部可拖拽移动，四边与四角可拉伸，右上角提供最小化 / 最大化还原 / 全屏 / 关闭；`F11` 切全屏，双击标题栏最大化。macOS 保留系统红绿灯按钮。
- **开销** — 窗口最小化或隐藏时暂停全部动画（环境光斑、隧道脉冲、扫光、状态灯呼吸）并停止聚光灯跟踪；恢复可见即继续。

两项偏好都存在本地，不影响 Antigravity 本身。

## 打包

日常使用不需要本地打包，直接去 [Releases](https://github.com/Ikaros-521/antigravity-launcher/releases) 拿安装包。推 `v*` 标签会触发 `.github/workflows/release.yml`，在三个 runner 上分别构建并汇总成一个 Release。

自己构建：

```bash
npm run dist:win      # NSIS + portable
npm run dist:linux    # AppImage + deb
npm run dist:mac      # dmg + zip
```

**mac 包必须在 macOS 上打。** Electron 不支持跨平台产出 mac 产物，所以由 CI 的 macos runner 负责。

图标：`build/icon.ico`（16–256 多尺寸，PNG 压缩条目）、`build/icon.png`（1024，圆角外透明）、`build/icon_<size>.png` 各尺寸。改动源图后重新生成：

```bash
npm run icons
```

### macOS 放行 · Gatekeeper

本项目未做代码签名与公证，接收方首次打开会被 Gatekeeper 拦住。三种处理方式：

1. 右键 App 图标 → **打开** → 再点一次「打开」；
2. 终端执行 `xattr -d com.apple.quarantine /Applications/Antigravity\ Launcher.app`；
3. 系统设置 → 隐私与安全性 → 点「仍要打开」。

应用内界面在 macOS 上也会直接显示这段提示。要彻底消除，需要 Apple Developer 账号做签名 + notarization。

## 安全边界

- 只影响被启动的那一棵进程树，退出即消失；
- 不写注册表、不改系统代理、不装虚拟网卡；
- 不关闭任何 TLS 校验或系统安全机制；
- 渲染进程启用 contextIsolation 与 sandbox，主进程与页面之间只暴露固定的 IPC 接口；
- 代理凭证不会出现在界面和日志里（显示为 `***`）。注意带凭证的代理只有环境变量路径有效，`--proxy-server` 无法携带认证信息。

## 说明

进程级注入这个思路来自 [peroperoyui-lab/antigravity-proxy-launcher](https://github.com/peroperoyui-lab/antigravity-proxy-launcher)（MIT）。本仓库是独立的 Electron 图形界面实现，不含该项目的脚本代码，并在探测上做了扩展：真实握手校验取代端口连通性探测、双目标分别验证、macOS/Linux 支持。

## License

MIT
