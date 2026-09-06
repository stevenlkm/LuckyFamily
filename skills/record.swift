import Foundation
import AVFoundation

let args = CommandLine.arguments
if args.count < 3 {
    print("Usage: swift record.swift <output_path> <duration_seconds>")
    exit(1)
}

let outputPath = args[1]
let duration = Double(args[2]) ?? 60.0
let url = URL(fileURLWithPath: outputPath)

// 設定 M4A (AAC) 音訊格式
let settings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: 44100.0,
    AVNumberOfChannelsKey: 1,
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

do {
    let recorder = try AVAudioRecorder(url: url, settings: settings)
    guard recorder.record() else {
        print("ERROR: Failed to start recording")
        exit(1)
    }
    
    // 阻塞執行指定秒數
    Thread.sleep(forTimeInterval: duration)
    recorder.stop()
    print("RECORDING_SUCCESS")
    exit(0)
} catch {
    print("ERROR: \(error.localizedDescription)")
    exit(1)
}