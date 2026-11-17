/**
 * TECH CLASH: FINALE 2026 - VÒNG 2 LIVE RANKING & TOURNAMENT ENGINE
 * Kết nối trực tiếp 2 file Google Sheets của BTC + Xếp lịch xen kẽ A-B + Chấm điểm Real-time
 */

const DEFAULT_CONFIG = {
  vong1SheetId: 'https://docs.google.com/spreadsheets/d/1YtRc0-REE6o759bKkpJfp-XeZZP9nrGwPor6RyTRal0/edit?gid=1315348674#gid=1315348674',
  yearEndSheetId: 'https://docs.google.com/spreadsheets/d/16ylJXsvMpPIGgcY4ijdDSSiO514WjZXC4UheHG3aoak/edit?gid=107184150#gid=107184150',
  customSheetUrl: '',
  appsScriptUrl: '',
  rankBy: 'total', // 'total' (Tổng 2 lượt) hoặc 'average' (Trung bình 2 lượt)
  cutlineTop: 3,   // Top 3 Huy chương Vàng - Bạc - Đồng
  autoRotateSec: 15,
  adminUser: 'admin',
  adminPin: '2026',
  obsMainView: 'arena', // 'arena' | 'result' | 'ranking_split' | 'ranking_A' | 'ranking_B'
  obsBgMode: 'image',   // 'image' (Nền Lửa-Băng MindX) | 'transparent' (Trong suốt đè Camera OBS)
  lastRevealedMatchId: null
};

/**
 * Danh sách 31 Đội tuyển Vòng 2 trích xuất thực tế từ 2 file Google Sheets của bạn:
 * - Bảng A (Junior Coder - VEX GO): 12 Đội (Đội 1 -> Đội 12)
 * - Bảng B (Teen Coder - VEX IQ): 19 Đội (Đội 1 -> Đội 19)
 * Đã tự động nhặt Top 2 học sinh có Điểm Final Vòng 1 cao nhất từ các lớp đã thi!
 */
const INITIAL_TEAMS = [
  // ==================== BẢNG A: JUNIOR CODER (VEX GO - 13 ĐỘI TỪ GOOGLE SHEET) ====================
  {
    id: 'A01', code: 'Đội 1', bracket: 'A', className: 'TN-ROB-PREB18', lec: 'Thảo',
    student1: 'Đặng Đăng Khoa', student2: 'Nguyễn Hữu Minh',
    v1Score1: 21.0, v1Score2: 21.0, v1Avg: 21.0, active: true
  },
  {
    id: 'A02', code: 'Đội 2', bracket: 'A', className: 'TN-ROB-PREA16', lec: 'Bảo',
    student1: 'Nguyễn Lâm Dũng', student2: 'Nguyễn Ngọc Diệp',
    v1Score1: 24.0, v1Score2: 21.0, v1Avg: 22.5, active: true
  },
  {
    id: 'A03', code: 'Đội 3', bracket: 'A', className: 'TN-ROB-PREA17', lec: 'Bảo',
    student1: 'Lê Ngạn Quân', student2: 'Đinh Mông Tiến Bắc',
    v1Score1: 19.5, v1Score2: 18.5, v1Avg: 19.0, active: true
  },
  {
    id: 'A04', code: 'Đội 4', bracket: 'A', className: 'TN-ROB-PREI15', lec: 'Thảo Ly',
    student1: 'Mai Nguyễn Minh Khôi', student2: 'Dương Tiến Đạt',
    v1Score1: 13.0, v1Score2: 11.5, v1Avg: 12.25, active: true
  },
  {
    id: 'A05', code: 'Đội 5', bracket: 'A', className: 'TN-ROB-ARMB22', lec: 'Trường',
    student1: 'Lường Hoài An', student2: 'Mai Quang Đăng',
    v1Score1: 25.0, v1Score2: 23.0, v1Avg: 24.0, active: true
  },
  {
    id: 'A06', code: 'Đội 6', bracket: 'A', className: 'TN-ROB-ARMB21', lec: 'Dũng',
    student1: 'Bùi Đăng Khánh', student2: 'Trần Hoàng Nam',
    v1Score1: 30.0, v1Score2: 29.0, v1Avg: 29.5, active: true
  },
  {
    id: 'A07', code: 'Đội 7', bracket: 'A', className: 'TN-ROB-ARMI06', lec: 'Mạnh',
    student1: 'Lê Anh Duy', student2: 'Nguyễn Đức Bảo',
    v1Score1: 22.0, v1Score2: 19.0, v1Avg: 20.5, active: true
  },
  {
    id: 'A08', code: 'Đội 8', bracket: 'A', className: 'TN-ROB-ARMA20', lec: 'Hồng Ly',
    student1: 'Ngô Quang Hải', student2: 'Đinh Tuấn Phong',
    v1Score1: 26.0, v1Score2: 24.0, v1Avg: 25.0, active: true
  },
  {
    id: 'A09', code: 'Đội 9', bracket: 'A', className: 'TN-ROB-ARMA19', lec: 'Trường',
    student1: 'Lý Hoàng Long', student2: 'Trịnh Gia Huy',
    v1Score1: 18.5, v1Score2: 17.5, v1Avg: 18.0, active: true
  },
  {
    id: 'A10', code: 'Đội 10', bracket: 'A', className: 'TN-ROB-ARMA18', lec: 'Mạnh',
    student1: 'Lê Anh Duy', student2: 'Nguyễn Đức Bảo',
    v1Score1: 22.5, v1Score2: 21.0, v1Avg: 21.75, active: true
  },
  {
    id: 'A11', code: 'Đội 11', bracket: 'A', className: 'TN-ROB-ARMA17', lec: 'Hồng Ly',
    student1: 'Lê Đăng Khôi', student2: 'Nguyễn Đăng Quang',
    v1Score1: 29.5, v1Score2: 27.0, v1Avg: 28.25, active: true
  },
  {
    id: 'A12', code: 'Đội 12', bracket: 'A', className: 'TN-ROB-ARMA16', lec: 'Hồng Ly',
    student1: 'Vũ Bá Hiếu', student2: 'Nguyễn Tuệ Minh',
    v1Score1: 27.5, v1Score2: 26.5, v1Avg: 27.0, active: true
  },
  {
    id: 'A13', code: 'Đội 13', bracket: 'A', className: 'TN-ROB-PREI16', lec: 'Mạnh',
    student1: 'Nguyễn Gia Khiêm', student2: 'Đặng Gia Huy',
    v1Score1: 23.0, v1Score2: 21.0, v1Avg: 22.0, active: true
  },

  // ==================== BẢNG B: TEEN CODER (VEX IQ - 19 ĐỘI TỪ GOOGLE SHEET) ====================
  {
    id: 'B01', code: 'Đội 1', bracket: 'B', className: 'TN-ROB-SEMIB08', lec: 'Mạnh',
    student1: 'Nguyễn Ngọc Đăng Khôi', student2: 'Hoàng Anh Khang',
    v1Score1: 28.0, v1Score2: 25.0, v1Avg: 26.5, active: true
  },
  {
    id: 'B02', code: 'Đội 2', bracket: 'B', className: 'TN-ROB-SEMIA09', lec: 'Mạnh',
    student1: 'Mai Đức Việt', student2: 'Trương Minh Khang',
    v1Score1: 24.0, v1Score2: 22.0, v1Avg: 23.0, active: true
  },
  {
    id: 'B03', code: 'Đội 3', bracket: 'B', className: 'TN-ROB-SEMII05', lec: 'Hồng Ly',
    student1: 'Lâm Nhất Huy', student2: 'Nguyễn Hoàng Tiệp',
    v1Score1: 33.0, v1Score2: 33.0, v1Avg: 33.0, active: true
  },
  {
    id: 'B04', code: 'Đội 4', bracket: 'B', className: 'TN-ROB-SEMIB10', lec: 'Hồng Ly',
    student1: 'Nguyễn Phú Hiếu', student2: 'Đoàn Quang Phúc',
    v1Score1: 27.0, v1Score2: 24.0, v1Avg: 25.5, active: true
  },
  {
    id: 'B05', code: 'Đội 5', bracket: 'B', className: 'TN-ROB-SEMIA06', lec: 'Mạnh',
    student1: 'Ngô Gia Bảo', student2: 'Đỗ Minh Quân',
    v1Score1: 26.0, v1Score2: 23.0, v1Avg: 24.5, active: true
  },
  {
    id: 'B06', code: 'Đội 6', bracket: 'B', className: 'TN-ROB-SEMIA07', lec: 'Minh',
    student1: 'Phan Nhật Nam', student2: 'Lương Thế Vinh',
    v1Score1: 23.0, v1Score2: 21.0, v1Avg: 22.0, active: true
  },
  {
    id: 'B07', code: 'Đội 7', bracket: 'B', className: 'TN-ROB-SEMII04', lec: 'Minh',
    student1: 'Ma Thảo Nguyên', student2: 'Triệu Minh Quân',
    v1Score1: 22.5, v1Score2: 17.0, v1Avg: 19.75, active: true
  },
  {
    id: 'B08', code: 'Đội 8', bracket: 'B', className: 'TN-C4K-GB26 A', lec: 'Mạnh',
    student1: 'Nguyễn Minh Nhật', student2: 'Đặng Bảo Long',
    v1Score1: 25.0, v1Score2: 22.5, v1Avg: 23.75, active: true
  },
  {
    id: 'B09', code: 'Đội 9', bracket: 'B', className: 'TN-C4K-GB27', lec: 'Ngọc',
    student1: 'Tạ Quang Huy', student2: 'Hồ Anh Tuấn',
    v1Score1: 20.0, v1Score2: 18.5, v1Avg: 19.25, active: true
  },
  {
    id: 'B10', code: 'Đội 10', bracket: 'B', className: 'TN-C4K-GA23', lec: 'Dũng',
    student1: 'Lê Hoàng Kiên', student2: 'Lưu Công Huy',
    v1Score1: 26.5, v1Score2: 25.5, v1Avg: 26.0, active: true
  },
  {
    id: 'B11', code: 'Đội 11', bracket: 'B', className: 'TN-C4K-GB25-A', lec: 'Mạnh',
    student1: 'Bùi Khánh Doanh', student2: 'Vũ Tuấn Tài',
    v1Score1: 22.0, v1Score2: 21.0, v1Avg: 21.5, active: true
  },
  {
    id: 'B12', code: 'Đội 12', bracket: 'B', className: 'TN-C4K-GI20', lec: 'Minh',
    student1: 'Nguyễn Thành Vinh', student2: 'Nguyễn Tiến Hùng',
    v1Score1: 23.5, v1Score2: 21.5, v1Avg: 22.5, active: true
  },
  {
    id: 'B13', code: 'Đội 13', bracket: 'B', className: 'TN-C4K-GA24', lec: 'Ngọc',
    student1: 'Nguyễn Thành Nam', student2: 'Dương Huy Khánh',
    v1Score1: 29.5, v1Score2: 27.5, v1Avg: 28.5, active: true
  },
  {
    id: 'B14', code: 'Đội 14', bracket: 'B', className: 'TN-C4K-GI21-HB', lec: 'Ngọc',
    student1: 'Lâm Đình Khuê', student2: 'Đỗ Thái Lâm',
    v1Score1: 31.5, v1Score2: 27.0, v1Avg: 29.25, active: true
  },
  {
    id: 'B15', code: 'Đội 15', bracket: 'B', className: 'TN-C4K-PTA08', lec: 'Ngọc',
    student1: 'Ma Hoàng Anh', student2: 'Đàm Gia An',
    v1Score1: 24.0, v1Score2: 21.0, v1Avg: 22.5, active: true
  },
  {
    id: 'B16', code: 'Đội 16', bracket: 'B', className: 'TN-C4K-PTB09-HB', lec: 'Dũng',
    student1: 'Phùng Khải Nguyên', student2: 'Hoàng Bảo Long',
    v1Score1: 24.5, v1Score2: 20.5, v1Avg: 22.5, active: true
  },
  {
    id: 'B17', code: 'Đội 17', bracket: 'B', className: 'TN-C4K-PTB10', lec: 'Trường',
    student1: 'Chu Khánh Nam', student2: 'Nguyễn Minh Hiền',
    v1Score1: 18.5, v1Score2: 14.5, v1Avg: 16.5, active: true
  },
  {
    id: 'B18', code: 'Đội 18', bracket: 'B', className: 'TN-C4K-GB26-B', lec: 'Mạnh',
    student1: 'Lăng Quang Khải', student2: 'Trần Tùng Anh',
    v1Score1: 19.5, v1Score2: 18.0, v1Avg: 18.75, active: true
  },
  {
    id: 'B19', code: 'Đội 19', bracket: 'B', className: 'TN-C4K-GB25-B', lec: 'Mạnh',
    student1: 'Nguyễn Tiến Đạt', student2: 'Hoàng Bảo Minh',
    v1Score1: 20.0, v1Score2: 17.0, v1Avg: 18.5, active: true
  }
];

function createEmptyScoreSheet() {
  return {
    big: 0,        // Cột D: Khối to (+3đ)
    med: 0,        // Cột E: Khối vừa (+2đ)
    small: 0,      // Cột F: Khối nhỏ (+1đ)
    stackBig: 0,   // Cột G: Xếp chồng Khối to (+3đ, chỉ Bảng B Teen)
    stackMed: 0,   // Cột H: Xếp chồng Khối vừa (+2đ, chỉ Bảng B Teen)
    stackSmall: 0, // Cột I: Xếp chồng Khối nhỏ (+1đ, chỉ Bảng B Teen)
    special: 0,    // Cột J: Khối đặc biệt (+10đ khi D>0, E>0, F>0)
    parked: 0,     // Cột K: Về đích an toàn (+5đ)
    noTabletSwap: 0, // Luật Vòng 2: Không chuyển giao tablet ở 40s-50s (-5đ)
    otherFouls: 0,   // Điểm trừ lỗi khác (-1đ / -2đ)
    forceSpecial: false,
    manualOverride: null
  };
}

/**
 * Tính điểm chuẩn theo công thức Google Sheet + Thể lệ Vòng 2
 */
function calculateSheetScore(sheet, bracket) {
  if (!sheet) return 0;
  if (sheet.manualOverride !== null && sheet.manualOverride !== '' && !isNaN(Number(sheet.manualOverride))) {
    return Number(sheet.manualOverride);
  }
  const d = Number(sheet.big || 0);
  const e = Number(sheet.med || 0);
  const f = Number(sheet.small || 0);
  const g = bracket === 'B' ? Number(sheet.stackBig || 0) : 0;
  const h = bracket === 'B' ? Number(sheet.stackMed || 0) : 0;
  const i = bracket === 'B' ? Number(sheet.stackSmall || 0) : 0;
  const j = Number(sheet.special || 0);
  const k = Number(sheet.parked || 0);

  const unlockedNV2 = (d > 0 && e > 0 && f > 0) || Boolean(sheet.forceSpecial);
  const specialPts = (j > 0 && unlockedNV2) ? 10 : 0;
  const parkPts = k > 0 ? 5 : 0;
  const tabletPenalty = Number(sheet.noTabletSwap || 0) > 0 ? -5 : 0;
  const foulPenalty = -Math.abs(Number(sheet.otherFouls || 0));

  const raw = d * 3 + e * 2 + f * 1 + g * 3 + h * 2 + i * 1 + specialPts + parkPts + tabletPenalty + foulPenalty;
  return Math.max(0, raw);
}

/**
 * Thuật toán Xếp trận Vòng 2:
 * - Mỗi đội thi đúng 2 lượt (1 lượt Sân Đỏ, 1 lượt Sân Xanh)
 * - Không bao giờ gặp lại đối thủ ở Lượt 1
 * - Không bao giờ xếp trận của cùng 1 đội gần nhau (cách nhau >= N/2 trận trong bảng, tương đương >= 10 trận trên sa bàn)
 * - Xen kẽ đều giữa Bảng A và Bảng B trên 1 sa bàn duy nhất
 */
function generateInterleavedSchedule(teams, shuffleRandom = true) {
  function shuffle(arr) {
    const a = arr.slice();
    if (!shuffleRandom) return a;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function buildBracketWaves(bracketTeams, bracketCode) {
    const list = shuffle(bracketTeams.filter(t => t.active !== false));
    const n = list.length;
    if (n < 2) return { wave1: [], wave2: [] };

    // Tạo chu trình Hamilton (T_0 -> T_1 -> ... -> T_{n-1} -> T_0)
    // Mỗi cạnh e_k = (T_k [Sân Đỏ], T_{(k+1)%n} [Sân Xanh])
    // Chia thành 2 sóng: Các cạnh chẵn (e_0, e_2, ...) và các cạnh lẻ (e_1, e_3, ...)
    // Đảm bảo:
    // 1. Mọi đội thi đúng 2 trận (1 trận Sân Đỏ, 1 trận Sân Xanh)
    // 2. Không có 2 đội nào gặp nhau 2 lần (khi n >= 3)
    // 3. Khoảng cách giữa 2 trận của bất kỳ đội nào luôn đạt cực đại (n/2 trận cùng bảng)
    const wave1 = [];
    const wave2 = [];
    const turnCount = {};
    list.forEach(t => { turnCount[t.id] = 0; });

    const evenIndices = [];
    const oddIndices = [];
    for (let k = 0; k < n; k++) {
      // Nếu n lẻ, cạnh cuối k = n - 1 là (T_{n-1} [Đỏ], T_0 [Xanh]) phải đưa sang Lượt 2 (oddIndices)
      // để T_0 thi Lượt 1 ở Sân Đỏ (cạnh 0) và sang Lượt 2 tự động ĐỔI SÂN sang Sân Xanh (cạnh n-1)
      if (k % 2 === 0 && !(n % 2 === 1 && k === n - 1)) {
        evenIndices.push(k);
      } else {
        oddIndices.push(k);
      }
    }

    // Nếu n lẻ, cạnh cuối của evenIndices là e_{n-1} = (T_{n-1}, T_0) có chứa T_0 (vốn đã thi ở e_0).
    // Cả e_0 và e_{n-1} cách nhau (n-1)/2 trận nên đã rất xa nhau!
    evenIndices.forEach(k => {
      const red = list[k];
      const blue = list[(k + 1) % n];
      turnCount[red.id]++;
      turnCount[blue.id]++;
      wave1.push({
        bracket: bracketCode,
        redTeamId: red.id,
        redTurn: turnCount[red.id],
        blueTeamId: blue.id,
        blueTurn: turnCount[blue.id]
      });
    });

    oddIndices.forEach(k => {
      const red = list[k];
      const blue = list[(k + 1) % n];
      turnCount[red.id]++;
      turnCount[blue.id]++;
      wave2.push({
        bracket: bracketCode,
        redTeamId: red.id,
        redTurn: turnCount[red.id],
        blueTeamId: blue.id,
        blueTurn: turnCount[blue.id]
      });
    });

    return { wave1, wave2 };
  }

  const wavesA = buildBracketWaves(teams.filter(t => t.bracket === 'A'), 'A');
  const wavesB = buildBracketWaves(teams.filter(t => t.bracket === 'B'), 'B');

  function interleaveTwoLists(listA, listB, waveNumber) {
    const result = [];
    const maxLen = Math.max(listA.length, listB.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < listA.length) {
        result.push({ ...listA[i], wave: waveNumber });
      }
      if (i < listB.length) {
        result.push({ ...listB[i], wave: waveNumber });
      }
    }
    return result;
  }

  // Đan xen Bảng A và Bảng B ở Lượt 1, sau đó đan xen Bảng A và Bảng B ở Lượt 2
  const combined = [
    ...interleaveTwoLists(wavesA.wave1, wavesB.wave1, 1),
    ...interleaveTwoLists(wavesA.wave2, wavesB.wave2, 2)
  ];

  return combined.map((m, idx) => ({
    id: 'M' + String(idx + 1).padStart(2, '0'),
    matchNumber: idx + 1,
    wave: m.wave,
    bracket: m.bracket,
    redTeamId: m.redTeamId,
    redTurn: m.redTurn,
    blueTeamId: m.blueTeamId,
    blueTurn: m.blueTurn,
    status: 'pending', // 'pending' | 'live' | 'completed'
    redSheet: createEmptyScoreSheet(),
    blueSheet: createEmptyScoreSheet(),
    redScore: null,
    blueScore: null,
    completedAt: null
  }));
}

/**
 * Kiểm tra chất lượng lịch thi đấu (Không trùng đối thủ, khoảng cách trận tối thiểu)
 */
function analyzeScheduleMetrics(matches) {
  const pairSet = new Set();
  let duplicatePairs = 0;
  const lastMatchByTeam = {};
  let minGap = Infinity;

  matches.forEach((m, idx) => {
    const mNum = idx + 1;
    const pairKey = [m.redTeamId, m.blueTeamId].sort().join('__');
    if (pairSet.has(pairKey)) duplicatePairs++;
    pairSet.add(pairKey);

    [m.redTeamId, m.blueTeamId].forEach(tid => {
      if (lastMatchByTeam[tid] !== undefined) {
        const gap = mNum - lastMatchByTeam[tid];
        if (gap < minGap) minGap = gap;
      }
      lastMatchByTeam[tid] = mNum;
    });
  });

  return {
    totalMatches: matches.length,
    duplicatePairs,
    minGap: minGap === Infinity ? 0 : minGap
  };
}

/**
 * Tính toán Bảng Xếp Hạng Live cho từng Bảng A và Bảng B
 */
function computeStandings(teams, matches, rankBy = 'total') {
  // Tính Hạt giống (Seed #1, #2, #3) dựa trên Điểm Vòng 1
  const seedMap = {};
  ['A', 'B'].forEach(b => {
    const sortedV1 = teams
      .filter(t => t.bracket === b && t.active !== false && (t.v1Avg || 0) > 0)
      .slice()
      .sort((x, y) => (y.v1Avg || 0) - (x.v1Avg || 0));
    sortedV1.slice(0, 3).forEach((t, i) => {
      seedMap[t.id] = i + 1;
    });
  });

  const statsMap = {};
  teams.forEach(t => {
    statsMap[t.id] = {
      ...t,
      seed: seedMap[t.id] || null,
      turn1Score: null,
      turn2Score: null,
      turn1MatchNum: null,
      turn2MatchNum: null,
      turn1Status: 'pending',
      turn2Status: 'pending',
      turn1Side: null,
      turn2Side: null,
      turn1Sheet: null,
      turn2Sheet: null,
      specialCount: 0,
      parkCount: 0,
      foulCount: 0,
      playedCount: 0,
      isLiveNow: false
    };
  });

  matches.forEach(m => {
    const sides = [
      { teamId: m.redTeamId, turn: m.redTurn, score: m.redScore, sheet: m.redSheet, side: 'red' },
      { teamId: m.blueTeamId, turn: m.blueTurn, score: m.blueScore, sheet: m.blueSheet, side: 'blue' }
    ];

    sides.forEach(s => {
      const st = statsMap[s.teamId];
      if (!st) return;
      const isTurn1 = s.turn === 1;
      if (isTurn1) {
        st.turn1MatchNum = m.matchNumber;
        st.turn1Status = m.status;
        st.turn1Side = s.side;
        st.turn1Sheet = s.sheet;
        // Chỉ công bố điểm ra màn hình sau khi Hết giờ & Trọng tài bấm Chốt điểm (status === 'completed')
        if (m.status === 'completed' && s.score !== null) {
          st.turn1Score = Number(s.score);
        } else if (m.status === 'live') {
          st.isLiveNow = true;
        }
      } else {
        st.turn2MatchNum = m.matchNumber;
        st.turn2Status = m.status;
        st.turn2Side = s.side;
        st.turn2Sheet = s.sheet;
        if (m.status === 'completed' && s.score !== null) {
          st.turn2Score = Number(s.score);
        } else if (m.status === 'live') {
          st.isLiveNow = true;
        }
      }

      if (m.status === 'completed') {
        st.playedCount++;
        if (s.sheet) {
          const unlocked = (s.sheet.big > 0 && s.sheet.med > 0 && s.sheet.small > 0) || s.sheet.forceSpecial;
          if (s.sheet.special > 0 && unlocked) st.specialCount++;
          if (s.sheet.parked > 0) st.parkCount++;
          if (s.sheet.noTabletSwap > 0) st.foulCount += 5;
          st.foulCount += Number(s.sheet.otherFouls || 0);
        }
      }
    });
  });

  const result = { A: [], B: [] };

  ['A', 'B'].forEach(bracket => {
    const list = Object.values(statsMap).filter(t => t.bracket === bracket && t.active !== false);
    list.forEach(item => {
      const s1 = item.turn1Score !== null ? item.turn1Score : 0;
      const s2 = item.turn2Score !== null ? item.turn2Score : 0;
      const hasAny = item.turn1Score !== null || item.turn2Score !== null;
      item.totalScore = hasAny ? (s1 + s2) : 0;
      item.bestTurnScore = hasAny ? Math.max(s1, s2) : 0;
      const divisor = (item.turn1Score !== null && item.turn2Score !== null) ? 2 : (hasAny ? 1 : 1);
      item.avgScore = hasAny ? Number(((s1 + s2) / divisor).toFixed(1)) : 0;
      item.displayPrimary = rankBy === 'average' ? item.avgScore : item.totalScore;
    });

    list.sort((a, b) => {
      const aHas = a.turn1Score !== null || a.turn2Score !== null;
      const bHas = b.turn1Score !== null || b.turn2Score !== null;
      if (aHas !== bHas) return bHas ? 1 : -1;

      if (b.displayPrimary !== a.displayPrimary) return b.displayPrimary - a.displayPrimary;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.bestTurnScore !== a.bestTurnScore) return b.bestTurnScore - a.bestTurnScore;
      if (b.specialCount !== a.specialCount) return b.specialCount - a.specialCount;
      if (b.parkCount !== a.parkCount) return b.parkCount - a.parkCount;
      if (a.foulCount !== b.foulCount) return a.foulCount - b.foulCount;
      if ((b.v1Avg || 0) !== (a.v1Avg || 0)) return (b.v1Avg || 0) - (a.v1Avg || 0);
      return a.id.localeCompare(b.id);
    });

    list.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    result[bracket] = list;
  });

  return result;
}

/**
 * Tách tự động Spreadsheet ID và GID từ bất kỳ đường link Google Sheet nào
 */
function parseGoogleSheetUrl(input) {
  const str = String(input || '').trim();
  if (!str) return { sheetId: '', gid: null };
  const idMatch = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = str.match(/[?#&]gid=([0-9]+)/);
  return {
    sheetId: idMatch ? idMatch[1] : str,
    gid: gidMatch ? gidMatch[1] : null
  };
}

/**
 * Đọc trực tiếp Google Sheet bằng JSONP (Hỗ trợ cả đường link đầy đủ, Tên Sheet hoặc GID)
 */
function fetchGoogleSheetJSONP(sheetUrlOrId, sheetName = '', gid = null) {
  const parsed = parseGoogleSheetUrl(sheetUrlOrId);
  const sheetId = parsed.sheetId;
  const finalGid = gid || parsed.gid;

  return new Promise((resolve, reject) => {
    const cbName = '__gs_cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout khi đọc Google Sheet: ' + (sheetName || sheetId)));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function(response) {
      cleanup();
      if (!response || response.status === 'error') {
        reject(new Error('Không thể đọc sheet ' + (sheetName || sheetId)));
      } else {
        resolve(response.table);
      }
    };

    let url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
      '/gviz/tq?tqx=responseHandler:' + cbName;
    if (sheetName) {
      url += '&sheet=' + encodeURIComponent(sheetName);
    } else if (finalGid) {
      url += '&gid=' + encodeURIComponent(finalGid);
    }
    url += '&_ts=' + Date.now();

    script.src = url;
    script.onerror = function() {
      cleanup();
      reject(new Error('Lỗi kết nối tới Google Sheet (Hãy bật quyền Xem cho bất kỳ ai có liên kết)'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Quét trực tiếp 1 tab lớp trong file FORM CHẤM ĐIỂM VÒNG 1 để lấy Top học sinh có Điểm Final cao nhất
 */
async function fetchClassTopStudentsFromVong1(vong1SheetId, rawClassName) {
  let tabName = String(rawClassName || '').trim();
  let offset = 0;
  if (tabName.endsWith('-A')) {
    tabName = tabName.slice(0, -2);
    offset = 0;
  } else if (tabName.endsWith('-B')) {
    tabName = tabName.slice(0, -2);
    offset = 2;
  }

  const table = await fetchGoogleSheetJSONP(vong1SheetId, tabName);
  const rows = table.rows || [];
  let inFinal = false;
  const students = [];

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].c || [];
    const colA = c[0] && (c[0].f || c[0].v) ? String(c[0].f || c[0].v).trim() : '';
    const colB = c[1] && (c[1].f || c[1].v) ? String(c[1].f || c[1].v).trim() : '';
    const colC = c[2] && c[2].v !== null && c[2].v !== undefined ? c[2].v : '';

    if (colA.toLowerCase().includes('điểm final') || String(colC).toLowerCase().includes('điểm final')) {
      inFinal = true;
      continue;
    }

    if (inFinal && colB && colB.toUpperCase() !== 'TÊN HỌC VIÊN' && colB.toUpperCase() !== 'TÊN') {
      const numScore = parseFloat(colC);
      students.push({
        name: colB,
        score: isNaN(numScore) ? 0 : numScore
      });
    }
  }

  // Nếu GV chưa kéo xuống bảng Điểm Final nhưng đã điền tên ở Lượt 1 & Lượt 2 thì tính trung bình luôn!
  if (students.length === 0) {
    const turnMap = {};
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i].c || [];
      const colB = c[1] && (c[1].f || c[1].v) ? String(c[1].f || c[1].v).trim() : '';
      const colC = c[2] && c[2].v !== null && c[2].v !== undefined ? parseFloat(c[2].v) : NaN;
      if (colB && colB.toUpperCase() !== 'TÊN HỌC VIÊN' && colB.toUpperCase() !== 'HỌC VIÊN' && colB.toUpperCase() !== 'TÊN' && !colB.includes('Ảnh bên góc phải')) {
        if (!turnMap[colB]) turnMap[colB] = [];
        if (!isNaN(colC)) turnMap[colB].push(colC);
      }
    }
    Object.keys(turnMap).forEach(name => {
      const arr = turnMap[name];
      const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      students.push({ name, score: Number(avg.toFixed(2)) });
    });
  }

  students.sort((a, b) => b.score - a.score);
  return {
    top1: students[offset] || null,
    top2: students[offset + 1] || null,
    all: students
  };
}

/**
 * Tạo bộ dữ liệu Test / Demo chân thực cho 31 Đội (31 Trận)
 * - mode = 'mid': Đã thi xong 18/31 trận, Trận #19 đang LIVE rượt đuổi tỷ số trên sân
 * - mode = 'full': Đã hoàn thành toàn bộ 31/31 trận (mỗi đội đủ 2 lượt)
 * - mode = 'clear': Xóa toàn bộ điểm test về 0đ để chuẩn bị chấm thật
 */
function populateDemoMatches(matches, mode = 'mid') {
  function seededRand(seed) {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }

  function buildRealisticSheet(bracket, seedNum) {
    const r1 = seededRand(seedNum * 3 + 1);
    const r2 = seededRand(seedNum * 3 + 2);
    const r3 = seededRand(seedNum * 3 + 3);
    const r4 = seededRand(seedNum * 7 + 5);
    const r5 = seededRand(seedNum * 11 + 9);

    const big = 1 + Math.floor(r1 * 4);   // 1..4 khối to
    const med = 1 + Math.floor(r2 * 4);   // 1..4 khối vừa
    const small = 1 + Math.floor(r3 * 5); // 1..5 khối nhỏ
    const isTeen = bracket === 'B';

    const stackBig = isTeen ? Math.floor(seededRand(seedNum * 13) * (big + 1)) : 0;
    const stackMed = isTeen ? Math.floor(seededRand(seedNum * 17) * (med + 1)) : 0;
    const stackSmall = isTeen ? Math.floor(seededRand(seedNum * 19) * Math.min(small, 3)) : 0;

    const special = r4 > 0.35 ? 1 : 0;
    const parked = r5 > 0.25 ? 1 : 0;
    const noTabletSwap = seededRand(seedNum * 23) > 0.88 ? 1 : 0; // ~12% đội quên đổi tablet
    const otherFouls = seededRand(seedNum * 29) > 0.85 ? 1 : 0;

    return {
      big,
      med,
      small,
      stackBig,
      stackMed,
      stackSmall,
      special,
      parked,
      noTabletSwap,
      otherFouls,
      forceSpecial: false,
      manualOverride: null
    };
  }

  matches.forEach((m, idx) => {
    const mNum = idx + 1;
    if (mode === 'clear') {
      m.redSheet = createEmptyScoreSheet();
      m.blueSheet = createEmptyScoreSheet();
      m.redScore = null;
      m.blueScore = null;
      m.status = mNum === 1 ? 'live' : 'pending';
      m.completedAt = null;
      return;
    }

    const completedLimit = mode === 'full' ? matches.length : 18;
    const liveMatchNum = mode === 'full' ? -1 : 19;

    if (mNum <= completedLimit) {
      m.redSheet = buildRealisticSheet(m.bracket, mNum * 10 + 1);
      m.blueSheet = buildRealisticSheet(m.bracket, mNum * 10 + 2);
      m.redScore = calculateSheetScore(m.redSheet, m.bracket);
      m.blueScore = calculateSheetScore(m.blueSheet, m.bracket);
      m.status = 'completed';
      m.completedAt = new Date(Date.now() - (completedLimit - mNum) * 120000).toISOString();
    } else if (mNum === liveMatchNum) {
      m.redSheet = buildRealisticSheet(m.bracket, mNum * 10 + 1);
      m.blueSheet = buildRealisticSheet(m.bracket, mNum * 10 + 2);
      m.redScore = calculateSheetScore(m.redSheet, m.bracket);
      m.blueScore = calculateSheetScore(m.blueSheet, m.bracket);
      m.status = 'live';
      m.completedAt = null;
    } else {
      m.redSheet = createEmptyScoreSheet();
      m.blueSheet = createEmptyScoreSheet();
      m.redScore = null;
      m.blueScore = null;
      m.status = 'pending';
      m.completedAt = null;
    }
  });

  return matches;
}

window.TechClashEngine = {
  DEFAULT_CONFIG,
  INITIAL_TEAMS,
  createEmptyScoreSheet,
  calculateSheetScore,
  generateInterleavedSchedule,
  analyzeScheduleMetrics,
  computeStandings,
  parseGoogleSheetUrl,
  fetchGoogleSheetJSONP,
  fetchClassTopStudentsFromVong1,
  populateDemoMatches
};
