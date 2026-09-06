const { parentPort, workerData } = require("worker_threads");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const { filePath, ollamaHost, ollamaModel } = workerData;

/**
 * 第一階段：語音轉文字 (STT - Speech to Text)
 */
function transcribeAudio(audioPath) {
  return new Promise((resolve) => {
    // 嘗試調用本地 whisper CLI 進行語音轉轉寫
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

      // 若未安裝 whisper CLI，傳回提示文本供 LLM 作示範分析
      resolve(null);
    });
  });
}

/**
 * 第二階段：呼叫本地 Ollama API 進行語音分析與回應建議
 */
async function analyzeWithOllama(transcribedText) {
  const prompt = `你是一個廣東話/英文家居智能語音助手。請分析以下現場錄音轉寫文字：

【現場錄音轉寫內容】：
"${transcribedText}"

請以繁體中文/廣東話提供以下格式的回應：
🗣️ **對話總結（我地講咗咩）：**
[精簡總結對話內容]

💡 **建議回應/下一步行動：**
[提供 1-2 個建議的回應語句或應對行動]`;

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

    // 2. 呼叫 Ollama 分析
    const aiAnalysis = await analyzeWithOllama(transcribedText);

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
