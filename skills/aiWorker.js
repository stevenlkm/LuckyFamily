const { parentPort, workerData } = require("worker_threads");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const { filePath, ollamaHost, ollamaModel, contextPrompt } = workerData;

/**
 * 第一階段：語音轉文字 (STT - Speech to Text)
 */
function transcribeAudio(audioPath) {
  return new Promise((resolve) => {
    const cmd = `whisper "${audioPath}" --language Cantonese --output_format txt --output_dir "/tmp"`;

    exec(cmd, { timeout: 60000 }, (error) => {
      const parsedPath = path.parse(audioPath);
      const txtPath = path.join("/tmp", `${parsedPath.name}.txt`);

      if (!error && fs.existsSync(txtPath)) {
        try {
          const text = fs.readFileSync(txtPath, "utf8").trim();
          fs.unlinkSync(txtPath);
          return resolve(text);
        } catch (e) {}
      }

      resolve(null);
    });
  });
}

/**
 * 第二階段：呼叫本地 Ollama API 結合廣播上下文進行對話脈絡分析
 */
async function analyzeWithOllama(transcribedText, context) {
  let prompt = `你是一個廣東話/英文家居智能語音助手。請分析以下現場對話與錄音轉寫文字：\n\n`;

  if (context) {
    prompt += `【系統先前廣播內容 (/say)】：\n"${context}"\n\n`;
  }

  prompt += `【現場錄音轉寫內容】：\n"${transcribedText}"\n\n`;

  prompt += `請結合系統廣播與現場回應，以繁體中文/廣東話提供以下格式的回應：
🗣️ **對話總結（廣播與現場回應）：**
[結合系統廣播內容與現場回應進行精簡總結]

💡 **建議回應/下一步行動：**
[根據上下文脈絡提供 1-2 個建議的回應語句或應對行動]`;

  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama API 連線失敗 (HTTP ${response.status})。請確認 Ollama 已啟動且已下載 ${ollamaModel} 模型。`,
    );
  }

  const data = await response.json();
  return data.response;
}

/**
 * Worker 線程執行主入口
 */
(async () => {
  try {
    // 1. 執行 STT
    const transcribedText = await transcribeAudio(filePath);

    if (!transcribedText) {
      parentPort.postMessage({
        success: false,
        error: `無法進行語音轉寫。💡 請先喺 Mac Terminal 執行 \`pip install openai-whisper\` 安裝 Whisper 轉寫工具。`,
      });
      return;
    }

    // 2. 呼叫 Ollama 分析 (帶入廣播上下文)
    const aiAnalysis = await analyzeWithOllama(transcribedText, contextPrompt);

    parentPort.postMessage({
      success: true,
      transcription: transcribedText,
      analysis: aiAnalysis,
    });
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message,
    });
  }
})();
