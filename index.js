const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const socketIo = require('socket.io');
const {validateToken} = require('./validate/validate');
app.use(express.json());
const http = require('http');
const server = http.createServer(app);
const io = socketIo(server);
const {pool} = require('./connectDb/db')
const path = require('path');
const {getPrivateChat,validateUserInChat,checkUsersIsNotInChat,
    validateUsers,getChatParticipants,
    messageResponse,getChat,insertUsersToGroupChat,searchUsers,getMessage,insertMessage} = require('./queryFunctions/query');
const { ApiError } = require('./exeptions/api-error');
const {errorHandling} = require('./middlewares/error-handling');

app.get('/main',(req,res) => {
    res.sendFile(path.join(__dirname,'main.html'))
});

app.get('/registration',(req,res) => {
    res.sendFile(path.join(__dirname,'registration.html'))
});

app.get('/login',(req,res) => {
    res.sendFile(path.join(__dirname,'login.html'))
});

app.post('/registration', async (req, res, next) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: "give all params" });
        }

        const hashpassword = await bcrypt.hash(password, 10); 
        let query = "INSERT INTO users(username, email, password) VALUES (?, ?, ?)";

        const [insertInfo] = await pool.query(query, [username, email, hashpassword]);

        query = "SELECT id, username, email FROM users WHERE id = ?";
        const [insertedValue] = await pool.query(query, [insertInfo.insertId]);

        return res.status(200).json({ user: insertedValue[0] });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: "Email already exists" });
        }
        console.error(error);
        res.status(500).json({ message: "server error", error: error.message });
    }
});


app.post('/login',async (req,res,next) => {
    try {
        const {email,password} = req.body;
    if (!email || !password) {
        return res.status(400).json({message:"give all params"})
    }

    let query = 'SELECT * FROM users WHERE EMAIL=?'
    const [rows] = await pool.query(query,[email]);
    if (rows.length === 0) {
        return res.status(404).json({message:"we dont have such an email"})
    }

    const comparePassword = await bcrypt.compare(password,rows[0].password);
    if (!comparePassword) {
        return res.status(400).json({message:"invalid password"})
    }

    const jwtPayload = {id:rows[0].id,username:rows[0].username,email:rows[0].email}
    const token = jwt.sign(jwtPayload,'secret');
    console.log({user:rows[0],token:token});
    
    return res.status(200).json({user:rows[0],token:token})

    } catch (error) {
        return res.status(500).json({message:"server error",error:error})
    }
});


app.post('/createPrivateChat', validateToken, async (req, res, next) => {
    try {
        const {targetUserId} = req.body;

        if (targetUserId === req.userId) {
            return res.status(409).json({ message: "You can't create a chat with yourself" });
        }
    

        await validateUsers([targetUserId]);
        
        
        query = `
            SELECT chat_id 
            FROM chat_participants 
            WHERE user_id IN (?, ?) 
            AND isGroup = false
            GROUP BY chat_id 
            HAVING COUNT(DISTINCT user_id) = 2
        `;

        const [existingChat] = await pool.query(query, [targetUserId, req.userId]);
        
        
        if (!existingChat[0]) {
            query = `INSERT INTO chats(isGroup)VALUES(?)`
            const [newChat] = await pool.query(query,[false]);

            const newParticipants = [
                [req.userId,newChat.insertId],
                [targetUserId,newChat.insertId]
            ];

            query =  `INSERT INTO chat_participants(user_id,chat_id) VALUES ?`
            await pool.query(query,[newParticipants]);
            
            const getNewChat = await getChat(newChat.insertId);

            const getNewChatParticipants = await getChatParticipants(newChat.insertId);
            
            return res.status(200).json({chat:getNewChat,chatParticipants:getNewChatParticipants})
        }
        
        const getChatt = await getChat(existingChat[0].chat_id);
        
        const getChatParticipantss = await getChatParticipants(existingChat[0].chat_id);
        return res.status(200).json({chat:getChatt,chatParticipants:getChatParticipantss})
    } catch (error) {
       next(error);
    }
});



app.post('/createGroup',validateToken, async (req,res,next) => {
    try {
        const {chatName,usersArr} = req.body;
        await validateUsers(usersArr)
                
        query = `INSERT INTO chats(isGroup,groupName)VALUES (?,?)`
        const [newChat] = await pool.query(query,[true,chatName]);

        let values = usersArr.map(userId => `(${userId},${newChat.insertId},"member",${true})`);
        values += `,(${req.userId},${newChat.insertId},"admin",${true})`
        
        await insertUsersToGroupChat(values);

        const chat = await getChat(newChat.insertId);
        const getChatParticipant = await getChatParticipants(newChat.insertId);
        // for(let i = 0; i < usersArr.length; i++){
        //     io.to(`user_${usersArr[i]}`).emit('new group',chat[0],getChatParticipant)
        // }
        return res.status(200).json({chat:chat[0],chatParticipants:getChatParticipant,currentUserId:req.userId});
    } catch (error) {
        next(error)
    }
});


app.post("/sendMessage/:chatId",validateToken,async (req,res,next) => {
    try {
        const chatId = +req.params.chatId;
        const {message} = req.body;
        
        await validateUserInChat([req.userId],chatId);

        query = `INSERT INTO messages(sender_id,message,chatId)VALUES(?,?,?)`;
        
        const [newChatMessage] = await pool.query(query,[req.userId,message,chatId]);
        query = `UPDATE chats SET lastMessage=? where id=?`;
        const [updateLatestMessage] = await pool.query(query,[newChatMessage.insertId,chatId])
        
        
       
        const getChatMessage = await getMessage(newChatMessage.insertId);
        
        

        const response = {
            message:getChatMessage   
        }

        return res.status(200).json(response)
    } catch (error) {
        next(error)
    }
});

app.get('/searchUsers',validateToken,async (req,res,next) => {
    try {
    const search = req.query.q || '';
    const chatId = req.query.chatId;
    console.log(search,chatId);
    
    const getUsers = await searchUsers(search,chatId,req.userId);
    return res.status(200).json({users:getUsers});
    } catch (error) {
       next(error);
    }
});


app.get("/getMessages/:chatId",validateToken,async (req,res,next) => {
    try {
        
        const chatId = +req.params.chatId;
        
        await validateUserInChat([req.userId],chatId)
        
        query = `select messages.id as id,sender_id,message,chatId, username ,email,isSystem, messages.created_at,messages.updated_at from messages inner join users on users.id = messages.sender_id
                    where 
                     chatId = ? order by created_at
                     
        `
        
        const response = [];
        
        const [getMessages] = await pool.query(query,[chatId]);
        
        
        for(let i = 0; i < getMessages.length; i++){ 
            let responseMessage = messageResponse(getMessages[i])

            response.push(  
                responseMessage
            )
        }
        return res.status(200).json({messages:response,currentUserId:req.userId})
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error.message });
    }
});



app.get("/getAllChats",validateToken,async (req,res,next) => {
    try {
        let query = `select chat_id from chat_participants where user_id=?`;
        
        const [chatIds] = await pool.query(query,[req.userId]);
        let chatIdArr = [];
        for(let el in chatIds){
            chatIdArr.push(+chatIds[el].chat_id);
        }
        
        
        const placeholders = chatIdArr.map(() => "?").join(",");

        
        query =  `SELECT user_id,chat_id,role,isGroup,username,email,created_at,updated_at FROM chat_participants INNER JOIN users ON users.id = chat_participants.user_id
        WHERE chat_participants.CHAT_ID IN(${placeholders})`;
        
        
        const [chatParticipants] = await pool.query(query,chatIdArr);
        
        query = `SELECT 
    chats.id, 
    chats.isGroup, 
    chats.groupName, 
    chats.created_at, 
    chats.updated_at, 
    
    JSON_OBJECT(
        'id', messages.id,
        'sender_id', messages.sender_id,
        'message', messages.message,
        'chatId', messages.chatId,
        'isSystem',messages.isSystem,
        'sender', JSON_OBJECT(
            'id', users.id,
            'username', users.username,
            'email', users.email
        )
        
    ) AS lastMessage
FROM chats 
LEFT JOIN messages ON messages.id = chats.lastMessage 
LEFT JOIN users ON users.id = messages.sender_id
WHERE chats.id IN (${placeholders})
ORDER BY messages.created_at DESC  
`
        
        const [getAllChats] = await pool.query(query,chatIdArr);
        return res.status(200).json({chats:getAllChats,chatParticipants:chatParticipants,currentUserId:req.userId});
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});



app.post("/groupAdd",validateToken,async (req,res,next) => {
    try {
        const {chatId,usersArr} = req.body;
        const usersObj  = await validateUsers(usersArr);
        const users = usersObj.map((el) => el.username);
        console.log(users.join(','));
        
        await checkUsersIsNotInChat(chatId,usersArr);
        
        const chatQuery = `SELECT * FROM chats WHERE id=? AND isGroup=?`;
        
        const [chat] = await pool.query(chatQuery,[chatId,true]);
        
        if (!chat[0]) {
            throw new ApiError(`there is no group chat with this id:${chatId}`,404);
        }

        const values = usersArr.map(userId => `(${userId},${chatId},"member",${true})`);
        await insertUsersToGroupChat(values);

        const participants = await getChatParticipants(chatId);

        const systemMessage = `${req.decoded.username} added ${users}`

        const newMessageId = await insertMessage(req.userId,systemMessage,chatId,true);
        
        const getChatMessage = await getMessage(newMessageId);
        
        const updateChatQuery = `UPDATE chats 
                                SET lastMessage=? 
                                WHERE id=?`;
        await pool.query(updateChatQuery,[newMessageId,chatId]);
        io.to(chatId).emit('receiveMessage',getChatMessage);
        return res.status(200).json({chat:chat, participants:participants});
    } catch (error) {
        next(error);
    }
});


app.delete("/leaveGroup",validateToken,async (req,res,next) => {
    try {
        
        const {chatId} = req.body;
        
        await validateUserInChat([req.userId],chatId,true);
        const participants = await getChatParticipants(chatId);
        if (participants.length === 1) {
                const deleteChatQuery = `DELETE FROM chats WHERE ID=?`;
                await pool.query(deleteChatQuery,[chatId]);
                return res.status(200).json({message:"you leaved this chat susscesfuly"});
        }
        const deleteParticipantQuery = `DELETE FROM chat_participants WHERE chat_id=? AND user_id=?`;
        await pool.query(deleteParticipantQuery,[chatId,req.userId]);

        const systemMessage = `${req.decoded.username} leaved the group`

        const newMessageId = await insertMessage(req.userId,systemMessage,chatId,true);
        
        const getChatMessage = await getMessage(newMessageId);
        
        const updateChatQuery = `UPDATE chats 
                                SET lastMessage=? 
                                WHERE id=?`;
        await pool.query(updateChatQuery,[newMessageId,chatId]);
        io.to(chatId).emit('receiveMessage',getChatMessage);
        return res.status(200).json({message:"you leaved this chat susscesfuly"});
    } catch (error) {
        next(error);
    }
});

app.delete('/deleteUserFromChat',validateToken,async (req,res,next) => {
    try {
        const {userId,chatId} = req.body;
        const users = await validateUsers([userId]);
        const {participants} = await validateUserInChat([userId,req.userId],chatId,true);
        console.log(participants);
        const admin = participants.find((element) => element.role === "admin");
        console.log(admin);
        
        if (!admin) {
            throw new ApiError('you are not a admin you dont have the acsess',403)
        }

        const deleteParticipantQuery = `DELETE FROM chat_participants WHERE chat_id = ? AND user_id=?`;
        await pool.query(deleteParticipantQuery,[chatId,userId]);
        console.log(users);
        
        const systemMessage = `${req.decoded.username} deleted user ${users[0].username}`

        const newMessageId = await insertMessage(req.userId,systemMessage,chatId,true);

        const getChatMessage = await getMessage(newMessageId);
        
        const updateChatQuery = `UPDATE chats 
                                SET lastMessage=? 
                                WHERE id=?`;
        await pool.query(updateChatQuery,[newMessageId,chatId]);
        io.to(chatId).emit('receiveMessage',getChatMessage);
        return res.status(200).json({message:"user Deleted succesfuly"})
    } catch (error) {
        next(error);
    }
});


app.post('/becomeGroupAdmin',validateToken,async (req,res,next) => {
    try {
        const {chatId} = req.body;
        const {participants} = await validateUserInChat([req.userId],chatId,true);
        const admin = participants.find((element) => element.role === "admin");
        if (admin) {
            throw new ApiError(`there is already admin in this group`,403);
        }
        const becomeGroupAdminQuery = `UPDATE chat_participants
                                    SET role=?
                                    WHERE user_id=? and chat_id=?
                                    `

        await pool.query(becomeGroupAdminQuery,['admin',req.userId,chatId]);

        const systemMessage = `${req.decoded.username} becomed admin`

        const newMessageId = await insertMessage(req.userId,systemMessage,chatId,true);

        const getChatMessage = await getMessage(newMessageId);
        
        
        io.to(chatId).emit('receiveMessage',getChatMessage)
        return res.status(200).json({message:"you becomed admin"})                           
    } catch (error) {
        next(error);
    }
});


app.post("/renameGroup",validateToken,async (req,res,next) => {
    try {   
        const {newGroupName,chatId} = req.body;
        await validateUserInChat([req.userId],chatId,true);

        
        const systemMessage = `${req.decoded.username} renamed the group to ${newGroupName}`

        
                            
        const newMessageId = await insertMessage(req.userId,systemMessage,chatId,true);
        
        const updateChatQuery = `UPDATE chats 
                                SET lastMessage=?, groupName=? 
                                WHERE id=?`;
        await pool.query(updateChatQuery,[newMessageId,newGroupName,chatId]);

        const chat = await getChat(chatId,true);

        const getChatMessage = await getMessage(newMessageId);
        
        
        io.to(chatId).emit('receiveMessage',getChatMessage)
        return res.status(200).json({chat:chat,message:getChatMessage});
    } catch (error) {
        next(error)
    }
});

app.delete('/deleteMessage',validateToken, async (req,res,next) => {
    try {

        const {chatId,messageId} = req.body;
        console.log(chatId,messageId);
        
        await validateUserInChat([req.userId],chatId);
        const message = await getMessage(messageId,chatId,req.userId);
        console.log(message);
        
        if (!message) {
            throw new ApiError(`there is no message with this id:${messageId}`);
        }
        const updateMessage =  `UPDATE messages
                                    SET isDeleted=?
                                WHERE id=?`;
        await pool.query(updateMessage,[true,messageId]);
        io.to(chatId).emit('deleteMessage',chatId,messageId)
        return res.status(200).json({message:"message deleted succsefuly"});                        
    } catch (error) {
        next(error);
    }
});

app.delete('/deleteChat',validateToken,async (req,res,next) => {
    try {
        const {chatId} = req.body;
        await validateUserInChat([req.userId],chatId,false);

        const deleteChatQuery = `DELETE FROM chats WHERE id=?`;
        await pool.query(deleteChatQuery,[chatId]);
        return res.status(200).json({message:"chat Deleted sussesfuly"})
    } catch (error) {
        next(error);
    }
});


app.use(errorHandling);

io.on('connection', (socket) => {
    // console.log('A user connected');
    
    socket.on("join user",(userId) => {
        socket.join(`user_${userId}`);
        
        
    });
    
    socket.on("join chat",(chatId) => {
        socket.join(chatId);
        // console.log("joined chat");
        
    });

    socket.on("sendMessage",(chatId,message) => {
        io.to(chatId).emit("receiveMessage",message);
        // console.log("new message");
        
    });

    socket.on('disconnect', () => {
    //   console.log('A user disconnected');
    });

    socket.on('leaveGroup',(chatId) => {
        socket.leave(chatId);
    });

    socket.on('deleteParticipant',(userId,chatId) => {
        io.to(`user_${userId}`).emit('deleteParticipant',chatId);
    });
});


server.listen(3306);

module.exports = {io}
