# Workbench content animation / formula selection fixes

This patch fixes three regressions in the workbench content panel.

## 1. Formula selection returns complete formula source

KaTeX renders one LaTeX formula as many nested visual spans. Native browser selection may return only a visual fragment, especially for fractions, scripts, arrows, and block math. The selection controller now checks whether the selected range intersects any element with `data-math-source`. If it does, the follow-up context uses the complete original LaTeX source instead of trusting `selection.toString()`.

For mixed prose + formula selections, the visible selected text is kept and the complete formula source is appended as `完整公式：...` so the prompt is never missing the expression.

## 2. Page-enter flicker removed

During question switches, the renderer now uses a preparing-enter phase before new DOM is mounted:

1. old messages fade out;
2. content stream enters `is-content-preparing-enter`;
3. new DOM is mounted hidden with animation disabled;
4. messages fade in once;
5. messages are marked `is-content-transition-settled` before transition classes are removed.

This prevents the base `messageIn` animation from replaying after the enter animation completes, which caused a tiny end-of-animation flicker.

## 3. Delete/reset fade starts immediately

`learningContentRenderKey` no longer includes the transient `animation.resettingTree` flag. Reset start is also ignored by the content render subscriber. This prevents reset-start from re-rendering or replacing the content panel before `main-tree-reset.js` can apply its fade-out animation.

The reset/delete flow remains:

- `main-tree-reset:start` sets the reset state;
- current content messages receive reset-leaving classes;
- text fades out;
- the actual learning tree is cleared after the animation window.
