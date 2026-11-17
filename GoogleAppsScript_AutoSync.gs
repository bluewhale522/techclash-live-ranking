/**
 * ============================================================================
 * TECH CLASH: FINALE 2026 - HỆ THỐNG TỰ ĐỘNG HÓA VÒNG 1 -> VÒNG 2 & LIVE RANKING
 * ============================================================================
 * HƯỚNG DẪN CÀI ĐẶT TRONG 30 GIÂY:
 * 1. Mở file Google Sheet "TN-ROBOTICS YEAR END MÙA 2 - 2026"
 *    (ID: 16ylJXsvMpPIGgcY4ijdDSSiO514WjZXC4UheHG3aoak)
 * 2. Vào menu: Tiện ích mở rộng (Extensions) -> Apps Script
 * 3. Xóa code cũ (nếu có), dán toàn bộ code này vào và bấm Lưu (Ctrl + S).
 * 4. Tải lại trang Google Sheet -> Trên thanh menu sẽ xuất hiện mục "🏆 TECH CLASH 2026".
 * 5. Để nối với Web App Live Ranking 2 chiều:
 *    Trong cửa sổ Apps Script -> Bấm "Triển khai" (Deploy) -> "Tạo mục triển khai mới" (New deployment)
 *    -> Chọn loại: "Ứng dụng web" (Web app)
 *    -> Thực thi dưới dạng: "Tôi" (Me)
 *    -> Ai có quyền truy cập: "Bất kỳ ai" (Anyone) -> Bấm Triển khai -> Copy URL dán vào Web App!
 * ============================================================================
 */

const VONG1_FORM_SHEET_ID = '1YtRc0-REE6o759bKkpJfp-XeZZP9nrGwPor6RyTRal0';
const YEAR_END_SHEET_ID = '16ylJXsvMpPIGgcY4ijdDSSiO514WjZXC4UheHG3aoak';
const DS_VONG1_TAB_NAME = 'DS - HS vượt qua vòng 1';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏆 TECH CLASH 2026')
    .addItem('1️⃣ Tự động lấy Top 2 Vòng 1 điền vào "DS - HS vượt qua vòng 1"', 'syncTop2FromVong1ToDS')
    .addSeparator()
    .addItem('2️⃣ Khởi tạo 3 Sheet Vòng 2 (Đội thi, Lịch đấu xen kẽ A-B, Xếp hạng)', 'setupVong2Sheets')
    .addItem('3️⃣ Bốc thăm lại Lịch thi đấu Vòng 2 (Xen kẽ A-B, 2 lượt, không trùng)', 'regenerateScheduleSheet')
    .addToUi();
}

/**
 * Đọc bảng điểm của 1 lớp trong file FORM CHẤM ĐIỂM VÒNG 1 và trả về danh sách học sinh sắp xếp theo Điểm Final giảm dần
 */
function getRankedStudentsFromClassSheet(vong1Spreadsheet, classSheetName) {
  const sheet = vong1Spreadsheet.getSheetByName(classSheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  let inFinalSection = false;
  const students = [];

  for (let r = 0; r < data.length; r++) {
    const colA = String(data[r][0] || '').trim();
    const colB = String(data[r][1] || '').trim();
    const colC = data[r][2];

    if (colA.toLowerCase().indexOf('điểm final') !== -1 || String(colC).toLowerCase().indexOf('điểm final') !== -1) {
      inFinalSection = true;
      continue;
    }

    if (inFinalSection && colB && colB.toUpperCase() !== 'TÊN HỌC VIÊN' && colB.toUpperCase() !== 'TÊN') {
      const score = parseFloat(colC);
      const validScore = isNaN(score) ? 0 : score;
      students.push({
        name: colB,
        score: validScore
      });
    }
  }

  // Sắp xếp điểm từ cao xuống thấp (ưu tiên học sinh đã có điểm > 0 hoặc có tên thực)
  students.sort(function(a, b) {
    return b.score - a.score;
  });

  return students;
}

/**
 * Chuẩn hóa tên lớp trên bảng DS - HS vượt qua vòng 1 sang tên tab thực tế bên file FORM CHẤM ĐIỂM VÒNG 1
 */
function resolveClassTabAndOffset(rawClassName) {
  const clean = String(rawClassName || '').trim();
  if (!clean) return null;

  // Xử lý các lớp tách 2 đội A và B (ví dụ TN-C4K-GB25-A lấy Top 1-2, TN-C4K-GB25-B lấy Top 3-4)
  if (clean.endsWith('-A')) {
    return { tabName: clean.slice(0, -2), offset: 0 };
  }
  if (clean.endsWith('-B')) {
    return { tabName: clean.slice(0, -2), offset: 2 };
  }
  return { tabName: clean, offset: 0 };
}

/**
 * 1. Tự động quét toàn bộ 30 lớp bên file FORM CHẤM ĐIỂM VÒNG 1 và điền Top 2 vào tab "DS - HS vượt qua vòng 1"
 */
function syncTop2FromVong1ToDS() {
  const ssVong1 = SpreadsheetApp.openById(VONG1_FORM_SHEET_ID);
  const ssMain = SpreadsheetApp.openById(YEAR_END_SHEET_ID);
  const dsSheet = ssMain.getSheetByName(DS_VONG1_TAB_NAME);

  if (!dsSheet) {
    throw new Error('Không tìm thấy sheet "' + DS_VONG1_TAB_NAME + '"');
  }

  const lastRow = Math.min(dsSheet.getLastRow(), 70);
  const rangeValues = dsSheet.getRange(1, 1, lastRow, 22).getValues();
  let updatedCount = 0;

  for (let r = 5; r < lastRow - 1; r++) {
    // BẢNG JUNIOR CODER: Cột A (index 0) có chữ "Đội ...", Cột B (index 1) là tên lớp, Cột G (index 6) là Tên HS (dòng r và r+1)
    const teamLabelA = String(rangeValues[r][0] || '').trim();
    const classA = String(rangeValues[r][1] || '').trim();
    if (teamLabelA.indexOf('Đội') === 0 && classA) {
      const infoA = resolveClassTabAndOffset(classA);
      if (infoA) {
        const rankedA = getRankedStudentsFromClassSheet(ssVong1, infoA.tabName);
        if (rankedA.length > infoA.offset) {
          const hs1 = rankedA[infoA.offset] ? rankedA[infoA.offset].name : '';
          const hs2 = rankedA[infoA.offset + 1] ? rankedA[infoA.offset + 1].name : '';
          if (hs1) dsSheet.getRange(r + 1, 7).setValue(hs1);
          if (hs2) dsSheet.getRange(r + 2, 7).setValue(hs2);
          updatedCount++;
        }
      }
    }

    // BẢNG TEEN CODER: Cột L (index 11) có chữ "Đội ...", Cột M (index 12) là tên lớp, Cột R (index 17) là Tên HS (dòng r và r+1)
    const teamLabelB = String(rangeValues[r][11] || '').trim();
    const classB = String(rangeValues[r][12] || '').trim();
    if (teamLabelB.indexOf('Đội') === 0 && classB) {
      const infoB = resolveClassTabAndOffset(classB);
      if (infoB) {
        const rankedB = getRankedStudentsFromClassSheet(ssVong1, infoB.tabName);
        if (rankedB.length > infoB.offset) {
          const hs1 = rankedB[infoB.offset] ? rankedB[infoB.offset].name : '';
          const hs2 = rankedB[infoB.offset + 1] ? rankedB[infoB.offset + 1].name : '';
          if (hs1) dsSheet.getRange(r + 1, 18).setValue(hs1);
          if (hs2) dsSheet.getRange(r + 2, 18).setValue(hs2);
          updatedCount++;
        }
      }
    }
  }

  return { ok: true, updatedTeams: updatedCount };
}

/**
 * Web App API (GET & POST) để đồng bộ Real-time 2 chiều với Web App Live Ranking
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  if (action === 'syncTop2') {
    const res = syncTop2FromVong1ToDS();
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'TECH CLASH 2026 VONG 2 API' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(YEAR_END_SHEET_ID);

    if (payload.action === 'syncTop2') {
      const res = syncTop2FromVong1ToDS();
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'saveState' && payload.state) {
      writeStateToVong2Sheets(ss, payload.state);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Ghi trạng thái Đội thi, Lịch thi đấu & Điểm số Vòng 2 vào Google Sheet
 */
function writeStateToVong2Sheets(ss, state) {
  let rankSheet = ss.getSheetByName('V2_LIVE_RANKING');
  if (!rankSheet) rankSheet = ss.insertSheet('V2_LIVE_RANKING');
  rankSheet.clearContents();

  const headers = [
    'Bảng Đấu', 'Hạng', 'Mã Đội', 'Lớp Đại Diện', 'Học Sinh 1', 'Học Sinh 2',
    'GV (LEC)', 'Điểm Vòng 1 (TB)', 'Điểm Lượt 1', 'Điểm Lượt 2', 'Tổng Điểm Vòng 2', 'Trung Bình Vòng 2'
  ];
  const rows = [headers];

  if (state.rankings) {
    ['A', 'B'].forEach(function(bracket) {
      const list = state.rankings[bracket] || [];
      list.forEach(function(item, idx) {
        rows.push([
          bracket === 'A' ? 'Bảng A - Junior Coder' : 'Bảng B - Teen Coder',
          idx + 1,
          item.code,
          item.className,
          item.student1,
          item.student2,
          item.lec || '',
          item.v1Score || 0,
          item.turn1Score !== null ? item.turn1Score : '',
          item.turn2Score !== null ? item.turn2Score : '',
          item.totalScore || 0,
          item.avgScore || 0
        ]);
      });
    });
  }
  rankSheet.getRange(1, 1, rows.length, headers.length).setValues(rows);

  let matchSheet = ss.getSheetByName('V2_LICH_VA_DIEM');
  if (!matchSheet) matchSheet = ss.insertSheet('V2_LICH_VA_DIEM');
  matchSheet.clearContents();

  const mHeaders = [
    'Trận #', 'Lượt', 'Bảng', 'Trạng Thái',
    'Đội Sân Đỏ (Trái)', 'HS Sân Đỏ', 'Điểm Sân Đỏ',
    'Đội Sân Xanh (Phải)', 'HS Sân Xanh', 'Điểm Sân Xanh'
  ];
  const mRows = [mHeaders];
  (state.matches || []).forEach(function(m) {
    mRows.push([
      m.matchNumber,
      'Lượt ' + m.wave,
      m.bracket === 'A' ? 'Bảng A (Junior)' : 'Bảng B (Teen)',
      m.status === 'completed' ? 'Đã chấm' : (m.status === 'live' ? 'Đang thi' : 'Chờ thi'),
      m.redClassName,
      m.redStudents,
      m.redScore !== null ? m.redScore : '',
      m.blueClassName,
      m.blueStudents,
      m.blueScore !== null ? m.blueScore : ''
    ]);
  });
  matchSheet.getRange(1, 1, mRows.length, mHeaders.length).setValues(mRows);
}
