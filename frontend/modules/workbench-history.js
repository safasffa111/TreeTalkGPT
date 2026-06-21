// Workbench history list controller.
//
// The controller owns only the assist-panel mode switch: history list <-> current
// session tree/graph. It deliberately does not mutate content while the user is
// selecting text; content changes are routed through WorkbenchRenderer's queue.
(function () {
  const PANEL_HISTORY = 'history';
  const PANEL_SESSION = 'session';
  const ASSIST_LEAVE_MS = 170;
  const ASSIST_ENTER_MS = 220;

  const compactQuestionTitle = (question = '') => {
    const normalized = String(question || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '未命名问题';
    return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
  };

  const formatSessionTime = (value = '') => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const pad = (num) => String(num).padStart(2, '0');
    const datePart = sameYear
      ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const prefersReducedMotion = () => Boolean(
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const createWorkbenchHistoryController = ({
    shell,
    historyPanel,
    historyList,
    treePanel,
    graphPanel,
    backButtons = [],
    clearButtons = [],
    appStore,
    persistence,
    stateMachine,
    clearContentStream,
    renderActiveNodePage,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    renderAttachmentTray,
    syncRichContextUi,
    syncPromptPlaceholder,
    syncSendState,
    scheduleFingerprintReflow,
    resetGraphViewport,
    focusPrompt,
    startAnswerTypewriter,
    getAttachmentIdsToPreserve = () => [],
  } = {}) => {
    let sessions = [];
    let transitionQueue = Promise.resolve();
    let latestTransitionId = 0;
    let loadingSessionId = '';

    const getCurrentAssistPanel = () => {
      if (!shell) return null;
      if (shell.dataset.workbenchPanel === PANEL_HISTORY) return historyPanel;
      return shell.dataset.assist === 'wide' ? graphPanel : treePanel;
    };

    const setPanelMode = (mode) => {
      if (!shell) return;
      const normalized = mode === PANEL_SESSION ? PANEL_SESSION : PANEL_HISTORY;
      shell.dataset.workbenchPanel = normalized;
      appStore?.setWorkbenchPanel?.(normalized, { source: 'workbench-history:set-panel-mode' });
      syncWorkbenchBackButtons();
    };

    const syncWorkbenchBackButtons = () => {
      // The same .workbench-history-back buttons are temporarily reused by the
      // knowledge-warehouse controller as tree/graph toggles. When the user
      // returns to the workbench, that controller may have left the button text
      // empty, so the right-side "return" action in the logic-tree title looks
      // missing even though the button still exists. Normalize the workbench
      // presentation every time the workbench panel is synced/rendered.
      if (!backButtons?.length) return;
      if (shell?.dataset?.module && shell.dataset.module !== 'workbench') return;
      backButtons.forEach((button) => {
        if (!button) return;
        button.hidden = false;
        button.disabled = false;
        button.textContent = '←';
        button.title = '返回历史学习列表';
        button.setAttribute('aria-label', '返回历史学习列表');
        button.setAttribute('aria-hidden', 'false');
        button.setAttribute('aria-disabled', 'false');
        button.tabIndex = 0;
        button.classList.add('is-arrow');
        button.classList.remove('is-blank');
      });
    };

    let assistTransitionReleaseTimer = 0;

    const beginAssistTransition = () => {
      if (!shell) return;
      window.clearTimeout(assistTransitionReleaseTimer);
      shell.classList.add('is-assist-panel-transitioning');
    };

    const releaseAssistTransitionSoon = () => {
      if (!shell) return;
      window.clearTimeout(assistTransitionReleaseTimer);
      // Keep the suppression long enough for recentNodeEnterIds to expire. If the
      // class is removed immediately after the panel fade-in, tree/graph node
      // entry animations can start late and look like a post-enter flicker.
      assistTransitionReleaseTimer = window.setTimeout(() => {
        shell.querySelectorAll?.('.assist-workbench-tree .is-node-enter, .assist-workbench-graph .is-node-enter')
          ?.forEach?.((element) => element.classList.remove('is-node-enter'));
        shell.classList.remove('is-assist-panel-transitioning');
      }, 980);
    };

    const clearPanelTransitionClasses = (panel, options = {}) => {
      if (!panel) return;
      panel.classList.remove('is-history-leaving', 'is-history-entering');
      if (!options.keepSettled) panel.classList.remove('is-history-enter-settled');
    };

    const nextAnimationFrame = () => new Promise((resolve) => {
      window.requestAnimationFrame?.(() => window.requestAnimationFrame?.(resolve) || window.setTimeout(resolve, 16))
        || window.setTimeout(resolve, 32);
    });

    const markEnteringPanel = async (panel) => {
      if (!panel) return;
      clearPanelTransitionClasses(panel);
      if (prefersReducedMotion()) {
        panel.classList.add('is-history-enter-settled');
        return;
      }
      // Mount as stable-but-transparent first. This prevents the panel's base
      // visibility/transform transitions and inner node animations from racing
      // the explicit enter animation and flashing after it completes.
      panel.classList.add('is-history-preparing-enter');
      void panel.offsetHeight;
      panel.classList.add('is-history-entering');
      panel.classList.remove('is-history-preparing-enter');
      await wait(ASSIST_ENTER_MS);
      panel.classList.add('is-history-enter-settled');
      await nextAnimationFrame();
      panel.classList.remove('is-history-entering');
      clearPanelTransitionClasses(panel, { keepSettled: true });
    };

    const markLeavingPanel = async (panel) => {
      if (!panel) return;
      clearPanelTransitionClasses(panel);
      if (prefersReducedMotion()) return;
      panel.classList.remove('is-history-preparing-enter');
      panel.classList.add('is-history-leaving');
      void panel.offsetHeight;
      await wait(ASSIST_LEAVE_MS);
      panel.classList.remove('is-history-leaving');
    };

    const queueTransition = (operation) => {
      transitionQueue = transitionQueue
        .catch(() => {})
        .then(() => operation?.())
        .catch((error) => {
          console.error('[workbench-history] transition failed', error);
        });
      return transitionQueue;
    };

    const renderHistoryList = () => {
      syncWorkbenchBackButtons();
      if (!historyList) return;
      historyList.replaceChildren();

      if (!sessions.length) {
        const empty = document.createElement('div');
        empty.className = 'history-list-empty';
        empty.textContent = '提出主问题后，这里会保存历史学习。';
        historyList.appendChild(empty);
        return;
      }

      sessions.forEach((session) => {
        const inFlight = Boolean(persistence?.isSessionInFlight?.(session.sessionId));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-session-button tree-node-button';
        button.classList.toggle('is-stack-done', Boolean(session.solved || session.status === 'done'));
        button.classList.toggle('is-stack-active', !(session.solved || session.status === 'done'));
        button.classList.toggle('is-session-in-flight', inFlight);
        button.dataset.sessionId = session.sessionId || '';
        button.title = session.rootQuestion || session.title || '';
        button.setAttribute('aria-label', `${session.solved || session.status === 'done' ? '已解决' : '未解决'} ${session.rootQuestion || session.title || ''}`.trim());

        const title = document.createElement('span');
        title.className = 'tree-node-title history-session-title';
        title.textContent = compactQuestionTitle(session.rootQuestion || session.title || '未命名学习');
        button.appendChild(title);

        const meta = document.createElement('span');
        meta.className = 'history-session-meta';
        const timeText = formatSessionTime(session.updatedAt || session.createdAt);
        const countText = Number(session.nodeCount || 0) ? `${session.nodeCount} 问` : '';
        meta.textContent = [timeText, countText].filter(Boolean).join(' · ');
        button.appendChild(meta);

        if (inFlight) {
          const loader = document.createElement('span');
          loader.className = 'history-session-loader';
          loader.setAttribute('aria-label', '正在回答');
          loader.setAttribute('title', '正在回答');
          loader.setAttribute('role', 'status');
          button.appendChild(loader);
        }

        button.addEventListener('click', () => {
          if (!session.sessionId || loadingSessionId) return;
          openHistorySession(session.sessionId);
        });

        historyList.appendChild(button);
      });
    };

    const refreshHistoryList = async () => {
      syncWorkbenchBackButtons();
      const result = await persistence?.listSessions?.();
      if (result?.ok && Array.isArray(result.sessions)) {
        sessions = result.sessions;
      } else {
        sessions = [];
      }
      renderHistoryList();
      return sessions;
    };

    const resetCurrentWorkspaceForHistory = async (options = {}) => {
      if (!options.skipSave) await persistence?.saveNow?.();
      appStore?.resetLearningTree?.({}, { source: 'workbench-history:enter-history-reset' });
      appStore?.resetGraphViewport?.({ source: 'workbench-history:enter-history-graph-reset' });
      stateMachine?.refresh?.();
      persistence?.startNewSession?.({ clearCurrent: true });
      if (!options.skipContentClear) await (clearContentStream?.({ animate: true }) || Promise.resolve());
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
    };

    const enterHistoryList = (options = {}) => {
      const transitionId = ++latestTransitionId;
      return queueTransition(async () => {
        beginAssistTransition();
        const outgoing = getCurrentAssistPanel();

        if (options.clearWorkspace) {
          // Save the current session, then fade the visible content and assist
          // panel before clearing the in-memory workspace. This turns the old
          // delete flow into a non-destructive "return to history" flow.
          await persistence?.saveNow?.();
          const contentLeave = clearContentStream?.({ animate: true }) || Promise.resolve();
          await Promise.all([contentLeave, markLeavingPanel(outgoing)]);
          if (transitionId !== latestTransitionId) return;
          await resetCurrentWorkspaceForHistory({ skipSave: true, skipContentClear: true });
        } else {
          await markLeavingPanel(outgoing);
        }

        await refreshHistoryList();
        if (transitionId !== latestTransitionId) return;
        setPanelMode(PANEL_HISTORY);
        await markEnteringPanel(historyPanel);
        syncPromptPlaceholder?.();
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
        window.requestAnimationFrame?.(() => focusPrompt?.());
        releaseAssistTransitionSoon();
      });
    };

    const enterSessionView = (options = {}) => {
      const transitionId = ++latestTransitionId;
      return queueTransition(async () => {
        beginAssistTransition();
        const outgoing = shell?.dataset?.workbenchPanel === PANEL_HISTORY ? historyPanel : getCurrentAssistPanel();
        await markLeavingPanel(outgoing);
        if (transitionId !== latestTransitionId) return;
        setPanelMode(PANEL_SESSION);
        syncWorkbenchBackButtons();
        renderWorkbenchTree?.();
        renderWorkbenchGraph?.();
        renderActiveNodePage?.({ force: true, animateEnter: options.animateEnter !== false, scrollTop: options.scrollTop !== false, reason: options.reason || 'history-session-enter' });
        renderAttachmentTray?.();
        syncRichContextUi?.();
        syncPromptPlaceholder?.();
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
        await markEnteringPanel(getCurrentAssistPanel());
        window.setTimeout(() => renderWorkbenchGraph?.(), 120);
        window.requestAnimationFrame?.(() => focusPrompt?.());
        releaseAssistTransitionSoon();
      });
    };

    const openHistorySession = async (sessionId) => {
      loadingSessionId = sessionId;
      try {
        await persistence?.saveNow?.();
        const result = await persistence?.loadSessionById?.(sessionId, { render: false });
        if (!result?.ok) throw new Error(result?.error || '读取历史学习失败');
        const apiInFlightNodeIds = persistence?.getApiInFlightNodeIds?.(sessionId) || [];
        apiInFlightNodeIds.forEach((nodeId) => {
          appStore?.patchLearningNode?.(nodeId, {
            status: 'requesting',
            loadingText: '正在思考…',
            loadingMeta: '后台请求继续中',
          }, { source: 'workbench-history:restore-api-in-flight-node' });
        });
        const typingNodeIds = (appStore?.getLearningNodes?.() || [])
          .filter((node) => node?.isTyping && node?.answer)
          .map((node) => node.id);
        if (typingNodeIds.length) {
          persistence?.foregroundTypingForSession?.(sessionId, typingNodeIds);
        }
        stateMachine?.refresh?.();
        await enterSessionView({ animateEnter: true, scrollTop: true, reason: 'history-session-opened' });
        typingNodeIds.forEach((nodeId) => startAnswerTypewriter?.(nodeId));
      } catch (error) {
        console.error('[workbench-history] open session failed', error);
      } finally {
        loadingSessionId = '';
      }
    };

    const clearAllHistory = () => queueTransition(async () => {
      const transitionId = ++latestTransitionId;
      beginAssistTransition();
      const outgoing = getCurrentAssistPanel() || historyPanel;
      await markLeavingPanel(outgoing);
      if (transitionId !== latestTransitionId) return;

      // Reset in-memory workspace first, then clear timers/files. Store reset
      // schedules persistence, so clearAllSessions runs after it to cancel any
      // pending empty-session write and remove archived history/index files.
      const preserveAttachmentIds = await getAttachmentIdsToPreserve();
      appStore?.resetLearningTree?.({}, { source: 'workbench-history:clear-all-reset' });
      appStore?.resetGraphViewport?.({ source: 'workbench-history:clear-all-graph-reset' });
      stateMachine?.refresh?.();
      persistence?.startNewSession?.();
      const result = await persistence?.clearAllSessions?.({
        preserveAttachmentIds: Array.isArray(preserveAttachmentIds) ? preserveAttachmentIds : [],
      });
      if (result?.ok === false) console.warn?.('[workbench-history] clear all sessions failed', result.error);

      sessions = [];
      renderHistoryList();
      setPanelMode(PANEL_HISTORY);
      await (clearContentStream?.({ animate: true }) || Promise.resolve());
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
      await markEnteringPanel(historyPanel);
      window.requestAnimationFrame?.(() => focusPrompt?.());
      releaseAssistTransitionSoon();
    });

    const handleBackClick = (event) => {
      if (shell?.dataset?.module === 'knowledge') return;
      enterHistoryList({ clearWorkspace: true });
    };

    const handleClearClick = () => {
      clearAllHistory();
    };

    let unsubscribeInFlight = null;

    const initialize = async () => {
      setPanelMode(PANEL_HISTORY);
      syncWorkbenchBackButtons();
      backButtons.forEach((button) => button?.addEventListener?.('click', handleBackClick));
      clearButtons.forEach((button) => button?.addEventListener?.('click', handleClearClick));
      if (!unsubscribeInFlight) {
        unsubscribeInFlight = persistence?.subscribeInFlight?.(() => {
          refreshHistoryList();
        }) || null;
      }
      await refreshHistoryList();
      renderHistoryList();
      syncPromptPlaceholder?.();
      syncSendState?.();
    };

    return {
      initialize,
      refreshHistoryList,
      renderHistoryList,
      enterHistoryList,
      enterSessionView,
      openHistorySession,
      clearAllHistory,
      getMode: () => shell?.dataset?.workbenchPanel || PANEL_HISTORY,
      syncBackButtons: syncWorkbenchBackButtons,
    };
  };

  window.WorkbenchHistory = {
    createWorkbenchHistoryController,
  };
}());
