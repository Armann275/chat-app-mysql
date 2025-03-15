const jwt = require('jsonwebtoken');
function validateToken(req,res,next){
    let token;
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === "Bearer") {
        token = req.headers.authorization.split(' ')[1]
    }
    const decoded = jwt.verify(token,'secret');
    if (!decoded) {
        return res.status(401).json({message:"Unauthorized"})
    }
    req.decoded = decoded;
    req.userId = decoded.id;
    next()
}
module.exports = {validateToken}
