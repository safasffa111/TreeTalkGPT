// Runtime controller for prompt attachments, the plus menu, and rich-context mode.
(() => {
  const createAttachmentController = ({
    state,
    promptAttach,
    attachMenu,
    attachMenuFile,
    attachMenuRich,
    richContextChip,
    attachmentInput,
    attachmentTray,
    promptInput,
    syncSendState = () => {},
    attachmentUtils = window.AttachmentUtils,
    appStore,
    flushAttachmentReferences = async () => {},
    getAttachmentIdsToPreserve = () => [],
  }) => {
    const {
      formatFileSize,
      getAttachmentKind,
      readFileAsText,
      readFileAsDataUrl,
      collectImageFilesFromClipboard,
    } = attachmentUtils;

    const getLearningData = () => appStore?.select?.('learningData', null) || null;

    const getSelectedAttachments = () => {
      const fromStore = getLearningData()?.selectedAttachments;
      if (Array.isArray(fromStore)) return fromStore;
      return Array.isArray(state.selectedAttachments) ? state.selectedAttachments : [];
    };

    const isRichContextMode = () => {
      const data = getLearningData();
      return data ? Boolean(data.richContextMode) : Boolean(state.richContextMode);
    };

    const setSelectedAttachments = (attachments, meta = {}) => {
      const nextAttachments = Array.isArray(attachments) ? attachments : [];
      if (appStore?.setLearningAttachments) {
        appStore.setLearningAttachments(nextAttachments, meta);
      } else {
        state.selectedAttachments = nextAttachments;
      }
      return getSelectedAttachments();
    };

    const setRichContextMode = (enabled, meta = {}) => {
      if (appStore?.setLearningRichContextMode) {
        appStore.setLearningRichContextMode(Boolean(enabled), meta);
      } else {
        state.richContextMode = Boolean(enabled);
      }
      return isRichContextMode();
    };

    const saveAttachmentToLocalFolder = async (item, fileDataUrl = '') => {
      if (!item || !window.desktopShell?.saveAttachment) return item;
      try {
        const result = await window.desktopShell.saveAttachment({
          id: item.id,
          name: item.name,
          type: item.type,
          size: item.size,
          kind: item.kind,
          text: item.text || '',
          dataUrl: fileDataUrl || item.dataUrl || '',
        });
        if (!result?.ok) {
          console.warn('[attachment-controller] local attachment save failed:', result?.error || result);
          return { ...item, localSaveError: result?.error || '保存附件失败' };
        }
        const extractedText = String(result.extractedText || '').trim();
        return {
          ...item,
          localPath: result.filePath || '',
          localRelativePath: result.relativePath || '',
          fileUrl: result.fileUrl || '',
          savedAt: result.savedAt || new Date().toISOString(),
          storage: 'local-file',
          extractedText: extractedText || item.extractedText || '',
          extractedTextPreview: result.extractedTextPreview || (extractedText ? extractedText.slice(0, 1000) : ''),
          extractedTextPath: result.extractedTextPath || '',
          extractedTextFullPath: result.extractedTextFullPath || '',
          extractedTextRelativePath: result.extractedTextRelativePath || '',
          extractedTextFullRelativePath: result.extractedTextFullRelativePath || '',
          extractedChunksPath: result.extractedChunksPath || '',
          extractedChunksRelativePath: result.extractedChunksRelativePath || '',
          contentHash: result.contentHash || item.contentHash || '',
          extraction: result.extraction || null,
          extractionStatus: result.extractionStatus || result.extraction?.status || '',
          extractionParser: result.extractionParser || result.extraction?.parser || '',
          extractionMessage: result.extractionMessage || result.extraction?.message || '',
          extractionWarnings: result.extractionWarnings || result.extraction?.warnings || [],
          extractionHeadings: result.extractionHeadings || result.extraction?.headings || [],
          extractionChunkCount: result.extractionChunkCount || result.extraction?.chunkCount || 0,
        };
      } catch (error) {
        console.warn('[attachment-controller] local attachment save crashed:', error);
        return { ...item, localSaveError: error?.message || String(error) };
      }
    };

    const deleteRemovedLocalAttachment = async (attachmentId = '') => {
      if (!attachmentId || !window.desktopShell?.deleteAttachments) return;
      try {
        await flushAttachmentReferences();
        const preserveAttachmentIds = await getAttachmentIdsToPreserve();
        const result = await window.desktopShell.deleteAttachments({
          attachmentIds: [attachmentId],
          preserveAttachmentIds: Array.isArray(preserveAttachmentIds) ? preserveAttachmentIds : [],
        });
        if (result?.ok === false) {
          console.warn?.('[attachment-controller] local attachment deletion incomplete', result.errors || result);
        }
      } catch (error) {
        console.warn?.('[attachment-controller] local attachment deletion failed', error);
      }
    };

    const renderAttachmentTray = () => {
      if (!attachmentTray) return;
      attachmentTray.replaceChildren();
      const attachments = getSelectedAttachments();
      attachmentTray.classList.toggle('has-attachments', attachments.length > 0);
      if (!attachments.length) return;

      attachments.forEach((item) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `attachment-chip attachment-chip--${item.kind || 'file'}`;
        chip.setAttribute('aria-label', `移除附件 ${item.name}`);
        chip.dataset.attachmentId = item.id;
        if (item.kind === 'image' && item.dataUrl) {
          chip.innerHTML = `<span class="attachment-chip-preview" aria-hidden="true"><img alt="" /></span><span class="attachment-chip-name"></span><span class="attachment-chip-size"></span>`;
          chip.querySelector('img').src = item.dataUrl;
        } else {
          chip.innerHTML = `<span class="attachment-chip-icon" aria-hidden="true"></span><span class="attachment-chip-name"></span><span class="attachment-chip-size"></span>`;
        }
        chip.querySelector('.attachment-chip-name').textContent = item.name || '未命名附件';
        chip.querySelector('.attachment-chip-size').textContent = formatFileSize(item.size);
        chip.addEventListener('click', async () => {
          setSelectedAttachments(getSelectedAttachments().filter((attachment) => attachment.id !== item.id), { source: 'attachment-controller:remove' });
          renderAttachmentTray();
          syncSendState();
          await deleteRemovedLocalAttachment(item.id);
        });
        attachmentTray.appendChild(chip);
      });
    };

    const addFilesAsAttachments = async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const next = [];
      for (const file of files) {
        const kind = getAttachmentKind(file);
        const item = {
          id: `att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size || 0,
          kind,
          text: '',
          dataUrl: '',
        };

        const fileDataUrl = await readFileAsDataUrl(file);
        if (kind === 'text') {
          const text = await readFileAsText(file);
          item.text = text.length > 120000 ? `${text.slice(0, 120000)}

[文件内容过长，已截断]` : text;
        }
        if (kind === 'image') {
          item.dataUrl = fileDataUrl;
        }
        next.push(await saveAttachmentToLocalFolder(item, fileDataUrl));
      }

      setSelectedAttachments([
        ...getSelectedAttachments(),
        ...next,
      ].slice(0, 12), { source: 'attachment-controller:add' });
      renderAttachmentTray();
      syncSendState();
    };

    const consumeSelectedAttachments = () => {
      const attachments = [...getSelectedAttachments()];
      setSelectedAttachments([], { source: 'attachment-controller:consume' });
      if (attachmentInput) attachmentInput.value = '';
      renderAttachmentTray();
      syncSendState();
      return attachments;
    };

    const getWorkspaceRect = () => {
      const workspace = document.querySelector('.workspace');
      const rect = workspace?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
      return {
        left: 0,
        top: 0,
        right: window.innerWidth || document.documentElement.clientWidth || 0,
        bottom: window.innerHeight || document.documentElement.clientHeight || 0,
      };
    };

    const clampNumber = (value, min, max) => {
      if (!Number.isFinite(value)) return min;
      if (max < min) return min;
      return Math.min(Math.max(value, min), max);
    };

    const getPromptDockRect = () => {
      const promptDock = attachMenu?.closest?.('.prompt-dock') || promptAttach?.closest?.('.prompt-dock');
      const rect = promptDock?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
      return {
        left: 0,
        top: 0,
        right: window.innerWidth || document.documentElement.clientWidth || 0,
        bottom: window.innerHeight || document.documentElement.clientHeight || 0,
      };
    };

    const getPromptBoxRect = () => {
      const promptBox = promptAttach?.closest?.('.prompt-box');
      const rect = promptBox?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
      return promptAttach?.getBoundingClientRect?.() || null;
    };

    const getAttachButtonRect = () => {
      const rect = promptAttach?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
      return getPromptBoxRect();
    };

    const measureAttachMenu = () => {
      const rect = attachMenu?.getBoundingClientRect?.();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const fallbackWidth = Math.min(258, Math.max(160, viewportWidth - 32));
      const width = rect?.width || attachMenu?.offsetWidth || fallbackWidth;
      const height = rect?.height || attachMenu?.offsetHeight || attachMenu?.scrollHeight || 104;
      return { width, height };
    };

    let attachMenuPositionFrame = 0;

    const positionAttachMenu = () => {
      if (!attachMenu || !promptAttach) return;

      const workspaceRect = getWorkspaceRect();
      const promptDockRect = getPromptDockRect();
      const promptBoxRect = getPromptBoxRect();
      const attachButtonRect = getAttachButtonRect();
      if (!promptBoxRect || !attachButtonRect) return;

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || workspaceRect.right;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || workspaceRect.bottom;
      const gutter = 12;
      const verticalGap = 10;
      const menuSize = measureAttachMenu();
      const menuWidth = Math.min(menuSize.width || 258, Math.max(120, viewportWidth - gutter * 2));
      const menuHeight = menuSize.height || 104;

      // Anchor like ChatGPT: the popover appears above the prompt's plus button,
      // with its first menu icon visually aligned to the plus icon. The menu still
      // clamps to the workspace so it cannot be hidden under the left sidebar.
      const minViewportLeft = Math.max(gutter, workspaceRect.left + gutter);
      const maxViewportLeft = Math.min(
        viewportWidth - menuWidth - gutter,
        workspaceRect.right - menuWidth - gutter,
      );
      const plusIconVisualInset = 22;
      const preferredViewportLeft = attachButtonRect.left - plusIconVisualInset;
      const fallbackViewportLeft = promptBoxRect.left;
      const viewportLeft = clampNumber(
        Number.isFinite(preferredViewportLeft) ? preferredViewportLeft : fallbackViewportLeft,
        minViewportLeft,
        Math.max(minViewportLeft, maxViewportLeft),
      );

      const minViewportTop = Math.max(gutter, workspaceRect.top + gutter);
      const maxViewportTop = Math.min(
        viewportHeight - menuHeight - gutter,
        workspaceRect.bottom - menuHeight - gutter,
      );
      let preferredViewportTop = promptBoxRect.top - menuHeight - verticalGap;
      if (preferredViewportTop < minViewportTop && promptBoxRect.bottom + menuHeight + verticalGap <= workspaceRect.bottom - gutter) {
        preferredViewportTop = promptBoxRect.bottom + verticalGap;
      }
      const viewportTop = clampNumber(
        preferredViewportTop,
        minViewportTop,
        Math.max(minViewportTop, maxViewportTop),
      );

      // The menu lives inside .prompt-dock and is absolute-positioned, so convert
      // viewport coordinates back into prompt-dock local coordinates. This avoids
      // the previous fixed-position drift where viewport coords and parent coords
      // could diverge under Electron scaling / custom titlebar layouts.
      const localLeft = Math.round(viewportLeft - promptDockRect.left);
      const localTop = Math.round(viewportTop - promptDockRect.top);
      attachMenu.style.setProperty('--attach-menu-left', `${localLeft}px`);
      attachMenu.style.setProperty('--attach-menu-top', `${localTop}px`);
      attachMenu.style.left = `${localLeft}px`;
      attachMenu.style.top = `${localTop}px`;
    };

    const scheduleAttachMenuPosition = () => {
      if (!attachMenu || attachMenu.hidden || attachMenuPositionFrame) return;
      attachMenuPositionFrame = window.requestAnimationFrame(() => {
        attachMenuPositionFrame = 0;
        positionAttachMenu();
      });
    };

    const setAttachMenuOpen = (open) => {
      if (!attachMenu || !promptAttach) return;
      const nextOpen = Boolean(open);
      if (nextOpen) {
        attachMenu.hidden = false;
        positionAttachMenu();
        window.requestAnimationFrame(positionAttachMenu);
      }
      attachMenu.classList.toggle('is-open', nextOpen);
      attachMenu.hidden = !nextOpen;
      promptAttach.setAttribute('aria-expanded', String(nextOpen));
      promptAttach.classList.toggle('is-open', nextOpen);
    };

    const syncRichContextUi = () => {
      if (richContextChip) {
        const richContextMode = isRichContextMode();
        richContextChip.hidden = !richContextMode;
        richContextChip.classList.toggle('is-active', richContextMode);
      }
      if (attachMenuRich) {
        const richContextMode = isRichContextMode();
        attachMenuRich.classList.toggle('is-active', richContextMode);
        attachMenuRich.setAttribute('aria-pressed', String(richContextMode));
      }
    };

    const toggleRichContextMode = (next = !isRichContextMode()) => {
      setRichContextMode(Boolean(next), { source: 'attachment-controller:rich-context' });
      syncRichContextUi();
    };

    const hasPromptPayload = () => {
      const hasText = Boolean(promptInput?.value?.trim());
      const hasAttachments = Boolean(getSelectedAttachments().length);
      return hasText || hasAttachments;
    };

    const getPromptQuestionText = () => {
      const value = promptInput?.value?.trim() || '';
      if (value) return value;
      const attachments = getSelectedAttachments();
      if (attachments.length) {
        return attachments.length === 1
          ? `请分析这个附件：${attachments[0].name || '未命名附件'}`
          : `请分析这 ${attachments.length} 个附件。`;
      }
      return '';
    };

    const handlePasteImages = async (event) => {
      const imageFiles = collectImageFilesFromClipboard(event.clipboardData);
      if (!imageFiles.length) return false;
      event.preventDefault();
      await addFilesAsAttachments(imageFiles);
      return true;
    };

    const attachEvents = () => {
      if (!promptAttach || !attachmentInput) return;

      promptAttach.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAttachMenuOpen(attachMenu?.hidden !== false);
      });

      attachMenuFile?.addEventListener('click', () => {
        setAttachMenuOpen(false);
        attachmentInput.click();
      });

      attachMenuRich?.addEventListener('click', () => {
        toggleRichContextMode();
        setAttachMenuOpen(false);
        window.requestAnimationFrame(() => promptInput?.focus());
      });

      richContextChip?.addEventListener('click', () => {
        toggleRichContextMode(false);
        window.requestAnimationFrame(() => promptInput?.focus());
      });

      attachmentInput.addEventListener('change', async () => {
        await addFilesAsAttachments(attachmentInput.files);
      });

      document.addEventListener('pointerdown', (event) => {
        if (attachMenu?.hidden !== false) return;
        if (attachMenu.contains(event.target) || promptAttach?.contains(event.target)) return;
        setAttachMenuOpen(false);
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setAttachMenuOpen(false);
      });

      window.addEventListener('resize', scheduleAttachMenuPosition);
      document.addEventListener('scroll', scheduleAttachMenuPosition, true);
    };

    syncRichContextUi();

    return {
      renderAttachmentTray,
      addFilesAsAttachments,
      consumeSelectedAttachments,
      setAttachMenuOpen,
      syncRichContextUi,
      toggleRichContextMode,
      hasPromptPayload,
      getPromptQuestionText,
      handlePasteImages,
      attachEvents,
    };
  };

  window.AttachmentController = {
    createAttachmentController,
  };
})();
