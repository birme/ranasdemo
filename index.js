const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 8080;
const APP_CONFIG_URL = process.env.APP_CONFIG_URL || process.env.CONFIG_SVC;

async function getConfig(key) {
  if (!APP_CONFIG_URL) return undefined;
  try {
    const res = await fetch(`${APP_CONFIG_URL}/api/v1/config/${key}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.value;
  } catch (err) {
    console.error(`Failed to fetch config key '${key}':`, err.message);
    return undefined;
  }
}

async function start() {
  const databaseUrl =
    process.env.DATABASE_URL || (await getConfig("DATABASE_URL"));
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL not set. Provide it via env var or APP_CONFIG_URL parameter store."
    );
    process.exit(1);
  }
  console.log("Database URL loaded from", process.env.DATABASE_URL ? "env" : "parameter store");

  const pool = new Pool({ connectionString: databaseUrl, ssl: false });

  // Initialize tables
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jokes (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        author VARCHAR(100) DEFAULT 'Anonymous',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        joke_id INTEGER REFERENCES jokes(id) ON DELETE CASCADE,
        stars INTEGER CHECK (stars >= 1 AND stars <= 5),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ratings_joke_id ON ratings(joke_id);
    `);
    console.log("Database tables initialized");
  } finally {
    client.release();
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // Post a new joke
  app.post("/api/jokes", async (req, res) => {
    const { text, author } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Joke text is required" });
    }
    const authorName =
      author && author.trim().length > 0 ? author.trim() : "Anonymous";
    const result = await pool.query(
      "INSERT INTO jokes (text, author) VALUES ($1, $2) RETURNING *",
      [text.trim(), authorName]
    );
    res.status(201).json(result.rows[0]);
  });

  // Get a random joke
  app.get("/api/jokes/random", async (req, res) => {
    const result = await pool.query(
      "SELECT j.*, COALESCE(AVG(r.stars), 0) as avg_rating, COUNT(r.id) as rating_count FROM jokes j LEFT JOIN ratings r ON j.id = r.joke_id GROUP BY j.id ORDER BY RANDOM() LIMIT 1"
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No jokes found. Be the first to add one!" });
    }
    res.json(result.rows[0]);
  });

  // Get top jokes
  app.get("/api/jokes/top", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const result = await pool.query(
      `SELECT j.*, COALESCE(AVG(r.stars), 0) as avg_rating, COUNT(r.id) as rating_count
       FROM jokes j LEFT JOIN ratings r ON j.id = r.joke_id
       GROUP BY j.id
       HAVING COUNT(r.id) > 0
       ORDER BY avg_rating DESC, rating_count DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  });

  // Get all jokes
  app.get("/api/jokes", async (req, res) => {
    const result = await pool.query(
      `SELECT j.*, COALESCE(AVG(r.stars), 0) as avg_rating, COUNT(r.id) as rating_count
       FROM jokes j LEFT JOIN ratings r ON j.id = r.joke_id
       GROUP BY j.id ORDER BY j.created_at DESC`
    );
    res.json(result.rows);
  });

  // Rate a joke
  app.post("/api/jokes/:id/rate", async (req, res) => {
    const jokeId = parseInt(req.params.id);
    const { stars } = req.body;
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "Stars must be between 1 and 5" });
    }
    const joke = await pool.query("SELECT id FROM jokes WHERE id = $1", [
      jokeId,
    ]);
    if (joke.rows.length === 0) {
      return res.status(404).json({ error: "Joke not found" });
    }
    await pool.query("INSERT INTO ratings (joke_id, stars) VALUES ($1, $2)", [
      jokeId,
      stars,
    ]);
    const result = await pool.query(
      `SELECT j.*, COALESCE(AVG(r.stars), 0) as avg_rating, COUNT(r.id) as rating_count
       FROM jokes j LEFT JOIN ratings r ON j.id = r.joke_id
       WHERE j.id = $1 GROUP BY j.id`,
      [jokeId]
    );
    res.json(result.rows[0]);
  });

  app.listen(port, () => {
    console.log(`Dad Jokes app listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
