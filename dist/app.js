"use strict";

const byId = (id) => document.getElementById(id);
const library = window.ListeningLibrary;
const generateButton = byId("generate");
const sampleButton = byId("sample");
const levelInputs = document.querySelectorAll('input[name="level"]');
const lengthPicker = byId("exam-length");
const voicePicker = byId("exam-voice");
const pacePicker = byId("exam-pace");
const player = byId("player");
const trackTitle = byId("track-title");
const trackCaption = byId("track-caption");
const trackSource = byId("track-source");
const audio = byId("audio");
const reviewControls = byId("review-controls");
const playButton = byId("play");
const replayButton = byId("replay");
const seek = byId("seek");
const speed = byId("speed");
const transcriptToggle = byId("transcript-toggle");
const transcript = byId("transcript");
const transcriptCopy = byId("transcript-copy");
const errorBox = byId("exercise-feedback");
const errorText = byId("exercise-error-text");
const retryButton = byId("retry");
const examActions = byId("exam-actions");
const examClock = byId("exam-clock");
const startButton = byId("start-exam");
const examForm = byId("exam-form");
const submitButton = byId("submit-exam");
const questionList = byId("question-list");
const examResults = byId("exam-results");
const returnButton = byId("return-selection");
const exerciseNavigation = byId("exercise-navigation");

const levelNames = { cet4: "CET-4", cet6: "CET-6", ielts: "IELTS" };
const sourceNames = { sample: "模拟示例", bank: "题库抽取", selected: "自主选题" };
const voiceNames = { female: "女性英语", male: "男性英语" };
const optionLetters = "ABCD";

let exercise;
let audioUrl = "";
let audioVoice = "";
let examRate = 1;
let examPace = 1;
let nativePace = false;
let phase = "idle";
let timer;
let submittedAnswers;
let roundVersion = 0;
let roundController = new AbortController();

const soundBars = byId("sound-bars");
const soundHeights = [7, 14, 11, 21, 14, 24, 34, 23, 43, 29, 38, 19, 26, 44, 34, 50, 36, 24, 38, 43, 24, 34, 18, 25, 39, 30, 19, 22, 12, 15, 8, 14, 7];
soundHeights.forEach((height, index) => {
  const bar = document.createElement("i");
  bar.style.setProperty("--height", height + "px");
  bar.style.setProperty("--delay", "-" + ((index * 127) % 850) + "ms");
  soundBars.append(bar);
});

async function checkStatus() {
  const button = byId("check-status");
  const label = byId("connection-label");
  const dot = document.querySelector(".connection-dot");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const status = await library.loadCatalog();
    dot.dataset.state = "ready";
    label.textContent = `${status.total} 篇练习`;
    byId("text-status").textContent = "每档 60 篇";
    byId("voice-status").textContent = "录音已备好";
    if (Array.isArray(status.voices)) {
      for (const option of voicePicker.options) option.disabled = !status.voices.includes(option.value);
      if (voicePicker.selectedOptions[0]?.disabled) {
        const available = [...voicePicker.options].find((option) => !option.disabled);
        if (available) voicePicker.value = available.value;
      }
    }
  } catch {
    dot.dataset.state = "partial";
    label.textContent = "题库加载未完成";
    byId("text-status").textContent = "请检查网络后重试";
    byId("voice-status").textContent = "随练习按需加载";
  } finally {
    button.disabled = false;
  }
}

function setPhase(nextPhase, caption) {
  phase = nextPhase;
  exerciseNavigation.hidden = phase === "idle";
  const selectable = ["idle", "error", "ready", "review", "submit-error"].includes(phase);
  library.setBusy(!selectable);
  generateButton.disabled = !selectable;
  generateButton.querySelector("span").textContent = {
    loading: "正在准备试题…", voice: "正在加载录音…", "review-voice": "正在更新录音…",
  }[phase] || "随机抽取模考";
  sampleButton.disabled = !selectable;
  levelInputs.forEach((input) => { input.disabled = !selectable; });
  lengthPicker.disabled = !selectable;
  voicePicker.disabled = !selectable;
  pacePicker.disabled = !selectable;

  const startLabel = { ready: "开始模拟", continue: "开始播放" }[phase];
  startButton.hidden = !startLabel;
  if (startLabel) startButton.querySelector("span").textContent = startLabel;
  examActions.hidden = !startLabel && examClock.hidden;

  const acceptingAnswers = ["playing", "answering", "continue"].includes(phase);
  questionList.querySelectorAll("fieldset").forEach((fieldset) => { fieldset.disabled = !acceptingAnswers; });
  submitButton.disabled = !["answering", "submit-error"].includes(phase);
  submitButton.textContent = {
    submitting: "正在交卷…", "submit-error": "重试交卷",
  }[phase] || "交卷";
  player.dataset.state = phase;
  if (caption !== undefined) trackCaption.textContent = caption;
}

function setTranscript(open) {
  transcript.hidden = !open;
  transcriptToggle.setAttribute("aria-expanded", String(open));
  transcriptToggle.querySelector("span").textContent = open ? "隐藏原文" : "查看原文";
}

function setError(message = "", retry = false) {
  errorText.textContent = message;
  errorBox.hidden = !message;
  retryButton.hidden = !retry;
}

function setReviewControls(visible) {
  reviewControls.hidden = !visible;
  playButton.disabled = !visible || !audioUrl;
  seek.disabled = !visible || !audioUrl;
  speed.disabled = !visible || !audioUrl;
  replayButton.disabled = !visible || !audioUrl;
  transcriptToggle.hidden = !visible;
}

function applyExamPace(multiplier = 1) {
  audio.preservesPitch = true;
  audio.defaultPlaybackRate = nativePace ? 1 : examRate * examPace;
  audio.playbackRate = audio.defaultPlaybackRate * multiplier;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return Math.floor(wholeSeconds / 60) + ":" + String(wholeSeconds % 60).padStart(2, "0");
}

function updateProgress() {
  const progress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
  seek.value = Math.round(progress * Number(seek.max));
  seek.style.setProperty("--progress", (progress * 100) + "%");
  seek.setAttribute("aria-valuetext", formatTime(audio.currentTime) + " / " + formatTime(audio.duration));
  byId("elapsed").textContent = formatTime(audio.currentTime);
  byId("duration").textContent = formatTime(audio.duration);
}

function updatePlayIcon(playing) {
  byId("play-icon").setAttribute("href", playing ? "#icon-pause" : "#icon-play");
  playButton.setAttribute("aria-label", playing ? "暂停" : "播放");
}

function clearAudio() {
  const previousUrl = audioUrl;
  audioUrl = "";
  audioVoice = "";
  nativePace = false;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (previousUrl.startsWith("blob:")) URL.revokeObjectURL(previousUrl);
  updatePlayIcon(false);
  updateProgress();
}

function stopTimer() {
  clearInterval(timer);
  examClock.hidden = true;
}

function startTimer(seconds, label, onExpiry) {
  stopTimer();
  const version = roundVersion;
  const deadline = Date.now() + seconds * 1000;
  byId("clock-label").textContent = label;
  byId("clock-time").textContent = formatTime(seconds);
  examClock.hidden = false;
  examActions.hidden = false;

  timer = setInterval(() => {
    if (version !== roundVersion) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    byId("clock-time").textContent = formatTime(remaining);
    if (remaining === 0) {
      stopTimer();
      onExpiry();
    }
  }, 200);
}

function renderQuestions() {
  const ielts = exercise.level === "ielts";
  byId("questions-caption").textContent = ielts
    ? "填空题每空不超过两个单词，数量可用数字。选择题每题选择一个答案。"
    : "听录音中的问题，每题选择一个答案。";
  questionList.replaceChildren();

  exercise.questions.forEach((question, index) => {
    const group = document.createElement("fieldset");
    group.className = "exam-question";
    const legend = document.createElement("legend");
    legend.textContent = ielts ? (index + 1) + ". " + question.prompt : "第 " + (index + 1) + " 题";
    if (ielts) legend.lang = "en";
    group.append(legend);

    if (question.type === "blank") {
      const input = document.createElement("input");
      input.className = "blank-answer";
      input.type = "text";
      input.name = "q" + index;
      input.maxLength = 80;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.lang = "en";
      input.setAttribute("aria-label", "第 " + (index + 1) + " 题答案");
      input.placeholder = "输入答案";
      group.append(input);
    } else {
      const options = document.createElement("div");
      options.className = "exam-options";
      for (const [optionIndex, option] of question.options.entries()) {
        const label = document.createElement("label");
        label.className = "exam-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "q" + index;
        input.value = option;
        const text = document.createElement("span");
        text.lang = "en";
        text.textContent = optionLetters[optionIndex] + ". " + option;
        label.append(input, text);
        options.append(label);
      }
      group.append(options);
    }

    questionList.append(group);
  });
  updateAnswerCount();
}

function readAnswers() {
  return exercise.questions.map((_, index) => {
    const control = examForm.elements.namedItem("q" + index);
    return (control?.value || "").trim();
  });
}

function updateAnswerCount() {
  if (!exercise) return;
  const answered = readAnswers().filter(Boolean).length;
  byId("answer-count").textContent = "已答 " + answered + " / " + exercise.questions.length;
}

async function post(url, body, signal = roundController.signal) {
  return library.request(url, body, signal);
}

async function synthesize() {
  const version = roundVersion;
  const signal = roundController.signal;
  const voice = voicePicker.value;
  const pace = Number(pacePicker.value);
  const reviewing = phase === "review";
  setError();
  clearAudio();
  if (reviewing) setReviewControls(true);
  byId("exercise-voice").textContent = "录音准备中";
  setPhase(reviewing ? "review-voice" : "voice", reviewing
    ? "正在更新录音，成绩和原文已保留。" : "正在准备这组模拟题的录音。");
  try {
    const response = await post("/api/voice", { attemptId: exercise.attemptId, voice, pace }, signal);
    const recording = await response.json();
    if (version !== roundVersion) return;
    if (!recording.url) throw new Error("这段录音暂不可用，请重试或选择其他音色。");
    const requestedRate = Number(recording.rate);
    examRate = Number.isFinite(requestedRate) && requestedRate > 0
      ? Math.max(.55, Math.min(1.25, requestedRate)) : 1;
    nativePace = recording.native;
    examPace = pace;
    if (!reviewing) speed.value = "1";
    audioUrl = recording.url;
    audioVoice = voice;
    audio.src = audioUrl;
    applyExamPace(reviewing ? Number(speed.value) : 1);
  } catch (error) {
    if (version !== roundVersion || error.name === "AbortError") return;
    byId("exercise-voice").textContent = "录音未就绪";
    setPhase(reviewing ? "review" : "error", reviewing
      ? "录音更新未完成，可重新加载或调整选择。" : "试题已准备好，录音加载未完成。");
    if (reviewing) setReviewControls(true);
    setError(error instanceof TypeError ? "录音暂时无法加载，请检查网络连接。" : error.message, true);
  } finally {
    if (version === roundVersion) checkStatus();
  }
}

function resetExercise() {
  roundController.abort();
  roundController = new AbortController();
  roundVersion += 1;
  stopTimer();
  if (exercise) library.abandon(exercise.attemptId);
  exercise = undefined;
  submittedAnswers = undefined;
  clearAudio();
  setError();
  setReviewControls(false);
  setTranscript(false);
  transcriptCopy.textContent = "";
  examForm.hidden = true;
  examResults.hidden = true;
  byId("listening-tip").hidden = false;
  byId("result-list").replaceChildren();
  byId("result-score").textContent = "";
  byId("answer-count").textContent = "";
  questionList.replaceChildren();
  trackSource.hidden = true;
  trackSource.textContent = "";
  byId("exercise-voice").textContent = "英语朗读";
  examRate = 1;
  examPace = Number(pacePicker.value);
  speed.value = "1";
}

function returnToSelection() {
  resetExercise();
  trackTitle.textContent = "等待准备听力试题";
  trackTitle.lang = "zh-CN";
  setPhase("idle", "选择考试、篇幅和朗读音色，再开始一组练习。");
  byId("selection-panel").scrollIntoView({
    block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
  byId("difficulty-title").focus({ preventScroll: true });
}

async function generate(source, id) {
  if (generateButton.disabled) return;
  const level = document.querySelector('input[name="level"]:checked').value;
  resetExercise();
  const version = roundVersion;
  const signal = roundController.signal;
  trackTitle.textContent = source === "sample" ? "正在加载模拟示例" : id ? "正在加载所选材料" : "正在抽取听力试题";
  trackTitle.lang = "zh-CN";
  setPhase("loading", "正在准备 " + levelNames[level] + " 听力模拟。");
  if (id || matchMedia("(max-width: 630px)").matches) {
    byId("exercise-title").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  try {
    const request = { level, length: lengthPicker.value };
    if (id) request.id = id;
    if (source === "sample") request.sample = true;
    if (source === "bank") {
      request.bank = true;
      request.length = lengthPicker.value;
    }
    const response = await post("/api/exercise", request, signal);
    const nextExercise = await response.json();
    if (version !== roundVersion) return;
    if (typeof nextExercise.attemptId !== "string" || !Array.isArray(nextExercise.questions) || !nextExercise.questions.length) {
      throw new Error("这篇听力试题不完整，请重新选择。");
    }

    exercise = { ...nextExercise, level };
    trackTitle.textContent = exercise.title || "听力模拟";
    trackSource.textContent = [levelNames[level], exercise.section, sourceNames[exercise.source]].filter(Boolean).join(" · ");
    trackSource.hidden = false;
    renderQuestions();
    await synthesize();
  } catch (error) {
    if (version !== roundVersion || error.name === "AbortError") return;
    trackTitle.textContent = "暂时无法准备听力试题";
    setPhase("error", "可以重新抽题、从目录选题，或试做示例。");
    setError(error instanceof TypeError ? "材料暂时无法加载，请检查网络后重试。" : error.message);
  }
}

async function playExam() {
  if (!audioUrl) return;
  const version = roundVersion;
  setError();
  applyExamPace();
  setPhase("playing", "录音正在播放，请听音作答。");
  try {
    await audio.play();
  } catch {
    if (version !== roundVersion) return;
    setPhase("continue", "读题时间结束。点击开始播放，继续本次模拟。");
    startButton.focus({ preventScroll: true });
  }
}

function beginExam() {
  if (phase === "continue") {
    playExam();
    return;
  }
  if (phase !== "ready") return;

  const ielts = exercise.level === "ielts";
  examForm.hidden = false;
  setPhase("preview", ielts ? "先浏览题目和选项，倒计时结束后播放录音。" : "先浏览选项，倒计时结束后播放录音和问题。");
  startTimer(ielts ? 10 : 5, "读题剩余", playExam);
}

function beginAnswering() {
  setPhase("answering", "录音已播放完毕，请在倒计时结束前交卷。");
  startTimer(30, "作答剩余", submitExam);
}

function renderResults(payload) {
  const resultList = byId("result-list");
  resultList.replaceChildren();
  byId("result-score").textContent = "答对 " + payload.score + " / " + payload.total + " 题";
  if (payload.title) {
    trackTitle.textContent = payload.title;
    trackTitle.lang = "en";
  }

  for (const [index, result] of payload.results.entries()) {
    const item = document.createElement("li");
    item.className = "result-item";
    item.dataset.correct = String(result.correct);
    const question = exercise.questions[index];
    const title = document.createElement("strong");
    title.textContent = "第 " + (index + 1) + " 题 · " + (result.correct ? "正确" : submittedAnswers[index] ? "错误" : "未作答");
    const prompt = document.createElement("p");
    prompt.lang = "en";
    prompt.textContent = result.prompt || question.prompt;
    const answers = document.createElement("p");
    const answerText = (value) => {
      if (!value) return "未作答";
      const optionIndex = question.type === "choice" ? question.options.indexOf(value) : -1;
      return optionIndex >= 0 ? optionLetters[optionIndex] + ". " + value : value;
    };
    answers.textContent = "你的答案：" + answerText(submittedAnswers[index]) + "　正确答案：" + answerText(result.answer);
    const explanation = document.createElement("p");
    explanation.textContent = result.explanation;
    item.append(title);
    if (prompt.textContent) item.append(prompt);
    item.append(answers, explanation);
    resultList.append(item);
  }

  transcriptCopy.textContent = payload.transcript;
  examForm.hidden = true;
  byId("listening-tip").hidden = true;
  examResults.hidden = false;
  setReviewControls(true);
  setTranscript(true);
  setPhase("review", "已交卷，可重听录音并对照原文。");
  byId("results-title").focus();
}

async function submitExam() {
  if (!["answering", "submit-error"].includes(phase)) return;
  const version = roundVersion;
  const signal = roundController.signal;
  submittedAnswers ??= readAnswers();
  stopTimer();
  setError();
  setPhase("submitting", "正在批改听力试题。");

  try {
    const response = await post("/api/submit", { attemptId: exercise.attemptId, answers: submittedAnswers }, signal);
    const payload = await response.json();
    if (version !== roundVersion) return;
    if (!Array.isArray(payload.results) || payload.results.length !== exercise.questions.length || typeof payload.transcript !== "string") {
      throw new Error("未收到完整的批改结果，请重试交卷。");
    }
    renderResults(payload);
  } catch (error) {
    if (version !== roundVersion || error.name === "AbortError") return;
    setPhase("submit-error", "答案已保留，可以重试交卷。");
    setError(error instanceof TypeError ? "暂时无法完成批改，请重试交卷。" : error.message);
  }
}

async function playReview(fromBeginning = false) {
  if (!audioUrl || phase !== "review") return;
  const version = roundVersion;
  try {
    if (fromBeginning || audio.ended) audio.currentTime = 0;
    await audio.play();
    if (version !== roundVersion) return;
    player.dataset.state = "playing";
    trackCaption.textContent = "正在重听录音。";
  } catch (error) {
    if (version !== roundVersion) return;
    if (error.name !== "AbortError") setError("暂时无法播放语音，请再次点击播放。");
  }
}

generateButton.addEventListener("click", () => generate("bank"));
sampleButton.addEventListener("click", () => generate("sample"));
returnButton.addEventListener("click", returnToSelection);
voicePicker.addEventListener("change", () => {
  if (["ready", "review"].includes(phase)) synthesize();
});
pacePicker.addEventListener("change", () => {
  if (!["ready", "review"].includes(phase)) return;
  if (nativePace || !audioUrl) {
    synthesize();
    return;
  }
  examPace = Number(pacePicker.value);
  applyExamPace(phase === "review" ? Number(speed.value) : 1);
});
transcriptToggle.addEventListener("click", () => setTranscript(transcript.hidden));
byId("check-status").addEventListener("click", checkStatus);
retryButton.addEventListener("click", () => {
  if (exercise && (phase === "error" || (phase === "review" && !audioUrl))) synthesize();
});
startButton.addEventListener("click", beginExam);
examForm.addEventListener("input", updateAnswerCount);
examForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitExam();
});

playButton.addEventListener("click", () => {
  if (audio.paused) playReview();
  else audio.pause();
});
replayButton.addEventListener("click", () => playReview(true));
seek.addEventListener("input", () => {
  if (phase === "review" && Number.isFinite(audio.duration)) {
    audio.currentTime = (Number(seek.value) / Number(seek.max)) * audio.duration;
    updateProgress();
  }
});
seek.addEventListener("keydown", (event) => {
  const change = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[event.key];
  if (!change || phase !== "review" || !Number.isFinite(audio.duration)) return;
  event.preventDefault();
  audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + change));
  updateProgress();
});
speed.addEventListener("change", () => {
  if (phase === "review") applyExamPace(Number(speed.value));
});

audio.addEventListener("loadedmetadata", () => {
  if (!audioUrl || !["voice", "review-voice"].includes(phase)) return;
  const reviewing = phase === "review-voice";
  applyExamPace(reviewing ? Number(speed.value) : 1);
  updateProgress();
  byId("exercise-voice").textContent = voiceNames[audioVoice] || "英语朗读";
  setPhase(reviewing ? "review" : "ready", reviewing
    ? "录音已更新，可重听录音并对照原文。" : "语音已就绪，点击开始模拟。");
  if (reviewing) setReviewControls(true);
});
audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("play", () => {
  if (phase === "review") updatePlayIcon(true);
});
audio.addEventListener("pause", () => {
  if (phase === "review") {
    updatePlayIcon(false);
    player.dataset.state = "review";
    if (!audio.ended && audioUrl) trackCaption.textContent = "已暂停。";
  }
});
audio.addEventListener("ended", () => {
  if (!audioUrl || !exercise) return;
  if (phase === "playing") beginAnswering();
  if (phase === "review") {
    updatePlayIcon(false);
    player.dataset.state = "review";
    trackCaption.textContent = "重听结束，可继续查看原文和解析。";
  }
});
audio.addEventListener("error", () => {
  if (!audioUrl) return;
  const reviewing = ["review", "review-voice"].includes(phase);
  clearAudio();
  byId("exercise-voice").textContent = "录音未就绪";
  if (reviewing) {
    setPhase("review", "录音加载失败，可重试语音或选择其他音色。");
    setReviewControls(true);
    setError("浏览器无法播放本次录音，请重试语音。", true);
  } else {
    examForm.hidden = true;
    stopTimer();
    setPhase("error", "浏览器无法加载这段语音。");
    setError("录音加载失败，请重新加载。", true);
  }
});

library.init(id => generate("bank", id));
checkStatus();
