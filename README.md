# 视频文案工具 by 以太Max

本地运行的视频下载和文案提取工具，支持：

- 粘贴抖音短链、长链或整段分享文案
- 内置 `wujunwei928/parse-video-py` 多平台解析源码，可扩展小红书、B站、快手、微博等平台
- 下载原视频
- 使用 Qwen3-ASR 0.6B 提取视频文案
- 自动识别 GPU，支持 CUDA 时优先使用 GPU

## 使用方式

1. 安装 Python 3.11、Node.js 20+、ffmpeg。
2. 双击 `start.bat` 或 `启动工具.bat`。
3. 工具会自动检查运行环境；缺少依赖或模型时会自动安装。
4. 安装完成后浏览器会打开 `http://127.0.0.1:3666/`。

## 从 GitHub 使用

普通用户不需要你打包 `.venv`、模型、下载文件或缓存。

1. 安装基础软件：
   - Windows 10/11
   - Python 3.11
   - Node.js 20+
   - ffmpeg
2. 下载项目：
   - Git 用户：`git clone https://github.com/YT-smart/Ether_dy.git`
   - 非 Git 用户：在 GitHub 页面点击 `Code` -> `Download ZIP`，解压后使用
3. 双击 `启动.bat`、`启动工具.bat` 或 `start.bat`。
4. 第一次启动会自动创建 `.venv`，安装 Python 依赖，并下载 Qwen3-ASR 0.6B 模型。
5. 浏览器打开 `http://127.0.0.1:3666/` 后，粘贴视频链接即可下载或提取文案。

首次安装会下载模型和依赖，耗时取决于网络；后续启动会快很多。

## 多平台解析引擎

项目内置了 `tools/parse-video-py/` 源码，并通过当前 `.venv` 直接调用。启动脚本会自动安装解析器需要的 Python 依赖，不需要用户额外安装 Go 或编译 exe。

## 国内镜像

安装脚本默认使用：

- 清华 PyPI 镜像
- 阿里云 PyTorch wheels
- ModelScope 模型下载
- HuggingFace 国内镜像作为备用

## 发布说明

详细打包说明见 [打包发布说明.md](./打包发布说明.md)。
