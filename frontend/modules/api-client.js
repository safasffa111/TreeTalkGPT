(function () {
  const getActiveApiConfig = (apiSettings, providerDefaults) => {
    const provider = apiSettings?.activeProvider || 'deepseek';
    const config = apiSettings?.providers?.[provider] || providerDefaults?.[provider] || {};
    return {
      provider,
      providerName: providerDefaults?.[provider]?.name || provider,
      apiKey: String(config.apiKey || '').trim(),
      baseUrl: String(config.baseUrl || '').trim(),
      model: String(config.model || '').trim(),
    };
  };

  const requestChat = async ({ config, content, temperature = 0.35 } = {}) => {
    if (!window.desktopShell?.aiChat) {
      throw new Error('desktopShell.aiChat 不可用');
    }

    return window.desktopShell.aiChat({
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      temperature,
    });
  };

  window.ApiClient = {
    getActiveApiConfig,
    requestChat,
  };
}());
