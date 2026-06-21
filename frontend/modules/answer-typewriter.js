(function () {
  const getRichRenderInterval = (textLength = 0) => {
    const length = Math.max(0, Number(textLength) || 0);
    if (length > 12000) return 64;
    if (length > 6000) return 48;
    if (length > 2000) return 32;
    return 24;
  };

  const createAnswerTypewriter = ({
    contentStream,
    state,
    findNode,
    renderRichText,
    applyNodeAnnotationsToBody,
    syncSendState,
    schedulePromptRestore,
    scheduleFingerprintReflow,
    appStore,
  } = {}) => {
    const timers = new Map();
    const lastStoreTickAt = new Map();
    const lastRichRenderAt = new Map();
    const lastRichRenderLength = new Map();
    const answerBodyCache = new Map();

    const now = () => {
      const timestamp = performance.now?.();
      return Number.isFinite(timestamp) ? timestamp : Date.now();
    };

    const getSessionId = () => String(appStore?.select?.('learningData', null)?.sessionId || state?.sessionId || 'default-session');
    const makeTimerKey = (sessionId, nodeId) => `${String(sessionId || 'default-session')}::${String(nodeId || '')}`;
    const getNodeIdFromTimerKey = (key = '') => String(key).split('::').pop() || '';

    const shouldSyncTickToStore = (timerKey) => {
      const now = performance.now?.() || Date.now();
      const last = lastStoreTickAt.get(timerKey) || 0;
      if (now - last < 120) return false;
      lastStoreTickAt.set(timerKey, now);
      return true;
    };

    const stopTimerKey = (timerKey) => {
      const timer = timers.get(timerKey);
      if (timer) window.clearTimeout(timer);
      answerBodyCache.get(timerKey)?.classList?.remove?.('is-answer-typing');
      timers.delete(timerKey);
      lastStoreTickAt.delete(timerKey);
      lastRichRenderAt.delete(timerKey);
      lastRichRenderLength.delete(timerKey);
      answerBodyCache.delete(timerKey);
    };

    const stop = (nodeId) => {
      const safeNodeId = String(nodeId || '');
      Array.from(timers.keys()).forEach((timerKey) => {
        if (getNodeIdFromTimerKey(timerKey) === safeNodeId) stopTimerKey(timerKey);
      });
    };

    const stopAll = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      answerBodyCache.forEach((body) => body?.classList?.remove?.('is-answer-typing'));
      timers.clear();
      lastStoreTickAt.clear();
      lastRichRenderAt.clear();
      lastRichRenderLength.clear();
      answerBodyCache.clear();
    };

    const getAnswerBodyElement = (nodeId, timerKey = '') => {
      if (!contentStream) return null;
      const cached = timerKey ? answerBodyCache.get(timerKey) : null;
      const cacheIsMounted = cached
        && cached.dataset?.nodeId === nodeId
        && cached.dataset?.sourceKind === 'answer'
        && (cached.isConnected === undefined || cached.isConnected)
        && (!contentStream.contains || contentStream.contains(cached));
      if (cacheIsMounted) return cached;
      const body = Array.from(contentStream.querySelectorAll('.content-message-body[data-node-id]'))
        .find((candidate) => candidate.dataset.nodeId === nodeId && candidate.dataset.sourceKind === 'answer') || null;
      if (timerKey && body) answerBodyCache.set(timerKey, body);
      return body;
    };

    const renderTypingAnswer = (timerKey, node, text, { force = false } = {}) => {
      const timestamp = now();
      const interval = getRichRenderInterval(node?.answer?.length || text?.length || 0);
      if (!force && timestamp - (lastRichRenderAt.get(timerKey) || 0) < interval) return false;
      const body = getAnswerBodyElement(node?.id, timerKey);
      if (!body) return false;
      if (force && lastRichRenderLength.get(timerKey) === String(text || '').length) {
        body.classList?.remove?.('is-answer-typing');
        return false;
      }
      body.innerHTML = renderRichText?.(text) ?? text;
      body.classList?.toggle?.('is-answer-typing', !force);
      if ((node?.annotations || []).length) applyNodeAnnotationsToBody?.(body, node, 'answer');
      lastRichRenderAt.set(timerKey, timestamp);
      lastRichRenderLength.set(timerKey, String(text || '').length);
      return true;
    };

    const start = (nodeId) => {
      const node = findNode?.(nodeId);
      if (!node || !node.answer) return;
      const sessionId = getSessionId();
      const timerKey = makeTimerKey(sessionId, nodeId);
      stop(nodeId);

      node.isTyping = true;
      node.displayedAnswer = node.displayedAnswer || '';
      appStore?.patchLearningNode?.(nodeId, {
        isTyping: true,
        displayedAnswer: node.displayedAnswer,
      }, { source: 'answer-typewriter:start' });
      const fullText = node.answer;
      const startedAt = now();
      lastRichRenderAt.set(timerKey, -Infinity);

      const tick = () => {
        if (getSessionId() !== sessionId) {
          stopTimerKey(timerKey);
          return;
        }
        const currentNode = findNode?.(nodeId);
        if (!currentNode || !currentNode.isTyping) {
          stopTimerKey(timerKey);
          return;
        }

        const elapsed = now() - startedAt;
        const baseCount = Math.floor(elapsed / 9);
        const nextLength = Math.min(fullText.length, Math.max(currentNode.displayedAnswer.length + 1, baseCount));
        currentNode.displayedAnswer = fullText.slice(0, nextLength);
        if (appStore?.patchLearningNode && shouldSyncTickToStore(timerKey)) {
          appStore.patchLearningNode(nodeId, {
            isTyping: true,
            displayedAnswer: currentNode.displayedAnswer,
          }, { source: 'answer-typewriter:tick' });
        }

        if ((appStore?.getActiveQuestionId?.() ?? state?.activeQuestionId) === nodeId) {
          renderTypingAnswer(timerKey, currentNode, currentNode.displayedAnswer);
        }

        if (nextLength >= fullText.length) {
          currentNode.isTyping = false;
          currentNode.displayedAnswer = fullText;
          appStore?.patchLearningNode?.(nodeId, {
            isTyping: false,
            displayedAnswer: fullText,
          }, { source: 'answer-typewriter:completed' });
          if ((appStore?.getActiveQuestionId?.() ?? state?.activeQuestionId) === nodeId) {
            renderTypingAnswer(timerKey, currentNode, fullText, { force: true });
            scheduleFingerprintReflow?.([0, 80]);
          }
          stopTimerKey(timerKey);
          syncSendState?.();
          schedulePromptRestore?.([0, 120]);
          return;
        }

        const timer = window.setTimeout(tick, 16);
        timers.set(timerKey, timer);
      };

      tick();
    };

    return {
      start,
      stop,
      stopAll,
      getAnswerBodyElement,
    };
  };

  window.AnswerTypewriter = {
    createAnswerTypewriter,
    getRichRenderInterval,
  };
})();
