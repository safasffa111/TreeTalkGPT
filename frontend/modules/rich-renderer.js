// Rich text and lightweight math rendering utilities.
// This module is intentionally pure: it does not read app state or touch the DOM.
(() => {
  const escapeHtml = (value = '') => {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('\"', '&quot;')
      .replaceAll("'", '&#039;');
  };

  const languageName = (lang = '') => {
    const normalized = lang.trim().toLowerCase();
    const map = {
      js: 'JavaScript',
      jsx: 'React JSX',
      ts: 'TypeScript',
      tsx: 'React TSX',
      py: 'Python',
      python: 'Python',
      html: 'HTML',
      css: 'CSS',
      json: 'JSON',
      bash: 'Bash',
      shell: 'Shell',
      sh: 'Shell',
      powershell: 'PowerShell',
      ps1: 'PowerShell',
      cpp: 'C++',
      c: 'C',
      java: 'Java',
      latex: 'LaTeX',
      tex: 'LaTeX',
    };
    return map[normalized] || (normalized ? normalized.toUpperCase() : 'Code');
  };

  const KATEX_RENDER_MACROS = {
    '\\RR': '\\mathbb{R}',
    '\\NN': '\\mathbb{N}',
    '\\ZZ': '\\mathbb{Z}',
    '\\QQ': '\\mathbb{Q}',
    '\\CC': '\\mathbb{C}',
    '\\HH': '\\mathbb{H}',
    '\\PP': '\\mathbb{P}',
    '\\FF': '\\mathbb{F}',
    '\\EE': '\\mathbb{E}',
    '\\R': '\\mathbb{R}',
    '\\N': '\\mathbb{N}',
    '\\Z': '\\mathbb{Z}',
    '\\Q': '\\mathbb{Q}',
    '\\C': '\\mathbb{C}',
    '\\F': '\\mathbb{F}',
    '\\dd': '\\mathop{}\\!\\mathrm{d}',
    '\\d': '\\mathop{}\\!\\mathrm{d}',
    '\\ee': '\\mathrm{e}',
    '\\ii': '\\mathrm{i}',
    '\\grad': '\\nabla',
    '\\bm': '\\boldsymbol',
    '\\vect': '\\boldsymbol{#1}',
    '\\mat': '\\boldsymbol{#1}',
    '\\rank': '\\operatorname{rank}',
    '\\Rank': '\\operatorname{rank}',
    '\\tr': '\\operatorname{tr}',
    '\\Tr': '\\operatorname{tr}',
    '\\trace': '\\operatorname{tr}',
    '\\diag': '\\operatorname{diag}',
    '\\Diag': '\\operatorname{diag}',
    '\\adj': '\\operatorname{adj}',
    '\\Adj': '\\operatorname{adj}',
    '\\Span': '\\operatorname{span}',
    '\\span': '\\operatorname{span}',
    '\\Ker': '\\operatorname{Ker}',
    '\\ker': '\\operatorname{Ker}',
    '\\Img': '\\operatorname{Im}',
    '\\image': '\\operatorname{Im}',
    '\\Im': '\\operatorname{Im}',
    '\\Null': '\\operatorname{Null}',
    '\\nullity': '\\operatorname{nullity}',
    '\\Range': '\\operatorname{Range}',
    '\\Col': '\\operatorname{Col}',
    '\\Row': '\\operatorname{Row}',
    '\\dim': '\\operatorname{dim}',
    '\\proj': '\\operatorname{proj}',
    '\\sgn': '\\operatorname{sgn}',
    '\\id': '\\operatorname{id}',
    '\\argmax': '\\operatorname*{arg\\,max}',
    '\\argmin': '\\operatorname*{arg\\,min}',
    '\\abs': '\\left\\lvert #1 \\right\\rvert',
    '\\norm': '\\left\\lVert #1 \\right\\rVert',
    '\\inner': '\\left\\langle #1,#2 \\right\\rangle',
    '\\ceil': '\\left\\lceil #1 \\right\\rceil',
    '\\floor': '\\left\\lfloor #1 \\right\\rfloor',
  };

  const KATEX_UNICODE_REPLACEMENTS = new Map([
    ['≤', ' \\le '], ['≥', ' \\ge '], ['≠', ' \\ne '], ['≈', ' \\approx '],
    ['≡', ' \\equiv '], ['∼', ' \\sim '], ['∝', ' \\propto '], ['∞', '\\infty '],
    ['∈', ' \\in '], ['∉', ' \\notin '], ['⊂', ' \\subset '], ['⊆', ' \\subseteq '],
    ['⊃', ' \\supset '], ['⊇', ' \\supseteq '], ['∪', ' \\cup '], ['∩', ' \\cap '],
    ['∅', '\\varnothing '], ['∧', ' \\land '], ['∨', ' \\lor '], ['¬', '\\neg '],
    ['∀', '\\forall '], ['∃', '\\exists '], ['∂', '\\partial '], ['∇', '\\nabla '],
    ['×', ' \\times '], ['÷', ' \\div '], ['·', ' \\cdot '], ['⋅', ' \\cdot '],
    ['→', ' \\to '], ['←', ' \\leftarrow '], ['↔', ' \\leftrightarrow '],
    ['⇒', ' \\Rightarrow '], ['⇐', ' \\Leftarrow '], ['⇔', ' \\Leftrightarrow '],
    ['↦', ' \\mapsto '], ['°', '^{\\circ}'], ['′', "'"], ['″', "''"],
    ['α', '\\alpha '], ['β', '\\beta '], ['γ', '\\gamma '], ['δ', '\\delta '],
    ['ε', '\\varepsilon '], ['θ', '\\theta '], ['λ', '\\lambda '], ['μ', '\\mu '],
    ['π', '\\pi '], ['ρ', '\\rho '], ['σ', '\\sigma '], ['φ', '\\varphi '],
    ['η', '\\eta '], ['κ', '\\kappa '], ['ξ', '\\xi '], ['τ', '\\tau '],
    ['ψ', '\\psi '], ['χ', '\\chi '], ['ζ', '\\zeta '], ['ν', '\\nu '],
    ['ω', '\\omega '], ['Γ', '\\Gamma '], ['Λ', '\\Lambda '], ['Π', '\\Pi '],
    ['Δ', '\\Delta '], ['Σ', '\\Sigma '], ['Ω', '\\Omega '],
    ['ℝ', '\\mathbb{R}'], ['ℕ', '\\mathbb{N}'], ['ℤ', '\\mathbb{Z}'], ['ℚ', '\\mathbb{Q}'],
    ['ℂ', '\\mathbb{C}'], ['𝔽', '\\mathbb{F}'], ['ℋ', '\\mathcal{H}'],
    ['⊥', ' \\perp '], ['∥', ' \\parallel '], ['∦', ' \\nparallel '],
    ['⊕', ' \\oplus '], ['⊗', ' \\otimes '], ['⊙', ' \\odot '],
    ['∘', ' \\circ '], ['∗', ' \\ast '], ['∑', ' \\sum '], ['∏', ' \\prod '],
    ['√', '\\sqrt{}'], ['∫', ' \\int '], ['∮', ' \\oint '],
    ['⊢', ' \\vdash '], ['⊨', ' \\models '], ['∴', ' \\therefore '], ['∵', ' \\because '],
    ['⟨', '\\langle '], ['⟩', ' \\rangle'], ['〈', '\\langle '], ['〉', ' \\rangle'],
    ['…', '\\dots '], ['⋯', '\\cdots '], ['⋮', '\\vdots '], ['⋱', '\\ddots '],
  ]);

  const KATEX_SUPERSCRIPT_REPLACEMENTS = new Map([
    ['⁰', '0'], ['¹', '1'], ['²', '2'], ['³', '3'], ['⁴', '4'], ['⁵', '5'], ['⁶', '6'], ['⁷', '7'], ['⁸', '8'], ['⁹', '9'],
    ['⁺', '+'], ['⁻', '-'], ['⁼', '='], ['⁽', '('], ['⁾', ')'], ['ᵀ', 'T'], ['ᴴ', 'H'], ['ᵗ', 't'], ['ⁿ', 'n'],
  ]);

  const KATEX_SUBSCRIPT_REPLACEMENTS = new Map([
    ['₀', '0'], ['₁', '1'], ['₂', '2'], ['₃', '3'], ['₄', '4'], ['₅', '5'], ['₆', '6'], ['₇', '7'], ['₈', '8'], ['₉', '9'],
    ['₊', '+'], ['₋', '-'], ['₌', '='], ['₍', '('], ['₎', ')'], ['ᵢ', 'i'], ['ⱼ', 'j'], ['ₖ', 'k'], ['ₙ', 'n'], ['ₘ', 'm'],
  ]);

  const normalizeUnicodeScripts = (source = '') => {
    let text = String(source);
    text = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵀᴴᵗⁿ]+/g, (chunk) => `^{${[...chunk].map((char) => KATEX_SUPERSCRIPT_REPLACEMENTS.get(char) || char).join('')}}`);
    text = text.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ᵢⱼₖₙₘ]+/g, (chunk) => `_{${[...chunk].map((char) => KATEX_SUBSCRIPT_REPLACEMENTS.get(char) || char).join('')}}`);
    return text;
  };

  const replaceUnicodeMathSymbols = (source = '') => {
    return normalizeUnicodeScripts(String(source)).replace(/[≤≥≠≈≡∼∝∞∈∉⊂⊆⊃⊇∪∩∅∧∨¬∀∃∂∇×÷·⋅→←↔⇒⇐⇔↦°′″αβγδεηκλμνξπρσφχψωζΓΛΠΔΣΩℝℕℤℚℂ𝔽ℋ⊥∥∦⊕⊗⊙∘∗∑∏√∫∮⊢⊨∴∵⟨⟩〈〉…⋯⋮⋱]/g, (char) => {
      return KATEX_UNICODE_REPLACEMENTS.get(char) || char;
    });
  };

  const normalizeUnsupportedLatexEnvironments = (formula = '') => {
    return String(formula)
      .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
      .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
      .replace(/\\begin\{alignedat\*?\}\s*\{[^{}]*\}/g, '\\begin{aligned}')
      .replace(/\\end\{alignedat\*?\}/g, '\\end{aligned}')
      .replace(/\\begin\{flalign\*?\}/g, '\\begin{aligned}')
      .replace(/\\end\{flalign\*?\}/g, '\\end{aligned}')
      .replace(/\\begin\{split\}/g, '\\begin{aligned}')
      .replace(/\\end\{split\}/g, '\\end{aligned}')
      .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
      .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
      .replace(/\\begin\{equation\*?\}/g, '')
      .replace(/\\end\{equation\*?\}/g, '')
      .replace(/\\begin\{displaymath\}/g, '')
      .replace(/\\end\{displaymath\}/g, '')
      .replace(/\\begin\{subequations\}/g, '')
      .replace(/\\end\{subequations\}/g, '')
      .replace(/\\nonumber\b/g, '')
      .replace(/\\label\s*\{[^{}]*\}/g, '')
      .replace(/\\eqref\s*\{([^{}]*)\}/g, '\\text{($1)}')
      .replace(/\\ref\s*\{([^{}]*)\}/g, '\\text{$1}');
  };

  const normalizeCommonLatexAliases = (formula = '') => {
    return String(formula)
      .replace(/\\operatornamewithlimits\s*\{/g, '\\operatorname*{')
      .replace(/\\mbox\s*\{/g, '\\text{')
      .replace(/\\rm\s*\{/g, '\\mathrm{')
      .replace(/\\bold\s*\{/g, '\\mathbf{')
      .replace(/\\bf\s*\{/g, '\\mathbf{')
      .replace(/\\Bbb\s*\{/g, '\\mathbb{')
      .replace(/\\mathds\s*\{/g, '\\mathbb{')
      .replace(/\\mathfrak\s*\{0\}/g, '\\mathfrak{0}')
      .replace(/\\overrightarrow\s*\{/g, '\\vec{')
      .replace(/\\transpose\b/g, '^{T}')
      .replace(/\\trans\b/g, '^{T}')
      .replace(/\\hermitian\b/g, '^{H}')
      .replace(/\\adjoint\b/g, '^{*}')
      .replace(/\\overset\s*\{\s*→\s*\}/g, '\\vec');
  };

  const compactLatexWhitespace = (formula = '') => {
    return String(formula)
      .replace(/[  ]/g, ' ')
      .replace(/([{}_^&])/g, '$1')
      .replace(/\\\s+/g, '\\')
      .trim();
  };

  const renderLatexFallbackToHtml = (raw = '') => {
    let formula = String(raw).trim();

    formula = formula
      .replace(/^\\\(/, '')
      .replace(/\\\)$/, '')
      .replace(/^\\\[/, '')
      .replace(/\\\]$/, '')
      .replace(/^\$\$/, '')
      .replace(/\$\$$/, '')
      .replace(/^\$/, '')
      .replace(/\$$/, '')
      .trim();

    const readBraceGroup = (text, startIndex) => {
      let i = startIndex;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (text[i] !== '{') return null;

      let depth = 0;
      let content = '';
      for (let j = i; j < text.length; j += 1) {
        const char = text[j];
        if (char === '{') {
          depth += 1;
          if (depth > 1) content += char;
          continue;
        }
        if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            return { content, end: j + 1 };
          }
          content += char;
          continue;
        }
        content += char;
      }
      return null;
    };

    const mathAlphabetMap = {
      R: 'ℝ', Z: 'ℤ', N: 'ℕ', Q: 'ℚ', C: 'ℂ', H: 'ℍ', P: 'ℙ', F: '𝔽', E: '𝔼',
    };

    const renderMathAlphabet = (content = '', family = 'mathbb') => {
      const text = String(content);
      if (family === 'mathbb') {
        return [...text].map((char) => mathAlphabetMap[char] || char).join('');
      }
      return text;
    };

    const normalizeLatexSource = (text = '') => {
      return String(text)
        .replace(/\\not\s*\\in/g, '\\notin')
        .replace(/\\operatorname\*?\{/g, '\\operatorname{')
        .replace(/\\DeclareMathOperator\{[^{}]+\}\{([^{}]+)\}/g, '$1')
        .replace(/\\mathrm\{d\}/g, 'd')
        .replace(/\\,d/g, ' d');
    };

    const replaceCommandWithOneGroup = (text, commandPattern, renderer) => {
      let output = '';
      let index = 0;

      while (index < text.length) {
        commandPattern.lastIndex = index;
        const match = commandPattern.exec(text);
        if (!match) {
          output += text.slice(index);
          break;
        }

        output += text.slice(index, match.index);
        const group = readBraceGroup(text, commandPattern.lastIndex);
        if (!group) {
          output += match[0];
          index = commandPattern.lastIndex;
          continue;
        }

        output += renderer(group.content, match[0]);
        index = group.end;
      }

      return output;
    };

    const replaceFractions = (text, pushToken = null) => {
      let output = '';
      let index = 0;
      const commandPattern = /\\(?:dfrac|tfrac|frac)/g;

      while (index < text.length) {
        commandPattern.lastIndex = index;
        const match = commandPattern.exec(text);
        if (!match) {
          output += text.slice(index);
          break;
        }

        output += text.slice(index, match.index);
        const numerator = readBraceGroup(text, commandPattern.lastIndex);
        const denominator = numerator ? readBraceGroup(text, numerator.end) : null;

        if (!numerator || !denominator) {
          output += match[0];
          index = commandPattern.lastIndex;
          continue;
        }

        const html = `<span class="math-frac"><span>${renderExpression(numerator.content)}</span><span>${renderExpression(denominator.content)}</span></span>`;
        output += pushToken ? pushToken(html) : html;
        index = denominator.end;
      }

      return output;
    };

    const replaceSqrt = (text, pushToken = null) => {
      return replaceCommandWithOneGroup(text, /\\sqrt/g, (content) => {
        const html = `<span class="math-sqrt"><span class="math-sqrt-symbol">√</span><span class="math-sqrt-body">${renderExpression(content)}</span></span>`;
        return pushToken ? pushToken(html) : html;
      });
    };


    const renderVector = (content = '', direction = 'right') => {
      const arrow = direction === 'left' ? '←' : '→';
      return `<span class="math-vector math-vector--${direction}"><span class="math-vector-arrow">${arrow}</span><span class="math-vector-body">${renderExpression(content)}</span></span>`;
    };

    const renderExtensibleArrow = (label = '', direction = 'right') => {
      const arrow = direction === 'left' ? '⟵' : '⟶';
      const normalizedLabel = String(label || '').trim();
      const labelHtml = normalizedLabel ? `<span class="math-xarrow-label">${renderExpression(normalizedLabel)}</span>` : '<span class="math-xarrow-label"></span>';
      return `<span class="math-xarrow math-xarrow--${direction}">${labelHtml}<span class="math-xarrow-line">${arrow}</span></span>`;
    };

    const replaceExtensibleArrows = (text, pushToken = null) => {
      let output = '';
      let index = 0;
      // Support both standard LaTeX \xrightarrow{...} and common model output
      // that accidentally omits the backslash: xrightarrow{...}.
      const commandPattern = /\\?x(?:right|left)arrow/g;

      while (index < text.length) {
        commandPattern.lastIndex = index;
        const match = commandPattern.exec(text);
        if (!match) {
          output += text.slice(index);
          break;
        }

        const command = match[0];
        output += text.slice(index, match.index);
        const group = readBraceGroup(text, commandPattern.lastIndex);

        if (!group) {
          output += command;
          index = commandPattern.lastIndex;
          continue;
        }

        const direction = command.includes('left') ? 'left' : 'right';
        const html = renderExtensibleArrow(group.content, direction);
        output += pushToken ? pushToken(html) : html;
        index = group.end;
      }

      return output;
    };

    const looksLikeChemicalText = (content = '') => {
      const text = String(content);
      return /[A-Z][a-z]?\d|\)\d|\]\d|(?:Na|K|Ca|Mg|Al|Fe|Cu|Zn|Ag|Cl|Br|OH|COOH|COONa|OOCR|RCOO)/.test(text);
    };

    const normalizeChemicalText = (content = '') => {
      const text = String(content);
      if (!looksLikeChemicalText(text)) return text;
      // Convert C3H5(OH)3 into C_{3}H_{5}(OH)_{3}, but keep coefficients
      // such as 3 NaOH as ordinary leading numbers.
      const protectedTokens = [];
      const tokenizedText = text.replace(/\uE100MATHTOKEN\d+\uE101/g, (token) => {
        const marker = `\uE102${protectedTokens.length}\uE103`;
        protectedTokens.push(token);
        return marker;
      });

      let formatted = tokenizedText.replace(/([A-Za-zΑ-ωΩ\)\]])(\d+)/g, (_match, base, digits) => {
        return `${base}_{${digits}}`;
      });

      protectedTokens.forEach((token, index) => {
        formatted = formatted.replaceAll(`\uE102${index}\uE103`, token);
      });

      return formatted;
    };

    const renderTextGroupContent = (content = '', command = '') => {
      if (command === 'mathrm') return normalizeChemicalText(content);
      return content;
    };

    const renderMatrix = (body = '', env = 'matrix') => {
      const rows = String(body)
        .split(/\\/)
        .map((row) => row.trim())
        .filter(Boolean);

      const normalizedEnv = env || 'matrix';

      if (normalizedEnv === 'cases' || normalizedEnv === 'dcases') {
        const htmlRows = rows.map((row) => {
          const cells = row.split('&').map((cell) => cell.trim());
          const expression = cells[0] || '';
          const condition = cells.slice(1).join(' ').trim();
          return `<tr><td class="math-cases-expression">${renderExpression(expression)}</td><td class="math-cases-condition">${renderExpression(condition)}</td></tr>`;
        }).join('');
        return `<span class="math-cases"><span class="math-cases-brace">{</span><table><tbody>${htmlRows}</tbody></table></span>`;
      }

      const htmlRows = rows.map((row) => {
        const cells = row
          .split('&')
          .map((cell) => `<td>${renderExpression(cell.trim())}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      }).join('');

      return `<span class="math-matrix math-matrix--${normalizedEnv}"><table><tbody>${htmlRows}</tbody></table></span>`;
    };

    const renderSimple = (value = '') => {
      let text = normalizeLatexSource(String(value).trim());

      const htmlTokens = [];
      const pushToken = (html) => {
        const token = `\uE100MATHTOKEN${htmlTokens.length}\uE101`;
        htmlTokens.push(html);
        return token;
      };

      text = text.replace(/\\begin\{(pmatrix|bmatrix|vmatrix|matrix|array|cases|dcases)\}([\s\S]*?)\\end\{\1\}/g, (_match, env, body) => {
        return pushToken(renderMatrix(body, env));
      });

      // Chemical / reaction arrows must be protected before text-command groups
      // such as \mathrm{...} are stripped, otherwise nested arrow labels can
      // prevent \mathrm from being recognized correctly.
      text = replaceExtensibleArrows(text, pushToken);

      text = replaceCommandWithOneGroup(text, /\\(?:mathrm|text|mathbf|boldsymbol)/g, (content, commandText = '') => {
        const commandMatch = /\\([a-zA-Z]+)/.exec(commandText);
        const command = commandMatch ? commandMatch[1] : '';
        return renderTextGroupContent(content, command);
      });

      // Important: any generated math HTML must be stored as a protected
      // token immediately. Otherwise later plain-text transforms such as
      // escapeHtml/subscript parsing may escape partial <span> fragments and
      // produce visible garbage like </span><span> inside formulas.
      text = replaceFractions(text, pushToken);
      text = replaceSqrt(text, pushToken);
      text = replaceCommandWithOneGroup(text, /\\(?:vec|overrightarrow)/g, (content) => pushToken(renderVector(content, 'right')));
      text = replaceCommandWithOneGroup(text, /\\overleftarrow/g, (content) => pushToken(renderVector(content, 'left')));
      text = text.replace(/\\vec\s*([A-Za-zΑ-ωΩ])/g, (_match, content) => pushToken(renderVector(content, 'right')));
      text = text.replace(/\\overrightarrow\s*([A-Za-zΑ-ωΩ]+)/g, (_match, content) => pushToken(renderVector(content, 'right')));
      text = text.replace(/\\overleftarrow\s*([A-Za-zΑ-ωΩ]+)/g, (_match, content) => pushToken(renderVector(content, 'left')));

      // Do not try to protect generated HTML with regex here. Generated math
      // fragments are already protected as MATHTOKEN values at creation time.
      // Regex protection is fragile for nested vectors/fractions and was the
      // cause of visible </span><span> artifacts in formulas.

      const lineBreakToken = '\uE110MATHBR\uE111';

      text = text
        .replace(/\\begin\{(?:aligned|align|equation|cases|dcases|matrix|pmatrix|bmatrix|vmatrix|array)\}/g, '')
        .replace(/\\end\{(?:aligned|align|equation|cases|dcases|matrix|pmatrix|bmatrix|vmatrix|array)\}/g, '')
        .replace(/\\left/g, '')
        .replace(/\\right/g, '')
        // Ignore LaTeX delimiter sizing commands while keeping the actual
        // bracket that follows, e.g. \bigl[ ... \bigr] -> [ ... ].
        .replace(/\\(?:Bigg|bigg|Big|big)(?:l|r|m)?/g, '')
        .replace(/\\,/g, ' ')
        .replace(/\\;/g, ' ')
        .replace(/\\:/g, ' ')
        .replace(/\\!/g, '')
        .replace(/\\ /g, ' ')
        .replace(/\\quad/g, ' ')
        .replace(/\\qquad/g, '  ')
        .replace(/\\\\/g, lineBreakToken)
        .replace(/&/g, '');

      text = text
        .replace(/\\mathbb\{([^{}]+)\}/g, (_match, content) => renderMathAlphabet(content, 'mathbb'))
        .replace(/\\mathcal\{([^{}]+)\}/g, (_match, content) => renderMathAlphabet(content, 'mathcal'))
        .replace(/\\mathscr\{([^{}]+)\}/g, (_match, content) => renderMathAlphabet(content, 'mathscr'))
        .replace(/\\mathfrak\{([^{}]+)\}/g, (_match, content) => renderMathAlphabet(content, 'mathfrak'))
        .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
        .replace(/\\mathrm\{([^{}]+)\}/g, (_match, content) => normalizeChemicalText(content))
        .replace(/\\mathbf\{([^{}]+)\}/g, '$1')
        .replace(/\\boldsymbol\{([^{}]+)\}/g, '$1')
        .replace(/\\text\{([^{}]+)\}/g, '$1')
        .replace(/\\overline\{([^{}]+)\}/g, '¯$1')
        .replace(/\\hat\{([^{}]+)\}/g, '^$1');

      const commandMap = [
        ['\\oiiint', '∰'], ['\\oiint', '∯'], ['\\iiint', '∭'], ['\\iint', '∬'], ['\\oint', '∮'], ['\\int', '∫'],
        ['\\partial', '∂'], ['\\nabla', '∇'], ['\\grad', '∇'], ['\\Delta', 'Δ'], ['\\delta', 'δ'], ['\\varepsilon', 'ε'], ['\\epsilon', 'ε'],
        ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\Gamma', 'Γ'], ['\\lambda', 'λ'], ['\\Lambda', 'Λ'],
        ['\\mu', 'μ'], ['\\nu', 'ν'], ['\\xi', 'ξ'], ['\\Xi', 'Ξ'], ['\\pi', 'π'], ['\\Pi', 'Π'],
        ['\\rho', 'ρ'], ['\\sigma', 'σ'], ['\\Sigma', 'Σ'], ['\\tau', 'τ'], ['\\phi', 'φ'], ['\\varphi', 'φ'],
        ['\\Phi', 'Φ'], ['\\psi', 'ψ'], ['\\Psi', 'Ψ'], ['\\omega', 'ω'], ['\\Omega', 'Ω'], ['\\theta', 'θ'], ['\\Theta', 'Θ'],
        ['\\cdots', '⋯'], ['\\ldots', '…'], ['\\cdot', '·'], ['\\times', '×'], ['\\div', '÷'], ['\\pm', '±'], ['\\mp', '∓'],
        ['\\leqslant', '≤'], ['\\geqslant', '≥'], ['\\leq', '≤'], ['\\geq', '≥'], ['\\le', '≤'], ['\\ge', '≥'], ['\\neq', '≠'], ['\\ne', '≠'],
        ['\\approx', '≈'], ['\\simeq', '≃'], ['\\cong', '≅'], ['\\sim', '∼'], ['\\equiv', '≡'], ['\\propto', '∝'], ['\\to', '→'], ['\\mapsto', '↦'], ['\\longmapsto', '⟼'], ['\\rightarrow', '→'], ['\\longrightarrow', '⟶'], ['\\leftarrow', '←'], ['\\longleftarrow', '⟵'], ['\\Rightarrow', '⇒'], ['\\Longrightarrow', '⟹'], ['\\Leftrightarrow', '⇔'], ['\\Longleftrightarrow', '⟺'], ['\\iff', '⇔'],
        ['\\infty', '∞'], ['\\sum', '∑'], ['\\prod', '∏'], ['\\lim', 'lim'], ['\\sin', 'sin'], ['\\cos', 'cos'], ['\\tan', 'tan'],
        ['\\cot', 'cot'], ['\\sec', 'sec'], ['\\csc', 'csc'], ['\\ln', 'ln'], ['\\log', 'log'], ['\\max', 'max'], ['\\min', 'min'],
        ['\\sup', 'sup'], ['\\inf', 'inf'], ['\\det', 'det'], ['\\rank', 'rank'], ['\\dim', 'dim'], ['\\span', 'span'], ['\\vol', 'vol'],
        ['\\notin', '∉'], ['\\in', '∈'], ['\\subseteq', '⊆'], ['\\subset', '⊂'], ['\\supseteq', '⊇'], ['\\supset', '⊃'], ['\\cup', '∪'], ['\\cap', '∩'], ['\\setminus', '∖'], ['\\backslash', '∖'], ['\\emptyset', '∅'], ['\\varnothing', '∅'],
        ['\\mid', '∣'], ['\\middle|', '∣'], ['\\colon', ':'], ['\\ast', '*'], ['\\star', '★'], ['\\circ', '∘'], ['\\bullet', '•'],
        ['\\{', '{'], ['\\}', '}'], ['\\lbrace', '{'], ['\\rbrace', '}'],
        ['\\forall', '∀'], ['\\exists', '∃'], ['\\because', '∵'], ['\\therefore', '∴'], ['\\land', '∧'], ['\\lor', '∨'],
        ['\\|', '‖'], ['\\lVert', '‖'], ['\\rVert', '‖'], ['\\langle', '⟨'], ['\\rangle', '⟩'],
      ];

      commandMap.forEach(([command, symbol]) => {
        text = text.replaceAll(command, symbol);
      });

      // If an unsupported LaTeX command remains, do not display raw English-like
      // fragments such as "oint"/"iint". Keep the meaningful command name only
      // for harmless text commands; otherwise hide the backslash cleanly.
      text = text.replace(/\\([a-zA-Z]+)/g, (match, command) => {
        const harmlessTextCommands = new Set(['Dom', 'dom', 'domain', 'codomain', 'range']);
        return harmlessTextCommands.has(command) ? command : command;
      });
      text = text
        .replace(/\bmid\b/g, '∣')
        .replace(/\bin\b/g, '∈')
        .replace(/\bnotin\b/g, '∉')
        .replace(/\bsubseteq\b/g, '⊆')
        .replace(/\bsetminus\b/g, '∖')
        .replace(/\bto\b/g, '→')
        .replace(/\binfty\b/g, '∞')
        .replace(/\bdomain\b/gi, 'Dom');

      text = escapeHtml(text);

      text = text
        .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
        .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
        .replace(/_([A-Za-z0-9+\-∂Δδθπ∞]+)(?![A-Za-z0-9])/g, '<sub>$1</sub>')
        .replace(/\^\*/g, '<sup>*</sup>')
        .replace(/\^([A-Za-z0-9+\-∂Δδθπ∞*★]+)(?![A-Za-z0-9])/g, '<sup>$1</sup>')
        .replaceAll(lineBreakToken, '<br>');

      htmlTokens.forEach((html, index) => {
        text = text.replaceAll(`\uE100MATHTOKEN${index}\uE101`, html);
      });

      return text.replace(/\s{2,}/g, ' ');
    };

    function renderExpression(value = '') {
      return renderSimple(value);
    }

    return renderExpression(formula);
  };

  const stripMathDelimiters = (raw = '') => {
    return String(raw)
      .trim()
      .replace(/^\\\(/, '')
      .replace(/\\\)$/, '')
      .replace(/^\\\[/, '')
      .replace(/\\\]$/, '')
      .replace(/^\$\$/, '')
      .replace(/\$\$$/, '')
      .replace(/^\$/, '')
      .replace(/\$$/, '')
      .trim();
  };

  const readLatexGroup = (text, startIndex) => {
    let i = startIndex;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== '{') return null;

    let depth = 0;
    let content = '';
    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (char === '{') {
        depth += 1;
        if (depth > 1) content += char;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return { content, start: i, end: j + 1 };
        }
        content += char;
        continue;
      }
      content += char;
    }
    return null;
  };

  const looksLikeChemicalLatex = (content = '') => {
    const text = String(content);
    return /[A-Z][a-z]?\d|\)\d|\]\d|(?:Na|K|Ca|Mg|Al|Fe|Cu|Zn|Ag|Cl|Br|OH|COOH|COONa|OOCR|RCOO)/.test(text);
  };

  const normalizeChemicalLatexDigits = (content = '') => {
    if (!looksLikeChemicalLatex(content)) return content;

    const protectedCommands = [];
    const makeCommandToken = () => {
      // Use private-use characters only. The previous token contained ASCII
      // letters and digits, e.g. KATEXCMD0, so the chemical digit normalizer
      // converted it into KATEXCMD_{0} and the token could no longer be
      // restored before KaTeX rendered the formula.
      const index = protectedCommands.length;
      return `\uE300${String.fromCharCode(0xE320 + index)}\uE301`;
    };

    let text = String(content).replace(/\\[a-zA-Z]+(?:\s*\{(?:[^{}]|\{[^{}]*\})*\})?/g, (command) => {
      const token = makeCommandToken();
      protectedCommands.push({ token, command });
      return token;
    });

    text = text.replace(/([A-Za-zΑ-ωΩ\)\]])(\d+)/g, (_match, base, digits) => `${base}_{${digits}}`);

    protectedCommands.forEach(({ token, command }) => {
      text = text.replaceAll(token, command);
    });
    return text;
  };

  const normalizeKatexTextGroups = (formula = '') => {
    let output = '';
    let index = 0;
    const commandPattern = /\\(?:mathrm|text)\b/g;
    const text = String(formula);

    while (index < text.length) {
      commandPattern.lastIndex = index;
      const match = commandPattern.exec(text);
      if (!match) {
        output += text.slice(index);
        break;
      }

      output += text.slice(index, match.index);
      const group = readLatexGroup(text, commandPattern.lastIndex);
      if (!group) {
        output += match[0];
        index = commandPattern.lastIndex;
        continue;
      }

      const command = match[0];
      const content = command === '\\mathrm'
        ? normalizeChemicalLatexDigits(group.content)
        : group.content;
      output += `${command}{${content}}`;
      index = group.end;
    }

    return output;
  };


  const normalizeLinearAlgebraLatex = (formula = '') => {
    let text = String(formula || '');
    // AI often outputs plain linear algebra terms without operatorname.
    text = text
      .replace(/\\rank\s*\(([^()]+)\)/g, '\\operatorname{rank}($1)')
      .replace(/\\dim\s*\(([^()]+)\)/g, '\\operatorname{dim}($1)')
      .replace(/(^|[^\\])rank\s*\(([^()]+)\)/gi, '$1\\operatorname{rank}($2)')
      .replace(/(^|[^\\])tr\s*\(([^()]+)\)/gi, '$1\\operatorname{tr}($2)')
      .replace(/(^|[^\\])diag\s*\(([^()]+)\)/gi, '$1\\operatorname{diag}($2)')
      .replace(/(^|[^\\])span\s*\{/gi, '$1\\operatorname{span}\\{')
      .replace(/(^|[^\\])ker\s*\(/gi, '$1\\operatorname{Ker}(')
      .replace(/(^|[^\\])im\s*\(/gi, '$1\\operatorname{Im}(')
      .replace(/(^|[^\\])null\s*\(/gi, '$1\\operatorname{Null}(')
      .replace(/(^|[^\\])col\s*\(/gi, '$1\\operatorname{Col}(')
      .replace(/(^|[^\\])row\s*\(/gi, '$1\\operatorname{Row}(');

    // Common matrix notation copied from textbooks: A^T, A^{-1}, A* etc.
    text = text
      .replace(/([A-Za-z0-9\)\]\}])\s*\^\s*T\b/g, '$1^{T}')
      .replace(/([A-Za-z0-9\)\]\}])\s*\^\s*H\b/g, '$1^{H}')
      .replace(/([A-Za-z0-9\)\]\}])\s*\^\s*-1\b/g, '$1^{-1}')
      .replace(/([A-Za-z0-9\)\]\}])\s*\^\s*\*/g, '$1^{*}')
      .replace(/([A-Za-z0-9\)\]\}])\s*′/g, "$1'");

    return text;
  };

  const normalizeKatexSource = (raw = '') => {
    let formula = stripMathDelimiters(raw);

    formula = replaceUnicodeMathSymbols(formula);
    formula = normalizeUnsupportedLatexEnvironments(formula);
    formula = normalizeCommonLatexAliases(formula);
    formula = normalizeLinearAlgebraLatex(formula);

    formula = formula
      // Common model mistakes: missing leading backslash on commands.
      .replace(/(^|[^\\])xrightarrow\s*\{/g, '$1\\xrightarrow{')
      .replace(/(^|[^\\])xleftarrow\s*\{/g, '$1\\xleftarrow{')
      .replace(/(^|[^\\])mathrm\s*\{/g, '$1\\mathrm{')
      .replace(/(^|[^\\])text\s*\{/g, '$1\\text{')
      .replace(/(^|[^\\])ce\s*\{/g, '$1\\ce{')
      .replace(/(^|[^\\])pu\s*\{/g, '$1\\pu{')
      .replace(/\\xrightarrow\s*\{\s*\\Delta\s*\}/g, '\\xrightarrow{\\Delta}')
      .replace(/\\xleftarrow\s*\{\s*\\Delta\s*\}/g, '\\xleftarrow{\\Delta}')
      .replace(/\\operatorname\*?\{/g, '\\operatorname{')
      .replace(/\\DeclareMathOperator\{[^{}]+\}\{([^{}]+)\}/g, '\\operatorname{$1}')
      // KaTeX cannot reliably render raw CJK inside math scripts; wrap it.
      .replace(/([_^])\{([\u3400-\u9fff]+)\}/g, '$1{\\text{$2}}')
      .replace(/([_^])([\u3400-\u9fff])/g, '$1{\\text{$2}}');

    formula = normalizeKatexTextGroups(formula);
    return compactLatexWhitespace(formula);
  };

  const buildKatexOptions = (displayMode = false, throwOnError = true) => ({
    displayMode,
    throwOnError,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
    macros: KATEX_RENDER_MACROS,
    maxSize: 28,
    maxExpand: 10000,
  });

  const renderLatexToHtml = (raw = '', options = {}) => {
    const formula = normalizeKatexSource(raw);
    const displayMode = Boolean(options.displayMode);
    const katexRenderer = window.katex;

    if (katexRenderer && typeof katexRenderer.renderToString === 'function') {
      try {
        return katexRenderer.renderToString(formula, buildKatexOptions(displayMode, true));
      } catch (primaryError) {
        try {
          const relaxed = normalizeKatexSource(formula
            .replace(/\\tag\s*\{[^{}]*\}/g, '')
            .replace(/\\qedhere\b/g, '')
            .replace(/\\displaystyle\b/g, '')
            .replace(/\\textstyle\b/g, ''));
          return katexRenderer.renderToString(relaxed, buildKatexOptions(displayMode, true));
        } catch (secondaryError) {
          console.warn('[RichRenderer] KaTeX render failed, fallback to lightweight renderer:', secondaryError || primaryError);
        }
      }
    }

    return renderLatexFallbackToHtml(raw);
  };


  const renderInlineRichText = (raw = '') => {
    const tokens = [];
    let text = String(raw);

    const pushToken = (html) => {
      const token = `@@RICH_TOKEN_${tokens.length}@@`;
      tokens.push(html);
      return token;
    };

    const pushMathToken = (formula, className = 'rich-math-inline') => {
      const source = String(formula || '').trim();
      return pushToken(`<span class="${className}" data-math-source="${escapeHtml(source)}">${renderLatexToHtml(source)}</span>`);
    };

    // Protect inline code first so formulas inside code stay untouched.
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      return pushToken(`<code class="rich-inline-code">${escapeHtml(code)}</code>`);
    });

    // Common LaTeX inline forms returned by AI models: \(...\) and $...$.
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, formula) => {
      return pushMathToken(formula);
    });

    // Fallback: if a display formula reaches inline rendering, still render it
    // instead of showing raw \[...\] delimiters. Normal block splitting above
    // handles the usual case.
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, formula) => {
      return pushMathToken(formula, 'rich-math-inline rich-math-inline--display');
    });

      // Some models return set-builder notation without \( ... \), such as
    // \{(x,y) \mid a \le x \le b\}. Treat this as an inline formula.
    text = text.replace(/\\\{([^\n]{1,260}?)\\\}/g, (_match, formula) => {
      return pushMathToken(`\\{${formula}\\}`);
    });

    // Some models incorrectly write vectors as a leading arrow, e.g. →F = m→a.
    // Convert that compact form into the same over-letter vector style.
    text = text.replace(/→([A-Za-zΑ-ωΩ])(?=([\s=+\-·,.;:)）]|$))/g, (_match, symbol) => {
      return pushMathToken(`\\vec{${symbol}}`);
    });

    text = text.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, formula) => {
      return pushMathToken(formula);
    });

    text = escapeHtml(text);

    text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');

    tokens.forEach((html, index) => {
      text = text.replace(`@@RICH_TOKEN_${index}@@`, html);
    });

    return text;
  };

  const flushParagraph = (parts, blocks) => {
    if (!parts.length) return;
    blocks.push(`<p>${renderInlineRichText(parts.join(' '))}</p>`);
    parts.length = 0;
  };

  const flushList = (items, blocks, ordered = false) => {
    if (!items.length) return;
    const tag = ordered ? 'ol' : 'ul';
    blocks.push(`<${tag}>${items.map((item) => `<li>${renderInlineRichText(item)}</li>`).join('')}</${tag}>`);
    items.length = 0;
  };


  const normalizeMathBlocks = (source = '') => {
    // AI models often return block math in the middle of a paragraph, e.g.
    // "文字 \\[ formula \\] 文字". The previous renderer only recognized
    // block formulas when the delimiter started a line, so those delimiters
    // were displayed literally. This normalization splits block math out into
    // standalone lines before Markdown parsing.
    return String(source)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, formula) => `\n\\[\n${formula.trim()}\n\\]\n`)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => `\n$$\n${formula.trim()}\n$$\n`);
  };

  const renderRichText = (source = '') => {
    const lines = normalizeMathBlocks(source).replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    const paragraph = [];
    const listItems = [];
    let listOrdered = false;
    let codeMode = false;
    let codeLang = '';
    let codeLines = [];
    let mathMode = false;
    let mathLines = [];
    let mathEndDelimiter = '$$';

    const closeCode = () => {
      const langLabel = languageName(codeLang);
      blocks.push(`
        <pre class="rich-code-block">
          <div class="rich-code-head"><span>${escapeHtml(langLabel)}</span></div>
          <code>${escapeHtml(codeLines.join('\n'))}</code>
        </pre>
      `);
      codeMode = false;
      codeLang = '';
      codeLines = [];
    };

    const closeMath = () => {
      const formula = mathLines.join('\n').trim();
      blocks.push(`<div class="rich-math-block" data-math-source="${escapeHtml(formula)}">${renderLatexToHtml(formula, { displayMode: true })}</div>`);
      mathMode = false;
      mathLines = [];
      mathEndDelimiter = '$$';
    };

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (codeMode) {
        if (trimmed.startsWith('```')) {
          closeCode();
        } else {
          codeLines.push(line);
        }
        return;
      }

      if (mathMode) {
        if (trimmed === mathEndDelimiter) {
          closeMath();
        } else if (mathEndDelimiter === '\\]' && trimmed.endsWith('\\]')) {
          mathLines.push(line.replace(/\\]\s*$/, ''));
          closeMath();
        } else if (mathEndDelimiter === '$$' && trimmed.endsWith('$$')) {
          mathLines.push(line.replace(/\$\$\s*$/, ''));
          closeMath();
        } else {
          mathLines.push(line);
        }
        return;
      }

      const singleLineBracketMath = trimmed.match(/^\\\[([\s\S]+?)\\\]$/);
      const singleLineDollarMath = trimmed.match(/^\$\$([\s\S]+?)\$\$$/);
      if (singleLineBracketMath || singleLineDollarMath) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        const formula = (singleLineBracketMath || singleLineDollarMath)[1];
        blocks.push(`<div class="rich-math-block" data-math-source="${escapeHtml(formula)}">${renderLatexToHtml(formula, { displayMode: true })}</div>`);
        return;
      }

      if (trimmed.startsWith('\\[')) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        mathMode = true;
        mathEndDelimiter = '\\]';
        mathLines = [line.replace(/^\s*\\\[/, '')];
        return;
      }

      if (trimmed.startsWith('$$')) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        mathMode = true;
        mathEndDelimiter = '$$';
        mathLines = [line.replace(/^\s*\$\$/, '')];
        return;
      }

      const codeFence = trimmed.match(/^```\s*([\w#+.-]*)/);
      if (codeFence) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        codeMode = true;
        codeLang = codeFence[1] || '';
        codeLines = [];
        return;
      }

      if (trimmed === '$$') {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        mathMode = true;
        mathLines = [];
        return;
      }

      if (!trimmed) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        return;
      }

      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        blocks.push('<hr class="rich-hr">');
        return;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        const level = heading[1].length + 1;
        blocks.push(`<h${level}>${renderInlineRichText(heading[2])}</h${level}>`);
        return;
      }

      const quote = trimmed.match(/^>\s?(.+)$/);
      if (quote) {
        flushParagraph(paragraph, blocks);
        flushList(listItems, blocks, listOrdered);
        blocks.push(`<blockquote>${renderInlineRichText(quote[1])}</blockquote>`);
        return;
      }

      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      if (ordered || unordered) {
        flushParagraph(paragraph, blocks);
        const isOrdered = Boolean(ordered);
        if (listItems.length && listOrdered !== isOrdered) {
          flushList(listItems, blocks, listOrdered);
        }
        listOrdered = isOrdered;
        listItems.push((ordered || unordered)[1]);
        return;
      }

      flushList(listItems, blocks, listOrdered);
      paragraph.push(line);
    });

    if (codeMode) closeCode();
    if (mathMode) closeMath();
    flushParagraph(paragraph, blocks);
    flushList(listItems, blocks, listOrdered);

    return blocks.join('');
  };


  window.RichRenderer = {
    escapeHtml,
    languageName,
    renderLatexToHtml,
    renderInlineRichText,
    normalizeMathBlocks,
    renderRichText,
  };
})();
