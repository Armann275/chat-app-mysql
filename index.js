const express = require('express');
const app = express();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {validateToken} = require('./validate/validate');
app.use(express.json());
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'chat_app',
    password:"Armkvas275"
});

app.post('/registration',async (req,res,next) => {
    try {
    const {username,email,password} = req.body;
    if (!username || !email  || !password) {
        return res.status(400).json({message:"give all params"});
    }
    let query = 'SELECT * FROM USERS WHERE EMAIL=?'
    const [rows] = await pool.query(query,[email]);
    if (rows.length > 0) {
        return res.status(409).json({message:"we already have such a email"})
    }
    const hashpassword = await bcrypt.hash(password,10);
    query = "INSERT INTO USERS(USERNAME,EMAIL,PASSWORD)VALUES(?,?,?)"
    const [insertInfo] = await pool.query(query,[username,email,hashpassword]);
    query = "SELECT id,username,email FROM USERS WHERE ID=?"
    const [insertedValue] = await pool.query(query,[insertInfo.insertId])
    return res.status(200).json({user:insertedValue[0]})
    } catch (error) {
        return res.status(500).json({message:"server error",error:error})
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
        console.log(targetUser);
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
        console.log(existingChat);
        
        
        
        if (!existingChat[0]) {
            query = `INSERT INTO CHATS(isGroup)VALUES(?)`
            const [newChat] = await pool.query(query,[false]);
            query =  `INSERT INTO chat_participants(user_id,chat_id)VALUES(?,?)`
            await pool.query(query,[req.userId,newChat.insertId]);
            await pool.query(query,[targetUserId,newChat.insertId]);
            query = `SELECT * FROM CHATS WHERE ID=?`;
            const [getNewChat] = await pool.query(query,[newChat.insertId]);
            query = `SELECT * FROM chat_participants INNER JOIN USERS ON USERS.ID = chat_participants.USER_ID
            WHERE CHAT_ID=?`;
            const [getNewChatParticipants] = await pool.query(query,[newChat.insertId]);
            return res.status(200).json({chat:getNewChat[0],chatParticipants:getNewChatParticipants})
        }
        query = `SELECT * FROM CHATS WHERE ID=?`;
        const [getChat] = await pool.query(query,[existingChat[0].chat_id]);
        query = `SELECT * FROM chat_participants INNER JOIN USERS ON USERS.ID = chat_participants.USER_ID
        WHERE CHAT_ID=?`;
        const [getChatParticipants] = await pool.query(query,[existingChat[0].chat_id]);
        return res.status(200).json({chat:getChat[0],chatParticipants:getChatParticipants})
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});



app.post('/createGroup',validateToken, async (req,res,next) => {
    try {
        const {chatName,usersArr} = req.body;
        const placeholders = usersArr.map(() => '?').join(',');
        
        let query =  `SELECT ID,USERNAME,EMAIL FROM USERS WHERE ID in (${placeholders})`
        const [users] = await pool.query(query,usersArr);
        if (users.length !== usersArr.length) {
            return res.status(404).json({message:"one of this users doest exists"});
        }

        query = `INSERT INTO chats(isGroup,groupName,groupAdmin)VALUES (?,?,?)`
        const [newChat] = await pool.query(query,[true,chatName,req.userId]);
        const values = usersArr.map(userId => `(${userId},${newChat.insertId},"member",${true})`).join(',');
        query = `INSERT INTO CHAT_PARTICIPANTS(USER_ID,CHAT_ID,ROLE,isGroup) VALUES${values}`
        const [insertedChatParticipants] = await pool.query(query);
        query = `INSERT INTO CHAT_PARTICIPANTS(USER_ID,CHAT_ID,ROLE,isGroup) VALUES(?,?,?,?)`
        const [insertAdmin] = await pool.query(query,[req.userId,newChat.insertId,"admin",true]);
        query = `SELECT * FROM CHATS WHERE ID=?`
        const [getChat] = await pool.query(query,[newChat.insertId]);
        
        
        query = `SELECT * FROM chat_participants INNER JOIN  USERS ON USERS.ID = chat_participants.user_id
        WHERE chat_id=?`
        console.log(newChat.insertId);
        const [getChatParticipants] = await pool.query(query,[newChat.insertId])
        return res.status(200).json({chat:getChat,chatParticipants:getChatParticipants});
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});


app.post("/sendMessage/:chatId",validateToken,async (req,res,next) => {
    try {
        const chatId = +req.params.chatId;
        const {message} = req.body
        let query = `SELECT * FROM CHATS WHERE ID=?`
        const [checkChatExists] = await pool.query(query,[chatId]);
        if (!checkChatExists[0]) {
            return res.status(404).json({message:"chat with this Id doesnt exists"});
        }
        query = `SELECT * FROM chat_participants WHERE CHAT_ID=?`
        const [isUserChatParticipant] = await pool.query(query,[chatId]);
        if (!isUserChatParticipant[0]) {
            return res.status(403).json({ message: "You are not a participant of this chat" });
        }
        query = `INSERT INTO MESSAGES(sender_id,message,chatId)VALUES(?,?,?)`;
        const [newChatMessage] = await pool.query(query,[req.userId,message,chatId]);
        query = `SELECT * FROM MESSAGES WHERE ID=?`
        const [getChatMessage] = await pool.query(query,[newChatMessage.insertId]);
        return res.status(200).json({message:getChatMessage[0]})
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});

app.post('/searchUsers',validateToken,async (req,res) => {
    try {
    const search = req.query.q || '';
    const page = +req.query.page;
    const limit = +req.query.limit;
    const offset = (page - 1) * limit;
    let query = `select id,username,email from users
        where username LIKE ?
        and  id != ? limit ? offset ?
    `;
    
    
    const [getUsers] = await pool.query(query,[`${search}%`,req.userId,limit,offset]);
    return res.status(200).json({users:getUsers});
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});


app.post("/getMessages/:chatId",validateToken,async (req,res,next) => {
    try {
        const chatId = +req.params.chatId;
        const page = +req.query.page;
        const limit = +req.query.limit;
        const offset = (page - 1) * limit;
        let query = `SELECT * FROM CHATS WHERE ID=?`
        const [checkChatExists] = await pool.query(query,[chatId]);
        if (!checkChatExists[0]) {
            return res.status(404).json({message:"chat with this Id doesnt exists"});
        }
        query = `SELECT * FROM chat_participants WHERE CHAT_ID=? AND USER_ID=?`
        const [isUserChatParticipant] = await pool.query(query,[chatId,req.userId]);
        if (!isUserChatParticipant[0]) {
            return res.status(403).json({ message: "You are not a participant of this chat" });
        }
        query = `select messages.id,sender_id,message,chatId,username,email,created_at,updated_at from messages inner join users on users.id = messages.sender_id
                    where sender_id = ?
                    and chatId = ? order by created_at
                     limit ? offset ?
        `
        const [getMessages] = await pool.query(query,[req.userId,chatId,limit,offset]);
        return res.status(200).json({messages:getMessages})
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error });
    }
});

app.listen(3000);

