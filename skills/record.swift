import Foundation
import AVFoundation

let args = CommandLine.arguments
if args.count < 3 {
    fputs("Usage: record_bin <output_path> <duration_seconds>\n", stderr)
    exit(1)
}

let outputPath = args[1]
guard let duration = Double(args[2]), duration > 0 else {
    fputs("ERROR: Invalid duration\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: outputPath)

// 1. 檢查 macOS 麥克風存取權限
let status = AVCaptureDevice.authorizationStatus(for: .audio)

if status == .notDetermined {
    let semaphore = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        if !granted {
            fputs("ERROR: Microphone access denied by user\n", stderr)
            exit(1)
        }
        semaphore.signal()
    }
    semaphore.wait()
} else if status == .denied || status == .restricted {
    fputs("ERROR: Microphone access is denied in macOS System Settings -> Privacy & Security -> Microphone\n", stderr)
    exit(1)
}

// 2. 檢查音訊輸入設備 (相容 macOS 14+ 現代 API，消除 Deprecation 警告)
var deviceTypes: [AVCaptureDevice.DeviceType] = [.microphone]
if #available(macOS 14.0, *) {
    deviceTypes.append(.external)
} else {
    deviceTypes.append(.externalUnknown)
}

let discoverySession = AVCaptureDevice.DiscoverySession(
    deviceTypes: deviceTypes,
    mediaType: .audio,
    position: .unspecified
)

if discoverySession.devices.isEmpty {
    fputs("ERROR: 未偵測到任何音訊輸入設備 (請確認 Mac Studio 已連接 USB 麥克風、Webcam 或外接螢幕麥克風)。\n", stderr)
    exit(1)
}

// 3. 錄音引擎與格式初始化
let engine = AVAudioEngine()
let inputNode = engine.inputNode

// ⚠️ 關鍵修復：先 prepare 引擎，確保取得真實硬件採樣率
engine.prepare()

let hardwareFormat = inputNode.outputFormat(forBus: 0)
let sampleRate = hardwareFormat.sampleRate > 0 ? hardwareFormat.sampleRate : 44100.0
let channelCount = hardwareFormat.channelCount > 0 ? min(hardwareFormat.channelCount, 2) : 1

guard let recordingFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: channelCount, interleaved: false) else {
    fputs("ERROR: 無法建立 AVAudioFormat\n", stderr)
    exit(1)
}

let recordSettings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: Int(channelCount),
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

var audioFile: AVAudioFile?
do {
    audioFile = try AVAudioFile(forWriting: url, settings: recordSettings)
} catch {
    fputs("ERROR: Failed to create AVAudioFile: \(error.localizedDescription)\n", stderr)
    exit(1)
}

inputNode.installTap(onBus: 0, bufferSize: 4096, format: recordingFormat) { (buffer, time) in
    do {
        try audioFile?.write(from: buffer)
    } catch {
        fputs("ERROR: Failed to write audio buffer: \(error.localizedDescription)\n", stderr)
    }
}

do {
    try engine.start()
} catch {
    fputs("ERROR: Failed to start AVAudioEngine: \(error.localizedDescription)\n", stderr)
    exit(1)
}

// 運行指定錄音秒數
Thread.sleep(forTimeInterval: duration)

inputNode.removeTap(onBus: 0)
engine.stop()

// 強制寫入與關閉檔案 Handle
audioFile = nil

// 4. 驗證錄音檔案有效性
if FileManager.default.fileExists(atPath: outputPath) {
    let attr = try? FileManager.default.attributesOfItem(atPath: outputPath)
    let fileSize = (attr?[.size] as? NSNumber)?.uint64Value ?? 0
    if fileSize > 2048 {
        print("RECORDING_SUCCESS")
        exit(0)
    } else {
        fputs("ERROR: Recorded file size too small (\(fileSize) bytes)\n", stderr)
        exit(1)
    }
} else {
    fputs("ERROR: Output file does not exist\n", stderr)
    exit(1)
}
