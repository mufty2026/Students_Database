# Graduate Tracer — PWA

An offline-first, installable web app for managing a school's graduate list:
add/delete **houses**, add/edit/delete **programmes**, and add/edit/delete
**students** (picking their house, programme and day/boarding status from
dropdowns). A **dashboard** shows totals by sex and by house. Print the list,
export it to CSV / Excel, or **import** students in bulk from an Excel file.
All data is stored in the browser (`localStorage`) — nothing is sent to a
server.

### Sharing data between devices (optional)
Out of the box the app is local-only. To make every device share one live
database (with sign-in), follow **SETUP-CLOUD.md**. Until you fill in
`js/firebase-config.js`, nothing changes.

### Importing students from Excel
Use **Import Excel** on the Students page. The importer reads the header row
and matches columns by name (not case-sensitive), so it understands files
that use the same headers as **Export Excel/CSV** produces: Student ID, Full
Name, Sex, Date of Birth, Programme, House, Day/Boarding Status, Exam Type,
Graduation Year, Contact Mobile, Email Address, Region of Birth, Residential
Address, GPS Digital Address, Parent/Guardian Name, Parent/Guardian Contact,
Social Media Handle, Disability Status, Type of Impairment. Rows need at
least a Full Name to be imported. Any Programme or House name that doesn't
already exist is created automatically.

Built from the fields in your `2026-2027_Tracer_Form.xlsx` (GTVET-IDMS M1
Graduate List): Student ID, Full Name, Sex, Date of Birth, Programme, Exam
Type, Graduation Year, Contact Mobile, Email, Region of Birth, Residential
Address, GPS Digital Address, Parent/Guardian Name & Contact, Social Media
Handle, Disability Status and Type of Impairment — plus a new **House** field.

## File structure

```
index.html
manifest.webmanifest       PWA install metadata
sw.js                       offline caching (service worker)
css/styles.css
js/reference-data.js        default programme list, exam types, regions, impairments
js/storage.js                localStorage read/write helpers
js/app.js                    all UI logic
icons/                        app icons
```

## Run it locally

Because service workers require HTTP (not `file://`), serve the folder with
any static server, e.g.:

```bash
cd tracer-app
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (or use an existing one) and push these
   files to it — the whole `tracer-app` folder's **contents** should be at the
   root of the repo (or in `/docs`, see step 3).

   ```bash
   cd tracer-app
   git init
   git add .
   git commit -m "Graduate tracer PWA"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**,
   pick branch `main` and folder `/ (root)` (or `/docs` if you put the files
   there), then **Save**.
4. GitHub gives you a URL like `https://<your-username>.github.io/<your-repo>/`.
   It can take a minute to go live.
5. Open that URL. On a phone, use the browser's "Add to Home Screen" /
   "Install app" option to install it like a native app.

No build step, no dependencies to install — it's plain HTML/CSS/JS, so this
is all that's needed.

## Notes

- **Data lives per-browser.** Each device/browser keeps its own copy in
  `localStorage`. Use **Export CSV** or **Export Excel** regularly to back up
  or to consolidate data collected on different devices.
- **Excel export** uses the SheetJS library loaded from a CDN — it needs an
  internet connection the first time it's used in a browser session (it's
  then cached by the service worker for offline reuse). **CSV export**, add,
  edit, delete, search, filter and print all work fully offline.
- Deleting a house or programme unassigns it from any students that had it
  (their records aren't deleted).
- To change the icons or the institute name shown in the header/print,
  edit the "Institute name" field in the sidebar (saved automatically) and/or
  swap the files in `icons/`.
