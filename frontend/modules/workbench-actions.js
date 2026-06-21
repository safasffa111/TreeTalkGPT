(function () {
  const createWorkbenchActionsController = ({
    state,
    shell,
    promptForm,
    promptInput,
    promptPop,
    findNode,
    getStackTopId,
    normalizeQuestionStack,
    getActiveApiConfig,
    mainTreeResetController,
    stateMachine,
    hasPromptPayload,
    getPromptQuestionText,
    consumeSelectedAttachments,
    restorePromptToInitialState,
    clearActiveSelectionState,
    collectRichContextAttachments,
    buildMainQuestionPrompt,
    buildFollowUpPrompt,
    normalizeAttachmentList,
    buildMessageContentForApi,
    requestChat,
    getPersistence,
    renderActiveNodePage,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    syncPromptPlaceholder,
    syncSendState,
    schedulePromptRestore,
    startAnswerTypewriter,
    recentNodeEnterIds,
    appStore,
    onBeforeMainQuestionCreate,
    onAfterMainQuestionCreate,
    onRequestHistoryReturn,
    onRequestKnowledgeExit,
    getLearningRequestContext,
    isLearningRequestContextCurrent,
    markLearningRequestInFlight,
    finishLearningRequestInFlight,
    completeBackgroundLearningRequest,
    failBackgroundLearningRequest,
  } = {}) => {
    const isMainTreeResetting = () => mainTreeResetController?.isResetting?.() ?? false;
    const canResetMainQuestionTree = () => stateMachine?.canResetMainQuestionTree?.() ?? mainTreeResetController?.canResetMainQuestionTree?.() ?? false;
    const resetMainQuestionTree = () => mainTreeResetController?.resetMainQuestionTree?.();
    const returnToHistoryList = () => {
      if (shell?.dataset?.module === 'knowledge') {
        const knowledgeResult = onRequestKnowledgeExit?.();
        if (knowledgeResult) return true;
      }
      const result = onRequestHistoryReturn?.();
      if (!result && mainTreeResetController?.resetMainQuestionTree) {
        // Fallback for older embeddings that have not wired the history controller yet.
        mainTreeResetController.resetMainQuestionTree();
      }
      return true;
    };

    const getStoreLearningData = () => appStore?.select?.('learningData', null) || null;
    const getActiveQuestionId = () => appStore?.getActiveQuestionId?.() ?? appStore?.select?.('activeQuestionId', null) ?? state?.activeQuestionId ?? null;
    const getCurrentStackTopId = () => appStore?.getStackTopQuestionId?.() ?? appStore?.select?.('stackTopId', null) ?? getStackTopId?.() ?? null;
    const getActiveNode = () => appStore?.getActiveLearningNode?.() || findNode?.(getActiveQuestionId());
    const getMainRootNodeFromStore = () => appStore?.getRootLearningNodes?.()?.[0] || window.StackStateUtils?.getMainRootNode?.(state) || null;
    const getActiveSelection = () => appStore?.getLearningSelection?.() ?? getStoreLearningData()?.activeSelection ?? state?.activeSelection ?? null;
    const hasMainQuestion = () => appStore?.hasMainQuestion?.() ?? Boolean(getStoreLearningData()?.hasMainQuestion ?? state?.hasMainQuestion);
    const isRequesting = () => false;

    const isActiveNodeStackTop = () => {
      if (stateMachine?.canPopActiveNode) return stateMachine.canPopActiveNode();
      const activeId = getActiveQuestionId();
      const topId = getCurrentStackTopId();
      return Boolean(activeId && activeId === topId);
    };

    const syncCentralLearning = (source = 'workbench-actions') => {
      appStore?.syncLearningFromMachine?.(stateMachine, {
        getStackTopId: getCurrentStackTopId,
        getMainRootNode: getMainRootNodeFromStore,
      });
      appStore?.setUi?.({
        canResetMain: canResetMainQuestionTree(),
        canPopActive: isActiveNodeStackTop(),
      }, { source });
    };

    const createNodeLegacyFallback = (question, parentId = null, options = {}) => {
      const id = `Q${state.nextQuestionIndex}`;
      state.nextQuestionIndex += 1;

      const node = {
        id,
        parentId,
        question,
        status: 'pending',
        stackStatus: 'active',
        answer: '',
        answerMeta: '',
        systemMessage: '',
        errorMessage: '',
        loadingText: '',
        loadingMeta: '',
        parentTextContext: options.parentTextContext || '',
        selectedTextContext: options.selectedTextContext || '',
        selectedPositionContext: options.selectedPositionContext || '',
        selectionSourceKind: options.selectionSourceKind || '',
        selectionRange: options.selectionRange || null,
        selectionRenderRange: options.selectionRenderRange || null,
        selectionLocator: options.selectionLocator || null,
        attachments: options.attachments || [],
        annotations: [],
        children: [],
      };

      state.nodes.push(node);
      if (parentId) {
        const parent = findNode?.(parentId);
        parent?.children?.push(id);

        const selectionStart = Number(options.selectionRange?.start);
        const selectionEnd = Number(options.selectionRange?.end);
        const hasStableSelectionRange = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd) && selectionStart >= 0 && selectionEnd > selectionStart;
        if (parent && hasStableSelectionRange && options.selectionSourceKind) {
          parent.annotations = parent.annotations || [];
          const renderStart = Number(options.selectionRenderRange?.start);
          const renderEnd = Number(options.selectionRenderRange?.end);
          parent.annotations.push({
            childId: id,
            sourceKind: options.selectionSourceKind,
            start: selectionStart,
            end: selectionEnd,
            renderStart: Number.isFinite(renderStart) ? renderStart : -1,
            renderEnd: Number.isFinite(renderEnd) ? renderEnd : -1,
            selectedText: options.selectedTextContext || '',
          });
        }
      }

      state.activeQuestionId = id;
      state.questionStack.push(id);
      state.hasMainQuestion = true;
      state.messages.push({ role: 'user', questionId: id, content: question });
      return node;
    };

    const createNode = (question, parentId = null, options = {}) => {
      const node = appStore?.createLearningNode?.(
        { question, parentId, options },
        { source: 'workbench-actions:create-node' }
      ) || createNodeLegacyFallback(question, parentId, options);

      recentNodeEnterIds?.add?.(node.id);
      window.setTimeout(() => recentNodeEnterIds?.delete?.(node.id), 900);
      stateMachine?.transition?.(
        parentId
          ? window.LearningStackStateMachine.Event.FOLLOW_UP_CREATED
          : window.LearningStackStateMachine.Event.MAIN_CREATED,
        { nodeId: node.id }
      );
      syncCentralLearning('workbench-actions:create-node');
      syncPromptPlaceholder?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      syncSendState?.();
      return node;
    };

    const workbenchEffects = window.WorkbenchEffects?.createWorkbenchEffectsController?.({
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
    });

    const applyApiMissingToNode = (node, config) => {
      return workbenchEffects?.applyApiMissingToNode?.(node, config);
    };

    const requestAnswerForNode = async (node, promptBuilder) => {
      return workbenchEffects?.requestAnswerForNode?.(node, promptBuilder);
    };

    const createMainQuestion = async (question, attachments = []) => {
      onBeforeMainQuestionCreate?.();
      getPersistence?.()?.ensureSessionId?.();
      const node = createNode(question, null, { attachments });
      const panelSwitch = onAfterMainQuestionCreate?.(node);
      if (panelSwitch && typeof panelSwitch.then === 'function') {
        await panelSwitch;
      } else if (!panelSwitch) {
        renderActiveNodePage?.({ force: true, animateEnter: true, reason: 'main-question-created' });
      }
      await requestAnswerForNode(node, (currentNode) => buildMainQuestionPrompt?.(currentNode.question));
    };

    const normalizeComparableText = (value = '') => String(value || '')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n');


    const createFoldedTextIndex = (value = '') => {
      const raw = String(value || '');
      let text = '';
      const map = [];
      let lastWasSpace = false;
      for (let index = 0; index < raw.length; index += 1) {
        let ch = raw[index];
        if (ch === '\r') {
          if (raw[index + 1] === '\n') continue;
          ch = '\n';
        }
        if (/\u200b|\u200c|\u200d|\ufeff/.test(ch)) continue;
        if (ch === '\u00a0') ch = ' ';
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue;
          text += ' ';
          map.push(index);
          lastWasSpace = true;
          continue;
        }
        text += ch.toLowerCase();
        map.push(index);
        lastWasSpace = false;
      }
      return { text: text.trim(), map, raw };
    };

    const commonSuffixScore = (left = '', right = '') => {
      const a = createFoldedTextIndex(left).text;
      const b = createFoldedTextIndex(right).text;
      let count = 0;
      while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1;
      return count;
    };

    const commonPrefixScore = (left = '', right = '') => {
      const a = createFoldedTextIndex(left).text;
      const b = createFoldedTextIndex(right).text;
      let count = 0;
      while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
      return count;
    };

    const locateSelectionRangeInCanonicalText = ({ parentText = '', selectedText = '', preferredRange = null, locator = null } = {}) => {
      const parent = String(parentText || '');
      const selected = String(selectedText || '');
      const start = Number(preferredRange?.start);
      const end = Number(preferredRange?.end);
      const directMatchesPreferred = (() => {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > parent.length) return false;
        const direct = parent.slice(start, end);
        return direct === selected || normalizeComparableText(direct).trim() === normalizeComparableText(selected).trim();
      })();
      if (directMatchesPreferred && !locator?.before && !locator?.after) {
        return { start, end, inferred: Boolean(preferredRange?.inferred), confidence: 'direct-range' };
      }

      const needles = Array.from(new Set([
        selected,
        locator?.selectedFromRender,
        normalizeComparableText(selected).trim(),
        normalizeComparableText(locator?.selectedFromRender || '').trim(),
      ].map((item) => String(item || '')).filter(Boolean)));
      const candidates = [];
      const pushCandidate = (candidateStart, candidateEnd, needle, method) => {
        if (!Number.isFinite(candidateStart) || candidateStart < 0 || candidateEnd <= candidateStart || candidateEnd > parent.length) return;
        const before = parent.slice(Math.max(0, candidateStart - 180), candidateStart);
        const after = parent.slice(candidateEnd, Math.min(parent.length, candidateEnd + 180));
        const prefix = commonSuffixScore(before, locator?.before || '');
        const suffix = commonPrefixScore(after, locator?.after || '');
        const preferred = Number.isFinite(start) && start >= 0 ? Math.max(0, 80 - Math.min(80, Math.abs(candidateStart - start))) : 0;
        const score = prefix * 3 + suffix * 3 + preferred + Math.min(String(needle || '').length, 120);
        candidates.push({ start: candidateStart, end: candidateEnd, inferred: method !== 'direct' && method !== 'direct-range', confidence: method, score, prefix, suffix });
      };

      if (directMatchesPreferred) pushCandidate(start, end, selected, 'direct-range');

      needles.forEach((needle) => {
        const exactNeedle = String(needle || '');
        if (!exactNeedle) return;
        let pos = parent.indexOf(exactNeedle);
        while (pos >= 0) {
          pushCandidate(pos, pos + exactNeedle.length, exactNeedle, 'exact-text');
          pos = parent.indexOf(exactNeedle, pos + Math.max(1, exactNeedle.length));
        }
      });

      const foldedParent = createFoldedTextIndex(parent);
      needles.forEach((needle) => {
        const foldedNeedle = createFoldedTextIndex(needle);
        if (!foldedNeedle.text) return;
        let foldedPos = foldedParent.text.indexOf(foldedNeedle.text);
        while (foldedPos >= 0) {
          const mappedStart = foldedParent.map[foldedPos] ?? -1;
          const mappedEndBase = foldedParent.map[foldedPos + foldedNeedle.text.length - 1] ?? -1;
          if (mappedStart >= 0 && mappedEndBase >= 0) pushCandidate(mappedStart, mappedEndBase + 1, needle, 'normalized-context');
          foldedPos = foldedParent.text.indexOf(foldedNeedle.text, foldedPos + Math.max(1, foldedNeedle.text.length));
        }
      });

      if (candidates.length) {
        candidates.sort((a, b) => (b.score - a.score) || (b.prefix + b.suffix - a.prefix - a.suffix) || (a.start - b.start));
        const best = candidates[0];
        return { start: best.start, end: best.end, inferred: best.confidence !== 'direct-range', confidence: best.confidence, contextScore: best.score };
      }

      return { start: -1, end: -1, inferred: true, confidence: 'unresolved' };
    };

    const getLineColumnForOffset = (text = '', offset = 0) => {
      const safe = Math.max(0, Math.min(String(text || '').length, Number(offset) || 0));
      const before = String(text || '').slice(0, safe);
      const lines = before.split('\n');
      return { line: lines.length, column: (lines[lines.length - 1] || '').length + 1 };
    };

    const buildQuestionParentText = (node, fallback = '') => {
      const question = String(node?.question || '').trim();
      const selected = String(node?.selectedTextContext || '').trim();
      const parts = [question || String(fallback || '').trim()];
      if (node?.parentId && selected) parts.push(`框选原文：\n${selected}`);
      return parts.filter(Boolean).join('\n\n');
    };

    const findBestSelectionRange = (parentText = '', selectedText = '', preferredRange = null, locator = null) => locateSelectionRangeInCanonicalText({
      parentText,
      selectedText,
      preferredRange,
      locator,
    });

    const createSelectionPositionContext = ({ parentText = '', selectedText = '', range = null, sourceKind = '', locator = null } = {}) => {
      const parent = String(parentText || '');
      const selected = String(selectedText || '');
      const start = Number(range?.start);
      const end = Number(range?.end);
      if (!parent || !selected || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        return '未能稳定定位框选文本在父文本中的精确位置；请优先根据“被框选内容”和“父文本”作答。';
      }
      const before = parent.slice(Math.max(0, start - 100), start).trim();
      const after = parent.slice(end, Math.min(parent.length, end + 100)).trim();
      const percent = parent.length ? Math.round((start / parent.length) * 1000) / 10 : 0;
      const kindLabel = sourceKind === 'question' ? '问题文本' : sourceKind === 'answer' ? 'AI 回复文本' : '父文本';
      const beginLine = getLineColumnForOffset(parent, start);
      const endLine = getLineColumnForOffset(parent, end);
      const inferred = range?.inferred ? '（由框选文本和前后文定位）' : '';
      const confidence = range?.confidence ? `定位方式：${range.confidence}${inferred}` : (inferred ? `定位方式：上下文匹配${inferred}` : '定位方式：DOM 精确选区');
      const renderRangeText = Number.isFinite(locator?.renderStart) && Number.isFinite(locator?.renderEnd) && locator.renderStart >= 0
        ? `渲染坐标：可见文本 [${locator.renderStart}, ${locator.renderEnd})`
        : '';
      return [
        `来源：${kindLabel}`,
        `父文本字符区间：左闭右开 [${start}, ${end})，共 ${parent.length} 个字符`,
        `自然序号：第 ${start + 1} 个字符到第 ${end} 个字符`,
        `行列位置：第 ${beginLine.line} 行第 ${beginLine.column} 列 → 第 ${endLine.line} 行第 ${endLine.column} 列`,
        `大致位置：父文本 ${percent}% 处`,
        confidence,
        renderRangeText,
        before ? `框选前文：${before}` : '',
        `框选文本：${selected}`,
        after ? `框选后文：${after}` : '',
      ].filter(Boolean).join('\n');
    };

    const getCanonicalParentTextForSelection = (selection = {}) => {
      const sourceKind = selection.sourceKind || 'answer';
      const parentNode = findNode?.(selection.parentId) || appStore?.getLearningNode?.(selection.parentId) || null;
      const fallback = selection.parentText || selection.visibleParentText || '';
      if (sourceKind === 'answer') return String(parentNode?.answer || parentNode?.displayedAnswer || fallback || '');
      if (sourceKind === 'question') return buildQuestionParentText(parentNode, fallback);
      if (sourceKind === 'system') return String(parentNode?.systemMessage || parentNode?.errorMessage || fallback || '');
      return String(fallback || '');
    };

    const getDefaultParentContextForActiveNode = () => {
      const activeNode = getActiveNode();
      if (!activeNode) {
        return {
          parentTextContext: '',
          selectedTextContext: '',
          selectedPositionContext: '',
          selectionSourceKind: '',
          selectionRange: null,
        };
      }

      const answerText = (activeNode.answer || '').trim();
      const questionText = (activeNode.question || '').trim();
      const parentTextContext = answerText || questionText;

      return {
        parentTextContext,
        selectedTextContext: '',
        selectedPositionContext: '',
        selectionSourceKind: '',
        selectionRange: null,
      };
    };

    const consumeFollowUpContext = () => {
      const selection = getActiveSelection();
      const activeId = getActiveQuestionId();
      if (selection && selection.parentId === activeId && String(selection.selectedText || '').trim()) {
        const sourceKind = selection.sourceKind || 'answer';
        const selectedText = selection.selectedText || '';
        const parentText = getCanonicalParentTextForSelection(selection);
        const selectionLocator = selection.selectionLocator || null;
        const resolvedRange = findBestSelectionRange(parentText, selectedText, {
          start: Number(selection.start),
          end: Number(selection.end),
          inferred: Boolean(selection.inferred),
        }, selectionLocator);
        const hasStableRange = Number.isFinite(resolvedRange.start)
          && Number.isFinite(resolvedRange.end)
          && resolvedRange.start >= 0
          && resolvedRange.end > resolvedRange.start;
        const selectedPositionContext = createSelectionPositionContext({
          parentText,
          selectedText,
          range: resolvedRange,
          sourceKind,
          locator: selectionLocator,
        });
        return {
          parentTextContext: parentText,
          selectedTextContext: selectedText,
          selectedPositionContext,
          selectionSourceKind: sourceKind,
          selectionRange: hasStableRange ? resolvedRange : null,
          selectionRenderRange: selection.selectionRenderRange || null,
          selectionLocator,
        };
      }

      return getDefaultParentContextForActiveNode();
    };

    const createFollowUpQuestion = async (question, attachments = []) => {
      const parentId = getActiveQuestionId();
      const context = { ...consumeFollowUpContext(), attachments };
      const node = createNode(question, parentId, context);
      clearActiveSelectionState?.();
      window.getSelection?.()?.removeAllRanges?.();
      renderActiveNodePage?.();
      await requestAnswerForNode(node, buildFollowUpPrompt);
    };

    const popActiveQuestion = () => {
      if (isRequesting() || stateMachine?.isBlocking?.()) return;
      const topId = getCurrentStackTopId();
      const activeId = getActiveQuestionId();
      if (!topId || topId !== activeId || (stateMachine && !stateMachine.canPopActiveNode())) {
        syncSendState?.();
        return;
      }

      const popResult = appStore?.popActiveLearningNode?.(
        { keepCompletedVisible: true },
        { source: 'workbench-actions:node-popped' }
      );
      let poppedId = popResult?.poppedId;
      let poppedNode = poppedId ? findNode?.(poppedId) : null;

      if (!appStore?.popActiveLearningNode) {
        poppedId = state.questionStack.pop();
        poppedNode = findNode?.(poppedId);
        if (poppedNode) {
          poppedNode.stackStatus = 'done';
          poppedNode.completedAt = Date.now();
        }

        normalizeQuestionStack?.();
        const nextTopId = getStackTopId?.();
        if (nextTopId) {
          state.activeQuestionId = nextTopId;
        } else if (poppedNode) {
          // When the last item, especially Q0, is popped, keep that completed node
          // visible so the bottom action can switch into the red reset/delete state.
          state.activeQuestionId = poppedNode.id;
        }
      }

      stateMachine?.transition?.(window.LearningStackStateMachine.Event.NODE_POPPED, { nodeId: poppedId });
      syncCentralLearning('workbench-actions:node-popped');
      renderActiveNodePage?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      window.requestAnimationFrame(() => promptInput?.focus());
    };

    const isWorkbenchReadyForGlobalEnter = () => {
      return Boolean(
        shell
        && shell.dataset.module === 'workbench'
        && shell.dataset.workbench === 'open'
        && !isRequesting()
      );
    };

    const isEditableKeyTarget = (target) => {
      if (!target || target === document || target === window) return false;
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      if (!element) return false;
      return Boolean(
        element.closest('textarea, input, select, [contenteditable="true"], [contenteditable=""]')
      );
    };

    const runPromptEnterAction = () => {
      if (isRequesting() || isMainTreeResetting() || stateMachine?.isBlocking?.()) return false;

      if (hasPromptPayload?.()) {
        promptForm?.requestSubmit();
        return true;
      }

      if (canResetMainQuestionTree()) {
        return returnToHistoryList();
      }

      if (isActiveNodeStackTop()) {
        popActiveQuestion();
        return true;
      }

      syncSendState?.();
      return false;
    };

    const handleGlobalEnterAction = (event) => {
      if (event.defaultPrevented) return;
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (!isWorkbenchReadyForGlobalEnter()) return;
      if (isEditableKeyTarget(event.target)) return;

      const handled = runPromptEnterAction();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handlePromptPopClick = () => {
      if (canResetMainQuestionTree()) {
        returnToHistoryList();
        return;
      }
      popActiveQuestion();
    };

    const handlePromptKeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        runPromptEnterAction();
      }
    };

    const handlePromptSubmit = async (event) => {
      event.preventDefault();
      const hasPayload = Boolean(hasPromptPayload?.());
      if (stateMachine ? !stateMachine.canSendPrompt(hasPayload) : (isRequesting() || !hasPayload)) return;

      const value = getPromptQuestionText?.() || '';
      const attachments = consumeSelectedAttachments?.() || [];
      if (promptInput) promptInput.value = '';
      restorePromptToInitialState?.();
      syncSendState?.();
      promptInput?.focus();

      if (shell?.dataset?.module === 'knowledge' && !hasMainQuestion()) {
        syncSendState?.();
        return;
      }

      if (stateMachine?.canCreateMainQuestion?.() ?? !hasMainQuestion()) {
        await createMainQuestion(value, attachments);
      } else {
        await createFollowUpQuestion(value, attachments);
      }
    };

    const attachEvents = () => {
      document.addEventListener('keydown', handleGlobalEnterAction);
      promptPop?.addEventListener('click', handlePromptPopClick);
      promptInput?.addEventListener('keydown', handlePromptKeydown);
      promptForm?.addEventListener('submit', handlePromptSubmit);
    };

    return {
      isMainTreeResetting,
      canResetMainQuestionTree,
      resetMainQuestionTree,
      isActiveNodeStackTop,
      createNode,
      applyApiMissingToNode,
      requestAnswerForNode,
      createMainQuestion,
      getDefaultParentContextForActiveNode,
      consumeFollowUpContext,
      createFollowUpQuestion,
      popActiveQuestion,
      runPromptEnterAction,
      handleGlobalEnterAction,
      handlePromptPopClick,
      handlePromptKeydown,
      handlePromptSubmit,
      attachEvents,
    };
  };

  window.WorkbenchActions = {
    createWorkbenchActionsController,
  };
}());
