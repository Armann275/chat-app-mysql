const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: 'ballast.proxy.rlwy.net',  // Use the external proxy host provided
    port: 31366,                     // Use the port provided (31366)
    user: 'root',                    // The username (root)
    password: 'BxNOQdGMKQlGIZmDVzCwgtIkCgIVqfqJ',  // The password
    database: 'railway',             // The database name (railway)
  });
  
module.exports = {pool}