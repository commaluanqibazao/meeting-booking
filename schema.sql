-- Meeting Room Booking System Schema

CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  capacity INT NOT NULL,
  description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  booker_name VARCHAR(100) NOT NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  people_count INT NOT NULL,
  purpose VARCHAR(500) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  INDEX idx_room_date (room_id, booking_date),
  INDEX idx_date_time (booking_date, start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed rooms
INSERT IGNORE INTO rooms (id, name, capacity, description) VALUES
  (1, '金沙滩', 10, '可容纳10人，配有电视、白板'),
  (2, '银沙滩', 8, '可容纳8人，配有电视、白板');
