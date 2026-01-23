const editor = document.getElementById("editor");
const colorPicker = document.getElementById("colorPicker");

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

document.getElementById("bulletBtn").onclick = () => {
  document.execCommand("insertUnorderedList");
  editor.focus();
};

document.getElementById("numberBtn").onclick = () => {
  insertNumberedLine(1);
  editor.focus();
};

function insertNumberedLine(n) {
  const span = document.createElement("span");
  span.className = "number-line";
  span.textContent = `(${n}) `;
  insertNodeAtCursor(span);
}

function insertNodeAtCursor(node) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

editor.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const node = range.startContainer.parentElement;

    if (node?.classList?.contains("number-line")) {
      e.preventDefault();
      const text = node.textContent;
      const match = text.match(/\((\d+)\)/);
      if (!match) return;

      const next = parseInt(match[1], 10) + 1;
      const br = document.createElement("br");
      node.after(br);
      insertNumberedLine(next);
    }
  }
});
