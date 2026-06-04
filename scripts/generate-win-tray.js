// scripts/generate-win-tray.js
//
// One-shot: rasterizes the 3-bar Nowtify mark in 4 state colors to PNGs for
// the Windows system tray. Run with `electron scripts/generate-win-tray.js`,
// then commit assets/tray/win/*.png. Windows tray icons are static per state
// here (fallback); the live colored pulse comes from the runtime rasterizer.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'tray', 'win');
const STATES = {
  idle: '#9aa0aa',
  alert: '#dc2626',
  snoozed: '#fbbf24',
  paused: '#6b7280',
};

function svg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 22 22">`
    + `<rect x="5" y="5.0" width="12" height="2.5" rx="1.25" fill="${color}"/>`
    + `<rect x="3.5" y="9.0" width="15" height="3.0" rx="1.50" fill="${color}"/>`
    + `<rect x="2" y="13.5" width="18" height="3.5" rx="1.75" fill="${color}"/>`
    + `</svg>`;
}

async function rasterize(win, color, size) {
  win.setBounds({ x: 0, y: 0, width: size, height: size });
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;}
    img{display:block;width:${size}px;height:${size}px;}
    </style></head><body>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg(color)).toString('base64')}">
    </body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return img.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: 64, height: 64, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  for (const [state, color] of Object.entries(STATES)) {
    const img = await rasterize(win, color, 32);
    fs.writeFileSync(path.join(OUT_DIR, `${state}.png`), img.toPNG());
    console.log('wrote', state, img.getSize());
  }
  app.quit();
});
