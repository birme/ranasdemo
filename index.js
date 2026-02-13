const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://dadjokes:dadjokes2024@172.232.131.169:10567/dadjokes",
  ssl: false,
});

async function initDb() {
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
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Post a new joke
app.post("/api/jokes", async (req, res) => {
  const { text, author } = req.body;
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: "Joke text is required" });
  }
  const authorName = author && author.trim().length > 0 ? author.trim() : "Anonymous";
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
    return res.status(404).json({ error: "No jokes found. Be the first to add one!" });
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
  const joke = await pool.query("SELECT id FROM jokes WHERE id = $1", [jokeId]);
  if (joke.rows.length === 0) {
    return res.status(404).json({ error: "Joke not found" });
  }
  await pool.query(
    "INSERT INTO ratings (joke_id, stars) VALUES ($1, $2)",
    [jokeId, stars]
  );
  const result = await pool.query(
    `SELECT j.*, COALESCE(AVG(r.stars), 0) as avg_rating, COUNT(r.id) as rating_count
     FROM jokes j LEFT JOIN ratings r ON j.id = r.joke_id
     WHERE j.id = $1 GROUP BY j.id`,
    [jokeId]
  );
  res.json(result.rows[0]);
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Dad Jokes app listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
