(() => {
  const createSelectionFingerprintController = ({
    contentStream,
    stackState,
    promptInput,
    findNode,
    syncPromptPlaceholder,
    renderActiveNodePage,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    appStore,
  } = {}) => {
    const getVisibleText = (element) => String(element?.innerText || element?.textContent || '').replace(/\r\n/g, '\n');

    const normalizeLooseSelectionText = (value = '') => String(value || '')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const getActiveQuestionId = () => appStore?.select?.('activeQuestionId', null) ?? stackState?.activeQuestionId ?? null;

    const getRenderNode = (nodeId) => {
      if (!nodeId) return null;
      return appStore?.getLearningNode?.(nodeId) || findNode?.(nodeId) || null;
    };

    const getActiveNode = () => appStore?.getActiveLearningNode?.() || getRenderNode(getActiveQuestionId());

    const getActiveSelection = () => appStore?.getLearningSelection?.() || stackState?.activeSelection || null;

    const normalizeComparableText = (value = '') => String(value || '')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n');


    const createFilteredTextWalker = (root) => document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest?.('.followup-fingerprint-box')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const getRenderedTextByWalker = (root) => {
      if (!root) return '';
      const walker = createFilteredTextWalker(root);
      let output = '';
      let current;
      while ((current = walker.nextNode())) output += current.nodeValue || '';
      return String(output || '').replace(/\r\n/g, '\n');
    };

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

    const clampRange = (start, end, length) => {
      const size = Math.max(0, Number(length) || 0);
      const safeStart = Math.max(0, Math.min(size, Number(start)));
      const safeEnd = Math.max(0, Math.min(size, Number(end)));
      return safeStart <= safeEnd ? { start: safeStart, end: safeEnd } : { start: safeEnd, end: safeStart };
    };

    const makeSelectionLocator = ({ root, range, renderRange = null, selectedText = '' } = {}) => {
      const renderedText = getRenderedTextByWalker(root);
      const start = Number(renderRange?.start);
      const end = Number(renderRange?.end);
      const safe = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
        ? clampRange(start, end, renderedText.length)
        : { start: -1, end: -1 };
      const before = safe.start >= 0 ? renderedText.slice(Math.max(0, safe.start - 180), safe.start) : '';
      const after = safe.end >= 0 ? renderedText.slice(safe.end, Math.min(renderedText.length, safe.end + 180)) : '';
      const selectedFromRender = safe.start >= 0 && safe.end > safe.start ? renderedText.slice(safe.start, safe.end) : '';
      const browserRect = (() => {
        try {
          const rect = range?.getBoundingClientRect?.();
          if (!rect || (!rect.width && !rect.height)) return null;
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        } catch (_) {
          return null;
        }
      })();
      return {
        renderStart: safe.start,
        renderEnd: safe.end,
        renderedTextLength: renderedText.length,
        selectedText: String(selectedText || ''),
        selectedFromRender,
        before,
        after,
        browserRect,
      };
    };

    const locateSelectionRangeInCanonicalText = ({ parentText = '', selectedText = '', preferredRange = null, locator = null } = {}) => {
      const parent = String(parentText || '');
      const selected = String(selectedText || '');
      const start = Number(preferredRange?.start);
      const end = Number(preferredRange?.end);
      const directMatchesPreferred = (() => {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > parent.length) return false;
        const direct = parent.slice(start, end);
        return direct === selected || normalizeLooseSelectionText(direct) === normalizeLooseSelectionText(selected);
      })();
      if (directMatchesPreferred && !locator?.before && !locator?.after) {
        return { start, end, inferred: Boolean(preferredRange?.inferred), confidence: 'direct-range' };
      }

      const needles = Array.from(new Set([
        selected,
        locator?.selectedFromRender,
        normalizeLooseSelectionText(selected),
        normalizeLooseSelectionText(locator?.selectedFromRender || ''),
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
        candidates.push({
          start: candidateStart,
          end: candidateEnd,
          inferred: method !== 'direct' && method !== 'direct-range',
          confidence: method,
          score,
          prefix,
          suffix,
        });
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
        return {
          start: best.start,
          end: best.end,
          inferred: best.confidence !== 'direct-range',
          confidence: best.confidence,
          contextScore: best.score,
        };
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

    const getCanonicalParentTextForBody = (body) => {
      if (!body) return '';
      const sourceKind = body.dataset.sourceKind || 'answer';
      const node = getRenderNode(body.dataset.nodeId || getActiveQuestionId());
      const fallback = body.dataset.rawText || getVisibleText(body);
      if (sourceKind === 'answer') {
        return String(node?.answer || node?.displayedAnswer || fallback || '');
      }
      if (sourceKind === 'question') {
        return buildQuestionParentText(node, fallback);
      }
      if (sourceKind === 'system') {
        return String(node?.systemMessage || node?.errorMessage || fallback || '');
      }
      return String(fallback || '');
    };

    const resolveSelectionRangeInParent = ({ parentText = '', selectedText = '', domRange = null, locator = null } = {}) => locateSelectionRangeInCanonicalText({
      parentText,
      selectedText,
      preferredRange: domRange,
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

    const getSelectionComparable = (selection) => {
      if (!selection) return null;
      return {
        parentId: selection.parentId || '',
        sourceKind: selection.sourceKind || '',
        selectedText: String(selection.selectedText || ''),
        start: Number(selection.start ?? -1),
        end: Number(selection.end ?? -1),
        renderStart: Number(selection.selectionRenderRange?.start ?? selection.renderStart ?? -1),
        renderEnd: Number(selection.selectionRenderRange?.end ?? selection.renderEnd ?? -1),
      };
    };

    const selectionEqual = (a, b) => {
      const left = getSelectionComparable(a);
      const right = getSelectionComparable(b);
      if (!left || !right) return left === right;
      return Object.keys(left).every((key) => Object.is(left[key], right[key]));
    };

    const setActiveQuestion = (nodeId, meta = {}) => {
      if (appStore?.setActiveQuestion) {
        appStore.setActiveQuestion(nodeId, { source: 'selection-fingerprint', ...meta });
      } else if (stackState) {
        stackState.activeQuestionId = nodeId;
      }
    };

    const getOffsetByRangeClone = (root, container, offset) => {
      if (!root || !container || !root.contains(container)) return -1;
      try {
        const probe = document.createRange();
        probe.selectNodeContents(root);
        probe.setEnd(container, offset);
        return String(probe.toString() || '').length;
      } catch (_) {
        return -1;
      }
    };

    const getOffsetByTextWalker = (root, container, offset) => {
      const walker = createFilteredTextWalker(root);
      let currentOffset = 0;
      let current;

      while ((current = walker.nextNode())) {
        const length = current.nodeValue.length;
        if (current === container) return currentOffset + offset;
        currentOffset += length;
      }

      return -1;
    };

    const findRangeBySelectedText = (root, selectedText) => {
      const needle = normalizeLooseSelectionText(selectedText);
      if (!root || !needle) return null;
      const rendered = getRenderedTextByWalker(root);
      const renderedStart = rendered.indexOf(needle);
      if (renderedStart >= 0) return { start: renderedStart, end: renderedStart + needle.length, inferred: true };
      const raw = normalizeLooseSelectionText(root.textContent || '');
      const rawStart = raw.indexOf(needle);
      if (rawStart >= 0) return { start: rawStart, end: rawStart + needle.length, inferred: true };
      return null;
    };

    const getNodeTextRange = (root, range, selectedText = '') => {
      if (!root || !range) return null;

      let start = getOffsetByTextWalker(root, range.startContainer, range.startOffset);
      let end = getOffsetByTextWalker(root, range.endContainer, range.endOffset);

      // Formula renderers such as KaTeX often place the native selection anchor
      // on wrapper elements instead of direct text nodes. The clone-range path is
      // more tolerant and keeps formula selections usable as follow-up context.
      if (start < 0) start = getOffsetByRangeClone(root, range.startContainer, range.startOffset);
      if (end < 0) end = getOffsetByRangeClone(root, range.endContainer, range.endOffset);

      if (start >= 0 && end >= 0) {
        if (start > end) [start, end] = [end, start];
        if (start !== end) return { start, end };
      }

      return findRangeBySelectedText(root, selectedText);
    };

    const findSelectableBodyFromNode = (node) => {
      if (!node) return null;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return element?.closest?.('.content-message-body') || null;
    };

    const compactSelectionText = (value = '') => normalizeLooseSelectionText(value)
      .replace(/\s+/g, '')
      .replace(/[{}\_^$`~\[\]().,，。;；:：]/g, '')
      .toLowerCase();

    const getMathSourceElement = (element) => {
      if (!element) return null;
      if (element.dataset?.mathSource) return element;
      return element.closest?.('[data-math-source]') || null;
    };

    const getIntersectingMathSourceElements = (range, root) => {
      if (!range || !root) return [];
      const candidates = Array.from(root.querySelectorAll?.('[data-math-source]') || []);
      const unique = [];
      const seen = new Set();

      candidates.forEach((element) => {
        const sourceElement = getMathSourceElement(element);
        if (!sourceElement || seen.has(sourceElement)) return;
        try {
          if (!range.intersectsNode(sourceElement)) return;
        } catch (_) {
          return;
        }
        seen.add(sourceElement);
        unique.push(sourceElement);
      });

      return unique;
    };

    const getMathSelectionTextFromRange = (range, root) => {
      const mathNodes = getIntersectingMathSourceElements(range, root)
        .map((element) => element.dataset?.mathSource || '')
        .map(normalizeLooseSelectionText)
        .filter(Boolean);

      return Array.from(new Set(mathNodes)).join(' ').trim();
    };

    const rangeIntersectsNode = (range, node) => {
      if (!range || !node) return false;
      try {
        return range.intersectsNode(node);
      } catch (_) {
        return false;
      }
    };

    const isInsideMathSource = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return Boolean(element?.closest?.('[data-math-source]'));
    };

    const getCodeBlockElement = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.('.rich-code-block code') || null;
    };

    const getInlineCodeElement = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.('.rich-inline-code') || null;
    };

    const isInsideCodeElement = (node) => Boolean(getCodeBlockElement(node) || getInlineCodeElement(node));

    const getCodeBlockLanguage = (codeElement) => {
      const block = codeElement?.closest?.('.rich-code-block');
      const label = String(block?.querySelector?.('.rich-code-head span')?.textContent || '').trim();
      const lower = label.toLowerCase();
      const map = {
        javascript: 'js',
        'react jsx': 'jsx',
        typescript: 'ts',
        'react tsx': 'tsx',
        python: 'python',
        html: 'html',
        css: 'css',
        json: 'json',
        bash: 'bash',
        shell: 'sh',
        powershell: 'powershell',
        'c++': 'cpp',
        c: 'c',
        java: 'java',
        latex: 'latex',
        code: '',
      };
      return map[lower] ?? lower.replace(/[^a-z0-9#+.-]/g, '');
    };

    const getSelectedCodeTextFromElement = (codeElement, range) => {
      if (!codeElement || !rangeIntersectsNode(range, codeElement)) return '';
      const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT);
      let output = '';
      let current;

      while ((current = walker.nextNode())) {
        if (!rangeIntersectsNode(range, current)) continue;
        output += getSelectedTextPieceFromTextNode(current, range);
      }

      if (!output) {
        try {
          const cloned = range.cloneContents();
          const scratch = document.createElement('div');
          scratch.appendChild(cloned);
          output = scratch.textContent || '';
        } catch (_) {
          output = '';
        }
      }

      return String(output || '').replace(/\r\n/g, '\n');
    };

    const isDisplayMathSourceElement = (element) => Boolean(
      element?.classList?.contains('rich-math-block')
      || element?.classList?.contains('rich-math-inline--display')
      || element?.closest?.('.rich-math-block')
    );

    const formatMathSourceForSelection = (element) => {
      const source = normalizeLooseSelectionText(element?.dataset?.mathSource || '');
      if (!source) return '';
      return isDisplayMathSourceElement(element)
        ? `\\[
${source}
\\]`
        : `\\(${source}\\)`;
    };

    const getSelectedTextPieceFromTextNode = (textNode, range) => {
      if (!textNode || !rangeIntersectsNode(range, textNode)) return '';
      const text = String(textNode.nodeValue || '');
      if (!text) return '';

      let start = 0;
      let end = text.length;

      if (range.startContainer === textNode) {
        start = Math.max(0, Math.min(text.length, range.startOffset));
      }
      if (range.endContainer === textNode) {
        end = Math.max(0, Math.min(text.length, range.endOffset));
      }

      if (start > end) [start, end] = [end, start];
      return text.slice(start, end);
    };

    const normalizeInlineTextPiece = (value = '') => String(value || '')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n ]+/g, ' ');

    const joinOrderedSelectionPieces = (pieces = []) => {
      let output = '';

      pieces.forEach((piece) => {
        const type = piece?.type || 'text';
        const rawText = String(piece?.text || '');
        if (!rawText) return;

        if (type === 'math-block') {
          const block = normalizeLooseSelectionText(rawText);
          if (!block) return;
          output = output.trimEnd();
          output += output ? `\n\n${block}\n\n` : `${block}\n\n`;
          return;
        }

        if (type === 'code-block') {
          const code = String(rawText || '').replace(/\r\n/g, '\n').replace(/\s+$/g, '');
          if (!code) return;
          const lang = String(piece?.lang || '').trim();
          output = output.trimEnd();
          output += output ? `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n` : `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
          return;
        }

        if (type === 'code-inline') {
          const code = String(rawText || '').replace(/`/g, '\\`').trim();
          if (!code) return;
          const text = `\`${code}\``;
          if (!output || /[\s（(《「『“‘]$/.test(output) || /^[）)》」』。，、；;：:！？!?.,]/.test(text)) {
            output += text;
          } else {
            output += ` ${text}`;
          }
          return;
        }

        const text = type === 'text' ? normalizeInlineTextPiece(rawText) : normalizeLooseSelectionText(rawText);
        if (!text.trim()) {
          if (output && !/\s$/.test(output)) output += ' ';
          return;
        }

        if (!output || /[\s（(《「『“‘]$/.test(output) || /^[）)》」』。，、；;：:！？!?.,]/.test(text)) {
          output += text;
        } else {
          output += ` ${text}`;
        }
      });

      return normalizeLooseSelectionText(output);
    };

    const getOrderedSelectedTextFromRange = (range, root) => {
      if (!range || !root) return '';
      const pieces = [];
      const seenMath = new Set();

      const visit = (node) => {
        if (!node || !rangeIntersectsNode(range, node)) return;

        if (node.nodeType === Node.TEXT_NODE) {
          if (node.parentElement?.closest?.('.followup-fingerprint-box')) return;
          if (isInsideMathSource(node) || isInsideCodeElement(node)) return;
          const text = getSelectedTextPieceFromTextNode(node, range);
          if (text) pieces.push({ type: 'text', text });
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node;
        if (element.closest?.('.followup-fingerprint-box')) return;

        const codeBlockElement = getCodeBlockElement(element);
        if (codeBlockElement === element) {
          const code = getSelectedCodeTextFromElement(codeBlockElement, range);
          if (code) {
            pieces.push({
              type: 'code-block',
              text: code,
              lang: getCodeBlockLanguage(codeBlockElement),
            });
          }
          return;
        }

        const inlineCodeElement = getInlineCodeElement(element);
        if (inlineCodeElement === element) {
          const code = getSelectedCodeTextFromElement(inlineCodeElement, range)
            || String(inlineCodeElement.textContent || '');
          if (code) pieces.push({ type: 'code-inline', text: code });
          return;
        }

        const mathElement = getMathSourceElement(element);
        if (mathElement === element && mathElement.dataset?.mathSource) {
          if (!seenMath.has(mathElement)) {
            seenMath.add(mathElement);
            const mathText = formatMathSourceForSelection(mathElement);
            if (mathText) {
              pieces.push({
                type: isDisplayMathSourceElement(mathElement) ? 'math-block' : 'math-inline',
                text: mathText,
              });
            }
          }
          return;
        }

        Array.from(element.childNodes || []).forEach(visit);
      };

      visit(root);
      return joinOrderedSelectionPieces(pieces);
    };

    const getClonedSelectionText = (range) => {
      try {
        const fragment = range.cloneContents();
        const scratch = document.createElement('div');
        scratch.appendChild(fragment);
        return normalizeLooseSelectionText(scratch.innerText || scratch.textContent || '');
      } catch (_) {
        return '';
      }
    };

    const getSelectedTextFromRange = (selection, range, root) => {
      // Reconstruct the selection in DOM order instead of trusting
      // selection.toString(). KaTeX formulas are rendered as many nested spans,
      // so the native selection string can collapse to "only formula" or "only
      // a formula fragment" when the user actually selected text + formula + text.
      const orderedText = getOrderedSelectedTextFromRange(range, root);
      if (orderedText) return orderedText;

      const mathText = getMathSelectionTextFromRange(range, root);
      const nativeText = normalizeLooseSelectionText(selection?.toString?.() || '');
      const clonedText = getClonedSelectionText(range);
      const visualText = nativeText || clonedText;

      if (mathText) {
        if (!visualText) return mathText;

        const compactVisual = compactSelectionText(visualText);
        const compactMath = compactSelectionText(mathText);
        const visualLooksLikeMathFragment = Boolean(
          compactVisual
          && compactMath
          && compactMath.includes(compactVisual)
        );

        if (visualLooksLikeMathFragment || visualText.length <= Math.max(mathText.length * 1.25, 18)) {
          return mathText;
        }

        return `${visualText}

完整公式：${mathText}`;
      }

      return visualText;
    };

    const clearActiveSelectionState = () => {
      if (!getActiveSelection()) {
        if (contentStream) contentStream.classList.remove('has-live-selection');
        syncPromptPlaceholder?.();
        return;
      }
      if (appStore?.clearLearningSelection) {
        appStore.clearLearningSelection({ source: 'selection-fingerprint:clear' });
      } else {
        stackState.activeSelection = null;
      }
      if (contentStream) contentStream.classList.remove('has-live-selection');
      syncPromptPlaceholder?.();
    };

    const updateActiveSelectionFromWindow = () => {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        clearActiveSelectionState();
        return;
      }

      const range = selection.getRangeAt(0);
      const startBody = findSelectableBodyFromNode(range.startContainer);
      const endBody = findSelectableBodyFromNode(range.endContainer);
      const commonBody = findSelectableBodyFromNode(range.commonAncestorContainer);
      const targetBody = startBody || endBody || commonBody;

      if (!targetBody || !contentStream?.contains(targetBody)) {
        clearActiveSelectionState();
        return;
      }

      // Keep cross-message selections out of the learning stack, but be tolerant
      // of formula selections where the browser reports only one side as a
      // nested KaTeX wrapper or an element node.
      if (startBody && endBody && startBody !== endBody) {
        clearActiveSelectionState();
        return;
      }

      const selectedText = getSelectedTextFromRange(selection, range, targetBody);
      if (!selectedText) {
        clearActiveSelectionState();
        return;
      }

      const textRange = getNodeTextRange(targetBody, range, selectedText);
      const sourceKind = targetBody.dataset.sourceKind || 'answer';
      const parentText = getCanonicalParentTextForBody(targetBody);
      const visibleParentText = getVisibleText(targetBody);
      const selectionLocator = makeSelectionLocator({
        root: targetBody,
        range,
        renderRange: textRange,
        selectedText,
      });
      const safeRange = resolveSelectionRangeInParent({
        parentText,
        selectedText,
        domRange: textRange && textRange.start !== textRange.end
          ? textRange
          : { start: -1, end: -1, inferred: true },
        locator: selectionLocator,
      });
      const selectionPositionContext = createSelectionPositionContext({
        parentText,
        selectedText,
        range: safeRange,
        sourceKind,
        locator: selectionLocator,
      });

      const nextSelection = {
        parentId: targetBody.dataset.nodeId || getActiveQuestionId(),
        sourceKind,
        parentText,
        visibleParentText,
        selectedText,
        start: safeRange.start,
        end: safeRange.end,
        inferred: Boolean(safeRange.inferred),
        selectionRenderRange: textRange && Number.isFinite(textRange.start) && Number.isFinite(textRange.end)
          ? { start: textRange.start, end: textRange.end }
          : null,
        selectionLocator,
        positionContext: selectionPositionContext,
      };
      if (!selectionEqual(getActiveSelection(), nextSelection)) {
        if (appStore?.setLearningSelection) {
          appStore.setLearningSelection(nextSelection, { source: 'selection-fingerprint:update' });
        } else {
          stackState.activeSelection = nextSelection;
        }
      }

      contentStream.classList.add('has-live-selection');
      syncPromptPlaceholder?.();
    };

    const createFingerprintBox = (dataset = {}) => {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'followup-fingerprint-box';
      Object.entries(dataset).forEach(([key, value]) => {
        if (value != null) box.dataset[key] = String(value);
      });
      box.setAttribute('aria-label', '打开这段文本对应的追问');
      return box;
    };

    const createRangeFromTextOffsets = (root, start, end) => {
      if (!root || start == null || end == null || start >= end) return null;

      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.parentElement?.closest?.('.followup-fingerprint-box')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let offset = 0;
      let current;
      let foundStart = false;
      let foundEnd = false;

      while ((current = walker.nextNode())) {
        const textLength = current.nodeValue.length;
        const nodeStart = offset;
        const nodeEnd = offset + textLength;

        if (!foundStart && start >= nodeStart && start <= nodeEnd) {
          range.setStart(current, Math.max(0, start - nodeStart));
          foundStart = true;
        }

        if (!foundEnd && end >= nodeStart && end <= nodeEnd) {
          range.setEnd(current, Math.max(0, end - nodeStart));
          foundEnd = true;
          break;
        }

        offset = nodeEnd;
      }

      return foundStart && foundEnd ? range : null;
    };

    const mergeLineRects = (rects, rootRect, padX = 5, padY = 3) => {
      const rawRects = rects
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          left: rect.left - rootRect.left,
          right: rect.right - rootRect.left,
          top: rect.top - rootRect.top,
          bottom: rect.bottom - rootRect.top,
        }))
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
        .sort((a, b) => (a.top - b.top) || (a.left - b.left));

      const lines = [];
      rawRects.forEach((rect) => {
        const centerY = (rect.top + rect.bottom) / 2;
        const line = lines.find((item) => {
          const itemCenterY = (item.top + item.bottom) / 2;
          const overlap = Math.min(item.bottom, rect.bottom) - Math.max(item.top, rect.top);
          return overlap > Math.min(item.bottom - item.top, rect.bottom - rect.top) * 0.35
            || Math.abs(centerY - itemCenterY) <= 5;
        });

        if (line) {
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
        } else {
          lines.push({ ...rect });
        }
      });

      return lines
        .map((line) => ({
          left: Math.max(0, line.left - padX),
          right: Math.min(rootRect.width, line.right + padX),
          top: Math.max(0, line.top - padY),
          bottom: Math.min(rootRect.height, line.bottom + padY),
        }))
        .filter((line) => line.right - line.left > 1 && line.bottom - line.top > 1)
        .sort((a, b) => (a.top - b.top) || (a.left - b.left));
    };

    const normalizeFingerprintLines = (lines) => {
      if (!lines.length) return [];

      return lines.map((line, index) => {
        const previous = lines[index - 1];
        const next = lines[index + 1];
        const normalized = { ...line };

        if (previous && normalized.top - previous.bottom <= 10) {
          normalized.top = Math.min(normalized.top, previous.bottom + 1);
        }
        if (next && next.top - normalized.bottom <= 10) {
          normalized.bottom = Math.max(normalized.bottom, next.top - 1);
        }

        return normalized;
      });
    };

    const buildFingerprintPath = (lines, offsetLeft, offsetTop) => {
      const localLines = normalizeFingerprintLines(lines).map((line) => ({
        left: line.left - offsetLeft,
        right: line.right - offsetLeft,
        top: line.top - offsetTop,
        bottom: line.bottom - offsetTop,
      }));

      if (!localLines.length) return '';
      if (localLines.length === 1) {
        const line = localLines[0];
        return `M ${line.left} ${line.top} L ${line.right} ${line.top} L ${line.right} ${line.bottom} L ${line.left} ${line.bottom} Z`;
      }

      const first = localLines[0];
      const commands = [`M ${first.left} ${first.top}`, `L ${first.right} ${first.top}`];

      for (let index = 0; index < localLines.length; index += 1) {
        const current = localLines[index];
        const next = localLines[index + 1];
        commands.push(`L ${current.right} ${current.bottom}`);
        if (next) {
          commands.push(`L ${next.right} ${current.bottom}`);
          commands.push(`L ${next.right} ${next.top}`);
        }
      }

      const last = localLines[localLines.length - 1];
      commands.push(`L ${last.left} ${last.bottom}`);

      for (let index = localLines.length - 1; index > 0; index -= 1) {
        const current = localLines[index];
        const previous = localLines[index - 1];
        commands.push(`L ${current.left} ${current.top}`);
        commands.push(`L ${previous.left} ${current.top}`);
        commands.push(`L ${previous.left} ${previous.bottom}`);
      }

      commands.push(`L ${first.left} ${first.top}`, 'Z');
      return commands.join(' ');
    };

    const getFingerprintGeometryFromRange = (range, root, rootRectOverride = null) => {
      if (!range || !root) return null;
      const rootRect = rootRectOverride || root.getBoundingClientRect();
      const rectList = Array.from(range.getClientRects());
      let lines = mergeLineRects(rectList, rootRect);

      if (!lines.length) {
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        lines = mergeLineRects([rect], rootRect);
      }

      if (!lines.length) return null;

      const left = Math.max(0, Math.min(...lines.map((line) => line.left)));
      const top = Math.max(0, Math.min(...lines.map((line) => line.top)));
      const right = Math.min(rootRect.width, Math.max(...lines.map((line) => line.right)));
      const bottom = Math.min(rootRect.height, Math.max(...lines.map((line) => line.bottom)));

      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      const path = buildFingerprintPath(lines, left, top);

      return { left, top, width, height, path };
    };

    const renderFingerprintShape = (box, geometry) => {
      box.replaceChildren();
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'followup-fingerprint-svg');
      svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'followup-fingerprint-shape');
      path.setAttribute('d', geometry.path);
      path.setAttribute('vector-effect', 'non-scaling-stroke');

      svg.appendChild(path);
      box.appendChild(svg);
    };

    const placeFingerprintBox = (root, start, end, dataset = {}, options = {}) => {
      if (!root || start == null || end == null || start >= end) return null;
      root.classList.add('has-fingerprint-overlays');

      const range = createRangeFromTextOffsets(root, start, end);
      const geometry = getFingerprintGeometryFromRange(range, root, options.rootRect || null);
      if (!geometry) return null;

      const box = createFingerprintBox(dataset);
      box.classList.toggle('followup-fingerprint-box--compound', geometry.path.split('M').length > 2);
      box.style.left = `${geometry.left}px`;
      box.style.top = `${geometry.top}px`;
      box.style.width = `${geometry.width}px`;
      box.style.height = `${geometry.height}px`;
      renderFingerprintShape(box, geometry);

      if (!options.deferMount) root.appendChild(box);
      return box;
    };

    const attachFingerprintHandlers = (body) => {
      body.querySelectorAll('.followup-fingerprint-box').forEach((marker) => {
        const openChild = () => {
          const childId = marker.dataset.childId;
          if (!childId || !getRenderNode(childId)) return;
          setActiveQuestion(childId, { action: 'open-fingerprint-child' });
          clearActiveSelectionState();
          window.getSelection?.()?.removeAllRanges?.();
          renderActiveNodePage?.();
          renderWorkbenchTree?.();
          renderWorkbenchGraph?.();
          syncPromptPlaceholder?.();
          window.requestAnimationFrame(() => promptInput?.focus());
        };

        marker.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openChild();
        });

        marker.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openChild();
          }
        });
      });
    };

    const applyNodeAnnotationsToBody = (body, node, sourceKind) => {
      if (!body) return;
      const annotations = (node?.annotations || [])
        .filter((item) => item.sourceKind === sourceKind && Number.isFinite(item.start) && Number.isFinite(item.end))
        .sort((a, b) => a.start - b.start);

      const existingBoxes = body.querySelectorAll('.followup-fingerprint-box');
      if (!annotations.length && !existingBoxes.length) {
        body.classList.remove('has-fingerprint-overlays');
        return;
      }
      existingBoxes.forEach((box) => box.remove());

      body.classList.toggle('has-fingerprint-overlays', annotations.length > 0);
      if (!annotations.length) return;

      // Read every Range geometry against one root rect first, then mount all
      // overlays. This keeps layout reads and DOM writes in separate phases.
      const rootRect = body.getBoundingClientRect();
      const boxes = annotations.map((item) => {
        const renderStart = Number(item.renderStart ?? item.visibleStart ?? -1);
        const renderEnd = Number(item.renderEnd ?? item.visibleEnd ?? -1);
        const hasRenderRange = Number.isFinite(renderStart) && Number.isFinite(renderEnd) && renderStart >= 0 && renderEnd > renderStart;
        const fallbackRange = hasRenderRange ? null : findRangeBySelectedText(body, item.selectedText || '');
        const start = hasRenderRange ? renderStart : Number(fallbackRange?.start ?? item.start);
        const end = hasRenderRange ? renderEnd : Number(fallbackRange?.end ?? item.end);
        return placeFingerprintBox(body, start, end, {
          childId: item.childId,
          sourceKind: item.sourceKind,
        }, { deferMount: true, rootRect });
      }).filter(Boolean);
      boxes.forEach((box) => body.appendChild(box));

      attachFingerprintHandlers(body);
    };

    const reflowVisibleFingerprintBoxes = () => {
      const node = getActiveNode();
      if (!node || !contentStream) return;
      const annotations = Array.isArray(node.annotations) ? node.annotations : [];
      if (!annotations.length && !contentStream.querySelector?.('.followup-fingerprint-box')) return;

      contentStream.querySelectorAll('.content-message-body[data-node-id]').forEach((body) => {
        const sourceKind = body.dataset.sourceKind || 'answer';
        if (!annotations.some((item) => item.sourceKind === sourceKind)
          && !body.querySelector?.('.followup-fingerprint-box')) return;
        applyNodeAnnotationsToBody(body, node, sourceKind);
      });
    };

    const fingerprintReflowTimers = new Set();
    let fingerprintReflowToken = 0;
    let fingerprintReflowFramePending = false;
    const scheduleFingerprintReflow = (delays = [0, 80, 180, 360]) => {
      const token = ++fingerprintReflowToken;
      fingerprintReflowTimers.forEach((timer) => window.clearTimeout(timer));
      fingerprintReflowTimers.clear();
      const node = getActiveNode();
      const hasAnnotations = Array.isArray(node?.annotations) && node.annotations.length > 0;
      const hasMountedBoxes = Boolean(contentStream?.querySelector?.('.followup-fingerprint-box'));
      if (!node || !contentStream || (!hasAnnotations && !hasMountedBoxes)) return;

      [...new Set(Array.isArray(delays) ? delays : [delays])].forEach((delay) => {
        const timer = window.setTimeout(() => {
          fingerprintReflowTimers.delete(timer);
          if (token !== fingerprintReflowToken || fingerprintReflowFramePending) return;
          fingerprintReflowFramePending = true;
          const run = () => {
            fingerprintReflowFramePending = false;
            if (token === fingerprintReflowToken) reflowVisibleFingerprintBoxes();
          };
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
          else window.setTimeout(run, 0);
        }, Math.max(0, Number(delay) || 0));
        fingerprintReflowTimers.add(timer);
      });
    };

    return {
      getVisibleText,
      clearActiveSelectionState,
      updateActiveSelectionFromWindow,
      applyNodeAnnotationsToBody,
      reflowVisibleFingerprintBoxes,
      scheduleFingerprintReflow,
    };
  };

  window.SelectionFingerprint = { createSelectionFingerprintController };
})();
