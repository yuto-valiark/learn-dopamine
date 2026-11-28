"use strict";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const letters = "ABCD";
const workbookVersion = document.currentScript?.dataset.workbook;
const progressVersion = document.currentScript?.dataset.progress || workbookVersion || "";
const figureVersion = document.currentScript?.dataset.figures;
let attempts = new Map();
const phaseProgress = new Map();
let token, subject, phase, position, current;
let streak = 0;
let shuffle = null;
let normalRun = null;
let savedShuffle = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const stage = $("stage");
const dock = $("advance");
const figureDialog = $("figure-dialog");
const questionList = $("question-list");
let correctAnimation;
const correctFeedbackDuration = 760;
let autoAdvanceTimer;
let transition;
let figureLayouts = {};

function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function phaseSet() {
  return shuffle || subject.phases[phase - 1];
}

function key(index = position) {
  return shuffle ? String(index) : [phase, index].join("/");
}

function storageKey() {
  return "study-quest:practice:v1:" + token;
}

function restoreProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    if (!saved) return;
    for (const [number, progress] of saved.phases || []) phaseProgress.set(number, progress);
    if (saved.workbookVersion === progressVersion) {
      for (const [question, attempt] of saved.attempts || []) attempts.set(question, attempt);
      streak = Number.isSafeInteger(saved.streak) && saved.streak > 0 ? saved.streak : 0;
      updateStreak();
    }
    return saved.activePhase;
  } catch {
    // Practice also works in browsers with storage disabled.
  }
}

function saveProgress(summary = false) {
  if (shuffle) {
    savedShuffle = {
      version: progressVersion, phases: shuffle.phases, order: shuffle.order,
      position, summary, attempts: [...attempts], streak,
    };
    try {
      localStorage.setItem(storageKey() + ":shuffle", JSON.stringify(savedShuffle));
    } catch {
      // The current run can still be resumed until this page is closed.
    }
    return;
  }
  phaseProgress.set(phase, { question: position + 1, summary });
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      workbookVersion: progressVersion,
      activePhase: phase,
      phases: [...phaseProgress],
      attempts: [...attempts],
      streak,
    }));
  } catch {
    // Keep progress in memory for this visit when storage is unavailable.
  }
}

function shuffleOrder(phases) {
  const order = phases.flatMap(number =>
    subject.phases[number - 1].questions.map((_, index) => [number, index]));
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function readShuffle() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey() + ":shuffle"));
    if (saved?.version === progressVersion && Array.isArray(saved.phases) && Array.isArray(saved.attempts) &&
        Number.isInteger(saved.position) && saved.position >= 0 && saved.position < saved.order.length &&
        saved.order.every(([number, index]) => subject.phases[number - 1]?.questions[index])) {
      return saved;
    }
  } catch {
    // Ignore stale or invalid shuffle data.
  }
  return null;
}

function startShuffle(run, focus = true) {
  normalRun ||= { attempts, streak };
  shuffle = {
    phases: run.phases,
    order: run.order,
    questions: run.order.map(([number, index]) => subject.phases[number - 1].questions[index]),
  };
  attempts = new Map(run.attempts);
  streak = run.streak || 0;
  position = run.position ?? 0;
  params.set("mode", "shuffle");
  $("normal-phase-controls").hidden = true;
  $("leave-shuffle").hidden = false;
  $("lesson").hidden = true;
  updateStreak();
  render(focus);
  if (run.summary) showSummary(shuffle.questions);
}

function leaveShuffle() {
  if (!shuffle) return;
  shuffle = null;
  ({ attempts, streak } = normalRun);
  normalRun = null;
  params.delete("mode");
  $("menu").open = false;
  $("normal-phase-controls").hidden = false;
  $("leave-shuffle").hidden = true;
  updateStreak();
  resumePhase(phase, undefined, false, true);
}

function sourcePhase(index = position) {
  return shuffle?.order[index][0] ?? phase;
}

function figureUrl(name) {
  const url = new URL("figures/" + name + ".png", location.href);
  const version = name.startsWith("mobile/") ? figureVersion : workbookVersion;
  if (version) url.searchParams.set("v", version);
  return url.href;
}

function figure(name, alt, kind = "material") {
  const layout = figureLayouts[name];
  const image = document.createElement("img");
  image.src = figureUrl(name);
  image.alt = alt;
  image.className = "problem-image";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "figure-preview " + kind;
  const hint = document.createElement("span");
  hint.textContent = "拡大";
  if (layout?.image) {
    const picture = document.createElement("picture");
    const source = document.createElement("source");
    source.media = "(max-width: 600px)";
    source.srcset = figureUrl(layout.image);
    picture.append(source, image);
    button.classList.add("has-phone-image");
    button.append(picture, hint);
  } else {
    button.append(image, hint);
  }
  button.addEventListener("click", () => {
    $("figure-full").src = image.currentSrc || image.src;
    $("figure-full").alt = image.alt;
    setFigureZoom(false);
    figureDialog.showModal();
    $("figure-view").scrollTo(0, 0);
  });
  if (!layout?.table) return button;
  const container = document.createElement("div");
  if (!layout.image) button.classList.add("wide-figure-only");
  container.append(button, materialTable(layout.table, true));
  return container;
}

function materialTable(rows, phoneOnly = false) {
  const [headings, ...entries] = rows;
  if (phoneOnly && !entries.length) {
    const flow = document.createElement("section");
    flow.className = "phone-table material-flow";
    const title = document.createElement("strong");
    title.textContent = headings[0];
    const steps = document.createElement("ol");
    for (const value of headings.slice(1)) {
      const step = document.createElement("li");
      step.textContent = value;
      steps.append(step);
    }
    flow.append(title, steps);
    return flow;
  }
  if (phoneOnly && headings.length > 4) {
    const records = document.createElement("div");
    records.className = "phone-table material-records";
    for (const [first, ...values] of entries) {
      const record = document.createElement("section");
      const title = document.createElement("strong");
      title.textContent = first;
      const pairs = document.createElement("dl");
      values.forEach((value, index) => {
        const label = document.createElement("dt");
        const data = document.createElement("dd");
        label.textContent = headings[index + 1];
        data.textContent = value;
        pairs.append(label, data);
      });
      record.append(title, pairs);
      records.append(record);
    }
    return records;
  }
  const table = document.createElement("table");
  table.className = phoneOnly ? "material-table phone-table" : "material-table";
  const head = table.createTHead().insertRow();
  headings.forEach(value => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = value;
    head.append(cell);
  });
  const body = table.createTBody();
  entries.forEach(row => {
    const tr = body.insertRow();
    row.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      tr.append(cell);
    });
  });
  return table;
}

function setFigureZoom(zoomed) {
  const button = $("figure-zoom");
  button.setAttribute("aria-pressed", String(zoomed));
  button.textContent = zoomed ? "全体表示" : "拡大";
  $("figure-view").classList.toggle("zoomed", zoomed);
}

$("figure-zoom").addEventListener("click", () => {
  setFigureZoom($("figure-zoom").getAttribute("aria-pressed") !== "true");
});

function renderContext() {
  const context = $("context");
  context.replaceChildren();
  const introduction = current.guessContext || current.context;
  if (introduction) context.append(paragraph(introduction));
  if (current.contextFigure) context.append(figure(current.contextFigure, "前の小問の資料"));
  if (current.figure && !current.sourceTex) {
    context.append(figure(current.figure, current.figureText || "問題の図・資料"));
  }
  if (current.table) {
    context.append(materialTable(current.table));
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
  correctAnimation?.cancel();
  const frames = reduceMotion.matches
    ? [{ opacity: 1 }, { opacity: 1 }]
    : [
      { opacity: .75, transform: "scale(.55)", offset: 0 },
      { opacity: 1, transform: "scale(1.07)", offset: .2 },
      { opacity: 1, transform: "scale(1)", offset: .35 },
      { opacity: 1, transform: "scale(1)", offset: .72 },
      { opacity: 0, transform: "scale(1.12)", offset: 1 },
    ];
  correctAnimation = $("correct-mark").animate(frames, { duration: correctFeedbackDuration, easing: "ease-out" });
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

function correctOption(question) {
  return question.correct ?? question.guessCorrect;
}

function cancelAutoAdvance() {
  clearTimeout(autoAdvanceTimer);
}

function advanceAfterCorrect() {
  cancelAutoAdvance();
  autoAdvanceTimer = setTimeout(() => {
    if (!document.hidden) advance();
  }, correctFeedbackDuration);
}

function showChoice(index, fresh = false) {
  if (index === undefined) return;
  const correct = correctOption(current);
  const passed = index === correct;
  Array.from($("options").children).forEach((button, i) => {
    button.setAttribute("aria-disabled", "true");
    if (i === correct) button.classList.add("correct");
    else if (i === index) button.classList.add("incorrect");
  });
  if (fresh) {
    streak = passed ? streak + 1 : 0;
    updateStreak();
  }
  $("advance").dataset.result = passed ? "correct" : "incorrect";
  const count = fresh && streak > 1 ? "　🔥 " + streak + "連続" : "";
  $("result").textContent = passed ? "✦ 正解！" + count : "おしい！ 正解は " + letters[correct];
  $("model").hidden = !current.answer;
  $("retry-question").hidden = false;
  if (fresh && passed) {
    celebrate();
    advanceAfterCorrect();
  }
}

function render(focus = false) {
  cancelAutoAdvance();
  correctAnimation?.cancel();
  cancelSlide();
  const set = phaseSet();
  current = set.questions[position];
  const manualCheck = correctOption(current) === undefined && current.selfCheck;
  const state = attempts.get(key()) || {};
  $("summary").hidden = true;
  $("quiz").hidden = false;
  $("position").textContent = (shuffle ? "シャッフル　" : "") + (position + 1) + " / " + set.questions.length + " 問" +
    (current.id ? "　" + current.id + "　｜　" + current.group : "");
  const source = sourcePhase();
  $("phase-number").textContent = "フェーズ " + source;
  $("workbook").href = "../materials/" + token + (source <= 10 ? "-01-10.pdf" : "-11-15.pdf");
  $("progress").setAttribute("aria-label", shuffle ? "シャッフル内の問題位置" : "フェーズ内の問題位置");
  $("progress").max = set.questions.length;
  $("progress").value = position + 1;
  const printedPrompt = Boolean(current.sourceTex && !current.webPrompt);
  $("question").textContent = printedPrompt ? "問題" : current.webPrompt || current.guessPrompt || current.text;
  $("question").classList.toggle("visually-hidden", printedPrompt);
  const promptImage = $("prompt-image");
  promptImage.hidden = !printedPrompt;
  promptImage.replaceChildren(...(printedPrompt
    ? [figure(current.figure, current.text, "printed-question")] : []));
  renderContext();
  $("instruction").hidden = !current.instruction || current.instruction === "元の問題に合う答えを一つ選ぼう。";
  $("instruction").textContent = current.instruction || "";
  if (manualCheck) {
    $("instruction").hidden = false;
    $("instruction").textContent = current.guessOptions
      ? "答えや理由がすべて合うものを一つ選んで、解答を確かめよう。"
      : "答えを考えてから「問題集の解答」を開こう。";
  }
  $("options").replaceChildren(...(current.guessOptions || current.options || []).map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const letter = document.createElement("span");
    letter.className = "choice-letter";
    letter.textContent = letters[index];
    const content = document.createElement("span");
    content.textContent = option;
    button.append(letter, content);
    if (manualCheck && current.guessOptions) button.setAttribute("aria-pressed", String(state.guess === index));
    button.addEventListener("click", () => {
      if (manualCheck && current.guessOptions) {
        attempts.set(key(), { ...attempts.get(key()), guess: index });
        saveProgress();
        Array.from($("options").children).forEach((choice, i) =>
          choice.setAttribute("aria-pressed", String(i === index)));
        return;
      }
      if (attempts.get(key())?.selected !== undefined) return;
      attempts.set(key(), { selected: index });
      showChoice(index, true);
      saveProgress();
    });
    return button;
  }));
  $("model").hidden = true;
  $("retry-question").hidden = true;
  $("model").open = false;
  const explanation = current.webExplanation
    ? paragraph(current.webExplanation)
    : current.answerFigure ? figure(current.answerFigure, current.answer) : paragraph(current.answer);
  $("model-body").replaceChildren(...(current.answer ? [explanation] : []));
  dock.hidden = false;
  $("advance").dataset.result = "";
  $("celebration").replaceChildren();
  $("result").textContent = "";
  if (manualCheck) {
    $("model").hidden = false;
    $("model").open = Boolean(state.checked);
  }
  updateBack();
  $("next-label").textContent = position + 1 === set.questions.length ? "結果を見る" : "次の問題";
  showChoice(state.selected);
  $("ask").setAttribute("aria-expanded", "false");
  $("chat-next").hidden = true;
  $("copy-status").textContent = "";
  $("copy-fallback").hidden = true;
  params.set("question", String(position + 1));
  params.delete("result");
  history.replaceState(null, "", "?" + params);
  saveProgress();
  $("stage").scrollTop = 0;
  if (focus) $("question").focus({ preventScroll: true });
}

$("model").addEventListener("toggle", () => {
  if (!current?.selfCheck || correctOption(current) !== undefined || !$("model").open || $("quiz").hidden) return;
  if (attempts.get(key())?.checked) return;
  attempts.set(key(), { ...attempts.get(key()), checked: true });
  saveProgress();
});

function start(number, question = 1, focus = false) {
  phase = number;
  const set = phaseSet();
  position = Number.isInteger(question) && question > 0 && question <= set.questions.length ? question - 1 : 0;
  $("phase").value = number;
  params.set("phase", number);
  const lesson = $("lesson-body");
  lesson.replaceChildren(
    ...(set.notes || []).map(paragraph),
    ...(set.examples || []).map(([question, answer]) => paragraph("例題：" + question + "\n解き方：" + answer)),
  );
  $("lesson").hidden = !lesson.children.length;
  $("lesson").open = false;
  render(focus);
}

function resumePhase(number, requestedQuestion, requestedResult = false, focus = false) {
  const saved = phaseProgress.get(number);
  const question = requestedQuestion ?? saved?.question ?? 1;
  start(number, question, focus);
  const questions = phaseSet().questions;
  if (saved?.summary && saved.question === question && position + 1 === questions.length &&
      (requestedQuestion == null || requestedResult)) {
    showSummary(questions);
  }
}

function promptForQuestion() {
  const state = attempts.get(key()) || {};
  return [
    "勉強クエストの練習問題です。小学生にも分かる日本語で、考え方を順番に解説してください。",
    "選んだ答えに誤りがあれば、答えと理由のどこを見直すとよいか教えてください。",
    "教科：" + subject.label + "　フェーズ：" + sourcePhase() + "　問題番号：" +
      (current.id || (shuffle?.order[position][1] ?? position) + 1),
    (current.guessContext || current.context) && "場面：" + (current.guessContext || current.context),
    current.table && "資料の表：\n" + current.table.map(row => row.join(" ｜ ")).join("\n"),
    current.figureText && "図・資料の文字情報：\n" + current.figureText,
    current.figure && !current.sourceTex && "図・資料の画像：" + figureUrl(current.figure),
    current.contextFigure && "この問題は、前の小問の図も参照します。",
    current.prior?.length && "前の小問：\n" + current.prior.join("\n"),
    "問題：" + (current.webPrompt || current.guessPrompt || current.text),
    current.instruction && "Webの補足：" + current.instruction,
    current.sourceTex && !current.webPrompt && "数式や図を含む原文（LaTeX）：\n" + current.sourceTex,
    (current.guessOptions || current.options)?.map((option, i) => letters[i] + ". " + option).join("\n"),
    (state.guess ?? state.selected) !== undefined && "選んだ答え：" + letters[state.guess ?? state.selected],
    current.figure && !current.sourceTex && "図の配置や画像が必要な場合は、画像の添付をお願いしてください。",
  ].filter(Boolean).join("\n");
}

$("ask").addEventListener("click", async () => {
  const question = current;
  const text = promptForQuestion();
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Some browsers block clipboard writes and need a manual copy.
  }
  if (current !== question || $("quiz").hidden) return;
  $("chat-next").hidden = false;
  $("ask").setAttribute("aria-expanded", "true");
  const fallback = $("copy-fallback");
  fallback.value = copied ? "" : text;
  fallback.hidden = copied;
  $("copy-status").textContent = copied
    ? "コピーできたよ！ ChatGPTを開いて、入力欄に貼り付けて送ってみよう。"
    : "下の質問文をコピーしてから、ChatGPTの入力欄に貼り付けて送ってみよう。";
  if (!copied) fallback.select();
  $("chat-next").scrollIntoView({ block: "nearest" });
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

function canMove(step) {
  return current && !$("menu").open && !document.querySelector("dialog[open]") && !stage.inert &&
    (step < 0 ? position > 0 || !$("summary").hidden : !$("quiz").hidden);
}

async function advance(step = 1) {
  if (!canMove(step)) return;
  cancelAutoAdvance();
  const nextPosition = $("summary").hidden ? position + step : position;
  const direction = -step;
  stage.inert = true;
  const distance = stage.clientHeight + dock.clientHeight;
  if (!reduceMotion.matches) {
    const outgoing = slideTo(direction * distance, 145, "cubic-bezier(.5,0,.8,.5)");
    try {
      await outgoing.finished;
    } catch {
      return;
    }
  }
  const questions = phaseSet().questions;
  if (nextPosition < questions.length) {
    position = nextPosition;
    render(true);
  } else {
    showSummary(questions);
    cancelSlide();
  }
  if (!reduceMotion.matches) {
    slideTo(-direction * distance);
    const incoming = slideTo(0, 240, "cubic-bezier(.16,1,.3,1)");
    incoming.finished.then(() => {
      if (transition === incoming) cancelSlide();
    }, () => {});
  }
}

function showSummary(questions) {
  $("quiz").hidden = true;
  $("advance").hidden = true;
  $("summary").hidden = false;
  params.set("result", "1");
  history.replaceState(null, "", "?" + params);
  saveProgress(true);
  updateBack();
  $("stage").scrollTop = 0;
  let answered = 0;
  let score = 0;
  let checked = 0;
  questions.forEach((q, i) => {
    const attempt = attempts.get(key(i));
    const selected = attempt?.selected;
    if (selected === undefined && q.selfCheck && attempt?.checked) checked++;
    if (selected !== undefined) {
      answered++;
      if (selected === correctOption(q)) score++;
    }
  });
  const choiceScore = answered ? "選択問題 " + answered + "問中 " + score + "問正解" : "";
  const selfCheckScore = checked ? "答えを確認した問題 " + checked + "問" : "";
  $("score").textContent = [choiceScore, selfCheckScore].filter(Boolean).join(" ｜ ") || "結果";
  $("continue").hidden = !shuffle && phase === subject.phases.length;
  $("continue").textContent = shuffle ? "通常モードに戻る" : "次のフェーズへ";
  $("score").focus({ preventScroll: true });
}

$("next").addEventListener("click", () => advance());

// An intentional interaction takes over from the automatic move.
for (const event of ["pointerdown", "click", "keydown", "wheel"]) {
  document.addEventListener(event, cancelAutoAdvance, { capture: true, passive: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelAutoAdvance();
});

function verticalDelta(start, end) {
  const vertical = end.clientY - start.clientY;
  return Math.abs(vertical) > Math.abs(start.clientX - end.clientX) * 1.4 ? vertical : 0;
}

function dragSlide(delta) {
  if (!delta || !canMove(-Math.sign(delta))) return;
  slideTo(Math.sign(delta) * Math.min(Math.abs(delta) * .75, stage.clientHeight * .8));
}

function settleSlide(delta) {
  const step = -Math.sign(delta);
  if (Math.abs(delta) >= 45 && canMove(step)) {
    advance(step);
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
  settleSlide(0);
});
dock.addEventListener("pointerup", event => {
  if (dockStart?.pointerId !== event.pointerId) return;
  const delta = verticalDelta(dockStart, event);
  dockStart = null;
  if (!delta) {
    settleSlide(0);
    return;
  }
  dockSwiped = Math.abs(delta) > 12;
  settleSlide(delta);
});
dock.addEventListener("click", event => {
  if (event.detail && dockSwiped) event.stopImmediatePropagation();
}, { capture: true });

let stageStart = null;
function atScrollEdge(step) {
  return step < 0 ? stage.scrollTop <= 2 :
    stage.scrollHeight - stage.scrollTop - stage.clientHeight <= 2;
}

function stageDelta(start, end) {
  const delta = verticalDelta(start.touch, end);
  return (delta < 0 ? start.next : start.previous) ? delta : 0;
}

stage.addEventListener("touchstart", event => {
  stageStart = event.touches.length === 1 ? {
    touch: event.touches[0],
    previous: atScrollEdge(-1) && canMove(-1),
    next: atScrollEdge(1) && canMove(1),
  } : null;
}, { passive: true });
stage.addEventListener("touchmove", event => {
  if (!stageStart || event.touches.length !== 1) return;
  const delta = stageDelta(stageStart, event.touches[0]);
  if (Math.abs(delta) < 8) return;
  if (event.cancelable) event.preventDefault();
  else return;
  dragSlide(delta);
}, { passive: false });
stage.addEventListener("touchcancel", () => {
  if (stageStart && (stageStart.next || stageStart.previous)) settleSlide(0);
  stageStart = null;
}, { passive: true });
stage.addEventListener("touchend", event => {
  const start = stageStart;
  stageStart = null;
  if (!start || event.touches.length) return;
  if (!start.next && !start.previous) return;
  const delta = stageDelta(start, event.changedTouches[0]);
  if (Math.abs(delta) > 12 && event.cancelable) event.preventDefault();
  settleSlide(delta);
});

let wheelUntil = 0;
let wheelStep = 0;
let wheelDistance = 0;
function scrollBetweenQuestions(event) {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const step = Math.sign(event.deltaY);
  if (event.timeStamp >= wheelUntil) {
    wheelStep = (event.currentTarget === dock || atScrollEdge(step)) && canMove(step) ? step : 0;
    wheelDistance = 0;
  }
  wheelUntil = event.timeStamp + 180;
  if (!wheelStep || wheelStep !== step || !event.cancelable) return;
  event.preventDefault();
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
    event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? stage.clientHeight : 1;
  wheelDistance += Math.abs(event.deltaY) * unit;
  if (wheelDistance >= 44) {
    wheelStep = 0;
    advance(step);
  }
}
for (const area of [stage, dock]) {
  area.addEventListener("wheel", scrollBetweenQuestions, { passive: false });
}

function updateBack() {
  const onSummary = !$("summary").hidden;
  const back = $("back");
  if (position === 0 && !onSummary) {
    back.href = shuffle ? "?subject=" + token : "../";
    back.textContent = shuffle ? "通常モード" : "教科一覧";
    return;
  }
  const previous = new URLSearchParams(params);
  previous.delete("result");
  previous.set("question", String(onSummary ? position + 1 : position));
  back.href = "?" + previous;
  back.textContent = onSummary ? "問題に戻る" : "前の問題";
}

$("back").addEventListener("click", event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !current) return;
  const onSummary = !$("summary").hidden;
  if (position === 0 && !onSummary) {
    if (shuffle) {
      event.preventDefault();
      leaveShuffle();
    }
    return;
  }
  event.preventDefault();
  $("menu").open = false;
  if (!onSummary) position--;
  render(true);
});
$("retry").addEventListener("click", () => {
  if (shuffle) {
    if (attempts.size && !window.confirm("このシャッフルの解答を消して、もう一度始める？")) return;
    startShuffle({ phases: shuffle.phases, order: shuffleOrder(shuffle.phases) });
    return;
  }
  if (phaseSet().questions.some((_, i) => attempts.has(key(i))) &&
      !window.confirm("このフェーズの解答を消して、1問目からやり直す？")) return;
  phaseSet().questions.forEach((_, i) => attempts.delete(key(i)));
  streak = 0;
  updateStreak();
  start(phase, 1, true);
});
$("retry-question").addEventListener("click", () => {
  attempts.delete(key());
  render(true);
});
$("continue").addEventListener("click", () => {
  if (shuffle) leaveShuffle();
  else resumePhase(phase + 1, undefined, false, true);
});
$("leave-shuffle").addEventListener("click", leaveShuffle);
$("phase").addEventListener("change", () => {
  $("menu").open = false;
  resumePhase(Number($("phase").value), undefined, false, true);
});
$("open-question-list").addEventListener("click", () => {
  $("menu").open = false;
  let completed = 0;
  const questions = phaseSet().questions;
  const items = questions.map((question, index) => {
    const attempt = attempts.get(key(index));
    const done = attempt?.selected !== undefined || Boolean(attempt?.checked);
    const active = index === position;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(index + 1);
    button.title = ["フェーズ " + sourcePhase(index), question.id, question.group].filter(Boolean).join("　");
    button.setAttribute("aria-label", [
      "第" + (index + 1) + "問", shuffle && "フェーズ " + sourcePhase(index),
      question.group, done ? "解答済み" : "未解答",
    ].filter(Boolean).join("、"));
    if (active) button.setAttribute("aria-current", "true");
    if (done) {
      completed++;
      const tick = document.createElement("span");
      tick.setAttribute("aria-hidden", "true");
      tick.textContent = "✓";
      button.append(tick);
    }
    button.addEventListener("click", () => {
      questionList.close();
      position = index;
      render(true);
    });
    const item = document.createElement("li");
    item.append(button);
    return item;
  });
  $("question-list-count").textContent =
    (shuffle ? "シャッフル" : "フェーズ " + phase) + "　｜　解答済み " + completed + " / " + questions.length;
  $("question-list-items").replaceChildren(...items);
  questionList.showModal();
  items[position].scrollIntoView({ block: "nearest" });
});

const shuffleDialog = $("shuffle-dialog");
const shuffleForm = $("shuffle-form");

function selectedPhases() {
  return Array.from(shuffleForm.querySelectorAll("input:checked"), input => Number(input.value));
}

function updateShuffleCount() {
  const count = selectedPhases().reduce((total, number) => total + subject.phases[number - 1].questions.length, 0);
  $("start-shuffle").disabled = !count;
  $("start-shuffle").textContent = count ? "始める（" + count + "問）" : "フェーズを選ぶ";
}

$("open-shuffle").addEventListener("click", () => {
  $("menu").open = false;
  const selected = shuffle?.phases || savedShuffle?.phases || [phase];
  $("shuffle-phases").replaceChildren(...subject.phases.map((set, index) => {
    const number = index + 1;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(number);
    input.checked = selected.includes(number);
    const label = document.createElement("label");
    label.append(input, "フェーズ " + number);
    label.title = set.title;
    return label;
  }));
  $("resume-shuffle").hidden = !savedShuffle || Boolean(shuffle);
  updateShuffleCount();
  shuffleDialog.showModal();
});
shuffleForm.addEventListener("change", updateShuffleCount);
shuffleForm.addEventListener("submit", event => {
  event.preventDefault();
  const phases = selectedPhases();
  if (!phases.length) return;
  if (savedShuffle?.attempts.length &&
      !window.confirm("新しいシャッフルを始める？ 前のシャッフルの解答は消えます。")) return;
  shuffleDialog.close();
  startShuffle({ phases, order: shuffleOrder(phases) });
});
$("resume-shuffle").addEventListener("click", () => {
  shuffleDialog.close();
  startShuffle(savedShuffle);
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
  const [response, layouts] = await Promise.all([
    fetch(source),
    figureVersion ? fetch("figure-layout.json?v=" + figureVersion)
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({})) : {},
  ]);
  if (!response.ok) throw new Error("workbook.json");
  figureLayouts = layouts;
  const workbook = await response.json();
  const choice = params.get("subject");
  token = Object.hasOwn(workbook, choice) ? choice : "math";
  subject = workbook[token];
  document.body.dataset.subject = token;
  params.set("subject", token);
  $("heading").textContent = subject.label;
  document.title = subject.label + "｜勉強クエスト";
  $("phase").replaceChildren(...subject.phases.map((set, index) =>
    new Option("フェーズ" + (index + 1) + "　" + set.title, index + 1)
  ));
  $("credits").hidden = token !== "social";
  $("workbook").hidden = false;
  $("phase").disabled = false;
  $("open-question-list").hidden = false;
  $("open-shuffle").hidden = false;
  $("load-status").hidden = true;
  const saved = restoreProgress();
  savedShuffle = readShuffle();
  const validPhase = number => Number.isInteger(number) && number >= 1 && number <= subject.phases.length;
  const requested = Number(params.get("phase"));
  const initialPhase = validPhase(requested) ? requested : validPhase(saved) ? saved : 1;
  if (params.get("mode") === "shuffle" && savedShuffle) {
    phase = validPhase(saved) ? saved : initialPhase;
    startShuffle(savedShuffle, false);
    return;
  }
  params.delete("mode");
  const initialQuestion = Number(params.get("question")) || undefined;
  resumePhase(initialPhase, initialQuestion, params.get("result") === "1");
}
load().catch(() => {
  $("load-status").hidden = false;
  $("load-status").textContent = "問題を読み込めませんでした。ページを開き直してね。";
});
