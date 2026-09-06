import Foundation
import AVFoundation

let args = CommandLine.arguments
if args.count < 3 {
    fputs("Usage: swift record.swift <output_path> <duration_seconds>\n", stderr)
    exit(1)
}

let outputPath = args[1]
guard let duration = Double(args[2]) else {
    fputs("ERROR: Invalid duration\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: outputPath)

// 1. 顯式檢查並請求 macOS 麥克風存取權限 (觸發 TCC 彈窗)
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

// 2. 使用 AVAudioEngine 動態擷取 Mac Studio 麥克風原生音訊流
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let bus = 0
let hardwareFormat = inputNode.inputFormat(forBus: bus)

if hardwareFormat.sampleRate == 0 || hardwareFormat.channelCount == 0 {
    fputs("ERROR: No active audio input device found on Mac Studio\n", stderr)
    exit(1)
}

// 動態對齊 Mac Studio 實體採樣率 (例如 48000Hz)，避免硬體初始化失敗
let recordSettings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: hardwareFormat.sampleRate,
    AVNumberOfChannelsKey: Int(min(hardwareFormat.channelCount, 2)),
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

do {
    let audioFile = try AVAudioFile(forWriting: url, settings: recordSettings)

    // 安裝 Tap 直接補捉麥克風 PCM 並轉碼寫入 M4A
    inputNode.installTap(onBus: bus, bufferSize: 4096, format: hardwareFormat) { (buffer, time) in
        do {
            try audioFile.write(from: buffer)
        } catch {
            fputs("ERROR: Failed to write audio buffer: \(error.localizedDescription)\n", stderr)
        }
    }

    engine.prepare()
    try engine.start()

    RunLoop.current.run(until: Date(timeIntervalSinceNow: duration))

    inputNode.removeTap(onBus: bus)
    engine.stop()

    if FileManager.default.fileExists(atPath: outputPath) {
        print("RECORDING_SUCCESS")
        exit(0)
    } else {
        fputs("ERROR: Recorded file does not exist\n", stderr)
        exit(1)
    }
} catch {
    fputs("ERROR: \(error.localizedDescription)\n", stderr)
    exit(1)
}