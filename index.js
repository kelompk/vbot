const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const cron = require('node-cron');

// ---------------- CONFIG ----------------
const TARGET_GROUP_NAME = "Interactive computing 200lvl";

let botActive = true;       // manual pause/resume
let groupAdmins = [];       // filled dynamically
//-----------------------------------------

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    // ---------------- Helper ----------------
    function formatToday() {
        const classes = {
            1: [
                { course: "WSU-CSC 205", time: "8am-10am", program: "Computer Science" },
                { course: "MTH 201", time: "1pm-3pm", program: "Computer Science & Software Engineering" }
            ],
            2: [
                { course: "WSU-IFT 203", time: "8am-10am", program: "Computer Science & Software Engineering" },
                { course: "COS 201", time: "1pm-3pm", program: "Computer Science, Software Engineering & Cyber Security" }
            ],
            3: [
                { course: "CSC 203", time: "8am-10am", program: "Computer Science & Software Engineering" },
                { course: "MTH 201", time: "10am-12pm", program: "Computer Science & Software Engineering" },
                { course: "ENT 211", time: "3pm-5pm", program: "Computer Science, Software Engineering & Cyber Security" }
            ],
            4: [
                { course: "WSU CSC 201", time: "10am-12pm", program: "Computer Science & Software Engineering & Cyber Security" },
                { course: "SEN 201", time: "1pm-3pm", program: "Computer Science, Software Engineering & Cyber Security" }
            ],
            5: [
                { course: "MTH 201", time: "8am-10am", program: "Computer Science & Software Engineering" },
                { course: "IFT 211", time: "10am-12pm", program: "Computer Science & Software Engineering" }
            ]
        };

        const day = new Date().getDay();
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
    cron.schedule("0 6 * * 1-5", async () => {
        await sendToTargetGroup(formatToday());
        console.log("✅ Sent daily timetable (if active)");
    });

    // ---------------- Connection Update ----------------
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                startBot(); // reconnect
            }
        } else if (connection === 'open') {
            console.log("✅ Bot connected");
            await fetchGroupAdmins();
        }
    });

    // ---------------- Commands ----------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid.endsWith('@g.us')) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const sender = msg.key.participant || msg.key.remoteJid;

        // Admin-only
        if (groupAdmins.includes(sender)) {
            if (text === ".pause") {
                botActive = false;
                await sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot paused." });
                return;
            }
            if (text === ".resume") {
                botActive = true;
                await sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot resumed." });
                return;
            }
            if (text.startsWith(".tagall")) {
                const allChats = await sock.groupFetchAllParticipating();
                const groups = Object.values(allChats).filter(c => c.id.endsWith('@g.us'));
                const targetGroup = groups.find(g => g.subject === TARGET_GROUP_NAME);
                if (!targetGroup) return;
                const mentions = targetGroup.participants.map(p => p.id);
                const participantText = mentions.map(id => `@${id.split('@')[0]}`).join(' ');
                await sock.sendMessage(targetGroup.id, { text: participantText, mentions });
            }
        }
    });
}

// ---------------- Start the bot ----------------
startBot().catch(err => console.log("Error starting bot:", err));
