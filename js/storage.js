// Thin persistence layer over localStorage. All reads/writes are wrapped in
// try/catch so a full or blocked storage quota degrades to an in-memory
// session instead of crashing the app.

const STORE_KEYS = {
  students: "tracer.students.v1",
  houses: "tracer.houses.v1",
  programs: "tracer.programs.v1",
  settings: "tracer.settings.v1",
  imports: "tracer.imports.v1"
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("Storage read failed for", key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("Storage write failed for", key, e);
    return false;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Default programmes get stable ids (not random ones) so that two devices
// that each create the defaults end up with the *same* records when synced.
function slugId(name) {
  return "p-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const Store = {
  // Set by sync.js. Called as onWrite(collectionName) after every local write.
  onWrite: null,

  defaultPrograms() {
    return DEFAULT_PROGRAMS.map((name, i) => ({ id: slugId(name), name, ord: i }));
  },

  // Writes data that came *from the cloud* into local storage without
  // triggering a push back to the cloud.
  applyRemote(col, list) {
    if (col === "settings") {
      const doc = list.find(x => x.id === "main");
      if (!doc) return;
      const { id, ...rest } = doc;
      saveJSON(STORE_KEYS.settings, rest);
      return;
    }
    saveJSON(STORE_KEYS[col], list);
  },

  init() {
    if (localStorage.getItem(STORE_KEYS.programs) === null) {
      saveJSON(STORE_KEYS.programs, Store.defaultPrograms());
    }
    if (localStorage.getItem(STORE_KEYS.houses) === null) {
      saveJSON(STORE_KEYS.houses, []);
    }
    if (localStorage.getItem(STORE_KEYS.students) === null) {
      saveJSON(STORE_KEYS.students, []);
    }
    if (localStorage.getItem(STORE_KEYS.settings) === null) {
      saveJSON(STORE_KEYS.settings, { instituteName: "GTVET Institute", graduationYear: new Date().getFullYear() });
    }
  },

  getStudents() { return loadJSON(STORE_KEYS.students, []); },
  setStudents(list) { const ok = saveJSON(STORE_KEYS.students, list); if (this.onWrite) this.onWrite("students"); return ok; },

  getHouses() { return loadJSON(STORE_KEYS.houses, []); },
  setHouses(list) { const ok = saveJSON(STORE_KEYS.houses, list); if (this.onWrite) this.onWrite("houses"); return ok; },

  getPrograms() { return loadJSON(STORE_KEYS.programs, []); },
  setPrograms(list) { const ok = saveJSON(STORE_KEYS.programs, list); if (this.onWrite) this.onWrite("programs"); return ok; },

  getSettings() { return loadJSON(STORE_KEYS.settings, { instituteName: "GTVET Institute" }); },
  setSettings(obj) { const ok = saveJSON(STORE_KEYS.settings, obj); if (this.onWrite) this.onWrite("settings"); return ok; },

  addStudent(student) {
    const list = this.getStudents();
    list.unshift({ id: uid(), createdAt: Date.now(), ...student });
    this.setStudents(list);
  },
  updateStudent(id, patch) {
    const list = this.getStudents();
    const idx = list.findIndex(s => s.id === id);
    if (idx !== -1) { list[idx] = { ...list[idx], ...patch }; this.setStudents(list); }
  },
  deleteStudent(id) {
    this.setStudents(this.getStudents().filter(s => s.id !== id));
  },

  // Finds the record in `list` that is probably the same person as
  // `candidate`, and says why:
  //   "id"       same Student ID (most reliable)
  //   "name+dob" same full name and same date of birth
  //   "name"     same full name, but a date of birth is missing on one side
  //              so it can't be confirmed (a *possible* duplicate)
  // Two people with the same name but different dates of birth are NOT a match.
  // `excludeId` skips a record against itself when editing.
  matchStudent(candidate, list, excludeId) {
    const cid = (candidate.studentId || "").trim().toLowerCase();
    const cname = (candidate.fullName || "").trim().toLowerCase();
    const cdob = (candidate.dob || "").trim();
    if (!cid && !cname) return null;

    if (cid) {
      const byId = list.find(s => !(excludeId && s.id === excludeId) &&
        (s.studentId || "").trim().toLowerCase() === cid);
      if (byId) return { student: byId, reason: "id" };
    }
    if (cname) {
      let weak = null;
      for (const s of list) {
        if (excludeId && s.id === excludeId) continue;
        if ((s.fullName || "").trim().toLowerCase() !== cname) continue;
        if (cdob && s.dob) {
          if ((s.dob || "").trim() === cdob) return { student: s, reason: "name+dob" };
        } else if (!weak) {
          weak = { student: s, reason: "name" };
        }
      }
      return weak;
    }
    return null;
  },

  findDuplicateStudent(candidate, excludeId) {
    const m = this.matchStudent(candidate, this.getStudents(), excludeId);
    return m ? m.student : null;
  },

  // Log of imported files, so re-importing the same file can be flagged.
  getImports() { return loadJSON(STORE_KEYS.imports, []); },
  addImportRecord(rec) {
    const list = this.getImports();
    list.unshift(rec);
    saveJSON(STORE_KEYS.imports, list.slice(0, 50));
  },

  addHouse(name, color) {
    const list = this.getHouses();
    if (list.some(h => h.name.toLowerCase() === name.toLowerCase())) return false;
    list.push({ id: uid(), name, color, ord: Date.now() });
    this.setHouses(list);
    return true;
  },
  renameHouse(id, newName, newColor) {
    const list = this.getHouses();
    const clean = newName.trim();
    if (!clean) return false;
    if (list.some(h => h.id !== id && h.name.toLowerCase() === clean.toLowerCase())) return false;
    const idx = list.findIndex(h => h.id === id);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], name: clean, color: newColor || list[idx].color };
    this.setHouses(list);
    return true;
  },
  deleteHouse(id) {
    this.setHouses(this.getHouses().filter(h => h.id !== id));
    // Unassign the house from any student who had it
    const students = this.getStudents().map(s => s.houseId === id ? { ...s, houseId: "" } : s);
    this.setStudents(students);
  },

  addProgram(name) {
    const list = this.getPrograms();
    if (list.some(p => p.name.toLowerCase() === name.toLowerCase())) return false;
    list.push({ id: uid(), name, ord: Date.now() });
    this.setPrograms(list);
    return true;
  },
  renameProgram(id, newName) {
    const list = this.getPrograms();
    const clean = newName.trim();
    if (!clean) return false;
    if (list.some(p => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) return false;
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], name: clean };
    this.setPrograms(list);
    return true;
  },
  deleteProgram(id) {
    this.setPrograms(this.getPrograms().filter(p => p.id !== id));
    const students = this.getStudents().map(s => s.programId === id ? { ...s, programId: "" } : s);
    this.setStudents(students);
  },

  // Used by Excel import: reuse an existing house/programme by name
  // (case-insensitive) or create a new one, returning its id.
  findOrCreateHouse(name, colorPicker) {
    const clean = (name || "").trim();
    if (!clean) return "";
    const list = this.getHouses();
    const existing = list.find(h => h.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    const color = colorPicker ? colorPicker(list.length) : "#8355C7";
    this.addHouse(clean, color);
    return this.getHouses().find(h => h.name.toLowerCase() === clean.toLowerCase()).id;
  },
  findOrCreateProgram(name) {
    const clean = (name || "").trim();
    if (!clean) return "";
    const list = this.getPrograms();
    const existing = list.find(p => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    this.addProgram(clean);
    return this.getPrograms().find(p => p.name.toLowerCase() === clean.toLowerCase()).id;
  }
};
