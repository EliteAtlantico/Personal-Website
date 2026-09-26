// Drives a page in macOS's own WebKit, the engine Safari uses, for a11y/safari.ts.
// It reads a plan, one step per line, and prints each script's result as a line of JSON:
//   open <url>      load a page (and wait for it)
//   size <w> <h>    resize the window
//   zoom <factor>   page zoom, like Safari's Cmd +
//   wait <seconds>
//   js <file.js>    run a script; prints {"step": n, "result": ...}
// `minfont=<px>` after the plan sets Safari's "Never use font sizes smaller than".
//
// The window is on screen, so WebKit treats the page as visible (a hidden page
// gets no animation frames, and the site's re-layouts wait for one), but it's
// fully transparent and lets the mouse through.
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 2, let plan = try? String(contentsOfFile: args[1], encoding: .utf8) else {
  print("usage: webkit <plan> [minfont=N]")
  exit(2)
}
var minFont: CGFloat = 0
for arg in args.dropFirst(2) where arg.hasPrefix("minfont=") { minFont = CGFloat(Double(arg.dropFirst(8)) ?? 0) }
var steps = plan.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
var step = 0

final class Driver: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let window: NSWindow
  var loaded: (() -> Void)?

  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    if minFont > 0 { config.preferences.minimumFontSize = minFont }
    let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
    web = WKWebView(frame: frame, configuration: config)
    web.appearance = NSAppearance(named: .aqua)
    window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    web.navigationDelegate = self
    window.contentView = web
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.orderFrontRegardless()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?()
    loaded = nil
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("\(error.localizedDescription)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("\(error.localizedDescription)") }
}

func fail(_ message: String) {
  print("{\"error\": \(String(reflecting: message))}")
  exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let driver = Driver()

func next() {
  guard !steps.isEmpty else { exit(0) }
  step += 1
  let line = steps.removeFirst()
  let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
  let rest = parts.count > 1 ? parts[1] : ""
  switch parts[0] {
  case "open":
    guard let url = URL(string: rest) else { return fail("bad url \(rest)") }
    driver.loaded = { next() }
    driver.web.load(URLRequest(url: url))
  case "size":
    let wh = rest.split(separator: " ").compactMap { Double($0) }
    guard wh.count == 2 else { return fail("bad size \(rest)") }
    driver.window.setFrame(NSRect(x: 0, y: 0, width: wh[0], height: wh[1]), display: true)
    driver.web.frame = NSRect(x: 0, y: 0, width: wh[0], height: wh[1])
    next()
  case "zoom":
    driver.web.pageZoom = CGFloat(Double(rest) ?? 1)
    next()
  case "wait":
    DispatchQueue.main.asyncAfter(deadline: .now() + (Double(rest) ?? 1)) { next() }
  case "js":
    guard let code = try? String(contentsOfFile: rest, encoding: .utf8) else { return fail("can't read \(rest)") }
    let at = step
    driver.web.evaluateJavaScript(code) { result, error in
      if let error { print("{\"step\": \(at), \"error\": \(String(reflecting: error.localizedDescription))}") } else { print("{\"step\": \(at), \"result\": \(result as? String ?? "null")}") }
      next()
    }
  default:
    fail("unknown step \(line)")
  }
}

DispatchQueue.main.async { next() }
DispatchQueue.main.asyncAfter(deadline: .now() + 180) { fail("timed out") }
app.run()
