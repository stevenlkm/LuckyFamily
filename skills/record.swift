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

// 1. 檢查 macOS 麥克風權限
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

// 2. 檢查 Mac Studio 是否已連接任何音訊輸入設備 (Mac Studio 沒有內建麥克風)
let discoverySession = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInMicrophone, .externalUnknown],
    mediaType: .audio,
    position: .unspecified
)

if discoverySession.devices.isEmpty {
    fputs("ERROR: Mac Studio 主機沒有內建麥克風，且目前未連接任何外置麥克風設備 (請連接 USB 麥克風、Webcam、AirPods 或 Studio Display)。\n", stderr)
    exit(1)
}

// 3. 使用 AVAudioEngine 擷取原生音訊流
let engine = AVAudioEngine()
let inputNode = engine.inputNode
let bus = 0
let hardwareFormat = inputNode.inputFormat(forBus: bus)

if hardwareFormat.sampleRate == 0 || hardwareFormat.channelCount == 0 {
    fputs("ERROR: Mac Studio 主機沒有內建麥克風，且目前未連接任何外置麥克風設備 (請連接 USB 麥克風、Webcam、AirPods 或 Studio Display)。\n", stderr)
    exit(1)
}

let recordSettings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
    AVSampleRateKey: hardwareFormat.sampleRate,
    AVNumberOfChannelsKey: Int(min(hardwareFormat.channelCount, 2)),
    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

do {
    let audioFile = try AVAudioFile(forWriting: url, settings: recordSettings)

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