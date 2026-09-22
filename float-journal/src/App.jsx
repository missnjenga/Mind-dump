import React, { useEffect, useRef, useState, useCallback } from "react";


const STORAGE_KEY = "float-journal-entry";

export default function FloatJournal() {
  const editorRef = useRef(null);
  const plainTextRef = useRef("");
  const isSettledRef = useRef(false);
  const saveTimerRef = useRef(null);
  const settleTimerRef = useRef(null);

  const recognitionRef = useRef(null);
  const isDictatingRef = useRef(false);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const rafIdRef = useRef(null);
  const blowFramesRef = useRef(0);

  const [sensitivity, setSensitivity] = useState(8); // 1..10, higher = more sensitive
  const sensitivityRef = useRef(sensitivity);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);

  const [breathOn, setBreathOn] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [status, setStatus] = useState("tap to speak");
  const [meterPct, setMeterPct] = useState(0);
  const [speechSupported, setSpeechSupported] = useState(true);

  // ---------- load saved entry ----------
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && editorRef.current) {
        plainTextRef.current = saved;
        editorRef.current.innerText = saved;
      }
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDebounced = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, plainTextRef.current);
      } catch (e) {}
    }, 400);
  }, []);

  // ---------- caret helper ----------
  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- floating word settle / unsettle ----------
  const settle = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const text = plainTextRef.current.trim();
    if (!text) return;
    const frag = document.createDocumentFragment();
    text.split(/(\s+)/).forEach((chunk) => {
      if (/^\s+$/.test(chunk)) {
        frag.appendChild(document.createTextNode(chunk));
      } else if (chunk.length) {
        const span = document.createElement("span");
        span.className = "fj-word fj-float";
        span.textContent = chunk;
        span.style.setProperty("--dur", (3 + Math.random() * 3).toFixed(2) + "s");
        span.style.setProperty("--delay", (Math.random() * 3).toFixed(2) + "s");
        span.style.setProperty("--amp", (-3 - Math.random() * 5).toFixed(1) + "px");
        span.style.setProperty("--rot", ((Math.random() * 1.4) - 0.7).toFixed(2) + "deg");
        frag.appendChild(span);
      }
    });
    editor.innerHTML = "";
    editor.appendChild(frag);
    editor.classList.add("settled");
    isSettledRef.current = true;
  }, []);

  const unsettle = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !isSettledRef.current) return;
    editor.innerHTML = "";
    editor.textContent = plainTextRef.current;
    editor.classList.remove("settled");
    isSettledRef.current = false;
  }, []);

  const scheduleSettle = useCallback((delay) => {
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(settle, delay);
  }, [settle]);

  function handleFocus() {
    unsettle();
  }

  function handleInput() {
    if (isSettledRef.current) return;
    plainTextRef.current = editorRef.current.innerText;
    saveDebounced();
    scheduleSettle(2600);
  }

  function handleBlur() {
    plainTextRef.current = editorRef.current.innerText;
    saveDebounced();
    scheduleSettle(300);
  }

  // renders committed text plus a live, dimmed "still speaking" tail so
  // typing appears continuously while you keep talking, not just in chunks
  const renderDictation = useCallback((interim) => {
    unsettle();
    const editor = editorRef.current;
    editor.innerHTML = "";
    editor.appendChild(document.createTextNode(plainTextRef.current));
    if (interim) {
      const span = document.createElement("span");
      span.className = "fj-interim";
      const sep = plainTextRef.current && !/\s$/.test(plainTextRef.current) ? " " : "";
      span.textContent = sep + interim;
      editor.appendChild(span);
    }
    placeCaretAtEnd(editor);
    scheduleSettle(2600);
  }, [unsettle, scheduleSettle]);

  // ---------- speech-to-text ----------
  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechSupported(false);
      setStatus("speech input not supported here");
      return;
    }
    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) {
        const sep = plainTextRef.current && !/\s$/.test(plainTextRef.current) ? " " : "";
        plainTextRef.current = plainTextRef.current + sep + finalChunk.trim();
        saveDebounced();
      }
      renderDictation(interim);
    };
    recognition.onstart = () => setStatus("listening — ranting freely, typing as you go");
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "permission-denied") {
        setStatus("mic permission needed to rant out loud");
      } else {
        setStatus("mic error — check permissions");
      }
    };
    recognition.onend = () => {
      if (isDictatingRef.current) {
        try { recognition.start(); } catch (e) {}
      } else {
        renderDictation("");
        setStatus("tap to speak");
      }
    };
    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch (e) {}
    };
  }, [renderDictation, saveDebounced]);

  function toggleDictation() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setStatus("speech input not supported here");
      return;
    }
    const next = !isDictating;
    isDictatingRef.current = next;
    setIsDictating(next);
    if (next) {
      unsettle();
      editorRef.current.focus();
      setStatus("requesting mic permission…");
      try { recognition.start(); } catch (e) {}
    } else {
      recognition.stop();
      setStatus("tap to speak");
    }
  }

  // ---------- blow-to-clear ----------
  function sensitivityThreshold() {
    const s = sensitivityRef.current; // 1..10
    return {
      vol: 62 - s * 4.2,
      ratio: 0.62 - s * 0.02,
    };
  }

  const dissolve = useCallback(() => {
    const editor = editorRef.current;
    const text = (editor.innerText || "").trim();
    if (!text) return;
    clearTimeout(settleTimerRef.current);
    editor.contentEditable = "false";
    editor.classList.remove("settled");
    const frag = document.createDocumentFragment();
    [...text].forEach((ch) => {
      const span = document.createElement("span");
      span.className = "fj-letter";
      span.textContent = ch === " " ? "\u00A0" : ch;
      const dx = (Math.random() * 2 - 1) * 260;
      const dy = -(90 + Math.random() * 260);
      const rot = (Math.random() * 2 - 1) * 100;
      span.style.setProperty("--dx", dx + "px");
      span.style.setProperty("--dy", dy + "px");
      span.style.setProperty("--rot", rot + "deg");
      span.style.transitionDelay = Math.random() * 0.35 + "s";
      frag.appendChild(span);
    });
    editor.innerHTML = "";
    editor.appendChild(frag);
    setStatus("letting it go…");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editor.querySelectorAll(".fj-letter").forEach((s) => s.classList.add("go"));
      });
    });
    setTimeout(() => {
      editor.innerHTML = "";
      editor.contentEditable = "true";
      plainTextRef.current = "";
      isSettledRef.current = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      setStatus(breathOn ? "gone. start again whenever" : "tap to speak");
    }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breathOn]);

  function monitor() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / timeData.length) * 255;

      const lowBand = Math.floor(freqData.length * 0.08); // ~under 700Hz
      let lowSum = 0, totalSum = 0;
      for (let i = 0; i < freqData.length; i++) {
        totalSum += freqData[i];
        if (i < lowBand) lowSum += freqData[i];
      }
      const ratio = totalSum > 0 ? lowSum / totalSum : 0;

      setMeterPct(Math.min(100, rms * 1.6));

      const th = sensitivityThreshold();
      if (rms > th.vol && ratio > th.ratio) {
        blowFramesRef.current++;
      } else {
        blowFramesRef.current = Math.max(0, blowFramesRef.current - 1);
      }

      if (blowFramesRef.current > 5) {
        blowFramesRef.current = 0;
        dissolve();
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function startBreathListening() {
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setStatus("mic permission denied");
      setBreathOn(false);
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();
    const source = audioCtxRef.current.createMediaStreamSource(micStreamRef.current);
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 1024;
    analyserRef.current.smoothingTimeConstant = 0.6;
    source.connect(analyserRef.current);
    monitor();
  }

  function stopBreathListening() {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    micStreamRef.current = null;
    setMeterPct(0);
  }

  function toggleBreath() {
    const next = !breathOn;
    setBreathOn(next);
    if (next) startBreathListening();
    else stopBreathListening();
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(settleTimerRef.current);
      stopBreathListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fj-root">
      <style>{CSS}</style>
      <header className="fj-header">
        <div className="fj-brand">float</div>
        <div className="fj-controls">
          <label className="fj-sens">
            <span>sensitivity</span>
            <input
              type="range"
              min="1"
              max="10"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseInt(e.target.value, 10))}
            />
          </label>
          <button className={`fj-chip${breathOn ? " on" : ""}`} onClick={toggleBreath}>
            breath: {breathOn ? "on" : "off"}
          </button>
        </div>
      </header>

      <main className="fj-main">
        <div
          ref={editorRef}
          id="fj-editor"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="start writing, or press the mic and just talk…"
          onFocus={handleFocus}
          onInput={handleInput}
          onBlur={handleBlur}
        />
      </main>

      <footer className="fj-footer">
        <button
          className={`fj-orb${isDictating ? " active" : ""}`}
          aria-label="dictate"
          onClick={toggleDictation}
          disabled={!speechSupported}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="22" />
          </svg>
        </button>
        <div className="fj-status">{status}</div>
        <div className="fj-meter"><div className="fj-meter-fill" style={{ width: meterPct + "%" }} /></div>
      </footer>
    </div>
  );
}

const CSS = `
.fj-root{
  --bg:#0d1117; --bg-2:#12161f; --ink:#eae6db; --ink-dim:#9aa0ab;
  --accent:#7d9bb5; --breath:#c98a6f; --line:rgba(234,230,219,0.12);
  --serif:'Source Serif 4', Georgia, 'Times New Roman', serif;
  --sans:'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  height:100%; min-height:100vh; width:100%;
  background:radial-gradient(120% 120% at 50% 0%, var(--bg-2), var(--bg));
  color:var(--ink); font-family:var(--sans);
  display:flex; flex-direction:column; overflow:hidden;
  -webkit-font-smoothing:antialiased;
}
.fj-header{ display:flex; justify-content:space-between; align-items:center; padding:18px 20px 10px; flex-shrink:0; }
.fj-brand{ font-family:var(--serif); font-style:italic; font-size:1.05rem; color:var(--ink-dim); letter-spacing:0.02em; }
.fj-controls{ display:flex; align-items:center; gap:10px; }
.fj-sens{ display:flex; align-items:center; gap:8px; font-size:0.72rem; color:var(--ink-dim); }
.fj-sens input[type="range"]{ -webkit-appearance:none; appearance:none; width:70px; height:2px; background:var(--line); border-radius:2px; outline:none; }
.fj-sens input[type="range"]::-webkit-slider-thumb{ -webkit-appearance:none; width:11px; height:11px; border-radius:50%; background:var(--accent); cursor:pointer; }
.fj-chip{ border:1px solid var(--line); background:transparent; color:var(--ink-dim); font-family:var(--sans); font-size:0.72rem; padding:6px 12px; border-radius:100px; cursor:pointer; transition:border-color .25s, color .25s; }
.fj-chip.on{ border-color:var(--breath); color:var(--breath); }
.fj-main{ flex:1; display:flex; justify-content:center; align-items:center; padding:0 24px; overflow:hidden; position:relative; }
#fj-editor{
  max-width:640px; width:100%; max-height:70vh; overflow-y:auto;
  font-family:var(--serif); font-size:clamp(1.15rem,2.4vw,1.55rem); line-height:1.75;
  outline:none; text-align:left; animation:fj-breathe 6s ease-in-out infinite;
}
#fj-editor.settled{ animation:none; }
#fj-editor:empty:before{ content:attr(data-placeholder); color:var(--ink-dim); font-style:italic; opacity:0.7; }
@keyframes fj-breathe{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-2px); } }
.fj-word{ display:inline-block; will-change:transform; }
.fj-word.fj-float{ animation:fj-bob var(--dur,4s) ease-in-out var(--delay,0s) infinite; }
@keyframes fj-bob{ 0%,100%{ transform:translateY(0) rotate(0deg); } 50%{ transform:translateY(var(--amp,-4px)) rotate(var(--rot,0.4deg)); } }
.fj-interim{ opacity:0.5; font-style:italic; }
.fj-letter{ display:inline-block; white-space:pre; transition:transform 1.1s cubic-bezier(.2,.6,.3,1), opacity 1.1s ease-out; }
.fj-letter.go{ transform:translate(var(--dx),var(--dy)) rotate(var(--rot)); opacity:0; }
.fj-footer{ display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 0 22px; flex-shrink:0; }
.fj-orb{ width:56px; height:56px; border-radius:50%; border:1px solid var(--line); background:var(--bg-2); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:border-color .25s, box-shadow .25s, transform .15s; color:var(--ink); }
.fj-orb:active{ transform:scale(0.94); }
.fj-orb.active{ border-color:var(--accent); box-shadow:0 0 0 6px rgba(125,155,181,0.12); animation:fj-pulse 1.4s ease-in-out infinite; }
.fj-orb:disabled{ opacity:0.4; cursor:not-allowed; }
@keyframes fj-pulse{ 0%,100%{ box-shadow:0 0 0 6px rgba(125,155,181,0.12); } 50%{ box-shadow:0 0 0 10px rgba(125,155,181,0.05); } }
.fj-status{ font-size:0.7rem; color:var(--ink-dim); min-height:14px; letter-spacing:0.01em; }
.fj-meter{ width:120px; height:3px; border-radius:3px; background:var(--line); overflow:hidden; margin-top:2px; }
.fj-meter-fill{ height:100%; background:var(--breath); transition:width .08s linear; }
`;