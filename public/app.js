const input = document.querySelector("#urlInput");
const form = document.querySelector("#toolForm");
const downloadBtn = document.querySelector("#downloadBtn");
const extractBtn = document.querySelector("#extractBtn");
const statusBox = document.querySelector("#statusBox");
const statusText = document.querySelector("#statusText");
const resultPanel = document.querySelector("#resultPanel");
const resultTitle = document.querySelector("#resultTitle");
const resultBadge = document.querySelector("#resultBadge");
const resultMeta = document.querySelector("#resultMeta");
const mediaCard = document.querySelector("#mediaCard");
const mediaSkeleton = document.querySelector("#mediaSkeleton");
const videoPreview = document.querySelector("#videoPreview");
const downloadVideoLink = document.querySelector("#downloadVideoLink");
const extractFromVideoBtn = document.querySelector("#extractFromVideoBtn");
const copyText = document.querySelector("#copyText");
const copyBtn = document.querySelector("#copyBtn");
const extractOverlay = document.querySelector("#extractOverlay");
const progressPercent = document.querySelector("#progressPercent");

let busy = false;
let currentVideo = null;

function setButtonsDisabled(disabled) {
  busy = disabled;
  downloadBtn.disabled = disabled;
  extractBtn.disabled = disabled;
  extractFromVideoBtn.disabled = disabled;
}

function setStatus(kind, message) {
  statusBox.className = `status ${kind}`.trim();
  statusText.textContent = message;
}

function setProgress(percent) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  progressPercent.textContent = `${value}%`;
}

function startTask(message, activeButton) {
  setButtonsDisabled(true);
  activeButton?.classList.add("loading");
  setStatus("busy", message);
}

function finishTask(message) {
  downloadBtn.classList.remove("loading");
  extractBtn.classList.remove("loading");
  extractFromVideoBtn.classList.remove("loading");
  setButtonsDisabled(false);
  setStatus("success", message);
}

function failTask(message) {
  downloadBtn.classList.remove("loading");
  extractBtn.classList.remove("loading");
  extractFromVideoBtn.classList.remove("loading");
  extractOverlay.hidden = true;
  setButtonsDisabled(false);
  setStatus("error", message || "操作失败");
}

function getUrl() {
  const value = input.value.trim();
  if (!value) {
    input.focus();
    throw new Error("请输入抖音链接");
  }
  return value;
}

function resetResult(title, mode) {
  resultPanel.hidden = false;
  resultTitle.textContent = title;
  resultMeta.textContent = "";
  resultMeta.hidden = true;
  resultBadge.textContent = mode === "text" ? "提取结果：原文" : "视频已解析";
  copyBtn.hidden = true;
  copyText.value = "";
  copyText.placeholder = mode === "text" ? "" : "提取文案后会显示在这里";
  extractOverlay.hidden = true;
  setProgress(0);

  if (!currentVideo) {
    mediaCard.hidden = mode !== "text";
    mediaSkeleton.hidden = mode !== "text";
    videoPreview.hidden = true;
  }
}

function showVideo(data) {
  currentVideo = data;
  mediaCard.hidden = false;
  mediaSkeleton.hidden = true;
  videoPreview.src = data.videoUrl;
  videoPreview.hidden = false;
  downloadVideoLink.href = data.videoUrl;
  downloadVideoLink.setAttribute("download", data.videoName || "douyin-video.mp4");
  downloadVideoLink.hidden = false;
  extractFromVideoBtn.hidden = false;
  resultTitle.textContent = data.title || "暂无标题";
  resultMeta.textContent = "";
  resultMeta.hidden = true;
}

async function postJson(route, payload) {
  const response = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || "操作失败");
  }
  return data;
}

async function downloadVideo() {
  startTask("正在下载视频", downloadBtn);
  resetResult("下载中", "download");
  const data = await postJson("/api/download", { url: getUrl() });
  showVideo(data);
  copyText.value = "";
  copyText.placeholder = "提取文案后会显示在这里";
  finishTask("下载完成");
}

async function extractCopy(activeButton = extractBtn) {
  startTask("正在提取文案", activeButton);
  resetResult("文案提取中", "text");
  extractOverlay.hidden = false;
  setProgress(0);

  const response = await fetch("/api/extract-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: getUrl() }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "提取失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "downloaded" && event.video) {
        showVideo({
          title: event.video.title,
          videoPath: event.video.path,
          videoUrl: event.video.url,
        });
      } else if (event.type === "progress") {
        setProgress(event.percent);
      } else if (event.type === "done") {
        setProgress(100);
        extractOverlay.hidden = true;
        copyText.value = event.transcript || "";
        copyText.placeholder = "暂无文案";
        if (event.videoUrl && currentVideo) showVideo({ ...currentVideo, videoUrl: event.videoUrl });
        resultTitle.textContent = currentVideo?.title || "文案提取结果";
        resultBadge.textContent = "提取结果：原文";
        copyBtn.hidden = !copyText.value.trim();
        completed = true;
        finishTask("提取完成");
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
  if (!completed) throw new Error("提取中断，请重试");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!busy) extractBtn.click();
});

downloadBtn.addEventListener("click", async () => {
  try {
    await downloadVideo();
  } catch (error) {
    failTask(error.message);
  }
});

extractBtn.addEventListener("click", async () => {
  try {
    await extractCopy();
  } catch (error) {
    failTask(error.message);
  }
});

extractFromVideoBtn.addEventListener("click", async () => {
  try {
    await extractCopy(extractFromVideoBtn);
  } catch (error) {
    failTask(error.message);
  }
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(copyText.value);
  setStatus("success", "已复制文案");
});
