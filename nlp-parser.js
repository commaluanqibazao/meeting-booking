/**
 * AI-Powered Natural Language Parser for Meeting Room Booking
 * Uses DeepSeek API for semantic understanding
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * Parse natural language booking input using AI
 * @param {string} text - Natural language input
 * @returns {Promise<Object>} Parsed result
 */
async function parseBookingText(text) {
  if (!text || text.trim().length === 0) {
    return { error: '请输入预定内容' };
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const systemPrompt = `你是一个会议室预定助手的自然语言理解引擎。你的任务是从用户输入中提取预定信息。

当前日期：${todayStr}

会议室列表：
1. 金沙滩 - 可容纳10人
2. 银沙滩 - 可容纳8人

预定规则：
- 每次最多4小时
- 最多提前7天预定
- 24小时可用

从用户的自然语言输入中提取以下信息（JSON格式）：
{
  "room": "金沙滩 或 银沙滩，如果用户没指定则设为null",
  "date": "YYYY-MM-DD格式的日期，如果用户没指定则设为null（默认今天）",
  "startTime": "HH:MM格式的开始时间，如果用户没指定则设为null",
  "endTime": "HH:MM格式的结束时间，如果用户没指定则设为null",
  "peopleCount": "人数（数字），如果用户没提到则设为null",
  "bookerName": "预定人姓名，如果没提到则设为null",
  "purpose": "会议事由或目的，如果没提到则设为null"
}

注意：
- 日期描述如"今天""明天""后天""周X""下周一""X月X号"等要正确换算成YYYY-MM-DD
- 时间描述如"下午3点"要换算成15:00，"上午10点半"换算成10:30
- 如果用户只说了"X点到Y点"而没有上午/下午，根据常识判断（如3点一般是下午15点，10点一般是上午10点）
- 如果用户说了"晚上"但时间在0-6点，应该是凌晨/深夜；如果18-23点才正常
- "帮我预定""帮我订""预定""预约"等都是请求预定动作，不是会议事由，也不提取为预定人
- 如果用户没有明确说名字，bookerName设为null
- 如果用户没有说事由，purpose设为null（后端会默认"会议"）
- 如果用户没提人数，peopleCount设为null
- 不验证人数，不验证容量，不验证时长，不验证日期范围——这些交给后端做
- 如果用户信息严重不完整导致无法理解，在error字段说明问题
- 对于"金沙滩"的变体（金沙、金）也要识别出来，银沙滩类似
- "9楼""九楼"等只是楼层信息，不是会议室名

只返回JSON，不要其他文字。`;

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
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('DeepSeek API error:', response.status, errText);
      return { error: `AI解析服务暂时不可用（${response.status}），请稍后再试` };
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    
    // Parse JSON from response (handle code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    const result = JSON.parse(jsonStr);
    
    // Validate result
    if (result.error) {
      return { error: result.error };
    }
    
    // Set defaults for null fields
    if (!result.date) result.date = todayStr;
    
    // Format times
    if (result.startTime) {
      result.startTime = result.startTime.includes(':') ? result.startTime + ':00' : `${result.startTime}:00:00`;
      result.startStr = result.startTime.slice(0, 5);
    }
    if (result.endTime) {
      result.endTime = result.endTime.includes(':') ? result.endTime + ':00' : `${result.endTime}:00:00`;
      result.endStr = result.endTime.slice(0, 5);
    }
    
    // Calculate duration
    if (result.startTime && result.endTime) {
      const startMin = timeToMinutes(result.startTime);
      const endMin = timeToMinutes(result.endTime);
      result.durationMinutes = endMin - startMin;
    }
    
    return result;
  } catch (err) {
    console.error('AI parser error:', err.message);
    return { error: '解析服务异常，请重试' };
  }
}

function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

module.exports = { parseBookingText };
