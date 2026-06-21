(function () {
  const createWorkbenchEffectsController = ({
    state,
    appStore,
    stateMachine,
    getActiveApiConfig,
    collectRichContextAttachments,
    normalizeAttachmentList,
    buildMessageContentForApi,
    requestChat,
    getPersistence,
    syncCentralLearning,
    renderActiveNodePage,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    syncSendState,
    schedulePromptRestore,
    startAnswerTypewriter,
    getLearningRequestContext,
    isLearningRequestContextCurrent,
    markLearningRequestInFlight,
    finishLearningRequestInFlight,
    completeBackgroundLearningRequest,
    failBackgroundLearningRequest,
  } = {}) => {
    const Event = window.LearningStackStateMachine?.Event || {};

    const transition = (event, payload = {}) => {
      if (!event) return;
      stateMachine?.transition?.(event, payload);
    };

    const renderWorkbenchAfterMutation = (source = 'workbench-effects') => {
      syncCentralLearning?.(source);
      renderActiveNodePage?.({ animate: false, reason: source });
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
    };

    const patchNodeThroughStore = (node, patch, meta = {}) => {
      if (!node) return null;
      return appStore?.patchLearningNode?.(node.id, patch, meta) || Object.assign(node, patch);
    };

    const addMessageThroughStore = (message, meta = {}) => {
      if (appStore?.addLearningMessage) return appStore.addLearningMessage(message, meta);
      if (state?.messages) state.messages.push(message);
      return message;
    };

    const setRequestingThroughStore = (requesting, meta = {}) => {
      if (appStore?.setLearningRequesting) return appStore.setLearningRequesting(requesting, meta);
      if (state) state.isRequesting = Boolean(requesting);
      return Boolean(requesting);
    };

    const providerLabel = (config) => config?.providerName || '当前 API';

    const getSessionPersistence = () => {
      if (typeof getPersistence === 'function') return getPersistence();
      return window.__LEARNING_SESSION_PERSISTENCE__ || null;
    };

    const getCurrentSessionId = () => {
      const persistence = getSessionPersistence();
      return persistence?.ensureSessionId?.() || persistence?.getSessionId?.() || '';
    };

    const getDefaultRequestContext = (node = {}) => ({
      mode: 'workbench',
      sessionId: getCurrentSessionId(),
      nodeId: node?.id || '',
      startedAt: new Date().toISOString(),
    });

    const buildRequestContext = (node = {}) => {
      const custom = typeof getLearningRequestContext === 'function' ? getLearningRequestContext(node) : null;
      if (custom?.mode === 'knowledge') {
        // Knowledge follow-ups have their own file/session id and must not lazily
        // create or touch the workbench persistence session.
        return {
          ...custom,
          nodeId: custom.nodeId || node?.id || '',
          startedAt: custom.startedAt || new Date().toISOString(),
        };
      }
      return {
        ...getDefaultRequestContext(node),
        ...(custom && typeof custom === 'object' ? custom : {}),
        nodeId: custom?.nodeId || node?.id || '',
        startedAt: custom?.startedAt || new Date().toISOString(),
      };
    };

    const isCurrentRequestSession = (requestContext = {}) => {
      if (requestContext.mode === 'knowledge') {
        if (typeof isLearningRequestContextCurrent === 'function') {
          return Boolean(isLearningRequestContextCurrent(requestContext));
        }
        const data = appStore?.select?.('learningData', null) || {};
        return Boolean(
          requestContext.sessionId
          && data.sessionId === requestContext.sessionId
          && (appStore?.getLearningNode?.(requestContext.nodeId) || state?.nodes?.some?.((node) => node.id === requestContext.nodeId))
        );
      }
      const persistence = getSessionPersistence();
      const currentSessionId = persistence?.getSessionId?.() || '';
      if (!requestContext.sessionId || !currentSessionId || requestContext.sessionId !== currentSessionId) return false;
      return Boolean(appStore?.getLearningNode?.(requestContext.nodeId) || state?.nodes?.some?.((node) => node.id === requestContext.nodeId));
    };

    const markRuntimeRequestInFlight = async (requestContext = {}) => {
      if (requestContext.mode === 'knowledge') {
        if (typeof markLearningRequestInFlight === 'function') markLearningRequestInFlight(requestContext);
        return;
      }
      const persistence = getSessionPersistence();
      persistence?.markRequestInFlight?.(requestContext.sessionId, requestContext.nodeId);
      // Persist the session index quickly so the history list can show this main
      // question immediately. The runtime spinner itself comes from the in-flight
      // registry, not from the archived JSON, so reloads never get stuck spinning.
      await persistence?.saveNow?.();
    };

    const finishRuntimeRequestInFlight = (requestContext = {}) => {
      if (requestContext.mode === 'knowledge') {
        if (typeof finishLearningRequestInFlight === 'function') finishLearningRequestInFlight(requestContext);
        return;
      }
      const persistence = getSessionPersistence();
      persistence?.markRequestComplete?.(requestContext.sessionId, requestContext.nodeId);
    };

    const applyApiMissingToNode = (node, config = {}) => {
      if (!node) return;
      const providerName = providerLabel(config);

      if (appStore?.markLearningNodeWaitingApi) {
        appStore.markLearningNodeWaitingApi(node.id, providerName, { source: 'workbench-effects:api-missing' });
      } else {
        patchNodeThroughStore(node, {
          status: 'waiting-api',
          systemMessage: `当前选择的是 ${providerName}，但还没有填写 API Key。\n\n请点击左侧底部设置按钮 → API 设置，填写 ${providerName} 的 API Key、Base URL 和 Model 后，再回到工作台发送问题。`,
        }, { source: 'workbench-effects:api-missing' });
      }

      transition(Event.REQUEST_WAITING_API, { nodeId: node.id });
      renderWorkbenchAfterMutation('workbench-effects:api-missing');
      schedulePromptRestore?.([0, 120, 320]);
    };

    const startNodeRequest = (node, config) => {
      const providerName = providerLabel(config);
      if (appStore?.startLearningNodeRequest) {
        appStore.startLearningNodeRequest(node.id, providerName, { source: 'workbench-effects:request-started' });
      } else {
        setRequestingThroughStore(true, { source: 'workbench-effects:request-started' });
        patchNodeThroughStore(node, {
          status: 'requesting',
          loadingText: '正在思考…',
          loadingMeta: `${providerName} · 思考中`,
        }, { source: 'workbench-effects:request-started' });
      }

      transition(Event.REQUEST_STARTED, { nodeId: node.id });
      renderWorkbenchAfterMutation('workbench-effects:request-started');
      syncSendState?.();
    };

    const completeNodeRequest = async (node, answer, config, requestContext = {}) => {
      const providerName = providerLabel(config);
      const normalizedAnswer = String(answer || '').trim() || 'AI 没有返回有效内容。';
      const currentSession = isCurrentRequestSession(requestContext);

      if (!currentSession) {
        if (requestContext.mode === 'knowledge') {
          await completeBackgroundLearningRequest?.({
            ...requestContext,
            nodeId: requestContext.nodeId || node?.id,
            answer: normalizedAnswer,
            providerName,
          });
        } else {
          await getSessionPersistence()?.completeBackgroundRequest?.({
            sessionId: requestContext.sessionId,
            nodeId: requestContext.nodeId || node?.id,
            answer: normalizedAnswer,
            providerName,
          });
        }
        return;
      }

      finishRuntimeRequestInFlight(requestContext);
      if (appStore?.completeLearningNodeRequest) {
        appStore.completeLearningNodeRequest(node.id, normalizedAnswer, providerName, { source: 'workbench-effects:request-succeeded' });
      } else {
        patchNodeThroughStore(node, {
          status: 'answered',
          answer: normalizedAnswer,
          displayedAnswer: '',
          isTyping: true,
          answerMeta: `${providerName} · 回复`,
        }, { source: 'workbench-effects:request-succeeded' });
        addMessageThroughStore({ role: 'assistant', questionId: node.id, content: normalizedAnswer }, { source: 'workbench-effects:assistant-message' });
      }

      transition(Event.REQUEST_SUCCEEDED, { nodeId: node.id });
      renderWorkbenchAfterMutation('workbench-effects:request-succeeded');
      startAnswerTypewriter?.(node.id);
    };

    const failNodeRequest = async (node, error, requestContext = {}) => {
      const errorMessage = `API 请求失败：${error?.message || error || '未知错误'}

请检查 API Key、Base URL、Model 是否正确，或者网络是否可访问该接口。`;
      const currentSession = isCurrentRequestSession(requestContext);

      if (!currentSession) {
        if (requestContext.mode === 'knowledge') {
          await failBackgroundLearningRequest?.({
            ...requestContext,
            nodeId: requestContext.nodeId || node?.id,
            errorMessage,
          });
        } else {
          await getSessionPersistence()?.failBackgroundRequest?.({
            sessionId: requestContext.sessionId,
            nodeId: requestContext.nodeId || node?.id,
            errorMessage,
          });
        }
        return;
      }

      finishRuntimeRequestInFlight(requestContext);
      if (appStore?.failLearningNodeRequest) {
        appStore.failLearningNodeRequest(node.id, errorMessage, { source: 'workbench-effects:request-failed' });
      } else {
        patchNodeThroughStore(node, {
          status: 'error',
          errorMessage,
        }, { source: 'workbench-effects:request-failed' });
      }

      transition(Event.REQUEST_FAILED, { nodeId: node.id });
      renderWorkbenchAfterMutation('workbench-effects:request-failed');
    };

    const settleNodeRequest = (node, requestContext = {}) => {
      // Background requests must not mutate whichever session is currently open.
      // Otherwise request A can finish while the user is studying session B and
      // incorrectly clear B's requesting state or trigger stale renders.
      if (!isCurrentRequestSession(requestContext)) {
        schedulePromptRestore?.([0, 120, 320]);
        return;
      }

      if (appStore?.settleLearningNodeRequest) {
        appStore.settleLearningNodeRequest({ source: 'workbench-effects:request-settled' });
      } else {
        setRequestingThroughStore(false, { source: 'workbench-effects:request-settled' });
      }

      transition(Event.REQUEST_SETTLED, { nodeId: node?.id });
      syncCentralLearning?.('workbench-effects:request-settled');
      syncSendState?.();
      schedulePromptRestore?.([0, 120, 320]);
    };

    const buildRequestPayload = (node, promptBuilder, config = null) => {
      const prompt = promptBuilder?.(node) || '';
      const apiAttachments = normalizeAttachmentList?.([
        ...(node?.attachments || []),
        ...(collectRichContextAttachments?.(node) || []),
      ]) || [];
      return buildMessageContentForApi?.(prompt, apiAttachments, { config }) || prompt;
    };

    const requestAnswerForNode = async (node, promptBuilder) => {
      if (!node) return;
      const config = getActiveApiConfig?.();
      const requestContext = buildRequestContext(node);

      if (!config?.apiKey || !config?.baseUrl || !config?.model) {
        applyApiMissingToNode(node, config || { providerName: '当前 API' });
        return;
      }

      startNodeRequest(node, config);
      await markRuntimeRequestInFlight(requestContext);

      try {
        const userContent = buildRequestPayload(node, promptBuilder, config);
        const result = await requestChat?.({
          config,
          content: userContent,
          temperature: 0.35,
        });

        if (!result?.ok) {
          throw new Error(result?.error || 'API 请求失败');
        }

        const answer = result.content?.trim() || 'AI 没有返回有效内容。';
        await completeNodeRequest(node, answer, config, requestContext);
      } catch (error) {
        await failNodeRequest(node, error, requestContext);
      } finally {
        settleNodeRequest(node, requestContext);
      }
    };

    return {
      applyApiMissingToNode,
      requestAnswerForNode,
      startNodeRequest,
      completeNodeRequest,
      failNodeRequest,
      settleNodeRequest,
      buildRequestPayload,
    };
  };

  window.WorkbenchEffects = {
    createWorkbenchEffectsController,
  };
}());
