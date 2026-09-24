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

// 使用 AVAudioEngine 擷取原生音訊流 (直接經 CoreAudio HAL 收音，徹底避免 AVCaptureDevice 假報錯)
let engine = AVAudioEngine()
let inputNode = engine.inputNode

// 先 prepare 引擎，讓 CoreAudio 鎖定當前系統預設麥克風輸入格式
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

// 關閉 File Handle 確保 Flush 至硬碟
audioFile = nil

// 驗證錄音檔案有效性
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