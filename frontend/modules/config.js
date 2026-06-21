// Central configuration for the desktop shell renderer.
// Keep only stable defaults and metadata here; runtime state stays in renderer.js.
(() => {
  const assistStates = ['hidden', 'normal', 'wide'];
  const assistLabels = {
    hidden: '辅助栏：已隐藏，点击切换为正常宽度',
    normal: '辅助栏：正常宽度，点击切换为扩大',
    wide: '辅助栏：扩大宽度，点击切换为隐藏',
  };

  const providerDefaults = {
    deepseek: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
    },
    openai: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '',
    },
    qwen: {
      name: '千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      apiKey: '',
    },
  };

  const settingsGroups = {
    api: {
      name: 'API 设置',
      details: ['deepseek', 'qwen', 'openai'],
    },
    prompt: {
      name: 'Promote设置',
      details: ['mainPrompt', 'followUpPrompt', 'richPrompt'],
    },
  };

  const settingDetailMeta = {
    deepseek: { group: 'api', title: 'deepseek API', description: '配置 DeepSeek 作为学习调用栈的当前模型接口。' },
    qwen: { group: 'api', title: '千问 API', description: '配置千问兼容接口作为学习调用栈的当前模型接口。' },
    openai: { group: 'api', title: 'OpenAI AI', description: '配置 OpenAI 兼容接口作为学习调用栈的当前模型接口。' },
    mainPrompt: { group: 'prompt', title: '主问题Promote', description: '修改工作台创建 Q0 主问题时发送给 AI 的 Promote。' },
    followUpPrompt: { group: 'prompt', title: '追问Promote', description: '修改工作台创建追问节点时发送给 AI 的 Promote。' },
    richPrompt: { group: 'prompt', title: '富文本Pomote', description: '修改富文本模式追问时发送给 AI 的补充上下文 Promote。' },
  };

  const storageKey = 'ai-learning-stack-api-settings-v1';
  const promptSettingsStorageKey = 'ai-learning-stack-prompt-settings-v1';


  const legacyDefaultRichPrompt = String.raw`富文本上下文模式已开启。下面提供当前主问题树中从主问题开始产生的所有问题、追问、回答和附件摘要。请把这些内容作为补充上下文，但仍然优先回答用户本次输入的问题。

  富文本上下文：
  {{TRANSCRIPT}}

  {{CURRENT_NODE}}`;

  const defaultPromptSettings = {
    mainPrompt: String.raw`你是一个面向学习场景的答题助手。

  请只针对用户的问题本身作答。

  严格要求：
  1. 不要寒暄，不要说“你好”“很高兴为你服务”。
  2. 不要暴露或提到系统身份、学习调用栈、Q0、主问题、父问题、子问题、入栈、逻辑图等内部机制。
  3. 不要使用固定模板标题，例如“核心结论”“推理过程”“简单例子/应用”“可继续追问的位置”。
  4. 不要主动列出可追问位置，不要生成额外任务。
  5. 直接回答用户的问题，表达要清楚、严谨、适合学习者理解。
  6. 只有当自然解释确实需要时，才使用简短分段或必要的公式。
  7. 遵守下面的输出格式要求，让公式和代码能被程序稳定渲染。

  {{OUTPUT_FORMAT_REQUIREMENTS}}{{RICH_CONTEXT}}

  用户问题：
  {{QUESTION}}`,

    followUpPrompt: String.raw`你是一个面向学习场景的答题助手。

  下面只提供本次追问所必需的上下文，禁止引入其他上下文，避免上下文污染。

  父文本：
  {{PARENT_TEXT}}

  被框选内容：
  {{SELECTED_TEXT}}

  框选位置：
  {{SELECTED_POSITION}}

  子问题：
  {{CHILD_QUESTION}}

  严格要求：
  1. 只回答“子问题”本身。
  2. 必须结合“父文本”理解问题；如果有“被框选内容”，优先围绕被框选内容回答。
  3. 回答要详细、具有逻辑性，适合学习者理解。
  4. 不要寒暄，不要复述任务说明。
  5. 不要暴露或提到学习调用栈、问题编号、父问题、子问题、入栈、逻辑图等内部机制。
  6. 不要使用固定模板标题。
  7. 遵守下面的输出格式要求，让公式和代码能被程序稳定渲染。

  {{OUTPUT_FORMAT_REQUIREMENTS}}{{RICH_CONTEXT}}`,

    richPrompt: String.raw`富文本模式本身仍然是一次追问，不是新的主问题。请优先根据本次追问的父文本、被框选内容和子问题作答。

  父文本：
  {{PARENT_TEXT}}

  被框选内容：
  {{SELECTED_TEXT}}

  框选位置：
  {{SELECTED_POSITION}}

  子问题：
  {{CHILD_QUESTION}}

  下面是补充上下文：它包含当前主问题树中从主问题开始产生的所有问题、追问、回答和附件摘要。只能把它作为理解背景和避免重复解释的辅助材料，不要让它覆盖本次子问题的回答重点。

  主问题树完整上下文摘要：
  {{TRANSCRIPT}}

  {{CURRENT_NODE}}`,
  };


  window.AppConfig = {
    assistStates,
    assistLabels,
    providerDefaults,
    settingsGroups,
    settingDetailMeta,
    storageKey,
    promptSettingsStorageKey,
    legacyDefaultRichPrompt,
    defaultPromptSettings,
  };
})();
