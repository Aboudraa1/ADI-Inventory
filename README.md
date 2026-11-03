# ADI Inventory Web App

Static responsive inventory counting app for GitHub Pages with Supabase Auth/Postgres/RLS.

## Features
- Shared staff login, separate admin login.
- Category navigation, item lookup by name / number / barcode, mobile camera scanning.
- Count once per item per open session; read-only staff review.
- Admin: categories, item upsert, minimum/maximum rules, close session, edit reorder draft and export approved CSV.
- No system stock shown to staff; no automatic vendor order submission.

## Setup
1. Create a Supabase project. In **SQL Editor**, run `sql/schema.sql` on a new project (policies use CREATE POLICY and are not designed to be rerun).
2. In **Authentication > Users**, create two email/password users: a staff shared account and a distinct admin account. Turn off public sign-ups in Auth settings. Use strong passwords and share the staff password only through approved channels.
3. Copy their UUIDs. In SQL Editor run (substitute real UUIDs):
   ```sql
   insert into public.profiles(user_id,role,display_name) values
   ('ADMIN-UUID','admin','ADI Administrator'),
   ('STAFF-UUID','staff','ADI Inventory Staff');
   ```
4. In `js/`, copy `config.example.js` to `config.js`. Insert the **Project URL** and **publishable/anon key** from Supabase project settings. Never use the service_role or secret key in browser code. `config.js` is gitignored, so to deploy GitHub Pages you must explicitly provide a deployment copy with the publishable key only (e.g. commit a public `config.js` with only public values or inject it in CI). Do not add secrets.
5. Open Admin page and add categories (Nuts, Bread, Dates), then items with actual barcodes. Or bulk-import items through Supabase Table Editor CSV after creating category IDs.
6. Publish the static files with GitHub Pages: repository Settings > Pages > Deploy from branch > main/root. All URLs use relative paths and work under a project subpath.
7. Test on HTTPS phone: login, search, camera permission, save count, review, admin close, reorder edit, export.

## Important behavior and limits
- The app is an initial working foundation, not an audited production deployment. Test RLS and operational procedures before real counts.
- Shared credentials cannot identify the individual staff member. For auditability use individual accounts later.
- An open session is shared by all users of the same shared account per category. To begin another session, an admin must close the previous one.
- Saved count entries are immutable. A duplicate item in a session is rejected by the database. Corrections require an admin-approved new session or future correction workflow.
- Reorder suggestions are generated only for **counted items** with enabled stock rules when admin closes a session. An uncounted item is **unknown**, not zero. The formula is `if counted < min: max(max - counted, 0)`.
- Suggested order quantities are editable by admin; approving/exporting is not an actual purchase order. There is no direct Business Central integration.
- This initial app loads at most 1000 items per category and 1000 rows per admin table; for larger datasets add server-side pagination/search.
- No offline mode. Camera requires HTTPS, permissions, and supported browser. Manual search is fallback.
- Do not expose service-role keys, database passwords, or other secrets in the repository.
- For production: consider dedicated accounts, rate limiting, backups, item UOM, count-session controls, and audit logs.

## Project layout
- `index.html`: login
- `home.html`: category cards
- `inventory.html`: barcode/search/count/read-only review
- `admin.html`: items, rules, sessions, reorder draft
- `css/style.css`: responsive design
- `js/`: browser modules
- `sql/schema.sql`: tables, policies and secure RPC functions
