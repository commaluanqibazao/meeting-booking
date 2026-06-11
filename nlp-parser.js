/**
 * Natural Language Parser for Chinese Meeting Room Booking
 * 
 * Supported patterns:
 * - "明天下午3点到5点预定金沙滩，5个人，我叫张三"
 * - "今天晚上8点用银沙滩，4位"
 * - "6月12号上午9点到12点金沙滩，8人开会"
 * - "后天上午10点至11点半银沙滩，3个人"
 * - "下周一14:00-16:00金沙滩，6人"
 * - "周五下午2:30-4:30金沙滩，5个人，产品评审会"
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

// Set timezone to Asia/Shanghai
dayjs.tz.setDefault('Asia/Shanghai');

/**
 * Parse natural language booking input
 * @param {string} text - Natural language input
 * @returns {Object|null} Parsed result or null with error
 */
function parseBookingText(text) {
  if (!text || text.trim().length === 0) {
    return { error: '请输入预定内容' };
  }

  let result = {};
  const normalized = text.trim();

  // 1. Extract room name
  const roomResult = extractRoom(normalized);
  if (roomResult.error) return roomResult;
  result.room = roomResult.room;
  let remaining = roomResult.remaining;

  // 2. Extract date
  const dateResult = extractDate(remaining);
  if (dateResult.error) return dateResult;
  result.date = dateResult.date;
  result.dateStr = dateResult.dateStr;
  remaining = dateResult.remaining;

  // 3. Extract time range
  const timeResult = extractTimeRange(remaining);
  if (timeResult.error) return timeResult;
  result.startTime = timeResult.startTime;
  result.endTime = timeResult.endTime;
  result.startStr = timeResult.startStr;
  result.endStr = timeResult.endStr;
  remaining = timeResult.remaining;

  // 4. Validate duration (max 4 hours)
  const startMin = timeToMinutes(result.startTime);
  const endMin = timeToMinutes(result.endTime);
  const durationMin = endMin - startMin;
  if (durationMin <= 0) {
    return { error: '结束时间必须晚于开始时间' };
  }
  if (durationMin > 240) {
    return { error: '每次预定最多4小时（240分钟）' };
  }
  result.durationMinutes = durationMin;

  // 5. Extract people count
  const peopleResult = extractPeople(remaining);
  if (peopleResult.error) return peopleResult;
  result.peopleCount = peopleResult.count;
  remaining = peopleResult.remaining;

  // 6. Check capacity
  const roomCapacities = { '金沙滩': 10, '银沙滩': 8 };
  if (result.peopleCount > roomCapacities[result.room]) {
    return { error: `${result.room}最多容纳${roomCapacities[result.room]}人，您预定${result.peopleCount}人超出限制` };
  }

  // 7. Extract booker name
  const nameResult = extractName(remaining);
  if (nameResult.error) return nameResult;
  result.bookerName = nameResult.name;
  remaining = nameResult.remaining;

  // 8. Remaining text as purpose
  result.purpose = remaining.replace(/[，,、。.：:；;！!？?]/g, ' ').trim();
  if (result.purpose.startsWith('预定') || result.purpose.startsWith('用') || result.purpose.startsWith('开')) {
    result.purpose = result.purpose.replace(/^(预定|用|开[会]?)(.*)/, '$2').trim();
  }
  if (!result.purpose || result.purpose === '预定' || result.purpose === '用') {
    result.purpose = '会议';
  }

  // 9. Validate booking window (max 7 days in advance)
  const now = dayjs().tz('Asia/Shanghai').startOf('day');
  const bookingDate = dayjs(result.dateStr, 'YYYY-MM-DD');
  const diffDays = bookingDate.diff(now, 'day');
  if (diffDays < 0) {
    return { error: '不能预定过去的日期' };
  }
  if (diffDays > 7) {
    return { error: '最多可以提前一周（7天）预定会议室' };
  }

  return result;
}

function extractRoom(text) {
  const roomPatterns = [
    { name: '金沙滩', patterns: [/金沙滩/, /金沙/] },
    { name: '银沙滩', patterns: [/银沙滩/, /银沙/, /银/] }
  ];

  // Try exact match first
  if (text.includes('金沙滩')) {
    return { room: '金沙滩', remaining: text.replace('金沙滩', '').trim() };
  }
  if (text.includes('金沙')) {
    return { room: '金沙滩', remaining: text.replace('金沙', '').trim() };
  }
  if (text.includes('银沙滩')) {
    return { room: '银沙滩', remaining: text.replace('银沙滩', '').trim() };
  }
  if (text.includes('银沙')) {
    return { room: '银沙滩', remaining: text.replace('银沙', '').trim() };
  }

  // Otherwise try to just match standalone "银"
  const silverMatch = text.match(/[^金]银[^沙]/);
  if (silverMatch && !text.includes('金银')) {
    return { room: '银沙滩', remaining: text.replace('银', '').trim() };
  }

  return { error: '未识别到会议室名称，请指定"金沙滩"或"银沙滩"' };
}

function extractDate(text) {
  const now = dayjs().tz('Asia/Shanghai');
  const today = now.format('YYYY-MM-DD');
  
  let matchedDate = null;
  let remaining = text;

  // Pattern: 今天/明天/后天
  const relativeDayMatch = remaining.match(/^(今天|明天|后天|大后天)/);
  if (relativeDayMatch) {
    const offset = { '今天': 0, '明天': 1, '后天': 2, '大后天': 3 };
    matchedDate = now.add(offset[relativeDayMatch[1]], 'day');
    remaining = remaining.slice(relativeDayMatch[0].length).trim();
    return { date: matchedDate.format('YYYY-MM-DD'), dateStr: matchedDate.format('YYYY-MM-DD'), remaining };
  }

  // Pattern: X月X号/日
  const monthDayMatch = remaining.match(/(\d{1,2})月(\d{1,2})(号|日)/);
  if (monthDayMatch) {
    const month = parseInt(monthDayMatch[1]);
    const day = parseInt(monthDayMatch[2]);
    let year = now.year();
    // If the month has passed this year, assume next year
    if (month < now.month() + 1 || (month === now.month() + 1 && day < now.date())) {
      year += 1;
    }
    matchedDate = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 'YYYY-MM-DD');
    remaining = remaining.slice(monthDayMatch[0].length).trim();
    return { date: matchedDate.format('YYYY-MM-DD'), dateStr: matchedDate.format('YYYY-MM-DD'), remaining };
  }

  // Pattern: 下周一/二/三/四/五/六/日/天
  const nextWeekdayMatch = remaining.match(/^下[周星期](一|二|三|四|五|六|日|天)/);
  if (nextWeekdayMatch) {
    const weekdayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    const targetDay = weekdayMap[nextWeekdayMatch[1]];
    let daysUntil = targetDay - now.day();
    if (daysUntil === 0) daysUntil = 7; // same day next week
    else if (daysUntil <= 0) daysUntil += 7;
    daysUntil += 7; // "下" means next week, so add another 7
    matchedDate = now.add(daysUntil, 'day');
    remaining = remaining.slice(nextWeekdayMatch[0].length).trim();
    return { date: matchedDate.format('YYYY-MM-DD'), dateStr: matchedDate.format('YYYY-MM-DD'), remaining };
  }

  // Pattern: 周X/星期X (this week)
  const weekdayMatch = remaining.match(/^[周星期](一|二|三|四|五|六|日|天)/);
  if (weekdayMatch) {
    const weekdayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    const targetDay = weekdayMap[weekdayMatch[1]];
    let daysUntil = targetDay - now.day();
    if (daysUntil <= 0) daysUntil += 7;
    matchedDate = now.add(daysUntil, 'day');
    remaining = remaining.slice(weekdayMatch[0].length).trim();
    return { date: matchedDate.format('YYYY-MM-DD'), dateStr: matchedDate.format('YYYY-MM-DD'), remaining };
  }

  // Pattern: YYYY-MM-DD or YYYY年MM月DD日
  const fullDateMatch = remaining.match(/(\d{4})[年-](\d{1,2})[月-](\d{1,2})(日|号)?/);
  if (fullDateMatch) {
    matchedDate = dayjs(`${fullDateMatch[1]}-${String(fullDateMatch[2]).padStart(2, '0')}-${String(fullDateMatch[3]).padStart(2, '0')}`, 'YYYY-MM-DD');
    remaining = remaining.slice(fullDateMatch[0].length).trim();
    return { date: matchedDate.format('YYYY-MM-DD'), dateStr: matchedDate.format('YYYY-MM-DD'), remaining };
  }

  // Default: today
  return { 
    date: today, 
    dateStr: today, 
    remaining: remaining,
    note: '未指定日期，默认今天'
  };
}

function extractTimeRange(text) {
  // Time period keywords
  let periodModifier = null;
  let periodOffset = 0; // hours to add for ambiguous times
  
  const periodMatch = text.match(/^(早上|上午|下午|晚上|中午|凌晨|傍晚)/);
  if (periodMatch) {
    periodModifier = periodMatch[1];
    const periodMap = {
      '凌晨': 0, '早上': 6, '上午': 8, '中午': 11,
      '下午': 13, '傍晚': 17, '晚上': 18
    };
    periodOffset = periodMap[periodModifier];
    text = text.slice(periodMatch[0].length).trim();
  }

  // Pattern: HH:MM-HH:MM
  const timeRangeMatch1 = text.match(/(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})/);
  if (timeRangeMatch1) {
    let startH = parseInt(timeRangeMatch1[1]);
    let endH = parseInt(timeRangeMatch1[3]);
    const startM = parseInt(timeRangeMatch1[2]);
    const endM = parseInt(timeRangeMatch1[4]);

    // Apply period modifier
    if (periodModifier && startH < 12 && (periodModifier === '下午' || periodModifier === '晚上' || periodModifier === '傍晚')) {
      startH += 12;
    }
    if (periodModifier && endH < 12 && (periodModifier === '下午' || periodModifier === '晚上' || periodModifier === '傍晚')) {
      endH += 12;
    }

    // If end hour seems wrong relative to start hour
    if (endH <= startH && startH < 12) {
      endH += 12;
    }
    if (endH <= startH && endH < startH) {
      endH += 12;
    }

    const remaining = text.replace(timeRangeMatch1[0], '').trim();
    return {
      startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`,
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`,
      startStr: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endStr: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      remaining
    };
  }

  // Pattern: X点到Y点 or X点至Y点 or X点-Y点
  const timeRangeMatch2 = text.match(/(\d{1,2})[点时:：]\s*(\d{0,2})(?:分|半)?\s*[-~至到]\s*(\d{1,2})[点时:：]\s*(\d{0,2})(?:分|半)?/);
  if (timeRangeMatch2) {
    let startH = parseInt(timeRangeMatch2[1]);
    const startMStr = timeRangeMatch2[2];
    let startM = startMStr ? parseInt(startMStr) : 0;
    let endH = parseInt(timeRangeMatch2[3]);
    const endMStr = timeRangeMatch2[4];
    let endM = endMStr ? parseInt(endMStr) : 0;

    // Handle "半" (half)
    if (timeRangeMatch2[0].includes('半')) {
      if (timeRangeMatch2[0].indexOf('半') < timeRangeMatch2[0].indexOf('至') && timeRangeMatch2[0].indexOf('半') < timeRangeMatch2[0].indexOf('-') && timeRangeMatch2[0].indexOf('半') < timeRangeMatch2[0].indexOf('到')) {
        startM = 30;
      } else {
        endM = 30;
      }
    }

    // Apply period modifier
    if (periodModifier) {
      if ((periodModifier === '下午' || periodModifier === '晚上' || periodModifier === '傍晚') && startH < 12) {
        startH += 12;
      }
      if ((periodModifier === '下午' || periodModifier === '晚上' || periodModifier === '傍晚') && endH < 12) {
        endH += 12;
      }
    } else {
      // Auto-detect: if start is < 7 (like 3点), likely PM
      if (startH < 7) startH += 12;
      if (endH < startH && endH < 7) endH += 12;
    }

    const remaining = text.replace(timeRangeMatch2[0], '').trim();
    return {
      startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`,
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`,
      startStr: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endStr: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      remaining
    };
  }

  // Pattern: just X点 (single time, default 1h?)
  const singleTimeMatch = text.match(/(\d{1,2})[点时]/);
  if (singleTimeMatch) {
    let hour = parseInt(singleTimeMatch[1]);
    if (periodModifier) {
      if ((periodModifier === '下午' || periodModifier === '晚上' || periodModifier === '傍晚') && hour < 12) {
        hour += 12;
      }
    } else if (hour < 7) {
      hour += 12;
    }
    const remaining = text.replace(singleTimeMatch[0], '').trim();
    return {
      startTime: `${String(hour).padStart(2, '0')}:00:00`,
      endTime: `${String(hour + 1).padStart(2, '0')}:00:00`,
      startStr: `${String(hour).padStart(2, '0')}:00`,
      endStr: `${String(hour + 1).padStart(2, '0')}:00`,
      remaining
    };
  }

  return { error: '未识别到时间范围，请指定开始和结束时间（如"3点到5点"）' };
}

function extractPeople(text) {
  // Pattern: X个人/人/位
  const peopleMatch = text.match(/(\d{1,3})\s*(个?人|位|人)/);
  if (peopleMatch) {
    const count = parseInt(peopleMatch[1]);
    const remaining = text.replace(peopleMatch[0], '').trim();
    if (count < 1) return { error: '人数必须大于0' };
    return { count, remaining };
  }

  // Try standalone number near the end, after a separator
  const numberAtEnd = text.match(/[，,、\s]+(\d{1,2})\s*$/);
  if (numberAtEnd) {
    const count = parseInt(numberAtEnd[1]);
    const remaining = text.slice(0, text.lastIndexOf(numberAtEnd[1])).trim();
    return { count, remaining };
  }

  return { error: '未识别到参会人数，请指定人数（如"5个人"）' };
}

function extractName(text) {
  // Pattern: 我叫XX / 我是XX / 预订人XX / XX预订的 / 姓名:XX
  const nameMatch = text.match(/我[叫是](\S+)/);
  if (nameMatch) {
    const name = nameMatch[1];
    const remaining = text.replace(nameMatch[0], '').trim();
    return { name, remaining };
  }

  const nameMatch2 = text.match(/姓名[：:]\s*(\S+)/);
  if (nameMatch2) {
    const name = nameMatch2[1];
    const remaining = text.replace(nameMatch2[0], '').trim();
    return { name, remaining };
  }

  const nameMatch3 = text.match(/(\S{2,4})[的预定定|预订]/);
  if (nameMatch3) {
    const name = nameMatch3[1];
    const remaining = text.replace(nameMatch3[0], '').trim();
    return { name, remaining };
  }

  // Name not found - will need to be provided through form
  return { name: null, remaining: text };
}

function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

module.exports = { parseBookingText };
