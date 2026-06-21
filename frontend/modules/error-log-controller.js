// Runtime error logger and error-log module controller.
(() => {
  const MAX_LOGS = 120;
  const listeners = new Set();
  const logs = [];
  let nextId = 1;
  let installed = false;

  const nowTime = () => new Date().toLocaleString('zh-CN', { hour12: false });

  const stringifyValue = (value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  };

  const normalizeReason = (reason) => {
    if (reason instanceof Error) {
      return {
        message: reason.message || reason.name || 'Unknown error',
        stack: reason.stack || '',
        name: reason.name || 'Error',
      };
    }
    return {
      message: stringifyValue(reason),
      stack: '',
      name: typeof reason,
    };
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener(getLogs());
      } catch (error) {
        // Avoid recursively logging UI listener failures forever.
        try { console.warn?.('Error log listener failed', error); } catch (_) {}
      }
    });
  };

  const addLog = (entry = {}) => {
    const reason = normalizeReason(entry.error || entry.reason || entry.message || 'Unknown error');
    const log = {
      id: `E${String(nextId++).padStart(4, '0')}`,
      time: entry.time || nowTime(),
      source: entry.source || 'runtime',
      message: entry.message || reason.message || 'Unknown error',
      stack: entry.stack || reason.stack || '',
      file: entry.file || '',
      line: entry.line || '',
      column: entry.column || '',
      detail: entry.detail || '',
    };

    logs.unshift(log);
    if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
    notify();
    return log;
  };

  const getLogs = () => logs.slice();

  const formatLog = (log) => {
    if (!log) return '';
    const location = [log.file, log.line, log.column].filter(Boolean).join(':');
    return [
      `编号：${log.id}`,
      `时间：${log.time}`,
      `来源：${log.source}`,
      location ? `位置：${location}` : '',
      '',
      '错误信息：',
      log.message || 'Unknown error',
      '',
      log.stack ? `调用栈：\n${log.stack}` : '',
      log.detail ? `补充信息：\n${log.detail}` : '',
    ].filter((line) => line !== '').join('\n');
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const installGlobalHandlers = () => {
    if (installed) return;
    installed = true;

    window.addEventListener('error', (event) => {
      addLog({
        source: 'window.error',
        message: event.message,
        error: event.error,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = normalizeReason(event.reason);
      addLog({
        source: 'unhandledrejection',
        message: reason.message,
        stack: reason.stack,
        reason: event.reason,
      });
    });

    const originalConsoleError = console.error?.bind(console);
    if (originalConsoleError && !console.__desktopShellErrorLoggerWrapped) {
      console.error = (...args) => {
        try {
          addLog({
            source: 'console.error',
            message: args.map(stringifyValue).join(' '),
            error: args.find((arg) => arg instanceof Error),
          });
        } catch (_) {}
        originalConsoleError(...args);
      };
      console.__desktopShellErrorLoggerWrapped = true;
    }
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  };

  const createErrorLogController = ({
    shell,
    errorlogsButton,
    errorLogList,
    errorLogsContent,
    appStore,
    callbacks = {},
  } = {}) => {
    let selectedId = '';
    let enterTimer = 0;
    let switchTimer = 0;
    let transitionToken = 0;
    const leaveDuration = 220;

    const requestModuleSync = () => callbacks.requestModuleSync?.();

    const syncCentralStore = (meta = {}) => {
      const allLogs = getLogs();
      appStore?.setErrors?.({
        count: allLogs.length,
        selectedId,
        latestId: allLogs[0]?.id || '',
        latestMessage: allLogs[0]?.message || '',
      }, { source: 'error-log-controller', ...meta });
      appStore?.setAnimation?.({
        errorlogsContentTransition: shell?.dataset.errorlogsContentTransition || '',
      }, { source: 'error-log-controller', ...meta });
    };

    const clearTimers = () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(switchTimer);
    };

    const clearGhosts = () => {
      errorLogsContent?.querySelectorAll('.errorlog-fade-ghost').forEach((ghost) => ghost.remove());
    };

    const getActiveDetail = () => errorLogsContent?.querySelector('.errorlog-detail:not(.errorlog-fade-ghost)') || null;

    const fadeOutCurrentDetail = () => {
      const panel = getActiveDetail();
      if (!panel || !errorLogsContent) return false;

      const contentRect = errorLogsContent.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (!panelRect.width || !panelRect.height) return false;

      clearGhosts();
      const ghost = panel.cloneNode(true);
      ghost.classList.remove('is-errorlog-entering');
      ghost.classList.add('errorlog-fade-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
        button.setAttribute('tabindex', '-1');
      });
      ghost.style.left = `${panelRect.left - contentRect.left + errorLogsContent.scrollLeft}px`;
      ghost.style.top = `${panelRect.top - contentRect.top + errorLogsContent.scrollTop}px`;
      ghost.style.width = `${panelRect.width}px`;
      ghost.style.minHeight = `${panelRect.height}px`;
      errorLogsContent.appendChild(ghost);
      window.setTimeout(() => ghost.remove(), leaveDuration + 90);
      return true;
    };

    const buildDetailPanel = (log) => {
      const article = document.createElement('article');
      article.className = 'errorlog-detail';
      article.dataset.errorLogId = log.id;

      const header = document.createElement('header');
      header.className = 'errorlog-detail-header';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'errorlog-title-wrap';

      const kicker = document.createElement('p');
      kicker.className = 'settings-kicker';
      kicker.textContent = 'Runtime Error';

      const title = document.createElement('h1');
      title.textContent = `${log.id} · ${log.source}`;

      const meta = document.createElement('p');
      meta.className = 'errorlog-detail-meta';
      meta.textContent = log.time;

      titleWrap.append(kicker, title, meta);

      const copyButton = document.createElement('button');
      copyButton.className = 'errorlog-copy-button';
      copyButton.type = 'button';
      copyButton.textContent = '复制';

      header.append(titleWrap, copyButton);

      const text = document.createElement('pre');
      text.className = 'errorlog-text';
      text.textContent = formatLog(log);

      copyButton.addEventListener('click', async () => {
        const originalText = copyButton.textContent;
        try {
          await copyText(text.textContent || '');
          copyButton.textContent = '已复制';
        } catch (error) {
          copyButton.textContent = '复制失败';
          addLog({ source: 'errorlog.copy', message: '复制错误日志失败', error });
        }
        window.setTimeout(() => {
          copyButton.textContent = originalText;
        }, 900);
      });

      article.append(header, text);
      return article;
    };

    const animateDetailEnter = (panel) => {
      if (!panel) return;
      window.clearTimeout(enterTimer);
      panel.classList.remove('is-errorlog-entering');
      void panel.offsetWidth;
      panel.classList.add('is-errorlog-entering');
      enterTimer = window.setTimeout(() => {
        panel.classList.remove('is-errorlog-entering');
      }, 340);
    };

    const setDetailContent = (log) => {
      if (!shell || !errorLogsContent) return;

      clearTimers();
      transitionToken += 1;
      const token = transitionToken;
      const hadOutgoing = fadeOutCurrentDetail();
      errorLogsContent.querySelectorAll('.errorlog-detail:not(.errorlog-fade-ghost)').forEach((panel) => panel.remove());

      shell.dataset.errorlogsContentTransition = hadOutgoing ? 'leaving' : (log ? 'entering' : 'idle');

      const apply = () => {
        if (token !== transitionToken) return;
        errorLogsContent.querySelectorAll('.errorlog-detail:not(.errorlog-fade-ghost)').forEach((panel) => panel.remove());

        if (!log) {
          shell.dataset.errorlogsContentTransition = hadOutgoing ? 'clearing' : 'idle';
          switchTimer = window.setTimeout(() => {
            if (token === transitionToken) delete shell.dataset.errorlogsContentTransition;
          }, hadOutgoing ? leaveDuration + 40 : 20);
          return;
        }

        shell.dataset.errorlogsContentTransition = 'entering';
        const panel = buildDetailPanel(log);
        errorLogsContent.appendChild(panel);
        animateDetailEnter(panel);
        switchTimer = window.setTimeout(() => {
          if (token === transitionToken) delete shell.dataset.errorlogsContentTransition;
        }, 340);
      };

      if (hadOutgoing) {
        switchTimer = window.setTimeout(apply, leaveDuration);
      } else {
        apply();
      }
    };

    const getSelectedLog = () => getLogs().find((log) => log.id === selectedId) || null;

    const selectLog = (id) => {
      selectedId = id || '';
      renderList();
      setDetailContent(getSelectedLog());
      syncCentralStore({ source: 'error-log-controller:select' });
      requestModuleSync();
    };

    const clearSelection = ({ fadeOut = true } = {}) => {
      selectedId = '';
      renderList();
      if (fadeOut) setDetailContent(null);
      else {
        clearTimers();
        transitionToken += 1;
        clearGhosts();
        errorLogsContent?.querySelectorAll('.errorlog-detail').forEach((panel) => panel.remove());
        if (shell) delete shell.dataset.errorlogsContentTransition;
      }
      syncCentralStore({ source: 'error-log-controller:clear' });
      requestModuleSync();
    };

    function renderList() {
      if (!errorLogList) return;
      const items = getLogs();
      errorLogList.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'error-log-empty';
        empty.textContent = '暂无错误日志';
        errorLogList.appendChild(empty);
        return;
      }

      items.forEach((log) => {
        const button = document.createElement('button');
        button.className = 'error-log-item';
        button.type = 'button';
        button.dataset.errorLogId = log.id;
        const active = log.id === selectedId;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));

        const title = document.createElement('span');
        title.className = 'error-log-item-title';
        title.textContent = (log.message || 'Unknown error').split('\n')[0].slice(0, 88);

        const meta = document.createElement('span');
        meta.className = 'error-log-item-meta';
        meta.textContent = `${log.time} · ${log.source}`;

        button.append(title, meta);
        button.addEventListener('click', () => selectLog(log.id));
        errorLogList.appendChild(button);
      });
    }

    const sync = () => {
      const open = shell?.dataset.module === 'errorlogs';
      if (errorlogsButton) {
        errorlogsButton.setAttribute('aria-pressed', String(open));
        errorlogsButton.setAttribute('aria-label', open ? '关闭错误日志' : '打开错误日志');
      }
      renderList();
      syncCentralStore({ source: 'error-log-controller:sync' });
    };

    const unsubscribe = subscribe(() => {
      renderList();
      syncCentralStore({ source: 'error-log-controller:logs-changed' });
      const current = getSelectedLog();
      if (!current && selectedId) clearSelection({ fadeOut: true });
    });

    renderList();

    return {
      sync,
      renderList,
      clearSelection,
      selectLog,
      destroy: unsubscribe,
    };
  };

  installGlobalHandlers();

  window.ErrorLogController = {
    log: addLog,
    getLogs,
    subscribe,
    formatLog,
    createErrorLogController,
  };
})();
