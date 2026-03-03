require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let bot
let reconnecting = false
let discordClient
let alreadyWalking = false
let survivalOnline = 0
let statusMessage = null
let updatingEmbed = false

// ================= VALID HUB RANKS =================
const HUB_RANKS = [
  "Super","Elite","Titan","Immortal","Hero","Legend","Invaded",
  "Trainee","Moderator","Senior Mod","Admin","Manager","Developer","Owner"
]

// ================= RULE KEYWORDS =================

// 2️⃣ Inappropriate Topics
const INAPPROPRIATE = [
  "have sex","sex with","porn","nsfw","onlyfans",
  "deepthroat","cum","nudes","send pics",
  "kill yourself as a joke","rape joke",
  "hitler was right","9/11 was funny"
]

// 3️⃣ Toxicity
const TOXICITY = [
  "fuck you",
  "fk you",
  "stfu",
  "you suck",
  "loser",
  "no life",
  "idiot",
  "retard",
  "shut up kid"
]

const TOXICITY_REGEX = [
  /\bf\s*u\b/i // matches f u as standalone
]

// 4️⃣ Suicide Encouragement
const SUICIDE = [
  "kys","kill yourself","go kill yourself",
  "slit your wrists","hang yourself",
  "hope you die","hope you get cancer",
  "hope your mom dies"
]

// 5️⃣ Threats
const THREATS = [
  "i will find you","i will kill you",
  "kill your family","watch your back",
  "i'll dox you","pull your ip",
  "i'll beat you up"
]

// 6️⃣ Faking Messages
const FAKE_STAFF_PATTERNS = [
  "has been banned",
  "has been permanently banned",
  "has been muted",
  "you have been banned",
  "staff announcement"
]

// 7️⃣ Derogatory Chat
const SLURS = [
  "nigger","faggot","tranny",
  "dirty jew","i hate gays",
  "i hate blacks","i hate jews",
  "cracker"
]

// 8️⃣ Inappropriate Links
// 8️⃣ Inappropriate Links (refined)
const LINK_REGEX = /(discord\.gg|https?:\/\/(?!.*invadedlands))/i

// 9️⃣ Solicitation
const SOLICITATION = [
  "selling account",
  "buying rank for",
  "paypal me",
  "cashapp me",
  "selling robux",
  "selling vbucks",
  "trading riot points"
]

// 10️⃣ Mass Messaging (basic detection)
// 10️⃣ Mass Messaging (PRIVATE message blast only)
const massMessageTracker = new Map()

// 11️⃣ Filter Bypass (regex based)
const BYPASS_REGEX = [
  /f\s*u\s*c\s*k/i,
  /k\s*y\s*s/i,
  /n\s*i\s*g\s*g/i,
  /s\s*l\s*u\s*r/i
]

// 12️⃣ Leaking Private Info
const PRIVATE_INFO_REGEX = [
  /\b\d{1,3}(\.\d{1,3}){3}\b/, // IP address
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN format
  /\b\d{5}\b/, // ZIP code pattern
  /instagram\.com\//i,
  /snapchat\.com\//i
]

// ================= RANK COLORS =================
function getRankColor(rank) {
  const colors = {
    Super: 0x55FF55,
    Elite: 0x5555FF,
    Hero: 0xFFAA00,
    Legend: 0x00AA00,
    Titan: 0xFF55FF,
    Immortal: 0x00AAAA,
    Invaded: 0xF1C40F,
    Trainee: 0xFFFF55,
    Moderator: 0x9B59B6,
    "Senior Mod": 0x6C3483,
    Admin: 0xFF5555,
    Manager: 0xC0392B,
    Developer: 0x00E5FF,
    Owner: 0x8B0000,
    Default: 0xAAAAAA
  }
  return colors[rank] || 0xF1C40F
}

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
    ]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)

  await initializeStatusMessage()
}

// ================= BOT =================
function startBot() {
  bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    auth: "microsoft",
    version: "1.20.1",
    profilesFolder: path.join(__dirname, "auth_cache"),
    skipValidation: true,
    disableChatSigning: true
  })

  bot.loadPlugin(pathfinder)

  bot.once("spawn", () => {
  setTimeout(() => walkToNPC(), 6000)

  // Start polling online count
  setInterval(() => {
    bot.chat("/online")
  }, 5000)
})

  bot.on("message", async (jsonMsg) => {
  const raw = jsonMsg.toString().trim()

  // ================= ONLINE COUNT DETECTION =================
  const onlineMatch = raw.match(/There is \((\d+)\/300\) players online\./)
  if (onlineMatch) {
    survivalOnline = parseInt(onlineMatch[1])
    await updateStatusEmbed()
    return
  }

  if (!raw.includes(":")) return

    const parsed = parseChat(raw)
    if (!parsed) return

    sendToDiscord(parsed)
    runModeration(parsed)
  })

  bot.on("end", () => {
    if (reconnecting) return
    reconnecting = true
    setTimeout(() => {
      reconnecting = false
      startBot()
    }, 5000)
  })
}

// ================= WALK =================
async function walkToNPC() {
  if (alreadyWalking) return
  alreadyWalking = true

  console.log("🚶 Walking to Survival NPC...")

  const mcData = require("minecraft-data")(bot.version)
  const defaultMove = new Movements(bot, mcData)
  bot.pathfinder.setMovements(defaultMove)

  const goal = new goals.GoalBlock(63, 94, 695)
  bot.pathfinder.setGoal(goal)

  bot.once("goal_reached", async () => {
    console.log("📍 Reached Survival NPC area")

    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e =>
      e.position &&
      bot.entity.position.distanceTo(e.position) < 5 &&
      (e.type === "mob" || e.type === "player")
    )

    if (!entity) {
      console.log("❌ NPC not found, retrying...")
      alreadyWalking = false
      return setTimeout(walkToNPC, 5000)
    }

    console.log("👀 Looking at NPC...")
    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)

    console.log("🖱 Clicking NPC...")
    bot.activateEntity(entity)

    console.log("✅ Clicked Survival NPC")
  })
}

// ================= CHAT PARSER =================
function parseChat(message) {
  const colon = message.indexOf(":")
  if (colon === -1) return null

  const before = message.slice(0, colon).trim()
  const chat = message.slice(colon + 1).trim()
  if (!chat) return null

  let detectedRank = "Default"
  let usernameSection = before

  if (before.includes("[")) {
    const match = before.match(/\[(.*?)\]/)
    if (match && match[1]) {
      const normalized = match[1].trim().replace(/-/g," ").toLowerCase()
      const found = HUB_RANKS.find(r => r.toLowerCase() === normalized)
      detectedRank = found || "Invaded"
    }
    usernameSection = before.split("]").pop().trim()
  }

  let username = usernameSection
    .replace(/§[0-9a-fk-or]/gi,"")
    .replace(/&[0-9a-fk-or]/gi,"")
    .trim()

  if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

  return {
    username,
    rank: detectedRank,
    message: chat.toLowerCase(),
    rawMessage: chat
  }
}

// ================= MODERATION =================
function runModeration(data) {
  const { message, rawMessage, username } = data
  let violations = []

  if (INAPPROPRIATE.some(w => message.includes(w)))
    violations.push("Inappropriate Topics")

  if (
  TOXICITY.some(w => message.includes(w)) ||
  TOXICITY_REGEX.some(r => r.test(rawMessage))
)
  violations.push("Toxicity")

  if (SUICIDE.some(w => message.includes(w)))
    violations.push("Suicide Encouragement")

  if (THREATS.some(w => message.includes(w)))
    violations.push("Threats")

  if (FAKE_STAFF_PATTERNS.some(w => message.includes(w)))
    violations.push("Faking Messages")

  if (SLURS.some(w => message.includes(w)))
    violations.push("Derogatory Chat")

  if (SOLICITATION.some(w => message.includes(w)))
  violations.push("Solicitation")

if (LINK_REGEX.test(message))
  violations.push("Inappropriate Links")

  if (BYPASS_REGEX.some(r => r.test(rawMessage)))
    violations.push("Filter Bypass")

  if (PRIVATE_INFO_REGEX.some(r => r.test(rawMessage)))
    violations.push("Leaking Private Information")

  // Basic mass messaging detection
    // ================= MASS MESSAGING (Rule 10 refined) =================
  if (rawMessage.startsWith("/msg") || rawMessage.startsWith("/w")) {
    const now = Date.now()

    if (!massMessageTracker.has(username))
      massMessageTracker.set(username, [])

    const history = massMessageTracker.get(username)
    history.push({ msg: message, time: now })

    const recent = history.filter(m => now - m.time < 10000)
    massMessageTracker.set(username, recent)

    const identical = recent.filter(m => m.msg === message)
    if (identical.length >= 3)
      violations.push("Mass Messaging")
  }

  if (violations.length > 0)
    sendModerationAlert(data, violations)
}

// ================= NORMAL CHAT EMBED =================
async function sendToDiscord(data) {
  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(getRankColor(data.rank))
    .setAuthor({
      name: data.username,
      iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
    })
    .setDescription(`💬 **Message**\n> ${data.rawMessage}`)
    .addFields({
      name: "🏷 Rank",
      value: `\`${data.rank}\``,
      inline: true
    })
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

// ================= MOD ALERT =================
async function sendModerationAlert(data, violations) {
  const channel = await discordClient.channels.fetch(process.env.MOD_ALERT_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
  .setColor(0xFF0000)
  .setTitle("⚠ Potential Rule Violation")
  .setAuthor({
    name: data.username,
    iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
  })
  .addFields(
    { name: "Server", value: "Survival", inline: true },
    { name: "Triggered Rules", value: violations.join("\n") },
    { name: "Message", value: `\`\`\`${data.rawMessage}\`\`\`` }
  )
  .setTimestamp()

  await channel.send({ embeds: [embed] })
}

async function initializeStatusMessage() {
  const channel = await discordClient.channels.fetch(process.env.STATUS_CHANNEL_ID)
  if (!channel) return

  const messages = await channel.messages.fetch({ limit: 10 })
  const botMessage = messages.find(
    msg =>
      msg.author.id === discordClient.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title?.includes("Survival")
  )

  if (botMessage) {
    statusMessage = botMessage
    console.log("♻ Reusing existing Survival status embed")
  }
}

async function updateStatusEmbed() {
  if (updatingEmbed) return
  updatingEmbed = true

  const channel = await discordClient.channels.fetch(process.env.STATUS_CHANNEL_ID)
  if (!channel) {
    updatingEmbed = false
    return
  }

  const maxPlayers = 300
  const percent = Math.min(survivalOnline / maxPlayers, 1)

  const filledBars = Math.round(percent * 10)
  const emptyBars = 10 - filledBars
  const progressBar = "🟨".repeat(filledBars) + "⬛".repeat(emptyBars)

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle("🌍 Survival")
    .setDescription("```yaml\nSTATUS: Online\n```")
    .addFields(
      {
        name: "👥 Players Online",
        value: `**${survivalOnline} / ${maxPlayers}**`,
        inline: false
      },
      {
        name: "📊 Capacity",
        value: `${progressBar}  **${Math.round(percent * 100)}%**`,
        inline: false
      }
    )
    .setFooter({ text: "Live updating every 5 seconds" })
    .setTimestamp()

  try {
    if (!statusMessage) {
      statusMessage = await channel.send({ embeds: [embed] })
    } else {
      await statusMessage.edit({ embeds: [embed] })
    }
  } catch (err) {
    console.log("Embed edit failed, sending new one...")
    statusMessage = await channel.send({ embeds: [embed] })
  }

  updatingEmbed = false
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()