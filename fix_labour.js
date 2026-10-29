const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'lib', 'supabase', 'labour.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Remove trailing \r if present at end of file
content = content.replace(/\r\n$/, '\r\n').replace(/\r$/, '');

const newFunctions = `\r\n/** Fetches attendance records for an arbitrary date range (inclusive). */\r\nexport async function fetchAttendanceRange(\r\n  startDate: string,\r\n  endDate: string\r\n): Promise<AttendanceRecord[]> {\r\n  if (!SUPABASE_URL) return [];\r\n  try {\r\n    const res = await fetch(\r\n      \`\${SUPABASE_URL}/rest/v1/worker_attendance?attendance_date=gte.\${startDate}&attendance_date=lte.\${endDate}\`,\r\n      { headers: headers() }\r\n    );\r\n    if (!res.ok) {\r\n      const body = await res.json().catch(() => ({}));\r\n      logSupabaseError("worker_attendance range", res.status, body);\r\n      return [];\r\n    }\r\n    const json = await res.json();\r\n    return (Array.isArray(json) ? json : []) as AttendanceRecord[];\r\n  } catch (err) {\r\n    const msg = err instanceof Error ? err.message : String(err);\r\n    console.error("[Supabase worker_attendance range]", { message: msg });\r\n    return [];\r\n  }\r\n}\r\n\r\n/** Fetches ALL worker loans with a positive current_balance in one request. */\r\nexport async function fetchActiveLoansAll(): Promise<WorkerLoan[]> {\r\n  if (!SUPABASE_URL) return [];\r\n  try {\r\n    const res = await fetch(\r\n      \`\${SUPABASE_URL}/rest/v1/worker_loans?current_balance=gt.0&order=created_at.asc\`,\r\n      { headers: headers() }\r\n    );\r\n    if (!res.ok) {\r\n      const body = await res.json().catch(() => ({}));\r\n      logSupabaseError("worker_loans all active", res.status, body);\r\n      return [];\r\n    }\r\n    const json = await res.json();\r\n    return (Array.isArray(json) ? json : []) as WorkerLoan[];\r\n  } catch (err) {\r\n    const msg = err instanceof Error ? err.message : String(err);\r\n    console.error("[Supabase worker_loans all active]", { message: msg });\r\n    return [];\r\n  }\r\n}\r\n`;

// Append before the final newline or at the end
content = content + newFunctions;

fs.writeFileSync(filePath, content, 'utf8');
console.log('labour.ts updated successfully');
