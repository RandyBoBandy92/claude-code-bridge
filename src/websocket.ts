import * as http from "http";
import * as crypto from "crypto";
import { logger } from "./logger";

export class WebSocketServer {
	private httpServer: http.Server | null = null;
	private connections: Set<any> = new Set();
	private authToken: string = "";

	constructor(
		private port: number,
		private onMessage: (message: any, socket: any) => void,
		private onConnection: (socket: any) => void
	) {}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.httpServer = http.createServer();

			this.httpServer.on("upgrade", (request, socket, head) => {
				this.handleWebSocketUpgrade(request, socket, head);
			});

			this.httpServer.listen(this.port, "127.0.0.1", () => {
				logger.log(`HTTP server started on port ${this.port}`);
				resolve();
			});

			this.httpServer.on('error', reject);
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			// Close all connections
			this.connections.forEach((socket) => {
				if (!socket.destroyed) {
					socket.destroy();
				}
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

	broadcast(message: any) {
		const activeConnections = Array.from(this.connections);
		activeConnections.forEach((socket) => {
			if (!socket.destroyed && socket.writable) {
				this.sendMessage(socket, message);
			} else {
				this.connections.delete(socket);
			}
		});
	}

	private handleWebSocketUpgrade(request: any, socket: any, head: Buffer) {
		logger.debug("WebSocket upgrade request:", {
			headers: request.headers,
			url: request.url,
		});

		const key = request.headers["sec-websocket-key"];
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

	private handleConnection(socket: any) {
		this.connections.add(socket);
		logger.log(`Client connected. Total connections: ${this.connections.size}`);

		let buffer = Buffer.alloc(0);

		socket.on("data", (data: Buffer) => {
			try {
				logger.debug("Raw data received, length:", data.length);
				// Handle WebSocket frame parsing
				const messages = this.parseWebSocketFrames(data, buffer);
				buffer = messages.remaining;

				logger.debug("Parsed messages count:", messages.parsed.length);
				messages.parsed.forEach((messageText) => {
					try {
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
			}
		});

		socket.on("close", (hadError: boolean) => {
			this.connections.delete(socket);
			logger.log(`Client disconnected (hadError: ${hadError}). Total connections: ${this.connections.size}`);
		});

		socket.on("error", (error: any) => {
			logger.error("WebSocket error:", error);
			this.connections.delete(socket);
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

	sendMessage(socket: any, message: any) {
		if (!socket.destroyed && socket.writable) {
			try {
				const payload = JSON.stringify(message);
				const frame = this.createWebSocketFrame(payload);
				socket.write(frame);
			} catch (error) {
				logger.error("Failed to send message:", error);
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

	getConnectionCount(): number {
		return this.connections.size;
	}
}