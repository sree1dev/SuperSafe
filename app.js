const editor = document.getElementById("editor");
const colorPicker = document.getElementById("colorPicker");

/* Formatting */

document.querySelectorAll("[data-cmd]").forEach(btn => {
  btn.onclick = () => {
    document.execCommand(btn.dataset.cmd, false, null);
    editor.focus();
  };
});

colorPicker.oninput = () => {
  document.execCommand("foreColor", false, colorPicker.value);
  editor.focus();
};

/* Bullet list (native) */
document.getElementById("bulletBtn").onclick = () => {
  document.execCommand("insertUnorderedList");
  editor.focus();
};

/* Number list — COPY bullet logic */
document.getElementById("numberBtn").onclick = () => {
  document.execCommand("insertOrderedList");
  editor.focus();
};
