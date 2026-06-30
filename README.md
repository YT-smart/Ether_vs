# 视频文案工具

本地运行的视频下载和文案提取工具，支持：

- 粘贴视频链接或整段分享文案
- 支持抖音、小红书、B站、快手等主流平台
- 下载原视频
- 使用 Qwen3-ASR 0.6B 提取视频文案
- 自动识别 GPU，支持 CUDA 时优先使用 GPU

## 使用方式

1. 下载项目：
   - Git 用户：`git clone https://github.com/YT-smart/Ether_vs.git`
   - 非 Git 用户：在 GitHub 页面点击 `Code` -> `Download ZIP`，解压后使用
2. 双击 `启动.bat`。
3. 第一次启动会自动安装运行依赖并下载文案提取模型。
4. 启动成功后会自动打开网页界面。
5. 在网页里粘贴视频链接，点击 `下载原视频` 或 `提取文案`。

如果浏览器没有自动打开，请手动访问控制台输出的地址

首次安装会下载模型和依赖，耗时取决于网络；后续启动会快很多。

## 使用环境

- Windows 10/11
- Python 3.11
- Node.js 20+
- ffmpeg

## 国内镜像

安装脚本默认使用：

- 清华 PyPI 镜像
- 阿里云 PyTorch wheels
- ModelScope 模型下载
- HuggingFace 国内镜像作为备用
