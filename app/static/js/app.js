// Simple single-workspace UI. No login, tokens, or user accounts.
const $ = id => document.getElementById(id);

// Single-workspace conversation identifier, not an authentication token.
let conversationId = sessionStorage.getItem('atlas_conversation_id') || crypto.randomUUID();
sessionStorage.setItem('atlas_conversation_id', conversationId);

let toastTimer;
const toast = msg => {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
};

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.detail || 'Request failed');
  return data;
};

// Reset conversation & restore hero
$('newChat').onclick = () => {
  conversationId = crypto.randomUUID();
  sessionStorage.setItem('atlas_conversation_id', conversationId);
  $('messages').replaceChildren();
  $('chatHero').classList.remove('collapsed');
  toast('Started a new conversation');
};

function view(name) {
  ['chat', 'docs', 'approval', 'admin'].forEach(x => {
    $(x + 'View').classList.toggle('hidden', x !== name);
    $(x + 'Tab').classList.toggle('active', x === name);
  });
  $('heading').textContent = {
    chat: "Ask your organization's knowledge",
    docs: 'Document management',
    approval: 'Approval requests',
    admin: 'Operational overview'
  }[name];

  if (name === 'docs') loadDocs();
  if (name === 'admin') loadMetrics();
  if (name === 'approval') loadApprovals();
}

$('chatTab').onclick = () => view('chat');
$('docsTab').onclick = () => view('docs');
$('adminTab').onclick = () => view('admin');
$('approvalTab').onclick = () => view('approval');
$('refreshApprovals').onclick = loadApprovals;

function addMessage(content, kind, sources = [], isTyping = false) {
  $('chatHero').classList.add('collapsed');

  const el = document.createElement('div');
  el.className = 'message ' + kind;

  if (kind === 'assistant') {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = '✦ ATLAS';
    el.append(meta);
  }

  if (isTyping) {
    const dots = document.createElement('div');
    dots.className = 'typing-dots';
    dots.setAttribute('aria-label', 'Searching approved documents');
    dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    el.append(dots);
  } else {
    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = content;
    el.append(body);
  }

  if (sources.length) {
    const wrap = document.createElement('div');
    wrap.className = 'sources';

    const label = document.createElement('div');
    label.className = 'sources-label';
    label.textContent = `Verified Evidence (${sources.length})`;
    wrap.append(label);

    sources.forEach(s => {
      const d = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = `[${s.index}] ${s.title} — page ${s.page}`;
      const excerpt = document.createElement('p');
      excerpt.textContent = s.excerpt;
      d.append(title, excerpt);
      wrap.append(d);
    });
    el.append(wrap);
  }

  if (kind === 'assistant' && !isTyping) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action-btn';
    copyBtn.textContent = 'Copy answer';
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(content);
      toast('Copied to clipboard');
    };
    actions.append(copyBtn);

    if (sources.length) {
      const feedback = document.createElement('button');
      feedback.type = 'button';
      feedback.className = 'msg-action-btn';
      feedback.textContent = '👍 Helpful';
      feedback.onclick = async () => {
        try {
          await api('/api/feedback', { method: 'POST', body: JSON.stringify({ rating: 1 }) });
          feedback.textContent = '✓ Marked helpful';
          feedback.disabled = true;
          toast('Feedback saved');
        } catch (e) {
          toast(e.message);
        }
      };
      actions.append(feedback);
    }

    el.append(actions);
  }

  $('messages').append(el);
  $('messages').scrollTo({ top: $('messages').scrollHeight, behavior: 'smooth' });
  return el;
}

// Auto-resize textarea & submit on Enter
const questionInput = $('question');
questionInput.addEventListener('input', () => {
  questionInput.style.height = 'auto';
  questionInput.style.height = Math.min(questionInput.scrollHeight, 150) + 'px';
});

questionInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('chatForm').requestSubmit();
  }
});

$('chatForm').onsubmit = async e => {
  e.preventDefault();
  const q = questionInput.value.trim();
  if (!q) return;

  addMessage(q, 'user');
  questionInput.value = '';
  questionInput.style.height = 'auto';

  const sendBtn = $('sendBtn');
  sendBtn.disabled = true;
  const loading = addMessage('', 'assistant', [], true);

  try {
    const r = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question: q, conversation_id: conversationId })
    });
    loading.remove();
    const msgEl = addMessage(r.answer, 'assistant', r.sources || []);
    if (r.status === 'pending_approval') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary';
      btn.style.marginTop = '12px';
      btn.textContent = 'Review approval request →';
      btn.onclick = () => view('approval');
      msgEl.append(btn);
      loadApprovals(true); // refresh sidebar badge count
    }
  } catch (err) {
    loading.remove();
    addMessage(err.message, 'assistant');
  } finally {
    sendBtn.disabled = false;
    questionInput.focus();
  }
};

document.querySelectorAll('[data-q]').forEach(b => {
  b.onclick = () => {
    questionInput.value = b.dataset.q;
    questionInput.focus();
  };
});

// Documents View & Drag-and-Drop Feedback
const fileInput = $('file');
const uploadZone = $('uploadForm');

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  $('fileLabel').textContent = f ? `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)` : 'Click to choose a file or drag & drop here';
});

['dragenter', 'dragover'].forEach(evt => {
  uploadZone.addEventListener(evt, () => uploadZone.classList.add('dragover'));
});
['dragleave', 'drop'].forEach(evt => {
  uploadZone.addEventListener(evt, () => uploadZone.classList.remove('dragover'));
});

async function loadDocs() {
  const root = $('docs');
  try {
    const r = await api('/api/documents');
    const docs = r.documents || [];
    $('docCount').textContent = `${docs.length} file${docs.length === 1 ? '' : 's'}`;
    if (!docs.length) {
      root.textContent = 'No documents uploaded yet. Add a file above to populate the knowledge base.';
      return;
    }
    root.replaceChildren(...docs.map(d => {
      const card = document.createElement('div');
      card.className = 'doc-card';

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'doc-title';
      title.textContent = d.title;

      const meta = document.createElement('div');
      meta.className = 'doc-meta';
      meta.textContent = `Version ${d.current_version}`;
      info.append(title, meta);

      const badge = document.createElement('span');
      badge.className = 'badge-pill';
      badge.textContent = d.status;

      card.append(info, badge);
      return card;
    }));
  } catch (e) {
    root.textContent = e.message;
  }
}

$('uploadForm').onsubmit = async e => {
  e.preventDefault();
  const f = fileInput.files[0];
  if (!f) return;
  if (f.size > 10485760) {
    toast('Maximum file size is 10 MB');
    return;
  }

  const uploadBtn = $('uploadBtn');
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const r = await api('/api/documents/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: f.name })
    });
    const up = await fetch(r.upload_url, { method: 'PUT', headers: r.headers, body: f });
    if (!up.ok) throw Error('S3 upload failed');

    uploadBtn.textContent = 'Indexing...';
    toast('Uploaded to S3. Processing document now...');
    await api('/api/documents/complete', {
      method: 'POST',
      body: JSON.stringify({ document_id: r.document_id })
    });

    toast('Document indexed in Pinecone!');
    fileInput.value = '';
    $('fileLabel').textContent = 'Click to choose a file or drag & drop here';
    loadDocs();
  } catch (err) {
    toast(err.message);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Index';
  }
};

// Render flat numeric/string KPIs as cards while preserving raw JSON
function renderKpiCards(containerId, obj) {
  const container = $(containerId);
  container.replaceChildren();
  if (!obj || typeof obj !== 'object') return;

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) continue;
    const card = document.createElement('div');
    card.className = 'kpi-card';

    const label = document.createElement('div');
    label.className = 'kpi-label';
    label.textContent = key.replace(/_/g, ' ');

    const value = document.createElement('div');
    value.className = 'kpi-value';
    value.textContent = String(val);

    card.append(label, value);
    container.append(card);
  }
}

async function loadMetrics() {
  try {
    const [m, g] = await Promise.all([
      api('/api/admin/metrics'),
      api('/api/admin/guardrails')
    ]);
    renderKpiCards('metricsCards', m);
    renderKpiCards('guardrailCards', g);
    $('metrics').textContent = JSON.stringify(m, null, 2);
    $('guardrailMetrics').textContent = JSON.stringify(g, null, 2);
  } catch (e) {
    $('metrics').textContent = e.message;
  }
}

// Admin approval workflow. DOM nodes use textContent (never untrusted innerHTML).
async function loadApprovals(silentBadgeOnly = false) {
  const root = $('approvalList');
  if (!silentBadgeOnly) root.textContent = 'Loading approvals...';

  try {
    const response = await api('/api/approvals');
    if (!Array.isArray(response.approvals)) throw Error('Unexpected API response: approvals list missing');

    const approvals = response.approvals;
    const pending = approvals.filter(a => String(a.status).trim().toLowerCase() === 'pending').length;

    const badge = $('pendingBadge');
    badge.textContent = pending;
    badge.classList.toggle('hidden', pending === 0);

    if (silentBadgeOnly) return;

    $('approvalSummary').textContent = `${pending} pending · ${approvals.length} total (most recent 100)`;
    root.replaceChildren();

    if (!approvals.length) {
      root.textContent = 'No approval requests yet. Try asking the chatbot to delete a document.';
      return;
    }

    for (const a of approvals) {
      const card = document.createElement('article');
      card.className = 'approval-card';

      const header = document.createElement('div');
      header.className = 'approval-header';

      const title = document.createElement('strong');
      title.textContent = a.question;

      const statusBadge = document.createElement('span');
      statusBadge.className = 'approval-status ' + a.status;
      statusBadge.textContent = a.status;

      header.append(title, statusBadge);
      card.append(header);

      const meta = document.createElement('p');
      meta.textContent = `Requested by ${a.requester} · ${new Date(a.created_at).toLocaleString()}`;
      card.append(meta);

      if (String(a.status).trim().toLowerCase() === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'approval-actions';

        for (const [label, approve] of [['Approve', true], ['Reject', false]]) {
          const button = document.createElement('button');
          button.textContent = label;
          button.className = approve ? 'approve-button' : 'reject-button';
          button.onclick = async () => {
            const decision = approve ? 'approve' : 'reject';
            if (!confirm(`Are you sure you want to ${decision} this request? This records a decision only and does not execute the requested action.`)) return;
            button.disabled = true;
            try {
              const r = await api(`/api/approvals/${encodeURIComponent(a.id)}/decision`, {
                method: 'POST',
                body: JSON.stringify({ approve })
              });
              toast(`Request ${r.status}. No action executed.`);
              await loadApprovals();
            } catch (e) {
              toast(e.message);
              button.disabled = false;
            }
          };
          actions.append(button);
        }
        card.append(actions);
      } else {
        const info = document.createElement('p');
        info.textContent = `Reviewed by ${a.reviewer || 'unknown'} · ${a.reviewed_at ? new Date(a.reviewed_at).toLocaleString() : ''} · No action executed`;
        card.append(info);
      }
      root.append(card);
    }
  } catch (e) {
    if (!silentBadgeOnly) {
      root.textContent = `Unable to load approvals: ${e.message}. Check /api/approvals and your Uvicorn terminal.`;
    }
    console.error('Approvals loading failed:', e);
  }
}

// Initial background check so pending badge appears immediately on page load
loadApprovals(true);