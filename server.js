const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const { parseBookingText } = require('./nlp-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'booking',
  password: process.env.DB_PASSWORD || 'Book1ng@2025!',
  database: process.env.DB_NAME || 'meeting_booking',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

// CORS - allow GitHub Pages to call API
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'docs')));

// ============ API Routes ============

// Get all rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM rooms ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    res.status(500).json({ error: '获取会议室列表失败' });
  }
});

// Parse natural language booking text
app.post('/api/parse', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: '请输入预定内容' });
  }
  
  const result = await parseBookingText(text);
  res.json(result);
});

// Check availability for a specific time slot
app.get('/api/check-availability', async (req, res) => {
  try {
    const { roomId, date, startTime, endTime } = req.query;
    
    if (!roomId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: '缺少参数' });
    }

    const [rows] = await pool.query(
      `SELECT id, booker_name, start_time, end_time 
       FROM bookings 
       WHERE room_id = ? 
         AND booking_date = ? 
         AND start_time < ? 
         AND end_time > ?`,
      [parseInt(roomId) || 0, date, endTime, startTime]
    );

    res.json({
      available: rows.length === 0,
      conflicts: rows.map(r => ({
        timeRange: `${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}`,
        booker: r.booker_name
      }))
    });
  } catch (err) {
    console.error('Error checking availability:', err);
    res.status(500).json({ error: '检查可用性失败' });
  }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { roomId, bookerName, date, startTime, endTime, peopleCount, purpose } = req.body;

    // Validate required fields (peopleCount is optional)
    if (!roomId || !bookerName || !date || !startTime || !endTime) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // Validate time
    if (startTime >= endTime) {
      return res.status(400).json({ error: '结束时间必须晚于开始时间' });
    }

    // Validate duration (max 4 hours)
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (endMin - startMin > 240) {
      return res.status(400).json({ error: '每次预定最多4小时' });
    }

    // Validate booking window (max 7 days)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const bookingDate = new Date(date);
    const diffDays = Math.floor((bookingDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      return res.status(400).json({ error: '不能预定过去的日期' });
    }
    if (diffDays > 7) {
      return res.status(400).json({ error: '最多可以提前7天预定' });
    }

    // Get room info & default peopleCount to room capacity
    const [rooms] = await pool.query('SELECT capacity, name FROM rooms WHERE id = ?', [roomId]);
    if (rooms.length === 0) {
      return res.status(400).json({ error: '会议室不存在' });
    }
    const effectivePeopleCount = peopleCount || rooms[0].capacity;
    if (peopleCount && peopleCount > rooms[0].capacity) {
      return res.status(400).json({ error: `${rooms[0].name}最多容纳${rooms[0].capacity}人，您预定${peopleCount}人超出限制` });
    }

    // Check availability
    const [conflicts] = await pool.query(
      `SELECT id FROM bookings 
       WHERE room_id = ? 
         AND booking_date = ? 
         AND start_time < ? 
         AND end_time > ?`,
      [roomId, date, endTime, startTime]
    );

    if (conflicts.length > 0) {
      return res.status(409).json({ error: '该时间段已被预订，请选择其他时间' });
    }

    // Create booking
    const [result] = await pool.query(
      `INSERT INTO bookings (room_id, booker_name, booking_date, start_time, end_time, people_count, purpose) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roomId, bookerName, date, startTime, endTime, effectivePeopleCount, purpose || '会议']
    );

    res.json({
      success: true,
      bookingId: result.insertId,
      message: `预定成功！`
    });
  } catch (err) {
    console.error('Error creating booking:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '该时间段已被预订' });
    }
    res.status(500).json({ error: '预定失败，请重试' });
  }
});

// Get bookings for a date
app.get('/api/bookings', async (req, res) => {
  try {
    const { date, roomId } = req.query;
    
    let query = `
      SELECT b.*, r.name as room_name 
      FROM bookings b 
      JOIN rooms r ON b.room_id = r.id 
      WHERE 1=1`;
    const params = [];

    if (date) {
      query += ' AND b.booking_date = ?';
      params.push(date);
    }
    if (roomId) {
      query += ' AND b.room_id = ?';
      params.push(parseInt(roomId));
    }

    query += ' ORDER BY b.booking_date, b.room_id, b.start_time';

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: '获取预定列表失败' });
  }
});

// Delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM bookings WHERE id = ?', [parseInt(req.params.id)]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '预定记录不存在' });
    }
    res.json({ success: true, message: '已取消预定' });
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: '取消预定失败' });
  }
});

// ============ Start Server ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏢 Meeting Room Booking System running at http://0.0.0.0:${PORT}`);
  console.log(`   Local: http://localhost:${PORT}`);
});

function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}
