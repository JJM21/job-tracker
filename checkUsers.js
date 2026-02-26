const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("jobs.db");

db.all("SELECT * FROM users", (err, rows) => {
    if(err) console.log(err);
    console.table(rows);
    db.close();
});