const { contextBridge } = require('electron');

// Expose a tiny, read-only surface to the React app.
contextBridge.exposeInMainWorld('appInfo', {
  name: 'UNMOGIP Library Management System',
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
