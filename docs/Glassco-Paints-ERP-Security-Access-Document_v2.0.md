Security & Access Control Specifications: Glassco Paints ERPTarget Platform: Dual-Target System (Windows Desktop Application via Tauri v2 & Remote Owner Web Application via Vercel Next.js 14 Web)Security Model: Dual-Tier Auth (Shared Terminal PIN + Owner Auth) with Mandatory Operator Selection and Strict Non-Offline Guard[cite: 1, 4]Audience: Non-Technical Founders, Lead Developers, Security Auditors1. Authentication & Identity Strategy1.1 Dual-Tier Access ModelGlassco Paints ERP operates across two distinct physical environments, requiring a bifurcated authentication framework:  Factory Floor Terminals (Desktop App / Tauri v2): Four physical factory terminals (PC-01 through PC-04) utilize a single Shared Factory PIN Gate[cite: 1, 4, 6]. Because standard individual user logins create friction on a noisy production floor, terminals run on a persistent session unlocked by a 4-digit master PIN.  Owner Remote Management (Web App / Vercel): The remote web deployment (REMOTE-WEB) is secured via dedicated Owner Password/Credential Authentication, granting global executive monitoring, cost margin visibility, and administrative capabilities.  +-----------------------------------------------------------------------------------+
|                           App Startup Security Gate                               |
|                                                                                   |
|   Select Terminal / Mode:  [ PC-01 (Raw Chemical Store) ]                         |
|   Enter Factory Master PIN: [ * * * * ]                                           |
|                                                                                   |
|   [ Unlock Terminal Session ]                                                     |
+-----------------------------------------------------------------------------------+
1.2 Mandatory Operator Selection EngineBecause all four factory terminals share a single PIN authentication state, individual accountability is enforced at the transaction layer.  Whenever an operator performs a data-mutating action (e.g., executing a paint batch, creating an IGP, modifying inventory, or posting a tax invoice)[cite: 1, 4, 7], the application triggers a lightweight, non-blocking Operator Selection Drawer requiring the user to select their name from a pre-configured active worker roster before the payload is dispatched.+-----------------------------------------------------------------------------------+
|                        Action Operator Attribution Required                       |
|                                                                                   |
|   Action: Execute Batch Order #BT-2026-089 (1,000L Emulsion)                      |
|   Select Active Operator: [ Talha Ijaz  (Mixer Lead)  v ]                         |
|                                                                                   |
|   [ Confirm & Submit Payload ]                             [ Cancel ]             |
+-----------------------------------------------------------------------------------+
1.3 Session & Timeout ControlsEncrypted Local Session: Unlocking a terminal creates an encrypted local session valid only for that active window.  Auto-Lock Timeout: Terminals automatically lock after 15 minutes of input inactivity, requiring re-entry of the Factory Master PIN.  Failed Attempt Lockout: Entering an invalid PIN triggers an exponential backoff delay (3 seconds initial, doubling up to 60 seconds) to block automated brute-force guessing.  2. Roles & Operations MatrixAll factory terminals share full operational read/write access across modules to keep floor logistics smooth. However, every sensitive write attaches the terminal node ID (PC-01 to PC-04, REMOTE-WEB), operator name, and timestamp, while restricting destructive actions[cite: 1, 4, 6, 7].  Operational ViewPrimary FunctionWhat Workers CAN DoWhat Workers CANNOT DoSystem Dashboard[cite: 1, 4]High-level metrics & audit feed[cite: 1, 4]View stock valuations (PKR), live chemical depletion rates, and audit logs[cite: 1, 4, 6, 7].Delete, clear, or modify past historical system audit logs[cite: 2, 4, 7].Inward Gate Pass & GRN[cite: 1, 4]Material intake & supplier GRN[cite: 1, 4]Log raw chemical shipments, record Intake QC logs, and convert IGPs to GRNs[cite: 1, 4, 6].Overwrite or alter a GRN after it has been posted into stock[cite: 2, 4, 7].Dual Warehouses & FEFO[cite: 1, 4]Stock management (WH-01 & WH-02)[cite: 1, 4, 6]View real-time chemical/paint lot stock and execute FEFO lot dispatches[cite: 1, 4, 6].Clear stock balances without logging a process-loss or scrap reason entry[cite: 1, 4, 7].Paint Formulas & BatchesPaint mixing & liquid yieldsView versioned formulas, execute batch mixing orders, and track ingredient deductions.  Retroactively modify chemical ratios on past, completed production batches[cite: 2, 4, 6, 7].Quality Control (QC)3-stage inspection logs  Log viscosity (cP), opacity (%), and shade tests across Intake, Mixing, and Packaging.  Delete or overwrite failed QC inspection badges[cite: 2, 4, 6, 7].Labour & Attendance[cite: 1, 4]Roster & daily status tracking[cite: 1, 4]Register worker profiles and click daily matrix cells (P/A/L)[cite: 1, 4, 6].Delete past historical attendance records without explicit reason logs[cite: 2, 4, 7].Advance Loans[cite: 1, 4]Loan tracking & recovery[cite: 1, 4]Issue worker loan advances and log direct cash/bank repayments[cite: 1, 4, 6].Alter loan balance histories without creating explicit ledger entries[cite: 2, 4, 7].GST Invoicing[cite: 1, 4]Sales tax invoicing (18% + 4%)[cite: 1, 4, 6]Draft tax invoices, post sales, generate Outward Gate Passes, and trigger thermal prints[cite: 1, 4, 6].Alter tax calculations or delete posted tax invoice serial numbers[cite: 2, 4, 7].General Ledger[cite: 1, 4]Financial balance & reporting[cite: 1, 4]View comparative Trial Balance, P&L, Balance Sheet, and post journal vouchers[cite: 1, 4, 6].Post unbalanced journal entries where Debits do not equal Credits[cite: 2, 4, 7].3. Database Row-Level Security (RLS) & TriggersPostgreSQL Row-Level Security (RLS) and database triggers guarantee that corrupt, un-attributed, or unbalanced data updates are rejected at the database engine level, regardless of client-side logic.  Policy 1: Immutable Append-Only System Audit LogsRule: Anyone can write a new system audit record, but no one (including administrators) can update or delete existing audit trails[cite: 2, 4, 7].SQLALTER TABLE system_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow insert of new audit records
CREATE POLICY "Allow public audit log insertion" 
ON system_audit_logs FOR INSERT 
WITH CHECK (true);

-- Allow reading of audit logs
CREATE POLICY "Allow public audit log reading" 
ON system_audit_logs FOR SELECT 
USING (true);

-- Explicitly disallow UPDATE and DELETE
CREATE POLICY "Prevent audit log modification" 
ON system_audit_logs FOR UPDATE 
USING (false);

CREATE POLICY "Prevent audit log deletion" 
ON system_audit_logs FOR DELETE 
USING (false);
Policy 2: Enforce Double-Entry Balance VerificationRule: Accounting entries are rejected by the database engine unless total Debits equal total Credits down to the exact cent (0.00)[cite: 2, 4, 7].SQLALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enforce balanced journal entries" 
ON journal_entries FOR INSERT 
WITH CHECK (is_balanced = true);
Policy 3: Hard Negative Lot Stock PreventionRule: The database blocks any attempt to draw chemical or finished paint lot stock below 0.0000[cite: 2, 4, 6, 7].SQLALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prevent negative lot balances" 
ON inventory_lots FOR UPDATE 
USING (remaining_qty >= 0.0000);
Policy 4: Strict FEFO Expiration Enforcement TriggerRule: Chemical raw materials or finished paint lots that have passed their expiration date cannot be dispatched for production batches or customer sales.SQLCREATE OR REPLACE FUNCTION check_lot_expiration()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT expiration_date FROM inventory_lots WHERE id = NEW.lot_id) < CURRENT_DATE THEN
        RAISE EXCEPTION 'FEFO Security Violation: Cannot dispatch expired lot ID %', NEW.lot_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
4. Technical Error Handling & Strict Non-Offline Protocol4.1 The Strict Non-Offline Policy ("Loud Network Failure")Because industrial chemical formulas, batch costings, and double-entry ledgers depend on absolute real-time synchronization, Glassco Paints ERP strictly forbids offline transaction queueing or speculative writes.  If WebSocket connectivity to Supabase Cloud drops during any operation:  The client runtime immediately freezes user interaction.A full-screen, un-dismissable crimson alert overlay covers the UI.The pending operation is safely aborted to prevent partial ledger or stock writes.+-----------------------------------------------------------------------------------+
|                           CRITICAL NETWORK DISCONNECTION                          |
|                                                                                   |
|  [!] Connection to Supabase Cloud Engine Interrupted                              |
|                                                                                   |
|  To maintain database ACID integrity and accurate FEFO inventory state,          |
|  all write actions on [PC-01] have been suspended.                                |
|                                                                                   |
|  Current Action: Aborted (No data was altered)                                    |
|                                                                                   |
|  [ Attempting Reconnection... ]                                                   |
+-----------------------------------------------------------------------------------+
4.2 Failure Mode Handling MatrixFailure PointRoot CauseUser-Facing MessageSystem BehaviorNetwork InterruptionRouter offline or internet connectivity drop.  "CRITICAL NETWORK DISCONNECTION: Connection to Supabase Cloud lost. Input locked."Triggers un-dismissable crimson overlay, halts IPC dispatches, and polls for connection recovery.  Concurrent Lot Dispatch ConflictTwo terminals (PC-01 & PC-02) attempt to claim the remaining balance of the same lot simultaneously."Lot state changed by another terminal. Inventory refreshed."Database rejects the second transaction via version locking; UI re-renders latest FEFO lot quantities[cite: 2, 4, 7].Invalid Access PINIncorrect PIN entered at startup.  "Incorrect Security PIN. Please verify and try again."  Applies a 3-second UI lockout delay to prevent brute-force attacks.  Expired FEFO Lot DispatchOperator attempts to select an expired chemical lot for a batch order."FEFO Violation: Lot # [X] expired on [Date] and cannot be consumed."Disables selection button and flags the lot for Quality Control review.  Unbalanced Journal EntryDebit and Credit totals do not match during manual entry[cite: 2, 4, 7]."Cannot post entry: Total Debits (PKR X) must equal Total Credits (PKR Y)."  Highlights numerical discrepancy in crimson text and blocks submission[cite: 2, 4, 7].Printer Hardware ErrorUSB thermal printer runs out of paper or disconnects during GST invoicing[cite: 1, 4, 7]."Invoice saved successfully, but printing failed. Check printer connection."  Invoice remains posted in database (Posted state); print action is queued for retry[cite: 1, 4, 7].5. Launch Security Checklist (Edge Cases & Operational Directives)[ ] Unsaved Action Protection: If an operator opens a complex modal (e.g., "Batch Formula Composer" or "Inward Gate Pass Drawer") and accidentally clicks outside, the system prompts: "Discard unsaved chemical calculations?" to prevent accidental data loss[cite: 1, 4, 7].[ ] Unique Document Code Constraints: Database rules strictly enforce uniqueness on document codes (IGP-2026-001, GRN-2026-001, BT-2026-001, INV-2026-001) even under simultaneous submissions[cite: 2, 4, 7].[ ] Supabase Cloud Server Time Lock: To eliminate local clock drift across floor terminals (PC-01 to PC-04), all timestamps use Supabase Cloud Server Time (CURRENT_TIMESTAMP), completely ignoring the local client machine clock.  [ ] Zero / Negative Quantity Blocking: Input masks and database constraints block zero or negative values in invoices, GRNs, batch order yields, or formula ingredient weights[cite: 2, 4, 6, 7].[ ] Unconfigured Node Handshake: If a desktop installer launches without an environment file, it defaults to UNCONFIGURED-NODE and requires assigning a terminal identifier (PC-01 through PC-04) before enabling the PIN gate[cite: 2, 4, 6, 7].[ ] Sensitive Costing Masking on Floor Terminals: Chemical cost values and gross profit margins are visible on the owner web app (REMOTE-WEB) but masked on floor terminals unless unlocked by the Factory Master PIN.