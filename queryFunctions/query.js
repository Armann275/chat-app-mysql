const {pool} = require('../connectDb/db');
const {ApiError} = require('../exeptions/api-error');

// async function getPrivateChat(chatId) {
//     const [chat] = await pool.query(`SELECT  CHATS.id as id,isGroup,
//                     CHATS.created_at as CHATS_created_at, CHATS.updated_at as CHATS_updated_at , messages.id as message_id, sender_id,message,messages.created_at as message_created_at,
//                     messages.updated_at as messages_updated_at, users.id as user_id, username,email
//                     FROM CHATS 
//                     LEFT JOIN messages ON CHATS.lastMessage = messages.id
//                     LEFT JOIN users ON users.id = sender_id
//                     WHERE CHATS.ID = ?`,[chatId]);
                    
//     return {
//         id:chat[0].id,
//         isGroup:chat[0].isGroup,
//         created_at:chat[0].CHATS_created_at,
//         updated_at:chat[0].CHATS_updated_at,
//         lastMessage:{
//             id:chat[0].message_id,
//             message:chat[0].message,
//             created_at:chat[0].message_created_at,
//             updated_at:chat[0].messages_updated_at,
//             sender:{
//                 id:chat[0].sender_id,
//                 username:chat[0].username,
//                 email:chat[0].email
//             }
//         }
//     }
   
// }

function messageResponse(messageObj) {
    const response = {
        message:{
            id:messageObj.id,
            message:messageObj.message,
            chatId:messageObj.chatId,
            isSystem:messageObj.isSystem,
            sender:{
                senderId:messageObj.sender_id,
                username:messageObj.username,
                email:messageObj.email
            },
            created_at:messageObj.created_at,
            updated_at:messageObj.updated_at
        }   
    }
    return response.message
}

async function validateUserInChat(userId,chatId,isGroup){
        let query = `SELECT * FROM chats WHERE ID=?`
        const params = [chatId];
        if (isGroup) {
                query += ` AND isGroup = ?`;
                params.push(true);
        }
        const [checkChatExists] = await pool.query(query,params);
        if (!checkChatExists[0]) {
            throw new ApiError("Chat with this ID doesn't exist", 404);
        }
        
        // console.log(checkChatExists);
        
        
        const placeholders = userId.map(() => '?').join(',');
        // console.log(`placeholders: ${placeholders}`);
        
        query = `
            SELECT user_id as id,role 
            FROM chat_participants 
            WHERE chat_id = ? 
            AND user_id IN (${placeholders})
        `;
        // console.log(query);
        
        
        const [participants] = await pool.query(query, [chatId, ...userId]);
        // console.log(`participants:${participants}`);
        
        const arr = findMissingIds(userId,participants,false);
        // console.log(arr);
        
        if (arr.length !== 0) {
            throw new ApiError(`users with following ids doesnt exists in chat ${arr.join('')}`,404);
        }
        return {participants:participants}
}

async function validateUsers(usersArr) {
        const placeholders = usersArr.map(() => '?').join(',');
        let query =  `SELECT ID as id,username,email FROM users WHERE ID in (${placeholders})`
        const [users] = await pool.query(query,usersArr);
        
        
        const notFondedIds = findMissingIds(usersArr,users,false);
        
        if (notFondedIds.length !== 0) {
            throw new ApiError(`users with following ids doesnt exits ${notFondedIds.join()}`,404)
        }
        return users
}

function findMissingIds(usersArr, users,boolean) {
    const notFondedIds = [];
    let isFonded = false;
    for(let i = 0; i < usersArr.length; i++){
        for(let j = 0; j < users.length; j++){
            if (usersArr[i] === users[j].id) {
                isFonded = true
            }
        }
        if (Boolean(isFonded) === boolean) {
            notFondedIds.push(usersArr[i])
        }
        isFonded = false;
    }
    return notFondedIds
}

async function checkUsersIsNotInChat(chatId,usersArr,userId) {
    const participants = await getChatParticipants(chatId);

    const ids = findMissingIds(usersArr,participants,true);
    
    if (ids.length !== 0) {
        throw new ApiError(`users with following ids already exists in chat ${ids.join()}`,404)
    }
}





async function getChatParticipants(chatId) {
    const query = `
            SELECT user_id as id,username,created_at,updated_at,role,chat_id
            FROM chat_participants
            INNER JOIN users ON users.id = chat_participants.user_id
            WHERE chat_id=?`;

    const [getChatParticipants] = await pool.query(query,[chatId]);
    return getChatParticipants       
}


async function insertUsersToGroupChat(values) {
    const query = `INSERT INTO chat_participants(USER_ID,CHAT_ID,ROLE,isGroup) VALUES${values}`
    const [insertedChatParticipants] = await pool.query(query);
    return
}

async function getChat(chatId, isGroup) {
    let query = `SELECT * FROM chats WHERE ID = ?`;
    const params = [chatId];

    if (isGroup) {
        query += ` AND isGroup = ?`;
        params.push(true);
    }

    const [getChat] = await pool.query(query, params);
    return getChat;
}

async function searchUsers(search,chatId,userId) {
    let query = `select id,username,email from users
                where username LIKE ?

        `;
    let participantsId = [userId]
    let participants;
    if (chatId) {
        
        participants = await getChatParticipants(chatId);
        for(let el of participants){
            participantsId.push(el.id);
        }
        
    }
    const placeholders = participantsId.map(() => '?').join(',');
    
    query += `AND id NOT IN (${placeholders}) limit ? `
    const params = [
        `${search}%`,      
        ...participantsId,     
        5               
    ];
    const [results] = await pool.query(query, params);
    
    
    return results
}

async function getMessage(messageId,chatId,senderId){
    const params = [messageId];
    let query = `SELECT messages.id as id,message,chatId,sender_id,username,email,isSystem,messages.created_at,messages.updated_at
          FROM  messages INNER JOIN users ON users.id=messages.sender_id WHERE messages.id=?`
          if (chatId) {
                query += ' AND chatId=?'
                params.push(chatId)
          }
          
          if (senderId) {
                query += ' AND sender_id=?'
                params.push(senderId)
          }
    const [getChatMessage] = await pool.query(query,params);
    const responseMessage = messageResponse(getChatMessage[0]);
    return responseMessage;    
}

async function insertMessage(sender_id,message,chatId,boolean) {
    const newMessageQuery = `INSERT INTO messages (sender_id, message, chatId,isSystem)
                                        VALUES (?,?,?,?)`
    const [newMessage]  = await pool.query(newMessageQuery,[sender_id,message,chatId,boolean]);

    return newMessage.insertId
}

async function sendSystemMessage(message,userId,chatId) {
    const newMessageId = await insertMessage(userId,message,chatId,true);
    const getChatMessage = await getMessage(newMessageId);

    const updateChatQuery = `UPDATE chats 
                                SET lastMessage=? 
                                WHERE id=?`;

    await pool.query(updateChatQuery,[newMessageId,chatId]);
    return getChatMessage
};

async function findUserBySessionId(userId,sessionId) {
    const query =  `SELECT * FROM users WHERE ID=? AND sessionId=?`
    const [user] = await pool.query(query,[userId,sessionId]);
    // if (!user[0]) {
    //     throw new ApiError('Session invalidated',403)
    // }
    return user[0];
}

module.exports = {
    validateUserInChat,
    validateUsers,messageResponse,
    getChatParticipants,
    checkUsersIsNotInChat,
    insertUsersToGroupChat,getChat,
    searchUsers,getMessage,insertMessage,sendSystemMessage,findUserBySessionId}


