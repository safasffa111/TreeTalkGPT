// Workbench prompt construction: main question, follow-up, rich-context transcript.
(() => {
  const outputFormatRequirements = String.raw`输出格式要求：
1. 使用标准 Markdown 输出，便于程序渲染。
2. 代码必须使用三反引号代码块，并标注语言，例如：\`\`\`js、\`\`\`python、\`\`\`powershell。不要用 HTML 标签包代码。
3. 行内数学公式必须使用 \( ... \)。
4. 块级数学公式必须单独成行，使用 \[ ... \]，不要把 \[ ... \] 混在普通句子中间。
5. 复杂公式优先使用标准 LaTeX 命令，例如 \frac{}{}、\partial、\Delta、\nabla、\Omega、\operatorname{vol}、\oint、\iint、\iiint、\sum、\lim、\to、\infty、\mid、\le、\ge、\in、\notin、\cup、\cap、\setminus、\mapsto。
6. 向量必须使用标准 LaTeX 写法，例如 \(\vec{F}=m\vec{a}\)、\(\overrightarrow{AB}\)，不要写成 →F 或 m→a 这种前置箭头形式。
7. 化学反应式请优先写成标准 LaTeX，例如：\[ \mathrm{C_3H_5(OOCR)_3 + 3\ NaOH \xrightarrow{\Delta} C_3H_5(OH)_3 + 3\ RCOONa} \]。不要把反应箭头写成裸文本 xrightarrow，尽量保留 \xrightarrow{...}。
8. 多行推导请写成：\[ \begin{aligned} ... \end{aligned} \]。
9. 矩阵必须使用标准 LaTeX 环境，例如：\[ A=\begin{pmatrix} a & b \\ c & d \end{pmatrix} \]；不要用纯文本表格模拟矩阵。
10. 集合、区域、函数定义域请使用标准 LaTeX，例如：\(D(f)=\{x\in\mathbb{R}\mid x\ne 0\}\)、\(D=\{(x,y)\mid a \le x \le b,\ g_1(x) \le y \le g_2(x)\}\)。不要在普通文本里写裸的 {x | ...}。
11. 体积、测度、定义域、值域等算子请写成标准公式，例如：\(\operatorname{vol}(\Omega)\)、\(\operatorname{Dom}(f)\)、\(\operatorname{Ran}(f)\)，不要写成裸文本混排。
12. 括号大小建议优先使用普通括号或 \left ... \right；如果使用 \bigl、\bigr、\Bigl、\Bigr，也必须保留反斜杠。
13. 上标星号请写在公式里，例如：\(x_k^*\)，不要在普通文本中写 xk^*。分段函数请使用 \[ \begin{cases} ... \end{cases} \]。
14. Markdown 分隔线请使用单独一行的 ---，前后都留空行。
15. 不要把 LaTeX 命令写成缺少反斜杠的普通英文，例如不要写成 mid、oint、iint、partial、frac、bigl、bigr、mathbb、notin。
16. 不要输出空白占位符、HTML、XML 或无法直接阅读的格式。注意：附件解析文本里的“【公式001（MathType近似转写）：...】”不是空白占位符，而是从 Word/MathType 公式对象恢复出的公式内容；回答时必须保留或尽量改写为 LaTeX，禁止把它改成“……”“缺失”或直接删除。
17. 如果用户提供附件，请结合附件内容回答；如果附件类型无法读取或当前模型不支持图片/文件，请明确说明限制，不要编造附件内容。`;

  const createPromptBuilder = ({
    state,
    findNode,
    getNodeDepth,
    getPromptSettingValue,
    promptUtils = window.PromptUtils,
    attachmentUtils = window.AttachmentUtils,
    appStore,
  }) => {
    const { applyPromptTemplate, appendIfTemplateMissingToken } = promptUtils;
    const { formatFileSize, normalizeAttachmentList, getAttachmentExtractedText, getAttachmentExtractionStatusLabel, buildAttachmentPromptContext } = attachmentUtils;

    const getLearningData = () => appStore?.select?.('learningData', null) || null;

    const getPromptNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return Array.isArray(state?.nodes) ? state.nodes : [];
    };

    const getPromptNodeDepth = (nodeId) => {
      const storeDepth = appStore?.getLearningNodeDepth?.(nodeId);
      if (typeof storeDepth === 'number') return storeDepth;
      return getNodeDepth?.(nodeId) || 0;
    };

    const isRichContextEnabled = () => {
      const data = getLearningData();
      return data ? Boolean(data.richContextMode) : Boolean(state?.richContextMode);
    };

    const hasMainQuestion = () => {
      const data = getLearningData();
      return data ? Boolean(data.hasMainQuestion) : Boolean(state?.hasMainQuestion);
    };

    const formatSelectionPositionForPrompt = (node = null) => {
      if (!node || !String(node.selectedTextContext || '').trim()) {
        return '无。本次追问没有稳定框选位置，默认针对整个父文本。';
      }
      const start = Number(node.selectionRange?.start);
      const end = Number(node.selectionRange?.end);
      const stored = String(node.selectedPositionContext || '').trim();
      if (stored) return stored;
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
        const kind = node.selectionSourceKind === 'question' ? '问题文本' : node.selectionSourceKind === 'answer' ? 'AI 回复文本' : '父文本';
        return `来源：${kind}\n起止字符：第 ${start + 1} 个字符到第 ${end} 个字符，左闭右开区间 [${start}, ${end})`;
      }
      return '框选内容存在，但未能稳定定位到父文本中的精确字符位置。';
    };

    const buildRichContextTranscript = (currentNode = null) => {
      const nodes = getPromptNodes();
      if (!isRichContextEnabled() || !hasMainQuestion() || !nodes.length) return '';
      const parts = [];

      nodes.forEach((node) => {
        const depth = getPromptNodeDepth(node.id);
        const prefix = '  '.repeat(depth);
        const kind = node.parentId ? '追问' : '主问题';
        parts.push(`${prefix}- ${node.id} · ${kind}：${node.question || '未命名问题'}`);

        if (node.selectedTextContext) {
          parts.push(`${prefix}  框选原文：${node.selectedTextContext}`);
          parts.push(`${prefix}  框选位置：\n${formatSelectionPositionForPrompt(node)}`);
        }

        if (node.answer) {
          parts.push(`${prefix}  AI 回答：\n${node.answer}`);
        } else if (node.status === 'requesting') {
          parts.push(`${prefix}  AI 回答：正在生成中`);
        } else if (node.systemMessage || node.errorMessage) {
          parts.push(`${prefix}  状态：${node.systemMessage || node.errorMessage}`);
        }

        const attachments = node.attachments || [];
        if (attachments.length) {
          const promptForAttachment = currentNode?.question || node.question || '';
          if (buildAttachmentPromptContext) {
            const contextText = buildAttachmentPromptContext(attachments, { prompt: promptForAttachment, totalBudget: 52000 });
            if (contextText) parts.push(contextText.split('\n').map((line) => `${prefix}  ${line}`).join('\n'));
          } else {
            parts.push(`${prefix}  附件：`);
            attachments.forEach((item, index) => {
              const title = `${prefix}    ${index + 1}. ${item.name || '未命名附件'}（${item.type || '未知类型'}，${formatFileSize(item.size)}）`;
              const extractedText = getAttachmentExtractedText?.(item) || '';
              if (extractedText) {
                const status = getAttachmentExtractionStatusLabel?.(item) || '已解析文本';
                const clipped = extractedText.length > 18000 ? `${extractedText.slice(0, 18000)}\n\n[附件文本过长，富上下文中已截断]` : extractedText;
                parts.push(`${title}\n${prefix}       解析状态：${status}\n${prefix}       文本内容：\n\`\`\`text\n${clipped}\n\`\`\``);
              } else if (item.kind === 'image') {
                parts.push(`${title}\n${prefix}       图片已作为视觉附件随请求提供；如果当前模型不支持视觉输入，请明确说明限制。`);
              } else {
                const status = getAttachmentExtractionStatusLabel?.(item) || '未解析正文';
                const message = item.extractionMessage || item.extraction?.message || '';
                parts.push(`${title}\n${prefix}       解析状态：${status}${message ? `；${message}` : ''}`);
              }
            });
          }
        }
      });

      const transcript = parts.join('\n');
      const current = currentNode ? `当前正在回答的问题：${currentNode.id} · ${currentNode.question || ''}` : '';
      const parentText = currentNode ? ((currentNode.parentTextContext || '').trim() || '暂无父文本') : '暂无父文本';
      const selectedText = currentNode ? ((currentNode.selectedTextContext || '').trim() || '无。本次追问针对整个父文本。') : '无。';
      const selectedPosition = currentNode ? formatSelectionPositionForPrompt(currentNode) : '无。';
      const childQuestion = currentNode ? (currentNode.question || '') : '';
      const template = getPromptSettingValue('richPrompt');
      let rendered = applyPromptTemplate(template, {
        PARENT_TEXT: parentText,
        SELECTED_TEXT: selectedText,
        SELECTED_POSITION: selectedPosition,
        CHILD_QUESTION: childQuestion,
        QUESTION: childQuestion,
        TRANSCRIPT: transcript,
        CURRENT_NODE: current,
      });
      if (currentNode) {
        rendered = appendIfTemplateMissingToken(template, rendered, 'PARENT_TEXT', `\n\n父文本：\n${parentText}`);
        rendered = appendIfTemplateMissingToken(template, rendered, 'SELECTED_TEXT', `\n\n被框选内容：\n${selectedText}`);
        rendered = appendIfTemplateMissingToken(template, rendered, 'SELECTED_POSITION', `\n\n框选位置：\n${selectedPosition}`);
        rendered = appendIfTemplateMissingToken(template, rendered, 'CHILD_QUESTION', `\n\n子问题：\n${childQuestion}`);
      }
      rendered = appendIfTemplateMissingToken(template, rendered, 'TRANSCRIPT', `\n\n主问题树完整上下文摘要：\n${transcript}`);
      if (current) {
        rendered = appendIfTemplateMissingToken(template, rendered, 'CURRENT_NODE', `\n\n${current}`);
      }
      return `\n\n${rendered}`;
    };

    const collectRichContextAttachments = (currentNode = null) => {
      if (!isRichContextEnabled()) return [];
      const all = [];
      getPromptNodes().forEach((node) => {
        (node.attachments || []).forEach((item) => {
          if (item.kind === 'image' && item.dataUrl) all.push(item);
        });
      });
      (currentNode?.attachments || []).forEach((item) => {
        if (item.kind === 'image' && item.dataUrl) all.push(item);
      });
      return normalizeAttachmentList(all).slice(0, 10);
    };

    const buildMainQuestionPrompt = (question) => {
      const template = getPromptSettingValue('mainPrompt');
      let rendered = applyPromptTemplate(template, {
        QUESTION: question,
        OUTPUT_FORMAT_REQUIREMENTS: outputFormatRequirements,
        RICH_CONTEXT: buildRichContextTranscript(null),
      });
      rendered = appendIfTemplateMissingToken(template, rendered, 'QUESTION', `\n\n用户问题：\n${question}`);
      return rendered;
    };

    const buildFollowUpPrompt = (node) => {
      const parentText = (node.parentTextContext || '').trim() || '暂无父文本';
      const selectedText = (node.selectedTextContext || '').trim() || '无。本次追问针对整个父文本。';
      const selectedPosition = formatSelectionPositionForPrompt(node);
      const childQuestion = node.question || '';
      const template = getPromptSettingValue('followUpPrompt');
      let rendered = applyPromptTemplate(template, {
        PARENT_TEXT: parentText,
        SELECTED_TEXT: selectedText,
        SELECTED_POSITION: selectedPosition,
        CHILD_QUESTION: childQuestion,
        QUESTION: childQuestion,
        OUTPUT_FORMAT_REQUIREMENTS: outputFormatRequirements,
        RICH_CONTEXT: buildRichContextTranscript(node),
      });
      rendered = appendIfTemplateMissingToken(template, rendered, 'PARENT_TEXT', `\n\n父文本：\n${parentText}`);
      rendered = appendIfTemplateMissingToken(template, rendered, 'SELECTED_TEXT', `\n\n被框选内容：\n${selectedText}`);
      rendered = appendIfTemplateMissingToken(template, rendered, 'SELECTED_POSITION', `\n\n框选位置：\n${selectedPosition}`);
      rendered = appendIfTemplateMissingToken(template, rendered, 'CHILD_QUESTION', `\n\n子问题：\n${childQuestion}`);
      return rendered;
    };

    return {
      outputFormatRequirements,
      buildRichContextTranscript,
      collectRichContextAttachments,
      buildMainQuestionPrompt,
      buildFollowUpPrompt,
    };
  };

  window.PromptBuilder = {
    outputFormatRequirements,
    createPromptBuilder,
  };
})();
