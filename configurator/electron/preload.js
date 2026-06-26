// Preload script — bridges the renderer (and its same-origin pricing iframe,
// reached via window.parent) to the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Hand a finished print document (full HTML string) to the main process, which
  // renders it to a real PDF, shows a Save dialog, writes the file, and opens it
  // for preview — the desktop stand-in for the browser's print preview / Save-as-PDF.
  // Resolves to { ok, filePath } | { ok:false, canceled } | { ok:false, error }.
  savePdf: (html, suggestedName) => ipcRenderer.invoke('ss:save-pdf', { html, suggestedName }),
});
