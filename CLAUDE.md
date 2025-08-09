# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **Claude Code Bridge** plugin for Obsidian - a TypeScript plugin that creates a WebSocket bridge between Obsidian and Claude Code's `/ide` command, enabling Obsidian to appear as an available IDE connection. The plugin allows users to tag files or text selections in Obsidian and send them directly to Claude Code for analysis.

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

**WebSocket Communication Layer** (`main.ts:70-182`)
- Creates HTTP server with WebSocket upgrade handling using Node.js built-in modules
- Implements custom WebSocket protocol without external dependencies
- Manages multiple concurrent connections using raw TCP sockets
- Enables Claude Code's `/ide` command to connect to Obsidian
- Uses Node.js `http`, `crypto` modules for Electron compatibility

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

**File/Selection Tagging** (`main.ts:263-317`)
- Hotkey: `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T` (Windows/Linux)
- Tags entire file if no selection, or specific text selection with line numbers
- Broadcasts context to all connected Claude Code instances
- Shows notifications with tagged content details

**Connection Management** (`main.ts:153-184`)
- Tracks active WebSocket connections in a Set
- Handles connection lifecycle (connect, message, close, error)
- Updates status bar with connection count and status
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
1. Start the plugin (check status bar for "Listening on {port}")
2. Run Claude Code's `/ide` command - Obsidian should appear as an available option
3. Connect to Obsidian from Claude Code
4. Test file tagging with `Cmd+Shift+T` and selection tagging
5. Monitor console logs for message flow
6. Verify MCP protocol compliance

### Key Dependencies
- **obsidian** - Core Obsidian API for plugin development
- Built-in Node.js modules: `fs`, `path`, `os`, `net`, `http`, `crypto`
- **Note:** This implementation avoids external WebSocket libraries to ensure compatibility with Obsidian's Electron environment

## Claude Code Integration

This plugin is specifically designed to work with Claude Code's `/ide` command:

### IDE Discovery
- Plugin creates lock files that Claude Code's `/ide` command automatically detects
- Obsidian appears as "Obsidian" in the list of available IDE connections
- No manual configuration required - automatic discovery and connection

### MCP Protocol Implementation
The plugin implements a subset of the Model Context Protocol (MCP) for communication with Claude Code:

### Supported Methods
- `files/read` - Returns file content from Obsidian vault
- `workspace/selection` - Returns current editor selection and cursor position
- `context/add` - Receives tagged content from Obsidian UI

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