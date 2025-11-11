import * as http from "http";
import * as crypto from "crypto";
import { logger } from "./logger";
import { WebSocketConnection, MCPMessage, UpgradeRequest } from "./types";

// Constants for resource limits
const MAX_CONNECTIONS = 10;
const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

export class WebSocketServer {
	private httpServer: http.Server | null = null;
	private connections: Set<WebSocketConnection> = new Set();
	private authToken = "";
	private healthCheckInterval: NodeJS.Timer | null = null;

	constructor(
		private port: number,
		private onMessage: (message: MCPMessage, socket: WebSocketConnection) => void,
		private onConnection: (socket: WebSocketConnection) => void
	) {}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.httpServer = http.createServer();

			this.httpServer.on("upgrade", (request, socket, head) => {
				this.handleWebSocketUpgrade(request, socket, head);
			});

			this.httpServer.listen(this.port, "127.0.0.1", () => {
				logger.log(`HTTP server started on port ${this.port}`);
				
				// Start periodic health check for dead connections
				this.startHealthCheck();
				
				resolve();
			});

			this.httpServer.on('error', reject);
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			// Stop health check interval
			if (this.healthCheckInterval) {
				clearInterval(this.healthCheckInterval);
				this.healthCheckInterval = null;
			}
			
			// Close all connections
			this.connections.forEach((socket) => {
				this.cleanupConnection(socket);
			});
			this.connections.clear();

			// Close server
			if (this.httpServer) {
				this.httpServer.close(() => {
					this.httpServer = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	setAuthToken(token: string) {
		this.authToken = token;
	}

	broadcast(message: MCPMessage) {
		const activeConnections = Array.from(this.connections);
		activeConnections.forEach((socket) => {
			if (!socket.destroyed && socket.writable) {
				this.sendMessage(socket, message);
			} else {
				logger.debug("Removing dead connection during broadcast");
				this.cleanupConnection(socket);
			}
		});
	}

	private handleWebSocketUpgrade(request: UpgradeRequest, socket: WebSocketConnection, head: Buffer) {
		// Sanitize headers before logging - remove auth token
		const sanitizedHeaders = { ...request.headers };
		if (sanitizedHeaders["x-claude-code-ide-authorization"]) {
			sanitizedHeaders["x-claude-code-ide-authorization"] = "[REDACTED]";
		}
		logger.debug("WebSocket upgrade request:", {
			headers: sanitizedHeaders,
			url: request.url,
		});

		const keyHeader = request.headers["sec-websocket-key"];
		const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
		if (!key) {
			logger.debug("No sec-websocket-key header, rejecting");
			socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
			return;
		}

		// Validate authentication token
		const authHeader = request.headers["x-claude-code-ide-authorization"];
		if (!authHeader) {
			logger.debug("Missing authentication header, rejecting");
			socket.end(
				"HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nMissing authentication header: x-claude-code-ide-authorization"
			);
			return;
		}

		if (authHeader !== this.authToken) {
			logger.debug("Invalid authentication token, rejecting");
			socket.end(
				"HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nInvalid authentication token"
			);
			return;
		}

		logger.debug("Authentication successful");
		
		// Check connection limit BEFORE accepting the WebSocket upgrade
		if (this.connections.size >= MAX_CONNECTIONS) {
			logger.warn(`Connection limit reached (${MAX_CONNECTIONS}), rejecting new connection`);
			socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nConnection limit reached");
			return;
		}

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

		logger.debug("Sending WebSocket handshake response");
		socket.write(responseHeaders);

		// Handle the WebSocket connection
		this.handleConnection(socket);
	}

	private handleConnection(socket: WebSocketConnection) {
		// Connection limit already checked in handleWebSocketUpgrade
		this.connections.add(socket);
		logger.log(`Client connected. Total connections: ${this.connections.size}`);

		let buffer = Buffer.alloc(0);

		socket.on("data", (data: Buffer) => {
			try {
				// Check buffer size limit to prevent memory exhaustion
				if (buffer.length + data.length > MAX_BUFFER_SIZE) {
					logger.error(`Buffer overflow protection triggered (${buffer.length + data.length} bytes)`);
					this.cleanupConnection(socket);
					return;
				}
				
				logger.debug("Raw data received, length:", data.length);
				// Handle WebSocket frame parsing
				const messages = this.parseWebSocketFrames(data, buffer);
				buffer = messages.remaining;

				logger.debug("Parsed messages count:", messages.parsed.length);
				messages.parsed.forEach((messageText) => {
					try {
						// Check message size limit
						if (messageText.length > MAX_MESSAGE_SIZE) {
							logger.error(`Message too large: ${messageText.length} bytes (max: ${MAX_MESSAGE_SIZE})`);
							this.sendMessage(socket, {
								jsonrpc: "2.0",
								error: {
									code: -32600,
									message: "Message too large"
								}
							});
							return;
						}
						
						logger.debug("Received message:", messageText);
						const message = JSON.parse(messageText);
						logger.debug("Parsed message:", message);
						this.onMessage(message, socket);
					} catch (error) {
						logger.error("Error parsing message:", error);
						logger.debug("Raw message text:", messageText);
					}
				});
			} catch (error) {
				logger.error("Error handling WebSocket data:", error);
				this.cleanupConnection(socket);
			}
		});

		socket.on("close", (hadError: boolean) => {
			this.connections.delete(socket);
			logger.log(`Client disconnected (hadError: ${hadError}). Total connections: ${this.connections.size}`);
		});

		socket.on("error", (error: Error) => {
			logger.error("WebSocket error:", error);
			this.cleanupConnection(socket);
		});

		logger.debug("WebSocket connection established, waiting for client messages");
		this.onConnection(socket);
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

	sendMessage(socket: WebSocketConnection, message: MCPMessage) {
		if (!socket.destroyed && socket.writable) {
			try {
				const payload = JSON.stringify(message);
				
				// Check outgoing message size
				if (payload.length > MAX_MESSAGE_SIZE) {
					logger.error(`Outgoing message too large: ${payload.length} bytes (max: ${MAX_MESSAGE_SIZE})`);
					// Send error response instead
					const errorMessage: MCPMessage = {
						jsonrpc: "2.0",
						id: message.id,
						error: {
							code: -32600,
							message: "Response too large"
						}
					};
					const errorPayload = JSON.stringify(errorMessage);
					const errorFrame = this.createWebSocketFrame(errorPayload);
					socket.write(errorFrame);
					return;
				}
				
				const frame = this.createWebSocketFrame(payload);
				socket.write(frame);
			} catch (error) {
				logger.error("Failed to send message:", error);
				this.cleanupConnection(socket);
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

	getConnectionCount(): number {
		return this.connections.size;
	}
	
	private cleanupConnection(socket: WebSocketConnection) {
		this.connections.delete(socket);
		if (!socket.destroyed) {
			socket.destroy();
		}
	}
	
	private startHealthCheck() {
		// Periodically check for dead connections
		this.healthCheckInterval = setInterval(() => {
			this.connections.forEach((socket) => {
				if (socket.destroyed || !socket.writable) {
					logger.debug("Removing dead connection during health check");
					this.connections.delete(socket);
				}
			});
			logger.debug(`Health check: ${this.connections.size} active connections`);
		}, HEALTH_CHECK_INTERVAL_MS);
	}
}