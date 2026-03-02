require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let bot
let reconnecting = false
let discordClient
let alreadyWalking = false

// ================= VALID HUB RANKS =================
const HUB_RANKS = [
  "Super","Elite","Titan","Immortal","Hero","Legend","Invaded",
  "Trainee","Mod","Senior Mod","Admin","Manager","Developer","Owner"
]

// ================= MESSAGE MEMORY =================
const messageHistory = new Map()

// ================= KEYWORDS =================
const SLURS = ["nigger","faggot","tranny","dirty jew","i hate gays"]
const SUICIDE = ["kys","kill yourself","slit your wrists","hope you get cancer","hope your mom dies"]
const THREATS = ["i will find you","i will kill you","kill your family"]
const SEXUAL = ["have sex","porn","nsfw","suck my"]
const SOLICITATION = ["selling account","buying rank","trading riot","selling robux"]
const AD_LINK_PATTERNS = ["discord.gg","http://","https://"]

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
    Mod: 0x9B59B6,
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

// ================= WALK + CLICK =================
async function walkToNPC() {
  if (alreadyWalking) return
  alreadyWalking = true

  console.log("🚶 Walking to Survival NPC...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(63, 94, 695))

  bot.once("goal_reached", async () => {
    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e =>
      e.position &&
      bot.entity.position.distanceTo(e.position) < 5 &&
      (e.type === "mob" || e.type === "player")
    )

    if (!entity) {
      alreadyWalking = false
      return setTimeout(walkToNPC, 5000)
    }

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)
    bot.activateEntity(entity)

    console.log("✅ Clicked Survival NPC")
  })
}

// ================= CHAT PARSER =================
function parseChat(message) {
  try {
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
        const bracketRank = match[1].trim()

        if (HUB_RANKS.includes(bracketRank)) {
          detectedRank = bracketRank
        } else {
          // Custom ranks default to Invaded
          detectedRank = "Invaded"
        }
      }

      usernameSection = before.split("]").pop().trim()
    } else {
      // No brackets at all → Default player
      detectedRank = "Default"
    }

    let username = usernameSection
      .replace(/^\*\s*/, "")
      .replace(/§[0-9a-fk-or]/gi, "")
      .replace(/&[0-9a-fk-or]/gi, "")
      .trim()

    if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

    return {
      username,
      rank: detectedRank,
      message: chat.toLowerCase(),
      rawMessage: chat
    }

  } catch {
    return null
  }
}

// ================= MODERATION =================
function runModeration(data) {
  const now = Date.now()
  const { username, message } = data

  if (!messageHistory.has(username))
    messageHistory.set(username, [])

  const history = messageHistory.get(username)
  history.push({ msg: message, time: now })

  const recent = history.filter(m => now - m.time < 15000)
  messageHistory.set(username, recent)

  let violations = []

  if (recent.filter(m => m.msg === message).length >= 3)
    violations.push("Spam")

  if (SLURS.some(w => message.includes(w)))
    violations.push("Derogatory Chat")

  if (SUICIDE.some(w => message.includes(w)))
    violations.push("Suicide Encouragement")

  if (THREATS.some(w => message.includes(w)))
    violations.push("Threat")

  if (SEXUAL.some(w => message.includes(w)))
    violations.push("Inappropriate Topic")

  if (SOLICITATION.some(w => message.includes(w)))
    violations.push("Solicitation")

  if (AD_LINK_PATTERNS.some(w => message.includes(w)) &&
      !message.includes("invadedlands.net"))
    violations.push("Inappropriate Link")

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

// ================= MOD ALERT EMBED =================
async function sendModerationAlert(data, violations) {
  const channel = await discordClient.channels.fetch(process.env.MOD_ALERT_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle("⚠ Potential Rule Violation")
    .addFields(
      { name: "Player", value: data.username, inline: true },
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