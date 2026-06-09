const { app, BrowserWindow } = require('electron');
const path = require('path');

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
