require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let hubBot
let smpBot
let hubReconnecting = false
let smpReconnecting = false
let discordClient

const HUB_RANKS = [
  "Super","Elite","Titan","Immortal","Hero","Legend","Invaded",
  "Trainee","Mod","Senior Mod","Admin","Manager","Developer","Owner"
]

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord bot logged in as", discordClient.user.tag)
}

// ================= HUB BOT =================
function startHubBot() {
  hubBot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    auth: "microsoft",
    version: "1.20.1",
    profilesFolder: path.join(__dirname, "auth_cache_hub"),
    skipValidation: true,
    disableChatSigning: true
  })

  hubBot.loadPlugin(pathfinder)

  hubBot.once("spawn", () => {
    setTimeout(() => walkToHubNPC(), 6000)
  })

  hubBot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
    if (!raw.includes(":")) return

    const parsed = parseHubChat(raw)
    if (!parsed) return

    sendToDiscord(parsed, process.env.HUB_CHANNEL_ID)
  })

  hubBot.on("end", () => {
    if (hubReconnecting) return
    hubReconnecting = true
    setTimeout(() => {
      hubReconnecting = false
      startHubBot()
    }, 5000)
  })
}

// ================= SMP BOT =================
function startSMPBot() {
  smpBot = mineflayer.createBot({
    host: process.env.SMP_HOST,
    port: parseInt(process.env.SMP_PORT),
    username: process.env.SMP_USERNAME,
    auth: "microsoft",
    version: "1.20.1",
    profilesFolder: path.join(__dirname, "auth_cache_smp"),
    skipValidation: true,
    disableChatSigning: true
  })

  smpBot.loadPlugin(pathfinder)

  smpBot.once("spawn", () => {
    setTimeout(() => walkToSMPNPC(), 6000)
  })

  smpBot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
    if (!raw.includes(":")) return

    const parsed = parseSMPChat(raw)
    if (!parsed) return

    sendToDiscord(parsed, process.env.SMP_CHANNEL_ID)
  })

  smpBot.on("end", () => {
    if (smpReconnecting) return
    smpReconnecting = true
    setTimeout(() => {
      smpReconnecting = false
      startSMPBot()
    }, 5000)
  })
}

// ================= WALK + CLICK =================
async function walkToHubNPC() {
  const mcData = require("minecraft-data")(hubBot.version)
  hubBot.pathfinder.setMovements(new Movements(hubBot, mcData))
  hubBot.pathfinder.setGoal(new goals.GoalBlock(63, 94, 695))

  hubBot.once("goal_reached", async () => {
    await clickNearestNPC(hubBot)
  })
}

async function walkToSMPNPC() {
  const mcData = require("minecraft-data")(smpBot.version)
  smpBot.pathfinder.setMovements(new Movements(smpBot, mcData))
  smpBot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))

  smpBot.once("goal_reached", async () => {
    await clickNearestNPC(smpBot)
  })
}

async function clickNearestNPC(botInstance) {
  await botInstance.waitForTicks(10)

  const entity = botInstance.nearestEntity(e =>
    (e.type === "player" || e.type === "mob") &&
    botInstance.entity.position.distanceTo(e.position) < 5
  )

  if (!entity) return

  await botInstance.lookAt(entity.position.offset(0, entity.height, 0), true)
  await botInstance.waitForTicks(5)
  botInstance.swingArm("right")
  await botInstance.waitForTicks(3)
  botInstance.activateEntity(entity)
}

// ================= CHAT PARSERS =================
function parseHubChat(message) {
  try {
    if (message.includes("\n")) return null

    const colonIndex = message.indexOf(":")
    if (colonIndex === -1) return null

    const beforeColon = message.slice(0, colonIndex).trim()
    const chatMessage = message.slice(colonIndex + 1).trim()
    if (!chatMessage) return null

    let username = beforeColon.includes("]")
      ? beforeColon.split("]").pop().trim()
      : beforeColon

    username = cleanFormatting(username)

    // 🔥 REMOVE NICK STAR PREFIX
    if (username.startsWith("* ")) {
      username = username.substring(2)
    }

    username = username.trim()

    // Allow letters, numbers, underscore
    if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

    let detectedRank = "Invaded"
    for (const rank of HUB_RANKS) {
      if (beforeColon.includes(rank)) {
        detectedRank = rank
        break
      }
    }

    return {
      username,
      rank: detectedRank,
      message: cleanFormatting(chatMessage)
    }

  } catch {
    return null
  }
}

function parseSMPChat(message) {
  try {
    if (message.includes("\n")) return null

    const colonIndex = message.indexOf(":")
    if (colonIndex === -1) return null

    let beforeColon = message.slice(0, colonIndex).trim()
    const chatMessage = message.slice(colonIndex + 1).trim()

    let rank = "Default"

    if (beforeColon.startsWith("+")) {
      rank = "Diamond"
      beforeColon = beforeColon.substring(1).trim()
    }

    const username = cleanFormatting(beforeColon)

    if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

    return {
      username,
      rank,
      message: cleanFormatting(chatMessage)
    }

  } catch {
    return null
  }
}

function cleanFormatting(text) {
  return text.replace(/§[0-9a-fk-or]/gi, "")
             .replace(/&[0-9a-fk-or]/gi, "")
             .trim()
}

// ================= DISCORD =================
function getRankColor(rank) {
  const colors = {
    Super:0x55FF55, Elite:0x5555FF, Hero:0xFFAA00, Legend:0x00AA00,
    Titan:0xFF55FF, Immortal:0x00AAAA, Invaded:0xF1C40F,
    Trainee:0xFFFF55, Mod:0x9B59B6, "Senior Mod":0x6C3483,
    Admin:0xFF5555, Manager:0xC0392B, Developer:0x00E5FF,
    Owner:0x8B0000, Default:0xAAAAAA, Diamond:0x00FFFF
  }
  return colors[rank] || 0xF1C40F
}

async function sendToDiscord(data, channelId) {
  if (!discordClient) return
  const channel = await discordClient.channels.fetch(channelId)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(getRankColor(data.rank))
    .setAuthor({
      name: data.username,
      iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
    })
    .setDescription(`💬 **Message**\n> ${data.message}`)
    .addFields({ name: "🏷 Rank", value: `\`${data.rank}\``, inline: true })
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

// ================= START =================
async function init() {
  await startDiscord()
  startHubBot()
  startSMPBot()
}

init()