(function () {
  const cloneJson = (value) => JSON.parse(JSON.stringify(value));

  const loadPromptSettings = ({ promptSettingsStorageKey, defaultPromptSettings, legacyDefaultRichPrompt } = {}) => {
    try {
      const raw = window.localStorage.getItem(promptSettingsStorageKey);
      if (!raw) return cloneJson(defaultPromptSettings);
      const saved = JSON.parse(raw);
      const savedRichPrompt = String(saved.richPrompt || defaultPromptSettings.richPrompt);
      return {
        mainPrompt: String(saved.mainPrompt || defaultPromptSettings.mainPrompt),
        followUpPrompt: String(saved.followUpPrompt || defaultPromptSettings.followUpPrompt),
        richPrompt: savedRichPrompt === legacyDefaultRichPrompt ? defaultPromptSettings.richPrompt : savedRichPrompt,
      };
    } catch {
      return cloneJson(defaultPromptSettings);
    }
  };

  const savePromptSettings = (promptSettingsStorageKey, promptSettings) => {
    window.localStorage.setItem(promptSettingsStorageKey, JSON.stringify(promptSettings));
  };

  const loadApiSettings = ({ storageKey, providerDefaults } = {}) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return {
          activeProvider: 'deepseek',
          providers: cloneJson(providerDefaults),
        };
      }
      const saved = JSON.parse(raw);
      return {
        activeProvider: saved.activeProvider || 'deepseek',
        providers: {
          deepseek: { ...providerDefaults.deepseek, ...(saved.providers?.deepseek || {}) },
          openai: { ...providerDefaults.openai, ...(saved.providers?.openai || {}) },
          qwen: { ...providerDefaults.qwen, ...(saved.providers?.qwen || {}) },
        },
      };
    } catch {
      return {
        activeProvider: 'deepseek',
        providers: cloneJson(providerDefaults),
      };
    }
  };

  const saveApiSettings = (storageKey, apiSettings) => {
    window.localStorage.setItem(storageKey, JSON.stringify(apiSettings));
  };

  window.SettingsStorage = {
    loadPromptSettings,
    savePromptSettings,
    loadApiSettings,
    saveApiSettings,
  };
})();
