const jwt = require('jsonwebtoken');
const {findUserBySessionId} = require('../queryFunctions/query');
const { ApiError } = require('../exeptions/api-error');

async function validateToken(req,res,next){
    try {
        let token;
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === "Bearer") {
        token = req.headers.authorization.split(' ')[1]
    }
    if (!token) {
        throw new ApiError('Token missing',404);
    }
    const decoded = jwt.verify(token,'acsess');
    if (!decoded) {
        return res.status(401).json({message:"Unauthorized"})
    }
        
    const user = await findUserBySessionId(decoded.id,decoded.sessionId);
    
    req.decoded = decoded;
    req.userId = decoded.id;
    next()
    } catch (error) {
        next(error);
    }
}

async function validateRefreshToken(req,res,next) {
    try {
        const token = req.cookies.refreshToken;
        if (!token) {
           return res.redirect('/login');
        }
        const decoded = jwt.verify(token,'refresh');
        if (!decoded) {
            return res.status(401).json({message:"Unauthorized"})
        }
        
        const user =  await findUserBySessionId(decoded.id,decoded.sessionId);
        if (!user) {
            return res.redirect('/login');
        }
        req.decoded = decoded;
        req.userId = decoded.id;
        next();
    } catch (error) {
        next(error)
    }
}


module.exports = {validateToken,validateRefreshToken}
