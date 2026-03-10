// 【請替換為您 Google Apps Script 部署後的 Web App URL】
const GAS_URL = "https://script.google.com/macros/s/AKfycbxGrgw1RRDVVW83K4Yh1ZzMJHtqJKAYytPIH7Ydm_nhbs2kdYh59Bztev5pvviB673TSA/exec";

// 狀態變數
let employeeData = [];
let holidayList = [];
let currentEmp = null;
let leaveRecords = [];
let calendar = null;
let globalCompanyName = "企業雲端"; // 保存全域公司名稱

// DOM 元素
const els = {
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loadingText'),
  todayLabel: document.getElementById('todayLabel'),
  weekendToggle: document.getElementById('weekendToggle'),
  nameSelect: document.getElementById('nameSelect'),
  balanceArea: document.getElementById('balanceArea'),
  workInfoDisplay: document.getElementById('workInfoDisplay'),
  empShiftSpan: document.getElementById('empShiftSpan'),
  typeSelect: document.getElementById('typeSelect'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  startH: document.getElementById('startH'),
  startM: document.getElementById('startM'),
  endH: document.getElementById('endH'),
  endM: document.getElementById('endM'),
  totalHrs: document.getElementById('totalHrs'),
  overLimitMsg: document.getElementById('overLimitMsg'),
  submitBtn: document.getElementById('submitBtn'),
  note: document.getElementById('note'),
  leaveDetailText: document.getElementById('leaveDetailText'),
  displays: {
    special: document.getElementById('specialDisplay'),
    sick: document.getElementById('sickDisplay'),
    personal: document.getElementById('personalDisplay'),
    menstrual: document.getElementById('menstrualDisplay'),
    specialFutureInfo: document.getElementById('specialFutureInfo')
  },
  menstrualCard: document.getElementById('menstrualCard'),
  menstrualOption: document.getElementById('menstrualOption')
};

// 初始化設定
document.addEventListener('DOMContentLoaded', () => {
  els.todayLabel.innerText = new Date().toLocaleDateString('zh-TW');
  bindEvents();
  fetchData();
});

// 監聽事件
function bindEvents() {
  els.nameSelect.addEventListener('change', handleEmpChange);

  // 當這幾個值改變時，都重新計算時數
  const triggers = ['typeSelect', 'startDate', 'endDate', 'startH', 'startM', 'endH', 'endM'];
  triggers.forEach(id => {
    els[id].addEventListener('change', validateHrs);
  });

  els.submitBtn.addEventListener('click', submitLeave);

  // 監聽週末顯示開關
  if (els.weekendToggle) {
    els.weekendToggle.addEventListener('change', (e) => {
      if (calendar) {
        calendar.setOption('weekends', e.target.checked);
      }
    });
  }
}

// 從 GAS API 獲取資料 (GET)
async function fetchData() {
  try {
    const response = await fetch(GAS_URL);
    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json();

    // 如果因為認證被導向 googleusercontent，fetch 預設會透明處理，但如果失敗會進 catch
    let companyName = "";

    if (Array.isArray(data) && data.length > 0) {
      companyName = data[0].companyName || "企業雲端";
      globalCompanyName = companyName; // 存到全域變數給送出假單時使用

      // --- 1. 動態替換網頁標題 ---
      document.title = companyName + " 員工請假系統";

      employeeData = data;
      holidayList = data[0].holidayList || []; // 取出共通的假日清單

      // 取出請假紀錄 (如果後端有回傳的話)
      leaveRecords = data[0].leaveRecords || [];

      // 載入台灣假日與 Google Sheet 假日合併
      const currentYear = new Date().getFullYear();
      const taiwanHolidays = await fetchTaiwanHolidays(currentYear);
      const nextYearHolidays = await fetchTaiwanHolidays(currentYear + 1);

      // 去除重複的假日，並統一格式為 { date: "YYYY-MM-DD", name: "假日名稱" }
      const allHolidays = [...holidayList, ...taiwanHolidays, ...nextYearHolidays];
      const uniqueHolidaysMap = new Map();
      allHolidays.forEach(h => {
        const d = typeof h === 'object' ? h.date : h;
        const n = typeof h === 'object' ? h.name : '公司假日';
        if (d && !uniqueHolidaysMap.has(d)) {
          uniqueHolidaysMap.set(d, { date: d, name: n });
        }
      });
      holidayList = Array.from(uniqueHolidaysMap.values());

      // 填入員工選單
      data.forEach(emp => {
        const opt = document.createElement('option');
        opt.value = opt.text = emp.name;
        els.nameSelect.appendChild(opt);
      });

      // 初始化行事曆
      initCalendar();

      els.loading.style.opacity = '0';
      setTimeout(() => els.loading.style.display = 'none', 400);
    } else {
      throw new Error("無效的資料格式");
    }
  } catch (error) {
    els.loadingText.innerHTML = "❌ 讀取資料失敗，請確認部署權限或重新載入 <br>(若瀏覽器阻擋 CORS，請使用無痕視窗測試)";
    els.loadingText.style.color = "#EF4444";
    document.querySelector('.spinner').style.display = 'none';
    console.error(error);
  }
}

// 選擇員工後的行為
function handleEmpChange() {
  const empName = els.nameSelect.value;
  currentEmp = employeeData.find(e => e.name === empName);

  if (currentEmp) {
    // 顯示餘額區域
    els.balanceArea.style.display = 'flex';

    // 解析並顯示三層式餘額 (GAS 回傳格式如: "15 / 75 (剩 60)")
    const updateBalanceCard = (type, infoStr) => {
      // 擷取 "已休"、"總計/上限" 數字
      let used = 0, total = 0;
      const parts = infoStr.split(' / ');
      if (parts.length >= 2) {
        used = parts[0].trim();
        total = parts[1].split(' ')[0].trim();
      }

      if (type === 'special') {
        // 左側明細：表格式排版 (emoji + 左右對齊)
        let detailHtml = '';
        if (currentEmp.specialDelayed > 0) {
          detailHtml += `<div class="sdc-row"><span class="sdc-label">🕐 去年遞延</span><span class="sdc-value">${currentEmp.specialDelayed} hr</span></div>`;
          detailHtml += `<div class="sdc-row"><span class="sdc-label">🆕 今年發放</span><span class="sdc-value">${currentEmp.specialNewIssued} hr</span></div>`;
        } else {
          detailHtml += `<div class="sdc-row"><span class="sdc-label">📊 總計</span><span class="sdc-value">${total} hr</span></div>`;
        }
        // 餘額為負時：「已休」→「已預排」
        if (currentEmp.remainSpecial < 0) {
          detailHtml += `<div class="sdc-row"><span class="sdc-label">📋 已預排</span><span class="sdc-value">${used} hr</span></div>`;
        } else {
          detailHtml += `<div class="sdc-row"><span class="sdc-label">✅ 已休</span><span class="sdc-value">${used} hr</span></div>`;
        }
        document.getElementById('specialSub').innerHTML = detailHtml;

        // 右側大數字（負數時顯示 0）
        const displayRemain = Math.max(0, currentEmp.remainSpecial);
        els.displays.special.innerText = `剩 ${displayRemain} hr`;

        // 左側底部：未來發放預報
        if (currentEmp.nextSpecialDate && currentEmp.nextSpecialHrs) {
          let futureHtml = `📌 ${currentEmp.nextSpecialDate} 將發放 ${currentEmp.nextSpecialHrs} hr`;
          if (currentEmp.remainSpecial < 0) {
            const prebooked = Math.abs(currentEmp.remainSpecial);
            const netAvailable = currentEmp.nextSpecialHrs - prebooked;
            futureHtml += `<br><span style="font-size:0.9em; opacity:0.85;">（扣除預排後實際可用 ${netAvailable} hr）</span>`;
          }
          els.displays.specialFutureInfo.innerHTML = futureHtml;
          els.displays.specialFutureInfo.style.display = 'block';
        } else {
          els.displays.specialFutureInfo.style.display = 'none';
        }
      } else if (type === 'sick') {
        document.getElementById('sickSub').innerText = `上限 ${total} hr | 已休 ${used} hr`;
        els.displays.sick.innerText = `剩 ${currentEmp.remainSick} hr`;
      } else if (type === 'personal') {
        document.getElementById('personalSub').innerText = `上限 ${total} hr | 已休 ${used} hr`;
        els.displays.personal.innerText = `剩 ${currentEmp.remainPersonal} hr`;
      } else if (type === 'menstrual') {
        document.getElementById('menstrualSub').innerText = `上限 ${total} hr | 已休 ${used} hr`;
        els.displays.menstrual.innerText = `剩 ${currentEmp.remainMenstrual} hr`;
      }
    };

    updateBalanceCard('special', currentEmp.specialInfo || "0 / 0 (剩 0)");
    updateBalanceCard('sick', currentEmp.sickInfo || "0 / 225 (剩 225)");
    updateBalanceCard('personal', currentEmp.personalInfo || "0 / 105 (剩 105)");

    // 判斷性別以顯示女性專屬生理假
    if (currentEmp.gender === "女" || currentEmp.gender === "Female") {
      updateBalanceCard('menstrual', currentEmp.menstrualInfo || "0 / 22.5 (剩 22.5)");
      els.menstrualCard.style.display = 'flex';
      els.menstrualOption.style.display = 'block';
    } else {
      els.menstrualCard.style.display = 'none';
      els.menstrualOption.style.display = 'none';
      // 如果原本選到生理假，切換員工變男性時，重置選項
      if (els.typeSelect.value === "生理假") els.typeSelect.value = "";
    }

    // 處理上下班時間 (防呆：動態渲染時段)
    setupTimeOptions(currentEmp.startTime);

    // 顯示班別提示
    const [h, m] = currentEmp.startTime.split(':');
    const endTimeH = parseInt(h) + 9;
    els.empShiftSpan.innerText = `${h}:${m} ~ ${endTimeH}:${m}`;
    els.workInfoDisplay.style.display = 'block';

    validateHrs();
  }
}

// 根據員工班別動態生成小時下拉選單
function setupTimeOptions(startTimeStr) {
  // 解析上班時間 (預期格式 "08:30:00" 或 "09:00")
  const parts = startTimeStr.split(':');
  const startHour = parseInt(parts[0]) || 9;
  const startMin = (parts.length > 1 && parts[1] === "30") ? "30" : "00";
  const endHour = startHour + 9; // 表定 9 小時 (含1.5hr午休)

  // 解鎖選單
  els.startH.disabled = false;
  els.startM.disabled = false;
  els.endH.disabled = false;
  els.endM.disabled = false;

  els.startH.innerHTML = '';
  els.endH.innerHTML = '';

  for (let i = startHour; i <= endHour; i++) {
    const val = String(i).padStart(2, '0');
    els.startH.add(new Option(val, val));
    els.endH.add(new Option(val, val));
  }

  // 設置預設值為起訖時間
  els.startH.value = String(startHour).padStart(2, '0');
  els.startM.value = startMin;
  els.endH.value = String(endHour).padStart(2, '0');
  els.endM.value = startMin;
}

// 判斷是否為假日
function isHoliday(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return true; // 週末
  const str = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  // holidayList 現在統一為 { date: "YYYY-MM-DD", name: "假日名稱" }
  return holidayList.some(h => h.date === str);
}

// 核心計算邏輯與防呆驗證
function validateHrs() {
  const sD = els.startDate.value;
  const eD = els.endDate.value;
  const type = els.typeSelect.value;

  // 隱藏錯誤提示
  showError(false);
  els.submitBtn.disabled = true;
  if (els.leaveDetailText) els.leaveDetailText.style.display = 'none';

  if (!sD || !eD || !currentEmp || !type) {
    els.totalHrs.innerText = '0';
    return;
  }

  // 檢查起點與終點是否為假日
  if (isHoliday(new Date(sD))) {
    showError(true, '<i class="fa-solid fa-triangle-exclamation"></i> 開始日期是假日（或週末），請選擇工作日作為請假起點！');
    els.totalHrs.innerText = '0';
    return;
  }

  if (isHoliday(new Date(eD))) {
    showError(true, '<i class="fa-solid fa-triangle-exclamation"></i> 結束日期是假日（或週末），請選擇工作日作為請假終點！');
    els.totalHrs.innerText = '0';
    return;
  }

  // 檢查時間合理性 (日期起訖相反)
  if (new Date(sD) > new Date(eD)) {
    showError(true, '<i class="fa-solid fa-triangle-exclamation"></i> 結束日期不能早於開始日期！');
    els.totalHrs.innerText = '0';
    return;
  }

  // 獲取使用者輸入的小時與分鐘
  const sH = parseInt(els.startH.value);
  const sM = els.startM.value === "30" ? 0.5 : 0;
  const eH = parseInt(els.endH.value);
  const eM = els.endM.value === "30" ? 0.5 : 0;

  // 取得員工表定起點
  const empStartP = currentEmp.startTime.split(':');
  const empStartNum = parseInt(empStartP[0]) + (empStartP[1] == "30" ? 0.5 : 0);

  // 檢查申請時間是否超出表定班別範圍
  if ((sH + sM) < empStartNum) {
    showError(true, `<i class="fa-solid fa-triangle-exclamation"></i> 開始時間不可早於表定上班時間 (${currentEmp.startTime})！`);
    els.totalHrs.innerText = '0';
    return;
  }

  const endHStr = String(Math.floor(empStartNum + 9)).padStart(2, '0');
  const endMStr = (empStartNum + 9) % 1 === 0.5 ? "30" : "00";
  if ((eH + eM) > (empStartNum + 9)) {
    showError(true, `<i class="fa-solid fa-triangle-exclamation"></i> 結束時間不可晚於表定下班時間 (${endHStr}:${endMStr})！`);
    els.totalHrs.innerText = '0';
    return;
  }

  // 同一天，結束時間早於開始時間
  if (sD === eD && (sH + sM) >= (eH + eM)) {
    showError(true, '<i class="fa-solid fa-triangle-exclamation"></i> 結束時間不能早於或等於開始時間！');
    els.totalHrs.innerText = '0';
    return;
  }

  // 檢查是否與已有的請假紀錄重疊
  const applyStart = new Date(`${sD} ${String(sH).padStart(2, '0')}:${String(sM === 0.5 ? 30 : 0).padStart(2, '0')}:00`);
  const applyEnd = new Date(`${eD} ${String(eH).padStart(2, '0')}:${String(eM === 0.5 ? 30 : 0).padStart(2, '0')}:00`);

  const hasOverlap = leaveRecords.some(record => {
    if (record.name !== currentEmp.name) return false;
    // record.start / record.end 格式如: "2024-04-10 09:00:00"
    // 注意: JS Date parse 需要將字串中的空白換成 'T' 或保證格式能正確解析 (Safari比較嚴格)
    const recStartStr = record.start.replace(' ', 'T');
    const recEndStr = record.end.replace(' ', 'T');

    const recStart = new Date(recStartStr);
    const recEnd = new Date(recEndStr);

    // 判斷重疊邏輯: (A開始 < B結束) 且 (A結束 > B開始)
    return (applyStart < recEnd) && (applyEnd > recStart);
  });

  if (hasOverlap) {
    showError(true, '<i class="fa-solid fa-triangle-exclamation"></i> 申請區間與您已有的請假紀錄重疊，請重新確認！');
    els.totalHrs.innerText = '0';
    return;
  }

  let total = 0;
  let curr = new Date(sD);
  const end = new Date(eD);
  let safety = 0;
  let workDays = []; // 紀錄有計入時數的日期

  // 依日迴圈計算時數
  while (curr <= end && safety < 100) {
    if (!isHoliday(curr)) {
      let dS = empStartNum;
      let dE = (empStartNum + 9);

      const cStr = curr.getFullYear() + '-' + String(curr.getMonth() + 1).padStart(2, '0') + '-' + String(curr.getDate()).padStart(2, '0');

      // 若為開始日，重算起點
      if (cStr === sD) dS = Math.max(empStartNum, sH + sM);
      // 若為結束日，重算終點
      if (cStr === eD) dE = Math.min((empStartNum + 9), eH + eM);

      let hrs = dE - dS;

      // 扣除午休 (12:00 - 13:30)
      if (dS <= 12 && dE >= 13.5) {
        hrs -= 1.5;
      } else if (dS > 12 && dS < 13.5 && dE >= 13.5) {
        hrs -= (13.5 - dS);
      } else if (dS <= 12 && dE > 12 && dE < 13.5) {
        hrs -= (dE - 12);
      }

      let finalDayHrs = Math.max(0, hrs);
      if (finalDayHrs > 0) {
        total += finalDayHrs;
        workDays.push(`${curr.getMonth() + 1}/${curr.getDate()}`);
      }
    }
    curr.setDate(curr.getDate() + 1);
    safety++;
  }

  els.totalHrs.innerText = total;

  // 顯示計入天數明細
  if (els.leaveDetailText && workDays.length > 0) {
    els.leaveDetailText.innerText = `計入工作日：${workDays.join('、')} (共 ${workDays.length} 天)`;
    els.leaveDetailText.style.display = 'block';
  }

  // 判斷餘額不足
  let remain = 0;
  if (type === "特休") remain = currentEmp.remainSpecial;
  else if (type === "病假") remain = currentEmp.remainSick;
  else if (type === "事假") remain = currentEmp.remainPersonal;
  else if (type === "生理假") remain = currentEmp.remainMenstrual;

  if (total <= 0) {
    showError(true, '<i class="fa-solid fa-circle-info"></i> 計算時數為 0，請檢查是否選在假日或午休時間。', 'error');
    return;
  }

  if (total > remain) {
    if (type === "特休") {
      // 檢查是否企圖預先使用在發放日之前的日期
      if (currentEmp.nextSpecialDate && new Date(sD) < new Date(currentEmp.nextSpecialDate)) {
        showError(true, `<i class="fa-solid fa-circle-xmark"></i> 特休餘額不足！您申請的起始日 (${sD}) 早於下次發放日 (${currentEmp.nextSpecialDate})，無法預支。`, 'error');
        return;
      }

      let nextNotice = "";
      if (currentEmp.nextSpecialDate && currentEmp.nextSpecialHrs) {
        nextNotice = `<br><span style="font-size: 0.9em; opacity: 0.85;">(📌 系統預報：您將於 ${currentEmp.nextSpecialDate} 獲得 ${currentEmp.nextSpecialHrs} hr 特休)</span>`;
      }
      showError(true, `<div style="text-align:left;"><i class="fa-solid fa-circle-info"></i> <strong>提醒：本次申請為「預排未來特休」</strong><br>系統偵測到您申請的日期將動用到下個年度的特休額度。<br>建議於「備註欄」簡單說明預排原因，通知主管。${nextNotice}</div>`, 'warning');
      // 不 return，允許按鈕解鎖
    } else {
      showError(true, `<i class="fa-solid fa-circle-xmark"></i> 餘假不足！您申請了 ${total} hr，但只剩下 ${remain} hr。`, 'error');
      return;
    }
  } else {
    showError(false); // 餘額充足，隱藏殘留的警告
  }

  // 一切正常或為軟提示狀態，解鎖按鈕
  els.submitBtn.disabled = false;
}

function showError(show, msg = '', alertType = 'error') {
  if (show) {
    els.overLimitMsg.innerHTML = msg;
    if (alertType === 'warning') {
      els.overLimitMsg.style.color = '#92400E';
      els.overLimitMsg.style.backgroundColor = '#FEF3C7';
      els.overLimitMsg.style.borderColor = '#F59E0B';
    } else {
      els.overLimitMsg.style.color = 'var(--error-color)';
      els.overLimitMsg.style.backgroundColor = '#FEF2F2';
      els.overLimitMsg.style.borderColor = '#FCA5A5';
    }
    els.overLimitMsg.style.display = 'flex';
  } else {
    els.overLimitMsg.style.display = 'none';
  }
}

// 送出表單 (POST 至 GAS)
async function submitLeave() {
  const payload = {
    name: currentEmp.name,
    type: els.typeSelect.value,
    note: els.note.value || "",
    hours: parseFloat(els.totalHrs.innerText),
    start: `${els.startDate.value} ${els.startH.value}:${els.startM.value}`,
    end: `${els.endDate.value} ${els.endH.value}:${els.endM.value}`,
    userEmail: currentEmp.email || "",
    holidays: holidayList.map(h => typeof h === 'object' ? h.date : h)
  };

  // 鎖定 UI 顯示等待
  els.submitBtn.disabled = true;
  els.submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 申請遞交中...';

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      // 不指定 headers (text/plain) 以避免 GAS CORS preflight(OPTIONS) 錯誤 //
    });

    // 原本如果回傳不是 JSON，可能會解析錯誤。由於我們回傳 ContentService JSON，所以這層安全：
    const result = await response.json();

    if (result.status === "OK") {
      await Swal.fire({
        icon: 'success',
        title: '申請成功！',
        html: `系統已發信通知主管與您的信箱，<br>並為您將行程同步至 <br>${document.getElementById('headerTitle') ? document.getElementById('headerTitle').innerText : "系統"}網頁日曆與GOOGLE行事曆。`,
        confirmButtonColor: 'var(--primary-color)'
      });
      // 重整頁面
      window.location.reload();
    } else {
      throw new Error(result.status || result.error);
    }

  } catch (err) {
    console.error(err);
    Swal.fire({
      icon: 'error',
      title: '發生系統錯誤',
      text: '請稍後再試！\n錯誤訊息：' + err.message,
      confirmButtonColor: 'var(--primary-color)'
    });
    els.submitBtn.disabled = false;
    els.submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 確認送出申請';
  }
}

// 從開源 API 獲取台灣假日
async function fetchTaiwanHolidays(year) {
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
    const data = await res.json();
    return data
      .filter(d => d.isHoliday)
      .map(d => {
        // "20240101" -> "2024-01-01"
        const str = d.date;
        return {
          date: `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`,
          name: d.description || "國定假日"
        };
      });
  } catch (err) {
    console.warn(`無法取得 ${year} 年台灣假日資料`, err);
    return [];
  }
}

// 初始化行事曆
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  const legendEl = document.getElementById('calendarLegend');
  if (!calendarEl || typeof FullCalendar === 'undefined') return;

  // 定義一組好看的員工專屬顏色
  const defaultColors = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4', '#EAB308'];
  const empColors = {};

  employeeData.forEach((emp, index) => {
    empColors[emp.name] = defaultColors[index % defaultColors.length];
  });

  // 生成圖例
  if (legendEl) {
    legendEl.innerHTML = employeeData.map(emp => `
      <div class="legend-item">
        <div class="legend-color" style="background-color: ${empColors[emp.name]};"></div>
        <span>${emp.name}</span>
      </div>
    `).join('');
  }

  // 轉換請假紀錄為 FullCalendar 的事件格式 (塊狀全天顯示，自動跳過假日)
  const leaveEvents = [];

  leaveRecords.forEach(record => {
    if (!record.start || !record.end) return;

    // 取得完整的請假區間字串，用於點擊時顯示
    const trueStartStr = record.start.replace(' ', 'T');
    const trueEndStr = record.end.replace(' ', 'T');

    // 拆解為按「天」處理 (忽略時分秒)
    const startDate = new Date(record.start.split(' ')[0]);
    const endDate = new Date(record.end.split(' ')[0]);

    let curr = new Date(startDate);
    let blockStart = null;
    let blockEnd = null;
    let safety = 0;

    while (curr <= endDate && safety < 100) {
      const cStr = curr.getFullYear() + '-' + String(curr.getMonth() + 1).padStart(2, '0') + '-' + String(curr.getDate()).padStart(2, '0');

      if (!isHoliday(curr)) {
        // 如果遇到工作日，且還沒有 block，就開一個新的 block
        if (!blockStart) {
          blockStart = cStr;
        }
        blockEnd = cStr; // 更新 block 的最後一天
      } else {
        // 如果遇到假日，且目前有 block 正在累積，就把前一段 block 推入
        if (blockStart) {
          // 為了讓 FullCalendar 的全天事件涵蓋最後一天，end 必須推遲一天
          let realEnd = new Date(blockEnd);
          realEnd.setDate(realEnd.getDate() + 1);
          let realEndStr = realEnd.getFullYear() + '-' + String(realEnd.getMonth() + 1).padStart(2, '0') + '-' + String(realEnd.getDate()).padStart(2, '0');

          // 處理隱私假別 (生理假對外顯示為病假)
          let displayType = record.type;
          if (record.type === "生理假") {
            displayType = "病假";
          }

          leaveEvents.push({
            title: `${record.name} (${displayType})`,
            start: blockStart,
            end: realEndStr,
            backgroundColor: empColors[record.name] || '#9CA3AF',
            borderColor: 'transparent',
            allDay: true,
            extendedProps: {
              note: record.note,
              trueStart: trueStartStr,
              trueEnd: trueEndStr
            }
          });
          blockStart = null; // 重置
        }
      }

      curr.setDate(curr.getDate() + 1);
      safety++;
    }

    // 收尾最後一個 block
    if (blockStart) {
      let realEnd = new Date(blockEnd);
      realEnd.setDate(realEnd.getDate() + 1);
      let realEndStr = realEnd.getFullYear() + '-' + String(realEnd.getMonth() + 1).padStart(2, '0') + '-' + String(realEnd.getDate()).padStart(2, '0');

      // 處理隱私假別 (生理假對外顯示為病假)
      let displayType = record.type;
      if (record.type === "生理假") {
        displayType = "病假";
      }

      leaveEvents.push({
        title: `${record.name} (${displayType})`,
        start: blockStart,
        end: realEndStr,
        backgroundColor: empColors[record.name] || '#9CA3AF',
        borderColor: 'transparent',
        allDay: true,
        extendedProps: {
          note: record.note,
          trueStart: trueStartStr,
          trueEnd: trueEndStr
        }
      });
    }
  });

  // 將放假日轉換為事件
  const holidayEvents = holidayList.map(h => {
    const dStr = typeof h === 'object' ? h.date : h;
    const hName = typeof h === 'object' ? h.name : '公司假日';
    return {
      title: hName,
      start: dStr,
      allDay: true,
      classNames: ['event-holiday']
    };
  });

  const events = [...leaveEvents, ...holidayEvents];

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'zh-tw',
    weekends: false, // 預設隱藏週末，只顯示 5 天以解決手機擁擠問題
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: '' // 已移除日、週、月切換按鈕
    },
    buttonText: {
      today: '今天'
    },
    events: events,
    eventClick: function (info) {
      if (info.event.classNames.includes('event-holiday')) return; // 假日不開放點擊

      const startText = info.event.extendedProps.trueStart ? new Date(info.event.extendedProps.trueStart).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const endText = info.event.extendedProps.trueEnd ? new Date(info.event.extendedProps.trueEnd).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const timeRange = endText ? `${startText} ~ ${endText}` : startText;

      const empName = info.event.title.split(' ')[0];
      const leaveTypeMatch = info.event.title.match(/\((.*?)\)/);
      const leaveType = leaveTypeMatch ? leaveTypeMatch[1] : '';

      alert(`請假資訊\n================\n請假人：${empName}\n假別：${leaveType}\n時間：${timeRange}`);
    },
    height: 'auto',
    themeSystem: 'standard',
    displayEventTime: false // 全域隱藏時間
  });

  calendar.render();
}
