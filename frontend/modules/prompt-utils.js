// Prompt-template helpers shared by workbench prompt builders.
(() => {
  const applyPromptTemplate = (template = '', replacements = {}) => {
    let output = String(template ?? '');
    Object.entries(replacements).forEach(([key, value]) => {
      output = output.replaceAll(`{{${key}}}`, String(value ?? ''));
    });
    return output.trim();
  };

  const appendIfTemplateMissingToken = (template = '', rendered = '', token = '', fallback = '') => {
    if (String(template).includes(`{{${token}}}`)) return rendered;
    const text = String(rendered || '').trimEnd();
    return `${text}${fallback}`.trim();
  };


  window.PromptUtils = {
    applyPromptTemplate,
    appendIfTemplateMissingToken,
  };
})();
