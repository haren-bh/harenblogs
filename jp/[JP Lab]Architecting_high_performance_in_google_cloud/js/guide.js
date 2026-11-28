// ============================================================================
// Building Advanced Agents with Antigravity — Interactive Multi-Stage Guide JS
// ============================================================================

// 1. Progressive Polyfills & Feature-Detected Fallbacks (modern-web-guidance)
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('https://esm.run/invokers-polyfill').catch(() => {
    document.addEventListener('click', (e) => {
      const originEl = e.target instanceof Element ? e.target : e.target?.parentElement;
      const btn = originEl?.closest('button[commandfor][command]');
      if (!btn) return;
      const target = document.getElementById(btn.getAttribute('commandfor'));
      if (!target) return;
      const cmd = btn.getAttribute('command');
      if (cmd === 'toggle-popover') target.togglePopover?.();
      else if (cmd === 'show-popover') target.showPopover?.();
      else if (cmd === 'hide-popover') target.hidePopover?.();
      else if (cmd === 'show-modal') target.showModal?.();
      else if (cmd === 'close') target.close?.();
    });
  });
}

if (!('closedBy' in HTMLDialogElement.prototype)) {
  document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    });
  });
}

// Mobile Left Navigation Drawer (modern-web-guidance: navigation-drawer)
const mobileDrawer = document.getElementById('mobile-drawer');
const mobileDrawerOpenBtn = document.getElementById('drawer-open');
const mobileDrawerCloseBtn = document.getElementById('drawer-close');
const mobileDrawerScroller = mobileDrawer?.querySelector('.Drawer-scroller');
const mobileDrawerSheet = mobileDrawer?.querySelector('.Drawer-sheet');

async function openMobileDrawer() {
  if (!mobileDrawer || !mobileDrawerScroller) return;
  mobileDrawer.showModal();
  if (!CSS.supports('scroll-initial-target', 'nearest')) {
    mobileDrawerScroller.scrollTo({ left: mobileDrawerScroller.offsetWidth, behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  mobileDrawerScroller.scrollTo({ left: 0, behavior: 'auto' });
}

function closeMobileDrawer() {
  if (!mobileDrawer || !mobileDrawer.open || !mobileDrawerScroller) return;
  mobileDrawerScroller.scrollTo({ left: mobileDrawerScroller.offsetWidth, behavior: 'auto' });
}

if (mobileDrawer && mobileDrawerScroller && mobileDrawerSheet && mobileDrawerOpenBtn) {
  if (!CSS.supports('animation-timeline: scroll()')) {
    mobileDrawerScroller.addEventListener('scroll', () => {
      const ratio = Math.max(0, Math.min(1, 1 - mobileDrawerScroller.scrollLeft / (mobileDrawerSheet.offsetWidth || 1)));
      mobileDrawer.style.setProperty('--drawer-backdrop', String(ratio));
    }, { passive: true });
  }

  const visibleThreshold = 1 / Math.max(320, window.innerWidth);
  const drawerObserver = new IntersectionObserver((entries) => {
    const entry = entries.at(-1);
    if (!entry) return;
    if (entry.intersectionRatio < visibleThreshold && mobileDrawer.open) {
      mobileDrawer.close();
      mobileDrawerOpenBtn.setAttribute('aria-expanded', 'false');
    } else if (entry.intersectionRatio >= 0.98) {
      mobileDrawerOpenBtn.setAttribute('aria-expanded', 'true');
    }
  }, { root: mobileDrawer, threshold: [visibleThreshold, 0.98, 1] });
  drawerObserver.observe(mobileDrawerSheet);

  mobileDrawerOpenBtn.addEventListener('click', openMobileDrawer);
  mobileDrawerCloseBtn?.addEventListener('click', closeMobileDrawer);
  mobileDrawer.addEventListener('click', (event) => {
    if (!mobileDrawerSheet.contains(event.target)) closeMobileDrawer();
  });
  mobileDrawer.addEventListener('cancel', (event) => {
    if (event.cancelable) {
      event.preventDefault();
      closeMobileDrawer();
    }
  });
}

// ============================================================================
// 2. Stage Definitions, Bilingual Strings & Architecture Metadata
// ============================================================================
const STAGE_ORDER = [
  'overview',
  'stage-1',
  'stage-2',
  'stage-3',
  'stage-4',
  'stage-5',
  'stage-6',
  'stage-7',
  'stage-8'
];

const ACTIONABLE_STAGES = STAGE_ORDER.slice(1); // stage-1 .. stage-8

const UI_STRINGS = {
  ja: {
    pageTitle: 'Antigravity で構築する高度な AI エージェント | Google Cloud ハンズオンラボ',
    stageHudOverview: '概要・構成図',
    stageHudFmt: (n) => `STAGE ${n} / 8`,
    doneHudFmt: (done) => `${done} / 8 完了`,
    progressSummary: (done) => done === 8
      ? '全 8 ステージ完了！本番対応エージェントが稼働中です'
      : `進捗状況：8 ステージ中 ${done} ステージ完了`,
    showAll: '全ステージを一括表示',
    singleStage: 'ステージ別表示に戻す',
    markComplete: 'このステージを完了として記録',
    markedComplete: '✓ 完了済み（クリックで解除）',
    copied: 'コピー完了 ✓',
    copy: 'Copy',
    viewRaw: 'Raw .md 表示',
    viewFormatted: '整形表示',
    ledgerDone: '✓',
    ledgerReady: '✓'
  },
  en: {
    pageTitle: 'Building Advanced Agents with Antigravity | Google Cloud Hands-On Lab',
    stageHudOverview: 'ARCHITECTURE',
    stageHudFmt: (n) => `STAGE ${n} / 8`,
    doneHudFmt: (done) => `${done} / 8 DONE`,
    progressSummary: (done) => done === 8
      ? 'All 8 stages completed — your production agent is live!'
      : `Progress: ${done} of 8 stages completed`,
    showAll: 'Show All Stages',
    singleStage: 'Single-Stage View',
    markComplete: 'Mark This Stage Complete',
    markedComplete: '✓ Stage Completed (Click to Undo)',
    copied: 'Copied ✓',
    copy: 'Copy',
    viewRaw: 'View Raw .md',
    viewFormatted: 'Formatted View',
    ledgerDone: '✓',
    ledgerReady: '✓'
  }
};

const ARCH_DETAILS = {
  a2ui: {
    stage: 'stage-7',
    ja: {
      eyebrow: 'CLIENT TIER • ADK Web UI (:8000) + A2UI v0.8 (Experimental)',
      title: 'ブラウザチャット & 3 つの宣言型 A2UI サーフェス',
      desc: '初回のみ表示される「食事の好み登録フォーム（@default）」、クリックで出発点と km 半径を指定できる「Google マップ検索ピッカー（map_search_surface）」、ピンと星評価リスト・詳細カードが連動する「検索結果エクスプローラー（map_results_surface）」をチャット内に直接描画します。',
      cta: 'ステージ 7（A2UI フォーム）へ移動 →'
    },
    en: {
      eyebrow: 'CLIENT TIER • ADK Web UI (:8000) + A2UI v0.8 (Experimental)',
      title: 'Browser Chat & 3 Declarative A2UI Surfaces',
      desc: 'Renders three interactive surfaces natively inside ADK Web UI: (1) Initial-fill Dining Preferences Form (@default), (2) Clickable Google Maps Location & km Radius Picker (map_search_surface), and (3) Side-by-Side Map + Star-Rated Results Explorer (map_results_surface).',
      cta: 'Jump to Stage 7 (A2UI Form) →'
    }
  },
  orchestrator: {
    stage: 'stage-5',
    ja: {
      eyebrow: 'ORCHESTRATION TIER • ADK Python (GA) + Gemini 4 Neon (Public Preview)',
      title: 'ルートエージェント restaurant_finder & Search サブエージェント',
      desc: 'Gemini Platform の global エンドポイント上の gemini-4-neon をメインモデルに採用。Google 検索グラウンディングを担う AgentTool(google_search_agent)、Places 検索ツール、PreloadMemoryTool、そして検証済み <a2ui-json> を確実に注入する after_model_callback を統合します。',
      cta: 'ステージ 5（ADK エージェント構築）へ移動 →'
    },
    en: {
      eyebrow: 'ORCHESTRATION TIER • ADK Python (GA) + Gemini 4 Neon (Public Preview)',
      title: 'Root Agent restaurant_finder & Search Sub-Agent',
      desc: 'Powered by gemini-4-neon on the Gemini Platform global endpoint. Combines AgentTool(google_search_agent) for Google Search grounding, custom Google Maps Places/Geocoding tools, PreloadMemoryTool(), and deterministic <a2ui-json> injection via after_model_callback.',
      cta: 'Jump to Stage 5 (Build ADK Agent) →'
    }
  },
  sessions: {
    stage: 'stage-6',
    ja: {
      eyebrow: 'MANAGED STATE • Gemini Platform Agent Runtime Sessions (GA • us-central1)',
      title: 'Agent Runtime リモートセッション管理',
      desc: 'ローカル SQLite ではなく Gemini Platform の Agent Runtime（us-central1）にマルチターン会話履歴とイベントを保存します。ローカルの adk web とデプロイ済みコンテナの双方から共有され、Google Cloud コンソールの Playground でリアルタイムに検証できます。',
      cta: 'ステージ 6（デプロイ＆セッション確認）へ移動 →'
    },
    en: {
      eyebrow: 'MANAGED STATE • Gemini Platform Agent Runtime Sessions (GA • us-central1)',
      title: 'Agent Runtime Managed Remote Sessions',
      desc: 'Persists multi-turn conversation state and event streams in Gemini Platform Agent Runtime (us-central1) instead of local SQLite. Shared seamlessly across local adk web testing and cloud Playground inspections.',
      cta: 'Jump to Stage 6 (Deploy & Verify Sessions) →'
    }
  },
  memory: {
    stage: 'stage-4',
    ja: {
      eyebrow: 'LONG-TERM MEMORY • Gemini Platform Memory Bank (Public Preview • us-central1)',
      title: 'Agent Runtime Memory Bank（4 標準トピック + 4 カスタムトピック）',
      desc: '4 つの組み込みマネージドトピックに加え、Preferred food type・Allergies・Preferred price range・Name の 4 つの CustomMemoryTopic を構成。セッションを跨いでユーザーの食の好みを自動記憶・想起します。',
      cta: 'ステージ 4（Agent Runtime & Memory 構築）へ移動 →'
    },
    en: {
      eyebrow: 'LONG-TERM MEMORY • Gemini Platform Memory Bank (Public Preview • us-central1)',
      title: 'Agent Runtime Memory Bank (4 Managed + 4 Custom Topics)',
      desc: 'Configured inside Gemini Platform Agent Runtime with 4 managed topics plus 4 CustomMemoryTopic definitions (Preferred food type, Allergies, Preferred price range, Name) to consolidate and recall dining preferences silently across sessions.',
      cta: 'Jump to Stage 4 (Runtime & Memory Setup) →'
    }
  },
  maps: {
    stage: 'stage-4',
    ja: {
      eyebrow: 'GEOSPATIAL TIER • Google Maps Platform (GA • Service-Restricted Key)',
      title: 'Places API (New)・Geocoding API・Maps JavaScript API',
      desc: 'サービス制限付き GOOGLE_MAPS_API_KEY を用いて、エリア名の緯度経度変換（Geocoding）、指定 km 圏内の実店舗検索と評価・価格帯取得（places:searchText + Haversine 距離計算）、対話型マップ描画を行います。',
      cta: 'ステージ 4（Google Maps API キー作成）へ移動 →'
    },
    en: {
      eyebrow: 'GEOSPATIAL TIER • Google Maps Platform (GA • Service-Restricted Key)',
      title: 'Places API (New), Geocoding API & Maps JavaScript API',
      desc: 'Uses a least-privilege GOOGLE_MAPS_API_KEY to geocode locations, query verified restaurants within radius_km via places:searchText (locationBias.circle + Haversine filtering), and render interactive markers, circles, and info windows.',
      cta: 'Jump to Stage 4 (Google Maps API Key) →'
    }
  },
  deploy: {
    stage: 'stage-6',
    ja: {
      eyebrow: 'CONTAINER PIPELINE • Cloud Build + Artifact Registry + agents-cli (GA / Preview)',
      title: 'マネージド コンテナビルド & Agent Runtime デプロイ',
      desc: 'agents-cli deploy により Dockerfile と環境変数をパッケージングし、Cloud Build でビルド・Artifact Registry へ格納後、Gemini Platform の Agent Runtime 上のフルマネージド エンドポイントとして公開します。',
      cta: 'ステージ 6（Agent Runtime デプロイ）へ移動 →'
    },
    en: {
      eyebrow: 'CONTAINER PIPELINE • Cloud Build + Artifact Registry + agents-cli (GA / Preview)',
      title: 'Managed Container Build & Agent Runtime Deployment',
      desc: 'agents-cli deploy packages your ADK project, builds the container image in Cloud Build, stores it in Artifact Registry, and deploys it directly onto your Gemini Platform Agent Runtime instance.',
      cta: 'Jump to Stage 6 (Agent Runtime Deploy) →'
    }
  }
};

// ============================================================================
// 3. State Initialization (Language, Active Stage, Completed Stages, Params)
// ============================================================================
const LANG_KEY = 'agy_adv_agents_lang';
const PROGRESS_KEY = 'agy_adv_agents_completed_v1';
const PARAMS_KEY = 'agy_adv_agents_params_v1';

let currentLang = (() => {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang === 'en' || urlLang === 'ja') return urlLang;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ja') return saved;
  } catch (_) {}
  return 'ja';
})();

let completedStages = new Set();
try {
  const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');
  if (Array.isArray(raw)) raw.forEach((s) => { if (ACTIONABLE_STAGES.includes(s)) completedStages.add(s); });
} catch (_) {}

let showAllStages = false;
let currentStage = 'overview';
let selectedArchKey = 'memory';

// ============================================================================
// 4. Directional View Transition Helper (modern-web-guidance)
// ============================================================================
function navigateWithDirection(updateDOM, direction) {
  let didRun = false;
  const safeUpdate = () => {
    if (didRun) return;
    didRun = true;
    updateDOM();
  };

  if (
    !document.startViewTransition ||
    showAllStages ||
    document.visibilityState === 'hidden' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    safeUpdate();
    return Promise.resolve();
  }

  const guardTimer = setTimeout(safeUpdate, 120);

  try {
    const vt = document.startViewTransition({
      update: () => {
        clearTimeout(guardTimer);
        safeUpdate();
      },
      types: [direction]
    });
    vt.ready?.catch(() => {});
    vt.updateCallbackDone?.catch(() => {
      clearTimeout(guardTimer);
      safeUpdate();
    });
    return vt.finished.catch(() => {
      clearTimeout(guardTimer);
      safeUpdate();
    });
  } catch (_) {
    try {
      const vt = document.startViewTransition(() => {
        clearTimeout(guardTimer);
        safeUpdate();
      });
      vt.ready?.catch(() => {});
      vt.updateCallbackDone?.catch(() => {
        clearTimeout(guardTimer);
        safeUpdate();
      });
      return vt.finished.catch(() => {
        clearTimeout(guardTimer);
        safeUpdate();
      });
    } catch (_2) {
      clearTimeout(guardTimer);
      safeUpdate();
      return Promise.resolve();
    }
  }
}

function getStageFromHash() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return STAGE_ORDER.includes(hash) ? hash : 'overview';
}

// ============================================================================
// 5. Render Functions (Stage Visibility, HUD, Progress, Language, Arch)
// ============================================================================
const stageSections = Array.from(document.querySelectorAll('main > section[data-stage]'));

function applyStageDOM(targetStage) {
  currentStage = targetStage;
  document.body.classList.toggle('is-all-stages', showAllStages);

  stageSections.forEach((sec) => {
    sec.hidden = showAllStages ? false : sec.dataset.stage !== targetStage;
  });

  // Update Left Sidebar & Mobile Drawer active highlights (aria-current="page" per navbar guide)
  document.querySelectorAll('[data-stage-nav]').forEach((el) => {
    const isTarget = !showAllStages && el.dataset.stageNav === targetStage;
    el.classList.toggle('is-active', isTarget);
    if (isTarget) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });

  updateHudAndProgress();
}

function focusStageHeading(targetStage, scrollSmooth = false) {
  const sec = document.getElementById(targetStage);
  if (!sec) return;
  if (showAllStages) {
    sec.scrollIntoView({ behavior: scrollSmooth ? 'smooth' : 'auto', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const heading = sec.querySelector('h1, h2');
  heading?.focus({ preventScroll: true });
}

function goToStage(targetStage, { moveFocus = true } = {}) {
  if (!STAGE_ORDER.includes(targetStage)) return;
  if (mobileDrawer?.open) {
    mobileDrawer.close();
    mobileDrawerOpenBtn?.setAttribute('aria-expanded', 'false');
  }
  const prevIdx = STAGE_ORDER.indexOf(currentStage);
  const nextIdx = STAGE_ORDER.indexOf(targetStage);
  const direction = nextIdx >= prevIdx ? 'forward' : 'backward';

  navigateWithDirection(() => {
    applyStageDOM(targetStage);
    if (!showAllStages) window.scrollTo({ top: 0, behavior: 'instant' });
  }, direction).then(() => {
    if (moveFocus) focusStageHeading(targetStage, showAllStages);
    const activeItem = document.querySelector(`.left-sidebar [data-stage-nav="${targetStage}"]`);
    activeItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function updateHudAndProgress() {
  const strings = UI_STRINGS[currentLang];
  const doneCount = completedStages.size;
  const pct = Math.round((doneCount / ACTIONABLE_STAGES.length) * 100);
  const stageIdx = STAGE_ORDER.indexOf(currentStage);
  const stageText = stageIdx <= 0 ? strings.stageHudOverview : strings.stageHudFmt(stageIdx);

  document.querySelectorAll('[data-hud-stage]').forEach((el) => {
    el.textContent = stageText;
  });
  document.querySelectorAll('[data-hud-done]').forEach((el) => {
    el.textContent = strings.doneHudFmt(doneCount);
  });
  document.querySelectorAll('[data-progress-fill]').forEach((el) => {
    el.style.setProperty('--lab-progress', `${pct}%`);
  });
  document.querySelectorAll('[data-progress-text]').forEach((el) => {
    el.textContent = strings.progressSummary(doneCount);
  });
  document.querySelectorAll('[data-toggle-all]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(showAllStages));
    btn.textContent = showAllStages ? strings.singleStage : strings.showAll;
  });

  // Sidebar badges & roadmap cards
  ACTIONABLE_STAGES.forEach((stId, idx) => {
    const isDone = completedStages.has(stId);
    const num = idx + 1;

    document.querySelectorAll(`.step-node[data-stage-nav="${stId}"]`).forEach((pill) => {
      pill.classList.toggle('is-done', isDone);
      const badge = pill.querySelector('.step-node-badge');
      if (badge) badge.textContent = isDone ? '✓' : String(num);
    });

    document.querySelectorAll(`.roadmap-card[data-roadmap-stage="${stId}"]`).forEach((card) => {
      card.classList.toggle('is-done', isDone);
    });

    document.querySelectorAll(`.btn-complete-toggle[data-complete-stage="${stId}"]`).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(isDone));
      btn.textContent = isDone ? strings.markedComplete : strings.markComplete;
    });

    document.querySelectorAll(`.ledger-row[data-ledger-stage="${stId}"] .ledger-status`).forEach((badge) => {
      badge.textContent = isDone ? strings.ledgerDone : strings.ledgerReady;
    });
  });

  // Synchronize Friendly Cute Stage Journey Diagrams (.stage-journey-map)
  document.querySelectorAll('.stage-journey-map').forEach((mapEl) => {
    const mode = mapEl.dataset.mapMode || 'start';
    const focusNum = Number(mapEl.dataset.mapStage || 0);
    let firstPendingAssigned = false;

    const nodeDone = {};
    for (let k = 1; k <= 8; k += 1) {
      const stId = `stage-${k}`;
      const savedDone = completedStages.has(stId);
      let isCurrent = false;
      let isDone = false;
      let isNext = false;

      if (mode === 'start') {
        isCurrent = k === focusNum;
        isDone = !isCurrent && (k < focusNum || savedDone);
        isNext = !isCurrent && !isDone && k === focusNum + 1;
      } else if (mode === 'end') {
        isDone = k <= focusNum || savedDone;
        isNext = !isDone && k === focusNum + 1;
      } else {
        // overview mode
        isDone = savedDone;
        if (!isDone && !firstPendingAssigned) {
          isNext = true;
          firstPendingAssigned = true;
        }
      }

      nodeDone[k] = isDone;
      const nodeEl = mapEl.querySelector(`.journey-node[data-journey-num="${k}"]`);
      if (nodeEl) {
        nodeEl.classList.toggle('is-complete', isDone);
        nodeEl.classList.toggle('is-current', isCurrent);
        nodeEl.classList.toggle('is-next', isNext);
        nodeEl.classList.toggle('is-upcoming', !isDone && !isCurrent && !isNext);
        const numBadge = nodeEl.querySelector('.journey-num-pill');
        if (numBadge) numBadge.textContent = isDone ? '✓' : String(k);
      }
    }

    for (let k = 1; k <= 7; k += 1) {
      const arrowEl = mapEl.querySelector(`.journey-arrow[data-arrow-from="${k}"]`);
      if (arrowEl) {
        arrowEl.classList.toggle('is-complete', Boolean(nodeDone[k]));
        arrowEl.classList.toggle('is-active', !nodeDone[k] && mode === 'start' && k === focusNum);
      }
    }
  });
}

function renderArchitectureInspector() {
  const entry = ARCH_DETAILS[selectedArchKey] || ARCH_DETAILS.memory;
  const copy = entry[currentLang];
  const eyebrowEl = document.getElementById('arch-inspector-eyebrow');
  const titleEl = document.getElementById('arch-inspector-title');
  const descEl = document.getElementById('arch-inspector-desc');
  const jumpEl = document.getElementById('arch-inspector-jump');

  if (eyebrowEl) eyebrowEl.textContent = copy.eyebrow;
  if (titleEl) titleEl.textContent = copy.title;
  if (descEl) descEl.textContent = copy.desc;
  if (jumpEl) {
    jumpEl.setAttribute('href', `#${entry.stage}`);
    jumpEl.textContent = copy.cta;
  }

  document.querySelectorAll('.arch-node[data-arch-key]').forEach((btn) => {
    const active = btn.dataset.archKey === selectedArchKey;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function applyLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'ja';
  document.documentElement.lang = currentLang;
  document.documentElement.dataset.lang = currentLang;
  document.title = UI_STRINGS[currentLang].pageTitle;

  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.setLang === currentLang));
  });

  try {
    localStorage.setItem(LANG_KEY, currentLang);
  } catch (_) {}

  renderArchitectureInspector();
  updateHudAndProgress();
}

// ============================================================================
// 6. Event Listeners: Stage Navigation, Language, Completion, Params & Copy
// ============================================================================
function safeUpdateUrlHash(targetId) {
  const desiredHash = targetId === 'overview' ? '' : `#${targetId}`;
  if (window.location.hash === desiredHash) return;
  try {
    const url = new URL(window.location.href);
    url.hash = desiredHash;
    history.pushState(null, '', url.href);
  } catch (_) {
    // Sandboxed srcdoc / IDE previews or restricted origins may block pushState;
    // stage switching still runs cleanly in-memory via goToStage().
  }
}

document.addEventListener('click', (event) => {
  const targetEl = event.target instanceof Element ? event.target : event.target?.parentElement;
  const link = targetEl?.closest('a[href^="#"]');
  if (!link) return;
  const rawHref = link.getAttribute('href') || '';
  const targetId = rawHref.slice(1).trim();
  if (!STAGE_ORDER.includes(targetId)) return;
  event.preventDefault();

  // If clicking "Complete & Continue" button link, also mark current stage complete
  if (link.dataset.autoCompleteStage) {
    completedStages.add(link.dataset.autoCompleteStage);
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...completedStages])); } catch (_) {}
  }

  if (showAllStages && targetId === 'overview') {
    showAllStages = false;
  }

  safeUpdateUrlHash(targetId);
  goToStage(targetId, { moveFocus: true });
});

window.addEventListener('popstate', () => {
  const hashStage = getStageFromHash();
  if (hashStage !== currentStage) {
    goToStage(hashStage, { moveFocus: true });
  }
});

window.addEventListener('hashchange', () => {
  const hashStage = getStageFromHash();
  if (hashStage !== currentStage) {
    goToStage(hashStage, { moveFocus: true });
  }
});

// Keyboard Alt+Left / Alt+Right stage navigation
window.addEventListener('keydown', (event) => {
  if (!event.altKey || showAllStages) return;
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const idx = STAGE_ORDER.indexOf(currentStage);
  const nextIdx = event.key === 'ArrowRight' ? idx + 1 : idx - 1;
  if (nextIdx >= 0 && nextIdx < STAGE_ORDER.length) {
    event.preventDefault();
    const targetId = STAGE_ORDER[nextIdx];
    safeUpdateUrlHash(targetId);
    goToStage(targetId, { moveFocus: true });
  }
});

document.querySelectorAll('[data-toggle-all]').forEach((btn) => {
  btn.addEventListener('click', () => {
    showAllStages = !showAllStages;
    if (mobileDrawer?.open) closeMobileDrawer();
    applyStageDOM(currentStage);
  });
});

document.querySelectorAll('[data-set-lang]').forEach((btn) => {
  btn.addEventListener('click', () => applyLanguage(btn.dataset.setLang));
});

document.querySelectorAll('.arch-node[data-arch-key]').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedArchKey = btn.dataset.archKey;
    renderArchitectureInspector();
  });
});

document.querySelectorAll('.btn-complete-toggle[data-complete-stage]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const st = btn.dataset.completeStage;
    if (completedStages.has(st)) completedStages.delete(st);
    else completedStages.add(st);
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify([...completedStages]));
    } catch (_) {}
    updateHudAndProgress();
  });
});

// Shared Parameter Sync (<YOUR_PROJECT_ID> & <SKILLS_REPO_URL>)
const projectInputs = Array.from(document.querySelectorAll('[data-project-input]'));
const skillsInputs = Array.from(document.querySelectorAll('[data-skills-input]'));

function syncSharedParams(projectVal, skillsVal, sourceEl = null) {
  const cleanProj = (projectVal || '').trim();
  const cleanSkills = (skillsVal || '').trim();

  projectInputs.forEach((inp) => { if (inp !== sourceEl && projectVal !== null) inp.value = projectVal; });
  skillsInputs.forEach((inp) => { if (inp !== sourceEl && skillsVal !== null) inp.value = skillsVal; });

  const projToken = cleanProj || '<YOUR_PROJECT_ID>';
  const skillsToken = cleanSkills || '<SKILLS_REPO_URL>';

  document.querySelectorAll('[data-project-token]').forEach((el) => { el.textContent = projToken; });
  document.querySelectorAll('[data-skills-token]').forEach((el) => { el.textContent = skillsToken; });

  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify({
      projectId: projectVal ?? (projectInputs[0]?.value || ''),
      skillsUrl: skillsVal ?? (skillsInputs[0]?.value || '')
    }));
  } catch (_) {}
}

try {
  const savedParams = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}');
  if (savedParams.projectId || savedParams.skillsUrl) {
    syncSharedParams(savedParams.projectId || '', savedParams.skillsUrl || '');
  }
} catch (_) {}

projectInputs.forEach((inp) => {
  inp.addEventListener('input', () => syncSharedParams(inp.value, null, inp));
});
skillsInputs.forEach((inp) => {
  inp.addEventListener('input', () => syncSharedParams(null, inp.value, inp));
});

// Copy-to-Clipboard
async function copyWithFeedback(btn, text) {
  const strings = UI_STRINGS[currentLang];
  const prev = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  btn.textContent = strings.copied;
  setTimeout(() => { btn.textContent = prev === strings.copied ? strings.copy : prev; }, 1600);
}

document.querySelectorAll('[data-copy-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pre = document.getElementById(btn.dataset.copyTarget);
    if (pre) copyWithFeedback(btn, pre.innerText.trim());
  });
});

// ============================================================================
// 7. Interactive Agent Skills Inspector Modal & Screenshot Lightbox
// ============================================================================
const inspectorDialog = document.getElementById('inspector-dialog');
const skillTitleEl = document.getElementById('skill-modal-title');
const skillMetaEl = document.getElementById('skill-modal-meta');
const skillRenderedEl = document.getElementById('skill-rendered-view');
const skillRawEl = document.getElementById('skill-raw-view');
const skillRawCodeEl = document.getElementById('skill-raw-code');
const skillRawLinkEl = document.getElementById('skill-raw-link');
const skillToggleRawBtn = document.getElementById('skill-toggle-raw');
const skillCopyBtn = document.getElementById('skill-copy-btn');
const skillDownloadBtn = document.getElementById('skill-download-btn');

let activeSkillKey = 'maps';
let isSkillRaw = false;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdownPreview(md) {
  const lines = md.split('\n');
  const out = [];
  let inCode = false;
  let inList = false;
  const inline = (t) => escapeHtml(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(inCode ? '</code></pre>' : '<pre style="background:#14171c;color:#f1f5f9;padding:0.85rem;border-radius:8px;overflow-x:auto;font-size:0.8rem;"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line) + '\n');
      continue;
    }
    if (/^###\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3 style="margin-top:1rem;margin-bottom:0.35rem;">${inline(line.replace(/^###\s+/, ''))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2 style="font-size:1.15rem;margin-top:1.15rem;margin-bottom:0.4rem;">${inline(line.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2 style="font-size:1.25rem;margin-bottom:0.5rem;">${inline(line.replace(/^#\s+/, ''))}</h2>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul style="padding-left:1.25rem;margin-bottom:0.65rem;">'); inList = true; }
      out.push(`<li style="margin-bottom:0.25rem;">${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '' || /^---+$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p style="margin-bottom:0.55rem;color:#374151;">${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

function loadSkillInModal(key) {
  const skills = window.LAB_AGENT_SKILLS || {};
  const entry = skills[key] || skills.maps;
  if (!entry) return;
  activeSkillKey = key;
  if (skillTitleEl) skillTitleEl.textContent = `${entry.slug} — ${entry.title}`;
  if (skillMetaEl) skillMetaEl.textContent = `${entry.path} • ${entry.lines} lines • ${entry.sizeKb} KB • Active in ${entry.stages}`;
  if (skillRawLinkEl) skillRawLinkEl.href = entry.path;
  if (skillRawCodeEl) skillRawCodeEl.textContent = entry.markdown;
  if (skillRenderedEl) skillRenderedEl.innerHTML = renderMarkdownPreview(entry.markdown);

  document.querySelectorAll('[data-skill-tab]').forEach((btn) => {
    btn.classList.toggle('btn-primary', btn.dataset.skillTab === key);
  });
}

document.querySelectorAll('[data-skill-tab]').forEach((btn) => {
  btn.addEventListener('click', () => loadSkillInModal(btn.dataset.skillTab));
});

document.querySelectorAll('[data-open-skill]').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadSkillInModal(btn.dataset.openSkill);
    if (inspectorDialog && !inspectorDialog.open) inspectorDialog.showModal();
  });
});

skillToggleRawBtn?.addEventListener('click', () => {
  isSkillRaw = !isSkillRaw;
  skillToggleRawBtn.setAttribute('aria-pressed', String(isSkillRaw));
  skillToggleRawBtn.textContent = isSkillRaw ? UI_STRINGS[currentLang].viewFormatted : UI_STRINGS[currentLang].viewRaw;
  if (skillRenderedEl) skillRenderedEl.hidden = isSkillRaw;
  if (skillRawEl) skillRawEl.hidden = !isSkillRaw;
});

skillCopyBtn?.addEventListener('click', () => {
  const entry = window.LAB_AGENT_SKILLS?.[activeSkillKey];
  if (entry) copyWithFeedback(skillCopyBtn, entry.markdown);
});

skillDownloadBtn?.addEventListener('click', () => {
  const entry = window.LAB_AGENT_SKILLS?.[activeSkillKey];
  if (!entry) return;
  const blob = new Blob([entry.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = entry.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Screenshot Click-to-Zoom Lightbox
const lightboxDialog = document.getElementById('lightbox-dialog');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxImg = document.getElementById('lightbox-img');

document.querySelectorAll('.zoom-trigger').forEach((btn) => {
  btn.addEventListener('click', () => {
    const src = btn.dataset.zoomSrc;
    const caption = currentLang === 'ja'
      ? (btn.dataset.zoomJa || btn.dataset.zoomEn || 'スクリーンショット拡大表示')
      : (btn.dataset.zoomEn || btn.dataset.zoomJa || 'Screenshot Preview');
    if (!src || !lightboxDialog) return;
    lightboxImg.src = src;
    lightboxImg.alt = caption;
    lightboxTitle.textContent = caption;
    lightboxDialog.showModal();
  });
});

// ============================================================================
// 8. Boot Initial View & Language
// ============================================================================
loadSkillInModal('maps');
applyLanguage(currentLang);
applyStageDOM(getStageFromHash());
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
if (!showAllStages && window.location.hash) {
  window.scrollTo({ top: 0, behavior: 'instant' });
  window.addEventListener('load', () => {
    if (!showAllStages) window.scrollTo({ top: 0, behavior: 'instant' });
  }, { once: true });
}
