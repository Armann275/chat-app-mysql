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
    // console.log(decoded);
    
    // console.log(token,"dsd");
    
    // if (!decoded) {
    //     console.log("ds");
        
        
    // }
    
    const user = await findUserBySessionId(decoded.id,decoded.sessionId);
    
    req.decoded = decoded;
    req.userId = decoded.id;
    next()
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({message:"Unauthorized"});
        }
        next(error);
    }
}

async function validateRefreshToken(req,res,next) {
    try {
        const token = req.cookies.refreshToken;
        // console.log('refreshToken '+ token);
        
        if (!token) {
           return res.redirect('/login');
        }
        const decoded = jwt.verify(token,'refresh');
        // if (!decoded) {
        //     return res.status(401).json({message:"Unauthorized"})
        // }
        // console.log(`userId:${decoded.id} sessionId:${decoded.sessionId}`);
        
        const user = await findUserBySessionId(decoded.id,decoded.sessionId);
        // console.log(user);
        
        // if (!user) {
        //     console.log("redirect");
            
        //     return res.redirect('/login');
        // }
        req.decoded = decoded;
        req.userId = decoded.id;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({message:"Unauthorized"});
        }
        next(error)
    }
}


module.exports = {validateToken,validateRefreshToken}
