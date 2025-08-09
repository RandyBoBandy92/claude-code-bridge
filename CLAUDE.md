# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **Claude Code Bridge** plugin for Obsidian - a fully functional TypeScript plugin that implements a WebSocket-based MCP (Model Context Protocol) server, enabling seamless integration between Obsidian and Claude Code's `/ide` command. The plugin creates a secure, authenticated connection that allows Claude Code to appear as "Obsidian" in the IDE list, with full support for file and selection tagging.

## Development Commands

### Build and Development
- `npm run dev` - Start development mode with file watching and automatic recompilation with hot reload
- `npm run build` - Build production version with TypeScript type checking
- `npm run version` - Bump version and update manifest files

**Note:** This project uses a hot reload plugin, so `npm run dev` should be run in the background during development for automatic plugin reloading in Obsidian.

### TypeScript Compilation
The build process includes TypeScript type checking with `tsc -noEmit -skipLibCheck` before bundling with esbuild.

### Linting (Optional)
- Install ESLint globally: `npm install -g eslint`
- Run ESLint: `eslint main.ts`
- Analyze entire src folder: `eslint .\src\`

## Architecture Overview

### Core Components

**ClaudeCodeBridge Plugin Class** (`main.ts:18-338`)
- Main plugin class extending Obsidian's Plugin base class
- Manages WebSocket server lifecycle and connections
- Handles MCP (Model Context Protocol) message routing
- Provides file tagging functionality via keyboard shortcut

**IDE Discovery System** (`main.ts:132-151`)
- Creates lock files in `~/.claude/ide/` for Claude Code's `/ide` command to discover
- Registers Obsidian as an available IDE connection option
- Provides connection details (port, type, name) for automatic detection

**WebSocket Communication Layer** (`main.ts:186-236`)
- Creates HTTP server with WebSocket upgrade handling using Node.js built-in modules
- Implements RFC 6455 compliant WebSocket protocol without external dependencies
- Includes secure authentication using `x-claude-code-ide-authorization` header validation
- Manages multiple concurrent connections with proper frame parsing and masking
- Enables Claude Code's `/ide` command to connect to Obsidian securely
- Uses Node.js `http`, `crypto` modules for full Electron compatibility

**Message Handling System** (`main.ts:187-261`)
- Supports `files/read` - Read file contents from Obsidian vault
- Supports `workspace/selection` - Get current editor selection and cursor position
- JSON-RPC 2.0 compliant message format
- Error handling with proper MCP error codes

### Key Features

**IDE Registration for `/ide` Command**
- Creates lock file at `~/.claude/ide/{port}.lock` with Obsidian details
- Allows Claude Code's `/ide` command to discover and connect to Obsidian
- Shows as "Obsidian" option in available IDE connections

**File/Selection Tagging** (`main.ts:477-527`)
- Hotkey: `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T` (Windows/Linux)  
- Uses MCP-compliant `at_mentioned` method with `filePath`, `lineStart`, `lineEnd` parameters
- Tags entire file if no selection, or specific text selection with 0-indexed line numbers
- Broadcasts at-mentions to all connected Claude Code instances
- Shows notifications with tagged content details and line ranges

**Real-time File Context Tracking** (`main.ts:101-143`)
- Automatic `selection_changed` notifications when switching files or changing selections
- Shows current file in Claude Code's "In [filename]" indicator (bottom corner)
- Tracks `file-open`, `active-leaf-change`, and `editor-change` events
- Debounced selection tracking (300ms) to prevent notification spam
- Sends initial file context when Claude Code connects
- Full parity with VS Code/Cursor IDE integration

**Connection Management** (`main.ts:153-184`)
- Tracks active WebSocket connections in a Set
- Handles connection lifecycle (connect, message, close, error)
- Automatic cleanup on plugin unload

## Plugin Configuration

### Settings Structure
```typescript
interface ClaudeCodeBridgeSettings {
    port: number;        // Dynamic port (auto-assigned)
    enabled: boolean;    // Enable/disable bridge functionality
}
```

### Lock File Format
Created at `~/.claude/ide/{port}.lock` for `/ide` command discovery:
```json
{
    "port": 0,
    "name": "Obsidian",
    "type": "obsidian", 
    "pid": 12345,
    "created": "2024-01-01T00:00:00.000Z"
}
```

## Development Workflow

### Plugin Installation for Development
1. Clone to `.obsidian/plugins/claude-code-bridge/` in your vault
2. Run `npm install` to install dependencies
3. Run `npm run dev` for development with auto-reload
4. Enable plugin in Obsidian settings
5. Plugin will appear as "Obsidian" option when running Claude Code's `/ide` command

### Testing the Bridge
1. Start the plugin (check console logs for server startup confirmation)
2. Run Claude Code's `/ide` command - Obsidian should appear as an available option
3. Connect to Obsidian from Claude Code
4. Test file tagging with `Cmd+Shift+T` and selection tagging
5. Monitor console logs for message flow
6. Verify MCP protocol compliance

### Key Dependencies
- **obsidian** - Core Obsidian API for plugin development
- Built-in Node.js modules: `fs`, `path`, `os`, `net`, `http`, `crypto`
- **Note:** Zero external dependencies for WebSocket functionality - uses pure Node.js implementation for maximum Electron compatibility

### Authentication System
- **Secure Token Validation**: Uses UUID v4 authentication tokens stored in lock files
- **Header-Based Auth**: Validates `x-claude-code-ide-authorization` header on WebSocket upgrade
- **Connection Security**: Rejects unauthorized connections with proper HTTP error responses
- **Token Generation**: Cryptographically secure random tokens using Node.js crypto module

## Claude Code Integration

This plugin is specifically designed to work with Claude Code's `/ide` command:

### IDE Discovery
- Plugin creates lock files that Claude Code's `/ide` command automatically detects
- Obsidian appears as "Obsidian" in the list of available IDE connections
- No manual configuration required - automatic discovery and connection

### MCP Protocol Implementation
The plugin implements the WebSocket variant of Model Context Protocol (MCP) used by Claude Code's official IDE extensions:

### Supported Methods
- `initialize` - MCP handshake with server capabilities and protocol version
- `initialized` - Client initialization confirmation
- `files/read` - Returns file content from Obsidian vault
- `workspace/selection` - Returns current editor selection and cursor position  
- `resources/list` - Returns available resources (currently empty)

### Supported Notifications
- `at_mentioned` - Sent when user tags files/selections with `Cmd+Shift+T`
  - Format: `{filePath: string, lineStart?: number, lineEnd?: number}`
- `selection_changed` - Sent automatically when switching files or changing selections  
  - Format: `{text: string, filePath: string, fileUrl: string, selection: {start, end, isEmpty}}`
  - Enables "In [filename]" display in Claude Code bottom corner

### Message Format
All messages follow JSON-RPC 2.0 specification with MCP-specific parameters.

## Build System

Uses esbuild for fast bundling with TypeScript compilation:
- Entry point: `main.ts`
- Output: `main.js` (CommonJS format)
- External dependencies: Obsidian API, Electron, CodeMirror modules
- Development: Inline source maps and file watching
- Production: Minified output without source maps

## Plugin Manifest

The plugin is configured as:
- ID: `claude-code-bridge`  
- Desktop-only plugin (requires Node.js WebSocket server)
- Minimum Obsidian version: 0.15.0
- Integrates Obsidian with Claude Code's `/ide` command for seamless AI assistance