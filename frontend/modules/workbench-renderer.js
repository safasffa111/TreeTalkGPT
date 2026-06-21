(() => {
  const makeContentPageId = (sessionId = '', nodeId = '') => `${String(sessionId || '')}::${String(nodeId || '')}`;

  const compactQuestionTitle = (question = '') => {
    const normalized = String(question).replace(/\s+/g, ' ').trim();
    if (!normalized) return '未命名问题';
    return normalized.length > 42 ? `${normalized.slice(0, 42)}…` : normalized;
  };

  const createWorkbenchRenderer = ({
    shell,
    contentStream,
    workbenchTreeList,
    workbenchSaveModeButton,
    state,
    findNode,
    getStackTopId,
    renderRichText,
    applyNodeAnnotationsToBody,
    clearActiveSelectionState,
    scheduleFingerprintReflow,
    syncSendState,
    syncPromptPlaceholder,
    focusPrompt,
    renderWorkbenchGraph,
    onSaveSubtreeToKnowledge,
    appStore,
  } = {}) => {
    const safeRenderRichText = typeof renderRichText === 'function'
      ? renderRichText
      : (text) => String(text ?? '');

    let lastContentRenderKey = '';
    let lastRenderedPageId = null;
    let latestContentRenderRequestId = 0;
    let contentRenderQueue = Promise.resolve();
    const CONTENT_LEAVE_MS = 170;
    const CONTENT_ENTER_MS = 210;
    let isSaveMode = false;
    let saveModeTransitionRunning = false;
    let pendingSaveModeTarget = null;
    const treeRowCache = new Map();
    let treeEmptyElement = null;
    let lastTreeSessionId = null;

    const prefersReducedMotion = () => Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );

    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const syncSaveModeUi = () => {
      if (shell) {
        shell.dataset.workbenchSaveMode = isSaveMode ? 'true' : 'false';
      }
      if (!workbenchSaveModeButton) return;
      workbenchSaveModeButton.classList.toggle('is-active', isSaveMode);
      workbenchSaveModeButton.classList.toggle('is-transitioning', saveModeTransitionRunning);
      workbenchSaveModeButton.setAttribute('aria-pressed', isSaveMode ? 'true' : 'false');
      workbenchSaveModeButton.title = isSaveMode ? '退出保存到知识仓库' : '保存问题到知识仓库';
      workbenchSaveModeButton.setAttribute('aria-label', workbenchSaveModeButton.title);
    };

    const applySaveModeTransition = async (targetState) => {
      const nextState = Boolean(targetState);
      if (isSaveMode === nextState && !shell?.dataset?.workbenchSaveTransition) {
        syncSaveModeUi();
        return;
      }
      saveModeTransitionRunning = true;
      if (shell) shell.dataset.workbenchSaveTransition = nextState ? 'entering' : 'leaving';
      isSaveMode = nextState;
      syncSaveModeUi();
      await wait(prefersReducedMotion() ? 0 : 260);
      if (shell?.dataset?.workbenchSaveTransition) delete shell.dataset.workbenchSaveTransition;
      saveModeTransitionRunning = false;
      syncSaveModeUi();
    };

    const requestSaveMode = (targetState) => {
      pendingSaveModeTarget = Boolean(targetState);
      if (saveModeTransitionRunning) return;
      const drain = () => {
        if (pendingSaveModeTarget === null) return;
        const target = pendingSaveModeTarget;
        pendingSaveModeTarget = null;
        applySaveModeTransition(target)
          .catch((error) => console.error('[workbench-renderer] save mode transition failed', error))
          .finally(() => {
            if (pendingSaveModeTarget !== null) drain();
          });
      };
      drain();
    };

    workbenchSaveModeButton?.addEventListener?.('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestSaveMode(!isSaveMode);
    });

    syncSaveModeUi();

    const queueContentOperation = (operation) => {
      contentRenderQueue = contentRenderQueue
        .catch(() => {})
        .then(() => operation?.())
        .catch((error) => {
          console.error('[workbench-renderer] content transition failed', error);
        });
      return contentRenderQueue;
    };

    const clearContentTransitionClasses = () => {
      if (!contentStream) return;
      contentStream.classList.remove('is-content-leaving', 'is-content-entering', 'is-content-preparing-enter');
      delete contentStream.dataset.contentTransition;
    };

    const markContentEnterSettled = () => {
      if (!contentStream) return;
      contentStream.querySelectorAll('.content-message').forEach((element) => {
        element.classList.add('is-content-transition-settled');
      });
    };

    const markContentMountedQuietly = () => {
      // Store-driven same-node updates such as request-started/request-settled or
      // stack button state changes should update the DOM without replaying the
      // base .content-message messageIn animation. Replaying that default
      // animation immediately after a queued page enter is what produced the
      // remaining one-frame flash.
      markContentEnterSettled();
      if (contentStream) contentStream.dataset.contentTransition = 'settled';
    };

    const runContentLeave = async () => {
      if (!contentStream || !contentStream.childElementCount || prefersReducedMotion()) return;
      contentStream.classList.remove('is-content-entering');
      contentStream.classList.add('is-content-leaving');
      contentStream.dataset.contentTransition = 'leaving';
      // Force style application so repeated queued transitions do not collapse.
      void contentStream.offsetHeight;
      await wait(CONTENT_LEAVE_MS);
    };

    const runContentEnter = async () => {
      if (!contentStream || !contentStream.childElementCount || prefersReducedMotion()) return;
      contentStream.classList.remove('is-content-leaving', 'is-content-preparing-enter');
      contentStream.classList.add('is-content-entering');
      contentStream.dataset.contentTransition = 'entering';
      void contentStream.offsetHeight;
      await wait(CONTENT_ENTER_MS);
      markContentEnterSettled();
      void contentStream.offsetHeight;
      clearContentTransitionClasses();
      contentStream.dataset.contentTransition = 'settled';
    };

    const isResetAnimating = () => Boolean(
      contentStream?.classList?.contains('is-reset-leaving')
      || contentStream?.closest?.('.app-shell')?.dataset?.resettingTree === 'true'
    );

    const stableStringify = (value) => {
      const seen = new WeakSet();
      const normalize = (item) => {
        if (item === null || item === undefined) return item;
        if (typeof item !== 'object') return item;
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
        if (Array.isArray(item)) return item.map(normalize);
        return Object.keys(item).sort().reduce((acc, key) => {
          acc[key] = normalize(item[key]);
          return acc;
        }, {});
      };
      try { return JSON.stringify(normalize(value)); } catch (_) { return String(value); }
    };

    const getStoreLearningData = () => appStore?.select?.('learningData', null) || null;

    const getRenderNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return Array.isArray(state?.nodes) ? state.nodes : [];
    };

    const getRootNodes = () => {
      const nodes = appStore?.getRootLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return getRenderNodes().filter((node) => !node.parentId);
    };

    const getRenderNode = (nodeId) => {
      if (!nodeId) return null;
      return appStore?.getLearningNode?.(nodeId) || findNode?.(nodeId) || null;
    };

    const getActiveQuestionId = () => {
      const learningData = getStoreLearningData();
      return learningData?.activeQuestionId ?? state?.activeQuestionId ?? null;
    };

    const getStackTopQuestionId = () => appStore?.select?.('stackTopId', null) ?? getStackTopId?.() ?? null;

    const clearContentStream = (options = {}) => {
      closeImageAttachmentPreview();
      if (!contentStream) return Promise.resolve();
      latestContentRenderRequestId += 1;
      lastContentRenderKey = '';
      lastRenderedPageId = null;

      const shouldAnimate = options.animate !== false
        && contentStream.childElementCount > 0
        && !isResetAnimating()
        && !prefersReducedMotion();

      if (!shouldAnimate) {
        clearContentTransitionClasses();
        contentStream.replaceChildren();
        return Promise.resolve();
      }

      return queueContentOperation(async () => {
        await runContentLeave();
        contentStream.replaceChildren();
        clearContentTransitionClasses();
      });
    };

    const appendContentMessage = (text, type = 'plain', meta = '', options = {}) => {
      if (!contentStream) return null;
      const message = document.createElement('article');
      message.className = `content-message content-message--${type}`;
      if (options.nodeId) message.dataset.nodeId = options.nodeId;
      if (options.sourceKind) message.dataset.sourceKind = options.sourceKind;
      if (meta) {
        const label = document.createElement('div');
        label.className = 'content-message-label';
        label.textContent = meta;
        message.appendChild(label);
      }

      const body = document.createElement('div');
      body.className = 'content-message-body';
      body.dataset.rawText = String(options.rawText ?? text ?? '');
      body.dataset.nodeId = options.nodeId || '';
      body.dataset.sourceKind = options.sourceKind || '';

      const shouldRenderRich = type.startsWith('assistant') || Boolean(options.rich);
      if (options.html) {
        body.classList.add('rich-content');
        if (options.richClass) body.classList.add(options.richClass);
        body.innerHTML = options.html;
      } else if (shouldRenderRich) {
        body.classList.add('rich-content');
        if (options.richClass) body.classList.add(options.richClass);
        body.innerHTML = safeRenderRichText(text);
      } else {
        body.textContent = text;
      }

      message.appendChild(body);
      contentStream.appendChild(message);
      return message;
    };

    const buildNodeQuestionRawText = (node) => {
      const parts = [String(node?.question || '').trim()];
      const selectedText = String(node?.selectedTextContext || '').trim();
      if (node?.parentId && selectedText) {
        parts.push(`框选原文：\n${selectedText}`);
      }
      return parts.filter(Boolean).join('\n\n');
    };

    const hasExplicitMathDelimiters = (value = '') => /\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|(?<!\$)\$[^$\n]+?\$(?!\$)/.test(String(value || ''));

    const stripTrailingSentencePunctuation = (value = '') => String(value || '').trim().replace(/[。！？!?；;，,：:]$/u, '').trim();

    const looksLikeBareLatexFormula = (value = '') => {
      const text = stripTrailingSentencePunctuation(value);
      if (!text || hasExplicitMathDelimiters(text)) return false;
      if (text.length > 1400) return false;

      const proseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const latexSignals = [
        /\\(?:frac|dfrac|tfrac|sqrt|sum|int|prod|lim|begin|end|mathrm|mathbf|mathit|vec|overline|underline|left|right|cdot|times|le|ge|neq|approx|to|rightarrow|Rightarrow|Delta|nabla|partial|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega)\b/,
        /\\[A-Za-z]+/,
        /[_^]\{?[-+*/=(),.;:\w\\]+\}?/,
        /(?:\\to|\\rightarrow|\\Rightarrow|\\leftrightarrow)/,
        /[A-Za-z0-9)}\]\|]\s*(?:=|\+|-|\*|\/|<|>|\\le|\\ge|\\ne)\s*[A-Za-z0-9({\\\[]/,
      ].reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

      // Keep ordinary prose as prose. Bare LaTeX selected from KaTeX normally
      // has commands, subscripts, superscripts, or dense operators.
      if (proseChars >= 6 && latexSignals < 2) return false;
      return latexSignals >= 1;
    };

    const splitFormulaList = (value = '') => {
      const text = String(value || '').trim();
      if (!text) return [];
      // Keep a selected equation intact. Only split explicit blank-line-separated
      // selections; joining adjacent formulas is better than destructuring one equation.
      const byBlock = text.split(/\n{2,}/g)
        .map((item) => item.trim())
        .filter(Boolean);
      return byBlock.length ? byBlock : [text];
    };

    const renderBareFormulaLinesForDisplay = (formulaText = '') => {
      const formulas = splitFormulaList(formulaText);
      if (!formulas.length) return '';
      return formulas.map((formula) => {
        if (hasExplicitMathDelimiters(formula)) return formula;
        return `$$\n${formula}\n$$`;
      }).join('\n\n');
    };

    const hasMarkdownCodeFence = (value = '') => /(^|\n)```/.test(String(value || ''));

    const countCodeSignals = (value = '') => {
      const text = String(value || '');
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
      const joined = lines.join('\n');
      let score = 0;

      if (/^\s{2,}\S/m.test(text) || /\t\S/.test(text)) score += 2;
      if (/[{};]/.test(joined)) score += 1;
      if (/\b(?:const|let|var|function|return|class|import|export|from|async|await|if|else|for|while|switch|case|try|catch|throw|new)\b/.test(joined)) score += 2;
      if (/\b(?:def|return|import|from|class|self|lambda|elif|except|with|yield|print)\b/.test(joined)) score += 2;
      if (/(?:=>|===|!==|==|!=|<=|>=|&&|\|\||::|->)/.test(joined)) score += 1;
      if (/<\/?[A-Za-z][\w:-]*(?:\s|>|\/)/.test(joined)) score += 2;
      if (/^\s*(?:npm|node|python|pip|git|cd|mkdir|rm|cp|mv|curl|ssh)\b/m.test(joined)) score += 2;
      if (/^\s*[{[]\s*$/m.test(joined) || /^\s*[}\]]\s*[,;]?\s*$/m.test(joined)) score += 1;
      if (/^\s*[\w$.-]+\s*[:=]\s*[^。！？]*$/m.test(joined) && /[;{}(),]/.test(joined)) score += 1;
      if (lines.length >= 3 && lines.some((line) => /^\s{2,}\S/.test(line))) score += 2;

      return score;
    };

    const inferCodeFenceLanguage = (value = '') => {
      const text = String(value || '');
      if (/\b(?:def|print|self|elif|except|import\s+\w+|from\s+\w+\s+import)\b/.test(text)) return 'python';
      if (/\b(?:const|let|var|function|console\.log|=>|import\s+.*\s+from)\b/.test(text)) return 'js';
      if (/<\/?[A-Za-z][\w:-]*(?:\s|>|\/)/.test(text)) return 'html';
      if (/^\s*[.#]?[\w-]+\s*\{[\s\S]*\}\s*$/m.test(text) && /:\s*[^;]+;/.test(text)) return 'css';
      if (/^\s*[\[{]/.test(text) && /"[\w-]+"\s*:/.test(text)) return 'json';
      if (/^\s*(?:npm|node|python|pip|git|cd|mkdir|rm|cp|mv|curl|ssh)\b/m.test(text)) return 'bash';
      return '';
    };

    const looksLikeCodeSelection = (value = '') => {
      const text = String(value || '').trim();
      if (!text || hasMarkdownCodeFence(text) || hasExplicitMathDelimiters(text)) return false;
      if (looksLikeBareLatexFormula(text)) return false;
      const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
      const score = countCodeSignals(text);
      if (lines.length >= 2 && score >= 2) return true;
      if (lines.length >= 4 && score >= 1) return true;
      return lines.length === 1 && score >= 3;
    };

    const renderCodeSelectionForDisplay = (value = '') => {
      const text = String(value || '').replace(/\r\n/g, '\n').trimEnd();
      if (!text.trim()) return '';
      const lang = inferCodeFenceLanguage(text);
      if (text.includes('\n')) return `\`\`\`${lang}\n${text}\n\`\`\``;
      return `\`${text.replace(/`/g, '\\`')}\``;
    };

    const buildSelectedContextDisplayText = (selectedText = '') => {
      const raw = String(selectedText || '').trim();
      if (!raw) return '';
      if (hasMarkdownCodeFence(raw)) return raw;
      if (looksLikeCodeSelection(raw)) return renderCodeSelectionForDisplay(raw);
      if (hasExplicitMathDelimiters(raw)) return raw;

      const lines = raw.replace(/\r\n/g, '\n').split('\n');
      const output = [];
      let codeMode = false;

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
          codeMode = !codeMode;
          output.push(line);
          return;
        }

        if (codeMode) {
          output.push(line);
          return;
        }

        if (!trimmed) {
          output.push('');
          return;
        }

        const formulaLabel = trimmed.match(/^(完整公式|公式|LaTeX|Latex|latex)\s*[:：]\s*([\s\S]+)$/u);
        if (formulaLabel && looksLikeBareLatexFormula(formulaLabel[2])) {
          output.push(`${formulaLabel[1]}：`);
          output.push(renderBareFormulaLinesForDisplay(formulaLabel[2]));
          return;
        }

        if (looksLikeBareLatexFormula(trimmed)) {
          output.push(renderBareFormulaLinesForDisplay(trimmed));
          return;
        }

        output.push(line);
      });

      return output.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
    };

    const escapeAttribute = (value = '') => String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

    const formatAttachmentSize = (bytes = 0) => {
      if (window.AttachmentUtils?.formatFileSize) return window.AttachmentUtils.formatFileSize(bytes);
      const size = Number(bytes) || 0;
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getAttachmentPreviewUrl = (item = {}) => {
      if (item.kind === 'image') return item.dataUrl || item.fileUrl || '';
      return '';
    };

    const getImageAttachmentPreviewController = (() => {
      let controller = null;

      const createController = () => {
        let layer = null;
        let float = null;
        let image = null;
        let backdrop = null;
        let closeTimer = 0;
        let isOpen = false;
        let lastTrigger = null;

        const ensureLayer = () => {
          if (layer && layer.isConnected) return layer;
          layer = document.createElement('div');
          layer.className = 'image-attachment-preview-layer';
          layer.setAttribute('aria-hidden', 'true');
          layer.innerHTML = `
            <div class="image-attachment-preview-backdrop" data-preview-close="true"></div>
            <div class="image-attachment-preview-float" role="dialog" aria-modal="true" aria-label="图片附件预览">
              <img class="image-attachment-preview-img" alt="" draggable="false" />
            </div>`;
          document.body.appendChild(layer);
          backdrop = layer.querySelector('.image-attachment-preview-backdrop');
          float = layer.querySelector('.image-attachment-preview-float');
          image = layer.querySelector('.image-attachment-preview-img');
          backdrop?.addEventListener('click', () => close());
          layer.addEventListener('click', (event) => {
            if (event.target === layer || event.target?.dataset?.previewClose === 'true') close();
          });
          float?.addEventListener('click', (event) => {
            event.stopPropagation();
          });
          return layer;
        };

        const setOriginFromElement = (trigger) => {
          const rect = trigger?.getBoundingClientRect?.();
          if (!rect || !float) return;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          float.style.setProperty('--preview-origin-x', `${cx}px`);
          float.style.setProperty('--preview-origin-y', `${cy}px`);
        };

        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        };

        const open = ({ src = '', alt = '', trigger = null } = {}) => {
          if (!src) return false;
          ensureLayer();
          if (!layer || !image || !float) return false;
          window.clearTimeout(closeTimer);
          lastTrigger = trigger || document.activeElement || null;
          setOriginFromElement(trigger);
          image.alt = alt || '图片附件预览';
          image.src = src;
          layer.classList.remove('is-closing');
          layer.classList.add('is-opening');
          layer.setAttribute('aria-hidden', 'false');
          layer.hidden = false;
          document.documentElement.classList.add('has-image-attachment-preview');
          isOpen = true;
          window.requestAnimationFrame?.(() => {
            layer.classList.add('is-open');
            layer.classList.remove('is-opening');
          });
          window.addEventListener('keydown', onKeyDown, true);
          return true;
        };

        const close = () => {
          if (!layer || !isOpen) return false;
          isOpen = false;
          window.clearTimeout(closeTimer);
          layer.classList.remove('is-opening', 'is-open');
          layer.classList.add('is-closing');
          layer.setAttribute('aria-hidden', 'true');
          document.documentElement.classList.remove('has-image-attachment-preview');
          window.removeEventListener('keydown', onKeyDown, true);
          const finish = () => {
            if (!layer || isOpen) return;
            layer.hidden = true;
            layer.classList.remove('is-closing');
            if (image) {
              image.removeAttribute('src');
              image.alt = '';
            }
            if (lastTrigger?.focus) {
              try { lastTrigger.focus({ preventScroll: true }); } catch { lastTrigger.focus(); }
            }
            lastTrigger = null;
          };
          closeTimer = window.setTimeout(finish, prefersReducedMotion() ? 0 : 230);
          return true;
        };

        return { open, close, isOpen: () => isOpen };
      };

      return () => {
        if (!controller) controller = createController();
        return controller;
      };
    })();

    const closeImageAttachmentPreview = () => {
      try {
        getImageAttachmentPreviewController()?.close?.();
      } catch (error) {
        console.warn('[workbench-renderer] close image preview failed:', error);
      }
    };

    const buildQuestionAttachmentsHtml = (attachments = []) => {
      const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
      if (!list.length) return '';
      const cards = list.map((item) => {
        const id = escapeAttribute(item.id || '');
        const name = escapeAttribute(item.name || '未命名附件');
        const type = escapeAttribute(item.type || '未知类型');
        const size = escapeAttribute(formatAttachmentSize(item.size));
        const localPath = escapeAttribute(item.localPath || '');
        const previewUrl = getAttachmentPreviewUrl(item);
        const savedText = item.localPath ? '已保存到本地附件文件夹' : (item.localSaveError ? '本地保存失败' : '未保存到本地');
        const extractedText = window.AttachmentUtils?.getAttachmentExtractedText?.(item) || '';
        const extractionLabel = window.AttachmentUtils?.getAttachmentExtractionStatusLabel?.(item) || '';
        const fullLength = Number(item.extraction?.fullLength || extractedText.length || 0);
        const chunkCount = Number(item.extractionChunkCount || item.extraction?.chunkCount || 0);
        const cacheHit = Boolean(item.extraction?.cacheHit);
        const extractionMeta = extractedText
          ? `${extractionLabel} · ${fullLength || extractedText.length} 字${chunkCount ? ` · ${chunkCount} 片段` : ''}${cacheHit ? ' · 缓存' : ''}`
          : extractionLabel;
        const media = previewUrl
          ? `<span class="question-attachment-preview"><img src="${escapeAttribute(previewUrl)}" alt="${name}" loading="lazy" /></span>`
          : `<span class="question-attachment-file-mark" aria-hidden="true"></span>`;
        const isPreviewableImage = Boolean(previewUrl);
        const actionLabel = isPreviewableImage ? `预览图片附件 ${name}` : `打开附件 ${name}`;
        return `<button type="button" class="question-attachment-card question-attachment-card--${escapeAttribute(item.kind || 'file')}" data-attachment-id="${id}" data-attachment-path="${localPath}" data-attachment-kind="${escapeAttribute(item.kind || 'file')}"${isPreviewableImage ? ' data-previewable-image="true"' : ''} title="${name}" aria-label="${escapeAttribute(actionLabel)}">
          ${media}
          <span class="question-attachment-meta">
            <span class="question-attachment-name">${name}</span>
            <span class="question-attachment-subline">${type} · ${size}</span>
            <span class="question-attachment-storage">${escapeAttribute(savedText)}</span>
            ${extractionMeta ? `<span class="question-attachment-extraction">${escapeAttribute(extractionMeta)}</span>` : ''}
          </span>
        </button>`;
      }).join('');
      return `<section class="question-attachments-panel" aria-label="问题附件">
        <div class="question-attachments-label">附件</div>
        <div class="question-attachments-list">${cards}</div>
      </section>`;
    };

    const attachQuestionAttachmentHandlers = (message, node) => {
      if (!message || !Array.isArray(node?.attachments)) return;
      const byId = new Map(node.attachments.map((item) => [String(item.id || ''), item]));
      message.querySelectorAll('.question-attachment-card').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const item = byId.get(String(button.dataset.attachmentId || '')) || null;
          const previewUrl = getAttachmentPreviewUrl(item || {});
          if (item?.kind === 'image' && previewUrl) {
            getImageAttachmentPreviewController().open({
              src: previewUrl,
              alt: item.name || '图片附件预览',
              trigger: button,
            });
            return;
          }
          if (!item?.localPath || !window.desktopShell?.openLocalAttachment) return;
          button.classList.add('is-opening');
          try {
            const result = await window.desktopShell.openLocalAttachment({ filePath: item.localPath });
            if (!result?.ok) console.warn('[workbench-renderer] open attachment failed:', result?.error || result);
          } catch (error) {
            console.warn('[workbench-renderer] open attachment crashed:', error);
          } finally {
            button.classList.remove('is-opening');
          }
        });
      });
    };

    const buildNodeQuestionHtml = (node) => {
      const question = String(node?.question || '').trim();
      const selectedText = String(node?.selectedTextContext || '').trim();
      const questionHtml = `<div class="question-main-text">${safeRenderRichText(question || '未命名问题')}</div>`;
      const attachmentsHtml = buildQuestionAttachmentsHtml(node?.attachments || []);

      if (!node?.parentId || !selectedText) {
        return `${questionHtml}${attachmentsHtml}`;
      }

      return `${questionHtml}
        <section class="selected-context-panel" aria-label="框选原文">
          <div class="selected-context-label">框选原文</div>
          <div class="selected-context-body rich-content">${safeRenderRichText(buildSelectedContextDisplayText(selectedText))}</div>
        </section>${attachmentsHtml}`;
    };

    const buildActiveContentRenderKey = (node) => {
      if (!node) return '__empty__';
      return appStore?.getLearningContentRenderKey?.() || appStore?.select?.('learningContentRenderKey', '') || stableStringify({
        id: node.id || '',
        parentId: node.parentId || '',
        question: node.question || '',
        status: node.status || '',
        // stackStatus only affects tree/graph/button state, not page content.
        answer: node.answer || '',
        displayedAnswer: node.displayedAnswer || '',
        isTyping: Boolean(node.isTyping),
        answerMeta: node.answerMeta || '',
        systemMessage: node.systemMessage || '',
        errorMessage: node.errorMessage || '',
        loadingText: node.loadingText || '',
        loadingMeta: node.loadingMeta || '',
        selectedTextContext: node.selectedTextContext || '',
        selectionSourceKind: node.selectionSourceKind || '',
        selectionRange: node.selectionRange || null,
        attachments: node.attachments || [],
        annotations: node.annotations || [],
      });
    };

    const getContentPageId = (node) => makeContentPageId(
      getStoreLearningData()?.sessionId || '',
      node?.id || ''
    );

    const handleSaveSubtree = async (nodeId, actionButton = null) => {
      if (!nodeId || typeof onSaveSubtreeToKnowledge !== 'function') return false;
      try {
        actionButton?.classList?.add('is-saving');
        const result = await onSaveSubtreeToKnowledge(nodeId);
        if (result !== false) {
          actionButton?.classList?.add('is-saved');
          window.setTimeout(() => actionButton?.classList?.remove('is-saved'), 650);
        }
        return result;
      } catch (error) {
        console.error('[workbench-renderer] save subtree to knowledge failed', error);
        actionButton?.classList?.add('is-save-error');
        window.setTimeout(() => actionButton?.classList?.remove('is-save-error'), 900);
        return false;
      } finally {
        actionButton?.classList?.remove('is-saving');
      }
    };

    const createTreeRow = (nodeId) => {
        const row = document.createElement('div');
        row.className = 'tree-node-row';
        row.dataset.nodeId = nodeId;

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'tree-node-save';
        saveButton.title = '保存当前问题及其追问到知识仓库';
        const stopSaveButtonPointer = (event) => {
          // Do not preventDefault here: on some Chromium builds that can cancel
          // the subsequent button click. We only need to stop the full-width
          // tree row from seeing the pointer event.
          event.stopPropagation();
        };
        saveButton.addEventListener('pointerdown', stopSaveButtonPointer);
        saveButton.addEventListener('mousedown', stopSaveButtonPointer);
        saveButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          handleSaveSubtree(nodeId, saveButton);
        });

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tree-node-button';
        button.dataset.nodeId = nodeId;

        const title = document.createElement('span');
        title.className = 'tree-node-title';
        button.appendChild(title);

        button.addEventListener('click', () => {
          if (appStore?.setActiveQuestion) {
            appStore.setActiveQuestion(nodeId, { source: 'workbench-renderer:open-node' });
          } else if (state) {
            state.activeQuestionId = nodeId;
          }
          renderActiveNodePage();
          renderWorkbenchTree();
          renderWorkbenchGraph?.();
          syncPromptPlaceholder?.();
          window.requestAnimationFrame(() => focusPrompt?.());
        });

        row.appendChild(button);
        // Mount the save icon after the full-width tree button and keep it on a
        // higher layer. The tree button spans the whole row, so if the icon is
        // painted below it the click is swallowed by the row button.
        row.appendChild(saveButton);
        return { row, button, saveButton, title, lastKey: '' };
    };

    const renderWorkbenchTree = () => {
      if (!workbenchTreeList) return;

      const sessionId = String(getStoreLearningData()?.sessionId || state?.sessionId || '');
      if (lastTreeSessionId !== null && sessionId !== lastTreeSessionId) {
        treeRowCache.forEach(({ row }) => row.remove?.());
        treeRowCache.clear();
        treeEmptyElement?.remove?.();
      }
      lastTreeSessionId = sessionId;

      const nodes = getRenderNodes();
      if (!nodes.length) {
        treeRowCache.forEach(({ row }) => row.remove?.());
        treeRowCache.clear();
        if (!treeEmptyElement) {
          treeEmptyElement = document.createElement('div');
          treeEmptyElement.className = 'tree-list-empty';
          treeEmptyElement.textContent = '提出主问题后，问题会按父子关系出现在这里。';
        }
        if (treeEmptyElement.parentNode !== workbenchTreeList) workbenchTreeList.appendChild(treeEmptyElement);
        syncSaveModeUi();
        return;
      }

      treeEmptyElement?.remove?.();
      const flattened = [];
      const visited = new Set();
      const collectNode = (nodeId, depth = 0) => {
        if (visited.has(nodeId)) return;
        const node = getRenderNode(nodeId);
        if (!node) return;
        visited.add(nodeId);
        flattened.push({ node, depth });
        (node.children || []).forEach((childId) => collectNode(childId, depth + 1));
      };

      getRootNodes().forEach((node) => collectNode(node.id, 0));
      const liveIds = new Set();
      flattened.forEach(({ node, depth }, index) => {
        liveIds.add(node.id);
        let cached = treeRowCache.get(node.id);
        if (!cached) {
          cached = createTreeRow(node.id);
          treeRowCache.set(node.id, cached);
        }
        const { row, button, saveButton, title } = cached;
        const compactTitle = compactQuestionTitle(node.question);
        const isActive = node.id === getActiveQuestionId();
        const isStackActive = node.stackStatus === 'active';
        const isStackDone = node.stackStatus === 'done';
        const isStackTop = node.id === getStackTopQuestionId();
        const isEntering = Boolean(state.recentNodeEnterIds?.has?.(node.id));
        const key = `${depth}|${node.question || ''}|${compactTitle}|${isActive ? 1 : 0}|${isStackActive ? 1 : 0}|${isStackDone ? 1 : 0}|${isStackTop ? 1 : 0}|${isEntering ? 1 : 0}`;
        if (cached.lastKey !== key) {
          row.style.setProperty('--tree-depth', String(depth));
          button.style.setProperty('--tree-depth', String(depth));
          button.title = node.question || node.id;
          button.setAttribute('aria-label', `${node.id} ${node.question || ''}`.trim());
          button.classList.toggle('is-active', isActive);
          button.classList.toggle('is-stack-active', isStackActive);
          button.classList.toggle('is-stack-done', isStackDone);
          button.classList.toggle('is-stack-top', isStackTop);
          button.classList.toggle('is-node-enter', isEntering);
          saveButton.setAttribute('aria-label', `${saveButton.title}：${node.question || node.id}`);
          title.textContent = compactTitle;
          cached.lastKey = key;
        }
        const currentAtIndex = workbenchTreeList.children?.[index];
        if (currentAtIndex !== row) workbenchTreeList.insertBefore(row, currentAtIndex || null);
      });
      treeRowCache.forEach((cached, nodeId) => {
        if (liveIds.has(nodeId)) return;
        cached.row.remove?.();
        treeRowCache.delete(nodeId);
      });
      syncSaveModeUi();
    };

    const mountActiveNodeContent = (node, { scrollTop = false, preserveTransitionClasses = false } = {}) => {
      if (!preserveTransitionClasses) clearContentTransitionClasses();
      contentStream?.replaceChildren();

      if (!node) {
        scheduleFingerprintReflow?.([0, 60]);
        syncSendState?.();
        return false;
      }

      const activeSelection = getStoreLearningData()?.activeSelection ?? state?.activeSelection;
      if (activeSelection && activeSelection.parentId !== node.id) {
        clearActiveSelectionState?.();
        window.getSelection?.()?.removeAllRanges?.();
      }

      const questionDisplayText = buildNodeQuestionRawText(node);
      const questionMessage = appendContentMessage(
        questionDisplayText,
        'question',
        node.parentId ? `${node.id} · 追问` : `${node.id} · 主问题`,
        {
          nodeId: node.id,
          sourceKind: 'question',
          rich: true,
          richClass: 'question-rich-content',
          rawText: questionDisplayText,
          html: buildNodeQuestionHtml(node),
        }
      );

      if (questionMessage) {
        applyNodeAnnotationsToBody?.(questionMessage.querySelector('.content-message-body'), node, 'question');
        attachQuestionAttachmentHandlers(questionMessage, node);
      }

      let answerMessage = null;
      if (node.status === 'requesting') {
        answerMessage = appendContentMessage(
          node.loadingText || '正在思考…',
          'assistant is-loading',
          node.loadingMeta || '思考中',
          { nodeId: node.id, sourceKind: 'answer', rawText: node.answer || node.loadingText || '' }
        );
      } else if (node.status === 'waiting-api') {
        appendContentMessage(
          node.systemMessage || '请先完成 API 配置。',
          'system',
          'API 配置缺失',
          { nodeId: node.id, sourceKind: 'system' }
        );
      } else if (node.status === 'error') {
        appendContentMessage(
          node.errorMessage || '请求失败。',
          'system',
          '请求失败',
          { nodeId: node.id, sourceKind: 'system' }
        );
      } else if (node.answer) {
        const answerText = node.isTyping ? (node.displayedAnswer || '') : node.answer;
        answerMessage = appendContentMessage(
          answerText,
          node.isTyping ? 'assistant is-typing' : 'assistant',
          node.answerMeta || 'AI 回复',
          { nodeId: node.id, sourceKind: 'answer', rawText: node.answer || answerText }
        );
      }

      if (answerMessage) {
        applyNodeAnnotationsToBody?.(answerMessage.querySelector('.content-message-body'), node, 'answer');
      }

      if (!preserveTransitionClasses) {
        markContentMountedQuietly();
      }

      if (scrollTop) {
        contentStream?.scrollTo({ top: 0, behavior: 'auto' });
      }
      scheduleFingerprintReflow?.([0, 60]);
      syncSendState?.();
      return true;
    };

    const renderActiveNodePage = (options = {}) => {
      const requestId = ++latestContentRenderRequestId;
      const snapshotNode = getRenderNode(getActiveQuestionId());
      const nextRenderKey = buildActiveContentRenderKey(snapshotNode);
      const nextPageId = getContentPageId(snapshotNode);
      const previousPageId = lastRenderedPageId || '';
      const isPageSwitch = previousPageId && nextPageId && previousPageId !== nextPageId;
      const shouldAnimateSwitch = Boolean(
        contentStream
        && contentStream.childElementCount
        && isPageSwitch
        && options.animate !== false
        && !prefersReducedMotion()
      );

      if (!options.force && nextRenderKey === lastContentRenderKey && !shouldAnimateSwitch) {
        scheduleFingerprintReflow?.([0, 60]);
        syncSendState?.();
        return false;
      }

      const shouldScrollTop = options.scrollTop === true || (options.scrollTop !== false && isPageSwitch);

      const runRender = async () => {
        if (requestId !== latestContentRenderRequestId) return false;
        const node = getRenderNode(getActiveQuestionId());
        const renderKey = buildActiveContentRenderKey(node);
        const pageId = getContentPageId(node);
        const stillSwitchingPage = Boolean(lastRenderedPageId && pageId && lastRenderedPageId !== pageId);
        const enterOnly = Boolean(
          contentStream
          && options.animateEnter
          && options.animate !== false
          && !contentStream.childElementCount
          && !prefersReducedMotion()
        );
        const animate = Boolean(
          contentStream
          && contentStream.childElementCount
          && stillSwitchingPage
          && options.animate !== false
          && !prefersReducedMotion()
        );

        if (!options.force && renderKey === lastContentRenderKey && !animate && !enterOnly) {
          scheduleFingerprintReflow?.([0, 60]);
          syncSendState?.();
          return false;
        }

        if (animate) await runContentLeave();
        if (requestId !== latestContentRenderRequestId) return false;

        if ((animate || enterOnly) && contentStream) {
          contentStream.classList.remove('is-content-leaving', 'is-content-entering');
          contentStream.classList.add('is-content-preparing-enter');
          contentStream.dataset.contentTransition = 'preparing-enter';
        }

        lastContentRenderKey = renderKey;
        lastRenderedPageId = pageId;
        const didRender = mountActiveNodeContent(node, { scrollTop: shouldScrollTop, preserveTransitionClasses: animate || enterOnly });
        if (animate || enterOnly) await runContentEnter();
        return didRender;
      };

      if (shouldAnimateSwitch || options.animateEnter || contentStream?.dataset?.contentTransition) {
        const queuedRender = queueContentOperation(runRender);
        if (options.awaitTransition) return queuedRender;
      } else {
        const directRender = runRender();
        if (options.awaitTransition) return directRender;
      }
      return true;
    };

    return {
      clearContentStream,
      appendContentMessage,
      buildNodeQuestionRawText,
      buildNodeQuestionHtml,
      compactQuestionTitle,
      renderWorkbenchTree,
      renderActiveNodePage,
    };
  };

  window.WorkbenchRenderer = {
    compactQuestionTitle,
    makeContentPageId,
    createWorkbenchRenderer,
  };
})();
