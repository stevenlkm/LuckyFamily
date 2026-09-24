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

// 2. 檢查音訊輸入設備 (相容 macOS 14+ 現代 API)
let discoverySession = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.microphone, .externalUnknown],
    mediaType: .audio,
    position: .unspecified
)

if discoverySession.devices.isEmpty {
    fputs("ERROR: 未偵測到任何音訊輸入設備 (請確認 Mac Studio 已連接 USB 麥克風、Webcam 或外接螢幕麥克風)。\n", stderr)
    exit(1)
}

// 3. 使用 AVAudioEngine 擷取原生音訊流
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let bus = 0
let hardwareFormat = inputNode.inputFormat(forBus: bus)

if hardwareFormat.sampleRate == 0 || hardwareFormat.channelCount == 0 {
    fputs("ERROR: 無法取得有效的麥克風輸入格式。\n", stderr)
    exit(1)
}

let recordSettings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: hardwareFormat.sampleRate,
    AVNumberOfChannelsKey: Int(min(hardwareFormat.channelCount, 2)),
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

func startRecording() -> Bool {
    var audioFile: AVAudioFile?
    
    do {
        audioFile = try AVAudioFile(forWriting: url, settings: recordSettings)
    } catch {
        fputs("ERROR: Failed to create AVAudioFile: \(error.localizedDescription)\n", stderr)
        return false
    }

    inputNode.installTap(onBus: bus, bufferSize: 4096, format: hardwareFormat) { (buffer, time) in
        do {
            try audioFile?.write(from: buffer)
        } catch {
            fputs("ERROR: Failed to write audio buffer: \(error.localizedDescription)\n", stderr)
        }
    }

    do {
        engine.prepare()
        try engine.start()
    } catch {
        fputs("ERROR: Failed to start AVAudioEngine: \(error.localizedDescription)\n", stderr)
        return false
    }

    RunLoop.current.run(until: Date(timeIntervalSinceNow: duration))

    inputNode.removeTap(onBus: bus)
    engine.stop()

    // 強制 Flush 寫入 AAC 檔頭標頭
    audioFile = nil

    return FileManager.default.fileExists(atPath: outputPath)
}

if startRecording() {
    print("RECORDING_SUCCESS")
    exit(0)
} else {
    fputs("ERROR: Recorded file is missing or invalid\n", stderr)
    exit(1)
}