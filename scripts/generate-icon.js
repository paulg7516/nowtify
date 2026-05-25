/**
 * One-shot Electron script: renders the app icon (transparent 1024×1024 PNG)
 * AND the menu bar tray icon variants (idle / alert / alert-dim / snoozed /
 * paused, at @1x and @2x).
 *
 * Usage: `npm run icon`
 *
 * Notes:
 *   - qlmanage and sips don't preserve SVG transparency. Electron does.
 *   - Reuses a single BrowserWindow across renders (creating + destroying one
 *     per variant hit a Mach port race on macOS).
 *   - Idle / paused are authored black so they can be flagged as macOS
 *     "template images" at runtime; the OS tints them to the menu bar color.
 *   - Alert / snoozed are full color (red / amber) so they pop.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT = path.join(__dirname, '..');
const SRC_SVG = path.join(PROJECT, 'build', 'icon-source.svg');
const OUT_APP_ICON = path.join(PROJECT, 'build', 'icon.png');
const TRAY_DIR = path.join(PROJECT, 'assets', 'tray');

const TRAY_VARIANTS = {
  idle:        { color: '#000000', baseOpacity: 1.0 },
  alert:       { color: '#ef4444', baseOpacity: 1.0 },
  'alert-dim': { color: '#ef4444', baseOpacity: 0.4 },
  snoozed:     { color: '#f59e0b', baseOpacity: 1.0 },
  paused:      { color: '#000000', baseOpacity: 0.55 },
};

function traySvg({ color, baseOpacity }) {
  const o = (n) => (n * baseOpacity).toFixed(3);
  return `<svg viewBox="0 0 22 22" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
    <rect x="5"   y="5.0"  width="12" height="2.5" rx="1.25" fill="${color}" opacity="${o(0.55)}"/>
    <rect x="3.5" y="9.0"  width="15" height="3.0" rx="1.50" fill="${color}" opacity="${o(0.80)}"/>
    <rect x="2"   y="13.5" width="18" height="3.5" rx="1.75" fill="${color}" opacity="${o(1.0)}"/>
  </svg>`;
}

function wrapSvg(svg) {
  return `<!DOCTYPE html><html style="background:transparent"><head><style>
    html,body{margin:0;padding:0;background:transparent}
    body{width:1024px;height:1024px;overflow:hidden}
    svg{display:block;width:1024px;height:1024px}
  </style></head><body>${svg}</body></html>`;
}

async function renderInWindow(win, svg) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(wrapSvg(svg)));
  // Give the renderer time to settle (filters, gradients).
  await new Promise((r) => setTimeout(r, 250));
  const image = await win.webContents.capturePage();
  return image.toPNG();
}

async function main() {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });

  // 1. App icon
  const appSvg = fs.readFileSync(SRC_SVG, 'utf8');
  const appPng = await renderInWindow(win, appSvg);
  fs.writeFileSync(OUT_APP_ICON, appPng);
  console.log('wrote', OUT_APP_ICON, fs.statSync(OUT_APP_ICON).size, 'bytes');

  // 2. Tray variants
  fs.mkdirSync(TRAY_DIR, { recursive: true });
  for (const [name, conf] of Object.entries(TRAY_VARIANTS)) {
    const png = await renderInWindow(win, traySvg(conf));
    const tempPath = path.join(TRAY_DIR, `_temp_${name}.png`);
    fs.writeFileSync(tempPath, png);
    const out1x = path.join(TRAY_DIR, `${name}.png`);
    const out2x = path.join(TRAY_DIR, `${name}@2x.png`);
    execSync(`sips -z 22 22 "${tempPath}" --out "${out1x}" >/dev/null 2>&1`);
    execSync(`sips -z 44 44 "${tempPath}" --out "${out2x}" >/dev/null 2>&1`);
    fs.unlinkSync(tempPath);
    console.log('wrote', `${name}.png + @2x`);
  }

  win.destroy();
}

app.whenReady().then(async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
