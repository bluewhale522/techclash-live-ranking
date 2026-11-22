/**
 * TECH CLASH: FINALE 2026 - UI CONTROLLER, 90S TIMER & REAL-TIME SYNC
 */

(function() {
  const Engine = window.TechClashEngine;
  const STORAGE_KEY = 'TECHCLASH_2026_VONG2_DEMO_V2';
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('techclash_2026_vong2_channel') : null;
  const API_BASE = (typeof window !== 'undefined' && window.location.protocol.startsWith('http'))
    ? ''
    : 'http://127.0.0.1:8088';

  let state = loadState();
  let activeTab = 'ranking'; // 'ranking' | 'referee' | 'schedule' | 'teams'
  let bracketFilter = 'split'; // 'split' | 'A' | 'B'
  let scheduleFilter = 'all'; // 'all' | 'A' | 'B' | 'pending'
  let selectedMatchId = null;
  let autoRotateTimer = null;
  let liveSimTimer = null;
  let scoringUnlocked = false;

  // Đồng hồ thi đấu 90s (hoặc 30s chuẩn bị)
  let timerState = {
    mode: 'match', // 'prep' (30s) | 'match' (90s)
    totalSec: 90,
    remainingSec: 90,
    running: false,
    intervalId: null,
    alerted40s: false,
    alerted50s: false
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.teams) && Array.isArray(parsed.matches)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not load saved state:', e);
    }
    const teams = JSON.parse(JSON.stringify(Engine.INITIAL_TEAMS));
    const matches = Engine.generateInterleavedSchedule(teams, false);
    Engine.populateDemoMatches(matches, 'mid');
    return {
      config: { ...Engine.DEFAULT_CONFIG },
      teams,
      matches,
      lastUpdated: new Date().toISOString()
    };
  }

  function saveState(broadcast = true, syncCloud = false) {
    state.lastUpdated = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Save localStorage error:', e);
    }
    if (broadcast && bc) {
      bc.postMessage({ type: 'STATE_UPDATED', state, timerState: getSerializableTimer() });
    }
    if (broadcast && typeof window !== 'undefined') {
      fetch(API_BASE + '/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      }).catch(() => {});
    }
    if (syncCloud && state.config.appsScriptUrl) {
      pushStateToAppsScript();
    }
    renderAll();
  }

  function getSerializableTimer() {
    return {
      mode: timerState.mode,
      totalSec: timerState.totalSec,
      remainingSec: timerState.remainingSec,
      running: timerState.running
    };
  }

  if (bc) {
    bc.onmessage = (ev) => {
      if (!ev.data) return;
      if (ev.data.type === 'STATE_UPDATED' && ev.data.state) {
        state = ev.data.state;
        if (ev.data.timerState && !timerState.running) {
          timerState.mode = ev.data.timerState.mode;
          timerState.totalSec = ev.data.timerState.totalSec;
          timerState.remainingSec = ev.data.timerState.remainingSec;
        }
        renderAll();
      } else if (ev.data.type === 'TIMER_TICK' && ev.data.timerState) {
        if (!timerState.intervalId) {
          timerState.mode = ev.data.timerState.mode;
          timerState.totalSec = ev.data.timerState.totalSec;
          timerState.remainingSec = ev.data.timerState.remainingSec;
          timerState.running = ev.data.timerState.running;
          updateTimerDOMOnly();
        }
      }
    };
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY && ev.newValue) {
      try {
        state = JSON.parse(ev.newValue);
        renderAll();
      } catch (e) {}
    }
  });

  // Đồng bộ đa thiết bị qua Server (SSE + REST)
  if (typeof window !== 'undefined') {
    fetch(API_BASE + '/api/state?_t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(res => {
        if (res && res.state) {
          state = res.state;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } else {
          fetch(API_BASE + '/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state })
          }).catch(() => {});
        }
        if (res && res.timerState && !timerState.running) {
          timerState.mode = res.timerState.mode;
          timerState.totalSec = res.timerState.totalSec;
          timerState.remainingSec = res.timerState.remainingSec;
          timerState.running = res.timerState.running;
        }
        renderAll();
      })
      .catch(() => {});

    try {
      const es = new EventSource(API_BASE + '/api/stream');
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if ((data.type === 'INIT' || data.type === 'STATE_UPDATED') && data.state) {
            state = data.state;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            renderAll();
          } else if (data.type === 'TIMER_TICK' && data.timerState) {
            if (!timerState.intervalId) {
              timerState.mode = data.timerState.mode;
              timerState.totalSec = data.timerState.totalSec;
              timerState.remainingSec = data.timerState.remainingSec;
              timerState.running = data.timerState.running;
              if (timerState.remainingSec <= 0) scoringUnlocked = true;
              updateTimerDOMOnly();
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  // ==================== ÂM THANH CÒI & CẢNH BÁO 40s-50s (WEB AUDIO API) ====================
  function playSound(type) {
    if (state.config && state.config.transitionSound === false) return;
    if (window.VexIQSound) {
      if (type === 'start') { window.VexIQSound.playStart(); return; }
      if (type === 'tablet_swap') { window.VexIQSound.playSwitchHorn(); return; }
      if (type === 'end') { window.VexIQSound.playEndBuzzer(); return; }
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      if (type === 'start') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          g.gain.setValueAtTime(0.18, now + i * 0.09);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(now + i * 0.09);
          osc.stop(now + i * 0.09 + 0.24);
        });
      } else if (type === 'tablet_swap') {
        // Tiếng chuông kép báo hiệu khung 40s-50s BẮT BUỘC ĐỔI TABLET
        [880, 1174.66, 880, 1174.66].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          g.gain.setValueAtTime(0.16, now + i * 0.14);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.12);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(now + i * 0.14);
          osc.stop(now + i * 0.14 + 0.13);
        });
      } else if (type === 'end') {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(220, now + 0.85);
        g.gain.setValueAtTime(0.28, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.95);
      }
    } catch (e) {}
  }

  // ==================== ĐIỀU KHIỂN ĐỒNG HỒ 90S / 30S ====================
  function setTimerMode(mode) {
    stopTimer();
    timerState.mode = mode;
    timerState.totalSec = mode === 'prep' ? 30 : 90;
    timerState.remainingSec = timerState.totalSec;
    timerState.alerted40s = false;
    timerState.alerted50s = false;
    fetch(API_BASE + '/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mode', mode })
    }).catch(() => {});
    broadcastTimer();
    renderAll();
  }

  function toggleTimer() {
    const nextAction = timerState.running ? 'pause' : 'start';
    fetch(API_BASE + '/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: nextAction })
    }).catch(() => {});
    if (timerState.running) {
      stopTimer();
    } else {
      if (timerState.remainingSec <= 0) {
        timerState.remainingSec = timerState.totalSec;
      }
      timerState.running = true;
      playSound('start');
      if (window.VexIQSound && (!state.config || state.config.transitionSound !== false)) {
        window.VexIQSound.startBgMusic();
      }
      timerState.intervalId = setInterval(() => {
        if (timerState.remainingSec > 0) {
          timerState.remainingSec--;
          const rem = timerState.remainingSec;
          const elapsed = timerState.totalSec - rem;

          // Phát âm thanh VEX IQ Competition cho từng giây (50s->41s: Ten..One, 40s: Switch Horn, 10s->1s: Ten..One, 0s: End Buzzer, các giây khác: VEX Tick)
          if (window.VexIQSound && (!state.config || state.config.transitionSound !== false)) {
            window.VexIQSound.onTimerSecond(rem, timerState.mode);
          }

          // Ở chế độ 90s: Giây thứ 40 (còn 50s) bắt đầu khung chuyển giao Tablet
          if (timerState.mode === 'match' && elapsed === 40 && !timerState.alerted40s) {
            timerState.alerted40s = true;
            showToast('50s -> 40s: Đếm ngược VEX IQ (Ten, Nine, Eight... One) chuyển giao Tablet!', 'warning');
          }
          // Giây thứ 50 (còn 40s) kết thúc khung chuyển giao Tablet
          if (timerState.mode === 'match' && elapsed === 50 && !timerState.alerted50s) {
            timerState.alerted50s = true;
            showToast('40s (SWITCH!): HẾT KHUNG ĐỔI TABLET! (Đội chưa đổi = -5đ)', 'warning');
          }
          if (rem <= 0) {
            stopTimer();
            scoringUnlocked = true;
            showToast('ĐÃ HẾT GIỜ THI ĐẤU! Đã mở khóa bảng điền điểm cho Trọng tài!', 'success');
            renderAll();
            return;
          }
          broadcastTimer();
          updateTimerDOMOnly();
        } else {
          stopTimer();
          scoringUnlocked = true;
          playSound('end');
          showToast('ĐÃ HẾT GIỜ THI ĐẤU! Đã mở khóa bảng điền điểm cho Trọng tài!', 'success');
          renderAll();
        }
      }, 1000);
    }
    broadcastTimer();
    updateTimerDOMOnly();
  }

  function stopTimer() {
    timerState.running = false;
    if (window.VexIQSound) {
      window.VexIQSound.stopBgMusic();
    }
    if (timerState.intervalId) {
      clearInterval(timerState.intervalId);
      timerState.intervalId = null;
    }
    broadcastTimer();
    updateTimerDOMOnly();
  }

  function broadcastTimer() {
    if (bc) {
      bc.postMessage({ type: 'TIMER_TICK', timerState: getSerializableTimer() });
    }
  }

  function formatSec(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function getTimerPhaseInfo() {
    if (timerState.mode === 'prep') {
      return {
        label: '30 GIÂY CHUẨN BỊ & KIỂM TRA ROBOT',
        colorClass: 'phase-prep',
        sub: 'Đặt robot vào đúng vị trí Khu vực xuất phát'
      };
    }
    const elapsed = 90 - timerState.remainingSec;
    if (elapsed < 40) {
      return {
        label: 'LƯỢT THÀNH VIÊN 1 ĐIỀU KHIỂN (00s – 40s)',
        colorClass: 'phase-p1',
        sub: 'Còn ' + (40 - elapsed) + 's nữa đến khung chuyển giao Tablet'
      };
    } else if (elapsed <= 50) {
      const remSwap = timerState.remainingSec - 40;
      const swapMap = { 10:'TEN (10)', 9:'NINE (9)', 8:'EIGHT (8)', 7:'SEVEN (7)', 6:'SIX (6)', 5:'FIVE (5)', 4:'FOUR (4)', 3:'THREE (3)', 2:'TWO (2)', 1:'ONE (1)', 0:'SWITCH!' };
      const cw = swapMap[remSwap] || '';
      return {
        label: 'BẮT BUỘC ĐỔI TABLET (50s – 40s): ' + cw,
        colorClass: 'phase-swap',
        sub: 'Đang phát giọng đếm ngược VEX IQ (Ten..One -> Switch) • Không đổi bị TRỪ 5 ĐIỂM (-5đ)!'
      };
    } else {
      return {
        label: 'LƯỢT THÀNH VIÊN 2 ĐIỀU KHIỂN & VỀ ĐÍCH (50s – 90s)',
        colorClass: 'phase-p2',
        sub: 'Đưa Khối đặc biệt về đích (+10đ) & Dừng đỗ hoàn toàn trong ô Xuất phát (+5đ)'
      };
    }
  }

  function updateTimerDOMOnly() {
    const timeEls = document.querySelectorAll('.js-timer-display');
    const phaseEls = document.querySelectorAll('.js-timer-phase');
    const subEls = document.querySelectorAll('.js-timer-sub');
    const btnEls = document.querySelectorAll('.js-timer-toggle-btn');

    const phase = getTimerPhaseInfo();
    timeEls.forEach(el => {
      el.textContent = formatSec(timerState.remainingSec);
      el.className = 'js-timer-display timer-digits ' + phase.colorClass;
    });
    phaseEls.forEach(el => {
      el.textContent = phase.label;
      el.className = 'js-timer-phase timer-phase-badge ' + phase.colorClass;
    });
    subEls.forEach(el => {
      el.textContent = phase.sub;
    });
    btnEls.forEach(el => {
      el.innerHTML = timerState.running ? '⏸ Tạm dừng' : '▶ Bắt đầu bấm giờ';
      el.className = 'js-timer-toggle-btn btn ' + (timerState.running ? 'btn-amber' : 'btn-emerald');
    });
  }

  // ==================== TRUY VẤN DỮ LIỆU ĐỘI & TRẬN ====================
  function getTeamById(id) {
    return state.teams.find(t => t.id === id) || {
      id, code: id, className: id, student1: 'HS 1', student2: 'HS 2', bracket: 'A'
    };
  }

  function getCurrentLiveMatch() {
    let m = state.matches.find(x => x.status === 'live');
    if (!m) m = state.matches.find(x => x.status === 'pending');
    if (!m && state.matches.length > 0) m = state.matches[state.matches.length - 1];
    return m || null;
  }

  function getSelectedMatch() {
    if (selectedMatchId) {
      const found = state.matches.find(x => x.id === selectedMatchId);
      if (found) return found;
    }
    const live = getCurrentLiveMatch();
    if (live) {
      selectedMatchId = live.id;
      return live;
    }
    return state.matches[0] || null;
  }

  // ==================== THAO TÁC CHẤM ĐIỂM & LỊCH THI ĐẤU ====================
  function selectMatchForScoring(matchId, switchTab = true) {
    selectedMatchId = matchId;
    if (switchTab) activeTab = 'referee';
    renderAll();
  }

  function setMatchLiveOnArena(matchId) {
    state.matches.forEach(m => {
      if (m.status === 'live' && m.id !== matchId) {
        // Nếu trận trước đang live mà chưa có điểm thì trả về pending
        if (m.redScore === null && m.blueScore === null) {
          m.status = 'pending';
        } else {
          m.status = 'completed';
        }
      }
    });
    const target = state.matches.find(m => m.id === matchId);
    if (target) {
      target.status = 'live';
      selectedMatchId = target.id;
      scoringUnlocked = false;
      const rT = getTeamById(target.redTeamId);
      const bT = getTeamById(target.blueTeamId);
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      state.config.transitionTrigger = {
        id: Date.now(),
        title: `TRẬN #${target.matchNumber} • BẢNG ${target.bracket}`,
        subtitle: `ĐỎ: ${rT.className} vs XANH: ${bT.className}`
      };
      if (state.config.transitionSound !== false && window.TCApp && window.TCApp.playTransitionSFX) {
        window.TCApp.playTransitionSFX();
      }
      setTimerMode('match');
      showToast('Đã đưa Trận #' + target.matchNumber + ' lên OBS + Tự động Đục Lỗ (Giữ khung chữ 2 đội trên đầu)!', 'info');
    }
    saveState(true, true);
  }

  function unlockScoringEarly() {
    stopTimer();
    timerState.remainingSec = 0;
    scoringUnlocked = true;
    fetch(API_BASE + '/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end_early' })
    }).catch(() => {});
    broadcastTimer();
    renderAll();
    showToast('🔓 Đã kết thúc đếm ngược & mở khóa điền điểm cho Trọng tài!', 'info');
  }

  let autoNextAfterResultTimer = null;

  function publishScoreToOBSScreen(matchId) {
    const idx = state.matches.findIndex(x => x.id === matchId);
    if (idx === -1) return;
    const m = state.matches[idx];
    m.redScore = Engine.calculateSheetScore(m.redSheet, m.bracket);
    m.blueScore = Engine.calculateSheetScore(m.blueSheet, m.bracket);
    m.status = 'completed';
    m.completedAt = new Date().toISOString();

    stopTimer();
    timerState.remainingSec = 0;
    fetch(API_BASE + '/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end_early' })
    }).catch(() => {});
    state.config.lastRevealedMatchId = m.id;
    state.config.obsMainView = 'result';

    saveState(true, true);
    showToast('🚀 ĐÃ CHỐT & HIỂN THỊ ĐIỂM TRẬN #' + m.matchNumber + ' (Tự động chuyển sang trận tiếp theo sau 10 giây...)', 'success');

    if (autoNextAfterResultTimer) clearTimeout(autoNextAfterResultTimer);
    autoNextAfterResultTimer = setTimeout(() => {
      autoNextAfterResultTimer = null;
      advanceToNextRoundOnArena(matchId);
    }, 10000);
  }

  function advanceToNextRoundOnArena(matchId) {
    if (autoNextAfterResultTimer) {
      clearTimeout(autoNextAfterResultTimer);
      autoNextAfterResultTimer = null;
    }
    const idx = state.matches.findIndex(x => x.id === matchId);
    if (idx !== -1 && state.matches[idx].status === 'live') {
      // Nếu chưa bấm chốt thì tự chốt trước khi qua trận
      const cur = state.matches[idx];
      cur.redScore = Engine.calculateSheetScore(cur.redSheet, cur.bracket);
      cur.blueScore = Engine.calculateSheetScore(cur.blueSheet, cur.bracket);
      cur.status = 'completed';
      cur.completedAt = new Date().toISOString();
    }
    stopTimer();
    scoringUnlocked = false;

    const nextPending = state.matches.find((x, i) => i > idx && x.status === 'pending') ||
                        state.matches.find(x => x.status === 'pending');
    if (nextPending) {
      nextPending.status = 'live';
      selectedMatchId = nextPending.id;
      const rT = getTeamById(nextPending.redTeamId);
      const bT = getTeamById(nextPending.blueTeamId);
      // Tự động bật chế độ Đục Lỗ (Chroma Key / Camera) + Giữ khung chữ trên đầu của mỗi trận, không để BXH che mất Video
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      state.config.transitionTrigger = {
        id: Date.now(),
        title: `NEXT ROUND • TRẬN #${nextPending.matchNumber} (BẢNG ${nextPending.bracket})`,
        subtitle: `SÂN ĐỎ: ${rT.className} vs SÂN XANH: ${bT.className}`
      };
      if (state.config.transitionSound !== false && window.TCApp && window.TCApp.playTransitionSFX) {
        window.TCApp.playTransitionSFX();
      }
      setTimerMode('match');
      showToast('Đã qua NEXT ROUND (Trận #' + nextPending.matchNumber + ') • Tự động Đục Lỗ + Giữ khung chữ trên đầu!', 'success');
    } else {
      state.config.obsMainView = 'ranking_A';
      showToast('Đã hoàn thành toàn bộ 31/31 trận! Đang hiển thị Bảng Xếp Hạng trên OBS!', 'success');
    }
    saveState(true, true);
  }

  function updateScoreField(matchId, side, field, deltaOrVal, isToggle = false, isDirectValue = false) {
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;
    const sheet = side === 'red' ? m.redSheet : m.blueSheet;
    if (!sheet) return;

    if (isDirectValue) {
      sheet[field] = deltaOrVal === '' ? null : Number(deltaOrVal);
    } else if (isToggle) {
      if (field === 'forceSpecial') {
        sheet.forceSpecial = !sheet.forceSpecial;
      } else {
        sheet[field] = sheet[field] > 0 ? 0 : 1;
      }
      sheet.manualOverride = null;
    } else {
      const nextVal = Math.max(0, Number(sheet[field] || 0) + Number(deltaOrVal));
      sheet[field] = nextVal;
      sheet.manualOverride = null;
    }

    // Tự động tính lại điểm real-time khi trận đang diễn ra hoặc đã chấm
    m.redScore = Engine.calculateSheetScore(m.redSheet, m.bracket);
    m.blueScore = Engine.calculateSheetScore(m.blueSheet, m.bracket);
    saveState(true, false);
  }

  function completeCurrentMatchAndAdvance(matchId) {
    const idx = state.matches.findIndex(x => x.id === matchId);
    if (idx === -1) return;
    const m = state.matches[idx];
    m.redScore = Engine.calculateSheetScore(m.redSheet, m.bracket);
    m.blueScore = Engine.calculateSheetScore(m.blueSheet, m.bracket);
    m.status = 'completed';
    m.completedAt = new Date().toISOString();

    stopTimer();
    setTimerMode('match');

    // Tìm trận pending tiếp theo để đưa lên Live
    const nextPending = state.matches.find((x, i) => i > idx && x.status === 'pending') ||
                        state.matches.find(x => x.status === 'pending');
    if (nextPending) {
      nextPending.status = 'live';
      selectedMatchId = nextPending.id;
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      showToast('Đã lưu điểm Trận #' + m.matchNumber + '! Chuyển sang Trận #' + nextPending.matchNumber + ' (Tự động Đục Lỗ + Giữ khung chữ trên đầu).', 'success');
    } else {
      showToast('Đã hoàn thành toàn bộ các trận đấu Vòng 2!', 'success');
    }

    saveState(true, true);
  }

  function redrawSchedule(keepCompleted = false) {
    if (!keepCompleted) {
      const hasScores = state.matches.some(m => m.status === 'completed');
      if (hasScores && !confirm('Bạn có chắc muốn bốc thăm lại toàn bộ lịch thi đấu mới? (Điểm các trận đã chấm sẽ được đặt lại về 0)')) {
        return;
      }
      state.matches = Engine.generateInterleavedSchedule(state.teams, true);
      if (state.matches.length > 0) {
        state.matches[0].status = 'live';
        selectedMatchId = state.matches[0].id;
      }
      saveState(true, true);
      showToast('🎲 Đã bốc thăm lịch thi đấu ngẫu nhiên mới (Xen kẽ A-B, 0 trùng cặp, cách xa lượt)!', 'success');
    }
  }

  // ==================== ĐỒNG BỘ TRỰC TIẾP VỚI 2 FILE GOOGLE SHEET ====================
  async function syncFromDSVong1Sheet() {
    try {
      showToast('⏳ Đang đọc tab "DS - HS vượt qua vòng 1" từ Google Sheet...', 'info');
      const table = await Engine.fetchGoogleSheetJSONP(state.config.yearEndSheetId, 'DS - HS vượt qua vòng 1');
      const rows = table.rows || [];
      let updatedCount = 0;

      for (let r = 0; r < rows.length - 1; r++) {
        const c = rows[r].c || [];
        const cNext = (rows[r + 1] && rows[r + 1].c) ? rows[r + 1].c : [];

        // Bảng A (Junior): Cột A (0) = Đội X, Cột B (1) = Tên lớp, Cột F (5) = LEC, Cột G (6) = Tên HS 1 & 2
        const labelA = c[0] && (c[0].f || c[0].v) ? String(c[0].f || c[0].v).trim() : '';
        const classA = c[1] && (c[1].f || c[1].v) ? String(c[1].f || c[1].v).trim() : '';
        const lecA = c[5] && (c[5].f || c[5].v) ? String(c[5].f || c[5].v).trim() : '';
        const hs1A = c[6] && (c[6].f || c[6].v) ? String(c[6].f || c[6].v).trim() : '';
        const hs2A = cNext[6] && (cNext[6].f || cNext[6].v) ? String(cNext[6].f || cNext[6].v).trim() : '';

        if (labelA.startsWith('Đội') && classA) {
          const teamA = state.teams.find(t => t.bracket === 'A' && t.className.toUpperCase() === classA.toUpperCase());
          if (teamA) {
            if (lecA) teamA.lec = lecA;
            if (hs1A && classA !== 'TN-ROB-ARMI06') teamA.student1 = hs1A.replace(/^NNguyễn/, 'Nguyễn');
            if (hs2A && classA !== 'TN-ROB-ARMI06') teamA.student2 = hs2A;
            updatedCount++;
          }
        }

        // Bảng B (Teen): Cột L (11) = Đội X, Cột M (12) = Tên lớp, Cột Q (16) = LEC, Cột R (17) = Tên HS 1 & 2
        const labelB = c[11] && (c[11].f || c[11].v) ? String(c[11].f || c[11].v).trim() : '';
        const classB = c[12] && (c[12].f || c[12].v) ? String(c[12].f || c[12].v).trim() : '';
        const lecB = c[16] && (c[16].f || c[16].v) ? String(c[16].f || c[16].v).trim() : '';
        const hs1B = c[17] && (c[17].f || c[17].v) ? String(c[17].f || c[17].v).trim() : '';
        const hs2B = cNext[17] && (cNext[17].f || cNext[17].v) ? String(cNext[17].f || cNext[17].v).trim() : '';

        if (labelB.startsWith('Đội') && classB) {
          const teamB = state.teams.find(t => t.bracket === 'B' && t.className.toUpperCase() === classB.toUpperCase());
          if (teamB) {
            if (lecB) teamB.lec = lecB;
            if (hs1B) teamB.student1 = hs1B;
            if (hs2B) teamB.student2 = hs2B;
            updatedCount++;
          }
        }
      }

      saveState(true, false);
      showToast('✅ Đã đồng bộ danh sách ' + updatedCount + ' đội từ sheet "DS - HS vượt qua vòng 1"!', 'success');
    } catch (err) {
      showToast('⚠️ Lỗi khi đọc sheet DS Vòng 1: ' + err.message, 'error');
    }
  }

  async function syncAll30ClassesFromVong1Form() {
    const btn = document.getElementById('btn-sync-vong1');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Đang quét 30 lớp từ Sheet Vòng 1...';
    }
    showToast('🔍 Đang quét toàn bộ 30 tab lớp trong file FORM CHẤM ĐIỂM VÒNG 1...', 'info');

    let updatedTeams = 0;
    for (let i = 0; i < state.teams.length; i++) {
      const team = state.teams[i];
      try {
        const res = await Engine.fetchClassTopStudentsFromVong1(state.config.vong1SheetId, team.className);
        if (res.top1 && res.top1.name) {
          team.student1 = res.top1.name;
          team.v1Score1 = res.top1.score || 0;
          if (res.top2 && res.top2.name) {
            team.student2 = res.top2.name;
            team.v1Score2 = res.top2.score || 0;
          }
          team.v1Avg = Number((((team.v1Score1 || 0) + (team.v1Score2 || 0)) / 2).toFixed(2));
          updatedTeams++;
        }
      } catch (e) {
        // Tab lớp chưa có hoặc chưa public
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '⚡ Quét tự động Top 2 từ Sheet Chấm Điểm Vòng 1';
    }
    saveState(true, true);
    showToast('✅ Đã tự động cập nhật Top 2 học sinh & Điểm hạt giống từ ' + updatedTeams + ' đội đã có điểm Vòng 1!', 'success');
  }

  async function pushStateToAppsScript() {
    if (!state.config.appsScriptUrl) return;
    try {
      const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);
      const richMatches = state.matches.map(m => {
        const rT = getTeamById(m.redTeamId);
        const bT = getTeamById(m.blueTeamId);
        return {
          ...m,
          redClassName: rT.className,
          redStudents: rT.student1 + ' & ' + rT.student2,
          blueClassName: bT.className,
          blueStudents: bT.student1 + ' & ' + bT.student2
        };
      });
      await fetch(state.config.appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveState',
          state: { rankings: standings, matches: richMatches }
        })
      });
    } catch (e) {
      console.warn('Cloud sync warning:', e);
    }
  }

  // ==================== XUẤT FILE CSV / EXCEL CHO GOOGLE SHEETS ====================
  function exportScheduleAndRankingCSV() {
    const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);
    let csv = '\uFEFF';
    csv += 'BẢNG XẾP HẠNG LIVE - TECH CLASH: FINALE 2026 (VÒNG 2 - ĐỒNG ĐỘI)\n';
    csv += 'Bảng,Hạng,Mã Đội,Lớp Đại Diện,Học Sinh 1,Học Sinh 2,GV (LEC),Điểm Hạt Giống V1,Điểm Lượt 1,Điểm Lượt 2,Tổng Điểm Vòng 2,Trung Bình Vòng 2\n';

    ['A', 'B'].forEach(b => {
      standings[b].forEach(item => {
        csv += [
          b === 'A' ? 'Bảng A - Junior Coder (VEX GO)' : 'Bảng B - Teen Coder (VEX IQ)',
          item.rank,
          item.code,
          item.className,
          `"${item.student1}"`,
          `"${item.student2}"`,
          `"${item.lec || ''}"`,
          item.v1Avg || 0,
          item.turn1Score !== null ? item.turn1Score : '',
          item.turn2Score !== null ? item.turn2Score : '',
          item.totalScore,
          item.avgScore
        ].join(',') + '\n';
      });
    });

    csv += '\nLỊCH THI ĐẤU XEN KẼ BẢNG A & BẢNG B (01 SA BÀN)\n';
    csv += 'Trận #,Vòng Lượt,Bảng Đấu,Trạng Thái,Đội Sân Đỏ (Trái),2 Học Sinh Sân Đỏ,Điểm Sân Đỏ,Đội Sân Xanh (Phải),2 Học Sinh Sân Xanh,Điểm Sân Xanh\n';

    state.matches.forEach(m => {
      const rT = getTeamById(m.redTeamId);
      const bT = getTeamById(m.blueTeamId);
      csv += [
        m.matchNumber,
        'Lượt ' + m.wave,
        m.bracket === 'A' ? 'Bảng A (Junior)' : 'Bảng B (Teen)',
        m.status === 'completed' ? 'Đã hoàn thành' : (m.status === 'live' ? 'Đang thi đấu' : 'Chưa thi'),
        rT.className,
        `"${rT.student1} & ${rT.student2}"`,
        m.redScore !== null ? m.redScore : '',
        bT.className,
        `"${bT.student1} & ${bT.student2}"`,
        m.blueScore !== null ? m.blueScore : ''
      ].join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TECHCLASH_2026_VONG2_LIVE_RANKING.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 Đã tải xuống file CSV Bảng Xếp Hạng & Lịch Thi Đấu Vòng 2!', 'success');
  }

  // ==================== XUẤT FILE EXCEL (.XLS CÓ BẢNG MÀU) & PDF GỬI PHỤ HUYNH ====================
  function exportExcelWorkbook() {
    const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"><style>
        table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center; }
        .title { background: #0f172a; color: #ffffff; font-size: 14pt; font-weight: bold; }
        .head-a { background: #d97706; color: #ffffff; font-weight: bold; }
        .head-b { background: #0284c7; color: #ffffff; font-weight: bold; }
        .head-m { background: #1e293b; color: #ffffff; font-weight: bold; }
        .top1 { background: #fef3c7; font-weight: bold; }
        .top2 { background: #f1f5f9; font-weight: bold; }
        .top3 { background: #ffedd5; font-weight: bold; }
      </style></head><body>
      <table>
        <tr><td colspan="10" class="title">BẢNG XẾP HẠNG CHUNG KẾT VÒNG 2 — TECH CLASH: FINALE 2026 (MINDX)</td></tr>
        <tr>
          <th class="head-a">Bảng Đấu</th><th class="head-a">Hạng</th><th class="head-a">Mã Đội</th>
          <th class="head-a">Lớp Đại Diện</th><th class="head-a">Học Sinh 1</th><th class="head-a">Học Sinh 2</th>
          <th class="head-a">GV (LEC)</th><th class="head-a">Điểm Lượt 1</th><th class="head-a">Điểm Lượt 2</th>
          <th class="head-a">TỔNG ĐIỂM VÒNG 2</th>
        </tr>
    `;

    ['A', 'B'].forEach(b => {
      standings[b].forEach(item => {
        const cls = item.rank === 1 ? 'top1' : (item.rank === 2 ? 'top2' : (item.rank === 3 ? 'top3' : ''));
        html += `<tr class="${cls}">
          <td>${b === 'A' ? 'Bảng A - Junior (VEX GO)' : 'Bảng B - Teen (VEX IQ)'}</td>
          <td>${item.rank}</td>
          <td>${item.code}</td>
          <td><b>${item.className}</b></td>
          <td>${item.student1}</td>
          <td>${item.student2}</td>
          <td>${item.lec || ''}</td>
          <td>${item.turn1Score !== null ? item.turn1Score : '—'}</td>
          <td>${item.turn2Score !== null ? item.turn2Score : '—'}</td>
          <td><b>${item.totalScore}</b></td>
        </tr>`;
      });
    });

    html += `
        <tr><td colspan="10"></td></tr>
        <tr><td colspan="14" class="title">CHI TIẾT CHẤM ĐIỂM TỪNG TRẬN VÒNG 2 (31 TRẬN XEN KẼ BẢNG A & BẢNG B)</td></tr>
        <tr>
          <th class="head-m">Trận #</th><th class="head-m">Lượt</th><th class="head-m">Bảng</th>
          <th class="head-m">Đội Sân Đỏ (Trái)</th><th class="head-m">2 Học Sinh Đỏ</th>
          <th class="head-m">Chi Tiết Cốc Đỏ</th><th class="head-m">Điểm Đỏ</th>
          <th class="head-m">Điểm Xanh</th><th class="head-m">Chi Tiết Cốc Xanh</th>
          <th class="head-m">Đội Sân Xanh (Phải)</th><th class="head-m">2 Học Sinh Xanh</th>
          <th class="head-m">Trạng Thái</th>
        </tr>
    `;

    state.matches.forEach(m => {
      const rT = getTeamById(m.redTeamId);
      const bT = getTeamById(m.blueTeamId);
      const rs = m.redSheet || {};
      const bs = m.blueSheet || {};
      const rDetail = `To:${rs.big||0}, Vừa:${rs.med||0}, Nhỏ:${rs.small||0}, ĐB:${rs.special||0}, Đích:${rs.parked||0}, LỗiTablet:${rs.noTabletSwap||0}`;
      const bDetail = `To:${bs.big||0}, Vừa:${bs.med||0}, Nhỏ:${bs.small||0}, ĐB:${bs.special||0}, Đích:${bs.parked||0}, LỗiTablet:${bs.noTabletSwap||0}`;
      html += `<tr>
        <td>#${m.matchNumber}</td>
        <td>Lượt ${m.wave}</td>
        <td>Bảng ${m.bracket}</td>
        <td><b>${rT.className}</b> (${rT.code})</td>
        <td>${rT.student1} &amp; ${rT.student2}</td>
        <td>${rDetail}</td>
        <td><b>${m.status === 'completed' ? m.redScore : '—'}</b></td>
        <td><b>${m.status === 'completed' ? m.blueScore : '—'}</b></td>
        <td>${bDetail}</td>
        <td><b>${bT.className}</b> (${bT.code})</td>
        <td>${bT.student1} &amp; ${bT.student2}</td>
        <td>${m.status === 'completed' ? 'Đã công bố' : 'Chưa thi'}</td>
      </tr>`;
    });

    html += `</table></body></html>`;
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TECHCLASH_2026_KET_QUA_VONG_2_FULL.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📊 Đã xuất file Excel (.xls) đầy đủ Bảng Xếp Hạng & Chi Tiết 31 Trận!', 'success');
  }

  function exportParentTeamPDF(teamId) {
    const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);
    const allRanked = [...standings.A, ...standings.B];
    const teamStat = allRanked.find(x => x.id === teamId) || getTeamById(teamId);
    const teamMatches = state.matches.filter(m => m.redTeamId === teamId || m.blueTeamId === teamId);

    const win = window.open('', '_blank');
    if (!win) {
      showToast('⚠️ Hãy cho phép mở cửa sổ Pop-up để in/lưu PDF!', 'warning');
      return;
    }

    const matchRowsHtml = teamMatches.map(m => {
      const isRed = m.redTeamId === teamId;
      const myTurn = isRed ? m.redTurn : m.blueTurn;
      const oppTeam = getTeamById(isRed ? m.blueTeamId : m.redTeamId);
      const sheet = (isRed ? m.redSheet : m.blueSheet) || {};
      const myScore = m.status === 'completed' ? (isRed ? m.redScore : m.blueScore) : Engine.calculateSheetScore(sheet, m.bracket);
      const oppScore = m.status === 'completed' ? (isRed ? m.blueScore : m.redScore) : '—';
      const unlocked = (sheet.big > 0 && sheet.med > 0 && sheet.small > 0) || sheet.forceSpecial;

      return `
        <div class="match-box">
          <div class="match-head">
            <span><b>LƯỢT THI ${myTurn}/2 — TRẬN #${m.matchNumber}</b> (${isRed ? '🔴 Sân Đỏ - Bên Trái' : '🔵 Sân Xanh - Bên Phải'})</span>
            <span>Đối thủ cùng lượt: <b>${oppTeam.className}</b> (${oppTeam.student1} &amp; ${oppTeam.student2})</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Khối To (+3đ)</th>
                <th>Khối Vừa (+2đ)</th>
                <th>Khối Nhỏ (+1đ)</th>
                ${teamStat.bracket === 'B' ? '<th>Xếp Chồng Cốc x2</th>' : ''}
                <th>Khối Đặc Biệt (+10đ)</th>
                <th>Về Đích (+5đ)</th>
                <th>Chế Tài Đổi Tablet / Lỗi</th>
                <th>TỔNG ĐIỂM LƯỢT ${myTurn}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>${sheet.big || 0}</b> khối (+${(sheet.big || 0) * 3}đ)</td>
                <td><b>${sheet.med || 0}</b> khối (+${(sheet.med || 0) * 2}đ)</td>
                <td><b>${sheet.small || 0}</b> khối (+${(sheet.small || 0) * 1}đ)</td>
                ${teamStat.bracket === 'B' ? `<td>To:${sheet.stackBig||0} • Vừa:${sheet.stackMed||0} • Nhỏ:${sheet.stackSmall||0} (+${(sheet.stackBig||0)*3+(sheet.stackMed||0)*2+(sheet.stackSmall||0)}đ)</td>` : ''}
                <td>${sheet.special > 0 && unlocked ? '✅ Đạt (+10đ)' : '0đ'}</td>
                <td>${sheet.parked > 0 ? '✅ Đạt (+5đ)' : '0đ'}</td>
                <td style="color:#dc2626;">${sheet.noTabletSwap > 0 ? 'Quên đổi Tablet 40-50s (-5đ)' : '0đ'} ${sheet.otherFouls > 0 ? `(-${sheet.otherFouls}đ)` : ''}</td>
                <td style="font-size:16pt;font-weight:900;color:#0f172a;">${m.status === 'completed' ? myScore + ' điểm' : 'Chưa công bố'}</td>
              </tr>
            </tbody>
          </table>
          <div style="font-size:10pt;color:#475569;margin-top:4px;">
            Tỷ số trận đấu #${m.matchNumber}: <b>${teamStat.className} (${m.status === 'completed' ? myScore : '—'}đ)</b> vs <b>${oppTeam.className} (${oppScore}đ)</b>
          </div>
        </div>
      `;
    }).join('');

    win.document.write(`
      <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
      <title>Phiếu Báo Điểm Vòng 2 - ${teamStat.className}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #0f172a; padding: 28px; max-width: 920px; margin: 0 auto; }
        .header { border-bottom: 3px solid #0284c7; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
        .title { font-size: 18pt; font-weight: 900; color: #0f172a; }
        .sub { font-size: 11pt; color: #475569; margin-top: 4px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .sum-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #f8fafc; text-align: center; }
        .sum-label { font-size: 9.5pt; color: #64748b; text-transform: uppercase; font-weight: bold; }
        .sum-val { font-size: 16pt; font-weight: 900; color: #0284c7; margin-top: 4px; }
        .match-box { border: 1px solid #94a3b8; border-radius: 10px; padding: 14px; margin-bottom: 16px; }
        .match-head { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11pt; border-bottom: 1px dashed #cbd5e1; padding-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: center; }
        th { background: #e2e8f0; font-weight: bold; }
        .no-print { margin-bottom: 16px; text-align: right; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      <div class="no-print">
        <button onclick="window.print()" style="padding:10px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
          🖨 In / Lưu thành File PDF (Gửi Phụ Huynh)
        </button>
      </div>
      <div class="header">
        <div>
          <div class="title">PHIẾU KẾT QUẢ THI ĐẤU CHÍNH THỨC — TECH CLASH: FINALE 2026</div>
          <div class="sub">Vòng 2: Chung Kết Đồng Đội • MindX Tech &amp; AI School</div>
        </div>
        <div style="text-align:right;font-size:10pt;color:#475569;">
          Ngày xuất: ${new Date().toLocaleString('vi-VN')}
        </div>
      </div>

      <div class="summary-grid">
        <div class="sum-card">
          <div class="sum-label">Đội Tuyển / Lớp</div>
          <div class="sum-val" style="color:#0f172a;font-size:13pt;">${teamStat.className} (${teamStat.code})</div>
          <div style="font-size:9.5pt;color:#475569;margin-top:3px;">${teamStat.bracket === 'A' ? 'Bảng A - Junior (VEX GO)' : 'Bảng B - Teen (VEX IQ)'}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">2 Học Sinh Đại Diện</div>
          <div class="sum-val" style="color:#0f172a;font-size:11.5pt;">${teamStat.student1}<br/>${teamStat.student2}</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">Tổng Điểm 2 Lượt Vòng 2</div>
          <div class="sum-val">${teamStat.totalScore || 0} điểm</div>
          <div style="font-size:9.5pt;color:#475569;margin-top:3px;">Trung bình: ${teamStat.avgScore || 0}đ/lượt</div>
        </div>
        <div class="sum-card">
          <div class="sum-label">Thứ Hạng Trong Bảng ${teamStat.bracket}</div>
          <div class="sum-val" style="color:#d97706;">Hạng #${teamStat.rank || '—'}</div>
          <div style="font-size:9.5pt;color:#475569;margin-top:3px;">Hạt giống V1: ${teamStat.v1Avg || 0}đ</div>
        </div>
      </div>

      <h3 style="margin-bottom:10px;">CHI TIẾT ĐIỂM TỪNG HẠNG MỤC TRÊN SA BÀN QUA 2 LƯỢT THI:</h3>
      ${matchRowsHtml}

      <div style="margin-top:24px;font-size:10pt;color:#475569;line-height:1.5;">
        <b>Ghi chú công thức chấm điểm chuẩn Thể lệ Vòng 2:</b><br/>
        • Khối cốc To: <b>+3đ</b> | Khối cốc Vừa: <b>+2đ</b> | Khối cốc Nhỏ: <b>+1đ</b> (Bảng B Teen Coder được nhân đôi x2 các cốc xếp chồng).<br/>
        • Khối Đặc Biệt về khu Xuất phát (khi đã đủ 3 cỡ cốc To, Vừa, Nhỏ): <b>+10đ</b> | Dừng đỗ hoàn toàn trong ô Xuất phát: <b>+5đ</b>.<br/>
        • Chế tài phối hợp đồng đội: Bắt buộc chuyển giao Máy tính bảng giữa 2 học sinh ở giây 40–50 (nếu quên bị trừ <b>-5đ</b>).
      </div>
      </body></html>
    `);
    win.document.close();
  }

  function exportFullPDF() {
    const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);
    const win = window.open('', '_blank');
    if (!win) {
      showToast('⚠️ Hãy cho phép mở cửa sổ Pop-up để lưu PDF!', 'warning');
      return;
    }

    const renderBracketTable = (bCode, list) => `
      <h3>${bCode === 'A' ? '⚡ BẢNG A: JUNIOR CODER (VEX GO - 12 ĐỘI)' : '🔥 BẢNG B: TEEN CODER (VEX IQ - 19 ĐỘI)'}</h3>
      <table>
        <thead>
          <tr><th>Hạng</th><th>Mã Đội</th><th>Lớp Đại Diện</th><th>2 Học Sinh Đại Diện</th><th>GV</th><th>Lượt 1</th><th>Lượt 2</th><th>Tổng Điểm V2</th></tr>
        </thead>
        <tbody>
          ${list.map(t => `
            <tr>
              <td><b>#${t.rank}</b></td><td>${t.code}</td><td><b>${t.className}</b></td>
              <td>${t.student1} &amp; ${t.student2}</td><td>${t.lec || ''}</td>
              <td>${t.turn1Score !== null ? t.turn1Score : '—'}</td>
              <td>${t.turn2Score !== null ? t.turn2Score : '—'}</td>
              <td><b>${t.totalScore}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    win.document.write(`
      <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
      <title>Báo Cáo Tổng Hợp Vòng 2 - TECH CLASH 2026</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
        h2, h3 { margin: 12px 0 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 18px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; }
        th { background: #e2e8f0; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      <div class="no-print" style="text-align:right;margin-bottom:12px;">
        <button onclick="window.print()" style="padding:10px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
          🖨 In / Lưu Toàn Bộ Ra File PDF
        </button>
      </div>
      <h2>BẢNG XẾP HẠNG &amp; KẾT QUẢ VÒNG 2 — TECH CLASH: FINALE 2026</h2>
      ${renderBracketTable('A', standings.A)}
      ${renderBracketTable('B', standings.B)}
      </body></html>
    `);
    win.document.close();
  }

  function exportSchedulePDF() {
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Hãy cho phép mở cửa sổ Pop-up để tải Lịch Thi Đấu PDF!', 'warning');
      return;
    }

    const rowsHtml = state.matches.map(m => {
      const rT = getTeamById(m.redTeamId);
      const bT = getTeamById(m.blueTeamId);
      const stText = m.status === 'completed'
        ? `<b>${m.redScore} - ${m.blueScore}</b>`
        : (m.status === 'live' ? 'Đang thi' : 'Chưa thi');
      return `
        <tr>
          <td><b>#${m.matchNumber}</b></td>
          <td>Lượt ${m.wave}</td>
          <td><span class="pill ${m.bracket === 'A' ? 'pa' : 'pb'}">${m.bracket === 'A' ? 'Bảng A (VEX GO)' : 'Bảng B (VEX IQ)'}</span></td>
          <td style="text-align:left;background:#fff5f5;">
            <b style="color:#b91c1c;">${rT.className}</b> <small>(${rT.code} • L${m.redTurn})</small><br/>
            <span style="font-size:9pt;color:#334155;">${rT.student1} — ${rT.student2}</span>
          </td>
          <td style="text-align:left;background:#f0f9ff;">
            <b style="color:#0369a1;">${bT.className}</b> <small>(${bT.code} • L${m.blueTurn})</small><br/>
            <span style="font-size:9pt;color:#334155;">${bT.student1} — ${bT.student2}</span>
          </td>
          <td>${stText}</td>
        </tr>
      `;
    }).join('');

    win.document.write(`
      <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
      <title>Lịch Thi Đấu Chính Thức - TECHCLASH 2026</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
        h2 { margin: 0 0 4px; color: #0f172a; }
        .sub { font-size: 10pt; color: #475569; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; vertical-align: middle; }
        th { background: #1e293b; color: #fff; font-weight: bold; }
        .pill { padding: 2px 7px; border-radius: 4px; font-size: 8.5pt; font-weight: bold; }
        .pa { background: #fef3c7; color: #b45309; }
        .pb { background: #e0f2fe; color: #0369a1; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      <div class="no-print" style="text-align:right;margin-bottom:12px;">
        <button onclick="window.print()" style="padding:10px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
          🖨 In / Lưu Lịch Thi Đấu Ra File PDF
        </button>
      </div>
      <h2>LỊCH THI ĐẤU VÒNG 2 CHUNG KẾT ĐỒNG ĐỘI — TECHCLASH 2026</h2>
      <div class="sub">MindX Thái Nguyên • Tổng số: <b>${state.matches.length} trận</b> (Xen kẽ Bảng A &amp; Bảng B — Mỗi đội thi 1 lượt Sân Đỏ &amp; 1 lượt Sân Xanh)</div>
      <table>
        <thead>
          <tr>
            <th style="width:55px;">Trận</th>
            <th style="width:60px;">Lượt</th>
            <th style="width:125px;">Bảng Đấu</th>
            <th>Sân Đỏ (Bên Trái)</th>
            <th>Sân Xanh (Bên Phải)</th>
            <th style="width:90px;">Tỷ Số / TT</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>setTimeout(function(){ window.print(); }, 300);</script>
      </body></html>
    `);
    win.document.close();
  }

  async function scrapeFromAnyGoogleSheetUrl(customUrl, mode = 'replace_both') {
    const targetUrl = String(customUrl || state.config.customSheetUrl || state.config.yearEndSheetId || Engine.DEFAULT_CONFIG.yearEndSheetId || '').trim();
    if (!targetUrl) {
      showToast('Hãy dán đường link Google Sheet vào ô trước khi bấm cào dữ liệu!', 'warning');
      return;
    }
    state.config.customSheetUrl = targetUrl;
    try {
      showToast('Đang cào dữ liệu trực tiếp từ Google Sheet (Bảng A & Bảng B + Điểm Vòng 1)...', 'info');
      let scrapedA = [];
      let scrapedB = [];
      let updatedCount = 0;

      // Ưu tiên gọi API /api/scrape-sheet trên Server để cào trực tiếp cả Sheet 2 + Sheet 1 (Không bị chặn CORS hay thiếu học sinh)
      try {
        const srvRes = await fetch(API_BASE + '/api/scrape-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sheetUrl: targetUrl,
            vong1Url: state.config.vong1SheetId || Engine.DEFAULT_CONFIG.vong1SheetId
          })
        });
        const srvData = await srvRes.json();
        if (srvData && srvData.ok && ((srvData.teamsA && srvData.teamsA.length > 0) || (srvData.teamsB && srvData.teamsB.length > 0))) {
          scrapedA = srvData.teamsA || [];
          scrapedB = srvData.teamsB || [];
        }
      } catch (e) {}

      // Fallback sang JSONP trên trình duyệt nếu cần
      if (scrapedA.length === 0 && scrapedB.length === 0) {
        const table = await Engine.fetchGoogleSheetJSONP(targetUrl);
        const rows = table.rows || [];
        const cellStr = (arr, idx) => (arr[idx] && (arr[idx].f !== undefined && arr[idx].f !== null ? arr[idx].f : arr[idx].v) ? String(arr[idx].f || arr[idx].v).trim() : '');

        for (let r = 0; r < rows.length; r++) {
          const c = rows[r].c || [];
          const cNext = (rows[r + 1] && rows[r + 1].c) ? rows[r + 1].c : [];

          const labelA = cellStr(c, 0);
          const classA = cellStr(c, 1);
          const lecA = cellStr(c, 5);
          const hs1A = cellStr(c, 6);
          const hs2A = cellStr(cNext, 6);
          if ((labelA.toLowerCase().startsWith('đội') || /^A\d+/i.test(labelA)) && classA) {
            scrapedA.push({
              className: classA.toUpperCase(),
              lec: lecA || '',
              student1: (hs1A || 'Học sinh 1').replace(/^NNguyễn/, 'Nguyễn'),
              student2: hs2A || 'Học sinh 2'
            });
          }

          const labelB = cellStr(c, 11);
          const classB = cellStr(c, 12);
          const lecB = cellStr(c, 16);
          const hs1B = cellStr(c, 17);
          const hs2B = cellStr(cNext, 17);
          if ((labelB.toLowerCase().startsWith('đội') || /^B\d+/i.test(labelB)) && classB) {
            scrapedB.push({
              className: classB.toUpperCase(),
              lec: lecB || '',
              student1: hs1B || 'Học sinh 1',
              student2: hs2B || 'Học sinh 2'
            });
          }

          if (scrapedA.length === 0 && scrapedB.length === 0) {
            for (let col = 0; col < Math.min(c.length, 10); col++) {
              const val = cellStr(c, col);
              if (/^TN-(ROB|C4K)-/i.test(val)) {
                const clsUpper = val.toUpperCase();
                const isJunior = /-(PRE|ARM)/i.test(clsUpper) && !/SEMI/i.test(clsUpper);
                const possibleS1 = cellStr(c, col + 1) || 'Học sinh 1';
                const possibleS2 = cellStr(c, col + 2) || cellStr(cNext, col + 1) || 'Học sinh 2';
                const item = { className: clsUpper, lec: '', student1: possibleS1, student2: possibleS2 };
                if (mode === 'replace_A') scrapedA.push(item);
                else if (mode === 'replace_B') scrapedB.push(item);
                else if (isJunior) scrapedA.push(item);
                else scrapedB.push(item);
                break;
              }
            }
          }
        }
      }

      if (mode === 'update_existing') {
        [...scrapedA, ...scrapedB].forEach(sc => {
          const found = state.teams.find(t => t.className.toUpperCase() === sc.className.toUpperCase());
          if (found) {
            if (sc.lec) found.lec = sc.lec;
            if (sc.student1) found.student1 = sc.student1;
            if (sc.student2) found.student2 = sc.student2;
            updatedCount++;
          }
        });
        saveState(true, true);
        showToast('Đã cập nhật tên học sinh cho ' + updatedCount + ' đội từ Google Sheet!', 'success');
        return;
      }

      // Chế độ tạo mới / thay thế bảng đấu từ dữ liệu cào được
      let newTeamsA = state.teams.filter(t => t.bracket === 'A');
      let newTeamsB = state.teams.filter(t => t.bracket === 'B');

      if ((mode === 'replace_both' || mode === 'replace_A') && scrapedA.length > 0) {
        newTeamsA = scrapedA.map((item, idx) => {
          const code = 'A' + String(idx + 1).padStart(2, '0');
          return {
            id: code,
            code,
            bracket: 'A',
            seed: idx + 1,
            className: item.className,
            lec: item.lec || '',
            student1: item.student1 || 'Học sinh 1',
            student2: item.student2 || 'Học sinh 2',
            v1Avg: 20,
            active: true
          };
        });
        updatedCount += newTeamsA.length;
      }

      if ((mode === 'replace_both' || mode === 'replace_B') && scrapedB.length > 0) {
        newTeamsB = scrapedB.map((item, idx) => {
          const code = 'B' + String(idx + 1).padStart(2, '0');
          return {
            id: code,
            code,
            bracket: 'B',
            seed: idx + 1,
            className: item.className,
            lec: item.lec || '',
            student1: item.student1 || 'Học sinh 1',
            student2: item.student2 || 'Học sinh 2',
            v1Avg: 25,
            active: true
          };
        });
        updatedCount += newTeamsB.length;
      }

      if (updatedCount === 0) {
        showToast('Không tìm thấy dòng đội thi hợp lệ trong tab Sheet này! Bạn có thể dùng ô Copy-Paste trực tiếp bên dưới.', 'warning');
        return;
      }

      state.teams = [...newTeamsA, ...newTeamsB];
      state.matches = Engine.generateInterleavedSchedule(state.teams, false);
      if (state.matches.length > 0) {
        state.matches[0].status = 'live';
        selectedMatchId = state.matches[0].id;
      }
      state.config.customProgressText = '';
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      setTimerMode('match');
      saveState(true, true);
      showToast('Đã cào thành công ' + updatedCount + ' đội (Bảng A: ' + newTeamsA.length + ', Bảng B: ' + newTeamsB.length + ') & xếp lịch mới từ Trận #1 (Tiến độ 0/' + state.matches.length + ')!', 'success');
    } catch (err) {
      showToast('Không đọc được link Sheet (Kiểm tra quyền Chia sẻ -> Bất kỳ ai có liên kết, hoặc dùng ô Copy-Paste bên dưới): ' + err.message, 'error');
    }
  }

  function parsePastedBracketData(rawText, bracketCode) {
    const text = String(rawText || '').trim();
    if (!text) {
      showToast('Hãy dán danh sách đội (Copy từ Excel / Google Sheet) vào ô trước!', 'warning');
      return;
    }
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsed = [];

    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(/\t|,|;|\|/).map(s => s.trim()).filter(Boolean);
      if (cols.length === 0) continue;

      // Tìm cột chứa tên lớp (VD: TN-ROB-..., TN-C4K-...) hoặc lấy cột đầu tiên
      let clsIdx = cols.findIndex(c => /^TN-(ROB|C4K)-/i.test(c));
      if (clsIdx !== -1) {
        const className = cols[clsIdx].toUpperCase();
        const afterCols = cols.slice(clsIdx + 1).filter(x => isNaN(Number(x)) && !/^đội\s*\d+/i.test(x));
        let student1 = afterCols[0] || 'Học sinh 1';
        let student2 = afterCols[1] || '';

        // Nếu dòng tiếp theo chỉ có 1 cột tên học sinh 2 (như cấu trúc gộp ô 2 dòng của Google Sheet)
        if (!student2 && i + 1 < lines.length) {
          const nextCols = lines[i + 1].split(/\t|,|;|\|/).map(s => s.trim()).filter(Boolean);
          const hasNextClass = nextCols.some(c => /^TN-(ROB|C4K)-/i.test(c));
          if (!hasNextClass && nextCols.length > 0) {
            student2 = nextCols[nextCols.length - 1];
            i++;
          }
        }
        parsed.push({ className, student1, student2: student2 || 'Học sinh 2' });
      } else if (cols.length >= 2 && !/^bảng|hạng|mã|stt/i.test(cols[0])) {
        parsed.push({
          className: cols[0].toUpperCase(),
          student1: cols[1] || 'Học sinh 1',
          student2: cols[2] || 'Học sinh 2'
        });
      }
    }

    if (parsed.length === 0) {
      showToast('Không tách được đội nào từ văn bản đã dán!', 'warning');
      return;
    }

    const otherTeams = state.teams.filter(t => t.bracket !== bracketCode);
    const newBracketTeams = parsed.map((item, idx) => {
      const code = bracketCode + String(idx + 1).padStart(2, '0');
      return {
        id: code,
        code,
        bracket: bracketCode,
        seed: idx + 1,
        className: item.className,
        lec: '',
        student1: item.student1,
        student2: item.student2,
        v1Avg: 20,
        active: true
      };
    });

    state.teams = bracketCode === 'A'
      ? [...newBracketTeams, ...otherTeams]
      : [...otherTeams, ...newBracketTeams];

    state.matches = Engine.generateInterleavedSchedule(state.teams, false);
    if (state.matches.length > 0) {
      state.matches[0].status = 'live';
      selectedMatchId = state.matches[0].id;
    }
    state.config.customProgressText = '';
    setTimerMode('match');
    saveState(true, true);
    showToast('Đã nạp ' + newBracketTeams.length + ' đội vào Bảng ' + bracketCode + ' & xếp lại lịch thi đấu từ Trận #1!', 'success');
  }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-hide');
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, 3800);
  }

  // ==================== RENDER GIAO DIỆN ====================
  function renderAll() {
    renderHeaderNav();
    const main = document.getElementById('main-view');
    if (!main) return;

    if (activeTab === 'ranking') {
      main.innerHTML = renderLiveRankingView();
    } else if (activeTab === 'referee') {
      main.innerHTML = renderRefereeView();
    } else if (activeTab === 'schedule') {
      main.innerHTML = renderScheduleView();
    } else if (activeTab === 'teams') {
      main.innerHTML = renderTeamsAndSyncView();
    }

    updateTimerDOMOnly();
  }

  function renderHeaderNav() {
    const completedCount = state.matches.filter(m => m.status === 'completed').length;
    const totalCount = state.matches.length;
    const progressEl = document.getElementById('header-progress');
    if (progressEl) {
      progressEl.innerHTML = `Tiến độ giải: <b>${completedCount}/${totalCount} trận</b>`;
    }

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      const t = btn.getAttribute('data-tab');
      if (t === activeTab) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  function renderLiveArenaBar() {
    const liveMatch = getCurrentLiveMatch();
    if (!liveMatch) return '';

    const rT = getTeamById(liveMatch.redTeamId);
    const bT = getTeamById(liveMatch.blueTeamId);
    const rScore = liveMatch.status === 'completed' && liveMatch.redScore !== null
      ? liveMatch.redScore
      : Engine.calculateSheetScore(liveMatch.redSheet, liveMatch.bracket);
    const bScore = liveMatch.status === 'completed' && liveMatch.blueScore !== null
      ? liveMatch.blueScore
      : Engine.calculateSheetScore(liveMatch.blueSheet, liveMatch.bracket);

    const liveIdx = state.matches.findIndex(x => x.id === liveMatch.id);
    const onDeck = state.matches.slice(liveIdx + 1, liveIdx + 3);

    return `
      <div class="arena-broadcast-bar">
        <div class="arena-current-card">
          <div class="arena-card-top">
            <span class="live-pill"><span class="pulse-dot"></span> SA BÀN TRUNG TÂM • TRẬN #${liveMatch.matchNumber} (LƯỢT ${liveMatch.wave})</span>
            <span class="bracket-pill ${liveMatch.bracket === 'A' ? 'bracket-a' : 'bracket-b'}">
              ${liveMatch.bracket === 'A' ? 'BẢNG A • JUNIOR CODER (VEX GO)' : 'BẢNG B • TEEN CODER (VEX IQ)'}
            </span>
            <button class="btn-xs btn-outline" onclick="window.TCApp.selectMatchForScoring('${liveMatch.id}', true)">
              ✏️ Chấm điểm trận này
            </button>
          </div>

          <div class="arena-vs-row">
            <!-- SÂN ĐỎ -->
            <div class="arena-team-box side-red">
              <div class="side-tag">SÂN ĐỎ (TRÁI) • Lượt ${liveMatch.redTurn}</div>
              <div class="arena-team-name">${rT.className} <span class="team-code-sub">(${rT.code})</span></div>
              <div class="arena-students">👤 ${rT.student1} &nbsp;•&nbsp; 👤 ${rT.student2}</div>
            </div>

            <!-- ĐỒNG HỒ & TỶ SỐ TRỰC TIẾP -->
            <div class="arena-center-score">
              <div class="live-score-pair">
                <span class="score-num red-text">${rScore}</span>
                <span class="vs-divider">VS</span>
                <span class="score-num blue-text">${bScore}</span>
              </div>
              <div class="mini-timer-box">
                <span class="js-timer-display timer-digits">01:30</span>
                <span class="js-timer-phase timer-phase-badge">90S ĐỒNG ĐỘI</span>
              </div>
            </div>

            <!-- SÂN XANH -->
            <div class="arena-team-box side-blue">
              <div class="side-tag">SÂN XANH (PHẢI) • Lượt ${liveMatch.blueTurn}</div>
              <div class="arena-team-name">${bT.className} <span class="team-code-sub">(${bT.code})</span></div>
              <div class="arena-students">👤 ${bT.student1} &nbsp;•&nbsp; 👤 ${bT.student2}</div>
            </div>
          </div>
        </div>

        <!-- HÀNG ĐỢI CHUẨN BỊ VÀO SÂN (GIẢM THỜI GIAN CHẾT GIỮA CÁC TRẬN) -->
        <div class="ondeck-queue-card">
          <div class="ondeck-header">
            <span>⏳ HÀNG ĐỢI CHUẨN BỊ (ON-DECK)</span>
            <span class="ondeck-hint">Đứng sẵn ở bàn chờ để vào sân ngay</span>
          </div>
          <div class="ondeck-list">
            ${onDeck.length === 0 ? `<div class="ondeck-empty">Đây là trận cuối cùng của giải đấu!</div>` : onDeck.map(m => {
              const rt = getTeamById(m.redTeamId);
              const bt = getTeamById(m.blueTeamId);
              return `
                <div class="ondeck-item" onclick="window.TCApp.setMatchLiveOnArena('${m.id}')" title="Bấm để đưa trận này lên Sa bàn ngay">
                  <div class="ondeck-meta">
                    <span class="ondeck-mnum">Trận #${m.matchNumber}</span>
                    <span class="ondeck-btag ${m.bracket === 'A' ? 'btag-a' : 'btag-b'}">
                      ${m.bracket === 'A' ? 'Bảng A (VEX GO)' : 'Bảng B (VEX IQ)'}
                    </span>
                  </div>
                  <div class="ondeck-teams">
                    <span class="red-dot"></span> <b>${rt.className}</b> <span class="ondeck-stu">(${rt.student1}, ${rt.student2})</span>
                    <span class="vs-sm">vs</span>
                    <span class="blue-dot"></span> <b>${bt.className}</b> <span class="ondeck-stu">(${bt.student1}, ${bt.student2})</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderSingleStandingTable(bracketCode, standingsList) {
    const isJunior = bracketCode === 'A';
    const title = isJunior ? 'BẢNG A • JUNIOR CODER' : 'BẢNG B • TEEN CODER';
    const subtitle = isJunior
      ? 'Lộ trình Robotics PRE & ARM • Thiết bị VEX GO • 12 Đội (Không xếp chồng cốc)'
      : 'Lộ trình SEMI, Coding GAME & APP • Thiết bị VEX IQ • 19 Đội (Xếp chồng cốc x2)';
    const primaryLabel = state.config.rankBy === 'average' ? 'ĐIỂM TB' : 'TỔNG ĐIỂM';

    return `
      <div class="tpc-board-panel ${isJunior ? 'panel-junior' : 'panel-teen'}">
        <div class="tpc-board-header">
          <div>
            <div class="tpc-bracket-badge ${isJunior ? 'badge-junior' : 'badge-teen'}">
              ${isJunior ? '⚡ GROUP A • VEX GO' : '🔥 GROUP B • VEX IQ'}
            </div>
            <h2 class="tpc-board-title">${title}</h2>
            <div class="tpc-board-sub">${subtitle}</div>
          </div>
          <div class="tpc-cutline-legend">
            <span class="medal-pill gold">🥇 Hạng 1</span>
            <span class="medal-pill silver">🥈 Hạng 2</span>
            <span class="medal-pill bronze">🥉 Hạng 3</span>
          </div>
        </div>

        <div class="tpc-table-wrap">
          <table class="tpc-table">
            <thead>
              <tr>
                <th class="col-rank">RANK</th>
                <th class="col-team">ĐỘI TUYỂN (LỚP) & 2 HỌC SINH ĐẠI DIỆN</th>
                <th class="col-turn">LƯỢT 1</th>
                <th class="col-turn">LƯỢT 2</th>
                <th class="col-bonus" title="Số lần lấy được Khối đặc biệt (+10đ) / Về đích (+5đ)">ĐB / ĐÍCH</th>
                <th class="col-total">${primaryLabel}</th>
              </tr>
            </thead>
            <tbody>
              ${standingsList.map((item, idx) => {
                const rank = item.rank;
                const rowClass = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
                const isCutline = rank === 3;
                const medalIcon = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : ''));
                const seedBadge = item.seed ? `<span class="seed-badge" title="Hạt giống số ${item.seed} từ Vòng 1 (TB: ${item.v1Avg}đ)">SEED #${item.seed}</span>` : '';
                const liveBadge = item.isLiveNow ? `<span class="row-live-badge">LIVE</span>` : '';

                const renderTurnCell = (score, status, matchNum, side) => {
                  if (status === 'live') {
                    return `<div class="turn-cell turn-live" onclick="window.TCApp.selectMatchForScoring('M${String(matchNum).padStart(2,'0')}', true)">
                      <span class="turn-score-val">${score !== null ? score : 0}</span>
                      <span class="turn-sub-tag">🔴 Đang thi #${matchNum}</span>
                    </div>`;
                  }
                  if (score !== null && status === 'completed') {
                    return `<div class="turn-cell turn-done ${side === 'red' ? 'side-border-red' : 'side-border-blue'}" onclick="window.TCApp.selectMatchForScoring('M${String(matchNum).padStart(2,'0')}', true)" title="Bấm để xem/sửa phiếu chấm Trận #${matchNum}">
                      <span class="turn-score-val">${score}</span>
                      <span class="turn-sub-tag">#${matchNum} • ${side === 'red' ? 'Đỏ' : 'Xanh'}</span>
                    </div>`;
                  }
                  return `<div class="turn-cell turn-pending" onclick="window.TCApp.selectMatchForScoring('M${String(matchNum).padStart(2,'0')}', true)" title="Trận #${matchNum} (Chưa thi)">
                    <span class="turn-dash">—</span>
                    <span class="turn-sub-tag">Trận #${matchNum || '?'}</span>
                  </div>`;
                };

                return `
                  <tr class="tpc-row ${rowClass} ${item.isLiveNow ? 'row-is-live' : ''}">
                    <td class="col-rank">
                      <div class="rank-box">
                        <span class="rank-num">${rank}</span>
                        ${medalIcon ? `<span class="rank-medal">${medalIcon}</span>` : ''}
                      </div>
                    </td>
                    <td class="col-team">
                      <div class="team-cell-main">
                        <div class="team-title-line">
                          <span class="team-class-name">${item.className}</span>
                          <span class="team-code-pill">${item.code}</span>
                          ${seedBadge}
                          ${liveBadge}
                          ${item.lec ? `<span class="lec-tag">GV: ${item.lec}</span>` : ''}
                        </div>
                        <div class="team-students-line">
                          <span class="student-chip"><i class="stu-dot"></i> ${item.student1}</span>
                          <span class="student-chip"><i class="stu-dot"></i> ${item.student2}</span>
                        </div>
                      </div>
                    </td>
                    <td class="col-turn">${renderTurnCell(item.turn1Score, item.turn1Status, item.turn1MatchNum, item.turn1Side)}</td>
                    <td class="col-turn">${renderTurnCell(item.turn2Score, item.turn2Status, item.turn2MatchNum, item.turn2Side)}</td>
                    <td class="col-bonus">
                      <div class="bonus-pills">
                        <span class="bpill bpill-sp" title="Số Khối đặc biệt (+10đ)">⭐ ${item.specialCount}</span>
                        <span class="bpill bpill-pk" title="Số lần Về đích an toàn (+5đ)">🏁 ${item.parkCount}</span>
                      </div>
                    </td>
                    <td class="col-total">
                      <div class="total-score-box">
                        <span class="total-primary">${item.displayPrimary}</span>
                        <span class="total-secondary">${state.config.rankBy === 'average' ? `Tổng: ${item.totalScore}` : `TB: ${item.avgScore}`}</span>
                      </div>
                    </td>
                  </tr>
                  ${isCutline ? `
                    <tr class="cutline-row">
                      <td colspan="6">
                        <div class="cutline-bar">
                          <span>▲ TOP 3 ĐỘI ĐẠT HUY CHƯƠNG CHUNG KẾT (VÀNG • BẠC • ĐỒNG) ▲</span>
                        </div>
                      </td>
                    </tr>
                  ` : ''}
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderLiveRankingView() {
    const standings = Engine.computeStandings(state.teams, state.matches, state.config.rankBy);

    return `
      ${renderLiveArenaBar()}

      <div class="ranking-toolbar">
        <div class="toolbar-left">
          <span class="toolbar-label">CHẾ ĐỘ HIỂN THỊ BẢNG XẾP HẠNG:</span>
          <button class="btn-filter ${bracketFilter === 'split' ? 'active' : ''}" onclick="window.TCApp.setBracketFilter('split')">
            🖥 Song song 2 Bảng (A & B)
          </button>
          <button class="btn-filter ${bracketFilter === 'A' ? 'active' : ''}" onclick="window.TCApp.setBracketFilter('A')">
            ⚡ Bảng A: Junior Coder (12 Đội)
          </button>
          <button class="btn-filter ${bracketFilter === 'B' ? 'active' : ''}" onclick="window.TCApp.setBracketFilter('B')">
            🔥 Bảng B: Teen Coder (19 Đội)
          </button>
          <button class="btn-filter ${autoRotateTimer ? 'active' : ''}" onclick="window.TCApp.toggleAutoRotate()">
            🔄 Tự động đảo Bảng A/B (15s)
          </button>
        </div>

        <div class="toolbar-right">
          <span class="toolbar-label">TEST DATA 31 ĐỘI:</span>
          <button class="btn-filter" onclick="window.TCApp.loadDemoPreset('mid')" title="Giả lập đã đấu 18/31 trận, Trận #19 đang LIVE">
            🔥 Demo Giữa Giải (18/31)
          </button>
          <button class="btn-filter" onclick="window.TCApp.loadDemoPreset('full')" title="Giả lập hoàn tất cả 31/31 trận (Đủ 2 lượt)">
            🏆 Demo Full (31/31)
          </button>
          <button class="btn-filter ${liveSimTimer ? 'active' : ''}" onclick="window.TCApp.toggleLiveSimulation()" title="Tự động cộng điểm & nhảy BXH real-time mỗi 1.5s">
            ${liveSimTimer ? '⏹ Dừng Auto-Sim' : '▶️ Chạy Auto-Sim Live'}
          </button>
          <button class="btn-filter" onclick="window.TCApp.loadDemoPreset('clear')" title="Xóa điểm test về 0đ để chấm thi thật">
            🧹 Xóa Điểm (0đ)
          </button>
          <span class="toolbar-label" style="margin-left:6px;">XẾP HẠNG:</span>
          <button class="btn-filter ${state.config.rankBy === 'total' ? 'active' : ''}" onclick="window.TCApp.setRankBy('total')">
            Tổng (L1+L2)
          </button>
          <button class="btn-filter ${state.config.rankBy === 'average' ? 'active' : ''}" onclick="window.TCApp.setRankBy('average')">
            Trung bình
          </button>
          <button class="btn-filter" onclick="window.TCApp.exportCSV()">
            📥 Xuất CSV
          </button>
        </div>
      </div>

      <div class="boards-grid ${bracketFilter === 'split' ? 'grid-2col' : 'grid-1col'}">
        ${(bracketFilter === 'split' || bracketFilter === 'A') ? renderSingleStandingTable('A', standings.A) : ''}
        ${(bracketFilter === 'split' || bracketFilter === 'B') ? renderSingleStandingTable('B', standings.B) : ''}
      </div>
    `;
  }

  // ==================== VIEW 2: FORM CHẤM ĐIỂM TRỌNG TÀI & ĐỒNG HỒ 90S ====================
  function renderTeamScorePad(match, side) {
    const isRed = side === 'red';
    const teamId = isRed ? match.redTeamId : match.blueTeamId;
    const turnNum = isRed ? match.redTurn : match.blueTurn;
    const team = getTeamById(teamId);
    const sheet = isRed ? match.redSheet : match.blueSheet;
    const isTeen = match.bracket === 'B';
    const unlockedNV2 = (sheet.big > 0 && sheet.med > 0 && sheet.small > 0) || sheet.forceSpecial;
    const totalScore = Engine.calculateSheetScore(sheet, match.bracket);

    return `
      <div class="ref-pad-card ${isRed ? 'pad-red' : 'pad-blue'}">
        <div class="ref-pad-header">
          <div>
            <span class="pad-side-badge ${isRed ? 'bg-red' : 'bg-blue'}">
              ${isRed ? '🔴 SÂN ĐỎ (BÊN TRÁI)' : '🔵 SÂN XANH (BÊN PHẢI)'} • LƯỢT ${turnNum}/2
            </span>
            <h3 class="pad-team-title">${team.className} <span class="pad-team-code">(${team.code})</span></h3>
            <div class="pad-students">
              <span>👤 Thành viên 1: <b>${team.student1}</b></span>
              <span>👤 Thành viên 2: <b>${team.student2}</b></span>
            </div>
          </div>
          <div class="pad-score-big-box">
            <div class="pad-score-label">TỔNG ĐIỂM LƯỢT ${turnNum}</div>
            <div class="pad-score-val">${totalScore}</div>
          </div>
        </div>

        <!-- 1. NHIỆM VỤ 1: THU THẬP KHỐI CỐC CƠ BẢN (CỘT D, E, F) -->
        <div class="pad-section">
          <div class="pad-sec-title">
            <span>1. Điểm thu thập khối cốc vào 3 ô (Cột D, E, F)</span>
            <span class="unlock-status ${unlockedNV2 ? 'unlocked' : 'locked'}">
              ${unlockedNV2 ? '✅ Đã đủ 3 cỡ cốc -> Mở khóa Khối ĐB' : '🔒 Cần đủ 3 cỡ cốc (To, Vừa, Nhỏ > 0) để mở Khối ĐB'}
            </span>
          </div>
          <div class="counter-grid-3">
            <div class="counter-box">
              <div class="counter-label">Khối To (Cột D)</div>
              <div class="counter-pts">+3 điểm / khối</div>
              <div class="counter-controls">
                <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','big',-1)">−</button>
                <span class="counter-val">${sheet.big}</span>
                <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','big',1)">+</button>
              </div>
            </div>
            <div class="counter-box">
              <div class="counter-label">Khối Vừa (Cột E)</div>
              <div class="counter-pts">+2 điểm / khối</div>
              <div class="counter-controls">
                <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','med',-1)">−</button>
                <span class="counter-val">${sheet.med}</span>
                <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','med',1)">+</button>
              </div>
            </div>
            <div class="counter-box">
              <div class="counter-label">Khối Nhỏ (Cột F)</div>
              <div class="counter-pts">+1 điểm / khối</div>
              <div class="counter-controls">
                <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','small',-1)">−</button>
                <span class="counter-val">${sheet.small}</span>
                <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','small',1)">+</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. CƠ CHẾ XẾP CHỒNG CỐC X2 (CỘT G, H, I - CHỈ BẢNG B TEEN CODER) -->
        <div class="pad-section ${isTeen ? '' : 'section-disabled'}">
          <div class="pad-sec-title">
            <span>2. Điểm đặc biệt: Số cốc xếp chồng nhân đôi x2 (Cột G, H, I)</span>
            <span class="sec-note">${isTeen ? 'Áp dụng cho Bảng B (Teen Coder)' : '🚫 Bảng A (Junior Coder) KHÔNG xếp chồng cốc'}</span>
          </div>
          ${isTeen ? `
            <div class="counter-grid-3">
              <div class="counter-box">
                <div class="counter-label">Chồng To (Cột G)</div>
                <div class="counter-pts">+3đ thưởng chồng</div>
                <div class="counter-controls">
                  <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','stackBig',-1)">−</button>
                  <span class="counter-val">${sheet.stackBig}</span>
                  <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','stackBig',1)">+</button>
                </div>
              </div>
              <div class="counter-box">
                <div class="counter-label">Chồng Vừa (Cột H)</div>
                <div class="counter-pts">+2đ thưởng chồng</div>
                <div class="counter-controls">
                  <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','stackMed',-1)">−</button>
                  <span class="counter-val">${sheet.stackMed}</span>
                  <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','stackMed',1)">+</button>
                </div>
              </div>
              <div class="counter-box">
                <div class="counter-label">Chồng Nhỏ (Cột I)</div>
                <div class="counter-pts">+1đ thưởng chồng</div>
                <div class="counter-controls">
                  <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','stackSmall',-1)">−</button>
                  <span class="counter-val">${sheet.stackSmall}</span>
                  <button class="btn-step btn-plus" onclick="window.TCApp.stepScore('${match.id}','${side}','stackSmall',1)">+</button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- 3. KHỐI ĐẶC BIỆT (+10Đ) & VỀ ĐÍCH AN TOÀN (+5Đ) -->
        <div class="pad-section">
          <div class="pad-sec-title">
            <span>3. Nhiệm vụ 2 (Khối đặc biệt - Cột J) & Nhiệm vụ 3 (Về đích - Cột K)</span>
          </div>
          <div class="toggle-grid-2">
            <button class="btn-toggle-task ${sheet.special > 0 ? 'task-on' : ''}" onclick="window.TCApp.toggleScore('${match.id}','${side}','special')">
              <div class="task-title">⭐ Khối đặc biệt về Xuất phát</div>
              <div class="task-pts">+10 ĐIỂM (Điền 1 hoặc 0)</div>
              <div class="task-state">${sheet.special > 0 ? (unlockedNV2 ? 'ĐÃ ĐẠT (+10đ)' : 'ĐÃ TÍCH (Chờ đủ 3 cỡ cốc NV1)') : 'Chưa đạt (0đ)'}</div>
            </button>

            <button class="btn-toggle-task ${sheet.parked > 0 ? 'task-on' : ''}" onclick="window.TCApp.toggleScore('${match.id}','${side}','parked')">
              <div class="task-title">🏁 Dừng đỗ an toàn & Đặt Tablet</div>
              <div class="task-pts">+5 ĐIỂM (100% bánh xe trong ô)</div>
              <div class="task-state">${sheet.parked > 0 ? 'ĐÃ VỀ ĐÍCH (+5đ)' : 'Chưa về đích (0đ)'}</div>
            </button>
          </div>
          ${(sheet.special > 0 && !unlockedNV2) ? `
            <div class="force-unlock-row">
              <span>⚠️ Đội chưa đủ 3 loại cốc To/Vừa/Nhỏ nên theo hàm Sheet sẽ tính 0đ Khối ĐB.</span>
              <button class="btn-xs btn-outline" onclick="window.TCApp.toggleScore('${match.id}','${side}','forceSpecial')">
                Cho phép cộng +10đ ngoại lệ
              </button>
            </div>
          ` : ''}
        </div>

        <!-- 4. CHẾ TÀI VÒNG 2: LỖI CHUYỂN TABLET (40s-50s) & LỖI KHÁC -->
        <div class="pad-section pad-penalty-sec">
          <div class="pad-sec-title">
            <span>4. Chế tài Vòng 2: Chuyển giao Tablet (40s–50s) & Điểm trừ lỗi</span>
          </div>
          <div class="penalty-row">
            <button class="btn-penalty-swap ${sheet.noTabletSwap > 0 ? 'swap-violated' : ''}" onclick="window.TCApp.toggleScore('${match.id}','${side}','noTabletSwap')">
              <span>📵 Không chuyển Tablet cho đồng đội ở giây 40–50</span>
              <b>${sheet.noTabletSwap > 0 ? 'ĐANG TRỪ -5 ĐIỂM' : 'Không vi phạm (0đ)'}</b>
            </button>

            <div class="counter-box penalty-counter">
              <div class="counter-label">Trừ lỗi khác (-1đ / -2đ)</div>
              <div class="counter-controls">
                <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','otherFouls',-1)">−</button>
                <span class="counter-val text-red">-${sheet.otherFouls || 0}</span>
                <button class="btn-step" onclick="window.TCApp.stepScore('${match.id}','${side}','otherFouls',1)">+</button>
              </div>
            </div>

            <div class="manual-override-box">
              <label>Ghi đè Tổng điểm:</label>
              <input type="number" class="input-override" placeholder="Tự động" value="${sheet.manualOverride !== null ? sheet.manualOverride : ''}"
                onchange="window.TCApp.setDirectScore('${match.id}','${side}',this.value)" />
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderRefereeView() {
    const match = getSelectedMatch();
    if (!match) return `<div class="empty-box">Chưa có trận đấu nào trong lịch!</div>`;

    const isTimeUpOrUnlocked = timerState.remainingSec <= 0 || scoringUnlocked || match.status === 'completed';
    const isAlreadyPublished = match.status === 'completed';
    const liveIdx = state.matches.findIndex(x => x.id === match.id);
    const nextMatch = state.matches[liveIdx + 1] || null;
    const nextRed = nextMatch ? getTeamById(nextMatch.redTeamId) : null;
    const nextBlue = nextMatch ? getTeamById(nextMatch.blueTeamId) : null;

    return `
      <div class="referee-top-bar">
        <!-- CHỌN NHANH TRẬN ĐẤU -->
        <div class="ref-match-selector">
          <label>TRẬN ĐẤU TRÊN 01 SA BÀN (XEN KẼ BẢNG A &amp; BẢNG B):</label>
          <select class="select-match" onchange="window.TCApp.selectMatchForScoring(this.value, false)">
            ${state.matches.map(m => {
              const rT = getTeamById(m.redTeamId);
              const bT = getTeamById(m.blueTeamId);
              const stIcon = m.status === 'completed' ? '✅' : (m.status === 'live' ? '🔴' : '⏳');
              return `<option value="${m.id}" ${m.id === match.id ? 'selected' : ''}>
                ${stIcon} Trận #${m.matchNumber} (Lượt ${m.wave} - Bảng ${m.bracket}): ${rT.className} vs ${bT.className}
              </option>`;
            }).join('')}
          </select>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
            <button class="btn btn-outline" onclick="window.TCApp.setMatchLiveOnArena('${match.id}')">
              📡 Đưa trận này lên Khung Đếm Ngược OBS
            </button>
            <button class="btn btn-amber" onclick="window.TCApp.swapMatchSides('${match.id}')" title="Đổi phần sân Đỏ (Trái) ⇄ Xanh (Phải) của trận này">
              🔄 Đổi Sân Đỏ ⇄ Xanh
            </button>
            ${nextMatch ? `
              <span style="font-size:12px;color:#93c5fd;align-self:center;">
                ⏭ <b>Next Round (Khung dưới OBS):</b> Trận #${nextMatch.matchNumber} (Bảng ${nextMatch.bracket}) — ${nextRed.className} vs ${nextBlue.className}
              </span>
            ` : ''}
          </div>
        </div>

        <!-- ĐỒNG HỒ BẤM GIỜ 90 GIÂY VÒNG 2 (HIỂN THỊ TRỰC TIẾP Ở KHUNG TRÊN BÊN PHẢI OBS) -->
        <div class="ref-timer-panel">
          <div class="timer-left-info">
            <div class="js-timer-phase timer-phase-badge">LƯỢT THÀNH VIÊN 1 ĐIỀU KHIỂN</div>
            <div class="js-timer-sub timer-sub-text">Đang đồng bộ trực tiếp sang Khung Trên Bên Phải của màn hình OBS</div>
          </div>
          <div class="js-timer-display timer-digits">01:30</div>
          <div class="timer-btn-group">
            <button class="js-timer-toggle-btn btn btn-emerald" onclick="window.TCApp.toggleTimer()">▶ Bắt đầu đếm ngược 90s</button>
            <button class="btn btn-amber" onclick="window.TCApp.unlockScoringEarly()" title="Dùng khi 2 đội đã về đích trước 90s hoặc muốn nhập điểm ngay">
              ⏹ Hết giờ &amp; Mở khóa điền điểm
            </button>
            <button class="btn btn-outline" onclick="window.TCApp.setTimerMode('match')">🔄 Reset 90s</button>
            <button class="btn btn-outline" onclick="window.TCApp.setTimerMode('prep')">⏱ 30s Chuẩn bị</button>
          </div>
        </div>
      </div>

      <!-- BANNER TRẠNG THÁI: ĐẾM NGƯỢC -> HẾT GIỜ MỚI ĐIỀN ĐIỂM -> BẤM HIỂN THỊ LÊN MÀN HÌNH -->
      <div class="scoring-lock-banner ${isAlreadyPublished ? 'already-revealed' : (isTimeUpOrUnlocked ? 'ready-to-score' : '')}">
        <div>
          <div style="font-weight:800;font-size:15px;color:#fff;">
            ${isAlreadyPublished
              ? `✅ TRẬN #${match.matchNumber} ĐÃ CHỐT & ĐANG HIỂN THỊ KẾT QUẢ TRÊN MÀN HÌNH OBS! (Đỏ: ${match.redScore}đ — Xanh: ${match.blueScore}đ)`
              : (isTimeUpOrUnlocked
                  ? `✍️ ĐÃ HẾT GIỜ THI ĐẤU! MỜI TRỌNG TÀI ĐIỀN ĐIỂM 2 ĐỘI BÊN DƯỚI (Màn hình OBS đang chờ bạn bấm Công bố)`
                  : `🔒 ĐANG TRONG THỜI GIAN ĐẾM NGƯỢC (Màn hình OBS chỉ hiện đồng hồ đếm ngược, hết giờ mới mở điền điểm)`)}
          </div>
          <div style="font-size:12px;color:#cbd5e1;margin-top:3px;">
            ${isTimeUpOrUnlocked
              ? 'Sau khi điền xong số cốc & lỗi của 2 đội, hãy bấm nút "🚀 CHỐT ĐIỂM & HIỂN THỊ RA MÀN HÌNH OBS" ở dưới cùng!'
              : 'Nếu 2 đội hoàn thành bài thi sớm trước 90s, bấm nút "⏹ Hết giờ & Mở khóa điền điểm" bên dưới để nhập điểm ngay.'}
          </div>
        </div>
        <div>
          ${!isTimeUpOrUnlocked ? `
            <button class="btn btn-amber" onclick="window.TCApp.unlockScoringEarly()">
              🔓 Mở khóa điền điểm ngay
            </button>
          ` : `
            <button class="btn btn-emerald" onclick="window.TCApp.publishScoreToOBS('${match.id}')">
              🚀 Chốt Điểm &amp; Hiển Thị Lên Màn Hình OBS
            </button>
          `}
        </div>
      </div>

      <!-- 2 BẢNG CHẤM ĐIỂM SONG SONG: SÂN ĐỎ (TRÁI) & SÂN XANH (PHẢI) -->
      <div class="ref-pads-grid ${isTimeUpOrUnlocked ? '' : 'pads-locked'}">
        ${renderTeamScorePad(match, 'red')}
        ${renderTeamScorePad(match, 'blue')}
      </div>

      <div class="ref-bottom-actions">
        <div class="formula-note">
          💡 <b>Quy trình chuẩn OBS:</b>
          <code>1. Bấm đếm ngược 90s</code> ➔ <code>2. Hết giờ điền điểm Đỏ &amp; Xanh</code> ➔ <code>3. Bấm Hiển thị ra màn hình OBS</code> ➔ <code>4. Qua Next Round</code>
        </div>
        <div class="ref-action-btns" style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-emerald btn-lg" onclick="window.TCApp.publishScoreToOBS('${match.id}')">
            🚀 1. CHỐT ĐIỂM &amp; HIỂN THỊ RA MÀN HÌNH OBS (TRẬN #${match.matchNumber})
          </button>
          <button class="btn btn-amber btn-lg" onclick="window.TCApp.advanceNextRound('${match.id}')">
            ⏭ 2. QUA TRẬN TIẾP THEO (ĐẨY NEXT ROUND LÊN SÂN) ➔
          </button>
        </div>
      </div>
    `;
  }

  // ==================== VIEW 3: LỊCH THI ĐẤU XEN KẼ BẢNG A & BẢNG B ====================
  function renderScheduleView() {
    const metrics = Engine.analyzeScheduleMetrics(state.matches);
    const filtered = state.matches.filter(m => {
      if (scheduleFilter === 'A') return m.bracket === 'A';
      if (scheduleFilter === 'B') return m.bracket === 'B';
      if (scheduleFilter === 'pending') return m.status !== 'completed';
      return true;
    });

    return `
      <div class="schedule-header-card">
        <div>
          <h2>📅 LỊCH THI ĐẤU VÒNG 2 (XEN KẼ BẢNG A & BẢNG B TRÊN 01 SA BÀN)</h2>
          <p class="schedule-sub">
            Mỗi đội thi đúng <b>02 lượt</b> (1 lượt Sân Đỏ + 1 lượt Sân Xanh) •
            <b>Không gặp lại đối thủ cũ</b> •
            <b>Không xếp trận của 1 đội gần nhau</b> (Khoảng nghỉ tối thiểu giữa 2 lượt: <b>${metrics.minGap} trận</b>)
          </p>
        </div>
        <div class="schedule-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-emerald" onclick="window.TCApp.exportSchedulePDF()">
            📄 Tải Lịch Thi Đấu (PDF)
          </button>
          <button class="btn btn-outline" onclick="window.TCApp.resetMatchOrderToFirst()">
            ⏮ Đưa Về Trận #1
          </button>
          <button class="btn btn-outline" onclick="window.TCApp.clearAllScoresToZero()">
            🧹 Xóa Điểm Về 0đ (Tiến độ 0/${state.matches.length})
          </button>
          <button class="btn btn-amber" onclick="window.TCApp.redrawSchedule()">
            🎲 Bốc Thăm Lại Thứ Tự Trận
          </button>
          <button class="btn btn-outline" onclick="window.TCApp.exportCSV()">
            📥 Xuất Lịch &amp; Bảng Điểm (.CSV)
          </button>
        </div>
      </div>

      <div class="ranking-toolbar">
        <div class="toolbar-left">
          <span class="toolbar-label">LỌC LỊCH THI ĐẤU:</span>
          <button class="btn-filter ${scheduleFilter === 'all' ? 'active' : ''}" onclick="window.TCApp.setScheduleFilter('all')">
            Tất cả (${state.matches.length} trận)
          </button>
          <button class="btn-filter ${scheduleFilter === 'A' ? 'active' : ''}" onclick="window.TCApp.setScheduleFilter('A')">
            ⚡ Bảng A - Junior Coder (${state.matches.filter(x=>x.bracket==='A').length} trận)
          </button>
          <button class="btn-filter ${scheduleFilter === 'B' ? 'active' : ''}" onclick="window.TCApp.setScheduleFilter('B')">
            🔥 Bảng B - Teen Coder (${state.matches.filter(x=>x.bracket==='B').length} trận)
          </button>
          <button class="btn-filter ${scheduleFilter === 'pending' ? 'active' : ''}" onclick="window.TCApp.setScheduleFilter('pending')">
            ⏳ Chưa thi đấu (${state.matches.filter(x=>x.status==='pending').length})
          </button>
        </div>
        <div class="toolbar-right">
          <span class="metric-chip">✅ Trùng cặp đấu: <b>${metrics.duplicatePairs}</b></span>
          <span class="metric-chip">✅ Cách lượt tối thiểu: <b>${metrics.minGap} trận</b></span>
        </div>
      </div>

      <div class="tpc-table-wrap">
        <table class="tpc-table schedule-table">
          <thead>
            <tr>
              <th>TRẬN / ĐỔI THỨ TỰ</th>
              <th>VÒNG LƯỢT</th>
              <th>BẢNG ĐẤU (XEN KẼ A/B)</th>
              <th>🔴 ĐỘI SÂN ĐỎ (BÊN TRÁI) & 2 HỌC SINH</th>
              <th class="text-center">TỶ SỐ ĐIỂM</th>
              <th>🔵 ĐỘI SÂN XANH (BÊN PHẢI) & 2 HỌC SINH</th>
              <th>TRẠNG THÁI / THAO TÁC</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(m => {
              const rT = getTeamById(m.redTeamId);
              const bT = getTeamById(m.blueTeamId);
              const rS = m.status === 'completed' ? m.redScore : (m.status === 'live' ? Engine.calculateSheetScore(m.redSheet, m.bracket) : '—');
              const bS = m.status === 'completed' ? m.blueScore : (m.status === 'live' ? Engine.calculateSheetScore(m.blueSheet, m.bracket) : '—');

              return `
                <tr class="tpc-row ${m.status === 'live' ? 'row-is-live' : ''}">
                  <td>
                    <div style="display:flex;align-items:center;gap:4px;">
                      <b class="match-num-badge">#${m.matchNumber}</b>
                      <button class="btn-xs btn-outline" style="padding:2px 5px;" title="Đẩy trận này lên trước" onclick="window.TCApp.moveMatchOrder('${m.id}', -1)">⬆️</button>
                      <button class="btn-xs btn-outline" style="padding:2px 5px;" title="Đẩy trận này xuống sau" onclick="window.TCApp.moveMatchOrder('${m.id}', 1)">⬇️</button>
                    </div>
                  </td>
                  <td><span class="wave-badge">Lượt ${m.wave}</span></td>
                  <td>
                    <span class="bracket-pill ${m.bracket === 'A' ? 'bracket-a' : 'bracket-b'}">
                      ${m.bracket === 'A' ? '⚡ Bảng A (VEX GO)' : '🔥 Bảng B (VEX IQ)'}
                    </span>
                  </td>
                  <td>
                    <div class="sched-team-name red-text">${rT.className} <small>(${rT.code} • Lượt ${m.redTurn})</small></div>
                    <div class="sched-stu-names">👤 ${rT.student1} &nbsp;•&nbsp; 👤 ${rT.student2}</div>
                  </td>
                  <td class="text-center">
                    <div class="sched-score-pill">
                      <span class="red-text">${rS}</span> : <span class="blue-text">${bS}</span>
                    </div>
                  </td>
                  <td>
                    <div class="sched-team-name blue-text">${bT.className} <small>(${bT.code} • Lượt ${m.blueTurn})</small></div>
                    <div class="sched-stu-names">👤 ${bT.student1} &nbsp;•&nbsp; 👤 ${bT.student2}</div>
                  </td>
                  <td>
                    <div class="sched-btn-group">
                      <button class="btn-xs ${m.status === 'live' ? 'btn-amber' : 'btn-outline'}" onclick="window.TCApp.setMatchLiveOnArena('${m.id}')">
                        ${m.status === 'live' ? '🔴 Đang trên sân' : '📡 Đưa lên sân'}
                      </button>
                      <button class="btn-xs btn-emerald" onclick="window.TCApp.selectMatchForScoring('${m.id}', true)">
                        ✏️ Điền điểm
                      </button>
                      <button class="btn-xs btn-outline" onclick="window.TCApp.swapMatchSides('${m.id}')" title="Đổi phần sân Đỏ ⇄ Xanh của trận này">
                        🔄 Đổi Sân
                      </button>
                      <button class="btn-xs btn-outline" onclick="window.TCApp.clearSingleMatchScore('${m.id}')" title="Xóa điểm trận này về Chưa thi (0-0)">
                        🧹 Reset trận
                      </button>
                      <button class="btn-xs btn-outline" onclick="window.TCApp.exportParentTeamPDF('${m.redTeamId}')" title="Xuất PDF kết quả Đội Đỏ gửi Phụ huynh">
                        📑 PDF Đỏ
                      </button>
                      <button class="btn-xs btn-outline" onclick="window.TCApp.exportParentTeamPDF('${m.blueTeamId}')" title="Xuất PDF kết quả Đội Xanh gửi Phụ huynh">
                        📑 PDF Xanh
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==================== VIEW 4: ĐỘI THI & ĐỒNG BỘ GOOGLE SHEETS ====================
  function renderTeamsAndSyncView() {
    const countA = state.teams.filter(t => t.bracket === 'A').length;
    const countB = state.teams.filter(t => t.bracket === 'B').length;
    return `
      <!-- 1. Ô DÁN LINK GOOGLE SHEET BẤT KỲ ĐỂ TỰ ĐỘNG CÀO DATA BẢNG ĐẤU -->
      <div class="sync-card" style="margin-bottom: 18px; border: 1px solid rgba(56, 189, 248, 0.45);">
        <h3>🕷️ CÁCH 1: DÁN LINK GOOGLE SHEET ĐỂ TỰ ĐỘNG CÀO BẢNG ĐẤU (BẢNG A / BẢNG B / CẢ 2 BẢNG)</h3>
        <p class="sync-desc">
          Dán nguyên đường link Google Sheet trên thanh địa chỉ trình duyệt (có cả <code>https://docs.google.com/spreadsheets/d/.../edit#gid=...</code>) vào ô bên dưới, sau đó chọn cào toàn bộ 2 bảng hoặc cào riêng từng bảng:
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <input type="text" id="custom-sheet-url-input" class="input-text" style="flex:1;min-width:300px;"
            placeholder="Dán nguyên link Google Sheet của bạn vào đây (VD: https://docs.google.com/spreadsheets/d/.../edit#gid=...)"
            value="${state.config.customSheetUrl || state.config.yearEndSheetId}" />
          <button class="btn btn-emerald" onclick="window.TCApp.scrapeCustomSheetUrl(document.getElementById('custom-sheet-url-input').value, 'replace_both')">
            🕷️ Cào &amp; Tạo Mới Cả 2 Bảng (A &amp; B)
          </button>
          <button class="btn btn-amber" onclick="window.TCApp.scrapeCustomSheetUrl(document.getElementById('custom-sheet-url-input').value, 'replace_A')">
            ⚡ Cào Riêng Vào Bảng A (Junior)
          </button>
          <button class="btn btn-amber" onclick="window.TCApp.scrapeCustomSheetUrl(document.getElementById('custom-sheet-url-input').value, 'replace_B')">
            🔥 Cào Riêng Vào Bảng B (Teen)
          </button>
          <button class="btn btn-outline" onclick="window.TCApp.scrapeCustomSheetUrl(document.getElementById('custom-sheet-url-input').value, 'update_existing')">
            📝 Chỉ Cập Nhật Tên Học Sinh
          </button>
        </div>
      </div>

      <!-- 2. Ô COPY - PASTE TRỰC TIẾP TỪ EXCEL / GOOGLE SHEET (KHÔNG CẦN MỞ QUYỀN PUBLIC SHEET) -->
      <div class="sync-card" style="margin-bottom: 18px; border: 1px solid rgba(251, 191, 36, 0.45);">
        <h3>📋 CÁCH 2: COPY — PASTE TRỰC TIẾP DỮ LIỆU ĐỘI TỪ EXCEL / GOOGLE SHEET</h3>
        <p class="sync-desc">
          Nếu file Google Sheet đang khóa quyền riêng tư, bạn chỉ cần bôi đen các dòng danh sách lớp &amp; học sinh trên Excel / Google Sheet rồi <code>Ctrl+C</code> ➔ dán (<code>Ctrl+V</code>) vào ô dưới đây (Mỗi dòng dạng: <code>Mã Lớp [Tab] Học sinh 1 [Tab] Học sinh 2</code> hoặc cấu trúc 2 dòng gộp ô của MindX):
        </p>
        <textarea id="paste-bracket-textarea" class="input-text" rows="4" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px;"
          placeholder="Ví dụ dán trực tiếp từ Excel/Sheet:&#10;TN-ROB-ARMA17&#9;Bùi Minh Khôi&#9;Nguyễn Bội Nhi&#10;TN-ROB-ARMA20&#9;Dương Đức Anh&#9;Bùi Quang Minh"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn btn-amber" onclick="window.TCApp.parsePastedBracket(document.getElementById('paste-bracket-textarea').value, 'A')">
            ⚡ Nạp Dữ Liệu Đã Dán Vào Bảng A (Junior)
          </button>
          <button class="btn btn-emerald" onclick="window.TCApp.parsePastedBracket(document.getElementById('paste-bracket-textarea').value, 'B')">
            🔥 Nạp Dữ Liệu Đã Dán Vào Bảng B (Teen)
          </button>
          <button class="btn btn-outline" onclick="document.getElementById('paste-bracket-textarea').value=''">
            🧹 Xóa Ô Dán
          </button>
        </div>
      </div>

      <div class="sync-hub-grid">
        <div class="sync-card">
          <h3>🔗 3. Đồng bộ tự động với 2 File Google Sheet Mặc Định</h3>
          <p class="sync-desc">
            Kết nối sẵn với ID 2 file Google Sheet của MindX Thái Nguyên để tự động chọn ra <b>02 đại diện xuất sắc nhất</b> mỗi lớp vào Vòng 2:
          </p>
          <div class="form-group">
            <label>ID Sheet 1: FORM CHẤM ĐIỂM - TECHCLASH 2026 (30 Lớp Vòng 1)</label>
            <input type="text" class="input-text" value="${state.config.vong1SheetId}"
              onchange="window.TCApp.updateConfig('vong1SheetId', this.value)" />
          </div>
          <div class="form-group">
            <label>ID Sheet 2: TN-ROBOTICS YEAR END MÙA 2 - 2026 (Tab: DS - HS vượt qua vòng 1)</label>
            <input type="text" class="input-text" value="${state.config.yearEndSheetId}"
              onchange="window.TCApp.updateConfig('yearEndSheetId', this.value)" />
          </div>
          <div class="sync-btn-row">
            <button id="btn-sync-vong1" class="btn btn-emerald" onclick="window.TCApp.syncFromVong1Form()">
              ⚡ Quét tự động Top 2 từ Sheet Chấm Điểm Vòng 1
            </button>
            <button class="btn btn-outline" onclick="window.TCApp.syncFromDSSheet()">
              📥 Đọc danh sách từ tab "DS - HS vượt qua vòng 1"
            </button>
          </div>
        </div>

        <div class="sync-card">
          <h3>🛠️ 4. Công Cụ Xóa Data, Reset Trận &amp; Khôi Phục</h3>
          <p class="sync-desc">
            Quản lý nhanh toàn bộ dữ liệu đội thi, xóa trắng từng bảng để nạp lại, hoặc reset thứ tự các trận đấu và tiến độ về <code>0/N</code>:
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
            <button class="btn btn-amber" onclick="window.TCApp.clearAllScoresToZero()">
              🧹 Xóa Điểm Về 0đ (Tiến độ 0/${state.matches.length})
            </button>
            <button class="btn btn-outline" onclick="window.TCApp.resetMatchOrderToFirst()">
              ⏮ Reset Về Trận #1
            </button>
            <button class="btn btn-outline" onclick="window.TCApp.redrawSchedule(false)">
              🎲 Bốc Thăm Lại Lịch Xen Kẽ A-B
            </button>
            <button class="btn btn-outline" style="border-color:#ef4444;color:#fca5a5;" onclick="window.TCApp.wipeBracketData('A')">
              🗑️ Xóa Trắng Bảng A (${countA} đội)
            </button>
            <button class="btn btn-outline" style="border-color:#ef4444;color:#fca5a5;" onclick="window.TCApp.wipeBracketData('B')">
              🗑️ Xóa Trắng Bảng B (${countB} đội)
            </button>
            <button class="btn btn-outline" style="border-color:#ef4444;color:#fca5a5;" onclick="window.TCApp.wipeAllTeamsAndMatches()">
              🗑️ Xóa Trắng Cả 2 Bảng &amp; Lịch
            </button>
            <button class="btn btn-emerald" onclick="window.TCApp.resetDefaultData()">
              🔄 Khôi Phục Data Mặc Định (31 Đội)
            </button>
          </div>
        </div>
      </div>

      <!-- BẢNG CHỈNH SỬA TRỰC TIẾP DANH SÁCH ĐỘI & TÊN 2 HỌC SINH -->
      <div class="tpc-board-panel" style="margin-top: 20px;">
        <div class="tpc-board-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <h2 class="tpc-board-title">📋 DANH SÁCH ${state.teams.length} ĐỘI TUYỂN VÒNG 2 (BẢNG A: ${countA} ĐỘI • BẢNG B: ${countB} ĐỘI)</h2>
            <div class="tpc-board-sub">Bạn có thể sửa trực tiếp Mã Lớp, Tên Học Sinh, Thêm/Xóa đội rồi bấm "Bốc thăm lại lịch đấu"</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-xs btn-amber" onclick="window.TCApp.addNewTeam('A')">+ Thêm Đội Bảng A</button>
            <button class="btn-xs btn-emerald" onclick="window.TCApp.addNewTeam('B')">+ Thêm Đội Bảng B</button>
            <button class="btn-xs btn-outline" onclick="window.TCApp.redrawSchedule(false)">🎲 Cập Nhật &amp; Xếp Lại Lịch Đấu</button>
          </div>
        </div>
        <div class="tpc-table-wrap">
          <table class="tpc-table">
            <thead>
              <tr>
                <th>BẢNG</th>
                <th>MÃ ĐỘI</th>
                <th>LỚP ĐẠI DIỆN</th>
                <th>GV (LEC)</th>
                <th>HỌC SINH ĐẠI DIỆN 1</th>
                <th>HỌC SINH ĐẠI DIỆN 2</th>
                <th>ĐIỂM TB VÒNG 1</th>
                <th>THAM GIA</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              ${state.teams.map(t => `
                <tr class="tpc-row">
                  <td>
                    <span class="bracket-pill ${t.bracket === 'A' ? 'bracket-a' : 'bracket-b'}">
                      ${t.bracket === 'A' ? 'Bảng A (Junior)' : 'Bảng B (Teen)'}
                    </span>
                  </td>
                  <td><b>${t.code}</b></td>
                  <td>
                    <input type="text" class="input-inline" style="width:135px;font-weight:700;" value="${t.className}"
                      onchange="window.TCApp.updateTeamField('${t.id}','className',this.value)" />
                  </td>
                  <td>
                    <input type="text" class="input-inline" style="width:85px" value="${t.lec || ''}"
                      onchange="window.TCApp.updateTeamField('${t.id}','lec',this.value)" />
                  </td>
                  <td>
                    <input type="text" class="input-inline" value="${t.student1}"
                      onchange="window.TCApp.updateTeamField('${t.id}','student1',this.value)" />
                  </td>
                  <td>
                    <input type="text" class="input-inline" value="${t.student2}"
                      onchange="window.TCApp.updateTeamField('${t.id}','student2',this.value)" />
                  </td>
                  <td><b>${t.v1Avg || 0}</b></td>
                  <td>
                    <input type="checkbox" ${t.active !== false ? 'checked' : ''}
                      onchange="window.TCApp.updateTeamField('${t.id}','active',this.checked)" />
                  </td>
                  <td>
                    <div style="display:flex;gap:6px;">
                      <button class="btn-xs btn-emerald" onclick="window.TCApp.exportParentTeamPDF('${t.id}')">
                        📑 PDF
                      </button>
                      <button class="btn-xs btn-outline" style="border-color:#ef4444;color:#fca5a5;" onclick="window.TCApp.deleteTeam('${t.id}')">
                        🗑️ Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== PUBLIC API GẮN VÀO WINDOW ====================
  window.TCApp = {
    switchTab(tab) {
      activeTab = tab;
      renderAll();
    },
    setBracketFilter(f) {
      bracketFilter = f;
      renderAll();
    },
    setScheduleFilter(f) {
      scheduleFilter = f;
      renderAll();
    },
    setRankBy(mode) {
      state.config.rankBy = mode;
      saveState(true, false);
    },
    toggleAutoRotate() {
      if (autoRotateTimer) {
        clearInterval(autoRotateTimer);
        autoRotateTimer = null;
        showToast('⏹ Đã tắt chế độ tự động đảo bảng.', 'info');
      } else {
        bracketFilter = 'A';
        autoRotateTimer = setInterval(() => {
          bracketFilter = bracketFilter === 'A' ? 'B' : 'A';
          renderAll();
        }, (state.config.autoRotateSec || 15) * 1000);
        showToast('🔄 Đã bật chế độ tự động đảo Bảng A / Bảng B mỗi 15 giây!', 'success');
      }
      renderAll();
    },
    toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    },
    selectMatchForScoring,
    setMatchLiveOnArena,
    stepScore(matchId, side, field, delta) {
      updateScoreField(matchId, side, field, delta, false, false);
    },
    toggleScore(matchId, side, field) {
      updateScoreField(matchId, side, field, 0, true, false);
    },
    setDirectScore(matchId, side, val) {
      updateScoreField(matchId, side, 'manualOverride', val, false, true);
    },
    completeMatch: completeCurrentMatchAndAdvance,
    unlockScoringEarly,
    publishScoreToOBS: publishScoreToOBSScreen,
    advanceNextRound: advanceToNextRoundOnArena,
    setOBSView(viewMode) {
      if (viewMode !== 'video_full' && this.stopAdminVideoMonitor) {
        this.stopAdminVideoMonitor();
      }
      const tInput = document.getElementById('admin-transition-title');
      const sInput = document.getElementById('admin-transition-sub');
      if (tInput && tInput.value.trim()) state.config.transitionTitle = tInput.value.trim();
      if (sInput && sInput.value.trim()) state.config.transitionSub = sInput.value.trim();
      if (viewMode === 'chroma_green' || viewMode === 'camera' || viewMode === 'camera_full' || viewMode === 'cutout_clean') {
        state.config.cutoutType = viewMode;
      }
      state.config.obsMainView = viewMode;
      const autoTitle = viewMode === 'ranking_B'
        ? 'BẢNG XẾP HẠNG LIVE • BẢNG B (TEEN CODER)'
        : (viewMode === 'ranking_A'
            ? 'BẢNG XẾP HẠNG LIVE • BẢNG A (JUNIOR CODER)'
            : (viewMode === 'result' ? 'KẾT QUẢ CHÍNH THỨC' : (state.config.transitionTitle || 'TECH CLASH: FINALE 2026')));
      state.config.transitionTrigger = {
        id: Date.now(),
        title: autoTitle,
        subtitle: state.config.transitionSub || 'MINDX THÁI NGUYÊN • VÒNG 2 ĐỒNG ĐỘI'
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
      }
      const labelMap = {
        ranking_A: 'Bảng Xếp Hạng Bảng A (Junior Coder - 12 Đội)',
        ranking_B: 'Bảng Xếp Hạng Bảng B (Teen Coder - 19 Đội)',
        ranking_split: 'Bảng Xếp Hạng Bảng A',
        result: 'Kết Quả Trận Đấu',
        camera: 'Đục Lỗ Alpha + Giữ Khung Chữ Trên Đầu',
        camera_full: 'Video To Toàn Màn (Full Khung, Không Chữ)',
        cutout_clean: 'Đục Lỗ Trống 100% Khung Lớn',
        chroma_green: 'Đục Lỗ Xanh Lá (Chroma Key) + Giữ Khung Chữ Trên Đầu'
      };
      showToast('Đã bắn Transitions (3s + Sound Effect) & chuyển OBS sang: ' + (labelMap[viewMode] || viewMode), 'success');
    },
    toggleOBSBracketTransition() {
      const nextView = state.config.obsMainView === 'ranking_A' ? 'ranking_B' : 'ranking_A';
      this.setOBSView(nextView);
    },
    toggleOBSBgMode() {
      state.config.obsBgMode = state.config.obsBgMode === 'transparent' ? 'image' : 'transparent';
      saveState(true, false);
      showToast(
        state.config.obsBgMode === 'transparent'
          ? 'Đã bật chế độ Nền Trong Suốt Toàn Màn trên OBS!'
          : 'Đã bật lại ảnh nền trên OBS!',
        'info'
      );
    },
    toggleOBSBackdropVariant() {
      state.config.obsBgVariant = state.config.obsBgVariant === 'tn' ? 'default' : 'tn';
      saveState(true, false);
      showToast(
        state.config.obsBgVariant === 'tn'
          ? '🖼 Đã đổi Backdrop sang nền Logo MindX Thái Nguyên (TN)!'
          : '🖼 Đã khôi phục Backdrop về nền MindX Gốc ban đầu!',
        'success'
      );
    },
    triggerOBSTransition(title, subtitle) {
      const tVal = (title || '').trim() || 'TECH CLASH: FINALE 2026';
      const sVal = (subtitle || '').trim() || 'MINDX THÁI NGUYÊN • VÒNG 2 ĐỒNG ĐỘI';
      state.config.transitionTitle = tVal;
      state.config.transitionSub = sVal;
      state.config.transitionTrigger = {
        id: Date.now(),
        title: tVal,
        subtitle: sVal
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
      }
      showToast('Đã bắn hiệu ứng Transitions (1.5s + Sound Effect): ' + tVal, 'success');
    },
    triggerTNSmashTransition() {
      state.config.obsBgVariant = 'tn';
      state.config.transitionTrigger = {
        id: Date.now(),
        mode: 'tn_smash',
        title: 'MINDX THÁI NGUYÊN • LÊN NGÔI',
        subtitle: 'TECHCLASH 2026'
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
        if (window.VexIQSound) {
          setTimeout(() => { window.VexIQSound.playStart(); }, 480);
        }
      }
      showToast('👑 Đã chạy Transitions đá bay MindX sang trái & đổi Backdrop sang Logo TN! (Bấm Switch Backdrop để về nền gốc)', 'success');
    },
    startAdminVideoMonitor(srcPath, title) {
      const monitor = document.getElementById('admin-video-monitor');
      const player = document.getElementById('admin-video-player');
      const status = document.getElementById('admin-video-status');
      if (!player) return;
      if (monitor) monitor.style.display = 'flex';
      if (status) status.textContent = '🔊 Đang phát loa Admin: ' + (title || 'Video');
      player.muted = false;
      player.volume = 1.0;
      player.src = srcPath;
      player.load();
      player.play().catch(err => {
        console.warn('Admin video play error:', err);
      });
      player.onended = () => {
        if (status) status.textContent = '⏹ Đã phát xong: ' + (title || 'Video');
      };
    },
    stopAdminVideoMonitor() {
      const monitor = document.getElementById('admin-video-monitor');
      const player = document.getElementById('admin-video-player');
      if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
      if (monitor) monitor.style.display = 'none';
    },
    playLocalVideo(srcPath, title) {
      if (!srcPath) return;
      state.config.activeVideo = {
        src: srcPath,
        title: title || 'Video Phỏng Vấn',
        playId: Date.now()
      };
      state.config.obsMainView = 'video_full';
      state.config.transitionTrigger = {
        id: Date.now(),
        title: title || 'VIDEO PHỎNG VẤN',
        subtitle: 'MINDX THÁI NGUYÊN • TECHCLASH 2026'
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
      }
      this.startAdminVideoMonitor(srcPath, title);
      showToast('🎬 Đang phát Full Màn Hình + Loa Admin: ' + (title || srcPath), 'success');
    },
    playDriveVideo(fileId, title) {
      if (!fileId) return;
      state.config.activeVideo = {
        id: fileId,
        title: title || 'Video Phỏng Vấn',
        playId: Date.now()
      };
      state.config.obsMainView = 'video_full';
      state.config.transitionTrigger = {
        id: Date.now(),
        title: title || 'VIDEO PHỎNG VẤN',
        subtitle: 'MINDX THÁI NGUYÊN • TECHCLASH 2026'
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
      }
      showToast('🎬 Đang phát Full Màn Hình (Không khung OBS): ' + (title || fileId), 'success');
    },
    stopFullscreenVideo() {
      this.stopAdminVideoMonitor();
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      state.config.activeVideo = null;
      state.config.transitionTrigger = {
        id: Date.now(),
        title: 'TRỞ LẠI SA BÀN THI ĐẤU',
        subtitle: 'TECHCLASH 2026'
      };
      saveState(true, false);
      if (state.config.transitionSound !== false) {
        this.playTransitionSFX();
      }
      showToast('⏹ Đã tắt Video Full Màn và quay lại khung OBS!', 'info');
    },
    async refreshDriveVideos() {
      try {
        showToast('🔄 Đang quét thư mục Google Drive Video Phỏng Vấn...', 'info');
        const res = await fetch(API_BASE + '/api/drive-videos?_t=' + Date.now());
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.videos)) {
          const box = document.getElementById('drive-video-buttons');
          if (box) {
            const btnsHtml = data.videos.map(v => {
              const safeTitle = v.title.replace(/'/g, "\\'");
              return `<button class="btn-xs btn-emerald" onclick="window.TCApp.playDriveVideo('${v.id}', '${safeTitle}')">▶ ${v.title}</button>`;
            }).join('');
            box.innerHTML = `
              <span style="font-size:12px;font-weight:800;color:#c084fc;">🎬 VIDEO PHỎNG VẤN FULL MÀN (GOOGLE DRIVE):</span>
              ${btnsHtml}
              <button class="btn-xs btn-amber" onclick="window.TCApp.stopFullscreenVideo()">⏹ Tắt Video Full Màn (Về OBS)</button>
              <button class="btn-xs btn-outline" onclick="window.TCApp.refreshDriveVideos()">🔄 Quét Lại Thư Mục Drive</button>
            `;
          }
          showToast('✅ Đã tìm thấy ' + data.videos.length + ' video trong thư mục Google Drive!', 'success');
        }
      } catch (e) {
        showToast('⚠️ Không quét được thư mục Drive: ' + e.message, 'error');
      }
    },
    toggleTransitionSound() {
      state.config.transitionSound = state.config.transitionSound === false ? true : false;
      if (window.VexIQSound) window.VexIQSound.setMuted(state.config.transitionSound === false);
      saveState(true, false);
      showToast(
        state.config.transitionSound
          ? 'Đã BẬT toàn bộ âm thanh VEX IQ & Transitions!'
          : 'Đã TẮT âm thanh!',
        'info'
      );
    },
    previewVexIQCountdown() {
      if (!window.VexIQSound) return;
      window.VexIQSound.setMuted(false);
      showToast('Đang phát thử âm thanh VEX IQ Competition: Start -> Ten, Nine, Eight... -> Switch!', 'info');
      window.VexIQSound.playStart();
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].forEach((n, idx) => {
        setTimeout(() => {
          window.VexIQSound.playCount(n);
        }, 1100 + idx * 850);
      });
      setTimeout(() => {
        window.VexIQSound.playSwitchHorn();
      }, 1100 + 10 * 850);
    },
    playTransitionSFX() {
      try {
        if (!window._tcStingerWavUrl) {
          const sampleRate = 44100;
          const duration = 3.0;
          const numSamples = Math.floor(sampleRate * duration);
          const buffer = new ArrayBuffer(44 + numSamples * 2);
          const view = new DataView(buffer);
          const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
          writeStr(0, 'RIFF');
          view.setUint32(4, 36 + numSamples * 2, true);
          writeStr(8, 'WAVE');
          writeStr(12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          writeStr(36, 'data');
          view.setUint32(40, numSamples * 2, true);

          let noiseState = 0, phaseSub = 0, phaseRiser = 0, phaseC1 = 0, phaseC2 = 0, phaseC3 = 0;
          for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            let sample = 0;
            const white = Math.random() * 2 - 1;
            if (t < 0.45) {
              const env = Math.sin((t / 0.45) * Math.PI);
              const alpha = 0.08 + 0.35 * (t / 0.45);
              noiseState = noiseState + alpha * (white - noiseState);
              const riserFreq = 110 * Math.pow(4.0, t / 0.45);
              phaseRiser += (2 * Math.PI * riserFreq) / sampleRate;
              sample += noiseState * env * 0.55 + Math.sin(phaseRiser) * env * 0.3;
            }
            if (t >= 0.36 && t < 1.95) {
              const dt = t - 0.36;
              const boomEnv = Math.exp(-dt * 4.5);
              const subFreq = 42 + 115 * Math.exp(-dt * 14);
              phaseSub += (2 * Math.PI * subFreq) / sampleRate;
              const subWave = Math.sin(phaseSub) * boomEnv * 0.75;
              const chordEnv = Math.min(1, dt / 0.03) * Math.exp(-dt * 2.1);
              phaseC1 += (2 * Math.PI * 261.63) / sampleRate;
              phaseC2 += (2 * Math.PI * 392.00) / sampleRate;
              phaseC3 += (2 * Math.PI * 523.25) / sampleRate;
              const chordWave = (Math.sin(phaseC1) * 0.35 + Math.sin(phaseC2) * 0.3 + Math.sin(phaseC3) * 0.25) * chordEnv * 0.45;
              const hitEnv = Math.exp(-dt * 22);
              sample += subWave + chordWave + white * hitEnv * 0.35;
            }
            if (t >= 2.15 && t < 2.95) {
              const dt2 = (t - 2.15) / 0.8;
              const env2 = Math.sin(dt2 * Math.PI);
              const alpha2 = 0.4 - 0.32 * dt2;
              noiseState = noiseState + alpha2 * (white - noiseState);
              const dropFreq = 360 * Math.pow(0.35, dt2);
              phaseRiser += (2 * Math.PI * dropFreq) / sampleRate;
              sample += noiseState * env2 * 0.5 + Math.sin(phaseRiser) * env2 * 0.22;
            }
            const clamped = Math.max(-1, Math.min(1, sample * 0.9));
            view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
          }
          window._tcStingerWavUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
        }
        const audio = new Audio(window._tcStingerWavUrl);
        audio.volume = 0.85;
        audio.play().catch(() => {});
      } catch (e) {}
    },
    getAdminPin() {
      return state.config.adminPin || '2026';
    },
    exportExcelWorkbook,
    exportFullPDF,
    exportSchedulePDF,
    exportParentTeamPDF,
    promptParentPDF() {
      const codeOrClass = prompt('Nhập Mã Đội (VD: A01, B07) hoặc Mã Lớp (VD: TN-ROB-ARMA17, TN-C4K-GI20) cần xuất PDF gửi Phụ huynh:', 'TN-ROB-ARMA17');
      if (!codeOrClass) return;
      const q = codeOrClass.trim().toUpperCase();
      const found = state.teams.find(t => t.id.toUpperCase() === q || t.className.toUpperCase().includes(q) || t.code.toUpperCase() === q);
      if (!found) {
        showToast('⚠️ Không tìm thấy đội "' + codeOrClass + '"!', 'warning');
        return;
      }
      exportParentTeamPDF(found.id);
    },
    scrapeCustomSheetUrl: scrapeFromAnyGoogleSheetUrl,
    parsePastedBracket: parsePastedBracketData,
    redrawSchedule,
    toggleTimer,
    setTimerMode,
    syncFromDSSheet: syncFromDSVong1Sheet,
    syncFromVong1Form: syncAll30ClassesFromVong1Form,
    exportCSV: exportScheduleAndRankingCSV,
    updateConfig(key, val) {
      state.config[key] = val.trim();
      saveState(true, false);
    },
    updateTeamField(teamId, field, val) {
      const t = state.teams.find(x => x.id === teamId);
      if (!t) return;
      t[field] = val;
      saveState(true, false);
    },
    clearAllScoresToZero() {
      if (!confirm('Xóa toàn bộ điểm các trận về 0 — 0, đưa thứ tự về Trận #1 và đặt Tiến Độ về 0/' + state.matches.length + ' để bắt đầu giải thật?')) return;
      if (liveSimTimer) {
        clearInterval(liveSimTimer);
        liveSimTimer = null;
      }
      Engine.populateDemoMatches(state.matches, 'clear');
      if (state.matches.length > 0) {
        state.matches.forEach((m, idx) => {
          m.status = idx === 0 ? 'live' : 'pending';
        });
        selectedMatchId = state.matches[0].id;
      }
      scoringUnlocked = false;
      state.config.customProgressText = '';
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      setTimerMode('match');
      saveState(true, true);
      showToast('Đã xóa toàn bộ điểm về 0đ, đưa về Trận #1 & Tiến độ 0/' + state.matches.length + '!', 'success');
    },
    resetMatchOrderToFirst() {
      if (state.matches.length === 0) return;
      stopTimer();
      scoringUnlocked = false;
      state.matches.forEach((m, idx) => {
        if (idx === 0) {
          m.status = 'live';
        } else if (m.redScore === null && m.blueScore === null) {
          m.status = 'pending';
        }
      });
      selectedMatchId = state.matches[0].id;
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      setTimerMode('match');
      saveState(true, true);
      showToast('Đã đưa thứ tự trận đang thi về lại Trận #1 (' + state.matches[0].id + ')!', 'info');
    },
    clearSingleMatchScore(matchId) {
      const m = state.matches.find(x => x.id === matchId);
      if (!m) return;
      m.redSheet = Engine.createEmptyScoreSheet();
      m.blueSheet = Engine.createEmptyScoreSheet();
      m.redScore = null;
      m.blueScore = null;
      m.status = 'pending';
      m.completedAt = null;
      saveState(true, true);
      showToast('Đã xóa điểm Trận #' + m.matchNumber + ' về Chưa thi (0 - 0)!', 'info');
    },
    swapMatchSides(matchId) {
      const m = state.matches.find(x => x.id === matchId);
      if (!m) return;
      const tmpId = m.redTeamId; m.redTeamId = m.blueTeamId; m.blueTeamId = tmpId;
      const tmpTurn = m.redTurn; m.redTurn = m.blueTurn; m.blueTurn = tmpTurn;
      const tmpSheet = m.redSheet; m.redSheet = m.blueSheet; m.blueSheet = tmpSheet;
      const tmpScore = m.redScore; m.redScore = m.blueScore; m.blueScore = tmpScore;
      saveState(true, true);
      const rT = getTeamById(m.redTeamId);
      const bT = getTeamById(m.blueTeamId);
      showToast('Đã đổi phần sân Trận #' + m.matchNumber + ': ĐỎ (' + rT.className + ') ⇄ XANH (' + bT.className + ')!', 'success');
    },
    moveMatchOrder(matchId, delta) {
      const idx = state.matches.findIndex(x => x.id === matchId);
      if (idx === -1) return;
      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= state.matches.length) return;
      const temp = state.matches[idx];
      state.matches[idx] = state.matches[targetIdx];
      state.matches[targetIdx] = temp;
      state.matches.forEach((m, i) => {
        m.matchNumber = i + 1;
        m.id = 'M' + String(i + 1).padStart(2, '0');
      });
      selectedMatchId = state.matches[targetIdx].id;
      saveState(true, true);
      showToast('Đã đổi vị trí sang Trận #' + (targetIdx + 1) + '!', 'info');
    },
    wipeBracketData(bracketCode) {
      if (!confirm('Bạn có chắc muốn xóa trắng toàn bộ đội của Bảng ' + bracketCode + ' để cào/nhập mới?')) return;
      state.teams = state.teams.filter(t => t.bracket !== bracketCode);
      state.matches = Engine.generateInterleavedSchedule(state.teams, false);
      if (state.matches.length > 0) {
        state.matches[0].status = 'live';
        selectedMatchId = state.matches[0].id;
      } else {
        selectedMatchId = null;
      }
      saveState(true, true);
      showToast('Đã xóa trắng Bảng ' + bracketCode + '!', 'warning');
    },
    wipeAllTeamsAndMatches() {
      if (!confirm('Xóa trắng toàn bộ danh sách Đội thi (Bảng A & Bảng B) và Lịch đấu để bạn cào mới hoàn toàn từ Google Sheet?')) return;
      stopTimer();
      state.teams = [];
      state.matches = [];
      selectedMatchId = null;
      state.config.customProgressText = '';
      saveState(true, true);
      activeTab = 'teams';
      renderAll();
      showToast('Đã xóa trắng toàn bộ Đội & Lịch đấu! Mời bạn dán Link Google Sheet hoặc Copy-Paste để nạp bảng đấu mới.', 'warning');
    },
    addNewTeam(bracketCode) {
      const bTeams = state.teams.filter(t => t.bracket === bracketCode);
      const nextNum = bTeams.length + 1;
      const code = bracketCode + String(nextNum).padStart(2, '0');
      const newTeam = {
        id: code + '_' + Date.now().toString().slice(-3),
        code,
        bracket: bracketCode,
        seed: nextNum,
        className: bracketCode === 'A' ? 'TN-ROB-ARM-MOI' : 'TN-C4K-GI-MOI',
        lec: '',
        student1: 'Học sinh 1',
        student2: 'Học sinh 2',
        v1Avg: 20,
        active: true
      };
      state.teams.push(newTeam);
      saveState(true, false);
      showToast('Đã thêm đội ' + code + ' vào Bảng ' + bracketCode + '! Sau khi sửa tên hãy bấm "Cập Nhật & Xếp Lại Lịch Đấu".', 'success');
    },
    deleteTeam(teamId) {
      const t = state.teams.find(x => x.id === teamId);
      if (!t) return;
      if (!confirm('Xóa đội ' + t.className + ' (' + t.code + ') khỏi danh sách thi đấu?')) return;
      state.teams = state.teams.filter(x => x.id !== teamId);
      state.matches = Engine.generateInterleavedSchedule(state.teams, false);
      if (state.matches.length > 0) {
        state.matches[0].status = 'live';
        selectedMatchId = state.matches[0].id;
      }
      saveState(true, true);
      showToast('Đã xóa đội ' + t.className + ' và cập nhật lại lịch đấu!', 'info');
    },
    setCustomProgressText(txt) {
      state.config.customProgressText = String(txt || '').trim();
      state.config.hideProgress = false;
      saveState(true, false);
      showToast(
        state.config.customProgressText
          ? 'Đã đặt chữ Tiến độ trên OBS: "' + state.config.customProgressText + '"'
          : 'Đã bật chế độ Tự động đếm Tiến độ trận (0/' + state.matches.length + ')!',
        'success'
      );
    },
    toggleHideProgress() {
      state.config.hideProgress = !state.config.hideProgress;
      saveState(true, false);
      showToast(
        state.config.hideProgress
          ? 'Đã ẨN thanh Tiến độ góc phải trên OBS!'
          : 'Đã HIỆN lại thanh Tiến độ góc phải trên OBS!',
        'info'
      );
    },
    resetDefaultData() {
      if (!confirm('Khôi phục dữ liệu 31 đội mặc định của MindX Thái Nguyên và đưa về Trận #1 (0/31)?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.teams = JSON.parse(JSON.stringify(Engine.INITIAL_TEAMS));
      state.matches = Engine.generateInterleavedSchedule(state.teams, false);
      Engine.populateDemoMatches(state.matches, 'clear');
      if (state.matches.length > 0) {
        state.matches[0].status = 'live';
        selectedMatchId = state.matches[0].id;
      }
      state.config.customProgressText = '';
      state.config.obsMainView = state.config.cutoutType || 'chroma_green';
      setTimerMode('match');
      saveState(true, true);
      showToast('Đã khôi phục 31 đội gốc mặc định & đặt về Trận #1 (Tiến độ 0/31)!', 'info');
    },
    loadDemoPreset(mode) {
      if (liveSimTimer) {
        clearInterval(liveSimTimer);
        liveSimTimer = null;
      }
      state.teams = JSON.parse(JSON.stringify(Engine.INITIAL_TEAMS));
      Engine.populateDemoMatches(state.matches, mode);
      const liveM = state.matches.find(x => x.status === 'live') || state.matches[0];
      if (liveM) selectedMatchId = liveM.id;
      saveState(true, false);
      if (mode === 'mid') {
        showToast('🔥 Đã nạp Test Data 31 Đội: Hoàn thành 18/31 trận, Trận #19 đang LIVE trên sa bàn!', 'success');
      } else if (mode === 'full') {
        showToast('🏆 Đã nạp Test Data Full 31/31 trận: Toàn bộ 31 đội đã hoàn thành đủ 2 lượt thi!', 'success');
      } else {
        showToast('🧹 Đã đặt lại toàn bộ điểm số 31 trận về 0 — 0 (Sẵn sàng chấm thi thật)!', 'info');
      }
    },
    toggleLiveSimulation() {
      if (liveSimTimer) {
        clearInterval(liveSimTimer);
        liveSimTimer = null;
        renderAll();
        showToast('⏹ Đã tạm dừng chế độ giả lập nhảy điểm tự động.', 'info');
        return;
      }
      // Nếu tất cả các trận đã completed thì nạp lại từ trận #12 để chạy giả lập cho hấp dẫn
      const hasPendingOrLive = state.matches.some(m => m.status === 'live' || m.status === 'pending');
      if (!hasPendingOrLive) {
        Engine.populateDemoMatches(state.matches, 'mid');
      }
      showToast('▶️ Đang chạy Auto-Sim: Tự động ghi điểm cốc & nhảy hạng BXH mỗi 1.4 giây!', 'success');
      let tick = 0;
      liveSimTimer = setInterval(() => {
        tick++;
        let liveM = state.matches.find(m => m.status === 'live');
        if (!liveM) {
          const nextP = state.matches.find(m => m.status === 'pending');
          if (!nextP) {
            clearInterval(liveSimTimer);
            liveSimTimer = null;
            renderAll();
            showToast('🏁 Đã giả lập xong toàn bộ 31/31 trận của giải đấu!', 'success');
            return;
          }
          nextP.status = 'live';
          liveM = nextP;
        }
        // Mỗi nhịp cộng ngẫu nhiên cốc cho Đỏ hoặc Xanh
        const sideSheet = (tick % 2 === 0) ? liveM.redSheet : liveM.blueSheet;
        const fields = liveM.bracket === 'B'
          ? ['big', 'med', 'small', 'stackBig', 'stackMed', 'special', 'parked']
          : ['big', 'med', 'small', 'special', 'parked'];
        const pick = fields[Math.floor(Math.random() * fields.length)];
        if (pick === 'special' || pick === 'parked') {
          sideSheet[pick] = 1;
        } else {
          sideSheet[pick] = Math.min(5, (sideSheet[pick] || 0) + 1);
        }
        liveM.redScore = Engine.calculateSheetScore(liveM.redSheet, liveM.bracket);
        liveM.blueScore = Engine.calculateSheetScore(liveM.blueSheet, liveM.bracket);

        // Sau mỗi 4 nhịp thì chốt trận hiện tại và tự nhảy sang trận kế tiếp
        if (tick % 4 === 0) {
          liveM.status = 'completed';
          const nextP = state.matches.find(m => m.status === 'pending');
          if (nextP) {
            nextP.status = 'live';
            selectedMatchId = nextP.id;
          }
        }
        saveState(true, false);
      }, 1400);
      renderAll();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderAll();
  });
})();
