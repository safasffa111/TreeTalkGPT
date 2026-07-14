# TreeTalk Desktop

> A structured AI conversation workspace for building, organizing and revisiting knowledge.

TreeTalk is an Electron desktop application that improves the way people interact with AI. Instead of treating conversations as temporary chats, TreeTalk preserves the logical structure of questions, answers and follow-up exploration.

## Features

### 🌳 Conversation Tree

- Organize AI conversations as expandable question paths
- Keep complete context during follow-up questions
- Return to previous reasoning branches

### 🧠 Knowledge Workspace

- Save useful AI conversations
- Manage personal knowledge collections
- Build reusable learning resources

### ✏️ Context-aware Questions

- Select text, code or formulas
- Ask questions based on selected content
- Automatically keep parent context

### 🖥️ Cross Platform

Available builds:

- Windows 11 x64
- macOS Intel x64
- macOS Apple Silicon arm64

## Downloads

Release packages include:

```
TreeTalk-win-x64
TreeTalk-macOS-Intel
TreeTalk-macOS-Apple-Silicon
```

## Technology

- Electron
- JavaScript
- HTML / CSS
- Local-first storage architecture

## Window Design

TreeTalk uses a custom desktop window experience:

- Main workspace window removes macOS traffic-light buttons
- Custom controls are integrated into the application UI
- External authentication windows keep native macOS behavior

## Development

Install dependencies:

```bash
npm install
```

Run development mode:

```bash
npm start
```

Build:

```bash
npm run build
```

## Project Goal

TreeTalk is not only a chat client. Its goal is to create a better human-AI interaction model where conversations become structured knowledge.

## Privacy

TreeTalk follows a local-first approach. User conversations, knowledge data and attachments are stored locally unless the user chooses otherwise.

Do not commit:

- API keys
- Account credentials
- Private knowledge databases

## License

This project is prepared for open source release. A formal open source license should be selected before public distribution.
