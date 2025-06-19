const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {pool} = require('../connectDb/db');
async function generateTokens(jwtPayload,userId){
    jwtPayload.sessionId = uuidv4(); 
    
    console.log(userId,jwtPayload);
    const updateSessionQuery = `UPDATE users SET sessionId=? where id=?`
    await pool.query(updateSessionQuery,[jwtPayload.sessionId,userId]);
    
    
    const acsesstoken = jwt.sign(jwtPayload,'acsess',{expiresIn:'3h'});
    const refreshToken = jwt.sign(jwtPayload,'refresh',{expiresIn:'30d'});
    return {acsesstoken,refreshToken}
}

module.exports = {generateTokens}
