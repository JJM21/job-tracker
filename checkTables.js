const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("jobs.db");

db.serialize(() => {
  console.log("\n--- USERS TABLE ---");
  db.all("SELECT * FROM users", (err, rows) => {
    if (err) return console.error(err.message);
    console.table(rows);
  });

  console.log("\n--- JOBS TABLE ---");
  db.all("SELECT * FROM jobs", (err, rows) => {
    if (err) return console.error(err.message);
    console.table(rows);
  });

  console.log("\n--- COMPANIES TABLE ---");
  db.all("SELECT * FROM companies", (err, rows) => {
    if (err) return console.error(err.message);
    console.table(rows);
  });

  db.close();
});