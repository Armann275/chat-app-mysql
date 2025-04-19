const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'chat_app',
    password:"Armkvas275"
});
module.exports = {pool}