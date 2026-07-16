require('dotenv').config();
const { Telegraf } = require('telegraf');
const firebase = require('firebase/app');
require('firebase/database');
const express = require('express');
const cors = require('cors');
const path = require('path');

// ===== FIREBASE INIT =====
const firebaseConfig = {
    databaseURL: process.env.FIREBASE_URL,
    apiKey: process.env.FIREBASE_KEY || 'dummy'
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== BOT INIT =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);
const CHANNEL_ID = process.env.CHANNEL_ID || '@FireByWorld';

// ===== EXPRESS SERVER =====
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== DATABASE HELPERS =====
function getData(path) {
    return new Promise((resolve, reject) => {
        db.ref(path).once('value', snap => resolve(snap.val()), reject);
    });
}
function setData(path, data) {
    return db.ref(path).set(data);
}
function updateData(path, data) {
    return db.ref(path).update(data);
}
function pushData(path, data) {
    return db.ref(path).push(data);
}
function deleteData(path) {
    return db.ref(path).remove();
}

// ===== KEY GENERATION =====
function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    return key;
}

// ===== CHECK CHANNEL JOIN =====
async function isUserJoined(ctx) {
    try {
        const chatMember = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
        return ['member', 'creator', 'administrator'].includes(chatMember.status);
    } catch (e) { return true; }
}

// ===== MIDDLEWARE =====
bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    const userId = ctx.from.id;
    const userRef = `users/${userId}`;
    const userData = await getData(userRef);
    if (!userData) {
        await setData(userRef, {
            id: userId,
            username: ctx.from.username || '',
            firstName: ctx.from.first_name || '',
            joined: Date.now(),
            keys: {},
            referrals: 0,
            referCode: generateKey(),
            referredBy: null
        });
    }
    return next();
});

// ===== IS ADMIN =====
function isAdmin(ctx) {
    return ADMIN_IDS.includes(ctx.from.id);
}

// ===== START COMMAND =====
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userData = await getData(`users/${userId}`);
    
    const refCode = ctx.startPayload;
    if (refCode && !userData.referredBy) {
        const users = await getData('users');
        for (const [id, data] of Object.entries(users || {})) {
            if (data.referCode === refCode && id != userId) {
                await updateData(`users/${id}`, {
                    referrals: (data.referrals || 0) + 1
                });
                await updateData(`users/${userId}`, { referredBy: id });
                await ctx.telegram.sendMessage(id, `🎉 New referral! ${ctx.from.first_name} joined!`);
                break;
            }
        }
    }
    
    await ctx.reply(
        `🌟 *NXT Key Bot*\n\n` +
        `Get premium keys for exclusive content.\n` +
        `Refer friends and earn rewards!\n\n` +
        `📌 *Channel:* ${CHANNEL_ID}\n` +
        `🔑 *Your Code:* \`${userData.referCode}\`\n` +
        `👥 *Referrals:* ${userData.referrals || 0}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔑 My Keys', callback_data: 'my_keys' }],
                    [{ text: '👥 Refer & Earn', callback_data: 'refer' }],
                    [{ text: '📢 Channel', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }],
                    [{ text: '💎 Get Key', callback_data: 'get_key' }]
                ]
            }
        }
    );
});

// ===== MY KEYS =====
bot.action('my_keys', async (ctx) => {
    const userId = ctx.from.id;
    const userData = await getData(`users/${userId}`);
    const keys = userData?.keys || {};
    const keyList = Object.values(keys);
    
    if (!keyList.length) {
        return ctx.reply('🔑 *No keys yet!*\n\nJoin channel or click "Get Key"', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 Get Key', callback_data: 'get_key' }],
                    [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }]
                ]
            }
        });
    }
    
    let msg = '🔑 *Your Keys:*\n\n';
    keyList.forEach((k, i) => {
        const status = k.used ? '❌ Used' : '✅ Active';
        const expiry = k.expiry ? ` (${new Date(k.expiry).toLocaleDateString()})` : '';
        msg += `${i+1}. \`${k.key}\` - ${status}${expiry}\n`;
    });
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ===== GET KEY =====
bot.action('get_key', async (ctx) => {
    const userId = ctx.from.id;
    
    const joined = await isUserJoined(ctx);
    if (!joined) {
        return ctx.reply(`⚠️ *Join channel first!*\n\nYou need to be a member.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }],
                    [{ text: '✅ Check Again', callback_data: 'check_join' }]
                ]
            }
        });
    }
    
    const userData = await getData(`users/${userId}`);
    const keys = userData?.keys || {};
    const hasActiveKey = Object.values(keys).some(k => !k.used && k.expiry > Date.now());
    if (hasActiveKey) {
        return ctx.reply('✅ *You already have an active key!*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔑 My Keys', callback_data: 'my_keys' }]
                ]
            }
        });
    }
    
    const key = generateKey();
    const expiry = Date.now() + 48 * 60 * 60 * 1000;
    
    await pushData('keys', {
        key: key,
        userId: userId,
        createdAt: Date.now(),
        expiry: expiry,
        used: false,
        type: 'free'
    });
    
    await updateData(`users/${userId}/keys/${key}`, {
        key: key,
        used: false,
        expiry: expiry
    });
    
    await ctx.reply(`✅ *Key Generated!*\n\n🔑 \`${key}\`\n⏳ *Expires:* ${new Date(expiry).toLocaleString()}`,
        { parse_mode: 'Markdown' }
    );
});

// ===== CHECK JOIN =====
bot.action('check_join', async (ctx) => {
    const joined = await isUserJoined(ctx);
    if (joined) {
        await ctx.reply('✅ You\'re a member! Click "Get Key" now.');
        ctx.answerCbQuery('✅ Verified!');
    } else {
        await ctx.reply('❌ Not joined yet.');
        ctx.answerCbQuery('❌ Not joined');
    }
});

// ===== REFER =====
bot.action('refer', async (ctx) => {
    const userId = ctx.from.id;
    const userData = await getData(`users/${userId}`);
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${userData.referCode}`;
    
    await ctx.reply(`👥 *Refer & Earn*\n\nShare your referral link:\n\`${refLink}\`\n\n✅ Each referral gives you +4 hours!\n📊 Total: ${userData.referrals || 0}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📤 Share', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}` }],
                    [{ text: '🔑 My Keys', callback_data: 'my_keys' }]
                ]
            }
        }
    );
});

// ===== ADMIN COMMANDS =====
bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Unauthorized');
    
    const stats = {
        users: await getData('users'),
        keys: await getData('keys')
    };
    const userCount = stats.users ? Object.keys(stats.users).length : 0;
    const keyCount = stats.keys ? Object.keys(stats.keys).length : 0;
    
    await ctx.reply(`🛠️ *Admin Panel*\n\n📊 Stats:\n👥 Users: ${userCount}\n🔑 Keys: ${keyCount}\n\n📌 Channel: ${CHANNEL_ID}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📱 Open Admin Panel', webApp: { url: `${process.env.WEBHOOK_URL}/admin` } }],
                    [{ text: '📢 Announce', callback_data: 'admin_announce' }],
                    [{ text: '🎁 Free 48H Keys', callback_data: 'admin_free_keys' }]
                ]
            }
        }
    );
});

// ===== ADMIN: ANNOUNCE =====
bot.action('admin_announce', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Unauthorized');
    await ctx.reply('📢 Type your announcement message:');
    
    const waitForMsg = async (msg) => {
        if (msg.text) {
            await ctx.telegram.sendMessage(CHANNEL_ID, `📢 ${msg.text}`);
            await ctx.reply('✅ Announcement sent!');
            bot.off('message', waitForMsg);
        }
    };
    bot.on('message', waitForMsg);
});

// ===== ADMIN: FREE 48H KEYS =====
bot.action('admin_free_keys', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Unauthorized');
    
    const users = await getData('users');
    if (!users) return ctx.reply('No users found');
    
    let count = 0;
    for (const [id, data] of Object.entries(users)) {
        const key = generateKey();
        const expiry = Date.now() + 48 * 60 * 60 * 1000;
        await pushData('keys', {
            key: key,
            userId: id,
            createdAt: Date.now(),
            expiry: expiry,
            used: false,
            type: 'free'
        });
        await updateData(`users/${id}/keys/${key}`, {
            key: key,
            used: false,
            expiry: expiry
        });
        count++;
        await ctx.telegram.sendMessage(id, `🎉 *Free 48H Key!*\n\n🔑 \`${key}\``,
            { parse_mode: 'Markdown' }
        );
    }
    await ctx.reply(`✅ Sent 48H keys to ${count} users!`);
});

// ===== WEB APP ROUTES =====
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/configs', async (req, res) => {
    try {
        const configs = await getData('configs') || {};
        res.json(configs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/configs', async (req, res) => {
    try {
        const { url, key } = req.body;
        const configs = await getData('configs') || {};
        
        let firebaseUrl = url;
        if (url.includes('firebaseio.com')) {
            firebaseUrl = url;
        } else {
            const match = url.match(/https?:\/\/[^\/]+\.firebaseio\.com/);
            if (match) firebaseUrl = match[0];
        }
        
        if (!firebaseUrl.includes('firebaseio.com')) {
            return res.status(400).json({ error: 'Invalid Firebase URL' });
        }
        
        const id = Date.now().toString(36);
        configs[id] = { url: firebaseUrl, key: key || '', added: Date.now() };
        await setData('configs', configs);
        res.json({ success: true, id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/configs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const configs = await getData('configs') || {};
        delete configs[id];
        await setData('configs', configs);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/configs/active', async (req, res) => {
    try {
        const { id } = req.body;
        const configs = await getData('configs') || {};
        if (!configs[id]) return res.status(404).json({ error: 'Config not found' });
        
        await updateData('configs', { activeDb: id, activeUrl: configs[id].url });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const users = await getData('users') || {};
        const keys = await getData('keys') || {};
        res.json({
            users: Object.keys(users).length,
            keys: Object.keys(keys).length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await getData('users') || {};
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/freekeys', async (req, res) => {
    try {
        const users = await getData('users') || {};
        let count = 0;
        for (const [id, data] of Object.entries(users)) {
            const key = generateKey();
            const expiry = Date.now() + 48 * 60 * 60 * 1000;
            await pushData('keys', {
                key: key,
                userId: id,
                createdAt: Date.now(),
                expiry: expiry,
                used: false,
                type: 'free'
            });
            await updateData(`users/${id}/keys/${key}`, {
                key: key,
                used: false,
                expiry: expiry
            });
            count++;
            await bot.telegram.sendMessage(id, `🎉 *Free 48H Key!*\n\n🔑 \`${key}\``,
                { parse_mode: 'Markdown' }
            );
        }
        res.json({ success: true, count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/announce', async (req, res) => {
    try {
        const { message } = req.body;
        await bot.telegram.sendMessage(CHANNEL_ID, `📢 ${message}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { channel } = req.body;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

// Webhook
const WEBHOOK_URL = process.env.WEBHOOK_URL || `https://your-app.railway.app/webhook`;
bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`).then(() => {
    console.log('✅ Webhook set');
}).catch(console.error);

bot.startWebhook('/webhook', null, PORT);
console.log('🚀 NXT Key Bot is running!');
