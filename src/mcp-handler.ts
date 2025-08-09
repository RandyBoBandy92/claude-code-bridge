import { App, MarkdownView, TFile } from "obsidian";
import { logger } from "./logger";

export class MCPHandler {
	constructor(private app: App) {}

	async handleMessage(message: any, socket: any, sendMessage: (socket: any, message: any) => void) {
		logger.debug("Handling MCP message:", message);

		try {
			if (message.method) {
				logger.debug(`Processing method: ${message.method}`);
				switch (message.method) {
					case "initialize":
						logger.debug("Handling initialize request");
						sendMessage(socket, {
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
						logger.debug("Client initialized successfully");
						break;
					case "files/read":
						await this.handleFileRead(message, socket, sendMessage);
						break;
					case "workspace/selection":
						await this.handleWorkspaceSelection(message, socket, sendMessage);
						break;
					case "resources/list":
						logger.debug("Handling resources/list request");
						sendMessage(socket, {
							jsonrpc: "2.0",
							id: message.id,
							result: {
								resources: [],
							},
						});
						break;
					default:
						logger.debug(`Unhandled method: ${message.method}`);
						sendMessage(socket, {
							jsonrpc: "2.0",
							id: message.id,
							error: {
								code: -32601,
								message: "Method not found",
							},
						});
				}
			} else {
				logger.debug("Message without method field:", message);
			}
		} catch (error) {
			logger.error("Error handling MCP message:", error);
			if (message.id) {
				sendMessage(socket, {
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

	private async handleFileRead(message: any, socket: any, sendMessage: (socket: any, message: any) => void) {
		const filePath = message.params?.path;
		if (!filePath) {
			throw new Error("File path is required");
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = await this.app.vault.read(file);
		sendMessage(socket, {
			jsonrpc: "2.0",
			id: message.id,
			result: { content },
		});
	}

	private async handleWorkspaceSelection(message: any, socket: any, sendMessage: (socket: any, message: any) => void) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			throw new Error("No active markdown view");
		}

		const editor = activeView.editor;
		const selection = editor.getSelection();
		const cursor = editor.getCursor();

		sendMessage(socket, {
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
}