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

// 2. 設定 AAC / M4A 音訊參數
let settings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: 44100.0,
    AVNumberOfChannelsKey: 1,
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

do {
    let recorder = try AVAudioRecorder(url: url, settings: settings)
    
    // 預備錄音資源
    guard recorder.prepareToRecord() else {
        fputs("ERROR: Failed to prepare AVAudioRecorder\n", stderr)
        exit(1)
    }

    // 啟動錄音
    guard recorder.record() else {
        fputs("ERROR: Failed to start recording\n", stderr)
        exit(1)
    }
    
    // 保持 RunLoop 持續補捉音訊與系統事件
    RunLoop.current.run(until: Date(timeIntervalSinceNow: duration))
    
    recorder.stop()
    print("RECORDING_SUCCESS")
    exit(0)
} catch {
    fputs("ERROR: \(error.localizedDescription)\n", stderr)
    exit(1)
}