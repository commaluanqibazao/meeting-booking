/**
 * AI-Powered Natural Language Parser for Meeting Room Booking
 * Uses DeepSeek API with strict JSON schema output
 */

// Load env from .env file as fallback
if (!process.env.DEEPSEEK_API_KEY) {
  try {
    const fs = require('fs');
    const envPath = require('path').join(__dirname, '..', '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      if (line.startsWith('export DEEPSEEK_API_KEY=')) {
        var parts = line.split('=');
        process.env.DEEPSEEK_API_KEY = parts[1].trim().replace(/^"|"$/g, '');
        break;
      }
    }
  } catch (e) { /* ignore */ }
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const ROOMS = { '金沙滩': 1, '银沙滩': 2 };

async function parseBookingText(text) {
  if (!text || text.trim().length === 0) {
    return { error: '请输入预定内容' };
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const systemPrompt = `## 角色
你是会议室预定助手，负责从用户自然语言中提取结构化预定信息。

## 当前日期
${todayStr}

## 会议室
| 名称 | 容量 |
|------|------|
| 金沙滩 | 10人 |
| 银沙滩 | 8人 |

## 输出格式
必须返回严格合法的JSON，字段如下：

{
  "room": "<"金沙滩" 或 "银沙滩">",
  "date": "<YYYY-MM-DD>",
  "startTime": "<HH:MM 24小时制>",
  "endTime": "<HH:MM 24小时制>",
  "peopleCount": <纯数字, 不含单位>,
  "bookerName": "<姓名>",
  "purpose": "<事由>"
}

## 规则
- room: 必须精确返回"金沙滩"或"银沙滩"（不能有"金沙""金沙浴"等变体），用户没说则null
- date: 换算为YYYY-MM-DD格式，用户没说则null
- startTime/endTime: 24小时制HH:MM格式，"下午3点"→15:00，"10点半"→10:30，用户没说则null
- peopleCount: 纯数字如5，不加"人""位"等字，用户没说则null
- bookerName: 纯姓名，"我叫张三"→"张三"，用户没说则null
- purpose: 会议事由，用户没说则null（后端默认"会议"）
- "帮我预定""帮我订"等是请求动作，不是事由也不是姓名
- 只输出JSON，不要其他文字、不要markdown代码块标记

## 示例
用户说："明天下午3点到5点金沙滩，5个人，我叫小张，产品评审会"
输出：{"room":"金沙滩","date":"${getFutureDate(todayStr, 1)}","startTime":"15:00","endTime":"17:00","peopleCount":5,"bookerName":"小张","purpose":"产品评审会"}

用户说："今天晚上用银沙滩"
输出：{"room":"银沙滩","date":"${todayStr}","startTime":"20:00","endTime":"22:00","peopleCount":null,"bookerName":null,"purpose":null}`;

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.05,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DeepSeek API error:', response.status, errText);
      return { error: `AI解析服务暂时不可用（${response.status}）` };
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    // Strip markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) content = jsonMatch[1].trim();
    
    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('AI returned invalid JSON:', content);
      return { error: '解析失败，请重新输入' };
    }

    if (result.error) return { error: result.error };

    // --- Normalize room name ---
    if (result.room) {
      const normalized = normalizeRoom(result.room);
      if (!normalized) {
        return { error: `未识别到会议室"${result.room}"，请指定"金沙滩"或"银沙滩"` };
      }
      result.room = normalized;
    }

    // --- Set defaults ---
    if (!result.date) result.date = todayStr;
    if (!result.purpose) result.purpose = '会议';

    // --- Normalize time format ---
    result.startTime = normalizeTime(result.startTime);
    result.endTime = normalizeTime(result.endTime);
    
    if (result.startTime) result.startStr = result.startTime.slice(0, 5);
    if (result.endTime) result.endStr = result.endTime.slice(0, 5);

    // --- Calculate duration ---
    if (result.startTime && result.endTime) {
      result.durationMinutes = timeToMinutes(result.endTime) - timeToMinutes(result.startTime);
    }

    return result;
  } catch (err) {
    console.error('AI parser error:', err.message);
    return { error: '解析服务异常，请重试' };
  }
}

function normalizeRoom(room) {
  const map = {
    '金沙滩': '金沙滩', '金沙': '金沙滩', '金': '金沙滩',
    '银沙滩': '银沙滩', '银沙': '银沙滩', '银': '银沙滩'
  };
  return map[room] || null;
}

function normalizeTime(t) {
  if (!t) return null;
  t = t.trim();
  if (t.includes(':')) return t.length === 5 ? t + ':00' : t;
  if (/^\d{1,2}$/.test(t)) return t.padStart(2, '0') + ':00:00';
  return t;
}

function timeToMinutes(t) {
  const p = t.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function getFutureDate(today, offset) {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

module.exports = { parseBookingText };
