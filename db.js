require('dotenv').config();
const { Pool } = require('pg');
const config = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'stroy_market', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD
};
if (process.env.DB_SSL === 'true') config.ssl = { rejectUnauthorized: false };
const pool = new Pool({ ...config, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error.code || 'unknown'));
module.exports = pool;