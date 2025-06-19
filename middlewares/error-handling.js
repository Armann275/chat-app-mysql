const {ApiError} = require('../exeptions/api-error')
function errorHandling(err,req,res,next){
    
    if (err instanceof ApiError) {
        return res.status(err.status).json({message:err.message});
    }
    
    
    
    return res.status(500).json({message:"server error",error:err.message})
}
module.exports = {errorHandling}
