const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const socketIo = require('socket.io');
const {validateToken,validateRefreshToken} = require('./validate/validate');
app.use(express.json());
const http = require('http');
const server = http.createServer(app);
const io = socketIo(server);
const {pool} = require('./connectDb/db');

const path = require('path');
const {validateUserInChat,checkUsersIsNotInChat,
    validateUsers,getChatParticipants,
    messageResponse,getChat,insertUsersToGroupChat,searchUsers,
    getMessage,sendSystemMessage,insertMessage,findMissingIds} = require('./queryFunctions/query');
const {generateTokens} = require('./token/token');    
const { ApiError } = require('./exeptions/api-error');
const {errorHandling} = require('./middlewares/error-handling');
const { deepStrictEqual } = require('assert');
app.use(cookieParser());


app.get('/',(req,res,next) => {
    return res.redirect('/registration');
});

app.get('/main',validateRefreshToken,(req,res) => {
    res.sendFile(path.join(__dirname,'main.html'));
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
    
    
    const tokens = await generateTokens(jwtPayload,rows[0].id); 
    console.log(tokens);
    
    res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        sameSite: 'Strict',
        secure: false, 
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });   
    
    
    
    return res.status(200).json({user:rows[0],token:tokens.acsesstoken})

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
            
            const receiver = 'user_' + targetUserId;
            console.log(receiver);
            
        
            io.to(receiver).emit('newChat',getNewChat[0],getNewChatParticipants);

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
        
        
        for(let i = 0; i < usersArr.length; i++){
            io.to(`user_${usersArr[i]}`).emit('newChat',chat[0],getChatParticipant);
        }
        
        
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
        
        
        // console.log(newChatMessage.insertId,chatId);
       
        const getChatMessage = await getMessage(newChatMessage.insertId);
        
        

        const response = {
            message:getChatMessage   
        }
        
        console.log(response);
        
        return res.status(200).json(response)
    } catch (error) {
        next(error)
    }
});

app.get('/searchUsers',validateToken,async (req,res,next) => {
    try {
    const search = req.query.q || '';
    const chatId = req.query.chatId;
    
    
    const getUsers = await searchUsers(search,chatId,req.userId);
    return res.status(200).json({users:getUsers});
    } catch (error) {
       next(error);
    }
});


app.get("/getMessages/:chatId",validateToken,async (req,res,next) => {
    try {
        
        const chatId = +req.params.chatId;
        console.log(chatId);
        
        
        
        
        await validateUserInChat([req.userId],chatId)
        
        query = `SELECT 
          messages.id AS id,
          messages.sender_id,
          messages.message,
          messages.chatId,
          messages.isSystem,
          messages.isDeleted,
          messages.replyMessageId,
          messages.created_at,
          messages.updated_at,
          users.username,
          users.email,
          replied.id AS replied_message_id,
          replied.message AS replied_message,
          replied_user.id AS replied_sender_id,
          replied_user.username AS replied_username,
          replied_user.email AS replied_email
      FROM messages
      INNER JOIN users ON users.id = messages.sender_id
      LEFT JOIN messages AS replied ON replied.id = messages.replyMessageId
      LEFT JOIN users AS replied_user ON replied_user.id = replied.sender_id
      WHERE messages.chatId = ?
      ORDER BY messages.created_at
        `
        
        const response = [];
        
        const [getMessages] = await pool.query(query,[chatId]);
        
        
        
        for(let i = 0; i < getMessages.length; i++){ 
            let responseMessage = messageResponse(getMessages[i])

            response.push(  
                responseMessage
            )
        }
        // console.log(response);

        // const readMessagesQuery = `SELECT messageReaders.userId as readerId, messageId, username,email, messageReaders.created_at
        //  FROM messageReaders INNER JOIN messages
        //  ON messages.id = messageReaders.messageId  INNER JOIN users
        //  ON users.id = messageReaders.userId  where messages.sender_id=?`

        // const [readMessages] = await pool.query(readMessagesQuery,[req.userId]);

        
        
        for(let i = 0; i < response.length; i++){
            console.log(response[i]);
        }
        
        
        
        return res.status(200).json({messages:response});
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
ORDER BY messages.created_at   
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

        const newSystemMessage = await sendSystemMessage(systemMessage,req.userId,chatId);

        io.to(chatId).emit('receiveMessage',newSystemMessage);
        console.log(chat,participants);
        
        for(let i = 0; i < usersArr.length; i++){
            io.to(`user_${usersArr[i]}`).emit('newChat',chat[0],participants);
        }
        io.to(chatId).emit('updateChatParticipantsList',chatId,participants)
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

        const newSystemMessage = await sendSystemMessage(systemMessage,req.userId,chatId);

        const updatedParticipants = await getChatParticipants(chatId);
        io.to(chatId).emit('receiveMessage',newSystemMessage);
        io.to(chatId).emit('updateChatParticipantsList',chatId,updatedParticipants)
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
        
        const admin = participants.find((element) => element.role === "admin");
        
        
        if (!admin) {
            throw new ApiError('you are not a admin you dont have the acsess',403)
        }

        const deleteParticipantQuery = `DELETE FROM chat_participants WHERE chat_id = ? AND user_id=?`;
        await pool.query(deleteParticipantQuery,[chatId,userId]);
        console.log(users);
        
        const systemMessage = `${req.decoded.username} deleted user ${users[0].username}`

        const newSystemMessage = await sendSystemMessage(systemMessage,req.userId,chatId);

        const updatedParticipants = await getChatParticipants(chatId);

        io.to(`user_${userId}`).emit('removeChat',chatId);
        io.to(chatId).emit('receiveMessage',newSystemMessage);
        io.to(chatId).emit('updateChatParticipantsList',chatId,updatedParticipants);
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
        
        
        io.to(chatId).emit('receiveMessage',getChatMessage);
        io.to(chatId).emit('newGroupName',chatId,newGroupName);
        return res.status(200).json({chat:chat,message:getChatMessage});
    } catch (error) {
        next(error)
    }
});

app.delete('/deleteMessage',validateToken, async (req,res,next) => {
    try {

        const {chatId,messageId} = req.body;
        
        
        await validateUserInChat([req.userId],chatId);

        const message = await getMessage(messageId,chatId,req.userId);
        
        
        
        if (!message) {
            throw new ApiError(`there is no message with this id:${messageId}`);
        }

        const updateMessage =  `UPDATE messages
                                    SET isDeleted=?, message=?
                                WHERE id=?`;
        await pool.query(updateMessage,[true,`${req.decoded.username} deleted message`,messageId]);
        const Message = await getMessage(messageId,chatId,req.userId);
        console.log(Message);
        
        return res.status(200).json({message:Message});                        
    } catch (error) {
        next(error);
    }
});

app.post('/editMessage',validateToken, async(req,res,next) => {
    try {

        const {chatId,messageId,newMessage} = req.body;
        await validateUserInChat([req.userId],chatId);

        const message = await getMessage(messageId,chatId,req.userId);
        
        if (!message) {
            throw new ApiError(`there is no message with this id:${messageId}`);
        }
        
        const updateMessage =  `UPDATE messages
                                    SET  message=?
                                WHERE id=?`;

        await pool.query(updateMessage,[newMessage,messageId]);
        const Message = await getMessage(messageId,chatId,req.userId);
        return res.status(200).json({message:Message});                         
    } catch (error) {
        next(error);
    }
});

app.post('/replyMessage',validateToken,async (req,res,next) => {
    try {
        const {messageId,chatId,replyMessage} = req.body;
        console.log(messageId,chatId,replyMessage);
        
        
        await validateUserInChat([req.userId],chatId);
        
        
        
        const message = await getMessage(messageId,chatId)
        
        if (!message) {
            throw new ApiError('there is no messege to reply with this id',404);
        }

        
        const newMessageId = await insertMessage(req.userId,replyMessage,chatId,false,messageId);
        const Insertedmessage = await getMessage(newMessageId,chatId,req.userId);
        return res.status(200).json({message:Insertedmessage});
    } catch (error) {
        next(error);
    }
}); 

app.delete('/deleteChat',validateToken, async (req,res,next) => {
    try {
        const {chatId} = req.body;
        
        
        await validateUserInChat([req.userId],chatId,false);


        const deleteChatQuery = `DELETE FROM chats WHERE id=?`;
        await pool.query(deleteChatQuery,[chatId]);
        io.to(chatId).emit('removeChat',chatId)
        return res.status(200).json({message:"chat Deleted sussesfuly"})
    } catch (error) {
        next(error);
    }
});

app.get('/getMyinfo',validateToken,(req,res) => {
    return res.status(200).json({
        id:req.userId,
        username:req.decoded.username,
        email:req.decoded.email
    });
});

app.post('/readMessages',validateToken,async (req,res,next) => {
    try {
        const {chatId} = req.body;
        console.log(req.userId);
        
        await validateUserInChat([req.userId],chatId);
        
        const messageQuery = `SELECT * FROM messages WHERE chatId=? AND sender_id != ?`;
        const [messages] = await pool.query(messageQuery,[chatId,req.userId]);

        const readMessagesQuery = `SELECT * FROM messageReaders WHERE chatId=? and userId=?`
        const [readMessages] = await pool.query(readMessagesQuery,[chatId,req.userId]);



        const messagesId = messages.map((el) => el.id);
        let IsFounded = false;
        const unreadIds = [];

        for(let i = 0; i < messagesId.length; i++){
            for(let j = 0; j < readMessages.length; j++){
                if (messagesId[i] === readMessages[j].messageId) {
                    IsFounded = true
                }
            }
            if (!IsFounded) {
                unreadIds.push(messagesId[i])
            }
            IsFounded = false;
        }

        
        let values = unreadIds.map(messId => `(${chatId},${req.userId},${messId})`);
       
        const query = `INSERT INTO messageReaders(chatId,userId,messageId) VALUES${values}`
        await pool.query(query);
        
        
        return res.json({message:"messages read succesfuly"});
    } catch (error) {
        next(error);
    }
});



app.post('/refresh',validateRefreshToken, async (req,res,next) => {
    const tokens = await generateTokens({id:req.userId,username:req.decoded.username,email:req.decoded.email});
    res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        sameSite: 'Strict',
        secure: false, 
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });   
    return res.status(200).json({token:tokens.acsesstoken});
});

app.post('/logout',validateToken,(req,res,next) => {
    try {
        res.clearCookie("refreshToken");
        return res.status(200).json({message:"logout succesfully"});
    } catch (error) {
        next(error);
    }
});

app.use(errorHandling);





const userArr = [];
io.on('connection', (socket) => {
    // console.log('A user connected');
    
    socket.on("join user",(userId) => {
        socket.join(`user_${userId}`);
        
        console.log(`user_${userId}`);
        
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

   socket.on('userTyping', (userObj) => {
        console.log(userObj);
        
        // Check if user is already in the array
        const existingUserIndex = userArr.findIndex(u => 
            u.id === userObj.id && u.chatId === userObj.chatId
        );
        
        if (existingUserIndex === -1) {
            userArr.push(userObj);
        }
        console.log("skizb");
        
        const typingUsers = userArr.filter((obj) => obj.chatId === userObj.chatId);
        io.to(userObj.chatId).emit('typing users', typingUsers, userObj.id);
    });

    socket.on('stopTyping', (userObj) => {
        // Remove the user from the array
        const index = userArr.findIndex(u => 
            u.id === userObj.id && u.chatId === userObj.chatId
        );
        
        if (index !== -1) {
            userArr.splice(index, 1);
        }

        const typingUsers = userArr.filter((obj) => obj.chatId === userObj.chatId);
        console.log("stop");
        
        io.to(userObj.chatId).emit('typing users', typingUsers, userObj.id);
    });

    socket.on('messageDeleted',(chatId,message) => {
        io.to(chatId).emit('messageDeleted',chatId,message);
    });

    socket.on('messageEdited',(chatId,message) => {
        io.to(chatId).emit('messageEdited',chatId,message);
    }); 

});


server.listen(3000);

module.exports = {io}
