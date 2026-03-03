require("dotenv").config();

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// PORT and JWT secret
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// File upload
const upload = multer({ dest: "uploads/" });

// Database
const db = new sqlite3.Database("./database.db");

// Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'Pending',
    notes TEXT,
    image TEXT,
    signature TEXT,
    assignedTo INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT UNIQUE,
    quantity INTEGER,
    unit TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS job_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    stock_id INTEGER,
    quantity_used INTEGER
  )`);
});

// Email setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false }
});

async function sendEmail(to, subject, text) {
  try {
    await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
    console.log("Email sent to", to);
  } catch (err) {
    console.error("Email error:", err);
  }
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// REGISTER
app.post("/register", async (req, res) => {
  const { email, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, ?)`,
    [email, hashedPassword, role],
    function (err) {
      if (err) return res.status(400).json({ error: "User already exists" });

      sendEmail(email, "Welcome to Job System", "Your account has been created.");
      res.json({ message: "User registered successfully" });
    }
  );
});

// LOGIN
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (!user) return res.status(400).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: "8h" });
    res.json({ token, role: user.role });
  });
});

// CREATE JOB
app.post("/jobs", auth, (req, res) => {
  const { title, description, assignedEmail } = req.body;

  db.get(`SELECT id FROM users WHERE email=?`, [assignedEmail], (err, user) => {
    if (!user) return res.status(400).json({ error: "Assigned user not found" });

    db.run(`INSERT INTO jobs (title, description, assignedTo) VALUES (?, ?, ?)`,
      [title, description, user.id],
      function (err) {
        if (err) return res.status(400).json({ error: err.message });

        sendEmail(assignedEmail, "New Job Assigned", `You have a new job: ${title}`);
        io.emit("jobCreated", { title });
        res.json({ message: "Job created successfully" });
      }
    );
  });
});

// GET JOBS
app.get("/jobs", auth, (req, res) => {
  if (req.user.role === "employee") {
    db.all(`SELECT * FROM jobs WHERE assignedTo = ?`, [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    db.all(`SELECT * FROM jobs`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// ADD NOTE
app.post("/jobs/:id/note", auth, (req, res) => {
  const { note } = req.body;
  db.run(`UPDATE jobs SET notes=? WHERE id=?`, [note, req.params.id], function () {
    io.emit("jobUpdated");
    res.json({ message: "Note added" });
  });
});

// UPLOAD IMAGE
app.post("/jobs/:id/upload", auth, upload.single("image"), (req, res) => {
  db.run(`UPDATE jobs SET image=? WHERE id=?`, [req.file.path, req.params.id], function () {
    io.emit("jobUpdated");
    res.json({ message: "Image uploaded" });
  });
});

// SAVE SIGNATURE
app.post("/jobs/:id/sign", auth, (req, res) => {
  const { signature } = req.body;
  db.run(`UPDATE jobs SET signature=? WHERE id=?`, [signature, req.params.id], function () {
    io.emit("jobUpdated");
    res.json({ message: "Signature saved" });
  });
});

// COMPLETE JOB
app.put("/jobs/:id/complete", auth, (req, res) => {
  db.run(`UPDATE jobs SET status='Completed' WHERE id=?`, [req.params.id], function () {
    io.emit("jobCompleted", { jobId: req.params.id });
    res.json({ message: "Job completed" });
  });
});

// STOCK ROUTES
app.get("/stock", auth, (req, res) => {
  if (req.user.role !== "stock_manager") return res.status(403).json({ error: "Only Stock Manager allowed" });

  db.all(`SELECT * FROM stock`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/stock", auth, (req, res) => {
  if (req.user.role !== "stock_manager") return res.status(403).json({ error: "Only Stock Manager allowed" });

  const { item_name, quantity, unit } = req.body;
  db.run(`INSERT INTO stock (item_name, quantity, unit) VALUES (?, ?, ?)`,
    [item_name, quantity, unit],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ message: "Stock added successfully" });
    }
  );
});

// ISSUE STOCK TO JOB
app.post("/jobs/:id/issue-stock", auth, (req, res) => {
  if (req.user.role !== "stock_manager") return res.status(403).json({ error: "Only Stock Manager can issue stock" });

  const { stock_id, quantity } = req.body;
  const jobId = req.params.id;

  db.get(`SELECT quantity FROM stock WHERE id=?`, [stock_id], (err, stock) => {
    if (!stock) return res.status(400).json({ error: "Stock not found" });
    if (stock.quantity < quantity) return res.status(400).json({ error: "Not enough stock available" });

    db.run(`UPDATE stock SET quantity = quantity - ? WHERE id=?`, [quantity, stock_id], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run(`INSERT INTO job_materials (job_id, stock_id, quantity_used) VALUES (?, ?, ?)`,
        [jobId, stock_id, quantity], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Stock issued successfully" });
        });
    });
  });
});

// GET ISSUED STOCK FOR JOB
app.get("/jobs/:id/materials", auth, (req, res) => {
  if (req.user.role !== "stock_manager" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const jobId = req.params.id;
  const query = `
    SELECT jm.quantity_used, s.item_name, s.unit
    FROM job_materials jm
    JOIN stock s ON jm.stock_id = s.id
    WHERE jm.job_id = ?`;

  db.all(query, [jobId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Serve uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Socket.io
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

// Start server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));