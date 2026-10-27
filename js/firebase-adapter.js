// Thin bridge between the app and Firebase (Auth + Firestore).
// Loaded as an ES module so it can import the Firebase SDK from Google's CDN.
// It exposes window.CloudAdapter; all sync logic lives in sync.js.

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

(async function () {
  try {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || /^PASTE/i.test(cfg.apiKey)) return;   // not configured -> local-only mode

    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } = authMod;
    const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
            collection, doc, onSnapshot, writeBatch } = fsMod;

    const app = initializeApp(cfg);
    const auth = getAuth(app);
    // Offline cache: edits made without internet are kept and sent automatically on reconnect.
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });

    window.CloudAdapter = {
      onAuth(cb) {
        return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null));
      },
      signIn(email, password) { return signInWithEmailAndPassword(auth, email, password); },
      signOut() { return signOut(auth); },

      // cb receives { docs: [{id, data}], fromCache, pending }
      subscribe(col, cb, errCb) {
        return onSnapshot(collection(db, col), { includeMetadataChanges: true },
          snap => cb({
            docs: snap.docs.map(d => ({ id: d.id, data: d.data() })),
            fromCache: snap.metadata.fromCache,
            pending: snap.metadata.hasPendingWrites
          }),
          err => errCb && errCb(err));
      },

      // Firestore allows 500 operations per batch; use 400 to stay well inside.
      write(col, upserts, deletes) {
        const ops = [
          ...upserts.map(item => ({ t: "set", item })),
          ...deletes.map(id => ({ t: "del", id }))
        ];
        const commits = [];
        for (let i = 0; i < ops.length; i += 400) {
          const batch = writeBatch(db);
          ops.slice(i, i + 400).forEach(op => {
            if (op.t === "set") batch.set(doc(db, col, op.item.id), op.item, { merge: true });
            else batch.delete(doc(db, col, op.id));
          });
          commits.push(batch.commit());
        }
        return Promise.all(commits);
      }
    };
  } catch (err) {
    console.error("Cloud adapter failed to load", err);
  } finally {
    document.dispatchEvent(new Event("cloudadapter-ready"));
  }
})();
