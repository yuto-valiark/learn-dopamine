"use strict";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const letters = "ABCD";
const workbookVersion = document.currentScript?.dataset.workbook;
const attempts = new Map();
let token, subject, phase, position, current;
let streak = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const stage = $("stage");
const dock = $("advance");
let transition;

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function phaseSet() {
  return subject.phases[phase - 1];
}

function key(index = position) {
  return [phase, index].join("/");
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

function celebrate() {
  if (reduceMotion.matches) return;
  const particles = Array.from({ length: 12 }, (_, index) => {
    const particle = document.createElement("span");
    particle.style.setProperty("--x", ((index - 5.5) * 23) + "px");
    particle.style.setProperty("--y", (-24 - (index * 17 % 58)) + "px");
    particle.style.setProperty("--turn", ((index - 5) * 42) + "deg");
    particle.style.setProperty("--hue", [46, 158, 196, 315][index % 4]);
    return particle;
  });
  $("celebration").replaceChildren(...particles);
  $("streak").animate([
    { transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" },
  ], { duration: 420 });
}

function updateStreak() {
  $("streak-count").textContent = streak;
  $("streak").classList.toggle("on-fire", streak >= 3);
}

function showChoice(index, fresh = false) {
  if (index === undefined) return;
  const passed = index === current.correct;
  Array.from($("options").children).forEach((button, i) => {
    button.setAttribute("aria-disabled", "true");
    if (i === current.correct) button.classList.add("correct");
    else if (i === index) button.classList.add("incorrect");
  });
  if (fresh) {
    streak = passed ? streak + 1 : 0;
    updateStreak();
  }
  $("advance").hidden = false;
  $("advance").dataset.result = passed ? "correct" : "incorrect";
  const count = fresh && streak > 1 ? "　🔥 " + streak + "連続" : "";
  $("result").textContent = passed ? "✦ 正解！" + count : "おしい！ 正解は " + letters[current.correct];
  $("model").hidden = !current.answer;
  if (fresh && passed) celebrate();
}

function render(focus = false) {
  cancelSlide();
  const set = phaseSet();
  current = set.questions[position];
  const state = attempts.get(key()) || {};
  $("summary").hidden = true;
  $("quiz").hidden = false;
  $("position").textContent = (position + 1) + " / " + set.questions.length + " 問" +
    (current.id ? "　" + current.id + "　｜　" + current.group : "");
  $("jump").value = position;
  $("phase-number").textContent = "フェーズ " + phase;
  $("progress").max = set.questions.length;
  $("progress").value = position + 1;
  $("question").textContent = current.sourceTex ? "問題" : current.text;
  $("question").classList.toggle("visually-hidden", Boolean(current.sourceTex));
  const image = $("prompt-image");
  image.hidden = !current.sourceTex;
  if (current.sourceTex) {
    image.src = "figures/" + current.figure + ".png";
    image.alt = current.text;
  }
  renderContext();
  $("instruction").hidden = !current.instruction || current.instruction === "元の問題に合う答えを一つ選ぼう。";
  $("instruction").textContent = current.instruction || "";
  $("paper").hidden = !current.paper;
  $("paper-detail").textContent = current.paper ? current.id + "　" + current.paper : "";
  $("options").replaceChildren(...(current.options || []).map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const letter = document.createElement("span");
    letter.className = "choice-letter";
    letter.textContent = letters[index];
    const content = document.createElement("span");
    content.textContent = option;
    button.append(letter, content);
    button.addEventListener("click", () => {
      if (attempts.has(key())) return;
      attempts.set(key(), { selected: index });
      showChoice(index, true);
    });
    return button;
  }));
  $("model").hidden = true;
  $("model").open = false;
  const explanation = current.webExplanation
    ? paragraph(current.webExplanation)
    : current.answerFigure ? figure(current.answerFigure, current.answer) : paragraph(current.answer);
  $("model-body").replaceChildren(...(current.answer ? [explanation] : []));
  $("advance").hidden = !current.paper;
  $("advance").dataset.result = current.paper ? "paper" : "";
  $("celebration").replaceChildren();
  $("result").textContent = "";
  $("previous").hidden = position === 0;
  $("next-label").textContent = position + 1 === set.questions.length ? "結果を見る" : "次の問題";
  showChoice(state.selected);
  $("copy-status").textContent = "";
  $("copy-fallback").hidden = true;
  $("open-chatgpt").hidden = true;
  params.set("question", String(position + 1));
  history.replaceState(null, "", "?" + params);
  $("stage").scrollTop = 0;
  if (focus) $("question").focus({ preventScroll: true });
}

function start(number, question = 1, focus = false) {
  phase = number;
  const set = phaseSet();
  position = Number.isInteger(question) && question > 0 && question <= set.questions.length ? question - 1 : 0;
  $("phase").value = number;
  params.set("phase", number);
  $("jump").replaceChildren(...set.questions.map((item, index) =>
    new Option(item.id ? item.id + "　" + (item.paper ? "紙で実施" : item.group) : "第" + (index + 1) + "問", index)
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

function promptForQuestion() {
  const state = attempts.get(key()) || {};
  return [
    "勉強クエストの練習問題です。小学生にも分かる日本語で、考え方を順番に解説してください。",
    "選んだ答えに誤りがあれば、答えと理由のどこを見直すとよいか教えてください。",
    "教科：" + subject.label + "　フェーズ：" + phase + "　問題番号：" + (current.id || position + 1),
    current.context && "場面：" + current.context,
    current.table && "資料の表：\n" + current.table.map(row => row.join(" ｜ ")).join("\n"),
    current.figureText && "図・資料の文字情報：\n" + current.figureText,
    current.figure && !current.sourceTex && "図・資料の画像：" + new URL("figures/" + current.figure + ".png", location.href).href,
    current.contextFigure && "この問題は、前の小問の図も参照します。",
    current.prior?.length && "前の小問：\n" + current.prior.join("\n"),
    "問題：" + current.text,
    current.instruction && "Webの補足：" + current.instruction,
    current.paper && "紙で実施する問題です。手順が分かるように説明してください。",
    current.sourceTex && "数式や図を含む原文（LaTeX）：\n" + current.sourceTex,
    current.options && current.options.map((option, i) => letters[i] + ". " + option).join("\n"),
    state.selected !== undefined && "選んだ答え：" + letters[state.selected],
    current.figure && !current.sourceTex && "図の配置や画像が必要な場合は、画像の添付をお願いしてください。",
  ].filter(Boolean).join("\n");
}

$("ask").addEventListener("click", async () => {
  const question = current;
  const text = promptForQuestion();
  try {
    await navigator.clipboard.writeText(text);
    if (current !== question || $("quiz").hidden) return;
    $("copy-status").textContent = "コピーしました。ChatGPTを開いて貼り付けてね。";
    $("copy-fallback").hidden = true;
  } catch {
    if (current !== question || $("quiz").hidden) return;
    $("copy-fallback").value = text;
    $("copy-fallback").hidden = false;
    $("copy-fallback").select();
    $("copy-status").textContent = "自動コピーできなかったので、下の文章をコピーしてね。";
  }
  $("open-chatgpt").hidden = false;
});

function slideTo(offset, duration, easing) {
  const from = duration ? getComputedStyle(stage).transform : "";
  transition?.cancel();
  transition = null;
  const transform = "translate3d(0," + offset + "px,0)";
  if (!duration || reduceMotion.matches) {
    stage.style.transform = reduceMotion.matches ? "" : transform;
    return;
  }
  const animation = stage.animate([
    { transform: from }, { transform },
  ], { duration, easing, fill: "forwards" });
  transition = animation;
  return animation;
}

function cancelSlide() {
  transition?.cancel();
  transition = null;
  stage.style.transform = "";
  stage.inert = false;
}

async function advance(direction = -1) {
  if (dock.hidden || $("menu").open || stage.inert) return;
  stage.inert = true;
  const distance = stage.clientHeight + dock.clientHeight;
  if (!reduceMotion.matches) {
    const outgoing = slideTo(direction * distance, 205, "cubic-bezier(.5,0,.8,.5)");
    try {
      await outgoing.finished;
    } catch {
      return;
    }
  }
  const questions = phaseSet().questions;
  if (position + 1 < questions.length) {
    position++;
    render(true);
  } else {
    showSummary(questions);
    cancelSlide();
  }
  if (!reduceMotion.matches) {
    slideTo(-direction * distance);
    const incoming = slideTo(0, 325, "cubic-bezier(.16,1,.3,1)");
    incoming.finished.then(() => {
      if (transition === incoming) cancelSlide();
    }, () => {});
  }
}

function showSummary(questions) {
  $("quiz").hidden = true;
  $("advance").hidden = true;
  $("previous").hidden = true;
  $("summary").hidden = false;
  $("stage").scrollTop = 0;
  let answered = 0;
  let score = 0;
  questions.forEach((q, i) => {
    const selected = attempts.get(key(i))?.selected;
    if (!q.paper && selected !== undefined) {
      answered++;
      if (selected === q.correct) score++;
    }
  });
  $("score").textContent = "解いた" + answered + "問中 " + score + "問 正解";
  $("continue").hidden = phase === subject.phases.length;
  $("score").focus({ preventScroll: true });
}

$("next").addEventListener("click", () => advance());

function verticalDelta(start, end) {
  const vertical = end.clientY - start.clientY;
  return Math.abs(vertical) > Math.abs(start.clientX - end.clientX) * 1.4 ? vertical : 0;
}

function dragSlide(delta) {
  slideTo(Math.sign(delta) * Math.min(Math.abs(delta) * .75, stage.clientHeight * .8));
}

function settleSlide(delta, bothDirections) {
  if (bothDirections ? Math.abs(delta) >= 45 : delta <= -45) {
    advance(Math.sign(delta));
  } else {
    const returned = slideTo(0, 200, "cubic-bezier(.2,.9,.3,1)");
    returned?.finished.then(() => {
      if (transition === returned) cancelSlide();
    }, () => {});
  }
}

let dockStart = null;
let dockSwiped = false;
dock.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0 || stage.inert) return;
  dockSwiped = false;
  dockStart = event;
  event.target.setPointerCapture(event.pointerId);
});
dock.addEventListener("pointermove", event => {
  if (dockStart?.pointerId !== event.pointerId) return;
  dragSlide(verticalDelta(dockStart, event));
});
dock.addEventListener("pointercancel", () => {
  dockStart = null;
  settleSlide(0, true);
});
dock.addEventListener("pointerup", event => {
  if (dockStart?.pointerId !== event.pointerId) return;
  const delta = verticalDelta(dockStart, event);
  dockStart = null;
  if (!delta) {
    settleSlide(0, true);
    return;
  }
  dockSwiped = Math.abs(delta) > 12;
  settleSlide(delta, true);
});
dock.addEventListener("click", event => {
  if (event.detail && dockSwiped) event.stopImmediatePropagation();
}, { capture: true });

let stageStart = null;
stage.addEventListener("touchstart", event => {
  const atEnd = stage.scrollHeight - stage.scrollTop - stage.clientHeight <= 2;
  stageStart = event.touches.length === 1 && atEnd && !stage.inert &&
    !dock.hidden && !$("menu").open ? event.touches[0] : null;
}, { passive: true });
stage.addEventListener("touchmove", event => {
  if (!stageStart || event.touches.length !== 1) return;
  const delta = verticalDelta(stageStart, event.touches[0]);
  if (delta >= -8) return;
  if (event.cancelable) event.preventDefault();
  else return;
  dragSlide(delta);
}, { passive: false });
stage.addEventListener("touchcancel", () => {
  if (stageStart) settleSlide(0, false);
  stageStart = null;
}, { passive: true });
stage.addEventListener("touchend", event => {
  const start = stageStart;
  stageStart = null;
  if (!start || event.touches.length) return;
  const delta = verticalDelta(start, event.changedTouches[0]);
  if (delta < -12 && event.cancelable) event.preventDefault();
  settleSlide(delta, false);
});

$("previous").addEventListener("click", () => {
  $("menu").open = false;
  position--;
  render(true);
});
$("retry").addEventListener("click", () => {
  phaseSet().questions.forEach((_, i) => attempts.delete(key(i)));
  streak = 0;
  updateStreak();
  start(phase, 1, true);
});
$("continue").addEventListener("click", () => start(phase + 1, 1, true));
$("phase").addEventListener("change", () => {
  $("menu").open = false;
  start(Number($("phase").value), 1, true);
});
$("jump").addEventListener("change", () => {
  $("menu").open = false;
  position = Number($("jump").value);
  render(true);
});
document.addEventListener("click", event => {
  if ($("menu").open && !$("menu").contains(event.target)) $("menu").open = false;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("menu").open) {
    $("menu").open = false;
    $("menu").querySelector("summary").focus();
  }
});

async function load() {
  const source = workbookVersion ? "workbook.json?v=" + workbookVersion : "workbook.json";
  const response = await fetch(source);
  if (!response.ok) throw new Error("workbook.json");
  const workbook = await response.json();
  const choice = params.get("subject");
  token = Object.hasOwn(workbook, choice) ? choice : "math";
  subject = workbook[token];
  params.set("subject", token);
  params.delete("mode");
  $("heading").textContent = subject.label;
  document.title = subject.label + "｜勉強クエスト";
  $("phase").replaceChildren(...subject.phases.map((set, index) =>
    new Option("フェーズ" + (index + 1) + "　" + set.title, index + 1)
  ));
  $("credits").hidden = token !== "social";
  $("paper-link").hidden = token !== "math";
  $("workbook").href = "../materials/" + token + ".pdf";
  $("workbook").hidden = false;
  for (const id of ["phase", "jump"]) $(id).disabled = false;
  $("load-status").hidden = true;
  const requested = Number(params.get("phase"));
  const valid = Number.isInteger(requested) && requested >= 1 && requested <= subject.phases.length;
  start(valid ? requested : 1, Number(params.get("question")));
}
load().catch(() => {
  $("load-status").hidden = false;
  $("load-status").textContent = "問題を読み込めませんでした。ページを開き直してね。";
});
