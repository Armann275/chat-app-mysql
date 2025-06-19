const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: 'localhost',  // Use the external proxy host provided
    port: 3306,                     // Use the port provided (31366)
    user: 'root',                    // The username (root)
    password: 'Armkvas275',  // The password
    database: 'chat_app',             // The database name (railway)
  });
  
module.exports = {pool}