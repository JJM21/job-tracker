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

// Use PORT from environment (Render) or fallback to 3000 for local
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// File upload setup
const upload = multer({ dest: "uploads/" });

// Database
const db = new sqlite3.Database("./database.db");

// Create tables
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
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
    });
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
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

// REGISTER
app.post("/register", async (req, res) => {
  const { email, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (email, password, role) VALUES (?, ?, ?)`,
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

    db.run(
      `INSERT INTO jobs (title, description, assignedTo) VALUES (?, ?, ?)`,
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
  db.all(`SELECT * FROM jobs`, [], (err, rows) => res.json(rows));
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
  const filePath = req.file.path;
  db.run(`UPDATE jobs SET image=? WHERE id=?`, [filePath, req.params.id], function () {
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

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Socket.io connections
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

// Start server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));