const {pool} = require('../connectDb/db');
const {ApiError} = require('../exeptions/api-error');
async function getPrivateChat(chatId) {
    const [chat] = await pool.query(`SELECT  CHATS.id as id,isGroup,
                    CHATS.created_at as CHATS_created_at, CHATS.updated_at as CHATS_updated_at , messages.id as message_id, sender_id,message,messages.created_at as message_created_at,
                    messages.updated_at as messages_updated_at, users.id as user_id, username,email
                    FROM CHATS 
                    LEFT JOIN messages ON CHATS.lastMessage = messages.id
                    LEFT JOIN users ON users.id = sender_id
                    WHERE CHATS.ID = ?`,[chatId]);
                    
    return {
        id:chat[0].id,
        isGroup:chat[0].isGroup,
        created_at:chat[0].CHATS_created_at,
        updated_at:chat[0].CHATS_updated_at,
        lastMessage:{
            id:chat[0].message_id,
            message:chat[0].message,
            created_at:chat[0].message_created_at,
            updated_at:chat[0].messages_updated_at,
            sender:{
                id:chat[0].sender_id,
                username:chat[0].username,
                email:chat[0].email
            }
        }
    }
   
}



async function validateUserInChat(userId,chatId){
        let query = `SELECT * FROM CHATS WHERE ID=?`
        const [checkChatExists] = await pool.query(query,[chatId]);
        if (!checkChatExists[0]) {
            throw new ApiError("Chat with this ID doesn't exist", 404);
        }
        
        query = `SELECT * FROM chat_participants WHERE CHAT_ID=? AND USER_ID=?`
        const [isUserChatParticipant] = await pool.query(query,[chatId,userId]);
        if (!isUserChatParticipant[0]) {
            throw new ApiError("You are not a participant of this chat", 403);
        }
}

async function validateUsers(usersArr) {
        const placeholders = usersArr.map(() => '?').join(',');
        let query =  `SELECT ID as id FROM USERS WHERE ID in (${placeholders})`
        const [users] = await pool.query(query,usersArr);

        const notFondedIds = findMissingIds(usersArr,users,false);
        
        if (notFondedIds.length !== 0) {
            throw new ApiError(`users with following ids doesnt exits ${notFondedIds.join()}`,404)
        }
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


function messageResponse(messageObj) {
    const response = {
        message:{
            id:messageObj.id,
            message:messageObj.message,
            chatId:messageObj.chatId,
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


async function getChatParticipants(chatId) {
    const query = `
            SELECT user_id as id,username,created_at,updated_at,role
            FROM chat_participants
            INNER JOIN USERS ON USERS.ID = chat_participants.user_id
            WHERE chat_id=?`;

    const [getChatParticipants] = await pool.query(query,[chatId]);
    return getChatParticipants       
}

module.exports = {getPrivateChat,
    validateUserInChat,
    validateUsers,messageResponse,getChatParticipants,checkUsersIsNotInChat}