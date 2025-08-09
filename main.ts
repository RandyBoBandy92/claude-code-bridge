import { App, Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as net from "net";
import * as http from "http";
import * as crypto from "crypto";

interface ClaudeCodeBridgeSettings {
	port: number;
	enabled: boolean;
}

const DEFAULT_SETTINGS: ClaudeCodeBridgeSettings = {
	port: 0, // Will be set dynamically
	enabled: true,
};
export default class ClaudeCodeBridge extends Plugin {
	settings: ClaudeCodeBridgeSettings;
	private httpServer: http.Server | null = null;
	private port: number = 0;
	private lockFile: string = "";
	private connections: Set<any> = new Set();
	private authToken: string = "";
	private currentFile: string | null = null;
	private statusBarItem: HTMLElement | null = null;
	private selectionChangeTimeout: NodeJS.Timeout | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize the Claude Code bridge
		if (this.settings.enabled) {
			await this.initializeBridge();
		}

		// Add the main tagging command with hotkey
		this.addCommand({
			id: "tag-for-claude",
			name: "Tag file/selection for Claude Code",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "t" }],
			editorCallback: (editor: Editor, view: MarkdownView) =>
				this.tagForClaude(editor, view),
		});

		// Add status bar item to show bridge status
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar(this.statusBarItem);

		// Register workspace events for file tracking
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.handleFileChange(file);
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const activeFile = this.app.workspace.getActiveFile();
				this.handleFileChange(activeFile);
			})
		);

		// Also track selection changes within the same file
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor) => {
				if (this.connections.size > 0 && this.currentFile) {
					// Debounce selection changes to avoid spam
					clearTimeout(this.selectionChangeTimeout);
					this.selectionChangeTimeout = setTimeout(() => {
						this.sendSelectionChanged(this.currentFile!);
					}, 300);
				}
			})
		);

		console.log(
			"Claude Code Bridge plugin loaded and initialized successfully"
		);
	}

	async onunload() {
		if (this.selectionChangeTimeout) {
			clearTimeout(this.selectionChangeTimeout);
		}
		await this.closeBridge();
		console.log("Claude Code Bridge unloaded");
	}

	private updateStatusBar(statusBarItem: HTMLElement) {
		if (this.httpServer && this.connections.size > 0) {
			statusBarItem.setText(
				`Claude Code: Connected (${this.connections.size})`
			);
		} else if (this.httpServer) {
			statusBarItem.setText(`Claude Code: Listening on ${this.port}`);
		} else {
			statusBarItem.setText("Claude Code: Disconnected");
		}
	}

	private handleFileChange(file: any) {
		const newFilePath = file?.path || null;
		
		// Only notify if file actually changed and we have connections
		if (newFilePath !== this.currentFile && this.connections.size > 0) {
			this.currentFile = newFilePath;
			
			if (newFilePath) {
				console.log(`File changed to: ${newFilePath}`);
				this.sendSelectionChanged(newFilePath);
			}
		}
	}

	private sendSelectionChanged(filePath: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const selection = editor.getSelection();

		const selectionChangedMessage = {
			jsonrpc: "2.0",
			method: "selection_changed",
			params: {
				text: selection || "",
				filePath: filePath,
				fileUrl: `file://${filePath}`,
				selection: {
					start: { line: cursor.line, character: cursor.ch },
					end: { line: cursor.line, character: cursor.ch + (selection?.length || 0) },
					isEmpty: !selection || selection.length === 0
				}
			}
		};

		this.broadcast(selectionChangedMessage);
		console.log("Sent selection_changed notification:", selectionChangedMessage);
	}

	private async initializeBridge() {
		try {
			// Find available port
			this.port = await this.findAvailablePort();

			// Create HTTP server with WebSocket upgrade handling
			this.httpServer = http.createServer();

			// Handle WebSocket upgrade requests
			this.httpServer.on("upgrade", (request, socket, head) => {
				this.handleWebSocketUpgrade(request, socket, head);
			});

			// Start the server
			this.httpServer.listen(this.port, "127.0.0.1", () => {
				console.log(
					`Claude Code Bridge: HTTP server started on port ${this.port}`
				);
			});

			// Create lock file for IDE detection
			await this.createLockFile();

			console.log(
				`Claude Code Bridge: WebSocket server started on port ${this.port}`
			);
			new Notice(
				`Claude Code Bridge: Started on port ${this.port} - Lock file: ${this.lockFile}`
			);
		} catch (error) {
			console.error("Failed to initialize Claude Code bridge:", error);
			new Notice(
				`Claude Code Bridge: Failed to start - ${error.message}`
			);
		}
	}

	private async closeBridge() {
		// Close all connections
		this.connections.forEach((socket) => {
			if (!socket.destroyed) {
				socket.destroy();
			}
		});
		this.connections.clear();

		// Close server
		if (this.httpServer) {
			this.httpServer.close();
			this.httpServer = null;
		}

		// Remove lock file
		if (this.lockFile && fs.existsSync(this.lockFile)) {
			try {
				fs.unlinkSync(this.lockFile);
				console.log("Lock file removed");
			} catch (error) {
				console.error("Failed to remove lock file:", error);
			}
		}
	}

	private async findAvailablePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address && typeof address === "object") {
					const port = address.port;
					server.close(() => resolve(port));
				} else {
					reject(new Error("Could not get server address"));
				}
			});
			server.on("error", reject);
		});
	}

	private async createLockFile() {
		const claudeDir = path.join(os.homedir(), ".claude", "ide");

		// Ensure directory exists
		if (!fs.existsSync(claudeDir)) {
			fs.mkdirSync(claudeDir, { recursive: true });
		}

		this.lockFile = path.join(claudeDir, `${this.port}.lock`);

		// Generate auth token
		this.authToken =
			crypto.randomBytes(16).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(6).toString("hex");

		const lockData = {
			pid: process.pid,
			workspaceFolders: [
				this.app.vault.adapter.basePath || process.cwd(),
			],
			ideName: "Obsidian",
			transport: "ws",
			runningInWindows: process.platform === "win32",
			authToken: this.authToken,
			port: this.port,
		};

		fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2));
		console.log(`Lock file created: ${this.lockFile}`);
	}

	private handleWebSocketUpgrade(request: any, socket: any, head: Buffer) {
		console.log("WebSocket upgrade request:", {
			headers: request.headers,
			url: request.url,
		});

		const key = request.headers["sec-websocket-key"];
		if (!key) {
			console.log("No sec-websocket-key header, rejecting");
			socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
			return;
		}

		// Validate authentication token
		const authHeader = request.headers["x-claude-code-ide-authorization"];
		if (!authHeader) {
			console.log("Missing authentication header, rejecting");
			socket.end(
				"HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nMissing authentication header: x-claude-code-ide-authorization"
			);
			return;
		}

		if (authHeader !== this.authToken) {
			console.log("Invalid authentication token, rejecting");
			socket.end(
				"HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nInvalid authentication token"
			);
			return;
		}

		console.log("Authentication successful");

		// Generate WebSocket accept key
		const acceptKey = crypto
			.createHash("sha1")
			.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
			.digest("base64");

		// Send WebSocket handshake response
		const responseHeaders = [
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${acceptKey}`,
			"Sec-WebSocket-Protocol: mcp",
			"",
			"",
		].join("\r\n");

		console.log("Sending WebSocket handshake response:", responseHeaders);
		socket.write(responseHeaders);

		// Handle the WebSocket connection
		this.handleClaudeConnection(socket);
	}

	private handleClaudeConnection(socket: any) {
		this.connections.add(socket);
		console.log(
			`Claude Code connected. Total connections: ${this.connections.size}`
		);
		if (this.statusBarItem) {
			this.updateStatusBar(this.statusBarItem);
		}

		let buffer = Buffer.alloc(0);

		socket.on("data", (data: Buffer) => {
			try {
				console.log("Raw data received, length:", data.length, "data:", data.toString('hex').substring(0, 100));
				// Handle WebSocket frame parsing
				const messages = this.parseWebSocketFrames(data, buffer);
				buffer = messages.remaining;

				console.log("Parsed messages count:", messages.parsed.length);
				messages.parsed.forEach((messageText) => {
					try {
						console.log("Received message:", messageText);
						const message = JSON.parse(messageText);
						console.log("Parsed message:", message);
						this.handleMCPMessage(message, socket);
					} catch (error) {
						console.error("Error parsing message:", error);
						console.error("Raw message text:", messageText);
					}
				});
			} catch (error) {
				console.error("Error handling WebSocket data:", error);
			}
		});

		socket.on("close", (hadError: boolean) => {
			this.connections.delete(socket);
			console.log(
				`Claude Code disconnected (hadError: ${hadError}). Total connections: ${this.connections.size}`
			);
			if (this.statusBarItem) {
				this.updateStatusBar(this.statusBarItem);
			}
		});

		socket.on("error", (error: any) => {
			console.error("WebSocket error:", error);
			this.connections.delete(socket);
		});

		// Don't send hello message immediately - wait for client to initiate
		console.log(
			"WebSocket connection established, waiting for client messages"
		);

		// Send initial file context if we have an active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.currentFile = activeFile.path;
			setTimeout(() => {
				this.sendSelectionChanged(activeFile.path);
			}, 1000); // Give Claude Code time to initialize
		}
	}

	private async handleMCPMessage(message: any, ws: any) {
		console.log("Handling MCP message:", message);

		try {
			// Handle different message types
			if (message.method) {
				console.log(`Processing method: ${message.method}`);
				switch (message.method) {
					case "initialize":
						console.log("Handling initialize request");
						this.sendMessage(ws, {
							jsonrpc: "2.0",
							id: message.id,
							result: {
								protocolVersion: "2024-11-05",
								capabilities: {
									resources: {},
									tools: {},
									prompts: {},
								},
								serverInfo: {
									name: "Obsidian",
									version: "1.0.0",
								},
							},
						});
						break;
					case "initialized":
						console.log("Client initialized successfully");
						break;
					case "files/read":
						await this.handleFileRead(message, ws);
						break;
					case "workspace/selection":
						await this.handleWorkspaceSelection(message, ws);
						break;
					case "resources/list":
						console.log("Handling resources/list request");
						this.sendMessage(ws, {
							jsonrpc: "2.0",
							id: message.id,
							result: {
								resources: [],
							},
						});
						break;
					default:
						console.log(`Unhandled method: ${message.method}`);
						// Send error for unhandled methods
						this.sendMessage(ws, {
							jsonrpc: "2.0",
							id: message.id,
							error: {
								code: -32601,
								message: "Method not found",
							},
						});
				}
			} else {
				console.log("Message without method field:", message);
			}
		} catch (error) {
			console.error("Error handling MCP message:", error);
			if (message.id) {
				this.sendMessage(ws, {
					jsonrpc: "2.0",
					id: message.id,
					error: {
						code: -32603,
						message: error.message,
					},
				});
			}
		}
	}

	private async handleFileRead(message: any, ws: any) {
		const filePath = message.params?.path;
		if (!filePath) {
			throw new Error("File path is required");
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = await this.app.vault.read(file);
		this.sendMessage(ws, {
			jsonrpc: "2.0",
			id: message.id,
			result: { content },
		});
	}

	private async handleWorkspaceSelection(message: any, ws: any) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			throw new Error("No active markdown view");
		}

		const editor = activeView.editor;
		const selection = editor.getSelection();
		const cursor = editor.getCursor();

		this.sendMessage(ws, {
			jsonrpc: "2.0",
			id: message.id,
			result: {
				selection,
				cursor: {
					line: cursor.line,
					ch: cursor.ch,
				},
			},
		});
	}

	private async tagForClaude(editor: Editor, view: MarkdownView) {
		const file = view.file;
		if (!file) {
			new Notice("No active file");
			return;
		}

		if (this.connections.size === 0) {
			new Notice("No Claude Code connections active");
			return;
		}

		const selection = editor.getSelection();
		let atMentionMessage: any;

		if (selection) {
			// Tag selection with line numbers (0-indexed for Claude)
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");

			atMentionMessage = {
				jsonrpc: "2.0",
				method: "at_mentioned",
				params: {
					filePath: file.path,
					lineStart: from.line, // Already 0-indexed
					lineEnd: to.line, // Already 0-indexed
				},
			};

			new Notice(
				`Tagged selection: ${file.path}#L${from.line + 1}-${
					to.line + 1
				}`
			);
		} else {
			// Tag entire file
			atMentionMessage = {
				jsonrpc: "2.0",
				method: "at_mentioned",
				params: {
					filePath: file.path,
				},
			};

			new Notice(`Tagged file: ${file.path}`);
		}

		this.broadcast(atMentionMessage);
		console.log("Sent at-mention to Claude Code:", atMentionMessage);
	}

	private parseWebSocketFrames(
		data: Buffer,
		existingBuffer: Buffer
	): { parsed: string[]; remaining: Buffer } {
		const fullBuffer = Buffer.concat([existingBuffer, data]);
		const messages: string[] = [];
		let offset = 0;

		while (offset < fullBuffer.length) {
			if (offset + 2 > fullBuffer.length) break;

			const firstByte = fullBuffer[offset];
			const secondByte = fullBuffer[offset + 1];

			const opcode = firstByte & 0x0f;
			const masked = (secondByte & 0x80) === 0x80;
			let payloadLength = secondByte & 0x7f;

			let payloadOffset = offset + 2;

			// Handle extended payload length
			if (payloadLength === 126) {
				if (payloadOffset + 2 > fullBuffer.length) break;
				payloadLength = fullBuffer.readUInt16BE(payloadOffset);
				payloadOffset += 2;
			} else if (payloadLength === 127) {
				if (payloadOffset + 8 > fullBuffer.length) break;
				const bigPayloadLength =
					fullBuffer.readBigUInt64BE(payloadOffset);
				payloadLength = Number(bigPayloadLength);
				payloadOffset += 8;
			}

			// Handle mask
			let maskKey: Buffer | null = null;
			if (masked) {
				if (payloadOffset + 4 > fullBuffer.length) break;
				maskKey = fullBuffer.subarray(payloadOffset, payloadOffset + 4);
				payloadOffset += 4;
			}

			if (payloadOffset + payloadLength > fullBuffer.length) break;

			// Extract payload
			if (opcode === 0x1) {
				// Text frame
				let payload = fullBuffer.subarray(
					payloadOffset,
					payloadOffset + payloadLength
				);

				// Unmask payload if masked
				if (masked && maskKey) {
					const unmaskedPayload = Buffer.alloc(payload.length);
					for (let i = 0; i < payload.length; i++) {
						unmaskedPayload[i] = payload[i] ^ maskKey[i % 4];
					}
					payload = unmaskedPayload;
				}

				messages.push(payload.toString("utf8"));
			}

			offset = payloadOffset + payloadLength;
		}

		return {
			parsed: messages,
			remaining: fullBuffer.subarray(offset),
		};
	}

	private sendMessage(socket: any, message: any) {
		if (!socket.destroyed && socket.writable) {
			try {
				const payload = JSON.stringify(message);
				const frame = this.createWebSocketFrame(payload);
				socket.write(frame);
			} catch (error) {
				console.error("Failed to send message:", error);
				this.connections.delete(socket);
			}
		}
	}

	private createWebSocketFrame(data: string): Buffer {
		const payload = Buffer.from(data, "utf8");
		const payloadLength = payload.length;

		let frame: Buffer;

		if (payloadLength < 126) {
			frame = Buffer.allocUnsafe(2);
			frame[0] = 0x81; // FIN + text frame
			frame[1] = payloadLength;
		} else if (payloadLength < 65536) {
			frame = Buffer.allocUnsafe(4);
			frame[0] = 0x81; // FIN + text frame
			frame[1] = 126;
			frame.writeUInt16BE(payloadLength, 2);
		} else {
			frame = Buffer.allocUnsafe(10);
			frame[0] = 0x81; // FIN + text frame
			frame[1] = 127;
			frame.writeBigUInt64BE(BigInt(payloadLength), 2);
		}

		return Buffer.concat([frame, payload]);
	}

	private broadcast(message: any) {
		// Create a copy of connections to avoid modification during iteration
		const activeConnections = Array.from(this.connections);
		activeConnections.forEach((socket) => {
			if (!socket.destroyed && socket.writable) {
				this.sendMessage(socket, message);
			} else {
				// Clean up dead connections
				this.connections.delete(socket);
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
