# Put the app online (shared by all devices)

GitHub Pages can only host files, so the shared data lives in **Firebase**
(Google's free tier). Every signed-in device then sees the same students,
houses and programmes, and changes appear on the other devices within a
second or two. If a device loses internet, it keeps working and catches up
automatically when it reconnects.

You do this setup **once**. It takes about 15 minutes.

> Until step 4 is done, the app keeps working exactly as before (local only,
> no sign-in). So you can push these files to GitHub first and set up Firebase
> afterwards.

## 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project** → give it a name (e.g. `dti-students`) → you can turn Google
   Analytics off → **Create project**.

## 2. Create the database
1. Left menu: **Build → Firestore Database → Create database**.
2. Pick the location closest to you. **It can't be changed later.**
3. Choose **Start in production mode** → **Create**.

## 3. Turn on sign-in and create the staff accounts
1. **Build → Authentication → Get started → Sign-in method → Email/Password →
   Enable → Save.**
2. **Users** tab → **Add user** → enter each staff member's email and a
   password. Use lowercase emails. Share the password with them privately.
   (There is no "sign up" button in the app; only accounts you create here can
   sign in.)
3. If you see it under **Authentication → Settings → User actions**, untick
   **Enable create (sign-up)**. This stops strangers from creating accounts.
   Step 5 protects your data even if you can't find this option.

## 4. Connect the app
1. Click the gear icon → **Project settings → General → Your apps → the
   `</>` (Web) icon**. Give it a nickname and **Register app**.
2. Copy the values from the `firebaseConfig` it shows into
   **`js/firebase-config.js`**, replacing each `PASTE...` placeholder.
3. Also in Firebase: **Authentication → Settings → Authorized domains → Add
   domain** → add your GitHub Pages address, e.g. `yourname.github.io`.

## 5. Lock the data to your staff (important)
1. **Firestore Database → Rules** tab.
2. Delete what's there, paste in the contents of **`firestore.rules`**, and
   **replace the two example emails with your staff emails** (lowercase, exactly
   as you created them in step 3).
3. **Publish.**

This is what keeps the student records private. The config values from step 4
are *not* secrets, so it's fine that they are in your repo; the rules and the
sign-in are what protect the data. Don't put the real staff emails in the
`firestore.rules` file in GitHub; edit them in the Firebase console only.

## 6. Publish and sign in
1. Push everything to your GitHub repo (replace the old files).
2. Open the site. You'll see a **Sign in** screen. Sign in with one of the
   accounts.
3. **The first device** you sign in on, which already has students saved in
   its browser, will be asked:
   - **Upload to shared database**: copies everything on this device to the
     cloud (choose this on the device that has your real data, *once*), or
   - **Start fresh**: ignores what's on this device.
4. Every other device: sign in and the data appears. If a device also has its
   own saved students, it's asked whether to add them to the shared list
   (duplicates are skipped) or use the shared data only. A backup copy of
   what was on the device is kept in the browser either way.

## Adding or removing staff later
- **Add:** create the user (Authentication → Users) **and** add their email to
  the rules list (step 5), then Publish.
- **Remove:** delete the user, and remove their email from the rules.

## Good to know
- **Two people editing the same student at the same moment:** the last save
  wins. Different students never clash.
- **Backups:** Export CSV / Export Excel still work and are worth doing
  regularly, e.g. at the end of each term.
- **Sign out** locks the app on that device, but doesn't erase the offline copy
  kept in the browser. On a shared or public computer, also clear the site's
  data in the browser settings.
- **Cost:** the free plan allows roughly 50,000 reads and 20,000 writes per
  day, far more than a school needs for a few hundred students. Check
  Firebase's current limits if you scale up.
- **Privacy:** this puts student records on Google's servers. Make sure that
  fits your school's data-protection obligations, and only give accounts to
  staff who need them.
