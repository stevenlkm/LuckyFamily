const { parentPort, workerData } = require('worker_threads');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { filePath, ollamaHost, ollamaModel, contextPrompt } = workerData;

/**
 * 自動尋找 macOS 上 whisper 執行檔路徑或退回指令
 */
function getWhisperCmd(audioPath) {
  const home = os.homedir();
  const possiblePaths = [
    path.join(home, 'Library/Python/3.9/bin/whisper'),
    path.join(home, 'Library/Python/3.10/bin/whisper'),
    path.join(home, 'Library/Python/3.11/bin/whisper'),
    path.join(home, 'Library/Python/3.12/bin/whisper'),
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return `"${p}" "${audioPath}" --language Cantonese --output_format txt --output_dir "/tmp"`;
    }
  }

  // 若未找到獨立 bin，退回使用 python3 -m whisper
  return `python3 -m whisper "${audioPath}" --language Cantonese --output_format txt --output_dir "/tmp"`;
}

/**
 * 第一階段：語音轉文字 (STT - Speech to Text)
 */
function transcribeAudio(audioPath) {
  return new Promise((resolve) => {
    const cmd = getWhisperCmd(audioPath);

    // 執行 Whisper STT 轉寫 (時長給予 120 秒超時)
    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      const parsedPath = path.parse(audioPath);
      const txtPath = path.join('/tmp', `${parsedPath.name}.txt`);

      if (fs.existsSync(txtPath)) {
        try {
          const text = fs.readFileSync(txtPath, 'utf8').trim();
          fs.unlinkSync(txtPath);
          if (text) return resolve(text);
        } catch (e) {}
      }

      console.error('Whisper STT 執行失敗或無文字:', stderr || error?.message || stdout);
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: prompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API 連線失敗 (HTTP ${response.status})。請確認 Ollama 已啟動且已下載 ${ollamaModel} 模型。`);
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
        error: `無法進行語音轉寫。💡 請先喺 Mac Terminal 執行 \`python3 -m pip install openai-whisper\` 完成安裝。`
      });
      return;
    }

    // 2. 呼叫 Ollama 分析 (帶入廣播上下文)
    const aiAnalysis = await analyzeWithOllama(transcribedText, contextPrompt);

    parentPort.postMessage({
      success: true,
      transcription: transcribedText,
      analysis: aiAnalysis
    });

  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message
    });
  }
})();