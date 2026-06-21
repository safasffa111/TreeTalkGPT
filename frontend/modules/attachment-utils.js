// Attachment-related pure helpers used by the workbench renderer.
(() => {
  const formatFileSize = (bytes = 0) => {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getAttachmentKind = (file) => {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('text/')) return 'text';
    if (/\.(txt|md|markdown|json|jsonl|js|jsx|mjs|cjs|ts|tsx|html|htm|css|scss|less|py|java|c|cc|cpp|cxx|h|hpp|hh|cs|go|rs|rb|php|swift|kt|kts|scala|sh|bash|zsh|ps1|bat|cmd|sql|csv|tsv|log|xml|yaml|yml|toml|ini|cfg|conf|tex)$/i.test(name)) return 'text';
    return 'file';
  };

  const readFileAsText = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });

  const readFileAsDataUrl = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  const makeClipboardImageFile = (file, index = 0) => {
    const extension = String(file?.type || 'image/png').split('/')[1] || 'png';
    const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    return new File([file], `粘贴图片-${Date.now()}-${index + 1}.${safeExtension}`, {
      type: file.type || `image/${safeExtension}`,
      lastModified: Date.now(),
    });
  };

  const collectImageFilesFromClipboard = (clipboardData) => {
    const files = [];
    const items = Array.from(clipboardData?.items || []);
    items.forEach((item, index) => {
      if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        const file = item.getAsFile?.();
        if (file) files.push(makeClipboardImageFile(file, index));
      }
    });

    if (!files.length) {
      Array.from(clipboardData?.files || []).forEach((file, index) => {
        if (String(file?.type || '').startsWith('image/')) {
          files.push(makeClipboardImageFile(file, index));
        }
      });
    }

    return files;
  };


  const getAttachmentExtractedText = (item = {}) => {
    const extracted = String(item.extractedText || item.parsedText || '').trim();
    if (extracted) return extracted;
    const text = String(item.text || '').trim();
    return text;
  };

  const getAttachmentExtractionStatusLabel = (item = {}) => {
    const status = String(item.extractionStatus || item.extraction?.status || '').trim();
    const parser = String(item.extractionParser || item.extraction?.parser || '').trim();
    const text = getAttachmentExtractedText(item);
    if (text) {
      if (/mathtype|ole/i.test(parser)) return status === 'parsed_truncated' ? '已解析文本（含 MathType，已截断）' : '已解析文本（含 MathType 公式）';
      return status === 'parsed_truncated' ? '已解析文本（已截断）' : '已解析文本';
    }
    if (item.kind === 'image' && (parser === 'image-no-ocr' || status === 'unsupported')) return '图片未 OCR';
    if (status === 'timeout') return '解析超时';
    if (status === 'too_large') return '文件过大，未自动解析';
    if (status === 'unsupported') return '暂不支持解析正文';
    if (status === 'unreadable') return '解析结果不可读';
    if (status === 'empty') return '未提取到可用文本';
    if (status === 'failed') return '解析失败';
    if (item.kind === 'image') return '图片附件';
    return '';
  };

  const escapeRegExp = (text = '') => String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const extractPromptKeywords = (prompt = '') => {
    const clean = String(prompt || '')
      .replace(/[，。！？；：、,.!?;:()[\]{}<>《》“”"'`~@#$%^&*_+=|\\/\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = [];
    const latin = clean.match(/[A-Za-z0-9_+#.-]{3,}/g) || [];
    latin.forEach((word) => words.push(word.toLowerCase()));
    const chinese = clean.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    chinese.forEach((phrase) => {
      words.push(phrase);
      if (phrase.length > 6) {
        for (let i = 0; i <= phrase.length - 4; i += 2) words.push(phrase.slice(i, i + 4));
      }
    });
    const stop = new Set(['这个附件', '总结附件', '请分析', '分析一下', '根据附件', '附件内容', '什么是', '为什么', '怎么做', '如何']);
    return [...new Set(words.filter((word) => word && !stop.has(word) && word.length >= 2))].slice(0, 18);
  };

  const isBroadAttachmentQuery = (prompt = '') => /总结|概括|梳理|提纲|路线|大纲|全文|整个|整体|overview|summary|summari[sz]e/i.test(String(prompt || ''));

  const hasUnclosedMathDelimiter = (text = '') => {
    const source = String(text || '');
    const count = (pattern) => (source.match(pattern) || []).length;
    if (count(/(^|[^\\])\$\$/g) % 2 === 1) return true;
    if (count(/(^|[^\\])\$(?!\$)/g) % 2 === 1) return true;
    if ((source.match(/\\\[/g) || []).length > (source.match(/\\\]/g) || []).length) return true;
    if ((source.match(/\\\(/g) || []).length > (source.match(/\\\)/g) || []).length) return true;
    return false;
  };

  const safeSliceMathAware = (text = '', start = 0, end = 0, lookahead = 1800) => {
    const source = String(text || '');
    const safeStart = Math.max(0, start);
    let safeEnd = Math.min(source.length, Math.max(safeStart, end));
    const sliced = source.slice(safeStart, safeEnd);
    if (!hasUnclosedMathDelimiter(sliced)) return sliced;
    const nextCandidates = ['$$', '$', '\\]', '\\)']
      .map((needle) => source.indexOf(needle, safeEnd))
      .filter((pos) => pos >= safeEnd && pos <= safeEnd + lookahead)
      .sort((a, b) => a - b);
    if (nextCandidates.length) {
      const closePos = nextCandidates[0];
      safeEnd = closePos + (source.startsWith('$$', closePos) || source.startsWith('\\]', closePos) || source.startsWith('\\)', closePos) ? 2 : 1);
      return source.slice(safeStart, safeEnd);
    }
    const lastOpen = Math.max(sliced.lastIndexOf('$$'), sliced.lastIndexOf('$'), sliced.lastIndexOf('\\['), sliced.lastIndexOf('\\('));
    if (lastOpen > Math.max(0, sliced.length - lookahead)) return sliced.slice(0, lastOpen).trimEnd();
    return sliced;
  };

  const sliceAround = (text = '', index = 0, radius = 1800) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    const prefix = start > 0 ? '……' : '';
    const suffix = end < text.length ? '……' : '';
    return `${prefix}${safeSliceMathAware(text, start, end)}${suffix}`;
  };

  const hasMathTypeFormulaMarkers = (text = '', item = {}) => {
    const parser = String(item.extractionParser || item.extraction?.parser || '');
    return /mathtype|ole/i.test(parser) || /【公式\d{1,4}待转写】/.test(String(text || ''));
  };

  const buildRelevantAttachmentText = (item = {}, prompt = '', options = {}) => {
    const text = getAttachmentExtractedText(item);
    if (!text) return { text: '', mode: 'empty', omitted: 0 };
    const maxChars = Number(options.maxChars || 52000);
    if (text.length <= maxChars) return { text, mode: 'full', omitted: 0 };

    const headings = Array.isArray(item.extractionHeadings || item.extraction?.headings)
      ? (item.extractionHeadings || item.extraction?.headings).filter(Boolean).slice(0, 24)
      : [];
    const headingBlock = headings.length ? `【文档结构线索】\n${headings.map((line, i) => `${i + 1}. ${line}`).join('\n')}\n\n` : '';

    if (isBroadAttachmentQuery(prompt)) {
      const headBudget = Math.max(12000, Math.floor(maxChars * 0.72));
      const tailBudget = Math.max(4000, maxChars - headBudget - headingBlock.length - 500);
      const selected = `${headingBlock}${safeSliceMathAware(text, 0, headBudget)}\n\n……【中间内容过长，已省略 ${Math.max(0, text.length - headBudget - tailBudget)} 字】……\n\n${safeSliceMathAware(text, Math.max(headBudget, text.length - tailBudget), text.length)}`;
      return { text: safeSliceMathAware(selected, 0, maxChars), mode: 'broad-truncated', omitted: Math.max(0, text.length - maxChars) };
    }

    const keywords = extractPromptKeywords(prompt);
    const snippets = [];
    const used = [];
    for (const keyword of keywords) {
      const pattern = new RegExp(escapeRegExp(keyword), /[\u4e00-\u9fa5]/.test(keyword) ? 'g' : 'gi');
      let match;
      let count = 0;
      while ((match = pattern.exec(text)) && count < 4 && snippets.join('\n\n').length < maxChars * 0.82) {
        const pos = match.index;
        if (!used.some(([a, b]) => pos >= a && pos <= b)) {
          const snippet = sliceAround(text, pos, 1600);
          snippets.push(`【命中片段：${keyword}】\n${snippet}`);
          used.push([Math.max(0, pos - 1600), Math.min(text.length, pos + 1600)]);
          count += 1;
        }
      }
    }

    if (snippets.length) {
      const intro = `${headingBlock}【文档开头】\n${safeSliceMathAware(text, 0, Math.min(4200, text.length))}`;
      const selected = `${intro}\n\n${snippets.join('\n\n')}`;
      return { text: safeSliceMathAware(selected, 0, maxChars), mode: 'keyword-snippets', omitted: Math.max(0, text.length - selected.length) };
    }

    const fallback = `${headingBlock}${safeSliceMathAware(text, 0, maxChars - headingBlock.length - 120)}\n\n[附件文本较长，当前请求只发送开头部分；如需全文细节，请让用户缩小问题范围或继续追问具体关键词。]`;
    return { text: safeSliceMathAware(fallback, 0, maxChars), mode: 'front-truncated', omitted: Math.max(0, text.length - fallback.length) };
  };

  const buildAttachmentPromptContext = (attachments = [], options = {}) => {
    if (!attachments.length) return '';
    const prompt = typeof options === 'string' ? options : String(options.prompt || '');
    const imagePartsEnabled = Boolean(typeof options === 'object' && options.imagePartsEnabled);
    const totalBudget = Number(typeof options === 'object' ? (options.totalBudget || 130000) : 130000);
    let usedBudget = 0;
    const perAttachmentBudget = Math.max(18000, Math.floor(totalBudget / Math.max(1, attachments.length)));
    const parts = attachments.map((item, index) => {
      const storage = item.localPath ? `\n本地保存路径：${item.localPath}` : '';
      const title = `[附件 ${index + 1}] ${item.name || '未命名附件'}（${item.type || '未知类型'}，${formatFileSize(item.size)}）${storage}`;
      const extractedText = getAttachmentExtractedText(item);
      if (extractedText) {
        const parser = item.extractionParser || item.extraction?.parser || (item.kind === 'text' ? 'plain-text' : 'local-parser');
        const status = getAttachmentExtractionStatusLabel(item);
        const fullLength = Number(item.extraction?.fullLength || extractedText.length || 0);
        const chunkCount = Number(item.extractionChunkCount || item.extraction?.chunkCount || 0);
        const warnings = Array.isArray(item.extractionWarnings || item.extraction?.warnings) ? (item.extractionWarnings || item.extraction?.warnings).filter(Boolean) : [];
        const remaining = Math.max(9000, totalBudget - usedBudget);
        const selected = buildRelevantAttachmentText(item, prompt, { maxChars: Math.min(perAttachmentBudget, remaining) });
        usedBudget += selected.text.length;
        const formulaAssetCount = Number(item.formulaAssetCount || item.extraction?.formulaAssetCount || 0);
        const formulaManifestPath = item.formulaManifestPath || item.extraction?.formulaManifestPath || '';
        const formulaPreviewDir = item.formulaPreviewDir || item.extraction?.formulaPreviewDir || '';
        const mathTypeNotice = hasMathTypeFormulaMarkers(selected.text, item)
          ? `\nMathType/OLE公式说明：正文中的 MathType 公式已尽量转为 $...$ LaTeX 片段；回答、提取题目、总结或保存到知识仓库时，必须保留这些公式，不要改成省略号或“缺失”。若正文出现“【公式001待转写】”，再参考导出的公式预览核对。${formulaAssetCount ? `\n公式预览：已导出 ${formulaAssetCount} 个原始预览；目录：${formulaPreviewDir || 'formula-previews'}；清单：${formulaManifestPath || 'formula-preview-manifest.json'}。这些预览只作为核对依据，不要默认插入正文。` : ''}`
          : '';
        return `${title}\n解析状态：${status}${parser ? `；解析器：${parser}` : ''}${fullLength ? `；全文 ${fullLength} 字` : ''}${chunkCount ? `；已切分 ${chunkCount} 个片段` : ''}${item.extraction?.cacheHit ? '；命中本地解析缓存' : ''}${warnings.length ? `\n解析提示：${warnings.join('；')}` : ''}\n上下文发送模式：${selected.mode}${selected.omitted ? `；省略约 ${selected.omitted} 字` : ''}\n公式保护：附件文本中的 KaTeX/LaTeX 片段（如 $...$、$$...$$、\\(...\\)、\\[...\\]、\\frac、\\sum）是原始内容，回答和保存时不要删掉反斜杠或数学分隔符。${mathTypeNotice}\n文本内容：\n\`\`\`text\n${selected.text}\n\`\`\``;
      }
      if (item.kind === 'image') {
        const imageExtractionMessage = item.extractionMessage || item.extraction?.message || '图片附件没有本地 OCR 文本结果。';
        return imagePartsEnabled
          ? `${title}\n图片附件将以视觉输入随请求发送；本地文本解析状态：${getAttachmentExtractionStatusLabel(item) || '图片附件'}。${imageExtractionMessage}`
          : `${title}\n图片附件已保存到本地，可在问题卡片中预览；当前请求按纯文本模式发送，不附带 image_url 多模态字段，因此 AI 不能读取截图中的题目文字。${imageExtractionMessage}`;
      }
      const status = getAttachmentExtractionStatusLabel(item) || '未解析正文';
      const message = item.extractionMessage || item.extraction?.message || '';
      return `${title}\n解析状态：${status}${message ? `；${message}` : ''}\n该附件已保存到本地文件夹；当前请求会提供文件名、类型、大小和本地路径。`;
    });

    return `\n\n附件上下文：\n${parts.join('\n\n')}`;
  };


  const normalizeAttachmentList = (items = []) => {
    const seen = new Set();
    const normalized = [];
    items.forEach((item) => {
      if (!item) return;
      const key = item.id || item.contentHash || `${item.name || ''}-${item.size || 0}-${item.type || ''}-${item.dataUrl ? item.dataUrl.slice(0, 48) : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(item);
    });
    return normalized;
  };


  const modelLooksVisionCapable = (model = '') => /(?:gpt-4o|gpt-4\.1|vision|vl|omni|qwen.*vl|gemini|claude-3)/i.test(String(model || ''));

  const providerLooksVisionCapable = (provider = '', baseUrl = '') => {
    const cleanProvider = String(provider || '').toLowerCase();
    const cleanBase = String(baseUrl || '').toLowerCase();
    if (cleanProvider === 'openai') return true;
    if (/dashscope|aliyun|qwen/.test(cleanBase)) return true;
    return false;
  };

  const shouldSendImagePartsForApi = (options = {}) => {
    if (options?.forceTextOnly) return false;
    if (options?.enableImageParts === true) return true;
    if (options?.enableImageParts === false) return false;
    const config = options?.config || {};
    const model = String(config.model || '').trim();
    if (!modelLooksVisionCapable(model)) return false;
    return providerLooksVisionCapable(config.provider, config.baseUrl) || modelLooksVisionCapable(model);
  };

  const buildImageTextOnlyNotice = (attachments = []) => {
    const images = (Array.isArray(attachments) ? attachments : []).filter((item) => item?.kind === 'image');
    if (!images.length) return '';
    const lines = images.map((item, index) => {
      const storage = item.localPath ? `；本地路径：${item.localPath}` : '';
      return `- 图片 ${index + 1}：${item.name || '未命名图片'}（${item.type || 'image'}，${formatFileSize(item.size)}${storage}）`;
    });
    return `\n\n图片附件说明：\n当前模型/API 接口按文本请求发送；图片未使用 image_url 多模态字段，以避免不支持视觉输入的接口报错。图片仍已保存在本地并可在问题卡片中预览，但截图里的文字不会被本地 OCR，也不会作为视觉内容发送给 AI。请不要推测图片内容；如用户要求解读图片，请明确提示需要切换到视觉模型/API，或让用户粘贴题目文字。\n${lines.join('\n')}`;
  };

  const buildMessageContentForApi = (prompt, attachments = [], options = {}) => {
    const imagePartsEnabled = shouldSendImagePartsForApi(options);
    const baseText = `${prompt}${buildAttachmentPromptContext(attachments, { prompt, imagePartsEnabled })}`;
    const imageParts = attachments
      .filter((item) => item.kind === 'image' && item.dataUrl)
      .map((item) => ({
        type: 'image_url',
        image_url: { url: item.dataUrl },
      }));

    if (!imageParts.length) return baseText;
    if (!imagePartsEnabled) {
      return `${baseText}${buildImageTextOnlyNotice(attachments)}`;
    }
    return [
      { type: 'text', text: baseText },
      ...imageParts,
    ];
  };


  window.AttachmentUtils = {
    formatFileSize,
    getAttachmentKind,
    readFileAsText,
    readFileAsDataUrl,
    makeClipboardImageFile,
    collectImageFilesFromClipboard,
    getAttachmentExtractedText,
    getAttachmentExtractionStatusLabel,
    buildAttachmentPromptContext,
    normalizeAttachmentList,
    shouldSendImagePartsForApi,
    buildMessageContentForApi,
  };
})();
