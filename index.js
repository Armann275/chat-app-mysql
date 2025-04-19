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
    validateUsers,getChatParticipants,messageResponse} = require('./queryFunctions/query');
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

app.post('/registration',async (req,res,next) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email  || !password) {
            return res.status(400).json({message:"give all params"});
        }

        
        const hashpassword = await bcrypt.hash(password, 10); 
        query = "INSERT INTO USERS(USERNAME,EMAIL,PASSWORD)VALUES(?,?,?)" 

        const insertInfo = await pool.query(query,[username,email,hashpassword]);
        
        
        query = "SELECT id,username,email FROM USERS WHERE ID=?"

        const [insertedValue] = await pool.query(query,[insertInfo.insertId])
        return res.status(200).json({user:insertedValue[0]})
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: "Email already exists" });
        }
        next(error)
    }
});


app.post('/login',async (req,res,next) => {
    try {
        const {email,password} = req.body;
    if (!email || !password) {
        return res.status(400).json({message:"give all params"})
    }

    let query = 'SELECT * FROM USERS WHERE EMAIL=?'
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


app.post('/createPrivateChat/:userId', validateToken, async (req, res, next) => {
    try {
        const targetUserId = Number(req.params.userId);
        if (targetUserId === req.userId) {
            return res.status(409).json({ message: "You can't create a chat with yourself" });
        }
       
        
        let query = "SELECT * FROM USERS WHERE ID=?";
        const [targetUser] = await pool.query(query, [targetUserId]);
        
        if (targetUser.length === 0) {
            return res.status(404).json({ message: `User with ID: ${targetUserId} doesn't exist` });
        }
        
        query = `
            SELECT chat_id 
            FROM chat_participants 
            WHERE user_id IN (?, ?) 
            AND isGroup = false
            GROUP BY chat_id 
            HAVING COUNT(DISTINCT user_id) = 2;
        `;

        const [existingChat] = await pool.query(query, [targetUserId, req.userId]);
        
        
        
        
        if (!existingChat[0]) {
            query = `INSERT INTO CHATS(isGroup)VALUES(?)`
            const [newChat] = await pool.query(query,[false]);
            query =  `INSERT INTO chat_participants(user_id,chat_id)VALUES(?,?)`
            await pool.query(query,[req.userId,newChat.insertId]);
            await pool.query(query,[targetUserId,newChat.insertId]);
            
            const getNewChat = await getPrivateChat(newChat.insertId)
            query = `SELECT user_id as id,chat_id,username,email FROM chat_participants INNER JOIN USERS ON USERS.ID = chat_participants.USER_ID
            WHERE CHAT_ID=?`;
            const [getNewChatParticipants] = await pool.query(query,[newChat.insertId]);
            console.log("dsd");
            
            return res.status(200).json({chat:getNewChat,chatParticipants:getNewChatParticipants})
        }

        const getChat = await getPrivateChat(existingChat[0].chat_id);
        query = `SELECT user_id as id,chat_id,username,email FROM chat_participants INNER JOIN USERS ON USERS.ID = chat_participants.USER_ID
        WHERE CHAT_ID=?`;
        const [getChatParticipants] = await pool.query(query,[existingChat[0].chat_id]);
        return res.status(200).json({chat:getChat,chatParticipants:getChatParticipants})
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error.message });
    }
});



app.post('/createGroup',validateToken, async (req,res,next) => {
    try {
        const {chatName,usersArr} = req.body;
        await validateUsers(usersArr)
                
        query = `INSERT INTO chats(isGroup,groupName,groupAdmin)VALUES (?,?,?)`
        const [newChat] = await pool.query(query,[true,chatName,req.userId]);

        const values = usersArr.map(userId => `(${userId},${newChat.insertId},"member",${true})`).join(',');
        query = `INSERT INTO CHAT_PARTICIPANTS(USER_ID,CHAT_ID,ROLE,isGroup) VALUES${values}`

        const [insertedChatParticipants] = await pool.query(query);
        query = `INSERT INTO CHAT_PARTICIPANTS(USER_ID,CHAT_ID,ROLE,isGroup) VALUES(?,?,?,?)`

        const [insertAdmin] = await pool.query(query,[req.userId,newChat.insertId,"admin",true]);

        query = `SELECT * FROM CHATS WHERE ID=?`
        const [getChat] = await pool.query(query,[newChat.insertId]);
        console.log(getChat);
        
        const getChatParticipant = await getChatParticipants(newChat.insertId);
        
        return res.status(200).json({chat:getChat[0],chatParticipants:getChatParticipant,currentUserId:req.userId});
    } catch (error) {
        next(error)
    }
});


app.post("/sendMessage/:chatId",validateToken,async (req,res,next) => {
    try {
        const chatId = +req.params.chatId;
        const {message} = req.body;
        
        await validateUserInChat(req.userId,chatId);

        query = `INSERT INTO MESSAGES(sender_id,message,chatId)VALUES(?,?,?)`;
        
        const [newChatMessage] = await pool.query(query,[req.userId,message,chatId]);
        query = `UPDATE chats SET lastMessage=? where id=?`;
        const [updateLatestMessage] = await pool.query(query,[newChatMessage.insertId,chatId])
        
        
        query = `SELECT messages.id as id,message,chatId,sender_id,username,email,messages.created_at,messages.updated_at
          FROM  MESSAGES INNER JOIN USERS ON USERS.ID=MESSAGES.SENDER_ID WHERE MESSAGES.ID=?`
        const [getChatMessage] = await pool.query(query,[newChatMessage.insertId]);
        
        const responseMessage = messageResponse(getChatMessage[0]);

        const response = {
            message:responseMessage   
        }
        return res.status(200).json(response)
    } catch (error) {
        next(error)
    }
});

app.get('/searchUsers',validateToken,async (req,res) => {
    try {
    const search = req.query.q || '';
    console.log(search);
    
    
    let query = `select id,username,email from users
        where username LIKE ?
        and  id != ? limit ? 
    `;

    const [getUsers] = await pool.query(query,[`${search}%`,req.userId,5]);
    return res.status(200).json({users:getUsers});
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});


app.get("/getMessages/:chatId",validateToken,async (req,res,next) => {
    try {
        
        
        const chatId = +req.params.chatId;
        
        await validateUserInChat(req.userId,chatId)
        
        query = `select messages.id as id,sender_id,message,chatId, username ,email, messages.created_at,messages.updated_at from messages inner join users on users.id = messages.sender_id
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

        
        query =  `SELECT user_id,chat_id,role,isGroup,username,email,created_at,updated_at FROM chat_participants INNER JOIN USERS ON USERS.ID = chat_participants.user_id
        WHERE chat_participants.CHAT_ID IN(${placeholders})`;
        
        
        const [chatParticipants] = await pool.query(query,chatIdArr);
        
        query = `SELECT 
    chats.id, 
    chats.isGroup, 
    chats.groupName, 
    chats.groupAdmin, 
    chats.created_at, 
    chats.updated_at, 
    JSON_OBJECT(
        'id', messages.id,
        'sender_id', messages.sender_id,
        'message', messages.message,
        'chatId', messages.chatId,
        'sender', JSON_OBJECT(
            'id', users.id,
            'username', users.username,
            'email', users.email
        )
    ) AS lastMessage
FROM chats 
LEFT JOIN messages ON messages.id = chats.lastMessage 
LEFT JOIN users ON users.id = messages.sender_id
WHERE chats.id IN (${placeholders})`
        
        const [getAllChats] = await pool.query(query,chatIdArr);
        return res.status(200).json({chats:getAllChats,chatParticipants:chatParticipants,currentUserId:req.userId});
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});



app.post("/groupAdd",validateToken,async (req,res,next) => {
    try {
        const {chatId,usersArr} = req.body;
        await validateUsers(usersArr);
        
        await checkUsersIsNotInChat(chatId,usersArr);
        
        const chatQuery = `SELECT * FROM CHATS WHERE ID=? AND isGroup=?`;
        
        const [chat] = await pool.query(chatQuery,[chatId,true]);
        
        if (!chat[0]) {
            throw new ApiError(`there is no group chat with this id:${chatId}`,404);
        }
        return res.json({});
    } catch (error) {
        next(error);
    }
});

app.use(errorHandling);


io.on('connection', (socket) => {
    console.log('A user connected');
    
    socket.on("join chat",(chatId) => {
        socket.join(chatId);
        console.log("joined chat");
        
    });

    socket.on("sendMessage",(chatId,message) => {
        io.to(chatId).emit("receiveMessage",message);
        console.log("new message");
        
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected');
    });
});


server.listen(3000);
module.exports = {pool}