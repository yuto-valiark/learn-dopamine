"use strict";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const letters = "ABCD";
const attempts = new Map();
let banks, token, subject, phase, position, current, mode, drawing;
const canvas = $("sketch");
const ink = canvas.getContext("2d");

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function phaseSet() {
  return subject.phases[phase - 1];
}

function key() {
  return [token, mode, phase, position].join("/");
}

function figure(name, alt) {
  const image = document.createElement("img");
  image.src = "figures/" + name + ".png";
  image.alt = alt;
  image.className = "problem-image";
  return image;
}

function renderContext() {
  const context = $("context");
  context.replaceChildren();
  if (current.context) context.append(paragraph(current.context));
  if (current.contextFigure) context.append(figure(current.contextFigure, "前の小問の資料"));
  if (current.figure && !current.sourceTex) {
    context.append(figure(current.figure, current.figureText || "問題の図・資料"));
  }
  if (current.table) {
    const table = document.createElement("table");
    current.table.forEach((row, i) => {
      const tr = table.insertRow();
      for (const value of row) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = value;
        tr.append(cell);
      }
    });
    context.append(table);
  }
  if (current.prior?.length) {
    const prior = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "前の小問を確認";
    prior.append(summary, ...current.prior.map((question, index) => paragraph((index + 1) + ". " + question)));
    context.append(prior);
  }
  context.hidden = !context.children.length;
}

function showChoice(index) {
  if (index === undefined) return;
  const passed = index === current.correct;
  Array.from($("options").children).forEach((button, i) => {
    button.disabled = true;
    if (i === current.correct) button.classList.add("correct");
    else if (i === index) button.classList.add("incorrect");
  });
  $("result").textContent = passed ? "正解！" : "正解は「" + current.options[current.correct] + "」です。";
  $("next").hidden = false;
}

function showModel(state) {
  const model = $("model");
  model.replaceChildren(paragraph("解答・確認例"));
  model.append(current.answerFigure ? figure(current.answerFigure, current.answer) : paragraph(current.answer));
  model.hidden = !state.model;
  $("show-answer").textContent = state.model ? "解答・確認例を閉じる" : "解答・確認例を見る";
}

function render(focus = false) {
  const set = phaseSet();
  current = set.questions[position];
  const state = attempts.get(key()) || {};
  $("summary").hidden = true;
  $("quiz").hidden = false;
  $("position").textContent = (position + 1) + " / " + set.questions.length + " 問" +
    (current.id ? "　" + current.id + "　｜　" + current.group : "");
  $("jump").value = position;
  $("question").textContent = current.sourceTex ? "問題" : current.text;
  const image = $("prompt-image");
  image.hidden = !current.sourceTex;
  if (current.sourceTex) {
    image.src = "figures/" + current.figure + ".png";
    image.alt = current.text;
  }
  renderContext();
  $("options").replaceChildren(...(current.options || []).map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = letters[index] + ". " + option;
    button.addEventListener("click", () => {
      attempts.set(key(), { ...state, selected: index });
      showChoice(index);
    });
    return button;
  }));
  $("written").hidden = !!current.options;
  $("response").value = state.text || "";
  $("drawing").hidden = !!current.options || mode === "quick";
  $("drawing").open = !!current.practical || !!state.sketch;
  ink.clearRect(0, 0, canvas.width, canvas.height);
  if (state.sketch) ink.putImageData(state.sketch, 0, 0);
  showModel(state);
  $("result").textContent = "";
  $("previous").hidden = position === 0;
  $("next").hidden = mode === "quick";
  $("next").textContent = position + 1 === set.questions.length ? "練習を終える" : "次の問題";
  if (mode === "quick" && position + 1 === set.questions.length) $("next").textContent = "結果を見る";
  showChoice(state.selected);
  $("copy-status").textContent = "";
  $("copy-fallback").hidden = true;
  $("open-chatgpt").hidden = true;
  params.set("question", String(position + 1));
  history.replaceState(null, "", "?" + params);
  if (focus) $("question").focus();
}

function start(number, question = 1, focus = false) {
  phase = number;
  const set = phaseSet();
  position = Number.isInteger(question) && question > 0 && question <= set.questions.length ? question - 1 : 0;
  $("phase").value = number;
  params.set("phase", number);
  $("jump").replaceChildren(...set.questions.map((item, index) =>
    new Option(item.id ? item.id + "　" + item.group : "第" + (index + 1) + "問", index)
  ));
  const lesson = $("lesson-body");
  lesson.replaceChildren(
    ...(set.notes || []).map(paragraph),
    ...(set.examples || []).map(([question, answer]) => paragraph("例題：" + question + "\n解き方：" + answer)),
  );
  $("lesson").hidden = !lesson.children.length;
  $("lesson").open = false;
  render(focus);
}

function setMode(nextMode, number, question) {
  mode = nextMode === "quick" ? "quick" : "workbook";
  subject = banks[mode][token];
  $("mode").value = mode;
  params.set("mode", mode);
  $("heading").textContent = subject.label + (mode === "quick" ? "の追加4択" : "の練習問題");
  document.title = $("heading").textContent + "｜勉強クエスト";
  $("phase").replaceChildren(...subject.phases.map((set, index) =>
    new Option("フェーズ" + (index + 1) + (mode === "workbook" || index < 10 ? "　" + set.title : ""), index + 1)
  ));
  $("credits").hidden = token !== "social" || mode !== "workbook";
  start(number, question);
}

function promptForQuestion() {
  const state = attempts.get(key()) || {};
  return [
    "勉強クエストの練習問題です。小学生にも分かる日本語で、考え方を順番に解説してください。",
    "選んだ答えや書いた答えに誤りがあれば、どこを見直すとよいか教えてください。",
    "教科：" + subject.label + "　フェーズ：" + phase + "　問題番号：" + (current.id || position + 1),
    current.context && "場面：" + current.context,
    current.table && "資料の表：\n" + current.table.map(row => row.join(" ｜ ")).join("\n"),
    current.figureText && "図・資料の文字情報：\n" + current.figureText,
    current.figure && !current.sourceTex && "図・資料の画像：" + new URL("figures/" + current.figure + ".png", location.href).href,
    current.contextFigure && "この問題は、前の小問の図も参照します。",
    current.prior?.length && "前の小問：\n" + current.prior.join("\n"),
    "問題：" + current.text,
    current.sourceTex && "数式や図を含む原文（LaTeX）：\n" + current.sourceTex,
    current.options && current.options.map((option, i) => letters[i] + ". " + option).join("\n"),
    state.selected !== undefined && "選んだ答え：" + letters[state.selected],
    state.text && "書いた答え：" + state.text,
    current.figure && !current.sourceTex && "図の配置や画像が必要な場合は、画像の添付をお願いしてください。",
  ].filter(Boolean).join("\n");
}

$("ask").addEventListener("click", async () => {
  const text = promptForQuestion();
  try {
    await navigator.clipboard.writeText(text);
    $("copy-status").textContent = "コピーしました。ChatGPTを開いて貼り付けてね。";
    $("copy-fallback").hidden = true;
  } catch {
    $("copy-fallback").value = text;
    $("copy-fallback").hidden = false;
    $("copy-fallback").select();
    $("copy-status").textContent = "自動コピーできなかったので、下の文章をコピーしてね。";
  }
  $("open-chatgpt").hidden = false;
});

function update(fields) {
  attempts.set(key(), { ...attempts.get(key()), ...fields });
}
$("response").addEventListener("input", () => update({ text: $("response").value }));
$("show-answer").addEventListener("click", () => {
  update({ model: $("model").hidden });
  showModel(attempts.get(key()));
});

function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return [(event.clientX - bounds.left) * canvas.width / bounds.width,
    (event.clientY - bounds.top) * canvas.height / bounds.height];
}
canvas.addEventListener("pointerdown", event => {
  canvas.setPointerCapture(event.pointerId);
  drawing = event.pointerId;
  ink.beginPath();
  ink.moveTo(...point(event));
  ink.lineTo(...point(event).map(value => value + .1));
  ink.lineWidth = 3;
  ink.lineCap = "round";
  ink.strokeStyle = "#172e35";
  ink.stroke();
});
canvas.addEventListener("pointermove", event => {
  if (drawing !== event.pointerId) return;
  ink.lineTo(...point(event));
  ink.stroke();
});
function saveDrawing(event) {
  if (drawing !== event.pointerId) return;
  drawing = undefined;
  update({ sketch: ink.getImageData(0, 0, canvas.width, canvas.height) });
}
canvas.addEventListener("pointerup", saveDrawing);
canvas.addEventListener("pointercancel", saveDrawing);
$("clear-sketch").addEventListener("click", () => {
  ink.clearRect(0, 0, canvas.width, canvas.height);
  update({ sketch: null });
});

$("next").addEventListener("click", () => {
  const questions = phaseSet().questions;
  if (position + 1 < questions.length) {
    position++;
    render(true);
    return;
  }
  $("quiz").hidden = true;
  $("summary").hidden = false;
  const score = questions.reduce((total, q, i) =>
    total + Number(attempts.get([token, mode, phase, i].join("/"))?.selected === q.correct), 0);
  $("score").textContent = mode === "quick" ? questions.length + "問中 " + score + "問 正解" : "フェーズ" + phase + "の最後の問題です";
  $("continue").hidden = phase === subject.phases.length;
  $("score").focus();
});
$("previous").addEventListener("click", () => { position--; render(true); });
$("retry").addEventListener("click", () => {
  phaseSet().questions.forEach((_, i) => attempts.delete([token, mode, phase, i].join("/")));
  start(phase, 1, true);
});
$("continue").addEventListener("click", () => start(phase + 1, 1, true));
$("phase").addEventListener("change", () => start(Number($("phase").value)));
$("jump").addEventListener("change", () => { position = Number($("jump").value); render(true); });
$("mode").addEventListener("change", () => setMode($("mode").value, phase, 1));

async function load() {
  const [workbook, quick] = await Promise.all(["workbook.json", "bank.json"].map(async file => {
    const response = await fetch(file);
    if (!response.ok) throw new Error(file);
    return response.json();
  }));
  banks = { workbook, quick };
  const choice = params.get("subject");
  token = Object.hasOwn(workbook, choice) ? choice : "math";
  params.set("subject", token);
  $("workbook").href = "../materials/" + token + ".pdf";
  $("workbook").hidden = false;
  for (const id of ["phase", "jump", "mode"]) $(id).disabled = false;
  $("load-status").hidden = true;
  const requested = Number(params.get("phase"));
  const valid = Number.isInteger(requested) && requested >= 1 && requested <= workbook[token].phases.length;
  setMode(params.get("mode"), valid ? requested : 1, Number(params.get("question")));
}
load().catch(() => {
  $("load-status").hidden = false;
  $("load-status").textContent = "問題を読み込めませんでした。ページを開き直してね。";
});
