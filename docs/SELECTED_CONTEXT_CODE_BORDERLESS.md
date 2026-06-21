# Selected context code borderless rendering

This patch keeps code rendered inside the selected-context/original-text panel visually borderless.

## Goal

The selected-context panel is a lightweight, borderless reading area. When the selected original text contains code, the display should preserve code layout without making the code look like a separate bordered card.

## Changes

Updated `frontend/styles.css` so only code inside `.selected-context-body` uses a stricter borderless style:

- code block wrapper has no border, no shadow, no background, and no rounded card shape
- code body has no border, no shadow, no background, and no rounded card shape
- code header has no separator border and no background
- inline code has no border or shadow and uses only minimal transparent text emphasis

The normal answer body code rendering remains unchanged outside `.selected-context-body`.

## Data safety

This is display-only. The selected context text sent to AI remains the original Markdown/LaTeX/code text.
