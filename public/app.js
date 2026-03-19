const state = {
  plan: new URLSearchParams(window.location.search).get('plan') || 'team',
  demo: null,
  selectedId: null
};

const el = {
  runtimePill: document.getElementById('runtimePill'),
  headline: document.getElementById('headline'),
  planButtons: document.getElementById('planButtons'),
  planTitle: document.getElementById('planTitle'),
  planPromise: document.getElementById('planPromise'),
  kpis: document.getElementById('kpis'),
  operatorDigest: document.getElementById('operatorDigest'),
  mailboxLabel: document.getElementById('mailboxLabel'),
  savedMinutes: document.getElementById('savedMinutes'),
  queueCount: document.getElementById('queueCount'),
  queue: document.getElementById('queue'),
  detailSubject: document.getElementById('detailSubject'),
  detailMeta: document.getElementById('detailMeta'),
  detailSummary: document.getElementById('detailSummary'),
  detailWhy: document.getElementById('detailWhy'),
  detailActions: document.getElementById('detailActions'),
  detailDraft: document.getElementById('detailDraft'),
  followBoard: document.getElementById('followBoard'),
  refreshBtn: document.getElementById('refreshBtn')
};

function euro(value) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'onbekend' : date.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
}

function badgeClass(bucket) {
  if (!bucket) return 'p3';
  if (bucket.startsWith('P1')) return 'p1';
  if (bucket.startsWith('P2')) return 'p2';
  if (bucket.startsWith('P3')) return 'p3';
  return 'p4';
}

function renderPlanButtons(availablePlans) {
  el.planButtons.innerHTML = '';
  availablePlans.forEach((planKey) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `plan-btn${planKey === state.plan ? ' active' : ''}`;
    button.innerHTML = `<strong>${planKey.toUpperCase()}</strong><small>Klik om seeded demo voor ${planKey} te laden</small>`;
    button.addEventListener('click', () => {
      state.plan = planKey;
      const url = new URL(window.location.href);
      url.searchParams.set('plan', planKey);
      window.history.replaceState({}, '', url);
      loadDemo();
    });
    el.planButtons.appendChild(button);
  });
}

function renderKpis(stats) {
  const items = [
    { value: stats.inboxItems, label: 'Seeded inboxitems' },
    { value: stats.p1, label: 'Direct handelen' },
    { value: stats.p2, label: 'Vandaag afronden' },
    { value: euro(stats.revenueAtRisk), label: 'Waarde / impact in view' },
    { value: `${stats.avgFirstPassSavedMinutes} min`, label: 'Gemiddeld bespaarde first pass' }
  ];

  el.kpis.innerHTML = items.map((item) => `
    <div class="kpi">
      <strong>${item.value}</strong>
      <span>${item.label}</span>
    </div>
  `).join('');
}

function renderDigest(lines) {
  el.operatorDigest.innerHTML = lines.map((line) => `<div class="mini-card">${line}</div>`).join('');
}

function renderQueue(messages) {
  el.queue.innerHTML = '';
  messages.forEach((item) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `queue-item${item.id === state.selectedId ? ' active' : ''}`;
    node.innerHTML = `
      <div class="queue-top">
        <div>
          <strong>${item.subject}</strong>
          <div class="meta">${item.company} • ${item.fromName}</div>
        </div>
        <span class="badge ${badgeClass(item.triage.bucket)}">${item.triage.bucket}</span>
      </div>
      <div class="meta" style="margin-top:10px;">${item.preview}</div>
      <div class="meta" style="margin-top:10px;">Score ${item.triage.score} • ${item.deadlineText} • owner ${item.recommendedOwner}</div>
    `;
    node.addEventListener('click', () => {
      state.selectedId = item.id;
      renderQueue(messages);
      renderDetail(item);
    });
    el.queue.appendChild(node);
  });
}

function renderDetail(item) {
  el.detailSubject.textContent = item.subject;
  el.detailMeta.innerHTML = `${item.company} • ${item.fromName} &lt;${item.fromEmail}&gt; • ${formatTime(item.receivedAt)} • <span class="badge ${badgeClass(item.triage.bucket)}">${item.triage.bucket}</span>`;
  el.detailSummary.textContent = item.summary;
  el.detailWhy.innerHTML = item.triage.why.map((line) => `<li>${line}</li>`).join('');
  el.detailActions.innerHTML = item.actions.map((line) => `<li>${line}</li>`).join('');
  el.detailDraft.textContent = item.replyDraft;
}

function renderFollowBoard(messages) {
  const top = messages
    .filter((item) => item.followUpAt)
    .slice(0, 6)
    .map((item) => `
      <div class="follow-item">
        <strong>${item.company}</strong>
        <div class="sub" style="margin-top:6px;">${item.subject}</div>
        <div class="sub" style="margin-top:8px;">Follow-up: ${formatTime(item.followUpAt)}</div>
        <div class="sub" style="margin-top:8px;">Actie: ${item.actions[0] || 'handmatige check'}</div>
      </div>
    `);
  el.followBoard.innerHTML = top.join('');
}

async function loadDemo() {
  el.runtimePill.textContent = `Demo laden voor plan ${state.plan}…`;
  const response = await fetch(`/api/demo?plan=${encodeURIComponent(state.plan)}`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'demo_load_failed');
  }

  state.demo = payload.demo;
  state.selectedId = payload.demo.messages[0]?.id || null;

  renderPlanButtons(payload.availablePlans);
  el.runtimePill.textContent = `Live demo • ${payload.demo.generatedAt}`;
  el.headline.textContent = payload.demo.headline;
  el.planTitle.textContent = `${payload.demo.plan.label} demo`;
  el.planPromise.textContent = payload.demo.plan.promise;
  el.mailboxLabel.textContent = payload.demo.plan.mailboxLabel;
  el.savedMinutes.textContent = `${payload.demo.stats.avgFirstPassSavedMinutes} min`;
  el.queueCount.textContent = `${payload.demo.stats.inboxItems} items`;
  renderKpis(payload.demo.stats);
  renderDigest(payload.demo.operatorDigest);
  renderQueue(payload.demo.messages);
  renderFollowBoard(payload.demo.messages);

  if (payload.demo.messages[0]) {
    renderDetail(payload.demo.messages[0]);
  }
}

el.refreshBtn.addEventListener('click', () => {
  loadDemo().catch(renderError);
});

function renderError(error) {
  el.runtimePill.textContent = 'Demo-load mislukt';
  el.headline.textContent = `Fout: ${error.message}`;
}

loadDemo().catch(renderError);
