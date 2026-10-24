/**
 * Minimal Chrome DevTools Protocol client for local evidence harnesses.
 * Uses Node's global WebSocket (Node >= 22); no browser-automation dependency.
 * Launches an isolated Chrome profile with a random debugging port read from DevToolsActivePort.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function defaultBrowser() {
  return (
    process.env.BROWSER_BINARY ||
    (process.platform === "win32"
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : "google-chrome")
  );
}

/** Starts Chrome with an isolated profile. `args` are appended after the harness defaults. */
export async function launchChrome({
  binary = defaultBrowser(),
  profile,
  args = [],
  headless = false,
}) {
  await mkdir(profile, { recursive: true });
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(headless ? ["--headless=new"] : []),
      ...args,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16384);
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const [port, browserPath] = (await readFile(portFile, "utf8"))
        .trim()
        .split(/\r?\n/);
      if (port && browserPath) {
        const browser = await CdpConnection.open(
          `ws://127.0.0.1:${port}${browserPath}`,
        );
        return {
          child,
          port: Number(port),
          browser,
          stderr: () => stderr,
          async close() {
            try {
              await browser.send("Browser.close");
            } catch {
              /* Already closed. */
            }
            browser.close();
            await Promise.race([exited, delay(10000)]);
            if (child.exitCode === null) child.kill();
          },
        };
      }
    } catch {
      /* Not yet written. */
    }
    if (child.exitCode !== null)
      throw new Error(`Chrome exited early: ${stderr.slice(-2000)}`);
    await delay(100);
  }
  child.kill();
  throw new Error("Chrome did not expose a DevTools port");
}

export class CdpConnection {
  static open(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener(
        "open",
        () => resolve(new CdpConnection(socket)),
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => reject(new Error(`CDP connection failed: ${url}`)),
        {
          once: true,
        },
      );
    });
  }
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error)
          waiter.reject(
            new Error(`${waiter.method}: ${message.error.message}`),
          );
        else waiter.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener("close", () => {
      for (const waiter of this.pending.values())
        waiter.reject(new Error("CDP socket closed"));
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.socket.close();
  }
}

/** A flattened page session with small, explicit UI helpers. */
export class PageSession {
  static async attach(browser, url) {
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = new PageSession(browser, sessionId, targetId);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    if (url) await page.navigate(url);
    return page;
  }
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.console = [];
    browser.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (
        message.method === "Runtime.consoleAPICalled" &&
        ["error", "warning"].includes(message.params.type)
      )
        this.console.push({
          type: message.params.type,
          text: message.params.args
            .map((arg) => arg.value ?? arg.description ?? "")
            .join(" ")
            .slice(0, 2000),
        });
      else if (message.method === "Runtime.exceptionThrown")
        this.console.push({
          type: "exception",
          text: (
            message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text ??
            ""
          ).slice(0, 2000),
        });
    });
  }
  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }
  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const off = this.browser.on((message) => {
        if (
          message.sessionId === this.sessionId &&
          message.method === "Page.loadEventFired"
        ) {
          off();
          resolve();
        }
      });
    });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, delay(30000)]);
  }
  async evaluate(expression, { userGesture = false } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture,
    });
    if (result.exceptionDetails)
      throw new Error(
        `Page evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    return result.result.value;
  }
  /** Center of a visible, enabled `[data-target]` button, or a reason it is not clickable. */
  async targetBox(id) {
    return this.evaluate(`(() => {
      const element = document.querySelector('[data-target=' + JSON.stringify(${JSON.stringify(id)}) + ']');
      if (!element) return { missing: true };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { disabled: element.disabled, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    })()`);
  }
  /** Trusted mouse click on a real UI control (grants user activation like a person's click). */
  async click(id) {
    const box = await this.targetBox(id);
    if (box.missing)
      throw new Error(`UI control ${id} is not on the current page`);
    if (box.disabled) throw new Error(`UI control ${id} is disabled`);
    if (!(box.width > 0 && box.height > 0))
      throw new Error(`UI control ${id} is not visible`);
    const base = { x: box.x, y: box.y, button: "left", clickCount: 1 };
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: box.x,
      y: box.y,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...base,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...base,
    });
  }
  async key(code, key = code, keyCode = 0) {
    const base = {
      code,
      key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
    });
    return Buffer.from(data, "base64");
  }
}

export { delay };
