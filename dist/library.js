"use strict";

window.ListeningLibrary = (() => {
  const PAGE_SIZE = 12;
  const HISTORY_KEY = "shuyun-listening-practiced-v1";
  const levelNames = { cet4: "CET-4", cet6: "CET-6", ielts: "IELTS" };
  let catalog;
  let loading;
  let page = 1;
  let busy = false;
  let selectMaterial;
  const attempts = new Map();
  let completed = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(saved)) completed = new Set(saved.filter(id => typeof id === "string"));
  } catch { /* Practice remains available when browser storage is unavailable. */ }

  function abortIfNeeded(signal) {
    if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    if (!loading) {
      loading = fetch("./catalog.json", { cache: "no-cache" }).then(async response => {
        if (!response.ok) throw new Error("题库目录暂时无法加载，请稍后重试。");
        const data = await response.json();
        if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.voices)) {
          throw new Error("题库目录格式有误，请刷新页面。");
        }
        catalog = data;
        render();
        return catalog;
      }).finally(() => { loading = undefined; });
    }
    return loading;
  }

  function shuffle(options) {
    const result = [...options];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  async function prepare(body, signal) {
    const index = await loadCatalog();
    abortIfNeeded(signal);
    const matching = index.items.filter(item => body.id ? item.id === body.id
      : item.level === body.level && item.length === body.length);
    const samples = matching.filter(item => item.sample);
    const candidates = body.sample ? (samples.length ? samples : matching.slice(0, 1)) : matching;
    if (!candidates.length) throw new Error("没有找到这组练习，请调整篇幅或重新选择。");
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    if (!/^\.\/materials\/[a-z0-9-]+\.json$/.test(selected.detail)) throw new Error("材料地址无效。");
    const response = await fetch(selected.detail, { signal });
    if (!response.ok) throw new Error("这篇材料暂时无法加载，请重新选择或稍后重试。");
    const material = await response.json();
    abortIfNeeded(signal);
    if (material.id !== selected.id || !Array.isArray(material.questions) || !material.questions.length
      || typeof material.transcript !== "string" || !material.audio) {
      throw new Error("材料内容不完整，请选择另一篇练习。");
    }
    const questions = material.questions.map(question => ({ ...question, options: shuffle(question.options || []) }));
    const attemptId = crypto.randomUUID();
    if (attempts.size >= 100) attempts.delete(attempts.keys().next().value);
    attempts.set(attemptId, { ...material, questions, audioReady: false });
    return { attemptId, id: material.id, level: material.level, length: material.length,
      title: "听力模拟", section: material.section, source: body.sample ? "sample" : body.id ? "selected" : "bank",
      questions: questions.map(({ type, prompt, options }) => ({ type,
        prompt: material.level === "ielts" ? prompt : "", options })) };
  }

  function getAttempt(id) {
    const attempt = attempts.get(id);
    if (!attempt) throw new Error("本轮练习已结束，请重新选择材料。");
    return attempt;
  }

  function voice(body) {
    const attempt = getAttempt(body.attemptId);
    const options = attempt.audio[body.voice];
    const pace = String(body.pace === 1.1 ? 1.1 : 1);
    const track = options?.[pace];
    if (!track || typeof track.url !== "string" || !/^\.\/audio\/[a-z0-9-]+\.(opus|mp3)$/.test(track.url)) {
      throw new Error("这个音色的录音暂不可用，请换一个音色。");
    }
    attempt.audioReady = true;
    return { url: track.url, rate: track.rate, native: Boolean(track.native), seconds: track.seconds };
  }

  function grade(body) {
    const attempt = getAttempt(body.attemptId);
    if (!attempt.audioReady) throw new Error("请先准备本轮录音。");
    if (attempt.result) return attempt.result;
    if (!Array.isArray(body.answers) || body.answers.length !== attempt.questions.length
      || body.answers.some(answer => typeof answer !== "string")) throw new Error("答卷格式有误，请重新交卷。");
    const normalize = value => value.normalize("NFKC").trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
    const results = attempt.questions.map((question, i) => ({
      prompt: question.prompt, answer: question.answer, explanation: question.explanation,
      correct: question.type === "blank" ? [question.answer, ...(Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [])]
        .some(answer => typeof answer === "string" && answer.trim() && normalize(body.answers[i]) === normalize(answer))
        : body.answers[i] === question.answer,
    }));
    attempt.result = { title: attempt.title, transcript: attempt.transcript, results,
      score: results.filter(result => result.correct).length, total: results.length };
    completed.add(attempt.id);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...completed].slice(-500))); } catch { /* Optional. */ }
    render();
    return attempt.result;
  }

  async function request(path, body, signal) {
    abortIfNeeded(signal);
    let result;
    if (path === "/api/exercise") result = await prepare(body, signal);
    else if (path === "/api/voice") result = voice(body);
    else if (path === "/api/submit") result = grade(body);
    else throw new Error("未知的练习操作。");
    abortIfNeeded(signal);
    return { json: async () => { abortIfNeeded(signal); return result; } };
  }

  function render() {
    if (!selectMaterial || !catalog) return;
    const byId = id => document.getElementById(id);
    const level = document.querySelector('input[name="level"]:checked').value;
    const length = byId("exam-length").value;
    const term = byId("library-search").value.trim().toLocaleLowerCase();
    const levelItems = catalog.items.filter(item => item.level === level);
    const choices = levelItems.filter(item => item.length === length);
    const items = choices.filter(item => [item.title, item.section, item.topic].filter(Boolean)
      .join(" ").toLocaleLowerCase().includes(term));
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    page = Math.max(1, Math.min(page, pages));
    byId("library-summary").textContent = `${levelNames[level]} 共 ${levelItems.length} 篇 · ${length === "short" ? "短篇" : "长篇"} ${choices.length} 篇`;
    byId("selection-summary").textContent = `${levelNames[level]} · ${length === "short" ? "短篇" : "长篇"} · 每篇 ${choices[0]?.questionCount || (level === "ielts" ? 5 : length === "short" ? 2 : 4)} 题`;
    byId("library-results").textContent = `找到 ${items.length} 篇 · 已练习 ${choices.filter(item => completed.has(item.id)).length} 篇`;
    byId("library-page").textContent = `第 ${page} / ${pages} 页`;
    byId("library-prev").disabled = page <= 1;
    byId("library-next").disabled = page >= pages;
    byId("library-empty").hidden = items.length > 0;
    byId("library-error").hidden = true;
    byId("library-retry").hidden = true;
    byId("library-loading").hidden = true;
    const grid = byId("library-grid");
    grid.replaceChildren();
    for (const item of items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const card = document.createElement("article");
      card.className = "material-card";
      const tag = document.createElement("p");
      tag.className = "material-tag";
      tag.textContent = [item.section, item.topic].filter(Boolean).filter((value, i, array) => array.indexOf(value) === i).join(" · ");
      const title = document.createElement("h3");
      title.lang = "en";
      title.textContent = item.title;
      const detail = document.createElement("p");
      detail.className = "material-detail";
      detail.textContent = `${item.words} 词 · ${item.questionCount} 题${completed.has(item.id) ? " · 已练习" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button material-start";
      button.textContent = completed.has(item.id) ? "再次练习" : "开始练习";
      button.setAttribute("aria-label", `${button.textContent}：${item.title}`);
      button.disabled = busy;
      button.addEventListener("click", () => { if (!busy) selectMaterial(item.id); });
      card.append(tag, title, detail, button);
      grid.append(card);
    }
  }

  function showCatalogError(error) {
    document.getElementById("library-loading").hidden = true;
    const message = document.getElementById("library-error");
    message.hidden = false;
    message.textContent = error.message;
    document.getElementById("library-retry").hidden = false;
  }

  function init(onSelect) {
    selectMaterial = onSelect;
    const reset = () => { page = 1; render(); };
    document.querySelectorAll('input[name="level"]').forEach(input => input.addEventListener("change", reset));
    document.getElementById("exam-length").addEventListener("change", reset);
    document.getElementById("library-search").addEventListener("input", reset);
    for (const [id, offset] of [["library-prev", -1], ["library-next", 1]]) {
      document.getElementById(id).addEventListener("click", () => {
        page += offset;
        render();
        document.getElementById("library-title").focus({ preventScroll: true });
        document.getElementById("library-panel").scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
    document.getElementById("library-retry").addEventListener("click", async () => {
      document.getElementById("library-retry").hidden = true;
      document.getElementById("library-loading").hidden = false;
      try { await loadCatalog(); } catch (error) { showCatalogError(error); }
    });
    loadCatalog().catch(showCatalogError);
  }

  return { init, request, loadCatalog,
    abandon(id) { attempts.delete(id); },
    setBusy(value) {
      busy = value;
      if (selectMaterial) document.querySelectorAll(".material-start").forEach(button => { button.disabled = busy; });
    },
  };
})();
