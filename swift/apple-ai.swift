// Reads a prompt from stdin, prints the on-device Apple Intelligence response.
import Foundation
import FoundationModels

let model = SystemLanguageModel.default
guard case .available = model.availability else {
  FileHandle.standardError.write("Apple Intelligence unavailable: \(model.availability)\n".data(using: .utf8)!)
  exit(1)
}

let prompt = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
let session = LanguageModelSession(instructions: "Follow the user's instructions exactly. Output only the resulting text, no preamble.")
do {
  // Snapshots are cumulative, so print only what's new to stream deltas.
  var printed = ""
  for try await snapshot in session.streamResponse(to: prompt) {
    print(snapshot.content.dropFirst(printed.count), terminator: "")
    fflush(stdout)
    printed = snapshot.content
  }
  print()
} catch {
  FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
  exit(1)
}
