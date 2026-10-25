'use strict';

// The app you're using when you ask Notchman to listen (Chrome, WhatsApp,
// Word, Slack…), so the pill can show that app's own icon. Read at the moment
// of the press, before Notchman's own windows show. Nothing is stored or sent.
//
// Windows: the program behind the window in front (a small PowerShell call).
// Mac: the frontmost application (osascript).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Store apps (WhatsApp, Spotify…) run inside ApplicationFrameHost: their own
// program is the child window that belongs to a different process.
const WINDOWS_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class NotchmanFront {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
  public static uint Front() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
  public static uint Inner(uint pid) {
    uint inner = 0;
    EnumChildWindows(GetForegroundWindow(), (h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid) { inner = p; return false; } return true; }, IntPtr.Zero);
    return inner;
  }
}
"@
$id = [NotchmanFront]::Front()
$p = Get-Process -Id $id
if ($p.ProcessName -eq 'ApplicationFrameHost') { $inner = [NotchmanFront]::Inner($id); $p = if ($inner) { Get-Process -Id $inner } else { $null } }
if ($p) { $p.Path }
`;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 4000 }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

/** The path of the app in front, or null. */
async function frontAppPath() {
  if (process.platform === 'win32') {
    const found = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT]);
    return found && /\.exe$/i.test(found) ? found : null;
  }
  if (process.platform === 'darwin') {
    const found = await run('osascript', ['-e', 'POSIX path of (path to frontmost application)']);
    return found ? found.replace(/\/$/, '') : null;
  }
  return null;
}

const macIcons = new Map(); // app path → data URL or null

/**
 * A Mac app's icon, made by macOS's own tools in their own processes: the
 * .icns named in its Info.plist, turned into a PNG by sips. (Electron's
 * app.getFileIcon reads icons on a background thread, which crashes the
 * whole app on recent macOS.)
 */
async function macAppIcon(appPath) {
  if (macIcons.has(appPath)) return macIcons.get(appPath);
  let icon = null;
  try {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    let name = await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist]);
    if (!name) name = await run('/usr/bin/plutil', ['-extract', 'CFBundleIconName', 'raw', '-o', '-', plist]);
    if (name) {
      const icns = path.join(appPath, 'Contents', 'Resources', /\.icns$/i.test(name) ? name : `${name}.icns`);
      if (fs.existsSync(icns)) {
        const png = path.join(os.tmpdir(), `notchman-icon-${process.pid}-${Date.now()}.png`);
        await run('/usr/bin/sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', '128', icns, '--out', png]);
        try {
          const bytes = fs.readFileSync(png);
          if (bytes.length > 64) icon = `data:image/png;base64,${bytes.toString('base64')}`;
        } finally {
          fs.rm(png, { force: true }, () => {});
        }
      }
    }
  } catch { /* no icon */ }
  macIcons.set(appPath, icon);
  return icon;
}

/**
 * The icon of the app in front, as a PNG data URL, or null (Notchman itself,
 * the desktop, or when it can't be read).
 * @param {Electron.App} app
 */
async function frontAppIcon(app) {
  try {
    const found = await frontAppPath();
    if (!found) return null;
    const name = path.basename(found).toLowerCase();
    if (name.startsWith('notchman') || name === 'explorer.exe' || name === 'finder.app' || found === process.execPath) return null;
    // Never wait long for an icon: the pill goes on without it.
    const wait = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
    if (process.platform === 'darwin') return await Promise.race([macAppIcon(found), wait]);
    const icon = await Promise.race([
      app.getFileIcon(found, { size: 'large' }),
      wait,
    ]);
    return icon && !icon.isEmpty() ? icon.toDataURL() : null;
  } catch {
    return null;
  }
}

/**
 * The logo of a website the text was copied from (its large touch icon, else
 * its favicon), as a data URL, or null. Asked of the site itself, which the
 * person was already on; a couple of seconds at most.
 */
async function siteIcon(url, fetchImpl = fetch) {
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  if (!/^https?:/.test(origin)) return null;
  for (const file of ['/apple-touch-icon.png', '/favicon.ico']) {
    try {
      const response = await fetchImpl(origin + file, { signal: AbortSignal.timeout(2500), redirect: 'follow' });
      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!response.ok || !/^image\//.test(type)) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 64 || bytes.length > 300_000) continue;
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch { /* next */ }
  }
  return null;
}

module.exports = { frontAppIcon, siteIcon, macAppIcon };
