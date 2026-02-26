const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("jobs.db");

db.all("SELECT id, customer, assignedTo, status FROM jobs", (err, rows) => {
  if (err) {
    console.error("Error fetching jobs:", err.message);
    db.close();
    return;
  }

  console.log("\n--- JOBS TABLE ---\n");
  console.table(rows);

  // Optional: check if any jobs are assigned to 'john' for testing
  const testName = 'john'; // change to employee name
  const assignedJobs = rows.filter(job => (job.assignedTo || '').toLowerCase().trim() === testName.toLowerCase());
  console.log(`\n--- JOBS ASSIGNED TO "${testName}" ---\n`);
  console.table(assignedJobs);

  db.close();
});