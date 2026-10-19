import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  globalShortcut,
  screen,
  dialog,
  protocol,
  net,
  systemPreferences,
  shell,
  nativeImage,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { pathToFileURL } from 'url';
import JSZip from 'jszip';
import type { SopProject } from '../src/types/sop';

// Register custom protocol for local asset streaming with CORS enabled
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'stepflow-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let studioWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let isCapturing = false;
let lastActiveProject: SopProject | null = null;
let currentRetakeStepId: string | null = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function appendRuntimeLog(message: string, error?: unknown): void {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, 'runtime.log');
    const timestamp = new Date().toISOString();
    const errorText = error
      ? ` | ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error)}`
      : '';
    fs.appendFileSync(logPath, `[${timestamp}] ${message}${errorText}\n`, 'utf-8');
  } catch {
    // Ignore logging errors to avoid blocking startup
  }
}

if (process.platform === 'win32') {
  // Defensive startup flags for environments where Chromium renderer bootstrap fails.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
}

// Determine storage paths with configurable workspace directory support
interface StepFlowConfig {
  customStorageDir?: string | null;
}

let customStorageDir: string | null = null;

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'stepflow_config.json');
}

function loadConfig(): void {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(raw) as StepFlowConfig;
      if (data.customStorageDir && fs.existsSync(data.customStorageDir)) {
        customStorageDir = data.customStorageDir;
      }
    }
  } catch (err) {
    console.warn('[Config] Failed to load config:', err);
  }
}

function saveConfig(): void {
  try {
    const configPath = getConfigPath();
    const config: StepFlowConfig = { customStorageDir };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to save config:', err);
  }
}

function getWorkspaceRoot(): string {
  if (customStorageDir && fs.existsSync(customStorageDir)) {
    return customStorageDir;
  }
  return app.getPath('userData');
}

const getAssetsDir = (): string => path.join(getWorkspaceRoot(), 'stepflow_assets');
const getProjectsDir = (): string => path.join(getWorkspaceRoot(), 'projects');

const recentlySavedByApp = new Set<string>();
let projectWatcher: fs.FSWatcher | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();

function setupProjectsFileWatcher(): void {
  try {
    if (projectWatcher) {
      projectWatcher.close();
      projectWatcher = null;
    }
    const dir = getProjectsDir();
    if (!fs.existsSync(dir)) return;

    projectWatcher = fs.watch(dir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.includes('.tmp')) {
        return;
      }

      const filePath = path.join(dir, filename);
      if (recentlySavedByApp.has(filePath)) {
        return;
      }

      const existingTimer = debounceTimers.get(filename);
      if (existingTimer) clearTimeout(existingTimer);

      debounceTimers.set(
        filename,
        setTimeout(async () => {
          debounceTimers.delete(filename);
          try {
            const exists = fs.existsSync(filePath);
            if (exists) {
              const raw = await fs.promises.readFile(filePath, 'utf-8');
              const project = JSON.parse(raw) as SopProject;
              if (project && project.id) {
                studioWindow?.webContents.send('project-file-changed', {
                  id: project.id,
                  action: 'save',
                  project,
                });
              }
            } else {
              const id = filename.replace(/^proj_/, '').replace(/\.json$/, '');
              studioWindow?.webContents.send('project-file-changed', {
                id,
                action: 'delete',
              });
            }
          } catch (err) {
            // Transient read/parse error
          }
        }, 150)
      );
    });
  } catch (err) {
    console.error('[ProjectsWatcher] Failed to start watcher:', err);
  }
}

async function ensureDirectories(): Promise<void> {
  await fs.promises.mkdir(getAssetsDir(), { recursive: true });
  await fs.promises.mkdir(getProjectsDir(), { recursive: true });
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function requestSelectionRect(display: Electron.Display): Promise<SelectionRect | null> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const submitChannel = `selection-rect-submit-${requestId}`;
    const cancelChannel = `selection-rect-cancel-${requestId}`;

    let resolved = false;
    const finish = (value: SelectionRect | null) => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeAllListeners(submitChannel);
      ipcMain.removeAllListeners(cancelChannel);
      resolve(value);
    };

    const selectorWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      movable: false,
      resizable: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000001',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });

    const cleanupAndClose = () => {
      try {
        if (!selectorWindow.isDestroyed()) {
          selectorWindow.close();
        }
      } catch {}
    };

    ipcMain.once(submitChannel, (_event, rect: SelectionRect) => {
      finish(rect);
      cleanupAndClose();
    });

    ipcMain.once(cancelChannel, () => {
      finish(null);
      cleanupAndClose();
    });

    selectorWindow.on('closed', () => {
      finish(null);
    });

    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: crosshair;
        background: rgba(15, 23, 42, 0.2);
        user-select: none;
      }
      #hint {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.88);
        color: #e2e8f0;
        font-family: Segoe UI, Arial, sans-serif;
        font-size: 12px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        pointer-events: none;
      }
      #selection {
        position: fixed;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.12);
        display: none;
        box-shadow: 0 0 0 99999px rgba(2, 6, 23, 0.4);
      }
    </style>
  </head>
  <body>
    <div id="hint">Drag to capture a region. Press Esc to cancel.</div>
    <div id="selection"></div>
    <script>
      const { ipcRenderer } = require('electron');
      const submitChannel = ${JSON.stringify(submitChannel)};
      const cancelChannel = ${JSON.stringify(cancelChannel)};
      const selectionEl = document.getElementById('selection');
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let currentY = 0;

      function rectFromPoints() {
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        return { x: left, y: top, width, height };
      }

      function renderRect() {
        const r = rectFromPoints();
        selectionEl.style.display = 'block';
        selectionEl.style.left = r.x + 'px';
        selectionEl.style.top = r.y + 'px';
        selectionEl.style.width = r.width + 'px';
        selectionEl.style.height = r.height + 'px';
      }

      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        currentX = e.clientX;
        currentY = e.clientY;
        renderRect();
      });

      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        currentX = e.clientX;
        currentY = e.clientY;
        renderRect();
      });

      window.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        currentX = e.clientX;
        currentY = e.clientY;
        const rect = rectFromPoints();
        if (rect.width < 4 || rect.height < 4) {
          ipcRenderer.send(cancelChannel);
          return;
        }
        ipcRenderer.send(submitChannel, rect);
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          ipcRenderer.send(cancelChannel);
        }
      });

      window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ipcRenderer.send(cancelChannel);
      });
    </script>
  </body>
</html>
`;

    selectorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    selectorWindow.once('ready-to-show', () => {
      selectorWindow.show();
      selectorWindow.focus();
    });
  });
}

function loadRoute(win: BrowserWindow, route: string): void {
  const normalizedRoute = route.startsWith('#')
    ? route
    : `#${route.startsWith('/') ? route : `/${route}`}`;

  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/+$/, '');
    win.loadURL(`${devServerUrl}/${normalizedRoute}`);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    win.loadFile(indexPath, { hash: normalizedRoute.replace(/^#/, '') });
  }
}

function applyWindowSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (process.env.VITE_DEV_SERVER_URL && navigationUrl.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    if (navigationUrl.startsWith('file://')) {
      return;
    }
    event.preventDefault();
  });
}

function getPreloadPath(): string {
  const direct = path.join(__dirname, 'preload.js');
  if (fs.existsSync(direct)) return direct;
  const inElectronSubdir = path.join(__dirname, 'electron', 'preload.js');
  if (fs.existsSync(inElectronSubdir)) return inElectronSubdir;
  const inParentDir = path.join(__dirname, '..', 'preload.js');
  if (fs.existsSync(inParentDir)) return inParentDir;
  return direct;
}

function createStudioWindow(): BrowserWindow {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    return studioWindow;
  }

  // Some Windows environments block sandboxed renderer startup for unsigned internal apps.
  const enableRendererSandbox = process.platform !== 'win32';

  const showImmediately = process.platform === 'win32';

  studioWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'StepFlow - SOP Creator',
    show: showImmediately,
    frame: process.platform === 'darwin' ? false : true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: enableRendererSandbox,
      backgroundThrottling: false,
    },
  });

  applyWindowSecurity(studioWindow);

  // Failsafe: ensure the window still appears if ready-to-show never fires.
  const showFallbackTimer = setTimeout(() => {
    if (studioWindow && !studioWindow.isDestroyed() && !studioWindow.isVisible()) {
      appendRuntimeLog('[Window] ready-to-show timeout reached, forcing show()');
      studioWindow.show();
      studioWindow.focus();
    }
  }, 8000);

  studioWindow.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    appendRuntimeLog('[Window] ready-to-show fired');
    studioWindow?.show();
    studioWindow?.focus();
  });

  studioWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendRuntimeLog(
      `[Window] did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`
    );
    if (studioWindow && !studioWindow.isDestroyed() && !studioWindow.isVisible()) {
      studioWindow.show();
      studioWindow.focus();
    }
  });

  studioWindow.webContents.on('render-process-gone', (_event, details) => {
    appendRuntimeLog(
      `[Window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`
    );
  });

  studioWindow.on('closed', () => {
    clearTimeout(showFallbackTimer);
    studioWindow = null;
    if (process.platform !== 'darwin') {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
      }
      app.quit();
    }
  });

  loadRoute(studioWindow, '#/studio');

  if (showImmediately) {
    studioWindow.show();
    studioWindow.focus();
  }

  return studioWindow;
}

function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const enableRendererSandbox = process.platform !== 'win32';

  overlayWindow = new BrowserWindow({
    width: 204,
    height: 76,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: enableRendererSandbox,
      backgroundThrottling: false,
    },
  });

  applyWindowSecurity(overlayWindow);

  // Ensure floating level above standard windows
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  overlayWindow.webContents.on('did-finish-load', () => {
    if (lastActiveProject && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('active-project-synced', lastActiveProject);
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  loadRoute(overlayWindow, '#/overlay');
  return overlayWindow;
}

function setOverlayMode(mode: 'collapsed' | 'expanded' | 'preview'): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const modeSizes: Record<'collapsed' | 'expanded' | 'preview', { width: number; height: number }> = {
    collapsed: { width: 204, height: 76 },
    expanded: { width: 380, height: 280 },
    preview: { width: 340, height: 180 },
  };

  const target = modeSizes[mode] || modeSizes.collapsed;
  const currentBounds = overlayWindow.getBounds();

  // Find the active display nearest to overlay
  const currentDisplay = screen.getDisplayNearestPoint({
    x: currentBounds.x + Math.floor(currentBounds.width / 2),
    y: currentBounds.y + Math.floor(currentBounds.height / 2),
  });
  const workArea = currentDisplay.workArea;

  // Anchor dynamically to current corner
  const displayMidX = workArea.x + workArea.width / 2;
  const displayMidY = workArea.y + workArea.height / 2;

  let newX = currentBounds.x;
  if (currentBounds.x > displayMidX) {
    // Right anchor
    newX = currentBounds.x + currentBounds.width - target.width;
  }

  let newY = currentBounds.y;
  if (currentBounds.y > displayMidY) {
    // Bottom anchor
    newY = currentBounds.y + currentBounds.height - target.height;
  }

  // Clamp within workArea limits with padding
  const padding = 8;
  if (newX + target.width > workArea.x + workArea.width - padding) {
    newX = workArea.x + workArea.width - target.width - padding;
  }
  if (newY + target.height > workArea.y + workArea.height - padding) {
    newY = workArea.y + workArea.height - target.height - padding;
  }
  if (newX < workArea.x + padding) {
    newX = workArea.x + padding;
  }
  if (newY < workArea.y + padding) {
    newY = workArea.y + padding;
  }

  overlayWindow.setBounds({
    x: Math.round(newX),
    y: Math.round(newY),
    width: target.width,
    height: target.height,
  });
}

async function performCapture(isRetake = false, mode: 'fullscreen' | 'selection' = 'fullscreen'): Promise<string | null> {
  if (isCapturing) {
    console.warn('[Capture] Another capture is currently in progress');
    return null;
  }
  isCapturing = true;

  let overlayWasVisible = false;
  let studioWasVisible = false;

  try {
    const assetsDir = getAssetsDir();
    await fs.promises.mkdir(assetsDir, { recursive: true });

    const filename = `step_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
    const filePath = path.join(assetsDir, filename);

    // Hide windows temporarily so they are not captured in the screenshot
    overlayWasVisible = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
    if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }

    studioWasVisible = Boolean(studioWindow && !studioWindow.isDestroyed() && studioWindow.isVisible());
    if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.hide();
    }

    if (overlayWasVisible || studioWasVisible) {
      // Allow window manager compositor to flush
      await new Promise((resolve) => setTimeout(resolve, 140));
    }

    let captureSuccess = false;
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const scaleFactor = activeDisplay.scaleFactor || 1;
    let selectedRectDip: SelectionRect | null = null;

    appendRuntimeLog(
      `[Capture] start mode=${mode} isRetake=${String(Boolean(isRetake || currentRetakeStepId))} displayId=${activeDisplay.id} cursor=(${cursorPoint.x},${cursorPoint.y}) displayBounds=(${activeDisplay.bounds.x},${activeDisplay.bounds.y},${activeDisplay.bounds.width}x${activeDisplay.bounds.height}) scale=${scaleFactor}`
    );

    if (mode === 'selection' && process.platform !== 'darwin') {
      selectedRectDip = await requestSelectionRect(activeDisplay);
      if (!selectedRectDip) {
        appendRuntimeLog('[Capture] selection cancelled before screenshot');
        if (isRetake || currentRetakeStepId) {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.hide();
          }
          if (studioWindow && !studioWindow.isDestroyed()) {
            if (studioWindow.isMinimized()) studioWindow.restore();
            studioWindow.show();
            studioWindow.focus();
            studioWindow.webContents.send('studio-restored');
          }
          currentRetakeStepId = null;
        } else {
          if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.showInactive();
          }
          if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
            if (studioWindow.isMinimized()) studioWindow.restore();
            studioWindow.show();
            studioWindow.focus();
          }
        }
        return null;
      }

      appendRuntimeLog(
        `[Capture] selection rect dip=(${selectedRectDip.x},${selectedRectDip.y},${selectedRectDip.width}x${selectedRectDip.height})`
      );
    }

    // Strategy 1 (macOS): Native screencapture CLI
    if (process.platform === 'darwin') {
      try {
        // -i: interactive (selection), -s: mouse selection mode, -x: mute sound
        const screencaptureArgs = mode === 'selection' ? ['-i', '-s', '-x', filePath] : ['-x', filePath];
        const nativeSuccess = await new Promise<boolean>((resolve) => {
          execFile('/usr/sbin/screencapture', screencaptureArgs, (err) => {
            if (err) {
              // User cancelled interactive selection with Escape
              resolve(false);
            } else {
              const fileReady = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
              resolve(fileReady);
            }
          });
        });

        if (nativeSuccess) {
          captureSuccess = true;
        } else if (mode === 'selection') {
          // If interactive selection was cancelled by user, restore windows
          if (isRetake || currentRetakeStepId) {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.hide();
            }
            if (studioWindow && !studioWindow.isDestroyed()) {
              if (studioWindow.isMinimized()) studioWindow.restore();
              studioWindow.show();
              studioWindow.focus();
              studioWindow.webContents.send('studio-restored');
            }
            currentRetakeStepId = null;
          } else {
            if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.showInactive();
            }
            if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
              if (studioWindow.isMinimized()) studioWindow.restore();
              studioWindow.show();
              studioWindow.focus();
            }
          }
          return null;
        }
      } catch (nativeErr) {
        console.warn('[Capture] Native screencapture exception:', nativeErr);
      }
    }

    // Strategy 2: Electron desktopCapturer (for Windows, Linux, or macOS fallback)
    if (!captureSuccess) {
      try {
        const captureWidth = Math.round(activeDisplay.size.width * scaleFactor);
        const captureHeight = Math.round(activeDisplay.size.height * scaleFactor);

        appendRuntimeLog(
          `[Capture] desktopCapturer requested size=${captureWidth}x${captureHeight} mode=${mode}`
        );

        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: captureWidth,
            height: captureHeight,
          },
          fetchWindowIcons: false,
        });

        if (sources && sources.length > 0) {
          let targetSource = sources.find((s) => s.display_id === String(activeDisplay.id));
          if (!targetSource) {
            targetSource = sources.find((s) => s.id.includes(String(activeDisplay.id)));
          }
          if (!targetSource) {
            targetSource = sources[0];
          }

          let imgBuffer = targetSource.thumbnail.toPNG();
          if (imgBuffer && imgBuffer.length > 0) {
            if (mode === 'selection' && selectedRectDip) {
              const image = nativeImage.createFromBuffer(imgBuffer);
              const imageSize = image.getSize();
              const cropX = Math.max(0, Math.floor(selectedRectDip.x * scaleFactor));
              const cropY = Math.max(0, Math.floor(selectedRectDip.y * scaleFactor));
              const cropWidth = Math.min(
                imageSize.width - cropX,
                Math.max(1, Math.floor(selectedRectDip.width * scaleFactor))
              );
              const cropHeight = Math.min(
                imageSize.height - cropY,
                Math.max(1, Math.floor(selectedRectDip.height * scaleFactor))
              );

              if (cropWidth > 1 && cropHeight > 1) {
                appendRuntimeLog(
                  `[Capture] crop applied px=(${cropX},${cropY},${cropWidth}x${cropHeight}) source=${imageSize.width}x${imageSize.height}`
                );
                imgBuffer = image.crop({ x: cropX, y: cropY, width: cropWidth, height: cropHeight }).toPNG();
              } else {
                appendRuntimeLog(
                  `[Capture] crop skipped due to tiny region px=(${cropX},${cropY},${cropWidth}x${cropHeight})`
                );
              }
            }

            await fs.promises.writeFile(filePath, imgBuffer);
            captureSuccess = true;
            appendRuntimeLog(`[Capture] saved file=${filePath}`);
          }
        }
      } catch (capturerErr) {
        console.warn('[Capture] desktopCapturer failed:', capturerErr);
        appendRuntimeLog('[Capture] desktopCapturer failed', capturerErr);
      }
    }

    // Strategy 3: Graceful fallback if screen recording permission is missing on macOS
    if (!captureSuccess) {
      console.warn('[Capture] Both capture methods failed. Checking macOS Screen Recording permission...');
      
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus ? systemPreferences.getMediaAccessStatus('screen') : 'unknown';
        if (status !== 'granted') {
          dialog.showMessageBox({
            type: 'warning',
            title: 'Screen Recording Permission Required',
            message: 'macOS requires Screen Recording permission for StepFlow to capture your screen.',
            detail: 'Please open System Settings > Privacy & Security > Screen Recording, and enable access for StepFlow (or Terminal / IDE).',
            buttons: ['Open System Settings', 'Later'],
            defaultId: 0,
          }).then(({ response }) => {
            if (response === 0) {
              shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            }
          });
        }
      }

      // Generate a clean placeholder image so the user's workflow is never broken
      const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#0f172a"/><rect x="80" y="60" width="800" height="420" rx="12" fill="#1e293b" stroke="#3b82f6" stroke-width="2"/><circle cx="480" cy="210" r="40" fill="#2563eb"/><text x="480" y="222" font-family="system-ui" font-size="32" fill="#ffffff" text-anchor="middle">📷</text><text x="480" y="290" font-family="system-ui" font-weight="bold" font-size="20" fill="#f8fafc" text-anchor="middle">Screen Capture Placeholder</text><text x="480" y="325" font-family="system-ui" font-size="14" fill="#94a3b8" text-anchor="middle">Screen recording permission needed in macOS System Settings</text><text x="480" y="355" font-family="system-ui" font-size="12" fill="#60a5fa" text-anchor="middle">Privacy &amp; Security &gt; Screen Recording</text></svg>`;
      const fallbackDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgFallback)}`;

      if (!isRetake) {
        if (studioWindow && !studioWindow.isDestroyed()) {
          studioWindow.webContents.send('capture-completed', fallbackDataUri);
        }
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('capture-completed', fallbackDataUri);
        }
      }

      if (isRetake || currentRetakeStepId) {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.hide();
        }
        if (studioWindow && !studioWindow.isDestroyed()) {
          if (studioWindow.isMinimized()) studioWindow.restore();
          studioWindow.show();
          studioWindow.focus();
          studioWindow.webContents.send('studio-restored');
        }
        currentRetakeStepId = null;
      } else {
        if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.showInactive();
        }
        if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
          if (studioWindow.isMinimized()) studioWindow.restore();
          studioWindow.show();
          studioWindow.focus();
        }
      }

      return fallbackDataUri;
    }

    // Convert captured PNG to standard base64 data URI so browser/Konva can render it immediately
    let capturePayload = filePath;
    try {
      const imgBuffer = await fs.promises.readFile(filePath);
      capturePayload = `data:image/png;base64,${imgBuffer.toString('base64')}`;
    } catch (readErr) {
      console.warn('[Capture] Could not convert to base64, using file path:', readErr);
    }

    // Broadcast capture-completed event to all active windows
    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.webContents.send('capture-completed', capturePayload);
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('capture-completed', capturePayload);
    }

    // If this was a retake capture, automatically restore Studio window and focus
    if (isRetake || currentRetakeStepId) {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
      }
      if (studioWindow && !studioWindow.isDestroyed()) {
        if (studioWindow.isMinimized()) studioWindow.restore();
        studioWindow.show();
        studioWindow.focus();
        studioWindow.webContents.send('studio-restored');
      }
      currentRetakeStepId = null;
    } else {
      if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.showInactive();
      }
      if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
        if (studioWindow.isMinimized()) studioWindow.restore();
        studioWindow.show();
        studioWindow.focus();
      }
    }

    return capturePayload;
  } catch (error) {
    console.error('[Capture] Exception during screen capture:', error);
    appendRuntimeLog('[Capture] exception', error);
    if (isRetake || currentRetakeStepId) {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
      }
      if (studioWindow && !studioWindow.isDestroyed()) {
        if (studioWindow.isMinimized()) studioWindow.restore();
        studioWindow.show();
        studioWindow.focus();
        studioWindow.webContents.send('studio-restored');
      }
      currentRetakeStepId = null;
    } else {
      if (overlayWasVisible && overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isVisible()) {
        overlayWindow.showInactive();
      }
      if (studioWasVisible && studioWindow && !studioWindow.isDestroyed()) {
        if (studioWindow.isMinimized()) studioWindow.restore();
        studioWindow.show();
        studioWindow.focus();
      }
    }
    return null;
  } finally {
    isCapturing = false;
  }
}

function registerGlobalShortcuts(): void {
  // Full screen capture shortcut: Cmd/Ctrl+Alt+S (avoids OS-wide "Save As" conflict)
  const fullShortcut = 'CommandOrControl+Alt+S';
  const success = globalShortcut.register(fullShortcut, async () => {
    try {
      await performCapture(false, 'fullscreen');
    } catch (err) {
      console.error('[Shortcut] Error in full screen shortcut capture:', err);
    }
  });

  if (!success) {
    console.warn(`[Shortcut] Registration failed for ${fullShortcut}`);
  }

  // Area / Selection capture shortcut: Cmd/Ctrl+Alt+A
  const selectionShortcut = 'CommandOrControl+Alt+A';
  const selSuccess = globalShortcut.register(selectionShortcut, async () => {
    try {
      await performCapture(false, 'selection');
    } catch (err) {
      console.error('[Shortcut] Error in selection shortcut capture:', err);
    }
  });

  if (!selSuccess) {
    console.warn(`[Shortcut] Registration failed for ${selectionShortcut}`);
  }
}

async function showSaveDialogHelper(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  if (studioWindow && !studioWindow.isDestroyed()) {
    return await dialog.showSaveDialog(studioWindow, options);
  }
  return await dialog.showSaveDialog(options);
}

async function showOpenDialogHelper(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  if (studioWindow && !studioWindow.isDestroyed()) {
    return await dialog.showOpenDialog(studioWindow, options);
  }
  return await dialog.showOpenDialog(options);
}

function registerIpcHandlers(): void {
  // Capture & Hotkeys
  ipcMain.handle('trigger-capture', async (_event, isRetake?: boolean, mode: 'fullscreen' | 'selection' = 'fullscreen'): Promise<string | null> => {
    return await performCapture(Boolean(isRetake), mode);
  });

  // Window Management
  ipcMain.on('minimize-to-overlay', (_event, anchor?: { x: number; y: number }) => {
    let targetX: number | undefined;
    let targetY: number | undefined;

    if (!overlayWindow || overlayWindow.isDestroyed()) {
      createOverlayWindow();
    }

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const bounds = overlayWindow.getBounds();
      const primaryDisplay = screen.getPrimaryDisplay();

      if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
        // Center the overlay pill right where the minimize button was clicked
        targetX = Math.round(anchor.x - bounds.width / 2);
        targetY = Math.round(anchor.y - bounds.height / 2);
      } else if (studioWindow && !studioWindow.isDestroyed()) {
        // Fallback: top-right toolbar area of studio window
        const studioBounds = studioWindow.getBounds();
        targetX = Math.round(studioBounds.x + studioBounds.width - bounds.width - 24);
        targetY = Math.round(studioBounds.y + 12);
      }

      if (targetX !== undefined && targetY !== undefined) {
        const targetDisplay = screen.getDisplayNearestPoint({ x: targetX, y: targetY }) || primaryDisplay;
        const workArea = targetDisplay.workArea;

        const clampedX = Math.max(
          workArea.x + 8,
          Math.min(targetX, workArea.x + workArea.width - bounds.width - 8)
        );
        const clampedY = Math.max(
          workArea.y + 8,
          Math.min(targetY, workArea.y + workArea.height - bounds.height - 8)
        );

        overlayWindow.setPosition(clampedX, clampedY);
      }

      overlayWindow.showInactive();
      if (lastActiveProject) {
        overlayWindow.webContents.send('active-project-synced', lastActiveProject);
      }
    }

    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.hide();
    }
  });

  ipcMain.on('restore-studio', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }

    if (!studioWindow || studioWindow.isDestroyed()) {
      createStudioWindow();
    }

    if (studioWindow && !studioWindow.isDestroyed()) {
      if (studioWindow.isMinimized()) {
        studioWindow.restore();
      }
      studioWindow.show();
      studioWindow.focus();
      studioWindow.webContents.send('studio-restored');
    }
  });

  ipcMain.on('sync-active-project', (event, project: SopProject | null) => {
    lastActiveProject = project;
    if (overlayWindow && !overlayWindow.isDestroyed() && event.sender !== overlayWindow.webContents) {
      overlayWindow.webContents.send('active-project-synced', project);
    }
    if (studioWindow && !studioWindow.isDestroyed() && event.sender !== studioWindow.webContents) {
      studioWindow.webContents.send('active-project-synced', project);
    }
  });

  ipcMain.on('set-retake-step-id', (_event, stepId: string | null) => {
    currentRetakeStepId = stepId;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('retake-step-id-changed', stepId);
    }
    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.webContents.send('retake-step-id-changed', stepId);
    }
  });

  ipcMain.handle('get-retake-step-id', (): string | null => {
    return currentRetakeStepId;
  });

  ipcMain.handle('get-active-project', (): SopProject | null => {
    return lastActiveProject;
  });

  ipcMain.on('close-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  });

  ipcMain.on('set-overlay-size', (_event, mode: 'collapsed' | 'expanded' | 'preview') => {
    setOverlayMode(mode);
  });

  // Project I/O
  ipcMain.handle('list-projects', async (): Promise<SopProject[]> => {
    try {
      await ensureDirectories();
      const projectsDir = getProjectsDir();
      const files = await fs.promises.readdir(projectsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const projects: SopProject[] = [];

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(projectsDir, file);
          const raw = await fs.promises.readFile(filePath, 'utf-8');
          const project = JSON.parse(raw) as SopProject;
          if (project && project.id) {
            projects.push(project);
          }
        } catch (err) {
          console.warn(`[ProjectIO] Could not parse project file ${file}:`, err);
        }
      }

      projects.sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      return projects;
    } catch (err) {
      console.error('[ProjectIO] Failed to list projects:', err);
      return [];
    }
  });

  ipcMain.handle('save-project', async (_event, project: SopProject): Promise<boolean> => {
    try {
      if (!project || typeof project !== 'object' || !project.id) {
        console.error('[ProjectIO] Invalid project object provided to save-project');
        return false;
      }

      await ensureDirectories();
      const safeId = project.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(getProjectsDir(), `proj_${safeId}.json`);
      const tempPath = path.join(getProjectsDir(), `proj_${safeId}.${Date.now()}.tmp`);

      const now = new Date().toISOString();
      if (!project.createdAt) {
        project.createdAt = now;
      }
      project.updatedAt = now;
      lastActiveProject = project;

      recentlySavedByApp.add(filePath);
      setTimeout(() => recentlySavedByApp.delete(filePath), 800);

      // Atomic write to prevent file corruption on crash or interruption
      await fs.promises.writeFile(tempPath, JSON.stringify(project, null, 2), 'utf-8');
      await fs.promises.rename(tempPath, filePath);
      return true;
    } catch (err) {
      console.error('[ProjectIO] Failed to save project:', err);
      return false;
    }
  });

  ipcMain.handle('load-project', async (_event, id: string): Promise<SopProject | null> => {
    try {
      if (!id || typeof id !== 'string') return null;
      await ensureDirectories();
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(getProjectsDir(), `proj_${safeId}.json`);

      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as SopProject;
      } catch (readErr: any) {
        if (readErr && readErr.code === 'ENOENT') {
          // Backward compatibility check for legacy un-prefixed filenames
          const legacyPath = path.join(getProjectsDir(), `${safeId}.json`);
          try {
            const legacyRaw = await fs.promises.readFile(legacyPath, 'utf-8');
            return JSON.parse(legacyRaw) as SopProject;
          } catch {
            return null;
          }
        }
        throw readErr;
      }
    } catch (err) {
      console.error(`[ProjectIO] Failed to load project ${id}:`, err);
      return null;
    }
  });

  ipcMain.handle('delete-project', async (_event, id: string): Promise<boolean> => {
    try {
      if (!id || typeof id !== 'string') return false;
      await ensureDirectories();
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(getProjectsDir(), `proj_${safeId}.json`);
      const legacyPath = path.join(getProjectsDir(), `${safeId}.json`);

      if (lastActiveProject?.id === id) {
        lastActiveProject = null;
      }

      recentlySavedByApp.add(filePath);
      recentlySavedByApp.add(legacyPath);
      setTimeout(() => {
        recentlySavedByApp.delete(filePath);
        recentlySavedByApp.delete(legacyPath);
      }, 800);

      let deleted = false;
      try {
        await fs.promises.unlink(filePath);
        deleted = true;
      } catch (err: any) {
        if (err.code !== 'ENOENT') console.warn(`[ProjectIO] Unlink error for ${filePath}:`, err);
      }

      try {
        await fs.promises.unlink(legacyPath);
        deleted = true;
      } catch (err: any) {
        if (err.code !== 'ENOENT') console.warn(`[ProjectIO] Unlink error for ${legacyPath}:`, err);
      }

      return deleted || true;
    } catch (err) {
      console.error(`[ProjectIO] Failed to delete project ${id}:`, err);
      return false;
    }
  });

  // Export HTML
  ipcMain.handle(
    'export-html',
    async (
      _event,
      project: SopProject,
      htmlContent?: string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        if (!project || !project.name) {
          return { success: false, error: 'Invalid project data provided' };
        }

        const safeDefaultName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'sop'}.html`;
        const { canceled, filePath } = await showSaveDialogHelper({
          title: 'Export SOP as HTML',
          defaultPath: safeDefaultName,
          filters: [{ name: 'HTML Document', extensions: ['html'] }],
        });

        if (canceled || !filePath) {
          return { success: false, error: 'Export canceled by user' };
        }

        if (htmlContent) {
          await fs.promises.writeFile(filePath, htmlContent, 'utf-8');
          return { success: true, filePath };
        }

        return { success: false, error: 'No HTML content provided' };
      } catch (err) {
        console.error('[ExportHTML] Error exporting HTML:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Export PDF
  ipcMain.handle(
    'export-pdf',
    async (
      _event,
      project: SopProject,
      pdfData?: ArrayBuffer | Uint8Array | string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        if (!project || !project.name) {
          return { success: false, error: 'Invalid project data provided' };
        }

        const safeDefaultName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'sop'}.pdf`;
        const { canceled, filePath } = await showSaveDialogHelper({
          title: 'Export SOP as PDF',
          defaultPath: safeDefaultName,
          filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
        });

        if (canceled || !filePath) {
          return { success: false, error: 'Export canceled by user' };
        }

        if (pdfData) {
          let buffer: Buffer;
          if (typeof pdfData === 'string') {
            const cleanBase64 = pdfData.replace(/^data:[^;]+;base64,/, '');
            buffer = Buffer.from(cleanBase64, pdfData.startsWith('data:') ? 'base64' : 'utf-8');
          } else {
            buffer = Buffer.from(pdfData);
          }
          await fs.promises.writeFile(filePath, buffer);
          return { success: true, filePath };
        }

        return { success: false, error: 'No PDF data provided' };
      } catch (err) {
        console.error('[ExportPDF] Error exporting PDF:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Export PPTX
  ipcMain.handle(
    'export-pptx',
    async (
      _event,
      project: SopProject,
      pptxData?: ArrayBuffer | Uint8Array | string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        if (!project || !project.name) {
          return { success: false, error: 'Invalid project data provided' };
        }

        const safeDefaultName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'sop'}.pptx`;
        const { canceled, filePath } = await showSaveDialogHelper({
          title: 'Export SOP as PowerPoint',
          defaultPath: safeDefaultName,
          filters: [{ name: 'PowerPoint Presentation', extensions: ['pptx'] }],
        });

        if (canceled || !filePath) {
          return { success: false, error: 'Export canceled by user' };
        }

        if (pptxData) {
          let buffer: Buffer;
          if (typeof pptxData === 'string') {
            const cleanBase64 = pptxData.replace(/^data:[^;]+;base64,/, '');
            buffer = Buffer.from(cleanBase64, pptxData.startsWith('data:') ? 'base64' : 'binary');
          } else {
            buffer = Buffer.from(pptxData);
          }
          await fs.promises.writeFile(filePath, buffer);
          return { success: true, filePath };
        }

        return { success: false, error: 'No PowerPoint data provided' };
      } catch (err) {
        console.error('[ExportPPTX] Error exporting PPTX:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  // Workspace & Shared Storage Management
  ipcMain.handle('get-workspace-path', async () => {
    return {
      path: getWorkspaceRoot(),
      isCustom: Boolean(customStorageDir),
      defaultPath: app.getPath('userData'),
    };
  });

  ipcMain.handle('open-workspace-folder', async () => {
    try {
      const root = getWorkspaceRoot();
      await ensureDirectories();
      await shell.openPath(root);
    } catch (err) {
      console.warn('[Workspace] Failed to open folder:', err);
    }
  });

  ipcMain.handle('change-workspace-path', async () => {
    try {
      const { canceled, filePaths } = await showOpenDialogHelper({
        title: 'Select StepFlow Team Workspace Folder',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Select Workspace Folder',
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true, error: 'Selection canceled' };
      }

      const selectedDir = filePaths[0];
      const previousProjectsDir = getProjectsDir();
      const previousAssetsDir = getAssetsDir();

      customStorageDir = selectedDir;
      saveConfig();

      // Ensure new workspace subdirectories exist
      await ensureDirectories();

      // Migrate existing local projects to new workspace if new workspace is empty
      try {
        const newProjectsDir = getProjectsDir();
        const existingInNew = await fs.promises.readdir(newProjectsDir).catch(() => []);
        const jsonInNew = existingInNew.filter((f) => f.endsWith('.json'));

        if (jsonInNew.length === 0 && fs.existsSync(previousProjectsDir)) {
          const oldFiles = await fs.promises.readdir(previousProjectsDir).catch(() => []);
          for (const f of oldFiles) {
            if (f.endsWith('.json')) {
              await fs.promises.copyFile(
                path.join(previousProjectsDir, f),
                path.join(newProjectsDir, f)
              ).catch(() => {});
            }
          }

          if (fs.existsSync(previousAssetsDir)) {
            const oldAssets = await fs.promises.readdir(previousAssetsDir).catch(() => []);
            for (const a of oldAssets) {
              if (a.endsWith('.png') || a.endsWith('.jpg') || a.endsWith('.svg')) {
                await fs.promises.copyFile(
                  path.join(previousAssetsDir, a),
                  path.join(getAssetsDir(), a)
                ).catch(() => {});
              }
            }
          }
        }
      } catch (copyErr) {
        console.warn('[Workspace] Note on copying existing projects:', copyErr);
      }

      // Re-initialize projects file watcher on the new directory
      setupProjectsFileWatcher();

      const pathInfo = {
        path: getWorkspaceRoot(),
        isCustom: true,
        defaultPath: app.getPath('userData'),
      };

      if (studioWindow && !studioWindow.isDestroyed()) {
        studioWindow.webContents.send('workspace-path-changed', pathInfo);
      }
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('workspace-path-changed', pathInfo);
      }

      return { success: true, newPath: selectedDir };
    } catch (err) {
      console.error('[Workspace] Failed to change workspace folder:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('reset-workspace-path', async () => {
    try {
      customStorageDir = null;
      saveConfig();
      await ensureDirectories();
      setupProjectsFileWatcher();

      const pathInfo = {
        path: getWorkspaceRoot(),
        isCustom: false,
        defaultPath: app.getPath('userData'),
      };

      if (studioWindow && !studioWindow.isDestroyed()) {
        studioWindow.webContents.send('workspace-path-changed', pathInfo);
      }
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('workspace-path-changed', pathInfo);
      }

      return { success: true, defaultPath: app.getPath('userData') };
    } catch (err) {
      console.error('[Workspace] Failed to reset workspace folder:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Portable Bundles (.stepflow export & import)
  ipcMain.handle(
    'export-project-bundle',
    async (
      _event,
      project: SopProject
    ): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
      try {
        if (!project || !project.name) {
          return { success: false, error: 'Invalid project data provided' };
        }

        const safeDefaultName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'procedure'}.stepflow`;
        const { canceled, filePath } = await showSaveDialogHelper({
          title: 'Export StepFlow Portable Bundle',
          defaultPath: safeDefaultName,
          filters: [
            { name: 'StepFlow Bundle (*.stepflow)', extensions: ['stepflow'] },
            { name: 'Zip Archive (*.zip)', extensions: ['zip'] },
          ],
        });

        if (canceled || !filePath) {
          return { success: false, canceled: true, error: 'Export canceled by user' };
        }

        const zip = new JSZip();

        // 1. Add manifest
        const manifest = {
          format: 'stepflow',
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          projectId: project.id,
          name: project.name,
          author: project.author,
          stepCount: project.steps.length,
        };
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        // 2. Clone project for bundle
        const bundledProject: SopProject = JSON.parse(JSON.stringify(project));
        const assetsFolder = zip.folder('assets');

        // 3. Collect and embed assets
        for (const step of bundledProject.steps) {
          if (step.image && step.image.originalImagePath) {
            const rawPath = step.image.originalImagePath;
            const assetFileName = `step_${step.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;

            if (rawPath.startsWith('data:image/')) {
              const base64Data = rawPath.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
              if (assetsFolder) {
                assetsFolder.file(assetFileName, Buffer.from(base64Data, 'base64'));
                step.image.originalImagePath = `assets/${assetFileName}`;
              }
            } else {
              let cleanPath = rawPath.replace(/^stepflow-asset:\/\//, '');
              if (process.platform === 'win32' && cleanPath.startsWith('/') && /^[a-zA-Z]:/.test(cleanPath.slice(1))) {
                cleanPath = cleanPath.slice(1);
              }
              const resolved = path.isAbsolute(cleanPath)
                ? cleanPath
                : path.join(getAssetsDir(), cleanPath);

              if (fs.existsSync(resolved)) {
                const imgBuffer = await fs.promises.readFile(resolved);
                if (assetsFolder) {
                  assetsFolder.file(assetFileName, imgBuffer);
                  step.image.originalImagePath = `assets/${assetFileName}`;
                }
              }
            }
          }
        }

        zip.file('project.json', JSON.stringify(bundledProject, null, 2));

        const zipBuffer = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });

        await fs.promises.writeFile(filePath, zipBuffer);
        return { success: true, filePath };
      } catch (err) {
        console.error('[ExportBundle] Failed to export bundle:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    'import-project-bundle',
    async (): Promise<{ success: boolean; canceled?: boolean; project?: SopProject; error?: string }> => {
      try {
        const { canceled, filePaths } = await showOpenDialogHelper({
          title: 'Import StepFlow Bundle',
          filters: [
            { name: 'StepFlow Bundle (*.stepflow, *.zip)', extensions: ['stepflow', 'zip'] },
            { name: 'All Files (*.*)', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });

        if (canceled || !filePaths || filePaths.length === 0) {
          return { success: false, canceled: true, error: 'Import canceled by user' };
        }

        const bundlePath = filePaths[0];
        const fileBuffer = await fs.promises.readFile(bundlePath);
        const zip = await JSZip.loadAsync(fileBuffer);

        // Find project.json
        const projectJsonFile = zip.file('project.json') || zip.file(/^[^/]+\.json$/)[0];
        if (!projectJsonFile) {
          return { success: false, error: 'Invalid StepFlow bundle: missing project.json' };
        }

        const projectRaw = await projectJsonFile.async('text');
        const project = JSON.parse(projectRaw) as SopProject;

        if (!project || !project.id || !project.name) {
          return { success: false, error: 'Invalid project data in bundle' };
        }

        await ensureDirectories();
        const assetsDir = getAssetsDir();

        // Extract assets
        if (Array.isArray(project.steps)) {
          for (const step of project.steps) {
            if (step.image && step.image.originalImagePath) {
              const rawPath = step.image.originalImagePath;
              const zipAssetPath = rawPath.startsWith('assets/') ? rawPath : `assets/${rawPath}`;
              const zipAssetFile = zip.file(zipAssetPath) || zip.file(rawPath);

              if (zipAssetFile) {
                const assetBuffer = await zipAssetFile.async('nodebuffer');
                const ext = path.extname(zipAssetPath) || '.png';
                const targetName = `step_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
                const targetPath = path.join(assetsDir, targetName);
                await fs.promises.writeFile(targetPath, assetBuffer);
                step.image.originalImagePath = `data:image/png;base64,${assetBuffer.toString('base64')}`;
              }
            }
          }
        }

        // Check for ID collision; if duplicate, assign fresh ID and suffix title
        const existingPath = path.join(getProjectsDir(), `proj_${project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
        if (fs.existsSync(existingPath)) {
          project.id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          project.name = `${project.name} (Imported)`;
        }

        project.updatedAt = new Date().toISOString();

        // Save project into active projects directory
        const savePath = path.join(getProjectsDir(), `proj_${project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
        recentlySavedByApp.add(savePath);
        setTimeout(() => recentlySavedByApp.delete(savePath), 800);
        await fs.promises.writeFile(savePath, JSON.stringify(project, null, 2), 'utf-8');

        // Broadcast to studio window
        if (studioWindow && !studioWindow.isDestroyed()) {
          studioWindow.webContents.send('project-file-changed', {
            id: project.id,
            action: 'save',
            project,
          });
        }

        return { success: true, project };
      } catch (err) {
        console.error('[ImportBundle] Failed to import bundle:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}

// App lifecycle
app.whenReady().then(async () => {
  appendRuntimeLog('[App] whenReady start');

  process.on('uncaughtException', (err) => {
    appendRuntimeLog('[Process] uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    appendRuntimeLog('[Process] unhandledRejection', reason);
  });

  app.on('child-process-gone', (_event, details) => {
    appendRuntimeLog(
      `[App] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
    );
  });

  app.on('browser-window-created', (_event, window) => {
    appendRuntimeLog('[App] browser-window-created');
    window.on('closed', () => {
      appendRuntimeLog('[App] browser-window-closed');
    });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    appendRuntimeLog(
      `[App] render-process-gone reason=${details.reason} exitCode=${details.exitCode} url=${webContents.getURL()}`
    );
  });

  loadConfig();
  // Protocol handler for streaming local assets securely
  protocol.handle('stepflow-asset', (request) => {
    try {
      let decodedPath = decodeURIComponent(request.url.replace(/^stepflow-asset:\/\//, ''));
      if (process.platform === 'win32' && decodedPath.startsWith('/') && /^[a-zA-Z]:/.test(decodedPath.slice(1))) {
        decodedPath = decodedPath.slice(1);
      }
      const resolved = path.resolve(decodedPath);
      const allowedDir = path.resolve(getAssetsDir());
      // Security check: ensure the resolved path starts with allowedDir
      if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
        console.warn('[Protocol] Access denied for asset outside allowed directory:', resolved);
        return new Response('Access denied', { status: 403 });
      }
      if (!fs.existsSync(resolved)) {
        return new Response('Asset not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(resolved).toString());
    } catch (err) {
      console.error('[Protocol] Error streaming asset:', err);
      return new Response('Asset not found', { status: 404 });
    }
  });

  await ensureDirectories();
  appendRuntimeLog('[App] directories ready');
  setupProjectsFileWatcher();
  registerIpcHandlers();
  registerGlobalShortcuts();
  appendRuntimeLog('[App] ipc and shortcuts registered');

  createStudioWindow();
  appendRuntimeLog('[App] windows created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 || !studioWindow || studioWindow.isDestroyed()) {
      createStudioWindow();
    } else {
      studioWindow.show();
      studioWindow.focus();
    }
  });
});

app.on('second-instance', () => {
  if (!studioWindow || studioWindow.isDestroyed()) {
    createStudioWindow();
    return;
  }

  if (studioWindow.isMinimized()) {
    studioWindow.restore();
  }
  studioWindow.show();
  studioWindow.focus();
});

app.on('window-all-closed', () => {
  appendRuntimeLog('[App] window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  appendRuntimeLog('[App] will-quit');
  if (projectWatcher) {
    try {
      projectWatcher.close();
    } catch {}
  }
  globalShortcut.unregisterAll();
});
