import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const JOBS_DIR = path.join(ROOT, "work", "client-jobs");
const CONFIG_PATH = path.join(ROOT, "work", "client-config.json");
const DOUYIN_SCRIPT = path.join(ROOT, "tools", "douyin", "douyin.js");
const PARSE_VIDEO_PY_DIR = path.join(ROOT, "tools", "parse-video-py");
const PARSE_VIDEO_PY_BRIDGE = path.join(ROOT, "tools", "parse_video_py_bridge.py");
const QWEN_WORKER_SCRIPT = path.join(ROOT, "tools", "asr", "transcribe_qwen_worker.py");
const MODELS_DIR = path.join(ROOT, "models");
const ASR_MODEL = "qwen3-asr-0.6b";
const ASR_DEVICE = "auto";
const PROJECT_PYTHON = fs.existsSync(path.join(ROOT, ".venv", "Scripts", "python.exe"))
  ? path.join(ROOT, ".venv", "Scripts", "python.exe")
  : "python";
const PORT = Number(process.env.PORT || 3666);

fs.mkdirSync(JOBS_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};

const cacheByInput = new Map();
const fileTokens = new Map();
let asrWorker = null;
let asrWorkerCarry = "";
let asrWorkerReady = false;
let asrWorkerStarting = null;
const asrJobs = new Map();

function defaultConfig() {
  return {
    saveDir: path.join(ROOT, "downloads"),
  };
}

function readConfig() {
  try {
    const config = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
    config.saveDir = String(config.saveDir || defaultConfig().saveDir);
    return config;
  } catch {
    return defaultConfig();
  }
}

function writeConfig(next) {
  const config = {
    saveDir: String(next.saveDir || readConfig().saveDir || defaultConfig().saveDir),
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.mkdirSync(config.saveDir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function ensureDefaultStorage() {
  const config = writeConfig(readConfig());
  return config.saveDir;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = type.includes("json") ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(payload);
}

function sendLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      shell: false,
      windowsHide: true,
      env: options.env || process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error((stderr || stdout || `Command failed with code ${code}`).trim());
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function sanitizeName(value) {
  return String(value || "douyin-video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96) || "douyin-video";
}

function parseInfo(stdout) {
  const id = stdout.match(/视频ID:\s*(.+)/)?.[1]?.trim();
  const title = stdout.match(/标题:\s*(.+)/)?.[1]?.trim();
  const url = stdout.match(/下载链接:\s*(https?:\/\/\S+)/)?.[1]?.trim();
  if (!id || !url) throw new Error(`Unable to parse video info.\n${stdout}`);
  return { id, title: title || id, url };
}

function extractHttpUrl(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/https?:\/\/[^\s"'<>，。]+/i);
  const extracted = match ? match[0] : raw;
  if (!/^https?:\/\/.+/i.test(extracted)) return "";
  return extracted;
}

function normalizeInputUrl(value) {
  const extracted = extractHttpUrl(value);
  if (!extracted) return "";

  try {
    const url = new URL(extracted);
    const modalId = url.searchParams.get("modal_id");
    if (modalId && /^\d{8,}$/.test(modalId)) {
      return `https://www.douyin.com/video/${modalId}`;
    }
    return url.toString();
  } catch {
    return extracted;
  }
}

function isDouyinUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith("douyin.com") || host.endsWith("iesdouyin.com");
  } catch {
    return false;
  }
}

function shortHash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function parseJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("parse-video returned empty output.");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error(`Unable to parse parse-video output.\n${text}`);
  }
}

async function getDouyinVideoInfo(url) {
  const result = await run("node", [DOUYIN_SCRIPT, "info", url]);
  return { ...parseInfo(result.stdout), source: "douyin" };
}

async function getParseVideoInfo(url) {
  if (!fs.existsSync(PARSE_VIDEO_PY_DIR) || !fs.existsSync(PARSE_VIDEO_PY_BRIDGE)) {
    throw new Error("多平台解析引擎源码缺失，请确认 tools\\parse-video-py 已存在。");
  }

  let result;
  try {
    result = await run(PROJECT_PYTHON, [PARSE_VIDEO_PY_BRIDGE, url], {
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
  } catch (error) {
    let bridgeMessage = "";
    try {
      const parsed = JSON.parse(String(error.stderr || error.message || "").trim());
      bridgeMessage = parsed.error || "";
    } catch {
      bridgeMessage = "";
    }
    if (bridgeMessage) throw new Error(bridgeMessage);
    throw error;
  }
  const info = parseJsonOutput(result.stdout);
  const videoUrl = info.video_url || info.videoUrl || info.url || "";
  if (!videoUrl) {
    throw new Error("这个链接没有解析出可下载的视频地址，可能是图集、平台规则变化，或链接需要登录。");
  }
  const title = info.title || info.desc || "video";
  return {
    id: shortHash(videoUrl || url),
    title,
    url: videoUrl,
    coverUrl: info.cover_url || "",
    musicUrl: info.music_url || "",
    author: info.author || null,
    source: "parse-video-py",
    raw: info,
  };
}

async function getVideoInfo(url) {
  if (fs.existsSync(PARSE_VIDEO_PY_DIR)) {
    try {
      return await getParseVideoInfo(url);
    } catch (error) {
      if (!isDouyinUrl(url)) throw error;
      console.warn(`parse-video-py failed, falling back to douyin parser: ${error.message}`);
    }
  } else if (!isDouyinUrl(url)) {
    throw new Error("多平台解析引擎源码缺失。当前只能解析抖音链接。");
  }

  return getDouyinVideoInfo(url);
}

function downloadUrl(fileUrl, destination) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const client = fileUrl.startsWith("https:") ? https : http;
    const request = client.get(fileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadUrl(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Video download failed with HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error("Video download timed out.")));
    request.on("error", reject);
  });
}

function registerFile(filePath) {
  const token = randomUUID();
  fileTokens.set(token, path.resolve(filePath));
  return `/files/${token}/${encodeURIComponent(path.basename(filePath))}`;
}

function normalizeTranscript(text) {
  return text
    .replace(/\bAH\b/g, "AI")
    .replace(/A号/g, "AI 行业")
    .replace(/Vibre Coding/gi, "Vibe Coding")
    .replace(/Mac Air/g, "MacBook Air")
    .replace(/Mac Pro/g, "MacBook Pro")
    .replace(/Cloud Core/g, "Claude Code")
    .replace(/两个社/g, "两件事")
    .replace(/盖板/g, "丐版")
    .replace(/16层内存/g, "16G 内存")
    .replace(/256g/g, "256G")
    .replace(/去换对自己好一点/g, "去对自己好一点")
    .replace(/Claude Code的Mac 2/g, "Claude Code 的 Max 2")
    .replace(/进入AI/g, "进入 AI")
    .replace(/跟AI/g, "跟 AI")
    .replace(/让AI/g, "让 AI")
    .replace(/AI行业/g, "AI 行业")
    .replace(/AI这个/g, "AI 这个")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function detectDevice() {
  const code = [
    "import json",
    "try:",
    " import torch",
    " ok=torch.cuda.is_available()",
    " print(json.dumps({'cuda': ok, 'device': torch.cuda.get_device_name(0) if ok else '', 'torch': torch.__version__}, ensure_ascii=False))",
    "except Exception as exc:",
    " print(json.dumps({'cuda': False, 'device': '', 'torch': '', 'error': str(exc)}, ensure_ascii=False))",
  ].join("\n");
  try {
    const result = await run(PROJECT_PYTHON, ["-c", code]);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).pop() || "{}");
  } catch (error) {
    return { cuda: false, device: "", torch: "", error: error.message };
  }
}

function createAsrWorker() {
  asrWorkerReady = false;
  const child = spawn(PROJECT_PYTHON, [
    QWEN_WORKER_SCRIPT,
    "--model",
    ASR_MODEL,
    "--device",
    ASR_DEVICE,
    "--chunk-seconds",
    "20",
  ], {
    cwd: path.dirname(QWEN_WORKER_SCRIPT),
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      HF_HOME: path.join(MODELS_DIR, "huggingface"),
      TRANSFORMERS_CACHE: path.join(MODELS_DIR, "huggingface", "transformers"),
    },
  });

  child.stdout.on("data", (chunk) => {
    asrWorkerCarry += chunk.toString("utf8");
    const lines = asrWorkerCarry.split(/\r?\n/);
    asrWorkerCarry = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "ready") {
        asrWorkerReady = true;
        continue;
      }
      const job = asrJobs.get(event.id);
      if (!job) continue;
      if (event.type === "progress") {
        sendLine(job.res, { type: "progress", percent: event.percent });
      } else if (event.type === "done") {
        const segments = (event.segments || []).map((segment) => ({
          ...segment,
          text: normalizeTranscript(segment.text || ""),
        }));
        const text = normalizeTranscript(segments.map((segment) => segment.text).join("\n") || event.text || "");
        fs.writeFileSync(job.transcriptPath, text + "\n", "utf8");
        fs.writeFileSync(
          job.transcriptJsonPath,
          JSON.stringify({ segments, text }, null, 2) + "\n",
          "utf8",
        );
        sendLine(job.res, {
          type: "done",
          percent: 100,
          transcript: text,
          transcriptPath: job.transcriptPath,
          transcriptUrl: registerFile(job.transcriptPath),
          videoUrl: job.downloaded.videoUrl,
          videoPath: job.downloaded.videoPath,
        });
        job.res.end();
        asrJobs.delete(event.id);
      } else if (event.type === "error") {
        sendLine(job.res, { type: "error", message: event.message || "提取失败" });
        job.res.end();
        asrJobs.delete(event.id);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const stderr = chunk.toString("utf8").trim();
    if (stderr) console.error(stderr);
  });

  child.on("close", () => {
    asrWorker = null;
    asrWorkerReady = false;
    asrWorkerStarting = null;
    for (const job of asrJobs.values()) {
      sendLine(job.res, { type: "error", message: "文案提取服务已退出，请重试。" });
      job.res.end();
    }
    asrJobs.clear();
  });

  return child;
}

async function ensureAsrWorker() {
  if (asrWorker && !asrWorker.killed) return asrWorker;
  if (asrWorkerStarting) return asrWorkerStarting;

  asrWorkerStarting = new Promise((resolve, reject) => {
    const child = createAsrWorker();
    asrWorker = child;
    const timeout = setTimeout(() => reject(new Error("文案提取服务启动超时")), 180000);
    const timer = setInterval(() => {
      if (asrWorkerReady) {
        clearTimeout(timeout);
        clearInterval(timer);
        resolve(child);
      }
    }, 200);
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearInterval(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      clearInterval(timer);
    });
  }).finally(() => {
    asrWorkerStarting = null;
  });
  return asrWorkerStarting;
}

async function ensureDownloaded(inputUrl) {
  const saveDir = ensureDefaultStorage();
  const normalizedUrl = normalizeInputUrl(inputUrl);
  if (!normalizedUrl) throw new Error("请输入有效的视频链接。");

  const cached = cacheByInput.get(normalizedUrl);
  if (cached && fs.existsSync(cached.videoPath)) {
    return cached;
  }

  const info = await getVideoInfo(normalizedUrl);
  const videoName = `${sanitizeName(info.title)}_${info.id}.mp4`;
  const videoPath = path.join(saveDir, videoName);
  if (!fs.existsSync(videoPath)) {
    await downloadUrl(info.url, videoPath);
  }

  const result = {
    status: "ok",
    inputUrl: normalizedUrl,
    title: info.title,
    videoId: info.id,
    source: info.source,
    videoName,
    videoPath,
    videoUrl: registerFile(videoPath),
    sourceUrl: info.url,
    coverUrl: info.coverUrl || "",
    musicUrl: info.musicUrl || "",
    raw: info.raw || null,
    saveDir,
  };
  cacheByInput.set(normalizedUrl, result);
  return result;
}

async function handleDownload(req, res) {
  const body = await readJson(req);
  const url = normalizeInputUrl(body.url);
  if (!url) {
    send(res, 400, { error: "请输入有效的视频链接。" });
    return;
  }
  send(res, 200, await ensureDownloaded(url));
}

async function handleExtractStream(req, res) {
  const body = await readJson(req);
  const inputUrl = normalizeInputUrl(body.url);
  if (!inputUrl) {
    send(res, 400, { error: "请输入有效的视频链接。" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });

  try {
    sendLine(res, { type: "progress", percent: 3 });
    const downloaded = await ensureDownloaded(inputUrl);
    const saveDir = ensureDefaultStorage();
    const transcriptPath = path.join(saveDir, `${path.basename(downloaded.videoPath, ".mp4")}.txt`);
    const transcriptJsonPath = path.join(saveDir, `${path.basename(downloaded.videoPath, ".mp4")}.segments.json`);

    sendLine(res, {
      type: "downloaded",
      video: {
        title: downloaded.title,
        path: downloaded.videoPath,
        url: downloaded.videoUrl,
        source: downloaded.source,
      },
    });
    sendLine(res, { type: "progress", percent: 6 });
    const worker = await ensureAsrWorker();
    const id = randomUUID();
    asrJobs.set(id, { res, downloaded, transcriptPath, transcriptJsonPath });
    worker.stdin.write(JSON.stringify({
      type: "transcribe",
      id,
      media: downloaded.videoPath,
      language: "zh",
    }) + "\n");
  } catch (error) {
    sendLine(res, { type: "error", message: error.message || "操作失败" });
    res.end();
  }
}

function serveFileToken(req, res, pathname) {
  const token = pathname.split("/")[2];
  const filePath = fileTokens.get(token);
  if (!filePath || !fs.existsSync(filePath)) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const contentType = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/files/")) {
    serveFileToken(req, res, pathname);
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const full = path.resolve(PUBLIC_DIR, "." + pathname);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer((req, res) => {
  const handleError = (error) => {
    if (!res.headersSent) {
      send(res, 500, { error: error.message || "操作失败" });
      return;
    }
    if (!res.writableEnded) {
      sendLine(res, { type: "error", message: error.message || "操作失败" });
      res.end();
    }
  };

  try {
    if (req.method === "GET" && req.url === "/api/device") {
      detectDevice().then((info) => send(res, 200, info)).catch(handleError);
    } else if (req.method === "POST" && req.url === "/api/download") {
      handleDownload(req, res).catch(handleError);
    } else if (req.method === "POST" && req.url === "/api/extract-stream") {
      handleExtractStream(req, res).catch(handleError);
    } else if (req.method === "GET") {
      serveStatic(req, res);
    } else {
      send(res, 405, { error: "Method not allowed" });
    }
  } catch (error) {
    handleError(error);
  }
});

server.listen(PORT, () => {
  const config = writeConfig(readConfig());
  console.log(`Video Copy Client running at http://localhost:${PORT}`);
  console.log(`Default save directory: ${config.saveDir}`);
});

export { server };
