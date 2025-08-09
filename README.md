# Claude Code Bridge for Obsidian

A seamless integration between [Obsidian](https://obsidian.md) and [Claude Code](https://claude.ai/code) that enables Obsidian to appear as an available IDE in Claude Code's `/ide` command. Tag files and selections in Obsidian and send them directly to Claude Code for AI-powered analysis and assistance.

## Features

🔗 **Seamless IDE Integration** - Obsidian appears as "Obsidian" in Claude Code's `/ide` command list  
🔐 **Secure Authentication** - Uses cryptographic tokens for secure WebSocket connections  
📝 **File & Selection Tagging** - Tag entire files or specific text selections with `Cmd+Option+K`  
📍 **Real-time File Context** - Shows "In [filename]" in Claude Code when switching files  
🚀 **Zero Dependencies** - Pure Node.js implementation using only built-in modules  
⚡ **Real-time Communication** - MCP-compliant WebSocket protocol for instant messaging  
🛡️ **Connection Security** - Authenticated connections with proper error handling  

## Quick Start

### Installation

1. **Download the Plugin**
   - Clone this repository into your Obsidian vault's plugins directory:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins/
   git clone https://github.com/yourusername/claude-code-bridge.git
   ```

2. **Install Dependencies**
   ```bash
   cd claude-code-bridge
   npm install
   ```

3. **Build the Plugin**
   ```bash
   npm run build
   ```

4. **Enable in Obsidian**
   - Open Obsidian Settings → Community Plugins
   - Enable "Claude Code Bridge"
   - Check console logs for "Claude Code Bridge: Started on port [port]" confirmation

### Usage

1. **Connect Claude Code to Obsidian**
   ```bash
   # In your terminal, run Claude Code's IDE command
   claude /ide
   ```
   - Select "Obsidian" from the available IDE list
   - Status should change to "Connected to Obsidian"

2. **Tag Files and Selections**
   - **Tag entire file**: Place cursor in file, press `Cmd+Option+K` (Mac) or `Ctrl+Alt+K` (Windows/Linux)
   - **Tag selection**: Select text, press `Cmd+Option+K` (Mac) or `Ctrl+Alt+K` (Windows/Linux)
   - Tagged content is instantly available to Claude Code for analysis

3. **Verify Connection & File Context**
   - **"In [filename]" appears in Claude Code's bottom corner** showing your current file
   - Switch between files in Obsidian to see real-time context updates
   - Console logs show connection and tagging activity
   - Claude Code receives at-mentions for tagged content

## How It Works

### Architecture

The plugin creates a **WebSocket-based MCP (Model Context Protocol) server** that Claude Code can connect to:

1. **Lock File Discovery** - Creates `~/.claude/ide/{port}.lock` for Claude Code's `/ide` command to discover
2. **Secure Authentication** - Validates `x-claude-code-ide-authorization` header with cryptographic tokens  
3. **WebSocket Communication** - RFC 6455 compliant WebSocket server with custom frame parsing
4. **MCP Protocol** - Implements Claude Code's WebSocket variant of Model Context Protocol
5. **At-Mention Broadcasting** - Sends tagged content using `at_mentioned` notifications
6. **Real-time Context Tracking** - Automatically sends `selection_changed` notifications for file context

### Technical Implementation

- **Zero External Dependencies** - Uses only Node.js built-in modules (`http`, `crypto`, `fs`, `net`)
- **Electron Compatible** - Designed specifically for Obsidian's Electron environment
- **Secure by Design** - Authentication required, connections bound to localhost only
- **Hot Reload Support** - Development workflow with automatic plugin reloading

## Development

### Prerequisites

- Node.js >= 16
- Obsidian >= 0.15.0
- Basic TypeScript knowledge

### Development Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/claude-code-bridge.git
   cd claude-code-bridge
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start Development Mode**
   ```bash
   npm run dev
   ```
   This starts esbuild in watch mode with automatic recompilation.

4. **Enable Hot Reload** (Optional but Recommended)
   - Install a hot reload plugin for Obsidian
   - Plugin will automatically reload when files change

### Build Commands

- `npm run dev` - Development mode with file watching and source maps
- `npm run build` - Production build with TypeScript type checking
- `npm run version` - Bump version and update manifest files

### Key Files

- `main.ts` - Core plugin implementation with WebSocket server
- `manifest.json` - Plugin metadata and configuration  
- `CLAUDE.md` - Development guidance and architecture documentation
- `esbuild.config.mjs` - Build configuration for TypeScript compilation

## Protocol Details

### MCP (Model Context Protocol) Implementation

The plugin implements Claude Code's WebSocket variant of MCP:

**Supported Methods:**
- `initialize` - Handshake with server capabilities
- `initialized` - Client initialization confirmation
- `files/read` - Read file contents from vault
- `workspace/selection` - Get current editor selection
- `resources/list` - List available resources

**Notifications Sent:**
- `at_mentioned` - When files/selections are tagged
  ```json
  {
    "jsonrpc": "2.0",
    "method": "at_mentioned", 
    "params": {
      "filePath": "/path/to/file.md",
      "lineStart": 10,
      "lineEnd": 15
    }
  }
  ```

- `selection_changed` - When switching files or changing selections (enables file context display)
  ```json
  {
    "jsonrpc": "2.0",
    "method": "selection_changed",
    "params": {
      "text": "selected text",
      "filePath": "/path/to/file.md",
      "fileUrl": "file:///path/to/file.md",
      "selection": {
        "start": {"line": 0, "character": 0},
        "end": {"line": 0, "character": 10},
        "isEmpty": false
      }
    }
  }
  ```

### Authentication Flow

1. Plugin generates UUID v4 authentication token
2. Token stored in lock file at `~/.claude/ide/{port}.lock`
3. Claude Code reads token and sends in `x-claude-code-ide-authorization` header
4. Plugin validates token on WebSocket upgrade request
5. Connection established if authentication succeeds

## Troubleshooting

### Common Issues

**Plugin Not Appearing in `/ide` List**
- Check if plugin is enabled in Obsidian settings
- Verify lock file exists: `ls ~/.claude/ide/`
- Check console for "Lock file created" message

**"IDE disconnected" in Claude Code**
- Ensure authentication is working (check console logs)
- Try disabling and re-enabling the plugin
- Check for firewall blocking localhost connections

**Tagging Not Working** 
- Verify connection by checking console for connection logs
- Check console for "Sent at-mention to Claude Code" messages
- Ensure file is saved and has valid path

### Debug Mode

Enable detailed logging by checking the browser console:
- "Authentication successful" - WebSocket handshake completed
- "Raw data received" - Messages from Claude Code
- "Sent at-mention" - Tagged content broadcasts

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and test thoroughly
4. Run `npm run build` to ensure TypeScript compilation
5. Submit a pull request with detailed description

### Development Guidelines

- Follow existing code patterns and conventions
- Add comprehensive error handling
- Update documentation for new features
- Test with both file and selection tagging
- Verify MCP protocol compliance

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [claudecode.nvim](https://github.com/coder/claudecode.nvim) for protocol reverse-engineering
- Built on the [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- Implements [Model Context Protocol (MCP)](https://spec.modelcontextprotocol.io) WebSocket variant

---

**Made with ❤️ for the Obsidian and Claude Code communities**