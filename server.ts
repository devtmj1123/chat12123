import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { Message, User, Channel, Reaction } from "./src/types";

// Setup server and express config
const PORT = 3000;
const app = express();
app.use(express.json({ limit: '10mb' })); // Allows direct base64 uploads

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Attach WS upgrade handling
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Seed default channels
const channels: Channel[] = [
  { id: "general", name: "general", description: "Default channel for friendly workspace chit-chats." },
  { id: "tech-corner", name: "tech-corner", description: "Code snippets, engineering design reviews, and modern tools." },
  { id: "announcements", name: "announcements", description: "Broadcast board for official notifications and alerts." }
];

// In-memory data store for messages and active users
const messages: Message[] = [
  {
    id: "system-welcome",
    channelId: "general",
    user: {
      id: "system",
      username: "System Butler",
      avatarColor: "slate",
      avatarEmoji: "🛎️",
      status: "online",
      lastActive: Date.now()
    },
    content: "Welcome to the real-time Full Stack Workspace Chat App! Share links, upload screenshots/drawings, react to messages, or test push notifications.",
    timestamp: Date.now(),
    reactions: [],
    isSystem: true
  }
];

// Map of file attachments stored in-memory
const filesStore = new Map<string, { buffer: Buffer; contentType: string; fileName: string }>();

// Map of active Socket connections keyed by unique user id
const activeUsers = new Map<string, { ws: WebSocket; user: User }>();

// REST API endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeConnections: activeUsers.size });
});

// Get current channels
app.get("/api/channels", (req, res) => {
  res.json(channels);
});

// Create a custom channel
app.post("/api/channels", (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Channel name is required" });
  }
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!cleanName) {
    return res.status(400).json({ error: "Invalid channel name" });
  }
  if (channels.some(c => c.name === cleanName)) {
    return res.status(400).json({ error: "Channel with this name already exists" });
  }

  const newChannel: Channel = {
    id: cleanName,
    name: cleanName,
    description: (description || `Discussion regarding #${cleanName}`).substring(0, 150)
  };
  channels.push(newChannel);
  
  // Broadcast new channel update to all sockets
  broadcast({
    type: "channel-created",
    channel: newChannel
  });

  res.status(201).json(newChannel);
});

// Handle custom in-memory file image/attachment upload
app.post("/api/upload", (req, res) => {
  try {
    const { fileName, fileType, base64Data } = req.body;
    if (!base64Data || !fileType) {
      return res.status(400).json({ error: "Missing uploaded data structures" });
    }

    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, 'base64');
    const fileId = "file-" + Math.random().toString(36).substring(2, 11);

    // Limit image size to ~10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "File exceeds max capacity of 10MB" });
    }

    filesStore.set(fileId, {
      buffer,
      contentType: fileType,
      fileName: fileName || "upload"
    });

    const fileUrl = `/api/files/${fileId}`;
    res.json({ fileUrl });
  } catch (error) {
    console.error("Upload handler failed:", error);
    res.status(500).json({ error: "Failed to convert file" });
  }
});

// Stream uploaded file back with custom headers
app.get("/api/files/:id", (req, res) => {
  const file = filesStore.get(req.params.id);
  if (!file) {
    return res.status(404).send("Attachment directory mismatch or expired link");
  }
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400"); // Cache it
  res.send(file.buffer);
});

// Broadcast utility to all active connections
function broadcast(messagePayload: any) {
  const data = JSON.stringify(messagePayload);
  activeUsers.forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// Sync current presence array to all users
function syncPresence() {
  const usersList = Array.from(activeUsers.values()).map(au => au.user);
  broadcast({
    type: "presence",
    users: usersList
  });
}

// WS Connection lifecycle
wss.on("connection", (ws) => {
  let authenticatedUser: User | null = null;

  ws.on("message", (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      if (!payload || !payload.type) return;

      switch (payload.type) {
        case "join": {
          const user = payload.user as User;
          if (!user || !user.id) return;
          authenticatedUser = user;
          
          // Connect/Register user socket
          activeUsers.set(user.id, { ws, user });
          
          // Send initial state sync to this new client only
          const welcomeState = {
            type: "state-sync",
            channels,
            messages,
            users: Array.from(activeUsers.values()).map(au => au.user)
          };
          ws.send(JSON.stringify(welcomeState));

          // Notify everyone of new join presence
          syncPresence();
          break;
        }

        case "message": {
          const incomingMsg = payload.message as Message;
          if (!incomingMsg || !incomingMsg.content) return;

          // Double check formatting and prevent massive memory pileup
          messages.push(incomingMsg);
          if (messages.length > 500) {
            messages.shift();
          }

          // Broadcast to everyone
          broadcast({
            type: "message",
            message: incomingMsg
          });

          // Check if typing indicator was active, remove it before response
          broadcast({
            type: "typing",
            userId: incomingMsg.user.id,
            username: incomingMsg.user.username,
            channelId: incomingMsg.channelId,
            isTyping: false
          });

          // Notify others of this chat (for in-app toasts/desktop alerts)
          broadcast({
            type: "notification",
            title: `New chat in #${channels.find(c => c.id === incomingMsg.channelId)?.name || "general"}`,
            message: `${incomingMsg.user.username}: ${incomingMsg.content.substring(0, 50)}${incomingMsg.content.length > 50 ? "..." : ""}`,
            channelId: incomingMsg.channelId,
            userId: incomingMsg.user.id // Include generator
          });
          break;
        }

        case "typing": {
          const { userId, username, channelId, isTyping } = payload;
          if (!userId || !channelId) return;

          // Broadcast to everyone else
          broadcast({
            type: "typing",
            userId,
            username,
            channelId,
            isTyping
          });
          break;
        }

        case "reaction": {
          const { messageId, emoji, userId } = payload;
          if (!messageId || !emoji || !userId) return;

          const msg = messages.find(m => m.id === messageId);
          if (msg) {
            if (!msg.reactions) msg.reactions = [];
            
            // Find reaction
            let rx = msg.reactions.find(r => r.emoji === emoji);
            if (rx) {
              // Toggle user reaction: if exists, remove it, else add it
              const userIdx = rx.userIds.indexOf(userId);
              if (userIdx > -1) {
                rx.userIds.splice(userIdx, 1);
              } else {
                rx.userIds.push(userId);
              }
            } else {
              // Add new reaction emoji
              msg.reactions.push({
                emoji,
                userIds: [userId]
              });
            }

            // Remove empty emojis
            msg.reactions = msg.reactions.filter(r => r.userIds.length > 0);

            // Broadcast update
            broadcast({
              type: "reaction-update",
              messageId,
              reactions: msg.reactions
            });
          }
          break;
        }

        case "status-update": {
          const { userId, status } = payload;
          if (!userId) return;

          const au = activeUsers.get(userId);
          if (au) {
            au.user.status = status;
            au.user.lastActive = Date.now();
            syncPresence();
          }
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error("Failed to parse socket message stream:", e);
    }
  });

  ws.on("close", () => {
    if (authenticatedUser) {
      // Unregister user on disconnect
      activeUsers.delete(authenticatedUser.id);
      syncPresence();
    }
  });
});

// Setup dev server with Vite, or default static bundle path for output
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Run with Vite Dev Server Middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving static files of optimized build
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running securely on port ${PORT}`);
  });
}

startServer();
