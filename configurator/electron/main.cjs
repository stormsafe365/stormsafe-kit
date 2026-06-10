const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Dev = running unpackaged (the Vite dev server is up); production = the packaged
// app loading bundled files. Using Electron's own app.isPackaged avoids the
// electron-is-dev dependency, which is ESM-only at v3 and would throw
// ERR_REQUIRE_ESM when require()d from this CommonJS file in the packaged build.
const isDev = !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      // The 3D view (build.html) reads the pricing program's functions out of a
      // same-page iframe (quote-builder.html). Chromium treats each file:// page
      // as its own opaque origin, which would block that cross-frame access in
      // the packaged app. Relaxing webSecurity is safe here: the app only ever
      // loads its OWN bundled local files — there is no untrusted remote content.
      webSecurity: false,
    },
  });

  // The app's main screen is the split price + 3D view (build.html), NOT the
  // standalone customizer (index.html).
  const startUrl = isDev
    ? 'http://localhost:5174/build.html' // Vite dev server
    : `file://${path.join(__dirname, '../dist/build.html')}`; // Production build

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools(); // Dev tools in dev mode
  }
}

// ── Save-as-PDF for the renderer's print documents ──────────────────────────
// The in-app window.print() gives no preview/Save-as-PDF, so the quote/contract
// export hands us the finished HTML; we render it offscreen, printToPDF, prompt
// for a location, write it, and open it in the default viewer (= the preview).
let _pdfSeq = 0;
ipcMain.handle('ss:save-pdf', async (_evt, { html, suggestedName }) => {
  const tmpHtml = path.join(os.tmpdir(), 'ss-print-' + process.pid + '-' + (++_pdfSeq) + '.html');
  let pdfWin = null;
  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    pdfWin = new BrowserWindow({ show: false });
    await pdfWin.loadFile(tmpHtml);
    // Let fonts/images settle before snapshotting.
    await new Promise((r) => setTimeout(r, 400));
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true,         // keep the dark page backgrounds + colors
      preferCSSPageSize: true,       // honor the doc's @page { size: letter; margin: 0 }
      pageSize: 'Letter',
    });
    const parent = BrowserWindow.getFocusedWindow() || mainWindow;
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Save PDF',
      defaultPath: suggestedName || 'StormSafe.pdf',
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, pdf);
    shell.openPath(filePath); // open in the default PDF viewer for preview
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    if (pdfWin) { try { pdfWin.destroy(); } catch (_) {} }
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
