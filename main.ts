import { App, Editor, MarkdownView, Notice, Plugin } from "obsidian";
import * as net from "net";
import { WebSocketServer } from "./src/websocket";
import { MCPHandler } from "./src/mcp-handler";
import { LockFileManager } from "./src/lock-file";
import { logger } from "./src/logger";

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
	private webSocketServer: WebSocketServer | null = null;
	private mcpHandler: MCPHandler;
	private lockFileManager: LockFileManager;
	private port: number = 0;
	private currentFile: string | null = null;
	private selectionChangeTimeout: NodeJS.Timeout | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize handlers
		this.mcpHandler = new MCPHandler(this.app);
		this.lockFileManager = new LockFileManager();

		// Initialize the Claude Code bridge
		if (this.settings.enabled) {
			await this.initializeBridge();
		}

		// Add the main tagging command with hotkey
		this.addCommand({
			id: "tag-for-claude",
			name: "Tag file/selection for Claude Code",
			hotkeys: [{ modifiers: ["Mod", "Alt"], key: "k" }],
			editorCallback: (editor: Editor, view: MarkdownView) =>
				this.tagForClaude(editor, view),
		});

		// Register workspace events for file tracking
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.handleFileChange(file);
			})
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				const activeFile = this.app.workspace.getActiveFile();
				this.handleFileChange(activeFile);
			})
		);

		// Also track selection changes within the same file
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor) => {
				if (
					this.webSocketServer?.getConnectionCount() > 0 &&
					this.currentFile
				) {
					// Debounce selection changes to avoid spam
					clearTimeout(this.selectionChangeTimeout);
					this.selectionChangeTimeout = setTimeout(() => {
						this.sendSelectionChanged(this.currentFile!);
					}, 300);
				}
			})
		);

		logger.log("Plugin loaded and initialized successfully");
	}

	private handleConnection(socket: any) {
		// Send initial file context if we have an active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.currentFile = activeFile.path;
			setTimeout(() => {
				this.sendSelectionChanged(activeFile.path);
			}, 1000); // Give Claude Code time to initialize
		}
	}


	async onunload() {
		if (this.selectionChangeTimeout) {
			clearTimeout(this.selectionChangeTimeout);
		}
		await this.closeBridge();
		logger.log("Plugin unloaded");
	}

	private handleFileChange(file: any) {
		const newFilePath = file?.path || null;

		// Only notify if file actually changed and we have connections
		if (
			newFilePath !== this.currentFile &&
			this.webSocketServer?.getConnectionCount() > 0
		) {
			this.currentFile = newFilePath;

			if (newFilePath) {
				logger.debug(`File changed to: ${newFilePath}`);
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
					end: {
						line: cursor.line,
						character: cursor.ch + (selection?.length || 0),
					},
					isEmpty: !selection || selection.length === 0,
				},
			},
		};

		this.webSocketServer?.broadcast(selectionChangedMessage);
		logger.debug(
			"Sent selection_changed notification:",
			selectionChangedMessage
		);
	}

	private async initializeBridge() {
		try {
			// Find available port
			this.port = await this.findAvailablePort();

			// Create WebSocket server
			this.webSocketServer = new WebSocketServer(
				this.port,
				(message, socket) =>
					this.mcpHandler.handleMessage(
						message,
						socket,
						this.webSocketServer!.sendMessage.bind(
							this.webSocketServer
						)
					),
				(socket) => this.handleConnection(socket),
			);

			// Start the server
			await this.webSocketServer.start();

			// Create lock file for IDE detection and get auth token
			const authToken = await this.lockFileManager.createLockFile(
				this.port,
				this.app.vault.adapter.basePath || process.cwd()
			);
			this.webSocketServer.setAuthToken(authToken);

			logger.log(`WebSocket server started on port ${this.port}`);
			new Notice(
				`Claude Code Bridge: Started on port ${
					this.port
				} - Lock file: ${this.lockFileManager.getLockFilePath()}`
			);
		} catch (error) {
			logger.error("Failed to initialize Claude Code bridge:", error);
			new Notice(
				`Claude Code Bridge: Failed to start - ${error.message}`
			);
		}
	}

	private async closeBridge() {
		// Close WebSocket server
		if (this.webSocketServer) {
			await this.webSocketServer.stop();
			this.webSocketServer = null;
		}

		// Remove lock file
		this.lockFileManager.removeLockFile();
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

	private async tagForClaude(editor: Editor, view: MarkdownView) {
		const file = view.file;
		if (!file) {
			new Notice("No active file");
			return;
		}

		if (
			!this.webSocketServer ||
			this.webSocketServer.getConnectionCount() === 0
		) {
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

		this.webSocketServer.broadcast(atMentionMessage);
		logger.debug("Sent at-mention to Claude Code:", atMentionMessage);
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
