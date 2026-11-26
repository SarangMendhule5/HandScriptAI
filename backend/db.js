
const mysql = require('mysql2/promise');
require('dotenv').config();

const poolOptions = {
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

if (process.env.MYSQL_URL) {
    // Parse MySQL connection URL correctly
    const dbUrl = new URL(process.env.MYSQL_URL);

    poolOptions.host = dbUrl.hostname;
    poolOptions.port = Number(dbUrl.port || 3306);
    poolOptions.user = decodeURIComponent(dbUrl.username);
    poolOptions.password = decodeURIComponent(dbUrl.password);
    poolOptions.database = dbUrl.pathname.replace(/^\//, '');
} else {
    // Local MySQL configuration
    poolOptions.host = process.env.DB_HOST || '127.0.0.1';
    poolOptions.port = Number(process.env.DB_PORT || 3307);
    poolOptions.user = process.env.DB_USER || 'root';
    poolOptions.password = process.env.DB_PASSWORD || '';
    poolOptions.database = process.env.DB_NAME || 'handscript';
}

// SSL configuration
if (process.env.DB_SSL === 'true') {
    poolOptions.ssl = {
        rejectUnauthorized: false
    };
}

const pool = mysql.createPool(poolOptions);

async function initializeDB() {
    try {
        const conn = await pool.getConnection();
        console.log('[DB] MySQL connection successful');
        conn.release();

        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NULL,
                google_id VARCHAR(255) UNIQUE NULL,
                name VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create prescriptions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS prescriptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                image_preview LONGTEXT NOT NULL,
                result_json JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
            )
        `);

        console.log('[DB] Tables created or already exist ✅');
        return true;

    } catch (error) {
        console.error('[DB ERROR]', error.code || error.message);
        return false;
    }
}

initializeDB();

module.exports = pool;
