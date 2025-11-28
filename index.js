const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const cron = require('node-cron');
const express = require('express');

// ---------------- CONFIG ----------------
const TARGET_GROUP_NAME = "Interactive computing 200lvl";
let botActive = true;       // manual pause/resume
let groupAdmins = [];       // will be filled dynamically

//-----------------------------------------

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    // ---------------- Classes ----------------
    const classes = {
        1: [ // Monday
            { course: "WSU-CSC 205", time: "8am-10am", program: "Computer Science" },
            { course: "MTH 201", time: "1pm-3pm", program: "Computer Science & Software Engineering" }
        ],
        2: [ // Tuesday
            { course: "WSU-IFT 203", time: "8am-10am", program: "Computer Science & Software Engineering" },
            { course: "COS 201", time: "1pm-3pm", program: "Computer Science, Software Engineering & Cyber Security" }
        ],
        3: [ // Wednesday
            { course: "CSC 203", time: "8am-10am", program: "Computer Science & Software Engineering" },
            { course: "MTH 201", time: "10am-12pm", program: "Computer Science & Software Engineering" },
            { course: "ENT 211", time: "3pm-5pm", program: "Computer Science, Software Engineering & Cyber Security" }
        ],
        4: [ // Thursday
            { course: "WSU CSC 201", time: "10am-12pm", program: "Computer Science & Software Engineering & Cyber Security" },
            { course: "SEN 201", time: "1pm-3pm", program: "Computer Science, Software Engineering & Cyber Security" }
        ],
        5: [ // Friday
            { course: "MTH 201", time: "8am-10am", program: "Computer Science & Software Engineering" },
            { course: "IFT 211", time: "10am-12pm", program: "Computer Science & Software Engineering" }
        ]
    };

    function formatToday() {
        const now = new Date();
        const day = now.getDay();
        if (!classes[day]) return "No classes today.";
        return classes[day].map(c => `${c.program} - ${c.course} (${c.time})`).join("\n");
    }

    async function sendToTargetGroup(message) {
        if (!botActive) return;
        const allChats = await sock.groupFetchAllParticipating();
        const groups = Object.values(allChats).filter(c => c.id.endsWith('@g.us'));
        const targetGroup = groups.find(g => g.subject === TARGET_GROUP_NAME);
        if (!targetGroup) return console.log("Group not found.");
        await sock.sendMessage(targetGroup.id, { text: message });
    }

    async function fetchGroupAdmins() {
        const allChats = await sock.groupFetchAllParticipating();
        const groups = Object.values(allChats).filter(c => c.id.endsWith('@g.us'));
        const targetGroup = groups.find(g => g.subject === TARGET_GROUP_NAME);
        if (!targetGroup) return;
        groupAdmins = targetGroup.participants
            .filter(p => p.admin === "admin" || p.admin === "superadmin")
            .map(p => p.id);
        console.log("✅ Admins detected:", groupAdmins);
    }

    // ---------------- Cron Job: Daily 6AM Reminder ----------------
    cron.schedule("0 5 * * 1-5", async () => {
        await sendToTargetGroup(`📌 Daily Classes:\n\n${formatToday()}`);
        console.log("✅ Sent daily timetable to group");
    });

    // ---------------- Connection Update ----------------
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log("✅ Bot connected");
            await fetchGroupAdmins();
        }
    });

    // ---------------- Admin Commands ----------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid.endsWith('@g.us')) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const sender = msg.key.participant || msg.key.remoteJid;

        if (!groupAdmins.includes(sender)) return; // ignore non-admins

        // ---- Pause / Resume ----
        if (text === ".pause") {
            botActive = false;
            await sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot has been paused." });
            return;
        }
        if (text === ".resume") {
            botActive = true;
            await sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot has resumed." });
            return;
        }

        // ---- Tag all ----
        if (text.startsWith(".tagall")) {
            const allChats = await sock.groupFetchAllParticipating();
            const groups = Object.values(allChats).filter(c => c.id.endsWith('@g.us'));
            const targetGroup = groups.find(g => g.subject === TARGET_GROUP_NAME);
            if (!targetGroup) return;
            const participants = targetGroup.participants.map(p => `@${p.id.split('@')[0]}`).join(' ');
            await sock.sendMessage(targetGroup.id, { text: participants, mentions: targetGroup.participants.map(p => p.id) });
        }
    });
}

// ---------------- Start Bot ----------------
startBot().catch(err => console.log("Error starting bot:", err));

// ---------------- HTTP Server for Render ----------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));
