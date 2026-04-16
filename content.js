// CF Submit — Content Script
// Injected on Codeforces problem pages

(function () {
  "use strict";

  // ========================================
  // 1. Parse problem metadata from URL
  // ========================================
  const url = window.location.pathname;
  let contestId, problemIndex;

  // /contest/1234/problem/A or /gym/1234/problem/A
  let m = url.match(/\/(contest|gym)\/(\d+)\/problem\/([A-Za-z]\d?)/);
  if (m) {
    contestId = m[2];
    problemIndex = m[3];
  }

  // /problemset/problem/1234/A
  if (!contestId) {
    m = url.match(/\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)/);
    if (m) {
      contestId = m[1];
      problemIndex = m[2];
    }
  }

  if (!contestId || !problemIndex) return; // not a valid problem page

  // ========================================
  // 2. Parse sample test cases from the page
  // ========================================
  function parseSamples() {
    const samples = [];
    const sampleTests = document.querySelectorAll(".sample-test");
    sampleTests.forEach((block) => {
      const inputs = block.querySelectorAll(".input pre");
      const outputs = block.querySelectorAll(".output pre");
      const count = Math.min(inputs.length, outputs.length);
      for (let i = 0; i < count; i++) {
        // Handle <br> tags in pre elements
        const inputText = getPreText(inputs[i]);
        const outputText = getPreText(outputs[i]);
        samples.push({ input: inputText, output: outputText });
      }
    });
    return samples;
  }

  function getPreText(preEl) {
    // Codeforces sometimes uses <br> or <div> inside <pre>
    // Clone and replace <br> with newlines
    const clone = preEl.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("div").forEach((div) => {
      div.insertAdjacentText("beforebegin", "\n");
    });
    return clone.textContent.trim();
  }

  const samples = parseSamples();

  // ========================================
  // 3. Get the logged-in user handle
  // ========================================
  let userHandle = null;

  // Try to extract from the page header
  const headerLinks = document.querySelectorAll('a[href^="/profile/"]');
  for (const link of headerLinks) {
    const href = link.getAttribute("href");
    const hm = href.match(/\/profile\/(.+)/);
    if (hm) {
      userHandle = hm[1];
      break;
    }
  }

  // Fallback: ask background script
  if (!userHandle) {
    browser.runtime.sendMessage({ type: "getHandle" }).then((resp) => {
      if (resp && resp.handle) userHandle = resp.handle;
    });
  }

  // ========================================
  // 4. Inject the UI panel
  // ========================================
  const problemStatement = document.querySelector(".problem-statement");
  if (!problemStatement) return;

  const panel = document.createElement("div");
  panel.id = "cf-submit-panel";

  panel.innerHTML = `
    <h3>CF Submit</h3>
    <textarea id="cf-submit-editor" placeholder="Paste your C++ code here..." spellcheck="false"></textarea>
    <div class="cf-controls">
      <select id="cf-lang-select">
        <option value="89">GNU G++20 13.2 (64-bit)</option>
        <option value="61" selected>GNU G++17 9.2.0 (64-bit)</option>
        <option value="54">GNU G++17 7.3.0</option>
        <option value="52">Clang++17 Diagnostics</option>
        <option value="73">GNU G++17 9.2.0 (32-bit)</option>
        <option value="50">GNU G++14 6.4.0</option>
        <option value="65">C# 8, .NET Core 3.1</option>
        <option value="28">D DMD32 v2.105.0</option>
        <option value="32">Go 1.19.5</option>
        <option value="60">Java 17 64-bit</option>
        <option value="87">Java 21 64-bit</option>
        <option value="83">Kotlin 1.7</option>
        <option value="36">Python 2.7.18</option>
        <option value="41">PyPy 2-64</option>
        <option value="31">Python 3.8.10</option>
        <option value="70">PyPy 3-64</option>
        <option value="40">PyPy 3 64 (PyPy 7.3.15, Python 3.10)</option>
        <option value="43">GNU C11 5.1.0</option>
        <option value="80">GNU C17 13.2 (64-bit)</option>
        <option value="67">Ruby 3.2.2</option>
        <option value="75">Rust 1.75.0 (2021)</option>
        <option value="20">Scala 2.12.8</option>
        <option value="34">JavaScript V8 4.8.0</option>
        <option value="55">Node.js 15.8.0 (64-bit)</option>
      </select>
      <button id="cf-btn-run" title="Show sample test cases">Run</button>
      <button id="cf-btn-submit" title="Submit solution to Codeforces">Submit</button>
      <span id="cf-status"></span>
    </div>
    <div id="cf-verdict-panel"></div>
    <div id="cf-samples-panel"></div>
  `;

  // Insert after the problem statement
  problemStatement.parentNode.insertBefore(
    panel,
    problemStatement.nextSibling
  );

  // ========================================
  // 5. Tab key support in the editor
  // ========================================
  const editor = document.getElementById("cf-submit-editor");
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value =
        editor.value.substring(0, start) +
        "    " +
        editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
    }
  });

  // ========================================
  // 6. Run button — show sample I/O
  // ========================================
  const btnRun = document.getElementById("cf-btn-run");
  const samplesPanel = document.getElementById("cf-samples-panel");

  btnRun.addEventListener("click", () => {
    if (samples.length === 0) {
      showVerdict("No sample test cases found on this page.", "info");
      return;
    }

    // Toggle: if already showing, hide
    if (samplesPanel.classList.contains("show")) {
      samplesPanel.classList.remove("show");
      return;
    }

    let html = "";
    samples.forEach((s, i) => {
      html += `
        <div class="cf-sample-case">
          <div class="cf-sample-header">
            <span>Sample ${i + 1}</span>
            <button class="cf-copy-input" data-idx="${i}">Copy Input</button>
          </div>
          <div class="cf-sample-body">
            <div class="cf-sample-col">
              <div class="cf-sample-label">Input</div>
              <pre>${escapeHtml(s.input)}</pre>
            </div>
            <div class="cf-sample-col">
              <div class="cf-sample-label">Expected Output</div>
              <pre>${escapeHtml(s.output)}</pre>
            </div>
          </div>
        </div>
      `;
    });

    samplesPanel.innerHTML = html;
    samplesPanel.classList.add("show");

    // Attach copy handlers
    samplesPanel.querySelectorAll(".cf-copy-input").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx);
        navigator.clipboard.writeText(samples[idx].input).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy Input"), 1500);
        });
      });
    });
  });

  // ========================================
  // 7. Submit button
  // ========================================
  const btnSubmit = document.getElementById("cf-btn-submit");
  const statusEl = document.getElementById("cf-status");

  btnSubmit.addEventListener("click", async () => {
    const source = editor.value.trim();
    if (!source) {
      showVerdict("Please paste your code first.", "info");
      return;
    }

    if (!userHandle) {
      showVerdict(
        "Could not detect your Codeforces handle. Are you logged in?",
        "rejected"
      );
      return;
    }

    const langId = document.getElementById("cf-lang-select").value;

    btnSubmit.disabled = true;
    btnRun.disabled = true;
    statusEl.textContent = "Submitting...";
    hideVerdict();

    try {
      const resp = await browser.runtime.sendMessage({
        type: "submit",
        contestId,
        problemIndex,
        langId,
        source,
      });

      if (resp.success) {
        statusEl.textContent = "Submitted! Waiting for verdict...";
        showVerdict("Submission sent. Waiting for verdict...", "testing");
        pollVerdict();
      } else {
        statusEl.textContent = "Submission failed.";
        showVerdict("Error: " + (resp.error || "Unknown error"), "rejected");
        btnSubmit.disabled = false;
        btnRun.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = "Error.";
      showVerdict("Error: " + err.message, "rejected");
      btnSubmit.disabled = false;
      btnRun.disabled = false;
    }
  });

  // ========================================
  // 8. Verdict polling
  // ========================================
  async function pollVerdict() {
    const maxPolls = 60; // 2 minutes max
    let polls = 0;

    const interval = setInterval(async () => {
      polls++;
      if (polls > maxPolls) {
        clearInterval(interval);
        statusEl.textContent = "Timed out waiting for verdict.";
        showVerdict("Verdict polling timed out after 2 minutes.", "rejected");
        btnSubmit.disabled = false;
        btnRun.disabled = false;
        return;
      }

      try {
        const apiUrl = `https://codeforces.com/api/user.status?handle=${userHandle}&count=1`;
        const resp = await fetch(apiUrl);
        const data = await resp.json();

        if (data.status !== "OK" || !data.result || data.result.length === 0) {
          return; // keep polling
        }

        const sub = data.result[0];

        // Check if this is for our problem
        if (
          String(sub.problem.contestId) !== String(contestId) ||
          sub.problem.index !== problemIndex
        ) {
          return; // not our submission yet, keep polling
        }

        const verdict = sub.verdict;

        if (verdict === "TESTING" || !verdict) {
          // Still testing
          const testNum = sub.passedTestCount
            ? `on test ${sub.passedTestCount + 1}`
            : "";
          showVerdict(`Running tests... ${testNum}`, "testing");
          return;
        }

        // Final verdict
        clearInterval(interval);
        btnSubmit.disabled = false;
        btnRun.disabled = false;

        const time = sub.timeConsumedMillis;
        const memory = Math.round(sub.memoryConsumedBytes / 1024);
        const details = `Time: ${time} ms | Memory: ${memory} KB`;

        if (verdict === "OK") {
          statusEl.textContent = "Accepted!";
          showVerdict(
            "Accepted",
            "accepted",
            details
          );
        } else {
          let verdictText = formatVerdict(verdict);
          if (sub.passedTestCount !== undefined) {
            verdictText += ` on test ${sub.passedTestCount + 1}`;
          }
          statusEl.textContent = verdictText;
          showVerdict(verdictText, "rejected", details);
        }
      } catch (e) {
        // Network error, keep polling
      }
    }, 2000);
  }

  // ========================================
  // 9. Helper functions
  // ========================================
  function formatVerdict(v) {
    const map = {
      OK: "Accepted",
      WRONG_ANSWER: "Wrong Answer",
      TIME_LIMIT_EXCEEDED: "Time Limit Exceeded",
      MEMORY_LIMIT_EXCEEDED: "Memory Limit Exceeded",
      RUNTIME_ERROR: "Runtime Error",
      COMPILATION_ERROR: "Compilation Error",
      IDLENESS_LIMIT_EXCEEDED: "Idleness Limit Exceeded",
      CHALLENGED: "Hacked",
      SKIPPED: "Skipped",
    };
    return map[v] || v.replace(/_/g, " ");
  }

  const verdictPanel = document.getElementById("cf-verdict-panel");

  function showVerdict(text, type, details) {
    verdictPanel.className = "show " + type;
    verdictPanel.innerHTML = `
      <div class="cf-verdict-text">${escapeHtml(text)}</div>
      ${details ? `<div class="cf-verdict-details">${escapeHtml(details)}</div>` : ""}
    `;
  }

  function hideVerdict() {
    verdictPanel.className = "";
    verdictPanel.innerHTML = "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
