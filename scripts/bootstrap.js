require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');
function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `pbkdf2$210000$${salt}$${crypto.pbkdf2Sync(password,salt,210000,32,'sha256').toString('hex')}`;
}(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(__dirname, '../database/seed.sql'), 'utf8'));
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      if (process.env.ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must contain at least 10 characters');
      await c.query("INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT DO NOTHING", [
        'Администратор',
        process.env.ADMIN_EMAIL.toLowerCase(),
        hash(process.env.ADMIN_PASSWORD)
      ]);
    }
    await c.query('COMMIT');
    console.log('Схема и демонстрационные данные готовы.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Миграция отменена:', e.code || e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
