"use strict";

const params = new URLSearchParams(location.search);
const parts = Object.fromEntries(
  ["heading", "phase", "workbook", "load-status", "quiz", "position", "question", "options", "result",
   "ask", "next", "copy-status", "copy-fallback", "open-chatgpt", "summary", "score", "retry", "continue"]
    .map(id => [id, document.getElementById(id)])
);
let subject, phase, position, score, selected;

function active() {
  return subject.phases[phase - 1];
}

function choose(index) {
  if (selected !== null) return;
  selected = index;
  const question = active().questions[position];
  const passed = index === question.correct;
  if (passed) score++;
  Array.from(parts.options.children).forEach((button, i) => {
    button.disabled = true;
    if (i === question.correct) button.classList.add("correct");
    else if (i === index) button.classList.add("incorrect");
  });
  parts.result.textContent = passed ? "正解！" : `正解は「${question.options[question.correct]}」です。`;
  parts.next.hidden = false;
  parts.next.textContent = position + 1 === active().questions.length ? "結果を見る" : "次の問題";
}

function render(focus = false) {
  const set = active();
  const question = set.questions[position];
  selected = null;
  parts.summary.hidden = true;
  parts.quiz.hidden = false;
  parts.position.textContent = `${position + 1} / ${set.questions.length} 問`;
  parts.question.textContent = question.text;
  parts.options.replaceChildren(...question.options.map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${"ABCD"[index]}. ${option}`;
    button.addEventListener("click", () => choose(index));
    return button;
  }));
  parts.result.textContent = "";
  parts.next.hidden = true;
  parts["copy-status"].textContent = "";
  parts["copy-fallback"].hidden = true;
  parts["open-chatgpt"].hidden = true;
  if (focus) parts.question.focus();
}

function start(number, focus = false) {
  phase = number;
  position = score = 0;
  parts.phase.value = number;
  params.set("phase", number);
  history.replaceState(null, "", `?${params}`);
  render(focus);
}

function promptForQuestion() {
  const question = active().questions[position];
  const options = question.options.map((option, index) => `${"ABCD"[index]}. ${option}`).join("\n");
  const attempt = selected === null ? "まだ選んでいません。" : `選んだ答えは${"ABCD"[selected]}です。`;
  return [
    "勉強クエストの練習問題です。この問題を、小学生にも分かる日本語で解説してください。",
    "答えと、どう考えればよいかを順番に示してください。間違えた場合は、選んだ答えでどこを勘違いしたかも教えてください。",
    `教科：${subject.label}　フェーズ：${phase}（${active().title}）`,
    `問題：${question.text}`, options, attempt
  ].join("\n");
}

parts.ask.addEventListener("click", async () => {
  const text = promptForQuestion();
  try {
    await navigator.clipboard.writeText(text);
    parts["copy-status"].textContent = "コピーしました。ChatGPTを開いて貼り付けてね。";
    parts["copy-fallback"].hidden = true;
  } catch {
    parts["copy-fallback"].value = text;
    parts["copy-fallback"].hidden = false;
    parts["copy-fallback"].select();
    parts["copy-status"].textContent = "自動コピーできなかったので、下の文章をコピーしてね。";
  }
  parts["open-chatgpt"].hidden = false;
});

parts.next.addEventListener("click", () => {
  position++;
  if (position < active().questions.length) {
    render(true);
    return;
  }
  parts.quiz.hidden = true;
  parts.summary.hidden = false;
  parts.score.textContent = `${active().questions.length}問中 ${score}問 正解`;
  parts.continue.hidden = phase === subject.phases.length;
  parts.score.focus();
});
parts.retry.addEventListener("click", () => start(phase, true));
parts.continue.addEventListener("click", () => start(phase + 1, true));
parts.phase.addEventListener("change", () => start(Number(parts.phase.value)));

async function load() {
  const response = await fetch("bank.json");
  if (!response.ok) throw new Error("Could not load question bank");
  const data = await response.json();
  const choice = params.get("subject");
  const key = Object.hasOwn(data, choice) ? choice : "math";
  params.set("subject", key);
  subject = data[key];
  parts.heading.textContent = `${subject.label}の4択練習`;
  document.title = `${subject.label}の4択練習｜勉強クエスト`;
  parts.workbook.href = `../materials/${key}.pdf`;
  parts.workbook.hidden = false;
  parts.phase.replaceChildren(...subject.phases.map((set, index) =>
    new Option(`フェーズ${index + 1}　${set.title}`, index + 1)
  ));
  parts.phase.disabled = false;
  parts["load-status"].hidden = true;
  const requested = Number(params.get("phase"));
  const valid = Number.isInteger(requested) && requested >= 1 && requested <= subject.phases.length;
  start(valid ? requested : 1);
}

load().catch(() => {
  parts["load-status"].textContent = "問題を読み込めませんでした。ページを開き直してね。";
});
