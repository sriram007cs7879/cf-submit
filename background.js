// CF Submit — Background Script
// Handles authenticated requests to Codeforces (has cookie access)

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "submit") {
    handleSubmit(msg).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  }

  if (msg.type === "getHandle") {
    getHandle().then(sendResponse).catch(err => {
      sendResponse({ handle: null });
    });
    return true;
  }

  if (msg.type === "runCode") {
    handleRunCode(msg).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function getHandle() {
  // Fetch the Codeforces main page and extract the logged-in handle
  const resp = await fetch("https://codeforces.com", { credentials: "include" });
  const html = await resp.text();

  // Look for the handle in the header link
  const match = html.match(/\/profile\/([^"]+)"/);
  if (match) {
    return { handle: match[1] };
  }
  return { handle: null };
}

async function handleRunCode({ languageId, source, stdin }) {
  const resp = await fetch("https://ce.judge0.com/submissions?base64_encoded=false&wait=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language_id: languageId,
      source_code: source,
      stdin: stdin,
      cpu_time_limit: 5,
      memory_limit: 256000,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Judge0 API error (HTTP ${resp.status})`);
  }
  const result = await resp.json();
  return { result };
}

async function handleSubmit({ contestId, problemIndex, langId, source }) {
  // Step 1: Fetch submit page to get CSRF token and other hidden fields
  const submitUrl = `https://codeforces.com/contest/${contestId}/submit`;
  const resp = await fetch(submitUrl, { credentials: "include" });

  if (!resp.ok) {
    throw new Error(`Failed to load submit page (HTTP ${resp.status})`);
  }

  const html = await resp.text();

  // Extract csrf_token
  const csrfMatch = html.match(/name=['"]csrf_token['"][^>]*value=['"]([^'"]+)['"]/);
  if (!csrfMatch) {
    throw new Error("Could not find csrf_token. Are you logged in to Codeforces?");
  }
  const csrfToken = csrfMatch[1];

  // Extract ftaa
  const ftaaMatch = html.match(/name=['"]ftaa['"][^>]*value=['"]([^'"]+)['"]/);
  const ftaa = ftaaMatch ? ftaaMatch[1] : "";

  // Extract bfaa
  const bfaaMatch = html.match(/name=['"]bfaa['"][^>]*value=['"]([^'"]+)['"]/);
  const bfaa = bfaaMatch ? bfaaMatch[1] : "";

  // Step 2: Build form data and POST
  const formData = new URLSearchParams();
  formData.append("csrf_token", csrfToken);
  formData.append("ftaa", ftaa);
  formData.append("bfaa", bfaa);
  formData.append("action", "submitSolutionFormSubmitted");
  formData.append("submittedProblemIndex", problemIndex);
  formData.append("contestId", contestId);
  formData.append("programTypeId", langId);
  formData.append("source", source);
  formData.append("sourceFile", "");
  formData.append("tabSize", "4");

  const postResp = await fetch(`${submitUrl}?csrf_token=${csrfToken}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  // Codeforces redirects to /contest/{id}/my on success
  if (postResp.ok || postResp.redirected) {
    return { success: true };
  } else {
    const text = await postResp.text();
    if (text.includes("You have submitted exactly the same code before")) {
      throw new Error("Duplicate submission — you already submitted this exact code.");
    }
    throw new Error(`Submission failed (HTTP ${postResp.status})`);
  }
}
