import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateCommunityRequest, editGameWithOrion, rankCommunityFeed, reviewCommunityPost, reviewCommunitySubmission } from "../community-ai";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/orion/review-post", async (req, res) => {
  try {
    await authenticateCommunityRequest(req.header("authorization"));
    res.json(await reviewCommunityPost(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orión no pudo revisar la publicación.";
    res.status(400).json({ error: message });
  }
});

app.post("/api/orion/review-submission", async (req, res) => {
  try {
    await authenticateCommunityRequest(req.header("authorization"));
    res.json(await reviewCommunitySubmission(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orión no pudo revisar este contenido.";
    res.status(400).json({ error: message });
  }
});

app.post("/api/orion/rank-feed", async (req, res) => {
  try {
    await authenticateCommunityRequest(req.header("authorization"));
    res.json(await rankCommunityFeed(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orión no pudo ordenar el feed.";
    res.status(400).json({ error: message });
  }
});

app.post("/api/orion/edit-game", async (req, res) => {
  try {
    res.json(await editGameWithOrion(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orión no pudo editar el juego.";
    res.status(400).json({ error: message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    // El bundle del servidor queda en `dist/index.js` y Vite genera el cliente en
    // `dist/public`, que también es el directorio exigido por el publicador.
    const publicDirectory = path.join(dirname, "public");
    app.use(express.static(publicDirectory));
    app.use((_req, res) => res.sendFile(path.join(publicDirectory, "index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => console.log(`Asternal disponible en el puerto ${port}`));
}

void startServer();
