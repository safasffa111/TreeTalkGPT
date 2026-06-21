// Knowledge warehouse full-text search for the wide (1.5x) assist panel.
(() => {
  const normalizeSearchValue = (value = '') => {
    const text = String(value || '');
    try {
      return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    } catch (_) {
      return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    }
  };

  const compactText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

  const pushSearchPart = (parts, source, value, weight = 1) => {
    const text = String(value || '').trim();
    if (!text) return;
    parts.push({ source, text, normalized: normalizeSearchValue(text), weight });
  };

  const collectFileSearchParts = (file = {}) => {
    const parts = [];
    pushSearchPart(parts, '文件名', file.name, 120);
    pushSearchPart(parts, '文件正文', file.text, 90);
    pushSearchPart(parts, '文件标题', file.session?.metadata?.title, 85);

    const nodes = Array.isArray(file.session?.learning?.nodes) ? file.session.learning.nodes : [];
    nodes.forEach((node) => {
      pushSearchPart(parts, '问题', node?.question, 72);
      pushSearchPart(parts, '回答', node?.answer || node?.displayedAnswer, 64);
      pushSearchPart(parts, '框选文本', node?.selectedTextContext, 52);
      pushSearchPart(parts, '父文本', node?.parentTextContext, 34);
      (Array.isArray(node?.attachments) ? node.attachments : []).forEach((attachment) => {
        pushSearchPart(parts, '附件名', attachment?.name || attachment?.filename, 46);
        pushSearchPart(parts, '附件文本', attachment?.extractedText || attachment?.parsedText || attachment?.text, 44);
      });
    });

    const messages = Array.isArray(file.session?.learning?.messages) ? file.session.learning.messages : [];
    messages.forEach((message) => pushSearchPart(parts, '会话文本', message?.content, 28));
    return parts;
  };

  const makeExcerpt = (part = {}, terms = []) => {
    const text = compactText(part.text);
    if (!text) return '';
    const normalized = normalizeSearchValue(text);
    const needle = terms.find((term) => normalized.includes(term)) || terms[0] || '';
    const index = needle ? normalized.indexOf(needle) : 0;
    const start = Math.max(0, index - 42);
    const end = Math.min(text.length, Math.max(index + needle.length + 66, start + 108));
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  };

  const makeKnowledgeSearchIndexSignature = (store = {}) => (Array.isArray(store?.items) ? store.items : [])
    .filter((item) => item?.type === 'file')
    .map((file) => `${file.id || ''}:${file.updatedAt || file.createdAt || ''}:${file.name || ''}`)
    .join('|');

  const createKnowledgeSearchIndex = (store = {}) => {
    const files = (Array.isArray(store?.items) ? store.items : []).filter((item) => item?.type === 'file');
    return {
      signature: makeKnowledgeSearchIndexSignature(store),
      entries: files.map((file) => {
        const parts = collectFileSearchParts(file);
        return {
          file,
          parts,
          combined: parts.map((part) => part.normalized).join('\n'),
          normalizedName: normalizeSearchValue(file.name),
        };
      }),
    };
  };

  const searchKnowledgeFiles = (store = {}, rawQuery = '', searchIndex = null) => {
    const query = normalizeSearchValue(rawQuery);
    if (!query) return [];
    const terms = [...new Set(query.split(' ').filter(Boolean))];
    const index = searchIndex?.entries ? searchIndex : createKnowledgeSearchIndex(store);

    return index.entries.map((entry) => {
      const { file, parts, combined, normalizedName } = entry;
      if (!terms.every((term) => combined.includes(term))) return null;

      const exactPart = parts.find((part) => part.normalized.includes(query));
      const bestPart = exactPart || parts
        .filter((part) => terms.some((term) => part.normalized.includes(term)))
        .sort((a, b) => b.weight - a.weight)[0] || parts[0];
      const matchedTerms = terms.filter((term) => bestPart?.normalized?.includes(term)).length;
      const nameMatch = normalizedName.includes(query);
      const score = Number(bestPart?.weight || 0) + matchedTerms * 8 + (exactPart ? 24 : 0) + (nameMatch ? 80 : 0);
      return {
        id: file.id,
        name: file.name || '未命名文件',
        source: bestPart?.source || '文件内容',
        excerpt: makeExcerpt(bestPart, terms),
        score,
        updatedAt: file.updatedAt || file.createdAt || '',
      };
    }).filter(Boolean).sort((a, b) => (
      (b.score - a.score)
      || String(b.updatedAt).localeCompare(String(a.updatedAt))
      || String(a.name).localeCompare(String(b.name), 'zh-CN')
    ));
  };

  const createKnowledgeSearchController = ({
    shell,
    panel = document.querySelector('.assist-knowledge-search'),
    input = panel?.querySelector?.('.knowledge-search-input') || null,
    clearButton = panel?.querySelector?.('.knowledge-search-clear') || null,
    status = panel?.querySelector?.('.knowledge-search-status') || null,
    results = panel?.querySelector?.('.knowledge-search-results') || null,
    getStore,
    getMapController,
    openFile,
  } = {}) => {
    let query = '';
    let matches = [];
    let searchTimer = 0;
    let attached = false;
    let cachedSearchIndex = null;
    let lastSearchKey = '';

    const openMatch = (match) => {
      if (!match?.id) return;
      openFile?.(match.id, { source: 'knowledge-search', animateMapTransition: true });
    };

    const renderResults = () => {
      if (panel) {
        panel.dataset.searchState = query ? (matches.length ? 'matched' : 'empty') : 'idle';
        panel.dataset.matchCount = String(matches.length);
      }
      if (shell) {
        shell.dataset.knowledgeSearchActive = query ? 'true' : 'false';
        shell.dataset.knowledgeSearchMatches = String(matches.length);
      }
      if (clearButton) {
        clearButton.disabled = !query;
        clearButton.setAttribute('aria-hidden', query ? 'false' : 'true');
      }
      if (status) {
        status.textContent = !query
          ? '搜索文件名、正文、问答和附件文本'
          : (matches.length ? `找到 ${matches.length} 个相关文件` : `没有文件包含“${query}”`);
      }
      if (!results) return;
      results.replaceChildren();
      if (!query) {
        const hint = document.createElement('div');
        hint.className = 'knowledge-search-empty';
        hint.textContent = '输入关键词后，地图中对应的文件点会变红。';
        results.appendChild(hint);
        return;
      }
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'knowledge-search-empty';
        empty.textContent = '换一个关键词试试，搜索不会修改文件内容。';
        results.appendChild(empty);
        return;
      }
      matches.slice(0, 80).forEach((match, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'knowledge-search-result';
        button.dataset.knowledgeFileId = match.id;
        const dot = document.createElement('span');
        dot.className = 'knowledge-search-result-dot';
        dot.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        copy.className = 'knowledge-search-result-copy';
        const title = document.createElement('span');
        title.className = 'knowledge-search-result-title';
        title.textContent = match.name;
        const excerpt = document.createElement('span');
        excerpt.className = 'knowledge-search-result-excerpt';
        excerpt.textContent = `${match.source} · ${match.excerpt || '找到匹配文本'}`;
        copy.append(title, excerpt);
        button.append(dot, copy);
        button.setAttribute('aria-label', `打开匹配文件：${match.name}`);
        button.addEventListener('click', () => openMatch(match));
        button.style.setProperty('--search-result-index', String(Math.min(index, 10)));
        results.appendChild(button);
      });
    };

    const applySearch = ({ force = false, rebuildIndex = false } = {}) => {
      window.clearTimeout(searchTimer);
      searchTimer = 0;
      query = normalizeSearchValue(input?.value || query);
      const store = getStore?.() || {};
      const signature = makeKnowledgeSearchIndexSignature(store);
      if (!query) {
        const emptySearchKey = `${signature}\u0000`;
        if (!force && emptySearchKey === lastSearchKey) return matches.slice();
        lastSearchKey = emptySearchKey;
        matches = [];
        getMapController?.()?.setSearchMatches?.([], { query: '' });
        renderResults();
        return [];
      }
      if (rebuildIndex || !cachedSearchIndex || cachedSearchIndex.signature !== signature) {
        cachedSearchIndex = createKnowledgeSearchIndex(store);
      }
      const searchKey = `${cachedSearchIndex.signature}\u0000${query}`;
      if (!force && searchKey === lastSearchKey) return matches.slice();
      lastSearchKey = searchKey;
      matches = searchKnowledgeFiles(store, query, cachedSearchIndex);
      getMapController?.()?.setSearchMatches?.(matches.map((match) => match.id), { query });
      renderResults();
      return matches.slice();
    };

    const scheduleSearch = (delay = 120) => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(applySearch, delay);
    };

    const clear = ({ focus = false } = {}) => {
      if (input) input.value = '';
      query = '';
      matches = [];
      lastSearchKey = '';
      getMapController?.()?.setSearchMatches?.([], { query: '' });
      renderResults();
      if (focus) input?.focus?.();
    };

    const attachEvents = () => {
      if (attached) return;
      attached = true;
      input?.addEventListener?.('input', () => scheduleSearch());
      input?.addEventListener?.('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          clear({ focus: true });
        } else if (event.key === 'Enter' && matches[0]) {
          event.preventDefault();
          openMatch(matches[0]);
        }
      });
      clearButton?.addEventListener?.('click', () => clear({ focus: true }));
      renderResults();
    };

    return {
      attachEvents,
      refresh: () => applySearch(),
      clear,
      getQuery: () => query,
      getMatches: () => matches.slice(),
      setQuery: (value = '') => {
        if (input) input.value = String(value || '');
        query = String(value || '');
        return applySearch();
      },
    };
  };

  window.KnowledgeSearch = {
    normalizeSearchValue,
    collectFileSearchParts,
    makeKnowledgeSearchIndexSignature,
    createKnowledgeSearchIndex,
    searchKnowledgeFiles,
    createKnowledgeSearchController,
  };
})();
