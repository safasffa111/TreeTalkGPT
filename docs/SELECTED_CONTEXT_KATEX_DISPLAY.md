# Selected Context KaTeX Display

This hotfix keeps the selected-context payload unchanged for AI prompts, while making the selected-context card render LaTeX formulas with the existing rich/KaTeX renderer.

## Why

Formula selections from KaTeX are stored as complete source text, for example:

```text
\\mathrm{C_3H_5(OOCR)_3 + 3\\ NaOH \\to C_3H_5(OH)_3 + 3\\ RCOONa}
```

That raw text is correct for prompt payloads, but the top selected-context card previously displayed it as plain text when it had no `$...$`, `$$...$$`, `\\(...\\)`, or `\\[...\\]` delimiters.

## What changed

`workbench-renderer.js` now uses a display-only formatter for `node.selectedTextContext`:

- bare LaTeX-looking selections are wrapped as display math before rendering;
- `完整公式：...`, `公式：...`, and `LaTeX：...` lines render the formula with KaTeX;
- the original `node.selectedTextContext` is not modified;
- `prompt-builder.js` and API request payloads still receive the complete raw formula source.

## Boundary

This is intentionally a presentation-layer change only. The learning node, annotations, selection object, and AI prompt context remain raw and stable.
