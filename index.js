require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let bot
let reconnecting = false
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
  console.log("🤖 Discord connected:", discordClient.user.tag)
}

// ================= MINECRAFT BOT =================
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
  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(63, 94, 695))

  bot.once("goal_reached", async () => {
    await bot.waitForTicks(10)
    const entity = bot.nearestEntity(e =>
      (e.type === "player" || e.type === "mob") &&
      bot.entity.position.distanceTo(e.position) < 5
    )
    if (!entity) return

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(5)
    bot.swingArm("right")
    await bot.waitForTicks(3)
    bot.activateEntity(entity)
  })
}

// ================= CHAT PARSER =================
function parseChat(message) {
  if (message.includes("\n")) return null

  const colon = message.indexOf(":")
  if (colon === -1) return null

  let before = message.slice(0, colon).trim()
  const chat = message.slice(colon + 1).trim()

  let username = before.includes("]")
    ? before.split("]").pop().trim()
    : before

  username = username.replace(/^\*\s*/, "")
  username = username.replace(/§[0-9a-fk-or]/gi, "")
  username = username.replace(/&[0-9a-fk-or]/gi, "")

  if (!username.match(/^[A-Za-z0-9_]{1,20}$/)) return null

  let rank = "Invaded"
  for (const r of HUB_RANKS) {
    if (before.includes(r)) {
      rank = r
      break
    }
  }

  return { username, rank, message: chat }
}

// ================= DISCORD SEND =================
function getRankColor(rank) {
  const colors = {
    Super:0x55FF55, Elite:0x5555FF, Hero:0xFFAA00, Legend:0x00AA00,
    Titan:0xFF55FF, Immortal:0x00AAAA, Invaded:0xF1C40F,
    Trainee:0xFFFF55, Mod:0x9B59B6, "Senior Mod":0x6C3483,
    Admin:0xFF5555, Manager:0xC0392B, Developer:0x00E5FF,
    Owner:0x8B0000
  }
  return colors[rank] || 0xF1C40F
}

async function sendToDiscord(data) {
  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
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

async function init() {
  await startDiscord()
  startBot()
}

init()