(function () {
  "use strict";

  Store.init();
  migrateSplitNames();

  // One-time (per record) migration: older records only have a combined
  // `fullName`. Split it into first/middle/last so the edit form isn't
  // blank for them. Safe to run on every load — once a record has a
  // first or last name, it's left alone.
  function migrateSplitNames() {
    const students = Store.getStudents();
    let changed = false;
    const updated = students.map(s => {
      if (!s.firstName && !s.lastName && s.fullName) {
        const parts = s.fullName.trim().split(/\s+/).filter(Boolean);
        let firstName = "", middleName = "", lastName = "";
        if (parts.length === 1) { firstName = parts[0]; }
        else if (parts.length === 2) { firstName = parts[0]; lastName = parts[1]; }
        else if (parts.length >= 3) { firstName = parts[0]; lastName = parts[parts.length - 1]; middleName = parts.slice(1, -1).join(" "); }
        changed = true;
        return { ...s, firstName, middleName, lastName };
      }
      return s;
    });
    if (changed) Store.setStudents(updated);
  }

  // ---------- small DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s ?? "").toString().replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  // Rebuilds a dropdown's options but keeps what's selected. Needed now that
  // changes from other devices can re-render the lists while someone is
  // halfway through filling in the form or using a filter.
  function refillSelect(select, html) {
    const prev = select.value;
    select.innerHTML = html;
    if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), Math.min(2600 + msg.length * 40, 7000));
  }

  // ---------- navigation ----------
  const views = ["dashboard", "students", "houses", "programs"];
  function showView(name) {
    views.forEach(v => {
      $("view-" + v).classList.toggle("is-active", v === name);
    });
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.view === name);
    });
  }
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // ---------- settings ----------
  const settings = Store.getSettings();
  $("instituteNameInput").value = settings.instituteName || "";
  $("brandName").textContent = settings.instituteName || "GTVET Institute";
  $("instituteNameInput").addEventListener("input", (e) => {
    const name = e.target.value.trim() || "GTVET Institute";
    $("brandName").textContent = name;
    Store.setSettings({ ...Store.getSettings(), instituteName: e.target.value });
  });

  // ---------- static reference selects ----------
  function fillSelect(select, values, { keepFirst = true } = {}) {
    const startHtml = keepFirst ? select.innerHTML : "";
    select.innerHTML = startHtml + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  }
  fillSelect($("fExamType"), EXAM_TYPES);
  fillSelect($("fRegion"), REGIONS);
  fillSelect($("fImpairment"), IMPAIRMENT_TYPES);

  // ---------- houses ----------
  let selectedColor = HOUSE_COLORS[0];
  function renderSwatches() {
    $("houseSwatches").innerHTML = HOUSE_COLORS.map(c =>
      `<button type="button" class="swatch${c === selectedColor ? " is-selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Pick color"></button>`
    ).join("");
    $("houseSwatches").querySelectorAll(".swatch").forEach(btn => {
      btn.addEventListener("click", () => { selectedColor = btn.dataset.color; renderSwatches(); });
    });
  }
  renderSwatches();

  function houseById(id) { return Store.getHouses().find(h => h.id === id); }
  function programById(id) { return Store.getPrograms().find(p => p.id === id); }

  function renderHouses() {
    const houses = Store.getHouses();
    const students = Store.getStudents();
    $("countHouses").textContent = houses.length;
    $("housesEmpty").hidden = houses.length > 0;
    $("houseList").innerHTML = houses.map(h => {
      const n = students.filter(s => s.houseId === h.id).length;
      return `<li class="chip" style="--chip-color:${h.color}" data-house-row="${h.id}">
        <span class="chip-dot"></span>
        <span class="chip-label" data-label>${esc(h.name)}</span>
        <span class="chip-meta">${n} student${n === 1 ? "" : "s"}</span>
        <button class="chip-edit" data-edit-house="${h.id}" type="button" aria-label="Rename house">✎</button>
        <button class="chip-delete" data-house-id="${h.id}" type="button" aria-label="Delete house">&times;</button>
      </li>`;
    }).join("");
    $("houseList").querySelectorAll(".chip-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        const h = houseById(btn.dataset.houseId);
        confirmAction(`Delete "${h.name}"?`, "Students in this house will become unassigned. This can't be undone.", () => {
          Store.deleteHouse(h.id);
          renderAll();
          toast(`Deleted ${h.name}`);
        });
      });
    });
    $("houseList").querySelectorAll(".chip-edit").forEach(btn => {
      btn.addEventListener("click", () => startHouseRename(btn.dataset.editHouse));
    });

    // refresh dependent selects
    const opts = houses.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join("");
    refillSelect($("fHouse"), `<option value="">— None —</option>` + opts);
    refillSelect($("filterHouse"), `<option value="">All houses</option>` + opts);
  }

  $("houseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("houseNameInput").value.trim();
    if (!name) return;
    const ok = Store.addHouse(name, selectedColor);
    if (!ok) { toast("That house already exists"); return; }
    $("houseNameInput").value = "";
    renderAll();
    toast(`Added ${name}`);
  });

  function startHouseRename(id) {
    const row = $("houseList").querySelector(`[data-house-row="${id}"]`);
    if (!row) return;
    const h = houseById(id);
    let editingColor = h.color;

    row.classList.add("chip-editing");
    row.innerHTML = `
      <input type="text" class="chip-rename-input" value="${esc(h.name)}" maxlength="60">
      <div class="swatches chip-edit-swatches">
        ${HOUSE_COLORS.map(c => `<button type="button" class="swatch${c === editingColor ? " is-selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Pick color"></button>`).join("")}
      </div>
      <div class="chip-edit-actions">
        <button type="button" class="chip-save-btn" data-action="save">Save</button>
        <button type="button" class="chip-cancel-btn" data-action="cancel">Cancel</button>
      </div>`;

    const input = row.querySelector(".chip-rename-input");
    input.focus();
    input.select();

    row.querySelectorAll(".chip-edit-swatches .swatch").forEach(btn => {
      btn.addEventListener("click", () => {
        editingColor = btn.dataset.color;
        row.querySelectorAll(".chip-edit-swatches .swatch").forEach(b => b.classList.toggle("is-selected", b.dataset.color === editingColor));
      });
    });

    function commit() {
      const newName = input.value.trim();
      if (!newName) { toast("House name can't be empty"); return; }
      if (newName === h.name && editingColor === h.color) { renderAll(); return; }
      const ok = Store.renameHouse(id, newName, editingColor);
      if (!ok) { toast("That house name already exists"); return; }
      toast("House updated");
      renderAll();
    }
    function cancel() { renderAll(); }

    row.querySelector('[data-action="save"]').addEventListener("click", commit);
    row.querySelector('[data-action="cancel"]').addEventListener("click", cancel);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  // ---------- programs ----------
  function renderPrograms() {
    const programs = Store.getPrograms();
    const students = Store.getStudents();
    $("countPrograms").textContent = programs.length;
    $("programsEmpty").hidden = programs.length > 0;
    $("programList").innerHTML = programs.map(p => {
      const n = students.filter(s => s.programId === p.id).length;
      return `<li class="chip chip-plain" data-program-row="${p.id}">
        <span class="chip-label" data-label>${esc(p.name)}</span>
        <span class="chip-meta">${n} student${n === 1 ? "" : "s"}</span>
        <button class="chip-edit" data-edit-program="${p.id}" type="button" aria-label="Rename programme">✎</button>
        <button class="chip-delete" data-program-id="${p.id}" type="button" aria-label="Delete programme">&times;</button>
      </li>`;
    }).join("");
    $("programList").querySelectorAll(".chip-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        const p = programById(btn.dataset.programId);
        confirmAction(`Delete "${p.name}"?`, "Students on this programme will become unassigned. This can't be undone.", () => {
          Store.deleteProgram(p.id);
          renderAll();
          toast(`Deleted ${p.name}`);
        });
      });
    });
    $("programList").querySelectorAll(".chip-edit").forEach(btn => {
      btn.addEventListener("click", () => startProgramRename(btn.dataset.editProgram));
    });

    const opts = programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    refillSelect($("fProgram"), `<option value="">Select programme…</option>` + opts);
    refillSelect($("filterProgram"), `<option value="">All programmes</option>` + opts);
  }

  function startProgramRename(id) {
    const row = $("programList").querySelector(`[data-program-row="${id}"]`);
    if (!row) return;
    const p = programById(id);
    const labelEl = row.querySelector("[data-label]");
    const input = document.createElement("input");
    input.type = "text";
    input.value = p.name;
    input.className = "chip-rename-input";
    input.maxLength = 120;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    function commit() {
      if (done) return;
      done = true;
      const newName = input.value.trim();
      if (!newName || newName === p.name) { renderAll(); return; }
      const ok = Store.renameProgram(id, newName);
      if (!ok) toast("That programme name already exists");
      else toast("Programme renamed");
      renderAll();
    }
    function cancel() {
      if (done) return;
      done = true;
      renderAll();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", commit);
  }

  $("programForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("programNameInput").value.trim();
    if (!name) return;
    const ok = Store.addProgram(name);
    if (!ok) { toast("That programme already exists"); return; }
    $("programNameInput").value = "";
    renderAll();
    toast(`Added ${name}`);
  });

  // ---------- students ----------
  function studentMatchesFilters(s, query, houseId, programId, sex, boarding) {
    if (houseId && s.houseId !== houseId) return false;
    if (programId && s.programId !== programId) return false;
    if (sex && (s.sex || "").toLowerCase() !== sex.toLowerCase()) return false;
    if (boarding && (s.boardingStatus || "").toLowerCase() !== boarding.toLowerCase()) return false;
    if (!query) return true;
    const hay = [s.studentId, s.fullName, s.mobile, s.email].join(" ").toLowerCase();
    return hay.includes(query);
  }

  // ---------- sorting ----------
  let sortState = { key: "fullName", direction: "asc" };

  function getSortValue(s, key) {
    if (key === "programme") { const p = programById(s.programId); return p ? p.name : (s.programOther || ""); }
    if (key === "house") { const h = houseById(s.houseId); return h ? h.name : ""; }
    return s[key] || "";
  }

  function compareValues(a, b, dir) {
    const cmp = a.toString().localeCompare(b.toString(), undefined, { numeric: true, sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  }

  function updateSortHeaders() {
    document.querySelectorAll("#studentsTable th[data-sort]").forEach(th => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.sort === sortState.key) th.classList.add(sortState.direction === "asc" ? "sort-asc" : "sort-desc");
    });
  }

  document.querySelectorAll("#studentsTable th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortState.key === key) sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      else sortState = { key, direction: "asc" };
      renderStudents();
    });
  });

  function renderStudents() {
    const students = Store.getStudents();
    $("countStudents").textContent = students.length;

    const query = $("studentSearch").value.trim().toLowerCase();
    const sex = $("filterSex").value;
    const houseId = $("filterHouse").value;
    const programId = $("filterProgram").value;
    const boarding = $("filterBoarding").value;
    const filtered = students
      .filter(s => studentMatchesFilters(s, query, houseId, programId, sex, boarding))
      .sort((a, b) => compareValues(getSortValue(a, sortState.key), getSortValue(b, sortState.key), sortState.direction));

    updateSortHeaders();

    $("studentsEmpty").hidden = students.length > 0;
    $("studentsTbody").innerHTML = filtered.map((s, idx) => {
      const house = houseById(s.houseId);
      const program = programById(s.programId);
      const programLabel = program ? program.name : (s.programOther || "—");
      return `<tr>
        <td class="cell-num">${idx + 1}</td>
        <td>${esc(s.studentId) || "—"}</td>
        <td class="cell-strong">${esc(s.fullName)}</td>
        <td>${esc(s.sex) || "—"}</td>
        <td>${esc(programLabel)}</td>
        <td>${house ? `<span class="house-tag" style="--chip-color:${house.color}">${esc(house.name)}</span>` : "—"}</td>
        <td>${esc(s.dob) || "—"}</td>
        <td>${esc(s.boardingStatus) || "—"}</td>
        <td>${esc(s.mobile) || "—"}</td>
        <td class="cell-actions">
          <button class="icon-btn" data-edit="${s.id}" type="button" aria-label="Edit">✎</button>
          <button class="icon-btn icon-btn-danger" data-delete="${s.id}" type="button" aria-label="Delete">🗑</button>
        </td>
      </tr>`;
    }).join("");

    $("studentsTbody").querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => openStudentModal(btn.dataset.edit));
    });
    $("studentsTbody").querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = students.find(x => x.id === btn.dataset.delete);
        confirmAction(`Delete ${s.fullName}?`, "This removes the graduate's record permanently.", () => {
          Store.deleteStudent(s.id);
          renderAll();
          toast(`Deleted ${s.fullName}`);
        });
      });
    });
  }

  $("studentSearch").addEventListener("input", renderStudents);
  $("filterSex").addEventListener("change", renderStudents);
  $("filterHouse").addEventListener("change", renderStudents);
  $("filterProgram").addEventListener("change", renderStudents);
  $("filterBoarding").addEventListener("change", renderStudents);

  // ---------- student modal ----------
  const studentFormFields = [
    "fStudentId", "fFirstName", "fMiddleName", "fLastName", "fSex", "fDob",
    "fProgram", "fLevel", "fIntakeYear", "fExamType", "fGradYear",
    "fHouse", "fBoarding", "fMobile", "fEmail",
    "fPlaceOfBirth", "fRegion", "fAddress", "fGps", "fGuardianName", "fGuardianContact",
    "fDisability", "fImpairment"
  ];

  function openStudentModal(editId) {
    $("studentForm").reset();
    $("fDisability").value = "No";
    if (editId) {
      const s = Store.getStudents().find(x => x.id === editId);
      $("studentModalTitle").textContent = "Edit student";
      $("studentId").value = s.id;
      $("fStudentId").value = s.studentId || "";
      $("fFirstName").value = s.firstName || "";
      $("fMiddleName").value = s.middleName || "";
      $("fLastName").value = s.lastName || "";
      $("fSex").value = s.sex || "";
      $("fDob").value = s.dob || "";
      $("fProgram").value = s.programId || "";
      $("fLevel").value = s.level || "";
      $("fIntakeYear").value = s.intakeYear || "";
      $("fExamType").value = s.examType || "";
      $("fGradYear").value = s.gradYear || "";
      $("fHouse").value = s.houseId || "";
      $("fBoarding").value = s.boardingStatus || "";
      $("fMobile").value = s.mobile || "";
      $("fEmail").value = s.email || "";
      $("fPlaceOfBirth").value = s.placeOfBirth || "";
      $("fRegion").value = s.region || "";
      $("fAddress").value = s.address || "";
      $("fGps").value = s.gps || "";
      $("fGuardianName").value = s.guardianName || "";
      $("fGuardianContact").value = s.guardianContact || "";
      $("fDisability").value = s.disability || "No";
      $("fImpairment").value = s.impairment || "";
    } else {
      $("studentModalTitle").textContent = "Add student";
      $("studentId").value = "";
      $("fIntakeYear").value = 2026;
      $("fGradYear").value = 2029;
    }
    $("studentModalBackdrop").hidden = false;
    $("fFirstName").focus();
  }
  function closeStudentModal() { $("studentModalBackdrop").hidden = true; }

  $("btnAddStudent").addEventListener("click", () => openStudentModal(null));
  $("closeStudentModal").addEventListener("click", closeStudentModal);
  $("cancelStudentForm").addEventListener("click", closeStudentModal);
  $("studentModalBackdrop").addEventListener("click", (e) => { if (e.target.id === "studentModalBackdrop") closeStudentModal(); });

  $("studentForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("studentId").value;
    const firstName = $("fFirstName").value.trim();
    const middleName = $("fMiddleName").value.trim();
    const lastName = $("fLastName").value.trim();
    const data = {
      studentId: $("fStudentId").value.trim(),
      firstName, middleName, lastName,
      fullName: [firstName, middleName, lastName].filter(Boolean).join(" "),
      sex: $("fSex").value,
      dob: $("fDob").value,
      programId: $("fProgram").value,
      level: $("fLevel").value,
      intakeYear: $("fIntakeYear").value,
      examType: $("fExamType").value,
      gradYear: $("fGradYear").value,
      houseId: $("fHouse").value,
      boardingStatus: $("fBoarding").value,
      mobile: $("fMobile").value.trim(),
      email: $("fEmail").value.trim(),
      placeOfBirth: $("fPlaceOfBirth").value.trim(),
      region: $("fRegion").value,
      address: $("fAddress").value.trim(),
      gps: $("fGps").value.trim(),
      guardianName: $("fGuardianName").value.trim(),
      guardianContact: $("fGuardianContact").value.trim(),
      disability: $("fDisability").value,
      impairment: $("fDisability").value === "Yes" ? $("fImpairment").value : ""
    };
    if (!data.firstName || !data.lastName) { toast("First name and last name are required"); return; }

    const dup = Store.findDuplicateStudent(data, id || null);
    if (dup) {
      confirmAction(
        "Possible duplicate",
        `"${dup.fullName}"${dup.studentId ? ` (ID: ${dup.studentId})` : ""} is already in the list. Save this as a separate record anyway?`,
        () => saveStudentRecord(id, data),
        { confirmLabel: "Add anyway", danger: false }
      );
      return;
    }
    saveStudentRecord(id, data);
  });

  function saveStudentRecord(id, data) {
    if (id) {
      Store.updateStudent(id, data);
      toast(`Saved ${data.fullName}`);
    } else {
      Store.addStudent(data);
      toast(`Added ${data.fullName}`);
    }
    closeStudentModal();
    renderAll();
  }

  // ---------- confirm modal ----------
  let confirmCallback = null;
  function confirmAction(title, body, onConfirm, opts = {}) {
    const { confirmLabel = "Delete", danger = true } = opts;
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    const okBtn = $("confirmOk");
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle("btn-danger", danger);
    okBtn.classList.toggle("btn-primary", !danger);
    confirmCallback = onConfirm;
    $("confirmBackdrop").hidden = false;
  }
  $("confirmCancel").addEventListener("click", () => { $("confirmBackdrop").hidden = true; confirmCallback = null; });
  $("confirmOk").addEventListener("click", () => {
    $("confirmBackdrop").hidden = true;
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  });
  $("confirmBackdrop").addEventListener("click", (e) => { if (e.target.id === "confirmBackdrop") { $("confirmBackdrop").hidden = true; confirmCallback = null; } });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("studentModalBackdrop").hidden) closeStudentModal();
    if (!$("confirmBackdrop").hidden) { $("confirmBackdrop").hidden = true; confirmCallback = null; }
    if (!$("importBackdrop").hidden) closeImportDialog();
  });

  // ---------- export / print ----------
  const EXPORT_COLUMNS = [
    ["Student ID", s => s.studentId],
    ["First Name", s => s.firstName],
    ["Middle Name", s => s.middleName],
    ["Last Name", s => s.lastName],
    ["Sex", s => s.sex],
    ["Date of Birth", s => s.dob],
    ["Place of Birth", s => s.placeOfBirth],
    ["Programme", s => (programById(s.programId) || {}).name || s.programOther || ""],
    ["Level", s => s.level],
    ["Intake Year", s => s.intakeYear],
    ["House", s => (houseById(s.houseId) || {}).name || ""],
    ["Day/Boarding Status", s => s.boardingStatus],
    ["Exam Type", s => s.examType],
    ["Graduation Year", s => s.gradYear],
    ["Contact Mobile", s => s.mobile],
    ["Email Address", s => s.email],
    ["Region of Birth", s => s.region],
    ["Residential Address", s => s.address],
    ["GPS Digital Address", s => s.gps],
    ["Parent/Guardian Name", s => s.guardianName],
    ["Parent/Guardian Contact", s => s.guardianContact],
    ["Disability Status", s => s.disability],
    ["Type of Impairment", s => s.impairment]
  ];

  // Column order/headers matching the school's official M7 Learner Registry
  // Template (used only for the Excel export, so the file can be handed
  // straight to that template's expected layout).
  const TEMPLATE_COLUMNS = [
    ["Index Number", s => s.studentId],
    ["First Name", s => s.firstName],
    ["Middle Name", s => s.middleName],
    ["Last Name", s => s.lastName],
    ["Date of Birth (DD/MM/YYYY)", s => formatDMY(s.dob)],
    ["Place of Birth", s => s.placeOfBirth],
    ["Region of Birth", s => s.region],
    ["Gender (Male/Female)", s => s.sex],
    ["Phone", s => s.mobile],
    ["Guardian Contact", s => s.guardianContact],
    ["Residential Address", s => s.address],
    ["Digital Address", s => s.gps],
    ["Programme", s => (programById(s.programId) || {}).name || s.programOther || ""],
    ["Intake Year", s => s.intakeYear],
    ["Current Year (Y1/2/3)", s => s.level]
  ];

  function formatDMY(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function currentFilteredStudents() {
    const query = $("studentSearch").value.trim().toLowerCase();
    const sex = $("filterSex").value;
    const houseId = $("filterHouse").value;
    const programId = $("filterProgram").value;
    const boarding = $("filterBoarding").value;
    return Store.getStudents()
      .filter(s => studentMatchesFilters(s, query, houseId, programId, sex, boarding))
      .sort((a, b) => compareValues(getSortValue(a, sortState.key), getSortValue(b, sortState.key), sortState.direction));
  }

  function exportRows() {
    const students = currentFilteredStudents();
    const headers = ["No.", ...EXPORT_COLUMNS.map(c => c[0])];
    const rows = students.map((s, idx) => [idx + 1, ...EXPORT_COLUMNS.map(c => c[1](s) ?? "")]);
    return { headers, rows };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  $("btnExportCsv").addEventListener("click", () => {
    const { headers, rows } = exportRows();
    const csvEscape = (v) => {
      const str = String(v ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(",")).join("\r\n");
    downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), "graduate-list.csv");
    toast("CSV downloaded");
  });

  $("btnExportXlsx").addEventListener("click", () => {
    if (typeof XLSX === "undefined") { toast("Excel export needs an internet connection the first time"); return; }
    const students = currentFilteredStudents();
    const headers = ["No.", ...TEMPLATE_COLUMNS.map(c => c[0])];
    const rows = students.map((s, idx) => [idx + 1, ...TEMPLATE_COLUMNS.map(c => c[1](s) ?? "")]);

    const aoa = [
      ["M7 — Learner Registry Template"],
      ["One row per learner. Use dropdowns for Programme, Gender, Region of Birth, Intake Year, and Current Year — typing free text in those columns will be rejected. All other fields are free text."],
      headers,
      ...rows
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
    ];
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Learners");
    XLSX.writeFile(wb, "M7_Learner_Registry.xlsx");
    toast("Excel file downloaded");
  });

  $("btnPrint").addEventListener("click", () => {
    const students = currentFilteredStudents();
    const instituteName = Store.getSettings().instituteName || "GTVET Institute";
    const rowsHtml = students.map((s, idx) => {
      const house = houseById(s.houseId);
      const program = programById(s.programId);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${esc(s.studentId)}</td>
        <td>${esc(s.fullName)}</td>
        <td>${esc(s.sex)}</td>
        <td>${esc(program ? program.name : s.programOther)}</td>
        <td>${esc(house ? house.name : "")}</td>
        <td>${esc(s.dob)}</td>
        <td>${esc(s.boardingStatus)}</td>
        <td>${esc(s.mobile)}</td>
      </tr>`;
    }).join("");
    $("printArea").innerHTML = `
      <h1>${esc(instituteName)}</h1>
      <h2>Graduate List — printed ${new Date().toLocaleDateString()}</h2>
      <table>
        <thead><tr>
          <th>No.</th><th>Student ID</th><th>Full Name</th><th>Sex</th><th>Programme</th>
          <th>House</th><th>Date of Birth</th><th>Residency</th><th>Mobile</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p class="print-footer">${students.length} student${students.length === 1 ? "" : "s"} listed</p>
    `;
    window.print();
  });

  // ---------- dashboard ----------
  function barRow(label, count, max, color) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return `<div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;${color ? `background:${color};` : ""}"></div></div>
      <span class="bar-count">${count}</span>
    </div>`;
  }

  function renderDashboard() {
    const students = Store.getStudents();
    const houses = Store.getHouses();
    const programs = Store.getPrograms();
    const total = students.length;

    const male = students.filter(s => (s.sex || "").toLowerCase() === "male").length;
    const female = students.filter(s => (s.sex || "").toLowerCase() === "female").length;
    const unspecified = total - male - female;

    $("statTotal").textContent = total;
    $("statMale").textContent = male;
    $("statFemale").textContent = female;
    $("statUnspecified").textContent = unspecified;
    $("statMalePct").textContent = total ? Math.round((male / total) * 100) + "%" : "0%";
    $("statFemalePct").textContent = total ? Math.round((female / total) * 100) + "%" : "0%";

    // Houses breakdown
    $("dashHouseEmpty").hidden = houses.length > 0;
    if (houses.length > 0) {
      const houseCounts = houses.map(h => ({
        name: h.name, color: h.color, count: students.filter(s => s.houseId === h.id).length
      })).sort((a, b) => b.count - a.count);
      const unassigned = students.filter(s => !s.houseId).length;
      const max = Math.max(1, ...houseCounts.map(h => h.count), unassigned);
      let html = houseCounts.map(h => barRow(h.name, h.count, max, h.color)).join("");
      if (unassigned > 0) html += barRow("Unassigned", unassigned, max, "#B9B3A4");
      $("dashHouseBars").innerHTML = html;
    } else {
      $("dashHouseBars").innerHTML = "";
    }

    // Top programmes breakdown (top 8 by count)
    $("dashProgramEmpty").hidden = programs.length > 0;
    if (programs.length > 0) {
      const progCounts = programs.map(p => ({
        name: p.name, count: students.filter(s => s.programId === p.id).length
      })).sort((a, b) => b.count - a.count).slice(0, 8);
      const max = Math.max(1, ...progCounts.map(p => p.count));
      $("dashProgramBars").innerHTML = progCounts.map(p => barRow(p.name, p.count, max)).join("");
    } else {
      $("dashProgramBars").innerHTML = "";
    }
  }

  // ---------- Excel import ----------
  const IMPORT_HOUSE_COLOR_CYCLE = (i) => HOUSE_COLORS[i % HOUSE_COLORS.length];

  function normalizeHeader(h) {
    return (h || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Maps normalized header text -> student field setter
  const IMPORT_FIELD_MAP = {
    studentid: (s, v) => s.studentId = String(v || "").trim(),
    indexnumber: (s, v) => { if (!s.studentId) s.studentId = String(v || "").trim(); },
    firstname: (s, v) => s.firstName = String(v || "").trim(),
    middlename: (s, v) => s.middleName = String(v || "").trim(),
    lastname: (s, v) => s.lastName = String(v || "").trim(),
    fullname: (s, v) => s._fullNameRaw = String(v || "").trim(),
    name: (s, v) => { if (!s._fullNameRaw) s._fullNameRaw = String(v || "").trim(); },
    sex: (s, v) => s.sex = String(v || "").trim(),
    gender: (s, v) => { if (!s.sex) s.sex = String(v || "").trim(); },
    gendermalefemale: (s, v) => { if (!s.sex) s.sex = String(v || "").trim(); },
    dateofbirth: (s, v) => s.dob = formatImportDate(v),
    dateofbirthddmmyyyy: (s, v) => { if (!s.dob) s.dob = formatImportDateDMY(v); },
    dob: (s, v) => { if (!s.dob) s.dob = formatImportDate(v); },
    placeofbirth: (s, v) => s.placeOfBirth = String(v || "").trim(),
    programme: (s, v) => s._programName = String(v || "").trim(),
    program: (s, v) => { if (!s._programName) s._programName = String(v || "").trim(); },
    house: (s, v) => s._houseName = String(v || "").trim(),
    level: (s, v) => s.level = String(v || "").trim(),
    currentyeary123: (s, v) => { if (!s.level) s.level = String(v || "").trim(); },
    currentyear: (s, v) => { if (!s.level) s.level = String(v || "").trim(); },
    intakeyear: (s, v) => s.intakeYear = String(v || "").trim(),
    dayboardingstatus: (s, v) => s.boardingStatus = String(v || "").trim(),
    boardingstatus: (s, v) => { if (!s.boardingStatus) s.boardingStatus = String(v || "").trim(); },
    examtype: (s, v) => s.examType = String(v || "").trim(),
    graduationyear: (s, v) => s.gradYear = String(v || "").trim(),
    contactmobile: (s, v) => s.mobile = phoneStr(v),
    mobile: (s, v) => { if (!s.mobile) s.mobile = phoneStr(v); },
    phone: (s, v) => { if (!s.mobile) s.mobile = phoneStr(v); },
    emailaddress: (s, v) => s.email = String(v || "").trim(),
    email: (s, v) => { if (!s.email) s.email = String(v || "").trim(); },
    regionofbirth: (s, v) => s.region = String(v || "").trim(),
    region: (s, v) => { if (!s.region) s.region = String(v || "").trim(); },
    residentialaddress: (s, v) => s.address = String(v || "").trim(),
    gpsdigitaladdress: (s, v) => s.gps = String(v || "").trim(),
    digitaladdress: (s, v) => { if (!s.gps) s.gps = String(v || "").trim(); },
    parentguardianname: (s, v) => s.guardianName = String(v || "").trim(),
    parentguardiancontact: (s, v) => s.guardianContact = phoneStr(v),
    guardiancontact: (s, v) => { if (!s.guardianContact) s.guardianContact = phoneStr(v); },
    disabilitystatus: (s, v) => s.disability = String(v || "").trim(),
    typeofimpairment: (s, v) => s.impairment = String(v || "").trim()
  };

  function formatImportDateDMY(v) {
    if (!v) return "";
    if (v instanceof Date && !isNaN(v)) return formatImportDate(v);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return String(v).trim();
  }

  function formatImportDate(v) {
    if (!v) return "";
    if (v instanceof Date && !isNaN(v)) {
      const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(v).trim();
  }

  // Excel stores phone numbers as numbers and drops the leading 0
  // (0241234567 -> 241234567). Ghana numbers are 10 digits, so restore it.
  function phoneStr(v) {
    if (typeof v === "number") {
      let t = String(Math.trunc(v));
      if (t.length === 9) t = "0" + t;
      return t;
    }
    return String(v || "").trim();
  }

  // Finds which row holds the column headers. The M7 template has a title
  // row and an instruction row above them, so row 1 isn't always the header.
  const NAME_HEADER_KEYS = ["firstname", "lastname", "fullname", "name"];
  function findHeaderRow(rows) {
    let best = -1, bestScore = 0;
    const limit = Math.min(rows.length, 20);
    for (let i = 0; i < limit; i++) {
      const keys = (rows[i] || []).map(normalizeHeader);
      if (!keys.some(k => NAME_HEADER_KEYS.includes(k))) continue;
      const score = keys.filter(k => IMPORT_FIELD_MAP[k]).length;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  // Prefers a sheet called "Learners" (as in the template), then any other
  // sheet that has a recognisable header row.
  function pickSheetRows(wb) {
    const names = [...wb.SheetNames].sort((a, b) => (/learner/i.test(b) ? 1 : 0) - (/learner/i.test(a) ? 1 : 0));
    for (const n of names) {
      const ws = wb.Sheets[n];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      const headerIdx = findHeaderRow(rows);
      if (headerIdx >= 0) {
        const startRow = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0;
        return { rows, headerIdx, startRow };
      }
    }
    return null;
  }

  // Cheap content fingerprint of a file, used to recognise a file that has
  // been imported before (same bytes => same fingerprint).
  function hashBytes(bytes) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      h1 ^= bytes[i]; h1 = Math.imul(h1, 16777619);
      h2 = (Math.imul(h2 ^ bytes[i], 2246822519) + i) | 0;
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + "-" + bytes.length;
  }

  function buildImportStudent(headers, row) {
    const s = {};
    headers.forEach((h, i) => {
      const setter = IMPORT_FIELD_MAP[h];
      if (setter) setter(s, row[i]);
    });
    if (!s.firstName && !s.lastName && s._fullNameRaw) {
      const parts = s._fullNameRaw.split(/\s+/).filter(Boolean);
      if (parts.length === 1) { s.firstName = parts[0]; }
      else if (parts.length === 2) { s.firstName = parts[0]; s.lastName = parts[1]; }
      else if (parts.length >= 3) { s.firstName = parts[0]; s.lastName = parts[parts.length - 1]; s.middleName = parts.slice(1, -1).join(" "); }
    }
    delete s._fullNameRaw;
    s.fullName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
    return s;
  }

  function parseImportRows(rows, headerIdx, startRow) {
    const headers = rows[headerIdx].map(normalizeHeader);
    const parsed = [], noNameRows = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => c === "" || c === null || c === undefined)) continue;
      const s = buildImportStudent(headers, row);
      const rowNo = startRow + r + 1;   // the row number you'd see in Excel
      if (!s.fullName) noNameRows.push(rowNo);
      else parsed.push({ rowNo, s });
    }
    return { parsed, noNameRows };
  }

  // Sorts every row into: new, exact duplicate (same ID, or same name + date
  // of birth) or possible duplicate (same name, can't confirm). Rows are
  // compared with the existing list AND with earlier rows in the same file.
  function planImport(parsed) {
    const existing = Store.getStudents();
    const seen = [];
    const plan = { fresh: [], exact: [], possible: [] };
    parsed.forEach(item => {
      let m = Store.matchStudent(item.s, existing, null), where = "list";
      if (!m) { m = Store.matchStudent(item.s, seen, null); where = "file"; }
      if (!m) { plan.fresh.push(item); seen.push(item.s); return; }
      const entry = { item, match: m.student, reason: m.reason, where };
      if (m.reason === "name") plan.possible.push(entry); else plan.exact.push(entry);
    });
    return plan;
  }

  // ---------- import preview / results dialog ----------
  let importState = null;

  const REASON_TEXT = {
    "id": "Same Student ID",
    "name+dob": "Same name and date of birth",
    "name": "Same name — can't confirm (no matching ID or date of birth)"
  };

  function fmtWhen(ms) {
    try { return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return new Date(ms).toString(); }
  }

  function importListRows(st) {
    const rows = [];
    const push = (e) => {
      const who = e.where === "file"
        ? `Row ${st.parsed.find(p => p.s === e.match).rowNo} of this file — ${esc(e.match.fullName)}`
        : `${esc(e.match.fullName)}${e.match.studentId ? ` (ID ${esc(e.match.studentId)})` : ""}`;
      const tagClass = e.reason === "name" ? "import-tag import-tag-possible" : "import-tag";
      rows.push({ rowNo: e.item.rowNo,
        html: `<td>${e.item.rowNo}</td><td>${esc(e.item.s.fullName)}${e.item.s.studentId ? ` <span class="import-id">(${esc(e.item.s.studentId)})</span>` : ""}</td><td>${who}</td><td><span class="${tagClass}">${esc(REASON_TEXT[e.reason])}</span></td>` });
    };
    st.plan.exact.forEach(push);
    if (!st.includePossible) st.plan.possible.forEach(push);
    (st.blocked || []).forEach(push);
    st.noNameRows.forEach(n => rows.push({ rowNo: n, html: `<td>${n}</td><td>—</td><td>—</td><td><span class="import-tag">No name in this row</span></td>` }));
    return rows.sort((a, b) => a.rowNo - b.rowNo);
  }

  function renderImportDialog() {
    const st = importState;
    const { plan } = st;
    const stat = (n, label, cls = "") => `<div class="import-stat ${cls}"><strong>${n}</strong><span>${label}</span></div>`;

    $("importTitle").textContent = st.done ? "Import complete" : "Import preview";
    $("importFileLine").textContent = `${st.fileName} — ${st.parsed.length + st.noNameRows.length} row${st.parsed.length + st.noNameRows.length === 1 ? "" : "s"} with data`;

    // Warn when this file (or one with the same name) was imported before
    const warn = $("importWarn");
    if (!st.done && st.prevSame) {
      warn.hidden = false;
      warn.textContent = `You already imported this exact file on ${fmtWhen(st.prevSame.importedAt)} (${st.prevSame.added} student${st.prevSame.added === 1 ? "" : "s"} added). Anyone already in the list will be skipped.`;
    } else if (!st.done && st.prevName) {
      warn.hidden = false;
      warn.textContent = `A file named "${st.prevName.name}" was imported on ${fmtWhen(st.prevName.importedAt)}, but this copy has different contents.`;
    } else {
      warn.hidden = true;
    }

    const toAdd = plan.fresh.length + (st.includePossible ? plan.possible.length : 0);
    if (st.done) {
      $("importStats").innerHTML =
        stat(st.result.imported, "imported", "import-stat-new") +
        stat(st.result.leftOut, "left out");
    } else {
      $("importStats").innerHTML =
        stat(plan.fresh.length + (st.includePossible ? plan.possible.length : 0), "new to import", "import-stat-new") +
        stat(plan.exact.length, "already in the list") +
        (plan.possible.length && !st.includePossible ? stat(plan.possible.length, plan.possible.length === 1 ? "possible duplicate" : "possible duplicates") : "") +
        (st.noNameRows.length ? stat(st.noNameRows.length, "without a name") : "");
    }

    // Option to import the "same name only" rows anyway
    $("importPossibleRow").hidden = st.done || plan.possible.length === 0;
    $("importPossible").checked = !!st.includePossible;
    $("importPossibleLabel").textContent =
      `Also import the ${plan.possible.length} possible duplicate${plan.possible.length === 1 ? "" : "s"} (same name as someone already listed, but no ID or date of birth to confirm it's the same person)`;

    const list = importListRows(st);
    $("importListWrap").hidden = list.length === 0;
    $("importListTitle").textContent = `${st.done ? "Left out" : "Will be left out"} (${list.length})`;
    $("importListBody").innerHTML = list.map(r => `<tr>${r.html}</tr>`).join("");

    const btn = $("importConfirm");
    btn.hidden = st.done;
    btn.disabled = toAdd === 0;
    btn.textContent = toAdd === 0 ? "Nothing new to import" : `Import ${toAdd} student${toAdd === 1 ? "" : "s"}`;
    $("importCancel").textContent = st.done ? "Close" : "Cancel";
  }

  function closeImportDialog() {
    $("importBackdrop").hidden = true;
    importState = null;
  }

  function commitImport() {
    const st = importState;
    if (!st || st.done) return;
    const candidates = [
      ...st.plan.fresh,
      ...(st.includePossible ? st.plan.possible.map(e => e.item) : [])
    ].sort((a, b) => a.rowNo - b.rowNo);

    let imported = 0;
    st.blocked = [];
    candidates.forEach(item => {
      const s = item.s;
      // Last safety check against the live list (e.g. the same ID twice in one go)
      const m = Store.matchStudent(s, Store.getStudents(), null);
      if (m && m.reason !== "name") { st.blocked.push({ item, match: m.student, reason: m.reason, where: "list" }); return; }
      s.programId = s._programName ? Store.findOrCreateProgram(s._programName) : "";
      s.houseId = s._houseName ? Store.findOrCreateHouse(s._houseName, IMPORT_HOUSE_COLOR_CYCLE) : "";
      delete s._programName;
      delete s._houseName;
      Store.addStudent(s);
      imported++;
    });

    if (imported > 0) {
      Store.addImportRecord({ hash: st.hash, name: st.fileName, importedAt: Date.now(), added: imported });
    }
    const leftOut = st.plan.exact.length + (st.includePossible ? 0 : st.plan.possible.length) + st.blocked.length + st.noNameRows.length;
    st.done = true;
    st.result = { imported, leftOut };
    renderAll();
    renderImportDialog();
    toast(`Imported ${imported} student${imported === 1 ? "" : "s"}${leftOut ? `, left out ${leftOut}` : ""}`);
  }

  $("importConfirm").addEventListener("click", commitImport);
  $("importCancel").addEventListener("click", closeImportDialog);
  $("closeImport").addEventListener("click", closeImportDialog);
  $("importBackdrop").addEventListener("click", (e) => { if (e.target.id === "importBackdrop") closeImportDialog(); });
  $("importPossible").addEventListener("change", (e) => {
    if (importState && !importState.done) { importState.includePossible = e.target.checked; renderImportDialog(); }
  });

  $("btnImportXlsx").addEventListener("click", () => $("importFileInput").click());

  $("importFileInput").addEventListener("change", (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    if (typeof XLSX === "undefined") { toast("Import needs an internet connection the first time"); input.value = ""; return; }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const picked = pickSheetRows(wb);
        if (!picked) {
          toast("Couldn't find a header row. The file needs a column like First Name, Last Name or Full Name.");
          return;
        }
        const { rows, headerIdx, startRow } = picked;
        const { parsed, noNameRows } = parseImportRows(rows, headerIdx, startRow);
        if (parsed.length + noNameRows.length === 0) { toast("No student rows found under the headers"); return; }

        const hash = hashBytes(data);
        const history = Store.getImports();
        importState = {
          fileName: file.name, hash, parsed, noNameRows,
          plan: planImport(parsed),
          includePossible: false, done: false,
          prevSame: history.find(h => h.hash === hash) || null,
          prevName: history.find(h => h.name === file.name && h.hash !== hash) || null
        };
        renderImportDialog();
        $("importBackdrop").hidden = false;
      } catch (err) {
        console.error(err);
        toast("Could not read that file — check it's a valid Excel/CSV export");
      } finally {
        input.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // ---------- render orchestration ----------
  function renderAll() {
    renderHouses();
    renderPrograms();
    renderStudents();
    renderDashboard();
  }
  renderAll();

  // ---------- cloud sync (does nothing until firebase-config.js is filled in) ----------
  Sync.init({
    onRemoteChange: renderAll,
    toast
  });

  // ---------- PWA service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW registration failed", err));
    });
  }
})();
