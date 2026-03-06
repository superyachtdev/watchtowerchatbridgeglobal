require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")
const express = require("express")
const app = express()
const PORT = process.env.PORT || 3000

let bot
let reconnecting = false
let discordClient
let alreadyWalking = false
let survivalOnline = 0
let statusMessage = null
let updatingEmbed = false
let chatKeepAliveInterval = null
let keepAliveInterval = null
const AH_SEARCH_SLOT = 49
let pagesScanned = 0
const MAX_AH_PAGES = 10

let defaultMovements 
// ================= INFLATION TRACKER =================
let lastBaltopTotal = null
let baltopHistory = [] // { time, total }
// ================= AUCTION CPI TRACKER =================
let auctionHistory = [] // { time, basket }
let lastAuctionBasket = null
let auctionMessage = null
let auctionScanning = false

const CPI_ITEMS = {
  "Chicken Spawner": [],
  "Block of Netherite": [],
  "Sell Wand (Tier 2)": [],
  "Enderman Spawner": []
}

const CPI_SAMPLE_SIZE = 3
const CPI_MIN_SAMPLE = 1
// ================= CRATE TRACKER =================
// ================= CRATE TRACKER =================
let crateHistory = [] // { time, type }
let crateMessage = null
let inflationMessage = null
let baltopInterval = null
let onlineInterval = null
let baltopWatchdog = null
let baltopResolved = false
let baltopErrorMessage = null
const fs = require("fs")

const DATA_FILE = path.join(__dirname, "auth_cache", "inflation_data.json")

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

app.get("/", (req, res) => {
  res.send("Watchtower Inflation Dashboard Running")
})

app.get("/inflation", (req, res) => {
  const history = baltopHistory.map(entry => ({
    time: entry.time,
    total: entry.total
  }))

  res.send(`
    <html>
      <head>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body style="background:#111;color:white;font-family:sans-serif;">
        <h2>Survival Inflation Graph</h2>
        <canvas id="chart"></canvas>

        <script>
          const data = ${JSON.stringify(history)}

          const ctx = document.getElementById("chart").getContext("2d")

          new Chart(ctx, {
            type: "line",
            data: {
              labels: data.map(d => new Date(d.time).toLocaleTimeString()),
              datasets: [{
                label: "Server Total Wealth",
                data: data.map(d => d.total),
                borderColor: "#F1C40F",
                backgroundColor: "rgba(241,196,15,0.1)",
                tension: 0.2
              }]
            },
            options: {
              responsive: true,
              scales: {
                x: { ticks: { color: "white" }},
                y: { ticks: { color: "white" }}
              },
              plugins: {
                legend: { labels: { color: "white" }}
              }
            }
          })
        </script>
      </body>
    </html>
  `)
})



app.listen(PORT, "0.0.0.0", () => {
  console.log("🌐 Web dashboard running on port", PORT)
})

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

function loadInflationData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8")
      const parsed = JSON.parse(raw)

      baltopHistory = parsed.baltopHistory || []
lastBaltopTotal = parsed.lastBaltopTotal || null
crateHistory = parsed.crateHistory || []

// RESET AUCTION CPI DATA
auctionHistory = []
lastAuctionBasket = null
      
      console.log("📂 Loaded inflation history:", baltopHistory.length, "entries")
      console.log("📦 Loaded crate history:", crateHistory.length, "entries")
    }
  } catch (err) {
    console.log("Failed to load data:", err.message)
  }
}

function saveInflationData() {
  try {
    const data = {
      baltopHistory,
      lastBaltopTotal,
      crateHistory,
      auctionHistory,
      lastAuctionBasket
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
  } catch (err) {
    console.log("Failed to save data:", err.message)
  }
}

function prepareForMovement() {
  if (!bot || !bot.player) return false

  bot.clearControlStates()
  bot.pathfinder.setGoal(null)

  const mcData = require("minecraft-data")(bot.version)
  const movements = new Movements(bot, mcData)

  movements.allow1by1towers = false
  movements.canDig = false
  movements.allowParkour = true
  movements.allowSprinting = true
  movements.canOpenDoors = true

  bot.pathfinder.setMovements(movements)

  return true
}

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)

  discordClient.on("messageCreate", async (message) => {
    if (message.author.bot) return
    if (message.author.id !== "159552173070483456") return
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return

    const content = message.content.trim()

    // ================= RAW MC COMMAND =================
    if (content.toLowerCase().startsWith("command:")) {
      const command = content.slice(8).trim()
      if (!command) return

      console.log("🎮 Executing Minecraft command:", command)

      if (bot && bot.player) {
        bot.chat(command)
        await message.react("✅")
      } else {
        await message.react("❌")
      }

      return
    }

    // ================= GOTO PATHFIND =================
if (content.toLowerCase().startsWith("goto:")) {
  const coordsRaw = content.slice(5).trim()
  const parts = coordsRaw.split(" ")

  if (parts.length !== 3) {
    await message.react("❌")
    return
  }

  const x = parseInt(parts[0])
  const y = parseInt(parts[1])
  const z = parseInt(parts[2])

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    await message.react("❌")
    return
  }

  if (!prepareForMovement()) {
    await message.react("❌")
    return
  }

  console.log(`🧭 Pathfinding to ${x} ${y} ${z}`)

  setTimeout(() => {
    bot.pathfinder.setGoal(
      new goals.GoalNear(x, y, z, 1),
      false
    )
  }, 100)

  await message.react("🧭")
  return
}

   // ================= FOLLOW PLAYER =================
if (content.toLowerCase().startsWith("follow:")) {
  const targetName = content.slice(7).trim()
  if (!targetName) {
    await message.react("❌")
    return
  }

  const target = Object.values(bot.players).find(
    p =>
      p.username &&
      p.username.toLowerCase() === targetName.toLowerCase() &&
      p.entity
  )

  if (!target || !target.entity) {
    await message.react("❌")
    return
  }

  if (!prepareForMovement()) {
    await message.react("❌")
    return
  }

  console.log(`👣 Following player: ${target.username}`)

  setTimeout(() => {
    bot.pathfinder.setGoal(
      new goals.GoalFollow(target.entity, 3),
      true
    )
  }, 100)

  await message.react("👣")
  return
}

    // ================= STOP PATHFIND =================
    if (content.toLowerCase() === "stop") {
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  await message.react("🛑")
  return
}
  })

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
    checkTimeoutInterval: 60 * 1000,
    disableChatSigning: true
  })

  bot.setMaxListeners(50)

  bot.loadPlugin(pathfinder)
  bot.on("error", (err) => {

  if (err.code === "ECONNRESET") {
    console.log("Proxy transfer detected — ignoring reset")
    return
  }

  console.log("Bot error:", err.code || err.message)
})

  bot.once("spawn", () => {
  console.log("🤖 Bot spawned — initializing pathfinder")

  const mcData = require("minecraft-data")(bot.version)

  defaultMovements = new Movements(bot, mcData)
  defaultMovements.allow1by1towers = false
  defaultMovements.canDig = false
  defaultMovements.allowParkour = true
  defaultMovements.allowSprinting = true
  defaultMovements.canOpenDoors = true

  bot.pathfinder.setMovements(defaultMovements)

  // Stabilizers
  bot.pathfinder.thinkTimeout = 10000
  bot.pathfinder.tickTimeout = 40

  
  // Anti-stuck protection

  if (baltopInterval) clearInterval(baltopInterval)

baltopInterval = setInterval(() => {
  if (bot && bot.player) {

    baltopResolved = false
    bot.chat("/baltop")

    if (baltopWatchdog) clearTimeout(baltopWatchdog)

    baltopWatchdog = setTimeout(async () => {

  if (!baltopResolved && discordClient) {

    try {

      const channel = await discordClient.channels.fetch(process.env.INFLATION_CHANNEL_ID)
      if (!channel) return

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle("⚠ Baltop Command Unavailable")
        .setDescription(
          "The `/baltop` command did not return **Server Total** within 20 seconds.\n\n" +
          "Economy calculations are currently paused until the command works again."
        )
        .setTimestamp()

      if (!baltopErrorMessage) {
        baltopErrorMessage = await channel.send({ embeds: [embed] })
      } else {
        await baltopErrorMessage.edit({ embeds: [embed] })
      }

    } catch (err) {
      console.log("Failed to update baltop error:", err.message)
    }

  }

}, 20000)

  }
}, parseInt(process.env.BALTOP_INTERVAL_MS || 300000))
  setInterval(() => {

  if (!bot || !bot.player) return
  if (auctionScanning) return



  scanAuctionHouse()

}, 300000) // every 5 minutes
  setTimeout(() => walkToNPC(), 12000)

  if (onlineInterval) clearInterval(onlineInterval)

// Start polling AFTER server transfer
setTimeout(() => {

  console.log("📊 Starting /online polling")

  if (onlineInterval) clearInterval(onlineInterval)

  onlineInterval = setInterval(() => {
  if (!bot || !bot.player) return
  if (auctionScanning) return

  bot.chat("/online")
}, 15000)

}, 25000) // wait longer so proxy transfer finishes
// keep connection alive
// ================= RTP KEEPALIVE =================
// ================= PUNCH KEEPALIVE =================
if (keepAliveInterval) clearInterval(keepAliveInterval)

keepAliveInterval = setInterval(() => {

  if (!bot || !bot.player) return

  try {
    bot.swingArm("right")
    console.log("👊 Bot punched")
  } catch (err) {}

}, 120000)
})


  bot.on("message", async (jsonMsg) => {
  const raw = jsonMsg.toString().trim()
  // ================= CRATE PURCHASE DETECTION =================
if (raw.includes("[Broadcast]") && raw.toUpperCase().includes("CRATE KEY")) {
  const now = Date.now()

  const match = raw.toUpperCase().match(/(\d+)X\s+([A-Z]+)\s+CRATE KEY/)
  if (match) {
    const amount = parseInt(match[1])
    const typeRaw = match[2]

    let type = null
    if (typeRaw.includes("MARCH")) type = "March"
    if (typeRaw.includes("INVADED")) type = "Invaded"

    if (type) {
      for (let i = 0; i < amount; i++) {
        crateHistory.push({
          time: now,
          type
        })
      }

      // Keep only 24h
      crateHistory = crateHistory.filter(
        entry => now - entry.time <= 24 * 60 * 60 * 1000
      )

      saveInflationData()
      updateCrateEmbed()
    }
  }
}

 const baltopMatch = raw.match(/Server Total:\s*\$?([\d,]+)/i)

if (baltopMatch) {

  baltopResolved = true
  if (baltopWatchdog) clearTimeout(baltopWatchdog)
     if (baltopErrorMessage) {
  inflationMessage = baltopErrorMessage
  baltopErrorMessage = null
}
    

  const cleaned = baltopMatch[1].replace(/,/g, "")
  const total = parseFloat(cleaned)

  if (!isNaN(total)) {
    handleBaltopTotal(total)
  }

  return
}
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
  console.log("🔌 Disconnected from server")

  alreadyWalking = false

  if (reconnecting) return
  reconnecting = true

  setTimeout(() => {
    console.log("🔄 Reconnecting bot...")
    reconnecting = false
    startBot()
  }, 10000)
})
}

// ================= WALK =================
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

function handleBaltopTotal(total) {
  const now = Date.now()

  lastBaltopTotal = total

  baltopHistory.push({
    time: now,
    total
  })

  // Keep only last 24h
  baltopHistory = baltopHistory.filter(
    entry => now - entry.time <= 24 * 60 * 60 * 1000
  )

  saveInflationData()
updateInflationEmbed()
}

function calculateInflation(minutes) {

  const now = Date.now()

  const candidates = baltopHistory
    .filter(entry => now - entry.time >= minutes * 60 * 1000)
    .sort((a, b) => b.time - a.time)

  const past = candidates[0]

  if (!past || !lastBaltopTotal) return null

  const change = ((lastBaltopTotal - past.total) / past.total) * 100

  if (!isFinite(change)) return null

  return change
}

function calculateCrates(minutes, type) {
  const now = Date.now()

  return crateHistory.filter(entry =>
    entry.type === type &&
    now - entry.time <= minutes * 60 * 1000
  ).length
}

function waitForWindow(timeout = 10000) {
  return new Promise((resolve, reject) => {

    const timer = setTimeout(() => {
      reject(new Error("Window open timeout"))
    }, timeout)

    bot.once("windowOpen", (window) => {
      clearTimeout(timer)
      resolve(window)
    })

  })
}

async function scanAuctionHouse() {

  if (auctionScanning) {
    console.log("⏳ AH scan already running")
    return
  }
    
  auctionScanning = true

  console.log("📊 Starting AH CPI scan")
  pagesScanned = 0

  for (const item in CPI_ITEMS) {
    CPI_ITEMS[item] = []
  }

  try {
    
    await bot.waitForTicks(10)
    bot.chat("/ah")

    const window = await waitForWindow()

    console.log("📖 AH opened — scanning pages")

    await parseAuctionPage(window)

  } catch (err) {

    console.log("❌ AH scan failed:", err)

    auctionScanning = false

  }

}

async function parseAuctionPage(window) {

  pagesScanned++

  console.log(`📄 Scanning AH page ${pagesScanned}`)

  // Scan only actual item slots (avoid GUI buttons)
  for (let i = 0; i < 45; i++) {

    const slot = window.slots[i]
    if (!slot) continue

    let displayName = slot.nbt?.value?.display?.value?.Name?.value
    let lore = slot.nbt?.value?.display?.value?.Lore?.value

    let textLines = []

    // Read display name
    if (displayName) {
      try {
        const parsed = JSON.parse(displayName)
        textLines.push(parsed.text || "")
      } catch {
        textLines.push(String(displayName))
      }
    }

    // Read lore lines
    if (lore) {
      if (!Array.isArray(lore)) lore = [lore]

      for (const line of lore) {
        textLines.push(String(line?.value ?? line?.text ?? line ?? ""))
      }
    }

    if (textLines.length === 0) continue

    let itemName = null
let price = null

const baseName = slot.name ? slot.name.toLowerCase() : ""

for (const text of textLines) {

  const normalized = text.toLowerCase()

  // Detect spawners using base item + text
  if (baseName.includes("spawner")) {

    if (normalized.includes("chicken")) {
      itemName = "Chicken Spawner"
    }

    if (normalized.includes("enderman")) {
      itemName = "Enderman Spawner"
    }
  }

  // Netherite block
  if (baseName.includes("netherite_block") || normalized.includes("netherite")) {
    itemName = "Block of Netherite"
  }

  // Sell wand
  if (normalized.includes("sell wand")) {
    itemName = "Sell Wand (Tier 2)"
  }

  // Price detection
  const match = text.match(/\$([\d,\.]+)/)

  if (match) {
    price = parseFloat(match[1].replace(/,/g, ""))
  }
}

    if (!itemName || !price) continue

    if (CPI_ITEMS[itemName].length < CPI_SAMPLE_SIZE) {

      const count = slot.count || 1
      const unitPrice = price / count

      CPI_ITEMS[itemName].push(unitPrice)

      console.log(`💰 Found ${itemName} listing: $${unitPrice}`)
    }
  }

  // Stop if enough samples collected
  const done = Object.values(CPI_ITEMS).every(v => v.length >= CPI_SAMPLE_SIZE)

  if (done) {
    console.log("✅ Required CPI samples collected")
    finalizeAuctionBasket()
    return
  }

  // Stop if page limit reached
  if (pagesScanned >= MAX_AH_PAGES) {
    console.log("📦 Max AH pages reached")
    finalizeAuctionBasket()
    return
  }

  const nextButton = window.slots[53]

  if (!nextButton || nextButton.name === "gray_stained_glass_pane") {
    console.log("📦 Reached final AH page")
    finalizeAuctionBasket()
    return
  }

  try {

    await bot.clickWindow(53, 0, 0)

    await bot.waitForTicks(15)

    const nextWindow = bot.currentWindow

    if (!nextWindow) {
      console.log("❌ AH window disappeared")
      finalizeAuctionBasket()
      return
    }

    await parseAuctionPage(nextWindow)

  } catch (err) {

    console.log("❌ Failed to open next AH page")
    finalizeAuctionBasket()

  }

}


function median(arr) {

  const sorted = [...arr].sort((a,b)=>a-b)
  const mid = Math.floor(sorted.length/2)

  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid-1]+sorted[mid])/2
}

function finalizeAuctionBasket() {

  let basket = 0

  console.log("📦 CPI basket finalized")

  for (const item in CPI_ITEMS) {

    const prices = CPI_ITEMS[item]

    if (prices.length === 0) {
      console.log(`⚠ No listings found for ${item}`)
      continue
    }

    const med = median(prices)

    console.log(`📊 ${item} median: $${med}`)

    basket += med
  }

  if (basket <= 0) {
  console.log("⚠ Basket value invalid — skipping sample")
  auctionScanning = false
  return
}

lastAuctionBasket = basket

  console.log(`💰 Basket value: $${basket}`)

  auctionHistory.push({
    time: Date.now(),
    basket
  })

  auctionHistory = auctionHistory.filter(
    e => Date.now() - e.time <= 24 * 60 * 60 * 1000
  )

  saveInflationData()

  updateAuctionEmbed()

  auctionScanning = false
}

function calculateAuctionInflation(minutes) {

  const now = Date.now()

  const currentSamples = auctionHistory
    .filter(e => now - e.time <= 15 * 60 * 1000)

  const pastSamples = auctionHistory
    .filter(e =>
      now - e.time >= minutes * 60 * 1000 &&
      now - e.time <= minutes * 60 * 1000 + (15 * 60 * 1000)
    )

  if (currentSamples.length === 0 || pastSamples.length === 0) {
    return null
  }

  const currentAvg =
    currentSamples.reduce((sum,e)=>sum+e.basket,0) / currentSamples.length

  const pastAvg =
    pastSamples.reduce((sum,e)=>sum+e.basket,0) / pastSamples.length

  if (pastAvg <= 0) return null

  const change = ((currentAvg - pastAvg) / pastAvg) * 100

  if (!isFinite(change)) return null

  return change
}

async function updateAuctionEmbed() {

  const channel = await discordClient.channels.fetch(process.env.INFLATION_CHANNEL_ID)
  if (!channel) return

  const infl30 = calculateAuctionInflation(30)
  const infl60 = calculateAuctionInflation(60)
  const infl720 = calculateAuctionInflation(720)
  const infl1440 = calculateAuctionInflation(1440)

  function format(percent){
    if (percent === null) return "⏳ Collecting..."

    const sign = percent >= 0 ? "+" : "-"
    const emoji = percent >= 0 ? "📈" : "📉"

    return `${emoji} **${sign}${Math.abs(percent).toFixed(2)}% Price Change**`
  }

  // ✔ / ❌ indicators
  function itemStatus(item){
    if (!CPI_ITEMS[item] || CPI_ITEMS[item].length === 0) {
      return `❌ ${item}`
    } else {
      return `✅ ${item}`
    }
  }

  const basketList =
    itemStatus("Chicken Spawner") + "\n" +
    itemStatus("Block of Netherite") + "\n" +
    itemStatus("Sell Wand (Tier 2)") + "\n" +
    itemStatus("Enderman Spawner")

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle("🧺 Core Inflation")
    .setDescription(
      `**Tracked Basket**\n` +
      `${basketList}\n\n` +
      `**Basket Value**\n$${lastAuctionBasket?.toLocaleString() || "Collecting"}`
    )
    .addFields(
      { name: "⏱ 30 Minutes", value: format(infl30) },
      { name: "🕐 1 Hour", value: format(infl60) },
      { name: "🕛 12 Hours", value: format(infl720) },
      { name: "📅 24 Hours", value: format(infl1440) }
    )
    .setFooter({ text: "InvadedLands Economy" })
    .setTimestamp()

  try {

    if (!auctionMessage) {
      auctionMessage = await channel.send({ embeds:[embed] })
    } else {
      await auctionMessage.edit({ embeds:[embed] })
    }

  } catch {

    auctionMessage = await channel.send({ embeds:[embed] })

  }
}

async function updateCrateEmbed() {
  if (!discordClient) return

  const channel = await discordClient.channels.fetch(process.env.INFLATION_CHANNEL_ID)
  if (!channel) return

  const invaded30 = calculateCrates(30, "Invaded")
  const invaded60 = calculateCrates(60, "Invaded")
  const invaded1440 = calculateCrates(1440, "Invaded")

  const march30 = calculateCrates(30, "March")
  const march60 = calculateCrates(60, "March")
  const march1440 = calculateCrates(1440, "March")

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle("Crate Tracker")
    .addFields(
      {
        name: "⏱ Last 30 Minutes",
        value:
          `Invaded: **${invaded30}**\n` +
          `March: **${march30}**`,
        inline: false
      },
      {
        name: "🕐 Last 1 Hour",
        value:
          `Invaded: **${invaded60}**\n` +
          `March: **${march60}**`,
        inline: false
      },
      {
        name: "📅 Last 24 Hours",
        value:
          `Invaded: **${invaded1440}**\n` +
          `March: **${march1440}**`,
        inline: false
      }
    )
    .setFooter({ text: "InvadedLands Economy" })
    .setTimestamp()

  try {
    if (!crateMessage) {
      crateMessage = await channel.send({ embeds: [embed] })
    } else {
      await crateMessage.edit({ embeds: [embed] })
    }
  } catch (err) {
    crateMessage = await channel.send({ embeds: [embed] })
  }
}

async function updateInflationEmbed() {
  if (!discordClient) return

  const channel = await discordClient.channels.fetch(process.env.INFLATION_CHANNEL_ID)
  if (!channel) return

  const infl30 = calculateInflation(30)
  const infl60 = calculateInflation(60)
  const infl720 = calculateInflation(720)      // 12h
  const infl1440 = calculateInflation(1440)    // 24h
  const infl10080 = calculateInflation(10080)  // 7d

  function getPast(minutes) {
    const now = Date.now()
    const candidates = baltopHistory
      .filter(entry => now - entry.time >= minutes * 60 * 1000)
      .sort((a, b) => b.time - a.time)
    return candidates[0]
  }

  

  function formatTrend(percent) {
  if (percent === null) return "⏳ Pending.."

  const isGrowth = percent >= 0
  const sign = isGrowth ? "+" : "-"
  const word = isGrowth ? "Wealth Growth" : "Wealth Decline"
  const emoji = isGrowth ? "📈" : "📉"

  return `${emoji} **${sign}${Math.abs(percent).toFixed(2)}% ${word}**`
}

  function formatMoneyChange(minutes, percent) {
    const past = getPast(minutes)
    if (!past || percent === null) return ""

    const diff = lastBaltopTotal - past.total
    const sign = diff >= 0 ? "+" : "-"

    return `\n${sign}$${Math.abs(diff).toLocaleString()}`
  }

  function miniBar(percent) {
    if (percent === null) return ""

    const magnitude = Math.min(Math.abs(percent), 10)
    const filled = Math.round(magnitude)
    const empty = 10 - filled

    return `\n${"▰".repeat(filled)}${"▱".repeat(empty)}`
  }

  // ===== Economy Health (Based on 24h) =====
  let economyStatus = "Stable 🟡"
  let color = 0xF1C40F

  if (infl1440 !== null) {
    if (infl1440 > 3) {
      economyStatus = "Overheating 🔥"
      color = 0xE74C3C
    } else if (infl1440 < -3) {
      economyStatus = "Deflation ❄️"
      color = 0x3498DB
    } else if (infl1440 > 0.5) {
      economyStatus = "Growing 🟢"
      color = 0x2ECC71
    } else if (infl1440 < -0.5) {
      economyStatus = "Cooling 🔵"
      color = 0x5DADE2
    }
  }

  const formattedTotal = lastBaltopTotal
    ? `$${lastBaltopTotal.toLocaleString()}`
    : "Collecting..."

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("💰 Survival Economy Dashboard")
    .setDescription(
  `**Server Total Wealth**\n` +
  `${formattedTotal}\n\n` +
  `**Economy Health (24h):** ${economyStatus}\n\n` +
  `📈 [Click here](https://watchtowerchatbridgeglobal-production.up.railway.app/inflation) to view in graph.`
)
    .addFields(
      {
        name: "⏱ 30 Minutes",
        value:
          formatTrend(infl30) +
          formatMoneyChange(30, infl30) +
          miniBar(infl30),
        inline: false
      },
      {
        name: "🕐 1 Hour",
        value:
          formatTrend(infl60) +
          formatMoneyChange(60, infl60) +
          miniBar(infl60),
        inline: false
      },
      {
        name: "🕛 12 Hours",
        value:
          formatTrend(infl720) +
          formatMoneyChange(720, infl720) +
          miniBar(infl720),
        inline: false
      },
      {
        name: "📅 24 Hours",
        value:
          formatTrend(infl1440) +
          formatMoneyChange(1440, infl1440) +
          miniBar(infl1440),
        inline: false
      },
      {
        name: "🗓 7 Days",
        value:
          formatTrend(infl10080) +
          formatMoneyChange(10080, infl10080) +
          miniBar(infl10080),
        inline: false
      }
    )
    .setFooter({
      text: `InvadedLands Economy`
    })
    .setTimestamp()

  try {
    if (!inflationMessage) {
      inflationMessage = await channel.send({ embeds: [embed] })
    } else {
      await inflationMessage.edit({ embeds: [embed] })
    }
  } catch (err) {
    console.log("Inflation embed missing, regenerating...")
    inflationMessage = await channel.send({ embeds: [embed] })
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
  loadInflationData()
  updateCrateEmbed()
  startBot()
}

init()