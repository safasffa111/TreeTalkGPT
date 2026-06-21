(function () {
  const createSettingsController = ({
    shell,
    apiSettingButton,
    promptSettingButton,
    settingsDetailGroupTitle,
    settingsDetailButtons = [],
    settingsDetailTitle,
    settingsDetailDescription,
    apiCards = [],
    apiUseButtons = [],
    settingsPlaceholderTitle,
    settingsPlaceholderDescription,
    settingsContent,
    promptDetailTitle,
    promptDetailDescription,
    promptDisplay,
    promptEditor,
    promptEditButton,
    promptResetButton,
    config,
    storage,
    appStore,
    callbacks = {},
  } = {}) => {
    const {
      providerDefaults = {},
      settingsGroups = {},
      settingDetailMeta = {},
      storageKey = 'desktopShell.apiSettings',
      promptSettingsStorageKey = 'desktopShell.promptSettings',
      legacyDefaultRichPrompt = '',
      defaultPromptSettings = {},
    } = config || {};

    let apiSettings = storage.loadApiSettings({ storageKey, providerDefaults });
    let promptSettings = storage.loadPromptSettings({
      promptSettingsStorageKey,
      defaultPromptSettings,
      legacyDefaultRichPrompt,
    });
    let promptEditState = { detail: '', editing: false };
    let settingsContentEnterTimer = 0;
    let settingsContentTransitionTimer = 0;
    let settingsContentTransitionToken = 0;
    const settingsContentLeaveDuration = 220;

    const requestModuleSync = () => callbacks.requestModuleSync?.();
    const requestToggleSync = () => callbacks.requestToggleSync?.();
    const requestModuleSwitch = (module, options) => callbacks.switchModule?.(module, options);

    const savePromptSettings = () => {
      storage.savePromptSettings(promptSettingsStorageKey, promptSettings);
    };

    const saveApiSettings = () => {
      storage.saveApiSettings(storageKey, apiSettings);
    };

    const getApiSettings = () => apiSettings;

    const getPromptSettings = () => promptSettings;

    const getPromptSettingValue = (detail) => promptSettings[detail] ?? defaultPromptSettings[detail] ?? '';

    const syncCentralStore = (meta = {}) => {
      if (!appStore || !shell) return;
      appStore.syncApiFromSettings?.(apiSettings);
      appStore.setSettings?.({
        selectedSection: shell.dataset.settingsSection || 'root',
        selectedGroup: shell.dataset.settingsGroup || '',
        selectedDetail: shell.dataset.settingsDetail || '',
        promptEditing: Boolean(promptEditState.editing),
        promptEditDetail: promptEditState.detail || '',
      }, { source: 'settings-controller', ...meta });
      appStore.setAnimation?.({
        settingsContentTransition: shell.dataset.settingsContentTransition || '',
      }, { source: 'settings-controller', ...meta });
    };

    const clearSettingsContentTimers = () => {
      window.clearTimeout(settingsContentEnterTimer);
      window.clearTimeout(settingsContentTransitionTimer);
    };

    const getVisibleSettingsPanel = () => {
      if (!shell || !settingsContent || shell.dataset.module !== 'settings') return null;
      const detail = shell.dataset.settingsDetail || '';
      const meta = settingDetailMeta[detail] || null;
      if (!meta?.group) return null;
      return settingsContent.querySelector(`.settings-detail-panel[data-settings-panel="${meta.group}"]`);
    };

    const clearSettingsContentGhosts = () => {
      if (!settingsContent) return;
      settingsContent.querySelectorAll('.settings-fade-ghost').forEach((ghost) => ghost.remove());
    };

    const fadeOutSettingsContent = ({ keepExistingGhosts = false } = {}) => {
      const panel = getVisibleSettingsPanel();
      if (!panel || !settingsContent) return false;

      const contentRect = settingsContent.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (!panelRect.width || !panelRect.height) return false;

      if (!keepExistingGhosts) clearSettingsContentGhosts();

      const ghost = panel.cloneNode(true);
      ghost.classList.remove('is-settings-entering');
      ghost.classList.add('settings-fade-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('input, textarea, button, select').forEach((control) => {
        control.setAttribute('tabindex', '-1');
        control.setAttribute('disabled', 'disabled');
      });

      const detail = shell.dataset.settingsDetail || '';
      const meta = settingDetailMeta[detail] || null;
      if (meta?.group === 'api') {
        ghost.querySelectorAll('.api-card').forEach((card) => {
          if (card.dataset.provider !== detail) {
            card.classList.add('is-ghost-hidden');
          } else {
            card.classList.remove('is-ghost-hidden');
          }
        });
      }

      ghost.style.left = `${panelRect.left - contentRect.left + settingsContent.scrollLeft}px`;
      ghost.style.top = `${panelRect.top - contentRect.top + settingsContent.scrollTop}px`;
      ghost.style.width = `${panelRect.width}px`;
      ghost.style.minHeight = `${panelRect.height}px`;
      settingsContent.appendChild(ghost);

      window.setTimeout(() => ghost.remove(), settingsContentLeaveDuration + 80);
      return true;
    };

    const animateSettingsContentEnter = () => {
      const panel = getVisibleSettingsPanel();
      if (!panel) return;
      window.clearTimeout(settingsContentEnterTimer);
      panel.classList.remove('is-settings-entering');
      void panel.offsetWidth;
      panel.classList.add('is-settings-entering');
      settingsContentEnterTimer = window.setTimeout(() => {
        panel.classList.remove('is-settings-entering');
      }, 340);
    };

    const beginSettingsContentSwitch = (applyNext, { animateEnter = true } = {}) => {
      if (!shell) return;

      clearSettingsContentTimers();
      settingsContentTransitionToken += 1;
      const token = settingsContentTransitionToken;
      const hadOutgoingContent = fadeOutSettingsContent();

      shell.dataset.settingsContentTransition = hadOutgoingContent ? 'switching' : 'entering';

      const apply = () => {
        if (token !== settingsContentTransitionToken) return;
        shell.dataset.settingsContentTransition = animateEnter ? 'entering' : 'idle';
        applyNext?.();
        requestToggleSync();
        requestModuleSync();

        if (animateEnter) {
          animateSettingsContentEnter();
        }

        settingsContentTransitionTimer = window.setTimeout(() => {
          if (token !== settingsContentTransitionToken) return;
          delete shell.dataset.settingsContentTransition;
        }, animateEnter ? 340 : 20);
      };

      if (hadOutgoingContent) {
        shell.dataset.settingsContentTransition = 'leaving';
        requestToggleSync();
        requestModuleSync();
        settingsContentTransitionTimer = window.setTimeout(apply, settingsContentLeaveDuration);
      } else {
        apply();
      }
    };

    const clearSettingsContentWithFade = (applyClear) => {
      if (!shell) return;

      clearSettingsContentTimers();
      settingsContentTransitionToken += 1;
      const token = settingsContentTransitionToken;
      const hadOutgoingContent = fadeOutSettingsContent();

      applyClear?.();
      shell.dataset.settingsContentTransition = hadOutgoingContent ? 'clearing' : 'idle';
      requestToggleSync();
      requestModuleSync();

      settingsContentTransitionTimer = window.setTimeout(() => {
        if (token !== settingsContentTransitionToken) return;
        delete shell.dataset.settingsContentTransition;
      }, hadOutgoingContent ? settingsContentLeaveDuration + 40 : 20);
    };

    const resetSettingsSelection = ({ fadeOut = false } = {}) => {
      if (!shell) return;
      const applyReset = () => {
        shell.dataset.settingsSection = 'root';
        shell.dataset.settingsGroup = '';
        shell.dataset.settingsDetail = '';
        promptEditState = { detail: '', editing: false };
      };

      if (fadeOut) {
        clearSettingsContentWithFade(applyReset);
        return;
      }

      settingsContentTransitionToken += 1;
      clearSettingsContentTimers();
      clearSettingsContentGhosts();
      delete shell.dataset.settingsContentTransition;
      applyReset();
    };

    const openSettingsRoot = () => {
      if (!shell) return;
      clearSettingsContentWithFade(() => {
        shell.dataset.assist = 'normal';
        shell.dataset.settingsSection = 'root';
        shell.dataset.settingsGroup = '';
        shell.dataset.settingsDetail = '';
        promptEditState = { detail: '', editing: false };
      });
    };

    const openSettingsGroup = (group = 'api') => {
      if (!shell) return;
      clearSettingsContentWithFade(() => {
        shell.dataset.assist = 'wide';
        shell.dataset.settingsSection = group;
        shell.dataset.settingsGroup = group;
        shell.dataset.settingsDetail = '';
        promptEditState = { detail: '', editing: false };
      });
    };

    const selectSettingsDetail = (detail) => {
      if (!shell || !detail) return;
      const meta = settingDetailMeta[detail] || null;
      const group = meta?.group || shell.dataset.settingsGroup || 'api';

      beginSettingsContentSwitch(() => {
        shell.dataset.assist = 'wide';
        shell.dataset.settingsSection = group;
        shell.dataset.settingsGroup = group;
        shell.dataset.settingsDetail = detail;
      });
    };

    const ensureSettingsWideDetail = () => {
      if (!shell || shell.dataset.module !== 'settings') return;
      if (shell.dataset.assist !== 'wide') return;
      if (!shell.dataset.settingsGroup && shell.dataset.settingsSection && shell.dataset.settingsSection !== 'root') {
        shell.dataset.settingsGroup = shell.dataset.settingsSection;
      }
    };

    const toggleSettingsGroup = (group = 'api') => {
      if (!shell) return;

      if (shell.dataset.module !== 'settings') {
        shell.dataset.assist = 'wide';
        resetSettingsSelection();
        requestModuleSwitch('settings', { settingsSection: group, settingsGroup: group, settingsDetail: '' });
        return;
      }

      const isCurrentGroup = shell.dataset.settingsGroup === group || shell.dataset.settingsSection === group;
      if (isCurrentGroup) {
        openSettingsRoot();
        return;
      }

      openSettingsGroup(group);
    };

    const toggleSettingsDetail = (detail, buttonGroup = 'api') => {
      if (!shell || !detail) return;

      if (shell.dataset.module !== 'settings') {
        shell.dataset.assist = 'wide';
        requestModuleSwitch('settings', { settingsSection: buttonGroup, settingsGroup: buttonGroup, settingsDetail: detail });
        window.setTimeout(animateSettingsContentEnter, 40);
        return;
      }

      if (shell.dataset.settingsDetail === detail) {
        clearSettingsContentWithFade(() => {
          shell.dataset.assist = 'wide';
          shell.dataset.settingsGroup = buttonGroup;
          shell.dataset.settingsSection = buttonGroup;
          shell.dataset.settingsDetail = '';
          promptEditState = { detail: '', editing: false };
        });
        return;
      }

      shell.dataset.assist = 'wide';
      shell.dataset.settingsGroup = buttonGroup;
      shell.dataset.settingsSection = buttonGroup;
      selectSettingsDetail(detail);
    };

    const syncApiCards = () => {
      if (!shell) return;
      shell.dataset.apiProvider = apiSettings.activeProvider;

      apiCards.forEach((card) => {
        const provider = card.dataset.provider;
        const isActive = provider === apiSettings.activeProvider;
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', String(isActive));

        const status = card.querySelector('.api-status');
        if (status) status.textContent = isActive ? '当前使用' : '未使用';

        const useButton = card.querySelector('.api-use-button');
        if (useButton) {
          useButton.classList.toggle('is-active', isActive);
          useButton.textContent = isActive ? '正在使用此 API' : '使用此 API';
          useButton.setAttribute('aria-pressed', String(isActive));
        }

        const providerSettings = apiSettings.providers[provider];
        card.querySelectorAll('[data-api-field]').forEach((input) => {
          const field = input.dataset.apiField;
          if (document.activeElement !== input) {
            input.value = providerSettings?.[field] ?? '';
          }
        });
      });
    };

    const setPromptEditorEditing = (editing) => {
      const detail = shell?.dataset.settingsDetail || '';
      promptEditState = { detail, editing: Boolean(editing) };
      syncPromptSettingsPanel();
    };

    const syncPromptSettingsPanel = () => {
      if (!shell) return;
      const detail = shell.dataset.settingsDetail || '';
      const meta = settingDetailMeta[detail] || null;
      const isPromptDetail = meta?.group === 'prompt';

      if (!isPromptDetail) {
        promptEditState.editing = false;
        if (promptEditor) promptEditor.hidden = true;
        if (promptDisplay) promptDisplay.hidden = false;
        if (promptEditButton) promptEditButton.textContent = '编辑';
        return;
      }

      if (promptEditState.detail !== detail) {
        promptEditState = { detail, editing: false };
      }

      const value = getPromptSettingValue(detail);
      if (promptDetailTitle) promptDetailTitle.textContent = meta.title || '';
      if (promptDetailDescription) promptDetailDescription.textContent = meta.description || '';

      if (promptDisplay) {
        promptDisplay.hidden = promptEditState.editing;
        promptDisplay.textContent = value;
      }

      if (promptEditor) {
        promptEditor.hidden = !promptEditState.editing;
        if (document.activeElement !== promptEditor || promptEditor.dataset.promptDetail !== detail) {
          promptEditor.value = value;
          promptEditor.dataset.promptDetail = detail;
        }
      }

      if (promptEditButton) {
        promptEditButton.textContent = promptEditState.editing ? '保存' : '编辑';
      }
    };

    const syncSettingsView = () => {
      if (!shell) return;
      const settingsOpen = shell.dataset.module === 'settings';
      const section = shell.dataset.settingsSection || 'root';
      const group = shell.dataset.settingsGroup || '';
      const detail = shell.dataset.settingsDetail || '';

      if (apiSettingButton) {
        const apiActive = settingsOpen && (section === 'api' || group === 'api');
        apiSettingButton.classList.toggle('is-active', apiActive);
        apiSettingButton.setAttribute('aria-pressed', String(apiActive));
      }

      if (promptSettingButton) {
        const promptActive = settingsOpen && (section === 'prompt' || group === 'prompt');
        promptSettingButton.classList.toggle('is-active', promptActive);
        promptSettingButton.setAttribute('aria-pressed', String(promptActive));
      }

      if (settingsDetailGroupTitle) {
        settingsDetailGroupTitle.textContent = settingsGroups[group]?.name || '设置';
      }

      settingsDetailButtons.forEach((button) => {
        const buttonGroup = button.dataset.settingsGroup || 'api';
        const isActive = settingsOpen && buttonGroup === group && button.dataset.settingsDetail === detail;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });

      const meta = settingDetailMeta[detail] || null;
      if (settingsDetailTitle) settingsDetailTitle.textContent = meta?.group === 'api' ? meta.title : '';
      if (settingsDetailDescription) settingsDetailDescription.textContent = meta?.group === 'api' ? meta.description : '';

      if (settingsPlaceholderTitle) {
        if (group === 'api' && !detail) settingsPlaceholderTitle.textContent = '选择一个 API 项目';
        else if (group === 'prompt' && !detail) settingsPlaceholderTitle.textContent = '选择一个 Promote 项目';
        else settingsPlaceholderTitle.textContent = '选择一个设置项';
      }

      if (settingsPlaceholderDescription) {
        if (group === 'api' && !detail) {
          settingsPlaceholderDescription.textContent = '请在左侧 1.5 倍辅助栏选择 deepseek API、千问 API 或 OpenAI AI，内容栏才会展示对应配置。';
        } else if (group === 'prompt' && !detail) {
          settingsPlaceholderDescription.textContent = '请在左侧 1.5 倍辅助栏选择主问题Promote、追问Promote或富文本Pomote，内容栏才会展示对应 Promote。';
        } else {
          settingsPlaceholderDescription.textContent = '在左侧原尺寸辅助栏点击设置项目后，会进入 1.5 倍尺寸辅助栏；再选择具体项目，内容栏会显示对应配置。';
        }
      }

      syncPromptSettingsPanel();
    };

    const sync = () => {
      syncApiCards();
      syncSettingsView();
      syncCentralStore({ source: 'settings-controller:sync' });
    };

    const bindEvents = () => {
      apiSettingButton?.addEventListener('click', () => toggleSettingsGroup('api'));
      promptSettingButton?.addEventListener('click', () => toggleSettingsGroup('prompt'));

      settingsDetailButtons.forEach((button) => {
        const detail = button.dataset.settingsDetail;
        const buttonGroup = button.dataset.settingsGroup || 'api';
        button.addEventListener('click', () => toggleSettingsDetail(detail, buttonGroup));
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleSettingsDetail(detail, buttonGroup);
          }
        });
      });

      apiCards.forEach((card) => {
        card.querySelectorAll('[data-api-field]').forEach((input) => {
          input.addEventListener('input', () => {
            const provider = card.dataset.provider;
            const field = input.dataset.apiField;
            if (!provider || !field) return;
            apiSettings.providers[provider][field] = input.value;
            saveApiSettings();
            syncApiCards();
            syncCentralStore({ source: 'settings-controller:api-input' });
          });
        });
      });

      apiUseButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const card = button.closest('.api-card');
          const provider = card?.dataset.provider;
          if (!provider) return;
          apiSettings.activeProvider = provider;
          saveApiSettings();
          syncCentralStore({ source: 'settings-controller:api-use' });
          requestModuleSync();
        });
      });

      promptEditButton?.addEventListener('click', () => {
        const detail = shell?.dataset.settingsDetail || '';
        if (!detail || settingDetailMeta[detail]?.group !== 'prompt') return;

        if (!promptEditState.editing) {
          setPromptEditorEditing(true);
          window.requestAnimationFrame(() => {
            promptEditor?.focus();
            promptEditor?.setSelectionRange?.(promptEditor.value.length, promptEditor.value.length);
          });
          return;
        }

        promptSettings[detail] = String(promptEditor?.value ?? '');
        savePromptSettings();
        setPromptEditorEditing(false);
        syncCentralStore({ source: 'settings-controller:prompt-save' });
      });

      promptResetButton?.addEventListener('click', () => {
        const detail = shell?.dataset.settingsDetail || '';
        if (!detail || settingDetailMeta[detail]?.group !== 'prompt') return;
        promptSettings[detail] = defaultPromptSettings[detail] || '';
        savePromptSettings();
        promptEditState = { detail, editing: false };
        syncCentralStore({ source: 'settings-controller:prompt-reset' });
        requestModuleSync();
      });
    };

    bindEvents();

    return {
      getApiSettings,
      getPromptSettings,
      getPromptSettingValue,
      resetSettingsSelection,
      ensureSettingsWideDetail,
      animateSettingsContentEnter,
      syncApiCards,
      syncSettingsView,
      sync,
    };
  };

  window.SettingsController = { createSettingsController };
})();
