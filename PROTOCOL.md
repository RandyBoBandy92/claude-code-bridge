# Protocol Details

## MCP (Model Context Protocol) Implementation

The Claude Code Bridge plugin implements Claude Code's WebSocket variant of MCP (Model Context Protocol) to enable seamless communication between Obsidian and Claude Code.

## Supported Methods

### Request-Response Methods

**`initialize`** - Handshake with server capabilities
- Sent by Claude Code during connection establishment
- Returns server capabilities and protocol version

**`initialized`** - Client initialization confirmation  
- Sent by Claude Code after receiving initialize response
- Confirms the connection is ready for use

**`files/read`** - Read file contents from vault
- Request: `{"method": "files/read", "params": {"path": "/file/path.md"}}`
- Response: Returns file content as string

**`workspace/selection`** - Get current editor selection
- Request: `{"method": "workspace/selection"}`
- Response: Returns current selection and cursor position

**`resources/list`** - List available resources
- Request: `{"method": "resources/list"}`
- Response: Returns available resources (currently empty)

## Notifications Sent by Plugin

### `at_mentioned` - File/Selection Tagging

Sent when user tags files or selections using `Cmd+Option+K` (Mac) or `Ctrl+Alt+K` (Windows/Linux).

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

**Parameters:**
- `filePath` (string): Path to the tagged file relative to vault root
- `lineStart` (number, optional): Starting line number (0-indexed) for selections
- `lineEnd` (number, optional): Ending line number (0-indexed) for selections

### `selection_changed` - Real-time File Context

Sent automatically when switching files or changing selections. Enables the "In [filename]" display in Claude Code's bottom corner.

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

**Parameters:**
- `text` (string): Currently selected text (empty if no selection)
- `filePath` (string): Path to active file relative to vault root
- `fileUrl` (string): File URL for the active file
- `selection` (object): Selection range with start/end positions and isEmpty flag

## Authentication Flow

The plugin implements secure token-based authentication:

1. **Token Generation**: Plugin generates UUID v4 authentication token using `crypto.randomBytes()`
2. **Lock File Storage**: Token stored in lock file at `~/.claude/ide/{port}.lock` with restricted permissions (600)
3. **Header Validation**: Claude Code sends token in `x-claude-code-ide-authorization` header
4. **WebSocket Upgrade**: Plugin validates token during WebSocket upgrade request
5. **Connection Established**: WebSocket connection established if authentication succeeds

## WebSocket Communication

### Connection Details
- **Protocol**: WebSocket (RFC 6455 compliant)
- **Host**: `127.0.0.1` (localhost only)
- **Port**: Dynamically assigned (0-65535)
- **Subprotocol**: `mcp`

### Message Format
All messages follow JSON-RPC 2.0 specification:

```json
{
  "jsonrpc": "2.0",
  "method": "method_name",
  "params": { ... },
  "id": "request_id"
}
```

### Resource Limits
- **Max Connections**: 10 concurrent connections
- **Buffer Size**: 1MB limit on WebSocket frame buffers
- **Message Size**: 10MB limit on JSON messages
- **Health Checks**: 30-second intervals for dead connection cleanup

## IDE Discovery

The plugin registers with Claude Code's `/ide` command through lock files:

**Lock File Location**: `~/.claude/ide/{port}.lock`

**Lock File Format**:
```json
{
  "pid": 12345,
  "workspaceFolders": ["/path/to/vault"],
  "ideName": "Obsidian",
  "transport": "ws", 
  "runningInWindows": false,
  "authToken": "uuid-v4-token",
  "port": 54321
}
```

This allows Claude Code to automatically discover Obsidian instances and display them in the `/ide` command list.

## Error Handling

### Common Error Codes
- **-32600**: Invalid Request (malformed JSON-RPC)
- **-32601**: Method Not Found
- **-32602**: Invalid Parameters
- **-32603**: Internal Error

### Authentication Errors
- **401 Unauthorized**: Missing or invalid authentication token
- **503 Service Unavailable**: Connection limit exceeded

### Connection Management
- Automatic cleanup of dead connections
- Graceful handling of network interruptions  
- Proper WebSocket close frame handling
- Resource cleanup on plugin unload

## Debugging

### Enable Debug Logging
The plugin provides detailed logging in development mode:

**Connection Events**:
- "Authentication successful" - WebSocket handshake completed
- "Client connected" - New connection established
- "Client disconnected" - Connection terminated

**Message Flow**:
- "Raw data received" - Incoming WebSocket frames
- "Parsed message" - Decoded JSON-RPC messages
- "Sent at-mention" - Outgoing tag notifications

**Health Monitoring**:
- "Health check: N active connections" - Periodic connection status
- "Removing dead connection" - Cleanup of terminated connections

### Console Access
Open Obsidian's Developer Tools (Ctrl/Cmd+Shift+I) and check the Console tab for detailed protocol logs and error messages.