require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let bot
let reconnecting = false
let discordClient

const SERVER_NAME = "Survival"

// ================= MESSAGE MEMORY (SPAM TRACKING) =================
const messageHistory = new Map() // username -> [{msg, time}]

// ================= KEYWORD DATABASE =================
const SLURS = ["nigger","faggot","tranny","dirty jew","i hate gays"]
const SUICIDE = ["kys","kill yourself","slit your wrists","hope you get cancer","hope your mom dies"]
const THREATS = ["i will find you","i will kill you","kill your family"]
const SEXUAL = ["have sex","porn","nsfw","suck my"]
const SOLICITATION = ["selling account","buying rank","trading riot","selling robux"]
const AD_LINK_PATTERNS = ["discord.gg","http://","https://"]

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)
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
    console.log("🌍 Spawned in hub")
    setTimeout(() => walkToNPC(), 6000)
  })

  bot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
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
let alreadyWalking = false

async function walkToNPC() {
  if (alreadyWalking) return
  alreadyWalking = true

  console.log("🚶 Walking to Survival NPC...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(63, 94, 695))

  bot.once("goal_reached", async () => {
    console.log("🎯 Reached Survival NPC location")

    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e => {
      if (!e.position) return false
      const dist = bot.entity.position.distanceTo(e.position)
      return (
        dist < 5 &&
        (e.type === "mob" || e.type === "player")
      )
    })

    if (!entity) {
      console.log("❌ No NPC found — retrying in 5 seconds")
      alreadyWalking = false
      return setTimeout(walkToNPC, 5000)
    }

    console.log("🖱 Clicking:", entity.username || entity.name)

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)
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

  let username = before.split("]").pop().trim()

  username = username
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/&[0-9a-fk-or]/gi, "")
    .trim()

  if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

  return {
    username,
    message: chat.toLowerCase(),
    rawMessage: chat
  }
}

// ================= MODERATION ENGINE =================
function runModeration(data) {
  const now = Date.now()
  const { username, message } = data

  if (!messageHistory.has(username)) {
    messageHistory.set(username, [])
  }

  const history = messageHistory.get(username)
  history.push({ msg: message, time: now })

  // remove old entries (older than 15s)
  const recent = history.filter(m => now - m.time < 15000)
  messageHistory.set(username, recent)

  let violations = []

  // 1️⃣ Spam
  const identical = recent.filter(m => m.msg === message)
  if (identical.length >= 3) {
    violations.push("Spam (3 identical messages in 15s)")
  }

  // 2️⃣ Slurs
  if (SLURS.some(w => message.includes(w))) {
    violations.push("Derogatory Chat / Slur")
  }

  // 3️⃣ Suicide Encouragement
  if (SUICIDE.some(w => message.includes(w))) {
    violations.push("Suicide Encouragement")
  }

  // 4️⃣ Threats
  if (THREATS.some(w => message.includes(w))) {
    violations.push("Threats")
  }

  // 5️⃣ Inappropriate Topics
  if (SEXUAL.some(w => message.includes(w))) {
    violations.push("Inappropriate Topic")
  }

  // 6️⃣ Solicitation
  if (SOLICITATION.some(w => message.includes(w))) {
    violations.push("Solicitation")
  }

  // 7️⃣ Advertising / Links
  if (AD_LINK_PATTERNS.some(w => message.includes(w))) {
    if (!message.includes("invadedlands.net")) {
      violations.push("Inappropriate Link / Advertising")
    }
  }

  if (violations.length > 0) {
    sendModerationAlert(data, violations)
  }
}

// ================= NORMAL CHAT MIRROR =================
async function sendToDiscord(data) {
  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xAAAAAA)
    .setAuthor({
      name: data.username,
      iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
    })
    .setDescription(`💬 ${data.rawMessage}`)
    .addFields(
      { name: "Server", value: SERVER_NAME, inline: true }
    )
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

// ================= MOD ALERT EMBED =================
async function sendModerationAlert(data, violations) {
  const channel = await discordClient.channels.fetch(process.env.MOD_ALERT_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle("⚠ Potential Rule Violation")
    .addFields(
      { name: "Player", value: data.username, inline: true },
      { name: "Server", value: SERVER_NAME, inline: true },
      { name: "Triggered Rules", value: violations.join("\n") },
      { name: "Message", value: `\`\`\`${data.rawMessage}\`\`\`` }
    )
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()