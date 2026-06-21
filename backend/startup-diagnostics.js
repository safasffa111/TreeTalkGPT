const fs = require('fs');
const path = require('path');

function installStartupDiagnostics({ app, dialog, dataRoot }) {
  const smokeTest = process.env.TREE_TALK_SMOKE_TEST === '1';
  const smokeMarker = String(process.env.TREE_TALK_SMOKE_MARKER || '').trim();
  const logPath = path.join(dataRoot, 'startup.log');

  const log = (name, details = '') => {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${name}${details ? `: ${String(details)}` : ''}\n`, 'utf8');
    } catch (_error) {}
  };

  const mark = (status, details = '') => {
    if (!smokeMarker) return;
    try {
      fs.mkdirSync(path.dirname(smokeMarker), { recursive: true });
      fs.writeFileSync(smokeMarker, JSON.stringify({ status, details, at: new Date().toISOString() }, null, 2), 'utf8');
    } catch (error) {
      log('smoke-marker-error', error?.stack || error);
    }
  };

  const fatal = (name, error) => {
    const details = error?.stack || error?.message || String(error || 'Unknown error');
    log(name, details);
    mark('failed', `${name}: ${details}`);
    if (!smokeTest) {
      try {
        dialog.showErrorBox('TreeTalk Desktop 启动失败', `${details}\n\n日志：${logPath}`);
      } catch (_error) {}
    }
  };

  log('bootstrap-start', `version=${app.getVersion()} platform=${process.platform} data=${dataRoot}`);

  process.on('uncaughtException', (error) => {
    fatal('uncaughtException', error);
    app.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    fatal('unhandledRejection', error);
    app.exit(1);
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    const message = JSON.stringify(details || {});
    log('render-process-gone', message);
    mark('failed', message);
  });

  app.on('browser-window-created', (_event, win) => {
    let loaded = false;
    log('browser-window-created');

    const reveal = () => {
      if (!win || win.isDestroyed()) return;
      try {
        if (!win.isVisible()) win.show();
        win.focus();
      } catch (error) {
        log('window-reveal-error', error?.stack || error);
      }
    };

    win.webContents.on('preload-error', (_event2, preloadPath, error) => {
      const message = `${preloadPath || ''} ${error?.stack || error || ''}`.trim();
      log('preload-error', message);
      mark('failed', message);
      reveal();
    });

    win.webContents.on('did-fail-load', (_event2, code, description, url, isMainFrame) => {
      if (isMainFrame === false) return;
      const message = `code=${code} description=${description} url=${url}`;
      log('did-fail-load', message);
      mark('failed', message);
      reveal();
      if (smokeTest) setTimeout(() => app.exit(1), 100);
    });

    win.webContents.on('did-finish-load', () => {
      loaded = true;
      log('did-finish-load', win.webContents.getURL());
      reveal();
      if (smokeTest) {
        mark('passed', win.webContents.getURL());
        setTimeout(() => app.quit(), 250);
      }
    });

    win.on('unresponsive', () => {
      log('window-unresponsive');
      mark('failed', 'window-unresponsive');
      reveal();
    });

    setTimeout(() => {
      if (!loaded) log('ready-to-show-timeout', 'forcing window visible');
      reveal();
    }, 5000);

    if (smokeTest) {
      setTimeout(() => {
        if (loaded) return;
        log('smoke-test-timeout');
        mark('failed', 'did-finish-load timeout');
        app.exit(1);
      }, 20000);
    }
  });

  return { log, fatal, logPath };
}

module.exports = { installStartupDiagnostics };
