import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

// Setup server and express config
const PORT = 3000;
const app = express();
app.use(express.json({ limit: '10mb' })); // Allows direct base64 uploads

// Map of file attachments stored in-memory
const filesStore = new Map<string, { buffer: Buffer; contentType: string; fileName: string }>();

// REST API endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running securely on port ${PORT}`);
  });
}

startServer();
