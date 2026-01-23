const editor = document.getElementById("editor");
const colorPicker = document.getElementById("colorPicker");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");

/* ---------- Formatting commands ---------- */

document.querySelectorAll("[data-cmd]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.execCommand(btn.dataset.cmd, false, null);
    updateActiveStates();
    editor.focus();
  });
});

/* ---------- Color ---------- */

colorPicker.addEventListener("input", () => {
  document.execCommand("foreColor", false, colorPicker.value);
  editor.focus();
});

/* ---------- Lists ---------- */

document.getElementById("bulletBtn").onclick = () => {
  document.execCommand("insertUnorderedList");
  editor.focus();
};

document.getElementById("numberBtn").onclick = () => {
  document.execCommand("insertOrderedList");
  editor.focus();
};

/* ---------- Undo / Redo ---------- */

undoBtn.onclick = () => {
  document.execCommand("undo");
  editor.focus();
};

redoBtn.onclick = () => {
  document.execCommand("redo");
  editor.focus();
};

/* ---------- Active state detection ---------- */

function updateActiveStates() {
  document.querySelectorAll(".fmt").forEach(btn => {
    const cmd = btn.dataset.cmd;
    const active = document.queryCommandState(cmd);
    btn.classList.toggle("active", active);
  });
}

/* Update active states on cursor move / typing */

editor.addEventListener("keyup", updateActiveStates);
editor.addEventListener("mouseup", updateActiveStates);

/* ---------- Init ---------- */

editor.innerHTML = "<br>";
editor.focus();
