const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("jobs.db");

console.log("\n🔧 FIXING JOB DATABASE...\n");

// Fix status formatting
db.run(`
  UPDATE jobs
  SET status = TRIM(LOWER(status))
`, function(err){
  if(err) console.log(err);
});

// Set blank statuses to New
db.run(`
  UPDATE jobs
  SET status = 'new'
  WHERE status IS NULL OR status = ''
`, function(err){
  if(err) console.log(err);
});

// Remove spaces from assignedTo
db.run(`
  UPDATE jobs
  SET assignedTo = TRIM(assignedTo)
`, function(err){
  if(err) console.log(err);
});

// Show repaired jobs
db.all("SELECT id, customer, assignedTo, status FROM jobs", (err, rows)=>{
  console.log("✅ REPAIRED JOBS:\n");
  console.table(rows);

  console.log(`
NEXT STEP (VERY IMPORTANT):

Make sure assignedTo EXACTLY matches the employee login name.

Example:
If employee logs in as -> John
assignedTo MUST be -> John
NOT john
NOT John Smith
NOT ' John '
`);

  db.close();
});