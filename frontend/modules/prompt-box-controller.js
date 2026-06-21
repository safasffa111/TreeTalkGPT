(() => {
  const createPromptBoxController = ({
    promptInput,
    promptBox,
    richContextChip,
    promptAttach,
    promptPop,
    promptSend,
  } = {}) => {
    const getPromptInputHeights = (styles = null) => {
      if (!promptInput) return { minHeight: 40, maxHeight: 160 };
      const computed = styles || window.getComputedStyle(promptInput);
      return {
        minHeight: Number.parseFloat(computed.minHeight) || 40,
        maxHeight: Number.parseFloat(computed.maxHeight) || 160,
      };
    };

    let promptSizer = null;
    let promptResizeFrame = 0;
    let lastSizerStyleKey = '';
    let lastAppliedHeight = null;
    let lastAppliedOverflow = '';
    const promptRestoreTimers = new Set();
    const promptRestoreSettleTimers = new Set();

    const getPromptSizer = () => {
      if (!promptInput) return null;
      if (!promptSizer) {
        promptSizer = document.createElement('textarea');
        promptSizer.className = 'prompt-input prompt-input-sizer';
        promptSizer.setAttribute('aria-hidden', 'true');
        promptSizer.tabIndex = -1;
        document.body.appendChild(promptSizer);
      }
      return promptSizer;
    };

    const readPx = (value) => {
      const parsed = Number.parseFloat(value || '0');
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const copyPromptSizingStyles = (target, width = null, styles = null) => {
      if (!promptInput || !target) return;
      const computed = styles || window.getComputedStyle(promptInput);
      const styleNames = [
        'boxSizing',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'letterSpacing',
        'lineHeight',
        'textTransform',
        'textIndent',
        'textRendering',
        'wordSpacing',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'whiteSpace',
      ];
      const measuredWidth = width ?? promptInput.clientWidth;
      const widthText = `${Math.max(80, measuredWidth)}px`;
      const styleKey = `${widthText}|${styleNames.map((name) => computed[name] || '').join('|')}`;
      if (styleKey === lastSizerStyleKey) return;
      styleNames.forEach((name) => {
        target.style[name] = computed[name];
      });
      target.style.width = widthText;
      lastSizerStyleKey = styleKey;
    };

    const getPromptBoxInnerWidth = (styles = null) => {
      if (!promptBox) return promptInput?.clientWidth || 320;
      const computed = styles || window.getComputedStyle(promptBox);
      const paddingX = readPx(computed.paddingLeft) + readPx(computed.paddingRight);
      return Math.max(120, promptBox.clientWidth - paddingX);
    };

    const getPromptInlineInputWidth = (styles = null, innerWidth = null) => {
      if (!promptBox) return promptInput?.clientWidth || 320;
      const computed = styles || window.getComputedStyle(promptBox);
      const gap = readPx(computed.columnGap || computed.gap);
      const chipWidth = richContextChip && !richContextChip.hidden
        ? richContextChip.getBoundingClientRect().width
        : 0;
      const fixedWidth =
        (promptAttach?.getBoundingClientRect().width || 0) +
        chipWidth +
        (promptPop?.getBoundingClientRect().width || 0) +
        (promptSend?.getBoundingClientRect().width || 0) +
        gap * 4;
      return Math.max(120, (innerWidth ?? getPromptBoxInnerWidth(computed)) - fixedWidth);
    };

    const measurePromptTargetHeight = (width = null, metrics = {}) => {
      if (!promptInput) return 40;
      const inputStyles = metrics.inputStyles || window.getComputedStyle(promptInput);
      const { minHeight, maxHeight } = metrics.heights || getPromptInputHeights(inputStyles);
      const sizer = getPromptSizer();
      if (!sizer) return minHeight;
      copyPromptSizingStyles(sizer, width, inputStyles);
      const value = promptInput.value || '';
      if (sizer.value !== value) sizer.value = value;
      const measured = sizer.scrollHeight || minHeight;
      return Math.min(Math.max(measured, minHeight), maxHeight);
    };

    const applyPromptHeight = (height, { immediate = false, heights = null } = {}) => {
      if (!promptInput) return;
      const { maxHeight } = heights || getPromptInputHeights();
      const nextHeight = Math.max(0, Number(height) || 0);
      const heightChanged = lastAppliedHeight === null || Math.abs(lastAppliedHeight - nextHeight) > 0.25;
      if (immediate && heightChanged) {
        const previousTransition = promptInput.style.transition;
        promptInput.style.transition = 'none';
        promptInput.style.height = `${nextHeight}px`;
        void promptInput.offsetHeight;
        promptInput.style.transition = previousTransition;
      } else if (heightChanged) {
        promptInput.style.height = `${nextHeight}px`;
      }
      lastAppliedHeight = nextHeight;
      const overflow = nextHeight >= maxHeight - 1 ? 'auto' : 'hidden';
      if (overflow !== lastAppliedOverflow) {
        promptInput.style.overflowY = overflow;
        lastAppliedOverflow = overflow;
      }
    };

    const updatePromptMultilineMode = (metrics = {}) => {
      if (!promptInput || !promptBox) return false;
      const inputStyles = metrics.inputStyles || window.getComputedStyle(promptInput);
      const heights = metrics.heights || getPromptInputHeights(inputStyles);
      const boxStyles = metrics.boxStyles || window.getComputedStyle(promptBox);
      const innerWidth = metrics.innerWidth ?? getPromptBoxInnerWidth(boxStyles);
      const inlineWidth = metrics.inlineWidth ?? getPromptInlineInputWidth(boxStyles, innerWidth);
      const { minHeight } = heights;
      const value = promptInput.value || '';
      if (!value) {
        promptBox.classList.remove('is-multiline');
        return false;
      }
      const inlineHeight = measurePromptTargetHeight(inlineWidth, { inputStyles, heights });
      const shouldMultiline = value.length > 0 && (value.includes('\n') || inlineHeight > minHeight + 2);
      promptBox.classList.toggle('is-multiline', shouldMultiline);
      return shouldMultiline;
    };

    const autoResizePrompt = ({ immediate = false } = {}) => {
      if (!promptInput) return;
      if (promptResizeFrame) window.cancelAnimationFrame(promptResizeFrame);
      promptResizeFrame = window.requestAnimationFrame(() => {
        promptResizeFrame = 0;
        const inputStyles = window.getComputedStyle(promptInput);
        const heights = getPromptInputHeights(inputStyles);
        const boxStyles = promptBox ? window.getComputedStyle(promptBox) : null;
        const innerWidth = getPromptBoxInnerWidth(boxStyles);
        const inlineWidth = getPromptInlineInputWidth(boxStyles, innerWidth);
        const metrics = { inputStyles, heights, boxStyles, innerWidth, inlineWidth };
        const isMultiline = updatePromptMultilineMode(metrics);
        const value = promptInput.value || '';
        const targetWidth = isMultiline ? innerWidth : inlineWidth;
        const targetHeight = value ? measurePromptTargetHeight(targetWidth, metrics) : heights.minHeight;
        applyPromptHeight(targetHeight, { immediate, heights });
      });
    };

    const restorePromptToInitialState = () => {
      if (!promptInput) return;
      promptBox?.classList.add('is-restoring');
      promptInput.classList.add('is-restoring');
      promptInput.rows = 1;
      promptInput.scrollTop = 0;
      promptInput.setSelectionRange?.(0, 0);
      promptBox?.classList.remove('is-multiline');
      const heights = getPromptInputHeights();
      applyPromptHeight(heights.minHeight, { heights });

      const settleTimer = window.setTimeout(() => {
        promptRestoreSettleTimers.delete(settleTimer);
        promptBox?.classList.remove('is-restoring');
        promptInput.classList.remove('is-restoring');
        const isMultiline = updatePromptMultilineMode();
        const targetWidth = isMultiline ? getPromptBoxInnerWidth() : getPromptInlineInputWidth();
        applyPromptHeight(measurePromptTargetHeight(targetWidth), { immediate: true });
        promptInput.scrollTop = 0;
      }, 300);
      promptRestoreSettleTimers.add(settleTimer);
    };

    const schedulePromptRestore = (delays = [0, 80, 220]) => {
      promptRestoreTimers.forEach((timer) => window.clearTimeout(timer));
      promptRestoreTimers.clear();
      [...new Set(Array.isArray(delays) ? delays : [delays])].forEach((delay) => {
        const timer = window.setTimeout(() => {
          promptRestoreTimers.delete(timer);
          restorePromptToInitialState();
        }, Math.max(0, Number(delay) || 0));
        promptRestoreTimers.add(timer);
      });
    };

    const destroy = () => {
      if (promptResizeFrame) window.cancelAnimationFrame(promptResizeFrame);
      promptRestoreTimers.forEach((timer) => window.clearTimeout(timer));
      promptRestoreTimers.clear();
      promptRestoreSettleTimers.forEach((timer) => window.clearTimeout(timer));
      promptRestoreSettleTimers.clear();
      promptSizer?.remove();
      promptSizer = null;
      lastSizerStyleKey = '';
    };

    return {
      autoResizePrompt,
      restorePromptToInitialState,
      schedulePromptRestore,
      updatePromptMultilineMode,
      destroy,
    };
  };

  window.PromptBoxController = { createPromptBoxController };
})();
