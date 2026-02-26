// ============================
// REQUIRED MODULES
// ============================

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

// ============================
// APP SETUP
// ============================

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const SECRET = "your_secret_key";

// ============================
// DATABASE
// ============================

const db = new sqlite3.Database("./database.db");

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
assignedTo INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS notes (
id INTEGER PRIMARY KEY AUTOINCREMENT,
jobId INTEGER,
note TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS files (
id INTEGER PRIMARY KEY AUTOINCREMENT,
jobId INTEGER,
filePath TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS signatures (
id INTEGER PRIMARY KEY AUTOINCREMENT,
jobId INTEGER,
imagePath TEXT
)`);

});

// ============================
// AUTH MIDDLEWARE
// ============================

function authenticate(req, res, next) {
const token = req.headers["authorization"];
if (!token) return res.status(401).json({ error: "No token" });

jwt.verify(token, SECRET, (err, user) => {
if (err) return res.status(403).json({ error: "Invalid token" });
req.user = user;
next();
});
}

// ============================
// REGISTER
// ============================

app.post("/register", async (req, res) => {
const { email, password, role } = req.body;

const hashed = await bcrypt.hash(password, 10);

db.run(
"INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
[email, hashed, role],
function (err) {
if (err) return res.json({ error: "User exists" });
res.json({ message: "Registered successfully" });
}
);
});

// ============================
// LOGIN
// ============================

app.post("/login", (req, res) => {
const { email, password } = req.body;

db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
if (!user) return res.json({ error: "User not found" });

const valid = await bcrypt.compare(password, user.password);
if (!valid) return res.json({ error: "Wrong password" });

const token = jwt.sign(
{ id: user.id, role: user.role },
SECRET
);

res.json({ token, role: user.role });
});
});

// ============================
// CREATE JOB
// ============================

app.post("/jobs", authenticate, (req, res) => {

if (req.user.role !== "admin")
return res.status(403).json({ error: "Admins only" });

const { title, description, assignedTo } = req.body;

db.run(
"INSERT INTO jobs (title, description, assignedTo) VALUES (?, ?, ?)",
[title, description, assignedTo],
function () {
io.emit("jobCreated");
res.json({ message: "Job created" });
}
);

});

// ============================
// GET JOBS
// ============================

app.get("/jobs", authenticate, (req, res) => {

if (req.user.role === "admin") {
db.all("SELECT * FROM jobs", (err, rows) => {
res.json(rows);
});
} else {
db.all(
"SELECT * FROM jobs WHERE assignedTo = ?",
[req.user.id],
(err, rows) => {
res.json(rows);
});
}

});

// ============================
// COMPLETE JOB
// ============================

app.put("/jobs/:id/complete", authenticate, (req, res) => {

db.run(
"UPDATE jobs SET status='Completed' WHERE id=?",
[req.params.id],
() => {
io.emit("jobCompleted");
res.json({ message: "Job completed" });
}
);

});

// ============================
// ADD NOTE
// ============================

app.post("/jobs/:id/notes", authenticate, (req, res) => {

db.run(
"INSERT INTO notes (jobId, note) VALUES (?, ?)",
[req.params.id, req.body.note],
() => res.json({ message: "Note saved" })
);

});

// ============================
// FILE UPLOAD
// ============================

if (!fs.existsSync("uploads")) {
fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
destination: function (req, file, cb) {
cb(null, "uploads/");
},
filename: function (req, file, cb) {
cb(null, Date.now() + "-" + file.originalname);
}
});

const upload = multer({ storage: storage });

app.post("/jobs/:id/upload", authenticate, upload.single("file"), (req, res) => {

db.run(
"INSERT INTO files (jobId, filePath) VALUES (?, ?)",
[req.params.id, req.file.filename],
() => res.json({ message: "File uploaded" })
);

});

// ============================
// SAVE SIGNATURE
// ============================

app.post("/jobs/:id/sign", authenticate, (req, res) => {

const base64Data = req.body.image.replace(/^data:image\/png;base64,/, "");
const fileName = `signature-${Date.now()}.png`;
const filePath = path.join("uploads", fileName);

fs.writeFile(filePath, base64Data, "base64", function (err) {
if (err) return res.status(500).json({ error: "Signature save failed" });

db.run(
"INSERT INTO signatures (jobId, imagePath) VALUES (?, ?)",
[req.params.id, fileName],
() => res.json({ message: "Signature saved" })
);
});

});

// ============================
// SOCKET CONNECTION
// ============================

io.on("connection", (socket) => {
console.log("User connected");
});

// ============================
// START SERVER
// ============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});